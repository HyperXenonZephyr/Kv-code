import { exec, execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { listWorkspaceDirectory } from "./workspace-files";
import type { ToolPolicy, WorkspaceMode } from "../shared/settings";

const POLICY_LIMITS: Record<ToolPolicy, {
  maxResult: number;
  maxArguments: number;
  maxListEntries: number;
  timeoutMs: number;
  maxRounds: number;
}> = {
  "read-only": { maxResult: 96_000, maxArguments: 32_000, maxListEntries: 2_000, timeoutMs: 30_000, maxRounds: 12 },
  auto: { maxResult: 256_000, maxArguments: 256_000, maxListEntries: 10_000, timeoutMs: 120_000, maxRounds: 32 },
  yolo: { maxResult: 1_000_000, maxArguments: 1_000_000, maxListEntries: 50_000, timeoutMs: 30 * 60_000, maxRounds: 64 },
};

export const basicToolDefinitionSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(1_500),
    parameters: z.record(z.unknown()),
  }),
});

export type BasicToolDefinition = z.infer<typeof basicToolDefinitionSchema>;

export interface ToolContext {
  workspace: string;
  mode: WorkspaceMode;
  policy: ToolPolicy;
  signal: AbortSignal;
  requestApproval?: (request: ToolApprovalRequest) => Promise<boolean>;
  terminal?: ToolTerminalBridge;
}

export interface ToolTerminalBridge {
  list(): Promise<Array<{ id: string; title: string; cwd: string; shell: string; running: boolean }>>;
  read(id: string, maxCharacters?: number): Promise<{ id: string; output: string; truncated: boolean; running: boolean }>;
  write(id: string, data: string): Promise<void>;
}

export interface ToolApprovalRequest {
  kind: "sensitive-path" | "file-mutation" | "git-mutation" | "terminal";
  summary: string;
}

export interface ToolCallInput {
  name: string;
  arguments: string;
}

const READ_ONLY_TOOLS: ReadonlyArray<BasicToolDefinition> = [
  functionTool("workspace_list", "List one workspace directory. Paths are relative to the workspace root.", {
    type: "object",
    properties: { path: { type: "string", description: "Relative directory path; empty means the workspace root." } },
    additionalProperties: false,
  }),
  functionTool("workspace_search_files", "Find workspace files by a glob pattern using ripgrep's file index.", {
    type: "object",
    properties: {
      glob: { type: "string", description: "Glob such as **/*.ts. Empty returns all indexed files." },
      path: { type: "string", description: "Optional relative directory to search." },
    },
    additionalProperties: false,
  }),
  functionTool("workspace_search_text", "Search text in workspace files and return file, line, column, and matching text.", {
    type: "object",
    properties: {
      query: { type: "string" },
      path: { type: "string", description: "Optional relative directory or file." },
      glob: { type: "string", description: "Optional file glob." },
      case_sensitive: { type: "boolean" },
      regex: { type: "boolean", description: "Interpret query as a regular expression instead of fixed text." },
    },
    required: ["query"],
    additionalProperties: false,
  }),
  functionTool("workspace_read_file", "Read UTF-8 text with optional one-based line bounds. Binary files are unavailable; Office files are model-readable only through future Work Mode tools.", {
    type: "object",
    properties: {
      path: { type: "string" },
      start_line: { type: "integer", minimum: 1 },
      end_line: { type: "integer", minimum: 1 },
    },
    required: ["path"],
    additionalProperties: false,
  }),
  functionTool("git_status", "Inspect branch, upstream, conflicts, staged, unstaged, and untracked files.", emptyObjectSchema()),
  functionTool("git_diff", "Read a Git diff without changing the repository.", {
    type: "object",
    properties: {
      staged: { type: "boolean" },
      path: { type: "string", description: "Optional workspace-relative path." },
      context: { type: "integer", minimum: 0, maximum: 100 },
    },
    additionalProperties: false,
  }),
  functionTool("git_log", "Read recent commits in a stable structured format.", {
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 200 } },
    additionalProperties: false,
  }),
  functionTool("git_show", "Show one commit or revision without changing the repository.", {
    type: "object",
    properties: { revision: { type: "string" }, path: { type: "string" } },
    required: ["revision"],
    additionalProperties: false,
  }),
  functionTool("git_branches", "List local and remote branches with upstream and worktree information.", emptyObjectSchema()),
  functionTool("git_conflicts", "List unresolved merge-conflict paths.", emptyObjectSchema()),
  functionTool("terminal_list", "List integrated terminal sessions shared with the user.", emptyObjectSchema()),
  functionTool("terminal_read", "Read recent output from an integrated terminal session.", {
    type: "object",
    properties: {
      terminal_id: { type: "string" },
      max_characters: { type: "integer", minimum: 1, maximum: 200_000 },
    },
    required: ["terminal_id"],
    additionalProperties: false,
  }),
];

const MUTATION_TOOLS: ReadonlyArray<BasicToolDefinition> = [
  functionTool("workspace_write_file", "Create or replace one UTF-8 workspace file. Never modify user-authored KV Code rules.", {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
    additionalProperties: false,
  }),
  functionTool("workspace_apply_patch", "Precisely replace an exact text fragment in one UTF-8 file. The old text must match; use replace_all only when every occurrence should change.", {
    type: "object",
    properties: {
      path: { type: "string" },
      old_text: { type: "string" },
      new_text: { type: "string" },
      replace_all: { type: "boolean" },
    },
    required: ["path", "old_text", "new_text"],
    additionalProperties: false,
  }),
  functionTool("workspace_create_directory", "Create a workspace directory and any missing parents.", {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  }),
  functionTool("workspace_move", "Move or rename a workspace file or directory without overwriting the destination.", {
    type: "object",
    properties: { from: { type: "string" }, to: { type: "string" } },
    required: ["from", "to"],
    additionalProperties: false,
  }),
  functionTool("workspace_delete", "Delete a workspace file or directory. Recursive directory deletion requires recursive=true.", {
    type: "object",
    properties: { path: { type: "string" }, recursive: { type: "boolean" } },
    required: ["path"],
    additionalProperties: false,
  }),
  functionTool("git_stage", "Stage selected workspace paths.", pathArraySchema()),
  functionTool("git_unstage", "Unstage selected workspace paths without discarding working-tree changes.", pathArraySchema()),
  functionTool("git_create_branch", "Create a branch and optionally check it out.", {
    type: "object",
    properties: {
      name: { type: "string" },
      start_point: { type: "string" },
      checkout: { type: "boolean" },
    },
    required: ["name"],
    additionalProperties: false,
  }),
  functionTool("git_checkout_branch", "Check out an existing local branch.", {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  }),
  functionTool("git_commit", "Create a Git commit from the staged index.", {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
    additionalProperties: false,
  }),
  functionTool("git_worktree_add", "Create a Git worktree, optionally with a new branch.", {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or workspace-relative destination." },
      branch: { type: "string", description: "Existing branch to check out." },
      new_branch: { type: "string", description: "New branch to create." },
      start_point: { type: "string" },
    },
    required: ["path"],
    additionalProperties: false,
  }),
  functionTool("terminal_exec", "Execute a bounded one-shot shell command in the workspace and return stdout, stderr, and exit code.", {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
    additionalProperties: false,
  }),
  functionTool("terminal_write", "Write input to an existing integrated terminal shared with the user.", {
    type: "object",
    properties: { terminal_id: { type: "string" }, data: { type: "string" } },
    required: ["terminal_id", "data"],
    additionalProperties: false,
  }),
];

export function toolDefinitionsForPolicy(policy: ToolPolicy): ReadonlyArray<BasicToolDefinition> {
  return policy === "read-only" ? READ_ONLY_TOOLS : [...READ_ONLY_TOOLS, ...MUTATION_TOOLS];
}

export function toolPolicyLimits(policy: ToolPolicy) {
  return POLICY_LIMITS[policy];
}

export async function executeBasicTool(call: ToolCallInput, context: ToolContext): Promise<string> {
  if (context.signal.aborted) throw new DOMException("The tool call was cancelled.", "AbortError");
  const args = parseArguments(call.arguments, context.policy);
  switch (call.name) {
    case "workspace_list": return executeWorkspaceList(args, context);
    case "workspace_search_files": return executeWorkspaceSearchFiles(args, context);
    case "workspace_search_text": return executeWorkspaceSearchText(args, context);
    case "workspace_read_file": return executeWorkspaceRead(args, context);
    case "workspace_write_file": assertMutationPolicy(context.policy); return executeWorkspaceWrite(args, context);
    case "workspace_apply_patch": assertMutationPolicy(context.policy); return executeWorkspacePatch(args, context);
    case "workspace_create_directory": assertMutationPolicy(context.policy); return executeWorkspaceMkdir(args, context);
    case "workspace_move": assertMutationPolicy(context.policy); return executeWorkspaceMove(args, context);
    case "workspace_delete": assertMutationPolicy(context.policy); return executeWorkspaceDelete(args, context);
    case "git_status": return executeGitStatus(context);
    case "git_diff": return executeGitDiff(args, context);
    case "git_log": return executeGitLog(args, context);
    case "git_show": return executeGitShow(args, context);
    case "git_branches": return executeGit(context, ["branch", "--all", "--verbose", "--verbose", "--no-color"]);
    case "git_conflicts": return executeGit(context, ["diff", "--name-only", "--diff-filter=U"]);
    case "git_stage": assertMutationPolicy(context.policy); return executeGitMutation(args, context, "stage");
    case "git_unstage": assertMutationPolicy(context.policy); return executeGitMutation(args, context, "unstage");
    case "git_create_branch": assertMutationPolicy(context.policy); return executeGitCreateBranch(args, context);
    case "git_checkout_branch": assertMutationPolicy(context.policy); return executeGitCheckout(args, context);
    case "git_commit": assertMutationPolicy(context.policy); return executeGitCommit(args, context);
    case "git_worktree_add": assertMutationPolicy(context.policy); return executeGitWorktreeAdd(args, context);
    case "terminal_exec": assertMutationPolicy(context.policy); return executeTerminal(args, context);
    case "terminal_list": return executeTerminalList(context);
    case "terminal_read": return executeTerminalRead(args, context);
    case "terminal_write": assertMutationPolicy(context.policy); return executeTerminalWrite(args, context);
    default: throw new Error(`Unknown tool: ${call.name}`);
  }
}

export function toolCallAudit(call: ToolCallInput, result?: string): {
  detail?: string;
  arguments?: string;
  output?: string;
  exitCode?: number;
  changedFiles?: string[];
} {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(call.arguments || "{}"); } catch { /* surfaced by execution */ }
  const safeArgs = sanitizeAuditArguments(args);
  const detail = summarizeToolCall(call.name, safeArgs);
  if (!result) return { detail, arguments: JSON.stringify(safeArgs, null, 2) };
  let parsed: any;
  try { parsed = JSON.parse(result); } catch { parsed = { output: result }; }
  const output = auditOutput(call.name, args, parsed);
  return {
    detail,
    arguments: JSON.stringify(safeArgs, null, 2),
    output,
    ...(typeof parsed?.exitCode === "number" ? { exitCode: parsed.exitCode } : {}),
    ...(Array.isArray(parsed?.changedFiles) ? { changedFiles: parsed.changedFiles.slice(0, 200) } : {}),
  };
}

async function executeWorkspaceList(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const path = optionalString(args.path, "path");
  const entries = await listWorkspaceDirectory(context.workspace, path);
  const limit = toolPolicyLimits(context.policy).maxListEntries;
  return boundedJson({ path, entries: entries.slice(0, limit), truncated: entries.length > limit }, context.policy);
}

async function executeWorkspaceSearchFiles(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const glob = optionalString(args.glob, "glob");
  const path = optionalString(args.path, "path");
  if (path) await authorizeModelPath(path, context);
  const commandArgs = ["--files", "--hidden", "--glob", "!.git/**"];
  if (glob) commandArgs.push("--glob", glob);
  if (path) commandArgs.push(path);
  const result = await runExecutable("rg", commandArgs, await workspaceRoot(context), context);
  if (result.exitCode !== 0 && result.exitCode !== 1) throw commandFailure("File search", result);
  const files = result.stdout.split(/\r?\n/).filter(Boolean);
  const limit = toolPolicyLimits(context.policy).maxListEntries;
  return boundedJson({ files: files.slice(0, limit), truncated: files.length > limit }, context.policy);
}

async function executeWorkspaceSearchText(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const query = requiredString(args, "query", false);
  const path = optionalString(args.path, "path");
  const glob = optionalString(args.glob, "glob");
  if (path) await authorizeModelPath(path, context);
  const commandArgs = ["--line-number", "--column", "--no-heading", "--color", "never", "--hidden", "--glob", "!.git/**"];
  if (args.case_sensitive !== true) commandArgs.push("--ignore-case");
  if (args.regex !== true) commandArgs.push("--fixed-strings");
  if (glob) commandArgs.push("--glob", glob);
  commandArgs.push("--", query, path || ".");
  const result = await runExecutable("rg", commandArgs, await workspaceRoot(context), context);
  if (result.exitCode !== 0 && result.exitCode !== 1) throw commandFailure("Text search", result);
  const matches = result.stdout.split(/\r?\n/).filter(Boolean);
  const limit = toolPolicyLimits(context.policy).maxListEntries;
  return boundedJson({ matches: matches.slice(0, limit), truncated: matches.length > limit }, context.policy);
}

async function executeWorkspaceRead(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const path = requiredString(args, "path");
  const access = await authorizeModelPath(path, context);
  assertModelReadableExtension(path, context.mode);
  const metadata = await stat(access.path);
  if (!metadata.isFile()) throw new Error("Tool path is not a file.");
  const text = await readFile(access.path, "utf8");
  const lines = text.split(/\r?\n/);
  const start = optionalInteger(args.start_line, "start_line", 1, Math.max(1, lines.length)) ?? 1;
  const end = optionalInteger(args.end_line, "end_line", start, Math.max(start, lines.length)) ?? lines.length;
  const content = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join("\n");
  return boundedText({ path: access.external ? access.path : path, startLine: start, endLine: end, totalLines: lines.length, content }, context.policy);
}

async function executeWorkspaceWrite(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const path = requiredString(args, "path");
  const content = requiredString(args, "content", false);
  assertNotRulesPath(path);
  await approveMutation(context, "file-mutation", `Write ${path}`);
  const access = await authorizeModelPath(path, context);
  let original = "";
  let existed = false;
  try { original = await readFile(access.path, "utf8"); existed = true; } catch (error: any) { if (error?.code !== "ENOENT") throw error; }
  await mkdir(resolve(access.path, ".."), { recursive: true });
  await writeFile(access.path, content, "utf8");
  return boundedJson({
    path,
    operation: existed ? "replace" : "create",
    writtenCharacters: content.length,
    diff: createTextDiff(path, original, content),
    changedFiles: [path],
  }, context.policy);
}

async function executeWorkspacePatch(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const path = requiredString(args, "path");
  const oldText = requiredString(args, "old_text", false);
  const newText = requiredString(args, "new_text", false);
  if (!oldText) throw new Error("old_text must not be empty.");
  assertNotRulesPath(path);
  const access = await authorizeModelPath(path, context);
  const original = await readFile(access.path, "utf8");
  const occurrences = countOccurrences(original, oldText);
  if (!occurrences) throw new Error("old_text was not found; the file was not changed.");
  if (occurrences > 1 && args.replace_all !== true) throw new Error(`old_text matched ${occurrences} times; provide a more specific fragment or set replace_all=true.`);
  await approveMutation(context, "file-mutation", `Patch ${path} (${args.replace_all === true ? occurrences : 1} replacement${occurrences === 1 ? "" : "s"})`);
  const next = args.replace_all === true ? original.split(oldText).join(newText) : original.replace(oldText, newText);
  await writeFile(access.path, next, "utf8");
  return boundedJson({
    path,
    replacements: args.replace_all === true ? occurrences : 1,
    diff: createTextDiff(path, original, next),
    changedFiles: [path],
  }, context.policy);
}

async function executeWorkspaceMkdir(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const path = requiredString(args, "path");
  assertNotRulesPath(path);
  await approveMutation(context, "file-mutation", `Create directory ${path}`);
  const access = await authorizeModelPath(path, context);
  await mkdir(access.path, { recursive: true });
  return boundedJson({ path, changedFiles: [path] }, context.policy);
}

async function executeWorkspaceMove(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const from = requiredString(args, "from");
  const to = requiredString(args, "to");
  assertNotRulesPath(from);
  assertNotRulesPath(to);
  await approveMutation(context, "file-mutation", `Move ${from} to ${to}`);
  const source = await authorizeModelPath(from, context);
  const target = await authorizeModelPath(to, context);
  await mkdir(resolve(target.path, ".."), { recursive: true });
  try { await stat(target.path); throw new Error("Move destination already exists."); } catch (error: any) { if (error?.code !== "ENOENT") throw error; }
  await rename(source.path, target.path);
  return boundedJson({ from, to, changedFiles: [from, to] }, context.policy);
}

async function executeWorkspaceDelete(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const path = requiredString(args, "path");
  assertNotRulesPath(path);
  await approveMutation(context, "file-mutation", `Delete ${path}${args.recursive === true ? " recursively" : ""}`);
  const access = await authorizeModelPath(path, context);
  const root = await workspaceRoot(context);
  if (access.path === root) throw new Error("The workspace root cannot be deleted.");
  await rm(access.path, { recursive: args.recursive === true, force: false });
  return boundedJson({ path, deleted: true, changedFiles: [path] }, context.policy);
}

async function executeGitStatus(context: ToolContext): Promise<string> {
  const status = await runGit(context, ["status", "--short", "--branch"]);
  const conflicts = await runGit(context, ["diff", "--name-only", "--diff-filter=U"]);
  return boundedJson({ output: status.stdout, conflicts: conflicts.stdout.split(/\r?\n/).filter(Boolean), exitCode: status.exitCode }, context.policy);
}

async function executeGitDiff(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const path = optionalString(args.path, "path");
  if (path) assertWorkspaceRelative(path);
  const contextLines = optionalInteger(args.context, "context", 0, 100) ?? 3;
  const commandArgs = ["diff", "--no-ext-diff", `--unified=${contextLines}`];
  if (args.staged === true) commandArgs.push("--cached");
  if (path) commandArgs.push("--", path);
  return executeGit(context, commandArgs);
}

async function executeGitLog(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const limit = optionalInteger(args.limit, "limit", 1, 200) ?? 30;
  return executeGit(context, ["log", `-${limit}`, "--date=iso-strict", "--pretty=format:%H%x09%an%x09%ad%x09%s"]);
}

async function executeGitShow(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const revision = validateRevision(requiredString(args, "revision"));
  const path = optionalString(args.path, "path");
  if (path) assertWorkspaceRelative(path);
  return executeGit(context, ["show", "--no-ext-diff", "--stat", "--patch", revision, ...(path ? ["--", path] : [])]);
}

async function executeGitMutation(args: Record<string, unknown>, context: ToolContext, operation: "stage" | "unstage"): Promise<string> {
  const paths = requiredPathArray(args.paths);
  await approveMutation(context, "git-mutation", `${operation === "stage" ? "Stage" : "Unstage"} ${paths.join(", ")}`);
  const commandArgs = operation === "stage" ? ["add", "--", ...paths] : ["reset", "--", ...paths];
  const result = await runGit(context, commandArgs);
  if (result.exitCode !== 0) throw commandFailure(`Git ${operation}`, result);
  return boundedJson({ operation, paths, output: result.stdout, stderr: result.stderr, exitCode: result.exitCode, changedFiles: paths }, context.policy);
}

async function executeGitCreateBranch(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const name = await validateBranch(requiredString(args, "name"), context);
  const startPoint = args.start_point === undefined ? "" : validateRevision(requiredString(args, "start_point"));
  const checkout = args.checkout !== false;
  await approveMutation(context, "git-mutation", `${checkout ? "Create and check out" : "Create"} branch ${name}`);
  const result = await runGit(context, [checkout ? "switch" : "branch", ...(checkout ? ["-c"] : []), name, ...(startPoint ? [startPoint] : [])]);
  if (result.exitCode !== 0) throw commandFailure("Create branch", result);
  return boundedJson({ branch: name, checkedOut: checkout, output: result.stdout, stderr: result.stderr, exitCode: result.exitCode }, context.policy);
}

async function executeGitCheckout(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const name = await validateBranch(requiredString(args, "name"), context);
  await approveMutation(context, "git-mutation", `Check out branch ${name}`);
  const result = await runGit(context, ["switch", name]);
  if (result.exitCode !== 0) throw commandFailure("Check out branch", result);
  return boundedJson({ branch: name, output: result.stdout, stderr: result.stderr, exitCode: result.exitCode }, context.policy);
}

async function executeGitCommit(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const message = requiredString(args, "message");
  await approveMutation(context, "git-mutation", `Commit staged changes: ${message}`);
  const result = await runGit(context, ["commit", "-m", message]);
  if (result.exitCode !== 0) throw commandFailure("Git commit", result);
  return boundedJson({ message, output: result.stdout, stderr: result.stderr, exitCode: result.exitCode }, context.policy);
}

async function executeGitWorktreeAdd(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const path = requiredString(args, "path");
  const branch = optionalString(args.branch, "branch");
  const newBranch = optionalString(args.new_branch, "new_branch");
  const startPoint = optionalString(args.start_point, "start_point");
  if (branch && newBranch) throw new Error("Use branch or new_branch, not both.");
  if (branch) await validateBranch(branch, context);
  if (newBranch) await validateBranch(newBranch, context);
  if (startPoint) validateRevision(startPoint);
  const destination = await authorizeModelPath(path, context);
  await approveMutation(context, "git-mutation", `Create worktree at ${destination.path}`);
  const commandArgs = ["worktree", "add", ...(newBranch ? ["-b", newBranch] : []), destination.path, ...(branch ? [branch] : startPoint ? [startPoint] : [])];
  const result = await runGit(context, commandArgs);
  if (result.exitCode !== 0) throw commandFailure("Create worktree", result);
  return boundedJson({ path: destination.path, branch: branch || newBranch || null, output: result.stdout, stderr: result.stderr, exitCode: result.exitCode }, context.policy);
}

async function executeTerminal(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const command = requiredString(args, "command");
  assertCommandDoesNotTargetRules(command);
  await approveMutation(context, "terminal", command);
  const result = await runShell(command, await workspaceRoot(context), context);
  return boundedJson({ command, output: result.stdout, stderr: result.stderr, exitCode: result.exitCode }, context.policy);
}

async function executeTerminalList(context: ToolContext): Promise<string> {
  if (!context.terminal) return boundedJson({ terminals: [], available: false }, context.policy);
  return boundedJson({ terminals: await context.terminal.list(), available: true }, context.policy);
}

async function executeTerminalRead(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  if (!context.terminal) throw new Error("The integrated terminal runtime is unavailable.");
  const id = requiredString(args, "terminal_id");
  const maxCharacters = optionalInteger(args.max_characters, "max_characters", 1, 200_000);
  return boundedJson(await context.terminal.read(id, maxCharacters), context.policy);
}

async function executeTerminalWrite(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  if (!context.terminal) throw new Error("The integrated terminal runtime is unavailable.");
  const id = requiredString(args, "terminal_id");
  const data = requiredString(args, "data", false);
  assertCommandDoesNotTargetRules(data);
  await approveMutation(context, "terminal", `Write to terminal ${id}: ${data.slice(0, 500)}`);
  await context.terminal.write(id, data);
  return boundedJson({ terminalId: id, writtenCharacters: data.length }, context.policy);
}

async function executeGit(context: ToolContext, args: string[]): Promise<string> {
  const result = await runGit(context, args);
  if (result.exitCode !== 0) throw commandFailure("Git command", result);
  return boundedJson({ command: ["git", ...args].join(" "), output: result.stdout, stderr: result.stderr, exitCode: result.exitCode }, context.policy);
}

async function runGit(context: ToolContext, args: string[]): Promise<CommandResult> {
  return runExecutable("git", ["-C", await workspaceRoot(context), ...args], await workspaceRoot(context), context);
}

async function authorizeModelPath(path: string, context: ToolContext): Promise<{ path: string; external: boolean }> {
  const absolute = isAbsolute(path) || /^[a-z]:/i.test(path);
  const unsafeRelative = path.replaceAll("\\", "/").split("/").includes("..");
  const sensitive = isSensitivePath(path);
  if (context.policy === "read-only" && (absolute || unsafeRelative || sensitive)) assertSafeModelPath(path);
  if (context.policy === "auto" && (absolute || unsafeRelative || sensitive)) {
    const approved = await context.requestApproval?.({ kind: "sensitive-path", summary: path });
    if (!approved) throw new Error("The user denied access to this path.");
  }
  if (context.policy === "yolo" && absolute) return { path: resolve(path), external: true };
  if (context.policy === "auto" && absolute) return { path: resolve(path), external: true };
  const root = await workspaceRoot(context);
  const target = resolve(root, path);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) throw new Error("Tool path escapes the current workspace.");
  return { path: target, external: false };
}

async function workspaceRoot(context: ToolContext): Promise<string> {
  if (!context.workspace) throw new Error("Open a workspace before using repository tools.");
  return realpath(context.workspace);
}

async function approveMutation(context: ToolContext, kind: ToolApprovalRequest["kind"], summary: string): Promise<void> {
  if (context.policy !== "auto") return;
  if (!(await context.requestApproval?.({ kind, summary }))) throw new Error("The user denied this tool action.");
}

function assertMutationPolicy(policy: ToolPolicy): void {
  if (policy === "read-only") throw new Error("This tool is disabled by the Read-only policy.");
}

function parseArguments(raw: string, policy: ToolPolicy): Record<string, unknown> {
  if (raw.length > toolPolicyLimits(policy).maxArguments) throw new Error(`Tool arguments exceed the ${policy} policy transport limit.`);
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Arguments must be a JSON object.");
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid tool arguments: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
}

function assertSafeModelPath(path: string): void {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  if (!path || path.startsWith("/") || /^[a-z]:/.test(normalized) || normalized.split("/").includes("..")) throw new Error("Tool paths must be workspace-relative under Read-only policy.");
  if (isSensitivePath(path)) throw new Error("Sensitive files are unavailable under Read-only policy.");
}

function assertWorkspaceRelative(path: string): void {
  const normalized = path.replaceAll("\\", "/");
  if (!path || normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.split("/").includes("..") || normalized.startsWith("-")) throw new Error("Git paths must be workspace-relative.");
}

function assertNotRulesPath(path: string): void {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  if (normalized === ".kv-code/rules.md" || normalized.endsWith("/.kv-code/rules.md")) throw new Error("Rules are user-authored and can only be changed from Settings.");
}

function assertCommandDoesNotTargetRules(command: string): void {
  if (/\.kv-code[\\/]rules\.md/i.test(command)) throw new Error("Terminal tools cannot modify user-authored KV Code rules.");
}

function assertModelReadableExtension(path: string, mode: WorkspaceMode): void {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  if (mode === "code" && ["docx", "doc", "pptx", "ppt", "xlsx", "xls"].includes(extension)) throw new Error("Office document reads are available to the model only in Work Mode.");
  if (["docx", "doc", "pptx", "ppt", "xlsx", "xls", "pdf", "png", "jpg", "jpeg", "gif", "webp", "exe", "dll", "zip"].includes(extension)) throw new Error("This binary format is not readable through the UTF-8 file tool.");
}

function isSensitivePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const basename = normalized.split("/").at(-1) ?? normalized;
  return basename === ".env" || basename.startsWith(".env.") || basename.includes("secret") || basename.includes("credential") || basename === "id_rsa" || basename === "id_ed25519";
}

function requiredString(args: Record<string, unknown>, key: string, trim = true): string {
  const value = args[key];
  if (typeof value !== "string" || (trim ? !value.trim() : value.length === 0)) throw new Error(`Tool argument ${key} is required.`);
  return trim ? value.trim() : value;
}

function optionalString(value: unknown, key: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`Tool argument ${key} must be a string.`);
  return value.trim();
}

function optionalInteger(value: unknown, key: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`Tool argument ${key} must be an integer from ${minimum} to ${maximum}.`);
  return Number(value);
}

function requiredPathArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== "string")) throw new Error("Tool argument paths must be a non-empty string array.");
  return value.map((item) => { const path = String(item).trim(); assertWorkspaceRelative(path); return path; });
}

function countOccurrences(text: string, fragment: string): number {
  let count = 0;
  let position = 0;
  while ((position = text.indexOf(fragment, position)) !== -1) { count += 1; position += fragment.length; }
  return count;
}

function createTextDiff(path: string, before: string, after: string): string {
  if (before === after) return "No textual changes.";
  const oldLines = before.split(/\r?\n/);
  const newLines = after.split(/\r?\n/);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1;
  const contextStart = Math.max(0, prefix - 3);
  const oldChangeEnd = oldLines.length - suffix;
  const newChangeEnd = newLines.length - suffix;
  const oldContextEnd = Math.min(oldLines.length, oldChangeEnd + 3);
  const newContextEnd = Math.min(newLines.length, newChangeEnd + 3);
  const lines = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${contextStart + 1},${oldContextEnd - contextStart} +${contextStart + 1},${newContextEnd - contextStart} @@`,
    ...oldLines.slice(contextStart, prefix).map((line) => ` ${line}`),
    ...oldLines.slice(prefix, oldChangeEnd).map((line) => `-${line}`),
    ...newLines.slice(prefix, newChangeEnd).map((line) => `+${line}`),
    ...newLines.slice(newChangeEnd, newContextEnd).map((line) => ` ${line}`),
  ];
  return lines.join("\n").slice(0, 100_000);
}

async function validateBranch(name: string, context: ToolContext): Promise<string> {
  const result = await runGit(context, ["check-ref-format", "--branch", name]);
  if (result.exitCode !== 0) throw new Error(`Invalid Git branch name: ${name}`);
  return name;
}

function validateRevision(revision: string): string {
  if (!/^[A-Za-z0-9_./@{}~^:+-]+$/.test(revision) || revision.startsWith("-")) throw new Error("Invalid Git revision.");
  return revision;
}

interface CommandResult { stdout: string; stderr: string; exitCode: number; }

function runExecutable(file: string, args: string[], cwd: string, context: ToolContext): Promise<CommandResult> {
  const limits = toolPolicyLimits(context.policy);
  return new Promise((resolvePromise, reject) => {
    execFile(file, args, { cwd, timeout: limits.timeoutMs, maxBuffer: limits.maxResult * 2, windowsHide: true, signal: context.signal }, (error: any, stdout, stderr) => {
      if (error?.name === "AbortError") { reject(error); return; }
      resolvePromise({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0 });
    });
  });
}

function runShell(command: string, cwd: string, context: ToolContext): Promise<CommandResult> {
  const limits = toolPolicyLimits(context.policy);
  return new Promise((resolvePromise, reject) => {
    exec(command, { cwd, timeout: limits.timeoutMs, maxBuffer: limits.maxResult * 2, windowsHide: true, signal: context.signal }, (error: any, stdout, stderr) => {
      if (error?.name === "AbortError") { reject(error); return; }
      resolvePromise({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0 });
    });
  });
}

function commandFailure(label: string, result: CommandResult): Error {
  return new Error(`${label} failed with exit code ${result.exitCode}.${result.stderr ? ` ${result.stderr.slice(0, 2_000)}` : ""}`);
}

function boundedJson(value: unknown, policy: ToolPolicy): string { return boundedText(value, policy); }
function boundedText(value: unknown, policy: ToolPolicy): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const limit = toolPolicyLimits(policy).maxResult;
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[tool output truncated at transport boundary]`;
}

function functionTool(name: string, description: string, parameters: Record<string, unknown>): BasicToolDefinition {
  return { type: "function", function: { name, description, parameters } };
}

function emptyObjectSchema(): Record<string, unknown> { return { type: "object", properties: {}, additionalProperties: false }; }
function pathArraySchema(): Record<string, unknown> {
  return { type: "object", properties: { paths: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["paths"], additionalProperties: false };
}

function sanitizeAuditArguments(args: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "content" || key === "old_text" || key === "new_text" || key === "data") safe[key] = typeof value === "string" ? `[${value.length} characters]` : "[redacted]";
    else if ((key === "path" || key === "from" || key === "to") && typeof value === "string" && isSensitivePath(value)) safe[key] = "sensitive path";
    else safe[key] = value;
  }
  return safe;
}

function summarizeToolCall(name: string, args: Record<string, unknown>): string | undefined {
  if (typeof args.path === "string") return args.path || "workspace root";
  if (typeof args.query === "string") return String(args.query).slice(0, 240);
  if (typeof args.command === "string") return String(args.command).slice(0, 240);
  if (Array.isArray(args.paths)) return args.paths.slice(0, 6).join(", ");
  if (typeof args.from === "string" && typeof args.to === "string") return `${args.from} -> ${args.to}`;
  if (typeof args.name === "string") return args.name;
  if (typeof args.terminal_id === "string") return args.terminal_id;
  return name.startsWith("git_") ? "repository" : undefined;
}

function auditOutput(name: string, rawArgs: Record<string, unknown>, parsed: any): string | undefined {
  if (name === "workspace_read_file" && typeof rawArgs.path === "string" && isSensitivePath(rawArgs.path)) return "Sensitive output omitted from the audit log.";
  const candidate = parsed?.diff ?? parsed?.output ?? parsed?.content ?? parsed?.matches ?? parsed?.files ?? parsed;
  const text = typeof candidate === "string" ? candidate : JSON.stringify(candidate, null, 2);
  return text ? text.slice(0, 12_000) : undefined;
}

export const toolRuntimeLimits = POLICY_LIMITS;

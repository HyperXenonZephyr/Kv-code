import { exec, execFile } from "node:child_process";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { listWorkspaceDirectory, readWorkspaceFile } from "./workspace-files";
import type { ToolPolicy, WorkspaceMode } from "../shared/settings";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const POLICY_LIMITS: Record<ToolPolicy, {
  maxResult: number;
  maxArguments: number;
  maxListEntries: number;
  timeoutMs: number;
  maxRounds: number;
}> = {
  "read-only": { maxResult: 48_000, maxArguments: 8_000, maxListEntries: 500, timeoutMs: 10_000, maxRounds: 4 },
  auto: { maxResult: 96_000, maxArguments: 32_000, maxListEntries: 2_000, timeoutMs: 30_000, maxRounds: 8 },
  yolo: { maxResult: 256_000, maxArguments: 128_000, maxListEntries: 10_000, timeoutMs: 120_000, maxRounds: 16 },
};

export const basicToolDefinitionSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(1_000),
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
}

export interface ToolApprovalRequest {
  kind: "sensitive-path" | "write-file" | "terminal";
  summary: string;
}

export interface ToolCallInput {
  name: string;
  arguments: string;
}

const READ_ONLY_TOOLS: ReadonlyArray<BasicToolDefinition> = [
  {
    type: "function",
    function: {
      name: "workspace_list",
      description: "List files and directories in the current workspace. Paths are relative to the workspace root.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative directory path. Use an empty string for the root." } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_read_file",
      description: "Read a bounded UTF-8 text file from the current workspace. Sensitive files, binaries, and Office files are unavailable in Code Mode.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative file path." } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "Inspect the current repository branch and changed-file status without changing anything.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "Read the current unstaged Git diff without changing anything.",
      parameters: {
        type: "object",
        properties: { staged: { type: "boolean", description: "Read the staged diff instead of the unstaged diff." } },
        additionalProperties: false,
      },
    },
  },
];

const WRITE_TOOLS: ReadonlyArray<BasicToolDefinition> = [
  {
    type: "function",
    function: {
      name: "workspace_write_file",
      description: "Write UTF-8 text to a workspace file. In Auto and YOLO policy only. Never write KV Code rules through this tool.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative path." },
          content: { type: "string", description: "Complete UTF-8 file contents." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "terminal_exec",
      description: "Execute a shell command in the current workspace. In Auto and YOLO policy only.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "Shell command to execute." } },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
];

export function toolDefinitionsForPolicy(policy: ToolPolicy): ReadonlyArray<BasicToolDefinition> {
  return policy === "read-only" ? READ_ONLY_TOOLS : [...READ_ONLY_TOOLS, ...WRITE_TOOLS];
}

export function toolPolicyLimits(policy: ToolPolicy) {
  return POLICY_LIMITS[policy];
}

export async function executeBasicTool(
  call: ToolCallInput,
  context: ToolContext,
): Promise<string> {
  if (context.signal.aborted) throw new DOMException("The tool call was cancelled.", "AbortError");
  const args = parseArguments(call.arguments, context.policy);
  switch (call.name) {
    case "workspace_list":
      return executeWorkspaceList(args, context);
    case "workspace_read_file":
      return executeWorkspaceRead(args, context);
    case "git_status":
      return executeGit(context, ["status", "--short", "--branch"]);
    case "git_diff":
      return executeGit(context, ["diff", "--no-ext-diff", "--unified=3", ...(args.staged === true ? ["--cached"] : [])]);
    case "workspace_write_file":
      assertMutationPolicy(context.policy);
      return executeWorkspaceWrite(args, context);
    case "terminal_exec":
      assertMutationPolicy(context.policy);
      return executeTerminal(args, context);
    default:
      throw new Error(`Unknown tool: ${call.name}`);
  }
}

async function executeWorkspaceList(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const path = optionalString(args.path, "path");
  const entries = await listWorkspaceDirectory(context.workspace, path);
  const limits = toolPolicyLimits(context.policy);
  return boundedJson({ path, entries: entries.slice(0, limits.maxListEntries), truncated: entries.length > limits.maxListEntries }, context.policy);
}

async function executeWorkspaceRead(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const path = requiredString(args, "path");
  const access = await authorizeModelPath(path, context);
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  if (context.mode === "code" && ["docx", "doc", "pptx", "ppt", "xlsx", "xls"].includes(extension)) {
    throw new Error("Office document reads are available only in Work Mode.");
  }
  if (["docx", "doc", "pptx", "ppt", "xlsx", "xls", "pdf", "png", "jpg", "jpeg", "gif", "webp"].includes(extension)) {
    throw new Error("Binary and Office previews are not model-readable through this text tool.");
  }
  if (access.external) {
    const metadata = await stat(access.path);
    if (!metadata.isFile()) throw new Error("Tool path is not a file.");
    return boundedText({ path: access.path, content: await readFile(access.path, "utf8") }, context.policy);
  }
  const file = await readWorkspaceFile(context.workspace, path);
  return boundedText({ path, content: new TextDecoder().decode(file.data) }, context.policy);
}

async function executeWorkspaceWrite(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const path = requiredString(args, "path");
  const content = requiredString(args, "content");
  if (path.replaceAll("\\", "/").toLowerCase().includes(".kv-code/rules.md")) {
    throw new Error("Rules are user-authored and can only be changed from Settings.");
  }
  if (context.policy === "auto" && !(await context.requestApproval?.({ kind: "write-file", summary: path }))) {
    throw new Error("The user denied this file write.");
  }
  const access = await authorizeModelPath(path, context);
  const target = access.path;
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, `${content}\n`, "utf8");
  return boundedText({ path, writtenCharacters: content.length }, context.policy);
}

async function executeTerminal(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const command = requiredString(args, "command");
  if (context.policy === "auto" && !(await context.requestApproval?.({ kind: "terminal", summary: command }))) {
    throw new Error("The user denied this terminal command.");
  }
  const limits = toolPolicyLimits(context.policy);
  const result = await execAsync(command, {
    cwd: await realpath(context.workspace),
    timeout: limits.timeoutMs,
    maxBuffer: limits.maxResult * 2,
    windowsHide: true,
    signal: context.signal,
  });
  return boundedText({ command, output: result.stdout, stderr: result.stderr }, context.policy);
}

async function executeGit(context: ToolContext, args: string[]): Promise<string> {
  const workspace = await realpath(context.workspace);
  const limits = toolPolicyLimits(context.policy);
  const result = await execFileAsync("git", ["-C", workspace, ...args], {
    timeout: limits.timeoutMs,
    maxBuffer: limits.maxResult * 2,
    windowsHide: true,
    signal: context.signal,
  });
  return boundedText({ command: ["git", "-C", workspace, ...args].join(" "), output: result.stdout, stderr: result.stderr }, context.policy);
}

async function authorizeModelPath(path: string, context: ToolContext): Promise<{ path: string; external: boolean }> {
  const invalid = !path || path.startsWith("/") || /^[a-z]:/i.test(path) || path.replaceAll("\\", "/").split("/").includes("..");
  const sensitive = isSensitivePath(path);
  if (context.policy === "yolo") {
    return { path: await resolveToolPath(path, context), external: isAbsolute(path) };
  }
  if ((invalid || sensitive) && context.policy === "read-only") {
    assertSafeModelPath(path);
  }
  if (invalid || sensitive) {
    const approved = await context.requestApproval?.({ kind: "sensitive-path", summary: path });
    if (!approved) throw new Error("The user denied access to this path.");
    if (isAbsolute(path)) return { path: resolve(path), external: true };
  }
  return { path: await resolveToolPath(path, context), external: false };
}

async function resolveToolPath(path: string, context: ToolContext): Promise<string> {
  if (context.policy === "yolo" && isAbsolute(path)) return resolve(path);
  const root = await realpath(context.workspace);
  const target = resolve(root, path);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error("Tool path escapes the current workspace.");
  }
  return target;
}

function assertMutationPolicy(policy: ToolPolicy): void {
  if (policy === "read-only") throw new Error("This tool is disabled by the Read-only policy.");
}

function parseArguments(raw: string, policy: ToolPolicy): Record<string, unknown> {
  if (raw.length > toolPolicyLimits(policy).maxArguments) throw new Error(`Tool arguments exceed the ${policy} policy limit.`);
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
  if (!path || path.startsWith("/") || /^[a-z]:/.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error("Tool paths must be non-empty and relative to the workspace.");
  }
  if (isSensitivePath(path)) {
    throw new Error("Sensitive files are not available to the model under this policy.");
  }
}

function isSensitivePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const basename = normalized.split("/").at(-1) ?? normalized;
  return basename === ".env" || basename.startsWith(".env.") || basename.includes("secret") || basename.includes("credential") || basename === "id_rsa";
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Tool argument ${key} is required.`);
  return value.trim();
}

function optionalString(value: unknown, key: string): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error(`Tool argument ${key} must be a string.`);
  return value.trim();
}

function boundedJson(value: unknown, policy: ToolPolicy): string {
  return boundedText(value, policy);
}

function boundedText(value: unknown, policy: ToolPolicy): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const limit = toolPolicyLimits(policy).maxResult;
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[tool output truncated by policy]`;
}

export const toolRuntimeLimits = POLICY_LIMITS;

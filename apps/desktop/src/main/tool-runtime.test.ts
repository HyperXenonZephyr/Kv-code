import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeBasicTool, toolDefinitionsForPolicy } from "./tool-runtime";

let workspace = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "kv-code-tools-"));
  await writeFile(join(workspace, "main.ts"), "export const answer = 42;\n", "utf8");
  await writeFile(join(workspace, ".env"), "SECRET=do-not-read\n", "utf8");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("basic read-only tools", () => {
  it("lists and reads bounded workspace text", async () => {
    const context = { workspace, mode: "code" as const, policy: "read-only" as const, signal: new AbortController().signal };
    const listing = await executeBasicTool({ name: "workspace_list", arguments: "{}" }, context);
    expect(listing).toContain("main.ts");
    const content = await executeBasicTool({ name: "workspace_read_file", arguments: '{"path":"main.ts"}' }, context);
    expect(content).toContain("export const answer = 42");
  });

  it("rejects secrets and absolute or escaping paths", async () => {
    const context = { workspace, mode: "code" as const, policy: "read-only" as const, signal: new AbortController().signal };
    await expect(executeBasicTool({ name: "workspace_read_file", arguments: '{"path":".env"}' }, context))
      .rejects.toThrow("Sensitive files");
    await expect(executeBasicTool({ name: "workspace_read_file", arguments: '{"path":"../main.ts"}' }, context))
      .rejects.toThrow("relative");
  });

  it("asks in Auto and exposes mutations only outside Read-only", async () => {
    const approvals: string[] = [];
    const context = {
      workspace,
      mode: "code" as const,
      policy: "auto" as const,
      signal: new AbortController().signal,
      requestApproval: async (request: { kind: "sensitive-path" | "file-mutation" | "git-mutation" | "terminal"; summary: string }) => {
        approvals.push(request.kind);
        return true;
      },
    };
    const secret = await executeBasicTool({ name: "workspace_read_file", arguments: '{"path":".env"}' }, context);
    expect(secret).toContain("do-not-read");
    expect(approvals).toEqual(["sensitive-path"]);
    expect(toolDefinitionsForPolicy("read-only").map((tool) => tool.function.name)).not.toContain("terminal_exec");
    expect(toolDefinitionsForPolicy("yolo").map((tool) => tool.function.name)).toContain("terminal_exec");
  });

  it("searches, reads line ranges, and records precise text patches", async () => {
    const signal = new AbortController().signal;
    const readOnly = { workspace, mode: "code" as const, policy: "read-only" as const, signal };
    const matches = await executeBasicTool({
      name: "workspace_search_text",
      arguments: '{"query":"answer","glob":"*.ts"}',
    }, readOnly);
    expect(matches).toContain("main.ts:1");
    const range = await executeBasicTool({
      name: "workspace_read_file",
      arguments: '{"path":"main.ts","start_line":1,"end_line":1}',
    }, readOnly);
    expect(range).toContain('"startLine": 1');

    const auto = {
      ...readOnly,
      policy: "auto" as const,
      requestApproval: async () => true,
    };
    const patched = await executeBasicTool({
      name: "workspace_apply_patch",
      arguments: '{"path":"main.ts","old_text":"answer = 42","new_text":"answer = 43"}',
    }, auto);
    expect(patched).toContain("-export const answer = 42");
    expect(patched).toContain("+export const answer = 43");
    expect(await readFile(join(workspace, "main.ts"), "utf8")).toContain("answer = 43");
  });

  it("supports structured Git inspection and approved mutations", async () => {
    execFileSync("git", ["init"], { cwd: workspace });
    execFileSync("git", ["config", "user.email", "test@kv-code.invalid"], { cwd: workspace });
    execFileSync("git", ["config", "user.name", "KV Code Test"], { cwd: workspace });
    execFileSync("git", ["add", "main.ts"], { cwd: workspace });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: workspace });
    await writeFile(join(workspace, "main.ts"), "export const answer = 43;\n", "utf8");

    const approvals: string[] = [];
    const context = {
      workspace,
      mode: "code" as const,
      policy: "auto" as const,
      signal: new AbortController().signal,
      requestApproval: async (request: { kind: "sensitive-path" | "file-mutation" | "git-mutation" | "terminal" }) => {
        approvals.push(request.kind);
        return true;
      },
    };
    expect(await executeBasicTool({ name: "git_diff", arguments: "{}" }, context)).toContain("answer = 43");
    await executeBasicTool({ name: "git_stage", arguments: '{"paths":["main.ts"]}' }, context);
    expect(await executeBasicTool({ name: "git_status", arguments: "{}" }, context)).toContain("M  main.ts");
    await executeBasicTool({ name: "git_commit", arguments: '{"message":"update answer"}' }, context);
    await executeBasicTool({ name: "git_create_branch", arguments: '{"name":"feature/test","checkout":false}' }, context);
    const log = await executeBasicTool({ name: "git_log", arguments: '{"limit":2}' }, context);
    expect(log).toContain("update answer");
    expect(await executeBasicTool({ name: "git_branches", arguments: "{}" }, context)).toContain("feature/test");
    expect(approvals).toEqual(["git-mutation", "git-mutation", "git-mutation"]);
  });
});

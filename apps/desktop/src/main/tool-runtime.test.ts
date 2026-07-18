import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
      requestApproval: async (request: { kind: "sensitive-path" | "write-file" | "terminal"; summary: string }) => {
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
});

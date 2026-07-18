import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listWorkspaceDirectory, readWorkspaceFile } from "./workspace-files";

let workspace = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "kv-code-workspace-"));
  await mkdir(join(workspace, "documents"));
  await writeFile(join(workspace, "documents", "sample.docx"), "sample");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("workspace files", () => {
  it("lists lazily, reads relative files, and rejects paths outside the workspace", async () => {
    expect(await listWorkspaceDirectory(workspace, "")).toEqual([
      {
        name: "documents",
        path: "documents",
        kind: "directory",
        extension: "",
      },
    ]);
    const file = await readWorkspaceFile(workspace, "documents/sample.docx");
    expect({ ...file, data: new TextDecoder().decode(file.data) }).toEqual({
      name: "sample.docx",
      path: "documents/sample.docx",
      extension: "docx",
      data: "sample",
    });
    await expect(readWorkspaceFile(workspace, "../outside.docx")).rejects.toThrow();
    await expect(readWorkspaceFile(workspace, join(workspace, "documents", "sample.docx"))).rejects.toThrow();
  });
});

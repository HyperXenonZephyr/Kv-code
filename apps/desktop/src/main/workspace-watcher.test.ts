import { unlink } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceChange } from "../shared/workspace-files";
import { watchWorkspace } from "./workspace-watcher";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspace = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "kv-code-watcher-"));
  await mkdir(join(workspace, "documents"));
  await writeFile(join(workspace, "documents", "active.md"), "# Active");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("workspace watcher", () => {
  it("reports when the currently visible file is deleted", async () => {
    let resolveChange: (change: WorkspaceChange) => void = () => {};
    const changed = new Promise<WorkspaceChange>((resolve) => {
      resolveChange = resolve;
    });
    const close = await watchWorkspace(workspace, (change) => {
      if (change.path === "documents/active.md" && !change.exists) {
        resolveChange(change);
      }
    });

    try {
      await unlink(join(workspace, "documents", "active.md"));
      await expect(withTimeout(changed)).resolves.toEqual({
        workspace,
        path: "documents/active.md",
        eventType: "rename",
        exists: false,
      });
    } finally {
      close();
    }
  });
});

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error("Workspace change was not reported.")), 5_000);
    }),
  ]);
}

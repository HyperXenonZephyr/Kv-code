import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TerminalManager } from "./terminal-manager";

let workspace = "";
let manager: TerminalManager | null = null;

afterEach(async () => {
  manager?.dispose();
  manager = null;
  if (workspace) await rm(workspace, { recursive: true, force: true });
  workspace = "";
});

describe("integrated PTY terminal", () => {
  it("creates a session, accepts input, and exposes output", async () => {
    workspace = await mkdtemp(join(tmpdir(), "kv-code-pty-"));
    manager = new TerminalManager(() => {});
    const session = await manager.create(workspace, process.platform === "win32" ? process.env.COMSPEC : undefined);

    expect(session.running).toBe(true);
    expect((await manager.list(workspace)).map((item) => item.id)).toContain(session.id);

    await new Promise((resolve) => setTimeout(resolve, 750));

    const command = process.platform === "win32"
      ? 'echo KV_PTY_OK\r\n'
      : 'printf "KV_PTY_OK\\n"\n';
    await manager.write(session.id, command);

    let output = "";
    try {
      for (let attempt = 0; attempt < 30 && !output.includes("KV_PTY_OK"); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        output = (await manager.read(session.id)).output;
      }
    } finally {
      await manager.close(session.id);
    }
    expect(output).toContain("KV_PTY_OK");
    expect(await manager.list(workspace)).toEqual([]);
  }, 10_000);
});

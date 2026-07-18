import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({ userDataPath: "" }));

vi.mock("electron", () => ({
  app: {
    getPath: () => electronState.userDataPath,
  },
}));

import { RulesStore } from "./rules-store";

let temporaryDirectory = "";
let workspaceDirectory = "";

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "kv-code-rules-"));
  workspaceDirectory = await mkdtemp(join(tmpdir(), "kv-code-rules-project-"));
  electronState.userDataPath = temporaryDirectory;
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
  await rm(workspaceDirectory, { recursive: true, force: true });
});

describe("rules store", () => {
  it("keeps global and project rules separate and resolves them in order", async () => {
    const store = new RulesStore();
    await store.load();
    await store.save({ workspace: workspaceDirectory, scope: "global", content: "Be factual." });
    await mkdir(join(workspaceDirectory, ".git", "info"), { recursive: true });
    await store.save({ workspace: workspaceDirectory, scope: "project", content: "Run focused tests." });

    const snapshot = await store.read(workspaceDirectory);
    expect(snapshot.global.content).toBe("Be factual.\n");
    expect(snapshot.project.content).toBe("Run focused tests.\n");
    expect(snapshot.resolvedContent.indexOf("<global_rules")).toBeLessThan(
      snapshot.resolvedContent.indexOf("<project_rules"),
    );
    expect(await readFile(join(workspaceDirectory, ".kv-code", "rules.md"), "utf8"))
      .toBe("Run focused tests.\n");
    expect(await readFile(join(workspaceDirectory, ".git", "info", "exclude"), "utf8"))
      .toContain(".kv-code/");
  });

  it("removes empty rules and reports missing sources", async () => {
    const store = new RulesStore();
    await store.load();
    await store.save({ workspace: workspaceDirectory, scope: "global", content: "   " });
    const snapshot = await store.read(workspaceDirectory);
    expect(snapshot.global.exists).toBe(false);
    expect(snapshot.global.loadStatus).toBe("missing");
    expect(snapshot.resolvedContent).toBe("");
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../shared/conversations";

const electronState = vi.hoisted(() => ({ userDataPath: "" }));

vi.mock("electron", () => ({
  app: {
    getPath: () => electronState.userDataPath,
  },
}));

import { ConversationStore } from "./conversation-store";

let temporaryDirectory = "";

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "kv-code-conversations-"));
  electronState.userDataPath = temporaryDirectory;
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("conversation store", () => {
  it("isolates workspaces and does not evict conversations after fifty", async () => {
    const store = new ConversationStore();
    await store.load();

    for (let index = 0; index < 51; index += 1) {
      await store.save(conversation(`project_a_${index}`, "D:\\project-a", index));
    }
    await store.save(conversation("project_b", "D:\\project-b", 100));

    const projectA = await store.list("d:/PROJECT-A");
    const projectB = await store.list("D:\\project-b");
    expect(projectA).toHaveLength(51);
    expect(projectA.map(({ id }) => id)).toContain("project_a_0");
    expect(projectB.map(({ id }) => id)).toEqual(["project_b"]);
    await expect(store.read("D:\\project-b", "project_a_0")).rejects.toThrow();
  });
});

function conversation(id: string, workspace: string, updatedAt: number): Conversation {
  return {
    id,
    title: id,
    providerId: "provider",
    workspace,
    mode: "code",
    createdAt: updatedAt,
    updatedAt,
    contextSummary: "",
    summarizedMessageCount: 0,
    messages: [],
  };
}

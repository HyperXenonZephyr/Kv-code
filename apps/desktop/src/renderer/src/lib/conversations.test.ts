import { describe, expect, it } from "vitest";
import type { Conversation, ConversationMessage } from "../../../shared/conversations";
import { modelContext, nextCompactionChunk, storableMessages } from "./conversations";

function message(index: number, state: ConversationMessage["state"] = "complete") {
  return {
    id: `message_${index}`,
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `message ${index}`,
    state,
  };
}

function conversation(messages: ConversationMessage[]): Conversation {
  return {
    id: "conversation_test",
    title: "Test",
    providerId: "provider_test",
    workspace: "D:\\project",
    mode: "code",
    createdAt: 1,
    updatedAt: 1,
    contextSummary: "",
    summarizedMessageCount: 0,
    messages,
  };
}

describe("conversation context", () => {
  it("plans compaction for the old prefix without mutating full history", () => {
    const history = Array.from({ length: 60 }, (_, index) => message(index));
    const current = conversation(history);

    const plan = nextCompactionChunk(current);

    expect(plan).toEqual({ end: 48, messages: history.slice(0, 48) });
    expect(current.messages).toEqual(history);
  });

  it("combines the rolling summary with recent usable messages", () => {
    const current = {
      ...conversation([
        message(0),
        message(1),
        message(2, "error"),
        message(3),
      ]),
      contextSummary: "Earlier decisions",
      summarizedMessageCount: 2,
    };

    expect(modelContext(current)).toEqual([
      {
        role: "user",
        content: "Summary of earlier conversation history:\n<conversation_summary>\nEarlier decisions\n</conversation_summary>",
      },
      { role: "assistant", content: "message 3" },
    ]);
  });

  it("persists tool audit metadata without adding it to model context", () => {
    const stored = storableMessages([{
      id: "assistant_audit",
      role: "assistant",
      content: "Final answer",
      state: "complete",
      toolProgress: ["I will inspect the file."],
      toolEvents: [{
        callId: "call_1",
        name: "workspace_read_file",
        status: "completed",
        detail: "README.md",
      }],
    }]);

    expect(stored[0]?.toolProgress).toEqual(["I will inspect the file."]);
    expect(stored[0]?.toolEvents).toEqual([
      expect.objectContaining({ name: "workspace_read_file", status: "completed" }),
    ]);
    expect(modelContext(conversation(stored))).toEqual([
      { role: "assistant", content: "Final answer" },
    ]);
  });
});

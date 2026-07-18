import type { ChatMessage } from "../../../shared/providers";
import type { WorkspaceMode } from "../../../shared/settings";
import type {
  Conversation,
  ConversationMessage,
  ConversationToolActivity,
} from "../../../shared/conversations";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  state: "complete" | "streaming" | "cancelled" | "error";
  toolProgress?: string[];
  toolEvents?: ConversationToolActivity[];
}

const COMPACTION_TRIGGER_CHARACTERS = 160_000;
const COMPACTION_TRIGGER_MESSAGES = 56;
const COMPACTION_CHUNK_CHARACTERS = 110_000;
const COMPACTION_CHUNK_MESSAGES = 48;
const RECENT_MESSAGES_TO_KEEP = 12;
const MODEL_CONTEXT_CHARACTERS = 190_000;
const MODEL_CONTEXT_MESSAGES = 63;

export function createConversation(
  workspace: string,
  providerId: string,
  mode: WorkspaceMode,
  title: string,
): Conversation {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    providerId,
    workspace,
    mode,
    createdAt: now,
    updatedAt: now,
    contextSummary: "",
    summarizedMessageCount: 0,
    messages: [],
  };
}

export function storableMessages(
  messages: readonly UiMessage[],
): ConversationMessage[] {
  return messages.flatMap((message) =>
    message.state === "streaming"
      ? []
      : [{
          id: message.id,
          role: message.role,
          content: message.content,
          state: message.state,
          ...(message.toolProgress?.length ? { toolProgress: message.toolProgress } : {}),
          ...(message.toolEvents?.length ? { toolEvents: message.toolEvents } : {}),
        }],
  );
}

export function titleFrom(content: string): string {
  const title = content.replace(/\s+/g, " ").trim();
  return title.slice(0, 80) || "New session";
}

export function nextCompactionChunk(conversation: Conversation): {
  end: number;
  messages: ConversationMessage[];
} | null {
  const start = conversation.summarizedMessageCount;
  const unsummarized = conversation.messages.slice(start);
  const characters = unsummarized.reduce(
    (total, message) => total + message.content.length,
    0,
  );
  if (
    unsummarized.length <= COMPACTION_TRIGGER_MESSAGES &&
    characters <= COMPACTION_TRIGGER_CHARACTERS
  ) {
    return null;
  }

  const recentCount = characters > COMPACTION_TRIGGER_CHARACTERS
    ? Math.min(6, RECENT_MESSAGES_TO_KEEP)
    : RECENT_MESSAGES_TO_KEEP;
  const latestStart = Math.max(start, conversation.messages.length - recentCount);
  if (latestStart <= start) return null;

  let end = start;
  let chunkCharacters = 0;
  while (end < latestStart && end - start < COMPACTION_CHUNK_MESSAGES) {
    const nextLength = conversation.messages[end]?.content.length ?? 0;
    if (end > start && chunkCharacters + nextLength > COMPACTION_CHUNK_CHARACTERS) break;
    chunkCharacters += nextLength;
    end += 1;
  }
  if (end === start) end = Math.min(start + 1, latestStart);
  return { end, messages: conversation.messages.slice(start, end) };
}

export function modelContext(conversation: Conversation): ChatMessage[] {
  const result: ChatMessage[] = [];
  let characters = 0;
  const recent: ChatMessage[] = [];
  const available = conversation.messages
    .slice(conversation.summarizedMessageCount)
    .filter((message) => message.content && message.state !== "error");

  for (let index = available.length - 1; index >= 0; index -= 1) {
    const message = available[index];
    if (!message) continue;
    if (
      recent.length >= MODEL_CONTEXT_MESSAGES ||
      characters + message.content.length > MODEL_CONTEXT_CHARACTERS
    ) {
      break;
    }
    recent.unshift({ role: message.role, content: message.content });
    characters += message.content.length;
  }

  if (conversation.contextSummary) {
    result.push({
      role: "user",
      content: `Summary of earlier conversation history:\n<conversation_summary>\n${conversation.contextSummary}\n</conversation_summary>`,
    });
  }
  result.push(...recent);
  return result;
}

export function formatSessionTime(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

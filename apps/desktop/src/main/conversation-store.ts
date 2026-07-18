import { app } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  conversationSchema,
  conversationIdSchema,
  conversationSummarySchema,
  type Conversation,
  type ConversationSummary,
} from "../shared/conversations";

const INDEX_FILE = "index.json";
const MAX_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_CONVERSATION_BYTES = 256 * 1024 * 1024;
const indexSchema = z.array(conversationSummarySchema);

export class ConversationStore {
  readonly #rootPath: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.#rootPath = join(app.getPath("userData"), "conversations");
  }

  async load(): Promise<void> {
    await mkdir(this.#rootPath, { recursive: true });
  }

  async list(workspace: string): Promise<ConversationSummary[]> {
    return this.#readIndex(workspace);
  }

  async read(workspace: string, conversationId: string): Promise<Conversation> {
    const id = conversationIdSchema.parse(conversationId);
    const path = join(this.#workspacePath(workspace), `${id}.json`);
    await assertFileSize(path, MAX_CONVERSATION_BYTES);
    const conversation = conversationSchema.parse(JSON.parse(await readFile(path, "utf8")));
    if (workspaceKey(conversation.workspace) !== workspaceKey(workspace)) {
      throw new Error("Conversation belongs to a different workspace.");
    }
    return conversation;
  }

  async save(rawConversation: Conversation): Promise<ConversationSummary[]> {
    const conversation = conversationSchema.parse(rawConversation);
    return this.#enqueue(async () => {
      const workspacePath = this.#workspacePath(conversation.workspace);
      await mkdir(workspacePath, { recursive: true });
      await writeJsonAtomic(
        join(workspacePath, `${conversation.id}.json`),
        conversation,
      );

      const summary = summarize(conversation);
      const index = (await this.#readIndex(conversation.workspace))
        .filter((candidate) => candidate.id !== conversation.id);
      const next = [summary, ...index].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      );
      await writeJsonAtomic(join(workspacePath, INDEX_FILE), next);
      return next;
    });
  }

  async remove(
    workspace: string,
    conversationId: string,
  ): Promise<ConversationSummary[]> {
    const id = conversationIdSchema.parse(conversationId);
    return this.#enqueue(async () => {
      const workspacePath = this.#workspacePath(workspace);
      try {
        await unlink(join(workspacePath, `${id}.json`));
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
      const next = (await this.#readIndex(workspace)).filter(
        (conversation) => conversation.id !== id,
      );
      await writeJsonAtomic(join(workspacePath, INDEX_FILE), next);
      return next;
    });
  }

  #workspacePath(workspace: string): string {
    return join(this.#rootPath, workspaceKey(workspace));
  }

  async #readIndex(workspace: string): Promise<ConversationSummary[]> {
    const path = join(this.#workspacePath(workspace), INDEX_FILE);
    try {
      await assertFileSize(path, MAX_INDEX_BYTES);
      return indexSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (!isMissingFile(error)) console.error("Failed to load conversation index.", error);
      return [];
    }
  }

  async #enqueue<T>(write: () => Promise<T>): Promise<T> {
    const result = this.#writeQueue.catch(() => undefined).then(write);
    this.#writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function summarize({ messages, ...conversation }: Conversation): ConversationSummary {
  return { ...conversation, messageCount: messages.length };
}

function workspaceKey(workspace: string): string {
  const normalized = process.platform === "win32"
    ? workspace.replaceAll("/", "\\").toLowerCase()
    : workspace;
  return createHash("sha256").update(normalized || "global").digest("hex");
}

async function assertFileSize(path: string, maximum: number): Promise<void> {
  const metadata = await stat(path);
  if (metadata.size > maximum) throw new Error("Conversation data file is too large.");
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

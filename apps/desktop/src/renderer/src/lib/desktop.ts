import {
  appSettingsSchema,
  defaultSettings,
  type AppSettings,
  type KvDesktopApi,
} from "../../../shared/settings";
import {
  providerSaveInputSchema,
  providerSummarySchema,
  type ChatEvent,
  type ProviderSummary,
} from "../../../shared/providers";
import {
  conversationSchema,
  type Conversation,
  type ConversationSummary,
} from "../../../shared/conversations";
import {
  rulesSaveRequestSchema,
  rulesSnapshotSchema,
  type RulesReadRequest,
  type RulesSaveRequest,
  type RulesSnapshot,
} from "../../../shared/rules";

const PREVIEW_SETTINGS_KEY = "kv-code-preview-settings";
const PREVIEW_PROVIDERS_KEY = "kv-code-preview-providers";
const PREVIEW_CONVERSATIONS_KEY = "kv-code-preview-conversations";
const PREVIEW_RULES_KEY = "kv-code-preview-rules";
const previewChatListeners = new Set<(event: ChatEvent) => void>();

function readPreviewProviders(): ProviderSummary[] {
  try {
    const stored = JSON.parse(localStorage.getItem(PREVIEW_PROVIDERS_KEY) ?? "[]");
    return providerSummarySchema.array().parse(stored);
  } catch {
    return [];
  }
}

function readPreviewConversations(): Conversation[] {
  try {
    return conversationSchema.array().parse(
      JSON.parse(localStorage.getItem(PREVIEW_CONVERSATIONS_KEY) ?? "[]"),
    );
  } catch {
    return [];
  }
}

function readPreviewRules(): RulesSaveRequest[] {
  try {
    return rulesSaveRequestSchema.array().parse(
      JSON.parse(localStorage.getItem(PREVIEW_RULES_KEY) ?? "[]"),
    );
  } catch {
    return [];
  }
}

function previewSummaries(
  conversations: Conversation[],
  workspace: string,
): ConversationSummary[] {
  return conversations
    .filter((conversation) => conversation.workspace === workspace)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(({ messages, ...conversation }) => ({
      ...conversation,
      messageCount: messages.length,
    }));
}

const previewApi: KvDesktopApi = {
  async readSettings() {
    const stored = localStorage.getItem(PREVIEW_SETTINGS_KEY);
    if (!stored) return defaultSettings;
    try {
      return appSettingsSchema.parse({ ...defaultSettings, ...JSON.parse(stored) });
    } catch {
      return defaultSettings;
    }
  },
  async updateSettings(patch) {
    const current = await this.readSettings();
    const next = appSettingsSchema.parse({ ...current, ...patch });
    localStorage.setItem(PREVIEW_SETTINGS_KEY, JSON.stringify(next));
    return next;
  },
  async listProviders() {
    return readPreviewProviders();
  },
  async saveProvider(rawInput) {
    const input = providerSaveInputSchema.parse(rawInput);
    const { apiKey, ...provider } = input;
    const providers = readPreviewProviders();
    const summary = {
      ...provider,
      hasApiKey: Boolean(apiKey?.trim()) || providers.some(
        (candidate) => candidate.id === provider.id && candidate.hasApiKey,
      ),
    };
    const next = [
      ...providers.filter((candidate) => candidate.id !== provider.id),
      summary,
    ];
    localStorage.setItem(PREVIEW_PROVIDERS_KEY, JSON.stringify(next));
    return next;
  },
  async removeProvider(providerId) {
    const next = readPreviewProviders().filter((provider) => provider.id !== providerId);
    localStorage.setItem(PREVIEW_PROVIDERS_KEY, JSON.stringify(next));
    return next;
  },
  async testProvider() {
    return {
      ok: false,
      message: "Connection tests require the Electron desktop runtime.",
      latencyMs: 0,
    };
  },
  async startChat(request) {
    queueMicrotask(() => {
      const event: ChatEvent = {
        type: "error",
        turnId: request.turnId,
        message: "Chat requests require the Electron desktop runtime.",
      };
      for (const listener of previewChatListeners) listener(event);
    });
    return { turnId: request.turnId };
  },
  async cancelChat() {
    return false;
  },
  onChatEvent(listener) {
    previewChatListeners.add(listener);
    return () => previewChatListeners.delete(listener);
  },
  async listConversations(workspace) {
    return previewSummaries(readPreviewConversations(), workspace);
  },
  async readConversation(workspace, conversationId) {
    const conversation = readPreviewConversations().find(
      (candidate) => candidate.workspace === workspace && candidate.id === conversationId,
    );
    if (!conversation) throw new Error("Conversation not found.");
    return conversation;
  },
  async saveConversation(rawConversation) {
    const conversation = conversationSchema.parse(rawConversation);
    const conversations = [
      conversation,
      ...readPreviewConversations().filter(
        (candidate) => candidate.id !== conversation.id,
      ),
    ];
    localStorage.setItem(PREVIEW_CONVERSATIONS_KEY, JSON.stringify(conversations));
    return previewSummaries(conversations, conversation.workspace);
  },
  async removeConversation(workspace, conversationId) {
    const conversations = readPreviewConversations().filter(
      (conversation) => conversation.id !== conversationId,
    );
    localStorage.setItem(PREVIEW_CONVERSATIONS_KEY, JSON.stringify(conversations));
    return previewSummaries(conversations, workspace);
  },
  async compactConversation() {
    throw new Error("Context compaction requires the Electron desktop runtime.");
  },
  async readRules(request: RulesReadRequest) {
    const rules = readPreviewRules();
    const global = rules.find((rule) => rule.scope === "global");
    const project = rules.find((rule) => rule.scope === "project" && rule.workspace === request.workspace);
    return rulesSnapshotSchema.parse({
      global: previewRuleDocument("global", global?.content ?? "", "preview/global.md"),
      project: previewRuleDocument("project", project?.content ?? "", "preview/project/rules.md"),
      resolvedContent: previewResolvedRules(global?.content ?? "", project?.content ?? ""),
    });
  },
  async saveRules(rawRequest: RulesSaveRequest) {
    const request = rulesSaveRequestSchema.parse(rawRequest);
    const current = readPreviewRules().filter((rule) =>
      !(rule.scope === request.scope && (request.scope === "global" || rule.workspace === request.workspace)),
    );
    if (request.content.trim()) current.unshift(request);
    localStorage.setItem(PREVIEW_RULES_KEY, JSON.stringify(current));
    return this.readRules(request);
  },
  async listWorkspaceDirectory() {
    return [];
  },
  async readWorkspaceFile() {
    throw new Error("File preview requires the Electron desktop runtime.");
  },
  async registerInlineDocument() {
    throw new Error("Interactive previews require the Electron desktop runtime.");
  },
  async removeInlineDocument() {},
  async watchWorkspace() {},
  async unwatchWorkspace() {},
  onWorkspaceChanged() {
    return () => {};
  },
  async listTerminals() {
    return [];
  },
  async createTerminal() {
    throw new Error("Integrated terminals require the Electron desktop runtime.");
  },
  async writeTerminal() {},
  async resizeTerminal() {},
  async readTerminal() {
    throw new Error("Integrated terminals require the Electron desktop runtime.");
  },
  async closeTerminal() {},
  onTerminalEvent() {
    return () => {};
  },
  async chooseDirectory() {
    return null;
  },
  async systemInfo() {
    return {
      platform: "win32",
      architecture: "x64",
      homeDirectory: "",
      appVersion: "0.1.0-preview",
    };
  },
  async minimizeWindow() {},
  async toggleMaximizeWindow() {
    return false;
  },
  async pulseUltraWindow() {
    return false;
  },
  async closeWindow() {},
};

function previewRuleDocument(
  scope: "global" | "project",
  content: string,
  path: string,
) {
  return {
    scope,
    path,
    content,
    exists: Boolean(content.trim()),
    updatedAt: content ? Date.now() : null,
    loadStatus: content ? "loaded" : "missing",
  } as const;
}

function previewResolvedRules(global: string, project: string): string {
  return [
    global.trim() ? `<global_rules source="preview/global.md">\n${global.trim()}\n</global_rules>` : "",
    project.trim() ? `<project_rules source="preview/project/rules.md">\n${project.trim()}\n</project_rules>` : "",
  ].filter(Boolean).join("\n\n");
}

export const desktop: KvDesktopApi = window.kv ?? previewApi;
export const isDesktop = Boolean(window.kv);

export async function saveSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  return desktop.updateSettings(patch);
}

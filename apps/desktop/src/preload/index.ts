import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, KvDesktopApi, SystemInfo } from "../shared/settings";
import type {
  ChatEvent,
  ChatStartRequest,
  ProviderSaveInput,
  ProviderSummary,
  ProviderTestResult,
} from "../shared/providers";
import type {
  Conversation,
  ConversationCompactionRequest,
  ConversationSummary,
} from "../shared/conversations";
import type {
  WorkspaceChange,
  WorkspaceEntry,
  WorkspaceFile,
} from "../shared/workspace-files";
import type { RulesReadRequest, RulesSaveRequest, RulesSnapshot } from "../shared/rules";

const api: KvDesktopApi = {
  readSettings: () => ipcRenderer.invoke("settings:read") as Promise<AppSettings>,
  updateSettings: (patch) =>
    ipcRenderer.invoke("settings:update", patch) as Promise<AppSettings>,
  listProviders: () =>
    ipcRenderer.invoke("providers:list") as Promise<ProviderSummary[]>,
  saveProvider: (input: ProviderSaveInput) =>
    ipcRenderer.invoke("providers:save", input) as Promise<ProviderSummary[]>,
  removeProvider: (providerId: string) =>
    ipcRenderer.invoke("providers:remove", providerId) as Promise<ProviderSummary[]>,
  testProvider: (providerId: string) =>
    ipcRenderer.invoke("providers:test", providerId) as Promise<ProviderTestResult>,
  startChat: (request: ChatStartRequest) =>
    ipcRenderer.invoke("chat:start", request) as Promise<{ turnId: string }>,
  cancelChat: (turnId: string) =>
    ipcRenderer.invoke("chat:cancel", turnId) as Promise<boolean>,
  onChatEvent: (listener: (event: ChatEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chatEvent: ChatEvent) =>
      listener(chatEvent);
    ipcRenderer.on("chat:event", handler);
    return () => ipcRenderer.removeListener("chat:event", handler);
  },
  listConversations: (workspace: string) =>
    ipcRenderer.invoke("conversations:list", workspace) as Promise<ConversationSummary[]>,
  readConversation: (workspace: string, conversationId: string) =>
    ipcRenderer.invoke("conversations:read", workspace, conversationId) as Promise<Conversation>,
  saveConversation: (conversation: Conversation) =>
    ipcRenderer.invoke("conversations:save", conversation) as Promise<ConversationSummary[]>,
  removeConversation: (workspace: string, conversationId: string) =>
    ipcRenderer.invoke("conversations:remove", workspace, conversationId) as Promise<ConversationSummary[]>,
  compactConversation: (request: ConversationCompactionRequest) =>
    ipcRenderer.invoke("conversations:compact", request) as Promise<string>,
  readRules: (request: RulesReadRequest) =>
    ipcRenderer.invoke("rules:read", request) as Promise<RulesSnapshot>,
  saveRules: (request: RulesSaveRequest) =>
    ipcRenderer.invoke("rules:save", request) as Promise<RulesSnapshot>,
  listWorkspaceDirectory: (workspace: string, path: string) =>
    ipcRenderer.invoke("workspace:list", workspace, path) as Promise<WorkspaceEntry[]>,
  readWorkspaceFile: (workspace: string, path: string) =>
    ipcRenderer.invoke("workspace:read-file", workspace, path) as Promise<WorkspaceFile>,
  registerInlineDocument: (document: string) =>
    ipcRenderer.invoke("inline:register", document) as Promise<string>,
  removeInlineDocument: (url: string) =>
    ipcRenderer.invoke("inline:remove", url) as Promise<void>,
  watchWorkspace: (workspace: string) =>
    ipcRenderer.invoke("workspace:watch", workspace) as Promise<void>,
  unwatchWorkspace: () =>
    ipcRenderer.invoke("workspace:unwatch") as Promise<void>,
  onWorkspaceChanged: (listener: (change: WorkspaceChange) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, change: WorkspaceChange) =>
      listener(change);
    ipcRenderer.on("workspace:changed", handler);
    return () => ipcRenderer.removeListener("workspace:changed", handler);
  },
  chooseDirectory: () =>
    ipcRenderer.invoke("system:choose-directory") as Promise<string | null>,
  systemInfo: () => ipcRenderer.invoke("system:info") as Promise<SystemInfo>,
  minimizeWindow: () => ipcRenderer.invoke("window:minimize") as Promise<void>,
  toggleMaximizeWindow: () =>
    ipcRenderer.invoke("window:toggle-maximize") as Promise<boolean>,
  pulseUltraWindow: () =>
    ipcRenderer.invoke("window:ultra-pulse") as Promise<boolean>,
  closeWindow: () => ipcRenderer.invoke("window:close") as Promise<void>,
};

contextBridge.exposeInMainWorld("kv", api);

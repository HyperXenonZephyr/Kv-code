import { z } from "zod";
import type {
  ChatEvent,
  ChatStartRequest,
  ProviderSaveInput,
  ProviderSummary,
  ProviderTestResult,
} from "./providers";
import type {
  Conversation,
  ConversationCompactionRequest,
  ConversationSummary,
} from "./conversations";
import type {
  WorkspaceChange,
  WorkspaceEntry,
  WorkspaceFile,
} from "./workspace-files";
import type {
  RulesReadRequest,
  RulesSaveRequest,
  RulesSnapshot,
} from "./rules";

export const themeModeSchema = z.enum(["system", "dark", "light"]);
export const localeSchema = z.enum(["en", "zh-CN"]);
export const densitySchema = z.enum(["comfortable", "compact"]);
export const workspaceModeSchema = z.enum(["code", "work"]);
export const reasoningEffortSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "ultra",
]);
export const toolPolicySchema = z.enum(["read-only", "auto", "yolo"]);

export const appSettingsSchema = z.object({
  theme: themeModeSchema,
  locale: localeSchema,
  density: densitySchema,
  reducedMotion: z.boolean(),
  signalEffects: z.boolean(),
  defaultMode: workspaceModeSchema,
  defaultDirectory: z.string().max(4_096),
  defaultReasoning: reasoningEffortSchema,
  defaultProviderId: z.string().max(100),
  restoreLastSession: z.boolean(),
  runInBackground: z.boolean(),
  additionalInstructions: z.string().max(4_000),
  toolPolicy: toolPolicySchema,
});

export type AppSettings = z.infer<typeof appSettingsSchema>;
export type ThemeMode = z.infer<typeof themeModeSchema>;
export type Locale = z.infer<typeof localeSchema>;
export type Density = z.infer<typeof densitySchema>;
export type WorkspaceMode = z.infer<typeof workspaceModeSchema>;
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export type ToolPolicy = z.infer<typeof toolPolicySchema>;

export const defaultSettings: AppSettings = {
  theme: "dark",
  locale: "en",
  density: "comfortable",
  reducedMotion: false,
  signalEffects: true,
  defaultMode: "code",
  defaultDirectory: "",
  defaultReasoning: "high",
  defaultProviderId: "",
  restoreLastSession: true,
  runInBackground: false,
  additionalInstructions: "",
  toolPolicy: "read-only",
};

export interface SystemInfo {
  platform: string;
  architecture: string;
  homeDirectory: string;
  appVersion: string;
}

export interface KvDesktopApi {
  readSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  listProviders(): Promise<ProviderSummary[]>;
  saveProvider(input: ProviderSaveInput): Promise<ProviderSummary[]>;
  removeProvider(providerId: string): Promise<ProviderSummary[]>;
  testProvider(providerId: string): Promise<ProviderTestResult>;
  startChat(request: ChatStartRequest): Promise<{ turnId: string }>;
  cancelChat(turnId: string): Promise<boolean>;
  onChatEvent(listener: (event: ChatEvent) => void): () => void;
  listConversations(workspace: string): Promise<ConversationSummary[]>;
  readConversation(workspace: string, conversationId: string): Promise<Conversation>;
  saveConversation(conversation: Conversation): Promise<ConversationSummary[]>;
  removeConversation(workspace: string, conversationId: string): Promise<ConversationSummary[]>;
  compactConversation(request: ConversationCompactionRequest): Promise<string>;
  readRules(request: RulesReadRequest): Promise<RulesSnapshot>;
  saveRules(request: RulesSaveRequest): Promise<RulesSnapshot>;
  listWorkspaceDirectory(workspace: string, path: string): Promise<WorkspaceEntry[]>;
  readWorkspaceFile(workspace: string, path: string): Promise<WorkspaceFile>;
  registerInlineDocument(document: string): Promise<string>;
  removeInlineDocument(url: string): Promise<void>;
  watchWorkspace(workspace: string): Promise<void>;
  unwatchWorkspace(): Promise<void>;
  onWorkspaceChanged(listener: (change: WorkspaceChange) => void): () => void;
  chooseDirectory(): Promise<string | null>;
  systemInfo(): Promise<SystemInfo>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<boolean>;
  pulseUltraWindow(): Promise<boolean>;
  closeWindow(): Promise<void>;
}

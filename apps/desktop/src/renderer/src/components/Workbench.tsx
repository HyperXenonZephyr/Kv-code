import {
  Bot,
  Box,
  ChevronRight,
  Code2,
  FolderGit2,
  FolderTree,
  Layers3,
  MessageSquareText,
  MonitorCog,
  Plus,
  Send,
  Square,
  SquareTerminal,
  ShieldCheck,
  ShieldOff,
  Zap,
  UserRound,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { AppSettings, ReasoningEffort, ToolPolicy, WorkspaceMode } from "../../../shared/settings";
import type { ProviderSummary } from "../../../shared/providers";
import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
  ConversationToolActivity,
} from "../../../shared/conversations";
import type { WorkspaceEntry } from "../../../shared/workspace-files";
import { useI18n } from "../i18n";
import { desktop } from "../lib/desktop";
import {
  createConversation,
  formatSessionTime,
  modelContext,
  nextCompactionChunk,
  storableMessages,
  titleFrom,
  type UiMessage,
} from "../lib/conversations";
import { ReasoningControl } from "./ReasoningControl";
import { WorkspaceTree } from "./WorkspaceTree";
import { DocumentViewer } from "./DocumentViewer";

const MarkdownContent = lazy(() => import("./MarkdownContent"));

export function Workbench({
  mode,
  reasoning,
  workspace,
  settings,
  providers,
  activeProviderId,
  ultraIntro,
  onModeChange,
  onReasoningChange,
  onToolPolicyChange,
  onProviderChange,
  onChooseDirectory,
  onOpenSettings,
}: {
  mode: WorkspaceMode;
  reasoning: ReasoningEffort;
  workspace: string;
  settings: AppSettings;
  providers: ProviderSummary[];
  activeProviderId: string;
  ultraIntro: boolean;
  onModeChange(mode: WorkspaceMode): void;
  onReasoningChange(effort: ReasoningEffort): void;
  onToolPolicyChange(policy: ToolPolicy): void;
  onProviderChange(providerId: string): void;
  onChooseDirectory(): void;
  onOpenSettings(): void;
}) {
  const { locale, t } = useI18n();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sessions, setSessions] = useState<ConversationSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [leftPanel, setLeftPanel] = useState<"sessions" | "files">("sessions");
  const [activeDocument, setActiveDocument] = useState<WorkspaceEntry | null>(null);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [documentRevision, setDocumentRevision] = useState(0);
  const activeAssistantId = useRef<string | null>(null);
  const activeAssistantText = useRef("");
  const activeTurnIdRef = useRef<string | null>(null);
  const activeConversation = useRef<Conversation | null>(null);
  const activeDocumentRef = useRef<WorkspaceEntry | null>(null);
  const transcript = useRef<HTMLDivElement | null>(null);
  const activeProvider = providers.find((provider) => provider.id === activeProviderId);
  const basicToolsEnabled = Boolean(activeProvider && (activeProvider.protocol === "openai-chat" || activeProvider.protocol === "openai-responses"));
  const workspaceName = workspace.split(/[\\/]/).filter(Boolean).at(-1);
  const contextCharacters = useMemo(
    () => messages.reduce((total, message) => total + message.content.length, 0),
    [messages],
  );

  useEffect(() => {
    let active = true;
    setSessionLoading(true);
    setMessages([]);
    setDraft("");
    setActiveSessionId(null);
    setActiveDocument(null);
    activeConversation.current = null;
    void desktop.listConversations(workspace)
      .then(async (summaries) => {
        if (!active) return;
        setSessions(summaries);
        if (!settings.restoreLastSession || !summaries[0]) return;
        const conversation = await desktop.readConversation(workspace, summaries[0].id);
        if (!active) return;
        activateConversation(conversation);
      })
      .finally(() => {
        if (active) setSessionLoading(false);
      });
    return () => {
      active = false;
    };
  }, [settings.restoreLastSession, workspace]);

  useEffect(() => {
    activeDocumentRef.current = activeDocument;
  }, [activeDocument]);

  useEffect(() => {
    if (!workspace) return;
    const unsubscribe = desktop.onWorkspaceChanged((change) => {
      if (change.workspace !== workspace) return;
      setWorkspaceRevision((revision) => revision + 1);
      const document = activeDocumentRef.current;
      if (!document || !changedPathAffects(document.path, change.path)) return;
      if (change.exists) setDocumentRevision((revision) => revision + 1);
      else setActiveDocument(null);
    });
    void desktop.watchWorkspace(workspace).catch((error: unknown) => {
      console.error("Could not watch the current workspace.", error);
    });
    return () => {
      unsubscribe();
      void desktop.unwatchWorkspace();
    };
  }, [workspace]);

  useEffect(
    () => desktop.onChatEvent((event) => {
      if (event.turnId !== activeTurnIdRef.current) return;
      if (event.type === "tool") {
        const assistantId = activeAssistantId.current;
        if (!assistantId) return;
        let progress = "";
        if (event.status === "started") {
          // Text emitted in a tool-call round is progress, not the final answer.
          // Move it out of the assistant bubble once the provider confirms the call.
          progress = activeAssistantText.current.trim();
          if (progress) {
            activeAssistantText.current = "";
          }
        }
        setMessages((current) => current.map((message) => {
          if (message.id !== assistantId) return message;
          const events = message.toolEvents ?? [];
          const existing = events.some((item) => item.callId === event.callId);
          return {
            ...message,
            content: progress ? "" : message.content,
            toolProgress: progress
              ? [...(message.toolProgress ?? []), progress]
              : message.toolProgress,
            toolEvents: existing
              ? events.map((item) => item.callId === event.callId
                ? { ...item, ...event, detail: event.detail ?? item.detail }
                : item)
              : [...events, event],
          };
        }));
        return;
      }
      const assistantId = activeAssistantId.current;
      if (!assistantId) return;

      if (event.type === "delta") {
        activeAssistantText.current += event.text;
        setMessages((current) => current.map((message) =>
          message.id === assistantId
            ? { ...message, content: `${message.content}${event.text}` }
            : message,
        ));
        return;
      }

      if (event.type === "done") {
        setMessages((current) => {
          const next = current.map((message): UiMessage =>
            message.id === assistantId ? { ...message, state: "complete" } : message,
          );
          void persistCurrentConversation(next);
          return next;
        });
      } else if (event.type === "cancelled") {
        setMessages((current) => {
          const next = current.map((message): UiMessage =>
            message.id === assistantId
              ? {
                  ...message,
                  content: message.content || t("workbench.cancelled"),
                  state: "cancelled",
                }
              : message,
          );
          void persistCurrentConversation(next);
          return next;
        });
      } else {
        setMessages((current) => {
          const next = current.map((message): UiMessage =>
            message.id === assistantId
              ? { ...message, content: event.message, state: "error" }
              : message,
          );
          void persistCurrentConversation(next);
          return next;
        });
      }
      setActiveTurnId(null);
      activeTurnIdRef.current = null;
      activeAssistantId.current = null;
      activeAssistantText.current = "";
    }),
    [t],
  );

  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    const content = draft.trim();
    if (!content || !activeProvider || activeTurnId) return;

    const turnId = crypto.randomUUID();
    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      state: "complete",
    };
    const assistantMessage: UiMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      state: "streaming",
    };
    const nextStoredMessages: ConversationMessage[] = [
      ...storableMessages(messages),
      userMessage,
    ];

    setDraft("");
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setActiveTurnId(turnId);
    activeTurnIdRef.current = turnId;
    activeAssistantId.current = assistantMessage.id;
    activeAssistantText.current = "";
    try {
      let conversation = activeConversation.current;
      if (!conversation) {
        conversation = createConversation(
          workspace,
          activeProvider.id,
          mode,
          titleFrom(content),
        );
        activeConversation.current = conversation;
        setActiveSessionId(conversation.id);
      }
      const title = conversation.messages.length ? conversation.title : titleFrom(content);
      conversation = await persistCurrentConversation(nextStoredMessages, { title });
      setCompacting(true);
      conversation = await compactContextIfNeeded(conversation, activeProvider.id);
      setCompacting(false);
      const history = modelContext(conversation);
      await desktop.startChat({
        turnId,
        providerId: activeProvider.id,
        workspace,
        mode,
        reasoning,
        additionalInstructions: settings.additionalInstructions,
        messages: history,
      });
    } catch (error) {
      setMessages((current) => {
        const next = current.map((message): UiMessage =>
          message.id === assistantMessage.id
            ? {
                ...message,
                content: error instanceof Error ? error.message : "Unable to start the turn.",
                state: "error",
              }
            : message,
        );
        void persistCurrentConversation(next);
        return next;
      });
      setCompacting(false);
      setActiveTurnId(null);
      activeTurnIdRef.current = null;
      activeAssistantId.current = null;
      activeAssistantText.current = "";
    }
  };

  const handleComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const newConversation = () => {
    if (activeTurnId) return;
    activeConversation.current = null;
    activeAssistantText.current = "";
    setActiveSessionId(null);
    setMessages([]);
    setDraft("");
    activeAssistantText.current = "";
    setActiveDocument(null);
  };

  const openWorkspaceFile = (entry: WorkspaceEntry) => {
    setActiveDocument(entry);
  };

  async function openConversation(conversationId: string): Promise<void> {
    if (activeTurnId || conversationId === activeSessionId) return;
    setSessionLoading(true);
    try {
      const conversation = await desktop.readConversation(workspace, conversationId);
      activateConversation(conversation);
      if (
        conversation.providerId &&
        conversation.providerId !== activeProviderId &&
        providers.some((provider) => provider.id === conversation.providerId)
      ) {
        onProviderChange(conversation.providerId);
      }
    } finally {
      setSessionLoading(false);
    }
  }

  function activateConversation(conversation: Conversation): void {
    activeConversation.current = conversation;
    setActiveSessionId(conversation.id);
    setMessages(conversation.messages);
    setDraft("");
    onModeChange(conversation.mode);
  }

  async function persistCurrentConversation(
    nextMessages: UiMessage[] | ConversationMessage[],
    patch: Partial<Pick<Conversation, "title">> = {},
  ): Promise<Conversation> {
    const current = activeConversation.current;
    if (!current) throw new Error("No active conversation to save.");
    const conversation: Conversation = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
      messages: storableMessages(nextMessages),
    };
    activeConversation.current = conversation;
    setSessions(await desktop.saveConversation(conversation));
    return conversation;
  }

  async function compactContextIfNeeded(
    initialConversation: Conversation,
    providerId: string,
  ): Promise<Conversation> {
    let conversation = initialConversation;
    while (true) {
      const plan = nextCompactionChunk(conversation);
      if (!plan) return conversation;
      const eligibleMessages = plan.messages.filter(
        (message) => message.content && message.state !== "error",
      );
      const contextSummary = eligibleMessages.length
        ? await desktop.compactConversation({
            providerId,
            priorSummary: conversation.contextSummary,
            messages: eligibleMessages,
          })
        : conversation.contextSummary;
      conversation = {
        ...conversation,
        contextSummary,
        summarizedMessageCount: plan.end,
        updatedAt: Date.now(),
      };
      activeConversation.current = conversation;
      setSessions(await desktop.saveConversation(conversation));
    }
  }

  return (
    <section className="workbench">
      <aside className="session-column">
        <header>
          <div className="session-panel-switch">
            <button
              className={leftPanel === "sessions" ? "active" : ""}
              title={t("workbench.sessions")}
              onClick={() => setLeftPanel("sessions")}
            ><MessageSquareText size={14} /></button>
            <button
              className={leftPanel === "files" ? "active" : ""}
              title={t("workbench.files")}
              onClick={() => setLeftPanel("files")}
            ><FolderTree size={14} /></button>
          </div>
          <span>{leftPanel === "sessions" ? t("workbench.sessions") : t("workbench.files")}</span>
          {leftPanel === "sessions" && (
            <button
              className="session-new-button"
              title={t("workbench.newConversation")}
              disabled={Boolean(activeTurnId)}
              onClick={newConversation}
            >
              <Plus size={14} />
            </button>
          )}
        </header>
        {leftPanel === "files" ? (
          <WorkspaceTree
            workspace={workspace}
            revision={workspaceRevision}
            onOpenFile={openWorkspaceFile}
          />
        ) : sessions.length ? (
          <div className="session-list">
            {sessions.map((session) => (
              <button
                className={`session-entry${session.id === activeSessionId ? " active" : ""}`}
                disabled={Boolean(activeTurnId) || sessionLoading}
                key={session.id}
                onClick={() => void openConversation(session.id)}
              >
                <Layers3 size={16} />
                <span>
                  <strong>{session.title}</strong>
                  <small>{session.mode.toUpperCase()} · {session.messageCount} · {formatSessionTime(session.updatedAt, locale)}</small>
                </span>
                <ChevronRight size={13} />
              </button>
            ))}
          </div>
        ) : (
          <div className="session-empty">
            <Layers3 size={20} />
            <strong>{t("workbench.noSessions")}</strong>
            <p>{activeProvider ? t("workbench.newConversation") : t("workbench.noSessionsDetail")}</p>
          </div>
        )}
        <div className="workspace-dock">
          <span>{t("workbench.workspace")}</span>
          <button disabled={Boolean(activeTurnId)} onClick={onChooseDirectory}>
            <FolderGit2 size={16} />
            <span>
              <strong>{workspaceName || t("workbench.openWorkspace")}</strong>
              <small>{workspace || t("workbench.noWorkspace")}</small>
            </span>
            <ChevronRight size={14} />
          </button>
        </div>
      </aside>

      <main className="conversation-column">
        <header className="conversation-toolbar">
          <div className="mode-control" aria-label="Workspace mode">
            <button
              className={mode === "code" ? "active" : ""}
              disabled={Boolean(activeSessionId)}
              onClick={() => onModeChange("code")}
            >
              <Code2 size={14} /> {t("app.code")}
            </button>
            <button
              className={mode === "work" ? "active" : ""}
              disabled={Boolean(activeSessionId)}
              onClick={() => onModeChange("work")}
            >
              <Box size={14} /> {t("app.work")}
            </button>
          </div>
          <label className="provider-select">
            <span>{t("workbench.providerSelect")}</span>
            <select
              value={activeProviderId}
              disabled={Boolean(activeTurnId) || messages.length > 0}
              onChange={(event) => onProviderChange(event.target.value)}
            >
              <option value="">{t("workbench.notConfigured")}</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} / {provider.model}
                </option>
              ))}
            </select>
          </label>
          <span className="standby-indicator">
            <i /> {compacting ? t("workbench.compacting") : activeTurnId ? "STREAMING" : t("workbench.standby")}
          </span>
        </header>

        {activeDocument ? (
          <DocumentViewer
            entry={activeDocument}
            revision={documentRevision}
            workspace={workspace}
            onClose={() => setActiveDocument(null)}
          />
        ) : messages.length ? (
          <div className="conversation-transcript" ref={transcript} tabIndex={-1}>
            {messages.map((message) => (
              <article className={`chat-message ${message.role} ${message.state}`} key={message.id}>
                <header>
                  {message.role === "user" ? <UserRound size={15} /> : <Bot size={15} />}
                  <strong>{message.role === "user" ? "YOU" : activeProvider?.name.toUpperCase()}</strong>
                  <span>{message.state.toUpperCase()}</span>
                </header>
                {message.role === "assistant" && Boolean(message.toolProgress?.length) && (
                  <ToolProgress items={message.toolProgress ?? []} />
                )}
                {message.role === "assistant" && Boolean(message.toolEvents?.length) && (
                  <ToolTrace events={message.toolEvents ?? []} />
                )}
                {message.role === "assistant" && message.content ? (
                  <AssistantMarkdown content={message.content} />
                ) : (
                  <div>{message.content || <i className="stream-cursor" />}</div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="conversation-empty">
            <div className="signal-assembly" aria-hidden="true">
              <i />
              <i />
              <span><Bot size={28} /></span>
            </div>
            <small>LOCAL AGENT SURFACE / {activeProvider ? "PROVIDER READY" : "AWAITING PROVIDER"}</small>
            <h1>{activeProvider ? activeProvider.name : t("workbench.noConversation")}</h1>
            <p>
              {activeProvider
                ? `${activeProvider.model} / ${mode.toUpperCase()} / ${t(basicToolsEnabled ? "workbench.toolsReadOnly" : "workbench.toolsOff")}`
                : t("workbench.providerRequiredDetail")}
            </p>
            {!activeProvider && (
              <button className="configure-provider" onClick={onOpenSettings}>
                <MonitorCog size={15} />
                {t("workbench.inspectSettings")}
              </button>
            )}
          </div>
        )}

        <div className="composer-zone">
          <ToolPolicyControl
            value={settings.toolPolicy}
            disabled={!activeProvider || !basicToolsEnabled || Boolean(activeTurnId)}
            onChange={(toolPolicy) => onToolPolicyChange(toolPolicy)}
          />
          <ReasoningControl
            compact
            value={reasoning}
            signalEffects={settings.signalEffects && !settings.reducedMotion}
            animatePulse={ultraIntro}
            onChange={onReasoningChange}
          />
          <div className="composer-shell enabled">
            <SquareTerminal size={16} />
            <textarea
              maxLength={32_000}
              value={draft}
              placeholder={activeProvider ? t("workbench.chatPlaceholder") : t("workbench.inputUnavailable")}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKey}
            />
            {activeTurnId ? (
              <button
                className="stop-command"
                title={t("workbench.stop")}
                onClick={() => void desktop.cancelChat(activeTurnId)}
              >
                <Square size={15} />
              </button>
            ) : (
              <button
                className="send-command"
                disabled={!activeProvider || !draft.trim()}
                title={t("workbench.send")}
                onClick={() => void send()}
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </main>

      <aside className="runtime-column">
        <header>{t("workbench.runtime")} <span>R1</span></header>
        <RuntimeMetric label={t("workbench.engine")} value="Streaming chat" />
        <RuntimeMetric
          label={t("workbench.provider")}
          value={activeProvider?.name ?? t("workbench.notConfigured")}
          warning={!activeProvider}
        />
        <RuntimeMetric label={t("settings.modelId")} value={activeProvider?.model ?? "-"} />
        <RuntimeMetric
          label={t("workbench.context")}
          value={`${contextCharacters.toLocaleString()} ${t("workbench.contextChars")}`}
        />
        <div className="context-meter">
          <i style={{ width: `${Math.min(100, contextCharacters / 2_400)}%` }} />
        </div>
        <p>{t(basicToolsEnabled ? "workbench.toolsReadOnly" : "workbench.toolsOff")}</p>
        <div className="runtime-spec">
          <span>MODE</span><strong>{mode.toUpperCase()}</strong>
          <span>EFFORT</span><strong>{reasoning.toUpperCase()}</strong>
          <span>SCOPE</span><strong>{workspace ? "PROJECT" : "GLOBAL"}</strong>
        </div>
      </aside>
    </section>
  );
}

function ToolProgress({ items }: { items: string[] }) {
  return (
    <div className="tool-progress" aria-label="Model progress">
      {items.map((item, index) => (
        <div className="tool-progress-item" key={`${index}-${item.slice(0, 24)}`}>
          <Bot size={13} aria-hidden="true" />
          <div>{item}</div>
        </div>
      ))}
    </div>
  );
}

function ToolTrace({ events }: { events: ConversationToolActivity[] }) {
  const { t } = useI18n();
  return (
    <div className="tool-trace" aria-live="polite">
      {events.map((event) => {
        const status = event.status === "started"
          ? t("tools.statusStarted")
          : event.status === "completed"
            ? t("tools.statusCompleted")
            : t("tools.statusError");
        return (
          <div className={`tool-trace-row ${event.status}`} key={event.callId}>
            <span className="tool-trace-mark" aria-hidden="true" />
            <strong>{event.name}</strong>
            <span>{status}</span>
            {event.detail && <small>{event.detail}</small>}
          </div>
        );
      })}
    </div>
  );
}

function ToolPolicyControl({
  value,
  disabled,
  onChange,
}: {
  value: ToolPolicy;
  disabled: boolean;
  onChange(value: ToolPolicy): void;
}) {
  const { t } = useI18n();
  const options: Array<[ToolPolicy, typeof ShieldCheck, string]> = [
    ["read-only", ShieldCheck, t("tools.policyReadOnly")],
    ["auto", Zap, t("tools.policyAuto")],
    ["yolo", ShieldOff, t("tools.policyYolo")],
  ];
  return (
    <div className="tool-policy-control" aria-label={t("tools.policyTitle")}>
      <small>{t("tools.policyTitle")}</small>
      <div className="tool-policy-options">
        {options.map(([policy, Icon, label]) => (
          <button
            key={policy}
            className={value === policy ? "active" : ""}
            disabled={disabled}
            title={label}
            aria-label={label}
            aria-pressed={value === policy}
            onClick={() => onChange(policy)}
          >
            <Icon size={13} />
            <span>{policy === "read-only" ? "RO" : policy.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function changedPathAffects(documentPath: string, changedPath: string): boolean {
  return Boolean(changedPath) && (
    documentPath === changedPath || documentPath.startsWith(`${changedPath}/`)
  );
}

function RuntimeMetric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className={`runtime-metric${warning ? " warning" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AssistantMarkdown({ content }: { content: string }) {
  const deferredContent = useDeferredValue(content);
  return (
    <Suspense fallback={<div>{content}</div>}>
      <MarkdownContent
        className="chat-markdown"
        interactive
        source={deferredContent}
      />
    </Suspense>
  );
}

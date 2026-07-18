import {
  Accessibility,
  Bot,
  BrainCircuit,
  ChevronRight,
  Database,
  FileText,
  FolderGit2,
  Gauge,
  GitBranch,
  Languages,
  LockKeyhole,
  MonitorCog,
  Palette,
  PanelsTopLeft,
  Search,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import {
  useMemo,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type {
  AppSettings,
  Density,
  Locale,
  ThemeMode,
  WorkspaceMode,
} from "../../../shared/settings";
import type {
  ProviderSaveInput,
  ProviderSummary,
  ProviderTestResult,
} from "../../../shared/providers";
import { useI18n, type MessageKey } from "../i18n";
import { ProviderSettings } from "./ProviderSettings";
import { ReasoningControl } from "./ReasoningControl";
import { desktop } from "../lib/desktop";
import type { RulesSnapshot } from "../../../shared/rules";

export type SettingsPage =
  | "general"
  | "appearance"
  | "language"
  | "models"
  | "behavior"
  | "rules"
  | "memory"
  | "skills"
  | "permissions"
  | "terminal"
  | "browser"
  | "git"
  | "agents"
  | "workMode"
  | "privacy"
  | "advanced"
  | "updates";

interface SettingsNavItem {
  id: SettingsPage;
  label: MessageKey;
  icon: ComponentType<{ size?: number }>;
  implemented: boolean;
}

const navigation: SettingsNavItem[] = [
  { id: "general", label: "settings.general", icon: SlidersHorizontal, implemented: true },
  { id: "appearance", label: "settings.appearance", icon: Palette, implemented: true },
  { id: "language", label: "settings.language", icon: Languages, implemented: true },
  { id: "models", label: "settings.models", icon: Gauge, implemented: true },
  { id: "behavior", label: "settings.behavior", icon: ShieldCheck, implemented: true },
  { id: "rules", label: "settings.rules", icon: FileText, implemented: true },
  { id: "memory", label: "settings.memory", icon: BrainCircuit, implemented: false },
  { id: "skills", label: "settings.skills", icon: Sparkles, implemented: false },
  { id: "permissions", label: "settings.permissions", icon: LockKeyhole, implemented: false },
  { id: "terminal", label: "settings.terminal", icon: TerminalSquare, implemented: false },
  { id: "browser", label: "settings.browser", icon: PanelsTopLeft, implemented: false },
  { id: "git", label: "settings.git", icon: GitBranch, implemented: false },
  { id: "agents", label: "settings.agents", icon: Bot, implemented: false },
  { id: "workMode", label: "settings.workMode", icon: Wrench, implemented: false },
  { id: "privacy", label: "settings.privacy", icon: Database, implemented: false },
  { id: "advanced", label: "settings.advanced", icon: MonitorCog, implemented: false },
  { id: "updates", label: "settings.updates", icon: Accessibility, implemented: false },
];

const plannedCopy: Record<Exclude<SettingsPage, "general" | "appearance" | "language" | "models" | "behavior" | "rules">, MessageKey> = {
  memory: "settings.memoryPlan",
  skills: "settings.skillsPlan",
  permissions: "settings.permissionsPlan",
  terminal: "settings.terminalPlan",
  browser: "settings.browserPlan",
  git: "settings.gitPlan",
  agents: "settings.agentsPlan",
  workMode: "settings.workPlan",
  privacy: "settings.privacyPlan",
  advanced: "settings.advancedPlan",
  updates: "settings.updatesPlan",
};

export function SettingsWorkspace({
  settings,
  saving,
  initialPage = "general",
  providers,
  providerBusy,
  onSaveProvider,
  onRemoveProvider,
  onTestProvider,
  onUpdate,
  onChooseDirectory,
  workspace,
}: {
  settings: AppSettings;
  saving: boolean;
  initialPage?: SettingsPage;
  providers: ProviderSummary[];
  providerBusy: boolean;
  onSaveProvider(input: ProviderSaveInput): Promise<void>;
  onRemoveProvider(providerId: string): Promise<void>;
  onTestProvider(providerId: string): Promise<ProviderTestResult>;
  onUpdate(patch: Partial<AppSettings>): void;
  onChooseDirectory(): void;
  workspace: string;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState<SettingsPage>(initialPage);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"global" | "project">("global");
  useEffect(() => {
    if (page !== "rules") setScope("global");
  }, [page]);
  const projectScopeEnabled = page === "rules" && Boolean(workspace);
  const filteredNavigation = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return navigation;
    return navigation.filter((item) =>
      t(item.label).toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [query, t]);

  return (
    <section className="settings-workspace" aria-label={t("settings.title")}>
      <header className="settings-toolbar">
        <div className="settings-title">
          <MonitorCog size={17} />
          <span>
            <small>KV CODE / CONTROL PLANE</small>
            <strong>{t("settings.title")}</strong>
          </span>
        </div>
        <label className="settings-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.search")}
          />
        </label>
        <div className="scope-control" aria-label="Settings scope">
          <button
            className={scope === "global" ? "active" : ""}
            onClick={() => setScope("global")}
          >
            {t("settings.global")}
          </button>
          <button
            className={scope === "project" ? "active" : ""}
            disabled={!projectScopeEnabled}
            title={!projectScopeEnabled ? (page !== "rules" ? t("settings.projectPlanned") : t("settings.projectUnavailable")) : t("settings.project")}
            onClick={() => setScope("project")}
          >
            {t("settings.project")}
          </button>
        </div>
        <span className={`save-state${saving ? " saving" : ""}`}>
          <i />
          {saving ? "SAVING" : t("settings.saved").toUpperCase()}
        </span>
      </header>

      <div className="settings-layout">
        <nav className="settings-navigation" aria-label={t("settings.title")}>
          {filteredNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={page === item.id ? "active" : ""}
                key={item.id}
                onClick={() => setPage(item.id)}
              >
                <Icon size={15} />
                <span>{t(item.label)}</span>
                {!item.implemented && <small>{t("settings.planned")}</small>}
                <ChevronRight size={13} />
              </button>
            );
          })}
        </nav>

        <main className="settings-content">
          {page === "general" && (
            <GeneralSettings
              settings={settings}
              onUpdate={onUpdate}
              onChooseDirectory={onChooseDirectory}
            />
          )}
          {page === "appearance" && (
            <AppearanceSettings settings={settings} onUpdate={onUpdate} />
          )}
          {page === "language" && (
            <LanguageSettings settings={settings} onUpdate={onUpdate} />
          )}
          {page === "models" && (
            <ProviderSettings
              providers={providers}
              busy={providerBusy}
              onSave={onSaveProvider}
              onRemove={onRemoveProvider}
              onTest={onTestProvider}
            />
          )}
          {page === "behavior" && (
            <BehaviorSettings
              settings={settings}
              onUpdate={onUpdate}
            />
          )}
          {page === "rules" && (
            <RulesSettings workspace={workspace} scope={scope} />
          )}
          {page in plannedCopy && (
            <PlannedSettings page={page as keyof typeof plannedCopy} />
          )}
        </main>
      </div>
    </section>
  );
}

function RulesSettings({
  workspace,
  scope,
}: {
  workspace: string;
  scope: "global" | "project";
}) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<RulesSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const document = snapshot?.[scope];

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void desktop.readRules({ workspace })
      .then((next) => {
        if (!active) return;
        setSnapshot(next);
        setDraft(next[scope].content);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : t("settings.rulesLoadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [scope, t, workspace]);

  const save = async () => {
    if (scope === "project" && !workspace) return;
    setSaving(true);
    setError("");
    try {
      const next = await desktop.saveRules({ workspace, scope, content: draft });
      setSnapshot(next);
      setDraft(next[scope].content);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.rulesSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const status = document?.loadStatus ?? "missing";
  return (
    <>
      <SectionHeader
        eyebrow={t("settings.rulesEyebrow")}
        title={scope === "global" ? t("settings.globalRulesTitle") : t("settings.projectRulesTitle")}
        detail={scope === "global" ? t("settings.globalRulesDetail") : t("settings.projectRulesDetail")}
      />
      <SettingsGroup>
        <div className="rules-path-row">
          <FileText size={15} />
          <code>{document?.path || t("settings.rulesUnavailable")}</code>
          <span className={`rules-load-status ${status}`}>{status.toUpperCase()}</span>
        </div>
        <textarea
          className="instructions-field rules-editor"
          maxLength={16_000}
          value={draft}
          disabled={loading || (scope === "project" && !workspace)}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("settings.rulesPlaceholder")}
          spellCheck={false}
        />
        <div className="rules-editor-footer">
          <small>{draft.length.toLocaleString()} / 16,000</small>
          <button className="settings-primary-action" disabled={loading || saving || (scope === "project" && !workspace)} onClick={() => void save()}>
            {saving ? t("settings.rulesSaving") : t("settings.rulesSave")}
          </button>
        </div>
      </SettingsGroup>
      {error && <div className="settings-error">{error}</div>}
      <section className="rules-preview-panel">
        <header><strong>{t("settings.rulesResolvedTitle")}</strong><span>{t("settings.rulesOrder")}</span></header>
        <pre>{snapshot?.resolvedContent || t("settings.rulesEmpty")}</pre>
      </section>
      <p className="rules-note">{t("settings.rulesGitNote")}</p>
    </>
  );
}

function SectionHeader({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail: string;
}) {
  return (
    <header className="settings-section-header">
      <small>{eyebrow}</small>
      <h1>{title}</h1>
      <p>{detail}</p>
    </header>
  );
}

function GeneralSettings({
  settings,
  onUpdate,
  onChooseDirectory,
}: {
  settings: AppSettings;
  onUpdate(patch: Partial<AppSettings>): void;
  onChooseDirectory(): void;
}) {
  const { t } = useI18n();
  return (
    <>
      <SectionHeader
        eyebrow={t("settings.foundation")}
        title={t("settings.generalTitle")}
        detail={t("settings.generalDetail")}
      />
      <SettingsGroup>
        <SettingsRow
          label={t("settings.defaultMode")}
          detail={t("settings.defaultModeDetail")}
        >
          <Segmented<WorkspaceMode>
            value={settings.defaultMode}
            options={[
              ["code", "CODE"],
              ["work", "WORK"],
            ]}
            onChange={(defaultMode) => onUpdate({ defaultMode })}
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings.defaultDirectory")}
          detail={t("settings.defaultDirectoryDetail")}
        >
          <button className="directory-picker" onClick={onChooseDirectory}>
            <FolderGit2 size={14} />
            <span>{settings.defaultDirectory || t("workbench.noWorkspace")}</span>
            <strong>{t("settings.choose")}</strong>
          </button>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function AppearanceSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate(patch: Partial<AppSettings>): void;
}) {
  const { t } = useI18n();
  return (
    <>
      <SectionHeader
        eyebrow={t("settings.foundation")}
        title={t("settings.appearanceTitle")}
        detail={t("settings.appearanceDetail")}
      />
      <SettingsGroup>
        <SettingsRow label={t("settings.theme")}>
          <Segmented<ThemeMode>
            value={settings.theme}
            options={[
              ["system", t("settings.system")],
              ["dark", t("settings.dark")],
              ["light", t("settings.light")],
            ]}
            onChange={(theme) => onUpdate({ theme })}
          />
        </SettingsRow>
        <SettingsRow label={t("settings.density")}>
          <Segmented<Density>
            value={settings.density}
            options={[
              ["comfortable", t("settings.comfortable")],
              ["compact", t("settings.compact")],
            ]}
            onChange={(density) => onUpdate({ density })}
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings.reducedMotion")}
          detail={t("settings.reducedMotionDetail")}
        >
          <Switch
            checked={settings.reducedMotion}
            onChange={(reducedMotion) => onUpdate({ reducedMotion })}
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings.signalEffects")}
          detail={t("settings.signalEffectsDetail")}
        >
          <Switch
            checked={settings.signalEffects}
            disabled={settings.reducedMotion}
            onChange={(signalEffects) => onUpdate({ signalEffects })}
          />
        </SettingsRow>
      </SettingsGroup>
      <div className="material-specimen" aria-hidden="true">
        <span>KV / MATERIAL 01</span>
        <i />
        <i />
        <i />
        <strong>PRECISION SURFACE</strong>
      </div>
    </>
  );
}

function LanguageSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate(patch: Partial<AppSettings>): void;
}) {
  const { t } = useI18n();
  return (
    <>
      <SectionHeader
        eyebrow={t("settings.foundation")}
        title={t("settings.languageTitle")}
        detail={t("settings.languageDetail")}
      />
      <SettingsGroup>
        <SettingsRow label={t("settings.interfaceLanguage")}>
          <Segmented<Locale>
            value={settings.locale}
            options={[
              ["en", t("settings.english")],
              ["zh-CN", t("settings.chinese")],
            ]}
            onChange={(locale) => onUpdate({ locale })}
          />
        </SettingsRow>
        <SettingsRow label={t("settings.keyboard")} detail={t("settings.keyboardDetail")}>
          <span className="locked-setting">REQUIRED</span>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function BehaviorSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate(patch: Partial<AppSettings>): void;
}) {
  const { t } = useI18n();
  return (
    <>
      <SectionHeader
        eyebrow={t("settings.foundation")}
        title={t("settings.behaviorTitle")}
        detail={t("settings.behaviorDetail")}
      />
      <SettingsGroup>
        <SettingsRow label={t("settings.defaultReasoning")} vertical>
          <ReasoningControl
            value={settings.defaultReasoning}
            signalEffects={settings.signalEffects}
            onChange={(defaultReasoning) => onUpdate({ defaultReasoning })}
          />
        </SettingsRow>
        <SettingsRow label={t("settings.rigorous")} detail={t("settings.rigorousDetail")}>
          <span className="locked-setting">LOCKED ON</span>
        </SettingsRow>
        <SettingsRow
          label={t("settings.instructions")}
          detail={t("settings.instructionsDetail")}
          vertical
        >
          <textarea
            className="instructions-field"
            maxLength={4_000}
            value={settings.additionalInstructions}
            placeholder={t("settings.instructionsPlaceholder")}
            onChange={(event) => onUpdate({ additionalInstructions: event.target.value })}
          />
          <small className="character-count">
            {settings.additionalInstructions.length.toLocaleString()} / 4,000
          </small>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function PlannedSettings({ page }: { page: keyof typeof plannedCopy }) {
  const { t } = useI18n();
  const item = navigation.find((candidate) => candidate.id === page);
  const Icon = item?.icon ?? MonitorCog;
  return (
    <section className="planned-settings">
      <div className="planned-mark">
        <Icon size={25} />
        <span>{t("settings.planned")}</span>
      </div>
      <SectionHeader
        eyebrow="PRODUCT BOUNDARY RESERVED"
        title={item ? t(item.label) : t("settings.title")}
        detail={t(plannedCopy[page])}
      />
      <div className="planned-boundary">
        <ShieldCheck size={18} />
        <p>{t("settings.notImplemented")}</p>
      </div>
    </section>
  );
}

function SettingsGroup({ children }: { children: ReactNode }) {
  return <section className="settings-group">{children}</section>;
}

function SettingsRow({
  label,
  detail,
  vertical = false,
  children,
}: {
  label: string;
  detail?: string;
  vertical?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`settings-row${vertical ? " vertical" : ""}`}>
      <div className="settings-row-copy">
        <strong>{label}</strong>
        {detail && <p>{detail}</p>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange(value: T): void;
}) {
  return (
    <div className="segmented-control">
      {options.map(([option, label]) => (
        <button
          className={value === option ? "active" : ""}
          key={option}
          onClick={() => onChange(option)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Switch({
  checked,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className={`switch-control${disabled ? " disabled" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i />
    </label>
  );
}

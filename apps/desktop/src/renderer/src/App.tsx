import { CircleDot, Maximize2, Minus, PanelLeft, Settings, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  AppSettings,
  ReasoningEffort,
  WorkspaceMode,
} from "../../shared/settings";
import type {
  ProviderSaveInput,
  ProviderSummary,
  ProviderTestResult,
} from "../../shared/providers";
import {
  SettingsWorkspace,
  type SettingsPage,
} from "./components/SettingsWorkspace";
import { Workbench } from "./components/Workbench";
import { I18nProvider, useI18n } from "./i18n";
import { desktop, isDesktop, saveSettings } from "./lib/desktop";
import logoUrl from "../../../resources/logo-ui.png";

type PrimaryView = "workbench" | "settings";

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void desktop
      .readSettings()
      .then((loaded) => {
        if (active) setSettings(loaded);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [loadRevision]);

  if (!settings) {
    return (
      <div className="boot-screen">
        <KvMark />
        <span>{loadFailed ? "DESKTOP STATE UNAVAILABLE" : "LOCAL RUNTIME / STARTING"}</span>
        {loadFailed && (
          <button onClick={() => setLoadRevision((revision) => revision + 1)}>RETRY</button>
        )}
      </div>
    );
  }

  return (
    <I18nProvider locale={settings.locale}>
      <DesktopShell settings={settings} setSettings={setSettings} />
    </I18nProvider>
  );
}

function DesktopShell({
  settings,
  setSettings,
}: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<PrimaryView>("workbench");
  const [settingsStartPage, setSettingsStartPage] = useState<SettingsPage>("general");
  const [mode, setMode] = useState<WorkspaceMode>(settings.defaultMode);
  const [workspace, setWorkspace] = useState(settings.defaultDirectory);
  const [reasoning, setReasoning] = useState<ReasoningEffort>(settings.defaultReasoning);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [saveError, setSaveError] = useState(false);
  const [ultraIntro, setUltraIntro] = useState(false);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [providerBusy, setProviderBusy] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState(settings.defaultProviderId);
  const latestWrite = useRef(0);
  const previousReasoning = useRef(reasoning);
  const ultraIntroTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useTheme(settings);

  useEffect(() => {
    let active = true;
    void desktop.listProviders().then((loadedProviders) => {
      if (!active) return;
      setProviders(loadedProviders);
      setActiveProviderId((current) => {
        if (loadedProviders.some((provider) => provider.id === current)) return current;
        return loadedProviders[0]?.id ?? "";
      });
    });
    return () => {
      active = false;
    };
  }, []);

  const ultraEffectsEnabled = settings.signalEffects && !settings.reducedMotion;

  useEffect(() => {
    const enteredUltra = previousReasoning.current !== "ultra" && reasoning === "ultra";
    if (ultraIntroTimer.current) clearTimeout(ultraIntroTimer.current);
    ultraIntroTimer.current = null;

    if (enteredUltra && ultraEffectsEnabled) {
      setUltraIntro(true);
      void desktop.pulseUltraWindow();
      ultraIntroTimer.current = setTimeout(() => setUltraIntro(false), 2_400);
    } else if (reasoning !== "ultra" || !ultraEffectsEnabled) {
      setUltraIntro(false);
    }
    previousReasoning.current = reasoning;
  }, [reasoning, ultraEffectsEnabled]);

  useEffect(
    () => () => {
      if (ultraIntroTimer.current) clearTimeout(ultraIntroTimer.current);
    },
    [],
  );

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      const write = latestWrite.current + 1;
      latestWrite.current = write;
      setSettings((current) => (current ? { ...current, ...patch } : current));
      setPendingWrites((count) => count + 1);
      setSaveError(false);
      void saveSettings(patch)
        .then((saved) => {
          if (latestWrite.current === write) setSettings(saved);
        })
        .catch(() => setSaveError(true))
        .finally(() => setPendingWrites((count) => Math.max(0, count - 1)));
    },
    [setSettings],
  );

  const chooseDirectory = useCallback(async () => {
    const selected = await desktop.chooseDirectory();
    if (!selected) return;
    setWorkspace(selected);
    updateSettings({ defaultDirectory: selected });
  }, [updateSettings]);

  const selectProvider = useCallback((providerId: string) => {
    setActiveProviderId(providerId);
    updateSettings({ defaultProviderId: providerId });
  }, [updateSettings]);

  const saveProvider = useCallback(async (input: ProviderSaveInput) => {
    setProviderBusy(true);
    try {
      const next = await desktop.saveProvider(input);
      setProviders(next);
      selectProvider(input.id);
    } finally {
      setProviderBusy(false);
    }
  }, [selectProvider]);

  const removeProvider = useCallback(async (providerId: string) => {
    setProviderBusy(true);
    try {
      const next = await desktop.removeProvider(providerId);
      setProviders(next);
      if (activeProviderId === providerId) selectProvider(next[0]?.id ?? "");
    } finally {
      setProviderBusy(false);
    }
  }, [activeProviderId, selectProvider]);

  const testProvider = useCallback(
    (providerId: string): Promise<ProviderTestResult> => desktop.testProvider(providerId),
    [],
  );

  return (
    <div className={`desktop-shell${reasoning === "ultra" ? " ultra-active" : ""}`}>
      {reasoning === "ultra" && ultraEffectsEnabled && (
        <UltraField intro={ultraIntro} />
      )}
      <TitleBar />
      <div className="desktop-body">
        <BrandRail
          view={view}
          onViewChange={(nextView) => {
            if (nextView === "settings") setSettingsStartPage("general");
            setView(nextView);
          }}
        />
        <div className="surface-frame">
          {view === "workbench" ? (
            <Workbench
              mode={mode}
              reasoning={reasoning}
              workspace={workspace}
              settings={settings}
              providers={providers}
              activeProviderId={activeProviderId}
              ultraIntro={ultraIntro}
              onModeChange={setMode}
              onReasoningChange={setReasoning}
              onProviderChange={selectProvider}
              onChooseDirectory={chooseDirectory}
              onOpenSettings={() => {
                setSettingsStartPage("models");
                setView("settings");
              }}
            />
          ) : (
            <SettingsWorkspace
              settings={settings}
              saving={pendingWrites > 0}
              initialPage={settingsStartPage}
              providers={providers}
              providerBusy={providerBusy}
              onSaveProvider={saveProvider}
              onRemoveProvider={removeProvider}
              onTestProvider={testProvider}
              onUpdate={updateSettings}
              onChooseDirectory={() => void chooseDirectory()}
            />
          )}
        </div>
      </div>
      <footer className="status-bar">
        <span className="status-ready"><CircleDot size={10} /> {t("workbench.local")}</span>
        <span>{isDesktop ? t("workbench.secureBridge") : "BROWSER PREVIEW BRIDGE"}</span>
        {saveError && <strong>SETTINGS WRITE FAILED</strong>}
        <span>KV CODE / 0.1.0</span>
      </footer>
    </div>
  );
}

function TitleBar() {
  const { t } = useI18n();
  return (
    <header className="title-bar">
      <div className="title-drag-region">
        <span className="title-wordmark">KV CODE</span>
        <i />
        <span>{t("app.online")}</span>
      </div>
      <div className="window-controls">
        <button title={t("app.minimize")} onClick={() => void desktop.minimizeWindow()}>
          <Minus size={14} />
        </button>
        <button title={t("app.maximize")} onClick={() => void desktop.toggleMaximizeWindow()}>
          <Maximize2 size={12} />
        </button>
        <button className="window-close" title={t("app.close")} onClick={() => void desktop.closeWindow()}>
          <X size={15} />
        </button>
      </div>
    </header>
  );
}

function BrandRail({
  view,
  onViewChange,
}: {
  view: PrimaryView;
  onViewChange(view: PrimaryView): void;
}) {
  const { t } = useI18n();
  return (
    <aside className="brand-rail">
      <KvMark />
      <nav aria-label="Primary">
        <button
          className={view === "workbench" ? "active" : ""}
          title={t("app.workbench")}
          onClick={() => onViewChange("workbench")}
        >
          <PanelLeft size={18} />
          <span>{t("app.workbench")}</span>
        </button>
        <button
          className={view === "settings" ? "active" : ""}
          title={t("app.settings")}
          onClick={() => onViewChange("settings")}
        >
          <Settings size={18} />
          <span>{t("app.settings")}</span>
        </button>
      </nav>
      <div className="rail-index">01</div>
    </aside>
  );
}

function UltraField({ intro }: { intro: boolean }) {
  return (
    <div className={`ultra-field${intro ? " intro" : " settled"}`} aria-hidden="true">
      <i className="ultra-surge" />
      <i className="ultra-wave wave-one" />
      <i className="ultra-wave wave-two" />
      <i className="ultra-wave wave-three" />
      <span className="ultra-edge" />
    </div>
  );
}

function KvMark() {
  return (
    <div className="kv-mark" aria-label="KV Code">
      <img src={logoUrl} alt="KV Code" draggable={false} />
    </div>
  );
}

function useTheme(settings: AppSettings): void {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      root.dataset.theme = settings.theme === "system" ? (media.matches ? "dark" : "light") : settings.theme;
    };
    apply();
    root.dataset.density = settings.density;
    root.dataset.motion = settings.reducedMotion ? "reduced" : "full";
    root.lang = settings.locale;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.density, settings.locale, settings.reducedMotion, settings.theme]);
}

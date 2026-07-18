import {
  Check,
  ChevronDown,
  KeyRound,
  LoaderCircle,
  Plus,
  RadioTower,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  providerPresets,
  type ProviderProtocol,
  type ProviderSaveInput,
  type ProviderSummary,
  type ProviderTestResult,
} from "../../../shared/providers";
import { useI18n } from "../i18n";

interface ProviderDraft {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
}

const emptyDraft = (): ProviderDraft => ({
  id: crypto.randomUUID(),
  name: "",
  protocol: "openai-chat",
  baseUrl: "https://",
  model: "",
  apiKey: "",
});

export function ProviderSettings({
  providers,
  busy,
  onSave,
  onRemove,
  onTest,
}: {
  providers: ProviderSummary[];
  busy: boolean;
  onSave(input: ProviderSaveInput): Promise<void>;
  onRemove(providerId: string): Promise<void>;
  onTest(providerId: string): Promise<ProviderTestResult>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ProviderDraft>(emptyDraft);
  const [selectedId, setSelectedId] = useState<string>("");
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const selected = useMemo(
    () => providers.find((provider) => provider.id === selectedId),
    [providers, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    setDraft({ ...selected, apiKey: "" });
    setTestResult(null);
    setAdvancedOpen(!presetFor(selected));
  }, [selected]);

  useEffect(() => {
    if (!selectedId && providers.length > 0 && !creatingNew) {
      setSelectedId(providers[0]?.id ?? "");
    }
  }, [creatingNew, providers, selectedId]);

  const activePreset = presetFor(draft);
  const canConnect = Boolean(
    draft.name.trim() &&
    draft.baseUrl !== "https://" &&
    draft.model.trim() &&
    (draft.apiKey.trim() || selected?.hasApiKey),
  );

  const selectProvider = (provider: ProviderSummary) => {
    setCreatingNew(false);
    setSelectedId(provider.id);
    setDraft({ ...provider, apiKey: "" });
    setTestResult(null);
    setAdvancedOpen(!presetFor(provider));
  };

  const addProvider = () => {
    setCreatingNew(true);
    setSelectedId("");
    setDraft(emptyDraft());
    setTestResult(null);
    setAdvancedOpen(false);
  };

  const applyPreset = (presetId: string) => {
    const preset = providerPresets.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    setDraft((current) => ({
      ...current,
      name: preset.name,
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
      model: preset.model,
    }));
    setTestResult(null);
    setAdvancedOpen(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTesting(true);
    setTestResult(null);
    try {
      await onSave({
        id: draft.id,
        name: draft.name,
        protocol: draft.protocol,
        baseUrl: draft.baseUrl,
        model: draft.model,
        apiKey: draft.apiKey || undefined,
      });
      setSelectedId(draft.id);
      setCreatingNew(false);
      setDraft((current) => ({ ...current, apiKey: "" }));
      setTestResult(await onTest(draft.id));
    } catch {
      setTestResult({
        ok: false,
        message: t("settings.providerSaveFailed"),
        latencyMs: 0,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="provider-settings">
      <header className="settings-section-header">
        <small>ENCRYPTED PROVIDER PLANE</small>
        <h1>{t("settings.modelsTitle")}</h1>
        <p>{t("settings.modelsDetail")}</p>
      </header>

      <div className="provider-tabs">
        {providers.map((provider) => (
          <button
            className={selectedId === provider.id ? "active" : ""}
            key={provider.id}
            onClick={() => selectProvider(provider)}
          >
            <RadioTower size={14} />
            <span>{provider.name}</span>
            <small>{provider.model}</small>
          </button>
        ))}
        <button className={creatingNew || !selectedId ? "active add" : "add"} onClick={addProvider}>
          <Plus size={15} />
          <span>{t("settings.addProvider")}</span>
        </button>
      </div>

      <form className="provider-form" onSubmit={(event) => void submit(event)}>
        <div className="provider-quick-setup">
          <header>
            <span>{t("settings.quickProvider")}</span>
            <small>{t("settings.quickProviderDetail")}</small>
          </header>
          <div className="provider-preset-grid">
            {providerPresets.map((preset) => (
              <button
                className={activePreset?.id === preset.id ? "active" : ""}
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
              >
                <RadioTower size={15} />
                <span>{preset.name}</span>
                <small>{preset.model}</small>
                {activePreset?.id === preset.id && <Check size={13} />}
              </button>
            ))}
            <button
              className={!activePreset && advancedOpen ? "active custom" : "custom"}
              type="button"
              onClick={() => setAdvancedOpen(true)}
            >
              <Plus size={15} />
              <span>{t("settings.customProvider")}</span>
              <small>OpenAI / Anthropic / Gemini</small>
            </button>
          </div>
        </div>

        <label className="provider-key-field">
          <span><KeyRound size={13} /> {t("settings.apiKey")}</span>
          <input
            type="password"
            autoComplete="off"
            maxLength={1_024}
            value={draft.apiKey}
            placeholder={selected?.hasApiKey ? "••••••••••••••••" : "sk-..."}
            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
          />
          <small>
            <ShieldCheck size={12} />
            {selected?.hasApiKey
              ? t("settings.apiKeyConfigured")
              : t("settings.apiKeyDetail")}
          </small>
        </label>

        <button
          className={`provider-advanced-toggle${advancedOpen ? " active" : ""}`}
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <SlidersHorizontal size={14} />
          <span>{t("settings.advancedProvider")}</span>
          {!advancedOpen && activePreset && <small>{t("settings.managedAutomatically")}</small>}
          <ChevronDown size={14} />
        </button>

        {advancedOpen && (
          <div className="provider-advanced-fields">
            <label>
              <span>{t("settings.providerName")}</span>
              <input
                required
                maxLength={80}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label>
              <span>{t("settings.protocol")}</span>
              <select
                value={draft.protocol}
                onChange={(event) => setDraft({
                  ...draft,
                  protocol: event.target.value as ProviderProtocol,
                })}
              >
                <option value="openai-responses">OpenAI Responses</option>
                <option value="openai-chat">OpenAI-compatible Chat Completions</option>
                <option value="anthropic">Anthropic Messages</option>
                <option value="google-gemini">Google Gemini</option>
              </select>
            </label>
            <label>
              <span>{t("settings.baseUrl")}</span>
              <input
                required
                type="url"
                maxLength={2_048}
                value={draft.baseUrl}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              />
            </label>
            <label>
              <span>{t("settings.modelId")}</span>
              <input
                required
                maxLength={200}
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              />
            </label>
          </div>
        )}

        {testResult && (
          <div className={`provider-test-result${testResult.ok ? " ok" : " error"}`}>
            {testResult.ok ? <Check size={15} /> : <RadioTower size={15} />}
            <span>{testResult.message}</span>
            {testResult.latencyMs > 0 && <small>{testResult.latencyMs} ms</small>}
          </div>
        )}

        <div className="provider-actions">
          {selected && (
            <button type="button" className="danger-command" onClick={() => setPendingDelete(true)}>
              <Trash2 size={14} /> {t("settings.removeProvider")}
            </button>
          )}
          <button
            className="primary-command"
            type="submit"
            disabled={busy || testing || !canConnect}
          >
            {testing ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} />}
            {testing ? t("settings.connectingProvider") : t("settings.connectProvider")}
          </button>
        </div>
      </form>

      {pendingDelete && selected && (
        <div className="confirm-overlay" role="dialog" aria-modal="true">
          <div className="confirm-dialog">
            <Trash2 size={20} />
            <strong>{t("settings.removeProvider")}</strong>
            <p>{t("settings.confirmRemove")}</p>
            <div>
              <button onClick={() => setPendingDelete(false)}>{t("settings.cancel")}</button>
              <button
                className="danger-command"
                onClick={() => {
                  void onRemove(selected.id).then(() => {
                    setPendingDelete(false);
                    addProvider();
                  });
                }}
              >
                {t("settings.remove")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function presetFor(provider: Pick<ProviderDraft, "baseUrl" | "protocol">) {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  return providerPresets.find(
    (preset) =>
      preset.protocol === provider.protocol &&
      preset.baseUrl.replace(/\/+$/, "") === baseUrl,
  );
}

import { Code2, Eye, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { desktop } from "../lib/desktop";
import type { InlineCodeLanguage } from "./inline-code-fence";
import {
  buildInteractiveDocument,
  compileInteractiveSource,
  validateInteractiveSource,
} from "./inline-code-runtime";
import { sanitizeSvgDataUrl } from "./svg-rendering";

export default function InlineCodePreview({
  language,
  source,
}: {
  language: InlineCodeLanguage;
  source: string;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<"rendered" | "source">("rendered");
  const [revision, setRevision] = useState(0);
  const [height, setHeight] = useState(280);
  const [ready, setReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");
  const [frameSource, setFrameSource] = useState("");
  const frame = useRef<HTMLIFrameElement | null>(null);
  const id = useId();
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const result = useMemo(() => {
    if (language === "svg") {
      const svg = sanitizeSvgDataUrl(source);
      return { error: svg.error, document: "", image: svg.image };
    }
    const error = validateInteractiveSource(source);
    if (error) return { error, document: "", image: "" };
    try {
      return {
        error: "",
        document: buildInteractiveDocument({
          compiledSource: compileInteractiveSource(source),
          id,
          theme,
        }),
        image: "",
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : t("workbench.inlineCompileFailed"),
        document: "",
        image: "",
      };
    }
  }, [id, language, revision, source, t, theme]);

  useEffect(() => {
    setReady(false);
    setRuntimeError("");
  }, [revision, source]);

  useEffect(() => {
    let active = true;
    let registeredUrl = "";
    setFrameSource("");
    if (language === "svg" || !result.document) return () => {};
    void desktop.registerInlineDocument(result.document)
      .then((url) => {
        registeredUrl = url;
        if (active) setFrameSource(url);
        else void desktop.removeInlineDocument(url);
      })
      .catch((error: unknown) => {
        if (active) {
          setRuntimeError(error instanceof Error ? error.message : "Interactive preview registration failed.");
        }
      });
    return () => {
      active = false;
      if (registeredUrl) void desktop.removeInlineDocument(registeredUrl);
    };
  }, [language, result.document]);

  useEffect(() => {
    if (language === "svg" || !result.document) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.id !== id) return;
      if (event.data?.type === "kv-inline-resize") {
        const nextHeight = Number(event.data.height);
        if (Number.isFinite(nextHeight)) setHeight(Math.min(720, Math.max(180, nextHeight)));
      } else if (event.data?.type === "kv-inline-ready") {
        setReady(true);
      } else if (event.data?.type === "kv-inline-error") {
        setRuntimeError(String(event.data.message || "Interactive component failed."));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [id, language, result.document]);

  return (
    <section className="inline-code-preview">
      <div className="inline-code-toolbar">
        <span>{language.toUpperCase()}</span>
        <button
          className={view === "source" ? "active" : ""}
          title={t("workbench.source")}
          aria-pressed={view === "source"}
          onClick={() => setView("source")}
        ><Code2 size={13} /><span>{t("workbench.source")}</span></button>
        <button
          className={view === "rendered" ? "active" : ""}
          title={t("workbench.rendered")}
          aria-pressed={view === "rendered"}
          onClick={() => setView("rendered")}
        ><Eye size={13} /><span>{t("workbench.rendered")}</span></button>
        {language !== "svg" && view === "rendered" && (
          <button
            title={t("workbench.inlineRestart")}
            onClick={() => setRevision((value) => value + 1)}
          ><RotateCcw size={12} /></button>
        )}
      </div>
      {view === "source" ? (
        <pre className="inline-code-source"><code>{source}</code></pre>
      ) : result.error || runtimeError ? (
        <div className="inline-code-error"><TriangleAlert size={17} /><span>{result.error || runtimeError}</span></div>
      ) : language === "svg" ? (
        <div className="inline-svg-stage"><img src={result.image} alt="" /></div>
      ) : !frameSource ? (
        <div className="inline-code-loading">{t("workbench.inlineRendering")}</div>
      ) : (
        <iframe
          key={revision}
          ref={frame}
          className="inline-code-frame"
          data-ready={ready ? "true" : "false"}
          sandbox="allow-scripts"
          src={frameSource}
          style={{ height: `${height}px` }}
          title={t("workbench.inlinePreview")}
        />
      )}
    </section>
  );
}

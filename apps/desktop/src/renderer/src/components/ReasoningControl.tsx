import { Gauge, Sparkles } from "lucide-react";
import type { CSSProperties } from "react";
import type { ReasoningEffort } from "../../../shared/settings";
import { useI18n, type MessageKey } from "../i18n";

const stops: Array<{ effort: ReasoningEffort; position: number }> = [
  { effort: "low", position: 5 },
  { effort: "medium", position: 17 },
  { effort: "high", position: 37 },
  { effort: "xhigh", position: 65 },
  { effort: "ultra", position: 100 },
];

const effortLabels: Record<ReasoningEffort, MessageKey> = {
  low: "reasoning.low",
  medium: "reasoning.medium",
  high: "reasoning.high",
  xhigh: "reasoning.xhigh",
  ultra: "reasoning.ultra",
};

export function ReasoningControl({
  value,
  onChange,
  signalEffects,
  animatePulse = false,
  compact = false,
}: {
  value: ReasoningEffort;
  onChange(value: ReasoningEffort): void;
  signalEffects: boolean;
  animatePulse?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const position = stops.find((stop) => stop.effort === value)?.position ?? 55;
  const isUltra = value === "ultra";

  return (
    <section
      className={`reasoning-control${compact ? " compact" : ""}${isUltra ? " ultra" : ""}${signalEffects ? " signal" : ""}`}
    >
      <div className="reasoning-heading">
        <span>{isUltra ? <Sparkles size={15} /> : <Gauge size={15} />}</span>
        <div>
          <small>{t("reasoning.title")}</small>
          <strong>{t(effortLabels[value])}</strong>
        </div>
        <output>{value.toUpperCase()}</output>
      </div>
      <div className="reasoning-track-wrap">
        <div
          className="reasoning-rail"
          style={{ "--reasoning-position": `${position}%` } as CSSProperties}
          aria-hidden="true"
        >
          <i className="reasoning-fill" />
          <i className="reasoning-thumb" />
        </div>
        <input
          aria-label={t("reasoning.title")}
          aria-valuetext={t(effortLabels[value])}
          type="range"
          min="0"
          max="100"
          step="1"
          value={position}
          style={{ "--reasoning-position": `${position}%` } as CSSProperties}
          onInput={(event) => onChange(effortAt(Number(event.currentTarget.value)))}
        />
        <div className="reasoning-ticks" aria-hidden="true">
          {stops.map((stop) => (
            <i
              className={stop.effort === value ? "active" : ""}
              key={stop.effort}
              style={{ left: `${stop.position}%` }}
            />
          ))}
        </div>
      </div>
      {!compact && (
        <div className="reasoning-labels" aria-hidden="true">
          {stops.map((stop) => (
            <span key={stop.effort} style={{ left: `${stop.position}%` }}>
              {stop.effort === "medium" ? "MED" : stop.effort.toUpperCase()}
            </span>
          ))}
        </div>
      )}
      {isUltra && signalEffects && animatePulse && (
        <div className="ultra-pulse" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
    </section>
  );
}

function effortAt(position: number): ReasoningEffort {
  if (position < 11) return "low";
  if (position < 27) return "medium";
  if (position < 51) return "high";
  if (position < 83) return "xhigh";
  return "ultra";
}

import { useEffect, useRef, useState } from "react";
import { Button, Glass, Menu } from "glisse";
import { PAGE_COUNT } from "../lib/quran/book";
import { formatDuration } from "../lib/format";
import { useModelStatus, type ModelStatus } from "../state/model";
import { dismissError, onLevel, useRecitation, type RecitationState } from "../state/recitation";
import { useSettings } from "../state/settings";
import { useText } from "../state/text";
import { openSheet } from "../state/ui";
import { ChevronIcon, CrossIcon, DownloadIcon, EyeIcon, EyeOffIcon, ListIcon, MicIcon, SparkIcon, StopIcon, TrashIcon } from "./icons";
import { ayahLabel, problemMessage } from "./labels";

interface Props {
  page: number;
  selected: number | null;
  onSelect: (ayah: number | null) => void;
  onStart: (fromAyah?: number) => void;
  onStop: () => void;
  onTurn: (delta: 1 | -1) => void;
  onHint: () => void;
  onClearPage: () => void;
  onClearAll: () => void;
}

function useStatus(rec: RecitationState, textReady: boolean): string {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const text = useText();
  const where = rec.live?.heard.at(-1) ?? (rec.cursor !== null && rec.cursor > 0 ? rec.cursor - 1 : null);
  switch (rec.phase) {
    case "starting":
      return textReady ? t.dockListening : t.dockPreparing;
    case "listening":
      if (where === null || !text) return rec.live ? t.dockSearching : t.dockListening;
      return t.dockFollowing(ayahLabel(text.corpus.ayahOfWord[where]!, lang));
    case "finishing":
      return t.dockFinishing;
    default:
      return rec.startAyah !== null ? t.dockFrom(ayahLabel(rec.startAyah, lang)) : t.dockIdle;
  }
}

/** The floating controls: page turning, contents, the microphone, and "recite from memory". */
export function MicDock(props: Props) {
  const { page, selected, onSelect, onStart, onStop, onTurn, onHint, onClearPage, onClearAll } = props;
  const { t, settings, update } = useSettings();
  const rec = useRecitation();
  const model = useModelStatus();
  const text = useText();
  const status = useStatus(rec, text !== null);
  const busy = rec.phase !== "idle";
  const listening = rec.phase === "listening";

  return (
    <div className="dock-wrap">
      {selected !== null && !busy && (
        <Glass className="ayah-bar" role="group" aria-label={ayahLabel(selected, settings.lang)}>
          <span className="ayah-bar-label">{ayahLabel(selected, settings.lang)}</span>
          <Button variant="filled" icon={<MicIcon size={18} />} onClick={() => onStart(selected)}>
            {t.reciteFromHere}
          </Button>
          <Button aria-label={t.close} icon={<CrossIcon size={18} />} onClick={() => onSelect(null)} />
        </Glass>
      )}

      <Glass className="dock">
        {rec.error ? (
          <p className="dock-status dock-error" role="alert">
            <span>{rec.error.problem === "model" ? `${t.modelFailed} ${rec.error.detail ?? ""}` : problemMessage(rec.error.problem, t)}</span>
            <button type="button" className="dock-dismiss" aria-label={t.close} onClick={dismissError}>
              <CrossIcon size={16} />
            </button>
          </p>
        ) : (
          <p className="dock-status" role="status" aria-live="polite">
            {listening && <Elapsed since={rec.startedAt} />}
            <span>{status}</span>
          </p>
        )}

        {/* Pages turn like a Mushaf: the next page is on the left, in every interface language. */}
        <div className="dock-row" dir="rtl">
          <Button aria-label={t.previousPage} icon={<ChevronIcon size={20} className="mirror" />} disabled={page <= 1} onClick={() => onTurn(-1)} />
          <Button aria-label={t.contents} icon={<ListIcon size={20} />} onClick={() => openSheet("index")} />
          <MicButton phase={rec.phase} model={model} onStart={() => (model.phase === "ready" ? onStart() : openSheet("model"))} onStop={onStop} />
          <Button
            aria-label={t.fromMemory}
            aria-pressed={settings.memorize}
            className={settings.memorize ? "is-on" : undefined}
            icon={settings.memorize ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
            onClick={() => update({ memorize: !settings.memorize })}
          />
          <Button aria-label={t.nextPage} icon={<ChevronIcon size={20} />} disabled={page >= PAGE_COUNT} onClick={() => onTurn(1)} />
          <Menu
            aria-label={t.moreActions}
            align="start"
            items={[
              ...(settings.memorize ? [{ label: t.nextWord, icon: <SparkIcon size={18} />, onSelect: onHint }, "separator" as const] : []),
              { label: t.clearPage, icon: <TrashIcon size={18} />, onSelect: onClearPage, disabled: busy },
              { label: t.clearAll, icon: <TrashIcon size={18} />, onSelect: onClearAll, destructive: true, disabled: busy },
            ]}
          />
        </div>
        {settings.memorize && !busy && <p className="dock-note">{t.fromMemoryHint}</p>}
      </Glass>
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const { settings } = useSettings();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((performance.now() - since) / 1000), 500);
    return () => clearInterval(id);
  }, [since]);
  // Not announced: it would be read out twice a second.
  return (
    <span className="dock-time tabular-nums" aria-hidden="true">
      {formatDuration(seconds, settings.lang)}
    </span>
  );
}

function MicButton(props: { phase: RecitationState["phase"]; model: ModelStatus; onStart: () => void; onStop: () => void }) {
  const { phase, model, onStart, onStop } = props;
  const { t } = useSettings();
  const ref = useRef<HTMLButtonElement>(null);
  const listening = phase === "listening";

  // The level drives a CSS variable directly: ~20 updates a second without re-rendering.
  useEffect(() => {
    if (!listening) return;
    const el = ref.current;
    const off = onLevel((rms) => el?.style.setProperty("--level", String(Math.min(1, Math.sqrt(rms) * 2.2))));
    return () => {
      off();
      el?.style.setProperty("--level", "0");
    };
  }, [listening]);

  const waiting = phase === "starting" || phase === "finishing";
  const preparing = model.phase === "downloading" || model.phase === "loading" || model.phase === "checking";
  const label = listening
    ? t.micStop
    : model.phase === "ready"
      ? t.micStart
      : model.phase === "downloading"
        ? t.modelDownloading
        : preparing
          ? t.modelLoading
          : t.micGetModel;
  const progress = model.phase === "downloading" && model.total > 0 ? model.loaded / model.total : null;
  return (
    <button
      ref={ref}
      type="button"
      className={`mic${listening ? " mic-on" : ""}${progress !== null ? " mic-progress" : ""}`}
      style={progress !== null ? ({ "--progress": progress } as React.CSSProperties) : undefined}
      aria-label={label}
      title={label}
      disabled={waiting}
      onClick={listening ? onStop : onStart}
    >
      {waiting || preparing ? (
        <span className="spinner mic-spinner" aria-hidden="true" />
      ) : listening ? (
        <StopIcon size={26} />
      ) : model.phase !== "ready" ? (
        <DownloadIcon size={26} />
      ) : (
        <MicIcon size={28} />
      )}
    </button>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Glass } from "glisse";
import { formatDuration, formatPercent } from "../lib/format";
import { promptInstall, useInstallOption } from "../lib/pwa";
import { useModelStatus, type ModelStatus } from "../state/model";
import { dismissError, onLevel, showLastSummary, useRecitation, type RecitationState } from "../state/recitation";
import { navigate } from "../state/route";
import { useSettings } from "../state/settings";
import { useText } from "../state/text";
import { openSheet, useSheet } from "../state/ui";
import { CrossIcon, DownloadIcon, EyeIcon, EyeOffIcon, GearIcon, GlobeIcon, HintIcon, InfoIcon, InstallIcon, ListIcon, MicIcon, MoonIcon, MoreIcon, StopIcon, SunIcon, TargetIcon, TrashIcon } from "./icons";
import { Sheet } from "./Sheet";
import { ayahLabel, problemMessage } from "./labels";

interface Props {
  selected: number | null;
  onSelect: (ayah: number | null) => void;
  onStart: (fromAyah?: number) => void;
  onStop: () => void;
  onHint: () => void;
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

/**
 * One compact row at the bottom of the book: contents, "recite from memory", the microphone, the next
 * word (when reciting from memory) or the last results, and everything else in a menu. It never covers
 * the page: only an error floats above it.
 */
export function MicDock(props: Props) {
  const { selected, onSelect, onStart, onStop, onHint } = props;
  const { t, settings, update } = useSettings();
  const rec = useRecitation();
  const model = useModelStatus();
  const text = useText();
  const status = useStatus(rec, text !== null);
  const busy = rec.phase !== "idle";
  const listening = rec.phase === "listening";
  const last = rec.lastSummary;

  // The left of the dock follows what is going on: where the reciter is while reciting, the chosen
  // ayah when one is selected, otherwise contents and "recite from memory".
  let left: ReactNode;
  if (busy) {
    left = (
      <p className="dock-status" aria-live="polite">
        {listening && <Elapsed since={rec.startedAt} />}
        <span className="dock-status-text">{status}</span>
      </p>
    );
  } else if (selected !== null) {
    left = (
      <p className="dock-status dock-from">
        <span className="dock-status-text">{t.dockFrom(ayahLabel(selected, settings.lang))}</span>
        <button type="button" className="dock-dismiss" aria-label={t.close} onClick={() => onSelect(null)}>
          <CrossIcon size={14} />
        </button>
      </p>
    );
  } else {
    left = (
      <>
        <Button aria-label={t.contents} title={t.contents} icon={<ListIcon size={20} />} onClick={() => openSheet("index")} />
        <Button
          aria-label={t.fromMemory}
          title={t.fromMemory}
          aria-pressed={settings.memorize}
          className={settings.memorize ? "is-on" : undefined}
          icon={settings.memorize ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
          onClick={() => update({ memorize: !settings.memorize })}
        />
      </>
    );
  }

  return (
    <div className="dock-area">
      {/* Only problems float above the dock; everything else stays in it, off the page. */}
      <div className="dock-float" role="alert">
        {rec.error && (
          <p className="dock-pill dock-error">
            <span>{rec.error.problem === "model" ? `${t.modelFailed} ${rec.error.detail ?? ""}` : problemMessage(rec.error.problem, t)}</span>
            <button type="button" className="dock-dismiss" aria-label={t.close} onClick={dismissError}>
              <CrossIcon size={16} />
            </button>
          </p>
        )}
      </div>
      <Glass className="dock">
        {left}
        <MicButton
          phase={rec.phase}
          model={model}
          onStart={() => (model.phase === "ready" ? onStart(selected ?? undefined) : openSheet("model"))}
          onStop={onStop}
        />
        {settings.memorize ? (
          <Button aria-label={t.nextWord} title={t.nextWord} icon={<HintIcon size={20} />} disabled={!text} onClick={onHint} />
        ) : last ? (
          <Button aria-label={`${t.lastResults}: ${formatPercent(last.accuracy, settings.lang)}`} title={t.lastResults} onClick={showLastSummary}>
            <span className="dock-score">{formatPercent(last.accuracy, settings.lang)}</span>
          </Button>
        ) : (
          <span className="dock-slot" aria-hidden="true" />
        )}
        <Button aria-label={t.moreActions} title={t.moreActions} icon={<MoreIcon size={20} />} onClick={() => openSheet("more")} />
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

interface MoreProps {
  busy: boolean;
  onClearPage: () => void;
  onClearAll: () => void;
}

/** Everything that does not need a place on the dock, in a sheet that rises from it. */
export function MoreSheet({ busy, onClearPage, onClearAll }: MoreProps) {
  const { t, settings, update, resolvedTheme } = useSettings();
  const { lastSummary } = useRecitation();
  const install = useInstallOption();
  const [installHint, setInstallHint] = useState(false);
  const open = useSheet() === "more";
  const close = () => {
    setInstallHint(false);
    openSheet(null);
  };
  const run = (action: () => void) => () => {
    close();
    action();
  };
  const dark = resolvedTheme === "dark";
  return (
    <Sheet open={open} onClose={close} title={t.moreTitle} className="more-sheet">
      <ul className="action-list">
        {lastSummary && (
          <li>
            <button type="button" className="action-row" onClick={run(showLastSummary)}>
              <TargetIcon size={20} /> {t.lastResults}
              <span className="action-meta">{formatPercent(lastSummary.accuracy, settings.lang)}</span>
            </button>
          </li>
        )}
        {install && (
          <li>
            <button
              type="button"
              className="action-row"
              aria-expanded={install === "share-menu" ? installHint : undefined}
              onClick={install === "prompt" ? run(() => void promptInstall()) : () => setInstallHint((shown) => !shown)}
            >
              <InstallIcon size={20} /> {t.installApp}
            </button>
            {install === "share-menu" && installHint && <p className="action-hint">{t.installHint}</p>}
          </li>
        )}
        <li>
          <button type="button" className="action-row" onClick={run(() => navigate({ view: "settings" }))}>
            <GearIcon size={20} /> {t.tabSettings}
          </button>
        </li>
        <li>
          <button type="button" className="action-row" onClick={run(() => navigate({ view: "about" }))}>
            <InfoIcon size={20} /> {t.menuAbout}
          </button>
        </li>
        <li>
          <button type="button" className="action-row" onClick={run(() => update({ lang: settings.lang === "ar" ? "en" : "ar" }))}>
            <GlobeIcon size={20} /> <span lang={settings.lang === "ar" ? "en" : "ar"}>{t.menuLanguage}</span>
          </button>
        </li>
        <li>
          <button type="button" className="action-row" onClick={run(() => update({ theme: dark ? "light" : "dark" }))}>
            {dark ? <SunIcon size={20} /> : <MoonIcon size={20} />} {dark ? t.appearanceLight : t.appearanceDark}
          </button>
        </li>
        <li>
          <button type="button" className="action-row" disabled={busy} onClick={run(onClearPage)}>
            <TrashIcon size={20} /> {t.clearPage}
          </button>
        </li>
        <li>
          <button type="button" className="action-row action-destructive" disabled={busy} onClick={run(onClearAll)}>
            <TrashIcon size={20} /> {t.clearAll}
          </button>
        </li>
      </ul>
    </Sheet>
  );
}

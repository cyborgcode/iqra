import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Glass } from "glisse";
import { Toggle } from "./Directional";
import { SURAHS } from "../data/surahs";
import { loadSurah, type SurahText } from "../lib/quran/load";
import { ayahWords } from "../lib/quran/tokenize";
import { startRecording, recorderSupport, RecorderError, type RecorderHandle, type RecorderProblem } from "../lib/audio/recorder";
import { asr } from "../lib/asr/client";
import { evaluateRecitation, expectedWords } from "../lib/recitation/evaluate";
import { optionalPhrasesFor } from "../lib/recitation/phrases";
import { joinSegments } from "../lib/recitation/transcript";
import { LiveTranscriber } from "../lib/recitation/live";
import { formatDuration } from "../lib/format";
import { prepareModel, useModelStatus } from "../state/model";
import { useSettings } from "../state/settings";
import type { Strings } from "../i18n";
import { SurahPicker } from "./SurahPicker";
import { RangePicker } from "./RangePicker";
import { ModelGate } from "./ModelGate";
import { QuranText, type AyahLine } from "./QuranText";
import { Details, Legend, ResultsSummary } from "./Results";
import { MicIcon, StopIcon } from "./icons";

type Stage =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "recording"; startedAt: number }
  | { kind: "processing"; done: number; total: number }
  | { kind: "results"; transcript: string; limitReached: boolean }
  | { kind: "error"; message: string };

const MAX_SECONDS = 15 * 60;

function problemMessage(problem: RecorderProblem, t: Strings): string {
  switch (problem) {
    case "denied":
      return t.micDenied;
    case "no-microphone":
      return t.micMissing;
    case "busy":
      return t.micBusy;
    case "insecure-context":
      return t.micInsecure;
    case "unsupported":
      return t.micUnsupported;
    default:
      return t.micFailed;
  }
}

function canRunModel(): boolean {
  return typeof WebAssembly === "object" && typeof Worker !== "undefined";
}

function defaultRange(ayahs: number): [number, number] {
  return [1, ayahs <= 15 ? ayahs : 5];
}

export function PracticeView() {
  const { t, settings } = useSettings();
  const model = useModelStatus();
  const [surahNo, setSurahNo] = useState<number | null>(null);
  const [text, setText] = useState<SurahText | null>(null);
  const [range, setRange] = useState<[number, number]>([1, 1]);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [memorize, setMemorize] = useState(settings.memorize);
  const handle = useRef<RecorderHandle | null>(null);
  const live = useRef<LiveTranscriber | null>(null);
  const rangeRef = useRef<HTMLElement | null>(null);
  const reciteRef = useRef<HTMLElement | null>(null);

  const surah = surahNo ? SURAHS[surahNo - 1]! : null;

  useEffect(() => {
    if (surahNo !== null) void prepareModel(settings.model, settings.engine);
  }, [surahNo, settings.model, settings.engine]);

  const selectSurah = useCallback((n: number) => {
    handle.current?.cancel();
    setSurahNo(n);
    setText(null);
    setRange(defaultRange(SURAHS[n - 1]!.ayahs));
    setStage({ kind: "idle" });
    void loadSurah(n).then(setText, () => setStage({ kind: "error", message: t.modelFailed }));
    requestAnimationFrame(() => rangeRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, [t.modelFailed]);

  const lines: AyahLine[] = useMemo(
    () => (text ? text.ayahs.slice(range[0] - 1, range[1]).map((ayahText, i) => ({ number: range[0] + i, text: ayahText })) : []),
    [text, range],
  );
  const wordCount = useMemo(() => lines.reduce((n, l) => n + ayahWords(l.text).length, 0), [lines]);

  const evaluation = useMemo(() => {
    if (stage.kind !== "results" || !surahNo) return null;
    return evaluateRecitation(expectedWords(lines), stage.transcript, {
      threshold: settings.threshold,
      ...optionalPhrasesFor(surahNo, range[0]),
    });
  }, [stage, lines, settings.threshold, surahNo, range]);

  // Keep the screen awake while reciting (phones dim quickly).
  useEffect(() => {
    if (stage.kind !== "recording" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock.request("screen").then((l) => (lock = l), () => {});
    return () => void lock?.release().catch(() => {});
  }, [stage.kind]);

  // While recording, finished phrases are transcribed in the background (see LiveTranscriber).
  useEffect(() => {
    if (stage.kind !== "recording") return;
    const timer = setInterval(() => {
      if (handle.current && live.current) live.current.update(handle.current.samples());
    }, 1000);
    return () => clearInterval(timer);
  }, [stage.kind]);

  const finish = useCallback(
    async (limitReached = false) => {
      const current = handle.current;
      const transcriber = live.current;
      if (!current || !transcriber) return;
      handle.current = null;
      const recording = await current.stop();
      setStage({ kind: "processing", done: 0, total: 0 });
      try {
        const texts = await transcriber.finish(recording.samples, (done, total) => setStage({ kind: "processing", done, total }));
        if (live.current !== transcriber) return; // cancelled meanwhile
        live.current = null;
        if (import.meta.env.DEV) console.info(`recorded ${recording.seconds.toFixed(1)} s in ${texts.length} segments`);
        if (texts.length === 0) {
          setStage({ kind: "error", message: t.nothingHeard });
          return;
        }
        setStage({ kind: "results", transcript: joinSegments(texts), limitReached });
        requestAnimationFrame(() => reciteRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
      } catch (error) {
        setStage({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    },
    [t.nothingHeard],
  );

  const begin = useCallback(async () => {
    setStage({ kind: "starting" });
    try {
      live.current = new LiveTranscriber((segment) => asr.transcribe([segment]).then((texts) => texts[0] ?? ""));
      handle.current = await startRecording({ maxSeconds: MAX_SECONDS, onLevel: emitLevel, onLimit: () => void finish(true) });
      setStage({ kind: "recording", startedAt: performance.now() });
    } catch (error) {
      live.current = null;
      const problem = error instanceof RecorderError ? error.problem : "failed";
      setStage({ kind: "error", message: problemMessage(problem, t) });
    }
  }, [finish, t]);

  const cancel = () => {
    handle.current?.cancel();
    handle.current = null;
    live.current = null;
    setStage({ kind: "idle" });
  };

  useEffect(() => () => handle.current?.cancel(), []);

  const support = recorderSupport();
  const blocked = support ? problemMessage(support, t) : canRunModel() ? null : t.noWasm;
  const busy = stage.kind === "starting" || stage.kind === "recording" || stage.kind === "processing";
  const hideText = memorize && stage.kind !== "results";
  const ready = model.phase === "ready";

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted text-center">{t.tagline}</p>

      <Glass className="card" role="region" aria-labelledby="step-1">
        <div className="card-head">
          <h2 id="step-1" className="step-title">
            <span className="step-no" aria-hidden="true">
              1
            </span>
            {t.stepSurah}
          </h2>
          {surah && (
            <Button onClick={() => setSurahNo(null)} disabled={busy}>
              {t.change}
            </Button>
          )}
        </div>
        {surah ? (
          <p className="selected-surah">
            <span className="surah-ar" lang="ar">
              {surah.name}
            </span>
            <span className="text-muted" lang="en" dir="ltr">
              {surah.number}. {surah.transliteration} · {surah.translation}
            </span>
          </p>
        ) : (
          <SurahPicker onSelect={selectSurah} />
        )}
      </Glass>

      {surah && (
        <section ref={rangeRef} className="scroll-mt-4">
          <Glass className="card" role="region" aria-labelledby="step-2">
            <h2 id="step-2" className="step-title">
              <span className="step-no" aria-hidden="true">
                2
              </span>
              {t.stepRange}
            </h2>
            <fieldset disabled={busy} className="contents">
              <RangePicker
                surah={surah}
                from={range[0]}
                to={range[1]}
                words={wordCount}
                onChange={(from, to) => {
                  setRange([from, to]);
                  setStage({ kind: "idle" });
                }}
              />
            </fieldset>
          </Glass>
        </section>
      )}

      {surah && text && (
        <section ref={reciteRef} className="scroll-mt-4 flex flex-col gap-5">
          <Glass className="card" role="region" aria-labelledby="step-3">
            <div className="card-head">
              <h2 id="step-3" className="step-title">
                <span className="step-no" aria-hidden="true">
                  3
                </span>
                {t.stepRecite}
              </h2>
              <label className="switch-row">
                <span className="text-sm">{t.memorize}</span>
                <Toggle checked={memorize} onCheckedChange={setMemorize} aria-label={t.memorize} disabled={busy} />
              </label>
            </div>

            {hideText ? (
              <div className="hidden-text" aria-live="polite">
                <p>{t.textHidden}</p>
                <p className="text-muted text-sm">{t.rangeHint(lines.length, wordCount)}</p>
              </div>
            ) : (
              <QuranText
                ayahs={lines}
                bismillah={range[0] === 1 ? text.bismillah : null}
                evaluation={evaluation}
                idPrefix="word"
              />
            )}

            {stage.kind !== "results" && (
              <div className="recite-controls">
                {blocked ? (
                  <p className="field-error" role="alert">
                    {blocked}
                  </p>
                ) : (
                  <>
                    <ModelGate />
                    {stage.kind === "recording" || stage.kind === "starting" ? (
                      <div className="recording-row">
                        <Button variant="filled" destructive icon={<StopIcon size={18} />} onClick={() => void finish()} disabled={stage.kind === "starting"}>
                          {t.stop}
                        </Button>
                        <Button onClick={cancel}>{t.cancel}</Button>
                        {stage.kind === "recording" && <RecordingIndicator startedAt={stage.startedAt} />}
                      </div>
                    ) : stage.kind === "processing" ? (
                      <div className="model-gate" aria-busy="true" aria-live="polite">
                        <p className="flex items-center gap-2 font-medium">
                          <span className="spinner" aria-hidden="true" /> {t.analyzing}
                        </p>
                        {stage.total > 1 && stage.done < stage.total && (
                          <p className="text-muted text-sm">{t.analyzingPart(Math.min(stage.done + 1, stage.total), stage.total)}</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {stage.kind === "error" && (
                          <p className="field-error" role="alert">
                            {stage.message}
                          </p>
                        )}
                        <div>
                          <Button variant="filled" icon={<MicIcon size={18} />} onClick={() => void begin()} disabled={!ready || lines.length === 0}>
                            {t.start}
                          </Button>
                        </div>
                        <p className="text-muted text-sm">{t.reciteTip}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </Glass>

          {stage.kind === "results" && evaluation && (
            <>
              {stage.limitReached && <p className="field-error">{t.limitReached}</p>}
              <ResultsSummary
                evaluation={evaluation}
                onTryAgain={() => setStage({ kind: "idle" })}
                onOtherAyahs={() => {
                  setStage({ kind: "idle" });
                  rangeRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
                }}
              />
              <Details evaluation={evaluation} idPrefix="word" transcript={stage.transcript} />
              <Legend />
            </>
          )}
        </section>
      )}
    </div>
  );
}

// The input level arrives ~20 times a second; only the meter re-renders.
const levelListeners = new Set<(level: number) => void>();
function emitLevel(rms: number) {
  levelListeners.forEach((l) => l(rms));
}

function RecordingIndicator({ startedAt }: { startedAt: number }) {
  const { t, settings } = useSettings();
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((performance.now() - startedAt) / 1000), 250);
    const onLevel = (rms: number) => setLevel(Math.min(1, Math.sqrt(rms) * 2.2));
    levelListeners.add(onLevel);
    return () => {
      clearInterval(timer);
      levelListeners.delete(onLevel);
    };
  }, [startedAt]);
  return (
    <div className="recording-indicator" role="status" aria-live="off">
      <span className="rec-dot" aria-hidden="true" />
      <span className="font-medium">{t.recording}</span>
      <span className="tabular-nums text-muted">{formatDuration(seconds, settings.lang)}</span>
      <span className="level" aria-hidden="true">
        <span className="level-fill" style={{ transform: `scaleX(${level})` }} />
      </span>
    </div>
  );
}

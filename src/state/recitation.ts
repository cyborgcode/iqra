import { useSyncExternalStore } from "react";
import { asr } from "../lib/asr/client";
import { RecorderError, startRecording, type RecorderHandle, type RecorderProblem } from "../lib/audio/recorder";
import { LiveTranscriber } from "../lib/recitation/live";
import { collapseLoops } from "../lib/recitation/transcript";
import type { OptionalPhrase } from "../lib/recitation/phrases";
import { Tracker, type BookMarks, type LiveView, type TrackEvent } from "../lib/recitation/tracker";
import { loadText } from "./text";

/**
 * One recitation, from pressing the microphone to the summary: records, transcribes as the reciter
 * goes (finished phrases, plus provisional text for the phrase in progress), and lets the tracker
 * place every phrase in the Quran. Marks stay on the book until cleared.
 */

/** Word marks shown on the book (in memory only; they are gone when the page is reloaded). */
export const marks: BookMarks = { words: new Map(), extras: new Map() };

export type Phase = "idle" | "starting" | "listening" | "finishing";

/** Why a recitation could not start or finish. */
export type Problem = RecorderProblem | "nothing" | "model" | "nowasm";

export interface Summary {
  /** First and last corpus word recited. */
  first: number;
  last: number;
  words: number;
  counts: { correct: number; wrong: number; missed: number; extra: number };
  accuracy: number;
  /** Ayahs (ayah indices) with something to look at again. */
  review: { ayah: number; wrong: number; missed: number; extra: number }[];
  phrases: OptionalPhrase["id"][];
  unmatched: number;
  hints: number;
  limitReached: boolean;
  /** Where to start "recite again": the first ayah of this recitation. */
  firstAyah: number;
  /** What the speech model heard, phrase by phrase (standard spelling). */
  transcript: string;
}

export interface RecitationState {
  phase: Phase;
  error: { problem: Problem; detail?: string } | null;
  startedAt: number;
  /** The corpus word after the last one placed (null until the reciter is found). */
  cursor: number | null;
  /** Provisional position of the phrase being recited. */
  live: LiveView | null;
  /** An ayah chosen with "recite from this ayah" (ayah index), used by the next recitation. */
  startAyah: number | null;
  /** The summary sheet being shown, if any. */
  summary: Summary | null;
  /** The last recitation's summary, kept after its sheet is closed. */
  lastSummary: Summary | null;
  /** Words shown in "recite from memory": recited in this recitation, or shown as a hint. */
  revealed: ReadonlySet<number>;
  hinted: ReadonlySet<number>;
  /** Changes whenever marks change. */
  version: number;
}

const MAX_SECONDS = 15 * 60;
const UPDATE_MS = 400;

let state: RecitationState = {
  phase: "idle",
  error: null,
  startedAt: 0,
  cursor: null,
  live: null,
  startAyah: null,
  summary: null,
  lastSummary: null,
  revealed: new Set(),
  hinted: new Set(),
  version: 0,
};

const listeners = new Set<() => void>();
function set(patch: Partial<RecitationState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRecitation(): RecitationState {
  return useSyncExternalStore(subscribe, () => state);
}

export function recitationState(): RecitationState {
  return state;
}

// The input level arrives ~20 times a second; only the level meter listens to it.
const levelListeners = new Set<(rms: number) => void>();
export function onLevel(listener: (rms: number) => void): () => void {
  levelListeners.add(listener);
  return () => levelListeners.delete(listener);
}

interface Session {
  tracker: Tracker;
  live: LiveTranscriber;
  handle: RecorderHandle | null;
  timer: ReturnType<typeof setInterval> | null;
  hint: () => readonly [number, number] | null;
  limitReached: boolean;
  firstAyah: number | null;
  texts: string[];
}

let session: Session | null = null;

function afterEvent(s: Session, event: TrackEvent) {
  if (session !== s) return;
  if (event.kind === "empty" || event.kind === "waiting") return;
  if (event.kind !== "located" && event.kind !== "followed" && event.kind !== "repeated" && event.kind !== "jumped") {
    set({ version: state.version + 1 });
    return;
  }
  s.firstAyah ??= s.tracker.span ? s.tracker.corpus.ayahOfWord[s.tracker.span[0]]! : null;
  set({ cursor: s.tracker.cursor, live: null, revealed: new Set([...s.tracker.sessionWords, ...state.hinted]), version: state.version + 1 });
}

export interface StartOptions {
  threshold: number;
  /** The corpus words of the open page, preferred when a phrase occurs in several places. */
  hint: () => readonly [number, number] | null;
}

export async function startRecitation({ threshold, hint }: StartOptions): Promise<void> {
  if (state.phase !== "idle") return;
  if (typeof WebAssembly !== "object" || typeof Worker === "undefined") {
    set({ error: { problem: "nowasm" } });
    return;
  }
  set({ phase: "starting", error: null, summary: null, live: null, cursor: null, revealed: new Set(), hinted: new Set() });
  try {
    const text = await loadText();
    const tracker = new Tracker(text.index, marks, threshold);
    if (state.startAyah !== null) tracker.startAt(text.corpus.ayahStart[state.startAyah]!);
    const s: Session = { tracker, live: null!, handle: null, timer: null, hint, limitReached: false, firstAyah: state.startAyah, texts: [] };
    s.live = new LiveTranscriber((segment) => asr.transcribe([segment]).then((texts) => texts[0] ?? ""), {
      onFinal: (_, transcript) => {
        s.texts.push(transcript);
        afterEvent(s, tracker.commit(transcript, s.hint()));
      },
      onPartial: (_, transcript) => {
        if (session === s && state.phase === "listening") set({ live: tracker.preview(transcript, s.hint()) });
      },
    });
    session = s;
    s.handle = await startRecording({
      maxSeconds: MAX_SECONDS,
      onLevel: (rms) => levelListeners.forEach((l) => l(rms)),
      onLimit: () => {
        s.limitReached = true;
        void stopRecitation();
      },
    });
    if (session !== s) {
      s.handle.cancel();
      return;
    }
    s.timer = setInterval(() => {
      if (s.handle) s.live.update(s.handle.samples());
    }, UPDATE_MS);
    set({ phase: "listening", startedAt: performance.now(), cursor: tracker.cursor });
  } catch (error) {
    session = null;
    const problem = error instanceof RecorderError ? error.problem : "failed";
    set({ phase: "idle", error: { problem, detail: error instanceof Error ? error.message : String(error) } });
  }
}

export async function stopRecitation(): Promise<void> {
  const s = session;
  if (!s || !s.handle || state.phase !== "listening") return;
  if (s.timer) clearInterval(s.timer);
  const handle = s.handle;
  s.handle = null;
  set({ phase: "finishing" });
  try {
    const recording = await handle.stop();
    await s.live.finish(recording.samples);
    if (session !== s) return;
    afterEvent(s, s.tracker.commit("", s.hint(), true));
    s.tracker.finish();
    session = null;
    const summary = summarize(s);
    set({
      phase: "idle",
      live: null,
      cursor: s.tracker.cursor,
      startAyah: null,
      summary,
      lastSummary: summary ?? state.lastSummary,
      error: summary ? null : { problem: "nothing" },
      revealed: new Set([...s.tracker.sessionWords, ...state.hinted]),
      version: state.version + 1,
    });
  } catch (error) {
    session = null;
    set({ phase: "idle", live: null, error: { problem: "model", detail: error instanceof Error ? error.message : String(error) } });
  }
}

/** Stops listening and forgets this recitation's audio (its marks so far stay). */
export function cancelRecitation() {
  const s = session;
  session = null;
  if (s?.timer) clearInterval(s.timer);
  s?.handle?.cancel();
  set({ phase: "idle", live: null });
}

function summarize(s: Session): Summary | null {
  const tracker = s.tracker;
  const corpus = tracker.corpus;
  const words = [...tracker.sessionWords].sort((a, b) => a - b);
  if (words.length === 0) return null;
  const counts = { correct: 0, wrong: 0, missed: 0, extra: tracker.sessionExtras };
  const review = new Map<number, { ayah: number; wrong: number; missed: number; extra: number }>();
  const entry = (ayah: number) => {
    let e = review.get(ayah);
    if (!e) review.set(ayah, (e = { ayah, wrong: 0, missed: 0, extra: 0 }));
    return e;
  };
  for (const w of words) {
    const m = marks.words.get(w);
    if (!m) continue;
    counts[m.status]++;
    if (m.status !== "correct") entry(corpus.ayahOfWord[w]!)[m.status]++;
    const extras = marks.extras.get(w);
    if (extras?.length) entry(corpus.ayahOfWord[w]!).extra += extras.length;
  }
  const first = words[0]!;
  return {
    first,
    last: words.at(-1)!,
    words: words.length,
    counts,
    accuracy: counts.correct / words.length,
    review: [...review.values()].sort((a, b) => a.ayah - b.ayah),
    phrases: [...tracker.phrases],
    unmatched: tracker.unrecognized.length,
    hints: state.hinted.size,
    limitReached: s.limitReached,
    firstAyah: s.firstAyah ?? corpus.ayahOfWord[first]!,
    transcript: s.texts.map(collapseLoops).filter(Boolean).join(" "),
  };
}

export function setStartAyah(ayah: number | null) {
  set({ startAyah: ayah });
}

export function dismissSummary() {
  set({ summary: null });
}

/** Opens the last recitation's summary again. */
export function showLastSummary() {
  if (state.lastSummary) set({ summary: state.lastSummary });
}

export function dismissError() {
  set({ error: null });
}

/** Removes marks on corpus words [from, to). */
export function clearMarks(from = 0, to = Number.POSITIVE_INFINITY) {
  for (const w of [...marks.words.keys()]) if (w >= from && w < to) marks.words.delete(w);
  for (const w of [...marks.extras.keys()]) if (w >= from - 1 && w < to) marks.extras.delete(w);
  const all = from <= 0 && to === Number.POSITIVE_INFINITY;
  set({ version: state.version + 1, revealed: new Set(), hinted: new Set(), ...(all ? { lastSummary: null } : {}) });
}

/** "Recite from memory": shows one more word, after the last one recited (or `fallback`). */
export function revealNextWord(fallback: number) {
  const done = new Set([...state.revealed, ...(state.live?.heard ?? [])]);
  let w = state.live?.end ?? state.cursor ?? fallback;
  while (done.has(w)) w++;
  set({ hinted: new Set([...state.hinted, w]), revealed: new Set([...state.revealed, w]) });
}

/** Clears the marks of the ayahs to review and returns the first of them, to recite again from there. */
export function prepareRetry(summary: Summary, ayahStart: Uint32Array, mistakesOnly: boolean): number {
  const ayahs = mistakesOnly ? summary.review.map((r) => r.ayah) : [];
  if (mistakesOnly) for (const a of ayahs) clearMarks(ayahStart[a]!, ayahStart[a + 1]!);
  else clearMarks(summary.first, summary.last + 1);
  const from = mistakesOnly && ayahs.length ? ayahs[0]! : summary.firstAyah;
  set({ summary: null, startAyah: from });
  return from;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PAGE_COUNT, pageAyahs, pageOfAyah } from "../lib/quran/book";
import type { Corpus } from "../lib/quran/corpus";
import { recorderSupport } from "../lib/audio/recorder";
import { prepareModel, useModelStatus } from "../state/model";
import {
  cancelRecitation,
  clearMarks,
  prepareRetry,
  recitationState,
  revealNextWord,
  setStartAyah,
  startRecitation,
  stopRecitation,
  useRecitation,
  type Summary,
} from "../state/recitation";
import { clearFocusAyah, currentRoute, goToAyah, goToPage, useFocusAyah } from "../state/route";
import { useSettings } from "../state/settings";
import { loadText, useText } from "../state/text";
import { openSheet, useSheet } from "../state/ui";
import { IndexSheet } from "./IndexSheet";
import { MicDock } from "./MicDock";
import { ModelGate } from "./ModelGate";
import { MushafPage, type PageView } from "./MushafPage";
import { Sheet } from "./Sheet";
import { SummarySheet } from "./SummarySheet";

/** Corpus words on a page, as a half-open range. */
function pageWords(corpus: Corpus, page: number): [number, number] {
  const [from, to] = pageAyahs(page);
  return [corpus.ayahStart[from]!, corpus.ayahStart[to]!];
}

/** A horizontal swipe of at least this many pixels turns the page. */
const SWIPE_PX = 64;

/**
 * The Mushaf, one page at a time. Press the microphone anywhere: the recitation is found in the whole
 * Quran, the book turns to it and follows along, marking each word as it is recited.
 */
export function BookView({ page }: { page: number }) {
  const { settings } = useSettings();
  const text = useText();
  const rec = useRecitation();
  const model = useModelStatus();
  const focus = useFocusAyah();
  const sheet = useSheet();
  const [selected, setSelected] = useState<number | null>(null);
  const [shown, setShown] = useState({ page, turn: "" });
  const [drag, setDrag] = useState(0);
  const gesture = useRef<{ id: number; x: number; y: number; dx: number; active: boolean } | null>(null);
  const corpus = text?.corpus ?? null;

  // Which way the page turned, for the animation (adjusted while rendering, not in an effect).
  if (shown.page !== page) setShown({ page, turn: page > shown.page ? "turn-next" : "turn-prev" });

  // The text index and the speech model load in the background once the page is up.
  useEffect(() => {
    const id = setTimeout(() => void loadText().catch(() => {}), 600);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (recorderSupport()) return;
    const id = setTimeout(() => void prepareModel(settings.model, settings.engine), 900);
    return () => clearTimeout(id);
  }, [settings.model, settings.engine]);

  useEffect(() => {
    if (sheet === "model" && model.phase === "ready") openSheet(null);
  }, [sheet, model.phase]);

  const turn = useCallback((delta: 1 | -1) => {
    const route = currentRoute();
    if (route.view !== "book") return;
    const next = route.page + delta;
    if (next >= 1 && next <= PAGE_COUNT) {
      setSelected(null);
      goToPage(next);
    }
  }, []);

  const corpusRef = useRef(corpus);
  useEffect(() => {
    corpusRef.current = corpus;
  }, [corpus]);

  const start = useCallback(
    (fromAyah?: number) => {
      if (fromAyah !== undefined) setStartAyah(fromAyah);
      setSelected(null);
      void startRecitation({
        threshold: settings.threshold,
        // The page on screen when each phrase is placed (it follows the reciter).
        hint: () => {
          const route = currentRoute();
          const c = corpusRef.current;
          return c && route.view === "book" ? pageWords(c, route.page) : null;
        },
      });
    },
    [settings.threshold],
  );

  const retry = useCallback(
    (summary: Summary, mistakesOnly: boolean) => {
      if (!corpus) return;
      const from = prepareRetry(summary, corpus.ayahStart, mistakesOnly);
      goToAyah(from);
      start();
    },
    [corpus, start],
  );

  // Follow the reciter: turn to the page of the last word heard.
  const position = rec.live?.heard.at(-1) ?? (rec.cursor !== null && rec.cursor > 0 ? rec.cursor - 1 : null);
  useEffect(() => {
    if (!corpus || rec.phase === "idle" || position === null) return;
    const p = pageOfAyah(corpus.ayahOfWord[Math.min(position, corpus.size - 1)]!);
    const route = currentRoute();
    if (route.view === "book" && route.page !== p) goToPage(p, { replace: true });
  }, [corpus, rec.phase, position]);

  // …and keep the word being recited in view.
  useEffect(() => {
    if (rec.phase === "idle" || position === null) return;
    const el = document.querySelector<HTMLElement>(".mushaf-page .w-next") ?? [...document.querySelectorAll<HTMLElement>(".mushaf-page .w-live")].at(-1);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 80 || r.bottom > innerHeight - 200) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [rec.phase, position, page]);

  // Keyboard: the left arrow turns to the next page, as in a Mushaf; the right arrow goes back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (currentRoute().view !== "book" || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || document.querySelector("dialog[open]")) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (e.key === "ArrowLeft" || e.key === "PageDown") turn(1);
      else if (e.key === "ArrowRight" || e.key === "PageUp") turn(-1);
      else if (e.key === "Escape") setSelected(null);
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [turn]);

  // Stop listening if the book is left (e.g. for Settings) — the recitation is still summarized.
  useEffect(() => () => void stopRecitation(), []);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && recitationState().phase === "starting") cancelRecitation();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  // Keep the screen on while reciting (phones dim quickly).
  useEffect(() => {
    if (rec.phase !== "listening" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock.request("screen").then(
      (l) => (lock = l),
      () => {},
    );
    return () => void lock?.release().catch(() => {});
  }, [rec.phase]);

  const view: PageView = useMemo(
    () => ({
      live: new Set(rec.live?.heard ?? []),
      next: rec.phase === "idle" ? null : (rec.live?.end ?? rec.cursor),
      memorize: settings.memorize,
      revealed: rec.revealed,
      hinted: rec.hinted,
      version: rec.version,
    }),
    [rec.live, rec.phase, rec.cursor, settings.memorize, rec.revealed, rec.hinted, rec.version],
  );

  const onFocused = useCallback(() => clearFocusAyah(), []);

  return (
    <div className="book">
      <div
        className="page-stage"
        style={drag ? { transform: `translateX(${drag}px)`, transition: "none" } : undefined}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" || !e.isPrimary) return;
          gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, active: false };
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g || g.id !== e.pointerId) return;
          const dx = e.clientX - g.x;
          const dy = e.clientY - g.y;
          if (!g.active) {
            if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.5) {
              g.active = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            } else if (Math.abs(dy) > 14) {
              gesture.current = null;
              return;
            }
          }
          if (g.active) {
            g.dx = dx;
            setDrag(dx * 0.85);
          }
        }}
        onPointerUp={() => {
          const g = gesture.current;
          gesture.current = null;
          if (!g?.active) return;
          setDrag(0);
          // Swiping towards the right brings in the next page, which lies to the left in a Mushaf.
          if (g.dx > SWIPE_PX) turn(1);
          else if (g.dx < -SWIPE_PX) turn(-1);
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setDrag(0);
        }}
      >
        <div key={page} className={`page-turn ${shown.page === page ? shown.turn : ""}`}>
          <MushafPage page={page} corpus={corpus} view={view} selected={selected} onSelect={setSelected} focus={focus} onFocused={onFocused} />
        </div>
      </div>

      <MicDock
        page={page}
        selected={selected}
        onSelect={setSelected}
        onStart={start}
        onStop={() => void stopRecitation()}
        onTurn={turn}
        onHint={() => corpus && revealNextWord(pageWords(corpus, page)[0])}
        onClearPage={() => corpus && clearMarks(...pageWords(corpus, page))}
        onClearAll={() => clearMarks()}
      />

      <IndexSheet page={page} />
      <ModelSheet />
      <SummarySheet corpus={corpus} onRetry={retry} />
    </div>
  );
}

function ModelSheet() {
  const { t } = useSettings();
  const open = useSheet() === "model";
  return (
    <Sheet open={open} onClose={() => openSheet(null)} title={t.modelTitle}>
      <ModelGate />
    </Sheet>
  );
}

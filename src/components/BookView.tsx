import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { viewTransitions } from "../lib/motion";
import { useSettings } from "../state/settings";
import { loadText, useText } from "../state/text";
import { openSheet, useSheet } from "../state/ui";
import { IndexSheet } from "./IndexSheet";
import { MicDock, MoreSheet } from "./MicDock";
import { fitPages, type PageBox } from "./fit";
import { ModelGate } from "./ModelGate";
import { MushafPage, type PageView } from "./MushafPage";
import { Sheet } from "./Sheet";
import { SummarySheet } from "./SummarySheet";

/** Corpus words on the given pages (consecutive), as a half-open range. */
function pageWords(corpus: Corpus, pages: readonly number[]): [number, number] {
  const from = pageAyahs(pages[0]!)[0];
  const to = pageAyahs(pages.at(-1)!)[1];
  return [corpus.ayahStart[from]!, corpus.ayahStart[to]!];
}

/** On a wide landscape screen two pages show side by side, an odd page on the right, like an open Mushaf. */
const SPREAD_QUERY = "(min-width: 1000px) and (min-aspect-ratio: 5/4)";

function spreadOf(page: number): number[] {
  const right = page % 2 === 1 ? page : page - 1;
  return right + 1 <= PAGE_COUNT ? [right, right + 1] : [right];
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
  );
}

/** How much of a horizontal drag the page follows. */
const DRAG_FOLLOW = 0.85;
/** A horizontal swipe of at least this many pixels turns the page. */
const SWIPE_PX = 64;

/**
 * The Mushaf, a whole page (or two) on the screen at a time. Press the microphone anywhere: the
 * recitation is found in the whole Quran, the book turns to it and follows along, marking each word as
 * it is recited.
 */
export function BookView({ page }: { page: number }) {
  const { settings } = useSettings();
  const text = useText();
  const rec = useRecitation();
  const model = useModelStatus();
  const focus = useFocusAyah();
  const sheet = useSheet();
  const spread = useMedia(SPREAD_QUERY);
  const [selected, setSelected] = useState<number | null>(null);
  const pages = spread ? spreadOf(page) : [page];
  const [shown, setShown] = useState({ first: pages[0]!, turn: "" });
  const [drag, setDrag] = useState(0);
  const gesture = useRef<{ id: number; x: number; y: number; dx: number; active: boolean } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const corpus = text?.corpus ?? null;

  // Which way the page turned, for the animation (adjusted while rendering, not in an effect).
  if (shown.first !== pages[0]) setShown({ first: pages[0]!, turn: pages[0]! > shown.first ? "turn-next" : "turn-prev" });

  // The latest values, for callbacks that outlive a render (the recitation asks for the open pages).
  const latest = useRef({ corpus, spread, textSize: settings.textSize });
  useLayoutEffect(() => {
    latest.current = { corpus, spread, textSize: settings.textSize };
  });

  // Size the open page(s) to the screen: when they are laid out, when the screen changes, and once
  // the Mushaf font has loaded (until then the text is measured in a fallback font).
  const fit = useCallback(() => {
    const boxes: PageBox[] = [];
    area.current?.querySelectorAll<HTMLElement>(".page-body").forEach((box) => {
      const textEl = box.querySelector<HTMLElement>(".page-text");
      if (textEl) boxes.push({ box, text: textEl });
    });
    fitPages(boxes, latest.current.textSize);
  }, []);
  useLayoutEffect(fit, [fit, settings.textSize, settings.lang, spread, page]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(el);
    void document.fonts?.ready.then(() => fit());
    return () => observer.disconnect();
  }, [fit]);

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

  /** Turns a page (two in a spread); `dragged` is how far a swipe had moved it, in pixels. */
  const turn = useCallback((delta: 1 | -1, dragged = 0) => {
    const route = currentRoute();
    if (route.view !== "book") return;
    const from = latest.current.spread ? spreadOf(route.page)[0]! : route.page;
    const next = from + delta * (latest.current.spread ? 2 : 1);
    if (next >= 1 && next <= PAGE_COUNT) {
      setSelected(null);
      goToPage(next, { from: dragged });
    }
  }, []);

  const start = useCallback(
    (fromAyah?: number) => {
      if (fromAyah !== undefined) setStartAyah(fromAyah);
      setSelected(null);
      void startRecitation({
        threshold: settings.threshold,
        // The pages on screen when each phrase is placed (they follow the reciter).
        hint: () => {
          const route = currentRoute();
          const { corpus: c, spread: s } = latest.current;
          return c && route.view === "book" ? pageWords(c, s ? spreadOf(route.page) : [route.page]) : null;
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
    if (route.view !== "book") return;
    const open = latest.current.spread ? spreadOf(route.page) : [route.page];
    if (!open.includes(p)) goToPage(p, { replace: true });
  }, [corpus, rec.phase, position]);

  // With large text the page scrolls: keep the word being recited in view.
  useEffect(() => {
    if (rec.phase === "idle" || position === null) return;
    const el = document.querySelector<HTMLElement>(".page-body.scrolls .w-next") ?? [...document.querySelectorAll<HTMLElement>(".page-body.scrolls .w-live")].at(-1);
    const body = el?.closest<HTMLElement>(".page-body");
    if (!el || !body) return;
    const r = el.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    if (r.top < b.top + 24 || r.bottom > b.bottom - 24) el.scrollIntoView({ block: "center", behavior: "smooth" });
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

  // Stop listening if the book is left for good — the recitation is still summarized.
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
    <div className={`book${spread ? " book-spread" : ""}`}>
      <div
        ref={area}
        className="page-area"
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
            setDrag(dx * DRAG_FOLLOW);
          }
        }}
        onPointerUp={() => {
          const g = gesture.current;
          gesture.current = null;
          if (!g?.active) return;
          setDrag(0);
          // Swiping towards the right brings in the next page, which lies to the left in a Mushaf.
          if (g.dx > SWIPE_PX) turn(1, g.dx * DRAG_FOLLOW);
          else if (g.dx < -SWIPE_PX) turn(-1, g.dx * DRAG_FOLLOW);
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setDrag(0);
        }}
      >
        <div
          key={pages.join("-")}
          dir="rtl"
          // With view transitions the turn is animated by them (see motion.ts); otherwise the new page slides in.
          className={`page-turn ${!viewTransitions() && shown.first === pages[0] ? shown.turn : ""}`}
          style={drag ? { transform: `translateX(${drag}px)`, transition: "none" } : undefined}
        >
          {pages.map((p, i) => (
            <MushafPage
              key={p}
              page={p}
              corpus={corpus}
              view={view}
              selected={selected}
              onSelect={setSelected}
              focus={focus}
              onFocused={onFocused}
              onLaidOut={fit}
              // In a spread the right page holds "previous" and the left page "next", on their outer sides.
              onPrevious={i === 0 ? () => turn(-1) : undefined}
              onNext={i === pages.length - 1 ? () => turn(1) : undefined}
              credit={i === pages.length - 1}
            />
          ))}
        </div>
      </div>

      <MicDock
        selected={selected}
        onSelect={setSelected}
        onStart={start}
        onStop={() => void stopRecitation()}
        onHint={() => corpus && revealNextWord(pageWords(corpus, pages)[0])}
      />
      <MoreSheet busy={rec.phase !== "idle"} onClearPage={() => corpus && clearMarks(...pageWords(corpus, pages))} onClearAll={() => clearMarks()} />

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
      <div className="flex flex-col gap-3">
        <p>{t.modelIntro}</p>
        <ModelGate />
      </div>
    </Sheet>
  );
}

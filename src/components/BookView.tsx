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
import { usePager } from "./pager";

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
  const area = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  // The spreads beside the open one, laid out to slide in: the next on the left, as in a Mushaf.
  const step = spread ? 2 : 1;
  const first = pages[0]!;
  const slots = [
    first + step <= PAGE_COUNT ? { pos: -1, pages: spread ? spreadOf(first + step) : [first + 1] } : null,
    { pos: 0, pages },
    first - step >= 1 ? { pos: 1, pages: spread ? spreadOf(first - step) : [first - 1] } : null,
  ].filter((slot) => slot !== null);
  const corpus = text?.corpus ?? null;

  // The latest values, for callbacks that outlive a render (the recitation asks for the open pages).
  const latest = useRef({ corpus, spread, textSize: settings.textSize, digits: settings.digits });
  useLayoutEffect(() => {
    latest.current = { corpus, spread, textSize: settings.textSize, digits: settings.digits };
  });

  // Size the open page(s) to the screen: when they are laid out, when the screen changes, and once
  // the Mushaf font has loaded (until then the text is measured in a fallback font).
  // A page seen before is set at once; `fresh` measures again (once the font has loaded).
  const fit = useCallback((fresh = false) => {
    // Each spread on the track (the open one and its neighbours) is sized on its own.
    area.current?.querySelectorAll<HTMLElement>(".page-turn").forEach((slot) => {
      const boxes: PageBox[] = [];
      slot.querySelectorAll<HTMLElement>(".page-body").forEach((box) => {
        const textEl = box.querySelector<HTMLElement>(".page-text");
        if (textEl) boxes.push({ box, text: textEl });
      });
      fitPages(boxes, latest.current.textSize, latest.current.digits, fresh);
    });
  }, []);
  const laidOut = useCallback(() => fit(), [fit]);
  useLayoutEffect(() => fit(), [fit, settings.textSize, settings.digits, settings.lang, spread, page]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(el);
    void document.fonts?.ready.then(() => fit(true));
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

  const pager = usePager(area, track, {
    target: (delta) => {
      const route = currentRoute();
      if (route.view !== "book") return null;
      const s = latest.current.spread;
      const next = (s ? spreadOf(route.page)[0]! : route.page) + delta * (s ? 2 : 1);
      return next >= 1 && next <= PAGE_COUNT ? next : null;
    },
    commit: (to, replace) => {
      setSelected(null);
      // The page is already on the screen: no transition.
      goToPage(to, { replace, animate: false });
    },
    pageScrolls: () => !!area.current?.querySelector(".page-turn.is-current .page-body.scrolls"),
  });
  /** Turns a page (two in a spread), sliding. */
  const turn = useCallback((delta: 1 | -1, replace = false) => pager.turn(delta, replace), [pager]);

  const previous = useCallback(() => turn(-1), [turn]);
  const next = useCallback(() => turn(1), [turn]);

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
    const s = latest.current.spread;
    const open = s ? spreadOf(route.page) : [route.page];
    if (open.includes(p)) return;
    // The next page slides in as when turned; a jump further goes straight there.
    const following = s ? spreadOf(open[0]! + 2) : [open[0]! + 1];
    if (following.includes(p)) turn(1, true);
    else goToPage(p, { replace: true });
  }, [corpus, rec.phase, position, turn]);

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

  const view: PageView = useMemo(() => {
    // Lit: the words of the phrase being recited not checked yet (the last still being said, perhaps
    // misheard so far), and the ones the voice has gone on to.
    const span = rec.live ? Array.from({ length: rec.live.end - rec.live.start }, (_, i) => rec.live!.start + i) : [];
    const heard = span.filter((w) => !rec.checked.has(w));
    return {
      live: new Set(heard),
      ahead: new Set(rec.ahead.filter((w) => !rec.checked.has(w))),
      checked: rec.checked,
      next: rec.phase === "idle" ? null : rec.ahead.length ? rec.ahead.at(-1)! + 1 : (rec.live?.end ?? rec.cursor),
      memorize: settings.memorize,
      revealed: rec.revealed,
      hinted: rec.hinted,
      version: rec.version,
    };
  }, [rec.live, rec.ahead, rec.checked, rec.phase, rec.cursor, settings.memorize, rec.revealed, rec.hinted, rec.version]);

  const onFocused = useCallback(() => clearFocusAyah(), []);

  return (
    <div className={`book${spread ? " book-spread" : ""}`}>
      <div
        ref={area}
        className="page-area"
        onPointerDown={pager.onPointerDown}
        onPointerMove={pager.onPointerMove}
        onPointerUp={pager.onPointerUp}
        onPointerCancel={pager.onPointerCancel}
      >
        <div ref={track} className="pager">
          {slots.map((slot) => (
            <div
              key={slot.pages.join("-")}
              dir="rtl"
              className={`page-turn${slot.pos === 0 ? " is-current" : ""}`}
              style={{ "--pos": slot.pos } as React.CSSProperties}
              inert={slot.pos !== 0}
            >
              {slot.pages.map((p, i) => (
                <MushafPage
                  key={p}
                  page={p}
                  corpus={corpus}
                  view={view}
                  selected={slot.pos === 0 ? selected : null}
                  onSelect={setSelected}
                  focus={focus}
                  onFocused={onFocused}
                  onLaidOut={laidOut}
                  // In a spread the right page holds "previous" and the left page "next", on their outer sides.
                  onPrevious={i === 0 ? previous : undefined}
                  onNext={i === slot.pages.length - 1 ? next : undefined}
                  credit={i === slot.pages.length - 1}
                />
              ))}
            </div>
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

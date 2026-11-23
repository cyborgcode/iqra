/**
 * Turning the Mushaf's pages as a carousel: the pages on either side are laid out beside the open one
 * (the next to the left, as in a Mushaf), and the whole row (the track) moves.
 *
 * - A finger drags the row; the neighbouring page comes in with it. Let go past a fifth of the page, or
 *   with a flick, and the row slides on to that page at the speed of the flick; otherwise it springs
 *   back. Past the first or last page the row only gives a little.
 * - A trackpad swipe moves the row the same way; a mouse wheel turns one page per flick, unless the
 *   page itself scrolls (large text).
 * - Keys, buttons and the book following a recitation turn with the same slide.
 *
 * Only when a slide ends does the route change, without a transition: the page it led to is already on
 * the screen, so the row is put back under it in the same frame.
 */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { flushSync } from "react-dom";

export interface PagerOptions {
  /** The first page `delta` spreads away from the open one, or null at either end of the book. */
  target: (delta: 1 | -1) => number | null;
  /** Shows the page a slide led to. */
  commit: (page: number, replace: boolean) => void;
  /** Whether vertical scrolling belongs to the open page (large text) rather than to turning. */
  pageScrolls: () => boolean;
}

/** Space between neighbouring pages, in px (as in index.css, .page-turn). */
export const PAGER_GAP = 24;
/** Past this share of the page, a released drag turns it. */
const TURN_SHARE = 0.2;
/** A release at least this fast (px/ms) turns the page whichever way it was flung. */
const FLICK = 0.3;
/** A drag starts once the finger has moved this far, mostly sideways. */
const LOCK_PX = 12;
/** Ease-out; its starting speed is SLOPE times its average, so a flung page keeps its speed. */
const EASE = "cubic-bezier(0.2, 0.7, 0.3, 1)";
const SLOPE = 0.7 / 0.2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const reducedMotion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

type Sample = [time: number, x: number];

/** Speed (px/ms) over the last tenth of a second of samples. */
function velocity(samples: Sample[]): number {
  const last = samples.at(-1);
  if (!last) return 0;
  const first = samples.find(([t]) => last[0] - t <= 100) ?? last;
  return last[0] > first[0] ? (last[1] - first[1]) / (last[0] - first[0]) : 0;
}

class Pager {
  /** Where the row is (or is going, while it slides), in px; positive towards the next page. */
  private offset = 0;
  private slideAnimation: Animation | null = null;
  /** The page the running slide leads to, if it turns. */
  private dest: number | null = null;
  private replace = false;
  private gesture: { id: number; x: number; y: number; start: number; active: boolean; samples: Sample[] } | null = null;

  constructor(
    private readonly track: RefObject<HTMLElement | null>,
    private readonly options: { current: PagerOptions },
  ) {}

  private width(): number {
    return (this.track.current?.clientWidth ?? 0) + PAGER_GAP;
  }

  private place(x: number) {
    this.offset = x;
    if (this.track.current) this.track.current.style.transform = x ? `translateX(${x}px)` : "";
  }

  /** Where the row is on the screen, mid-slide included. */
  private shownX(): number {
    const t = this.track.current;
    const transform = t ? getComputedStyle(t).transform : "none";
    return transform && transform !== "none" ? new DOMMatrixReadOnly(transform).m41 : 0;
  }

  /** Past either end of the book the row only gives a little. */
  private restrain(x: number): number {
    const end = (x > 0 && this.options.current.target(1) === null) || (x < 0 && this.options.current.target(-1) === null);
    return end ? Math.sign(x) * Math.min(72, Math.abs(x) * 0.3) : clamp(x, -this.width(), this.width());
  }

  /** Stops a slide where it is: a finger caught the page. */
  private hold() {
    if (!this.slideAnimation) return;
    const x = this.shownX();
    this.slideAnimation.cancel();
    this.slideAnimation = null;
    this.dest = null;
    this.place(x);
  }

  /** Ends the running slide: shows the page it led to, if any, and puts the row back under it. */
  private finish() {
    const running = this.slideAnimation;
    const dest = this.dest;
    this.slideAnimation = null;
    this.dest = null;
    if (dest !== null) flushSync(() => this.options.current.commit(dest, this.replace));
    this.place(0);
    running?.cancel();
  }

  private slide(to: number, dest: number | null, speed = 0, replace = false) {
    const from = this.offset;
    this.dest = dest;
    this.replace = replace;
    const distance = Math.abs(to - from);
    const t = this.track.current;
    if (!t || distance < 1 || reducedMotion?.matches) {
      this.offset = to;
      this.finish();
      return;
    }
    const duration =
      Math.abs(speed) > 0.15 ? clamp((SLOPE * distance) / Math.abs(speed), 150, 420) : clamp((distance / this.width()) * 360, 160, 360);
    const animation = t.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], { duration, easing: EASE, fill: "forwards" });
    this.slideAnimation = animation;
    this.offset = to;
    animation.onfinish = () => {
      if (this.slideAnimation === animation) this.finish();
    };
  }

  /** A drag or swipe let go at `speed` (px/ms): on to the next page or back. */
  private release(speed: number) {
    const x = this.offset;
    let delta: 0 | 1 | -1 = 0;
    if (Math.abs(speed) > FLICK) delta = speed > 0 ? 1 : -1;
    else if (Math.abs(x) > this.width() * TURN_SHARE) delta = x > 0 ? 1 : -1;
    const dest = delta ? this.options.current.target(delta) : null;
    if (delta && dest !== null) this.slide(delta * this.width(), dest, speed);
    else this.slide(0, null, speed);
  }

  /** Turns `delta` spreads with a slide. A turn already under way ends at once; a page springing back is caught. */
  turn = (delta: 1 | -1, replace = false) => {
    if (this.slideAnimation) {
      if (this.dest !== null) this.finish();
      else this.hold();
    }
    const dest = this.options.current.target(delta);
    const t = this.track.current;
    if (dest === null) {
      // The end of the book: a nudge.
      if (t && !reducedMotion?.matches && this.offset === 0) {
        t.animate([{ transform: "none" }, { transform: `translateX(${delta * 28}px)` }, { transform: "none" }], { duration: 300, easing: "ease-out" });
      }
      return;
    }
    this.slide(delta * this.width(), dest, 0, replace);
  };

  onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" || !e.isPrimary) return;
    this.hold();
    this.gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, start: this.offset, active: false, samples: [] };
  };

  onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.active) {
      if (Math.abs(dx) > LOCK_PX && Math.abs(dx) > Math.abs(dy) * 1.2) {
        g.active = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      } else {
        if (Math.abs(dy) > LOCK_PX) {
          this.gesture = null;
          if (this.offset !== 0) this.release(0);
        }
        return;
      }
    }
    this.place(this.restrain(g.start + dx));
    g.samples.push([e.timeStamp, this.offset]);
    if (g.samples.length > 12) g.samples.shift();
  };

  onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    this.gesture = null;
    if (g.active) this.release(velocity(g.samples));
    else if (this.offset !== 0 && !this.slideAnimation) this.release(0);
  };

  onPointerCancel = () => {
    if (!this.gesture) return;
    this.gesture = null;
    this.slide(0, null);
  };

  /** Trackpad swipes and the mouse wheel. Returns a function that stops listening. */
  listenToWheel(area: HTMLElement): () => void {
    let swipe: { samples: Sample[]; timer: ReturnType<typeof setTimeout> | undefined } | null = null;
    // After a swipe is let go, its momentum is ignored; after a wheel turn, the rest of that flick.
    let quietUntil = 0;
    let wheelUntil = 0;
    let lastWheel = 0;
    let sum = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch to zoom
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? area.clientHeight : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      const now = e.timeStamp;
      if (Math.abs(dx) > Math.abs(dy)) {
        e.preventDefault();
        if (now < quietUntil) {
          quietUntil = now + 160;
          return;
        }
        if (!swipe) {
          this.hold();
          swipe = { samples: [], timer: undefined };
        }
        // The row follows the fingers: content moving right brings in the next page, on the left.
        this.place(this.restrain(this.offset - dx));
        const current = swipe;
        current.samples.push([now, this.offset]);
        if (current.samples.length > 12) current.samples.shift();
        clearTimeout(current.timer);
        current.timer = setTimeout(() => {
          swipe = null;
          quietUntil = performance.now() + 160;
          this.release(velocity(current.samples));
        }, 90);
        return;
      }
      if (this.options.current.pageScrolls() || dy === 0) return;
      e.preventDefault();
      if (now < wheelUntil) {
        wheelUntil = now + 180;
        return;
      }
      if (now - lastWheel > 300) sum = 0;
      lastWheel = now;
      sum += dy;
      if (Math.abs(sum) >= 30) {
        const delta = sum > 0 ? 1 : -1;
        sum = 0;
        wheelUntil = now + 320;
        this.turn(delta);
      }
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      area.removeEventListener("wheel", onWheel);
      clearTimeout(swipe?.timer);
    };
  }
}

/** The pager for a page area and its track (the row of pages); see above. */
export function usePager(area: RefObject<HTMLElement | null>, track: RefObject<HTMLElement | null>, options: PagerOptions) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const [pager] = useState(() => new Pager(track, latest));
  useEffect(() => {
    const el = area.current;
    return el ? pager.listenToWheel(el) : undefined;
  }, [area, pager]);
  return pager;
}

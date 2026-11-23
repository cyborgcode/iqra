import type { TextSize } from "../state/settings";

/**
 * Sizing a Mushaf page to its screen, as a printed page is set: the whole page shows at once, every
 * line is justified, and the lines are spread to fill the page's height.
 *
 * The font size is the largest at which the page's text fits its box, found by bisection on the real
 * layout. It is capped at the size where 15 lines fill the page (the Madani Mushaf has 15 lines a page;
 * its two opening pages have fewer, larger lines), so a page that wraps into fewer lines than the print
 * is not blown up. Pages shown side by side share one size, as in a printed spread. Then the line
 * spacing is opened up until the text fills the page.
 */

/** Line height (in em) of Quran text before it is spread to fill a page. Lower would let marks touch. */
export const BASE_LINE = 2.05;
const MAX_LINE = 2.75;
const MUSHAF_LINES = 15;
/** Below this, fitted text is too small to read comfortably: the page scrolls instead. */
const MIN_FIT_PX = 14;
const SCROLL_PX: Record<TextSize, number> = { fit: 20, large: 26, xlarge: 32 };

export interface PageBox {
  /** The box the page's text must fit in (no padding). */
  box: HTMLElement;
  /** The text block itself. */
  text: HTMLElement;
}

function set(p: PageBox, font: number, line: number) {
  p.text.style.fontSize = `${font}px`;
  p.text.style.lineHeight = String(line);
}

function fits(p: PageBox, font: number, line: number): boolean {
  set(p, font, line);
  return p.text.offsetHeight <= p.box.clientHeight;
}

/** Lines a full page has: 15, except the two opening pages, which the Mushaf sets larger. */
function linesOf(p: PageBox): number {
  return Number(p.box.dataset.lines) || MUSHAF_LINES;
}

/** The largest font size (px) at which a page fits its box at the base line height. */
function largestFit(p: PageBox): number {
  const cap = p.box.clientHeight / (linesOf(p) * BASE_LINE);
  if (fits(p, cap, BASE_LINE)) return cap;
  let lo = cap / 2;
  let hi = cap;
  if (!fits(p, lo, BASE_LINE)) {
    hi = lo;
    lo = 4;
  }
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    if (fits(p, mid, BASE_LINE)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Sizes the given pages (shown together) for `size`. Returns the font size used. */
export function fitPages(pages: readonly PageBox[], size: TextSize): number | null {
  const shown = pages.filter((p) => p.box.clientHeight > 40 && p.box.clientWidth > 40 && p.text.childElementCount > 0);
  if (shown.length === 0) return null;

  let font = Math.min(...shown.map(largestFit));
  let scroll = false;
  if (size !== "fit" && font < SCROLL_PX[size]) {
    font = SCROLL_PX[size];
    scroll = true;
  } else if (font < MIN_FIT_PX) {
    font = SCROLL_PX.fit;
    scroll = true;
  }
  font = Math.floor(font * 10) / 10;

  for (const p of shown) {
    p.box.classList.toggle("scrolls", scroll);
    set(p, font, BASE_LINE);
    if (scroll) continue;
    // Every page of the Madani Mushaf is a full page of 15 lines, so the lines are spread to fill it;
    // only the two opening pages are set apart, centred, as in print.
    if (linesOf(p) !== MUSHAF_LINES) continue;
    const height = p.box.clientHeight;
    // Line height changes only the height, not where lines break: interpolate, then make sure it fits.
    const h1 = p.text.offsetHeight;
    set(p, font, MAX_LINE);
    const h2 = p.text.offsetHeight;
    let line = h2 <= height ? MAX_LINE : BASE_LINE + ((MAX_LINE - BASE_LINE) * (height - h1)) / Math.max(1, h2 - h1);
    line = Math.max(BASE_LINE, Math.floor(line * 1000) / 1000);
    set(p, font, line);
    while (line > BASE_LINE && p.text.offsetHeight > height) {
      line = Math.max(BASE_LINE, line - 0.02);
      set(p, font, line);
    }
  }
  return font;
}

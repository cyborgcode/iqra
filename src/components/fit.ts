import type { TextSize } from "../state/settings";

/**
 * Sizing a Mushaf page to its screen, as a printed page is set: the whole page shows at once, every
 * line is justified, and the lines are spread to fill the page's height.
 *
 * The font size is the largest at which the page's text fits its box, found on the real layout. It is
 * capped at the size where 15 lines fill the page (the Madani Mushaf has 15 lines a page; its two
 * opening pages have fewer, larger lines), so a page that wraps into fewer lines than the print is not
 * blown up. Pages shown side by side share one size, as in a printed spread. Then the line spacing is
 * opened up until the text fills the page.
 *
 * Every trial size is a full layout of the page's Arabic text, the costly part of turning a page, so
 * the search takes few of them: it starts from the size of the page fitted before (neighbouring pages
 * are set alike), and guesses the next size from the text's height h at size f, since wrapped text
 * grows with the square of its size: f' = f·√(H/h) for a box of height H. A page fitted before, in the
 * same box and settings, is set at once.
 */

/** Line height (in em) of Quran text before it is spread to fill a page. Lower would let marks touch. */
export const BASE_LINE = 2.05;
const MAX_LINE = 2.75;
const MUSHAF_LINES = 15;
/** Below this, fitted text is too small to read comfortably: the page scrolls instead. */
const MIN_FIT_PX = 14;
const SCROLL_PX: Record<TextSize, number> = { fit: 20, large: 26, xlarge: 32 };
/** Sizes are found to a tenth of a pixel; the search works in tenths. */
const STEP = 10;
/** A safety bound: the search ends well before (each halving at least halves what is left). */
const MAX_TRIALS = 24;

export interface PageBox {
  /** The box the page's text must fit in (no padding). */
  box: HTMLElement;
  /** The text block itself. */
  text: HTMLElement;
}

interface Fitted {
  font: number;
  /** Each page's line height. */
  lines: number[];
  scroll: boolean;
}

/** Pages fitted before, by page, box size and settings. */
const fittedPages = new Map<string, Fitted>();
/** The last size fitted in a box of a given size: the first guess for the next page. */
const lastFont = new Map<string, number>();

function set(p: PageBox, font: number, line: number) {
  p.text.style.fontSize = `${font}px`;
  p.text.style.lineHeight = String(line);
}

function heightAt(p: PageBox, font: number, line: number): number {
  set(p, font, line);
  return p.text.offsetHeight;
}

/** Lines a full page has: 15, except the two opening pages, which the Mushaf sets larger. */
function linesOf(p: PageBox): number {
  return Number(p.box.dataset.lines) || MUSHAF_LINES;
}

/**
 * The largest font size (in tenths of a pixel) at which a page fits its box at the base line height,
 * starting from `guess` (tenths), with the text's height at that size. Each trial narrows a bracket:
 * the next size is aimed where the height meets the box (by the square law, between the two sizes
 * measured on either side once there are both), or halves the bracket when two trials in a row fell
 * on the same side, as they do where a line breaks differently and the height jumps.
 */
function largestFit(p: PageBox, guess: number | undefined): { size: number; height: number } {
  const room = p.box.clientHeight;
  const cap = Math.floor((room / (linesOf(p) * BASE_LINE)) * STEP);
  // lo fits (its height known, unless it is the 4 px floor); hi does not (or is past the cap).
  let lo = 4 * STEP;
  let loHeight = -1;
  let hi = cap + 1;
  let hiHeight = -1;
  let size = Math.min(cap, Math.max(lo + 1, Math.round(guess ?? cap)));
  let lastFit: boolean | null = null;
  let streak = 0;
  for (let trial = 0; trial < MAX_TRIALS && hi - lo > 1; trial++) {
    const height = heightAt(p, size / STEP, BASE_LINE);
    const fit = height <= room;
    if (fit) {
      lo = size;
      loHeight = height;
    } else {
      hi = size;
      hiHeight = height;
    }
    streak = fit === lastFit ? streak + 1 : 0;
    lastFit = fit;
    if (hi - lo <= 1) break;
    let next: number;
    if (streak > 0) next = (lo + hi) >> 1;
    else if (loHeight >= 0 && hiHeight >= 0) {
      const a = lo * lo;
      const b = hi * hi;
      next = Math.floor(Math.sqrt(a + ((b - a) * (room - loHeight)) / Math.max(1, hiHeight - loHeight)));
    } else next = Math.floor(size * Math.sqrt(room / Math.max(1, height)));
    size = Math.min(hi - 1, Math.max(lo + 1, next));
  }
  if (loHeight < 0) loHeight = heightAt(p, lo / STEP, BASE_LINE);
  return { size: lo, height: loHeight };
}

/** Spreads a full page's lines to fill its box; `height` is the text's height at the base line height. */
function spread(p: PageBox, font: number, height: number): number {
  const room = p.box.clientHeight;
  // Line height changes only the height, not where lines break: interpolate, then make sure it fits.
  const tallest = heightAt(p, font, MAX_LINE);
  let line = tallest <= room ? MAX_LINE : BASE_LINE + ((MAX_LINE - BASE_LINE) * (room - height)) / Math.max(1, tallest - height);
  line = Math.max(BASE_LINE, Math.floor(line * 1000) / 1000);
  set(p, font, line);
  while (line > BASE_LINE && p.text.offsetHeight > room) {
    line = Math.max(BASE_LINE, line - 0.02);
    set(p, font, line);
  }
  return line;
}

function keyOf(p: PageBox, size: TextSize, variant: string): string {
  return [p.box.dataset.page, p.box.clientWidth, p.box.clientHeight, size, variant, p.text.childElementCount].join("|");
}

/**
 * Sizes the given pages (shown together) for `size`. `variant` names anything else the layout depends
 * on (the style of the ayah numbers); `fresh` ignores sizes found before (once the Mushaf font has
 * loaded, say). Returns the font size used.
 */
export function fitPages(pages: readonly PageBox[], size: TextSize, variant = "", fresh = false): number | null {
  const shown = pages.filter((p) => p.box.clientHeight > 40 && p.box.clientWidth > 40 && p.text.childElementCount > 0);
  if (shown.length === 0) return null;
  const keys = shown.map((p) => keyOf(p, size, variant));
  const spreadKey = keys.join("&");

  // Seen before: set at once, as long as it still fits.
  const known = fresh ? undefined : fittedPages.get(spreadKey);
  if (known) {
    shown.forEach((p, i) => {
      p.box.classList.toggle("scrolls", known.scroll);
      set(p, known.font, known.lines[i] ?? BASE_LINE);
    });
    if (known.scroll || shown.every((p) => p.text.offsetHeight <= p.box.clientHeight)) return known.font;
  }

  const boxKey = `${shown[0]!.box.clientWidth}x${shown[0]!.box.clientHeight}|${size}|${variant}`;
  let guess = lastFont.get(boxKey);
  const found = shown.map((p) => {
    const fit = largestFit(p, guess);
    guess = fit.size;
    return fit;
  });
  let font = Math.min(...found.map((f) => f.size)) / STEP;
  let scroll = false;
  if (size !== "fit" && font < SCROLL_PX[size]) {
    font = SCROLL_PX[size];
    scroll = true;
  } else if (font < MIN_FIT_PX) {
    font = SCROLL_PX.fit;
    scroll = true;
  }
  if (!scroll) lastFont.set(boxKey, Math.round(font * STEP));

  const lines = shown.map((p, i) => {
    p.box.classList.toggle("scrolls", scroll);
    const at = found[i]!;
    // The text's height at this size is known if this page set the size; otherwise measure it.
    const height = !scroll && at.size / STEP === font ? at.height : heightAt(p, font, BASE_LINE);
    set(p, font, BASE_LINE);
    // Every page of the Madani Mushaf is a full page of 15 lines, so the lines are spread to fill it;
    // only the two opening pages are set apart, centred, as in print.
    if (scroll || linesOf(p) !== MUSHAF_LINES) return BASE_LINE;
    return spread(p, font, height);
  });
  fittedPages.set(spreadKey, { font, lines, scroll });
  return font;
}

/**
 * The Quran as a book: ayah positions and the divisions of the Madani Mushaf (604 pages, 30 juz,
 * 60 hizb in 240 quarters), from Tanzil's metadata (src/data/book.ts).
 *
 * Ayahs are numbered 0…6235 across the whole Quran ("ayah index") so that ranges and searches can
 * work on plain integers.
 */
import { HIZB_QUARTER_STARTS, JUZ_STARTS, PAGE_STARTS, SAJDAS } from "../../data/book";
import { SURAHS } from "../../data/surahs";

export const PAGE_COUNT = PAGE_STARTS.length;
export const JUZ_COUNT = JUZ_STARTS.length;
export const QUARTER_COUNT = HIZB_QUARTER_STARTS.length;
export const HIZB_COUNT = QUARTER_COUNT / 4;

/** Ayah index of the first ayah of each surah, then the total number of ayahs. */
const SURAH_FIRST: readonly number[] = SURAHS.reduce<number[]>((acc, s) => [...acc, acc.at(-1)! + s.ayahs], [0]);

export const AYAH_COUNT = SURAH_FIRST.at(-1)!;

export interface AyahRef {
  surah: number;
  ayah: number;
}

/** 0-based index of an ayah in the whole Quran. */
export function ayahIndex(surah: number, ayah: number): number {
  return SURAH_FIRST[surah - 1]! + ayah - 1;
}

/** The largest i with starts[i] <= value (starts sorted ascending, starts[0] <= value). */
function lastAtOrBefore(starts: readonly number[], value: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function ayahRef(index: number): AyahRef {
  const s = lastAtOrBefore(SURAH_FIRST, index);
  return { surah: s + 1, ayah: index - SURAH_FIRST[s]! + 1 };
}

export function surahFirstAyah(surah: number): number {
  return SURAH_FIRST[surah - 1]!;
}

const PAGE_FIRST = PAGE_STARTS.map(([s, a]) => ayahIndex(s, a));
const JUZ_FIRST = JUZ_STARTS.map(([s, a]) => ayahIndex(s, a));
const QUARTER_FIRST = HIZB_QUARTER_STARTS.map(([s, a]) => ayahIndex(s, a));

/** Page (1…604) of the ayah with this index. */
export function pageOfAyah(index: number): number {
  return lastAtOrBefore(PAGE_FIRST, index) + 1;
}

export function pageOf(surah: number, ayah: number): number {
  return pageOfAyah(ayahIndex(surah, ayah));
}

/** The ayahs on a page, as a half-open range of ayah indices. */
export function pageAyahs(page: number): [number, number] {
  return [PAGE_FIRST[page - 1]!, page < PAGE_COUNT ? PAGE_FIRST[page]! : AYAH_COUNT];
}

/** Juz (1…30) of the ayah with this index. */
export function juzOfAyah(index: number): number {
  return lastAtOrBefore(JUZ_FIRST, index) + 1;
}

export function juzStart(juz: number): AyahRef {
  return ayahRef(JUZ_FIRST[juz - 1]!);
}

/** Hizb quarter (1…240) of the ayah with this index. Quarter q is part (q−1) mod 4 of hizb ⌈q/4⌉. */
export function quarterOfAyah(index: number): number {
  return lastAtOrBefore(QUARTER_FIRST, index) + 1;
}

export function quarterStart(quarter: number): AyahRef {
  return ayahRef(QUARTER_FIRST[quarter - 1]!);
}

/** The surahs that have at least one ayah on a page, in order. */
export function surahsOnPage(page: number): number[] {
  const [from, to] = pageAyahs(page);
  const first = ayahRef(from).surah;
  const last = ayahRef(to - 1).surah;
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

const SAJDA_TYPE = new Map(SAJDAS.map(([s, a, type]) => [ayahIndex(s, a), type]));

/** "recommended" or "obligatory" for the 15 ayahs of prostration (per Tanzil's metadata), else null. */
export function sajdaOfAyah(index: number): "recommended" | "obligatory" | null {
  return SAJDA_TYPE.get(index) ?? null;
}

import type { Lang } from "../i18n";

/**
 * Which digits numbers are written with: Western Arabic numerals (1 2 3, as in the Maghrebi Mushaf) or
 * Arabic-Indic ones (١ ٢ ٣, as in the Mashriqi Mushaf). Set from the settings before the app renders.
 */
export type Digits = "western" | "indic";

let digits: Digits = "western";

export function setDigits(d: Digits) {
  digits = d;
}

export function currentDigits(): Digits {
  return digits;
}

/** The Arabic interface follows the digits setting; the English one always uses 1 2 3. */
function locale(lang: Lang): string {
  if (lang !== "ar") return lang;
  return digits === "indic" ? "ar-u-nu-arab" : "ar-u-nu-latn";
}

/** "67 MB" / "٦٧ ميغابايت" (decimal megabytes, as download sizes are usually shown). */
export function formatMegabytes(bytes: number, lang: Lang): string {
  const mb = bytes / 1_000_000;
  return new Intl.NumberFormat(locale(lang), { style: "unit", unit: "megabyte", maximumFractionDigits: mb < 10 ? 1 : 0 }).format(mb);
}

export function formatPercent(fraction: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang), { style: "percent", maximumFractionDigits: 0 }).format(fraction);
}

export function formatNumber(n: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang)).format(n);
}

/** Ayah and page numbers on the Mushaf page, in the chosen digits in every interface language. */
export function ayahNumber(n: number): string {
  return new Intl.NumberFormat(digits === "indic" ? "ar-u-nu-arab" : "en").format(n);
}

export function formatDuration(seconds: number, lang: Lang): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const nf = new Intl.NumberFormat(locale(lang), { minimumIntegerDigits: 2 });
  return `${new Intl.NumberFormat(locale(lang)).format(m)}:${nf.format(s)}`;
}

/** Search key for surah names: no diacritics, unified alef/yeh/teh marbuta, lower-case Latin. */
export function searchKey(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036F\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/['\u2019\-\s]/g, "")
    .toLowerCase();
}

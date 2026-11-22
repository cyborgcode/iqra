import type { Lang } from "../i18n";

/** Arabic text uses Arabic-Indic digits throughout, as the Mushaf does (٦٠٤, ٩٧٪). */
function locale(lang: Lang): string {
  return lang === "ar" ? "ar-u-nu-arab" : lang;
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

/** Ayah numbers in Arabic-Indic digits, as in the Mushaf. */
export function ayahNumber(n: number): string {
  return new Intl.NumberFormat("ar-u-nu-arab").format(n);
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

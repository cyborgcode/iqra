import { SURAHS } from "../data/surahs";
import type { Lang, Strings } from "../i18n";
import type { Problem } from "../state/recitation";
import { ayahRef } from "../lib/quran/book";
import { formatNumber } from "../lib/format";

/** A surah's name for the interface language: Tanzil's Arabic name, or its transliteration. */
export function surahName(surah: number, lang: Lang): string {
  const s = SURAHS[surah - 1]!;
  return lang === "ar" ? s.name : s.transliteration;
}

/** "Al-Ikhlas 2" / "الإخلاص ٢" for an ayah index. */
export function ayahLabel(index: number, lang: Lang): string {
  const { surah, ayah } = ayahRef(index);
  return `${surahName(surah, lang)} ${formatNumber(ayah, lang)}`;
}

/** Page, juz and surah numbers: Arabic-Indic digits in the Arabic interface (page ٦٠٤, juz ٣٠). */
export function num(n: number, lang: Lang): string {
  return formatNumber(n, lang);
}

/** A clear message for why a recitation could not start or finish. */
export function problemMessage(problem: Problem, t: Strings): string {
  switch (problem) {
    case "denied":
      return t.micDenied;
    case "no-microphone":
      return t.micMissing;
    case "busy":
      return t.micBusy;
    case "insecure-context":
      return t.micInsecure;
    case "unsupported":
      return t.micUnsupported;
    case "nothing":
      return t.nothingFound;
    case "model":
      return t.modelFailed;
    case "recognition":
      return t.recognitionFailed;
    case "nowasm":
      return t.noWasm;
    default:
      return t.micFailed;
  }
}

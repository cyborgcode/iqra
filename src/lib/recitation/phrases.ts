/**
 * Phrases a reciter may say around the selected ayahs. They are matched if heard, never required,
 * and never reported as extra words. Used for comparison only; never displayed as Quran text.
 */

export interface OptionalPhrase {
  id: "istiadha" | "basmala" | "sadaqa";
  text: string;
}

/** أعوذ بالله من الشيطان الرجيم — said before reciting. */
export const ISTIADHA: OptionalPhrase = { id: "istiadha", text: "أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ" };

/** Basmala, in Tanzil's Uthmani spelling of 1:1. */
export const BASMALA: OptionalPhrase = { id: "basmala", text: "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ" };

/** صدق الله العظيم — sometimes said at the end. */
export const SADAQA: OptionalPhrase = { id: "sadaqa", text: "صَدَقَ اللَّهُ الْعَظِيمُ" };

/**
 * Optional phrases for a recitation of `surah` starting at ayah `fromAyah`.
 * In Al-Fatiha the basmala is ayah 1 itself (required); At-Tawba is not opened with the basmala.
 */
export function optionalPhrasesFor(surah: number, fromAyah: number): { before: OptionalPhrase[]; after: OptionalPhrase[] } {
  const before: OptionalPhrase[] = [ISTIADHA];
  if (surah !== 9 && !(surah === 1 && fromAyah === 1)) before.push(BASMALA);
  return { before, after: [SADAQA] };
}

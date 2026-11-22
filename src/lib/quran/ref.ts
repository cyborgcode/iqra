import { SURAHS } from "../../data/surahs";

/** Arabic-Indic and Persian digits (typed on Arabic keyboards) as ASCII digits. */
export function asciiDigits(s: string): string {
  return s.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String((d.charCodeAt(0) - 0x0660) % 0x90));
}

/** "2:255", "2 255", "٢:٢٥٥" or "36" (ayah 1) → surah and ayah numbers, if that ayah exists. */
export function parseAyahRef(input: string): { surah: number; ayah: number } | null {
  const m = /^\s*(\d{1,3})\s*(?:[:\uFF1A.\s\u060C,]\s*(\d{1,3}))?\s*$/.exec(asciiDigits(input));
  if (!m) return null;
  const surah = Number(m[1]);
  const ayah = m[2] === undefined ? 1 : Number(m[2]);
  if (surah < 1 || surah > SURAHS.length || ayah < 1 || ayah > SURAHS[surah - 1]!.ayahs) return null;
  return { surah, ayah };
}

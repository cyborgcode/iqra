// Test helpers: read the committed per-surah data the same way the app receives it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

interface SurahFile {
  surah: number;
  bismillah: string | null;
  ayahs: string[];
}

const cache = new Map<number, SurahFile>();

/** Tanzil and the model may order combining marks differently; compare canonical (NFC) forms in tests. */
export const nfc = (s: string) => s.normalize("NFC");

export function surah(n: number): SurahFile {
  let s = cache.get(n);
  if (!s) {
    s = JSON.parse(readFileSync(path.join(ROOT, `public/quran/${String(n).padStart(3, "0")}.json`), "utf8")) as SurahFile;
    cache.set(n, s);
  }
  return s;
}

/** Ayahs `from`..`to` (1-based, inclusive) of a surah, as { number, text }. */
export function ayahs(n: number, from: number, to = from): { number: number; text: string }[] {
  return surah(n)
    .ayahs.slice(from - 1, to)
    .map((text, i) => ({ number: from + i, text }));
}

export function* allAyahs(): Generator<{ surah: number; ayah: number; text: string }> {
  for (let n = 1; n <= 114; n++) {
    const s = surah(n);
    for (let a = 0; a < s.ayahs.length; a++) yield { surah: n, ayah: a + 1, text: s.ayahs[a]! };
  }
}

export interface FixtureRecitation {
  reciter: string;
  surah: number;
  ayah: number;
  transcript: string;
}

export function fixture(name: "clean-recitations" | "long-recitations"): FixtureRecitation[] {
  const file = path.join(ROOT, "src/test/fixtures", `${name}.json`);
  return (JSON.parse(readFileSync(file, "utf8")) as { recitations: FixtureRecitation[] }).recitations;
}

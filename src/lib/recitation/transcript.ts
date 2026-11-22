import { normalizeWord } from "../arabic/normalize";
import { similarity } from "../arabic/similarity";

/**
 * Whisper sometimes loops on a word when a segment ends unexpectedly, e.g. "بسم الله الرحمن" with the
 * last word skipped came back as "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحْمَنِ الرَّحْمَنِ". No ayah repeats a word
 * three times in a row (checked in the tests), so within one segment a run of three or more identical
 * words is collapsed to one. Pairs are kept: the Quran has some (هَيْهَاتَ هَيْهَاتَ).
 */
export function collapseLoops(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    const key = normalizeWord(words[i]!);
    let j = i + 1;
    while (j < words.length && key !== "" && similarity(normalizeWord(words[j]!), key) === 1) j++;
    out.push(...(j - i >= 3 ? [words[i]!] : words.slice(i, j)));
    i = j;
  }
  return out.join(" ");
}

/** One transcript from the per-segment outputs. */
export function joinSegments(texts: readonly string[]): string {
  return texts.map(collapseLoops).filter(Boolean).join(" ");
}

import { normalizeWord } from "../arabic/normalize";
import { ayahRef } from "../quran/book";
import type { Corpus } from "../quran/corpus";
import { ayahWords } from "../quran/tokenize";
import { align, type AlignToken } from "./align";
import { BASMALA, type OptionalPhrase } from "./phrases";

/** One expected word of a stretch of the Quran, or a word of an optional phrase between surahs. */
export interface WindowToken extends AlignToken {
  /** Word index in the corpus; null for a word of an optional phrase. */
  word: number | null;
  phrase?: OptionalPhrase["id"];
}

const BASMALA_KEYS = ayahWords(BASMALA.text).map(normalizeWord);

/**
 * The words [from, to) of the Quran as alignment tokens. Before the first ayah of every surah except
 * Al-Fatiha (where the basmala is ayah 1) and At-Tawba, the basmala is inserted as optional words.
 */
export function windowTokens(corpus: Corpus, from: number, to: number): WindowToken[] {
  const tokens: WindowToken[] = [];
  for (let w = Math.max(0, from); w < Math.min(corpus.size, to); w++) {
    const ayah = corpus.ayahOfWord[w]!;
    if (corpus.ayahStart[ayah] === w) {
      const ref = ayahRef(ayah);
      if (ref.ayah === 1 && corpus.bismillah[ref.surah - 1]) {
        for (const key of BASMALA_KEYS) tokens.push({ key, optional: true, word: null, phrase: "basmala" });
      }
    }
    tokens.push({ key: corpus.key(w), word: w });
  }
  return tokens;
}

/** An alignment step in corpus coordinates. `after` is the corpus word an extra word follows (−1 at the start). */
export type PlacedOp =
  | { type: "match"; words: number[]; heard: [number, number]; similarity: number }
  | { type: "miss"; word: number }
  | { type: "extra"; heard: number; after: number };

/** Where a run of heard words fits in the Quran. */
export interface Placement {
  /** First and one-past-last corpus word of the span (equal when only optional words were heard). */
  start: number;
  end: number;
  ops: PlacedOp[];
  /** Quran words heard correctly. */
  matched: number;
  /** Words of optional phrases (the basmala between surahs) heard correctly. */
  optional: number;
  /** Words heard in all. */
  heard: number;
  /** Sum of the similarities of all matched words, right or wrong: how closely the words fit. */
  closeness: number;
  /** How many of the span's two ends fall on an ayah boundary (segments usually hold whole ayahs). */
  aligned: number;
  phrases: OptionalPhrase["id"][];
}

/** matched + optional: how many heard words this placement explains. */
export function placementScore(p: Placement): number {
  return p.matched + p.optional;
}

/**
 * Aligns heard words (comparison keys) to the best-fitting span of the Quran words [from, to).
 * Among equally good spans, the one starting nearest `anchor` (a corpus word index) wins.
 */
export function place(corpus: Corpus, heard: readonly string[], from: number, to: number, anchor: number, threshold: number): Placement {
  const tokens = windowTokens(corpus, from, to);
  const anchorToken = Math.max(0, tokens.findIndex((t) => t.word !== null && t.word >= anchor));
  // A segment usually holds whole ayahs, so a misread word may open or close the span where the
  // segment and an ayah both begin or end (a wrong last word is a mistake, not an extra word).
  const boundary = (t: number, side: "start" | "end") => {
    const w = tokens[t]?.word;
    if (w === null || w === undefined) return false;
    const ayah = corpus.ayahOfWord[w]!;
    return side === "start" ? corpus.ayahStart[ayah] === w : corpus.ayahStart[ayah + 1] === w + 1;
  };
  const ops = align(tokens, heard, { threshold, local: { anchor: anchorToken, boundary } });

  const placed: PlacedOp[] = [];
  const phrases = new Set<OptionalPhrase["id"]>();
  let matched = 0;
  let optional = 0;
  let closeness = 0;
  let start = -1;
  let end = -1;
  let after = -1;
  let firstOptional: number | null = null;
  for (const op of ops) {
    if (op.type === "extra") {
      placed.push({ type: "extra", heard: op.heard, after });
      continue;
    }
    const [a, b] = op.type === "miss" ? [op.expected, op.expected + 1] : op.expected;
    const words = tokens.slice(a, b).flatMap((t) => (t.word === null ? [] : [t.word]));
    const good = op.type === "match" && op.similarity >= threshold;
    if (op.type === "match") closeness += op.similarity;
    if (words.length === 0) {
      // A word of an optional phrase (merges never mix optional and Quran words).
      if (good) {
        optional += op.heard[1] - op.heard[0];
        phrases.add(tokens[a]!.phrase!);
        firstOptional ??= a;
      }
      continue;
    }
    if (start < 0) start = words[0]!;
    end = words.at(-1)! + 1;
    after = end - 1;
    if (op.type === "miss") placed.push({ type: "miss", word: words[0]! });
    else {
      placed.push({ type: "match", words, heard: op.heard, similarity: op.similarity });
      if (good) matched += op.heard[1] - op.heard[0];
    }
  }
  if (start < 0) {
    // Only optional words: position the placement at the surah they introduce.
    const next = firstOptional === null ? null : tokens.slice(firstOptional).find((t) => t.word !== null);
    start = end = next?.word ?? Math.max(0, Math.min(anchor, corpus.size));
  }
  // Extras before the first Quran word of the span sit just before it.
  for (const op of placed) if (op.type === "extra" && op.after < 0) op.after = start - 1;
  const aligned =
    end > start ? Number(corpus.ayahStart[corpus.ayahOfWord[start]!] === start) + Number(corpus.ayahStart[corpus.ayahOfWord[end - 1]! + 1] === end) : 0;
  return { start, end, ops: placed, matched, optional, heard: heard.length, closeness, aligned, phrases: [...phrases] };
}

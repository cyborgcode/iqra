import type { Corpus } from "../quran/corpus";
import { joinKeys } from "./align";
import { place, placementScore, type Placement } from "./window";

/**
 * Finding a recitation anywhere in the Quran.
 *
 * Every word gets a "skeleton": its comparison key without alefs and optional letters, the letters
 * that Uthmani and standard spelling most often write differently. Runs of 1–3 heard skeletons are
 * looked up in an index of the whole Quran; each hit votes for the offset (corpus position − heard
 * position) at which the heard words would line up, weighted by how rare the run is:
 *
 *   vote(n-gram) = n · ln(1 + N / postings)        (N = 77,433 words)
 *
 * The best-voted offsets, plus the page the reader is looking at, are then checked with the full
 * word alignment, so a transcript with misheard words is still placed correctly.
 */

/** Comparison key without alefs and optional letters. */
export function skeleton(key: string): string {
  return key.replace(/[\u0627\uE000-\uE003]/g, "");
}

/**
 * A skeleton without a leading و or ف, so a conjunction the model dropped or added (فَٱلْمُدَبِّرَٰتِ ~
 * المدبرات) still finds the word.
 */
function looseSkeleton(sk: string): string {
  return sk.length > 3 && (sk[0] === "\u0648" || sk[0] === "\u0641") ? sk.slice(1) : sk;
}

/** The key with its optional letters dropped but alefs kept: separates الم (الٓمٓ) from لم. */
function tightKey(key: string): string {
  return key.replace(/[\uE000-\uE003]/g, "");
}

/** Single words this common carry too little information to vote. */
const MAX_UNIGRAM_POSTINGS = 250;
const MAX_TIGHT_POSTINGS = 400;
const MAX_BIGRAM_POSTINGS = 1000;
/** Segments are cut at pauses, so they usually start where an ayah starts: such offsets count more. */
const AYAH_START_BONUS = 1.5;
/** Offsets checked with the full alignment, besides the reader's page. */
const CANDIDATES = 8;

export class SearchIndex {
  private readonly vocab = new Map<string, number>();
  private readonly ids: Int32Array;
  private readonly grams: [Map<number, number[]>, Map<number, number[]>, Map<number, number[]>] = [new Map(), new Map(), new Map()];
  private readonly tight = new Map<string, number[]>();
  private readonly loose = new Map<string, number[]>();
  private readonly ayahStarts: Uint8Array;
  private base = 1;

  private constructor(readonly corpus: Corpus) {
    this.ids = new Int32Array(corpus.size);
    this.ayahStarts = new Uint8Array(corpus.size);
    for (const w of corpus.ayahStart) if (w < corpus.size) this.ayahStarts[w] = 1;
  }

  static async build(corpus: Corpus, pause?: () => Promise<void>): Promise<SearchIndex> {
    const index = new SearchIndex(corpus);
    const { ids, vocab } = index;
    const add = (map: Map<string, number[]>, key: string, i: number) => {
      const list = map.get(key);
      if (list) list.push(i);
      else map.set(key, [i]);
    };
    for (let i = 0; i < corpus.size; i++) {
      const key = corpus.key(i);
      const sk = skeleton(key);
      let id = vocab.get(sk);
      if (id === undefined) vocab.set(sk, (id = vocab.size));
      ids[i] = id;
      add(index.tight, tightKey(key), i);
      add(index.loose, looseSkeleton(sk), i);
      if (pause && i % 8192 === 8191) await pause();
    }
    index.base = vocab.size + 1;
    for (let n = 1; n <= 3; n++) {
      const map = index.grams[n - 1]!;
      for (let i = 0; i + n <= corpus.size; i++) {
        const key = index.gramKey(ids, i, n);
        const list = map.get(key);
        if (list) list.push(i);
        else map.set(key, [i]);
      }
      if (pause) await pause();
    }
    return index;
  }

  private gramKey(ids: ArrayLike<number>, i: number, n: number): number {
    let key = 0;
    for (let k = 0; k < n; k++) key = key * this.base + ids[i + k]!;
    return key;
  }

  /** Offsets (corpus word − heard word) where the heard words line up, best voted first. */
  candidates(heard: readonly string[]): number[] {
    const id = (k: string) => this.vocab.get(skeleton(k)) ?? -1;
    const ids = heard.map(id);
    // Two heard words that the Uthmani text writes as one (يا أيها ~ يَـٰٓأَيُّهَا).
    const joined = heard.map((k, i) => (i + 1 < heard.length ? id(joinKeys([k, heard[i + 1]!])) : -1));
    const votes = new Map<number, number>();
    const N = this.corpus.size;
    const cast = (postings: readonly number[], at: number, weight: number) => {
      for (const p of postings) {
        const d = p - at;
        votes.set(d, (votes.get(d) ?? 0) + weight * (d >= 0 && this.ayahStarts[d] ? AYAH_START_BONUS : 1));
      }
    };
    const vote = (n: number, gram: readonly number[], at: number, words: number) => {
      if (gram.some((g) => g < 0)) return;
      const postings = this.grams[n - 1]!.get(this.gramKey(gram, 0, n));
      if (!postings) return;
      if ((n === 1 && words === 1 && postings.length > MAX_UNIGRAM_POSTINGS) || (n === 2 && postings.length > MAX_BIGRAM_POSTINGS)) return;
      cast(postings, at, words * Math.log(1 + N / postings.length));
    };
    for (let i = 0; i < heard.length; i++) {
      for (let n = 1; n <= 3 && i + n <= ids.length; n++) vote(n, ids.slice(i, i + n), i, n);
      const tight = this.tight.get(tightKey(heard[i]!));
      if (tight && tight.length <= MAX_TIGHT_POSTINGS) cast(tight, i, Math.log(1 + N / tight.length));
      const loose = this.loose.get(looseSkeleton(skeleton(heard[i]!)));
      if (loose && loose.length <= MAX_UNIGRAM_POSTINGS) cast(loose, i, 0.6 * Math.log(1 + N / loose.length));
      if (joined[i]! >= 0) {
        vote(1, [joined[i]!], i, 2);
        if (i + 2 < ids.length) vote(2, [joined[i]!, ids[i + 2]!], i, 3);
        if (i > 0) vote(2, [ids[i - 1]!, joined[i]!], i - 1, 3);
      }
    }
    // Words heard twice or missed shift the offset a little: pool nearby offsets.
    const radius = 2 + Math.floor(heard.length / 6);
    const offsets = [...votes.keys()].sort((a, b) => a - b);
    const pooled = offsets.map((d, i) => {
      let sum = 0;
      for (let k = i; k >= 0 && offsets[k]! >= d - radius; k--) sum += votes.get(offsets[k]!)!;
      for (let k = i + 1; k < offsets.length && offsets[k]! <= d + radius; k++) sum += votes.get(offsets[k]!)!;
      return { d, score: sum, own: votes.get(d)! };
    });
    pooled.sort((a, b) => b.score - a.score || b.own - a.own || a.d - b.d);
    const picked: number[] = [];
    const spread = heard.length + 2 * radius;
    for (const { d } of pooled) {
      if (picked.length >= CANDIDATES) break;
      if (picked.every((q) => Math.abs(q - d) > spread)) picked.push(d);
    }
    return picked;
  }
}

export interface LocateOptions {
  threshold: number;
  /** Corpus words the reader is looking at (e.g. the open page): preferred when matches are equally good. */
  hint?: readonly [number, number] | null;
}

function distance(p: Placement, hint: readonly [number, number] | null | undefined): number {
  if (!hint) return 0;
  if (p.start >= hint[0] && p.start < hint[1]) return 0;
  return p.start < hint[0] ? hint[0] - p.start : p.start - hint[1] + 1;
}

/** Compares two placements of the same heard words: negative when `a` is the better one. */
function compare(a: Placement, b: Placement, hint: LocateOptions["hint"]): number {
  return (
    placementScore(b) - placementScore(a) ||
    Number(distance(a, hint) > 0) - Number(distance(b, hint) > 0) ||
    b.closeness - a.closeness ||
    b.aligned - a.aligned ||
    b.matched - a.matched ||
    distance(a, hint) - distance(b, hint) ||
    a.start - b.start
  );
}

/** True when the best placement is not clearly better than the second best (the words recur elsewhere). */
export function isAmbiguous(found: readonly Placement[], hint: LocateOptions["hint"]): boolean {
  const [a, b] = found;
  if (!a || !b) return false;
  return (
    placementScore(a) === placementScore(b) &&
    (distance(a, hint) > 0) === (distance(b, hint) > 0) &&
    Math.abs(a.closeness - b.closeness) < 1e-6 &&
    a.aligned === b.aligned
  );
}

/**
 * Where in the Quran these heard words (comparison keys) were most likely recited, best first.
 * Ties go to the reader's page, then to the closest spelling, then to a span of whole ayahs, then to
 * the nearest place, then to the earliest.
 */
export function locate(index: SearchIndex, heard: readonly string[], { threshold, hint }: LocateOptions): Placement[] {
  if (heard.length === 0) return [];
  const corpus = index.corpus;
  const pad = 8 + Math.ceil(heard.length / 4);
  const windows: [number, number, number][] = index.candidates(heard).map((d) => [d - pad, d + heard.length + pad, d]);
  // The open page itself: pages start on an ayah, so nothing before it needs to be included.
  if (hint) windows.push([hint[0], hint[1] + pad, hint[0]]);

  const seen = new Set<number>();
  const placements: Placement[] = [];
  for (const [from, to, anchor] of windows) {
    const p = place(corpus, heard, Math.max(0, from), Math.min(corpus.size, to), Math.max(0, anchor), threshold);
    if (placementScore(p) === 0 || seen.has(p.start)) continue;
    seen.add(p.start);
    placements.push(p);
  }
  return placements.sort((a, b) => compare(a, b, hint));
}

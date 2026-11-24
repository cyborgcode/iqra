import { normalizeWord } from "../arabic/normalize";
import type { Corpus } from "../quran/corpus";
import { ayahWords } from "../quran/tokenize";
import { sim } from "./align";
import type { WordStatus } from "./evaluate";
import { isAmbiguous, locate, type SearchIndex } from "./locate";
import { AMIN, BASMALA, ISTIADHA, SADAQA, type OptionalPhrase } from "./phrases";
import { collapseLoops } from "./transcript";
import { place, placementScore, type Placement } from "./window";

/**
 * Follows a recitation through the Quran, one finished segment (≈ one ayah) at a time.
 *
 * The first words are looked up anywhere in the Quran (preferring the open page). After that each
 * segment is aligned near where the reciter is ("the cursor"): words skipped on the way are missed,
 * a segment that goes back is a repetition (its words take the latest attempt), and a segment that
 * fits nowhere nearby is looked up again, which follows the reciter when they jump elsewhere.
 * Partial transcripts of the segment still being recited can be previewed without changing anything.
 */

export interface WordMark {
  status: WordStatus;
  /** What was heard, for words heard differently (or as several words). */
  heard?: string;
  similarity: number;
}

export interface ExtraMark {
  text: string;
  /** It repeats a nearby word of the text (a repeated phrase or a restart). */
  repeated: boolean;
}

/** Marks shown on the book; they persist across recitations until cleared, the latest attempt winning. */
export interface BookMarks {
  words: Map<number, WordMark>;
  /** Extra words, by the corpus word they follow (−1: before the first word of the Quran). */
  extras: Map<number, ExtraMark[]>;
}

export type TrackEvent =
  /** Nothing usable was heard. */
  | { kind: "empty" }
  /** Not placed yet: the words occur in several places or are too few; they wait for the next segment. */
  | { kind: "waiting" }
  /** Only an optional phrase (isti'adha, basmala, …). */
  | { kind: "phrase"; phrases: OptionalPhrase["id"][] }
  | { kind: "located" | "followed" | "repeated" | "jumped"; start: number; end: number }
  | { kind: "unrecognized"; text: string };

/** A provisional view of the segment still being recited. */
export interface LiveView {
  start: number;
  end: number;
  /** Corpus words heard so far in this segment. */
  heard: number[];
  /**
   * The words of the segment already said, as they read so far: all but the one still being said (the
   * transcript may have cut it off mid-word). Correct, wrong or missed, as the finished segment would
   * most likely mark them.
   */
  settled: ReadonlyMap<number, WordMark>;
}

interface Heard {
  raw: string[];
  keys: string[];
}

interface Choice {
  placement: Placement | null;
  /** The heard words placed: keys[from, from + size) (optional phrases around them were stripped). */
  from: number;
  size: number;
  phrases: OptionalPhrase["id"][];
  score: number;
  ambiguous: boolean;
}

const phraseKeys = (p: OptionalPhrase) => ayahWords(p.text).map(normalizeWord);
const LEADING = [ISTIADHA, BASMALA].map((p) => ({ id: p.id, keys: phraseKeys(p) }));
const TRAILING = [SADAQA, AMIN].map((p) => ({ id: p.id, keys: phraseKeys(p) }));

/** Segments kept while waiting to be placed. */
const MAX_WAITING = 3;
/** How far back a repetition is looked for: the current and the previous ayah, at most this many words. */
const MAX_BACK = 80;
/** Words left at the end of an ayah when the reciter stops that count as missed. */
const MAX_UNFINISHED = 2;
/**
 * A preview this many words past where the reciter is expected, or further, or before it, needs as many
 * words that fit: a provisional transcript is often cut off mid-word and misheard, and a word or two
 * fitting elsewhere (a common one, like «لَا» or «اللَّهِ») is more often that than a skipped ayah or a
 * repeated phrase, which the finished phrase will show anyway.
 */
const PREVIEW_LEAP = 3;
/**
 * A phrase that fits nowhere near the reciter is taken for a jump elsewhere only if this many of its
 * words fit there, in one place only, or if it fits on a page the reader has turned to: two common
 * words, often a misheard fragment (the end of an ayah cut off, «وَإِذَا مَا»), fit in many places,
 * and would send the book away from the reciter.
 */
const JUMP_WORDS = 3;

export function heardWords(text: string): Heard {
  const raw = collapseLoops(text)
    .split(/\s+/)
    .filter((w) => normalizeWord(w) !== "");
  return { raw, keys: raw.map(normalizeWord) };
}

/** Matches an optional phrase at `from`, allowing one misheard or extra word. Returns the words used. */
function matchPhrase(phrase: readonly string[], keys: readonly string[], from: number, threshold: number) {
  let h = from;
  let matched = 0;
  for (const p of phrase) {
    if (h < keys.length && sim(p, keys[h]!) >= threshold) {
      matched++;
      h++;
    } else if (h + 1 < keys.length && sim(p, keys[h + 1]!) >= threshold) {
      matched++;
      h += 2;
    }
  }
  return matched >= Math.ceil(phrase.length * 0.75) ? { consumed: h - from, matched } : null;
}

/** The ways to read the heard words with optional phrases stripped from their start and end. */
function variants(keys: readonly string[], threshold: number) {
  const leads = [{ at: 0, phrases: [] as OptionalPhrase["id"][], credit: 0 }];
  for (const phrase of LEADING) {
    for (const lead of [...leads]) {
      const m = matchPhrase(phrase.keys, keys, lead.at, threshold);
      if (m) leads.push({ at: lead.at + m.consumed, phrases: [...lead.phrases, phrase.id], credit: lead.credit + m.matched });
    }
  }
  const trails = [{ at: keys.length, phrases: [] as OptionalPhrase["id"][], credit: 0 }];
  for (const phrase of TRAILING) {
    for (let k = Math.max(0, keys.length - phrase.keys.length - 1); k <= keys.length - phrase.keys.length; k++) {
      const m = matchPhrase(phrase.keys, keys, k, threshold);
      if (m && k + m.consumed === keys.length && m.matched === phrase.keys.length) {
        trails.push({ at: k, phrases: [phrase.id], credit: m.matched });
        break;
      }
    }
  }
  return leads.flatMap((l) =>
    trails.filter((t) => t.at >= l.at).map((t) => ({ from: l.at, to: t.at, phrases: [...l.phrases, ...t.phrases], credit: l.credit + t.credit })),
  );
}

export class Tracker {
  /** Where the reciter is: the corpus word after the last one placed (null until located). */
  cursor: number | null = null;
  /** The furthest the reciter has got since they were last located. */
  private frontier = 0;
  /** Words and extras marked during this recitation. */
  readonly sessionWords = new Set<number>();
  sessionExtras = 0;
  readonly phrases = new Set<OptionalPhrase["id"]>();
  readonly unrecognized: string[] = [];
  /** Corpus words of the first and last placed word, for the summary. */
  span: [number, number] | null = null;
  private waiting: Heard[] = [];

  constructor(
    private readonly index: SearchIndex,
    readonly marks: BookMarks,
    private readonly threshold: number,
  ) {}

  get corpus(): Corpus {
    return this.index.corpus;
  }

  /** Start following at a corpus word (e.g. "recite from here"). */
  startAt(word: number) {
    this.cursor = word;
    this.frontier = word;
  }

  /** The best placement of `keys` for each way of stripping optional phrases. */
  private choose(keys: readonly string[], placer: (core: string[]) => Placement[], hint: readonly [number, number] | null): Choice | null {
    let best: Choice | null = null;
    for (const v of variants(keys, this.threshold)) {
      const core = keys.slice(v.from, v.to);
      const found = core.length ? placer(core) : [];
      const placement = found[0] ?? null;
      const score = (placement ? placementScore(placement) : 0) + v.credit;
      if (score === 0) continue;
      // On a tie the reading with fewer stripped words wins: Quran text before optional phrases.
      if (!best || score > best.score) {
        best = { placement, from: v.from, size: core.length, phrases: v.phrases, score, ambiguous: isAmbiguous(found, hint) };
      }
    }
    return best;
  }

  private localPlacement(keys: readonly string[]): Placement[] {
    const corpus = this.corpus;
    const n = corpus.size;
    const c = Math.min(this.cursor!, n);
    const f = Math.min(Math.max(this.frontier, c), n);
    if (c >= n && f >= n) return [];
    const ayahC = corpus.ayahOfWord[Math.min(c, n - 1)]!;
    const from = Math.max(corpus.ayahStart[Math.max(0, ayahC - 1)]!, c - MAX_BACK, 0);
    const ayahF = corpus.ayahOfWord[Math.min(f, n - 1)]!;
    // Far enough ahead to notice up to two skipped ayahs.
    const ahead = corpus.ayahStart[Math.min(corpus.ayahStart.length - 1, ayahF + 4)]!;
    const to = Math.min(n, Math.max(ahead, f + keys.length + 10), f + keys.length + 150);
    const p = place(corpus, keys, from, to, c, this.threshold);
    return placementScore(p) > 0 ? [p] : [];
  }

  private globalPlacement(keys: readonly string[], hint: readonly [number, number] | null): Placement[] {
    return locate(this.index, keys, { threshold: this.threshold, hint });
  }

  /**
   * The optional phrases a choice consists of, if it holds no Quran words and explains most of what
   * was heard; they are recorded as recited. Otherwise null.
   */
  private phrasesOnly(choice: Choice, heard: number): OptionalPhrase["id"][] | null {
    if (choice.placement?.matched || choice.score < Math.max(1, Math.ceil(0.6 * heard))) return null;
    const ids = [...choice.phrases, ...(choice.placement?.phrases ?? [])];
    for (const id of ids) this.phrases.add(id);
    return ids;
  }

  /** Whether a placement starts on the open page. */
  private onPage(p: Placement, hint: readonly [number, number] | null): boolean {
    return !!hint && p.start >= hint[0] && p.start < hint[1];
  }

  /** It can only be there (see JUMP_WORDS). */
  private distinct(choice: Choice, hint: readonly [number, number] | null): boolean {
    const p = choice.placement!;
    if (p.matched >= JUMP_WORDS && !choice.ambiguous) return true;
    // The reader has turned to another page than the one they were reciting, to recite from it.
    const away = !!hint && this.cursor !== null && (this.cursor < hint[0] || this.cursor > hint[1]);
    return away && this.onPage(p, hint);
  }

  /** Enough of the segment fits: at least half of its words and two of them, or a short segment on the open page. */
  private confident(choice: Choice, hint: readonly [number, number] | null): boolean {
    const p = choice.placement;
    if (!p || p.matched === 0) return false;
    if (p.matched >= 2 && p.matched >= choice.size * 0.5) return true;
    return choice.size <= 2 && this.onPage(p, hint);
  }

  private setMark(word: number, mark: WordMark) {
    this.marks.words.set(word, mark);
    this.sessionWords.add(word);
    if (!this.span) this.span = [word, word];
    else this.span = [Math.min(this.span[0], word), Math.max(this.span[1], word)];
  }

  private apply(choice: Choice, heard: Heard, mode: "located" | "follow" | "jumped"): TrackEvent {
    const p = choice.placement!;
    const corpus = this.corpus;
    for (const id of [...choice.phrases, ...p.phrases]) this.phrases.add(id);

    // Words skipped between the cursor and this segment were missed (unless recited earlier on).
    if (mode === "follow" && this.cursor !== null && p.start > this.cursor) {
      for (let w = this.cursor; w < p.start; w++) if (!this.sessionWords.has(w)) this.setMark(w, { status: "missed", similarity: 0 });
    }
    // The latest attempt replaces earlier extras between the words of the span.
    for (let w = p.start; w < p.end - 1; w++) this.marks.extras.delete(w);
    const raw = heard.raw.slice(choice.from);
    for (const op of p.ops) {
      if (op.type === "match") {
        const ok = op.similarity >= this.threshold;
        const text = raw.slice(op.heard[0], op.heard[1]).join(" ");
        const exact = ok && op.words.length === 1 && op.heard[1] - op.heard[0] === 1;
        for (const w of op.words) this.setMark(w, { status: ok ? "correct" : "wrong", similarity: op.similarity, ...(exact ? {} : { heard: text }) });
      } else if (op.type === "miss") {
        this.setMark(op.word, { status: "missed", similarity: 0 });
      } else {
        const text = raw[op.heard]!;
        const key = normalizeWord(text);
        let repeated = false;
        for (let w = Math.max(0, op.after - 7); w <= Math.min(corpus.size - 1, op.after + 8) && !repeated; w++) {
          repeated = sim(key, corpus.key(w)) >= this.threshold;
        }
        const list = this.marks.extras.get(op.after) ?? [];
        list.push({ text, repeated });
        this.marks.extras.set(op.after, list);
        this.sessionExtras++;
      }
    }

    const back = mode === "follow" && this.cursor !== null && p.start < this.cursor;
    this.cursor = p.end;
    this.frontier = mode === "follow" ? Math.max(this.frontier, p.end) : p.end;
    const kind = mode === "located" ? "located" : mode === "jumped" ? "jumped" : back ? "repeated" : "followed";
    return { kind, start: p.start, end: p.end };
  }

  /**
   * Places one finished segment and marks its words. `hint` is the range of corpus words the reader
   * is looking at, preferred when the words could belong to several places.
   */
  commit(text: string, hint: readonly [number, number] | null = null, final = false): TrackEvent {
    const heard = heardWords(text);
    if (heard.keys.length === 0 && !(final && this.waiting.length)) return { kind: "empty" };

    if (this.cursor === null) {
      const all: Heard = {
        raw: [...this.waiting.flatMap((h) => h.raw), ...heard.raw],
        keys: [...this.waiting.flatMap((h) => h.keys), ...heard.keys],
      };
      const choice = this.choose(all.keys, (core) => this.globalPlacement(core, hint), hint);
      const only = choice && this.phrasesOnly(choice, all.keys.length);
      if (only) {
        // Only optional phrases so far (or the basmala before a surah): keep listening.
        this.waiting = [];
        return { kind: "phrase", phrases: only };
      }
      const sure = choice && this.confident(choice, hint) && (!choice.ambiguous || this.waiting.length + 1 >= MAX_WAITING);
      if (choice && (sure || (final && choice.placement && choice.placement.matched > 0))) {
        this.waiting = [];
        return this.apply(choice, all, "located");
      }
      if (heard.keys.length) this.waiting.push(heard);
      if (this.waiting.length > MAX_WAITING) this.unrecognized.push(this.waiting.shift()!.raw.join(" "));
      if (final) {
        this.unrecognized.push(...this.waiting.map((h) => h.raw.join(" ")));
        this.waiting = [];
        return { kind: "unrecognized", text };
      }
      return { kind: "waiting" };
    }

    const local = this.choose(heard.keys, (core) => this.localPlacement(core), null);
    const only = local && this.phrasesOnly(local, heard.keys.length);
    if (only) return { kind: "phrase", phrases: only };
    if (local?.placement && this.confident(local, null)) return this.apply(local, heard, "follow");

    // Not where the reciter was: look everywhere.
    const far = this.choose(heard.keys, (core) => this.globalPlacement(core, hint), hint);
    // A jump needs to fit clearly better than the best nearby reading, and somewhere in particular.
    if (far?.placement && this.confident(far, hint) && far.placement.matched >= (local?.placement?.matched ?? 0) + 2 && this.distinct(far, hint)) {
      return this.apply(far, heard, "jumped");
    }
    if (local?.placement && local.placement.matched > 0) return this.apply(local, heard, "follow");
    this.unrecognized.push(heard.raw.join(" "));
    return { kind: "unrecognized", text };
  }

  /** Where the segment still being recited seems to be, from a partial transcript. Changes nothing. */
  preview(text: string, hint: readonly [number, number] | null = null): LiveView | null {
    const heard = heardWords(text);
    if (heard.keys.length === 0) return null;
    let choice: Choice | null;
    if (this.cursor === null) {
      // Turning to a page on a guess and back again is jarring: before the reciter is located, a
      // preview needs three words that fit in one place only (or a fit on the open page).
      const keys = [...this.waiting.flatMap((h) => h.keys), ...heard.keys];
      choice = this.choose(keys, (core) => this.globalPlacement(core, hint), hint);
      const p = choice?.placement;
      if (!choice || !p || !this.confident(choice, hint) || choice.ambiguous) return null;
      if (p.matched < 3 && !this.onPage(p, hint)) return null;
    } else {
      choice = this.choose(heard.keys, (core) => this.localPlacement(core), null);
      if (!choice?.placement || choice.placement.matched === 0) return null;
      // A leap waits for more of the phrase, rather than light (or turn the page to) a guess and go back.
      const { start, matched } = choice.placement;
      if ((start - this.cursor >= PREVIEW_LEAP || start < this.cursor) && matched < PREVIEW_LEAP) return null;
    }
    const p = choice.placement!;
    const words = p.ops.flatMap((op) => (op.type === "match" && op.similarity >= this.threshold ? op.words : []));
    const settled = new Map<number, WordMark>();
    const raw = heard.raw.slice(choice.from);
    for (const op of p.ops) {
      if (op.type === "match") {
        // The last word heard may be cut off: it is still being said.
        if (op.heard[1] >= choice.size) continue;
        const ok = op.similarity >= this.threshold;
        for (const w of op.words) settled.set(w, { status: ok ? "correct" : "wrong", similarity: op.similarity, ...(ok ? {} : { heard: raw.slice(op.heard[0], op.heard[1]).join(" ") }) });
      } else if (op.type === "miss") {
        settled.set(op.word, { status: "missed", similarity: 0 });
      }
    }
    // Words skipped between where the reciter was and this phrase, as the finished phrase will mark them,
    // once two words of it are heard.
    if (this.cursor !== null && p.start > this.cursor && p.matched >= 2) {
      for (let w = this.cursor; w < p.start; w++) if (!this.sessionWords.has(w)) settled.set(w, { status: "missed", similarity: 0 });
    }
    return { start: p.start, end: p.end, heard: words, settled };
  }

  /**
   * Call after the last segment. A reciter who stops one or two words before the end of an ayah has
   * left those words out.
   */
  finish(): void {
    if (this.cursor === null) return;
    const corpus = this.corpus;
    const c = this.cursor;
    if (c <= 0 || c >= corpus.size) return;
    const ayah = corpus.ayahOfWord[c]!;
    const start = corpus.ayahStart[ayah]!;
    const end = corpus.ayahStart[ayah + 1]!;
    if (c > start && end - c <= MAX_UNFINISHED) {
      for (let w = c; w < end; w++) if (!this.sessionWords.has(w)) this.setMark(w, { status: "missed", similarity: 0 });
    }
  }
}

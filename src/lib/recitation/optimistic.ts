/**
 * Showing a recitation as it goes, before the speech model has had its say (an optimistic view): the
 * book follows the reciter's voice and the model checks the words in parallel, a little behind.
 *
 * - **Ahead of the model.** While the reciter is speaking, the words their voice has gone on to since
 *   the last word the model heard are lit at once, from how long each takes to say (its length in
 *   `units`, times the reciter's pace). Up to three words ahead, never in a pause (silence is not
 *   counted). In "recite from memory" they are revealed as they are said, in the text's own colour
 *   until the model checks them.
 * - **Checked as it goes.** The words the model has heard and gone past are marked at once: correct
 *   straight away, a mistake once two transcripts in a row agree on it, so that one misheard
 *   transcript never shows a mistake that is not there.
 * - **Confirmed at the pause.** When the phrase is finished, the model's transcription of the whole of
 *   it marks every word, which may correct what was shown: a mistake can come late.
 */
import type { Corpus } from "../quran/corpus";
import type { WordMark } from "./tracker";

/** Seconds of speech a unit (about a letter) takes before the reciter's own pace is known. */
export const DEFAULT_SECONDS_PER_UNIT = 0.12;
/** A word lights up once this share of the time it takes to say has been spoken. */
const SHARE = 0.3;
/** Words lit at most ahead of the last word the model heard. */
export const MAX_AHEAD = 3;
/** Units a pace is first measured on; until then, the default holds. */
const MIN_UNITS = 8;

/** Arabic letters and alef wasla (not the tatweel, U+0640, which only stretches a joint). */
const LETTERS = /[\u0621-\u063F\u0641-\u064A\u0671]/g;
/** Maddah above (or an alef written with it): a long madd, held 4 to 6 counts. */
const MADDAH = /[\u0653\u0622]/g;
/** Shadda: a doubled letter. */
const SHADDA = /\u0651/g;
/** Superscript alef: a long ā the script writes small. */
const DAGGER_ALEF = /\u0670/g;
/** A letter marked silent. */
const SILENT = /[\u06DF\u06E0]/g;

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

/**
 * How long a word takes to say, in units of about a letter: its letters, a long madd as three more, a
 * long ā written small as one more, a doubled letter as half one more, silent letters as none.
 */
export function units(word: string): number {
  return Math.max(1, count(word, LETTERS) + 3 * count(word, MADDAH) + count(word, DAGGER_ALEF) + 0.5 * count(word, SHADDA) - count(word, SILENT));
}

const unitsCache = new WeakMap<Corpus, Float32Array>();
/** The units of corpus word `w`. */
export function wordUnits(corpus: Corpus, w: number): number {
  let all = unitsCache.get(corpus);
  if (!all) unitsCache.set(corpus, (all = new Float32Array(corpus.size)));
  return (all[w] ||= units(corpus.words[w]!));
}

/**
 * The words the voice has gone on to after `last` (the last word known to be said, or −1), given the
 * seconds of speech since that word was heard, up to `until` (exclusive).
 */
export function wordsAhead(corpus: Corpus, last: number, speech: number, secondsPerUnit: number, until = corpus.size, max = MAX_AHEAD): number[] {
  const out: number[] = [];
  let spoken = 0;
  for (let w = last + 1; w < Math.min(until, corpus.size) && out.length < max; w++) {
    const takes = secondsPerUnit * wordUnits(corpus, w);
    if (speech < spoken + SHARE * takes) break;
    out.push(w);
    spoken += takes;
  }
  return out;
}

/** One past the last word of the ayah of corpus word `w`. */
export const ayahEnd = (corpus: Corpus, w: number) => corpus.ayahStart[corpus.ayahOfWord[Math.min(w, corpus.size - 1)]! + 1]!;

/**
 * The reciter's pace, in seconds of speech per unit: from the finished phrases, and from the phrase
 * being recited as far as the model has heard it, so that it is known within the first words.
 */
export class Pace {
  private speech = 0;
  private units = 0;
  private current: { speech: number; units: number } | null = null;

  constructor(private readonly corpus: Corpus) {}

  private unitsOf(start: number, end: number): number {
    let sum = 0;
    for (let w = start; w < end; w++) sum += wordUnits(this.corpus, w);
    return sum;
  }

  /** A finished phrase: `speech` seconds for the corpus words [start, end). */
  add(speech: number, start: number, end: number) {
    this.current = null;
    if (speech <= 0 || end <= start) return;
    this.units += this.unitsOf(start, end);
    this.speech += speech;
  }

  /**
   * The phrase being recited, so far: `speech` seconds from its start to where the model has heard the
   * corpus words [start, last] (the last perhaps not all of it: it counts half).
   */
  observe(speech: number, start: number, last: number) {
    if (speech <= 0 || last < start) return;
    this.current = { speech, units: this.unitsOf(start, last) + wordUnits(this.corpus, last) / 2 };
  }

  get secondsPerUnit(): number {
    const units = this.units + (this.current?.units ?? 0);
    if (units < MIN_UNITS) return DEFAULT_SECONDS_PER_UNIT;
    // Within reason: a pause counted as speech, or a phrase placed wrongly, should not throw it off far.
    return Math.min(0.4, Math.max(0.03, (this.speech + (this.current?.speech ?? 0)) / units));
  }
}

/**
 * The marks to show for the words of a phrase already said, from its latest transcript (`settled`)
 * and the one before (`before`): a word read correctly at once, a mistake once both agree on it, and
 * otherwise what was shown already (`shown`), so that one misheard transcript changes nothing. A word
 * shown stays shown until the phrase is finished.
 */
export function checkedMarks(
  settled: ReadonlyMap<number, WordMark>,
  before: ReadonlyMap<number, WordMark>,
  shown: ReadonlyMap<number, WordMark>,
): Map<number, WordMark> {
  const out = new Map(shown);
  for (const [w, mark] of settled) {
    if (mark.status === "correct" || before.get(w)?.status === mark.status) out.set(w, mark);
  }
  return out;
}

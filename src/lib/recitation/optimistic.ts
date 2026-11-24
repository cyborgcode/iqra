/**
 * Showing a recitation as it goes, before the speech model has had its say (an optimistic view): the
 * book follows the reciter's voice and the model checks the words in parallel, a little behind.
 *
 * - **Ahead of the model.** While the reciter is speaking, the words their voice has gone on to since
 *   the last word the model heard are lit at once, from how long each takes to say: its letters times
 *   the reciter's pace. At most two words ahead, never in a pause (silence is not counted), and never
 *   in "recite from memory", where a word must not show before it is said.
 * - **Checked as it goes.** The words the model has heard and gone past are marked at once: correct
 *   straight away, a mistake once two transcripts in a row agree on it, so that one misheard
 *   transcript never shows a mistake that is not there.
 * - **Confirmed at the pause.** When the phrase is finished, the model's transcription of the whole of
 *   it marks every word, which may correct what was shown: a mistake can come late.
 */
import type { Corpus } from "../quran/corpus";
import type { WordMark } from "./tracker";

/** Seconds of speech a letter takes before the reciter's own pace is known: a moderate murattal. */
export const DEFAULT_SECONDS_PER_LETTER = 0.15;
/** A word lights up once this share of the time it takes to say has been spoken. */
const SHARE = 0.4;
/** Words lit at most ahead of the last word the model heard. */
export const MAX_AHEAD = 2;
/** Letters a pace is first measured on; until then, the default holds. */
const MIN_LETTERS = 12;

/** Letters of a corpus word, as compared (diacritics and marks aside). */
const letters = (corpus: Corpus, w: number) => Math.max(1, corpus.key(w).length);

/**
 * The words the voice has gone on to after `last` (the last word known to be said, or −1), given the
 * seconds of speech since that word was heard, up to `until` (exclusive).
 */
export function wordsAhead(corpus: Corpus, last: number, speech: number, secondsPerLetter: number, until = corpus.size, max = MAX_AHEAD): number[] {
  const out: number[] = [];
  let spoken = 0;
  for (let w = last + 1; w < Math.min(until, corpus.size) && out.length < max; w++) {
    const takes = secondsPerLetter * letters(corpus, w);
    if (speech < spoken + SHARE * takes) break;
    out.push(w);
    spoken += takes;
  }
  return out;
}

/** One past the last word of the ayah of corpus word `w`. */
export const ayahEnd = (corpus: Corpus, w: number) => corpus.ayahStart[corpus.ayahOfWord[Math.min(w, corpus.size - 1)]! + 1]!;

/** The reciter's pace, from finished phrases: seconds of speech per letter. */
export class Pace {
  private speech = 0;
  private letterCount = 0;

  constructor(private readonly corpus: Corpus) {}

  /** A finished phrase: `speech` seconds for the corpus words [start, end). */
  add(speech: number, start: number, end: number) {
    if (speech <= 0 || end <= start) return;
    for (let w = start; w < end; w++) this.letterCount += letters(this.corpus, w);
    this.speech += speech;
  }

  get secondsPerLetter(): number {
    if (this.letterCount < MIN_LETTERS) return DEFAULT_SECONDS_PER_LETTER;
    // Within reason: a pause counted as speech, or a phrase placed wrongly, should not throw it off far.
    return Math.min(0.5, Math.max(0.04, this.speech / this.letterCount));
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

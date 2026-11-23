/**
 * Catching the speech model going round in a loop.
 *
 * Whisper sometimes fails to end a transcription and repeats it instead, often from the start
 * ("قُلْ هُوَ اللَّهُ أَحَدٌ قُلْ هُوَ اللَّهُ أَحَدٌ قُلْ هُوَ…"), until it runs out of tokens; it does so
 * more often when it is given only a few seconds of silence after the phrase. A run of LOOP_TOKENS
 * tokens (about two words of fully vowelled text) coming back is taken as a loop: decoding stops there
 * instead of producing the rest, which also saves the time it would take.
 */

/** A run this long, seen a second time, is a loop. */
export const LOOP_TOKENS = 12;

type Id = bigint | number;

/** Follows a token sequence as it grows and finds where it starts to repeat itself. */
export class LoopDetector {
  /** Where the loop begins (the index of the first repeated token), or -1. */
  start = -1;
  private readonly seen = new Set<string>();
  /** The end (inclusive) of the next run to look at. */
  private next = LOOP_TOKENS - 1;

  constructor(private readonly length = LOOP_TOKENS) {
    this.next = length - 1;
  }

  /** Takes the sequence so far (only ever longer than before); true once it has gone round in a loop. */
  push(ids: readonly Id[]): boolean {
    const n = this.length;
    const run = (from: number) => ids.slice(from, from + n).join(",");
    for (; this.start < 0 && this.next < ids.length; this.next++) {
      const end = this.next;
      // Only runs that ended before this one starts count: a run never matches one it overlaps.
      if (end - 2 * n + 1 >= 0) this.seen.add(run(end - 2 * n + 1));
      if (this.seen.has(run(end - n + 1))) this.start = end - n + 1;
    }
    return this.start >= 0;
  }
}

/** Where `ids` starts to repeat itself (see LoopDetector), or -1. */
export function loopStart(ids: readonly Id[], length = LOOP_TOKENS): number {
  const detector = new LoopDetector(length);
  detector.push(ids);
  return detector.start;
}

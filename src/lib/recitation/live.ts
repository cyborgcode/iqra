import { FRAME_SAMPLES_16K, frameLevels, levelThreshold, segmentByPauses, type SegmentOptions } from "../audio/segment";

export interface LiveOptions extends SegmentOptions {
  /** A finished segment's text, delivered in order as soon as it is transcribed. */
  onFinal?: (index: number, text: string) => void;
  /**
   * A provisional text of the segment still being recited (`index` is the index it will get). Partial
   * transcriptions are only requested while no finished segment is waiting, so they never delay one.
   */
  onPartial?: (index: number, text: string) => void;
  /**
   * The model has nothing left to do: call `update` again now (rather than at the next tick), so the
   * phrase being recited is transcribed again as soon as it can be.
   */
  onIdle?: () => void;
}

/**
 * New audio needed in the open segment before it is transcribed again: a fraction of a word, so the
 * words being recited light up one by one, as fast as the model goes.
 */
const PARTIAL_GROWTH_SECONDS = 0.2;
/** The open segment must be at least this long to be worth a partial transcription (a short word). */
const PARTIAL_MIN_SECONDS = 0.5;
/** The reciter counts as speaking (worth a partial transcription) until this much silence. */
const SPEAKING_GAP_SECONDS = 0.2;
/** After this long a pause ends even a short phrase, which a shorter pause would join to the next. */
const LONG_PAUSE_SECONDS = 1;

/**
 * Transcribes a recitation while it is being recorded. Each time `update` is called with everything
 * recorded so far, phrases that are finished (the reciter has paused) are sent to the speech model in
 * the background, and, when the model is idle and the reciter is speaking, the phrase still being
 * recited is transcribed provisionally. After the reciter stops, only the last phrase remains, so the
 * results are ready almost immediately.
 */
export class LiveTranscriber {
  /** Samples already handed to the model as finished segments. */
  private committed = 0;
  private parts: Promise<string>[] = [];
  private settled = 0;
  /** Frame levels of the whole recording so far, so the speech/silence threshold is global. */
  private levels: number[] = [];
  /** Requests to the model not answered yet (finished segments and partials). */
  private inFlight = 0;
  private partialIndex = -1;
  private partialLength = 0;
  /** Where (in the whole recording) the phrase transcribed provisionally starts. */
  private partialStart = 0;
  private delivered = Promise.resolve();
  private finalsDelivered = 0;
  private finished = false;

  constructor(
    /** `partial`: the phrase is still being recited (its text is provisional). */
    private readonly transcribe: (segment: Float32Array, partial: boolean) => Promise<string>,
    private readonly options: LiveOptions = {},
  ) {}

  /** A request answered: when none is left, the model can take the next. */
  private answered() {
    this.inFlight--;
    if (this.inFlight === 0 && !this.finished) this.options.onIdle?.();
  }

  private send(segment: Float32Array) {
    const index = this.parts.length;
    this.inFlight++;
    const part = this.transcribe(segment, false);
    const done = () => {
      this.settled++;
      this.answered();
    };
    void part.then(done, done);
    this.parts.push(part);
    const onFinal = this.options.onFinal;
    this.delivered = this.delivered.then(async () => {
      const text = await part.catch(() => "");
      this.finalsDelivered = index + 1;
      onFinal?.(index, text);
    });
  }

  private sendPartial(segment: Float32Array, index: number, start: number) {
    this.inFlight++;
    this.partialIndex = index;
    this.partialLength = segment.length;
    this.partialStart = start;
    this.transcribe(segment, true).then(
      (text) => {
        // Stale once that segment (or a later one) is final.
        if (!this.finished && this.finalsDelivered <= index && this.parts.length <= index) this.options.onPartial?.(index, text);
        this.answered();
      },
      () => this.answered(),
    );
  }

  /**
   * Sends the finished segments of `tail` (the recording from `base` on). The first starts no later than
   * its provisional transcripts did: the level that counts as speech rises as a recording begins and the
   * reciter's voice is heard, and would otherwise cut off a soft start the model has already heard.
   */
  private sendFinished(tail: Float32Array, base: number, segments: readonly { start: number; end: number }[]) {
    segments.forEach((s, i) => {
      const start = i === 0 && this.parts.length === this.partialIndex ? Math.max(0, Math.min(s.start, this.partialStart - base)) : s.start;
      this.send(tail.slice(start, s.end));
    });
  }

  private threshold(samples: Float32Array): number | null {
    const frames = Math.floor(samples.length / FRAME_SAMPLES_16K);
    if (frames > this.levels.length) {
      const start = this.levels.length * FRAME_SAMPLES_16K;
      for (const v of frameLevels(samples.subarray(start, frames * FRAME_SAMPLES_16K))) this.levels.push(v);
    }
    return levelThreshold(this.levels);
  }

  /** Call periodically during recording with all samples so far (a view is fine; it is not kept). */
  update(samples: Float32Array): void {
    const base = this.committed;
    const tail = samples.subarray(base);
    const rate = this.options.sampleRate ?? 16000;
    const { segments, trailingSilence } = segmentByPauses(tail, { ...this.options, threshold: this.threshold(samples) });
    // Every segment but the last is finished: the reciter has paused after it and gone on. So is the
    // last one once the reciter pauses after it, at once (a phrase too short to stand alone, which the
    // next would take in, after a longer pause): its words need not wait for the next phrase.
    let finished = segments.length - 1;
    const last = segments.at(-1);
    if (last) {
      const seconds = (last.end - last.start) / rate;
      const pause = this.options.minPauseSeconds ?? 0.35;
      const short = seconds < (this.options.minSegmentSeconds ?? 1.2);
      if (trailingSilence >= (short ? LONG_PAUSE_SECONDS : pause)) finished = segments.length;
    }
    if (finished > 0) {
      this.sendFinished(tail, base, segments.slice(0, finished));
      this.committed += segments[finished - 1]!.end;
    }
    // While the reciter speaks, the phrase so far, provisionally; never while a finished one waits, and
    // not in a pause, where the phrase is about to be finished.
    const open = finished < segments.length ? segments.at(-1) : undefined;
    if (!this.options.onPartial || !open || this.inFlight > 0 || trailingSilence >= SPEAKING_GAP_SECONDS) return;
    const index = this.parts.length;
    // A phrase keeps the earliest start it was heard from (see sendFinished).
    const start = index === this.partialIndex ? Math.max(base, Math.min(base + open.start, this.partialStart)) : base + open.start;
    const length = samples.length - start;
    if (length < PARTIAL_MIN_SECONDS * rate) return;
    if (index === this.partialIndex && length - this.partialLength < PARTIAL_GROWTH_SECONDS * rate) return;
    this.sendPartial(samples.slice(start), index, start);
  }

  /** Call once after recording. Resolves with one text per segment, in order. */
  async finish(samples: Float32Array, onProgress?: (done: number, total: number) => void): Promise<string[]> {
    this.finished = true;
    const tail = samples.subarray(this.committed);
    this.sendFinished(tail, this.committed, segmentByPauses(tail, { ...this.options, threshold: this.threshold(samples) }).segments);
    this.committed = samples.length;
    const total = this.parts.length;
    onProgress?.(this.settled, total);
    const texts: string[] = [];
    for (const part of this.parts) {
      texts.push(await part);
      onProgress?.(Math.max(this.settled, texts.length), total);
    }
    await this.delivered;
    return texts;
  }

  /** Segments sent to the model so far. */
  get sent(): number {
    return this.parts.length;
  }
}

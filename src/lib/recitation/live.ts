import { FRAME_SAMPLES_16K, frameLevels, levelThreshold, segmentByPauses, type SegmentOptions } from "../audio/segment";

export interface LiveOptions extends SegmentOptions {
  /** A finished segment's text, delivered in order as soon as it is transcribed. */
  onFinal?: (index: number, text: string) => void;
  /**
   * A provisional text of the segment still being recited (`index` is the index it will get). Partial
   * transcriptions are only requested while no finished segment is waiting, so they never delay one.
   */
  onPartial?: (index: number, text: string) => void;
}

/** New audio needed in the open segment before it is transcribed again. */
const PARTIAL_GROWTH_SECONDS = 0.6;
/** The open segment must be at least this long to be worth a partial transcription. */
const PARTIAL_MIN_SECONDS = 0.8;

/**
 * Transcribes a recitation while it is being recorded. Each time `update` is called with everything
 * recorded so far, segments that are finished (the reciter has started the next phrase) are sent to
 * the speech model in the background, and, when the model is idle, the phrase still being recited is
 * transcribed provisionally. After the reciter stops, only the last segment remains, so the results
 * are ready almost immediately.
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
  private delivered = Promise.resolve();
  private finalsDelivered = 0;
  private finished = false;

  constructor(
    private readonly transcribe: (segment: Float32Array) => Promise<string>,
    private readonly options: LiveOptions = {},
  ) {}

  private send(segment: Float32Array) {
    const index = this.parts.length;
    this.inFlight++;
    const part = this.transcribe(segment);
    const done = () => {
      this.settled++;
      this.inFlight--;
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

  private sendPartial(segment: Float32Array, index: number) {
    this.inFlight++;
    this.partialIndex = index;
    this.partialLength = segment.length;
    this.transcribe(segment).then(
      (text) => {
        this.inFlight--;
        // Stale once that segment (or a later one) is final.
        if (!this.finished && this.finalsDelivered <= index && this.parts.length <= index) this.options.onPartial?.(index, text);
      },
      () => this.inFlight--,
    );
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
    const { segments } = segmentByPauses(tail, { ...this.options, threshold: this.threshold(samples) });
    if (segments.length >= 2) {
      // Every segment but the last is final: its end is the middle of a pause the reciter has finished.
      for (const s of segments.slice(0, -1)) this.send(tail.slice(s.start, s.end));
      this.committed += segments[segments.length - 2]!.end;
    }
    const open = segments.at(-1);
    if (!this.options.onPartial || !open || this.inFlight > 0) return;
    const start = base + open.start;
    const length = samples.length - start;
    const rate = this.options.sampleRate ?? 16000;
    const index = this.parts.length;
    if (length < PARTIAL_MIN_SECONDS * rate) return;
    if (index === this.partialIndex && length - this.partialLength < PARTIAL_GROWTH_SECONDS * rate) return;
    this.sendPartial(samples.slice(start), index);
  }

  /** Call once after recording. Resolves with one text per segment, in order. */
  async finish(samples: Float32Array, onProgress?: (done: number, total: number) => void): Promise<string[]> {
    this.finished = true;
    const tail = samples.subarray(this.committed);
    for (const s of segmentByPauses(tail, { ...this.options, threshold: this.threshold(samples) }).segments) {
      this.send(tail.slice(s.start, s.end));
    }
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

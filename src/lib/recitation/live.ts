import { FRAME_SAMPLES_16K, frameLevels, levelThreshold, segmentByPauses, type SegmentOptions } from "../audio/segment";

/**
 * Transcribes a recitation while it is being recorded. Each time `update` is called with everything
 * recorded so far, segments that are finished (the reciter has started the next phrase) are sent to
 * the speech model in the background. After the reciter stops, only the last segment remains, so the
 * results are ready almost immediately. Nothing is shown until the recitation is finished.
 */
export class LiveTranscriber {
  /** Samples already handed to the model. */
  private committed = 0;
  private parts: Promise<string>[] = [];
  private settled = 0;
  /** Frame levels of the whole recording so far, so the speech/silence threshold is global. */
  private levels: number[] = [];

  constructor(
    private readonly transcribe: (segment: Float32Array) => Promise<string>,
    private readonly options: SegmentOptions = {},
  ) {}

  private send(segment: Float32Array) {
    const part = this.transcribe(segment);
    void part.then(
      () => this.settled++,
      () => this.settled++,
    );
    this.parts.push(part);
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
    const tail = samples.subarray(this.committed);
    const { segments } = segmentByPauses(tail, { ...this.options, threshold: this.threshold(samples) });
    if (segments.length < 2) return;
    // Every segment but the last is final: its end is the middle of a pause the reciter has finished.
    for (const s of segments.slice(0, -1)) this.send(tail.slice(s.start, s.end));
    this.committed += segments[segments.length - 2]!.end;
  }

  /** Call once after recording. Resolves with one text per segment, in order. */
  async finish(samples: Float32Array, onProgress?: (done: number, total: number) => void): Promise<string[]> {
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
    return texts;
  }

  /** Segments sent to the model so far. */
  get sent(): number {
    return this.parts.length;
  }
}

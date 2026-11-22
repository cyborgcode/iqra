/**
 * Pause-based segmentation of a recitation for Whisper.
 *
 * The recording is cut at every pause (the silences reciters leave between ayahs and at waqf marks),
 * so each segment is about one ayah or phrase. That matches what the Quran speech models were trained
 * on (one ayah per clip). In testing, segments that held several complete ayahs made the model skip
 * whole ayahs, while one-pause-per-segment transcribed every ayah. Cutting only at pauses also never
 * splits a word, unlike fixed windows, and segments without speech are dropped so the model cannot
 * invent text for silence. A piece longer than Whisper's 30 s window (a long ayah recited without a
 * pause) is split at its quietest point.
 */

export interface SegmentOptions {
  sampleRate?: number;
  /** Longest segment handed to the model. Whisper's window is 30 s; keep a margin. */
  maxSegmentSeconds?: number;
  /** Shortest silence that ends a segment. Shorter gaps (holds inside a word) are not cuts. */
  minPauseSeconds?: number;
  /** Pieces shorter than this are joined to the next one, so a lone word keeps some context. */
  minSegmentSeconds?: number;
  /**
   * Speech/silence threshold (dBFS) to use instead of estimating it from `samples`. When segmenting the
   * unprocessed end of a recording, pass the threshold of the whole recording (see `levelThreshold`).
   */
  threshold?: number | null;
}

export interface Segment {
  /** First sample (inclusive). */
  start: number;
  /** Last sample (exclusive). */
  end: number;
}

export interface Segmentation {
  segments: Segment[];
  /** False when the recording contains no speech at all (silence or a muted microphone). */
  hasSpeech: boolean;
}

const FRAME_SECONDS = 0.02;
/** Frames below this are treated as digital silence and ignored when estimating the noise floor. */
const DIGITAL_SILENCE_DBFS = -90;
/** Below this the whole recording is treated as silence (dBFS of the loudest frames). */
const SILENCE_DBFS = -55;
/** Speech/silence threshold, as a fraction of the way from the noise floor to the loud level. */
const THRESHOLD_FRACTION = 0.3;
/** Without at least this much dynamic range there are no reliable pauses to find. */
const MIN_DYNAMIC_RANGE_DB = 6;
/** Silence kept around each segment's speech. */
const PAD_SECONDS = 0.2;

export const FRAME_SAMPLES_16K = Math.round(FRAME_SECONDS * 16000);

/** Level of each 20 ms frame in dBFS. */
export function frameLevels(samples: Float32Array, frame = FRAME_SAMPLES_16K): Float32Array {
  const n = Math.floor(samples.length / frame);
  const db = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += samples[i]! * samples[i]!;
    db[f] = 10 * Math.log10(sum / frame + 1e-12);
  }
  return db;
}

function percentile(values: ArrayLike<number>, p: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? -Infinity;
}

/**
 * The speech/silence threshold for a recording from its frame levels, or null if it is silent.
 * Frames of digital silence are ignored when estimating the noise floor.
 */
export function levelThreshold(levels: ArrayLike<number>): number | null {
  if (levels.length === 0) return null;
  const loud = percentile(levels, 0.95);
  if (loud < SILENCE_DBFS) return null;
  const audible = Array.from(levels).filter((v) => v > DIGITAL_SILENCE_DBFS);
  const floor = audible.length ? percentile(audible, 0.1) : DIGITAL_SILENCE_DBFS;
  // With no dynamic range (continuous sound) every frame counts as speech.
  return loud - floor < MIN_DYNAMIC_RANGE_DB ? -Infinity : floor + THRESHOLD_FRACTION * (loud - floor);
}

export function segmentByPauses(samples: Float32Array, options: SegmentOptions = {}): Segmentation {
  const sampleRate = options.sampleRate ?? 16000;
  const frame = Math.round(FRAME_SECONDS * sampleRate);
  const maxFrames = Math.floor((options.maxSegmentSeconds ?? 24) / FRAME_SECONDS);
  const minPauseFrames = Math.ceil((options.minPauseSeconds ?? 0.35) / FRAME_SECONDS);
  const minSegmentFrames = Math.ceil((options.minSegmentSeconds ?? 1.2) / FRAME_SECONDS);
  const pad = Math.round(PAD_SECONDS / FRAME_SECONDS);

  const db = frameLevels(samples, frame);
  const n = db.length;
  if (n === 0) return { segments: [], hasSpeech: false };
  const threshold = options.threshold !== undefined ? options.threshold : levelThreshold(db);
  if (threshold === null) return { segments: [], hasSpeech: false };
  const silent = Array.from(db, (v) => v < threshold);

  // Speech runs, split wherever a silence lasts at least minPause.
  const runs: [number, number][] = [];
  for (let f = 0; f < n; ) {
    while (f < n && silent[f]) f++;
    if (f >= n) break;
    let end = f;
    let g = f;
    while (g < n) {
      if (!silent[g]) {
        end = ++g;
        continue;
      }
      let h = g;
      while (h < n && silent[h]) h++;
      if (h - g >= minPauseFrames || h >= n) break;
      g = h;
    }
    runs.push([f, end]);
    f = g;
  }
  if (runs.length === 0) return { segments: [], hasSpeech: false };

  // Pieces start and end in the middle of the pauses around them (or with padding at the edges).
  let pieces: [number, number][] = runs.map(([a, b], i) => [
    i === 0 ? Math.max(0, a - pad) : Math.floor((runs[i - 1]![1] + a) / 2),
    i === runs.length - 1 ? Math.min(n, b + pad) : Math.floor((b + runs[i + 1]![0]) / 2),
  ]);

  // Join very short pieces to the next one (or the previous one, at the end).
  const joined: [number, number][] = [];
  for (const piece of pieces) {
    const last = joined.at(-1);
    if (last && last[1] - last[0] < minSegmentFrames && piece[1] - last[0] <= maxFrames) last[1] = piece[1];
    else joined.push([...piece]);
  }
  const tail = joined.at(-1)!;
  const beforeTail = joined.at(-2);
  if (beforeTail && tail[1] - tail[0] < minSegmentFrames && tail[1] - beforeTail[0] <= maxFrames) {
    beforeTail[1] = tail[1];
    joined.pop();
  }
  pieces = joined;

  // A piece longer than the model's window is split at its quietest point near the limit.
  const fitted: [number, number][] = [];
  for (const [start, b] of pieces) {
    let a = start;
    while (b - a > maxFrames) {
      let best = a + maxFrames - 1;
      for (let f = Math.max(a + 1, a + maxFrames - Math.round(5 / FRAME_SECONDS)); f < a + maxFrames; f++) if (db[f]! < db[best]!) best = f;
      fitted.push([a, best]);
      a = best;
    }
    fitted.push([a, b]);
  }

  // Drop pieces that contain no speech, or too little of it to be a word.
  const minSpeechFrames = Math.ceil(0.15 / FRAME_SECONDS);
  const segments = fitted
    .filter(([a, b]) => {
      let speech = 0;
      for (let f = a; f < b; f++) if (!silent[f]) speech++;
      return speech >= minSpeechFrames;
    })
    .map(([a, b]) => ({ start: a * frame, end: Math.min(samples.length, b * frame) }));
  return { segments, hasSpeech: segments.length > 0 };
}

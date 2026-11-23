/**
 * A phrase raised to a steady loudness before the speech model hears it. Whisper's input features
 * depend on loudness, and a phone's microphone can be 30 dB quieter than the recordings it learned
 * from, quiet enough for it to recognize next to nothing. Phrases already loud enough are left as
 * they are.
 */

/** The level (RMS) the louder part of a phrase is raised to: about -14 dBFS. */
const TARGET = 0.2;
/** At most +30 dB. */
const MAX_GAIN = 31.6;
/** Phrases within about 3 dB of the target are not touched. */
const MIN_GAIN = 1.4;
const FRAME = 320; // 20 ms at 16 kHz

/** The gain a phrase needs: 1 when it is loud enough. */
export function levelGain(samples: Float32Array): number {
  const levels: number[] = [];
  for (let i = 0; i + FRAME <= samples.length; i += FRAME) {
    let sum = 0;
    for (let j = i; j < i + FRAME; j++) sum += samples[j]! * samples[j]!;
    levels.push(Math.sqrt(sum / FRAME));
  }
  if (levels.length === 0) return 1;
  levels.sort((a, b) => a - b);
  // The louder part of the phrase (its 95th percentile frame): the voice, not a click.
  const loud = levels[Math.min(levels.length - 1, Math.floor(levels.length * 0.95))]!;
  if (!(loud > 0)) return 1;
  const gain = Math.min(MAX_GAIN, TARGET / loud);
  return gain < MIN_GAIN ? 1 : gain;
}

export function leveled(samples: Float32Array): Float32Array {
  const gain = levelGain(samples);
  if (gain === 1) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.max(-1, Math.min(1, samples[i]! * gain));
  return out;
}

import { WhisperFeatureExtractor, type Tensor } from "@huggingface/transformers";
import { describe, expect, it } from "vitest";
import { windowFeatures } from "./decode";

// Whisper's feature extractor as the models configure it (preprocessor_config.json).
const extractor = new WhisperFeatureExtractor({
  feature_size: 80,
  sampling_rate: 16000,
  hop_length: 160,
  chunk_length: 30,
  n_fft: 400,
  n_samples: 480000,
  nb_max_frames: 3000,
  padding_value: 0,
});
const extract = (audio: Float32Array, options: { max_length: number }) =>
  (extractor as unknown as (a: Float32Array, o: { max_length: number }) => Promise<{ input_features: Tensor }>)(audio, options);

const SR = 16000;
function voice(seconds: number): Float32Array {
  let seed = 3;
  return Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => {
    const noise = ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.01;
    return 0.3 * Math.sin((2 * Math.PI * (180 + 40 * Math.sin(i / 4000)) * i) / SR) * Math.min(1, i / 800) + noise;
  });
}

async function maxDifference(audio: Float32Array, window: number): Promise<{ diff: number; dims: number[] }> {
  const full = (await extract(audio, { max_length: window })).input_features;
  const fast = await windowFeatures(extract, audio, window);
  const a = full.data as Float32Array;
  const b = fast.data as Float32Array;
  expect(fast.dims).toEqual(full.dims);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i]! - b[i]!));
  return { diff, dims: fast.dims };
}

describe("window features", () => {
  it("are those of the whole window, computed only where there is audio", async () => {
    const { diff, dims } = await maxDifference(voice(2.3), 8 * SR);
    expect(dims).toEqual([1, 80, 800]);
    // The same values, but for the last bit of a few (the matrix product rounds by its size).
    expect(diff).toBeLessThan(1e-6);
  });

  it("hold for any length of audio, up to a window it fills", async () => {
    for (const [seconds, window] of [
      [0.2, 6],
      [4.01, 10],
      [7.99, 8],
      [12, 12],
    ] as const) {
      expect((await maxDifference(voice(seconds), window * SR)).diff).toBeLessThan(1e-6);
    }
  });

  it("hold for silence", async () => {
    expect((await maxDifference(new Float32Array(SR), 7 * SR)).diff).toBeLessThan(1e-6);
  });
});

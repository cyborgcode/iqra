import { describe, expect, it, vi } from "vitest";
import { LiveTranscriber } from "./live";
import { segmentByPauses } from "../audio/segment";

const SR = 16000;

/**
 * Seven "ayahs" of 3–8 s with 0.8 s pauses; speech is a tone, pauses are faint noise. The last ayah has
 * a quieter (but not silent) stretch in the middle, like a reciter lowering their voice.
 */
function recitation(): { audio: Float32Array; ayahs: [number, number][] } {
  const lengths = [4, 6, 3.5, 5, 7.5, 5, 8];
  const total = lengths.reduce((s, l) => s + l + 0.8, 0.6);
  const audio = new Float32Array(Math.round(total * SR));
  let seed = 7;
  for (let i = 0; i < audio.length; i++) audio[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.002;
  const ayahs: [number, number][] = [];
  let t = 0.6;
  for (const l of lengths) {
    for (let i = Math.round(t * SR); i < Math.round((t + l) * SR); i++) audio[i] = 0.3 * Math.sin((2 * Math.PI * 200 * i) / SR);
    ayahs.push([t, t + l]);
    t += l + 0.8;
  }
  const [lastStart] = ayahs[6]!;
  for (let i = Math.round((lastStart + 3) * SR); i < Math.round((lastStart + 3.6) * SR); i++) audio[i]! *= 0.08;
  return { audio, ayahs };
}

describe("LiveTranscriber", () => {
  it("sends finished ayahs while recording and the rest at the end, in order", async () => {
    const { audio, ayahs } = recitation();
    const sentAt: number[] = [];
    const lengths: number[] = [];
    let recorded = 0;
    const live = new LiveTranscriber(async (segment) => {
      sentAt.push(recorded / SR);
      lengths.push(segment.length / SR);
      return `part${lengths.length}`;
    });
    // feed the recording one second at a time, as the app does
    for (recorded = SR; recorded < audio.length; recorded += SR) live.update(audio.subarray(0, recorded));
    const beforeStop = live.sent;
    recorded = audio.length;
    const progress: [number, number][] = [];
    const texts = await live.finish(audio, (done, total) => progress.push([done, total]));

    expect(texts).toEqual(["part1", "part2", "part3", "part4", "part5", "part6", "part7"]);
    expect(beforeStop).toBe(6); // all but the last ayah were already being transcribed
    // each ayah was sent within ~2 s of the reciter starting the next one
    sentAt.slice(0, 6).forEach((t, i) => expect(t).toBeLessThanOrEqual(ayahs[i + 1]![0] + 2));
    expect(progress.at(-1)).toEqual([7, 7]);
  });

  it("produces the same segments as segmenting the whole recording at once", async () => {
    const { audio } = recitation();
    const live: number[] = [];
    const t = new LiveTranscriber(async (segment) => {
      live.push(Math.round(segment.length / 1600));
      return "";
    });
    for (let n = SR; n < audio.length; n += SR) t.update(audio.subarray(0, n));
    await t.finish(audio);
    const whole = segmentByPauses(audio).segments.map((s) => Math.round((s.end - s.start) / 1600));
    expect(live).toHaveLength(whole.length);
    live.forEach((len, i) => expect(Math.abs(len - whole[i]!)).toBeLessThanOrEqual(3)); // within 0.3 s
  });

  it("returns nothing for a silent recording", async () => {
    const t = new LiveTranscriber(async () => "x");
    const silence = new Float32Array(SR * 5);
    t.update(silence);
    expect(await t.finish(silence)).toEqual([]);
  });
});

describe("LiveTranscriber: partial transcripts", () => {
  /** A model that takes `delay` ms per request and reports what it was asked. */
  function slowModel(delay: number) {
    const calls: { seconds: number; at: number }[] = [];
    let now = 0;
    return {
      calls,
      tick: (t: number) => (now = t),
      transcribe: (segment: Float32Array) =>
        new Promise<string>((resolve) => {
          calls.push({ seconds: segment.length / SR, at: now });
          setTimeout(() => resolve(`${(segment.length / SR).toFixed(1)}s`), delay);
        }),
    };
  }

  it("transcribes the phrase still being recited while the model is idle, and finished phrases first", async () => {
    vi.useFakeTimers();
    try {
      const { audio } = recitation();
      const model = slowModel(300);
      const finals: number[] = [];
      const partials: number[] = [];
      const log: string[] = [];
      const live = new LiveTranscriber(model.transcribe, {
        onFinal: (i) => (finals.push(i), log.push(`F${i}`)),
        onPartial: (i) => (partials.push(i), log.push(`P${i}`)),
      });
      for (let n = SR / 2; n < audio.length; n += SR / 2) {
        model.tick(n / SR);
        live.update(audio.subarray(0, n));
        await vi.advanceTimersByTimeAsync(500);
      }
      const done = live.finish(audio);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await done).toHaveLength(7);
      expect(finals).toEqual([0, 1, 2, 3, 4, 5, 6]);
      // Every ayah got provisional transcripts while it was being recited…
      expect(new Set(partials)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
      // …and none arrives after the ayah is final.
      for (const i of finals) expect(log.lastIndexOf(`P${i}`)).toBeLessThan(log.indexOf(`F${i}`));
    } finally {
      vi.useRealTimers();
    }
  });

  it("never sends a partial while a finished segment is waiting for the model", async () => {
    vi.useFakeTimers();
    try {
      const { audio } = recitation();
      let inFlight = 0;
      let partialWhileBusy = false;
      const live = new LiveTranscriber(
        (segment) => {
          inFlight++;
          return new Promise((resolve) =>
            setTimeout(() => {
              inFlight--;
              resolve(String(segment.length));
            }, 2500),
          );
        },
        {
          onPartial: () => {
            if (inFlight > 0) partialWhileBusy = true;
          },
        },
      );
      for (let n = SR / 2; n < audio.length; n += SR / 2) {
        live.update(audio.subarray(0, n));
        await vi.advanceTimersByTimeAsync(500);
      }
      const done = live.finish(audio);
      await vi.advanceTimersByTimeAsync(30000);
      await done;
      expect(partialWhileBusy).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

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
  it("sends each ayah as soon as the reciter pauses after it, and in order", async () => {
    const { audio, ayahs } = recitation();
    const sentAt: number[] = [];
    const lengths: number[] = [];
    let recorded = 0;
    const live = new LiveTranscriber(async (segment) => {
      sentAt.push(recorded / SR);
      lengths.push(segment.length / SR);
      return `part${lengths.length}`;
    });
    // Feed the recording a quarter of a second at a time, as the app does.
    const step = SR / 4;
    for (recorded = step; recorded < audio.length; recorded += step) live.update(audio.subarray(0, recorded));
    const beforeStop = live.sent;
    recorded = audio.length;
    const progress: [number, number][] = [];
    const texts = await live.finish(audio, (done, total) => progress.push([done, total]));

    expect(texts).toEqual(["part1", "part2", "part3", "part4", "part5", "part6", "part7"]);
    expect(beforeStop).toBe(7); // the last ayah too: the reciter paused after it before stopping
    // Each ayah was sent at the first look after a 0.35 s pause, before the next ayah began.
    sentAt.forEach((t, i) => {
      expect(t).toBeLessThanOrEqual(ayahs[i]![1] + 0.35 + 0.25 + 0.05);
      if (i < 6) expect(t).toBeLessThan(ayahs[i + 1]![0]);
    });
    expect(progress.at(-1)).toEqual([7, 7]);
  });

  it("waits for a longer pause before sending a phrase too short to stand alone", () => {
    // Two 0.6 s words with 0.5 s between them, then a 1.5 s pause; faint noise in the pauses.
    const audio = new Float32Array(Math.round(4.4 * SR));
    let seed = 3;
    for (let i = 0; i < audio.length; i++) audio[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.002;
    for (const [a, b] of [[0.5, 1.1], [1.6, 2.2]] as const) {
      for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) audio[i] = 0.3 * Math.sin((2 * Math.PI * 200 * i) / SR);
    }
    const sent: number[] = [];
    const live = new LiveTranscriber(async (segment) => {
      sent.push(segment.length / SR);
      return "";
    });
    const at = (seconds: number) => live.update(audio.subarray(0, Math.round(seconds * SR)));
    at(1.5); // 0.4 s after the first word: too short to stand alone yet
    expect(sent).toEqual([]);
    at(2.7); // 0.5 s after the second word: the two words, as one phrase
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeGreaterThan(1.6);
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
    // Within half a second: live, a phrase ends 0.2 s after the voice; whole, in the middle of the pause.
    live.forEach((len, i) => expect(Math.abs(len - whole[i]!)).toBeLessThanOrEqual(5));
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

  it("transcribes the phrase again as soon as the model is free, word by word", async () => {
    vi.useFakeTimers();
    try {
      const { audio, ayahs } = recitation();
      const model = slowModel(150);
      let recorded = 0;
      const feed = () => live.update(audio.subarray(0, recorded));
      const live = new LiveTranscriber(model.transcribe, { onPartial: () => {}, onIdle: feed });
      // The app's clock: a look every 100 ms, the model answering in 150 ms.
      const [start, end] = ayahs[4]!;
      for (let t = 0; t < end; t += 0.05) {
        recorded = Math.round(t * SR);
        model.tick(t);
        if (Math.round(t * 20) % 2 === 0) feed();
        await vi.advanceTimersByTimeAsync(50);
      }
      // Within the 7.5 s ayah, a provisional transcript started every 0.2 to 0.3 s: as soon as the
      // last was answered and a fifth of a second had been recited since.
      const during = model.calls.filter((c) => c.at > start + 1 && c.at < end - 0.5).map((c) => c.at);
      const gaps = during.slice(1).map((t, i) => t - during[i]!);
      expect(during.length).toBeGreaterThan(20);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(0.3 + 1e-9);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not cut off the start of a phrase begun softly, once the voice rises", async () => {
    // Faint noise; a soft start (1.5 s) then a full voice (2 s); a pause.
    const audio = new Float32Array(Math.round(5.5 * SR));
    let seed = 5;
    for (let i = 0; i < audio.length; i++) audio[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.001;
    const tone = (i: number, a: number) => a * Math.sin((2 * Math.PI * 200 * i) / SR);
    // About -53 dBFS: speech while it is all there is, below the threshold once the full voice is heard.
    for (let i = Math.round(0.5 * SR); i < 2 * SR; i++) audio[i] = tone(i, 0.003);
    for (let i = 2 * SR; i < 4 * SR; i++) audio[i] = tone(i, 0.4);
    const sent: { start: number; partial: boolean }[] = [];
    let recorded = 0;
    const live = new LiveTranscriber(
      async (segment, partial) => {
        // Where the segment starts in the recording: it is the end of what was recorded, or a
        // finished phrase cut where the voice ends.
        sent.push({ start: partial ? (recorded - segment.length) / SR : -segment.length / SR, partial });
        return "";
      },
      { onPartial: () => {} },
    );
    for (recorded = SR / 10; recorded <= audio.length; recorded += SR / 10) {
      live.update(audio.subarray(0, recorded));
      await Promise.resolve();
    }
    const partials = sent.filter((s) => s.partial);
    const final = sent.find((s) => !s.partial)!;
    // The soft start was heard as speech at first, and every provisional transcript keeps it…
    expect(partials.length).toBeGreaterThan(5);
    for (const p of partials) expect(p.start).toBeLessThan(0.6);
    // …and so does the finished phrase: 3.5 s of voice and the padding around it, not just the full voice.
    expect(-final.start).toBeGreaterThan(3.5);
  });

  it("keeps at most a fifth of a second of the zeros a microphone records as it starts", async () => {
    // 0.8 s of digital silence, a short noise, then 2 s of voice and a pause with faint noise.
    const audio = new Float32Array(Math.round(4.5 * SR));
    let seed = 9;
    for (let i = Math.round(0.8 * SR); i < audio.length; i++) audio[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.001;
    for (let i = SR; i < 3 * SR; i++) audio[i] = 0.3 * Math.sin((2 * Math.PI * 200 * i) / SR);
    const sent: { seconds: number; partial: boolean }[] = [];
    const live = new LiveTranscriber(
      async (segment, partial) => {
        sent.push({ seconds: segment.length / SR, partial });
        return "";
      },
      { onPartial: () => {} },
    );
    for (let n = SR / 10; n <= audio.length; n += SR / 10) {
      live.update(audio.subarray(0, n));
      await Promise.resolve();
    }
    const final = sent.find((s) => !s.partial)!;
    // The voice and the padding around it, and not the 0.8 s of zeros: at most 0.2 s of them.
    expect(final.seconds).toBeLessThan(2 + 0.2 + 0.2 + 0.2 + 0.05);
    expect(final.seconds).toBeGreaterThan(2);
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

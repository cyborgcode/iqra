import { describe, expect, it } from "vitest";
import { segmentByPauses } from "./segment";

const SR = 16000;

/** Builds a test signal from [seconds, kind] parts: "speech" is a modulated tone, "pause" is faint noise. */
function signal(parts: [number, "speech" | "pause"][]): Float32Array {
  const total = parts.reduce((s, [sec]) => s + Math.round(sec * SR), 0);
  const out = new Float32Array(total);
  let pos = 0;
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.002;
  for (const [sec, kind] of parts) {
    const n = Math.round(sec * SR);
    for (let i = 0; i < n; i++) {
      const t = (pos + i) / SR;
      out[pos + i] = kind === "speech" ? 0.3 * Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t)) : noise();
    }
    pos += n;
  }
  return out;
}

const seconds = (n: number) => n / SR;

describe("segmentByPauses", () => {
  it("makes one segment per phrase, cut in the middle of the pause, trimming the outer silence", () => {
    const { segments, hasSpeech } = segmentByPauses(signal([[1, "pause"], [6, "speech"], [0.5, "pause"], [5, "speech"], [2, "pause"]]));
    expect(hasSpeech).toBe(true);
    expect(segments).toHaveLength(2);
    expect(seconds(segments[0]!.start)).toBeCloseTo(0.8, 1);
    expect(seconds(segments[0]!.end)).toBeCloseTo(7.25, 1);
    expect(segments[1]!.start).toBe(segments[0]!.end);
    expect(seconds(segments[1]!.end)).toBeCloseTo(12.7, 1);
  });

  it("does not cut at a short hold inside a word", () => {
    const { segments } = segmentByPauses(signal([[0.5, "pause"], [3, "speech"], [0.2, "pause"], [3, "speech"], [0.5, "pause"]]));
    expect(segments).toHaveLength(1);
  });

  it("joins a very short piece to the next one so it keeps some context", () => {
    const { segments } = segmentByPauses(signal([[0.5, "pause"], [0.6, "speech"], [0.6, "pause"], [4, "speech"], [0.5, "pause"]]));
    expect(segments).toHaveLength(1);
  });

  it("finds the pauses between ayahs even when they are digital silence", () => {
    // seven 5-second ayahs, each followed by 0.4 s of exact zeros
    const parts: [number, "speech" | "pause"][] = [];
    for (let i = 0; i < 7; i++) parts.push([5, "speech"], [0.4, "pause"]);
    const audio = signal(parts);
    for (let i = 0; i < 7; i++) audio.fill(0, Math.round((i * 5.4 + 5) * SR), Math.round((i * 5.4 + 5.4) * SR));
    expect(segmentByPauses(audio).segments).toHaveLength(7);
  });

  it("cuts long recitations only inside pauses, into segments within the model's window", () => {
    // Ten 6-second "ayahs" separated by 0.6 s pauses: 65.4 s in total.
    const parts: [number, "speech" | "pause"][] = [];
    for (let i = 0; i < 10; i++) parts.push([6, "speech"], [0.6, "pause"]);
    const audio = signal(parts);
    const { segments } = segmentByPauses(audio);
    expect(segments.length).toBeGreaterThanOrEqual(3);
    for (const s of segments) expect(seconds(s.end - s.start)).toBeLessThanOrEqual(24);
    // every internal cut lands inside a pause (each pause starts 6 s into a 6.6 s cycle)
    for (const s of segments.slice(1)) {
      const inCycle = seconds(s.start) % 6.6;
      expect(inCycle).toBeGreaterThanOrEqual(6);
    }
    // the segments are contiguous and cover all the speech
    for (let i = 1; i < segments.length; i++) expect(segments[i]!.start).toBe(segments[i - 1]!.end);
    expect(seconds(segments.at(-1)!.end)).toBeGreaterThan(65);
  });

  it("falls back to cutting at the quietest point when there is no pause", () => {
    const { segments } = segmentByPauses(signal([[70, "speech"]]));
    expect(segments.length).toBeGreaterThanOrEqual(3);
    for (const s of segments) expect(seconds(s.end - s.start)).toBeLessThanOrEqual(24);
    for (let i = 1; i < segments.length; i++) expect(segments[i]!.start).toBe(segments[i - 1]!.end);
    expect(seconds(segments.at(-1)!.end)).toBeGreaterThan(69.5);
  });

  it("reports silence (or a muted microphone) as no speech", () => {
    expect(segmentByPauses(signal([[5, "pause"]]))).toMatchObject({ segments: [], hasSpeech: false });
    expect(segmentByPauses(new Float32Array(SR * 3))).toMatchObject({ segments: [], hasSpeech: false });
    expect(segmentByPauses(new Float32Array(0))).toMatchObject({ segments: [], hasSpeech: false });
  });

  it("reports how long the recording has been silent since the last speech", () => {
    expect(segmentByPauses(signal([[2, "speech"], [0.7, "pause"]])).trailingSilence).toBeCloseTo(0.7, 1);
    expect(segmentByPauses(signal([[1, "pause"], [2, "speech"]])).trailingSilence).toBeLessThan(0.05);
    expect(segmentByPauses(signal([[3, "pause"]])).trailingSilence).toBeCloseTo(3, 1);
  });

  it("drops a segment that holds only a click, not speech", () => {
    const audio = signal([[10, "speech"], [20, "pause"], [0.05, "speech"], [5, "pause"]]);
    const { segments } = segmentByPauses(audio);
    expect(segments).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { LOOP_TOKENS, LoopDetector, loopStart } from "./loops";

const seq = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);

describe("loops", () => {
  it("finds a transcription that starts over", () => {
    const phrase = seq(20, 100);
    // The first word of a repeat has a leading space, a token of its own: the loop is found one later.
    const ids = [...phrase, 7, ...phrase.slice(1), ...phrase.slice(1)];
    expect(loopStart(ids)).toBe(phrase.length + 1);
  });

  it("finds a phrase's last word repeated over and over", () => {
    const word = seq(6, 200);
    // The two words after the first two repeat them.
    expect(loopStart([...seq(10, 100), ...word, ...word, ...word, ...word])).toBe(22);
  });

  it("leaves text without a repeated run alone, even with short repeats", () => {
    const word = seq(5, 300);
    expect(loopStart([...seq(30, 100), ...word, ...word, ...seq(30, 500)])).toBe(-1);
    expect(loopStart(seq(LOOP_TOKENS * 2))).toBe(-1);
    expect(loopStart([])).toBe(-1);
  });

  it("does not count a run that overlaps itself", () => {
    // 1 1 1 … : every run of 12 equals the next, but they overlap until 24 tokens are there.
    expect(loopStart(Array(2 * LOOP_TOKENS - 1).fill(1))).toBe(-1);
    expect(loopStart(Array(2 * LOOP_TOKENS).fill(1))).toBe(LOOP_TOKENS);
  });

  it("follows a growing sequence step by step, as decoding does", () => {
    const phrase = seq(15, 100);
    const ids = [...phrase, ...phrase, ...phrase];
    const detector = new LoopDetector();
    let stoppedAt = -1;
    for (let n = 1; n <= ids.length && stoppedAt < 0; n++) if (detector.push(ids.slice(0, n).map(BigInt))) stoppedAt = n;
    expect(detector.start).toBe(phrase.length);
    // Decoding stops as soon as the repeated run is complete.
    expect(stoppedAt).toBe(phrase.length + LOOP_TOKENS);
  });
});

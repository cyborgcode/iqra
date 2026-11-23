import { describe, expect, it } from "vitest";
import { levelGain, leveled } from "./level";

const SR = 16000;
function voice(amplitude: number, seconds = 2): Float32Array {
  const out = new Float32Array(SR * seconds);
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / SR) * (i % SR < SR * 0.8 ? 1 : 0.05);
  return out;
}

describe("phrase loudness for the model", () => {
  it("leaves a phrase recorded at a normal level as it is", () => {
    const loud = voice(0.35); // about -12 dBFS
    expect(levelGain(loud)).toBe(1);
    expect(leveled(loud)).toBe(loud);
  });

  it("raises a quiet phrase, as from a phone without gain control, to the same level", () => {
    const quiet = voice(0.01); // about -43 dBFS
    const gain = levelGain(quiet);
    expect(gain).toBeGreaterThan(25);
    const raised = leveled(quiet);
    const peak = raised.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.25);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("raises at most 30 dB, and leaves silence alone", () => {
    expect(levelGain(voice(0.0001))).toBeCloseTo(31.6, 1);
    expect(levelGain(new Float32Array(SR))).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { OPT_ALEF } from "./normalize";
import { FINAL_TA_COST, similarity, weightedDistance } from "./similarity";

describe("similarity", () => {
  it("is 1 for identical keys and symmetric", () => {
    expect(similarity("الحمد", "الحمد")).toBe(1);
    expect(similarity("الحمد", "الحمدد")).toBeCloseTo(similarity("الحمدد", "الحمد"));
  });

  it("is 1 − distance / longest length", () => {
    expect(weightedDistance("قل", "قال")).toBe(1);
    expect(similarity("قل", "قال")).toBeCloseTo(1 - 1 / 3);
    expect(similarity("بلحيتي", "بنحيتي")).toBeCloseTo(1 - 1 / 6);
  });

  it("matches or skips optional letters at no cost", () => {
    // صِرَٰطَ → صر + optional alef + ط
    expect(weightedDistance(`صر${OPT_ALEF}ط`, "صراط")).toBe(0);
    expect(weightedDistance(`صر${OPT_ALEF}ط`, "صرط")).toBe(0);
    expect(weightedDistance(`صر${OPT_ALEF}ط`, "صاط")).toBe(1);
    expect(similarity(`الرحم${OPT_ALEF}ن`, "الرحمن")).toBe(1);
  });

  it("treats a word-final ه/ت swap (closed vs open ta) as a small difference", () => {
    expect(weightedDistance("رحمت", "رحمه")).toBe(FINAL_TA_COST);
    expect(weightedDistance("تبت", "هبت")).toBe(1); // only at the end of the word
  });

  it("handles empty keys", () => {
    expect(similarity("", "")).toBe(1);
    expect(similarity("", "قل")).toBe(0);
    expect(similarity(OPT_ALEF, "")).toBe(1);
  });
});

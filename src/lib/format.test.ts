import { afterEach, describe, expect, it } from "vitest";
import { ayahNumber, formatNumber, formatPercent, setDigits } from "./format";

afterEach(() => setDigits("western"));

describe("digits", () => {
  it("writes ayah and page numbers as 1 2 3 by default, in every language", () => {
    expect(ayahNumber(7)).toBe("7");
    expect(ayahNumber(255)).toBe("255");
    expect(formatNumber(604, "ar")).toBe("604");
    expect(formatNumber(604, "en")).toBe("604");
  });

  it("can write them as Arabic-Indic digits (the English interface keeps 1 2 3)", () => {
    setDigits("indic");
    expect(ayahNumber(255)).toBe("\u0662\u0665\u0665");
    expect(formatNumber(604, "ar")).toBe("\u0666\u0660\u0664");
    expect(formatPercent(0.97, "ar")).toContain("\u0669\u0667");
    expect(formatNumber(604, "en")).toBe("604");
  });
});

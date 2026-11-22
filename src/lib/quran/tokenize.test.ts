import { describe, expect, it } from "vitest";
import { ayahWords, tokenizeAyah } from "./tokenize";
import { allAyahs, surah } from "../../test/quran";

describe("tokenizeAyah", () => {
  it("never changes the text: tokens join back to the exact ayah, for all 6236 ayahs", () => {
    let n = 0;
    for (const { surah: s, ayah, text } of allAyahs()) {
      expect(tokenizeAyah(text).map((t) => t.text).join(""), `${s}:${ayah}`).toBe(text);
      n++;
    }
    expect(n).toBe(6236);
  });

  it("numbers words in order and leaves pause marks out of the word list", () => {
    const text = surah(2).ayahs[1]!; // ذَٰلِكَ ٱلْكِتَـٰبُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ
    const tokens = tokenizeAyah(text);
    expect(tokens.filter((t) => t.kind === "mark").map((t) => t.text)).toEqual(["ۛ", "ۛ"]);
    expect(ayahWords(text)).toHaveLength(7);
    expect(tokens.flatMap((t) => (t.kind === "word" ? [t.index] : []))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("treats the sajdah sign as a mark, not a word", () => {
    const text = surah(7).ayahs[205]!; // 7:206 ends with ۩
    expect(text.trim().endsWith("۩")).toBe(true);
    expect(ayahWords(text).some((w) => w.includes("۩"))).toBe(false);
  });

  it("counts the 29 words of Al-Fatiha", () => {
    expect(surah(1).ayahs.flatMap(ayahWords)).toHaveLength(29);
  });
});

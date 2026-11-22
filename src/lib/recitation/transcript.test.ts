import { describe, expect, it } from "vitest";
import { collapseLoops, joinSegments } from "./transcript";
import { evaluateRecitation, expectedWords } from "./evaluate";
import { normalizeWord } from "../arabic/normalize";
import { ayahWords } from "../quran/tokenize";
import { allAyahs, ayahs } from "../../test/quran";

describe("collapseLoops", () => {
  it("collapses a word repeated three or more times (a recognition loop) to one", () => {
    expect(collapseLoops("بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحْمَنِ الرَّحْمَنِ")).toBe("بِسْمِ اللَّهِ الرَّحْمَنِ");
    expect(collapseLoops("أَ ب ب ب ب ج")).toBe("أَ ب ج");
  });

  it("keeps words said twice, which the Quran itself has", () => {
    expect(collapseLoops("هَيْهَاتَ هَيْهَاتَ لِمَا تُوعَدُونَ")).toBe("هَيْهَاتَ هَيْهَاتَ لِمَا تُوعَدُونَ");
  });

  it("compares spellings, not diacritics", () => {
    expect(collapseLoops("الرحمن الرَّحْمَنِ الرَّحْمَٰنِ")).toBe("الرحمن");
  });

  it("works per segment when joining", () => {
    expect(joinSegments(["قُلْ هُوَ", "", "اللَّهُ اللَّهُ اللَّهُ أَحَدٌ"])).toBe("قُلْ هُوَ اللَّهُ أَحَدٌ");
  });

  it("is safe for the text: no ayah repeats a word three times in a row", () => {
    for (const { surah, ayah, text } of allAyahs()) {
      const keys = ayahWords(text).map(normalizeWord);
      for (let i = 2; i < keys.length; i++) {
        expect(keys[i] === keys[i - 1] && keys[i] === keys[i - 2], `${surah}:${ayah}`).toBe(false);
      }
    }
  });

  it("lets a skipped word be reported as missed despite a loop (real model output)", () => {
    // Husary's 1:1 with the last word cut out, as the model transcribed it.
    const transcript = joinSegments(["بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحْمَنِ الرَّحْمَنِ"]);
    const r = evaluateRecitation(expectedWords(ayahs(1, 1)), transcript, { threshold: 0.7 });
    expect(r.words.map((w) => w.status)).toEqual(["correct", "correct", "correct", "missed"]);
    expect(r.extras).toEqual([]);
  });
});

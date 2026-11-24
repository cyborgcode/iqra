import { describe, expect, it } from "vitest";
import { buildCorpus, type Corpus } from "../quran/corpus";
import { DEFAULT_SECONDS_PER_UNIT, MAX_AHEAD, Pace, ayahEnd, checkedMarks, units, wordUnits, wordsAhead } from "./optimistic";
import type { WordMark } from "./tracker";
import { surah } from "../../test/quran";
import { SURAHS } from "../../data/surahs";

const corpus: Corpus = await buildCorpus(SURAHS.map((s) => surah(s.number)));
const first = (ayah: number) => corpus.ayahStart[ayah]!;
const takes = (w: number, rate = DEFAULT_SECONDS_PER_UNIT) => rate * wordUnits(corpus, w);

describe("how long a word takes", () => {
  it("counts its letters, and more for a long madd, a small alef or a doubled letter", () => {
    expect(units("صِرَٰطَ")).toBe(4); // ص ر ط and the small alef
    expect(units("ٱلَّذِينَ")).toBe(5.5); // ٱ ل ذ ي ن and the shadda
    // ٱلضَّآلِّينَ (the last word of 1:7) holds its madd: longer than its letters.
    expect(units(corpus.words[first(7) - 1]!)).toBe(7 + 3 + 1);
    expect(units("\u0622\u0645\u0650\u064A\u0646")).toBe(4 + 3); // آمين with its alef written whole
    // A silent letter is not said: أُو۟لَـٰٓئِكَ
    expect(units("أُو۟لَـٰٓئِكَ")).toBe(5 - 1 + 1 + 3);
  });
});

describe("words ahead of the model", () => {
  // 1:7 starts at صِرَٰطَ, then ٱلَّذِينَ.
  const last = first(6) - 1;

  it("lights the word being said once enough of it has been spoken", () => {
    const w = first(6);
    expect(wordsAhead(corpus, last, 0, DEFAULT_SECONDS_PER_UNIT)).toEqual([]);
    expect(wordsAhead(corpus, last, 0.2 * takes(w), DEFAULT_SECONDS_PER_UNIT)).toEqual([]);
    expect(wordsAhead(corpus, last, 0.4 * takes(w), DEFAULT_SECONDS_PER_UNIT)).toEqual([w]);
    expect(wordsAhead(corpus, last, takes(w) + 0.4 * takes(w + 1), DEFAULT_SECONDS_PER_UNIT)).toEqual([w, w + 1]);
  });

  it("goes at most three words ahead, however long the voice goes on", () => {
    expect(wordsAhead(corpus, last, 60, DEFAULT_SECONDS_PER_UNIT)).toHaveLength(MAX_AHEAD);
  });

  it("stops where it is told: the end of the ayah", () => {
    // The last word of 1:7 held for a long time does not light 2:1.
    const end = ayahEnd(corpus, first(6));
    expect(end).toBe(first(7));
    expect(wordsAhead(corpus, end - 1, 60, DEFAULT_SECONDS_PER_UNIT, ayahEnd(corpus, end - 1))).toEqual([]);
    expect(wordsAhead(corpus, end - 2, 60, DEFAULT_SECONDS_PER_UNIT, ayahEnd(corpus, end - 2))).toEqual([end - 1]);
  });

  it("follows the reciter's pace", () => {
    const w = first(6);
    const speech = 0.4 * takes(w, 0.1);
    expect(wordsAhead(corpus, last, speech, 0.1)).toEqual([w]);
    expect(wordsAhead(corpus, last, speech, 0.3)).toEqual([]);
  });
});

describe("the reciter's pace", () => {
  const unitsOf = (start: number, end: number) => Array.from({ length: end - start }, (_, i) => wordUnits(corpus, start + i)).reduce((a, b) => a + b, 0);

  it("is the default until a word or two has been heard, then the speech per unit", () => {
    const pace = new Pace(corpus);
    expect(pace.secondsPerUnit).toBe(DEFAULT_SECONDS_PER_UNIT);
    // 1:2, ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ, said in 2 s of speech.
    const [start, end] = [first(1), first(2)];
    pace.add(2, start, end);
    expect(pace.secondsPerUnit).toBeCloseTo(2 / unitsOf(start, end), 5);
  });

  it("is known within the first phrase, from what the model has heard of it", () => {
    const pace = new Pace(corpus);
    // 1:2 heard up to رَبِّ after 1.2 s of speech: the last word counts half.
    const start = first(1);
    pace.observe(1.2, start, start + 2);
    expect(pace.secondsPerUnit).toBeCloseTo(1.2 / (unitsOf(start, start + 2) + wordUnits(corpus, start + 2) / 2), 5);
    // The finished phrase replaces it.
    pace.add(2, start, first(2));
    expect(pace.secondsPerUnit).toBeCloseTo(2 / unitsOf(start, first(2)), 5);
  });

  it("stays within reason", () => {
    const pace = new Pace(corpus);
    pace.add(120, first(1), first(2));
    expect(pace.secondsPerUnit).toBe(0.4);
  });
});

describe("words checked as the phrase goes", () => {
  const m = (status: WordMark["status"]): WordMark => ({ status, similarity: status === "correct" ? 1 : 0.2 });
  it("shows a correct word at once, a mistake once two transcripts agree", () => {
    const first = new Map([
      [1, m("correct")],
      [2, m("wrong")],
    ]);
    const once = checkedMarks(first, new Map(), new Map());
    expect([...once.keys()]).toEqual([1]);
    const second = new Map([
      [1, m("correct")],
      [2, m("wrong")],
      [3, m("missed")],
    ]);
    const twice = checkedMarks(second, first, once);
    expect([...twice].map(([w, k]) => [w, k.status])).toEqual([
      [1, "correct"],
      [2, "wrong"],
    ]);
  });

  it("keeps what was shown when one transcript hears a word differently, or not at all", () => {
    const shown = new Map([[1, m("correct")]]);
    const misheard = new Map([[1, m("wrong")]]);
    expect(checkedMarks(misheard, shown, shown).get(1)?.status).toBe("correct");
    expect(checkedMarks(new Map(), shown, shown).get(1)?.status).toBe("correct");
    // Two in a row that hear it wrong change it.
    expect(checkedMarks(misheard, misheard, shown).get(1)?.status).toBe("wrong");
  });
});

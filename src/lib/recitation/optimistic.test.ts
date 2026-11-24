import { describe, expect, it } from "vitest";
import { buildCorpus, type Corpus } from "../quran/corpus";
import { DEFAULT_SECONDS_PER_LETTER, MAX_AHEAD, Pace, ayahEnd, checkedMarks, wordsAhead } from "./optimistic";
import type { WordMark } from "./tracker";
import { surah } from "../../test/quran";
import { SURAHS } from "../../data/surahs";

const corpus: Corpus = await buildCorpus(SURAHS.map((s) => surah(s.number)));
const first = (ayah: number) => corpus.ayahStart[ayah]!;
const takes = (w: number, rate = DEFAULT_SECONDS_PER_LETTER) => rate * corpus.key(w).length;

describe("words ahead of the model", () => {
  // 1:7 starts at صِرَٰطَ (4 letters), then ٱلَّذِينَ.
  const last = first(6) - 1;

  it("lights the word being said once enough of it has been spoken", () => {
    const w = first(6);
    expect(wordsAhead(corpus, last, 0, DEFAULT_SECONDS_PER_LETTER)).toEqual([]);
    expect(wordsAhead(corpus, last, 0.3 * takes(w), DEFAULT_SECONDS_PER_LETTER)).toEqual([]);
    expect(wordsAhead(corpus, last, 0.5 * takes(w), DEFAULT_SECONDS_PER_LETTER)).toEqual([w]);
    expect(wordsAhead(corpus, last, takes(w) + 0.5 * takes(w + 1), DEFAULT_SECONDS_PER_LETTER)).toEqual([w, w + 1]);
  });

  it("goes at most two words ahead, however long the voice goes on", () => {
    expect(wordsAhead(corpus, last, 60, DEFAULT_SECONDS_PER_LETTER)).toHaveLength(MAX_AHEAD);
  });

  it("stops where it is told: the end of the ayah", () => {
    // The last word of 1:7 held for a long time does not light 2:1.
    const end = ayahEnd(corpus, first(6));
    expect(end).toBe(first(7));
    expect(wordsAhead(corpus, end - 1, 60, DEFAULT_SECONDS_PER_LETTER, ayahEnd(corpus, end - 1))).toEqual([]);
    expect(wordsAhead(corpus, end - 2, 60, DEFAULT_SECONDS_PER_LETTER, ayahEnd(corpus, end - 2))).toEqual([end - 1]);
  });

  it("follows the reciter's pace", () => {
    const w = first(6);
    const speech = 0.5 * takes(w, 0.1);
    expect(wordsAhead(corpus, last, speech, 0.1)).toEqual([w]);
    expect(wordsAhead(corpus, last, speech, 0.3)).toEqual([]);
  });
});

describe("the reciter's pace", () => {
  it("is the default until a phrase or two has been heard, then the speech per letter", () => {
    const pace = new Pace(corpus);
    expect(pace.secondsPerLetter).toBe(DEFAULT_SECONDS_PER_LETTER);
    // 1:2, ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ, said in 2 s of speech.
    const [start, end] = [first(1), first(2)];
    let letters = 0;
    for (let w = start; w < end; w++) letters += corpus.key(w).length;
    pace.add(2, start, end);
    expect(pace.secondsPerLetter).toBeCloseTo(2 / letters, 5);
  });

  it("stays within reason", () => {
    const pace = new Pace(corpus);
    pace.add(120, first(1), first(2));
    expect(pace.secondsPerLetter).toBe(0.5);
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

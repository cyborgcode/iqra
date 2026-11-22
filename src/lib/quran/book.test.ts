import { describe, expect, it } from "vitest";
import {
  AYAH_COUNT,
  HIZB_COUNT,
  JUZ_COUNT,
  PAGE_COUNT,
  QUARTER_COUNT,
  ayahIndex,
  ayahRef,
  juzOfAyah,
  juzStart,
  pageAyahs,
  pageOf,
  pageOfAyah,
  quarterOfAyah,
  quarterStart,
  sajdaOfAyah,
  surahsOnPage,
} from "./book";
import { buildCorpus } from "./corpus";
import { normalizeWord } from "../arabic/normalize";
import { ayahWords, tokenizeAyah } from "./tokenize";
import { surah } from "../../test/quran";
import { SURAHS } from "../../data/surahs";

describe("book divisions from Tanzil's metadata", () => {
  it("has 6236 ayahs, 604 pages, 30 juz and 60 hizb in 240 quarters", () => {
    expect(AYAH_COUNT).toBe(6236);
    expect(PAGE_COUNT).toBe(604);
    expect(JUZ_COUNT).toBe(30);
    expect(QUARTER_COUNT).toBe(240);
    expect(HIZB_COUNT).toBe(60);
  });

  it("numbers ayahs across the whole Quran and back", () => {
    expect(ayahIndex(1, 1)).toBe(0);
    expect(ayahIndex(2, 1)).toBe(7);
    expect(ayahIndex(114, 6)).toBe(6235);
    for (let i = 0; i < AYAH_COUNT; i++) {
      const { surah: s, ayah } = ayahRef(i);
      expect(ayahIndex(s, ayah)).toBe(i);
    }
  });

  it("puts well-known ayahs on their Madani Mushaf pages", () => {
    expect(pageOf(1, 7)).toBe(1);
    expect(pageOf(2, 1)).toBe(2);
    expect(pageOf(2, 255)).toBe(42);
    expect(pageOf(3, 1)).toBe(50);
    expect(pageOf(18, 1)).toBe(293);
    expect(pageOf(36, 1)).toBe(440);
    expect(pageOf(67, 1)).toBe(562);
    expect(pageOf(78, 1)).toBe(582);
    expect(pageOf(112, 1)).toBe(604);
    expect(pageOf(114, 6)).toBe(604);
    expect(surahsOnPage(604)).toEqual([112, 113, 114]);
    expect(surahsOnPage(1)).toEqual([1]);
  });

  it("splits the Quran into contiguous pages", () => {
    expect(pageAyahs(1)[0]).toBe(0);
    expect(pageAyahs(PAGE_COUNT)[1]).toBe(AYAH_COUNT);
    for (let p = 1; p < PAGE_COUNT; p++) {
      const [from, to] = pageAyahs(p);
      expect(to).toBeGreaterThan(from);
      expect(pageAyahs(p + 1)[0]).toBe(to);
      expect(pageOfAyah(from)).toBe(p);
      expect(pageOfAyah(to - 1)).toBe(p);
    }
  });

  it("knows where each juz and hizb quarter starts", () => {
    expect(juzStart(1)).toEqual({ surah: 1, ayah: 1 });
    expect(juzStart(2)).toEqual({ surah: 2, ayah: 142 });
    expect(juzStart(30)).toEqual({ surah: 78, ayah: 1 });
    expect(juzOfAyah(ayahIndex(2, 141))).toBe(1);
    expect(juzOfAyah(ayahIndex(2, 142))).toBe(2);
    expect(juzOfAyah(AYAH_COUNT - 1)).toBe(30);
    expect(quarterOfAyah(0)).toBe(1);
    expect(quarterStart(240)).toEqual({ surah: 100, ayah: 9 });
    // Every juz starts a hizb: two hizbs (eight quarters) per juz.
    for (let j = 1; j <= JUZ_COUNT; j++) expect(quarterStart((j - 1) * 8 + 1)).toEqual(juzStart(j));
  });

  it("lists the 15 ayahs of prostration", () => {
    const sajdas = Array.from({ length: AYAH_COUNT }, (_, i) => sajdaOfAyah(i)).filter(Boolean);
    expect(sajdas).toHaveLength(15);
    expect(sajdaOfAyah(ayahIndex(96, 19))).toBe("obligatory");
    expect(sajdaOfAyah(ayahIndex(7, 206))).toBe("recommended");
    // Tanzil's text carries the sajdah sign (۩) on exactly these ayahs.
    for (let i = 0; i < AYAH_COUNT; i++) {
      const { surah: s, ayah } = ayahRef(i);
      expect(surah(s).ayahs[ayah - 1]!.includes("\u06E9")).toBe(sajdaOfAyah(i) !== null);
    }
  });
});

describe("corpus", async () => {
  const corpus = await buildCorpus(SURAHS.map((s) => surah(s.number)));

  it("numbers all 77,433 words in reading order, verbatim", () => {
    expect(corpus.size).toBe(77433);
    expect(corpus.ayahStart[0]).toBe(0);
    expect(corpus.ayahStart[AYAH_COUNT]).toBe(corpus.size);
    for (let a = 0; a < AYAH_COUNT; a++) {
      const words = corpus.words.slice(corpus.ayahStart[a], corpus.ayahStart[a + 1]);
      expect(words).toEqual(ayahWords(corpus.ayahText[a]!));
      for (let w = 0; w < words.length; w++) expect(corpus.ayahOfWord[corpus.wordIndex(a, w)]).toBe(a);
    }
  });

  it("keeps the text exactly as published", () => {
    for (let a = 0; a < AYAH_COUNT; a++) {
      const { surah: s, ayah } = ayahRef(a);
      expect(corpus.ayahText[a]).toBe(surah(s).ayahs[ayah - 1]);
      expect(tokenizeAyah(corpus.ayahText[a]!).map((t) => t.text).join("")).toBe(corpus.ayahText[a]);
    }
    expect(corpus.bismillah[0]).toBeNull();
    expect(corpus.bismillah[8]).toBeNull();
    expect(corpus.bismillah[1]).toBe(surah(2).bismillah);
  });

  it("computes comparison keys in memory", () => {
    expect(corpus.key(0)).toBe(normalizeWord(corpus.words[0]!));
    expect(corpus.words[0]).toBe(surah(1).ayahs[0]!.split(" ")[0]);
  });
});

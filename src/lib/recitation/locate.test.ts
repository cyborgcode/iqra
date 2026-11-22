import { describe, expect, it } from "vitest";
import { SearchIndex, locate, skeleton } from "./locate";
import { collapseLoops } from "./transcript";
import { normalizeWord } from "../arabic/normalize";
import { buildCorpus } from "../quran/corpus";
import { ayahIndex, pageAyahs, pageOf } from "../quran/book";
import { fixture, surah } from "../../test/quran";
import { SURAHS } from "../../data/surahs";

const THRESHOLD = 0.7;
const corpus = await buildCorpus(SURAHS.map((s) => surah(s.number)));
const index = await SearchIndex.build(corpus);

const keysOf = (text: string) => collapseLoops(text).split(/\s+/).map(normalizeWord).filter(Boolean);
const ayahKeys = (a: number) => {
  const out: string[] = [];
  for (let w = corpus.ayahStart[a]!; w < corpus.ayahStart[a + 1]!; w++) out.push(skeleton(corpus.key(w)));
  return out.join(" ");
};
const pageWords = (page: number): [number, number] => {
  const [from, to] = pageAyahs(page);
  return [corpus.ayahStart[from]!, corpus.ayahStart[to]!];
};

/** The ayah where a placement starts, or an ayah with the same words (refrains like 55:13 recur). */
function sameAyah(start: number, surahNo: number, ayah: number): boolean {
  const found = corpus.ayahOfWord[start]!;
  const want = ayahIndex(surahNo, ayah);
  return found === want || ayahKeys(found) === ayahKeys(want);
}

describe("locate: finding a recitation anywhere in the Quran", () => {
  it("finds well-known ayahs from real transcripts with no hint", () => {
    const ikhlas = locate(index, keysOf("قُلْ هُوَ اللَّهُ أَحَدٌ"), { threshold: THRESHOLD })[0]!;
    expect(corpus.ayahOfWord[ikhlas.start]).toBe(ayahIndex(112, 1));
    expect(ikhlas.end - ikhlas.start).toBe(4);
    const kursi = locate(index, keysOf("اللَّهُ لَا إِلَهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ"), { threshold: THRESHOLD })[0]!;
    expect(corpus.ayahOfWord[kursi.start]).toBe(ayahIndex(2, 255));
    const mulk = locate(index, keysOf("تَبَارَكَ الَّذِي بِيَدِهِ الْمُلْكُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ"), { threshold: THRESHOLD })[0]!;
    expect(corpus.ayahOfWord[mulk.start]).toBe(ayahIndex(67, 1));
  });

  it("places 581 real one-ayah transcripts (Juz Amma, Al-Baqarah 1–30) without a hint", () => {
    const recitations = fixture("clean-recitations");
    const wrong: string[] = [];
    for (const r of recitations) {
      const best = locate(index, keysOf(r.transcript), { threshold: THRESHOLD })[0];
      if (!best || !sameAyah(best.start, r.surah, r.ayah)) wrong.push(`${r.surah}:${r.ayah}`);
    }
    // Without the page, an ayah whose words recur elsewhere (77:15 = 83:10) is placed at one of the
    // identical ayahs; every other transcript is placed at its own ayah.
    expect(wrong).toEqual([]);
    expect(recitations.length).toBe(581);
  });

  it("places every one of them when the reader is on the ayah's page", () => {
    const wrong: string[] = [];
    for (const r of fixture("clean-recitations")) {
      const best = locate(index, keysOf(r.transcript), { threshold: THRESHOLD, hint: pageWords(pageOf(r.surah, r.ayah)) })[0];
      if (!best || !sameAyah(best.start, r.surah, r.ayah)) wrong.push(`${r.surah}:${r.ayah}`);
    }
    expect(wrong).toEqual([]);
  });

  it("places long ayahs recited with repeated phrases", () => {
    for (const r of fixture("long-recitations")) {
      const best = locate(index, keysOf(r.transcript), { threshold: THRESHOLD })[0]!;
      expect(corpus.ayahOfWord[best.start], `${r.surah}:${r.ayah}`).toBe(ayahIndex(r.surah, r.ayah));
    }
  });

  it("prefers the reader's page when the same words occur in several places", () => {
    // فَبِأَيِّ آلَاءِ رَبِّكُمَا تُكَذِّبَانِ is said 31 times in Ar-Rahman.
    const refrain = keysOf("فَبِأَيِّ آلَاءِ رَبِّكُمَا تُكَذِّبَانِ");
    const first = locate(index, refrain, { threshold: THRESHOLD })[0]!;
    expect(corpus.ayahOfWord[first.start]).toBe(ayahIndex(55, 13));
    const page = pageOf(55, 47);
    const onPage = locate(index, refrain, { threshold: THRESHOLD, hint: pageWords(page) })[0]!;
    expect(pageOf(55, corpus.ayahOfWord[onPage.start]! - ayahIndex(55, 1) + 1)).toBe(page);
  });

  it("treats a basmala on its own as the opening of the surah on the reader's page", () => {
    const basmala = keysOf("بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ");
    const onMulk = locate(index, basmala, { threshold: THRESHOLD, hint: pageWords(562) })[0]!;
    expect(onMulk).toMatchObject({ matched: 0, optional: 4, start: corpus.ayahStart[ayahIndex(67, 1)] });
    const onFatiha = locate(index, basmala, { threshold: THRESHOLD, hint: pageWords(1) })[0]!;
    expect(onFatiha).toMatchObject({ matched: 4, start: 0, end: 4 });
  });

  it("finds nothing for speech that is not in the Quran", () => {
    const found = locate(index, keysOf("السلام عليكم ورحمة الله وبركاته كيف حالك اليوم"), { threshold: THRESHOLD })[0];
    expect(found === undefined || found.matched < 4).toBe(true);
  });
});

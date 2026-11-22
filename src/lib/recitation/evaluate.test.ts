import { describe, expect, it } from "vitest";
import { evaluateRecitation, expectedWords, type Evaluation } from "./evaluate";
import { optionalPhrasesFor } from "./phrases";
import { ayahs, fixture, nfc } from "../../test/quran";

const THRESHOLD = 0.7;

/** Al-Fatiha as the model transcribed Husary's recitation (real output, standard spelling). */
const FATIHA = [
  "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ",
  "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ",
  "الرَّحْمَنِ الرَّحِيمِ",
  "مَالِكِ يَوْمِ الدِّينِ",
  "إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ",
  "اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ",
  "صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ",
].join(" ");

/** Al-Ikhlas, real model output. */
const IKHLAS = "قُلْ هُوَ اللَّهُ أَحَدٌ اللَّهُ الصَّمَدُ لَمْ يَلِدْ وَلَمْ يُولَدْ وَلَمْ يَكُنْ لَهُ كُفُوًا أَحَدٌ";

function run(surah: number, from: number, to: number, transcript: string, threshold = THRESHOLD): Evaluation {
  return evaluateRecitation(expectedWords(ayahs(surah, from, to)), transcript, {
    threshold,
    ...optionalPhrasesFor(surah, from),
  });
}

const notCorrect = (r: Evaluation) => r.words.filter((w) => w.status !== "correct").map((w) => `${w.ayah}:${w.word} ${w.status}`);

describe("evaluateRecitation on real ayahs", () => {
  it("a perfect recitation: every word correct, nothing extra", () => {
    const r = run(1, 1, 7, FATIHA);
    expect(r.words).toHaveLength(29);
    expect(notCorrect(r)).toEqual([]);
    expect(r.extras).toEqual([]);
    expect(r.accuracy).toBe(1);
  });

  it("one skipped word is marked missed, by its position in the Uthmani text", () => {
    const r = run(1, 1, 7, FATIHA.replace("يَوْمِ ", ""));
    expect(notCorrect(r)).toEqual(["4:1 missed"]);
    expect(r.words[11]).toMatchObject({ ayah: 4, word: 1, status: "missed" });
    expect(nfc(r.words[11]!.text)).toBe(nfc("يَوْمِ"));
    expect(r.extras).toEqual([]);
    expect(r.counts).toMatchObject({ correct: 28, missed: 1, wrong: 0, extra: 0 });
    expect(r.accuracy).toBeCloseTo(28 / 29);
  });

  it("one wrong word is marked wrong, with what was heard", () => {
    const r = run(1, 1, 7, FATIHA.replace("الرَّحْمَنِ الرَّحِيمِ مَالِكِ", "الرَّحْمَنِ الْكَرِيمِ مَالِكِ"));
    expect(notCorrect(r)).toEqual(["3:1 wrong"]);
    const w = r.words.find((x) => x.ayah === 3 && x.word === 1)!;
    expect(nfc(w.text)).toBe(nfc("ٱلرَّحِيمِ"));
    expect(nfc(w.heard!)).toBe(nfc("الْكَرِيمِ"));
    expect(r.extras).toEqual([]);
  });

  it("one extra word is flagged where it was said, and nothing else changes", () => {
    const r = run(1, 1, 7, FATIHA.replace("الْمُسْتَقِيمَ", "الْمُسْتَقِيمَ الْعَظِيمِ"));
    expect(notCorrect(r)).toEqual([]);
    expect(r.extras.map((e) => ({ ...e, text: nfc(e.text) }))).toEqual([{ after: 19, text: nfc("الْعَظِيمِ"), repeated: false }]);
    expect(nfc(r.words[19]!.text)).toBe(nfc("ٱلْمُسْتَقِيمَ"));
  });

  it("a repeated phrase: all words correct, the repetition is reported as repeated extras", () => {
    const r = run(112, 1, 4, IKHLAS.replace("اللَّهُ الصَّمَدُ", "اللَّهُ الصَّمَدُ اللَّهُ الصَّمَدُ"));
    expect(notCorrect(r)).toEqual([]);
    expect(r.extras).toHaveLength(2);
    expect(r.extras.every((e) => e.repeated)).toBe(true);
    expect(r.accuracy).toBe(1);
  });

  it("a real repetition by the reciter (Alafasy, 78:40) is found the same way", () => {
    const rec = fixture("long-recitations").find((f) => f.surah === 78 && f.ayah === 40)!;
    const r = run(78, 40, 40, rec.transcript);
    expect(notCorrect(r)).toEqual([]);
    // The first time through is reported as the repetition; the second is matched to the text.
    expect(nfc(r.extras.map((e) => e.text).join(" "))).toBe(nfc("يَوْمَ يَنْظُرُ الْمَرْءُ مَا قَدَّمَتْ يَدَاهُ"));
    expect(r.extras.every((e) => e.repeated && e.after === 3)).toBe(true);
  });

  it("a restart to correct oneself counts the corrected attempt", () => {
    // "…رَبِّ النَّاسِ" said by mistake, then "رَبِّ الْعَالَمِينَ" again
    const r = run(1, 1, 7, FATIHA.replace("رَبِّ الْعَالَمِينَ", "رَبِّ النَّاسِ رَبِّ الْعَالَمِينَ"));
    expect(notCorrect(r)).toEqual([]);
    expect(r.extras.map((e) => [nfc(e.text), e.repeated])).toEqual([
      [nfc("رَبِّ"), true],
      [nfc("النَّاسِ"), false],
    ]);
  });
});

describe("evaluateRecitation: spelling and word boundaries", () => {
  it("matches a word the model splits in two (يَا أَيُّهَا ~ يَـٰٓأَيُّهَا)", () => {
    const rec = fixture("clean-recitations").find((f) => f.surah === 2 && f.ayah === 21)!;
    const r = run(2, 21, 21, rec.transcript);
    expect(notCorrect(r)).toEqual([]);
    expect(r.extras).toEqual([]);
    expect(r.words[0]!.status).toBe("correct");
    expect(nfc(r.words[0]!.text)).toBe(nfc("يَـٰٓأَيُّهَا"));
    expect(nfc(r.words[0]!.heard!)).toBe(nfc("يَا أَيُّهَا"));
  });

  it("matches a word the model splits in three (يَا ابْنَ أُمَّ ~ يَبْنَؤُمَّ, 20:94)", () => {
    const transcript =
      "قَالَ يَا ابْنَ أُمَّ لَا تَأْخُذْ بِلِحْيَتِي وَلَا بِرَأْسِي إِنِّي خَشِيتُ أَنْ تَقُولَ فَرَّقْتَ بَيْنَ بَنِي إِسْرَائِيلَ وَلَمْ تَرْقُبْ قَوْلِي";
    const r = run(20, 94, 94, transcript);
    expect(notCorrect(r)).toEqual([]);
    expect(r.extras).toEqual([]);
  });

  it("ignores pause marks, which are not words", () => {
    const r = run(2, 2, 2, "ذَلِكَ الْكِتَابُ لَا رَيْبَ فِيهِ هُدًى لِلْمُتَّقِينَ");
    expect(r.words.map((w) => w.text)).not.toContain("ۛ");
    expect(r.counts.correct).toBe(7);
  });

  it("matches the disjointed letters (الٓمٓ ~ الم)", () => {
    expect(notCorrect(run(2, 1, 1, "الم"))).toEqual([]);
  });

  it("uses the tunable threshold: small recognition noise passes by default, not when strict", () => {
    // The model heard بِنِحْيَتِي for بِلِحْيَتِى (one letter off).
    const transcript =
      "قَالَ يَبْنَ أُمَّ لَا تَأْخُذْ بِنِحْيَتِي وَلَا بِرَأْسِي إِنِّي خَشِيتُ أَنْ تَقُولَ فَرَّقْتَ بَيْنَ بَنِي إِسْرَائِيلَ وَلَمْ تَرْقُبْ قَوْلِي";
    expect(notCorrect(run(20, 94, 94, transcript, 0.7))).toEqual([]);
    expect(notCorrect(run(20, 94, 94, transcript, 0.9))).toEqual(["94:4 wrong"]);
  });
});

describe("evaluateRecitation: optional phrases", () => {
  it("does not count the isti'adha or basmala as extra words", () => {
    const r = run(112, 1, 4, `أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ ${IKHLAS}`);
    expect(r.extras).toEqual([]);
    expect(notCorrect(r)).toEqual([]);
    expect(r.recitedOptional.sort()).toEqual(["basmala", "istiadha"]);
  });

  it("does not count them as missed when they are not said", () => {
    const r = run(112, 1, 4, IKHLAS);
    expect(r.counts).toMatchObject({ missed: 0, extra: 0 });
    expect(r.recitedOptional).toEqual([]);
  });

  it("requires the basmala in Al-Fatiha, where it is ayah 1", () => {
    const r = run(1, 1, 7, FATIHA.split(" ").slice(4).join(" "));
    expect(notCorrect(r)).toEqual(["1:0 missed", "1:1 missed", "1:2 missed", "1:3 missed"]);
  });

  it("accepts a closing صدق الله العظيم", () => {
    const r = run(112, 1, 4, `${IKHLAS} صَدَقَ اللَّهُ الْعَظِيمُ`);
    expect(r.extras).toEqual([]);
  });
});

describe("evaluateRecitation on 581 real clean recitations", () => {
  it("marks at least 99% of words correct, with no false missed or extra words", () => {
    let words = 0;
    const totals = { correct: 0, wrong: 0, missed: 0, extra: 0 };
    for (const rec of fixture("clean-recitations")) {
      const r = run(rec.surah, rec.ayah, rec.ayah, rec.transcript);
      words += r.words.length;
      for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r.counts[k];
    }
    expect(words).toBe(2464);
    expect(totals.missed).toBe(0);
    expect(totals.extra).toBe(0);
    expect(totals.correct / words).toBeGreaterThanOrEqual(0.99);
  });

  it("handles long ayahs (30–260 s) recited in full", () => {
    let words = 0;
    let correct = 0;
    let missed = 0;
    for (const rec of fixture("long-recitations")) {
      const r = run(rec.surah, rec.ayah, rec.ayah, rec.transcript);
      words += r.words.length;
      correct += r.counts.correct;
      missed += r.counts.missed;
    }
    expect(missed).toBe(0);
    expect(correct / words).toBeGreaterThanOrEqual(0.97);
  });
});

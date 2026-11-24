import { describe, expect, it } from "vitest";
import { Tracker, type BookMarks } from "./tracker";
import { SearchIndex } from "./locate";
import { buildCorpus } from "../quran/corpus";
import { ayahIndex, pageAyahs, pageOf } from "../quran/book";
import { fixture, surah } from "../../test/quran";
import { SURAHS } from "../../data/surahs";

const THRESHOLD = 0.7;
const corpus = await buildCorpus(SURAHS.map((s) => surah(s.number)));
const index = await SearchIndex.build(corpus);

/** Real model output for Alafasy reciting each ayah of Juz Amma. */
const alafasy = new Map(fixture("clean-recitations").filter((r) => r.reciter === "Alafasy").map((r) => [`${r.surah}:${r.ayah}`, r.transcript]));
const say = (s: number, a: number) => {
  const text = alafasy.get(`${s}:${a}`);
  if (!text) throw new Error(`no fixture for ${s}:${a}`);
  return text;
};

/** Al-Fatiha as the model transcribed Husary's recitation, one ayah per segment. */
const FATIHA = [
  "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ",
  "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ",
  "الرَّحْمَنِ الرَّحِيمِ",
  "مَالِكِ يَوْمِ الدِّينِ",
  "إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ",
  "اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ",
  "صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ",
];

const page = (p: number): [number, number] => {
  const [from, to] = pageAyahs(p);
  return [corpus.ayahStart[from]!, corpus.ayahStart[to]!];
};
const words = (s: number, a: number) => {
  const i = ayahIndex(s, a);
  return Array.from({ length: corpus.ayahStart[i + 1]! - corpus.ayahStart[i]! }, (_, k) => corpus.ayahStart[i]! + k);
};
const firstWord = (s: number, a: number) => words(s, a)[0]!;

function tracker(): Tracker {
  const marks: BookMarks = { words: new Map(), extras: new Map() };
  return new Tracker(index, marks, THRESHOLD);
}
const statuses = (t: Tracker, s: number, a: number) => words(s, a).map((w) => t.marks.words.get(w)?.status ?? "-");
const notCorrect = (t: Tracker) =>
  [...t.marks.words].filter(([, m]) => m.status !== "correct").map(([w, m]) => {
    const ayah = corpus.ayahOfWord[w]!;
    return `${ayah}/${w - corpus.ayahStart[ayah]!} ${m.status}`;
  });

describe("Tracker: following a recitation through the book", () => {
  it("follows An-Naba ayah by ayah from the open page", () => {
    const t = tracker();
    const events = Array.from({ length: 16 }, (_, i) => t.commit(say(78, i + 1), page(582)).kind);
    t.finish();
    expect(events[0]).toBe("located");
    expect(events.slice(1).every((k) => k === "followed")).toBe(true);
    for (let a = 1; a <= 16; a++) expect(statuses(t, 78, a).includes("-"), `78:${a}`).toBe(false);
    expect(notCorrect(t).filter((s) => s.endsWith("missed"))).toEqual([]);
    expect(t.marks.extras.size).toBe(0);
    expect(t.cursor).toBe(firstWord(78, 17));
    // The model misheard a few words (e.g. يَتَسَاءَمُونَ for يَتَسَآءَلُونَ); everything else is correct.
    expect(t.sessionWords.size).toBe(firstWord(78, 17) - firstWord(78, 1));
    expect(notCorrect(t).length).toBeLessThanOrEqual(3);
  });

  it("finds the reciter anywhere: Al-Ikhlas recited while Al-Fatiha is open", () => {
    const t = tracker();
    const events = [1, 2, 3, 4].map((a) => t.commit(say(112, a), page(1)));
    expect(events[0]).toMatchObject({ kind: "located", start: firstWord(112, 1) });
    expect(events.slice(1).map((e) => e.kind)).toEqual(["followed", "followed", "followed"]);
    expect(notCorrect(t)).toEqual([]);
    expect([...t.marks.words.keys()].every((w) => w >= firstWord(112, 1) && w < firstWord(113, 1))).toBe(true);
    expect(pageOf(112, 1)).toBe(604);
  });

  it("marks a skipped ayah as missed", () => {
    const t = tracker();
    for (const a of [1, 2, 3, 4, 5, 7, 8]) t.commit(say(78, a), page(582));
    expect(statuses(t, 78, 6)).toEqual(["missed", "missed", "missed", "missed"]);
    expect(statuses(t, 78, 7)).toEqual(["correct", "correct"]);
  });

  it("marks a word skipped inside an ayah as missed", () => {
    const t = tracker();
    t.commit(say(78, 1), page(582));
    t.commit("عَنِ الْعَظِيمِ", page(582)); // 78:2 without ٱلنَّبَإِ
    t.commit(say(78, 3), page(582));
    expect(statuses(t, 78, 2)).toEqual(["correct", "missed", "correct"]);
  });

  it("marks a word skipped at the end of an ayah as missed once the next ayah starts", () => {
    const t = FATIHA.slice(0, 2).reduce((tr, s) => (tr.commit(s, page(1)), tr), tracker());
    t.commit("الرَّحْمَنِ", page(1)); // 1:3 without ٱلرَّحِيمِ
    for (const s of FATIHA.slice(3)) t.commit(s, page(1));
    t.finish();
    expect(statuses(t, 1, 3)).toEqual(["correct", "missed"]);
    expect(notCorrect(t)).toEqual([`2/1 missed`]);
  });

  it("recognizes Al-Fatiha's basmala as its first ayah", () => {
    const t = tracker();
    const first = t.commit(FATIHA[0]!, page(1));
    expect(first).toMatchObject({ kind: "located", start: 0, end: 4 });
    for (const s of FATIHA.slice(1)) t.commit(s, page(1));
    t.finish();
    expect(t.sessionWords.size).toBe(29);
    expect(notCorrect(t)).toEqual([]);
  });

  it("lets the reciter repeat an ayah or part of one: the latest attempt counts, nothing is missed", () => {
    const t = tracker();
    t.commit(say(78, 1), page(582));
    t.commit(say(78, 2), page(582));
    expect(t.commit(say(78, 2), page(582)).kind).toBe("repeated");
    t.commit(say(78, 3), page(582));
    t.commit("أَلَمْ نَجْعَلِ", page(582)); // the start of 78:6… then 78:6 in full
    expect(t.commit(say(78, 6), page(582)).kind).toBe("repeated");
    expect(statuses(t, 78, 4)).toEqual(["missed", "missed"]);
    expect(statuses(t, 78, 5)).toEqual(["missed", "missed", "missed"]);
    expect(t.marks.extras.size).toBe(0);

    const u = tracker();
    for (const a of [1, 2, 3]) u.commit(say(78, a), page(582));
    u.commit("الَّذِي هُمْ", page(582)); // half of 78:3 again
    u.commit(say(78, 4), page(582));
    expect(statuses(u, 78, 3)).toEqual(["correct", "correct", "correct", "correct"]);
    expect(notCorrect(u)).toEqual([]);
  });

  it("follows a jump to another surah without marking what was skipped", () => {
    const t = tracker();
    for (const a of [1, 2, 3]) t.commit(say(78, a), page(582));
    const jump = t.commit(say(112, 1), page(582));
    expect(jump).toMatchObject({ kind: "jumped", start: firstWord(112, 1) });
    t.commit(say(112, 2), page(582));
    expect(statuses(t, 78, 4)).toEqual(["-", "-"]);
    expect(statuses(t, 112, 2)).toEqual(["correct", "correct"]);
  });

  it("goes on into the next surah, with or without the basmala between them", () => {
    const t = tracker();
    for (const a of [1, 2, 3, 4, 5]) t.commit(say(111, a), page(603));
    expect(t.commit("بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ", page(603))).toEqual({ kind: "phrase", phrases: ["basmala"] });
    for (const a of [1, 2, 3, 4]) expect(t.commit(say(112, a), page(604)).kind).toBe("followed");
    for (const a of [1, 2, 3, 4, 5]) t.commit(say(113, a), page(604));
    expect(notCorrect(t)).toEqual([]);
    expect(t.phrases.has("basmala")).toBe(true);
  });

  it("accepts the isti'adha and basmala before the first ayah", () => {
    const t = tracker();
    expect(t.commit("أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ", page(582)).kind).toBe("phrase");
    expect(t.commit("بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ", page(582)).kind).toBe("phrase");
    expect(t.commit(say(78, 1), page(582))).toMatchObject({ kind: "located", start: firstWord(78, 1) });
    expect([...t.phrases]).toEqual(["istiadha", "basmala"]);
    expect(t.marks.extras.size).toBe(0);
  });

  it("waits for a second ayah when the first occurs in several places", () => {
    const t = tracker();
    // وَيْلٌ يَوْمَئِذٍ لِّلْمُكَذِّبِينَ is ayah 83:10 and ten ayahs of Al-Mursalat.
    expect(t.commit(say(83, 10), page(1)).kind).toBe("waiting");
    expect(t.commit(say(83, 11), page(1))).toMatchObject({ kind: "located", start: firstWord(83, 10) });
    expect(statuses(t, 83, 10)).toEqual(["correct", "correct", "correct"]);
    expect(statuses(t, 77, 15)).toEqual(["-", "-", "-"]);
  });

  it("ignores speech that is not in the Quran", () => {
    const t = tracker();
    t.commit(say(78, 1), page(582));
    expect(t.commit("السلام عليكم ورحمة الله وبركاته كيف حالكم جميعا", page(582)).kind).toBe("unrecognized");
    expect(t.commit(say(78, 2), page(582)).kind).toBe("followed");
    expect(notCorrect(t).filter((s) => s.endsWith("missed"))).toEqual([]);
  });

  it("marks the last words missed when the reciter stops just before the end of an ayah", () => {
    const t = tracker();
    t.commit(say(78, 1), page(582));
    t.commit("عَنِ النَّبَإِ", page(582)); // 78:2 without its last word
    t.finish();
    expect(statuses(t, 78, 2)).toEqual(["correct", "correct", "missed"]);
  });

  it("previews the ayah being recited without changing anything", () => {
    const t = tracker();
    t.commit(say(78, 1), page(582));
    const before = t.marks.words.size;
    const live = t.preview("عَنِ النَّبَإِ", page(582));
    expect(live?.heard).toEqual(words(78, 2).slice(0, 2));
    expect(t.marks.words.size).toBe(before);
    expect(t.cursor).toBe(firstWord(78, 2));
    // Before the reciter is located, a preview already shows where they are.
    const u = tracker();
    expect(u.preview(say(112, 1), page(1))?.start).toBe(firstWord(112, 1));
  });

  it("keeps a preview with the reciter when a word cut off mid-way fits only further on", () => {
    const t = tracker();
    for (const ayah of FATIHA.slice(0, 6)) t.commit(ayah, page(1));
    // The first 0.9 s of 1:7, as the model heard it: «لَا» fits 2:2 alone, on the next page.
    expect(t.preview("صِرَاطًا لَا", page(1))).toBeNull();
    expect(t.preview("صِرَاطَ الَّذِينَ", page(1))?.heard).toEqual(words(1, 7).slice(0, 2));
    // A reciter who skipped ahead shows there once three words fit.
    expect(t.preview("ذَلِكَ الْكِتَابُ لَا رَيْبَ", page(1))?.heard).toEqual(words(2, 2).slice(0, 4));
  });

  it("starts where asked ('recite from here')", () => {
    const t = tracker();
    t.startAt(firstWord(78, 5));
    expect(t.commit(say(78, 5), page(582)).kind).toBe("followed");
    expect(statuses(t, 78, 4)).toEqual(["-", "-"]);
  });

  it("reports words heard differently and extra words", () => {
    const t = tracker();
    t.commit(say(112, 1), page(604));
    t.commit("اللَّهُ الْكَرِيمُ", page(604)); // 112:2 is ٱللَّهُ ٱلصَّمَدُ
    t.commit("لَمْ يَلِدْ وَلَمْ وَلَمْ يُولَدْ", page(604));
    expect(statuses(t, 112, 2)).toEqual(["correct", "wrong"]);
    expect(t.marks.words.get(words(112, 2)[1]!)?.heard).toBe("الْكَرِيمُ");
    expect(statuses(t, 112, 3)).toEqual(["correct", "correct", "correct", "correct"]);
    const extras = [...t.marks.extras.values()].flat();
    expect(extras).toEqual([{ text: "وَلَمْ", repeated: true }]);
  });

  it("follows whole surahs and long passages of real transcripts without a false 'missed'", () => {
    const all = [...fixture("clean-recitations"), ...fixture("long-recitations")];
    const passages = [
      ["Alafasy", 78, 40],
      ["Alafasy", 80, 42],
      ["Alafasy", 89, 30],
      ["Alafasy", 100, 11],
      ["Alafasy", 112, 4],
      ["Husary", 2, 12],
    ] as const;
    for (const [reciter, s, last] of passages) {
      const text = new Map(all.filter((r) => r.reciter === reciter && r.surah === s).map((r) => [r.ayah, r.transcript]));
      const t = tracker();
      let open = pageOf(s, 1);
      const kinds: string[] = [];
      for (let a = 1; a <= last; a++) {
        const e = t.commit(text.get(a)!, page(open));
        kinds.push(e.kind);
        if ("end" in e) open = pageOf(s, corpus.ayahOfWord[e.end - 1]! - ayahIndex(s, 1) + 1);
      }
      t.finish();
      const expected = corpus.ayahStart[ayahIndex(s, last) + 1]! - firstWord(s, 1);
      const marks = [...t.marks.words.values()];
      expect(kinds[0], `${s}`).toBe("located");
      expect(kinds.slice(1).every((k) => k === "followed"), `${s}: ${kinds.join(",")}`).toBe(true);
      expect(marks.length, `${s}`).toBe(expected);
      expect(marks.filter((m) => m.status === "missed"), `${s}`).toEqual([]);
      expect(marks.filter((m) => m.status === "correct").length / expected, `${s}`).toBeGreaterThan(0.97);
    }
  });
});

import { describe, expect, it } from "vitest";
import { normalizeWord, requiredLetters, OPT_ALEF } from "./normalize";
import { similarity } from "./similarity";
import { ayahWords } from "../quran/tokenize";
import { allAyahs } from "../../test/quran";

const key = (w: string) => requiredLetters(normalizeWord(w));

describe("normalizeWord: the rules from the brief", () => {
  it("strips harakat, shadda, sukun and tanween", () => {
    expect(key("بِسْمِ")).toBe("بسم");
    expect(key("رَبِّ")).toBe("رب");
    expect(key("عَذَابًا")).toBe("عذابا");
  });

  it("strips Quranic annotation marks (U+0610–U+061A, U+064B–U+065F, U+0670, U+06D6–U+06ED)", () => {
    expect(key("ٱلْكِتَـٰبُ")).toBe("الكتب"); // U+0670 superscript alef (kept only as an optional letter)
    expect(normalizeWord("ٱلْكِتَـٰبُ")).toBe(`الكت${OPT_ALEF}ب`);
    expect(key("لِّلْمُتَّقِينَ")).toBe("للمتقين");
    expect(key("مِّنۢ")).toBe("من"); // U+06E2 small high meem
    expect(key("ٱلْمُلْكُ\u0610")).toBe("الملك"); // U+0610 sallallahou sign
    expect(normalizeWord("ۖ")).toBe(""); // a pause mark on its own has no letters
  });

  it("removes tatweel", () => {
    expect(key("مَـٰلِكِ")).toBe("ملك");
    expect(key("ٱلرَّحْمَـٰنِ")).toBe("الرحمن");
  });

  it("unifies alef forms (أ إ آ ٱ → ا)", () => {
    expect(key("أَنْعَمْتَ")).toBe("انعمت");
    expect(key("إِيَّاكَ")).toBe("اياك");
    expect(key("آمَنُوا")).toBe("امنوا");
    expect(key("ٱهْدِنَا")).toBe("اهدنا");
    expect(key("بِٱسْمِ")).toBe("باسم");
  });

  it("maps ى → ي and ة → ه", () => {
    expect(key("عَلَى")).toBe("علي");
    expect(key("ٱلصَّلَوٰةَ")).toBe("الصلاه");
    expect(key("رَحْمَةً")).toBe("رحمه");
  });

  it("handles hamza variants: a leading hamza/alef cluster is one alef; inner hamzas are dropped", () => {
    expect(key("ءَأَنتُمْ")).toBe("انتم");
    expect(key("أَأَنْتُمْ")).toBe("انتم");
    expect(key("يُؤْمِنُونَ")).toBe("يمنون");
    expect(key("ٱلسَّمَآءِ")).toBe("السما");
    expect(key("شَيْءٍ")).toBe("شي");
    expect(key("ٱلْمَلَـٰٓئِكَةِ")).toBe("الملكه");
  });

  it("drops anything that is not an Arabic letter (punctuation, digits, Latin)", () => {
    expect(key("ٱلْحَمْدُ،")).toBe("الحمد");
    expect(key("١٢٣")).toBe("");
    expect(key("abc")).toBe("");
  });
});

describe("normalizeWord: Uthmani spellings match the model's standard spellings", () => {
  // [Tanzil Uthmani, model output] pairs taken from real transcripts.
  const pairs: [string, string][] = [
    ["ٱلْعَـٰلَمِينَ", "الْعَالَمِينَ"],
    ["ٱلرَّحْمَـٰنِ", "الرَّحْمَنِ"],
    ["مَـٰلِكِ", "مَالِكِ"],
    ["ٱلصِّرَٰطَ", "الصِّرَاطَ"],
    ["ٱلضَّآلِّينَ", "الضَّالِّينَ"],
    ["ذَٰلِكَ", "ذَلِكَ"],
    ["هَـٰذَا", "هَذَا"],
    ["ٱلصَّلَوٰةَ", "الصَّلَاةَ"],
    ["ٱلتَّوْرَىٰةَ", "التَّوْرَاةَ"],
    ["إِبْرَٰهِـۧمَ", "إِبْرَاهِيمَ"],
    ["إِسْرَٰٓءِيلَ", "إِسْرَائِيلَ"],
    ["ءَامَنُوا۟", "آمَنُوا"],
    ["ٱلْقُرْءَانُ", "الْقُرْآنُ"],
    ["ٱلْـَٔاخِرَةِ", "الْآخِرَةِ"],
    ["بَرَآءَةٌ", "بَرَاءَةٌ"],
    ["أَءِذَا", "أَإِذَا"],
    ["ءَأَنذَرْتَهُمْ", "أَأَنْذَرْتَهُمْ"],
    ["أَرَءَيْتَ", "أَرَأَيْتَ"],
    ["يَسْـَٔلُونَكَ", "يَسْأَلُونَكَ"],
    ["لَتُسْـَٔلُنَّ", "لَتُسْأَلُنَّ"],
    ["ٱلْمَشْـَٔمَةِ", "الْمَشْأَمَةِ"],
    ["شَيْـًٔا", "شَيْئًا"],
    ["يَـُٔودُهُۥ", "يَئُودُهُ"],
    ["إِنَّهُۥ", "إِنَّهُ"],
    ["دَاوُۥدَ", "دَاوُودَ"],
    ["يَتْلُوا۟", "يَتْلُو"],
    ["ٱعْبُدُوا۟", "اعْبُدُوا"],
    ["أُو۟لَـٰٓئِكَ", "أُولَئِكَ"],
    ["وَجِا۟ىٓءَ", "وَجِيءَ"],
    ["ٱلَّيْلِ", "اللَّيْلِ"],
    ["وَٱلَّيْلِ", "وَاللَّيْلِ"],
    ["ٱلَّـٰتِى", "اللَّاتِي"],
    ["ٱلَّذِينَ", "الَّذِينَ"],
    ["ٱبْتَلَىٰٓ", "ابْتَلَى"],
    ["عَلَىٰ", "عَلَى"],
    ["أَزْوَٰجًا", "أَزْوَاجًا"],
    ["وَٰحِدَةٌ", "وَاحِدَةٌ"],
    ["ٱلسَّمَـٰوَٰتِ", "السَّمَاوَاتِ"],
    ["الٓمٓ", "الم"],
    ["كٓهيعٓصٓ", "كهيعص"],
    ["يسٓ", "يس"],
  ];

  it.each(pairs)("%s ~ %s", (uthmani, model) => {
    expect(similarity(normalizeWord(uthmani), normalizeWord(model))).toBe(1);
  });

  it("keeps a waw that is a consonant (وَٰ) but drops one that only carries the vowel (وٰ)", () => {
    expect(key("أَزْوَٰجًا")).toBe("ازوجا");
    expect(key("ٱلصَّلَوٰةَ")).toBe("الصلاه");
  });
});

describe("normalizeWord: different words stay different", () => {
  const distinct: [string, string][] = [
    ["قُلْ", "قَالَ"],
    ["ٱلرَّحْمَـٰنِ", "الرَّحِيمِ"],
    ["يَعْلَمُونَ", "تَعْلَمُونَ"],
    ["ٱللَّهِ", "إِلَـٰهَ"],
    ["نَعْبُدُ", "نَسْتَعِينُ"],
  ];
  it.each(distinct)("%s ≠ %s", (a, b) => {
    expect(similarity(normalizeWord(a), normalizeWord(b))).toBeLessThan(1);
  });
});

describe("normalizeWord over the whole Quran", () => {
  it("gives every word of every ayah a non-empty key made only of letters", () => {
    let words = 0;
    for (const { surah, ayah, text } of allAyahs()) {
      for (const w of ayahWords(text)) {
        const k = normalizeWord(w);
        expect(k, `${surah}:${ayah} ${w}`).toMatch(/^[\u0621-\u064A\uE000-\uE003]+$/);
        expect(requiredLetters(k).length, `${surah}:${ayah} ${w}`).toBeGreaterThan(0);
        words++;
      }
    }
    expect(words).toBeGreaterThan(77_000);
  });
});

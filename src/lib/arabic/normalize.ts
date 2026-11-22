/* eslint-disable no-misleading-character-class --
   The character classes below list individual combining marks (harakat, U+0670, Quranic signs) next to
   base letters on purpose: each code point is matched on its own, never as a combined glyph. */


/**
 * Comparison keys for Arabic Quran text.
 *
 * Everything here is in-memory and for comparison only: the input string is never changed, and the
 * key that comes out is never displayed. The displayed text is always Tanzil's original.
 *
 * The rules bridge Tanzil's Uthmani script and the speech model's output, which is fully diacritized
 * standard (Imla'i) spelling, e.g. Uthmani `ٱلْعَـٰلَمِينَ` vs model `الْعَالَمِينَ`. Besides the usual
 * steps (strip harakat and Quranic marks, remove tatweel, unify alef forms, ى→ي, ة→ه, hamza) it keeps
 * track of letters that one spelling writes and the other may omit. Those become "optional letters"
 * (private-use code points) that the similarity function can match or skip at no cost.
 */

/** Optional alef: from the superscript (dagger) alef U+0670, or an alef marked silent. */
export const OPT_ALEF = "\uE000";
/** Optional waw: a waw marked silent (e.g. أُو۟لَـٰٓئِكَ). */
export const OPT_WAW = "\uE001";
/** Optional yeh: a yeh or alef maksura marked silent. */
export const OPT_YEH = "\uE002";
/** Optional lam: the second lam that Uthmani merges into a shadda (ٱلَّيْلِ ~ اللَّيْلِ). */
export const OPT_LAM = "\uE003";

/** The letter each optional letter stands for. */
export const OPTIONAL_BASE: Readonly<Record<string, string>> = {
  [OPT_ALEF]: "\u0627",
  [OPT_WAW]: "\u0648",
  [OPT_YEH]: "\u064A",
  [OPT_LAM]: "\u0644",
};

const ALEF = "\u0627";
const SUPERSCRIPT_ALEF = "\u0670";
const SILENT_SIGNS = "\u06DF\u06E0"; // small high rounded zero, small high upright rectangular zero
const LETTER = "[\u0621-\u064A\u0671]";
/** Harakat and Quranic marks that can sit between a letter and a following sign. */
const MARKS = "[\u064B-\u065F\u06D6-\u06DE\u06E1-\u06ED]*";

/** Stripped for comparison: harakat (U+064B–U+065F), Quranic marks (U+0610–U+061A, U+06D6–U+06ED), tatweel. */
const STRIP = /[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED\u0640]/g;

const SEAT_WAW = /\u0648\u0670/g; // ٱلصَّلَوٰةَ: waw that only carries the long ā
const MID_MAKSURA_ALEF = new RegExp(`\u0649\u0670(?=${MARKS}${LETTER})`, "g"); // ٱلتَّوْرَىٰةَ
const PRONOUN_SMALL_LETTER = /(\u0647[\u064B-\u065F]*)[\u06E5\u06E6]/g; // إِنَّهُۥ, بِهِۦ
const SILENT_LETTER = new RegExp(`([\u0627\u0648\u064A\u0649])(${MARKS})[${SILENT_SIGNS}]`, "g");
const MERGED_LAM = new RegExp(
  `^((?:[\u0648\u0641\u0628\u0643][\u064B-\u065F]*)?)\u0671\u0644(?=[\u064B-\u0650\u0652-\u065F]*\u0651[\u064B-\u065F\u0640\u0670]*(?!\u0644)${LETTER})`,
);
/** Letter forms from other Arabic-script orthographies, mapped in case the model ever emits them. */
const VARIANT_LETTERS: Readonly<Record<string, string>> = { "\u06CC": "\u064A", "\u06A9": "\u0643", "\u06C1": "\u0647" };
const LEADING_HAMZA_ALEF = /^[\u0621\u0623\u0625\u0622\u0671\u0627]+/;
const INNER_HAMZA = /[\u0621\u0623\u0625\u0624\u0626]/g;
const INNER_ALEF_FORMS = /[\u0622\u0671]/g;
const NOT_KEY_CHAR = /[^\u0621-\u064A\uE000-\uE003]/g;

const SILENT_TO_OPTIONAL: Readonly<Record<string, string>> = {
  "\u0627": OPT_ALEF,
  "\u0648": OPT_WAW,
  "\u064A": OPT_YEH,
  "\u0649": OPT_YEH,
};

/**
 * The comparison key of one word (Uthmani or Imla'i). Pure: returns a new string.
 *
 * @example normalizeWord("ٱلْعَـٰلَمِينَ") // "ال" + "ع" + OPT_ALEF + "لمين"
 */
export function normalizeWord(word: string): string {
  let w = word.normalize("NFC");

  // 1. Uthmani spellings whose letters Imla'i writes differently (before marks are removed).
  w = w.replace(SEAT_WAW, ALEF);
  w = w.replace(MID_MAKSURA_ALEF, ALEF);
  w = w.replace(/\u06E7/g, "\u064A"); // small high yeh: إِبْرَٰهِـۧمَ ~ إبراهيم
  w = w.replace(PRONOUN_SMALL_LETTER, "$1"); // the lengthening on the pronoun ه is not written in Imla'i
  w = w.replace(/\u06E5/g, "\u0648").replace(/\u06E6/g, "\u064A"); // دَاوُۥدَ ~ داوود
  w = w.replace(SILENT_LETTER, (_, letter: string, marks: string) => SILENT_TO_OPTIONAL[letter] + marks);
  w = w.replace(MERGED_LAM, `$1\u0671\u0644${OPT_LAM}`);
  w = w.replaceAll(SUPERSCRIPT_ALEF, OPT_ALEF);

  // 2. Harakat, Quranic annotation marks and tatweel.
  w = w.replace(STRIP, "");

  // 3. Alef and hamza forms: a word-initial hamza/alef cluster is one alef; elsewhere a hamza
  //    (with or without its seat) is dropped, and آ / ٱ become a plain alef.
  w = w.replace(LEADING_HAMZA_ALEF, ALEF);
  w = w.replace(INNER_HAMZA, "");
  w = w.replace(INNER_ALEF_FORMS, ALEF);
  w = w.replace(/\u0627{2,}/g, ALEF);

  // 4. Letter variants.
  w = w.replace(/\u0649/g, "\u064A").replace(/\u0629/g, "\u0647");
  w = w.replace(/[\u06CC\u06A9\u06C1]/g, (ch) => VARIANT_LETTERS[ch] ?? ch);

  // 5. Anything else (punctuation, digits, stray symbols) is not part of the key.
  return w.replace(NOT_KEY_CHAR, "");
}

/** A key with its optional letters dropped, for display in debugging or tests. */
export function requiredLetters(key: string): string {
  return key.replace(/[\uE000-\uE003]/g, "");
}

/** True if the character is one of the optional-letter code points. */
export function isOptionalLetter(ch: string): boolean {
  return ch in OPTIONAL_BASE;
}

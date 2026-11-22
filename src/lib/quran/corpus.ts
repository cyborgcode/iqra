import { normalizeWord } from "../arabic/normalize";
import { SURAHS } from "../../data/surahs";
import { AYAH_COUNT, surahFirstAyah } from "./book";
import { loadSurah, type SurahText } from "./load";
import { ayahWords } from "./tokenize";

/**
 * The whole Quran as one sequence of words, so a recitation can be found and followed anywhere.
 *
 * Words are numbered 0…77432 in reading order. The text is Tanzil's, untouched: `words[i]` is the
 * i-th word exactly as published, and comparison keys are computed in memory on demand.
 */
export class Corpus {
  /** Verbatim text of every ayah, by ayah index. */
  readonly ayahText: readonly string[];
  /** Verbatim basmala shown above each surah (null for Al-Fatiha's header and At-Tawba). */
  readonly bismillah: readonly (string | null)[];
  /** Verbatim text of every word, by word index. */
  readonly words: readonly string[];
  /** Ayah index of every word. */
  readonly ayahOfWord: Uint16Array;
  /** Word index of the first word of every ayah, then the total number of words. */
  readonly ayahStart: Uint32Array;
  private readonly keys: (string | undefined)[];

  constructor(data: { ayahText: string[]; bismillah: (string | null)[]; words: string[]; ayahOfWord: Uint16Array; ayahStart: Uint32Array }) {
    this.ayahText = data.ayahText;
    this.bismillah = data.bismillah;
    this.words = data.words;
    this.ayahOfWord = data.ayahOfWord;
    this.ayahStart = data.ayahStart;
    this.keys = new Array<string | undefined>(data.words.length);
  }

  get size(): number {
    return this.words.length;
  }

  /** Comparison key of word i (see normalizeWord). Never displayed. */
  key(i: number): string {
    return (this.keys[i] ??= keyOf(this.words[i]!));
  }

  /** Word index of the `word`-th word (0-based) of ayah `ayah` (an ayah index). */
  wordIndex(ayah: number, word: number): number {
    return this.ayahStart[ayah]! + word;
  }
}

/** One key per distinct spelling: the Quran has 77k words but only 19k distinct written forms. */
const keyCache = new Map<string, string>();
function keyOf(word: string): string {
  let key = keyCache.get(word);
  if (key === undefined) keyCache.set(word, (key = normalizeWord(word)));
  return key;
}

/** Builds the corpus from the 114 surah files, yielding to the page between surahs when asked. */
export async function buildCorpus(surahs: readonly SurahText[], pause?: () => Promise<void>): Promise<Corpus> {
  if (surahs.length !== SURAHS.length) throw new Error(`Expected ${SURAHS.length} surahs, got ${surahs.length}`);
  const ayahText: string[] = [];
  const bismillah: (string | null)[] = [];
  const words: string[] = [];
  const ayahOf: number[] = [];
  const ayahStart = new Uint32Array(AYAH_COUNT + 1);
  for (const [s, surah] of surahs.entries()) {
    if (surah.surah !== s + 1 || surah.ayahs.length !== SURAHS[s]!.ayahs) throw new Error(`Surah ${s + 1} does not match the index`);
    bismillah.push(surah.bismillah);
    const first = surahFirstAyah(s + 1);
    for (const [a, text] of surah.ayahs.entries()) {
      ayahText.push(text);
      ayahStart[first + a] = words.length;
      for (const w of ayahWords(text)) {
        words.push(w);
        ayahOf.push(first + a);
      }
    }
    if (pause && s % 16 === 15) await pause();
  }
  ayahStart[AYAH_COUNT] = words.length;
  return new Corpus({ ayahText, bismillah, words, ayahOfWord: Uint16Array.from(ayahOf), ayahStart });
}

/** Lets the browser paint and handle input during long work. */
export const yieldToPage = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let corpus: Promise<Corpus> | null = null;

/** Loads every surah (static files, cached by the browser) and builds the corpus once. */
export function loadCorpus(): Promise<Corpus> {
  corpus ??= Promise.all(SURAHS.map((s) => loadSurah(s.number))).then((surahs) => buildCorpus(surahs, yieldToPage));
  corpus.catch(() => (corpus = null));
  return corpus;
}

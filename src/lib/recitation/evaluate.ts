import { normalizeWord } from "../arabic/normalize";
import { similarity } from "../arabic/similarity";
import { ayahWords } from "../quran/tokenize";
import { align, type AlignToken } from "./align";
import type { OptionalPhrase } from "./phrases";

export type WordStatus = "correct" | "wrong" | "missed";

/** A word of the selected ayahs, as Tanzil writes it, with its position. */
export interface ExpectedWord {
  /** Original Uthmani text of the word (for display only). */
  text: string;
  ayah: number;
  /** Index of the word within its ayah (pause marks are not words). */
  word: number;
}

export interface WordResult extends ExpectedWord {
  status: WordStatus;
  /** What the model heard for this word, for wrong words (and merged spellings). */
  heard?: string;
  similarity: number;
}

export interface ExtraWord {
  /** Index into `words` of the word it follows; -1 if it comes before the first word. */
  after: number;
  text: string;
  /** True when it repeats a nearby expected word (a repeated phrase or a restart). */
  repeated: boolean;
}

export interface Evaluation {
  words: WordResult[];
  extras: ExtraWord[];
  counts: Record<WordStatus | "extra", number>;
  /** Correct words / expected words, in [0, 1]. */
  accuracy: number;
  /** Optional phrases that were heard (isti'adha, basmala, …). */
  recitedOptional: OptionalPhrase["id"][];
}

export interface EvaluateOptions {
  threshold: number;
  before?: readonly OptionalPhrase[];
  after?: readonly OptionalPhrase[];
}

const REPEAT_WINDOW = 8;

/** The expected words of consecutive ayahs, numbered by ayah and word index. */
export function expectedWords(ayahs: readonly { number: number; text: string }[]): ExpectedWord[] {
  return ayahs.flatMap(({ number, text }) => ayahWords(text).map((w, word) => ({ text: w, ayah: number, word })));
}

/**
 * Compares a transcript with the expected words and marks every expected word correct, wrong or
 * missed, plus any extra words. Results refer to expected words by index, never by text replacement.
 */
export function evaluateRecitation(expected: readonly ExpectedWord[], transcript: string, options: EvaluateOptions): Evaluation {
  const { threshold, before = [], after = [] } = options;

  const heardRaw = transcript.split(/\s+/).filter((w) => normalizeWord(w) !== "");
  const heardKeys = heardRaw.map(normalizeWord);

  type Slot = { kind: "required"; index: number } | { kind: "optional"; phrase: OptionalPhrase["id"] };
  const tokens: AlignToken[] = [];
  const slots: Slot[] = [];
  const addPhrase = (p: OptionalPhrase) => {
    for (const w of ayahWords(p.text)) {
      tokens.push({ key: normalizeWord(w), optional: true });
      slots.push({ kind: "optional", phrase: p.id });
    }
  };
  const expectedKeys = expected.map((w) => normalizeWord(w.text));
  before.forEach(addPhrase);
  expectedKeys.forEach((key, index) => {
    tokens.push({ key });
    slots.push({ kind: "required", index });
  });
  after.forEach(addPhrase);

  const words: WordResult[] = expected.map((w) => ({ ...w, status: "missed", similarity: 0 }));
  const extras: ExtraWord[] = [];
  const recited = new Set<OptionalPhrase["id"]>();
  let lastRequired = -1;

  for (const op of align(tokens, heardKeys, { threshold })) {
    if (op.type === "extra") {
      extras.push({ after: lastRequired, text: heardRaw[op.heard]!, repeated: false });
      continue;
    }
    const range = op.type === "miss" ? [op.expected, op.expected + 1] : op.expected;
    for (let t = range[0]!; t < range[1]!; t++) {
      const slot = slots[t]!;
      if (slot.kind === "optional") {
        if (op.type === "match") recited.add(slot.phrase);
        continue;
      }
      lastRequired = slot.index;
      if (op.type === "match") {
        const heard = heardRaw.slice(op.heard[0], op.heard[1]).join(" ");
        const ok = op.similarity >= threshold;
        words[slot.index] = {
          ...expected[slot.index]!,
          status: ok ? "correct" : "wrong",
          similarity: op.similarity,
          ...(ok && op.heard[1] - op.heard[0] === 1 && op.expected[1] - op.expected[0] === 1 ? {} : { heard }),
        };
      }
    }
  }

  // An extra word that matches a nearby expected word is a repetition (or a restart to correct oneself).
  for (const extra of extras) {
    const key = normalizeWord(extra.text);
    const from = Math.max(0, extra.after - REPEAT_WINDOW + 1);
    const to = Math.min(expected.length - 1, extra.after + REPEAT_WINDOW);
    for (let k = from; k <= to; k++) {
      if (similarity(key, expectedKeys[k]!) >= threshold) {
        extra.repeated = true;
        break;
      }
    }
  }

  const counts = { correct: 0, wrong: 0, missed: 0, extra: extras.length };
  for (const w of words) counts[w.status]++;
  return {
    words,
    extras,
    counts,
    accuracy: words.length ? counts.correct / words.length : 0,
    recitedOptional: [...recited],
  };
}

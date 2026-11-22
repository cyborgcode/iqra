/**
 * Splits an ayah into display tokens without changing it: joining the tokens' text gives back the
 * exact original string. Words are numbered so results can be mapped to them by index.
 */

export type AyahToken =
  | { kind: "word"; text: string; index: number }
  | { kind: "mark"; text: string }
  | { kind: "space"; text: string };

/** Any Arabic letter. Pause marks (ۖ ۗ ۚ ۛ …), ۞ and ۩ standing on their own are not words. */
const HAS_LETTER = /[\u0621-\u064A\u0671-\u06D3\u06FA-\u06FF]/;

export function tokenizeAyah(text: string): AyahToken[] {
  const tokens: AyahToken[] = [];
  let index = 0;
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) tokens.push({ kind: "space", text: part });
    else if (HAS_LETTER.test(part)) tokens.push({ kind: "word", text: part, index: index++ });
    else tokens.push({ kind: "mark", text: part });
  }
  return tokens;
}

/** The words of an ayah (original text), in order. */
export function ayahWords(text: string): string[] {
  return tokenizeAyah(text).flatMap((t) => (t.kind === "word" ? [t.text] : []));
}

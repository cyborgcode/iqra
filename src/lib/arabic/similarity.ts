import { OPTIONAL_BASE } from "./normalize";

/** Cost of swapping a word-final ه and ت: closed vs open ta, which sound alike when the word is joined. */
export const FINAL_TA_COST = 0.3;

const HEH = "\u0647";
const TEH = "\u062A";

function base(ch: string): string {
  return OPTIONAL_BASE[ch] ?? ch;
}

function indel(ch: string): number {
  return ch in OPTIONAL_BASE ? 0 : 1;
}

function requiredLength(key: string): number {
  let n = 0;
  for (const ch of key) if (!(ch in OPTIONAL_BASE)) n++;
  return n;
}

/**
 * Weighted Levenshtein distance between two comparison keys (see `normalizeWord`).
 * Optional letters cost nothing to skip and match their letter for free; a word-final ه/ت swap is cheap.
 */
export function weightedDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = new Float64Array(y.length + 1);
  let cur = new Float64Array(y.length + 1);
  for (let j = 1; j <= y.length; j++) prev[j] = prev[j - 1]! + indel(y[j - 1]!);
  for (let i = 1; i <= x.length; i++) {
    const xi = x[i - 1]!;
    cur[0] = prev[0]! + indel(xi);
    for (let j = 1; j <= y.length; j++) {
      const yj = y[j - 1]!;
      let sub = 1;
      if (xi === yj || base(xi) === base(yj)) sub = 0;
      else if (i === x.length && j === y.length && ((xi === HEH && yj === TEH) || (xi === TEH && yj === HEH))) {
        sub = FINAL_TA_COST;
      }
      cur[j] = Math.min(prev[j]! + indel(xi), cur[j - 1]! + indel(yj), prev[j - 1]! + sub);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[y.length]!;
}

/**
 * Similarity of two comparison keys in [0, 1]:  sim = 1 − d(a, b) / max(|a|, |b|),
 * where lengths count required letters only. 1 means the words match exactly.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const n = Math.max(requiredLength(a), requiredLength(b));
  if (n === 0) return 1;
  return Math.max(0, 1 - weightedDistance(a, b) / n);
}

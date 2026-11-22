import { OPTIONAL_BASE } from "./normalize";

/** Cost of swapping a word-final ه and ت: closed vs open ta, which sound alike when the word is joined. */
export const FINAL_TA_COST = 0.3;

const HEH = 0x0647;
const TEH = 0x062a;

/** A comparison key ready for fast distance computations. */
export interface PreparedKey {
  readonly key: string;
  /** Code of each letter; optional letters are replaced by the letter they stand for. */
  readonly base: Uint16Array;
  /** 0 for an optional letter (free to skip), 1 for a required one. */
  readonly indel: Uint8Array;
  /** Number of required letters. */
  readonly required: number;
}

const prepared = new Map<string, PreparedKey>();

/** Keys contain only Arabic letters and the optional-letter code points, so one UTF-16 unit is one letter. */
export function prepareKey(key: string): PreparedKey {
  let p = prepared.get(key);
  if (!p) {
    const base = new Uint16Array(key.length);
    const indel = new Uint8Array(key.length);
    let required = 0;
    for (let i = 0; i < key.length; i++) {
      const ch = key[i]!;
      const b = OPTIONAL_BASE[ch];
      base[i] = (b ?? ch).charCodeAt(0);
      indel[i] = b === undefined ? 1 : 0;
      required += indel[i]!;
    }
    p = { key, base, indel, required };
    if (prepared.size > 100_000) prepared.clear();
    prepared.set(key, p);
  }
  return p;
}

let prevRow = new Float64Array(32);
let curRow = new Float64Array(32);

function distance(x: PreparedKey, y: PreparedKey): number {
  const n = x.base.length;
  const m = y.base.length;
  if (prevRow.length <= m) {
    prevRow = new Float64Array(2 * (m + 1));
    curRow = new Float64Array(2 * (m + 1));
  }
  let prev = prevRow;
  let cur = curRow;
  prev[0] = 0;
  for (let j = 1; j <= m; j++) prev[j] = prev[j - 1]! + y.indel[j - 1]!;
  for (let i = 1; i <= n; i++) {
    const xi = x.base[i - 1]!;
    const xd = x.indel[i - 1]!;
    cur[0] = prev[0]! + xd;
    for (let j = 1; j <= m; j++) {
      const yj = y.base[j - 1]!;
      let sub = xi === yj ? 0 : 1;
      if (sub === 1 && i === n && j === m && ((xi === HEH && yj === TEH) || (xi === TEH && yj === HEH))) sub = FINAL_TA_COST;
      const del = prev[j]! + xd;
      const ins = cur[j - 1]! + y.indel[j - 1]!;
      const dia = prev[j - 1]! + sub;
      cur[j] = del < ins ? (del < dia ? del : dia) : ins < dia ? ins : dia;
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[m]!;
}

/**
 * Weighted Levenshtein distance between two comparison keys (see `normalizeWord`).
 * Optional letters cost nothing to skip and match their letter for free; a word-final ه/ت swap is cheap.
 */
export function weightedDistance(a: string, b: string): number {
  return distance(prepareKey(a), prepareKey(b));
}

export function similarityOf(a: PreparedKey, b: PreparedKey): number {
  if (a.key === b.key) return 1;
  const n = Math.max(a.required, b.required);
  if (n === 0) return 1;
  return Math.max(0, 1 - distance(a, b) / n);
}

/**
 * An upper bound on `similarityOf(a, b)` from the lengths alone: every required letter of the longer
 * key that has no letter at all to pair with in the other key must be deleted at full cost.
 */
export function similarityBound(a: PreparedKey, b: PreparedKey): number {
  const n = Math.max(a.required, b.required);
  if (n === 0) return 1;
  const unpaired = Math.max(0, a.required - b.base.length, b.required - a.base.length);
  return 1 - unpaired / n;
}

/**
 * Similarity of two comparison keys in [0, 1]:  sim = 1 − d(a, b) / max(|a|, |b|),
 * where lengths count required letters only. 1 means the words match exactly.
 */
export function similarity(a: string, b: string): number {
  return similarityOf(prepareKey(a), prepareKey(b));
}

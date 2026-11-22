import { similarity } from "../arabic/similarity";

/** One expected word as seen by the aligner. Optional words (isti'adha, basmala…) cost nothing to skip. */
export interface AlignToken {
  key: string;
  optional?: boolean;
}

/** Half-open index ranges into the expected and heard word lists. */
export type AlignOp =
  | { type: "match"; expected: [number, number]; heard: [number, number]; similarity: number }
  | { type: "miss"; expected: number }
  | { type: "extra"; heard: number };

export interface AlignOptions {
  /** Similarity at or above which two words count as the same word. */
  threshold: number;
}

/** Small extra cost per additional word in a merge, so merges are used only when they fit better. */
const MERGE_PENALTY = 0.05;

/**
 * Joins the keys of words that one spelling writes apart and the other writes together
 * (يَا أَيُّهَا ~ يَـٰٓأَيُّهَا). The alef that starts a later piece is elided in the joined form.
 */
export function joinKeys(keys: readonly string[]): string {
  return keys.map((k, i) => (i > 0 && k.startsWith("\u0627") ? k.slice(1) : k)).join("");
}

// Operation codes, in tie-breaking priority: on equal cost the earlier one wins. Preferring matches
// while tracing back from the end puts repeated words before the copy that is matched, i.e. the
// reciter's final attempt is the one that counts.
const MATCH = 0;
const MERGE_HEARD_2 = 1;
const MERGE_HEARD_3 = 2;
const MERGE_EXPECTED_2 = 3;
const EXTRA = 4;
const MISS = 5;

/**
 * Word-level alignment of expected words to heard words (Needleman–Wunsch style edit distance).
 *
 *   D[i][j] = min( D[i-1][j-1] + 1 − sim(eᵢ, hⱼ),           match / substitution
 *                  D[i-1][j-k] + 1 − sim(eᵢ, hⱼ₋ₖ₊₁…hⱼ) + ε,  one word heard as k = 2, 3 words
 *                  D[i-2][j-1] + 1 − sim(eᵢ₋₁eᵢ, hⱼ) + ε,     two words heard as one
 *                  D[i][j-1] + 1,                            extra word
 *                  D[i-1][j] + (eᵢ optional ? 0 : 1) )       missed word
 *
 * Merges are only allowed when the merged words reach the threshold, so they never hide extra words.
 */
export function align(expected: readonly AlignToken[], heard: readonly string[], { threshold }: AlignOptions): AlignOp[] {
  const n = expected.length;
  const m = heard.length;
  const W = m + 1;
  const cost = new Float64Array((n + 1) * W).fill(Number.POSITIVE_INFINITY);
  const op = new Int8Array((n + 1) * W).fill(-1);
  const sims = new Float64Array((n + 1) * W);
  cost[0] = 0;

  const simCache = new Map<string, number>();
  const sim = (a: string, b: string) => {
    const k = a + "\u0000" + b;
    let s = simCache.get(k);
    if (s === undefined) simCache.set(k, (s = similarity(a, b)));
    return s;
  };

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) continue;
      let best = Number.POSITIVE_INFINITY;
      let bestOp = -1;
      let bestSim = 0;
      const consider = (c: number, code: number, s = 0) => {
        if (c < best) {
          best = c;
          bestOp = code;
          bestSim = s;
        }
      };
      if (i > 0 && j > 0) {
        const e = expected[i - 1]!;
        const s = sim(e.key, heard[j - 1]!);
        if (!e.optional || s >= threshold) consider(cost[(i - 1) * W + j - 1]! + 1 - s, MATCH, s);
        // A merge must explain the words better than any one of them alone; otherwise a short extra
        // word next to a long one (رَبِّ + ٱلْعَـٰلَمِينَ) would be swallowed instead of reported.
        let bestPiece = s;
        for (const k of [2, 3] as const) {
          if (j < k) continue;
          bestPiece = Math.max(bestPiece, sim(e.key, heard[j - k]!));
          const sk = sim(e.key, joinKeys(heard.slice(j - k, j)));
          if (sk >= threshold && sk > bestPiece) {
            consider(cost[(i - 1) * W + j - k]! + 1 - sk + MERGE_PENALTY * (k - 1), k === 2 ? MERGE_HEARD_2 : MERGE_HEARD_3, sk);
          }
        }
        if (i > 1) {
          const prev = expected[i - 2]!;
          if (!prev.optional && !e.optional) {
            const s2 = sim(joinKeys([prev.key, e.key]), heard[j - 1]!);
            if (s2 >= threshold && s2 > Math.max(s, sim(prev.key, heard[j - 1]!))) {
              consider(cost[(i - 2) * W + j - 1]! + 1 - s2 + MERGE_PENALTY, MERGE_EXPECTED_2, s2);
            }
          }
        }
      }
      if (j > 0) consider(cost[i * W + j - 1]! + 1, EXTRA);
      if (i > 0) consider(cost[(i - 1) * W + j]! + (expected[i - 1]!.optional ? 0 : 1), MISS);
      cost[i * W + j] = best;
      op[i * W + j] = bestOp;
      sims[i * W + j] = bestSim;
    }
  }

  const ops: AlignOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const code = op[i * W + j]!;
    const s = sims[i * W + j]!;
    switch (code) {
      case MATCH:
        ops.push({ type: "match", expected: [i - 1, i], heard: [j - 1, j], similarity: s });
        i--;
        j--;
        break;
      case MERGE_HEARD_2:
      case MERGE_HEARD_3: {
        const k = code === MERGE_HEARD_2 ? 2 : 3;
        ops.push({ type: "match", expected: [i - 1, i], heard: [j - k, j], similarity: s });
        i--;
        j -= k;
        break;
      }
      case MERGE_EXPECTED_2:
        ops.push({ type: "match", expected: [i - 2, i], heard: [j - 1, j], similarity: s });
        i -= 2;
        j--;
        break;
      case EXTRA:
        ops.push({ type: "extra", heard: j - 1 });
        j--;
        break;
      case MISS:
        ops.push({ type: "miss", expected: i - 1 });
        i--;
        break;
      default:
        throw new Error(`alignment backtrace failed at (${i}, ${j})`);
    }
  }
  return ops.reverse();
}

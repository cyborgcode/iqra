import { prepareKey, similarity, similarityBound, similarityOf } from "../arabic/similarity";

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
  /**
   * Find where the heard words fit best inside `expected` instead of aligning all of both: expected
   * words before and after the matched span cost nothing, and the span starts and ends on a word that
   * is close to the text. Among equally good spans, the one starting nearest `anchor` (an index into
   * `expected`) wins.
   */
  local?: {
    anchor: number;
    /**
     * Whether expected word `i` may be misread at the start of the span (as the first heard word) or at
     * its end (as the last one) even when it is nothing like the text, e.g. where an ayah begins or ends.
     */
    boundary?: (i: number, side: "start" | "end") => boolean;
  };
}

const simCache = new Map<string, number>();

/** Word similarity, memoized: a recitation is compared with the same words many times. */
export function sim(a: string, b: string): number {
  const k = a + "\u0000" + b;
  let s = simCache.get(k);
  if (s === undefined) {
    if (simCache.size > 200_000) simCache.clear();
    simCache.set(k, (s = similarity(a, b)));
  }
  return s;
}

/** Small extra cost per additional word in a merge, so merges are used only when they fit better. */
const MERGE_PENALTY = 0.05;
/** Per-word cost of starting a local span away from its anchor: only breaks ties. */
const ANCHOR_COST = 1e-4;
/**
 * In a local alignment, a word heard wrong costs a little more than its dissimilarity, so that an exact
 * match next to an extra word beats two half-similar substitutions; and a word nothing like the text
 * costs more than leaving it out of the span (as an extra word), except where an ayah begins or ends.
 */
const WRONG_COST = 0.25;
const UNLIKE_COST = 0.5;
/** Below this similarity a heard word is "nothing like" the expected one. */
const EDGE_SIMILARITY = 0.5;

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
const START = 6;

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
export function align(expected: readonly AlignToken[], heard: readonly string[], { threshold, local }: AlignOptions): AlignOp[] {
  const n = expected.length;
  const m = heard.length;
  const W = m + 1;
  const cost = new Float64Array((n + 1) * W).fill(Number.POSITIVE_INFINITY);
  const op = new Int8Array((n + 1) * W).fill(-1);
  const sims = new Float64Array((n + 1) * W);
  cost[0] = 0;

  const e = expected.map((t) => prepareKey(t.key));
  const h = heard.map(prepareKey);
  // Heard words j-k…j-1 written as one word, and expected words i-2, i-1 written as one.
  const heard2 = heard.map((_, j) => (j >= 1 ? prepareKey(joinKeys([heard[j - 1]!, heard[j]!])) : null));
  const heard3 = heard.map((_, j) => (j >= 2 ? prepareKey(joinKeys([heard[j - 2]!, heard[j - 1]!, heard[j]!])) : null));
  const expected2 = expected.map((t, i) =>
    i >= 1 && !t.optional && !expected[i - 1]!.optional ? prepareKey(joinKeys([expected[i - 1]!.key, t.key])) : null,
  );
  /** sim(eᵢ, hⱼ) of the previous and current row, by j. */
  let prevRow = new Float64Array(W);
  let row = new Float64Array(W);

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (local && j === 0) {
        cost[i * W] = ANCHOR_COST * Math.abs(i - local.anchor);
        op[i * W] = START;
        continue;
      }
      if (i === 0 && j === 0) continue;
      // Candidates in tie-breaking order; a later one must be strictly cheaper to win.
      let best = Number.POSITIVE_INFINITY;
      let bestOp = -1;
      let bestSim = 0;
      if (i > 0 && j > 0) {
        const ei = e[i - 1]!;
        const optional = expected[i - 1]!.optional === true;
        const s = similarityOf(ei, h[j - 1]!);
        row[j] = s;
        if (!optional || s >= threshold) {
          let c = cost[(i - 1) * W + j - 1]! + 1 - s;
          if (local && s < threshold) {
            c += WRONG_COST;
            const edge = (j === m && local.boundary?.(i - 1, "end")) || (j === 1 && local.boundary?.(i - 1, "start"));
            if (s < EDGE_SIMILARITY && !edge) c += UNLIKE_COST;
          }
          best = c;
          bestOp = MATCH;
          bestSim = s;
        }
        // A merge must explain the words better than any one of them alone; otherwise a short extra
        // word next to a long one (رَبِّ + ٱلْعَـٰلَمِينَ) would be swallowed instead of reported.
        let bestPiece = s;
        for (let k = 2; k <= 3; k++) {
          if (j < k) continue;
          bestPiece = Math.max(bestPiece, row[j - k + 1]!);
          const joined = (k === 2 ? heard2 : heard3)[j - 1]!;
          if (similarityBound(ei, joined) < threshold) continue;
          const sk = similarityOf(ei, joined);
          if (sk >= threshold && sk > bestPiece) {
            const c = cost[(i - 1) * W + j - k]! + 1 - sk + MERGE_PENALTY * (k - 1);
            if (c < best) {
              best = c;
              bestOp = k === 2 ? MERGE_HEARD_2 : MERGE_HEARD_3;
              bestSim = sk;
            }
          }
        }
        const pair = expected2[i - 1];
        if (pair && similarityBound(pair, h[j - 1]!) >= threshold) {
          const s2 = similarityOf(pair, h[j - 1]!);
          if (s2 >= threshold && s2 > Math.max(s, prevRow[j]!)) {
            const c = cost[(i - 2) * W + j - 1]! + 1 - s2 + MERGE_PENALTY;
            if (c < best) {
              best = c;
              bestOp = MERGE_EXPECTED_2;
              bestSim = s2;
            }
          }
        }
      }
      if (j > 0) {
        const c = cost[i * W + j - 1]! + 1;
        if (c < best) {
          best = c;
          bestOp = EXTRA;
          bestSim = 0;
        }
      }
      if (i > 0) {
        const c = cost[(i - 1) * W + j]! + (expected[i - 1]!.optional ? 0 : 1);
        if (c < best) {
          best = c;
          bestOp = MISS;
          bestSim = 0;
        }
      }
      cost[i * W + j] = best;
      op[i * W + j] = bestOp;
      sims[i * W + j] = bestSim;
    }
    const t = prevRow;
    prevRow = row;
    row = t;
  }

  const ops: AlignOp[] = [];
  let i = n;
  let j = m;
  if (local) {
    // The span may end anywhere: take the best end. On a tie (the last heard word either extra or
    // matched after a missed word) the later end wins, explaining more of what was heard.
    for (let e = 0; e <= n; e++) if (cost[e * W + m]! <= cost[i * W + m]!) i = e;
  }
  while (i > 0 || j > 0) {
    const code = op[i * W + j]!;
    if (code === START) break;
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
  ops.reverse();
  if (!local) return ops;
  const boundary = local.boundary;
  return trimSpan(ops, threshold, (o, side) =>
    side === "start" ? o.heard[0] === 0 && !!boundary?.(o.expected[0], "start") : o.heard[1] === m && !!boundary?.(o.expected[1] - 1, "end"),
  );
}

/**
 * A local span holds at least one word heard correctly and starts and ends on a word that is close to
 * the text. Misses at its edges are dropped (those words are outside the span), and words at its edges
 * that are nothing like the text are reported as extra rather than stretching the span over expected
 * words that were not recited.
 */
function trimSpan(
  ops: AlignOp[],
  threshold: number,
  edge: (op: Extract<AlignOp, { type: "match" }>, side: "start" | "end") => boolean,
): AlignOp[] {
  if (!ops.some((o) => o.type === "match" && o.similarity >= threshold)) return ops.flatMap(asExtras);
  const ok = (o: AlignOp, side: "start" | "end") => o.type === "match" && (o.similarity >= EDGE_SIMILARITY || edge(o, side));
  const first = ops.findIndex((o) => ok(o, "start"));
  let last = ops.length - 1;
  while (!ok(ops[last]!, "end")) last--;
  return [...ops.slice(0, first).flatMap(asExtras), ...ops.slice(first, last + 1), ...ops.slice(last + 1).flatMap(asExtras)];
}

function asExtras(o: AlignOp): AlignOp[] {
  if (o.type === "extra") return [o];
  if (o.type === "miss") return [];
  return Array.from({ length: o.heard[1] - o.heard[0] }, (_, k) => ({ type: "extra" as const, heard: o.heard[0] + k }));
}

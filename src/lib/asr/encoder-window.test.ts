import { InferenceSession, Tensor } from "onnxruntime-node";
import { describe, expect, it } from "vitest";
import { FULL_WINDOW_SECONDS, MAX_POSITIONS, PARTIAL_PAD_SECONDS, PAD_SECONDS, SAMPLE_RATE, openEncoderWindow, windowSeconds } from "./encoder-window";

// A model laid out as a Whisper encoder, but tiny: the input's 3000 frames are halved to 1500
// positions (a strided slice here, a strided convolution in Whisper), to which a table of 1500
// position embeddings is added; both lengths are declared fixed.

const WIDTH = 2;

function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return out;
}
const join = (parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]));
const bytes = (no: number, payload: Uint8Array) => join([Uint8Array.from([...varint(no * 8 + 2), ...varint(payload.length)]), payload]);
const str = (no: number, s: string) => bytes(no, new TextEncoder().encode(s));
const int = (no: number, n: number) => Uint8Array.from([...varint(no * 8), ...varint(n)]);

const node = (op: string, inputs: string[], output: string) => bytes(1, join([...inputs.map((i) => str(1, i)), str(2, output), str(3, output), str(4, op)]));
function tensor(name: string, dims: number[], type: number, raw: ArrayBufferView) {
  return bytes(5, join([...dims.map((d) => int(1, d)), int(2, type), str(8, name), bytes(9, new Uint8Array(raw.buffer))]));
}
const dim = (d: number | string) => bytes(1, typeof d === "number" ? int(1, d) : str(2, d));
const valueInfo = (no: number, name: string, dims: (number | string)[]) => bytes(no, join([str(1, name), bytes(2, bytes(1, join([int(1, 1), bytes(2, join(dims.map(dim)))])))]));

const table = Float32Array.from({ length: MAX_POSITIONS * WIDTH }, (_, i) => Math.sin(i));

function encoderLike(): Uint8Array {
  const graph = join([
    node("Slice", ["input_features", "zero", "frames_max", "one", "two"], "halved"),
    node("Add", ["halved", "positions_table"], "last_hidden_state"),
    str(2, "encoder"),
    tensor("positions_table", [MAX_POSITIONS, WIDTH], 1, table),
    tensor("zero", [1], 7, new BigInt64Array([0n])),
    tensor("one", [1], 7, new BigInt64Array([1n])),
    tensor("two", [1], 7, new BigInt64Array([2n])),
    tensor("frames_max", [1], 7, new BigInt64Array([BigInt(2 * MAX_POSITIONS)])),
    valueInfo(11, "input_features", ["batch_size", 2 * MAX_POSITIONS, WIDTH]),
    valueInfo(12, "last_hidden_state", ["batch_size", MAX_POSITIONS, WIDTH]),
  ]);
  // ir_version 8, opset 18.
  return join([int(1, 8), str(2, "test"), bytes(7, graph), bytes(8, join([str(1, ""), int(2, 18)]))]);
}

function frames(n: number): Tensor {
  return new Tensor("float32", Float32Array.from({ length: n * WIDTH }, (_, i) => Math.cos(i * 0.37)), [1, n, WIDTH]);
}

async function run(model: Uint8Array, input: Tensor): Promise<Tensor> {
  const session = await InferenceSession.create(model);
  try {
    return (await session.run({ input_features: input })).last_hidden_state!;
  } finally {
    await session.release();
  }
}

describe("window for a phrase", () => {
  it("is the phrase and some silence, in whole seconds, at most 30 s", () => {
    expect(windowSeconds(4 * SAMPLE_RATE)).toBe(4 + PAD_SECONDS);
    expect(windowSeconds(4.2 * SAMPLE_RATE)).toBe(5 + PAD_SECONDS);
    expect(windowSeconds(0)).toBe(PAD_SECONDS);
    expect(windowSeconds(29 * SAMPLE_RATE)).toBe(FULL_WINDOW_SECONDS);
    expect(windowSeconds(4.2 * SAMPLE_RATE, PARTIAL_PAD_SECONDS)).toBe(5 + PARTIAL_PAD_SECONDS);
  });
});

describe("encoder window", () => {
  it("is needed: the model as exported only takes 30 s", async () => {
    await expect(run(encoderLike(), frames(1000))).rejects.toThrow();
  });

  it("computes exactly what the original did on 30 s", async () => {
    const original = await run(encoderLike(), frames(2 * MAX_POSITIONS));
    const opened = await run(openEncoderWindow(encoderLike()), frames(2 * MAX_POSITIONS));
    expect(opened.dims).toEqual([1, MAX_POSITIONS, WIDTH]);
    expect(opened.data).toEqual(original.data);
  });

  it("takes a shorter input, adding the positions it covers", async () => {
    const input = frames(1001);
    const out = await run(openEncoderWindow(encoderLike()), input);
    expect(out.dims).toEqual([1, 501, WIDTH]);
    const x = input.data as Float32Array;
    const expected = Float32Array.from({ length: 501 * WIDTH }, (_, i) => {
      const [p, c] = [Math.floor(i / WIDTH), i % WIDTH];
      return x[2 * p * WIDTH + c]! + table[p * WIDTH + c]!;
    });
    expect(out.data).toEqual(expected);
  });

  it("leaves a model it rewrote before as it is", () => {
    const once = openEncoderWindow(encoderLike());
    expect(openEncoderWindow(once)).toBe(once);
  });

  it("refuses a model that is not an encoder", () => {
    const decoderLike = join([int(1, 8), bytes(7, join([node("Identity", ["x"], "y"), valueInfo(11, "x", [1]), valueInfo(12, "y", [1])]))]);
    expect(() => openEncoderWindow(decoderLike)).toThrow(/position/);
    expect(() => openEncoderWindow(new Uint8Array([0xff, 0xff]))).toThrow();
  });
});

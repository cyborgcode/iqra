/**
 * Lets a Whisper encoder take less than 30 seconds of audio, which makes it much faster.
 *
 * Whisper's encoder always takes 30 s of audio: 3000 mel frames, 1500 positions once its strided
 * convolution has halved them. The ONNX export adds a fixed table of 1500 position embeddings to
 * the frames and declares those lengths as fixed, so a 5 s phrase has to be padded to 30 s, and the
 * encoder (whose cost grows with the length) does six times the work it needs to.
 *
 * `openEncoderWindow` rewrites the graph so that the table is sliced to the input's length before it
 * is added, and leaves the lengths open. Given 30 s, the rewritten graph computes exactly what the
 * original did.
 *
 * An ONNX model is a protocol buffer (onnx.proto). Only the graph's nodes and its input and output
 * shapes are rewritten; everything else, the weights included, is copied byte for byte.
 */

/** Positions in Whisper's encoder: 30 s at 50 per second. */
export const MAX_POSITIONS = 1500;
export const SAMPLE_RATE = 16000;
/** Whisper was trained on windows of 30 s: audio is padded with silence to fill one. */
export const FULL_WINDOW_SECONDS = 30;
/**
 * Silence after a finished phrase in a short window. With less, the model more often fails to see where
 * the phrase ends and repeats it; with this much, it transcribes recorded ayahs as it does in 30 s.
 */
export const PAD_SECONDS = 6;
/**
 * Silence after a phrase still being recited, transcribed provisionally: less, for speed. Cut off
 * mid-word, it differs from its transcription in 30 s mostly in that last word, about as often as with
 * 6 s; the repeats it makes more often are cut off.
 */
export const PARTIAL_PAD_SECONDS = 3;

/**
 * The window for a phrase of `samples` (16 kHz): the phrase and `pad` seconds of silence, in whole
 * seconds (so that few different lengths come up), at most 30 s. The encoder's work grows with the
 * window: a 4 s phrase costs a third of what it does padded to 30 s.
 */
export function windowSeconds(samples: number, pad = PAD_SECONDS): number {
  return Math.min(FULL_WINDOW_SECONDS, Math.ceil(samples / SAMPLE_RATE + pad));
}

/** The name of the sliced table in a rewritten graph (which also tells a graph already rewritten). */
const SLICED = "iqra_positions";

const VARINT = 0;
const FIXED64 = 1;
const BYTES = 2;
const FIXED32 = 5;

// Field numbers from onnx.proto.
const MODEL_GRAPH = 7;
const GRAPH_NODE = 1;
const GRAPH_INITIALIZER = 5;
const GRAPH_INPUT = 11;
const GRAPH_OUTPUT = 12;
const GRAPH_VALUE_INFO = 13;
const NODE_INPUT = 1;
const NODE_OUTPUT = 2;
const NODE_NAME = 3;
const NODE_OP_TYPE = 4;
const TENSOR_DIMS = 1;
const TENSOR_DATA_TYPE = 2;
const TENSOR_NAME = 8;
const TENSOR_RAW_DATA = 9;
const VALUE_INFO_TYPE = 2;
const TYPE_TENSOR = 1;
const TENSOR_TYPE_SHAPE = 2;
const SHAPE_DIM = 1;
const DIM_VALUE = 1;
const DIM_PARAM = 2;
const INT64 = 7;

/** One field of a message: its number, wire type, where it starts (its key), where its data starts, where it ends. */
interface Field {
  no: number;
  wire: number;
  start: number;
  data: number;
  end: number;
  /** The value of a varint field. */
  value: number;
}

function readVarint(buf: Uint8Array, pos: number): [value: number, next: number] {
  let value = 0;
  let scale = 1;
  for (;;) {
    if (pos >= buf.length) throw new Error("Truncated model");
    const byte = buf[pos++]!;
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return [value, pos];
    scale *= 128;
  }
}

function* fields(buf: Uint8Array, start: number, end: number): Generator<Field> {
  let pos = start;
  while (pos < end) {
    const [key, afterKey] = readVarint(buf, pos);
    const no = Math.floor(key / 8);
    const wire = key % 8;
    let data = afterKey;
    let value = 0;
    let next: number;
    if (wire === VARINT) [value, next] = readVarint(buf, afterKey);
    else if (wire === FIXED64) next = afterKey + 8;
    else if (wire === FIXED32) next = afterKey + 4;
    else if (wire === BYTES) {
      const [length, afterLength] = readVarint(buf, afterKey);
      data = afterLength;
      next = afterLength + length;
    } else throw new Error(`Unexpected wire type ${wire} in model`);
    if (next > end) throw new Error("Truncated model");
    yield { no, wire, start: pos, data, end: next, value };
    pos = next;
  }
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const text = (buf: Uint8Array, f: Field) => decoder.decode(buf.subarray(f.data, f.end));

function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const bytesField = (no: number, payload: Uint8Array) => concat([Uint8Array.from([...varint(no * 8 + BYTES), ...varint(payload.length)]), payload]);
const stringField = (no: number, s: string) => bytesField(no, encoder.encode(s));
const varintField = (no: number, n: number) => Uint8Array.from([...varint(no * 8 + VARINT), ...varint(n)]);

/**
 * The bytes of a message (from `start` to `end`) with some fields replaced: `edit` returns what to put
 * in place of a field (fields, keys included), or null to keep it. Returned in parts, to copy once.
 */
function rebuild(buf: Uint8Array, start: number, end: number, edit: (f: Field) => Uint8Array[] | null): Uint8Array[] {
  const parts: Uint8Array[] = [];
  let copyFrom = start;
  for (const f of fields(buf, start, end)) {
    const replacement = edit(f);
    if (!replacement) continue;
    parts.push(buf.subarray(copyFrom, f.start), ...replacement);
    copyFrom = f.end;
  }
  parts.push(buf.subarray(copyFrom, end));
  return parts;
}

/** A message field rewritten with `edit` (see rebuild). */
const rewrite = (buf: Uint8Array, f: Field, edit: (f: Field) => Uint8Array[] | null) => bytesField(f.no, concat(rebuild(buf, f.data, f.end, edit)));

function nodeField(op: string, inputs: readonly string[], outputs: readonly string[], name: string): Uint8Array {
  const parts = [...inputs.map((i) => stringField(NODE_INPUT, i)), ...outputs.map((o) => stringField(NODE_OUTPUT, o))];
  return bytesField(GRAPH_NODE, concat([...parts, stringField(NODE_NAME, name), stringField(NODE_OP_TYPE, op)]));
}

/** An initializer holding one small non-negative int64. */
function int64Field(name: string, value: number): Uint8Array {
  const raw = new Uint8Array(8);
  new DataView(raw.buffer).setUint32(0, value, true);
  return bytesField(GRAPH_INITIALIZER, concat([varintField(TENSOR_DIMS, 1), varintField(TENSOR_DATA_TYPE, INT64), stringField(TENSOR_NAME, name), bytesField(TENSOR_RAW_DATA, raw)]));
}

function tensorHead(buf: Uint8Array, f: Field): { name: string; dims: number[] } {
  let name = "";
  const dims: number[] = [];
  for (const t of fields(buf, f.data, f.end)) {
    if (t.no === TENSOR_NAME && t.wire === BYTES) name = text(buf, t);
    else if (t.no === TENSOR_DIMS && t.wire === VARINT) dims.push(t.value);
    else if (t.no === TENSOR_DIMS && t.wire === BYTES) {
      // Packed.
      for (let pos = t.data; pos < t.end; ) {
        const [dim, next] = readVarint(buf, pos);
        dims.push(dim);
        pos = next;
      }
    }
  }
  return { name, dims };
}

function nodeHead(buf: Uint8Array, f: Field): { op: string; inputs: string[]; outputs: string[] } {
  const node = { op: "", inputs: [] as string[], outputs: [] as string[] };
  for (const n of fields(buf, f.data, f.end)) {
    if (n.wire !== BYTES) continue;
    if (n.no === NODE_INPUT) node.inputs.push(text(buf, n));
    else if (n.no === NODE_OUTPUT) node.outputs.push(text(buf, n));
    else if (n.no === NODE_OP_TYPE) node.op = text(buf, n);
  }
  return node;
}

/** The open dimensions: a tensor's dimension of one of these lengths gets the name given. */
const OPEN_LENGTHS: ReadonlyMap<number, string> = new Map([
  [2 * MAX_POSITIONS, "frames"],
  [MAX_POSITIONS, "positions"],
]);

/** A tensor's type and shape (a graph input or output, or a shape noted for a tensor inside) with its lengths made open. */
function openDimensions(buf: Uint8Array, valueInfo: Field): Uint8Array {
  const openName = (d: Field) => {
    for (const v of fields(buf, d.data, d.end)) if (v.no === DIM_VALUE && v.wire === VARINT) return OPEN_LENGTHS.get(v.value);
    return undefined;
  };
  return rewrite(buf, valueInfo, (type) =>
    type.no !== VALUE_INFO_TYPE || type.wire !== BYTES
      ? null
      : [
          rewrite(buf, type, (tensor) =>
            tensor.no !== TYPE_TENSOR || tensor.wire !== BYTES
              ? null
              : [
                  rewrite(buf, tensor, (shape) =>
                    shape.no !== TENSOR_TYPE_SHAPE || shape.wire !== BYTES
                      ? null
                      : [
                          rewrite(buf, shape, (dim) => {
                            const name = dim.no === SHAPE_DIM && dim.wire === BYTES ? openName(dim) : undefined;
                            return name ? [bytesField(SHAPE_DIM, stringField(DIM_PARAM, name))] : null;
                          }),
                        ],
                  ),
                ],
          ),
        ],
  );
}

/**
 * The encoder model `model` (the bytes of an .onnx file), rewritten to take any length of audio up to
 * 30 s (see above). A model rewritten before is returned as it is. Throws if the graph is not laid out
 * as a Whisper encoder's.
 */
export function openEncoderWindow(model: Uint8Array): Uint8Array {
  const graph = [...fields(model, 0, model.length)].find((f) => f.no === MODEL_GRAPH && f.wire === BYTES);
  if (!graph) throw new Error("Not an ONNX model");

  const tables = new Set<string>();
  const nodes: { field: Field; op: string; inputs: string[]; outputs: string[] }[] = [];
  for (const f of fields(model, graph.data, graph.end)) {
    if (f.wire !== BYTES) continue;
    if (f.no === GRAPH_INITIALIZER) {
      const t = tensorHead(model, f);
      if (t.dims.length === 2 && t.dims[0] === MAX_POSITIONS) tables.add(t.name);
    } else if (f.no === GRAPH_NODE) nodes.push({ field: f, ...nodeHead(model, f) });
  }
  if (nodes.some((n) => n.outputs.includes(SLICED))) return model;
  const add = nodes.find((n) => n.op === "Add" && n.inputs.length === 2 && n.inputs.some((i) => tables.has(i)));
  if (!add) throw new Error("No position embeddings found in this encoder");
  const table = add.inputs.find((i) => tables.has(i))!;
  const frames = add.inputs.find((i) => i !== table)!;

  // positions = table[0 : frames.shape[1]], computed in the graph.
  const slicing = [
    nodeField("Shape", [frames], ["iqra_shape"], "iqra/shape"),
    nodeField("Slice", ["iqra_shape", "iqra_one", "iqra_two", "iqra_zero"], ["iqra_length"], "iqra/length"),
    nodeField("Slice", [table, "iqra_zero", "iqra_length", "iqra_zero"], [SLICED], "iqra/positions"),
  ];
  const parts = rebuild(model, graph.data, graph.end, (f) => {
    if (f.wire !== BYTES) return null;
    if (f.no === GRAPH_NODE && f.start === add.field.start) {
      // Nodes in an ONNX graph come in topological order: the slicing goes just before the addition.
      return [...slicing, rewrite(model, f, (i) => (i.no === NODE_INPUT && i.wire === BYTES && text(model, i) === table ? [stringField(NODE_INPUT, SLICED)] : null))];
    }
    if (f.no === GRAPH_INPUT || f.no === GRAPH_OUTPUT || f.no === GRAPH_VALUE_INFO) return [openDimensions(model, f)];
    return null;
  });
  parts.push(int64Field("iqra_zero", 0), int64Field("iqra_one", 1), int64Field("iqra_two", 2));

  const graphLength = parts.reduce((sum, p) => sum + p.length, 0);
  const key = Uint8Array.from([...varint(MODEL_GRAPH * 8 + BYTES), ...varint(graphLength)]);
  return concat([model.subarray(0, graph.start), key, ...parts, model.subarray(graph.end)]);
}

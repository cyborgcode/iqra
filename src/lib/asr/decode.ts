/**
 * Greedy decoding of one phrase with Whisper (Transformers.js), made fast for live transcription:
 *
 * - The audio goes in a window of its own length plus some silence rather than in 30 s (see
 *   encoder-window.ts), and a loop is cut off as soon as it starts (see loops.ts).
 * - A draft can be given: the tokens of the same phrase transcribed a moment before, when it was
 *   shorter (a live phrase is transcribed again each time it grows). Decoding goes token by token,
 *   one run of the decoder each; the draft is instead checked in a single run, which gives the
 *   model's choice after every one of its tokens. Where the model agrees, the draft's tokens are what
 *   decoding would have produced; from the first token where it disagrees, decoding goes on as usual,
 *   from the state the check computed. So the text is the same as without a draft (but where two
 *   tokens score nearly alike, as rounding differs between the two ways), and transcribing a growing
 *   phrase again costs about as much as its new words.
 */
import { DynamicCache, LogitsProcessor, LogitsProcessorList, Tensor, type PreTrainedTokenizer, type Processor, type WhisperForConditionalGeneration } from "@huggingface/transformers";
import { LoopDetector } from "./loops";

export interface Whisper {
  whisper: WhisperForConditionalGeneration;
  tokenizer: PreTrainedTokenizer;
  processor: Processor;
}

export interface DecodeOptions {
  /** The window to transcribe the audio in, in samples: the audio is padded with silence to fill it. */
  window: number;
  /** The most tokens to produce. */
  maxTokens: number;
  /** Whether to cut off a loop. */
  guard: boolean;
  /** The tokens of an earlier transcription of the same phrase (see `Transcription.tokens`). */
  draft?: readonly bigint[] | null;
}

export interface Transcription {
  text: string;
  /** The tokens of the text (without Whisper's prompt): a draft for transcribing the phrase again. */
  tokens: bigint[];
  /** Whether decoding was stopped because the transcription went round in a loop. */
  looped: boolean;
  /** How many tokens of the draft were kept. */
  drafted: number;
}

interface GenerationSettings {
  decoder_start_token_id: number;
  eos_token_id: number | number[];
  lang_to_id: Record<string, number>;
  task_to_id: Record<string, number>;
  no_timestamps_token_id: number;
  suppress_tokens?: number[] | null;
  begin_suppress_tokens?: number[] | null;
}

function settingsOf(whisper: WhisperForConditionalGeneration): GenerationSettings {
  const config = whisper.generation_config as unknown as GenerationSettings | null;
  if (!config) throw new Error("The model has no generation settings");
  return config;
}

const endToken = (s: GenerationSettings) => (Array.isArray(s.eos_token_id) ? s.eos_token_id[0]! : s.eos_token_id);

/** Whisper's prompt: start, Arabic, transcribe, no timestamps. */
function promptOf(s: GenerationSettings): bigint[] {
  const arabic = s.lang_to_id["<|ar|>"];
  const transcribe = s.task_to_id.transcribe;
  if (arabic === undefined || transcribe === undefined) throw new Error("The model cannot transcribe Arabic");
  return [s.decoder_start_token_id, arabic, transcribe, s.no_timestamps_token_id].map(BigInt);
}

/** Ends decoding as soon as the transcription goes round in a loop. */
class LoopGuard extends LogitsProcessor {
  constructor(
    private readonly loops: LoopDetector,
    private readonly end: number,
  ) {
    super();
  }

  _call(inputIds: bigint[][], logits: Tensor): Tensor {
    if (this.loops.push(inputIds[0] ?? [])) {
      const scores = logits.data as Float32Array;
      scores.fill(-Infinity);
      scores[this.end] = 0;
    }
    return logits;
  }
}

/** The encoder's output for the audio features (the encoder alone, as generation runs it). */
async function encode(whisper: WhisperForConditionalGeneration, features: Tensor): Promise<Tensor> {
  const session = (whisper as unknown as { sessions: Record<string, { run(feeds: Record<string, unknown>): Promise<Record<string, unknown>> }> }).sessions.model;
  if (!session) throw new Error("The model has no encoder");
  const out = await session.run({ input_features: (features as unknown as { ort_tensor: unknown }).ort_tensor });
  return new Tensor(out.last_hidden_state as never);
}

/**
 * Checks `draft` in one run of the decoder after `prompt`. Returns how many of its tokens the model
 * agrees with, the token it chooses after those (the end of the text, possibly), and its state
 * (keys and values) for the prompt and those tokens but the last, to go on from.
 */
async function check(
  whisper: WhisperForConditionalGeneration,
  s: GenerationSettings,
  encoded: Tensor,
  prompt: readonly bigint[],
  draft: readonly bigint[],
): Promise<{ agreed: number; next: number; cache: DynamicCache }> {
  const ids = [...prompt, ...draft];
  const out = (await whisper.forward({
    encoder_outputs: encoded,
    decoder_input_ids: new Tensor("int64", BigInt64Array.from(ids), [1, ids.length]),
  })) as Record<string, Tensor>;
  const logits = out.logits!;
  const vocab = logits.dims.at(-1)!;
  const scores = logits.data as Float32Array;
  // The same choice as greedy decoding: some tokens are never chosen, some never first.
  const never = new Uint8Array(vocab);
  for (const t of s.suppress_tokens ?? []) never[t] = 1;
  const notFirst = new Uint8Array(vocab);
  for (const t of s.begin_suppress_tokens ?? []) notFirst[t] = 1;
  const choice = (position: number, first: boolean) => {
    let best = 0;
    let bestScore = -Infinity;
    const base = position * vocab;
    for (let t = 0; t < vocab; t++) {
      if (never[t] || (first && notFirst[t])) continue;
      const v = scores[base + t]!;
      if (v > bestScore) {
        bestScore = v;
        best = t;
      }
    }
    return best;
  };
  // The scores at position i choose the token at i + 1.
  let agreed = 0;
  while (agreed < draft.length && BigInt(choice(prompt.length - 1 + agreed, agreed === 0)) === draft[agreed]) agreed++;
  const next = choice(prompt.length - 1 + agreed, agreed === 0);
  // Keys and values up to the last agreed token, which decoding is then given again as its input.
  const kept = prompt.length + agreed - 1;
  const entries: Record<string, Tensor> = {};
  for (const [name, tensor] of Object.entries(out)) {
    if (!name.startsWith("present")) continue;
    const pastName = name.replace("present", "past_key_values");
    entries[pastName] = name.includes(".decoder.") ? tensor.slice(null, null, [0, kept], null) : tensor;
  }
  return { agreed, next, cache: new DynamicCache(entries) };
}

/** Transcribes one phrase (16 kHz mono); see above. */
export async function transcribePhrase({ whisper, tokenizer, processor }: Whisper, audio: Float32Array, options: DecodeOptions): Promise<Transcription> {
  const s = settingsOf(whisper);
  const end = endToken(s);
  const prompt = promptOf(s);
  const { input_features } = (await processor.feature_extractor!(audio, { max_length: options.window })) as { input_features: Tensor };
  const loops = new LoopDetector();
  const logits_processor = new LogitsProcessorList();
  if (options.guard) logits_processor.push(new LoopGuard(loops, end));

  let ids: bigint[];
  let drafted = 0;
  const draft = options.draft?.slice(0, options.maxTokens) ?? [];
  if (draft.length > 0) {
    const encoded = await encode(whisper, input_features);
    const { agreed, next, cache } = await check(whisper, s, encoded, prompt, draft);
    drafted = agreed;
    const prefix = [...prompt, ...draft.slice(0, agreed)];
    if (next === end || agreed >= options.maxTokens) ids = prefix;
    else {
      // Generation only takes the inputs it lists, and would otherwise run the encoder again.
      if (!whisper.forward_params.includes("encoder_outputs")) whisper.forward_params.push("encoder_outputs");
      const output = (await whisper.generate({
        inputs: input_features,
        encoder_outputs: encoded,
        decoder_input_ids: [prefix],
        past_key_values: cache,
        max_new_tokens: options.maxTokens - agreed,
        logits_processor,
      } as unknown as Parameters<typeof whisper.generate>[0])) as Tensor;
      ids = (output.tolist() as bigint[][])[0] ?? [];
    }
  } else {
    const output = (await whisper.generate({
      inputs: input_features,
      language: "arabic",
      task: "transcribe",
      max_new_tokens: options.maxTokens,
      logits_processor,
    } as unknown as Parameters<typeof whisper.generate>[0])) as Tensor;
    ids = (output.tolist() as bigint[][])[0] ?? [];
  }

  const decode = (tokens: bigint[]) => tokenizer.decode(tokens, { skip_special_tokens: true }).trim();
  const isText = (t: bigint) => t < BigInt(end);
  if (loops.start < 0) {
    const tokens = ids.slice(prompt.length).filter(isText);
    return { text: decode(tokens), tokens, looped: false, drafted };
  }
  const tokens = ids.slice(prompt.length, loops.start).filter(isText);
  let text = decode(tokens);
  // A repeat that starts over has a space before its first word, which makes that first token differ:
  // the loop is found from the token after, and the word that token is part of goes too.
  if (!tokenizer.decode([ids[loops.start]!], { skip_special_tokens: true }).startsWith(" ")) {
    text = text.slice(0, Math.max(0, text.lastIndexOf(" ")));
  }
  return { text, tokens, looped: true, drafted };
}

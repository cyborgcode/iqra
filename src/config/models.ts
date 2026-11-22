/**
 * Speech models, loaded at run time from the Hugging Face Hub (never bundled with the site),
 * pinned to exact commits so the files cannot change under the app.
 *
 * Both are ONNX builds of Tarteel AI's Quran fine-tunes of OpenAI Whisper (Apache-2.0); see
 * the README for how they were converted.
 */

export type ModelId = "standard" | "accurate";

export interface ModelFile {
  path: string;
  bytes: number;
}

export interface ModelConfig {
  id: ModelId;
  repo: string;
  revision: string;
  /** The original checkpoint this ONNX build was converted from. */
  source: string;
  /** Precision per graph, in Transformers.js terms. */
  dtype: Record<string, "fp32" | "q8">;
  /** Whether the encoder may run on WebGPU (fp32 graphs only; int8 kernels are WebAssembly-only). */
  webgpuEncoder: boolean;
  /** Every file the app downloads for this model, with its exact size. */
  files: readonly ModelFile[];
}

const SHARED_FILES: readonly ModelFile[] = [
  { path: "config.json", bytes: 1219 },
  { path: "preprocessor_config.json", bytes: 356 },
  { path: "tokenizer.json", bytes: 3653235 },
];

export const MODELS: Readonly<Record<ModelId, ModelConfig>> = {
  standard: {
    id: "standard",
    repo: "Rayen0/whisper-tiny-ar-quran-onnx",
    revision: "18a78cb0c5761db47bbf1e05d32d41fba22b7181",
    source: "tarteel-ai/whisper-tiny-ar-quran",
    dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
    webgpuEncoder: true,
    files: [
      ...SHARED_FILES,
      { path: "generation_config.json", bytes: 3747 },
      { path: "tokenizer_config.json", bytes: 20525 },
      { path: "onnx/encoder_model.onnx", bytes: 32878338 },
      { path: "onnx/decoder_model_merged_quantized.onnx", bytes: 30104269 },
    ],
  },
  accurate: {
    id: "accurate",
    repo: "Rayen0/whisper-base-ar-quran-onnx",
    revision: "5bd7cf8f87512f0f951b0a03b485ff1bb895cc23",
    source: "tarteel-ai/whisper-base-ar-quran",
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
    webgpuEncoder: false,
    files: [
      ...SHARED_FILES,
      { path: "generation_config.json", bytes: 3807 },
      { path: "tokenizer_config.json", bytes: 20524 },
      { path: "onnx/encoder_model_quantized.onnx", bytes: 23160979 },
      { path: "onnx/decoder_model_merged_quantized.onnx", bytes: 52854766 },
    ],
  },
};

export const HUB = "https://huggingface.co";

export function fileUrl(model: ModelConfig, path: string): string {
  return `${HUB}/${model.repo}/resolve/${model.revision}/${path}`;
}

export function modelBytes(model: ModelConfig): number {
  return model.files.reduce((sum, f) => sum + f.bytes, 0);
}

/**
 * The ONNX Runtime WebAssembly engine, served from this site (no third-party CDN). The build with
 * WebGPU support is only fetched by browsers that have WebGPU. Filled in by vite.config.ts.
 */
export const RUNTIME: {
  version: string;
  base: string;
  webgpu: { mjs: string; wasm: string; bytes: number };
  wasm: { mjs: string; wasm: string; bytes: number };
} = __ORT_RUNTIME__;

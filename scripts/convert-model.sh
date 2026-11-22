#!/usr/bin/env bash
# Converts Tarteel AI's Quran fine-tunes of Whisper to ONNX for Transformers.js, and optionally uploads
# them to a Hugging Face account. This is how the models used by the app were made.
#
# Requirements: Python 3.10+ and about 4 GB of disk for PyTorch. Run from an empty working directory:
#   python3 -m venv .venv && source .venv/bin/activate
#   pip install "optimum-onnx[onnxruntime]==0.1.0" torch
#   bash /path/to/iqra/scripts/convert-model.sh                 # convert only
#   HF_REPO_OWNER=your-hf-username bash /path/to/convert-model.sh --upload
#
# Tested with optimum-onnx 0.1.0, optimum 2.1.0, transformers 4.57.6, torch 2.15.0, onnxruntime 1.32.0.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPLOAD="${1:-}"

convert() {
  local size="$1" quantize_encoder="$2"
  local src="tarteel-ai/whisper-${size}-ar-quran"
  local out="whisper-${size}-ar-quran-onnx"

  # 1. Export: encoder + decoder with KV cache, merged into one decoder graph.
  optimum-cli export onnx --model "$src" --task automatic-speech-recognition-with-past "export-${size}"

  # 2. Dynamic int8 quantization of every graph (we then pick which ones to ship).
  optimum-cli onnxruntime quantize --onnx_model "export-${size}" --avx512 -o "quant-${size}"

  # 3. Transformers.js layout: configs and tokenizer at the root, graphs in onnx/.
  rm -rf "$out" && mkdir -p "$out/onnx"
  cp "export-${size}"/*.json "export-${size}/merges.txt" "$out/"
  if [ "$quantize_encoder" = yes ]; then
    cp "quant-${size}/encoder_model_quantized.onnx" "$out/onnx/"
  else
    # tiny: an int8 encoder made the model skip and invent words in testing, so it stays fp32
    cp "export-${size}/encoder_model.onnx" "$out/onnx/"
  fi
  cp "quant-${size}/decoder_model_merged_quantized.onnx" "$out/onnx/"

  # 4. The exporter writes a bare generation config without the multilingual language/task tokens
  #    (Transformers.js then refuses language: "arabic"); use the matching OpenAI checkpoint's.
  hf download "openai/whisper-${size}" generation_config.json --local-dir "gen-${size}"
  cp "gen-${size}/generation_config.json" "$out/"

  # 5. Model card (states the changes, as Apache-2.0 section 4(b) requires) and the license text.
  cp "$HERE/model-cards/${out}.md" "$out/README.md"
  cp "$HERE/public/licenses/Apache-2.0.txt" "$out/LICENSE"

  if [ "$UPLOAD" = "--upload" ]; then
    : "${HF_REPO_OWNER:?set HF_REPO_OWNER to your Hugging Face user name}"
    hf upload "${HF_REPO_OWNER}/${out}" "$out" . --commit-message "Add ONNX build of ${src}"
  fi
}

convert tiny no   # fp32 encoder (33 MB) + int8 decoder (30 MB)
convert base yes  # int8 encoder (23 MB) + int8 decoder (53 MB)

echo "Done. After uploading, put each repo's commit hash in src/config/models.ts."

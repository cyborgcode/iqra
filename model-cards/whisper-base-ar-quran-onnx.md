---
license: apache-2.0
base_model: tarteel-ai/whisper-base-ar-quran
library_name: transformers.js
pipeline_tag: automatic-speech-recognition
language:
- ar
tags:
- whisper
- quran
- onnx
---

# whisper-base-ar-quran-onnx

ONNX build of [tarteel-ai/whisper-base-ar-quran](https://huggingface.co/tarteel-ai/whisper-base-ar-quran)
(a fine-tune of [openai/whisper-base](https://huggingface.co/openai/whisper-base) on Qur'an recitation),
for speech recognition that runs entirely in the browser with
[Transformers.js](https://github.com/huggingface/transformers.js). It is used by iqra, a free,
non-commercial Qur'an recitation practice app in which audio never leaves the device.

## Files

| File | Precision |
| --- | --- |
| `onnx/encoder_model_quantized.onnx` | int8 (dynamic quantization) |
| `onnx/decoder_model_merged_quantized.onnx` | int8 (dynamic quantization) |

The tokenizer and configuration files are those of the original checkpoint.

## Usage

```js
import { pipeline } from "@huggingface/transformers";

const transcriber = await pipeline(
  "automatic-speech-recognition",
  "Rayen0/whisper-base-ar-quran-onnx",
  { dtype: "q8" },
);
const { text } = await transcriber(audio16kHzMonoFloat32, { language: "arabic", task: "transcribe" });
```

The model outputs fully diacritized Arabic in standard (Imla'i) spelling, not Uthmani script.

## Changes made to the original work

As required by section 4(b) of the Apache License 2.0, the modifications are stated here:

1. **Exported to ONNX** from the original PyTorch weights with Hugging Face Optimum
   (optimum-onnx 0.1.0, transformers 4.57.6, torch 2.15.0):
   `optimum-cli export onnx --model tarteel-ai/whisper-base-ar-quran --task automatic-speech-recognition-with-past`.
   No training or fine-tuning was done.
2. **Quantized** with `optimum-cli onnxruntime quantize --avx512` (dynamic, per-tensor int8 weights,
   onnxruntime 1.32.0). Both the encoder and the decoder are quantized.
3. **`generation_config.json`** is taken from [openai/whisper-base](https://huggingface.co/openai/whisper-base),
   because the fine-tuned repository ships none and the exporter's default omits the
   multilingual language and task tokens needed to request Arabic transcription.

## Validation

With Transformers.js 4.3.2 (Node.js, CPU), the transcripts of 45 recitations (four reciters) were identical, diacritics included, to those of the original PyTorch checkpoint.

## License and attribution

Apache License 2.0, inherited from [tarteel-ai/whisper-base-ar-quran](https://huggingface.co/tarteel-ai/whisper-base-ar-quran)
by Tarteel AI and [openai/whisper-base](https://huggingface.co/openai/whisper-base) by OpenAI.
The full license text is in [`LICENSE`](LICENSE). All credit for the model goes to its original authors;
see the original model card for training details and limitations.

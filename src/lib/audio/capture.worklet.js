// AudioWorklet processor: turns microphone input into 16 kHz mono Float32 chunks.
// The input is low-pass filtered before it reaches this node, so linear interpolation is enough here.
// Audio stays in the browser: chunks go only to the page that owns this worklet.

const TARGET_RATE = 16000;
const CHUNK = 1600; // 100 ms at 16 kHz

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE; // input samples per output sample
    this.t = 0; // position of the next output sample, in input samples relative to the current block
    this.last = 0; // last input sample of the previous block
    this.buffer = new Float32Array(CHUNK);
    this.filled = 0;
    this.sumSquares = 0;
    this.levelCount = 0;
    this.port.onmessage = (event) => {
      if (event.data === "flush") {
        this.post();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  post() {
    if (this.filled === 0) return;
    const samples = this.buffer.slice(0, this.filled);
    this.port.postMessage({ type: "samples", samples }, [samples.buffer]);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    const frames = input[0].length;
    let mono = input[0];
    if (input.length > 1) {
      mono = new Float32Array(frames);
      for (const channel of input) for (let i = 0; i < frames; i++) mono[i] += channel[i] / input.length;
    }

    for (let i = 0; i < frames; i++) this.sumSquares += mono[i] * mono[i];
    this.levelCount += frames;
    if (this.levelCount >= sampleRate / 20) {
      this.port.postMessage({ type: "level", rms: Math.sqrt(this.sumSquares / this.levelCount) });
      this.sumSquares = 0;
      this.levelCount = 0;
    }

    while (this.t < frames - 1) {
      const i = Math.floor(this.t);
      const frac = this.t - i;
      const a = i < 0 ? this.last : mono[i];
      const b = mono[i + 1];
      this.buffer[this.filled++] = a + (b - a) * frac;
      if (this.filled === CHUNK) this.post();
      this.t += this.ratio;
    }
    this.t -= frames;
    this.last = mono[frames - 1];
    return true;
  }
}

registerProcessor("iqra-capture", CaptureProcessor);

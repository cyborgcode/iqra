// no-inline: keep the worklet a same-origin file (a data: URL would be blocked by the CSP).
import workletUrl from "./capture.worklet.js?url&no-inline";

/** Why recording could not start, for a clear message to the user. */
export type RecorderProblem =
  | "insecure-context" // getUserMedia needs HTTPS (or localhost)
  | "unsupported" // no getUserMedia / AudioWorklet in this browser
  | "denied" // the user (or a policy) blocked the microphone
  | "no-microphone" // no input device
  | "busy" // the device is in use by another app
  | "failed";

export class RecorderError extends Error {
  constructor(
    readonly problem: RecorderProblem,
    cause?: unknown,
  ) {
    super(problem, { cause });
  }
}

export interface Recording {
  /** 16 kHz mono samples. */
  samples: Float32Array;
  seconds: number;
}

export interface RecorderHandle {
  /** Everything recorded so far (a live view: valid until the next audio arrives). */
  samples(): Float32Array;
  /** Stops and returns everything recorded. */
  stop(): Promise<Recording>;
  /** Stops and discards the recording. */
  cancel(): void;
}

export interface RecorderOptions {
  /** Called about 20 times a second with the input level (RMS, 0–1). */
  onLevel?: (rms: number) => void;
  /** Called once if the recording reaches `maxSeconds` and stops on its own. */
  onLimit?: () => void;
  maxSeconds?: number;
}

export const SAMPLE_RATE = 16000;

/** Problems that can be detected before asking for the microphone. */
export function recorderSupport(): RecorderProblem | null {
  if (typeof window !== "undefined" && window.isSecureContext === false) return "insecure-context";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  if (typeof AudioWorkletNode === "undefined" || typeof AudioContext === "undefined") return "unsupported";
  return null;
}

function classify(error: unknown): RecorderProblem {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "no-microphone";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") return "busy";
  return "failed";
}

/**
 * Starts recording from the microphone. Audio is converted to 16 kHz mono Float32 as it arrives
 * and kept in memory on this device only.
 */
export async function startRecording(options: RecorderOptions = {}): Promise<RecorderHandle> {
  const problem = recorderSupport();
  if (problem) throw new RecorderError(problem);
  const maxSamples = Math.round((options.maxSeconds ?? 15 * 60) * SAMPLE_RATE);

  let stream: MediaStream;
  try {
    // The voice as it is: no echo cancelling, noise suppression or gain control, which phones apply for
    // calls. Gain control turns the room up in every pause and the voice down when it rises; Whisper
    // needs neither, and the pauses that cut the recitation into phrases are clearer without it.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (error) {
    throw new RecorderError(classify(error), error);
  }

  // At the microphone's own rate, so the browser does not resample it first (Safari and Firefox have
  // done so poorly, or refused); the worklet brings it to 16 kHz.
  const micRate = stream.getAudioTracks()[0]?.getSettings().sampleRate;
  let context: AudioContext;
  try {
    context = micRate ? new AudioContext({ sampleRate: micRate }) : new AudioContext();
  } catch {
    context = new AudioContext();
  }
  const release = () => {
    stream.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => {});
  };

  let node: AudioWorkletNode;
  try {
    await context.audioWorklet.addModule(workletUrl);
    if (context.state === "suspended") await context.resume();
    const source = context.createMediaStreamSource(stream);
    // Two 2nd-order low-pass filters (24 dB/octave) keep content above 8 kHz from aliasing at 16 kHz.
    const lowpass1 = new BiquadFilterNode(context, { type: "lowpass", frequency: 7200, Q: Math.SQRT1_2 });
    const lowpass2 = new BiquadFilterNode(context, { type: "lowpass", frequency: 7200, Q: Math.SQRT1_2 });
    node = new AudioWorkletNode(context, "iqra-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
    const mute = new GainNode(context, { gain: 0 }); // keeps the graph running without playing anything back
    source.connect(lowpass1).connect(lowpass2).connect(node).connect(mute).connect(context.destination);
  } catch (error) {
    release();
    throw new RecorderError("failed", error);
  }

  // One growing buffer (doubling capacity), so the live view needs no copying.
  let buffer = new Float32Array(SAMPLE_RATE * 30);
  let total = 0;
  let stopped = false;
  let limitReached: (() => void) | null = null;
  let flushed: (() => void) | null = null;

  node.port.onmessage = (event: MessageEvent<{ type: string; samples?: Float32Array; rms?: number }>) => {
    const { data } = event;
    if (data.type === "samples" && data.samples && !stopped && total < maxSamples) {
      const chunk = data.samples.subarray(0, maxSamples - total);
      if (total + chunk.length > buffer.length) {
        const grown = new Float32Array(Math.min(maxSamples, Math.max(buffer.length * 2, total + chunk.length)));
        grown.set(buffer.subarray(0, total));
        buffer = grown;
      }
      buffer.set(chunk, total);
      total += chunk.length;
      if (total >= maxSamples && limitReached) limitReached();
    } else if (data.type === "level" && data.rms !== undefined) {
      options.onLevel?.(data.rms);
    } else if (data.type === "flushed") {
      flushed?.();
    }
  };

  const collect = (): Recording => {
    const samples = buffer.slice(0, total);
    return { samples, seconds: samples.length / SAMPLE_RATE };
  };

  const stop = async (): Promise<Recording> => {
    if (!stopped) {
      // Ask the worklet for its last partial chunk, then shut everything down.
      await new Promise<void>((resolve) => {
        flushed = resolve;
        node.port.postMessage("flush");
        setTimeout(resolve, 300);
      });
      stopped = true;
      release();
    }
    return collect();
  };

  limitReached = () => {
    limitReached = null;
    options.onLimit?.();
  };

  return {
    samples: () => buffer.subarray(0, total),
    stop,
    cancel() {
      stopped = true;
      total = 0;
      release();
    },
  };
}

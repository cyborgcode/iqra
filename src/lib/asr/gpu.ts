/**
 * Whether the speech model may run on the graphics processor here: a real (not software) WebGPU adapter,
 * in a Chromium browser (Chrome, Edge, Samsung Internet, Opera…), where ONNX Runtime's WebGPU support
 * was tested. Safari (every browser on iPhone and iPad) and Firefox use WebAssembly, which gives the
 * same results as the tests and needs the lighter build of the engine.
 */
export function chromium(userAgent: string): boolean {
  return /\bChrome\/\d/.test(userAgent);
}

type Adapter = { info?: { isFallbackAdapter?: boolean }; isFallbackAdapter?: boolean };

export async function hasWebGPU(): Promise<boolean> {
  if (!chromium(navigator.userAgent)) return false;
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = (gpu ? await gpu.requestAdapter() : null) as Adapter | null;
    // Software ("fallback") adapters are much slower than WebAssembly.
    return !!adapter && !(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false);
  } catch {
    return false;
  }
}

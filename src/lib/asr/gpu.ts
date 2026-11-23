type Adapter = { info?: { isFallbackAdapter?: boolean }; isFallbackAdapter?: boolean };

/**
 * Whether the speech model may run its encoder on the graphics processor here: a real WebGPU adapter.
 * Software ("fallback") adapters are much slower than WebAssembly. On phones the graphics processor is
 * several times faster for the encoder, which reads a whole 30 s window on every request.
 */
export async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = (gpu ? await gpu.requestAdapter() : null) as Adapter | null;
    return !!adapter && !(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false);
  } catch {
    return false;
  }
}

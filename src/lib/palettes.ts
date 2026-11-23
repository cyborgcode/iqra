/**
 * Theme colours. Every palette is one hue (and a chroma scale) from which all of the interface's colours
 * are derived in OKLCH, in src/index.css, for both light and dark mode: changing `h` keeps lightness
 * and contrast the same. `hd` is the hue of the dark-mode sky, which can lean a little away from `h`.
 * The same numbers appear in index.css (`[data-palette="…"]`); a test keeps the two in step.
 */
export const PALETTES = [
  { id: "sky", h: 237, c: 1, hd: 258 },
  { id: "emerald", h: 162, c: 0.95, hd: 175 },
  { id: "sand", h: 68, c: 0.8, hd: 60 },
  { id: "lavender", h: 292, c: 0.95, hd: 285 },
  { id: "graphite", h: 255, c: 0.18, hd: 260 },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

export function isPalette(value: unknown): value is PaletteId {
  return PALETTES.some((p) => p.id === value);
}

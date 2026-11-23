import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { logoSvg } from "./logo";
import { PALETTES } from "./palettes";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const compact = (svg: string) => svg.replace(/>\s+</g, "><").trim();

/** An OKLCH colour as #rrggbb (sRGB, clipped), the way browsers paint it. */
function oklchHex(l: number, c: number, hue: number): string {
  const a = c * Math.cos((hue * Math.PI) / 180);
  const b = c * Math.sin((hue * Math.PI) / 180);
  const lms = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map((v) => v ** 3);
  const [L, M, S] = lms as [number, number, number];
  const linear = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  const srgb = linear.map((v) => Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
  return `#${srgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** The logo tile's two colours in the default palette, from index.css. */
function defaultTile(): [string, string] {
  const sky = PALETTES.find((p) => p.id === "sky")!;
  const css = read("src/index.css");
  const stop = (name: string) => {
    const m = css.match(new RegExp(`${name}: oklch\\(([\\d.]+) calc\\(([\\d.]+) \\* var\\(--c\\)\\) var\\(--h\\)\\);`));
    if (!m) throw new Error(`${name} not found in index.css`);
    return oklchHex(Number(m[1]), Number(m[2]) * sky.c, sky.h);
  };
  return [stop("--logo-a"), stop("--logo-b")];
}

describe("the logo", () => {
  it("is drawn the same in the static favicon, in the default bleu ciel, as at run time", () => {
    const [from, to] = defaultTile();
    expect(from).toBe("#78c7fd");
    expect(compact(read("public/favicon.svg"))).toBe(logoSvg(from, to));
  });

  it("is drawn the same in the app", () => {
    const icons = read("src/components/icons.tsx");
    const shapes = [...logoSvg("", "").matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
    expect(shapes.length).toBeGreaterThan(0);
    for (const d of shapes) expect(icons).toContain(`d="${d}"`);
  });
});

describe("the web app manifest", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
    start_url: string;
    display: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };

  it("opens the app on its own", () => {
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
  });

  it("lists icons that exist, at the sizes it says, including maskable ones", () => {
    for (const icon of manifest.icons) {
      const file = path.join(ROOT, "public", icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      if (icon.type !== "image/png") continue;
      const png = readFileSync(file);
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.src).toBe(icon.sizes);
    }
    const sizes = (purpose?: string) => manifest.icons.filter((i) => i.type === "image/png" && i.purpose === purpose).map((i) => i.sizes);
    expect(sizes()).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(sizes("maskable")).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("is linked from the page, with an icon for Apple devices", () => {
    const html = read("index.html");
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    const touch = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/)?.[1];
    expect(touch && existsSync(path.join(ROOT, "public", touch))).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PALETTES } from "./palettes";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const css = readFileSync(path.join(ROOT, "src/index.css"), "utf8");
const init = readFileSync(path.join(ROOT, "public/theme-init.js"), "utf8");

/** The --h, --c and --hd a palette gets in index.css (the default is set on :root itself). */
function cssPalette(id: string) {
  const block = id === "sky" ? css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {"))) : (css.match(new RegExp(`:root\\[data-palette="${id}"\\] \\{([^}]*)\\}`))?.[1] ?? "");
  const value = (name: string) => Number(block.match(new RegExp(`${name}: ([\\d.]+);`))?.[1]);
  return { h: value("--h"), c: value("--c"), hd: value("--hd") };
}

describe("theme colours", () => {
  it("are defined with the same hue and chroma in the stylesheet and the settings", () => {
    for (const p of PALETTES) expect(cssPalette(p.id), p.id).toEqual({ h: p.h, c: p.c, hd: p.hd });
  });

  it("are all known to the script that applies them before the first paint", () => {
    for (const p of PALETTES) expect(init).toContain(`"${p.id}"`);
  });
});

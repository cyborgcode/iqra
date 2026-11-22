// Writes public/licenses/: license texts for the model weights (Apache-2.0), the Quran font (OFL-1.1)
// and every third-party package that ships in the browser bundle. Run after changing dependencies:
//   node scripts/build-licenses.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./quran-source.mjs";

const OUT = path.join(ROOT, "public", "licenses");
const NM = path.join(ROOT, "node_modules");

/** Packages whose code or assets end up in the deployed site. */
const BUNDLED = [
  "react",
  "react-dom",
  "scheduler",
  "glisse",
  "@huggingface/transformers",
  "@huggingface/jinja",
  "@huggingface/tokenizers",
  "onnxruntime-web",
  "onnxruntime-common",
  "@fontsource/amiri-quran",
  "tailwindcss",
];

function licenseFile(dir) {
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "LICENCE"]) {
    const file = path.join(dir, name);
    if (existsSync(file)) return file;
  }
  return null;
}

function licenseText(dir) {
  const file = licenseFile(dir);
  return file ? readFileSync(file, "utf8").trim() : null;
}

mkdirSync(OUT, { recursive: true });

// The canonical Apache License 2.0 text (as shipped by Transformers.js), byte for byte.
writeFileSync(path.join(OUT, "Apache-2.0.txt"), readFileSync(licenseFile(path.join(NM, "@huggingface/transformers"))));

// Amiri Quran: copyright line and SIL Open Font License 1.1, as shipped with the font, byte for byte.
writeFileSync(path.join(OUT, "OFL-1.1-Amiri.txt"), readFileSync(licenseFile(path.join(NM, "@fontsource/amiri-quran"))));

const sections = BUNDLED.map((name) => {
  const dir = path.join(NM, name);
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const text = licenseText(dir) ?? `License: ${pkg.license} (no license file in the package)`;
  return [`${pkg.name} ${pkg.version} (${pkg.license})`, pkg.homepage ?? "", "", text].join("\n");
});

const header = `Third-party software in iqra
============================

iqra's web pages include the packages listed below. Each one's license follows.
The speech models (Apache-2.0) and the Quran font (SIL OFL 1.1) have their own files
in this folder; the Quran text is credited on the About page (Tanzil Project, CC BY 3.0).
`;
writeFileSync(path.join(OUT, "THIRD-PARTY.txt"), `${header}\n${sections.map((s) => `${"-".repeat(72)}\n${s}`).join("\n\n")}\n`);
console.log(`Wrote licenses for ${BUNDLED.length} packages to public/licenses/`);

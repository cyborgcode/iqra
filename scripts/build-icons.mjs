// Draws the app icons in public/icons from public/favicon.svg, the logo in its default bleu ciel:
// - the logo as it is, for browsers and desktops;
// - full squares for home screens that cut their own shape: Android's maskable icons (cropped to a
//   circle or squircle inside the middle 80%, so the Mushaf is drawn smaller) and the Apple touch icon
//   (iOS rounds the corners itself and would fill transparent ones with black).
//
// Run it after changing the logo: npm run icons
// Chromium (through Playwright) draws the SVG; the PNGs are encoded here, compactly.
// It needs Playwright: npm i -g playwright && npx playwright install chromium
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public/icons");
const logo = readFileSync(path.join(ROOT, "public/favicon.svg"), "utf8");

function replaceOnce(text, from, to) {
  const parts = text.split(from);
  if (parts.length !== 2) throw new Error(`Expected exactly one "${from}" in public/favicon.svg`);
  return parts.join(to);
}

/** The logo on a full square, its Mushaf drawn at `scale` (the favicon's is 1.2). */
function square(scale) {
  return replaceOnce(replaceOnce(logo, ' rx="15"', ""), "scale(1.2)", `scale(${scale})`);
}

const ICONS = [
  { file: "icon-192.png", size: 192, svg: logo },
  { file: "icon-512.png", size: 512, svg: logo },
  { file: "maskable-192.png", size: 192, svg: square(1) },
  { file: "maskable-512.png", size: 512, svg: square(1) },
  { file: "apple-touch-icon.png", size: 180, svg: square(1.2) },
];

/** One row of a PNG image, filtered with PNG filter `type` (0 none, 1 sub, 2 up, 3 average, 4 Paeth). */
function filterRow(type, row, prev, bpp) {
  const out = Buffer.alloc(row.length);
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    let p = 0;
    if (type === 1) p = a;
    else if (type === 2) p = b;
    else if (type === 3) p = (a + b) >> 1;
    else if (type === 4) {
      const pa = Math.abs(b - c);
      const pb = Math.abs(a - c);
      const pc = Math.abs(a + b - 2 * c);
      p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[i] = (row[i] - p) & 0xff;
  }
  return out;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A PNG of RGBA pixels: RGB when every pixel is opaque, each row with the filter that suits it best. */
function encodePng(size, rgba) {
  const opaque = rgba.every((v, i) => i % 4 !== 3 || v === 255);
  const bpp = opaque ? 3 : 4;
  const stride = size * bpp;
  const rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < size; x++) for (let c = 0; c < bpp; c++) row[x * bpp + c] = rgba[(y * size + x) * 4 + c];
    let best = null;
    for (let type = 0; type <= 4; type++) {
      const filtered = filterRow(type, row, prev, bpp);
      const cost = filtered.reduce((sum, v) => sum + (v < 128 ? v : 256 - v), 0);
      if (!best || cost < best.cost) best = { type, filtered, cost };
    }
    rows.push(Buffer.from([best.type]), best.filtered);
    prev = row;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = opaque ? 2 : 6; // RGB or RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.error("This script needs Playwright: npm i -g playwright && npx playwright install chromium");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, svg } of ICONS) {
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  // Runs in the browser: draws the SVG at the icon's size and reads back its pixels.
  const pixels = await page.evaluate(
    async ([src, size]) => {
      /* global document, Image */
      const img = new Image(size, size);
      img.src = src;
      await img.decode();
      const ctx = Object.assign(document.createElement("canvas"), { width: size, height: size }).getContext("2d");
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let text = "";
      for (let i = 0; i < data.length; i += 0x8000) text += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return btoa(text);
    },
    [src, size],
  );
  writeFileSync(path.join(OUT, file), encodePng(size, Buffer.from(pixels, "base64")));
  console.log(`public/icons/${file}`);
}
await browser.close();

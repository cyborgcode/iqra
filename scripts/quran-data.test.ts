import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOutputs } from "./build-quran-data.mjs";
import { ROOT, readCopyrightBlock, readQuranTxt, readQuranXml } from "./quran-source.mjs";
import { SURAHS } from "../src/data/surahs";

interface SurahFile {
  copyright: string[];
  surah: number;
  bismillah: string | null;
  ayahs: string[];
}

const xmlText = readFileSync(path.join(ROOT, "data/tanzil/quran-uthmani.xml"), "utf8");
const xml = readQuranXml(xmlText);

function committed(n: number): SurahFile {
  return JSON.parse(readFileSync(path.join(ROOT, `public/quran/${String(n).padStart(3, "0")}.json`), "utf8"));
}

describe("Quran data", () => {
  it("committed files are exactly what the generator produces", () => {
    for (const [rel, content] of buildOutputs()) {
      expect(readFileSync(path.join(ROOT, rel), "utf8"), rel).toBe(content);
    }
  });

  it("every ayah is byte-identical to Tanzil's XML", () => {
    let count = 0;
    for (const surah of xml.surahs) {
      const file = committed(surah.number);
      expect(file.ayahs).toHaveLength(surah.ayahs.length);
      file.ayahs.forEach((text, i) => {
        expect(Buffer.from(text, "utf8").equals(Buffer.from(surah.ayahs[i]!, "utf8"))).toBe(true);
        count++;
      });
      expect(file.bismillah).toBe(surah.bismillah);
    }
    expect(count).toBe(6236);
  });

  it("agrees with Tanzil's independent TXT export (which prefixes ayah 1 with the basmala)", () => {
    const txt = readQuranTxt();
    for (const surah of xml.surahs) {
      const file = committed(surah.number);
      file.ayahs.forEach((text, i) => {
        const expected = i === 0 && file.bismillah ? `${file.bismillah} ${text}` : text;
        expect(txt.get(`${surah.number}:${i + 1}`)).toBe(expected);
      });
    }
  });

  it("keeps Tanzil's copyright notice in every file", () => {
    const block = readCopyrightBlock(xmlText);
    expect(block.join("\n")).toContain("Copyright (C) 2007-2026 Tanzil Project");
    expect(block.join("\n")).toContain("CHANGING IT IS NOT ALLOWED");
    for (let n = 1; n <= 114; n++) expect(committed(n).copyright).toEqual(block);
  });

  it("has metadata for all 114 surahs that matches the text", () => {
    expect(SURAHS).toHaveLength(114);
    expect(SURAHS.reduce((sum, s) => sum + s.ayahs, 0)).toBe(6236);
    expect(SURAHS[0]).toMatchObject({ number: 1, name: "الفاتحة", transliteration: "Al-Faatiha", ayahs: 7 });
    SURAHS.forEach((s, i) => expect(committed(i + 1).ayahs).toHaveLength(s.ayahs));
  });

  it("has a basmala for every surah except Al-Fatiha (where it is ayah 1) and At-Tawba", () => {
    for (let n = 1; n <= 114; n++) {
      expect(committed(n).bismillah === null).toBe(n === 1 || n === 9);
    }
  });
});

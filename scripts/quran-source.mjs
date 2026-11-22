// Reads the Tanzil source files in data/tanzil/ without changing a single character.
// Shared by scripts/build-quran-data.mjs and the data tests.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TANZIL_DIR = path.join(ROOT, "data", "tanzil");

const ATTR = /([A-Za-z_]+)="([^"]*)"/g;

function attributes(tag) {
  const out = {};
  for (const [, key, value] of tag.matchAll(ATTR)) {
    if (value.includes("&")) {
      throw new Error(`Unexpected XML entity in ${key}="${value}"`);
    }
    out[key] = value;
  }
  return out;
}

/** The copyright block from the XML comment, line by line, exactly as published. */
export function readCopyrightBlock(xml) {
  const start = xml.indexOf("<!--");
  const end = xml.indexOf("-->");
  if (start < 0 || end < start) throw new Error("Tanzil copyright block not found");
  const lines = xml.slice(start + 4, end).split("\n").map((line) => line.replace(/\r$/, ""));
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

/** Surahs and ayahs from quran-uthmani.xml. Text values are returned verbatim. */
export function readQuranXml(xml = readFileSync(path.join(TANZIL_DIR, "quran-uthmani.xml"), "utf8")) {
  const surahs = [];
  for (const [, suraTag, body] of xml.matchAll(/<sura\s([^>]*)>([\s\S]*?)<\/sura>/g)) {
    const sura = attributes(suraTag);
    const ayahs = [];
    let bismillah = null;
    for (const [, ayaTag] of body.matchAll(/<aya\s([^>]*?)\/>/g)) {
      const aya = attributes(ayaTag);
      if (Number(aya.index) !== ayahs.length + 1) {
        throw new Error(`Surah ${sura.index}: ayah ${aya.index} out of order`);
      }
      if (aya.bismillah !== undefined) {
        if (aya.index !== "1") throw new Error(`Surah ${sura.index}: bismillah on ayah ${aya.index}`);
        bismillah = aya.bismillah;
      }
      ayahs.push(aya.text);
    }
    surahs.push({ number: Number(sura.index), name: sura.name, bismillah, ayahs });
  }
  return { copyright: readCopyrightBlock(xml), surahs };
}

/** Surah metadata from quran-data.xml (names, transliteration, ayah counts). */
export function readMetadata(xml = readFileSync(path.join(TANZIL_DIR, "quran-data.xml"), "utf8")) {
  const suras = xml.slice(xml.indexOf("<suras"), xml.indexOf("</suras>"));
  const header = attributes(xml.match(/<quran\s([^>]*)>/)[1]);
  return {
    copyright: header.copyright,
    license: header.license,
    surahs: [...suras.matchAll(/<sura\s([^>]*?)\/>/g)].map(([, tag]) => {
      const a = attributes(tag);
      return {
        number: Number(a.index),
        name: a.name,
        transliteration: a.tname,
        translation: a.ename,
        ayahs: Number(a.ayas),
        revelation: a.type,
      };
    }),
  };
}

/** Book divisions from quran-data.xml: Madani pages, juz, hizb quarters and sajdas, as [sura, aya] starts. */
export function readDivisions(xml = readFileSync(path.join(TANZIL_DIR, "quran-data.xml"), "utf8")) {
  const section = (tag) => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    if (!m) throw new Error(`quran-data.xml has no <${tag}>`);
    return [...m[1].matchAll(/<\w+\s([^>]*?)\/>/g)].map(([, tag2]) => attributes(tag2));
  };
  const starts = (tag) => section(tag).map((a) => [Number(a.sura), Number(a.aya)]);
  return {
    pages: starts("pages"),
    juzs: starts("juzs"),
    hizbQuarters: starts("hizbs"),
    sajdas: section("sajdas").map((a) => [Number(a.sura), Number(a.aya), a.type]),
  };
}

/** The "txt-2" export (sura|aya|text), used only to cross-check the XML. */
export function readQuranTxt(txt = readFileSync(path.join(TANZIL_DIR, "quran-uthmani.txt"), "utf8")) {
  const map = new Map();
  for (const line of txt.split("\n")) {
    const m = line.match(/^(\d+)\|(\d+)\|(.*)$/);
    if (m) map.set(`${m[1]}:${m[2]}`, m[3]);
  }
  return map;
}

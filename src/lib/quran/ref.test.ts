import { describe, expect, it } from "vitest";
import { asciiDigits, parseAyahRef } from "./ref";

describe("parseAyahRef", () => {
  it("reads surah:ayah in Latin or Arabic digits", () => {
    expect(parseAyahRef("2:255")).toEqual({ surah: 2, ayah: 255 });
    expect(parseAyahRef(" 2 255 ")).toEqual({ surah: 2, ayah: 255 });
    expect(parseAyahRef("\u0662:\u0662\u0665\u0665")).toEqual({ surah: 2, ayah: 255 });
    expect(parseAyahRef("36")).toEqual({ surah: 36, ayah: 1 });
    expect(parseAyahRef("114:6")).toEqual({ surah: 114, ayah: 6 });
  });

  it("rejects ayahs that do not exist", () => {
    expect(parseAyahRef("1:8")).toBeNull();
    expect(parseAyahRef("115")).toBeNull();
    expect(parseAyahRef("0:1")).toBeNull();
    expect(parseAyahRef("al-baqarah")).toBeNull();
  });

  it("converts Arabic-Indic and Persian digits", () => {
    expect(asciiDigits("\u0660\u0669\u06F4")).toBe("094");
  });
});

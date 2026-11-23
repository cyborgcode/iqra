// Rendering helpers are exercised in the browser; this checks the one rule the page relies on: the
// tokens it renders, glued or not, join back to Tanzil's exact ayah text.
import { describe, expect, it } from "vitest";
import { tokenizeAyah } from "../lib/quran/tokenize";
import { allAyahs } from "../test/quran";

describe("page tokens", () => {
  it("every pause mark follows a space, so it can be kept with the word before it", () => {
    let marks = 0;
    for (const { text } of allAyahs()) {
      const tokens = tokenizeAyah(text);
      tokens.forEach((t, i) => {
        if (t.kind !== "mark") return;
        marks++;
        // A mark is never the first token of an ayah and always comes right after a space.
        expect(i).toBeGreaterThan(0);
        expect(tokens[i - 1]!.kind).toBe("space");
      });
      expect(tokens.map((t) => t.text).join("")).toBe(text);
    }
    expect(marks).toBeGreaterThan(4000);
  });
});

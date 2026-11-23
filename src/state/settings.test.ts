import { afterEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_KEY, loadSettings, saveSettings } from "./settings";

function withStorage(saved: unknown) {
  const store = new Map<string, string>([[SETTINGS_KEY, JSON.stringify(saved)]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("settings", () => {
  it("open in AMOLED dark by default", () => {
    withStorage({});
    expect(loadSettings().theme).toBe("dark");
  });

  it("move the old default ('system', saved before version 2) to dark, and keep explicit choices", () => {
    withStorage({ theme: "system" });
    expect(loadSettings().theme).toBe("dark");
    withStorage({ theme: "light" });
    expect(loadSettings().theme).toBe("light");
    withStorage({ theme: "system", version: 2 });
    expect(loadSettings().theme).toBe("system");
  });

  it("remember a choice of 'system' made from now on", () => {
    const store = withStorage({});
    saveSettings({ ...loadSettings(), theme: "system" });
    expect(JSON.parse(store.get(SETTINGS_KEY)!)).toMatchObject({ theme: "system", version: 2 });
    expect(loadSettings().theme).toBe("system");
  });

  it("fall back to the sky palette for unknown values", () => {
    withStorage({ palette: "neon" });
    expect(loadSettings().palette).toBe("sky");
  });
});

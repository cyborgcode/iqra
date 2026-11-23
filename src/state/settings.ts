import { createContext, useContext } from "react";
import type { ModelId } from "../config/models";
import type { EnginePreference } from "../lib/asr/protocol";
import type { Digits } from "../lib/format";
import { defaultLang, STRINGS, type Lang, type Strings } from "../i18n";

export type ThemeSetting = "system" | "light" | "dark";

export interface Settings {
  lang: Lang;
  theme: ThemeSetting;
  model: ModelId;
  engine: EnginePreference;
  /** Word similarity needed to count as correct (see src/lib/arabic/similarity.ts). */
  threshold: number;
  /** Start new recitations with the text hidden. */
  memorize: boolean;
  /** "fit": each Mushaf page is sized to fit the screen; larger sizes scroll when needed. */
  textSize: TextSize;
  /** 1 2 3 or ١ ٢ ٣ for ayah numbers, page numbers and the Arabic interface. */
  digits: Digits;
}

export type TextSize = "fit" | "large" | "xlarge";

/** Read by the inline script in index.html too, so the theme and language apply before first paint. */
export const SETTINGS_KEY = "iqra.settings";

export const DEFAULT_THRESHOLD = 0.7;

export function defaultSettings(): Settings {
  return { lang: defaultLang(), theme: "system", model: "standard", engine: "auto", threshold: DEFAULT_THRESHOLD, memorize: false, textSize: "fit", digits: "western" };
}

export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings>;
    return {
      lang: saved.lang === "ar" || saved.lang === "en" ? saved.lang : base.lang,
      theme: saved.theme === "light" || saved.theme === "dark" ? saved.theme : "system",
      model: saved.model === "accurate" ? "accurate" : "standard",
      engine: saved.engine === "wasm" ? "wasm" : "auto",
      threshold: typeof saved.threshold === "number" && saved.threshold >= 0.5 && saved.threshold <= 0.95 ? saved.threshold : base.threshold,
      memorize: saved.memorize === true,
      textSize: saved.textSize === "large" || saved.textSize === "xlarge" ? saved.textSize : "fit",
      digits: saved.digits === "indic" ? "indic" : "western",
    };
  } catch {
    return base;
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or storage disabled: settings just won't persist.
  }
}

export interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  t: Strings;
  /** The theme actually shown (system preference resolved). */
  resolvedTheme: "light" | "dark";
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside <SettingsProvider>");
  return value;
}

export function stringsFor(lang: Lang): Strings {
  return STRINGS[lang];
}

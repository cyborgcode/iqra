import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { applyBrandColors } from "../lib/brand";
import { setDigits } from "../lib/format";
import { transition } from "../lib/motion";
import { SettingsContext, loadSettings, saveSettings, stringsFor, type Settings } from "./settings";

/** Settings that change how everything looks, so that changing them crossfades the screen. */
const LOOK: (keyof Settings)[] = ["theme", "palette", "lang", "digits", "textSize", "memorize"];

function systemTheme(): "light" | "dark" {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [system, setSystem] = useState<"light" | "dark">(systemTheme);

  const latest = useRef(settings);
  useLayoutEffect(() => {
    latest.current = settings;
  });
  const update = useCallback((patch: Partial<Settings>) => {
    const apply = () =>
      setSettings((current) => {
        const next = { ...current, ...patch };
        saveSettings(next);
        return next;
      });
    // Changes of look crossfade; the others (strictness, model, engine) are just made.
    const looks = LOOK.some((key) => key in patch && patch[key] !== latest.current[key]);
    if (looks) transition("fade", apply);
    else apply();
  }, []);

  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(query.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = settings.theme === "system" ? system : settings.theme;
  // Number formatting reads this directly; it must be current before anything below renders.
  setDigits(settings.digits);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.lang = settings.lang;
    root.dir = settings.lang === "ar" ? "rtl" : "ltr";
    document.title = settings.lang === "ar" ? "اقرأ · iqra" : "iqra · اقرأ";
  }, [settings.lang]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.palette = settings.palette;
    applyBrandColors();
  }, [resolvedTheme, settings.palette]);

  const value = useMemo(() => ({ settings, update, t: stringsFor(settings.lang), resolvedTheme }), [settings, update, resolvedTheme]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

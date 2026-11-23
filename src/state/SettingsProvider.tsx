import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { setDigits } from "../lib/format";
import { SettingsContext, loadSettings, saveSettings, stringsFor, type Settings } from "./settings";

function systemTheme(): "light" | "dark" {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [system, setSystem] = useState<"light" | "dark">(systemTheme);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
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

  useEffect(() => {
    const root = document.documentElement;
    root.lang = settings.lang;
    root.dir = settings.lang === "ar" ? "rtl" : "ltr";
    document.title = settings.lang === "ar" ? "اقرأ · iqra" : "iqra · اقرأ";
  }, [settings.lang]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const value = useMemo(() => ({ settings, update, t: stringsFor(settings.lang), resolvedTheme }), [settings, update, resolvedTheme]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

import { Menu } from "glisse";
import { Tabs } from "./Directional";
import { useSettings } from "../state/settings";
import { BookIcon, DeviceIcon, GearIcon, GlobeIcon, InfoIcon, MoonIcon, StarMark, SunIcon } from "./icons";

export type Tab = "practice" | "settings" | "about";

export function Header({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { t, settings, update } = useSettings();
  return (
    <header className="app-header">
      <a
        href="/"
        className="brand"
        onClick={(e) => {
          e.preventDefault();
          onNavigate("practice");
        }}
      >
        <StarMark size={30} />
        <span className="brand-ar" lang="ar">
          اقرأ
        </span>
        <span className="brand-en" lang="en">
          iqra
        </span>
      </a>
      <Menu
        aria-label={t.menuLabel}
        align="end"
        items={[
          { label: t.menuLanguage, icon: <GlobeIcon size={18} />, onSelect: () => update({ lang: settings.lang === "ar" ? "en" : "ar" }) },
          "separator",
          { label: t.menuThemeLight, icon: <SunIcon size={18} />, onSelect: () => update({ theme: "light" }), disabled: settings.theme === "light" },
          { label: t.menuThemeDark, icon: <MoonIcon size={18} />, onSelect: () => update({ theme: "dark" }), disabled: settings.theme === "dark" },
          { label: t.menuThemeSystem, icon: <DeviceIcon size={18} />, onSelect: () => update({ theme: "system" }), disabled: settings.theme === "system" },
          "separator",
          { label: t.menuAbout, icon: <InfoIcon size={18} />, onSelect: () => onNavigate("about") },
        ]}
      />
    </header>
  );
}

export function Footer({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { t } = useSettings();
  return (
    <footer className="app-footer">
      <p>{t.disclaimer}</p>
      <p>
        {t.footerText} ·{" "}
        <a href="https://tanzil.net" target="_blank" rel="noopener noreferrer" className="link" dir="ltr">
          tanzil.net
        </a>{" "}
        · {t.footerModels} ·{" "}
        <a
          href="/about"
          className="link"
          onClick={(e) => {
            e.preventDefault();
            onNavigate("about");
          }}
        >
          {t.menuAbout}
        </a>
      </p>
      <p>{t.footerFree}</p>
    </footer>
  );
}

export function NavBar({ tab, onNavigate }: { tab: Tab; onNavigate: (tab: Tab) => void }) {
  const { t } = useSettings();
  return (
    <nav className="tabbar-wrap" aria-label="iqra">
      <Tabs
        items={[
          { value: "practice", label: t.tabPractice, icon: <BookIcon size={22} /> },
          { value: "settings", label: t.tabSettings, icon: <GearIcon size={22} /> },
          { value: "about", label: t.tabAbout, icon: <InfoIcon size={22} /> },
        ]}
        value={tab}
        onValueChange={(v) => onNavigate(v as Tab)}
      />
    </nav>
  );
}

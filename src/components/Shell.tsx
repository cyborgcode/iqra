import { Menu } from "glisse";
import { Tabs } from "./Directional";
import { juzOfAyah, pageAyahs, surahsOnPage } from "../lib/quran/book";
import { bookRoute, navigate, type Route } from "../state/route";
import { useRecitation } from "../state/recitation";
import { useSettings } from "../state/settings";
import { openSheet } from "../state/ui";
import { BookIcon, DeviceIcon, GearIcon, GlobeIcon, InfoIcon, ListIcon, MoonIcon, StarMark, SunIcon } from "./icons";
import { num, surahName } from "./labels";

function go(e: React.MouseEvent, route: Route) {
  e.preventDefault();
  navigate(route);
  window.scrollTo({ top: 0 });
}

export function Header({ page }: { page: number | null }) {
  const { t, settings, update } = useSettings();
  return (
    <header className="app-header">
      <a href="/" className="brand" onClick={(e) => go(e, bookRoute())}>
        <StarMark size={30} />
        <span className="brand-ar" lang="ar">
          اقرأ
        </span>
        <span className="brand-en" lang="en">
          iqra
        </span>
      </a>
      {page !== null && (
        <button type="button" className="page-info" onClick={() => openSheet("index")} aria-label={`${t.contents} · ${t.pageN(num(page, settings.lang))}`}>
          <ListIcon size={18} />
          <span className="page-info-surah">{surahName(surahsOnPage(page)[0]!, settings.lang)}</span>
          <span className="page-info-meta">
            {t.juzN(num(juzOfAyah(pageAyahs(page)[0]), settings.lang))} · {t.pageN(num(page, settings.lang))}
          </span>
        </button>
      )}
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
          { label: t.menuAbout, icon: <InfoIcon size={18} />, onSelect: () => navigate({ view: "about" }) },
        ]}
      />
    </header>
  );
}

export function Footer() {
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
        <a href="/about" className="link" onClick={(e) => go(e, { view: "about" })}>
          {t.menuAbout}
        </a>
      </p>
      <p>{t.footerFree}</p>
    </footer>
  );
}

export function NavBar({ view }: { view: Route["view"] }) {
  const { t } = useSettings();
  const { phase } = useRecitation();
  // While listening, the microphone controls have the bottom of the screen to themselves.
  if (view === "book" && phase !== "idle") return null;
  return (
    <nav className="tabbar-wrap" aria-label="iqra">
      <Tabs
        items={[
          { value: "book", label: t.tabBook, icon: <BookIcon size={22} /> },
          { value: "settings", label: t.tabSettings, icon: <GearIcon size={22} /> },
          { value: "about", label: t.tabAbout, icon: <InfoIcon size={22} /> },
        ]}
        value={view}
        onValueChange={(v) => {
          navigate(v === "book" ? bookRoute() : { view: v as "settings" | "about" });
          if (v !== "book") window.scrollTo({ top: 0 });
        }}
      />
    </nav>
  );
}

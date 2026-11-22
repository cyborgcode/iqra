import { useCallback, useEffect, useState } from "react";
import { AboutView } from "./components/AboutView";
import { PracticeView } from "./components/PracticeView";
import { SettingsView } from "./components/SettingsView";
import { Footer, Header, NavBar, type Tab } from "./components/Shell";
import { useSettings } from "./state/settings";

const PATHS: Record<Tab, string> = { practice: "/", settings: "/settings", about: "/about" };

function tabFromPath(path: string): Tab {
  if (path.startsWith("/settings")) return "settings";
  if (path.startsWith("/about")) return "about";
  return "practice";
}

export default function App() {
  const { t } = useSettings();
  const [tab, setTab] = useState<Tab>(() => tabFromPath(location.pathname));

  const navigate = useCallback((next: Tab) => {
    setTab(next);
    if (location.pathname !== PATHS[next]) history.pushState(null, "", PATHS[next]);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onPop = () => setTab(tabFromPath(location.pathname));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        {t.skipToContent}
      </a>
      <Header onNavigate={navigate} />
      {/* Views stay mounted so a recitation in progress survives switching tabs. */}
      <main id="main" className="app-main" tabIndex={-1}>
        <div hidden={tab !== "practice"}>
          <PracticeView />
        </div>
        <div hidden={tab !== "settings"}>
          <SettingsView />
        </div>
        <div hidden={tab !== "about"}>
          <AboutView />
        </div>
      </main>
      <Footer onNavigate={navigate} />
      <NavBar tab={tab} onNavigate={navigate} />
    </div>
  );
}

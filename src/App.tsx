import { AboutView } from "./components/AboutView";
import { BookView } from "./components/BookView";
import { SettingsView } from "./components/SettingsView";
import { Footer, Header, NavBar } from "./components/Shell";
import { bookRoute, useRoute } from "./state/route";
import { useSettings } from "./state/settings";

export default function App() {
  const { t } = useSettings();
  const route = useRoute();
  const book = route.view === "book" ? route : bookRoute();
  const page = book.view === "book" ? book.page : 1;
  const onBook = route.view === "book";

  return (
    <div className={`app view-${route.view}`}>
      <a href="#main" className="skip-link">
        {t.skipToContent}
      </a>
      {/* The Mushaf has the whole screen; the other views get the usual header, footer and tabs. */}
      {!onBook && <Header />}
      {/* Views stay mounted so a recitation in progress survives a visit to Settings. */}
      <main id="main" className="app-main" tabIndex={-1}>
        <div hidden={!onBook} className="book-host">
          <BookView page={page} />
        </div>
        <div hidden={route.view !== "settings"}>
          <SettingsView />
        </div>
        <div hidden={route.view !== "about"}>
          <AboutView />
        </div>
      </main>
      {!onBook && <Footer />}
      {!onBook && <NavBar view={route.view} />}
    </div>
  );
}

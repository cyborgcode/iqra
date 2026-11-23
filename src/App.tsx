import { memo } from "react";
import { AboutView } from "./components/AboutView";
import { BookView } from "./components/BookView";
import { SettingsView } from "./components/SettingsView";
import { Footer, Header, NavBar } from "./components/Shell";
import { bookRoute, useRoute } from "./state/route";
import { useSettings } from "./state/settings";

// The Mushaf renders again only when its page changes, not on every change of view.
const Book = memo(BookView);

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
      {/* The Mushaf stays mounted, so a recitation in progress survives a visit to Settings. The other
          views exist only while shown: hidden, their glass would be fitted again each time they show. */}
      <main id="main" className="app-main" tabIndex={-1}>
        <div hidden={!onBook} className="book-host">
          <Book page={page} />
        </div>
        {route.view === "settings" && <SettingsView />}
        {route.view === "about" && <AboutView />}
      </main>
      {!onBook && <Footer />}
      {!onBook && <NavBar view={route.view} />}
    </div>
  );
}

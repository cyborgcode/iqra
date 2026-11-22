import { useSyncExternalStore } from "react";
import { PAGE_COUNT, pageOfAyah } from "../lib/quran/book";

/** The views of the app, each with its own address: /page/1…604, /settings, /about. */
export type Route = { view: "book"; page: number } | { view: "settings" } | { view: "about" };

/** The page last opened, so the Mushaf opens where the reader left it (kept on this device only). */
const LAST_PAGE_KEY = "iqra.page";

function lastPage(): number {
  try {
    const n = Number(localStorage.getItem(LAST_PAGE_KEY));
    return Number.isInteger(n) && n >= 1 && n <= PAGE_COUNT ? n : 1;
  } catch {
    return 1;
  }
}

export function parseRoute(path: string): Route {
  if (path.startsWith("/settings")) return { view: "settings" };
  if (path.startsWith("/about")) return { view: "about" };
  const m = /^\/page\/(\d{1,3})\/?$/.exec(path);
  const n = m ? Number(m[1]) : NaN;
  return { view: "book", page: n >= 1 && n <= PAGE_COUNT ? n : lastPage() };
}

export function pathOf(route: Route): string {
  return route.view === "book" ? `/page/${route.page}` : `/${route.view}`;
}

let route: Route = parseRoute(location.pathname);
if (location.pathname !== pathOf(route)) history.replaceState(null, "", pathOf(route) + location.hash);

/** An ayah to bring into view (and briefly highlight) once its page is shown. */
let focusAyah: number | null = null;

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(next: Route) {
  route = next;
  if (next.view === "book") {
    try {
      localStorage.setItem(LAST_PAGE_KEY, String(next.page));
    } catch {
      // Storage unavailable: the Mushaf will just open on page 1 next time.
    }
  }
  emit();
}

addEventListener("popstate", () => set(parseRoute(location.pathname)));

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => route);
}

export function currentRoute(): Route {
  return route;
}

export function navigate(next: Route, { replace = false } = {}) {
  const path = pathOf(next);
  if (location.pathname !== path) {
    if (replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
  }
  if (path !== pathOf(route)) set(next);
}

export function goToPage(page: number, options?: { replace?: boolean }) {
  navigate({ view: "book", page: Math.min(PAGE_COUNT, Math.max(1, Math.round(page))) }, options);
}

/** Opens the page of an ayah (an ayah index) and brings the ayah into view. */
export function goToAyah(ayah: number, options?: { replace?: boolean }) {
  focusAyah = ayah;
  goToPage(pageOfAyah(ayah), options);
  emit();
}

/** The book page to return to from other views. */
export function bookRoute(): Route {
  return { view: "book", page: route.view === "book" ? route.page : lastPage() };
}

export function useFocusAyah(): number | null {
  return useSyncExternalStore(subscribe, () => focusAyah);
}

export function clearFocusAyah() {
  if (focusAyah !== null) {
    focusAyah = null;
    emit();
  }
}

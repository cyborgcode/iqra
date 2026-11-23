import { useSyncExternalStore } from "react";
import { PAGE_COUNT, pageOfAyah } from "../lib/quran/book";
import { transition, type TransitionKind } from "../lib/motion";

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

/** Where the reader is, or is going: changes at once, so a quick second page turn starts from it. */
let route: Route = parseRoute(location.pathname);
if (location.pathname !== pathOf(route)) history.replaceState(null, "", pathOf(route) + location.hash);
/** What is on the screen: follows `route` when the screen changes (within its transition). */
let shown: Route = route;

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

/** Keeps the page open, so the Mushaf opens there again (and other views return to it). */
function rememberPage(r: Route) {
  if (r.view !== "book") return;
  try {
    localStorage.setItem(LAST_PAGE_KEY, String(r.page));
  } catch {
    // Storage unavailable: the Mushaf will just open on page 1 next time.
  }
}

rememberPage(route);

function set(next: Route) {
  shown = next;
  emit();
}

/** How the screen changes between two routes: a page turn forwards or back, or another view. */
function kindOf(from: Route, to: Route): TransitionKind {
  if (from.view === "book" && to.view === "book") return to.page > from.page ? "page-next" : "page-prev";
  return "view";
}

/** Goes to a route, and shows it animated as a page turn or a change of view (unless `animate` is false). */
function go(next: Route, { from = 0, animate = true } = {}) {
  const kind = kindOf(route, next);
  route = next;
  rememberPage(next);
  if (animate) transition(kind, () => set(next), { from });
  else set(next);
}

addEventListener("popstate", (event) => {
  // After a browser's own back or forward animation (a swipe on iOS, for one), no second animation.
  const animate = !(event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition;
  go(parseRoute(location.pathname), { animate });
});

/** The route on the screen. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => shown);
}

export function currentRoute(): Route {
  return route;
}

/** `from`: how far the page was dragged, in pixels, when a swipe turns it. */
export function navigate(next: Route, { replace = false, from = 0 } = {}) {
  const path = pathOf(next);
  if (location.pathname !== path) {
    if (replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
  }
  if (path !== pathOf(route)) go(next, { from });
}

export function goToPage(page: number, options?: { replace?: boolean; from?: number }) {
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

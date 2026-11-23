/**
 * Smooth changes of screen with view transitions: the browser snapshots the screen, the change is made
 * at once, and the old screen is animated into the new one. Which animation is chosen by the kind of
 * change, set on <html data-transition> for the stylesheet ("Transitions" in index.css).
 *
 * Without view transitions, or when the system asks for reduced motion, changes are simply made.
 */
import { flushSync } from "react-dom";

/** A page turn (towards the next or previous page), another view, or a change of look (theme, language…). */
export type TransitionKind = "page-next" | "page-prev" | "view" | "fade";

const reducedMotion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

/** Whether changes are animated with view transitions here. */
export function viewTransitions(): boolean {
  return typeof document !== "undefined" && typeof document.startViewTransition === "function" && !reducedMotion?.matches;
}

let running: ViewTransition | null = null;

/** Makes `update` (React state changes included) as a view transition of the given kind. */
export function transition(kind: TransitionKind, update: () => void): void {
  if (!viewTransitions() || document.visibilityState !== "visible") {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.transition = kind;
  const current = document.startViewTransition(() => flushSync(update));
  running = current;
  // A transition is skipped when another starts: nothing to report then.
  current.ready.catch(() => {});
  const done = () => {
    if (running !== current) return;
    running = null;
    delete root.dataset.transition;
  };
  current.finished.then(done, done);
}

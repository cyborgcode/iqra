import type { HTMLAttributes } from "react";

/**
 * A large, still pane of glass (a card, a sheet): glisse's glass, its translucent fill, frost, edge line
 * and rim light, drawn by the stylesheet alone (`.surface` in index.css). glisse's <Glass> draws its rim
 * (and in Chromium its refraction) as images the size of the element, which for a whole card or sheet is
 * costly each time a new size appears; it stays on the dock, tab bar and controls, which are small.
 */
export function Surface({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`surface ${className}`} {...rest} />;
}

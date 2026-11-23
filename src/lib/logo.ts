/**
 * iqra's logo as an SVG string: a white open Mushaf on a rounded tile shaded from `from` to `to`. The
 * same drawing as <AppMark> (src/components/icons.tsx); public/favicon.svg is it in the default bleu ciel,
 * and scripts/build-icons.mjs draws the app icons from that file.
 */
export function logoSvg(from: string, to: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#g)"/><g transform="translate(32 32) scale(1.2) translate(-32 -40.1)"><path d="M32 31.5c-5.6-4.4-13.6-5.2-20-3.6v22.2c6.4-1.6 14.4-.8 20 3.6 5.6-4.4 13.6-5.2 20-3.6V27.9c-6.4-1.6-14.4-.8-20 3.6Z" fill="#fff"/></g></svg>`;
}

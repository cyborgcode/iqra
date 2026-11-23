/**
 * The favicon and the browser's theme colour follow the chosen theme. The mark is the same drawing as
 * <AppMark> (src/components/icons.tsx), as an SVG string with the gradient's two colours filled in.
 */
export function logoSvg(from: string, to: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#g)"/><g transform="translate(32 32) scale(1.2) translate(-32 -40.1)"><path d="M32 31.5c-5.6-4.4-13.6-5.2-20-3.6v22.2c6.4-1.6 14.4-.8 20 3.6 5.6-4.4 13.6-5.2 20-3.6V27.9c-6.4-1.6-14.4-.8-20 3.6Z" fill="#fff"/><path d="M32 33v19" stroke="url(#g)" stroke-width="2.2" stroke-linecap="round"/></g></svg>`;
}

let canvas: CanvasRenderingContext2D | null = null;

/** Any CSS colour (here OKLCH) as #rrggbb, by painting one pixel. */
function toHex(color: string): string | null {
  canvas ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!canvas || !color) return null;
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillStyle = "#000";
  canvas.fillStyle = color;
  canvas.fillRect(0, 0, 1, 1);
  const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v!.toString(16).padStart(2, "0")).join("")}`;
}

/** The value of a colour custom property of the root element, resolved and as #rrggbb. */
function rootColor(name: string): string | null {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  probe.style.display = "none";
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return toHex(value);
}

/** Point the favicon and the browser's theme colour at the current theme. */
export function applyBrandColors() {
  const from = rootColor("--mic-a");
  const to = rootColor("--mic-b");
  if (from && to) {
    const href = `data:image/svg+xml,${encodeURIComponent(logoSvg(from, to))}`;
    document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((link) => (link.href = href));
  }
  const top = rootColor("--sky-top");
  if (top) {
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      meta.content = top;
      meta.removeAttribute("media");
    });
  }
}

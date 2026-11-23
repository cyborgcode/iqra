/** The favicon and the browser's theme colour follow the chosen theme. */
import { logoSvg } from "./logo";

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
  const from = rootColor("--logo-a");
  const to = rootColor("--logo-b");
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

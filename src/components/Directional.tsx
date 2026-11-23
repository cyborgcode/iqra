import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { SegmentedControl, Slider, Switch, TabBar } from "glisse";
import type { SegmentedControlProps, SliderProps, SwitchProps, TabBarProps } from "glisse";
import { useSettings } from "../state/settings";

// glisse positions thumbs, lenses and fills with left-to-right geometry. These wrappers render
// its directional controls in a left-to-right island and, in Arabic, list items right-to-left
// so the first option still sits on the reading-start side.

function useOrdered<T>(items: T[]): T[] {
  const { settings } = useSettings();
  return settings.lang === "ar" ? [...items].reverse() : items;
}

/** glisse's segment width. Its segments are all as wide; they widen together when a label needs more. */
const SEGMENT_MIN = 84;
/** Room on each side of the longest label. */
const SEGMENT_PAD = 12;

let ruler: CanvasRenderingContext2D | null = null;

/** A label's width on one line, in the weight a selected segment draws it in (its widest). */
function labelWidth(label: HTMLElement): number {
  ruler ??= document.createElement("canvas").getContext("2d");
  if (!ruler) return label.scrollWidth;
  const style = getComputedStyle(label);
  ruler.font = `500 ${style.fontSize} ${style.fontFamily}`;
  return ruler.measureText(label.textContent ?? "").width;
}

/**
 * The segment width that fits the longest label on one line, within the width available. On a screen
 * too narrow even for that, the labels wrap onto two lines in taller segments.
 */
function useSegmentFit(box: RefObject<HTMLDivElement | null>, count: number, labels: string) {
  const [fit, setFit] = useState<{ width: number; wrap: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const texts = [...el.querySelectorAll<HTMLElement>(".lg-tab .lg-tab-text")];
      if (texts.length === 0 || el.clientWidth === 0) return;
      const longest = Math.ceil(Math.max(...texts.map(labelWidth)));
      const width = Math.min(Math.max(SEGMENT_MIN, longest + 2 * SEGMENT_PAD), Math.floor(el.clientWidth / count));
      const wrap = longest + 4 > width;
      setFit((prev) => (prev?.width === width && prev.wrap === wrap ? prev : { width, wrap }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [box, count, labels]);
  return fit;
}

export function Segmented(props: SegmentedControlProps) {
  const items = useOrdered(props.items);
  const box = useRef<HTMLDivElement>(null);
  const fit = useSegmentFit(box, items.length, items.map((i) => (typeof i.label === "string" ? i.label : i.value)).join("\n"));
  const style = fit ? ({ ...props.style, "--lg-tab-width": `${fit.width}px`, ...(fit.wrap && { "--lg-tab-height": "44px" }) } as CSSProperties) : props.style;
  return (
    <div ref={box} dir="ltr" className="ltr-island segmented-box" data-wrap={fit?.wrap ? "" : undefined}>
      <SegmentedControl {...props} items={items} style={style} />
    </div>
  );
}

export function Tabs(props: TabBarProps) {
  const items = useOrdered(props.items);
  return (
    <div dir="ltr">
      <TabBar {...props} items={items} />
    </div>
  );
}

export function Toggle(props: SwitchProps) {
  return (
    <span dir="ltr" className="inline-flex">
      <Switch {...props} />
    </span>
  );
}

/** A slider with its end labels, laid out left (min) to right (max) in every language. */
export function RangeSlider({ minLabel, maxLabel, ...props }: SliderProps & { minLabel: ReactNode; maxLabel: ReactNode }) {
  return (
    <div dir="ltr" className="slider-row">
      <span className="text-sm text-muted">{minLabel}</span>
      <Slider {...props} />
      <span className="text-sm text-muted">{maxLabel}</span>
    </div>
  );
}

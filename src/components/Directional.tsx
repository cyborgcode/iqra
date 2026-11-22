import type { ReactNode } from "react";
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

export function Segmented(props: SegmentedControlProps) {
  const items = useOrdered(props.items);
  return (
    <div dir="ltr" className="ltr-island">
      <SegmentedControl {...props} items={items} />
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

import { useSyncExternalStore } from "react";

/** Which sheet (dialog) is open. Several parts of the screen can open the same sheet. */
export type SheetName = "index" | "model" | "more" | null;

let sheet: SheetName = null;
const listeners = new Set<() => void>();

export function openSheet(name: SheetName) {
  sheet = name;
  listeners.forEach((l) => l());
}

export function useSheet(): SheetName {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sheet,
  );
}

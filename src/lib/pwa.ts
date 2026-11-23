/**
 * iqra as an installed app: the service worker that lets it open and work offline (built from src/sw.js
 * by vite.config.ts, so only in production builds), and the browser's offer to install it.
 */
import { useSyncExternalStore } from "react";

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => console.warn("iqra will not work offline here:", error));
  };
  if (document.readyState === "complete") register();
  else addEventListener("load", register, { once: true });
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

/**
 * How iqra can be installed in this browser: with the browser's prompt, by hand from the Share menu
 * (iPhone and iPad, whose browsers have no prompt), or not at all (already installed, or not offered).
 */
export type InstallOption = "prompt" | "share-menu" | null;

let promptEvent: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const iosStandalone = () => (navigator as Navigator & { standalone?: boolean }).standalone;

function installOption(): InstallOption {
  if (installed || iosStandalone() === true || matchMedia("(display-mode: standalone)").matches) return null;
  if (promptEvent) return "prompt";
  return typeof iosStandalone() === "boolean" ? "share-menu" : null;
}

/** Listens for the browser's offer to install iqra; call once, early. */
export function listenForInstall(): void {
  addEventListener("beforeinstallprompt", (event) => {
    // Offered from the "More" sheet instead of the browser's own banner, which would cover the dock.
    event.preventDefault();
    promptEvent = event as InstallPromptEvent;
    notify();
  });
  addEventListener("appinstalled", () => {
    installed = true;
    promptEvent = null;
    notify();
  });
}

export function useInstallOption(): InstallOption {
  return useSyncExternalStore(subscribe, installOption, () => null);
}

/** Shows the browser's install prompt. Each offer can be shown once; the browser may make another later. */
export async function promptInstall(): Promise<void> {
  const event = promptEvent;
  promptEvent = null;
  notify();
  await event?.prompt();
}

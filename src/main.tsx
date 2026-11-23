import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/amiri-quran/arabic-400.css";
import amiriDigits from "@fontsource/amiri-quran/files/amiri-quran-latin-400-normal.woff2?url";
import "./index.css";
import App from "./App";
import { SettingsProvider } from "./state/SettingsProvider";

// Amiri's own 1 2 3 for ayah and page numbers. Only the digits are taken from its Latin subset, so the
// Arabic face (which has no unicode-range) is not replaced for anything else.
if (typeof FontFace !== "undefined") {
  document.fonts.add(new FontFace("Amiri Quran Digits", `url(${amiriDigits}) format("woff2")`, { unicodeRange: "U+0030-0039", display: "swap" }));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);

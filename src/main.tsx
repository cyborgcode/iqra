import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/amiri-quran/arabic-400.css";
import "./index.css";
import App from "./App";
import { SettingsProvider } from "./state/SettingsProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);

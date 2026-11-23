// Applies the saved theme, theme colour and language before the first paint, so the page never flashes.
// Loaded as a plain (blocking) script from index.html; the app keeps these in sync afterwards.
(function () {
  try {
    var saved = JSON.parse(localStorage.getItem("iqra.settings") || "{}");
    var lang = saved.lang || ((navigator.language || "").slice(0, 2) === "ar" ? "ar" : "en");
    var root = document.documentElement;
    root.lang = lang;
    root.dir = lang === "ar" ? "rtl" : "ltr";
    var theme = saved.theme || "system";
    if (theme === "system") theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    root.dataset.theme = theme;
    var palettes = ["sky", "emerald", "sand", "lavender", "graphite"];
    root.dataset.palette = palettes.indexOf(saved.palette) >= 0 ? saved.palette : "sky";
  } catch {
    // Storage unavailable: the defaults apply.
  }
})();

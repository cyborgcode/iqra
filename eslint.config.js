import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "public/ort", "node_modules"] },
  {
    files: ["public/*.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.browser, sourceType: "script" },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["src/worker/**/*.ts"],
    languageOptions: { globals: globals.worker },
  },
  {
    files: ["src/**/*.worklet.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.audioWorklet,
      },
    },
  },
  {
    files: ["scripts/**/*.{js,mjs}", "eslint.config.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
);

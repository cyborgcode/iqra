/// <reference types="vitest/config" />
import { createHash } from "node:crypto";
import { createReadStream, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// ONNX Runtime's WebAssembly engine is served by this site instead of a third-party CDN.
// Two builds: with WebGPU support (asyncify) and plain WebAssembly (smaller, for browsers without WebGPU).
const ORT_DIR = path.resolve("node_modules/onnxruntime-web/dist");
const ORT_VERSION: string = JSON.parse(readFileSync(path.resolve("node_modules/onnxruntime-web/package.json"), "utf8")).version;
const ORT_BASE = `/ort/${ORT_VERSION}/`;
const ORT_BUILDS = {
  webgpu: { mjs: "ort-wasm-simd-threaded.asyncify.mjs", wasm: "ort-wasm-simd-threaded.asyncify.wasm" },
  wasm: { mjs: "ort-wasm-simd-threaded.mjs", wasm: "ort-wasm-simd-threaded.wasm" },
};
const ORT_FILES = Object.values(ORT_BUILDS).flatMap((b) => [b.mjs, b.wasm]);
const size = (file: string) => statSync(path.join(ORT_DIR, file)).size;

const ORT_RUNTIME = {
  version: ORT_VERSION,
  base: ORT_BASE,
  webgpu: { ...ORT_BUILDS.webgpu, bytes: size(ORT_BUILDS.webgpu.wasm) },
  wasm: { ...ORT_BUILDS.wasm, bytes: size(ORT_BUILDS.wasm.wasm) },
};

function ortRuntime(): Plugin {
  return {
    name: "iqra:ort-runtime",
    configureServer(server) {
      server.middlewares.use(ORT_BASE, (req, res, next) => {
        const file = (req.url ?? "").replace(/^\//, "").split("?")[0]!;
        if (!ORT_FILES.includes(file)) return next();
        res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        createReadStream(path.join(ORT_DIR, file)).pipe(res);
      });
    },
    generateBundle() {
      for (const file of ORT_FILES) {
        this.emitFile({ type: "asset", fileName: `ort/${ORT_VERSION}/${file}`, source: readFileSync(path.join(ORT_DIR, file)) });
      }
    },
  };
}

// Offline: a service worker (src/sw.js) keeps the site's own files on the device so that iqra opens and
// works without a connection. The build gives it the list: the bundle and the public files, except the
// ONNX Runtime engine (Transformers.js keeps it in its own cache once downloaded, as it keeps the speech
// model), the WOFF fonts only browsers without WOFF2 use, and the app icons, which only the browser's
// install needs. The version changes whenever any of those files does.
const SKIP_OFFLINE = [/^ort\//, /\.woff$/, /^icons\//, /^sw\.js$/];

function filesIn(dir: string): string[] {
  if (!dir) return [];
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => !file.split("/").some((part) => part.startsWith(".")) && statSync(path.join(dir, file)).isFile());
}

function serviceWorker(): Plugin {
  let publicDir = "";
  const digest = (content: string | Uint8Array) => createHash("sha256").update(content).digest("hex");
  return {
    name: "iqra:service-worker",
    apply: "build",
    // After the HTML page has been added to the bundle.
    enforce: "post",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const hashes = new Map<string, string>();
      for (const item of Object.values(bundle)) hashes.set(item.fileName, digest(item.type === "chunk" ? item.code : item.source));
      for (const file of filesIn(publicDir)) hashes.set(file, digest(readFileSync(path.join(publicDir, file))));
      const kept = [...hashes.keys()].filter((file) => !SKIP_OFFLINE.some((skip) => skip.test(file))).sort();
      if (!kept.includes("index.html")) throw new Error("The service worker needs index.html in the bundle");
      const version = digest(kept.map((file) => `${file} ${hashes.get(file)}`).join("\n")).slice(0, 16);
      const precache = { version, files: kept.map((file) => `/${file}`) };
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: `self.__IQRA_PRECACHE__ = ${JSON.stringify(precache)};\n\n${readFileSync(path.resolve("src/sw.js"), "utf8")}`,
      });
    },
  };
}

// Cross-origin isolation enables SharedArrayBuffer, which multithreaded WebAssembly needs
// (2× faster transcription in testing). Production headers live in vercel.json; `vite preview`
// serves the same ones so the built site can be tested as deployed. The dev server only gets the
// isolation headers (its hot-reload client needs inline scripts that the CSP would block).
const VERCEL: { headers: { source: string; headers: { key: string; value: string }[] }[] } = JSON.parse(
  readFileSync(path.resolve("vercel.json"), "utf8"),
);
const SITE_HEADERS = Object.fromEntries(VERCEL.headers.find((h) => h.source === "/(.*)")!.headers.map((h) => [h.key, h.value]));
const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": SITE_HEADERS["Cross-Origin-Opener-Policy"]!,
  "Cross-Origin-Embedder-Policy": SITE_HEADERS["Cross-Origin-Embedder-Policy"]!,
};

export default defineConfig({
  plugins: [react(), tailwindcss(), ortRuntime(), serviceWorker()],
  server: { headers: ISOLATION_HEADERS },
  preview: { headers: SITE_HEADERS },
  define: {
    __ORT_RUNTIME__: JSON.stringify(ORT_RUNTIME),
  },
  resolve: {
    // Use ONNX Runtime's build that loads its WebAssembly from the paths we set (served from ORT_BASE),
    // instead of the "bundle" build, which would make Vite emit a second copy of the 27 MB engine.
    conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions],
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    // Transformers.js resolves its ONNX Runtime files at run time; pre-bundling breaks that.
    exclude: ["@huggingface/transformers"],
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
});

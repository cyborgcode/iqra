// iqra's service worker: it keeps the site's own files on this device so that iqra opens and works
// without a connection. The build (vite.config.ts) puts the list of files and their version in front
// of this script as self.__IQRA_PRECACHE__.
//
// - Pages come from the network when it answers within a few seconds, so a new version shows at once;
//   otherwise from the kept copy (a licence text, or the app itself for any of its addresses).
// - Every other file of this site comes from the kept copy, else the network. The kept copies include
//   the ONNX Runtime engine, which Transformers.js keeps in its own cache once it has been downloaded.
// - Requests to other sites (the speech model on Hugging Face) are left to the browser: Transformers.js
//   keeps the model in its own cache.
// A new version is kept alongside the old one until no open tab uses the old one, then replaces it.

const { version, files } = self.__IQRA_PRECACHE__;
const CACHE = `iqra-${version}`;
const SHELL = "/index.html";
const NETWORK_TIMEOUT = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Hashed build files never change; the others are checked so that the copy kept is current.
      cache.addAll(files.map((url) => (url.startsWith("/assets/") ? url : new Request(url, { cache: "no-cache" })))),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const old = (await caches.keys()).filter((name) => name.startsWith("iqra-") && name !== CACHE);
      await Promise.all(old.map((name) => caches.delete(name)));
      await self.registration.navigationPreload?.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range") || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    const network = (async () => (await event.preloadResponse) ?? fetch(request))();
    event.waitUntil(network.catch(() => {}));
    event.respondWith(page(request, network));
  } else {
    event.respondWith(file(request));
  }
});

async function page(request, network) {
  try {
    return await withTimeout(network, NETWORK_TIMEOUT);
  } catch {
    return (await caches.match(request, { ignoreSearch: true })) ?? (await caches.match(SHELL)) ?? Response.error();
  }
}

async function file(request) {
  return (await caches.match(request, { ignoreVary: true })) ?? fetch(request);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The network did not answer in time")), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

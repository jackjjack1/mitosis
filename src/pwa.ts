/** Register the offline worker only for http(s). The Mac app loads over file://. */
export function shouldRegisterServiceWorker(protocol: string): boolean {
  return protocol === "https:" || protocol === "http:";
}

/** iOS Safari has no folder picker. Fall back to the multi-file input. */
export function pickTarget(folderSupported: boolean): "folder" | "files" {
  return folderSupported ? "folder" : "files";
}

/** Project site path: https://jackjjack1.github.io/mitosis/ */
export const PAGES_BASE = "/mitosis/";

export function normalizeBase(base: string | undefined): string {
  if (!base || base === "." || base === "./") return "./";
  return base.endsWith("/") ? base : `${base}/`;
}

export function assetPath(base: string, file: string): string {
  const root = normalizeBase(base);
  const name = file.replace(/^\.\//, "").replace(/^\//, "");
  return root === "./" ? `./${name}` : `${root}${name}`;
}

export function manifestDocument(base: string) {
  const scope = normalizeBase(base);
  return {
    name: "MITOSIS",
    short_name: "MITOSIS",
    description:
      "Drop a file, take the parts, and evolve a reconstruction. Everything stays on this device.",
    start_url: scope,
    scope,
    display: "standalone",
    background_color: "#090909",
    theme_color: "#090909",
    icons: [
      { src: assetPath(base, "icons/icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: assetPath(base, "icons/icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: assetPath(base, "icons/icon-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

export function manifestText(base: string): string {
  return `${JSON.stringify(manifestDocument(base), null, 2)}\n`;
}

/** Shell cache and fallback use the same base as the page, so /mitosis/ does not cache the domain root. */
export function serviceWorkerSource(base: string): string {
  const shell = [
    "index.html",
    "manifest.webmanifest",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/apple-touch-icon.png",
  ].map((file) => assetPath(base, file));
  const fallback = assetPath(base, "index.html");
  const scope = normalizeBase(base);
  return `const CACHE = "mitosis-shell-v1";
const SCOPE = ${JSON.stringify(scope)};
const SHELL = ${JSON.stringify(shell)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match(${JSON.stringify(fallback)}))),
  );
});
`;
}

export function registerAppWorker(target: {
  navigator: Navigator;
  location: { protocol: string };
}): void {
  if (!("serviceWorker" in target.navigator)) return;
  if (!shouldRegisterServiceWorker(target.location.protocol)) return;
  const base = normalizeBase(import.meta.env?.BASE_URL);
  const script = assetPath(base, "sw.js");
  const options = base.startsWith("/") ? { scope: base } : undefined;
  void target.navigator.serviceWorker.register(script, options);
}

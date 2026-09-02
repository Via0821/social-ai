/**
 * Minimal service worker — exists so the browser offers "add to home screen".
 *
 * Deliberately does NOT cache API responses. SOCIAL's value is current
 * information; serving a stale brief or a stale memory list from cache would
 * be worse than showing nothing. Only the app shell is cached, so the icon
 * and layout appear instantly and the app boots offline far enough to say it
 * has no connection.
 */
// Bumped when the icon changed — a stale cache would keep serving the old one.
const SHELL_CACHE = "social-shell-v2";
const SHELL = ["/", "/index.html", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache the API or anything cross-origin.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network first, fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html").then((r) => r ?? Response.error())),
    );
    return;
  }

  // Static assets: cache first, they are content-hashed by Vite.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});

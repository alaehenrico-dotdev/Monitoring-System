/* Service worker for production static assets.
 *
 * - App shell + every built asset are precached at install (the list below is
 *   injected by the build - see pwaPrecachePlugin in vite.config.ts - so
 *   lazily-loaded page chunks work offline too, not just the ones visited).
 * - Navigations are network-first with the cached index.html as the offline
 *   fallback (the app is a client-side-routed SPA).
 * - API requests always go to the live server and are never cached.
 */
const VERSION = "__SW_VERSION__";
const PRECACHE = self.__PRECACHE__ || [];
const STATIC_CACHE = `ala-eh-static-${VERSION}`;
const FONT_CACHE = "ala-eh-fonts-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith("ala-eh-static-") && key !== STATIC_CACHE) ||
                key === "ala-eh-api-v1",
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok || response.type === "opaque") cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || refresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match("/index.html", { cacheName: STATIC_CACHE });
        // A service worker must always resolve respondWith() to a Response.
        // If the app shell was not precached (for example, a partial install),
        // allow the browser's normal network error page instead of returning
        // undefined and creating an unhandled FetchEvent rejection.
        return cached || Response.error();
      }),
    );
    return;
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches
        .match(request, { cacheName: STATIC_CACHE })
        .then((hit) => hit || fetch(request))
        .catch(() => Response.error()),
    );
  }
});

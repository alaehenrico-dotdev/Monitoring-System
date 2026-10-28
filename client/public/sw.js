/* Service worker for production static assets.
 *
 * - App shell + every built asset are precached at install (the list below is
 *   injected by the build - see pwaPrecachePlugin in vite.config.ts - so
 *   lazily-loaded page chunks work offline too, not just the ones visited).
 * - Navigations are network-first with the cached index.html as the offline
 *   fallback (the app is a client-side-routed SPA).
 * - API requests always go to the live server and are never cached.
 * - Only SAME-ORIGIN requests are handled here. Cross-origin ones (Google Fonts)
 *   are deliberately left to the browser: a fetch made from a service worker is
 *   checked against the CSP's connect-src, which does not allow them, so
 *   proxying them turned working font loads into network errors. Do not add a
 *   cache for them here; widen the CSP first (Caddyfile and vite.config.ts).
 * - Every handler must resolve respondWith() to a real Response (Response.error()
 *   at worst) - resolving to undefined throws "Failed to convert value to
 *   'Response'" and breaks the request.
 * - A service worker belongs to ONE origin (scheme + host + port). One registered
 *   for an address that is no longer served (e.g. an old http://localhost:8080)
 *   keeps serving the cached app shell there while every API call fails, which
 *   looks like a broken login. Unregister it in DevTools > Application.
 */
const VERSION = "__SW_VERSION__";
const PRECACHE = self.__PRECACHE__ || [];
const STATIC_CACHE = `ala-eh-static-${VERSION}`;

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
                key === "ala-eh-api-v1" ||
                key === "ala-eh-fonts-v1",
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

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

  // Cross-origin requests (Google Fonts) are left to the browser. A fetch made
  // from here counts as connect-src, which the page's CSP does not open to
  // them, so proxying them only turned working font loads into network errors.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches
        .match(request, { cacheName: STATIC_CACHE })
        .then((hit) => hit || fetch(request))
        .catch(() => Response.error()),
    );
  }
});

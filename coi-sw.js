/* coi-sw.js — V221 cross-origin isolation for the Recaps app.
 *
 * The multi-thread ffmpeg core (@ffmpeg/core-mt) needs
 * SharedArrayBuffer, which browsers only expose on cross-origin
 * isolated pages. This host is static (GitHub Pages) and cannot set
 * COOP/COEP response headers, so this coi-serviceworker-style worker
 * rewrites them in on the way through:
 *
 *   - same-origin and navigation responses gain
 *     Cross-Origin-Opener-Policy: same-origin and
 *     Cross-Origin-Embedder-Policy: require-corp;
 *   - cross-origin GET responses are re-fetched and gain
 *     Cross-Origin-Resource-Policy: cross-origin, so the app's
 *     CDN subresources (ffmpeg cores, fonts) still load under COEP.
 *
 * Non-GET requests (the Gemini / Edge TTS API calls) pass through
 * completely untouched. If a re-fetch fails, the request falls back
 * to a plain fetch. The page registers this worker once at startup
 * and reloads itself exactly once on the first visit (guarded in the
 * page) so the worker controls the load that follows; if isolation
 * never arrives, the standard single-thread engine is unaffected —
 * it never needed any of this.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // pass through untouched
  event.respondWith((async () => {
    let res;
    try {
      res = await fetch(req);
    } catch (err) {
      return fetch(req);
    }
    try {
      // Opaque (no-cors) responses carry no readable status/headers
      // and cannot be rebuilt — return them as-is.
      if (!res || res.type === 'opaque' || res.status === 0) return res;
      const url = new URL(req.url);
      const sameOrigin = url.origin === self.location.origin;
      if (!sameOrigin && req.mode !== 'navigate' && !res.headers.get('cross-origin-resource-policy')) {
        // Under COEP a cross-origin response is accepted when it is a
        // CORS response; fonts/CDN assets here are fetched no-cors by
        // the page, so stamp CORP on the re-fetched (CORS) copy.
        const h = new Headers(res.headers);
        h.set('Cross-Origin-Resource-Policy', 'cross-origin');
        h.delete('content-length');
        h.delete('content-encoding');
        return new Response((res.status === 204 || res.status === 304) ? null : res.body,
          { status: res.status, statusText: res.statusText, headers: h });
      }
      if (sameOrigin || req.mode === 'navigate') {
        const h = new Headers(res.headers);
        h.set('Cross-Origin-Opener-Policy', 'same-origin');
        h.set('Cross-Origin-Embedder-Policy', 'require-corp');
        h.set('Cross-Origin-Resource-Policy', 'same-origin');
        h.delete('content-length');
        h.delete('content-encoding');
        return new Response((res.status === 204 || res.status === 304) ? null : res.body,
          { status: res.status, statusText: res.statusText, headers: h });
      }
      return res;
    } catch (err) {
      return res;
    }
  })());
});

// What makes Kart installable, and what lets it open on a train.
//
// Network first, cache only as the fallback. The other way round is how a
// service worker pins a game to whatever build happened to be cached the day
// someone installed it, with no way for them to know or fix it — a stale kart
// sim against a live daily is worse than no offline mode at all. The cost is
// that offline costs one failed request first, which nobody notices.

const VERSION = 'kart-v1'

const SHELL = ['/kart', '/manifest.webmanifest', '/icons/kart-192.png', '/icons/kart-512.png']

/**
 * The asset names in a built page are content-hashed, so they cannot be written
 * here — and the fetch handler cannot pick them up either, because a first visit
 * loads the whole module graph before this worker is activated and controlling
 * anything. So the worker reads the shell and takes the list from it. Crude
 * against arbitrary HTML; exact against the one page this ships with.
 */
async function shellAssets() {
  try {
    const html = await (await fetch('/kart', { cache: 'reload' })).text()
    return [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
  } catch (err) {
    console.warn('sw: could not read the shell for its assets', err)
    return []
  }
}

/**
 * cache.add(), deliberately, rather than a hand-built Request. An ES module is
 * fetched with the browser's own credentials rules and a modulepreload with
 * another set again; a request built here with different ones is stored under
 * them, and the module then fails to load from cache with nothing but a
 * net::ERR_FAILED to show for it. Letting add() do the fetch keeps that
 * agreement, and the crossorigin problem it used to work around is gone —
 * vite.config.js stops the attribute being emitted at all.
 */
async function precache(cache, url) {
  try {
    await cache.add(url)
  } catch (err) {
    console.warn(`sw: skipped ${url}`, err)
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION)
      // The shell first and on its own, so one missing asset cannot cost us the
      // page itself. Neither is a reason to refuse to install: the fetch handler
      // fills the same cache the first time the game is played.
      await cache.addAll(SHELL).catch((err) => console.warn('sw: shell skipped', err))
      const assets = await shellAssets()
      await Promise.all(assets.map((u) => precache(cache, u)))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  // Only our own GETs. A POST is never replayable, and another origin's response
  // is not ours to keep.
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return

  e.respondWith(
    fetch(request)
      .then((res) => {
        // Opaque and error responses are not worth keeping, and a partial one
        // would be served back as if it were whole.
        if (res.ok && res.type === 'basic') {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put(request, copy))
        }
        return res
      })
      .catch(async () => {
        // ignoreVary because these files are content-hashed and immutable, so
        // there is nothing they could sensibly vary on — and a server that sends
        // Vary: Origin (any dev or preview server that echoes CORS headers does)
        // otherwise makes every one of these misses, and the game boots offline
        // with its whole module graph failing on net::ERR_FAILED.
        const hit = await caches.match(request, { ignoreVary: true })
        if (hit) return hit
        // A navigation with nothing cached for that exact URL still wants the
        // game rather than the browser's offline page.
        if (request.mode === 'navigate') {
          const shell = await caches.match('/kart', { ignoreVary: true })
          if (shell) return shell
        }
        throw new Error(`offline and nothing cached for ${request.url}`)
      }),
  )
})

/* global caches, fetch, self */
// Every app on cruglobal.github.io shares ONE CacheStorage - it is keyed by ORIGIN, not by service
// worker scope, so registering with {scope:'./'} buys no isolation here. A bare version name like
// 'spotlight-0.4' identifies a VERSION but not an APP, so each app's activate sweep below used to
// delete its siblings' caches - and an offline user of a wiped app got no shell at all, with no
// self-repair until they were next online. The prefix makes the name identify the app too.
const CACHE_PREFIX = 'spotlight-campus-'   // MUST be unique per deployment
const CACHE_NAME = CACHE_PREFIX + '0.4'
const CACHED_URLS = [
  'browserconfig.xml',
  'favicon.ico',
  'a2hs.png',
  'apple-touch-icon.png',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'genericQ.png',
  'holy_spirit_presentations.png',
  'icon.png',
  'icon512.png',
  'mstile-150x150.png',
  'personal_decisions.png',
  'personal_evangelism.png',
  'Screenshot1.png',
  'Screenshot2.png',
  'spiritual_conversations.png',
  'teamQ.png',
  'safari-pinned-tab.svg',
  'share-apple.svg',
  'analytics.js',
  'lib.js',
  'masking-input.js',
  'party.min.js',
  'sw.js',
  'style.css',
  'index.html',
  'manifest.webmanifest'
]

// Open cache on install.
self.addEventListener('install', event => {
  self.skipWaiting() // don't wait for every tab to close before the new version takes over
  event.waitUntil(async function () {
    const cache = await caches.open(CACHE_NAME)

    await cache.addAll(CACHED_URLS)
  }())
})

// Cache and update with stale-while-revalidate policy.
self.addEventListener('fetch', event => {
  
  if(event.request.url.match('^.*script.google.com/macros/.*$')) {
    return false;
  }

  const { request } = event

  // Prevent Chrome Developer Tools error:
  // Failed to execute 'fetch' on 'ServiceWorkerGlobalScope': 'only-if-cached' can be set only with 'same-origin' mode
  //
  // See also https://stackoverflow.com/a/49719964/1217468
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
    return
  }

  event.respondWith(async function () {
    const cache = await caches.open(CACHE_NAME)

    const cachedResponsePromise = await cache.match(request)
    const networkResponsePromise = fetch(request)

    if (request.url.startsWith(self.location.origin)) {
      event.waitUntil(async function () {
        const networkResponse = await networkResponsePromise

        await cache.put(request, networkResponse.clone())
      }())
    }

    return cachedResponsePromise || networkResponsePromise
  }())
})

// Removes this app's OLD caches, and drains this app's files out of the legacy shared caches that
// predate CACHE_PREFIX. Deliberately never deletes a whole cache it does not own: until every app
// on the origin has deployed this change, a sibling may still be serving from one of those legacy
// caches. Once the last app has drained its own files out, the legacy cache is empty and goes.
async function sweepCaches () {
  const scope = self.registration.scope // e.g. https://cruglobal.github.io/Spotlight/
  for (const name of await caches.keys()) {
    if (name.startsWith(CACHE_PREFIX)) {
      if (name !== CACHE_NAME) { await caches.delete(name) } // our own older version
      continue
    }
    if (!/^spotlight-[\d.]+$/.test(name)) { continue } // not one of ours - never touch it
    const legacy = await caches.open(name)
    for (const request of await legacy.keys()) {
      if (request.url.startsWith(scope)) { await legacy.delete(request) }
    }
    if ((await legacy.keys()).length === 0) { await caches.delete(name) }
  }
}

// Clean up caches other than current.
self.addEventListener('activate', event => {
  self.clients.claim() // take over already-open tabs straight away
  event.waitUntil(async function () {
    await sweepCaches()
  }())
})
/* global caches, fetch, self */
const CACHE_NAME = 'spotlight-0.2'
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

// Clean up caches other than current.
self.addEventListener('activate', event => {
  event.waitUntil(async function () {
    const cacheNames = await caches.keys()

    await Promise.all(
      cacheNames.filter((cacheName) => {
        const deleteThisCache = cacheName !== CACHE_NAME
        console.log('deleting', cacheName);

        return deleteThisCache
      }).map(cacheName => caches.delete(cacheName))
    )
  }())
})
var cacheName = 'spotlight-1.0';
var prefetchedURLs = [
  'icon.png',
  'icon512.png',
  'apple-touch-icon.png',
  'browserconfig.xml',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'favicon.ico',
  'icon.png',
  'icon512.png',
  'mstile-150x150.png',
  'safari-pinned-tab.svg',
  'party.min.js',
  'masking-input.js'
  /*'lib.js',
  'sw.js',
  'style.css',
  'index.html',
  'gospel.png',
  'spirit.png',
  'decision.png',
  'manifest.webmanifest',*/
];
const l = console.log

self.addEventListener('install', function(event) {
  l('install evt')

  event.waitUntil(
    caches.open(cacheName).then((cache) => {

      return Promise.all(prefetchedURLs.map((url) => {
        return fetch(url).then(res => {
          if (res.status >= 400) throw Error('request failed: ' + url + ' failed with status: ' + res.statusText)
          return cache.put(url, res)
        })
      }))

    }).catch((err) => {
      //...
      l(err
)    })
    //...
  )
});


self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request).then(function(res) {
      if (res) {
        l('Resource found in Cache Storage')
        return res;
      }

      return fetch(event.request).then(function(res) {
        return res;
      }).catch(function(err) {
        l(err);
      });
    }));
});

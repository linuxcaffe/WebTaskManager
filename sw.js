// tw-web service worker — minimal shell cache for PWA installability
// API calls always go to network; only app shell assets are cached.

const CACHE = 'tw-web-v3';
const SHELL = [
    '/', '/index.html', '/styles.css',
    '/nav.js', '/main.js', '/task-card.js', '/task-editor.js',
    '/manifest.json', '/logo.svg', '/logo-192.png', '/logo-512.png',
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    // API calls: always network
    if (e.request.url.includes('/api/')) return;
    // App shell: cache-first
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});

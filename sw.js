// Service worker: يخلي التطبيق ينفتح بسرعة ويقبل التثبيت على الشاشة الرئيسية
const CACHE = 'sawalif-v3';
const SHELL = [
  './', 'index.html', 'css/style.css', 'js/main.js', 'js/lib.js', 'js/chat.js', 'js/games.js', 'js/config.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// الشبكة أولاً (عشان التحديثات توصل فوراً) وإذا ما فيه نت نستخدم النسخة المحفوظة
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || '#/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { c.focus(); c.navigate?.(new URL(target, self.registration.scope).href); return; }
    return self.clients.openWindow(target);
  }));
});

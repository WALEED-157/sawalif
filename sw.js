// Service worker: يخلي التطبيق ينفتح بسرعة ويقبل التثبيت على الشاشة الرئيسية
const CACHE = 'sawalif-v9';
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

// إشعار Push من السيرفر: يوصل حتى لو التطبيق مقفل
self.addEventListener('push', (e) => {
  let n = {};
  try { n = e.data ? e.data.json() : {}; } catch { n = { title: 'سوالف العائلة', body: e.data?.text() || '' }; }
  const isApple = /iphone|ipad|ipod|macintosh/i.test(self.navigator.userAgent);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    // التطبيق مفتوح قدامه؟ التطبيق نفسه يطلع الصوت والتنبيه، فما نكرر (آبل تشترط إشعار دايم)
    if (!isApple && list.some((c) => c.visibilityState === 'visible' && c.focused)) return;
    return self.registration.showNotification(n.title || 'سوالف العائلة', {
      body: n.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: n.tag || 'msg',
      renotify: true,
      requireInteraction: !!n.buzz,
      vibrate: n.buzz ? [800, 200, 800, 200, 800, 200, 800] : [200, 100, 200],
      data: { url: n.url || '#/' },
    });
  }));
});

// التطبيق انفتح → امسح كل الإشعارات اللي فوق
self.addEventListener('message', (e) => {
  if (e.data?.clearNotifications) {
    e.waitUntil(self.registration.getNotifications().then((ns) => ns.forEach((n) => n.close())));
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  // الرابط لازم يكون على صفحة التطبيق نفسها (مو على ملف sw.js)
  const hash = (e.notification.data?.url || '#/').replace(/^[^#]*/, '');
  const target = new URL(self.registration.scope).href.split('#')[0] + hash;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
    const c = list.find((w) => w.url.startsWith(self.registration.scope) && !w.url.includes('sw.js'));
    if (c) { await c.focus(); c.postMessage({ nav: hash }); return; }
    return self.clients.openWindow(target);
  }));
});

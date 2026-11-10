// Service worker: يخلي التطبيق ينفتح بسرعة ويقبل التثبيت على الشاشة الرئيسية
const CACHE = 'sawalif-v1.7'; // نفس رقم الإصدار في js/main.js
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

// المكتبات والخطوط (روابطها ثابتة بالإصدار): نحفظها بالجوال ونستخدمها على طول بدون انتظار النت
const STATIC_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (STATIC_HOSTS.includes(url.host)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return;
  // ملفات التطبيق: الشبكة أولاً (عشان التحديثات توصل فوراً)، بس لو النت بطيء أكثر من 3 ثواني نستخدم النسخة المحفوظة
  // cache: 'no-cache' = نسأل GitHub كل مرة إذا الملف تغيّر (GitHub يخلي المتصفح يحتفظ بالقديم 10 دقايق)
  const net = fetch(e.request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  });
  const fallback = () => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined));
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => fallback().then(finish), 3000);
    net.then((r) => { clearTimeout(timer); finish(r); })
      .catch(() => { clearTimeout(timer); fallback().then((r) => (r ? finish(r) : (done = true, resolve(Response.error())))); });
  }));
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
      vibrate: n.buzz ? [1000, 300, 1000, 300, 1000, 300, 1000, 300, 1000] : [200, 100, 200],
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

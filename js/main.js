import {
  sb, S, bus, rpc, el, icon, toast, guard, sheet, ask, go, goRoot, back, av, empty, spinner, skeletonRows, copy, fmtTime,
  configured, APP_NAME, DEMO, avatarPicker, field, previewText, debounce, toLatinDigits, addCleanup, runCleanup, niceError,
  playMessageSound, startRingtone, soundLevel, setSoundLevel, navbar, settingRow, closeTopOverlay, pushOverlay,
} from './lib.js';
import { CONFIG } from './config.js';
import { renderChat } from './chat.js';
import { renderGame, GAMES, SOLO, startGame } from './games.js';

const app = document.getElementById('app');
let routeSeq = 0;

// =============================================================
//  التشغيل
// =============================================================
async function boot() {
  document.title = APP_NAME;
  if (!configured) return notConfigured();
  if ('serviceWorker' in navigator && !DEMO) navigator.serviceWorker.register('sw.js').catch(() => {});
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installPrompt = e; setInstalled(false); });
  addEventListener('appinstalled', () => { S.installPrompt = null; setInstalled(true); if (S.path === '/me') bus.emit('refresh-tab'); });
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) setInstalled(true);

  const hadAuthHash = /access_token=|error_description=|type=recovery/.test(location.hash);
  const errMatch = location.hash.match(/error_description=([^&]+)/);
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  if (hadAuthHash) {
    history.replaceState(null, '', location.pathname + location.search + '#/');
    if (errMatch) toast(decodeURIComponent(errMatch[1].replace(/\+/g, ' ')), 'err');
  }
  S.path = location.hash.slice(1) || '/';

  // منع زر الرجوع حق الجوال/المتصفح من التنقل: يقفل النوافذ المفتوحة فقط
  history.replaceState({ trap: 0 }, '', location.href);
  history.pushState({ trap: 1 }, '', location.href);
  addEventListener('popstate', (e) => {
    if (e.state?.trap === undefined) return; // تغيير رابط من برا (يتعامل معه hashchange)
    history.pushState({ trap: 1 }, '', location.pathname + location.search + '#' + S.path);
    closeTopOverlay();
  });
  // روابط خارجية (مثل رابط QR أو التنبيهات) تغيّر الـ hash مباشرة
  addEventListener('hashchange', () => {
    const p = location.hash.slice(1) || '/';
    if (p !== S.path) { S.path = p; route(); }
  });
  bus.on('route', route);

  sb.auth.onAuthStateChange((event, session) => {
    S.session = session;
    if (event === 'SIGNED_OUT') { S.me = null; stopRealtime(); setTimeout(() => goRoot('/'), 0); }
    if (event === 'PASSWORD_RECOVERY') setTimeout(newPasswordSheet, 0);
  });
  route();
}

// نتذكر إن التطبيق متثبّت عشان زر التثبيت يختفي حتى لو انفتح من المتصفح
function appInstalled() { try { return localStorage.getItem('fc_installed') === '1'; } catch { return false; } }
function setInstalled(v) { try { v ? localStorage.setItem('fc_installed', '1') : localStorage.removeItem('fc_installed'); } catch { /* ignore */ } }

function parsePath() {
  const [path, qs] = (S.path || '/').split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(qs || '') };
}

async function route() {
  const seq = ++routeSeq;
  runCleanup();
  while (closeTopOverlay()) { /* اقفل أي نافذة مفتوحة */ }
  const { parts, params } = parsePath();
  try {
    if (parts[0] === 'pair') return await renderPair(params.get('t'));
    if (!S.session) return renderAuth();
    if (!S.me) S.me = await rpc('my_profile');
    if (seq !== routeSeq) return;
    if (!S.me) return S.session.user.is_anonymous ? renderAnonNoProfile() : renderOnboarding();
    if (notifGateNeeded()) return renderNotifGate();
    ensurePush();
    startRealtime();
    maybeCleanupMedia();

    switch (parts[0]) {
      case undefined: return await shell('chats', 'المحادثات', tabChats);
      case 'friends': return await shell('friends', 'الأصدقاء', tabFriends);
      case 'games': return await shell('games', 'الألعاب', tabGames);
      case 'family': return S.me.role === 'parent' ? await shell('family', 'العائلة', tabFamily) : goRoot('/');
      case 'me': return await shell('me', 'حسابي', tabMe);
      case 'watch': return S.me.role === 'parent' ? await renderWatch(parts[1]) : goRoot('/');
      case 'chat': app.replaceChildren(spinner()); return await renderChat(app, parts[1]);
      case 'game': app.replaceChildren(spinner()); return await renderGame(app, parts[1]);
      default: return goRoot('/');
    }
  } catch (e) {
    console.error(e);
    if (seq !== routeSeq) return;
    app.replaceChildren(el('div', { class: 'center-page' }, el('div', { class: 'card center' },
      el('div', { class: 'empty-art' }, '😕'),
      el('h3', null, 'صار خطأ'),
      el('p', { class: 'muted' }, niceError(e)),
      el('div', { class: 'row-btns stretch' },
        el('button', { class: 'btn primary', onclick: () => route() }, 'حاول مرة ثانية'),
        el('button', { class: 'btn soft', onclick: () => goRoot('/') }, 'الرئيسية')))));
  }
}

// =============================================================
//  اشتراك Push: يربط الجهاز بالسيرفر عشان الإشعارات توصل والتطبيق مقفل
// =============================================================
let pushDone = false;
let pushActive = false;
const b64ToBytes = (s) => {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
async function ensurePush() {
  if (pushDone || DEMO || !CONFIG.VAPID_PUBLIC_KEY) return;
  pushDone = true;
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const key = b64ToBytes(CONFIG.VAPID_PUBLIC_KEY);
    // اشتراك قديم بمفتاح ثاني؟ نجدده
    if (sub && sub.options?.applicationServerKey) {
      const old = new Uint8Array(sub.options.applicationServerKey);
      if (old.length !== key.length || old.some((v, i) => v !== key[i])) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const j = sub.toJSON();
    await rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    pushActive = true;
  } catch (e) { console.warn('push subscribe failed', e); pushDone = false; }
}
async function dropPush() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) { await rpc('delete_push_subscription', { p_endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  } catch { /* ignore */ }
}

// =============================================================
//  شاشة إجبارية: تفعيل التنبيهات قبل استخدام التطبيق
// =============================================================
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function notifGateNeeded() {
  if (DEMO) return new URLSearchParams(location.search).has('gate') && !window.__gatePassed;
  if ('Notification' in window) return Notification.permission !== 'granted';
  return isIOS() && !isStandalone(); // آيفون في Safari: لازم يضيفه للشاشة الرئيسية أول
}

let gateWatch = false;
function watchPermission() {
  if (gateWatch) return; gateWatch = true;
  // لما يرجع من الإعدادات بعد ما فعّلها، يكمل تلقائياً
  const recheck = () => { if (!document.hidden && S.me && !notifGateNeeded() && app.querySelector('.notif-gate')) route(); };
  document.addEventListener('visibilitychange', recheck);
  navigator.permissions?.query({ name: 'notifications' }).then((p) => { p.onchange = recheck; }).catch(() => {});
}

function renderNotifGate() {
  watchPermission();
  const kid = S.me.role !== 'parent';
  const state = DEMO ? (window.__demoPerm || 'default') : ('Notification' in window ? Notification.permission : 'install');
  const step = (n, t) => el('div', { class: 'gate-step' }, el('b', null, n), el('span', null, t));
  let body;

  if (state === 'install') {
    body = [
      el('h2', null, 'أضف التطبيق للشاشة الرئيسية'),
      el('p', { class: 'muted' }, 'في الآيفون التنبيهات ما تشتغل إلا بعد إضافة التطبيق للشاشة الرئيسية.'),
      el('div', { class: 'gate-steps' },
        step('1', 'اضغط زر المشاركة ⬆️ تحت في Safari'),
        step('2', 'اختر «إضافة إلى الشاشة الرئيسية»'),
        step('3', 'افتح التطبيق من الأيقونة الجديدة')),
    ];
  } else if (state === 'denied') {
    const steps = isIOS()
      ? [step('1', 'افتح «الإعدادات» في الجوال'), step('2', 'الإشعارات ← ' + APP_NAME), step('3', 'فعّل «السماح بالإشعارات» وارجع هنا')]
      : isStandalone()
        ? [step('1', 'اضغط مطوّل على أيقونة التطبيق'), step('2', 'معلومات التطبيق ⓘ ← الإشعارات'), step('3', 'فعّلها وارجع هنا')]
        : [step('1', 'اضغط على 🔒 أو ⓘ جنب الرابط فوق'), step('2', 'الأذونات ← الإشعارات ← سماح'), step('3', 'ارجع هنا واضغط الزر تحت')];
    body = [
      el('h2', null, 'التنبيهات مقفلة'),
      el('p', { class: 'muted' }, 'سبق ورفضت التنبيهات، والجوال ما يسمح نطلبها مرة ثانية. فعّلها يدوياً:'),
      el('div', { class: 'gate-steps' }, ...steps),
      el('button', { class: 'btn primary block', onclick: () => route() }, 'فعّلتها، كمّل'),
    ];
  } else {
    body = [
      el('h2', null, 'فعّل التنبيهات'),
      el('p', { class: 'muted' }, kid
        ? 'عشان توصلك رسائل أهلك وأصدقائك ويرن جوالك لما أحد ينبهك 🔔'
        : 'عشان توصلك رسائل العائلة وتنبيهات الأمان عن أطفالك فوراً'),
      el('button', { class: 'btn primary block lg', onclick: (ev) => guard(async () => {
        playMessageSound(); // يفتح الصوت في المتصفح من أول ضغطة
        const r = DEMO ? (window.__demoPerm = 'granted') : await Notification.requestPermission();
        if (r === 'granted') {
          if (DEMO) window.__gatePassed = true;
          toast('تم تفعيل التنبيهات ✅', 'ok');
          route();
        } else renderNotifGate();
      }, ev.currentTarget) }, icon('bell'), 'سماح بالتنبيهات'),
    ];
  }

  app.replaceChildren(el('div', { class: 'center-page notif-gate' }, el('div', { class: 'card center gate-card' },
    el('div', { class: 'gate-bell' }, '🔔'),
    ...body,
    el('p', { class: 'gate-note' }, 'هذي الخطوة ضرورية لاستخدام التطبيق'))));
}

// =============================================================
//  التحديث الفوري
// =============================================================
let rt = null;
function startRealtime() {
  if (rt) return;
  rt = sb.channel('inbox-' + S.me.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => onNewMessage(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) => bus.emit('message_update', p.new))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_views' }, (p) => bus.emit('view', p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, (p) => { if (p.new?.id) bus.emit('game', p.new); })
    .subscribe();
}
function stopRealtime() { if (rt) { sb.removeChannel(rt); rt = null; } }

async function refreshMemberConvs() {
  try { const l = await rpc('my_conversations'); S.memberConvs = new Set(l.map((c) => c.id)); } catch { /* ignore */ }
}

async function onNewMessage(m) {
  bus.emit('message', m);
  bus.emit('refresh-chats');
  if (!S.me || m.sender_id === S.me.id || m.kind === 'system') return;
  if (!S.memberConvs.has(m.conversation_id)) await refreshMemberConvs();
  if (!S.memberConvs.has(m.conversation_id)) return; // محادثة مراقبة فقط
  if (m.kind === 'buzz') return buzzAlert(m);
  if (S.currentConv === m.conversation_id && !document.hidden) return;
  playMessageSound();
  const text = (previewText(m.kind, m.body) || '').slice(0, 70);
  if (document.hidden && !pushActive && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const opts = { body: text, icon: 'icons/icon-192.png', tag: m.conversation_id, data: { url: '#/chat/' + m.conversation_id } };
      if (reg) reg.showNotification(APP_NAME, opts); else new Notification(APP_NAME, opts);
    } catch { /* ignore */ }
  } else {
    banner(text, () => go('/chat/' + m.conversation_id));
  }
}

// تنبيه قوي: رنّة + اهتزاز + شاشة كاملة لين المستخدم يضغط
let buzzOpen = false;
async function buzzAlert(m) {
  if (buzzOpen) return;
  buzzOpen = true;
  let who = { name: 'أحد', avatar: '🔔' };
  try { const info = await rpc('conversation_info', { p_conv: m.conversation_id }); who = info.members.find((x) => x.id === m.sender_id) || who; } catch { /* ignore */ }
  const stop = startRingtone(20);
  if (document.hidden && !pushActive && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      reg?.showNotification(`🔔 ${who.name} ينبهك!`, { body: 'افتح التطبيق', tag: 'buzz', renotify: true, requireInteraction: true, vibrate: [600, 200, 600, 200, 600], data: { url: '#/chat/' + m.conversation_id } });
    } catch { /* ignore */ }
  }
  let unreg = () => {};
  const close = (open) => { stop(); unreg(); wrap.remove(); buzzOpen = false; if (open) go('/chat/' + m.conversation_id); };
  const wrap = el('div', { class: 'buzz-screen', role: 'alertdialog', 'aria-label': 'تنبيه' },
    el('div', { class: 'buzz-center' }, el('div', { class: 'buzz-rings' }, el('i'), el('i'), el('i')), el('span', { class: 'av xxl buzz-av' }, who.avatar)),
    el('h1', null, who.name),
    el('p', null, 'ينبهك! 🔔'),
    el('div', { class: 'buzz-actions' },
      el('button', { class: 'btn glass lg', onclick: () => close(false) }, 'إيقاف'),
      el('button', { class: 'btn lg buzz-open', onclick: () => close(true) }, icon('chat'), 'فتح المحادثة')));
  document.body.append(wrap);
  unreg = pushOverlay(() => close(false));
}

function banner(text, onclick) {
  const b = el('button', { class: 'msg-banner', onclick: () => { b.remove(); onclick(); } },
    el('span', { class: 'banner-ic' }, icon('chat')),
    el('div', { class: 'row-main' }, el('b', null, 'رسالة جديدة'), el('small', { class: 'ellipsis' }, text)));
  document.body.append(b);
  setTimeout(() => b.classList.add('show'), 10);
  setTimeout(() => { b.classList.remove('show'); setTimeout(() => b.remove(), 300); }, 4500);
}

// تنظيف الوسائط القديمة (أكثر من 24 ساعة) — من أي جهاز، مرة كل ساعتين
async function maybeCleanupMedia() {
  if (DEMO) return;
  let last = 0;
  try { last = +localStorage.getItem('fc_cleanup') || 0; } catch { /* ignore */ }
  if (Date.now() - last < 2 * 3600e3) return;
  try { localStorage.setItem('fc_cleanup', String(Date.now())); } catch { /* ignore */ }
  try {
    const rows = await rpc('expired_media');
    if (!rows?.length) return;
    await sb.storage.from('media').remove(rows.map((r) => r.media_path));
    await rpc('mark_media_expired', { p_ids: rows.map((r) => r.id) });
  } catch (e) { console.warn('cleanup', e); }
}

// =============================================================
//  شاشات البداية
// =============================================================
const brandMark = (big) => el('div', { class: 'brand-mark' + (big ? ' big' : '') }, icon('chat'));

function notConfigured() {
  app.replaceChildren(el('div', { class: 'center-page' }, el('div', { class: 'card center' },
    el('div', { class: 'empty-art' }, '🛠️'),
    el('h2', null, 'باقي خطوة الإعداد'),
    el('p', null, 'افتح ملف ', el('code', null, 'js/config.js'), ' وحط فيه رابط مشروع Supabase والمفتاح.'),
    el('p', { class: 'muted' }, 'الشرح كامل في ملف README.md'))));
}

function renderAuth() {
  let mode = 'login';
  const email = el('input', { class: 'input', type: 'email', autocomplete: 'email', placeholder: 'name@example.com', dir: 'ltr', required: true });
  const pass = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: '••••••••', dir: 'ltr', required: true, minlength: '6' });
  const submit = el('button', { class: 'btn primary block lg', type: 'submit' }, 'دخول');
  const title = el('div', { class: 'card-title' });
  const switcher = el('p', { class: 'auth-switch' });
  const forgot = el('button', { type: 'button', class: 'link', onclick: () => guard(async () => {
    if (!email.value) throw new Error('اكتب إيميلك أولاً');
    const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
    if (error) throw error;
    toast('أرسلنا لك رابط لتغيير كلمة المرور', 'ok');
  }) }, 'نسيت كلمة المرور؟');

  const drawTabs = () => {
    const toggle = (m) => () => { mode = m; drawTabs(); };
    title.replaceChildren(icon('shield'), mode === 'login' ? 'دخول الأهل' : 'حساب جديد للأهل');
    switcher.replaceChildren(...(mode === 'login'
      ? ['أول مرة؟ ', el('button', { type: 'button', class: 'link', onclick: toggle('signup') }, 'سجّل حساب جديد')]
      : ['عندك حساب؟ ', el('button', { type: 'button', class: 'link', onclick: toggle('login') }, 'سجّل دخول')]));
    submit.textContent = mode === 'login' ? 'دخول' : 'إنشاء حساب';
    pass.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    forgot.style.display = mode === 'login' ? '' : 'none';
  };
  drawTabs();

  const form = el('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); guard(async () => {
    const creds = { email: email.value.trim(), password: pass.value };
    if (mode === 'login') {
      const { data, error } = await sb.auth.signInWithPassword(creds);
      if (error) throw error;
      S.session = data.session; S.me = null; route();
    } else {
      const { data, error } = await sb.auth.signUp({ ...creds, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      if (data.session) { S.session = data.session; S.me = null; route(); }
      else toast('أرسلنا لك إيميل تأكيد، افتحه وبعدين سجّل دخول', 'ok');
    }
  }, submit); } },
  field('الإيميل', email), field('كلمة المرور', pass), submit, forgot);

  app.replaceChildren(el('div', { class: 'center-page auth' },
    el('div', { class: 'hero' }, brandMark(true), el('h1', null, APP_NAME), el('p', { class: 'muted' }, 'دردشة آمنة تجمع العائلة')),
    el('div', { class: 'card' }, title, form),
    el('div', { class: 'card kid-card' },
      el('span', { class: 'kid-ic' }, icon('qr')),
      el('div', null, el('b', null, 'أنت طفل؟'), el('p', { class: 'muted small' }, 'اطلب من أبوك أو أمك يفتحون لك "كود الدخول" وامسحه بكاميرا جوالك'))),
    switcher));
}

function newPasswordSheet() {
  const pass = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', dir: 'ltr', minlength: '6' });
  const btn = el('button', { class: 'btn primary block' }, 'حفظ');
  const close = sheet('كلمة مرور جديدة', el('div', { class: 'stack' }, field('كلمة المرور الجديدة', pass), btn));
  btn.onclick = () => guard(async () => {
    const { error } = await sb.auth.updateUser({ password: pass.value });
    if (error) throw error;
    toast('تم تغيير كلمة المرور', 'ok'); close();
  }, btn);
}

async function renderPair(token) {
  app.replaceChildren(el('div', { class: 'center-page' }, el('div', { class: 'card center' }, spinner(), el('p', null, 'جاري تسجيل الدخول...'))));
  try {
    if (!token) throw new Error('الرابط ناقص، امسح الكود مرة ثانية');
    const { data: { session } } = await sb.auth.getSession();
    if (session && !session.user.is_anonymous) {
      throw new Error('هذا الجهاز مسجّل عليه حساب ولي أمر. الكود هذا يُمسح من جوال الطفل.');
    }
    if (!session) {
      const { data, error } = await sb.auth.signInAnonymously();
      if (error) throw error;
      S.session = data.session;
    }
    await rpc('claim_pairing', { p_token: token });
    S.me = null;
    toast('أهلاً فيك! 🎉', 'ok');
    goRoot('/');
  } catch (e) {
    app.replaceChildren(el('div', { class: 'center-page' }, el('div', { class: 'card center' },
      el('div', { class: 'empty-art' }, '😕'), el('h3', null, 'ما قدرنا ندخل'), el('p', { class: 'muted' }, niceError(e)),
      el('button', { class: 'btn soft', onclick: () => goRoot('/') }, 'رجوع'))));
  }
}

function renderAnonNoProfile() {
  app.replaceChildren(el('div', { class: 'center-page' }, el('div', { class: 'card center' },
    el('div', { class: 'empty-art' }, '📷'),
    el('h3', null, 'هذا الجهاز مو مربوط بحساب'),
    el('p', { class: 'muted' }, 'يمكن أهلك فتحوا كود جديد من جهاز ثاني. اطلب منهم كود دخول جديد وامسحه.'),
    el('button', { class: 'btn soft', onclick: () => sb.auth.signOut() }, 'رجوع لشاشة الدخول'))));
}

function renderOnboarding() {
  let mode = 'create';
  const box = el('div');
  const draw = () => {
    const name = el('input', { class: 'input', placeholder: 'مثلاً: أبو محمد', maxlength: '30' });
    const pick = avatarPicker('👨');
    const seg = el('div', { class: 'seg' },
      el('button', { class: mode === 'create' ? 'on' : '', onclick: () => { mode = 'create'; draw(); } }, 'عائلة جديدة'),
      el('button', { class: mode === 'join' ? 'on' : '', onclick: () => { mode = 'join'; draw(); } }, 'انضم لعائلتي'));
    const btn = el('button', { class: 'btn primary block lg' }, mode === 'create' ? 'إنشاء العائلة' : 'انضمام');
    let fields;
    if (mode === 'create') {
      const code = el('input', { class: 'input', placeholder: 'الرمز من صاحب التطبيق', dir: 'ltr' });
      const fam = el('input', { class: 'input', placeholder: 'مثلاً: عائلة أحمد', maxlength: '40' });
      fields = [field('رمز التسجيل', code, 'رمز سري يعطيك إياه اللي ركّب التطبيق'), field('اسم العائلة', fam)];
      btn.onclick = () => guard(async () => {
        await rpc('create_family', { p_signup_code: code.value, p_family_name: fam.value, p_name: name.value, p_avatar: pick.value });
        S.me = null; toast('تم إنشاء العائلة 🎉', 'ok'); goRoot('/family');
      }, btn);
    } else {
      const inv = el('input', { class: 'input', placeholder: 'K7M2QX9A', dir: 'ltr', style: { textTransform: 'uppercase' } });
      fields = [field('رمز العائلة', inv, 'تلقاه عند الزوج/الزوجة في صفحة "العائلة"')];
      btn.onclick = () => guard(async () => {
        await rpc('join_family', { p_invite_code: inv.value, p_name: name.value, p_avatar: pick.value });
        S.me = null; toast('أهلاً فيك بالعائلة 🎉', 'ok'); goRoot('/');
      }, btn);
    }
    box.replaceChildren(el('div', { class: 'card stack' }, seg, ...fields, field('اسمك (يظهر للعائلة)', name),
      el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'اختر صورتك'), pick.node), btn));
  };
  draw();
  app.replaceChildren(el('div', { class: 'center-page' },
    el('div', { class: 'hero' }, brandMark(true), el('h1', null, 'أهلاً فيك!'), el('p', { class: 'muted' }, 'خلنا نجهز حساب العائلة')),
    box,
    el('button', { class: 'link', onclick: () => sb.auth.signOut() }, 'تسجيل خروج')));
}

// =============================================================
//  الإطار الرئيسي + التبويبات
// =============================================================
async function shell(tab, title, fill) {
  const nav = S.me.role === 'parent'
    ? [['chats', '/', 'chat', 'المحادثات'], ['friends', '/friends', 'users', 'الأصدقاء'], ['games', '/games', 'game', 'الألعاب'], ['family', '/family', 'home', 'العائلة']]
    : [['chats', '/', 'chat', 'المحادثات'], ['friends', '/friends', 'users', 'الأصدقاء'], ['games', '/games', 'game', 'الألعاب'], ['me', '/me', 'user', 'حسابي']];
  const isSubMe = tab === 'me' && S.me.role === 'parent';
  const main = el('main', { class: 'page' }, skeletonRows(4));
  const header = el('header', { class: 'appbar' },
    el('div', { class: 'appbar-top' },
      isSubMe ? el('button', { class: 'icon-btn', 'aria-label': 'رجوع', onclick: () => back('/family') }, icon('back')) : null,
      el('div', { class: 'brand' }, brandMark(), el('span', null, APP_NAME)),
      isSubMe ? null : el('button', { class: 'me-btn', onclick: () => go('/me'), 'aria-label': 'حسابي' }, av(S.me.avatar, 'sm', S.me.id))),
    el('h1', { class: 'page-title' }, title));
  const navEl = el('nav', { class: 'tabbar', 'aria-label': 'التنقل' }, nav.map(([id, href, ic, label]) =>
    el('button', { class: 'tab' + (id === tab ? ' on' : ''), 'data-tab': id, 'aria-current': id === tab ? 'page' : null, onclick: () => goRoot(href) },
      el('span', { class: 'ti' }, icon(ic), el('i', { class: 'dot' })), el('span', { class: 'tl' }, label))));
  app.replaceChildren(el('div', { class: 'shell' + (isSubMe ? ' no-tabs' : '') }, header, main, isSubMe ? null : navEl));

  const refresh = async () => { const node = await fill(); main.replaceChildren(...[].concat(node).filter(Boolean)); };
  await refresh();
  if (!isSubMe) updateBadges(navEl);
  const offs = [
    bus.on('refresh-chats', debounce(() => { if (tab === 'chats') refresh().catch(() => {}); if (!isSubMe) updateBadges(navEl); }, 500)),
    bus.on('refresh-tab', () => refresh().catch((e) => toast(niceError(e), 'err'))),
  ];
  addCleanup(() => offs.forEach((f) => f()));
}

async function updateBadges(navEl) {
  try {
    const convs = await rpc('my_conversations');
    S.memberConvs = new Set(convs.map((c) => c.id));
    setDot(navEl, 'chats', convs.reduce((a, c) => a + (c.unread || 0), 0));
    if (S.me.role === 'parent') {
      const reqs = await rpc('my_requests');
      const n = reqs.filter((r) => r.can_approve).length;
      setDot(navEl, 'family', n); setDot(navEl, 'friends', n);
    }
  } catch { /* ignore */ }
}
function setDot(navEl, tab, n) {
  const d = navEl.querySelector(`[data-tab="${tab}"] .dot`);
  if (d) { d.textContent = n > 99 ? '99+' : (n || ''); d.classList.toggle('show', n > 0); }
}

function statusBanners() {
  const out = [];
  if (S.me.muted) out.push(el('div', { class: 'note warn' }, icon('lock'), 'الإرسال موقوف مؤقتاً من الأهل'));
  if (S.me.in_quiet) out.push(el('div', { class: 'note' }, icon('moon'), 'الحين وقت الراحة، ترجع الرسائل بعدين'));
  return out;
}

const section = (title, ...kids) => el('section', { class: 'sec' }, title ? el('h2', { class: 'sec-title' }, title) : null, ...kids);

function convTitle(c) { return c.kind === 'direct' ? (c.other_name || 'محادثة') : c.title; }
function convRow(c, onclick) {
  const preview = previewText(c.preview_kind, c.preview) || (c.kind === 'group' ? `${c.member_count} أعضاء` : 'ابدأ السالفة 👋');
  return el('button', { class: 'row conv' + (c.unread ? ' unread' : ''), onclick },
    av(c.kind === 'direct' ? c.other_avatar : c.emoji, 'lg', c.kind === 'direct' ? c.other_id : c.id),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-top' }, el('b', { class: 'ellipsis' }, convTitle(c)), el('time', null, fmtTime(c.last_message_at))),
      el('div', { class: 'row-sub' },
        el('span', { class: 'ellipsis' }, preview),
        c.unread ? el('span', { class: 'badge' }, c.unread > 99 ? '99+' : c.unread) : null)));
}

function contactRow(p, onclick, extra) {
  const sub = p.same_family ? (p.role === 'parent' ? 'ولي أمر · العائلة' : 'من العائلة') : p.family;
  return el('div', { class: 'row' },
    av(p.avatar, 'md', p.id),
    el('div', { class: 'row-main' }, el('b', null, p.name), el('small', { class: 'muted' }, sub)),
    extra || el('button', { class: 'icon-btn tint', 'aria-label': `محادثة ${p.name}`, onclick }, icon('chat')));
}

// ---------- المحادثات ----------
async function tabChats() {
  const list = await rpc('my_conversations');
  S.memberConvs = new Set(list.map((c) => c.id));
  const listBox = el('div', { class: 'list' });
  const drawList = (q = '') => {
    const f = q ? list.filter((c) => convTitle(c).includes(q)) : list;
    listBox.replaceChildren(...f.map((c) => convRow(c, () => go('/chat/' + c.id))));
    if (!f.length && q) listBox.replaceChildren(el('div', { class: 'row muted' }, 'ما فيه نتائج'));
  };
  drawList();
  const search = el('label', { class: 'search' }, icon('search'),
    el('input', { type: 'search', placeholder: 'بحث', 'aria-label': 'بحث في المحادثات', oninput: (e) => drawList(e.target.value.trim()) }));
  return [
    ...statusBanners(),
    list.length > 4 ? search : null,
    list.length ? listBox : empty('ما عندك محادثات للحين', 'اضغط زر الكتابة وابدأ سالفة مع عائلتك أو أصدقائك', '💬'),
    el('button', { class: 'fab', onclick: () => guard(newChatSheet), 'aria-label': 'محادثة جديدة' }, icon('compose')),
  ];
}

async function newChatSheet() {
  const contacts = await rpc('my_contacts');
  const close = sheet('محادثة جديدة', el('div', { class: 'stack' },
    settingRow({ ic: 'users', tone: 'violet', title: 'قروب جديد', sub: 'سوالف مع أكثر من شخص', onclick: () => { close(); newGroupSheet(contacts); } }),
    contacts.length
      ? el('div', { class: 'list flat' }, contacts.map((p) => contactRow(p, () => guard(async () => {
        const id = await rpc('start_dm', { p_other: p.id }); close(); go('/chat/' + id);
      }))))
      : empty('ما عندك أصدقاء للحين', 'روح لصفحة الأصدقاء وأضف صديقك برقمه', '👫')));
}

function newGroupSheet(contacts) {
  const EMOJIS = ['👥', '🎮', '⚽', '📚', '🌟', '🎉', '🦁', '🚀', '🏖️', '🎨'];
  let emoji = EMOJIS[0];
  const chosen = new Set();
  const title = el('input', { class: 'input', placeholder: 'اسم القروب', maxlength: '40' });
  const emojiRow = el('div', { class: 'chip-row' });
  const drawEmoji = () => emojiRow.replaceChildren(...EMOJIS.map((e) =>
    el('button', { type: 'button', class: 'chip big' + (e === emoji ? ' on' : ''), onclick: () => { emoji = e; drawEmoji(); } }, e)));
  drawEmoji();
  const btn = el('button', { class: 'btn primary block lg' }, 'إنشاء القروب');
  const close = sheet('قروب جديد', el('div', { class: 'stack' },
    field('اسم القروب', title),
    el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'الأيقونة'), emojiRow),
    el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'الأعضاء'), el('small', { class: 'muted' }, 'لازم كل الأعضاء يكونون أصدقاء مع بعض')),
    el('div', { class: 'list flat' }, contacts.map((p) => {
      const cb = el('input', { type: 'checkbox', class: 'check', onchange: () => (cb.checked ? chosen.add(p.id) : chosen.delete(p.id)) });
      return el('label', { class: 'row' }, av(p.avatar, 'md', p.id),
        el('div', { class: 'row-main' }, el('b', null, p.name), el('small', { class: 'muted' }, p.same_family ? 'من العائلة' : p.family)), cb);
    })),
    btn), { full: true });
  btn.onclick = () => guard(async () => {
    const id = await rpc('create_group', { p_title: title.value, p_emoji: emoji, p_members: [...chosen] });
    close(); go('/chat/' + id);
  }, btn);
}

// ---------- الأصدقاء ----------
function requestStatus(r) {
  if (r.status === 'rejected') return 'رفضه الأهل';
  const mineOk = r.from_mine ? r.from_ok : r.to_ok;
  const otherOk = r.from_mine ? r.to_ok : r.from_ok;
  if (!mineOk && !otherOk) return 'ننتظر موافقة الأهل من الطرفين';
  if (!mineOk) return 'ننتظر موافقة أهلك';
  return 'ننتظر موافقة أهل صديقك';
}

function approvalCard(r) {
  return el('div', { class: 'card req' },
    el('div', { class: 'req-people' },
      el('div', { class: 'req-p' }, av(r.from_avatar, 'lg', r.from_id), el('b', null, r.from_name), el('small', { class: 'muted' }, r.from_family)),
      el('span', { class: 'req-arrow' }, icon('userPlus')),
      el('div', { class: 'req-p' }, av(r.to_avatar, 'lg', r.to_id), el('b', null, r.to_name), el('small', { class: 'muted' }, r.to_family))),
    el('p', { class: 'center muted small' }, `${r.from_name} يبي يضيف ${r.to_name}`),
    el('div', { class: 'row-btns stretch' },
      el('button', { class: 'btn primary', onclick: (e) => guard(async () => { await rpc('respond_friend_request', { p_id: r.id, p_approve: true }); toast('تمت الموافقة', 'ok'); bus.emit('refresh-tab'); }, e.currentTarget) }, icon('check'), 'موافق'),
      el('button', { class: 'btn soft', onclick: (e) => guard(async () => { await rpc('respond_friend_request', { p_id: r.id, p_approve: false }); toast('تم الرفض'); bus.emit('refresh-tab'); }, e.currentTarget) }, 'رفض')));
}

async function tabFriends() {
  const [contacts, reqs] = await Promise.all([rpc('my_contacts'), rpc('my_requests')]);
  const input = el('input', { class: 'input code-input', inputmode: 'numeric', maxlength: '6', placeholder: '000000', dir: 'ltr', autocomplete: 'off', 'aria-label': 'رقم صديقك' });
  const addBtn = el('button', { class: 'btn primary' }, icon('userPlus'), 'إضافة');
  const sendReq = () => guard(async () => {
    const code = toLatinDigits(input.value).replace(/\D/g, '');
    if (code.length !== 6) throw new Error('الرقم التعريفي 6 أرقام');
    const r = await rpc('send_friend_request', { p_code: code });
    input.value = '';
    toast(`انرسل الطلب لـ ${r.name} — ننتظر موافقة الأهل`, 'ok');
    bus.emit('refresh-tab');
  }, addBtn);
  addBtn.onclick = sendReq;
  input.onkeydown = (e) => { if (e.key === 'Enter') sendReq(); };

  const approvals = reqs.filter((r) => r.can_approve);
  const pendingMine = reqs.filter((r) => r.involves_me && r.status !== 'accepted' && !r.can_approve);
  const family = contacts.filter((c) => c.same_family);
  const friends = contacts.filter((c) => !c.same_family);
  const openDm = (p) => guard(async () => { const id = await rpc('start_dm', { p_other: p.id }); go('/chat/' + id); });

  return [
    el('div', { class: 'id-card' },
      el('div', { class: 'id-top' }, el('span', null, 'رقمك التعريفي'), icon('qr')),
      el('div', { class: 'id-code', dir: 'ltr' }, S.me.code.replace(/(\d{3})(\d{3})/, '$1 $2')),
      el('div', { class: 'id-actions' },
        el('button', { class: 'btn glass sm', onclick: () => copy(S.me.code) }, icon('copy'), 'نسخ'),
        navigator.share ? el('button', { class: 'btn glass sm', onclick: () => navigator.share({ text: `رقمي في ${APP_NAME}: ${S.me.code}` }).catch(() => {}) }, icon('share'), 'مشاركة') : null)),
    el('div', { class: 'card' },
      el('div', { class: 'card-title' }, icon('userPlus'), 'إضافة صديق'),
      el('div', { class: 'inline' }, input, addBtn),
      el('p', { class: 'muted small' }, S.me.role === 'child'
        ? 'اكتب رقم صديقك. بعدها لازم أهلك وأهله يوافقون'
        : 'إذا أضفت طفل من عائلة ثانية، لازم أهله يوافقون')),
    approvals.length ? section('طلبات تنتظر موافقتك', ...approvals.map(approvalCard)) : null,
    pendingMine.length ? section('طلباتي', el('div', { class: 'list' }, pendingMine.map((r) => {
      const o = r.from_mine ? { id: r.to_id, n: r.to_name, a: r.to_avatar } : { id: r.from_id, n: r.from_name, a: r.from_avatar };
      return el('div', { class: 'row' }, av(o.a, 'md', o.id),
        el('div', { class: 'row-main' }, el('b', null, o.n), el('small', { class: 'muted' }, requestStatus(r))),
        el('span', { class: 'pill ' + (r.status === 'rejected' ? 'danger' : 'warn') }, r.status === 'rejected' ? 'مرفوض' : 'انتظار'));
    }))) : null,
    friends.length ? section(`الأصدقاء · ${friends.length}`, el('div', { class: 'list' }, friends.map((p) => contactRow(p, null,
      el('div', { class: 'row-btns' },
        el('button', { class: 'icon-btn tint', 'aria-label': `محادثة ${p.name}`, onclick: () => openDm(p) }, icon('chat')),
        el('button', { class: 'icon-btn danger', 'aria-label': `حذف ${p.name}`, onclick: () => guard(async () => {
          if (!(await ask(`حذف ${p.name} من الأصدقاء؟`, { ok: 'حذف', danger: true, detail: 'ما تقدرون تتراسلون بعدها، وترجع الإضافة تحتاج موافقة الأهل من جديد' }))) return;
          await rpc('remove_friend_with', { p_other: p.id }); toast(`تم حذف ${p.name}`); bus.emit('refresh-tab');
        }) }, icon('trash'))))))) : null,
    section('العائلة', family.length ? el('div', { class: 'list' }, family.map((p) => contactRow(p, () => openDm(p))))
      : el('p', { class: 'muted' }, 'ما فيه أحد ثاني بالعائلة للحين')),
  ];
}

// ---------- الألعاب ----------
async function tabGames() {
  const games = await rpc('my_games');
  const all = { ...GAMES, ...SOLO };
  const status = (g) => {
    if (g.status === 'active') return g.turn === S.me.id || g.kind === 'rps' ? ['دورك', 'accent'] : ['ننتظر خصمك', 'warn'];
    if (!g.winner) return ['تعادل', ''];
    return g.winner === S.me.id ? ['فزت', 'ok'] : ['خسرت', 'danger'];
  };
  const tiles = (set, solo) => el('div', { class: 'game-grid' }, Object.entries(set).map(([kind, g]) =>
    el('button', { class: 'game-tile', style: { '--g1': g.colors[0], '--g2': g.colors[1] }, onclick: () => (solo ? go('/game/' + kind) : guard(() => pickOpponent(kind))) },
      el('span', { class: 'gt-ic' }, g.icon),
      el('div', null, el('b', null, g.name), el('small', null, g.desc)),
      el('span', { class: 'gt-go' }, solo ? 'العب' : 'تحدَّ'))));
  void all;
  return [
    el('h2', { class: 'sec-title' }, 'تحدَّ أصدقاءك'),
    tiles(GAMES, false),
    section('العب لحالك', tiles(SOLO, true)),
    section('آخر الألعاب', games.length ? el('div', { class: 'list' }, games.map((g) => {
      const [label, tone] = status(g);
      return el('button', { class: 'row', onclick: () => go('/game/' + g.id) },
        el('span', { class: 'av md game-av' }, GAMES[g.kind]?.ic || '🎮'),
        el('div', { class: 'row-main' },
          el('b', null, GAMES[g.kind]?.name || ''),
          el('small', { class: 'muted' }, `ضد ${g.opponent_name || ''} · ${fmtTime(g.updated_at)}`)),
        el('span', { class: 'pill ' + tone }, label));
    })) : empty('ما لعبت للحين', 'اختر لعبة وتحدّى صديقك!', '🎲')),
  ];
}

async function pickOpponent(kind) {
  const contacts = await rpc('my_contacts');
  const close = sheet(`${GAMES[kind].name} — مع مين؟`, contacts.length
    ? el('div', { class: 'list flat' }, contacts.map((p) => contactRow(p, null, el('button', { class: 'btn primary sm', onclick: (e) => guard(async () => {
      const conv = await rpc('start_dm', { p_other: p.id });
      close();
      await startGame(conv, kind, p.id);
    }, e.currentTarget) }, 'تحدَّ'))))
    : empty('ما عندك أحد تلعب معه', 'أضف أصدقاء أولاً', '👫'));
}

// ---------- العائلة (للأهل) ----------
async function tabFamily() {
  const [members, reqs, alerts, wordsRes] = await Promise.all([
    rpc('family_members'), rpc('my_requests'), rpc('family_alerts'),
    sb.from('blocked_words').select('id, word').order('word'),
  ]);
  const words = wordsRes.data || [];
  const kids = members.filter((m) => m.role === 'child');
  const parents = members.filter((m) => m.role === 'parent');
  const approvals = reqs.filter((r) => r.can_approve);
  const friendships = reqs.filter((r) => r.status === 'accepted' || r.status === 'rejected');
  const newAlerts = alerts.filter((a) => !a.reviewed);

  const wordInput = el('input', { class: 'input', placeholder: 'أضف كلمة', maxlength: '40' });
  const addWord = el('button', { class: 'btn soft' }, icon('plus'));
  addWord.onclick = () => guard(async () => {
    const w = wordInput.value.trim();
    if (w.length < 2) throw new Error('الكلمة قصيرة');
    const { error } = await sb.from('blocked_words').insert({ family_id: S.me.family_id, word: w });
    if (error) throw new Error(/duplicate/.test(error.message) ? 'الكلمة موجودة' : error.message);
    bus.emit('refresh-tab');
  }, addWord);

  const stats = [
    [kids.length, 'أطفال', 'users'],
    [reqs.filter((r) => r.status === 'accepted').length, 'صداقات', 'userPlus'],
    [newAlerts.length, 'تنبيهات', 'alert'],
  ];

  return [
    el('div', { class: 'fam-hero' },
      el('div', { class: 'fam-head' },
        el('div', { class: 'fam-avs' }, parents.map((p) => av(p.avatar, 'md', p.id)), kids.map((k) => av(k.avatar, 'md', k.id))),
        el('h2', null, S.me.family_name)),
      el('div', { class: 'fam-stats' }, stats.map(([n, l, ic]) => el('div', { class: 'stat' }, icon(ic), el('b', null, String(n)), el('small', null, l)))),
      el('button', { class: 'invite', onclick: () => copy(S.me.invite_code) },
        el('div', { class: 'row-main' }, el('small', null, 'رمز انضمام ولي الأمر الثاني'), el('b', { class: 'mono', dir: 'ltr' }, S.me.invite_code)),
        icon('copy'))),

    approvals.length ? section(`طلبات صداقة · ${approvals.length}`, ...approvals.map(approvalCard)) : null,

    el('section', { class: 'sec' },
      el('div', { class: 'sec-head' }, el('h2', { class: 'sec-title' }, 'الأطفال'),
        el('button', { class: 'btn primary sm', onclick: () => addChildSheet() }, icon('plus'), 'إضافة طفل')),
      kids.length ? el('div', { class: 'kids' }, kids.map((k) => el('div', { class: 'card kid' },
        el('div', { class: 'kid-top' }, av(k.avatar, 'xl', k.id),
          el('div', { class: 'row-main' }, el('h3', null, k.name),
            el('small', { class: 'muted' }, 'الرقم ', el('span', { dir: 'ltr', class: 'mono' }, k.public_code)),
            el('div', { class: 'tags' },
              el('span', { class: 'pill ' + (k.paired ? 'ok' : 'warn') }, k.paired ? 'مربوط بجهاز' : 'غير مربوط'),
              k.muted ? el('span', { class: 'pill danger' }, icon('lock'), 'موقوف') : null,
              k.quiet_start ? el('span', { class: 'pill' }, icon('moon'), `${k.quiet_start.slice(0, 5)}–${k.quiet_end?.slice(0, 5)}`) : null))),
        el('div', { class: 'kid-actions' },
          el('button', { class: 'kact', onclick: () => guard(() => showPairQR(k)) }, icon('qr'), 'كود الدخول'),
          el('button', { class: 'kact', onclick: () => go('/watch/' + k.id) }, icon('eye'), 'المحادثات'),
          el('button', { class: 'kact', onclick: () => childSettings(k) }, icon('sliders'), 'الإعدادات')))))
        : el('div', { class: 'card' }, empty('ما أضفت أطفال للحين', 'اضغط "إضافة طفل" وبعدها امسح الكود من جواله', '🧒'))),

    section('التنبيهات',
      el('p', { class: 'muted small sec-sub' }, 'رسائل فيها أرقام جوالات أو روابط أو كلمات من قائمتكم'),
      alerts.length ? el('div', { class: 'list' }, alerts.slice(0, 30).map((a) => el('div', { class: 'row alert' + (a.reviewed ? ' done' : '') },
        av(a.sender_avatar, 'md', a.sender_name),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-top' }, el('b', null, a.sender_name || '—'), el('time', null, fmtTime(a.created_at))),
          el('div', { class: 'alert-body' }, a.body || ''),
          el('div', { class: 'alert-foot' },
            el('span', { class: 'pill warn' }, icon('alert'), a.reason),
            el('small', { class: 'muted ellipsis' }, a.conv_title || '')),
          el('div', { class: 'row-btns' },
            el('button', { class: 'btn soft sm', onclick: () => go('/chat/' + a.conversation_id) }, icon('eye'), 'فتح المحادثة'),
            a.reviewed ? null : el('button', { class: 'btn soft sm', onclick: (e) => guard(async () => { await rpc('review_alert', { p_msg: a.id }); bus.emit('refresh-tab'); }, e.currentTarget) }, icon('check'), 'تمت المراجعة'))))))
        : el('div', { class: 'card center muted' }, icon('shield', 'big-ic ok'), el('p', null, 'ما فيه تنبيهات'))),

    friendships.length ? section('صداقات العائلة', el('div', { class: 'list' }, friendships.map((r) => el('div', { class: 'row' },
      el('div', { class: 'pair-avs' }, av(r.from_avatar, 'sm', r.from_id), av(r.to_avatar, 'sm', r.to_id)),
      el('div', { class: 'row-main' },
        el('b', null, `${r.from_name} و ${r.to_name}`),
        el('small', { class: 'muted' }, `${r.from_family} · ${r.to_family}${r.status === 'rejected' ? ' · مرفوض' : ''}`)),
      el('button', { class: 'icon-btn danger', 'aria-label': 'إلغاء', onclick: () => guard(async () => {
        if (!(await ask(r.status === 'rejected' ? 'حذف الطلب المرفوض؟' : 'إلغاء هذي الصداقة؟', { ok: 'نعم', danger: true }))) return;
        await rpc('remove_friend', { p_req: r.id }); bus.emit('refresh-tab');
      }) }, icon('trash')))))) : null,

    section('كلمات التنبيه',
      el('div', { class: 'card' },
        el('div', { class: 'chip-row' }, words.map((w) => el('span', { class: 'chip' }, w.word,
          el('button', { class: 'chip-x', 'aria-label': `حذف ${w.word}`, onclick: () => guard(async () => {
            const { error } = await sb.from('blocked_words').delete().eq('id', w.id);
            if (error) throw error; bus.emit('refresh-tab');
          }) }, icon('x'))))),
        el('div', { class: 'inline' }, wordInput, addWord))),
  ];
}

function addChildSheet() {
  const name = el('input', { class: 'input', placeholder: 'اسم الطفل', maxlength: '30' });
  const pick = avatarPicker('🦁');
  const btn = el('button', { class: 'btn primary block lg' }, 'إضافة وإظهار كود الدخول');
  const close = sheet('إضافة طفل', el('div', { class: 'stack' }, field('الاسم', name),
    el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'الصورة'), pick.node), btn), { full: true });
  btn.onclick = () => guard(async () => {
    const id = await rpc('create_child', { p_name: name.value, p_avatar: pick.value });
    close(); bus.emit('refresh-tab');
    await showPairQR({ id, name: name.value.trim() });
  }, btn);
}

let QRLib;
async function showPairQR(child) {
  const token = await rpc('create_pairing', { p_child: child.id });
  const url = `${location.origin}${location.pathname}#/pair?t=${token}`;
  if (!QRLib) { const m = await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm'); QRLib = m.default || m; }
  const canvas = el('canvas', { class: 'qr' });
  await QRLib.toCanvas(canvas, url, { width: 240, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1b1640', light: '#ffffff' } });
  const timer = el('span', { class: 'pill' });
  const end = Date.now() + 15 * 60e3;
  const tick = () => {
    const s = Math.max(0, Math.round((end - Date.now()) / 1000));
    timer.textContent = s ? `ينتهي بعد ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'انتهى الكود — افتح كود جديد';
  };
  tick();
  const iv = setInterval(tick, 1000);
  sheet(`كود دخول ${child.name}`, el('div', { class: 'stack center' },
    el('p', null, 'افتح كاميرا جوال ', el('b', null, child.name), ' وامسح الكود'),
    el('div', { class: 'qr-box' }, canvas),
    timer,
    el('div', { class: 'steps' },
      el('div', null, el('span', null, '1'), 'الكود يُستخدم مرة وحدة، والجهاز القديم يطلع تلقائياً'),
      el('div', null, el('span', null, '2'), 'آيفون: مشاركة ⬆️ ← إضافة إلى الشاشة الرئيسية'),
      el('div', null, el('span', null, '3'), 'أندرويد: ⋮ ← تثبيت التطبيق')),
    el('button', { class: 'btn soft sm', onclick: () => copy(url) }, icon('link'), 'نسخ الرابط بدل الكود')),
  { onClose: () => clearInterval(iv) });
}

function childSettings(k) {
  const name = el('input', { class: 'input', value: k.name, maxlength: '30' });
  const pick = avatarPicker(k.avatar);
  const muted = el('input', { type: 'checkbox', class: 'switch', checked: k.muted, 'aria-label': 'إيقاف الإرسال' });
  const quietOn = el('input', { type: 'checkbox', class: 'switch', checked: !!k.quiet_start, 'aria-label': 'وقت الراحة' });
  const qs = el('input', { type: 'time', class: 'input', value: (k.quiet_start || '21:00').slice(0, 5) });
  const qe = el('input', { type: 'time', class: 'input', value: (k.quiet_end || '06:00').slice(0, 5) });
  const btn = el('button', { class: 'btn primary block lg' }, 'حفظ');
  const close = sheet(`إعدادات ${k.name}`, el('div', { class: 'stack' },
    field('الاسم', name),
    el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'الصورة'), pick.node),
    el('div', { class: 'list flat' },
      settingRow({ ic: 'lock', tone: 'red', title: 'إيقاف الإرسال', sub: 'يقرأ بس ما يرسل', end: muted }),
      settingRow({ ic: 'moon', tone: 'violet', title: 'وقت الراحة', sub: 'ما يرسل في هذا الوقت (توقيت السعودية)', end: quietOn })),
    el('div', { class: 'inline' }, field('من', qs), field('إلى', qe)),
    btn,
    el('button', { class: 'btn danger-soft block', onclick: () => guard(async () => {
      if (!(await ask('تسجيل خروج جهاز الطفل؟', { ok: 'نعم', danger: true, detail: 'بيحتاج يمسح كود دخول جديد عشان يرجع' }))) return;
      await rpc('unpair_child', { p_child: k.id }); toast('تم تسجيل خروج الجهاز'); close(); bus.emit('refresh-tab');
    }) }, icon('logout'), 'تسجيل خروج جهاز الطفل'),
    el('button', { class: 'btn danger-soft block', onclick: () => guard(async () => {
      if (!(await ask(`حذف ${k.name} نهائياً؟`, { ok: 'حذف نهائي', danger: true,
        detail: 'ينحذف حسابه ومحادثاته الخاصة وصوره وأصدقاؤه، وما يمكن ترجعها' }))) return;
      const paths = await rpc('child_media_paths', { p_child: k.id });
      const list = (paths || []).map((x) => (typeof x === 'string' ? x : Object.values(x)[0])).filter(Boolean);
      for (let i = 0; i < list.length; i += 100) await sb.storage.from('media').remove(list.slice(i, i + 100)).catch(() => {});
      await rpc('delete_child', { p_child: k.id });
      toast(`تم حذف ${k.name}`); close(); bus.emit('refresh-tab');
    }) }, icon('trash'), 'حذف الطفل نهائياً')), { full: true });
  btn.onclick = () => guard(async () => {
    await rpc('update_child', {
      p_child: k.id, p_name: name.value, p_avatar: pick.value, p_muted: muted.checked,
      p_quiet_start: quietOn.checked ? qs.value : null, p_quiet_end: quietOn.checked ? qe.value : null,
    });
    toast('تم الحفظ', 'ok'); close(); bus.emit('refresh-tab');
  }, btn);
}

// ---------- مراقبة محادثات طفل ----------
async function renderWatch(childId) {
  const members = await rpc('family_members');
  const kid = members.find((m) => m.id === childId);
  if (!kid) return goRoot('/family');
  const list = await rpc('my_conversations', { p_for: childId });
  app.replaceChildren(el('div', { class: 'sub' },
    navbar({ title: `محادثات ${kid.name}`, subtitle: 'وضع المراقبة', avatar: av(kid.avatar, 'sm', kid.id), onBack: () => back('/family') }),
    el('main', { class: 'page' },
      el('div', { class: 'note' }, icon('eye'), 'تشوف كل محادثات الطفل، وتقدر تحذف أي رسالة بالضغط عليها'),
      list.length ? el('div', { class: 'list' }, list.map((c) => convRow({ ...c, unread: 0 }, () => go('/chat/' + c.id))))
        : empty(`${kid.name} ما عنده محادثات للحين`, '', '💬'))));
}

// ---------- حسابي ----------
async function tabMe() {
  const notifState = 'Notification' in window ? Notification.permission : 'unsupported';
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const notifRow = notifState === 'unsupported'
    ? settingRow({ ic: 'bell', tone: 'amber', title: 'التنبيهات', sub: isIOS && !isStandalone ? 'تشتغل بعد إضافة التطبيق للشاشة الرئيسية' : 'المتصفح ما يدعمها' })
    : notifState === 'granted'
      ? settingRow({ ic: 'bell', tone: 'amber', title: 'التنبيهات', sub: 'مفعّلة', end: el('span', { class: 'pill ok' }, 'مفعّل') })
      : settingRow({ ic: 'bell', tone: 'amber', title: 'تفعيل التنبيهات', sub: 'عشان توصلك الرسائل الجديدة', onclick: async () => { await Notification.requestPermission(); bus.emit('refresh-tab'); } });
  const installRow = (isStandalone || appInstalled()) ? null : S.installPrompt
    ? settingRow({ ic: 'download', tone: 'green', title: 'تثبيت التطبيق', sub: 'أيقونة على الشاشة الرئيسية', onclick: async () => { S.installPrompt.prompt(); S.installPrompt = null; } })
    : settingRow({ ic: 'download', tone: 'green', title: 'تثبيت التطبيق', sub: isIOS ? 'Safari: مشاركة ⬆️ ← إضافة إلى الشاشة الرئيسية' : 'Chrome: ⋮ ← تثبيت التطبيق' });

  return [
    el('div', { class: 'profile' },
      av(S.me.avatar, 'xxl', S.me.id),
      el('h2', null, S.me.name),
      el('span', { class: 'muted' }, S.me.role === 'parent' ? `ولي أمر · ${S.me.family_name}` : S.me.family_name),
      el('button', { class: 'btn soft sm', onclick: () => editProfile() }, icon('edit'), 'تعديل')),
    el('div', { class: 'list' },
      settingRow({ ic: 'key', tone: 'violet', title: 'رقمك التعريفي', sub: 'أعطه لأصدقائك عشان يضيفونك', end: el('b', { class: 'mono', dir: 'ltr' }, S.me.code), onclick: () => copy(S.me.code) }),
      settingRow({ ic: 'volume', tone: 'blue', title: 'صوت التنبيه', sub: 'للرسائل الجديدة',
        end: el('span', { class: 'pill accent' }, { loud: 'قوي', normal: 'عادي', off: 'بدون' }[soundLevel()]), onclick: soundSheet }),
      notifRow, installRow),
    // الطفل ما عنده تسجيل خروج (أهله يقدرون يطلعونه من صفحة العائلة). الأهل يبقون داخلين دايم إلا لو طلعوا بأنفسهم
    S.me.role === 'parent' ? el('div', { class: 'list' },
      settingRow({ ic: 'logout', tone: 'red', title: 'تسجيل خروج', onclick: async () => {
        if (await ask('تسجيل خروج؟', { ok: 'خروج', danger: true, detail: 'بتحتاج الإيميل وكلمة المرور عشان ترجع' })) { await dropPush(); await sb.auth.signOut(); }
      } })) : null,
    el('p', { class: 'center muted small' }, `${APP_NAME} · نسخة 1.1`),
  ];
}

function soundSheet() {
  const opts = [['loud', 'قوي', 'صوت عالي + اهتزاز'], ['normal', 'عادي', 'صوت هادي'], ['off', 'بدون صوت', 'اهتزاز للتنبيه القوي بس']];
  const close = sheet('صوت التنبيه', el('div', { class: 'stack' },
    el('div', { class: 'list flat' }, opts.map(([v, t, s]) => settingRow({
      ic: v === 'off' ? 'x' : 'volume', tone: v === soundLevel() ? 'violet' : '', title: t, sub: s,
      end: v === soundLevel() ? icon('check') : el('span'),
      onclick: () => { setSoundLevel(v); playMessageSound(); close(); bus.emit('refresh-tab'); },
    }))),
    el('button', { class: 'btn soft block', onclick: () => { const stop = startRingtone(3); setTimeout(stop, 3000); } }, icon('bellRing'), 'جرّب رنّة التنبيه القوي')));
}

function editProfile() {
  const name = el('input', { class: 'input', value: S.me.name, maxlength: '30' });
  const pick = avatarPicker(S.me.avatar);
  const btn = el('button', { class: 'btn primary block lg' }, 'حفظ');
  const close = sheet('تعديل حسابي', el('div', { class: 'stack' }, field('الاسم', name),
    el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'الصورة'), pick.node), btn), { full: true });
  btn.onclick = () => guard(async () => {
    await rpc('update_profile', { p_name: name.value, p_avatar: pick.value });
    S.me = await rpc('my_profile');
    close(); route();
  }, btn);
}

boot();

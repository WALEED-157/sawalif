import {
  sb, S, bus, rpc, el, toast, guard, sheet, ask, go, av, empty, spinner, copy, fmtTime, configured, APP_NAME,
  avatarPicker, field, previewText, debounce, toLatinDigits, addCleanup, runCleanup, niceError, ding,
} from './lib.js';
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
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installPrompt = e; });

  const hadAuthHash = /access_token=|error_description=|type=recovery/.test(location.hash);
  const errMatch = location.hash.match(/error_description=([^&]+)/);
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  if (hadAuthHash) {
    history.replaceState(null, '', location.pathname + location.search + '#/');
    if (errMatch) toast(decodeURIComponent(errMatch[1].replace(/\+/g, ' ')), 'err');
  }

  sb.auth.onAuthStateChange((event, session) => {
    S.session = session;
    if (event === 'SIGNED_OUT') { S.me = null; stopRealtime(); setTimeout(route, 0); }
    if (event === 'PASSWORD_RECOVERY') setTimeout(newPasswordSheet, 0);
  });
  addEventListener('hashchange', route);
  route();
}

function navigate(p) { if (location.hash === '#' + p) route(); else go(p); }

function parseHash() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(qs || '') };
}

async function route() {
  const seq = ++routeSeq;
  runCleanup();
  const { parts, params } = parseHash();
  try {
    if (parts[0] === 'pair') return await renderPair(params.get('t'));
    if (!S.session) return renderAuth();
    if (!S.me) S.me = await rpc('my_profile');
    if (seq !== routeSeq) return;
    if (!S.me) return S.session.user.is_anonymous ? renderAnonNoProfile() : renderOnboarding();
    startRealtime();
    maybeCleanupMedia();

    switch (parts[0]) {
      case undefined: return await shell('chats', tabChats);
      case 'friends': return await shell('friends', tabFriends);
      case 'games': return await shell('games', tabGames);
      case 'family': return S.me.role === 'parent' ? await shell('family', tabFamily) : go('/');
      case 'me': return await shell('me', tabMe);
      case 'watch': return S.me.role === 'parent' ? await renderWatch(parts[1]) : go('/');
      case 'chat': app.replaceChildren(spinner()); return await renderChat(app, parts[1]);
      case 'game': app.replaceChildren(spinner()); return await renderGame(app, parts[1]);
      default: return go('/');
    }
  } catch (e) {
    console.error(e);
    if (seq !== routeSeq) return;
    app.replaceChildren(el('div', { class: 'center-page' }, el('div', { class: 'card center' },
      el('div', { class: 'empty-ic' }, '😕'),
      el('b', null, 'صار خطأ'),
      el('p', { class: 'muted' }, niceError(e)),
      el('div', { class: 'row-btns' },
        el('button', { class: 'btn primary', onclick: () => route() }, 'حاول مرة ثانية'),
        el('button', { class: 'btn soft', onclick: () => go('/') }, 'الرئيسية')))));
  }
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

const refreshMemberConvs = debounce(async () => {
  try { const l = await rpc('my_conversations'); S.memberConvs = new Set(l.map((c) => c.id)); } catch { /* ignore */ }
}, 300);

async function onNewMessage(m) {
  bus.emit('message', m);
  bus.emit('refresh-chats');
  if (!S.me || m.sender_id === S.me.id || m.kind === 'system') return;
  if (!S.memberConvs.has(m.conversation_id)) { await refreshMemberConvs(); await new Promise((r) => setTimeout(r, 400)); }
  if (!S.memberConvs.has(m.conversation_id)) return; // محادثة مراقبة فقط
  if (S.currentConv === m.conversation_id && !document.hidden) return;
  ding();
  const text = 'رسالة جديدة: ' + (previewText(m.kind, m.body) || '').slice(0, 60);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const opts = { body: text, icon: 'icons/icon-192.png', tag: m.conversation_id, data: { url: '#/chat/' + m.conversation_id } };
      if (reg) reg.showNotification(APP_NAME, opts); else new Notification(APP_NAME, opts);
    } catch { /* ignore */ }
  } else {
    banner(text, () => go('/chat/' + m.conversation_id));
  }
}

function banner(text, onclick) {
  const b = el('button', { class: 'msg-banner', onclick: () => { b.remove(); onclick(); } }, '💬 ', text);
  document.body.append(b);
  setTimeout(() => b.classList.add('show'), 10);
  setTimeout(() => { b.classList.remove('show'); setTimeout(() => b.remove(), 300); }, 4500);
}

// تنظيف الوسائط القديمة (أكثر من 7 أيام) — مرة كل 12 ساعة من جهاز الأهل
async function maybeCleanupMedia() {
  if (S.me.role !== 'parent') return;
  let last = 0;
  try { last = +localStorage.getItem('fc_cleanup') || 0; } catch { /* ignore */ }
  if (Date.now() - last < 12 * 3600e3) return;
  try { localStorage.setItem('fc_cleanup', String(Date.now())); } catch { /* ignore */ }
  try {
    const rows = await rpc('expired_media');
    if (!rows?.length) return;
    await sb.storage.from('media').remove(rows.map((r) => r.media_path));
    await rpc('mark_media_expired', { p_ids: rows.map((r) => r.id) });
  } catch (e) { console.warn('cleanup', e); }
}

// =============================================================
//  شاشة: الإعداد غير مكتمل
// =============================================================
function notConfigured() {
  app.replaceChildren(el('div', { class: 'center-page' }, el('div', { class: 'card' },
    el('div', { class: 'empty-ic' }, '🛠️'),
    el('h2', null, 'باقي خطوة الإعداد'),
    el('p', null, 'افتح ملف ', el('code', null, 'js/config.js'), ' وحط فيه رابط مشروع Supabase والمفتاح.'),
    el('p', { class: 'muted' }, 'الشرح كامل في ملف README.md'))));
}

// =============================================================
//  شاشة: الدخول (للأهل)
// =============================================================
function renderAuth() {
  let mode = 'login';
  const email = el('input', { class: 'input', type: 'email', autocomplete: 'email', placeholder: 'name@example.com', dir: 'ltr', required: true });
  const pass = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: '••••••', dir: 'ltr', required: true, minlength: '6' });
  const submit = el('button', { class: 'btn primary block', type: 'submit' }, 'دخول');
  const tabs = el('div', { class: 'seg' });
  const forgot = el('button', { type: 'button', class: 'link', onclick: () => guard(async () => {
    if (!email.value) throw new Error('اكتب إيميلك أولاً');
    const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
    if (error) throw error;
    toast('أرسلنا لك رابط لتغيير كلمة المرور 📧', 'ok');
  }) }, 'نسيت كلمة المرور؟');

  const drawTabs = () => {
    tabs.replaceChildren(
      el('button', { type: 'button', class: mode === 'login' ? 'on' : '', onclick: () => { mode = 'login'; drawTabs(); } }, 'دخول'),
      el('button', { type: 'button', class: mode === 'signup' ? 'on' : '', onclick: () => { mode = 'signup'; drawTabs(); } }, 'حساب جديد'));
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
      else toast('أرسلنا لك إيميل تأكيد 📧 افتحه وبعدين سجّل دخول', 'ok');
    }
  }, submit); } },
  field('الإيميل', email), field('كلمة المرور', pass), submit, forgot);

  app.replaceChildren(el('div', { class: 'center-page' },
    el('div', { class: 'hero' }, el('div', { class: 'hero-logo' }, '💬'), el('h1', null, APP_NAME), el('p', { class: 'muted' }, 'دردشة آمنة للعائلة والأطفال')),
    el('div', { class: 'card' }, el('h3', null, '👨‍👩‍👧 دخول الأهل'), tabs, form),
    el('div', { class: 'card kid-card' },
      el('div', { class: 'kid-ic' }, '🧒'),
      el('div', null, el('b', null, 'أنت طفل؟'), el('p', { class: 'muted' }, 'اطلب من أبوك أو أمك يفتحون لك "كود الدخول" وامسحه بكاميرا جوالك 📷')))));
}

function newPasswordSheet() {
  const pass = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', dir: 'ltr', minlength: '6' });
  const btn = el('button', { class: 'btn primary block' }, 'حفظ');
  const close = sheet('كلمة مرور جديدة', el('div', { class: 'stack' }, field('كلمة المرور الجديدة', pass), btn));
  btn.onclick = () => guard(async () => {
    const { error } = await sb.auth.updateUser({ password: pass.value });
    if (error) throw error;
    toast('تم تغيير كلمة المرور ✅', 'ok'); close();
  }, btn);
}

// =============================================================
//  شاشة: ربط جهاز الطفل بكود QR
// =============================================================
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
    history.replaceState(null, '', location.pathname + location.search + '#/');
    toast('أهلاً فيك! 🎉', 'ok');
    route();
  } catch (e) {
    app.replaceChildren(el('div', { class: 'center-page' }, el('div', { class: 'card center' },
      el('div', { class: 'empty-ic' }, '😕'), el('b', null, 'ما قدرنا ندخل'), el('p', { class: 'muted' }, niceError(e)),
      el('button', { class: 'btn soft', onclick: () => { history.replaceState(null, '', location.pathname + '#/'); route(); } }, 'رجوع'))));
  }
}

function renderAnonNoProfile() {
  app.replaceChildren(el('div', { class: 'center-page' }, el('div', { class: 'card center' },
    el('div', { class: 'empty-ic' }, '📷'),
    el('b', null, 'هذا الجهاز مو مربوط بحساب'),
    el('p', { class: 'muted' }, 'يمكن أهلك فتحوا كود جديد من جهاز ثاني. اطلب منهم كود دخول جديد وامسحه.'),
    el('button', { class: 'btn soft', onclick: () => sb.auth.signOut() }, 'رجوع لشاشة الدخول'))));
}

// =============================================================
//  شاشة: إنشاء عائلة / الانضمام
// =============================================================
function renderOnboarding() {
  let mode = 'create';
  const box = el('div');
  const draw = () => {
    const name = el('input', { class: 'input', placeholder: 'مثلاً: أبو محمد', maxlength: '30' });
    const pick = avatarPicker('👨');
    const seg = el('div', { class: 'seg' },
      el('button', { class: mode === 'create' ? 'on' : '', onclick: () => { mode = 'create'; draw(); } }, 'عائلة جديدة'),
      el('button', { class: mode === 'join' ? 'on' : '', onclick: () => { mode = 'join'; draw(); } }, 'انضم لعائلتي'));
    const btn = el('button', { class: 'btn primary block' }, mode === 'create' ? 'إنشاء العائلة 🏠' : 'انضمام');
    let fields;
    if (mode === 'create') {
      const code = el('input', { class: 'input', placeholder: 'الرمز من صاحب التطبيق', dir: 'ltr' });
      const fam = el('input', { class: 'input', placeholder: 'مثلاً: عائلة أحمد', maxlength: '40' });
      fields = [field('رمز التسجيل', code, 'رمز سري يعطيك إياه اللي ركّب التطبيق'), field('اسم العائلة', fam)];
      btn.onclick = () => guard(async () => {
        await rpc('create_family', { p_signup_code: code.value, p_family_name: fam.value, p_name: name.value, p_avatar: pick.value });
        S.me = null; toast('تم إنشاء العائلة 🎉', 'ok'); navigate('/family');
      }, btn);
    } else {
      const inv = el('input', { class: 'input', placeholder: 'مثلاً: K7M2QX9A', dir: 'ltr', style: { textTransform: 'uppercase' } });
      fields = [field('رمز العائلة', inv, 'تلقاه عند الزوج/الزوجة في صفحة "العائلة"')];
      btn.onclick = () => guard(async () => {
        await rpc('join_family', { p_invite_code: inv.value, p_name: name.value, p_avatar: pick.value });
        S.me = null; toast('أهلاً فيك بالعائلة 🎉', 'ok'); navigate('/');
      }, btn);
    }
    box.replaceChildren(el('div', { class: 'card stack' }, seg, ...fields, field('اسمك (يظهر للعائلة)', name),
      el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'اختر صورتك'), pick.node), btn));
  };
  draw();
  app.replaceChildren(el('div', { class: 'center-page' },
    el('div', { class: 'hero' }, el('div', { class: 'hero-logo' }, '🏠'), el('h1', null, 'أهلاً فيك!'), el('p', { class: 'muted' }, 'خلنا نجهز حساب العائلة')),
    box,
    el('button', { class: 'link', onclick: () => sb.auth.signOut() }, 'تسجيل خروج')));
}

// =============================================================
//  الإطار الرئيسي + التبويبات
// =============================================================
async function shell(tab, fill) {
  const nav = S.me.role === 'parent'
    ? [['chats', '/', '💬', 'المحادثات'], ['friends', '/friends', '👫', 'الأصدقاء'], ['games', '/games', '🎮', 'ألعاب'], ['family', '/family', '🏠', 'العائلة']]
    : [['chats', '/', '💬', 'المحادثات'], ['friends', '/friends', '👫', 'الأصدقاء'], ['games', '/games', '🎮', 'ألعاب'], ['me', '/me', S.me.avatar, 'أنا']];
  const main = el('main', { class: 'page' }, spinner());
  const header = el('header', { class: 'topbar' },
    el('div', { class: 'brand' }, el('span', { class: 'logo' }, '💬'), el('b', null, APP_NAME)),
    el('button', { class: 'me-btn', onclick: () => go('/me'), 'aria-label': 'حسابي' }, av(S.me.avatar)));
  const navEl = el('nav', { class: 'tabbar' }, nav.map(([id, href, ic, label]) =>
    el('a', { href: '#' + href, class: 'tab' + (id === tab ? ' on' : ''), 'data-tab': id },
      el('span', { class: 'ti' }, ic, el('i', { class: 'dot' })), el('span', null, label))));
  app.replaceChildren(el('div', { class: 'shell' }, header, main, navEl));

  const refresh = async () => {
    const node = await fill();
    main.replaceChildren(...[].concat(node));
  };
  await refresh();
  updateBadges(navEl);
  const offs = [
    bus.on('refresh-chats', debounce(() => { if (tab === 'chats') refresh().catch(() => {}); updateBadges(navEl); }, 500)),
    bus.on('refresh-tab', () => refresh().catch((e) => toast(niceError(e), 'err'))),
  ];
  addCleanup(() => offs.forEach((f) => f()));
}

async function updateBadges(navEl) {
  try {
    const convs = await rpc('my_conversations');
    S.memberConvs = new Set(convs.map((c) => c.id));
    const unread = convs.reduce((a, c) => a + (c.unread || 0), 0);
    setDot(navEl, 'chats', unread);
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
  if (S.me.muted) out.push(el('div', { class: 'note warn' }, '🔒 الإرسال موقوف مؤقتاً من الأهل'));
  if (S.me.in_quiet) out.push(el('div', { class: 'note' }, '🌙 الحين وقت الراحة، ترجع الرسائل بعدين'));
  return out;
}

function convTitle(c) { return c.kind === 'direct' ? (c.other_name || 'محادثة') : c.title; }
function convRow(c, onclick) {
  return el('button', { class: 'row', onclick },
    av(c.kind === 'direct' ? c.other_avatar : c.emoji, 'md'),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-top' }, el('b', { class: 'ellipsis' }, convTitle(c)), el('small', { class: 'muted' }, fmtTime(c.last_message_at))),
      el('div', { class: 'row-sub' },
        el('span', { class: 'ellipsis muted' }, previewText(c.preview_kind, c.preview) || (c.kind === 'group' ? `${c.member_count} أعضاء` : 'ابدأ السالفة 👋')),
        c.unread ? el('span', { class: 'badge' }, c.unread > 99 ? '99+' : c.unread) : null)));
}

function contactRow(p, onclick, extra) {
  const sub = p.same_family ? (p.role === 'parent' ? 'ولي أمر · من العائلة' : 'من العائلة') : p.family;
  return el('div', { class: 'row' },
    av(p.avatar, 'md'),
    el('div', { class: 'row-main' }, el('b', null, p.name), el('small', { class: 'muted' }, sub)),
    extra || el('button', { class: 'btn soft sm', onclick }, '💬'));
}

// ---------- المحادثات ----------
async function tabChats() {
  const list = await rpc('my_conversations');
  S.memberConvs = new Set(list.map((c) => c.id));
  return [
    ...statusBanners(),
    list.length ? el('div', { class: 'list' }, list.map((c) => convRow(c, () => go('/chat/' + c.id))))
      : empty('ما عندك محادثات للحين', 'اضغط ＋ وابدأ سالفة مع عائلتك أو أصدقائك', '💬'),
    el('button', { class: 'fab', onclick: () => guard(newChatSheet), 'aria-label': 'محادثة جديدة' }, '＋'),
  ];
}

async function newChatSheet() {
  const contacts = await rpc('my_contacts');
  const close = sheet('محادثة جديدة', el('div', { class: 'stack' },
    el('button', { class: 'btn soft block', onclick: () => { close(); newGroupSheet(contacts); } }, '👥 قروب جديد'),
    contacts.length
      ? el('div', { class: 'list' }, contacts.map((p) => contactRow(p, () => guard(async () => {
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
  const btn = el('button', { class: 'btn primary block' }, 'إنشاء القروب');
  const close = sheet('قروب جديد', el('div', { class: 'stack' },
    field('اسم القروب', title), emojiRow,
    el('span', { class: 'lbl' }, 'اختر الأعضاء'),
    el('p', { class: 'muted small' }, 'لازم كل الأعضاء يكونون أصدقاء مع بعض'),
    el('div', { class: 'list' }, contacts.map((p) => {
      const cb = el('input', { type: 'checkbox', class: 'check', onchange: () => (cb.checked ? chosen.add(p.id) : chosen.delete(p.id)) });
      return el('label', { class: 'row' }, av(p.avatar, 'md'),
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
  if (r.status === 'rejected') return 'مرفوض ❌';
  const mineOk = r.from_mine ? r.from_ok : r.to_ok;
  const otherOk = r.from_mine ? r.to_ok : r.from_ok;
  if (!mineOk && !otherOk) return '⏳ ننتظر موافقة الأهل من الطرفين';
  if (!mineOk) return '⏳ ننتظر موافقة أهلك';
  return '⏳ ننتظر موافقة أهل صديقك';
}

function approvalCard(r) {
  return el('div', { class: 'card req' },
    el('div', { class: 'req-line' }, av(r.from_avatar, 'sm'), el('b', null, r.from_name), el('small', { class: 'muted' }, `(${r.from_family})`)),
    el('div', { class: 'req-mid muted' }, 'يبي يضيف ⬇️'),
    el('div', { class: 'req-line' }, av(r.to_avatar, 'sm'), el('b', null, r.to_name), el('small', { class: 'muted' }, `(${r.to_family})`)),
    el('div', { class: 'row-btns' },
      el('button', { class: 'btn ok', onclick: (e) => guard(async () => { await rpc('respond_friend_request', { p_id: r.id, p_approve: true }); toast('تمت الموافقة ✅', 'ok'); bus.emit('refresh-tab'); }, e.currentTarget) }, '✅ موافق'),
      el('button', { class: 'btn danger soft', onclick: (e) => guard(async () => { await rpc('respond_friend_request', { p_id: r.id, p_approve: false }); toast('تم الرفض'); bus.emit('refresh-tab'); }, e.currentTarget) }, 'رفض')));
}

async function tabFriends() {
  const [contacts, reqs] = await Promise.all([rpc('my_contacts'), rpc('my_requests')]);
  const input = el('input', { class: 'input code-input', inputmode: 'numeric', maxlength: '6', placeholder: '000000', dir: 'ltr', autocomplete: 'off' });
  const addBtn = el('button', { class: 'btn primary' }, 'إضافة');
  const sendReq = () => guard(async () => {
    const code = toLatinDigits(input.value).replace(/\D/g, '');
    if (code.length !== 6) throw new Error('الرقم التعريفي 6 أرقام');
    const r = await rpc('send_friend_request', { p_code: code });
    input.value = '';
    toast(`انرسل الطلب لـ ${r.avatar} ${r.name} — ننتظر موافقة الأهل 👍`, 'ok');
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
    el('div', { class: 'card code-card' },
      el('div', { class: 'muted' }, 'رقمك التعريفي'),
      el('div', { class: 'big-code', dir: 'ltr' }, S.me.code),
      el('p', { class: 'muted small' }, 'أعطِ هذا الرقم لصديقك عشان يضيفك'),
      el('div', { class: 'row-btns center' },
        el('button', { class: 'btn soft sm', onclick: () => copy(S.me.code) }, '📋 نسخ'),
        navigator.share ? el('button', { class: 'btn soft sm', onclick: () => navigator.share({ text: `رقمي في ${APP_NAME}: ${S.me.code}` }).catch(() => {}) }, '📤 مشاركة') : null)),
    el('div', { class: 'card' },
      el('h3', null, '➕ إضافة صديق'),
      el('div', { class: 'inline' }, input, addBtn),
      el('p', { class: 'muted small' }, S.me.role === 'child'
        ? 'اكتب رقم صديقك. بعدها لازم أهلك وأهله يوافقون 👨‍👩‍👧'
        : 'إذا أضفت طفل من عائلة ثانية، لازم أهله يوافقون')),
    approvals.length ? el('section', null, el('h3', { class: 'sec' }, '🔔 طلبات تنتظر موافقتك'), approvals.map(approvalCard)) : null,
    pendingMine.length ? el('section', null, el('h3', { class: 'sec' }, 'طلباتي'),
      el('div', { class: 'list' }, pendingMine.map((r) => {
        const other = r.from_mine ? { n: r.to_name, a: r.to_avatar, f: r.to_family } : { n: r.from_name, a: r.from_avatar, f: r.from_family };
        return el('div', { class: 'row' }, av(other.a, 'md'),
          el('div', { class: 'row-main' }, el('b', null, other.n), el('small', { class: 'muted' }, requestStatus(r))));
      }))) : null,
    friends.length ? el('section', null, el('h3', { class: 'sec' }, `👫 الأصدقاء (${friends.length})`),
      el('div', { class: 'list' }, friends.map((p) => contactRow(p, () => openDm(p))))) : null,
    el('section', null, el('h3', { class: 'sec' }, '🏠 العائلة'),
      family.length ? el('div', { class: 'list' }, family.map((p) => contactRow(p, () => openDm(p))))
        : el('p', { class: 'muted' }, 'ما فيه أحد ثاني بالعائلة للحين')),
  ];
}

// ---------- الألعاب ----------
async function tabGames() {
  const games = await rpc('my_games');
  const all = { ...GAMES, ...SOLO };
  const statusOf = (g) => {
    if (g.status === 'active') return g.turn === S.me.id || g.kind === 'rps' ? '🎯 دورك!' : '⏳ ننتظر خصمك';
    if (!g.winner) return '🤝 تعادل';
    return g.winner === S.me.id ? '🏆 فزت' : '😅 خسرت';
  };
  return [
    el('h3', { class: 'sec' }, '🎮 اختر لعبة'),
    el('div', { class: 'game-grid' }, Object.entries(all).map(([kind, g]) =>
      el('button', { class: 'game-tile', style: { '--g1': g.colors[0], '--g2': g.colors[1] }, onclick: () => (SOLO[kind] ? go('/game/' + kind) : guard(() => pickOpponent(kind))) },
        el('span', { class: 'gt-ic' }, g.icon), el('b', null, g.name), el('small', null, g.desc)))),
    el('h3', { class: 'sec' }, 'آخر الألعاب'),
    games.length ? el('div', { class: 'list' }, games.map((g) => el('button', { class: 'row', onclick: () => go('/game/' + g.id) },
      el('span', { class: 'av md' }, GAMES[g.kind]?.ic || '🎮'),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-top' }, el('b', null, `${GAMES[g.kind]?.name || ''} ضد ${g.opponent_avatar || ''} ${g.opponent_name || ''}`), el('small', { class: 'muted' }, fmtTime(g.updated_at))),
        el('small', { class: g.status === 'active' ? 'accent' : 'muted' }, statusOf(g))))))
      : empty('ما لعبت للحين', 'اختر لعبة وتحدّى صديقك!', '🎲'),
  ];
}

async function pickOpponent(kind) {
  const contacts = await rpc('my_contacts');
  const close = sheet(`${GAMES[kind].name} — مع مين؟`, contacts.length
    ? el('div', { class: 'list' }, contacts.map((p) => contactRow(p, null, el('button', { class: 'btn primary sm', onclick: (e) => guard(async () => {
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
  const kidFriends = reqs.filter((r) => r.status === 'accepted');
  const rejected = reqs.filter((r) => r.status === 'rejected');
  const newAlerts = alerts.filter((a) => !a.reviewed);

  const wordInput = el('input', { class: 'input', placeholder: 'كلمة جديدة', maxlength: '40' });
  const addWord = el('button', { class: 'btn soft' }, 'إضافة');
  addWord.onclick = () => guard(async () => {
    const w = wordInput.value.trim();
    if (w.length < 2) throw new Error('الكلمة قصيرة');
    const { error } = await sb.from('blocked_words').insert({ family_id: S.me.family_id, word: w });
    if (error) throw new Error(/duplicate/.test(error.message) ? 'الكلمة موجودة' : error.message);
    bus.emit('refresh-tab');
  }, addWord);

  return [
    el('div', { class: 'card fam-card' },
      el('div', { class: 'fam-top' }, el('span', { class: 'av lg' }, '🏠'), el('div', null, el('h2', null, S.me.family_name),
        el('small', { class: 'muted' }, parents.map((p) => `${p.avatar} ${p.name}`).join(' · ')))),
      el('div', { class: 'invite' },
        el('div', null, el('small', { class: 'muted' }, 'رمز انضمام ولي الأمر الثاني'), el('div', { class: 'mono', dir: 'ltr' }, S.me.invite_code)),
        el('button', { class: 'btn soft sm', onclick: () => copy(S.me.invite_code) }, '📋 نسخ'))),

    approvals.length ? el('section', null, el('h3', { class: 'sec' }, `🔔 طلبات صداقة (${approvals.length})`), approvals.map(approvalCard)) : null,

    el('section', null,
      el('div', { class: 'sec-row' }, el('h3', { class: 'sec' }, '🧒 الأطفال'), el('button', { class: 'btn primary sm', onclick: () => addChildSheet() }, '＋ إضافة طفل')),
      kids.length ? kids.map((k) => el('div', { class: 'card kid' },
        el('div', { class: 'kid-top' }, av(k.avatar, 'lg'),
          el('div', { class: 'row-main' }, el('b', null, k.name),
            el('small', { class: 'muted' }, 'الرقم: ', el('span', { dir: 'ltr' }, k.public_code)),
            el('div', { class: 'tags' },
              el('span', { class: 'tag ' + (k.paired ? 'ok' : 'warn') }, k.paired ? '📱 مربوط بجهاز' : '⚠️ غير مربوط'),
              k.muted ? el('span', { class: 'tag warn' }, '🔒 الإرسال موقوف') : null,
              k.quiet_start ? el('span', { class: 'tag' }, `🌙 ${k.quiet_start.slice(0, 5)} - ${k.quiet_end?.slice(0, 5)}`) : null))),
        el('div', { class: 'kid-actions' },
          el('button', { class: 'btn soft sm', onclick: () => guard(() => showPairQR(k)) }, '📷 كود الدخول'),
          el('button', { class: 'btn soft sm', onclick: () => go('/watch/' + k.id) }, '👁 المحادثات'),
          el('button', { class: 'btn soft sm', onclick: () => childSettings(k) }, '⚙️ إعدادات'))))
        : empty('ما أضفت أطفال للحين', 'اضغط "إضافة طفل" وبعدها امسح الكود من جواله', '🧒')),

    el('section', null, el('h3', { class: 'sec' }, `⚠️ تنبيهات${newAlerts.length ? ` (${newAlerts.length} جديدة)` : ''}`),
      el('p', { class: 'muted small' }, 'رسائل فيها أرقام جوالات أو روابط أو كلمات من القائمة تحت'),
      alerts.length ? el('div', { class: 'list' }, alerts.slice(0, 30).map((a) => el('div', { class: 'row alert' + (a.reviewed ? ' done' : '') },
        av(a.sender_avatar, 'sm'),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-top' }, el('b', null, a.sender_name || '—'), el('small', { class: 'muted' }, fmtTime(a.created_at))),
          el('div', { class: 'alert-body' }, a.body || ''),
          el('small', { class: 'muted' }, `${a.reason} · ${a.conv_title || ''}`),
          el('div', { class: 'row-btns' },
            el('button', { class: 'btn soft sm', onclick: () => go('/chat/' + a.conversation_id) }, 'فتح المحادثة'),
            a.reviewed ? null : el('button', { class: 'btn soft sm', onclick: (e) => guard(async () => { await rpc('review_alert', { p_msg: a.id }); bus.emit('refresh-tab'); }, e.currentTarget) }, '✓ تمت المراجعة'))))))
        : el('p', { class: 'muted' }, 'ما فيه تنبيهات 👍')),

    kidFriends.length || rejected.length ? el('section', null, el('h3', { class: 'sec' }, '👫 صداقات العائلة'),
      el('div', { class: 'list' }, [...kidFriends, ...rejected].map((r) => el('div', { class: 'row' },
        el('div', { class: 'row-main' },
          el('b', null, `${r.from_avatar} ${r.from_name} ↔ ${r.to_avatar} ${r.to_name}`),
          el('small', { class: 'muted' }, `${r.from_family} · ${r.to_family}${r.status === 'rejected' ? ' · مرفوض' : ''}`)),
        el('button', { class: 'btn danger soft sm', onclick: () => guard(async () => {
          if (!(await ask(r.status === 'rejected' ? 'حذف الطلب المرفوض؟' : 'إلغاء هذي الصداقة؟', { ok: 'نعم', danger: true }))) return;
          await rpc('remove_friend', { p_req: r.id }); bus.emit('refresh-tab');
        }) }, r.status === 'rejected' ? 'حذف' : 'إلغاء'))))) : null,

    el('section', null, el('h3', { class: 'sec' }, '🚫 كلمات التنبيه'),
      el('div', { class: 'chip-row' }, words.map((w) => el('span', { class: 'chip' }, w.word,
        el('button', { class: 'chip-x', 'aria-label': 'حذف', onclick: () => guard(async () => {
          const { error } = await sb.from('blocked_words').delete().eq('id', w.id);
          if (error) throw error; bus.emit('refresh-tab');
        }) }, '✕')))),
      el('div', { class: 'inline' }, wordInput, addWord)),
  ];
}

function addChildSheet() {
  const name = el('input', { class: 'input', placeholder: 'اسم الطفل', maxlength: '30' });
  const pick = avatarPicker('🦁');
  const btn = el('button', { class: 'btn primary block' }, 'إضافة وإظهار كود الدخول');
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
  await QRLib.toCanvas(canvas, url, { width: 260, margin: 2, errorCorrectionLevel: 'M' });
  const timer = el('div', { class: 'muted' });
  const end = Date.now() + 15 * 60e3;
  const tick = () => {
    const s = Math.max(0, Math.round((end - Date.now()) / 1000));
    timer.textContent = s ? `ينتهي بعد ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'انتهى الكود — افتح كود جديد';
  };
  tick();
  const iv = setInterval(tick, 1000);
  sheet(`كود دخول ${child.name}`, el('div', { class: 'stack center' },
    el('p', null, '📱 افتح كاميرا جوال ', el('b', null, child.name), ' وامسح الكود'),
    el('div', { class: 'qr-box' }, canvas),
    timer,
    el('p', { class: 'muted small' }, 'الكود يُستخدم مرة وحدة. إذا دخل الطفل من جهاز جديد، الجهاز القديم يطلع تلقائياً.'),
    el('p', { class: 'muted small' }, 'بعد ما يدخل: من Safari اضغط مشاركة ⬆️ ثم "إضافة إلى الشاشة الرئيسية"، ومن Chrome اضغط ⋮ ثم "تثبيت التطبيق".'),
    el('button', { class: 'btn soft sm', onclick: () => copy(url) }, '🔗 نسخ الرابط بدل الكود')),
  { onClose: () => clearInterval(iv) });
}

function childSettings(k) {
  const name = el('input', { class: 'input', value: k.name, maxlength: '30' });
  const pick = avatarPicker(k.avatar);
  const muted = el('input', { type: 'checkbox', class: 'switch', checked: k.muted });
  const quietOn = el('input', { type: 'checkbox', class: 'switch', checked: !!k.quiet_start });
  const qs = el('input', { type: 'time', class: 'input', value: (k.quiet_start || '21:00').slice(0, 5) });
  const qe = el('input', { type: 'time', class: 'input', value: (k.quiet_end || '06:00').slice(0, 5) });
  const btn = el('button', { class: 'btn primary block' }, 'حفظ');
  const close = sheet(`إعدادات ${k.name}`, el('div', { class: 'stack' },
    field('الاسم', name),
    el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'الصورة'), pick.node),
    el('label', { class: 'toggle-row' }, el('div', null, el('b', null, '🔒 إيقاف الإرسال'), el('small', { class: 'muted' }, 'يقدر يقرأ بس ما يرسل')), muted),
    el('label', { class: 'toggle-row' }, el('div', null, el('b', null, '🌙 وقت الراحة'), el('small', { class: 'muted' }, 'ما يقدر يرسل في هذا الوقت (توقيت السعودية)')), quietOn),
    el('div', { class: 'inline' }, field('من', qs), field('إلى', qe)),
    btn,
    el('hr'),
    el('button', { class: 'btn danger soft block', onclick: () => guard(async () => {
      if (!(await ask('تسجيل خروج جهاز الطفل؟', { ok: 'نعم', danger: true, detail: 'بيحتاج يمسح كود دخول جديد عشان يرجع' }))) return;
      await rpc('unpair_child', { p_child: k.id }); toast('تم تسجيل خروج الجهاز'); close(); bus.emit('refresh-tab');
    }) }, '📴 تسجيل خروج جهاز الطفل')), { full: true });
  btn.onclick = () => guard(async () => {
    await rpc('update_child', {
      p_child: k.id, p_name: name.value, p_avatar: pick.value, p_muted: muted.checked,
      p_quiet_start: quietOn.checked ? qs.value : null, p_quiet_end: quietOn.checked ? qe.value : null,
    });
    toast('تم الحفظ ✅', 'ok'); close(); bus.emit('refresh-tab');
  }, btn);
}

// ---------- مراقبة محادثات طفل ----------
async function renderWatch(childId) {
  const members = await rpc('family_members');
  const kid = members.find((m) => m.id === childId);
  if (!kid) return go('/family');
  const list = await rpc('my_conversations', { p_for: childId });
  app.replaceChildren(el('div', { class: 'sub' },
    el('header', { class: 'topbar' },
      el('button', { class: 'icon-btn back', onclick: () => go('/family'), 'aria-label': 'رجوع' }, '→'),
      av(kid.avatar, 'sm'), el('div', { class: 'grow' }, el('b', null, `محادثات ${kid.name}`), el('small', { class: 'muted block' }, '👁 وضع المراقبة'))),
    el('main', { class: 'page' },
      list.length ? el('div', { class: 'list' }, list.map((c) => {
        const r = convRow({ ...c, unread: 0 }, () => go('/chat/' + c.id));
        return r;
      })) : empty(`${kid.name} ما عنده محادثات للحين`, '', '💬'))));
}

// ---------- حسابي ----------
async function tabMe() {
  const notifState = 'Notification' in window ? Notification.permission : 'unsupported';
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return [
    el('div', { class: 'card center me-card' },
      el('span', { class: 'av xl' }, S.me.avatar),
      el('h2', null, S.me.name),
      el('small', { class: 'muted' }, S.me.role === 'parent' ? `ولي أمر · ${S.me.family_name}` : S.me.family_name),
      el('div', { class: 'big-code sm', dir: 'ltr' }, S.me.code),
      el('button', { class: 'btn soft sm', onclick: () => editProfile() }, '✏️ تعديل')),
    el('div', { class: 'card stack' },
      el('h3', null, '⚙️ الإعدادات'),
      notifState === 'unsupported' ? el('p', { class: 'muted small' }, isIOS && !isStandalone ? 'التنبيهات تشتغل بعد إضافة التطبيق للشاشة الرئيسية' : 'المتصفح ما يدعم التنبيهات')
        : notifState === 'granted' ? el('p', { class: 'muted small' }, '🔔 التنبيهات مفعّلة (تشتغل والتطبيق مفتوح أو بالخلفية)')
          : el('button', { class: 'btn soft block', onclick: async () => { await Notification.requestPermission(); bus.emit('refresh-tab'); } }, '🔔 تفعيل التنبيهات'),
      isStandalone ? null : S.installPrompt
        ? el('button', { class: 'btn soft block', onclick: async () => { S.installPrompt.prompt(); S.installPrompt = null; } }, '📲 تثبيت التطبيق على الجوال')
        : el('p', { class: 'muted small' }, isIOS ? '📲 للتثبيت: اضغط زر المشاركة ⬆️ في Safari ثم "إضافة إلى الشاشة الرئيسية"' : '📲 للتثبيت: من قائمة المتصفح ⋮ اختر "تثبيت التطبيق"'),
      el('button', { class: 'btn danger soft block', onclick: async () => {
        const detail = S.me.role === 'child' ? 'بتحتاج كود دخول جديد من أهلك عشان ترجع' : '';
        if (await ask('تسجيل خروج؟', { ok: 'خروج', danger: true, detail })) { await sb.auth.signOut(); }
      } }, '🚪 تسجيل خروج')),
  ];
}

function editProfile() {
  const name = el('input', { class: 'input', value: S.me.name, maxlength: '30' });
  const pick = avatarPicker(S.me.avatar);
  const btn = el('button', { class: 'btn primary block' }, 'حفظ');
  const close = sheet('تعديل حسابي', el('div', { class: 'stack' }, field('الاسم', name),
    el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'الصورة'), pick.node), btn), { full: true });
  btn.onclick = () => guard(async () => {
    await rpc('update_profile', { p_name: name.value, p_avatar: pick.value });
    S.me = await rpc('my_profile');
    close(); route();
  }, btn);
}

boot();

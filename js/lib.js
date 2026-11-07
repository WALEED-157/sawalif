import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { CONFIG } from './config.js';

export const APP_NAME = CONFIG.APP_NAME || 'سوالف العائلة';
export const SUPABASE_URL = (CONFIG.SUPABASE_URL || '').replace(/\/+$/, '');

// وضع العرض التجريبي: يشتغل فقط على جهاز المطوّر (localhost) لمعاينة الشاشات ببيانات وهمية
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
export const DEMO = isLocal ? new URLSearchParams(location.search).get('demo') : null;

const realConfigured = /^https:\/\/.+/.test(SUPABASE_URL) && (CONFIG.SUPABASE_ANON_KEY || '').length > 20;
export const configured = !!DEMO || realConfigured;
export const sb = DEMO
  ? (await import('./demo.js')).createDemoClient(DEMO, SUPABASE_URL)
  : realConfigured
    ? createClient(SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
    : null;

// حالة التطبيق
export const S = { session: null, me: null, memberConvs: new Set(), currentConv: null, installPrompt: null, path: '/' };

// ---------- event bus ----------
const listeners = {};
export const bus = {
  on(ev, fn) { (listeners[ev] ||= new Set()).add(fn); return () => listeners[ev].delete(fn); },
  emit(ev, data) { listeners[ev]?.forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); },
};

// ---------- تنظيف عند تغيير الصفحة ----------
let cleanups = [];
export const addCleanup = (fn) => cleanups.push(fn);
export function runCleanup() { const c = cleanups; cleanups = []; c.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

// ---------- التنقل داخل التطبيق (بدون سجل المتصفح، عشان زر الرجوع حق الجوال ما يطلّع من التطبيق) ----------
const navStack = [];
function setPath(p) {
  S.path = p;
  history.replaceState(history.state, '', location.pathname + location.search + '#' + p);
  bus.emit('route');
}
/** يفتح صفحة جديدة ويحفظ الحالية للرجوع لها */
export function go(p) { if (p !== S.path) navStack.push(S.path); setPath(p); }
/** يبدّل لتبويب رئيسي (يمسح سجل الرجوع) */
export function goRoot(p) { navStack.length = 0; setPath(p); }
/** زر الرجوع داخل التطبيق */
export function back(fallback = '/') { setPath(navStack.pop() || fallback); }

// النوافذ المفتوحة (عشان زر الرجوع حق الجوال يقفلها بدل ما يطلع)
const overlays = [];
export function pushOverlay(close) { overlays.push(close); return () => { const i = overlays.indexOf(close); if (i >= 0) overlays.splice(i, 1); }; }
export function closeTopOverlay() { const c = overlays.pop(); if (c) { c(); return true; } return false; }

// ---------- Supabase helpers ----------
export async function rpc(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(niceError(error));
  return data;
}

export function niceError(e) {
  const m = e?.message || String(e || '');
  if (/Failed to fetch|NetworkError|network|Load failed/i.test(m)) return 'ما فيه اتصال بالإنترنت';
  if (/Invalid login credentials/i.test(m)) return 'الإيميل أو كلمة المرور غلط';
  if (/already registered/i.test(m)) return 'هذا الإيميل مسجل من قبل، سجّل دخول';
  if (/Password should be/i.test(m)) return 'كلمة المرور لازم تكون 6 أحرف أو أكثر';
  if (/Email not confirmed/i.test(m)) return 'أكّد إيميلك أولاً من الرسالة اللي وصلتك';
  if (/Anonymous sign-ins are disabled/i.test(m)) return 'لازم تفعيل Anonymous sign-ins في إعدادات Supabase';
  if (/rate limit|too many/i.test(m)) return 'محاولات كثيرة، انتظر شوي وحاول';
  if (/Payload too large|exceeded the maximum/i.test(m)) return 'الملف كبير مرة';
  if (/mime type/i.test(m)) return 'نوع الملف غير مدعوم';
  return m || 'صار خطأ، حاول مرة ثانية';
}

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  }));

// ---------- DOM ----------
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'muted', 'srcObject', 'indeterminate']);
export function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) n.style.setProperty(sk, sv); else n.style[sk] = sv; }
      } else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : String(c));
  }
  return n;
}

// ---------- أيقونات (SVG بخط واحد، مستوحاة من Lucide) ----------
const P = {
  back: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  game: '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1.2" fill="currentColor" stroke="none"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  logout: '<path d="M15 21h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4"/><polyline points="8 17 3 12 8 7"/><line x1="3" x2="15" y1="12" y2="12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checks: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  chev: '<path d="m15 18-6-6 6-6"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
  compose: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
  flip: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  sticker: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/><path d="M8 13h.01"/><path d="M16 13h.01"/><path d="M10 16s.8 1 2 1c1.3 0 2-1 2-1"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  leave: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  bellRing: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M22 8c0-2.3-.8-4.3-2-6"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/>',
  volume: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
};
export function icon(name, cls = '') {
  const s = document.createElement('span');
  s.className = 'ic ' + cls;
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return s;
}

let toastTimer;
export function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3500);
}

export async function guard(fn, btn) {
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { console.error(e); toast(niceError(e), 'err'); }
  finally { if (btn) btn.disabled = false; }
}

// نافذة سفلية
export function sheet(title, content, { full = false, onClose } = {}) {
  let closed = false;
  let unreg = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    unreg();
    wrap.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => wrap.remove(), 240);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const body = el('div', { class: 'sheet-body' });
  const wrap = el('div', { class: 'sheet-wrap', onclick: (e) => { if (e.target === wrap) close(); } },
    el('div', { class: 'sheet' + (full ? ' full' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('div', { class: 'sheet-grab' }),
      el('div', { class: 'sheet-head' },
        el('h3', null, title),
        el('button', { class: 'icon-btn sm', 'aria-label': 'إغلاق', onclick: close }, icon('x'))),
      body));
  body.append(typeof content === 'function' ? content(close) : content);
  document.body.append(wrap);
  unreg = pushOverlay(close);
  requestAnimationFrame(() => wrap.classList.add('open'));
  document.addEventListener('keydown', onKey);
  return close;
}

export function ask(text, { ok = 'تأكيد', danger = false, detail = '' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    sheet(text, (close) => el('div', null,
      detail ? el('p', { class: 'muted' }, detail) : null,
      el('div', { class: 'row-btns stretch' },
        el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { answered = true; close(); resolve(true); } }, ok),
        el('button', { class: 'btn soft', onclick: () => close() }, 'إلغاء'))),
    { onClose: () => { if (!answered) resolve(false); } });
  });
}

export function copy(text) {
  (navigator.clipboard?.writeText(text) || Promise.reject())
    .then(() => toast('تم النسخ', 'ok'))
    .catch(() => { prompt('انسخ:', text); });
}

// لون ثابت لكل شخص (مشتق من المعرّف)
export function hueOf(seed = '') {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}
export const av = (emoji, size = '', seed) => el('span', {
  class: 'av ' + size, 'aria-hidden': 'true', style: { '--h': String(hueOf(seed ?? emoji)) },
}, emoji || '🙂');

export const empty = (title, sub, emoji = '🌱') => el('div', { class: 'empty' },
  el('div', { class: 'empty-art' }, emoji), el('b', null, title), sub ? el('p', { class: 'muted' }, sub) : null);
export const spinner = () => el('div', { class: 'loading' }, el('div', { class: 'spinner' }));
export const skeletonRows = (n = 5) => el('div', { class: 'list' }, Array.from({ length: n }, () =>
  el('div', { class: 'row skel' }, el('span', { class: 'av md sk' }), el('div', { class: 'row-main' }, el('i', { class: 'sk l1' }), el('i', { class: 'sk l2' })))));

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const toLatinDigits = (s) => String(s || '')
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

// ---------- التاريخ والوقت ----------
const clockF = new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { hour: 'numeric', minute: '2-digit' });
const dayF = new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'long' });
const weekF = new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { weekday: 'long' });
export const fmtClock = (iso) => clockF.format(new Date(iso));
export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return clockF.format(d);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'أمس';
  if (now - d < 6 * 864e5) return weekF.format(d);
  return dayF.format(d);
}
export function fmtDay(iso) {
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'اليوم';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'أمس';
  return dayF.format(d);
}
export const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------- المحتوى الثابت ----------
export const AVATARS = ['🦁', '🐯', '🐼', '🐨', '🐸', '🐵', '🦊', '🐰', '🐱', '🐶', '🦄', '🐲', '🐙', '🦋', '🐬',
  '🐧', '🦉', '🐢', '🐝', '🐞', '🦖', '🐳', '🌟', '⚽', '🚀', '🎮', '🌈', '🍩', '👦', '👧', '👨', '👩', '🧔', '🧕',
  '👵', '👴', '🤖', '👽', '😎', '🥷'];

export const STICKER_PACKS = [
  { id: 'faces', icon: '😀', name: 'وجوه', items: ['😂', '🤣', '😍', '🥰', '😘', '😎', '🤩', '🥳', '😇', '🤔', '🤭', '😴',
    '😱', '😡', '🥺', '😭', '🤪', '😜', '🙄', '🤗', '🫡', '🤐', '😋', '🤯'] },
  { id: 'animals', icon: '🐱', name: 'حيوانات', items: ['🐱', '🐶', '🐼', '🦁', '🐯', '🐸', '🐵', '🙈', '🐰', '🦊', '🐻', '🐨',
    '🐷', '🐮', '🐔', '🐧', '🦄', '🐲', '🐙', '🦈', '🐢', '🦋', '🐝', '🦖'] },
  { id: 'food', icon: '🍕', name: 'أكل', items: ['🍕', '🍔', '🍟', '🌭', '🍩', '🍪', '🎂', '🍰', '🧁', '🍫', '🍦', '🍿',
    '🍉', '🍓', '🍌', '🍎', '🥤', '🧃', '☕', '🍗', '🥪', '🌮', '🍜', '🥞'] },
  { id: 'fun', icon: '🎉', name: 'مرح', items: ['🎉', '🎁', '🏆', '⚽', '🏀', '🎮', '❤️', '💯', '🔥', '⭐', '👍', '👏',
    '🙏', '💪', '✌️', '👋', '🤝', '🌙', '☀️', '🌈', '🎈', '🚀', '👑', '💎'] },
];

export const PHRASES = [
  { id: 'salam', t: 'السلام عليكم', e: '👋', c: ['#00b894', '#55efc4'] },
  { id: 'hala', t: 'هلا والله', e: '🤗', c: ['#6c5ce7', '#a29bfe'] },
  { id: 'mashallah', t: 'ما شاء الله', e: '✨', c: ['#e17055', '#fdcb6e'] },
  { id: 'hhh', t: 'هههههه', e: '😂', c: ['#e84393', '#fd79a8'] },
  { id: 'love', t: 'أحبكم', e: '❤️', c: ['#d63031', '#ff7675'] },
  { id: 'thanks', t: 'شكراً', e: '🌹', c: ['#e84393', '#fab1a0'] },
  { id: 'ok', t: 'تمام', e: '👌', c: ['#0984e3', '#74b9ff'] },
  { id: 'wait', t: 'لحظة', e: '⏳', c: ['#636e72', '#a4b0be'] },
  { id: 'play', t: 'تعال نلعب', e: '🎮', c: ['#00a8a8', '#00cec9'] },
  { id: 'night', t: 'تصبحون على خير', e: '🌙', c: ['#2d3436', '#6c5ce7'] },
  { id: 'morning', t: 'صباح الخير', e: '☀️', c: ['#e17055', '#f6b93b'] },
  { id: 'kafo', t: 'كفو!', e: '🏆', c: ['#00b894', '#f6b93b'] },
  { id: 'miss', t: 'وحشتني', e: '🥺', c: ['#6c5ce7', '#fd79a8'] },
  { id: 'lunch', t: 'يلا الغدا', e: '🍽️', c: ['#e17055', '#fab1a0'] },
  { id: 'study', t: 'وقت المذاكرة', e: '📚', c: ['#0984e3', '#00cec9'] },
  { id: 'eid', t: 'عيدكم مبارك', e: '🌙', c: ['#6c5ce7', '#f6b93b'] },
];

const STICKER_PUBLIC = `${SUPABASE_URL}/storage/v1/object/public/stickers/`;
export const stickerUrl = (path) => STICKER_PUBLIC + path;

export function renderSticker(meta = {}) {
  if (meta.t === 'emoji') return el('div', { class: 'stk-emoji' }, meta.v);
  if (meta.t === 'phrase') {
    const p = PHRASES.find((x) => x.id === meta.id);
    if (!p) return el('div', { class: 'stk-emoji' }, '❓');
    return el('div', { class: 'stk-phrase', style: { background: `linear-gradient(135deg, ${p.c[0]}, ${p.c[1]})` } },
      el('span', { class: 'stk-pe' }, p.e), el('span', null, p.t));
  }
  if (meta.t === 'custom' && typeof meta.url === 'string' && meta.url.startsWith(STICKER_PUBLIC)) {
    return el('img', { class: 'stk-img', src: meta.url, alt: 'ملصق', loading: 'lazy' });
  }
  return el('div', { class: 'stk-emoji' }, '❓');
}

export function previewText(kind, body) {
  switch (kind) {
    case 'text': return body || '';
    case 'sticker': return '🎨 ملصق';
    case 'image': return '📷 صورة';
    case 'audio': return '🎤 رسالة صوتية';
    case 'video': return '🎬 فيديو';
    case 'game': return '🎮 تحدّي لعبة';
    case 'buzz': return '🔔 تنبيه!';
    case 'system': return body || '';
    default: return '';
  }
}

// ---------- أصوات التنبيه ----------
// المستوى: loud (قوي، الافتراضي) | normal (عادي) | off (بدون)
export function soundLevel() { try { return localStorage.getItem('fc_sound') || 'loud'; } catch { return 'loud'; } }
export function setSoundLevel(v) { try { localStorage.setItem('fc_sound', v); } catch { /* ignore */ } }

let actx;
function audio() {
  actx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
// المتصفحات تحتاج لمسة من المستخدم قبل تشغيل الصوت
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => addEventListener(ev, () => { try { audio(); } catch { /* ignore */ } }, { once: true, passive: true }));

function tone(ctx, freq, start, dur, gain, type = 'sine') {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(ctx.destination); o.start(start); o.stop(start + dur + 0.02);
}

/** نغمة رسالة جديدة (3 نغمات واضحة) */
export function playMessageSound() {
  const lvl = soundLevel();
  if (lvl === 'off') return;
  try {
    const ctx = audio(); const t = ctx.currentTime; const vol = lvl === 'loud' ? 0.9 : 0.3;
    [[784, 0], [988, 0.11], [1319, 0.22]].forEach(([f, d]) => {
      tone(ctx, f, t + d, 0.28, vol, 'triangle');
      tone(ctx, f * 2, t + d, 0.18, vol * 0.25, 'sine');
    });
    if (lvl === 'loud') navigator.vibrate?.([180, 80, 180]);
  } catch { /* ignore */ }
}

/** رنّة التنبيه القوية (تتكرر لين يوقفها المستخدم) — ترجع دالة الإيقاف */
export function startRingtone(maxSec = 15) {
  if (soundLevel() === 'off') { navigator.vibrate?.([500, 200, 500]); return () => {}; }
  let stopped = false; let timer;
  const ring = () => {
    if (stopped) return;
    try {
      const ctx = audio(); const t = ctx.currentTime;
      for (let i = 0; i < 6; i++) {
        tone(ctx, i % 2 ? 1175 : 1568, t + i * 0.09, 0.09, 1, 'square');
        tone(ctx, i % 2 ? 587 : 784, t + i * 0.09, 0.09, 0.5, 'triangle');
      }
      for (let i = 0; i < 6; i++) tone(ctx, i % 2 ? 1175 : 1568, t + 0.75 + i * 0.09, 0.09, 1, 'square');
    } catch { /* ignore */ }
    navigator.vibrate?.([600, 200, 600]);
    timer = setTimeout(ring, 2000);
  };
  ring();
  const end = setTimeout(() => stop(), maxSec * 1000);
  function stop() { stopped = true; clearTimeout(timer); clearTimeout(end); navigator.vibrate?.(0); }
  return stop;
}

// اختيار الأفاتار
export function avatarPicker(initial) {
  let value = initial || AVATARS[0];
  const grid = el('div', { class: 'av-grid', role: 'radiogroup', 'aria-label': 'اختر صورة' });
  const draw = () => grid.replaceChildren(...AVATARS.map((a) => el('button', {
    type: 'button', class: 'av-opt' + (a === value ? ' on' : ''), role: 'radio', 'aria-checked': String(a === value),
    style: { '--h': String(hueOf(a)) }, onclick: () => { value = a; draw(); },
  }, a)));
  draw();
  return { node: grid, get value() { return value; } };
}

export function field(label, input, hint) {
  return el('label', { class: 'field' }, el('span', { class: 'lbl' }, label), input, hint ? el('small', { class: 'muted' }, hint) : null);
}

/** شريط علوي للصفحات الفرعية مع زر رجوع */
export function navbar({ title, subtitle, avatar, onBack, actions = [], onTitle }) {
  return el('header', { class: 'navbar' },
    el('button', { class: 'icon-btn', 'aria-label': 'رجوع', onclick: onBack }, icon('back')),
    avatar || null,
    el(onTitle ? 'button' : 'div', { class: 'nav-title', onclick: onTitle || null },
      el('b', { class: 'ellipsis' }, title),
      subtitle ? el('small', { class: 'ellipsis' }, subtitle) : null),
    el('div', { class: 'nav-actions' }, actions));
}

/** صف إعدادات بأيقونة */
export function settingRow({ ic, tone = '', title, sub, end, onclick }) {
  return el(onclick ? 'button' : 'div', { class: 'srow', onclick: onclick || null },
    el('span', { class: 'srow-ic ' + tone }, icon(ic)),
    el('div', { class: 'row-main' }, el('b', null, title), sub ? el('small', { class: 'muted' }, sub) : null),
    end ?? (onclick ? icon('chev', 'chev') : null));
}

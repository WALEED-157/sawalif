import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { CONFIG } from './config.js';

export const APP_NAME = CONFIG.APP_NAME || 'سوالف العائلة';
export const SUPABASE_URL = (CONFIG.SUPABASE_URL || '').replace(/\/+$/, '');
export const configured = /^https:\/\/.+/.test(SUPABASE_URL) && (CONFIG.SUPABASE_ANON_KEY || '').length > 20;
export const sb = configured
  ? createClient(SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

// حالة التطبيق
export const S = { session: null, me: null, memberConvs: new Set(), currentConv: null, installPrompt: null };

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

// ---------- Supabase helpers ----------
export async function rpc(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(niceError(error));
  return data;
}

export function niceError(e) {
  const m = e?.message || String(e || '');
  if (/Failed to fetch|NetworkError|network|Load failed/i.test(m)) return 'ما فيه اتصال بالإنترنت 📶';
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

export const go = (p) => { location.hash = '#' + p; };
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
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
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
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => wrap.remove(), 220);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const body = el('div', { class: 'sheet-body' });
  const wrap = el('div', { class: 'sheet-wrap', onclick: (e) => { if (e.target === wrap) close(); } },
    el('div', { class: 'sheet' + (full ? ' full' : ''), role: 'dialog', 'aria-modal': 'true' },
      el('div', { class: 'sheet-head' },
        el('h3', null, title),
        el('button', { class: 'icon-btn', 'aria-label': 'إغلاق', onclick: close }, '✕')),
      body));
  body.append(typeof content === 'function' ? content(close) : content);
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  document.addEventListener('keydown', onKey);
  return close;
}

export function ask(text, { ok = 'تأكيد', danger = false, detail = '' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const close = sheet(text, (close) => el('div', null,
      detail ? el('p', { class: 'muted' }, detail) : null,
      el('div', { class: 'row-btns' },
        el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { answered = true; close(); resolve(true); } }, ok),
        el('button', { class: 'btn soft', onclick: () => close() }, 'إلغاء'))),
    { onClose: () => { if (!answered) resolve(false); } });
    void close;
  });
}

export function copy(text) {
  (navigator.clipboard?.writeText(text) || Promise.reject())
    .then(() => toast('تم النسخ 📋', 'ok'))
    .catch(() => { prompt('انسخ:', text); });
}

export const av = (emoji, size = '') => el('span', { class: 'av ' + size, 'aria-hidden': 'true' }, emoji || '🙂');
export const empty = (title, sub, icon = '🌱') => el('div', { class: 'empty' },
  el('div', { class: 'empty-ic' }, icon), el('b', null, title), sub ? el('p', { class: 'muted' }, sub) : null);
export const spinner = () => el('div', { class: 'loading' }, el('div', { class: 'spinner' }));

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
    case 'system': return body || '';
    default: return '';
  }
}

// صوت تنبيه خفيف
let actx;
export function ding() {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(); const g = actx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(880, actx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, actx.currentTime + 0.12);
    g.gain.setValueAtTime(0.0001, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, actx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.3);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.32);
  } catch { /* ignore */ }
}

// اختيار الأفاتار
export function avatarPicker(initial) {
  let value = initial || AVATARS[0];
  const grid = el('div', { class: 'av-grid', role: 'radiogroup', 'aria-label': 'اختر صورة' });
  const draw = () => grid.replaceChildren(...AVATARS.map((a) => el('button', {
    type: 'button', class: 'av-opt' + (a === value ? ' on' : ''), role: 'radio', 'aria-checked': String(a === value),
    onclick: () => { value = a; draw(); },
  }, a)));
  draw();
  return { node: grid, get value() { return value; } };
}

export function field(label, input, hint) {
  return el('label', { class: 'field' }, el('span', { class: 'lbl' }, label), input, hint ? el('small', { class: 'muted' }, hint) : null);
}

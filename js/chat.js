import {
  sb, S, bus, rpc, el, toast, guard, sheet, ask, go, av, empty, spinner, copy, fmtClock, fmtDay, fmtDur,
  renderSticker, STICKER_PACKS, PHRASES, stickerUrl, addCleanup, niceError, uuid, debounce,
} from './lib.js';
import { GAMES, startGame } from './games.js';

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/mp4': 'm4a', 'audio/webm': 'webm',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};
const MEDIA_LABEL = { image: '📷 صورة', audio: '🎤 رسالة صوتية', video: '🎬 فيديو' };
const MAX_AUDIO = 60;
const MAX_VIDEO = 30;

const pickMime = (list) => (window.MediaRecorder ? list.find((t) => MediaRecorder.isTypeSupported?.(t)) : undefined);

export async function renderChat(app, convId) {
  S.currentConv = convId;
  addCleanup(() => { S.currentConv = null; });

  const [info, me] = await Promise.all([rpc('conversation_info', { p_conv: convId }), rpc('my_profile')]);
  if (me) S.me = me;
  const members = new Map(info.members.map((m) => [m.id, m]));
  const isDirect = info.kind === 'direct';
  const watching = info.monitor && !info.is_member;
  const other = isDirect ? info.members.find((m) => m.id !== S.me.id) : null;

  let title; let pic; let subtitle;
  if (isDirect && !watching) {
    title = other?.name || 'محادثة'; pic = other?.avatar;
    subtitle = other && other.family_id !== S.me.family_id ? other.family : (other?.role === 'parent' ? 'ولي أمر' : 'من العائلة');
  } else if (isDirect) {
    title = info.members.map((m) => m.name).join(' و '); pic = '💬'; subtitle = '👁 وضع المراقبة';
  } else {
    title = info.title; pic = info.emoji;
    subtitle = (watching ? '👁 وضع المراقبة · ' : '') + `${info.members.length} أعضاء`;
  }

  // ---------- الهيكل ----------
  const scroller = el('div', { class: 'msgs', role: 'log', 'aria-live': 'polite' });
  const header = el('header', { class: 'topbar chat-top' },
    el('button', { class: 'icon-btn back', 'aria-label': 'رجوع', onclick: () => (history.length > 1 ? history.back() : go('/')) }, '→'),
    av(pic, 'sm'),
    el('button', { class: 'grow title-btn', onclick: () => membersSheet() }, el('b', { class: 'ellipsis block' }, title), el('small', { class: 'muted block' }, subtitle)),
    info.is_member ? el('button', { class: 'icon-btn', 'aria-label': 'لعبة', onclick: () => gameSheet() }, '🎮') : null);
  const composerHost = el('div', { class: 'composer-host' });
  app.replaceChildren(el('div', { class: 'chat' }, header, scroller, composerHost));

  // ---------- الرسائل ----------
  const msgs = [];
  const nodes = new Map();
  const views = new Map(); // messageId -> Set(profileId)

  scroller.append(spinner());
  const { data: rows, error } = await sb.from('messages').select('*')
    .eq('conversation_id', convId).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  rows.reverse().forEach((m) => msgs.push(m));
  const onceIds = msgs.filter((m) => m.view_once).map((m) => m.id);
  if (onceIds.length) {
    const { data: v } = await sb.from('message_views').select('message_id, profile_id').in('message_id', onceIds);
    (v || []).forEach((x) => { if (!views.has(x.message_id)) views.set(x.message_id, new Set()); views.get(x.message_id).add(x.profile_id); });
  }

  let lastDay = '';
  const renderAll = () => {
    scroller.replaceChildren();
    nodes.clear(); lastDay = '';
    if (!msgs.length) scroller.append(empty('ابدأ السالفة 👋', 'أرسل رسالة أو ملصق', '💬'));
    msgs.forEach((m) => appendNode(m));
    scrollBottom(true);
  };
  const appendNode = (m) => {
    const day = fmtDay(m.created_at);
    if (day !== lastDay) { scroller.append(el('div', { class: 'day' }, el('span', null, day))); lastDay = day; }
    const n = renderMsg(m);
    nodes.set(m.id, n);
    scroller.append(n);
  };
  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
  const scrollBottom = (force) => { if (force || nearBottom()) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; }); };

  const addMsg = (m) => {
    if (m.conversation_id !== convId || nodes.has(m.id)) return;
    const wasNear = nearBottom();
    if (!msgs.length) scroller.replaceChildren();
    msgs.push(m);
    appendNode(m);
    if (wasNear || m.sender_id === S.me.id) scrollBottom(true);
    if (info.is_member) markRead();
  };
  const replaceMsg = (m) => {
    const i = msgs.findIndex((x) => x.id === m.id);
    if (i < 0) return;
    msgs[i] = m;
    const old = nodes.get(m.id);
    if (old) { const n = renderMsg(m); old.replaceWith(n); nodes.set(m.id, n); }
  };

  const markRead = debounce(() => rpc('mark_read', { p_conv: convId }).then(() => bus.emit('refresh-chats')).catch(() => {}), 700);
  if (info.is_member) markRead();

  addCleanup(bus.on('message', (m) => {
    if (m.conversation_id !== convId) return;
    if (m.kind === 'system') { refreshInfo(); }
    addMsg(m);
  }));
  addCleanup(bus.on('message_update', (m) => { if (m.conversation_id === convId) replaceMsg(m); }));
  addCleanup(bus.on('view', (v) => {
    const m = msgs.find((x) => x.id === v.message_id);
    if (!m) return;
    if (!views.has(m.id)) views.set(m.id, new Set());
    views.get(m.id).add(v.profile_id);
    replaceMsg(m);
  }));

  async function refreshInfo() {
    try {
      const ni = await rpc('conversation_info', { p_conv: convId });
      ni.members.forEach((m) => members.set(m.id, m));
      info.members = ni.members;
    } catch { /* ignore */ }
  }

  // ---------- رسم رسالة ----------
  function renderMsg(m) {
    if (m.kind === 'system') return el('div', { class: 'sys' }, el('span', null, m.body || ''));
    const mine = m.sender_id === S.me.id;
    const sender = members.get(m.sender_id);
    const showName = !mine && (!isDirect || watching);
    const isSticker = m.kind === 'sticker' && !m.removed_by;
    const bubble = el('div', { class: 'bubble' + (isSticker ? ' sticker' : '') + (m.flagged && info.monitor ? ' flagged' : '') },
      showName ? el('div', { class: 'who' }, sender ? sender.name : 'عضو سابق') : null,
      msgContent(m, mine),
      el('div', { class: 'meta' },
        m.flagged && info.monitor && !m.removed_by ? el('span', { class: 'flag' }, '⚠️ ' + (m.flag_reason || '')) : null,
        el('time', null, fmtClock(m.created_at))));
    const canAct = !m.removed_by && (mine || info.monitor);
    if (canAct) {
      bubble.classList.add('tappable');
      bubble.addEventListener('click', (e) => { if (e.target.closest('button, video, audio, a')) return; msgActions(m, mine); });
    }
    return el('div', { class: 'msg ' + (mine ? 'mine' : 'theirs') },
      !mine && !isDirect ? av(sender?.avatar || '👤', 'sm') : null, bubble);
  }

  function msgContent(m, mine) {
    if (m.removed_by) return el('i', { class: 'muted' }, '🚫 تم حذف الرسالة');
    switch (m.kind) {
      case 'text': return el('div', { class: 'text', dir: 'auto' }, m.body || '');
      case 'sticker': return renderSticker(m.meta);
      case 'game': return gameCard(m, mine);
      case 'image': case 'audio': case 'video': return mediaContent(m, mine);
      default: return el('span', null, '');
    }
  }

  function mediaContent(m, mine) {
    const label = MEDIA_LABEL[m.kind];
    const dur = m.meta?.duration ? ` · ${fmtDur(m.meta.duration)}` : '';
    if (m.media_expired || !m.media_path) return el('div', { class: 'media-chip off' }, `${label} — ⌛ انتهت مدته`);
    const seen = views.get(m.id) || new Set();
    const seenByOthers = [...seen].filter((id) => id !== m.sender_id);
    const seenText = isDirect ? (seenByOthers.length ? '✓ انشافت' : 'ما انفتحت للحين')
      : `شافها ${seenByOthers.length} من ${Math.max(0, info.members.length - 1)}`;

    if (info.monitor) {
      return el('div', { class: 'media-wrap' },
        el('button', { class: 'media-chip once', onclick: () => openMedia(m, false) }, `${label}${dur}`, el('small', null, '👁 عرض (مراقبة)')),
        el('small', { class: 'muted' }, seenText));
    }
    if (mine) {
      return el('div', { class: 'media-wrap' },
        el('div', { class: 'media-chip sent' }, `${label}${dur}`, el('small', null, '1️⃣ مرة وحدة')),
        el('small', { class: 'seen' }, seenText));
    }
    if (seen.has(S.me.id)) return el('div', { class: 'media-chip off' }, `${label} — ✓ تمت المشاهدة`);
    return el('button', { class: 'media-chip once pulse', onclick: () => openMedia(m, true) },
      `${label}${dur}`, el('small', null, 'اضغط للمشاهدة · مرة وحدة 1️⃣'));
  }

  function openMedia(m, once) {
    guard(async () => {
      if (once && !(await ask('تنشاف مرة وحدة بس 👀', { ok: 'افتح الحين', detail: 'بعد ما تقفلها ما تقدر تفتحها مرة ثانية' }))) return;
      const path = await rpc('open_view_once', { p_msg: m.id });
      if (once) {
        if (!views.has(m.id)) views.set(m.id, new Set());
        views.get(m.id).add(S.me.id);
      }
      const { data, error: e } = await sb.storage.from('media').createSignedUrl(path, 180);
      if (e) throw e;
      viewer(m.kind, data.signedUrl, once, () => replaceMsg(m));
    });
  }

  function gameCard(m, mine) {
    const g = GAMES[m.meta?.game];
    if (!g) return el('span', null, '🎮');
    const sender = members.get(m.sender_id);
    const opp = members.get(m.meta?.opponent);
    const line = mine ? `تحدّيت ${opp?.name || ''}` : (m.meta?.opponent === S.me.id ? `${sender?.name || ''} يتحداك!` : `${sender?.name || ''} تحدّى ${opp?.name || ''}`);
    return el('div', { class: 'game-card' },
      el('span', { class: 'gc-ic' }, g.ic),
      el('div', { class: 'grow' }, el('b', { class: 'block' }, g.name), el('small', null, line)),
      el('button', { class: 'btn primary sm', onclick: () => go('/game/' + m.meta.game_id) }, info.is_member ? 'العب' : 'شوف'));
  }

  function msgActions(m, mine) {
    const close = sheet('خيارات الرسالة', el('div', { class: 'stack' },
      m.kind === 'text' ? el('button', { class: 'btn soft block', onclick: () => { copy(m.body); close(); } }, '📋 نسخ') : null,
      info.monitor && m.flagged && !m.flag_reviewed ? el('button', { class: 'btn soft block', onclick: () => guard(async () => { await rpc('review_alert', { p_msg: m.id }); close(); toast('تم'); }) }, '✓ تمت مراجعة التنبيه') : null,
      el('button', { class: 'btn danger soft block', onclick: () => guard(async () => {
        close();
        if (!(await ask('حذف الرسالة للجميع؟', { ok: 'حذف', danger: true }))) return;
        if (m.media_path) await sb.storage.from('media').remove([m.media_path]).catch(() => {});
        await rpc('remove_message', { p_msg: m.id });
        replaceMsg({ ...m, removed_by: S.me.id, body: null, media_path: null, meta: {} });
      }) }, '🗑️ حذف للجميع')));
  }

  // ---------- الأعضاء ----------
  function membersSheet() {
    const isFamilyGroup = info.id === S.me.family_group;
    const close = sheet(isDirect ? title : `${info.emoji} ${info.title}`, el('div', { class: 'stack' },
      el('div', { class: 'list' }, info.members.map((p) => el('div', { class: 'row' },
        av(p.avatar, 'md'),
        el('div', { class: 'row-main' }, el('b', null, p.name + (p.id === S.me.id ? ' (أنت)' : '')),
          el('small', { class: 'muted' }, (p.role === 'parent' ? 'ولي أمر · ' : '') + p.family)),
        !isDirect && S.me.role === 'parent' && p.role === 'child' && p.family_id === S.me.family_id && p.id !== S.me.id && !isFamilyGroup
          ? el('button', { class: 'btn danger soft sm', onclick: () => guard(async () => {
            if (!(await ask(`إخراج ${p.name} من القروب؟`, { ok: 'إخراج', danger: true }))) return;
            await rpc('leave_group', { p_conv: convId, p_profile: p.id }); close(); await refreshInfo();
          }) }, 'إخراج') : null))),
      !isDirect && info.is_member ? el('button', { class: 'btn soft block', onclick: () => { close(); guard(addMemberSheet); } }, '➕ إضافة عضو') : null,
      !isDirect && info.is_member && !isFamilyGroup ? el('button', { class: 'btn danger soft block', onclick: () => guard(async () => {
        if (!(await ask('تطلع من القروب؟', { ok: 'خروج', danger: true }))) return;
        await rpc('leave_group', { p_conv: convId, p_profile: null }); close(); go('/');
      }) }, '🚪 الخروج من القروب') : null));
  }

  async function addMemberSheet() {
    const contacts = (await rpc('my_contacts')).filter((c) => !info.members.some((m) => m.id === c.id));
    const close = sheet('إضافة عضو', contacts.length
      ? el('div', { class: 'list' }, contacts.map((p) => el('div', { class: 'row' }, av(p.avatar, 'md'),
        el('div', { class: 'row-main' }, el('b', null, p.name), el('small', { class: 'muted' }, p.same_family ? 'من العائلة' : p.family)),
        el('button', { class: 'btn primary sm', onclick: (e) => guard(async () => {
          await rpc('add_group_member', { p_conv: convId, p_profile: p.id }); close(); await refreshInfo(); toast('تمت الإضافة 👋', 'ok');
        }, e.currentTarget) }, 'إضافة'))))
      : empty('كل أصدقائك موجودين', '', '👍'));
  }

  // ---------- الألعاب ----------
  function gameSheet() {
    const opponents = info.members.filter((m) => m.id !== S.me.id);
    const close = sheet('🎮 تحدّي بلعبة', (closeFn) => {
      let chosen = isDirect ? opponents[0]?.id : null;
      const box = el('div', { class: 'stack' });
      const draw = () => {
        box.replaceChildren(
          !isDirect ? el('div', null, el('span', { class: 'lbl' }, 'مع مين؟'), el('div', { class: 'chip-row' }, opponents.map((p) =>
            el('button', { class: 'chip' + (chosen === p.id ? ' on' : ''), onclick: () => { chosen = p.id; draw(); } }, `${p.avatar} ${p.name}`)))) : null,
          el('div', { class: 'game-grid' }, Object.entries(GAMES).map(([kind, g]) => el('button', {
            class: 'game-tile', style: { '--g1': g.colors[0], '--g2': g.colors[1] },
            onclick: () => guard(async () => {
              if (!chosen) throw new Error('اختر خصمك أولاً');
              closeFn(); await startGame(convId, kind, chosen);
            }),
          }, el('span', { class: 'gt-ic' }, g.icon), el('b', null, g.name), el('small', null, g.desc)))));
      };
      draw();
      return box;
    });
    void close;
  }

  // ---------- الكتابة والإرسال ----------
  const sendRpc = (kind, body, path, meta) => rpc('send_message', {
    p_conv: convId, p_kind: kind, p_body: body ?? null, p_media_path: path ?? null, p_meta: meta ?? {},
  });

  function lockedBar(text) { return el('div', { class: 'monitor-bar' }, text); }

  function buildComposer() {
    if (watching) return lockedBar('👁 أنت تشوف المحادثة كولي أمر — اضغط على أي رسالة عشان تحذفها');
    if (!info.is_member) return lockedBar('لست عضواً في هذي المحادثة');
    if (S.me.muted) return lockedBar('🔒 الإرسال موقوف مؤقتاً من الأهل');
    if (S.me.in_quiet) return lockedBar('🌙 وقت الراحة — تقدر ترسل بعدين');

    const ta = el('textarea', { class: 'ta', rows: '1', placeholder: 'اكتب رسالة...', dir: 'auto', maxlength: '2000', 'aria-label': 'الرسالة' });
    const sendBtn = el('button', { class: 'send', 'aria-label': 'إرسال' }, el('span', { class: 'send-ic' }, '➤'));
    const micBtn = el('button', { class: 'send mic', 'aria-label': 'تسجيل صوتي' }, '🎤');
    const stickerBtn = el('button', { class: 'icon-btn', 'aria-label': 'ملصقات', onclick: () => stickerSheet() }, '😀');
    const attachBtn = el('button', { class: 'icon-btn', 'aria-label': 'إرفاق', onclick: () => attachSheet() }, '📎');
    const sync = () => {
      const has = ta.value.trim().length > 0;
      sendBtn.style.display = has ? '' : 'none';
      micBtn.style.display = has ? 'none' : '';
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 130) + 'px';
    };
    ta.addEventListener('input', sync);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); sendText(); }
    });
    const sendText = () => {
      const body = ta.value.trim();
      if (!body) return;
      ta.value = ''; sync(); ta.focus();
      const temp = pendingBubble('…');
      sendRpc('text', body).then((row) => { temp.remove(); addMsg(row); })
        .catch((e) => { temp.remove(); ta.value = body; sync(); toast(niceError(e), 'err'); });
    };
    sendBtn.onclick = sendText;
    micBtn.onclick = () => recordAudio(bar);
    const bar = el('div', { class: 'composer' }, attachBtn, stickerBtn, ta, micBtn, sendBtn);
    sync();
    return bar;
  }

  function pendingBubble(text) {
    const n = el('div', { class: 'msg mine pending' }, el('div', { class: 'bubble' }, el('div', { class: 'text' }, text, ' ⏳')));
    scroller.append(n); scrollBottom(true);
    return n;
  }

  async function sendSticker(meta) {
    await guard(async () => { const row = await sendRpc('sticker', null, null, meta); addMsg(row); });
  }

  async function uploadAndSend(kind, blob, meta = {}) {
    const type = (blob.type || '').split(';')[0] || { image: 'image/jpeg', audio: 'audio/webm', video: 'video/mp4' }[kind];
    const ext = EXT[type] || type.split('/')[1] || 'bin';
    const path = `${convId}/${uuid()}.${ext}`;
    const temp = pendingBubble(`${MEDIA_LABEL[kind]} جاري الإرسال`);
    try {
      const { error: upErr } = await sb.storage.from('media').upload(path, blob, { contentType: type, upsert: false });
      if (upErr) throw upErr;
      const row = await sendRpc(kind, null, path, meta);
      temp.remove(); addMsg(row);
    } catch (e) {
      temp.remove(); toast(niceError(e), 'err');
      sb.storage.from('media').remove([path]).catch(() => {});
    }
  }

  // ---------- المرفقات ----------
  function pickFile(accept, onFile) {
    const inp = el('input', { type: 'file', accept, style: { display: 'none' } });
    inp.onchange = () => { const f = inp.files?.[0]; inp.remove(); if (f) onFile(f); };
    document.body.append(inp);
    inp.click();
  }

  function attachSheet() {
    const close = sheet('إرسال', el('div', { class: 'attach-grid' },
      el('button', { class: 'attach', onclick: () => { close(); pickFile('image/*', (f) => guard(async () => uploadAndSend('image', await compressImage(f)))); } },
        el('span', null, '📷'), 'صورة'),
      el('button', { class: 'attach', onclick: () => { close(); recordVideo(); } }, el('span', null, '🎥'), `تصوير فيديو (${MAX_VIDEO} ث)`),
      el('button', { class: 'attach', onclick: () => { close(); pickFile('video/*', (f) => guard(() => sendVideoFile(f))); } }, el('span', null, '🎞️'), 'فيديو من الجوال'),
      el('button', { class: 'attach', onclick: () => { close(); gameSheet(); } }, el('span', null, '🎮'), 'تحدّي لعبة')),
    );
  }

  async function sendVideoFile(f) {
    if (f.size > 20 * 1024 * 1024) throw new Error('الفيديو كبير، الحد 20 ميقا');
    const d = await mediaDuration(f);
    if (d && d > MAX_VIDEO + 1) throw new Error(`الفيديو لازم يكون ${MAX_VIDEO} ثانية أو أقل`);
    await uploadAndSend('video', f, { duration: Math.round(d || 0) });
  }

  // ---------- تسجيل صوت ----------
  async function recordAudio(bar) {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('جهازك ما يدعم التسجيل', 'err');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('اسمح للتطبيق يستخدم المايك 🎤', 'err'); }
    const mime = pickMime(['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']);
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
    const chunks = [];
    let cancelled = false;
    const start = Date.now();
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const timeEl = el('span', { class: 'rec-time' }, '0:00');
    const stop = () => { if (rec.state !== 'inactive') rec.stop(); };
    const recBar = el('div', { class: 'composer recording' },
      el('button', { class: 'icon-btn', 'aria-label': 'إلغاء', onclick: () => { cancelled = true; stop(); } }, '🗑️'),
      el('span', { class: 'rec-dot' }), timeEl, el('span', { class: 'grow muted small' }, `الحد ${MAX_AUDIO} ثانية`),
      el('button', { class: 'send', 'aria-label': 'إرسال', onclick: stop }, el('span', { class: 'send-ic' }, '➤')));
    bar.replaceWith(recBar);
    const tick = setInterval(() => {
      const s = (Date.now() - start) / 1000;
      timeEl.textContent = fmtDur(s);
      if (s >= MAX_AUDIO) stop();
    }, 200);
    addCleanup(() => { cancelled = true; stop(); });
    rec.onstop = async () => {
      clearInterval(tick);
      stream.getTracks().forEach((t) => t.stop());
      if (recBar.isConnected) recBar.replaceWith(bar);
      const dur = Math.round((Date.now() - start) / 1000);
      if (cancelled || dur < 1 || !chunks.length) return;
      await uploadAndSend('audio', new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }), { duration: dur });
    };
    rec.start(250);
  }

  // ---------- تصوير فيديو ----------
  async function recordVideo() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      return pickFile('video/*', (f) => guard(() => sendVideoFile(f)));
    }
    let facing = 'user'; let stream; let rec; let chunks = []; let blob = null; let start = 0; let tick;
    const video = el('video', { class: 'vr-video', autoplay: true, playsinline: true, muted: true });
    video.muted = true;
    const prog = el('div', { class: 'vr-prog' }, el('i'));
    const timeEl = el('span', { class: 'vr-time' }, `0:00 / 0:${MAX_VIDEO}`);
    const recBtn = el('button', { class: 'rec-btn', 'aria-label': 'تسجيل' });
    const flipBtn = el('button', { class: 'icon-btn light', 'aria-label': 'تبديل الكاميرا' }, '🔄');
    const sendBtn = el('button', { class: 'btn primary', style: { display: 'none' } }, 'إرسال ➤');
    const retakeBtn = el('button', { class: 'btn soft', style: { display: 'none' } }, 'إعادة');
    const closeAll = () => { clearInterval(tick); if (rec?.state === 'recording') rec.stop(); stream?.getTracks().forEach((t) => t.stop()); wrap.remove(); };
    const wrap = el('div', { class: 'viewer' },
      el('button', { class: 'viewer-x', 'aria-label': 'إغلاق', onclick: closeAll }, '✕'),
      video, prog,
      el('div', { class: 'vr-controls' }, flipBtn, recBtn, timeEl),
      el('div', { class: 'vr-after' }, retakeBtn, sendBtn));
    document.body.append(wrap);
    addCleanup(closeAll);

    const startCam = async () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 1280 } }, audio: true,
      });
      video.srcObject = stream; video.controls = false; video.muted = true; video.removeAttribute('src');
      video.classList.toggle('mirror', facing === 'user');
      await video.play().catch(() => {});
    };
    try { await startCam(); } catch { closeAll(); return toast('اسمح للتطبيق يستخدم الكاميرا 📷', 'err'); }

    flipBtn.onclick = () => { if (rec?.state === 'recording') return; facing = facing === 'user' ? 'environment' : 'user'; startCam().catch(() => toast('ما قدرنا نبدّل الكاميرا', 'err')); };
    recBtn.onclick = () => {
      if (rec?.state === 'recording') { rec.stop(); return; }
      const mime = pickMime(['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm']);
      rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 1_200_000, audioBitsPerSecond: 64000 });
      chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        clearInterval(tick);
        recBtn.classList.remove('on');
        blob = new Blob(chunks, { type: (rec.mimeType || mime || 'video/webm') });
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null; video.src = URL.createObjectURL(blob); video.muted = false; video.controls = true;
        video.classList.remove('mirror');
        video.play().catch(() => {});
        recBtn.style.display = 'none'; flipBtn.style.display = 'none';
        sendBtn.style.display = ''; retakeBtn.style.display = '';
      };
      start = Date.now();
      rec.start(500);
      recBtn.classList.add('on');
      tick = setInterval(() => {
        const s = (Date.now() - start) / 1000;
        prog.firstChild.style.width = Math.min(100, (s / MAX_VIDEO) * 100) + '%';
        timeEl.textContent = `${fmtDur(s)} / 0:${MAX_VIDEO}`;
        if (s >= MAX_VIDEO) rec.stop();
      }, 200);
    };
    retakeBtn.onclick = async () => {
      blob = null; sendBtn.style.display = 'none'; retakeBtn.style.display = 'none';
      recBtn.style.display = ''; flipBtn.style.display = '';
      prog.firstChild.style.width = '0'; timeEl.textContent = `0:00 / 0:${MAX_VIDEO}`;
      await startCam().catch(() => {});
    };
    sendBtn.onclick = () => {
      if (!blob) return;
      const dur = Math.round((Date.now() - start) / 1000);
      const b = blob; closeAll();
      uploadAndSend('video', b, { duration: Math.min(dur, MAX_VIDEO) });
    };
  }

  // ---------- الملصقات ----------
  function stickerSheet() {
    const tabs = [...STICKER_PACKS.map((p) => ({ id: p.id, icon: p.icon })), { id: 'phrases', icon: '💬' }, { id: 'family', icon: '⭐' }];
    const grid = el('div', { class: 'stk-grid' });
    const tabBar = el('div', { class: 'stk-tabs' });
    let current = 'faces';
    const close = sheet('الملصقات', el('div', null, tabBar, grid));
    const pick = (meta) => { close(); sendSticker(meta); };
    const show = async (id) => {
      current = id;
      tabBar.replaceChildren(...tabs.map((t) => el('button', { class: 'stk-tab' + (t.id === current ? ' on' : ''), onclick: () => show(t.id) }, t.icon)));
      grid.className = 'stk-grid' + (id === 'phrases' ? ' phrases' : '');
      const pack = STICKER_PACKS.find((p) => p.id === id);
      if (pack) {
        grid.replaceChildren(...pack.items.map((e) => el('button', { class: 'stk-btn', onclick: () => pick({ t: 'emoji', v: e }) }, renderSticker({ t: 'emoji', v: e }))));
      } else if (id === 'phrases') {
        grid.replaceChildren(...PHRASES.map((p) => el('button', { class: 'stk-btn', onclick: () => pick({ t: 'phrase', id: p.id }) }, renderSticker({ t: 'phrase', id: p.id }))));
      } else {
        grid.replaceChildren(spinner());
        const { data, error: e } = await sb.from('stickers').select('id, path').order('created_at', { ascending: false }).limit(60);
        if (current !== 'family') return;
        const items = (data || []).map((s) => {
          const url = stickerUrl(s.path);
          return el('button', { class: 'stk-btn', onclick: () => pick({ t: 'custom', url }) }, el('img', { class: 'stk-img', src: url, alt: 'ملصق', loading: 'lazy' }));
        });
        grid.replaceChildren(
          el('button', { class: 'stk-btn add', onclick: () => pickFile('image/*', (f) => guard(async () => {
            const blob = await makeSticker(f);
            const ext = blob.type === 'image/webp' ? 'webp' : 'png';
            const path = `${S.me.family_id}/${uuid()}.${ext}`;
            const { error: upErr } = await sb.storage.from('stickers').upload(path, blob, { contentType: blob.type });
            if (upErr) throw upErr;
            const { error: insErr } = await sb.from('stickers').insert({ family_id: S.me.family_id, path, created_by: S.me.id });
            if (insErr) throw insErr;
            toast('تمت إضافة الملصق ⭐', 'ok');
            show('family');
          })) }, el('span', null, '＋'), el('small', null, 'ملصق من صورة')),
          ...items);
        if (e) toast(niceError(e), 'err');
      }
    };
    show('faces');
  }

  composerHost.replaceChildren(buildComposer());
  renderAll();
}

// =============================================================
//  أدوات الوسائط
// =============================================================
function viewer(kind, url, once, onClose) {
  let media;
  if (kind === 'image') media = el('img', { class: 'viewer-media', src: url, alt: '', draggable: 'false' });
  else if (kind === 'video') media = el('video', { class: 'viewer-media', src: url, autoplay: true, playsinline: true, controls: true, controlslist: 'nodownload noplaybackrate', disablepictureinpicture: true });
  else media = el('div', { class: 'audio-view' }, el('div', { class: 'audio-big' }, '🎤'), el('audio', { src: url, autoplay: true, controls: true, controlslist: 'nodownload' }));
  const close = () => { wrap.querySelectorAll('video, audio').forEach((m) => m.pause()); wrap.remove(); onClose?.(); };
  const wrap = el('div', { class: 'viewer', oncontextmenu: (e) => e.preventDefault() },
    el('button', { class: 'viewer-x', 'aria-label': 'إغلاق', onclick: close }, '✕'),
    media,
    once ? el('div', { class: 'viewer-note' }, '1️⃣ تنشاف مرة وحدة — بعد ما تقفل ما ترجع') : el('div', { class: 'viewer-note' }, '👁 عرض المراقبة'));
  document.body.append(wrap);
  addCleanup(() => wrap.remove());
}

function mediaDuration(file) {
  return new Promise((res) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    const u = URL.createObjectURL(file);
    v.onloadedmetadata = () => { res(Number.isFinite(v.duration) ? v.duration : 0); URL.revokeObjectURL(u); };
    v.onerror = () => { res(0); URL.revokeObjectURL(u); };
    v.src = u;
  });
}

async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fallback */ }
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('ما قدرنا نفتح الصورة'));
    img.src = URL.createObjectURL(file);
  });
}

async function compressImage(file, max = 1280, q = 0.75) {
  const src = await loadBitmap(file);
  const w = src.width || src.naturalWidth; const h = src.height || src.naturalHeight;
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('ما قدرنا نجهز الصورة'))), 'image/jpeg', q));
}

async function makeSticker(file, size = 320) {
  const src = await loadBitmap(file);
  const w = src.width || src.naturalWidth; const h = src.height || src.naturalHeight;
  const side = Math.min(w, h);
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  c.getContext('2d').drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  const webp = await new Promise((r) => c.toBlob(r, 'image/webp', 0.85));
  if (webp && webp.type === 'image/webp') return webp;
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

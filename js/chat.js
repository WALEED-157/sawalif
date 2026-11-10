import {
  sb, S, bus, rpc, el, icon, toast, guard, sheet, ask, go, back, av, empty, spinner, copy, fmtClock, fmtDay, fmtDur,
  renderSticker, STICKER_PACKS, PHRASES, stickerUrl, addCleanup, niceError, uuid, debounce, navbar, settingRow,
  pushOverlay, hueOf,
} from './lib.js';
import { GAMES, startGame } from './games.js';

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/mp4': 'm4a', 'audio/webm': 'webm',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};
const MEDIA = { image: ['image', 'صورة'], audio: ['mic', 'رسالة صوتية'], video: ['video', 'فيديو'] };
const MAX_AUDIO = 60;
const MAX_VIDEO = 30;

const pickMime = (list) => (window.MediaRecorder ? list.find((t) => MediaRecorder.isTypeSupported?.(t)) : undefined);

// مشغّل صوت واحد فقط في نفس الوقت
let activeAudio = null;
function stopActiveAudio() { if (activeAudio) { activeAudio.stop(); activeAudio = null; } }

export async function renderChat(app, convId) {
  S.currentConv = convId;
  addCleanup(() => { S.currentConv = null; stopActiveAudio(); });

  // نجيب الرسائل مع معلومات المحادثة بنفس الوقت (بدل وحدة ورا الثانية) عشان تنفتح أسرع
  const msgsReq = Promise.resolve(sb.from('messages').select('*')
    .eq('conversation_id', convId).order('created_at', { ascending: false }).limit(100));
  const [info, me] = await Promise.all([rpc('conversation_info', { p_conv: convId }), rpc('my_profile')]);
  if (me) S.me = me;
  const members = new Map(info.members.map((m) => [m.id, m]));
  const isDirect = info.kind === 'direct';
  const watching = info.monitor && !info.is_member;
  const other = isDirect ? info.members.find((m) => m.id !== S.me.id) : null;

  let title; let avatar; let subtitle;
  if (isDirect && !watching) {
    title = other?.name || 'محادثة'; avatar = av(other?.avatar, 'sm', other?.id);
    subtitle = other && other.family_id !== S.me.family_id ? other.family : (other?.role === 'parent' ? 'ولي أمر' : 'من العائلة');
  } else if (isDirect) {
    title = info.members.map((m) => m.name).join(' و ');
    avatar = el('div', { class: 'pair-avs' }, info.members.slice(0, 2).map((m) => av(m.avatar, 'sm', m.id)));
    subtitle = 'وضع المراقبة';
  } else {
    title = info.title; avatar = av(info.emoji, 'sm', info.id);
    subtitle = (watching ? 'وضع المراقبة · ' : '') + info.members.map((m) => m.name).join('، ');
  }

  // ---------- الهيكل ----------
  const scroller = el('div', { class: 'msgs', role: 'log', 'aria-live': 'polite' });
  const header = navbar({
    title, subtitle, avatar,
    onBack: () => back('/'),
    onTitle: () => membersSheet(),
    actions: info.is_member ? [
      el('button', { class: 'icon-btn', 'aria-label': 'تنبيه قوي', title: 'تنبيه قوي', onclick: () => sendBuzz() }, icon('bellRing')),
      el('button', { class: 'icon-btn', 'aria-label': 'تحدّي بلعبة', onclick: () => gameSheet() }, icon('game')),
    ] : [],
  });
  const composerHost = el('div', { class: 'composer-host' });
  app.replaceChildren(el('div', { class: 'chat' + (watching ? ' watching' : '') }, header, scroller, composerHost));

  // ---------- الرسائل ----------
  const msgs = [];
  const nodes = new Map();
  const views = new Map(); // messageId -> Set(profileId)
  const myViews = new Map(); // messageId -> عدد مرات مشاهدتي

  scroller.append(spinner());
  const { data: rows, error } = await msgsReq;
  if (error) throw error;
  rows.reverse().forEach((m) => msgs.push(m));
  const onceIds = msgs.filter((m) => m.view_once).map((m) => m.id);
  if (onceIds.length) {
    const { data: v } = await sb.from('message_views').select('message_id, profile_id, views').in('message_id', onceIds);
    (v || []).forEach((x) => {
      if (!views.has(x.message_id)) views.set(x.message_id, new Set());
      views.get(x.message_id).add(x.profile_id);
      if (x.profile_id === S.me.id) myViews.set(x.message_id, x.views || 1);
    });
  }

  let lastDay = '';
  let lastSender = null;
  const renderAll = () => {
    scroller.replaceChildren();
    nodes.clear(); lastDay = ''; lastSender = null;
    if (!msgs.length) scroller.append(el('div', { class: 'chat-empty' }, el('div', { class: 'empty-art' }, '👋'), el('b', null, 'ابدأ السالفة'), el('small', null, 'أرسل رسالة أو ملصق')));
    msgs.forEach((m) => appendNode(m));
    scrollBottom(true);
  };
  const appendNode = (m) => {
    const day = fmtDay(m.created_at);
    if (day !== lastDay) { scroller.append(el('div', { class: 'day' }, el('span', null, day))); lastDay = day; lastSender = null; }
    const grouped = lastSender === m.sender_id && m.kind !== 'system';
    const n = renderMsg(m, grouped);
    lastSender = m.kind === 'system' ? null : m.sender_id;
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
    if (old) { const n = renderMsg(m, old.classList.contains('grouped')); old.replaceWith(n); nodes.set(m.id, n); }
  };

  const markRead = debounce(() => rpc('mark_read', { p_conv: convId }).then(() => bus.emit('refresh-chats')).catch(() => {}), 700);
  if (info.is_member) markRead();

  addCleanup(bus.on('message', (m) => {
    if (m.conversation_id !== convId) return;
    if (m.kind === 'system') refreshInfo();
    addMsg(m);
  }));
  addCleanup(bus.on('message_update', (m) => { if (m.conversation_id === convId) replaceMsg(m); }));
  addCleanup(bus.on('view', (v) => {
    if (v.profile_id === S.me.id) return; // مشاهدتي محدثة محلياً
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
  function renderMsg(m, grouped) {
    if (m.kind === 'system') return el('div', { class: 'sys' }, el('span', null, m.body || ''));
    if (m.kind === 'buzz') {
      const who = m.sender_id === S.me.id ? 'نبّهت' : `${members.get(m.sender_id)?.name || 'أحد'} نبّه`;
      return el('div', { class: 'sys buzz-msg' }, el('span', null, icon('bellRing'), `${who} · ${fmtClock(m.created_at)}`));
    }
    const sender = members.get(m.sender_id);
    // في وضع المراقبة: رسائل طفلي على اليسار بلون مختلف
    const myKid = watching && sender?.role === 'child' && sender?.family_id === S.me.family_id;
    const mine = m.sender_id === S.me.id || myKid;
    const showName = (!mine || myKid) && (!isDirect || watching) && !grouped;
    const isSticker = (m.kind === 'sticker' || m.kind === 'game') && !m.removed_by;
    const bubble = el('div', {
      class: 'bubble' + (isSticker ? ' sticker' : '') + (m.kind === 'audio' && !m.removed_by ? ' voice' : '') + (m.flagged && info.monitor && !m.removed_by ? ' flagged' : ''),
    },
    showName ? el('div', { class: 'who', style: { '--h': String(hueOf(m.sender_id)) } }, sender ? sender.name : 'عضو سابق') : null,
    msgContent(m, m.sender_id === S.me.id),
    el('div', { class: 'meta' },
      m.flagged && info.monitor && !m.removed_by ? el('span', { class: 'flag' }, icon('alert'), m.flag_reason || '') : null,
      el('time', null, fmtClock(m.created_at)),
      m.sender_id === S.me.id && !isSticker ? icon('checks', 'tick') : null));
    const canAct = !m.removed_by && (mine || info.monitor);
    if (canAct) {
      bubble.classList.add('tappable');
      bubble.addEventListener('click', (e) => { if (e.target.closest('button, video, audio, a, input')) return; msgActions(m); });
    }
    const showAv = !mine && !isDirect;
    return el('div', { class: 'msg ' + (mine ? 'mine' : 'theirs') + (myKid ? ' kid' : '') + (grouped ? ' grouped' : '') },
      showAv ? (grouped ? el('span', { class: 'av-space' }) : av(sender?.avatar || '👤', 'xs', m.sender_id)) : null, bubble);
  }

  function msgContent(m, mine) {
    if (m.removed_by) return el('span', { class: 'removed' }, icon('trash'), 'تم حذف الرسالة');
    switch (m.kind) {
      case 'text': return el('div', { class: 'text', dir: 'auto' }, m.body || '');
      case 'sticker': return renderSticker(m.meta);
      case 'game': return gameCard(m, mine);
      case 'audio': return voiceNote(m, mine);
      case 'image': case 'video': return mediaContent(m, mine);
      default: return el('span', null, '');
    }
  }

  // ----- رسالة صوتية: تشتغل داخل المحادثة مثل الواتساب -----
  function voiceNote(m, mine) {
    const dur = m.meta?.duration || 0;
    const seen = views.get(m.id) || new Set();
    const canReplay = info.monitor || mine;
    const expired = m.media_expired || !m.media_path;
    const played = !canReplay && seen.has(S.me.id);
    const bars = Array.from({ length: 30 }, (_, i) => {
      const x = Math.sin((hueOf(m.id) + i * 37) * 0.7) * 0.5 + 0.5;
      return 0.25 + x * 0.75;
    });
    const wave = el('div', { class: 'wave' }, bars.map((h) => el('i', { style: { height: `${Math.round(h * 100)}%` } })));
    const timeEl = el('span', { class: 'v-time' }, fmtDur(dur));
    const btn = el('button', { class: 'v-play', 'aria-label': 'تشغيل' }, icon('play'));
    const onceBadge = !canReplay && !played && !expired ? el('span', { class: 'once-badge', title: 'مرة وحدة' }, '1') : null;
    const sideAv = el('span', { class: 'v-side' }, av(members.get(m.sender_id)?.avatar || '🎤', 'sm', m.sender_id), el('span', { class: 'v-mic' }, icon('mic')));
    const status = mine && !info.monitor
      ? el('small', { class: 'v-status' }, isDirect ? ([...seen].some((id) => id !== m.sender_id) ? 'انسمعت' : 'ما انسمعت للحين') : `سمعها ${[...seen].filter((id) => id !== m.sender_id).length}`)
      : null;

    const root = el('div', { class: 'voice-note' + (played || expired ? ' done' : '') },
      btn, el('div', { class: 'v-body' }, wave, el('div', { class: 'v-foot' }, timeEl, onceBadge, status)), sideAv);

    if (expired) { btn.disabled = true; timeEl.textContent = 'انتهت مدته'; return root; }
    if (played) { btn.disabled = true; btn.replaceChildren(icon('check')); timeEl.textContent = 'تم التشغيل'; return root; }

    let audio = null; let playing = false; let consumed = false;
    const setProgress = (p) => {
      const n = Math.round(p * bars.length);
      wave.querySelectorAll('i').forEach((b, i) => b.classList.toggle('on', i < n));
    };
    const ctrl = {
      stop() { if (audio) { audio.pause(); } playing = false; btn.replaceChildren(icon('play')); },
    };
    btn.onclick = () => guard(async () => {
      if (playing) { ctrl.stop(); activeAudio = null; return; }
      stopActiveAudio();
      if (!audio) {
        if (!canReplay && !(await ask('رسالة صوتية مرة وحدة', { ok: 'تشغيل', detail: 'تقدر تسمعها مرة وحدة بس' }))) return;
        btn.disabled = true;
        const path = await rpc('open_view_once', { p_msg: m.id });
        if (!canReplay) { consumed = true; if (!views.has(m.id)) views.set(m.id, new Set()); views.get(m.id).add(S.me.id); }
        const { data, error: e } = await sb.storage.from('media').createSignedUrl(path, 300);
        btn.disabled = false;
        if (e) throw e;
        audio = new Audio(data.signedUrl);
        audio.preload = 'auto';
        audio.ontimeupdate = () => {
          const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : dur || 1;
          setProgress(audio.currentTime / total);
          timeEl.textContent = fmtDur(audio.currentTime);
        };
        audio.onended = () => {
          playing = false; activeAudio = null; setProgress(0);
          if (consumed) { replaceMsg(m); return; }
          btn.replaceChildren(icon('play')); timeEl.textContent = fmtDur(dur);
        };
      }
      await audio.play();
      playing = true; activeAudio = ctrl;
      btn.replaceChildren(icon('pause'));
    });
    // للتشغيل المتكرر: الضغط على الموجة يقدّم الصوت
    wave.onclick = (e) => {
      if (!audio || !Number.isFinite(audio.duration)) return;
      const r = wave.getBoundingClientRect();
      const ratio = (r.right - e.clientX) / r.width; // RTL: البداية من اليمين
      audio.currentTime = Math.max(0, Math.min(1, ratio)) * audio.duration;
    };
    return root;
  }

  // ----- صورة/فيديو مرة وحدة -----
  function mediaContent(m, mine) {
    const [ic, label] = MEDIA[m.kind];
    const dur = m.meta?.duration ? fmtDur(m.meta.duration) : '';
    const seen = views.get(m.id) || new Set();
    const seenByOthers = [...seen].filter((id) => id !== m.sender_id);
    const chip = (cls, sub, onclick, badge) => el(onclick ? 'button' : 'div', { class: 'media-chip ' + cls, onclick: onclick || null },
      el('span', { class: 'mc-ic' }, icon(ic), badge ? el('span', { class: 'once-badge' }, String(badge)) : null),
      el('span', { class: 'mc-txt' }, el('b', null, label + (dur ? ` · ${dur}` : '')), el('small', null, sub)));

    if (m.media_expired || !m.media_path) return chip('off', 'انتهت مدته');
    if (info.monitor) {
      return chip('monitor', isDirect ? (seenByOthers.length ? 'انشافت · اضغط للعرض' : 'ما انفتحت · اضغط للعرض') : 'اضغط للعرض', () => openMedia(m, false));
    }
    const maxViews = m.kind === 'video' ? 2 : 1;
    const used = myViews.get(m.id) || (seen.has(S.me.id) ? 1 : 0);
    const limitText = maxViews === 2 ? 'تنشاف مرتين' : 'مرة وحدة';
    if (mine) return chip('sent', isDirect ? (seenByOthers.length ? 'انشافت' : `${limitText} · ما انفتحت`) : `شافها ${seenByOthers.length}`);
    if (used >= maxViews) return chip('off', 'تمت المشاهدة');
    const left = maxViews - used;
    return chip('fresh', `اضغط للمشاهدة · ${left === maxViews ? limitText : 'باقي مرة وحدة'}`, () => openMedia(m, true, left), left);
  }

  function openMedia(m, once, left = 1) {
    guard(async () => {
      if (once) {
        const ok = await ask(left > 1 ? 'تقدر تشوفه مرتين' : 'آخر مرة تشوفها 👀', {
          ok: 'افتح الحين',
          detail: left > 1 ? 'بعد المرة الثانية يختفي نهائياً' : 'بعد ما تقفلها تختفي نهائياً',
        });
        if (!ok) return;
      }
      const path = await rpc('open_view_once', { p_msg: m.id });
      if (once) {
        if (!views.has(m.id)) views.set(m.id, new Set());
        views.get(m.id).add(S.me.id);
        myViews.set(m.id, (myViews.get(m.id) || 0) + 1);
      }
      const { data, error: e } = await sb.storage.from('media').createSignedUrl(path, 180);
      if (e) throw e;
      viewer(m.kind, data.signedUrl, once ? left - 1 : null, () => replaceMsg(m));
    });
  }

  async function sendBuzz() {
    if (S.me.muted || S.me.in_quiet) return toast('ما تقدر تنبّه الحين', 'err');
    if (!(await ask('ترسل تنبيه قوي؟', { ok: 'نبّه', detail: 'جوال الطرف الثاني بيرن ويهتز لين يشوفه' }))) return;
    guard(async () => { const row = await sendRpc('buzz'); addMsg(row); toast('تم التنبيه 🔔', 'ok'); });
  }

  function gameCard(m, mine) {
    const g = GAMES[m.meta?.game];
    if (!g) return el('span', null, '🎮');
    const sender = members.get(m.sender_id);
    const opp = members.get(m.meta?.opponent);
    const line = mine ? `تحدّيت ${opp?.name || ''}` : (m.meta?.opponent === S.me.id ? `${sender?.name || ''} يتحداك!` : `${sender?.name || ''} تحدّى ${opp?.name || ''}`);
    return el('div', { class: 'game-card', style: { '--g1': g.colors[0], '--g2': g.colors[1] } },
      el('span', { class: 'gc-ic' }, g.ic),
      el('div', { class: 'row-main' }, el('b', null, g.name), el('small', null, line)),
      el('button', { class: 'btn glass sm', onclick: () => go('/game/' + m.meta.game_id) }, info.is_member ? 'العب' : 'شوف'));
  }

  function msgActions(m) {
    const close = sheet('خيارات الرسالة', el('div', { class: 'list flat' },
      m.kind === 'text' ? settingRow({ ic: 'copy', tone: 'blue', title: 'نسخ النص', onclick: () => { copy(m.body); close(); } }) : null,
      info.monitor && m.flagged && !m.flag_reviewed ? settingRow({ ic: 'check', tone: 'green', title: 'تمت مراجعة التنبيه', onclick: () => guard(async () => { await rpc('review_alert', { p_msg: m.id }); close(); toast('تم'); }) }) : null,
      settingRow({ ic: 'trash', tone: 'red', title: 'حذف للجميع', onclick: () => guard(async () => {
        close();
        if (!(await ask('حذف الرسالة للجميع؟', { ok: 'حذف', danger: true }))) return;
        if (m.media_path) await sb.storage.from('media').remove([m.media_path]).catch(() => {});
        await rpc('remove_message', { p_msg: m.id });
        replaceMsg({ ...m, removed_by: S.me.id, body: null, media_path: null, meta: {} });
      }) })));
  }

  // ---------- الأعضاء ----------
  function membersSheet() {
    const isFamilyGroup = info.id === S.me.family_group;
    const close = sheet(isDirect ? 'معلومات المحادثة' : info.title, el('div', { class: 'stack' },
      !isDirect ? el('div', { class: 'group-head' }, av(info.emoji, 'xl', info.id), el('b', null, info.title), el('small', { class: 'muted' }, `${info.members.length} أعضاء`)) : null,
      el('div', { class: 'list flat' }, info.members.map((p) => el('div', { class: 'row' },
        av(p.avatar, 'md', p.id),
        el('div', { class: 'row-main' }, el('b', null, p.name + (p.id === S.me.id ? ' (أنت)' : '')),
          el('small', { class: 'muted' }, (p.role === 'parent' ? 'ولي أمر · ' : '') + p.family)),
        !isDirect && S.me.role === 'parent' && p.role === 'child' && p.family_id === S.me.family_id && p.id !== S.me.id && !isFamilyGroup
          ? el('button', { class: 'btn danger-soft sm', onclick: () => guard(async () => {
            if (!(await ask(`إخراج ${p.name} من القروب؟`, { ok: 'إخراج', danger: true }))) return;
            await rpc('leave_group', { p_conv: convId, p_profile: p.id }); close(); await refreshInfo();
          }) }, 'إخراج') : null))),
      !isDirect && info.is_member ? el('div', { class: 'list flat' },
        settingRow({ ic: 'userPlus', tone: 'green', title: 'إضافة عضو', onclick: () => { close(); guard(addMemberSheet); } }),
        !isFamilyGroup ? settingRow({ ic: 'leave', tone: 'red', title: 'الخروج من القروب', onclick: () => guard(async () => {
          if (!(await ask('تطلع من القروب؟', { ok: 'خروج', danger: true }))) return;
          await rpc('leave_group', { p_conv: convId, p_profile: null }); close(); back('/');
        }) }) : null) : null));
  }

  async function addMemberSheet() {
    const contacts = (await rpc('my_contacts')).filter((c) => !info.members.some((m) => m.id === c.id));
    const close = sheet('إضافة عضو', contacts.length
      ? el('div', { class: 'list flat' }, contacts.map((p) => el('div', { class: 'row' }, av(p.avatar, 'md', p.id),
        el('div', { class: 'row-main' }, el('b', null, p.name), el('small', { class: 'muted' }, p.same_family ? 'من العائلة' : p.family)),
        el('button', { class: 'btn primary sm', onclick: (e) => guard(async () => {
          await rpc('add_group_member', { p_conv: convId, p_profile: p.id }); close(); await refreshInfo(); toast('تمت الإضافة', 'ok');
        }, e.currentTarget) }, 'إضافة'))))
      : empty('كل أصدقائك موجودين', '', '👍'));
  }

  // ---------- الألعاب ----------
  function gameSheet() {
    const opponents = info.members.filter((m) => m.id !== S.me.id);
    sheet('تحدّي بلعبة', (closeFn) => {
      let chosen = isDirect ? opponents[0]?.id : null;
      const box = el('div', { class: 'stack' });
      const draw = () => {
        box.replaceChildren(...[
          !isDirect ? el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'مع مين؟'), el('div', { class: 'chip-row' }, opponents.map((p) =>
            el('button', { class: 'chip' + (chosen === p.id ? ' on' : ''), onclick: () => { chosen = p.id; draw(); } }, `${p.avatar} ${p.name}`)))) : null,
          el('div', { class: 'game-grid compact' }, Object.entries(GAMES).map(([kind, g]) => el('button', {
            class: 'game-tile', style: { '--g1': g.colors[0], '--g2': g.colors[1] },
            onclick: () => guard(async () => {
              if (!chosen) throw new Error('اختر خصمك أولاً');
              closeFn(); await startGame(convId, kind, chosen);
            }),
          }, el('span', { class: 'gt-ic' }, g.icon), el('div', null, el('b', null, g.name), el('small', null, g.desc)))))].filter(Boolean));
      };
      draw();
      return box;
    });
  }

  // ---------- الكتابة والإرسال ----------
  const sendRpc = (kind, body, path, meta) => rpc('send_message', {
    p_conv: convId, p_kind: kind, p_body: body ?? null, p_media_path: path ?? null, p_meta: meta ?? {},
  });

  const lockedBar = (ic, text) => el('div', { class: 'locked-bar' }, icon(ic), text);

  function buildComposer() {
    if (watching) return lockedBar('eye', 'وضع المراقبة — اضغط على أي رسالة عشان تحذفها');
    if (!info.is_member) return lockedBar('lock', 'لست عضواً في هذي المحادثة');
    if (S.me.muted) return lockedBar('lock', 'الإرسال موقوف مؤقتاً من الأهل');
    if (S.me.in_quiet) return lockedBar('moon', 'وقت الراحة — تقدر ترسل بعدين');

    const ta = el('textarea', { class: 'ta', rows: '1', placeholder: 'اكتب رسالة', dir: 'auto', maxlength: '2000', 'aria-label': 'الرسالة' });
    const sendBtn = el('button', { class: 'send', 'aria-label': 'إرسال' }, icon('send'));
    const micBtn = el('button', { class: 'send mic', 'aria-label': 'تسجيل صوتي' }, icon('mic'));
    const stickerBtn = el('button', { class: 'icon-btn in', 'aria-label': 'ملصقات', onclick: () => stickerSheet() }, icon('smile'));
    const attachBtn = el('button', { class: 'icon-btn in', 'aria-label': 'إرفاق', onclick: () => attachSheet() }, icon('clip'));
    const cameraBtn = el('button', { class: 'icon-btn in', 'aria-label': 'كاميرا', onclick: () => pickFile('image/*', (f) => guard(async () => uploadAndSend('image', await compressImage(f))), true) }, icon('camera'));
    const sync = () => {
      const has = ta.value.trim().length > 0;
      sendBtn.hidden = !has; micBtn.hidden = has; cameraBtn.hidden = has;
      if (!ta.isConnected) return;
      ta.style.height = 'auto';
      ta.style.height = Math.min(Math.max(ta.scrollHeight, 44), 130) + 'px';
    };
    ta.addEventListener('input', sync);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); sendText(); }
    });
    const sendText = () => {
      const body = ta.value.trim();
      if (!body) return;
      ta.value = ''; sync(); ta.focus();
      const temp = pendingBubble(body);
      sendRpc('text', body).then((row) => { temp.remove(); addMsg(row); })
        .catch((e) => { temp.remove(); ta.value = body; sync(); toast(niceError(e), 'err'); });
    };
    sendBtn.onclick = sendText;
    micBtn.onclick = () => recordAudio(bar);
    const bar = el('div', { class: 'composer' },
      el('div', { class: 'field-pill' }, stickerBtn, ta, attachBtn, cameraBtn),
      micBtn, sendBtn);
    sync();
    return bar;
  }

  function pendingBubble(text) {
    const n = el('div', { class: 'msg mine pending' }, el('div', { class: 'bubble' }, el('div', { class: 'text' }, text),
      el('div', { class: 'meta' }, el('span', { class: 'mini-spin' }))));
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
    const temp = pendingBubble(`جاري إرسال ${MEDIA[kind][1]}...`);
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
  function pickFile(accept, onFile, capture) {
    const inp = el('input', { type: 'file', accept, capture: capture ? 'environment' : null, style: { display: 'none' } });
    inp.onchange = () => { const f = inp.files?.[0]; inp.remove(); if (f) onFile(f); };
    document.body.append(inp);
    inp.click();
  }

  function attachSheet() {
    const item = (ic, tone, label, fn) => el('button', { class: 'attach', onclick: fn }, el('span', { class: 'att-ic ' + tone }, icon(ic)), label);
    const close = sheet('إرسال', el('div', { class: 'attach-grid' },
      item('image', 'violet', 'صورة', () => { close(); pickFile('image/*', (f) => guard(async () => uploadAndSend('image', await compressImage(f)))); }),
      item('camera', 'pink', 'كاميرا', () => { close(); pickFile('image/*', (f) => guard(async () => uploadAndSend('image', await compressImage(f))), true); }),
      item('video', 'red', `تصوير فيديو`, () => { close(); recordVideo(); }),
      item('play', 'blue', 'فيديو من الجوال', () => { close(); pickFile('video/*', (f) => guard(() => sendVideoFile(f))); }),
      item('sticker', 'amber', 'ملصقات', () => { close(); stickerSheet(); }),
      item('game', 'green', 'تحدّي لعبة', () => { close(); gameSheet(); })),
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
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('اسمح للتطبيق يستخدم المايك', 'err'); }
    stopActiveAudio();
    const mime = pickMime(['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']);
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
    const chunks = [];
    let cancelled = false;
    const start = Date.now();
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const timeEl = el('span', { class: 'rec-time' }, '0:00');
    const stop = () => { if (rec.state !== 'inactive') rec.stop(); };
    const recBar = el('div', { class: 'composer recording' },
      el('button', { class: 'icon-btn danger', 'aria-label': 'إلغاء', onclick: () => { cancelled = true; stop(); } }, icon('trash')),
      el('div', { class: 'rec-pill' }, el('span', { class: 'rec-dot' }), timeEl, el('span', { class: 'rec-wave' }, Array.from({ length: 18 }, (_, i) => el('i', { style: { animationDelay: `${i * 70}ms` } }))), el('small', null, `الحد ${MAX_AUDIO} ث`)),
      el('button', { class: 'send', 'aria-label': 'إرسال', onclick: stop }, icon('send')));
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
    const flipBtn = el('button', { class: 'icon-btn glass', 'aria-label': 'تبديل الكاميرا' }, icon('flip'));
    const sendBtn = el('button', { class: 'btn primary', hidden: true }, icon('send'), 'إرسال');
    const retakeBtn = el('button', { class: 'btn glass', hidden: true }, 'إعادة');
    let unreg = () => {};
    const closeAll = () => { unreg(); clearInterval(tick); if (rec?.state === 'recording') rec.stop(); stream?.getTracks().forEach((t) => t.stop()); wrap.remove(); };
    const wrap = el('div', { class: 'viewer' },
      el('button', { class: 'viewer-x', 'aria-label': 'إغلاق', onclick: closeAll }, icon('x')),
      video, prog,
      el('div', { class: 'vr-controls' }, flipBtn, recBtn, timeEl),
      el('div', { class: 'vr-after' }, retakeBtn, sendBtn));
    document.body.append(wrap);
    unreg = pushOverlay(closeAll);
    addCleanup(closeAll);

    const startCam = async () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 480 }, height: { ideal: 854 }, frameRate: { ideal: 24 } }, audio: true,
      });
      video.srcObject = stream; video.controls = false; video.muted = true; video.removeAttribute('src');
      video.classList.toggle('mirror', facing === 'user');
      await video.play().catch(() => {});
    };
    try { await startCam(); } catch { closeAll(); return toast('اسمح للتطبيق يستخدم الكاميرا', 'err'); }

    flipBtn.onclick = () => { if (rec?.state === 'recording') return; facing = facing === 'user' ? 'environment' : 'user'; startCam().catch(() => toast('ما قدرنا نبدّل الكاميرا', 'err')); };
    recBtn.onclick = () => {
      if (rec?.state === 'recording') { rec.stop(); return; }
      const mime = pickMime(['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm']);
      rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 600_000, audioBitsPerSecond: 48000 });
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
        recBtn.hidden = true; flipBtn.hidden = true; sendBtn.hidden = false; retakeBtn.hidden = false;
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
      blob = null; sendBtn.hidden = true; retakeBtn.hidden = true; recBtn.hidden = false; flipBtn.hidden = false;
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
    const tabs = [...STICKER_PACKS.map((p) => ({ id: p.id, icon: p.icon, name: p.name })), { id: 'phrases', icon: '💬', name: 'عبارات' }, { id: 'family', icon: '⭐', name: 'العائلة' }];
    const grid = el('div', { class: 'stk-grid' });
    const tabBar = el('div', { class: 'stk-tabs', role: 'tablist' });
    let current = 'faces';
    const close = sheet('الملصقات', el('div', null, tabBar, grid));
    const pick = (meta) => { close(); sendSticker(meta); };
    const show = async (id) => {
      current = id;
      tabBar.replaceChildren(...tabs.map((t) => el('button', { class: 'stk-tab' + (t.id === current ? ' on' : ''), role: 'tab', 'aria-selected': String(t.id === current), 'aria-label': t.name, onclick: () => show(t.id) }, t.icon)));
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
            toast('تمت إضافة الملصق', 'ok');
            show('family');
          })) }, icon('plus'), el('small', null, 'من صورة')),
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
/** once: null = مراقبة، رقم = عدد المرات الباقية بعد هذي المشاهدة */
function viewer(kind, url, once, onClose) {
  let media;
  if (kind === 'image') media = el('img', { class: 'viewer-media', src: url, alt: '', draggable: 'false' });
  else media = el('video', { class: 'viewer-media', src: url, autoplay: true, playsinline: true, controls: true, controlslist: 'nodownload noplaybackrate', disablepictureinpicture: true });
  let unreg = () => {};
  const close = () => { unreg(); wrap.querySelectorAll('video').forEach((m) => m.pause()); wrap.remove(); onClose?.(); };
  const wrap = el('div', { class: 'viewer', oncontextmenu: (e) => e.preventDefault() },
    el('button', { class: 'viewer-x', 'aria-label': 'إغلاق', onclick: close }, icon('x')),
    media,
    el('div', { class: 'viewer-note' }, once === null || once === undefined
      ? [icon('eye'), 'عرض المراقبة']
      : once > 0 ? [el('span', { class: 'once-badge' }, String(once)), 'باقي لك مشاهدة وحدة بعد هذي']
        : [el('span', { class: 'once-badge' }, '0'), 'آخر مشاهدة — بعد ما تقفل يختفي']));
  document.body.append(wrap);
  unreg = pushOverlay(close);
  addCleanup(() => { unreg(); wrap.remove(); });
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

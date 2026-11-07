// =============================================================
//  وضع العرض التجريبي — بيانات وهمية لمعاينة الشاشات على جهاز المطوّر فقط
//  يشتغل بس على localhost مع ?demo=parent أو ?demo=child
//  ما يتصل بأي سيرفر
// =============================================================
export function createDemoClient(role, supabaseUrl) {
  const now = Date.now();
  const ago = (min) => new Date(now - min * 60e3).toISOString();
  const meId = role === 'child' ? 'k1' : 'p1';

  const fams = { A: 'عائلة أحمد', B: 'عائلة سالم' };
  const people = {
    p1: { id: 'p1', name: 'أبو محمد', avatar: '🧔', role: 'parent', fam: 'A', code: '482913' },
    p2: { id: 'p2', name: 'أم محمد', avatar: '🧕', role: 'parent', fam: 'A', code: '573104' },
    k1: { id: 'k1', name: 'محمد', avatar: '🦁', role: 'child', fam: 'A', code: '210587' },
    k2: { id: 'k2', name: 'سارة', avatar: '🦋', role: 'child', fam: 'A', code: '338412' },
    f1: { id: 'f1', name: 'خالد', avatar: '🐯', role: 'child', fam: 'B', code: '904216' },
    f2: { id: 'f2', name: 'أبو خالد', avatar: '👨', role: 'parent', fam: 'B', code: '665120' },
  };
  const me = people[meId];

  const convs = {
    'c-fam': { id: 'c-fam', kind: 'group', title: 'عائلة أحمد', emoji: '🏠', members: ['p1', 'p2', 'k1', 'k2'] },
    'c-dm1': { id: 'c-dm1', kind: 'direct', title: null, emoji: '💬', members: ['p1', 'k1'] },
    'c-dm2': { id: 'c-dm2', kind: 'direct', title: null, emoji: '💬', members: ['k1', 'f1'] },
    'c-grp': { id: 'c-grp', kind: 'group', title: 'أبطال الكورة', emoji: '⚽', members: ['k1', 'k2', 'f1'] },
  };

  let seq = 0;
  const M = (conv, sender, kind, min, extra = {}) => ({
    id: `m${++seq}`, conversation_id: conv, sender_id: sender, kind, body: null, media_path: null, meta: {},
    view_once: ['image', 'audio', 'video'].includes(kind), media_expired: false, flagged: false, flag_reason: null,
    flag_reviewed: false, removed_by: null, created_at: ago(min), ...extra,
  });
  const messages = [
    M('c-fam', 'p1', 'system', 3000, { body: 'تم إنشاء قروب العائلة 🏠' }),
    M('c-fam', 'p2', 'text', 190, { body: 'الغدا جاهز يا عيال 🍗' }),
    M('c-fam', 'k2', 'sticker', 188, { meta: { t: 'phrase', id: 'lunch' } }),
    M('c-fam', 'k1', 'text', 187, { body: 'جايين!' }),
    M('c-fam', 'k1', 'text', 186, { body: 'بس خلصت الواجب أول 📚' }),
    M('c-fam', 'p1', 'sticker', 185, { meta: { t: 'phrase', id: 'kafo' } }),
    M('c-fam', 'p1', 'text', 40, { body: 'لا تنسون بكرة نطلع للبر إن شاء الله' }),
    M('c-fam', 'k2', 'sticker', 38, { meta: { t: 'emoji', v: '🥳' } }),
    M('c-dm1', 'p1', 'text', 300, { body: 'كيف كان يومك في المدرسة؟' }),
    M('c-dm1', 'k1', 'text', 295, { body: 'حلو! أخذت الدرجة الكاملة في الرياضيات 🎉' }),
    M('c-dm1', 'p1', 'sticker', 294, { meta: { t: 'phrase', id: 'mashallah' } }),
    M('c-dm1', 'k1', 'audio', 20, { media_path: 'c-dm1/voice1.m4a', meta: { duration: 6 } }),
    M('c-dm1', 'p1', 'audio', 18, { media_path: 'c-dm1/voice2.m4a', meta: { duration: 4 } }),
    M('c-dm1', 'k1', 'image', 10, { media_path: 'c-dm1/photo1.jpg' }),
    M('c-dm2', 'f1', 'text', 1500, { body: 'هلا محمد 👋' }),
    M('c-dm2', 'k1', 'sticker', 1499, { meta: { t: 'phrase', id: 'hala' } }),
    M('c-dm2', 'f1', 'text', 60, { body: 'تبي نلعب إكس أو؟' }),
    M('c-dm2', 'k1', 'text', 59, { body: 'يلا!' }),
    M('c-dm2', 'k1', 'game', 58, { meta: { game_id: 'g1', game: 'xo', opponent: 'f1' } }),
    M('c-dm2', 'f1', 'text', 30, { body: 'هذا رقمي 0551234567', flagged: true, flag_reason: 'رقم جوال أو رقم طويل' }),
    M('c-dm2', 'f1', 'audio', 12, { media_path: 'c-dm2/voice3.m4a', meta: { duration: 9 } }),
    M('c-dm2', 'f1', 'image', 5, { media_path: 'c-dm2/photo2.jpg' }),
    M('c-grp', 'k1', 'system', 2000, { body: 'تم إنشاء القروب بواسطة محمد 🎉' }),
    M('c-grp', 'f1', 'text', 120, { body: 'مين يجي يلعب كورة العصر؟ ⚽' }),
    M('c-grp', 'k2', 'sticker', 118, { meta: { t: 'emoji', v: '🙋‍♀️' } }),
    M('c-grp', 'k1', 'text', 117, { body: 'أنا أكيد' }),
  ];
  const views = [];
  const reads = {};

  const games = {
    g1: { id: 'g1', conversation_id: 'c-dm2', kind: 'xo', players: ['k1', 'f1'], state: { board: ['X', '', 'O', '', 'X', '', '', 'O', ''] }, turn: 'k1', winner: null, status: 'active', updated_at: ago(25) },
    g2: { id: 'g2', conversation_id: 'c-dm1', kind: 'connect4', players: ['p1', 'k1'], state: { board: Array.from({ length: 42 }, (_, i) => ({ 38: 'R', 37: 'Y', 31: 'R', 39: 'Y', 36: 'R', 30: 'Y' })[i] || '') }, turn: 'p1', winner: null, status: 'active', updated_at: ago(90) },
    g3: { id: 'g3', conversation_id: 'c-dm1', kind: 'rps', players: ['p1', 'k1'], state: { round: 5, moves: {}, score: { k1: 3, p1: 1 }, last: { p1: 'rock', k1: 'paper', winner: 'k1' } }, turn: null, winner: 'k1', status: 'done', updated_at: ago(2000) },
  };

  const requests = [
    { id: 'r1', from: 'f1', to: 'k1', from_ok: true, to_ok: true, status: 'accepted', created_at: ago(3000) },
    { id: 'r2', from: 'f1', to: 'k2', from_ok: true, to_ok: false, status: 'pending', created_at: ago(100) },
  ];
  const words = ['غبي', 'حمار', 'تافه', 'اخرس', 'كذاب'].map((w, i) => ({ id: i + 1, word: w }));
  const kidSettings = { k1: { muted: false, quiet_start: '21:00:00', quiet_end: '06:00:00', paired: true }, k2: { muted: false, quiet_start: null, quiet_end: null, paired: false } };

  const isKidOfMine = (id) => people[id].role === 'child' && people[id].fam === me.fam;
  const isMember = (c) => convs[c].members.includes(meId);
  const canMonitor = (c) => me.role === 'parent' && convs[c].members.some(isKidOfMine);
  const connected = (a, b) => people[a].fam === people[b].fam || requests.some((r) => r.status === 'accepted' && ((r.from === a && r.to === b) || (r.from === b && r.to === a)));

  // صوت تجريبي (نغمة قصيرة) للرسائل الصوتية
  let toneUrl = null;
  function tone() {
    if (toneUrl) return toneUrl;
    const rate = 22050; const secs = 5; const n = rate * secs;
    const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    const notes = [523, 659, 784, 659, 523, 587, 698, 880, 698, 587];
    for (let i = 0; i < n; i++) {
      const t = i / rate; const f = notes[Math.floor(t * 2) % notes.length];
      const env = Math.min(1, (t % 0.5) * 20) * Math.max(0, 1 - (t % 0.5) * 2);
      v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * f * t) * 9000 * env, true);
    }
    toneUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    return toneUrl;
  }

  function convRows(target) {
    return Object.values(convs).filter((c) => c.members.includes(target)).map((c) => {
      const ms = messages.filter((m) => m.conversation_id === c.id);
      const last = ms[ms.length - 1];
      const other = c.kind === 'direct' ? people[c.members.find((x) => x !== target)] : null;
      const lastRead = reads[c.id + target] || (c.id === 'c-dm2' || c.id === 'c-grp' ? ago(70) : ago(0));
      return {
        id: c.id, kind: c.kind, title: c.title, emoji: c.emoji, last_message_at: last?.created_at || ago(5000),
        preview: last?.body, preview_kind: last?.kind,
        unread: ms.filter((m) => m.created_at > lastRead && m.sender_id !== target && m.kind !== 'system').length,
        other_id: other?.id, other_name: other?.name, other_avatar: other?.avatar, member_count: c.members.length,
      };
    }).sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1));
  }

  const reqRow = (r) => {
    const a = people[r.from]; const b = people[r.to];
    return {
      id: r.id, from_id: a.id, from_name: a.name, from_avatar: a.avatar, from_family: fams[a.fam],
      to_id: b.id, to_name: b.name, to_avatar: b.avatar, to_family: fams[b.fam],
      from_ok: r.from_ok, to_ok: r.to_ok, status: r.status, created_at: r.created_at,
      can_approve: r.status === 'pending' && me.role === 'parent' && ((a.fam === me.fam && !r.from_ok) || (b.fam === me.fam && !r.to_ok)),
      involves_me: [a.id, b.id].includes(meId), from_mine: a.fam === me.fam, to_mine: b.fam === me.fam,
    };
  };

  const rpcs = {
    my_profile: () => ({
      id: me.id, name: me.name, avatar: me.avatar, role: me.role, code: me.code, muted: false, quiet_start: null, quiet_end: null,
      in_quiet: false, family_id: 'fam-A', family_name: fams[me.fam], family_group: 'c-fam', invite_code: me.role === 'parent' ? 'K7M2QX9A' : null,
    }),
    my_conversations: ({ p_for } = {}) => convRows(p_for || meId),
    conversation_info: ({ p_conv }) => {
      const c = convs[p_conv];
      return {
        id: c.id, kind: c.kind, title: c.title, emoji: c.emoji, is_member: isMember(c.id), monitor: canMonitor(c.id),
        members: c.members.map((id) => ({ id, name: people[id].name, avatar: people[id].avatar, role: people[id].role, family: fams[people[id].fam], family_id: 'fam-' + people[id].fam })),
      };
    },
    my_contacts: () => Object.values(people).filter((p) => p.id !== meId && (p.fam === me.fam || connected(meId, p.id)))
      .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, role: p.role, family: fams[p.fam], same_family: p.fam === me.fam })),
    my_requests: () => requests.filter((r) => [r.from, r.to].includes(meId) || (me.role === 'parent' && [people[r.from].fam, people[r.to].fam].includes(me.fam))).map(reqRow),
    family_members: () => Object.values(people).filter((p) => p.fam === me.fam).map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar, role: p.role, public_code: p.code,
      muted: kidSettings[p.id]?.muted || false, quiet_start: kidSettings[p.id]?.quiet_start || null, quiet_end: kidSettings[p.id]?.quiet_end || null,
      paired: p.role === 'parent' || !!kidSettings[p.id]?.paired, is_me: p.id === meId,
    })),
    family_alerts: () => (me.role !== 'parent' ? [] : messages.filter((m) => m.flagged && canMonitor(m.conversation_id)).map((m) => ({
      id: m.id, conversation_id: m.conversation_id, conv_title: convs[m.conversation_id].title || convs[m.conversation_id].members.map((x) => people[x].name).join(' و '),
      sender_name: people[m.sender_id].name, sender_avatar: people[m.sender_id].avatar, body: m.body, reason: m.flag_reason, created_at: m.created_at, reviewed: m.flag_reviewed,
    }))),
    my_games: () => Object.values(games).filter((g) => g.players.includes(meId)).map((g) => {
      const o = people[g.players.find((x) => x !== meId)];
      return { id: g.id, kind: g.kind, status: g.status, turn: g.turn, winner: g.winner, updated_at: g.updated_at, opponent_name: o.name, opponent_avatar: o.avatar };
    }),
    start_dm: ({ p_other }) => Object.values(convs).find((c) => c.kind === 'direct' && c.members.includes(meId) && c.members.includes(p_other))?.id
      || (() => { const id = 'c-new-' + p_other; convs[id] = { id, kind: 'direct', title: null, emoji: '💬', members: [meId, p_other] }; return id; })(),
    send_message: ({ p_conv, p_kind, p_body, p_media_path, p_meta }) => {
      const m = M(p_conv, meId, p_kind, 0, { body: p_body, media_path: p_media_path, meta: p_meta || {} });
      messages.push(m); return m;
    },
    open_view_once: ({ p_msg }) => {
      const m = messages.find((x) => x.id === p_msg);
      if (!canMonitor(m.conversation_id) && m.sender_id !== meId) {
        if (views.some((v) => v.message_id === p_msg && v.profile_id === meId)) throw new Error('شفته من قبل 👀 ينشاف مرة وحدة بس');
        views.push({ message_id: p_msg, profile_id: meId });
      }
      return m.media_path;
    },
    mark_read: ({ p_conv }) => { reads[p_conv + meId] = new Date().toISOString(); return null; },
    respond_friend_request: ({ p_id, p_approve }) => {
      const r = requests.find((x) => x.id === p_id);
      if (!p_approve) r.status = 'rejected'; else { r.to_ok = true; r.from_ok = true; r.status = 'accepted'; }
      return null;
    },
    send_friend_request: () => ({ name: 'نورة', avatar: '🦄' }),
    create_pairing: () => 'demo' + Math.random().toString(36).slice(2),
    start_game: ({ p_conv, p_kind, p_opponent }) => {
      const id = 'g' + (++seq);
      const board = p_kind === 'xo' ? Array(9).fill('') : Array(42).fill('');
      games[id] = { id, conversation_id: p_conv, kind: p_kind, players: [meId, p_opponent], state: p_kind === 'rps' ? { round: 1, moves: {}, score: {} } : { board }, turn: p_kind === 'rps' ? null : meId, winner: null, status: 'active', updated_at: new Date().toISOString() };
      messages.push(M(p_conv, meId, 'game', 0, { meta: { game_id: id, game: p_kind, opponent: p_opponent } }));
      return id;
    },
    game_move: ({ p_game, p_state, p_winner, p_done }) => {
      const g = games[p_game];
      Object.assign(g, { state: p_state, winner: p_winner, status: p_done ? 'done' : 'active', turn: g.players.find((x) => x !== meId) });
      return null;
    },
    game_rps: () => null,
    remove_message: ({ p_msg }) => { const m = messages.find((x) => x.id === p_msg); Object.assign(m, { body: null, media_path: null, meta: {}, removed_by: meId }); return null; },
  };

  const ok = (data) => ({ data, error: null });
  const delay = (v) => new Promise((r) => setTimeout(() => r(v), 120));

  class Query {
    constructor(table) { this.t = table; this.f = []; this.lim = null; this.ord = null; this.one = false; }
    select() { return this; }
    eq(k, v) { this.f.push((r) => r[k] === v); return this; }
    in(k, vs) { this.f.push((r) => vs.includes(r[k])); return this; }
    order(k, o = {}) { this.ord = [k, o.ascending !== false]; return this; }
    limit(n) { this.lim = n; return this; }
    single() { this.one = true; return this; }
    insert(row) { if (this.t === 'blocked_words') words.push({ id: Date.now(), ...row }); return this; }
    delete() { this.del = true; return this; }
    exec() {
      const src = { messages, message_views: views, games: Object.values(games), blocked_words: words, stickers: [] }[this.t] || [];
      if (this.del) { const keep = src.filter((r) => !this.f.every((fn) => fn(r))); src.length = 0; src.push(...keep); return ok(null); }
      let rows = src.filter((r) => this.f.every((fn) => fn(r)));
      if (this.ord) { const [k, asc] = this.ord; rows = [...rows].sort((a, b) => (a[k] > b[k] ? 1 : -1) * (asc ? 1 : -1)); }
      if (this.lim) rows = rows.slice(0, this.lim);
      return ok(this.one ? rows[0] : rows);
    }
    then(res, rej) { return delay(this.exec()).then(res, rej); }
  }

  const channel = { on() { return channel; }, subscribe() { return channel; } };

  return {
    auth: {
      getSession: async () => ok({ session: { user: { id: 'auth-' + meId, is_anonymous: role === 'child' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => { location.search = ''; return ok(null); },
      signInWithPassword: async () => ok({ session: {} }),
      signUp: async () => ok({ session: {} }),
      signInAnonymously: async () => ok({ session: {} }),
      resetPasswordForEmail: async () => ok(null),
      updateUser: async () => ok(null),
    },
    rpc: async (name, args) => {
      await delay();
      try { return ok(rpcs[name] ? rpcs[name](args || {}) : null); } catch (e) { return { data: null, error: { message: e.message } }; }
    },
    from: (table) => new Query(table),
    storage: {
      from: () => ({
        upload: async () => ok({}),
        remove: async () => ok({}),
        createSignedUrl: async (path) => ok({ signedUrl: /\.(m4a|webm|ogg)$/.test(path) ? tone() : 'icons/icon-512.png' }),
        getPublicUrl: (p) => ({ data: { publicUrl: `${supabaseUrl}/storage/v1/object/public/stickers/${p}` } }),
      }),
    },
    channel: () => channel,
    removeChannel: () => {},
  };
}

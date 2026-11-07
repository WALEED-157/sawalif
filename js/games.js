import { sb, S, bus, rpc, el, icon, toast, guard, go, back, av, addCleanup, niceError, navbar, hueOf } from './lib.js';

// ألعاب مع الأصدقاء (كلها بدون تعادل)
export const GAMES = {
  xo: { name: 'إكس أو', icon: '❌⭕', ic: '❌', desc: 'بدون تعادل! 3 قطع بس', colors: ['#7c6cff', '#5b4cf0'] },
  connect4: { name: 'أربعة بالصف', icon: '🔴🟡', ic: '🔴', desc: 'رصّ أربع قطع', colors: ['#f97316', '#f59e0b'] },
  dots: { name: 'المربعات', icon: '🟪', ic: '🟪', desc: 'سكّر أكثر مربعات', colors: ['#06b6d4', '#3b82f6'] },
  guess: { name: 'خمّن الرقم', icon: '🔢', ic: '🔢', desc: 'من 1 إلى 100', colors: ['#8b5cf6', '#d946ef'] },
  quiz: { name: 'تحدّي الأسئلة', icon: '💡', ic: '💡', desc: '7 أسئلة، مين أذكى؟', colors: ['#eab308', '#f97316'] },
  rps: { name: 'حجرة ورقة مقص', icon: '✊✋✌️', ic: '✊', desc: 'أول واحد يوصل 3', colors: ['#10b981', '#14b8a6'] },
};
// ألعاب فردية
export const SOLO = {
  memory: { name: 'لعبة الذاكرة', icon: '🃏', ic: '🃏', desc: 'لاقِ الأزواج', colors: ['#ec4899', '#f43f5e'] },
  g2048: { name: '2048', icon: '🧩', ic: '🧩', desc: 'اجمع الأرقام', colors: ['#f59e0b', '#ef4444'] },
  math: { name: 'سرعة الحساب', icon: '➗', ic: '➗', desc: '60 ثانية', colors: ['#22c55e', '#0ea5e9'] },
};

export async function startGame(convId, kind, opponentId) {
  const id = await rpc('start_game', { p_conv: convId, p_kind: kind, p_opponent: opponentId });
  go('/game/' + id);
}

const RPS = { rock: '✊', paper: '✋', scissors: '✌️' };
const RPS_NAME = { rock: 'حجرة', paper: 'ورقة', scissors: 'مقص' };
const P_COLORS = ['#6a5bff', '#f97316'];

// 40 سؤال (الإجابة الصحيحة دائماً أول خيار، وتنخلط عند العرض)
const QUIZ = [
  ['كم عدد أيام الأسبوع؟', '7', '5', '6'], ['ما عاصمة المملكة العربية السعودية؟', 'الرياض', 'جدة', 'الدمام'],
  ['كم عدد أركان الإسلام؟', '5', '4', '6'], ['أي حيوان يُلقّب بسفينة الصحراء؟', 'الجمل', 'الحصان', 'الفيل'],
  ['كم عدد ألوان قوس قزح؟', '7', '5', '9'], ['ما أكبر كوكب في المجموعة الشمسية؟', 'المشتري', 'الأرض', 'المريخ'],
  ['5 × 6 = ؟', '30', '25', '35'], ['كم عدد أرجل العنكبوت؟', '8', '6', '10'],
  ['كم إصبع في اليد الوحدة؟', '5', '4', '6'], ['ما أسرع حيوان على اليابسة؟', 'الفهد', 'الأسد', 'الحصان'],
  ['كم عدد أجزاء القرآن الكريم؟', '30', '40', '20'], ['ما أول سورة في القرآن الكريم؟', 'الفاتحة', 'البقرة', 'الإخلاص'],
  ['في أي قارة تقع السعودية؟', 'آسيا', 'أفريقيا', 'أوروبا'], ['100 ÷ 4 = ؟', '25', '20', '40'],
  ['على أي كوكب نعيش؟', 'الأرض', 'الزهرة', 'زحل'], ['كم شهر في السنة؟', '12', '10', '13'],
  ['ماذا تنتج النحلة؟', 'العسل', 'الحليب', 'الحرير'], ['ما أكبر محيط في العالم؟', 'الهادئ', 'الأطلسي', 'الهندي'],
  ['كم عدد الصلوات المفروضة في اليوم؟', '5', '3', '7'], ['ما الغاز اللي نتنفسه عشان نعيش؟', 'الأكسجين', 'الهيليوم', 'الهيدروجين'],
  ['أين تقع الكعبة المشرفة؟', 'مكة المكرمة', 'المدينة المنورة', 'الطائف'], ['كم ضلع للمثلث؟', '3', '4', '5'],
  ['9 + 8 = ؟', '17', '16', '18'], ['أي فصل يجي بعد الشتاء؟', 'الربيع', 'الصيف', 'الخريف'],
  ['مين يُلقّب بملك الغابة؟', 'الأسد', 'النمر', 'الذئب'], ['كم دقيقة في الساعة؟', '60', '100', '30'],
  ['من وش يُصنع الزجاج؟', 'الرمل', 'الخشب', 'الحديد'], ['ما عملة السعودية؟', 'الريال', 'الدينار', 'الدرهم'],
  ['كم عدد حروف اللغة العربية؟', '28', '26', '30'], ['أي عضو يضخ الدم في الجسم؟', 'القلب', 'الرئة', 'المعدة'],
  ['12 - 7 = ؟', '5', '4', '6'], ['في أي شهر يصوم المسلمون؟', 'رمضان', 'شعبان', 'شوال'],
  ['أي وسيلة أسرع؟', 'الطائرة', 'القطار', 'السيارة'], ['كم عدد قارات العالم؟', '7', '5', '6'],
  ['أي حيوان يبيض؟', 'الدجاجة', 'البقرة', 'القطة'], ['ما أعلى جبل في العالم؟', 'إيفرست', 'كليمنجارو', 'الألب'],
  ['3 × 3 × 3 = ؟', '27', '9', '18'], ['وين يعيش السمك؟', 'في الماء', 'في الصحراء', 'على الشجر'],
  ['كم ساعة في اليوم؟', '24', '12', '20'], ['ما لون السماء في يوم صافي؟', 'أزرق', 'أخضر', 'أحمر'],
];

function subHeader(title, onBack, emoji, colors) {
  return navbar({ title, subtitle: 'لعبة', avatar: el('span', { class: 'av sm game-av', style: { '--g1': colors[0], '--g2': colors[1] } }, emoji), onBack });
}

function xoWinner(b) {
  const L = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  for (const [a, c, d] of L) if (b[a] && b[a] === b[c] && b[a] === b[d]) return { mark: b[a], line: [a, c, d] };
  return null;
}

function c4Winner(b) {
  const at = (r, c) => (r >= 0 && r < 6 && c >= 0 && c < 7 ? b[r * 7 + c] : '');
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      const v = at(r, c);
      if (!v) continue;
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const line = [0, 1, 2, 3].map((k) => [r + dr * k, c + dc * k]);
        if (line.every(([rr, cc]) => at(rr, cc) === v)) return { mark: v, line: line.map(([rr, cc]) => rr * 7 + cc) };
      }
    }
  }
  return null;
}

// المربعات 3×3: خطوط أفقية 4 صفوف × 3، رأسية 3 صفوف × 4
const boxSides = (b) => { const r = Math.floor(b / 3); const c = b % 3; return { h: [r * 3 + c, (r + 1) * 3 + c], v: [r * 4 + c, r * 4 + c + 1] }; };
const boxDone = (st, b) => { const s = boxSides(b); return s.h.every((i) => st.h[i] !== '') && s.v.every((i) => st.v[i] !== ''); };

const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

export async function renderGame(app, id) {
  if (id === 'memory') return renderMemory(app);
  if (id === 'g2048') return render2048(app);
  if (id === 'math') return renderMath(app);

  const { data: g0, error } = await sb.from('games').select('*').eq('id', id).single();
  if (error || !g0) throw new Error('اللعبة غير موجودة');
  const info = await rpc('conversation_info', { p_conv: g0.conversation_id });
  const people = new Map(info.members.map((m) => [m.id, m]));
  const meta = GAMES[g0.kind];
  let g = g0;
  let busy = false;
  let localLock = false; // أثناء تحدّي الأسئلة ما نعيد الرسم

  const root = el('main', { class: 'page game-page' });
  app.replaceChildren(el('div', { class: 'sub game-sub' }, subHeader(meta.name, () => back('/games'), meta.ic, meta.colors), root));

  const myIdx = g.players.indexOf(S.me.id);
  const isPlayer = myIdx >= 0;
  const p = (i) => people.get(g.players[i]) || { name: 'لاعب', avatar: '👤' };
  const oppId = g.players[1 - Math.max(0, myIdx)];
  const nameOf = (uid) => (uid === S.me.id ? 'أنت' : people.get(uid)?.name || '');

  const move = async (state, winner, done, keepTurn = false) => {
    if (busy) return;
    busy = true;
    const prev = g;
    g = { ...g, state, winner, status: done ? 'done' : 'active', turn: keepTurn && !done ? S.me.id : oppId };
    draw();
    try { await rpc('game_move', { p_game: id, p_state: state, p_winner: winner, p_done: done, p_keep_turn: keepTurn }); }
    catch (e) { g = prev; draw(); toast(niceError(e), 'err'); }
    finally { busy = false; }
  };

  function scoreOf(i) {
    if (g.kind === 'rps') return g.state.score?.[g.players[i]] || 0;
    if (g.kind === 'dots') return (g.state.boxes || []).filter((x) => x === String(i)).length;
    if (g.kind === 'quiz') return g.state.results?.[g.players[i]]?.score ?? '—';
    return null;
  }

  function players(marks) {
    return el('div', { class: 'players' },
      [0, 1].map((i) => {
        const sc = scoreOf(i);
        return el('div', { class: 'player' + (g.status === 'active' && g.turn === g.players[i] ? ' turn' : '') + (g.status === 'done' && g.winner === g.players[i] ? ' won' : ''), style: { '--pc': P_COLORS[i] } },
          av(p(i).avatar, 'lg', g.players[i]), el('b', null, p(i).name + (g.players[i] === S.me.id ? ' (أنت)' : '')),
          marks ? el('span', { class: 'mark' }, marks[i]) : null,
          sc !== null ? el('span', { class: 'score' }, String(sc)) : null);
      }));
  }

  function statusLine() {
    if (g.status === 'done') {
      if (g.winner === S.me.id) return el('div', { class: 'g-status win' }, '🎉 فزت! كفو 🏆');
      return el('div', { class: 'g-status lose' }, `${people.get(g.winner)?.name || ''} فاز 😅`);
    }
    if (g.kind === 'rps') return el('div', { class: 'g-status' }, `الجولة ${g.state.round || 1}`);
    if (g.kind === 'quiz') return el('div', { class: 'g-status' }, 'جاوب على 7 أسئلة بأسرع وقت');
    if (!isPlayer) return el('div', { class: 'g-status' }, `دور ${people.get(g.turn)?.name || ''}`);
    return el('div', { class: 'g-status' + (g.turn === S.me.id ? ' go' : '') }, g.turn === S.me.id ? '🎯 دورك!' : `⏳ دور ${people.get(g.turn)?.name || ''}...`);
  }

  function afterButtons() {
    if (g.status !== 'done') return null;
    return el('div', { class: 'row-btns center' },
      isPlayer ? el('button', { class: 'btn primary', onclick: (e) => guard(() => startGame(g.conversation_id, g.kind, oppId), e.currentTarget) }, icon('flip'), 'جولة ثانية') : null,
      el('button', { class: 'btn soft', onclick: () => go('/chat/' + g.conversation_id) }, icon('chat'), 'المحادثة'));
  }

  const canPlay = () => isPlayer && g.status === 'active' && g.turn === S.me.id && !busy;

  // ----- إكس أو بدون تعادل: كل لاعب له 3 قطع، الرابعة تشيل الأقدم -----
  function xoView() {
    const b = g.state.board;
    const order = g.state.order || { X: [], O: [] };
    const w = xoWinner(b);
    const myMark = myIdx === 0 ? 'X' : 'O';
    const turnMark = g.turn === g.players[0] ? 'X' : 'O';
    const fading = g.status === 'active' && (order[turnMark] || []).length >= 3 ? order[turnMark][0] : -1;
    const live = canPlay();
    return el('div', null,
      el('div', { class: 'xo' + (live ? ' live' : '') }, b.map((v, i) => el('button', {
        class: 'xo-cell' + (w?.line.includes(i) ? ' win' : '') + (i === fading ? ' fading' : ''), 'aria-label': `خانة ${i + 1}`,
        disabled: !live || !!v,
        onclick: () => {
          const nb = [...b]; const no = { X: [...(order.X || [])], O: [...(order.O || [])] };
          if (no[myMark].length >= 3) { const old = no[myMark].shift(); nb[old] = ''; }
          nb[i] = myMark; no[myMark].push(i);
          const win = xoWinner(nb);
          move({ board: nb, order: no }, win ? S.me.id : null, !!win);
        },
      }, v === 'X' ? '❌' : v === 'O' ? '⭕' : ''))),
      el('p', { class: 'muted center small' }, 'كل لاعب عنده 3 قطع بس — القطعة الباهتة بتختفي بالحركة الجاية'));
  }

  // ----- أربعة بالصف (إذا امتلأت اللوحة تبدأ من جديد، ما فيه تعادل) -----
  function c4View() {
    const b = g.state.board;
    const w = c4Winner(b);
    const myMark = myIdx === 0 ? 'R' : 'Y';
    const live = canPlay();
    const drop = (c) => {
      for (let r = 5; r >= 0; r--) {
        if (!b[r * 7 + c]) {
          let nb = [...b]; nb[r * 7 + c] = myMark;
          const win = c4Winner(nb);
          let resets = g.state.resets || 0;
          if (!win && nb.every(Boolean)) { nb = Array(42).fill(''); resets++; toast('اللوحة امتلأت! نبدأ من جديد 🔄'); }
          move({ board: nb, resets }, win ? S.me.id : null, !!win);
          return;
        }
      }
    };
    return el('div', { class: 'c4', dir: 'ltr' }, [0, 1, 2, 3, 4, 5, 6].map((c) => el('button', {
      class: 'c4-col', disabled: !live || !!b[c], 'aria-label': `عمود ${c + 1}`, onclick: () => drop(c),
    }, [0, 1, 2, 3, 4, 5].map((r) => {
      const v = b[r * 7 + c];
      return el('span', { class: 'c4-cell' + (v ? ' ' + v : '') + (w?.line.includes(r * 7 + c) ? ' win' : '') });
    }))));
  }

  // ----- المربعات (9 مربعات = ما فيه تعادل) -----
  function dotsView() {
    const st = g.state;
    const live = canPlay();
    const cells = [];
    const play = (type, idx) => {
      const ns = { h: [...st.h], v: [...st.v], boxes: [...st.boxes] };
      ns[type][idx] = String(myIdx);
      let scored = 0;
      for (let bx = 0; bx < 9; bx++) if (ns.boxes[bx] === '' && boxDone(ns, bx)) { ns.boxes[bx] = String(myIdx); scored++; }
      const done = ns.boxes.every((x) => x !== '');
      let winner = null;
      if (done) { const mine = ns.boxes.filter((x) => x === String(myIdx)).length; winner = mine >= 5 ? S.me.id : oppId; }
      move(ns, winner, done, scored > 0);
    };
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (r % 2 === 0 && c % 2 === 0) cells.push(el('span', { class: 'd-dot' }));
        else if (r % 2 === 0) {
          const idx = (r / 2) * 3 + (c - 1) / 2; const o = st.h[idx];
          cells.push(el('button', { class: 'd-line h' + (o !== '' ? ' on' : ''), style: o !== '' ? { '--pc': P_COLORS[+o] } : null, disabled: !live || o !== '', 'aria-label': 'خط', onclick: () => play('h', idx) }));
        } else if (c % 2 === 0) {
          const idx = ((r - 1) / 2) * 4 + c / 2; const o = st.v[idx];
          cells.push(el('button', { class: 'd-line v' + (o !== '' ? ' on' : ''), style: o !== '' ? { '--pc': P_COLORS[+o] } : null, disabled: !live || o !== '', 'aria-label': 'خط', onclick: () => play('v', idx) }));
        } else {
          const bx = ((r - 1) / 2) * 3 + (c - 1) / 2; const o = st.boxes[bx];
          cells.push(el('span', { class: 'd-box' + (o !== '' ? ' on' : ''), style: o !== '' ? { '--pc': P_COLORS[+o] } : null }, o !== '' ? p(+o).avatar : ''));
        }
      }
    }
    return el('div', null, el('div', { class: 'dots', dir: 'ltr' }, cells),
      el('p', { class: 'muted center small' }, 'ارسم خط بين نقطتين. إذا سكّرت مربع تاخذه وتلعب مرة ثانية'));
  }

  // ----- خمّن الرقم -----
  function guessView() {
    const st = g.state;
    const hist = st.history || [];
    const live = canPlay();
    const input = el('input', { class: 'input guess-input', type: 'number', inputmode: 'numeric', min: '1', max: '100', placeholder: '؟', dir: 'ltr', 'aria-label': 'تخمينك' });
    const btn = el('button', { class: 'btn primary lg' }, 'خمّن');
    const send = () => guard(async () => {
      const n = parseInt(input.value, 10);
      if (!(n >= 1 && n <= 100)) throw new Error('اختر رقم من 1 إلى 100');
      busy = true; btn.disabled = true;
      try { await rpc('game_guess', { p_game: id, p_guess: n }); } finally { busy = false; }
    });
    btn.onclick = send;
    input.onkeydown = (e) => { if (e.key === 'Enter') send(); };
    return el('div', { class: 'stack' },
      el('div', { class: 'guess-range' },
        g.status === 'done' ? [el('small', null, 'الرقم السري'), el('b', null, String(st.secret ?? '🎉'))]
          : [el('small', null, 'الرقم السري'), el('b', null, `من ${st.low ?? 1} إلى ${st.high ?? 100}`)]),
      live ? el('div', { class: 'inline' }, input, btn) : null,
      hist.length ? el('div', { class: 'list' }, [...hist].reverse().map((h) => el('div', { class: 'row' },
        av(people.get(h.by)?.avatar || '👤', 'sm', h.by),
        el('div', { class: 'row-main' }, el('b', null, nameOf(h.by)), el('small', { class: 'muted' }, `خمّن ${h.n}`)),
        el('span', { class: 'pill ' + (h.hint === 'hit' ? 'ok' : 'accent') }, h.hint === 'hit' ? '🎯 صح!' : h.hint === 'up' ? '⬆️ أكبر' : '⬇️ أصغر'))))
        : el('p', { class: 'muted center' }, 'أول واحد يلقى الرقم يفوز!'));
  }

  // ----- تحدّي الأسئلة -----
  function quizView() {
    const st = g.state;
    const mine = st.results?.[S.me.id];
    if (g.status === 'done' || !isPlayer) {
      return el('div', { class: 'list' }, [0, 1].map((i) => {
        const r = st.results?.[g.players[i]];
        return el('div', { class: 'row' }, av(p(i).avatar, 'md', g.players[i]),
          el('div', { class: 'row-main' }, el('b', null, p(i).name), el('small', { class: 'muted' }, r ? `${r.score} من 7 · ${(r.ms / 1000).toFixed(1)} ثانية` : 'ما جاوب للحين')),
          g.winner === g.players[i] ? el('span', { class: 'pill ok' }, '🏆') : null);
      }));
    }
    if (mine) {
      return el('div', { class: 'card center' }, el('div', { class: 'empty-art' }, '⏳'),
        el('h3', null, `جبت ${mine.score} من 7`), el('p', { class: 'muted' }, `ننتظر ${people.get(oppId)?.name || 'خصمك'} يخلص...`));
    }
    const box = el('div', { class: 'card quiz' });
    const start = () => {
      localLock = true;
      const qs = (st.q || []).map((i) => QUIZ[i % QUIZ.length]);
      let n = 0; let score = 0; const t0 = Date.now();
      const ask = () => {
        if (n >= qs.length) {
          const ms = Date.now() - t0;
          box.replaceChildren(el('div', { class: 'center' }, el('div', { class: 'empty-art' }, '✅'), el('h3', null, `جبت ${score} من 7`), el('p', { class: 'muted' }, 'جاري الإرسال...')));
          rpc('game_quiz', { p_game: id, p_score: score, p_ms: ms }).catch((e) => toast(niceError(e), 'err')).finally(() => { localLock = false; draw(); });
          return;
        }
        const [q, correct, ...wrong] = qs[n];
        const opts = shuffle([correct, ...wrong]);
        box.replaceChildren(
          el('div', { class: 'quiz-top' }, el('span', { class: 'pill accent' }, `سؤال ${n + 1} من ${qs.length}`), el('span', { class: 'pill ok' }, `✓ ${score}`)),
          el('div', { class: 'quiz-bar' }, el('i', { style: { width: `${(n / qs.length) * 100}%` } })),
          el('h2', { class: 'quiz-q' }, q),
          el('div', { class: 'quiz-opts' }, opts.map((o) => el('button', {
            class: 'quiz-opt',
            onclick: (e) => {
              const ok = o === correct;
              if (ok) score++;
              box.querySelectorAll('.quiz-opt').forEach((b) => { b.disabled = true; if (b.textContent === correct) b.classList.add('right'); });
              if (!ok) e.currentTarget.classList.add('wrong');
              setTimeout(() => { n++; ask(); }, 650);
            },
          }, o))));
      };
      ask();
    };
    box.append(el('div', { class: 'center stack' }, el('div', { class: 'empty-art' }, '💡'), el('h3', null, '7 أسئلة سريعة'),
      el('p', { class: 'muted' }, 'الأكثر إجابات صحيحة يفوز، وإذا تعادلتوا يفوز الأسرع'),
      el('button', { class: 'btn primary lg', onclick: start }, 'ابدأ التحدي')));
    return box;
  }

  // ----- حجرة ورقة مقص -----
  function rpsView() {
    const mine = g.state.moves?.[S.me.id];
    const last = g.state.last;
    const lastBox = last ? el('div', { class: 'rps-last' },
      el('div', { class: 'rps-pair' },
        el('div', null, el('span', { class: 'rps-big' }, RPS[last[g.players[0]]] || '❔'), el('small', null, p(0).name)),
        el('b', null, 'ضد'),
        el('div', null, el('span', { class: 'rps-big' }, RPS[last[g.players[1]]] || '❔'), el('small', null, p(1).name))),
      el('div', { class: 'muted' }, !last.winner ? 'تعادل الجولة، نعيدها 🔁' : `${people.get(last.winner)?.name || ''} أخذ الجولة`)) : null;
    if (g.status === 'done') return lastBox || el('div');
    if (!isPlayer) return el('div', null, lastBox, el('p', { class: 'muted center' }, 'اللاعبين يختارون...'));
    if (mine) {
      return el('div', null, lastBox,
        el('div', { class: 'rps-wait' }, el('span', { class: 'rps-big' }, RPS[mine]), el('p', null, `اخترت ${RPS_NAME[mine]} — ننتظر ${people.get(oppId)?.name || 'خصمك'} ⏳`)));
    }
    return el('div', null, lastBox,
      el('p', { class: 'center' }, 'اختر حركتك 👇'),
      el('div', { class: 'rps-choices' }, Object.keys(RPS).map((k) => el('button', {
        class: 'rps-btn', disabled: busy,
        onclick: async () => {
          busy = true; g = { ...g, state: { ...g.state, moves: { ...(g.state.moves || {}), [S.me.id]: k } } }; draw();
          try { await rpc('game_rps', { p_game: id, p_choice: k }); } catch (e) { toast(niceError(e), 'err'); }
          finally { busy = false; }
        },
      }, el('span', null, RPS[k]), el('small', null, RPS_NAME[k])))));
  }

  function draw() {
    if (localLock) return;
    const marks = g.kind === 'xo' ? ['❌', '⭕'] : g.kind === 'connect4' ? ['🔴', '🟡'] : null;
    const views = { xo: xoView, connect4: c4View, dots: dotsView, guess: guessView, quiz: quizView, rps: rpsView };
    root.replaceChildren(...[players(marks), statusLine(), (views[g.kind] || rpsView)(), afterButtons(),
      !isPlayer ? el('p', { class: 'muted center small' }, 'تشاهد اللعبة كولي أمر') : null].filter(Boolean));
  }
  draw();

  addCleanup(bus.on('game', (ng) => {
    if (ng.id !== id) return;
    const wasDone = g.status === 'done';
    g = ng; draw();
    if (!wasDone && g.status === 'done' && g.winner === S.me.id) toast('🎉 فزت!', 'ok');
  }));
}

// =============================================================
//  الألعاب الفردية
// =============================================================
function soloShell(app, key) {
  const m = SOLO[key];
  const root = el('main', { class: 'page game-page' });
  app.replaceChildren(el('div', { class: 'sub game-sub' }, subHeader(m.name, () => back('/games'), m.ic, m.colors), root));
  return root;
}
const getBest = (k) => { try { return +localStorage.getItem(k) || 0; } catch { return 0; } };
const setBest = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* ignore */ } };

function renderMemory(app) {
  const POOL = ['🐶', '🐱', '🦁', '🐼', '🐸', '🦄', '🐙', '🦋', '🍕', '🍩', '⚽', '🚀', '🌈', '🎈', '🍉', '🐢'];
  const root = soloShell(app, 'memory');
  let best = getBest('fc_mem_best') || null;
  const start = (pairs) => {
    const pick = shuffle(POOL).slice(0, pairs);
    const cards = shuffle([...pick, ...pick]).map((e, i) => ({ i, e, open: false, done: false }));
    let first = null; let lock = false; let moves = 0; let found = 0;
    const info = el('div', { class: 'g-status' }, 'اقلب بطاقتين متشابهتين');
    const movesEl = el('div', { class: 'muted center' });
    const grid = el('div', { class: 'mem', style: { '--cols': '4' } });
    const draw = () => {
      movesEl.textContent = `المحاولات: ${moves}` + (best ? ` · أفضل نتيجة: ${best}` : '');
      grid.replaceChildren(...cards.map((c) => el('button', {
        class: 'mem-card' + (c.open || c.done ? ' open' : '') + (c.done ? ' done' : ''), disabled: c.done, 'aria-label': 'بطاقة',
        onclick: () => {
          if (lock || c.open || c.done) return;
          c.open = true;
          if (!first) { first = c; draw(); return; }
          moves++;
          if (first.e === c.e) {
            first.done = c.done = true; first = null; found++;
            if (found === pairs) {
              info.textContent = `🎉 خلصتها في ${moves} محاولة!`;
              info.classList.add('win');
              if (pairs === 8 && (!best || moves < best)) { best = moves; setBest('fc_mem_best', moves); info.textContent += ' 🏆 رقم قياسي'; }
            }
            draw();
          } else {
            lock = true; draw();
            const a = first; first = null;
            setTimeout(() => { a.open = false; c.open = false; lock = false; draw(); }, 800);
          }
        },
      }, el('span', { class: 'mem-front' }, '?'), el('span', { class: 'mem-back' }, c.e))));
    };
    draw();
    root.replaceChildren(info, movesEl, grid,
      el('div', { class: 'row-btns center' },
        el('button', { class: 'btn soft', onclick: () => start(6) }, 'سهلة (12)'),
        el('button', { class: 'btn primary', onclick: () => start(8) }, 'عادية (16)')));
  };
  start(8);
}

function render2048(app) {
  const root = soloShell(app, 'g2048');
  let best = getBest('fc_2048_best');
  let grid; let score; let over;
  const empty = () => grid.flatMap((row, r) => row.map((v, c) => (v ? null : [r, c]))).filter(Boolean);
  const addTile = () => { const e = empty(); if (!e.length) return; const [r, c] = e[Math.floor(Math.random() * e.length)]; grid[r][c] = Math.random() < 0.9 ? 2 : 4; };
  const slideRow = (row) => {
    const a = row.filter(Boolean); const out = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] === a[i + 1]) { out.push(a[i] * 2); score += a[i] * 2; i++; } else out.push(a[i]);
    }
    while (out.length < 4) out.push(0);
    return out;
  };
  const rotate = (m) => m[0].map((_, i) => m.map((row) => row[i]).reverse());
  const moveDir = (dir) => {
    if (over) return;
    // 0 = يسار، 1 = فوق، 2 = يمين، 3 = تحت
    let m = grid.map((r) => [...r]);
    const turns = { 0: 0, 1: 3, 2: 2, 3: 1 }[dir];
    for (let i = 0; i < turns; i++) m = rotate(m);
    m = m.map(slideRow);
    for (let i = 0; i < (4 - turns) % 4; i++) m = rotate(m);
    if (JSON.stringify(m) === JSON.stringify(grid)) return;
    grid = m; addTile();
    if (score > best) { best = score; setBest('fc_2048_best', best); }
    const canMove = empty().length || grid.some((row, r) => row.some((v, c) => (c < 3 && v === row[c + 1]) || (r < 3 && v === grid[r + 1][c])));
    if (!canMove) over = true;
    draw();
  };
  const board = el('div', { class: 'g2048', dir: 'ltr', tabindex: '0', 'aria-label': 'لوحة 2048' });
  const scoreEl = el('div', { class: 'players' });
  const msg = el('div', { class: 'g-status' });
  const draw = () => {
    scoreEl.replaceChildren(
      el('div', { class: 'player' }, el('small', { class: 'muted' }, 'النقاط'), el('span', { class: 'score' }, String(score))),
      el('div', { class: 'player' }, el('small', { class: 'muted' }, 'أفضل نتيجة'), el('span', { class: 'score' }, String(best))));
    board.replaceChildren(...grid.flat().map((v) => el('span', { class: 't2048', 'data-v': String(Math.min(v, 4096)) }, v ? String(v) : '')));
    msg.textContent = over ? 'خلصت الحركات! 😅' : 'اسحب بإصبعك للجهات الأربع';
    msg.classList.toggle('lose', over);
  };
  const reset = () => { grid = Array.from({ length: 4 }, () => [0, 0, 0, 0]); score = 0; over = false; addTile(); addTile(); draw(); };
  let sx = 0; let sy = 0;
  board.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  board.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - sx; const dy = e.changedTouches[0].clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) moveDir(dx < 0 ? 0 : 2); else moveDir(dy < 0 ? 1 : 3);
  });
  board.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  const onKey = (e) => { const k = { ArrowLeft: 0, ArrowUp: 1, ArrowRight: 2, ArrowDown: 3 }[e.key]; if (k !== undefined) { e.preventDefault(); moveDir(k); } };
  document.addEventListener('keydown', onKey);
  addCleanup(() => document.removeEventListener('keydown', onKey));
  root.replaceChildren(scoreEl, msg, board, el('div', { class: 'row-btns center' }, el('button', { class: 'btn primary', onclick: reset }, icon('flip'), 'لعبة جديدة')));
  reset();
}

function renderMath(app) {
  const root = soloShell(app, 'math');
  let best = getBest('fc_math_best');
  let timer = null;
  addCleanup(() => clearInterval(timer));
  const intro = () => {
    clearInterval(timer);
    root.replaceChildren(el('div', { class: 'card center stack' }, el('div', { class: 'empty-art' }, '➗'),
      el('h3', null, 'جاوب أكبر عدد من المسائل في 60 ثانية'),
      best ? el('p', { class: 'muted' }, `أفضل نتيجة: ${best}`) : null,
      el('button', { class: 'btn primary lg', onclick: play }, 'ابدأ')));
  };
  const makeQ = () => {
    const op = ['+', '-', '×'][Math.floor(Math.random() * 3)];
    let a; let b; let ans;
    if (op === '+') { a = 1 + Math.floor(Math.random() * 20); b = 1 + Math.floor(Math.random() * 20); ans = a + b; }
    else if (op === '-') { a = 5 + Math.floor(Math.random() * 20); b = 1 + Math.floor(Math.random() * a); ans = a - b; }
    else { a = 2 + Math.floor(Math.random() * 9); b = 2 + Math.floor(Math.random() * 9); ans = a * b; }
    const opts = new Set([ans]);
    while (opts.size < 3) { const d = ans + (Math.floor(Math.random() * 7) - 3) || ans + 4; if (d >= 0) opts.add(d); }
    return { text: `${a} ${op} ${b}`, ans, opts: shuffle([...opts]) };
  };
  const play = () => {
    let score = 0; let left = 60;
    const timeEl = el('span', { class: 'pill accent' }, '60');
    const scoreEl = el('span', { class: 'pill ok' }, '✓ 0');
    const qEl = el('div', { class: 'math-q', dir: 'ltr' });
    const opts = el('div', { class: 'quiz-opts three' });
    const next = () => {
      const q = makeQ();
      qEl.textContent = `${q.text} = ?`;
      opts.replaceChildren(...q.opts.map((o) => el('button', { class: 'quiz-opt', dir: 'ltr', onclick: (e) => {
        if (o === q.ans) { score++; scoreEl.textContent = `✓ ${score}`; next(); }
        else { e.currentTarget.classList.add('wrong'); e.currentTarget.disabled = true; }
      } }, String(o))));
    };
    root.replaceChildren(el('div', { class: 'card quiz' }, el('div', { class: 'quiz-top' }, timeEl, scoreEl), qEl, opts));
    next();
    timer = setInterval(() => {
      left--; timeEl.textContent = String(left);
      if (left <= 0) {
        clearInterval(timer);
        const record = score > best;
        if (record) { best = score; setBest('fc_math_best', best); }
        root.replaceChildren(el('div', { class: 'card center stack' }, el('div', { class: 'empty-art' }, record ? '🏆' : '⏱️'),
          el('h2', null, `جبت ${score}`), el('p', { class: 'muted' }, record ? 'رقم قياسي جديد!' : `أفضل نتيجة: ${best}`),
          el('button', { class: 'btn primary lg', onclick: play }, icon('flip'), 'مرة ثانية')));
      }
    }, 1000);
  };
  intro();
}

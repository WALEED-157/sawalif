import { sb, S, bus, rpc, el, icon, toast, guard, go, back, av, addCleanup, niceError, navbar } from './lib.js';

export const GAMES = {
  xo: { name: 'إكس أو', icon: '❌⭕', ic: '❌', desc: 'ثلاثة في صف', colors: ['#6c5ce7', '#a29bfe'] },
  connect4: { name: 'أربعة بالصف', icon: '🔴🟡', ic: '🔴', desc: 'رصّ أربع قطع', colors: ['#e17055', '#f6b93b'] },
  rps: { name: 'حجرة ورقة مقص', icon: '✊✋✌️', ic: '✊', desc: 'أول واحد يوصل 3', colors: ['#00b894', '#00cec9'] },
};
export const SOLO = {
  memory: { name: 'لعبة الذاكرة', icon: '🧠', ic: '🧠', desc: 'العب لحالك', colors: ['#e84393', '#fd79a8'] },
};

export async function startGame(convId, kind, opponentId) {
  const id = await rpc('start_game', { p_conv: convId, p_kind: kind, p_opponent: opponentId });
  go('/game/' + id);
}

const RPS = { rock: '✊', paper: '✋', scissors: '✌️' };
const RPS_NAME = { rock: 'حجرة', paper: 'ورقة', scissors: 'مقص' };

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
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      const v = at(r, c);
      if (!v) continue;
      for (const [dr, dc] of dirs) {
        const line = [0, 1, 2, 3].map((k) => [r + dr * k, c + dc * k]);
        if (line.every(([rr, cc]) => at(rr, cc) === v)) return { mark: v, line: line.map(([rr, cc]) => rr * 7 + cc) };
      }
    }
  }
  return null;
}

export async function renderGame(app, id) {
  if (id === 'memory') return renderMemory(app);

  const { data: g0, error } = await sb.from('games').select('*').eq('id', id).single();
  if (error) throw new Error('اللعبة غير موجودة');
  const info = await rpc('conversation_info', { p_conv: g0.conversation_id });
  const people = new Map(info.members.map((m) => [m.id, m]));
  const meta = GAMES[g0.kind];
  let g = g0;
  let busy = false;

  const root = el('main', { class: 'page game-page' });
  app.replaceChildren(el('div', { class: 'sub game-sub' }, subHeader(meta.name, () => back('/games'), meta.ic, meta.colors), root));

  const myIdx = g.players.indexOf(S.me.id);
  const isPlayer = myIdx >= 0;
  const p = (i) => people.get(g.players[i]) || { name: 'لاعب', avatar: '👤' };
  const oppId = g.players[1 - Math.max(0, myIdx)];

  const move = async (state, winner, done) => {
    if (busy) return;
    busy = true;
    const prev = g;
    g = { ...g, state, winner, status: done ? 'done' : 'active', turn: oppId };
    draw();
    try { await rpc('game_move', { p_game: id, p_state: state, p_winner: winner, p_done: done }); }
    catch (e) { g = prev; draw(); toast(niceError(e), 'err'); }
    finally { busy = false; }
  };

  function players(marks) {
    return el('div', { class: 'players' },
      [0, 1].map((i) => el('div', { class: 'player' + (g.status === 'active' && g.turn === g.players[i] ? ' turn' : '') },
        av(p(i).avatar, 'lg', g.players[i]), el('b', null, p(i).name + (g.players[i] === S.me.id ? ' (أنت)' : '')),
        marks ? el('span', { class: 'mark' }, marks[i]) : null,
        g.kind === 'rps' ? el('span', { class: 'score' }, String(g.state.score?.[g.players[i]] || 0)) : null)),
    );
  }

  function statusLine() {
    if (g.status === 'done') {
      if (!g.winner) return el('div', { class: 'g-status' }, '🤝 تعادل!');
      if (g.winner === S.me.id) return el('div', { class: 'g-status win' }, '🎉 فزت! كفو 🏆');
      return el('div', { class: 'g-status' }, `${people.get(g.winner)?.name || ''} فاز 😅`);
    }
    if (g.kind === 'rps') return el('div', { class: 'g-status' }, `الجولة ${g.state.round || 1}`);
    if (!isPlayer) return el('div', { class: 'g-status' }, `دور ${people.get(g.turn)?.name || ''}`);
    return el('div', { class: 'g-status' + (g.turn === S.me.id ? ' go' : '') }, g.turn === S.me.id ? '🎯 دورك!' : `⏳ دور ${people.get(g.turn)?.name || ''}...`);
  }

  function afterButtons() {
    if (g.status !== 'done') return null;
    return el('div', { class: 'row-btns center' },
      isPlayer ? el('button', { class: 'btn primary', onclick: (e) => guard(() => startGame(g.conversation_id, g.kind, oppId), e.currentTarget) }, icon('flip'), 'جولة ثانية') : null,
      el('button', { class: 'btn soft', onclick: () => go('/chat/' + g.conversation_id) }, icon('chat'), 'المحادثة'));
  }

  function xoView() {
    const b = g.state.board;
    const w = xoWinner(b);
    const myMark = myIdx === 0 ? 'X' : 'O';
    const canPlay = isPlayer && g.status === 'active' && g.turn === S.me.id && !busy;
    return el('div', { class: 'xo' + (canPlay ? ' live' : '') }, b.map((v, i) => el('button', {
      class: 'xo-cell' + (w?.line.includes(i) ? ' win' : ''), 'aria-label': `خانة ${i + 1}`,
      disabled: !canPlay || !!v,
      onclick: () => {
        const nb = [...b]; nb[i] = myMark;
        const win = xoWinner(nb);
        move({ board: nb }, win ? S.me.id : null, !!win || nb.every(Boolean));
      },
    }, v === 'X' ? '❌' : v === 'O' ? '⭕' : '')));
  }

  function c4View() {
    const b = g.state.board;
    const w = c4Winner(b);
    const myMark = myIdx === 0 ? 'R' : 'Y';
    const canPlay = isPlayer && g.status === 'active' && g.turn === S.me.id && !busy;
    const drop = (c) => {
      for (let r = 5; r >= 0; r--) {
        if (!b[r * 7 + c]) {
          const nb = [...b]; nb[r * 7 + c] = myMark;
          const win = c4Winner(nb);
          move({ board: nb }, win ? S.me.id : null, !!win || nb.every(Boolean));
          return;
        }
      }
    };
    return el('div', { class: 'c4', dir: 'ltr' }, [0, 1, 2, 3, 4, 5, 6].map((c) => el('button', {
      class: 'c4-col', disabled: !canPlay || !!b[c], 'aria-label': `عمود ${c + 1}`, onclick: () => drop(c),
    }, [0, 1, 2, 3, 4, 5].map((r) => {
      const v = b[r * 7 + c];
      return el('span', { class: 'c4-cell' + (v ? ' ' + v : '') + (w?.line.includes(r * 7 + c) ? ' win' : '') });
    }))));
  }

  function rpsView() {
    const mine = g.state.moves?.[S.me.id];
    const last = g.state.last;
    const lastBox = last ? el('div', { class: 'rps-last' },
      el('div', { class: 'rps-pair' },
        el('div', null, el('span', { class: 'rps-big' }, RPS[last[g.players[0]]] || '❔'), el('small', null, p(0).name)),
        el('b', null, 'ضد'),
        el('div', null, el('span', { class: 'rps-big' }, RPS[last[g.players[1]]] || '❔'), el('small', null, p(1).name))),
      el('div', { class: 'muted' }, !last.winner ? 'تعادل الجولة 🤝' : `${people.get(last.winner)?.name || ''} أخذ الجولة`)) : null;
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
    const marks = g.kind === 'xo' ? ['❌', '⭕'] : g.kind === 'connect4' ? ['🔴', '🟡'] : null;
    const board = g.kind === 'xo' ? xoView() : g.kind === 'connect4' ? c4View() : rpsView();
    root.replaceChildren(...[players(marks), statusLine(), board, afterButtons(),
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
//  لعبة الذاكرة (فردية، بدون إنترنت)
// =============================================================
function renderMemory(app) {
  const POOL = ['🐶', '🐱', '🦁', '🐼', '🐸', '🦄', '🐙', '🦋', '🍕', '🍩', '⚽', '🚀', '🌈', '🎈', '🍉', '🐢'];
  const root = el('main', { class: 'page game-page' });
  app.replaceChildren(el('div', { class: 'sub game-sub' }, subHeader('لعبة الذاكرة', () => back('/games'), '🧠', SOLO.memory.colors), root));
  let best = null;
  try { best = +localStorage.getItem('fc_mem_best') || null; } catch { /* ignore */ }

  const start = (pairs) => {
    const pick = [...POOL].sort(() => Math.random() - 0.5).slice(0, pairs);
    const cards = [...pick, ...pick].sort(() => Math.random() - 0.5).map((e, i) => ({ i, e, open: false, done: false }));
    let first = null; let lock = false; let moves = 0; let found = 0;
    const info = el('div', { class: 'g-status' }, 'اقلب بطاقتين متشابهتين');
    const movesEl = el('div', { class: 'muted center' });
    const grid = el('div', { class: 'mem', style: { '--cols': pairs > 6 ? 4 : 4 } });
    const draw = () => {
      movesEl.textContent = `المحاولات: ${moves}` + (best ? ` · أفضل نتيجة: ${best}` : '');
      grid.replaceChildren(...cards.map((c) => el('button', {
        class: 'mem-card' + (c.open || c.done ? ' open' : '') + (c.done ? ' done' : ''),
        disabled: c.done, 'aria-label': 'بطاقة',
        onclick: () => {
          if (lock || c.open || c.done) return;
          c.open = true;
          if (!first) { first = c; draw(); return; }
          moves++;
          if (first.e === c.e) {
            first.done = c.done = true; first = null; found++;
            if (found === pairs) {
              info.textContent = `🎉 خلصتها في ${moves} محاولة!`;
              if (pairs === 8 && (!best || moves < best)) { best = moves; try { localStorage.setItem('fc_mem_best', String(moves)); } catch { /* ignore */ } info.textContent += ' 🏆 رقم قياسي'; }
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

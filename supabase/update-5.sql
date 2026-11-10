-- =====================================================================
--  تحديث 5: لعبة "تحدّي الكورة" ⚽ (10 أسئلة من 60 سؤال)
--  شغّله مرة وحدة في Supabase ← SQL Editor
-- =====================================================================

-- نسمح بنوع اللعبة الجديد
alter table public.games drop constraint if exists games_kind_check;
alter table public.games add constraint games_kind_check
  check (kind in ('xo', 'connect4', 'rps', 'dots', 'guess', 'quiz', 'football'));

-- بدء لعبة (نفس السابق + تحدّي الكورة)
create or replace function public.start_game(p_conv uuid, p_kind text, p_opponent uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); v_g uuid; v_state jsonb;
begin
  if v_me is null or not is_member(p_conv) then raise exception 'غير مسموح'; end if;
  if p_opponent = v_me or not exists (select 1 from conversation_members
                                      where conversation_id = p_conv and profile_id = p_opponent) then
    raise exception 'اختر لاعب من المحادثة';
  end if;
  v_state := case p_kind
    when 'xo' then jsonb_build_object('board', (select jsonb_agg(''::text) from generate_series(1, 9)),
                                      'order', jsonb_build_object('X', '[]'::jsonb, 'O', '[]'::jsonb))
    when 'connect4' then jsonb_build_object('board', (select jsonb_agg(''::text) from generate_series(1, 42)), 'resets', 0)
    when 'rps' then jsonb_build_object('round', 1, 'moves', '{}'::jsonb, 'score', '{}'::jsonb)
    when 'dots' then jsonb_build_object('h', (select jsonb_agg(''::text) from generate_series(1, 12)),
                                        'v', (select jsonb_agg(''::text) from generate_series(1, 12)),
                                        'boxes', (select jsonb_agg(''::text) from generate_series(1, 9)))
    when 'guess' then jsonb_build_object('history', '[]'::jsonb, 'low', 1, 'high', 100)
    when 'quiz' then jsonb_build_object('q', (select jsonb_agg(x) from (select x from generate_series(0, 39) x order by random() limit 7) s),
                                        'results', '{}'::jsonb)
    -- 60 سؤال كورة (أرقامها 0 إلى 59 في js/games.js) نختار منها 10
    when 'football' then jsonb_build_object('q', (select jsonb_agg(x) from (select x from generate_series(0, 59) x order by random() limit 10) s),
                                            'results', '{}'::jsonb)
  end;
  if v_state is null then raise exception 'لعبة غير معروفة'; end if;
  insert into games (conversation_id, kind, players, state, turn)
    values (p_conv, p_kind, array[v_me, p_opponent], v_state, case when p_kind in ('rps', 'quiz', 'football') then null else v_me end)
    returning id into v_g;
  if p_kind = 'guess' then
    insert into game_secrets (game_id, secret) values (v_g, 1 + floor(random() * 100)::int);
  end if;
  insert into messages (conversation_id, sender_id, kind, meta)
    values (p_conv, v_me, 'game', jsonb_build_object('game_id', v_g, 'game', p_kind, 'opponent', p_opponent));
  update conversations set last_message_at = now() where id = p_conv;
  return v_g;
end $$;

-- تسليم الإجابات (للأسئلة العامة وأسئلة الكورة)
create or replace function public.game_quiz(p_game uuid, p_score int, p_ms int)
returns void language plpgsql security definer set search_path = public as $$
declare g games; v_me uuid := me(); res jsonb; v_other uuid; a jsonb; b jsonb; w uuid; v_max int;
begin
  select * into g from games where id = p_game for update;
  if g.id is null or g.status <> 'active' or g.kind not in ('quiz', 'football') then raise exception 'اللعبة خلصت'; end if;
  if not (v_me = any (g.players)) then raise exception 'غير مسموح'; end if;
  v_max := coalesce(jsonb_array_length(g.state -> 'q'), 7);
  res := coalesce(g.state -> 'results', '{}'::jsonb);
  if res ? v_me::text then raise exception 'سلّمت إجاباتك خلاص'; end if;
  res := res || jsonb_build_object(v_me::text, jsonb_build_object('score', greatest(0, least(coalesce(p_score, 0), v_max)),
                                                                  'ms', greatest(0, coalesce(p_ms, 0))));
  v_other := (select x from unnest(g.players) x where x <> v_me limit 1);
  if res ? v_other::text then
    a := res -> v_me::text; b := res -> v_other::text;
    -- ما فيه تعادل: الأعلى نقاط، وإذا تساووا الأسرع
    w := case when (a ->> 'score')::int > (b ->> 'score')::int then v_me
              when (a ->> 'score')::int < (b ->> 'score')::int then v_other
              when (a ->> 'ms')::int < (b ->> 'ms')::int then v_me
              else v_other end;
    update games set state = jsonb_set(g.state, '{results}', res), winner = w, status = 'done', updated_at = now() where id = p_game;
  else
    update games set state = jsonb_set(g.state, '{results}', res), updated_at = now() where id = p_game;
  end if;
end $$;

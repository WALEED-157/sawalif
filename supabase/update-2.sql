-- =====================================================================
--  تحديث 2: فيديو مرتين (مثل السناب) + حذف الوسائط بعد 24 ساعة
--           + زر التنبيه + ألعاب جديدة بدون تعادل
--  شغّله مرة وحدة في SQL Editor بعد schema.sql (آمن لو انعاد تشغيله)
-- =====================================================================

-- مدة بقاء الصور والصوت والفيديو على السيرفر (غيّرها هنا لو تبي)
create or replace function public._media_ttl() returns interval
language sql immutable as $$ select interval '24 hours' $$;

-- أنواع جديدة
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'sticker', 'image', 'audio', 'video', 'game', 'system', 'buzz'));

alter table public.games drop constraint if exists games_kind_check;
alter table public.games add constraint games_kind_check
  check (kind in ('xo', 'connect4', 'rps', 'dots', 'guess', 'quiz'));

-- عدد مرات المشاهدة (الفيديو مرتين)
alter table public.message_views add column if not exists views int not null default 1;

-- الرقم السري للعبة "خمّن الرقم" (مخفي عن اللاعبين)
create table if not exists public.game_secrets (
  game_id uuid primary key references public.games(id) on delete cascade,
  secret int not null
);
alter table public.game_secrets enable row level security;

-- ---------- الوسائط: 24 ساعة ----------
create or replace function public.can_view_media(p_path text, p_owner text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from messages m
      where m.media_path = p_path and (
        can_monitor(m.conversation_id)
        or m.sender_id = me()
        or (is_member(m.conversation_id) and m.created_at < now() - _media_ttl())
        or (is_member(m.conversation_id) and exists (
              select 1 from message_views v
              where v.message_id = m.id and v.profile_id = me() and v.viewed_at > now() - interval '3 minutes'))))
    or (p_owner = auth.uid()::text and not exists (select 1 from messages m where m.media_path = p_path))
$$;

create or replace function public.can_delete_media(p_path text, p_owner text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from messages m
      where m.media_path = p_path and (
        can_monitor(m.conversation_id)
        or m.sender_id = me()
        or (is_member(m.conversation_id) and m.created_at < now() - _media_ttl())))
    or (p_owner = auth.uid()::text and not exists (select 1 from messages m where m.media_path = p_path))
$$;

create or replace function public.expired_media()
returns table (id uuid, media_path text)
language sql stable security definer set search_path = public as $$
  select m.id, m.media_path from messages m
  where m.media_path is not null and m.created_at < now() - _media_ttl() and can_read(m.conversation_id)
  limit 100
$$;

create or replace function public.mark_media_expired(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update messages set media_path = null, media_expired = true
  where id = any(p_ids) and created_at < now() - _media_ttl() and can_read(conversation_id)
$$;

-- الفيديو ينشاف مرتين، الصور والصوت مرة وحدة
create or replace function public.open_view_once(p_msg uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); m messages; v_max int; v_n int;
begin
  select * into m from messages where id = p_msg;
  if m.id is null or m.media_path is null then raise exception 'الملف غير متاح'; end if;
  if can_monitor(m.conversation_id) or m.sender_id = v_me then return m.media_path; end if;
  if not is_member(m.conversation_id) then raise exception 'غير مسموح'; end if;
  v_max := case when m.kind = 'video' then 2 else 1 end;
  select views into v_n from message_views where message_id = p_msg and profile_id = v_me;
  if v_n is null then
    insert into message_views (message_id, profile_id) values (p_msg, v_me);
  elsif v_n >= v_max then
    raise exception 'خلصت مرات المشاهدة 👀';
  else
    update message_views set views = views + 1, viewed_at = now() where message_id = p_msg and profile_id = v_me;
  end if;
  return m.media_path;
end $$;

-- ---------- إرسال الرسائل (مع زر التنبيه) ----------
create or replace function public.send_message(p_conv uuid, p_kind text, p_body text default null,
                                               p_media_path text default null, p_meta jsonb default '{}'::jsonb)
returns public.messages language plpgsql security definer set search_path = public as $$
declare v_me profiles; v_msg messages; v_other uuid; v_flag text; v_clean text; v_word text;
begin
  select * into v_me from profiles where auth_id = auth.uid();
  if v_me.id is null then raise exception 'سجّل الدخول أولاً'; end if;
  if not exists (select 1 from conversation_members where conversation_id = p_conv and profile_id = v_me.id) then
    raise exception 'لست عضواً في هذي المحادثة';
  end if;
  if p_kind not in ('text', 'sticker', 'image', 'audio', 'video', 'buzz') then raise exception 'نوع رسالة غير مدعوم'; end if;
  if v_me.muted then raise exception 'الإرسال موقوف مؤقتاً من الأهل 🔒'; end if;
  if v_me.role = 'child' and _in_quiet(v_me.quiet_start, v_me.quiet_end) then
    raise exception 'وقت الراحة 🌙 تقدر ترسل بعدين';
  end if;
  if (select kind from conversations where id = p_conv) = 'direct' then
    select profile_id into v_other from conversation_members where conversation_id = p_conv and profile_id <> v_me.id limit 1;
    if v_other is not null and not connected(v_me.id, v_other) then raise exception 'ما عدتوا أصدقاء'; end if;
  end if;
  if p_kind = 'buzz' and exists (select 1 from messages where conversation_id = p_conv and sender_id = v_me.id
                                 and kind = 'buzz' and created_at > now() - interval '30 seconds') then
    raise exception 'انتظر شوي قبل ما تنبّه مرة ثانية ⏳';
  end if;
  if p_kind = 'text' and btrim(coalesce(p_body, '')) = '' then raise exception 'الرسالة فاضية'; end if;
  if p_kind in ('image', 'audio', 'video') then
    if p_media_path is null or split_part(p_media_path, '/', 1) <> p_conv::text then raise exception 'ملف غير صالح'; end if;
  else
    p_media_path := null;
  end if;
  if p_kind <> 'text' then p_body := null; end if;

  if p_body is not null then
    v_clean := translate(regexp_replace(p_body, '[\s\-\.\(\)]', '', 'g'),
                         '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
    if v_clean ~ '[0-9]{9,}' then
      v_flag := 'رقم جوال أو رقم طويل';
    elsif p_body ~* '(https?://|www\.|\.com|\.net|\.org|t\.me|wa\.me|snapchat|snap|instagram|insta|tiktok|سناب|انستا|تيك ?توك|@[a-z0-9_.]{3,})' then
      v_flag := 'رابط أو حساب خارجي';
    else
      select b.word into v_word from blocked_words b
      where b.family_id in (select p.family_id from conversation_members m join profiles p on p.id = m.profile_id
                            where m.conversation_id = p_conv)
        and position(lower(b.word) in lower(p_body)) > 0
      limit 1;
      if v_word is not null then v_flag := 'كلمة: ' || v_word; end if;
    end if;
  end if;

  insert into messages (conversation_id, sender_id, kind, body, media_path, meta, view_once, flagged, flag_reason)
  values (p_conv, v_me.id, p_kind, nullif(left(p_body, 2000), ''), p_media_path, coalesce(p_meta, '{}'::jsonb),
          p_kind in ('image', 'audio', 'video'), v_flag is not null, v_flag)
  returning * into v_msg;
  update conversations set last_message_at = now() where id = p_conv;
  update conversation_members set last_read_at = now() where conversation_id = p_conv and profile_id = v_me.id;
  return v_msg;
end $$;

-- ---------- الألعاب ----------
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
  end;
  if v_state is null then raise exception 'لعبة غير معروفة'; end if;
  insert into games (conversation_id, kind, players, state, turn)
    values (p_conv, p_kind, array[v_me, p_opponent], v_state, case when p_kind in ('rps', 'quiz') then null else v_me end)
    returning id into v_g;
  if p_kind = 'guess' then
    insert into game_secrets (game_id, secret) values (v_g, 1 + floor(random() * 100)::int);
  end if;
  insert into messages (conversation_id, sender_id, kind, meta)
    values (p_conv, v_me, 'game', jsonb_build_object('game_id', v_g, 'game', p_kind, 'opponent', p_opponent));
  update conversations set last_message_at = now() where id = p_conv;
  return v_g;
end $$;

drop function if exists public.game_move(uuid, jsonb, uuid, boolean);
create or replace function public.game_move(p_game uuid, p_state jsonb, p_winner uuid, p_done boolean,
                                            p_keep_turn boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare g games; v_me uuid := me();
begin
  select * into g from games where id = p_game for update;
  if g.id is null or g.status <> 'active' then raise exception 'اللعبة خلصت'; end if;
  if g.kind not in ('xo', 'connect4', 'dots') then raise exception 'حركة غير صالحة'; end if;
  if g.turn is distinct from v_me then raise exception 'مو دورك ⏳'; end if;
  if g.kind in ('xo', 'connect4')
     and jsonb_array_length(p_state -> 'board') <> jsonb_array_length(g.state -> 'board') then
    raise exception 'حركة غير صالحة';
  end if;
  if g.kind = 'dots' and (jsonb_array_length(p_state -> 'h') <> 12 or jsonb_array_length(p_state -> 'boxes') <> 9) then
    raise exception 'حركة غير صالحة';
  end if;
  if p_winner is not null and not (p_winner = any (g.players)) then raise exception 'حركة غير صالحة'; end if;
  update games
    set state = p_state,
        turn = case when p_keep_turn and not p_done then v_me else (select x from unnest(g.players) x where x <> v_me limit 1) end,
        winner = p_winner,
        status = case when p_done then 'done' else 'active' end,
        updated_at = now()
  where id = p_game;
end $$;

create or replace function public.game_guess(p_game uuid, p_guess int)
returns void language plpgsql security definer set search_path = public as $$
declare g games; v_me uuid := me(); s int; hint text; hist jsonb; lo int; hi int;
begin
  select * into g from games where id = p_game for update;
  if g.id is null or g.status <> 'active' or g.kind <> 'guess' then raise exception 'اللعبة خلصت'; end if;
  if g.turn is distinct from v_me then raise exception 'مو دورك ⏳'; end if;
  if p_guess is null or p_guess < 1 or p_guess > 100 then raise exception 'اختر رقم من 1 إلى 100'; end if;
  select secret into s from game_secrets where game_id = p_game;
  hint := case when p_guess = s then 'hit' when p_guess < s then 'up' else 'down' end;
  lo := coalesce((g.state ->> 'low')::int, 1); hi := coalesce((g.state ->> 'high')::int, 100);
  if hint = 'up' then lo := greatest(lo, p_guess + 1); elsif hint = 'down' then hi := least(hi, p_guess - 1); end if;
  hist := coalesce(g.state -> 'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('by', v_me, 'n', p_guess, 'hint', hint));
  update games set
    state = jsonb_build_object('history', hist, 'low', lo, 'high', hi, 'secret', case when hint = 'hit' then s end),
    turn = case when hint = 'hit' then v_me else (select x from unnest(g.players) x where x <> v_me limit 1) end,
    winner = case when hint = 'hit' then v_me end,
    status = case when hint = 'hit' then 'done' else 'active' end,
    updated_at = now()
  where id = p_game;
end $$;

create or replace function public.game_quiz(p_game uuid, p_score int, p_ms int)
returns void language plpgsql security definer set search_path = public as $$
declare g games; v_me uuid := me(); res jsonb; v_other uuid; a jsonb; b jsonb; w uuid;
begin
  select * into g from games where id = p_game for update;
  if g.id is null or g.status <> 'active' or g.kind <> 'quiz' then raise exception 'اللعبة خلصت'; end if;
  if not (v_me = any (g.players)) then raise exception 'غير مسموح'; end if;
  res := coalesce(g.state -> 'results', '{}'::jsonb);
  if res ? v_me::text then raise exception 'سلّمت إجاباتك خلاص'; end if;
  res := res || jsonb_build_object(v_me::text, jsonb_build_object('score', greatest(0, least(coalesce(p_score, 0), 7)),
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

-- =====================================================================
--  سوالف العائلة — قاعدة البيانات (Supabase / PostgreSQL)
--  انسخ هذا الملف كاملاً في SQL Editor داخل Supabase واضغط Run مرة وحدة.
--  بعدها غيّر رمز التسجيل (آخر الملف).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) الجداول
-- ---------------------------------------------------------------------

-- إعدادات عامة: رمز التسجيل اللي يحتاجه أي أب/أم عشان ينشئ عائلة جديدة
create table if not exists public.app_config (
  id int primary key default 1 check (id = 1),
  signup_code text not null
);
insert into public.app_config (id, signup_code) values (1, 'CHANGE-ME-1234')
on conflict (id) do nothing;

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  invite_code text not null unique,          -- يعطيه الأب للأم (أو العكس) عشان ينضم
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique references auth.users(id) on delete set null,
  family_id uuid not null references public.families(id) on delete cascade,
  role text not null check (role in ('parent', 'child')),
  display_name text not null check (char_length(display_name) between 1 and 30),
  avatar text not null default '🙂',
  public_code text not null unique,          -- الرقم التعريفي (6 أرقام)
  muted boolean not null default false,      -- الأهل أوقفوا الإرسال
  quiet_start time,                          -- وقت الراحة (بداية)
  quiet_end time,                            -- وقت الراحة (نهاية)
  created_at timestamptz not null default now()
);
create index if not exists profiles_family_idx on public.profiles(family_id);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  title text,
  emoji text not null default '👥',
  created_by uuid references public.profiles(id) on delete set null,
  direct_key text unique,                    -- لمنع تكرار المحادثة الخاصة بين نفس الشخصين
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.families add column if not exists group_id uuid references public.conversations(id) on delete set null;

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);
create index if not exists members_profile_idx on public.conversation_members(profile_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('text', 'sticker', 'image', 'audio', 'video', 'game', 'system')),
  body text check (char_length(body) <= 2000),
  media_path text,
  meta jsonb not null default '{}'::jsonb,
  view_once boolean not null default false,
  media_expired boolean not null default false,
  flagged boolean not null default false,
  flag_reason text,
  flag_reviewed boolean not null default false,
  removed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages(conversation_id, created_at desc);
create index if not exists messages_media_idx on public.messages(media_path) where media_path is not null;

create table if not exists public.message_views (
  message_id uuid not null references public.messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (message_id, profile_id)
);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  from_ok boolean not null default false,    -- موافقة أهل المرسل
  to_ok boolean not null default false,      -- موافقة أهل المستقبل
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  unique (from_id, to_id)
);
create index if not exists fr_to_idx on public.friend_requests(to_id);

create table if not exists public.pairing_tokens (
  token text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null
);

create table if not exists public.blocked_words (
  id bigint generated always as identity primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  word text not null check (char_length(word) between 2 and 40),
  unique (family_id, word)
);

create table if not exists public.stickers (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  path text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  kind text not null check (kind in ('xo', 'connect4', 'rps')),
  players uuid[] not null,
  state jsonb not null,
  turn uuid,
  winner uuid,
  status text not null default 'active' check (status in ('active', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) دوال مساعدة
-- ---------------------------------------------------------------------

create or replace function public._rand_token(n int) returns text
language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (floor(random() * 32) + 1)::int, 1), '')
  from generate_series(1, n)
$$;

create or replace function public._new_public_code() returns text
language plpgsql volatile set search_path = public as $$
declare c text;
begin
  loop
    c := (100000 + floor(random() * 900000))::int::text;
    exit when not exists (select 1 from profiles where public_code = c);
  end loop;
  return c;
end $$;

create or replace function public._folder_uuid(p_name text) returns uuid
language sql immutable as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end
$$;

create or replace function public._in_quiet(qs time, qe time) returns boolean
language sql stable as $$
  select case
    when qs is null or qe is null or qs = qe then false
    when qs < qe then (now() at time zone 'Asia/Riyadh')::time >= qs and (now() at time zone 'Asia/Riyadh')::time < qe
    else (now() at time zone 'Asia/Riyadh')::time >= qs or (now() at time zone 'Asia/Riyadh')::time < qe
  end
$$;

create or replace function public.me() returns uuid
language sql stable security definer set search_path = public as $$
  select id from profiles where auth_id = auth.uid()
$$;

create or replace function public.my_family() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from profiles where auth_id = auth.uid()
$$;

create or replace function public.i_am_parent() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'parent' from profiles where auth_id = auth.uid()), false)
$$;

-- هل الشخصين مسموح لهم يتكلمون؟ (نفس العائلة أو أصدقاء موافَق عليهم)
create or replace function public.connected(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select a = b
    or exists (select 1 from profiles p1 join profiles p2 on p1.family_id = p2.family_id
               where p1.id = a and p2.id = b)
    or exists (select 1 from friend_requests r where r.status = 'accepted'
               and ((r.from_id = a and r.to_id = b) or (r.from_id = b and r.to_id = a)))
$$;

create or replace function public.is_member(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversation_members m
                 where m.conversation_id = c and m.profile_id = (select id from profiles where auth_id = auth.uid()))
$$;

-- ولي أمر وأحد أطفاله موجود في المحادثة → يقدر يراقبها
create or replace function public.can_monitor(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles me_p
    join profiles k on k.family_id = me_p.family_id and k.role = 'child'
    join conversation_members m on m.profile_id = k.id and m.conversation_id = c
    where me_p.auth_id = auth.uid() and me_p.role = 'parent')
$$;

create or replace function public.can_read(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member(c) or public.can_monitor(c)
$$;

-- صلاحية فتح ملف وسائط (مرة وحدة للطفل، دائماً للأهل خلال 7 أيام)
create or replace function public.can_view_media(p_path text, p_owner text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from messages m
      where m.media_path = p_path and (
        can_monitor(m.conversation_id)
        or m.sender_id = me()
        or (is_member(m.conversation_id) and m.created_at < now() - interval '7 days')
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
        or (is_member(m.conversation_id) and m.created_at < now() - interval '7 days')))
    or (p_owner = auth.uid()::text and not exists (select 1 from messages m where m.media_path = p_path))
$$;

-- ---------------------------------------------------------------------
-- 3) الحسابات والعائلة
-- ---------------------------------------------------------------------

create or replace function public.my_profile() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', p.id, 'name', p.display_name, 'avatar', p.avatar, 'role', p.role, 'code', p.public_code,
    'muted', p.muted, 'quiet_start', p.quiet_start, 'quiet_end', p.quiet_end,
    'in_quiet', p.role = 'child' and _in_quiet(p.quiet_start, p.quiet_end),
    'family_id', f.id, 'family_name', f.name, 'family_group', f.group_id,
    'invite_code', case when p.role = 'parent' then f.invite_code end)
  from profiles p join families f on f.id = p.family_id
  where p.auth_id = auth.uid()
$$;

create or replace function public.create_family(p_signup_code text, p_family_name text, p_name text, p_avatar text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_f uuid; v_p uuid; v_c uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'سجّل بالإيميل أولاً';
  end if;
  if me() is not null then raise exception 'عندك حساب عائلة من قبل'; end if;
  if not exists (select 1 from app_config where signup_code = btrim(p_signup_code)) then
    raise exception 'رمز التسجيل غير صحيح';
  end if;
  if btrim(coalesce(p_family_name, '')) = '' or btrim(coalesce(p_name, '')) = '' then
    raise exception 'اكتب اسم العائلة واسمك';
  end if;

  insert into families (name, invite_code) values (left(btrim(p_family_name), 40), _rand_token(8)) returning id into v_f;
  insert into profiles (auth_id, family_id, role, display_name, avatar, public_code)
    values (auth.uid(), v_f, 'parent', left(btrim(p_name), 30), coalesce(nullif(p_avatar, ''), '🙂'), _new_public_code())
    returning id into v_p;
  insert into conversations (kind, title, emoji, created_by) values ('group', left(btrim(p_family_name), 40), '🏠', v_p)
    returning id into v_c;
  update families set group_id = v_c where id = v_f;
  insert into conversation_members (conversation_id, profile_id) values (v_c, v_p);
  insert into messages (conversation_id, sender_id, kind, body) values (v_c, v_p, 'system', 'تم إنشاء قروب العائلة 🏠');
  insert into blocked_words (family_id, word)
    select v_f, w from unnest(array['غبي', 'حمار', 'تافه', 'اخرس', 'وصخ', 'كذاب', 'يا كلب', 'انقلع', 'ملعون']) w;
  return v_p;
end $$;

create or replace function public.join_family(p_invite_code text, p_name text, p_avatar text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_f families; v_p uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'سجّل بالإيميل أولاً';
  end if;
  if me() is not null then raise exception 'عندك حساب عائلة من قبل'; end if;
  select * into v_f from families where invite_code = upper(btrim(p_invite_code));
  if v_f.id is null then raise exception 'رمز العائلة غير صحيح'; end if;
  if (select count(*) from profiles where family_id = v_f.id and role = 'parent') >= 4 then
    raise exception 'العائلة فيها عدد كافي من أولياء الأمور';
  end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'اكتب اسمك'; end if;

  insert into profiles (auth_id, family_id, role, display_name, avatar, public_code)
    values (auth.uid(), v_f.id, 'parent', left(btrim(p_name), 30), coalesce(nullif(p_avatar, ''), '🙂'), _new_public_code())
    returning id into v_p;
  if v_f.group_id is not null then
    insert into conversation_members (conversation_id, profile_id) values (v_f.group_id, v_p) on conflict do nothing;
    insert into messages (conversation_id, sender_id, kind, body)
      values (v_f.group_id, v_p, 'system', 'انضم ' || left(btrim(p_name), 30) || ' للعائلة 🎉');
  end if;
  return v_p;
end $$;

create or replace function public.update_profile(p_name text, p_avatar text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if btrim(coalesce(p_name, '')) = '' then raise exception 'الاسم فاضي'; end if;
  update profiles set display_name = left(btrim(p_name), 30), avatar = coalesce(nullif(p_avatar, ''), avatar)
  where auth_id = auth.uid();
end $$;

create or replace function public.family_members()
returns table (id uuid, name text, avatar text, role text, public_code text, muted boolean,
               quiet_start time, quiet_end time, paired boolean, is_me boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.avatar, p.role, p.public_code, p.muted, p.quiet_start, p.quiet_end,
         p.auth_id is not null, coalesce(p.auth_id = auth.uid(), false)
  from profiles p
  where p.family_id = (select family_id from profiles where auth_id = auth.uid())
  order by (p.role = 'parent') desc, p.created_at
$$;

create or replace function public.create_child(p_name text, p_avatar text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me profiles; v_c uuid; v_g uuid;
begin
  select * into v_me from profiles where auth_id = auth.uid();
  if v_me.id is null or v_me.role <> 'parent' then raise exception 'هذي الخاصية للأهل فقط'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'اكتب اسم الطفل'; end if;
  if (select count(*) from profiles where family_id = v_me.family_id and role = 'child') >= 12 then
    raise exception 'وصلت الحد الأعلى للأطفال';
  end if;
  insert into profiles (auth_id, family_id, role, display_name, avatar, public_code)
    values (null, v_me.family_id, 'child', left(btrim(p_name), 30), coalesce(nullif(p_avatar, ''), '🙂'), _new_public_code())
    returning id into v_c;
  select group_id into v_g from families where id = v_me.family_id;
  if v_g is not null then
    insert into conversation_members (conversation_id, profile_id) values (v_g, v_c) on conflict do nothing;
    insert into messages (conversation_id, sender_id, kind, body)
      values (v_g, v_c, 'system', 'انضم ' || left(btrim(p_name), 30) || ' للعائلة 🎉');
    update conversations set last_message_at = now() where id = v_g;
  end if;
  return v_c;
end $$;

create or replace function public.update_child(p_child uuid, p_name text, p_avatar text, p_muted boolean,
                                               p_quiet_start time, p_quiet_end time)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles me_p join profiles k on k.family_id = me_p.family_id
                 where me_p.auth_id = auth.uid() and me_p.role = 'parent' and k.id = p_child and k.role = 'child') then
    raise exception 'غير مسموح';
  end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'الاسم فاضي'; end if;
  update profiles set display_name = left(btrim(p_name), 30), avatar = coalesce(nullif(p_avatar, ''), avatar),
         muted = coalesce(p_muted, false), quiet_start = p_quiet_start, quiet_end = p_quiet_end
  where id = p_child;
end $$;

-- كود QR لدخول الطفل (يستخدم مرة وحدة وينتهي بعد 15 دقيقة)
create or replace function public.create_pairing(p_child uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_t text;
begin
  if not exists (select 1 from profiles me_p join profiles k on k.family_id = me_p.family_id
                 where me_p.auth_id = auth.uid() and me_p.role = 'parent' and k.id = p_child and k.role = 'child') then
    raise exception 'غير مسموح';
  end if;
  delete from pairing_tokens where profile_id = p_child or expires_at < now();
  v_t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into pairing_tokens (token, profile_id, expires_at) values (v_t, p_child, now() + interval '15 minutes');
  return v_t;
end $$;

create or replace function public.claim_pairing(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare t pairing_tokens;
begin
  if auth.uid() is null then raise exception 'صار خطأ في الدخول'; end if;
  if not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'هذا الجهاز مسجّل عليه حساب ولي أمر، سجّل خروج أولاً';
  end if;
  select * into t from pairing_tokens where token = p_token and expires_at > now();
  if t.token is null then raise exception 'الكود منتهي أو مستخدم، اطلب كود جديد من أهلك'; end if;
  if exists (select 1 from profiles where auth_id = auth.uid() and id <> t.profile_id) then
    raise exception 'هذا الجهاز مسجّل بحساب ثاني، سجّل خروج أولاً';
  end if;
  update profiles set auth_id = auth.uid() where id = t.profile_id;   -- الجهاز القديم يطلع تلقائياً
  delete from pairing_tokens where token = p_token;
  return t.profile_id;
end $$;

create or replace function public.unpair_child(p_child uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles me_p join profiles k on k.family_id = me_p.family_id
                 where me_p.auth_id = auth.uid() and me_p.role = 'parent' and k.id = p_child and k.role = 'child') then
    raise exception 'غير مسموح';
  end if;
  update profiles set auth_id = null where id = p_child;
end $$;

-- ---------------------------------------------------------------------
-- 4) الأصدقاء (الإضافة بالرقم التعريفي + موافقة أهل الطرفين)
-- ---------------------------------------------------------------------

create or replace function public.send_friend_request(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me profiles; v_t profiles; v_ex friend_requests;
begin
  select * into v_me from profiles where auth_id = auth.uid();
  if v_me.id is null then raise exception 'سجّل الدخول أولاً'; end if;
  if (select count(*) from friend_requests where from_id = v_me.id and created_at > now() - interval '1 day') >= 15 then
    raise exception 'وصلت الحد اليومي للطلبات، حاول بكرة';
  end if;
  select * into v_t from profiles where public_code = btrim(p_code);
  if v_t.id is null then raise exception 'ما لقينا أحد بهذا الرقم 🤔'; end if;
  if v_t.family_id = v_me.family_id then raise exception 'هذا من عائلتك، موجود عندك أصلاً 😊'; end if;
  select * into v_ex from friend_requests
    where (from_id = v_me.id and to_id = v_t.id) or (from_id = v_t.id and to_id = v_me.id);
  if v_ex.id is not null then
    if v_ex.status = 'accepted' then raise exception 'أنتم أصدقاء من قبل 👍'; end if;
    if v_ex.status = 'rejected' then raise exception 'الطلب هذا رفضه الأهل من قبل'; end if;
    raise exception 'فيه طلب سابق بينكم ينتظر موافقة الأهل ⏳';
  end if;
  insert into friend_requests (from_id, to_id, from_ok) values (v_me.id, v_t.id, v_me.role = 'parent');
  return json_build_object('name', v_t.display_name, 'avatar', v_t.avatar);
end $$;

create or replace function public.respond_friend_request(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_me profiles; r friend_requests; fa uuid; fb uuid;
begin
  select * into v_me from profiles where auth_id = auth.uid();
  if v_me.id is null or v_me.role <> 'parent' then raise exception 'الموافقة للأهل فقط'; end if;
  select * into r from friend_requests where id = p_id for update;
  if r.id is null or r.status <> 'pending' then raise exception 'الطلب غير متاح'; end if;
  select family_id into fa from profiles where id = r.from_id;
  select family_id into fb from profiles where id = r.to_id;
  if v_me.family_id <> fa and v_me.family_id <> fb then raise exception 'غير مسموح'; end if;
  if not p_approve then
    update friend_requests set status = 'rejected' where id = p_id;
    return;
  end if;
  if v_me.family_id = fa then r.from_ok := true; end if;
  if v_me.family_id = fb then r.to_ok := true; end if;
  update friend_requests
    set from_ok = r.from_ok, to_ok = r.to_ok,
        status = case when r.from_ok and r.to_ok then 'accepted' else 'pending' end
  where id = p_id;
end $$;

create or replace function public.remove_friend(p_req uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me profiles; r friend_requests;
begin
  select * into v_me from profiles where auth_id = auth.uid();
  select * into r from friend_requests where id = p_req;
  if r.id is null then return; end if;
  if not (v_me.id in (r.from_id, r.to_id)
          or (v_me.role = 'parent' and exists (select 1 from profiles p where p.id in (r.from_id, r.to_id)
                                               and p.family_id = v_me.family_id))) then
    raise exception 'غير مسموح';
  end if;
  delete from friend_requests where id = p_req;
end $$;

create or replace function public.my_requests()
returns table (id uuid, from_id uuid, from_name text, from_avatar text, from_family text,
               to_id uuid, to_name text, to_avatar text, to_family text,
               from_ok boolean, to_ok boolean, status text, created_at timestamptz,
               can_approve boolean, involves_me boolean, from_mine boolean, to_mine boolean)
language sql stable security definer set search_path = public as $$
  with mep as (select * from profiles where auth_id = auth.uid())
  select r.id, a.id, a.display_name, a.avatar, fa.name, b.id, b.display_name, b.avatar, fb.name,
         r.from_ok, r.to_ok, r.status, r.created_at,
         (r.status = 'pending' and mep.role = 'parent'
            and ((a.family_id = mep.family_id and not r.from_ok) or (b.family_id = mep.family_id and not r.to_ok))),
         (mep.id in (a.id, b.id)),
         a.family_id = mep.family_id,
         b.family_id = mep.family_id
  from mep
  cross join friend_requests r
  join profiles a on a.id = r.from_id join families fa on fa.id = a.family_id
  join profiles b on b.id = r.to_id join families fb on fb.id = b.family_id
  where mep.id in (r.from_id, r.to_id)
     or (mep.role = 'parent' and mep.family_id in (a.family_id, b.family_id))
  order by r.created_at desc
$$;

create or replace function public.my_contacts()
returns table (id uuid, name text, avatar text, role text, family text, same_family boolean)
language sql stable security definer set search_path = public as $$
  with mep as (select * from profiles where auth_id = auth.uid())
  select p.id, p.display_name, p.avatar, p.role, f.name, p.family_id = mep.family_id
  from mep
  cross join profiles p
  join families f on f.id = p.family_id
  where p.id <> mep.id
    and (p.family_id = mep.family_id
         or exists (select 1 from friend_requests r where r.status = 'accepted'
                    and ((r.from_id = mep.id and r.to_id = p.id) or (r.to_id = mep.id and r.from_id = p.id))))
  order by (p.family_id = mep.family_id) desc, p.display_name
$$;

-- ---------------------------------------------------------------------
-- 5) المحادثات والقروبات
-- ---------------------------------------------------------------------

create or replace function public.start_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); v_key text; v_id uuid;
begin
  if v_me is null then raise exception 'سجّل الدخول أولاً'; end if;
  if p_other = v_me or not connected(v_me, p_other) then raise exception 'لازم تكونون أصدقاء أولاً'; end if;
  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);
  select c.id into v_id from conversations c where c.direct_key = v_key;
  if v_id is null then
    insert into conversations (kind, created_by, direct_key, emoji) values ('direct', v_me, v_key, '💬') returning id into v_id;
    insert into conversation_members (conversation_id, profile_id) values (v_id, v_me), (v_id, p_other);
  end if;
  return v_id;
end $$;

create or replace function public.create_group(p_title text, p_emoji text, p_members uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); v_all uuid[]; a uuid; b uuid; na text; nb text; v_id uuid;
begin
  if v_me is null then raise exception 'سجّل الدخول أولاً'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'اكتب اسم القروب'; end if;
  v_all := array(select distinct x from unnest(coalesce(p_members, '{}') || v_me) x);
  if coalesce(array_length(v_all, 1), 0) < 2 then raise exception 'اختر عضو واحد على الأقل'; end if;
  if array_length(v_all, 1) > 30 then raise exception 'القروب ما يتعدى 30 عضو'; end if;
  foreach a in array v_all loop
    foreach b in array v_all loop
      if a < b and not connected(a, b) then
        select display_name into na from profiles where id = a;
        select display_name into nb from profiles where id = b;
        raise exception 'كل أعضاء القروب لازم يكونون أصدقاء: % و % مو أصدقاء', na, nb;
      end if;
    end loop;
  end loop;
  insert into conversations (kind, title, emoji, created_by)
    values ('group', left(btrim(p_title), 40), coalesce(nullif(p_emoji, ''), '👥'), v_me) returning id into v_id;
  insert into conversation_members (conversation_id, profile_id) select v_id, x from unnest(v_all) x;
  insert into messages (conversation_id, sender_id, kind, body)
    values (v_id, v_me, 'system', 'تم إنشاء القروب بواسطة ' || (select display_name from profiles where id = v_me) || ' 🎉');
  return v_id;
end $$;

create or replace function public.add_group_member(p_conv uuid, p_profile uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); x uuid; n text;
begin
  if not is_member(p_conv) then raise exception 'لست عضواً في القروب'; end if;
  if (select kind from conversations where id = p_conv) <> 'group' then raise exception 'هذي محادثة خاصة'; end if;
  if exists (select 1 from conversation_members where conversation_id = p_conv and profile_id = p_profile) then return; end if;
  for x in select profile_id from conversation_members where conversation_id = p_conv loop
    if not connected(x, p_profile) then
      select display_name into n from profiles where id = x;
      raise exception 'ما نقدر نضيفه: لازم يكون صديق لـ % أولاً', n;
    end if;
  end loop;
  insert into conversation_members (conversation_id, profile_id) values (p_conv, p_profile);
  insert into messages (conversation_id, sender_id, kind, body)
    values (p_conv, v_me, 'system', 'تمت إضافة ' || (select display_name from profiles where id = p_profile) || ' 👋');
  update conversations set last_message_at = now() where id = p_conv;
end $$;

create or replace function public.leave_group(p_conv uuid, p_profile uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_me profiles; v_t uuid; v_name text;
begin
  select * into v_me from profiles where auth_id = auth.uid();
  v_t := coalesce(p_profile, v_me.id);
  if v_t <> v_me.id and not (v_me.role = 'parent'
       and exists (select 1 from profiles where id = v_t and family_id = v_me.family_id)) then
    raise exception 'غير مسموح';
  end if;
  if (select kind from conversations where id = p_conv) <> 'group' then raise exception 'ما تقدر تطلع من محادثة خاصة'; end if;
  select display_name into v_name from profiles where id = v_t;
  delete from conversation_members where conversation_id = p_conv and profile_id = v_t;
  insert into messages (conversation_id, sender_id, kind, body)
    values (p_conv, v_t, 'system', case when v_t = v_me.id then v_name || ' طلع من القروب'
                                        else v_name || ' طلّعه ' || v_me.display_name || ' من القروب' end);
end $$;

create or replace function public.my_conversations(p_for uuid default null)
returns table (id uuid, kind text, title text, emoji text, last_message_at timestamptz,
               preview text, preview_kind text, unread int,
               other_id uuid, other_name text, other_avatar text, member_count int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_me profiles; v_target uuid;
begin
  select * into v_me from profiles where auth_id = auth.uid();
  if v_me.id is null then return; end if;
  v_target := coalesce(p_for, v_me.id);
  if v_target <> v_me.id and not (v_me.role = 'parent'
       and exists (select 1 from profiles p where p.id = v_target and p.family_id = v_me.family_id)) then
    raise exception 'غير مسموح';
  end if;
  return query
  select c.id, c.kind, c.title, c.emoji, c.last_message_at,
         lm.body, lm.kind,
         (select count(*)::int from messages x
          where x.conversation_id = c.id and x.created_at > cm.last_read_at
            and x.sender_id is distinct from v_target and x.kind <> 'system'),
         o.id, o.display_name, o.avatar,
         (select count(*)::int from conversation_members z where z.conversation_id = c.id)
  from conversation_members cm
  join conversations c on c.id = cm.conversation_id
  left join lateral (select m.body, m.kind from messages m where m.conversation_id = c.id
                     order by m.created_at desc limit 1) lm on true
  left join lateral (select p.id, p.display_name, p.avatar from conversation_members m2
                     join profiles p on p.id = m2.profile_id
                     where m2.conversation_id = c.id and m2.profile_id <> v_target and c.kind = 'direct'
                     limit 1) o on true
  where cm.profile_id = v_target
  order by c.last_message_at desc;
end $$;

create or replace function public.conversation_info(p_conv uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  if not can_read(p_conv) then raise exception 'ما عندك صلاحية لهذي المحادثة'; end if;
  select json_build_object(
    'id', c.id, 'kind', c.kind, 'title', c.title, 'emoji', c.emoji,
    'is_member', is_member(c.id), 'monitor', can_monitor(c.id),
    'members', (select coalesce(json_agg(json_build_object(
                    'id', p.id, 'name', p.display_name, 'avatar', p.avatar, 'role', p.role,
                    'family', f.name, 'family_id', p.family_id) order by p.display_name), '[]'::json)
                from conversation_members m join profiles p on p.id = m.profile_id
                join families f on f.id = p.family_id where m.conversation_id = c.id))
  into r from conversations c where c.id = p_conv;
  return r;
end $$;

create or replace function public.mark_read(p_conv uuid)
returns void language sql security definer set search_path = public as $$
  update conversation_members set last_read_at = now()
  where conversation_id = p_conv and profile_id = (select id from profiles where auth_id = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- 6) الرسائل
-- ---------------------------------------------------------------------

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
  if p_kind not in ('text', 'sticker', 'image', 'audio', 'video') then raise exception 'نوع رسالة غير مدعوم'; end if;
  if v_me.muted then raise exception 'الإرسال موقوف مؤقتاً من الأهل 🔒'; end if;
  if v_me.role = 'child' and _in_quiet(v_me.quiet_start, v_me.quiet_end) then
    raise exception 'وقت الراحة 🌙 تقدر ترسل بعدين';
  end if;
  if (select kind from conversations where id = p_conv) = 'direct' then
    select profile_id into v_other from conversation_members where conversation_id = p_conv and profile_id <> v_me.id limit 1;
    if v_other is not null and not connected(v_me.id, v_other) then raise exception 'ما عدتوا أصدقاء'; end if;
  end if;
  if p_kind = 'text' and btrim(coalesce(p_body, '')) = '' then raise exception 'الرسالة فاضية'; end if;
  if p_kind in ('image', 'audio', 'video') then
    if p_media_path is null or split_part(p_media_path, '/', 1) <> p_conv::text then raise exception 'ملف غير صالح'; end if;
  else
    p_media_path := null;
  end if;
  if p_kind <> 'text' then p_body := null; end if;

  -- فحص بسيط: أرقام جوالات، روابط وحسابات، كلمات محظورة
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

-- فتح وسائط "مرة وحدة": يسجل المشاهدة ويرجع مسار الملف
create or replace function public.open_view_once(p_msg uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); m messages;
begin
  select * into m from messages where id = p_msg;
  if m.id is null or m.media_path is null then raise exception 'الملف غير متاح'; end if;
  if can_monitor(m.conversation_id) or m.sender_id = v_me then return m.media_path; end if;
  if not is_member(m.conversation_id) then raise exception 'غير مسموح'; end if;
  if exists (select 1 from message_views where message_id = p_msg and profile_id = v_me) then
    raise exception 'شفته من قبل 👀 ينشاف مرة وحدة بس';
  end if;
  insert into message_views (message_id, profile_id) values (p_msg, v_me);
  return m.media_path;
end $$;

create or replace function public.remove_message(p_msg uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m messages;
begin
  select * into m from messages where id = p_msg;
  if m.id is null then raise exception 'الرسالة غير موجودة'; end if;
  if not (m.sender_id = me() or can_monitor(m.conversation_id)) then raise exception 'غير مسموح'; end if;
  update messages set body = null, media_path = null, meta = '{}'::jsonb, removed_by = me() where id = p_msg;
end $$;

-- تنظيف الوسائط الأقدم من 7 أيام (يشغّله التطبيق تلقائياً عند الأهل)
create or replace function public.expired_media()
returns table (id uuid, media_path text)
language sql stable security definer set search_path = public as $$
  select m.id, m.media_path from messages m
  where m.media_path is not null and m.created_at < now() - interval '7 days' and can_read(m.conversation_id)
  limit 100
$$;

create or replace function public.mark_media_expired(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update messages set media_path = null, media_expired = true
  where id = any(p_ids) and created_at < now() - interval '7 days' and can_read(conversation_id)
$$;

create or replace function public.family_alerts()
returns table (id uuid, conversation_id uuid, conv_title text, sender_name text, sender_avatar text,
               body text, reason text, created_at timestamptz, reviewed boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.conversation_id,
         coalesce(c.title, (select string_agg(pp.display_name, ' و ') from conversation_members x
                            join profiles pp on pp.id = x.profile_id where x.conversation_id = c.id)),
         p.display_name, p.avatar, m.body, m.flag_reason, m.created_at, m.flag_reviewed
  from messages m
  join conversations c on c.id = m.conversation_id
  left join profiles p on p.id = m.sender_id
  where m.flagged and m.removed_by is null and m.created_at > now() - interval '30 days'
    and can_monitor(m.conversation_id)
  order by m.created_at desc
  limit 100
$$;

create or replace function public.review_alert(p_msg uuid)
returns void language sql security definer set search_path = public as $$
  update messages set flag_reviewed = true where id = p_msg and can_monitor(conversation_id)
$$;

-- ---------------------------------------------------------------------
-- 7) الألعاب
-- ---------------------------------------------------------------------

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
    when 'xo' then jsonb_build_object('board', (select jsonb_agg(''::text) from generate_series(1, 9)))
    when 'connect4' then jsonb_build_object('board', (select jsonb_agg(''::text) from generate_series(1, 42)))
    when 'rps' then jsonb_build_object('round', 1, 'moves', '{}'::jsonb, 'score', '{}'::jsonb)
  end;
  if v_state is null then raise exception 'لعبة غير معروفة'; end if;
  insert into games (conversation_id, kind, players, state, turn)
    values (p_conv, p_kind, array[v_me, p_opponent], v_state, case when p_kind = 'rps' then null else v_me end)
    returning id into v_g;
  insert into messages (conversation_id, sender_id, kind, meta)
    values (p_conv, v_me, 'game', jsonb_build_object('game_id', v_g, 'game', p_kind, 'opponent', p_opponent));
  update conversations set last_message_at = now() where id = p_conv;
  return v_g;
end $$;

create or replace function public.game_move(p_game uuid, p_state jsonb, p_winner uuid, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
declare g games; v_me uuid := me();
begin
  select * into g from games where id = p_game for update;
  if g.id is null or g.status <> 'active' then raise exception 'اللعبة خلصت'; end if;
  if g.kind = 'rps' then raise exception 'حركة غير صالحة'; end if;
  if g.turn is distinct from v_me then raise exception 'مو دورك ⏳'; end if;
  if jsonb_array_length(p_state -> 'board') <> jsonb_array_length(g.state -> 'board') then
    raise exception 'حركة غير صالحة';
  end if;
  if p_winner is not null and not (p_winner = any (g.players)) then raise exception 'حركة غير صالحة'; end if;
  update games
    set state = p_state,
        turn = (select x from unnest(g.players) x where x <> v_me limit 1),
        winner = p_winner,
        status = case when p_done then 'done' else 'active' end,
        updated_at = now()
  where id = p_game;
end $$;

create or replace function public.game_rps(p_game uuid, p_choice text)
returns void language plpgsql security definer set search_path = public as $$
declare g games; v_me uuid := me(); v_other uuid; mv jsonb; a text; b text; sc jsonb; res uuid; pts int;
begin
  select * into g from games where id = p_game for update;
  if g.id is null or g.status <> 'active' or g.kind <> 'rps' then raise exception 'اللعبة خلصت'; end if;
  if not (v_me = any (g.players)) then raise exception 'غير مسموح'; end if;
  if p_choice not in ('rock', 'paper', 'scissors') then raise exception 'اختيار غير صالح'; end if;
  mv := coalesce(g.state -> 'moves', '{}'::jsonb);
  if mv ? v_me::text then raise exception 'اخترت خلاص، انتظر صاحبك ⏳'; end if;
  mv := mv || jsonb_build_object(v_me::text, p_choice);
  v_other := (select x from unnest(g.players) x where x <> v_me limit 1);
  if mv ? v_other::text then
    a := p_choice; b := mv ->> v_other::text;
    res := case when a = b then null
                when (a = 'rock' and b = 'scissors') or (a = 'paper' and b = 'rock') or (a = 'scissors' and b = 'paper') then v_me
                else v_other end;
    sc := coalesce(g.state -> 'score', '{}'::jsonb);
    pts := 0;
    if res is not null then
      pts := coalesce((sc ->> res::text)::int, 0) + 1;
      sc := sc || jsonb_build_object(res::text, pts);
    end if;
    update games set
      state = jsonb_build_object('round', coalesce((g.state ->> 'round')::int, 1) + 1, 'moves', '{}'::jsonb, 'score', sc,
                                 'last', jsonb_build_object(v_me::text, a, v_other::text, b, 'winner', res)),
      winner = case when pts >= 3 then res end,
      status = case when pts >= 3 then 'done' else 'active' end,
      updated_at = now()
    where id = p_game;
  else
    update games set state = jsonb_set(g.state, '{moves}', mv), updated_at = now() where id = p_game;
  end if;
end $$;

create or replace function public.my_games()
returns table (id uuid, kind text, status text, turn uuid, winner uuid, updated_at timestamptz,
               opponent_name text, opponent_avatar text)
language sql stable security definer set search_path = public as $$
  select g.id, g.kind, g.status, g.turn, g.winner, g.updated_at, p.display_name, p.avatar
  from games g
  left join profiles p on p.id = (select x from unnest(g.players) x where x <> me() limit 1)
  where me() = any (g.players)
  order by g.updated_at desc
  limit 30
$$;

-- ---------------------------------------------------------------------
-- 8) الحماية (Row Level Security)
-- ---------------------------------------------------------------------

alter table public.app_config enable row level security;
alter table public.families enable row level security;
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_views enable row level security;
alter table public.friend_requests enable row level security;
alter table public.pairing_tokens enable row level security;
alter table public.blocked_words enable row level security;
alter table public.stickers enable row level security;
alter table public.games enable row level security;

drop policy if exists "own family" on public.families;
create policy "own family" on public.families for select to authenticated using (id = public.my_family());

drop policy if exists "family profiles" on public.profiles;
create policy "family profiles" on public.profiles for select to authenticated using (family_id = public.my_family());

drop policy if exists "read conversations" on public.conversations;
create policy "read conversations" on public.conversations for select to authenticated using (public.can_read(id));

drop policy if exists "read members" on public.conversation_members;
create policy "read members" on public.conversation_members for select to authenticated using (public.can_read(conversation_id));

drop policy if exists "read messages" on public.messages;
create policy "read messages" on public.messages for select to authenticated using (public.can_read(conversation_id));

drop policy if exists "read views" on public.message_views;
create policy "read views" on public.message_views for select to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id and public.can_read(m.conversation_id)));

drop policy if exists "read requests" on public.friend_requests;
create policy "read requests" on public.friend_requests for select to authenticated using (
  from_id = public.me() or to_id = public.me()
  or (public.i_am_parent() and exists (select 1 from public.profiles p where p.id in (from_id, to_id)
                                       and p.family_id = public.my_family())));

drop policy if exists "words read" on public.blocked_words;
create policy "words read" on public.blocked_words for select to authenticated
  using (family_id = public.my_family() and public.i_am_parent());
drop policy if exists "words add" on public.blocked_words;
create policy "words add" on public.blocked_words for insert to authenticated
  with check (family_id = public.my_family() and public.i_am_parent());
drop policy if exists "words delete" on public.blocked_words;
create policy "words delete" on public.blocked_words for delete to authenticated
  using (family_id = public.my_family() and public.i_am_parent());

drop policy if exists "stickers read" on public.stickers;
create policy "stickers read" on public.stickers for select to authenticated using (family_id = public.my_family());
drop policy if exists "stickers add" on public.stickers;
create policy "stickers add" on public.stickers for insert to authenticated
  with check (family_id = public.my_family() and created_by = public.me());
drop policy if exists "stickers delete" on public.stickers;
create policy "stickers delete" on public.stickers for delete to authenticated
  using (family_id = public.my_family() and (public.i_am_parent() or created_by = public.me()));

drop policy if exists "read games" on public.games;
create policy "read games" on public.games for select to authenticated using (public.can_read(conversation_id));

-- ---------------------------------------------------------------------
-- 9) التخزين (الصور والصوت والفيديو + الملصقات)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 20971520, array['image/*', 'audio/*', 'video/*'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stickers', 'stickers', true, 524288, array['image/*'])
on conflict (id) do nothing;

drop policy if exists "media upload" on storage.objects;
create policy "media upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_member(public._folder_uuid(name)));

drop policy if exists "media read" on storage.objects;
create policy "media read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.can_view_media(name, owner_id));

drop policy if exists "media delete" on storage.objects;
create policy "media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.can_delete_media(name, owner_id));

drop policy if exists "stickers upload" on storage.objects;
create policy "stickers upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'stickers' and split_part(name, '/', 1) = public.my_family()::text);

drop policy if exists "stickers read obj" on storage.objects;
create policy "stickers read obj" on storage.objects for select to authenticated
  using (bucket_id = 'stickers' and split_part(name, '/', 1) = public.my_family()::text);

drop policy if exists "stickers delete obj" on storage.objects;
create policy "stickers delete obj" on storage.objects for delete to authenticated
  using (bucket_id = 'stickers' and split_part(name, '/', 1) = public.my_family()::text);

-- ---------------------------------------------------------------------
-- 10) التحديث الفوري (Realtime)
-- ---------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.games; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.message_views; exception when duplicate_object then null; end;
end $$;

-- =====================================================================
--  ⚠️ مهم: غيّر رمز التسجيل لكلمة سرية تعطيها للعوائل فقط:
--  update public.app_config set signup_code = 'اكتب-رمزك-هنا';
-- =====================================================================

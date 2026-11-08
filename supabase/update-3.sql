-- =====================================================================
--  تحديث 3: إشعارات Push حقيقية (توصل والتطبيق مقفل) + حذف طفل + حذف صديق
--  شغّله مرة وحدة في SQL Editor بعد schema.sql و update-2.sql
-- =====================================================================

-- 1) اشتراكات الإشعارات (كل جهاز له اشتراك)
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_profile_idx on public.push_subscriptions(profile_id);
alter table public.push_subscriptions enable row level security;   -- بدون policies: محد يقراها إلا السيرفر

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := me();
begin
  if v_me is null then raise exception 'سجّل الدخول أولاً'; end if;
  insert into push_subscriptions (endpoint, profile_id, p256dh, auth) values (p_endpoint, v_me, p_p256dh, p_auth)
  on conflict (endpoint) do update set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and profile_id = me();
$$;

-- 2) رمز سري بين قاعدة البيانات ودالة الإرسال
alter table public.app_config add column if not exists push_secret text;
update public.app_config set push_secret = replace(gen_random_uuid()::text, '-', '') where push_secret is null;

-- 3) كل رسالة جديدة أو طلب صداقة جديد → نطلب من دالة push ترسل الإشعار
create extension if not exists pg_net;

create or replace function public._push_notify(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url := 'https://mjvwlinwcmyifteifrpr.supabase.co/functions/v1/dynamic-handler',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-push-secret', (select push_secret from app_config where id = 1)),
    body := jsonb_build_object('type', p_type, 'id', p_id));
exception when others then null;   -- الإشعار ما يوقف إرسال الرسالة أبداً
end $$;

create or replace function public._push_on_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'system' then perform _push_notify('message', new.id); end if;
  return new;
end $$;
drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages for each row execute function public._push_on_message();

create or replace function public._push_on_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _push_notify('friend_request', new.id);
  return new;
end $$;
drop trigger if exists requests_push on public.friend_requests;
create trigger requests_push after insert on public.friend_requests for each row execute function public._push_on_request();

-- 4) حذف طفل نهائياً
-- أول نرجّع ملفاته عشان التطبيق يحذفها من التخزين، بعدين نحذف كل شي
create or replace function public.child_media_paths(p_child uuid)
returns setof text language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles me_p join profiles k on k.family_id = me_p.family_id
                 where me_p.auth_id = auth.uid() and me_p.role = 'parent' and k.id = p_child and k.role = 'child') then
    raise exception 'غير مسموح';
  end if;
  return query
    select distinct m.media_path from messages m
    where m.media_path is not null and not m.media_expired
      and (m.sender_id = p_child or m.conversation_id in (
            select c.id from conversations c join conversation_members cm on cm.conversation_id = c.id
            where c.kind = 'direct' and cm.profile_id = p_child));
end $$;

create or replace function public.delete_child(p_child uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_auth uuid;
begin
  if not exists (select 1 from profiles me_p join profiles k on k.family_id = me_p.family_id
                 where me_p.auth_id = auth.uid() and me_p.role = 'parent' and k.id = p_child and k.role = 'child') then
    raise exception 'غير مسموح';
  end if;
  select auth_id into v_auth from profiles where id = p_child;
  -- محادثاته الخاصة كاملة (مع رسائلها وألعابها)
  delete from conversations c where c.kind = 'direct'
    and exists (select 1 from conversation_members cm where cm.conversation_id = c.id and cm.profile_id = p_child);
  -- رسائله وألعابه في القروبات
  delete from messages where sender_id = p_child;
  delete from games where p_child = any(players);
  -- الحساب نفسه (يحذف معه الصداقات والعضويات والاشتراكات)
  delete from profiles where id = p_child;
  if v_auth is not null then
    begin delete from auth.users where id = v_auth; exception when others then null; end;
  end if;
end $$;

-- 5) حذف صديق (الطفل أو ولي الأمر يحذف صديقه مباشرة)
create or replace function public.remove_friend_with(p_other uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := me();
begin
  if v_me is null then raise exception 'سجّل الدخول أولاً'; end if;
  delete from friend_requests
  where (from_id = v_me and to_id = p_other) or (from_id = p_other and to_id = v_me);
end $$;

grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.child_media_paths(uuid) to authenticated;
grant execute on function public.delete_child(uuid) to authenticated;
grant execute on function public.remove_friend_with(uuid) to authenticated;
revoke execute on function public._push_notify(text, uuid) from public, anon, authenticated;

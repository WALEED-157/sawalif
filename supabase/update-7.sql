-- =====================================================================
--  تحديث 7: دخول الطفل بكود أرقام (للآيفون)
--  السبب: في الآيفون، التطبيق اللي على الشاشة الرئيسية ما يشارك Safari
--  بياناته، فمسح الـ QR يسجّل دخول في Safari بس. الحين الطفل يكتب الكود
--  داخل التطبيق نفسه.
--  شغّله مرة وحدة في Supabase ← SQL Editor
-- =====================================================================

alter table public.pairing_tokens add column if not exists code text;
create unique index if not exists pairing_tokens_code_idx on public.pairing_tokens(code);

-- محاولات الكود الغلط (عشان ما أحد يجرّب أرقام عشوائية)
create table if not exists public.pairing_attempts (
  id bigint generated always as identity primary key,
  auth_id uuid not null,
  at timestamptz not null default now()
);
alter table public.pairing_attempts enable row level security; -- بدون سياسات = محد يقراها من التطبيق

-- كود الدخول: يرجع الرابط الطويل (للـ QR) + كود 8 أرقام (للكتابة)
drop function if exists public.create_pairing(uuid);
create function public.create_pairing(p_child uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t text; v_c text;
begin
  if not exists (select 1 from profiles me_p join profiles k on k.family_id = me_p.family_id
                 where me_p.auth_id = auth.uid() and me_p.role = 'parent' and k.id = p_child and k.role = 'child') then
    raise exception 'غير مسموح';
  end if;
  delete from pairing_tokens where profile_id = p_child or expires_at < now();
  v_t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  loop
    v_c := lpad(floor(random() * 100000000)::bigint::text, 8, '0');
    exit when not exists (select 1 from pairing_tokens where code = v_c);
  end loop;
  insert into pairing_tokens (token, profile_id, expires_at, code) values (v_t, p_child, now() + interval '15 minutes', v_c);
  return jsonb_build_object('token', v_t, 'code', v_c);
end $$;
grant execute on function public.create_pairing(uuid) to authenticated;

-- الطفل يكتب الكود داخل التطبيق
create or replace function public.claim_pairing_code(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_code text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g'); v_token text;
begin
  if auth.uid() is null then raise exception 'صار خطأ في الدخول'; end if;
  if (select count(*) from pairing_attempts where auth_id = auth.uid() and at > now() - interval '15 minutes') >= 5 then
    raise exception 'محاولات كثيرة، انتظر شوي وحاول';
  end if;
  select token into v_token from pairing_tokens where code = v_code and expires_at > now();
  if v_token is null then
    -- نسجّل المحاولة ونرجع null (لو رمينا خطأ، تنمسح المحاولة مع التراجع)
    insert into pairing_attempts (auth_id) values (auth.uid());
    return null;
  end if;
  return claim_pairing(v_token);
end $$;
grant execute on function public.claim_pairing_code(text) to authenticated;

-- =====================================================================
--  تحديث 4: نعرف متى آخر مرة فتح الشخص التطبيق
--  عشان رنين التنبيه القوي يوقف أول ما يفتح التطبيق
-- =====================================================================

alter table public.profiles add column if not exists last_seen_at timestamptz;

create or replace function public.touch_seen()
returns void language sql security definer set search_path = public as $$
  update profiles set last_seen_at = now() where auth_id = auth.uid();
$$;

grant execute on function public.touch_seen() to authenticated;

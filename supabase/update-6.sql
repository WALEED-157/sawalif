-- =====================================================================
--  تحديث 6: زر "جولة ثانية" يفتح لعبة وحدة بس
--  (قبل: لو اللاعبين الاثنين ضغطوا، تنفتح لعبتين)
--  شغّله مرة وحدة في Supabase ← SQL Editor (بعد update-5.sql)
-- =====================================================================

create or replace function public.rematch_game(p_game uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare g games; v_me uuid := me(); v_other uuid; v_new uuid;
begin
  -- نقفل صف اللعبة القديمة: لو الاثنين ضغطوا بنفس اللحظة، الثاني ينتظر الأول
  select * into g from games where id = p_game for update;
  if g.id is null or not (v_me = any (g.players)) then raise exception 'غير مسموح'; end if;

  -- فيه جولة ثانية انفتحت قبل؟ نرجعها بدل ما نسوي وحدة جديدة
  if g.state ? 'rematch' then return (g.state ->> 'rematch')::uuid; end if;

  v_other := (select x from unnest(g.players) x where x <> v_me limit 1);
  v_new := start_game(g.conversation_id, g.kind, v_other);
  update games set state = g.state || jsonb_build_object('rematch', v_new) where id = p_game;
  return v_new;
end $$;

grant execute on function public.rematch_game(uuid) to authenticated;

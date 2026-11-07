// دالة push: ترسل إشعار للجوالات لما توصل رسالة أو طلب صداقة (حتى لو التطبيق مقفل)
// تنحط في Supabase ← Edge Functions باسم push
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const VAPID_PUBLIC = 'BKkOOyZjMpppAa4nZ_Q9Y3CwVVJtzbL7jdppI7KtfyZa8tThwqfeW3o-kOd287NNmX5-TvLKUID_sq21Kjtc6rI';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
webpush.setVapidDetails('mailto:family-app@example.com', VAPID_PUBLIC, Deno.env.get('VAPID_PRIVATE_KEY')!);

const PREVIEW: Record<string, string> = {
  sticker: '😀 ملصق', image: '📷 صورة', audio: '🎤 رسالة صوتية', video: '🎬 فيديو', game: '🎮 تحدّي لعبة', buzz: '🔔 ينبهك!',
};

type Note = { title: string; body: string; url: string; tag: string; buzz?: boolean };

async function sendTo(profileIds: string[], note: Note) {
  if (!profileIds.length) return 0;
  const { data: subs } = await db.from('push_subscriptions').select('*').in('profile_id', profileIds);
  let sent = 0;
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(note),
        { TTL: note.buzz ? 120 : 6 * 3600, urgency: 'high' },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint); // جهاز قديم
      else console.error('push failed', code, (e as Error).message);
    }
  }));
  return sent;
}

async function onMessage(id: string) {
  const { data: m } = await db.from('messages').select('*').eq('id', id).single();
  if (!m || m.kind === 'system') return 0;
  const [{ data: conv }, { data: members }, { data: sender }] = await Promise.all([
    db.from('conversations').select('*').eq('id', m.conversation_id).single(),
    db.from('conversation_members').select('profile_id').eq('conversation_id', m.conversation_id),
    db.from('profiles').select('id, display_name, avatar, family_id, role').eq('id', m.sender_id).single(),
  ]);
  const name = sender?.display_name || 'أحد';
  const text = m.kind === 'text' ? (m.body || '').slice(0, 120) : (PREVIEW[m.kind] || 'رسالة جديدة');
  const isGroup = conv?.kind === 'group';
  const note: Note = {
    title: m.kind === 'buzz' ? `🔔 ${name} ينبهك!` : isGroup ? `${conv?.emoji || '👥'} ${conv?.title || 'قروب'}` : `${sender?.avatar || ''} ${name}`.trim(),
    body: m.kind === 'buzz' ? 'افتح التطبيق الحين' : isGroup ? `${name}: ${text}` : text,
    url: '#/chat/' + m.conversation_id,
    tag: m.kind === 'buzz' ? 'buzz-' + m.id : m.conversation_id,
    buzz: m.kind === 'buzz',
  };
  const recipients = (members || []).map((x) => x.profile_id).filter((p) => p !== m.sender_id);
  let sent = await sendTo(recipients, note);

  // رسالة فيها شي مشبوه → تنبيه أمان لأهل الأطفال اللي في المحادثة
  if (m.flagged) {
    const { data: kids } = await db.from('profiles').select('family_id').in('id', m.sender_id ? [...recipients, m.sender_id] : recipients).eq('role', 'child');
    const fams = [...new Set((kids || []).map((k) => k.family_id))];
    if (fams.length) {
      const { data: parents } = await db.from('profiles').select('id').in('family_id', fams).eq('role', 'parent');
      sent += await sendTo((parents || []).map((p) => p.id).filter((p) => p !== m.sender_id), {
        title: '⚠️ تنبيه أمان', body: `${name}: ${m.flag_reason || 'رسالة تحتاج مراجعة'}`, url: '#/family', tag: 'alert-' + m.id,
      });
    }
  }
  return sent;
}

async function onFriendRequest(id: string) {
  const { data: r } = await db.from('friend_requests').select('*').eq('id', id).single();
  if (!r) return 0;
  const { data: people } = await db.from('profiles').select('id, display_name, family_id').in('id', [r.from_id, r.to_id]);
  const from = people?.find((p) => p.id === r.from_id);
  const to = people?.find((p) => p.id === r.to_id);
  if (!from || !to) return 0;
  const { data: parents } = await db.from('profiles').select('id').in('family_id', [from.family_id, to.family_id]).eq('role', 'parent');
  return sendTo((parents || []).map((p) => p.id).filter((p) => p !== r.from_id), {
    title: '👫 طلب صداقة جديد', body: `${from.display_name} يبي يضيف ${to.display_name}، يحتاج موافقتك`, url: '#/family', tag: 'req-' + r.id,
  });
}

Deno.serve(async (req) => {
  try {
    const { data: cfg } = await db.from('app_config').select('push_secret').eq('id', 1).single();
    if (!cfg?.push_secret || req.headers.get('x-push-secret') !== cfg.push_secret) return new Response('forbidden', { status: 403 });
    const { type, id } = await req.json();
    const sent = type === 'message' ? await onMessage(id) : type === 'friend_request' ? await onFriendRequest(id) : 0;
    return Response.json({ ok: true, sent });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
});

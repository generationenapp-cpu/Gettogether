// =============================================================
//  GetTogether – push-beskeder til appen (Supabase Edge Function)
//
//  Appen kalder funktionen, lige efter man har sendt en privat besked,
//  skrevet i en gruppe, ringet op eller sendt en venneanmodning.
//  Funktionen tjekker selv i databasen, at det er dig, der har sendt
//  det, og sender så en push-besked til modtagerens telefon(er) via
//  Expo. Beskedens indhold bliver ALDRIG sendt med – kun hvem det er fra.
//
//  Hemmeligheder (valgfri): EXPO_ACCESS_TOKEN, hvis du slår
//  "Enhanced security for push notifications" til hos Expo.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

type Push = { recipients: string[]; title: string; body: string; data: Record<string, unknown>; channelId: string; ttl?: number };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return reply({ error: 'not_signed_in' }, 401);

    const { kind, id } = await req.json().catch(() => ({}));
    if (!['dm', 'group', 'call', 'friend'].includes(kind) || id === undefined || id === null) return reply({ error: 'bad_request' }, 400);

    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    const me = user.id;
    const { data: sender } = await db.from('profiles').select('nickname, banned').eq('id', me).maybeSingle();
    if (!sender || sender.banned) return reply({ skipped: 'sender' });
    const nick = sender.nickname as string;

    let push: Push | null = null;
    if (kind === 'dm') {
      const { data: m } = await db.from('direct_messages').select('recipient').eq('id', id).eq('sender', me).maybeSingle();
      if (m) push = { recipients: [m.recipient], title: nick, body: 'Har skrevet til dig', data: { kind: 'dm', id: me }, channelId: 'beskeder' };
    } else if (kind === 'group') {
      const { data: m } = await db.from('group_messages').select('group_id').eq('id', id).eq('user_id', me).maybeSingle();
      if (m) {
        const [{ data: g }, { data: members }] = await Promise.all([
          db.from('groups').select('name, emoji').eq('id', m.group_id).maybeSingle(),
          db.from('group_members').select('user_id').eq('group_id', m.group_id).neq('user_id', me),
        ]);
        if (g) push = {
          recipients: (members || []).map((x: { user_id: string }) => x.user_id),
          title: `${g.emoji} ${g.name}`, body: `${nick} har skrevet i gruppen`,
          data: { kind: 'group', id: m.group_id }, channelId: 'beskeder',
        };
      }
    } else if (kind === 'call') {
      const { data: c } = await db.from('calls').select('callee, status').eq('id', id).eq('caller', me).maybeSingle();
      if (c && c.status === 'ringing') push = { recipients: [c.callee], title: nick, body: 'Ringer til dig – tryk for at svare', data: { kind: 'call', id }, channelId: 'opkald', ttl: 45 };
    } else if (kind === 'friend') {
      const { data: f } = await db.from('friendships').select('addressee, status').eq('id', id).eq('requester', me).maybeSingle();
      if (f && f.status === 'pending') push = { recipients: [f.addressee], title: nick, body: 'Vil gerne være ven med dig', data: { kind: 'friend' }, channelId: 'beskeder' };
    }
    if (!push || !push.recipients.length) return reply({ skipped: 'nothing' });

    // Samme ting sendes kun én gang (tjekkes først, når vi ved, at det er afsenderen, der spørger)
    const { error: dup } = await db.from('push_log').insert({ kind, ref: String(id) });
    if (dup) return reply({ skipped: 'already_sent' });

    // Ikke til folk, der har blokeret afsenderen
    const { data: blocks } = await db.from('blocks').select('blocker').eq('blocked', me).in('blocker', push.recipients);
    const blockedBy = new Set((blocks || []).map((b: { blocker: string }) => b.blocker));
    const to = push.recipients.filter((r) => !blockedBy.has(r));
    if (!to.length) return reply({ skipped: 'blocked' });

    const { data: tokens } = await db.from('push_tokens').select('token').in('user_id', to);
    if (!tokens?.length) return reply({ sent: 0 });

    const messages = tokens.map((t: { token: string }) => ({
      to: t.token, title: push!.title, body: push!.body, data: push!.data,
      sound: 'default', priority: 'high', channelId: push!.channelId,
      ...(push!.ttl ? { ttl: push!.ttl } : {}),
    }));
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
    if (expoToken) headers.authorization = `Bearer ${expoToken}`;

    let sent = 0;
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers, body: JSON.stringify(chunk) });
      if (!res.ok) continue;
      const out = await res.json().catch(() => ({}));
      const tickets: Array<{ status: string; details?: { error?: string } }> = out.data || [];
      const dead: string[] = [];
      tickets.forEach((t, j) => {
        if (t.status === 'ok') sent++;
        else if (t.details?.error === 'DeviceNotRegistered') dead.push(chunk[j].to);
      });
      // Appen er slettet fra telefonen: glem adressen
      if (dead.length) await db.from('push_tokens').delete().in('token', dead);
    }
    return reply({ sent });
  } catch (e) {
    return reply({ error: String(e) }, 500);
  }
});

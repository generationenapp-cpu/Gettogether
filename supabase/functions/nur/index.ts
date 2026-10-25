// =============================================================
//  GetTogether – Nur på fællesskabets AI-nøgle (Supabase Edge Function)
//
//  Guiden sender sine Nur-spørgsmål hertil (via /api/nur på hjemmesiden),
//  og funktionen spørger Claude med ANTHROPIC_API_KEY. Nøglen er aldrig
//  synlig på hjemmesiden.
//
//  Loft (styres i app_settings): pr. person pr. time og samlet pr. dag.
//  Personen kendes kun som et hash af IP-adressen – adressen gemmes aldrig.
//
//  Hemmeligheder (Supabase → Edge Functions → Secrets):
//    ANTHROPIC_API_KEY   din nøgle fra platform.claude.com
//                        (eller gemt i private.secrets – se schema.sql v7)
//    NUR_MODEL           valgfri, standard: claude-haiku-5-5
//  Lægges op med "Verify JWT" slået FRA – guiden kræver ikke login.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const MODEL = Deno.env.get('NUR_MODEL') || 'claude-haiku-5-5';
const SYSTEM = `You are the AI inside "Nur", a guide app for new Muslims and people exploring Islam (GetTogether, put together by Malik). Only help with what the app is for: questions about Islam, faith and everyday life as a Muslim, checking religious or historical claims, and translating the app's own texts. If someone asks for something unrelated (programming, homework, marketing, other products), politely decline in one short sentence in their language. Otherwise follow the instructions in the user's message.`;
const MAX_MSGS = 24;
const MAX_CHARS = 60000;
const MAX_IMAGES = 2;
const MAX_IMG_B64 = 1_600_000;
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const APP_ORIGINS = ['https://localhost', 'capacitor://localhost'];

type Msg = { role: 'user' | 'assistant'; content: string };
type Img = { media_type: string; data: string };

async function sha256(t: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  const cors: Record<string, string> = APP_ORIGINS.includes(origin)
    ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST', vary: 'Origin' }
    : {};
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  let key = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!key) {
    const { data } = await db.rpc('app_secret', { p_name: 'ANTHROPIC_API_KEY' });
    key = typeof data === 'string' ? data : '';
  }

  // GET: må guiden bruge Nur på fællesskabets nøgle? (og hvornår åbner den)
  if (req.method === 'GET') {
    let on = true, opens: string | null = null;
    try {
      const { data } = await db.from('app_settings').select('nur_ai_on, nur_ai_opens').eq('id', 1).maybeSingle();
      opens = data?.nur_ai_opens ?? null;
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Copenhagen' });
      on = data?.nur_ai_on !== false || (!!opens && today >= opens);
    } catch (_e) { /* standard: til */ }
    return reply({ enabled: !!key && on, opens: on ? null : opens });
  }
  if (req.method !== 'POST') return reply({ error: 'method' }, 405);
  if (!key) return reply({ error: 'not_configured' }, 503);

  // Tjek input
  let body: { messages?: unknown; images?: unknown; max_tokens?: unknown };
  try { body = await req.json(); } catch (_e) { return reply({ error: 'bad_request' }, 400); }
  const msgs = Array.isArray(body.messages) ? body.messages as Msg[] : [];
  const okMsgs = msgs.length > 0 && msgs.length <= MAX_MSGS &&
    msgs.every((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.length > 0) &&
    msgs[msgs.length - 1].role === 'user' &&
    msgs.reduce((n, m) => n + m.content.length, 0) <= MAX_CHARS;
  if (!okMsgs) return reply({ error: 'bad_request' }, 400);
  const imgs = Array.isArray(body.images) ? body.images as Img[] : [];
  if (imgs.length > MAX_IMAGES || !imgs.every((i) => IMG_TYPES.includes(i?.media_type) && typeof i.data === 'string' && i.data.length <= MAX_IMG_B64)) {
    return reply({ error: 'too_big' }, 413);
  }
  const maxTokens = Math.min(8000, Math.max(50, Number(body.max_tokens) || 1500));

  // Loft: pr. person (hash af IP) pr. time og samlet pr. dag
  const ip = (req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || '').trim();
  const who = ip ? (await sha256(ip + '|' + url)).slice(0, 32) : '';
  const { data: take, error: takeErr } = await db.rpc('nur_ai_take', { p_who: who });
  if (takeErr) return reply({ error: 'server' }, 500);
  if (take === 'off') return reply({ error: 'off' }, 503);
  if (take === 'hour') return reply({ error: 'limit_hour' }, 429);
  if (take === 'day') return reply({ error: 'limit_day' }, 429);

  // Spørg Claude
  const messages: { role: string; content: unknown }[] = msgs.map((m) => ({ role: m.role, content: m.content }));
  if (imgs.length) {
    const last = messages[messages.length - 1];
    last.content = [
      ...imgs.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } })),
      { type: 'text', text: last.content as string },
    ];
  }
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system: SYSTEM, messages }),
    });
  } catch (_e) {
    return reply({ error: 'upstream' }, 502);
  }
  if (!res.ok) {
    let em = '';
    try { em = (await res.json())?.error?.message ?? ''; } catch (_e) { /* ingen tekst */ }
    console.log(JSON.stringify({ nur: true, status: res.status, error: em.slice(0, 160), ip: !!ip }));
    if (/credit balance/i.test(em)) return reply({ error: 'no_credit' }, 402);
    if (res.status === 401 || res.status === 403) return reply({ error: 'not_configured' }, 503);
    if (res.status === 429 || res.status === 529) return reply({ error: 'busy' }, 429);
    return reply({ error: 'upstream' }, 502);
  }
  const j = await res.json();
  const text = (j.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
  console.log(JSON.stringify({ nur: true, ok: true, ip: !!ip, in: j.usage?.input_tokens, out: j.usage?.output_tokens }));
  return reply({ text });
});

// =============================================================
//  GetTogether – tælleren i guiden ("du er nr. X")
//
//  POST lægger én til (første gang en enhed åbner Nur), GET læser tallet.
//  Hjemmesiden sender /api/count hertil (se _redirects).
//  Gemmer kun ét tal. Ingen IP-adresser eller personlige data.
//  Lægges op med "Verify JWT" slået FRA – alle må læse tallet.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

// Android-appen kører fra sin egen adresse og må også hente tallet
const APP_ORIGINS = ['https://localhost', 'capacitor://localhost'];

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  const cors: Record<string, string> = APP_ORIGINS.includes(origin)
    ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST', vary: 'Origin' }
    : {};
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET' && req.method !== 'POST') return new Response(null, { status: 405, headers: cors });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data, error } = await db.rpc('nur_count', { p_bump: req.method === 'POST' });
  if (error) return Response.json({ error: 'count' }, { status: 500, headers: cors });
  return Response.json({ count: Number(data) || 0 }, { headers: { 'cache-control': 'no-store', ...cors } });
});

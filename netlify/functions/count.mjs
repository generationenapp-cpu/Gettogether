import { getStore } from "@netlify/blobs";

// Tæller: POST lægger én til (første gang en enhed åbner Nur), GET læser tallet.
// Gemmer kun ét tal. Ingen IP-adresser eller personlige data.
// Appen (Google Play / App Store) kører fra sin egen adresse og må også hente tallet
const APP_ORIGINS = ["https://localhost", "capacitor://localhost"];

export default async (req) => {
  const origin = req.headers.get("origin");
  const cors = APP_ORIGINS.includes(origin) ? { "access-control-allow-origin": origin, vary: "Origin" } : {};
  const store = getStore({ name: "nur", consistency: "strong" });
  let n = Number(await store.get("count")) || 0;
  if (req.method === "POST") {
    n += 1;
    await store.set("count", String(n));
  }
  return Response.json({ count: n }, { headers: { "cache-control": "no-store", ...cors } });
};

export const config = { path: "/api/count" };

import { getStore } from "@netlify/blobs";

// Tæller: POST lægger én til (første gang en enhed åbner Nur), GET læser tallet.
// Gemmer kun ét tal. Ingen IP-adresser eller personlige data.
export default async (req) => {
  const store = getStore({ name: "nur", consistency: "strong" });
  let n = Number(await store.get("count")) || 0;
  if (req.method === "POST") {
    n += 1;
    await store.set("count", String(n));
  }
  return Response.json({ count: n }, { headers: { "cache-control": "no-store" } });
};

export const config = { path: "/api/count" };

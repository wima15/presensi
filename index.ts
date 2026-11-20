// EDGE FUNCTION: foto-presensi  (deploy di project FOTO, bukan project e-Rapor)
// Menerima foto selfie dari aplikasi presensi dan menyimpannya di Storage project ini.
// Identitas pengirim diverifikasi ke project e-Rapor memakai token login e-Rapor
// (header x-rapor-token), jadi tidak perlu akun ganda.
//
// PENTING: matikan "Verify JWT" untuk fungsi ini (token e-Rapor bukan JWT project ini):
//   supabase functions deploy foto-presensi --no-verify-jwt
//   atau Dashboard > Edge Functions > foto-presensi > Details > Verify JWT: OFF
//
// Secrets (Edge Functions > Secrets):
//   RAPOR_URL       = https://iejpwxmcqwecejsrezry.supabase.co
//   RAPOR_ANON_KEY  = kunci publishable/anon project e-Rapor (kunci publik, bukan service_role)
//
// POST { action:"upload", jenis:"datang"|"pulang", foto:<base64 jpeg> } -> { path }
// POST { action:"url", paths:[...] } -> { urls:{path:signedUrl} }   (admin: semua; lainnya: hanya foto sendiri)
import { createClient } from "npm:@supabase/supabase-js@2";

const RAPOR_URL = (Deno.env.get("RAPOR_URL") ?? "").replace(/\/+$/, "");
const RAPOR_ANON = Deno.env.get("RAPOR_ANON_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const BUCKET = "selfie", MAX = 20 * 1024; // batas 20 KB
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-rapor-token, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function siapa(token: string) {
  if (!token) return null;
  const h = { apikey: RAPOR_ANON, Authorization: `Bearer ${token}` };
  const u = await fetch(`${RAPOR_URL}/auth/v1/user`, { headers: h });
  if (!u.ok) return null;
  const { id } = await u.json();
  const p = await fetch(`${RAPOR_URL}/rest/v1/profiles?id=eq.${id}&select=role`, { headers: h });
  const rows = await p.json();
  return { id: id as string, role: Array.isArray(rows) ? (rows[0]?.role as string) : undefined };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Gunakan POST" }, 405);
  if (!RAPOR_URL || !RAPOR_ANON) return json({ error: "Secret RAPOR_URL / RAPOR_ANON_KEY belum diisi." }, 500);

  const me = await siapa(req.headers.get("x-rapor-token") ?? "");
  if (!me) return json({ error: "Sesi login e-Rapor tidak valid. Login ulang." }, 401);
  if (!["guru", "staf", "kepsek", "admin"].includes(me.role ?? "")) return json({ error: "Peran tidak diizinkan" }, 403);

  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "upload") {
      if (!["datang", "pulang"].includes(body.jenis)) return json({ error: "jenis tidak valid" }, 400);
      const bin = Uint8Array.from(atob(String(body.foto ?? "")), (c) => c.charCodeAt(0));
      if (bin.length < 1000 || bin.length > MAX) return json({ error: "Ukuran foto harus 1 KB – 20 KB" }, 400);
      if (bin[0] !== 0xff || bin[1] !== 0xd8 || bin[2] !== 0xff) return json({ error: "Bukan file JPEG" }, 400);
      const tgl = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }); // tanggal server, bukan klien
      const path = `${me.id}/${tgl}-${body.jenis}.jpg`;
      const { error } = await db.storage.from(BUCKET).upload(path, bin, { upsert: true, contentType: "image/jpeg" });
      if (error) return json({ error: error.message }, 500);
      return json({ path });
    }
    if (body.action === "url") {
      const paths: string[] = (Array.isArray(body.paths) ? body.paths : []).slice(0, 300).map(String);
      const ok = paths.filter((p) => me.role === "admin" || p.startsWith(me.id + "/"));
      const urls: Record<string, string> = {};
      if (ok.length) {
        const { data, error } = await db.storage.from(BUCKET).createSignedUrls(ok, 3600);
        if (error) return json({ error: error.message }, 500);
        for (const d of data ?? []) if (d.signedUrl && d.path) urls[d.path] = d.signedUrl;
      }
      return json({ urls });
    }
    return json({ error: "action tidak dikenal" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

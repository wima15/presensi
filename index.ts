// EDGE FUNCTION: sync-erapor  (deploy di project Supabase PRESENSI)
// Menarik guru & staf dari project Supabase e-Rapor ke tabel `pegawai`.
//
// Secrets (Dashboard > Edge Functions > Secrets):
//   RAPOR_URL          = https://iejpwxmcqwecejsrezry.supabase.co
//   RAPOR_SERVICE_KEY  = service_role key project e-Rapor   (JANGAN ditaruh di HTML)
//   AKUN_PASSWORD      = (opsional) kata sandi awal akun baru, default "guruku123"
//
// POST body: { action: "plan" | "apply", buat_akun?: boolean, nonaktifkan?: boolean }
//   plan  -> hanya ringkasan, tidak menulis apa pun
//   apply -> upsert ke pegawai (kunci: NIP, cadangan NUPTK); tidak menghapus data
// Hanya admin presensi yang boleh memanggil. Role admin & pengawas di e-Rapor dilewati.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RAPOR_URL = Deno.env.get("RAPOR_URL") ?? "";
const RAPOR_KEY = Deno.env.get("RAPOR_SERVICE_KEY") ?? "";
const PASS = Deno.env.get("AKUN_PASSWORD") ?? "guruku123";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const norm = (s: unknown) => String(s ?? "").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Gunakan POST" }, 405);
  if (!RAPOR_URL || !RAPOR_KEY) return json({ error: "Secret RAPOR_URL / RAPOR_SERVICE_KEY belum diisi." }, 500);

  // --- hanya admin presensi ---
  const auth = req.headers.get("Authorization") ?? "";
  const db = createClient(URL_, SRK, { auth: { persistSession: false } });
  const { data: u, error: ue } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (ue || !u?.user?.email) return json({ error: "Belum login" }, 401);
  const { data: adm } = await db.from("pegawai").select("role").eq("email", u.user.email.toLowerCase()).maybeSingle();
  if (adm?.role !== "admin") return json({ error: "Hanya admin yang boleh sinkron" }, 403);

  const body = await req.json().catch(() => ({}));
  try {
    const rapor = createClient(RAPOR_URL, RAPOR_KEY, { auth: { persistSession: false } });
    // deno-lint-ignore no-explicit-any
    const src: any[] = [];
    for (let f = 0; ; f += 1000) {
      const { data, error } = await rapor.from("profiles").select("id,nama,email,role,nip,nuptk")
        .in("role", ["guru", "staf", "kepsek"]).order("id").range(f, f + 999);
      if (error) return json({ error: "e-Rapor: " + error.message }, 400);
      src.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    const rows: Record<string, unknown>[] = [], skip: string[] = [], seen = new Set<string>();
    for (const g of src) {
      const nip = norm(g.nip) || norm(g.nuptk);
      let email = norm(g.email).toLowerCase();
      if (!email) email = norm((await rapor.auth.admin.getUserById(g.id)).data?.user?.email).toLowerCase();
      if (!nip) { skip.push(`${g.nama}: NIP/NUPTK kosong`); continue; }
      if (seen.has(nip)) { skip.push(`${g.nama}: NIP ${nip} ganda`); continue; }
      seen.add(nip);
      rows.push({
        nip, nama: norm(g.nama), email: email || null,
        jabatan: g.role === "kepsek" ? "Kepala Sekolah" : g.role === "staf" ? "Staf" : "Guru",
        tipe: g.role === "staf" ? "karyawan" : "guru", sumber: "erapor", aktif: true,
        updated_at: new Date().toISOString(),
      });
    }

    const { data: ada } = await db.from("pegawai").select("nip,sumber");
    const nipAda = new Set((ada ?? []).map((p) => p.nip));
    const baru = rows.filter((r) => !nipAda.has(r.nip as string)).length;
    const hilang = (ada ?? []).filter((p) => p.sumber === "erapor" && !seen.has(p.nip)).length;

    if (body.action === "plan") {
      return json({ total: rows.length, baru, diperbarui: rows.length - baru, tidak_ada_di_erapor: hilang, dilewati: skip.slice(0, 30) });
    }
    if (body.action !== "apply") return json({ error: "action tidak dikenal" }, 400);

    // jangan timpa role admin lokal: upsert tanpa kolom role
    const errors: string[] = [];
    const { error } = await db.from("pegawai").upsert(rows, { onConflict: "nip" });
    if (error) return json({ error: error.message }, 400);

    let akun = 0;
    if (body.buat_akun === true) {
      for (const r of rows) {
        if (!r.email) continue;
        const { error: e } = await db.auth.admin.createUser({ email: r.email as string, password: PASS, email_confirm: true });
        if (!e) akun++;
        else if (!/already|registered|exists/i.test(e.message)) errors.push(`${r.nama}: ${e.message}`);
      }
    }
    let nonaktif = 0;
    if (body.nonaktifkan === true && hilang) {
      const { data } = await db.from("pegawai").update({ aktif: false })
        .eq("sumber", "erapor").not("nip", "in", `(${[...seen].map((n) => `"${n}"`).join(",")})`).select("id");
      nonaktif = data?.length ?? 0;
    }
    return json({ disinkron: rows.length, baru, akun_dibuat: akun, dinonaktifkan: nonaktif, dilewati: skip.slice(0, 30), errors, password_awal: akun ? PASS : undefined });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

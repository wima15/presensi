// Menyiapkan folder www/ untuk Capacitor:
//  - menyalin index.html
//  - memakai supabase-js lokal (bukan CDN) supaya aplikasi tidak blank jika CDN gagal
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

rmSync("www", { recursive: true, force: true });
mkdirSync("www", { recursive: true });

const umd = "node_modules/@supabase/supabase-js/dist/umd";
cpSync(umd, "www/vendor", { recursive: true });

const cdn = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+"><\/script>/;
let html = readFileSync("index.html", "utf8");
if (!cdn.test(html)) throw new Error("Tag script CDN supabase-js tidak ditemukan di index.html");
html = html.replace(cdn, '<script src="vendor/supabase.js"></script>');
writeFileSync("www/index.html", html);
console.log("www/ siap.");

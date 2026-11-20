-- Jalankan di Supabase project e-Rapor/PDP (iejpwxmcqwecejsrezry) > SQL Editor
-- Hanya MENAMBAH tabel baru berawalan presensi_ dan satu aturan baca profiles untuk admin.
-- Tidak mengubah tabel atau aturan PDP yang sudah ada. Aman dijalankan ulang.

create or replace function public.presensi_is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

create table if not exists public.presensi_lokasi (
  id int primary key default 1 check (id = 1),
  nama_lokasi text default 'Sekolah',
  lat double precision default 0,
  lng double precision default 0,
  radius_m int default 100,
  toleransi_menit int default 0
);
insert into public.presensi_lokasi (id) values (1) on conflict do nothing;

create table if not exists public.presensi_jadwal (
  id uuid primary key default gen_random_uuid(),
  pegawai_id uuid not null references public.profiles(id) on delete cascade,
  hari int not null check (hari between 1 and 7),   -- 1=Senin ... 7=Minggu
  jam_masuk time not null,
  jam_pulang time not null,
  unique (pegawai_id, hari)
);

create table if not exists public.presensi_log (
  id uuid primary key default gen_random_uuid(),
  pegawai_id uuid not null references public.profiles(id) on delete cascade,
  tanggal date not null default (now() at time zone 'Asia/Jakarta')::date,
  jenis text not null check (jenis in ('datang','pulang')),
  waktu timestamptz not null default now(),
  lat double precision, lng double precision, jarak_m int,
  foto_path text, status text,
  unique (pegawai_id, tanggal, jenis)
);

-- Validasi radius di server
create or replace function public.presensi_cek_radius() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.presensi_lokasi; d double precision;
begin
  select * into p from public.presensi_lokasi where id = 1;
  d := 6371000 * 2 * asin(sqrt(
    power(sin(radians(new.lat - p.lat) / 2), 2) +
    cos(radians(p.lat)) * cos(radians(new.lat)) * power(sin(radians(new.lng - p.lng) / 2), 2)));
  new.jarak_m := round(d);
  if d > p.radius_m then
    raise exception 'Di luar radius presensi (% m dari titik, batas % m)', round(d), p.radius_m;
  end if;
  return new;
end $$;
drop trigger if exists trg_presensi_radius on public.presensi_log;
create trigger trg_presensi_radius before insert on public.presensi_log
  for each row execute function public.presensi_cek_radius();

-- RLS
alter table public.presensi_lokasi enable row level security;
alter table public.presensi_jadwal enable row level security;
alter table public.presensi_log enable row level security;

drop policy if exists p_lokasi_baca on public.presensi_lokasi;
create policy p_lokasi_baca on public.presensi_lokasi for select to authenticated using (true);
drop policy if exists p_lokasi_ubah on public.presensi_lokasi;
create policy p_lokasi_ubah on public.presensi_lokasi for update to authenticated
  using (public.presensi_is_admin()) with check (public.presensi_is_admin());

drop policy if exists p_jadwal_baca on public.presensi_jadwal;
create policy p_jadwal_baca on public.presensi_jadwal for select to authenticated
  using (pegawai_id = auth.uid() or public.presensi_is_admin());
drop policy if exists p_jadwal_admin on public.presensi_jadwal;
create policy p_jadwal_admin on public.presensi_jadwal for all to authenticated
  using (public.presensi_is_admin()) with check (public.presensi_is_admin());

drop policy if exists p_log_baca on public.presensi_log;
create policy p_log_baca on public.presensi_log for select to authenticated
  using (pegawai_id = auth.uid() or public.presensi_is_admin());
drop policy if exists p_log_isi on public.presensi_log;
create policy p_log_isi on public.presensi_log for insert to authenticated
  with check (pegawai_id = auth.uid());

-- Admin presensi boleh membaca semua profil (untuk rekap & jadwal). Menambah, tidak mengganti aturan lama.
drop policy if exists p_profiles_admin_baca on public.profiles;
create policy p_profiles_admin_baca on public.profiles for select to authenticated
  using (public.presensi_is_admin());

-- Foto selfie TIDAK disimpan di project ini; lihat foto_project/ (project terpisah).

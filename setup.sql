-- Jalankan di project FOTO (nrwexyezcbmsokelgkmp) > SQL Editor
-- Bucket privat. Tanpa policy: hanya Edge Function (service role) yang bisa baca/tulis.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('selfie', 'selfie', false, 20480, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 20480, allowed_mime_types = array['image/jpeg'];

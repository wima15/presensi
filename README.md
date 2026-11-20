# Presensi Guru & Karyawan

Aplikasi web (`index.html`) + bungkus Android (Capacitor).

## Build APK lewat GitHub
1. Push ke branch `main` (atau jalankan manual: tab **Actions → Build Android APK → Run workflow**).
2. Setelah selesai, unduh APK di bagian **Artifacts → presensi-apk**.
   `presensi-debug.apk` bisa langsung dipasang di HP (izinkan "pasang dari sumber tidak dikenal").
3. Push tag `v1.0.0` untuk otomatis membuat GitHub Release berisi APK.

### APK rilis bertanda tangan (opsional)
Buat keystore sekali saja:
```
keytool -genkeypair -v -keystore release.jks -alias presensi -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.jks     # salin hasilnya
```
Simpan sebagai **Settings → Secrets and variables → Actions**:
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Simpan file `release.jks` di tempat aman: tanpa file itu aplikasi tidak bisa di-update di atas versi lama.

## Build lokal
```
npm install
npm run sync
cd android && ./gradlew assembleDebug
```

## Mengubah isi aplikasi
Edit `index.html` di root, lalu `npm run sync`. Folder `www/` dibuat otomatis (jangan diedit).
Ganti `appId` / nama di `capacitor.config.json` bila perlu (ID paket lama dan baru dianggap aplikasi berbeda).

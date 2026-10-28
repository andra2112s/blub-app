# Deploy Mochi Studio ke VPS

Arsitektur:

```
HP (PWA Mochi di Vercel) ──HTTPS──► VPS
                                     ├─ Caddy   :443  (HTTPS otomatis Let's Encrypt)
                                     ├─ Studio  :8787 (login Google, kredit QRIS, antrean video) — internal
                                     └─ Toonflow:3000 (mesin video, API key provider) — 127.0.0.1 saja
```

Pengguna tidak pernah mengakses Toonflow. API key model hanya ada di Toonflow dan diisi admin.

## 1. Siapkan VPS

Rekomendasi minimal: **4 vCPU, 8 GB RAM, 80 GB SSD, Ubuntu 24.04**. Build pertama Toonflow cukup berat;
setelah jalan, beban kecil karena generate gambar/video dikerjakan provider model. Ruang disk bertambah seiring video pengguna.

```bash
# di VPS, sebagai user dengan sudo
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # logout lalu login lagi
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

Port 3000 dan 8787 **tidak** dibuka di firewall.

## 2. DNS

Buat A record `studio.domainkamu.com` → IP VPS. Tunggu sampai `ping studio.domainkamu.com` mengarah ke IP tersebut.

## 3. Google Sign-In

1. Buka Google Cloud Console → **APIs & Services → OAuth consent screen**, isi nama aplikasi "Mochi", status *In production*.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. *Authorized JavaScript origins*: `https://mochi-kamu.vercel.app` dan `https://studio.domainkamu.com`.
4. Salin **Client ID** (diakhiri `.apps.googleusercontent.com`). Tidak perlu client secret.

## 4. QRIS mandiri

Scan gambar QRIS statis merchant-mu dengan aplikasi pemindai QR biasa, salin **teks** hasilnya (diawali `000201`).
Studio mengubahnya menjadi QRIS dinamis bernominal unik per order. Saat start, Studio memvalidasi CRC-nya — cek log kalau ada `❌ QRIS_STATIC`.

## 5. Jalankan

```bash
git clone <repo-mochi-kamu> mochi && cd mochi/deploy
cp .env.example .env && nano .env      # isi semua nilai
docker compose up -d --build           # build pertama Toonflow bisa lama, jangan disela
docker compose ps
docker compose logs -f studio
```

Cek `https://studio.domainkamu.com/health` → `{"ok":true}`.

## 6. Konfigurasi Toonflow (sekali, oleh admin)

Dari laptop:

```bash
ssh -N -L 3000:127.0.0.1:3000 user@IP-VPS
```

Biarkan terbuka, buka `http://127.0.0.1:3000`:

1. Pilih workspace `myProject`, atur bahasa ke Bahasa Indonesia.
2. Tambahkan **provider** model teks, gambar, dan video beserta API key-nya. Pakai key dengan saldo terbatas dan matikan top-up otomatis di dasbor provider.

## 7. Atur Studio

Buka `https://studio.domainkamu.com/admin`, masuk dengan Google (email di `ADMIN_EMAILS`).
Email yang tercantum di `ADMIN_EMAILS` juga otomatis mendapat **kredit tanpa batas** di Studio.
Jika kamu mengisi `ADMIN_LOGIN_CODE`, halaman Studio menampilkan form "Masuk sebagai admin" (email + kode) — berguna sebagai pintu cadangan saat Google Sign-In bermasalah.

- **Pengaturan → Muat** untuk melihat `providerId`/`modelId` yang tersedia, lalu isi `text`, `image`, `video`.
- Atur `packages` (harga video dalam kredit) dan `topups` (kredit & harga Rupiah). Hitung dari biaya provider sebenarnya + margin.
- Uji dengan akunmu sendiri: tambah kredit lewat tab **Pengguna**, buat satu video, cek biaya di dasbor provider.

## 8. Sambungkan PWA

Di `index.html` Mochi, isi meta:

```html
<meta name="mochi-studio" content="https://studio.domainkamu.com" />
```

Deploy ulang ke Vercel.

## Operasional harian

| Tugas | Cara |
|---|---|
| Konfirmasi top-up | `/admin` → Pembayaran → cocokkan **nominal persis** dengan mutasi QRIS → Setujui |
| Log | `docker compose logs -f studio` / `docker compose logs -f toonflow` |
| Restart | `docker compose restart studio` (job yang sedang jalan dilanjutkan dari langkah terakhir) |
| Update kode Studio | `git pull && docker compose up -d --build studio` |
| Update Toonflow | ubah tag di `compose.yaml` **setelah diuji di staging**, lalu `docker compose up -d --build toonflow` |

### Backup

```bash
docker compose stop studio toonflow
docker run --rm -v mochi_studioData:/a -v mochi_toonflowData:/b -v "$PWD":/out alpine \
  tar czf /out/mochi-backup-$(date +%F).tgz /a /b
docker compose start toonflow studio
```

Simpan file backup di luar VPS. Isinya data pengguna & konfigurasi Toonflow (termasuk API key) — perlakukan sebagai rahasia.

### Jangan pernah

- `docker compose down -v` — menghapus saldo kredit, video, dan konfigurasi.
- Membuka port 3000 ke publik — Toonflow tidak punya login.
- Menaruh API key provider di `.env`, repo, atau chat.

## Uji lokal tanpa VPS

```bash
cd studio && npm install && npm test   # Studio + mock Toonflow, tanpa biaya model
```

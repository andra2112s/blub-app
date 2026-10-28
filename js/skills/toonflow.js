/* ── POWER: Toonflow ──
   Memandu pengguna memasang Toonflow (Docker) langkah demi langkah.
   Mochi tidak punya akses terminal: pengguna menjalankan perintah sendiri
   lalu menempel hasilnya kembali ke chat. */

const RULES = [
  'Clone hanya dari `https://github.com/HBAI-Ltd/Toonflow-app.git` — jangan fork/mirror (ada fork lama berlisensi AGPL).',
  'Jangan pernah `docker compose down -v` (menghapus volume data). `docker compose down` tanpa -v aman.',
  'Jangan buka port 3000 ke jaringan publik — aplikasi ini tidak punya login.',
  'API key jangan ditulis di file, log, commit, atau chat. Isi sendiri lewat halaman web Toonflow.',
  'Jangan mematikan proteksi keamanan OS (mis. `sudo spctl --master-disable`).',
  'Jangan jalankan perintah di luar panduan tanpa tanya dulu (hapus file, firewall, install software).',
  'Kalau satu langkah gagal: berhenti, tempel error lengkap ke aku, lalu kita putuskan bareng.'
];

const STEPS = [
  {
    title: 'Cek prasyarat',
    body: [
      'Jalankan satu per satu (Bash & PowerShell sama):',
      '`git --version`',
      '`docker --version`',
      '`docker compose version`',
      '`docker info`',
      'Di Windows/macOS pastikan Docker Desktop jalan dalam mode **Linux containers**. Tutup aplikasi berat & pastikan disk cukup. Kalau ada yang gagal, tempel error-nya ke aku.'
    ]
  },
  {
    title: 'Clone & cek lisensi',
    body: [
      '`git clone https://github.com/HBAI-Ltd/Toonflow-app.git`',
      '`cd Toonflow-app`',
      '`git describe --tags`',
      'Bash: `head -5 LICENSE` · PowerShell: `Get-Content LICENSE -TotalCount 5`',
      'Baris pertama LICENSE harus **MIT**. Kalau bukan, berhenti & kabari aku versinya. Catat hasil `git describe --tags`.'
    ]
  },
  {
    title: 'Periksa pemetaan port',
    body: [
      'Buka `compose.yaml`, cari bagian `ports:` milik service `toonflow`, lalu tempel isinya ke aku.',
      'Kalau tertulis `3000:3000` (semua interface), sebaiknya diubah jadi `"127.0.0.1:3000:3000"` supaya cuma bisa diakses dari komputer ini. Ubah hanya kalau kamu setuju.',
      'Kalau `ports:` tidak ada / beda, kabari aku dulu.'
    ]
  },
  {
    title: 'Build & jalankan',
    body: [
      '`docker compose up -d --build`',
      'Build pertama lama (kompilasi node, tools, Web, Server) — jangan disela.',
      'Kalau gagal: `docker compose logs --tail 100` lalu tempel ke aku. Biasanya karena memori Docker kurang, koneksi putus, atau port 3000 sudah dipakai.'
    ]
  },
  {
    title: 'Verifikasi',
    body: [
      '`docker compose ps`',
      '`docker compose logs --tail 50 toonflow`',
      'Cari tanda layanan naik (README server menyebut "服务启动成功"). Lalu tes:',
      'Bash: `curl -I http://127.0.0.1:3000`',
      'PowerShell: `Invoke-WebRequest http://127.0.0.1:3000 -UseBasicParsing | Select-Object StatusCode`',
      'Buka http://127.0.0.1:3000 di browser. Halaman tampil? Lanjut!'
    ]
  },
  {
    title: 'Akses remote (hanya kalau dipasang di server)',
    body: [
      'Jangan buka port 3000 ke internet — tutup di firewall/security group. Akses lewat SSH tunnel dari laptop:',
      '`ssh -N -L 3000:127.0.0.1:3000 user@alamat-server`',
      'Biarkan sesi SSH terbuka, lalu buka http://127.0.0.1:3000 di laptop. Untuk akses permanen pakai reverse proxy + autentikasi (atur hanya kalau kamu setuju).'
    ]
  },
  {
    title: 'Konfigurasi awal (kamu sendiri)',
    body: [
      '1. Di dialog "pilih direktori kerja server", pilih workspace `myProject` (proyek baru: tombol "Buat folder").',
      '2. Ganti bahasa antarmuka ke **Bahasa Indonesia**.',
      '3. Masukkan API key model di halaman konfigurasi — pakai key khusus uji coba bersaldo kecil, matikan top-up otomatis. Batas pengeluaran diatur di dasbor penyedia, bukan di Toonflow.',
      'Ingat: jangan kirim API key ke aku ya. 🔒'
    ]
  },
  {
    title: 'Uji coba satu episode kecil',
    body: [
      'Target: 1 karakter, 1 scene, 3 shot × ~5 detik. Buat karakter + tampak tiga sisi dulu, pakai sebagai referensi di ketiga shot.',
      'Gambaran biaya dari README: film ~2 menit ≈ ¥130 (video ~¥120, bahasa ~¥10, gambar <¥1) dengan Seedance 2.0, GPT Image 2, Claude Opus 4.6 — satu kasus saja, cek biaya asli di dasbor penyedia.',
      'Nilai: konsistensi wajah/kostum antar shot, kualitas gerak & kesesuaian prompt, kerapian terjemahan Indonesia, biaya per detik video.',
      'Catatan: Toonflow berhenti di pratinjau/pengaturan/unduh klip — editing akhir, suara, & timeline di aplikasi lain.'
    ]
  },
  {
    title: 'Backup',
    body: [
      '`docker compose stop`',
      '`docker compose cp toonflow:/app/data ./toonflowBackup`',
      '`docker compose start`',
      'Simpan `toonflowBackup` di luar folder repo & jangan di-commit (bisa berisi konfigurasi sensitif).'
    ]
  }
];

const DAILY = [
  '`docker compose logs -f toonflow` — lihat log',
  '`docker compose stop` — hentikan',
  '`docker compose start` — nyalakan lagi',
  '`docker compose down` — hapus kontainer, data tetap aman',
  '⚠️ Jangan pakai `docker compose down -v`.'
];

const TROUBLE = [
  '**Port 3000 dipakai**: cari prosesnya, lalu ubah pemetaan port (setelah kamu setuju).',
  '**Build gagal / kehabisan memori**: naikkan memori di Docker Desktop, tutup aplikasi berat, ulangi `docker compose up -d --build`.',
  '**Halaman tidak muncul**: cek `docker compose ps` & `docker compose logs --tail 100 toonflow`, tempel ke aku.',
  '**Aneh setelah update**: pakai tag rilis resmi, bukan branch yang sedang berubah — plugin & API bisa bergeser antar versi.'
];

const REPORT = [
  '1. Versi terpasang (`git describe --tags`) & baris lisensi.',
  '2. Port terikat ke 127.0.0.1 atau semua interface + perubahan yang kamu setujui.',
  '3. Status `docker compose ps`.',
  '4. Perintah yang dijalankan & error yang muncul.',
  '5. Hasil uji coba & biaya.'
];

const FACTS = [
  'Repo HBAI-Ltd/Toonflow-app, lisensi sekarang MIT (lama: AGPL-3.0 sebelum v1.0.8; Apache-2.0 + ketentuan tambahan v1.0.8–v1.1.8; perubahan tidak berlaku surut).',
  'Docker berbasis Bun 1.3.14, image sudah berisi FFmpeg.',
  'Port 3000, alamat lokal http://127.0.0.1:3000. Service Compose: toonflow.',
  'Data (konfigurasi, plugin, proyek) di volume Docker toonflowData → /app/data/ di kontainer.',
  'API key diisi di halaman aplikasi, bukan file konfigurasi.',
  'Belum diverifikasi: isi compose.yaml, kebutuhan RAM/disk, pesan sukses log Docker, harga model. Kalau README repo berbeda, README yang menang.'
];

const bullets = (arr) => arr.map((l) => '• ' + l).join('\n');
const fmtStep = (i) => {
  const s = STEPS[i];
  const nav = i < STEPS.length - 1 ? `\n\nSudah? Ketik **lanjut** (atau "toonflow langkah ${i + 2}"). Gagal? Tempel error-nya ke aku.` : '\n\nSelesai! 🎉 Ketik "toonflow laporan" buat ringkasan akhir.';
  return `🎬 **Toonflow · Langkah ${i}/${STEPS.length - 1}: ${s.title}**\n${s.body.join('\n')}${nav}`;
};

const overview = () =>
  `🎬 **POWER Toonflow aktif!** Aku pandu kamu pasang Toonflow (studio film AI) pakai Docker — kamu jalankan perintahnya, aku yang ngarahin.\n\n` +
  STEPS.map((s, i) => `${i}. ${s.title}`).join('\n') +
  `\n\nPerintah: "toonflow langkah 0", "lanjut", "toonflow aturan", "toonflow perintah", "toonflow error", "toonflow backup", "toonflow laporan", "toonflow stop".`;

export const toonflow = {
  id: 'toonflow',
  emoji: '🎬',
  name: 'Toonflow',
  hint: '"toonflow" — panduan pasang Toonflow sendiri (admin/Docker)',
  trigger: /\btoon\s?flow\b/i,
  step: -1,

  // Jawaban lokal untuk perintah eksplisit. null = pertanyaan bebas → serahkan ke LLM.
  local(t, active) {
    const has = this.trigger.test(t);
    if (has && /\b(stop|keluar|selesai|matikan|off)\b/.test(t)) {
      this.step = -1;
      return { text: 'Oke, POWER Toonflow kumatikan. Ketik "toonflow" kapan pun mau lanjut lagi. 🎬', state: 'happy', deactivate: true };
    }
    const n = t.match(/\b(?:langkah|step|tahap)\s*(\d{1,2})\b/);
    if (n && (has || active)) {
      const i = +n[1];
      if (i >= STEPS.length) return { text: `Langkahnya cuma 0–${STEPS.length - 1} ya. 🎬`, state: 'confuse' };
      this.step = i;
      return { text: fmtStep(i), state: 'think' };
    }
    if (active && /^(lanjut|next|berikutnya|terus|oke lanjut|ok lanjut|sip lanjut|udah|sudah|done|beres)[.! ]*$/.test(t)) {
      this.step = Math.min(this.step + 1, STEPS.length - 1);
      return { text: fmtStep(this.step), state: 'excite' };
    }
    if (!has) return null;
    if (/\b(aturan|rules?|larangan)\b/.test(t)) return { text: `🛑 **Aturan keras Toonflow**\n${bullets(RULES)}`, state: 'think' };
    if (/\b(perintah|harian|command)\b/.test(t)) return { text: `🧰 **Perintah harian** (jalankan di folder Toonflow-app)\n${bullets(DAILY)}`, state: 'think' };
    if (/\b(error|gagal|troubleshoot\w*|masalah|rusak)\b/.test(t) && t.length < 40) return { text: `🩺 **Troubleshooting Toonflow**\n${bullets(TROUBLE)}\n\nTempel log/error lengkapnya ke aku biar kubantu baca.`, state: 'think' };
    if (/\bbackup\b/.test(t)) { this.step = 8; return { text: fmtStep(8), state: 'think' }; }
    if (/\b(laporan|report|ringkasan)\b/.test(t)) return { text: `📋 **Laporan akhir Toonflow** — kirim ke aku:\n${REPORT.join('\n')}`, state: 'think' };
    if (/\b(fakta|info|tentang|apa itu)\b/.test(t)) return { text: `ℹ️ **Toonflow**\n${bullets(FACTS)}`, state: 'think' };
    if (/^(?:power\s+|mode\s+|setup\s+|pasang\s+|install\s+|mulai\s+|aktifkan\s+)?toon\s?flow[.!? ]*$/.test(t)) return { text: overview(), state: 'excite' };
    return null;
  },

  // Fallback kalau LLM tidak tersedia
  fallback() { return this.step >= 0 ? fmtStep(this.step) : overview(); },

  // Pengetahuan yang disuntikkan ke system prompt LLM saat POWER aktif
  prompt() {
    return [
      'POWER AKTIF: Toonflow — kamu memandu pengguna memasang Toonflow (Docker). Kamu TIDAK punya akses terminal: berikan perintah, pengguna menjalankannya lalu menempel hasil. Pandu satu langkah per jawaban, boleh lebih dari 3 kalimat. Tulis tiap perintah di baris sendiri dalam `backtick`.',
      this.step >= 0 ? `Pengguna sedang di langkah ${this.step} (${STEPS[this.step].title}).` : '',
      'Aturan keras (wajib):\n' + RULES.map((r) => '- ' + r).join('\n') + '\n- Jangan pernah meminta pengguna mengirim API key ke chat.',
      'Fakta:\n' + FACTS.map((f) => '- ' + f).join('\n'),
      'Langkah:\n' + STEPS.map((s, i) => `${i}. ${s.title}: ${s.body.join(' ')}`).join('\n'),
      'Perintah harian:\n' + DAILY.join('\n'),
      'Troubleshooting:\n' + TROUBLE.join('\n'),
      'Laporan akhir:\n' + REPORT.join('\n')
    ].filter(Boolean).join('\n\n');
  }
};

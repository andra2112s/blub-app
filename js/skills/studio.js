/* ── POWER: Studio ──
   "bikinin video kucing astronot" → buka Mochi Studio dengan ide terisi.
   Pembuatan video sungguhan terjadi di server Studio (VPS) lewat Toonflow. */

const VIDEO = '(?:video|film|animasi|klip|clip|kartun|reels?)';
const ASK = new RegExp(String.raw`\b(?:(?:bikin|buat|bkin)(?:in|kan|kn)?|generate|create|make)\s+(?:\w+\s+){0,3}?${VIDEO}\b`, 'i');

export const studio = {
  id: 'studio',
  emoji: '🎬',
  name: 'Studio',
  hint: '"bikinin video kucing astronot" — bikin video AI',
  trigger: new RegExp(String.raw`${ASK.source}|\bmochi\s?studio\b|^(?:buka\s+)?studio[.!? ]*$`, 'i'),

  local(t) {
    if (/^(?:cara|gimana|bagaimana|gmn|tips|tutorial|kenapa|berapa)\b/.test(t)) return null;
    const m = t.match(new RegExp(String.raw`${VIDEO}\b\s*(?:tentang|soal|yang|ttg|:|-)?\s*(.*)$`, 'i'));
    const idea = ASK.test(t) ? (m?.[1] || '').replace(/[.!?]+$/, '').trim() : '';
    return {
      text: idea.length >= 5
        ? `Siap! Kubuka Studio dengan ide **${idea}** 🎬 Pilih paketnya, lalu tap **Buat Video** — nanti kukabari kalau sudah jadi.`
        : 'Yuk bikin video! 🎬 Kubuka Studio — ceritakan idemu di sana, Mochi yang susun cerita, gambar karakter, dan bikin klipnya.',
      state: 'excite',
      studio: { idea: idea.length >= 5 ? idea : '' }
    };
  },

  fallback() {
    return 'Mau bikin video? Ketik misalnya "bikinin video naga lucu takut gelap" atau buka menu 🎬 Studio.';
  },

  prompt() {
    return [
      'POWER AKTIF: Studio — kamu bisa membuatkan video AI pendek (vertikal 9:16) lewat Mochi Studio.',
      '- Kalau pengguna ingin dibuatkan video/animasi/film, panggil tool open_studio dengan ide yang sudah dirangkum jelas (karakter, aksi, suasana).',
      '- Prosesnya: pengguna login Google, memakai kredit (beli via QRIS), Mochi menyusun cerita → gambar karakter → beberapa klip video. Gagal = kredit kembali.',
      '- Jangan menjanjikan durasi, harga, atau kualitas tertentu; semuanya terlihat di Studio.',
      '- Konten seksual, kekerasan sadis, kebencian, dan tokoh nyata akan ditolak otomatis.'
    ].join('\n');
  }
};

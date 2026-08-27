# Credits

## Mesin avatar — jeremy-prt/bloub (MIT)

File `js/bloub-engine.js` adalah bundle esbuild dari folder `src/bot/` proyek
[bloub](https://github.com/jeremy-prt/bloub) oleh Jérémy Perret, tanpa
modifikasi logika:

```
MIT License
Copyright (c) 2026 Jérémy Perret
```

Lisensi lengkap: https://github.com/jeremy-prt/bloub/blob/main/LICENSE

Yang diambil dari sana:
- `BotEngine`: mesin sampling murni-fungsi-waktu (morph radial profile,
  ease-out quintic terukur, kedip penutup transisi, liveliness loop-noise)
- 15 state animasi asli (`idle`, `thinking`, `wink`, `wide`, `play`, `sleep`, dst)
- 16 ekspresi wajah asli (`heureux`, `triste`, `curieux`, `somnolent`, dst)
- 8 bentuk badan & 12 warna dari personalisasi bawaan

Sambungan ke aplikasi chat (render frame → SVG, pemetaan mood → state/ekspresi)
ada di `js/blubbot.js` dan merupakan kode orisinal aplikasi ini.

Catatan: lisensi MIT proyek asal mencakup kodenya, bukan desain yang ditirunya.

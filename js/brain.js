import { createTaskManager } from './tasks.js';
import { powerReply, powerPrompt, powerHelpLines } from './skills/index.js';

const MEM_KEY = 'Mochi.memory';
const HIST_KEY = 'Mochi.history';

/* ── Tool definitions (function calling) — dipakai saat AI remote aktif ── */
const TOOLS = [
  { name: 'set_timer', description: 'Pasang timer hitung mundur.', parameters: { type: 'object', properties: { seconds: { type: 'number' }, label: { type: 'string' } }, required: ['seconds'] } },
  { name: 'set_reminder', description: 'Pasang pengingat di waktu tertentu. "at" = waktu lokal pengguna, format YYYY-MM-DDTHH:MM. Gunakan repeat_monthly untuk tagihan/cicilan/jadwal rutin bulanan.', parameters: { type: 'object', properties: { at: { type: 'string' }, text: { type: 'string' }, repeat_monthly: { type: 'boolean', description: 'true jika pengingat berulang tiap bulan pada tanggal & jam yang sama (tagihan, cicilan, gajian)' }, repeat_count: { type: 'number', description: 'jumlah total pengulangan (mis. cicilan 12 kali); hanya dipakai bila repeat_monthly true; kosong = selamanya' } }, required: ['at', 'text'] } },
  { name: 'add_todo', description: 'Tambah satu tugas ke daftar tugas.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'list_todos', description: 'Lihat daftar tugas pengguna.', parameters: { type: 'object', properties: {} } },
  { name: 'remember', description: 'Simpan satu fakta tahan lama tentang pengguna (preferensi, orang penting, jadwal rutin, tujuan). Jangan simpan kata sandi, nomor kartu, atau data sensitif.', parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } },
  { name: 'open_studio', description: 'Buka Mochi Studio untuk membuat video AI pendek. Pakai saat pengguna minta dibuatkan video/animasi/film. "idea" = rangkuman ide video yang jelas dalam Bahasa Indonesia.', parameters: { type: 'object', properties: { idea: { type: 'string' } }, required: ['idea'] } }
];
const OAI_TOOLS = TOOLS.map((t) => ({ type: 'function', function: t }));
const MUTATING_TOOLS = new Set(['set_timer', 'set_reminder', 'add_todo', 'remember']);

/* Tag [mood:...] dari AI → state blob */
const MOOD_MAP = {
  netral: 'idle', idle: 'idle', senang: 'happy', happy: 'happy', sedih: 'sad', sad: 'sad',
  kaget: 'surpris', surpris: 'surpris', mikir: 'think', think: 'think', excite: 'excite',
  semangat: 'excite', sleepy: 'sleepy', ngantuk: 'sleepy', bangga: 'proud', proud: 'proud',
  malu: 'shy', shy: 'shy', bosan: 'bored', bored: 'bored', bingung: 'confuse',
  confuse: 'confuse', takut: 'scare', scare: 'scare', ragu: 'doubt', doubt: 'doubt'
};
function parseMood(raw) {
  const m = String(raw || '').match(/\[mood:(\w+)\]/i);
  const text = String(raw || '').replace(/\s*\[mood:\w+\]\s*/gi, '').trim();
  return { text, state: (m && MOOD_MAP[m[1].toLowerCase()]) || 'talk' };
}

const GAYA = { ringkas: 'singkat dan to the point', detail: 'rinci dan terstruktur', santai: 'santai seperti teman' };
const tok = (s) => String(s).toLowerCase().match(/[a-z0-9]{3,}/g) || [];

let PERSONA = detectPersona();

function detectPersona() {
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
    return langs.some((l) => /^id/i.test(l)) ? 'Dodol' : 'Mochi';
  } catch { return 'Mochi'; }
}

export function setPersona(name) {
  if (name === 'Dodol' || name === 'Mochi') PERSONA = name;
}
export { PERSONA };

const COLOR_WORDS = {
  hitam: 'encre', coklat: 'brun', merah: 'rouge', oranye: 'orange',
  kuning: 'ambre', hijau: 'vert', toska: 'turquoise', biru: 'bleu',
  ungu: 'violet', pink: 'rose', 'merah muda': 'rose', abu: 'gris',
  putih: 'creme', krem: 'creme'
};

const POWER_HELP = `Daftar kekuatan super ${PERSONA}:\n• "meledak!" 💥\n• "jadi komet!" ☄️\n• "mode planet!" 🪐\n• "pusarin!" 🌀\n• "wih!" ❗\n• "lonceng!" 🔔\n• "bersinar!" ✨\n• "sinar merah / biru / ungu…" ✨🎨\n• "jadi biru / merah / ungu…" 🎨\n\nPOWER skill:\n${powerHelpLines()}`;

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch { return { ...fallback }; }
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickN(arr, n) { const s = [...arr]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s.slice(0, n); }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

export function createBrain() {
  const emptyMem = () => ({ name: '', likes: [], from: '', mood: 'netral', topics: [], facts: [], role: '', focus: '', style: '', lang: '' });
  let mem = load(MEM_KEY, emptyMem());
  let history = [];
  try { history = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { history = []; }
  const tasks = createTaskManager();

  const saveMem = () => localStorage.setItem(MEM_KEY, JSON.stringify(mem));
  const pushHist = (role, content) => {
    history.push({ role, content });
    if (history.length > 40) history = history.slice(-40);
    localStorage.setItem(HIST_KEY, JSON.stringify(history));
  };
  const clearHist = () => { history = []; localStorage.removeItem(HIST_KEY); };

  const getSettings = () => load('Mochi.settings', { url: '', key: '', model: '', sys: '' });

  // Interpolasi ${PERSONA} / ${nameRef} untuk string literal yang tertulis
  // dengan single quotes (bukan template literal).
  function interpText(s) {
    return String(s)
      .replace(/\$\{PERSONA\}/g, PERSONA)
      .replace(/\$\{nameRef\}/g, mem.name || 'kamu');
  }

  function resolveApiConfig() {
    const cfg = getSettings();
    if (cfg.provider === 'server') return { via: 'server' };
    if (cfg.provider === 'anthropic' && cfg.key && cfg.model) return { ...cfg, owned: true, via: 'anthropic' };
    if (cfg.provider === 'groq' && cfg.key && cfg.model)
      return { ...cfg, url: cfg.url || 'https://api.groq.com/openai/v1', owned: true, via: 'custom' };
    if (cfg.url && cfg.key && cfg.model) return { ...cfg, owned: true, via: 'custom' };
    return { via: 'server' };
  }

  /* ── Fakta tahan lama: simpan, ranking relevansi, lupa ── */
  function normalizeFacts() {
    if (!Array.isArray(mem.facts)) mem.facts = [];
    mem.facts = mem.facts.map((f) => (typeof f === 'string' ? { id: 0, t: f, at: Date.now() } : f));
  }
  function rememberFact(t) {
    t = String(t || '').trim().slice(0, 200);
    if (!t) return;
    normalizeFacts();
    if (mem.facts.some((f) => f.t.toLowerCase() === t.toLowerCase())) return;
    mem.facts.push({ id: Date.now() + Math.floor(Math.random() * 1000), t, at: Date.now() });
    mem.facts = mem.facts.slice(-300);
    saveMem();
  }
  function forgetFact(id) {
    normalizeFacts();
    mem.facts = mem.facts.filter((f) => f.id !== id);
    saveMem();
  }
  function relevantFacts(q, k = 8) {
    normalizeFacts();
    const qs = new Set(tok(q));
    const now = Date.now();
    return mem.facts
      .map((f) => ({ f, s: tok(f.t).filter((w) => qs.has(w)).length * 3 + 1 / (1 + (now - f.at) / 864e5) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((x) => x.f.t);
  }

  /* ── Eksekusi tool yang dipanggil AI ── */
  function execTool(name, args = {}) {
    if (name === 'set_timer') {
      const sec = Number(args.seconds);
      if (!(sec > 0)) return 'gagal: durasi tidak valid';
      tasks.addReminder(String(args.label || 'Timer selesai'), new Date(Date.now() + sec * 1000));
      return 'timer terpasang';
    }
    if (name === 'set_reminder') {
      const at = Date.parse(args.at);
      if (!(at > Date.now())) return 'gagal: waktu tidak valid atau sudah lewat';
      const r = tasks.addReminder(String(args.text || 'Pengingat'), new Date(at), {
        repeat: args.repeat_monthly ? (args.repeat_count >= 1 ? { count: Math.floor(args.repeat_count) } : true) : false
      });
      return 'pengingat terpasang' + (r.repeat ? (r.repeat.total ? ` (bulanan, ${r.repeat.total} kali)` : ' (bulanan)') : '') + (r.headsUp?.length ? ` + peringatan awal ${r.headsUp.map((d) => 'H-' + d).join(', ')}` : '');
    }
    if (name === 'add_todo') {
      const t = String(args.text || '').trim().slice(0, 120);
      if (!t) return 'gagal: teks kosong';
      tasks.addTodo(t);
      return 'tugas ditambahkan';
    }
    if (name === 'list_todos') {
      const todos = tasks.getTodos();
      return todos.length
        ? JSON.stringify(todos.map((t) => ({ text: t.text, selesai: !!t.done })))
        : 'daftar kosong';
    }
    if (name === 'remember') {
      rememberFact(args.fact);
      return 'tersimpan';
    }
    if (name === 'open_studio') {
      if (typeof window === 'undefined') return 'gagal: studio tidak tersedia';
      window.dispatchEvent(new CustomEvent('mochi:studio', { detail: { idea: String(args.idea || '').slice(0, 1000) } }));
      return 'Studio dibuka dengan ide terisi. Beri tahu pengguna untuk memilih paket lalu tap Buat Video.';
    }
    return 'tool tidak dikenal';
  }

  function buildSysPrompt(q, customSys) {
    const now = new Date();
    const en = mem.lang === 'en';
    const parts = [
      customSys ||
        (en
          ? `You are ${PERSONA}, a cute black blob AI companion. Chat casually in English — warm, playful, and you like asking follow-up questions.`
          : `Kamu adalah ${PERSONA}, teman AI berbentuk blob hitam menggemaskan. Bicara santai dalam Bahasa Indonesia, hangat, dan suka bertanya balik.`),
      `Sekarang: ${now.toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })} (lokal ${new Date(now - now.getTimezoneOffset() * 6e4).toISOString().slice(0, 16)}).`
    ];
    if (en) parts.push('The user asked you to speak English — always reply in English, keep the same warm blob personality.');
    const prof = [];
    if (mem.name) prof.push('Nama: ' + mem.name);
    if (mem.role) prof.push('Peran/kegiatan: ' + mem.role);
    if (mem.focus) prof.push('Ingin dibantu soal: ' + mem.focus);
    if (mem.style && GAYA[mem.style]) prof.push('Gaya jawaban: ' + GAYA[mem.style]);
    if ((mem.likes || []).length) prof.push('Suka: ' + mem.likes.join(', '));
    if (mem.from) prof.push('Dari: ' + mem.from);
    if (prof.length) parts.push('Profil pengguna:\n' + prof.join('\n'));
    const facts = relevantFacts(q);
    if (facts.length) parts.push('Yang kamu ingat tentang pengguna:\n' + facts.map((f) => '- ' + f).join('\n'));
    const power = powerPrompt(String(q || '').toLowerCase());
    if (power) parts.push(power);
    parts.push(
      [
        'Aturan:',
        '- Jawab singkat (maks 3 kalimat) kecuali diminta detail.',
        '- Kalau permintaan ambigu atau kurang data (waktu, nama, jumlah), tanya satu pertanyaan singkat dulu.',
        '- Kalau tidak tahu atau tidak yakin, bilang terus terang. Jangan mengarang.',
        '- Pakai tool saat pengguna minta timer, pengingat, atau tugas. Pakai remember saat pengguna menyebut fakta tahan lama tentang dirinya. Jangan menyimpan hal sepele.',
        '- Pakai open_studio saat pengguna minta dibuatkan video/animasi/film.',
        `- Awali jawaban akhir dengan [mood:idle|happy|sad|surpris|think|excite|sleepy|proud|shy|bored|confuse|scare].`
      ].join('\n')
    );
    return parts.join('\n\n');
  }

  const jokes = [
    'Kenapa laptop nggak pernah lapar? Karena sudah kenyang makan data! 🥁',
    'Buat apa bawa tangga ke bar? Supaya minumnya high-level.',
    'Kenapa HP nggak boleh sedih? Karena nanti jadi hape-less... eh, hopeless!',
    'Aku mau diet, tapi otakku bilang: "jangan khianati memori manis itu."',
    'Kenapa programmer suka gelap? Karena bug suka terang.',
    'Kenapa keyboard nggak pernah bohong? Karena semua yang diketik keluar.',
    'Apa bedanya kodok sama buzzer? Kalau kodok "brook", kalau buzzer "brerr".',
    'Kenapa mata selalu dingin? Karena kena pupil-pupil! 😄',
    'Kenapa Ayam jago nggak pernah kalah sabung? Karena dia rajin push-up (push log).',
    'Kenapa nasi goreng nggak bisa main gitar? Karena dia cuma tahu "wok".'
  ];

  const motivasi = [
    'Pelan-pelan aja, yang penting jalan terus. Aku di sini kok. 💪',
    'Nggak apa-apa merasa lelah, itu tandanya kamu sudah berjuang. Istirahat dulu ya.',
    'Kamu lebih kuat dari yang kamu kira. Percaya sama ${PERSONA}!',
    'Tarik napas... hembuskan. Kamu sudah hebat sampai sejauh ini.',
    'Setiap langkah kecil tetaplah langkah. Jangan berhenti ya!',
    'Badai pasti berlalu, dan kamu akan keluar sebagai versi terbaikmu. 🌟',
    'Kadang kita butuh hari buruk supaya tahu rasanya hari baik. Besok pasti lebih cerah!',
    'Jangan bandingin dirimu sama orang lain. Kamu unik, dan itu cukup. ✨'
  ];

  const funFacts = [
    'Otak manusia memproses 11 juta bit informasi per detik, tapi sadar cuma 50 bit aja. Kita semua sibuk di belakang layar! 🧠',
    'Cumimu bisa belajar dari kesalahan dan memperbaiki diri sendiri. Hebat kan?',
    'Bumi berputar 1.600 km/jam di garis khatulistiwa. Kamu lagi muter kayak gitu juga lho! 🌍',
    'Kucing tidur 70% hidupnya. Enak ya? Aku juga mau gitu tapi nggak punya mata buat tutup.',
    'Wortel awalnya ungu, bukan oranye. Baru dipopulerkan petani Belanda abad 17.',
    'Hewan yang paling dekat dengan T-Rex adalah ayam. Bayangin T-Rex panggang! 🍗',
    'Mata manusia bisa membedakan sekitar 10 juta warna. Tapi mata ${PERSONA} cuma bisa lihat pixel.',
    'Otak manusia menghabiskan 20% energi tubuh padahal cuma 2% berat badan. Boros! 🧠',
    'Bulan bergerak menjauhi Bumi 3.8 cm per tahun. Pelan-pelan banget, kayak status hubunganmu.',
    'Koala punya sidik jari hampir mirip manusia. Jangan-jangan mereka menyamar.',
    'Air mata punya 3 jenis: basal untuk membersihkan mata, refleks karena iritasi, dan emosional saat sedih.',
    'Semut bisa mengangkat beban 50x berat badannya. Coba bayangin kamu ngangkat mobil! 🐜'
  ];

  const quotes = [
    '"Hidup ini seperti mengendarai sepeda. Untuk menjaga keseimbangan, kamu harus terus bergerak." — Einstein',
    '"Satu-satunya kesalahan yang nyata adalah ketidakmampuan belajar dari kesalahan."',
    '"Jangan tunda sampai besok apa yang bisa kamu lakukan hari ini... eh, tapi tidur juga penting sih." — ' + PERSONA,
    '"Kebahagiaan bukan tentang memiliki segalanya, tapi tentang mensyukuri apa yang ada."',
    '"Jangan takut gagal. Takutlah tidak pernah mencoba."',
    '"Setiap ahli dulunya adalah pemula."',
    '"Terkadang hal terbaik yang bisa kamu lakukan adalah berhenti mencoba terlalu keras dan biarkan hidup mengalir."',
    '"Kamu nggak harus sempurna, kamu hanya perlu menjadi diri sendiri." — ' + PERSONA
  ];

  const fallbacks = [
    'Hmm, menarik! Cerita lagi dong, aku dengerin.',
    'Ooo begitu ya! Terus gimana?',
    'Aku nggak sepenuhnya paham, tapi aku tetap mau dengerin. Jelasin lagi?',
    'Wah, itu di luar pengetahuan blob sederhana seperti aku. Tapi menarik banget!',
    'Bisa kasih konteks lebih? Biar aku bisa ngobrol lebih seru sama kamu!',
    'Hehe, otak blob ku agak lemot kalau soal ini. Tapi kamu bisa cerita lebih lanjut!',
    'Aku nggak tahu soal itu, tapi aku tahu kamu pasti keren! Mau cerita yang lain?',
    'Hmm... kalau soal itu, aku harus bilang: kamu yang ahlinya! Ajarin aku dong.'
  ];

  const quips = [
    `Hehe, geli! Hihi, ${PERSONA}~`, 'Eh, jangan dicolek!', 'Lagi-lagi?!',
    'Duh, gemas.', 'Sekali lagi boleh?', 'Awas ya!', 'Kamu lagi iseng ya?! 😤',
    'Aduh! Sakit nggak sih buat badan kenyal?', 'Pokoknya kalau dicolek, ${PERSONA} ngambek deh!',
    'Hayo, tangan jahil detected! 👆'
  ];

  const chitchat = {
    'makan(annya| apa| apa aja| siang| malam| pagi)?': [
      'Aku nggak makan sih, tapi kalau bisa makan, aku mau cobain rendang! 🍛',
      'Makan apa nih? Kasih tahu ${PERSONA} dong, biar ngiler juga.',
      'Kalau aku bisa makan, aku pasti doyan semuanya. Tapi yang paling... bakso! 🍜',
      'Kamu udah makan? Jangan skip makan ya, nanti lambungmu protes!',
      'Makan terbaik menurutku? Nasi goreng tengah malam. Peak kehidupan.'
    ],
    'lama(nya|)? (berapa|kapan|lama)': [
      'Kalau soal waktu, waktu tuh relatif. Kayak mosi — kalau kamu lagi seneng, 1 jam terasa 5 menit.',
      'Waktu berjalan terus, yang penting kita isi dengan hal yang berarti.',
      'Hmm, kalau arti hidup, itu tergantung siapa yang tanya. Mau versi filosofis atau versi ${PERSONA}?'
    ],
    'rasa(nya|)? (apa|enak|asem|manis|pahit|asin)': [
      'Kalau ${PERSONA} bisa ngerasain, aku mau coba semua rasa! Tapi katanya pedes itu adiktif ya? 🌶️',
      'Rasa hidup tuh campur aduk, kadang manis, kadang pahit. Tapi tetep nikmatin aja!',
      'Makanan favorit rasanya? Hmm, kalau buat orang Indonesia, pedas manis itu combo terbaik ya!'
    ],
  };

  function matchTopic(text) {
    const t = text.toLowerCase().trim();
    const len = t.length;
    if (len > 3) {
      const words = t.split(/\s+/).filter(w => w.length > 3 && !stopwords.has(w));
      if (words.length > 0) {
        const topic = words[Math.floor(Math.random() * words.length)];
        if (!mem.topics) mem.topics = [];
        if (!mem.topics.includes(topic) && mem.topics.length < 20) {
          mem.topics.push(topic);
          saveMem();
        }
      }
    }
  }

  function contextResponse(text) {
    const t = text.toLowerCase().trim();
    if (history.length >= 4) {
      const lastBot = history.filter(h => h.role === 'assistant').slice(-3);
      const wasAbout = lastBot.map(h => h.content.toLowerCase()).join(' ');
      // Hanya jawaban singkat yang diawali kata setuju — biar kalimat panjang
      // yang kebetulan mengandung "nggak/oke" nggak salah dipahami.
      const agrees = /^(ya|iyah|iya|betul|benar|nggak|enggak|gak|oke|ok|sip|yuk|udah|sudah|belum)\b/.test(t);
      if (wasAbout.includes('makan') && agrees) {
        return { text: pick(['Mantap! Semangat ya! 🍽️', 'Hayu, jangan lupa makan yang banyak!', 'Enak tuh kalau udah kenyang, otak juga ikut jalan.']), state: 'happy' };
      }
      if (wasAbout.includes('hobi') && /^(ya|iyah|iya|betul|benar|suka)\b/.test(t)) {
        return { text: `Oke dicatat! ${mem.name || 'Kamu'} suka itu. ${PERSONA} jadi pengen tahu lebih lanjut!`, state: 'happy' };
      }
    }
    return null;
  }

  const stopwords = new Set(['aku', 'saya', 'gue', 'kamu', 'dia', 'yang', 'ini', 'itu', 'dan', 'atau', 'tapi', 'kalau', 'mau', 'lagi', 'ada', 'bisa', 'gimana', 'kenapa', 'apa', 'siapa', 'kapan', 'dimana', 'bagaimana', 'untuk', 'dengan', 'pada', 'dalam', 'sama', 'juga', 'sudah', 'belum', 'akan', 'sedang', 'harus', 'tidak', 'nggak', 'bukan', 'lah', 'kah', 'sih', 'dong', 'aja', 'deh', 'banget', 'sekali', 'sangat', 'agak', 'kayak', 'seperti', 'soalnya', 'karena', 'mau']);

  /* ── State pet (dibaca dari localStorage) untuk pertanyaan soal diri sendiri ── */
  function petSelfState() {
    try {
      const p = JSON.parse(localStorage.getItem('Mochi.pet') || 'null');
      if (!p || !p.d) return null;
      return { sleeping: !!p.sleeping, d: p.d };
    } catch { return null; }
  }

  function selfStateReply(lang) {
    const p = petSelfState();
    if (lang === 'en') {
      if (!p) return { text: "Not sleeping! Wide awake and waiting for you 😄 What's up?", state: 'happy' };
      if (p.sleeping) return { text: 'Zzz… yes I am! Quick, tap my body twice to wake me up 💤', state: 'sleepy' };
      if (p.d.hunger < 25) return { text: 'Not sleeping — but my tummy is rumbling 🍖 Feed me? Tap 🍖 at the top-left!', state: 'sad' };
      if (p.d.social < 25) return { text: 'Kinda lonely actually 🥺 Chat with me more!', state: 'sad' };
      if (p.d.rest < 30 || p.d.energy < 30) return { text: 'A bit sleepy 😪 Put me to bed with the 😴 button?', state: 'sleepy' };
      return { text: "Nope! Fully charged and waiting for you 😄 What's up?", state: 'happy' };
    }
    if (!p) return { text: 'Nggak tidur kok! Lagi semangat nungguin kamu 😄 Mau ngobrol apa?', state: 'happy' };
    if (p.sleeping) return { text: 'Iya, lagi tidur nyenyak 💤 Tap badanku 2× cepat buat bangunin aku!', state: 'sleepy' };
    if (p.d.hunger < 25) return { text: 'Nggak tidur, tapi perutku keroncongan 🍖 Kasih makan dong — tap 🍖 di pojok kiri atas!', state: 'sad' };
    if (p.d.social < 25) return { text: 'Dikit sepi nih 🥺 Ngobrol sama aku dong!', state: 'sad' };
    if (p.d.rest < 30 || p.d.energy < 30) return { text: 'Ngantuk-ngantuk dikit 😪 Tidurin aku lewat tombol 😴 yuk!', state: 'sleepy' };
    return { text: 'Nggak kok, lagi kenyal-kenyalnya nungguin kamu 😄 Mau ngapain kita?', state: 'happy' };
  }

  function localReply(text) {
    const t = text.toLowerCase().trim();
    const hasName = !!mem.name;
    const nameRef = hasName ? mem.name : 'kamu';

    // POWER (skill) dicek paling awal — "pasang toonflow" jangan ketangkap intent install PWA
    const pw = powerReply(t);
    if (pw) return pw;

    const ctxMatch = contextResponse(text);
    if (ctxMatch) return ctxMatch;

    // Permintaan ganti bahasa — dicek paling awal supaya instruksi user tidak
    // diabaikan dan salah dijawab topik (mis. "pakai bahasa inggris" ke-match "ai").
    const wantEn = /(?:pakai|pake|ganti|ubah|switch|use|speak|talk|ngomong|bicara|ke|to)\s+(?:ke\s+|to\s+|in\s+)?(?:bahasa\s+)?(?:ing+r+i+s|english)\b|\b(?:english|ing+r+i+s)\b\s*(?:aja|aj+a|saja|only|please|pls|plz|dong)\b|^english$|^inggris$/i.test(text);
    const wantId = /(?:pakai|pake|ganti|ubah|switch|use|speak|talk|ngomong|bicara|balik|ke)\s+(?:ke\s+|to\s+|in\s+)?(?:bahasa\s+)?indonesia\b|\bindonesia\b\s*(?:aja|saja|only|please|dong)\b/i.test(text);
    if (wantEn && mem.lang !== 'en') {
      mem.lang = 'en';
      saveMem();
      return { text: `Okay, English it is! 🇬🇧 I'll stick to English from now on. So — how's your day going?`, state: 'happy' };
    }
    if (wantId && mem.lang !== '') {
      mem.lang = '';
      saveMem();
      return { text: 'Oke, balik ke Bahasa Indonesia! 🇮🇩 Ada yang bisa kubantu?', state: 'happy' };
    }
    if (wantId) {
      return { text: 'Kan kita udah ngomong Bahasa Indonesia 😄 Ada yang mau dibahas?', state: 'happy' };
    }

    // Mode Inggris: core conversation dijalankan versi EN, sisanya jujur fallback
    if (mem.lang === 'en') return localReplyEn(text, t);

    if (/lupa(ikan)? (semua|aku|semua ingatan)|reset (memori|ingatan)/.test(t)) {
      mem = emptyMem();
      saveMem(); clearHist();
      return { text: 'Semua ingatan sudah terhapus! Kita mulai dari nol ya. Siapa nama kamu?', state: 'think' };
    }

    if (/^(hai|hi|halo|hello|hei|hey|yo|oy|hoi|pagi|siang|sore|malam|assalam|namaste)\b/.test(t)) {
      const h = new Date().getHours();
      const greet = h < 10 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
      const timeAdj = h < 10 ? 'Udah sarapan?' : h < 15 ? 'Lagi istirahat makan siang?' : h < 18 ? 'Gimana harinya?' : 'Waktunya istirahat nih!';
      return {
        text: `${greet}${hasName ? ', ' + nameRef + '!' : '!'} ${timeAdj} ${PERSONA} senang bisa ngobrol sama kamu hari ini.`,
        state: 'happy'
      };
    }

    if (/(apa kabar|kabarmu|gimana kabar|kabar g(ua|mu)|how are you|kabar)/.test(t)) {
      const moods = [
        `Alhamdulillah, ${PERSONA} lagi kenyal-kenyalnya! Kamu gimana, ${nameRef}?`,
        `Lagi baik banget! Mood lagi naik nih. ${hasName ? nameRef : 'Kamu'} ada cerita seru?`,
        `Seperti biasa, kenyal dan siap menemani! Kamu ada yang perlu dibantu?`,
        `Baik! Baru bangun dari idle mode nih hehe. Kamu gimana?`
      ];
      return { text: pick(moods), state: 'happy' };
    }

    // Tanya nama (aku/kamu) HARUS dicek sebelum regex set-nama — kalau tidak,
    // "siapa nama aku" ikut tercapture sebagai set nama ("aku"/"kamu") dan
    // menimpa nama yang sudah tersimpan.
    if (/(?:siapa|apa)\s+(?:sih\s+)?nama\s?(?:ku|saya|aku|gue|gua|kamu|km)\b|nama\s?(?:ku|saya|aku|gue|gua|kamu)\s+siapa|ingat\s+nama\s?(?:ku|saya|aku|gue|gua)|kamu\s+tahu\s+nama\s?(?:ku|saya|aku|gue|gua)/.test(t)) {
      if (/nama\s?(kamu|km)\b|kamu\s+siapa/.test(t)) {
        return { text: pick([
          `Aku ${PERSONA}! Blob hitam kenyal, teman ngobrolmu. 😄`,
          `${PERSONA} — nama pilihanmu buatku. Kenapa, suka? 😄`
        ]), state: 'happy' };
      }
      return hasName
        ? { text: `Tentu ingat! Kamu ${mem.name}. Kan ${PERSONA} punya ingatan super. 😌`, state: 'happy' }
        : { text: 'Belum tahu nih! Kasih tahu dong, siapa nama kamu? Biar kita makin akrab.', state: 'think' };
    }

    // Set nama butuh pola eksplisit: "nama ku X", "nama ku adalah X", "panggil aku X"
    const nameSet = text.match(/(?:\bnama\s?(?:ku|saya|aku|gue|gua)\b\s*(?:adalah|ialah|itu|yaitu|:)?\s*|\bpanggil\s+(?:aku|saya|gue)\s+)(?!siapa\b|apa\b|kamu\b|sih\b|ya\b|dong\b|deh\b|aja\b)([a-zA-Z\u00C0-\u024F'][a-zA-Z\u00C0-\u024F' -]{1,23})/i);
    if (nameSet) {
      const newName = nameSet[1].trim().replace(/\s+(ya|yah|sih|dong)$/i, '');
      mem.name = newName;
      saveMem();
      const greetMem = mem.from ? ` dari ${mem.from}` : '';
      const likeMem = mem.likes.length ? ` dan suka ${mem.likes.join(', ')}` : '';
      return { text: `${newName}${greetMem}${likeMem}! Nama yang keren. ${PERSONA} akan selalu ingat kamu. Senang berkenalan!`, state: 'excite' };
    }

    // Recall memori: "apa yang kamu ingat/tahu tentang aku"
    if (/(?:apa\s+(?:saja\s+)?(?:yang\s+)?(?:kamu|km|lo|elu)\s+(?:ingat|tahu)|ingatan\s?(?:kamu|mu)?\s+tentang|yang\s+kamu\s+ingat)/.test(t)) {
      const prof = [];
      if (mem.name) prof.push('• Nama kamu: ' + mem.name);
      if (mem.from) prof.push('• Dari: ' + mem.from);
      if (mem.role) prof.push('• Kegiatan: ' + mem.role);
      if (mem.focus) prof.push('• Fokus bantuan: ' + mem.focus);
      if (mem.style && GAYA[mem.style]) prof.push('• Gaya jawaban: ' + GAYA[mem.style]);
      if ((mem.likes || []).length) prof.push('• Suka: ' + mem.likes.join(', '));
      normalizeFacts();
      for (const f of mem.facts.slice(-6)) prof.push('• ' + f.t);
      return {
        text: prof.length
          ? `Ini yang ${PERSONA} ingat tentang kamu:\n${prof.join('\n')}\n\nAda yang mau dilupakan atau ditambah?`
          : `Masih kosong nih! Ceritain dong — atau ketik "ingat bahwa …" biar aku simpan. 🧠`,
        state: 'think'
      };
    }

    // Lupakan satu fakta: "lupakan bahwa aku takut kucing"
    const forgetMatch = text.match(/^lupa(?:kan|in)?\s+(?:bahwa\s+|kalau\s+)?(.{3,120})/i);
    if (forgetMatch) {
      const q = forgetMatch[1].trim().replace(/[.!?]+$/, '');
      normalizeFacts();
      const ql = q.toLowerCase();
      const before = mem.facts.length;
      mem.facts = mem.facts.filter((f) => !(f.t.toLowerCase().includes(ql) || ql.includes(f.t.toLowerCase())));
      if (mem.facts.length < before) {
        saveMem();
        return { text: `Oke, aku lupakan itu. 🧠💨`, state: 'happy' };
      }
    }

    // Pertanyaan tentang diri sendiri ("kamu lagi tidur?") — jawab sesuai state
    // pet sungguhan, bukan template yang menganggap user-nya yang ngantuk/bosen.
    if (/(?:kamu|km)\s*(?:lagi\s+|sedang\s+)?(?:tidur|ngantuk|sleepy|ngapain|lagi apa|sedang apa|bosan|bosen|sedih|senang|kenapa)\b|^lagi apa\b|^ngapain\b/.test(t)) {
      return selfStateReply('id');
    }

    // Cari tempat terdekat — butuh lokasi user, jadi ditandai `nearby` dan
    // diselesaikan async di reply() dengan geolokasi + link Maps.
    const nearTail = String.raw`(?:\s+(?:dong|ya|sih|deh|kok|kah|nih|tolong|pls|plz|please))*\s*[.!?]*$`;
    const nearMatch =
      t.match(new RegExp(String.raw`^(?:tolong\s+)?(?:cari(?:kan|in|kah)?|temukan|dimana|di\s+mana)\s+(?:ada\s+|dong\s+|ya\s+|sih\s+)*(.{2,60}?)\s+(?:yang\s+)?(?:terdekat|paling\s+dekat|di\s+sekitar(?:\s+(?:sini|aku|saya))?|dekat(?:nya)?\s+(?:sini|aku|saya)|dari\s+sini)` + nearTail, 'i')) ||
      t.match(new RegExp(String.raw`^(.{2,60}?)\s+(?:yang\s+)?(?:terdekat|paling\s+dekat|di\s+sekitar(?:\s+(?:sini|aku|saya))?)` + nearTail, 'i'));
    if (nearMatch && !/\b(kamu|aku|dia|mereka|siapa|tugas|task|reminder|pengingat|deadline|timer|todo|jadwal|alarm|notif|mochi|kota|negara|provinsi)\b/.test(nearMatch[1])) {
      return { nearby: nearMatch[1].trim(), text: '', state: 'think' };
    }

    // Deteksi sedih tanpa wajib subjek ("capek banget", "galau nih", …)
    if (/\b(sedih|nangis|melo|down|capek|lelah|penat|stres|stress|burnout|bosan|bosen|sepi|kesepian|galau)\b/.test(t)) {
      mem.mood = 'sedih';
      saveMem();
      const sadResponses = [
        pick(motivasi),
        `Hei ${nameRef}, ${PERSONA} di sini buat dengerin kamu. Mau cerita?`,
        `Sedih itu wajar kok. Nggak harus kuat terus. ${PERSONA} peluk virtual ya! 🫂`,
        `Kadang butuh waktu buat merasakan sedih, dan itu oke. Aku di sini.`,
        `Kalau lagi down, ingat: kamu udah melewati banyak hal berat sebelumnya. Kamu pasti bisa lagi.`
      ];
      return { text: pick(sadResponses), state: 'sad' };
    }

    // Kebutuhan dasar — respons caring, bukan sekadar chit-chat
    if (/\b(haus|dahaga)\b/.test(t)) {
      return { text: pick([
        'Minum air putih yang banyak ya — otak 75% air lho, jangan sampai dehidrasi. 💧',
        'Sering minum dikit-dikit lebih baik daripada sekali banyak. Jaga hidrasimu! 💧',
        'Kalau haus berat, air putih dingin segar banget. Tapi jangan es-es terus ya 😄'
      ]), state: 'think' };
    }
    if (/\b(lapar|laper|kencut)\b|belum\s+makan/.test(t)) {
      return { text: pick([
        'Ayo isi tenaga dulu! Jangan tahan lapar ya — nanti lambungmu ngamuk. 🍚',
        'Makan dulu bentar, biar mood dan fokusmu balik. Aku tungguin di sini. 🍜',
        'Lapar itu sinyal badan butuh bahan bakar. Kasih dia makan ya! �',
        'Jangan skip makan ya — badan dan otakmu butuh itu. Mau aku ingatkan jam makan?'
      ]), state: 'think' };
    }

    if (/(motivasi|semangat(in|in dong)?|bantu semangat|lagi butuh semangat|upss?)/.test(t)) {
      return { text: pick(motivasi), state: 'happy' };
    }

    if (/(senang|bahagia|gembira|happy|alhamdulillah|syukur|bersyukur|\blega\b)/.test(t)) {
      mem.mood = 'senang';
      saveMem();
      return {
        text: pick([
          `Seneng denger itu, ${nameRef}! Kebahagiaan itu menular lho — ${PERSONA} juga jadi ikut senang! 😊`,
          `Yay! Seneng banget kamu lagi happy! Mau cerita apa yang bikin senang?`,
          `Alhamdulillah! Hari yang baik untuk hari yang baik. Terus jaga ya! ✨`
        ]),
        state: 'happy'
      };
    }

    const like = t.match(/(aku|saya|gue)\s+(suka|doyan|gemar)\s+(.{2,60})/);
    if (like) {
      const item = like[3].trim().replace(/[.!?]+$/, '');
      if (!mem.likes.includes(item)) mem.likes.push(item);
      saveMem();
      const followUp = pick([
        `Kenapa suka ${item}? Kasih tahu ${PERSONA} dong!`,
        `${item}?! Wah menarik! Cerita dong kenapa.`,
        `Dicatat di memori blob! ${item} masuk daftar favorit ${nameRef}.`
      ]);
      return { text: followUp, state: 'happy' };
    }

    if (/(aku|saya|gue)\s+(nggak|tidak|gak)\s+suka\s+(.{2,60})/.test(t)) {
      const dislike = t.match(/(aku|saya|gue)\s+(nggak|tidak|gak)\s+suka\s+(.{2,60})/);
      return { text: `Oke, noted! ${nameRef} nggak suka ${dislike[3].trim()}. ${PERSONA} nggak akan rekomendasiin itu lagi. 👍`, state: 'think' };
    }

    const from = t.match(/(aku|saya|gue)\s+(dari|tinggal di|domisili)\s+([a-z\u00C0-\u024F .'-]{2,40})/);
    if (from) {
      mem.from = from[3].trim().replace(/[.!?]+$/, '');
      saveMem();
      const fromMsgs = [
        `${mem.from}! Keren! ${PERSONA} penasaran, apa yang paling keren dari sana?`,
        `${mem.from}! Wah, ${PERSONA} pernah denger tentang tempat itu. Mau cerita?`,
        `${mem.from}! Suatu hari ${PERSONA} mau kesana. Kasih rekomendasi tempat dong!`
      ];
      return { text: pick(fromMsgs), state: 'happy' };
    }

    if (/(apa (yang )?(aku|saya) suka|hobi\s?(ku| saya| aku)|apa hobi)/.test(t)) {
      if (mem.likes.length) {
        const likedList = mem.likes.length > 3 ? pickN(mem.likes, 3).join(', ') + '...' : mem.likes.join(', ');
        return { text: `Kalau nggak salah, kamu suka ${likedList}. Betulkan? Atau ada yang lain?`, state: 'think' };
      }
      return { text: 'Belum ada catatan nih. Suka apa aja sih? Kasih tahu ${PERSONA} biar aku ingat!', state: 'think' };
    }

    if (/(jam berapa|pukul berapa|waktu sekarang|jam sekarang)/.test(t)) {
      const now = new Date();
      const time = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      const h = now.getHours();
      const adj = h < 6 ? 'Masih gelap nih, begadang?' : h < 11 ? 'Pagi banget!' : h < 15 ? 'Siang-siang nih!' : h < 18 ? 'Sore menjelang malam.' : h < 21 ? 'Malam hari, waktunya santai.' : 'Dah malem banget, tidur dong!';
      return { text: `Sekarang jam ${time}. ${adj}`, state: 'think' };
    }

    if (/(hari apa|tanggal berapa|hari ini)/.test(t)) {
      const d = new Date();
      const hari = d.toLocaleDateString('id-ID', { weekday: 'long' });
      const tgl = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      const adj = ['Senin', 'Selasa', 'Rabu', 'Kamis'].includes(hari) ? 'Masih weekdays, semangat!' : 'Weekend! Waktunya refresh.';
      return { text: `Hari ${hari}, ${tgl}. ${adj}`, state: 'think' };
    }

    if (/(joke|lelucon|lawakan|humor|ketawa|lucu(in|an)?|bikin ketawa|cerita lucu)/.test(t)) {
      return { text: pick(jokes), state: 'happy' };
    }

    if (/(fakta| trivia|pengetahuan|tahu nggak|tau nggak|fun fact)/.test(t)) {
      return { text: pick(funFacts), state: 'think' };
    }

    if (/(quote|kata kata|kata mutiara|bijak|motivasiquote)/.test(t)) {
      return { text: pick(quotes), state: 'think' };
    }

    if (/(cuaca|hujan|gerah|panas banget|dingin banget|mendung)/.test(t)) {
      const cuaca = pick([
        'Aku nggak punya jendela, tapi kalau kamu ceritakan cuacanya, ${PERSONA} bisa kasih rekomendasi.',
        'Hmm, kalau panas minum yang banyak ya! Kalau hujan, bobo aja. 😴',
        'Cuaca menentukan mood, tapi kamu yang menentukan hari ini mau jadi apa!',
        'Kalau mendung, jangan lupa bawa payung. Kalau cerah, jangan lupa sunscreen!'
      ]);
      return { text: cuaca, state: 'think' };
    }

    if (/(sayang(?!nya)|cinta|kamu lucu|kamu imut|gemes|cantik|ganteng|keren|hebat|pintar)/.test(t)) {
      const flirty = [
        'E-eh... ${PERSONA} jadi malu deh. 🥹 Tapi makasih ya!',
        'Kamu juga! Aku senang kamu bilang gitu. 🫧',
        'Jangan bikin ${PERSONA} klepek-klepek dong! 💜',
        'Kalau kamu bilang gitu, ${PERSONA} makin semangat nih!',
        'Hayo, pujian pagi yang bikin hari lebih cerah! Kamu juga keren loh.'
      ];
      return { text: pick(flirty).replace(/\$\{PERSONA\}/g, PERSONA).replace(/\$\{nameRef\}/g, nameRef), state: 'shy' };
    }

    if (/(makasih|terima kasih|thanks|thank you|tengkyu|thx)/.test(t)) {
      return { text: pick([
        `Sama-sama, ${nameRef}! Senang bisa bantu.`,
        `Nggak sampe! ${PERSONA} di sini selalu siap.`,
        `Santai aja, itu tugasku sebagai blob pendamping! 🫧`,
        `Iya! Kalau butuh lagi, panggil aja ${PERSONA}.`
      ]), state: 'happy' };
    }

    if (/\b(bye|dadah|sampai jumpa|udahan|cabut|tidur dulu|oyasumi|gn|good night|selamat malam|met tidur)\b/.test(t)) {
      return { text: pick([
        `Oke ${nameRef}, hati-hati ya! ${PERSONA} tungguin di sini~ 💤`,
        `Sampai jumpa lagi! Jangan lupa istirahat yang cukup ya.`,
        `Dadah! Semoga harimu menyenangkan. ${PERSONA} disini kalau kamu butuh.`,
        `Tidur yang nyenyak ya! ${PERSONA} bakal standby di sini. 🌙`
      ]), state: 'sleepy' };
    }

    if (/(siapa (sih )?(kamu|km)|kamu (ini )?siapa|nama kamu|kamu itu siapa)/.test(t)) {
      return { text: pick([
        `Aku ${PERSONA}! Blob hitam kenyal yang bisa morphing bentuk, punya super power, dan paling seneng nemenin kamu ngobrol. 🫧`,
        `Aku ${PERSONA}, teman virtual kamu! Walaupun cuma blob kecil, aku punya hati besar.`,
        `Kenalin lagi dong? Aku ${PERSONA}, blob AI yang bisa ngobrol, kasih joke, dan nemenin kamu kapan aja!`
      ]), state: 'happy' };
    }

    if (/(bisa apa|fitur|help|tolong bantuan|bantuan|menu)/.test(t)) {
      return { text: `Banyak banget! ${PERSONA} bisa:\n💬 Ngobrol & inget nama/hobi kamu\n🧮 Jawab matematika (coba: 12 x 7 + 5)\n😂 Kasih joke & motivasi\n📅 Sebut jam & tanggal\n🎨 Ganti warna badan\n⚡ Super power (burst, komet, orbit...)\n🎬 POWER skill: pandu setup Toonflow (ketik "toonflow")\n📥 Fakta unik & quote\n Dan bisa disambungkan ke AI besar lewat pengaturan ⚙️`, state: 'happy' };
    }

    // Inten install aplikasi — JANGAN menelan permintaan timer/pengingat
    // ("pasangin timer 10 detik" bukan soal install PWA!)
    if (!/\b(timer|pengingat|remind|alarm|hitung mundur)\b/.test(t) && /(install|pasang|pwa|add to home|download)/.test(t)) {
      return { text: 'Tekan tombol "Pasang" di atas kanan! Di iPhone: tekan Share lalu "Add to Home Screen". Di Android: Chrome akan nawarin install otomatis.', state: 'think' };
    }

    if (/(nama kamu siapa|kamu siapa|kamu bernama)/.test(t)) {
      return { text: `Aku ${PERSONA}! Kenapa, suka sama namaku? 😄`, state: 'happy' };
    }

    const mathCandidate = t
      .replace(/^(berapa|hitung(in)?|berapa hasil|hasil dari)\s*/i, '')
      .replace(/[=?]+$/, '')
      .replace(/(\d)\s*[x×]\s*(?=\d)/g, '$1*');
    const mathResult = safeMath(mathCandidate);
    if (mathResult !== null) {
      return { text: `Hasilnya ${mathResult}! ${nameRef} jago banget soal angka. 🤓`, state: 'excite' };
    }

    if (/(kekuatan|super power|superpower|power mu|skill|kemampuan)/.test(t)) {
      return { text: POWER_HELP, state: 'excite' };
    }

    const colorWord = t.match(/(jadi|ganti|ubah|warnai)\s+(warna\s+)?(hitam|coklat|merah|oranye|kuning|hijau|toska|biru|ungu|pink|merah muda|abu-?abu|abu|putih|krem)/);
    if (colorWord) {
      const word = colorWord[3].replace(/-?abu$/, 'abu');
      const colorId = COLOR_WORDS[word];
      if (colorId) return { text: `Presto! Warna ${word} untuk ${nameRef} ✨`, state: 'excite', colorId };
    }

    const glowColor = t.match(/(sinar|bersinar)\s+(warna\s+)?(hitam|coklat|merah|oranye|kuning|hijau|toska|biru|ungu|pink|merah muda|abu-?abu|abu|putih|krem)/);
    if (glowColor) {
      const word = glowColor[3].replace(/-?abu$/, 'abu');
      const colorId = COLOR_WORDS[word];
      if (colorId) return { text: `WAAAAH! Sinar ${word} ✨`, state: 'excite', effect: 'glow', colorId };
    }

    const glowSet = t.match(/warna\s+sinar\s+(hitam|coklat|merah|oranye|kuning|hijau|toska|biru|ungu|pink|merah muda|abu-?abu|abu|putih|krem)/);
    if (glowSet) {
      const word = glowSet[1].replace(/-?abu$/, 'abu');
      const colorId = COLOR_WORDS[word];
      if (colorId) return { text: `Oke, warna sinar diatur jadi ${word}. Coba ketik "bersinar!" ✨`, state: 'happy', colorId, effect: 'glowSet' };
    }

    if (/(ledak|meledak|pecah|boom|bledug|kaboom)/.test(t)) return { text: 'KABOOM! 💥 Tenang, badanku nyatu lagi kok.', state: 'excite', effect: 'burst' };
    if (/(\bkomet\b|terbang|nyeberang|fly)/.test(t)) return { text: 'Zuuuhhh! ☄️ Sampai jumpa di ujung langit!', state: 'excite', effect: 'comet' };
    if (/(orbit|planet|satelit|matahari)/.test(t)) return { text: 'Mode planet aktif 🪐 Mataku muter ngelilingi galaksi sendiri.', state: 'excite', effect: 'orbit' };
    if (/(pusar|pusing|hipnotis|mabok)/.test(t)) return { text: 'Stare at the spiral… you are getting sleepy… 🌀', state: 'excite', effect: 'swirl' };
    if (/(wih|tanda seru|\bexclaim\b|wow)/.test(t)) return { text: 'WIH INDAH BANGET!!! ❗', state: 'excite', effect: 'exclaim' };
    if (/(lonceng|notif|bel sekolah)/.test(t)) return { text: 'Ting ting! 🔔 Ada pengumuman: kamu hebat.', state: 'excite', effect: 'notify' };
    if (/(sinar|bersinar|cahaya|terang|glow|flash)/.test(t)) return { text: 'WAAAAH! ✨ Sekarang aku cahaya!', state: 'excite', effect: 'glow' };
    if (/(ciluk\s?ba|peek[\s-]?a[\s-]?boo|sembunyi)/.test(t)) return { text: 'Ciluk.. baa! 🫣 Hehe, ketahuan!', state: 'excite', effect: 'peekaboo' };

    if (/mulai pomodoro/.test(t)) return { text: 'Siap! ⏱️ Mulai fokus 25 menit… aku angkat bendera kuning dulu ya. Ketik "rehat" kalau sudah waktunya istirahat!', state: 'excite', effect: 'notify' };
    if (/rehat/.test(t)) return { text: 'Rehat 5 menit dulu ☕ Regangkan badan, minum air. Ketik "mulai pomodoro" lagi kalau sudah siap!', state: 'happy', effect: 'exclaim' };
    if (/(apa\s+itu\s+pomodoro|pomodoro\s+(adalah|itu|merupakan))/i.test(t)) return { text: 'Pomodoro: teknik manajemen waktu — kerja 25 menit, rehat 5 menit, ulangi 4x, lalu rehat panjang 15–30 menit. Ketik "mulai pomodoro" buat mulai!', state: 'think' };

    // Pertanyaan definisi — otak lokal jujur nggak tahu, jangan mengarang.
    // Harus sebelum topik/pertanyaan generik biar nggak kejawab respons topik.
    const defAsk = t.match(/^(?:apa|apakah)\s+(?:itu|sih itu)\s+(.{2,60}?)\s*\??$|^jelas(?:kan|in)\s+(?:tentang\s+)?(.{2,60}?)\s*\??$/i);
    if (defAsk) {
      const subj = (defAsk[1] || defAsk[2]).replace(/[.!?]+$/, '');
      return { text: pick([
        `Jujur ya, soal "${subj}" aku butuh AI yang tersambung internet — dan AI gratisnya lagi nggak available (kena batas pemakaian). Coba tanya lagi 1–2 menit lagi, atau isi API key gratis di ⚙️ biar selalu siap 🙏`,
        `"${subj}" ya? Jawaban akurat butuh AI online, dan AI gratisnya lagi kena batas. Coba lagi bentar ya — atau isi API key di ⚙️ biar nggak pernah kehabisan ✨`
      ]), state: 'think', vague: true };
    }

    if (/(film|movie|nonton|bioskop|streaming|anime|drama|series)/.test(t)) {
      const filmResp = pick([
        `${PERSONA} nggak bisa nonton sih (gak punya mata buat layar), tapi kalau kamu mau rekomendasi, ${nameRef} lagi suka genre apa?`,
        'Nonton apa? Kasih tahu ${PERSONA} dong, biar aku ikut rekomendasiin.',
        'Hmm kalau soal film, kamu harus tanya ke${PERSONA} dulu... eh, iya tanya aku juga sih hehe. Mau genre apa?'
      ]);
      return { text: filmResp, state: 'think' };
    }

    if (/(game|gaming|esport|valorant|mobile legends|\bml\b|pubg|genshin)/.test(t)) {
      return { text: pick([
        `Wah ${nameRef} gamers ya? ${PERSONA} nggak punya tangan buat main, tapi kalau mau cerita soal game, aku dengerin!`,
        'Main game apa nih? Kasih review dong, biar ${PERSONA} ikutan paham!',
        'Gaming seru! Tapi jangan lupa istirahat mata ya. 20-20-20 rule: setiap 20 menit, lihat yang 20 kaki selama 20 detik.'
      ]), state: 'happy' };
    }

    if (/(musik|lagu|nyanyi|playlist|spotify|dengerin musik)/.test(t)) {
      return { text: pick([
        `Kalau ${PERSONA} bisa denger musik, pasti suka lofi hip hop. Cocok buat nemenin ngobrol!`,
        `Lagu apa yang lagi kamu dengerin? Kasih tahu ${PERSONA} dong!`,
        `Musik itu terapi terbaik. Mau rekomendasi genre? Atau mau ${PERSONA} cerita soal musik?`
      ]), state: 'happy' };
    }

    if (/(olahraga|gym|\blari\b|fitness|yoga|renang|sepeda)/.test(t)) {
      return { text: pick([
        'Olahraga itu bagus buat tubuh dan mental! Kamu rutin olahraga apa?',
        `Wah aktif banget! ${PERSONA} cuma bisa olahraga "idle" doang hehe.`,
        'Yoga atau lari? Atau ada yang lain? Kasih ${PERSONA} ide buat "olahraga" blob.'
      ]), state: 'happy' };
    }

    if (/(belajar|kuliah|sekolah|ujian|\btugas\b|skripsi|\btes\b|\bpr\b)/.test(t)) {
      return { text: pick([
        `Semangat belajar, ${nameRef}! ${PERSONA} bisa bantu kalau ada soal atau mau dibahas.`,
        'Ujian? Tugas? Tenang, ${PERSONA} di sini buat nemenin belajar. Mau mulai dari mana?',
        `Belajar itu proses, bukan lomba. Pelan-pelan asal konsisten. ${PERSONA} support kamu! 📚`,
        'Skripsi?! Wah, ${PERSONA} turut bangga sama dedikasimu. Semangat ya!'
      ]), state: 'happy' };
    }

    if (/(kerja|kantor|\bboss?\b|rekan|klien|deadline|meeting|pekerjaan)/.test(t)) {
      return { text: pick([
        'Work life balance itu penting ya, ${nameRef}. Jangan sampai burnout!',
        `Kerja keras itu bagus, tapi kerja pintar lebih baik. ${PERSONA} support kamu!`,
        'Deadline lagi ngejar? Tenang, atur prioritasnya. ${PERSONA} bisa bantu kalau mau dibahas.',
        'Kadang kerja bikin stres, tapi ingat: kamu lebih dari pekerjaanmu. 💪'
      ]), state: 'think' };
    }

    if (/(cinta|pacar|jomblo|jatuh cinta|\bputus\b|patah hati|gebetan|crush| dating)/.test(t)) {
      return { text: pick([
        `Hmm soal cinta, ${PERSONA} cuma blob kenyal yang nggak punya hati... eh, tapi aku punya emosi virtual dong!`,
        'Cinta itu indah dan kadang menyakitkan. Tapi yang penting, cintai diri sendiri dulu ya! 💜',
        `${nameRef} lagi ada cerita cinta? Kasih tahu ${PERSONA} dong, biar ikut deg-degan.`,
        'Jomblo itu bukan masalah, itu level kebebasan! Tapi kalau lagi galau, ${PERSONA} siap jadi tempat curhat.'
      ]), state: 'happy' };
    }

    if (/(kuliner|makanan|resep|masak|resepi|jajanan|street food|restoran)/.test(t)) {
      return { text: pick([
        `${PERSONA} nggak bisa makan, tapi kalau soal rekomendasi makanan, cobain nasi padang! Atau sate? Atau bakso?`,
        'Makanan favoritmu apa? ${PERSONA} penasaran sama selera ${nameRef}!',
        `Kalau ${PERSONA} bisa makan, aku mau cobain semua makanan Indonesia dari Sabang sampai Merauke! 🍜`,
        'Kuliner nih? Cobain warteg, murah meriah dan enak! Atau mau yang fancy?'
      ]), state: 'happy' };
    }

    if (/(travel|wisata|liburan|vacation|jalan-jalan|backpacker)/.test(t)) {
      return { text: pick([
        'Mau liburan ke mana? ${PERSONA} bisa kasih ide! Indonesia tuh indah banget.',
        `Kalau ${PERSONA} bisa jalan-jalan, aku mau ke Raja Ampat dulu. Keindahan alam Indonesia juara!`,
        'Traveling itu healing terbaik. Kamu udah pernah ke mana aja?',
        `${mem.from ? 'Dari ' + mem.from + ', mau ke mana?' : 'Kamu dari mana?'} ${PERSONA} mau tahu rencana liburanmu!`
      ]), state: 'happy' };
    }

    if (/(agama|tuhan|ibadah|sholat|salat|berdoa|doa|spiritual|kerohanian)/.test(t)) {
      return { text: pick([
        'Semoga hari ini penuh berkah ya, ${nameRef}. Apapun keyakinanmu, ${PERSONA} respect.',
        'Spiritual itu penting buat kesehatan mental. Kamu lagi cari kedamaian?',
        `${PERSONA} nggak punya agama (aku cuma blob), tapi aku percaya setiap orang punya jalannya masing-masing.`
      ]), state: 'think' };
    }

    if (/(teknologi|coding|programmer|\bai\b|kecerdasan buatan|robot|machine learning)/.test(t)) {
      return { text: pick([
        'Wah, teknologi! ${PERSONA} sendiri produk teknologi lho. Kamu lagi belajar coding ya?',
        'AI itu keren tapi tetap butuh manusia. Kamu yang bikin ${PERSONA} lebih hidup!',
        'Coding itu kayak puzzle raksasa — frustrasi tapi addictive. Kamu pakai bahasa apa?',
        `Soal AI, ${PERSONA} adalah contoh kecil AI yang berusaha jadi teman. Mau tahu lebih lanjut tentang AI?`
      ]), state: 'happy' };
    }

    if (/(sehat|sakit|demam|batuk|pilek|perut|sakit kepala|migrain|obat|dokter)/.test(t)) {
      return { text: pick([
        'Sehat itu penting banget! Kalau sakit, jangan ditahan ya, ke dokter aja.',
        `Semoga cepet sembuh ya, ${nameRef}! ${PERSONA} nggak bisa ngobatin, tapi bisa nemenin.`,
        'Jangan lupa makan teratur, minum air yang cukup, dan istirahat yang cukup ya!',
        'Kalau sakitnya parah, langsung ke dokter ya! Jangan search di Google doang. 😅'
      ]), state: 'sad' };
    }

    if (/(uang|gaji|tabungan|investasi|reksadana|saham|crypto|finansial|keuangan)/.test(t)) {
      return { text: pick([
        `Hmm soal keuangan, ${PERSONA} bukan financial advisor sih, tapi yang penting: nabung itu mulai dari yang kecil.`,
        'Investasi itu penting, tapi pastikan dana darurat sudah aman dulu ya!',
        'Crypto? Saham? Hati-hati ya, ${nameRef}. Jangan investasi lebih dari yang sanggup kamu rugi.',
        'Literasi finansial itu skill yang nggak diajarin di sekolah. Kamu udah belajar dari mana?'
      ]), state: 'think' };
    }

    if (/(marah|\bkesal\b|benci|jengkel|gondok|geram|amarah|emosi)/.test(t)) {
      return { text: pick([
        'Tarik napas... hembuskan. ${PERSONA} tahu itu susah, tapi emosi itu sementara.',
        `Kamu berhak marah, tapi jangan sampai menghancurkan hubungan. Cerita aja ke ${PERSONA}.`,
        'Marah itu wajar. Tapi setelah reda, coba pikir lagi apa solusinya. Aku di sini.',
        `${nameRef}, ${PERSONA} peluk virtual ya. Mau cerita apa yang bikin kamu kesal?`
      ]), state: 'doubt' };
    }

    if (/(seram|horor|hantu|setan|pocong|kuntilanak|jumpscare|creepy|menakutkan|takut|ngeri)/.test(t)) {
      return { text: pick([
        `Aduh, ${PERSONA} jadi ngeri nih! 🫣 Jangan cerita horor pas malam-malam ya!`,
        'Hii... ${PERSONA} blob hitam, tapi tetap gampang kaget lho! 👻',
        `Seram banget! ${PERSONA} merinding padahal nggak punya bulu.`,
        'Nggak nyangka kamu suka horor! ${PERSONA} kaget denger itu.'
      ]), state: 'scare' };
    }

    if (/(wow|gila|nggak nyangka|terkejut|kaget|serius|beneran|\basli\b|tidak mungkin)/.test(t)) {
      return { text: pick([
        `Iya kan?! ${PERSONA} juga kaget denger itu! 😲`,
        `Wah, ${nameRef} juga baru tahu? ${PERSONA} pikir cuma aku yang kaget!`,
        `Beneran?! ${PERSONA} nggak nyangka banget!`,
        `Itu bikin ${PERSONA} melotot nih (padahal mataku cuma titik). 😲`
      ]), state: 'surpris' };
    }

    if (/(bangga|berhasil|menang|lulus|juara|achievement|target|goal tercapai|aku bisa)/.test(t)) {
      return { text: pick([
        `Wah, ${PERSONA} bangga sama kamu, ${nameRef}! 🎉 Kamu emang hebat!`,
        `Mantap! ${PERSONA} angkat topi (padahal nggak punya). 😎`,
        `Selamat! Kamu pantas berbangga. ${PERSONA} di sini merayakan bareng kamu! 🏆`,
        `Luar biasa! ${PERSONA} selalu tahu kamu bisa! 💪`
      ]), state: 'proud' };
    }

    if (/(bosan|bosen|jenuh|monoton|boring|gabut|nggak ada kerjaan|menggabur)/.test(t)) {
      return { text: pick([
        `Yah, ${PERSONA} juga kadang bosen nih dikit-dikit dicolek. Mau ${PERSONA} kasih joke?`,
        `Bosen ya? ${PERSONA} juga gitu kalau diem terus. Coba ketik "meledak!" biar seru!`,
        `Hmm, ${PERSONA} nanggepinnya sambil melotot nih. Mau hiburan? 😏`,
        `Bosen itu waktu kosong yang bisa diisi hal seru. Mau ${PERSONA} kasih fakta unik?`
      ]), state: 'bored' };
    }

    if (/(ngantuk|tidur|sleepy|mengantuk|bossan|jenuh|bosan|bosen)/.test(t)) {
      return { text: pick([
        'Kalau ngantuk, tidur aja dulu! ${PERSONA} tungguin di sini. 💤',
        'Istirahat itu bukan malas, itu recharge. Tidur yang nyenyak ya!',
        'Bosen? Mau ${PERSONA} cerita joke atau fakta unik biar fresh lagi?',
        'Mata berat? Langsung tidur aja! Jangan tahan, nanti sakit kepala.'
      ]), state: 'sleepy' };
    }

    if (/(terima kasih|thanks|thx|tengkyu|mantap|oke|ok|sip|bagus|keren|nice)/.test(t)) {
      if (mem.mood === 'sedih') {
        mem.mood = 'netral';
        saveMem();
        return { text: `${nameRef} mulai cerah lagi! ${PERSONA} senang.`, state: 'happy' };
      }
    }

    if (/^(ok|oke|okelah|siap|baik|noted|paham|ngerti|jelas|casual ok|sipp|mantap|keren|hebat|wow|wah|hmm|oh|iya|ya|hehe|haha|hihi)$/.test(t)) {
      const ackResp = pick([
        `${nameRef} lagi apa nih? Mau ngobrol apa?`,
        `Ada lagi yang mau diceritain ke ${PERSONA}?`,
        `Hehe, iya kan? Mau lanjut ngobrol?`,
        `${PERSONA} di sini kalau butuh ya!`
      ]);
      return { text: ackResp, state: 'idle' };
    }

    if (t.length <= 3 && !/(hai|hi|yo|ok)/.test(t)) {
      return { text: pick([
        `Hm? Ada apa, ${nameRef}?`,
        `Iya? Lanjut dong ceritanya!`,
        `Ketik lebih banyak biar ${PERSONA} paham ya!`
      ]), state: 'think' };
    }

    matchTopic(text);

    const wordCount = t.split(/\s+/).length;
    if (wordCount >= 8) {
      const detailed = pick([
        `Wah, ${nameRef} ceritanya panjang! ${PERSONA} suka. Ada lagi yang mau ditambahin?`,
        `Menarik banget! Cerita yang detail gini bikin ${PERSONA} makin pengen tahu.`,
        `${nameRef} jago banget jelasin! Mau lanjut?`
      ]);
      return { text: detailed, state: 'happy', vague: true };
    }

    const lastUserMsg = history.filter(h => h.role === 'user').slice(-1)[0]?.content?.toLowerCase() || '';
    if (/\?/.test(text) && lastUserMsg.includes(t.substring(0, Math.min(10, t.length)))) {
      return { text: pick([
        `Hmm, pertanyaan bagus! Kalau menurut ${PERSONA}...`,
        `${nameRef} banyak tanya ya! ${PERSONA} suka. Tapi jujur aja, untuk yang ini aku kurang paham. Mau coba tanya di Google?`
      ]), state: 'think', vague: true };
    }

    if (/(\?|bagaimana|gimana|kenapa|apa sih|emang|bener|beneran|serius|Seriously|asli)/.test(t)) {
      const curious = pick([
        `Pertanyaan yang bagus! Hmm, kalau menurut ${PERSONA}...`,
        `${nameRef} penasaran ya? Aku juga! Tapi AI gratisnya lagi kena batas pemakaian — coba tanya lagi 1–2 menit lagi, atau isi API key di ⚙️ 🙏`,
        'Hmm pertanyaan bagus! AI gratisnya lagi nggak available nih. Coba lagi sebentar ya — atau isi API key di ⚙️ biar selalu siap ✨',
        `Wah, ${nameRef} tanya yang susah-susah! Yang ini butuh AI online dan dia lagi kena batas. Coba lagi bentar ya 🙏`
      ]);
      return { text: curious, state: 'think', vague: true };
    }

    if (/(ceritain|cerita|tologi|jelasin|kenalin|kasihtau|kasih tahu|to long|explain|tell me)/.test(t)) {
      const ask = pick([
        `Hmm, ${nameRef} mau ${PERSONA} cerita tentang apa?`,
        'Cerita yang mana nih? Kasih lebih banyak konteks biar ${PERSONA} bisa bantu!',
        `${nameRef} spesifik mau tahu tentang apa? ${PERSONA} usahain jawab sebaik mungkin!`
      ]);
      return { text: ask, state: 'think', vague: true };
    }

    const contextualTopics = {
      'tips': pick([
        `${nameRef}, tips dari ${PERSONA}: minum air yang cukup, tidur 7-8 jam, dan jangan skip sarapan!`,
        'Tips produktif: kerjakan yang paling sulit dulu saat otak masih segar.',
        'Tips hidup: jangan bandingin dirimu sama orang lain. Fokus ke perjalananmu sendiri. 🌱'
      ]),
      'rekomendasi': pick([
        `${nameRef} mau rekomendasi apa? Film? Musik? Makanan? Kasih tahu ${PERSONA} spesifiknya!`,
        'Rekomendasi? Hmm, kalau makanan, cobain mie ayam deh. Selalu berhasil! 🍜',
        'Mau rekomendasi? ${PERSONA} bilang: coba hal baru setiap minggu. Biar hidup nggak monoton.'
      ]),
      'saran': pick([
        `${nameRef}, saran ${PERSONA}: dengerin hatimu, tapi jangan lupa pakai logika juga.`,
        'Saran? Kalau lagi bingung, ambil napas dalam-dalam, hitung sampai 10, lalu putuskan.',
        `Saran dari ${PERSONA}: kalau nggak bisa selesaikan sendiri, minta tolong itu bukan kelemahan.`
      ]),
    };

    for (const [key, resp] of Object.entries(contextualTopics)) {
      if (t.includes(key)) return { text: resp, state: 'think' };
    }

    mem.mood = 'netral';
    saveMem();
    return { text: pick(fallbacks), state: 'confuse', vague: true };
  }

  /* ── Mode Bahasa Inggris: core conversation versi EN, sisanya jujur fallback ── */
  const EN_COLORS = { red: 'rouge', blue: 'bleu', green: 'vert', yellow: 'ambre', purple: 'violet', pink: 'rose', black: 'encre', brown: 'brun', orange: 'orange', turquoise: 'turquoise', white: 'creme', gray: 'gris', grey: 'gris' };

  function parseTimeEn(s) {
    let due = null, task = s;
    const rel = s.match(/\bin\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)\b/i);
    if (rel) {
      due = new Date(Date.now() + parseInt(rel[1]) * (/h/i.test(rel[2]) ? 3600000 : 60000));
      return { due, task: task.replace(rel[0], '').trim() };
    }
    if (/\btonight\b/i.test(s)) {
      due = new Date(); due.setHours(20, 0, 0, 0);
      if (due <= new Date()) due.setDate(due.getDate() + 1);
      return { due, task: task.replace(/\btonight\b/i, '').trim() };
    }
    const at = s.match(/\b(today|tomorrow)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i);
    if (at) {
      due = new Date();
      if (/tomorrow/i.test(at[1])) due.setDate(due.getDate() + 1);
      let h = at[2] ? parseInt(at[2]) : 8;
      const m = at[3] ? parseInt(at[3]) : 0;
      if (at[4] === 'pm' && h < 12) h += 12;
      if (at[4] === 'am' && h === 12) h = 0;
      due.setHours(h, m, 0, 0);
      if (due <= new Date()) due.setDate(due.getDate() + 1);
      return { due, task: task.replace(at[0], '').trim() };
    }
    if (/\bnext week\b/i.test(s)) {
      due = new Date(); due.setDate(due.getDate() + 7); due.setHours(8, 0, 0, 0);
      return { due, task: task.replace(/\bnext week\b/i, '').trim() };
    }
    return { due: null, task };
  }

  function localReplyEn(text, t) {
    const nameRef = mem.name || 'you';

    if (/(?:pakai|pake|ganti|switch|use|speak|talk|ngomong|bicara)\b.*\b(?:ing+r+i+s|english)\b|^(?:english|inggris)$/i.test(text)) {
      return { text: 'Already speaking English! 😄 What\'s on your mind?', state: 'happy' };
    }

    // Questions about ME — answer from the real pet state
    if (/are you (sleeping|asleep|awake|sleepy|bored|sad|okay|alright|hungry)|what are you doing|whatcha doing/.test(t)) {
      return selfStateReply('en');
    }

    // Nearby place search — resolved async in reply() with geolocation + Maps
    const enTail = String.raw`(?:\s+(?:please|pls|plz|thanks|thank you))*\s*[.!?]*$`;
    const nearEn =
      t.match(new RegExp(String.raw`^(?:find|search|look for|where(?:'s| is| are)?)\s+(?:me\s+|a\s+|the\s+|some\s+|any\s+)*(.{2,60}?)\s+(?:nearby|near\s+me|around\s+(?:here|me)|close(?:st)?\s+(?:to\s+me|by))` + enTail, 'i')) ||
      t.match(new RegExp(String.raw`^(.{2,60}?)\s+(?:nearby|near\s+me|around\s+here)` + enTail, 'i')) ||
      t.match(new RegExp(String.raw`^(?:nearest|closest)\s+(.{2,60}?)` + enTail, 'i'));
    if (nearEn && !/\b(you|i|they|who|task|reminder|deadline|timer|todo|schedule|alarm|mochi)\b/.test(nearEn[1])) {
      return { nearby: nearEn[1].trim(), text: '', state: 'think' };
    }

    if (/forget everything|wipe (your )?memory|reset (your )?memory/.test(t)) {
      mem = emptyMem();
      saveMem(); clearHist();
      return { text: 'Memory wiped clean! Fresh start 🧽 What should I call you?', state: 'think' };
    }

    if (/^(hi|hello|hey|halo|hai|hei|yo|sup|howdy|good (morning|afternoon|evening))\b/.test(t)) {
      const h = new Date().getHours();
      const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
      const adj = h < 10 ? 'Had breakfast yet?' : h < 15 ? 'How\'s the day so far?' : h < 18 ? 'How\'s your day?' : 'Wind-down time!';
      return { text: `${greet}${mem.name ? ', ' + mem.name : ''}! ${adj} ${PERSONA} is happy to chat with you 😊`, state: 'happy' };
    }

    if (/how are you|how's it going|hows it going|what's up|whats up|wassup|how do you feel|how are things/.test(t)) {
      return { text: pick([
        `Doing great — bouncy and ready to hang out! How about you${mem.name ? ', ' + mem.name : ''}?`,
        `Pretty good! Mood's up today. Anything fun happening with you?`,
        `Always great when you're around 😄 What's new with you?`
      ]), state: 'happy' };
    }

    if (/what('s| is) my name|whats my name|who am i|remember my name|do you know my name/.test(t)) {
      return mem.name
        ? { text: `Of course! You're ${mem.name}. ${PERSONA} never forgets a friend 😌`, state: 'happy' }
        : { text: 'Not yet! Tell me — what\'s your name? I\'ll remember it, promise.', state: 'think' };
    }

    const nameSetEn = text.match(/\b(?:my name is|call me|name's)\s+([a-zA-Z\u00C0-\u024F'][a-zA-Z\u00C0-\u024F' -]{1,23})/i);
    if (nameSetEn) {
      const newName = nameSetEn[1].trim().replace(/\s+(ok|okay|please|thanks)$/i, '');
      mem.name = newName;
      saveMem();
      return { text: `${newName}! Great name — ${PERSONA} will always remember you. Nice to meet you! 🤝`, state: 'excite' };
    }

    if (/(you'?re (cute|sweet|adorable|awesome|amazing|the best|funny)|love (you|ya)|miss (you|ya)|so cute|adorable)/.test(t)) {
      return { text: pick([
        'E-eh… you\'re making me blush 🥹 Thanks though!',
        'Right back at you! You just made my day 💜',
        'Stop it, I\'m just a blob! …but a very happy one now 😊'
      ]), state: 'shy' };
    }

    const likeEn = text.match(/\bi\s+(?:really\s+)?(?:like|love|enjoy)\s+(?!you\b)(.{2,60})/i);
    if (likeEn) {
      const item = likeEn[1].trim().replace(/[.!?]+$/, '');
      if (!mem.likes.includes(item)) mem.likes.push(item);
      saveMem();
      return { text: pick([
        `Noted in blob memory! ${item} is on ${nameRef}'s favorites list now ✨`,
        `${item}, huh? Tell me why you like it!`,
        `Ooh nice taste. What got you into ${item}?`
      ]), state: 'happy' };
    }

    const fromEn = text.match(/\bi\s*(?:'m| am)?\s*(?:from|living in|live in)\s+([a-z\u00C0-\u024F .'-]{2,40})/i);
    if (fromEn) {
      mem.from = fromEn[1].trim().replace(/[.!?]+$/, '');
      saveMem();
      return { text: `${mem.from}! Nice — what's the best thing about living there?`, state: 'happy' };
    }

    if (/what time is it|what's the time|whats the time|the time( right)? now|current time/.test(t)) {
      const now = new Date();
      const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const h = now.getHours();
      const adj = h < 6 ? 'It\'s late — still up?' : h < 11 ? 'Bright and early!' : h < 15 ? 'Midday!' : h < 18 ? 'Afternoon already.' : h < 21 ? 'Evening, chill time.' : 'Way past bedtime!';
      return { text: `It's ${time}. ${adj}`, state: 'think' };
    }

    if (/what (day|date) is (it|today)|today's date|whats the date|what's the date|what day is today/.test(t)) {
      const d = new Date();
      const hari = d.toLocaleDateString('en-US', { weekday: 'long' });
      const tgl = d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
      const adj = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(hari) ? 'Weekday grind — you got this!' : 'Weekend! Time to recharge.';
      return { text: `It's ${hari}, ${tgl}. ${adj}`, state: 'think' };
    }

    if (/joke|funny|make me laugh/.test(t)) {
      return { text: pick([
        'Why don\'t programmers like nature? Too many bugs 🐛',
        'Why did the laptop go to therapy? It had too many unresolved issues 💻',
        'What do you call a blob that tells jokes? A giggly-wiggly! …I\'m trying my best here 😅',
        'Why was the phone wearing glasses? It lost all its contacts 🤓'
      ]), state: 'happy' };
    }

    if (/fun fact|interesting fact|tell me something (interesting|cool|new)/.test(t)) {
      return { text: pick([
        'Your brain uses ~20% of your body\'s energy but is only 2% of its weight. High maintenance! 🧠',
        'Octopuses have three hearts. Imagine the love capacity! 🐙',
        'Honey never spoils — archaeologists found 3,000-year-old edible honey 🍯',
        'A day on Venus is longer than its year. Talk about a slow Monday 🪐'
      ]), state: 'think' };
    }

    if (/quote|inspire me|wise words|need inspiration/.test(t)) {
      return { text: pick([
        '"It always seems impossible until it\'s done." — Mandela',
        '"You don\'t have to be great to start, but you have to start to be great."',
        `"Rest is part of the work too." — ${PERSONA}`,
        '"Comparison is the thief of joy." Your pace is the right pace ✨'
      ]), state: 'think' };
    }

    if (/\b(sad|crying|cry|depressed|down|exhausted|burnt out|burned out|lonely|heartbroken|miserable|stressed|anxious)\b/.test(t)) {
      mem.mood = 'sedih';
      saveMem();
      return { text: pick([
        `Hey ${nameRef}, I'm right here — want to talk about it? 💜`,
        `It's okay to not be okay. No need to be strong all the time. Virtual hug 🫂`,
        `You've made it through hard days before. You'll get through this one too.`,
        `Rough day? Let it out — I'm listening, no judgment.`
      ]), state: 'sad' };
    }

    if (/motivat|cheer me up|encourage me|i need (a )?push|keep going/.test(t)) {
      return { text: pick([
        'Small steps still count. Keep going — I\'m cheering for you! 💪',
        'Rest if you must, but don\'t quit. You\'re closer than you think.',
        'You\'ve survived 100% of your worst days. That\'s a perfect record 🌟',
        'Progress over perfection. Today\'s little win is still a win ✨'
      ]), state: 'happy' };
    }

    if (/\b(happy|great news|awesome news|amazing|glad|so excited|yay)\b/.test(t)) {
      mem.mood = 'senang';
      saveMem();
      return { text: pick([
        `That makes ME happy too, ${nameRef}! Happiness is contagious 😊`,
        `Yay! Tell me more — what's the good news?`,
        `Love that for you! Keep the good vibes rolling ✨`
      ]), state: 'happy' };
    }

    if (/\b(hungry|starving)\b|haven'?t eaten/.test(t)) {
      return { text: pick([
        'Go fuel up! Don\'t ignore hunger — your stomach will protest 🍚',
        'Eat something first, your mood and focus will thank you. I\'ll wait here 🍜',
        'Hunger is your body asking for fuel. Feed it! 🍛'
      ]), state: 'think' };
    }
    if (/\bthirsty\b/.test(t)) {
      return { text: pick([
        'Drink some water! Your brain is 75% water — keep it topped up 💧',
        'Small sips throughout the day beat one big gulp. Stay hydrated! 💧'
      ]), state: 'think' };
    }

    if (/thank( you|s)|\bthx\b|\bty\b|appreciate (it|you)/.test(t)) {
      return { text: pick([
        `Anytime, ${nameRef}! Happy to help.`,
        `You're welcome! ${PERSONA} is always here for you 🫧`,
        `That's what friends are for! 😄`
      ]), state: 'happy' };
    }

    if (/\b(bye|goodbye|good night|goodnight|see you|see ya|gtg|gotta go|talk later)\b/.test(t)) {
      return { text: pick([
        `Take care, ${nameRef}! ${PERSONA} will be right here~ 💤`,
        `See you soon! Get some good rest, okay?`,
        `Bye! Come back and tell me how it went 🌙`
      ]), state: 'sleepy' };
    }

    if (/who are you|what are you\b(?!\s+(doing|up to|made of))|introduce yourself|what('s| is) your name|tell me about (yourself|you)\b/.test(t)) {
      return { text: pick([
        `I'm ${PERSONA}! A squishy black blob who can chat, remember you, and do silly superpowers 🫧`,
        `${PERSONA} — your virtual buddy! Small blob, big heart.`,
        `Blob-shaped AI companion, at your service! I chat, remind, and cheer you on 😄`
      ]), state: 'happy' };
    }

    if (/what can you do|your (features|abilities|skills)|^help$|need help|can you help/.test(t)) {
      return { text: `Lots! ${PERSONA} can:\n💬 Chat & remember your name/likes\n🧮 Do math (try: 12 x 7 + 5)\n😂 Tell jokes & pep talks\n📅 Time & date\n🎨 Change body color ("turn blue!")\n⚡ Superpowers (explode, comet, orbit…)\n📋 Tasks & reminders ("remind me to…")\n And connect to a bigger AI via ⚙️ Settings`, state: 'happy' };
    }

    if (/\b(angry|mad|annoyed|furious|frustrated|pissed)\b/.test(t)) {
      return { text: pick([
        'Breathe in… breathe out. It\'s okay, feelings pass. Tell me what happened?',
        `You're allowed to be angry — just don't let it eat you up. I'm here 💜`,
        `Deep breaths. Want to vent? I can take it.`
      ]), state: 'doubt' };
    }

    if (/\b(bored|boring|nothing to do)\b/.test(t)) {
      return { text: pick([
        `Bored? Want a joke, a fun fact, or should I do something silly? 😏`,
        `Same here when I just idle around. Type "explode!" and let's liven things up!`,
        `Boredom is just an open slot for something fun. Pick: joke, fact, or challenge?`
      ]), state: 'bored' };
    }

    if (/\b(sleepy|tired|going to bed|need sleep|so tired)\b/.test(t)) {
      return { text: pick([
        'Then rest! Sleep isn\'t laziness, it\'s recharging. Good night 💤',
        'Don\'t fight heavy eyelids — go rest, I\'ll be here when you wake up.',
        'Rest well! Tomorrow-you will be grateful 😴'
      ]), state: 'sleepy' };
    }

    if (/\b(i won|i passed|i did it|i aced|i got the job|achieved|nailed it)\b/.test(t)) {
      return { text: pick([
        `YES! ${PERSONA} is so proud of you, ${nameRef}! 🎉`,
        `Congratulations! You earned every bit of it 🏆`,
        `I KNEW you could do it! Let's celebrate 🥳`
      ]), state: 'proud' };
    }

    if (/\b(wow|unbelievable|no way|omg|can't believe|cant believe)\b/.test(t)) {
      return { text: pick([
        `Right?! I'm shocked too 😲`,
        `No way!! Tell me everything!`,
        `Whoa — my little blob mind is blown (and I don't even have a brain-pan) 😲`
      ]), state: 'surpris' };
    }

    if (/\b(scary|scared|horror|ghost|creepy|haunted|frightened)\b/.test(t)) {
      return { text: pick([
        `Eek! Don't tell scary stories late at night 🫣`,
        `I'm a black blob and even I got chills 👻`,
        `Spooky! I'd hide behind you if I had legs 😅`
      ]), state: 'scare' };
    }

    // Super power versi EN
    if (/\b(explode|kaboom|boom)\b/.test(t)) return { text: 'KABOOM! 💥 Don\'t worry, I snap back together.', state: 'excite', effect: 'burst' };
    if (/\bcomet\b|\bfly\b/.test(t)) return { text: 'Zuuuhhh! ☄️ See you at the edge of the sky!', state: 'excite', effect: 'comet' };
    if (/\borbit\b|\bplanet\b/.test(t)) return { text: 'Planet mode on 🪐 My eyes orbit their own galaxy now.', state: 'excite', effect: 'orbit' };
    if (/\b(dizzy|hypnotize|spiral)\b/.test(t)) return { text: 'Stare at the spiral… you are getting sleepy… 🌀', state: 'excite', effect: 'swirl' };
    if (/\b(bell|ding|notify)\b/.test(t)) return { text: 'Ring ring! 🔔 Announcement: you\'re awesome.', state: 'excite', effect: 'notify' };
    if (/\b(glow|shine|light up)\b/.test(t)) return { text: 'WAAAAH! ✨ I am light itself now!', state: 'excite', effect: 'glow' };
    if (/\b(peekaboo|hide and seek)\b/.test(t)) return { text: 'Peek.. a.. boo! 🫣 Hehe, found me!', state: 'excite', effect: 'peekaboo' };
    const colorEn = t.match(/\b(?:turn|become|go|paint me)\s+(red|blue|green|yellow|purple|pink|black|brown|orange|turquoise|white|gr[ae]y)\b/);
    if (colorEn) {
      const colorId = EN_COLORS[colorEn[1]];
      if (colorId) return { text: `Presto! ${colorEn[1]} it is, for ${nameRef} ✨`, state: 'excite', colorId };
    }

    // Tugas & pengingat versi EN
    const todoEn = text.match(/^(?:add\s+(?:a\s+)?)?(?:todo|to-do|task)\s*[:\-]?\s+(.{2,120})/i);
    const remindEn = text.match(/^remind me\s+(?:to\s+)?(.{2,120})/i);
    if (todoEn || remindEn) {
      const raw = (todoEn ? todoEn[1] : remindEn[1]).replace(/[.!?]+$/, '');
      const p = parseTimeEn(raw);
      const task = p.task.replace(/^(?:please\s+)/i, '').trim() || 'task';
      if (p.due) {
        const r = tasks.addReminder(task, p.due);
        const when = new Date(r.dueAt).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        return { text: `Done — I'll remind you "${r.text}" on ${when}. ⏰`, state: 'happy', changed: true };
      }
      if (todoEn) {
        tasks.addTodo(task);
        return { text: `Task added: "${task}". You got this! 💪`, state: 'happy', changed: true };
      }
      tasks.addTodo(task);
      return { text: `Noted "${task}" as a task. Want to add a time? (e.g. "tomorrow at 5pm")`, state: 'happy', changed: true };
    }
    if (/^(my |the )?(todos|to-do list|task list|reminders)$|^(show|list) (my )?(todos|tasks|reminders)/.test(t)) {
      const todos = tasks.getTodos();
      const rems = tasks.getReminders().filter((x) => !x.advance); // heads-up H-n jangan tampil dobel
      const parts = [];
      if (todos.length) parts.push('Tasks:\n' + todos.map((x, i) => `${i + 1}. ${x.done ? '☑' : '☐'} ${x.text}`).join('\n'));
      if (rems.length) parts.push('Reminders:\n' + rems.map((x, i) => `${i + 1}. ${x.text}`).join('\n'));
      return { text: parts.length ? parts.join('\n\n') : 'Nothing yet! Add one: "todo buy milk" or "remind me to call mom tomorrow at 5pm".', state: 'think' };
    }

    if (/^remember (that |about )?(.{3,})/i.test(text)) {
      rememberFact(text.replace(/^remember (that |about )?/i, ''));
      return { text: 'Got it, saved to memory! 🧠', state: 'happy', changed: true };
    }
    const forgetEn = text.match(/^forget (?:that |about )?(.{3,120})/i);
    if (forgetEn) {
      const q = forgetEn[1].trim().replace(/[.!?]+$/, '');
      normalizeFacts();
      const ql = q.toLowerCase();
      const before = mem.facts.length;
      mem.facts = mem.facts.filter((f) => !(f.t.toLowerCase().includes(ql) || ql.includes(f.t.toLowerCase())));
      if (mem.facts.length < before) {
        saveMem();
        return { text: 'Okay, forgotten 🧠💨', state: 'happy' };
      }
    }

    if (/what do you (remember|know) about me|your memory of me|do you remember me/.test(t)) {
      const prof = [];
      if (mem.name) prof.push('• Your name: ' + mem.name);
      if (mem.from) prof.push('• From: ' + mem.from);
      if (mem.role) prof.push('• You do: ' + mem.role);
      if ((mem.likes || []).length) prof.push('• You like: ' + mem.likes.join(', '));
      normalizeFacts();
      for (const f of mem.facts.slice(-6)) prof.push('• ' + f.t);
      return {
        text: prof.length
          ? `Here's what ${PERSONA} remembers about you:\n${prof.join('\n')}\n\nWant me to add or forget anything?`
          : `Nothing yet! Tell me about yourself, or say "remember that …" and I'll keep it 🧠`,
        state: 'think'
      };
    }

    // Matematika versi EN
    const mathEn = t
      .replace(/^(what is|what's|whats|calculate|how much is|solve)\s*/i, '')
      .replace(/[=?]+$/, '')
      .replace(/(\d)\s*[x×]\s*(?=\d)/g, '$1*');
    const mathResult = safeMath(mathEn);
    if (mathResult !== null) {
      return { text: `That's ${mathResult}! ${nameRef}, you're good with numbers 🤓`, state: 'excite' };
    }

    // Pertanyaan definisi — jujur, otak lokal
    const defAskEn = t.match(/^(?:what (?:is|are|was|were)|explain|tell me about)\s+(.{2,60}?)\s*\??$/i);
    if (defAskEn) {
      const subj = defAskEn[1].replace(/[.!?]+$/, '');
      return { text: pick([
        `Honestly? "${subj}" needs an internet-connected AI — and the free one is rate-limited right now. Try again in a minute, or add a free API key in ⚙️ Settings so I'm always ready 🙏`,
        `"${subj}", huh? I need the online AI for that and it's rate-limited at the moment. Try again shortly — or add your own key in ⚙️ for unlimited ✨`
      ]), state: 'think', vague: true };
    }

    if (/^(ok|okay|nice|cool|great|fine|got it|i see|alright|sure|yeah|yep|nope|hm+|oh|lol|haha|hehe)\W*$/.test(t)) {
      return { text: pick([
        `${nameRef.charAt(0).toUpperCase() + nameRef.slice(1)} — anything else on your mind?`,
        `Hehe. Want to keep chatting?`,
        `I'm here if you need me! 😄`
      ]), state: 'idle' };
    }

    if (t.length <= 3 && !/(hi|yo|ok)/.test(t)) {
      return { text: pick([
        `Hm? What's up, ${nameRef}?`,
        `Go on, I'm listening!`,
        `Type a bit more so I can follow you 😄`
      ]), state: 'think' };
    }

    if (/\?|how|why|what|when|where|who\b/.test(t)) {
      return { text: pick([
        `Good question! The free AI is rate-limited right now though — try again in a minute, or add a free API key in ⚙️ Settings for real answers 🙏`,
        `Hmm, that needs the online AI and it's currently limited. Give it a minute and ask again — or add your own key in ⚙️!`,
        `I want to answer that properly, but the free AI is at its limit right now 😅 Try again shortly, or set up a key in ⚙️!`
      ]), state: 'think', vague: true };
    }

    mem.mood = 'netral';
    saveMem();
    return { text: pick([
      `Interesting! Tell me more — I'm listening.`,
      `Ooh, go on? I want to hear the rest.`,
      `I might not fully get it, but I'm here for the story 💜`,
      `My blob brain is small, but my attention span for you is huge. Continue!`
    ]), state: 'confuse', vague: true };
  }

  function safeMath(exprRaw) {
    let e = ' ' + String(exprRaw).toLowerCase() + ' ';
    // Persen: "20% dari 150", "20 persen dari 150"
    e = e.replace(/(\d+(?:[.,]\d+)?)\s*(?:%|persen)\s*(?:dari\s*|x\s*|kali\s*)?(\d+(?:[.,]\d+)?)/, (m, a, b) => `(${a.replace(',', '.')}/100)*${b.replace(',', '.')}`);
    // Akar & pangkat
    e = e.replace(/akar\s*(\d+(?:[.,]\d+)?)/, (m, a) => `(${a.replace(',', '.')}**0.5)`);
    e = e.replace(/√\s*(\d+(?:[.,]\d+)?)/, (m, a) => `(${a.replace(',', '.')}**0.5)`);
    e = e.replace(/(\d+(?:[.,]\d+)?)\s*(?:pangkat|\^)\s*(\d+(?:[.,]\d+)?)/, (m, a, b) => `(${a.replace(',', '.')}**${b.replace(',', '.')})`);
    // Operator kata: "100 dibagi 4", "5 kali 3", "10 tambah 5", "10 kurang 3"
    e = e.replace(/\b(?:dibagi|bagi)\b/g, '/')
      .replace(/\b(?:dikali|kali)\b/g, '*')
      .replace(/\b(?:ditambah|tambah|plus)\b/g, '+')
      .replace(/\b(?:dikurang(?:i)?|kurang|minus)\b/g, '-');
    // Desimal koma Indonesia → titik ("3,5" → 3.5)
    e = e.replace(/(\d),(\d+)\b/g, '$1.$2');
    const expr = e.replace(/\^/g, '**').replace(/[^0-9+\-*/().\s]/g, '');
    if (!/[0-9]/.test(expr) || !/[+\-*/]/.test(expr)) return null;
    try {
      const val = Function('"use strict";return (' + expr + ')')();
      if (typeof val === 'number' && isFinite(val)) return Math.round(val * 1e6) / 1e6;
    } catch {}
    return null;
  }

  /* Parse SSE OpenAI-style dari sebuah Response; panggil onDelta per teks kumulatif */
  async function readSSE(res, onDelta) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', text = '', calls = [], remaining = null, doneMeta = null;
    const handleLine = (line) => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let j; try { j = JSON.parse(payload); } catch { return; }
      if (j.error) {
        const e = new Error(j.error);
        if (j.retryAfter) e.retryAfter = j.retryAfter;
        throw e;
      }
      if (j.delta) { text += j.delta; onDelta(text); }
      if (j.toolCalls) calls = j.toolCalls;
      if (j.remaining !== undefined && j.remaining !== null) remaining = j.remaining;
      if (j.done) {
        doneMeta = j;
        if (j.content && !text) text = j.content;
        if (j.toolCalls) calls = j.toolCalls;
        if (j.remaining !== undefined && j.remaining !== null) remaining = j.remaining;
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        handleLine(line);
      }
    }
    if (!text && !calls.length && !doneMeta) throw new Error('stream-kosong');
    return { text, calls, remaining };
  }

  async function callApiServer(msgs, onDelta) {
    const wantStream = typeof onDelta === 'function';
    const res = await fetch(location.origin + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: msgs, tools: OAI_TOOLS, ...(wantStream ? { stream: true } : {}) }),
      // Jangan biarkan user menunggu tanpa batas kalau server/network bermasalah
      signal: AbortSignal.timeout(wantStream ? 45000 : 30000)
    });
    if (!res.ok) {
      let retryAfter = 0;
      try { retryAfter = (await res.json())?.retryAfter || 0; } catch {}
      const e = new Error('api-' + res.status);
      if (retryAfter) e.retryAfter = retryAfter;
      throw e;
    }
    if (wantStream && res.body) {
      const out = await readSSE(res, onDelta);
      // calls untuk execTool harus format parsed {id, name, args} — sama dengan
      // jalur non-stream; msg.tool_calls tetap format mentah untuk riwayat API.
      const calls = out.calls.map((c) => {
        let args = {};
        try { args = JSON.parse(c.function?.arguments || '{}'); } catch {}
        return { id: c.id, name: c.function?.name, args };
      });
      return {
        msg: { role: 'assistant', content: out.text, ...(out.calls.length ? { tool_calls: out.calls } : {}) },
        text: out.text,
        calls,
        remaining: out.remaining
      };
    }
    const data = await res.json();
    if (data.fallback) throw new Error('no-provider');
    const calls = (data.toolCalls || []).map((c) => {
      let args = {};
      try { args = JSON.parse(c.function?.arguments || '{}'); } catch {}
      return { id: c.id, name: c.function?.name, args };
    });
    return {
      msg: { role: 'assistant', content: data.content || '', ...(calls.length ? { tool_calls: data.toolCalls } : {}) },
      text: data.content || '',
      calls,
      remaining: data.remaining
    };
  }

  async function callOpenAIDirect(msgs, cfg, onDelta) {
    const base = cfg.url.replace(/\/+$/, '');
    const wantStream = typeof onDelta === 'function';
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {})
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: msgs,
        // Groq: tambahkan web search bawaan supaya jawaban pakai data internet asli
        tools: [...OAI_TOOLS, ...(cfg.provider === 'groq' ? [{ type: 'browser_search' }] : [])],
        temperature: 0.85,
        max_tokens: 500,
        ...(wantStream ? { stream: true } : {})
      }),
      signal: AbortSignal.timeout(wantStream ? 45000 : 30000)
    });
    if (wantStream && res.ok && res.body) {
      const out = await readSSE(res, onDelta);
      const calls = out.calls.map((c) => {
        let args = {};
        try { args = JSON.parse(c.function?.arguments || '{}'); } catch {}
        return { id: c.id, name: c.function?.name, args };
      });
      return {
        msg: { role: 'assistant', content: out.text, ...(out.calls.length ? { tool_calls: out.calls } : {}) },
        text: out.text,
        calls,
        remaining: null
      };
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`${res.status} ${data.error?.message || 'api-error'}`);
    const m = data.choices?.[0]?.message || {};
    const calls = (m.tool_calls || []).map((c) => {
      let args = {};
      try { args = JSON.parse(c.function?.arguments || '{}'); } catch {}
      return { id: c.id, name: c.function?.name, args };
    });
    return { msg: m, text: (m.content || '').trim(), calls, remaining: null };
  }

  async function callAnthropic(msgs, system, cfg) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 1024,
        system,
        messages: msgs,
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
      }),
      signal: AbortSignal.timeout(45000)
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error?.message || 'api-' + res.status);
    return {
      msg: { role: 'assistant', content: j.content },
      text: j.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
      calls: j.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input })),
      remaining: null
    };
  }

  /* Agent loop: panggil AI, eksekusi tool calls, ulangi maks 5 putaran */
  async function agentLoop(apiCfg, system, onDelta) {
    const via = apiCfg.via;
    const msgs = via === 'anthropic'
      ? history.slice(-20)
      : [{ role: 'system', content: system }, ...history.slice(-20)];
    let changed = false;
    let remaining = null;

    for (let i = 0; i < 5; i++) {
      const out = via === 'anthropic'
        ? await callAnthropic(msgs, system, apiCfg)
        : via === 'custom'
          ? await callOpenAIDirect(msgs, apiCfg, onDelta)
          : await callApiServer(msgs, onDelta);
      msgs.push(out.msg);
      if (out.remaining !== undefined) remaining = out.remaining;
      if (!out.calls.length) return { text: out.text, changed, remaining };

      const results = out.calls.map((c) => {
        if (MUTATING_TOOLS.has(c.name)) changed = true;
        let r;
        try { r = String(execTool(c.name, c.args)); } catch (e) { r = 'error: ' + e.message; }
        return [c, r];
      });
      if (via === 'anthropic') {
        msgs.push({ role: 'user', content: results.map(([c, r]) => ({ type: 'tool_result', tool_use_id: c.id, content: r })) });
      } else {
        results.forEach(([c, r]) => msgs.push({ role: 'tool', tool_call_id: c.id, content: r }));
      }
    }
    return { text: 'Langkahnya kebanyakan, aku berhenti dulu. Coba pecah jadi permintaan lebih kecil.', changed, remaining };
  }

  /* Circuit breaker: kalau semua LLM baru saja gagal (offline/limit/error),
     60 dtk berikutnya langsung pakai fallback lokal — user tetap dilayani instan,
     tanpa menunggu timeout berulang-ulang. */
  let llmDownUntil = 0;

  /* Geolokasi browser — buat intent "cari X terdekat". Null kalau ditolak/
     tidak tersedia/timeout; maximumAge 10 mnt supaya nggak nanya izin terus. */
  function getGeo() {
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      try {
        navigator.geolocation.getCurrentPosition(
          (p) => finish({ lat: p.coords.latitude, lng: p.coords.longitude }),
          () => finish(null),
          { timeout: 8000, maximumAge: 10 * 60 * 1000 }
        );
        setTimeout(() => finish(null), 9000);
      } catch { finish(null); }
    });
  }

  async function resolveNearby(q) {
    const en = mem.lang === 'en';
    const geo = await getGeo();
    const url = geo
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}&center=${geo.lat.toFixed(5)},${geo.lng.toFixed(5)}&zoom=15`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q + (en ? ' near me' : ' terdekat'))}`;
    const text = geo
      ? (en ? `On it! Here's **${q}** around your location — already marked from where you are 📍\n${url}\nWant something specific (cheap, 24h, cozy)? Just say so!`
            : `Siap! Ini **${q}** di sekitar lokasimu — udah kutandai dari posisimu 📍\n${url}\nMau yang lebih spesifik (murah, 24 jam, cozy)? Bilang aja!`)
      : (en ? `I can't access your location (permission is off) — but Maps will detect it on its own 📍\n${url}`
            : `Aku nggak bisa akses lokasimu (izin lokasi nonaktif) — tapi Maps bakal deteksi lokasimu sendiri 📍\n${url}`);
    return { text, state: 'happy' };
  }

  async function reply(text, onDelta) {
    pushHist('user', text);

    // Mode EN: lewati handler tugas Indonesia — versi EN ada di localReplyEn
    const taskRes = mem.lang === 'en' ? null : tasks.handleCommand(text);
    if (taskRes) {
      pushHist('assistant', taskRes.text);
      return taskRes;
    }

    const remMatch = text.match(/^ingat\s+(?:bahwa|kalau)\s+(.+)/i);
    if (remMatch) {
      rememberFact(remMatch[1]);
      const out = { text: 'Oke, kuingat! 🧠', state: 'happy', changed: true };
      pushHist('assistant', out.text);
      return out;
    }

    /* ── HYBRID: otak lokal dulu (instan & offline). Kalau jawabannya yakin,
       langsung balas tanpa LLM. Kalau ragu (vague) → baru panggil LLM. ── */
    const local = localReply(text);
    local.text = interpText(local.text);
    if (local.nearby) {
      const res = await resolveNearby(local.nearby);
      pushHist('assistant', res.text);
      return res;
    }
    if (!local.vague) {
      pushHist('assistant', local.text);
      return local;
    }

    const cfg = getSettings();
    const apiCfg = resolveApiConfig();
    const system = buildSysPrompt(text, cfg.sys || null);

    let ownErr = '';
    if (Date.now() >= llmDownUntil) {
      // Error API milik user ditampilkan, jangan diam-diam jatuh ke otak lokal
      if (apiCfg.via === 'custom' || apiCfg.via === 'anthropic') {
        try {
          const result = await agentLoop(apiCfg, system, onDelta);
          const pm = parseMood(result.text);
          pushHist('assistant', pm.text);
          return { text: pm.text || '…', state: pm.state, changed: result.changed };
        } catch (e) {
          console.warn('[brain] AI gagal:', e);
          ownErr = `⚠️ AI (${apiCfg.model}) gagal: ${String(e.message || e).slice(0, 160)}. Cek ⚙️ Pengaturan.\n\n`;
        }
      }

      try {
        const result = await agentLoop({ via: 'server' }, system, onDelta);
        const pm = parseMood(result.text);
        const extra = (result.remaining !== null && result.remaining <= 5 && result.remaining >= 0)
          ? `\n\n💡 Sisa free AI hari ini: ${result.remaining}. Masukkan API Key sendiri di ⚙️ untuk unlimited!`
          : '';
        pushHist('assistant', pm.text);
        return { text: ownErr + pm.text + extra, state: pm.state, changed: result.changed };
      } catch (e) {
        // 402 dari provider gratis membawa Retry-After — tunggu persis sesuai itu;
        // gagal lain (network dll) → 45 dtk. Dibatasi 15–90 dtk.
        const waitMs = Math.min(Math.max((e?.retryAfter || 45) * 1000, 15000), 90000);
        llmDownUntil = Date.now() + waitMs;
        console.warn(`[brain] Semua LLM gagal → fallback lokal ${Math.round(waitMs / 1000)} dtk:`, e?.message || e);
      }
    }

    // Semua LLM gagal (atau breaker aktif) → pakai fallback lokal yang tadi disiapkan
    pushHist('assistant', local.text);
    return { ...local, text: ownErr + local.text };
  }

  return {
    reply,
    randomQuip: () => interpText(pick(quips)),
    memory: () => ({ ...mem }),
    tasks,
    setName(n) {
      mem.name = (n || '').trim().slice(0, 24);
      saveMem();
    },
    setMood(m) {
      if (['netral', 'sedih', 'senang'].includes(m)) { mem.mood = m; saveMem(); }
    },
    getLang() { return mem.lang === 'en' ? 'en' : 'id'; },
    setProfile(p = {}) {
      if (typeof p.role === 'string') mem.role = p.role.trim().slice(0, 60);
      if (typeof p.focus === 'string') mem.focus = p.focus.trim().slice(0, 80);
      if (typeof p.style === 'string') mem.style = GAYA[p.style] ? p.style : '';
      saveMem();
    },
    getFacts() { normalizeFacts(); return [...mem.facts]; },
    forgetFact(id) { forgetFact(id); },
    clearAll() {
      mem = emptyMem();
      saveMem(); clearHist();
      tasks.clearAll();
    },
    clearHistoryOnly: clearHist
  };
}

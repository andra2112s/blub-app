const MEM_KEY = 'blub.memory';
const HIST_KEY = 'blub.history';

export let PERSONA = detectPersona();

export function setPersona(name) {
  if (name === 'Dodol' || name === 'Mochi') PERSONA = name;
}

function detectPersona() {
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
    return langs.some((l) => /^id/i.test(l)) ? 'Dodol' : 'Mochi';
  } catch {
    return 'Mochi';
  }
}

const COLOR_WORDS = {
  hitam: 'encre',
  coklat: 'brun',
  merah: 'rouge',
  oranye: 'orange',
  kuning: 'ambre',
  hijau: 'vert',
  toska: 'turquoise',
  biru: 'bleu',
  ungu: 'violet',
  pink: 'rose',
  'merah muda': 'rose',
  abu: 'gris',
  putih: 'creme',
  krem: 'creme'
};

const POWER_HELP =
  `Daftar kekuatan super ${PERSONA}:\n• "meledak!" 💥\n• "jadi komet!" ☄️\n• "mode planet!" 🪐\n• "pusarin!" 🌀\n• "wih!" ❗\n• "lonceng!" 🔔\n• "jadi biru / merah / ungu…" 🎨`;

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

export function createBrain() {
  let mem = load(MEM_KEY, { name: '', likes: [], from: '', mood: 'netral' });
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
  } catch {
    history = [];
  }

  const saveMem = () => localStorage.setItem(MEM_KEY, JSON.stringify(mem));
  const pushHist = (role, content) => {
    history.push({ role, content });
    if (history.length > 30) history = history.slice(-30);
    localStorage.setItem(HIST_KEY, JSON.stringify(history));
  };
  const clearHist = () => {
    history = [];
    localStorage.removeItem(HIST_KEY);
  };

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const jokes = [
    'Kenapa laptop nggak pernah lapar? Karena sudah kenyang makan data! 🥁',
    'Buat apa bawa tangga ke bar? Supaya minumnya high-level.',
    'Kenapa HP nggak boleh sedih? Karena nanti jadi hape-less... eh, hopeless!',
    'Nasi goreng nggak bisa ketawa, tapi mie ayam bisa — soalnya dia punya bakso terakhir yang kelakar.',
    'Aku mau diet, tapi otakku bilang: "jangan khianati memori manis itu."'
  ];

  const motivasi = [
    'Pelan-pelan aja, yang penting jalan terus. Aku di sini kok. 💪',
    'Nggak apa-apa merasa lelah, itu tandanya kamu sudah berjuang. Istirahat dulu ya.',
    'Hari yang berat hari ini bukan berarti besok sama. ${PERSONA} percaya kamu bisa!',
    'Tarik napas... hembuskan. Kamu sudah hebat sampai sejauh ini.'
  ];

  const fallbacks = [
    'Hmm, menarik! Cerita lagi dong, aku dengerin.',
    'Wah, aku belum paham sepenuhnya. Coba kata lain?',
    'Ooo begitu ya. Terus gimana ceritanya?',
    'Aku mungkin blob sederhana, tapi aku selalu senang dengar ceritamu!',
    'Menarik! Btw, apa hal kecil yang bikin kamu senyum hari ini?'
  ];

  const quips = [
    `Hehe, itu geli!, Hihi!, ${PERSONA} ${PERSONA}~`, 'Eh, jangan dicolek!', 'Lagi-lagi?!',
    'Duh, gemas.', 'Sekali lagi boleh?', 'Awas ya!'
  ];

  const getSettings = () => load('blub.settings', { url: '', key: '', model: '', sys: '' });

  async function callApi(text) {
    const cfg = getSettings();
    if (!cfg.url || !cfg.model) throw new Error('no-api');
    const base = cfg.url.replace(/\/+$/, '');
    const messages = [
      { role: 'system', content: cfg.sys || `Kamu adalah ${PERSONA}, teman AI berbentuk blob hitam menggemaskan. Bicara santai dalam Bahasa Indonesia, hangat, singkat (maks 3 kalimat), dan suka bertanya balik.` },
      ...history,
      { role: 'user', content: text }
    ];
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {})
      },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.8, max_tokens: 300 })
    });
    if (!res.ok) throw new Error('api-' + res.status);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  function safeMath(exprRaw) {
    const expr = exprRaw.replace(/\^/g, '**').replace(/[^0-9+\-*/().\s]/g, '');
    if (!/[0-9]/.test(expr) || !/[+\-*/^]/.test(expr)) return null;
    try {
      const val = Function('"use strict";return (' + expr + ')')();
      if (typeof val === 'number' && isFinite(val)) {
        return Math.round(val * 1e6) / 1e6;
      }
    } catch {}
    return null;
  }

  function localReply(text) {
    const t = text.toLowerCase().trim();
    const hasName = !!mem.name;

    if (/lupa(ikan)? (semua|aku|semua ingatan)|reset (memori|ingatan)/.test(t)) {
      mem = { name: '', likes: [], from: '', mood: 'netral' };
      saveMem();
      clearHist();
      return { text: 'Sudah aku hapus semua ingatan. Kita mulai dari nol ya! Siapa nama kamu?', state: 'think' };
    }

    if (/^(hai|hi|halo|hello|hei|hey|pagi|siang|sore|malam)\b/.test(t)) {
      const h = new Date().getHours();
      const greet = h < 11 ? 'Pagi' : h < 15 ? 'Siang' : h < 19 ? 'Sore' : 'Malam';
      return {
        text: `${greet}, ${hasName ? mem.name + '!' : '!'} Aku senang kamu muncul. Ada yang bisa ${PERSONA} bantu?`,
        state: 'happy'
      };
    }

    if (/(apa kabar|kabarmu|gimana kabar)/.test(t)) {
      return { text: 'Kabar aku? Selalu kenyal dan bahagia! ' + (hasName ? 'Kamu sendiri gimana, ' + mem.name + '?' : 'Kamu gimana?'), state: 'happy' };
    }

    const nameSet = text.match(/nama\s?(ku|saya|aku|gue|gua)?\s?(adalah|ialah|itu|:)?\s*([a-zA-Z\u00C0-\u024F' -]{2,24})/i);
    if (nameSet && /(nama|panggil)/i.test(nameSet[0])) {
      mem.name = nameSet[3].trim().replace(/\s+(ya|yah|sih|dong)$/i, '');
      saveMem();
      return { text: `Siap! Halo, ${mem.name}! Nama yang bagus. Aku akan selalu ingat.`, state: 'excite' };
    }

    if (/(siapa nama\s?(ku|saya)|ingat nama(ku| saya)?|kamu tahu nama(ku| saya))/.test(t)) {
      return hasName
        ? { text: `Tentu ingat! Kamu ${mem.name}. Kan aku penyimpan nama paling andal. 😌`, state: 'happy' }
        : { text: 'Belum tahu nih! Kasih tahu dong, siapa nama kamu?', state: 'think' };
    }

    if (/(aku|saya|gue)\s+(lagi\s+)?(sedih|nangis|melo|down|capek|lelah|penat|stres|stress|burnout)/.test(t)) {
      mem.mood = 'sedih';
      saveMem();
      return { text: pick(motivasi), state: 'sad' };
    }
    if (/(motivasi|semangat(in|in dong)?|bantu semangat)/.test(t)) {
      return { text: pick(motivasi), state: 'happy' };
    }

    const like = t.match(/(aku|saya|gue)\s+(suka|doyan|gemar)\s+(.{2,60})/);
    if (like) {
      const item = like[3].trim();
      if (!mem.likes.includes(item)) mem.likes.push(item);
      saveMem();
      return { text: `Wah, ${item}! Dicatat di ingatan blob ini. Kenapa suka?`, state: 'happy' };
    }

    const from = t.match(/(aku|saya|gue)\s+(dari|tinggal di)\s+([a-z\u00C0-\u024F .'-]{2,40})/);
    if (from) {
      mem.from = from[3].trim();
      saveMem();
      return { text: `${mem.from}! Keren, suatu saat mungkin ${PERSONA} nyusul kesana. 🫧`, state: 'happy' };
    }

    if (/(apa (yang )?(aku|saya) suka|hobi\s?(ku| saya| aku)|apa hobi)/.test(t)) {
      if (mem.likes.length) {
        return { text: `Kalau nggak salah, kamu suka ${mem.likes.join(', ')}. Betulkan?`, state: 'think' };
      }
      return { text: 'Belum ada catatan nih. Suka apa aja sih? Biar aku hafal!', state: 'think' };
    }

    if (/(jam berapa|pukul berapa|waktu sekarang)/.test(t)) {
      return { text: 'Sekarang jam ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + '. Jam tidur atau jam ngopi nih?', state: 'think' };
    }
    if (/(hari apa|tanggal berapa)/.test(t)) {
      return { text: 'Hari ini ' + new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '.', state: 'open' };
    }

    if (/(joke|lelucon|lawakan|humor|ketawa|lucu(in|an))/.test(t)) {
      return { text: pick(jokes), state: 'happy' };
    }

    if (/(cuaca|hujan|gerah|panas banget|dingin banget)/.test(t)) {
      return { text: 'Aku blob digital, nggak punya jendela… tapi menurut mood kamu hari ini, sepertinya butuh camilan. ☕', state: 'think' };
    }

    if (/(sayang|cinta|kamu lucu|kamu imut|gemes)/.test(t)) {
      return { text: 'E-eh… blob hitam seperti aku jadi malu deh. 🥹 Tapi aku juga sayang kamu!', state: 'happy' };
    }

    if (/(makasih|terima kasih|thanks|thank you|tengkyu)/.test(t)) {
      return { text: `Sama-sama! Senang bisa bantu. ${PERSONA} selalu di sini.`, state: 'happy' };
    }

    if (/\b(bye|dadah|sampai jumpa|udahan|cabut|tidur dulu|oyasumi)\b/.test(t)) {
      return { text: `Oke, hati-hati ya! Jangan lupa istirahat. ${PERSONA} tungguin di sini~ 💤`, state: 'sleepy' };
    }

    if (/(siapa (sih )?(kamu|km)|kamu (ini )?siapa|nama kamu)/.test(t)) {
      return { text: `Aku ${PERSONA}! Blob hitam yang morphing bentuknya, suka dicolek, dan paling seneng nemenin kamu ngobrol.`, state: 'happy' };
    }

    if (/(bisa apa|fitur|help|tolong bantuan|bantuan)/.test(t)) {
      return { text: 'Banyak! Aku bisa:\n• Ngobrol & inget nama/hobi kamu\n• Jawab matematika (coba: 12 x 7 + 5)\n• Kasih joke & motivasi\n• Sebut jam & tanggal\n• Dan bisa disambungkan ke AI besar lewat pengaturan ⚙️', state: 'happy' };
    }

    if (/(install|pasang|pwa|add to home)/.test(t)) {
      return { text: 'Tekan tombol "Pasang" di atas kanan! Di iPhone Safari: tekan Share lalu "Add to Home Screen".', state: 'think' };
    }

    const mathCandidate = t.replace(/^(berapa|hitung(in)?|berapa hasil)\s*/i, '').replace(/[=?]+$/, '');
    const mathResult = safeMath(mathCandidate);
    if (mathResult !== null) {
      return { text: `Hasilnya ${mathResult}! Aduh jempol blob sampe kram ngitungnya. 🤓`, state: 'excite' };
    }

    if (/(kekuatan|super power|superpower|power mu)/.test(t)) {
      return { text: POWER_HELP, state: 'excite' };
    }

    const colorWord = t.match(/(jadi|ganti|ubah)\s+(warna\s+)?(hitam|coklat|merah|oranye|kuning|hijau|toska|biru|ungu|pink|merah muda|abu-?abu|abu|putih|krem)/);
    if (colorWord) {
      const word = colorWord[3].replace(/-?abu$/, 'abu');
      const colorId = COLOR_WORDS[word];
      if (colorId) {
        return {
          text: `Presto! Warna ${word} untukmu ✨`,
          state: 'excite',
          colorId
        };
      }
    }

    if (/(ledak|meledak|pecah|boom|bledug)/.test(t)) {
      return { text: 'KABOOM! 💥 Tenang, badanku nyatu lagi kok.', state: 'excite', effect: 'burst' };
    }
    if (/(\bkomet\b|terbang|nyeberang)/.test(t)) {
      return { text: 'Zuuuhhh! ☄️ Sampai jumpa di ujung langit!', state: 'excite', effect: 'comet' };
    }
    if (/(orbit|planet|satelit|matahari)/.test(t)) {
      return { text: 'Mode planet aktif 🪐 Mataku muter ngelilingi galaksi sendiri.', state: 'excite', effect: 'orbit' };
    }
    if (/(pusar|pusing|hipnotis)/.test(t)) {
      return { text: 'Stare at the spiral… you are getting sleepy… 🌀', state: 'excite', effect: 'swirl' };
    }
    if (/(wih|tanda seru|\bexclaim\b)/.test(t)) {
      return { text: 'WIH INDAH BANGET!!! ❗', state: 'excite', effect: 'exclaim' };
    }
    if (/(lonceng|notif|bel sekolah)/.test(t)) {
      return { text: 'Ting ting! 🔔 Ada pengumuman: kamu hebat.', state: 'excite', effect: 'notify' };
    }

    if (/(ciluk\s?ba|peek[\s-]?a[\s-]?boo|sembunyi)/.test(t)) {
      return { text: 'Ciluk.. baa! 🫣 Hehe, ketahuan!', state: 'excite', effect: 'peekaboo' };
    }

    if (/mulai pomodoro/.test(t)) {
      return { text: 'Siap! ⏱️ Mulai fokus 25 menit… aku angkat bendera kuning dulu ya. Ketik "rehat" kalau sudah waktunya istirahat!', state: 'excite', effect: 'notify' };
    }
    if (/rehat/.test(t)) {
      return { text: 'Rehat 5 menit dulu ☕ Regangkan badan, minum air. Ketik "mulai pomodoro" lagi kalau sudah siap!', state: 'happy', effect: 'exclaim' };
    }
    if (/(apa\s+itu\s+pomodoro|pomodoro\s+(adalah|itu|merupakan))/i.test(t)) {
      return { text: 'Pomodoro: teknik manajemen waktu — kerja 25 menit, rehat 5 menit, ulangi 4x, lalu rehat panjang 15–30 menit. Ketik "mulai pomodoro" buat mulai!', state: 'think' };
    }

    if (/(apa itu|pengertian|definisi)\s+(.{3,40})/.test(t)) {
      const what = t.match(/(apa itu|pengertian|definisi)\s+(.{3,40})/)[2];
      return { text: `Hmm, "${what}" — aku nggak punya database gede, tapi kalau kamu jelasin sedikit, aku bisa bantu rangkum atau diskusiin! 🫧`, state: 'think' };
    }

    mem.mood = 'netral';
    saveMem();
    return { text: pick(fallbacks), state: 'idle' };
  }

  async function reply(text) {
    pushHist('user', text);
    const cfg = getSettings();
    if (cfg.url && cfg.key && cfg.model) {
      try {
        const apiText = await callApi(text);
        pushHist('assistant', apiText);
        return { text: apiText, state: 'talk' };
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 350));
    const local = localReply(text);
    pushHist('assistant', local.text);
    return local;
  }

  return {
    reply,
    randomQuip: () => pick(quips),
    memory: () => ({ ...mem }),
    setName(n) {
      mem.name = (n || '').trim().slice(0, 24);
      saveMem();
    },
    clearAll() {
      mem = { name: '', likes: [], from: '', mood: 'netral' };
      saveMem();
      clearHist();
    },
    clearHistoryOnly: clearHist
  };
}

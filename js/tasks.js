const TODOS_KEY = 'Mochi.todos';
const REMINDERS_KEY = 'Mochi.reminders';

// Peringatan awal otomatis: H-5, H-3, H-2, H-1 sebelum jatuh tempo
const HEADS_UP_DAYS = [5, 3, 2, 1];

function uid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

function load(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function save(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

function pad(n) { return String(n).padStart(2, '0'); }

function applyPeriod(h, per) {
  if (!per || h >= 13) return h;
  if (per === 'pagi' || per === 'subuh') return h;
  if (per === 'malam' && h === 12) return 0;
  return h + 12;
}

function parseTime(text) {
  const now = new Date();
  let due = null;
  let task = text;

  const relMin = text.match(/(\d+)\s*menit\s*lagi/);
  if (relMin) {
    due = new Date(now.getTime() + parseInt(relMin[1]) * 60000);
    task = task.replace(relMin[0], '').trim();
    return { due, task };
  }

  const relHour = text.match(/(\d+)\s*jam\s*lagi/);
  if (relHour) {
    due = new Date(now.getTime() + parseInt(relHour[1]) * 3600000);
    task = task.replace(relHour[0], '').trim();
    return { due, task };
  }

  if (/sebentar lagi/.test(text)) {
    due = new Date(now.getTime() + 5 * 60000);
    task = task.replace(/sebentar lagi/, '').trim();
    return { due, task };
  }

  const dayMonth = parseDayMonth(text);
  if (dayMonth) {
    let task = text;
    for (const part of dayMonth.consumed) task = task.replace(part, '');
    return { due: dayMonth.due, task: task.trim() };
  }

  const nantiMatch = text.match(/nanti\s+(pagi|siang|sore|malam|subuh)/);
  if (nantiMatch) {
    const map = { pagi: 7, siang: 12, sore: 16, malam: 20, subuh: 4 };
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), map[nantiMatch[1]], 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    due = target;
    task = task.replace(nantiMatch[0], '').trim();
    return { due, task };
  }

  const besokMatch = text.match(/besok(?:\s+jam\s+(\d+)(?:[.:](\d+))?\s*(pagi|siang|sore|malam|subuh)?)?/);
  if (besokMatch) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (besokMatch[1]) {
      let h = parseInt(besokMatch[1]);
      let m = parseInt(besokMatch[2] || '0');
      h = applyPeriod(h, besokMatch[3]);
      base.setHours(h, m, 0, 0);
    } else {
      base.setHours(8, 0, 0, 0);
    }
    due = base;
    task = task.replace(besokMatch[0], '').trim();
    return { due, task };
  }

  const hariIniMatch = text.match(/hari ini(?:\s+jam\s+(\d+)(?:[.:](\d+))?\s*(pagi|siang|sore|malam|subuh)?)?/);
  if (hariIniMatch) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (hariIniMatch[1]) {
      let h = parseInt(hariIniMatch[1]);
      let m = parseInt(hariIniMatch[2] || '0');
      h = applyPeriod(h, hariIniMatch[3]);
      base.setHours(h, m, 0, 0);
      if (base <= now) base.setDate(base.getDate() + 1);
    } else {
      base.setHours(8, 0, 0, 0);
    }
    due = base;
    task = task.replace(hariIniMatch[0], '').trim();
    return { due, task };
  }

  const absMatch = text.match(/(?:jam|pukul)\s+(\d+)(?:[.:](\d+))?\s*(pagi|siang|sore|malam|subuh)?/);
  if (absMatch) {
    let h = parseInt(absMatch[1]);
    let m = parseInt(absMatch[2] || '0');
    h = applyPeriod(h, absMatch[3]);
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    due = target;
    task = task.replace(absMatch[0], '').trim();
    return { due, task };
  }

  return { due: null, task: text };
}

const MONTHS = {
  januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5,
  juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, agu: 7, ags: 7,
  sep: 8, okt: 9, nov: 10, des: 11
};

function parseDayMonth(text) {
  const now = new Date();
  let m = text.match(/(?:tgl|tanggal)\s+(\d{1,2})(?:\s+([a-zA-Z]+))?/);
  let day = null, month, base;
  if (m) {
    day = parseInt(m[1]);
    month = m[2] ? MONTHS[m[2].toLowerCase()] : undefined;
    // Kata setelah angka yang bukan bulan ("tgl 15 nanti") tidak ikut terpotong
    base = m[2] && month === undefined ? m[0].slice(0, m[0].lastIndexOf(m[2])).trimEnd() : m[0];
  } else {
    m = text.match(/\b(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|jun|jul|agu|ags|sep|okt|nov|des)\b/i);
    if (m) {
      day = parseInt(m[1]);
      month = MONTHS[m[2].toLowerCase()];
      base = m[0];
    }
  }
  if (!day || day > 31) return null;

  const parts = [base];
  let hh = 8, mm = 0;
  const tm = text.match(/(?:jam|pukul)\s+(\d{1,2})(?:[.:](\d{1,2}))?\s*(pagi|siang|sore|malam|subuh)?/);
  if (tm) {
    hh = applyPeriod(parseInt(tm[1]), tm[3]);
    mm = parseInt(tm[2] || '0');
    parts.push(tm[0]);
  }

  let target;
  if (month !== undefined) {
    target = new Date(now.getFullYear(), month, day, hh, mm, 0, 0);
    if (target <= now) target.setFullYear(target.getFullYear() + 1);
  } else {
    target = new Date(now.getFullYear(), now.getMonth(), day, hh, mm, 0, 0);
    if (target <= now) target.setMonth(target.getMonth() + 1);
  }
  return { due: target, consumed: parts };
}

function cleanTask(raw) {
  return raw
    .replace(/^ingatkan(?: aku)?\b/, '')
    .replace(/^reminder\b/, '')
    .replace(/^jangan lupa\b/, '')
    .replace(/^(?:todo|tugas|to do|kerjakan|daftarkan|catat)\b/, '')
    .replace(/^nanti\b/, '')
    .replace(/^besok\b/, '')
    .replace(/^hari ini\b/, '')
    .replace(/^[\s:,-]+/, '')
    .trim()
    .replace(/[.!?]+$/, '');
}

function formatDue(date) {
  const now = new Date();
  const d = new Date(date);
  const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  const isTomorrow = d.getDate() === now.getDate() + 1 && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (isToday) return `hari ini jam ${time}`;
  if (isTomorrow) return `besok jam ${time}`;
  const dateStr = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  return `${dateStr} jam ${time}`;
}

// Frasa pengingat berulang bulanan: "tiap bulan", "tiap tanggal 15",
// "setiap bulan tanggal 15", "tiap tgl 15", "bulanan tgl 15", "per bulan tgl 15"
const MONTHLY_RE = /(?:tiap|setiap)\s+bulan|bulanan|per\s+bulan|(?:tiap|setiap)\s+(?=(?:tgl|tanggal)\b)/;

// Buang frasa bulanan tapi sisakan kata "tgl/tanggal" supaya parseTime tetap paham
function stripMonthlyPhrase(text) {
  return text.replace(MONTHLY_RE, '').replace(/\s{2,}/g, ' ').trim();
}

// Batas jumlah pengulangan bulanan (cicilan): "12 kali", "12x"
const COUNT_RE = /(\d{1,3})\s*(?:kali|x)\b/;

// Buang frasa "N kali"/"Nx" beserta koma pemisah opsional di depannya
function stripCountPhrase(text) {
  return text.replace(/[,\s]*\d{1,3}\s*(?:kali|x)\b/, ' ').replace(/\s{2,}/g, ' ').trim();
}

// Jatuh tempo bulanan berikutnya: tanggal patokan repeat.day di bulan setelah
// fromDate (di-clamp ke hari terakhir bulan kalau tanggal tsb tidak ada,
// mis. tgl 31 di bulan 30 hari). Siklus tidak bergeser oleh snooze/telat.
function nextMonthly(repeat, fromDate) {
  const from = new Date(fromDate);
  let y = from.getFullYear();
  let mo = from.getMonth() + 1;
  if (mo > 11) { mo = 0; y += 1; }
  const at = () => {
    const last = new Date(y, mo + 1, 0).getDate();
    return new Date(y, mo, Math.min(repeat.day, last), repeat.hh, repeat.mm, 0, 0);
  };
  let target = at();
  if (target <= from) {
    mo += 1;
    if (mo > 11) { mo = 0; y += 1; }
    target = at();
  }
  return target;
}

function formatRepeat(repeat) {
  const base = `tiap tanggal ${repeat.day} jam ${pad(repeat.hh)}:${pad(repeat.mm)}`;
  if (repeat.total >= 1 && repeat.left >= 1) {
    return repeat.left === repeat.total
      ? `${base} (bulanan, ${repeat.total} kali)`
      : `${base} (bulanan, sisa ${repeat.left} dari ${repeat.total})`;
  }
  return `${base} (bulanan)`;
}

export function createTaskManager() {
  function loadTodos() { return load(TODOS_KEY); }
  function saveTodos(todos) { save(TODOS_KEY, todos); }
  function loadReminders() {
    const items = load(REMINDERS_KEY);
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const keep = items.filter(x => !(x.notified && x.dueAt < cutoff));
    if (keep.length !== items.length) saveReminders(keep);
    return keep;
  }
  function saveReminders(reminders) { save(REMINDERS_KEY, reminders); }

  function addTodo(text) {
    const todos = loadTodos();
    const todo = { id: uid(), text, done: false, createdAt: Date.now() };
    todos.push(todo);
    saveTodos(todos);
    return todo;
  }

  function listTodos() {
    const todos = loadTodos();
    if (!todos.length) return { text: 'Belum ada tugas. Mau nambahin? Ketik "todo beli susu".', state: 'think' };
    const lines = todos.map((x, i) => `${i + 1}. ${x.done ? '☑' : '☐'} ${x.text}`).join('\n');
    const pending = todos.filter(x => !x.done).length;
    return { text: `Daftar tugasmu (${pending} belum selesai):\n${lines}`, state: 'think' };
  }

  function findTodoIndex(q) {
    const todos = loadTodos();
    const qlower = q.toLowerCase();
    return todos.findIndex(x => x.text.toLowerCase() === qlower || x.text.toLowerCase().includes(qlower));
  }

  function toggleTodo(query, forceDone = false) {
    const todos = loadTodos();
    const idx = findTodoIndex(query);
    if (idx === -1) return { found: false };
    todos[idx].done = forceDone ? true : !todos[idx].done;
    saveTodos(todos);
    return { found: true, text: `"${todos[idx].text}" ${todos[idx].done ? 'sudah selesai. Keren!' : 'dibuka kembali.'}` };
  }

  function deleteTodo(query) {
    const todos = loadTodos();
    const qlower = query.toLowerCase();
    const next = todos.filter(x => !(x.text.toLowerCase() === qlower || x.text.toLowerCase().includes(qlower)));
    if (next.length === todos.length) return false;
    saveTodos(next);
    return true;
  }

  function clearDone() {
    const todos = loadTodos().filter(x => !x.done);
    saveTodos(todos);
    return { text: 'Tugas selesai sudah dibersihkan.', state: 'happy' };
  }

  function parsePreview(text) {
    const p = parseTime(text);
    return { task: cleanTask(p.task) || p.task, due: p.due };
  }

  function makeHeadsUp(r) {
    const out = [];
    for (const d of HEADS_UP_DAYS) {
      const early = r.dueAt - d * 86400000;
      if (early > Date.now() + 60000) {
        out.push({ id: uid(), text: r.text, dueAt: early, advance: d, groupId: r.id, notified: false, notifiedAt: 0, createdAt: Date.now() });
      }
    }
    return out;
  }

  function addReminder(text, dueAt, opts = {}) {
    const reminders = loadReminders();
    const r = { id: uid(), text, dueAt: dueAt.getTime(), notified: false, notifiedAt: 0, createdAt: Date.now() };
    const wantHeadsUp = opts.headsUp !== false;
    if (!wantHeadsUp) r.noHeadsUp = true;
    if (opts.repeat) {
      r.repeat = { freq: 'monthly', day: dueAt.getDate(), hh: dueAt.getHours(), mm: dueAt.getMinutes() };
      const count = Math.floor(opts.repeat.count);
      if (count >= 1) { r.repeat.total = count; r.repeat.left = count; }
    }
    reminders.push(r);
    const headsUp = wantHeadsUp ? makeHeadsUp(r) : [];
    reminders.push(...headsUp);
    saveReminders(reminders);
    return { ...r, headsUp: headsUp.map((h) => h.advance) };
  }

  function updateReminder(id, { text, dueAt, headsUp, repeat } = {}) {
    const reminders = loadReminders();
    const r = reminders.find(x => x.id === id && !x.advance);
    if (!r) return null;
    const keep = reminders.filter(x => x.id === id || x.groupId !== id);
    r.text = text;
    r.dueAt = dueAt.getTime();
    r.notified = false;
    r.notifiedAt = 0;
    if (headsUp !== undefined) {
      if (headsUp) delete r.noHeadsUp; else r.noHeadsUp = true;
    }
    if (repeat !== undefined) {
      if (repeat) {
        const prev = r.repeat;
        r.repeat = { freq: 'monthly', day: dueAt.getDate(), hh: dueAt.getHours(), mm: dueAt.getMinutes() };
        const count = Math.floor(repeat.count);
        if (count >= 1) {
          r.repeat.total = count;
          r.repeat.left = count;
        } else if (prev && prev.total >= 1 && prev.left >= 1) {
          // Tanpa count baru, pertahankan sisa cicilan lama
          r.repeat.total = prev.total;
          r.repeat.left = prev.left;
        }
      }
      else delete r.repeat;
    }
    const newHeadsUp = r.noHeadsUp ? [] : makeHeadsUp(r);
    keep.push(...newHeadsUp);
    saveReminders(keep);
    return { ...r, headsUp: newHeadsUp.map((h) => h.advance) };
  }

  function snoozeReminder(id, ms) {
    const reminders = loadReminders();
    const r = reminders.find(x => x.id === id);
    if (!r) return;
    r.dueAt = Date.now() + ms;
    r.notified = false;
    r.notifiedAt = 0;
    saveReminders(reminders);
  }

  function getReminderGroups() {
    const reminders = loadReminders();
    const now = Date.now();
    const byId = new Map(reminders.map(r => [r.id, r]));
    const headsUpByGroup = new Map();
    const mains = [];
    for (const r of reminders) {
      if (r.advance) {
        if (!byId.has(r.groupId)) {
          // Entri H-n yatim (induknya hilang) diperlakukan sebagai pengingat utama
          mains.push(r);
        } else {
          if (!headsUpByGroup.has(r.groupId)) headsUpByGroup.set(r.groupId, []);
          headsUpByGroup.get(r.groupId).push(r);
        }
      } else {
        mains.push(r);
      }
    }
    return mains
      .sort((a, b) => a.dueAt - b.dueAt)
      .map(main => {
        const headsUp = (headsUpByGroup.get(main.id) || []).sort((a, b) => a.dueAt - b.dueAt);
        const future = [main, ...headsUp].map(x => x.dueAt).filter(t => t > now);
        return {
          main,
          headsUp,
          nextDue: future.length ? Math.min(...future) : main.dueAt,
          overdue: main.dueAt <= now
        };
      });
  }

  function listReminders() {
    const reminders = loadReminders().sort((a, b) => a.dueAt - b.dueAt);
    if (!reminders.length) return { text: 'Belum ada pengingat. Mau buat? Ketik "ingatkan aku meeting jam 3 sore".', state: 'think' };
    const now = Date.now();
    const lines = reminders.map((x, i) => {
      const overdue = x.dueAt <= now ? ' (lewat)' : '';
      const tag = x.advance ? `[H-${x.advance}] ` : '';
      const recur = x.repeat
        ? (x.repeat.total >= 1 ? `🔁 (sisa ${x.repeat.left ?? x.repeat.total}/${x.repeat.total}) ` : '🔁 ')
        : '';
      return `${i + 1}. ${tag}${recur}${x.text} — ${formatDue(new Date(x.dueAt))}${overdue}`;
    }).join('\n');
    return { text: `Pengingatmu:\n${lines}`, state: 'think' };
  }

  function deleteReminder(query) {
    const reminders = loadReminders();
    const qlower = query.toLowerCase();
    const next = reminders.filter(x => !(x.text.toLowerCase() === qlower || x.text.toLowerCase().includes(qlower)));
    if (next.length === reminders.length) return false;
    saveReminders(next);
    return true;
  }

  function checkDueReminders() {
    const reminders = loadReminders();
    const now = Date.now();
    const due = reminders.filter(x => {
      if (x.dueAt > now) return false;
      if (!x.notified) return true;
      return x.notifiedAt && now - x.notifiedAt > 30 * 60 * 1000;
    });
    if (due.length) {
      reminders.forEach(x => {
        if (due.some(d => d.id === x.id)) {
          x.notified = true;
          x.notifiedAt = now;
        }
      });
      saveReminders(reminders);
    }
    return due.map(x => ({ id: x.id, text: x.text, dueAt: x.dueAt, advance: x.advance || 0 }));
  }

  function summarize() {
    const todos = loadTodos();
    const reminders = loadReminders().sort((a, b) => a.dueAt - b.dueAt);
    const parts = [];
    if (todos.length) {
      const pending = todos.filter(x => !x.done).length;
      parts.push(`Tugas: ${pending}/${todos.length} belum selesai.`);
    }
    if (reminders.length) {
      const now = Date.now();
      const upcoming = reminders.filter(x => x.dueAt > now).length;
      const overdue = reminders.length - upcoming;
      parts.push(`Pengingat: ${upcoming} mendatang${overdue ? `, ${overdue} lewat` : ''}.`);
    }
    if (!parts.length) return { text: 'Belum ada tugas atau pengingat. Mau aku bantu buat?', state: 'think' };
    return { text: parts.join('\n'), state: 'think' };
  }

  function clearAll() {
    try {
      localStorage.removeItem(TODOS_KEY);
      localStorage.removeItem(REMINDERS_KEY);
    } catch {}
  }

  function headsUpNote(r) {
    return r.headsUp?.length
      ? ` Peringatan awal: ${r.headsUp.map((d) => 'H-' + d).join(', ')}.`
      : '';
  }

  function handleCommand(text) {
    const t = text.toLowerCase().trim();
    if (!t) return null;

    if (/^(?:daftar\s+)?(?:todo|tugas|to do)(?:ku| saya| aku)?$|^apa saja (?:todo|tugas)ku$|^tampilkan (?:todo|tugas)$|^lihat (?:todo|tugas)$/.test(t)) {
      return listTodos();
    }
    if (/^(?:daftar\s+)?(?:reminder|pengingat|ingat)(?:an)?(?:ku| saya| aku)?$|^apa saja (?:reminder|pengingat)ku$|^tampilkan (?:reminder|pengingat)$|^lihat (?:reminder|pengingat)$/.test(t)) {
      return listReminders();
    }
    if (/^(?:daftar\s+)?semua (?:tugas|todo|reminder|pengingat)$|^apa yang harus kulakukan$|^ringkas(?:an)?$/.test(t)) {
      return summarize();
    }

    if (/^bersihkan tugas selesai$|^hapus (?:todo|tugas) selesai$|^clear done$/.test(t)) {
      return clearDone();
    }
    if (/^hapus semua (?:todo|tugas|reminder|pengingat)$|^reset (?:todo|tugas|reminder|pengingat)$/.test(t)) {
      clearAll();
      return { text: 'Semua tugas dan pengingat sudah dihapus.', state: 'think' };
    }

    const delMatch = t.match(/^(?:hapus|delete|batal|batalkan)\s+(?:(todo|tugas|reminder|pengingat)\s+)?(.{2,120})/);
    if (delMatch) {
      const explicit = !!delMatch[1];
      const query = delMatch[2].trim().replace(/[.!?]+$/, '');
      const removed = deleteTodo(query) || deleteReminder(query);
      if (removed) return { text: `Oke, "${query}" sudah dihapus.`, state: 'think' };
      return explicit
        ? { text: `Aku nggak nemu "${query}" di daftar tugas/pengingat.`, state: 'confuse' }
        : null;
    }

    let doneQuery = null, doneExplicit = false;
    let m;
    if ((m = t.match(/^(?:selesai|sudah|done|finish|centang)(?:\s+(todo|tugas))?\s+(.{2,120})/))) {
      doneQuery = m[2];
      doneExplicit = !!m[1];
    } else if ((m = t.match(/^(.{2,120})\s+(?:selesai|sudah|done|finish|centang)$/))) {
      doneQuery = m[1];
    }
    if (doneQuery) {
      const query = doneQuery.trim().replace(/[.!?]+$/, '');
      const res = toggleTodo(query, true);
      if (res.found) return { text: res.text, state: 'happy' };
      const qlower = query.toLowerCase();
      const doneRem = loadReminders().find(x => !x.advance && (x.text.toLowerCase() === qlower || x.text.toLowerCase().includes(qlower)));
      if (doneRem) {
        const doneRes = completeReminder(doneRem.id);
        if (doneRes.finished) {
          return { text: `Cicilan terakhir "${doneRem.text}" lunas — selesai semua! 🎉`, state: 'happy' };
        }
        if (doneRes.recurring) {
          return doneRes.left !== undefined
            ? { text: `"${doneRem.text}" lunas! Sisa ${doneRes.left}x — diulang tiap tanggal ${doneRem.repeat.day} bulan depan 🔁`, state: 'happy' }
            : { text: `"${doneRem.text}" lunas! Diulang tiap tanggal ${doneRem.repeat.day} bulan depan 🔁`, state: 'happy' };
        }
        return { text: `Pengingat "${query}" ditandai selesai.`, state: 'happy' };
      }
      return doneExplicit
        ? { text: `Aku nggak nemu tugas "${query}". Mau aku tambahin?`, state: 'think' }
        : null;
    }

    const mk = t.match(/^(?:buat|bikin|tambah)(?:kan|in)?\s+(.{2,120})/);
    if (mk) {
      const kw = mk[1].match(/^(to\s*do(?:\s*list)?|todo(?:\s*list)?|daftar\s+(?:tugas|todo)|tugas|reminder|pengingat)\b[\s:,-]*(.*)$/);
      if (kw) {
        const isRem = /reminder|pengingat/.test(kw[1]);
        const q = (kw[2] || '').trim().replace(/[.!?]+$/, '');
        if (!q) {
          return isRem
            ? { text: 'Mau diingatkan apa & kapan? Contoh: "ingatkan aku meeting jam 3 sore".', state: 'think' }
            : { text: listTodos().text + '\n\nTambah item: ketik "todo <isi>".', state: 'think' };
        }
        const monthly = MONTHLY_RE.test(q);
        const cm = monthly && q.match(COUNT_RE);
        const count = cm ? parseInt(cm[1]) : 0;
        const parsed = parseTime(monthly ? stripCountPhrase(stripMonthlyPhrase(q)) : q);
        const task = cleanTask(parsed.task) || 'pengingat';
        if (parsed.due) {
          const r = addReminder(task, parsed.due, monthly ? { repeat: count >= 1 ? { count } : true } : {});
          const when = r.repeat ? formatRepeat(r.repeat) : formatDue(new Date(r.dueAt));
          return { text: `Oke, aku ingatkan "${r.text}" ${when}.${headsUpNote(r)}`, state: 'happy' };
        }
        const todo = addTodo(task);
        return isRem
          ? { text: `Oke, aku catat "${todo.text}" sebagai tugas. Mau ditambah waktunya? (contoh: jam 5 sore)`, state: 'happy' }
          : { text: `Tugas ditambah: "${todo.text}". Semangat!`, state: 'happy' };
      }
    }

    const todoIntent = /^(?:todo|tugas|to do|kerjakan|daftarkan|catat)\b/.test(t);
    const reminderIntent = /^(?:ingatkan|reminder|buat pengingat|set reminder|jadwalkan|schedule)\b/.test(t);
    // Intent pengingat di tengah kalimat: "besok jam 5 pagi ingatkan aku olahraga",
    // "jangan lupa beli susu" — frasa alami begitu gagal terdeteksi kalau hanya
    // dicek di awal kalimat.
    const midReminder = !todoIntent && !reminderIntent &&
      /(?:^|\s)(?:ingatkan(?:\s+aku)?|jangan\s+lupa|reminder(?:\s+buat)?|pengingat(?:\s+buat)?)\s+\S/.test(t);

    if (todoIntent || reminderIntent || midReminder) {
      const monthly = MONTHLY_RE.test(t);
      const cm = monthly && t.match(COUNT_RE);
      const count = cm ? parseInt(cm[1]) : 0;
      const parsed = parseTime(monthly ? stripCountPhrase(stripMonthlyPhrase(t)) : t);
      const task = cleanTask(parsed.task) || 'pengingat';
      if (parsed.due) {
        const r = addReminder(task, parsed.due, monthly ? { repeat: count >= 1 ? { count } : true } : {});
        const when = r.repeat ? formatRepeat(r.repeat) : formatDue(new Date(r.dueAt));
        return { text: `Oke, aku ingatkan "${r.text}" ${when}.${headsUpNote(r)}`, state: 'happy' };
      }
      if (todoIntent || midReminder) {
        const todo = addTodo(task);
        return { text: `Tugas ditambah: "${todo.text}". Semangat!`, state: 'happy' };
      }
      if (reminderIntent) {
        const todo = addTodo(task);
        return { text: `Oke, aku catat "${todo.text}" sebagai tugas. Mau ditambahin waktunya? (contoh: jam 5 sore)`, state: 'happy' };
      }
    }

    return null;
  }

  function getTodos() { return loadTodos(); }
  function getReminders() { return loadReminders(); }

  function toggleTodoById(id) {
    const todos = loadTodos();
    const x = todos.find(t => t.id === id);
    if (!x) return;
    x.done = !x.done;
    saveTodos(todos);
  }

  function deleteTodoById(id) {
    saveTodos(loadTodos().filter(t => t.id !== id));
  }

  function deleteReminderById(id) {
    // Menghapus pengingat utama juga menghapus heads-up (H-n) miliknya
    saveReminders(loadReminders().filter(r => r.id !== id && r.groupId !== id));
  }

  function completeReminder(id) {
    const reminders = loadReminders();
    const main = reminders.find(x => x.id === id && !x.advance);
    if (!main || !main.repeat) {
      deleteReminderById(id);
      return { recurring: false };
    }
    // Cicilan terbatas (repeat.left angka): cicilan terakhir menghapus
    // pengingat total; sisanya dikurangi lalu dijadwalkan ulang seperti biasa.
    if (typeof main.repeat.left === 'number') {
      if (main.repeat.left <= 1) {
        const total = main.repeat.total;
        deleteReminderById(id);
        return { recurring: true, finished: true, total };
      }
      main.repeat.left -= 1;
      const keepL = reminders.filter(x => x.groupId !== id);
      main.dueAt = nextMonthly(main.repeat, new Date()).getTime();
      main.notified = false;
      main.notifiedAt = 0;
      keepL.push(...(main.noHeadsUp ? [] : makeHeadsUp(main)));
      saveReminders(keepL);
      return { recurring: true, next: new Date(main.dueAt), left: main.repeat.left, total: main.repeat.total };
    }
    // Pengingat berulang: jadwalkan ulang ke tanggal patokan bulan depan alih-alih
    // dihapus — siklus tidak bergeser walau diselesaikan telat/setelah snooze.
    const keep = reminders.filter(x => x.groupId !== id);
    main.dueAt = nextMonthly(main.repeat, new Date()).getTime();
    main.notified = false;
    main.notifiedAt = 0;
    keep.push(...(main.noHeadsUp ? [] : makeHeadsUp(main)));
    saveReminders(keep);
    return { recurring: true, next: new Date(main.dueAt) };
  }

  function updateTodo(id, text) {
    const todos = loadTodos();
    const x = todos.find(t => t.id === id);
    if (!x) return;
    x.text = text;
    saveTodos(todos);
  }

  function getCounts() {
    const todos = loadTodos();
    const reminders = loadReminders();
    const now = Date.now();
    return {
      pendingTodos: todos.filter(x => !x.done).length,
      totalTodos: todos.length,
      upcomingReminders: reminders.filter(x => x.dueAt > now).length,
      overdueReminders: reminders.filter(x => x.dueAt <= now).length
    };
  }

  return {
    handleCommand,
    addTodo,
    listTodos,
    toggleTodo,
    deleteTodo,
    clearDone,
    addReminder,
    listReminders,
    deleteReminder,
    checkDueReminders,
    summarize,
    getCounts,
    getTodos,
    getReminders,
    getReminderGroups,
    parsePreview,
    updateReminder,
    snoozeReminder,
    completeReminder,
    updateTodo,
    toggleTodoById,
    deleteTodoById,
    deleteReminderById,
    clearAll
  };
}

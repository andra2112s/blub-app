const TODOS_KEY = 'Mochi.todos';
const REMINDERS_KEY = 'Mochi.reminders';

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

function cleanTask(raw) {
  return raw
    .replace(/^ingatkan(?: aku)?\b/, '')
    .replace(/^reminder\b/, '')
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

  function addReminder(text, dueAt) {
    const reminders = loadReminders();
    const r = { id: uid(), text, dueAt: dueAt.getTime(), notified: false, notifiedAt: 0, createdAt: Date.now() };
    reminders.push(r);
    saveReminders(reminders);
    return r;
  }

  function listReminders() {
    const reminders = loadReminders().sort((a, b) => a.dueAt - b.dueAt);
    if (!reminders.length) return { text: 'Belum ada pengingat. Mau buat? Ketik "ingatkan aku meeting jam 3 sore".', state: 'think' };
    const now = Date.now();
    const lines = reminders.map((x, i) => {
      const overdue = x.dueAt <= now ? ' (lewat)' : '';
      return `${i + 1}. ${x.text} — ${formatDue(new Date(x.dueAt))}${overdue}`;
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
    return due.map(x => ({ id: x.id, text: x.text, dueAt: x.dueAt }));
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
      if (deleteReminder(query)) {
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
        const parsed = parseTime(q);
        const task = cleanTask(parsed.task) || 'pengingat';
        if (parsed.due) {
          const r = addReminder(task, parsed.due);
          return { text: `Oke, aku ingatkan "${r.text}" ${formatDue(new Date(r.dueAt))}.`, state: 'happy' };
        }
        const todo = addTodo(task);
        return isRem
          ? { text: `Oke, aku catat "${todo.text}" sebagai tugas. Mau ditambah waktunya? (contoh: jam 5 sore)`, state: 'happy' }
          : { text: `Tugas ditambah: "${todo.text}". Semangat!`, state: 'happy' };
      }
    }

    const todoIntent = /^(?:todo|tugas|to do|kerjakan|daftarkan|catat)\b/.test(t);
    const reminderIntent = /^(?:ingatkan|reminder|buat pengingat|set reminder|jadwalkan|schedule)\b/.test(t);

    if (todoIntent || reminderIntent) {
      const parsed = parseTime(t);
      const task = cleanTask(parsed.task) || 'pengingat';
      if (parsed.due) {
        const r = addReminder(task, parsed.due);
        return { text: `Oke, aku ingatkan "${r.text}" ${formatDue(new Date(r.dueAt))}.`, state: 'happy' };
      }
      if (todoIntent) {
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
    saveReminders(loadReminders().filter(r => r.id !== id));
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
    toggleTodoById,
    deleteTodoById,
    deleteReminderById,
    clearAll
  };
}

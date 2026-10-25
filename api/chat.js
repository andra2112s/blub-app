/* ── Muat .env dari folder project (lokal dev) ──
   Key cukup ditaruh di file .env di folder app — tidak perlu diisi di frontend.
   Di Vercel: key diisi lewat dashboard (Settings → Environment Variables);
   file .env tidak ikut ter-deploy karena gitignored. */
try {
  const { readFileSync } = await import('node:fs');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    if (val && !(m[1] in process.env)) process.env[m[1]] = val;
  }
} catch {}

const SUMOPOD_URL = 'https://ai.sumopod.com/v1';
const SUMOPOD_KEY = process.env.SUMOPOD_API_KEY || '';
const SUMOPOD_MODEL = 'gpt-5-nano';

const DEEPSEEK_URL = 'https://api.deepseek.com/v1';
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = 'deepseek-chat';

const GROQ_URL = 'https://api.groq.com/openai/v1';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = 'openai/gpt-oss-120b';

// Lapisan terakhir: LLM gratis TANPA API key (best-effort, batas ~1 req/30 dtk/IP).
// Bikin Mochi hybrid langsung hidup tanpa setup; kalau kena limit (402) klien
// jatuh ke otak lokal seperti biasa.
const POLLINATIONS_MODEL = 'openai';

const FREE_LIMIT = parseInt(process.env.FREE_LIMIT || '30', 10);

const usageMap = new Map();

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getUsage(ip) {
  const today = getTodayKey();
  const data = usageMap.get(ip);
  if (!data || data.date !== today) return { count: 0, date: today };
  return data;
}

function bumpUsage(ip) {
  const u = getUsage(ip);
  u.count++;
  u.date = getTodayKey();
  usageMap.set(ip, u);
}

/* Rantai provider: dicoba berurutan, yang pertama sukses menang.
   Urutan: sumopod (pool gratis deployer) → groq (gratis & tercepat) →
   deepseek (berbayar, cadangan pintar) → pollinations (keyless terakhir).
   Key salah / provider error → lanjut ke berikutnya; 402 (slot gratis habis)
   → berhenti dan teruskan Retry-After ke klien. */
function providerChain(ip) {
  const chain = [];
  if (SUMOPOD_KEY) {
    const usage = getUsage(ip);
    if (usage.count < FREE_LIMIT) {
      chain.push({ url: SUMOPOD_URL, key: SUMOPOD_KEY, model: SUMOPOD_MODEL, provider: 'sumopod', owned: false, tools: true });
    }
  }
  if (GROQ_KEY) chain.push({ url: GROQ_URL, key: GROQ_KEY, model: GROQ_MODEL, provider: 'groq', owned: true, tools: true });
  if (DEEPSEEK_KEY) chain.push({ url: DEEPSEEK_URL, key: DEEPSEEK_KEY, model: DEEPSEEK_MODEL, provider: 'deepseek', owned: true, tools: true });
  chain.push({ url: 'https://text.pollinations.ai', path: '/openai', key: '', model: POLLINATIONS_MODEL, provider: 'pollinations', owned: false, keyless: true, tools: false });
  return chain;
}

// Iterasi baris "data: ..." dari SSE upstream
async function* sseData(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, model: customModel, tools, stream } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';

  const chain = providerChain(ip);
  if (!chain.length) {
    return res.status(503).json({ error: 'No AI provider configured', fallback: true });
  }

  // ── Mode streaming (SSE): delta token diteruskan ke klien seketika ──
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    let lastErr = null;
    for (const provider of chain) {
      if (!provider.owned && !provider.keyless) bumpUsage(ip);
      // Keyless tidak mendukung function calling — beri tahu model supaya jujur
      let msgs = messages;
      if (provider.keyless) {
        const note = '\n\nNOTE: No function tools are available in this session. Never claim to have set a timer, reminder, or todo. If the user asks for one, tell them to type it as a chat command instead (e.g. "ingatkan aku … jam …" or "remind me to …").';
        const sys = msgs.find((m) => m.role === 'system');
        if (sys) sys.content = (sys.content || '') + note;
        else msgs = [{ role: 'system', content: note.trim() }, ...msgs];
      }
      const usage = getUsage(ip);
      const remaining = provider.keyless || provider.owned ? null : Math.max(0, FREE_LIMIT - usage.count);
      try {
        const apiRes = await fetch(provider.url + (provider.path || '/chat/completions'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(provider.key ? { 'Authorization': 'Bearer ' + provider.key } : {})
          },
          body: JSON.stringify({
            model: customModel || provider.model,
            messages: msgs,
            ...(Array.isArray(tools) && tools.length && provider.tools ? { tools } : {}),
            temperature: 0.85,
            max_tokens: 500,
            stream: true
          }),
          // Streaming boleh lama (teks panjang), tapi tetap ada batas
          signal: AbortSignal.timeout(45000)
        });
        if (!apiRes.ok || !apiRes.body) {
          const errText = await apiRes.text().catch(() => '');
          console.error(`[api] ${provider.provider} stream error ${apiRes.status}:`, errText);
          lastErr = { status: apiRes.status, retryAfter: parseInt(apiRes.headers.get('retry-after') || '0', 10) || 0 };
          // 402 = slot gratis habis → tidak ada gunanya lanjut ke provider berikutnya
          if (apiRes.status === 402) break;
          continue;
        }
        let full = '';
        const toolAcc = new Map();
        for await (const data of sseData(apiRes.body)) {
          if (data === '[DONE]') break;
          let j; try { j = JSON.parse(data); } catch { continue; }
          const d = j.choices?.[0]?.delta || {};
          if (d.content) {
            full += d.content;
            res.write(`data: ${JSON.stringify({ delta: d.content })}\n\n`);
          }
          if (Array.isArray(d.tool_calls)) {
            for (const tc of d.tool_calls) {
              const idx = tc.index ?? 0;
              const acc = toolAcc.get(idx) || { id: '', name: '', arguments: '' };
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.arguments += tc.function.arguments;
              toolAcc.set(idx, acc);
            }
          }
        }
        const calls = [...toolAcc.values()].filter((c) => c.name).map((c) => ({
          id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' }
        }));
        res.write(`data: ${JSON.stringify({ done: true, content: full, toolCalls: calls, provider: provider.provider, remaining, owned: provider.owned })}\n\n`);
        return res.end();
      } catch (err) {
        console.error(`[api] ${provider.provider} stream fetch error:`, err.message);
        lastErr = { status: 502, retryAfter: 0 };
        continue;
      }
    }
    res.write(`data: ${JSON.stringify({ error: `AI error: ${lastErr?.status || 502}`, retryAfter: lastErr?.retryAfter || 0 })}\n\n`);
    return res.end();
  }

  // ── Mode biasa (non-stream) ──
  let lastErr = null;
  for (const provider of chain) {
    if (!provider.owned && !provider.keyless) bumpUsage(ip);
    let msgs = messages;
    if (provider.keyless) {
      const note = '\n\nNOTE: No function tools are available in this session. Never claim to have set a timer, reminder, or todo. If the user asks for one, tell them to type it as a chat command instead (e.g. "ingatkan aku … jam …" or "remind me to …").';
      const sys = msgs.find((m) => m.role === 'system');
      if (sys) sys.content = (sys.content || '') + note;
      else msgs = [{ role: 'system', content: note.trim() }, ...msgs];
    }
    const usage = getUsage(ip);
    const remaining = provider.keyless || provider.owned ? null : Math.max(0, FREE_LIMIT - usage.count);
    try {
      const apiRes = await fetch(provider.url + (provider.path || '/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(provider.key ? { 'Authorization': 'Bearer ' + provider.key } : {})
        },
        body: JSON.stringify({
          model: customModel || provider.model,
          messages: msgs,
          ...(Array.isArray(tools) && tools.length && provider.tools ? { tools } : {}),
          temperature: 0.85,
          max_tokens: 500
        }),
        signal: AbortSignal.timeout(25000)
      });

      if (!apiRes.ok) {
        const errText = await apiRes.text().catch(() => '');
        console.error(`[api] ${provider.provider} error ${apiRes.status}:`, errText);
        lastErr = { status: apiRes.status, retryAfter: parseInt(apiRes.headers.get('retry-after') || '0', 10) || 0 };
        if (apiRes.status === 402) break;
        continue;
      }

      const data = await apiRes.json();
      const msg = data.choices?.[0]?.message || {};
      const content = (msg.content || '').trim();

      return res.status(200).json({
        content,
        toolCalls: msg.tool_calls || [],
        provider: provider.provider,
        remaining,
        owned: provider.owned
      });
    } catch (err) {
      console.error(`[api] ${provider.provider} fetch error:`, err.message);
      lastErr = { status: 502, retryAfter: 0 };
      continue;
    }
  }

  return res.status(lastErr?.status || 502).json({
    error: `AI error: ${lastErr?.status || 502}`,
    retryAfter: lastErr?.retryAfter || 0,
    fallback: true
  });
}

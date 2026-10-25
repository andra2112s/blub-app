/* ── Logic inti /api/chat — portable lintas platform ──
   Dipakai oleh:
   - api/chat.js            → Vercel serverless + dev-server.mjs (lokal)
   - netlify/functions/chat.mjs → Netlify Functions
   Kontrak: handleChat({ method, body, ip }) →
     { status, headers, json }        → respons biasa
     { status, headers, stream }      → ReadableStream SSE (chunk "data: ...") */

/* ── Muat .env dari folder project (lokal dev) ──
   Key cukup ditaruh di file .env di folder app — tidak perlu diisi di frontend.
   Di Vercel/Netlify: key diisi lewat dashboard (Environment Variables);
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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// Keyless tidak mendukung function calling — beri tahu model supaya jujur
function prepMsgs(messages, provider) {
  if (!provider.keyless) return messages;
  const note = '\n\nNOTE: No function tools are available in this session. Never claim to have set a timer, reminder, or todo. If the user asks for one, tell them to type it as a chat command instead (e.g. "ingatkan aku … jam …" or "remind me to …").';
  const sys = messages.find((m) => m.role === 'system');
  if (sys) sys.content = (sys.content || '') + note;
  else return [{ role: 'system', content: note.trim() }, ...messages];
  return messages;
}

function callProvider(provider, msgs, tools, customModel, streaming) {
  return fetch(provider.url + (provider.path || '/chat/completions'), {
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
      ...(streaming ? { stream: true } : {})
    }),
    signal: AbortSignal.timeout(streaming ? 45000 : 25000)
  });
}

export async function handleChat({ method, body, ip = 'unknown' }) {
  if (method === 'OPTIONS') {
    return { status: 200, headers: { ...CORS }, json: null };
  }
  if (method !== 'POST') {
    return { status: 405, headers: { ...CORS }, json: { error: 'Method not allowed' } };
  }

  const { messages, model: customModel, tools, stream } = body || {};
  if (!messages || !Array.isArray(messages)) {
    return { status: 400, headers: { ...CORS }, json: { error: 'messages array required' } };
  }

  const chain = providerChain(ip);
  if (!chain.length) {
    return { status: 503, headers: { ...CORS }, json: { error: 'No AI provider configured', fallback: true } };
  }

  // ── Mode streaming (SSE): delta token diteruskan ke klien seketika ──
  if (stream) {
    const sse = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (obj) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        let lastErr = null;
        for (const provider of chain) {
          if (!provider.owned && !provider.keyless) bumpUsage(ip);
          const msgs = prepMsgs(messages, provider);
          const usage = getUsage(ip);
          const remaining = provider.keyless || provider.owned ? null : Math.max(0, FREE_LIMIT - usage.count);
          try {
            const apiRes = await callProvider(provider, msgs, tools, customModel, true);
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
                send({ delta: d.content });
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
            send({ done: true, content: full, toolCalls: calls, provider: provider.provider, remaining, owned: provider.owned });
            controller.close();
            return;
          } catch (err) {
            console.error(`[api] ${provider.provider} stream fetch error:`, err.message);
            lastErr = { status: 502, retryAfter: 0 };
            continue;
          }
        }
        send({ error: `AI error: ${lastErr?.status || 502}`, retryAfter: lastErr?.retryAfter || 0 });
        controller.close();
      }
    });
    return {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      },
      stream: sse
    };
  }

  // ── Mode biasa (non-stream) ──
  let lastErr = null;
  for (const provider of chain) {
    if (!provider.owned && !provider.keyless) bumpUsage(ip);
    const msgs = prepMsgs(messages, provider);
    const usage = getUsage(ip);
    const remaining = provider.keyless || provider.owned ? null : Math.max(0, FREE_LIMIT - usage.count);
    try {
      const apiRes = await callProvider(provider, msgs, tools, customModel, false);
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

      return {
        status: 200,
        headers: { ...CORS },
        json: { content, toolCalls: msg.tool_calls || [], provider: provider.provider, remaining, owned: provider.owned }
      };
    } catch (err) {
      console.error(`[api] ${provider.provider} fetch error:`, err.message);
      lastErr = { status: 502, retryAfter: 0 };
      continue;
    }
  }

  return {
    status: lastErr?.status || 502,
    headers: { ...CORS },
    json: { error: `AI error: ${lastErr?.status || 502}`, retryAfter: lastErr?.retryAfter || 0, fallback: true }
  };
}

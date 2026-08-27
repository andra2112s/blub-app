const SUMOPOD_URL = 'https://ai.sumopod.com/v1';
const SUMOPOD_KEY = process.env.SUMOPOD_API_KEY || '';
const SUMOPOD_MODEL = 'gpt-5-nano';

const DEEPSEEK_URL = 'https://api.deepseek.com/v1';
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = 'deepseek-chat';

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

function resolveProvider(ip) {
  if (SUMOPOD_KEY) {
    const usage = getUsage(ip);
    if (usage.count < FREE_LIMIT) {
      return { url: SUMOPOD_URL, key: SUMOPOD_KEY, model: SUMOPOD_MODEL, provider: 'sumopod', owned: false };
    }
  }
  if (DEEPSEEK_KEY) {
    return { url: DEEPSEEK_URL, key: DEEPSEEK_KEY, model: DEEPSEEK_MODEL, provider: 'deepseek', owned: true };
  }
  return null;
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

  const { messages, model: customModel } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';

  const provider = resolveProvider(ip);
  if (!provider) {
    return res.status(503).json({ error: 'No AI provider configured', fallback: true });
  }

  if (!provider.owned) bumpUsage(ip);

  const usage = getUsage(ip);
  const remaining = provider.owned ? Infinity : Math.max(0, FREE_LIMIT - usage.count);

  try {
    const apiRes = await fetch(provider.url + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + provider.key
      },
      body: JSON.stringify({
        model: customModel || provider.model,
        messages,
        temperature: 0.85,
        max_tokens: 300
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => '');
      console.error(`[api] ${provider.provider} error ${apiRes.status}:`, errText);
      return res.status(apiRes.status).json({ error: `AI error: ${apiRes.status}` });
    }

    const data = await apiRes.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';

    return res.status(200).json({
      content,
      provider: provider.provider,
      remaining: provider.owned ? null : remaining,
      owned: provider.owned
    });
  } catch (err) {
    console.error(`[api] fetch error:`, err.message);
    return res.status(500).json({ error: 'AI request failed' });
  }
}

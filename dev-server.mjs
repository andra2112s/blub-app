import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const PREFERRED_PORTS = [4000, 5252, 5337, 5678, 8765, 9876, 3005, 8081];
const ROOT = resolve('.');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm'
};

function isPortFree(port) {
  return new Promise((resolve) => {
    const s = createNetServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => {
      s.close();
      resolve(true);
    });
    s.listen(port);
  });
}

async function findPort() {
  for (const p of PREFERRED_PORTS) {
    if (await isPortFree(p)) return p;
  }
  throw new Error('Semua port cadangan sedang dipakai');
}

// Load the serverless API handler so /api/chat works in local dev too
// (needs SUMOPOD_API_KEY / DEEPSEEK_API_KEY in env; otherwise it 503s and the
// client falls back to the local brain, same as production).
let chatHandler = null;
try {
  chatHandler = (await import('./api/chat.js')).default;
} catch {}
let manifestHandler = null;
try {
  manifestHandler = (await import('./api/manifest.js')).default;
} catch {}

function shimRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { return {}; }
}

const port = await findPort();

const server = createHttpServer(async (req, res) => {
  try {
    let urlPath = new URL(req.url, `http://localhost:${port}`).pathname;
    urlPath = decodeURIComponent(urlPath);

    if (urlPath === '/api/chat' && chatHandler) {
      req.body = await readBody(req);
      return await chatHandler(req, shimRes(res));
    }

    if (urlPath === '/manifest.json' && manifestHandler) {
      return manifestHandler(req, shimRes(res));
    }

    if (urlPath === '/' || urlPath.endsWith('/')) {
      urlPath += 'index.html';
    }
    const filePath = resolve(join('.', urlPath));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      return res.writeHead(404).end('Not found');
    }
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') {
      res.writeHead(404).end('Not found');
    } else {
      res.writeHead(500).end('Server error');
    }
  }
});

server.listen(port, () => {
  const provs = [];
  if (process.env.SUMOPOD_API_KEY) provs.push('sumopod');
  if (process.env.GROQ_API_KEY) provs.push('groq');
  if (process.env.DEEPSEEK_API_KEY) provs.push('deepseek');
  provs.push('pollinations (keyless)');
  console.log(`Dev server berjalan di http://localhost:${port}`);
  console.log(`Rantai AI: ${provs.join(' → ')}`);
});

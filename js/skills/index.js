import { toonflow } from './toonflow.js';
import { studio } from './studio.js';

/* ── Registry POWER (skill) ──
   Tiap POWER: { id, emoji, name, hint, trigger, local(t, active), fallback(), prompt() }.
   POWER yang dipanggil tetap aktif selama ACTIVE_MS supaya pertanyaan lanjutan
   (mis. menempel log error) tetap dijawab dengan pengetahuan POWER tersebut. */
export const POWERS = [studio, toonflow];

const ACTIVE_MS = 30 * 60 * 1000;
let active = null;
let activeAt = 0;

export function activePower() {
  if (active && Date.now() - activeAt > ACTIVE_MS) active = null;
  return active;
}

export function matchPower(t) {
  const hit = POWERS.find((p) => p.trigger.test(t));
  if (hit) { active = hit; activeAt = Date.now(); return hit; }
  const cur = activePower();
  if (cur) activeAt = Date.now();
  return cur;
}

/* Jawaban lokal POWER: objek balasan (yakin), { vague, text } (serahkan ke LLM), atau null */
export function powerReply(t) {
  const explicit = POWERS.find((p) => p.trigger.test(t));
  const p = matchPower(t);
  if (!p) return null;
  const res = p.local(t, !explicit);
  if (res) {
    if (res.deactivate) active = null;
    return res;
  }
  // Pertanyaan bebas soal POWER, atau tempelan log/error saat POWER aktif → LLM
  const looksLikeOutput = /\n|error|failed|docker|compose|denied|not found|port/i.test(t) || t.length > 80;
  return explicit || looksLikeOutput ? { text: p.fallback(), state: 'think', vague: true } : null;
}

export function powerPrompt(q) {
  const p = POWERS.find((x) => x.trigger.test(q)) || activePower();
  return p ? p.prompt() : '';
}

export const powerHelpLines = () => POWERS.map((p) => `• ${p.hint} ${p.emoji}`).join('\n');

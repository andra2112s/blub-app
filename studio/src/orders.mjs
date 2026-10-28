/* ── Top-up kredit via QRIS mandiri ──
   QRIS statis tidak punya webhook, jadi tiap order diberi nominal unik (harga + kode 1–999).
   Pengguna bayar → tap "Saya sudah bayar" → admin cocokkan mutasi rekening → setujui → kredit masuk. */
import { randomUUID, randomInt } from 'node:crypto';
import QRCode from 'qrcode';
import { config } from './config.mjs';
import { db, tx, applyCredits, getSettings } from './db.mjs';
import { dynamicQris, merchantName } from './qris.mjs';

const httpError = (status, message) => Object.assign(new Error(message), { status });
const OPEN = "('pending','claimed')";

export function expireOrders() {
  db.prepare("UPDATE orders SET status = 'expired' WHERE status = 'pending' AND expires < ?").run(Date.now());
}

function uniqueAmount(price) {
  for (let i = 0; i < 50; i++) {
    const amount = price + randomInt(1, 1000);
    if (!db.prepare(`SELECT 1 FROM orders WHERE amount = ? AND status IN ${OPEN}`).get(amount)) return amount;
  }
  throw httpError(503, 'Antrian pembayaran sedang penuh, coba beberapa menit lagi');
}

async function present(order) {
  return {
    id: order.id, credits: order.credits, price: order.price, amount: order.amount, status: order.status,
    created: order.created, expires: order.expires, merchant: merchantName(config.qrisStatic),
    qrSvg: order.status === 'pending' ? await QRCode.toString(order.qris, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : ''
  };
}

export async function createOrder(user, topupId) {
  if (!config.qrisStatic) throw httpError(503, 'Top-up belum tersedia');
  expireOrders();
  const topup = getSettings().topups.find((t) => t.id === topupId);
  if (!topup) throw httpError(400, 'Paket kredit tidak ditemukan');
  const existing = db.prepare("SELECT * FROM orders WHERE user_id = ? AND topup_id = ? AND status = 'pending'").get(user.id, topupId);
  if (existing) return present(existing);
  if (db.prepare(`SELECT COUNT(*) n FROM orders WHERE user_id = ? AND status IN ${OPEN}`).get(user.id).n >= 3) {
    throw httpError(429, 'Masih ada 3 pembayaran yang belum selesai. Selesaikan atau tunggu kedaluwarsa dulu.');
  }
  const order = tx(() => {
    const amount = uniqueAmount(Number(topup.price));
    let qris;
    try { qris = dynamicQris(config.qrisStatic, amount); }
    catch (e) { throw httpError(503, 'QRIS tidak valid — hubungi admin'); }
    const row = {
      id: randomUUID(), user_id: user.id, topup_id: topup.id, credits: Number(topup.credits), price: Number(topup.price), amount,
      status: 'pending', qris, created: Date.now(), expires: Date.now() + config.orderTtlMin * 60000
    };
    db.prepare('INSERT INTO orders (id, user_id, topup_id, credits, price, amount, status, qris, created, expires) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(row.id, row.user_id, row.topup_id, row.credits, row.price, row.amount, row.status, row.qris, row.created, row.expires);
    return row;
  });
  return present(order);
}

export async function listOrders(user) {
  expireOrders();
  const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created DESC LIMIT 20').all(user.id);
  return Promise.all(rows.map(present));
}

export async function claimOrder(user, id) {
  expireOrders();
  const res = db.prepare("UPDATE orders SET status = 'claimed', claimed_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'").run(Date.now(), id, user.id);
  if (!res.changes) throw httpError(409, 'Pembayaran ini sudah diproses atau kedaluwarsa');
  return present(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
}

export function adminOrders(status = 'claimed') {
  expireOrders();
  return db.prepare(`SELECT o.id, o.credits, o.price, o.amount, o.status, o.created, o.claimed_at, o.decided_at, o.decided_by, u.email, u.name
    FROM orders o JOIN users u ON u.id = o.user_id WHERE (? = 'all' OR o.status = ?) ORDER BY COALESCE(o.claimed_at, o.created) DESC LIMIT 200`).all(status, status);
}

/* Admin menyetujui/menolak. Order expired tetap bisa disetujui (pengguna bisa saja bayar mepet). */
export function decideOrder(admin, id, approve) {
  return tx(() => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ? AND status IN ('pending','claimed','expired')").get(id);
    if (!order) throw httpError(409, 'Order sudah diputuskan');
    db.prepare('UPDATE orders SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?').run(approve ? 'approved' : 'rejected', Date.now(), admin.email, id);
    if (approve) applyCredits(order.user_id, order.credits, 'top-up QRIS', order.id);
    return { id, status: approve ? 'approved' : 'rejected' };
  });
}

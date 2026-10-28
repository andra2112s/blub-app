/* ── QRIS mandiri: ubah QRIS statis merchant jadi QRIS dinamis bernominal ──
   Format EMVCo TLV: [id 2 digit][panjang 2 digit][nilai]. Tag 01 = 11 (statis) / 12 (dinamis),
   tag 54 = nominal, tag 63 = CRC16-CCITT (poly 0x1021, init 0xFFFF) dari seluruh string + "6304". */

export function crc16(str) {
  let crc = 0xffff;
  for (const byte of Buffer.from(str, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function parseTlv(payload) {
  const out = [];
  let i = 0;
  while (i < payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !Number.isInteger(len)) throw new Error('QRIS tidak valid');
    out.push({ id, value: payload.slice(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  return out;
}

const tlv = (id, value) => id + String(value.length).padStart(2, '0') + value;

export function validateStatic(payload) {
  const fields = parseTlv(payload);
  const crc = fields.find((f) => f.id === '63');
  if (!crc || crc16(payload.slice(0, -4)) !== crc.value.toUpperCase()) throw new Error('CRC QRIS statis tidak cocok — salin ulang isi QR');
  if (!fields.some((f) => f.id === '58' && f.value === 'ID')) throw new Error('Bukan QRIS Indonesia');
  return fields;
}

export function dynamicQris(staticPayload, amount) {
  if (!Number.isInteger(amount) || amount < 1 || amount > 99_999_999) throw new Error('Nominal tidak valid');
  const fields = validateStatic(staticPayload)
    .filter((f) => f.id !== '54' && f.id !== '63')
    .map((f) => (f.id === '01' ? { id: '01', value: '12' } : f));
  const at = fields.findIndex((f) => Number(f.id) > 54);
  fields.splice(at < 0 ? fields.length : at, 0, { id: '54', value: String(amount) });
  const body = fields.map((f) => tlv(f.id, f.value)).join('') + '6304';
  return body + crc16(body);
}

export function merchantName(staticPayload) {
  try { return parseTlv(staticPayload).find((f) => f.id === '59')?.value || ''; } catch { return ''; }
}

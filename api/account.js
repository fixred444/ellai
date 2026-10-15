// POST /api/account { action: 'order' | 'cancel_order' | 'ticket', ... }
const db = require('../lib/db');
const C = require('../lib/core');

module.exports = async function handler(req, res) {
  // GET /api/account?view=qris -> foto QRIS yang diatur admin (hanya untuk yang sudah login)
  if (req.method === 'GET') {
    try {
      const u = await C.authUser(req);
      if (!u) return C.send(res, 401, { error: 'Belum masuk.', code: 'auth' });
      if (req.query.view === 'qris') return C.send(res, 200, { image: (await db.get('qris')) || null });
      return C.send(res, 400, { error: 'Tampilan tidak dikenal.' });
    } catch (e) { console.error('account get error', e); return C.send(res, 500, { error: 'Terjadi kesalahan di server.' }); }
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return C.send(res, 405, { error: 'Metode tidak diizinkan.' }); }
  if (!C.sameOrigin(req)) return C.send(res, 403, { error: 'Permintaan ditolak.' });
  try {
    const u = await C.authUser(req);
    if (!u) return C.send(res, 401, { error: 'Belum masuk.', code: 'auth' });
    const b = C.body(req);

    // ---------- beli paket (menunggu konfirmasi admin) ----------
    if (b.action === 'order') {
      if (u.status !== 'active') return C.send(res, 403, { error: 'Akunmu sedang tidak aktif.' });
      const cfg = await C.getConfig();
      const plan = cfg.plans.find((p) => p.id === b.planId && p.active);
      if (!plan) return C.send(res, 400, { error: 'Paket tidak ditemukan.' });
      const ids = await db.smembers('uorders:' + u.id);
      const mine = (await db.mget(ids.map((i) => 'order:' + i))).filter(Boolean);
      if (mine.filter((o) => o.status === 'pending' || o.status === 'unpaid').length >= 3) return C.send(res, 429, { error: 'Kamu masih punya 3 pesanan yang belum selesai. Selesaikan atau batalkan dulu.' });
      const price = C.planPrice(plan);
      const o = { id: C.newId('o_'), userId: u.id, userEmail: u.email, userName: u.name, planId: plan.id, planName: plan.name, days: plan.days,
        dailyQuota: plan.dailyQuota, amount: price.final, basePrice: price.base, discountPct: price.pct, status: 'unpaid', hasProof: false, createdAt: Date.now() };
      await db.set('order:' + o.id, o);
      await db.sadd('orders', o.id);
      await db.sadd('uorders:' + u.id, o.id);
      return C.send(res, 200, { ok: true, order: o });
    }

    if (b.action === 'cancel_order') {
      const o = await db.get('order:' + b.id);
      if (!o || o.userId !== u.id || (o.status !== 'pending' && o.status !== 'unpaid')) return C.send(res, 404, { error: 'Pesanan tidak ditemukan.' });
      o.status = 'cancelled'; o.resolvedAt = Date.now();
      await db.set('order:' + o.id, o);
      return C.send(res, 200, { ok: true });
    }

    // ---------- unggah bukti transfer ----------
    if (b.action === 'proof') {
      const o = await db.get('order:' + b.id);
      if (!o || o.userId !== u.id || (o.status !== 'unpaid' && o.status !== 'pending')) return C.send(res, 404, { error: 'Pesanan tidak ditemukan.' });
      if (!C.validImage(b.image)) return C.send(res, 400, { error: 'Foto bukti tidak valid atau terlalu besar. Pakai foto JPG/PNG/WebP.' });
      await db.set('proof:' + o.id, b.image);
      o.hasProof = true; o.status = 'pending'; o.proofAt = Date.now();
      await db.set('order:' + o.id, o);
      return C.send(res, 200, { ok: true, order: o });
    }

    // ---------- banding / verifikasi ----------
    if (b.action === 'ticket') {
      const type = u.status === 'needs_verification' ? 'verification' : 'appeal';
      if (!['frozen', 'deactivated', 'needs_verification'].includes(u.status)) return C.send(res, 400, { error: 'Akunmu aktif, tidak perlu mengajukan banding.' });
      const message = String(b.message || '').trim();
      if (message.length < 10 || message.length > 1500) return C.send(res, 400, { error: 'Tulis penjelasan 10–1500 karakter.', field: 'message' });
      const ids = await db.smembers('utickets:' + u.id);
      const mine = (await db.mget(ids.map((i) => 'ticket:' + i))).filter(Boolean);
      if (mine.some((t) => t.status === 'open')) return C.send(res, 409, { error: 'Kamu sudah punya pengajuan yang sedang ditinjau.' });
      const last = mine.sort((a, c) => c.createdAt - a.createdAt)[0];
      if (last && last.status === 'rejected' && Date.now() - last.resolvedAt < 3600e3) return C.send(res, 429, { error: 'Pengajuan terakhir ditolak. Tunggu satu jam sebelum mengajukan lagi.' });
      const t = { id: C.newId('t_'), userId: u.id, userEmail: u.email, userName: u.name, type, reasonStatus: u.status,
        message, contact: String(b.contact || '').trim().slice(0, 120), status: 'open', createdAt: Date.now() };
      await db.set('ticket:' + t.id, t);
      await db.sadd('tickets', t.id);
      await db.sadd('utickets:' + u.id, t.id);
      return C.send(res, 200, { ok: true });
    }

    return C.send(res, 400, { error: 'Aksi tidak dikenal.' });
  } catch (e) {
    console.error('account error', e);
    return C.send(res, 500, { error: 'Terjadi kesalahan di server.' });
  }
};

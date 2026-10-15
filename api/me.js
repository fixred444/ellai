// GET /api/me -> data akun, kuota hari ini, paket, tiket, dan pesanan milik pengguna.
const db = require('../lib/db');
const C = require('../lib/core');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return C.send(res, 405, { error: 'Metode tidak diizinkan.' }); }
  try {
    const u = await C.authUser(req);
    if (!u) return C.send(res, 401, { error: 'Belum masuk.', code: 'auth' });
    const cfg = await C.getConfig();
    const [quota, tIds, oIds] = await Promise.all([
      C.quotaOf(u, cfg), db.smembers('utickets:' + u.id), db.smembers('uorders:' + u.id),
    ]);
    const [tickets, orders] = await Promise.all([db.mget(tIds.map((i) => 'ticket:' + i)), db.mget(oIds.map((i) => 'order:' + i))]);
    const strip = (t) => ({ id: t.id, type: t.type, status: t.status, message: t.message, adminNote: t.adminNote || '', createdAt: t.createdAt });
    return C.send(res, 200, {
      user: C.publicUser(u), quota, plans: C.publicPlans(cfg), payment: cfg.payment,
      tickets: tickets.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10).map(strip),
      orders: orders.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10),
    });
  } catch (e) {
    console.error('me error', e);
    return C.send(res, 500, { error: 'Terjadi kesalahan di server.' });
  }
};

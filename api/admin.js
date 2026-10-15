// Panel admin. GET /api/admin?view=overview|users|tickets|orders|config|log
//              POST /api/admin { action: ... }
const db = require('../lib/db');
const C = require('../lib/core');
const Mail = require('../lib/mail');

const STATUS = ['active', 'frozen', 'deactivated', 'needs_verification'];
const adminView = (u, usage) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, statusNote: u.statusNote || '', verified: !!u.verified,
  age: C.ageOf(u.birth), birth: u.birth, sub: C.activeSub(u) ? { planName: u.sub.planName, until: u.sub.until } : null,
  quotaOverride: Number.isInteger(u.quotaOverride) ? u.quotaOverride : null, usedToday: usage, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
});
const intIn = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };

async function listAll(setKey, prefix) {
  const ids = await db.smembers(setKey);
  return (await db.mget(ids.map((i) => prefix + i))).filter(Boolean);
}

module.exports = async function handler(req, res) {
  try {
    const admin = await C.authUser(req);
    if (!admin) return C.send(res, 401, { error: 'Belum masuk.', code: 'auth' });
    if (admin.role !== 'admin' || admin.status !== 'active') return C.send(res, 403, { error: 'Khusus admin.' });

    // ================= GET =================
    if (req.method === 'GET') {
      const view = String(req.query.view || 'overview');
      const cfg = await C.getConfig();
      if (view === 'config') return C.send(res, 200, { config: cfg });
      if (view === 'email') return C.send(res, 200, { mail: await Mail.getMailConfig() });
      if (view === 'qris') return C.send(res, 200, { image: (await db.get('qris')) || null });
      if (view === 'proof') {
        const o = await db.get('order:' + String(req.query.id || ''));
        if (!o) return C.send(res, 404, { error: 'Pesanan tidak ditemukan.' });
        return C.send(res, 200, { image: (await db.get('proof:' + o.id)) || null, order: o });
      }
      if (view === 'log') return C.send(res, 200, { log: await db.lrange('audit', 0, 99) });
      if (view === 'users') {
        const users = (await listAll('users', 'user:')).sort((a, b) => b.createdAt - a.createdAt).slice(0, 1000);
        const usage = await db.mgetInt(users.map((u) => C.usageKey(u.id)));
        return C.send(res, 200, { users: users.map((u, i) => adminView(u, usage[i])) });
      }
      if (view === 'tickets') return C.send(res, 200, { tickets: (await listAll('tickets', 'ticket:')).sort((a, b) => b.createdAt - a.createdAt).slice(0, 300) });
      if (view === 'orders') return C.send(res, 200, { orders: (await listAll('orders', 'order:')).sort((a, b) => b.createdAt - a.createdAt).slice(0, 300) });
      // overview
      const [users, tickets, orders] = await Promise.all([listAll('users', 'user:'), listAll('tickets', 'ticket:'), listAll('orders', 'order:')]);
      const usage = await db.mgetInt(users.map((u) => C.usageKey(u.id)));
      const month = Date.now() - 30 * 864e5;
      return C.send(res, 200, {
        stats: {
          users: users.length, active: users.filter((u) => u.status === 'active').length,
          frozen: users.filter((u) => u.status === 'frozen').length, deactivated: users.filter((u) => u.status === 'deactivated').length,
          needsVerification: users.filter((u) => u.status === 'needs_verification').length,
          subscribers: users.filter((u) => C.activeSub(u)).length, tokensToday: usage.reduce((a, b) => a + b, 0),
          openTickets: tickets.filter((t) => t.status === 'open').length, pendingOrders: orders.filter((o) => o.status === 'pending').length,
          revenue30d: orders.filter((o) => o.status === 'paid' && o.resolvedAt > month).reduce((a, o) => a + o.amount, 0),
        },
      });
    }

    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return C.send(res, 405, { error: 'Metode tidak diizinkan.' }); }
    if (!C.sameOrigin(req)) return C.send(res, 403, { error: 'Permintaan ditolak.' });
    const b = C.body(req);

    // ================= kontrol akun pengguna =================
    if (b.action === 'user') {
      const u = await C.getUser(String(b.id || ''));
      if (!u) return C.send(res, 404, { error: 'Pengguna tidak ditemukan.' });
      if (u.role === 'admin') return C.send(res, 400, { error: 'Akun admin tidak bisa diubah dari sini.' });
      const note = String(b.note || '').trim().slice(0, 500);
      const ops = {
        freeze:               () => { u.status = 'frozen'; u.statusNote = note || 'Melanggar ketentuan penggunaan.'; },
        deactivate_age:       () => { u.status = 'deactivated'; u.statusNote = note || 'Dinonaktifkan karena batas usia.'; },
        require_verification: () => { u.status = 'needs_verification'; u.statusNote = note || 'Akunmu perlu diverifikasi.'; },
        activate:             () => { u.status = 'active'; u.statusNote = ''; },
        verify:               () => { u.verified = true; if (u.status === 'needs_verification') { u.status = 'active'; u.statusNote = ''; } },
        set_quota: () => {
          if (b.value === null || b.value === '') { u.quotaOverride = null; return; }
          const n = intIn(b.value, 0, 100000); if (n === null) throw new Error('Kuota harus bilangan 0–100000.');
          u.quotaOverride = n;
        },
        reset_usage: async () => { await db.del(C.usageKey(u.id)); },
        grant: async () => {
          if (b.planId === 'none') { u.sub = null; return; }
          const cfg = await C.getConfig(); const p = cfg.plans.find((x) => x.id === b.planId);
          if (!p) throw new Error('Paket tidak ditemukan.');
          const base = Math.max(Date.now(), C.activeSub(u) ? u.sub.until : 0);
          u.sub = { plan: p.id, planName: p.name, dailyQuota: p.dailyQuota, until: base + p.days * 864e5 };
        },
      };
      if (b.op === 'delete') {
        await db.del('email:' + u.email); await db.del('user:' + u.id); await db.srem('users', u.id);
        await C.audit(admin, 'delete_user', { target: u.email });
        return C.send(res, 200, { ok: true });
      }
      if (!ops[b.op]) return C.send(res, 400, { error: 'Aksi tidak dikenal.' });
      try { await ops[b.op](); } catch (e) { return C.send(res, 400, { error: e.message }); }
      if (u.status && STATUS.includes(u.status)) u.statusAt = Date.now();
      await C.saveUser(u);
      await C.audit(admin, b.op, { target: u.email, note });
      return C.send(res, 200, { ok: true, user: adminView(u, await db.getInt(C.usageKey(u.id))) });
    }

    // ================= banding & verifikasi =================
    if (b.action === 'ticket') {
      const t = await db.get('ticket:' + b.id);
      if (!t || t.status !== 'open') return C.send(res, 404, { error: 'Pengajuan tidak ditemukan atau sudah diproses.' });
      const approve = b.decision === 'approve';
      if (!approve && b.decision !== 'reject') return C.send(res, 400, { error: 'Keputusan tidak valid.' });
      t.status = approve ? 'approved' : 'rejected';
      t.adminNote = String(b.note || '').trim().slice(0, 500);
      t.resolvedAt = Date.now();
      await db.set('ticket:' + t.id, t);
      if (approve) {
        const u = await C.getUser(t.userId);
        if (u && u.role !== 'admin') {
          u.status = 'active'; u.statusNote = ''; u.statusAt = Date.now();
          if (t.type === 'verification') u.verified = true;
          await C.saveUser(u);
        }
      }
      await C.audit(admin, 'ticket_' + t.status, { target: t.userEmail, note: t.adminNote });
      return C.send(res, 200, { ok: true });
    }

    // ================= pembayaran =================
    if (b.action === 'order') {
      const o = await db.get('order:' + b.id);
      if (!o || (o.status !== 'pending' && o.status !== 'unpaid')) return C.send(res, 404, { error: 'Pesanan tidak ditemukan atau sudah diproses.' });
      if (b.decision === 'confirm') {
        if (!o.hasProof) return C.send(res, 400, { error: 'Pengguna belum mengunggah bukti transfer.' });
        const u = await C.getUser(o.userId);
        if (!u) return C.send(res, 404, { error: 'Pengguna sudah dihapus.' });
        const base = Math.max(Date.now(), C.activeSub(u) ? u.sub.until : 0);
        u.sub = { plan: o.planId, planName: o.planName, dailyQuota: o.dailyQuota, until: base + o.days * 864e5 };
        await C.saveUser(u);
        o.status = 'paid';
      } else if (b.decision === 'reject') o.status = 'rejected';
      else return C.send(res, 400, { error: 'Keputusan tidak valid.' });
      o.resolvedAt = Date.now();
      await db.set('order:' + o.id, o);
      await C.audit(admin, 'order_' + o.status, { target: o.userEmail, plan: o.planName, amount: o.amount });
      return C.send(res, 200, { ok: true });
    }

    // ================= email pengirim (OTP) =================
    if (b.action === 'email') {
      const email = C.normEmail(b.email), name = String(b.name || '').trim().slice(0, 40) || 'El Ai';
      const pw = String(b.appPassword || '').replace(/\s/g, '');
      if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(email)) return C.send(res, 400, { error: 'Alamat email pengirim tidak valid.' });
      if (pw && !/^[a-zA-Z]{16}$/.test(pw)) return C.send(res, 400, { error: 'App Password Gmail berisi 16 huruf (spasi diabaikan). Itu bukan kata sandi Gmail biasa.' });
      const cur = await Mail.getMailConfig();
      if (!pw && !cur.hasPassword) return C.send(res, 400, { error: 'Isi App Password Gmail.' });
      await Mail.saveMailConfig({ email, name, appPassword: pw });
      await C.audit(admin, 'email_set', { target: email });
      return C.send(res, 200, { ok: true, mail: await Mail.getMailConfig() });
    }
    if (b.action === 'email_clear') { await Mail.clearMailConfig(); await C.audit(admin, 'email_clear', {}); return C.send(res, 200, { ok: true }); }
    if (b.action === 'email_test') {
      const to = C.normEmail(b.to) || admin.email;
      try { await Mail.sendMail({ to, subject: 'Tes email El Ai', text: 'Email pengirim El Ai berfungsi. Kode OTP reset kata sandi akan dikirim dari alamat ini.', html: '<p style="font-family:Arial">Email pengirim <b>El Ai</b> berfungsi. Kode OTP reset kata sandi akan dikirim dari alamat ini.</p>' }); }
      catch (e) { return C.send(res, 400, { error: e.message }); }
      return C.send(res, 200, { ok: true, to });
    }

    // ================= foto QRIS =================
    if (b.action === 'qris') {
      const cfg = await C.getConfig();
      if (b.image === null) { await db.del('qris'); cfg.payment.hasQris = false; }
      else {
        if (!C.validImage(b.image)) return C.send(res, 400, { error: 'Foto QRIS tidak valid atau terlalu besar. Pakai JPG/PNG/WebP.' });
        await db.set('qris', b.image); cfg.payment.hasQris = true;
      }
      await db.set('config', { ...(await db.get('config') || {}), payment: cfg.payment });
      await C.audit(admin, b.image === null ? 'qris_remove' : 'qris_set', {});
      return C.send(res, 200, { ok: true });
    }

    // ================= harga, diskon, kuota =================
    if (b.action === 'config') {
      const cur = await C.getConfig();
      const next = { ...cur };
      if (b.freeQuota !== undefined) { const n = intIn(b.freeQuota, 0, 100000); if (n === null) return C.send(res, 400, { error: 'Kuota gratis tidak valid.' }); next.freeQuota = n; }
      if (b.minAge !== undefined) { const n = intIn(b.minAge, 0, 30); if (n === null) return C.send(res, 400, { error: 'Usia minimum tidak valid.' }); next.minAge = n; }
      if (b.costs) for (const k of C.TIERS) if (b.costs[k] !== undefined) { const n = intIn(b.costs[k], 1, 1000); if (n === null) return C.send(res, 400, { error: 'Biaya token tidak valid.' }); next.costs[k] = n; }
      if (b.payment) {
        const pm = { ...cur.payment }, P = b.payment;
        if (typeof P.instructions === 'string') pm.instructions = P.instructions.slice(0, 1500);
        for (const k of ['holder', 'dana', 'gopay']) {
          if (typeof P[k] !== 'string') continue;
          const v = P[k].trim();
          if (v.length > 60 || (k !== 'holder' && v && !/^[0-9+\-\s]{6,25}$/.test(v))) return C.send(res, 400, { error: k === 'holder' ? 'Nama penerima terlalu panjang.' : `Nomor ${k.toUpperCase()} tidak valid (angka saja).` });
          pm[k] = v;
        }
        next.payment = pm;
      }
      if (Array.isArray(b.plans)) {
        next.plans = cur.plans.map((p) => {
          const n = b.plans.find((x) => x && x.id === p.id); if (!n) return p;
          const price = intIn(n.price, 0, 1e9), pct = intIn(n.discountPct, 0, 100), dq = intIn(n.dailyQuota, 0, 100000);
          if (price === null || pct === null || dq === null) throw new Error(`Data paket ${p.name} tidak valid.`);
          let until = null;
          if (n.discountUntil) { const d = new Date(n.discountUntil); if (isNaN(d)) throw new Error('Tanggal akhir diskon tidak valid.'); until = d.toISOString(); }
          return { ...p, price, discountPct: pct, discountUntil: until, dailyQuota: dq, active: !!n.active };
        });
      }
      await db.set('config', next);
      await C.audit(admin, 'config', {});
      return C.send(res, 200, { ok: true, config: await C.getConfig() });
    }

    return C.send(res, 400, { error: 'Aksi tidak dikenal.' });
  } catch (e) {
    console.error('admin error', e);
    return C.send(res, e.message && /tidak valid/.test(e.message) ? 400 : 500, { error: e.message && /tidak valid/.test(e.message) ? e.message : 'Terjadi kesalahan di server.' });
  }
};

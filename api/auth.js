// POST /api/auth  { action: 'signup' | 'login' | 'logout', ... }
const db = require('../lib/db');
const C = require('../lib/core');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const ADMIN_EMAIL = () => C.normEmail(process.env.ADMIN_EMAIL);

async function limited(key, max, ttl) {
  const n = await db.incrby(key, 1, ttl);
  return n > max;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return C.send(res, 405, { error: 'Metode tidak diizinkan.' }); }
  if (!C.sameOrigin(req)) return C.send(res, 403, { error: 'Permintaan ditolak.' });
  const b = C.body(req);
  const ip = C.ip(req);

  try {
    if (b.action === 'logout') { C.endSession(req, res); return C.send(res, 200, { ok: true }); }

    const email = C.normEmail(b.email);
    const password = String(b.password || '');
    if (!EMAIL_RE.test(email)) return C.send(res, 400, { error: 'Alamat email tidak valid.', field: 'email' });
    if (password.length < 8 || password.length > 100) return C.send(res, 400, { error: 'Kata sandi 8–100 karakter.', field: 'password' });

    // ---------- daftar ----------
    if (b.action === 'signup') {
      if (await limited('rl:signup:' + ip, 8, 3600)) return C.send(res, 429, { error: 'Terlalu banyak percobaan daftar. Coba lagi nanti.' });
      const name = String(b.name || '').trim().replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 40) return C.send(res, 400, { error: 'Nama 2–40 karakter.', field: 'name' });
      const birth = String(b.birth || '');
      const age = C.ageOf(birth);
      if (age === null || new Date(birth) > new Date() || age > 120) return C.send(res, 400, { error: 'Tanggal lahir tidak valid.', field: 'birth' });
      const cfg = await C.getConfig();
      if (age < cfg.minAge) return C.send(res, 403, { error: `Maaf, El Ai hanya untuk pengguna berusia ${cfg.minAge} tahun ke atas.`, field: 'birth' });
      if (email === ADMIN_EMAIL() || (await C.userByEmail(email))) return C.send(res, 409, { error: 'Email ini sudah terdaftar. Silakan masuk.', field: 'email' });

      const u = await C.createUser({ name, email, passwordHash: C.hashPassword(password), birth });
      u.lastLoginAt = Date.now();
      await C.saveUser(u);
      C.startSession(req, res, u.id);
      return C.send(res, 200, { ok: true, user: C.publicUser(u) });
    }

    // ---------- masuk ----------
    if (b.action === 'login') {
      if (await limited(`rl:login:${ip}:${email}`, 10, 900)) return C.send(res, 429, { error: 'Terlalu banyak percobaan masuk. Tunggu 15 menit lalu coba lagi.' });
      const bad = () => C.send(res, 401, { error: 'Email atau kata sandi salah.' });

      let u = await C.userByEmail(email);
      const adminEnvPw = process.env.ADMIN_PASSWORD || '';
      if (email === ADMIN_EMAIL() && adminEnvPw) {
        // Akun admin dikendalikan lewat environment variable.
        if (!C.safeEqual(password, adminEnvPw)) return bad();
        if (!u) u = await C.createUser({ name: 'Admin', email, passwordHash: C.hashPassword(adminEnvPw), role: 'admin' });
        else if (u.role !== 'admin' || u.status !== 'active') { u.role = 'admin'; u.status = 'active'; }
      } else {
        if (!u || !C.checkPassword(password, u.passwordHash)) return bad();
      }
      u.lastLoginAt = Date.now();
      await C.saveUser(u);
      C.startSession(req, res, u.id);
      return C.send(res, 200, { ok: true, user: C.publicUser(u) });
    }

    return C.send(res, 400, { error: 'Aksi tidak dikenal.' });
  } catch (e) {
    console.error('auth error', e);
    return C.send(res, 500, { error: 'Terjadi kesalahan di server.' });
  }
};

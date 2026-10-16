// POST /api/auth  { action: 'signup' | 'verify' | 'signup_resend' | 'login' | 'logout' | 'forgot' | 'reset', ... }
const db = require('../lib/db');
const C = require('../lib/core');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const ADMIN_EMAIL = () => C.normEmail(process.env.ADMIN_EMAIL);
const crypto = require('crypto');
const Mail = require('../lib/mail');
const OTP_MINUTES = 10, OTP_MAX_TRIES = 5, RESEND_SECONDS = 60;
const otpHash = (email, code) => crypto.createHmac('sha256', process.env.SESSION_SECRET || 'dev-only-secret-change-me').update(email + ':' + code).digest('hex');

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

    // ---------- lupa kata sandi: kirim kode OTP ke email ----------
    if (b.action === 'forgot') {
      if (!EMAIL_RE.test(email)) return C.send(res, 400, { error: 'Alamat email tidak valid.', field: 'email' });
      if (await limited('rl:forgot:ip:' + ip, 10, 3600)) return C.send(res, 429, { error: 'Terlalu banyak permintaan. Coba lagi nanti.' });
      const generic = { ok: true, resendIn: RESEND_SECONDS, message: 'Jika email itu terdaftar, kode 6 angka sudah dikirim. Cek juga folder spam.' };
      const mail = await Mail.getMailConfig();
      if (!mail.ready) return C.send(res, 503, { error: 'Fitur reset kata sandi belum aktif. Hubungi admin El Ai.' });
      // Batas per email dicek sebelum mengetahui apakah email terdaftar, supaya jawabannya tidak membocorkan daftar akun.
      if (await limited('rl:forgot:email:' + email, 5, 3600)) return C.send(res, 429, { error: 'Terlalu banyak permintaan kode untuk email ini. Coba lagi dalam 1 jam.' });
      const u = await C.userByEmail(email);
      // Akun admin dikendalikan lewat environment variable, jadi tidak bisa direset di sini.
      if (!u || u.role === 'admin' || email === ADMIN_EMAIL()) return C.send(res, 200, generic);
      const prev = await db.get('otp:' + email);
      if (prev && Date.now() - prev.sentAt < RESEND_SECONDS * 1000) return C.send(res, 200, generic);
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      await db.set('otp:' + email, { hash: otpHash(email, code), exp: Date.now() + OTP_MINUTES * 60000, tries: 0, sentAt: Date.now() });
      try { await Mail.sendMail({ to: email, ...Mail.otpEmail(u.name, code, OTP_MINUTES) }); }
      catch (e) { await db.del('otp:' + email); console.error('otp mail error', e.message); return C.send(res, 502, { error: 'Email kode gagal dikirim. Hubungi admin El Ai.' }); }
      return C.send(res, 200, generic);
    }

    // ---------- atur ulang kata sandi dengan kode OTP ----------
    if (b.action === 'reset') {
      const code = String(b.otp || '').replace(/\s/g, '');
      const newPw = String(b.password || '');
      if (!EMAIL_RE.test(email)) return C.send(res, 400, { error: 'Alamat email tidak valid.', field: 'email' });
      if (!/^\d{6}$/.test(code)) return C.send(res, 400, { error: 'Kode harus 6 angka.', field: 'otp' });
      if (newPw.length < 8 || newPw.length > 100) return C.send(res, 400, { error: 'Kata sandi baru 8–100 karakter.', field: 'password' });
      if (await limited('rl:reset:ip:' + ip, 20, 3600)) return C.send(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
      const bad = { error: 'Kode salah atau sudah kedaluwarsa. Minta kode baru.', field: 'otp' };
      const rec = await db.get('otp:' + email);
      if (!rec || rec.exp < Date.now()) return C.send(res, 400, bad);
      if (rec.tries >= OTP_MAX_TRIES) { await db.del('otp:' + email); return C.send(res, 400, bad); }
      const a = Buffer.from(rec.hash), c2 = Buffer.from(otpHash(email, code));
      if (a.length !== c2.length || !crypto.timingSafeEqual(a, c2)) {
        rec.tries += 1; await db.set('otp:' + email, rec);
        return C.send(res, 400, { ...bad, error: `Kode salah. Sisa percobaan: ${Math.max(0, OTP_MAX_TRIES - rec.tries)}.` });
      }
      const u = await C.userByEmail(email);
      if (!u || u.role === 'admin') { await db.del('otp:' + email); return C.send(res, 400, bad); }
      u.passwordHash = C.hashPassword(newPw);
      u.pwv = (u.pwv || 0) + 1;   // semua sesi lama keluar
      await C.saveUser(u);
      await db.del('otp:' + email);
      return C.send(res, 200, { ok: true });
    }

    // ---------- daftar langkah 2: cek kode OTP, baru buat akun ----------
    if (b.action === 'verify') {
      const code = String(b.otp || '').replace(/\s/g, '');
      if (!EMAIL_RE.test(email)) return C.send(res, 400, { error: 'Alamat email tidak valid.', field: 'email' });
      if (!/^\d{6}$/.test(code)) return C.send(res, 400, { error: 'Kode harus 6 angka.', field: 'otp' });
      if (await limited('rl:verify:ip:' + ip, 20, 3600)) return C.send(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
      const bad = { error: 'Kode salah atau sudah kedaluwarsa. Minta kode baru.', field: 'otp' };
      const rec = await db.get('signup:' + email);
      if (!rec || rec.exp < Date.now()) return C.send(res, 400, bad);
      if (rec.tries >= OTP_MAX_TRIES) { await db.del('signup:' + email); return C.send(res, 400, bad); }
      const a = Buffer.from(rec.hash), c2 = Buffer.from(otpHash(email, code));
      if (a.length !== c2.length || !crypto.timingSafeEqual(a, c2)) {
        rec.tries += 1; await db.set('signup:' + email, rec);
        return C.send(res, 400, { ...bad, error: `Kode salah. Sisa percobaan: ${Math.max(0, OTP_MAX_TRIES - rec.tries)}.` });
      }
      if (email === ADMIN_EMAIL() || (await C.userByEmail(email))) { await db.del('signup:' + email); return C.send(res, 409, { error: 'Email ini sudah terdaftar. Silakan masuk.', field: 'email' }); }
      const u = await C.createUser({ name: rec.name, email, passwordHash: rec.passwordHash, birth: rec.birth, emailVerified: true });
      await db.del('signup:' + email);
      u.lastLoginAt = Date.now();
      await C.saveUser(u);
      C.startSession(req, res, u);
      return C.send(res, 200, { ok: true, user: C.publicUser(u) });
    }

    // ---------- daftar: kirim ulang kode ----------
    if (b.action === 'signup_resend') {
      if (!EMAIL_RE.test(email)) return C.send(res, 400, { error: 'Alamat email tidak valid.', field: 'email' });
      if (await limited('rl:signup:ip:' + ip, 15, 3600)) return C.send(res, 429, { error: 'Terlalu banyak permintaan. Coba lagi nanti.' });
      if (await limited('rl:signup:email:' + email, 5, 3600)) return C.send(res, 429, { error: 'Terlalu banyak permintaan kode untuk email ini. Coba lagi dalam 1 jam.' });
      const rec = await db.get('signup:' + email);
      if (!rec) return C.send(res, 400, { error: 'Data pendaftaran tidak ditemukan. Isi formulir daftar lagi.', field: 'email' });
      const wait = Math.ceil((rec.sentAt + RESEND_SECONDS * 1000 - Date.now()) / 1000);
      if (wait > 0) return C.send(res, 429, { error: `Tunggu ${wait} detik sebelum meminta kode lagi.` });
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      const next = { ...rec, hash: otpHash(email, code), exp: Date.now() + OTP_MINUTES * 60000, tries: 0, sentAt: Date.now() };
      await db.set('signup:' + email, next);
      try { await Mail.sendMail({ to: email, ...Mail.otpEmail(rec.name, code, OTP_MINUTES, 'signup') }); }
      catch (e) { console.error('signup otp mail error', e.message); return C.send(res, 502, { error: 'Email kode gagal dikirim. Hubungi admin El Ai.' }); }
      return C.send(res, 200, { ok: true, resendIn: RESEND_SECONDS });
    }

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

      // Verifikasi email: akun baru dibuat SETELAH kode 6 angka yang dikirim ke email dimasukkan dengan benar.
      const mail = await Mail.getMailConfig();
      if (!mail.ready) return C.send(res, 503, { error: 'Pendaftaran butuh verifikasi email, tetapi email pengirim belum diatur. Hubungi admin El Ai.' });
      if (await limited('rl:signup:email:' + email, 5, 3600)) return C.send(res, 429, { error: 'Terlalu banyak permintaan kode untuk email ini. Coba lagi dalam 1 jam.' });
      const prev = await db.get('signup:' + email);
      if (prev) {
        const wait = Math.ceil((prev.sentAt + RESEND_SECONDS * 1000 - Date.now()) / 1000);
        if (wait > 0) return C.send(res, 429, { error: `Kode sudah dikirim. Tunggu ${wait} detik untuk meminta lagi.` });
      }
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      await db.set('signup:' + email, { name, passwordHash: C.hashPassword(password), birth, hash: otpHash(email, code), exp: Date.now() + OTP_MINUTES * 60000, tries: 0, sentAt: Date.now() });
      try { await Mail.sendMail({ to: email, ...Mail.otpEmail(name, code, OTP_MINUTES, 'signup') }); }
      catch (e) { await db.del('signup:' + email); console.error('signup otp mail error', e.message); return C.send(res, 502, { error: 'Email kode gagal dikirim. Pastikan alamat email benar, atau hubungi admin El Ai.' }); }
      return C.send(res, 200, { ok: true, needOtp: true, resendIn: RESEND_SECONDS, message: 'Kode 6 angka sudah dikirim ke emailmu. Cek juga folder spam.' });
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
      C.startSession(req, res, u);
      return C.send(res, 200, { ok: true, user: C.publicUser(u) });
    }

    return C.send(res, 400, { error: 'Aksi tidak dikenal.' });
  } catch (e) {
    console.error('auth error', e);
    return C.send(res, 500, { error: 'Terjadi kesalahan di server.' });
  }
};

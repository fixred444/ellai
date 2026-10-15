// Fungsi bersama: konfigurasi, sesi, pengguna, kuota, dan helper HTTP.
const crypto = require('crypto');
const db = require('./db');

const COOKIE = 'elai_session';
const SESSION_DAYS = 30;
const TIERS = ['lite', 'pro', 'max'];

const DEFAULT_CONFIG = {
  freeQuota: 100,                                  // kuota harian akun gratis
  costs: { lite: 5, pro: 10, max: 15 },            // token per pesan
  minAge: 13,                                      // usia minimum saat daftar
  payment: { instructions: 'Bayar sesuai nominal, lalu unggah foto bukti transfer. Pesanan dikonfirmasi admin, biasanya kurang dari 24 jam.', holder: '', dana: '', gopay: '', hasQris: false },
  plans: [
    { id: 'weekly',  name: 'Mingguan', days: 7,   price: 15000,  discountPct: 0, discountUntil: null, dailyQuota: 300,  active: true },
    { id: 'monthly', name: 'Bulanan',  days: 30,  price: 49000,  discountPct: 0, discountUntil: null, dailyQuota: 500,  active: true },
    { id: 'yearly',  name: 'Tahunan',  days: 365, price: 449000, discountPct: 0, discountUntil: null, dailyQuota: 800,  active: true },
  ],
};

// ---------- konfigurasi ----------
async function getConfig() {
  const saved = (await db.get('config')) || {};
  const cfg = {
    ...DEFAULT_CONFIG, ...saved,
    costs: { ...DEFAULT_CONFIG.costs, ...(saved.costs || {}) },
    payment: { ...DEFAULT_CONFIG.payment, ...(saved.payment || {}) },
  };
  const byId = Object.fromEntries((saved.plans || []).map((p) => [p.id, p]));
  cfg.plans = DEFAULT_CONFIG.plans.map((p) => ({ ...p, ...(byId[p.id] || {}) }));
  return cfg;
}
function planPrice(p, now = Date.now()) {
  const on = p.discountPct > 0 && (!p.discountUntil || new Date(p.discountUntil).getTime() > now);
  const pct = on ? p.discountPct : 0;
  return { base: p.price, pct, final: Math.max(0, Math.round(p.price * (1 - pct / 100))) };
}
function publicPlans(cfg) {
  return cfg.plans.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, days: p.days, dailyQuota: p.dailyQuota, discountUntil: p.discountUntil || null, ...planPrice(p) }));
}

// ---------- HTTP ----------
function send(res, status, body) {
  res.status(status).setHeader('Cache-Control', 'no-store');
  return res.json(body);
}
function body(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  return b && typeof b === 'object' ? b : {};
}
function ip(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
}
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isHttps(req) { return (req.headers['x-forwarded-proto'] || '').includes('https') || !!process.env.VERCEL; }
function setCookie(req, res, value, maxAge) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`);
}
// Tolak permintaan lintas-situs untuk metode yang mengubah data.
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

// ---------- sesi ----------
function secret() {
  const s = (process.env.SESSION_SECRET || '').trim();
  if (s.length >= 16) return s;
  if (process.env.VERCEL_ENV === 'production') throw new Error('SESSION_SECRET belum diatur (minimal 16 karakter).');
  return 'dev-only-secret-change-me';
}
const b64 = (b) => Buffer.from(b).toString('base64url');
function signSession(uid) {
  const payload = b64(JSON.stringify({ u: uid, e: Date.now() + SESSION_DAYS * 864e5 }));
  const mac = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function readSession(req) {
  const tok = cookies(req)[COOKIE];
  if (!tok) return null;
  const [payload, mac] = tok.split('.');
  if (!payload || !mac) return null;
  const good = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(mac), c = Buffer.from(good);
  if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return p.e > Date.now() ? p.u : null;
  } catch { return null; }
}
function startSession(req, res, uid) { setCookie(req, res, signSession(uid), SESSION_DAYS * 86400); }
function endSession(req, res) { setCookie(req, res, '', 0); }

// ---------- password ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return 's1$' + salt.toString('base64') + '$' + h.toString('base64');
}
function checkPassword(pw, stored) {
  try {
    const [, s, h] = String(stored).split('$');
    const calc = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
    const ref = Buffer.from(h, 'base64');
    return calc.length === ref.length && crypto.timingSafeEqual(calc, ref);
  } catch { return false; }
}
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// ---------- pengguna ----------
const newId = (p) => p + crypto.randomBytes(8).toString('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();
async function getUser(id) { return id ? db.get('user:' + id) : null; }
async function saveUser(u) { await db.set('user:' + u.id, u); }
async function userByEmail(email) { const id = await db.get('email:' + normEmail(email)); return id ? getUser(id) : null; }
async function createUser({ name, email, passwordHash, birth, role = 'user' }) {
  const u = {
    id: newId('u_'), name, email: normEmail(email), passwordHash, birth: birth || null, role,
    status: 'active', statusNote: '', statusAt: null, verified: role === 'admin',
    sub: null, quotaOverride: null, createdAt: Date.now(), lastLoginAt: null,
  };
  await db.set('email:' + u.email, u.id);
  await saveUser(u);
  await db.sadd('users', u.id);
  return u;
}
function ageOf(birth, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth || '');
  if (!m) return null;
  let a = now.getUTCFullYear() - +m[1];
  if (now.getUTCMonth() + 1 < +m[2] || (now.getUTCMonth() + 1 === +m[2] && now.getUTCDate() < +m[3])) a--;
  return a;
}
function activeSub(u) { return u.sub && u.sub.until > Date.now() ? u.sub : null; }
function publicUser(u) {
  const s = activeSub(u);
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, statusNote: u.statusNote || '',
    verified: !!u.verified, sub: s ? { plan: s.plan, planName: s.planName, until: s.until } : null,
  };
}

// ---------- kuota ----------
const dayKey = (t = Date.now()) => new Date(t + 7 * 3600e3).toISOString().slice(0, 10); // hari WIB
function nextResetAt() { const d = new Date(Date.now() + 7 * 3600e3); d.setUTCHours(24, 0, 0, 0); return d.getTime() - 7 * 3600e3; }
function dailyLimit(u, cfg) {
  if (u.role === 'admin') return Infinity;
  if (Number.isInteger(u.quotaOverride)) return u.quotaOverride;
  const s = activeSub(u);
  if (s) { const p = cfg.plans.find((x) => x.id === s.plan); return Math.max(cfg.freeQuota, (p && p.dailyQuota) || s.dailyQuota || cfg.freeQuota); }
  return cfg.freeQuota;
}
const usageKey = (id, day = dayKey()) => `usage:${id}:${day}`;
async function quotaOf(u, cfg) {
  const used = await db.getInt(usageKey(u.id));
  const limit = dailyLimit(u, cfg);
  return { used, limit: limit === Infinity ? null : limit, resetAt: nextResetAt(), costs: cfg.costs };
}
// Potong kuota secara atomik. Mengembalikan {ok, used, limit}.
async function charge(u, cfg, cost) {
  const limit = dailyLimit(u, cfg);
  const k = usageKey(u.id);
  const used = await db.incrby(k, cost, 3 * 86400);
  if (used > limit) { await db.incrby(k, -cost); return { ok: false, used: used - cost, limit }; }
  return { ok: true, used, limit };
}
async function refund(u, cost) { await db.incrby(usageKey(u.id), -cost); }

// Ambil pengguna dari cookie sesi. null jika belum login.
async function authUser(req) { return getUser(readSession(req)); }

async function audit(actor, action, detail) {
  await db.lpush('audit', { t: Date.now(), by: actor.email, action, ...detail });
  await db.ltrim('audit', 0, 199);
}

const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMG = 450000; // karakter data URL (~330 KB)
const validImage = (s) => typeof s === 'string' && s.length <= MAX_IMG && IMG_RE.test(s);

module.exports = {
  validImage,
  TIERS, DEFAULT_CONFIG, getConfig, planPrice, publicPlans, send, body, ip, sameOrigin,
  startSession, endSession, hashPassword, checkPassword, safeEqual, newId, normEmail,
  getUser, saveUser, userByEmail, createUser, ageOf, activeSub, publicUser,
  dayKey, usageKey, quotaOf, charge, refund, dailyLimit, authUser, audit,
};

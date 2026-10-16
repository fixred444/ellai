// Kirim email lewat Gmail SMTP (smtp.gmail.com:465, TLS) tanpa dependensi.
// Email pengirim + App Password diatur admin di panel; password disimpan terenkripsi (AES-256-GCM).
const crypto = require('crypto');
const tls = require('tls');
const db = require('./db');

const HOST = process.env.SMTP_HOST || 'smtp.gmail.com';        // SMTP_HOST/PORT/INSECURE hanya untuk pengujian lokal
const PORT = parseInt(process.env.SMTP_PORT || '465', 10);

function key() {
  const s = (process.env.SESSION_SECRET || '').trim() || (process.env.VERCEL_ENV === 'production' ? '' : 'dev-only-secret-change-me');
  if (s.length < 16 && process.env.VERCEL_ENV === 'production') throw new Error('SESSION_SECRET belum diatur.');
  return crypto.createHash('sha256').update('mail:' + s).digest();
}
function encrypt(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}
function decrypt(blob) {
  try {
    const [iv, tag, ct] = String(blob).split('.').map((x) => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch { return null; }
}

// ---------- konfigurasi (dipakai admin) ----------
async function getMailConfig() {
  const m = (await db.get('mailcfg')) || null;
  if (!m) return { email: '', name: 'El Ai', hasPassword: false, ready: false };
  const ok = !!(m.pass && decrypt(m.pass));
  return { email: m.email, name: m.name || 'El Ai', hasPassword: !!m.pass, ready: ok && !!m.email, needsReenter: !!m.pass && !ok };
}
async function saveMailConfig({ email, name, appPassword }) {
  const cur = (await db.get('mailcfg')) || {};
  const next = { email, name: name || 'El Ai', pass: cur.pass || '' };
  if (appPassword) next.pass = encrypt(appPassword);
  await db.set('mailcfg', next);
}
const clearMailConfig = () => db.del('mailcfg');

// ---------- SMTP ----------
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const wrap = (s) => s.replace(/(.{76})/g, '$1\r\n');
const hdr = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

function buildMessage({ from, name, to, subject, text, html }) {
  const bnd = 'b_' + crypto.randomBytes(12).toString('hex');
  const domain = from.split('@')[1] || 'localhost';
  const lines = [
    `From: ${hdr(name)} <${from}>`, `To: <${to}>`, `Subject: ${hdr(subject)}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${bnd}"`, '',
    `--${bnd}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(text)),
    `--${bnd}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(html)),
    `--${bnd}--`, '',
  ];
  return lines.join('\r\n');
}

function smtpSend({ user, pass, to, message }) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: HOST, port: PORT, servername: HOST, rejectUnauthorized: process.env.SMTP_INSECURE !== '1' });
    let buf = '', waiter = null, done = false;
    const fail = (e) => { if (done) return; done = true; try { sock.destroy(); } catch {} reject(e instanceof Error ? e : new Error(String(e))); };
    const timer = setTimeout(() => fail(new Error('Server email tidak merespons (timeout).')), 20000);
    sock.setEncoding('utf8');
    sock.on('error', fail);
    sock.on('close', () => { if (!done) fail(new Error('Koneksi ke server email terputus.')); });
    sock.on('data', (d) => {
      buf += d;
      // balasan lengkap berakhir pada baris "NNN " (tanpa tanda minus)
      const lines = buf.split('\r\n');
      if (lines.length < 2) return;
      const last = lines[lines.length - 2];
      if (/^\d{3} /.test(last) && waiter) { const w = waiter; waiter = null; const r = buf; buf = ''; w(r); }
    });
    const read = () => new Promise((res) => { waiter = res; });
    const cmd = async (line, ok) => {
      sock.write(line + '\r\n');
      const r = await read();
      if (!ok.includes(parseInt(r.slice(0, 3), 10))) throw Object.assign(new Error(r.trim().split('\r\n').pop()), { smtp: r });
      return r;
    };
    (async () => {
      const greet = await read();
      if (!greet.startsWith('220')) throw new Error('Server email menolak koneksi.');
      await cmd('EHLO elai.local', [250]);
      await cmd('AUTH LOGIN', [334]);
      await cmd(b64(user), [334]);
      await cmd(b64(pass), [235]);
      await cmd(`MAIL FROM:<${user}>`, [250]);
      await cmd(`RCPT TO:<${to}>`, [250, 251]);
      await cmd('DATA', [354]);
      sock.write(message.replace(/\r\n\./g, '\r\n..') + '\r\n.\r\n');
      const r = await read();
      if (parseInt(r.slice(0, 3), 10) !== 250) throw new Error(r.trim());
      sock.write('QUIT\r\n');
      done = true; clearTimeout(timer); sock.end(); resolve();
    })().catch((e) => { clearTimeout(timer); fail(e); });
  });
}

// Terjemahkan galat SMTP jadi pesan yang bisa dipahami admin.
function friendly(e) {
  const m = String((e && (e.smtp || e.message)) || e);
  if (/^535|Username and Password not accepted|BadCredentials|534/i.test(m)) return 'Gmail menolak login. Pastikan memakai App Password (16 huruf), bukan kata sandi Gmail biasa, dan verifikasi 2 langkah sudah aktif.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|terputus/i.test(m)) return 'Tidak bisa terhubung ke server Gmail. Coba lagi sebentar.';
  return 'Gagal mengirim email: ' + m.slice(0, 160);
}

async function sendMail({ to, subject, text, html }) {
  const m = (await db.get('mailcfg')) || null;
  const pass = m && m.pass ? decrypt(m.pass) : null;
  if (!m || !m.email || !pass) { const e = new Error('Email pengirim belum diatur admin.'); e.code = 'NOT_CONFIGURED'; throw e; }
  const message = buildMessage({ from: m.email, name: m.name || 'El Ai', to, subject, text, html });
  try { await smtpSend({ user: m.email, pass, to, message }); }
  catch (e) { const err = new Error(friendly(e)); err.code = 'SEND_FAILED'; throw err; }
}

// ---------- isi email OTP ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function otpEmail(name, code, minutes, purpose) {
  const signup = purpose === 'signup';
  const what = signup ? 'verifikasi email untuk membuat akun El Ai kamu' : 'mengatur ulang kata sandi El Ai kamu';
  const text = `Halo ${name},\n\nKode untuk ${what}:\n\n    ${code}\n\nKode berlaku ${minutes} menit dan hanya bisa dipakai sekali. Jangan berikan kode ini kepada siapa pun, termasuk yang mengaku dari El Ai.\n\n${signup ? 'Kalau kamu tidak mendaftar, abaikan saja email ini. Tidak ada akun yang dibuat tanpa kode ini.' : 'Kalau kamu tidak meminta ini, abaikan saja email ini. Kata sandimu tidak berubah.'}\n\nEl Ai`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:440px;margin:0 auto;padding:24px;color:#151918">
<div style="font-weight:700;font-size:18px;margin-bottom:18px">El Ai</div>
<p style="margin:0 0 14px">Halo ${esc(name)},</p>
<p style="margin:0 0 14px">Kode untuk ${signup ? 'verifikasi email dan membuat akunmu' : 'mengatur ulang kata sandimu'}:</p>
<div style="font-family:Consolas,Menlo,monospace;font-size:32px;letter-spacing:8px;font-weight:700;padding:16px 0;margin:0 0 14px;border-top:1px solid #d9dcd8;border-bottom:1px solid #d9dcd8;text-align:center">${esc(code)}</div>
<p style="margin:0 0 14px;font-size:14px;color:#445">Berlaku ${minutes} menit dan hanya bisa dipakai sekali. Jangan berikan kode ini kepada siapa pun.</p>
<p style="margin:0;font-size:13px;color:#667">${signup ? 'Kalau kamu tidak mendaftar, abaikan email ini. Tidak ada akun yang dibuat tanpa kode ini.' : 'Kalau kamu tidak meminta ini, abaikan email ini. Kata sandimu tidak berubah.'}</p></div>`;
  return { subject: signup ? `${code} adalah kode verifikasi El Ai` : `${code} adalah kode reset kata sandi El Ai`, text, html };
}

module.exports = { getMailConfig, saveMailConfig, clearMailConfig, sendMail, otpEmail };

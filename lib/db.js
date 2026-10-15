// Lapisan database tipis. Produksi: Upstash Redis lewat REST (tanpa dependensi).
// Variabel yang dikenali: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//                         atau KV_REST_API_URL + KV_REST_API_TOKEN (integrasi Vercel).
// Tanpa variabel itu, dipakai memori lokal (HANYA untuk dev; data hilang saat restart).

const URL_ = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').trim().replace(/\/+$/, '');
const TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '').trim();
const REMOTE = !!(URL_ && TOKEN);

// ---------- memori lokal (dev) ----------
const mem = new Map();      // key -> string | Set | Array
const exp = new Map();      // key -> epoch ms
function alive(k) {
  const e = exp.get(k);
  if (e && e < Date.now()) { mem.delete(k); exp.delete(k); }
  return mem.has(k);
}
function localExec(cmd) {
  const [op, key, ...a] = cmd;
  const o = String(op).toUpperCase();
  switch (o) {
    case 'GET': return alive(key) ? mem.get(key) : null;
    case 'SET': mem.set(key, String(a[0])); return 'OK';
    case 'DEL': { const had = mem.delete(key); exp.delete(key); return had ? 1 : 0; }
    case 'INCRBY': { const v = (alive(key) ? parseInt(mem.get(key), 10) : 0) + parseInt(a[0], 10); mem.set(key, String(v)); return v; }
    case 'EXPIRE': exp.set(key, Date.now() + parseInt(a[0], 10) * 1000); return 1;
    case 'SADD': { if (!alive(key)) mem.set(key, new Set()); const s = mem.get(key); let n = 0; for (const m of a) if (!s.has(m)) { s.add(m); n++; } return n; }
    case 'SREM': { if (!alive(key)) return 0; const s = mem.get(key); let n = 0; for (const m of a) if (s.delete(m)) n++; return n; }
    case 'SMEMBERS': return alive(key) ? [...mem.get(key)] : [];
    case 'MGET': return [key, ...a].map((k) => (alive(k) ? mem.get(k) : null));
    case 'LPUSH': { if (!alive(key)) mem.set(key, []); mem.get(key).unshift(...a); return mem.get(key).length; }
    case 'LTRIM': { if (alive(key)) mem.set(key, mem.get(key).slice(parseInt(a[0], 10), parseInt(a[1], 10) + 1)); return 'OK'; }
    case 'LRANGE': return alive(key) ? mem.get(key).slice(parseInt(a[0], 10), parseInt(a[1], 10) + 1) : [];
    default: throw new Error('Perintah tidak didukung: ' + o);
  }
}

async function exec(cmd) {
  if (!REMOTE) {
    if (process.env.VERCEL && process.env.VERCEL_ENV === 'production') {
      throw new Error('Database belum dipasang (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).');
    }
    return localExec(cmd);
  }
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Database error: ' + (j.error || r.status));
  return j.result;
}

const parse = (s) => { if (s == null) return null; try { return JSON.parse(s); } catch { return null; } };

module.exports = {
  REMOTE,
  async get(key) { return parse(await exec(['GET', key])); },
  async set(key, val) { await exec(['SET', key, JSON.stringify(val)]); },
  async del(key) { return exec(['DEL', key]); },
  async incrby(key, n, ttl) {
    const v = await exec(['INCRBY', key, String(n)]);
    if (ttl) await exec(['EXPIRE', key, String(ttl)]);
    return v;
  },
  async getInt(key) { const v = await exec(['GET', key]); return v == null ? 0 : parseInt(v, 10) || 0; },
  async sadd(key, m) { return exec(['SADD', key, m]); },
  async srem(key, m) { return exec(['SREM', key, m]); },
  async smembers(key) { return (await exec(['SMEMBERS', key])) || []; },
  async mget(keys) {
    if (!keys.length) return [];
    const out = [];
    for (let i = 0; i < keys.length; i += 200) out.push(...(await exec(['MGET', ...keys.slice(i, i + 200)])));
    return out.map(parse);
  },
  async mgetInt(keys) {
    if (!keys.length) return [];
    const out = [];
    for (let i = 0; i < keys.length; i += 200) out.push(...(await exec(['MGET', ...keys.slice(i, i + 200)])));
    return out.map((v) => (v == null ? 0 : parseInt(v, 10) || 0));
  },
  async lpush(key, val) { await exec(['LPUSH', key, JSON.stringify(val)]); },
  async ltrim(key, a, b) { await exec(['LTRIM', key, String(a), String(b)]); },
  async lrange(key, a, b) { return ((await exec(['LRANGE', key, String(a), String(b)])) || []).map(parse); },
};

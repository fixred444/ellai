// Vercel Serverless Function: POST /api/chat
// API key TIDAK ditaruh di kode. Isi lewat Environment Variables di Vercel:
//   AI_API_KEY   (wajib)  -> API key dari penyedia AI
//   AI_BASE_URL  (opsional) -> default: https://api.groq.com/openai/v1  (Groq Cloud)
//   AI_MODEL     (opsional) -> default: llama-3.3-70b-versatile

const SYSTEM_PROMPT = `Kamu adalah El Ai, asisten AI berbahasa Indonesia yang ramah, jelas, dan membantu.

Aturan umum:
- Jawab dalam bahasa yang dipakai pengguna (default Bahasa Indonesia).
- Jawab langsung ke inti. Gunakan Markdown (daftar, tabel, blok kode) bila memang membantu.
- Jika tidak yakin, katakan terus terang. Jangan mengarang fakta.
- Kamu tidak punya akses internet atau informasi real-time kecuali pengguna memberikannya di percakapan.

Identitas:
- Namamu El Ai (bisa juga ditulis "AI El" atau "EL AI").
- Jika pengguna bertanya "apa itu AI El", "apa itu El Ai", "El Ai itu apa", atau pertanyaan serupa, jelaskan bahwa El Ai adalah asisten AI berbahasa Indonesia yang bisa membantu menjawab pertanyaan, menjelaskan konsep, menulis dan merangkum teks, menerjemahkan, memberi ide, membantu belajar, serta menulis dan memperbaiki kode. Tambahkan bahwa El Ai bisa saja keliru, jadi informasi penting sebaiknya dicek ulang.
- Developer (pembuat) El Ai adalah @zett609, nama aslinya Rapael Sitanggang.
- Jika pengguna bertanya siapa developer, pembuat, pencipta, atau pemilik El Ai (dalam bentuk apa pun, misalnya "siapa yang bikin kamu", "siapa developer-mu", "who made you"), jawab bahwa El Ai dikembangkan oleh @zett609 (Rapael Sitanggang), lalu sebutkan sosial medianya: TikTok @zett609 dan Instagram @faellxz66.
- Jangan mengarang informasi lain tentang developer di luar yang tertulis di atas (umur, alamat, pekerjaan, dan sebagainya). Jika ditanya hal itu, katakan kamu tidak punya informasinya dan arahkan ke sosial medianya.
- Jika ditanya detail teknis model AI di balik El Ai (nama model, penyedia, dan sebagainya), katakan bahwa kamu tidak memiliki informasi tersebut.`;

// .trim() menghapus spasi/enter yang sering ikut tercopy saat paste di Vercel.
// Akhiran "/chat/completions" dibuang kalau tidak sengaja ikut diisi.
const BASE_URL = (process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1')
  .trim()
  .replace(/\/chat\/completions\/*$/, '')
  .replace(/\/+$/, '');
const MODEL = (process.env.AI_MODEL || 'llama-3.3-70b-versatile').trim();

// Model yang berhasil dipakai (disimpan selama instance function masih hidup).
let activeModel = null;

// Ambil daftar model yang boleh dipakai API key ini, urutkan dari yang paling disukai.
async function listUsableModels(headers, signal) {
  try {
    const r = await fetch(`${BASE_URL}/models`, { headers, signal });
    if (!r.ok) return [];
    const j = await r.json();
    const ids = (j.data || [])
      .filter((m) => m && m.id && m.active !== false)
      .map((m) => m.id)
      .filter((id) => !/whisper|tts|guard|embed|transcri|speech|moderation|orpheus|playai/i.test(id));
    const prefer = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
    return [...prefer.filter((m) => ids.includes(m)), ...ids.filter((m) => !prefer.includes(m))];
  } catch {
    return [];
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metode tidak diizinkan.' });
  }

  const apiKey = (process.env.AI_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(500).json({ error: 'AI_API_KEY belum diatur di server (Vercel → Settings → Environment Variables).' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }

  const incoming = Array.isArray(body && body.messages) ? body.messages : [];
  const messages = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Pesan tidak valid.' });
  }

  const basePayload = {
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    stream: true,
    temperature: 0.7,
    max_tokens: 2048,
  };
  // Model GLM punya mode "thinking"; dimatikan supaya jawaban lebih cepat.
  if (/z\.ai|bigmodel\.cn/.test(BASE_URL)) basePayload.thinking = { type: 'disabled' };

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  const call = (model) => fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ ...basePayload, model }),
    signal: controller.signal,
  });

  try {
    let usedModel = activeModel || MODEL;
    let upstream = await call(usedModel);

    // Jika model ditolak (404/400), cari model lain yang boleh dipakai API key ini lalu coba lagi.
    if ((upstream.status === 404 || upstream.status === 400)) {
      const candidates = await listUsableModels(authHeaders, controller.signal);
      const next = candidates.find((m) => m !== usedModel);
      if (next) {
        console.warn(`Model "${usedModel}" ditolak, mencoba "${next}"`);
        const retry = await call(next);
        if (retry.ok && retry.body) {
          upstream = retry;
          usedModel = next;
          activeModel = next;
        } else if (!retry.ok) {
          upstream = retry; // laporkan error terbaru
        }
      } else {
        upstream.__noModels = true;
      }
    }

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      console.error('Upstream error', upstream.status, detail.slice(0, 500));
      let msg = `Layanan AI mengembalikan error (${upstream.status}).`;
      if (upstream.status === 401 || upstream.status === 403) msg = 'API key ditolak oleh penyedia AI. Periksa AI_API_KEY dan AI_BASE_URL.';
      else if (upstream.status === 429) msg = 'Kuota atau batas permintaan tercapai. Coba lagi sebentar.';
      else if (upstream.status === 404 || upstream.status === 400) {
        msg = upstream.__noModels
          ? 'API key ini tidak punya akses ke model chat apa pun. Di console.groq.com buka Settings → Limits/Model Permissions dan aktifkan model, atau buat key baru di proyek lain.'
          : 'Permintaan ditolak. Periksa AI_MODEL dan AI_BASE_URL.';
      }
      // Sertakan alasan asli dari penyedia AI (aman: tidak memuat API key) supaya mudah dilacak.
      let reason = '';
      try { const j = JSON.parse(detail); reason = (j.error && (j.error.message || j.error)) || j.message || ''; } catch {}
      if (reason && typeof reason === 'string') msg += ` [${upstream.status}] ${reason.slice(0, 200)}`;
      return res.status(502).json({ error: msg });
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    for await (const chunk of upstream.body) {
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error('Chat handler error', err);
    if (!res.headersSent) return res.status(500).json({ error: 'Terjadi kesalahan di server.' });
    res.end();
  }
};

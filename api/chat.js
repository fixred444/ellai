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
- Jika ditanya detail teknis model di balik El Ai atau siapa pembuatnya, katakan bahwa kamu tidak memiliki informasi tersebut.`;

// .trim() menghapus spasi/enter yang sering ikut tercopy saat paste di Vercel.
// Akhiran "/chat/completions" dibuang kalau tidak sengaja ikut diisi.
const BASE_URL = (process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1')
  .trim()
  .replace(/\/chat\/completions\/*$/, '')
  .replace(/\/+$/, '');
const MODEL = (process.env.AI_MODEL || 'llama-3.3-70b-versatile').trim();

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

  const payload = {
    model: MODEL,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    stream: true,
    temperature: 0.7,
    max_tokens: 2048,
  };
  // Model GLM punya mode "thinking"; dimatikan supaya jawaban lebih cepat.
  if (/z\.ai|bigmodel\.cn/.test(BASE_URL)) payload.thinking = { type: 'disabled' };

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  try {
    const upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      console.error('Upstream error', upstream.status, detail.slice(0, 500));
      let msg = `Layanan AI mengembalikan error (${upstream.status}).`;
      if (upstream.status === 401 || upstream.status === 403) msg = 'API key ditolak oleh penyedia AI. Periksa AI_API_KEY dan AI_BASE_URL.';
      else if (upstream.status === 429) msg = 'Kuota atau batas permintaan tercapai. Coba lagi sebentar.';
      else if (upstream.status === 404 || upstream.status === 400) msg = 'Permintaan ditolak. Periksa AI_MODEL dan AI_BASE_URL.';
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

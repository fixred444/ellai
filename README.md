# El Ai

Website chat AI berbahasa Indonesia dengan tampilan *liquid glass*: sidebar riwayat obrolan, jawaban streaming, mode gelap/terang, render Markdown + blok kode, dan lampiran (foto, PDF, file teks/kode).

Tanpa build step: HTML/CSS/JS statis + satu serverless function (`api/chat.js`) yang menyimpan API key dengan aman di server.

## Struktur

```
index.html, style.css, app.js, markdown.js, favicon.svg   -> tampilan
api/chat.js                                                -> backend (Vercel Function)
vercel.json, package.json                                  -> konfigurasi
```

## Deploy: GitHub -> Vercel

1. Buat repository baru di GitHub, lalu upload semua file proyek ini (atau `git push`).
2. Buka https://vercel.com/new, pilih **Import** repository tadi.
3. Framework Preset: **Other** (biarkan Build Command dan Output Directory kosong).
4. Buka **Environment Variables**, tambahkan:
   - `AI_API_KEY` = API key Groq kamu, diawali `gsk_` (wajib)
   - `AI_BASE_URL` = `https://api.groq.com/openai/v1` (opsional)
   - `AI_MODEL` = `llama-3.3-70b-versatile` (opsional)
   - `AI_VISION_MODEL` = `qwen/qwen3.8-27b` (opsional, model yang membaca foto)
5. Klik **Deploy**. Setiap `git push` ke GitHub akan otomatis deploy ulang.

Model Groq lain yang bisa dipakai di `AI_MODEL`: `llama-3.1-8b-instant` (lebih cepat dan ringan), `openai/gpt-oss-120b`, `openai/gpt-oss-20b`. Penyedia lain yang kompatibel dengan format OpenAI (`/chat/completions`) juga bisa dipakai dengan mengganti `AI_BASE_URL` dan `AI_MODEL`.

## Tingkatan AI (El Lite / El Pro / El Max)

Di pojok kanan atas ada pemilih tingkatan, seperti Haiku / Sonnet / Opus pada Claude. Tiap tingkatan memakai model berbeda lewat Environment Variables:

| Tingkatan | Variabel | Bawaan |
|---|---|---|
| El Lite (cepat) | `AI_MODEL_LITE` | `llama-3.1-8b-instant` |
| El Pro (seimbang) | `AI_MODEL_PRO` atau `AI_MODEL` | `llama-3.3-70b-versatile` |
| El Max (terpintar) | `AI_MODEL_MAX` | `openai/gpt-oss-120b` |

Pilihan pengguna disimpan di browser. Kalau satu model tidak tersedia di akunmu, server otomatis mencari model lain yang boleh dipakai.

## Ubah foto jadi PDF / Word

Lampirkan foto (maks. 3), lalu ketuk **Jadikan PDF** / **Jadikan Word** di atas kolom ketik, atau ketik "jadikan pdf", "ubah ke word", dll.

- **PDF**: tiap foto jadi satu halaman A4. Dibuat langsung di browser, tanpa API.
- **Word (.docx)**: AI membaca teks pada foto (OCR) lalu disusun jadi dokumen yang bisa diedit. Jika tidak ada tulisan atau gagal dibaca, foto ditempel apa adanya. Ketik "jadikan word sebagai gambar" untuk memaksa foto ditempel.
- File hanya tersedia lewat tombol unduh sesaat setelah dibuat.

## Jalankan lokal

```bash
npm i -g vercel
cp .env.example .env     # isi AI_API_KEY
vercel dev
```

## Mengubah identitas / jawaban "Apa itu El Ai?"

Edit konstanta `SYSTEM_PROMPT` di `api/chat.js`.

## Keamanan

- Jangan menaruh API key di kode atau commit file `.env`. Key hanya disimpan di Environment Variables Vercel.
- Endpoint `/api/chat` bisa dipanggil siapa saja yang tahu URL-nya, jadi pakai key dengan batas kuota/biaya.

## Lampiran

- **Foto** (maks 3 per pesan): dikompres di browser lalu dikirim ke model gambar (`AI_VISION_MODEL`). Model itu harus diizinkan di akun Groq kamu.
- **PDF** (yang berisi teks) dan **file teks/kode** (txt, md, csv, json, js, py, dst.): isinya dibaca di browser lalu disisipkan ke pesan. Dibatasi sekitar 12.000 karakter per file.
- PDF hasil scan tidak punya teks; kirim sebagai foto.
- Foto hanya disimpan di memori selama halaman terbuka (riwayat hanya menyimpan thumbnail).

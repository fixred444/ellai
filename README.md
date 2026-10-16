# El Ai

Website chat AI berbahasa Indonesia dengan tampilan *liquid glass*: sidebar riwayat obrolan, jawaban streaming, mode gelap/terang, render Markdown + blok kode, dan lampiran (foto, PDF, file teks/kode).

Tanpa build step: HTML/CSS/JS statis + satu serverless function (`api/chat.js`) yang menyimpan API key dengan aman di server.

## Struktur

```
index.html, style.css, app.js, markdown.js, favicon.svg   -> tampilan
api/*.js, lib/*.js                                         -> backend (Vercel Functions)
masuk.html, auth.*, admin.*, account.js                    -> login, panel admin, akun
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

Lampirkan foto (maks. 10 untuk PDF/Word; untuk tanya jawab tetap maks. 3), lalu ketuk **Jadikan PDF** / **Jadikan Word** di atas kolom ketik, atau ketik "jadikan pdf", "ubah ke word", dll.

- **PDF**: tiap foto jadi satu halaman A4. Dibuat langsung di browser, tanpa API.
- **Word (.docx)**: AI membaca teks pada foto (OCR) lalu disusun jadi dokumen yang bisa diedit. Jika tidak ada tulisan atau gagal dibaca, foto ditempel apa adanya. Ketik "jadikan word sebagai gambar" untuk memaksa foto ditempel.
- File hanya tersedia lewat tombol unduh sesaat setelah dibuat.

## Mode Belajar (rekam suara, lalu rangkum)

Buka lewat tombol **Mode Belajar** di sidebar atau di halaman awal. Ketuk mikrofon untuk merekam; suara diubah jadi teks langsung, lalu pilih bentuk hasil (ringkasan, catatan lengkap, poin penting + istilah, atau soal latihan) dan ketuk **Rangkum**.

- Pengenalan suara memakai fitur bawaan browser (Chrome), jadi butuh internet dan izin mikrofon. Tidak memakai kuota API.
- Teks rekaman bisa diedit dan otomatis tersimpan sebagai draf, jadi aman kalau halaman tertutup.
- Rekaman panjang dirangkum bertahap (dipotong per bagian lalu digabung), jadi kuliah berjam-jam tetap bisa.
- Hasil bisa disalin, diunduh sebagai Word, atau disimpan ke riwayat obrolan.


## Login, kuota harian, dan panel admin

Halaman: `/masuk` (masuk & daftar), `/` (chat, wajib login), `/admin` (khusus admin).

**Setup wajib di Vercel** (Settings → Environment Variables):

1. Pasang database: Storage → Marketplace → **Upstash Redis** (paket gratis cukup), hubungkan ke proyek. Variabel `KV_REST_API_URL` / `KV_REST_API_TOKEN` terisi otomatis.
2. `SESSION_SECRET` = teks acak panjang (min. 16 karakter).
3. `ADMIN_EMAIL` dan `ADMIN_PASSWORD` = login akun admin. Ganti kata sandi admin cukup dengan mengubah variabel ini lalu redeploy.

**Lupa kata sandi**: di halaman masuk ada tautan "Lupa kata sandi?". Pengguna memasukkan email, menerima kode 6 angka (berlaku 10 menit, maks. 5 kali salah, kirim ulang tiap 60 detik), lalu mengatur kata sandi baru. Setelah direset, semua sesi login lama otomatis keluar. Fitur ini aktif setelah admin mengisi email pengirim di panel admin. Akun admin tidak bisa direset lewat OTP: ganti `ADMIN_PASSWORD` di Vercel lalu redeploy.

**Kuota**: tiap akun gratis dapat 100 token/hari (reset 00.00 WIB). El Lite memakai 5 token per pesan, El Pro 10, El Max 15. Dicek di server (`api/chat.js`), jadi tidak bisa dilewati dari browser. Pesan yang gagal di sisi AI otomatis dikembalikan tokennya.

**Panel admin** (`/admin`):
- *Pengguna*: bekukan, nonaktifkan karena usia, minta verifikasi, aktifkan kembali, tandai terverifikasi, atur batas kuota khusus, reset pemakaian, beri/cabut paket, hapus akun.
- *Banding*: akun yang beku/nonaktif/butuh verifikasi melihat layar khusus berisi formulir banding atau verifikasi. Admin menyetujui (akun aktif lagi) atau menolak dengan catatan.
- *Pembayaran*: pengguna menekan **Beli**, melihat nomor DANA/GoPay dan foto QRIS, lalu wajib mengunggah foto bukti transfer. Admin membuka foto buktinya, menekan Konfirmasi, dan paket aktif (kuota harian naik). Konfirmasi ditolak kalau bukti belum diunggah.
- *Harga & kuota*: ubah nomor DANA, nomor GoPay, nama penerima, dan foto QRIS, juga harga, diskon (persen + tanggal berakhir), kuota pelanggan, kuota gratis, biaya token tiap tingkatan, usia minimum daftar, dan teks petunjuk pembayaran.
- *Email*: isi Gmail pengirim dan App Password (disimpan terenkripsi, tidak pernah ditampilkan lagi), lalu tekan "Kirim email tes". Dipakai untuk mengirim kode OTP reset kata sandi.
- *Log*: riwayat tindakan admin.

Pembayaran saat ini manual (pengguna transfer dan unggah bukti, admin konfirmasi). Foto QRIS dan bukti disimpan di database (dikompres di browser, maks. sekitar 330 KB per foto). Payment gateway otomatis (Midtrans/Xendit) belum dipasang.

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

- **Foto** (maks 3 per pesan untuk tanya jawab; sampai 10 untuk Jadikan PDF/Word, ubah `MAX_CONVERT_IMAGES` di app.js): dikompres di browser lalu dikirim ke model gambar (`AI_VISION_MODEL`). Model itu harus diizinkan di akun Groq kamu.
- **PDF** (yang berisi teks) dan **file teks/kode** (txt, md, csv, json, js, py, dst.): isinya dibaca di browser lalu disisipkan ke pesan. Dibatasi sekitar 12.000 karakter per file.
- PDF hasil scan tidak punya teks; kirim sebagai foto.
- Foto hanya disimpan di memori selama halaman terbuka (riwayat hanya menyimpan thumbnail).

## Tampilan Liquid Glass & Pratinjau HTML

- `glass.css` adalah lapisan tampilan kaca (dimuat setelah `style.css` dan `auth.css`). Hapus tag `<link>`-nya di `index.html` / `masuk.html` untuk kembali ke gaya datar. Warna dan bahan diatur lewat variabel di bagian atas file.
- `preview.js`: blok kode `html`/`svg` di jawaban AI otomatis punya tombol **Pratinjau**. Hasilnya tampil di `<iframe sandbox>` tanpa `allow-same-origin`, jadi tidak bisa membaca akun/cookie El Ai. Ada tombol ukuran ponsel/penuh, muat ulang, dan unduh `.html`. Blok `css`/`js` terpisah di jawaban yang sama otomatis digabung jika HTML memanggil `style.css`/`script.js`.
- System prompt di `api/chat.js` meminta El Ai menulis satu file HTML lengkap untuk permintaan halaman web, supaya pratinjau langsung jalan.

### Unduh jawaban jadi Word / PDF
- Ketik misalnya "buatkan materi perkecambahan dalam Word" (atau PDF / keduanya). El Ai menulis materinya (batas jawaban dinaikkan jadi 4096 token), lalu muncul tombol **Unduh PDF / Unduh Word**.
- Ketik "jadikan pdf" / "ubah ke word" tanpa foto: jawaban El Ai yang terakhir dijadikan file (tidak memakai kuota lagi).
- Di bawah setiap jawaban juga ada tombol kecil **PDF** dan **Word** kapan saja.
- File dibuat di browser (convert.js): judul, daftar, tabel, kode, dan nomor halaman. Rumus LaTeX diubah jadi teks biasa; emoji dan simbol langka tidak tampil di PDF.
- Jadikan Word dari foto memakai OCR: tiap foto = 1 permintaan AI (memotong kuota), jadi jumlah foto dibatasi 10.

### Verifikasi email saat daftar (OTP)
- Daftar sekarang 2 langkah: isi formulir, lalu masukkan kode 6 angka yang dikirim ke email. Akun baru dibuat HANYA setelah kode benar (data sementara disimpan dengan kata sandi yang sudah di-hash).
- Kode berlaku 10 menit, maks. 5 kali salah, kirim ulang tiap 60 detik, maks. 5 kode per email per jam.
- Memakai email pengirim yang sama dengan fitur lupa kata sandi (panel admin, Gmail + App Password). **Kalau email pengirim belum diatur, pendaftaran ditolak** dengan pesan untuk menghubungi admin, jadi atur dulu sebelum deploy.
- Akun yang daftar lewat OTP ditandai "Terverifikasi lewat kode OTP" di panel admin. Akun lama tetap bisa masuk seperti biasa.

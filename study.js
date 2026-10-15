/* El Ai — Mode Belajar: rekam suara -> teks -> rangkuman.
 * Suara diubah jadi teks oleh pengenal suara bawaan browser (Chrome), lalu teksnya dirangkum AI.
 * Dipakai: ElStudy.init({ toast, getTier, stream, render, save }) lalu ElStudy.open()
 */
(function () {
  'use strict';

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const DRAFT_KEY = 'elai.study.draft';
  const CHUNK = 7000;            // panjang satu potongan saat teks sangat panjang
  const DIRECT_MAX = 9000;       // sampai segini langsung dirangkum sekaligus

  const CAVEAT =
    'Catatan: teks di bawah berasal dari rekaman suara (pengenalan suara otomatis), jadi bisa ada salah dengar, kata terpotong, atau tanpa tanda baca. ' +
    'Perbaiki dengan konteks, tetapi jangan menambah fakta yang tidak disebutkan. Tulis dalam bahasa Indonesia yang rapi, kecuali istilah asing yang memang dipakai.';

  const STYLES = {
    ringkas: {
      label: 'Ringkasan singkat',
      prompt: 'Rangkum materi berikut menjadi ringkasan yang jelas dan padat. Mulai dengan judul (##), lalu poin-poin utama, dan tutup dengan satu paragraf kesimpulan.',
    },
    catatan: {
      label: 'Catatan belajar lengkap',
      prompt: 'Ubah materi berikut menjadi catatan belajar yang rapi dan terstruktur: judul (##), sub-judul (###) per topik, poin penting, definisi, contoh, angka/rumus bila disebut, dan di akhir bagian "Yang perlu diingat".',
    },
    istilah: {
      label: 'Poin penting + daftar istilah',
      prompt: 'Dari materi berikut, tulis (1) judul (##), (2) 6-10 poin terpenting, dan (3) daftar istilah kunci beserta artinya dalam bahasa sederhana.',
    },
    kuis: {
      label: 'Soal latihan',
      prompt: 'Berdasarkan materi berikut, buat 8 soal pilihan ganda (A-D) dan 3 soal uraian singkat. Beri judul (##). Tuliskan kunci jawaban dan penjelasan singkatnya di bagian terpisah setelah semua soal.',
    },
  };

  let ctx = null;
  let root = null;
  let ui = {};
  let rec = null;
  let want = false;          // pengguna ingin merekam
  let active = false;        // pengenal suara sedang berjalan
  let errCount = 0;
  let lastFinal = '';
  let sec = 0;
  let timer = 0;
  let wake = null;
  let busy = false;
  let controller = null;
  let result = '';
  let saveTimer = 0;

  const $ = (k) => root.querySelector('[data-s="' + k + '"]');
  const fmt = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

  /* ---------- tampilan ---------- */
  function build() {
    root = document.createElement('div');
    root.className = 'study';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Mode Belajar');
    root.innerHTML =
      '<header class="study-head">' +
        '<button type="button" class="icon-btn" data-s="close" aria-label="Tutup"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>' +
        '<h2>Mode Belajar</h2>' +
        '<select data-s="lang" aria-label="Bahasa suara"><option value="id-ID">Indonesia</option><option value="en-US">English</option></select>' +
      '</header>' +
      '<div class="study-body">' +
        '<section class="study-rec">' +
          '<button type="button" class="rec-btn" data-s="rec" aria-label="Mulai merekam">' +
            '<svg class="i-mic" viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>' +
            '<svg class="i-pause" viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>' +
          '</button>' +
          '<div class="rec-time" data-s="time">00:00</div>' +
          '<div class="rec-status" data-s="status"></div>' +
        '</section>' +
        '<section class="study-text">' +
          '<div class="study-row"><label for="studyText">Teks rekaman</label><span class="study-count" data-s="count">0 kata</span></div>' +
          '<textarea id="studyText" data-s="text" rows="7" placeholder="Hasil rekaman suara muncul di sini. Kamu juga bisa mengetik, menempel, atau memperbaiki teksnya."></textarea>' +
          '<div class="study-interim" data-s="interim" aria-live="polite"></div>' +
          '<div class="study-row study-mini"><button type="button" data-s="copy">Salin teks</button><button type="button" data-s="clear">Hapus semua</button></div>' +
        '</section>' +
        '<section class="study-make">' +
          '<label for="studyStyle">Bentuk hasil</label>' +
          '<select id="studyStyle" data-s="style">' +
            Object.keys(STYLES).map((k) => '<option value="' + k + '">' + STYLES[k].label + '</option>').join('') +
          '</select>' +
          '<button type="button" class="study-go" data-s="go">Rangkum</button>' +
        '</section>' +
        '<section class="study-out" data-s="out" hidden>' +
          '<div class="study-prog" data-s="prog" aria-live="polite"></div>' +
          '<div class="content" data-s="result"></div>' +
          '<div class="study-actions" data-s="actions" hidden>' +
            '<button type="button" data-s="copyOut">Salin</button>' +
            '<button type="button" data-s="docx">Unduh Word</button>' +
            '<button type="button" data-s="keep">Simpan ke riwayat</button>' +
          '</div>' +
        '</section>' +
      '</div>' +
      '<p class="study-note">Suara diubah jadi teks oleh layanan pengenal suara di browser (Chrome), jadi butuh internet dan izin mikrofon. Jaga layar tetap menyala saat merekam.</p>';
    document.body.appendChild(root);

    ui = {
      text: $('text'), interim: $('interim'), count: $('count'), time: $('time'), status: $('status'),
      rec: $('rec'), lang: $('lang'), style: $('style'), go: $('go'), out: $('out'), prog: $('prog'),
      result: $('result'), actions: $('actions'),
    };

    $('close').addEventListener('click', close);
    ui.rec.addEventListener('click', () => (want ? stopRec() : startRec()));
    ui.text.addEventListener('input', () => { updateCount(); queueSave(); });
    ui.lang.addEventListener('change', () => { queueSave(); if (want) { stopRec(); startRec(); } });
    $('copy').addEventListener('click', () => copy(ui.text.value));
    $('clear').addEventListener('click', () => {
      if (!ui.text.value.trim() || confirm('Hapus semua teks rekaman?')) {
        ui.text.value = ''; lastFinal = ''; sec = 0; ui.time.textContent = fmt(0);
        updateCount(); queueSave();
      }
    });
    ui.go.addEventListener('click', () => (busy ? abort() : summarize()));
    $('copyOut').addEventListener('click', () => copy(result));
    $('docx').addEventListener('click', downloadDocx);
    $('keep').addEventListener('click', keep);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) close(); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && want && !active) startEngine();
      if (!document.hidden && want) requestWake();
    });
  }

  function setUi() {
    root.classList.toggle('recording', want);
    ui.rec.setAttribute('aria-label', want ? 'Jeda rekaman' : 'Mulai merekam');
    if (!SR) ui.status.textContent = 'Browser ini belum bisa merekam suara. Buka lewat Chrome, atau ketik/tempel teksnya di bawah.';
    else ui.status.textContent = want ? (active ? 'Mendengarkan… bicaralah seperti biasa' : 'Menyambung ulang…') : (ui.text.value.trim() ? 'Dijeda. Ketuk mikrofon untuk lanjut merekam' : 'Ketuk mikrofon untuk mulai merekam');
  }

  function updateCount() {
    const n = words(ui.text.value);
    ui.count.textContent = n + ' kata';
  }

  function toast(m) { if (ctx && ctx.toast) ctx.toast(m); }

  async function copy(t) {
    if (!t || !t.trim()) { toast('Belum ada teks.'); return; }
    try { await navigator.clipboard.writeText(t); toast('Disalin.'); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Disalin.'); } catch { toast('Tidak bisa menyalin.'); }
      ta.remove();
    }
  }

  /* ---------- draf tersimpan ---------- */
  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 500);
  }
  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: ui.text.value, sec, lang: ui.lang.value })); } catch {}
  }
  function restoreDraft() {
    if (ui.text.value) return;
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (d) {
        ui.text.value = d.text || '';
        sec = d.sec || 0;
        if (d.lang) ui.lang.value = d.lang;
      }
    } catch {}
    ui.time.textContent = fmt(sec);
    updateCount();
  }

  /* ---------- rekam suara ---------- */
  function addFinal(t) {
    t = (t || '').trim();
    if (!t) return;
    const v = ui.text.value;
    // Sebagian browser (Android) mengirim hasil kumulatif: segmen baru diawali segmen sebelumnya -> ganti, jangan tambah.
    if (lastFinal && t.toLowerCase().startsWith(lastFinal.toLowerCase()) && v.endsWith(lastFinal)) {
      ui.text.value = v.slice(0, v.length - lastFinal.length) + t;
    } else {
      ui.text.value = v + (v && !/\s$/.test(v) ? ' ' : '') + t;
    }
    lastFinal = t;
    ui.text.scrollTop = ui.text.scrollHeight;
    updateCount(); queueSave();
  }

  function startEngine() {
    if (!SR || !want) return;
    if (!rec) {
      rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onstart = () => { active = true; setUi(); };
      rec.onresult = (e) => {
        errCount = 0;
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const t = r[0] && r[0].transcript ? r[0].transcript : '';
          if (r.isFinal) addFinal(t); else interim += t + ' ';
        }
        ui.interim.textContent = interim.trim();
      };
      rec.onerror = (e) => {
        const code = e && e.error;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          want = false;
          toast('Izin mikrofon ditolak. Ketuk ikon gembok di sebelah alamat website → Izin → Mikrofon → Izinkan.');
        } else if (code === 'audio-capture') {
          want = false;
          toast('Mikrofon tidak terdeteksi atau sedang dipakai aplikasi lain.');
        } else if (code === 'network') {
          errCount++;
          toast('Pengenal suara butuh koneksi internet.');
        } else if (code !== 'no-speech' && code !== 'aborted') {
          errCount++;
        }
        if (errCount >= 5) { want = false; toast('Rekaman dihentikan karena pengenal suara terus gagal. Coba lagi sebentar.'); }
      };
      rec.onend = () => {
        active = false;
        ui.interim.textContent = '';
        if (want) setTimeout(() => { if (want) startEngine(); }, 250);
        else finishRec();
        setUi();
      };
    }
    rec.lang = ui.lang.value || 'id-ID';
    try { rec.start(); } catch { /* sudah berjalan */ }
  }

  async function requestWake() {
    try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch {}
  }
  function releaseWake() { try { if (wake) wake.release(); } catch {} wake = null; }

  function startRec() {
    if (!SR) { toast('Browser ini belum bisa merekam suara. Gunakan Chrome.'); setUi(); return; }
    want = true; errCount = 0; lastFinal = '';
    clearInterval(timer);
    timer = setInterval(() => { if (want && active) { sec++; ui.time.textContent = fmt(sec); } }, 1000);
    requestWake();
    startEngine();
    setUi();
  }

  function stopRec() {
    want = false;
    try { if (rec) rec.stop(); } catch {}
    finishRec();
    setUi();
  }

  function finishRec() {
    clearInterval(timer);
    releaseWake();
    saveDraft();
  }

  /* ---------- merangkum ---------- */
  function splitChunks(text, size) {
    const out = [];
    let rest = text.trim();
    while (rest.length > size) {
      let cut = rest.lastIndexOf('. ', size);
      if (cut < size * 0.5) cut = rest.lastIndexOf(' ', size);
      if (cut < size * 0.3) cut = size;
      out.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) out.push(rest);
    return out;
  }

  function abort() { if (controller) controller.abort(); }

  function setBusy(b) {
    busy = b;
    ui.go.textContent = b ? 'Batalkan' : 'Rangkum';
    ui.go.classList.toggle('busy', b);
  }

  let paintAt = 0;
  function paint(md, force) {
    const now = Date.now();
    if (!force && now - paintAt < 80) return;
    paintAt = now;
    ui.result.innerHTML = ctx.render(md);
  }

  async function summarize() {
    if (want) stopRec();
    const raw = ui.text.value.trim();
    if (raw.length < 80) { toast('Teks rekaman masih terlalu pendek untuk dirangkum.'); return; }

    const style = STYLES[ui.style.value] || STYLES.ringkas;
    ui.out.hidden = false;
    ui.actions.hidden = true;
    ui.result.innerHTML = '';
    result = '';
    ui.out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setBusy(true);
    controller = new AbortController();

    try {
      let material = raw;
      if (raw.length > DIRECT_MAX) {
        const parts = splitChunks(raw, CHUNK);
        const notes = [];
        for (let i = 0; i < parts.length; i++) {
          ui.prog.textContent = 'Membaca bagian ' + (i + 1) + ' dari ' + parts.length + '…';
          const prompt = 'Ini bagian ke-' + (i + 1) + ' dari ' + parts.length + ' sebuah rekaman belajar yang panjang. ' + CAVEAT +
            '\n\nTulis catatan padat (maksimal sekitar 300 kata) berisi semua topik, definisi, angka, nama, dan contoh penting dari bagian ini, tanpa kalimat pembuka.\n\n---\n' + parts[i];
          notes.push(await ctx.stream([{ role: 'user', content: prompt }], null, controller.signal));
        }
        material = notes.map((n, i) => '### Bagian ' + (i + 1) + '\n' + n).join('\n\n');
      }

      ui.prog.textContent = 'Menyusun ' + style.label.toLowerCase() + '…';
      const prompt = style.prompt + '\n\n' + CAVEAT + '\n\n---\n' + material;
      let out = '';
      out = await ctx.stream([{ role: 'user', content: prompt }], (d) => { out += d; paint(out, false); }, controller.signal);
      result = out.trim();
      if (!result) throw new Error('El Ai tidak mengirim jawaban. Coba rangkum lagi.');
      paint(result, true);
      ui.prog.textContent = '';
      ui.actions.hidden = false;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        ui.prog.textContent = 'Dibatalkan.';
      } else {
        ui.prog.textContent = 'Maaf, gagal merangkum: ' + ((err && err.message) || 'terjadi kesalahan jaringan.');
      }
    }
    setBusy(false);
    controller = null;
  }

  /* ---------- hasil ---------- */
  function downloadDocx() {
    if (!result) return;
    try {
      const data = window.ElConvert.buildDocxFromText([result]);
      const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Rangkuman-El-Ai-' + new Date().toISOString().slice(0, 10) + '.docx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch { toast('Gagal membuat file Word.'); }
  }

  function keep() {
    if (!result) return;
    const style = STYLES[ui.style.value] || STYLES.ringkas;
    const first = (result.split('\n').find((l) => l.trim()) || '').replace(/[#*_`>]/g, '').trim();
    const mins = Math.round(sec / 60);
    ctx.save({
      title: 'Belajar: ' + (first || style.label).slice(0, 36),
      request: 'Rangkum rekaman belajar' + (mins ? ' (' + mins + ' menit)' : '') + ' — ' + style.label + '. Jumlah teks: ' + words(ui.text.value) + ' kata.',
      answer: result,
    });
    close();
    toast('Disimpan ke riwayat.');
  }

  /* ---------- buka / tutup ---------- */
  function open() {
    if (!ctx) return;
    if (!root) build();
    root.hidden = false;
    document.body.classList.add('study-open');
    restoreDraft();
    setUi();
  }

  function close() {
    if (want) { stopRec(); toast('Rekaman dihentikan. Teksnya tetap tersimpan.'); }
    if (busy) abort();
    saveDraft();
    root.hidden = true;
    document.body.classList.remove('study-open');
  }

  window.ElStudy = { init: (c) => { ctx = c; }, open, close, _splitChunks: splitChunks };
})();

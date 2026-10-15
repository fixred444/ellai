(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const el = {
    app: $('.app'), sidebar: $('#sidebar'), overlay: $('#overlay'), list: $('#chatList'),
    chat: $('#chat'), thread: $('#thread'), welcome: $('#welcome'), greeting: $('#greeting'),
    form: $('#composer'), input: $('#input'), send: $('#send'), title: $('#topTitle'),
    themeBtn: $('#themeBtn'), themeLabel: $('#themeLabel'),
    tierBtn: $('#tierBtn'), tierLabel: $('#tierLabel'), tierMenu: $('#tierMenu'),
    lightBtn: $('#lightBtn'), lightBar: $('#lightBar'), lightOffBtn: $('#lightOff'),
    attachBtn: $('#attachBtn'), fileInput: $('#fileInput'), tray: $('#tray'), toast: $('#toast'),
  };

  const STORE = 'elai.chats.v1';
  const MAX_CHATS = 40;
  const MAX_ATTACH = 5;          // total lampiran per pesan
  const MAX_IMAGES = 3;          // batas gambar per permintaan
  const MAX_FILE_BYTES = 15 * 1024 * 1024;
  const MAX_CHARS_PER_FILE = 12000;
  const MAX_CHARS_TOTAL = 30000;
  const MAX_IMAGE_TOTAL = 3.4e6; // total karakter data URL gambar (batas body Vercel ~4.5MB)

  const FILE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>';

  let chats = [];
  let currentId = null;
  let busy = false;
  let controller = null;
  let pending = [];                // lampiran yang belum dikirim
  const imgStore = new WeakMap();  // pesan -> data URL gambar penuh (hanya di memori)

  /* ---------- util ---------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  // Beberapa model "berpikir" mengirim <think>…</think>; bagian itu disembunyikan.
  const clean = (s) => s.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');

  let toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3800);
  }

  /* ---------- storage ---------- */
  function load() {
    try { chats = JSON.parse(localStorage.getItem(STORE)) || []; } catch { chats = []; }
    if (!Array.isArray(chats)) chats = [];
  }
  function save() {
    const trySave = () => localStorage.setItem(STORE, JSON.stringify(chats.slice(0, MAX_CHATS)));
    try { trySave(); return; } catch {}
    // Penyimpanan penuh: buang isi file dari obrolan lama lalu coba lagi.
    try {
      [...chats].sort((a, b) => b.updated - a.updated).slice(3).forEach((c) => {
        c.messages.forEach((m) => { if (m.files) m.files.forEach((f) => { f.text = ''; }); });
      });
      trySave();
    } catch {}
  }
  const current = () => chats.find((c) => c.id === currentId) || null;

  function createChat() {
    const chat = { id: uid(), title: 'Obrolan baru', messages: [], updated: Date.now() };
    chats.unshift(chat);
    currentId = chat.id;
    return chat;
  }

  /* ---------- theme ---------- */
  function applyThemeLabel() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    el.themeLabel.textContent = dark ? 'Mode terang' : 'Mode gelap';
  }
  el.themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('elai.theme', next); } catch {}
    applyThemeLabel();
  });

  /* ---------- sidebar ---------- */
  const openSide = () => { el.sidebar.classList.add('open'); el.overlay.classList.add('show'); };
  const closeSide = () => { el.sidebar.classList.remove('open'); el.overlay.classList.remove('show'); };
  $('#openSide').addEventListener('click', openSide);
  $('#closeSide').addEventListener('click', closeSide);
  el.overlay.addEventListener('click', closeSide);

  function renderSidebar() {
    el.list.innerHTML = '';
    if (!chats.length) {
      const d = document.createElement('div');
      d.className = 'chat-empty';
      d.textContent = 'Belum ada obrolan.';
      el.list.appendChild(d);
      return;
    }
    [...chats].sort((a, b) => b.updated - a.updated).forEach((c) => {
      const row = document.createElement('div');
      row.className = 'chat-item' + (c.id === currentId ? ' active' : '');
      const open = document.createElement('button');
      open.className = 'chat-open'; open.type = 'button'; open.dataset.id = c.id; open.textContent = c.title; open.title = c.title;
      const del = document.createElement('button');
      del.className = 'chat-del'; del.type = 'button'; del.dataset.del = c.id; del.setAttribute('aria-label', 'Hapus obrolan');
      del.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg>';
      row.append(open, del);
      el.list.appendChild(row);
    });
  }

  el.list.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      if (busy && del.dataset.del === currentId) stop();
      chats = chats.filter((c) => c.id !== del.dataset.del);
      if (currentId === del.dataset.del) currentId = null;
      save(); renderSidebar(); renderThread();
      return;
    }
    const open = e.target.closest('[data-id]');
    if (open && open.dataset.id !== currentId) {
      if (busy) stop();
      currentId = open.dataset.id;
      renderSidebar(); renderThread(); closeSide();
    } else if (open) {
      closeSide();
    }
  });

  $('#newChat').addEventListener('click', () => {
    if (busy) stop();
    currentId = null;
    renderSidebar(); renderThread(); closeSide();
    el.input.focus();
  });

  /* ---------- rendering ---------- */
  function greetingText() {
    const h = new Date().getHours();
    const part = h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
    return part + ', ada yang bisa El bantu?';
  }

  function attsEl(m) {
    const items = m.atts || [];
    if (!items.length) return null;
    const box = document.createElement('div');
    box.className = 'atts';
    items.forEach((a) => {
      if (a.kind === 'image' && a.thumb) {
        const img = document.createElement('img');
        img.className = 'att-img'; img.src = a.thumb; img.alt = a.name || 'gambar';
        box.appendChild(img);
      } else {
        const chip = document.createElement('div');
        chip.className = 'att-file';
        chip.innerHTML = FILE_ICON;
        const name = document.createElement('span');
        name.textContent = a.name || 'file';
        chip.appendChild(name);
        box.appendChild(chip);
      }
    });
    return box;
  }

  function modelTag(m) {
    if (!m || !m.model) return null;
    const t = document.createElement('span');
    t.className = 'msg-model' + (m.fallback ? ' warn' : '');
    t.textContent = (m.tierName ? m.tierName + ' · ' : '') + m.model + (m.fallback ? ' (model cadangan)' : '');
    return t;
  }

  function messageEl(m) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + m.role;
    if (m.role === 'user') {
      const atts = attsEl(m);
      if (atts) wrap.appendChild(atts);
      if (m.content) {
        const b = document.createElement('div');
        b.className = 'bubble';
        b.textContent = m.content;
        wrap.appendChild(b);
      }
    } else {
      const logo = document.createElement('span');
      logo.className = 'logo'; logo.textContent = 'El';
      const body = document.createElement('div');
      body.className = 'msg-body';
      const content = document.createElement('div');
      content.className = 'content';
      content.innerHTML = window.ElMd.render(clean(m.content));
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.innerHTML = '<button type="button" class="act" data-copy-msg>Salin</button>';
      const tag = modelTag(m);
      if (tag) actions.appendChild(tag);
      body.append(content, actions);
      wrap.append(logo, body);
    }
    return wrap;
  }

  function renderThread() {
    const chat = current();
    el.thread.innerHTML = '';
    if (!chat || !chat.messages.length) {
      el.welcome.hidden = false;
      el.greeting.textContent = greetingText();
      el.title.textContent = 'El Ai';
      return;
    }
    el.welcome.hidden = true;
    el.title.textContent = chat.title;
    chat.messages.forEach((m) => el.thread.appendChild(messageEl(m)));
    scrollDown(true);
  }

  function nearBottom() {
    return el.chat.scrollHeight - el.chat.scrollTop - el.chat.clientHeight < 140;
  }
  function scrollDown(force) {
    if (force || nearBottom()) el.chat.scrollTo({ top: el.chat.scrollHeight, behavior: 'auto' });
  }

  /* ---------- lampiran: pemrosesan ---------- */
  const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|ya?ml|log|html?|css|m?js|jsx?|tsx?|py|java|c|h|cpp|cs|go|rs|php|rb|sql|sh|ini|toml|env)$/i;

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  async function compressImage(file) {
    const { img, url } = await loadImage(file);
    const draw = (max, q) => {
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * s));
      const h = Math.max(1, Math.round(img.naturalHeight * s));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', q);
    };
    let dataUrl = draw(1280, 0.82);
    if (dataUrl.length > 1.2e6) dataUrl = draw(1024, 0.7);
    const thumb = draw(160, 0.72);
    URL.revokeObjectURL(url);
    return { dataUrl, thumb };
  }

  let pdfPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfPromise) {
      pdfPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        s.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          resolve(window.pdfjsLib);
        };
        s.onerror = () => { pdfPromise = null; reject(new Error('pdfjs')); };
        document.head.appendChild(s);
      });
    }
    return pdfPromise;
  }

  async function extractPdf(file, limit) {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    const pages = Math.min(pdf.numPages, 60);
    for (let p = 1; p <= pages && text.length < limit + 500; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((i) => i.str).join(' ') + '\n\n';
    }
    return { text: text.trim(), truncated: pdf.numPages > pages };
  }

  const usedChars = () => pending.reduce((n, a) => n + (a.kind === 'text' && a.text ? a.text.length : 0), 0);
  const usedImageChars = () => pending.reduce((n, a) => n + (a.kind === 'image' && a.dataUrl ? a.dataUrl.length : 0), 0);

  async function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    for (const file of files) {
      if (pending.length >= MAX_ATTACH) { toast('Maksimal ' + MAX_ATTACH + ' lampiran per pesan.'); break; }
      if (file.size > MAX_FILE_BYTES) { toast(file.name + ' terlalu besar (maks 15 MB).'); continue; }

      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const isText = file.type.startsWith('text/') || TEXT_EXT.test(file.name) || file.type === 'application/json';

      if (!isImage && !isPdf && !isText) {
        toast('Format ' + (file.name.split('.').pop() || 'ini') + ' belum didukung. Gunakan foto, PDF, atau file teks/kode.');
        continue;
      }
      if (isImage && pending.filter((a) => a.kind === 'image').length >= MAX_IMAGES) {
        toast('Maksimal ' + MAX_IMAGES + ' gambar per pesan.');
        continue;
      }

      const item = { id: uid(), name: file.name, loading: true, kind: isImage ? 'image' : 'text' };
      if (isImage) item.file = file;
      pending.push(item);
      renderTray();

      try {
        if (isImage) {
          const { dataUrl, thumb } = await compressImage(file);
          if (usedImageChars() + dataUrl.length > MAX_IMAGE_TOTAL) throw new Error('Total ukuran gambar terlalu besar. Kirim lebih sedikit gambar sekaligus.');
          Object.assign(item, { dataUrl, thumb });
        } else {
          let text, truncated = false;
          if (isPdf) {
            const r = await extractPdf(file, MAX_CHARS_PER_FILE);
            text = r.text; truncated = r.truncated;
            if (!text) throw new Error('PDF ini tidak berisi teks yang bisa dibaca (mungkin hasil scan). Coba kirim sebagai foto.');
          } else {
            text = await file.text();
            if (text.includes('\u0000')) throw new Error(file.name + ' bukan file teks.');
          }
          const room = Math.max(0, MAX_CHARS_TOTAL - usedChars());
          const limit = Math.min(MAX_CHARS_PER_FILE, room);
          if (limit < 200) throw new Error('Isi file yang dilampirkan sudah terlalu banyak untuk satu pesan.');
          if (text.length > limit) { text = text.slice(0, limit); truncated = true; }
          Object.assign(item, { text, truncated });
          if (truncated) toast(file.name + ' panjang, hanya bagian awalnya yang dibaca.');
        }
        item.loading = false;
      } catch (err) {
        pending = pending.filter((a) => a !== item);
        toast(err && err.message && err.message !== 'decode' && err.message !== 'pdfjs'
          ? err.message
          : isImage ? 'Gambar ' + file.name + ' tidak bisa dibuka (format HEIC belum didukung).' : 'Gagal membaca ' + file.name + '.');
      }
      renderTray();
    }
    syncSend();
  }

  function renderTray() {
    el.tray.innerHTML = '';
    el.tray.hidden = pending.length === 0;
    pending.forEach((a) => {
      const box = document.createElement('div');
      box.className = 'tray-item' + (a.loading ? ' loading' : '');
      if (a.kind === 'image' && a.thumb) {
        const img = document.createElement('img');
        img.src = a.thumb; img.alt = a.name;
        box.appendChild(img);
      } else {
        const f = document.createElement('div');
        f.className = 'tray-file';
        f.innerHTML = FILE_ICON + '<div class="meta"><span class="name"></span><span class="sub"></span></div>';
        f.querySelector('.name').textContent = a.name;
        f.querySelector('.sub').textContent = a.loading ? 'Membaca…' : (a.kind === 'image' ? 'Memproses…' : (a.truncated ? 'Sebagian dibaca' : 'Siap'));
        box.appendChild(f);
      }
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'tray-x'; x.dataset.rm = a.id; x.setAttribute('aria-label', 'Hapus lampiran');
      x.textContent = '×';
      box.appendChild(x);
      el.tray.appendChild(box);
    });
    if (pending.some((a) => a.kind === 'image' && a.file) && !pending.some((a) => a.loading)) {
      const cv = document.createElement('div');
      cv.className = 'tray-convert';
      cv.innerHTML = '<button type="button" class="conv-btn" data-convert="Jadikan PDF">Jadikan PDF</button><button type="button" class="conv-btn" data-convert="Jadikan Word">Jadikan Word</button>';
      el.tray.appendChild(cv);
    }
  }

  el.tray.addEventListener('click', (e) => {
    const cv = e.target.closest('[data-convert]');
    if (cv) { el.input.value = cv.dataset.convert; autosize(); el.form.requestSubmit(); return; }
    const rm = e.target.closest('[data-rm]');
    if (!rm) return;
    pending = pending.filter((a) => a.id !== rm.dataset.rm);
    renderTray(); syncSend();
  });

  el.attachBtn.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => {
    const files = [...el.fileInput.files];
    el.fileInput.value = '';
    addFiles(files);
  });
  // tempel gambar/file (Ctrl+V)
  el.input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData ? e.clipboardData.files : [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  // seret & lepas
  ['dragenter', 'dragover'].forEach((t) => window.addEventListener(t, (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); el.app.classList.add('dragging'); }
  }));
  ['dragleave', 'drop'].forEach((t) => window.addEventListener(t, (e) => {
    if (t === 'drop' && e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); }
    if (t === 'drop' || e.target === document.documentElement || !e.relatedTarget) el.app.classList.remove('dragging');
  }));

  /* ---------- composer ---------- */
  function autosize() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 200) + 'px';
  }
  function syncSend() {
    const loading = pending.some((a) => a.loading);
    const hasContent = !!el.input.value.trim() || pending.length > 0;
    el.send.classList.toggle('busy', busy);
    el.send.disabled = !busy && (!hasContent || loading);
    el.send.setAttribute('aria-label', busy ? 'Hentikan' : 'Kirim');
  }
  el.input.addEventListener('input', () => { autosize(); syncSend(); });
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      el.form.requestSubmit();
    }
  });
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) { stop(); return; }
    const text = el.input.value.trim();
    if ((!text && !pending.length) || pending.some((a) => a.loading)) return;
    const atts = pending;
    pending = [];
    el.input.value = '';
    autosize(); renderTray(); syncSend();
    send(text, atts);
  });
  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-prompt]');
    if (chip && !busy) send(chip.dataset.prompt, []);
  });

  function stop() { if (controller) controller.abort(); }

  /* ---------- menyusun pesan untuk API ---------- */
  function userApiText(m, withFiles) {
    let text = m.content || '';
    const files = m.files || [];
    if (!text && files.length) text = 'Tolong baca file berikut dan jelaskan isinya.';
    files.forEach((f) => {
      if (withFiles && f.text) {
        text += '\n\n[File: ' + f.name + ']' + (f.truncated ? ' (dipotong, hanya bagian awal)' : '') + '\n```\n' + f.text + '\n```';
      } else {
        text += '\n\n[File: ' + f.name + '] (isi tidak disertakan lagi)';
      }
    });
    return text;
  }

  function buildApiMessages(history) {
    const recentFrom = Math.max(0, history.length - 6);
    const out = history.map((m, i) => {
      if (m.role === 'user') return { role: 'user', content: userApiText(m, i >= recentFrom) };
      return { role: 'assistant', content: clean(m.content) };
    });
    // Gambar terbaru (jika masih ada di memori) dipasang ke pesan pengguna terakhir agar tetap "terlihat".
    let imgs = [];
    for (let i = history.length - 1; i >= recentFrom; i--) {
      const stored = imgStore.get(history[i]);
      if (stored && stored.length) { imgs = stored; break; }
    }
    if (imgs.length) {
      const last = out[out.length - 1];
      last.content = [
        { type: 'text', text: last.content || 'Jelaskan gambar ini.' },
        ...imgs.map((url) => ({ type: 'image_url', image_url: { url } })),
      ];
    }
    return out;
  }


  /* ---------- tingkatan AI ---------- */
  const EL_VERSION = '1.0'; // ubah di sini untuk mengganti nomor versi (samakan dengan env EL_VERSION di Vercel)
  const TIERS = [
    { id: 'lite', name: 'El Lite', desc: 'Cepat dan ringkas, cocok untuk pertanyaan sehari-hari' },
    { id: 'pro',  name: 'El Pro',  desc: 'Seimbang untuk kebanyakan tugas (bawaan)' },
    { id: 'max',  name: 'El Max',  desc: 'Paling pintar untuk tugas rumit, analisis, dan coding' },
  ];
  const TIER_STORE = 'elai.tier';
  let tier = 'pro';
  try { const t = localStorage.getItem(TIER_STORE); if (TIERS.some((x) => x.id === t)) tier = t; } catch {}

  function renderTier() {
    const cur = TIERS.find((x) => x.id === tier);
    el.tierLabel.textContent = cur.name + ' ' + EL_VERSION;
    el.tierMenu.innerHTML = TIERS.map((x) =>
      '<button type="button" class="tier-item' + (x.id === tier ? ' on' : '') + '" role="option" aria-selected="' + (x.id === tier) + '" data-tier="' + x.id + '">' +
      '<strong>' + x.name + ' <em>' + EL_VERSION + '</em></strong><span>' + x.desc + '</span>' +
      '<svg class="tick" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' +
      '</button>').join('');
  }
  function toggleTierMenu(open) {
    const show = open === undefined ? el.tierMenu.hidden : open;
    el.tierMenu.hidden = !show;
    el.tierBtn.setAttribute('aria-expanded', String(show));
  }
  el.tierBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleTierMenu(); });
  el.tierMenu.addEventListener('click', (e) => {
    const b = e.target.closest('.tier-item');
    if (!b) return;
    tier = b.dataset.tier;
    try { localStorage.setItem(TIER_STORE, tier); } catch {}
    renderTier();
    toggleTierMenu(false);
  });
  document.addEventListener('click', (e) => { if (!el.tierMenu.hidden && !e.target.closest('#tier')) toggleTierMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleTierMenu(false); });
  renderTier();

  /* ---------- senter ---------- */
  const light = { mode: null, stream: null, track: null, wake: null };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Buka kamera (resolusi kecil biar cepat), lalu nyalakan torch secepat mungkin.
  async function tryTorch(constraints) {
    const vc = Object.assign({ width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } }, constraints.video);
    const stream = await navigator.mediaDevices.getUserMedia({ video: vc, audio: false });
    const track = stream.getVideoTracks()[0];

    const fire = async () => {
      try {
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        await track.applyConstraints({ advanced: [{ torch: true }] });
        const st = track.getSettings ? track.getSettings() : {};
        return st.torch === true || (!!caps.torch && st.torch === undefined);
      } catch { return false; }
    };

    let ok = await fire();               // coba langsung, tanpa menunggu
    let v = null;
    if (!ok) {                           // belum siap: jalankan video lalu cek tiap 100 ms
      v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.setAttribute('playsinline', '');
      v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none';
      v.srcObject = stream;
      document.body.appendChild(v);
      try { await v.play(); } catch {}
      for (let i = 0; i < 8 && !ok; i++) { await sleep(100); ok = await fire(); }
    }
    if (!ok && 'ImageCapture' in window) {
      try {
        const ic = new ImageCapture(track);
        const pc = await ic.getPhotoCapabilities();
        if (pc.fillLightMode && pc.fillLightMode.includes('flash')) { await ic.setOptions({ fillLightMode: 'flash' }); ok = true; }
      } catch {}
    }
    if (ok) {
      Object.assign(light, { stream, track, video: v, mode: 'torch' });
      try { const id = track.getSettings().deviceId; if (id) localStorage.setItem('el-torch-dev', id); } catch {}
      return true;
    }
    stream.getTracks().forEach((t) => t.stop());
    if (v) v.remove();
    return false;
  }

  async function lightOn() {
    if (light.mode) return true;
    light.err = '';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { light.err = 'nosupport'; return false; }
    const attempts = [];
    try { const id = localStorage.getItem('el-torch-dev'); if (id) attempts.push({ video: { deviceId: { exact: id } } }); } catch {}
    attempts.push({ video: { facingMode: { exact: 'environment' } } });
    let triedIds = false;
    for (let i = 0; i < attempts.length || !triedIds; i++) {
      if (i >= attempts.length) {
        // Cek semua kamera belakang (HP berlensa banyak: hanya lensa utama yang punya flash).
        triedIds = true;
        try {
          const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && !/front|depan|user/i.test(d.label));
          devs.forEach((d) => attempts.push({ video: { deviceId: { exact: d.deviceId } } }));
        } catch {}
        attempts.push({ video: { facingMode: 'environment' } });
        if (i >= attempts.length) break;
      }
      try {
        if (await tryTorch(attempts[i])) {
          try { if (navigator.wakeLock) light.wake = await navigator.wakeLock.request('screen'); } catch {}
          el.lightBar.hidden = false;
          el.lightBtn.classList.add('on');
          return true;
        }
      } catch (e) {
        if (e && e.name === 'NotAllowedError') { light.err = 'denied'; return false; }
        if (e && e.name === 'NotReadableError') light.err = 'busy';
      }
    }
    if (!light.err) light.err = 'notorch';
    return false;
  }

  function lightOff() {
    if (!light.mode) return false;
    try { if (light.track) light.track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {}); } catch {}
    if (light.stream) light.stream.getTracks().forEach((t) => t.stop());
    if (light.video) light.video.remove();
    try { if (light.wake) light.wake.release(); } catch {}
    Object.assign(light, { mode: null, stream: null, track: null, video: null, wake: null });
    el.lightBar.hidden = true;
    el.lightBtn.classList.remove('on');
    return true;
  }

  function lightErrorText() {
    switch (light.err) {
      case 'denied': return 'Izin kamera ditolak. Ketuk ikon gembok di sebelah alamat website → Izin → Kamera → Izinkan, lalu coba lagi.';
      case 'busy': return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi kamera lalu coba lagi.';
      case 'nosupport': return 'Browser ini tidak mengizinkan akses kamera. Pastikan website dibuka lewat https dan pakai Chrome terbaru.';
      default: return 'Senter asli tidak bisa dinyalakan lewat browser di HP ini (kamera tidak memberi akses ke lampu flash). Coba update Chrome, atau buka lewat Chrome versi terbaru.';
    }
  }

  el.lightBtn.addEventListener('click', async () => {
    if (light.mode) { lightOff(); return; }
    if (!(await lightOn())) toast(lightErrorText());
  });
  el.lightOffBtn.addEventListener('click', lightOff);
  document.addEventListener('visibilitychange', () => { if (document.hidden) lightOff(); });

  // Deteksi perintah "nyalakan senter" / "matikan senter" (bukan pertanyaan)
  function lightCommand(text) {
    const t = (text || '').toLowerCase().trim();
    if (!t || t.length > 60 || /\?|\b(cara|bagaimana|gimana|kenapa|mengapa|apa itu|apakah|kode|buatkan|bikin)\b/.test(t)) return null;
    const target = '(senter|lampu\\s*senter|flash(light)?|cahaya|lampu|torch)';
    const on = new RegExp('\\b(nyala(kan|in)?|menyala(kan)?|hidup(kan|in)?|aktif(kan|in)?|on(kan)?|buka|turn on)\\b.{0,20}\\b' + target + '\\b|\\b' + target + '\\b.{0,12}\\b(on|nyala|hidup|aktif)\\b');
    const off = new RegExp('\\b(matikan|mati(kan|in)?|nonaktif(kan)?|off(kan)?|tutup|turn off)\\b.{0,20}\\b' + target + '\\b|\\b' + target + '\\b.{0,12}\\b(off|mati|nonaktif)\\b');
    if (off.test(t)) return 'off';
    if (on.test(t)) return 'on';
    return null;
  }

  async function handleLight(text, cmd) {
    let chat = current();
    if (!chat) chat = createChat();
    const userMsg = { role: 'user', content: text };
    chat.messages.push(userMsg);
    if (chat.messages.length === 1) chat.title = text.length > 42 ? text.slice(0, 42) + '…' : text;
    el.welcome.hidden = true;
    el.title.textContent = chat.title;
    el.thread.appendChild(messageEl(userMsg));

    let content;
    if (cmd === 'on') {
      const ok = await lightOn();
      content = ok
        ? 'Senter sudah menyala. Ketuk tombol **Matikan** atau ketik "matikan senter" untuk mematikannya.'
        : lightErrorText();
    } else {
      content = lightOff() ? 'Senter sudah dimatikan.' : 'Senter memang sedang tidak menyala.';
    }
    const reply = { role: 'assistant', content };
    chat.messages.push(reply);
    chat.updated = Date.now();
    save(); renderSidebar();
    el.thread.appendChild(messageEl(reply));
    scrollDown(true);
  }

  /* ---------- konversi foto -> PDF / Word ---------- */
  const OCR_PROMPT = 'Salin SEMUA teks yang terlihat pada gambar ini persis seperti aslinya: bahasa, ejaan, angka, serta susunan baris, paragraf, dan daftar dipertahankan. Jangan menambah komentar, penjelasan, atau kalimat pembuka. Jangan memakai blok kode. Jika ada tabel, tulis dengan format | kolom | kolom |. Jika gambar sama sekali tidak berisi tulisan, balas hanya dengan: [TIDAK ADA TEKS]';

  // Deteksi perintah seperti "jadikan pdf", "ubah ke word" (bukan pertanyaan)
  function convertCommand(text) {
    const t = (text || '').toLowerCase().trim();
    if (!t || t.length > 140 || /\?|\b(cara|bagaimana|gimana|kenapa|mengapa|apakah)\b/.test(t)) return null;
    if (!/\b(jadi|jadikan|jadiin|jd|ubah|ganti|convert|konversi|ke|simpan|buat|bikin|export|ekspor|to)\b/.test(t)) return null;
    const pdf = /\bpdf\b/.test(t);
    const word = /\b(word|docx?)\b/.test(t);
    if (!pdf && !word) return null;
    return { pdf, word, asImage: /(sebagai gambar|berupa gambar|apa adanya|tanpa ocr|tempel gambar)/.test(t) };
  }

  async function imageToJpeg(file, maxSide, q) {
    const { img, url } = await loadImage(file);
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * s));
    const h = Math.max(1, Math.round(img.naturalHeight * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    URL.revokeObjectURL(url);
    if (!blob) throw new Error('decode');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
  }

  // Minta AI membaca teks pada satu gambar (OCR), hasilnya dikumpulkan sampai selesai
  async function readTextFromImage(dataUrl, signal) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text', text: OCR_PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }], tier }),
      signal,
    });
    if (!res.ok) {
      let msg = 'Gagal membaca teks pada foto (' + res.status + ').';
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', out = '', finished = false;
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') { finished = true; break; }
        try {
          const j = JSON.parse(data);
          const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (d) out += d;
        } catch {}
      }
    }
    return clean(out).trim();
  }

  async function handleConvert(text, atts, cmd) {
    let chat = current();
    if (!chat) chat = createChat();
    const imgs = atts.filter((a) => a.kind === 'image' && a.file);
    const userMsg = { role: 'user', content: text, atts: atts.map((a) => ({ kind: a.kind, name: a.name, thumb: a.kind === 'image' ? a.thumb : undefined })) };
    chat.messages.push(userMsg);
    if (chat.messages.length === 1) chat.title = text.length > 42 ? text.slice(0, 42) + '…' : text;
    chat.updated = Date.now();
    el.welcome.hidden = true;
    el.title.textContent = chat.title;
    el.thread.appendChild(messageEl(userMsg));

    const reply = { role: 'assistant', content: '' };
    const node = messageEl(reply);
    const contentEl = node.querySelector('.content');
    const status = (t) => { contentEl.innerHTML = window.ElMd.render(t); };
    status('Menyiapkan foto…');
    el.thread.appendChild(node);
    scrollDown(true);

    busy = true; syncSend();
    controller = new AbortController();
    const made = [];
    const lines = [];
    try {
      let jpgs = null;
      const getJpgs = async () => {
        if (!jpgs) { jpgs = []; for (const a of imgs) jpgs.push(await imageToJpeg(a.file, 2200, 0.88)); }
        return jpgs;
      };
      const stamp = new Date().toISOString().slice(0, 10);
      const mime = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
      const n = imgs.length;

      if (cmd.pdf) {
        status('Membuat PDF…');
        const data = window.ElConvert.buildPdf(await getJpgs());
        made.push({ label: 'PDF', name: 'El-Ai-' + stamp + '.pdf', blob: new Blob([data], { type: mime.pdf }) });
        lines.push('- **PDF**: ' + n + ' halaman, tiap foto jadi satu halaman.');
      }

      if (cmd.word) {
        let data = null, how = '';
        if (!cmd.asImage) {
          try {
            const pages = [];
            for (let i = 0; i < n; i++) {
              status('Membaca teks pada foto ' + (i + 1) + ' dari ' + n + '…');
              pages.push(await readTextFromImage(imgs[i].dataUrl, controller.signal));
            }
            const real = pages.map((p) => (/^\[?\s*TIDAK ADA TEKS\s*\]?\.?$/i.test(p) ? '' : p));
            if (real.some((p) => p.trim())) { data = window.ElConvert.buildDocxFromText(real); how = 'text'; }
          } catch (err) {
            if (err && err.name === 'AbortError') throw err;
            lines.push('- Teks pada foto tidak berhasil dibaca (' + ((err && err.message) || 'gagal') + '), jadi Word dibuat berisi gambar.');
          }
        }
        if (!data) {
          status('Membuat Word…');
          data = window.ElConvert.buildDocxFromImages(await getJpgs());
          how = 'image';
          if (!cmd.asImage && !lines.some((l) => l.includes('tidak berhasil'))) lines.push('- Tidak ada tulisan yang terbaca di foto, jadi Word dibuat berisi gambar.');
        }
        made.push({ label: 'Word', name: 'El-Ai-' + stamp + '.docx', blob: new Blob([data], { type: mime.docx }) });
        lines.push(how === 'text'
          ? '- **Word**: berisi teks hasil bacaan foto dan bisa diedit. Hasil bacaan bisa kurang tepat, jadi periksa lagi sebelum dipakai.'
          : '- **Word**: foto ditempel apa adanya di dokumen.');
      }

      reply.content = 'Sudah jadi.\n\n' + lines.join('\n') + '\n\nUnduh lewat tombol di bawah. Kalau tombolnya sudah hilang (misalnya setelah halaman dimuat ulang), kirim ulang fotonya untuk membuat file lagi.';
      status(reply.content);

      const row = document.createElement('div');
      row.className = 'dl-row';
      made.forEach((f) => {
        const a = document.createElement('a');
        a.className = 'dl-btn';
        a.href = URL.createObjectURL(f.blob);
        a.download = f.name;
        a.textContent = 'Unduh ' + f.label;
        row.appendChild(a);
      });
      node.querySelector('.msg-body').insertBefore(row, node.querySelector('.msg-actions'));
    } catch (err) {
      if (err && err.name === 'AbortError') reply.content = 'Konversi dibatalkan.';
      else reply.content = 'Maaf, foto tidak bisa diubah: ' + ((err && err.message && err.message !== 'decode') ? err.message : 'format foto tidak didukung.');
      status(reply.content);
    }
    chat.messages.push(reply);
    chat.updated = Date.now();
    busy = false; controller = null; syncSend();
    save(); renderSidebar();
    scrollDown(true);
  }

  /* ---------- chat flow ---------- */
  async function send(text, atts) {
    if (busy) return;
    const conv = atts.some((a) => a.kind === 'image' && a.file) ? convertCommand(text) : null;
    if (conv) { handleConvert(text, atts, conv); return; }
    const cmd = atts.length ? null : lightCommand(text);
    if (cmd) { handleLight(text, cmd); return; }
    let chat = current();
    if (!chat) chat = createChat();

    const userMsg = { role: 'user', content: text };
    if (atts.length) {
      userMsg.atts = atts.map((a) => ({ kind: a.kind, name: a.name, thumb: a.kind === 'image' ? a.thumb : undefined }));
      const files = atts.filter((a) => a.kind === 'text').map((a) => ({ name: a.name, text: a.text, truncated: !!a.truncated }));
      if (files.length) userMsg.files = files;
      const images = atts.filter((a) => a.kind === 'image').map((a) => a.dataUrl);
      if (images.length) imgStore.set(userMsg, images);
    }
    chat.messages.push(userMsg);
    if (chat.messages.length === 1) {
      const t = text || (atts[0] && atts[0].name) || 'Obrolan baru';
      chat.title = t.length > 42 ? t.slice(0, 42) + '…' : t;
    }
    chat.updated = Date.now();
    const history = chat.messages.slice();
    const reply = { role: 'assistant', content: '' };
    chat.messages.push(reply);
    save(); renderSidebar();

    el.welcome.hidden = true;
    el.title.textContent = chat.title;
    el.thread.appendChild(messageEl(userMsg));
    const node = messageEl(reply);
    node.classList.add('streaming');
    const contentEl = node.querySelector('.content');
    const dotsHtml = '<span class="dots"><i></i><i></i><i></i></span>';
    contentEl.innerHTML = dotsHtml;
    el.thread.appendChild(node);
    scrollDown(true);

    busy = true; syncSend();
    controller = new AbortController();
    let raf = 0;
    const paint = () => {
      raf = 0;
      const shown = clean(reply.content);
      contentEl.innerHTML = shown ? window.ElMd.render(shown) : dotsHtml;
      scrollDown(false);
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: buildApiMessages(history), tier }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let msg = 'Maaf, terjadi kesalahan (' + res.status + ').';
        if (res.status === 413) msg = 'Lampiran terlalu besar untuk dikirim. Coba kirim lebih sedikit atau lebih kecil.';
        try { const j = await res.json(); if (j && j.error) msg = j.error; } catch {}
        throw new Error(msg);
      }

      reply.model = res.headers.get('X-El-Model') || '';
      reply.fallback = res.headers.get('X-El-Fallback') === '1';
      reply.tierName = (TIERS.find((x) => x.id === tier) || {}).name || '';
      const tagEl = modelTag(reply);
      const actionsEl = node.querySelector('.msg-actions');
      if (tagEl && actionsEl) actionsEl.appendChild(tagEl);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') { finished = true; break; }
          try {
            const j = JSON.parse(data);
            const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (delta) {
              reply.content += delta;
              if (!raf) raf = setTimeout(paint, 80);
            }
          } catch {}
        }
      }
      reply.content = clean(reply.content);
      if (!reply.content.trim()) throw new Error('El Ai tidak mengirim jawaban. Coba kirim ulang pesanmu.');
    } catch (err) {
      if (err && err.name === 'AbortError') {
        reply.content = clean(reply.content);
        if (!reply.content.trim()) chat.messages.pop();
      } else {
        chat.messages.pop(); // buang balasan kosong agar riwayat tetap valid
        contentEl.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'error-box';
        box.textContent = (err && err.message) || 'Terjadi kesalahan jaringan.';
        contentEl.appendChild(box);
        node.querySelector('.msg-actions').remove();
      }
    } finally {
      if (raf) clearTimeout(raf);
      if (reply.content.trim()) contentEl.innerHTML = window.ElMd.render(clean(reply.content));
      else if (!contentEl.querySelector('.error-box')) node.remove();
      node.classList.remove('streaming');
      busy = false; controller = null;
      chat.updated = Date.now();
      save(); renderSidebar(); syncSend();
      scrollDown(false);
    }
  }

  /* ---------- copy buttons ---------- */
  async function copy(text, btn, label) {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Tersalin ✓';
    } catch {
      btn.textContent = 'Gagal';
    }
    setTimeout(() => { btn.textContent = label; }, 1500);
  }
  el.thread.addEventListener('click', (e) => {
    const codeBtn = e.target.closest('[data-copy-code]');
    if (codeBtn) {
      const code = codeBtn.closest('.code').querySelector('code');
      copy(code.textContent, codeBtn, 'Salin');
      return;
    }
    const msgBtn = e.target.closest('[data-copy-msg]');
    if (msgBtn) {
      const content = msgBtn.closest('.msg-body').querySelector('.content');
      copy(content.innerText, msgBtn, 'Salin');
    }
  });

  /* ---------- init ---------- */
  load();
  applyThemeLabel();
  renderSidebar();
  renderThread();
  syncSend();
})();

(() => {
  'use strict';

  /* =========================================================
     EL AI — CHAT APPLICATION
     Mempertahankan fitur UI, riwayat, lampiran, streaming,
     tema, tombol salin, dan kontrol senter.
     ========================================================= */

  const $ = (selector) => document.querySelector(selector);

  const el = {
    app: $('.app'),
    sidebar: $('#sidebar'),
    overlay: $('#overlay'),
    list: $('#chatList'),
    chat: $('#chat'),
    thread: $('#thread'),
    welcome: $('#welcome'),
    greeting: $('#greeting'),
    form: $('#composer'),
    input: $('#input'),
    send: $('#send'),
    title: $('#topTitle'),
    themeBtn: $('#themeBtn'),
    themeLabel: $('#themeLabel'),
    lightBtn: $('#lightBtn'),
    lightBar: $('#lightBar'),
    lightOffBtn: $('#lightOff'),
    attachBtn: $('#attachBtn'),
    fileInput: $('#fileInput'),
    tray: $('#tray'),
    toast: $('#toast'),
  };

  const STORE = 'elai.chats.v1';
  const THEME_STORE = 'elai.theme';

  const MAX_CHATS = 40;
  const MAX_ATTACH = 5;
  const MAX_IMAGES = 3;
  const MAX_FILE_BYTES = 15 * 1024 * 1024;
  const MAX_CHARS_PER_FILE = 12000;
  const MAX_CHARS_TOTAL = 30000;
  const MAX_IMAGE_TOTAL = 3.4e6;

  const FILE_ICON = `
    <svg viewBox="0 0 24 24" width="20" height="20"
      fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true">
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/>
      <path d="M14 3v5h5M9 13h6M9 17h6"/>
    </svg>
  `;

  let chats = [];
  let currentId = null;
  let busy = false;
  let controller = null;
  let pending = [];

  // Data gambar disimpan di memori, bukan localStorage.
  const imgStore = new WeakMap();

  let toastTimer = 0;
  let lightRequest = 0;

  /* =========================================================
     UTILITAS
     ========================================================= */

  const uid = () =>
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 9);

  const clean = (value) => {
    return String(value || '')
      .replace(/<think>[\s\S]*?(<\/think>|$)/gi, '')
      .replace(/^\s+/, '');
  };

  function toast(message) {
    if (!el.toast) return;

    el.toast.textContent = message;
    el.toast.hidden = false;

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      el.toast.hidden = true;
    }, 3800);
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function getMarkdownRenderer() {
    return window.ElMd &&
      typeof window.ElMd.render === 'function'
      ? window.ElMd
      : null;
  }

  function renderMarkdown(text) {
    const markdown = getMarkdownRenderer();

    if (markdown) {
      try {
        return markdown.render(clean(text));
      } catch (error) {
        console.error('El Ai Markdown error:', error);
      }
    }

    // Fallback jika markdown.js gagal dimuat.
    const block = document.createElement('div');
    block.textContent = clean(text);
    return block.innerHTML.replace(/\n/g, '<br>');
  }

  function makeButton(label, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    return button;
  }

  /* =========================================================
     PENYIMPANAN RIWAYAT
     ========================================================= */

  function load() {
    let stored = [];

    try {
      stored = safeJsonParse(
        localStorage.getItem(STORE),
        []
      );
    } catch {
      stored = [];
    }

    if (!Array.isArray(stored)) {
      chats = [];
      return;
    }

    // Validasi bentuk data lama agar tidak merusak aplikasi.
    chats = stored
      .filter((chat) => {
        return chat &&
          typeof chat.id === 'string' &&
          Array.isArray(chat.messages);
      })
      .map((chat) => ({
        id: chat.id,
        title: String(chat.title || 'Obrolan baru'),
        updated: Number(chat.updated) || Date.now(),
        messages: chat.messages
          .filter((message) => {
            return message &&
              ['user', 'assistant'].includes(message.role);
          })
          .map((message) => ({
            role: message.role,
            content: String(message.content || ''),
            atts: Array.isArray(message.atts)
              ? message.atts
              : [],
            files: Array.isArray(message.files)
              ? message.files
              : [],
          })),
      }))
      .sort((a, b) => b.updated - a.updated)
      .slice(0, MAX_CHATS);
  }

  function save() {
    chats.sort((a, b) => b.updated - a.updated);
    chats = chats.slice(0, MAX_CHATS);

    try {
      localStorage.setItem(STORE, JSON.stringify(chats));
      return;
    } catch (error) {
      console.warn('El Ai: penyimpanan utama penuh.', error);
    }

    // Pertahankan beberapa obrolan terbaru jika storage penuh.
    try {
      const reduced = chats.map((chat) => ({
        ...chat,
        messages: chat.messages.map((message) => ({
          ...message,
          files: (message.files || []).map((file) => ({
            ...file,
            text: '',
          })),
        })),
      }));

      localStorage.setItem(
        STORE,
        JSON.stringify(reduced)
      );

      chats = reduced;
    } catch (error) {
      console.warn('El Ai: riwayat tidak dapat disimpan.', error);
      toast('Penyimpanan penuh. Sebagian riwayat mungkin tidak tersimpan.');
    }
  }

  function current() {
    return chats.find((chat) => chat.id === currentId) || null;
  }

  function createChat() {
    const chat = {
      id: uid(),
      title: 'Obrolan baru',
      messages: [],
      updated: Date.now(),
    };

    chats.unshift(chat);
    currentId = chat.id;

    return chat;
  }

  /* =========================================================
     TEMA TERANG / GELAP
     ========================================================= */

  function applyThemeLabel() {
    if (!el.themeLabel) return;

    const dark =
      document.documentElement.getAttribute('data-theme') === 'dark';

    el.themeLabel.textContent = dark
      ? 'Mode terang'
      : 'Mode gelap';
  }

  function initializeTheme() {
    let theme = 'light';

    try {
      theme = localStorage.getItem(THEME_STORE) || 'light';
    } catch {
      // Gunakan tema terang sebagai fallback.
    }

    if (!['light', 'dark'].includes(theme)) {
      theme = 'light';
    }

    document.documentElement.setAttribute('data-theme', theme);
    applyThemeLabel();
  }

  if (el.themeBtn) {
    el.themeBtn.addEventListener('click', () => {
      const currentTheme =
        document.documentElement.getAttribute('data-theme');

      const nextTheme =
        currentTheme === 'dark' ? 'light' : 'dark';

      document.documentElement.setAttribute(
        'data-theme',
        nextTheme
      );

      try {
        localStorage.setItem(THEME_STORE, nextTheme);
      } catch {
        // Tema tetap berubah meskipun penyimpanan gagal.
      }

      applyThemeLabel();
    });
  }

  /* =========================================================
     SIDEBAR
     ========================================================= */

  function openSide() {
    if (el.sidebar) el.sidebar.classList.add('open');
    if (el.overlay) el.overlay.classList.add('show');
  }

  function closeSide() {
    if (el.sidebar) el.sidebar.classList.remove('open');
    if (el.overlay) el.overlay.classList.remove('show');
  }

  $('#openSide')?.addEventListener('click', openSide);
  $('#closeSide')?.addEventListener('click', closeSide);
  el.overlay?.addEventListener('click', closeSide);

  function renderSidebar() {
    if (!el.list) return;

    el.list.replaceChildren();

    if (!chats.length) {
      const empty = document.createElement('div');
      empty.className = 'chat-empty';
      empty.textContent = 'Belum ada obrolan.';
      el.list.appendChild(empty);
      return;
    }

    [...chats]
      .sort((a, b) => b.updated - a.updated)
      .forEach((chat) => {
        const row = document.createElement('div');

        row.className =
          'chat-item' +
          (chat.id === currentId ? ' active' : '');

        const open = makeButton(
          chat.title,
          'chat-open'
        );

        open.dataset.id = chat.id;
        open.title = chat.title;

        const del = makeButton('', 'chat-del');

        del.dataset.del = chat.id;
        del.setAttribute('aria-label', 'Hapus obrolan');

        del.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16"
            fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true">
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/>
          </svg>
        `;

        row.append(open, del);
        el.list.appendChild(row);
      });
  }

  el.list?.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-del]');

    if (deleteButton) {
      const id = deleteButton.dataset.del;

      if (busy && id === currentId) {
        stop();
      }

      chats = chats.filter((chat) => chat.id !== id);

      if (currentId === id) {
        currentId = null;
      }

      save();
      renderSidebar();
      renderThread();

      return;
    }

    const openButton = event.target.closest('[data-id]');

    if (!openButton) return;

    if (openButton.dataset.id !== currentId) {
      if (busy) stop();

      currentId = openButton.dataset.id;

      renderSidebar();
      renderThread();
      closeSide();
    } else {
      closeSide();
    }
  });

  $('#newChat')?.addEventListener('click', () => {
    if (busy) stop();

    currentId = null;

    renderSidebar();
    renderThread();
    closeSide();

    el.input?.focus();
  });

  /* =========================================================
     TAMPILAN PESAN
     ========================================================= */

  function greetingText() {
    const hour = new Date().getHours();

    const greeting =
      hour < 11
        ? 'Selamat pagi'
        : hour < 15
          ? 'Selamat siang'
          : hour < 18
            ? 'Selamat sore'
            : 'Selamat malam';

    return greeting + ', ada yang bisa El bantu?';
  }

  function attsEl(message) {
    const attachments = message.atts || [];

    if (!attachments.length) return null;

    const box = document.createElement('div');
    box.className = 'atts';

    attachments.forEach((attachment) => {
      if (
        attachment.kind === 'image' &&
        attachment.thumb
      ) {
        const img = document.createElement('img');

        img.className = 'att-img';
        img.src = attachment.thumb;
        img.alt = attachment.name || 'Gambar lampiran';
        img.loading = 'lazy';

        box.appendChild(img);
        return;
      }

      const chip = document.createElement('div');
      chip.className = 'att-file glass';
      chip.innerHTML = FILE_ICON;

      const name = document.createElement('span');
      name.textContent = attachment.name || 'File';

      chip.appendChild(name);
      box.appendChild(chip);
    });

    return box;
  }

  function messageEl(message) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + message.role;

    if (message.role === 'user') {
      const attachments = attsEl(message);

      if (attachments) {
        wrap.appendChild(attachments);
      }

      if (message.content) {
        const bubble = document.createElement('div');

        bubble.className = 'bubble';
        bubble.textContent = message.content;

        wrap.appendChild(bubble);
      }

      return wrap;
    }

    const logo = document.createElement('span');
    logo.className = 'logo';
    logo.textContent = 'El';

    const body = document.createElement('div');
    body.className = 'msg-body';

    const content = document.createElement('div');
    content.className = 'content glass';
    content.innerHTML = renderMarkdown(message.content);

    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    const copyButton = makeButton('Salin', 'act');
    copyButton.dataset.copyMsg = '';

    actions.appendChild(copyButton);
    body.append(content, actions);
    wrap.append(logo, body);

    return wrap;
  }

  function renderThread() {
    if (!el.thread) return;

    const chat = current();

    el.thread.replaceChildren();

    if (!chat || !chat.messages.length) {
      if (el.welcome) {
        el.welcome.hidden = false;
      }

      if (el.greeting) {
        el.greeting.textContent = greetingText();
      }

      if (el.title) {
        el.title.textContent = 'El Ai';
      }

      return;
    }

    if (el.welcome) {
      el.welcome.hidden = true;
    }

    if (el.title) {
      el.title.textContent = chat.title;
    }

    chat.messages.forEach((message) => {
      el.thread.appendChild(messageEl(message));
    });

    scrollDown(true);
  }

  function nearBottom() {
    if (!el.chat) return true;

    return (
      el.chat.scrollHeight -
      el.chat.scrollTop -
      el.chat.clientHeight
    ) < 140;
  }

  function scrollDown(force) {
    if (!el.chat) return;

    if (force || nearBottom()) {
      el.chat.scrollTo({
        top: el.chat.scrollHeight,
        behavior: 'auto',
      });
    }
  }

  /* =========================================================
     LAMPIRAN
     ========================================================= */

  const TEXT_EXT =
    /\.(txt|md|markdown|csv|tsv|json|xml|ya?ml|log|html?|css|m?js|jsx?|tsx?|py|java|c|h|cpp|cs|go|rs|php|rb|sql|sh|ini|toml|env)$/i;

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => resolve({
        img: image,
        url,
      });

      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('decode'));
      };

      image.src = url;
    });
  }

  async function compressImage(file) {
    const { img, url } = await loadImage(file);

    try {
      const draw = (maxSize, quality) => {
        const scale = Math.min(
          1,
          maxSize / Math.max(
            img.naturalWidth,
            img.naturalHeight
          )
        );

        const width = Math.max(
          1,
          Math.round(img.naturalWidth * scale)
        );

        const height = Math.max(
          1,
          Math.round(img.naturalHeight * scale)
        );

        const canvas = document.createElement('canvas');

        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d');

        if (!context) {
          throw new Error('canvas');
        }

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(img, 0, 0, width, height);

        return canvas.toDataURL('image/jpeg', quality);
      };

      let dataUrl = draw(1280, 0.82);

      if (dataUrl.length > 1.2e6) {
        dataUrl = draw(1024, 0.7);
      }

      const thumb = draw(160, 0.72);

      return {
        dataUrl,
        thumb,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  let pdfPromise = null;

  function loadPdfJs() {
    if (window.pdfjsLib) {
      return Promise.resolve(window.pdfjsLib);
    }

    if (!pdfPromise) {
      pdfPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');

        script.src =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';

        script.onload = () => {
          if (!window.pdfjsLib) {
            pdfPromise = null;
            reject(new Error('pdfjs'));
            return;
          }

          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

          resolve(window.pdfjsLib);
        };

        script.onerror = () => {
          pdfPromise = null;
          reject(new Error('pdfjs'));
        };

        document.head.appendChild(script);
      });
    }

    return pdfPromise;
  }

  async function extractPdf(file, limit) {
    const library = await loadPdfJs();

    const pdf = await library.getDocument({
      data: await file.arrayBuffer(),
    }).promise;

    let text = '';

    const pages = Math.min(pdf.numPages, 60);

    for (
      let pageNumber = 1;
      pageNumber <= pages && text.length < limit + 500;
      pageNumber++
    ) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();

      text += content.items
        .map((item) => item.str)
        .join(' ') + '\n\n';
    }

    return {
      text: text.trim(),
      truncated: pdf.numPages > pages || text.length > limit,
    };
  }

  const usedChars = () =>
    pending.reduce((total, attachment) => {
      return total +
        (
          attachment.kind === 'text' && attachment.text
            ? attachment.text.length
            : 0
        );
    }, 0);

  const usedImageChars = () =>
    pending.reduce((total, attachment) => {
      return total +
        (
          attachment.kind === 'image' && attachment.dataUrl
            ? attachment.dataUrl.length
            : 0
        );
    }, 0);

  async function addFiles(fileList) {
    const files = [...fileList];

    if (!files.length) return;

    for (const file of files) {
      if (pending.length >= MAX_ATTACH) {
        toast('Maksimal ' + MAX_ATTACH + ' lampiran per pesan.');
        break;
      }

      if (file.size > MAX_FILE_BYTES) {
        toast(file.name + ' terlalu besar. Maksimal 15 MB.');
        continue;
      }

      const isImage = file.type.startsWith('image/');

      const isPdf =
        file.type === 'application/pdf' ||
        /\.pdf$/i.test(file.name);

      const isText =
        file.type.startsWith('text/') ||
        TEXT_EXT.test(file.name) ||
        file.type === 'application/json';

      if (!isImage && !isPdf && !isText) {
        toast(
          'Format ' +
          (file.name.split('.').pop() || 'ini') +
          ' belum didukung. Gunakan gambar, PDF, atau file teks/kode.'
        );
        continue;
      }

      if (
        isImage &&
        pending.filter((attachment) => {
          return attachment.kind === 'image';
        }).length >= MAX_IMAGES
      ) {
        toast('Maksimal ' + MAX_IMAGES + ' gambar per pesan.');
        continue;
      }

      const item = {
        id: uid(),
        name: file.name,
        loading: true,
        kind: isImage ? 'image' : 'text',
      };

      pending.push(item);
      renderTray();

      try {
        if (isImage) {
          const result = await compressImage(file);

          if (
            usedImageChars() + result.dataUrl.length >
            MAX_IMAGE_TOTAL
          ) {
            throw new Error(
              'Total ukuran gambar terlalu besar. Kirim lebih sedikit gambar.'
            );
          }

          Object.assign(item, result);
        } else {
          let text = '';
          let truncated = false;

          if (isPdf) {
            const result = await extractPdf(
              file,
              MAX_CHARS_PER_FILE
            );

            text = result.text;
            truncated = result.truncated;

            if (!text) {
              throw new Error(
                'PDF tidak memiliki teks yang bisa dibaca. Jika berupa hasil scan, coba unggah gambar halaman.'
              );
            }
          } else {
            text = await file.text();

            if (text.includes('\u0000')) {
              throw new Error(
                file.name + ' bukan file teks yang didukung.'
              );
            }
          }

          const room = Math.max(
            0,
            MAX_CHARS_TOTAL - usedChars()
          );

          const limit = Math.min(
            MAX_CHARS_PER_FILE,
            room
          );

          if (limit < 200) {
            throw new Error(
              'Isi file yang dilampirkan sudah terlalu banyak untuk satu pesan.'
            );
          }

          if (text.length > limit) {
            text = text.slice(0, limit);
            truncated = true;
          }

          Object.assign(item, {
            text,
            truncated,
          });

          if (truncated) {
            toast(
              file.name +
              ' cukup panjang. Hanya bagian awal yang dibaca.'
            );
          }
        }

        item.loading = false;
      } catch (error) {
        pending = pending.filter((attachment) => {
          return attachment !== item;
        });

        const message = error?.message;

        if (
          message &&
          !['decode', 'pdfjs', 'canvas'].includes(message)
        ) {
          toast(message);
        } else if (isImage) {
          toast(
            'Gambar ' +
            file.name +
            ' tidak bisa dibuka. Format HEIC mungkin belum didukung.'
          );
        } else {
          toast('Gagal membaca ' + file.name + '.');
        }
      }

      renderTray();
    }

    syncSend();
  }

  function renderTray() {
    if (!el.tray) return;

    el.tray.replaceChildren();
    el.tray.hidden = pending.length === 0;

    pending.forEach((attachment) => {
      const box = document.createElement('div');

      box.className =
        'tray-item' +
        (attachment.loading ? ' loading' : '');

      if (
        attachment.kind === 'image' &&
        attachment.thumb
      ) {
        const image = document.createElement('img');

        image.src = attachment.thumb;
        image.alt = attachment.name;
        image.loading = 'lazy';

        box.appendChild(image);
      } else {
        const fileBox = document.createElement('div');

        fileBox.className = 'tray-file';

        fileBox.innerHTML =
          FILE_ICON +
          '<div class="meta">' +
          '<span class="name"></span>' +
          '<span class="sub"></span>' +
          '</div>';

        fileBox.querySelector('.name').textContent =
          attachment.name;

        fileBox.querySelector('.sub').textContent =
          attachment.loading
            ? 'Membaca…'
            : attachment.truncated
              ? 'Sebagian dibaca'
              : 'Siap';

        box.appendChild(fileBox);
      }

      const remove = makeButton('×', 'tray-x');

      remove.dataset.rm = attachment.id;
      remove.setAttribute('aria-label', 'Hapus lampiran');

      box.appendChild(remove);
      el.tray.appendChild(box);
    });
  }

  el.tray?.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-rm]');

    if (!remove) return;

    pending = pending.filter((attachment) => {
      return attachment.id !== remove.dataset.rm;
    });

    renderTray();
    syncSend();
  });

  el.attachBtn?.addEventListener('click', () => {
    el.fileInput?.click();
  });

  el.fileInput?.addEventListener('change', () => {
    const files = [...(el.fileInput.files || [])];

    el.fileInput.value = '';

    addFiles(files);
  });

  // Tempel gambar atau file menggunakan Ctrl+V.
  el.input?.addEventListener('paste', (event) => {
    const files = [
      ...(event.clipboardData?.files || []),
    ];

    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  });

  // Seret dan lepas file.
  ['dragenter', 'dragover'].forEach((type) => {
    window.addEventListener(type, (event) => {
      const types = [
        ...(event.dataTransfer?.types || []),
      ];

      if (types.includes('Files')) {
        event.preventDefault();
        el.app?.classList.add('dragging');
      }
    });
  });

  ['dragleave', 'drop'].forEach((type) => {
    window.addEventListener(type, (event) => {
      if (
        type === 'drop' &&
        event.dataTransfer?.files?.length
      ) {
        event.preventDefault();
        addFiles(event.dataTransfer.files);
      }

      if (
        type === 'drop' ||
        event.target === document.documentElement ||
        !event.relatedTarget
      ) {
        el.app?.classList.remove('dragging');
      }
    });
  });

  /* =========================================================
     INPUT / COMPOSER
     ========================================================= */

  function autosize() {
    if (!el.input) return;

    el.input.style.height = 'auto';

    el.input.style.height =
      Math.min(el.input.scrollHeight, 200) + 'px';
  }

  function syncSend() {
    if (!el.send) return;

    const loading = pending.some((attachment) => {
      return attachment.loading;
    });

    const hasContent =
      !!el.input?.value.trim() ||
      pending.length > 0;

    el.send.classList.toggle('busy', busy);

    el.send.disabled =
      !busy && (!hasContent || loading);

    el.send.setAttribute(
      'aria-label',
      busy ? 'Hentikan' : 'Kirim'
    );
  }

  el.input?.addEventListener('input', () => {
    autosize();
    syncSend();
  });

  el.input?.addEventListener('keydown', (event) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.isComposing
    ) {
      event.preventDefault();
      el.form?.requestSubmit();
    }
  });

  el.form?.addEventListener('submit', (event) => {
    event.preventDefault();

    if (busy) {
      stop();
      return;
    }

    const text = el.input?.value.trim() || '';

    if (
      (!text && !pending.length) ||
      pending.some((attachment) => attachment.loading)
    ) {
      return;
    }

    const attachments = pending;

    pending = [];

    el.input.value = '';

    autosize();
    renderTray();
    syncSend();

    send(text, attachments);
  });

  $('#chips')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-prompt]');

    if (chip && !busy) {
      send(chip.dataset.prompt, []);
    }
  });

  function stop() {
    if (controller) {
      controller.abort();
    }
  }

  /* =========================================================
     MENYUSUN RIWAYAT UNTUK API
     ========================================================= */

  function userApiText(message, withFiles) {
    let text = message.content || '';

    const files = message.files || [];

    if (!text && files.length) {
      text = 'Tolong baca file berikut dan jelaskan isinya.';
    }

    files.forEach((file) => {
      if (withFiles && file.text) {
        text +=
          '\n\n[File: ' +
          file.name +
          ']' +
          (file.truncated
            ? ' (dipotong, hanya bagian awal)'
            : '') +
          '\n```\n' +
          file.text +
          '\n```';
      } else {
        text +=
          '\n\n[File: ' +
          file.name +
          '] (isi tidak disertakan lagi)';
      }
    });

    return text;
  }

  function buildApiMessages(history) {
    const recentFrom = Math.max(0, history.length - 6);

    const output = history.map((message, index) => {
      if (message.role === 'user') {
        return {
          role: 'user',
          content: userApiText(
            message,
            index >= recentFrom
          ),
        };
      }

      return {
        role: 'assistant',
        content: clean(message.content),
      };
    });

    // Cari gambar terbaru yang masih tersedia di memori.
    let images = [];

    for (
      let index = history.length - 1;
      index >= recentFrom;
      index--
    ) {
      const storedImages = imgStore.get(history[index]);

      if (storedImages?.length) {
        images = storedImages;
        break;
      }
    }

    if (images.length && output.length) {
      const last = output[output.length - 1];

      // Format multimodal yang umum digunakan API kompatibel
      // OpenAI. Backend harus meneruskan format ini ke model.
      last.content = [
        {
          type: 'text',
          text:
            typeof last.content === 'string'
              ? last.content || 'Jelaskan gambar ini.'
              : 'Jelaskan gambar ini.',
        },
        ...images.map((url) => ({
          type: 'image_url',
          image_url: { url },
        })),
      ];
    }

    return output;
  }

  /* =========================================================
     FITUR SENTER
     ========================================================= */

  const light = {
    mode: null,
    stream: null,
    track: null,
    video: null,
    wake: null,
    err: '',
  };

  const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  async function tryTorch(constraints) {
    const videoConstraints = Object.assign(
      {
        width: { ideal: 320 },
        height: { ideal: 240 },
        frameRate: { ideal: 15 },
      },
      constraints.video
    );

    const stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: false,
    });

    const track = stream.getVideoTracks()[0];

    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      return false;
    }

    const fire = async () => {
      try {
        const capabilities = track.getCapabilities
          ? track.getCapabilities()
          : {};

        if (
          capabilities.torch === false ||
          !('torch' in capabilities)
        ) {
          return false;
        }

        await track.applyConstraints({
          advanced: [{ torch: true }],
        });

        const settings = track.getSettings
          ? track.getSettings()
          : {};

        return (
          settings.torch === true ||
          (
            !!capabilities.torch &&
            settings.torch === undefined
          )
        );
      } catch {
        return false;
      }
    };

    let ok = await fire();
    let video = null;

    if (!ok) {
      video = document.createElement('video');

      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');

      video.style.cssText =
        'position:fixed;left:0;top:0;width:2px;height:2px;' +
        'opacity:0.01;pointer-events:none';

      video.srcObject = stream;

      document.body.appendChild(video);

      try {
        await video.play();
      } catch {
        // Lanjutkan percobaan torch.
      }

      for (let index = 0; index < 8 && !ok; index++) {
        await sleep(100);
        ok = await fire();
      }
    }

    if (ok) {
      Object.assign(light, {
        stream,
        track,
        video,
        mode: 'torch',
      });

      try {
        const deviceId = track.getSettings().deviceId;

        if (deviceId) {
          localStorage.setItem('el-torch-dev', deviceId);
        }
      } catch {
        // Tidak wajib menyimpan ID kamera.
      }

      return true;
    }

    stream.getTracks().forEach((item) => item.stop());
    video?.remove();

    return false;
  }

  async function lightOn() {
    if (light.mode) return true;

    light.err = '';

    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      light.err = 'nosupport';
      return false;
    }

    const attempts = [];

    try {
      const savedDevice = localStorage.getItem('el-torch-dev');

      if (savedDevice) {
        attempts.push({
          video: {
            deviceId: { exact: savedDevice },
          },
        });
      }
    } catch {
      // Lanjutkan tanpa kamera tersimpan.
    }

    attempts.push({
      video: {
        facingMode: { exact: 'environment' },
      },
    });

    for (const attempt of attempts) {
      try {
        if (await tryTorch(attempt)) {
          try {
            if (navigator.wakeLock) {
              light.wake =
                await navigator.wakeLock.request('screen');
            }
          } catch {
            // Wake lock tidak didukung atau ditolak.
          }

          if (el.lightBar) {
            el.lightBar.hidden = false;
          }

          el.lightBtn?.classList.add('on');

          return true;
        }
      } catch (error) {
        if (error?.name === 'NotAllowedError') {
          light.err = 'denied';
          return false;
        }

        if (error?.name === 'NotReadableError') {
          light.err = 'busy';
        }
      }
    }

    // Coba kamera lain jika kamera utama gagal.
    try {
      const devices = (
        await navigator.mediaDevices.enumerateDevices()
      ).filter((device) => {
        return (
          device.kind === 'videoinput' &&
          !/front|depan|user/i.test(device.label)
        );
      });

      for (const device of devices) {
        try {
          if (
            await tryTorch({
              video: {
                deviceId: {
                  exact: device.deviceId,
                },
              },
            })
          ) {
            try {
              if (navigator.wakeLock) {
                light.wake =
                  await navigator.wakeLock.request('screen');
              }
            } catch {
              // Opsional.
            }

            if (el.lightBar) {
              el.lightBar.hidden = false;
            }

            el.lightBtn?.classList.add('on');

            return true;
          }
        } catch (error) {
          if (error?.name === 'NotAllowedError') {
            light.err = 'denied';
            return false;
          }

          if (error?.name === 'NotReadableError') {
            light.err = 'busy';
          }
        }
      }
    } catch {
      // Enumerasi kamera tidak tersedia.
    }

    if (!light.err) {
      light.err = 'notorch';
    }

    return false;
  }

  function lightOff() {
    if (!light.mode && !light.stream) {
      if (el.lightBar) el.lightBar.hidden = true;
      el.lightBtn?.classList.remove('on');
      return false;
    }

    try {
      if (light.track) {
        light.track.applyConstraints({
          advanced: [{ torch: false }],
        }).catch(() => {});
      }
    } catch {
      // Tetap hentikan stream.
    }

    if (light.stream) {
      light.stream.getTracks().forEach((track) => {
        track.stop();
      });
    }

    light.video?.remove();

    try {
      if (light.wake) {
        light.wake.release();
      }
    } catch {
      // Abaikan jika wake lock sudah dilepas.
    }

    Object.assign(light, {
      mode: null,
      stream: null,
      track: null,
      video: null,
      wake: null,
    });

    if (el.lightBar) {
      el.lightBar.hidden = true;
    }

    el.lightBtn?.classList.remove('on');

    return true;
  }

  function lightErrorText() {
    switch (light.err) {
      case 'denied':
        return 'Izin kamera ditolak. Buka izin situs di browser, izinkan kamera, lalu coba lagi.';

      case 'busy':
        return 'Kamera sedang digunakan aplikasi lain. Tutup aplikasi kamera lalu coba lagi.';

      case 'nosupport':
        return 'Browser tidak mendukung akses kamera. Pastikan website dibuka lewat HTTPS dan gunakan Chrome terbaru.';

      default:
        return 'Senter tidak dapat dinyalakan melalui browser pada perangkat ini. Dukungan lampu flash bergantung pada kamera dan browser.';
    }
  }

  el.lightBtn?.addEventListener('click', async () => {
    if (light.mode) {
      lightOff();
      return;
    }

    const request = ++lightRequest;

    const success = await lightOn();

    // Jika pengguna mematikan senter ketika proses masih berjalan.
    if (request !== lightRequest) {
      lightOff();
      return;
    }

    if (!success) {
      toast(lightErrorText());
    }
  });

  el.lightOffBtn?.addEventListener('click', () => {
    lightRequest++;
    lightOff();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      lightRequest++;
      lightOff();
    }
  });

  function lightCommand(text) {
    const value = (text || '').toLowerCase().trim();

    if (
      !value ||
      value.length > 60 ||
      /\?|\b(cara|bagaimana|gimana|kenapa|mengapa|apa itu|apakah|kode|buatkan|bikin)\b/.test(value)
    ) {
      return null;
    }

    const target =
      '(senter|lampu\\s*senter|flash(light)?|cahaya|lampu|torch)';

    const on = new RegExp(
      '\\b(nyala(kan|in)?|menyala(kan)?|hidup(kan|in)?|aktif(kan|in)?|on(kan)?|buka|turn on)\\b.{0,20}\\b' +
      target +
      '\\b|\\b' +
      target +
      '\\b.{0,12}\\b(on|nyala|hidup|aktif)\\b'
    );

    const off = new RegExp(
      '\\b(matikan|mati(kan|in)?|nonaktif(kan)?|off(kan)?|tutup|turn off)\\b.{0,20}\\b' +
      target +
      '\\b|\\b' +
      target +
      '\\b.{0,12}\\b(off|mati|nonaktif)\\b'
    );

    if (off.test(value)) return 'off';
    if (on.test(value)) return 'on';

    return null;
  }

  async function handleLight(text, command) {
    let chat = current();

    if (!chat) {
      chat = createChat();
    }

    const userMessage = {
      role: 'user',
      content: text,
    };

    chat.messages.push(userMessage);

    if (chat.messages.length === 1) {
      chat.title = text.length > 42
        ? text.slice(0, 42) + '…'
        : text;
    }

    if (el.welcome) el.welcome.hidden = true;
    if (el.title) el.title.textContent = chat.title;

    el.thread?.appendChild(messageEl(userMessage));

    let content;

    if (command === 'on') {
      const success = await lightOn();

      content = success
        ? 'Senter sudah menyala 🔦 Ketuk tombol Matikan atau ketik "matikan senter" untuk mematikannya.'
        : lightErrorText();
    } else {
      content = lightOff()
        ? 'Senter sudah dimatikan.'
        : 'Senter memang sedang tidak menyala.';
    }

    const reply = {
      role: 'assistant',
      content,
    };

    chat.messages.push(reply);
    chat.updated = Date.now();

    save();
    renderSidebar();

    el.thread?.appendChild(messageEl(reply));

    scrollDown(true);
  }

  /* =========================================================
     STREAMING JAWABAN AI
     ========================================================= */

  async function send(text, attachments = []) {
    if (busy) return;

    const command = attachments.length
      ? null
      : lightCommand(text);

    if (command) {
      await handleLight(text, command);
      return;
    }

    let chat = current();

    if (!chat) {
      chat = createChat();
    }

    const userMessage = {
      role: 'user',
      content: text,
    };

    if (attachments.length) {
      userMessage.atts = attachments.map((attachment) => ({
        kind: attachment.kind,
        name: attachment.name,
        thumb:
          attachment.kind === 'image'
            ? attachment.thumb
            : undefined,
      }));

      const files = attachments
        .filter((attachment) => attachment.kind === 'text')
        .map((attachment) => ({
          name: attachment.name,
          text: attachment.text,
          truncated: !!attachment.truncated,
        }));

      if (files.length) {
        userMessage.files = files;
      }

      const images = attachments
        .filter((attachment) => attachment.kind === 'image')
        .map((attachment) => attachment.dataUrl);

      if (images.length) {
        imgStore.set(userMessage, images);
      }
    }

    chat.messages.push(userMessage);

    if (chat.messages.length === 1) {
      const title =
        text ||
        attachments[0]?.name ||
        'Obrolan baru';

      chat.title = title.length > 42
        ? title.slice(0, 42) + '…'
        : title;
    }

    chat.updated = Date.now();

    const history = chat.messages.slice();

    const reply = {
      role: 'assistant',
      content: '',
    };

    chat.messages.push(reply);

    save();
    renderSidebar();

    if (el.welcome) el.welcome.hidden = true;
    if (el.title) el.title.textContent = chat.title;

    el.thread?.appendChild(messageEl(userMessage));

    const node = messageEl(reply);

    node.classList.add('streaming');

    const contentElement = node.querySelector('.content');

    const dotsHtml =
      '<span class="dots"><i></i><i></i><i></i></span>';

    if (contentElement) {
      contentElement.innerHTML = dotsHtml;
    }

    el.thread?.appendChild(node);

    scrollDown(true);

    busy = true;
    syncSend();

    controller = new AbortController();

    let paintTimer = 0;

    const paint = () => {
      paintTimer = 0;

      if (!contentElement) return;

      const shown = clean(reply.content);

      contentElement.innerHTML = shown
        ? renderMarkdown(shown)
        : dotsHtml;

      scrollDown(false);
    };

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream, application/json',
        },

        body: JSON.stringify({
          messages: buildApiMessages(history),
        }),

        signal: controller.signal,
      });

      if (!response.ok) {
        let message =
          'Maaf, terjadi kesalahan (' +
          response.status +
          ').';

        if (response.status === 413) {
          message =
            'Lampiran terlalu besar untuk dikirim. Coba kurangi ukuran file atau jumlah gambar.';
        }

        try {
          const result = await response.json();

          if (result?.error) {
            message = result.error;
          }
        } catch {
          // Respons error bukan JSON.
        }

        throw new Error(message);
      }

      if (!response.body) {
        throw new Error(
          'Browser tidak mendukung streaming jawaban. Coba gunakan Chrome terbaru.'
        );
      }

      const contentType =
        response.headers.get('content-type') || '';

      // Mendukung respons JSON biasa sebagai fallback.
      if (contentType.includes('application/json')) {
        const result = await response.json();

        const answer =
          result?.choices?.[0]?.message?.content ||
          result?.answer ||
          result?.content ||
          '';

        if (typeof answer === 'string') {
          reply.content = answer;
        } else if (Array.isArray(answer)) {
          reply.content = answer
            .map((part) => part.text || '')
            .join('');
        }
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let buffer = '';
        let finished = false;

        while (!finished) {
          const { value, done } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, {
            stream: true,
          });

          const lines = buffer.split('\n');

          buffer = lines.pop() || '';

          for (const rawLine of lines) {
            const line = rawLine.trim();

            if (!line.startsWith('data:')) continue;

            const data = line.slice(5).trim();

            if (data === '[DONE]') {
              finished = true;
              break;
            }

            try {
              const result = JSON.parse(data);

              if (result.error) {
                throw new Error(
                  typeof result.error === 'string'
                    ? result.error
                    : result.error.message || 'Terjadi kesalahan AI.'
                );
              }

              const delta =
                result.choices?.[0]?.delta?.content;

              if (typeof delta === 'string' && delta) {
                reply.content += delta;

                if (!paintTimer) {
                  paintTimer = setTimeout(paint, 60);
                }
              }
            } catch (error) {
              if (
                error instanceof Error &&
                error.message &&
                !error.message.includes('Unexpected token')
              ) {
                // Error dari API harus diteruskan.
                if (
                  error.message !==
                  'Unexpected end of JSON input'
                ) {
                  throw error;
                }
              }
            }
          }
        }

        // Proses data SSE yang mungkin tertinggal di buffer.
        const remaining = buffer.trim();

        if (
          remaining.startsWith('data:') &&
          !remaining.includes('[DONE]')
        ) {
          const data = remaining.slice(5).trim();

          try {
            const result = JSON.parse(data);

            const delta =
              result.choices?.[0]?.delta?.content;

            if (typeof delta === 'string') {
              reply.content += delta;
            }
          } catch {
            // Abaikan data SSE yang tidak lengkap.
          }
        }
      }

      reply.content = clean(reply.content);

      if (!reply.content.trim()) {
        throw new Error(
          'El Ai tidak mengirim jawaban. Coba kirim ulang pesanmu.'
        );
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        reply.content = clean(reply.content);

        if (!reply.content.trim()) {
          chat.messages = chat.messages.filter((message) => {
            return message !== reply;
          });
        }
      } else {
        chat.messages = chat.messages.filter((message) => {
          return message !== reply;
        });

        if (contentElement) {
          contentElement.replaceChildren();

          const errorBox = document.createElement('div');

          errorBox.className = 'error-box';
          errorBox.textContent =
            error?.message ||
            'Terjadi kesalahan jaringan. Coba lagi.';

          contentElement.appendChild(errorBox);
        }

        node.querySelector('.msg-actions')?.remove();

        console.error('El Ai request error:', error);
      }
    } finally {
      if (paintTimer) {
        clearTimeout(paintTimer);
      }

      if (reply.content.trim()) {
        if (contentElement) {
          contentElement.innerHTML = renderMarkdown(
            clean(reply.content)
          );
        }
      } else if (!contentElement?.querySelector('.error-box')) {
        node.remove();
      }

      node.classList.remove('streaming');

      busy = false;
      controller = null;

      chat.updated = Date.now();

      save();
      renderSidebar();
      syncSend();
      scrollDown(false);
    }
  }

  /* =========================================================
     TOMBOL SALIN
     ========================================================= */

  async function copyText(text, button, originalLabel) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');

        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';

        document.body.appendChild(textarea);

        textarea.select();

        const success = document.execCommand('copy');

        textarea.remove();

        if (!success) {
          throw new Error('copy-failed');
        }
      }

      button.textContent = 'Tersalin ✓';
    } catch {
      button.textContent = 'Gagal menyalin';
    }

    setTimeout(() => {
      button.textContent = originalLabel;
    }, 1500);
  }

  el.thread?.addEventListener('click', (event) => {
    const codeButton = event.target.closest('[data-copy-code]');

    if (codeButton) {
      const code = codeButton
        .closest('.code')
        ?.querySelector('code');

      if (code) {
        copyText(
          code.textContent,
          codeButton,
          'Salin'
        );
      }

      return;
    }

    const messageButton = event.target.closest('[data-copy-msg]');

    if (messageButton) {
      const content = messageButton
        .closest('.msg-body')
        ?.querySelector('.content');

      if (content) {
        copyText(
          content.innerText,
          messageButton,
          'Salin'
        );
      }
    }
  });

  /* =========================================================
     INISIALISASI
     ========================================================= */

  initializeTheme();
  load();
  renderSidebar();
  renderThread();
  renderTray();
  autosize();
  syncSend();

})();

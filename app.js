(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const el = {
    sidebar: $('#sidebar'), overlay: $('#overlay'), list: $('#chatList'),
    chat: $('#chat'), thread: $('#thread'), welcome: $('#welcome'), greeting: $('#greeting'),
    form: $('#composer'), input: $('#input'), send: $('#send'), title: $('#topTitle'),
    themeBtn: $('#themeBtn'), themeLabel: $('#themeLabel'),
  };

  const STORE = 'elai.chats.v1';
  const MAX_CHATS = 40;
  let chats = [];
  let currentId = null;
  let busy = false;
  let controller = null;

  /* ---------- storage ---------- */
  function load() {
    try { chats = JSON.parse(localStorage.getItem(STORE)) || []; } catch { chats = []; }
    if (!Array.isArray(chats)) chats = [];
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(chats.slice(0, MAX_CHATS))); } catch {}
  }
  const current = () => chats.find((c) => c.id === currentId) || null;

  function createChat() {
    const chat = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: 'Obrolan baru', messages: [], updated: Date.now() };
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

  function messageEl(m) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + m.role;
    if (m.role === 'user') {
      const b = document.createElement('div');
      b.className = 'bubble';
      b.textContent = m.content;
      wrap.appendChild(b);
    } else {
      const logo = document.createElement('span');
      logo.className = 'logo'; logo.textContent = 'El';
      const body = document.createElement('div');
      body.className = 'msg-body';
      const content = document.createElement('div');
      content.className = 'content';
      content.innerHTML = window.ElMd.render(m.content);
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.innerHTML = '<button type="button" class="act" data-copy-msg>Salin</button>';
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

  /* ---------- composer ---------- */
  function autosize() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 200) + 'px';
  }
  function syncSend() {
    el.send.classList.toggle('busy', busy);
    el.send.disabled = !busy && !el.input.value.trim();
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
    if (!text) return;
    el.input.value = '';
    autosize(); syncSend();
    send(text);
  });
  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-prompt]');
    if (chip && !busy) send(chip.dataset.prompt);
  });

  function stop() { if (controller) controller.abort(); }

  /* ---------- chat flow ---------- */
  async function send(text) {
    if (busy) return;
    let chat = current();
    if (!chat) chat = createChat();

    chat.messages.push({ role: 'user', content: text });
    if (chat.messages.length === 1) chat.title = text.length > 42 ? text.slice(0, 42) + '…' : text;
    chat.updated = Date.now();
    const history = chat.messages.slice();
    const reply = { role: 'assistant', content: '' };
    chat.messages.push(reply);
    save(); renderSidebar();

    el.welcome.hidden = true;
    el.title.textContent = chat.title;
    el.thread.appendChild(messageEl(chat.messages[chat.messages.length - 2]));
    const node = messageEl(reply);
    node.classList.add('streaming');
    const contentEl = node.querySelector('.content');
    contentEl.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
    el.thread.appendChild(node);
    scrollDown(true);

    busy = true; syncSend();
    controller = new AbortController();
    let raf = 0;
    const paint = () => {
      raf = 0;
      contentEl.innerHTML = window.ElMd.render(reply.content);
      scrollDown(false);
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let msg = 'Maaf, terjadi kesalahan (' + res.status + ').';
        try { const j = await res.json(); if (j && j.error) msg = j.error; } catch {}
        throw new Error(msg);
      }

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
              if (!raf) raf = requestAnimationFrame(paint);
            }
          } catch {}
        }
      }
      if (!reply.content.trim()) throw new Error('El Ai tidak mengirim jawaban. Coba kirim ulang pesanmu.');
    } catch (err) {
      if (err && err.name === 'AbortError') {
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
      if (raf) cancelAnimationFrame(raf);
      if (reply.content.trim()) contentEl.innerHTML = window.ElMd.render(reply.content);
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

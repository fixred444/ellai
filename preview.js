// Pratinjau HTML langsung di El Ai (seperti AI lain).
// - Tombol "Pratinjau" muncul di blok kode html/svg (lihat markdown.js).
// - Kode dijalankan di <iframe sandbox> TANPA allow-same-origin, jadi halaman hasil buatan AI
//   tidak bisa membaca akun, cookie, atau riwayat obrolan El Ai.
// - Kalau jawaban punya blok css / js terpisah dan HTML-nya memanggil file lokal
//   (style.css, script.js), isinya otomatis digabung supaya tampil utuh.
(function () {
  'use strict';

  let layer = null;      // elemen modal (dibuat sekali, dipakai ulang)
  let frame = null;
  let current = '';      // dokumen HTML yang sedang dipratinjau
  let lastFocus = null;

  const ICON = {
    reload: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
    down: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    full: '<rect x="3" y="5" width="18" height="14" rx="2.5"/>',
  };
  const svg = (d) => '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';

  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.id); toast.id = setTimeout(() => { t.hidden = true; }, 2200);
  }

  const isLocal = (u) => u && !/^(https?:)?\/\//i.test(u) && !/^(data|blob|about|javascript):/i.test(u);

  // Susun dokumen utuh dari blok yang diklik + blok css/js di jawaban yang sama.
  function buildDoc(codeEl) {
    let html = codeEl.textContent;
    const lang = ((codeEl.closest('.code').querySelector('.code-head span') || {}).textContent || '').toLowerCase();

    if (lang === 'svg' || /^\s*<svg[\s>]/i.test(html)) {
      html = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}body{display:grid;place-items:center}svg{max-width:100%;max-height:100%}</style></head><body>' + html + '</body></html>';
    }

    const scope = codeEl.closest('.content') || codeEl.closest('.msg-body') || document;
    const css = [], js = [];
    scope.querySelectorAll('.code').forEach((b) => {
      const l = ((b.querySelector('.code-head span') || {}).textContent || '').toLowerCase();
      const c = b.querySelector('code').textContent;
      if (l === 'css') css.push(c);
      else if (/^(js|javascript|mjs)$/.test(l)) js.push(c);
    });

    if (css.length) {
      let first = true;
      html = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, (tag) => {
        const m = tag.match(/href=["']?([^"'\s>]+)/i);
        if (!m || !isLocal(m[1])) return tag;
        if (first) { first = false; return '<style>' + css.join('\n') + '</style>'; }
        return '';
      });
    }
    if (js.length) {
      let first = true;
      html = html.replace(/<script\b[^>]*\bsrc=["']?([^"'\s>]+)["']?[^>]*>\s*<\/script>/gi, (tag, src) => {
        if (!isLocal(src)) return tag;
        if (first) { first = false; return '<script>' + js.join('\n').replace(/<\/script/gi, '<\\/script') + '<\/script>'; }
        return '';
      });
    }

    if (!/<html[\s>]/i.test(html) && !/<!doctype/i.test(html)) {
      html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' + html + '</body></html>';
    } else if (!/<meta[^>]+viewport/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (h) => h + '<meta name="viewport" content="width=device-width, initial-scale=1">');
    }
    return html;
  }

  function build() {
    layer = document.createElement('div');
    layer.className = 'pv-layer';
    layer.hidden = true;
    layer.innerHTML =
      '<div class="pv-card" role="dialog" aria-modal="true" aria-label="Pratinjau HTML">' +
        '<div class="pv-bar">' +
          '<strong class="pv-title">Pratinjau</strong>' +
          '<div class="pv-seg" role="group" aria-label="Ukuran tampilan">' +
            '<button type="button" data-w="phone" aria-label="Ukuran ponsel" title="Ponsel">' + svg(ICON.phone) + '</button>' +
            '<button type="button" data-w="full" aria-label="Lebar penuh" title="Lebar penuh" class="on">' + svg(ICON.full) + '</button>' +
          '</div>' +
          '<button type="button" class="pv-btn" data-act="reload" aria-label="Muat ulang" title="Muat ulang">' + svg(ICON.reload) + '</button>' +
          '<button type="button" class="pv-btn" data-act="download" aria-label="Unduh .html" title="Unduh .html">' + svg(ICON.down) + '</button>' +
          '<button type="button" class="pv-btn" data-act="close" aria-label="Tutup" title="Tutup">' + svg(ICON.close) + '</button>' +
        '</div>' +
        '<div class="pv-stage" data-w="full"><iframe class="pv-frame" title="Hasil HTML" sandbox="allow-scripts allow-forms allow-modals allow-popups" referrerpolicy="no-referrer"></iframe></div>' +
        '<p class="pv-note">Berjalan terisolasi: halaman ini tidak bisa mengakses akun atau obrolan kamu.</p>' +
      '</div>';
    document.body.appendChild(layer);
    frame = layer.querySelector('.pv-frame');

    layer.addEventListener('click', (e) => {
      if (e.target === layer) return close();
      const act = e.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'close') close();
        else if (a === 'reload') frame.srcdoc = current;
        else if (a === 'download') download();
        return;
      }
      const w = e.target.closest('[data-w]');
      if (w && w.tagName === 'BUTTON') {
        layer.querySelectorAll('.pv-seg button').forEach((b) => b.classList.toggle('on', b === w));
        layer.querySelector('.pv-stage').dataset.w = w.dataset.w;
      }
    });
  }

  function open(html) {
    if (!layer) build();
    current = html;
    lastFocus = document.activeElement;
    frame.srcdoc = html;
    layer.hidden = false;
    document.body.classList.add('pv-open');
    layer.querySelector('[data-act="close"]').focus({ preventScroll: true });
  }

  function close() {
    if (!layer || layer.hidden) return;
    layer.hidden = true;
    frame.srcdoc = '';          // hentikan skrip yang masih berjalan
    document.body.classList.remove('pv-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function download() {
    const url = URL.createObjectURL(new Blob([current], { type: 'text/html;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'el-ai-halaman.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Mengunduh el-ai-halaman.html');
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preview-code]');
    if (!btn) return;
    const code = btn.closest('.code') && btn.closest('.code').querySelector('code');
    if (!code || !code.textContent.trim()) return;
    open(buildDoc(code));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && layer && !layer.hidden) { e.preventDefault(); close(); }
  });

  window.ElPreview = { open, close };
})();

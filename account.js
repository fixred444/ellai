// Memeriksa login, menampilkan kuota & akun, paket, dan layar "akun dibatasi".
// Setelah login dipastikan, skrip aplikasi (markdown, convert, study, app) dimuat.
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const idr = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
  const fmtDate = (t) => new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  let me = null;

  async function api(path, body) {
    const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const j = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, j };
  }
  function toLogin() { location.replace('/masuk.html?next=' + encodeURIComponent(location.pathname)); }

  /* ---------- kuota & akun ---------- */
  function renderQuota() {
    const q = me.quota, box = $('#quota');
    box.hidden = false;
    if (q.limit === null) {
      $('#qText').textContent = 'Tanpa batas';
      $('#qFill').style.width = '0';
      $('#qSub').textContent = 'Akun admin.';
      $('#upgradeBtn').hidden = true;
      return;
    }
    const left = Math.max(0, q.limit - q.used);
    $('#qText').textContent = left + ' / ' + q.limit + ' token';
    $('#qFill').style.width = Math.min(100, (q.used / q.limit) * 100) + '%';
    box.classList.toggle('low', left <= q.limit * 0.2 && left > 0);
    box.classList.toggle('out', left === 0);
    $('#qSub').textContent = `Lite ${q.costs.lite} · Pro ${q.costs.pro} · Max ${q.costs.max} token per pesan. Reset pukul 00.00 WIB.`;
  }
  function renderAcct() {
    const u = me.user;
    $('#acct').hidden = false;
    $('#avatar').textContent = (u.name || '?').trim().charAt(0).toUpperCase();
    $('#acctName').textContent = u.name;
    $('#acctPlan').textContent = u.role === 'admin' ? 'Admin' : u.sub ? `${u.sub.planName} · sampai ${fmtDate(u.sub.until)}` : 'Paket gratis';
    $('#adminLink').hidden = u.role !== 'admin';
  }
  $('#acctBtn').addEventListener('click', (e) => { e.stopPropagation(); const m = $('#acctMenu'); m.hidden = !m.hidden; $('#acctBtn').setAttribute('aria-expanded', String(!m.hidden)); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#acct')) $('#acctMenu').hidden = true; });
  $('#logoutBtn').addEventListener('click', async () => { await api('/api/auth', { action: 'logout' }); location.replace('/masuk.html'); });

  /* ---------- paket & pembayaran ---------- */
  function modal(html) {
    let bg = $('#modalBg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'modalBg'; bg.className = 'modal-bg'; document.body.appendChild(bg); bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) bg.hidden = true; }); }
    bg.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
    bg.hidden = false;
    return bg;
  }
  const ORDER_LABEL = { unpaid: 'Belum dibayar', pending: 'Menunggu konfirmasi', paid: 'Aktif', rejected: 'Ditolak', cancelled: 'Dibatalkan' };
  const X_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  // Perkecil foto di browser sebelum diunggah (hemat kuota dan muat di batas server).
  function shrink(file, maxSide, q) {
    return new Promise((ok, no) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', q));
      };
      img.onerror = () => { URL.revokeObjectURL(url); no(new Error('File itu bukan foto yang bisa dibaca.')); };
      img.src = url;
    });
  }
  async function refreshMe() { const r = await api('/api/me'); if (r.ok) { me = r.j; renderQuota(); renderAcct(); } }

  async function openPlans() {
    await refreshMe();
    const plans = me.plans.map((p) => `
      <div class="plan">
        <strong>${esc(p.name)}</strong>
        <div class="p-price">${p.pct ? `<s>${idr(p.base)}</s>` : ''}${idr(p.final)}${p.pct ? `<em>-${p.pct}%</em>` : ''}</div>
        <div class="p-meta">${p.dailyQuota} token per hari · ${p.days} hari${p.pct && p.discountUntil ? ' · diskon sampai ' + fmtDate(p.discountUntil) : ''}</div>
        <button type="button" data-plan="${esc(p.id)}">Beli</button>
      </div>`).join('');
    const orders = me.orders.length ? `<ul class="m-list">${me.orders.slice(0, 5).map((o) => `<li><span>${esc(o.planName)} · ${idr(o.amount)}</span><b>${ORDER_LABEL[o.status] || o.status}${o.status === 'unpaid' ? ` <a href="#" data-pay="${esc(o.id)}">bayar</a>` : ''}${o.status === 'unpaid' || o.status === 'pending' ? ` <a href="#" data-cancel="${esc(o.id)}">batal</a>` : ''}</b></li>`).join('')}</ul>` : '';
    const bg = modal(`
      <button class="icon-btn m-close" type="button" data-close aria-label="Tutup">${X_ICON}</button>
      <h3>Tambah kuota</h3>
      <p class="m-sub">Akun gratis dapat kuota harian tetap. Paket berbayar menaikkan kuota harianmu.</p>
      <div class="plans">${plans || '<p class="m-sub">Belum ada paket yang dibuka.</p>'}</div>${orders}`);
    bg.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      const r = await api('/api/account', { action: 'order', planId: b.dataset.plan });
      if (r.ok) { await refreshMe(); payPanel(r.j.order); }
      else { toast(r.j.error || 'Gagal membuat pesanan.'); b.disabled = false; }
    }));
    bg.querySelectorAll('[data-pay]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const o = me.orders.find((x) => x.id === a.dataset.pay); if (o) payPanel(o); }));
    bg.querySelectorAll('[data-cancel]').forEach((a) => a.addEventListener('click', async (e) => { e.preventDefault(); await api('/api/account', { action: 'cancel_order', id: a.dataset.cancel }); openPlans(); }));
  }

  // Langkah pembayaran: tujuan transfer + unggah foto bukti.
  async function payPanel(order) {
    const pm = me.payment || {};
    const rows = [];
    if (pm.dana) rows.push(['DANA', pm.dana]);
    if (pm.gopay) rows.push(['GoPay', pm.gopay]);
    if (pm.holder) rows.push(['Atas nama', pm.holder]);
    const sent = order.hasProof;
    const bg = modal(`
      <button class="icon-btn m-close" type="button" data-close aria-label="Tutup">${X_ICON}</button>
      <h3>Bayar ${esc(order.planName)}</h3>
      <p class="m-sub">Transfer tepat <b style="color:var(--text)">${idr(order.amount)}</b>, lalu unggah foto bukti transfernya.</p>
      ${rows.length || pm.hasQris ? `<ul class="m-list" style="margin-top:0">${rows.map(([k, v]) => `<li><span>${esc(k)}</span><b>${esc(v)}${k !== 'Atas nama' ? ` <a href="#" data-copy="${esc(v)}">salin</a>` : ''}</b></li>`).join('')}</ul>` : '<p class="note-box">Admin belum mengisi tujuan pembayaran. Coba lagi nanti.</p>'}
      ${pm.hasQris ? '<div id="qrisBox" class="qris">Memuat QRIS…</div>' : ''}
      ${pm.instructions ? `<p class="note-box">${esc(pm.instructions)}</p>` : ''}
      <div class="proof">
        <label>${sent ? 'Bukti sudah terkirim. Kamu bisa menggantinya:' : 'Foto bukti transfer'}</label>
        <input type="file" id="proofFile" accept="image/*" hidden>
        <img id="proofPrev" alt="Pratinjau bukti" hidden>
        <p class="gate-msg" id="proofMsg" hidden></p>
        <div class="gate-actions"><button class="btn" id="proofPick" type="button">${sent ? 'Ganti foto' : 'Pilih foto bukti'}</button><button class="btn primary" id="proofSend" type="button" disabled>Kirim bukti</button></div>
        ${sent ? '<p class="m-sub" style="margin:12px 0 0">Menunggu konfirmasi admin. Kuotamu naik setelah dikonfirmasi.</p>' : ''}
      </div>`);
    bg.querySelectorAll('[data-copy]').forEach((a) => a.addEventListener('click', async (e) => { e.preventDefault(); try { await navigator.clipboard.writeText(a.dataset.copy); a.textContent = 'tersalin'; } catch { a.textContent = 'gagal'; } }));
    if (pm.hasQris) realFetch('/api/account?view=qris').then((r) => r.json()).then((j) => { const q = bg.querySelector('#qrisBox'); if (q) q.innerHTML = j.image ? `<img src="${j.image}" alt="QRIS">` : ''; }).catch(() => {});
    let data = null;
    const msg = bg.querySelector('#proofMsg'), send = bg.querySelector('#proofSend'), prev = bg.querySelector('#proofPrev');
    bg.querySelector('#proofPick').onclick = () => bg.querySelector('#proofFile').click();
    bg.querySelector('#proofFile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      msg.hidden = true;
      try { data = await shrink(f, 1200, 0.72); prev.src = data; prev.hidden = false; send.disabled = false; }
      catch (err) { msg.textContent = err.message; msg.hidden = false; }
    };
    send.onclick = async () => {
      send.disabled = true; send.textContent = 'Mengirim…';
      const r = await api('/api/account', { action: 'proof', id: order.id, image: data });
      if (r.ok) { await refreshMe(); modal(`<button class="icon-btn m-close" type="button" data-close aria-label="Tutup">${X_ICON}</button><h3>Bukti terkirim</h3><p class="m-sub">Admin akan memeriksa pembayaranmu. Kuota naik otomatis setelah dikonfirmasi. Statusnya bisa dilihat di menu Tambah kuota.</p><div class="gate-actions"><button class="btn primary" data-close type="button">Oke</button></div>`); }
      else { msg.textContent = r.j.error || 'Gagal mengirim bukti.'; msg.hidden = false; send.disabled = false; send.textContent = 'Kirim bukti'; }
    };
  }
  $('#upgradeBtn').addEventListener('click', openPlans);

  /* ---------- layar akun dibatasi + banding ---------- */
  const GATE = {
    frozen:             { h: 'Akunmu dibekukan', p: 'Admin membekukan akun ini, jadi El Ai tidak bisa dipakai untuk sementara. Kalau menurutmu ini keliru, ajukan banding di bawah.', label: 'Alasan bandingmu', btn: 'Kirim banding' },
    deactivated:        { h: 'Akunmu dinonaktifkan', p: 'Akun ini dinonaktifkan karena batas usia pengguna. Kalau data tanggal lahirmu salah, jelaskan di bawah.', label: 'Penjelasanmu', btn: 'Kirim pengajuan' },
    needs_verification: { h: 'Akunmu perlu diverifikasi', p: 'Admin meminta verifikasi sebelum akun bisa dipakai lagi. Tulis informasi yang membantu admin memastikan kamu pemilik akun ini.', label: 'Keterangan verifikasi', btn: 'Kirim verifikasi' },
  };
  function showGate() {
    const u = me.user, g = GATE[u.status];
    let gate = $('#gate');
    if (!g) { if (gate) gate.hidden = true; return; }
    if (!gate) { gate = document.createElement('div'); gate.id = 'gate'; gate.className = 'gate'; document.body.appendChild(gate); }
    const last = me.tickets[0];
    const open = last && last.status === 'open';
    const rejected = last && last.status === 'rejected';
    gate.hidden = false;
    gate.innerHTML = `<div class="gate-card">
      <span class="logo">El</span>
      <h2>${g.h}</h2>
      <p>${g.p}</p>
      ${u.statusNote ? `<div class="gate-reason"><b>Catatan admin:</b> ${esc(u.statusNote)}</div>` : ''}
      ${open ? `<div class="note-box"><b>Pengajuanmu sedang ditinjau.</b>\nDikirim ${fmtDate(last.createdAt)}. Kami akan membuka akunmu jika disetujui. Muat ulang halaman ini untuk memeriksa status.</div>` : `
        ${rejected ? `<p class="gate-msg">Pengajuan terakhir ditolak${last.adminNote ? ': ' + esc(last.adminNote) : '.'}</p>` : ''}
        <form id="gateForm">
          <label for="gMsg">${g.label}</label>
          <textarea id="gMsg" maxlength="1500" placeholder="Jelaskan dengan singkat dan jujur (minimal 10 karakter)"></textarea>
          <label for="gContact">Kontak (opsional)</label>
          <input id="gContact" maxlength="120" placeholder="WhatsApp / Instagram / email lain">
          <p class="gate-msg" id="gErr" hidden></p>
          <div class="gate-actions"><button class="btn primary" type="submit">${g.btn}</button></div>
        </form>`}
      <div class="gate-actions" style="margin-top:18px"><button class="btn" id="gRefresh" type="button">Periksa status</button><button class="btn" id="gOut" type="button">Keluar</button></div>
    </div>`;
    $('#gRefresh').onclick = () => location.reload();
    $('#gOut').onclick = () => $('#logoutBtn').click();
    const f = $('#gateForm');
    if (f) f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#gErr'), btn = f.querySelector('button');
      btn.disabled = true;
      const r = await api('/api/account', { action: 'ticket', message: $('#gMsg').value, contact: $('#gContact').value });
      if (r.ok) { const m = await api('/api/me'); if (m.ok) { me = m.j; showGate(); } }
      else { err.textContent = r.j.error || 'Gagal mengirim.'; err.hidden = false; btn.disabled = false; }
    });
  }

  /* ---------- pantau respons /api/chat ---------- */
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await realFetch(input, init);
    const url = typeof input === 'string' ? input : input && input.url;
    if (url && url.indexOf('/api/chat') === 0 && me) {
      if (res.status === 401) toLogin();
      else if (res.status === 403) { const m = await api('/api/me'); if (m.ok) { me = m.j; showGate(); } }
      else if (res.status === 429) { res.clone().json().then((j) => { if (j.code === 'quota') { me.quota.used = j.used; renderQuota(); openPlans(); } }).catch(() => {}); }
      else if (res.ok) {
        const used = res.headers.get('X-El-Used');
        if (used !== null) { me.quota.used = parseInt(used, 10); renderQuota(); }
      }
    }
    return res;
  };

  /* ---------- mulai ---------- */
  function loadScripts(list, done) {
    const next = () => {
      const src = list.shift();
      if (!src) return done();
      const s = document.createElement('script'); s.src = src; s.onload = next; s.onerror = next; document.body.appendChild(s);
    };
    next();
  }
  (async () => {
    let r;
    try { r = await api('/api/me'); } catch { document.body.classList.remove('booting'); return; }
    if (r.status === 401) return toLogin();
    if (!r.ok) { document.body.classList.remove('booting'); return; }
    me = r.j;
    window.ELAI_USER = me.user;
    // Riwayat obrolan lama (sebelum ada login) dipindahkan ke akun admin sekali saja.
    try {
      const k = 'elai.chats.v1.' + me.user.id, old = localStorage.getItem('elai.chats.v1');
      if (me.user.role === 'admin' && old && !localStorage.getItem(k)) localStorage.setItem(k, old);
    } catch {}
    renderAcct(); renderQuota(); showGate();
    loadScripts(['markdown.js', 'convert.js', 'study.js', 'app.js'], () => document.body.classList.remove('booting'));
  })();
})();

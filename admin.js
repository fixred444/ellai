(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const idr = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  const dt = (t) => t ? new Date(t).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
  const d = (t) => t ? new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';
  const STATUS = { active: 'Aktif', frozen: 'Dibekukan', deactivated: 'Nonaktif (usia)', needs_verification: 'Butuh verifikasi' };
  const OSTAT = { unpaid: 'Belum bayar', pending: 'Menunggu', paid: 'Lunas', rejected: 'Ditolak', cancelled: 'Dibatalkan' };
  const TSTAT = { open: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' };
  const badge = (cls, txt) => `<span class="badge b-${cls}">${esc(txt)}</span>`;
  const OSTAT_X = { unpaid: 'Belum bayar' };
  function shrink(file, maxSide, q) {
    return new Promise((ok, no) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', q));
      };
      img.onerror = () => { URL.revokeObjectURL(url); no(new Error('File bukan gambar yang bisa dibaca.')); };
      img.src = url;
    });
  }
  let view = 'overview', users = [], userQuery = '', userFilter = '';

  let tt = 0;
  function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 3200); }
  async function api(view, body) {
    const res = body ? await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) : await fetch('/api/admin?view=' + view);
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) { location.replace('/masuk?next=/admin'); throw new Error('auth'); }
    if (res.status === 403) { document.body.innerHTML = '<main class="view"><h1>Khusus admin</h1><p class="lead">Akunmu tidak punya akses ke halaman ini.</p><a class="btn" href="/">Kembali ke chat</a></main>'; throw new Error('forbidden'); }
    if (!res.ok) throw new Error(j.error || 'Terjadi kesalahan.');
    return j;
  }
  const closeModal = () => { $('#mbg').hidden = true; };
  function openModal(html) { $('#modal').innerHTML = html; $('#mbg').hidden = false; }
  $('#mbg').addEventListener('click', (e) => { if (e.target.id === 'mbg' || e.target.closest('[data-x]')) closeModal(); });
  $('#out').onclick = async () => { await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }); location.replace('/masuk'); };

  /* ---------- navigasi ---------- */
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.v); });
  async function go(v) {
    view = v;
    document.querySelectorAll('#nav button').forEach((b) => b.toggleAttribute('aria-current', b.dataset.v === v));
    document.querySelectorAll('#nav button').forEach((b) => { if (b.dataset.v === v) b.setAttribute('aria-current', 'page'); });
    const el = $('#view'); el.innerHTML = '<p class="muted">Memuat…</p>';
    try { await ({ overview, users: usersView, tickets, orders, config, log })[v](el); } catch (e) { if (e.message !== 'auth' && e.message !== 'forbidden') el.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  }
  async function badges() {
    try {
      const { stats } = await api('overview');
      const set = (id, n) => { const e = $(id); e.hidden = !n; e.textContent = n; };
      set('#bTickets', stats.openTickets); set('#bOrders', stats.pendingOrders);
    } catch {}
  }

  /* ---------- ringkasan ---------- */
  async function overview(el) {
    const { stats: s } = await api('overview');
    const box = (n, l, hot) => `<div class="stat${hot && n ? ' hot' : ''}"><b>${n}</b><span>${l}</span></div>`;
    el.innerHTML = `<h1>Ringkasan</h1><p class="lead">Kondisi El Ai saat ini.</p>
      <div class="stats">
        ${box(s.users, 'Total pengguna')}${box(s.active, 'Akun aktif')}${box(s.subscribers, 'Berlangganan')}${box(s.tokensToday, 'Token terpakai hari ini')}
        ${box(s.openTickets, 'Banding & verifikasi menunggu', 1)}${box(s.pendingOrders, 'Pembayaran menunggu', 1)}
        ${box(s.frozen, 'Dibekukan')}${box(s.deactivated, 'Nonaktif karena usia')}${box(s.needsVerification, 'Butuh verifikasi')}
        ${box(idr(s.revenue30d), 'Pendapatan 30 hari')}
      </div>`;
  }

  /* ---------- pengguna ---------- */
  async function usersView(el) {
    users = (await api('users')).users;
    el.innerHTML = `<h1>Pengguna</h1><p class="lead">Klik baris untuk membekukan, menonaktifkan, meminta verifikasi, atau mengatur kuota dan paket.</p>
      <div class="tools"><input id="uq" type="search" placeholder="Cari nama atau email" value="${esc(userQuery)}">
        <select id="uf"><option value="">Semua status</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${userFilter === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="tablewrap"><table><thead><tr><th>Pengguna</th><th>Status</th><th>Usia</th><th>Paket</th><th class="num">Token hari ini</th><th>Daftar</th></tr></thead><tbody id="ub"></tbody></table></div>`;
    $('#uq').oninput = (e) => { userQuery = e.target.value; paintUsers(); };
    $('#uf').onchange = (e) => { userFilter = e.target.value; paintUsers(); };
    paintUsers();
  }
  function paintUsers() {
    const q = userQuery.trim().toLowerCase();
    const list = users.filter((u) => (!userFilter || u.status === userFilter) && (!q || u.name.toLowerCase().includes(q) || u.email.includes(q)));
    $('#ub').innerHTML = list.length ? list.map((u) => `<tr class="click" data-id="${esc(u.id)}">
      <td>${esc(u.name)}${u.role === 'admin' ? ' ' + badge('active', 'Admin') : ''}<span class="sm">${esc(u.email)}</span></td>
      <td>${badge(u.status, STATUS[u.status] || u.status)}${u.verified ? '<span class="sm">Terverifikasi</span>' : ''}</td>
      <td>${u.age == null ? '–' : u.age + ' th'}</td>
      <td>${u.sub ? esc(u.sub.planName) + `<span class="sm">sampai ${d(u.sub.until)}</span>` : '<span class="muted">Gratis</span>'}</td>
      <td class="num">${u.usedToday}${u.quotaOverride !== null ? `<span class="sm">batas ${u.quotaOverride}</span>` : ''}</td>
      <td>${d(u.createdAt)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">Tidak ada pengguna.</td></tr>';
    $('#ub').querySelectorAll('tr.click').forEach((tr) => tr.onclick = () => userModal(users.find((u) => u.id === tr.dataset.id)));
  }
  function userModal(u) {
    if (u.role === 'admin') return toast('Akun admin tidak bisa diubah dari sini.');
    openModal(`<h3>${esc(u.name)}</h3><p class="sub">${esc(u.email)}</p>
      <dl class="kv"><dt>Status</dt><dd>${badge(u.status, STATUS[u.status])} ${u.statusNote ? '<span class="muted">' + esc(u.statusNote) + '</span>' : ''}</dd>
        <dt>Usia</dt><dd>${u.age == null ? '–' : u.age + ' tahun (lahir ' + esc(u.birth) + ')'}</dd>
        <dt>Verifikasi</dt><dd>${u.verified ? 'Sudah' : 'Belum'}</dd>
        <dt>Paket</dt><dd>${u.sub ? esc(u.sub.planName) + ' sampai ' + d(u.sub.until) : 'Gratis'}</dd>
        <dt>Token hari ini</dt><dd>${u.usedToday}${u.quotaOverride !== null ? ' (batas khusus ' + u.quotaOverride + ')' : ''}</dd>
        <dt>Terakhir masuk</dt><dd>${dt(u.lastLoginAt)}</dd></dl>
      <label class="f">Catatan untuk pengguna (tampil di layar akunnya)<textarea id="un" maxlength="500" placeholder="Opsional, contoh: Usia di bawah batas minimum."></textarea></label>
      <div class="acts">
        ${u.status !== 'frozen' ? '<button class="btn danger" data-op="freeze">Bekukan</button>' : ''}
        ${u.status !== 'deactivated' ? '<button class="btn danger" data-op="deactivate_age">Nonaktifkan (usia)</button>' : ''}
        ${u.status !== 'needs_verification' ? '<button class="btn" data-op="require_verification">Minta verifikasi</button>' : ''}
        ${u.status !== 'active' ? '<button class="btn primary" data-op="activate">Aktifkan kembali</button>' : ''}
        ${!u.verified ? '<button class="btn" data-op="verify">Tandai terverifikasi</button>' : ''}
      </div>
      <div class="sec"><h4>Kuota harian</h4><div class="acts" style="margin-top:0"><input id="uqv" type="number" min="0" placeholder="Bawaan" value="${u.quotaOverride ?? ''}" style="width:130px"><button class="btn sm" data-op="set_quota">Atur batas</button><button class="btn sm" data-op="reset_usage">Reset pemakaian hari ini</button></div></div>
      <div class="sec"><h4>Beri / cabut paket</h4><div class="acts" style="margin-top:0"><select id="ugp"><option value="weekly">Mingguan</option><option value="monthly">Bulanan</option><option value="yearly">Tahunan</option><option value="none">Cabut paket</option></select><button class="btn sm" data-op="grant">Terapkan</button></div></div>
      <div class="sec acts"><button class="btn danger sm" data-op="delete">Hapus akun</button><span class="grow"></span><button class="btn" data-x>Tutup</button></div>`);
    $('#modal').querySelectorAll('[data-op]').forEach((b) => b.onclick = async () => {
      const op = b.dataset.op;
      if (op === 'delete' && !confirm(`Hapus akun ${u.email} secara permanen?`)) return;
      if (op === 'freeze' && !confirm(`Bekukan akun ${u.email}?`)) return;
      const body = { action: 'user', id: u.id, op, note: $('#un').value };
      if (op === 'set_quota') body.value = $('#uqv').value;
      if (op === 'grant') body.planId = $('#ugp').value;
      b.disabled = true;
      try { await api(null, body); toast('Tersimpan.'); closeModal(); go('users'); badges(); } catch (e) { toast(e.message); b.disabled = false; }
    });
  }

  /* ---------- banding & verifikasi ---------- */
  async function tickets(el) {
    const list = (await api('tickets')).tickets;
    const open = list.filter((t) => t.status === 'open'), done = list.filter((t) => t.status !== 'open');
    el.innerHTML = `<h1>Banding &amp; verifikasi</h1><p class="lead">Pengajuan dari akun yang dibekukan, dinonaktifkan, atau diminta verifikasi. Menyetujui akan mengaktifkan kembali akunnya.</p>
      <h2>Menunggu (${open.length})</h2><div class="cards" id="to">${open.length ? '' : '<p class="empty card">Tidak ada pengajuan baru.</p>'}</div>
      <h2>Riwayat</h2><div class="tablewrap"><table><tbody>${done.length ? done.map((t) => `<tr><td>${esc(t.userName)}<span class="sm">${esc(t.userEmail)}</span></td><td>${t.type === 'verification' ? 'Verifikasi' : 'Banding'}</td><td>${badge(t.status, TSTAT[t.status])}</td><td class="muted">${esc(t.adminNote || '')}</td><td>${d(t.resolvedAt)}</td></tr>`).join('') : '<tr><td class="empty">Belum ada.</td></tr>'}</tbody></table></div>`;
    const to = $('#to');
    open.forEach((t) => {
      const c = document.createElement('div'); c.className = 'card';
      c.innerHTML = `<div class="hd"><strong>${esc(t.userName)} <span class="muted">${esc(t.userEmail)}</span></strong><span>${badge('open', t.type === 'verification' ? 'Verifikasi' : 'Banding')} <span class="muted">${dt(t.createdAt)}</span></span></div>
        <p>${esc(t.message)}</p>${t.contact ? `<p class="muted">Kontak: ${esc(t.contact)}</p>` : ''}
        <div class="row"><input placeholder="Catatan untuk pengguna (opsional)" maxlength="500"><button class="btn primary sm" data-d="approve">Setujui</button><button class="btn danger sm" data-d="reject">Tolak</button></div>`;
      c.querySelectorAll('[data-d]').forEach((b) => b.onclick = async () => {
        b.disabled = true;
        try { await api(null, { action: 'ticket', id: t.id, decision: b.dataset.d, note: c.querySelector('input').value }); toast('Diproses.'); go('tickets'); badges(); } catch (e) { toast(e.message); b.disabled = false; }
      });
      to.appendChild(c);
    });
  }

  /* ---------- pembayaran ---------- */
  async function orders(el) {
    const list = (await api('orders')).orders;
    el.innerHTML = `<h1>Pembayaran</h1><p class="lead">Pesanan paket dari pengguna. Cek foto bukti transfer, lalu konfirmasi agar paketnya aktif.</p>
      <div class="tablewrap"><table><thead><tr><th>Pengguna</th><th>Paket</th><th class="num">Nominal</th><th>Status</th><th>Dipesan</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((o) => `<tr><td>${esc(o.userName)}<span class="sm">${esc(o.userEmail)}</span></td><td>${esc(o.planName)}<span class="sm">${o.days} hari</span></td>
        <td class="num">${idr(o.amount)}${o.discountPct ? `<span class="sm">diskon ${o.discountPct}%</span>` : ''}</td><td>${badge(o.status === 'unpaid' ? 'pending' : o.status, OSTAT[o.status] || o.status)}${o.status === 'unpaid' ? '<span class="sm">belum ada bukti</span>' : ''}</td><td>${dt(o.createdAt)}</td>
        <td>${o.hasProof ? `<button class="btn sm" data-proof="${esc(o.id)}">Lihat bukti</button> ` : ''}${o.status === 'pending' ? `<button class="btn primary sm" data-o="${esc(o.id)}" data-d="confirm">Konfirmasi</button> ` : ''}${o.status === 'pending' || o.status === 'unpaid' ? `<button class="btn danger sm" data-o="${esc(o.id)}" data-d="reject">Tolak</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">Belum ada pesanan.</td></tr>'}</tbody></table></div>`;
    el.querySelectorAll('[data-proof]').forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api('proof&id=' + encodeURIComponent(b.dataset.proof));
        openModal(`<h3>Bukti transfer</h3><p class="sub">${esc(r.order.userName)} · ${esc(r.order.planName)} · ${idr(r.order.amount)}</p>
          ${r.image ? `<img src="${r.image}" alt="Bukti transfer" style="max-width:100%;max-height:70vh;display:block;margin:0 auto;border:1px solid var(--line);border-radius:8px">` : '<p class="muted">Foto tidak ditemukan.</p>'}
          <div class="acts"><span class="grow"></span><button class="btn" data-x>Tutup</button></div>`);
      } catch (e) { toast(e.message); }
      b.disabled = false;
    });
    el.querySelectorAll('[data-o]').forEach((b) => b.onclick = async () => {
      if (b.dataset.d === 'confirm' && !confirm('Pastikan nominal di bukti sesuai. Paket akan langsung aktif. Lanjut?')) return;
      b.disabled = true;
      try { await api(null, { action: 'order', id: b.dataset.o, decision: b.dataset.d }); toast('Diproses.'); go('orders'); badges(); } catch (e) { toast(e.message); b.disabled = false; }
    });
  }

  /* ---------- harga, diskon, kuota ---------- */
  async function config(el) {
    const c = (await api('config')).config;
    const localDate = (iso) => iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    el.innerHTML = `<h1>Harga &amp; kuota</h1><p class="lead">Harga paket, diskon, kuota harian, dan biaya token per tingkatan.</p>
      <h2>Paket berlangganan</h2>
      ${c.plans.map((p) => `<div class="plan-row" data-p="${p.id}"><h3>${esc(p.name)} <label class="chk"><input type="checkbox" data-k="active" ${p.active ? 'checked' : ''}> Dijual</label></h3>
        <div class="grid2">
          <label class="f">Harga (Rp)<input data-k="price" type="number" min="0" value="${p.price}"></label>
          <label class="f">Diskon (%)<input data-k="discountPct" type="number" min="0" max="100" value="${p.discountPct}"></label>
          <label class="f">Diskon berakhir<input data-k="discountUntil" type="datetime-local" value="${localDate(p.discountUntil)}"></label>
          <label class="f">Kuota harian pelanggan<input data-k="dailyQuota" type="number" min="0" value="${p.dailyQuota}"></label>
        </div><div class="final"></div></div>`).join('')}
      <h2>Kuota &amp; biaya token</h2>
      <div class="grid2">
        <label class="f">Kuota harian akun gratis<input id="cFree" type="number" min="0" value="${c.freeQuota}"></label>
        <label class="f">El Lite (token/pesan)<input id="cLite" type="number" min="1" value="${c.costs.lite}"></label>
        <label class="f">El Pro (token/pesan)<input id="cPro" type="number" min="1" value="${c.costs.pro}"></label>
        <label class="f">El Max (token/pesan)<input id="cMax" type="number" min="1" value="${c.costs.max}"></label>
        <label class="f">Usia minimum daftar<input id="cAge" type="number" min="0" max="30" value="${c.minAge}"></label>
      </div>
      <h2>Tujuan pembayaran</h2>
      <div class="grid2">
        <label class="f">Nama penerima<input id="cHolder" maxlength="60" value="${esc(c.payment.holder)}" placeholder="Nama di akun DANA/GoPay"></label>
        <label class="f">Nomor DANA<input id="cDana" inputmode="tel" maxlength="25" value="${esc(c.payment.dana)}" placeholder="08xxxxxxxxxx"></label>
        <label class="f">Nomor GoPay<input id="cGopay" inputmode="tel" maxlength="25" value="${esc(c.payment.gopay)}" placeholder="08xxxxxxxxxx"></label>
      </div>
      <div class="plan-row qris-row" style="margin-top:12px"><h3>Foto QRIS</h3>
        <div id="qBox" class="muted" style="margin-bottom:10px">${c.payment.hasQris ? 'Memuat…' : 'Belum ada foto QRIS.'}</div>
        <div class="acts" style="margin:0"><input type="file" id="qFile" accept="image/*" hidden><button class="btn sm" id="qPick" type="button">${c.payment.hasQris ? 'Ganti foto QRIS' : 'Unggah foto QRIS'}</button>${c.payment.hasQris ? '<button class="btn danger sm" id="qDel" type="button">Hapus</button>' : ''}</div>
        <p class="muted" style="margin:8px 0 0;font-size:13px">Foto langsung tersimpan saat dipilih (tidak perlu menekan Simpan perubahan).</p></div>
      <h2>Petunjuk pembayaran</h2>
      <label class="f">Teks tambahan yang tampil ke pembeli<textarea id="cPay" maxlength="1500">${esc(c.payment.instructions)}</textarea></label>
      <div class="savebar"><button class="btn primary" id="save">Simpan perubahan</button></div>`;
    const calc = () => el.querySelectorAll(".plan-row[data-p]").forEach((r) => {
      const price = +r.querySelector('[data-k=price]').value || 0, pct = +r.querySelector('[data-k=discountPct]').value || 0;
      r.querySelector('.final').innerHTML = pct ? `Harga yang dibayar pengguna: <b>${idr(Math.round(price * (1 - pct / 100)))}</b> (dari ${idr(price)})` : `Harga yang dibayar pengguna: <b>${idr(price)}</b>`;
    });
    el.addEventListener('input', calc); calc();
    if (c.payment.hasQris) api('qris').then((r) => { $('#qBox').innerHTML = r.image ? `<img src="${r.image}" alt="QRIS" style="max-width:220px;border:1px solid var(--line);border-radius:8px;display:block">` : 'Belum ada foto QRIS.'; }).catch(() => {});
    $('#qPick').onclick = () => $('#qFile').click();
    $('#qFile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { await api(null, { action: 'qris', image: await shrink(f, 1000, 0.85) }); toast('Foto QRIS disimpan.'); go('config'); } catch (err) { toast(err.message); }
    };
    if ($('#qDel')) $('#qDel').onclick = async () => { if (!confirm('Hapus foto QRIS?')) return; try { await api(null, { action: 'qris', image: null }); toast('Dihapus.'); go('config'); } catch (err) { toast(err.message); } };
    $('#save').onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true;
      const plans = [...el.querySelectorAll('.plan-row[data-p]')].map((r) => {
        const g = (k) => r.querySelector(`[data-k=${k}]`);
        return { id: r.dataset.p, active: g('active').checked, price: g('price').value, discountPct: g('discountPct').value, discountUntil: g('discountUntil').value ? new Date(g('discountUntil').value).toISOString() : null, dailyQuota: g('dailyQuota').value };
      });
      try {
        await api(null, { action: 'config', plans, freeQuota: $('#cFree').value, minAge: $('#cAge').value, costs: { lite: $('#cLite').value, pro: $('#cPro').value, max: $('#cMax').value }, payment: { instructions: $('#cPay').value, holder: $('#cHolder').value, dana: $('#cDana').value, gopay: $('#cGopay').value } });
        toast('Perubahan disimpan.');
      } catch (err) { toast(err.message); }
      b.disabled = false;
    };
  }

  /* ---------- log ---------- */
  async function log(el) {
    const l = (await api('log')).log;
    el.innerHTML = `<h1>Log aktivitas admin</h1><p class="lead">200 tindakan terakhir.</p><div class="tablewrap"><table><tbody>
      ${l.length ? l.map((x) => `<tr><td>${dt(x.t)}</td><td>${esc(x.action)}</td><td>${esc(x.target || '')}</td><td class="muted">${esc(x.note || '')}</td></tr>`).join('') : '<tr><td class="empty">Belum ada aktivitas.</td></tr>'}</tbody></table></div>`;
  }

  go('overview'); badges();
})();

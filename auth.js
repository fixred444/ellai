(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const form = $('#form'), submit = $('#submit'), formErr = $('#formErr');
  let mode = 'login';

  const copy = {
    login:  { title: 'Selamat datang kembali', sub: 'Masuk dengan email dan kata sandimu.', btn: 'Masuk', sw: 'Belum punya akun? ', swBtn: 'Daftar gratis' },
    signup: { title: 'Buat akun El Ai', sub: 'Gratis, dapat 100 token setiap hari.', btn: 'Buat akun', sw: 'Sudah punya akun? ', swBtn: 'Masuk' },
  };

  function setMode(m) {
    mode = m;
    const c = copy[m];
    $('#tabLogin').setAttribute('aria-selected', m === 'login');
    $('#tabSignup').setAttribute('aria-selected', m === 'signup');
    $('#title').textContent = c.title; $('#sub').textContent = c.sub; submit.textContent = c.btn;
    $('#switch').firstChild.textContent = c.sw; $('#switchBtn').textContent = c.swBtn;
    form.querySelector('[data-f="name"]').hidden = m !== 'signup';
    form.querySelector('[data-f="birth"]').hidden = m !== 'signup';
    $('#password').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    clearErrors();
    history.replaceState(null, '', m === 'signup' ? '#daftar' : '#masuk');
  }
  function clearErrors() {
    formErr.hidden = true;
    form.querySelectorAll('.field').forEach((f) => { f.classList.remove('bad'); f.querySelector('.err').textContent = ''; });
  }
  function fieldError(name, msg) {
    const f = form.querySelector(`[data-f="${name}"]`);
    if (!f) return false;
    f.classList.add('bad'); f.querySelector('.err').textContent = msg; return true;
  }
  function showError(msg, field) {
    if (field && fieldError(field, msg)) { const i = form.querySelector(`#${field}`); if (i) i.focus(); return; }
    formErr.textContent = msg; formErr.hidden = false;
  }

  $('#tabLogin').onclick = () => setMode('login');
  $('#tabSignup').onclick = () => setMode('signup');
  $('#switchBtn').onclick = () => setMode(mode === 'login' ? 'signup' : 'login');
  $('#pwToggle').onclick = (e) => {
    const p = $('#password'), show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Sembunyi' : 'Lihat';
    e.currentTarget.setAttribute('aria-label', show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    const data = { action: mode, email: $('#email').value.trim(), password: $('#password').value };
    if (mode === 'signup') { data.name = $('#name').value.trim(); data.birth = $('#birth').value; }

    // pemeriksaan cepat di browser (server tetap memeriksa ulang)
    if (mode === 'signup' && data.name.length < 2) return showError('Isi namamu (minimal 2 huruf).', 'name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) return showError('Alamat email belum benar.', 'email');
    if (mode === 'signup' && !data.birth) return showError('Isi tanggal lahirmu.', 'birth');
    if (data.password.length < 8) return showError('Kata sandi minimal 8 karakter.', 'password');

    submit.disabled = true;
    const label = submit.textContent; submit.textContent = 'Memproses…';
    try {
      const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { showError(j.error || 'Terjadi kesalahan. Coba lagi.', j.field); return; }
      const next = new URLSearchParams(location.search).get('next');
      location.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : (j.user && j.user.role === 'admin' ? '/admin.html' : '/'));
    } catch {
      showError('Tidak bisa terhubung ke server. Periksa koneksimu.');
    } finally {
      submit.disabled = false; submit.textContent = label;
    }
  });

  $('#birth').max = new Date().toISOString().slice(0, 10);
  setMode(location.hash === '#daftar' ? 'signup' : 'login');
  fetch('/api/me').then((r) => { if (r.ok) location.replace('/'); }).catch(() => {});
})();

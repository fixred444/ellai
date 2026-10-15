(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const form = $('#form'), submit = $('#submit'), formErr = $('#formErr'), formOk = $('#formOk');
  let mode = 'login', timer = 0;

  const copy = {
    login:  { title: 'Selamat datang kembali', sub: 'Masuk dengan email dan kata sandimu.', btn: 'Masuk', sw: 'Belum punya akun? ', swBtn: 'Daftar gratis' },
    signup: { title: 'Buat akun El Ai', sub: 'Gratis, dapat 100 token setiap hari.', btn: 'Buat akun', sw: 'Sudah punya akun? ', swBtn: 'Masuk' },
    forgot: { title: 'Lupa kata sandi?', sub: 'Masukkan email akunmu. Kami kirim kode 6 angka untuk mengatur ulang kata sandi.', btn: 'Kirim kode', sw: 'Ingat kata sandimu? ', swBtn: 'Kembali masuk' },
    reset:  { title: 'Atur ulang kata sandi', sub: 'Masukkan kode dari emailmu dan kata sandi baru.', btn: 'Simpan kata sandi baru', sw: 'Salah email? ', swBtn: 'Ulangi' },
  };
  const show = (name, on) => { const f = form.querySelector(`[data-f="${name}"]`); if (f) f.hidden = !on; };

  function setMode(m) {
    mode = m;
    const c = copy[m], auth = m === 'login' || m === 'signup';
    $('#tabLogin').setAttribute('aria-selected', m === 'login');
    $('#tabSignup').setAttribute('aria-selected', m === 'signup');
    document.querySelector('.tabs').hidden = !auth;
    $('#title').textContent = c.title; $('#sub').textContent = c.sub; submit.textContent = c.btn;
    $('#switch').firstChild.textContent = c.sw; $('#switchBtn').textContent = c.swBtn;
    show('name', m === 'signup'); show('birth', m === 'signup');
    show('otp', m === 'reset'); show('password', m !== 'forgot');
    $('#forgotWrap').hidden = m !== 'login';
    $('#resendWrap').hidden = m !== 'reset';
    $('#email').readOnly = m === 'reset';
    $('#password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    $('label[for="password"]').textContent = m === 'reset' ? 'Kata sandi baru' : 'Kata sandi';
    clearErrors();
    if (auth) history.replaceState(null, '', m === 'signup' ? '#daftar' : '#masuk');
    if (m === 'reset') { $('#otp').focus(); }
  }
  function clearErrors() {
    formErr.hidden = true; formOk.hidden = true;
    form.querySelectorAll('.field').forEach((f) => { f.classList.remove('bad'); f.querySelector('.err').textContent = ''; });
  }
  function fieldError(name, msg) {
    const f = form.querySelector(`[data-f="${name}"]`);
    if (!f || f.hidden) return false;
    f.classList.add('bad'); f.querySelector('.err').textContent = msg; return true;
  }
  function showError(msg, field) {
    if (field && fieldError(field, msg)) { const i = form.querySelector(`#${field}`); if (i) i.focus(); return; }
    formErr.textContent = msg; formErr.hidden = false;
  }
  function showOk(msg) { formOk.textContent = msg; formOk.hidden = false; }

  // hitung mundur tombol "Kirim ulang kode"
  function startCountdown(sec) {
    clearInterval(timer);
    const b = $('#resendBtn');
    let left = sec; b.disabled = true;
    const tick = () => { if (left <= 0) { clearInterval(timer); b.disabled = false; b.textContent = 'Kirim ulang kode'; return; } b.textContent = `Kirim ulang kode (${left}s)`; left--; };
    tick(); timer = setInterval(tick, 1000);
  }

  async function post(data) {
    const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return { ok: res.ok, j: await res.json().catch(() => ({})) };
  }
  async function sendCode() {
    const email = $('#email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showError('Alamat email belum benar.', 'email');
    submit.disabled = true; const label = submit.textContent; submit.textContent = 'Mengirim…';
    try {
      const r = await post({ action: 'forgot', email });
      if (!r.ok) { showError(r.j.error || 'Gagal mengirim kode.', r.j.field); return; }
      setMode('reset');
      $('#otpHint').textContent = 'Kode berlaku 10 menit. Cek juga folder spam.';
      showOk(r.j.message || 'Kode sudah dikirim.');
      startCountdown(r.j.resendIn || 60);
    } catch { showError('Tidak bisa terhubung ke server. Periksa koneksimu.'); }
    finally { submit.disabled = false; if (mode === 'forgot') submit.textContent = label; }
  }

  $('#tabLogin').onclick = () => setMode('login');
  $('#tabSignup').onclick = () => setMode('signup');
  $('#forgotBtn').onclick = () => setMode('forgot');
  $('#switchBtn').onclick = () => setMode(mode === 'login' ? 'signup' : mode === 'signup' ? 'login' : mode === 'forgot' ? 'login' : 'forgot');
  $('#resendBtn').onclick = async () => {
    clearErrors();
    const r = await post({ action: 'forgot', email: $('#email').value.trim() });
    if (r.ok) { showOk('Kode baru sudah dikirim.'); startCountdown(r.j.resendIn || 60); } else showError(r.j.error || 'Gagal mengirim kode.');
  };
  $('#pwToggle').onclick = (e) => {
    const p = $('#password'), show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Sembunyi' : 'Lihat';
    e.currentTarget.setAttribute('aria-label', show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
  };
  $('#otp').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    if (mode === 'forgot') return sendCode();

    const data = { action: mode, email: $('#email').value.trim(), password: $('#password').value };
    if (mode === 'signup') { data.name = $('#name').value.trim(); data.birth = $('#birth').value; }
    if (mode === 'reset') data.otp = $('#otp').value;

    // pemeriksaan cepat di browser (server tetap memeriksa ulang)
    if (mode === 'signup' && data.name.length < 2) return showError('Isi namamu (minimal 2 huruf).', 'name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) return showError('Alamat email belum benar.', 'email');
    if (mode === 'signup' && !data.birth) return showError('Isi tanggal lahirmu.', 'birth');
    if (mode === 'reset' && !/^\d{6}$/.test(data.otp)) return showError('Masukkan kode 6 angka dari emailmu.', 'otp');
    if (data.password.length < 8) return showError(mode === 'reset' ? 'Kata sandi baru minimal 8 karakter.' : 'Kata sandi minimal 8 karakter.', 'password');

    submit.disabled = true;
    const label = submit.textContent; submit.textContent = 'Memproses…';
    try {
      const r = await post(data);
      if (!r.ok) { showError(r.j.error || 'Terjadi kesalahan. Coba lagi.', r.j.field); return; }
      if (mode === 'reset') {
        clearInterval(timer); $('#password').value = ''; $('#otp').value = '';
        setMode('login'); showOk('Kata sandi berhasil diubah. Silakan masuk dengan kata sandi baru.');
        return;
      }
      const next = new URLSearchParams(location.search).get('next');
      location.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : (r.j.user && r.j.user.role === 'admin' ? '/admin.html' : '/'));
    } catch {
      showError('Tidak bisa terhubung ke server. Periksa koneksimu.');
    } finally {
      submit.disabled = false; submit.textContent = (mode === 'login' || mode === 'signup' || mode === 'reset') ? copy[mode].btn : label;
    }
  });

  $('#birth').max = new Date().toISOString().slice(0, 10);
  setMode(location.hash === '#daftar' ? 'signup' : 'login');
  fetch('/api/me').then((r) => { if (r.ok) location.replace('/'); }).catch(() => {});
})();

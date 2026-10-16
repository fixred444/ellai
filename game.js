/* El Ai — /game: cambuk yang bisa diklik.
 * Tali disimulasikan dengan fisika sederhana (verlet), suara "ctar" dibuat langsung oleh browser (Web Audio),
 * dan ada sedikit asap/debu saat ujung cambuk menyentak. Tanpa gambar atau file suara.
 *   ElGame.open()  /  ElGame.close()
 */
(function () {
  'use strict';

  const N = 34;                 // jumlah titik pada cambuk
  const HANDLE = 5;             // titik pertama yang kaku (gagang)
  const MUTE_KEY = 'elai.game.mute';

  let root = null, cv = null, ctx = null, countEl = null, muteBtn = null, hintEl = null;
  let W = 0, H = 0, dpr = 1, scale = 1, floorY = 0, segLen = 10;
  let pts = [], inv = [], restPts = [];
  let raf = 0, last = 0, open = false;
  let swing = null;             // { t } animasi gagang saat diklik
  let rest = { x: 0, y: 0 };
  let particles = [], rings = [], words = [];
  let flash = 0, shake = 0, count = 0;
  let tipTrail = [];
  let audio = null, muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}

  /* ---------------- suara ---------------- */
  function getAudio() {
    if (muted) return null;
    if (!audio) {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return null;
      const c = new A();
      const comp = c.createDynamicsCompressor();
      const master = c.createGain();
      master.gain.value = 0.75;
      comp.connect(master); master.connect(c.destination);
      const len = Math.floor(c.sampleRate * 0.8);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      audio = { c, comp, buf };
    }
    if (audio.c.state === 'suspended') audio.c.resume();
    return audio;
  }

  function noise(a, t, dur) {
    const s = a.c.createBufferSource();
    s.buffer = a.buf;
    s.start(t, Math.random() * 0.2, dur);
    return s;
  }

  function whoosh() {
    const a = getAudio(); if (!a) return;
    const c = a.c, t = c.currentTime;
    const s = noise(a, t, 0.6);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(240, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.5);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.3);
    g.gain.linearRampToValueAtTime(0.26, t + 0.48);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.54);
    s.connect(f); f.connect(g); g.connect(a.comp);
  }

  function crackSound(power) {
    const a = getAudio(); if (!a) return;
    const c = a.c, t = c.currentTime, k = 0.7 + 0.3 * power;
    // 1) letupan tajam
    const s1 = noise(a, t, 0.12);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    const g1 = c.createGain();
    g1.gain.setValueAtTime(1.0 * k, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    s1.connect(hp); hp.connect(g1); g1.connect(a.comp);
    // 2) badan suara "ctar"
    const s2 = noise(a, t, 0.3);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 0.7;
    const g2 = c.createGain();
    g2.gain.setValueAtTime(0.8 * k, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    s2.connect(bp); bp.connect(g2); g2.connect(a.comp);
    // 3) hentakan rendah
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.13);
    const g3 = c.createGain();
    g3.gain.setValueAtTime(0.55 * k, t);
    g3.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g3); g3.connect(a.comp); o.start(t); o.stop(t + 0.2);
    // 4) gema tipis
    const s4 = noise(a, t + 0.03, 0.5);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    const g4 = c.createGain();
    g4.gain.setValueAtTime(0.18 * k, t + 0.03);
    g4.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    s4.connect(lp); lp.connect(g4); g4.connect(a.comp);
  }

  /* ---------------- cambuk ---------------- */
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    scale = Math.max(0.55, Math.min(1.25, Math.min(W / 760, H / 620)));
    segLen = 13 * scale;
    floorY = H * 0.5 + 70 * scale;
    rest = { x: W * 0.5 - (N * segLen) / 2 + 10 * scale, y: floorY - 9 * scale };
    initWhip();
  }

  function initWhip() {
    pts = []; inv = [];
    for (let i = 0; i < N; i++) {
      const x = rest.x + i * segLen;
      const y = floorY - 9 * scale - Math.sin(i * 0.5) * 3 * scale * (i / N);
      pts.push({ x, y, px: x, py: y });
      // ujung lebih ringan -> lecutan makin cepat ke ujung
      const m = 1 - 0.92 * Math.pow(i / (N - 1), 1.1);
      inv.push(1 / m);
    }
    inv[0] = 0;
    restPts = pts.map((p) => ({ x: p.x, y: p.y }));
  }

  /* Gerakan lecutan (dibuat terarah supaya selalu terlihat seperti cambuk sungguhan):
   * 1) tangan mengangkat gagang ke belakang, tali menjuntai  2) gagang disentak ke depan, ada "lengkungan" (loop)
   * yang merambat ke ujung tali  3) saat loop sampai di ujung -> "CTAR!"  4) tali jatuh lagi ke lantai (fisika). */
  const D2R = Math.PI / 180;
  const T = { wind: 0.22, snap: 0.33, loop0: 0.27, crack: 0.52, back: 0.55, end: 1.0 };
  const sm = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };

  function pose(t, a0, l0) {
    const A1 = -128 * D2R, A2 = -14 * D2R, LIFT = 170 * scale;
    let ang, lift;
    if (t < T.wind) { const u = sm(t / T.wind); ang = a0 + (A1 - a0) * u; lift = l0 + (LIFT - l0) * u; }
    else if (t < T.snap) { const u = (t - T.wind) / (T.snap - T.wind); ang = A1 + (A2 - A1) * (0.5 * u * u * (3 - 2 * u) + 0.5 * u * u); lift = LIFT; }
    else if (t < T.back) { ang = A2; lift = LIFT; }
    else { const u = sm((t - T.back) / 0.4); ang = A2 + (0 - A2) * u; lift = LIFT * (1 - u); }
    return { ang, lift };
  }

  function placeHandle(P, ang) {
    const hx = Math.cos(ang), hy = Math.sin(ang);
    for (let i = 0; i <= HANDLE; i++) {
      const p = pts[i];
      p.x = P.x + hx * segLen * i; p.y = P.y + hy * segLen * i;
      p.px = p.x; p.py = p.y;
    }
  }

  function kinematic(sw) {
    const t = sw.t;
    const { ang, lift } = pose(t, sw.a0, sw.l0);
    const P = { x: rest.x - 40 * scale * (lift / (170 * scale)), y: rest.y - lift };
    placeHandle(P, ang);

    const Lr = (N - 1 - HANDLE) * segLen, r = 12 * scale, arcLen = Math.PI * r, Dmax = Lr - arcLen;
    const prog = Math.max(0, Math.min(1, (t - T.loop0) / (T.crack - T.loop0)));
    const D = Dmax * Math.pow(prog, 2.1);
    const wBlend = sm(t / 0.16);
    let x = pts[HANDLE].x, y = pts[HANDLE].y;
    for (let i = HANDLE + 1; i < N; i++) {
      const sMid = (i - HANDLE - 0.5) * segLen;
      const phi = pose(Math.max(0, t - 0.1 * (sMid / Lr)), sw.a0, sw.l0).ang;   // makin ke ujung makin "ketinggalan"
      const fx = Math.cos(phi), fy = Math.sin(phi), nx = -fy, ny = fx;
      let dx, dy;
      if (sMid <= D) { dx = fx; dy = fy; }
      else if (sMid <= D + arcLen) { const be = ((sMid - D) / arcLen) * Math.PI; dx = fx * Math.cos(be) + nx * Math.sin(be); dy = fy * Math.cos(be) + ny * Math.sin(be); }
      else { dx = -fx; dy = -fy; }
      x += dx * segLen; y += dy * segLen;
      const yy = Math.min(y, floorY - 2);
      const q = pts[i], sn = sw.snap[i];
      q.x = sn.x + (x - sn.x) * wBlend; q.y = sn.y + (yy - sn.y) * wBlend;
      q.px = q.x; q.py = q.y;
    }
  }

  function step(dt) {
    let pinN = 1;
    if (swing) {
      swing.t += dt;
      if (swing.t < T.crack) kinematic(swing);
      else {
        if (!swing.cracked) { swing.cracked = true; doCrack(1); }
        const ps = pose(swing.t, swing.a0, swing.l0);
        placeHandle({ x: rest.x - 40 * scale * (ps.lift / (170 * scale)), y: rest.y - ps.lift }, ps.ang);
        pinN = HANDLE + 1;
      }
      if (swing.t >= T.crack) { /* fisika di bawah */ } else { return; }
      if (swing && swing.t > T.back + 0.12) {
        // jatuhnya tali dirapikan pelan-pelan ke posisi istirahat supaya tidak menumpuk
        const lam = sm((swing.t - T.back - 0.12) / 0.3) * 0.22;
        for (let i = HANDLE + 1; i < N; i++) {
          const p = pts[i], r = restPts[i];
          const nx = p.x + (r.x - p.x) * lam, ny = p.y + (r.y - p.y) * lam;
          p.px += nx - p.x; p.py += ny - p.y; p.x = nx; p.y = ny;
        }
      }
      if (swing && swing.t > T.end) swing = null;
    } else {
      pts[0].x = rest.x; pts[0].y = rest.y; pts[0].px = rest.x; pts[0].py = rest.y;
    }

    const g = 2300 * scale;
    for (let i = pinN; i < N; i++) {
      const p = pts[i];
      const damp = i > N - 6 ? 0.9985 : 0.996;
      const vx = (p.x - p.px) * damp, vy = (p.y - p.py) * damp;
      p.px = p.x; p.py = p.y;
      p.x += vx;
      p.y += vy + g * dt * dt;
    }
    const w = (i) => (i < pinN ? 0 : inv[i]);
    for (let it = 0; it < 16; it++) {
      for (let i = 0; i < N - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        const diff = (d - segLen) / d;
        const wa = w(i), wb = w(i + 1), ws = wa + wb;
        if (!ws) continue;
        a.x += dx * diff * (wa / ws); a.y += dy * diff * (wa / ws);
        b.x -= dx * diff * (wb / ws); b.y -= dy * diff * (wb / ws);
      }
      // tali sedikit kaku: sulit melipat tajam (hairpin)
      for (let i = 1; i < N - 1; i++) {
        const a = pts[i - 1], b = pts[i], c = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.0001;
        const k = i < HANDLE + 1 ? 0 : 0.07;
        c.x += (b.x + (dx / d) * segLen - c.x) * k * (inv[i + 1] / inv[N - 1]);
        c.y += (b.y + (dy / d) * segLen - c.y) * k * (inv[i + 1] / inv[N - 1]);
      }
      if (pinN === 1) {
        // gagang kaku: titik 1..HANDLE-1 sejajar garis titik 0 -> HANDLE
        const a = pts[0], e = pts[HANDLE];
        const dx = e.x - a.x, dy = e.y - a.y, d = Math.hypot(dx, dy) || 0.0001;
        const ux = dx / d, uy = dy / d;
        for (let i = 1; i < HANDLE; i++) {
          const tx = a.x + ux * segLen * i, ty = a.y + uy * segLen * i;
          pts[i].x += (tx - pts[i].x) * 0.7; pts[i].y += (ty - pts[i].y) * 0.7;
        }
      }
      for (let i = pinN; i < N; i++) {
        const p = pts[i];
        if (p.y > floorY - 2) { p.y = floorY - 2; p.px += (p.x - p.px) * 0.35; }
      }
    }
  }

  /* ---------------- efek ---------------- */
  function burst(x, y, power) {
    // asap/debu: sedikit saja
    const puffs = 11 + Math.round(power * 5);
    for (let i = 0; i < puffs; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (30 + Math.random() * 110) * scale;
      particles.push({
        kind: 'smoke', x: x + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 25 * scale,
        r: (5 + Math.random() * 7) * scale, grow: (18 + Math.random() * 20) * scale,
        life: 0, max: 0.9 + Math.random() * 0.9, a: 0.28 + Math.random() * 0.14, seed: Math.random() * 10,
      });
    }
    for (let i = 0; i < 16; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (150 + Math.random() * 380) * scale;
      particles.push({
        kind: 'dust', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40 * scale,
        r: (0.8 + Math.random() * 1.6) * scale, life: 0, max: 0.35 + Math.random() * 0.55, a: 0.9,
      });
    }
    rings.push({ x, y, r: 4 * scale, life: 0, max: 0.28 });
    const w = ['CTAR!', 'CTAAR!', 'TARR!', 'CTAS!'][Math.floor(Math.random() * 4)];
    words.push({ t: w, x: x + (Math.random() * 40 - 20) * scale, y: y - 26 * scale, life: 0, max: 0.8, rot: (Math.random() - 0.5) * 0.35 });
    flash = 0.5 * power + 0.2;
    shake = 7 * power * scale + 2;
    try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) {}
  }

  function doCrack(power) {
    const p = pts[N - 1];
    count++;
    countEl.textContent = 'Cambukan: ' + count;
    crackSound(power);
    burst(p.x, p.y, power);
  }

  function trigger() {
    if (!open) return;
    let a0 = 0, l0 = 0;
    if (swing) {
      if (swing.t < 0.78) return;                    // tunggu cambuk turun dulu
      const ps = pose(swing.t, swing.a0, swing.l0); a0 = ps.ang; l0 = ps.lift;
    }
    swing = { t: 0, a0, l0, snap: pts.map((p) => ({ x: p.x, y: p.y })), cracked: false };
    tipTrail = [];
    whoosh();
    if (hintEl) hintEl.classList.add('gone');
  }

  /* ---------------- gambar ---------------- */
  function drawWhip() {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // bayangan di lantai
    ctx.save();
    ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(W / 2, floorY + 4 * scale, N * segLen * 0.62, 9 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // tali (menyempit ke ujung)
    for (let i = HANDLE - 1; i < N - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const u = i / (N - 1);
      const w = (9.5 - 7.6 * Math.pow(u, 0.75)) * scale;
      ctx.strokeStyle = '#4a2a12';
      ctx.lineWidth = w + 1.6 * scale;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let i = HANDLE - 1; i < N - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const u = i / (N - 1);
      const w = (9.5 - 7.6 * Math.pow(u, 0.75)) * scale;
      ctx.strokeStyle = i % 2 ? '#8a5428' : '#9c6330';
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,220,170,0.35)';
      ctx.lineWidth = Math.max(0.6, w * 0.28);
      ctx.beginPath(); ctx.moveTo(a.x, a.y - w * 0.22); ctx.lineTo(b.x, b.y - w * 0.22); ctx.stroke();
    }
    // ujung (rumbai)
    const t1 = pts[N - 1], t0 = pts[N - 2];
    const ang = Math.atan2(t1.y - t0.y, t1.x - t0.x);
    ctx.strokeStyle = '#d9c7a3'; ctx.lineWidth = 1.4 * scale;
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath(); ctx.moveTo(t1.x, t1.y);
      ctx.lineTo(t1.x + Math.cos(ang + k * 0.35) * 14 * scale, t1.y + Math.sin(ang + k * 0.35) * 14 * scale);
      ctx.stroke();
    }

    // gagang
    const a = pts[0], e = pts[HANDLE];
    const ha = Math.atan2(e.y - a.y, e.x - a.x);
    const hl = segLen * HANDLE;
    ctx.save();
    ctx.translate(a.x, a.y); ctx.rotate(ha);
    const hw = 15 * scale;
    ctx.fillStyle = '#2a1a12';
    ctx.beginPath(); ctx.roundRect(-8 * scale, -hw / 2 - 1.5, hl + 8 * scale, hw + 3, 8 * scale); ctx.fill();
    const grad = ctx.createLinearGradient(0, -hw / 2, 0, hw / 2);
    grad.addColorStop(0, '#7a3b24'); grad.addColorStop(0.5, '#b4562f'); grad.addColorStop(1, '#5c2a18');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.roundRect(-7 * scale, -hw / 2, hl + 6 * scale, hw, 7 * scale); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1.4 * scale;
    for (let x = 4 * scale; x < hl - 2 * scale; x += 7 * scale) {
      ctx.beginPath(); ctx.moveTo(x, -hw / 2 + 1); ctx.lineTo(x + 4 * scale, hw / 2 - 1); ctx.stroke();
    }
    ctx.fillStyle = '#d6b45a';
    ctx.beginPath(); ctx.roundRect(hl - 2 * scale, -hw / 2 - 2, 5 * scale, hw + 4, 2 * scale); ctx.fill();
    ctx.fillStyle = '#d6b45a';
    ctx.beginPath(); ctx.arc(-7 * scale, 0, 3.2 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawTrail() {
    if (tipTrail.length < 2) return;
    ctx.lineCap = 'round';
    for (let i = 1; i < tipTrail.length; i++) {
      const a = tipTrail[i - 1], b = tipTrail[i];
      ctx.strokeStyle = 'rgba(255,236,200,' + (0.1 + 0.5 * (i / tipTrail.length)) + ')';
      ctx.lineWidth = (0.8 + 2.4 * (i / tipTrail.length)) * scale;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  function drawFx(dt) {
    // asap & debu
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.max) { particles.splice(i, 1); continue; }
      const u = p.life / p.max;
      if (p.kind === 'smoke') {
        const drag = Math.pow(0.04, dt);
        p.vx *= drag; p.vy *= drag;
        p.vx += Math.sin(p.life * 5 + p.seed) * 22 * scale * dt;
        p.vy -= 26 * scale * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const r = p.r + p.grow * u;
        const al = p.a * (1 - u) * Math.min(1, p.life / 0.06);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, 'rgba(226,216,200,' + al + ')');
        g.addColorStop(0.6, 'rgba(190,180,165,' + al * 0.55 + ')');
        g.addColorStop(1, 'rgba(170,160,148,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      } else {
        p.vy += 900 * scale * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        ctx.fillStyle = 'rgba(236,226,208,' + p.a * (1 - u) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    // cincin kejut
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life += dt;
      if (r.life >= r.max) { rings.splice(i, 1); continue; }
      const u = r.life / r.max;
      ctx.strokeStyle = 'rgba(255,248,230,' + 0.8 * (1 - u) + ')';
      ctx.lineWidth = 2.2 * scale * (1 - u) + 0.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r + 46 * scale * u, 0, Math.PI * 2); ctx.stroke();
    }
    // tulisan "CTAR!"
    for (let i = words.length - 1; i >= 0; i--) {
      const w = words[i];
      w.life += dt;
      if (w.life >= w.max) { words.splice(i, 1); continue; }
      const u = w.life / w.max;
      ctx.save();
      ctx.translate(w.x, w.y - 22 * scale * u); ctx.rotate(w.rot);
      const s = (0.7 + 0.5 * Math.min(1, u * 5)) * scale;
      ctx.scale(s, s);
      ctx.globalAlpha = 1 - u * u;
      ctx.font = '800 30px "Hanken Grotesk", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 6; ctx.strokeStyle = '#3a1f10'; ctx.lineJoin = 'round';
      ctx.strokeText(w.t, 0, 0);
      ctx.fillStyle = '#ffd35a';
      ctx.fillText(w.t, 0, 0);
      ctx.restore();
    }
    // kilatan
    if (flash > 0) {
      const p = pts[N - 1];
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 150 * scale);
      g.addColorStop(0, 'rgba(255,244,214,' + flash + ')');
      g.addColorStop(1, 'rgba(255,244,214,0)');
      ctx.fillStyle = g;
      ctx.fillRect(p.x - 160 * scale, p.y - 160 * scale, 320 * scale, 320 * scale);
      flash = Math.max(0, flash - dt * 3.2);
    }
  }

  function frame(now) {
    if (!open) return;
    raf = requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (!(dt > 0)) return;
    dt = Math.min(dt, 1 / 30);

    const sub = 3, h = dt / sub;
    for (let k = 0; k < sub; k++) step(h);
    if (swing && swing.t > T.loop0 && swing.t < T.crack + 0.05) {
      tipTrail.push({ x: pts[N - 1].x, y: pts[N - 1].y });
      if (tipTrail.length > 7) tipTrail.shift();
    } else if (tipTrail.length) tipTrail.shift();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      shake *= Math.pow(0.002, dt);
    }
    drawWhip();
    drawTrail();
    drawFx(dt);
  }

  /* ---------------- tampilan ---------------- */
  function build() {
    root = document.createElement('div');
    root.className = 'game';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Permainan cambuk');
    root.innerHTML =
      '<canvas class="game-cv" aria-label="Cambuk. Klik untuk mencambuk"></canvas>' +
      '<div class="game-top">' +
        '<div class="game-count" data-g="count">Cambukan: 0</div>' +
        '<div class="game-btns">' +
          '<button type="button" class="game-btn" data-g="mute" aria-label="Suara"></button>' +
          '<button type="button" class="game-btn" data-g="close" aria-label="Tutup permainan">' +
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="game-hint" data-g="hint">Klik cambuknya!<small>Esc atau tombol X untuk keluar</small></div>';
    document.body.appendChild(root);
    cv = root.querySelector('canvas');
    ctx = cv.getContext('2d');
    countEl = root.querySelector('[data-g="count"]');
    muteBtn = root.querySelector('[data-g="mute"]');
    hintEl = root.querySelector('[data-g="hint"]');
    paintMute();

    cv.addEventListener('pointerdown', (e) => { e.preventDefault(); trigger(); });
    root.querySelector('[data-g="close"]').addEventListener('click', close);
    muteBtn.addEventListener('click', () => {
      muted = !muted;
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
      paintMute();
      if (!muted) getAudio();
    });
    document.addEventListener('keydown', (e) => {
      if (!open) return;
      if (e.key === 'Escape') close();
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); trigger(); }
    });
    window.addEventListener('resize', () => { if (open) layout(); });
  }

  function paintMute() {
    muteBtn.innerHTML = muted
      ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>'
      : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/></svg>';
    muteBtn.setAttribute('aria-label', muted ? 'Nyalakan suara' : 'Matikan suara');
  }

  function openGame() {
    if (!root) build();
    if (open) return;
    open = true;
    root.hidden = false;
    count = 0; countEl.textContent = 'Cambukan: 0';
    particles = []; rings = []; words = []; flash = 0; shake = 0; swing = null; tipTrail = [];
    hintEl.classList.remove('gone');
    layout();
    getAudio();
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  function close() {
    if (!open) return;
    open = false;
    cancelAnimationFrame(raf);
    root.hidden = true;
    const input = document.getElementById('input');
    if (input) input.focus();
  }

  window.ElGame = { open: openGame, close, _state: () => ({ count, open, tip: pts[N - 1], t: swing ? swing.t : -1 }), _trigger: trigger };
})();

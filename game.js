// Star Dodge HD — dodge meteors, collect stars, reach 500 to win.
// Plain canvas JS, no assets. Keyboard + mouse/touch.
// HD: canvas backing is 960x1440 (2x the 480x720 logical playfield), so
// lines and glow stay crisp on retina/phone screens. All drawing is done
// in logical coordinates with ctx scaled by SCALE.
(function () {
  'use strict';

  function el(id) {
    try { return document.getElementById(id); } catch (e) { return null; }
  }
  var canvas = el('game');
  var ctx = canvas.getContext('2d');
  // Logical playfield (game coordinates). Backing store is 2x for HD.
  var W = 480;
  var H = 720;
  // Best graphics: devicePixelRatio-aware backing store. 2x minimum (HD),
  // up to 3x on retina phones (1440x2160). Falls back to 2x if DPR is unknown.
  var DPR = 2;
  try { DPR = Math.min(3, Math.max(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 2)); } catch (e) { DPR = 2; }
  try { canvas.width = W * DPR; canvas.height = H * DPR; } catch (e) {}
  var SCALE = (canvas.width || 480) / W;
  var WIN_SCORE = 500;
  var BASE_SPEED = 370;
  var scoreEl = el('hud-score');
  var livesEl = el('hud-lives');
  var bestEl = el('hud-best');
  var startBtn = el('start-btn');
  var sensRange = el('sens-range');
  var sensVal = el('sens-val');
  var diffRange = el('diff-range');
  var diffVal = el('diff-val');
  var muteCheck = el('mute-check');
  var muteLabel = el('mute-label');

  // ---- Settings (saved in localStorage) ----
  var settings = { sensitivity: 1.0, difficulty: 1.0, muted: false };
  try {
    var saved = JSON.parse(localStorage.getItem('star-dodge-settings') || 'null');
    if (saved) {
      if (typeof saved.sensitivity === 'number') settings.sensitivity = Math.max(0.5, Math.min(2, saved.sensitivity));
      if (typeof saved.difficulty === 'number') settings.difficulty = Math.max(0.5, Math.min(2, saved.difficulty));
      if (typeof saved.muted === 'boolean') settings.muted = saved.muted;
    }
  } catch (e) { /* defaults stand */ }
  var muted = settings.muted;
  function saveSettings() {
    settings.muted = muted;
    try { localStorage.setItem('star-dodge-settings', JSON.stringify(settings)); } catch (e) {}
  }
  function syncSettingsUI() {
    if (sensRange) sensRange.value = String(settings.sensitivity);
    if (sensVal) sensVal.textContent = settings.sensitivity.toFixed(1) + '×';
    if (diffRange) diffRange.value = String(settings.difficulty);
    if (diffVal) diffVal.textContent = settings.difficulty.toFixed(1) + '×';
    if (muteCheck) muteCheck.checked = !muted;
    if (muteLabel) muteLabel.textContent = muted ? 'Off' : 'On';
  }
  function bindSettings() {
    if (sensRange) sensRange.addEventListener('input', function () {
      settings.sensitivity = parseFloat(sensRange.value) || 1;
      if (sensVal) sensVal.textContent = settings.sensitivity.toFixed(1) + '×';
      saveSettings();
    });
    if (diffRange) diffRange.addEventListener('input', function () {
      settings.difficulty = parseFloat(diffRange.value) || 1;
      if (diffVal) diffVal.textContent = settings.difficulty.toFixed(1) + '×';
      saveSettings();
    });
    if (muteCheck) muteCheck.addEventListener('change', function () {
      muted = !muteCheck.checked;
      if (muteLabel) muteLabel.textContent = muted ? 'Off' : 'On';
      saveSettings();
    });
  }
  syncSettingsUI();
  bindSettings();

  var state = 'title'; // title | playing | paused | won | over
  var score = 0;
  var lives = 3;
  var best = 0;
  try { best = parseInt(localStorage.getItem('star-dodge-best') || '0', 10) || 0; } catch (e) { best = 0; }
  var timeAlive = 0;
  var spawnTimer = 0;
  var starTimer = 0;
  var invuln = 0;
  var flash = 0;
  var shake = 0;
  var trailTimer = 0;
  var shootTimer = 0;
  var shootingStar = null;
  var shockwaves = [];
  // Auto quality: if frames run slow on a phone, drop particle counts and
  // shadowBlur so it stays near 60fps. Default is max quality.
  var qualityLevel = 0; // 0=max, 1=medium, 2=low
  var particleCap = 240;
  var frameEma = 16;
  var frameCount = 0;
  function makeGlow(color) {
    try {
      var c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      var g = c.getContext('2d');
      var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, color);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      return c;
    } catch (e) { return null; }
  }
  var glowGold = makeGlow('rgba(255,209,102,0.95)');
  var glowCyan = makeGlow('rgba(76,201,240,0.9)');
  var glowRed = makeGlow('rgba(255,80,80,0.85)');
  var glowOrange = makeGlow('rgba(255,159,28,0.8)');

  var player = { x: W / 2, y: H - 110, r: 18, vx: 0, vy: 0, tilt: 0, tx: W / 2, ty: H - 110, dragging: false };
  function playerSpeed() { return BASE_SPEED * settings.sensitivity; }
  function meteorMul() { return settings.difficulty; }
  var keys = {};
  var meteors = [];
  var stars = [];
  var particles = [];

  // HD background: 140 twinkling stars + 6 slow nebula blobs.
  var bgStars = [];
  for (var i = 0; i < 140; i++) {
    var layer = i % 3; // 0=far (slow/small), 1=mid, 2=near (fast/bright) — parallax
    bgStars.push({ x: Math.random() * W, y: Math.random() * H, s: (layer === 2 ? 2.2 : layer === 1 ? 1.4 : 0.8) + Math.random() * 0.8, v: (layer === 2 ? 34 : layer === 1 ? 20 : 9) + Math.random() * 8, tw: Math.random() * Math.PI * 2, tws: 0.5 + Math.random() * 2, layer: layer });
  }
  var nebulae = [
    { x: 90, y: 140, r: 170, c: '90,60,190', a: 0.16, vx: 3, vy: 2 },
    { x: 400, y: 320, r: 200, c: '20,120,160', a: 0.14, vx: -2, vy: 3 },
    { x: 150, y: 560, r: 150, c: '190,60,120', a: 0.12, vx: 2, vy: -2 },
    { x: 380, y: 620, r: 180, c: '60,80,200', a: 0.13, vx: -3, vy: -1 },
    { x: 240, y: 40, r: 130, c: '200,140,40', a: 0.08, vx: 1, vy: 2 },
    { x: 60, y: 380, r: 120, c: '40,160,110', a: 0.09, vx: -1, vy: 1 }
  ];

  var audioCtx = null;
  function beep(freq, dur, type, vol) {
    if (muted) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.value = vol || 0.08;
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* sound is optional */ }
  }

  function radial(x, y, r, inner, outer) {
    try {
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, inner);
      g.addColorStop(1, outer);
      return g;
    } catch (e) { return null; }
  }

  function reset() {
    score = 0;
    lives = 3;
    timeAlive = 0;
    spawnTimer = 0;
    starTimer = 0;
    invuln = 0;
    flash = 0;
    shake = 0;
    trailTimer = 0;
    meteors = [];
    stars = [];
    particles = [];
    player.x = W / 2;
    player.y = H - 110;
    player.vx = 0; player.vy = 0; player.tilt = 0;
    player.tx = W / 2;
    player.ty = H - 110;
    updateHud();
  }

  function startGame() {
    reset();
    state = 'playing';
    if (startBtn) startBtn.textContent = 'Restart';
    beep(520, 0.12, 'square', 0.06);
  }

  function endGame(won) {
    state = won ? 'won' : 'over';
    if (score > best) {
      best = score;
      try { localStorage.setItem('star-dodge-best', String(best)); } catch (e) {}
    }
    updateHud();
    if (won) { beep(660, 0.15, 'sine', 0.09); setTimeout(function () { beep(880, 0.25, 'sine', 0.09); }, 150); }
    else { beep(160, 0.4, 'sawtooth', 0.08); }
  }

  function updateHud() {
    if (scoreEl) scoreEl.textContent = 'Score: ' + Math.floor(score);
    var hearts = '';
    for (var i = 0; i < 3; i++) hearts += i < lives ? '\u2665' : '\u2661';
    if (livesEl) livesEl.textContent = 'Lives: ' + hearts;
    if (bestEl) bestEl.textContent = 'Best: ' + Math.floor(best);
  }

  function spawnMeteor() {
    var level = 1 + Math.floor(score / 100);
    var r = 14 + Math.random() * 22;
    meteors.push({
      x: r + Math.random() * (W - r * 2),
      y: -r - 10,
      r: r,
      vy: (110 + Math.random() * 110 + level * 22) * meteorMul(),
      vx: (Math.random() - 0.5) * 60,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 2.4
    });
  }

  function spawnStar() {
    stars.push({
      x: 24 + Math.random() * (W - 48),
      y: -20,
      r: 13,
      vy: 110 + Math.random() * 60,
      rot: Math.random() * Math.PI * 2,
      pulse: Math.random() * Math.PI * 2
    });
  }

  function burst(x, y, color, n, speed) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = (speed || 60) + Math.random() * 180;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.5, t: 0, color: color, r: 2 + Math.random() * 3 });
    }
    if (particles.length > particleCap) particles.splice(0, particles.length - particleCap);
  }

  function debrisBurst(x, y, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 90 + Math.random() * 260;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6 + Math.random() * 0.6, t: 0, color: Math.random() < 0.5 ? '#c98a4b' : '#ff9f1c', r: 3 + Math.random() * 4, shard: true, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 12 });
    }
    if (particles.length > particleCap) particles.splice(0, particles.length - particleCap);
  }
  function shockwave(x, y) { shockwaves.push({ x: x, y: y, r: 8, maxR: 95, t: 0, life: 0.5 }); }

  function dist(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function update(dt) {
    timeAlive += dt;
    score += dt * 5;
    if (Math.floor(score) >= WIN_SCORE) { score = WIN_SCORE; updateHud(); endGame(true); return; }

    // Movement: smooth acceleration, full 2D arrows + WASD.
    var mx = 0, my = 0;
    if (keys.ArrowLeft || keys.a || keys.A) mx -= 1;
    if (keys.ArrowRight || keys.d || keys.D) mx += 1;
    if (keys.ArrowUp || keys.w || keys.W) my -= 1;
    if (keys.ArrowDown || keys.s || keys.S) my += 1;
    var speed = playerSpeed();
    var accel = 2800;
    if (mx || my) {
      var len = Math.sqrt(mx * mx + my * my);
      var tvx = (mx / len) * speed;
      var tvy = (my / len) * speed;
      player.vx += Math.max(-accel * dt, Math.min(accel * dt, tvx - player.vx));
      player.vy += Math.max(-accel * dt, Math.min(accel * dt, tvy - player.vy));
      player.tx = player.x; player.ty = player.y;
      player.dragging = false;
    } else if (player.dragging) {
      // Ease toward the pointer target; velocity follows for tilt/trail.
      var ox = player.x, oy = player.y;
      player.x += (player.tx - player.x) * Math.min(1, dt * 14);
      player.y += (player.ty - player.y) * Math.min(1, dt * 14);
      player.vx = (player.x - ox) / Math.max(dt, 0.001);
      player.vy = (player.y - oy) / Math.max(dt, 0.001);
    } else {
      // Glide to a stop.
      var dec = accel * dt;
      player.vx = Math.abs(player.vx) <= dec ? 0 : player.vx - Math.sign(player.vx) * dec;
      player.vy = Math.abs(player.vy) <= dec ? 0 : player.vy - Math.sign(player.vy) * dec;
    }
    if (mx || my) { player.x += player.vx * dt; player.y += player.vy * dt; }
    player.x = Math.max(20, Math.min(W - 20, player.x));
    player.y = Math.max(20, Math.min(H - 20, player.y));
    // Bank/tilt into horizontal movement.
    var targetTilt = Math.max(-0.4, Math.min(0.4, player.vx / speed * 0.45));
    player.tilt += (targetTilt - player.tilt) * Math.min(1, dt * 10);

    // Engine trail.
    trailTimer -= dt;
    if (trailTimer <= 0) {
      trailTimer = 0.03;
      particles.push({ x: player.x + (Math.random() - 0.5) * 6, y: player.y + 16, vx: (Math.random() - 0.5) * 20, vy: 60 + Math.random() * 40, life: 0.35, t: 0, color: Math.random() < 0.5 ? '#4cc9f0' : '#ff9f1c', r: 1.5 + Math.random() * 2 });
    }

    // Spawning ramps with score; difficulty slider speeds meteors up.
    var level = 1 + Math.floor(score / 100);
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnMeteor();
      if (level >= 3 && Math.random() < 0.4) spawnMeteor();
      spawnTimer = Math.max(0.35, 1.0 - level * 0.08) * (0.7 + Math.random() * 0.6) / meteorMul();
    }
    starTimer -= dt;
    if (starTimer <= 0) { spawnStar(); starTimer = 0.9 + Math.random() * 0.9; }

    if (invuln > 0) invuln -= dt;
    if (flash > 0) flash -= dt;
    if (shake > 0) shake -= dt;

    // Occasional shooting star.
    shootTimer -= dt;
    if (shootTimer <= 0) {
      shootTimer = 4 + Math.random() * 7;
      shootingStar = { x: 60 + Math.random() * (W - 120), y: -10, vx: 220 + Math.random() * 160, vy: 160 + Math.random() * 80, life: 0.9, t: 0 };
    }
    if (shootingStar) {
      shootingStar.t += dt;
      shootingStar.x += shootingStar.vx * dt;
      shootingStar.y += shootingStar.vy * dt;
      if (shootingStar.t > shootingStar.life) shootingStar = null;
    }

    // Meteors.
    for (var i = meteors.length - 1; i >= 0; i--) {
      var m = meteors[i];
      m.y += m.vy * dt;
      m.x += m.vx * dt;
      m.rot += m.vr * dt;
      if (m.y - m.r > H || m.x < -60 || m.x > W + 60) { meteors.splice(i, 1); continue; }
      if (invuln <= 0 && dist(m, player) < m.r + player.r - 6) {
        lives -= 1;
        invuln = 2.0;
        flash = 0.35;
        shake = 0.35;
        burst(player.x, player.y, '#ff6b6b', 30, 90);
        burst(player.x, player.y, '#ffd166', 14, 60);
        debrisBurst(player.x, player.y, 12);
        shockwave(player.x, player.y);
        beep(140, 0.25, 'sawtooth', 0.09);
        meteors.splice(i, 1);
        updateHud();
        if (lives <= 0) { endGame(false); return; }
      }
    }

    // Stars.
    for (var j = stars.length - 1; j >= 0; j--) {
      var s = stars[j];
      s.y += s.vy * dt;
      s.rot += dt * 3;
      s.pulse += dt * 5;
      if (s.y - s.r > H) { stars.splice(j, 1); continue; }
      if (dist(s, player) < s.r + player.r + 4) {
        score += 25;
        burst(s.x, s.y, '#ffd166', 20, 80);
        burst(s.x, s.y, '#fff3c4', 10, 50);
        beep(880, 0.1, 'sine', 0.07);
        setTimeout(function () { beep(1320, 0.08, 'sine', 0.05); }, 60);
        stars.splice(j, 1);
        updateHud();
        if (score >= WIN_SCORE) { score = WIN_SCORE; updateHud(); endGame(true); return; }
      }
    }

    for (var sw = shockwaves.length - 1; sw >= 0; sw--) {
      shockwaves[sw].t += dt;
      shockwaves[sw].r = 8 + (shockwaves[sw].maxR - 8) * (shockwaves[sw].t / shockwaves[sw].life);
      if (shockwaves[sw].t >= shockwaves[sw].life) shockwaves.splice(sw, 1);
    }
    // Particles + background drift.
    for (var k = particles.length - 1; k >= 0; k--) {
      var p = particles[k];
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= (1 - dt * 1.5); p.vy *= (1 - dt * 1.5);
      if (p.shard) p.rot += (p.vr || 0) * dt;
      if (p.t >= p.life) particles.splice(k, 1);
    }
    for (var b = 0; b < bgStars.length; b++) {
      bgStars[b].y += bgStars[b].v * dt;
      bgStars[b].tw += bgStars[b].tws * dt;
      if (bgStars[b].y > H) { bgStars[b].y = -2; bgStars[b].x = Math.random() * W; }
    }
    for (var n = 0; n < nebulae.length; n++) {
      var nb = nebulae[n];
      nb.x += nb.vx * dt; nb.y += nb.vy * dt;
      if (nb.x < -nb.r) nb.x = W + nb.r; if (nb.x > W + nb.r) nb.x = -nb.r;
      if (nb.y < -nb.r) nb.y = H + nb.r; if (nb.y > H + nb.r) nb.y = -nb.r;
    }
    updateHud();
  }

  function drawShip() {
    if (invuln > 0 && Math.floor(invuln * 10) % 2 === 0) return; // blink while invulnerable
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.tilt);
    // Bloom glow: pre-rendered sprite (cheap) + shadowBlur on max quality.
    if (glowCyan) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glowCyan, -42, -42, 84, 84);
      ctx.restore();
    }
    ctx.shadowColor = '#4cc9f0';
    ctx.shadowBlur = qualityLevel >= 2 ? 0 : 18;
    // Flame (drawn first, under the hull).
    ctx.shadowBlur = qualityLevel >= 2 ? 0 : 12;
    ctx.shadowColor = '#ff9f1c';
    var fl = 22 + Math.random() * 10;
    ctx.fillStyle = '#ff9f1c';
    ctx.beginPath();
    ctx.moveTo(-6, 14);
    ctx.lineTo(0, 14 + fl);
    ctx.lineTo(6, 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(-3.5, 14);
    ctx.lineTo(0, 14 + fl * 0.6);
    ctx.lineTo(3.5, 14);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = qualityLevel >= 2 ? 0 : 18;
    ctx.shadowColor = '#4cc9f0';
    // Hull with gradient.
    var hg = null;
    try {
      hg = ctx.createLinearGradient(0, -22, 0, 16);
      hg.addColorStop(0, '#8fe3ff');
      hg.addColorStop(0.5, '#4cc9f0');
      hg.addColorStop(1, '#1d6fa8');
    } catch (e) { hg = null; }
    ctx.fillStyle = hg || '#4cc9f0';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(9, 2);
    ctx.lineTo(16, 14);
    ctx.lineTo(0, 7);
    ctx.lineTo(-16, 14);
    ctx.lineTo(-9, 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Wing accents + cockpit.
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.moveTo(-13, 10); ctx.lineTo(-7, 4); ctx.lineTo(-9, 12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(13, 10); ctx.lineTo(7, 4); ctx.lineTo(9, 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff8d6';
    ctx.beginPath();
    ctx.arc(0, -6, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1d6fa8';
    ctx.beginPath();
    ctx.arc(0, -6, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawMeteor(m) {
    if (glowOrange) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35;
      ctx.drawImage(glowOrange, m.x - m.r * 1.6, m.y - m.r * 1.6, m.r * 3.2, m.r * 3.2);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.rot);
    var g = radial(0, 0, m.r, '#c98a4b', '#5c4327');
    ctx.fillStyle = g || '#8d6b4a';
    ctx.strokeStyle = 'rgba(255,150,60,0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var i = 0; i < 8; i++) {
      var a = (i / 8) * Math.PI * 2;
      var rr = m.r * (0.78 + (i % 3) * 0.12);
      var px = Math.cos(a) * rr;
      var py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Craters + hot crack.
    ctx.fillStyle = 'rgba(40,25,12,0.75)';
    ctx.beginPath(); ctx.arc(-m.r * 0.3, -m.r * 0.2, m.r * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(m.r * 0.35, m.r * 0.3, m.r * 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(m.r * 0.1, -m.r * 0.45, m.r * 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,180,80,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-m.r * 0.5, m.r * 0.1);
    ctx.lineTo(-m.r * 0.1, m.r * 0.35);
    ctx.lineTo(m.r * 0.3, m.r * 0.15);
    ctx.stroke();
    ctx.restore();
  }

  function drawStarShape(s) {
    var pulse = 1 + 0.12 * Math.sin(s.pulse);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.scale(pulse, pulse);
    if (glowGold) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glowGold, -s.r * 2.4, -s.r * 2.4, s.r * 4.8, s.r * 4.8);
      ctx.restore();
    }
    ctx.shadowColor = '#ffd166';
    ctx.shadowBlur = qualityLevel >= 2 ? 0 : 14;
    ctx.fillStyle = '#ffd166';
    ctx.strokeStyle = '#fff3c4';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      var rr = i % 2 === 0 ? s.r : s.r * 0.45;
      var px = Math.cos(a) * rr;
      var py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Sparkle cross.
    ctx.strokeStyle = 'rgba(255,243,196,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-s.r - 4, 0); ctx.lineTo(-s.r + 2, 0);
    ctx.moveTo(s.r - 2, 0); ctx.lineTo(s.r + 4, 0);
    ctx.stroke();
    ctx.restore();
  }

  function centerText(lines, y0) {
    ctx.textAlign = 'center';
    var y = y0;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      ctx.font = l.font;
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, W / 2, y);
      y += l.gap;
    }
  }

  function draw() {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
    // Space background: deep gradient + nebulae + twinkling stars.
    var grad = null;
    try {
      grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#06061e');
      grad.addColorStop(0.55, '#0a0a2e');
      grad.addColorStop(1, '#120e38');
    } catch (e) { grad = null; }
    ctx.fillStyle = grad || '#070722';
    ctx.fillRect(-12, -12, W + 24, H + 24);
    for (var n = 0; n < nebulae.length; n++) {
      var nb = nebulae[n];
      var ng = radial(nb.x, nb.y, nb.r, 'rgba(' + nb.c + ',' + nb.a + ')', 'rgba(' + nb.c + ',0)');
      if (ng) { ctx.fillStyle = ng; ctx.fillRect(nb.x - nb.r, nb.y - nb.r, nb.r * 2, nb.r * 2); }
    }
    ctx.fillStyle = '#ffffff';
    for (var i = 0; i < bgStars.length; i++) {
      var b = bgStars[i];
      // Parallax: near layers shift against the ship's position.
      var px = (((b.x - player.x * 0.035 * b.layer) % W) + W) % W;
      var py = (((b.y - player.y * 0.015 * b.layer) % H) + H) % H;
      ctx.globalAlpha = 0.25 + 0.65 * Math.abs(Math.sin(b.tw));
      var sz = b.s;
      ctx.fillRect(px, py, sz, sz);
      if (sz > 2) { ctx.globalAlpha *= 0.5; ctx.fillRect(px - 1, py + sz / 2 - 0.5, sz + 2, 1); ctx.fillRect(px + sz / 2 - 0.5, py - 1, 1, sz + 2); }
    }
    ctx.globalAlpha = 1;
    if (shootingStar) {
      var sa = 1 - shootingStar.t / shootingStar.life;
      ctx.strokeStyle = 'rgba(255,255,255,' + sa + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(shootingStar.x, shootingStar.y);
      ctx.lineTo(shootingStar.x - shootingStar.vx * 0.12, shootingStar.y - shootingStar.vy * 0.12);
      ctx.stroke();
    }

    if (state === 'title') {
      if (glowGold) {
        var pulse = 120 + 18 * Math.sin(Date.now() / 500);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5;
        ctx.drawImage(glowGold, W / 2 - pulse, 205 - pulse, pulse * 2, pulse * 2);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      centerText([
        { text: 'STAR DODGE HD', font: 'bold 42px system-ui, sans-serif', color: '#ffd166', gap: 52 },
        { text: 'Dodge the meteors.', font: '18px system-ui, sans-serif', color: '#eef2ff', gap: 26 },
        { text: 'Grab the stars. Reach 500 to win.', font: '18px system-ui, sans-serif', color: '#eef2ff', gap: 26 },
        { text: '3 lives. Good luck, pilot.', font: '16px system-ui, sans-serif', color: '#b9c4ff', gap: 40 },
        { text: 'Move: Arrow keys (up/down/left/right)', font: '15px system-ui, sans-serif', color: '#b9c4ff', gap: 24 },
        { text: 'or WASD — or drag with mouse / finger', font: '15px system-ui, sans-serif', color: '#b9c4ff', gap: 24 },
        { text: 'Enter / Space to start  •  P pause  •  M mute', font: '15px system-ui, sans-serif', color: '#b9c4ff', gap: 24 },
        { text: 'Tune Sensitivity + Meteor speed in Settings below', font: '15px system-ui, sans-serif', color: '#ffd166', gap: 40 },
        { text: best > 0 ? 'Best score: ' + Math.floor(best) : 'Tap Play or press Enter', font: 'bold 17px system-ui, sans-serif', color: '#ffd166', gap: 0 }
      ], 205);
    } else {
      for (var s = 0; s < stars.length; s++) drawStarShape(stars[s]);
      for (var m = 0; m < meteors.length; m++) drawMeteor(meteors[m]);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var p = 0; p < particles.length; p++) {
        var pt = particles[p];
        ctx.globalAlpha = 1 - pt.t / pt.life;
        ctx.fillStyle = pt.color;
        if (pt.shard) {
          ctx.save();
          ctx.translate(pt.x, pt.y);
          ctx.rotate(pt.rot || 0);
          ctx.fillRect(-pt.r, -pt.r / 2, pt.r * 2, pt.r);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      for (var swi = 0; swi < shockwaves.length; swi++) {
        var swv = shockwaves[swi];
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.8 * (1 - swv.t / swv.life);
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(swv.x, swv.y, swv.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      drawShip();

      // Progress bar to 500, with glow.
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(14, 14, W - 28, 8);
      ctx.shadowColor = '#ffd166';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(14, 14, (W - 28) * Math.min(1, score / WIN_SCORE), 8);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#eef2ff';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(Math.floor(score) + ' / 500', 14, 36);

      if (state === 'paused') {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, W, H);
        centerText([
          { text: 'PAUSED', font: 'bold 40px system-ui, sans-serif', color: '#ffffff', gap: 40 },
          { text: 'Press P to keep flying', font: '17px system-ui, sans-serif', color: '#b9c4ff', gap: 26 },
          { text: 'Settings are below the game — they save automatically', font: '15px system-ui, sans-serif', color: '#ffd166', gap: 0 }
        ], 330);
      }
      if (state === 'won') {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, W, H);
        centerText([
          { text: 'YOU WIN!', font: 'bold 44px system-ui, sans-serif', color: '#ffd166', gap: 54 },
          { text: '500 points. The stars are yours.', font: '19px system-ui, sans-serif', color: '#ffffff', gap: 30 },
          { text: 'Score: ' + Math.floor(score) + '   •   Best: ' + Math.floor(best), font: '17px system-ui, sans-serif', color: '#b9c4ff', gap: 40 },
          { text: 'Press Enter or tap Play to fly again', font: '16px system-ui, sans-serif', color: '#ffffff', gap: 0 }
        ], 300);
      }
      if (state === 'over') {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, W, H);
        centerText([
          { text: 'GAME OVER', font: 'bold 42px system-ui, sans-serif', color: '#ff6b6b', gap: 54 },
          { text: 'The meteors got you this time.', font: '19px system-ui, sans-serif', color: '#ffffff', gap: 30 },
          { text: 'Score: ' + Math.floor(score) + '   •   Best: ' + Math.floor(best), font: '17px system-ui, sans-serif', color: '#b9c4ff', gap: 40 },
          { text: 'Press Enter or tap Play to try again', font: '16px system-ui, sans-serif', color: '#ffffff', gap: 0 }
        ], 300);
      }
    }
    // Vignette: darkens the edges, focuses the eye on the ship.
    var vg = radial(W / 2, H / 2, H * 0.75, 'rgba(0,0,8,0)', 'rgba(0,0,10,0.38)');
    if (vg) { ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H); }
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,60,60,' + (flash * 0.9) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  var last = 0;
  function loop(ts) {
    var rawMs = ts - last;
    if (rawMs > 0 && rawMs < 500) {
      frameEma = frameEma * 0.95 + rawMs * 0.05;
      frameCount++;
      if (frameCount % 180 === 0 && frameEma > 26 && qualityLevel < 2) {
        qualityLevel++;
        particleCap = [240, 120, 60][qualityLevel];
      }
    }
    var dt = Math.max(0, Math.min(0.05, (ts - last) / 1000 || 0));
    last = ts;
    if (state === 'playing') update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function toGameCoords(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (W / rect.width),
      y: (e.clientY - rect.top) * (H / rect.height)
    };
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var p = toGameCoords(e);
    player.tx = p.x;
    player.ty = p.y;
    player.dragging = true;
    if (state === 'title' || state === 'won' || state === 'over') startGame();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!player.dragging) return;
    var p = toGameCoords(e);
    player.tx = p.x;
    player.ty = p.y;
  });
  window.addEventListener('pointerup', function () { player.dragging = false; });

  window.addEventListener('keydown', function (e) {
    keys[e.key] = true;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (state === 'title' || state === 'won' || state === 'over') startGame();
    }
    if ((e.key === 'p' || e.key === 'P') && (state === 'playing' || state === 'paused')) {
      state = state === 'playing' ? 'paused' : 'playing';
    }
    if (e.key === 'm' || e.key === 'M') {
      muted = !muted;
      syncSettingsUI();
      saveSettings();
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].indexOf(e.key) >= 0) e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.key] = false; });

  if (startBtn) startBtn.addEventListener('click', function () { startGame(); });

  updateHud();
  requestAnimationFrame(loop);
})();

// Star Dodge — dodge meteors, collect stars, reach 500 to win.
// Plain canvas JS, no assets. Keyboard + mouse/touch.
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = canvas.width;
  var H = canvas.height;
  var WIN_SCORE = 500;
  var scoreEl = document.getElementById('hud-score');
  var livesEl = document.getElementById('hud-lives');
  var startBtn = document.getElementById('start-btn');

  var state = 'title'; // title | playing | paused | won | over
  var score = 0;
  var lives = 3;
  var best = 0;
  try { best = parseInt(localStorage.getItem('star-dodge-best') || '0', 10) || 0; } catch (e) { best = 0; }
  var muted = false;
  var timeAlive = 0;
  var spawnTimer = 0;
  var starTimer = 0;
  var invuln = 0;
  var flash = 0;
  var shake = 0;

  var player = { x: W / 2, y: H - 110, r: 18, speed: 340, tx: W / 2, ty: H - 110, dragging: false };
  var keys = {};
  var meteors = [];
  var stars = [];
  var particles = [];
  var bgStars = [];
  for (var i = 0; i < 70; i++) {
    bgStars.push({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 2 + 0.5, v: Math.random() * 30 + 8 });
  }

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

  function reset() {
    score = 0;
    lives = 3;
    timeAlive = 0;
    spawnTimer = 0;
    starTimer = 0;
    invuln = 0;
    flash = 0;
    shake = 0;
    meteors = [];
    stars = [];
    particles = [];
    player.x = W / 2;
    player.y = H - 110;
    player.tx = W / 2;
    player.ty = H - 110;
    updateHud();
  }

  function startGame() {
    reset();
    state = 'playing';
    startBtn.textContent = 'Restart';
    beep(520, 0.12, 'square', 0.06);
  }

  function endGame(won) {
    state = won ? 'won' : 'over';
    if (score > best) {
      best = score;
      try { localStorage.setItem('star-dodge-best', String(best)); } catch (e) {}
    }
    if (won) { beep(660, 0.15, 'sine', 0.09); setTimeout(function () { beep(880, 0.25, 'sine', 0.09); }, 150); }
    else { beep(160, 0.4, 'sawtooth', 0.08); }
  }

  function updateHud() {
    scoreEl.textContent = 'Score: ' + score;
    var hearts = '';
    for (var i = 0; i < 3; i++) hearts += i < lives ? '\u2665' : '\u2661';
    livesEl.textContent = 'Lives: ' + hearts;
  }

  function spawnMeteor() {
    var level = 1 + Math.floor(score / 100);
    var r = 14 + Math.random() * 22;
    meteors.push({
      x: r + Math.random() * (W - r * 2),
      y: -r - 10,
      r: r,
      vy: 120 + Math.random() * 130 + level * 28,
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
      rot: Math.random() * Math.PI * 2
    });
  }

  function burst(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 60 + Math.random() * 180;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.4, t: 0, color: color, r: 2 + Math.random() * 3 });
    }
  }

  function dist(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function update(dt) {
    timeAlive += dt;
    // Survival trickle: +5 points per second, rounded into the score display.
    score += dt * 5;
    var shown = Math.floor(score);
    if (shown >= WIN_SCORE) { score = WIN_SCORE; updateHud(); endGame(true); return; }

    // Movement: keyboard.
    var mx = 0, my = 0;
    if (keys.ArrowLeft || keys.a) mx -= 1;
    if (keys.ArrowRight || keys.d) mx += 1;
    if (keys.ArrowUp || keys.w) my -= 1;
    if (keys.ArrowDown || keys.s) my += 1;
    if (mx || my) {
      var len = Math.sqrt(mx * mx + my * my);
      player.x += (mx / len) * player.speed * dt;
      player.y += (my / len) * player.speed * dt;
      player.tx = player.x;
      player.ty = player.y;
      player.dragging = false;
    } else if (player.dragging) {
      // Ease toward the pointer target.
      player.x += (player.tx - player.x) * Math.min(1, dt * 14);
      player.y += (player.ty - player.y) * Math.min(1, dt * 14);
    }
    player.x = Math.max(20, Math.min(W - 20, player.x));
    player.y = Math.max(20, Math.min(H - 20, player.y));

    // Spawning ramps with score.
    var level = 1 + Math.floor(score / 100);
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnMeteor();
      if (level >= 3 && Math.random() < 0.4) spawnMeteor();
      spawnTimer = Math.max(0.28, 0.85 - level * 0.09) * (0.7 + Math.random() * 0.6);
    }
    starTimer -= dt;
    if (starTimer <= 0) { spawnStar(); starTimer = 0.9 + Math.random() * 0.9; }

    if (invuln > 0) invuln -= dt;
    if (flash > 0) flash -= dt;
    if (shake > 0) shake -= dt;

    // Meteors.
    for (var i = meteors.length - 1; i >= 0; i--) {
      var m = meteors[i];
      m.y += m.vy * dt;
      m.x += m.vx * dt;
      m.rot += m.vr * dt;
      if (m.y - m.r > H || m.x < -60 || m.x > W + 60) { meteors.splice(i, 1); continue; }
      if (invuln <= 0 && dist(m, player) < m.r + player.r - 6) {
        lives -= 1;
        invuln = 1.5;
        flash = 0.35;
        shake = 0.35;
        burst(player.x, player.y, '#ff6b6b', 22);
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
      if (s.y - s.r > H) { stars.splice(j, 1); continue; }
      if (dist(s, player) < s.r + player.r + 4) {
        score += 25;
        burst(s.x, s.y, '#ffd166', 14);
        beep(880, 0.1, 'sine', 0.07);
        setTimeout(function () { beep(1320, 0.08, 'sine', 0.05); }, 60);
        stars.splice(j, 1);
        updateHud();
        if (score >= WIN_SCORE) { score = WIN_SCORE; updateHud(); endGame(true); return; }
      }
    }

    // Particles + background drift.
    for (var k = particles.length - 1; k >= 0; k--) {
      var p = particles[k];
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.t >= p.life) particles.splice(k, 1);
    }
    for (var b = 0; b < bgStars.length; b++) {
      bgStars[b].y += bgStars[b].v * dt;
      if (bgStars[b].y > H) { bgStars[b].y = -2; bgStars[b].x = Math.random() * W; }
    }
    updateHud();
  }

  function drawShip() {
    if (invuln > 0 && Math.floor(invuln * 10) % 2 === 0) return; // blink while invulnerable
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.fillStyle = '#4cc9f0';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(14, 14);
    ctx.lineTo(0, 6);
    ctx.lineTo(-14, 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Cockpit + flame.
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(0, -4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff9f1c';
    ctx.beginPath();
    ctx.moveTo(-6, 14);
    ctx.lineTo(0, 26 + Math.random() * 8);
    ctx.lineTo(6, 14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawMeteor(m) {
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.rot);
    ctx.fillStyle = '#8d6b4a';
    ctx.strokeStyle = '#5c4327';
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
    ctx.fillStyle = '#3d2c1a';
    ctx.beginPath(); ctx.arc(-m.r * 0.3, -m.r * 0.2, m.r * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(m.r * 0.35, m.r * 0.3, m.r * 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawStarShape(s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
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
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
    // Space background.
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#070722');
    grad.addColorStop(1, '#0d0d33');
    ctx.fillStyle = grad;
    ctx.fillRect(-12, -12, W + 24, H + 24);
    ctx.fillStyle = '#ffffff';
    for (var i = 0; i < bgStars.length; i++) {
      var b = bgStars[i];
      ctx.globalAlpha = 0.35 + (b.s / 2.5) * 0.5;
      ctx.fillRect(b.x, b.y, b.s, b.s);
    }
    ctx.globalAlpha = 1;

    if (state === 'title') {
      centerText([
        { text: 'STAR DODGE', font: 'bold 44px system-ui, sans-serif', color: '#ffd166', gap: 54 },
        { text: 'Dodge the meteors.', font: '18px system-ui, sans-serif', color: '#eef2ff', gap: 26 },
        { text: 'Grab the stars. Reach 500 to win.', font: '18px system-ui, sans-serif', color: '#eef2ff', gap: 26 },
        { text: '3 lives. Good luck, pilot.', font: '16px system-ui, sans-serif', color: '#b9c4ff', gap: 44 },
        { text: 'Move: arrows / WASD or drag', font: '15px system-ui, sans-serif', color: '#b9c4ff', gap: 24 },
        { text: 'Enter / Space to start  •  P pause  •  M mute', font: '15px system-ui, sans-serif', color: '#b9c4ff', gap: 40 },
        { text: best > 0 ? 'Best score: ' + best : 'Tap Play or press Enter', font: 'bold 17px system-ui, sans-serif', color: '#ffd166', gap: 0 }
      ], 230);
    } else {
      for (var s = 0; s < stars.length; s++) drawStarShape(stars[s]);
      for (var m = 0; m < meteors.length; m++) drawMeteor(meteors[m]);
      for (var p = 0; p < particles.length; p++) {
        var pt = particles[p];
        ctx.globalAlpha = 1 - pt.t / pt.life;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      drawShip();

      // Progress bar to 500.
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(14, 14, W - 28, 8);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(14, 14, (W - 28) * Math.min(1, score / WIN_SCORE), 8);

      if (state === 'paused') {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, W, H);
        centerText([
          { text: 'PAUSED', font: 'bold 40px system-ui, sans-serif', color: '#ffffff', gap: 40 },
          { text: 'Press P to keep flying', font: '17px system-ui, sans-serif', color: '#b9c4ff', gap: 0 }
        ], 340);
      }
      if (state === 'won') {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, W, H);
        centerText([
          { text: 'YOU WIN!', font: 'bold 44px system-ui, sans-serif', color: '#ffd166', gap: 54 },
          { text: '500 points. The stars are yours.', font: '19px system-ui, sans-serif', color: '#ffffff', gap: 30 },
          { text: 'Score: ' + Math.floor(score) + '   •   Best: ' + best, font: '17px system-ui, sans-serif', color: '#b9c4ff', gap: 40 },
          { text: 'Press Enter or tap Play to fly again', font: '16px system-ui, sans-serif', color: '#ffffff', gap: 0 }
        ], 300);
      }
      if (state === 'over') {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, W, H);
        centerText([
          { text: 'GAME OVER', font: 'bold 42px system-ui, sans-serif', color: '#ff6b6b', gap: 54 },
          { text: 'The meteors got you this time.', font: '19px system-ui, sans-serif', color: '#ffffff', gap: 30 },
          { text: 'Score: ' + Math.floor(score) + '   •   Best: ' + best, font: '17px system-ui, sans-serif', color: '#b9c4ff', gap: 40 },
          { text: 'Press Enter or tap Play to try again', font: '16px system-ui, sans-serif', color: '#ffffff', gap: 0 }
        ], 300);
      }
    }
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,60,60,' + (flash * 0.9) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  var last = 0;
  function loop(ts) {
    var dt = Math.min(0.05, (ts - last) / 1000 || 0);
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
    if (e.key === 'm' || e.key === 'M') muted = !muted;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].indexOf(e.key) >= 0) e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.key] = false; });

  startBtn.addEventListener('click', function () { startGame(); });

  updateHud();
  requestAnimationFrame(loop);
})();

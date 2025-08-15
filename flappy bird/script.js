(function(){
  'use strict';

  /* =======================================================
   * Utility helpers
   * ======================================================= */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;
  const now = () => performance.now();

  const storage = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    },
    del(key) { try { localStorage.removeItem(key); } catch {} }
  };

  /* =======================================================
   * Web Audio – tiny SFX synth (no external files)
   * ======================================================= */
  class SFX {
    constructor() {
      this.enabled = true;
      this.ctx = null;
    }
    init() {
      if (this.ctx) return;
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    }
    toggle(on) { this.enabled = on ?? !this.enabled; }
    beep({freq=440, dur=0.08, type='sine', gain=0.06, attack=0.002, release=0.06, slide=0}={}) {
      if (!this.enabled) return;
      if (!this.ctx) this.init();
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      if (slide !== 0) {
        o.frequency.setValueAtTime(freq, t0);
        o.frequency.exponentialRampToValueAtTime(Math.max(1, freq + slide), t0 + dur);
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(attack, dur - release));
      o.connect(g).connect(this.ctx.destination);
      o.start(t0);
      o.stop(t0 + Math.max(attack + release, dur));
    }
    flap() { this.beep({freq: 720, dur: 0.06, type: 'square', gain: 0.04, slide: -220}); }
    score() { this.beep({freq: 540, dur: 0.07, type: 'triangle', gain: 0.05}); }
    hit()   { this.beep({freq: 120, dur: 0.12, type: 'sawtooth', gain: 0.06}); }
  }

  const sfx = new SFX();

  /* =======================================================
   * Game constants & state
   * ======================================================= */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const W = canvas.width;  
  const H = canvas.height;

  function resizeForDPR() {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = Math.floor(W * dpr), h = Math.floor(H * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeForDPR();
  window.addEventListener('resize', resizeForDPR);

  const wrapper = document.querySelector('.canvas-wrap');
  const headerEl = document.querySelector('header');
  const footerEl = document.querySelector('footer');
  function layoutToViewport() {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0;
    const footerH = footerEl ? footerEl.getBoundingClientRect().height : 0;
    const verticalGutters = 32;
    const availH = Math.max(240, vh - headerH - footerH - verticalGutters);
    const scale = Math.min(vw / W, availH / H);
    const cw = Math.floor(W * scale);
    const ch = Math.floor(H * scale);
    wrapper.style.width = cw + 'px';
    wrapper.style.height = ch + 'px';
  }
  window.addEventListener('resize', layoutToViewport);
  layoutToViewport();

  // UI elements
  const scoreVal = document.getElementById('scoreVal');
  const bestVal = document.getElementById('bestVal');
  const statusVal = document.getElementById('statusVal');
  const overlay = document.getElementById('overlay');
  const panelStart = document.getElementById('panel-start');
  const panelGameOver = document.getElementById('panel-gameover');
  const panelPaused = document.getElementById('panel-paused');
  const finalScore = document.getElementById('finalScore');
  const finalBest = document.getElementById('finalBest');

  const playBtn = document.getElementById('playBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const muteBtn = document.getElementById('muteBtn');
  const resetBtn = document.getElementById('resetBtn');
  const startBtn2 = document.getElementById('startBtn2');
  const restartBtn = document.getElementById('restartBtn');
  const shareBtn = document.getElementById('shareBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  // Cheat system
  const cheatInput = document.getElementById('cheatInput');
  const cheatApply = document.getElementById('cheatApply');
  const cheatStatus = document.getElementById('cheatStatus');

  const CHEATS = {
    invincible: false, // code: 4256
    slowmo: false,     // code: 9001
    biggap: false      // code: 1337
  };

let timeScale = 1;

  function setCheatStatus(msg, color = null) {
    cheatStatus.textContent = msg;
    if (color) cheatStatus.style.color = color;
    else cheatStatus.style.color = 'var(--accent)';
  }

  function updateCheatBadge() {
    const active = [];
    if (CHEATS.invincible) active.push('Invincible');
    if (CHEATS.slowmo) active.push('Slow‑mo');
    if (CHEATS.biggap) active.push('Easy');
    setStatus(active.length ? `Playing • Cheats: ${active.join(' / ')}` :
                              (state === STATE.PLAYING ? 'Playing' : statusVal.textContent));
  }
    function activateCode(code) {
    switch (code) {
      case '4256':
        CHEATS.invincible = true;
        setCheatStatus('Invincibility ON');
        break;
      case '9001':
        CHEATS.slowmo = true; timeScale = 0.6;
        setCheatStatus('Slow‑mo ON');
        break;
      case '1337':
        CHEATS.biggap = true;
        setCheatStatus('Easy mode ON (bigger gaps)');
        break;
      case '7777':
        score += 10; scoreVal.textContent = String(score);
        if (score > best) bestVal.textContent = String(score);
        setCheatStatus('+10 score');
        break;
      case '0000':
        CHEATS.invincible = CHEATS.slowmo = CHEATS.biggap = false;
        timeScale = 1;
        setCheatStatus('Cheats cleared', '#98a2b3');
        break;
      default:
        setCheatStatus('Unknown code', '#ff9aa2');
        return false;
    }
    updateCheatBadge();
    return true;
  }

  function scanForCodes(raw) {

    const s = String(raw || '').replace(/\D+/g, '');
    const known = ['4256','9001','1337','7777','0000'];
    for (const k of known) {
      if (s.includes(k)) {
        activateCode(k);
        return k;
      }
    }
    return null;
  }

  cheatApply.addEventListener('click', () => {
    const hit = scanForCodes(cheatInput.value);
    if (hit) cheatInput.value = '';
  });

  // Live detection while typing
  cheatInput.addEventListener('input', () => {
    const hit = scanForCodes(cheatInput.value);
    if (hit) cheatInput.value = '';
  });



  // High score persistence
  const HS_KEY = 'flappy.best.v1';
  let best = storage.get(HS_KEY, 0);
  bestVal.textContent = String(best);

  // Game state machine
  const STATE = { READY: 0, PLAYING: 1, PAUSED: 2, DEAD: 3 };
  let state = STATE.READY;

  // Gameplay constants
  const GRAVITY = 1800;            // px/s^2
  const FLAP_VELOCITY = -500;      // px/s upward impulse
  const PIPE_SPAWN_INTERVAL = 1400;// ms between pipes
  const PIPE_SPEED = 190;          // px/s leftward
  const PIPE_GAP_MIN = 140;        // gap size range
  const PIPE_GAP_MAX = 200;
  const PIPE_W = 74;               // pipe width
  const GROUND_H = 112;            // floor height (like original)

  let dayTime = 0; // cycles between 0..1 for day->night->day

  // Bird properties
  const bird = {
    x: 110, y: H*0.5, r: 18, vy: 0,
    rot: 0,
    flapPhase: 0, // for wing animation
    alive: true,
  };

  // Pipes array: {x, topH, gap, scored}
  let pipes = [];

  // Ground tiles for parallax
  const ground = { x: 0, speed: PIPE_SPEED * 1.0 };

  // Timers
  let lastTime = now();
  let spawnTimer = 0;

  // Score
  let score = 0;

  // Flags
  let debug = false;

  /* =======================================================
   * Input handling
   * ======================================================= */
  function flap() {
    if (state === STATE.READY) startGame();
    if (state === STATE.PLAYING) {
      bird.vy = FLAP_VELOCITY;
      bird.flapPhase = 1; // trigger wing up
      sfx.flap();
    }
    if (state === STATE.DEAD) {
      restart();
    }
  }

  function togglePause() {
    if (state === STATE.Paused) return; // safety (typo guard)
    if (state === STATE.PLAYING) {
      state = STATE.PAUSED;
      showPanel('paused');
      statusVal.textContent = 'Paused';
    } else if (state === STATE.PAUSED) {
      state = STATE.PLAYING;
      hidePanels();
      statusVal.textContent = 'Playing';
      // Reset lastTime to avoid time jump
      lastTime = now();
    }
  }

  function startGame() {
    // Reset scores & world
    score = 0;
    pipes.length = 0;
    spawnTimer = 0;
    ground.x = 0;
    bird.x = 110; bird.y = H * 0.5; bird.vy = 0; bird.alive = true; bird.rot = 0;
    dayTime = Math.random();
    state = STATE.PLAYING;
    statusVal.textContent = 'Playing';
    hidePanels();
    lastTime = now();
  }

  function gameOver() {
    if (state === STATE.DEAD) return;
    state = STATE.DEAD;
    statusVal.textContent = 'Game Over';
    sfx.hit();
    finalScore.textContent = String(score);
    if (score > best) { best = score; storage.set(HS_KEY, best); }
    bestVal.textContent = String(best);
    finalBest.textContent = String(best);
    showPanel('gameover');
  }

  function restart() {
    startGame();
  }

  // Buttons
  playBtn.addEventListener('click', startGame);
  startBtn2.addEventListener('click', startGame);
  restartBtn.addEventListener('click', restart);
  resumeBtn.addEventListener('click', togglePause);

  pauseBtn.addEventListener('click', () => {
    if (state === STATE.PLAYING) togglePause();
    else if (state === STATE.PAUSED) togglePause();
  });

  muteBtn.addEventListener('click', () => {
    sfx.toggle();
    muteBtn.textContent = sfx.enabled ? 'Mute' : 'Unmute';
  });

  resetBtn.addEventListener('click', () => {
    storage.del(HS_KEY);
    best = 0;
    bestVal.textContent = '0';
  });

  shareBtn.addEventListener('click', async () => {
    const text = `I scored ${score} in Flappy Bird! Can you beat my best of ${best}?`;
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
    } catch {}
  });

  // Pointer / keyboard
  canvas.addEventListener('pointerdown', flap);
  canvas.addEventListener('pointermove', e => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); flap(); }
    else if (e.key.toLowerCase() === 'p') { e.preventDefault(); togglePause(); }
    else if (e.key.toLowerCase() === 'm') { e.preventDefault(); sfx.toggle(); muteBtn.textContent = sfx.enabled ? 'Mute' : 'Unmute'; }
    else if (e.key.toLowerCase() === 'r') { e.preventDefault(); restart(); }
    else if (e.key.toLowerCase() === 'd') { debug = !debug; }
  });

  /* =======================================================
   * Panels
   * ======================================================= */
  function hidePanels() {
    overlay.style.pointerEvents = 'none';
    panelStart.style.display = 'none';
    panelGameOver.style.display = 'none';
    panelPaused.style.display = 'none';
  }
  function showPanel(which) {
    overlay.style.pointerEvents = 'auto';
    panelStart.style.display = which === 'start' ? 'block' : 'none';
    panelGameOver.style.display = which === 'gameover' ? 'block' : 'none';
    panelPaused.style.display = which === 'paused' ? 'block' : 'none';
  }
  showPanel('start');

  /* =======================================================
   * Pipe logic
   * ======================================================= */
     function spawnPipe() {
    const gapBase = CHEATS.biggap ? 260 : rand(PIPE_GAP_MIN, PIPE_GAP_MAX);
    const gap = CHEATS.biggap ? rand(gapBase, gapBase + 60) : gapBase;
    const marginTop = 40;
    const marginBottom = 40 + GROUND_H;
    const topH = rand(marginTop, H - marginBottom - gap);
    pipes.push({ x: W + 40, topH, gap, scored: false });
  }

  function updatePipes(dt) {
    const dx = PIPE_SPEED * dt;
    for (let i = 0; i < pipes.length; i++) {
      pipes[i].x -= dx;
    }
    // Remove off-screen pipes
    while (pipes.length && pipes[0].x + PIPE_W < -80) pipes.shift();
  }

    function checkScoreAndCollisions() {
    // Ground collision
if (bird.y + bird.r >= H - GROUND_H) {
  bird.y = H - GROUND_H - bird.r;
  if (!CHEATS.invincible) {
    gameOver();
    return;
  } else {
    bird.vy = 0; // optional: stop sinking through floor while invincible
  }
}


    // Pipes
    for (const p of pipes) {
      // scoring works regardless
      if (!p.scored && p.x + PIPE_W < bird.x - bird.r) {
        p.scored = true;
        score++;
        scoreVal.textContent = String(score);
        if (score > best) bestVal.textContent = String(score);
        sfx.score();
      }
      if (CHEATS.invincible) continue;

      const inX = (bird.x + bird.r > p.x) && (bird.x - bird.r < p.x + PIPE_W);
      if (inX) {
        const gapTop = p.topH;
        const gapBottom = p.topH + p.gap;
        if (bird.y - bird.r < gapTop || bird.y + bird.r > gapBottom) {
          gameOver();
          return;
        }
      }
    }
  }

  /* =======================================================
   * Rendering helpers
   * ======================================================= */
  function drawBackground() {
    // Day/Night sky
    const t = (Math.sin(dayTime * Math.PI * 2) * 0.5 + 0.5);
    const day = { top: '#7ccaff', bottom: '#4aa1ff' };
    const night = { top: '#1b2a4d', bottom: '#0f1b3a' };
    const top = mixColor(day.top, night.top, t);
    const bot = mixColor(day.bottom, night.bottom, t);

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top);
    g.addColorStop(1, bot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Sun/Moon
    const orbY = lerp(120, 60, t);
    const orbX = 340;
    ctx.beginPath();
    ctx.arc(orbX, orbY, 24, 0, Math.PI*2);
    ctx.fillStyle = t < 0.5 ? '#fff8b0' : '#b8c2ff';
    ctx.fill();

    // Clouds (parallax)
    drawCloud(lerp(0, -W, (clock % 6000)/6000), 120, 1.0);
    drawCloud(lerp(100, -W+100, (clock % 9000)/9000), 200, 0.8);
    drawCloud(lerp(260, -W+260, (clock % 7000)/7000), 160, 0.9);
  }

  function drawCloud(x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    roundedRect(-30, -14, 60, 28, 14);
    roundedRect(-55, -10, 40, 20, 10);
    roundedRect(20, -12, 42, 24, 12);
    ctx.restore();
  }

  function drawGround(dt) {
    ground.x -= ground.speed * dt;
    const tileW = 48;
    const h = GROUND_H;
    const y = H - h;
    // Tile pattern
    ctx.save();
    ctx.translate(ground.x % tileW, 0);
    for (let x = -tileW; x < W + tileW; x += tileW) {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#9be37a');
      g.addColorStop(1, '#5cb947');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, tileW, h);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(x, y, tileW, 6);
      // Dirt
      ctx.fillStyle = '#7b4b2a';
      ctx.fillRect(x, y + h - 24, tileW, 24);
      ctx.fillStyle = '#5c371b';
      ctx.fillRect(x, y + h - 12, tileW, 12);
    }
    ctx.restore();
  }

  function drawPipes() {
    for (const p of pipes) {
      const x = Math.floor(p.x);
      const yTop = 0;
      const hTop = Math.floor(p.topH);
      const yBot = Math.floor(p.topH + p.gap);
      const hBot = Math.floor(H - GROUND_H - yBot);

      // Pipe style
      const bodyGrad = ctx.createLinearGradient(0, 0, 0, 240);
      bodyGrad.addColorStop(0, '#6aed5a');
      bodyGrad.addColorStop(1, '#36b34b');

      const lipGrad = ctx.createLinearGradient(0, 0, 0, 12);
      lipGrad.addColorStop(0, '#e0ffd5');
      lipGrad.addColorStop(1, '#b6f8a8');

      // Top pipe
      ctx.fillStyle = bodyGrad;
      ctx.fillRect(x, yTop, PIPE_W, hTop);
      ctx.fillStyle = lipGrad;
      ctx.fillRect(x - 4, hTop - 12, PIPE_W + 8, 12);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(x + PIPE_W - 6, yTop, 6, hTop);

      // Bottom pipe
      ctx.fillStyle = bodyGrad;
      ctx.fillRect(x, yBot, PIPE_W, hBot);
      ctx.fillStyle = lipGrad;
      ctx.fillRect(x - 4, yBot, PIPE_W + 8, 12);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(x + PIPE_W - 6, yBot, 6, hBot);

      if (debug) {
        ctx.strokeStyle = 'rgba(255,0,0,0.7)';
        ctx.strokeRect(x, yTop, PIPE_W, hTop);
        ctx.strokeRect(x, yBot, PIPE_W, hBot);
      }
    }
  }

    function drawBird(dt) {
  // Physics – integrate
  if (state === STATE.PLAYING) {
    bird.vy += GRAVITY * dt;
    bird.y += bird.vy * dt;
    // Rotate towards velocity
    const targetRot = clamp(bird.vy / 600, -0.6, 1.0);
    bird.rot = lerp(bird.rot, targetRot, 0.15);
    // Wing animation
    bird.flapPhase = Math.max(0, bird.flapPhase - dt * 6);
  }

  // Draw bird (simple body + wing)
  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate(bird.rot);

  // Invincibility halo (now centered on the bird)
  if (CHEATS.invincible) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(0, 0, bird.r + 10 + Math.sin(clock * 0.02) * 2, 0, Math.PI * 2);
    ctx.fillStyle = '#7fffd4';
    ctx.fill();
    ctx.restore();
  }

  // Body
  const bodyGrad = ctx.createRadialGradient(-6, -6, 2, 0, 0, 26);
  bodyGrad.addColorStop(0, '#ffe49d');
  bodyGrad.addColorStop(1, '#ffb64d');
  ctx.fillStyle = bodyGrad;
  roundedRect(-20, -16, 40, 32, 16);

  // Belly
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  roundedRect(-14, 0, 24, 14, 7);

  // Eye
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(6, -6, 6, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#151515';
  ctx.beginPath(); ctx.arc(8, -6, 3, 0, Math.PI*2); ctx.fill();

  // Beak
  ctx.fillStyle = '#ffcf4a';
  triangle(18, -2, 30, 2, 18, 6);
  ctx.fillStyle = '#f0a530';
  triangle(18, 2, 30, 6, 18, 10);

  // Wing (animated)
  const wingRaise = (1 - bird.flapPhase) * 14;
  ctx.save();
  ctx.translate(-4, -2 - wingRaise);
  ctx.rotate(-0.4 + bird.flapPhase * 0.8);
  ctx.fillStyle = '#ffd07a';
  roundedRect(-18, -8, 24, 16, 8);
  ctx.restore();

  if (debug) {
    ctx.strokeStyle = 'rgba(255,0,0,0.7)';
    ctx.beginPath(); ctx.arc(0, 0, bird.r, 0, Math.PI*2); ctx.stroke();
  }

  ctx.restore();
}


  function triangle(x1, y1, x2, y2, x3, y3) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fill();
  }

  function roundedRect(x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.lineTo(x+w-rr, y);
    ctx.arcTo(x+w, y, x+w, y+rr, rr);
    ctx.lineTo(x+w, y+h-rr);
    ctx.arcTo(x+w, y+h, x+w-rr, y+h, rr);
    ctx.lineTo(x+rr, y+h);
    ctx.arcTo(x, y+h, x, y+h-rr, rr);
    ctx.lineTo(x, y+rr);
    ctx.arcTo(x, y, x+rr, y, rr);
    ctx.closePath();
    ctx.fill();
  }

  function mixColor(a, b, t) {

    const pa = [parseInt(a.slice(1,3),16), parseInt(a.slice(3,5),16), parseInt(a.slice(5,7),16)];
    const pb = [parseInt(b.slice(1,3),16), parseInt(b.slice(3,5),16), parseInt(b.slice(5,7),16)];
    const pc = [
      Math.round(lerp(pa[0], pb[0], t)),
      Math.round(lerp(pa[1], pb[1], t)),
      Math.round(lerp(pa[2], pb[2], t)),
    ];
    return `#${pc[0].toString(16).padStart(2,'0')}${pc[1].toString(16).padStart(2,'0')}${pc[2].toString(16).padStart(2,'0')}`;
  }
  /* =======================================================
   * Main loop
   * ======================================================= */
  let clock = 0;
  function tick() {
    const t = now();
    let dt = ((t - lastTime) / 1000) * timeScale;
    if (dt > 0.045) dt = 0.045; // clamp large frame stalls
    lastTime = t;
    clock += (dt * 1000);

    // Animate day/night slowly, regardless of state
    dayTime = (dayTime + dt * 0.02) % 1;

    // Clear & draw backdrop
    drawBackground();

    switch (state) {
      case STATE.READY:
        drawGround(dt*0.4); // subtle motion on start screen

        drawBird(0); // no physics
        break;
      case STATE.PLAYING:
        // Spawn pipes
        spawnTimer += dt * 1000;
        if (spawnTimer >= PIPE_SPAWN_INTERVAL) {
          spawnTimer = 0; spawnPipe();
        }
        // Update world
        updatePipes(dt);
        drawPipes();
        drawBird(dt);
        drawGround(dt);
        // Collisions & scoring
        checkScoreAndCollisions();
        break;
      case STATE.PAUSED:
        drawPipes();
        drawBird(0);
        drawGround(0);
        break;
case STATE.DEAD:
  // Let the bird fall/settle a bit even on game over for effect
  bird.vy += GRAVITY * dt * 0.9;
  bird.y = Math.min(bird.y + bird.vy * dt, H - GROUND_H - bird.r);
  bird.rot = lerp(bird.rot, 0.9, 0.08);
  drawPipes();
  drawBird(0);
  drawGround(dt*0.6);
  break;
    }

    // HUD overlays drawn onto canvas (score during play)
    if (state === STATE.PLAYING) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(W/2 - 38, 16, 76, 36);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.textAlign = 'center';
      ctx.fillText(String(score), W/2, 44);
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* =======================================================
   * Accessibility: status text and focus
   * ======================================================= */
  function setStatus(msg) { statusVal.textContent = msg; }

  // Initial message
  setStatus('Ready');

})();
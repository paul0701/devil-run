(function () {
'use strict';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d', { alpha: false });

/* ---------- constants ---------- */
const STEP = 1 / 60;
const SEG_LEN = 200;
const RUMBLE = 3;
const LANES = 3;
const CAM_H = 1000;
const CAM_DEPTH = 1 / Math.tan((95 / 2) * Math.PI / 180);
const ROAD_W = 1500;
const DRAW = 150;
const FOG_DENS = 5;
const MAX_SPEED = SEG_LEN / STEP;
const PLAYER_Z = CAM_H * CAM_DEPTH;
const CAM_FOLLOW = 0.62;
const CAR_W = 0.36;
const TRAFFIC_SPEED = 0.27;
const LANE_X = [-0.667, 0, 0.667];
const FOG_COL = '#0a1024';

/* ---------- helpers ---------- */
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeIn = (a, b, p) => a + (b - a) * p * p;
const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
const fmtTime = (s) => {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
};
function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; } }

/* ---------- screen ---------- */
let W = 0, H = 0, HORIZON = 0, PLAYER_BASE = 0, Kx = 0, Ky = 0, S = 0;
let stars = [], skylineFar = [], skylineNear = [];

function seeded(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function buildSky() {
  const r = seeded(7);
  stars = [];
  for (let i = 0; i < 70; i++) stars.push({ x: r() * W, y: r() * HORIZON * 0.8, s: 1 + r() * 1.6, a: 0.25 + r() * 0.6 });
  const mk = (n, minH, maxH, minW, maxW) => {
    const arr = []; let x = 0; const tile = S * 3;
    while (x < tile) {
      const w = (minW + r() * (maxW - minW)) * S, h = (minH + r() * (maxH - minH)) * S;
      const lit = [];
      for (let k = 0; k < 6; k++) lit.push([r(), r()]);
      arr.push({ x, w, h, lit });
      x += w * (0.7 + r() * 0.5);
    }
    return arr;
  };
  skylineFar = mk(0, 0.10, 0.34, 0.08, 0.2);
  skylineNear = mk(0, 0.05, 0.2, 0.1, 0.24);
}

let resScale = 1;
function resize() {
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2.5) * resScale);
  W = Math.max(320, Math.floor(innerWidth * dpr));
  H = Math.max(480, Math.floor(innerHeight * dpr));
  canvas.width = W; canvas.height = H;
  S = Math.min(W, H * 0.56);
  HORIZON = Math.floor(H * 0.40);
  PLAYER_BASE = Math.floor(H * 0.86);
  Kx = S / 2;
  Ky = PLAYER_BASE - HORIZON;
  buildSky();
}
window.addEventListener('resize', resize);
resize();

/* ---------- track ---------- */
let segments = [], trackLength = 0, cars = [];

function lastY() { return segments.length ? segments[segments.length - 1].p2.world.y : 0; }
function addSegment(curve, y) {
  const n = segments.length;
  segments.push({
    index: n,
    p1: { world: { y: lastY(), z: n * SEG_LEN }, camera: {}, screen: {} },
    p2: { world: { y: y, z: (n + 1) * SEG_LEN }, camera: {}, screen: {} },
    curve, cars: [], pickups: [], crooks: [], decor: [], clip: 0, fog: 0, vis: false, looped: false
  });
}
function addRoad(enter, hold, leave, curve, y) {
  const startY = lastY(), endY = startY + y * SEG_LEN, total = enter + hold + leave;
  for (let n = 0; n < enter; n++) addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
  for (let n = 0; n < hold; n++) addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
  for (let n = 0; n < leave; n++) addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
}
function hillDelta(lo, hi, d) {
  let h = rnd(lo, hi) * (0.65 + d * 0.55);
  const ny = lastY() + h * SEG_LEN;
  if (ny > 4800 || ny < -600) h = -h;
  return h;
}

function buildTrack() {
  segments = [];
  addRoad(30, 30, 30, 0, 0);
  for (let i = 0; i < 46; i++) {
    const d = Math.min(1, i / 18);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const mag = (1.2 + 2.6 * d * Math.random() + 0.5 * Math.random()) * dir;
    const len = () => Math.floor(rnd(25, 55));
    const r = Math.random();
    if (r < 0.1) addRoad(len(), len(), len(), 0, 0);
    else if (r < 0.32) addRoad(len(), len(), len(), mag, 0);
    else if (r < 0.46) { addRoad(len(), len(), len(), mag, 0); addRoad(len(), len(), len(), -mag * 0.8, 0); }
    else if (r < 0.6) addRoad(len(), len(), len(), 0, hillDelta(-14, 18, d));
    else if (r < 0.78) {
      const n = 3 + Math.floor(Math.random() * 3);
      let sign = Math.random() < 0.5 ? 1 : -1;
      for (let k = 0; k < n; k++) {
        let h = sign * rnd(8, 16) * (0.7 + d * 0.5);
        const ny = lastY() + h * SEG_LEN;
        if (ny > 4800 || ny < -600) h = -h;
        addRoad(18, 14, 18, 0, h);
        sign = -sign;
      }
    }
    else addRoad(len(), len(), len(), mag * 0.8, hillDelta(-12, 16, d));
  }
  addRoad(60, 40, 60, 0, -lastY() / SEG_LEN);
  trackLength = segments.length * SEG_LEN;

  // roadside decor
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i % 9 === 0) {
      seg.decor.push({ t: 'lamp', off: -1.32, side: -1 });
      seg.decor.push({ t: 'lamp', off: 1.32, side: 1 });
    }
    for (const side of [-1, 1]) {
      if (i % 4 === (side < 0 ? 0 : 2) && Math.random() < 0.8) {
        const w = rnd(900, 2600), h = rnd(4500, 15000);
        const cols = Math.max(2, Math.floor(w / 330)), rows = Math.max(3, Math.floor(h / 520));
        const lit = [];
        for (let c = 0; c < cols; c++) for (let r2 = 0; r2 < rows; r2++) if (Math.random() < 0.22) lit.push([c, r2]);
        seg.decor.push({ t: 'bld', off: side * rnd(2.4, 7.5), w, h, cols, rows, lit, shade: Math.random() < 0.5 ? '#0d1530' : '#10192f' });
      }
    }
  }
}

function findSegment(z) { return segments[Math.floor(z / SEG_LEN) % segments.length]; }
function pctRemaining(n, total) { return (n % total) / total; }
function increase(start, inc, max) { let r = start + inc; while (r >= max) r -= max; while (r < 0) r += max; return r; }

/* ---------- traffic ---------- */
const CAR_COLS = ['#4f7cac', '#e0875a', '#5fa886', '#8b72b8', '#c8c5bb', '#3c4a63', '#d9b84a', '#6b8e9b'];
function pickType() {
  const r = Math.random();
  if (r < 0.34) return 'sedan';
  if (r < 0.48) return 'taxi';
  if (r < 0.64) return 'van';
  if (r < 0.76) return 'truck';
  if (r < 0.84) return 'police';
  return 'hatch';
}

function circDist(a, b) { let d = Math.abs(a - b) % trackLength; return Math.min(d, trackLength - d); }

function makeTraffic() {
  cars = [];
  segments.forEach((s) => (s.cars = []));
  const list = [];
  for (let lane = 0; lane < LANES; lane++) {
    let z = SEG_LEN * (90 + rnd(0, 40));
    while (z < trackLength - SEG_LEN * 70) {
      const prog = z / trackLength;
      const gap = Math.max(26, rnd(40, 66) * (1 - 0.3 * prog));
      list.push({ lane, offset: LANE_X[lane], z, speed: MAX_SPEED * TRAFFIC_SPEED, type: pickType(), color: CAR_COLS[Math.floor(Math.random() * CAR_COLS.length)], passed: false, ph: Math.random() * 6, percent: 0 });
      z += gap * SEG_LEN;
    }
  }
  // never leave a full wall of three across the road
  const win = SEG_LEN * 10;
  for (const c of list) {
    let blocked = 0;
    for (let l = 0; l < LANES; l++) {
      if (l === c.lane) continue;
      if (list.some((o) => o !== c && !o.dead && o.lane === l && circDist(o.z, c.z) < win)) blocked++;
    }
    if (blocked >= 2) c.dead = true;
  }
  for (const c of list) {
    if (c.dead) continue;
    cars.push(c);
    c.percent = pctRemaining(c.z, SEG_LEN);
    findSegment(c.z).cars.push(c);
  }
}

function moveCar(car, newZ, key) {
  key = key || 'cars';
  const old = findSegment(car.z);
  car.z = newZ;
  const nw = findSegment(car.z);
  if (old !== nw) {
    const i = old[key].indexOf(car);
    if (i >= 0) old[key].splice(i, 1);
    nw[key].push(car);
  }
  car.percent = pctRemaining(car.z, SEG_LEN);
}

let pickups = [];
const PICK = {
  shield: { col: '#4aa8ff', txt: 'S', msg: 'SHIELD' },
  turbo: { col: '#ff8a2a', txt: 'T', msg: 'TURBO READY' },
  x2: { col: '#ffd24a', txt: '2X', msg: 'DOUBLE POINTS' }
};
function makePickups() {
  pickups = [];
  segments.forEach((sg) => (sg.pickups = []));
  let i = 70 + Math.floor(rnd(0, 20));
  while (i < segments.length - 80) {
    const r = Math.random();
    const type = r < 0.36 ? 'shield' : r < 0.72 ? 'turbo' : 'x2';
    const z = i * SEG_LEN + SEG_LEN / 2;
    let lane = -1;
    const start = Math.floor(Math.random() * LANES);
    for (let t = 0; t < LANES; t++) {
      const l = (start + t) % LANES;
      if (!cars.some((c) => c.lane === l && circDist(c.z, z) < SEG_LEN * 12)) { lane = l; break; }
    }
    if (lane >= 0) {
      const pk = { lane, offset: LANE_X[lane], z, speed: MAX_SPEED * TRAFFIC_SPEED, type, taken: false, takenAt: 0, ph: Math.random() * 6, percent: pctRemaining(z, SEG_LEN) };
      pickups.push(pk);
      findSegment(z).pickups.push(pk);
    }
    i += Math.floor(rnd(70, 110));
  }
}

function makeCrooks() {
  crooks = [];
  segments.forEach((sg) => (sg.crooks = []));
  let i = 100 + Math.floor(rnd(0, 25));
  while (i < segments.length - 80) {
    const z = i * SEG_LEN + SEG_LEN / 2;
    let lane = -1;
    const start = Math.floor(Math.random() * LANES);
    for (let t = 0; t < LANES; t++) {
      const l = (start + t) % LANES;
      if (!cars.some((c) => c.lane === l && circDist(c.z, z) < SEG_LEN * 12) && !pickups.some((q) => q.lane === l && circDist(q.z, z) < SEG_LEN * 10)) { lane = l; break; }
    }
    if (lane >= 0) {
      const c = { lane, offset: LANE_X[lane], z, speed: MAX_SPEED * TRAFFIC_SPEED, dead: false, deadAt: 0, ph: Math.random() * 6, percent: pctRemaining(z, SEG_LEN) };
      crooks.push(c);
      findSegment(z).crooks.push(c);
    }
    i += Math.floor(rnd(60, 95));
  }
}

/* ---------- game state ---------- */
let shield = false, turboT = 0, turboCharges = 0, x2T = 0, scoreAcc = 0, busts = 0;
let crooks = [], parts = [], rings = [], flashCol = '255,255,255';
let state = 'menu';
let position = 0, speed = 0, playerX = 0, steer = 0;
let elapsed = 0, distance = 0, bonus = 0, skyOffset = 0, shake = 0, crashT = 0, flash = 0, crashDir = 1, tAnim = 0;
let best = parseInt(store('devilrun.best') || '0', 10) || 0;
let controlMode = store('devilrun.controls') === 'tilt' ? 'tilt' : 'swipe';
let acc = 0, last = 0;

function rel(z) {
  let d = z - (position + PLAYER_Z);
  d = ((d % trackLength) + trackLength) % trackLength;
  if (d > trackLength / 2) d -= trackLength;
  return d;
}

/* ---------- input ---------- */
let swipeSteer = 0, dragging = false, startX = 0, keyDir = 0, tiltRaw = 0, tiltBase = 0, tiltOn = false;

function dragMax() { return Math.max(60, innerWidth * 0.16); }
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'playing') return;
  dragging = true; startX = e.clientX;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const max = dragMax();
  let off = e.clientX - startX;
  if (off > max) { startX = e.clientX - max; off = max; }
  if (off < -max) { startX = e.clientX + max; off = -max; }
  const v = off / max;
  swipeSteer = Math.abs(v) < 0.04 ? 0 : v;
});
const endDrag = () => { dragging = false; swipeSteer = 0; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', endDrag);
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a') keyDir = -1;
  else if (e.key === 'ArrowRight' || e.key === 'd') keyDir = 1;
  else if ((e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') && state === 'playing') activateTurbo();
  else if ((e.key === 'Enter' || e.key === ' ') && state === 'over') startGame();
  else if ((e.key === 'Enter' || e.key === ' ') && state === 'menu') startGame();
});
window.addEventListener('keyup', (e) => {
  if (['ArrowLeft', 'a'].includes(e.key) && keyDir < 0) keyDir = 0;
  if (['ArrowRight', 'd'].includes(e.key) && keyDir > 0) keyDir = 0;
});
window.addEventListener('deviceorientation', (e) => {
  if (e.gamma === null || e.gamma === undefined) return;
  let g = e.gamma;
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  if (ang === 90 || ang === -270) g = e.beta || 0;
  else if (ang === 270 || ang === -90) g = -(e.beta || 0);
  tiltRaw = g;
});

function inputSteer() {
  let v = 0;
  if (controlMode === 'tilt') v = clamp((tiltRaw - tiltBase) / 18, -1, 1);
  if (dragging) v = swipeSteer;
  if (keyDir) v = keyDir;
  return v;
}

/* ---------- music ---------- */
const music = new Audio('music.mp3');
music.loop = true; music.volume = 0.55; music.preload = 'auto';
let muted = store('devilrun.muted') === '1';
music.muted = muted;
function playMusic() {
  if (muted) return;
  const p = music.play();
  if (p && p.catch) p.catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) music.pause();
  else if (!muted && state !== 'menu') playMusic();
});

/* ---------- UI ---------- */
const el = {
  menu: $('menu'), over: $('over'), hud: $('hud'), speed: $('speed'), score: $('score'), time: $('time'), mph: $('mph'),
  pop: $('pop'), hint: $('hint'), play: $('play'), again: $('again'), toMenu: $('toMenu'), mSwipe: $('mSwipe'), mTilt: $('mTilt'),
  power: $('power'), turbo: $('turbo'), finalBusts: $('finalBusts'), mute: $('mute'), menuBest: $('menuBest'), menuNote: $('menuNote'), finalScore: $('finalScore'), finalTime: $('finalTime'), newBest: $('newBest'), overBest: $('overBest')
};

function setMode(m) {
  controlMode = m;
  store('devilrun.controls', m);
  el.mSwipe.classList.toggle('on', m === 'swipe');
  el.mTilt.classList.toggle('on', m === 'tilt');
  el.menuNote.textContent = m === 'swipe' ? 'Drag anywhere on the screen to steer.' : 'Hold your phone upright and tilt it left or right.';
}
async function chooseTilt() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') { setMode('swipe'); el.menuNote.textContent = 'Tilt permission was refused, so swipe is on.'; return; }
    }
    setMode('tilt');
  } catch (e) { setMode('swipe'); el.menuNote.textContent = 'Tilt is not available here, so swipe is on.'; }
}
el.mSwipe.addEventListener('click', () => setMode('swipe'));
el.mTilt.addEventListener('click', chooseTilt);
function paintMute() { el.mute.textContent = muted ? 'MUSIC OFF' : 'MUSIC ON'; el.mute.classList.toggle('on', !muted); }
el.mute.addEventListener('click', () => {
  muted = !muted; music.muted = muted; store('devilrun.muted', muted ? '1' : '0');
  if (!muted) playMusic(); else music.pause();
  paintMute();
});
paintMute();
el.play.addEventListener('click', () => startGame());
el.again.addEventListener('click', () => startGame());
el.turbo.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); activateTurbo(); });
el.toMenu.addEventListener('click', () => showMenu());

function showMenu() {
  state = 'menu';
  el.menu.classList.add('show'); el.over.classList.remove('show');
  el.hud.hidden = true; el.speed.hidden = true; el.power.hidden = true; el.turbo.hidden = true;
  el.menuBest.textContent = best ? 'BEST ' + best : '';
  buildTrack(); makeTraffic(); makePickups(); makeCrooks();
  shield = false; turboT = 0; turboCharges = 0; x2T = 0; busts = 0;
  position = 0; speed = MAX_SPEED * 0.42; playerX = 0;
}

let popTimer = 0;
function pop(text) {
  el.pop.textContent = text;
  el.pop.classList.remove('show');
  void el.pop.offsetWidth;
  el.pop.classList.add('show');
}
function hint(text, ms) {
  el.hint.textContent = text; el.hint.classList.add('show');
  clearTimeout(popTimer);
  popTimer = setTimeout(() => el.hint.classList.remove('show'), ms);
}

function startGame() {
  playMusic();
  buildTrack(); makeTraffic(); makePickups(); makeCrooks();
  shield = false; turboT = 0; turboCharges = 0; x2T = 0; scoreAcc = 0; busts = 0; parts = []; rings = [];
  position = 0; speed = MAX_SPEED * 0.4; playerX = 0; steer = 0;
  for (const c of cars) c.passed = rel(c.z) < 0;
  elapsed = 0; distance = 0; bonus = 0; shake = 0; crashT = 0; flash = 0; skyOffset = 0;
  tiltBase = tiltRaw;
  state = 'playing';
  el.menu.classList.remove('show'); el.over.classList.remove('show');
  el.hud.hidden = false; el.speed.hidden = false;
  hint(controlMode === 'swipe' ? 'DRAG TO STEER' : 'TILT TO STEER', 2600);
  setTimeout(() => { if (state === 'playing' && elapsed < 9) hint('RAM THE MARKED BAD GUYS', 2800); }, 3000);
}

function activateTurbo() {
  if (state !== 'playing' || turboCharges <= 0 || turboT > 0) return;
  turboCharges--; turboT = 5; shake = Math.max(shake, 0.5); flash = Math.max(flash, 0.2); flashCol = '255,160,60';
  pop('TURBO!');
}

function currentScore() { return Math.floor(scoreAcc) + bonus; }

function explode(x, y, sz) {
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, sp = (0.3 + Math.random() * 2.0) * sz;
    parts.push({ k: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - sz * 0.5, life: 0, max: 0.45 + Math.random() * 0.7, size: (0.05 + Math.random() * 0.14) * sz });
  }
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, sp = (0.2 + Math.random() * 0.9) * sz;
    parts.push({ k: 'smoke', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - sz * 0.6, life: 0, max: 0.9 + Math.random() * 0.8, size: (0.1 + Math.random() * 0.18) * sz });
  }
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI * Math.random(), sp = (0.6 + Math.random() * 1.8) * sz;
    parts.push({ k: 'deb', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.9 + Math.random() * 0.6, size: (0.03 + Math.random() * 0.05) * sz, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14 });
  }
  rings.push({ x, y, life: 0, max: 0.55, sz });
}

function playerGeom() {
  const pw = (1 / CAM_H) * CAR_W * ROAD_W * Kx * 1.28;
  const px = W / 2 + (1 / CAM_H) * (playerX * ROAD_W - playerX * ROAD_W * CAM_FOLLOW) * Kx;
  return { pw, px };
}

function bust(c) {
  c.dead = true; c.deadAt = elapsed; busts++;
  const m = x2T > 0 ? 2 : 1;
  bonus += 250 * m;
  pop('BUSTED +' + 250 * m);
  const g = playerGeom();
  const sx = W / 2 + (1 / CAM_H) * (c.offset * ROAD_W - playerX * ROAD_W * CAM_FOLLOW) * Kx;
  explode(sx, PLAYER_BASE - g.pw * 1.15, g.pw * 1.2);
  flash = 0.55; flashCol = '255,170,60'; shake = 1;
}

function breakShield(car) {
  shield = false; flash = 0.5; shake = 0.8;
  pop('SHIELD SAVED YOU');
  const sg = findSegment(car.z);
  const i = sg.cars.indexOf(car);
  if (i >= 0) sg.cars.splice(i, 1);
  const j = cars.indexOf(car);
  if (j >= 0) cars.splice(j, 1);
}

function crash(car) {
  state = 'crashing'; crashT = 0; flash = 1; flashCol = '255,255,255'; shake = 1;
  crashDir = playerX - car.offset >= 0 ? 1 : -1;
  endDrag();
}

function gameOver() {
  state = 'over';
  const sc = currentScore();
  const isBest = sc > best;
  if (isBest) { best = sc; store('devilrun.best', String(best)); }
  el.finalScore.textContent = sc;
  el.finalTime.textContent = fmtTime(elapsed);
  el.finalBusts.textContent = busts ? 'BAD GUYS BUSTED ' + busts : '';
  el.newBest.textContent = isBest ? 'NEW BEST' : '';
  el.overBest.textContent = 'BEST ' + best;
  el.hud.hidden = true; el.speed.hidden = true; el.power.hidden = true;
  el.over.classList.add('show');
  if (window.Account) Account.reportBest(sc);
}

/* ---------- update ---------- */
function update(dt) {
  tAnim += dt;
  const playing = state === 'playing';
  const playerSeg = findSegment(position + PLAYER_Z);

  if (playing) {
    elapsed += dt;
    turboT = Math.max(0, turboT - dt); x2T = Math.max(0, x2T - dt);
    const target = MAX_SPEED * (0.45 + 0.45 * Math.min(1, elapsed / 170)) * (turboT > 0 ? 1.32 : 1);
    const speedPct0 = speed / MAX_SPEED;
    const offRoad = Math.abs(playerX) > 1.02;
    if (offRoad) speed = approach(speed, MAX_SPEED * 0.3, MAX_SPEED * 0.8 * dt);
    else speed = approach(speed, target, MAX_SPEED * (turboT > 0 ? 0.7 : 0.22) * dt);

    const want = inputSteer();
    steer += (want - steer) * Math.min(1, dt * 14);
    const pct = speed / MAX_SPEED;
    playerX += steer * dt * (1.4 + 2.4 * pct);
    playerX -= dt * 2 * Math.min(pct, 1) * Math.min(pct, 1) * playerSeg.curve * 0.26;
    if (playerX > 1.32) { playerX = 1.32; speed = approach(speed, MAX_SPEED * 0.3, MAX_SPEED * 0.6 * dt); shake = Math.max(shake, 0.3); }
    if (playerX < -1.32) { playerX = -1.32; speed = approach(speed, MAX_SPEED * 0.3, MAX_SPEED * 0.6 * dt); shake = Math.max(shake, 0.3); }
  } else if (state === 'menu') {
    speed = MAX_SPEED * 0.42;
    playerX = Math.sin(tAnim * 0.5) * 0.55;
    steer = Math.cos(tAnim * 0.5) * 0.3;
  } else if (state === 'crashing') {
    crashT += dt;
    speed = approach(speed, 0, MAX_SPEED * 1.1 * dt);
    playerX += crashDir * dt * 0.5 * (speed / MAX_SPEED + 0.1);
    playerX = clamp(playerX, -1.4, 1.4);
    if (crashT > 1.15) gameOver();
  } else {
    speed = approach(speed, 0, MAX_SPEED * 2 * dt);
  }

  position = increase(position, dt * speed, trackLength);
  if (playing || state === 'crashing') {
    distance += dt * speed;
    if (playing) scoreAcc += (dt * speed / (SEG_LEN * 10)) * (x2T > 0 ? 2 : 1);
  }
  skyOffset += 0.035 * playerSeg.curve * (speed / MAX_SPEED) * dt * 4;
  shake = Math.max(0, shake - dt * 1.8);
  flash = Math.max(0, flash - dt * 2.4);

  // traffic
  let hit = null;
  for (const car of cars) {
    moveCar(car, increase(car.z, dt * car.speed, trackLength));
    car.offset = LANE_X[car.lane] + Math.sin(tAnim * 0.7 + car.ph) * 0.025;
    const r = rel(car.z);
    if (playing) {
      if (r < 0) {
        if (!car.passed) {
          car.passed = true;
          const gap = Math.abs(car.offset - playerX);
          const m = x2T > 0 ? 2 : 1;
          if (gap < 0.64) { bonus += 50 * m; pop('CLOSE CALL +' + 50 * m); }
          else bonus += 5 * m;
        }
      } else car.passed = false;
      if (Math.abs(r) < 140 && Math.abs(car.offset - playerX) < CAR_W * 0.82) { hit = car; }
    } else {
      car.passed = r < 0;
    }
  }
  if (hit) { if (shield) breakShield(hit); else crash(hit); }

  // bad guys
  for (const c of crooks) {
    moveCar(c, increase(c.z, dt * c.speed, trackLength), 'crooks');
    c.offset = LANE_X[c.lane] + Math.sin(tAnim * 1.4 + c.ph) * 0.05;
    const r = rel(c.z);
    if (c.dead) {
      if (r > SEG_LEN * 45 && elapsed - c.deadAt > 25) c.dead = false;
    } else if (playing && Math.abs(r) < 150 && Math.abs(c.offset - playerX) < CAR_W * 0.9) bust(c);
  }

  // explosions
  for (const q of parts) {
    q.life += dt;
    q.x += q.vx * dt; q.y += q.vy * dt + (speed / MAX_SPEED) * H * 0.22 * dt;
    q.vx *= Math.pow(0.12, dt); q.vy *= Math.pow(0.2, dt);
    if (q.k === 'deb') { q.vy += H * 0.9 * dt; q.rot += q.vr * dt; }
  }
  parts = parts.filter((q) => q.life < q.max);
  for (const q of rings) q.life += dt;
  rings = rings.filter((q) => q.life < q.max);

  // pick-ups
  for (const pk of pickups) {
    moveCar(pk, increase(pk.z, dt * pk.speed, trackLength), 'pickups');
    pk.offset = LANE_X[pk.lane];
    const r = rel(pk.z);
    if (pk.taken) {
      if (r > SEG_LEN * 45 && elapsed - pk.takenAt > 20) pk.taken = false;
    } else if (playing && Math.abs(r) < 170 && Math.abs(pk.offset - playerX) < 0.42) {
      pk.taken = true; pk.takenAt = elapsed;
      if (pk.type === 'shield') shield = true;
      else if (pk.type === 'turbo') turboCharges = Math.min(3, turboCharges + 1);
      else x2T = 10;
      flash = Math.max(flash, 0.22);
      pop(PICK[pk.type].msg);
    }
  }
}

/* ---------- projection ---------- */
function project(p, camX, camY, camZ) {
  p.camera.x = -camX; p.camera.y = p.world.y - camY; p.camera.z = p.world.z - camZ;
  p.screen.scale = CAM_DEPTH / p.camera.z;
  p.screen.x = Math.round(W / 2 + p.screen.scale * p.camera.x * Kx);
  p.screen.y = Math.round(HORIZON - p.screen.scale * p.camera.y * Ky);
  p.screen.w = Math.round(p.screen.scale * ROAD_W * Kx);
}

/* ---------- drawing ---------- */
const ROAD_COL = ['#1b2438', '#171f33'];
const RUMBLE_COL = ['#7d1a26', '#aab0c2'];
const GRASS_COL = ['#080d1a', '#070b16'];

function poly(x1, y1, x2, y2, x3, y3, x4, y4, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
  ctx.closePath(); ctx.fill();
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, HORIZON);
  g.addColorStop(0, '#03050d'); g.addColorStop(0.65, '#0a1030'); g.addColorStop(1, '#2b2150');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, HORIZON + 2);
  ctx.fillStyle = '#070b17'; ctx.fillRect(0, HORIZON, W, H - HORIZON);
  // stars
  const sh = skyOffset * 0.4 * S;
  ctx.fillStyle = '#fff';
  for (const st of stars) {
    ctx.globalAlpha = st.a;
    const x = (((st.x - sh) % W) + W) % W;
    ctx.fillRect(x, st.y, st.s, st.s);
  }
  ctx.globalAlpha = 1;
  // moon
  const mx = (((W * 0.78 - sh) % (W * 1.4)) + W * 1.4) % (W * 1.4) - W * 0.2;
  ctx.fillStyle = 'rgba(235,240,255,.9)';
  ctx.beginPath(); ctx.arc(mx, HORIZON * 0.3, S * 0.045, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(160,180,255,.08)';
  ctx.beginPath(); ctx.arc(mx, HORIZON * 0.3, S * 0.11, 0, Math.PI * 2); ctx.fill();
  // skyline layers
  const tile = S * 3;
  const layer = (arr, color, par, litCol) => {
    const shift = ((skyOffset * S * par) % tile + tile) % tile;
    ctx.fillStyle = color;
    for (let k = -1; k * tile < W + tile; k++) {
      for (const b of arr) {
        const x = b.x - shift + k * tile;
        if (x > W || x + b.w < 0) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x, HORIZON - b.h, b.w, b.h + 2);
        ctx.fillStyle = litCol;
        for (const l of b.lit) ctx.fillRect(x + l[0] * (b.w - 3), HORIZON - b.h + 4 + l[1] * (b.h - 8), 2, 2);
      }
    }
  };
  layer(skylineFar, '#0c1330', 0.55, 'rgba(255,214,130,.55)');
  layer(skylineNear, '#080c1f', 0.9, 'rgba(255,214,130,.7)');
}

function drawRoadSegment(seg) {
  const p1 = seg.p1.screen, p2 = seg.p2.screen;
  const grp = Math.floor(seg.index / RUMBLE) % 2;
  const x1 = p1.x, y1 = p1.y, w1 = p1.w, x2 = p2.x, y2 = p2.y, w2 = p2.w;
  ctx.fillStyle = GRASS_COL[grp];
  ctx.fillRect(0, y2, W, y1 - y2);
  const r1 = w1 / 6, r2 = w2 / 6;
  poly(x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, RUMBLE_COL[grp]);
  poly(x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, RUMBLE_COL[grp]);
  poly(x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, ROAD_COL[grp]);
  // barriers
  const bh1 = p1.scale * 230 * Kx, bh2 = p2.scale * 230 * Kx;
  const lx1 = x1 - w1 - r1, lx2 = x2 - w2 - r2, rx1 = x1 + w1 + r1, rx2 = x2 + w2 + r2;
  poly(lx1, y1, lx1, y1 - bh1, lx2, y2 - bh2, lx2, y2, '#1c2540');
  poly(rx1, y1, rx1, y1 - bh1, rx2, y2 - bh2, rx2, y2, '#1c2540');
  const th1 = bh1 * 0.16, th2 = bh2 * 0.16;
  poly(lx1, y1 - bh1, lx1, y1 - bh1 + th1, lx2, y2 - bh2 + th2, lx2, y2 - bh2, '#55679a');
  poly(rx1, y1 - bh1, rx1, y1 - bh1 + th1, rx2, y2 - bh2 + th2, rx2, y2 - bh2, '#55679a');
  // dashed lane lines
  if (grp === 0) {
    const lw1 = (w1 * 2) / LANES, lw2 = (w2 * 2) / LANES;
    const t1 = lw1 / 30, t2 = lw2 / 30;
    for (let l = 1; l < LANES; l++) {
      const lx1b = x1 - w1 + lw1 * l, lx2b = x2 - w2 + lw2 * l;
      poly(lx1b - t1, y1, lx1b + t1, y1, lx2b + t2, y2, lx2b - t2, y2, '#aab4cf');
    }
  }
  if (seg.fog > 0.01) {
    ctx.globalAlpha = seg.fog;
    ctx.fillStyle = FOG_COL;
    ctx.fillRect(0, y2, W, y1 - y2);
    ctx.globalAlpha = 1;
  }
}

function withClip(y, clipY, fn) {
  if (clipY < y) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, Math.max(0, clipY)); ctx.clip();
    fn();
    ctx.restore();
  } else fn();
}

function drawPickup(x, y, w, pk) {
  const r = w * 0.34;
  if (r < 2) return;
  const c = PICK[pk.type].col;
  const cy = y - w * 0.6 + Math.sin(tAnim * 4 + pk.ph) * w * 0.05;
  glowDisc(x, y, w * 0.4, w * 0.06, c + '55');
  ctx.fillStyle = c + '22'; ctx.beginPath(); ctx.arc(x, cy, r * 1.9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = c + '44'; ctx.beginPath(); ctx.arc(x, cy, r * 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0a1024'; ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.5, r * 0.18); ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.stroke();
  if (r > 6) {
    ctx.fillStyle = c; ctx.font = '800 ' + Math.round(r * (pk.type === 'x2' ? 0.95 : 1.2)) + 'px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(PICK[pk.type].txt, x, cy + r * 0.05);
  }
}

function drawLamp(x, y, scale, side) {
  const h = scale * 3300 * Kx, t = Math.max(1, scale * 55 * Kx), arm = scale * 520 * Kx, dir = -side;
  if (h < 3) return;
  ctx.fillStyle = '#2a3350';
  ctx.fillRect(x - t / 2, y - h, t, h);
  ctx.fillRect(Math.min(x, x + dir * arm), y - h, Math.abs(arm), t);
  const hx = x + dir * arm, hy = y - h + t;
  ctx.fillStyle = 'rgba(255,230,160,.10)';
  ctx.beginPath(); ctx.ellipse(hx, hy, t * 5, t * 3.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,230,160,.18)';
  ctx.beginPath(); ctx.ellipse(hx, hy, t * 2.6, t * 1.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff3c4';
  ctx.fillRect(hx - t * 1.5, hy, t * 3, Math.max(1.5, t * 0.8));
}

function drawBuilding(x, y, scale, b) {
  const bw = scale * b.w * Kx, bh = scale * b.h * Kx;
  if (bw < 2) return;
  ctx.fillStyle = b.shade;
  ctx.fillRect(x - bw / 2, y - bh, bw, bh);
  if (bw > 22) {
    const ww = bw / (b.cols * 1.9), wh = bh / (b.rows * 1.9);
    ctx.fillStyle = 'rgba(255,214,130,.65)';
    for (const l of b.lit) ctx.fillRect(x - bw / 2 + (l[0] + 0.3) * (bw / b.cols), y - bh + (l[1] + 0.3) * (bh / b.rows), ww, wh);
  }
}

function glowDisc(x, y, rx, ry, rgba) {
  ctx.fillStyle = rgba;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}

function drawTraffic(x, y, w, type, color, t) {
  if (w < 3) return;
  // ground shadow
  glowDisc(x, y - w * 0.02, w * 0.56, w * 0.07, 'rgba(0,0,0,.55)');
  // wheels
  ctx.fillStyle = '#05070e';
  ctx.fillRect(x - w * 0.46, y - w * 0.22, w * 0.15, w * 0.22);
  ctx.fillRect(x + w * 0.31, y - w * 0.22, w * 0.15, w * 0.22);
  let top = 0.62;
  if (type === 'van') {
    ctx.fillStyle = color; ctx.fillRect(x - w * 0.5, y - w * 0.98, w, w * 0.78);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x - w * 0.5, y - w * 0.98, w, w * 0.08);
    ctx.fillStyle = '#0b1220'; ctx.fillRect(x - w * 0.36, y - w * 0.86, w * 0.72, w * 0.26);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x - w * 0.01, y - w * 0.98, w * 0.02, w * 0.78);
    top = 0.98;
  } else if (type === 'truck') {
    ctx.fillStyle = '#2b3447'; ctx.fillRect(x - w * 0.5, y - w * 0.26, w, w * 0.1);
    ctx.fillStyle = color; ctx.fillRect(x - w * 0.5, y - w * 1.22, w, w * 1.0);
    ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(x - w * 0.5, y - w * 1.22, w, w * 0.07);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(x - w * 0.01, y - w * 1.22, w * 0.02, w * 1.0);
    ctx.fillRect(x - w * 0.5, y - w * 0.62, w, w * 0.02);
    top = 1.22;
  } else {
    // sedan family
    const bodyCol = type === 'taxi' ? '#e0b92a' : type === 'police' ? '#d7dce8' : color;
    ctx.fillStyle = bodyCol; ctx.fillRect(x - w * 0.5, y - w * 0.5, w, w * 0.34);
    const cabW = type === 'hatch' ? 0.78 : 0.68;
    ctx.beginPath();
    ctx.moveTo(x - w * (cabW / 2 + 0.06), y - w * 0.5);
    ctx.lineTo(x - w * (cabW / 2 - 0.04), y - w * 0.78);
    ctx.lineTo(x + w * (cabW / 2 - 0.04), y - w * 0.78);
    ctx.lineTo(x + w * (cabW / 2 + 0.06), y - w * 0.5);
    ctx.closePath(); ctx.fillStyle = bodyCol; ctx.fill();
    ctx.fillStyle = '#0b1220';
    ctx.beginPath();
    ctx.moveTo(x - w * (cabW / 2 + 0.01), y - w * 0.52);
    ctx.lineTo(x - w * (cabW / 2 - 0.07), y - w * 0.74);
    ctx.lineTo(x + w * (cabW / 2 - 0.07), y - w * 0.74);
    ctx.lineTo(x + w * (cabW / 2 + 0.01), y - w * 0.52);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(x - w * 0.5, y - w * 0.5, w, w * 0.04);
    top = 0.78;
    if (type === 'taxi') { ctx.fillStyle = '#fff6c0'; ctx.fillRect(x - w * 0.12, y - w * 0.86, w * 0.24, w * 0.08); top = 0.86; }
    if (type === 'police') {
      const on = Math.floor(t * 6) % 2 === 0;
      ctx.fillStyle = on ? '#ff2a3a' : '#3a0c10'; ctx.fillRect(x - w * 0.22, y - w * 0.84, w * 0.22, w * 0.07);
      ctx.fillStyle = on ? '#16213a' : '#3b8bff'; ctx.fillRect(x, y - w * 0.84, w * 0.22, w * 0.07);
      glowDisc(x + (on ? -w * 0.11 : w * 0.11), y - w * 0.8, w * 0.35, w * 0.12, on ? 'rgba(255,40,60,.22)' : 'rgba(60,140,255,.22)');
      top = 0.86;
    }
  }
  // tail lights and plate
  glowDisc(x, y - w * 0.3, w * 0.62, w * 0.16, 'rgba(255,30,40,.16)');
  ctx.fillStyle = '#ff2a36';
  ctx.fillRect(x - w * 0.46, y - w * 0.4, w * 0.16, w * 0.07);
  ctx.fillRect(x + w * 0.30, y - w * 0.4, w * 0.16, w * 0.07);
  ctx.fillStyle = '#e8ecf5'; ctx.fillRect(x - w * 0.1, y - w * 0.3, w * 0.2, w * 0.07);
  // road glow under the car
  glowDisc(x, y + w * 0.04, w * 0.5, w * 0.06, 'rgba(255,40,50,.22)');
  return top;
}


function rrect(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

function strobe(x, y, w, h, col, on, k) {
  if (on) {
    ctx.fillStyle = 'rgba(' + col + ',' + (0.22 * k) + ')'; ctx.beginPath(); ctx.ellipse(x, y, w * 1.9, h * 3.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(' + col + ',' + (0.4 * k) + ')'; ctx.beginPath(); ctx.ellipse(x, y, w * 1.1, h * 1.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgb(' + col + ')'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = '#fff'; ctx.fillRect(x - w * 0.3, y - h * 0.2, w * 0.6, h * 0.4);
  } else {
    ctx.fillStyle = 'rgba(' + col + ',0.22)'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
  }
}

function drawCrook(x, y, w, c) {
  if (w < 3) return;
  const pulse = 0.5 + 0.5 * Math.sin(tAnim * 8 + c.ph);
  // alarm aura and neon underglow
  glowDisc(x, y - w * 0.35, w * 1.0, w * 0.6, 'rgba(255,30,60,' + (0.10 + 0.10 * pulse) + ')');
  glowDisc(x, y + w * 0.02, w * 0.7, w * 0.11, 'rgba(255,40,210,' + (0.5 + 0.3 * pulse) + ')');
  glowDisc(x, y - w * 0.02, w * 0.56, w * 0.07, 'rgba(0,0,0,.6)');
  // tyres
  ctx.fillStyle = '#04050a';
  ctx.fillRect(x - w * 0.5, y - w * 0.26, w * 0.17, w * 0.26);
  ctx.fillRect(x + w * 0.33, y - w * 0.26, w * 0.17, w * 0.26);
  // body
  const g = ctx.createLinearGradient(0, y - w * 0.55, 0, y - w * 0.12);
  g.addColorStop(0, '#2a2a34'); g.addColorStop(1, '#050507');
  ctx.fillStyle = g; ctx.fillRect(x - w * 0.52, y - w * 0.52, w * 1.04, w * 0.4);
  // low roof
  ctx.fillStyle = '#0b0b10';
  ctx.beginPath(); ctx.moveTo(x - w * 0.36, y - w * 0.52); ctx.lineTo(x - w * 0.26, y - w * 0.72); ctx.lineTo(x + w * 0.26, y - w * 0.72); ctx.lineTo(x + w * 0.36, y - w * 0.52); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#3a0a14';
  ctx.beginPath(); ctx.moveTo(x - w * 0.31, y - w * 0.54); ctx.lineTo(x - w * 0.23, y - w * 0.69); ctx.lineTo(x + w * 0.23, y - w * 0.69); ctx.lineTo(x + w * 0.31, y - w * 0.54); ctx.closePath(); ctx.fill();
  // big spoiler
  ctx.fillStyle = '#050507'; ctx.fillRect(x - w * 0.56, y - w * 0.78, w * 1.12, w * 0.07);
  ctx.fillRect(x - w * 0.34, y - w * 0.72, w * 0.04, w * 0.12); ctx.fillRect(x + w * 0.3, y - w * 0.72, w * 0.04, w * 0.12);
  ctx.fillStyle = '#ff2fd0'; ctx.fillRect(x - w * 0.56, y - w * 0.78, w * 1.12, Math.max(1, w * 0.018));
  // neon trim and tail bar
  ctx.fillStyle = '#ff2fd0';
  ctx.fillRect(x - w * 0.52, y - w * 0.52, w * 1.04, Math.max(1, w * 0.02));
  ctx.fillRect(x - w * 0.52, y - w * 0.14, w * 1.04, Math.max(1, w * 0.02));
  ctx.fillStyle = '#ff2a2a'; ctx.fillRect(x - w * 0.46, y - w * 0.38, w * 0.92, w * 0.07);
  ctx.fillStyle = '#ffd0d0'; ctx.fillRect(x - w * 0.4, y - w * 0.365, w * 0.8, w * 0.02);
  ctx.fillStyle = '#e8ecf5'; ctx.fillRect(x - w * 0.1, y - w * 0.28, w * 0.2, w * 0.06);
  // marker
  const m = Math.max(w * 0.3, W * 0.014);
  const my = y - w * 0.95 - m * 0.9 + Math.sin(tAnim * 6 + c.ph) * m * 0.2;
  ctx.fillStyle = 'rgba(255,40,60,' + (0.25 + 0.2 * pulse) + ')';
  ctx.beginPath(); ctx.arc(x, my, m * 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ff2a3a';
  ctx.beginPath(); ctx.moveTo(x - m, my - m * 0.8); ctx.lineTo(x + m, my - m * 0.8); ctx.lineTo(x, my + m * 0.9); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, m * 0.14); ctx.stroke();
  if (m > 7) { ctx.fillStyle = '#fff'; ctx.font = '800 ' + Math.round(m * 1.0) + 'px ui-monospace,Menlo,monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', x, my - m * 0.15); }
}

function drawPlayer(cx, base, w, steerV, spin, bob, lift) {
  ctx.save();
  const pivotY = base - w * 0.4;
  ctx.translate(cx, pivotY - lift);
  ctx.rotate(spin + steerV * 0.07);
  ctx.translate(-cx, -pivotY);
  const y = base + bob;
  const st = Math.floor(tAnim * 14) % 8;
  const isR = st === 0 || st === 2, isB = st === 4 || st === 6;
  // headlight beam
  const bg = ctx.createRadialGradient(cx, y - w * 1.9, 0, cx, y - w * 1.9, w * 1.7);
  bg.addColorStop(0, 'rgba(150,200,255,.18)'); bg.addColorStop(1, 'rgba(150,200,255,0)');
  ctx.fillStyle = bg; ctx.fillRect(cx - w * 2, y - w * 3.8, w * 4, w * 3.8);
  // strobe wash on the road and around the car
  if (isR || isB) {
    const col = isR ? '255,40,60' : '70,140,255', sd = isR ? -1 : 1;
    glowDisc(cx + sd * w * 0.3, y + w * 0.05, w * 0.8, w * 0.12, 'rgba(' + col + ',0.34)');
    glowDisc(cx + sd * w * 0.25, y - w * 0.55, w * 0.7, w * 0.35, 'rgba(' + col + ',0.07)');
  }
  glowDisc(cx, y - w * 0.02, w * 0.6, w * 0.08, 'rgba(0,0,0,.7)');
  // tyres
  ctx.fillStyle = '#05070b';
  rrect(cx - w * 0.5, y - w * 0.34, w * 0.17, w * 0.34, w * 0.04); ctx.fill();
  rrect(cx + w * 0.33, y - w * 0.34, w * 0.17, w * 0.34, w * 0.04); ctx.fill();
  ctx.fillStyle = '#0b0e16'; ctx.fillRect(cx - w * 0.4, y - w * 0.16, w * 0.8, w * 0.14);
  // body
  const g = ctx.createLinearGradient(0, y - w * 0.6, 0, y - w * 0.12);
  g.addColorStop(0, '#8089a8'); g.addColorStop(0.35, '#4a536c'); g.addColorStop(1, '#1a1f2e');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.43, y - w * 0.12); ctx.lineTo(cx - w * 0.47, y - w * 0.42);
  ctx.quadraticCurveTo(cx - w * 0.46, y - w * 0.53, cx - w * 0.37, y - w * 0.545);
  ctx.lineTo(cx + w * 0.37, y - w * 0.545);
  ctx.quadraticCurveTo(cx + w * 0.46, y - w * 0.53, cx + w * 0.47, y - w * 0.42);
  ctx.lineTo(cx + w * 0.43, y - w * 0.12); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.13)'; ctx.fillRect(cx - w * 0.36, y - w * 0.535, w * 0.72, w * 0.022);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(cx - w * 0.44, y - w * 0.3, w * 0.88, w * 0.012);
  // cabin and mirrors
  ctx.fillStyle = '#323a50';
  ctx.beginPath(); ctx.moveTo(cx - w * 0.34, y - w * 0.54); ctx.lineTo(cx - w * 0.25, y - w * 0.79); ctx.lineTo(cx + w * 0.25, y - w * 0.79); ctx.lineTo(cx + w * 0.34, y - w * 0.54); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#10131b';
  ctx.fillRect(cx - w * 0.41, y - w * 0.66, w * 0.07, w * 0.05); ctx.fillRect(cx + w * 0.34, y - w * 0.66, w * 0.07, w * 0.05);
  // rear glass
  const gg = ctx.createLinearGradient(0, y - w * 0.76, 0, y - w * 0.56);
  gg.addColorStop(0, '#0b1020'); gg.addColorStop(1, '#03050a');
  ctx.fillStyle = gg;
  ctx.beginPath(); ctx.moveTo(cx - w * 0.3, y - w * 0.56); ctx.lineTo(cx - w * 0.22, y - w * 0.755); ctx.lineTo(cx + w * 0.22, y - w * 0.755); ctx.lineTo(cx + w * 0.3, y - w * 0.56); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(170,200,255,.10)';
  ctx.beginPath(); ctx.moveTo(cx - w * 0.22, y - w * 0.56); ctx.lineTo(cx - w * 0.14, y - w * 0.75); ctx.lineTo(cx - w * 0.06, y - w * 0.75); ctx.lineTo(cx - w * 0.14, y - w * 0.56); ctx.closePath(); ctx.fill();
  // hidden strobes: window shelf, trunk lip
  strobe(cx - w * 0.15, y - w * 0.625, w * 0.12, w * 0.035, '255,40,60', isR, 1);
  strobe(cx + w * 0.15, y - w * 0.625, w * 0.12, w * 0.035, '70,140,255', isB, 1);
  strobe(cx - w * 0.36, y - w * 0.5, w * 0.1, w * 0.03, '255,40,60', isR, 0.8);
  strobe(cx + w * 0.36, y - w * 0.5, w * 0.1, w * 0.03, '70,140,255', isB, 0.8);
  // tail lights
  glowDisc(cx, y - w * 0.36, w * 0.5, w * 0.07, 'rgba(255,40,50,.16)');
  ctx.fillStyle = '#d4182a';
  ctx.fillRect(cx - w * 0.43, y - w * 0.4, w * 0.2, w * 0.055); ctx.fillRect(cx + w * 0.23, y - w * 0.4, w * 0.2, w * 0.055);
  ctx.fillStyle = '#ff9aa2';
  ctx.fillRect(cx - w * 0.41, y - w * 0.39, w * 0.12, w * 0.015); ctx.fillRect(cx + w * 0.29, y - w * 0.39, w * 0.12, w * 0.015);
  // plate, exhausts, antenna
  ctx.fillStyle = '#f2f4fa'; ctx.fillRect(cx - w * 0.14, y - w * 0.325, w * 0.28, w * 0.085);
  ctx.fillStyle = '#1a2a6a'; ctx.fillRect(cx - w * 0.14, y - w * 0.325, w * 0.025, w * 0.085);
  if (w > 40) {
    ctx.fillStyle = '#10131c'; ctx.font = '800 ' + Math.round(w * 0.066) + 'px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('JUD3', cx + w * 0.012, y - w * 0.2825);
  }
  ctx.fillStyle = '#9aa3bd'; ctx.beginPath(); ctx.arc(cx - w * 0.25, y - w * 0.1, w * 0.05, 0, Math.PI * 2); ctx.arc(cx + w * 0.25, y - w * 0.1, w * 0.05, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#05060a'; ctx.beginPath(); ctx.arc(cx - w * 0.25, y - w * 0.1, w * 0.032, 0, Math.PI * 2); ctx.arc(cx + w * 0.25, y - w * 0.1, w * 0.032, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#0a0c12'; ctx.lineWidth = Math.max(1, w * 0.012);
  ctx.beginPath(); ctx.moveTo(cx - w * 0.28, y - w * 0.54); ctx.lineTo(cx - w * 0.2, y - w * 1.0); ctx.stroke();
  // turbo flames
  if (turboT > 0) {
    ctx.globalCompositeOperation = 'lighter';
    for (const sx of [-0.25, 0.25]) {
      const f = 0.8 + Math.random() * 0.5;
      const fg = ctx.createRadialGradient(cx + sx * w, y - w * 0.08, 0, cx + sx * w, y - w * 0.08, w * 0.2 * f);
      fg.addColorStop(0, 'rgba(255,240,180,.95)'); fg.addColorStop(0.35, 'rgba(255,140,40,.7)'); fg.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = fg; ctx.fillRect(cx + sx * w - w * 0.35, y - w * 0.4, w * 0.7, w * 0.5);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

function drawFx() {
  // speed lines while boosting
  if (turboT > 0) {
    ctx.strokeStyle = 'rgba(255,220,170,.28)'; ctx.lineWidth = Math.max(1.5, W * 0.003);
    ctx.beginPath();
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r0 = S * (0.55 + Math.random() * 0.4), r1 = r0 + S * (0.2 + Math.random() * 0.3);
      const ox = W / 2, oy = HORIZON + (H - HORIZON) * 0.35;
      ctx.moveTo(ox + Math.cos(a) * r0, oy + Math.sin(a) * r0 * 1.2);
      ctx.lineTo(ox + Math.cos(a) * r1, oy + Math.sin(a) * r1 * 1.2);
    }
    ctx.stroke();
  }
  // explosions
  for (const q of rings) {
    const t = q.life / q.max;
    const rg = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.sz * (0.3 + 1.5 * t));
    rg.addColorStop(0, 'rgba(255,240,200,' + 0.7 * (1 - t) + ')'); rg.addColorStop(0.5, 'rgba(255,150,40,' + 0.45 * (1 - t) + ')'); rg.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(q.x, q.y, q.sz * (0.3 + 1.5 * t), 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255,220,160,' + 0.3 * (1 - t) + ')'; ctx.lineWidth = Math.max(2, q.sz * 0.025);
    ctx.beginPath(); ctx.arc(q.x, q.y, q.sz * (0.2 + 1.9 * t), 0, Math.PI * 2); ctx.stroke();
  }
  for (const q of parts) {
    const t = q.life / q.max;
    if (q.k === 'smoke') {
      ctx.fillStyle = 'rgba(78,66,66,' + 0.28 * (1 - t) + ')';
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (1 + t * 1.5), 0, Math.PI * 2); ctx.fill();
    } else if (q.k === 'fire') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,' + Math.round(235 - 150 * t) + ',' + Math.round(120 - 100 * t) + ',' + Math.min(1, 1.6 * (1 - t)) + ')';
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (1 - t * 0.5), 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
      ctx.fillStyle = t < 0.5 ? '#ffb347' : '#15151c';
      ctx.fillRect(-q.size, -q.size * 0.5, q.size * 2, q.size);
      ctx.restore();
    }
  }
}

function render() {
  const baseSeg = findSegment(position);
  const basePct = pctRemaining(position, SEG_LEN);
  const playerSeg = findSegment(position + PLAYER_Z);
  const playerPct = pctRemaining(position + PLAYER_Z, SEG_LEN);
  const playerY = lerp(playerSeg.p1.world.y, playerSeg.p2.world.y, playerPct);
  const camY = playerY + CAM_H;

  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 14, (Math.random() - 0.5) * shake * 14);
  drawSky();

  let maxy = H;
  let x = 0, dx = -(baseSeg.curve * basePct);
  for (let n = 0; n < DRAW; n++) {
    const seg = segments[(baseSeg.index + n) % segments.length];
    seg.looped = seg.index < baseSeg.index;
    const f = n / DRAW;
    seg.fog = 1 - 1 / Math.exp(f * f * FOG_DENS);
    seg.clip = maxy;
    const camZ = position - (seg.looped ? trackLength : 0);
    const camX = playerX * ROAD_W * CAM_FOLLOW;
    project(seg.p1, camX - x, camY, camZ);
    project(seg.p2, camX - x - dx, camY, camZ);
    x += dx; dx += seg.curve;
    seg.vis = seg.p1.camera.z > CAM_DEPTH && seg.p2.screen.y < seg.p1.screen.y && seg.p2.screen.y < maxy;
    if (!seg.vis) { if (seg.p1.camera.z <= CAM_DEPTH) seg.vis = false; continue; }
    drawRoadSegment(seg);
    maxy = seg.p1.screen.y;
  }

  // sprites, back to front
  for (let n = DRAW - 1; n > 0; n--) {
    const seg = segments[(baseSeg.index + n) % segments.length];
    if (seg.p1.camera.z <= CAM_DEPTH) continue;
    const s1 = seg.p1.screen;
    const hidden = seg.p1.screen.y < 0 && seg.p2.screen.y < 0;
    if (hidden) continue;
    ctx.globalAlpha = 1 - seg.fog;
    for (const d of seg.decor) {
      const sx = s1.x + s1.scale * d.off * ROAD_W * Kx;
      if (sx < -W * 0.5 || sx > W * 1.5) continue;
      withClip(s1.y, seg.clip, () => {
        if (d.t === 'lamp') drawLamp(sx, s1.y, s1.scale, d.side);
        else drawBuilding(sx, s1.y, s1.scale, d);
      });
    }
    for (const cr of seg.crooks) {
      if (cr.dead) continue;
      const sc = lerp(seg.p1.screen.scale, seg.p2.screen.scale, cr.percent);
      const sx = lerp(seg.p1.screen.x, seg.p2.screen.x, cr.percent) + sc * cr.offset * ROAD_W * Kx;
      const sy = lerp(seg.p1.screen.y, seg.p2.screen.y, cr.percent);
      const w = sc * CAR_W * ROAD_W * Kx;
      withClip(sy - w * 2, seg.clip, () => drawCrook(sx, sy, w, cr));
    }
    for (const pk of seg.pickups) {
      if (pk.taken) continue;
      const sc = lerp(seg.p1.screen.scale, seg.p2.screen.scale, pk.percent);
      const sx = lerp(seg.p1.screen.x, seg.p2.screen.x, pk.percent) + sc * pk.offset * ROAD_W * Kx;
      const sy = lerp(seg.p1.screen.y, seg.p2.screen.y, pk.percent);
      const w = sc * CAR_W * ROAD_W * Kx;
      withClip(sy, seg.clip, () => drawPickup(sx, sy, w, pk));
    }
    for (const car of seg.cars) {
      const sc = lerp(seg.p1.screen.scale, seg.p2.screen.scale, car.percent);
      const sx = lerp(seg.p1.screen.x, seg.p2.screen.x, car.percent) + sc * car.offset * ROAD_W * Kx;
      const sy = lerp(seg.p1.screen.y, seg.p2.screen.y, car.percent);
      const w = sc * CAR_W * ROAD_W * Kx;
      withClip(sy, seg.clip, () => drawTraffic(sx, sy, w, car.type, car.color, tAnim));
    }
    ctx.globalAlpha = 1;
  }

  // player
  if (state !== 'over') {
    const pScale = 1 / CAM_H;
    const { pw, px } = playerGeom();
    const pct = speed / MAX_SPEED;
    const bob = Math.sin(tAnim * 28) * pct * 1.6;
    const crashing = state === 'crashing';
    const spin = crashing ? crashDir * Math.min(crashT, 0.9) * 7 : 0;
    const lift = crashing ? Math.sin(Math.min(crashT / 0.9, 1) * Math.PI) * pw * 0.35 : 0;
    drawPlayer(px, PLAYER_BASE, pw, steer, spin, bob, lift);
    if (shield && state !== 'crashing') {
      const by = PLAYER_BASE - pw * 0.4 + bob;
      const pulse = 0.5 + 0.5 * Math.sin(tAnim * 6);
      ctx.fillStyle = 'rgba(74,168,255,' + (0.10 + 0.05 * pulse) + ')';
      ctx.beginPath(); ctx.ellipse(px, by, pw * 0.78, pw * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(140,210,255,' + (0.55 + 0.25 * pulse) + ')'; ctx.lineWidth = Math.max(2, pw * 0.02);
      ctx.beginPath(); ctx.ellipse(px, by, pw * 0.78, pw * 0.7, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  drawFx();
  ctx.restore();

  if (flash > 0) {
    ctx.fillStyle = 'rgba(' + flashCol + ',' + (flash * 0.55) + ')';
    ctx.fillRect(0, 0, W, H);
  }
}

/* ---------- hud ---------- */
let lastScore = -1, lastTime = '', lastMph = -1, lastPower = '';
function updateHud() {
  if (state === 'menu' || state === 'over') return;
  const sc = currentScore();
  if (sc !== lastScore) { lastScore = sc; el.score.textContent = sc; }
  const t = fmtTime(elapsed);
  if (t !== lastTime) { lastTime = t; el.time.textContent = t; }
  const pw = [];
  if (shield) pw.push('<span style="color:#4aa8ff">SHIELD</span>');
  if (x2T > 0) pw.push('<span style="color:#ffd24a">2X ' + Math.ceil(x2T) + '</span>');
  const pwHtml = pw.join('');
  const showT = state === 'playing' && (turboCharges > 0 || turboT > 0);
  el.turbo.hidden = !showT;
  if (showT) {
    const tt = turboT > 0 ? turboT.toFixed(1) : 'x' + turboCharges;
    if (el.turbo.dataset.t !== tt) { el.turbo.dataset.t = tt; el.turbo.innerHTML = '<small>TURBO</small><b>' + tt + '</b>'; }
    el.turbo.classList.toggle('active', turboT > 0);
  }
  if (pwHtml !== lastPower) { lastPower = pwHtml; el.power.innerHTML = pwHtml; el.power.hidden = !pwHtml; }
  const mph = Math.round((speed / MAX_SPEED) * 140);
  if (mph !== lastMph) { lastMph = mph; el.mph.textContent = mph; }
}

/* ---------- loop ---------- */
let dtAvg = 1 / 60, lastScale = 0;
function frame(now) {
  if (!last) last = now;
  let dt = (now - last) / 1000;
  last = now;
  if (dt < 0.2) {
    dtAvg = dtAvg * 0.95 + dt * 0.05;
    if (dtAvg > 0.025 && resScale > 0.45 && now - lastScale > 1500) { resScale *= 0.85; lastScale = now; dtAvg = 1 / 60; resize(); }
  }
  if (dt > 0.1) dt = 0.1;
  acc += dt;
  while (acc >= STEP) { update(STEP); acc -= STEP; }
  render();
  updateHud();
  requestAnimationFrame(frame);
}

setMode(controlMode);
showMenu();
requestAnimationFrame(frame);

// small hook for tests
window.__devilrun = {
  nearestCrook() { let b = null; for (const c of crooks) { if (c.dead) continue; const r = rel(c.z); if (r > 0 && (!b || r < b.r)) b = { r, off: c.offset }; } return b ? { r: b.r, off: b.off, px: playerX } : null; },
  get busts() { return busts; }, get turbo() { return turboCharges; }, activateTurbo, startGame, get state() { return state; }, get score() { return currentScore(); }, setSteer(v) { keyDir = v; } };
})();

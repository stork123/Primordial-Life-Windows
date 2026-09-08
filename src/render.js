// Canvas2D renderer + main loop for Primordial Life
'use strict';
const { Environment } = require('./sim.js');
const G = require('./genotype.js');
const Sounds = require('./sounds.js');

const { PEN_COLORS } = require('./ui-colors.js');
const { BiotEditor } = require('./editor.js');
const { Guide } = require('./guide.js');

const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const inspector = document.getElementById('inspector');

let env = null;
let paused = false;
let stepsPerFrame = 1;
let selected = null;

function newWorld() {
  try {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    env = new Environment(canvas.width, canvas.height, (Date.now() & 0x7fffffff), { initialPopulation: 20 });
    env.on('birth', () => Sounds.birth());
    env.on('mate', () => Sounds.mate());
    env.on('eaten', () => Sounds.eaten());
    env.on('noEnergy', () => Sounds.noEnergy());
    env.on('tooOld', () => Sounds.tooOld());
    env.on('extinction', () => Sounds.extinction());
    Sounds.start();
    selected = null;
    inspector.style.display = 'none';
    if (editor) editor.hide();
    if (pendingRelease) pendingRelease = null;
  } catch (e) {
    console.error('newWorld() failed:', e && e.stack || e);
  }
}

let editor = null;
let pendingRelease = null;
let guide;
try { guide = new Guide(); }
catch (e) { console.error('Guide failed to initialize:', e); guide = { visible: false, toggle() {}, hide() {} }; }

window.addEventListener('error', (e) => {
  console.error('window error:', e.error && e.error.stack || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('unhandled rejection:', e.reason && e.reason.stack || e.reason);
});

function placePendingRelease(cx, cy) {
  if (!pendingRelease) return false;
  pendingRelease.origin.x = cx; pendingRelease.origin.y = cy;
  pendingRelease.vector.setX(cx); pendingRelease.vector.setY(cy);
  pendingRelease.setScreenRect();
  env.biots.push(pendingRelease);
  pendingRelease = null;
  Sounds.birth();
  return true;
}

// instantiate editor (needs env, set up after newWorld runs)
newWorld();
try {
  editor = new BiotEditor(env, (biot) => {
    pendingRelease = biot;
    editor.hide();
    hud.textContent += '  [click to release]';
  });
} catch (e) {
  console.error('BiotEditor failed to initialize:', e);
  editor = { visible: false, toggle() {}, hide() {}, show() {} };
}

window.addEventListener('resize', () => {
  // preserve population, resize world
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (env) { env.width = canvas.width; env.height = canvas.height; }
});

window.addEventListener('keydown', (e) => {
  // Don't let hotkeys fire when typing into inputs / selects / textareas
  const tag = (e.target.tagName || '').toUpperCase();
  if (['INPUT','SELECT','TEXTAREA'].includes(tag) || e.target.isContentEditable) return;
  if (e.code === 'Space') { paused = !paused; e.preventDefault(); }
  else if (e.key === 'r' || e.key === 'R') newWorld();
  else if (e.key === 's' || e.key === 'S') Sounds.toggle();
  else if (e.key === 'e' || e.key === 'E') editor.toggle();
  else if (e.key === 'g' || e.key === 'G') guide.toggle();
  else if (e.key === 'Escape') { if (guide.visible) guide.hide(); else if (editor && editor.visible) editor.hide(); }
  else if (e.key === '+' || e.key === '=') stepsPerFrame = Math.min(16, stepsPerFrame + 1);
  else if (e.key === '-') stepsPerFrame = Math.max(1, stepsPerFrame - 1);
});

canvas.addEventListener('mousedown', (e) => {
  const x = e.clientX, y = e.clientY;
  if (editor && editor.visible) return; // ignore clicks on world while editor open
  if (pendingRelease && placePendingRelease(x, y)) return;
  selected = null;
  for (const b of env.biots) {
    if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) { selected = b; break; }
  }
  if (!selected) inspector.style.display = 'none';
});

function drawAllBiots() {
  const byColor = new Map();
  for (const b of env.biots) {
    const sick = b.nSick > 0;
    for (let i = 0; i < b.genes; i++) {
      if (b.state[i] <= 0) continue;
      let pen = sick ? G.PURPLE_LEAF : b.nType[i];
      if (!sick && b.state[i] !== b.distance[i]) pen += G.DIM_COLOR;
      if (pen >= PEN_COLORS.length) pen = G.GREY_LEAF;
      if (!byColor.has(pen)) byColor.set(pen, []);
      byColor.get(pen).push(b.x1(i), b.y1(i), b.x2(i), b.y2(i));
    }
  }
  for (const [pen, segments] of byColor) {
    ctx.strokeStyle = PEN_COLORS[pen];
    ctx.beginPath();
    for (let i = 0; i < segments.length; i += 4) {
      ctx.moveTo(segments[i], segments[i + 1]);
      ctx.lineTo(segments[i + 2], segments[i + 3]);
    }
    ctx.stroke();
  }
  if (selected) {
    ctx.strokeStyle = '#808080';
    ctx.strokeRect(selected.left - 2, selected.top - 2, selected.width() + 4, selected.height() + 4);
  }
}

function updateInspector() {
  if (!selected) return;
  if (!env.biots.includes(selected)) { selected = null; inspector.style.display = 'none'; return; }
  const b = selected;
  inspector.style.display = 'block';
  inspector.textContent =
    `Biot: ${b.name}:${b.generation}\n` +
    `sex: ${b.trait.isMale() ? 'male' : 'female'}${b.trait.isAsexual() ? ' (asexual)' : ''}\n` +
    `species: ${b.trait.getSpecies()}  limbs: ${b.trait.getLines()}${b.trait.isMirrored() ? ' mirrored' : ''}\n` +
    `age: ${b.age} / ${b.maxAge}\n` +
    `energy: ${Math.round(b.percentEnergy())}%  ratio: ${b.ratio}\n` +
    `children: ${b.trait.getNumberOfChildren()}  fertilized: ${b.genes2 ? 'yes' : 'no'}\n` +
    `green: ${b.colorDistance[0]}  red: ${b.colorDistance[2]}\n` +
    `blue: ${b.colorDistance[1]}  white: ${b.colorDistance[4]}  lblue: ${b.colorDistance[3]}` +
    (b.nSick ? '\n** SICK **' : '');
}

function frame() {
  try {
    if (!paused) for (let s = 0; s < stepsPerFrame; s++) env.step();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 1;
    drawAllBiots();
    hud.textContent =
      `Primordial Life  |  pop ${env.biots.length}  gen ${env.stats.generation}` +
      `  births ${env.stats.births}  deaths ${env.stats.deaths}` +
      `  extinctions ${env.stats.extinctions}` +
      (Sounds.isEnabled() ? '' : '  [MUTED]') +
      (paused ? '  [PAUSED]' : (stepsPerFrame > 1 ? `  x${stepsPerFrame}` : ''));
    updateInspector();
  } catch (e) {
    console.error('frame() error (sim/render continues):', e && e.stack || e);
    hud.textContent = `Primordial Life  |  ERROR — check log, press R to restart: ${e && e.message}`;
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

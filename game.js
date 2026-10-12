import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { COLORS, PATTERNS, HATS, FACES, OUTFITS, ATTACKS, buildModel, animate, weaponMesh, setWeapon, toon, eggRadius, composeShell, disposeModel } from './models.js';
import { createSetPieces } from './setpieces.js';
import { loadModels, model } from './assets.js';
import { createMusic } from './music.js';
import qrcode from 'three/addons/qrcode.mjs';
import { ic, icText } from './lib/icons.mjs';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The always-latest online copy of the game (GitHub Pages). On the web it's wherever this page lives;
// the PC app passes it in (?site=) when it falls back to its built-in copy.
const qs = new URLSearchParams(location.search);
const SITE_URL = /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname) ? location.href.split(/[?#]/)[0].replace(/[^/]*$/, '') : qs.get('site') || '';
const qrImg = text => { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createDataURL(6, 2); };

// ---------- engine ----------
// phones/tablets get touch controls and a lighter renderer (?touch forces it for testing)
const IS_TOUCH = (matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0) || location.search.includes('touch');
const IS_APP = navigator.userAgent.includes('Electron');
let mode = 'battle';   // lobby choice: 'battle' (last egg standing) or 'endless' (team vs. waves)
const endless = { wave: 0, left: 0, toSpawn: 0, boss: false, spawnT: 0 };
const renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH });
// Low-poly look (Settings toggle): round shapes get far fewer facets and flat shading, PS2-style
let lowPoly = false; try { lowPoly = localStorage.getItem('egg-lowpoly') === '1'; } catch {}
const pixelRatio = () => Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2);
renderer.setPixelRatio(pixelRatio());
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 14, 18);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
// Each round geometry is swapped for a coarse copy (cached per original, so shared shapes stay shared); toggling back restores it.
const LOW = {
  SphereGeometry: p => new THREE.SphereGeometry(p.radius, Math.max(5, Math.round(p.widthSegments * 0.22)), Math.max(3, Math.round(p.heightSegments * 0.28)), p.phiStart, p.phiLength, p.thetaStart, p.thetaLength),
  CapsuleGeometry: p => new THREE.CapsuleGeometry(p.radius, p.height ?? p.length, 1, Math.max(4, Math.round(p.radialSegments * 0.4))),
  CylinderGeometry: p => new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, Math.max(5, Math.round(p.radialSegments * 0.25)), 1, p.openEnded, p.thetaStart, p.thetaLength),
  ConeGeometry: p => new THREE.ConeGeometry(p.radius, p.height, Math.max(4, Math.round(p.radialSegments * 0.3)), 1, p.openEnded),
  TorusGeometry: p => new THREE.TorusGeometry(p.radius, p.tube, 3, Math.max(5, Math.round(p.tubularSegments * 0.25)), p.arc),
  // the egg shell keeps ~9 sides: any fewer and the face parts (placed on the true curve) float off the flat facets
  LatheGeometry: p => new THREE.LatheGeometry(p.points.length > 12 ? p.points.filter((_, i, a) => i % 6 === 0 || i === a.length - 1) : p.points, Math.max(6, Math.round(p.segments * 0.25))),
  CircleGeometry: p => new THREE.CircleGeometry(p.radius, Math.max(5, Math.round(p.segments * 0.35))),
  IcosahedronGeometry: p => new THREE.IcosahedronGeometry(p.radius, 0),
  TubeGeometry: p => new THREE.TubeGeometry(p.path, Math.max(4, Math.round(p.tubularSegments * 0.3)), p.radius, 3, p.closed),
};
const lowCache = new WeakMap();
function lowify(root) {   // apply (or undo) the current look on everything under root
  root.traverse(o => {
    if (!o.isMesh) return;
    const u = o.userData;
    if (lowPoly && !u.low) {
      u.low = true;
      const geo = o.geometry, f = LOW[geo.type];
      if (f && geo.parameters) { let lg = lowCache.get(geo); if (!lg) lowCache.set(geo, lg = f(geo.parameters)); u.hiGeo = geo; o.geometry = lg; }
      for (const m of [].concat(o.material)) if ('flatShading' in m && !m.flatShading) { m.flatShading = true; m.needsUpdate = true; }
    } else if (!lowPoly && u.low) {
      u.low = false;
      if (u.hiGeo) { o.geometry = u.hiGeo; u.hiGeo = null; }
      for (const m of [].concat(o.material)) if (m.flatShading) { m.flatShading = false; m.needsUpdate = true; }
    }
  });
}
let lowT = 0;
function setLowPoly(on) {
  lowPoly = on; try { localStorage.setItem('egg-lowpoly', on ? '1' : '0'); } catch {}
  lowify(scene); for (const p of players) lowify(p.model.group);   // also eggs that are off the field right now
  $('lowBtn').innerHTML = `${ic('cube')} Low-poly look: <b>${on ? 'ON' : 'OFF'}</b>`;
}
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(10, 25, 12); sun.castShadow = true;
sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 3072, IS_TOUCH ? 1024 : 3072);
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, far: 100 });
sun.position.set(14, 32, 16);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.3), sun);

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -25, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.defaultContactMaterial.friction = 0.3;
world.defaultContactMaterial.restitution = 0.05;
// players are frictionless: their movement code does all the accelerating/stopping (friction was eating ~90% of run speed)
const playerMat = new CANNON.Material('player');
world.addContactMaterial(new CANNON.ContactMaterial(playerMat, world.defaultMaterial, { friction: 0, restitution: 0 }));
world.addContactMaterial(new CANNON.ContactMaterial(playerMat, playerMat, { friction: 0, restitution: 0.1 }));
const G_MAP = 1, G_PLAYER = 2, G_CRATE = 4, G_PROJ = 8;   // collision groups (rays only look at the map)
const { KINEMATIC, STATIC, DYNAMIC } = CANNON.Body;

// Map generation uses a seeded RNG so every online player builds the identical map from one number.
let rand = Math.random;
const seeded = s => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const withSeed = (seed, fn) => { rand = seeded(Math.imul(seed, 2654435761)); try { return fn(); } finally { rand = Math.random; } };
const R = (a, b) => a + rand() * (b - a);
const pick = a => a[Math.floor(rand() * a.length)];
const lerpAngle = (a, b, t) => a + ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * t;
const mat = (color, extra) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
const ray = new CANNON.RaycastResult();
function castDown(x, yFrom, z, yTo) {
  ray.reset();
  world.raycastClosest(new CANNON.Vec3(x, yFrom, z), new CANNON.Vec3(x, yTo, z), { collisionFilterMask: G_MAP, skipBackfaces: true }, ray);
  return ray.hasHit && ray.hitNormalWorld.y > 0.7 ? ray : null;
}

// ---------- sound: recorded Kenney samples (assets/sfx) + a few synth effects, panned/attenuated from the camera ----------
const ac = new AudioContext(), master = ac.createGain(), sfxBus = ac.createGain(), musicBus = ac.createGain();
master.connect(ac.destination); sfxBus.connect(master); musicBus.connect(master);
const music = createMusic(ac, musicBus);
const VARIANTS = ['punch', 'punchHeavy', 'wood', 'bell', 'metal', 'glass', 'glassLight', 'soft', 'softMed', 'plank', 'step_concrete', 'step_grass', 'step_snow', 'step_wood', 'step_carpet'];
const SINGLES = ['ui_click', 'ui_select', 'ui_confirmation', 'ui_open', 'ui_close', 'ui_back', 'ui_tick', 'ui_pluck', 'ui_drop', 'ui_switch',
  'voice_1', 'voice_2', 'voice_3', 'voice_fight', 'voice_ready', 'voice_prepare_yourself', 'voice_winner', 'voice_its_a_tie', 'voice_sudden_death', 'voice_final_round', 'jingle_win', 'jingle_nes'];
const buffers = {};
async function loadSounds() {
  const files = [...VARIANTS.flatMap(v => [0, 1, 2, 3, 4].map(i => [v, v + i])), ...SINGLES.map(s => [s, s])];
  await Promise.all(files.map(async ([group, file]) => {
    try { const data = await (await fetch(`assets/sfx/${file}.ogg`)).arrayBuffer(); (buffers[group] ??= []).push(await ac.decodeAudioData(data)); }
    catch { /* missing sound = silent, the synth fallback still plays */ }
  }));
}
// event name -> [sample group, volume, synth layer]
const SOUNDS = {
  hit: ['punch', 0.9], glove: ['punchHeavy', 1, 'boing'], bat: ['wood', 1, 'boing'], hammer: ['metal', 0.9, 'boing'], eggHit: ['soft', 1, 'boing'], pan: ['metal', 0.4, 'clang'],
  bonk: ['metal', 0.9], crate: ['plank', 0.7], shield: ['bell', 0.55], spawnmark: [null, 0, 'warn'], bombmark: [null, 0, 'whistle'],
  boom: ['punchHeavy', 0.7, 'boom'], fire: ['ui_confirmation', 0.6, 'sizzle'], crack: ['glass', 1, 'crack'], splat: ['soft', 1, 'splat'], grab: ['softMed', 0.45], climb: ['ui_pluck', 0.6],
  pickup: ['ui_confirmation', 0.6], join: ['ui_confirmation', 0.7], land: ['softMed', 0.25],
  jingle: ['jingle_win', 0.8], punch: [null, 0, 'punch'],
  heavy: ['punchHeavy', 1, 'thud'], drop: ['ui_drop', 0.6], block: ['wood', 0.7], guardbreak: ['glass', 0.9, 'crack'],
};
const SYNTH = {
  punch: [260, 90, 0.08, 'triangle', 0.08], jump: [300, 600, 0.12, 'sine', 0.1], swing: [500, 150, 0.12, 'sawtooth', 0.08], shoot: [700, 200, 0.12, 'square', 0.12],
  fall: [700, 90, 0.9, 'sine', 0.15], win: [400, 1200, 0.7, 'triangle', 0.1], go: [880, 880, 0.35, 'square', 0.08], horn: [196, 185, 1.4, 'sawtooth', 0.15],
  windup: [160, 320, 0.16, 'sine', 0.06], warn: [220, 880, 0.55, 'square', 0.045], whistle: [1500, 500, 0.9, 'sine', 0.05], windupBig: [120, 260, 0.28, 'sine', 0.08], charge: [180, 760, 0.9, 'sawtooth', 0.035], thud: [140, 50, 0.22, 'sine', 0.2], pop: [420, 900, 0.12, 'square', 0.12], slip: [1200, 180, 0.35, 'sine', 0.14],
};
const NOISE = { boom: [1.2, 'lowpass', 260, 1.1], crack: [6, 'highpass', 1500, 0.35], splat: [2, 'lowpass', 500, 0.4], sizzle: [1, 'highpass', 3500, 0.12] };
// made on the fly: a cartoon spring "boing" (pitch wobble) and a frying-pan "BONNG" (ringing, slightly detuned partials)
const SPECIAL = {
  boing(dst) {
    const t = ac.currentTime, k = 0.9 + Math.random() * 0.25, o = ac.createOscillator(), lfo = ac.createOscillator(), depth = ac.createGain(), env = ac.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(110 * k, t); o.frequency.exponentialRampToValueAtTime(330 * k, t + 0.05); o.frequency.exponentialRampToValueAtTime(235 * k, t + 0.6);
    lfo.frequency.setValueAtTime(27, t); lfo.frequency.linearRampToValueAtTime(11, t + 0.6);
    depth.gain.setValueAtTime(75 * k, t); depth.gain.exponentialRampToValueAtTime(4, t + 0.6);
    env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(0.3, t + 0.012); env.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    lfo.connect(depth).connect(o.frequency); o.connect(env).connect(dst);
    o.start(t); lfo.start(t); o.stop(t + 0.62); lfo.stop(t + 0.62);
  },
  clang(dst) {
    const t = ac.currentTime, k = 0.94 + Math.random() * 0.12;
    for (const [f, a, d] of [[392, 0.5, 1.2], [395.5, 0.32, 1.1], [1046, 0.28, 0.75], [1734, 0.2, 0.5], [2593, 0.12, 0.33], [3671, 0.07, 0.2]]) {
      const o = ac.createOscillator(), env = ac.createGain();
      o.frequency.value = f * k; env.gain.setValueAtTime(a * 0.55, t); env.gain.exponentialRampToValueAtTime(0.0005, t + d);
      o.connect(env).connect(dst); o.start(t); o.stop(t + d);
    }
  },
};
const sv = new THREE.Vector3();
function out(gain, pan) {
  const g = ac.createGain(), p = ac.createStereoPanner();
  g.gain.value = gain; p.pan.value = pan; g.connect(p).connect(sfxBus); return g;
}
function playSfx(name, pos) {
  if (ac.state === 'suspended') ac.resume();
  let gain = 1, pan = 0;
  if (pos) {   // quieter far from the action, panned by screen position
    sv.set(pos.x, pos.y, pos.z);
    gain = THREE.MathUtils.clamp(1.25 - sv.distanceTo(camTarget) / 45, 0.25, 1);
    sv.project(camera); pan = THREE.MathUtils.clamp(sv.x * 0.6, -0.8, 0.8);
  }
  let [group, vol = 1, synth] = SOUNDS[name] || [null, 0, name];
  if (name === 'step') { group = 'step_' + (map.theme.step || 'concrete'); vol = 0.3; }
  if (name.startsWith('v_')) { group = 'voice_' + name.slice(2); vol = 0.8; }
  if (name.startsWith('ui_')) { group = name; vol = 0.6; }
  const list = buffers[group];
  if (list) {
    const s = ac.createBufferSource(); s.buffer = list[Math.floor(Math.random() * list.length)];
    if (!/^(voice|ui|jingle)/.test(group)) s.playbackRate.value = 0.9 + Math.random() * 0.2;
    s.connect(out(vol * gain, pan)); s.start();
  }
  if (SPECIAL[synth]) SPECIAL[synth](out(gain, pan));
  else if (NOISE[synth]) {
    const [decay, type, freq, v] = NOISE[synth], len = ac.sampleRate * 0.3, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    const s = ac.createBufferSource(), f = ac.createBiquadFilter();
    s.buffer = buf; f.type = type; f.frequency.value = freq; s.connect(f).connect(out(v * gain, pan)); s.start();
  } else if (SYNTH[synth]) {
    const [f0, f1, dur, type, v] = SYNTH[synth], t = ac.currentTime, o = ac.createOscillator(), env = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env.gain.setValueAtTime(v, t); env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(env).connect(out(gain, pan)); o.start(t); o.stop(t + dur);
  }
}

// ---------- particles ----------
const parts = [], partMats = {};
const shardGeo = new THREE.TetrahedronGeometry(0.1), dropGeo = new THREE.SphereGeometry(0.08, 6, 4);
function burst(x, y, z, color, n, geo, speed) {
  const m0 = partMats[color] ??= toon(color);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, m0);
    m.position.set(x, y, z);
    m.userData = { v: new THREE.Vector3((Math.random() - 0.5) * speed, 2 + Math.random() * speed * 0.8, (Math.random() - 0.5) * speed), life: 0.6 + Math.random() * 0.6 };
    scene.add(m); parts.push(m);
  }
}
function updateParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const m = parts[i], u = m.userData;
    u.life -= dt; u.v.y -= 20 * dt;
    m.position.addScaledVector(u.v, dt); m.rotation.x += dt * 9; m.rotation.z += dt * 7;
    m.scale.setScalar(Math.min(1, u.life * 3));
    if (u.life <= 0) { scene.remove(m); parts.splice(i, 1); }
  }
}
// soft puffs: dust, smoke and steam that grow, drift and fade (no gravity)
const puffGeo = new THREE.IcosahedronGeometry(0.5, 1), puffs = [], puffMats = [];
function puff(x, y, z, color, size = 0.5, life = 0.8, v = [0, 1, 0], opacity = 0.5) {
  if (puffs.length > 250) return;
  const pm = puffMats.pop() || new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false }); pm.color.set(color); pm.opacity = opacity;
  const m = new THREE.Mesh(puffGeo, pm);
  m.position.set(x, y, z); m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
  m.userData = { v: new THREE.Vector3(...v), age: 0, life, size, opacity };
  scene.add(m); puffs.push(m);
}
function updatePuffs(dt) {
  for (let i = puffs.length - 1; i >= 0; i--) {
    const m = puffs[i], u = m.userData, k = (u.age += dt) / u.life;
    if (k >= 1) { scene.remove(m); puffMats.push(m.material); puffs.splice(i, 1); continue; }
    m.position.addScaledVector(u.v, dt); u.v.multiplyScalar(1 - Math.min(1, dt * 1.2));
    m.scale.setScalar(u.size * (0.5 + k)); m.material.opacity = u.opacity * (1 - k);
  }
}
const DUST = { snow: '#ffffff', grass: '#cdbf95', wood: '#c9a27a', carpet: '#d8c8c8' };
const dust = (p, n, spread, size) => {
  const q = p.body.position, c = DUST[map.theme.step] || '#d2ccc2';
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.28; puff(q.x + Math.sin(a) * 0.3, q.y - 0.8, q.z + Math.cos(a) * 0.3, c, size, 0.5, [Math.sin(a) * spread, 0.6, Math.cos(a) * spread], 0.45); }
};

// Map life: Kenney scenery recognised by model name sways, flutters or smokes, and point lights flicker like flames
const SWAY = /tree|pine|palm|flowers|grass|plant/, FLAG = /flag/, SMOKE = /chimney|locomotive/;
function addAmbient() {
  const sway = [], flags = [], smokers = [], lights = [];
  map.group.traverse(o => {
    if (o.isPointLight) lights.push([o, o.intensity, Math.random() * 10]);
    const k = o.userData.key; if (!k) return;
    if (SWAY.test(k)) sway.push([o, o.rotation.x, o.rotation.z, Math.random() * 6]);
    else if (FLAG.test(k)) flags.push([o, o.rotation.y, Math.random() * 6]);
    if (SMOKE.test(k)) { const s = o.userData.size; smokers.push([o, new THREE.Vector3(0, s.y * 0.97, /locomotive/.test(k) ? s.z * 0.3 : 0), s.x * 0.25]); }   // Kenney locomotives face +z, chimney near the front
  });
  let smokeT = 0;
  const w = new THREE.Vector3();
  map.visuals.push((h, t, dt) => {
    for (const [o, x, z, ph] of sway) { o.rotation.x = x + Math.sin(t * 1.3 + ph) * 0.025; o.rotation.z = z + Math.sin(t * 1.7 + ph * 1.3) * 0.03; }
    for (const [o, y, ph] of flags) o.rotation.y = y + Math.sin(t * 4 + ph) * 0.12;
    for (const [l, base, ph] of lights) l.intensity = base * (0.85 + 0.15 * Math.sin(t * 13 + ph) * Math.sin(t * 7.3 + ph * 2));
    if ((smokeT -= dt) > 0) return;
    smokeT = 0.16;
    const [dx, dy, dz] = map.smokeDrift || [0.5, 1.8, 0];
    for (const [o, top, size] of smokers) {
      o.updateWorldMatrix(true, false); w.copy(top); o.localToWorld(w);
      puff(w.x, w.y, w.z, '#e8e8e8', Math.max(0.5, size), 2.2, [dx + (Math.random() - 0.5) * 0.6, dy, dz + (Math.random() - 0.5) * 0.6], 0.45);
    }
  });
}

// impact feel: a starburst flash, camera shake and a short hit-freeze, scaled by how hard the hit was (1 light .. 3 charged)
let freezeT = 0, shake = 0;
const flashTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.translate(64, 64); g.fillStyle = '#fff'; g.beginPath();
  for (let i = 0; i < 18; i++) { const a = i * Math.PI / 9, r = i % 2 ? 24 : 62; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  g.fill(); return new THREE.CanvasTexture(c);
})();
const flashes = [];
function impact(pos, lvl) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: ['#ffffff', '#ffffff', '#ffe14d', '#ff9a1f'][lvl], transparent: true, depthTest: false }));
  s.position.set(pos.x, pos.y + 0.35, pos.z); s.material.rotation = Math.random() * 6; s.renderOrder = 12;
  s.userData = { age: 0, life: 0.1 + lvl * 0.04, size: 0.5 + lvl * 0.5 };
  scene.add(s); flashes.push(s);
  shake = Math.max(shake, [0, 0.06, 0.18, 0.4][lvl]);
  freezeT = Math.max(freezeT, [0, 0, 0.05, 0.1][lvl]);
  if (lvl >= 2) burst(pos.x, pos.y + 0.3, pos.z, '#ffffff', lvl * 4, dropGeo, 4 + lvl * 2);
}
function updateFlashes(dt) {
  for (let i = flashes.length - 1; i >= 0; i--) {
    const s = flashes[i], u = s.userData, k = (u.age += dt) / u.life;
    if (k >= 1) { scene.remove(s); s.material.dispose(); flashes.splice(i, 1); continue; }
    s.scale.setScalar(u.size * (0.6 + k * 0.8)); s.material.opacity = 1 - k * k;
  }
}

// getting bonked by an item: the egg nearest the hit does a cartoon "boink" (squash, wobble, bump, stars)
const BOINK = new Set(['bat', 'pan', 'glove', 'hammer', 'eggHit']);
function boinkAt(pos) {
  let best = null, bd = 1.8;
  for (const p of players) if (p.alive) { const d = p.body.position.distanceTo(pos); if (d < bd) { bd = d; best = p; } }
  if (best) best.model.a.boink = 1;
}
// endless mode: a red ring + beam where the next bad egg is about to drop in
const marks = [], markRing = new THREE.RingGeometry(0.9, 1.3, 24), markBeam = new THREE.CylinderGeometry(0.9, 0.9, 7, 16, 1, true);
function spawnMark(pos, beamToo = true) {   // beamToo = false: just the target ring (air-raid bombs)
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: beamToo ? '#ff2a2a' : '#ff6a00', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(markRing, m); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08;
  const beam = new THREE.Mesh(markBeam, m.clone()); beam.position.y = 3.5; beam.visible = beamToo;
  g.add(ring, beam); g.position.set(pos.x, pos.y, pos.z); g.userData.age = 0; scene.add(g); marks.push(g);
}
function updateMarks(dt, t) {
  for (let i = marks.length - 1; i >= 0; i--) {
    const g = marks[i], k = (g.userData.age += dt) / 1.5;
    if (k >= 1) { scene.remove(g); g.children.forEach(c => c.material.dispose()); marks.splice(i, 1); continue; }
    g.children[0].scale.setScalar(1 + Math.sin(t * 14) * 0.15 + k * 0.5); g.children[1].material.opacity = 0.22 * (1 - k) + 0.08 * Math.sin(t * 20);
  }
}
// One call = sound + particles, replicated to online clients by the host.
function fx(name, pos, color = '#fff4e0') {
  playSfx(name, pos);
  if (pos && name.startsWith('impact')) impact(pos, +name.slice(6));
  if (pos && BOINK.has(name)) boinkAt(pos);
  if (pos) {
    if (['hit', 'bonk', 'bat', 'pan', 'glove', 'hammer'].includes(name)) burst(pos.x, pos.y + 0.3, pos.z, color, 6, shardGeo, 5);
    if (name === 'eggHit') burst(pos.x, pos.y + 0.6, pos.z, '#ffc61a', 8, dropGeo, 5);
    if (name === 'shield') burst(pos.x, pos.y + 0.4, pos.z, '#9fe8ff', 14, dropGeo, 6);
    if (name === 'spawnmark') spawnMark(pos);
    if (name === 'bombmark') spawnMark(pos, false);
    if (name === 'crack') { burst(pos.x, pos.y + 0.5, pos.z, color, 16, shardGeo, 8); burst(pos.x, pos.y + 0.5, pos.z, '#ffc61a', 8, dropGeo, 5); }
    if (name === 'splat') burst(pos.x, pos.y, pos.z, '#ffc61a', 10, dropGeo, 6);
    if (name === 'pickup') burst(pos.x, pos.y, pos.z, '#ffffff', 8, dropGeo, 4);
    if (name === 'boom') { burst(pos.x, pos.y + 0.5, pos.z, '#6b6b6b', 14, dropGeo, 7); burst(pos.x, pos.y + 0.5, pos.z, '#ffb347', 6, shardGeo, 6); }
    if (name === 'sizzle') burst(pos.x, pos.y + 0.5, pos.z, '#ffffff', 3, dropGeo, 1.5);
  }
  if (net.mode === 'host') net.fx.push(pos ? [name, r3(pos.x), r3(pos.y), r3(pos.z), color] : [name]);
}

// ---------- characters ----------
const BOT_NAMES = ['Yolko', 'Sunny', 'Scramble', 'Omelette', 'Benedict', 'Shelly', 'Eggbert', 'Humpty'];

function nameTag(text, color) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const x = cv.getContext('2d');
  x.font = 'bold 38px Arial Black, sans-serif'; x.textAlign = 'center';
  x.lineWidth = 8; x.strokeStyle = '#000'; x.strokeText(text, 128, 46);
  x.fillStyle = color; x.fillText(text, 128, 46);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
  s.scale.set(2, 0.5, 1); s.renderOrder = 10;
  return s;
}

function groundOf(b) {
  for (const c of world.contacts) {
    if (c.bi === b && c.ni.y < -0.5) return c.bj;
    if (c.bj === b && c.ni.y > 0.5) return c.bi;
  }
  return null;
}

const MOVE = { speed: 9, holdSpeed: 7, accel: 20, airAccel: 7, iceAccel: 3, jump: 7.8, fallExtra: 18, shortHop: 25, coyote: 0.12, buffer: 0.12, turn: 16 };
// Every attack winds up first (ATTACKS[kind].windup) and only hits when the strike lands; getting hit cancels a wind-up.
const CHARGEABLE = new Set([1, 2, 3, 4, 5, 9]);   // attack kinds that can be charged by holding punch
const FIST = { range: 1.7, cone: 0.4, dmg: 12, kb: 4.5, up: 2.5, cool: 0.35 };
const YOLK_FIST = { range: 1.5, cone: 0.4, dmg: 6, kb: 3, up: 2, cool: 0.4 };
const WEAPONS = {
  bat: { icon: 'baseball-bat', kind: 3, uses: 8, cool: 0.5, range: 2.4, cone: 0.25, dmg: 22, kb: 8, up: 4, sound: 'bat' },
  pan: { icon: 'saucepan', kind: 4, uses: 6, cool: 0.55, range: 2.0, cone: 0.35, dmg: 32, kb: 6, up: 5, daze: 0.8, sound: 'pan' },
  glove: { icon: 'boxing-glove', kind: 5, uses: 6, cool: 0.45, range: 2.0, cone: 0.3, dmg: 10, kb: 12, up: 5, sound: 'glove' },
  blaster: { icon: 'raw-egg', kind: 6, uses: 6, cool: 0.4, shoot: true },
  hammer: { icon: 'claw-hammer', kind: 4, uses: 4, cool: 0.7, range: 2.3, cone: 0.3, dmg: 28, kb: 13, up: 7, daze: 1, sound: 'hammer' },
  bombs: { icon: 'unlit-bomb', kind: 8, uses: 3, cool: 0.6, toss: 'bomb' },
  banana: { icon: 'banana', kind: 8, uses: 3, cool: 0.4, toss: 'peel' },
  pin: { icon: 'rolling-pin', kind: 4, uses: 6, cool: 0.6, range: 2.3, cone: 0.32, dmg: 20, kb: 16, up: 4, sound: 'bat' },          // rolling pin: a big shove
  spatula: { icon: 'spatula', kind: 3, uses: 7, cool: 0.5, range: 2.1, cone: 0.35, dmg: 10, kb: 4, up: 13, sound: 'glove' },       // flips eggs up into the air
  sausage: { icon: 'sausage', kind: 3, uses: 12, cool: 0.28, range: 1.9, cone: 0.3, dmg: 9, kb: 7, up: 3, sound: 'eggHit' },       // quick slaps
};
// weapons, a blaster shot, a spare shell, a power-up, then things lying in the world (lit bomb, banana peel)
const ITEM_KINDS = ['bat', 'pan', 'glove', 'blaster', 'egg', 'shell', 'hammer', 'bombs', 'banana', 'pepper', 'bomb', 'peel', 'pin', 'spatula', 'sausage'];
const PICKUPS = ['bat', 'pan', 'glove', 'blaster', 'hammer', 'bombs', 'banana', 'pepper', 'pin', 'spatula', 'sausage'], WORLD_ITEMS = ['egg', 'bomb', 'peel'];
const SHELL_HP = 100, YOLK_HP = 40;
const UP = new THREE.Vector3(0, 1, 0), yawQ = new THREE.Quaternion(), tmpE = new THREE.Euler();
let nextId = 1;

// Egg = two stacked spheres; yolk = one low sphere (same feet height, lighter so it flies further).
function setShapes(b, yolk, s = 1) {   // s = size (the endless-mode boss is bigger)
  const old = [...b.shapes];
  b.addShape(new CANNON.Sphere(0.5 * s), new CANNON.Vec3(0, -0.4 * s, 0));
  if (!yolk) b.addShape(new CANNON.Sphere(0.5 * s), new CANNON.Vec3(0, 0.4 * s, 0));
  old.forEach(sh => b.removeShape(sh));
  b.mass = (yolk ? 3.5 : 5) * s * s; b.updateMassProperties();
}

class Player {
  constructor(ctrl, custom, id = nextId++) {
    this.id = id; this.ctrl = ctrl; this.custom = custom; this.wins = 0; this.size = custom.boss ? 1.6 : 1;
    this.body = new CANNON.Body({ mass: 5, material: playerMat, fixedRotation: true, linearDamping: 0.05, angularDamping: 0.3, collisionFilterGroup: G_PLAYER });
    setShapes(this.body, false, this.size);
    this.body.player = this;
    Object.assign(this, { alive: false, prev: {}, flags: 4, hp: SHELL_HP, yolk: false, attackT: -1, attackKind: 0 });
    this.rebuild();
  }
  rebuild() {
    if (this.model) scene.remove(this.model.group, this.tag, this.arrow, this.ring);
    this.model = buildModel(this.custom);
    this.model.group.scale.setScalar(this.size);
    this.tag = nameTag(this.custom.name, this.custom.color === '#fff4e0' ? '#ffffff' : this.custom.color);
    const m = new THREE.MeshBasicMaterial({ color: this.custom.color, transparent: true, opacity: 0.9, depthTest: false });
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 4), m); this.arrow.rotation.x = Math.PI; this.arrow.renderOrder = 11;
    const edge = new THREE.Mesh(this.arrow.geometry, new THREE.MeshBasicMaterial({ color: '#111', side: THREE.BackSide, depthTest: false }));
    edge.scale.setScalar(1.25); edge.renderOrder = 10; this.arrow.add(edge);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.09, 8, 32), m); this.ring.rotation.x = Math.PI / 2;
    this.arrow.visible = this.ring.visible = false;
    if (this.alive) scene.add(this.model.group, this.tag, this.arrow, this.ring);
  }
  facing() { return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; }
  spawn([x, y, z]) {
    const b = this.body;
    this.release(); this.heldBy?.release(); this.endHang();
    if (this.yolk) setShapes(b, false, this.size);
    b.position.set(x, y, z); b.velocity.setZero(); b.angularVelocity.setZero(); b.quaternion.set(0, 0, 0, 1);
    b.fixedRotation = true; b.linearDamping = 0.05; b.updateMassProperties();
    if (!b.world) world.addBody(b);
    if (!this.alive) scene.add(this.model.group, this.tag, this.arrow, this.ring);
    Object.assign(this, { alive: true, yaw: Math.atan2(-x, -z), hp: SHELL_HP, yolk: false, ko: 0, stun: 0, cool: 0, attackT: -1, attackKind: 0, arm: 0,
      cheer: false, coyote: 0, jumpBuf: 0, tgt: null, weapon: null, ammo: 0, invuln: 0, hazardT: 0, lastGround: null });
  }
  remove() {
    this.release(); this.heldBy?.release(); this.endHang();
    if (this.body.world) world.removeBody(this.body);
    scene.remove(this.model.group, this.tag, this.arrow, this.ring);
    this.alive = false;
  }
  hurt(dmg, daze = 0) {
    if (this.invuln > 0 || !this.alive) return;
    this.hp -= dmg * (suddenDeath ? 1.5 : 1) * (this.custom.boss ? 0.4 : 1); this.stun = 0.35; this.release(); this.endHang();
    if (this.attackT >= 0 && this.attackT < ATTACKS[this.attackKind].windup) this.attackT = -1;   // hit during wind-up = interrupted
    if (this.hp <= 0) return this.yolk ? this.splat() : this.breakShell();
    // combo breaker: the 4th hit in a quick chain knocks you free with a second of safety, so nobody gets juggled to death
    this.hitChain = this.hitChainT > 0 ? (this.hitChain || 0) + 1 : 1; this.hitChainT = 1.1;
    if (this.hitChain >= 4) { this.hitChain = 0; this.invuln = 1; this.stun = 0; fx('shield', this.body.position); return; }
    if (daze) this.daze(daze);
  }
  burn(amount) {   // damage over time (hot stove) without stagger
    if (this.invuln > 0 || !this.alive) return;
    this.hp -= amount;
    if ((this.burnFx = (this.burnFx || 0) - amount) <= 0) { this.burnFx = 4; fx('sizzle', this.body.position); }
    if (this.hp <= 0) this.yolk ? this.splat() : this.breakShell();
  }
  daze(t, force = false) {   // ragdoll tumble with dizzy stars
    if (this.ko > 0 || (this.dazeImm > 0 && !force)) return;   // hits don't keep a dazed (or just-up) egg on the floor
    this.ko = t; this.attackT = -1;
    const b = this.body; b.fixedRotation = false; b.linearDamping = 0.6; b.updateMassProperties();
    b.angularVelocity.set(R(-6, 6), R(-3, 3), R(-6, 6));
  }
  breakShell() {   // shell shatters: you're a yolk now, go find a new shell!
    fx('crack', this.body.position, this.custom.color);
    if (this.custom.enemy) { fx('splat', this.body.position); return this.remove(); }   // bad eggs shatter for good: no yolk phase
    Object.assign(this, { yolk: true, hp: YOLK_HP, weapon: null, invuln: 0.8 });
    setShapes(this.body, true, this.size);
    this.daze(1.2, true);
  }
  splat() {
    fx('splat', this.body.position);
    if (state === 'lobby' || state === 'countdown') return this.spawn(spawnPoint(players.indexOf(this), players.length));
    this.remove();
  }
  regainShell() {
    Object.assign(this, { yolk: false, hp: SHELL_HP, invuln: 0.5 });
    setShapes(this.body, false);
    this.body.position.y += 0.4;
  }
  getUp() {
    const b = this.body;
    b.quaternion.set(0, 0, 0, 1); b.angularVelocity.setZero();
    b.fixedRotation = true; b.linearDamping = 0.05; b.updateMassProperties();
    b.position.y += 0.6; b.velocity.y = 4; this.dazeImm = 1.2;
  }
  targets() {
    return [...players.filter(p => p !== this && p.alive).map(p => p.body), ...map.crates.filter(c => c.world)];
  }
  attackDef() { return this.yolk ? YOLK_FIST : WEAPONS[this.weapon] || FIST; }
  // Fists chain jab, jab, haymaker; in the air a punch is a flying headbutt. Holding punch charges any swing (see update).
  startAttack(ground) {
    const w = this.attackDef(), v = this.body.velocity;
    this.chargeT = 0;
    if (!ground && !w.kind) {
      const f = this.facing(); this.attackKind = 10; this.flyT = 0.3;
      v.x = f.x * 12; v.z = f.z * 12; v.y = Math.min(v.y, 3);
    } else if (w.kind) this.attackKind = w.kind;
    else { this.combo = this.comboT > 0 ? ((this.combo || 0) + 1) % 3 : 0; this.attackKind = this.combo === 2 ? 9 : (this.arm ^= 1) ? 2 : 1; }
    this.attackT = 0; this.cool = ATTACKS[this.attackKind].windup + w.cool + ({ 9: 0.3, 10: 0.4 }[this.attackKind] || 0);
    fx(this.attackKind === 9 ? 'windupBig' : 'windup');
  }
  strike() {
    const w = this.attackDef(), f = this.facing(), me = this.body.position, K = this.attackKind;
    const heavy = this.chargeT > 0.3, ch = heavy ? 1 + Math.min(this.chargeT, 1.2) * 1.3 : 1;   // charged: up to ~2.5x
    const [mDmg, mKb, mUp, mRange] = K === 9 ? [1.4, 2.2, 2, 1.1] : K === 10 ? [1.2, 2, 1.6, 1.2] : [1, 1, 1, 1];
    const daze = Math.max(w.daze || 0, K === 9 ? 0.5 : K === 10 ? 0.4 : 0, heavy ? 0.9 : 0), lvl = heavy ? 3 : K === 9 || K === 10 || this.weapon ? 2 : 1;
    const soft = this.custom.enemy && !this.custom.boss ? Math.min(1, 0.55 + endless.wave * 0.04) : 1;   // early endless waves hit softer
    if (K <= 2) this.comboT = 0.8;
    if (w.shoot) shoot(this, f);
    else if (w.toss) toss(this, f, w.toss);
    else {
      fx(this.weapon ? 'swing' : 'punch');
      for (const t of this.targets()) {
        const dx = t.position.x - me.x, dz = t.position.z - me.z, dist = Math.hypot(dx, dz) || 1;
        if (dist > w.range * mRange * this.size || Math.abs(t.position.y - me.y) > (t.player?.hang || K === 10 ? 2.4 : 1.6) || (dx * f.x + dz * f.z) / dist < w.cone) continue;
        const tp = t.player, hard = this.custom.boss ? 1.3 : 1;
        // guarding (holding grab) and facing the attacker blocks normal hits; a charged hit smashes the guard
        if (tp && (tp.flags & 128) && (-dx * Math.sin(tp.yaw) - dz * Math.cos(tp.yaw)) / dist > 0.3) {
          if (!heavy) {
            t.applyImpulse(new CANNON.Vec3(f.x * w.kb * 0.3 * t.mass, 0, f.z * w.kb * 0.3 * t.mass));
            tp.hp -= w.dmg * 0.15; tp.stun = Math.max(tp.stun, 0.1);
            this.stun = 0.3; this.comboT = 0; this.body.velocity.x -= f.x * 4; this.body.velocity.z -= f.z * 4;   // bounced off the guard
            fx('block', t.position); continue;
          }
          fx('guardbreak', t.position, tp.custom.color);
        }
        const pow = (tp?.ko > 0 ? 1.3 : 1) * (tp?.yolk ? 1.3 : 1) * (suddenDeath ? 1.4 : 1) * (this.boostT > 0 ? 1.35 : 1) * hard * ch * (tp?.custom.boss ? 0.4 : 1);
        t.applyImpulse(new CANNON.Vec3(f.x * w.kb * mKb * pow * t.mass, w.up * mUp * pow * t.mass, f.z * w.kb * mKb * pow * t.mass));
        fx(tp ? (lvl >= 2 && !this.weapon ? 'heavy' : w.sound || 'hit') : 'crate', t.position, tp ? (tp.yolk ? '#ffb21c' : tp.custom.color) : undefined);
        if (tp) fx('impact' + lvl, t.position);
        tp?.hurt(w.dmg * mDmg * (this.boostT > 0 ? 1.35 : 1) * hard * ch * soft, daze);
      }
    }
    if (this.weapon && --this.ammo <= 0) this.weapon = null;
  }
  dropWeapon() {   // put it down in front of you, uses left intact, for anyone to pick up
    const f = this.facing(), q = this.body.position, x = q.x + f.x * 1.7, z = q.z + f.z * 1.7, hit = castDown(x, q.y + 1, z, q.y - 4);
    map.items.push({ kind: this.weapon, ammo: this.ammo, pos: hit ? new CANNON.Vec3(x, hit.hitPointWorld.y + 0.8, z) : q.clone(), noPick: this, noPickT: 0.8 });
    this.weapon = null; this.ammo = 0; this.attackT = -1; fx('drop', q);
  }
  tryGrab() {
    if (this.heldBy) return;   // no grabbing back while held: two eggs holding each other locked up forever
    const f = this.facing(), p = this.body.position;
    const hand = new CANNON.Vec3(p.x + f.x * 0.9, p.y + 0.2, p.z + f.z * 0.9);
    let best = null, bd = 1.0;
    for (const t of this.targets()) { const d = t.position.distanceTo(hand); if (d < bd) { bd = d; best = t; } }
    if (!best || best.player?.heldBy) return;
    this.holding = best; this.holdT = 0;
    this.joint = new CANNON.PointToPointConstraint(this.body, new CANNON.Vec3(f.x * 1.1, 0.5, f.z * 1.1), best, new CANNON.Vec3(), 400);
    world.addConstraint(this.joint);
    if (best.player) best.player.heldBy = this;
  }
  release() {
    if (!this.holding) return;
    if (this.joint) world.removeConstraint(this.joint);
    if (this.holding.player) this.holding.player.heldBy = null;
    this.holding = this.joint = null;
  }
  throw() {
    const t = this.holding, f = this.facing();
    this.release(); this.cool = 0.5; this.attackKind = 7; this.attackT = 0; fx('swing');
    t.velocity.set(f.x * 11, 6, f.z * 11);
    if (t.player) { t.player.hurt(8); t.player.stun = 0.8; }
  }
  // Ledge grab: look around for a platform top between waist and above-head height.
  tryLedge() {
    const p = this.body.position;
    for (const off of [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
      const a = this.yaw + off, x = p.x + Math.sin(a) * 1.0, z = p.z + Math.cos(a) * 1.0;
      const hit = castDown(x, p.y + 1.6, z, p.y - 0.3);
      if (!hit || hit.body.angularVelocity.lengthSquared() > 0.01 || hit.body.hazard) continue;
      const top = hit.hitPointWorld.y;
      if (top < p.y - 0.2 || top > p.y + 1.3) continue;
      this.yaw = a; this.hang = { body: hit.body, off: top - hit.body.position.y }; this.release();
      fx('grab'); return true;
    }
    return false;
  }
  endHang() { if (this.hang) { this.hang = null; this.climbT = 0; this.body.collisionResponse = true; } }
  updateHang(dt, inp, edge) {
    const b = this.body, h = this.hang, top = h.body.position.y + h.off;
    b.force.y -= world.gravity.y * b.mass;   // cancel gravity while hanging/climbing
    if (this.climbT > 0) {
      this.climbT -= dt;
      const k = 1 - Math.max(0, this.climbT) / 0.3, ky = Math.min(1, k * 1.7);
      b.position.set(h.from.x + (h.to.x - h.from.x) * k, h.from.y + (h.to.y - h.from.y) * ky, h.from.z + (h.to.z - h.from.z) * k);
      b.velocity.setZero();
      if (this.climbT <= 0) this.endHang();
      return;
    }
    if (!inp.grab || !h.body.world) return this.endHang();
    b.velocity.set(h.body.velocity.x, 0, h.body.velocity.z);
    b.position.y = top - 0.8;
    const f = this.facing();
    if (edge('jump') || inp.x * f.x + inp.z * f.z > 0.8) {
      h.from = b.position.clone(); h.to = new CANNON.Vec3(b.position.x + f.x * 1.1, top + 0.95, b.position.z + f.z * 1.1);
      this.climbT = 0.3; b.collisionResponse = false; fx('climb');
    }
  }
  update(dt, inp) {
    const b = this.body, v = b.velocity;
    // edges: online inputs carry press counters so quick taps survive network jitter
    const edge = k => (inp[k + 'C'] !== undefined ? inp[k + 'C'] !== this.prev[k + 'C'] : inp[k] && !this.prev[k]);
    this.cool -= dt; this.stun -= dt; this.invuln -= dt; this.hazardT -= dt; this.flyT -= dt; this.boostT -= dt; this.dazeImm -= dt; this.hitChainT -= dt;
    if (this.holding && (!this.holding.world || (this.holdT += dt) > 4)) this.release();
    this.comboT -= dt;
    const wasCharging = this.charging;
    this.charging = false;
    if (this.attackT >= 0) {   // wind-up → strike → recover; keep holding punch at the end of the wind-up to charge the hit
      const W = ATTACKS[this.attackKind].windup, before = this.attackT;
      this.charging = inp.punch && CHARGEABLE.has(this.attackKind) && !this.holding && !(this.ko > 0) && before + dt >= W - 0.02 && this.chargeT < 1.5;
      if (this.charging) { this.chargeT += dt; this.attackT = W - 0.02; if (!wasCharging) fx('charge', this.body.position); }
      else {
        this.attackT += dt;
        if (before < W && this.attackT >= W && this.attackKind !== 7 && !(this.ko > 0)) this.strike();
        if (this.attackT > W + 0.35) this.attackT = -1;
      }
    }
    let ground = null;
    if (this.ko > 0) {
      if ((this.ko -= dt) <= 0) this.getUp();
    } else if (this.hang) {
      this.updateHang(dt, inp, edge);
    } else {
      ground = groundOf(b);
      if (ground?.type === STATIC && !ground.crumble && !ground.hazard) this.lastGround = b.position.clone();
      if (ground?.crumble && !ground.crumbleT && state === 'round') ground.crumbleT = 0.9;
      let cx = 0, cz = 0;   // ride moving/spinning platforms (remembered for a moment: contacts flicker on one that also climbs, like the chairlift)
      if (ground?.type === KINEMATIC) { this.plat = ground; this.platT = 0.2; } else if (ground) this.platT = 0; else this.platT -= dt;
      const plat = this.platT > 0 && this.plat?.world ? this.plat : null;
      if (plat) { const w = plat.angularVelocity.cross(b.position.vsub(plat.position)); cx = plat.velocity.x + w.x; cz = plat.velocity.z + w.z; }
      if (ground?.belt) [cx, cz] = ground.belt;   // conveyor belts
      let { x, z } = inp; const len = Math.hypot(x, z);
      if (len > 1) { x /= len; z /= len; }
      const speed = (this.holding ? MOVE.holdSpeed : this.yolk ? MOVE.speed * 1.08 : MOVE.speed) * (this.attackT >= 0 ? 0.55 : 1) * (this.boostT > 0 ? 1.4 : 1) * (inp.block || (inp.grab && !this.holding) ? 0.65 : 1);
      const accel = (ground || plat ? (map.slippery || ground?.ice ? MOVE.iceAccel : MOVE.accel) : MOVE.airAccel) * (this.flyT > 0 ? 0 : this.stun > 0 || this.heldBy ? 0.15 : 1);   // flyT: spring launch, pure ballistic arc
      const k = 1 - Math.exp(-accel * dt);
      v.x += (x * speed + cx - v.x) * k; v.z += (z * speed + cz - v.z) * k;
      if (len > 0.2) this.yaw = lerpAngle(this.yaw, Math.atan2(x, z), 1 - Math.exp(-MOVE.turn * dt));
      if (inp.block && ground) {   // blocking turns you toward the nearest threat, so the shield is where the punches come from
        let foe = null, fd = 3.5;
        for (const o of players) if (o !== this && o.alive && (mode !== 'endless' || !o.custom.enemy !== !this.custom.enemy)) { const d = o.body.position.distanceTo(b.position); if (d < fd) { fd = d; foe = o.body.position; } }
        if (foe) this.yaw = lerpAngle(this.yaw, Math.atan2(foe.x - b.position.x, foe.z - b.position.z), 1 - Math.exp(-12 * dt));
      }

      this.coyote = ground ? MOVE.coyote : this.coyote - dt;
      this.jumpBuf = edge('jump') ? MOVE.buffer : this.jumpBuf - dt;
      if (this.jumpBuf > 0 && this.coyote > 0 && !this.heldBy) { v.y = MOVE.jump; this.jumpBuf = this.coyote = 0; fx('jump'); }
      if (!ground && v.y < 0 && !(this.flyT > 0)) v.y -= MOVE.fallExtra * dt;
      if (!ground && v.y > 0 && !inp.jump && !(this.flyT > 0)) v.y -= MOVE.shortHop * dt;

      if (edge('drop') && this.weapon) this.dropWeapon();
      if (edge('punch') && this.heldBy) this.heldBy.holdT += 0.7;   // mash punch to wriggle free sooner
      if (edge('punch') && !inp.block && this.cool <= 0 && this.attackT < 0) this.holding ? this.throw() : this.startAttack(!!ground || this.coyote > 0);
      // press grab = reach for whatever is in front (briefly); keep holding with empty hands = guard; holding while falling = catch a ledge
      if (edge('grab')) this.reachT = 0.25;
      this.reachT -= dt;
      if (inp.grab && !this.holding && !(!ground && v.y < 3 && this.tryLedge()) && this.reachT > 0) this.tryGrab();
      if (!inp.grab && this.holding) this.release();
      if (this.joint) { const f = this.facing(); this.joint.pivotA.set(f.x * 1.1, 0.5, f.z * 1.1); }
    }
    if ((this.teeterT = (this.teeterT || 0) - dt) <= 0) {   // standing right at an edge (animation only: arms windmill)
      this.teeterT = 0.15; const f = this.facing(), q = b.position;
      this.teeter = !!ground && Math.hypot(v.x, v.z) < 2 && this.attackT < 0 && !this.holding && !castDown(q.x + f.x * 0.75, q.y, q.z + f.z * 0.75, q.y - 3);
    }
    this.flags = (this.holding ? 1 : 0) | (this.heldBy ? 2 : 0) | (ground ? 4 : 0) | (this.cheer ? 8 : 0) | (this.hang ? 16 : 0) | (this.yolk ? 32 : 0) | (this.boostT > 0 ? 64 : 0)
      | ((inp.block || (inp.grab && !this.holding && !(this.reachT > 0))) && ground && !(this.ko > 0) ? 128 : 0) | (this.charging ? 256 : 0) | (this.teeter ? 512 : 0);   // 128 guard, 256 charging, 512 teeter
    this.prev = { ...inp };
  }
  sync(dt, t) {
    const { group } = this.model, b = this.body, v = b.velocity;
    group.position.copy(b.position);
    yawQ.setFromAxisAngle(UP, this.yaw);
    if (this.ko > 0) group.quaternion.copy(b.quaternion).multiply(yawQ);
    else group.quaternion.setFromEuler(tmpE.set(v.z * 0.02, 0, -v.x * 0.02)).multiply(yawQ);
    setWeapon(this.model, this.weapon || null);
    animate(this.model, this, dt, t);
    if ((this.flags & 256) && Math.random() < dt * 20) burst(b.position.x + R(-0.5, 0.5), b.position.y + R(0, 0.9), b.position.z + R(-0.5, 0.5), '#ffe14d', 1, shardGeo, 1);   // charging
    if ((this.flags & 64) && Math.random() < dt * 14) burst(b.position.x, b.position.y + 0.3, b.position.z, Math.random() < 0.5 ? '#ff7a00' : '#ffd000', 1, shardGeo, 1.5);   // fired up by a pepper
    const stepI = Math.floor(this.model.a.phase / Math.PI), near = camera.position.distanceTo(group.position) < 45;
    if (stepI !== this.stepI) { this.stepI = stepI; if ((this.flags & 4) && near && Math.hypot(v.x, v.z) > 2) { playSfx('step', b.position); if (Math.hypot(v.x, v.z) > 5) dust(this, 1, 0.4, 0.35); } }
    const grounded = !!(this.flags & 4);
    if (grounded && this.wasAir > 0.35 && near) { playSfx('land', b.position); dust(this, 7, 2.2, 0.45); }
    this.wasAir = grounded ? 0 : (this.wasAir || 0) + dt;
    this.tag.position.set(b.position.x, b.position.y + (this.yolk ? 1.3 : 2) * this.size, b.position.z);
    // countdown: big bobbing arrow + pulsing ring under every local human so you can find yourself
    const mark = (state === 'countdown' || (state === 'round' && roundT < 2)) && this.ctrl !== 'bot' && owned(this);
    this.arrow.visible = this.ring.visible = mark;
    this.tag.scale.set(mark ? 4 : 2, mark ? 1 : 0.5, 1);
    if (mark) {
      const k = THREE.MathUtils.clamp(camera.position.distanceTo(group.position) / 14, 1, 3);   // stay readable when zoomed out
      this.arrow.position.set(b.position.x, b.position.y + 2.4 + k * 0.9 + Math.sin(t * 6) * 0.25 * k, b.position.z); this.arrow.rotation.y += dt * 3;
      this.arrow.scale.setScalar(k);
      this.ring.position.set(b.position.x, b.position.y - 0.85, b.position.z); this.ring.scale.setScalar(k * (1 + Math.sin(t * 6) * 0.15));
      this.tag.position.y += 0.4;
    }
  }
}

function toss(p, f, kind) {
  const pos = p.body.position;
  if (kind === 'peel') {   // dropped just in front, flat on the ground
    const x = pos.x + f.x * 1.3, z = pos.z + f.z * 1.3, hit = castDown(x, pos.y + 1, z, pos.y - 4);
    if (hit) map.items.push({ kind: 'peel', pos: new CANNON.Vec3(x, hit.hitPointWorld.y + 0.05, z), life: 20, safeT: 1, owner: p });
    return fx('swing');
  }
  const body = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(0.28), position: new CANNON.Vec3(pos.x + f.x * 0.9, pos.y + 0.6, pos.z + f.z * 0.9),
    collisionFilterGroup: G_PROJ, collisionFilterMask: G_MAP | G_PLAYER | G_CRATE, linearDamping: 0.3 });
  body.velocity.set(f.x * 11, 7, f.z * 11);
  world.addBody(body); map.bodies.push(body); map.items.push({ kind: 'bomb', body, fuse: 1.7 });
  fx('swing');
}
// Air raid (battle rounds that drag on): a bomb falls onto a red ring, usually near one of the eggs
function dropBomb() {
  const alive = players.filter(p => p.alive && p.body.position.y > map.killY + 1);
  for (let i = 0; i < 12; i++) {
    const t = alive.length && Math.random() < 0.65 ? alive[Math.floor(Math.random() * alive.length)].body.position : null;
    const x = t ? t.x + (Math.random() - 0.5) * 5 : (Math.random() * 2 - 1) * map.bounds[0], z = t ? t.z + (Math.random() - 0.5) * 5 : (Math.random() * 2 - 1) * map.bounds[1];
    const hit = castDown(x, (t ? t.y : 8) + 14, z, map.killY); if (!hit || hit.body.hazard) continue;
    const y = hit.hitPointWorld.y, h = 16, g = -world.gravity.y, v0 = 6, fall = (-v0 + Math.sqrt(v0 * v0 + 2 * g * h)) / g;
    fx('bombmark', { x, y, z });
    const body = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(0.28), position: new CANNON.Vec3(x, y + h, z), collisionFilterGroup: G_PROJ, collisionFilterMask: G_MAP | G_PLAYER | G_CRATE, linearDamping: 0.01 });
    body.velocity.set(0, -v0, 0); world.addBody(body); map.bodies.push(body); map.items.push({ kind: 'bomb', body, fuse: fall + 0.2 });
    return;
  }
}
// eggs (and crates) near a point get blasted outward
function explode([x, y, z], R = 3.4, dmg = 18) {
  fx('boom', { x, y, z });
  for (const p of players) {
    if (!p.alive) continue;
    const q = p.body.position, dx = q.x - x, dz = q.z - z, d = Math.hypot(dx, dz);
    if (d > R || Math.abs(q.y - y) > 3) continue;
    p.hurt(dmg * (1 - d / R * 0.5), 0.8);
    if (p.alive) p.body.velocity.set(dx / (d || 1) * 11, 9, dz / (d || 1) * 11);
  }
  for (const c of map.crates) { const d = c.position.distanceTo(new CANNON.Vec3(x, y, z)); if (d < R) c.applyImpulse(new CANNON.Vec3((c.position.x - x) / d * 8, 6, (c.position.z - z) / d * 8)); }
}
function shoot(p, f) {
  const pos = p.body.position;
  const body = new CANNON.Body({ mass: 0.6, shape: new CANNON.Sphere(0.2), position: new CANNON.Vec3(pos.x + f.x * 0.95, pos.y + 0.35, pos.z + f.z * 0.95),
    collisionFilterGroup: G_PROJ, collisionFilterMask: G_MAP | G_PLAYER | G_CRATE });
  body.velocity.set(f.x * 26, 3, f.z * 26);
  const it = { kind: 'egg', body, life: 2, dir: f };
  body.addEventListener('collide', e => { if (!it.hitP && e.body.player && e.body.player !== p) it.hitP = e.body.player; it.life = Math.min(it.life, 0.02); });
  world.addBody(body); map.bodies.push(body); map.items.push(it);
  fx('shoot');
}

// ---------- map art: procedural textures, sky, clouds ----------
const TEX = {};
function patternTex(kind) {
  if (TEX[kind]) return TEX[kind];
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), rnd = Math.random, dark = a => `rgba(0,0,0,${a})`, light = a => `rgba(255,255,255,${a})`;
  g.fillStyle = kind === 'grid' ? '#333' : '#fff'; g.fillRect(0, 0, 256, 256);
  if (kind === 'planks') for (let i = 0; i < 4; i++) {
    g.fillStyle = dark(0.04 + (i % 2) * 0.06); g.fillRect(0, i * 64, 256, 64);
    g.fillStyle = dark(0.4); g.fillRect(0, i * 64, 256, 3); g.fillRect((i * 97) % 256, i * 64, 3, 64);
    g.strokeStyle = dark(0.1); for (let j = 0; j < 6; j++) { g.beginPath(); const y = i * 64 + 8 + rnd() * 48; g.moveTo(0, y); g.bezierCurveTo(80, y + 6, 170, y - 6, 256, y); g.stroke(); }
  }
  if (kind === 'tiles' || kind === 'checker') {
    const n = kind === 'tiles' ? 4 : 2, s = 256 / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i + j) % 2) { g.fillStyle = dark(kind === 'tiles' ? 0.12 : 0.6); g.fillRect(i * s, j * s, s, s); }
    g.strokeStyle = light(0.6); g.lineWidth = 4; for (let i = 0; i <= n; i++) { g.strokeRect(i * s, -2, 0, 260); g.strokeRect(-2, i * s, 260, 0); }
  }
  if (kind === 'grid') { g.strokeStyle = '#fff'; g.lineWidth = 4; g.shadowColor = '#fff'; g.shadowBlur = 8; for (let i = 0; i <= 256; i += 64) { g.strokeRect(i, -4, 0, 264); g.strokeRect(-4, i, 264, 0); } }
  if (kind === 'snow') for (let i = 0; i < 400; i++) { g.fillStyle = rnd() < 0.5 ? light(0.9) : 'rgba(150,190,230,.25)'; g.beginPath(); g.arc(rnd() * 256, rnd() * 256, 1 + rnd() * 4, 0, 7); g.fill(); }
  if (kind === 'metal') {
    for (let y = 0; y < 256; y += 32) for (let x = (y / 32) % 2 * 16; x < 256; x += 32) {
      g.save(); g.translate(x + 8, y + 8); g.rotate(((x + y) / 32) % 2 ? 0.7 : -0.7);
      g.fillStyle = dark(0.25); g.fillRect(-9, -2, 18, 5); g.fillStyle = light(0.5); g.fillRect(-9, -3, 18, 3); g.restore();
    }
    g.fillStyle = 'rgba(255,200,0,.6)'; for (let x = -256; x < 256; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 20, 0); g.lineTo(x + 36, 16); g.lineTo(x + 16, 16); g.fill(); }
  }
  if (kind === 'brick') for (let r = 0; r < 8; r++) for (let x = (r % 2) * -32; x < 256; x += 64) {
    g.fillStyle = dark(0.05 + rnd() * 0.12); g.fillRect(x + 2, r * 32 + 2, 60, 28);
    g.fillStyle = light(0.5); g.fillRect(x, r * 32, 64, 2); g.fillRect(x, r * 32, 2, 32);
  }
  if (kind === 'grass') for (let i = 0; i < 1200; i++) {
    g.strokeStyle = rnd() < 0.5 ? dark(0.15) : light(0.35); g.lineWidth = 2;
    const x = rnd() * 256, y = rnd() * 256; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 4, y - 4 - rnd() * 6); g.stroke();
  }
  if (kind === 'waves') { g.strokeStyle = light(0.5); g.lineWidth = 3; for (let y = 16; y < 256; y += 32) { g.beginPath(); for (let x = 0; x <= 256; x += 8) g.lineTo(x, y + Math.sin(x / 256 * Math.PI * 4 + y) * 6); g.stroke(); } }
  if (kind === 'concrete') {
    for (let i = 0; i < 3000; i++) { g.fillStyle = rnd() < 0.5 ? dark(0.08) : light(0.12); g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 3); }
    g.fillStyle = dark(0.25); g.fillRect(0, 0, 256, 2); g.fillRect(0, 0, 2, 256);
    g.strokeStyle = dark(0.18); g.lineWidth = 1.5; for (let i = 0; i < 3; i++) { g.beginPath(); let x = rnd() * 256, y = rnd() * 256; g.moveTo(x, y); for (let j = 0; j < 5; j++) g.lineTo(x += (rnd() - 0.5) * 50, y += (rnd() - 0.5) * 50); g.stroke(); }
  }
  if (kind === 'marble') for (let i = 0; i < 9; i++) {
    g.strokeStyle = `rgba(90,90,100,${0.08 + rnd() * 0.18})`; g.lineWidth = 1 + rnd() * 3; g.beginPath();
    let x = rnd() * 256, y = 0; g.moveTo(x, y); while (y < 256) g.lineTo(x += (rnd() - 0.5) * 40, y += 10 + rnd() * 20); g.stroke();
  }
  if (kind === 'corrugated') for (let x = 0; x < 256; x += 16) { const gr = g.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, dark(0.25)); gr.addColorStop(0.5, light(0.25)); gr.addColorStop(1, dark(0.25)); g.fillStyle = gr; g.fillRect(x, 0, 16, 256); }
  if (kind === 'windows') { g.fillStyle = dark(0.35); g.fillRect(0, 0, 256, 256); for (let y = 8; y < 256; y += 32) for (let x = 8; x < 256; x += 32) { g.fillStyle = rnd() < 0.35 ? 'rgba(255,230,150,.9)' : 'rgba(40,60,90,.8)'; g.fillRect(x, y, 18, 20); } }
  if (kind === 'hazard') { g.fillStyle = '#ffcc00'; g.fillRect(0, 0, 256, 256); g.fillStyle = '#111'; for (let x = -256; x < 512; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 32, 0); g.lineTo(x + 32 - 256, 256); g.lineTo(x - 256, 256); g.fill(); } }
  if (kind === 'wallTiles') { for (let y = 0; y < 256; y += 32) for (let x = 0; x < 256; x += 32) { g.fillStyle = rnd() < 0.15 ? dark(0.06) : light(0.1); g.fillRect(x + 2, y + 2, 28, 28); } g.strokeStyle = dark(0.18); g.lineWidth = 2; for (let i = 0; i <= 256; i += 32) { g.strokeRect(i, -2, 0, 260); g.strokeRect(-2, i, 260, 0); } }
  for (let i = 0; i < 2500; i++) { g.fillStyle = rnd() < 0.5 ? dark(0.06) : light(0.08); g.fillRect(rnd() * 256, rnd() * 256, 2, 2); }   // grit
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return TEX[kind] = t;
}
// Box with world-scale UVs so textures tile at a constant size instead of stretching.
function boxGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / 3, uv.getY(k) * dims[f][1] / 3); }
  return g;
}
function scaledUV(g, s) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s); return g; }
function skyTex(top, bottom) {
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(0.7, bottom); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const THEMES = [
  { name: 'Sunny Docks', step: 'wood', sky: '#4aa8f0', fog: '#cdeeff', below: '#2a7ab8', tex: 'planks', cols: ['#c98b52', '#b07a46', '#e0a96d'], trim: '#5a3a22' },
  { name: 'Candy Land', step: 'carpet', sky: '#ff8fcf', fog: '#ffe4f3', below: '#ff9ccf', tex: 'tiles', cols: ['#ff8fc7', '#9be7ff', '#fff27a', '#b4f8a4'], trim: '#ffffff' },
  { name: 'Neon Night', sky: '#05020f', fog: '#1e1045', below: '#3a0a5a', tex: 'grid', cols: ['#ff2e88', '#2ef2ff', '#8a2eff'], glow: true, trim: '#2ef2ff' },
  { name: 'Frosty Peaks', step: 'snow', sky: '#7fbfff', fog: '#eef7ff', below: '#e8f4ff', tex: 'snow', cols: ['#ffffff', '#d6efff', '#bfe3ff'], slippery: true, trim: '#9fd8ff' },
  { name: 'Toxic Factory', sky: '#1f2a18', fog: '#55663a', below: '#7dff3a', tex: 'metal', cols: ['#8a8a8a', '#9a8a5a', '#6f7a6f'], glowBelow: true, trim: 'hazard' },
  { name: 'Lava Rooftops', sky: '#c8401a', fog: '#ffb380', below: '#ff4400', tex: 'brick', cols: ['#a0583e', '#8a4a38', '#b06a50'], glowBelow: true, trim: '#d8d0c4' },
  { name: 'Breakfast Kitchen', step: 'wood', sky: '#ffd88a', fog: '#fff6e0', below: '#f4efe6', tex: 'checker', cols: ['#ffffff', '#ffe2b8', '#ffc4a8'], trim: '#e63946' },
  { name: 'Farmyard', step: 'grass', sky: '#5ec4ff', fog: '#e6f7ff', below: '#4f9a42', tex: 'grass', cols: ['#7fb069', '#93c47d', '#a7c96b'], trim: '#8b5a2b' },
];

const map = { group: null, bodies: [], syncs: [], movers: [], visuals: [], h: [], crates: [], items: [], spawns: null, slippery: false, theme: THEMES[0], seed: 0, below: null, deco: null, pickupT: 0, bounds: [18, 18] };

function clearMap() {
  if (map.group) {   // free GPU memory (shared pattern textures in TEX are kept)
    scene.remove(map.group);
    map.group.traverse(o => { [].concat(o.userData.fadeMat || []).forEach(m => m.dispose()); if (o.userData.shared) return; o.geometry?.dispose(); o.userData.hiGeo?.dispose(); [].concat(o.material || []).forEach(m => m.dispose()); });   // shared = cached model data
    map.below?.material.map.dispose(); scene.background?.dispose?.();
  }
  for (const b of map.bodies) if (b.world) world.removeBody(b);
  faded.clear();
  Object.assign(map, { group: new THREE.Group(), bodies: [], syncs: [], movers: [], visuals: [], h: [], crates: [], items: [], spawns: null, slippery: false, smokeDrift: null, pickupT: 3, moverT: 0, bounds: [18, 18], deco: null, killY: -14, spawnY: 3 });
  scene.add(map.group);
  world.gravity.y = -25;
}
const col = () => {
  const c = pick(map.theme.cols), tex = patternTex(map.theme.tex);
  return map.theme.glow ? mat(c, { map: tex, emissive: c, emissiveMap: tex, emissiveIntensity: 0.9 }) : mat(c, { map: tex });
};
// geo can also be a ready-made Object3D (detailed set-piece models); visualOffset shifts it from the collider centre.
function addBody(shape, geo, material, [x, y, z], { mass = 0, kinematic = false, sync = false, group = G_MAP, yaw = 0, visualOffset = [0, 0, 0] } = {}) {
  const body = new CANNON.Body({ mass, shape, material: world.defaultMaterial, position: new CANNON.Vec3(x, y, z), collisionFilterGroup: group, ...(kinematic && { type: KINEMATIC }) });
  if (yaw) body.quaternion.setFromEuler(0, yaw, 0);
  const mesh = geo.isObject3D ? geo : new THREE.Mesh(geo, typeof material === 'string' ? mat(material) : material);
  mesh.position.set(x + visualOffset[0], y + visualOffset[1], z + visualOffset[2]); mesh.rotation.y = yaw;
  if (!geo.isObject3D) mesh.castShadow = mesh.receiveShadow = true;
  world.addBody(body); map.bodies.push(body); map.group.add(mesh);
  if (mass || kinematic || sync) map.syncs.push([mesh, body]);
  return body;
}
// sides of platforms are drawn darker than the top so shapes read clearly
function shade(m) {
  m = typeof m === 'string' ? mat(m) : m;
  const s = m.clone(); s.color = m.color.clone().multiplyScalar(0.68); s.emissiveIntensity *= 0.5;
  return [m, s];
}
const addBox = (w, h, d, pos, material = col(), opts) => {
  const [top, side] = shade(material);
  return addBody(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)), boxGeo(w, h, d), [side, side, top, side, side, side], pos, opts);
};
const addCyl = (r, h, pos, material = col(), opts) => {
  const [top, side] = shade(material);
  return addBody(new CANNON.Cylinder(r, r, h, 32), scaledUV(new THREE.CylinderGeometry(r, r, h, 32), r * 2 / 3), [side, top, side], pos, opts);
};
const addSphere = (r, pos, material = mat(pick(map.theme.cols), { roughness: 0.35 })) =>
  addBody(new CANNON.Sphere(r), scaledUV(new THREE.SphereGeometry(r, 28, 16), r), material, pos);
const addCrate = (x, y, z) => map.crates.push(addBox(0.9, 0.9, 0.9, [x, y, z], mat('#b07a3c', { map: patternTex('planks') }), { mass: 1.5, group: G_CRATE }));

// Platform tops stay within jump height (~1.2) of each other. Layouts may only use rand()/R()/pick() so online clients rebuild them identically.
const LAYOUTS = {
  Islands() {
    addBox(13, 1.5, 13, [0, -0.75, 0]);
    const n = Math.floor(R(5, 8));
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + R(-0.25, 0.25), s = R(6, 10), r = 6.5 + R(2, 3.5) + s / 2;
      addBox(s, 1.5, s, [Math.cos(a) * r, R(-1, 0.6) - 0.75, Math.sin(a) * r]);
    }
  },
  'Swiss Cheese'() {
    const n = Math.floor(R(8, 11)), s = 2.8;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = (i - (n - 1) / 2) * s, z = (j - (n - 1) / 2) * s;
      if (Math.hypot(x, z) > 6.5 && rand() < 0.25) continue;
      addBox(s - 0.06, 1, s - 0.06, [x, -0.5, z]);
    }
  },
  Spinner() {
    addCyl(13, 1.5, [0, -0.75, 0]);
    const spin = R(0.7, 1.2) * pick([-1, 1]);
    for (let k = 0; k < (rand() < 0.5 ? 2 : 1); k++) {
      const beam = addBox(25, 0.7, 0.7, [0, 0.6, 0], '#ff3b3b', { kinematic: true });
      beam.quaternion.setFromEuler(0, k * Math.PI / 2, 0);
      map.movers.push(() => { beam.angularVelocity.y = spin; });
    }
  },
  Elevators() {
    addBox(15, 1.5, 15, [0, -0.75, 0]);
    for (const s of [-1, 1]) {
      addBox(9, 1, 14, [s * 16.5, 3.5, 0]);
      const e = addBox(3.5, 0.5, 3.5, [s * 9.9, 0, R(-4, 4)], '#ffcc00', { kinematic: true }), sp = R(1.5, 2.5);
      map.movers.push(() => {
        const y = e.position.y;
        if (y > 3.75) e.velocity.y = -sp; else if (y < -0.25 || e.velocity.y === 0) e.velocity.y = sp;
      });
    }
  },
  Bridges() {
    for (const s of [-1, 1]) addBox(12, 1.5, 12, [s * 12, -0.75, 0]);
    for (const z of [-4.5, 0, 4.5]) if (z || rand() < 0.6) addBox(12.4, 0.6, R(1.2, 2), [0, -0.32, z + R(-0.6, 0.6)]);   // 2cm lower so feet don't snag on the seam
    map.spawns = [[-12, -3], [12, 3], [-12, 3], [12, -3], [-9, 0], [9, 0], [-15, 0], [15, 0]];
  },
  'Tilting Pan'() {
    const pan = addCyl(12.5, 1, [0, -0.5, 0], mat('#3d3d45', { map: patternTex('metal'), roughness: 0.4, metalness: 0.4 }), { kinematic: true });
    addBox(2.4, 0.6, 10, [0, -0.5, 17.7], '#3b2a20');
    const amp = R(0.1, 0.16), w = R(0.5, 0.8), axis = pick(['x', 'z']);
    map.movers.push(t => { pan.angularVelocity[axis] = amp * w * Math.cos(w * t); });
  },
  'Egg Carton'() {
    addBox(22, 1.5, 16, [0, -0.75, 0]);
    for (let i = -3; i <= 3; i++) for (let j = -2; j <= 2; j++) if (rand() > 0.3 && (i || j)) addSphere(1.25, [i * 3, -0.75, j * 3]);
  },
  Conveyors() {
    for (const s of [-1, 1]) addBox(10, 1.5, 16, [s * 14.5, -0.75, 0]);
    for (const z of [-5, 0, 5]) {
      const p = addBox(5, 0.6, 3.5, [0, -0.3, z], '#ffcc00', { kinematic: true }), w = R(0.5, 0.9), ph = rand() < 0.5 ? 0 : Math.PI;
      map.movers.push(t => { p.velocity.x = 5 * w * Math.cos(w * t + ph); });
    }
    map.spawns = [[-14, -4], [14, 4], [-14, 4], [14, -4], [-12, 0], [12, 0], [-16, 0], [16, 0]];
  },
  Crumble() {
    const n = 9, s = 2.6;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 || i === n - 1) && (j === 0 || j === n - 1)) continue;
      const b = addBox(s - 0.05, 0.8, s - 0.05, [(i - 4) * s, -0.4, (j - 4) * s], undefined, { sync: true });
      b.crumble = true; b.baseX = b.position.x;
    }
  },
};
const SP_API = { THREE, CANNON, map, addBody, addBox, addCyl, mat, toon, patternTex, boxGeo, R, pick, rnd: () => rand(), fx, banner: (...a) => banner(...a), KINEMATIC, model, players: () => players, world, renderer, explode }, SET_PIECES = createSetPieces(SP_API);
const LAYOUT_HINTS = { Crumble: 'Tiles fall after you step on them!', 'Tilting Pan': "Don't slide off!", Conveyors: 'Ride the moving platforms', Elevators: 'Take the lifts up', Spinner: 'Jump the beam!' };

function buildMap(theme, layout) {
  map.theme = theme; clearMap();
  scene.background = skyTex(theme.sky, theme.fog);
  scene.fog = new THREE.Fog(theme.fog, 55, 160);
  const wt = patternTex(theme.belowTex || 'waves').clone(); wt.repeat.setScalar(theme.belowTex ? 40 : 60);
  const glow = theme.glow || theme.glowBelow;
  map.below = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mat(theme.below, { map: wt, ...(glow && { emissive: theme.below, emissiveIntensity: 0.7 }) }));
  map.below.rotation.x = -Math.PI / 2; map.below.position.y = theme.belowY ?? -22; map.group.add(map.below);
  map.scrollBelow = !theme.belowTex;
  map.slippery = !!theme.slippery;
  layout();
}
function addDeco(theme) {
  const g = map.deco = new THREE.Group(); map.group.add(g);
  const glow = theme.glow || theme.glowBelow;
  const m = glow ? mat(theme.cols[0], { emissive: theme.cols[0], emissiveIntensity: 0.8 }) : new THREE.MeshLambertMaterial({ color: '#ffffff' });
  for (let i = 0; i < 14; i++) {
    const cl = new THREE.Group(), a = rand() * Math.PI * 2, r = R(38, 75);
    cl.position.set(Math.cos(a) * r * 1.4, R(-6, 18), Math.sin(a) * r * 1.4);
    for (let j = 0; j < 4; j++) {
      const s = new THREE.Mesh(glow ? new THREE.OctahedronGeometry(R(1, 2.2)) : new THREE.SphereGeometry(R(2, 4), 14, 10), m);
      s.position.set(R(-3.5, 3.5), R(-0.8, 0.8), R(-2, 2)); cl.add(s);
    }
    g.add(cl);
  }
}

const part = (g, geo, m, x, y, z, rx = 0) => {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = o.receiveShadow = true; g.add(o); return o;
};
// [collider radius, height, builder]
const PROPS = {
  barrel: [0.45, 1, g => { part(g, new THREE.CylinderGeometry(0.45, 0.45, 1, 16), toon('#8b5a2b'), 0, 0.5, 0); for (const y of [0.2, 0.8]) part(g, new THREE.TorusGeometry(0.46, 0.04, 6, 20), toon('#333'), 0, y, 0, Math.PI / 2); }],
  post: [0.2, 1.1, g => { part(g, new THREE.CylinderGeometry(0.2, 0.22, 1.1, 12), toon('#5a3a22'), 0, 0.55, 0); part(g, new THREE.TorusGeometry(0.23, 0.06, 6, 16), toon('#d8c08a'), 0, 0.75, 0, Math.PI / 2); }],
  lollipop: [0.2, 1.7, g => { part(g, new THREE.CylinderGeometry(0.05, 0.05, 1.3, 8), toon('#ffffff'), 0, 0.65, 0); const c = pick(['#ff5a8a', '#4dd4ff', '#ffd93d', '#a66bff']); part(g, new THREE.CylinderGeometry(0.45, 0.45, 0.14, 24), toon(c), 0, 1.35, 0, Math.PI / 2); part(g, new THREE.TorusGeometry(0.25, 0.05, 6, 20), toon('#ffffff'), 0, 1.35, 0.08); }],
  gumdrop: [0.45, 0.7, g => { const m = part(g, new THREE.SphereGeometry(0.45, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon(pick(['#ff5a5a', '#6bcb77', '#ffa94d', '#ff7ad9'])), 0, 0, 0); m.scale.y = 1.5; }],
  pillar: [0.3, 2.4, g => { const c = pick(['#ff2e88', '#2ef2ff', '#8a2eff']); part(g, new THREE.BoxGeometry(0.5, 2.4, 0.5), mat('#222', { emissive: c, emissiveIntensity: 0.6 }), 0, 1.2, 0); part(g, new THREE.SphereGeometry(0.3, 12, 10), mat(c, { emissive: c, emissiveIntensity: 1.5 }), 0, 2.6, 0); }],
  snowman: [0.5, 1.6, g => { const w = toon('#ffffff'); part(g, new THREE.SphereGeometry(0.5, 16, 12), w, 0, 0.45, 0); part(g, new THREE.SphereGeometry(0.36, 16, 12), w, 0, 1.08, 0); const n = part(g, new THREE.ConeGeometry(0.06, 0.3, 8), toon('#ff8c1a'), 0, 1.1, 0.45, Math.PI / 2); n.castShadow = false; for (const s of [-1, 1]) part(g, new THREE.SphereGeometry(0.04, 6, 6), toon('#111'), s * 0.12, 1.2, 0.32); }],
  crystal: [0.35, 1.4, g => { const m = mat('#9fd8ff', { emissive: '#4aa8f0', emissiveIntensity: 0.3, transparent: true, opacity: 0.85, roughness: 0.1 }); part(g, new THREE.ConeGeometry(0.35, 1.4, 6), m, 0, 0.7, 0); for (const a of [0, 2.1, 4.2]) { const c = part(g, new THREE.ConeGeometry(0.15, 0.7, 6), m, Math.cos(a) * 0.35, 0.3, Math.sin(a) * 0.35); c.rotation.z = 0.4; } }],
  toxicBarrel: [0.45, 1, g => { part(g, new THREE.CylinderGeometry(0.45, 0.45, 1, 16), toon('#e8c400'), 0, 0.5, 0); part(g, new THREE.CylinderGeometry(0.4, 0.4, 0.02, 16), mat('#7dff3a', { emissive: '#7dff3a', emissiveIntensity: 1.2 }), 0, 1.01, 0); part(g, new THREE.CylinderGeometry(0.46, 0.46, 0.18, 16), toon('#222'), 0, 0.5, 0); }],
  chimney: [0.45, 1.6, g => { part(g, boxGeo(0.8, 1.6, 0.8), mat('#b0583e', { map: patternTex('brick') }), 0, 0.8, 0); part(g, new THREE.BoxGeometry(0.95, 0.2, 0.95), toon('#3a2a24'), 0, 1.65, 0); }],
  shaker: [0.3, 1.05, g => { const salt = rand() < 0.5; part(g, new THREE.CylinderGeometry(0.3, 0.32, 0.8, 16), mat(salt ? '#f5f5f5' : '#3a3a3a', { roughness: 0.2 }), 0, 0.4, 0); part(g, new THREE.SphereGeometry(0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#c0c4cc', { metalness: 0.7, roughness: 0.3 }), 0, 0.8, 0); }],
  hay: [0.55, 0.8, g => { part(g, boxGeo(1.1, 0.8, 0.8), mat('#e2b84a', { map: patternTex('grass') }), 0, 0.4, 0); for (const x of [-0.3, 0.3]) part(g, new THREE.BoxGeometry(0.05, 0.82, 0.82), toon('#8b5a2b'), x, 0.4, 0); }],
  apple: [0.6, 1.3, g => g.add(model('food/apple', 1.3))],
  cheese: [0.9, 0.8, g => g.add(model('food/cheese', 1.8, 'x'))],
  mug: [0.6, 1.4, g => g.add(model('food/mug', 1.4))],
  eggcup: [0.45, 1, g => g.add(model('food/egg-cup', 1))],
  kbarrel: [0.5, 1.2, g => g.add(model('food/barrel', 1.2))],
  tank: [0.9, 1.6, g => g.add(model('industrial/detail-tank', 1.6))],
  kchimney: [0.6, 1.8, g => g.add(model('industrial/chimney-small', 1.8))],
  cone: [0.3, 0.9, g => g.add(model('roads/construction-cone', 0.9))],
  pumpkin: [0.5, 0.8, g => { const p = part(g, new THREE.SphereGeometry(0.5, 16, 12), toon('#ff8c1a'), 0, 0.38, 0); p.scale.y = 0.75; part(g, new THREE.CylinderGeometry(0.05, 0.07, 0.2, 8), toon('#4f7a2a'), 0, 0.8, 0); }],
};
const THEME_PROPS = {
  'Sunny Docks': ['kbarrel', 'post', 'barrel'], 'Candy Land': ['lollipop', 'gumdrop'], 'Neon Night': ['pillar'], 'Frosty Peaks': ['snowman', 'crystal'],
  'Toxic Factory': ['toxicBarrel', 'tank', 'cone'], 'Lava Rooftops': ['chimney', 'kchimney'], 'Breakfast Kitchen': ['shaker', 'apple', 'cheese', 'mug', 'eggcup'], Farmyard: ['hay', 'pumpkin'],
};
// random scenery + props never land on top of each other (seeded order, so online copies still match)
let taken = [];
const tooClose = (x, z, d, list = taken) => list.some(([a, b]) => Math.hypot(x - a, z - b) < d);
function addProps(theme, count) {
  const keepClear = map.spawns ? map.spawns.map(([x, z]) => [x, z]) : Array.from({ length: 8 }, (_, i) => [Math.cos(i / 8 * Math.PI * 2) * 5, Math.sin(i / 8 * Math.PI * 2) * 5]);
  for (let n = 0, tries = 0; n < count && tries < count * 8; tries++) {
    const x = R(-18, 18), z = R(-18, 18), hit = castDown(x, 20, z, -5);
    if (!hit || hit.body.type !== STATIC || hit.body.crumble || hit.body.isProp || Math.hypot(x, z) < 2.5 || keepClear.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 2.5) || tooClose(x, z, 2.4)) continue;
    const [r, h, build] = PROPS[pick(THEME_PROPS[theme.name])], y = hit.hitPointWorld.y, g = new THREE.Group();
    taken.push([x, z]);
    build(g); g.position.set(x, y, z); g.rotation.y = R(0, 6.28); map.group.add(g);
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(r, r, h, 12), material: world.defaultMaterial, position: new CANNON.Vec3(x, y + h / 2, z), collisionFilterGroup: G_MAP });
    body.isProp = true; world.addBody(body); map.bodies.push(body); n++;
  }
}

// Small non-solid touches so the classic arenas don't read as bare blocks: [model key or builder, size, edges only].
// Merged by batchStatic, so they cost almost nothing to draw. Seeded rand() keeps online copies identical.
const puddle = (color, glow) => g => { const p = new THREE.Mesh(new THREE.CircleGeometry(R(0.5, 0.9), 14), glow ? mat(color, { emissive: color, emissiveIntensity: 1.1, roughness: 0.1 }) : mat(color, { roughness: 0.05 })); p.rotation.x = -Math.PI / 2; p.position.y = 0.015; p.scale.x = R(1, 1.6); p.receiveShadow = true; g.add(p); };
const fence = g => { const w = toon('#9b6a3c'); for (const x of [-0.7, 0.7]) part(g, new THREE.BoxGeometry(0.1, 0.8, 0.1), w, x, 0.4, 0); for (const y of [0.3, 0.62]) part(g, new THREE.BoxGeometry(1.6, 0.08, 0.05), w, 0, y, 0); };
const acUnit = g => { part(g, new THREE.BoxGeometry(0.9, 0.55, 0.7), toon('#c9ccd2'), 0, 0.28, 0); const f = part(g, new THREE.CylinderGeometry(0.24, 0.24, 0.03, 14), toon('#3a3d44'), 0, 0.57, 0); f.castShadow = false; };
const antenna = g => { part(g, new THREE.CylinderGeometry(0.03, 0.04, 1.8, 6), toon('#555b63'), 0, 0.9, 0); for (const y of [1.2, 1.5]) part(g, new THREE.BoxGeometry(0.6, 0.03, 0.03), toon('#555b63'), 0, y, 0); };
const neonStrip = g => { const c = pick(['#ff2e88', '#2ef2ff', '#ffe14d']); part(g, new THREE.BoxGeometry(1.4, 0.04, 0.12), mat(c, { emissive: c, emissiveIntensity: 2 }), 0, 0.02, 0); };
const pipe = g => { const p = part(g, new THREE.CylinderGeometry(0.12, 0.12, 2.2, 10), toon('#7d8a7a'), 0, 0.14, 0); p.rotation.z = Math.PI / 2; for (const x of [-0.8, 0.8]) part(g, new THREE.BoxGeometry(0.08, 0.16, 0.3), toon('#444'), x, 0.06, 0); };
const DETAILS = {
  'Sunny Docks': [['pirate/barrel', 0.9, 1], ['pirate/crate', 0.8, 1], ['pirate/crate-bottles', 0.7, 0], ['pirate/chest', 0.6, 1], ['pirate/cannon', 0.9, 1], [g => { const r = part(g, new THREE.TorusGeometry(0.28, 0.08, 6, 14), toon('#c9a26b'), 0, 0.08, 0); r.rotation.x = Math.PI / 2; }, 1, 0]],
  'Candy Land': [['food/cupcake', 0.6, 0], ['food/donut-sprinkles', 0.55, 0], ['food/sundae', 0.75, 1], ['food/cake-birthday', 0.8, 1], ['food/watermelon', 0.45, 0], ['food/pie', 0.5, 0]],
  'Neon Night': [[neonStrip, 1, 0], [neonStrip, 1, 0], ['roads/light-square', 2.2, 1], [puddle('#2ef2ff', true), 1, 0]],
  'Frosty Peaks': [['holiday/snow-pile', 1.4, 0], ['holiday/present-a-cube', 0.5, 0], ['holiday/present-b-rectangle', 0.5, 0], ['holiday/lantern', 1.2, 1], ['holiday/tree-snow-b', 1.8, 1], ['holiday/rocks-large', 0.7, 1]],
  'Toxic Factory': [['roads/construction-cone', 0.7, 0], ['roads/construction-barrier', 1, 1], ['industrial/detail-tank', 1.2, 1], [puddle('#7dff3a', true), 1, 0], [pipe, 1, 1]],
  'Lava Rooftops': [[acUnit, 1, 1], [antenna, 1, 1], ['industrial/chimney-small', 1.3, 1], [puddle('#3a3d44'), 1, 0]],
  'Breakfast Kitchen': [['food/egg-cooked', 0.9, 0], ['food/bacon', 0.9, 0], ['food/pancakes', 0.7, 1], ['food/cup-coffee', 0.55, 1], ['food/croissant', 0.6, 0], ['food/bread', 0.6, 0], ['food/plate', 0.9, 0], ['food/whisk', 0.8, 1]],
  Farmyard: [['coaster/flowers', 1.1, 0], ['coaster/grass', 0.9, 0], ['coaster/grass', 0.9, 0], ['platformer/flowers-tall', 0.9, 0], ['platformer/rocks', 0.9, 1], ['food/pumpkin', 0.6, 1], [fence, 1, 1], [fence, 1, 1]],
};
function addDetails(theme, count) {
  const list = DETAILS[theme.name]; if (!list) return;
  const keepClear = map.spawns ? map.spawns : Array.from({ length: 8 }, (_, i) => [Math.cos(i / 8 * Math.PI * 2) * 5, Math.sin(i / 8 * Math.PI * 2) * 5]);
  for (let n = 0, tries = 0; n < count && tries < count * 10; tries++) {
    const x = R(-20, 20), z = R(-20, 20), hit = castDown(x, 20, z, -5);
    if (!hit || hit.body.type !== STATIC || hit.body.crumble || hit.body.isProp || hit.body.hazard || keepClear.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 1.8)) continue;
    const y = hit.hitPointWorld.y, [k, size, edgeOnly] = pick(list);
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !castDown(x + a * 1.2, y + 1, z + b * 1.2, y - 0.6));
    if ((edgeOnly && !edge) || tooClose(x, z, 1.6)) continue;
    taken.push([x, z]);
    const g = typeof k === 'function' ? new THREE.Group() : model(k, size * R(0.85, 1.15), 'max');
    if (typeof k === 'function') k(g);
    g.position.set(x, y, z); g.rotation.y = R(0, 6.28); map.group.add(g); n++;
  }
}
// a lip along the top edges of the big solid platforms (classic arenas): shapes read much better than bare blocks
function addTrim(theme) {
  if (!theme.trim) return;
  const m = theme.trim === 'hazard' ? mat('#ffcc00', { map: patternTex('hazard') }) : theme.glow ? mat(theme.trim, { emissive: theme.trim, emissiveIntensity: 1.6 }) : toon(theme.trim);
  for (const b of [...map.bodies]) {
    if (b.type !== STATIC || b.crumble || b.isProp || b.hazard || Math.abs(b.quaternion.y) > 1e-3) continue;
    const s = b.shapes[0];
    if (s instanceof CANNON.Box) {
      const { x: hx, y: hy, z: hz } = s.halfExtents, top = b.position.y + hy, { x, z } = b.position;
      if (hx < 1.5 || hz < 1.5) continue;
      for (const sz of [-1, 1]) { const o = new THREE.Mesh(boxGeo(hx * 2 + 0.2, 0.16, 0.2), m); o.position.set(x, top, z + sz * hz); o.castShadow = o.receiveShadow = true; map.group.add(o); }
      for (const sx of [-1, 1]) { const o = new THREE.Mesh(boxGeo(0.2, 0.16, hz * 2 - 0.2), m); o.position.set(x + sx * hx, top, z); o.castShadow = o.receiveShadow = true; map.group.add(o); }
    } else if (s instanceof CANNON.Cylinder && s.radiusTop > 3) {
      const o = new THREE.Mesh(new THREE.TorusGeometry(s.radiusTop, 0.1, 6, 48), m); o.rotation.x = Math.PI / 2; o.position.set(b.position.x, b.position.y + s.height / 2, b.position.z); map.group.add(o);
    }
  }
}

// seed 0 = lobby. want = a set-piece name or MAP_CLASSIC (from the map vote), else random. Returns [name, hint].
function loadMap(seed, want = null) {
  map.seed = seed; map.want = want; taken = [];
  const info = withSeed(seed || 1, () => {
    if (!seed) {
      buildMap(THEMES[7], () => addBox(22, 1.5, 22, [0, -0.75, 0]));
      for (let i = 0; i < 6; i++) addCrate(R(-7, 7), 3 + i, R(-9, -5));
      addProps(THEMES[7], 8);
      addTrim(THEMES[7]); addDetails(THEMES[7], 26);
      addDeco(THEMES[7]);
      return ['Lobby', ''];
    }
    const big = rand() < 0.8;
    if (want ? want !== MAP_CLASSIC : big) {   // big hand-built maps with moving hazards
      const name = SET_PIECES[want] ? want : pick(Object.keys(SET_PIECES)), sp = SET_PIECES[name];
      buildMap(sp.theme, sp.build); map.bounds = sp.bounds;
      for (let i = 0; i < 4; i++) { const x = R(-0.7, 0.7) * sp.bounds[0], z = R(-0.7, 0.7) * sp.bounds[1], hit = castDown(x, 20, z, map.killY); if (hit) addCrate(x, hit.hitPointWorld.y + 6 + i, z); }
      return [name, sp.hint];
    }
    const theme = pick(THEMES), name = pick(Object.keys(LAYOUTS));
    buildMap(theme, LAYOUTS[name]);
    const n = Math.floor(R(3, 9));
    for (let i = 0; i < n; i++) { const x = R(-8, 8), z = R(-8, 8); if (castDown(x, 20, z, -5)) addCrate(x, 6 + i, z); }   // only over solid ground
    addProps(theme, Math.floor(R(8, 15)));
    addTrim(theme); addDetails(theme, Math.floor(R(22, 34)));
    addDeco(theme);
    SP_API.backdrop(theme.name, theme.belowY ?? -22);
    const extra = [LAYOUT_HINTS[name]];
    if (rand() < 0.2) { world.gravity.y = -13; extra.push('LOW GRAVITY!'); }
    if (map.slippery) extra.push('SLIPPERY!');
    return [`${theme.name} ${name}`, extra.filter(Boolean).join(' · ')];
  });
  addAmbient();
  if (lowPoly) lowify(map.group);   // bake the current look into the merged meshes
  if (!qs.has("nobatch")) batchStatic();   // ?nobatch: keep scenery separate (map audits)
  prewarm();
  return info;
}

// ---------- static batching ----------
// Scenery that never moves is merged into one mesh per material: draw calls drop from ~1000 to a few hundred.
// What moves is found by running the map's visuals at two different times / hazard states and comparing transforms, so trains,
// cranes, swaying trees and blinking lamps keep their own meshes and materials. Tall pieces on the camera side stay separate
// so they can still fade out when they hide an egg. ponytail: merged scenery keeps the look it had at load if Low-poly is toggled mid-map.
const bbox = new THREE.Box3(), bctr = new THREE.Vector3();
const sliceGeo = (geo, start, count) => {
  const out = new THREE.BufferGeometry();
  for (const n in geo.attributes) { const a = geo.attributes[n]; out.setAttribute(n, new THREE.BufferAttribute(a.array.slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize, a.normalized)); }
  return out;
};
function batchStatic() {
  const g = map.group, syncRoots = new Set(map.syncs.map(s => s[0])), cand = [];
  g.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o === map.below || o.morphTargetInfluences) return;
    for (let q = o; q && q !== g; q = q.parent) if (syncRoots.has(q) || !q.visible) return;
    if ([].concat(o.material).some(m => m.transparent || m.isShaderMaterial)) return;
    cand.push(o);
  });
  const mats = [...new Set(cand.flatMap(o => [].concat(o.material)))];
  const mstate = () => mats.map(m => [m.color?.getHex(), m.emissive?.getHex(), m.emissiveIntensity, m.opacity, m.visible].join());
  const shown = o => { for (let q = o; q && q !== g; q = q.parent) if (!q.visible) return false; return true; };
  const snap = () => { g.updateMatrixWorld(true); return cand.map(o => [o.matrixWorld.clone(), shown(o)]); };
  const realH = map.h, frozen = map.frozen;
  const run = (h, t, dt) => { map.h = h; for (const v of map.visuals) try { v(h, t, dt); } catch {} };
  map.frozen = false;
  const s0 = snap(), m0 = mstate();
  run(new Array(32).fill(0), 0.37, 0.05); const s1 = snap(), m1 = mstate();
  run(new Array(32).fill(0.7), 2.93, 0.3); const s2 = snap(), m2 = mstate();
  map.h = realH; map.frozen = frozen;
  const same = (a, b) => a[1] === b[1] && a[0].elements.every((e, i) => Math.abs(e - b[0].elements[i]) < 1e-4);
  const animated = new Set(mats.filter((m, i) => m0[i] !== m1[i] || m1[i] !== m2[i]));
  const key = m => animated.has(m) ? m.uuid
    : [m.type, m.color?.getHex(), m.emissive?.getHex(), m.emissiveIntensity, m.map?.uuid, m.emissiveMap?.uuid, m.gradientMap?.uuid, m.roughness, m.metalness, m.side, m.flatShading, m.vertexColors, m.fog].join();
  const buckets = new Map(), used = [];
  cand.forEach((o, i) => {
    if (!same(s0[i], s1[i]) || !same(s1[i], s2[i]) || o.matrixWorld.determinant() < 0) return;
    bbox.setFromObject(o); bbox.getCenter(bctr);
    if (!(bbox.max.y < 1.6 || bctr.z < -3 || Math.hypot(bctr.x, bctr.z) > 40)) return;   // could hide an egg: keep it fadeable
    const geo = o.geometry; if (Array.isArray(o.material) && !geo.groups.length) return;
    const flat = (geo.index ? geo : geo.clone().setIndex([...Array(geo.attributes.position.count).keys()])).toNonIndexed().applyMatrix4(o.matrixWorld);
    const attrs = Object.keys(flat.attributes).sort().map(n => n + flat.attributes[n].itemSize + flat.attributes[n].array.constructor.name + flat.attributes[n].normalized).join();
    const parts = Array.isArray(o.material) ? flat.groups.map(gr => [sliceGeo(flat, gr.start, gr.count), o.material[gr.materialIndex]]) : [[flat, o.material]];
    for (const [pg, m] of parts) {
      const k = key(m) + '|' + attrs + '|' + o.castShadow + o.receiveShadow;
      let b = buckets.get(k); if (!b) buckets.set(k, b = { m, geos: [], cast: o.castShadow, recv: o.receiveShadow });
      b.geos.push(pg);
    }
    used.push(o);
  });
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos); if (!merged) { console.warn('batch merge failed'); continue; }
    const mesh = new THREE.Mesh(merged, b.m); mesh.castShadow = b.cast; mesh.receiveShadow = b.recv;
    mesh.userData.batched = true; mesh.raycast = () => {};   // never fades, never slows the occlusion rays
    g.add(mesh);
  }
  for (const o of used) o.removeFromParent();
  const still = new Set(); g.traverse(o => { if (o.isMesh) { still.add(o.geometry); [].concat(o.material).forEach(m => still.add(m)); } });
  for (const o of used) if (!o.userData.shared) { if (!still.has(o.geometry)) o.geometry.dispose(); [].concat(o.material).forEach(m => still.has(m) || m.dispose()); }
}

// Compile every shader this map can need now, behind the loading screen, instead of stalling mid-fight the first time
// an effect appears: map + eggs, the see-through copies used when scenery hides an egg, and the effect materials.
let warmScene = null;
const warmGeo = new THREE.BoxGeometry(0.01, 0.01, 0.01);
function prewarm() {
  if (!warmScene) {
    warmScene = new THREE.Scene();
    for (const m of [new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false }), new THREE.MeshBasicMaterial({ color: '#fff27a' }), toon('#ffffff'),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide })]) warmScene.add(new THREE.Mesh(warmGeo, m));
    warmScene.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthTest: false })));
    for (const k of ITEM_KINDS) warmScene.add(weaponMesh(k));
  }
  const fades = new THREE.Group();
  map.group.traverse(o => { if (o.isMesh && !o.userData.batched && o !== map.below && !o.isInstancedMesh && !o.isPoints) for (const m of [].concat(fadeMat(o))) fades.add(new THREE.Mesh(warmGeo, m)); });
  warmScene.add(fades);
  try { renderer.compile(warmScene, camera, scene); renderer.compile(scene, camera); } catch (e) { console.warn(e); }
  warmScene.remove(fades);
}

function spawnPoint(i, n) {
  if (map.spawns) { const [x, z, y = map.spawnY] = map.spawns[i % map.spawns.length]; return [x + (Math.random() - 0.5) * 0.6, y, z]; }
  const a = i / Math.max(n, 1) * Math.PI * 2;
  return [Math.cos(a) * 5, 3, Math.sin(a) * 5];
}

// ---------- items: weapon pickups + blaster shots ----------
let pickupDeck = [];
function spawnPickup() {
  const yolks = players.some(p => p.alive && p.yolk);
  if (!pickupDeck.length) {   // shuffled deck (Fisher-Yates): every item type turns up once per round of the deck
    pickupDeck = [...PICKUPS];
    for (let i = pickupDeck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pickupDeck[i], pickupDeck[j]] = [pickupDeck[j], pickupDeck[i]]; }
  }
  const kind = Math.random() < (yolks ? 0.5 : 0.15) ? 'shell' : pickupDeck.pop();
  for (let i = 0; i < 40; i++) {   // a free, flat spot: not on another item or wedged into scenery
    const x = (Math.random() * 2 - 1) * map.bounds[0], z = (Math.random() * 2 - 1) * map.bounds[1], hit = castDown(x, 15, z, map.killY);
    if (!hit || hit.body.type !== STATIC || hit.body.crumble || hit.body.hazard) continue;
    const y = hit.hitPointWorld.y, others = map.items.map(o => o.pos || o.body?.position).filter(Boolean).map(q => [q.x, q.z]);
    if (tooClose(x, z, 3, others) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => Math.abs((castDown(x + a, y + 1.5, z + b, y - 1)?.hitPointWorld.y ?? -99) - y) > 0.2)) continue;
    map.items.push({ kind, pos: new CANNON.Vec3(x, y + 0.8, z) });
    return;
  }
}
// a fallen egg leaves its spare shell where it last stood
function dropShell(p) {
  if (p.yolk || !p.lastGround || p.custom.enemy) return;
  map.items.push({ kind: 'shell', pos: new CANNON.Vec3(p.lastGround.x, p.lastGround.y - 0.1, p.lastGround.z) });
}
function updateItems(dt) {
  if ((state === 'round' || state === 'lobby') && (map.pickupT -= dt) <= 0) {
    map.pickupT = 7;
    if (map.items.filter(i => !WORLD_ITEMS.includes(i.kind)).length < 4) spawnPickup();
  }
  for (let i = map.items.length - 1; i >= 0; i--) {
    const it = map.items[i];
    if (it.kind === 'egg') {
      if (it.hitP) {
        const d = it.dir, t = it.hitP.body, tp = it.hitP, dx = -d.x, dz = -d.z;
        if ((tp.flags & 128) && dx * Math.sin(tp.yaw) + dz * Math.cos(tp.yaw) > 0.3) fx('block', t.position);   // shot into a raised guard
        else { t.applyImpulse(new CANNON.Vec3(d.x * 6 * t.mass, 3 * t.mass, d.z * 6 * t.mass)); tp.hurt(14); fx('eggHit', t.position); }
        it.hitP = null;
      }
      if ((it.life -= dt) <= 0) {
        fx('splat', it.body.position);
        world.removeBody(it.body); map.items.splice(i, 1);
      }
      continue;
    }
    if (it.kind === 'bomb') {
      if ((it.fuse -= dt) <= 0) { const q = it.body.position; explode([q.x, q.y, q.z], 3.6, 24); world.removeBody(it.body); map.items.splice(i, 1); }
      continue;
    }
    if (it.kind === 'peel') {
      it.safeT -= dt;
      const p = players.find(q => q.alive && !q.hang && !(q.ko > 0) && (it.safeT <= 0 || q !== it.owner) && Math.hypot(q.body.position.x - it.pos.x, q.body.position.z - it.pos.z) < 0.9 && Math.abs(q.body.position.y - it.pos.y) < 1.4);
      if (p) {   // whoops: feet fly forward, egg lands on its back
        const v = p.body.velocity, l = Math.hypot(v.x, v.z) || 1, f = l > 1 ? { x: v.x / l, z: v.z / l } : p.facing();
        fx('slip', p.body.position); p.hurt(6, 1.4); if (p.alive) p.body.velocity.set(f.x * 9, 7, f.z * 9);
        map.items.splice(i, 1);
      } else if ((it.life -= dt) <= 0) map.items.splice(i, 1);
      continue;
    }
    const shell = it.kind === 'shell', pepper = it.kind === 'pepper';   // shells are only for yolks, weapons only for eggs
    if (it.noPickT > 0) it.noPickT -= dt;   // you can't instantly re-grab what you just dropped
    const p = players.find(q => q.alive && !(q.ko > 0) && !q.custom.enemy && (shell ? q.yolk : pepper ? !q.yolk : !q.yolk && !q.weapon) && !(it.noPick === q && it.noPickT > 0) && q.body.position.distanceTo(it.pos) < 1.3);
    if (!p) continue;
    if (shell) p.regainShell();
    else if (pepper) { p.boostT = 9; fx('fire', p.body.position); }   // fired up: faster, harder hits
    else { p.weapon = it.kind; p.ammo = it.ammo || WEAPONS[it.kind].uses; }
    fx('pickup', it.pos); map.items.splice(i, 1);
  }
}
const itemRow = it => { const p = it.body?.position || it.pos; return [ITEM_KINDS.indexOf(it.kind), r3(p.x), r3(p.y), r3(p.z)]; };
const itemMeshes = [];
function renderItems(rows, t) {
  rows.forEach(([k, x, y, z], i) => {
    let m = itemMeshes[i];
    if (!m || m.k !== k) {
      if (m) scene.remove(m);
      m = itemMeshes[i] = new THREE.Group(); m.k = k;
      const w = weaponMesh(ITEM_KINDS[k]);
      if (!WORLD_ITEMS.includes(ITEM_KINDS[k])) {   // pickup: tilted weapon (or upright shell/pepper) spinning over a glowing ring
        const shell = ITEM_KINDS[k] === 'shell', glow = shell ? '#7dff9a' : ITEM_KINDS[k] === 'pepper' ? '#ff7a3a' : '#fff27a';
        const spin = new THREE.Group(); w.rotation.z = shell || ITEM_KINDS[k] === 'pepper' ? 0 : 2.4; w.scale.setScalar(shell ? 1.2 : 1.8); spin.add(w); m.add(spin);
        if (ITEM_KINDS[k] === 'pan') { w.rotation.set(-1.15, 0, 0.3); w.position.y = 0.35; }   // edge-on it just looked like a grey blade: show the cooking face
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.07, 8, 32), new THREE.MeshBasicMaterial({ color: glow }));
        ring.rotation.x = Math.PI / 2; ring.position.y = -0.7; m.add(ring);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 4, 16, 1, true), new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.y = 1.3; m.add(beam);
      } else m.add(w);
      scene.add(m);
    }
    const still = WORLD_ITEMS.includes(ITEM_KINDS[k]);
    m.position.set(x, y + (still ? 0 : Math.sin(t * 3 + i) * 0.15), z);
    if (!still) m.children[0].rotation.y = t * 2.5;
    if (ITEM_KINDS[k] === 'bomb') m.scale.setScalar(1 + (Math.sin(t * 30) > 0 ? 0.15 : 0));
  });
  while (itemMeshes.length > rows.length) scene.remove(itemMeshes.pop());
}

// ---------- input ----------
const keys = new Set();
const KB = {
  kb1: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', punch: 'KeyJ', grab: 'KeyK', drop: 'KeyL', block: 'KeyI' },   // right hand on J/K/I/L, away from WASD
  kb2: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', jump: 'ShiftRight', punch: 'Period', grab: 'Slash', drop: 'Semicolon', block: 'Quote' },
};
const NONE = { x: 0, z: 0, jump: false, punch: false, grab: false, drop: false, block: false };

function readLocal(ctrl) {
  if (ctrl === 'touch') return touchIn;
  if (ctrl.startsWith('pad')) {
    const gp = navigator.getGamepads()[+ctrl.slice(3)];
    if (!gp) return NONE;
    const dz = v => (Math.abs(v) < 0.2 ? 0 : v), btn = i => !!gp.buttons[i]?.pressed;
    return {
      x: dz(gp.axes[0]) || btn(15) - btn(14), z: dz(gp.axes[1]) || btn(13) - btn(12),
      jump: btn(0), punch: btn(2), drop: btn(3), grab: btn(1) || btn(5) || btn(7), block: btn(4) || btn(6),
    };
  }
  const m = KB[ctrl], k = c => [].concat(c).some(x => keys.has(x));
  return { x: k(m.right) - k(m.left), z: k(m.down) - k(m.up), jump: k(m.jump), punch: k(m.punch), grab: k(m.grab), drop: k(m.drop), block: k(m.block) };
}
function readInput(p) {
  if (state === 'countdown') return NONE;
  if (p.ctrl === 'bot') return botInput(p);
  if (p.ctrl.includes('/')) return net.inputs[p.ctrl] || NONE;   // remote player: latest input from their PC
  return readLocal(p.ctrl);
}

// ponytail: bots chase the nearest player, grab ledges when falling and fetch nearby weapons; no real pathfinding
function botInput(p) {
  const me = p.body.position, inp = { ...NONE };
  p.bot ??= { grabT: 0, stuck: 0, leap: 0 };
  if (p.hang) { inp.grab = true; inp.jump = Math.random() < 0.04; return inp; }
  if (p.heldBy) { inp.punch = Math.random() < 0.3; return inp; }   // grabbed: struggle
  if (!(p.flags & 4) && p.body.velocity.y < 1) inp.grab = true;   // airborne: try to catch a ledge
  let tgt = null, bd = Infinity;
  for (const o of players) if (o !== p && o.alive && o.body.position.y > -3 && (mode !== 'endless' || !o.custom.enemy !== !p.custom.enemy)) {
    const d = o.body.position.distanceTo(me); if (d < bd) { bd = d; tgt = o; }
  }
  let goal = tgt?.body.position;
  if (p.yolk) { let sd = Infinity; for (const it of map.items) if (it.kind === 'shell' && it.pos.distanceTo(me) < sd) { sd = it.pos.distanceTo(me); goal = it.pos; } }
  else if (!p.weapon && !p.custom.enemy) for (const it of map.items) if (it.pos && PICKUPS.includes(it.kind) && it.pos.distanceTo(me) < Math.min(bd, 8)) goal = it.pos;
  if (!goal) return inp;
  const l = Math.hypot(goal.x - me.x, goal.z - me.z) || 1, dx = (goal.x - me.x) / l, dz = (goal.z - me.z) / l;
  p.bot.leap -= 1 / 60;
  if (castDown(me.x + dx * 1.3, me.y, me.z + dz * 1.3, me.y - 6) || l < 1.4 || p.bot.leap > 0) { inp.x = dx; inp.z = dz; p.bot.stuck = 0; inp.jump = p.bot.leap > 0; }
  else if ((p.bot.stuck += 1 / 60) > 1 + Math.random() * 2) { inp.x = dx; inp.z = dz; inp.jump = true; p.bot.leap = 0.6; p.bot.stuck = 0; }
  if (goal.y > me.y + 1 && Math.random() < 0.05) inp.jump = true;
  // pushing into a crate or another egg and not getting anywhere: punch it aside and sidestep with a hop
  const moving = Math.hypot(p.body.velocity.x, p.body.velocity.z);
  p.bot.slow = (inp.x || inp.z) && moving < 1.2 && l > 1.6 && (p.flags & 4) ? (p.bot.slow || 0) + 1 / 60 : 0;
  if (p.bot.slow > 0.45) { p.bot.slow = 0; p.bot.side = 0.7; p.bot.sideDir = Math.random() < 0.5 ? 1 : -1; inp.jump = true; if (!p.weapon && p.attackT < 0) inp.punch = true; }
  if (p.bot.side > 0) { p.bot.side -= 1 / 60; const s = p.bot.sideDir; inp.x = dx * 0.4 - dz * s; inp.z = dz * 0.4 + dx * s; }
  if (bd < ({ blaster: 9, bombs: 7, banana: 3 }[p.weapon] || 2.1) && p.attackT < 0) { inp.punch = Math.random() < (p.custom.enemy ? Math.min(0.14, 0.035 + endless.wave * 0.008) : 0.08); if (inp.punch && Math.random() < 0.2) p.bot.chargeT = R(0.4, 1); }
  if (p.bot.chargeT > 0) { p.bot.chargeT -= 1 / 60; inp.punch = true; }   // sometimes hold punch for a charged hit
  if (bd < 2.2 && tgt?.attackT >= 0 && !p.custom.boss && Math.random() < 0.04) p.bot.guardT = 0.6;   // sometimes guard an incoming swing
  if (p.bot.guardT > 0) { p.bot.guardT -= 1 / 60; inp.block = true; inp.punch = false; }
  if (bd < 1.4 && Math.random() < 0.008) p.bot.grabT = 1.2;
  if (p.bot.grabT > 0) { p.bot.grabT -= 1 / 60; inp.grab = true; inp.punch = p.holding && p.bot.grabT < 0.3; }
  return inp;
}

// ---------- online (PeerJS: host simulates everything, clients send input and draw snapshots) ----------
const net = { mode: 'off', peer: null, conns: new Map(), conn: null, myId: '', inputs: {}, fx: [], sendT: 0, reqT: {}, presses: {}, items: [], pausers: new Map(), pauseText: '', tally: {} };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', ROOM = code => 'breakmyeggs-' + code.toUpperCase();
const status = (msg, code) => {
  const link = code && SITE_URL ? `${SITE_URL}?join=${code}` : '';
  $('netStatus').innerHTML = esc(msg) + (code ? ` <b id="code" title="Click to copy">${code}</b>` : '')
    + (link ? `<div class="joinqr"><img src="${qrImg(link)}" alt=""><span>${ic('smartphone')} Scan with a phone camera to join this room</span></div>` : '');
  $('code')?.addEventListener('click', () => navigator.clipboard?.writeText(code));
};
const owned = p => (net.mode === 'client' ? p.ctrl.startsWith(net.myId + '/') : !p.ctrl.includes('/'));
const localCtrl = p => p.ctrl.split('/').pop();
const broadcast = msg => { for (const c of net.conns.values()) if (c.open) c.send(msg); };
const toHost = msg => net.conn?.open && net.conn.send(msg);
const rosterMsg = () => ({ t: 'roster', mode, wave: endless.wave, left: endless.left, players: players.map(p => ({ id: p.id, ctrl: p.ctrl, custom: p.custom, wins: p.wins })) });
const r3 = v => Math.round(v * 1000) / 1000;

function setOnlineUI() {
  renderMode();
  $('hostBtn').hidden = $('joinRow').hidden = net.mode !== 'off';
  $('leaveBtn').hidden = net.mode === 'off';
  $('addBot').hidden = net.mode === 'client';
  $('start').hidden = net.mode === 'client';
  $('waitHost').hidden = net.mode !== 'client';
}

function hostOnline() {
  const code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  status('Starting online room…');
  const peer = net.peer = new Peer(ROOM(code));
  peer.on('open', () => { net.mode = 'host'; setOnlineUI(); status('Hosting! Friends join with code:', code); });
  peer.on('error', e => {
    if (e.type === 'unavailable-id') { peer.destroy(); return hostOnline(); }
    leaveOnline('Online error: ' + e.type);
  });
  peer.on('connection', conn => {
    conn.on('open', () => {
      net.conns.set(conn.peer, conn);
      conn.send(rosterMsg()); conn.send({ t: 'map', seed: map.seed, want: map.want }); conn.send(votesMsg());
      status(`Hosting · ${net.conns.size} friend(s) connected · code:`, code);
    });
    conn.on('data', d => onHostData(conn.peer, d));
    conn.on('close', () => {
      net.conns.delete(conn.peer); net.pausers.delete(conn.peer); votes.delete(conn.peer); votesChanged();
      players.filter(p => p.ctrl.startsWith(conn.peer + '/')).forEach(removePlayer);
      status(`Hosting · ${net.conns.size} friend(s) connected · code:`, code);
    });
  });
}

function onHostData(pid, d) {
  const ctrl = `${pid}/${d.ctrl}`, p = players.find(q => q.ctrl === ctrl);
  if (d.t === 'input') for (const k in d.inputs) net.inputs[`${pid}/${k}`] = d.inputs[k];
  else if (d.t === 'join' && state === 'lobby' && typeof d.ctrl === 'string') join(ctrl, sanitize(d.custom));
  else if (d.t === 'leave' && p) removePlayer(p);
  else if (d.t === 'custom' && p) { p.custom = sanitize(d.custom); p.rebuild(); rosterChanged(); }
  else if (d.t === 'vote' && mapChoices().includes(d.map)) { votes.set(pid, d.map); votesChanged(); }
  else if (d.t === 'pause') d.on && state !== 'lobby' ? net.pausers.set(pid, pcName(pid)) : net.pausers.delete(pid);
}

// remote players' customizations are untrusted: only keep known values (any #rrggbb colour, a small JPEG photo)
const HEX = /^#[0-9a-f]{6}$/i;
function sanitize(c = {}, trusted = false) {   // trusted = from the host's roster (may mark enemies / the boss)
  return {
    ...(trusted && c.enemy && { enemy: true, boss: !!c.boss }),
    name: String(c.name || 'Friend').slice(0, 12),
    color: HEX.test(c.color) ? c.color : COLORS[0], color2: HEX.test(c.color2) ? c.color2 : COLORS[2],
    pattern: PATTERNS.includes(c.pattern) ? c.pattern : 'Plain',
    ...(typeof c.photo === 'string' && c.photo.length < 60000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(c.photo) && { photo: c.photo }),
    ...(typeof c.paint === 'string' && c.paint.length < 120000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(c.paint) && { paint: c.paint }),
    hat: HATS.includes(c.hat) ? c.hat : 'None', face: FACES.includes(c.face) ? c.face : 'Dots',
    outfit: OUTFITS.includes(c.outfit) ? c.outfit : 'None',
  };
}

function joinOnline(code) {
  if (!/^[A-Z0-9]{5}$/i.test(code)) return status('Room codes are 5 letters/numbers.');
  status('Connecting…');
  const peer = net.peer = new Peer();
  peer.on('error', e => leaveOnline(e.type === 'peer-unavailable' ? 'Room not found. Check the code!' : 'Online error: ' + e.type));
  peer.on('open', id => {
    net.myId = id;
    const conn = net.conn = peer.connect(ROOM(code), { reliable: true });   // binary serialization: big messages (photo / drawn eggs in the roster) are split into chunks; JSON ones silently failed
    conn.on('open', () => {
      net.mode = 'client'; setOnlineUI(); myVote = null;
      if (net.autoJoin) { net.autoJoin = false; setTimeout(() => join(IS_TOUCH ? 'touch' : 'kb1'), 800); }   // came from a room QR
      players.forEach(p => p.remove()); players.length = 0;
      status('Connected to room', code.toUpperCase());
    });
    conn.on('data', onClientData);
    conn.on('close', () => leaveOnline('Disconnected from host.'));
  });
}

function onClientData(d) {
  if (d.t === 'roster') {
    const keep = new Set(d.players.map(e => e.id));
    players.filter(p => !keep.has(p.id)).forEach(p => p.remove());
    const next = d.players.map(e => {
      let p = players.find(q => q.id === e.id);
      if (!p) p = new Player(e.ctrl, sanitize(e.custom, true), e.id);
      else if (JSON.stringify(p.custom) !== JSON.stringify(sanitize(e.custom, true))) { p.custom = sanitize(e.custom, true); p.rebuild(); }
      p.wins = e.wins; return p;
    });
    players.splice(0, players.length, ...next);
    mode = d.mode || 'battle'; endless.wave = d.wave || 0; endless.left = d.left || 0;
    renderCards(); renderMode();
  } else if (d.t === 'map') {
    net.items = [];
    if (d.seed) loadWithScreen(d.seed, d.want); else { loadToken++; loadMap(0); hideLoading(); }
  } else if (d.t === 'unpause') {
    if (menuOpen && paused) closeMenu();
  } else if (d.t === 'votes') {
    net.tally = d.tally; renderVotes();
  } else if (d.t === 'banner') {
    showBanner(d.text, d.sub, d.secs);
  } else if (d.t === 'snap') {
    if (d.s !== state) { state = d.s; setUI(); }
    net.hostPaused = !!d.pz; net.pauseText = d.pz || '';
    for (const e of d.p) {
      const p = players.find(q => q.id === e[0]); if (!p) continue;
      const [, x, y, z, qx, qy, qz, qw, vx, vy, vz, yaw, flags, hp, attackT, attackKind, ko, stun, alive, weapon] = e;
      if (alive && !p.alive) p.spawn([x, y, z]);
      else if (!alive && p.alive) p.remove();
      p.tgt = { pos: new CANNON.Vec3(x, y, z), quat: new CANNON.Quaternion(qx, qy, qz, qw), yaw };
      p.body.velocity.set(vx, vy, vz);
      Object.assign(p, { flags, hp, attackT, attackKind, ko, stun, yolk: !!(flags & 32), weapon: ITEM_KINDS[weapon - 1] || null });
    }
    for (const [i, ...o] of d.o) { const s = map.syncs[i]; if (s) s.tgt = o; }
    net.items = d.i; map.h = d.h || [];
    for (const [name, x, y, z, color] of d.fx) fx(name, x === undefined ? null : { x, y, z }, color);
  }
}

function leaveOnline(msg = '') {
  const wasClient = net.mode === 'client';
  net.peer?.destroy();
  Object.assign(net, { mode: 'off', peer: null, conn: null, myId: '', inputs: {}, fx: [], items: [], pauseText: '', tally: {} });
  net.conns.clear(); net.pausers.clear(); votes.clear(); if (myVote) votes.set('host', myVote); votesChanged();
  if (wasClient) { players.forEach(p => p.remove()); players.length = 0; }
  else players.filter(p => p.ctrl.includes('/')).forEach(p => { p.remove(); players.splice(players.indexOf(p), 1); });
  setOnlineUI(); status(msg);
  toLobby();
}

function hostSend(dt) {
  if ((net.sendT += dt) < 1 / 30 || !net.conns.size) return;
  net.sendT = 0;
  broadcast({
    t: 'snap', s: state, pz: [...(paused ? [hostName()] : []), ...net.pausers.values()].join(', ') || 0, fx: net.fx.splice(0), i: map.items.map(itemRow), h: map.h.map(r3),
    p: players.map(p => {
      const b = p.body, q = b.quaternion, v = b.velocity;
      return [p.id, r3(b.position.x), r3(b.position.y), r3(b.position.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), r3(v.x), r3(v.y), r3(v.z),
        r3(p.yaw || 0), p.flags, Math.round(p.hp), r3(p.attackT), p.attackKind, r3(p.ko || 0), r3(p.stun || 0), p.alive ? 1 : 0,
        ITEM_KINDS.indexOf(p.weapon) + 1];
    }),
    // only moving map pieces (crates, lifts, falling/shaking tiles) need sending
    o: map.syncs.flatMap(([, b], i) => (b.type !== STATIC || b.crumbleT > 0) && b.world
      ? [[i, r3(b.position.x), r3(b.position.y), r3(b.position.z), r3(b.quaternion.x), r3(b.quaternion.y), r3(b.quaternion.z), r3(b.quaternion.w)]] : []),
  });
}

// clients: smooth toward the latest snapshot and send our controllers' input
function clientFrame(dt) {
  const k = 1 - Math.exp(-dt * 18);
  for (const p of players) {
    if (!p.alive || !p.tgt) continue;
    const b = p.body, g = p.tgt;
    if (b.position.distanceTo(g.pos) > 4) b.position.copy(g.pos);
    else b.position.vadd(g.pos.vsub(b.position).scale(k), b.position);
    b.quaternion.slerp(g.quat, k, b.quaternion);
    p.yaw = lerpAngle(p.yaw, g.yaw, k);
    if (p.attackT >= 0) p.attackT += dt;
    p.stun -= dt;
  }
  for (const s of map.syncs) {
    const o = s.tgt; if (!o) continue;
    const b = s[1];
    b.position.set(b.position.x + (o[0] - b.position.x) * k, b.position.y + (o[1] - b.position.y) * k, b.position.z + (o[2] - b.position.z) * k);
    b.quaternion.slerp(new CANNON.Quaternion(o[3], o[4], o[5], o[6]), k, b.quaternion);
  }
  const inputs = {};
  for (const p of players) if (owned(p)) {
    const c = localCtrl(p), inp = readLocal(c), pr = net.presses[c] ??= { prev: {}, jumpC: 0, punchC: 0, dropC: 0, grabC: 0 };
    if (inp.jump && !pr.prev.jump) pr.jumpC++;
    if (inp.punch && !pr.prev.punch) pr.punchC++;
    if (inp.drop && !pr.prev.drop) pr.dropC++;
    if (inp.grab && !pr.prev.grab) pr.grabC++;
    pr.prev = inp;
    inputs[c] = { ...inp, jumpC: pr.jumpC, punchC: pr.punchC, dropC: pr.dropC, grabC: pr.grabC };
  }
  if (Object.keys(inputs).length) toHost({ t: 'input', inputs });
}

// ---------- players & lobby UI ----------
const players = [];
const $ = id => document.getElementById(id);
const CTRL_NAMES = { kb1: ic('keyboard') + ' Keyboard 1', kb2: ic('keyboard') + ' Keyboard 2', bot: ic('robot-golem') + ' Bot', touch: ic('smartphone') + ' Touch' };
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

function loadCustom(ctrl, i) {
  try { const s = JSON.parse(localStorage.getItem('egg-' + ctrl)); if (s) return sanitize(s); } catch {}
  return sanitize({ name: `Egg ${i + 1}`, color: COLORS[(i * 3) % COLORS.length], color2: COLORS[(i * 3 + 5) % COLORS.length], pattern: PATTERNS[i % (PATTERNS.length - 1)] });   // never 'Photo' (last) without a photo
}
function saveCustom(p) {
  if (p.ctrl !== 'bot') try { localStorage.setItem('egg-' + localCtrl(p), JSON.stringify(p.custom)); } catch {}
}
const randomCustom = name => ({ name, color: pick(COLORS), color2: pick(COLORS), pattern: pick(PATTERNS.slice(0, -1)), hat: pick(HATS), face: pick(FACES.slice(0, -1)), outfit: pick(OUTFITS) });   // no Photo / None

function join(ctrl, custom) {
  if (net.mode === 'client') {   // ask the host to add us
    if (ctrl === 'bot' || players.some(p => p.ctrl === `${net.myId}/${ctrl}`) || net.reqT[ctrl] > performance.now() - 1000) return;
    net.reqT[ctrl] = performance.now();
    return toHost({ t: 'join', ctrl, custom: loadCustom(ctrl, players.length) });
  }
  if (players.length >= 8 || (ctrl !== 'bot' && players.some(p => p.ctrl === ctrl))) return;
  custom ??= ctrl === 'bot' ? randomCustom(pick(BOT_NAMES.filter(n => !players.some(p => p.custom.name === n)))) : loadCustom(ctrl, players.length);
  const p = new Player(ctrl, custom);
  players.push(p); p.spawn(spawnPoint(players.length - 1, 8));
  fx('join'); rosterChanged();
}
function removePlayer(p) {
  p.remove(); players.splice(players.indexOf(p), 1); rosterChanged();
}
function rosterChanged() {
  renderCards();
  if (net.mode === 'host') broadcast(rosterMsg());
}

// ---------- lobby cards + the egg editor ----------
let cardsDirty = false;
// a lit little stage for egg previews (lobby card pictures and the editor)
function previewScene() {
  const s = new THREE.Scene(), key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 4, 5); s.add(new THREE.HemisphereLight(0xffffff, 0x556677, 1.4), key);
  return s;
}
const POSE = { body: { velocity: { x: 0, y: 0, z: 0 } }, flags: 4, ko: 0, stun: 0, hp: 100, attackT: -1, attackKind: 0, weapon: null };
function poseModel(m) { for (let i = 0; i < 12; i++) animate(m, POSE, 0.05, i * 0.05); m.a.fidgetT = 1e9; }   // settle into the idle pose
// Pictures of each egg for the lobby cards, rendered off-screen once per look
const shot = { r: null, scene: null, cam: null, cache: new Map() };
const VIEWS = { body: [[1.1, 0.7, 5.4], [0, 0.08, 0], 28, 0.3], back: [[1.1, 0.7, 5.4], [0, 0.08, 0], 28, 2.6], head: [[0.5, 1.3, 2.7], [0, 0.88, 0], 32, 0.3], face: [[0.25, 0.45, 2.7], [0, 0.32, 0], 30, 0.15] };   // camera spot, look-at, fov, egg turn
function eggShot(c, view = 'body') {
  const key = view + JSON.stringify({ ...c, name: '' });
  if (shot.cache.has(key)) return Promise.resolve(shot.cache.get(key));
  if (!shot.r) {
    shot.r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); shot.r.setSize(200, 240, false);
    shot.scene = previewScene(); shot.cam = new THREE.PerspectiveCamera(28, 200 / 240, 0.1, 30);
  }
  const [pos, look, fov, yaw] = VIEWS[view]; shot.cam.position.set(...pos); shot.cam.lookAt(...look); shot.cam.fov = fov; shot.cam.updateProjectionMatrix();
  const m = buildModel(c); poseModel(m); m.group.rotation.y = yaw;
  return m.ready.then(() => {
    shot.scene.add(m.group); shot.r.render(shot.scene, shot.cam); shot.scene.remove(m.group); disposeModel(m);
    const url = shot.r.domElement.toDataURL('image/png');
    if (shot.cache.size > 150) shot.cache.delete(shot.cache.keys().next().value);
    shot.cache.set(key, url); return url;
  });
}
function renderCards() {
  if (document.activeElement?.dataset?.act === 'name') { cardsDirty = true; return; }   // don't wipe a name being typed
  cardsDirty = false;
  $('cards').innerHTML = players.map((p, i) => {
    const mine = owned(p), c = p.custom;
    const label = !mine ? ic('globe') + ' Online' : CTRL_NAMES[localCtrl(p)] || ic('gamepad') + ' Controller ' + (+localCtrl(p).slice(3) + 1);
    return `<div class="card ${mine ? '' : 'remote'}" style="--c:${c.color}" data-i="${i}">
      <div class="chead"><span class="who">${label}</span>${mine || net.mode === 'host' ? `<button class="x" data-act="remove" title="Remove">${ic('cancel')}</button>` : ''}</div>
      <div class="pic"><img class="eggpic" alt="" data-i="${i}"></div>
      ${mine ? `<input data-act="name" maxlength="12" value="${esc(c.name)}" aria-label="Name">
      <div class="cbtns"><button class="edit" data-act="edit">${ic('palette')} Customize</button><button class="dice" data-act="random" title="Random look">${ic('dice-six-faces-five')}</button></div>`
      : `<div class="rname">${esc(c.name)}</div>`}
    </div>`;
  }).join('') + (players.length < 8 ? `<div class="card empty"><div class="plus">+</div><div>${IS_TOUCH ? 'Tap here<br>to join!' : 'Press <kbd>Space</kbd> <kbd>.</kbd> or <kbd>A</kbd><br>to join'}</div></div>` : '');
  players.forEach((p, i) => eggShot(p.custom).then(url => { const img = $('cards').querySelector(`img.eggpic[data-i="${i}"]`); if (img && players[i] === p) img.src = url; }));
  $('start').disabled = mode === 'endless' ? !players.some(p => p.ctrl !== 'bot') : players.length < 2;
  $('contBtn').disabled = $('start').disabled;
}

function customChanged(p) {
  p.rebuild(); saveCustom(p);
  if (net.mode === 'client') toHost({ t: 'custom', ctrl: localCtrl(p), custom: p.custom });
  else rosterChanged();
  renderCards();
}

$('cards').addEventListener('click', e => {
  if (IS_TOUCH && e.target.closest('.card.empty')) return join('touch');
  const act = e.target.dataset.act, card = e.target.closest('.card'), p = card && players[card.dataset.i];
  if (!act || !p || act === 'name') return;
  playSfx(act === 'remove' ? 'ui_back' : 'ui_select');
  e.target.blur();
  if (act === 'remove') return net.mode === 'client' ? toHost({ t: 'leave', ctrl: localCtrl(p) }) : removePlayer(p);
  if (!owned(p)) return;
  if (act === 'edit') return openEditor(p);
  if (act === 'random') { Object.assign(p.custom, randomCustom(p.custom.name)); customChanged(p); }
});
$('cards').addEventListener('change', e => {
  const p = players[e.target.closest('.card')?.dataset.i];
  if (e.target.dataset.act !== 'name' || !p) return;
  p.custom.name = e.target.value.trim() || 'Nobody';
  e.target.blur(); customChanged(p);
});
$('cards').addEventListener('focusout', () => setTimeout(() => cardsDirty && renderCards()));

// The egg editor: a big live egg you can spin (and draw on), with tabs for every part of the look.
const ED_TABS = [['color', 'palette', 'Colors'], ['pattern', 'round-star', 'Pattern'], ['face', 'eyeball', 'Face'], ['hat', 'top-hat', 'Hat'], ['outfit', 't-shirt', 'Outfit'], ['photo', 'photo-camera', 'Photo'], ['draw', 'pencil', 'Draw']];
const BRUSHES = ['#15151a', '#ffffff', '#ff3b3b', '#ff9f1c', '#ffd93d', '#2ecc71', '#4dd4ff', '#3d6bff', '#a66bff', '#ff7ad9', '#8b5a2b', '#9aa3ad'];
const ed = { p: null, r: null, scene: null, cam: null, m: null, yaw: 0.3, tab: 'color', paint: null, undo: [], tool: 'brush', brush: '#15151a', size: 0.05, spin: false, crop: null, raf: 0, last: 0 };
const edOpen = () => !$('eggEd').hidden;
function openEditor(p) {
  ed.p = p; ed.c = JSON.parse(JSON.stringify(p.custom)); ed.tab = 'color'; ed.crop = null; ed.undo = []; ed.spin = false; ed.yaw = 0.3;   // edit a copy: the real egg only changes on Done
  ed.paint = document.createElement('canvas'); ed.paint.width = 512; ed.paint.height = 256;
  if (p.custom.paint) { const img = new Image(); img.onload = () => { ed.paint.getContext('2d').drawImage(img, 0, 0, 512, 256); if (ed.m) composeShell(ed.m); }; img.src = p.custom.paint; }
  if (!ed.r) {
    ed.r = new THREE.WebGLRenderer({ canvas: $('edCv'), antialias: true, alpha: true });
    ed.scene = previewScene(); ed.cam = new THREE.PerspectiveCamera(26, 1, 0.1, 30);
  }
  $('eggEd').hidden = false; $('edName').value = p.custom.name;
  rebuildPreview(); renderEd();
  cancelAnimationFrame(ed.raf); ed.last = performance.now(); ed.raf = requestAnimationFrame(edLoop);
}
function closeEditor() {   // = Done: keep the changes
  if (!edOpen()) return;
  closeColorPick(); commitPaint();
  if (JSON.stringify(ed.c) !== JSON.stringify(ed.p.custom)) { ed.p.custom = ed.c; customChanged(ed.p); }
  $('eggEd').hidden = true; cancelAnimationFrame(ed.raf);
  if (ed.m) { ed.scene.remove(ed.m.group); disposeModel(ed.m); ed.m = null; }
  ed.p = null;
}
function rebuildPreview() {
  if (ed.m) { ed.scene.remove(ed.m.group); disposeModel(ed.m); }
  const m = ed.m = buildModel(ed.c); poseModel(m); ed.scene.add(m.group);
  const usePaint = () => { m.art.paint = ed.paint; composeShell(m); };   // the editor's live drawing layer
  usePaint(); m.ready.then(usePaint);
  $('eggEd').style.setProperty('--c', ed.c.color);
}
function placeEdCam() {
  const cv = $('edCv');
  ed.cam.aspect = cv.clientWidth / Math.max(1, cv.clientHeight); ed.cam.fov = ed.cam.aspect < 0.8 ? 30 : 24; ed.cam.updateProjectionMatrix();
  ed.cam.position.set(0, 0.4, 6.6); ed.cam.lookAt(0, 0.05, 0); ed.cam.updateMatrixWorld();
}
function edLoop(now) {
  const cv = $('edCv'), w = cv.clientWidth, h = cv.clientHeight;
  if (w && h && (cv.width !== Math.round(w * devicePixelRatio) || cv.height !== Math.round(h * devicePixelRatio))) { ed.r.setPixelRatio(devicePixelRatio); ed.r.setSize(w, h, false); }
  placeEdCam();
  if (ed.m) ed.m.group.rotation.y = ed.yaw;
  ed.r.render(ed.scene, ed.cam);
  ed.raf = requestAnimationFrame(edLoop);
}
const palette = (act, cur, list = COLORS) => `<div class="pal">${list.map(k => `<button class="chip ${k === cur ? 'on' : ''}" data-act="${act}" data-v="${k}" style="--k:${k}" title="${k}">${k === cur ? ic('check-mark') : ''}</button>`).join('')}<button class="chip any ${list.includes(cur) ? '' : 'on'}" data-act="pick" data-v="${act}" style="${list.includes(cur) ? '' : `--k:${cur}`}" title="Any color">${ic(list.includes(cur) ? 'palette' : 'check-mark')}</button></div>`;
const opts = (act, list, cur) => `<div class="optlist">${list.map(v => `<button class="optc ${v === cur ? 'on' : ''}" data-act="${act}" data-v="${esc(v)}"><img alt="" data-v="${esc(v)}"><span>${esc(v)}</span></button>`).join('')}</div>`;
// each option shows your own egg wearing it (no photo/drawing so the item is easy to see)
function fillOptPics(act) {
  const c = ed.c, base = { ...c, paint: undefined, photo: undefined, pattern: c.pattern === 'Photo' ? 'Plain' : c.pattern }, view = { hat: 'head', face: 'face' }[act] || 'body', box = $('edBody'), BACK = ['Cape', 'Backpack', 'Wings', 'Jetpack'];
  for (const img of box.querySelectorAll('.optc img')) eggShot({ ...base, [act]: img.dataset.v }, act === 'outfit' && BACK.includes(img.dataset.v) ? 'back' : view).then(url => { if (img.isConnected) img.src = url; });
}
function renderEd() {
  const c = ed.c, t = ed.tab;
  $('edTabs').innerHTML = ED_TABS.map(([k, icon, label]) => `<button data-tab="${k}" class="${k === t ? 'on' : ''}">${ic(icon)}<span>${label}</span></button>`).join('');
  $('edTip').textContent = t === 'draw' && !ed.spin ? 'Draw right on the egg!' : 'Drag the egg to spin it';
  let html = '';
  if (t === 'color') html = `<div class="sec"><h4>Shell</h4>${palette('color', c.color)}</div>` + (!['Plain', 'Photo'].includes(c.pattern) ? `<div class="sec"><h4>Pattern color</h4>${palette('color2', c.color2)}</div>` : '');
  if (t === 'pattern') html = `<div class="sec"><h4>Pattern</h4>${opts('pattern', PATTERNS.slice(0, -1), c.pattern)}</div>` + (c.pattern === 'Photo' ? '<p class="edNote">Your egg wears a photo. Pick a pattern here to switch back.</p>' : '');
  if (t === 'face') html = (c.pattern === 'Photo' ? '<p class="edNote">Your photo is the face right now. Pick another pattern to wear a cartoon face.</p>' : '') + `<div class="sec"><h4>Face</h4>${opts('face', FACES, c.face)}</div>`;
  if (t === 'hat') html = `<div class="sec"><h4>Hat</h4>${opts('hat', HATS, c.hat)}</div>`;
  if (t === 'outfit') html = `<div class="sec"><h4>Outfit</h4>${opts('outfit', OUTFITS, c.outfit)}</div>`;
  if (t === 'photo') html = ed.crop ? `<div class="sec"><h4>Fit your picture</h4>
      <p class="edNote">Drag to move, zoom to fit. The bright middle is the <b>front</b> of the egg (eyes on the dotted line); the rest wraps round the back.</p>
      <canvas id="cropCv" width="480" height="240"></canvas>
      <div class="phrow"><input type="range" id="cropZoom" min="1" max="5" step="0.01" value="${ed.crop.zoom}" aria-label="Zoom"><label><input type="checkbox" id="cropToon" ${ed.crop.toon ? 'checked' : ''}> Cartoon style</label></div>
      <button class="bigbtn" data-act="cropOk">${ic('check-mark')} Put it on my egg</button><button class="bigbtn alt" data-act="cropCancel">Cancel</button></div>`
    : `<div class="sec"><h4>Photo</h4>${c.photo ? `<img class="phthumb" src="${c.photo}" alt="">` : '<p class="edNote">Put any picture on your egg: a friend, a pet, a game character… It wraps all the way round, with its middle on the front.</p>'}
      <button class="bigbtn" data-act="choosePhoto">${ic('photo-camera')} ${c.photo ? 'Choose another picture' : 'Choose a picture'}</button>
      ${c.photo && c.pattern !== 'Photo' ? `<button class="bigbtn alt" data-act="usePhoto">Wear it again</button>` : ''}
      ${c.photo ? `<button class="bigbtn alt" data-act="removePhoto">Remove the photo</button>` : ''}</div>`;
  if (t === 'draw') html = `<div class="sec"><h4>Egg color</h4>${palette('color', c.color)}</div><div class="sec"><h4>Brush color</h4>${palette('brush', ed.brush, BRUSHES)}</div>
      <div class="sec"><h4>Brush size</h4><input type="range" id="brushSize" min="0.02" max="0.16" step="0.005" value="${ed.size}" aria-label="Brush size"></div>
      <div class="tools">
        <button class="tool ${ed.tool === 'brush' && !ed.spin ? 'on' : ''}" data-act="tool" data-v="brush">${ic('pencil')} Brush</button>
        <button class="tool ${ed.tool === 'eraser' && !ed.spin ? 'on' : ''}" data-act="tool" data-v="eraser">${ic('eraser')} Eraser</button>
        <button class="tool ${ed.spin ? 'on' : ''}" data-act="spin">${ic('return-arrow')} Spin</button>
        <button class="tool" data-act="undo" ${ed.undo.length ? '' : 'disabled'}>Undo</button>
        <button class="tool" data-act="clear">Clear</button>
      </div>
      <button class="bigbtn alt" data-act="plain">Plain egg: no pattern, photo, face, hat or outfit</button><p class="edNote">Tip: turn the egg with the arrows under it, or press Spin and drag.</p>`;
  $('edBody').innerHTML = html;
  if (['pattern', 'face', 'hat', 'outfit'].includes(t)) fillOptPics(t);
  if (ed.crop) drawCrop();
}
function edSet(fn) { fn(ed.c); rebuildPreview(); renderEd(); }
$('eggEd').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !ed.p) return;
  if (b.dataset.tab) { commitPaint(); ed.tab = b.dataset.tab; ed.crop = null; playSfx('ui_tick'); return renderEd(); }
  const act = b.dataset.act, v = b.dataset.v; if (!act) return;
  playSfx('ui_select'); b.blur();
  if (act === 'color' || act === 'color2') return edSet(c => { c[act] = v; });
  if (['pattern', 'face', 'hat', 'outfit'].includes(act)) return edSet(c => { c[act] = v; });
  if (act === 'brush') { ed.brush = v; ed.tool = 'brush'; ed.spin = false; return renderEd(); }
  if (act === 'tool') { ed.tool = v; ed.spin = false; return renderEd(); }
  if (act === 'spin') { ed.spin = !ed.spin; return renderEd(); }
  if (act === 'undo') { const u = ed.undo.pop(); if (u) { ed.paint.getContext('2d').putImageData(u, 0, 0); composeShell(ed.m); commitPaint(true); } return renderEd(); }
  if (act === 'clear') { ed.undo.push(ed.paint.getContext('2d').getImageData(0, 0, 512, 256)); ed.paint.getContext('2d').clearRect(0, 0, 512, 256); composeShell(ed.m); commitPaint(true); return renderEd(); }
  if (act === 'turn') { ed.yaw += +v * Math.PI / 4; return; }
  if (act === 'pick') return openColorPick(b, v);
  if (act === 'plain') return edSet(c => Object.assign(c, { pattern: 'Plain', face: 'None', hat: 'None', outfit: 'None' }));   // a clean shell to draw on (keeps the colour, photo stays saved)
  if (act === 'choosePhoto') { const f = $('phFile'); f.value = ''; f.onchange = () => f.files[0] && startCrop(f.files[0]); return f.click(); }
  if (act === 'usePhoto') return edSet(c => { c.pattern = 'Photo'; });
  if (act === 'removePhoto') return edSet(c => { delete c.photo; if (c.pattern === 'Photo') c.pattern = 'Plain'; if (c.face === 'None') c.face = 'Dots'; });
  if (act === 'cropCancel') { ed.crop = null; return renderEd(); }
  if (act === 'cropOk') return finishCrop();
  if (act === 'random') { commitPaint(); return edSet(c => Object.assign(c, randomCustom(c.name))); }
  if (act === 'done') closeEditor();
});
$('eggEd').addEventListener('input', e => {
  if (e.target.id === 'brushSize') ed.size = +e.target.value;
  if (e.target.id === 'cropZoom' && ed.crop) { ed.crop.zoom = +e.target.value; drawCrop(); }
});
$('eggEd').addEventListener('change', e => {
  if (!ed.p) return;
  if (e.target.id === 'cropToon' && ed.crop) { ed.crop.toon = e.target.checked; drawCrop(); }
  if (e.target.id === 'edName') ed.c.name = e.target.value.trim() || 'Nobody';
});
$('eggEd').addEventListener('pointerdown', e => { if (e.target === $('eggEd')) closeEditor(); });   // click outside = done

// Any-colour picker (our own, in the game's look): brightness/saturation square, hue bar, preview + hex box
const cp = { act: '', h: 0, s: 1, v: 1 };
const hsv2hex = (h, s, v) => '#' + [5, 3, 1].map(n => { const k = (n + h / 60) % 6; return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0'); }).join('');
function hex2hsv(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  return { h: d ? 60 * (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) : cp.h, s: mx ? d / mx : 0, v: mx };
}
const cpHex = () => hsv2hex(cp.h, cp.s, cp.v);
function drawPicker() {
  const hex = cpHex();
  $('cpSV').style.setProperty('--hue', `hsl(${cp.h} 100% 50%)`);
  Object.assign($('cpDot').style, { left: cp.s * 100 + '%', top: (1 - cp.v) * 100 + '%', background: hex });
  $('cpKnob').style.left = cp.h / 360 * 100 + '%';
  $('cpSw').style.background = hex;
  if (document.activeElement !== $('cpHex')) $('cpHex').value = hex.toUpperCase();
}
function openColorPick(chip, act) {
  cp.act = act;
  Object.assign(cp, hex2hsv(act === 'brush' ? ed.brush : ed.c[act]));
  const el = $('cpick'), r = chip.getBoundingClientRect(); el.hidden = false;
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  el.style.top = (r.bottom + 8 + h < innerHeight ? r.bottom + 8 : Math.max(8, r.top - h - 8)) + 'px';
  drawPicker();
}
function applyPicker() {
  const hex = cpHex();
  if (cp.act === 'brush') { ed.brush = hex; ed.tool = 'brush'; ed.spin = false; renderEd(); }
  else if (ed.c[cp.act] !== hex) edSet(c => { c[cp.act] = hex; });
}
const closeColorPick = () => { $('cpick').hidden = true; };
{
  let dragging = null;
  const at = (e, el) => { const r = el.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
  const move = e => {
    if (dragging === 'sv') { const [x, y] = at(e, $('cpSV')); cp.s = x; cp.v = 1 - y; }
    if (dragging === 'hue') cp.h = at(e, $('cpHue'))[0] * 359.9;
    drawPicker();
  };
  for (const id of ['cpSV', 'cpHue']) $(id).addEventListener('pointerdown', e => { dragging = id === 'cpSV' ? 'sv' : 'hue'; try { e.target.setPointerCapture(e.pointerId); } catch {} move(e); });
  addEventListener('pointermove', e => dragging && move(e));
  addEventListener('pointerup', () => { if (dragging) { dragging = null; applyPicker(); } });   // the egg updates when you let go
  $('cpHex').addEventListener('change', e => { const v = e.target.value.trim().replace(/^#?/, '#'); if (/^#[0-9a-f]{6}$/i.test(v)) { Object.assign(cp, hex2hsv(v.toLowerCase())); drawPicker(); applyPicker(); } else drawPicker(); });
  $('cpHex').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  $('cpOk').onclick = () => { applyPicker(); closeColorPick(); };
  addEventListener('pointerdown', e => { if (!$('cpick').hidden && !e.target.closest('#cpick, .chip.any')) closeColorPick(); });
}
// spinning and drawing on the preview
let drag = null;
const edRay = new THREE.Raycaster(), ndc = new THREE.Vector2();
function hitShell(e) {
  const r = $('edCv').getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  placeEdCam(); ed.m.group.rotation.y = ed.yaw; ed.m.group.updateMatrixWorld(true); edRay.setFromCamera(ndc, ed.cam);
  return edRay.intersectObject(ed.m.shellMesh, false)[0]?.uv;
}
function stamp(g, u, v) {   // one round dab of paint at shell uv (u wraps round the egg)
  const y = 0.05 - 0.9 * Math.cos(Math.PI * v), around = Math.max(0.12, eggRadius(y) / 0.56);
  const rx = ed.size * 512 / (2 * Math.PI * 0.56 * around), ry = ed.size * 256 / 2.9, x = u * 512, py = (1 - v) * 256;
  for (const ox of [-512, 0, 512]) { g.beginPath(); g.ellipse(x + ox, py, rx, ry, 0, 0, 7); g.fill(); }
}
function paintTo(uv) {
  const g = ed.paint.getContext('2d');
  g.globalCompositeOperation = ed.tool === 'eraser' ? 'destination-out' : 'source-over'; g.fillStyle = ed.brush;
  const prev = drag.uv;
  if (prev && Math.abs(prev.x - uv.x) < 0.5) {   // fill the gap since the last point (not across the seam at the back)
    const n = Math.ceil(Math.hypot((uv.x - prev.x) * 512, (uv.y - prev.y) * 256) / 3);
    for (let i = 1; i <= n; i++) stamp(g, prev.x + (uv.x - prev.x) * i / n, prev.y + (uv.y - prev.y) * i / n);
  } else stamp(g, uv.x, uv.y);
  g.globalCompositeOperation = 'source-over';
  drag.uv = uv.clone(); composeShell(ed.m);
}
$('edCv').addEventListener('pointerdown', e => {
  if (!ed.m) return;
  try { $('edCv').setPointerCapture(e.pointerId); } catch {}
  drag = { x: e.clientX, draw: ed.tab === 'draw' && !ed.spin, uv: null };
  if (drag.draw) { ed.undo.push(ed.paint.getContext('2d').getImageData(0, 0, 512, 256)); if (ed.undo.length > 20) ed.undo.shift(); const uv = hitShell(e); if (uv) paintTo(uv); }
});
$('edCv').addEventListener('pointermove', e => {
  if (!drag) return;
  if (drag.draw) { const uv = hitShell(e); if (uv) paintTo(uv); else drag.uv = null; return; }
  ed.yaw += (e.clientX - drag.x) * 0.012; drag.x = e.clientX;
});
$('edCv').addEventListener('pointerup', () => { if (drag?.draw) { commitPaint(true); renderEd(); } drag = null; });
// save the drawing with the egg (small PNG; sent to online players too)
let paintDirty = false;
function commitPaint(now) {
  if (now) paintDirty = true;
  if (!paintDirty || !ed.p) return;
  paintDirty = false;
  const px = ed.paint.getContext('2d').getImageData(0, 0, 512, 256).data;
  let any = false; for (let i = 3; i < px.length; i += 4) if (px[i]) { any = true; break; }
  if (!any) delete ed.c.paint;
  else {
    let url = ed.paint.toDataURL('image/png');
    if (url.length > 120000) { const s = document.createElement('canvas'); s.width = 256; s.height = 128; s.getContext('2d').drawImage(ed.paint, 0, 0, 256, 128); url = s.toDataURL('image/png'); }
    if (url.length > 120000) return;   // too detailed to share: keep it local to the editor
    ed.c.paint = url;
  }
}

// Photo: move/zoom the picture in a 2:1 frame = the whole shell unrolled (middle half = front, outer quarters = back)
const PH_W = 256, PH_H = 128;
function startCrop(file) {
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    ed.crop = { img, base: Math.max(480 / img.width, 240 / img.height), zoom: 1, x: 240, y: 120, toon: true };
    ed.tab = 'photo'; renderEd();
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}
function cropTo(g, w, h) {   // the picture as framed, drawn at w x h
  const cr = ed.crop, s = w / 480, k = cr.base * cr.zoom * s, { img } = cr;
  g.fillStyle = ed.c.color; g.fillRect(0, 0, w, h);
  g.drawImage(img, cr.x * s - img.width * k / 2, cr.y * s - img.height * k / 2, img.width * k, img.height * k);
  if (!cr.toon) return;
  const im = g.getImageData(0, 0, w, h), d = im.data;   // cartoon look: punchier colours in a few flat steps, like the toon-shaded game
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
    for (let c = 0; c < 3; c++) d[i + c] = Math.round(Math.max(0, Math.min(255, l + (d[i + c] - l) * 1.35)) / 51) * 51;
  }
  g.putImageData(im, 0, 0);
}
function drawCrop() {
  const cv = $('cropCv'); if (!cv || !ed.crop) return;
  const g = cv.getContext('2d'), w = cv.width, h = cv.height;
  cropTo(g, w, h);
  g.fillStyle = 'rgba(15,15,22,.5)'; g.fillRect(0, 0, w / 4, h); g.fillRect(w * 3 / 4, 0, w / 4, h);   // the back of the egg
  g.strokeStyle = '#ffd93d'; g.lineWidth = 3; g.strokeRect(w / 4, 1.5, w / 2, h - 3);
  g.fillStyle = '#ffffffcc'; g.font = 'bold 14px Segoe UI, Arial'; g.textAlign = 'center';
  g.fillText('back', w / 8, h - 10); g.fillText('back', w * 7 / 8, h - 10); g.fillText('FRONT', w / 2, h - 10);
  const ey = (0.95 - 0.32) / 1.8 * h;   // where the cartoon eyes would sit
  g.setLineDash([6, 6]); g.strokeStyle = '#ffffffaa'; g.lineWidth = 2; g.beginPath(); g.moveTo(w * 0.3, ey); g.lineTo(w * 0.7, ey); g.stroke(); g.setLineDash([]);
}
function finishCrop() {
  const out = document.createElement('canvas'); out.width = PH_W; out.height = PH_H;
  cropTo(out.getContext('2d'), PH_W, PH_H);
  let url = '';
  for (let q = 0.85; q > 0.3 && (!url || url.length > 60000); q -= 0.15) url = out.toDataURL('image/jpeg', q);
  ed.crop = null;
  edSet(c => { c.photo = url; c.pattern = 'Photo'; c.face = 'None'; });   // the picture's own face shows (pick a cartoon face again under Face)
}
{
  let cd = null;
  $('eggEd').addEventListener('pointerdown', e => { if (e.target.id === 'cropCv') { cd = [e.clientX, e.clientY]; try { e.target.setPointerCapture(e.pointerId); } catch {} } });
  $('eggEd').addEventListener('pointermove', e => {
    if (!cd || !ed.crop || e.target.id !== 'cropCv') return;
    const k = 480 / e.target.getBoundingClientRect().width;
    ed.crop.x += (e.clientX - cd[0]) * k; ed.crop.y += (e.clientY - cd[1]) * k; cd = [e.clientX, e.clientY]; drawCrop();
  });
  $('eggEd').addEventListener('pointerup', () => { cd = null; });
  $('eggEd').addEventListener('wheel', e => {
    if (e.target.id !== 'cropCv' || !ed.crop) return;
    e.preventDefault(); ed.crop.zoom = Math.min(5, Math.max(1, ed.crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))); $('cropZoom').value = ed.crop.zoom; drawCrop();
  }, { passive: false });
}
$('addBot').onclick = e => { e.target.blur(); join('bot'); };
$('start').onclick = e => { e.target.blur(); startMatch(); };
$('hostBtn').onclick = e => { e.target.blur(); hostOnline(); };
$('joinBtn').onclick = e => { e.target.blur(); joinOnline($('codeIn').value.trim()); };
$('codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') joinOnline(e.target.value.trim()); });
$('leaveBtn').onclick = e => { e.target.blur(); leaveOnline(); };

addEventListener('keydown', e => {
  if (edOpen()) { if (e.code === 'Escape') { e.preventDefault(); closeEditor(); } return; }   // the egg editor takes the keyboard
  if (!$('mapPick').hidden) { if (e.code === 'Escape') { e.preventDefault(); closePicker(); } return; }
  if (e.code === 'Escape') { e.preventDefault(); if (state === 'title') return navBack(); return menuOpen ? navBack() : openMenu(); }
  if ((menuOpen || state === 'title') && e.target.type !== 'range') {
    if (['ArrowUp', 'KeyW'].includes(e.code)) { e.preventDefault(); return navMove(-1); }
    if (['ArrowDown', 'KeyS'].includes(e.code)) { e.preventDefault(); return navMove(1); }
    if (['Space', 'KeyF'].includes(e.code) && document.activeElement?.tagName === 'BUTTON') { e.preventDefault(); return document.activeElement.click(); }
  }
  if (state === 'title') return;
  if (e.target.tagName === 'INPUT' || menuOpen) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (state === 'lobby') {
    if (e.code === 'KeyJ' || e.code === 'Space') join('kb1');
    if (e.code === 'Period' || e.code === 'ShiftRight') join('kb2');
    if (e.code === 'Enter') startMatch();
  }
});

// ---------- menu: pause, controls, volume ----------
let menuOpen = false, paused = false;
function openMenu(panel = 'main') {
  const inGame = state !== 'lobby' && state !== 'title';
  const wasOpen = menuOpen; menuOpen = true; $('menu').hidden = false;
  $('mainPanel').hidden = panel !== 'main'; $('ctlPanel').hidden = panel !== 'controls'; $('creditsPanel').hidden = panel !== 'credits'; $('sharePanel').hidden = panel !== 'share'; $('quitPanel').hidden = panel !== 'quit'; $('newsPanel').hidden = panel !== 'news';
  if (panel === 'share') renderShare();
  if (panel === 'news') renderNews();
  $('menuTitle').textContent = inGame ? 'PAUSED' : state === 'title' ? 'SETTINGS' : 'MENU';
  document.querySelector('[data-m="resume"]').innerHTML = inGame ? ic('play-button') + ' Resume' : ic('return-arrow') + ' Close';
  $('mLobby').hidden = !inGame || net.mode === 'client';
  $('mLeave').hidden = net.mode === 'off';
  $('mSave').hidden = !inGame || mode !== 'endless' || net.mode === 'client' || !endless.wave;
  paused = inGame;
  if (net.mode === 'client' && inGame && !wasOpen) toHost({ t: 'pause', on: 1 });   // the host freezes the match for everyone
  if (!wasOpen) playSfx('ui_open');
  keys.clear();
  document.querySelector(panel === 'main' ? '#mainPanel [data-m="resume"]' : `#${{ credits: 'creditsPanel', share: 'sharePanel', quit: 'quitPanel', news: 'newsPanel' }[panel] || 'ctlPanel'} [data-m="back"]`).focus({ preventScroll: true });
  $('ctlPanel').scrollTop = 0;
}
function closeMenu() {
  if (menuOpen) playSfx('ui_close');
  if (menuOpen && net.mode === 'client') toHost({ t: 'pause', on: 0 });
  menuOpen = false; paused = false; $('menu').hidden = true; keys.clear(); document.activeElement?.blur();
  if (state === 'title') focusTitle();
}
function toggleMenu() { menuOpen ? closeMenu() : openMenu(); }
$('menu').addEventListener('click', e => {
  const m = e.target.dataset.m;
  if (m && m !== 'resume') playSfx('ui_click');
  if (m === 'resume') net.mode === 'host' ? resumeAll() : closeMenu();
  if (m === 'controls') { cameFromTitle = false; openMenu('controls'); }
  if (m === 'back') cameFromTitle ? closeMenu() : openMenu('main');
  if (m === 'news') openMenu('news');
  if (m === 'lowpoly') setLowPoly(!lowPoly);
  if (m === 'fullscreen') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  if (m === 'lobby') { closeMenu(); toLobby(); }
  if (m === 'leave') { closeMenu(); leaveOnline(); }
  if (m === 'quit') openMenu('quit');   // "are you sure?" first ("No" has the focus)
  if (m === 'quitYes') window.close();
  if (m === 'saveRun') { saveRun(); closeMenu(); toLobby(); }
});
$('ctlBtn').onclick = e => { e.target.blur(); openMenu('controls'); };
// arrow keys / D-pad move between the visible buttons of the current screen
function navButtons() {
  if (menuOpen) return [...document.querySelectorAll('#menu .panel:not([hidden]) button, #menu .panel:not([hidden]) input')];
  if (state === 'title') return [...document.querySelectorAll('#title .tb')];
  return [];
}
function navMove(dir) {
  const list = navButtons(); if (!list.length) return;
  const i = list.indexOf(document.activeElement);
  list[(i + dir + list.length) % list.length].focus({ preventScroll: false });
  playSfx('ui_tick');
}
function navBack() {
  if (!menuOpen) return;
  if (!$('mainPanel').hidden || cameFromTitle) closeMenu(); else openMenu('main');
}
$('menuBtn').onclick = e => { e.target.blur(); openMenu(); };
for (const [id, bus, def] of [['sfxVol', sfxBus, 0.8], ['musicVol', musicBus, 0.5]]) {   // remembered between sessions
  try { bus.gain.value = +(localStorage.getItem('egg-' + id) ?? def); } catch { bus.gain.value = def; }
  $(id).value = bus.gain.value;
  $(id).addEventListener('input', e => { bus.gain.value = +e.target.value; try { localStorage.setItem('egg-' + id, e.target.value); } catch {} playSfx('ui_tick'); });
}
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => keys.clear());

// ---------- title screen ----------
let titleEggs = [], cameFromTitle = false;
function focusTitle() { setTimeout(() => document.querySelector('#title .tb')?.focus(), 0); }
function toTitle() {
  if (net.mode !== 'off') leaveOnline();
  closeMenu();
  state = 'title';
  loadMap(0);
  players.forEach(p => p.remove());   // they stay joined and come back in the lobby
  titleEggs.forEach(m => scene.remove(m.group));
  titleEggs = Array.from({ length: 6 }, (_, i) => {   // dancing eggs either side of the buttons
    const m = buildModel(randomCustom(''));
    const side = i < 3 ? -1 : 1, k = i % 3;
    m.group.position.set(side * (4.2 + k * 1.9), 0.9, 1 - k * 1.6);
    m.fake = { body: { velocity: { x: 0, y: 0, z: 0 } }, flags: 4 | (i % 2 ? 8 : 0), ko: 0, stun: 0, hp: 100, attackT: -1, attackKind: 0, weapon: i === 2 ? 'pan' : null };
    setWeapon(m, m.fake.weapon);
    scene.add(m.group); return m;
  });
  setUI(); focusTitle();
}
function animateTitle(dt, t) {
  titleEggs.forEach((m, i) => {
    const f = m.fake;
    if (!(f.flags & 8)) {   // the non-cheering ones throw air punches now and then
      if (f.attackT < 0 && Math.random() < dt * 0.6) { f.attackKind = f.weapon ? 4 : 1 + (Math.random() < 0.5); f.attackT = 0; }
      if (f.attackT >= 0 && (f.attackT += dt) > 0.8) f.attackT = -1;
    }
    m.group.rotation.y = Math.atan2(-m.group.position.x, 12 - m.group.position.z) + Math.sin(t * 0.5 + i) * 0.3;   // face the camera
    animate(m, f, dt, t);
  });
}
$('title').addEventListener('click', e => {
  const t = e.target.dataset.t; if (!t) return;
  playSfx('ui_click');
  if (t === 'play' || t === 'online') {
    titleEggs.forEach(m => scene.remove(m.group)); titleEggs = [];
    toLobby();
    if (t === 'online') { $('online').animate([{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 600 }); $('codeIn').focus(); }
  }
  cameFromTitle = t === 'controls' || t === 'credits';
  if (t === 'controls') openMenu('controls');
  if (t === 'credits') openMenu('credits');
  if (t === 'share') { cameFromTitle = true; openMenu('share'); }
  if (t === 'settings') openMenu('main');
  if (t === 'quit') { cameFromTitle = true; openMenu('quit'); }
});
// "Get the game": QR + link to the online copy, phone install steps, Windows download
let installPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (!$('sharePanel').hidden) renderShare(); });
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;
const inMobileApp = !!qs.get('app');   // the Android / iPhone app opens the game with ?app=
function renderShare(el = $('shareBody')) {
  const isAndroid = /Android/.test(navigator.userAgent);
  const home = inMobileApp || isInstalled ? `<p>${ic('check-mark')} You are playing the installed app.</p>` : `
    <div class="homebox">
      <h3>${ic('smartphone')} Easiest on phones: add it to your Home Screen</h3>
      <p class="note">No download and no app store. You get an egg icon, it opens full screen and is always the newest version.</p>
      ${installPrompt ? `<button class="mb" id="installBtn">${ic('cloud-download')} Add to this device</button>` : ''}
      <div class="steps">
        <div class="${isIOS ? 'me' : ''}"><b>iPhone / iPad</b><ol><li>Open the link in <b>Safari</b></li><li>Tap <b>Share ⬆</b> (bottom of the screen)</li><li>Scroll down, tap <b>Add to Home Screen</b></li><li>Tap <b>Add</b> and play from the egg icon</li></ol></div>
        <div class="${isAndroid ? 'me' : ''}"><b>Android</b><ol><li>Open the link in <b>Chrome</b></li><li>Tap the <b>⋮</b> menu (top right)</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b></li><li>Tap <b>Install</b> and play from the egg icon</li></ol></div>
      </div>
    </div>`;
  el.innerHTML = SITE_URL ? `
    <a class="dlbtn" id="apkBtn" hidden>${ic('smartphone')} Download for Android</a>
    <p class="note" id="apkNote" hidden>Open <b>Break-My-Eggs.apk</b> and allow installing from your browser when Android asks.</p>
    <a class="dlbtn" id="ipaBtn" hidden>${ic('smartphone')} Download for iPhone</a>
    <p class="note" id="ipaNote" hidden>For a real app: install <b>Break-My-Eggs.ipa</b> from a computer with <b>Sideloadly</b> or <b>AltStore</b> and your Apple ID.<br>With a free Apple ID it must be re-installed every 7 days. The Home Screen way below never expires.</p>
    <a class="dlbtn" id="dlBtn" hidden>${ic('cloud-download')} Download for Windows</a>
    <p class="note">Run <b>Break-My-Eggs-Setup.exe</b>. If Windows says "Windows protected your PC", click <b>More info</b> → <b>Run anyway</b>.<br>The app updates itself, so you always have the newest version.</p>
    <hr>
    <img class="bigqr" src="${qrImg(SITE_URL)}" alt="">
    <p>Scan the code with a phone camera to open the game.</p>
    ${home}
    <p class="ver" id="ver"></p>`
    : '<p>The online version isn\'t set up yet, so there is no link to share.</p>';
  el.querySelector('#installBtn')?.addEventListener('click', async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; renderShare(el); });
  fetch('version.json', { cache: 'no-store' }).then(r => r.json()).then(v => {   // version + Windows download link come with each published build
    const ver = el.querySelector('#ver'), btn = el.querySelector('#dlBtn');
    if (ver) ver.textContent = 'Version ' + v.version + (v.built ? ` (${v.built} UTC)` : '');
    if (v.download && btn) { btn.href = v.download; btn.hidden = false; }
    const apk = el.querySelector('#apkBtn'), ipa = el.querySelector('#ipaBtn');   // not inside the phone apps themselves
    if (v.android && apk && !inMobileApp) { apk.href = v.android; apk.hidden = el.querySelector('#apkNote').hidden = false; }
    if (v.ios && ipa && !inMobileApp) { ipa.href = v.ios; ipa.hidden = el.querySelector('#ipaNote').hidden = false; }
  }).catch(() => {});
}
fetch('version.json', { cache: 'no-store' }).then(r => r.json()).then(v => {   // the online copy knows its version
  $('verTag').textContent = 'v' + v.version;
  let seen = null; try { seen = localStorage.getItem('egg-seen-version'); localStorage.setItem('egg-seen-version', v.version); } catch {}
  if (seen && seen !== v.version) (function showNews() {   // first launch after an update (not for brand-new players), once the title screen is up
    if (state !== 'title' || !$('loading').hidden) return setTimeout(showNews, 500);
    if (!menuOpen) { cameFromTitle = true; openMenu('news'); }
  })();
}).catch(() => {});
// "What's new": the newest section of PATCH_NOTES.md, turned from markdown into HTML
function renderNews() {
  if ($('newsBody').dataset.done) return;
  fetch('PATCH_NOTES.md', { cache: 'no-store' }).then(r => r.text()).then(md => {
    const latest = md.split(/^## /m)[1] || '', inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/`(.+?)`/g, '<code>$1</code>');
    let html = '', list = false;
    for (const line of ('## ' + latest).split('\n')) {
      const li = line.match(/^\s*- (.*)/);
      if (!li && list) { html += '</ul>'; list = false; }
      if (li) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(li[1])}</li>`; }
      else if (line.startsWith('### ')) html += `<h4>${inline(line.slice(4))}</h4>`;
      else if (line.startsWith('## ')) html += `<h3>${inline(line.slice(3))}</h3>`;
      else if (line.trim()) html += `<p>${inline(line)}</p>`;
    }
    $('newsBody').innerHTML = html + (list ? '</ul>' : ''); $('newsBody').dataset.done = 1;
  }).catch(() => { $('newsBody').textContent = 'Could not load the patch notes.'; });
}
if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

$('toTitle').onclick = e => { e.target.blur(); playSfx('ui_back'); toTitle(); };

// ---------- loading screen: shown while the game boots and while each map is built and its shaders compiled ----------
const TIPS = ['Tap punch three times for jab, jab, HAYMAKER.', 'Hold punch to charge a swing: it smashes through blocks.', 'Hold block (I / \' / LB) to stop punches and egg shots from the front.',
  'Getting hit 4 times in a row breaks the combo: you get a moment of safety.', 'Punch in the air for a flying headbutt.', 'Hold grab near an edge to hang on, then jump to climb up.',
  'Grab an egg and punch to throw it off the map!', 'Lost your shell? Find a green-glowing spare shell.', 'Banana peels: anyone who steps on one slips — even you, after a second.',
  'The hot pepper makes you faster and your hits harder for 9 seconds.', 'Endless mode saves at every wave: Continue from the lobby.', 'Rounds that drag on get an AIR RAID: watch for the orange rings!', 'Knocked down a level? Jump and hold grab at the edge to climb back up.', 'Drop a weapon you don\'t want with L / ; / Y.'];
let loadBusy = false, loadToken = 0, loadShownAt = 0;
const setLoad = f => { $('ldBar').style.width = Math.round(f * 100) + '%'; };
function showLoading(title, sub = '', img = '') {
  const el = $('loading'); el.hidden = false; el.classList.remove('out'); loadShownAt = performance.now();
  $('ldTitle').innerHTML = icText(esc(title)); $('ldSub').innerHTML = icText(esc(sub));
  $('ldImg').hidden = !img; if (img) $('ldImg').style.backgroundImage = `url("${img}")`;
  $('ldTip').innerHTML = `<b>Tip:</b> ${esc(TIPS[Math.floor(Math.random() * TIPS.length)])}`;
  setLoad(0.08);
}
function hideLoading(minMs = 0) {
  const el = $('loading'), tok = loadToken;
  setTimeout(() => { if (tok !== loadToken) return; el.classList.add('out'); setTimeout(() => { if (el.classList.contains('out')) el.hidden = true; }, 400); }, Math.max(0, minMs - (performance.now() - loadShownAt)));
}
const afterPaint = fn => requestAnimationFrame(() => setTimeout(fn, 20));   // let the browser draw the loading screen before the heavy work
// build a round's map behind the loading screen; the host's game logic waits (loadBusy) until it's done
function loadWithScreen(seed, want, done) {
  const tok = ++loadToken; loadBusy = true;
  const known = want && SET_PIECES[want];
  showLoading(known ? want : 'Next round', known ? SET_PIECES[want].hint : 'Picking a map…', known ? mapImg(want) : '');
  afterPaint(() => {
    if (tok !== loadToken) return;
    const info = loadMap(seed, want); setLoad(0.75);
    $('ldTitle').textContent = info[0]; $('ldSub').innerHTML = icText(esc(info[1] || 'Get ready!'));
    if (SET_PIECES[info[0]] && $('ldImg').hidden) { $('ldImg').hidden = false; $('ldImg').style.backgroundImage = `url("${mapImg(info[0])}")`; }
    done?.(info);
    afterPaint(() => { if (tok !== loadToken) return; setLoad(1); loadBusy = false; hideLoading(1100); });   // one real frame rendered behind the screen first
  });
}

// ---------- game flow ----------
let state = 'lobby', endT = 0, bannerT = 0, roundT = 0, countT = 0, countShown = '', mapInfo = ['', ''], suddenDeath = false, bombT = 0;
const AIR_RAID = 40;   // seconds into a battle round before bombs start falling (they come faster and faster)

function showBanner(text, sub = '', secs = 2.5) {
  $('banner').innerHTML = `${icText(esc(text))}${sub ? `<small>${icText(esc(sub))}</small>` : ''}`;
  $('banner').style.display = 'block'; bannerT = secs;
}
function banner(text, sub, secs) {
  showBanner(text, sub, secs);
  if (net.mode === 'host') broadcast({ t: 'banner', text, sub, secs });
}

function setUI() {
  $('title').hidden = state !== 'title';
  $('lobby').style.display = state === 'lobby' ? 'flex' : 'none';
  $('hud').style.display = state === 'lobby' || state === 'title' ? 'none' : 'flex';
  $('esc').style.display = state !== 'lobby' && state !== 'title' ? 'block' : 'none';
  if (state === 'lobby') { $('banner').style.display = 'none'; renderCards(); renderVotes(); renderMode(); }
}

// ---------- map vote (one vote per PC; the host counts) + who-paused note ----------
const MAP_RANDOM = 'Random', MAP_CLASSIC = 'Classic';
const MAP_ICONS = { Random: 'dice-six-faces-five', Classic: 'jigsaw-piece', 'Train Station': 'subway-train', 'Construction Site': 'crane', 'Kitchen Counter': 'knife-fork', 'Freight Train': 'steam-locomotive',
  'City Rooftops': 'modern-city', 'Dinner Table': 'cake-slice', 'Floor Is Lava': 'volcano', 'Frying Pan': 'fried-eggs', 'Container Port': 'cargo-ship', 'Pirate Cove': 'pirate-flag', 'Castle Siege': 'castle',
  'Space Station': 'rocket', 'Theme Park': 'carousel', 'Sky Course': 'fluffy-cloud', 'Winter Village': 'snowman', 'Haunted Graveyard': 'ghost', 'Jungle Temple': 'mayan-pyramid', 'Cliff Climb': 'mountain-climbing', 'Quarry Pit': 'mine-wagon', 'Treetop Village': 'forest-camp', 'Ski Slope': 'skier' };
const mapChoices = () => [MAP_RANDOM, ...Object.keys(SET_PIECES), MAP_CLASSIC];
const votes = new Map();   // host: PC ('host' or peer id) -> map name
let myVote = null, matchMap = MAP_RANDOM;
const pcName = pid => players.find(p => p.ctrl.startsWith(pid + '/'))?.custom.name || 'A friend';
const hostName = () => players.find(p => !p.ctrl.includes('/') && p.ctrl !== 'bot')?.custom.name || 'The host';
function tally() {
  if (net.mode === 'client') return net.tally;
  const t = {};
  for (const [pc, m] of votes) (t[m] ||= []).push(pc === 'host' ? hostName() : pcName(pc));
  return t;
}
const votesMsg = () => ({ t: 'votes', tally: tally() });
function votesChanged() { renderVotes(); if (net.mode === 'host') broadcast(votesMsg()); }
function vote(m) {
  myVote = m; playSfx('ui_select');
  if (net.mode === 'client') { toHost({ t: 'vote', map: m }); renderVotes(); } else { votes.set('host', m); votesChanged(); }
}
// most votes wins, ties are a coin flip, no votes = random
function voteWinner() {
  const t = tally(), best = Math.max(0, ...Object.values(t).map(v => v.length));
  const top = Object.keys(t).filter(m => t[m].length === best && mapChoices().includes(m));
  return best ? top[Math.floor(Math.random() * top.length)] : MAP_RANDOM;
}
const mapLabel = m => (m === MAP_CLASSIC ? 'Classic Arenas' : m === MAP_RANDOM ? 'Random' : m);
const mapHint = m => (m === MAP_RANDOM ? 'Surprise! A different map every round' : m === MAP_CLASSIC ? 'Random themed arenas: islands, spinners, lifts…' : SET_PIECES[m]?.hint || '');
const mapImg = m => `assets/maps/${m.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`;
// ---------- endless mode: your team vs. waves of rotten eggs, with a boss every 5th wave ----------
function renderMode() {
  $('modeBtn').innerHTML = mode === 'endless' ? `${ic('infinity')} Mode: <b>Endless</b>` : `${ic('crossed-swords')} Mode: <b>Battle</b>`;
  $('modeBtn').disabled = net.mode === 'client';
  $('modeBtn').title = mode === 'endless' ? 'Team up against endless waves of bad eggs (3 lives each)' : 'Last egg standing wins the round';
  $('start').textContent = (mode === 'endless' ? 'START ENDLESS!' : 'START BRAWL!') + (IS_TOUCH ? '' : ' (Enter)');
  const sv = savedRun();
  $('contBtn').hidden = mode !== 'endless' || net.mode === 'client' || !(sv?.wave > 0);
  if (sv?.wave > 0) $('contBtn').innerHTML = `${ic('save')} Continue: wave <b>${sv.wave}</b>`;
}
$('contBtn').onclick = e => { e.target.closest('button').blur(); startMatch(savedRun()); };
$('modeBtn').onclick = e => {
  e.target.closest('button').blur();
  if (net.mode === 'client') return;
  mode = mode === 'endless' ? 'battle' : 'endless'; playSfx('ui_select'); rosterChanged(); renderMode();
};
const FOE_NAMES = ['Rotten Egg', 'Bad Egg', 'Stinker', 'Grumpy', 'Mouldy', 'Old Yolk', 'Sulphur', 'Cracky'];
function spawnFoe(boss, at = null) {
  const c = boss ? { name: 'BIG BAD EGG', color: '#222222', color2: '#c1121f', pattern: 'Zigzag', hat: 'Crown', face: 'Angry', outfit: 'Cape', enemy: true, boss: true }
    : { name: pick(FOE_NAMES.filter(n => !players.some(p => p.custom.name === n))) || pick(FOE_NAMES), color: pick(['#8b5a2b', '#555555', '#b5e48c', '#6bcb77', '#d4a017']), color2: pick(['#222222', '#8b5a2b', '#555555']), pattern: pick(['Speckled', 'Spots', 'Camo']),
        hat: pick(['None', 'Horns', 'Pirate', 'Viking', 'Beanie']), face: pick(['Angry', 'Robot', 'Cyclops', 'Mustache']), outfit: 'None', enemy: true };
  const p = new Player('bot', c), [x, y, z] = at || spawnPoint(Math.floor(Math.random() * 8), 8).map((v, i) => (i === 1 ? v + 3 : v));
  players.push(p); p.spawn([x, y, z]);
  fx('join'); rosterChanged();
}
// The host saves the run (this PC) at the start of every wave, or from the pause menu; Continue in the lobby resumes it
// with everyone's lives (matched by egg name, so friends online get theirs back too).
const SAVE_KEY = 'egg-endless-save';
function saveRun() {
  const lives = Object.fromEntries(players.filter(p => !p.custom.enemy).map(p => [p.custom.name, Math.max(1, p.wins)]));
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ wave: endless.wave, lives, at: Date.now() })); } catch {}
}
const savedRun = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; } };
function nextWave() {
  const w = ++endless.wave, boss = w % 5 === 0, extra = !endless.fresh && w > 1 && (w - 1) % 5 === 0, n = 1 + Math.ceil(w * 0.8) + (boss ? 1 : 0);
  endless.fresh = false;
  Object.assign(endless, { toSpawn: n, left: n, boss, spawnT: 1.5 });
  for (const p of players) if (!p.custom.enemy) {
    if (extra && (p.alive || p.wins > 0)) p.wins++;   // beat a boss: extra life
    if (p.alive && !p.yolk) p.hp = Math.min(SHELL_HP, p.hp + 50);   // breather between waves
  }
  banner(`[death-skull] WAVE ${w}`, boss ? 'A BOSS IS COMING!' : extra ? 'Boss down! Extra life!' : `${n} bad eggs incoming`, 2.2);
  fx(boss ? 'horn' : 'v_ready'); rosterChanged(); saveRun();
}
function endlessTick(dt) {
  for (const p of [...players]) {
    if (p.alive) { p.deadT = 0; continue; }
    p.deadT = (p.deadT || 0) + dt;
    if (p.custom.enemy) { if (p.deadT > 1.2) { endless.left--; removePlayer(p); } }
    else if (p.wins > 0 && p.deadT > 2) {   // lose a life; respawn if any are left
      p.deadT = 0;
      if (--p.wins > 0) { const [x, y, z] = spawnPoint(players.indexOf(p), 8); p.spawn([x, y + 2, z]); p.invuln = 3; fx('join'); }
      rosterChanged();
    }
  }
  if (!players.some(p => !p.custom.enemy && (p.alive || p.wins > 0))) {   // the whole team is out
    state = 'roundEnd'; endT = 6;
    let best = 0; try { best = +localStorage.getItem('egg-best-wave') || 0; if (endless.wave > best) localStorage.setItem('egg-best-wave', endless.wave); } catch {}
    banner('GAME OVER', `You reached wave ${endless.wave}` + (endless.wave > best ? ' — new best!' : ` · best: wave ${best}`) + ' · Continue it from the lobby', 5.5);
    fx('jingle'); return;
  }
  if (endless.left <= 0 && !players.some(p => p.custom.enemy)) return nextWave();
  const cap = Math.min(1 + Math.floor(endless.wave / 2), 5);
  if (endless.toSpawn > 0 && !endless.mark && players.filter(p => p.custom.enemy && p.alive).length < cap && (endless.spawnT -= dt) <= 0) {
    const [x, y, z] = spawnPoint(Math.floor(Math.random() * 8), 8), hit = castDown(x, y + 2, z, y - 12);
    endless.mark = { at: [x, y + 3, z], t: 1.3 };   // warn first: a red ring where it will land
    fx('spawnmark', { x, y: hit ? hit.hitPointWorld.y : y - 2, z });
  }
  if (endless.mark && (endless.mark.t -= dt) <= 0) {
    endless.toSpawn--; endless.spawnT = 2.2;
    spawnFoe(endless.boss && endless.toSpawn === 0, endless.mark.at); endless.mark = null;   // the boss comes last
  }
}

// lobby button shows the current leader; the picker screen shows every map with its votes
function renderVotes() {
  const t = tally(), best = Math.max(0, ...Object.values(t).map(v => v.length)), lead = Object.keys(t).filter(m => t[m].length === best);
  $('mapBtn').innerHTML = `${ic('treasure-map')} Map: <b>${best ? lead.map(m => esc(mapLabel(m))).join(' / ') : 'Random'}</b>${best ? ` <span class="cnt">${best} vote${best > 1 ? 's' : ''}</span>` : ''}`;
  $('mapGrid').innerHTML = mapChoices().map(m => {
    const who = t[m] || [], pic = SET_PIECES[m] ? `<img src="${mapImg(m)}" alt="">` : `<div class="ph">${ic(MAP_ICONS[m])}</div>`;
    return `<button class="mcard ${m === myVote ? 'on' : ''}" data-map="${esc(m)}">${pic}
      ${who.length ? `<span class="votes">${who.length}</span>` : ''}${m === myVote ? `<span class="mine">${ic('check-mark')} Your vote</span>` : ''}
      <div class="nm">${MAP_ICONS[m] ? ic(MAP_ICONS[m]) : ''} ${esc(mapLabel(m))}</div><div class="mhint">${esc(mapHint(m))}</div>
      <div class="who">${who.length ? ic('vote') + ' ' + esc(who.join(', ')) : ''}</div></button>`;
  }).join('');
}
const openPicker = () => { renderVotes(); $('mapPick').hidden = false; playSfx('ui_open'); $('mapGrid').querySelector('.on, .mcard')?.focus({ preventScroll: true }); };
const closePicker = () => { if ($('mapPick').hidden) return; $('mapPick').hidden = true; playSfx('ui_close'); document.activeElement?.blur(); };
$('mapBtn').onclick = e => { e.target.closest('button').blur(); openPicker(); };
$('mapClose').onclick = closePicker;
$('mapPick').addEventListener('click', e => { if (e.target.id === 'mapPick') return closePicker(); const b = e.target.closest('[data-map]'); if (b) { vote(b.dataset.map); setTimeout(closePicker, 350); } });
let pauseShown = null;
function updatePauseNote() {
  const text = net.mode === 'client' ? net.pauseText : [...net.pausers.values()].join(', ');
  const show = text && !menuOpen && state !== 'lobby' ? text : '';
  if (show === pauseShown) return;
  pauseShown = show; $('pausedNote').style.display = show ? 'block' : 'none';
  $('pausedNote').innerHTML = `${ic('pause-button')} ${esc(show)} paused the game` + (net.mode === 'host' ? `<br><button id="resumeAll">${ic('play-button')} Resume for everyone</button>` : '');
  $('resumeAll')?.addEventListener('click', resumeAll);
}
// the host can always un-pause: clears every pause and closes friends' menus
function resumeAll() {
  net.pausers.clear(); broadcast({ t: 'unpause' });
  if (menuOpen) closeMenu();
}

function startMatch(resume = null) {   // resume = a saved endless run
  closePicker();
  if (net.mode === 'client' || state !== 'lobby') return;
  if (mode === 'endless' ? !players.some(p => p.ctrl !== 'bot') : players.length < 2) return;
  players.forEach(p => (p.wins = mode === 'endless' ? resume?.lives?.[p.custom.name] ?? 3 : 0));   // endless: wins = lives left
  Object.assign(endless, { wave: resume?.wave > 0 ? resume.wave - 1 : 0, left: 0, toSpawn: 0, boss: false, spawnT: 0, mark: null, fresh: true });
  matchMap = voteWinner();
  startRound();
}

function startRound() {
  state = 'loading'; setUI();
  const seed = 1 + Math.floor(Math.random() * 1e9);
  const want = matchMap === MAP_RANDOM ? null : matchMap;
  if (net.mode === 'host') broadcast({ t: 'map', seed, want });
  loadWithScreen(seed, want, info => {
    mapInfo = info; state = 'countdown'; countT = 4; countShown = ''; roundT = 0; suddenDeath = false;
    if (net.mode === 'host') broadcast(rosterMsg());
    players.forEach((p, i) => p.spawn(spawnPoint(i, players.length)));
    setUI();
  });
}

function toLobby() {
  state = 'lobby'; suddenDeath = false; net.pausers.clear(); loadToken++; loadBusy = false; hideLoading();
  if (net.mode !== 'client') { players.filter(p => p.custom.enemy).forEach(p => { p.remove(); players.splice(players.indexOf(p), 1); }); endless.wave = 0; rosterChanged(); }
  loadMap(0);
  if (net.mode === 'host') broadcast({ t: 'map', seed: 0 });
  if (net.mode !== 'client') players.forEach((p, i) => p.spawn(spawnPoint(i, 8)));
  setUI();
}

let hudKey = '';
function updateHUD() {
  const shown = players.filter(p => !p.custom.enemy || p.custom.boss), key = mode + shown.map(p => p.id + p.custom.name + p.custom.color).join();
  if (key !== hudKey) {
    hudKey = key;
    $('hud').innerHTML = shown.map(p => `<div class="hp" style="--c:${p.custom.color}"><b>${esc(p.custom.name)}</b> <span></span><div class="bar"><i></i></div></div>`).join('')
      + (mode === 'endless' ? '<div class="hp wave"><b id="waveNo"></b></div>' : '');
  }
  if ($('waveNo')) {
    const left = Math.max(0, endless.left - players.filter(p => p.custom.enemy && !p.alive).length);
    const h = `${ic('death-skull')} Wave ${endless.wave} &nbsp;<span class="left">${ic('skull-crossed-bones')} ${left} left</span>`;
    if ($('waveNo').dataset.h !== h) { $('waveNo').dataset.h = h; $('waveNo').innerHTML = h; }
  }
  const els = $('hud').children;
  shown.forEach((p, i) => {
    const el = els[i]; if (!el) return;
    el.classList.toggle('dead', !p.alive);
    el.classList.toggle('yolk', !!p.yolk);
    const s = el.querySelector('span'), html = (mode === 'endless' ? (p.custom.enemy ? ic('crowned-skull') : ic('hearts').repeat(Math.max(0, p.wins))) : (p.wins ? `<b class="crowns">${ic('crown')}${p.wins}</b>` : '')) + (p.yolk ? ic('fried-eggs') : '') + (p.weapon ? ic(WEAPONS[p.weapon].icon) : '') + (p.flags & 64 ? ic('chili-pepper') : '') + (p.ko > 0 && p.alive ? ic('knocked-out-stars') : '');
    if (s.dataset.h !== html) { s.dataset.h = html; s.innerHTML = html; }   // only touch the DOM when it changes
    const w = Math.round(Math.max(0, p.hp / (p.yolk ? YOLK_HP : SHELL_HP) * 100)) + '%', bar = el.querySelector('i');
    if (bar.style.width !== w) bar.style.width = w;
  });
}

const camTarget = new THREE.Vector3();
// Map pieces blocking the view of any egg are faded out (materials are swapped for see-through copies, then restored).
const occRay = new THREE.Raycaster(), faded = new Set(), occDir = new THREE.Vector3();
let occT = 0;
const seeThrough = m => Object.assign(m.clone(), { transparent: true, opacity: 0.22, depthWrite: false });
const fadeMat = o => { const s = o.userData.solidMat ?? o.material; return (o.userData.fadeMat ??= Array.isArray(s) ? s.map(seeThrough) : seeThrough(s)); };
function fade(o, on) {
  if (on) {
    o.userData.solidMat ??= o.material;
    o.material = fadeMat(o); o.castShadow = false; faded.add(o);
  } else { o.material = o.userData.solidMat; o.castShadow = true; faded.delete(o); }
}
function updateOcclusion(dt) {
  if ((occT -= dt) > 0) return;
  occT = 0.08;
  const blocking = new Set();
  for (const p of players) {
    if (!p.alive) continue;
    const target = p.model.group.position;
    occDir.subVectors(target, camera.position); const len = occDir.length();
    occRay.set(camera.position, occDir.normalize()); occRay.far = len - 0.8;
    for (const hit of occRay.intersectObject(map.group, true)) if (hit.object.isMesh && hit.object !== map.below && !hit.object.isInstancedMesh) blocking.add(hit.object);
  }
  for (const o of blocking) if (!faded.has(o)) fade(o, true);
  for (const o of faded) if (!blocking.has(o)) fade(o, false);
}
function updateCamera(dt, t) {
  if (window.__cam) { camera.position.set(...window.__cam[0]); camera.lookAt(...window.__cam[1]); return; }   // fixed camera for test screenshots (?debug)
  if (state === 'title') {   // gentle sway in front of the eggs
    camera.position.set(Math.sin(t * 0.2) * 3, 4.5, 12.5); camTarget.set(0, 1.8, 0); camera.lookAt(camTarget); return;
  }
  let ps = players.filter(p => p.alive && p.body.position.y > -3);
  if (mode === 'endless') { const team = ps.filter(p => !p.custom.enemy); if (team.length) ps = team; }
  if (net.mode !== 'off') { const mine = ps.filter(owned); if (mine.length) ps = mine; }   // online: each screen follows its own egg(s); spectate everyone once you're out
  const c = new THREE.Vector3();
  let spread = 0;
  if (ps.length) {
    ps.forEach(p => c.add(p.model.group.position)); c.divideScalar(ps.length);
    ps.forEach(p => (spread = Math.max(spread, p.model.group.position.distanceTo(c))));
  }
  const dist = THREE.MathUtils.clamp(spread * 1.3 + 10, mode === 'endless' ? 17 : 13, 46);
  camTarget.lerp(c, 1 - Math.exp(-dt * 6));
  camera.position.lerp(camTarget.clone().add(new THREE.Vector3(0, dist * 0.8, dist)), 1 - Math.exp(-dt * 4));
  camera.lookAt(camTarget);
  if (shake > 0.01) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake *= Math.exp(-dt * 9); }
}

const padPrev = {};
function pollPads() {
  for (const gp of navigator.getGamepads()) {
    if (!gp) continue;
    const prev = padPrev[gp.index] ??= {}, now = {
      start: !!gp.buttons[9]?.pressed, a: !!gp.buttons[0]?.pressed, b: !!gp.buttons[1]?.pressed,
      up: !!gp.buttons[12]?.pressed || gp.axes[1] < -0.6, down: !!gp.buttons[13]?.pressed || gp.axes[1] > 0.6,
    };
    const edge = k => now[k] && !prev[k];
    padPrev[gp.index] = now;
    const startEdge = edge('start');
    if (menuOpen || state === 'title') {
      if (edge('up')) navMove(-1);
      if (edge('down')) navMove(1);
      if (edge('a') && document.activeElement?.tagName === 'BUTTON') document.activeElement.click();
      if (edge('b') || (startEdge && menuOpen)) navBack();
      continue;
    }
    if (state === 'lobby' && gp.buttons[0]?.pressed) join('pad' + gp.index);
    if (startEdge) state === 'lobby' && players.length >= 2 && net.mode !== 'client' ? startMatch() : openMenu();
  }
}

// Trains, wrecking balls, rolling pins (hit once, then a short cooldown) and hot burners (damage while touching).
function applyHazards(dt) {
  const burning = new Map();
  for (const c of world.contacts) {
    const hb = c.bi.hazard ? c.bi : c.bj.hazard ? c.bj : null, p = (hb === c.bi ? c.bj : c.bi).player;
    if (!hb || !p || !p.alive) continue;
    const h = hb.hazard;
    if (h.active && !h.active()) continue;
    if (h.sideOnly && p.body.position.y > hb.position.y + h.sideOnly) continue;   // riding on top is fine
    if (h.dps) { burning.set(p, h.dps); continue; }
    if (p.hazardT > 0) continue;
    p.hazardT = 0.8;
    const [vx, vy, vz] = h.launch(p, hb);
    fx(h.sound || 'hit', p.body.position, p.yolk ? '#ffb21c' : p.custom.color);
    if (h.dmg) p.hurt(h.dmg, h.daze); else p.flyT = 1.3;   // springs: no damage, just a clean launch
    if (p.alive) p.body.velocity.set(vx, vy, vz);
  }
  for (const [p, dps] of burning) p.burn(dps * dt);
}

function hostFrame(dt) {
  for (const p of players) if (p.alive) p.update(dt, readInput(p));
  if (state === 'countdown') {   // hold every moving platform still until BREAK!
    for (const b of map.bodies) if (b.type === KINEMATIC) { b.velocity.setZero(); b.angularVelocity.setZero(); }
  } else {
    map.moverT += dt;
    for (const m of map.movers) m(map.moverT, dt);
  }
  for (const [, b] of map.syncs) if (b.crumbleT > 0) {   // shake, then fall
    b.crumbleT -= dt; b.position.x = b.baseX + (Math.random() - 0.5) * 0.08; b.aabbNeedsUpdate = true;
    if (b.crumbleT <= 0) { b.position.x = b.baseX; b.crumbleT = -1; b.type = DYNAMIC; b.mass = 4; b.updateMassProperties(); b.wakeUp(); }
  }
  world.step(1 / 60, dt, 4);
  applyHazards(dt);
  updateItems(dt);
  for (const p of players) {
    if (p.alive && p.body.position.y < map.killY) {
      if (state === 'lobby' || state === 'countdown') p.spawn(spawnPoint(players.indexOf(p), players.length));
      else { dropShell(p); p.remove(); fx('fall'); }
    }
  }
  for (const [, b] of map.syncs) if (b.world && b.type === DYNAMIC && b.position.y < -30) world.removeBody(b);

  if (state === 'countdown') {
    countT -= dt;
    const show = countT > 3 ? 'map' : String(Math.ceil(countT));
    if (show !== countShown && countT > 0) {
      countShown = show;
      if (show === 'map') { banner(mapInfo[0], mapInfo[1] || 'Get ready!', 1); fx('v_prepare_yourself'); }
      else { banner(show, mapInfo[0], 1); fx('v_' + show); }
    }
    if (countT <= 0) { state = 'round'; banner('BREAK!', '', 0.8); fx('v_fight'); fx('go'); }
  } else if (state === 'round' && mode === 'endless') endlessTick(dt);
  else if (state === 'round') {
    if ((roundT += dt) > 75 && !suddenDeath) { suddenDeath = true; banner('SUDDEN DEATH!', 'Everything hits harder', 2.5); fx('v_sudden_death'); }
    if (roundT > AIR_RAID) {
      if (roundT - dt <= AIR_RAID) { banner('[falling-bomb] AIR RAID!', 'Bombs incoming — finish it!', 2.2); fx('horn'); bombT = 1.2; }
      if ((bombT -= dt) <= 0) { bombT = Math.max(0.55, 2.4 - (roundT - AIR_RAID) * 0.045); dropBomb(); }
    }
    const alive = players.filter(p => p.alive);
    if (alive.length <= 1) {
      state = 'roundEnd'; endT = 4;
      if (alive[0]) { alive[0].wins++; alive[0].cheer = true; banner(`${alive[0].custom.name} WINS!`, `[crown] ${alive[0].wins} crown${alive[0].wins > 1 ? 's' : ''}`, 3.5); fx('v_winner'); }
      else { banner('DRAW!', 'All eggs broke', 3.5); fx('v_its_a_tie'); }
      fx('jingle'); rosterChanged();
    }
  } else if (state === 'roundEnd' && (endT -= dt) <= 0) mode === 'endless' ? toLobby() : startRound();
  if (net.mode === 'host') hostSend(dt);
}

// ---------- touch controls: left thumb = floating stick, right thumb = buttons ----------
const touchIn = { x: 0, z: 0, jump: false, punch: false, grab: false, drop: false, block: false };
if (IS_TOUCH) {
  document.body.classList.add('touch');
  $('lobby').querySelector('.hint').innerHTML = ic('smartphone') + ' Tap the empty card to join &nbsp;·&nbsp; Crack every other egg off the map!';
  document.querySelector('#title .foot').textContent = 'Tap to choose';
  for (const id of ['menuBtn', 'mapClose']) $(id).innerHTML = $(id).innerHTML.replace(' (Esc)', '');   // no keyboard on phones
  const tips = document.querySelector('#ctlPanel .tips'); tips.prepend(tips.lastElementChild);   // phone tip first
  const fsb = document.querySelector('[data-m="fullscreen"]');
  if (document.documentElement.requestFullscreen) fsb.innerHTML = fsb.innerHTML.replace(' (F11)', ''); else fsb.style.display = 'none';   // iPhone Safari has no fullscreen
  const zone = $('stickZone'), base = $('stickBase'), knob = $('stickKnob'), R = 55;
  let sid = null, ox = 0, oy = 0;
  const move = e => {
    if (e.pointerId !== sid) return;
    let dx = e.clientX - ox, dy = e.clientY - oy; const l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`; touchIn.x = dx / R; touchIn.z = dy / R;
  };
  const capture = (el, id) => { try { el.setPointerCapture(id); } catch {} };   // keeps the finger tracked even if it slides off
  zone.addEventListener('pointerdown', e => { sid = e.pointerId; capture(zone, sid); ox = e.clientX; oy = e.clientY; base.style.left = ox + 'px'; base.style.top = oy + 'px'; move(e); });
  zone.addEventListener('pointermove', move);
  const end = e => { if (e.pointerId !== sid) return; sid = null; touchIn.x = touchIn.z = 0; knob.style.transform = base.style.left = base.style.top = ''; };
  zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  for (const b of document.querySelectorAll('#touchBtns [data-k]')) {
    const set = v => e => { touchIn[b.dataset.k] = v; b.classList.toggle('on', v); if (v) capture(b, e.pointerId); };
    b.addEventListener('pointerdown', set(true)); b.addEventListener('pointerup', set(false)); b.addEventListener('pointercancel', set(false));
  }
  $('touchPause').addEventListener('click', () => openMenu());
  // first tap: go fullscreen + landscape where the browser allows it
  addEventListener('pointerdown', () => { document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {}); }, { once: true });
}
// Phones: iOS Safari ignores user-scalable=no, so block pinch-zoom and double-tap zoom ourselves (spam-tapping zoomed the page in)
for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => { if (e.touches.length > 1 || (e.scale !== undefined && e.scale !== 1)) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', e => {   // a second tap within 350 ms would be read as "zoom in": swallow it (touch controls use pointer events, unaffected)
  const now = performance.now();
  if (now - lastTouchEnd < 350 && !e.target.closest?.('input')) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });
// browsers only start audio after a tap/click
addEventListener('pointerdown', () => { if (ac.state === 'suspended') ac.resume(); });
if (!IS_APP) document.querySelectorAll('[data-t="quit"], [data-m="quit"]').forEach(b => (b.hidden = true));   // a web page can't quit itself
function updateTouchUI() {
  const on = IS_TOUCH && state !== 'lobby' && state !== 'title' && !menuOpen && players.some(p => p.alive && owned(p) && localCtrl(p) === 'touch');
  if (on) $('dropBtn').hidden = !players.some(p => p.alive && p.weapon && owned(p) && localCtrl(p) === 'touch');
  if ($('touch').hidden === on) { $('touch').hidden = !on; if (!on) { Object.assign(touchIn, { x: 0, z: 0, jump: false, punch: false, grab: false, drop: false, block: false }); document.querySelectorAll('#touchBtns .on').forEach(b => b.classList.remove('on')); } }
}

let last = performance.now();
function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)), t = now / 1000; last = Math.max(last, now);
  pollPads();
  if (net.mode === 'client') clientFrame(dt);
  else if (!paused && !net.pausers.size && freezeT <= 0 && !loadBusy) hostFrame(dt);
  else if (net.mode === 'host') hostSend(dt);   // keep clients updated (and showing the pause note)
  updatePauseNote(); updateTouchUI();
  for (const p of players) if (p.alive) p.sync(freezeT > 0 ? dt * 0.12 : dt, t);
  freezeT -= dt;
  for (const [mesh, body] of map.syncs) { mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); }
  renderItems(net.mode === 'client' ? net.items : map.items.map(itemRow), t);
  updateParts(dt); updatePuffs(dt); updateFlashes(dt); updateMarks(dt, t);
  if (lowPoly && (lowT -= dt) <= 0) { lowT = 0.4; lowify(scene); }
  if (map.below && map.scrollBelow) map.below.material.map.offset.x += dt * 0.02;
  const anyPause = paused || net.hostPaused || net.pausers.size > 0;
  map.frozen = state === 'countdown' || anyPause;
  music.play(state === 'lobby' || state === 'title' ? 'lobby' : suddenDeath ? 'intense' : 'battle');
  music.volume.value += ((anyPause ? 0.3 : 1) - music.volume.value) * Math.min(1, dt * 4);   // duck while paused   // scenery waits for BREAK! too
  for (const v of map.visuals) v(map.h, t, dt);
  if (map.deco) map.deco.rotation.y += dt * 0.01;
  if (bannerT > 0 && (bannerT -= dt) <= 0) $('banner').style.display = 'none';
  if (state !== 'lobby') updateHUD();
  updateCamera(dt, t);
  if (state === 'title') animateTitle(dt, t);
  updateOcclusion(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

setOnlineUI();
showLoading('BREAK MY EGGS', 'Loading models & sounds…');
await Promise.all([loadModels(f => setLoad(0.08 + f * 0.8)), loadSounds()]);
document.querySelectorAll('i[data-i]').forEach(e => e.outerHTML = ic(e.dataset.i));
setLowPoly(lowPoly);
renderMode();
// A PC web browser only gets the download page: on PC the game is the Windows app (phones install the web app)
if (SITE_URL && /^https?:$/.test(location.protocol) && !IS_APP && !IS_TOUCH) { $('dlPage').hidden = false; renderShare($('dlBody')); }
else { toTitle(); requestAnimationFrame(frame); }
setLoad(1); hideLoading(600);
if (qs.get('join') && $('dlPage').hidden) {
  const code = qs.get('join'); qs.delete('join'); history.replaceState(null, '', location.pathname + (qs.size ? '?' + qs : ''));
  document.querySelector('[data-t="online"]').click(); $('codeIn').value = code; net.autoJoin = true; joinOnline(code);
}
if (location.search.includes("debug")) window.__dbg = { toTitle, ac, music, buffers: () => Object.keys(buffers).length, faded: () => faded.size, frame, scene, camera, renderer, world, loadMap, players, map, net, join, startMatch, toLobby, hostOnline, joinOnline, LAYOUTS, endless, spawnFoe, dropBomb, spawnPickup, SET_PIECES, ed, vote, mapChoices, get state() { return state; }, get roundT() { return roundT; }, get loadBusy() { return loadBusy; } };

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { COLORS, PATTERNS, HATS, FACES, OUTFITS, ATTACKS, buildModel, animate, weaponMesh, setWeapon, toon } from './models.js';
import { createSetPieces } from './setpieces.js';
import { loadModels, model } from './assets.js';
import { createMusic } from './music.js';
import qrcode from 'three/addons/qrcode.mjs';
import { ic, icText } from './lib/icons.mjs';

// The always-latest online copy of the game (GitHub Pages). On the web it's wherever this page lives;
// the PC app passes it in (?site=) when it falls back to its built-in copy.
const qs = new URLSearchParams(location.search);
const SITE_URL = /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname) ? location.href.split(/[?#]/)[0].replace(/[^/]*$/, '') : qs.get('site') || '';
const qrImg = text => { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createDataURL(6, 2); };

// ---------- engine ----------
// phones/tablets get touch controls and a lighter renderer (?touch forces it for testing)
const IS_TOUCH = (matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0) || location.search.includes('touch');
const IS_APP = navigator.userAgent.includes('Electron');
const renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH });
// Retro mode (Settings): ~300-line pixelated picture, PS1/PS2-style wobbly vertices, closer fog
let retro = false; try { retro = localStorage.getItem('egg-retro') === '1'; } catch {}
const pixelRatio = () => retro ? 300 / innerHeight : Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2);
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
  renderer.setPixelRatio(pixelRatio()); renderer.setSize(innerWidth, innerHeight);
});
// vertex snapping: every built-in material's project_vertex chunk rounds screen positions to a coarse grid.
// The program cache key includes the mode, so flagging materials for update recompiles them with the current chunk.
// ponytail: materials compiled before a toggle that aren't in the scene right then keep the old look until rebuilt.
const PROJECT = THREE.ShaderChunk.project_vertex;
THREE.Material.prototype.customProgramCacheKey = function () { return (retro ? 'retro' : '') + this.onBeforeCompile; };
const fogRange = () => retro ? [28, 110] : [55, 160];
function applyRetro() {
  THREE.ShaderChunk.project_vertex = retro ? PROJECT + '\ngl_Position.xy = floor(gl_Position.xy / gl_Position.w * 110.0 + 0.5) / 110.0 * gl_Position.w;' : PROJECT;
  scene.traverse(o => [].concat(o.material || []).forEach(m => { m.needsUpdate = true; }));
  renderer.setPixelRatio(pixelRatio()); renderer.setSize(innerWidth, innerHeight);
  renderer.domElement.style.imageRendering = retro ? 'pixelated' : '';
  if (scene.fog) [scene.fog.near, scene.fog.far] = fogRange();
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
  hit: ['punch', 0.9], glove: ['punchHeavy', 1], bat: ['wood', 1], pan: ['bell', 0.8], bonk: ['metal', 0.9], crate: ['plank', 0.7],
  boom: ['punchHeavy', 0.7, 'boom'], fire: ['ui_confirmation', 0.6, 'sizzle'], crack: ['glass', 1, 'crack'], splat: ['soft', 1, 'splat'], grab: ['softMed', 0.45], climb: ['ui_pluck', 0.6],
  pickup: ['ui_confirmation', 0.6], join: ['ui_confirmation', 0.7], land: ['softMed', 0.25],
  jingle: ['jingle_win', 0.8], punch: [null, 0, 'punch'],
};
const SYNTH = {
  punch: [260, 90, 0.08, 'triangle', 0.08], jump: [300, 600, 0.12, 'sine', 0.1], swing: [500, 150, 0.12, 'sawtooth', 0.08], shoot: [700, 200, 0.12, 'square', 0.12],
  fall: [700, 90, 0.9, 'sine', 0.15], win: [400, 1200, 0.7, 'triangle', 0.1], go: [880, 880, 0.35, 'square', 0.08], horn: [196, 185, 1.4, 'sawtooth', 0.15],
  windup: [160, 320, 0.16, 'sine', 0.06], pop: [420, 900, 0.12, 'square', 0.12], slip: [1200, 180, 0.35, 'sine', 0.14],
};
const NOISE = { boom: [1.2, 'lowpass', 260, 1.1], crack: [6, 'highpass', 1500, 0.35], splat: [2, 'lowpass', 500, 0.4], sizzle: [1, 'highpass', 3500, 0.12] };
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
  if (name.startsWith('v_')) { group = 'voice_' + name.slice(2); vol = 1; }
  if (name.startsWith('ui_')) { group = name; vol = 0.6; }
  const list = buffers[group];
  if (list) {
    const s = ac.createBufferSource(); s.buffer = list[Math.floor(Math.random() * list.length)];
    if (!/^(voice|ui|jingle)/.test(group)) s.playbackRate.value = 0.9 + Math.random() * 0.2;
    s.connect(out(vol * gain, pan)); s.start();
  }
  if (NOISE[synth]) {
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
// One call = sound + particles, replicated to online clients by the host.
function fx(name, pos, color = '#fff4e0') {
  playSfx(name, pos);
  if (pos) {
    if (['hit', 'bonk', 'bat', 'pan', 'glove'].includes(name)) burst(pos.x, pos.y + 0.3, pos.z, color, 6, shardGeo, 5);
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
const FIST = { range: 1.7, cone: 0.4, dmg: 12, kb: 4.5, up: 2.5, cool: 0.35 };
const YOLK_FIST = { range: 1.5, cone: 0.4, dmg: 6, kb: 3, up: 2, cool: 0.4 };
const WEAPONS = {
  bat: { icon: 'baseball-bat', kind: 3, uses: 8, cool: 0.5, range: 2.4, cone: 0.25, dmg: 22, kb: 8, up: 4, sound: 'bat' },
  pan: { icon: 'saucepan', kind: 4, uses: 6, cool: 0.55, range: 2.0, cone: 0.35, dmg: 32, kb: 6, up: 5, daze: 0.8, sound: 'pan' },
  glove: { icon: 'boxing-glove', kind: 5, uses: 6, cool: 0.45, range: 2.0, cone: 0.3, dmg: 10, kb: 12, up: 5, sound: 'glove' },
  blaster: { icon: 'raw-egg', kind: 6, uses: 6, cool: 0.4, shoot: true },
  hammer: { icon: 'claw-hammer', kind: 4, uses: 4, cool: 0.7, range: 2.3, cone: 0.3, dmg: 28, kb: 13, up: 7, daze: 1, sound: 'bonk' },
  bombs: { icon: 'unlit-bomb', kind: 8, uses: 3, cool: 0.6, toss: 'bomb' },
  banana: { icon: 'banana', kind: 8, uses: 3, cool: 0.4, toss: 'peel' },
};
// weapons, a blaster shot, a spare shell, a power-up, then things lying in the world (lit bomb, banana peel)
const ITEM_KINDS = ['bat', 'pan', 'glove', 'blaster', 'egg', 'shell', 'hammer', 'bombs', 'banana', 'pepper', 'bomb', 'peel'];
const PICKUPS = ['bat', 'pan', 'glove', 'blaster', 'hammer', 'bombs', 'banana', 'pepper'], WORLD_ITEMS = ['egg', 'bomb', 'peel'];
const SHELL_HP = 100, YOLK_HP = 40;
const UP = new THREE.Vector3(0, 1, 0), yawQ = new THREE.Quaternion(), tmpE = new THREE.Euler();
let nextId = 1;

// Egg = two stacked spheres; yolk = one low sphere (same feet height, lighter so it flies further).
function setShapes(b, yolk) {
  const old = [...b.shapes];
  b.addShape(new CANNON.Sphere(0.5), new CANNON.Vec3(0, -0.4, 0));
  if (!yolk) b.addShape(new CANNON.Sphere(0.5), new CANNON.Vec3(0, 0.4, 0));
  old.forEach(sh => b.removeShape(sh));
  b.mass = yolk ? 3.5 : 5; b.updateMassProperties();
}

class Player {
  constructor(ctrl, custom, id = nextId++) {
    this.id = id; this.ctrl = ctrl; this.custom = custom; this.wins = 0;
    this.body = new CANNON.Body({ mass: 5, material: playerMat, fixedRotation: true, linearDamping: 0.05, angularDamping: 0.3, collisionFilterGroup: G_PLAYER });
    setShapes(this.body, false);
    this.body.player = this;
    Object.assign(this, { alive: false, prev: {}, flags: 4, hp: SHELL_HP, yolk: false, attackT: -1, attackKind: 0 });
    this.rebuild();
  }
  rebuild() {
    if (this.model) scene.remove(this.model.group, this.tag, this.arrow, this.ring);
    this.model = buildModel(this.custom);
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
    if (this.yolk) setShapes(b, false);
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
    this.hp -= dmg * (suddenDeath ? 1.5 : 1); this.stun = 0.35; this.release(); this.endHang();
    if (this.attackT >= 0 && this.attackT < ATTACKS[this.attackKind].windup) this.attackT = -1;   // hit during wind-up = interrupted
    if (this.hp <= 0) return this.yolk ? this.splat() : this.breakShell();
    if (daze) this.daze(daze);
  }
  burn(amount) {   // damage over time (hot stove) without stagger
    if (this.invuln > 0 || !this.alive) return;
    this.hp -= amount;
    if ((this.burnFx = (this.burnFx || 0) - amount) <= 0) { this.burnFx = 4; fx('sizzle', this.body.position); }
    if (this.hp <= 0) this.yolk ? this.splat() : this.breakShell();
  }
  daze(t) {   // ragdoll tumble with dizzy stars
    if (this.ko > 0) { this.ko = Math.max(this.ko, t); return; }
    this.ko = t; this.attackT = -1;
    const b = this.body; b.fixedRotation = false; b.linearDamping = 0.6; b.updateMassProperties();
    b.angularVelocity.set(R(-6, 6), R(-3, 3), R(-6, 6));
  }
  breakShell() {   // shell shatters: you're a yolk now, go find a new shell!
    fx('crack', this.body.position, this.custom.color);
    Object.assign(this, { yolk: true, hp: YOLK_HP, weapon: null, invuln: 0.8 });
    setShapes(this.body, true);
    this.daze(1.2);
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
    b.position.y += 0.6; b.velocity.y = 4;
  }
  targets() {
    return [...players.filter(p => p !== this && p.alive).map(p => p.body), ...map.crates.filter(c => c.world)];
  }
  attackDef() { return this.yolk ? YOLK_FIST : WEAPONS[this.weapon] || FIST; }
  startAttack() {
    const w = this.attackDef();
    if (w.kind) this.attackKind = w.kind;
    else { this.arm ^= 1; this.attackKind = this.arm ? 2 : 1; }
    this.attackT = 0; this.cool = ATTACKS[this.attackKind].windup + w.cool;
    fx('windup');
  }
  strike() {
    const w = this.attackDef(), f = this.facing(), me = this.body.position;
    if (w.shoot) shoot(this, f);
    else if (w.toss) toss(this, f, w.toss);
    else {
      fx(this.weapon ? 'swing' : 'punch');
      for (const t of this.targets()) {
        const dx = t.position.x - me.x, dz = t.position.z - me.z, dist = Math.hypot(dx, dz) || 1;
        if (dist > w.range || Math.abs(t.position.y - me.y) > (t.player?.hang ? 2 : 1.6) || (dx * f.x + dz * f.z) / dist < w.cone) continue;
        const tp = t.player, pow = (tp?.ko > 0 ? 1.3 : 1) * (tp?.yolk ? 1.3 : 1) * (suddenDeath ? 1.4 : 1) * (this.boostT > 0 ? 1.35 : 1);
        t.applyImpulse(new CANNON.Vec3(f.x * w.kb * pow * t.mass, w.up * pow * t.mass, f.z * w.kb * pow * t.mass));
        fx(tp ? w.sound || 'hit' : 'crate', t.position, tp ? (tp.yolk ? '#ffb21c' : tp.custom.color) : undefined);
        tp?.hurt(w.dmg * (this.boostT > 0 ? 1.35 : 1), w.daze || 0);
      }
    }
    if (this.weapon && --this.ammo <= 0) this.weapon = null;
  }
  tryGrab() {
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
    this.cool -= dt; this.stun -= dt; this.invuln -= dt; this.hazardT -= dt; this.flyT -= dt; this.boostT -= dt;
    if (this.holding && (!this.holding.world || (this.holdT += dt) > 4)) this.release();
    if (this.attackT >= 0) {   // wind-up → strike → recover
      const W = ATTACKS[this.attackKind].windup, before = this.attackT;
      this.attackT += dt;
      if (before < W && this.attackT >= W && this.attackKind !== 7 && !(this.ko > 0)) this.strike();
      if (this.attackT > W + 0.35) this.attackT = -1;
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
      let cx = 0, cz = 0;   // ride moving/spinning platforms
      if (ground?.type === KINEMATIC) { const w = ground.angularVelocity.cross(b.position.vsub(ground.position)); cx = ground.velocity.x + w.x; cz = ground.velocity.z + w.z; }
      if (ground?.belt) [cx, cz] = ground.belt;   // conveyor belts
      let { x, z } = inp; const len = Math.hypot(x, z);
      if (len > 1) { x /= len; z /= len; }
      const speed = (this.holding ? MOVE.holdSpeed : this.yolk ? MOVE.speed * 1.08 : MOVE.speed) * (this.attackT >= 0 ? 0.55 : 1) * (this.boostT > 0 ? 1.4 : 1);
      const accel = (ground ? (map.slippery || ground.ice ? MOVE.iceAccel : MOVE.accel) : MOVE.airAccel) * (this.flyT > 0 ? 0 : this.stun > 0 || this.heldBy ? 0.15 : 1);   // flyT: spring launch, pure ballistic arc
      const k = 1 - Math.exp(-accel * dt);
      v.x += (x * speed + cx - v.x) * k; v.z += (z * speed + cz - v.z) * k;
      if (len > 0.2) this.yaw = lerpAngle(this.yaw, Math.atan2(x, z), 1 - Math.exp(-MOVE.turn * dt));

      this.coyote = ground ? MOVE.coyote : this.coyote - dt;
      this.jumpBuf = edge('jump') ? MOVE.buffer : this.jumpBuf - dt;
      if (this.jumpBuf > 0 && this.coyote > 0 && !this.heldBy) { v.y = MOVE.jump; this.jumpBuf = this.coyote = 0; fx('jump'); }
      if (!ground && v.y < 0 && !(this.flyT > 0)) v.y -= MOVE.fallExtra * dt;
      if (!ground && v.y > 0 && !inp.jump && !(this.flyT > 0)) v.y -= MOVE.shortHop * dt;

      if (edge('punch') && this.cool <= 0 && this.attackT < 0) this.holding ? this.throw() : this.startAttack();
      if (inp.grab && !this.holding && !(!ground && v.y < 3 && this.tryLedge())) this.tryGrab();
      if (!inp.grab && this.holding) this.release();
      if (this.joint) { const f = this.facing(); this.joint.pivotA.set(f.x * 1.1, 0.5, f.z * 1.1); }
    }
    this.flags = (this.holding ? 1 : 0) | (this.heldBy ? 2 : 0) | (ground ? 4 : 0) | (this.cheer ? 8 : 0) | (this.hang ? 16 : 0) | (this.yolk ? 32 : 0) | (this.boostT > 0 ? 64 : 0);
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
    if ((this.flags & 64) && Math.random() < dt * 14) burst(b.position.x, b.position.y + 0.3, b.position.z, Math.random() < 0.5 ? '#ff7a00' : '#ffd000', 1, shardGeo, 1.5);   // fired up by a pepper
    const stepI = Math.floor(this.model.a.phase / Math.PI), near = camera.position.distanceTo(group.position) < 45;
    if (stepI !== this.stepI) { this.stepI = stepI; if ((this.flags & 4) && near && Math.hypot(v.x, v.z) > 2) playSfx('step', b.position); }
    const grounded = !!(this.flags & 4);
    if (grounded && this.wasAir > 0.35 && near) playSfx('land', b.position);
    this.wasAir = grounded ? 0 : (this.wasAir || 0) + dt;
    this.tag.position.set(b.position.x, b.position.y + (this.yolk ? 1.3 : 2), b.position.z);
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
  { name: 'Sunny Docks', step: 'wood', sky: '#4aa8f0', fog: '#cdeeff', below: '#2a7ab8', tex: 'planks', cols: ['#c98b52', '#b07a46', '#e0a96d'] },
  { name: 'Candy Land', step: 'carpet', sky: '#ff8fcf', fog: '#ffe4f3', below: '#ff9ccf', tex: 'tiles', cols: ['#ff8fc7', '#9be7ff', '#fff27a', '#b4f8a4'] },
  { name: 'Neon Night', sky: '#05020f', fog: '#1e1045', below: '#3a0a5a', tex: 'grid', cols: ['#ff2e88', '#2ef2ff', '#8a2eff'], glow: true },
  { name: 'Frosty Peaks', step: 'snow', sky: '#7fbfff', fog: '#eef7ff', below: '#e8f4ff', tex: 'snow', cols: ['#ffffff', '#d6efff', '#bfe3ff'], slippery: true },
  { name: 'Toxic Factory', sky: '#1f2a18', fog: '#55663a', below: '#7dff3a', tex: 'metal', cols: ['#8a8a8a', '#9a8a5a', '#6f7a6f'], glowBelow: true },
  { name: 'Lava Rooftops', sky: '#c8401a', fog: '#ffb380', below: '#ff4400', tex: 'brick', cols: ['#a0583e', '#8a4a38', '#b06a50'], glowBelow: true },
  { name: 'Breakfast Kitchen', step: 'wood', sky: '#ffd88a', fog: '#fff6e0', below: '#f4efe6', tex: 'checker', cols: ['#ffffff', '#ffe2b8', '#ffc4a8'] },
  { name: 'Farmyard', step: 'grass', sky: '#5ec4ff', fog: '#e6f7ff', below: '#4f9a42', tex: 'grass', cols: ['#7fb069', '#93c47d', '#a7c96b'] },
];

const map = { group: null, bodies: [], syncs: [], movers: [], visuals: [], h: [], crates: [], items: [], spawns: null, slippery: false, theme: THEMES[0], seed: 0, below: null, deco: null, pickupT: 0, bounds: [18, 18] };

function clearMap() {
  if (map.group) {   // free GPU memory (shared pattern textures in TEX are kept)
    scene.remove(map.group);
    map.group.traverse(o => { if (o.userData.shared) return; o.geometry?.dispose(); [].concat(o.material || []).forEach(m => m.dispose()); });   // shared = cached model data
    map.below?.material.map.dispose(); scene.background?.dispose?.();
  }
  for (const b of map.bodies) if (b.world) world.removeBody(b);
  faded.clear();
  Object.assign(map, { group: new THREE.Group(), bodies: [], syncs: [], movers: [], visuals: [], h: [], crates: [], items: [], spawns: null, slippery: false, pickupT: 3, moverT: 0, bounds: [18, 18], deco: null, killY: -14, spawnY: 3 });
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
const SET_PIECES = createSetPieces({ THREE, CANNON, map, addBody, addBox, addCyl, mat, toon, patternTex, boxGeo, R, pick, rnd: () => rand(), fx, banner: (...a) => banner(...a), KINEMATIC, model, players: () => players, world, renderer, explode });
const LAYOUT_HINTS = { Crumble: 'Tiles fall after you step on them!', 'Tilting Pan': "Don't slide off!", Conveyors: 'Ride the moving platforms', Elevators: 'Take the lifts up', Spinner: 'Jump the beam!' };

function buildMap(theme, layout) {
  map.theme = theme; clearMap();
  scene.background = skyTex(theme.sky, theme.fog);
  scene.fog = new THREE.Fog(theme.fog, ...fogRange());
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
function addProps(theme, count) {
  const keepClear = map.spawns ? map.spawns.map(([x, z]) => [x, z]) : Array.from({ length: 8 }, (_, i) => [Math.cos(i / 8 * Math.PI * 2) * 5, Math.sin(i / 8 * Math.PI * 2) * 5]);
  for (let n = 0, tries = 0; n < count && tries < count * 8; tries++) {
    const x = R(-18, 18), z = R(-18, 18), hit = castDown(x, 20, z, -5);
    if (!hit || hit.body.type !== STATIC || hit.body.crumble || hit.body.isProp || Math.hypot(x, z) < 2.5 || keepClear.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 2.5)) continue;
    const [r, h, build] = PROPS[pick(THEME_PROPS[theme.name])], y = hit.hitPointWorld.y, g = new THREE.Group();
    build(g); g.position.set(x, y, z); g.rotation.y = R(0, 6.28); map.group.add(g);
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(r, r, h, 12), material: world.defaultMaterial, position: new CANNON.Vec3(x, y + h / 2, z), collisionFilterGroup: G_MAP });
    body.isProp = true; world.addBody(body); map.bodies.push(body); n++;
  }
}

// seed 0 = lobby. want = a set-piece name or MAP_CLASSIC (from the map vote), else random. Returns [name, hint].
function loadMap(seed, want = null) {
  map.seed = seed; map.want = want;
  return withSeed(seed || 1, () => {
    if (!seed) {
      buildMap(THEMES[7], () => addBox(22, 1.5, 22, [0, -0.75, 0]));
      for (let i = 0; i < 6; i++) addCrate(R(-7, 7), 3 + i, R(-9, -5));
      addProps(THEMES[7], 8);
      addDeco(THEMES[7]);
      return ['Lobby', ''];
    }
    const big = rand() < 0.8;
    if (want ? want !== MAP_CLASSIC : big) {   // big hand-built maps with moving hazards
      const name = SET_PIECES[want] ? want : pick(Object.keys(SET_PIECES)), sp = SET_PIECES[name];
      buildMap(sp.theme, sp.build); map.bounds = sp.bounds;
      for (let i = 0; i < 4; i++) { const x = R(-0.7, 0.7) * sp.bounds[0], z = R(-0.7, 0.7) * sp.bounds[1]; if (castDown(x, 20, z, -5)) addCrate(x, 6 + i, z); }
      return [name, sp.hint];
    }
    const theme = pick(THEMES), name = pick(Object.keys(LAYOUTS));
    buildMap(theme, LAYOUTS[name]);
    const n = Math.floor(R(3, 9));
    for (let i = 0; i < n; i++) { const x = R(-8, 8), z = R(-8, 8); if (castDown(x, 20, z, -5)) addCrate(x, 6 + i, z); }   // only over solid ground
    addProps(theme, Math.floor(R(8, 15)));
    addDeco(theme);
    const extra = [LAYOUT_HINTS[name]];
    if (rand() < 0.2) { world.gravity.y = -13; extra.push('LOW GRAVITY!'); }
    if (map.slippery) extra.push('SLIPPERY!');
    return [`${theme.name} ${name}`, extra.filter(Boolean).join(' · ')];
  });
}

function spawnPoint(i, n) {
  if (map.spawns) { const [x, z, y = map.spawnY] = map.spawns[i % map.spawns.length]; return [x + (Math.random() - 0.5) * 0.6, y, z]; }
  const a = i / Math.max(n, 1) * Math.PI * 2;
  return [Math.cos(a) * 5, 3, Math.sin(a) * 5];
}

// ---------- items: weapon pickups + blaster shots ----------
function spawnPickup() {
  const yolks = players.some(p => p.alive && p.yolk);
  const kind = Math.random() < (yolks ? 0.5 : 0.15) ? 'shell' : PICKUPS[Math.floor(Math.random() * PICKUPS.length)];
  for (let i = 0; i < 25; i++) {
    const x = (Math.random() * 2 - 1) * map.bounds[0], z = (Math.random() * 2 - 1) * map.bounds[1], hit = castDown(x, 15, z, -5);
    if (hit && hit.body.type === STATIC && !hit.body.crumble && !hit.body.hazard) {
      map.items.push({ kind, pos: new CANNON.Vec3(x, hit.hitPointWorld.y + 0.8, z) });
      return;
    }
  }
}
// a fallen egg leaves its spare shell where it last stood
function dropShell(p) {
  if (p.yolk || !p.lastGround) return;
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
        const d = it.dir, t = it.hitP.body;
        t.applyImpulse(new CANNON.Vec3(d.x * 6 * t.mass, 3 * t.mass, d.z * 6 * t.mass));
        it.hitP.hurt(14); it.hitP = null;
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
    const p = players.find(q => q.alive && !(q.ko > 0) && (shell ? q.yolk : pepper ? !q.yolk : !q.yolk && !q.weapon) && q.body.position.distanceTo(it.pos) < 1.3);
    if (!p) continue;
    if (shell) p.regainShell();
    else if (pepper) { p.boostT = 9; fx('fire', p.body.position); }   // fired up: faster, harder hits
    else { p.weapon = it.kind; p.ammo = WEAPONS[it.kind].uses; }
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
  kb1: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', punch: 'KeyJ', grab: 'KeyK' },   // right hand on J/K, away from WASD
  kb2: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', jump: 'ShiftRight', punch: 'Period', grab: 'Slash' },
};
const NONE = { x: 0, z: 0, jump: false, punch: false, grab: false };

function readLocal(ctrl) {
  if (ctrl === 'touch') return touchIn;
  if (ctrl.startsWith('pad')) {
    const gp = navigator.getGamepads()[+ctrl.slice(3)];
    if (!gp) return NONE;
    const dz = v => (Math.abs(v) < 0.2 ? 0 : v), btn = i => !!gp.buttons[i]?.pressed;
    return {
      x: dz(gp.axes[0]) || btn(15) - btn(14), z: dz(gp.axes[1]) || btn(13) - btn(12),
      jump: btn(0), punch: btn(2) || btn(3), grab: btn(1) || btn(4) || btn(5) || btn(6) || btn(7),
    };
  }
  const m = KB[ctrl], k = c => [].concat(c).some(x => keys.has(x));
  return { x: k(m.right) - k(m.left), z: k(m.down) - k(m.up), jump: k(m.jump), punch: k(m.punch), grab: k(m.grab) };
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
  if (!(p.flags & 4) && p.body.velocity.y < 1) inp.grab = true;   // airborne: try to catch a ledge
  let tgt = null, bd = Infinity;
  for (const o of players) if (o !== p && o.alive && o.body.position.y > -3) {
    const d = o.body.position.distanceTo(me); if (d < bd) { bd = d; tgt = o; }
  }
  let goal = tgt?.body.position;
  if (p.yolk) { let sd = Infinity; for (const it of map.items) if (it.kind === 'shell' && it.pos.distanceTo(me) < sd) { sd = it.pos.distanceTo(me); goal = it.pos; } }
  else if (!p.weapon) for (const it of map.items) if (it.pos && PICKUPS.includes(it.kind) && it.pos.distanceTo(me) < Math.min(bd, 8)) goal = it.pos;
  if (!goal) return inp;
  const l = Math.hypot(goal.x - me.x, goal.z - me.z) || 1, dx = (goal.x - me.x) / l, dz = (goal.z - me.z) / l;
  p.bot.leap -= 1 / 60;
  if (castDown(me.x + dx * 1.3, me.y, me.z + dz * 1.3, me.y - 6) || l < 1.4 || p.bot.leap > 0) { inp.x = dx; inp.z = dz; p.bot.stuck = 0; inp.jump = p.bot.leap > 0; }
  else if ((p.bot.stuck += 1 / 60) > 1 + Math.random() * 2) { inp.x = dx; inp.z = dz; inp.jump = true; p.bot.leap = 0.6; p.bot.stuck = 0; }
  if (goal.y > me.y + 1 && Math.random() < 0.05) inp.jump = true;
  if (bd < ({ blaster: 9, bombs: 7, banana: 3 }[p.weapon] || 2.1) && p.attackT < 0) inp.punch = Math.random() < 0.08;
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
const rosterMsg = () => ({ t: 'roster', players: players.map(p => ({ id: p.id, ctrl: p.ctrl, custom: p.custom, wins: p.wins })) });
const r3 = v => Math.round(v * 1000) / 1000;

function setOnlineUI() {
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

// remote players' customizations are untrusted: only keep known values
function sanitize(c = {}) {
  return {
    name: String(c.name || 'Friend').slice(0, 12),
    color: COLORS.includes(c.color) ? c.color : COLORS[0], color2: COLORS.includes(c.color2) ? c.color2 : COLORS[2],
    pattern: PATTERNS.includes(c.pattern) ? c.pattern : 'Plain',
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
    const conn = net.conn = peer.connect(ROOM(code), { reliable: true, serialization: 'json' });
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
      if (!p) p = new Player(e.ctrl, sanitize(e.custom), e.id);
      else if (JSON.stringify(p.custom) !== JSON.stringify(sanitize(e.custom))) { p.custom = sanitize(e.custom); p.rebuild(); }
      p.wins = e.wins; return p;
    });
    players.splice(0, players.length, ...next);
    renderCards();
  } else if (d.t === 'map') {
    loadMap(d.seed, d.want); net.items = [];
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
    const c = localCtrl(p), inp = readLocal(c), pr = net.presses[c] ??= { prev: {}, jumpC: 0, punchC: 0 };
    if (inp.jump && !pr.prev.jump) pr.jumpC++;
    if (inp.punch && !pr.prev.punch) pr.punchC++;
    pr.prev = inp;
    inputs[c] = { ...inp, jumpC: pr.jumpC, punchC: pr.punchC };
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
  return sanitize({ name: `Egg ${i + 1}`, color: COLORS[(i * 3) % COLORS.length], color2: COLORS[(i * 3 + 5) % COLORS.length], pattern: PATTERNS[i % PATTERNS.length] });
}
function saveCustom(p) {
  if (p.ctrl !== 'bot') try { localStorage.setItem('egg-' + localCtrl(p), JSON.stringify(p.custom)); } catch {}
}
const randomCustom = name => ({ name, color: pick(COLORS), color2: pick(COLORS), pattern: pick(PATTERNS), hat: pick(HATS), face: pick(FACES), outfit: pick(OUTFITS) });

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

let cardsDirty = false;
const cycler = (act, icon, val) => `<div class="cyc"><button data-act="${act}" data-v="-1">${ic('play-button', 'flip')}</button><span>${ic(icon)} ${val}</span><button data-act="${act}" data-v="1">${ic('play-button')}</button></div>`;
const swatches = (act, cur) => `<div class="sw">${COLORS.map(k => `<span data-act="${act}" data-v="${k}" style="background:${k}" class="${k === cur ? 'on' : ''}"></span>`).join('')}</div>`;
function renderCards() {
  if (document.activeElement?.dataset?.act === 'name') { cardsDirty = true; return; }   // don't wipe a name being typed
  cardsDirty = false;
  $('cards').innerHTML = players.map((p, i) => {
    const mine = owned(p), c = p.custom;
    const label = !mine ? ic('globe') + ' Online' : CTRL_NAMES[localCtrl(p)] || ic('gamepad') + ' Controller ' + (+localCtrl(p).slice(3) + 1);
    return `<div class="card ${mine ? '' : 'remote'}" style="--c:${c.color}" data-i="${i}">
      ${mine || net.mode === 'host' ? `<button class="x" data-act="remove" title="Remove">${ic('cancel')}</button>` : ''}
      <div class="ctrl">${label}</div>
      ${mine ? `<input data-act="name" maxlength="12" value="${esc(c.name)}">
      <div class="lbl">Shell</div>${swatches('color', c.color)}
      ${cycler('pattern', 'palette', c.pattern)}
      ${c.pattern !== 'Plain' ? `<div class="lbl">Pattern color</div>${swatches('color2', c.color2)}` : ''}
      ${cycler('hat', 'top-hat', c.hat)}${cycler('face', 'eyeball', c.face)}${cycler('outfit', 't-shirt', c.outfit)}
      <button class="rnd" data-act="random">${ic('dice-six-faces-five')} Randomize</button>` : `<div class="rname">${esc(c.name)}</div>`}
    </div>`;
  }).join('') + (players.length < 8 ? `<div class="card empty">${IS_TOUCH ? ic('smartphone') + ' Tap here<br>to join!' : 'Press Space, . or A<br>to join!'}</div>` : '');
  $('start').disabled = players.length < 2;
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
  const c = p.custom, cycle = (list, cur) => list[(list.indexOf(cur) + +e.target.dataset.v + list.length) % list.length];
  if (act === 'color' || act === 'color2') c[act] = e.target.dataset.v;
  if (act === 'pattern') c.pattern = cycle(PATTERNS, c.pattern);
  if (act === 'hat') c.hat = cycle(HATS, c.hat);
  if (act === 'face') c.face = cycle(FACES, c.face);
  if (act === 'outfit') c.outfit = cycle(OUTFITS, c.outfit);
  if (act === 'random') Object.assign(c, randomCustom(c.name));
  customChanged(p);
});
$('cards').addEventListener('change', e => {
  const p = players[e.target.closest('.card')?.dataset.i];
  if (e.target.dataset.act !== 'name' || !p) return;
  p.custom.name = e.target.value.trim() || 'Nobody';
  e.target.blur(); customChanged(p);
});
$('cards').addEventListener('focusout', () => setTimeout(() => cardsDirty && renderCards()));
$('addBot').onclick = e => { e.target.blur(); join('bot'); };
$('start').onclick = e => { e.target.blur(); startMatch(); };
$('hostBtn').onclick = e => { e.target.blur(); hostOnline(); };
$('joinBtn').onclick = e => { e.target.blur(); joinOnline($('codeIn').value.trim()); };
$('codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') joinOnline(e.target.value.trim()); });
$('leaveBtn').onclick = e => { e.target.blur(); leaveOnline(); };

addEventListener('keydown', e => {
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
  $('mainPanel').hidden = panel !== 'main'; $('ctlPanel').hidden = panel !== 'controls'; $('creditsPanel').hidden = panel !== 'credits'; $('sharePanel').hidden = panel !== 'share';
  if (panel === 'share') renderShare();
  $('menuTitle').textContent = inGame ? 'PAUSED' : state === 'title' ? 'SETTINGS' : 'MENU';
  document.querySelector('[data-m="resume"]').innerHTML = inGame ? ic('play-button') + ' Resume' : ic('return-arrow') + ' Close';
  $('mLobby').hidden = !inGame || net.mode === 'client';
  $('mLeave').hidden = net.mode === 'off';
  paused = inGame;
  if (net.mode === 'client' && inGame && !wasOpen) toHost({ t: 'pause', on: 1 });   // the host freezes the match for everyone
  if (!wasOpen) playSfx('ui_open');
  keys.clear();
  document.querySelector(panel === 'main' ? '#mainPanel [data-m="resume"]' : `#${{ credits: 'creditsPanel', share: 'sharePanel' }[panel] || 'ctlPanel'} [data-m="back"]`).focus({ preventScroll: true });
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
  if (m === 'retro') { retro = !retro; try { localStorage.setItem('egg-retro', retro ? '1' : '0'); } catch {} applyRetro(); retroLabel(); }
  if (m === 'fullscreen') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  if (m === 'lobby') { closeMenu(); toLobby(); }
  if (m === 'leave') { closeMenu(); leaveOnline(); }
  if (m === 'quit') window.close();
});
$('ctlBtn').onclick = e => { e.target.blur(); openMenu('controls'); };
const retroLabel = () => { $('retroBtn').innerHTML = `${ic('tv')} Retro look: <b>${retro ? 'ON' : 'OFF'}</b>`; };
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
  if (t === 'quit') window.close();
});
// "Get the game": QR + link to the online copy, phone install steps, Windows download
let installPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (!$('sharePanel').hidden) renderShare(); });
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;
function renderShare() {
  $('shareBody').innerHTML = SITE_URL ? `
    <img class="bigqr" src="${qrImg(SITE_URL)}" alt="">
    <p><a href="${SITE_URL}" target="_blank">${esc(SITE_URL)}</a></p>
    <p>${ic('smartphone')} <b>Phone:</b> scan the code, then ${isIOS ? 'tap <b>Share ⬆</b> → <b>Add to Home Screen</b>' : 'tap <b>Install app</b> (or ⋮ menu → <b>Install app</b>)'} to get the app. It always opens the newest version.</p>
    ${isInstalled ? `<p>${ic('check-mark')} You are playing the installed app.</p>` : installPrompt ? `<button class="mb" id="installBtn">${ic('cloud-download')} Install app on this device</button>` : ''}
    <p>${ic('laptop')} <b>PC:</b> open the link in Chrome/Edge to play right away<span id="dl"></span>.</p>
    <p class="ver" id="ver"></p>`
    : '<p>The online version isn\'t set up yet, so there is no link to share.</p>';
  $('installBtn')?.addEventListener('click', async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; renderShare(); });
  fetch('version.json', { cache: 'no-store' }).then(r => r.json()).then(v => {   // version + Windows download link come with each published build
    if ($('ver')) $('ver').textContent = 'Version ' + v.version;
    if (v.download && $('dl')) $('dl').innerHTML = `, or <a href="${esc(v.download)}" target="_blank">download the Windows app</a> (it updates itself)`;
  }).catch(() => {});
}
if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

$('toTitle').onclick = e => { e.target.blur(); playSfx('ui_back'); toTitle(); };

// ---------- game flow ----------
let state = 'lobby', endT = 0, bannerT = 0, roundT = 0, countT = 0, countShown = '', mapInfo = ['', ''], suddenDeath = false;

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
  if (state === 'lobby') { $('banner').style.display = 'none'; renderCards(); renderVotes(); }
}

// ---------- map vote (one vote per PC; the host counts) + who-paused note ----------
const MAP_RANDOM = 'Random', MAP_CLASSIC = 'Classic';
const MAP_ICONS = { Random: 'dice-six-faces-five', Classic: 'jigsaw-piece', 'Train Station': 'subway-train', 'Construction Site': 'crane', 'Kitchen Counter': 'knife-fork', 'Freight Train': 'steam-locomotive',
  'City Rooftops': 'modern-city', 'Dinner Table': 'cake-slice', 'Floor Is Lava': 'volcano', 'Frying Pan': 'fried-eggs', 'Container Port': 'cargo-ship', 'Pirate Cove': 'pirate-flag', 'Castle Siege': 'castle',
  'Space Station': 'rocket', 'Theme Park': 'carousel', 'Sky Course': 'fluffy-cloud', 'Winter Village': 'snowman', 'Haunted Graveyard': 'ghost' };
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

function startMatch() {
  closePicker();
  if (players.length < 2 || net.mode === 'client' || state !== 'lobby') return;
  players.forEach(p => (p.wins = 0));
  matchMap = voteWinner();
  startRound();
}

function startRound() {
  state = 'countdown'; countT = 4; countShown = ''; roundT = 0; suddenDeath = false;
  const seed = 1 + Math.floor(Math.random() * 1e9);
  const want = matchMap === MAP_RANDOM ? null : matchMap;
  mapInfo = loadMap(seed, want);
  if (net.mode === 'host') { broadcast({ t: 'map', seed, want }); broadcast(rosterMsg()); }
  players.forEach((p, i) => p.spawn(spawnPoint(i, players.length)));
  setUI();
}

function toLobby() {
  state = 'lobby'; suddenDeath = false; net.pausers.clear();
  loadMap(0);
  if (net.mode === 'host') broadcast({ t: 'map', seed: 0 });
  if (net.mode !== 'client') players.forEach((p, i) => p.spawn(spawnPoint(i, 8)));
  setUI();
}

let hudKey = '';
function updateHUD() {
  const key = players.map(p => p.id + p.custom.name + p.custom.color).join();
  if (key !== hudKey) {
    hudKey = key;
    $('hud').innerHTML = players.map(p => `<div class="hp" style="--c:${p.custom.color}"><b>${esc(p.custom.name)}</b> <span></span><div class="bar"><i></i></div></div>`).join('');
  }
  const els = $('hud').children;
  players.forEach((p, i) => {
    const el = els[i]; if (!el) return;
    el.classList.toggle('dead', !p.alive);
    el.classList.toggle('yolk', !!p.yolk);
    const s = el.querySelector('span'), html = ic('round-star').repeat(p.wins) + (p.yolk ? ic('fried-eggs') : '') + (p.weapon ? ic(WEAPONS[p.weapon].icon) : '') + (p.flags & 64 ? ic('chili-pepper') : '') + (p.ko > 0 && p.alive ? ic('knocked-out-stars') : '');
    if (s.dataset.h !== html) { s.dataset.h = html; s.innerHTML = html; }   // only touch the DOM when it changes
    el.querySelector('i').style.width = Math.max(0, p.hp / (p.yolk ? YOLK_HP : SHELL_HP) * 100) + '%';
  });
}

const camTarget = new THREE.Vector3();
// Map pieces blocking the view of any egg are faded out (materials are swapped for see-through copies, then restored).
const occRay = new THREE.Raycaster(), faded = new Set(), occDir = new THREE.Vector3();
let occT = 0;
function fade(o, on) {
  if (on) {
    o.userData.solidMat ??= o.material;
    o.userData.fadeMat ??= Array.isArray(o.material)
      ? o.material.map(m => Object.assign(m.clone(), { transparent: true, opacity: 0.22, depthWrite: false }))
      : Object.assign(o.material.clone(), { transparent: true, opacity: 0.22, depthWrite: false });
    o.material = o.userData.fadeMat; o.castShadow = false; faded.add(o);
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
  if (state === 'title') {   // gentle sway in front of the eggs
    camera.position.set(Math.sin(t * 0.2) * 3, 4.5, 12.5); camTarget.set(0, 1.8, 0); camera.lookAt(camTarget); return;
  }
  const ps = players.filter(p => p.alive && p.body.position.y > -3);
  const c = new THREE.Vector3();
  let spread = 0;
  if (ps.length) {
    ps.forEach(p => c.add(p.model.group.position)); c.divideScalar(ps.length);
    ps.forEach(p => (spread = Math.max(spread, p.model.group.position.distanceTo(c))));
  }
  const dist = THREE.MathUtils.clamp(spread * 1.3 + 10, 13, 46);
  camTarget.lerp(c, 1 - Math.exp(-dt * 6));
  camera.position.lerp(camTarget.clone().add(new THREE.Vector3(0, dist * 0.8, dist)), 1 - Math.exp(-dt * 4));
  camera.lookAt(camTarget);
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
  } else if (state === 'round') {
    if ((roundT += dt) > 75 && !suddenDeath) { suddenDeath = true; banner('SUDDEN DEATH!', 'Everything hits harder', 2.5); fx('v_sudden_death'); }
    const alive = players.filter(p => p.alive);
    if (alive.length <= 1) {
      state = 'roundEnd'; endT = 4;
      if (alive[0]) { alive[0].wins++; alive[0].cheer = true; banner(`${alive[0].custom.name} WINS!`, '[round-star]'.repeat(alive[0].wins), 3.5); fx('v_winner'); }
      else { banner('DRAW!', 'All eggs broke', 3.5); fx('v_its_a_tie'); }
      fx('jingle'); rosterChanged();
    }
  } else if (state === 'roundEnd' && (endT -= dt) <= 0) startRound();
  if (net.mode === 'host') hostSend(dt);
}

// ---------- touch controls: left thumb = floating stick, right thumb = buttons ----------
const touchIn = { x: 0, z: 0, jump: false, punch: false, grab: false };
if (IS_TOUCH) {
  document.body.classList.add('touch');
  $('lobby').querySelector('.hint').innerHTML = ic('smartphone') + ' Tap the empty card to join &nbsp;·&nbsp; Crack every other egg off the map!';
  document.querySelector('#title .foot').textContent = 'Tap to choose · turn your phone sideways';
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
// browsers only start audio after a tap/click
addEventListener('pointerdown', () => { if (ac.state === 'suspended') ac.resume(); });
if (!IS_APP) document.querySelectorAll('[data-t="quit"], [data-m="quit"]').forEach(b => (b.hidden = true));   // a web page can't quit itself
function updateTouchUI() {
  const on = IS_TOUCH && state !== 'lobby' && state !== 'title' && !menuOpen && players.some(p => p.alive && owned(p) && localCtrl(p) === 'touch');
  if ($('touch').hidden === on) { $('touch').hidden = !on; if (!on) { Object.assign(touchIn, { x: 0, z: 0, jump: false, punch: false, grab: false }); document.querySelectorAll('#touchBtns .on').forEach(b => b.classList.remove('on')); } }
}

let last = performance.now();
function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)), t = now / 1000; last = Math.max(last, now);
  pollPads();
  if (net.mode === 'client') clientFrame(dt);
  else if (!paused && !net.pausers.size) hostFrame(dt);
  else if (net.mode === 'host') hostSend(dt);   // keep clients updated (and showing the pause note)
  updatePauseNote(); updateTouchUI();
  for (const p of players) if (p.alive) p.sync(dt, t);
  for (const [mesh, body] of map.syncs) { mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); }
  renderItems(net.mode === 'client' ? net.items : map.items.map(itemRow), t);
  updateParts(dt);
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
showBanner('Loading…', 'models', 30);
await Promise.all([loadModels(f => { $('banner').querySelector('small').textContent = Math.round(f * 100) + '%'; }), loadSounds()]);
$('banner').style.display = 'none'; bannerT = 0;
document.querySelectorAll('i[data-i]').forEach(e => e.outerHTML = ic(e.dataset.i));
retroLabel(); if (retro) applyRetro();
toTitle();
requestAnimationFrame(frame);
if (qs.get('join')) {
  const code = qs.get('join'); qs.delete('join'); history.replaceState(null, '', location.pathname + (qs.size ? '?' + qs : ''));
  document.querySelector('[data-t="online"]').click(); $('codeIn').value = code; net.autoJoin = true; joinOnline(code);
}
if (location.search.includes("debug")) window.__dbg = { toTitle, ac, music, buffers: () => Object.keys(buffers).length, faded: () => faded.size, frame, scene, camera, renderer, world, loadMap, players, map, net, join, startMatch, hostOnline, joinOnline, LAYOUTS, get state() { return state; } };

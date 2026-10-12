import * as THREE from 'three';
import { model } from './assets.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const COLORS = ['#fff4e0', '#e8c49a', '#ff5a5a', '#ffa94d', '#ffd93d', '#6bcb77', '#4dd4ff', '#4d79ff', '#a66bff', '#ff7ad9', '#f5f5f5', '#555555', '#8b5a2b', '#00b3a4',
  '#c1121f', '#1d3557', '#b5e48c', '#ffcad4', '#d4a017', '#222222'];
export const PATTERNS = ['Plain', 'Speckled', 'Spots', 'Stripes', 'Zigzag', 'Hearts', 'Stars', 'Checker', 'Two-tone', 'Camo', 'Photo'];   // Photo: c.photo painted on the front
export const HATS = ['None', 'Top Hat', 'Party Hat', 'Crown', 'Horns', 'Beanie', 'Chef', 'Cap', 'Viking', 'Bunny Ears', 'Halo', 'Propeller',
  'Pirate', 'Wizard', 'Cowboy', 'Santa', 'Headphones', 'Flower', 'Antennae', 'Mohawk', 'Graduate', 'Sombrero', 'Fez', 'Beret', 'Hard Hat', 'Cat Ears', 'Unicorn', 'Knight', 'Mushroom'];
export const FACES = ['Dots', 'Big Eyes', 'Happy', 'Sleepy', 'Angry', 'Surprised', 'Mustache', 'Shades', 'Wink', 'Cyclops', 'Robot', 'Tongue', 'Dizzy', 'Cute', 'None'];   // None: no cartoon face (for photo eggs)
export const OUTFITS = ['None', 'Tie', 'Bowtie', 'Scarf', 'Belt', 'Cape', 'Backpack', 'Hero Mask', 'Necklace', 'Medal', 'Wings', 'Tutu', 'Jetpack', 'Sash', 'Bandana', 'Overalls', 'Hero Emblem', 'Lei', 'Suspenders', 'Bling'];
// Attack kinds shared by gameplay and animation: wind-up time before the hit lands (seconds).
export const ATTACKS = [null, { windup: 0.22 }, { windup: 0.22 }, { windup: 0.36 }, { windup: 0.42 }, { windup: 0.3 }, { windup: 0.12 }, { windup: 0.06 }, { windup: 0.14 }, { windup: 0.3 }, { windup: 0.16 }];   // 8 = toss an item, 9 = haymaker, 10 = flying headbutt
export const STRIKE = 0.12;
const YOLK = '#ffb21c';

// 3-step cartoon shading + black inverted-hull outline
const grad = new THREE.DataTexture(new Uint8Array([80, 170, 255]), 3, 1, THREE.RedFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
export const toon = (color, extra) => new THREE.MeshToonMaterial({ color, gradientMap: grad, ...extra });
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x15151a, side: THREE.BackSide });
function mesh(geo, material, outline = 0, cast = true) {   // cast: small parts skip the shadow pass (fewer draw calls)
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  if (outline) { const o = new THREE.Mesh(geo, OUTLINE); o.scale.setScalar(1 + outline); m.add(o); }
  return m;
}
const at = (obj, x, y, z) => { obj.position.set(x, y, z); return obj; };
const SHINE = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75 });

// Egg profile: y from -0.85 to 0.95, wider at the bottom. eggRadius(y) = shell radius at height y.
const EGG_H = 0.9, EGG_C = 0.05, EGG_R = 0.56;
const BODY_Y = 1.0, BODY_S = 0.86;   // egg drawn a bit smaller and higher than its collider, on longer legs (same total height)
export const eggRadius = y => { const k = (y - EGG_C) / EGG_H; return Math.abs(k) >= 1 ? 0 : EGG_R * Math.sqrt(1 - k * k) * (1 - 0.16 * k); };
export const eggGeo = new THREE.LatheGeometry(Array.from({ length: 41 }, (_, i) => {
  const k = -Math.cos(Math.PI * i / 40);
  return new THREE.Vector2(EGG_R * Math.sin(Math.PI * i / 40) * (1 - 0.16 * k), EGG_C + EGG_H * k);
}), 36);
// Place a decal-like part flush on the shell at height y, angle az (0 = straight ahead), facing outward.
const slope = y => (eggRadius(y + 0.01) - eggRadius(y - 0.01)) / 0.02;
function onShell(o, y, az, lift = 0, roll = 0) {
  const r = eggRadius(y) + lift;
  o.position.set(Math.sin(az) * r, y, Math.cos(az) * r);
  o.rotation.set(Math.atan(slope(y)), az, roll, 'YXZ');
  return o;
}

// Shell texture: u wraps around the egg (front of the face is at u=0/1), v runs bottom to top.
function shellPattern(c) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const g = cv.getContext('2d'), rnd = Math.random;
  g.fillStyle = c.color; g.fillRect(0, 0, 512, 256);
  g.fillStyle = g.strokeStyle = c.color2;
  if (c.pattern === 'Speckled') for (let i = 0; i < 350; i++) { g.globalAlpha = 0.3 + rnd() * 0.5; g.beginPath(); g.arc(rnd() * 512, rnd() * 256, 1 + rnd() * 2.5, 0, 7); g.fill(); }
  if (c.pattern === 'Spots') for (let i = 0; i < 16; i++) { g.beginPath(); g.arc(60 + rnd() * 392, 30 + rnd() * 196, 10 + rnd() * 14, 0, 7); g.fill(); }
  if (c.pattern === 'Stripes') for (const y of [70, 130, 190]) g.fillRect(0, y - 9, 512, 18);
  if (c.pattern === 'Zigzag') for (const y0 of [95, 160]) {
    g.lineWidth = 12; g.beginPath();
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y0 + ((x / 32) % 2 ? -14 : 14));
    g.stroke();
  }
  const shape = (x, y, s, kind) => {   // little hearts / stars painted onto the shell
    g.beginPath();
    if (kind === 'heart') { g.moveTo(x, y + s * 0.9); g.bezierCurveTo(x - s * 1.4, y - s * 0.2, x - s * 0.6, y - s * 1.1, x, y - s * 0.4); g.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.4, y - s * 0.2, x, y + s * 0.9); }
    else for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? s * 0.45 : s; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    g.fill();
  };
  if (c.pattern === 'Hearts' || c.pattern === 'Stars') for (let row = 0; row < 4; row++) for (let i = 0; i < 8; i++) shape(i * 64 + (row % 2) * 32 + 16, 36 + row * 60, 14, c.pattern === 'Hearts' ? 'heart' : 'star');
  if (c.pattern === 'Checker') for (let x = 0; x < 16; x++) for (let y = 0; y < 8; y++) if ((x + y) % 2) g.fillRect(x * 32, y * 32, 32, 32);
  if (c.pattern === 'Two-tone') g.fillRect(0, 128, 512, 128);
  if (c.pattern === 'Camo') for (let i = 0; i < 40; i++) { g.globalAlpha = i % 3 ? 0.9 : 0.5; g.beginPath(); g.ellipse(rnd() * 512, rnd() * 256, 18 + rnd() * 30, 10 + rnd() * 16, rnd() * 3, 0, 7); g.fill(); }
  g.globalAlpha = 1;
  for (const x of [0, 512]) {   // lighter belly on the front, low down (u = 0/1 is the front)
    const b = g.createRadialGradient(x, 175, 4, x, 175, 95); b.addColorStop(0, 'rgba(255,255,255,.26)'); b.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = b; g.fillRect(x - 100, 75, 200, 200);
  }
  const sh = g.createLinearGradient(0, 0, 0, 256);
  sh.addColorStop(0, 'rgba(255,255,255,.22)'); sh.addColorStop(0.45, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(60,30,0,.22)');
  g.fillStyle = sh; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 1500; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.07)'; g.fillRect(rnd() * 512, rnd() * 256, 2, 2); }
  return cv;
}
function crackLines() {   // 3 random cracks near the front so the camera sees them
  return [[70, 60], [445, 75], [10, 25]].map(([x, y]) => {
    const pts = [[x, y]];
    for (let i = 0; i < 7; i++) { const [px, py] = pts[pts.length - 1]; pts.push([px + (Math.random() - 0.5) * 40, py + 10 + Math.random() * 16]); }
    return pts;
  });
}
function drawShell(m, level) {
  const g = m.shellCv.getContext('2d');
  g.drawImage(m.patternCv, 0, 0);
  m.cracks.slice(0, level).forEach(pts => {
    for (const [w, col] of [[5, '#2b1d10'], [1.5, '#ffffffaa']]) {
      g.lineWidth = w; g.strokeStyle = col; g.lineJoin = 'round'; g.beginPath();
      pts.forEach(([x, y]) => g.lineTo(x, y)); g.stroke();
    }
  });
  m.shellTex.needsUpdate = true; m.crackLevel = level;
}

// three chubby chick toes merged into one mesh (one draw call per foot instead of six)
const FOOT = mergeGeometries([-0.6, 0, 0.6].map(a => new THREE.CapsuleGeometry(0.045, 0.13, 4, 8).applyMatrix4(new THREE.Matrix4().compose(
  new THREE.Vector3(Math.sin(a) * 0.085, -0.02, Math.cos(a) * 0.085 + 0.025), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, a, 0, 'YXZ')), new THREE.Vector3(1, 1, 1)))));
/*
 Rig (body space: physics centre at y=0, feet at y=-0.9)
 root ─ size (scaled around the feet; shrinks for yolk) ─ pivot (squash/stretch)
          ├─ body (+BODY_Y, scaled BODY_S): shell / yolk, face, hats, outfit, shoulders ─ elbow ─ hand
          └─ hips ─ knee ─ ankle ─ toes
*/
export function buildModel(c) {
  const skin = toon(c.color), black = toon('#15151a'), white = toon('#ffffff'), orange = toon('#ff9f1c'), glove = toon('#fbfbff'), cuffMat = toon(c.pattern === 'Plain' ? '#ff5a5a' : c.color2);
  const root = new THREE.Group();
  const size = at(new THREE.Group(), 0, -0.9, 0); root.add(size);
  const pivot = new THREE.Group(); size.add(pivot);
  const body = at(new THREE.Group(), 0, BODY_Y, 0); body.scale.setScalar(BODY_S); pivot.add(body);
  const eggOnly = new THREE.Group(), yolkOnly = new THREE.Group(); body.add(eggOnly, yolkOnly); yolkOnly.visible = false;
  const eyes = [];

  // shell
  // shell art = pattern, then the photo (wrapped all the way round), then the player's drawing; cracks go on top (drawShell)
  const baseCv = shellPattern(c), patternCv = document.createElement('canvas'), shellCv = document.createElement('canvas');
  patternCv.width = shellCv.width = 512; patternCv.height = shellCv.height = 256;
  const shellTex = new THREE.CanvasTexture(shellCv); shellTex.colorSpace = THREE.SRGBColorSpace;
  const shellMat = toon('#ffffff', { map: shellTex, emissive: '#ffffff', emissiveIntensity: 0 });
  const shellMesh = mesh(eggGeo, shellMat, 0.035); eggOnly.add(shellMesh);
  const photo = c.pattern === 'Photo' && c.photo;
  if (!photo) for (const [y, az, sx, sy] of [[0.55, -0.6, 0.09, 0.15], [0.38, -0.75, 0.035, 0.05]]) {   // glossy shine (not on photos: it hid the face)
    const d = onShell(new THREE.Mesh(new THREE.CircleGeometry(1, 16), SHINE), y, az, 0.006); d.scale.set(sx, sy, 1); eggOnly.add(d);
  }

  // face parts sit on the curved shell
  const part = (parent, geo, m, y, az, lift, sx = 1, sy = 1, sz = 0.45, roll = 0) => {
    const o = onShell(mesh(geo, m), y, az, lift, roll); o.scale.set(sx, sy, sz); o.castShadow = false; parent.add(o); return o;
  };
  const eye = (parent, r, m, y, az, sx = 1, sy = 1) => { const e = part(parent, new THREE.SphereGeometry(r, 14, 10), m, y, az, r * 0.15, sx, sy); e.userData.sy = sy; eyes.push(e); return e; };
  const glint = (parent, y, az) => eye(parent, 0.022, white, y + 0.035, az - 0.06);
  const F = c.pattern === 'Photo' && c.photo ? 'None' : c.face, ey = 0.32;   // a photo egg's face is the picture's own face
  const faceG = new THREE.Group(); faceG.visible = F !== 'None'; eggOnly.add(faceG);
  const cross = (y, az) => { for (const r of [0.8, -0.8]) part(faceG, new THREE.BoxGeometry(0.15, 0.035, 0.04), black, y, az, 0.01, 1, 1, 1, r); };
  if (F === 'Cyclops') { eye(faceG, 0.16, white, ey + 0.02, 0); eye(faceG, 0.08, black, ey + 0.02, 0).position.multiplyScalar(1.13); glint(faceG, ey + 0.05, 0.03); }
  for (const s of [-1, 1]) {
    const az = s * 0.3;
    if (F === 'Cyclops') { /* one big eye, drawn above */ }
    else if (F === 'Wink' && s < 0) { const e = part(faceG, new THREE.TorusGeometry(0.06, 0.02, 6, 12, Math.PI), black, ey, az, 0.01, 1, 1, 1); eyes.push(e); e.userData.sy = 1; }
    else if (F === 'Robot') { const e = part(faceG, new THREE.BoxGeometry(0.13, 0.1, 0.05), toon('#4dd4ff', { emissive: '#1a8fb0' }), ey, az, 0.015, 1, 1, 1); eyes.push(e); e.userData.sy = 1; }
    else if (F === 'Dizzy') cross(ey, az);
    else if (F === 'Cute') { eye(faceG, 0.1, black, ey - 0.01, s * 0.3, 1, 1.15); glint(faceG, ey + 0.01, s * 0.3); glint(faceG, ey - 0.06, s * 0.3 + 0.05); }
    else if (F === 'Big Eyes') { eye(faceG, 0.13, white, ey, s * 0.32); eye(faceG, 0.065, black, ey, s * 0.32).position.multiplyScalar(1.1); glint(faceG, ey, s * 0.32); }
    else if (F === 'Sleepy') { eye(faceG, 0.08, black, ey - 0.02, az, 1.2, 0.3); part(faceG, new THREE.BoxGeometry(0.17, 0.03, 0.04), black, ey + 0.05, az, 0.01, 1, 1, 1, s * -0.15); }
    else if (F === 'Happy') { const e = part(faceG, new THREE.TorusGeometry(0.06, 0.02, 6, 12, Math.PI), black, ey, az, 0.01, 1, 1, 1); eyes.push(e); e.userData.sy = 1; }
    else if (F === 'Shades') part(faceG, new THREE.BoxGeometry(0.2, 0.13, 0.05), black, ey + 0.01, az, 0.015, 1, 1, 1);
    else { eye(faceG, F === 'Surprised' ? 0.085 : 0.07, black, ey, az); glint(faceG, ey, az); }
    if (F === 'Angry') part(faceG, new THREE.BoxGeometry(0.2, 0.05, 0.05), black, ey + 0.12, az, 0.01, 1, 1, 1, s * 0.45);   // inner ends down = cross, not sad
    if (F === 'Surprised') part(faceG, new THREE.BoxGeometry(0.12, 0.03, 0.04), black, ey + 0.15, az, 0.01, 1, 1, 1, s * 0.2);
    if (F === 'Mustache') part(faceG, new THREE.SphereGeometry(0.09, 12, 8), toon('#4a2c17'), 0.18, s * 0.14, 0.02, 1.2, 0.5, 0.5, s * -0.35);
    part(faceG, new THREE.SphereGeometry(F === 'Cute' ? 0.085 : 0.06, 10, 8), toon('#ff8fa3'), 0.19, s * 0.62, 0, 1, 0.6, 0.3);   // cheeks
    if (F === 'Robot') part(faceG, new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8), toon('#9aa3ad'), ey + 0.12, s * 0.3, 0.06, 1, 1, 1);   // little bolts
  }
  if (F === 'Shades') { part(faceG, new THREE.BoxGeometry(0.12, 0.03, 0.03), black, ey + 0.03, 0, 0.012, 1, 1, 1); part(faceG, new THREE.BoxGeometry(0.07, 0.025, 0.02), white, ey + 0.05, -0.36, 0.04, 1, 1, 1); }
  if (F === 'Surprised' || F === 'Dizzy') part(faceG, new THREE.TorusGeometry(0.045, 0.02, 6, 14), black, 0.12, 0, 0.01, 1, 1, 1);
  else if (F === 'Robot') for (let i = -2; i <= 2; i++) part(faceG, new THREE.BoxGeometry(0.025, 0.07, 0.03), black, 0.12, i * 0.06, 0.01, 1, 1, 1);
  else part(faceG, new THREE.TorusGeometry(0.07, 0.02, 6, 14, Math.PI), black, F === 'Mustache' ? 0.09 : 0.13, 0, 0.01, 1, 1, 1, F === 'Angry' ? 0 : Math.PI);

  if (F === 'Tongue') part(faceG, new THREE.SphereGeometry(0.045, 12, 10), toon('#ff6b81'), 0.04, 0.02, 0.012, 1, 1.3, 0.45);   // hangs out under the smile
  // expression parts: brows that frown / worry, and a mouth that opens to shout
  const brows = [];
  if (!['Angry', 'Surprised', 'Sleepy', 'Shades', 'Robot'].includes(F)) for (const s of [-1, 1]) {
    const b = part(faceG, new THREE.CapsuleGeometry(0.02, 0.09, 3, 6), black, ey + (F === 'Big Eyes' || F === 'Cyclops' ? 0.2 : 0.135), F === 'Cyclops' ? s * 0.13 : s * 0.3, 0.012, 1, 1, 1, Math.PI / 2);
    b.userData.s = s; brows.push(b);
  }
  const mouth = part(faceG, new THREE.SphereGeometry(0.075, 12, 8), toon('#4a1018'), F === 'Mustache' ? 0.07 : 0.11, 0, 0.004, 1, 0.8, 0.3);
  mouth.visible = false;

  // yolk form (shown after the shell breaks)
  const yolkMat = toon(YOLK, { emissive: '#ffffff', emissiveIntensity: 0 });
  const yolk = at(mesh(new THREE.SphereGeometry(0.58, 28, 20), yolkMat, 0.04), 0, -0.15, 0); yolk.scale.y = 0.85; yolkOnly.add(yolk);
  const goo = at(new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 12), new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: grad, transparent: true, opacity: 0.55 })), 0, -0.68, 0);
  goo.scale.y = 0.25; yolkOnly.add(goo);
  const ys = at(new THREE.Mesh(new THREE.CircleGeometry(1, 16), SHINE), -0.22, 0.2, 0.47); ys.rotation.set(-0.5, -0.4, 0); ys.scale.set(0.1, 0.07, 1); yolkOnly.add(ys);
  for (const s of [-1, 1]) {
    const e = at(mesh(new THREE.SphereGeometry(0.075, 12, 8), black), s * 0.16, 0.0, 0.5); e.scale.z = 0.45; e.userData.sy = 1; eyes.push(e); yolkOnly.add(e);
    yolkOnly.add(at(mesh(new THREE.SphereGeometry(0.022, 8, 6), white), s * 0.16 - 0.025, 0.035, 0.535));
  }
  const ym = at(mesh(new THREE.TorusGeometry(0.06, 0.02, 6, 12, Math.PI), black), 0, -0.13, 0.53); ym.rotation.z = Math.PI; yolkOnly.add(ym);

  // arms: shoulder → elbow → mitten hand with thumb
  const arms = [-1, 1].map(s => {
    const sh = at(new THREE.Group(), s * 0.47, 0.08, 0.02); body.add(sh);
    sh.add(at(mesh(new THREE.CapsuleGeometry(0.085, 0.24, 4, 10), skin, 0, false), 0, -0.17, 0));
    const el = at(new THREE.Group(), 0, -0.36, 0); sh.add(el);
    el.add(at(mesh(new THREE.CapsuleGeometry(0.08, 0.2, 4, 10), skin, 0, false), 0, -0.14, 0));
    const hand = at(new THREE.Group(), 0, -0.33, 0); hand.scale.setScalar(1 / BODY_S); el.add(hand);   // gloves + held items keep their size
    hand.add(mesh(new THREE.SphereGeometry(0.13, 14, 10), glove, 0.06));
    hand.add(at(mesh(new THREE.SphereGeometry(0.055, 8, 6), glove, 0, false), -s * 0.09, 0.04, 0.06));
    const cuff = at(mesh(new THREE.TorusGeometry(0.085, 0.035, 6, 14), cuffMat, 0, false), 0, 0.11, 0); cuff.rotation.x = Math.PI / 2; hand.add(cuff);
    return { sh, el, hand };
  });
  // legs: hip → knee → ankle with three chick toes (attached to pivot so feet stay planted while the body bobs)
  const legs = [-1, 1].map(s => {
    const hip = at(new THREE.Group(), s * 0.18, 0.44, 0); pivot.add(hip);
    hip.add(at(mesh(new THREE.CapsuleGeometry(0.055, 0.14, 4, 8), orange, 0, false), 0, -0.11, 0));
    const knee = at(new THREE.Group(), 0, -0.22, 0); hip.add(knee);
    knee.add(at(mesh(new THREE.CapsuleGeometry(0.05, 0.12, 4, 8), orange, 0, false), 0, -0.1, 0));
    const ankle = at(new THREE.Group(), 0, -0.2, 0); knee.add(ankle);
    ankle.add(mesh(new THREE.SphereGeometry(0.065, 8, 6), orange, 0, false));
    ankle.add(mesh(FOOT, orange, 0.07, false));
    return { hip, knee, ankle };
  });

  // hats & outfits (egg only)
  const add = (geo, m, x, y, z, rz = 0, outline = 0.05) => { const o = at(mesh(geo, m, outline), x, y, z); o.rotation.z = rz; eggOnly.add(o); return o; };
  const hatAt = (y, rx = 0, rz = 0) => { const g = at(new THREE.Group(), 0, y, 0); g.rotation.set(rx, 0, rz); eggOnly.add(g); return g; };   // a hat built in its own space, base at y 0
  const part2 = (g, geo, m, x, y, z, outline = 0.05) => { const o = at(mesh(geo, m, outline), x, y, z); g.add(o); return o; };
  const flush = (geo, m, y, az, lift, outline = 0.04) => { const o = onShell(mesh(geo, m, outline), y, az, lift); eggOnly.add(o); return o; };   // flat on the shell, facing out
  let decal = null;   // outfits painted straight onto the shell (they can't float, sink or trap the arms)
  const gold = toon('#ffcc33', { emissive: '#553300' }), dark = toon('#222');
  let propeller = null, cape = null;
  switch (c.hat) {
    case 'Sombrero': {
      const g = hatAt(fitY(0.26)), straw = toon('#e2b84a');
      part2(g, new THREE.CylinderGeometry(0.78, 0.78, 0.04, 32), straw, 0, 0.02, 0);
      const rim = part2(g, new THREE.TorusGeometry(0.78, 0.045, 8, 36), toon('#c99a2e'), 0, 0.05, 0); rim.rotation.x = Math.PI / 2;
      part2(g, new THREE.CylinderGeometry(0.17, 0.26, 0.34, 24), straw, 0, 0.19, 0);
      part2(g, new THREE.SphereGeometry(0.17, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), straw, 0, 0.36, 0);
      const band = part2(g, new THREE.CylinderGeometry(0.235, 0.255, 0.08, 24, 1, true), toon('#d62828', { side: THREE.DoubleSide }), 0, 0.08, 0, 0);
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; part2(g, new THREE.SphereGeometry(0.035, 8, 6), toon(['#2ecc71', '#ffd93d'][i % 2]), Math.sin(a) * 0.62, 0.06, Math.cos(a) * 0.62, 0); }   // pompoms round the brim
      break;
    }
    case 'Fez': {
      const g = hatAt(fitY(0.24), -0.08);
      part2(g, new THREE.CylinderGeometry(0.17, 0.24, 0.32, 24), toon('#c1121f'), 0, 0.16, 0);
      part2(g, new THREE.CylinderGeometry(0.03, 0.03, 0.03, 8), dark, 0, 0.335, 0, 0);
      const cord = part2(g, new THREE.CylinderGeometry(0.012, 0.012, 0.2, 6), dark, 0.09, 0.28, 0, 0); cord.rotation.z = -1.1;
      part2(g, new THREE.CapsuleGeometry(0.035, 0.08, 4, 8), dark, 0.19, 0.17, 0, 0.03);   // the tassel
      break;
    }
    case 'Beret': {
      const g = hatAt(fitY(0.33), 0, 0.28), felt = toon('#2b2d42');
      const top = part2(g, new THREE.SphereGeometry(0.4, 22, 12), felt, 0.04, 0.05, 0); top.scale.set(1, 0.3, 1);
      part2(g, new THREE.CylinderGeometry(0.02, 0.025, 0.06, 8), felt, 0.04, 0.17, 0, 0);
      break;
    }
    case 'Hard Hat': {
      const g = hatAt(fitY(0.34)), yellow = toon('#ffcc00');
      const dome = part2(g, new THREE.SphereGeometry(0.35, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), yellow, 0, 0, 0); dome.scale.y = 0.95;
      part2(g, new THREE.CylinderGeometry(0.42, 0.44, 0.04, 26, 1, false, -1.2, 2.4), yellow, 0, 0.0, 0);   // the brim sticks out at the front
      const ridge = part2(g, new THREE.BoxGeometry(0.06, 0.06, 0.66), toon('#f2b800'), 0, 0.3, 0, 0); ridge.scale.y = 1;
      part2(g, new THREE.BoxGeometry(0.14, 0.08, 0.02), toon('#ff8c1a'), 0, 0.14, 0.33, 0);   // reflector badge
      break;
    }
    case 'Cat Ears':
      for (const s of [-1, 1]) {
        const ear = add(new THREE.ConeGeometry(0.13, 0.26, 4), toon(c.color), s * 0.2, 1.02, 0, -s * 0.35); ear.rotation.y = Math.PI / 4;
        const inner = add(new THREE.ConeGeometry(0.07, 0.16, 4), toon('#ffb3c6'), s * 0.205, 1.0, 0.05, -s * 0.35, 0); inner.rotation.y = Math.PI / 4;
      }
      break;
    case 'Unicorn': {
      const horn = at(new THREE.Group(), 0, 0.93, 0.14); horn.rotation.x = 0.35; eggOnly.add(horn);
      const h = at(mesh(new THREE.ConeGeometry(0.075, 0.42, 16), toon('#fff3b0', { emissive: '#665500' }), 0.05), 0, 0.2, 0); horn.add(h);
      for (let i = 0; i < 4; i++) { const r = at(mesh(new THREE.TorusGeometry(0.065 - i * 0.013, 0.012, 6, 14), toon('#ffb3c6')), 0, 0.05 + i * 0.09, 0); r.rotation.x = Math.PI / 2 + 0.3; horn.add(r); }   // the spiral
      for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.06, 0.14, 8), toon(c.color), s * 0.22, 0.98, -0.02, -s * 0.5);
      for (let i = 0; i < 4; i++) add(new THREE.SphereGeometry(0.075, 10, 8), toon(['#ff7ad9', '#a66bff', '#4dd4ff', '#ffd93d'][i]), 0, 0.98 - i * 0.12, -eggRadius(0.98 - i * 0.12) - 0.02, 0, 0.02);   // a rainbow mane down the back
      break;
    }
    case 'Knight': {
      const g = hatAt(fitY(0.41)), steel = toon('#a8b0ba', { emissive: '#202428' });
      const dome = part2(g, new THREE.SphereGeometry(0.43, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), steel, 0, 0, 0); dome.scale.y = 1.1;
      const rim = part2(g, new THREE.TorusGeometry(0.43, 0.035, 8, 30), toon('#7d8590'), 0, 0.01, 0); rim.rotation.x = Math.PI / 2;
      part2(g, new THREE.BoxGeometry(0.05, 0.42, 0.05), toon('#7d8590'), 0, 0.22, 0.4, 0).rotation.x = -0.5;   // nose ridge
      const plume = at(new THREE.Group(), 0, 0.46, -0.05); plume.rotation.x = -0.6; g.add(plume);
      for (let i = 0; i < 3; i++) part2(plume, new THREE.CapsuleGeometry(0.06 - i * 0.012, 0.16, 4, 8), toon('#d62828'), 0, 0.1 + i * 0.12, -i * 0.05, 0.04);
      break;
    }
    case 'Mushroom': {
      const g = hatAt(fitY(0.3)), capM = toon('#e63946');
      const cap = part2(g, new THREE.SphereGeometry(0.5, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), capM, 0, 0, 0); cap.scale.y = 0.6;
      for (const [th, ph] of [[0, 0.5], [1.3, 0.75], [2.6, 0.55], [3.9, 0.8], [5.1, 0.6], [0.6, 1.15], [3.3, 1.2]]) {
        const sp = part2(g, new THREE.SphereGeometry(0.075, 10, 8), white, Math.sin(ph) * Math.sin(th) * 0.49, Math.cos(ph) * 0.3, Math.sin(ph) * Math.cos(th) * 0.49, 0); sp.scale.y = 0.5;
      }
      break;
    }
    case 'Top Hat': add(new THREE.CylinderGeometry(0.24, 0.24, 0.45, 20), dark, 0, 1.08, 0); add(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 20), dark, 0, 0.86, 0); add(new THREE.CylinderGeometry(0.245, 0.245, 0.08, 20), toon('#c1121f'), 0, 0.93, 0, 0, 0); break;
    case 'Party Hat': add(new THREE.ConeGeometry(0.22, 0.55, 20), toon('#ff4fa3'), 0, 1.12, 0); add(new THREE.SphereGeometry(0.07), toon('#ffd93d'), 0, 1.41, 0); break;
    case 'Crown':
      add(new THREE.CylinderGeometry(0.25, 0.25, 0.2, 20, 1, true), gold, 0, 0.88, 0, 0, 0);
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; add(new THREE.ConeGeometry(0.06, 0.16, 8), gold, Math.cos(a) * 0.24, 1.05, Math.sin(a) * 0.24, 0, 0); add(new THREE.SphereGeometry(0.03), toon('#e63946'), Math.cos(a) * 0.255, 0.9, Math.sin(a) * 0.255, 0, 0); }
      break;
    case 'Horns': for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.09, 0.36, 12), toon('#fff6dd'), s * 0.2, 1.06, 0, -s * 0.45); break;
    case 'Beanie': add(new THREE.SphereGeometry(0.38, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon('#e63946'), 0, 0.64, 0, 0, 0.03); add(new THREE.SphereGeometry(0.11), toon('#fff'), 0, 1.04, 0); break;
    case 'Chef': add(new THREE.CylinderGeometry(0.26, 0.26, 0.35, 20), white, 0, 1.02, 0); add(new THREE.SphereGeometry(0.33, 16, 12), white, 0, 1.26, 0); break;
    case 'Cap': {
      add(new THREE.SphereGeometry(0.38, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon('#4d79ff'), 0, 0.64, 0, 0, 0.03);
      const bill = add(new THREE.CylinderGeometry(0.25, 0.25, 0.04, 20, 1, false, -Math.PI / 2, Math.PI), toon('#4d79ff'), 0, 0.7, 0.28);
      bill.rotation.x = 0.15; break;
    }
    case 'Viking': {
      add(new THREE.SphereGeometry(0.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon('#a8adb5', { emissive: '#222' }), 0, 0.6, 0, 0, 0.03);
      const rim = add(new THREE.TorusGeometry(0.4, 0.045, 8, 24), toon('#8b5a2b'), 0, 0.62, 0); rim.rotation.x = Math.PI / 2;
      for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.08, 0.4, 12), toon('#fff6dd'), s * 0.42, 0.85, 0, -s * 0.9);
      break;
    }
    case 'Bunny Ears':
      for (const s of [-1, 1]) {
        add(new THREE.CapsuleGeometry(0.075, 0.42, 4, 10), white, s * 0.13, 1.16, 0, -s * 0.18);
        add(new THREE.CapsuleGeometry(0.035, 0.3, 4, 8), toon('#ffb3c6'), s * 0.135, 1.16, 0.05, -s * 0.18, 0);
      }
      break;
    case 'Halo': { const h = add(new THREE.TorusGeometry(0.26, 0.035, 8, 28), toon('#ffe14d', { emissive: '#aa8800' }), 0, 1.13, 0, 0, 0); h.rotation.x = Math.PI / 2; break; }
    case 'Propeller': {
      for (let i = 0; i < 4; i++) add(new THREE.SphereGeometry(0.38, 10, 10, i * Math.PI / 2, Math.PI / 2, 0, Math.PI / 2), toon(['#ff5a5a', '#ffd93d', '#4d79ff', '#6bcb77'][i]), 0, 0.64, 0, 0, 0);
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8), dark, 0, 1.07, 0, 0, 0);
      propeller = at(new THREE.Group(), 0, 1.14, 0); eggOnly.add(propeller);
      for (const s of [-1, 1]) propeller.add(at(mesh(new THREE.BoxGeometry(0.3, 0.02, 0.08), toon('#ff5a5a'), 0.1), s * 0.16, 0, 0));
      break;
    }
    case 'Pirate': {
      const g = hatAt(fitY(0.32)), black = toon('#26262b'), trim = toon('#ffcc33', { emissive: '#553300' });
      const crown = part2(g, new THREE.SphereGeometry(0.33, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), black, 0, 0, 0, 0.03); crown.scale.y = 1.35;
      const brim = part2(g, new THREE.CylinderGeometry(0.62, 0.42, 0.3, 3, 1, true), black, 0, 0.13, 0, 0); brim.material = toon('#26262b', { side: THREE.DoubleSide });   // three turned-up sides, a corner at the front
      const edge = part2(g, new THREE.CylinderGeometry(0.63, 0.63, 0.035, 3, 1, true), trim, 0, 0.28, 0, 0); edge.material = toon('#ffcc33', { emissive: '#553300', side: THREE.DoubleSide });
      part2(g, new THREE.SphereGeometry(0.07, 12, 10), white, 0, 0.17, 0.53, 0.02);
      for (const s of [-1, 1]) { const bone = part2(g, new THREE.CapsuleGeometry(0.016, 0.15, 3, 6), white, 0, 0.17, 0.52, 0); bone.rotation.z = Math.PI / 2 + s * 0.7; }
      break;
    }
    case 'Wizard': {
      const g = hatAt(fitY(0.3), -0.06), cloth = toon('#5a3ea8'), star = toon('#ffe14d', { emissive: '#aa8800' });
      part2(g, new THREE.CylinderGeometry(0.5, 0.5, 0.035, 28), cloth, 0, 0.0, 0);
      part2(g, new THREE.CylinderGeometry(0.15, 0.29, 0.48, 22), cloth, 0, 0.25, 0);
      const top = at(new THREE.Group(), 0, 0.48, 0); top.rotation.set(-0.5, 0, 0.35); g.add(top);   // the tip bends over
      part2(top, new THREE.ConeGeometry(0.15, 0.42, 18), cloth, 0, 0.2, 0);
      for (const [x, y, z] of [[0.12, 0.16, 0.24], [-0.15, 0.3, 0.17], [0.03, 0.42, 0.15]]) part2(g, new THREE.OctahedronGeometry(0.045), star, x, y, z, 0);
      const band = part2(g, new THREE.CylinderGeometry(0.285, 0.29, 0.07, 22, 1, true), toon('#ffcc33', { emissive: '#553300' }), 0, 0.055, 0, 0); band.material.side = THREE.DoubleSide;
      break;
    }
    case 'Cowboy':
      add(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 24), toon('#8b5a2b'), 0, 0.84, 0);
      add(new THREE.CylinderGeometry(0.2, 0.25, 0.3, 20), toon('#8b5a2b'), 0, 1.0, 0);
      add(new THREE.CylinderGeometry(0.255, 0.255, 0.06, 20), toon('#3b2414'), 0, 0.9, 0, 0, 0);
      break;
    case 'Santa': {
      const g = hatAt(fitY(0.29), -0.1), red = toon('#d62828');
      part2(g, new THREE.CylinderGeometry(0.13, 0.29, 0.38, 20), red, 0, 0.21, 0);
      const tip = at(new THREE.Group(), 0, 0.38, 0); tip.rotation.z = -1.05; g.add(tip);   // the floppy end
      part2(tip, new THREE.ConeGeometry(0.13, 0.36, 16), red, 0, 0.17, 0); part2(tip, new THREE.SphereGeometry(0.075, 12, 8), white, 0, 0.37, 0);
      const fur = part2(g, new THREE.TorusGeometry(0.29, 0.075, 10, 28), white, 0, 0.03, 0); fur.rotation.x = Math.PI / 2;
      break;
    }
    case 'Headphones': {
      const band = add(new THREE.TorusGeometry(0.47, 0.04, 8, 24, Math.PI), dark, 0, 0.52, 0); band.castShadow = true;
      for (const s of [-1, 1]) { const cup = add(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 18), toon('#ff4fa3'), s * 0.46, 0.5, 0, Math.PI / 2); cup.rotation.z = Math.PI / 2; }
      break;
    }
    case 'Flower': {
      add(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 6), toon('#3c9a3a'), 0.12, 0.98, 0.05, -0.3, 0);
      const fc = new THREE.Vector3(0.17, 1.08, 0.05);
      add(new THREE.SphereGeometry(0.05, 10, 8), toon('#ffd93d'), fc.x, fc.y, fc.z + 0.02);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(new THREE.SphereGeometry(0.05, 8, 6), toon('#ff7ad9'), fc.x + Math.cos(a) * 0.08, fc.y + Math.sin(a) * 0.08, fc.z, 0, 0.02); }
      break;
    }
    case 'Antennae':
      for (const s of [-1, 1]) { add(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 6), dark, s * 0.13, 1.1, 0, -s * 0.35, 0); add(new THREE.SphereGeometry(0.07, 10, 8), toon('#6bcb77', { emissive: '#1f5a24' }), s * 0.19, 1.27, 0); }
      break;
    case 'Mohawk':
      for (let i = -2; i <= 2; i++) { const sp = add(new THREE.ConeGeometry(0.08, 0.36, 8), toon(['#ff5a5a', '#ffa94d', '#ffd93d', '#6bcb77', '#4d79ff'][i + 2]), 0, 1.13 - i * i * 0.05, i * 0.11, 0, 0.02); sp.rotation.x = i * 0.25; }
      break;
    case 'Graduate': {
      add(new THREE.CylinderGeometry(0.26, 0.28, 0.14, 20), dark, 0, 0.88, 0);
      const board = add(new THREE.BoxGeometry(0.62, 0.04, 0.62), dark, 0, 0.97, 0); board.rotation.y = Math.PI / 4;
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6), toon('#ffd93d'), 0.3, 0.88, 0.0, 0, 0);
      add(new THREE.SphereGeometry(0.035, 8, 6), toon('#ffd93d'), 0.3, 0.76, 0, 0, 0);
      break;
    }
  }
  switch (c.outfit) {
    case 'Bandana':   // a red neckerchief tied at the back, its point hanging down the front
      decal = (g, W, H) => { fillShape(g, W, H, [[-0.75, 0.0], [0.75, 0.0], [0.0, -0.36]], '#d62828'); dotsIn(g, W, H, [[-0.75, 0.0], [0.75, 0.0], [0.0, -0.36]], '#ffffff'); bandAround(g, W, H, () => 0.0, 0.07, '#d62828', '#15151a'); };
      flush(new THREE.SphereGeometry(0.07, 10, 8), toon('#d62828'), 0.0, Math.PI, 0.03);
      break;
    case 'Overalls': {
      decal = (g, W, H) => {
        bandAround(g, W, H, () => -0.47, 0.5, '#3d6bd6', '#24408a');                                   // trousers up to the waist
        fillShape(g, W, H, [[-0.42, -0.22], [0.42, -0.22], [0.36, 0.02], [-0.36, 0.02]], '#3d6bd6');   // the bib
        fillShape(g, W, H, [[-0.18, -0.12], [0.18, -0.12], [0.16, -0.02], [-0.16, -0.02]], '#2d55b5'); // its pocket
        for (const s of [-1, 1]) { stripe(g, W, H, [s * 0.34, 0.0], [s * 0.85, 0.12], 0.07, '#3d6bd6'); stripe(g, W, H, [s * 0.85, 0.12], [s * 2.2, 0.1], 0.07, '#3d6bd6'); }   // straps round the sides (an egg's 'shoulders')
      };
      for (const s of [-1, 1]) flush(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 12).rotateX(Math.PI / 2), toon('#ffcc33'), 0.0, s * 0.33, 0.012, 0);
      break;
    }
    case 'Hero Emblem':   // a superhero badge on the chest
      decal = (g, W, H) => { fillShape(g, W, H, [[0, 0.04], [0.5, -0.18], [0, -0.46], [-0.5, -0.18]], '#d62828'); starAt(g, W, H, 0, -0.19, '#ffd93d'); };
      break;
    case 'Lei': {   // a garland of flowers round the neck
      const cols = ['#ff7ad9', '#ffd93d', '#ffffff', '#ff5a5a', '#a66bff'];
      for (let i = 0; i < 22; i++) { const az = -Math.PI + i / 22 * Math.PI * 2, y = 0.0 - 0.12 * Math.cos(az); flush(new THREE.SphereGeometry(0.065, 10, 8), toon(cols[i % 5]), y, az, 0.03, 0.03); }
      break;
    }
    case 'Suspenders':
      decal = (g, W, H) => { for (const s of [-1, 1]) { stripe(g, W, H, [s * 0.3, -0.45], [s * 0.45, -0.05], 0.07, '#d62828'); stripe(g, W, H, [s * 0.45, -0.05], [s * 0.95, 0.1], 0.07, '#d62828'); stripe(g, W, H, [s * 0.95, 0.1], [s * 2.3, -0.2], 0.07, '#d62828'); } };
      for (const s of [-1, 1]) flush(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12).rotateX(Math.PI / 2), toon('#ffcc33'), -0.43, s * 0.3, 0.012, 0);
      break;
    case 'Bling':   // a fat gold chain with a big shiny pendant
      decal = (g, W, H) => beadsAround(g, W, H, az => 0.02 - 0.16 * Math.cos(az), '#ffcc33', 5.5);
      flush(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 6).rotateX(Math.PI / 2), toon('#ffcc33', { emissive: '#664400' }), -0.24, 0, 0.03);
      flush(new THREE.OctahedronGeometry(0.06), toon('#4dd4ff', { emissive: '#1a6f8a' }), -0.24, 0, 0.06, 0);
      break;
    case 'Tie': add(new THREE.BoxGeometry(0.13, 0.36, 0.05), toon('#d62828'), 0, -0.22, eggRadius(-0.22) + 0.02); add(new THREE.BoxGeometry(0.15, 0.09, 0.06), toon('#d62828'), 0, 0.0, eggRadius(0) + 0.02); break;
    case 'Bowtie': {
      const red = toon('#d62828'), z = eggRadius(0.02) + 0.04;
      for (const s of [-1, 1]) { const w = add(new THREE.ConeGeometry(0.08, 0.16, 12), red, s * 0.08, 0.02, z); w.rotation.z = s * Math.PI / 2; }
      add(new THREE.SphereGeometry(0.045, 10, 8), red, 0, 0.02, z + 0.01); break;
    }
    case 'Scarf': {   // a chunky knitted scarf round the 'neck' (just under the mouth), knot and two tails at the side
      const wool = toon('#2a9d8f'), s = add(new THREE.TorusGeometry(eggRadius(-0.02) + 0.045, 0.085, 10, 32), wool, 0, -0.02, 0); s.rotation.x = Math.PI / 2;
      flush(new THREE.SphereGeometry(0.1, 12, 10), wool, -0.04, 0.55, 0.07);
      for (const [dy, roll] of [[-0.22, 0.12], [-0.2, -0.22]]) { const t = flush(new THREE.BoxGeometry(0.12, 0.3, 0.05), wool, dy, 0.6 + roll * 0.4, 0.06); t.rotation.z += roll; }
      break;
    }
    case 'Belt':
      decal = (g, W, H) => bandAround(g, W, H, () => -0.3, 0.11, '#3b2414', '#15151a');
      flush(new THREE.BoxGeometry(0.2, 0.15, 0.05), gold, -0.3, 0, 0.02); flush(new THREE.BoxGeometry(0.11, 0.07, 0.06), dark, -0.3, 0, 0.03, 0);
      break;
    case 'Cape':
      cape = at(new THREE.Group(), 0, 0.45, 0); eggOnly.add(cape);   // a curved cape wrapped round the back, hanging from the 'shoulders'
      { const prof = Array.from({ length: 12 }, (_, i) => { const y = 0.45 - i * 0.1; return new THREE.Vector2(eggRadius(y) + 0.05 + i * 0.012, y - 0.45); }); cape.add(mesh(new THREE.LatheGeometry(prof, 20, Math.PI - 0.95, 1.9), toon('#c1121f', { side: THREE.DoubleSide }))); }   // follows the shell, flaring out a little toward the hem
      break;
    case 'Backpack': {
      const z = -(eggRadius(0) + 0.1);
      add(new THREE.BoxGeometry(0.46, 0.52, 0.22), toon('#6a4c93'), 0, -0.02, z);
      add(new THREE.BoxGeometry(0.36, 0.2, 0.06), toon('#8f6bbf'), 0, -0.12, z - 0.13); break;
    }
    case 'Hero Mask': decal = (g, W, H) => paintMask(g, W, H, ey); break;
    case 'Necklace':
      decal = (g, W, H) => beadsAround(g, W, H, az => 0.03 - 0.12 * Math.cos(az), '#ffcc33');
      flush(new THREE.OctahedronGeometry(0.065), toon('#4dd4ff', { emissive: '#1a6f8a' }), -0.15, 0, 0.05);
      break;
    case 'Medal':
      decal = (g, W, H) => { stripe(g, W, H, [-0.42, 0.04], [0, -0.17], 0.07, '#4d79ff'); stripe(g, W, H, [0.42, 0.04], [0, -0.17], 0.07, '#d62828'); };
      flush(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 20).rotateX(Math.PI / 2), gold, -0.22, 0, 0.02);
      flush(new THREE.OctahedronGeometry(0.035), toon('#ffffff', { emissive: '#777' }), -0.22, 0, 0.045, 0);
      break;
    case 'Wings':
      for (const s of [-1, 1]) { const w = add(new THREE.SphereGeometry(0.3, 14, 10), white, s * 0.32, 0.15, -eggRadius(0.15) - 0.05, s * -0.5); w.scale.set(0.5, 1.1, 0.18); w.rotation.y = s * 0.5; }
      break;
    case 'Tutu': {
      const r = eggRadius(-0.32);
      add(new THREE.CylinderGeometry(r + 0.04, r + 0.28, 0.16, 28, 1, true), toon('#ff8fc7', { side: THREE.DoubleSide }), 0, -0.36, 0, 0, 0.02);
      break;
    }
    case 'Jetpack': {
      const z = -(eggRadius(0) + 0.14);
      for (const s of [-1, 1]) { add(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 14), toon('#a8adb5', { emissive: '#222' }), s * 0.13, 0, z); add(new THREE.ConeGeometry(0.1, 0.14, 14), toon('#ff5a5a'), s * 0.13, -0.32, z, Math.PI); }
      add(new THREE.BoxGeometry(0.2, 0.3, 0.12), toon('#555b63'), 0, 0.02, z + 0.05);
      break;
    }
    case 'Sash': {
      decal = (g, W, H) => bandAround(g, W, H, az => -0.08 + 0.3 * Math.sin(az), 0.13, '#d62828', '#ffcc33');   // over one shoulder, round to the other hip
      flush(new THREE.SphereGeometry(0.06, 12, 10), gold, -0.38 + 0.0, 1.35, 0.02);
      break;
    }
  }

  const bump = at(mesh(new THREE.SphereGeometry(0.12, 12, 8), skin, 0.08, false), 0.05, 0.93, 0.05); bump.scale.set(1, 0.7, 1); bump.visible = false; eggOnly.add(bump);   // cartoon lump after a bonk
  const stars = at(new THREE.Group(), 0, 1.35, 0); body.add(stars);
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; stars.add(at(mesh(new THREE.OctahedronGeometry(0.1), toon('#ffe14d')), Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35)); }
  stars.visible = false;

  const m = { group: root, size, pivot, body, eggOnly, yolkOnly, arms, legs, eyes, brows, mouth, cape, propeller, stars, bump, skin, color: c.color, shellMat, yolkMat, shellTex, shellCv, patternCv, shellMesh,
    art: { base: baseCv, photo: null, paint: null, decal }, crackLevel: 0,
    cracks: crackLines(), weapon: null, weaponKind: null,
    a: { phase: 0, sq: 0, sqv: 0, air: 0, ground: true, yolk: false, stun: false, bob: 0, blink: Math.random() * 4, seed: Math.random() * 10 } };
  const load = (src, key) => new Promise(done => { const img = new Image(); img.onload = () => { m.art[key] = img; done(); }; img.onerror = done; img.src = src; });
  m.ready = Promise.all([photo && load(photo, 'photo'), c.paint && load(c.paint, 'paint')]).then(() => composeShell(m));
  composeShell(m);
  return m;
}
// ---- painting on the shell texture ----
const fitY = r => { let lo = EGG_C, hi = EGG_C + EGG_H; for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (eggRadius(mid) > r) lo = mid; else hi = mid; } return lo; };   // height where the shell is r wide
const texRow = y => (1 - Math.acos(Math.max(-1, Math.min(1, -(y - EGG_C) / EGG_H))) / Math.PI);   // 0 = top of the texture
const texCol = az => az / (2 * Math.PI);   // 0 = front, wraps at 1
function trace(g, W, H, pts, width, color) {   // a stroke along [az, y] points, drawn twice so it wraps round the back seam
  for (const off of [0, W, -W]) {
    g.beginPath(); pts.forEach(([az, y], i) => { const x = texCol(az) * W + off, py = texRow(y) * H; i ? g.lineTo(x, py) : g.moveTo(x, py); });
    g.strokeStyle = color; g.lineWidth = width; g.lineCap = g.lineJoin = 'round'; g.stroke();
  }
}
const rowPx = (y, w, H) => (texRow(y - w / 2) - texRow(y + w / 2)) * H;   // a height in world units -> texture pixels
function bandAround(g, W, H, yOf, w, color, edge) {
  const pts = []; for (let az = -Math.PI; az <= Math.PI + 1e-6; az += 0.04) pts.push([az, yOf(az)]);
  const px = rowPx(yOf(0), w, H);
  if (edge) trace(g, W, H, pts, px + 5, edge);
  trace(g, W, H, pts, px, color);
}
const toTex = (W, H, [az, y], off) => [texCol(az) * W + off, texRow(y) * H];
function fillShape(g, W, H, pts, color, edge = '#15151a') {   // a filled polygon given as [az, y] corners
  for (const off of [0, W, -W]) {
    g.beginPath(); pts.forEach((p, i) => { const [x, y] = toTex(W, H, p, off); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
    g.fillStyle = color; g.fill(); g.strokeStyle = edge; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke();
  }
}
function dotsIn(g, W, H, pts, color) {   // polka dots inside a shape
  g.save(); g.beginPath(); pts.forEach((p, i) => { const [x, y] = toTex(W, H, p, 0); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.clip();
  g.fillStyle = color; for (let x = -120; x < 120; x += 16) for (let y = 0; y < H; y += 12) { g.beginPath(); g.arc(x + ((y / 12) % 2) * 8, y, 2.6, 0, 7); g.fill(); }
  g.restore();
}
function starAt(g, W, H, az, y, color) {
  const r = 22;
  for (const off of [0, W]) {   // drawn twice: the front of the egg is where the texture wraps
    const [cx, cy] = toTex(W, H, [az, y], off);
    g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(cx + Math.cos(a) * rr * 1.25, cy + Math.sin(a) * rr); } g.closePath();
    g.fillStyle = color; g.fill(); g.strokeStyle = '#15151a'; g.lineWidth = 2.5; g.stroke();
  }
}
function beadsAround(g, W, H, yOf, color, size = 4.2) {
  for (let az = -Math.PI; az < Math.PI; az += 0.13) for (const off of [0, W]) {
    const x = texCol(az) * W + off, y = texRow(yOf(az)) * H;
    g.fillStyle = '#7a5200'; g.beginPath(); g.arc(x, y, size, 0, 7); g.fill(); g.fillStyle = color; g.beginPath(); g.arc(x - 0.6, y - 0.6, size - 1, 0, 7); g.fill();
  }
}
function stripe(g, W, H, [az0, y0], [az1, y1], w, color) {
  const pts = []; for (let i = 0; i <= 12; i++) pts.push([az0 + (az1 - az0) * i / 12, y0 + (y1 - y0) * i / 12]);
  trace(g, W, H, pts, rowPx(y0, w, H) + 3, '#15151a'); trace(g, W, H, pts, rowPx(y0, w, H), color);
}
function paintMask(g, W, H, ey) {   // a classic eye mask round the eyes, with a strap and a knot at the back
  const cy = texRow(ey) * H, sx = W / (2 * Math.PI * eggRadius(ey)), sy = rowPx(ey, 1, H);
  const shapes = g2 => {
    for (const s of [-1, 1]) { g2.beginPath(); g2.ellipse(texCol(s * 0.31) * W, cy, 0.23 * sx, 0.15 * sy, s * 0.15, 0, 7); g2.fill(); g2.stroke(); }
    g2.beginPath(); g2.rect(-0.3 * sx, cy - 0.07 * sy, 0.6 * sx, 0.12 * sy); g2.fill(); g2.stroke();
  };
  trace(g, W, H, [[-Math.PI, ey + 0.02], [Math.PI, ey + 0.02]], rowPx(ey, 0.07, H) + 4, '#15151a');   // strap all the way round
  trace(g, W, H, [[-Math.PI, ey + 0.02], [Math.PI, ey + 0.02]], rowPx(ey, 0.07, H), '#c1121f');
  for (const off of [0, W]) {
    g.save(); g.translate(off, 0); g.fillStyle = '#c1121f'; g.strokeStyle = '#15151a'; g.lineWidth = 4;
    g.globalCompositeOperation = 'source-over'; shapes(g); g.lineWidth = 0; g.fillStyle = '#c1121f';
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(texCol(s * 0.31) * W, cy, 0.23 * sx - 2, 0.15 * sy - 2, s * 0.15, 0, 7); g.fill(); }   // fill over the inner outlines
    g.fillRect(-0.3 * sx, cy - 0.07 * sy + 2, 0.6 * sx, 0.12 * sy - 4);
    g.restore();
  }
  const bx = W / 2, by = texRow(ey + 0.02) * H;   // the knot and its two tails at the back
  for (const s of [-1, 1]) { g.fillStyle = '#c1121f'; g.strokeStyle = '#15151a'; g.lineWidth = 3; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + s * 16, by + 30); g.lineTo(bx + s * 4, by + 32); g.closePath(); g.fill(); g.stroke(); }
  g.beginPath(); g.arc(bx, by, 6, 0, 7); g.fill(); g.stroke();
}
// Redraw the shell art (pattern + photo + drawing) and the cracks. The egg editor calls this live while you draw.
export function composeShell(m) {
  const g = m.patternCv.getContext('2d'), { base, photo, paint } = m.art;
  g.drawImage(base, 0, 0);
  if (photo) paintPhoto(m.patternCv, photo);
  if (m.art.decal) m.art.decal(g, m.patternCv.width, m.patternCv.height);
  if (paint) g.drawImage(paint, 0, 0, m.patternCv.width, m.patternCv.height);
  drawShell(m, m.crackLevel);
}
// Free a model's GPU memory (previews), keeping what every egg shares
const SHARED = new Set([eggGeo, FOOT, OUTLINE, SHINE]);
export function disposeModel(m) {
  m.group.traverse(o => {
    if (o.geometry && !SHARED.has(o.geometry)) o.geometry.dispose();
    for (const mt of [].concat(o.material || [])) if (!SHARED.has(mt)) { mt.map?.dispose(); mt.dispose(); }
  });
}
// Wrap a picture all the way round the shell: its middle half is the front (face), the outer quarters meet at the back.
// Rows follow the egg's height (top 0.95 to bottom -0.85), like the editor's crop frame.
function paintPhoto(cv, img) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, top = EGG_C + EGG_H, h = 2 * EGG_H;
  for (let cy = 0; cy < H; cy++) {
    const v = 1 - (cy + 0.5) / H, y = EGG_C - EGG_H * Math.cos(Math.PI * v), sy = Math.min(img.height - 1, Math.max(0, Math.floor((top - y) / h * img.height)));
    const k = img.width < img.height * 1.5 ? 0.5 : 1;   // an older, front-only (tall) picture stays on the front half
    g.drawImage(img, img.width / 2, sy, img.width / 2, 1, 0, cy, W / 2 * k, 1);                 // texture u 0..0.5 = picture's right half
    g.drawImage(img, 0, sy, img.width / 2, 1, W - W / 2 * k, cy, W / 2 * k, 1);               // u 0.5..1 = left half
  }
}

// ---------- items ----------
// A Kenney model held in the hand: turned by `rot` so its handle points up the arm (+y) and its business end hangs down (-y),
// scaled to `length` and gripped `grip` below its top end.
const box3 = new THREE.Box3(), v3 = new THREE.Vector3();
function held(key, length, rot, grip = 0.08) {
  const inner = model(key, 1, 'scale'), g = new THREE.Group();
  inner.rotation.set(...rot); g.add(inner); g.updateMatrixWorld(true); box3.setFromObject(inner);
  inner.scale.setScalar(length / (box3.max.y - box3.min.y)); g.updateMatrixWorld(true); box3.setFromObject(inner);
  box3.getCenter(v3); inner.position.set(-v3.x, grip - box3.max.y, -v3.z);
  return g;
}
export function weaponMesh(kind) {
  const g = new THREE.Group();
  const lathe = (pts, color, outline = 0.06, seg = 16) => mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)).reverse(), seg), toon(color), outline);   // profile listed top-down; lathe wants bottom-up for outward faces
  if (kind === 'bat') {   // knob, taped handle, long taper into the barrel
    g.add(lathe([[0, 0.09], [0.06, 0.08], [0.065, 0.05], [0.032, 0.03], [0.03, -0.24], [0.04, -0.4], [0.062, -0.58], [0.08, -0.78], [0.084, -0.9], [0.07, -0.97], [0, -0.99]], '#d39a5c'));
    g.add(at(mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.22, 12), toon('#26262c')), 0, -0.1, 0));
    for (const y of [-0.03, -0.17]) g.add(at(mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.012, 12), toon('#d62828')), 0, y, 0));
  }
  if (kind === 'pan') g.add(held('food/frying-pan', 0.95, [Math.PI / 2, 0, 0]));   // handle up the arm, cooking face forward
  if (kind === 'glove') {   // boxing glove: padded fist, thumb, laced white cuff
    const fist = at(mesh(new THREE.SphereGeometry(0.24, 18, 14), toon('#d62828'), 0.05), 0, -0.14, 0.02); fist.scale.set(1, 1.18, 1.08); g.add(fist);
    const thumb = at(mesh(new THREE.CapsuleGeometry(0.075, 0.13, 6, 10), toon('#d62828'), 0.06), 0.19, -0.06, 0.1); thumb.rotation.set(0.3, 0, -0.45); g.add(thumb);
    g.add(at(mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.17, 18), toon('#f5f5f5'), 0.05), 0, 0.12, 0));
    for (const y of [0.08, 0.16]) { const lace = at(mesh(new THREE.TorusGeometry(0.172, 0.012, 4, 20), toon('#26262c')), 0, y, 0); lace.rotation.x = Math.PI / 2; g.add(lace); }
    g.add(at(mesh(new THREE.SphereGeometry(0.06, 8, 6), SHINE), -0.1, -0.02, 0.17));
  }
  if (kind === 'blaster') {   // egg blaster: barrel along -y (forward when aimed), glass egg tank on top (+z), grip in the hand
    const body = at(mesh(new THREE.CapsuleGeometry(0.11, 0.42, 6, 14), toon('#4dd4ff'), 0.05), 0, -0.3, 0.17); g.add(body);
    g.add(at(mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.26, 14), toon('#ffd93d'), 0.06), 0, -0.68, 0.17));
    const muzzle = at(mesh(new THREE.TorusGeometry(0.075, 0.028, 8, 16), toon('#ff5a5a')), 0, -0.81, 0.17); muzzle.rotation.x = Math.PI / 2; g.add(muzzle);
    const grip = at(mesh(new THREE.BoxGeometry(0.1, 0.12, 0.22), toon('#26262c'), 0.06), 0, 0.0, 0.06); grip.rotation.x = -0.25; g.add(grip);
    const tank = at(mesh(new THREE.SphereGeometry(0.11, 14, 10), new THREE.MeshToonMaterial({ color: '#c8f0ff', gradientMap: grad, transparent: true, opacity: 0.55 })), 0, -0.22, 0.33); tank.scale.set(1, 1.3, 1); g.add(tank);
    const egg = at(mesh(new THREE.SphereGeometry(0.065, 12, 8), toon('#fff4e0')), 0, -0.22, 0.33); egg.scale.set(1, 1.3, 1); g.add(egg);
    for (const y of [-0.12, -0.44]) { const band = at(mesh(new THREE.TorusGeometry(0.112, 0.018, 6, 18), toon('#ffd93d')), 0, y, 0.17); band.rotation.x = Math.PI / 2; g.add(band); }
  }
  if (kind === 'hammer') {   // big mallet: wooden handle, steel head whose faces point forward (+z) at the swing
    g.add(lathe([[0, 0.06], [0.045, 0.05], [0.04, 0], [0.036, -0.4], [0.042, -0.7], [0.042, -0.74], [0, -0.75]], '#9b6a3c'));
    g.add(at(mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.2, 12), toon('#26262c')), 0, -0.06, 0));
    const head = at(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.46, 18), toon('#9aa3ad'), 0.05), 0, -0.8, 0); head.rotation.x = Math.PI / 2; g.add(head);
    for (const z of [-0.2, 0.2]) { const rim = at(mesh(new THREE.CylinderGeometry(0.172, 0.172, 0.06, 18), toon('#555b63')), 0, -0.8, z); rim.rotation.x = Math.PI / 2; g.add(rim); }
  }
  if (kind === 'bombs' || kind === 'bomb') {   // round black bomb, metal cap, curled fuse with a spark
    const y = kind === 'bomb' ? 0 : -0.24;
    g.add(at(mesh(new THREE.SphereGeometry(0.24, 18, 14), toon('#2a2a31'), 0.05), 0, y, 0));
    g.add(at(mesh(new THREE.SphereGeometry(0.06, 8, 6), SHINE), -0.09, y + 0.1, 0.15));
    g.add(at(mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.08, 12), toon('#8d8d99'), 0.06), 0, y + 0.24, 0));
    const fuse = new THREE.CatmullRomCurve3([[0, 0.27], [0.02, 0.36], [0.09, 0.41], [0.13, 0.37]].map(([x, h]) => new THREE.Vector3(x, y + h, 0)));
    g.add(mesh(new THREE.TubeGeometry(fuse, 12, 0.018, 6), toon('#c9a26b')));
    g.add(at(mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffb000' })), 0.13, y + 0.37, 0));   // spark
  }
  if (kind === 'banana') g.add(held('food/banana', 0.62, [-Math.PI / 2, 0, 0]));   // held by the stem
  if (kind === 'pin') g.add(held('food/rollingPin', 0.95, [0, 0, Math.PI / 2], 0.1));   // rolling pin, gripped by one handle
  if (kind === 'spatula') {   // wooden handle up the arm, a wide slotted metal flipper facing forward
    g.add(at(mesh(new THREE.CylinderGeometry(0.038, 0.034, 0.48, 12), toon('#9b6a3c'), 0.06), 0, -0.18, 0));
    g.add(at(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8), toon('#9aa3ad')), 0, -0.48, 0));
    g.add(at(mesh(new THREE.BoxGeometry(0.3, 0.34, 0.03), toon('#c9ced6', { emissive: '#222' }), 0.05), 0, -0.71, 0));
    for (const x of [-0.08, 0, 0.08]) g.add(at(mesh(new THREE.BoxGeometry(0.03, 0.2, 0.034), toon('#555b63')), x, -0.71, 0));
  }
  if (kind === 'sausage') {   // a big plump sausage, slightly bent, tied at both ends
    const c = new THREE.CatmullRomCurve3([[0, -0.02, 0], [0, -0.3, 0.06], [0, -0.6, 0.05], [0, -0.82, -0.02]].map(p => new THREE.Vector3(...p)));
    g.add(mesh(new THREE.TubeGeometry(c, 16, 0.1, 12), toon('#b5502f'), 0.06));
    for (const y of [-0.02, -0.82]) g.add(at(mesh(new THREE.SphereGeometry(0.1, 12, 10), toon('#b5502f')), 0, y, y < -0.5 ? -0.02 : 0));
    for (const y of [0.09, -0.93]) g.add(at(mesh(new THREE.SphereGeometry(0.035, 8, 6), toon('#e8d3a8')), 0, y, y < -0.5 ? -0.02 : 0));
    g.add(at(mesh(new THREE.SphereGeometry(0.05, 8, 6), SHINE), -0.06, -0.35, 0.1));
  }
  if (kind === 'peel') {   // a splayed-out banana peel lying on the floor
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.4, petal = mesh(new THREE.SphereGeometry(1, 12, 8), toon('#ffe135'), 0.08);
      petal.scale.set(0.075, 0.025, 0.22); petal.position.set(Math.sin(a) * 0.18, 0.03, Math.cos(a) * 0.18); petal.rotation.set(0, a, 0); g.add(petal);
      g.add(at(mesh(new THREE.SphereGeometry(0.03, 6, 4), toon('#5a3a22')), Math.sin(a) * 0.38, 0.03, Math.cos(a) * 0.38));
    }
    g.add(at(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.12, 10), toon('#f2cf2e'), 0.06), 0, 0.06, 0));
    g.add(at(mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.08, 6), toon('#5a3a22')), 0, 0.15, 0));
  }
  if (kind === 'pepper') g.add(held('food/pepper', 0.44, [-Math.PI / 2, 0, 0]));   // the model lies along z: stand it up first, or the scale-to-height blows it up
  if (kind === 'egg') { const e = mesh(new THREE.SphereGeometry(0.2, 14, 10), toon('#fff4e0'), 0.08); e.scale.set(1, 1.3, 1); g.add(e); }
  if (kind === 'shell') {   // a spare shell to climb back into
    const s = mesh(eggGeo, toon('#fff4e0'), 0.04); s.scale.setScalar(0.75); g.add(s);
    const band = mesh(new THREE.TorusGeometry(eggRadius(0) * 0.75 + 0.01, 0.03, 6, 24), toon('#6bcb77')); band.rotation.x = Math.PI / 2; g.add(band);
  }
  return g;
}
export function setWeapon(m, kind) {
  if (m.weaponKind === kind) return;
  if (m.weapon) m.weapon.parent.remove(m.weapon);
  m.weaponKind = kind; m.weapon = null;
  if (kind) { m.weapon = at(weaponMesh(kind), 0, -0.02, 0); m.arms[1].hand.add(m.weapon); }
}

// ---------- animation ----------
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Procedural animation driven only by replicated player state, so online clients animate identically.
export function animate(m, p, dt, t) {
  const v = p.body.velocity, sp = Math.hypot(v.x, v.z), a = m.a;
  const F = p.flags || 0, hold = F & 1, held = F & 2, grounded = F & 4, cheer = F & 8, hang = F & 16, yolk = !!(F & 32);
  const ko = p.ko > 0, stun = p.stun > 0 && !ko, run = Math.min(1, sp / 8);

  // egg <-> yolk swap with a quick shrink/grow
  if (yolk !== a.yolk) {
    a.yolk = yolk; m.eggOnly.visible = !yolk; m.yolkOnly.visible = yolk;
    m.skin.color.set(yolk ? YOLK : m.color); a.sqv -= 3;
  }
  m.size.scale.setScalar(damp(m.size.scale.x, yolk ? 0.62 : 1, 10, dt));

  // jelly squash spring: kicked by landing, jumping and getting hit
  if (grounded && !a.ground && a.air > 0.12) { a.sqv -= Math.min(4.5, 1 + a.air * 4); a.land = Math.min(0.3, 0.1 + a.air * 0.3); }
  a.land = Math.max(0, (a.land || 0) - dt);
  if (a.wasKo && !ko) a.getup = 0.8;   // just got up from a knockdown: dizzy for a moment
  a.wasKo = ko; a.getup = Math.max(0, (a.getup || 0) - dt);
  if (!grounded && a.ground && v.y > 3) a.sqv += 2.5;
  if (stun && !a.stun) a.sqv -= 2.2;
  a.stun = stun; a.air = grounded ? 0 : a.air + dt; a.ground = !!grounded;
  a.sqv += (-a.sq * 230 - a.sqv * 11) * dt; a.sq += a.sqv * dt;
  let sy = 1 + a.sq * 0.3 + Math.sin(t * 2.6 + a.seed) * 0.015 * (1 - run);
  if (!grounded && !ko && !hang) sy += clamp(v.y * 0.015, -0.06, 0.1);
  sy = clamp(sy, 0.6, 1.4);
  const sxz = 1 / Math.sqrt(sy);   // keep the volume
  m.pivot.scale.set(sxz, sy, sxz);

  // ---- target pose: locomotion first, then states override ----
  a.phase += (grounded ? sp : 0) * dt * 1.25;
  const step = Math.floor(a.phase / Math.PI);
  if (step !== a.step) { a.step = step; if (grounded && run > 0.4) a.sqv -= 0.9 * run; }   // a little squash on every footfall
  const idle = grounded && sp < 0.6 && p.attackT < 0 && !hold && !(F & 128);
  a.idle = idle ? (a.idle || 0) + dt : 0;
  if (a.idle > 5 + (a.seed % 3)) { a.idle = 0; a.fidget = 1.6; a.fidgetKind = ((a.fidgetKind ?? -1) + 1) % 5; }
  a.fidget = idle ? Math.max(0, (a.fidget || 0) - dt) : 0;
  const ph = a.phase, T = {
    bx: run * 0.18, by: Math.sin(t * 0.6 + a.seed) * 0.18 * (1 - run), bz: Math.sin(ph) * 0.07 * run + Math.sin(t * 0.9 + a.seed) * 0.035 * (1 - run),
    bob: Math.abs(Math.sin(ph)) * 0.08 * run, lunge: 0, sh: [[0, 0], [0, 0]], el: [0, 0], hip: [0, 0], knee: [0, 0], ank: [0, 0],
  };
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1, lp = ph + i * Math.PI, ls = Math.sin(lp), lc = Math.cos(lp);
    T.hip[i] = -ls * 0.75 * run;
    T.knee[i] = Math.max(0, lc) * 1.2 * run;
    T.ank[i] = -(T.hip[i] + T.knee[i]) * 0.7;
    T.sh[i] = [ls * 0.8 * run + Math.sin(t * 1.7 + i) * 0.05 * (1 - run), s * (0.12 + 0.06 * run)];
    T.el[i] = -0.35 - 0.6 * run;
  }
  const both = (sh, el) => { for (let i = 0; i < 2; i++) { T.sh[i] = [sh[0], (i ? 1 : -1) * sh[1]]; T.el[i] = el; } };
  const legsTo = (hip, knee, ank = 0) => { for (let i = 0; i < 2; i++) { T.hip[i] = hip[i]; T.knee[i] = knee[i]; T.ank[i] = ank; } };
  const crouch = k => legsTo([-0.55 * k, -0.55 * k], [1.1 * k, 1.1 * k], -0.55 * k);
  if (a.land > 0 && run < 0.5) { crouch(a.land * 2.5); T.bob = -0.08 * a.land * 3; }
  if (a.fidget > 0) {
    const k = Math.sin(Math.min(1, (1.6 - a.fidget) / 0.3) * Math.PI / 2) * Math.min(1, a.fidget / 0.3);
    const u = 1.6 - a.fidget;
    if (a.fidgetKind === 1) { both([-2.9 * k, 0.5 * k], -0.4 * k); T.bx = -0.15 * k; }   // big stretch
    else if (a.fidgetKind === 2) { T.sh[1] = [-2.8 * k, -0.5 + Math.sin(u * 14) * 0.45]; T.el[1] = -0.6 * k; T.by = 0.35 * k; T.bz = -0.08 * k; }   // wave hello
    else if (a.fidgetKind === 3) { const hop = Math.abs(Math.sin(u * 7)); T.bob = hop * 0.28 * k; both([-0.5, 0.6 + hop * 0.5], -0.8); if (hop < 0.15 && !a.hopped) { a.sqv -= 1.5; a.hopped = true; } if (hop > 0.5) a.hopped = false; }   // happy bounce
    else if (a.fidgetKind === 4) both([-0.3 * k, 1.25 * k], -0.2);   // twirl (spin applied below)
    else T.by = Math.sin(u * 5) * 0.8 * k;   // look around
  }
  // banking into turns, and a lean-back skid when stopping from a run
  const yawNow = p.yaw || 0, dyaw = Math.atan2(Math.sin(yawNow - (a.yaw ?? yawNow)), Math.cos(yawNow - (a.yaw ?? yawNow))) / Math.max(dt, 1e-3);
  a.yaw = yawNow; T.bz += clamp(-dyaw * 0.035 * run, -0.3, 0.3);
  a.spS = damp(a.spS ?? sp, sp, 10, dt); const decel = (a.spPrev ?? a.spS) - a.spS; a.spPrev = a.spS;
  if (grounded && decel > dt * 25 && a.spS > 3.5 && p.attackT < 0) a.skid = 0.22;
  a.skid = Math.max(0, (a.skid || 0) - dt);
  if (a.skid > 0) { T.bx = -0.38; legsTo([-0.65, -0.25], [0.25, 0.55], 0.45); both([-0.7, 0.95], -0.4); }

  if (!grounded && !ko && !hang) {
    const fall = v.y < -4;
    legsTo([0.2, -0.75], [0.6, 1.3], 0.3);
    if (fall) for (let i = 0; i < 2; i++) { T.sh[i] = [-2.5 + Math.sin(t * 16 + i * 2) * 0.5, (i ? 1 : -1) * 0.6]; T.el[i] = -0.3; }
    else both([-0.7, 1.1], -0.3);
    T.bx = fall ? -0.1 : 0.12;
  }
  if (hold) both([-2.3, 0.25], -0.5);
  if ((F & 512) && grounded && p.attackT < 0 && !hold && !ko) {   // teetering on a ledge: windmilling arms, rocking back and forth
    for (let i = 0; i < 2; i++) { const s = i ? 1 : -1, w = t * 13 + i * Math.PI; T.sh[i] = [-1.6 + Math.sin(w) * 1.3, s * (1.1 + Math.cos(w) * 0.4)]; T.el[i] = -0.2; }
    T.bx = 0.22 + Math.sin(t * 6) * 0.25; T.bz = Math.sin(t * 3.1) * 0.12;
  }
  // just picked up a weapon: hold it up high for a moment
  if (p.weapon !== a.weapon) { if (p.weapon && a.weapon !== undefined) a.flourish = 0.6; a.weapon = p.weapon; }
  a.flourish = Math.max(0, (a.flourish || 0) - dt);
  if (a.flourish > 0 && !hang && !ko) { const k = Math.min(1, a.flourish / 0.15); T.sh[1] = [-3.0 * k, 0.3]; T.el[1] = -0.15; T.bx = -0.12 * k; T.bob += 0.1 * k; }
  // bonked by an item: big squash, wobbling head, floppy arms (bump + stars below)
  if (a.boink > (a.boinkPrev || 0) + 0.01) a.sqv -= 7;
  a.boinkPrev = a.boink = Math.max(0, (a.boink || 0) - dt / 0.9);
  if (a.boink > 0 && !ko) { const k = a.boink; T.bz = Math.sin(t * 26) * 0.3 * k; both([0.3, 0.9 + Math.sin(t * 20) * 0.35], -0.3); T.bx = -0.15 * k; }
  if (held) {
    for (let i = 0; i < 2; i++) { T.sh[i] = [-2.6 + Math.sin(t * 18 + i * 2) * 0.4, (i ? 1 : -1) * 0.6]; T.el[i] = -0.4; T.hip[i] = Math.sin(t * 20 + i * 3) * 0.8; T.knee[i] = 0.8; }
  }
  if (hang) {
    both([-3.0, 0.22], -0.2); T.bx = -0.1;
    for (let i = 0; i < 2; i++) { T.hip[i] = Math.sin(t * 7 + i * 3) * 0.45; T.knee[i] = 0.5 + Math.sin(t * 7 + i * 3) * 0.3; }
  }
  if (stun) {   // knocked back = head snaps back; shoved from behind = stumble forward
    const fwd = v.x * Math.sin(p.yaw || 0) + v.z * Math.cos(p.yaw || 0);
    both([0.5, 1.1], -0.2); T.bx = fwd < 0 ? -0.5 : 0.4; T.lunge = fwd < 0 ? -0.14 : 0.1; T.by = Math.sin(t * 30) * 0.08;
  }
  if (a.getup > 0 && !ko) {   // dizzy get-up wobble
    both([-0.4, 0.7 + Math.sin(t * 9) * 0.3], -0.6); T.bz = Math.sin(t * 9) * 0.22 * a.getup; T.by = Math.sin(t * 5) * 0.4 * a.getup;
  }
  if ((F & 128) && !hold && !ko && !hang) { both([-1.5, 0.42], -2.0); T.bx = 0.1; crouch(0.35); }   // guard: fists up in front of the face

  // attacks: wind-up pose, then a fast strike
  const atk = ATTACKS[p.attackKind] && p.attackT >= 0 && !ko ? ATTACKS[p.attackKind] : null;
  let armRate = 16;
  if (atk) {
    const kind = p.attackKind, w = atk.windup, k = clamp(p.attackT / w, 0, 1), strike = p.attackT >= w;
    armRate = strike ? 60 : 24;
    if (kind <= 2 || kind === 5) {
      const i = kind === 1 ? 0 : 1, s = i ? 1 : -1, big = kind === 5 ? 1.4 : 1;
      if (!strike) { T.sh[i] = [0.8 * k * big, s * 0.35]; T.el[i] = -2.1 * k; T.by = -s * 0.45 * k * big; T.bx = -0.08 * k; }
      else { T.sh[i] = [-1.65, -s * 0.05]; T.el[i] = 0; T.sh[1 - i] = [0.5, -s * 0.4]; T.el[1 - i] = -1.3; T.by = s * 0.5 * big; T.bx = 0.15; T.lunge = 0.25 * big; }
    } else if (kind === 3 || kind === 4) {
      if (!strike) { both([-2.9 * k, 0.15], -0.7 * k); T.bx = -0.25 * k; }
      else { both([-0.45, 0.1], 0); T.bx = 0.4; T.lunge = 0.22; }
    } else if (kind === 6) { T.sh[1] = [strike ? -1.2 : -1.57, 0]; T.el[1] = 0; if (strike) { T.bx = -0.15; T.lunge = -0.1; } }
    else if (kind === 7 || kind === 8) { both(strike ? [-1.4, 0.1] : [-2.4, 0.2], 0); T.lunge = strike ? 0.2 : 0; T.bx = strike ? 0.25 : -0.1; }
    else if (kind === 9) {   // haymaker: big coil, then a swinging hook with a little hop
      if (!strike) { T.sh[1] = [0.9 * k, 0.8 * k]; T.el[1] = -1.7 * k; T.sh[0] = [-1.0 * k, -0.25]; T.el[0] = -1.3; T.by = -0.95 * k; T.bx = -0.18 * k; T.lunge = -0.1 * k; crouch(0.4 * k); }
      else { T.sh[1] = [-1.95, -0.4]; T.el[1] = -0.15; T.sh[0] = [0.7, -0.45]; T.el[0] = -1.2; T.by = 0.85; T.bx = 0.32; T.lunge = 0.38; T.bob = 0.14; }
    } else if (kind === 10) { both([-2.75, 0.12], -0.05); T.bx = 1.05; T.lunge = 0.25; legsTo([0.9, 0.9], [0.35, 0.35], 0.5); }   // flying headbutt: superman dive
    if (F & 256) { T.by *= 1.25; T.lunge -= 0.1; T.bz += Math.sin(t * 47) * 0.035; crouch(0.45); }   // charging: coiled and trembling
  } else if (p.weapon === 'blaster' && !hang && !ko) { T.sh[1] = [-1.45, 0.05]; T.el[1] = -0.1; }

  if (cheer) {
    for (let i = 0; i < 2; i++) { T.sh[i] = [-2.9, (i ? 1 : -1) * (0.4 + Math.sin(t * 12 + i * 2) * 0.35)]; T.el[i] = -0.3; }
    T.bob = Math.abs(Math.sin(t * 8)) * 0.4; T.by = Math.sin(t * 4) * 0.9; T.bz = Math.sin(t * 8) * 0.12;   // victory dance
  }
  if (ko) { both([-0.3, 1.4], -0.2); legsTo([-0.4, -0.2], [0.6, 0.4]); T.bx = 0; T.by = 0; }

  // ---- apply with smoothing ----
  const B = m.body;
  B.rotation.x = damp(B.rotation.x, T.bx, 12, dt);
  B.rotation.y = damp(B.rotation.y, T.by, atk ? armRate : 10, dt);
  if (a.fidget > 0 && a.fidgetKind === 4) { const e = 1 - a.fidget / 1.6; B.rotation.y = e * e * (3 - 2 * e) * Math.PI * 2; a.twirl = true; }   // a full pirouette
  else if (a.twirl) { a.twirl = false; B.rotation.y = Math.atan2(Math.sin(B.rotation.y), Math.cos(B.rotation.y)); }
  B.rotation.z = damp(B.rotation.z, T.bz, 10, dt);
  a.bob = damp(a.bob, T.bob, 14, dt);
  B.position.y = BODY_Y + a.bob;
  B.position.z = damp(B.position.z, T.lunge, atk ? armRate : 12, dt);
  m.arms.forEach((arm, i) => {
    arm.sh.rotation.x = damp(arm.sh.rotation.x, T.sh[i][0], armRate, dt);
    arm.sh.rotation.z = damp(arm.sh.rotation.z, T.sh[i][1], armRate, dt);
    arm.el.rotation.x = damp(arm.el.rotation.x, T.el[i], armRate, dt);
  });
  m.legs.forEach((leg, i) => {
    leg.hip.rotation.x = damp(leg.hip.rotation.x, T.hip[i], 18, dt);
    leg.knee.rotation.x = damp(leg.knee.rotation.x, T.knee[i], 18, dt);
    leg.ankle.rotation.x = damp(leg.ankle.rotation.x, T.ank[i], 18, dt);
  });

  // face, cracks, flashes, extras
  const crack = yolk ? 0 : p.hp < 25 ? 3 : p.hp < 50 ? 2 : p.hp < 75 ? 1 : 0;
  if (crack !== m.crackLevel) drawShell(m, crack);
  const charging = !!(F & 256), angry = charging || (F & 128) || !!atk, worried = stun || held || hang || ko || a.getup > 0 || (F & 512) || a.boink > 0 || (!grounded && v.y < -7);
  for (const b of m.brows) b.rotation.z = damp(b.rotation.z, Math.PI / 2 + b.userData.s * (angry ? 0.5 : worried ? -0.45 : 0), 16, dt);
  const shout = (atk && p.attackT >= atk.windup) || stun || charging || cheer || (F & 512) || a.flourish > 0 || a.boink > 0.3 || (!grounded && v.y < -8 && !ko);
  a.mouth = damp(a.mouth || 0, shout ? 1 : 0, 18, dt);
  m.mouth.visible = !yolk && a.mouth > 0.05; m.mouth.scale.set(0.6 + a.mouth * 0.4, a.mouth * (charging ? 0.55 : 0.85), 0.3);
  const flash = p.stun > 0.22 && !ko ? 0.6 : charging ? 0.1 + 0.1 * Math.sin(t * 30) : 0;
  m.shellMat.emissiveIntensity = m.yolkMat.emissiveIntensity = flash;
  a.blink -= dt; if (a.blink < -0.12) a.blink = 2 + Math.random() * 3;
  const lid = ko || a.boink > 0.7 ? 0.15 : a.boink > 0 ? 1.35 : a.blink < 0 ? 0.1 : stun || charging ? 0.45 : 1;   // squint when hit or straining, eyes pop after a bonk
  for (const e of m.eyes) e.scale.y = e.userData.sy * lid;
  m.stars.visible = ko || a.boink > 0.15;
  if (m.stars.visible) m.stars.rotation.y += dt * (ko ? 5 : 9);
  m.bump.visible = a.boink > 0 && !yolk;
  if (m.bump.visible) m.bump.scale.setScalar(Math.min(1, (1 - a.boink) * 8) * Math.min(1, a.boink * 4));
  if (m.propeller) m.propeller.rotation.y += dt * (6 + sp * 3);
  if (m.cape) m.cape.rotation.x = damp(m.cape.rotation.x, run * 0.35 + (grounded ? 0 : 0.2), 8, dt);   // hangs out behind the egg, flutters when running
}

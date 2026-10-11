import * as THREE from 'three';

export const COLORS = ['#fff4e0', '#e8c49a', '#ff5a5a', '#ffa94d', '#ffd93d', '#6bcb77', '#4dd4ff', '#4d79ff', '#a66bff', '#ff7ad9', '#f5f5f5', '#555555', '#8b5a2b', '#00b3a4',
  '#c1121f', '#1d3557', '#b5e48c', '#ffcad4', '#d4a017', '#222222'];
export const PATTERNS = ['Plain', 'Speckled', 'Spots', 'Stripes', 'Zigzag', 'Hearts', 'Stars', 'Checker', 'Two-tone', 'Camo'];
export const HATS = ['None', 'Top Hat', 'Party Hat', 'Crown', 'Horns', 'Beanie', 'Chef', 'Cap', 'Viking', 'Bunny Ears', 'Halo', 'Propeller',
  'Pirate', 'Wizard', 'Cowboy', 'Santa', 'Headphones', 'Flower', 'Antennae', 'Mohawk', 'Graduate'];
export const FACES = ['Dots', 'Big Eyes', 'Happy', 'Sleepy', 'Angry', 'Surprised', 'Mustache', 'Shades', 'Wink', 'Cyclops', 'Robot', 'Tongue', 'Dizzy', 'Cute'];
export const OUTFITS = ['None', 'Tie', 'Bowtie', 'Scarf', 'Belt', 'Cape', 'Backpack', 'Hero Mask', 'Necklace', 'Medal', 'Wings', 'Tutu', 'Jetpack', 'Sash'];
// Attack kinds shared by gameplay and animation: wind-up time before the hit lands (seconds).
export const ATTACKS = [null, { windup: 0.22 }, { windup: 0.22 }, { windup: 0.36 }, { windup: 0.42 }, { windup: 0.3 }, { windup: 0.12 }, { windup: 0.06 }, { windup: 0.14 }];   // 8 = toss an item (bomb, banana)
export const STRIKE = 0.12;
const YOLK = '#ffb21c';

// 3-step cartoon shading + black inverted-hull outline
const grad = new THREE.DataTexture(new Uint8Array([80, 170, 255]), 3, 1, THREE.RedFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
export const toon = (color, extra) => new THREE.MeshToonMaterial({ color, gradientMap: grad, ...extra });
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x15151a, side: THREE.BackSide });
function mesh(geo, material, outline = 0) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  if (outline) { const o = new THREE.Mesh(geo, OUTLINE); o.scale.setScalar(1 + outline); m.add(o); }
  return m;
}
const at = (obj, x, y, z) => { obj.position.set(x, y, z); return obj; };
const SHINE = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75 });

// Egg profile: y from -0.85 to 0.95, wider at the bottom. eggRadius(y) = shell radius at height y.
const EGG_H = 0.9, EGG_C = 0.05, EGG_R = 0.56;
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

/*
 Rig (body space: physics centre at y=0, feet at y=-0.9)
 root ─ size (scaled around the feet; shrinks for yolk) ─ pivot (squash/stretch)
          ├─ body (+0.9): shell / yolk, face, hats, outfit, shoulders ─ elbow ─ hand
          └─ hips ─ knee ─ ankle ─ toes
*/
export function buildModel(c) {
  const skin = toon(c.color), black = toon('#15151a'), white = toon('#ffffff'), orange = toon('#ff9f1c');
  const root = new THREE.Group();
  const size = at(new THREE.Group(), 0, -0.9, 0); root.add(size);
  const pivot = new THREE.Group(); size.add(pivot);
  const body = at(new THREE.Group(), 0, 0.9, 0); pivot.add(body);
  const eggOnly = new THREE.Group(), yolkOnly = new THREE.Group(); body.add(eggOnly, yolkOnly); yolkOnly.visible = false;
  const eyes = [];

  // shell
  const patternCv = shellPattern(c), shellCv = document.createElement('canvas');
  shellCv.width = 512; shellCv.height = 256;
  const shellTex = new THREE.CanvasTexture(shellCv); shellTex.colorSpace = THREE.SRGBColorSpace;
  const shellMat = toon('#ffffff', { map: shellTex, emissive: '#ffffff', emissiveIntensity: 0 });
  eggOnly.add(mesh(eggGeo, shellMat, 0.035));
  for (const [y, az, sx, sy] of [[0.55, -0.6, 0.09, 0.15], [0.38, -0.75, 0.035, 0.05]]) {
    const d = onShell(new THREE.Mesh(new THREE.CircleGeometry(1, 16), SHINE), y, az, 0.006); d.scale.set(sx, sy, 1); eggOnly.add(d);
  }

  // face parts sit on the curved shell
  const part = (parent, geo, m, y, az, lift, sx = 1, sy = 1, sz = 0.45, roll = 0) => {
    const o = onShell(mesh(geo, m), y, az, lift, roll); o.scale.set(sx, sy, sz); o.castShadow = false; parent.add(o); return o;
  };
  const eye = (parent, r, m, y, az, sx = 1, sy = 1) => { const e = part(parent, new THREE.SphereGeometry(r, 14, 10), m, y, az, r * 0.15, sx, sy); e.userData.sy = sy; eyes.push(e); return e; };
  const glint = (parent, y, az) => eye(parent, 0.022, white, y + 0.035, az - 0.06);
  const F = c.face, ey = 0.32;
  const cross = (y, az) => { for (const r of [0.8, -0.8]) part(eggOnly, new THREE.BoxGeometry(0.15, 0.035, 0.04), black, y, az, 0.01, 1, 1, 1, r); };
  if (F === 'Cyclops') { eye(eggOnly, 0.16, white, ey + 0.02, 0); eye(eggOnly, 0.08, black, ey + 0.02, 0).position.multiplyScalar(1.13); glint(eggOnly, ey + 0.05, 0.03); }
  for (const s of [-1, 1]) {
    const az = s * 0.3;
    if (F === 'Cyclops') { /* one big eye, drawn above */ }
    else if (F === 'Wink' && s < 0) { const e = part(eggOnly, new THREE.TorusGeometry(0.06, 0.02, 6, 12, Math.PI), black, ey, az, 0.01, 1, 1, 1); eyes.push(e); e.userData.sy = 1; }
    else if (F === 'Robot') { const e = part(eggOnly, new THREE.BoxGeometry(0.13, 0.1, 0.05), toon('#4dd4ff', { emissive: '#1a8fb0' }), ey, az, 0.015, 1, 1, 1); eyes.push(e); e.userData.sy = 1; }
    else if (F === 'Dizzy') cross(ey, az);
    else if (F === 'Cute') { eye(eggOnly, 0.1, black, ey - 0.01, s * 0.3, 1, 1.15); glint(eggOnly, ey + 0.01, s * 0.3); glint(eggOnly, ey - 0.06, s * 0.3 + 0.05); }
    else if (F === 'Big Eyes') { eye(eggOnly, 0.13, white, ey, s * 0.32); eye(eggOnly, 0.065, black, ey, s * 0.32).position.multiplyScalar(1.03); glint(eggOnly, ey, s * 0.32); }
    else if (F === 'Sleepy') { eye(eggOnly, 0.08, black, ey - 0.02, az, 1.2, 0.3); part(eggOnly, new THREE.BoxGeometry(0.17, 0.03, 0.04), black, ey + 0.05, az, 0.01, 1, 1, 1, s * -0.15); }
    else if (F === 'Happy') { const e = part(eggOnly, new THREE.TorusGeometry(0.06, 0.02, 6, 12, Math.PI), black, ey, az, 0.01, 1, 1, 1); eyes.push(e); e.userData.sy = 1; }
    else if (F === 'Shades') part(eggOnly, new THREE.BoxGeometry(0.2, 0.13, 0.05), black, ey + 0.01, az, 0.015, 1, 1, 1);
    else { eye(eggOnly, F === 'Surprised' ? 0.085 : 0.07, black, ey, az); glint(eggOnly, ey, az); }
    if (F === 'Angry') part(eggOnly, new THREE.BoxGeometry(0.2, 0.045, 0.05), black, ey + 0.12, az, 0.01, 1, 1, 1, s * -0.4);
    if (F === 'Surprised') part(eggOnly, new THREE.BoxGeometry(0.12, 0.03, 0.04), black, ey + 0.15, az, 0.01, 1, 1, 1, s * 0.2);
    if (F === 'Mustache') part(eggOnly, new THREE.SphereGeometry(0.09, 12, 8), toon('#4a2c17'), 0.18, s * 0.14, 0.02, 1.2, 0.5, 0.5, s * -0.35);
    part(eggOnly, new THREE.SphereGeometry(F === 'Cute' ? 0.085 : 0.06, 10, 8), toon('#ff8fa3'), 0.19, s * 0.62, 0, 1, 0.6, 0.3);   // cheeks
    if (F === 'Robot') part(eggOnly, new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8), toon('#9aa3ad'), ey + 0.12, s * 0.3, 0.06, 1, 1, 1);   // little bolts
  }
  if (F === 'Shades') { part(eggOnly, new THREE.BoxGeometry(0.12, 0.03, 0.03), black, ey + 0.03, 0, 0.012, 1, 1, 1); part(eggOnly, new THREE.BoxGeometry(0.07, 0.025, 0.02), white, ey + 0.05, -0.36, 0.04, 1, 1, 1); }
  if (F === 'Surprised' || F === 'Dizzy') part(eggOnly, new THREE.TorusGeometry(0.045, 0.02, 6, 14), black, 0.12, 0, 0.01, 1, 1, 1);
  else if (F === 'Robot') for (let i = -2; i <= 2; i++) part(eggOnly, new THREE.BoxGeometry(0.025, 0.07, 0.03), black, 0.12, i * 0.06, 0.01, 1, 1, 1);
  else part(eggOnly, new THREE.TorusGeometry(0.07, 0.02, 6, 14, Math.PI), black, F === 'Mustache' ? 0.09 : 0.13, 0, 0.01, 1, 1, 1, F === 'Angry' ? 0 : Math.PI);

  if (F === 'Tongue') part(eggOnly, new THREE.SphereGeometry(0.05, 10, 8), toon('#ff6b81'), 0.085, 0.02, 0.01, 1, 1.2, 0.5);

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
    sh.add(at(mesh(new THREE.CapsuleGeometry(0.085, 0.14, 4, 10), skin), 0, -0.12, 0));
    const el = at(new THREE.Group(), 0, -0.25, 0); sh.add(el);
    el.add(at(mesh(new THREE.CapsuleGeometry(0.08, 0.1, 4, 10), skin), 0, -0.09, 0));
    const hand = at(new THREE.Group(), 0, -0.23, 0); el.add(hand);
    hand.add(mesh(new THREE.SphereGeometry(0.12, 14, 10), skin, 0.06));
    hand.add(at(mesh(new THREE.SphereGeometry(0.05, 8, 6), skin), -s * 0.08, 0.04, 0.06));
    return { sh, el, hand };
  });
  // legs: hip → knee → ankle with three chick toes (attached to pivot so feet stay planted while the body bobs)
  const legs = [-1, 1].map(s => {
    const hip = at(new THREE.Group(), s * 0.19, 0.32, 0); pivot.add(hip);
    hip.add(at(mesh(new THREE.CapsuleGeometry(0.055, 0.08, 4, 8), orange), 0, -0.08, 0));
    const knee = at(new THREE.Group(), 0, -0.16, 0); hip.add(knee);
    knee.add(at(mesh(new THREE.CapsuleGeometry(0.05, 0.07, 4, 8), orange), 0, -0.07, 0));
    const ankle = at(new THREE.Group(), 0, -0.14, 0); knee.add(ankle);
    ankle.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), orange));
    for (const a of [-0.55, 0, 0.55]) {
      const toe = at(mesh(new THREE.CapsuleGeometry(0.04, 0.12, 4, 8), orange, 0.12), Math.sin(a) * 0.08, -0.02, Math.cos(a) * 0.08 + 0.02);
      toe.rotation.set(Math.PI / 2, a, 0, 'YXZ'); ankle.add(toe);
    }
    return { hip, knee, ankle };
  });

  // hats & outfits (egg only)
  const add = (geo, m, x, y, z, rz = 0, outline = 0.05) => { const o = at(mesh(geo, m, outline), x, y, z); o.rotation.z = rz; eggOnly.add(o); return o; };
  const gold = toon('#ffcc33', { emissive: '#553300' }), dark = toon('#222');
  let propeller = null, cape = null;
  switch (c.hat) {
    case 'Top Hat': add(new THREE.CylinderGeometry(0.24, 0.24, 0.45, 20), dark, 0, 1.08, 0); add(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 20), dark, 0, 0.86, 0); add(new THREE.CylinderGeometry(0.245, 0.245, 0.08, 20), toon('#c1121f'), 0, 0.93, 0, 0, 0); break;
    case 'Party Hat': add(new THREE.ConeGeometry(0.22, 0.55, 20), toon('#ff4fa3'), 0, 1.12, 0); add(new THREE.SphereGeometry(0.07), toon('#ffd93d'), 0, 1.41, 0); break;
    case 'Crown':
      add(new THREE.CylinderGeometry(0.25, 0.25, 0.2, 20, 1, true), gold, 0, 0.88, 0, 0, 0);
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; add(new THREE.ConeGeometry(0.06, 0.16, 8), gold, Math.cos(a) * 0.24, 1.05, Math.sin(a) * 0.24, 0, 0); add(new THREE.SphereGeometry(0.03), toon('#e63946'), Math.cos(a) * 0.255, 0.9, Math.sin(a) * 0.255, 0, 0); }
      break;
    case 'Horns': for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.08, 0.35, 12), toon('#fff6dd'), s * 0.2, 0.92, 0, -s * 0.5); break;
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
    case 'Halo': { const h = add(new THREE.TorusGeometry(0.26, 0.035, 8, 28), toon('#ffe14d', { emissive: '#aa8800' }), 0, 1.25, 0, 0, 0); h.rotation.x = Math.PI / 2; break; }
    case 'Propeller': {
      for (let i = 0; i < 4; i++) add(new THREE.SphereGeometry(0.38, 10, 10, i * Math.PI / 2, Math.PI / 2, 0, Math.PI / 2), toon(['#ff5a5a', '#ffd93d', '#4d79ff', '#6bcb77'][i]), 0, 0.64, 0, 0, 0);
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8), dark, 0, 1.07, 0, 0, 0);
      propeller = at(new THREE.Group(), 0, 1.14, 0); eggOnly.add(propeller);
      for (const s of [-1, 1]) propeller.add(at(mesh(new THREE.BoxGeometry(0.3, 0.02, 0.08), toon('#ff5a5a'), 0.1), s * 0.16, 0, 0));
      break;
    }
    case 'Pirate': {
      add(new THREE.SphereGeometry(0.34, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), dark, 0, 0.7, 0, 0, 0.03);
      const brim = add(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 3), dark, 0, 0.78, 0); brim.rotation.y = Math.PI / 2;
      add(new THREE.SphereGeometry(0.06, 10, 8), white, 0, 0.9, 0.3);
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.1, 0.02, 0.02), white, 0, 0.84, 0.31, s * 0.7, 0);
      break;
    }
    case 'Wizard':
      add(new THREE.CylinderGeometry(0.46, 0.46, 0.04, 24), toon('#5a3ea8'), 0, 0.84, 0);
      add(new THREE.ConeGeometry(0.28, 0.85, 20), toon('#5a3ea8'), 0, 1.27, 0, 0.15);
      for (const [x, y, z] of [[0.1, 1.15, 0.18], [-0.12, 1.3, 0.12], [0.02, 1.45, 0.1]]) add(new THREE.OctahedronGeometry(0.05), toon('#ffe14d', { emissive: '#aa8800' }), x, y, z, 0, 0);
      break;
    case 'Cowboy':
      add(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 24), toon('#8b5a2b'), 0, 0.84, 0);
      add(new THREE.CylinderGeometry(0.2, 0.25, 0.3, 20), toon('#8b5a2b'), 0, 1.0, 0);
      add(new THREE.CylinderGeometry(0.255, 0.255, 0.06, 20), toon('#3b2414'), 0, 0.9, 0, 0, 0);
      break;
    case 'Santa':
      add(new THREE.ConeGeometry(0.3, 0.6, 20), toon('#d62828'), 0.04, 1.08, 0, -0.35);
      { const r = add(new THREE.TorusGeometry(0.31, 0.07, 8, 24), white, 0, 0.82, 0); r.rotation.x = Math.PI / 2; }
      add(new THREE.SphereGeometry(0.08, 10, 8), white, 0.18, 1.33, 0);
      break;
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
      for (const s of [-1, 1]) { add(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6), dark, s * 0.12, 1.05, 0, -s * 0.35, 0); add(new THREE.SphereGeometry(0.06, 10, 8), toon('#6bcb77', { emissive: '#1f5a24' }), s * 0.19, 1.24, 0); }
      break;
    case 'Mohawk':
      for (let i = -2; i <= 2; i++) { const sp = add(new THREE.ConeGeometry(0.075, 0.34, 8), toon(['#ff5a5a', '#ffa94d', '#ffd93d', '#6bcb77', '#4d79ff'][i + 2]), 0, 1.06 - i * i * 0.035, i * 0.11, 0, 0.02); sp.rotation.x = i * 0.25; }
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
    case 'Tie': add(new THREE.BoxGeometry(0.13, 0.36, 0.05), toon('#d62828'), 0, -0.22, eggRadius(-0.22) + 0.02); add(new THREE.BoxGeometry(0.15, 0.09, 0.06), toon('#d62828'), 0, 0.0, eggRadius(0) + 0.02); break;
    case 'Bowtie': {
      const red = toon('#d62828'), z = eggRadius(0.02) + 0.04;
      for (const s of [-1, 1]) { const w = add(new THREE.ConeGeometry(0.08, 0.16, 12), red, s * 0.08, 0.02, z); w.rotation.z = s * Math.PI / 2; }
      add(new THREE.SphereGeometry(0.045, 10, 8), red, 0, 0.02, z + 0.01); break;
    }
    case 'Scarf': {
      const s = add(new THREE.TorusGeometry(eggRadius(0.55) + 0.03, 0.07, 8, 24), toon('#2a9d8f'), 0, 0.55, 0); s.rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.13, 0.35, 0.06), toon('#2a9d8f'), 0.18, 0.4, eggRadius(0.4) + 0.03); break;
    }
    case 'Belt': {
      const b = add(new THREE.TorusGeometry(eggRadius(-0.3) + 0.01, 0.06, 8, 28), dark, 0, -0.3, 0); b.rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.18, 0.14, 0.06), gold, 0, -0.3, eggRadius(-0.3) + 0.05); break;
    }
    case 'Cape':
      cape = at(new THREE.Group(), 0, 0.45, -eggRadius(0.45) + 0.03); eggOnly.add(cape);
      cape.add(at(mesh(new THREE.PlaneGeometry(0.75, 1.05), toon('#c1121f', { side: THREE.DoubleSide })), 0, -0.52, 0)); break;
    case 'Backpack': {
      const z = -(eggRadius(0) + 0.1);
      add(new THREE.BoxGeometry(0.46, 0.52, 0.22), toon('#6a4c93'), 0, -0.02, z);
      add(new THREE.BoxGeometry(0.36, 0.2, 0.06), toon('#8f6bbf'), 0, -0.12, z - 0.13); break;
    }
    case 'Hero Mask': {
      const mask = add(new THREE.CylinderGeometry(eggRadius(ey) + 0.012, eggRadius(ey) + 0.012, 0.15, 28, 1, true, -1.1, 2.2), toon('#c1121f', { side: THREE.DoubleSide }), 0, ey + 0.01, 0, 0, 0);
      mask.castShadow = false; break;
    }
    case 'Necklace': {
      const n = add(new THREE.TorusGeometry(eggRadius(0.05) + 0.01, 0.025, 6, 28), gold, 0, 0.05, 0, 0, 0); n.rotation.x = Math.PI / 2 - 0.25;
      add(new THREE.OctahedronGeometry(0.06), toon('#4dd4ff', { emissive: '#1a6f8a' }), 0, -0.1, eggRadius(-0.1) + 0.04); break;
    }
    case 'Medal':
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.26, 0.03), toon(s < 0 ? '#4d79ff' : '#d62828'), s * 0.04, 0.12, eggRadius(0.12) + 0.02, s * 0.25, 0.02);
      { const d = add(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 18), gold, 0, -0.04, eggRadius(-0.04) + 0.04); d.rotation.x = Math.PI / 2; }
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
      const sash = add(new THREE.TorusGeometry(eggRadius(0) + 0.015, 0.05, 6, 30), toon('#d62828'), 0, 0, 0, 0, 0.02); sash.rotation.set(Math.PI / 2, 0.55, 0); sash.scale.set(1, 1, 0.6);
      break;
    }
  }

  const stars = at(new THREE.Group(), 0, 1.35, 0); body.add(stars);
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; stars.add(at(mesh(new THREE.OctahedronGeometry(0.1), toon('#ffe14d')), Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35)); }
  stars.visible = false;

  const m = { group: root, size, pivot, body, eggOnly, yolkOnly, arms, legs, eyes, cape, propeller, stars, skin, color: c.color, shellMat, yolkMat, shellTex, shellCv, patternCv,
    cracks: crackLines(), weapon: null, weaponKind: null,
    a: { phase: 0, sq: 0, sqv: 0, air: 0, ground: true, yolk: false, stun: false, bob: 0, blink: Math.random() * 4, seed: Math.random() * 10 } };
  drawShell(m, 0);
  return m;
}

// ---------- items ----------
export function weaponMesh(kind) {
  const g = new THREE.Group();
  if (kind === 'bat') {
    g.add(at(mesh(new THREE.CylinderGeometry(0.085, 0.035, 0.95, 12), toon('#c68642'), 0.08), 0, -0.42, 0));
    g.add(at(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10), toon('#222')), 0, 0.02, 0));   // grip tape
  }
  if (kind === 'pan') {
    g.add(at(mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), toon('#3b2a20'), 0.1), 0, -0.2, 0));
    g.add(at(mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.07, 20), toon('#3d3d45'), 0.06), 0, -0.62, 0));
    g.add(at(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20), toon('#ffffff')), 0, -0.58, 0));
    g.add(at(mesh(new THREE.SphereGeometry(0.07, 10, 8), toon(YOLK)), 0, -0.57, 0));   // a fried egg in the pan
  }
  if (kind === 'glove') {
    const gl = at(mesh(new THREE.SphereGeometry(0.26, 16, 12), toon('#e63946'), 0.06), 0, -0.08, 0); gl.scale.set(1, 1.15, 1); g.add(gl);
    g.add(at(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 16), toon('#ffffff'), 0.06), 0, 0.17, 0));
  }
  if (kind === 'blaster') {
    g.add(at(mesh(new THREE.BoxGeometry(0.18, 0.38, 0.24), toon('#4dd4ff'), 0.06), 0, -0.15, 0));
    g.add(at(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.35, 12), toon('#ffd93d'), 0.08), 0, -0.48, 0));
    g.add(at(mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 12), toon('#ff5a5a')), 0, -0.65, 0));
  }
  if (kind === 'hammer') {
    g.add(at(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.8, 10), toon('#8b5a2b'), 0.08), 0, -0.36, 0));
    const head = at(mesh(new THREE.BoxGeometry(0.42, 0.24, 0.24), toon('#9aa3ad'), 0.06), 0, -0.8, 0); g.add(head);
    g.add(at(mesh(new THREE.BoxGeometry(0.1, 0.26, 0.26), toon('#555b63')), 0.22, -0.8, 0));
  }
  if (kind === 'bombs' || kind === 'bomb') {
    g.add(at(mesh(new THREE.SphereGeometry(0.24, 16, 12), toon('#26262c'), 0.06), 0, kind === 'bomb' ? 0 : -0.2, 0));
    const cap = at(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 10), toon('#888')), 0, kind === 'bomb' ? 0.25 : 0.05, 0); g.add(cap);
    g.add(at(mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffb000' })), 0, kind === 'bomb' ? 0.36 : 0.15, 0));   // spark
  }
  if (kind === 'banana' || kind === 'peel') {
    const peel = kind === 'peel', b = mesh(new THREE.TorusGeometry(0.22, 0.07, 8, 16, peel ? Math.PI * 2 : Math.PI * 0.9), toon('#ffe135'), 0.05);
    if (peel) { b.rotation.x = Math.PI / 2; b.scale.set(1.3, 1.3, 0.4); } else { b.rotation.z = -0.3; b.position.y = -0.25; }
    g.add(b);
    if (!peel) g.add(at(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 6), toon('#5a3a22')), 0.18, -0.05, 0));
  }
  if (kind === 'pepper') {
    const body = at(mesh(new THREE.ConeGeometry(0.14, 0.55, 12), toon('#e8261c'), 0.06), 0, -0.1, 0); body.rotation.z = Math.PI + 0.25; g.add(body);
    g.add(at(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.1, 8), toon('#3c9a3a')), -0.04, 0.2, 0));
  }
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
  if (grounded && !a.ground && a.air > 0.12) a.sqv -= Math.min(4.5, 1 + a.air * 4);
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
  const ph = a.phase, T = {
    bx: run * 0.18, by: Math.sin(t * 0.6 + a.seed) * 0.18 * (1 - run), bz: Math.sin(ph) * 0.07 * run,
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

  if (!grounded && !ko && !hang) {
    const fall = v.y < -4;
    legsTo([0.2, -0.75], [0.6, 1.3], 0.3);
    if (fall) for (let i = 0; i < 2; i++) { T.sh[i] = [-2.5 + Math.sin(t * 16 + i * 2) * 0.5, (i ? 1 : -1) * 0.6]; T.el[i] = -0.3; }
    else both([-0.7, 1.1], -0.3);
    T.bx = fall ? -0.1 : 0.12;
  }
  if (hold) both([-2.3, 0.25], -0.5);
  if (held) {
    for (let i = 0; i < 2; i++) { T.sh[i] = [-2.6 + Math.sin(t * 18 + i * 2) * 0.4, (i ? 1 : -1) * 0.6]; T.el[i] = -0.4; T.hip[i] = Math.sin(t * 20 + i * 3) * 0.8; T.knee[i] = 0.8; }
  }
  if (hang) {
    both([-3.0, 0.22], -0.2); T.bx = -0.1;
    for (let i = 0; i < 2; i++) { T.hip[i] = Math.sin(t * 7 + i * 3) * 0.45; T.knee[i] = 0.5 + Math.sin(t * 7 + i * 3) * 0.3; }
  }
  if (stun) { both([0.5, 0.9], -0.2); T.bx = -0.35; T.lunge = -0.12; }

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
  } else if (p.weapon === 'blaster' && !hang && !ko) { T.sh[1] = [-1.45, 0.05]; T.el[1] = -0.1; }

  if (cheer) {
    for (let i = 0; i < 2; i++) { T.sh[i] = [-2.9, (i ? 1 : -1) * (0.4 + Math.sin(t * 12 + i * 2) * 0.35)]; T.el[i] = -0.3; }
    T.bob = Math.abs(Math.sin(t * 8)) * 0.4; T.by = Math.sin(t * 4) * 0.3;
  }
  if (ko) { both([-0.3, 1.4], -0.2); legsTo([-0.4, -0.2], [0.6, 0.4]); T.bx = 0; T.by = 0; }

  // ---- apply with smoothing ----
  const B = m.body;
  B.rotation.x = damp(B.rotation.x, T.bx, 12, dt);
  B.rotation.y = damp(B.rotation.y, T.by, atk ? armRate : 10, dt);
  B.rotation.z = damp(B.rotation.z, T.bz, 10, dt);
  a.bob = damp(a.bob, T.bob, 14, dt);
  B.position.y = 0.9 + a.bob;
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
  const flash = p.stun > 0.22 && !ko ? 0.6 : 0;
  m.shellMat.emissiveIntensity = m.yolkMat.emissiveIntensity = flash;
  a.blink -= dt; if (a.blink < -0.12) a.blink = 2 + Math.random() * 3;
  const lid = ko ? 0.15 : a.blink < 0 ? 0.1 : 1;
  for (const e of m.eyes) e.scale.y = e.userData.sy * lid;
  m.stars.visible = ko;
  if (ko) m.stars.rotation.y += dt * 5;
  if (m.propeller) m.propeller.rotation.y += dt * (6 + sp * 3);
  if (m.cape) m.cape.rotation.x = damp(m.cape.rotation.x, 0.1 + run * 0.7 + (grounded ? 0 : 0.4), 8, dt);
}

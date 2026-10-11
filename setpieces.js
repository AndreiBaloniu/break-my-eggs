// Big hand-built "set piece" maps with moving hazards.
// Layout code may only use rnd()/R()/pick() so every online player builds the identical map from the seed.
// Movers run on the host only; anything clients must see changes through synced bodies or map.h (hazard state).
export function createSetPieces(api) {
  const { THREE, CANNON, map, addBody, addBox, addCyl, mat, toon, patternTex, boxGeo, R, pick, rnd, fx, banner, KINEMATIC, model } = api;

  const vbox = (w, h, d, [x, y, z], m, rotY = 0, parent = map.group) => {
    const o = new THREE.Mesh(boxGeo(w, h, d), m); o.position.set(x, y, z); o.rotation.y = rotY;
    o.castShadow = o.receiveShadow = true; parent.add(o); return o;
  };
  const vcyl = (r1, r2, h, [x, y, z], m, parent = map.group, seg = 16) => {
    const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m); o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true; parent.add(o); return o;
  };
  const vsphere = (r, [x, y, z], m, parent = map.group) => {
    const o = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o;
  };
  const group = (x, y, z, rotY = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; return g; };
  // a static collider with a custom-built look
  const solidGroup = (g, w, h, d, cx = 0, cy = h / 2, cz = 0) => {
    addBody(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)), g, null, [g.position.x + cx, g.position.y + cy, g.position.z + cz], { yaw: g.rotation.y, visualOffset: [-cx, -cy, -cz] });
  };
  // a Kenney model standing on the ground at x,y,z; solid = box collider matching the model's bounds
  const place = (key, size, axis, [x, y, z], yaw = 0, solid = true) => {
    const g = model(key, size, axis); g.position.set(x, y, z); g.rotation.y = yaw; map.group.add(g);
    if (solid) { const sz = g.userData.size; solidGroup(g, sz.x, sz.y, sz.z); }
    return g;
  };
  const pole = (x, z, r, h, y = 0) => addBody(new CANNON.Cylinder(r, r, h, 8), new THREE.Group(), null, [x, y + h / 2, z]);
  function signTex(text, bg, fg, w = 1024, h = 192) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(12, 12, w - 24, h - 24);
    g.fillStyle = fg; g.font = `bold ${h * 0.45}px Arial Black, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function clockTex() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = 10; g.stroke();
    g.fillStyle = '#222'; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillRect(128 + Math.sin(a) * 100 - 4, 128 - Math.cos(a) * 100 - 10, 8, 20); }
    g.lineWidth = 9; g.beginPath(); g.moveTo(128, 128); g.lineTo(128, 50); g.moveTo(128, 128); g.lineTo(185, 150); g.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  // distant buildings for depth
  function skyline(baseY, n, rMin, rMax, hMin, hMax) {
    const names = ['commercial/building-skyscraper-a', 'commercial/building-skyscraper-b', 'commercial/building-skyscraper-c', 'commercial/building-skyscraper-d', 'commercial/building-skyscraper-e',
      'commercial/building-a', 'commercial/building-c', 'commercial/building-e', 'commercial/low-detail-building-a', 'commercial/low-detail-building-c',
      'industrial/building-a', 'industrial/building-c', 'industrial/building-e', 'industrial/building-g', 'industrial/building-k', 'industrial/water-tower'];
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, g = model(pick(names), R(hMin, hMax)), sz = g.userData.size;
      const r = R(rMin, rMax) + Math.max(sz.x, sz.z) / 2;   // big buildings are pushed further out so they never wrap around the arena
      g.position.set(Math.cos(a) * r, baseY, Math.sin(a) * r); g.rotation.y = rnd() * 6.28;
      g.traverse(o => { if (o.isMesh) o.castShadow = false; });
      map.group.add(g);
    }
  }
  // Pose a kinematic body exactly where a path says it is now, moving at the path's speed (used for swings/arcs).
  function drive(b, x, y, z, vx, vy, vz, yaw = null, yawRate = 0) {
    b.position.set(x, y, z); b.velocity.set(vx, vy, vz);
    if (yaw !== null) { b.quaternion.setFromEuler(0, yaw, 0); b.angularVelocity.set(0, yawRate, 0); }
  }

  // ======================= TRAIN STATION =======================
  // Kenney train car, lengthwise along x, centred on its collider
  function trainCar(key) {
    const inner = model(key, 2.8, 'scale'), sz = inner.userData.size, wrap = new THREE.Group();
    inner.rotation.y = Math.PI / 2; inner.position.y = -sz.y / 2; wrap.add(inner);
    return { look: wrap, len: sz.z, h: sz.y, w: sz.x };
  }

  const trainStation = {
    theme: { name: 'Train Station', step: 'concrete', sky: '#6aaee8', fog: '#d9e6f2', below: '#4a4d52', belowTex: 'concrete', tex: 'concrete', cols: ['#b9b9b9'] },
    hint: 'Get off the tracks when the train comes!',
    bounds: [26, 10],
    build() {
      const concrete = mat('#bdbdbd', { map: patternTex('concrete') }), yellow = toon('#ffd400'), green = toon('#2f6b4f'), steel = mat('#8a9099', { metalness: 0.6, roughness: 0.35 });
      const LEN = 56;
      for (const s of [-1, 1]) {
        addBox(LEN, 1.2, 9, [0, -0.6, s * 7], concrete);
        vbox(LEN, 0.03, 0.5, [0, 0.015, s * 2.85], yellow);
        for (let x = -LEN / 2 + 1; x < LEN / 2; x += 2) vbox(0.8, 0.032, 0.25, [x, 0.016, s * 3.25], toon('#e0e0e0'));   // tactile strip
        // canopy: pillars + roof
        for (let x = -24; x <= 24; x += 8) {
          addCyl(0.22, 5.2, [x, 2.6, s * 10.1], green);
          const arm = vbox(0.15, 0.15, 3.2, [x, 5.0, s * 10.9], green); arm.rotation.x = s * 0.1;
        }
        const roof = vbox(LEN, 0.25, 3.4, [0, 5.35, s * 10.6], toon('#3f7f61')); roof.rotation.x = s * 0.08; roof.receiveShadow = false;   // only over the back strip so the camera can see the fight
        vbox(LEN, 0.08, 0.4, [0, 4.95, s * 9.1], mat('#fffbe8', { emissive: '#fff4c0', emissiveIntensity: 1.2 }));   // light strip
        // back railing with gaps you can get thrown through
        for (let x = -LEN / 2 + 3; x < LEN / 2 - 2; x += 6) if (rnd() < 0.7) {
          addBox(5.6, 0.12, 0.12, [x, 0.95, s * 11.4], steel);
          for (const px of [-2.6, 0, 2.6]) vbox(0.1, 0.95, 0.1, [x + px, 0.47, s * 11.4], steel);
          addBox(5.6, 0.9, 0.05, [x, 0.45, s * 11.4], mat('#ffffff', { transparent: true, opacity: 0.12 }));
        }
        // benches, bins, plants, street lamps, dumpsters
        for (let i = 0; i < 4; i++) {
          const x = -20 + i * 13 + R(-1.5, 1.5);
          place('furniture/bench', 1.2, 'y', [x, 0, s * 9.4], s > 0 ? Math.PI : 0);
          place('furniture/trashcan', 1.1, 'y', [x + 2.4, 0, s * 9.8]);
          place('furniture/pottedPlant', 1.8, 'y', [x - 2.6, 0, s * 10.6]);
        }
        for (const x of [-16, 0, 16]) { place('roads/light-square', 4.6, 'y', [x + 4, 0, s * 3.9], s > 0 ? Math.PI : 0, false); pole(x + 4, s * 3.9, 0.12, 4.6); }
        place('roads/dumpster', 1.6, 'y', [s * -25, 0, s * 9.5], s > 0 ? Math.PI / 2 : -Math.PI / 2);
        place('roads/road-sign-warning', 2.6, 'y', [s * 26.5, 0, s * 3.3], 0, false);
        const vend = group(s * 22, 0, s * 10.7, s > 0 ? Math.PI : 0);
        vbox(1.3, 2.2, 0.9, [0, 1.1, 0], toon('#d62828'), 0, vend); vbox(0.9, 1.2, 0.05, [0, 1.35, 0.46], mat('#cfe8ff', { emissive: '#9fd0ff', emissiveIntensity: 0.6 }), 0, vend);
        map.group.add(vend); solidGroup(vend, 1.3, 2.2, 0.9);
        // hanging station sign + clock
        const sign = vbox(7, 1, 0.15, [0, 4.2, s * 9.1], new THREE.MeshBasicMaterial({ map: signTex('BREAK MY EGGS CENTRAL', '#1d3557', '#ffffff') }), s > 0 ? Math.PI : 0);
        sign.castShadow = false;
        for (const cx of [-3, 3]) vbox(0.05, 0.9, 0.05, [cx, 4.95, s * 9.1], steel);
        const clock = vcyl(0.6, 0.6, 0.12, [10, 4.3, s * 9.1], new THREE.MeshBasicMaterial({ map: clockTex() }), map.group, 24);
        clock.rotation.x = Math.PI / 2; clock.rotation.z = s > 0 ? Math.PI : 0;
      }
      // track bed, rails, sleepers
      addBox(110, 1, 5, [0, -1.9, 0], mat('#7a7068', { map: patternTex('concrete') }));
      for (const z of [-0.75, 0.75]) addBox(110, 0.18, 0.14, [0, -1.31, z], steel);
      const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.12, 2.4), toon('#5a3e2b'), 92), m4 = new THREE.Matrix4();
      for (let i = 0; i < 92; i++) { m4.makeTranslation(-55 + i * 1.2, -1.36, 0); sleepers.setMatrixAt(i, m4); }
      sleepers.receiveShadow = true; map.group.add(sleepers);
      // signal lights at both ends (flash while a train is coming)
      const lampMat = mat('#550000', { emissive: '#ff2020', emissiveIntensity: 0.1 });
      for (const x of [-27.5, 27.5]) for (const z of [-3.1, 3.1]) {
        const sig = group(x, 0, z); vcyl(0.08, 0.08, 3, [0, 1.5, 0], toon('#222'), sig); vbox(0.5, 0.9, 0.3, [0, 3.1, 0], toon('#222'), 0, sig);
        for (const y of [2.9, 3.3]) vsphere(0.13, [0, y, 0.16 * Math.sign(-z)], lampMat, sig);
        map.group.add(sig);
      }
      map.visuals.push((h, t) => { lampMat.emissiveIntensity = h[0] && Math.sin(t * 14) > 0 ? 3 : 0.1; });
      skyline(-22, 40, 75, 150, 15, 60);

      // the train: loco + 3 carriages, kinematic so it bulldozes anything on the track
      const SPEED = 32, START = -150, END = 190;
      let off = 0;
      const cars = ['a', 'b', 'b', 'c'].map((k, i) => {
        const c = trainCar(`train/train-electric-city-${k}`);
        if (i) off += c.len / 2;
        const b = addBody(new CANNON.Box(new CANNON.Vec3(c.len / 2, c.h / 2, Math.min(c.w, 4.4) / 2)), c.look, null, [START - off, -1.3 + c.h / 2, 0], { kinematic: true });
        b.offset = off; off += c.len / 2 + 0.3;
        b.hazard = { dmg: 45, daze: 2, sound: 'bonk', launch: (p, hb) => [SPEED * 0.55, 9, Math.sign(p.body.position.z - hb.position.z || 1) * 10] };
        return b;
      });
      let next = R(5, 8), running = false;
      map.movers.push(t => {
        if (!running && t >= next) { running = true; map.h[0] = 1; banner('[subway-train] TRAIN INCOMING!', 'Get off the tracks!', 2); fx('horn'); }
        cars.forEach(c => { if (running) c.velocity.x = SPEED; else { c.velocity.x = 0; c.position.x = START - c.offset; } });
        if (running && cars[cars.length - 1].position.x > END) { running = false; map.h[0] = 0; next = t + R(12, 18); }
      });
      map.spawns = [[-12, -7], [12, 7], [-4, -7], [4, 7], [12, -7], [-12, 7], [-20, -7], [20, 7]];
    },
  };

  // ======================= CONSTRUCTION SITE =======================
  const construction = {
    theme: { name: 'Construction Site', sky: '#4f98dc', fog: '#cbe0f2', below: '#55595f', belowTex: 'concrete', belowY: -90, tex: 'concrete', cols: ['#a9a9a9'] },
    hint: 'Dodge the crane and the wrecking ball!',
    bounds: [17, 17],
    build() {
      const concrete = mat('#a8a8a8', { map: patternTex('concrete') }), steel = mat('#c0392b', { map: patternTex('metal'), metalness: 0.3, roughness: 0.5 });
      const yellow = mat('#f4b400', { map: patternTex('metal'), metalness: 0.3 }), dark = toon('#2b2b30');
      // floor: 6x6 slabs with a few missing at the edges
      const holes = new Set();
      while (holes.size < 4) { const i = Math.floor(R(0, 6)), j = Math.floor(R(0, 6)); if (Math.max(Math.abs(i - 2.5), Math.abs(j - 2.5)) >= 1.5) holes.add(i * 6 + j); }
      const cells = [];
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
        if (holes.has(i * 6 + j)) continue;
        const x = (i - 2.5) * 6, z = (j - 2.5) * 6; cells.push([x, z, i, j]);
        addBox(5.96, 1, 5.96, [x, -0.5, z], concrete);
      }
      // steel frame around the edge
      for (let k = -18; k <= 18; k += 12) for (const [x, z] of [[k, -18], [k, 18], [-18, k], [18, k]]) {
        addBox(0.5, 7, 0.5, [x, 3.5, z], steel);
      }
      for (const s of [-1, 1]) { vbox(36.5, 0.4, 0.4, [0, 7.1, s * 18], steel); vbox(0.4, 0.4, 36.5, [s * 18, 7.1, 0], steel); }
      // shipping containers (climb them with ledge grab), some stacked
      const free = cells.filter(([x, z]) => Math.hypot(x, z) > 7);
      for (let n = 0; n < 5 && free.length; n++) {
        const [x, z] = free.splice(Math.floor(R(0, free.length)), 1)[0], yaw = pick([0, Math.PI / 2]), col = pick(['#c0392b', '#1f6fb2', '#2e8b57', '#e67e22', '#7d3c98']);
        const levels = rnd() < 0.4 ? 2 : 1;
        let y = 0;
        for (let l = 0; l < levels; l++) {
          const c = place(`industrial/shipping-container-${pick(['a', 'b', 'c'])}`, 5.8, 'z', [x, y, z], yaw + (l && rnd() < 0.5 ? Math.PI / 2 : 0));
          y += c.userData.size.y;
        }
      }
      // props: cones, barriers, cement bags, brick pallets
      for (let n = 0; n < 12; n++) {
        const [cx, cz] = pick(cells), x = cx + R(-2.2, 2.2), z = cz + R(-2.2, 2.2);
        if (Math.hypot(x, z) < 5) continue;
        const kind = pick(['cone', 'cone', 'barrier', 'bags', 'bricks']), g = group(x, 0, z, R(0, 6.28));
        if (kind === 'cone') place('roads/construction-cone', 0.9, 'y', [x, 0, z], g.rotation.y);
        if (kind === 'barrier') { place('roads/construction-barrier', 2.2, 'z', [x, 0, z], g.rotation.y); if (rnd() < 0.5) place('roads/construction-light', 1.2, 'y', [x, 0, z], g.rotation.y, false); }
        if (kind === 'bags') { for (let i = 0; i < 5; i++) vbox(0.9, 0.25, 0.55, [(i % 2) * 0.5 - 0.25, 0.13 + Math.floor(i / 2) * 0.25, 0], toon('#d8cfb8'), (i % 3) * 0.2, g); map.group.add(g); solidGroup(g, 1.4, 0.75, 0.6); }
        if (kind === 'bricks') { vbox(1.4, 0.15, 1.2, [0, 0.08, 0], toon('#a0784a'), 0, g); vbox(1.2, 0.8, 1.0, [0, 0.55, 0], mat('#b0583e', { map: patternTex('brick') }), 0, g); map.group.add(g); solidGroup(g, 1.4, 0.95, 1.2); }
      }

      // tower crane behind the site: rotating jib swings a steel beam across the floor
      const mastX = 0, mastZ = -26, RAD = 19;   // behind the site so it never blocks the camera
      vbox(1.8, 120, 1.8, [mastX, -40, mastZ], yellow);
      const jib = group(mastX, 20, mastZ); map.group.add(jib);
      vbox(36, 1.1, 1.1, [9, 0, 0], yellow, 0, jib); vbox(8, 1.4, 1.4, [-9, 0, 0], yellow, 0, jib); vbox(3, 2.4, 3, [-11.5, -0.3, 0], toon('#555'), 0, jib);
      vbox(2.2, 2, 2.2, [1.5, -1.6, 0], toon('#f4b400'), 0, jib); vbox(1.5, 0.8, 0.05, [1.5, -1.4, 1.12], mat('#1d3557', { emissive: '#0a1a33' }), 0, jib);
      vcyl(0.15, 0.6, 6, [0, 3.5, 0], yellow, jib);
      const cable = vcyl(0.05, 0.05, 1, [RAD, 0, 0], toon('#222'), jib, 6);
      const beamLook = new THREE.Group();
      vbox(8, 0.12, 0.7, [0, 0.27, 0], steel, 0, beamLook); vbox(8, 0.12, 0.7, [0, -0.27, 0], steel, 0, beamLook); vbox(8, 0.45, 0.12, [0, 0, 0], steel, 0, beamLook);
      const beam = addBody(new CANNON.Box(new CANNON.Vec3(4, 0.33, 0.35)), beamLook, null, [mastX, 1.0, mastZ + RAD], { kinematic: true });
      beam.hazard = { dmg: 18, daze: 0.8, launch: (p, hb) => { const v = hb.velocity, l = Math.hypot(v.x, v.z) || 1; return [v.x / l * 12, 7, v.z / l * 12]; } };
      const theta = t => 1.15 * Math.sin(0.33 * t), dtheta = t => 1.15 * 0.33 * Math.cos(0.33 * t);
      map.movers.push(t => {
        const th = theta(t), w = dtheta(t);
        drive(beam, mastX + RAD * Math.sin(th), 1.0, mastZ + RAD * Math.cos(th), RAD * Math.cos(th) * w, 0, -RAD * Math.sin(th) * w, th, w);
        map.h[1] = th;
      });
      map.visuals.push(h => {
        jib.rotation.y = (h[1] || 0) - Math.PI / 2;
        cable.scale.y = 18.6; cable.position.set(RAD, -9.6, 0);
      });

      // wrecking ball on a gantry, swinging along x
      const PX = -6, PY = 15, PZ = -9, L = 13.6;
      for (const z of [PZ - 7, PZ + 7]) addBox(0.8, PY + 0.5, 0.8, [PX, PY / 2, z], yellow);
      vbox(1, 1, 15, [PX, PY + 0.5, PZ], yellow);
      const ballLook = new THREE.Group(); vsphere(1.4, [0, 0, 0], mat('#3a3a3a', { metalness: 0.8, roughness: 0.3 }), ballLook); vcyl(0.3, 0.3, 0.6, [0, 1.5, 0], toon('#222'), ballLook);
      const ball = addBody(new CANNON.Sphere(1.4), ballLook, null, [PX, PY - L, PZ], { kinematic: true });
      ball.hazard = { dmg: 30, daze: 1.5, sound: 'bonk', launch: (p, hb) => [Math.sign(hb.velocity.x || 1) * 15, 9, Math.sign(p.body.position.z - hb.position.z || 1) * 4] };
      const A = 0.95, W = 0.85;
      map.movers.push(t => {
        const ph = A * Math.sin(W * t), dph = A * W * Math.cos(W * t);
        drive(ball, PX + L * Math.sin(ph), PY - L * Math.cos(ph), PZ, L * Math.cos(ph) * dph, L * Math.sin(ph) * dph, 0);
      });
      const chain = vcyl(0.08, 0.08, 1, [PX, PY, PZ], toon('#333'), map.group, 6);
      const ballMeshRef = () => map.syncs.find(s => s[1] === ball)?.[0];
      map.visuals.push(() => {
        const bm = ballMeshRef(); if (!bm) return;
        const dx = bm.position.x - PX, dy = bm.position.y - PY, len = Math.hypot(dx, dy);
        chain.position.set(PX + dx / 2, PY + dy / 2, PZ); chain.scale.y = len; chain.rotation.z = Math.atan2(-dx, dy);
      });
      skyline(-90, 45, 60, 150, 40, 115);
    },
  };

  // ======================= KITCHEN COUNTER =======================
  const kitchen = {
    theme: { name: 'Kitchen Counter', step: 'wood', sky: '#f1dfc0', fog: '#f5e9d6', below: '#b98d5e', belowTex: 'planks', belowY: -30, tex: 'marble', cols: ['#f1ede6'] },
    hint: 'Hot stove, rolling pin, popping toaster!',
    bounds: [21, 8],
    build() {
      const marble = mat('#f3efe8', { map: patternTex('marble'), roughness: 0.25 }), wood = mat('#a8743f', { map: patternTex('planks') });
      const chrome = mat('#dfe3e8', { metalness: 0.9, roughness: 0.2 }), black = toon('#1f1f22');
      // counter top with a sink cut-out
      addBox(34, 2, 18, [-7, -1, 0], marble);
      addBox(8, 2, 18, [20.03, -1, 0], marble);
      addBox(5.94, 2, 7, [13, -1, 5.5], marble);
      addBox(5.94, 2, 6, [13, -1, -6], marble);
      vbox(48, 0.3, 0.3, [0, -0.15, 9.05], wood);   // front edge trim
      for (let x = -21; x <= 21; x += 6) { vbox(5.8, 9, 0.2, [x, -6.6, 8.9], wood); vbox(1.2, 0.18, 0.18, [x, -2.6, 9.1], chrome); }   // cabinet doors below
      // sink basin + water + faucet
      addBox(5.9, 0.4, 4.9, [13, -1.8, -0.5], chrome);
      const water = vbox(5.8, 0.05, 4.8, [13, -1.5, -0.5], mat('#7cc4ff', { transparent: true, opacity: 0.55, roughness: 0.05 })); water.castShadow = false;
      const tap = group(13, 0, -4.4); vcyl(0.35, 0.45, 0.3, [0, 0.15, 0], chrome, tap); vcyl(0.15, 0.15, 2.2, [0, 1.3, 0], chrome, tap);
      const spout = vbox(0.3, 0.3, 1.8, [0, 2.4, 0.8], chrome, 0, tap); spout.castShadow = true;
      map.group.add(tap); solidGroup(tap, 0.9, 2.6, 0.9);
      // back wall with tiles + upper cabinets
      addBox(50, 14, 1, [0, 7, -9.6], mat('#dfeee8', { map: patternTex('wallTiles') }));
      vbox(48, 5, 3.5, [0, 12, -7.6], wood); for (let x = -21; x <= 21; x += 6) vbox(0.15, 1.2, 0.15, [x + 2.5, 10, -5.8], chrome);
      // stove: two burners that heat up on a cycle
      const coilMats = [];
      [[-15, -3], [-8.5, 3]].forEach(([x, z], k) => {
        const burner = addCyl(2.1, 0.12, [x, 0.06, z], mat('#2b2b2e', { roughness: 0.6 }));
        const coil = mat('#3a1a10', { emissive: '#ff3300', emissiveIntensity: 0 }); coilMats.push(coil);
        for (const r of [0.7, 1.2, 1.7]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.08, 6, 32), coil); ring.rotation.x = Math.PI / 2; ring.position.set(x, 0.14, z); map.group.add(ring); }
        burner.hazard = { dps: 16, active: () => map.h[2 + k] === 1 };
        const knob = vcyl(0.3, 0.3, 0.25, [x, 0.4, 8.6], black); knob.rotation.x = Math.PI / 2;
      });
      map.movers.push(t => { map.h[2] = Math.floor(t / 4) % 2; map.h[3] = Math.floor(t / 4 + 1) % 2; });
      map.visuals.push((h, t) => coilMats.forEach((m, k) => { m.emissiveIntensity = h[2 + k] ? 1.4 + Math.sin(t * 8) * 0.3 : 0; }));
      // giant rolling pin rolling back and forth
      const pinModel = model('food/rollingPin', 17, 'x'), PR = pinModel.userData.size.y / 2, pinLook = new THREE.Group();
      pinModel.position.y = -PR; const pinTurn = new THREE.Group(); pinTurn.rotation.z = Math.PI / 2; pinTurn.add(pinModel); pinLook.add(pinTurn);
      const pin = addBody(new CANNON.Cylinder(PR, PR, 12, 20), pinLook, null, [-20, PR, 0], { kinematic: true });
      pin.quaternion.setFromEuler(Math.PI / 2, 0, 0);
      pin.hazard = { dmg: 20, daze: 1, launch: (p, hb) => [Math.sign(hb.velocity.x || 1) * 12, 7, Math.sign(p.body.position.z || 1) * 3] };
      const X0 = -20, X1 = 9, SPD = 7, TRAVEL = (X1 - X0) / SPD, PAUSE = 1.5, PERIOD = 2 * (TRAVEL + PAUSE);
      map.movers.push(t => {
        let u = t % PERIOD, x, vx;
        if (u < TRAVEL) { x = X0 + u * SPD; vx = SPD; }
        else if (u < TRAVEL + PAUSE) { x = X1; vx = 0; }
        else if ((u -= TRAVEL + PAUSE) < TRAVEL) { x = X1 - u * SPD; vx = -SPD; }
        else { x = X0; vx = 0; }
        pin.position.set(x, PR, 0); pin.velocity.set(vx, 0, 0); pin.angularVelocity.set(0, 0, -vx / PR);
      });
      // toaster that pops anyone standing on it into the air
      const toaster = place('furniture/toaster', 4.6, 'x', [20, 0, -4.5]), th = toaster.userData.size.y;
      const toasts = [-0.6, 0.6].map(z => {
        const look = new THREE.Group(); vbox(2.6, 1.6, 0.4, [0, 0, 0], mat('#d8a15a', { roughness: 0.9 }), 0, look); vbox(2.7, 1.7, 0.36, [0, 0, 0], toon('#8b5a2b'), 0, look);
        const b = addBody(new CANNON.Box(new CANNON.Vec3(1.3, 0.8, 0.22)), look, null, [20, th - 0.75, -4.5 + z * 0.5], { kinematic: true });
        return b;
      });
      let lastPop = -1;
      map.movers.push(t => {
        const cyc = Math.floor(t / 6), u = t % 6;
        const y0 = th - 0.75, y = u < 0.15 ? y0 + u * 12 : u < 0.75 ? y0 + 1.8 - (u - 0.15) * 3 : y0, vy = u < 0.15 ? 12 : u < 0.75 ? -3 : 0;
        toasts.forEach(b => { b.position.y = y; b.velocity.y = vy; });
        if (u < 0.15 && cyc !== lastPop) { lastPop = cyc; fx('pop'); }
      });
      // kitchen props (real models). Back lane z<-6 and front lane z>6 are outside the rolling pin's path.
      place('food/cutting-board', 4.5, 'z', [-2, 0, -7.5], Math.PI / 2);
      place('food/knife-block', 2.6, 'y', [-21.5, 0, -7.6], 0.3);
      place('food/mug', 2.0, 'y', [6, 0, -7.6], -0.6);
      const bowl = place('food/bowl', 3.2, 'x', [-11, 0, -7.6]);
      for (const [k, dx, dz] of [['food/apple', -0.5, 0.1], ['food/orange', 0.5, -0.2], ['food/banana', 0, 0.4]]) place(k, 0.9, 'y', [-11 + dx, bowl.userData.size.y * 0.45, -7.6 + dz], rnd() * 6, false);
      place('food/frying-pan', 4, 'z', [-17.5, 0, -7.8], Math.PI / 2);
      place('food/carton', 3.2, 'y', [-7, 0, 7.6]);
      place('food/cheese', 2.4, 'x', [1.5, 0, 7.5], 0.4);
      place('food/loaf', 3, 'x', [-14, 0, 7.5], 0.1);
      place('food/shaker-salt', 1.6, 'y', [-4.2, 0, 6.8]);
      place('food/pepper-mill', 2.4, 'y', [-3.1, 0, 7.2]);
      place('food/egg-cup', 1.2, 'y', [7, 0, 7.4]);
      place('food/cup-coffee', 1.4, 'y', [4.2, 0, 7.6], 2);
      place('furniture/kitchenMicrowave', 5, 'x', [20, 0, 5.5]);
      place('furniture/kitchenBlender', 3.6, 'y', [17.6, 0, 7.6]);
      place('furniture/kitchenCoffeeMachine', 3.6, 'y', [-23, 0, -7.4]);
      map.spawns = [[-4, -1], [4, 3], [-4, 3], [4, -1], [0, -3], [0, 5], [-8, 1], [8, 1]];
    },
  };


  // ======================= FREIGHT TRAIN (fight on top of a moving train) =======================
  // The train stands still in the physics world; the ground, track and poles scroll past to sell the speed.
  const freight = {
    theme: { name: 'Freight Train', step: 'wood', sky: '#7cc0f0', fog: '#dceefa', below: '#6fae55', belowTex: 'grass', belowY: -0.05, tex: 'concrete', cols: ['#999'] },
    hint: 'Duck to the low cars or hang off the side when a bridge comes!',
    bounds: [24, 1.5],
    build() {
      const S = 3.6, kinds = ['locomotive-a', 'carriage-container-blue', 'carriage-lumber', 'carriage-box', 'carriage-coal', 'carriage-container-red', 'carriage-tank', 'carriage-container-green'];
      let x = 30;
      const roofs = [];
      for (const k of kinds) {
        const g = model(`train/train-${k}`, S, 'scale'), sz = g.userData.size;   // model length runs along z
        x -= sz.z / 2;
        g.rotation.y = -Math.PI / 2; g.position.set(x, 0, 0); map.group.add(g);
        solidGroup(g, sz.x, sz.y, sz.z);
        roofs.push([x, sz.y]);
        x -= sz.z / 2 + 1.0;   // coupling gap you can jump
      }
      map.killY = 1.2;   // falling off the train = out
      map.spawns = roofs.slice(1, 7).flatMap(([rx, ry]) => [[rx - 1.5, 0], [rx + 1.5, 0]]).slice(0, 8);
      map.spawnY = Math.max(...roofs.map(r => r[1])) + 1.5;

      // scrolling world: track tiles, poles, trees (visual only, every client animates them from its own clock)
      const SPEED = 30, trackLen = S, n = 60;
      const tile = model('train/track-detailed', S, 'x');
      const tiles = [];
      for (let i = 0; i < n; i++) { const t = tile.clone(); t.position.set(-110 + i * trackLen, 0.01, 0); map.group.add(t); tiles.push(t); }
      const poles = [];
      for (let i = 0; i < 10; i++) { const pl = model('roads/electricity-pole', 9, 'y'); pl.position.set(-110 + i * 22, 0, -6.5); pl.rotation.y = Math.PI / 2; map.group.add(pl); poles.push(pl); }
      const trees = [], treeMat = toon('#3f8f3a'), trunkMat = toon('#6b4a2b');
      for (let i = 0; i < 40; i++) {
        const tr = group(R(-120, 120), 0, pick([-1, 1]) * R(14, 45)), h = R(4, 9);
        vcyl(0.3, 0.4, h * 0.4, [0, h * 0.2, 0], trunkMat, tr); const c = vcyl(0, h * 0.35, h * 0.8, [0, h * 0.75, 0], treeMat, tr, 8);
        c.castShadow = false; map.group.add(tr); trees.push(tr);
      }
      const wrap = (o, span) => { if (o.position.x < -120) o.position.x += span; };
      map.visuals.push((h, t, dt) => {
        if (map.frozen) return;
        for (const o of tiles) { o.position.x -= SPEED * dt; wrap(o, n * trackLen); }
        for (const o of poles) { o.position.x -= SPEED * dt; wrap(o, 220); }
        for (const o of trees) { o.position.x -= SPEED * dt; wrap(o, 240); }
        if (map.below) map.below.material.map.offset.x += SPEED * dt / 15;
      });

      // bridges sweep along the train at roof height: low cars (lumber) pass underneath, everyone else must get down
      const bridgeLook = new THREE.Group(), concrete = mat('#9a9a9a', { map: patternTex('concrete') });
      vbox(1.6, 1.2, 18, [0, 0, 0], concrete, 0, bridgeLook);
      for (const z of [-8.5, 8.5]) vbox(1.4, 8, 1.4, [0, -4.4, z], concrete, 0, bridgeLook);
      const sign = model('roads/sign-highway-wide', 3.2, 'y'); sign.position.set(0.4, -0.6, -3); sign.rotation.y = Math.PI / 2; bridgeLook.add(sign);
      const BY = 7.2;   // bridge bottom ~6.6: clears the lumber car, hits anyone standing on taller cars
      const bridge = addBody(new CANNON.Box(new CANNON.Vec3(0.8, 0.6, 9)), bridgeLook, null, [200, BY, 0], { kinematic: true });
      bridge.hazard = { dmg: 30, daze: 1.2, sound: 'bonk', launch: () => [-14, 6, R(-3, 3)] };
      let next = R(7, 10), warned = false;
      map.movers.push(t => {
        if (!warned && t > next - 2.2) { warned = true; banner('[hazard-sign] BRIDGE AHEAD!', 'Get down to the low car or hang off the side', 2); fx('horn'); }
        const bx = 60 - (t - next) * SPEED;
        if (t < next) { bridge.position.set(200, BY, 0); bridge.velocity.setZero(); }
        else if (bx > -80) { bridge.position.set(bx, BY, 0); bridge.velocity.set(-SPEED, 0, 0); }
        else { next = t + R(9, 14); warned = false; }
      });
    },
  };

  // ======================= CITY ROOFTOPS =======================
  const rooftops = {
    theme: { name: 'City Rooftops', step: 'concrete', sky: '#5aa2e6', fog: '#d4e6f5', below: '#4b4f55', belowTex: 'concrete', belowY: -60, tex: 'concrete', cols: ['#777'] },
    hint: 'Jump the gaps — watch out for wind gusts!',
    bounds: [20, 20],
    build() {
      const tar = mat('#6a6d74', { map: patternTex('concrete') }), facadeCols = ['#c9b8a6', '#9fb3c8', '#b7a39a', '#a9b7a1', '#d2c4b0'];
      const wall = toon('#cfcfcf'), plankMat = mat('#a8743f', { map: patternTex('planks') });
      const roof = (x, z, w, d, top) => {
        addBox(w, 2, d, [x, top - 1, z], tar);
        const facade = vbox(w - 0.1, 50, d - 0.1, [x, top - 26, z], mat(pick(facadeCols), { map: patternTex('windows') })); facade.castShadow = false;
        vbox(w + 0.3, 0.35, d + 0.3, [x, top - 0.15, z], toon('#d8d8d8'));
      };
      roof(0, 0, 16, 16, 0);   // the main arena
      const tops = [];
      for (const [i, j] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
        // side roofs are as long as the centre so every gap is a short hop (2-3 units)
        const w = i ? R(8, 10) : 16, d = j ? R(8, 10) : 16, gap = R(2, 3);
        const x = i * (8 + gap + w / 2), z = j * (8 + gap + d / 2), top = R(-0.6, 0.6);
        roof(x, z, w, d, top);
        tops.push({ i, j, x, z, w, d, top, gap });
        // waist-high walls on the outside edges (with a gap) so you only fall when someone throws you
        if (i) addBox(0.3, 0.7, d * 0.6, [x + i * (w / 2 - 0.15), top + 0.35, z - j * d * 0.2], wall);
        if (j) addBox(w * 0.6, 0.7, 0.3, [x - i * w * 0.2, top + 0.35, z + j * (d / 2 - 0.15)], wall);
        // plank bridges from the centre to the side roofs
        if (!i || !j) {
          const len = gap + 1.2, mid = 8 + gap / 2, y = Math.max(top, 0) - 0.1;
          if (i) addBox(len, 0.2, 2.2, [i * mid, y, z], plankMat); else addBox(2.2, 0.2, len, [x, y, j * mid], plankMat);
        }
      }
      // rooftop furniture (real models) on the outer roofs' far corners
      for (const r of tops) {
        const far = [r.x + (r.i || pick([-1, 1])) * (r.w / 2 - 2), r.top, r.z + (r.j || pick([-1, 1])) * (r.d / 2 - 2)];
        const k = rnd();
        if (k < 0.3) place('industrial/water-tower', 5.5, 'y', far);
        else if (k < 0.55) place('industrial/solar-panel-landscape-group', 4.2, 'x', far);
        else if (k < 0.8) { const [cx, cy, cz] = far; place('commercial/detail-parasol-a', 3.2, 'y', far, 0, false); place('furniture/tableRound', 1, 'y', far); for (const a of [0, 2.1, 4.2]) place('furniture/chair', 1.3, 'y', [cx + Math.cos(a) * 1.4, cy, cz + Math.sin(a) * 1.4], -a - Math.PI / 2, false); }
        else place('industrial/detail-tank-large', 2.6, 'y', far);
        if (rnd() < 0.5) place('industrial/chimney-basic', 2.2, 'y', [r.x - (r.i || 1) * (r.w / 2 - 1.5), r.top, r.z]);
      }
      for (const [ax, az] of [[-5.5, -5.5], [5.5, 5.5]]) { addBox(1.6, 1, 1.2, [ax, 0.5, az], toon('#b8bcc4')); vcyl(0.5, 0.5, 0.05, [ax, 1.03, az], toon('#333')).castShadow = false; }
      // wind gusts push everyone sideways for a few seconds
      let gustAt = R(12, 16), dir = 1;
      map.movers.push((t, dt) => {
        if (t > gustAt && t < gustAt + 2.5) {
          if (!map.h[0]) { dir = pick([-1, 1]); map.h[0] = dir; banner(dir > 0 ? '[whirlwind] WIND GUST →' : '← WIND GUST [whirlwind]', 'Hold on!', 1.5); }
          for (const p of api.players()) if (p.alive && !p.hang) p.body.velocity.x += dir * 11 * dt;
        } else if (map.h[0] && t >= gustAt + 2.5) { map.h[0] = 0; gustAt = t + R(14, 20); }
      });
      map.spawns = Array.from({ length: 8 }, (_, i) => { const a = i / 8 * Math.PI * 2 + 0.4; return [Math.cos(a) * 4.5, Math.sin(a) * 4.5]; });
      skyline(-60, 40, 70, 160, 30, 75);
    },
  };

  // ======================= DINNER TABLE =======================
  const dinner = {
    theme: { name: 'Dinner Table', step: 'carpet', sky: '#f4e2c6', fog: '#f6eadb', below: '#a87445', belowTex: 'planks', belowY: -19, tex: 'planks', cols: ['#a0703f'] },
    hint: 'The lazy Susan spins — sometimes really fast!',
    bounds: [11, 11],
    build() {
      const wood = mat('#9a6a3a', { map: patternTex('planks') }), cloth = mat('#c0392b', { map: patternTex('checker'), side: THREE.DoubleSide });
      addCyl(15, 1, [0, -0.5, 0], wood);
      const clothTex = patternTex('checker').clone(); clothTex.repeat.setScalar(7);
      const top = vcyl(15.25, 15.25, 0.06, [0, 0.03, 0], mat('#ff7070', { map: clothTex }), map.group, 48); top.receiveShadow = true;
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(15.3, 15.6, 3, 48, 1, true), cloth); skirt.position.y = -1.45; map.group.add(skirt);
      vcyl(1.8, 2.4, 18, [0, -10, 0], wood);   // table leg
      // chairs around the table (scenery), backs poking up over the edge
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3; if (Math.sin(a) > -0.2) continue;   // only behind the table, never between it and the camera
        const c = model('furniture/chair', 24, 'y'); c.position.set(Math.cos(a) * 20, -19, Math.sin(a) * 20); c.rotation.y = -a + Math.PI / 2; c.traverse(o => { if (o.isMesh) o.castShadow = false; }); map.group.add(c); }

      // lazy Susan with a birthday cake: spins slowly, sometimes very fast
      const susanLook = new THREE.Group();
      vcyl(6, 6, 0.5, [0, 0, 0], mat('#7a4a25', { map: patternTex('planks') }), susanLook, 48);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(6, 0.15, 8, 48), toon('#5a3418')); rim.rotation.x = Math.PI / 2; rim.position.y = 0.25; susanLook.add(rim);
      for (const [k, a, size] of [['food/pizza', 0.4, 3.4], ['food/donut-sprinkles', 2.4, 1.6], ['food/cupcake', 4.4, 1.4]]) {   // food riding along (decor)
        const f = model(k, size, k.includes('pizza') ? 'x' : 'y'); f.position.set(Math.cos(a) * 4.2, 0.25, Math.sin(a) * 4.2); susanLook.add(f);
      }
      const susan = addBody(new CANNON.Cylinder(6, 6, 0.5, 32), susanLook, null, [0, 0.25, 0], { kinematic: true });
      const cakeModel = model('food/cake-birthday', 4.2, 'x'), csz = cakeModel.userData.size, cakeLook = new THREE.Group();
      cakeModel.position.y = -csz.y / 2; cakeLook.add(cakeModel);
      const cake = addBody(new CANNON.Box(new CANNON.Vec3(csz.x / 2 * 0.85, csz.y / 2, csz.z / 2 * 0.85)), cakeLook, null, [0, 0.5 + csz.y / 2, 0], { kinematic: true });
      let spinAt = R(12, 16), yaw = 0;
      map.movers.push((t, dt) => {
        const fast = t > spinAt && t < spinAt + 4;
        if (fast && !map.h[0]) { map.h[0] = 1; banner('[tornado] SPIN!', 'Hold on to something!', 1.5); fx('horn'); }
        if (!fast && map.h[0] && t >= spinAt + 4) { map.h[0] = 0; spinAt = t + R(14, 20); }
        const w = fast ? 1.7 : 0.35;
        susan.angularVelocity.set(0, w, 0);
        yaw += w * dt; drive(cake, 0, 0.5 + csz.y / 2, 0, 0, 0, 0, yaw, w);
        if (fast) for (const p of api.players()) {   // fling riders outward
          const q = p.body.position, r = Math.hypot(q.x, q.z);
          if (p.alive && r < 6.3 && r > 0.5 && Math.abs(q.y - 1.4) < 0.5) { p.body.velocity.x += q.x / r * w * w * r * dt * 1.6; p.body.velocity.z += q.z / r * w * w * r * dt * 1.6; }
        }
      });

      // plates of food, drinks and sauces around the edge (solid obstacles)
      const ring = [
        ['food/plate-dinner', 3.4, 'x', 9.5], ['food/glass-wine', 3.2, 'y', 11.5], ['food/bottle-ketchup', 2.8, 'y', 12], ['food/sundae', 3, 'y', 10.5],
        ['food/plate-dinner', 3.4, 'x', 9.5], ['food/watermelon', 2.4, 'y', 11], ['food/bottle-musterd', 2.8, 'y', 12], ['food/soda', 2.2, 'y', 11.5],
        ['food/plate-dinner', 3.4, 'x', 9.5], ['food/glass-wine', 3.2, 'y', 11.5], ['food/pie', 3.2, 'x', 10.5], ['food/cupcake', 1.6, 'y', 12.5],
      ];
      ring.forEach(([k, size, axis, r], i) => {
        const a = i / ring.length * Math.PI * 2 + R(-0.08, 0.08), x = Math.cos(a) * r, z = Math.sin(a) * r, g = place(k, size, axis, [x, 0, z], rnd() * 6);
        if (k === 'food/plate-dinner') place(pick(['food/burger', 'food/sandwich', 'food/croissant']), 1.5, 'x', [x, g.userData.size.y, z], rnd() * 6);
      });
      map.spawns = Array.from({ length: 8 }, (_, i) => { const a = i / 8 * Math.PI * 2 + 0.2; return [Math.cos(a) * 8, Math.sin(a) * 8]; });
    },
  };


  // ======================= FLOOR IS LAVA (giant living-room furniture over a lava floor) =======================
  const lavaRoom = {
    theme: { name: 'Floor Is Lava', step: 'carpet', sky: '#f2e6d6', fog: '#f4ead9', below: '#ff5000', glowBelow: true, belowY: 0.02, tex: 'planks', cols: ['#a0703f'] },
    hint: "Don't touch the floor — it's LAVA!",
    bounds: [14, 9],
    build() {
      const F = 12;   // furniture scale: an egg is about the size of a coffee mug
      map.killY = 0.7;
      // sofa: a seat you can stand on + a tall back (separate colliders instead of one box)
      const sofa = model('furniture/loungeSofa', 0.98 * F, 'x'), ss = sofa.userData.size, seatH = ss.y * 0.48;
      sofa.position.set(0, 0, -10); map.group.add(sofa);
      addBody(new CANNON.Box(new CANNON.Vec3(ss.x / 2, seatH / 2, ss.z * 0.35)), new THREE.Group(), null, [0, seatH / 2, -10 + ss.z * 0.15]);
      addBody(new CANNON.Box(new CANNON.Vec3(ss.x / 2, ss.y / 2, ss.z * 0.15)), new THREE.Group(), null, [0, ss.y / 2, -10 - ss.z * 0.35]);
      place('furniture/tableCoffee', 0.66 * F, 'x', [0, 0, -3]);
      place('furniture/tableCoffeeSquare', 0.4 * F, 'x', [0, 0, 2.6]);
      const cab = place('furniture/cabinetTelevision', 0.8 * F, 'x', [0, 0, 7.2]);
      place('furniture/televisionModern', 0.68 * F * 0.75, 'x', [0, cab.userData.size.y, 7.7]);
      for (const s of [-1, 1]) place('furniture/loungeSofaOttoman', 0.44 * F, 'x', [s * 8.2, 0, -2]);
      const tbl = place('furniture/table', 0.84 * F, 'x', [-13.5, 0, 6]);
      place('furniture/books', 2.4, 'x', [-15, tbl.userData.size.y, 5.5], 0.4, false);
      const shelf = place('furniture/bookcaseOpenLow', 0.4 * F, 'x', [13.5, 0, 6]);
      place('furniture/plantSmall1', 2.2, 'y', [13.5, shelf.userData.size.y, 6], 0, false);
      // scenery standing in the lava
      place('furniture/lampRoundFloor', 0.86 * F, 'y', [-12, 0, -11], 0, false);
      place('furniture/speaker', 0.64 * F, 'y', [11, 0, -11], 0, false);
      place('furniture/bookcaseClosedWide', 0.8 * F, 'x', [-17, 0, -14.5], 0, false);
      // the rug: a raft drifting along the front, linking the table and the bookcase
      const rugLook = new THREE.Group(), rugM = model('furniture/rugRound', 7, 'x'); rugM.position.y = -0.15; rugLook.add(rugM);
      const rug = addBody(new CANNON.Cylinder(3.4, 3.4, 0.3, 24), rugLook, null, [-12, 0.15, 12.5], { kinematic: true });
      map.movers.push(t => { const u = Math.sin(t * 0.3); drive(rug, u * 12, 0.15, 12.5, Math.cos(t * 0.3) * 0.3 * 12, 0, 0); });
      // room: back wall with a window, side wall
      const wallMat = mat('#e9dcc3', { map: patternTex('wallTiles') });
      vbox(56, 26, 1, [0, 12, -17.5], wallMat); vbox(1, 26, 40, [-25, 12, 2], wallMat);
      const win = vbox(12, 8, 0.2, [9, 13, -16.9], mat('#bfe6ff', { emissive: '#bfe6ff', emissiveIntensity: 0.6 })); win.castShadow = false;
      for (const [w, h, x, y] of [[12.6, 0.5, 9, 17.2], [12.6, 0.5, 9, 8.8], [0.5, 8.6, 2.7, 13], [0.5, 8.6, 15.3, 13], [0.3, 8, 9, 13]]) vbox(w, h, 0.4, [x, y, -16.7], toon('#ffffff'));
      const glow = new THREE.PointLight('#ff6a00', 60, 45, 1.5); glow.position.set(0, 1.5, 0); map.group.add(glow);
      map.visuals.push((h, t) => { if (map.below) map.below.material.emissiveIntensity = 0.75 + Math.sin(t * 2) * 0.15; glow.intensity = 55 + Math.sin(t * 3) * 10; });
      map.spawnY = 6;
      map.spawns = [[-2.5, -3.5], [2.5, -2.5], [-2.5, -2.5], [2.5, -3.5], [-8.2, -2], [8.2, -2], [0, 2.6], [0, -4]];
    },
  };

  // ======================= FRYING PAN =======================
  const fryingPan = {
    theme: { name: 'Frying Pan', step: 'concrete', sky: '#f3e0c0', fog: '#f5e8d4', below: '#2b2b30', belowY: -20, belowTex: 'metal', tex: 'metal', cols: ['#333'] },
    hint: 'Jump the spatula flip — and the middle gets HOT!',
    bounds: [10, 10],
    build() {
      const R0 = 14, pan = mat('#2d2d33', { metalness: 0.5, roughness: 0.35 });
      addCyl(R0, 1, [0, -0.5, 0], pan);
      for (let i = 0; i < 28; i++) {   // low rim you can still get knocked over
        const a = i / 28 * Math.PI * 2;
        addBox(3.3, 0.9, 0.5, [Math.cos(a) * (R0 + 0.2), 0.45, Math.sin(a) * (R0 + 0.2)], pan, { yaw: -a - Math.PI / 2 });
      }
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R0 + 0.2, 0.45, 10, 64), mat('#3a3a42', { metalness: 0.6, roughness: 0.3 })); rim.rotation.x = Math.PI / 2; rim.position.y = 0.9; map.group.add(rim);
      addBox(3, 1, 17, [0, 0.4, R0 + 8.4], mat('#3b2a20', { map: patternTex('planks') }));   // handle: a narrow dead-end bridge
      // breakfast in the pan (decor) + solid pancake stacks and sausages
      for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + 0.5; place('food/egg-cooked', 5, 'x', [Math.cos(a) * 9.5, 0.01, Math.sin(a) * 9.5], rnd() * 6, false); }
      for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 1.3; place('food/bacon', 7, 'z', [Math.cos(a) * 6.5, 0.01, Math.sin(a) * 6.5], a, false); }
      for (const a of [0.1, 3.3]) place('food/pancakes', 4.5, 'x', [Math.cos(a) * 10, 0, Math.sin(a) * 10], rnd() * 6);
      for (const a of [1.7, 4.6, 5.6]) place('food/sausage', 3, 'x', [Math.cos(a) * 11.5, 0, Math.sin(a) * 11.5], a);
      place('food/bread', 4, 'x', [-4, 0.01, 10], 0.6, false);
      // hot centre: damages anyone standing on it while it glows
      const heatMat = mat('#2d2d33', { emissive: '#ff3300', emissiveIntensity: 0 });
      const heat = addCyl(4, 0.05, [0, 0.025, 0], heatMat);
      heat.hazard = { dps: 14, active: () => map.h[2] === 1 };
      map.movers.push(t => { map.h[2] = t % 12 > 7 ? 1 : 0; });
      map.visuals.push((h, t) => { heatMat.emissiveIntensity = h[2] ? 0.9 + Math.sin(t * 8) * 0.2 : 0.05; });
      // flames under the pan (scenery)
      const flame = mat('#ff7a00', { emissive: '#ff5500', emissiveIntensity: 1.5, transparent: true, opacity: 0.85 });
      for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, f = vcyl(0, 0.6, 2.4, [Math.cos(a) * 9, -2.4, Math.sin(a) * 9], flame, map.group, 6); f.castShadow = false; }
      // the giant spatula sweeps round the pan and flips eggs into the air
      const L = R0 - 1, spLook = new THREE.Group(), sp = model('food/cooking-spatula', L + 4, 'x'); sp.position.set(0, -0.3, 0); spLook.add(sp);
      const spat = addBody(new CANNON.Box(new CANNON.Vec3(L / 2, 0.3, 0.8)), spLook, null, [L / 2, 0.3, 0], { kinematic: true });
      spat.hazard = { dmg: 10, daze: 0.6, sound: 'pan', launch: p => { const q = p.body.position, r = Math.hypot(q.x, q.z) || 1; return [q.x / r * 5, 13, q.z / r * 5]; } };
      const W = 0.9;
      map.movers.push(t => { const a = W * t; drive(spat, Math.cos(a) * L / 2, 0.3, Math.sin(a) * L / 2, -Math.sin(a) * W * L / 2, 0, Math.cos(a) * W * L / 2, -a, -W); });
      map.spawns = Array.from({ length: 8 }, (_, i) => { const a = i / 8 * Math.PI * 2 + 0.2; return [Math.cos(a) * 7.5, Math.sin(a) * 7.5]; });
    },
  };

  // ======================= CONTAINER PORT =======================
  const port = {
    theme: { name: 'Container Port', step: 'concrete', sky: '#78b6e6', fog: '#d7e8f4', below: '#1f6fb2', belowY: -1.5, tex: 'concrete', cols: ['#9a9a9a'] },
    hint: 'Climb the containers — watch out for the crane!',
    bounds: [18, 12],
    build() {
      const concrete = mat('#a5a5a5', { map: patternTex('concrete') }), yellow = mat('#f4b400', { map: patternTex('metal'), metalness: 0.3 });
      map.killY = -1.2;   // into the sea = out
      addBox(44, 3, 30, [0, -1.5, 0], concrete);
      vbox(44, 0.03, 0.4, [0, 0.015, 14.5], toon('#ffd400')); vbox(0.4, 0.03, 30, [-21.5, 0.015, 0], toon('#ffd400'));
      for (let x = -20; x <= 20; x += 8) { const b = group(x, 0, 14.2); vcyl(0.35, 0.4, 0.8, [0, 0.4, 0], toon('#222'), b); vcyl(0.5, 0.5, 0.15, [0, 0.85, 0], toon('#222'), b); map.group.add(b); solidGroup(b, 0.8, 0.9, 0.8); }
      // container stacks (1-2 high) in three rows with lanes between
      const colors = ['a', 'b', 'c'];
      for (const z of [-8, 0, 8]) for (const x of [-15, -7, 1, 9, 17]) {
        if (rnd() < 0.3) continue;
        const levels = rnd() < 0.45 ? 2 : 1;
        let y = 0;
        for (let l = 0; l < levels; l++) { const c = place(`industrial/shipping-container-${pick(colors)}`, 5.8, 'z', [x, y, z + R(-0.3, 0.3)], Math.PI / 2 + (l && rnd() < 0.3 ? 0.15 : 0)); y += c.userData.size.y; }
      }
      // cargo ship moored behind the quay (deck reachable with a ledge climb)
      addBox(48, 6, 9, [0, 0, -21.5], mat('#8c1c13', { map: patternTex('metal') }));
      vbox(48.2, 0.6, 9.2, [0, 1.5, -21.5], toon('#1d1d22'));
      const bridgeTower = group(18, 3, -21.5); vbox(6, 7, 7, [0, 3.5, 0], toon('#f2f2f2'), 0, bridgeTower); for (let i = 0; i < 4; i++) vbox(1, 0.8, 0.05, [-2.2 + i * 1.45, 5.6, 3.52], mat('#1d3557', { emissive: '#0a1a33' }), 0, bridgeTower);
      map.group.add(bridgeTower); solidGroup(bridgeTower, 6, 7, 7);
      for (const x of [-14, -6, 2, 10]) { place(`industrial/shipping-container-${pick(colors)}`, 5.8, 'z', [x, 3, -21.5], Math.PI / 2); if (rnd() < 0.5) place(`industrial/shipping-container-${pick(colors)}`, 5.8, 'z', [x, 5.5, -21.5], Math.PI / 2); }
      // freight cars on a siding along the front
      const tile = model('train/track-detailed', 3, 'x');
      for (let x = -21; x <= 21; x += 3) { const t = tile.clone(); t.position.set(x, 0.01, 11); map.group.add(t); }
      let cx = 16;
      for (const k of ['carriage-flatbed', 'carriage-container-blue', 'carriage-container-red']) { const g = place(`train/train-${k}`, 3, 'scale', [cx, 0, 11], -Math.PI / 2); cx -= g.userData.size.z + 0.8; }
      // gantry crane rolling along the quay; its hanging container sweeps the tops of the 2-high stacks
      const gantry = group(0, 0, 0); map.group.add(gantry);
      for (const x of [-21, 21]) for (const z of [-2.5, 2.5]) vbox(1.2, 15, 1.2, [x, 7.5, z], yellow, 0, gantry);
      for (const z of [-2.5, 2.5]) vbox(43.2, 1.2, 1.2, [0, 15.4, z], yellow, 0, gantry);
      const trolley = vbox(3, 1.4, 6, [0, 14.6, 0], toon('#555'), 0, gantry);
      const cable = vcyl(0.06, 0.06, 1, [0, 10, 0], toon('#222'), gantry, 6);
      const box = model('industrial/shipping-container-c', 5.8, 'z'), bs = box.userData.size, hang = new THREE.Group();
      box.position.y = -bs.y / 2; hang.add(box); hang.rotation.y = 0;
      const HY = 5.4 + bs.y / 2;   // bottom ~5.4: clears 2-high stacks, hits eggs standing on them
      const load = addBody(new CANNON.Box(new CANNON.Vec3(bs.x / 2, bs.y / 2, bs.z / 2)), hang, null, [0, HY, 0], { kinematic: true });
      load.hazard = { dmg: 22, daze: 1, sound: 'bonk', launch: (p, hb) => { const v = hb.velocity, l = Math.hypot(v.x, v.z) || 1; return [v.x / l * 12, 7, v.z / l * 12]; } };
      map.movers.push(t => {
        const gz = 9 * Math.sin(0.16 * t), x = 15 * Math.sin(0.45 * t);
        drive(load, x, HY, gz, 15 * 0.45 * Math.cos(0.45 * t), 0, 9 * 0.16 * Math.cos(0.16 * t));
        map.h[3] = gz; map.h[4] = x;
      });
      map.visuals.push(h => {
        gantry.position.z = h[3] || 0; trolley.position.x = h[4] || 0;
        cable.position.set(h[4] || 0, (14 + HY + bs.y / 2) / 2, 0); cable.scale.y = 14 - HY - bs.y / 2;
      });
      skyline(-1.5, 30, 85, 160, 10, 30);
      map.spawns = [[-11, 4], [-3, 4], [5, 4], [13, 4], [-11, -4], [-3, -4], [5, -4], [13, -4]];
    },
  };


  // ======================= helpers for the detailed model maps =======================
  const { world, renderer } = api;
  // Kenney model added to a parent group (usually a `solid` root that terrain() turns into collision)
  const put = (parent, key, size, axis, [x, y, z], yaw = 0) => { const g = model(key, size, axis); g.position.set(x, y, z); g.rotation.y = yaw; parent.add(g); return g; };
  const solidRoot = () => { const g = new THREE.Group(); map.group.add(g); return g; };
  // Collision for detailed scenery: render `root` straight down into a height map and turn it into one static heightfield.
  // Walkable tops come out exact (ship decks, wall walks, crypt rims); anything overhanging is solid down to the floor.
  const hmMat = new THREE.ShaderMaterial({
    vertexShader: 'varying float wy; void main() { vec4 w = modelMatrix * vec4(position, 1.0); wy = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'varying float wy; void main() { gl_FragColor = vec4(wy, 0.0, 0.0, 1.0); }',
  });
  function terrain(root, x0, x1, z0, z1, { cell = 0.25, top = 30, floor = -30 } = {}) {
    const nx = Math.round((x1 - x0) / cell) + 1, nz = Math.round((z1 - z0) / cell) + 1;
    // looking straight down with -z as screen-up: pixel (i, j) sits at world (x0 + i*cell, z1 - j*cell)
    const cam = new THREE.OrthographicCamera(x0 - cell / 2, x0 + (nx - 0.5) * cell, -z1 + (nz - 0.5) * cell, -z1 - cell / 2, 0, top - floor);
    cam.up.set(0, 0, -1); cam.position.set(0, top, 0); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    const rt = new THREE.WebGLRenderTarget(nx, nz, { type: THREE.FloatType });
    const scn = new THREE.Scene(), parent = root.parent, cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    scn.overrideMaterial = hmMat; scn.add(root);
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scn, cam);
    const px = new Float32Array(nx * nz * 4); renderer.readRenderTargetPixels(rt, 0, 0, nx, nz, px);
    renderer.setRenderTarget(null); renderer.setClearColor(cc, ca); rt.dispose(); parent.add(root);
    const data = [];
    for (let i = 0; i < nx; i++) { const c = data[i] = []; for (let j = 0; j < nz; j++) { const k = (j * nx + i) * 4; c.push(px[k + 3] > 0 ? Math.max(px[k], floor) : floor); } }
    const b = addBody(new CANNON.Heightfield(data, { elementSize: cell }), new THREE.Group(), null, [x0, 0, z1]);
    b.quaternion.setFromEuler(-Math.PI / 2, 0, 0); b.aabbNeedsUpdate = true;
    const at = (x, z) => data[Math.round((x - x0) / cell)]?.[Math.round((z1 - z) / cell)] ?? floor;
    map.heightAt = at;   // handy for spawns, targets and tests
    return at;
  }
  // a sloped plank/ramp from a to b (top surface on the a-b line)
  function ramp([ax, ay, az], [bx, by, bz], w, m, th = 0.35) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz), yaw = Math.atan2(dx, dz), pitch = -Math.asin(dy / len);
    const look = new THREE.Mesh(boxGeo(w, th, len), m); look.castShadow = look.receiveShadow = true;
    const b = addBody(new CANNON.Box(new CANNON.Vec3(w / 2, th / 2, len / 2)), look, null, [(ax + bx) / 2, (ay + by) / 2 - th / 2, (az + bz) / 2]);
    b.quaternion.setFromEuler(pitch, yaw, 0, 'YXZ'); b.aabbNeedsUpdate = true; look.rotation.set(pitch, yaw, 0, 'YXZ');
    return b;
  }
  const blast = api.explode;   // eggs near a point get blasted outward
  // Lobbed shots (cannonballs, boulders): a red ring marks the landing spot, then the shot arcs in and blasts eggs nearby.
  // map.h[slot..slot+3] = [active, x, y, z] so clients can draw the warning ring.
  function mortar(look, r, slot) {
    const b = addBody(new CANNON.Sphere(r), look, null, [0, -60, 0], { kinematic: true });
    b.hazard = { dmg: 20, daze: 1, sound: 'bonk', launch: (p, hb) => [hb.velocity.x * 0.5, 8, hb.velocity.z * 0.5] };
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.4, 40), new THREE.MeshBasicMaterial({ color: '#ff2020', transparent: true, opacity: 0.7, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; map.group.add(ring);
    map.visuals.push((h, t) => { ring.visible = !!h[slot]; if (h[slot]) { ring.position.set(h[slot + 1], h[slot + 2] + 0.1, h[slot + 3]); ring.material.opacity = 0.45 + 0.35 * Math.sin(t * 14); } });
    let s = null;
    return {
      get busy() { return !!s; },
      fire(t, from, to, flight = 1.8, apex = 9) { s = { t0: t, from, to, flight, apex }; map.h[slot] = 1; [map.h[slot + 1], map.h[slot + 2], map.h[slot + 3]] = to; fx('boom', { x: from[0], y: from[1], z: from[2] }); },
      update(t) {
        if (!s) return drive(b, 0, -60, 0, 0, 0, 0);
        const u = (t - s.t0) / s.flight, [a, c] = [s.from, s.to];
        if (u >= 1) { blast(c); s = null; map.h[slot] = 0; return drive(b, 0, -60, 0, 0, 0, 0); }
        const y = a[1] + (c[1] - a[1]) * u + 4 * s.apex * u * (1 - u), vy = (c[1] - a[1] + 4 * s.apex * (1 - 2 * u)) / s.flight;
        drive(b, a[0] + (c[0] - a[0]) * u, y + r, a[2] + (c[2] - a[2]) * u, (c[0] - a[0]) / s.flight, vy, (c[2] - a[2]) / s.flight);
      },
    };
  }
  // a kinematic body that follows a closed curve (coaster carts, toy trains): pose + velocity + turn rate so riders are carried
  function follow(b, curve, u, speed, dt) {
    const p = curve.getPointAt(u), tg = curve.getTangentAt(u), yaw = Math.atan2(tg.x, tg.z), pitch = -Math.asin(THREE.MathUtils.clamp(tg.y, -1, 1));
    const rate = b.lastYaw === undefined ? 0 : Math.atan2(Math.sin(yaw - b.lastYaw), Math.cos(yaw - b.lastYaw)) / Math.max(dt, 1e-3);
    b.lastYaw = yaw;
    b.position.set(p.x, p.y, p.z); b.velocity.set(tg.x * speed, tg.y * speed, tg.z * speed);
    b.quaternion.setFromEuler(pitch, yaw, 0, 'YXZ'); b.angularVelocity.set(0, rate, 0);
  }
  const stars = (n = 1200, r = 260) => {
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, y = Math.random() * 1.6 - 0.4, c = Math.sqrt(1 - Math.min(y * y, 1)); pos.set([Math.cos(a) * c * r, y * r, Math.sin(a) * c * r], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 1.3, sizeAttenuation: true, fog: false })); map.group.add(pts); return pts;
  };

  // ======================= PIRATE COVE =======================
  const pirateCove = {
    theme: { name: 'Pirate Cove', step: 'wood', sky: '#5cb6f2', fog: '#d4efff', below: '#1d86c6', belowY: -1.6, tex: 'planks', cols: ['#b07a46'] },
    hint: 'Cannon fire! Get out of the red rings',
    bounds: [19, 11],
    build() {
      map.killY = -1.3;
      const solid = solidRoot(), sand = mat('#efd29a', { map: patternTex('concrete') }), plank = mat('#9a6a3a', { map: patternTex('planks') });
      // the pirate ship moored behind the beach (deck at ~DECK)
      const SHIP_Y = -4.2, SZ = -9, SHIP_TOP = 6;   // hull sits low so the gangplanks aren't too steep
      put(solid, 'pirate/ship-pirate-large', 2.5, 'scale', [0, SHIP_Y, SZ], Math.PI / 2);
      // beach with piers, crates and the shore battery
      addBox(50, 4, 12, [0, -2, 9.5], sand);
      const at = terrain(solid, -27, 27, -17, 3.4, { cell: 0.25, top: SHIP_TOP });   // start below the sails so the deck is the top surface
      const deck = (x, z) => at(x, z) + 1.5;
      for (const x of [-6, 4]) {   // piers + gangplanks up to the deck rail
        addBox(3.2, 0.4, 3.6, [x, -0.2, 2.4], plank);
        for (const dz of [0.9, 3.6]) for (const dx of [-1.4, 1.4]) vcyl(0.18, 0.18, 2.4, [x + dx, -1.3, dz], toon('#5a3a22'));
        ramp([x, 0, 0.6], [x, at(x, SZ + 5) + 0.15, SZ + 5.6], 2.4, plank);
      }
      for (const [k, x, z, y] of [['pirate/barrel', -16, 7], ['pirate/crate', -14.5, 8.6], ['pirate/crate-bottles', 15, 7.5], ['pirate/chest', 4, 12], ['pirate/barrel', 17, 9.5]]) place(k, 1.5, 'y', [x, 0, z], rnd() * 6);
      for (const [x, z] of [[-21, 12], [-6, 13.5], [8, 13.8], [20, 12.5]]) { place(pick(['pirate/palm-straight', 'pirate/palm-bend', 'pirate/palm-detailed-bend']), 7, 'y', [x, 0, z], rnd() * 6, false); pole(x, z, 0.35, 6); }
      // shore cannons on the beach corners, deck cannons on the ship
      const shoreGuns = [[-20, 0, 6.5], [20, 0, 6.5]], deckGuns = [[-8, at(-8, SZ - 3), SZ - 3], [-2, at(-2, SZ - 3.4), SZ - 3.4], [4, at(4, SZ - 3), SZ - 3]];
      for (const [x, y, z] of shoreGuns) place('pirate/cannon', 2, 'x', [x, y, z], Math.PI);
      for (const [x, y, z] of deckGuns) place('pirate/cannon', 1.8, 'x', [x, y, z], 0, false);
      // scenery: rocks, rowing boats, a wreck and a lighthouse tower out at sea
      place('pirate/rocks-a', 9, 'x', [-31, -1.6, -2], 1, false); place('pirate/rocks-c', 7, 'x', [30, -1.6, -6], 2, false);
      place('pirate/boat-row-large', 4, 'z', [-24, -1.4, 2], 0.6, false); place('pirate/boat-row-small', 3, 'z', [25, -1.4, 3], -0.8, false);
      place('pirate/ship-wreck', 20, 'z', [-46, -3, -40], 0.7, false); place('pirate/ship-pirate-medium', 22, 'z', [50, -2, -48], -0.5, false);
      place('pirate/tower-complete-large', 22, 'y', [36, -1.6, -34], 0, false); place('pirate/rocks-b', 14, 'x', [36, -2, -34], 0, false);
      // a volley every few seconds: the beach battery shells the ship and the ship shoots back
      const ball = () => { const g = new THREE.Group(); vsphere(0.6, [0, 0, 0], mat('#2a2a2e', { metalness: 0.6, roughness: 0.4 }), g); return g; };
      const shots = [mortar(ball(), 0.6, 4), mortar(ball(), 0.6, 8)];
      let next = 3, k = 0;
      map.movers.push(t => {
        if (t > next) {
          const m = shots[k++ % 2];
          if (!m.busy) {
            const toShip = rnd() < 0.5, from = toShip ? pick(shoreGuns) : pick(deckGuns);
            const tx = toShip ? R(-12, 12) : R(-17, 17), tz = toShip ? R(SZ - 2.5, SZ + 3) : R(4, 13);
            m.fire(t, [from[0], from[1] + 1.4, from[2]], [tx, at(tx, tz) > -5 ? at(tx, tz) : 0, tz], 1.9, 8);
          }
          next = t + R(1.8, 3.2);
        }
        for (const m of shots) m.update(t);
      });
      map.spawns = [[-4, SZ, deck(-4, SZ)], [2, SZ, deck(2, SZ)], [-12, SZ, deck(-12, SZ)], [8, SZ, deck(8, SZ)], [-6, 8], [6, 8], [-12, 10], [12, 10]];
    },
  };

  // ======================= CASTLE SIEGE =======================
  const castle = {
    theme: { name: 'Castle Siege', step: 'concrete', sky: '#79b8ea', fog: '#dcecf7', below: '#2f78b0', belowY: -3, tex: 'grass', cols: ['#6aa84f'] },
    hint: 'Trebuchets are firing! Take the walls',
    bounds: [13, 12],
    build() {
      map.killY = -2.6;
      const S = 3.2, solid = solidRoot(), grass = mat('#6aa84f', { map: patternTex('grass') }), stone = mat('#b9ad9b', { map: patternTex('brick') });
      addBox(38, 6, 36, [0, -3, -1], grass);   // courtyard island in the moat
      // curtain walls: back + sides (the front stays open for the camera), wall-walks on top
      for (let i = -4; i <= 4; i++) put(solid, 'castle/wall', S, 'scale', [i * S, 0, -14.4]);
      for (const s of [-1, 1]) {
        for (let j = 0; j < 5; j++) put(solid, 'castle/wall', S, 'scale', [s * 16, 0, -11.2 + j * S], s * Math.PI / 2);
        put(solid, 'castle/wall-corner', S, 'scale', [s * 16, 0, -14.4], s > 0 ? 0 : Math.PI / 2);
        for (const [k, y] of [['castle/tower-square-base', 0], ['castle/tower-square-mid-windows', 1.01], ['castle/tower-square-top', 2.02]]) put(solid, k, S * 1.1, 'scale', [s * 16, y * S * 1.1, 4.8]);
        put(map.group, 'castle/flag-banner-long', S, 'scale', [s * 16 - s * 1.7, 0.6, -6], s * Math.PI / 2);
      }
      for (const x of [-6.4, 6.4]) put(map.group, 'castle/flag-banner-long', S, 'scale', [x, 0.6, -12.7]);
      // keep towers behind the back corners (scenery)
      for (const s of [-1, 1]) { put(map.group, 'castle/tower-hexagon-base', 7, 'scale', [s * 20, 0, -19]); put(map.group, 'castle/tower-hexagon-mid', 7, 'scale', [s * 20, 9.17, -19]); put(map.group, 'castle/tower-hexagon-roof', 7, 'scale', [s * 20, 12.4, -19]); }
      // courtyard: crates, barrels, a wooden scaffold you can climb
      for (const [k, x, z, sz] of [['pirate/crate', -6, 2, 2.2], ['pirate/crate', -4.2, 3.2, 2.2], ['pirate/barrel', 5, 4, 1.6], ['pirate/barrel', 6.3, 2.8, 1.6], ['pirate/crate', 7, -6, 2.2]]) put(solid, k, sz, 'y', [x, 0, z], rnd() * 6);
      put(solid, 'pirate/structure-platform', 1.6, 'scale', [-5.5, 0, -7]); put(solid, 'pirate/structure-platform', 1.6, 'scale', [0, 0, -9.5]);
      put(solid, 'castle/siege-ram', 3, 'scale', [4, 0, -8.5], 0.3);
      const at = terrain(solid, -19, 19, -19, 8, { cell: 0.25 });
      const WALL = at(0, -14.4);
      for (const s of [-1, 1]) ramp([s * 13, 0, 4.4], [s * 13, WALL, -6.5], 2.6, stone);   // stone ramps up to the side walls
      // trebuchets outside the moat lob boulders into the castle
      const trebs = [[-30, -6], [30, -6]];
      for (const [x, z] of trebs) { addBox(10, 6, 12, [x, -3.5, z], grass); place('castle/siege-trebuchet', 3.6, 'scale', [x, -0.5, z], x > 0 ? -Math.PI / 2 : Math.PI / 2, false); }
      for (const [x, z] of [[-30, 6], [30, 6], [-26, -18], [26, -18]]) place('castle/tree-large', 3.4, 'scale', [x, -0.5, z], rnd() * 6, false);
      const rock = () => { const g = new THREE.Group(); const m = vsphere(0.9, [0, 0, 0], mat('#8d8478', { map: patternTex('concrete') }), g); m.scale.set(1, 0.85, 1.1); return g; };
      const shots = [mortar(rock(), 0.9, 4), mortar(rock(), 0.9, 8)];
      let next = 3.5, k = 0;
      map.movers.push(t => {
        if (t > next) {
          const m = shots[k % 2], [fx0, fz0] = trebs[k++ % 2];
          if (!m.busy) { const tx = R(-15, 15), tz = R(-14, 6); m.fire(t, [fx0, 6, fz0], [tx, Math.max(at(tx, tz), 0), tz], 2.1, 12); }
          next = t + R(1.6, 2.8);
        }
        for (const m of shots) m.update(t);
      });
      map.spawns = [[-8, -2], [8, -2], [-3, 1], [3, 1], [-9, -10, WALL + 1.5], [9, -10, WALL + 1.5], [-3, -5], [3, -5]];
    },
  };

  // ======================= SPACE STATION =======================
  const spaceStation = {
    theme: { name: 'Space Station', step: 'concrete', sky: '#04030c', fog: '#0b0a1e', below: '#04030c', belowY: -140, tex: 'metal', cols: ['#9aa'] },
    hint: 'Low gravity! Watch the monorail and hull breaches',
    bounds: [15, 9],
    build() {
      world.gravity.y = -12;
      map.killY = -16;
      const S = 3.5, solid = solidRoot();
      // main deck from floor panels (a couple missing = holes into space)
      const holes = new Set([pick([[-3, -1], [3, -1], [-3, 1], [3, 1]]).join(), pick([[-2, 1], [2, 1]]).join()]);
      for (let i = -3; i <= 3; i++) for (let j = -2; j <= 1; j++) if (!holes.has([i, j].join())) put(solid, pick(['station/floor-panel', 'station/floor', 'station/floor-detail']), S, 'scale', [i * S, -0.3 * S, j * S]);
      // upper gallery along the back, built on structure blocks, with a window wall behind it
      for (let i = -3; i <= 3; i++) {
        put(solid, 'station/structure', S, 'scale', [i * S, -0.3 * S, -3 * S]);
        put(solid, 'station/floor-panel', S, 'scale', [i * S, 0.7 * S, -3 * S]);
        put(solid, pick(['station/wall-window', 'station/wall-window', 'station/wall-detail', 'station/wall-pillar']), S, 'scale', [i * S, S, -3.5 * S]);
      }
      // cover on the main deck + consoles upstairs
      for (const [k, x, z] of [['station/container-tall', -7, 0], ['station/container-wide', 7.5, -2], ['station/container', 1.5, -5.5], ['station/container-flat', -2.5, 3]]) put(solid, k, 3, 'scale', [x, 0, z], rnd() * 0.4);
      for (const x of [-7, 0, 7]) put(solid, pick(['station/computer-wide', 'station/table-display-planet', 'station/computer-system']), 3, 'scale', [x, 0.7 * S + 0.3 * S, -3 * S - 0.8]);
      // floating landing pads either side (long low-gravity jumps)
      for (const s of [-1, 1]) put(solid, 'space/platform_large', 4.2, 'scale', [s * 21, -0.5, -2]);
      put(solid, 'space/rocket_baseA', 3, 'scale', [21, -0.1, -4]); put(solid, 'space/rocket_fuelA', 3, 'scale', [21, 4.7, -4]); put(solid, 'space/rocket_topA', 3, 'scale', [21, 6.2, -4]);
      put(solid, 'space/satelliteDish_large', 4, 'scale', [-22, -0.1, -5]);
      const at = terrain(solid, -27, 27, -14, 7, { cell: 0.25 });
      const UP = at(0, -3 * S);
      for (const s of [-1, 1]) ramp([s * 9.5, at(s * 9.5, 1.5), 1.5], [s * 9.5, UP, -8.4], 2.4, mat('#8f96a8', { map: patternTex('metal') }));
      // monorail: a track across the front of the deck; the train arrives every so often
      for (let x = -60; x <= 60; x += 4) put(map.group, 'space/monorail_trackStraight', 4, 'scale', [x, -0.55, 5.3], Math.PI / 2);
      const SPEED = 26, START = -75, END = 90;
      let off = 0;
      const cars = ['space/monorail_trainFront', 'space/monorail_trainPassenger', 'space/monorail_trainPassenger', 'space/monorail_trainCargo'].map((k, i) => {
        const inner = model(k, 4, 'scale'), sz = inner.userData.size, look = new THREE.Group();
        inner.rotation.y = i ? Math.PI / 2 : Math.PI / 2; inner.position.y = -sz.y / 2; look.add(inner);
        if (i) off += sz.z / 2;
        const b = addBody(new CANNON.Box(new CANNON.Vec3(sz.z / 2, sz.y / 2, sz.x / 2)), look, null, [START - off, -0.3 + sz.y / 2, 5.3], { kinematic: true });
        b.offset = off; off += sz.z / 2 + 0.2;
        b.hazard = { dmg: 35, daze: 1.5, sound: 'bonk', launch: (p, hb) => [SPEED * 0.6, 7, Math.sign(p.body.position.z - hb.position.z || -1) * 8] };
        return b;
      });
      let next = R(6, 9), running = false;
      map.movers.push(t => {
        if (!running && t >= next) { running = true; banner('[subway-train] MONORAIL!', 'Clear the front track!', 1.8); fx('horn'); }
        cars.forEach(c => { if (running) c.velocity.x = SPEED; else { c.velocity.x = 0; c.position.x = START - c.offset; } });
        if (running && cars[cars.length - 1].position.x > END) { running = false; next = t + R(10, 15); }
      });
      // hull breach: everything gets sucked toward the open front for a few seconds
      let breachAt = R(14, 18);
      const alarm = mat('#550000', { emissive: '#ff1010', emissiveIntensity: 0.1 });
      for (const x of [-10.5, 0, 10.5]) vsphere(0.4, [x, UP + 3.6, -3.3 * S], alarm);
      map.visuals.push((h, t) => { alarm.emissiveIntensity = h[0] && Math.sin(t * 12) > 0 ? 3 : 0.1; });
      map.movers.push((t, dt) => {
        if (t > breachAt && t < breachAt + 3) {
          if (!map.h[0]) { map.h[0] = 1; banner('[hazard-sign] HULL BREACH!', 'Hold on to something!', 1.6); fx('horn'); }
          for (const p of api.players()) if (p.alive && !p.hang) p.body.velocity.z += 9 * dt;
        } else if (map.h[0] && t >= breachAt + 3) { map.h[0] = 0; breachAt = t + R(15, 20); }
      });
      // space backdrop: stars, a ringed planet, drifting rocks
      stars();
      const planet = vsphere(60, [-90, -30, -190], mat('#d97b4a', { roughness: 0.9 })); planet.castShadow = false;
      const ringM = new THREE.Mesh(new THREE.RingGeometry(75, 100, 64), new THREE.MeshBasicMaterial({ color: '#e8c39a', side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
      ringM.position.copy(planet.position); ringM.rotation.set(1.2, 0.3, 0); map.group.add(ringM);
      const rocks = [];
      for (let i = 0; i < 12; i++) { const r = place(pick(['space/meteor', 'space/meteor_detailed', 'space/rock_largeA']), R(2, 6), 'x', [R(-70, 70), R(-25, 15), R(-70, -30)], rnd() * 6, false); rocks.push(r); }
      map.visuals.push((h, t, dt) => { for (const r of rocks) { r.rotation.y += dt * 0.2; r.rotation.x += dt * 0.1; } });
      map.spawns = [[-4, -1], [4, -1], [-4, 2.5], [4, 2.5], [-8, -10, UP + 1.5], [8, -10, UP + 1.5], [0, -10, UP + 1.5], [0, 1]];
    },
  };

  // ======================= THEME PARK =======================
  const themePark = {
    theme: { name: 'Theme Park', step: 'concrete', sky: '#6cc0f5', fog: '#e2f3ff', below: '#4f9a42', belowTex: 'grass', belowY: -8, tex: 'tiles', cols: ['#e6d3b3'] },
    hint: 'Ride the coaster — or get run over by it!',
    bounds: [17, 11],
    build() {
      map.killY = -5;
      const solid = solidRoot(), paving = mat('#d9c7a6', { map: patternTex('tiles') });
      addBox(48, 4, 32, [0, -2, 0], paving);
      put(solid, 'coaster/park-entrance', 3.2, 'scale', [0, 0, -14.5]);
      for (const [k, x, z, yaw] of [['coaster/stall-food', -15, -11, 0.3], ['coaster/stall-drinks', 15, -11, -0.3], ['coaster/stall-information', -20, 1, Math.PI / 2], ['coaster/stall-toilets', 20, 1, -Math.PI / 2]]) put(solid, k, 3, 'scale', [x, 0, z], yaw);
      for (const [x, z] of [[-7, -12], [7, -12], [-21, -8], [21, -8]]) put(solid, 'coaster/tree-large', 3, 'scale', [x, 0, z], rnd() * 6);
      for (const [x, z, yaw] of [[-11, 1, 0.2], [11, 1, -0.2], [-4, -9, 0], [4, -9, 0]]) put(solid, 'coaster/bench', 2.6, 'scale', [x, 0, z], yaw);
      for (const [x, z] of [[-12.5, 0], [12.5, 0], [0, -8]]) put(solid, 'coaster/trash', 2.6, 'scale', [x, 0, z]);
      for (let i = 0; i < 10; i++) place(pick(['coaster/flowers', 'coaster/grass']), 2.4, 'scale', [R(-22, 22), 0, R(-15, -12)], rnd() * 6, false);
      terrain(solid, -24, 24, -16, 16, { cell: 0.25 });
      // carousel: a spinning platform with reindeer to ride (sometimes it really spins)
      const carLook = new THREE.Group();
      vcyl(5, 5, 0.5, [0, 0, 0], mat('#f3e2c0', { map: patternTex('planks') }), carLook, 40);
      const rimC = new THREE.Mesh(new THREE.TorusGeometry(5, 0.18, 8, 48), toon('#d62828')); rimC.rotation.x = Math.PI / 2; rimC.position.y = 0.25; carLook.add(rimC);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2, d = model('holiday/reindeer', 2.2, 'y'); d.position.set(Math.cos(a) * 3.6, 0.25, Math.sin(a) * 3.6); d.rotation.y = -a; carLook.add(d);
        vcyl(0.06, 0.06, 4.6, [Math.cos(a) * 3.6, 2.5, Math.sin(a) * 3.6], toon('#f4d03f'), carLook, 6);
      }
      const spin = addBody(new CANNON.Cylinder(5, 5, 0.5, 32), carLook, null, [0, 0.25, 3], { kinematic: true });
      addCyl(0.5, 5.2, [0, 2.6, 3], mat('#f4d03f', { metalness: 0.4 }));
      const canopy = vcyl(0.3, 5.6, 1.6, [0, 5.8, 3], mat('#d62828', { map: patternTex('checker') }), map.group, 24); canopy.castShadow = false;
      let fastAt = R(12, 16);
      map.movers.push((t, dt) => {
        const fast = t > fastAt && t < fastAt + 4;
        if (fast && !map.h[0]) { map.h[0] = 1; banner('[carousel] FASTER!', 'Hang on!', 1.4); }
        if (!fast && map.h[0] && t >= fastAt + 4) { map.h[0] = 0; fastAt = t + R(14, 20); }
        const w = fast ? 1.9 : 0.45;
        spin.angularVelocity.set(0, w, 0);
        if (fast) for (const p of api.players()) {
          const q = p.body.position, dx = q.x, dz = q.z - 3, r = Math.hypot(dx, dz);
          if (p.alive && r < 5.2 && r > 0.6 && q.y < 2) { p.body.velocity.x += dx / r * w * w * r * dt * 1.5; p.body.velocity.z += dz / r * w * w * r * dt * 1.5; }
        }
      });
      // roller coaster: ground-level run across the front, climbs up and over the back
      const P = [[-19, 0.6, 11], [-6, 0.6, 12.5], [6, 0.6, 12.5], [19, 0.6, 11], [23.5, 2.5, 4], [23, 6, -5], [17, 8.5, -11.5], [6, 9.5, -17], [-6, 9.5, -17], [-17, 8.5, -11.5], [-23, 6, -5], [-23.5, 2.5, 4]];
      const curve = new THREE.CatmullRomCurve3(P.map(p => new THREE.Vector3(...p)), true, 'centripetal'), L = curve.getLength();
      const railMat = mat('#e63946', { metalness: 0.4, roughness: 0.4 }), up = new THREE.Vector3(0, 1, 0);
      for (const side of [-0.6, 0.6]) {
        const pts = curve.getSpacedPoints(300).slice(0, -1).map((p, i, a) => { const tg = curve.getTangentAt(i / 300), n = tg.clone().cross(up).normalize(); return p.clone().addScaledVector(n, side).add(new THREE.Vector3(0, 0.15, 0)); });
        const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 400, 0.12, 6, true), railMat); rail.castShadow = true; map.group.add(rail);
      }
      const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.12, 0.3), toon('#5a3e2b'), Math.floor(L / 1.2)), m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler();
      for (let i = 0; i < ties.count; i++) {
        const u = i / ties.count, p = curve.getPointAt(u), tg = curve.getTangentAt(u);
        qq.setFromEuler(e.set(-Math.asin(tg.y), Math.atan2(tg.x, tg.z), 0, 'YXZ')); m4.compose(p, qq, new THREE.Vector3(1, 1, 1)); ties.setMatrixAt(i, m4);
        if (i % 6 === 0 && p.y > 1.5) { const sup = vcyl(0.22, 0.3, p.y, [p.x, p.y / 2, p.z], toon('#3a6ea5'), map.group, 8); sup.castShadow = false; }
      }
      map.group.add(ties);
      const carts = [], CL = 3.6;
      for (let i = 0; i < 4; i++) {
        const inner = model(i ? 'coaster/coaster-train' : 'coaster/coaster-train-front', 2.6, 'scale'), sz = inner.userData.size, look = new THREE.Group();
        inner.position.y = -0.55; look.add(inner);
        const b = addBody(new CANNON.Box(new CANNON.Vec3(sz.x / 2, 0.55, sz.z / 2)), look, null, [0, -40, 0], { kinematic: true });
        b.hazard = { dmg: 24, daze: 1.2, sound: 'bonk', sideOnly: 0.5, launch: (p, hb) => { const v = hb.velocity, l = Math.hypot(v.x, v.z) || 1; return [v.x / l * 12, 9, v.z / l * 12]; } };
        carts.push(b);
      }
      let s = 0;
      map.movers.push((t, dt) => {
        const yHead = curve.getPointAt(((s / L) % 1 + 1) % 1).y, speed = Math.max(7, 17 - yHead * 1.1);   // slower at the top
        s += speed * dt;
        carts.forEach((c, i) => follow(c, curve, (((s - i * CL) / L) % 1 + 1) % 1, speed, dt));
      });
      map.spawns = [[-8, 4], [8, 4], [-4, -4], [4, -4], [-14, -4], [14, -4], [-9, -2], [9, -2]];
    },
  };

  // ======================= SKY COURSE (obstacle course) =======================
  const skyCourse = {
    theme: { name: 'Sky Course', step: 'grass', sky: '#58b8f5', fog: '#e4f5ff', below: '#a8dcff', belowY: -70, belowTex: 'waves', tex: 'grass', cols: ['#7fb069'] },
    hint: 'Saws, spikes, springs and conveyors!',
    bounds: [19, 10],
    build() {
      map.killY = -10;
      const S = 3, G = 8.4, solid = solidRoot();
      const xs = [-2, -1, 0, 1, 2], zs = [-1, 0, 1], cells = [];
      const holes = new Set([pick(['-1,-1', '1,-1']), pick(['-2,1', '2,1', '-2,0', '2,0'])]);
      const talls = new Set([pick(['-2,-1', '2,-1'])]);
      for (const i of xs) for (const j of zs) {
        const key = `${i},${j}`;
        if (holes.has(key) && !(i === 0 && j === 0)) continue;
        const tall = talls.has(key), top = tall ? 3.2 : i === 0 && j === 0 ? 0 : pick([0, 0, 0.8, -0.8]);
        put(solid, tall ? 'platformer/block-grass-large-tall' : 'platformer/block-grass-large', S, 'scale', [i * G, top - (tall ? 2 : 1) * S, j * G]);
        cells.push({ i, j, x: i * G, z: j * G, top, tall });
      }
      for (const c of cells) if (!c.tall && rnd() < 0.35) put(solid, pick(['platformer/tree', 'platformer/tree-pine', 'platformer/flowers-tall', 'platformer/rocks']), 2, 'scale', [c.x + pick([-2.2, 2.2]), c.top, c.z + pick([-2.2, 2.2])], rnd() * 6);
      const at = terrain(solid, -21, 21, -13, 13, { cell: 0.25 });
      // moving platforms fill the holes, gliding between the neighbours
      for (const key of holes) {
        const [i, j] = key.split(',').map(Number), x = i * G, z = j * G, ax = j === 0 || Math.abs(i) === 2 ? 'z' : 'x';
        const look = model('platformer/block-moving-large', 3.2, 'scale'), sz = look.userData.size, lg = new THREE.Group(); look.position.y = -sz.y / 2; lg.add(look);
        const b = addBody(new CANNON.Box(new CANNON.Vec3(sz.x / 2, sz.y / 2, sz.z / 2)), lg, null, [x, -sz.y / 2, z], { kinematic: true });
        const A = 3.2, W = R(0.6, 0.9);
        map.movers.push(t => { const o = A * Math.sin(W * t), v = A * W * Math.cos(W * t); drive(b, x + (ax === 'x' ? o : 0), -sz.y / 2, z + (ax === 'z' ? o : 0), ax === 'x' ? v : 0, 0, ax === 'z' ? v : 0); });
      }
      // conveyor belt bridges between two neighbours (pushes you sideways)
      const beltCells = cells.filter(c => !c.tall && c.i < 2 && cells.some(d => d.i === c.i + 1 && d.j === c.j && !d.tall));
      for (const c of [pick(beltCells), pick(beltCells)]) {
        const y = Math.max(c.top, at(c.x + G, c.z)) - 0.35, dir = pick([-1, 1]);
        const belt = addBox(G - 6.2, 0.7, 3, [c.x + G / 2, y, c.z], mat('#3c3f58', { map: patternTex('metal') }));
        belt.belt = [0, dir * 5];
        for (let k = -1; k <= 1; k++) place('platformer/conveyor-belt', 2.2, 'x', [c.x + G / 2, y + 0.35, c.z + k * 1], dir > 0 ? 0 : Math.PI, false);
      }
      // springs next to the tall tower bounce you up onto it
      for (const tk of talls) {
        const [ti, tj] = tk.split(',').map(Number), from = cells.find(c => c.j === tj && c.i === ti + (ti < 0 ? 1 : -1) && !c.tall) || cells.find(c => c.i === 0 && c.j === 0);
        const sx = from.x + (ti < 0 ? -2 : 2), sz = from.z, look = model('platformer/spring', 2.2, 'x'), h = look.userData.size.y;
        const b = addBody(new CANNON.Box(new CANNON.Vec3(1, h / 2, 1)), look, null, [sx, from.top + h / 2, sz], { visualOffset: [0, -h / 2, 0] });
        const tx = ti * G, tz = tj * G, T = 1.2;   // ~flight time to the tower top
        b.hazard = { dmg: 0, sound: 'pop', launch: p => [(tx - p.body.position.x) / T, 17, (tz - p.body.position.z) / T] };
      }
      // spinning saws patrol across two islands
      for (const c of [pick(cells.filter(c => !c.tall && (c.i || c.j))), pick(cells.filter(c => !c.tall && (c.i || c.j)))]) {
        const inner = model('platformer/saw', 2.6, 'x'), look = new THREE.Group(), spinG = new THREE.Group(); inner.position.y = -1.3; spinG.add(inner); look.add(spinG);
        const b = addBody(new CANNON.Sphere(1.1), look, null, [c.x, c.top + 1.1, c.z], { kinematic: true });
        b.hazard = { dmg: 16, daze: 0.6, sound: 'bonk', launch: (p, hb) => { const dx = p.body.position.x - hb.position.x, dz = p.body.position.z - hb.position.z, l = Math.hypot(dx, dz) || 1; return [dx / l * 10, 8, dz / l * 10]; } };
        const W = R(0.7, 1.1), ph = rnd() * 6;
        map.movers.push(t => { const o = 2.6 * Math.sin(W * t + ph); drive(b, c.x + o, c.top + 1.1, c.z, 2.6 * W * Math.cos(W * t + ph), 0, 0); });
        map.visuals.push((h, t, dt) => { spinG.rotation.z -= dt * 12; });
      }
      // spike trap island: spikes pop up on a timer
      const spikeCell = pick(cells.filter(c => !c.tall && (c.i || c.j))), spikes = [];
      for (let a = -1; a <= 1; a++) for (let b2 = -1; b2 <= 1; b2++) spikes.push(place('platformer/trap-spikes-large', 1.9, 'x', [spikeCell.x + a * 1.9, spikeCell.top - 0.45, spikeCell.z + b2 * 1.9], 0, false));
      const trap = addBox(5.7, 0.1, 5.7, [spikeCell.x, spikeCell.top - 0.04, spikeCell.z], mat('#555a6e', { transparent: true, opacity: 0 }));
      trap.hazard = { dps: 30, active: () => map.h[2] === 1 };
      map.movers.push(t => { map.h[2] = t % 5 > 3.2 ? 1 : 0; });
      map.visuals.push(h => { for (const s of spikes) s.position.y += ((h[2] ? spikeCell.top : spikeCell.top - 0.45) - s.position.y) * 0.3; });
      // decor: coins and flags
      for (const c of cells) if (rnd() < 0.4) place('platformer/flag', 1.8, 'y', [c.x + 2.5, c.top, c.z - 2.5], 0, false);
      const coins = [];
      for (let k = 0; k < 10; k++) { const c = pick(cells); coins.push(place('platformer/coin-gold', 0.9, 'y', [c.x + R(-2, 2), c.top + 2.2, c.z + R(-2, 2)], 0, false)); }
      map.visuals.push((h, t) => coins.forEach((c, i) => { c.rotation.y = t * 2 + i; }));
      for (let k = 0; k < 14; k++) { const g = group(R(-90, 90), R(-30, -8), R(-90, -20)); for (let j = 0; j < 4; j++) vsphere(R(2, 4), [R(-4, 4), R(-1, 1), R(-2, 2)], new THREE.MeshLambertMaterial({ color: '#ffffff' }), g); map.group.add(g); }
      const startCells = cells.filter(c => !c.tall);
      map.spawns = Array.from({ length: 8 }, (_, n) => { const c = startCells[n % startCells.length]; return [c.x + (n >= startCells.length ? 1.5 : -1), c.z, c.top + 2]; });
    },
  };

  // ======================= WINTER VILLAGE =======================
  const winterVillage = {
    theme: { name: 'Winter Village', step: 'snow', sky: '#9cc8ec', fog: '#eef6ff', below: '#e8f2fb', belowTex: 'snow', belowY: -9, tex: 'snow', cols: ['#ffffff'] },
    hint: 'Icy rink in the middle — and the toy train never stops',
    bounds: [16, 10],
    build() {
      map.killY = -6;
      const solid = solidRoot(), snow = mat('#f4f8fc', { map: patternTex('snow') });
      addBox(46, 4, 30, [0, -2, 0], snow);
      // log cabins at the back corners (walls + snowy roof)
      const C = 3.6;
      const cabin = (cx, cz, n) => {
        for (let k = 0; k < n; k++) {
          const x = cx + (k - (n - 1) / 2) * C;
          put(solid, k === 1 ? 'holiday/cabin-doorway' : pick(['holiday/cabin-window-a', 'holiday/cabin-window-b', 'holiday/cabin-wall-wreath']), C, 'scale', [x, 0, cz + C / 2 - 0.15 * C]);
          put(solid, 'holiday/cabin-wall', C, 'scale', [x, 0, cz - C / 2 + 0.15 * C], Math.PI);
          put(solid, 'holiday/cabin-roof-snow-point', C, 'scale', [x, C, cz], Math.PI / 2);
        }
        for (const s of [-1, 1]) put(solid, 'holiday/cabin-wall', C, 'scale', [cx + s * (n * C / 2 - 0.15 * C), 0, cz], Math.PI / 2);
      };
      cabin(-14, -11, 3); cabin(14, -11, 3);
      put(solid, 'holiday/tree-decorated-snow', 4.4, 'scale', [0, 0, -12]);
      for (const [x, z, s] of [[-20, 2, 2.2], [20, 3, 2], [-19, 11, 1.6], [19, 11, 1.7]]) put(solid, 'holiday/rocks-large', s, 'scale', [x, 0, z], rnd() * 6);
      for (const [x, z] of [[-6, 9], [-5, 10.2], [6.2, 9.6]]) put(solid, pick(['holiday/present-a-cube', 'holiday/present-b-cube', 'holiday/present-a-rectangle', 'holiday/present-b-rectangle']), 3, 'scale', [x, 0, z], rnd() * 6);
      put(solid, 'holiday/present-a-round', 3, 'scale', [-5.5, 1.7, 9.6]);
      for (const [x, z] of [[-11, 4], [12, 5]]) put(solid, 'holiday/snowman-hat', 2.2, 'scale', [x, 0, z], rnd() * 2 - 1);
      for (const [x, z, yaw] of [[-8, -6, 0.3], [8, -6, -0.3]]) put(solid, 'holiday/bench', 2.4, 'scale', [x, 0, z], yaw);
      terrain(solid, -23, 23, -15, 15, { cell: 0.25 });
      // decor: pines, lanterns, reindeer, sleds, snow piles
      for (const [x, z] of [[-22, -6], [22, -6], [-7, -14], [7, -14], [-22, 7], [22, 8]]) place(pick(['holiday/tree-snow-a', 'holiday/tree-snow-b', 'holiday/tree-snow-c']), 2.8, 'scale', [x, 0, z], rnd() * 6, false);
      for (const [x, z] of [[-10, -3], [10, -3], [-10, 9], [10, 9]]) { place('holiday/lantern', 2.6, 'scale', [x, 0, z], 0, false); pole(x, z, 0.2, 4); const l = new THREE.PointLight('#ffcf7a', 14, 12, 1.5); l.position.set(x, 4, z); map.group.add(l); }
      place('holiday/reindeer', 2.4, 'scale', [17, 0, -3], -0.8, false); place('holiday/sled-long', 2.4, 'scale', [-17, 0, -3], 0.5, false);
      for (let k = 0; k < 8; k++) place(pick(['holiday/snow-pile', 'holiday/snow-flat']), 3, 'scale', [R(-21, 21), 0.01, R(-13, 13)], rnd() * 6, false);
      // the ice rink: slippery!
      const ice = addCyl(6.5, 0.1, [0, 0.05, 2], mat('#bfe6ff', { roughness: 0.05, metalness: 0.1 }));
      ice.ice = true;
      // toy train circling the rink: rideable on top, bulldozes from the side
      const RR = 10, TZ = 2;
      const railM = toon('#8d8d99');
      for (const r of [RR - 0.6, RR + 0.6]) { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.08, 6, 96), railM); t.rotation.x = Math.PI / 2; t.position.set(0, 0.08, TZ); map.group.add(t); }
      const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.1, 0.35), toon('#6b4a2b'), 64), m4 = new THREE.Matrix4();
      for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2; m4.makeRotationY(-a); m4.setPosition(Math.cos(a) * RR, 0.04, TZ + Math.sin(a) * RR); ties.setMatrixAt(i, m4); }
      map.group.add(ties);
      const W = 0.42, cars = ['holiday/train-locomotive', 'holiday/train-tender', 'holiday/train-wagon', 'holiday/train-wagon-logs'].map((k, i) => {
        const inner = model(k, 4.6, 'scale'), sz = inner.userData.size, look = new THREE.Group();
        inner.position.y = -sz.y / 2; look.add(inner);
        const b = addBody(new CANNON.Box(new CANNON.Vec3(sz.x / 2, sz.y / 2, sz.z / 2)), look, null, [0, -40, 0], { kinematic: true });
        b.hazard = { dmg: 16, daze: 1, sound: 'bonk', sideOnly: sz.y * 0.35, launch: (p, hb) => { const dx = p.body.position.x - hb.position.x, dz = p.body.position.z - hb.position.z, l = Math.hypot(dx, dz) || 1; return [dx / l * 10, 8, dz / l * 10]; } };
        b.h = sz.y; b.gap = i * 0.36;
        return b;
      });
      map.movers.push(t => {
        for (const c of cars) {
          const a = W * t - c.gap, x = Math.cos(a) * RR, z = TZ + Math.sin(a) * RR;
          drive(c, x, c.h / 2, z, -Math.sin(a) * RR * W, 0, Math.cos(a) * RR * W, -a - Math.PI / 2, -W);
        }
      });
      // falling snow
      const N = 600, pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) pos.set([Math.random() * 60 - 30, Math.random() * 30, Math.random() * 40 - 22], i * 3);
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      map.group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 0.18 })));
      map.visuals.push((h, t, dt) => { for (let i = 0; i < N; i++) { let y = pos[i * 3 + 1] - dt * 2.2; if (y < 0) y += 30; pos[i * 3 + 1] = y; pos[i * 3] += Math.sin(t + i) * dt * 0.3; } sg.attributes.position.needsUpdate = true; });
      map.spawns = [[-4, 2], [4, 2], [0, -2], [0, 6], [-15, -2], [15, -2], [-15, 9], [15, 9]];
    },
  };

  // ======================= HAUNTED GRAVEYARD =======================
  const graveyard = {
    theme: { name: 'Haunted Graveyard', step: 'grass', sky: '#161335', fog: '#2b2546', below: '#120f22', belowY: -12, tex: 'grass', cols: ['#4d5e3c'] },
    hint: 'Ghosts drift through the graves — and mind the open pits',
    bounds: [16, 10],
    build() {
      map.killY = -7;
      const solid = solidRoot(), dirt = mat('#4f5f3d', { map: patternTex('grass') });
      // ground with three open graves (pits you can fall into)
      const pits = [[-7, 5], [8, 6], [0, -3]].map(([x, z]) => [x + R(-1, 1), z + R(-0.5, 0.5)]);
      const PW = 2.4, PD = 3.6, X0 = -23, X1 = 23, Z0 = -15, Z1 = 15;
      // ground = strips around the pits (each pit cuts its column into two)
      const xsCuts = [...new Set([X0, X1, ...pits.flatMap(([x]) => [x - PW / 2, x + PW / 2])])].sort((a, b) => a - b);
      for (let k = 0; k < xsCuts.length - 1; k++) {
        const xa = xsCuts[k], xb = xsCuts[k + 1], mid = (xa + xb) / 2, pit = pits.find(([x]) => Math.abs(x - mid) < PW / 2);
        const spans = pit ? [[Z0, pit[1] - PD / 2], [pit[1] + PD / 2, Z1]] : [[Z0, Z1]];
        for (const [za, zb] of spans) addBox(xb - xa, 4, zb - za, [mid, -2, (za + zb) / 2], dirt);
      }
      for (const [x, z] of pits) { place('graveyard/shovel-dirt', 2.4, 'scale', [x + PW / 2 + 0.9, 0, z], 0, false); place('graveyard/coffin-old', 3, 'scale', [x - PW / 2 - 1.2, 0, z + 0.6], 0.3, false); }
      // crypts (roofless, walk inside), headstones, walls, fences
      put(solid, 'graveyard/crypt-large', 4.2, 'scale', [0, 0, -11]);
      for (const s of [-1, 1]) put(solid, 'graveyard/crypt-small', 4, 'scale', [s * 15, 0, -9], s * 0.2);
      const stones = ['graveyard/gravestone-cross', 'graveyard/gravestone-round', 'graveyard/gravestone-bevel', 'graveyard/gravestone-decorative', 'graveyard/gravestone-roof', 'graveyard/gravestone-wide', 'graveyard/gravestone-cross-large', 'graveyard/gravestone-broken'];
      for (const row of [-4.5, 1, 9.5]) for (let x = -19; x <= 19; x += R(3.2, 4.6)) {
        if (pits.some(([px, pz]) => Math.abs(px - x) < 2.6 && Math.abs(pz - row) < 3.2) || (Math.abs(x) < 3 && row === 1)) continue;
        put(solid, pick(stones), 2.6, 'scale', [x, 0, row + R(-0.4, 0.4)], R(-0.2, 0.2));
        if (rnd() < 0.4) put(map.group, 'graveyard/grave', 2.6, 'scale', [x, 0.01, row + 1.6]);
      }
      for (let x = -21; x <= 21; x += 2.6) put(solid, rnd() < 0.15 ? 'graveyard/iron-fence-damaged' : 'graveyard/iron-fence', 2.6, 'scale', [x, 0, -14.6]);
      for (const s of [-1, 1]) for (let z = -12; z <= 12; z += 2.6) put(solid, rnd() < 0.2 ? 'graveyard/stone-wall-damaged' : 'graveyard/stone-wall', 2.6, 'scale', [s * 22.4, 0, z], Math.PI / 2);
      put(solid, 'graveyard/altar-stone', 3, 'scale', [0, 0, 1.5]);
      for (const [x, z] of [[-10, -7.5], [10, -7.5]]) put(solid, 'graveyard/pillar-obelisk', 3, 'scale', [x, 0, z]);
      terrain(solid, -23, 23, -15.5, 15, { cell: 0.25 });
      // spooky decor + warm lights
      for (const [x, z] of [[-19, -12], [19, -12], [-21, 4], [21, 6], [-7, -14], [7, -14]]) { place(pick(['graveyard/pine', 'graveyard/pine-crooked', 'graveyard/pine-fall-crooked']), 3.6, 'scale', [x, 0, z], rnd() * 6, false); pole(x, z, 0.35, 5); }
      for (const [x, z] of [[-4, -7.5], [4, -7.5], [-13, 4], [13, 4]]) {
        place('graveyard/lightpost-double', 3, 'scale', [x, 0, z], 0, false); pole(x, z, 0.15, 3.6);
        const l = new THREE.PointLight('#ffb35a', 18, 14, 1.4); l.position.set(x, 3.6, z); map.group.add(l);
      }
      for (const [x, z] of [[-2.5, 3], [2.5, 3]]) { place('graveyard/fire-basket', 2.2, 'scale', [x, 0, z], 0, false); const l = new THREE.PointLight('#ff7a2a', 12, 9, 1.5); l.position.set(x, 1.2, z); map.group.add(l); }
      for (let k = 0; k < 10; k++) place(pick(['graveyard/pumpkin-carved', 'graveyard/pumpkin-tall-carved', 'graveyard/candle-multiple', 'graveyard/rocks', 'graveyard/debris']), 1.2, 'y', [R(-20, 20), 0, R(-12, 12)], rnd() * 6, false);
      const moon = vsphere(9, [40, 45, -120], mat('#fff6d8', { emissive: '#fff2c0', emissiveIntensity: 1 })); moon.castShadow = false;
      // ghosts drift through the yard on looping paths
      const ghosts = [0, 1, 2].map(i => {
        const inner = model('graveyard/character-ghost', 3.2, 'scale'), look = new THREE.Group();
        inner.position.y = -1.1; inner.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.75; o.castShadow = false; } }); look.add(inner);
        const b = addBody(new CANNON.Sphere(1.1), look, null, [0, -40, 0], { kinematic: true });
        b.hazard = { dmg: 14, daze: 0.8, sound: 'bonk', launch: (p, hb) => { const dx = p.body.position.x - hb.position.x, dz = p.body.position.z - hb.position.z, l = Math.hypot(dx, dz) || 1; return [dx / l * 11, 8, dz / l * 11]; } };
        return { b, ax: R(12, 17), az: R(6, 9), wx: R(0.18, 0.28) * pick([-1, 1]), wz: R(0.3, 0.45), ph: i * 2.1 };
      });
      map.movers.push(t => {
        for (const g of ghosts) {
          const a = g.wx * t + g.ph, c = g.wz * t + g.ph, x = g.ax * Math.sin(a), z = 1 + g.az * Math.sin(c), vx = g.ax * g.wx * Math.cos(a), vz = g.az * g.wz * Math.cos(c);
          drive(g.b, x, 1.4 + Math.sin(t * 2 + g.ph) * 0.3, z, vx, Math.cos(t * 2 + g.ph) * 0.6, vz, Math.atan2(vx, vz), 0);
        }
      });
      map.spawns = [[-12, -1], [12, -1], [-5, 7], [5, 8], [-16, 7], [16, 9], [-6, -1], [6, -1]];
    },
  };

  return { 'Train Station': trainStation, 'Construction Site': construction, 'Kitchen Counter': kitchen, 'Freight Train': freight, 'City Rooftops': rooftops, 'Dinner Table': dinner,
    'Floor Is Lava': lavaRoom, 'Frying Pan': fryingPan, 'Container Port': port,
    'Pirate Cove': pirateCove, 'Castle Siege': castle, 'Space Station': spaceStation, 'Theme Park': themePark, 'Sky Course': skyCourse, 'Winter Village': winterVillage, 'Haunted Graveyard': graveyard };
}

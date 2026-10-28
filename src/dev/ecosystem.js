// Dev scene: the wildlife of Vur Sok on a real ocean (a placeholder sea if Ocean is unavailable).
// ?debug&test=ecosystem&shot=<shot>&time=<preset>&state=<sea 0..1>
//   shots: wide | glint | glintIn | glintUp | glintBelow | spiral | spiralUp | jack | breach |
//          net | netUp | feed | skimmer | skimmerUp | dive | coilwing | perch | roost | song | night
//   &inspect=glintfin|spiralback|lanternjack|skimmer|coilwing&view=side|top|front|back|under|q|bq&idx=N
//          (follow one creature; &dist=k scales the distance, &fov=deg)
//   &boom=T sonic boom at T s   &threat (a falcon sweeps over)   &song (the herd sings over ball A)
//   &calf   a real calf lunges through the bait ball (with &shot=feed)
//   &realwhales  real whale models circle in the bubble-net test (slow headless)
//   &yaw=deg orbit the subject   &h=m camera height offset   &nofloor  &norocks
// window.__eco is the ecosystem, window.__ecoTest has test counters (eaten, net, ...).
import { Vector3, Quaternion, Mesh, CylinderGeometry, CircleGeometry, PlaneGeometry, CapsuleGeometry, Color, Float32BufferAttribute } from 'three';
import { Ecosystem } from '../creatures/Ecosystem.js';
import { toonMaterial } from '../render/materials.js';
import { G } from '../render/Globals.js';
import { rng, dampVec3, clamp, lerp } from '../core/math.js';

function rockStack(seed, radius, height, depth) {
  const r = rng(seed);
  const geo = new CylinderGeometry(radius * 0.5, radius, height + depth, 40, 36, false);
  geo.translate(0, (height + depth) * 0.5 - depth, 0);
  const pos = geo.attributes.position;
  const col = [];
  const tint = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    // a coiled ridge winds up the stack: the planet's spiral
    const coil = Math.sin(a * 2 - y * 0.2) * 0.2 + Math.sin(a * 5 + y * 0.45 + seed) * 0.05;
    const k = 1 + coil + (r() - 0.5) * 0.04;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
    const wet = y < 1.2 ? 0.5 : 1;
    tint.setRGB(0.44, 0.38, 0.32).multiplyScalar(wet * (0.85 + coil));
    if (y < -0.5) tint.setRGB(0.3, 0.36, 0.3);
    col.push(tint.r, tint.g, tint.b);
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new Mesh(geo, toonMaterial({ color: 0xffffff, vertexColors: true, rim: 0.2, paint: 1 }));
}

function seafloor(radius, depth) {
  const geo = new CircleGeometry(radius, 120, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const ripple = Math.sin(x * 0.6 + Math.sin(z * 0.25) * 2) * 0.12 + Math.sin(x * 0.05 + z * 0.07) * 2.5;
    pos.setY(i, -depth + ripple);
    const s = 0.78 + 0.22 * Math.sin(x * 0.09 + z * 0.06);
    col.push(0.82 * s, 0.75 * s, 0.6 * s);
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new Mesh(geo, toonMaterial({ color: 0xffffff, vertexColors: true, rim: 0.1, paint: 1 }));
}

export default async function (game) {
  const p = game.params;
  const shot = p.get('shot') || 'wide';
  const s = game.engine.scene;
  if (!p.get('time')) game.atmosphere.set(shot === 'night' ? 'night' : 'morning');
  // (the game now aliases cloudSea to the ocean: only an old cloud sea is switched off)
  if (game.cloudSea && game.cloudSea !== game.ocean) game.cloudSea.enabled = false;

  // ---- the sea --------------------------------------------------------------------------
  if (!game.ocean) {
    try {
      const { Ocean } = await import('../world/Ocean.js');
      game.ocean = new Ocean(game);
    } catch (e) {
      console.warn('[ecosystem] ocean unavailable, using a placeholder sea', e);
      const geo = new PlaneGeometry(4000, 4000, 1, 1);
      geo.rotateX(-Math.PI / 2);
      const water = new Mesh(geo, toonMaterial({ color: 0x1d5a6e, rim: 0.3 }));
      water.renderOrder = -100;
      game.engine.sceneT.add(water);
    }
  }
  const ocean = game.ocean;
  if (ocean?.setSeaState) ocean.setSeaState(+(p.get('state') ?? 0.25), { dur: 0.01 });
  const floorY = -30;
  if (!p.has('nofloor')) s.add(seafloor(700, -floorY));

  // ---- rocks: a spiral sea stack with ledges (skimmer nests) and a spire (coilwing roost) ----
  const perches = [];
  if (!p.has('norocks')) {
    const stack = rockStack(5, 9, 30, 34);
    stack.position.set(-38, 0, -48);
    s.add(stack);
    game.engine.shadows.addCaster(stack);
    for (let k = 0; k < 7; k++) {
      const a = k * 0.9 + 0.4, h = 8 + k * 3.1;
      const rr = 9 * (1 - (h + 34) / (64 * 2)) * 1.05;
      perches.push({ p: new Vector3(-38 + Math.cos(a) * rr, h, -48 + Math.sin(a) * rr), n: new Vector3(0, 1, 0), chapter: 'dev', ledge: true });
    }
    perches.push({ p: new Vector3(-38, 30.5, -48), n: new Vector3(0, 1, 0), chapter: 'dev' });
    const spire = rockStack(9, 4, 44, 34);
    spire.position.set(62, 0, -26);
    s.add(spire);
    game.engine.shadows.addCaster(spire);
    perches.push({ p: new Vector3(62, 44.4, -26), n: new Vector3(0, 1, 0), chapter: 'dev' });
    for (let k = 0; k < 4; k++) {
      const a = k * 1.6, h = 20 + k * 6;
      perches.push({ p: new Vector3(62 + Math.cos(a) * 3.2, h, -26 + Math.sin(a) * 3.2), n: new Vector3(0, 1, 0), chapter: 'dev', ledge: true });
    }
  }

  // ---- the ecosystem ---------------------------------------------------------------------
  const eco = new Ecosystem(game);
  window.__eco = eco;
  eco.perches = perches;
  eco.seabedAt = () => floorY;
  const ballA = eco.addFishSchool(new Vector3(0, -6, -40), 'glintfin', +(p.get('count') || 1400), { seed: 3, palette: 0, mode: p.get('mode') || 'mill' });
  if (!p.has('mode')) ballA.wanderT = 1e9;
  const ballB = eco.addFishSchool(new Vector3(-55, -5, -105), 'glintfin', 800, { seed: 5, palette: 3 });
  const column = eco.addFishSchool(new Vector3(36, -7, -78), 'spiralback', 220, { seed: 7, palette: 0 });
  const jacks = eco.addFishSchool(new Vector3(4, -18, -44), 'lanternjack', 2, { seed: 11, palette: 0 });
  eco.addReptileFlock(new Vector3(-38, 26, -48), 'skimmer', 9, { seed: 13 });
  eco.addReptileFlock(new Vector3(62, 46, -26), 'coilwing', 90, { seed: 17 });
  window.__ecoTest = { eaten: 0, ballA, ballB, column, jacks };

  // ---- whales: proxies (or real whales) for the bubble net and the roost --------------------
  const whales = [];
  eco.whales = whales;
  const netTest = shot === 'net' || shot === 'netUp' || p.has('net');
  const realWhales = p.has('realwhales');
  let WhaleCls = null, Types = null;
  if (realWhales || p.has('calf') || shot === 'roost') {
    try {
      WhaleCls = (await import('../creatures/Whale.js')).Whale;
      Types = await import('../creatures/WhaleTypes.js');
    } catch (e) { console.warn('[ecosystem] whales unavailable', e); }
  }
  const proxy = (L) => {
    const geo = new CapsuleGeometry(L * 0.16, L * 0.62, 6, 14);
    geo.rotateX(Math.PI / 2);
    const m = new Mesh(geo, toonMaterial({ color: 0x3b4a58, rim: 0.3 }));
    s.add(m);
    return { pos: new Vector3(), vel: new Vector3(), fwd: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0), L, mesh: m, drive: { mouth: 0 } };
  };
  if (netTest) {
    for (let k = 0; k < 3; k++) {
      let w;
      if (realWhales && WhaleCls) {
        w = new WhaleCls(Types.ADULTS[k + 1] || Types.MOTHER);
        s.add(w.group);
      } else w = proxy(20 + k * 3);
      w.netA = (k / 3) * Math.PI * 2;
      whales.push(w);
    }
    eco.feeders = whales;
  }
  let roostWhale = null;
  if (shot === 'roost' && WhaleCls) {
    roostWhale = new WhaleCls(Types.MOTHER);
    roostWhale.place(new Vector3(30, 1.5, -10), Math.PI * 0.8);
    s.add(roostWhale.group);
    roostWhale.model?.castShadows?.(game.engine.shadows);
    eco.roosts.push(roostWhale);
  }
  let calf = null;
  if (p.has('calf') && WhaleCls) {
    calf = new WhaleCls(Types.CALF);
    s.add(calf.group);
    calf.model?.castShadows?.(game.engine.shadows);
  }

  if (p.has('song')) eco.songFocus = new Vector3(0, 6, -40);

  // ---- camera --------------------------------------------------------------------------------
  const cam = game.engine.camera;
  const camPos = new Vector3(30, 40, 60);
  const camLook = new Vector3(0, -4, -50);
  let fov = +(p.get('fov') || 52);
  let first = true;
  const dist = p.has('dist') ? +p.get('dist') : null;
  const yawOff = ((+p.get('yaw') || 0) * Math.PI) / 180;
  const hOff = p.has('h') ? +p.get('h') : 0;
  const inspect = p.get('inspect');
  const view = p.get('view') || 'q';
  const idx = +(p.get('idx') || 0);
  const VIEWS = {
    side: [1, 0.08, 0], top: [0.05, 1, -0.2], front: [0.12, 0.06, 1], back: [0.1, 0.25, -1],
    under: [0.25, -1, 0.15], q: [0.85, 0.35, 0.7], bq: [0.7, 0.3, -0.8], fq: [0.6, 0.15, 1],
  };
  const up = new Vector3(0, 1, 0);
  const tmp = new Vector3();
  const fishPose = (school, i) => {
    const S = school.pool.S, o = (school.start + (i % school.count)) * 20;
    const c = new Vector3(S[o], S[o + 1], S[o + 2]);
    const v = new Vector3(S[o + 4], S[o + 5], S[o + 6]);
    const q = new Quaternion();
    if (v.lengthSq() > 1e-6) q.setFromUnitVectors(new Vector3(0, 0, 1), v.normalize());
    return { c, q, size: S[o + 17] };
  };
  const inspectFrame = () => {
    let c, q = new Quaternion(), size = 1;
    if (inspect === 'glintfin' || inspect === 'spiralback' || inspect === 'lanternjack') {
      const sc = inspect === 'glintfin' ? ballA : inspect === 'spiralback' ? column : jacks;
      const f = fishPose(sc, idx);
      c = f.c; q = f.q; size = f.size * 1.6;
    } else {
      const birds = eco.reptiles.birds.filter((b) => b.species === inspect);
      const b = birds[idx % Math.max(1, birds.length)];
      if (!b) return [camPos.clone(), camLook.clone()];
      c = b.pos.clone(); q.copy(b.quat); size = (b.span || 1) * 1.4;
    }
    const o = new Vector3(...(VIEWS[view] || VIEWS.q)).normalize().multiplyScalar(size * (dist ?? 1)).applyQuaternion(q);
    return [c.clone().add(o), c.clone()];
  };
  const orbit = (subject, d, h, baseDir) => {
    const dir = baseDir.clone().applyAxisAngle(up, yawOff);
    return subject.clone().addScaledVector(dir, d).add(new Vector3(0, h + hOff, 0));
  };
  const lunge = { to: null, dir: null, t0: -99 };
  const frame = (dt) => {
    let pos, look;
    if (inspect) {
      [pos, look] = inspectFrame();
      camPos.copy(pos); camLook.copy(look);
      fov = +(p.get('fov') || 38);
      game.focus.copy(camLook);
      return;
    }
    const A = ballA.center;
    if (shot === 'glint') {
      look = A.clone();
      pos = orbit(A, dist ?? ballA.R * 2.2, 0.5, new Vector3(0.6, 0, 0.8).normalize());
      fov = 55;
    } else if (shot === 'glintIn') {
      look = A.clone().add(new Vector3(0, 0.3, 0));
      pos = orbit(A, dist ?? ballA.R * 0.95, -0.4, new Vector3(0.6, 0, 0.8).normalize());
      fov = 62;
    } else if (shot === 'glintUp') {
      look = A.clone();
      pos = orbit(A, dist ?? 16, 14 - A.y, new Vector3(0.3, 0, 1).normalize());
      fov = 50;
    } else if (shot === 'glintBelow') {
      look = A.clone().add(new Vector3(0, 2, 0));
      pos = A.clone().add(new Vector3(2, -(dist ?? ballA.R * 2.1), 6));
      fov = 62;
    } else if (shot === 'spiral') {
      const c = column.center;
      look = new Vector3(c.x, column.surf - column.R * 1.1, c.z);
      pos = orbit(look, dist ?? column.R * 3.4, -1, new Vector3(0.8, 0, 0.6).normalize());
      fov = 58;
    } else if (shot === 'spiralUp') {
      const c = column.center;
      look = new Vector3(c.x, 1.2, c.z);
      pos = orbit(look, dist ?? 14, 1.6, new Vector3(0.75, 0, 0.66).normalize());
      fov = 55;
    } else if (shot === 'jack' || shot === 'breach') {
      const f = fishPose(jacks, idx);
      if (shot === 'jack') {
        look = f.c.clone();
        const back = new Vector3(0, 0, -1).applyQuaternion(f.q).setY(0).normalize();
        const side = new Vector3(-back.z, 0, back.x);
        pos = f.c.clone().addScaledVector(side, (dist ?? 9)).addScaledVector(back, 3).add(new Vector3(0, 1.5 + hOff, 0));
        fov = 50;
      } else {
        look = new Vector3(A.x, 0.5, A.z);
        pos = orbit(look, dist ?? 26, 4, new Vector3(0.7, 0, 0.7).normalize());
        fov = 55;
      }
    } else if (shot === 'net') {
      look = A.clone().add(new Vector3(0, -1, 0));
      pos = orbit(A, dist ?? 34, -4, new Vector3(0.75, 0, 0.66).normalize());
      fov = 62;
    } else if (shot === 'netUp') {
      look = new Vector3(A.x, 0, A.z);
      pos = orbit(look, dist ?? 30, 26, new Vector3(0.6, 0, 0.8).normalize());
      fov = 55;
    } else if (shot === 'feed') {
      if (calf) {
        look = calf.pos.clone();
        pos = calf.pos.clone().addScaledVector(calf.fwd, -7).add(new Vector3(0, 1.8 + hOff, 0)).addScaledVector(calf.right, 2.5);
      } else {
        look = A.clone();
        pos = orbit(A, dist ?? 16, 0, new Vector3(0.7, 0, 0.7).normalize());
      }
      fov = 60;
    } else if (shot === 'skimmer' || shot === 'skimmerUp' || shot === 'dive') {
      const birds = eco.reptiles.birds.filter((b) => b.species === 'skimmer');
      const b = birds[idx % Math.max(1, birds.length)];
      if (b) {
        look = b.pos.clone();
        pos = b.pos.clone().add(new Vector3(-(dist ?? 9), 2 + hOff, (dist ?? 9) * 0.6).applyAxisAngle(up, yawOff));
      } else { look = new Vector3(-38, 20, -48); pos = orbit(look, 40, 10, new Vector3(1, 0, 0.4).normalize()); }
      fov = 50;
    } else if (shot === 'coilwing' || shot === 'perch') {
      const birds = eco.reptiles.birds.filter((b) => b.species === 'coilwing');
      if (shot === 'perch') {
        look = new Vector3(62, 42, -26);
        pos = orbit(look, dist ?? 12, 2, new Vector3(-0.6, 0, 0.8).normalize());
      } else {
        const c = new Vector3();
        for (const b of birds) c.add(b.pos);
        if (birds.length) c.divideScalar(birds.length); else c.set(62, 40, -26);
        look = c;
        pos = orbit(c, dist ?? 45, 4, new Vector3(-0.5, 0, 0.86).normalize());
      }
      fov = 52;
    } else if (shot === 'roost' && roostWhale) {
      const w = roostWhale;
      look = w.pos.clone().addScaledVector(w.up, w.L * 0.15);
      pos = look.clone().addScaledVector(w.right, -(dist ?? 14)).addScaledVector(w.fwd, -6).add(new Vector3(0, 5 + hOff, 0));
      fov = 50;
    } else if (shot === 'song') {
      look = new Vector3(0, -2, -40);
      pos = orbit(look, dist ?? 55, 48, new Vector3(0.2, 0, 1).normalize());
      fov = 55;
    } else {
      look = new Vector3(0, -4, -55);
      pos = orbit(look, dist ?? 95, 42, new Vector3(0.35, 0, 1).normalize());
      fov = 55;
    }
    if (first) { camPos.copy(pos); camLook.copy(look); first = false; }
    dampVec3(camPos, pos, 3, dt);
    dampVec3(camLook, look, 5, dt);
    game.focus.copy(camLook);
  };
  // close inspection needs a near plane closer than the game's 0.4 m
  if (inspect) { cam.near = 0.03; cam.updateProjectionMatrix(); }
  game.cameraRig.update = () => {
    cam.position.copy(camPos);
    cam.lookAt(camLook);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  };
  game.engine.shadows.radius = 120;

  // ---- scripted tests ------------------------------------------------------------------------
  const boomAt = p.has('boom') ? +p.get('boom') || 2 : -1;
  let boomed = false;
  const mouth = new Vector3();
  const threat = new Vector3();
  let netT = 0;
  game.devUpdate = (dt) => {
    const t = game.time;
    const A = ballA.center;
    if (p.has('threat')) {
      const k = (t * 0.12) % 1;
      threat.set(-120 + k * 240, 45 - Math.sin(k * Math.PI) * 25, -40 + Math.sin(k * 6) * 20);
      eco.threat = threat;
    }
    if (boomAt >= 0 && !boomed && t >= boomAt) {
      boomed = true;
      eco.scatter(A.clone().add(new Vector3(0, 3, 0)), 45, 1.2);
    }
    // bubble net: whales spiral up beneath ball A, then lunge up through it together
    if (netTest) {
      netT += dt;
      const cyc = netT % 34;
      for (let k = 0; k < whales.length; k++) {
        const w = whales[k];
        const L = w.L;
        let pos, vel = new Vector3();
        if (cyc < 22) {
          const a = w.netA + cyc * 0.42;
          const rr = lerp(ballA.R + 16, ballA.R + 6, cyc / 22);
          const y = lerp(-26, -14, cyc / 22);
          pos = new Vector3(A.x + Math.cos(a) * rr, y, A.z + Math.sin(a) * rr);
          vel.set(-Math.sin(a) * rr * 0.42, 0.5, Math.cos(a) * rr * 0.42);
          w.drive.mouth = 0;
        } else {
          // the lunge: from under the ball up through it and out of the sea
          const u = (cyc - 22) / 12;
          const a = w.netA + 22 * 0.42;
          const r0 = ballA.R + 6;
          const from = new Vector3(A.x + Math.cos(a) * r0 * 0.4, -24, A.z + Math.sin(a) * r0 * 0.4);
          const to = new Vector3(A.x + Math.cos(a) * 2, 6, A.z + Math.sin(a) * 2);
          pos = from.clone().lerp(to, Math.min(u * 1.4, 1));
          vel.subVectors(to, from).multiplyScalar(1.4 / 12);
          w.drive.mouth = u > 0.2 && u < 0.75 ? 1 : 0;
        }
        if (w.isCalf !== undefined && w.place) {
          // a real whale
          w.pos.copy(pos);
          w.vel.copy(vel);
          w.yaw = Math.atan2(vel.x, vel.z);
          w.pitch = Math.asin(clamp(vel.y / Math.max(vel.length(), 1e-3), -1, 1));
          w._syncTransform();
          w.animate(dt, cam.position);
        } else {
          w.pos.copy(pos);
          w.vel.copy(vel);
          w.fwd.copy(vel).normalize();
          w.mesh.position.copy(pos);
          w.mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), w.fwd);
        }
      }
      window.__ecoTest.net = ballA.net;
    }
    if (roostWhale) {
      const w = roostWhale;
      const a = t * 0.02;
      w.ctl.targetYaw = Math.PI * 0.8 + Math.sin(a) * 0.3;
      w.ctl.thrust = 0.15;
      w.drive.effort = 0.1;
      w.step(dt);
      w.pos.y = (ocean?.heightAt?.(w.pos.x, w.pos.z) ?? 0) + 0.8;
      w._syncTransform();
      w.animate(dt, cam.position);
    }
    // feeding test: a mouth (or the calf) lunges through ball A every 6 s
    if (shot === 'feed' || p.has('feed')) {
      const k = t % 6;
      if (k < dt * 1.5 || !lunge.to) {
        const from = A.clone().add(new Vector3(Math.cos(t) * 16, 3 + Math.sin(t * 0.7) * 2, Math.sin(t) * 16));
        lunge.to = A.clone();
        lunge.dir = A.clone().sub(from).normalize();
        lunge.t0 = t;
      }
      const sdist = (t - lunge.t0) * 6.5 - 16;
      mouth.copy(lunge.to).addScaledVector(lunge.dir, sdist);
      if (calf) {
        calf.pos.copy(mouth).addScaledVector(lunge.dir, -calf.L * 0.48);
        calf.vel.copy(lunge.dir).multiplyScalar(6.5);
        calf.yaw = Math.atan2(lunge.dir.x, lunge.dir.z);
        calf.pitch = Math.asin(clamp(lunge.dir.y, -1, 1));
        calf.drive.mouth = 1;
        calf.drive.feed = 1;
        calf.drive.effort = 0.7;
        calf._syncTransform();
        calf.animate(dt, cam.position);
      }
      const n = eco.eat(mouth, calf ? calf.L * 0.35 + 0.6 : 1.6, dt, calf || mouth);
      window.__ecoTest.eaten += n;
      window.__ecoTest.mouth = mouth.toArray();
    }
    eco.update(dt);
    frame(dt);
  };
  game.focus.set(0, 0, -40);
}

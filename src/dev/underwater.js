// Dev scene: under the sea of Vur Sok, from the calf's point of view.
// ?debug&test=underwater&shot=kelp|crabs|jellies|rays|reef|night|surface
//   &time=<preset>  &state=<sea 0..1>  &nocalf (no whale)  &free (the camera holds still)
//   &dens=k  reef density multiplier
// window.__uw() prints the reef stats (counts, draws, triangles, eaten).
import { Vector3, Mesh, PlaneGeometry, CylinderGeometry, Color, Float32BufferAttribute } from 'three';
import { Ecosystem } from '../creatures/Ecosystem.js';
import { kelpDensity, gardenDensity } from '../creatures/eco/Reef.js';
import { toonMaterial } from '../render/materials.js';
import { dampVec3, clamp } from '../core/math.js';

// a reef shelf around a spiral rock: shallow lagoon sand, coral ridges, a drop to the deep
const IX = 0, IZ = 0;
function floorAt(x, z) {
  const r = Math.hypot(x - IX, z - IZ);
  let h = -3.5 - Math.max(0, r - 30) * 0.09;
  h = Math.max(h, -24);
  h += Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.06) * 1.6 + Math.sin(x * 0.31 + z * 0.23) * 0.25;
  // the rock's foot
  h = Math.max(h, 6 - r * 0.5);
  return h;
}

function seafloor(size, seg) {
  const geo = new PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = [];
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = floorAt(x, z);
    pos.setY(i, y);
    const g = gardenDensity(x, z), k = kelpDensity(x, z);
    const sand = 0.8 + 0.2 * Math.sin(x * 0.9 + Math.sin(z * 0.4) * 2);
    c.setRGB(0.78 * sand, 0.7 * sand, 0.55 * sand);
    // coralline pinks and violet encrusters where the gardens grow, dark holdfast mats under kelp
    c.lerp(new Color(0.62, 0.4, 0.42), Math.max(0, g - 0.45) * 1.6);
    c.lerp(new Color(0.3, 0.32, 0.2), Math.max(0, k - 0.5) * 1.2);
    if (y > -0.5) c.setRGB(0.3, 0.27, 0.24);
    col.push(c.r * 0.7, c.g * 0.7, c.b * 0.7);
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new Mesh(geo, toonMaterial({ color: 0xffffff, vertexColors: true, rim: 0.1, paint: 1 }));
}

function rock() {
  const geo = new CylinderGeometry(9, 18, 50, 36, 30, false);
  geo.translate(0, 5, 0);
  const pos = geo.attributes.position;
  const col = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const coil = 1 + Math.sin(a * 2 - y * 0.18) * 0.18 + Math.sin(a * 6 + y * 0.5) * 0.04;
    pos.setX(i, x * coil);
    pos.setZ(i, z * coil);
    const s = 0.75 + 0.25 * Math.sin(y * 1.3 + a);
    if (y < 0.3) col.push(0.12 * s, 0.16 * s, 0.11 * s);
    else col.push(0.2 * s, 0.17 * s, 0.14 * s);
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const m = new Mesh(geo, toonMaterial({ color: 0xffffff, vertexColors: true, rim: 0.2, paint: 1 }));
  m.position.set(IX, -20, IZ);
  return m;
}

/** The best spot for f (max of f over shallow water near the rock). */
function bestSpot(f, minDepth, maxDepth, r0 = 40, r1 = 120) {
  let best = -1, bx = 0, bz = 0;
  for (let i = -24; i <= 24; i++) for (let j = -24; j <= 24; j++) {
    const x = i * 5, z = j * 5;
    const r = Math.hypot(x, z);
    if (r < r0 || r > r1) continue;
    const d = -floorAt(x, z);
    if (d < minDepth || d > maxDepth) continue;
    const v = f(x, z);
    if (v > best) { best = v; bx = x; bz = z; }
  }
  return new Vector3(bx, floorAt(bx, bz), bz);
}

export default async function (game) {
  const p = game.params;
  const shot = p.get('shot') || 'kelp';
  const s = game.engine.scene;
  if (!p.get('time')) game.atmosphere.set(shot === 'night' ? 'night' : 'morning');
  if (game.cloudSea && game.cloudSea !== game.ocean) game.cloudSea.enabled = false;
  if (!game.ocean) {
    try {
      const { Ocean } = await import('../world/Ocean.js');
      game.ocean = new Ocean(game);
    } catch (e) { console.warn('[underwater] no ocean', e); }
  }
  const ocean = game.ocean;
  if (ocean?.setSeaState) ocean.setSeaState(+(p.get('state') ?? 0.3), { dur: 0.01 });
  s.add(seafloor(420, 210));
  const rk = rock();
  s.add(rk);
  game.engine.shadows.addCaster(rk);

  const eco = new Ecosystem(game);
  window.__eco = eco;
  eco.seabedAt = floorAt;
  if (p.has('dens')) eco.reef.density = +p.get('dens');
  // a few fish schools over the reef too
  eco.addFishSchool(new Vector3(70, -6, 40), 'glintfin', 700, { seed: 3, mode: 'mill' });
  eco.addFishSchool(new Vector3(-60, -9, 70), 'spiralback', 120, { seed: 7 });

  // ---- the calf ------------------------------------------------------------------------------
  let calf = null;
  if (!p.has('nocalf')) {
    try {
      const { Whale } = await import('../creatures/Whale.js');
      const T = await import('../creatures/WhaleTypes.js');
      calf = new Whale(T.CALF);
      s.add(calf.group);
      calf.model?.castShadows?.(game.engine.shadows);
    } catch (e) { console.warn('[underwater] no whale', e); }
  }
  const actor = calf || { pos: new Vector3(), vel: new Vector3(), L: 7, yaw: 0, drive: { mouth: 0 } };
  eco.whales = [actor];

  // ---- the shot: where the calf swims and where we look ----------------------------------------
  const kelpAt = bestSpot(kelpDensity, 6, 18);
  const reefAt = bestSpot(gardenDensity, 3, 14);
  let center = reefAt, depth = -5, radius = 16, speed = 2.6, camBack = 12, camUp = 2.5, lookAhead = 8, fov = 62;
  if (shot === 'kelp') { center = kelpAt; depth = Math.max(kelpAt.y + 4, -7); radius = 14; camBack = 10; }
  else if (shot === 'crabs') { center = reefAt; depth = reefAt.y + 2.6; radius = 10; speed = 1.8; camBack = 8; camUp = 1.8; }
  else if (shot === 'jellies') { center = bestSpot((x, z) => -Math.hypot(x - 90, z + 40), 12, 24); depth = -8; radius = 18; }
  else if (shot === 'rays') { center = bestSpot((x, z) => -Math.hypot(x + 80, z - 30), 10, 24); depth = -7; radius = 26; speed = 3.2; camBack = 14; camUp = 4; }
  else if (shot === 'night') { center = kelpAt; depth = Math.max(kelpAt.y + 4, -7); radius = 14; }
  else if (shot === 'surface') { center = reefAt; depth = -3; radius = 18; camUp = -2.5; }
  const sea = () => 0;
  const tmp = new Vector3();
  const fwd = new Vector3();

  // set up the moments for the shot once the reef has populated
  let staged = false;
  const stage = () => {
    staged = true;
    const R = eco.reef;
    if (shot === 'crabs') {
      // a little colony in the calf's path
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2, rr = 3 + (i % 4) * 2.2;
        const x = actor.pos.x + Math.cos(a) * rr + fwd.x * 10, z = actor.pos.z + Math.sin(a) * rr + fwd.z * 10;
        R.crabs.alive[i] = 1;
        R.crabs.P[i * 3] = x; R.crabs.P[i * 3 + 1] = floorAt(x, z); R.crabs.P[i * 3 + 2] = z;
        R.crabs.floor[i] = floorAt(x, z);
        R.crabs.vr[i] = i % 3;
        R.crabs.s[i] = [1.5, 2.0, 2.8][i % 3];
        R.crabs.t2[i] = 0; R.crabs.a[i] = 0;
      }
      for (let i = 0; i < 6; i++) {
        const x = actor.pos.x + fwd.x * 14 + (i - 3) * 2.5, z = actor.pos.z + fwd.z * 14 + (i % 2) * 3;
        const P = R.puffers;
        P.alive[i] = 1; P.P[i * 3] = x; P.P[i * 3 + 1] = floorAt(x, z) + 1.5; P.P[i * 3 + 2] = z;
        P.H[i * 3] = x; P.H[i * 3 + 1] = P.P[i * 3 + 1]; P.H[i * 3 + 2] = z; P.floor[i] = floorAt(x, z); P.s[i] = 2;
      }
    }
    if (shot === 'jellies' || shot === 'night') {
      const c = tmp.copy(actor.pos).addScaledVector(fwd, 14);
      for (let i = 0; i < 34; i++) R._spawnJelly(i, 0, 0, c);
    }
    if (shot === 'rays') { R._underT = 10; R._rayT = -1e9; }
  };

  // ---- camera --------------------------------------------------------------------------------
  const cam = game.engine.camera;
  const camPos = new Vector3(), camLook = new Vector3();
  let first = true;
  game.cameraRig.update = () => {
    cam.position.copy(camPos);
    cam.lookAt(camLook);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  };
  game.engine.shadows.radius = 90;

  let ang = shot === 'crabs' ? -0.5 : 0;
  const mouth = new Vector3();
  window.__uw = () => {
    const r = eco.reef.stats;
    return { ...r, under: +(ocean?.underwater ?? 0).toFixed(2), eaten: +(window.__uwEaten || 0).toFixed(2), calf: actor.pos.toArray().map((v) => +v.toFixed(1)), kelpAt: kelpAt.toArray().map((v) => +v.toFixed(1)), reefAt: reefAt.toArray().map((v) => +v.toFixed(1)) };
  };
  window.__uwEaten = 0;
  game.devUpdate = (dt) => {
    // the calf glides in a slow loop around the spot, rolling a little into the turn
    ang += (speed / radius) * dt;
    const px = center.x + Math.cos(ang) * radius, pz = center.z + Math.sin(ang) * radius;
    const py = depth + Math.sin(ang * 2) * 0.6;
    fwd.set(-Math.sin(ang), 0, Math.cos(ang));
    actor.pos.set(px, py, pz);
    actor.vel.copy(fwd).multiplyScalar(speed);
    actor.yaw = Math.atan2(fwd.x, fwd.z);
    if (calf) {
      calf.pitch = 0.05 * Math.cos(ang * 2);
      calf.drive.effort = 0.35;
      calf._syncTransform();
      calf.animate(dt, cam.position);
    }
    // the mouth opens near food, as in the game (Story.updateCalf)
    const n = eco.nearestSwarm(actor.pos);
    const open = n && n.dist < 28 ? 1 : 0;
    actor.drive.mouth += (open - actor.drive.mouth) * Math.min(1, dt * 6);
    if (actor.drive.mouth > 0.4) {
      mouth.copy(actor.pos).addScaledVector(fwd, (actor.L || 7) * 0.48);
      window.__uwEaten += eco.eat(mouth, (actor.L || 7) * 0.35 + 0.6, dt, actor) || 0;
    }
    eco.update(dt);
    if (!staged && game.time > 0.2) stage();
    // camera: behind and above the calf, looking a little ahead
    let pos, look;
    if (shot === 'crabs') {
      pos = tmp.copy(actor.pos).addScaledVector(fwd, -camBack).add(new Vector3(fwd.z * 4, camUp, -fwd.x * 4));
      look = new Vector3().copy(actor.pos).addScaledVector(fwd, lookAhead + 4).setY(floorAt(actor.pos.x + fwd.x * 12, actor.pos.z + fwd.z * 12) + 0.6);
    } else if (shot === 'surface' || shot === 'jellies') {
      pos = tmp.copy(actor.pos).addScaledVector(fwd, -camBack).add(new Vector3(0, -3, 0));
      look = new Vector3().copy(actor.pos).addScaledVector(fwd, lookAhead).add(new Vector3(0, shot === 'surface' ? 5 : 2, 0));
    } else {
      pos = tmp.copy(actor.pos).addScaledVector(fwd, -camBack).add(new Vector3(fwd.z * 2, camUp, -fwd.x * 2));
      look = new Vector3().copy(actor.pos).addScaledVector(fwd, lookAhead);
    }
    pos.y = Math.min(pos.y, sea() - 0.8);
    if (first) { camPos.copy(pos); camLook.copy(look); first = false; }
    if (!p.has('free')) { dampVec3(camPos, pos, 4, dt); dampVec3(camLook, look, 5, dt); }
    game.focus.copy(actor.pos);
    void clamp;
  };
  game.focus.copy(center);
}

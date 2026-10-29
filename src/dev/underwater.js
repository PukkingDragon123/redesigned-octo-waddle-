// Dev scene: under the sea of Vur Sok, from the calf's point of view.
// ?debug&test=underwater&shot=kelp|puffers|jellies|rays|reef|night|surface|manta|mantaair|fishmacro
//   &shot=fishmacro&species=puffer|eel|glintfin|spiralback|lanternjack&view=side|front|top|q|under
//   (&inflate puffs the puffer up, &dist=k scales the camera distance)
//   manta: a close-up of a manta swimming alongside the calf (&view=side|below|front|top,
//   &loop: a free manta doing feeding loops instead); mantaair: the great manta of the shallows
//   seen from the air through the water.
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
  m.position.set(IX, -22, IZ);
  return m;
}

/** The best spot for f (max of f over shallow water near the rock). */
function bestSpot(f, minDepth, maxDepth, r0 = 40, r1 = 120) {
  let best = -Infinity, bx = 0, bz = 0;
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
  const view = p.get('view') || 'side';
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
  const macro = shot === 'fishmacro' ? (p.get('species') || 'puffer') : null;
  const macroFish = macro === 'glintfin' || macro === 'spiralback' || macro === 'lanternjack';
  let macroSchool = null;

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
  else if (shot === 'puffers') { center = reefAt; depth = reefAt.y + 2.6; radius = 10; speed = 1.8; camBack = 8; camUp = 1.8; }
  else if (shot === 'jellies') { center = bestSpot((x, z) => -Math.hypot(x - 90, z + 40), 12, 24); depth = -8; radius = 18; }
  else if (shot === 'rays') { center = bestSpot((x, z) => -Math.hypot(x + 80, z - 30), 10, 24); depth = -7; radius = 26; speed = 3.2; camBack = 14; camUp = 4; }
  else if (shot === 'night') { center = kelpAt; depth = Math.max(kelpAt.y + 4, -7); radius = 14; }
  else if (shot === 'surface') { center = reefAt; depth = -3; radius = 18; camUp = -2.5; }
  else if (shot === 'manta' || shot === 'mantaair') { center = bestSpot((x, z) => -Math.hypot(x + 80, z - 30), 10, 24); depth = -7; radius = 30; speed = 2.6; }
  else if (macro) { center = reefAt; depth = reefAt.y + 3; radius = 40; speed = 0.5; fov = +(p.get('fov') || 40); }
  if (macroFish) macroSchool = eco.addFishSchool(new Vector3(reefAt.x, Math.min(reefAt.y + 3, -2.5), reefAt.z), macro, macro === 'lanternjack' ? 1 : 8, { seed: 5 });
  const sea = () => 0;
  const tmp = new Vector3();
  const fwd = new Vector3();

  // set up the moments for the shot once the reef has populated
  let staged = false;
  const stage = () => {
    staged = true;
    const R = eco.reef;
    if (shot === 'puffers') {
      // a few lantern puffers on the reef floor in the calf's path
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
    if (macro === 'puffer') {
      const P = R.puffers, x = center.x, z = center.z, y = floorAt(x, z) + 2.2;
      P.alive[0] = 1; P.P[0] = x; P.P[1] = y; P.P[2] = z; P.H[0] = x; P.H[1] = y; P.H[2] = z;
      P.V[0] = 0; P.V[1] = 0; P.V[2] = 0; P.floor[0] = floorAt(x, z); P.s[0] = 1.6; P.seed[0] = 0.31; P.yaw[0] = 0.6; P.t[0] = 1e9; P.a[0] = 0;
    }
    if (macro === 'eel') {
      const E = R.eels, x = center.x, z = center.z, y = floorAt(x, z) + 2.5;
      E.alive[0] = 1; E.P[0] = x; E.P[1] = y; E.P[2] = z; E.H[0] = x; E.H[1] = y; E.H[2] = z; E.floor[0] = floorAt(x, z); E.s[0] = 2.6; E.seed[0] = +(p.get('morph') || 0.2);
    }
    if (shot === 'manta' || shot === 'mantaair') {
      // one manta posed for the camera (slot 0), or the great manta of the shallows (last slot)
      const Rr = R.rays, giant = shot === 'mantaair';
      const i = giant ? Rr.max - 1 : 0, k = i * 3;
      R._rayT = 1e9;
      const side = 1;
      const rx = fwd.z, rz = -fwd.x; // the calf's right
      const x = actor.pos.x + fwd.x * (giant ? 10 : 4) - rx * side * 9, z = actor.pos.z + fwd.z * (giant ? 10 : 4) - rz * side * 9;
      const s = giant ? 6 : 3.2;
      Rr.alive[i] = 1; Rr.vr[i] = giant ? 1 : 0; Rr.wait[i] = 0;
      Rr.P[k] = x; Rr.P[k + 1] = giant ? -1.2 - s * 0.1 : p.has('loop') ? -10 : actor.pos.y; Rr.P[k + 2] = z;
      Rr.H[k] = x; Rr.H[k + 1] = Rr.P[k + 1]; Rr.H[k + 2] = z;
      Rr.V[k] = 0; Rr.V[k + 1] = 0; Rr.V[k + 2] = 0;
      Rr.s[i] = s; Rr.seed[i] = 0.37; Rr.yaw[i] = Math.atan2(fwd.x, fwd.z); Rr.pitch[i] = 0; Rr.roll[i] = 0; Rr.c[i] = 2.4;
      Rr.floor[i] = floorAt(x, z); Rr.d[i] = 0.3; Rr.t2[i] = 0;
      if (!giant && !p.has('loop')) { Rr.a[i] = 1; Rr.t[i] = 1e9; Rr.b[i] = side; }
      else { Rr.a[i] = 0; if (p.has('loop')) { Rr.V[k + 1] = 0.7; R.rayLoop(i, 9); } }
    }
  };

  // ---- camera --------------------------------------------------------------------------------
  const cam = game.engine.camera;
  const camPos = new Vector3(), camLook = new Vector3();
  let first = true;
  game.cameraRig.update = () => {
    cam.position.copy(camPos);
    cam.lookAt(camLook);
    if (macro && cam.near > 0.03) { cam.near = 0.03; cam.updateProjectionMatrix(); }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  };
  game.engine.shadows.radius = 90;

  let ang = shot === 'puffers' ? -0.5 : 0;
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
    if (macro && staged) {
      // a macro portrait of one creature, framed by its own heading
      let c = null, yaw = 0, size = 1, fv = null;
      if (macro === 'puffer') { const P = eco.reef.puffers; P.H[0] = P.P[0]; P.H[1] = P.P[1]; P.H[2] = P.P[2]; P.t[0] = 1e9; if (p.has('inflate')) P.t2[0] = 3; c = new Vector3(P.P[0], P.P[1], P.P[2]); yaw = P.yaw[0]; size = P.s[0] * 0.75; }
      else if (macro === 'eel') { const E = eco.reef.eels; c = new Vector3(E.P[0], E.P[1], E.P[2]); yaw = E.yaw[0]; size = E.s[0] * 0.55; c.add(new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(E.s[0] * 0.25)); }
      else if (macroSchool) {
        const S = macroSchool.pool.S, o = (macroSchool.start + (+(p.get('idx') || 0) % macroSchool.count)) * 20;
        c = new Vector3(S[o], S[o + 1], S[o + 2]); fv = new Vector3(S[o + 4], S[o + 5], S[o + 6]); size = S[o + 17] * 1.25;
        yaw = Math.atan2(fv.x, fv.z);
      }
      if (c) {
        const f = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)), r = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const k = size * +(p.get('dist') || 1);
        const off = view === 'front' ? f.clone().multiplyScalar(1.1 * k).addScaledVector(r, 0.35 * k).add(new Vector3(0, 0.15 * k, 0))
          : view === 'top' ? new Vector3(0, 1.3 * k, 0).addScaledVector(f, -0.25 * k)
            : view === 'under' ? new Vector3(0, -1.1 * k, 0).addScaledVector(r, 0.4 * k)
              : view === 'q' ? f.clone().multiplyScalar(0.7 * k).addScaledVector(r, 0.85 * k).add(new Vector3(0, 0.35 * k, 0))
                : r.clone().multiplyScalar(1.2 * k).add(new Vector3(0, 0.12 * k, 0));
        camPos.copy(c).add(off); camLook.copy(c);
        // a fish cruising just under the surface is seen from a little below it
        if (c.y > -2 && view !== 'top') camPos.y = Math.min(camPos.y, c.y - 0.45 * k);
        camPos.y = Math.min(camPos.y, sea() - 0.3);
        actor.pos.set(c.x + 300, -30, c.z + 300);
        game.focus.copy(c);
        return;
      }
    }
    if (shot === 'puffers') {
      pos = tmp.copy(actor.pos).addScaledVector(fwd, -camBack).add(new Vector3(fwd.z * 4, camUp, -fwd.x * 4));
      look = new Vector3().copy(actor.pos).addScaledVector(fwd, lookAhead + 4).setY(floorAt(actor.pos.x + fwd.x * 12, actor.pos.z + fwd.z * 12) + 0.6);
    } else if ((shot === 'manta' || shot === 'mantaair') && staged) {
      const Rr = eco.reef.rays, i = shot === 'mantaair' ? Rr.max - 1 : 0, k = i * 3, s = Rr.s[i];
      const ry = Rr.yaw[i], fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
      const rp = new Vector3(Rr.P[k], Rr.P[k + 1], Rr.P[k + 2]);
      if (shot === 'mantaair') pos = tmp.copy(rp).add(new Vector3(-fx * 10 - rx * 6, 17, -fz * 10 - rz * 6));
      else if (view === 'below') pos = tmp.copy(rp).add(new Vector3(fx * s * 0.5 + rx * s * 0.5, -s * 1.3, fz * s * 0.5 + rz * s * 0.5));
      else if (view === 'front') pos = tmp.copy(rp).add(new Vector3(fx * s * 2.2 + rx * s * 0.5, s * 0.25, fz * s * 2.2 + rz * s * 0.5));
      else if (view === 'top') pos = tmp.copy(rp).add(new Vector3(-fx * s * 0.6, s * 1.7, -fz * s * 0.6));
      else pos = tmp.copy(rp).add(new Vector3(-rx * s * 1.9 + fx * s * 1.3, s * 0.45, -rz * s * 1.9 + fz * s * 1.3));
      look = rp.clone().add(new Vector3(fx * s * 0.15, 0, fz * s * 0.15));
      if (shot === 'mantaair') { pos.y = Math.max(pos.y, 12); }
    } else if (shot === 'surface' || shot === 'jellies') {
      pos = tmp.copy(actor.pos).addScaledVector(fwd, -camBack).add(new Vector3(0, -3, 0));
      look = new Vector3().copy(actor.pos).addScaledVector(fwd, lookAhead).add(new Vector3(0, shot === 'surface' ? 5 : 2, 0));
    } else {
      pos = tmp.copy(actor.pos).addScaledVector(fwd, -camBack).add(new Vector3(fwd.z * 2, camUp, -fwd.x * 2));
      look = new Vector3().copy(actor.pos).addScaledVector(fwd, lookAhead);
    }
    if (shot !== 'mantaair') pos.y = Math.min(pos.y, sea() - 0.8);
    if (first) { camPos.copy(pos); camLook.copy(look); first = false; }
    if (!p.has('free')) { dampVec3(camPos, pos, 4, dt); dampVec3(camLook, look, 5, dt); }
    game.focus.copy(actor.pos);
    void clamp;
  };
  game.focus.copy(center);
}

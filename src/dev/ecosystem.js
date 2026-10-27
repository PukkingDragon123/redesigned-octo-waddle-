// Dev scene: the living sky ecosystem over the cloud sea (y ~ 150).
// ?debug&test=ecosystem&shot=krill|rays|jellies|birds|plankton|song|wide&time=morning&dt=0.033&warp=4
// extras: &backlit (camera looks toward the sun)  &dist=N (camera distance)  &song (herd sings at the whale)
//         &threat (a falcon sweeps through)  &boom=T (sonic boom at time T)  &feed (a mouth lunges through the krill)
//         &leap (rays leap through a cloud now)
//         &nowhale  &noplankton  &close (tighter framing)  &yaw=deg (orbit the subject)
//         &inspect=ray|bird|jelly|krill&view=side|top|front|back|under|q&idx=N (follow one creature)
import { Vector3, Quaternion } from 'three';
import { Ecosystem } from '../creatures/Ecosystem.js';
import { Whale } from '../creatures/Whale.js';
import { MOTHER } from '../creatures/WhaleTypes.js';
import { G } from '../render/Globals.js';
import { rng, damp, dampVec3 } from '../core/math.js';

export default async function (game) {
  const p = game.params;
  const shot = p.get('shot') || 'wide';
  const r = rng(7);

  // ---- clouds -------------------------------------------------------------------------------
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = 380 + r() * 1300;
    const c = new Vector3(Math.cos(a) * d, 50 + r() * 120, Math.sin(a) * d - 200);
    game.clouds.cumulus(c, 140 + r() * 240, 70 + r() * 150, { seed: 100 + i });
  }
  const krillCloud = game.clouds.wisps(new Vector3(10, 146, -95), 55, 28, { seed: 11, moisture: 1 });
  game.clouds.cumulus(new Vector3(110, 112, -230), 120, 80, { seed: 31, moisture: 0.5 });
  game.clouds.wisps(new Vector3(-95, 158, -170), 50, 22, { seed: 12, moisture: 1 });
  game.clouds.cumulus(new Vector3(-160, 96, -60), 150, 70, { seed: 41 });

  // ---- a whale to roost on ---------------------------------------------------------------------
  let whale = null;
  if (!p.has('nowhale')) {
    whale = new Whale(MOTHER);
    whale.place(new Vector3(-30, 150, 10), Math.PI * 0.85);
    whale.vel.set(0, 0, -3);
    whale.furQuality = game.furQuality;
    game.engine.scene.add(whale.group);
    whale.model.castShadows(game.engine.shadows);
  }

  // ---- the ecosystem ---------------------------------------------------------------------------
  const eco = new Ecosystem(game, { plankton: !p.has('noplankton') });
  window.__eco = eco;
  const swarmA = eco.addKrillSwarm(new Vector3(10, 150, -70), 1200, { seed: 3, palette: 0 });
  eco.addKrillSwarm(new Vector3(-40, 146, -120), 700, { seed: 5, palette: 2 });
  eco.addKrillSwarm(new Vector3(70, 158, -50), 500, { seed: 9, palette: 1 });
  const school = eco.addRaySchool(new Vector3(40, 160, -120), 7, { seed: 4 });
  const jellies = eco.addJellies(new Vector3(-90, 160, -165), 38, 10, { seed: 2 });
  const flock = eco.addFlock(new Vector3(-10, 168, -10), 60, { seed: 8, restAfter: shot === 'birds' ? 3 : 14 });
  if (whale) {
    eco.roosts.push({ pos: whale.pos, up: whale.up, fwd: whale.fwd, L: whale.L });
  }
  if (p.has('song')) eco.songFocus = whale ? whale.pos : new Vector3(0, 150, -60);
  if (p.has('leap')) { school.leapT = 0; school.feedT = 1e9; }
  if (p.has('nofeed')) school.feedT = 1e9;

  // ---- camera --------------------------------------------------------------------------------
  const cam = game.engine.camera;
  const camPos = new Vector3(0, 175, 120);
  const camLook = new Vector3(0, 150, -90);
  let fov = +(p.get('fov') || 50);
  let first = true;
  const dist = p.has('dist') ? +p.get('dist') : null;
  const yawOff = ((+p.get('yaw') || 0) * Math.PI) / 180;
  const backlit = p.has('backlit');
  const sunH = () => {
    const s = G.uSunDir.value;
    const h = new Vector3(s.x, 0, s.z);
    return h.lengthSq() > 1e-4 ? h.normalize() : new Vector3(0, 0, -1);
  };
  const hOver = p.has('h') ? +p.get('h') : null;
  const orbit = (subject, d, h, baseDir) => {
    if (hOver !== null) h = hOver;
    const dir = baseDir.clone().applyAxisAngle(new Vector3(0, 1, 0), yawOff);
    if (backlit) dir.copy(sunH()).negate().applyAxisAngle(new Vector3(0, 1, 0), yawOff * 0.5 + 0.35);
    return subject.clone().addScaledVector(dir, d).add(new Vector3(0, h, 0));
  };
  const tmp = new Vector3();
  const inspect = p.get('inspect');
  const view = p.get('view') || 'q';
  const idx = +(p.get('idx') || 0);
  const VIEWS = {
    side: [1, 0.15, 0], top: [0.05, 1, -0.25], front: [0.15, 0.1, 1], back: [0.1, 0.25, -1],
    under: [0.2, -1, 0.2], q: [0.8, 0.45, 0.7], bq: [0.7, 0.35, -0.8],
  };
  const inspectFrame = () => {
    let c, q = new Quaternion(), size = 1;
    if (inspect === 'ray') {
      const ray = school.rays[idx % school.rays.length];
      c = ray.pos; q.copy(ray.quat); size = ray.scale * 2.4;
    } else if (inspect === 'bird') {
      const b = flock.birds[idx % flock.birds.length];
      c = b.pos.clone(); c.y += b.hop; q.copy(b.quat); size = 0.75 * b.scale;
    } else if (inspect === 'jelly') {
      const j = jellies.jellies[idx % jellies.jellies.length];
      c = j.pos.clone().add(new Vector3(0, -j.size * 0.6, 0)); q.copy(j.quat); size = j.size * 3.2;
    } else {
      const k = eco.krill;
      const i = swarmA.start + (idx % swarmA.count);
      c = new Vector3(k.P[i * 3], k.P[i * 3 + 1], k.P[i * 3 + 2]);
      const v = new Vector3(k.V[i * 3], k.V[i * 3 + 1], k.V[i * 3 + 2]).normalize();
      q.setFromUnitVectors(new Vector3(0, 0, 1), v);
      size = k.SEED[i * 4 + 1] * 2.6;
    }
    const o = new Vector3(...(VIEWS[view] || VIEWS.q)).normalize().multiplyScalar(size * (dist ?? 1)).applyQuaternion(q);
    return [c.clone().add(o), c.clone()];
  };
  const frame = (dt) => {
    let pos, look;
    if (inspect) {
      [pos, look] = inspectFrame();
      camPos.copy(pos); camLook.copy(look);
      fov = +(p.get('fov') || 40);
      game.focus.copy(camLook);
      return;
    }
    if (shot === 'krill') {
      // a section of the ribbon, close enough to read single krill
      const sw = swarmA;
      const near = eco.krill.nearest(tmp.copy(sw.center).add(new Vector3(sw.R * 1.5, 0, sw.R * 1.5)));
      const s = near ? near.pos : sw.center;
      look = s.clone();
      pos = orbit(s, dist ?? (p.has('close') ? 5 : 10), 1.5, new Vector3(0.75, 0, 0.65).normalize());
      fov = 46;
    } else if (shot === 'song') {
      const c = (eco.songFocus || swarmA.center).clone();
      look = c.clone();
      pos = orbit(c, dist ?? 80, 34, new Vector3(0.3, 0, 1).normalize());
      fov = 55;
    } else if (shot === 'plankton') {
      const c = krillCloud.center.clone().add(game.wind.drift);
      look = c.clone();
      pos = orbit(c, dist ?? 70, 6, new Vector3(0.3, 0, 1).normalize());
    } else if (shot === 'rays') {
      const c = new Vector3();
      for (const ray of school.rays) c.add(ray.pos);
      c.divideScalar(school.rays.length);
      look = c.clone();
      const back = school.leadFwd.clone().setY(0).normalize().negate();
      const side = new Vector3(-back.z, 0, back.x);
      const base = back.multiplyScalar(0.55).addScaledVector(side, 0.85).normalize();
      pos = orbit(c, dist ?? 30, 6, base);
    } else if (shot === 'jellies') {
      const c = jellies.home.clone();
      look = c.clone().add(new Vector3(0, 2, 0));
      pos = orbit(c, dist ?? 34, -9, new Vector3(0.7, 0, 0.7).normalize());
    } else if (shot === 'birds') {
      if (whale) {
        const back = whale.pos.clone().addScaledVector(whale.up, whale.L * 0.16).addScaledVector(whale.fwd, -1);
        look = back.clone().addScaledVector(whale.up, 0.4);
        const base = whale.right.clone().multiplyScalar(-1).addScaledVector(whale.fwd, -0.35).setY(0).normalize();
        pos = orbit(back, dist ?? 11, 4, base);
      } else {
        look = flock.centroid.clone();
        pos = orbit(look, dist ?? 25, 3, new Vector3(1, 0, 0.4).normalize());
      }
    } else {
      look = new Vector3(-10, 150, -95);
      pos = orbit(look, dist ?? 150, 30, new Vector3(0.25, 0, 1).normalize());
      fov = 52;
    }
    if (first) { camPos.copy(pos); camLook.copy(look); first = false; }
    dampVec3(camPos, pos, 2.5, dt);
    dampVec3(camLook, look, 4, dt);
    game.focus.copy(camLook);
  };
  game.cameraRig.update = () => {
    cam.position.copy(camPos);
    cam.lookAt(camLook);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  };

  // ---- scripted tests -------------------------------------------------------------------------
  const boomAt = p.has('boom') ? +p.get('boom') || 2 : -1;
  let boomed = false;
  const mouth = new Vector3();
  const lunge = { to: null, dir: null, t0: 0 };
  let eaten = 0;
  window.__ecoTest = { eaten: 0 };
  const threat = new Vector3();
  let wa = 0;
  game.devUpdate = (dt) => {
    const t = game.time;
    if (whale) {
      // a slow circle so the birds ride along
      wa += dt * 0.025;
      const tgt = new Vector3(-30 + Math.cos(wa) * 60 - 60, 150, 10 + Math.sin(wa) * 60);
      const to = tgt.sub(whale.pos);
      whale.ctl.targetYaw = Math.atan2(to.x, to.z);
      whale.ctl.targetPitch = 0;
      whale.ctl.thrust = Math.max(0, Math.min(1, (3 - whale.vel.length()) * 0.4 + 0.25));
      whale.drive.effort = 0.25;
      whale.drive.glide = 0.6;
      whale.step(dt);
      whale.animate(dt, cam.position);
      G.uMovers.value[0].set(whale.pos.x, whale.pos.y, whale.pos.z, whale.radius);
      G.uMoverVel.value[0].set(whale.vel.x, whale.vel.y, whale.vel.z, 0);
    }
    if (p.has('threat')) {
      const k = (t * 0.12) % 1;
      threat.set(-120 + k * 240, 175 - Math.sin(k * Math.PI) * 25, -10 + Math.sin(k * 6) * 20);
      eco.threat = threat;
    }
    if (boomAt >= 0 && !boomed && t >= boomAt) {
      boomed = true;
      eco.scatter(swarmA.center.clone(), 45, 1.2);
    }
    if (p.has('feed')) {
      // every 5 s: aim at the nearest dense part of the ribbon and lunge through it at 10 m/s
      const k = t % 5;
      if (k < dt * 1.5 || !lunge.to) {
        const from = swarmA.center.clone().add(new Vector3(Math.cos(t) * 30, 2, Math.sin(t) * 30));
        const ns = eco.nearestSwarm(from);
        if (ns) {
          lunge.to = ns.pos.clone();
          lunge.dir = ns.pos.clone().sub(from).normalize();
          lunge.t0 = t;
        }
      }
      if (lunge.to) {
        const s = (t - lunge.t0) * 10 - 15;
        if (s < 15) {
          mouth.copy(lunge.to).addScaledVector(lunge.dir, s);
          const n = eco.eat(mouth, 0.8, dt);
          eaten += n;
          window.__ecoTest.eaten = eaten;
          window.__ecoTest.mouth = mouth.toArray();
        }
      }
    }
    eco.update(dt);
    frame(dt);
  };
  game.focus.set(0, 150, -60);
}

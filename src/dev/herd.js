// Dev scene: the herd's bodies and social life over the sea of Vur Sok.
// ?debug&test=herd                     the whole herd travelling low over the sea; a scripted calf runs
//                                      into its mother, a playmate and the alpha in turn (bouncy contacts)
//   &calf=bump|follow|idle|roll|hum|dive  the calf's autopilot (default bump; dive: under until its air runs low)
//   &mode=travel|rest|feed             the herd mode (default travel)   &speed=<m/s> herd speed (default 4)
//   &s=<arc length>                    where on the migration path (default 300; &net defaults to 2700)
//   &net                               the spiral bubble-net hunt beneath a fish school (Feasting Shoals)
//   &eco                               a real glintfin bait ball (Ecosystem) for the net (slow headless)
//   &n=31                              add Oasis-gathering whales up to n in all (solver cost)   &hide (unrendered)
//   &cam=side|follow|top|net|wide|mom  camera        &state=<0..1> sea state      &time=<preset>
//   &shells=N  cap fur shells          &skin=<scale> bake scale (headless: small)
// window.__herd (the Herd), window.__herdLog (contacts and behaviour events), window.__herdStats().
import { Vector3 } from 'three';
import { Herd } from '../game/Herd.js';
import { waterStep } from '../game/Swim.js';
import { MigrationPath } from '../world/MigrationPath.js';
import { Whale } from '../creatures/Whale.js';
import { BAKE } from '../creatures/WhaleModel.js';
import { ADULTS, CALVES } from '../creatures/WhaleTypes.js';
import { clamp, damp, lerp, rng, TAU } from '../core/math.js';

export default async function (game) {
  const p = game.params;
  const s = game.engine.scene;
  if (p.has('skin')) BAKE.scale = +p.get('skin');
  if (!p.get('time')) game.atmosphere.set('morning');
  if (!game.ocean) {
    const { placeholderSea } = await import('../world/Water.js');
    placeholderSea(game);
  } else {
    if (game.cloudSea && game.cloudSea !== game.ocean) game.cloudSea.enabled = false;
    game.ocean.setSeaState?.(+(p.get('state') ?? 0.3), { dur: 0.01 });
  }
  const useNet = p.has('net');
  const path = new MigrationPath();
  const herd = new Herd(game, path, null);
  const log = [];
  window.__herdLog = log;
  herd.behaviors.log = log;
  herd.voiceHooks = (w, kind) => { log.push(`${game.time.toFixed(1)} voice ${w.name} ${kind}`); w.drive.hum = 1; setTimeout(() => (w.drive.hum = 0), 600); };
  herd.onSplash = (kind, pos, k) => log.push(`${game.time.toFixed(1)} splash ${kind} ${k.toFixed(2)}`);
  let contacts = 0;
  herd.physics.onContact = (a, b, pt, k) => {
    contacts++;
    log.push(`${game.time.toFixed(1)} contact ${a.name}-${b.name} k=${k.toFixed(2)}`);
    if (log.length > 400) log.splice(0, 100);
  };
  const s0 = +(p.get('s') ?? (useNet ? 2700 : 300));
  herd.placeAt(s0, { speed: 4 });
  herd.mode = p.get('mode') || (useNet ? 'feed' : 'travel');
  herd.targetSpeed = +(p.get('speed') ?? (useNet ? 2 : 4));
  herd.speed = herd.targetSpeed;
  if (p.has('shells')) for (const w of herd.whales) w.model.maxShells = Math.min(w.model.maxShells, +p.get('shells'));
  for (const w of herd.whales) w.model.prepare?.();

  // the Oasis gathering, for the solver's cost with 31 whales
  const extras = [];
  const want = +(p.get('n') || 0);
  if (want > herd.whales.length) {
    const r = rng(5);
    const center = herd.anchor;
    for (let i = 0; extras.length < want - herd.whales.length; i++) {
      const g = i % 4 === 3 ? CALVES[i % CALVES.length] : ADULTS[i % ADULTS.length];
      const w = new Whale(Object.assign({}, g, { name: `${g.name}-${i + 1}` }));
      const a = r() * TAU, rad = lerp(40, 120, r());
      w.orbit = { a, rad, h: lerp(10, 50, r()), speed: lerp(0.05, 0.12, r()) * (r() < 0.5 ? -1 : 1) };
      w.place(new Vector3(center.x + Math.cos(a) * rad, w.orbit.h, center.z + Math.sin(a) * rad), a);
      w.furQuality = game.furQuality * 0.5;
      if (p.has('hide')) { w.group.visible = false; w.collideHidden = true; }
      s.add(w.group);
      extras.push(w);
    }
    herd.extraWhales = extras;
  }

  // the bubble net beneath a school ahead of the herd
  let eco = null;
  const netC = path.pointAt(s0 + 60).setY(-9);
  if (useNet) {
    if (p.has('eco')) {
      try {
        const { Ecosystem } = await import('../creatures/Ecosystem.js');
        eco = new Ecosystem(game);
        eco.addFishSchool(netC.clone(), 'glintfin', +(p.get('fish') || 900), { seed: 3 });
        eco.feeders = herd.adults;
        herd.behaviors.eco = eco;
      } catch (e) { console.warn('[herd] ecosystem unavailable', e); }
    }
    setTimeout(() => {}, 0);
  }
  let netStarted = false;

  // the calf's autopilot: scripted bumps into its mother, a playmate and the alpha
  const calf = herd.calf, mom = herd.mother, mate = herd.calves[0], alpha = herd.adults.find((w) => w.genome.alpha) || herd.adults[3];
  const calfMode = p.get('calf') || (useNet ? 'follow' : 'bump');
  const order = [mom, mate, alpha, mate];
  const auto = { phase: 'approach', t: 0, k: 0, target: order[0] };
  const tgt = new Vector3(), away = new Vector3();
  const steerOpts = { arrive: 1, minSpeed: 6, pitchGain: 1, maxPitch: 0.7, sepScale: 0, touch: null };
  herd.physics.addListener((a, b) => {
    if (calfMode !== 'bump' || auto.phase !== 'approach') return;
    if ((a === calf && b === auto.target) || (b === calf && a === auto.target)) { auto.phase = 'back'; auto.t = 0; }
  });
  const driveCalf = (dt) => {
    auto.t += dt;
    if (calfMode === 'idle') {
      calf.ctl.thrust = 0;
      calf.drive.effort = 0;
      return;
    }
    if (calfMode === 'bump') {
      const o = auto.target;
      if (auto.phase === 'approach') {
        // (dev) the target stays put for the demo: no new games while the calf comes in
        if (auto.t < dt * 1.5 && o.beh && o.beh.type !== 'chasePlayer' && o.beh.type !== 'bumpBack') { herd.behaviors.end(o); o.beh.cd = 25; }
        // aim at the body's flank (between the axis middle and the head)
        o.nearestOnBody(calf.pos, tgt);
        tgt.addScaledVector(o.fwd, o.L * 0.08);
        steerOpts.touch = o;
        steerOpts.minSpeed = o.isCalf ? 6 : 8;
        herd.steer(calf, tgt, o.isCalf ? 10 : 11, dt, steerOpts);
        if (auto.t > 14) { auto.phase = 'back'; auto.t = 0; }
      } else {
        away.copy(calf.pos).sub(o.pos).setY(0).normalize();
        tgt.copy(calf.pos).addScaledVector(away, 20);
        tgt.y = Math.max(o.pos.y, herd.floorY(calf, tgt.x, tgt.z));
        steerOpts.touch = null;
        steerOpts.minSpeed = 2;
        herd.steer(calf, tgt, 6, dt, steerOpts);
        if (auto.t > 2.2) { auto.k = (auto.k + 1) % order.length; auto.target = order[auto.k]; auto.phase = 'approach'; auto.t = 0; }
      }
      return;
    }
    if (calfMode === 'dive') {
      // beside mother for 4 s, then down under the sea and held there until the air runs low
      const sea = herd.seaY(calf.pos.x, calf.pos.z);
      const under = auto.t > 4 && auto.t < 26;
      tgt.copy(calf.pos).addScaledVector(mom.fwd, 20);
      tgt.y = under ? sea - 7 : Math.max(mom.pos.y - 2, herd.floorY(calf, tgt.x, tgt.z));
      steerOpts.touch = mom;
      steerOpts.minSpeed = 2;
      herd.steer(calf, tgt, 7, dt, steerOpts);
      if (under && calf.water && calf.water.depth > 1) calf.vel.y -= (calf.phys.sink + 3.2 + (calf.pos.y - tgt.y) * 0.8) * dt * 0.9;
      if (auto.t > 40) auto.t = 0;
      return;
    }
    // follow / roll / hum: fly beside the mother
    tgt.copy(mom.pos).addScaledVector(mom.right, mom.radius + 6).addScaledVector(mom.fwd, 4);
    tgt.y = Math.max(tgt.y, herd.floorY(calf, tgt.x, tgt.z));
    steerOpts.touch = null;
    steerOpts.minSpeed = 0;
    herd.steer(calf, tgt, mom.vel.length() + 3, dt, steerOpts);
    if (calfMode === 'roll' && auto.t > 6) { auto.t = 0; calf.barrelRoll(1); }
    if (calfMode === 'hum' && auto.t > 6) { auto.t = 0; herd.calfHummed(); calf.drive.hum = 1; setTimeout(() => (calf.drive.hum = 0), 900); }
  };

  // camera
  const camMode = p.get('cam') || (useNet ? 'net' : 'side');
  const cam = game.engine.camera;
  const cp = new Vector3(), cl = new Vector3(), want3 = new Vector3(), wantL = new Vector3();
  let camInit = false;
  game.cameraRig.update = (dt) => {
    const o = auto.target || mom;
    if (camMode === 'follow') {
      want3.copy(calf.pos).addScaledVector(calf.fwd, -16).add(away.set(0, 6, 0));
      wantL.copy(calf.pos).addScaledVector(calf.fwd, 6);
    } else if (camMode === 'top') {
      wantL.copy(herd.anchor);
      want3.copy(wantL).add(away.set(30, 160, 40));
    } else if (camMode === 'wide') {
      wantL.copy(herd.anchor);
      want3.copy(wantL).add(away.set(150, 60, 90));
    } else if (camMode === 'net') {
      const N = herd.behaviors.net;
      wantL.copy(N ? N.center : netC);
      wantL.y = -4;
      want3.copy(wantL).add(away.set(70, 34, 52));
    } else if (camMode === 'mom') {
      wantL.copy(mom.pos).lerp(calf.pos, 0.5);
      want3.copy(mom.pos).addScaledVector(mom.right, mom.L * 1.4).add(away.set(0, 6, 0));
    } else {
      // side: frame the calf and whoever it is running into
      wantL.copy(calf.pos).lerp(o.pos, o.isCalf ? 0.45 : 0.25);
      const sep = calf.pos.distanceTo(o.pos);
      away.copy(o.pos).sub(calf.pos).setY(0);
      if (away.lengthSq() < 1e-3) away.set(1, 0, 0);
      away.normalize().set(-away.z, 0, away.x);
      want3.copy(wantL).addScaledVector(away, 9 + o.L * 0.55 + sep * 0.5);
      want3.y += 3 + o.L * 0.15;
    }
    if (!camInit) { cp.copy(want3); cl.copy(wantL); camInit = true; }
    cp.lerp(want3, 1 - Math.exp(-dt * 2));
    cl.lerp(wantL, 1 - Math.exp(-dt * 3));
    cam.position.copy(cp);
    cam.lookAt(cl);
  };

  const camPos = cam.position;
  const trace = [];
  window.__herdTrace = trace;
  let traceT = 0;
  game.devUpdate = (dt) => {
    // Game.warp simulates without aging particles: age them here so warped shots show the present
    if (game.frame === 0) { game.mist.update(dt); game.glow.update(dt); }
    traceT += dt;
    if (traceT > 0.5) {
      traceT = 0;
      const o = auto.target || mom;
      trace.push(`${game.time.toFixed(1)} ${auto.phase}>${o.name} d=${calf.pos.distanceTo(o.pos).toFixed(1)} cv=${calf.vel.length().toFixed(1)} ov=${o.vel.length().toFixed(1)} cy=${calf.pos.y.toFixed(1)}`);
      if (trace.length > 300) trace.shift();
    }
    if (useNet && !netStarted && game.time > 1) {
      netStarted = true;
      herd.startBubbleNet(eco ? (eco.nearestSwarm(netC)?.pos || netC) : netC);
    }
    driveCalf(dt);
    game.wind.sample(calf.pos, calf.wind).multiplyScalar(0.35);
    calf.step(dt);
    waterStep(calf, dt, game, { player: true });
    calf.animate(dt, camPos);
    // extras orbit the herd like the Oasis gathering
    const c = herd.anchor;
    for (const w of extras) {
      const o = w.orbit;
      o.a += o.speed * dt;
      tgt.set(c.x + Math.cos(o.a) * o.rad, o.h, c.z + Math.sin(o.a) * o.rad);
      herd.steer(w, tgt, w.isCalf ? 7 : 6, dt, { arrive: 20, minSpeed: 3 });
      w.step(dt);
    }
    herd.update(dt);
    for (const w of herd.whales) if (w !== calf) waterStep(w, dt, game);
    for (const w of extras) waterStep(w, dt, game);
    for (const w of herd.whales) if (w !== calf) w.animate(dt, camPos);
    for (const w of extras) if (w.group.visible) w.animate(dt, camPos);
    eco?.update(dt);
    game.focus.copy(calf.pos);
  };
  game.engine.shadows.radius = 160;
  window.__herd = herd;
  window.__herdStats = () => {
    const ps = herd.physics.stats;
    return {
      t: +game.time.toFixed(2),
      physics: { bodies: ps.bodies, pairs: ps.pairs, contacts: ps.contacts, events: ps.events, ms: +ps.ms.toFixed(3), msAvg: +ps.msAvg.toFixed(3), msMax: +ps.msMax.toFixed(3) },
      contacts,
      net: herd.behaviors.net ? { phase: herd.behaviors.net.phase, t: +herd.behaviors.net.t.toFixed(1), cycle: herd.behaviors.net.cycle } : null,
      whales: herd.whales.map((w) => `${w.name}:${w.beh?.netI >= 0 ? 'net' : w.beh?.type || '-'}@${w.pos.y.toFixed(1)}`).join(' '),
      care: herd.behaviors.careState.type,
      calf: auto.phase + '>' + (auto.target?.name || ''),
      nan: herd.whales.some((w) => !Number.isFinite(w.pos.x + w.pos.y + w.pos.z)),
    };
  };
}

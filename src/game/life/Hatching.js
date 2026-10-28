// ACT I opens with your hatching, filmed like a nature documentary (docs/VUR_SOK.md 0.7):
//   dawn aerials of Vur Sok and the Spiral Maelstrom, the herd circling it; the female lays a single
//   glowing egg in the calm eye and leaves to feed; the males circle and guard and drive off a
//   lanternjack (a tail slap, a boom); macro shots of the curled embryo and its heartbeat; a
//   time-lapse; the shell cracks; YOU HATCH (press to push out), swim up for your first breath, and
//   your mother returns with food. Then the Dawn Lagoon chapter takes over.
// The documentary part is skippable (hold any key); the push and the rise are the player's.
import { Vector3 } from 'three';
import { seaHeight } from '../Swim.js';
import { ACTS } from './text.js';
import { SPECIES, NARRATION as N } from './doc.js';
import { clamp, lerp } from '../../core/math.js';

const _v = new Vector3();
const _p = new Vector3();

/**
 * Where the maelstrom turns: open, deep water near the herd's resting place in the Dawn Lagoon
 * (the funnel, the egg beneath its eye and the calf's rise need ~25 m of sea). Found once.
 */
export function maelstromCenter(S, out = new Vector3()) {
  if (S._maelstrom) return out.copy(S._maelstrom);
  const bedAt = S.world.seabedAt ? (x, z) => S.world.seabedAt(x, z) : () => -200;
  const home = S.path.pointAt(110);
  const p = new Vector3();
  let best = null, bestScore = Infinity, deepest = null, deepBed = Infinity;
  for (let sA = 60; sA <= 700; sA += 40) {
    for (let lat = -240; lat <= 240; lat += 40) {
      S.path.offsetAt(sA, lat, 0, 0, p);
      // the whole eye and throat in deep water: sample the centre and a ring
      let bed = bedAt(p.x, p.z);
      for (let k = 0; k < 6; k++) bed = Math.max(bed, bedAt(p.x + Math.cos(k) * 45, p.z + Math.sin(k) * 45));
      if (bed < deepBed) { deepBed = bed; deepest = p.clone(); }
      if (bed > -26) continue;
      const score = Math.hypot(p.x - home.x, p.z - home.z);
      if (score < bestScore) { bestScore = score; best = p.clone(); }
    }
  }
  S._maelstrom = (best || deepest || home).clone().setY(0);
  return out.copy(S._maelstrom);
}

/** The herd's arc length beside the maelstrom (where it rests while the egg is guarded). */
export function maelstromS(S) {
  const c = maelstromCenter(S);
  const s = S.path.project ? S.path.project(c, 110, 1200).s : 110;
  return Math.max(30, s - 30);
}

/** Hide (or show again) the playmate calves: in the opening, there is only one egg. */
function calves(S, show) {
  const herd = S.herd;
  for (const c of herd.calves) {
    if (show) {
      if (c.docHidden) { c.docHidden = false; c.group.visible = true; herd.physics.add(c); }
    } else if (!c.docHidden) {
      c.docHidden = true;
      c.group.visible = false;
      herd.physics.remove(c);
    }
  }
}

export function restoreHatching(S) {
  calves(S, true);
  const calf = S.herd.calf;
  calf.group.scale.setScalar(1);
  S.life?.kin.delete(calf);
  if (calf.docHidden) { calf.docHidden = false; calf.group.visible = true; }
}

/**
 * The whole opening. opts.from: 'push' starts at the interactive hatching beat (?debug&hatch=push).
 */
export function* hatching(S, opts = {}) {
  const g = S.game, herd = S.herd, mom = herd.mother, calf = herd.calf, C = S.cine, life = S.life;
  const nur = life.nursery;
  S.act = 1;
  S.chapterIndex = 0; // the Dawn Lagoon (its chapter script starts after the first breath)
  S.populateEcosystem(0);
  g.atmosphere.set('dawn');
  S.audio.setMood?.('dawn', { fade: 6 });
  // the maelstrom and its calm eye, the herd resting beside it
  const c = maelstromCenter(S);
  herd.placeAt(maelstromS(S));
  herd.mode = 'rest';
  herd.targetSpeed = 0;
  nur.open(c, { radius: 120, depth: 7, spin: 0.22 });
  const eye = nur.eyeY();
  const bed = S.world.seabedAt ? S.world.seabedAt(c.x, c.z) : -60;
  let eggP = new Vector3(c.x, Math.max(eye - 6, bed + 3), c.z);
  // the calf is not born yet
  calves(S, false);
  life.kin.add(calf);
  calf.group.visible = false;
  calf.docHidden = true;
  calf.drive.sleep = 1;
  const holdCalf = () => { calf.pos.copy(eggP); calf.vel.set(0, 0, 0); calf._syncTransform?.(); };
  holdCalf();
  // the males circle the eye; the female waits in it
  const males = herd.adults.filter((w) => w !== mom);
  for (const w of males) w.drive.sleep = 0;
  nur.guard(males, 52);
  let momPhase = 0;
  const away = new Vector3();
  herd.motherScript = (m) => {
    if (momPhase === 0) {
      _p.set(c.x, nur.eyeY() - m.radius * 0.4, c.z);
      return { target: _p, speed: 4, arrive: 14, lookAt: eggP, face: eggP };
    }
    if (momPhase === 1) return { target: away, speed: 12, arrive: 30, minSpeed: 8, lookAt: away };
    // back with food, beside her calf
    _p.copy(calf.pos).addScaledVector(calf.right, -(m.radius + calf.radius + 2.5));
    _p.y = Math.max(_p.y, seaHeight(g, _p.x, _p.z) - m.radius * 0.5);
    return { target: _p, speed: 9, arrive: 16, lookAt: calf.pos };
  };
  mom.drive.sleep = 0;
  // mother placed in the eye from the start (the menu had her resting nearby)
  mom.place(_v.set(c.x + 30, eye - mom.radius * 0.3, c.z + 10), Math.atan2(c.x - mom.pos.x, c.z - mom.pos.z));
  let egg = null;
  const lay = () => {
    if (egg) return egg;
    egg = nur.layEgg(eggP);
    egg.setPulse?.(1.1);
    // follow the egg itself from now on (it rocks in the eye's current)
    if (egg.position) eggP = egg.position;
    return egg;
  };
  life.mark('hatch');
  let skippedPrologue = false;
  if (opts.from !== 'push') {
    // ---- the documentary prologue (skippable) ----
    C.begin({ hold: false, focus: c, rate: 0.3, snap: !!opts.snap });
    C.sway = 1;
    yield* C.wait(0.6);
    // 1. dawn over Vur Sok: a drone high above the turning sea
    C.card(ACTS[1]);
    const s1 = C.drone({ center: c, radius: [520, 380], height: [300, 210], angle: [0.6, 1.0], fov: 46, tilt: 0 });
    yield* C.play(s1, 5.5);
    C.hideCard();
    S.menu.hide();
    C.say(N.dawn, 5);
    yield* C.play(C.drone({ center: c, radius: [380, 300], height: [210, 150], angle: [1.0, 1.3], fov: 46 }), 6);
    // 2. long lens: the herd circling the vortex
    const alpha = males[0] || mom;
    C.setFocus(alpha);
    C.lower(SPECIES.whale, 5.5);
    C.say(N.vortex, 5.5);
    yield* C.play(C.longLens({ subject: alpha, dist: 300, angle: [2.2, 2.3], height: 4, fov: [13, 11] }), 6.5);
    // 3. the female in the eye lays her egg (slow motion)
    C.setFocus(mom);
    C.slowmo(0.6);
    C.say(N.lay, 5);
    let laid = false;
    yield* C.play(C.orbit({ center: mom, radius: [mom.L * 1.6, mom.L * 1.2], height: [mom.L * 0.4, mom.L * 0.1], angle: [0.4, 1.1], fov: [40, 36] }), 4.5, {
      onFrame: (k) => {
        if (!laid && k > 0.3) {
          laid = true;
          lay();
          S.audio.stinger?.('harmony');
          S.voiceCall(mom, 'coo');
          life.motes(eggP, 30, 4, [1.0, 0.85, 0.7], { rise: 0.5, life: 3 });
        }
        if (egg) egg.setGlow?.(lerp(0.2, 1, clamp(k * 1.6 - 0.5, 0, 1)));
      },
    });
    C.slowmo(1);
    lay();
    egg.setGlow?.(1);
    // 4. macro, under the water: the egg
    C.setFocus(eggP);
    C.lower(SPECIES.egg, 5);
    C.say(N.macro, 5.5);
    yield* C.play(C.macro({ subject: eggP, dist: [10, 8], angle: [0.3, 0.8], height: [3, 1.5], fov: [32, 28], under: true }), 6);
    // 5. she leaves to feed; the males stay
    momPhase = 1;
    away.copy(c).addScaledVector(_v.set(1, 0, 0.4).normalize(), 900).setY(eye + 40);
    S.voiceCall(mom, 'answer');
    C.setFocus(mom);
    C.say(N.leave, 4.8);
    yield* C.play(C.longLens({ subject: mom, dist: 220, angle: [-0.6, -0.5], height: 3, fov: [16, 20], lag: 1.2 }), 5);
    C.setFocus(alpha);
    C.lower(SPECIES.males, 5);
    C.say(N.guard, 5);
    yield* C.play(C.low({ subject: alpha, side: [30, 24], back: [-40, -20], height: 1.2, fov: [34, 30], lookUp: 2 }), 5.5);
    // 6. a hunter, drawn by the glow: a lanternjack rises from the deep; a guard drives it off
    if (!C.skipped) {
      const th = nur.spawnThreat('lanternjack', 2.4, 90, 6);
      C.lower(SPECIES.lanternjack, 5);
      C.say(N.threat, 4.5);
      // from behind the egg, under the water, looking out at the lure
      const watch = (k, t, s) => {
        s.pos.copy(eggP).addScaledVector(_v.copy(eggP).sub(th.pos).setY(0).normalize(), 7);
        s.pos.y = Math.min(eggP.y + 1.5, nur.eyeY() - 0.8);
        s.look.copy(th.pos).lerp(eggP, 0.25);
        s.fov = lerp(32, 26, k);
        s.roll = 0;
      };
      C.setFocus(th.pos);
      let sent = false, slapped = false;
      const guard = males[0];
      yield* C.play(watch, 7, {
        onFrame: (k, t) => {
          if (!sent && t > 2.5 && guard?.docGuard) { sent = true; guard.docGuard.target = th; S.voiceCall(guard, 'warn'); }
          if (!slapped && guard && guard.pos.distanceTo(th.pos) < guard.L * 0.9 + 12) {
            slapped = true;
            guard.anim.gesture?.('tailSlap');
          }
        },
        until: () => th.state === 'flee',
      });
      // the boom: a wall of sound through the water
      if (guard && !C.skipped) {
        C.say(N.driven, 4.5);
        guard.anim.blast?.(1);
        S.voiceCall(guard, 'roar');
        S.booms.spawn(guard.pos.clone().addScaledVector(guard.fwd, guard.L * 0.5), { power: 0.8, radius: 60, source: guard });
        nur.repel(th, guard.pos, guard);
        S.audio.sfx?.('boom', { position: guard.pos, gain: 0.9 });
        C.setFocus(guard);
        yield* C.play(C.rel({ subject: guard, side: [-34, -26], up: [4, 7], back: [-10, 6], ahead: 6, fov: 40, worldUp: true }), 4.5);
      }
      if (th.state !== 'flee') nur.repel(th, eggP);
    }
    // 7. time-lapse: days pass over the maelstrom
    C.setFocus(c);
    C.say(N.lapse, 5);
    C.timelapse(4);
    egg.setPulse?.(1.6);
    g.atmosphere.transition('noon', 5);
    let lapseStep = 0;
    yield* C.play(C.drone({ center: c, radius: [260, 300], height: [120, 160], angle: [2.2, 3.4], fov: 50 }), 26, {
      sway: 0,
      onFrame: (k) => {
        if (lapseStep === 0 && k > 0.2) { lapseStep = 1; g.atmosphere.transition('dusk', 5); }
        if (lapseStep === 1 && k > 0.42) { lapseStep = 2; g.atmosphere.transition('night', 4); }
        if (lapseStep === 2 && k > 0.62) { lapseStep = 3; g.atmosphere.transition('dawn', 6); egg.setPulse?.(2.1); }
      },
    });
    C.timelapse(1);
    g.atmosphere.transition('dawn', 3);
    // 8. one morning, the shell begins to give
    C.setFocus(eggP);
    C.say(N.crack, 4.5);
    let kicked = 0;
    yield* C.play(C.macro({ subject: eggP, dist: [8.5, 7], angle: [1.2, 1.5], height: [0.8, 0.3], fov: [30, 26], under: true }), 5, {
      onFrame: (k) => {
        if (kicked < 2 && k > 0.3 + kicked * 0.35) { kicked++; egg.embryo?.kick?.(); egg.crack?.(0.08 * kicked); g.cameraRig.addShake(0.08); }
      },
    });
    skippedPrologue = C.skipped;
    C.end({ release: false, rate: 2 });
  } else {
    lay();
    egg.setGlow?.(1);
    egg.setPulse?.(2.1);
    momPhase = 1;
    away.copy(c).addScaledVector(_v.set(1, 0, 0.4).normalize(), 900).setY(eye + 40);
    mom.place(_v.copy(c).addScaledVector(_v.set(1, 0, 0.4).normalize(), 600).setY(eye + 40), mom.yaw);
  }
  // make sure the documentary is over: the mother away, real time, dawn
  if (momPhase === 0) {
    momPhase = 1;
    away.copy(c).addScaledVector(_v.set(1, 0, 0.4).normalize(), 900).setY(eye + 40);
  }
  if (skippedPrologue || opts.from === 'push') { g.atmosphere.set('dawn'); S.menu.hide(); C.timelapse(1); }
  lay();
  egg.setPulse?.(2.2);
  egg.setGlow?.(1);
  // ---- YOU HATCH: push out of the egg (any key, click, button or touch) ----
  life.mark('push');
  C.begin({ hold: false, focus: eggP, rate: 2, skippable: false, letterbox: false, snap: true });
  C.say(N.push, 3.5);
  S.audio.setIntensity?.(0.35);
  const push = C.macro({ subject: eggP, dist: [8.5, 7], angle: [1.5, 1.9], height: [1.2, 0.5], fov: [34, 30], under: true });
  let crack = 0.16, pushes = 0, t = 0, lastPush = 0, hinted = false;
  egg.crack?.(crack);
  while (pushes < 4) {
    const dt = yield 0;
    t += dt;
    push(clamp(t / 16, 0, 1), t, C.shot);
    C.handheld(C.shot, 1.5);
    const auto = S.autoplay && t - lastPush > 1.2;
    if ((g.input.anyPressed && t - lastPush > 0.25) || auto || t - lastPush > 7) {
      lastPush = t;
      pushes++;
      crack = Math.min(1, crack + 0.24);
      egg.embryo?.kick?.();
      egg.crack?.(crack);
      g.cameraRig.addShake(0.18 + pushes * 0.06);
      S.audio.sfx?.('bonk', { position: eggP, gain: 0.35 + pushes * 0.1 });
      life.motes(eggP, 6, 3, [1.0, 0.88, 0.7], { rise: 0.6, life: 2 });
    }
    if (!hinted && t > 4 && pushes === 0) { hinted = true; C.say(N.push, 3); }
  }
  // the shell bursts
  egg.hatch?.();
  // the egg's own embryo makes way for the calf the player now steers
  if (egg.embryo?.mesh) egg.embryo.mesh.visible = false;
  S.audio.stinger?.('discover');
  g.cameraRig.addShake(0.5);
  life.motes(eggP, 40, 5, [1.0, 0.9, 0.75], { rise: 0.8, life: 3.5 });
  life.kin.delete(calf);
  calf.docHidden = false;
  calf.group.visible = true;
  calf.group.scale.setScalar(0.72);
  calf.place(_v.copy(eggP), Math.atan2(c.x - eggP.x + 1, c.z - eggP.z + 1));
  calf.pitch = 0.5;
  calf.drive.sleep = 0;
  calf.anim.blinkT = 0.2;
  calf.anim.flinch?.(0.6);
  S.voiceCall(calf, 'yawn');
  // the player's from here
  S.state = 'play';
  S.menu.hide();
  S.player.enabled = true;
  S.player.syncAim();
  S.player.aimPitch = 0.6;
  g.input.setGameplayMode(true);
  document.body.classList.add('playing');
  g.cameraRig.initialized = false;
  C.say(N.free, 4.5);
  C.end({ rate: 0.5, keepText: true });
  life.mark('rise');
  // ---- rise to the air ----
  life.autoGoal = () => _v.set(calf.pos.x + 2, seaHeight(g, calf.pos.x, calf.pos.z) + 3, calf.pos.z + 2);
  t = 0;
  let said = false;
  const surfaced = () => (S.calfWater ? S.calfWater.depth < calf.radius * 0.6 : calf.pos.y > seaHeight(g, calf.pos.x, calf.pos.z) - calf.radius);
  while (!surfaced() && t < 40) {
    const dt = yield 0;
    t += dt;
    if (!said && t > 4) { said = true; C.say(N.rise, 4.5); }
    // a helping current after a while: nobody stays down here
    if (t > 14) calf.vel.y += (t > 24 ? 3 : 1.2) * dt;
    calf.group.scale.setScalar(lerp(calf.group.scale.x, 0.8, dt * 0.2));
  }
  life.autoGoal = null;
  life.mark('breath');
  // ---- the first breath, in slow motion from the waterline ----
  const sy = seaHeight(g, calf.pos.x, calf.pos.z);
  calf.blow?.(g, 0.8);
  S.voiceCall(calf, 'chirp');
  S.audio.stinger?.('resolve');
  calf.drive.happy = 1;
  // the calf floats, breathing, while the camera watches (the controls come back after)
  S.player.enabled = false;
  C.begin({ focus: calf, rate: 1.4, hold: false });
  C.slowmo(0.45);
  C.say(N.breath, 4);
  C.lower(SPECIES.calf, 5);
  yield* C.play(C.low({ subject: calf, side: [7, 5.5], back: [-7, -4], height: [Math.max(0.5, sy - calf.pos.y + 0.5), 0.9], fov: [34, 30], lookUp: 0.5 }), 3.6);
  C.slowmo(1);
  // ---- the mother returns with food ----
  momPhase = 2;
  const back = _v.copy(calf.pos).addScaledVector(_p.set(1, 0, 0.4).normalize(), 110);
  back.y = seaHeight(g, back.x, back.z) + 14;
  mom.place(back, Math.atan2(calf.pos.x - back.x, calf.pos.z - back.z));
  const food = calf.pos.clone().addScaledVector(_p.set(-0.4, 0, 1).normalize(), 22);
  food.y = seaHeight(g, food.x, food.z) - 4;
  S.eco?.addFishSchool?.(food, 'glintfin', 220, { depth: 4 });
  C.setFocus(mom);
  C.lower(SPECIES.mother, 5);
  C.say(N.mother, 5);
  S.voiceCall(mom, 'answer');
  yield* C.play(C.longLens({ subject: mom, dist: 160, angle: [0.9, 1.0], height: 2, fov: [18, 24], lag: 1 }), 5.5);
  calf.drive.lookAt = mom.pos;
  C.setFocus(calf);
  yield* C.play(C.orbit({ center: calf, radius: [16, 12], height: [3, 1.5], angle: [calf.yaw + 2.2, calf.yaw + 2.7], fov: 38, look: calf }), 4, {
    onFrame: (k, tt) => { if (tt > 2 && !mom.docCooed) { mom.docCooed = true; S.voiceCall(mom, 'coo'); S.voiceCall(calf, 'chirp'); mom.drive.happy = 1; } },
  });
  mom.docCooed = false;
  C.say(N.migrate, 5);
  C.end({ rate: 0.6, keepText: true });
  S.player.enabled = S.state === 'play';
  S.player.syncAim();
  // the calf grows into its body over the first minutes
  S.script.run((function* () {
    let k = calf.group.scale.x;
    while (k < 0.999) { const dt = yield 0; k = Math.min(1, k + dt * 0.004); calf.group.scale.setScalar(k); }
  })(), 'grow');
  herd.motherScript = null;
  nur.unguard();
  nur.settle(4, 0.14);
  calves(S, true);
  life.mark('lagoon');
  S.startChapter(0, { fromIntro: true });
}


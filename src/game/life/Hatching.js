// ACT I opens with your hatching (docs/VUR_SOK.md 0.8: no text, short, seamless): about 25 s of
//   in-engine shots that glide into one another - the Spiral Maelstrom from above, the female laying
//   a single glowing egg in the calm eye, the males circling it while the days pass, the shell
//   cracking - then YOU HATCH (press to push out), swim up for your first breath, and your mother
//   comes back. Then the Dawn Lagoon chapter takes over.
// The prologue is skippable (hold any input); the push and the rise are the player's.
import { Vector3 } from 'three';
import { seaHeight } from '../Swim.js';
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
    // ---- the prologue (skippable): four shots, each gliding into the next ----
    C.begin({ hold: false, focus: c, rate: 0.3, snap: !!opts.snap });
    C.sway = 0.6;
    S.menu.hide();
    // 1. the maelstrom from above, the camera sinking toward its calm eye
    yield* C.play(C.drone({ center: c, radius: [420, 240], height: [260, 120], angle: [0.7, 1.15], fov: 46 }), 6.5);
    // 2. the female in the eye lays her egg (slow motion)
    C.setFocus(mom);
    C.slowmo(0.6);
    let laid = false;
    yield* C.play(C.orbit({ center: mom, radius: [mom.L * 1.6, mom.L * 1.25], height: [mom.L * 0.4, mom.L * 0.12], angle: [1.15, 1.7], fov: [40, 36] }), 4.5, {
      onFrame: (k) => {
        if (!laid && k > 0.25) {
          laid = true;
          lay();
          S.audio.stinger?.('harmony');
          S.voiceCall(mom, 'coo');
          life.motes(eggP, 30, 4, [1.0, 0.85, 0.7], { rise: 0.5, life: 3 });
        }
        if (egg) egg.setGlow?.(lerp(0.2, 1, clamp(k * 1.6 - 0.4, 0, 1)));
      },
    });
    C.slowmo(1);
    lay();
    egg.setGlow?.(1);
    // 3. she leaves to feed; the males circle the egg while the days pass (a time-lapse)
    momPhase = 1;
    away.copy(c).addScaledVector(_v.set(1, 0, 0.4).normalize(), 900).setY(eye + 40);
    S.voiceCall(mom, 'answer');
    const alpha = males[0] || mom;
    C.setFocus(c);
    C.timelapse(4);
    egg.setPulse?.(1.6);
    g.atmosphere.transition('dusk', 2.5);
    let lapseStep = 0;
    yield* C.play(C.orbit({ center: c, radius: [150, 120], height: [26, 16], angle: [1.7, 2.6], fov: [44, 40], look: alpha }), 7.5, {
      sway: 0,
      onFrame: (k) => {
        if (lapseStep === 0 && k > 0.3) { lapseStep = 1; g.atmosphere.transition('night', 2.5); }
        if (lapseStep === 1 && k > 0.6) { lapseStep = 2; g.atmosphere.transition('dawn', 3); egg.setPulse?.(2.1); }
      },
    });
    C.timelapse(1);
    g.atmosphere.transition('dawn', 2);
    // 4. one morning, the shell begins to give
    C.setFocus(eggP);
    let kicked = 0;
    yield* C.play(C.macro({ subject: eggP, dist: [9, 7.5], angle: [1.2, 1.5], height: [0.8, 0.4], fov: [30, 27], under: true }), 4.5, {
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
  C.begin({ hold: false, focus: eggP, rate: 0.8, skippable: false, snap: opts.from === 'push' });
  S.audio.setIntensity?.(0.35);
  const push = C.macro({ subject: eggP, dist: [8.5, 7], angle: [1.5, 1.9], height: [1.2, 0.5], fov: [34, 30], under: true });
  let crack = 0.16, pushes = 0, t = 0, lastPush = 0, hinted = false;
  egg.crack?.(crack);
  while (pushes < 3) {
    const dt = yield 0;
    t += dt;
    push(clamp(t / 16, 0, 1), t, C.shot);
    C.handheld(C.shot, 1.5);
    const auto = S.autoplay && t - lastPush > 1.2;
    if ((g.input.anyPressed && t - lastPush > 0.25) || auto || t - lastPush > 4) {
      lastPush = t;
      pushes++;
      crack = Math.min(1, crack + 0.3);
      egg.embryo?.kick?.();
      egg.crack?.(crack);
      g.cameraRig.addShake(0.18 + pushes * 0.06);
      S.audio.sfx?.('bonk', { position: eggP, gain: 0.35 + pushes * 0.1 });
      life.motes(eggP, 6, 3, [1.0, 0.88, 0.7], { rise: 0.6, life: 2 });
    }
    // no hint on screen: the embryo kicks on its own, as if asking for help
    if (!hinted && t > 2 && pushes === 0) { hinted = true; egg.embryo?.kick?.(); }
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
  C.end({ rate: 0.45 });
  life.mark('rise');
  // ---- rise to the air ----
  life.autoGoal = () => _v.set(calf.pos.x + 2, seaHeight(g, calf.pos.x, calf.pos.z) + 3, calf.pos.z + 2);
  t = 0;
  const surfaced = () => (S.calfWater ? S.calfWater.depth < calf.radius * 0.6 : calf.pos.y > seaHeight(g, calf.pos.x, calf.pos.z) - calf.radius);
  while (!surfaced() && t < 40) {
    const dt = yield 0;
    t += dt;
    // a helping current after a while: nobody stays down here
    if (t > 8) calf.vel.y += (t > 14 ? 3 : 1.4) * dt;
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
  C.begin({ focus: calf, rate: 0.7, hold: false });
  C.slowmo(0.5);
  yield* C.play(C.low({ subject: calf, side: [7, 5.5], back: [-7, -4], height: [Math.max(0.5, sy - calf.pos.y + 0.5), 0.9], fov: [34, 30], lookUp: 0.5 }), 3.2);
  C.slowmo(1);
  // ---- the mother returns with food ----
  momPhase = 2;
  const back = _v.copy(calf.pos).addScaledVector(_p.set(1, 0, 0.4).normalize(), 55);
  back.y = seaHeight(g, back.x, back.z) + 14;
  mom.place(back, Math.atan2(calf.pos.x - back.x, calf.pos.z - back.z));
  const food = calf.pos.clone().addScaledVector(_p.set(-0.4, 0, 1).normalize(), 22);
  food.y = seaHeight(g, food.x, food.z) - 4;
  S.eco?.addFishSchool?.(food, 'glintfin', 220, { depth: 4 });
  S.voiceCall(mom, 'answer');
  calf.drive.lookAt = mom.pos;
  C.setFocus(calf);
  yield* C.play(C.orbit({ center: calf, radius: [18, 13], height: [3, 1.5], angle: [calf.yaw + 2.2, calf.yaw + 2.7], fov: 40, look: calf }), 5, {
    onFrame: (k, tt) => { if (tt > 2.5 && !mom.docCooed) { mom.docCooed = true; S.voiceCall(mom, 'coo'); S.voiceCall(calf, 'chirp'); mom.drive.happy = 1; } },
  });
  mom.docCooed = false;
  C.end({ rate: 0.4 });
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


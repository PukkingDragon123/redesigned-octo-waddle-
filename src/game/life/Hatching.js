// ACT I opens with your hatching (docs/VUR_SOK.md 0.8: no text, short, seamless): about 25 s of
//   in-engine shots that glide into one another - the Spiral Maelstrom from above, the female laying
//   a single glowing egg in the calm eye, the males circling it while the days pass, the shell
//   cracking - then YOU HATCH (press to push out), swim up for your first breath, and your mother
//   comes back. Then the Dawn Lagoon chapter takes over.
// The prologue is skippable (hold any input); the push and the rise are the player's.
import { Vector3 } from 'three';
import { seaHeight } from '../Swim.js';
import { clamp, lerp, easeInOutSine } from '../../core/math.js';
import { reunion } from './Reunion.js';

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

const _a = new Vector3();
const _w = new Vector3();
const AX = { x: new Vector3(), y: new Vector3(), z: new Vector3(), crown: new Vector3() };

/**
 * Film one shot (fn(k, t, shot) as in Cinematics) until `until()` holds, or for dur seconds when
 * there is no condition; k eases over dur either way. onFrame(t, dt) runs after the shot is set.
 */
function* film(C, fn, dur, until = null, onFrame = null, maxT = 30, sway = null) {
  let t = 0;
  for (;;) {
    const dt = yield 0;
    t += dt;
    fn(easeInOutSine(clamp(t / dur, 0, 1)), t, C.shot);
    C.handheld(C.shot, sway ?? C.sway);
    onFrame?.(t, dt);
    if (until ? until() || t > maxT : t >= dur) break;
  }
}

/**
 * YOU HATCH (about 15-25 s, never failed): the player kicks the calf free with three wordless cues
 * the rest of the game reuses. Under water, in the egg's own frame:
 *   1. inside, close: the curled calf behind the membrane, its heart (the heartbeat is the cue's pulse)
 *   2. press: the first kick on the beat; a crack opens and light leaks in
 *   3. mash: frantic kicks, the shell flexing, cracks racing; a glimpse from beneath, the egg against
 *      the bright eye of the maelstrom with the guardians wheeling above
 *   4. hold: the head pushes through the crown, the membrane stretching as the lens creeps in
 *   5. the burst, in slow motion, the camera pulling back through the shards
 * A miss only makes a kick weaker (the calf finds its own way out a moment later).
 */
export function* kickFree(S, egg, eggAt) {
  const g = S.game, C = S.cine, Q = g.qte;
  const eggP = eggAt();
  const EB = (egg.width || (egg.length || 3.2) * 0.72) / 2;
  C.sway = 0.5;
  S.audio.setIntensity?.(0.3);
  egg.setPulse?.(1.3);
  egg.setGlow?.(0.9);
  let crack = Math.max(0.08, egg._crackTarget || 0);
  egg.crack?.(crack);
  // the egg's own frame: x along its length, y up, z across (the embryo's curl lies in x-y, so it
  // reads in silhouette along z); crown: where the cracks start
  const frame = () => {
    const q = egg.group?.quaternion;
    AX.x.set(1, 0, 0); AX.y.set(0, 1, 0); AX.z.set(0, 0, 1);
    if (q) { AX.x.applyQuaternion(q); AX.y.applyQuaternion(q); AX.z.applyQuaternion(q); }
    const cd = egg.uniforms?.uCrackDir?.value;
    if (cd && q) AX.crown.copy(cd).applyQuaternion(q).normalize(); else AX.crown.copy(AX.y);
    return AX;
  };
  const under = (s) => {
    const sea = seaHeight(g, s.pos.x, s.pos.z);
    if (s.pos.y > sea - 0.9) s.pos.y = sea - 0.9;
  };
  const R = (v, k) => (Array.isArray(v) ? lerp(v[0], v[1], k) : v);
  // a shot in the egg's frame: off/look are [x, y, z] offsets, each a value or [from, to]
  const eggShot = ({ off, look = [0, 0, 0], fov, roll = 0 }) => (k, t, s) => {
    const A = frame(), p = eggAt();
    s.pos.copy(p).addScaledVector(A.x, R(off[0], k)).addScaledVector(A.y, R(off[1], k)).addScaledVector(A.z, R(off[2], k));
    s.look.copy(p).addScaledVector(A.x, R(look[0], k)).addScaledVector(A.y, R(look[1], k)).addScaledVector(A.z, R(look[2], k));
    under(s);
    s.fov = R(fov, k);
    s.roll = R(roll, k);
  };
  const crownP = () => _w.copy(eggAt()).addScaledVector(frame().crown, EB * (1 + 0.18 * (egg._stretch || 0)));
  // bubbles squeezed out of the cracks (fine, clear, rising: src/render/Particles kind 4)
  const bubbles = (n, spread = 0.9) => {
    const mist = g.mist;
    if (!mist) return;
    const A = frame(), p = eggAt();
    for (let i = 0; i < n; i++) {
      _a.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(EB * spread);
      const bs = 0.006 + 0.032 * Math.random() ** 3;
      mist.emit({
        pos: _p.copy(p).addScaledVector(A.crown, EB * 0.95).add(_a), vel: _v.set((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 1.1, (Math.random() - 0.5) * 0.4),
        life: 6, size: bs, sizeEnd: bs * 1.3, color: [1, 1, 1], alpha: 0.85, drag: 1.6, gravity: 0, kind: 4, fadeIn: 0.05,
      });
    }
  };
  // one kick from inside: the bend runs down the body, the shell jolts, cracks run, light leaks
  const kick = (strength, add) => {
    crack = Math.min(0.9, crack + add);
    egg.embryo?.kick?.(strength);
    egg.crack?.(crack);
    egg.setGlow?.(1 + crack * 0.7, 0.25);
    g.cameraRig.addShake(0.05 + strength * 0.1);
    S.audio.sfx?.('bonk', { position: eggP, gain: 0.15 + strength * 0.12, pitch: 0.6 + crack * 0.3 });
    bubbles(3 + Math.round(strength * 5));
  };
  // a beat of hit-stop: time catches its breath on a good kick
  const hitStop = (k = 0.3, real = 0.28) => {
    C.slowmo(k);
    S.script.run((function* () {
      let t = 0;
      while (t < real) { yield 0; t += g.dtReal || 0.016; }
      if (C.slow === k) C.slowmo(1);
    })(), 'hitstop');
  };
  // the heart, felt (between cues; a cue brings its own pulse)
  let beatT = 0.2;
  const heart = (rate, gain = 0.45) => (t, dt) => {
    beatT -= dt;
    if (beatT <= 0) { beatT = 1 / rate; Q?.heartbeat?.(gain); }
  };

  // 1. inside, close: the curled calf behind the membrane
  yield* film(C, eggShot({ off: [[0.7, 0.35], [0.25, 0.1], [2.95, 2.6]], look: [[0.15, 0.05], 0, 0], fov: [31, 27] }), 2.6, null, heart(1.25, 0.4));
  // 2. the first kick, on the beat
  const close = eggShot({ off: [[0.35, 0.2], [0.1, 0.05], [2.6, 2.45]], look: [0.05, 0.05, 0], fov: [27, 25.5] });
  let weak = 0;
  const hP = Q ? Q.press({ at: eggAt, lead: 1.5, window: 0.45, retry: 2, onMiss: (h, again) => { if (again) { egg.embryo?.kick?.(0.45); weak++; } } }) : { done: true, ok: true };
  yield* film(C, close, 6, () => hP.done, null, 14);
  if (hP.ok) { kick(1.5, 0.2); hitStop(); } else kick(0.8, 0.12);
  // the crack takes the light in
  yield* film(C, eggShot({ off: [[0.2, 0.0], [0.05, 0.15], [2.45, 2.25]], look: [0.05, [0.05, 0.35], 0], fov: [25.5, 24] }), 0.9);
  // 3. frantic kicks: the profile, then a glimpse from beneath
  const profile = eggShot({ off: [[1.4, 0.7], [0.5, 0.7], [5.4, 4.5]], look: [0, 0.15, 0], fov: [35, 31], roll: [0.03, -0.02] });
  const below = (k, t, s) => {
    const A = frame(), p = eggAt();
    _a.copy(A.z).setY(0);
    if (_a.lengthSq() < 1e-4) _a.set(1, 0, 0);
    _a.normalize();
    s.pos.copy(p).addScaledVector(_a, lerp(15, 12.5, k)).addScaledVector(AX.x, lerp(-3, -1, k));
    s.pos.y += lerp(-7.5, -6.2, k);
    s.look.copy(p);
    s.look.y += lerp(1.6, 1.0, k);
    s.fov = lerp(42, 37, k);
    s.roll = lerp(0.05, 0.01, k);
  };
  let idle = 0;
  const hM = Q ? Q.mash({ at: eggAt, need: 12, time: 7, onPress: (h) => { idle = 0; kick(0.55 + h.progress * 0.75, 0.045); } }) : { done: true, ok: true, progress: 1 };
  let shot = profile, tS = 0, glimpse = false;
  while (!hM.done) {
    const dt = yield 0;
    tS += dt;
    idle += dt;
    if (!glimpse && hM.progress >= 0.5) { glimpse = true; shot = below; tS = 0; }
    shot(easeInOutSine(clamp(tS / (glimpse ? 2.6 : 4), 0, 1)), tS, C.shot);
    C.handheld(C.shot, 1.4);
    egg.setPulse?.(1.6 + hM.progress * 1.1);
    // left alone, the calf keeps trying by itself, weaker (it never stays shut in)
    if (idle > 1.3) { idle = 0; kick(0.35, 0.02); }
  }
  if (!hM.ok) {
    // the softer way out: a few tired kicks of its own
    for (let i = 0; i < 3; i++) {
      kick(0.6, Math.max(0, (0.62 - crack) / 3));
      for (let w = 0; w < 0.55;) {
        const dt = yield 0;
        w += dt;
        tS += dt;
        shot(easeInOutSine(clamp(tS / (glimpse ? 2.6 : 4), 0, 1)), tS, C.shot);
        C.handheld(C.shot, 1.4);
      }
    }
  } else hitStop(0.4, 0.22);
  crack = Math.max(crack, 0.66);
  egg.crack?.(crack);
  // 4. the head through the crown
  let fillK = 0;
  const crown = (k, t, s) => {
    const A = frame();
    const cp = crownP();
    s.pos.copy(cp).addScaledVector(A.crown, lerp(1.7, 0.95, fillK)).addScaledVector(A.z, lerp(2.7, 1.8, fillK)).addScaledVector(A.x, lerp(0.6, 0.3, k));
    s.look.copy(cp).addScaledVector(A.crown, -0.15);
    under(s);
    s.fov = lerp(32, 23, fillK) + (1 - k) * 2;
    s.roll = lerp(-0.03, 0.02, fillK);
  };
  let pushT = 0;
  const hH = Q ? Q.hold({ at: crownP, time: 1.7, grace: 4 }) : { done: true, ok: true, progress: 1 };
  yield* film(C, crown, 2.5, () => hH.done, (t, dt) => {
    fillK += ((hH.progress ?? 1) - fillK) * Math.min(1, dt * 3);
    egg.stretch?.(hH.progress);
    egg.setPulse?.(2.2 + hH.progress * 1.4);
    egg.setGlow?.(1.4 + hH.progress * 0.6, 0.3);
    pushT -= dt;
    if (hH.progress > 0.05 && pushT <= 0) { pushT = 0.42; egg.embryo?.kick?.(0.25 + hH.progress * 0.4); bubbles(2, 0.5); }
  }, 14, 1.0);
  if (!hH.ok) {
    // one last push of its own
    egg.stretch?.(0.7);
    yield* film(C, crown, 1, null, (t, dt) => { fillK = lerp(fillK, 0.7, Math.min(1, dt * 3)); });
  }
  egg.stretch?.(1);
  fillK = 1;
  yield* film(C, crown, 0.22);
  // 5. the burst, in slow motion: the lens pulls back through the shards
  const A0 = frame();
  const from = _p.copy(C.shot.pos), fromLook = _a.copy(C.shot.look);
  const fromP = from.clone(), fromL = fromLook.clone();
  egg.hatch?.();
  C.slowmo(0.22);
  S.audio.stinger?.('discover');
  g.cameraRig.addShake(0.45);
  Q?.rumble?.(1, 0.8, 450);
  if (Q) Q.punch = 1;
  const out = new Vector3().copy(eggAt()).addScaledVector(A0.z, 7.2).addScaledVector(A0.crown, 1.6).addScaledVector(A0.x, -1.2);
  yield* film(C, (k, t, s) => {
    s.pos.copy(fromP).lerp(out, k);
    s.look.copy(fromL).lerp(eggAt(), k * 0.7);
    under(s);
    s.fov = lerp(24, 38, k);
    s.roll = lerp(0.02, 0, k);
  }, 0.62, null, null, 0, 0.6);
  C.slowmo(0.5);
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
  const jump = opts.from === 'push' || opts.from === 'hug'; // ?debug&hatch=push|hug
  if (!jump) {
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
  if (skippedPrologue || jump) { g.atmosphere.set('dawn'); S.menu.hide(); C.timelapse(1); }
  lay();
  egg.setPulse?.(2.2);
  egg.setGlow?.(1);
  // ---- YOU HATCH: kick yourself free (wordless cues, src/game/QTE.js: press, mash, hold) ----
  life.mark('push');
  C.begin({ hold: false, focus: eggP, rate: 0.8, skippable: false, snap: jump });
  if (opts.from === 'hug') egg.hatch?.();
  else yield* kickFree(S, egg, () => eggP);
  // the egg's own embryo makes way for the calf the player now steers (behind the flash and the
  // shards, as it uncurls and swims out)
  const born = egg.embryoPosition ? egg.embryoPosition(new Vector3()) : eggP.clone();
  const bornDir = new Vector3(1, 0, 0).applyQuaternion(egg.group?.quaternion || calf.group.quaternion);
  if (egg.embryo?.mesh) egg.embryo.mesh.visible = false;
  life.motes(eggP, 16, 4, [1.0, 0.9, 0.75], { rise: 0.8, life: 3.5 });
  life.kin.delete(calf);
  calf.docHidden = false;
  calf.group.visible = true;
  calf.group.scale.setScalar(0.72);
  calf.place(born, Math.atan2(bornDir.x, bornDir.z));
  calf.vel.copy(bornDir).multiplyScalar(2.5).setY(1.2);
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
  if (opts.from === 'hug') { calf.pos.y = seaHeight(g, calf.pos.x, calf.pos.z) - calf.radius * 0.3; calf._syncTransform?.(); }
  let t = 0;
  const surfaced = () => (S.calfWater ? S.calfWater.depth < calf.radius * 0.6 : calf.pos.y > seaHeight(g, calf.pos.x, calf.pos.z) - calf.radius);
  // the fourth cue: a brushed chevron pointing up to the light (steer that way)
  let up = null;
  while (!surfaced() && t < 40) {
    const dt = yield 0;
    t += dt;
    if (!up && t > 1 && g.qte) {
      up = g.qte.steer({ dir: _p.set(0, 1, 0).clone(), from: calf, time: 7, tol: 0.75, size: 0.9 });
    }
    if (up && up.done && up.ok && !up.boosted) { up.boosted = true; calf.vel.y += 2.5; S.voiceCall(calf, 'chirp'); }
    // a helping current after a while: nobody stays down here
    if (t > 8) calf.vel.y += (t > 14 ? 3 : 1.4) * dt;
    calf.group.scale.setScalar(lerp(calf.group.scale.x, 0.8, dt * 0.2));
  }
  life.autoGoal = null;
  up?.cancel?.();
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
  // ---- the mother returns: the embrace and the first meal (src/game/life/Reunion.js) ----
  momPhase = 2;
  const food = calf.pos.clone().addScaledVector(_p.set(-0.4, 0, 1).normalize(), 22);
  food.y = seaHeight(g, food.x, food.z) - 4;
  S.eco?.addFishSchool?.(food, 'glintfin', 220, { depth: 4 });
  calf.drive.lookAt = mom.pos;
  C.sway = 0.8;
  yield* reunion(S, { from: _p.set(1, 0, 0.4).normalize().clone() });
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


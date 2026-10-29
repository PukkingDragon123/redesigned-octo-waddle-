// The mother comes back (docs/VUR_SOK.md 0.8 / 0.11: wordless, filmed, seamless): right after the
// calf's first breath she glides down to it, curls her whole body round it and folds both front
// flippers over it, the two of them humming; the calf may nuzzle back (a hold cue, src/game/QTE.js)
// and her eye softens. Then its first meal from her mouth: she offers krill in a slow rhythm and
// each offering is a press cue at the calf's lips (a hit is a gulp, a miss lets the morsels drift
// away). The calf ends content against her, and the herd moves on into the Dawn Lagoon.
//
//   yield* reunion(S);   // inside an active cinematic (Hatching.js), the calf just surfaced
// Holding any input outside a cue skips it (the meal is given anyway); ?auto always succeeds.
import { Vector3 } from 'three';
import { seaHeight } from '../Swim.js';
import { clamp, lerp, easeInOutSine } from '../../core/math.js';

const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const UP = new Vector3(0, 1, 0);
const KRILL = { pos: new Vector3(), vel: new Vector3(), life: 1, size: 0.05, sizeEnd: 0.03, alpha: 0.95, drag: 1.2, gravity: 0.4, kind: 10, color: [0.95, 0.5, 0.45], fadeIn: 0.04 };

function* film(C, fn, dur, until = null, onFrame = null, maxT = 30) {
  let t = 0;
  for (;;) {
    const dt = yield 0;
    t += dt;
    fn(easeInOutSine(clamp(t / dur, 0, 1)), t, C.shot);
    C.handheld(C.shot, C.sway);
    onFrame?.(t, dt);
    if (C.skipped) break;
    if (until ? until() || t > maxT : t >= dur) break;
  }
}

export function* reunion(S, opts = {}) {
  const g = S.game, C = S.cine, Q = g.qte, herd = S.herd, mom = herd.mother, calf = herd.calf, life = S.life;
  // the newborn is still small (Hatching grows it into its body over the first minutes)
  const cs = calf.group.scale.x || 1;
  const L = mom.L, cL = calf.L * cs, cR = calf.radius * cs;
  const sea = (p) => seaHeight(g, p.x, p.z);
  // where the calf floats after its first breath: the pair settles there
  const anchor = calf.pos.clone();
  anchor.y = sea(anchor) - cR * 0.25;
  // she comes in from up-sun and low over the sea, gliding down to it
  const from = opts.from || new Vector3(1, 0, 0.4).normalize();
  const start = _v.copy(anchor).addScaledVector(from, 60);
  start.y = sea(start) + 12;
  mom.place(start, Math.atan2(anchor.x - start.x, anchor.z - start.z));
  mom.vel.copy(anchor).sub(start).setLength(10);
  const hd = new Vector3().copy(anchor).sub(start).setY(0).normalize(); // her heading as she settles
  const side = opts.side ?? 1; // the calf on her right
  const perp = new Vector3().crossVectors(hd, UP).normalize(); // her right, once settled
  // spots on her body (live: she drifts and breathes)
  const hugSpot = (out, k = 0) => out.copy(mom.pos).addScaledVector(mom.right, side * (0.13 * L + cR * (0.95 - 0.25 * k)))
    .addScaledVector(mom.fwd, 0.2 * L).addScaledVector(mom.up, -0.04 * L);
  const cheek = (out) => out.copy(mom.pos).addScaledVector(mom.right, side * (0.16 * L + cR)).addScaledVector(mom.fwd, 0.37 * L).addScaledVector(mom.up, -0.03 * L);
  const mouthM = (out) => out.copy(mom.pos).addScaledVector(mom.fwd, 0.46 * L).addScaledVector(mom.up, -0.03 * L).addScaledVector(mom.right, side * 0.06 * L);
  const calfMouth = (out) => out.copy(calf.pos).addScaledVector(calf.fwd, cL * 0.48);
  const eyeP = (out) => out.copy(mom.pos).addScaledVector(mom.fwd, L * 0.33).addScaledVector(mom.up, L * 0.04).addScaledVector(mom.right, side * L * 0.08);
  // her mark: the spot on her lands on the anchor, level on the sea, facing on along hd
  const want = new Vector3();
  const face = new Vector3();
  let settle = 0;
  herd.motherScript = (m) => {
    hugSpot(_a, 0).sub(m.pos); // the spot's offset from her centre
    want.copy(anchor).sub(_a);
    want.y = sea(want) - m.radius * 0.3;
    const d = m.pos.distanceTo(want);
    face.copy(m.pos).addScaledVector(hd, 200);
    return { target: want, speed: d > 30 ? 11 : Math.max(1.2, d * 0.45), arrive: 5, minSpeed: 0, lookAt: calf.pos, face: d < 25 ? face : null, maxPitch: 0.35 };
  };
  mom.drive.sleep = 0;
  S.voiceCall(mom, 'answer');
  // the calf: posed by the scene from here (it floats, turns to her, is drawn in)
  life.kin.add(calf);
  herd.physics.remove?.(calf);
  S.player.enabled = false;
  let nest = 0; // 0 floating at the anchor .. 1 held against her
  let deep = 0;
  let tPose = 0;
  const cpos = new Vector3().copy(calf.pos);
  const calfLook = new Vector3();
  const poseCalf = (dt, target, faceTo) => {
    tPose += dt;
    _b.copy(target);
    _b.y += Math.sin(tPose * 1.3) * 0.06;
    cpos.lerp(_b, 1 - Math.exp(-dt * 3));
    _a.copy(faceTo).sub(cpos);
    _a.y *= 0.4;
    life.pose(calf, cpos, dt, _a.lengthSq() > 1e-4 ? _a : calf.fwd);
    calf.drive.lookAt = calfLook.copy(faceTo);
  };

  // ---- 1. she glides down to her calf (a low shot over the water, the calf in the foreground) ----
  calf.drive.happy = 1;
  let cooed = false;
  const low = (k, t, s) => {
    s.pos.copy(anchor).addScaledVector(hd, lerp(10, 8, k)).addScaledVector(perp, -side * lerp(5, 6.5, k));
    s.pos.y = sea(s.pos) + lerp(0.9, 0.7, k);
    s.look.copy(calf.pos).lerp(mom.pos, lerp(0.55, 0.4, k));
    s.look.y += 0.6;
    s.fov = lerp(40, 34, k);
    s.roll = 0;
  };
  yield* film(C, low, 6, () => mom.pos.distanceTo(want) < 4 + L * 0.08, (t, dt) => {
    poseCalf(dt, anchor, mom.pos);
    if (!cooed && mom.pos.distanceTo(anchor) < 30) { cooed = true; S.voiceCall(calf, 'chirp'); }
  }, 9);
  // ---- 2. the embrace: she curls round it, flippers folding over; both hum ----
  life.mark('hug');
  mom.anim.gesture?.('hug', { side, dur: 30 });
  const hugG = mom.anim.gest && mom.anim.gest.name === 'hug' ? mom.anim.gest : null;
  S.voiceCall(mom, 'coo');
  const key = S.audio.getKey?.() || { rootMidi: 62 };
  let hummed = 0;
  const hum = (t) => {
    if (hummed === 0 && t > 0.4) { hummed = 1; S.voiceHum?.(mom, key.rootMidi - 12, 5.5); Q?.rumble?.(0.25, 0.1, 900); }
    if (hummed === 1 && t > 1.3) { hummed = 2; S.voiceHum?.(calf, key.rootMidi + 7, 4); }
  };
  // from above: her body bending into a C round the calf, the flippers closing over it
  const crane = (k, t, s) => {
    hugSpot(_a, nest);
    _b.copy(mom.pos).lerp(_a, 0.55);
    s.pos.copy(_b).addScaledVector(UP, lerp(0.95 * L, 0.72 * L, k) - deep * 0.08 * L).addScaledVector(hd, -lerp(0.32, 0.22, k) * L).addScaledVector(perp, side * 0.12 * L);
    s.look.copy(_b);
    s.fov = lerp(40, 33, k) - deep * 2;
    s.roll = side * 0.05;
  };
  let tH = 0;
  yield* film(C, crane, 7, () => tH > 2.2, (t, dt) => {
    tH = t;
    nest = Math.min(1, nest + dt * 0.5);
    hugSpot(_a, nest * 0.6);
    poseCalf(dt, _b.copy(anchor).lerp(_a, nest), eyeP(_v));
    hum(t);
  });
  // nuzzle back (hold): the calf presses into her; her eye softens
  let tN = 0;
  const hN = Q && !C.skipped ? Q.hold({ at: () => calf.pos, time: 2.2, grace: 5, size: 0.9 }) : { done: true, ok: false, progress: 0 };
  yield* film(C, crane, 7, () => hN.done, (t, dt) => {
    deep += ((hN.progress ?? 0) - deep) * Math.min(1, dt * 2.5);
    if (hugG) hugG.deep = deep;
    nest = 1;
    hugSpot(_a, 0.6 + deep * 0.4);
    poseCalf(dt, _a, eyeP(_v));
    hum(t + 2.2);
    tN -= dt;
    if (deep > 0.15 && tN <= 0 && !calf.anim.gest) { tN = 1.2; calf.anim.gesture?.('nuzzle', { side: -side }); }
    calf.drive.happy = Math.max(calf.drive.happy || 0, deep);
    mom.drive.happy = Math.max(mom.drive.happy || 0, 0.4 + deep * 0.6);
  }, 9);
  if (hN.ok) {
    S.voiceCall(mom, 'coo');
    life.motes(_v.copy(calf.pos).lerp(mom.pos, 0.3), 6, 3, [1.0, 0.85, 0.65], { rise: 0.3, life: 2.5, size: 0.12 });
  }
  if (hugG) hugG.deep = hN.ok ? 1 : 0.4;
  // her eye, close: it softens and half-closes, the calf's soft flank beside it
  const eye = (k, t, s) => {
    eyeP(_a);
    s.pos.copy(_a).addScaledVector(mom.right, side * L * lerp(0.3, 0.24, k)).addScaledVector(mom.fwd, L * 0.16).addScaledVector(mom.up, L * lerp(0.1, 0.07, k));
    s.look.copy(_a).addScaledVector(mom.right, side * L * 0.02);
    s.fov = lerp(30, 26, k);
    s.roll = 0;
  };
  yield* film(C, eye, hN.ok ? 3.2 : 2.2, null, (t, dt) => {
    hugSpot(_a, hN.ok ? 1 : 0.6);
    poseCalf(dt, _a, eyeP(_v));
  });

  // ---- 3. the first meal: from her mouth, gulp by gulp, in her rhythm ----
  life.mark('feed');
  // she eases the hug (the gesture releases over ~1.8 s) and turns her mouth to it
  if (hugG && mom.anim.gest === hugG) hugG.dur = Math.max(hugG.t + 1.8, hugG.t / 0.7);
  const mid = new Vector3();
  const two = (k, t, s) => {
    mouthM(_a);
    calfMouth(_b);
    mid.copy(_a).lerp(_b, 0.5);
    s.pos.copy(mid).addScaledVector(mom.right, side * cL * lerp(1.9, 1.5, k)).addScaledVector(mom.fwd, cL * lerp(1.3, 1.0, k)).addScaledVector(UP, cL * 0.3);
    s.look.copy(mid);
    s.fov = lerp(38, 31, k);
    s.roll = 0;
  };
  const faceCalf = (k, t, s) => {
    // the calf's face, close, from its outer side: the gulps
    const p = calfMouth(_a);
    s.pos.copy(p).addScaledVector(calf.right, side * cL * lerp(0.95, 0.8, k)).addScaledVector(calf.fwd, cL * 0.35).addScaledVector(UP, cL * 0.18);
    s.look.copy(p).addScaledVector(calf.fwd, -cL * 0.15);
    s.fov = lerp(32, 28, k);
    s.roll = 0;
  };
  let shot = two, tShot = 0;
  const toMouth = (dt) => {
    cheek(_a);
    poseCalf(dt, _a, mouthM(_v));
  };
  const stepShot = (dt, dur) => {
    tShot += dt;
    shot(easeInOutSine(clamp(tShot / dur, 0, 1)), tShot, C.shot);
    C.handheld(C.shot, C.sway);
  };
  // she draws it to her lips
  for (let t = 0; t < 1.6 && !C.skipped;) {
    const dt = yield 0;
    t += dt;
    toMouth(dt);
    stepShot(dt, 9);
    mom.drive.mouth = lerp(mom.drive.mouth || 0, 0.25, Math.min(1, dt * 3));
  }
  const leads = [1.25, 1.1, 1.0, 0.9, 0.85];
  let gulps = 0;
  for (let i = 0; i < leads.length && !C.skipped; i++) {
    if (i === 3) { shot = faceCalf; tShot = 0; }
    // her offering: the jaw parts, a mouthful of krill tumbles toward the calf's lips
    const lead = leads[i];
    const h = Q ? Q.press({ at: () => calfMouth(_b), lead, window: 0.4, size: 0.8 }) : { done: false, ok: true };
    let t = 0, emitT = 0, drift = false;
    while (!h.done && !C.skipped) {
      const dt = yield 0;
      t += dt;
      toMouth(dt);
      stepShot(dt, shot === two ? 9 : 5);
      // the mouth opens toward the beat
      const open = clamp(t / lead, 0, 1);
      mom.drive.mouth = lerp(0.2, 0.55, open);
      mom.drive.feed = 0.5;
      calf.drive.mouth = Math.max(calf.drive.mouth || 0, 0.25 + 0.35 * open);
      emitT -= dt;
      if (emitT <= 0 && t > lead * 0.35) { emitT = 0.04; krill(g, mouthM(_a), calfMouth(_v), mom, side, false); }
      if (!Q && t > lead) { h.done = true; }
    }
    if (C.skipped) break;
    if (h.ok) {
      gulps++;
      calf.anim.snap?.(0.85);
      calf.anim.gulp?.(1);
      S.audio.sfx?.('gulp', { position: calfMouth(_v), gain: 0.5, pitch: 1.15 });
      S.needs?.feed?.(0.07);
      calf.drive.happy = 1;
      g.cameraRig.addShake(0.03);
    } else {
      // too early or too late: the morsels drift away, the calf snaps at the empty water
      drift = true;
      calf.anim.snap?.(0.3);
      for (let k = 0; k < 14; k++) krill(g, mouthM(_a), calfMouth(_v), mom, side, true);
      if (i === 1) S.voiceCall(mom, 'coo'); // patient: again
    }
    // a breath between offerings: she closes and chews the rhythm
    for (let w = 0; w < (drift ? 0.7 : 0.45) && !C.skipped;) {
      const dt = yield 0;
      w += dt;
      toMouth(dt);
      stepShot(dt, shot === two ? 9 : 5);
      mom.drive.mouth = lerp(mom.drive.mouth, 0.15, Math.min(1, dt * 6));
    }
  }
  if (C.skipped) { Q?.clear?.(); S.needs?.feed?.(0.3); }
  // ---- 4. content: a wriggle, a coo, the lens rising away as the herd stirs ----
  mom.drive.mouth = 0;
  mom.drive.feed = 0;
  calf.drive.mouth = 0;
  calf.anim.gesture?.('happyWiggle');
  S.voiceCall(calf, 'chirp');
  S.voiceCall(mom, 'coo');
  mom.anim.gesture?.('nuzzle', { side: -side });
  life.mark('fed');
  const a0 = Math.atan2(-hd.z, -hd.x) + side * 0.6;
  if (!C.skipped) {
    yield* film(C, C.drone({ center: calf, radius: [16, 34], height: [4, 18], angle: [a0, a0 + side * 0.35], fov: [38, 44] }), 3.4, null, (t, dt) => {
      cheek(_a);
      poseCalf(dt, _a, mouthM(_v));
    });
  }
  // the calf is the player's again
  life.kin.delete(calf);
  herd.physics.add?.(calf);
  calf.vel.copy(mom.vel);
  calf.drive.lookAt = null;
  herd.motherScript = null;
  return { gulps, nuzzled: !!hN.ok };
}

/** A few krill from her lips to the calf's (or, missed, drifting off and sinking). No glow. */
function krill(g, from, to, mom, side, miss) {
  const E = KRILL;
  E.pos.copy(from).addScaledVector(mom.right, side * 0.35);
  if (miss) {
    E.vel.set((Math.random() - 0.5) * 2.4, -0.3 - Math.random() * 0.6, (Math.random() - 0.5) * 2.4).addScaledVector(mom.right, side * 1.2);
    E.life = 1.4 + Math.random() * 0.8;
    E.gravity = 0.9;
  } else {
    E.vel.copy(to).sub(E.pos).multiplyScalar(1.7).add(mom.vel);
    E.vel.x += (Math.random() - 0.5) * 0.7; E.vel.y += (Math.random() - 0.5) * 0.5; E.vel.z += (Math.random() - 0.5) * 0.7;
    E.life = 0.55 + Math.random() * 0.25;
    E.gravity = 0.4;
  }
  E.size = 0.05 + Math.random() * 0.03;
  E.sizeEnd = E.size * 0.6;
  const p = Math.random();
  E.color[0] = 0.95; E.color[1] = lerp(0.45, 0.62, p); E.color[2] = lerp(0.4, 0.5, p);
  g.mist?.emit?.(E);
}

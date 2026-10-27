// Dev scene: the storm falcon hunting the calf over the cloud sea.
//
// ?debug&test=falcon[&pose=...][&shot=...][&time=stormDawn][&dt=0.033&warp=3]
//   pose  (frozen in place beside the herd unless noted):
//         glide | flap | stoop | cup | pullout (M-shape) | strike | screech | knockback (live tumble)
//         circle (live soaring) | shadow (live shadow pass over the herd) | stalk (live)
//         attack (default: the full choreography, live) | dive (live stoop -> strike -> pull-out)
//   shot  side | front | below | chase | top | quarter | sun | talons | head | profile | herd | shadow | sea | wide | auto (default)
//   phase=<rad>  freeze the wingbeat phase (pose=flap)   dist=<k>  camera distance scale
//   cross=<s>, alt=<m>  (pose=shadow) when the shadow crosses the herd and how high the falcon flies
//   shadowr=<m>  shadow-map radius (default 170): ~450 shows the falcon's shadow on the cloud sea
//   back         put the camera on the shadow side (backlit)   evade  the calf dodges the strike
//   noherd       falcon only                                 nofx   no particles
//   noprotect    the adults do not close ranks around the calf when the falcon dives
import { Vector3 } from 'three';
import { Falcon } from '../creatures/Falcon.js';
import { Whale } from '../creatures/Whale.js';
import { CALF, MOTHER, ADULTS } from '../creatures/WhaleTypes.js';
import { G } from '../render/Globals.js';
import { rng, clamp, dampVec3, damp } from '../core/math.js';

export default async function (game) {
  const p = game.params;
  const scene = game.engine.scene;
  if (!p.has('time')) game.atmosphere.set('stormDawn');
  const pose = p.get('pose') || 'attack';
  const shotName = p.get('shot') || 'auto';
  const k = +(p.get('dist') || 1);
  const warpT = +(p.get('warp') || 0);

  // ---- the herd: calf + mother + two adults cruising toward -Z --------------------------------
  const herdVel = new Vector3(0, 0, -8.5);
  const herdCenter = new Vector3(0, 150, 0);
  const calf = new Whale(CALF);
  const mom = new Whale(MOTHER);
  const a1 = new Whale(ADULTS[0]);
  const a2 = new Whale(ADULTS[3]);
  const members = [
    { w: calf, off: new Vector3(0, 0, 0), tight: new Vector3(0, -2, 4) },
    { w: mom, off: new Vector3(-17, -3, 12), tight: new Vector3(-10, 2, 6) },
    { w: a1, off: new Vector3(30, 8, 26), tight: new Vector3(11, 5, -2) },
    { w: a2, off: new Vector3(-36, 5, -34), tight: new Vector3(0, 13, -2) }, // shields the calf from above
  ];
  const showHerd = !p.has('noherd');
  // a wider shadow map lets the falcon's shadow reach the cloud sea far below the herd
  if (p.has('shadowr')) game.engine.shadows.radius = +p.get('shadowr');
  for (const m of members) {
    const w = m.w;
    w.place(herdCenter.clone().add(m.off), Math.PI);
    w.vel.copy(herdVel);
    w.furQuality = game.furQuality;
    w.group.visible = showHerd;
    if (!showHerd) continue;
    scene.add(w.group);
    w.model.castShadows(game.engine.shadows);
  }
  const adults = [mom, a1, a2];
  let protect = 0;
  const slot = new Vector3();
  const lead = new Vector3();
  let falcon = null;
  // protective formation: the adults put their bodies between the hunter and the calf
  const shield = new Vector3();
  const shieldSide = new Vector3();
  const updateHerd = (dt) => {
    herdCenter.addScaledVector(herdVel, dt);
    const camPos = game.engine.camera.position;
    if (falcon && falcon.group.visible) {
      shield.subVectors(falcon.pos, herdCenter);
      shield.y = Math.max(shield.y, 0);
      shield.normalize();
      shieldSide.set(-shield.z, 0, shield.x).normalize();
      members[1].tight.copy(shield).multiplyScalar(15);
      members[2].tight.copy(shield).multiplyScalar(9).addScaledVector(shieldSide, 15);
      members[3].tight.copy(shield).multiplyScalar(9).addScaledVector(shieldSide, -15);
    }
    for (const m of members) {
      const w = m.w;
      slot.copy(m.off).lerp(m.tight, protect).add(herdCenter);
      lead.copy(slot).addScaledVector(herdVel, 3).sub(w.pos);
      w.ctl.targetYaw = Math.atan2(lead.x, lead.z);
      w.ctl.targetPitch = Math.atan2(lead.y, Math.hypot(lead.x, lead.z)) * 0.5;
      const want = herdVel.length() + slot.distanceTo(w.pos) * 0.25;
      w.ctl.thrust = clamp((want - w.vel.length()) * 0.4 + 0.4, 0, 1);
      w.drive.effort = w.ctl.thrust;
      w.drive.glide = 0.4;
      w.drive.fear = protect * (w === calf ? 1 : 0.4);
      w.drive.lookAt = falcon && falcon.group.visible ? falcon.pos : null;
      w.step(dt);
      w.animate(dt, camPos);
    }
  };

  // ---- clouds ----------------------------------------------------------------------------------------
  const r = rng(11);
  for (let i = 0; i < 40; i++) {
    const c = new Vector3((r() - 0.5) * 2600, 30 + r() * 120, 600 - r() * 3200);
    if (Math.abs(c.x) < 160 && c.z > -900 && c.z < 300) c.x += 340 * Math.sign(c.x || 1);
    game.clouds.cumulus(c, 120 + r() * 240, 70 + r() * 150, { seed: i + 3 });
  }
  // tall clouds the falcon can punch through on its way down
  game.clouds.cumulus(new Vector3(260, 190, -180), 220, 170, { seed: 401 });
  game.clouds.cumulus(new Vector3(-240, 120, -420), 180, 120, { seed: 402 });

  // ---- the falcon ----------------------------------------------------------------------------------------
  falcon = new Falcon(game, { fx: !p.has('nofx') });
  falcon.target = calf;
  falcon.obstacles = showHerd ? adults : [];
  window.__falcon = falcon;
  const log = [];
  window.__falconLog = log;
  for (const ev of ['screech', 'flap', 'strikeHit', 'strikeMiss', 'retreated', 'modeChange', 'knockback', 'passDone', 'stoop']) {
    falcon.on(ev, (d) => {
      log.push({ t: +game.time.toFixed(2), ev, mode: d.mode, minDist: d.minDist !== undefined ? +(+d.minDist).toFixed(2) : undefined });
      if (log.length > 200) log.shift();
    });
  }
  falcon.on('strikeHit', () => {
    // no gore: the calf is bowled over and tumbles away squealing
    calf.vel.addScaledVector(falcon.vel.clone().normalize(), 9);
    calf.anim.flinch(1.5);
    calf.barrelRoll(Math.random() < 0.5 ? -1 : 1);
  });

  // pose presets: velocity direction (herd frame: x right, y up, z forward) + animation drivers
  const fwdH = herdVel.clone().normalize();
  const rightH = new Vector3(-fwdH.z, 0, fwdH.x);
  const POSE = {
    glide: { v: [0, 0, 1], speed: 26, poses: { glide: 1 }, effort: 0 },
    flap: { v: [0, 0.05, 1], speed: 24, poses: { glide: 1 }, effort: 1, flapAmp: 1 },
    stoop: { v: [0, -0.94, 0.34], speed: 62, poses: { stoop: 1 }, effort: 0, crest: 0 },
    cup: { v: [0, -0.8, 0.6], speed: 55, poses: { cup: 1 }, effort: 0, crest: 0.3 },
    pullout: { v: [0, -0.45, 0.89], speed: 55, poses: { mshape: 1 }, effort: 0, crest: 0.4 },
    strike: { v: [0, -0.28, 0.96], speed: 44, poses: { strike: 1 }, effort: 0, grip: 0, crest: 1, wide: 0.7, jaw: 0.25 },
    screech: { v: [0, 0, 1], speed: 26, poses: { glide: 1 }, effort: 0, crest: 0.2 },
  };
  const frozen = POSE[pose];
  const falconOff = new Vector3(14, 48, -80); // herd frame: right, up, forward (behind the herd, eyes on the calf)
  const tmp = new Vector3();
  const tmp2 = new Vector3();
  let screechAt = -1;
  if (frozen) {
    falcon.setMode('circle', { center: herdCenter, radius: 200, altitude: 200 });
    falcon.frozen = true;
    falcon.posePreview = {
      poses: frozen.poses, effort: frozen.effort, flapAmp: frozen.flapAmp, crest: frozen.crest ?? 0.15,
      grip: frozen.grip, wide: frozen.wide ?? 0, jaw: frozen.jaw ?? 0, look: calf.pos, focus: 1, instant: true, burst: 0,
    };
    if (pose === 'screech') screechAt = Math.max(0.2, warpT - 0.55);
    if (p.has('phase')) falcon.anim.frozenPhase = +p.get('phase');
  }

  // ---- live choreography -----------------------------------------------------------------------------------------
  const timeline = [];
  const at = (t, fn) => timeline.push({ t, fn, done: false });
  if (pose === 'circle') falcon.setMode('circle', { center: herdCenter, radius: 230, altitude: herdCenter.y + 190 });
  else if (pose === 'shadow') {
    // the shadow sweeps the herd at t = cross (default 6 s): look with &warp=6
    const cross = +(p.get('cross') || 6), L = 400, speed = 33;
    falcon.setMode('shadowPass', {
      over: herdCenter.clone().addScaledVector(herdVel, cross), altitude: +(p.get('alt') || 90), length: L, speed,
      startOffset: speed * cross - L / 2,
    });
  } else if (pose === 'stalk') falcon.setMode('stalk', { behind: 90, above: 55 });
  else if (pose === 'knockback') {
    falcon.setMode('circle', { center: herdCenter, radius: 90, altitude: herdCenter.y + 60, startAngle: 2.2 });
    // &kt=<s>: how long before the end of the warp the boom hits (default 0.7 s)
    at(Math.max(0.3, warpT - +(p.get('kt') || 0.7)), () => falcon.knockback(mom.pos, 1.3));
  } else if (pose === 'dive') {
    falcon.setMode('circle', { center: herdCenter, radius: 200, altitude: herdCenter.y + 260, startAngle: 1.0 });
    at(0.5, () => falcon.setMode('dive', { hitRadius: 6 }));
  } else if (pose === 'attack') {
    // the climactic encounter, in story order (see the report for the director's version)
    at(1.0, () => falcon.screech()); // a distant cry: hidden, audio only
    at(3.0, () => falcon.setMode('shadowPass', {
      over: herdCenter.clone().addScaledVector(herdVel, 6.1), altitude: 70, length: 440, speed: 36,
      then: 'hidden', exitDistance: 150,
    }));
    at(18, () => falcon.screech());
    at(20, () => falcon.setMode('circle', { center: herdCenter, radius: 240, altitude: herdCenter.y + 190 }));
    at(30, () => falcon.setMode('stalk', { behind: 90, above: 160 }));
    at(37, () => falcon.screech());
    at(38, () => falcon.setMode('dive', {}));
    at(56, () => { protect = 1; falcon.setMode('stalk', { behind: 80, above: 150 }); });
    at(61, () => falcon.setMode('dive', {}));
    // the mother answers with a sonic boom as it sheers off
    falcon.on('strikeMiss', (d) => {
      if (d.blocked) timeline.push({ t: game.time + 1.2, fn: () => falcon.knockback(mom.pos, 1.4), done: false });
    });
    falcon.on('knockback', () => timeline.push({ t: game.time + 4.5, fn: () => falcon.setMode('retreat', { from: herdCenter }), done: false }));
  }

  // ---- camera -----------------------------------------------------------------------------------------------------
  const cam = game.engine.camera;
  const camPos = new Vector3();
  const camLook = new Vector3();
  const shotPos = new Vector3();
  const shotLook = new Vector3();
  let camInit = false;
  let fov = 50;
  const V = (x, y, z) => tmp2.set(x, y, z);
  const _f = new Vector3();
  const _u = new Vector3();
  const sunSide = () => {
    const sd = G.uSunDir.value;
    const s = Math.sign(sd.x * rightH.x + sd.z * rightH.z) || 1;
    return p.has('back') ? -s : s;
  };
  const shotFor = (name, outPos, outLook) => {
    const F = falcon.pos;
    const fw = tmp.set(falcon.vel.x, 0, falcon.vel.z);
    if (fw.lengthSq() < 1) fw.copy(fwdH);
    fw.normalize();
    const R = new Vector3(-fw.z, 0, fw.x);
    const ss = sunSide();
    fov = 50;
    switch (name) {
      case 'side':
        outPos.copy(F).addScaledVector(R, 95 * k * ss).add(V(0, 8, 0)).addScaledVector(fw, 6);
        outLook.copy(F).addScaledVector(fw, 3);
        break;
      case 'front':
        outPos.copy(F).addScaledVector(fw, 88 * k).addScaledVector(R, 22 * k * ss).add(V(0, 14 * k, 0));
        outLook.copy(F).addScaledVector(fw, 2);
        break;
      case 'below':
        outPos.copy(F).add(V(0, -78 * k, 0)).addScaledVector(fw, 30 * k).addScaledVector(R, 14 * k * ss);
        outLook.copy(F).addScaledVector(fw, 4);
        fov = 56;
        break;
      case 'chase':
        outPos.copy(F).addScaledVector(fw, -90 * k).add(V(0, 26 * k, 0)).addScaledVector(R, 18 * k * ss);
        outLook.copy(F).addScaledVector(fw, 25);
        break;
      case 'top':
        outPos.copy(F).add(V(0, 115 * k, 0)).addScaledVector(fw, -14 * k);
        outLook.copy(F);
        break;
      case 'talons':
        // close on the feet
        outPos.copy(falcon.talonPos).addScaledVector(fw, 22 * k).addScaledVector(R, 12 * k * ss).add(V(0, -4 * k, 0));
        outLook.copy(falcon.talonPos);
        fov = 40;
        break;
      case 'quarter':
        // three-quarter from above and ahead: the face, the crest and the layered upper wing
        outPos.copy(F).addScaledVector(fw, 55 * k).addScaledVector(R, 38 * k * ss).add(V(0, 34 * k, 0));
        outLook.copy(F).add(V(0, -2, 0));
        fov = 46;
        break;
      case 'sun': {
        // looking toward the sun from below the falcon: backlit feathers
        const sd = G.uSunDir.value;
        outPos.copy(F).addScaledVector(sd, -90 * k).add(V(0, -30 * k, 0));
        outLook.copy(F);
        fov = 50;
        break;
      }
      case 'head':
        outPos.copy(falcon.fwd).multiplyScalar(26 * k).add(F).addScaledVector(R, 14 * k * ss).add(V(0, 3, 0));
        outLook.copy(falcon.fwd).multiplyScalar(8).add(F).add(V(0, 2, 0));
        fov = 40;
        break;
      case 'profile':
        // close side view of the head (beak, eyes, crest)
        _f.copy(falcon.fwd);
        _u.set(0, 1, 0).applyQuaternion(falcon.group.quaternion);
        outPos.copy(F).addScaledVector(_f, 7.5).addScaledVector(_u, 2.2).addScaledVector(R, 21 * k * ss);
        outLook.copy(F).addScaledVector(_f, 7.5).addScaledVector(_u, 2.2);
        fov = 34;
        break;
      case 'herd':
        // the calf's point of view: looking up at the hunter
        outPos.copy(calf.pos).addScaledVector(fwdH, -26).add(V(0, 3, 0)).addScaledVector(rightH, 8);
        outLook.copy(F);
        fov = 60;
        break;
      case 'shadow':
        outPos.copy(herdCenter).addScaledVector(rightH, 70 * ss * k).add(V(0, 42 * k, 0)).addScaledVector(fwdH, -55 * k);
        outLook.copy(herdCenter).add(V(0, -8, 0));
        fov = 58;
        break;
      case 'sea': {
        // high and wide: the herd and the falcon's shadow racing over the cloud sea
        const sd = G.uSunDir.value;
        outPos.copy(herdCenter).add(V(-sd.x * 60, 230 * k, -sd.z * 60)).addScaledVector(fwdH, -160 * k);
        outLook.copy(herdCenter).add(V(-sd.x * 120, -90, -sd.z * 120));
        fov = 62;
        break;
      }
      default: // wide
        outPos.copy(F).addScaledVector(fw, -230 * k).addScaledVector(R, 120 * k * ss).add(V(0, 40 * k, 0));
        outLook.copy(F).lerp(herdCenter, 0.35);
        fov = 55;
        break;
    }
  };
  const autoShot = () => {
    switch (falcon.mode) {
      case 'circle': return 'wide';
      case 'shadowPass': return 'herd';
      case 'stalk': return 'chase';
      case 'dive': return falcon._ai.phase === 'stoop' ? 'chase' : 'side';
      case 'strike': return 'side';
      case 'pullout': return 'chase';
      case 'knockback': return 'wide';
      case 'retreat': return 'herd';
      default: return 'wide';
    }
  };
  game.cameraRig.update = (dt) => {
    const name = shotName === 'auto' ? (frozen ? 'side' : autoShot()) : shotName;
    shotFor(name, shotPos, shotLook);
    if (!camInit || frozen) { camPos.copy(shotPos); camLook.copy(shotLook); camInit = true; } else {
      dampVec3(camPos, shotPos, 2.5, dt);
      dampVec3(camLook, shotLook, 5, dt);
    }
    cam.position.copy(camPos);
    cam.up.set(0, 1, 0);
    cam.lookAt(camLook);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = frozen ? fov : damp(cam.fov, fov, 2, dt);
      cam.updateProjectionMatrix();
    }
  };

  // ---- frame -----------------------------------------------------------------------------------------------------------
  game.devUpdate = (dt) => {
    for (const ev of timeline) if (!ev.done && game.time >= ev.t) { ev.done = true; ev.fn(); }
    if (frozen) {
      falcon.pos.copy(herdCenter).addScaledVector(rightH, falconOff.x).add(V(0, falconOff.y, 0)).addScaledVector(fwdH, falconOff.z);
      const v = frozen.v;
      falcon.vel.copy(rightH).multiplyScalar(v[0]).add(V(0, v[1], 0)).addScaledVector(fwdH, v[2]).normalize().multiplyScalar(frozen.speed);
      falcon.up.set(0, 1, 0);
      if (screechAt >= 0 && game.time >= screechAt) { screechAt = -1; falcon.screech(); }
    }
    if (pose === 'dive' && !p.has('noprotect')) {
      const hunting = falcon.mode === 'dive' || falcon.mode === 'strike';
      protect = damp(protect, hunting ? 1 : 0, hunting ? 1.5 : 0.25, dt);
    }
    // a player-like dodge: a hard sideways surge once the falcon is ~1.5 s out
    if (p.has('evade') && (falcon.mode === 'strike' || (falcon.mode === 'dive' && falcon._ai.phase === 'flare' && falcon.pos.distanceTo(calf.pos) < 75))) {
      if (calf.vel.dot(rightH) < 14) calf.vel.addScaledVector(rightH, 18 * dt);
    }
    if (showHerd) updateHerd(dt);
    falcon.update(dt);
    // shadows and cloud interaction follow the calf (as in the game)
    game.focus.copy(showHerd ? calf.pos : falcon.pos);
  };
}

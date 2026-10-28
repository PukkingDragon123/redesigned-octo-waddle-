// Dev scene: the calf flies with its mother and the herd low over the sea of Vur Sok.
// ?debug&test=fly&time=morning&dt=0.033&warp=8&auto=cruise|turn|glide|dive|idle|look|sun|straight
//   &cam=follow|side|front|momside|momfront|alphaside|top|low   &solo   &nosea (old cloud sea)
//   &gesture=tailSlap|finSlap|spyhop|nuzzle|happyWiggle|breachArch|rollOver  (mother + calf, every 7 s)
//   &bump        calf and mother bump into each other every 4 s (anim.bump on both)
//   &sing &hum &charge &feed &happy   voice / mood drives on the calf and the mother
//   &alt=<m>     flight altitude (default 38)   &shells=N  cap fur shells   &skin=<scale> bake scale
//   &freeze=<s>  stop the clock at s seconds (stills of a pose)
import { Vector3 } from 'three';
import { Whale } from '../creatures/Whale.js';
import { WhaleModel, BAKE } from '../creatures/WhaleModel.js';
import { CALF, MOTHER, ADULTS, ELDER } from '../creatures/WhaleTypes.js';
import { PlayerController } from '../game/PlayerController.js';
import { G } from '../render/Globals.js';
import { rng } from '../core/math.js';

export default async function (game) {
  const s = game.engine.scene;
  const p = game.params;
  if (p.has('skin')) BAKE.scale = +p.get('skin');
  if (!p.has('nosea')) {
    if (game.cloudSea) game.cloudSea.enabled = false;
    try {
      const { Ocean } = await import('../world/Ocean.js');
      if (!game.ocean) game.ocean = new Ocean(game);
      game.ocean.setSeaState?.(+(p.get('state') ?? 0.3), { dur: 0.01 });
    } catch (e) { console.warn('[fly] ocean unavailable', e); }
  }
  const alt = +(p.get('alt') ?? 38);
  const calf = new Whale(CALF);
  const mom = new Whale(MOTHER);
  const alpha = new Whale(ADULTS[0]);
  const elder = new Whale(ELDER);
  const a2 = new Whale(ADULTS[3]);
  calf.place(new Vector3(0, alt, 0), Math.PI);
  mom.place(new Vector3(-16, alt - 4, -14), Math.PI);
  alpha.place(new Vector3(46, alt + 14, -80), Math.PI);
  elder.place(new Vector3(-70, alt + 26, -150), Math.PI);
  a2.place(new Vector3(90, alt + 4, -170), Math.PI);
  const solo = p.has('solo');
  const whales = solo ? [calf] : [calf, mom, alpha, elder, a2];
  for (const w of [calf, mom, alpha, elder, a2]) {
    w.group.visible = whales.includes(w);
    if (!w.group.visible) continue;
    s.add(w.group);
    w.model.castShadows(game.engine.shadows);
    w.vel.set(0, 0, -9);
    w.furQuality = game.furQuality;
  }
  // the hero meshes for the calf and its mother right away; the rest stream in
  calf.model.prepare?.();
  mom.model.prepare?.();
  WhaleModel.flush?.();
  if (p.has('shells')) for (const w of whales) w.model.maxShells = Math.min(w.model.maxShells, +p.get('shells'));
  const player = new PlayerController(game, calf);
  player.syncAim();
  const mode = p.get('auto') || 'cruise';
  player.autopilot = () => {
    const t = game.time;
    const hold = (pitch) => pitch + (alt - calf.pos.y) * 0.01;
    if (mode === 'cruise') return { swim: 0.8, yaw: Math.PI + Math.sin(t * 0.25) * 0.5, pitch: hold(Math.sin(t * 0.3) * 0.12) };
    if (mode === 'turn') return { swim: 1, yaw: Math.PI + t * 0.6, pitch: hold(0.05) };
    if (mode === 'glide') return { swim: t < 2 ? 1 : 0, yaw: Math.PI, pitch: hold(-0.05) };
    if (mode === 'dive') return { swim: 1, yaw: Math.PI, pitch: t > 2 ? -0.9 : 0 };
    if (mode === 'idle') return { swim: 0, yaw: Math.PI + t * 0.3, pitch: hold(0.1) };
    if (mode === 'straight') return { swim: 0.85, yaw: Math.PI, pitch: hold(-0.02) };
    if (mode === 'look') return { swim: 0.6, yaw: Math.PI + 0.3, pitch: -0.45 };
    if (mode === 'sun') {
      const sd = G.uSunDir.value;
      return { swim: 0.6, yaw: Math.atan2(sd.x, sd.z) + (+p.get('yawoff') || 0), pitch: hold(-0.12) };
    }
    return { swim: 0.8 };
  };
  // a few distant clouds for depth (the sky owner's clouds API)
  const r = rng(42);
  for (let i = 0; i < 26; i++) {
    const c = new Vector3((r() - 0.5) * 3000, 380 + r() * 400, -r() * 3000 + 400);
    game.clouds.cumulus?.(c, 260 + r() * 300, 140 + r() * 200, { seed: i + 1, sparse: true });
  }

  const offsets = [new Vector3(-16, -4, -14), new Vector3(46, 14, -80), new Vector3(-70, 26, -150), new Vector3(90, 4, -170)];
  const gestureName = p.get('gesture');
  let gestureT = 1.5, bumpT = 2.5;
  const drives = ['sing', 'hum', 'charge', 'feed', 'happy'].filter((k) => p.has(k));
  const freezeAt = p.has('freeze') ? +p.get('freeze') : Infinity;
  game.devUpdate = (dtIn) => {
    const dt = game.time > freezeAt ? 0 : dtIn;
    const camPos = game.engine.camera.position;
    player.update(dt);
    for (const k of drives) { calf.drive[k] = +p.get(k) || 1; mom.drive[k] = +p.get(k) || 1; }
    calf.drive.lookAt = whales[1] ? whales[1].pos : null;
    calf.step(dt);
    if (game.ocean?.heightAt) {
      // keep the dev flight above the waves
      const h = game.ocean.heightAt(calf.pos.x, calf.pos.z);
      if (calf.pos.y < h + 3) { calf.pos.y = h + 3; calf.vel.y = Math.max(0, calf.vel.y); }
    }
    calf.animate(dt, camPos);
    whales.slice(1).forEach((a, k) => {
      const to = calf.pos.clone().add(offsets[k]).sub(a.pos);
      a.ctl.targetYaw = Math.atan2(to.x, to.z);
      a.ctl.targetPitch = Math.atan2(to.y, Math.hypot(to.x, to.z)) * 0.5;
      const want = 9 + to.length() * 0.2;
      a.ctl.thrust = Math.max(0, Math.min(1, (want - a.vel.length()) * 0.4 + 0.4));
      a.drive.effort = a.ctl.thrust;
      a.drive.glide = 0.4;
      a.drive.lookAt = calf.pos;
      a.step(dt);
      a.animate(dt, camPos);
    });
    // social tests
    if (gestureName) {
      gestureT -= dt;
      if (gestureT <= 0) {
        gestureT = 7;
        mom.anim.gesture(gestureName);
        calf.anim.gesture(gestureName);
      }
    }
    if (p.has('bump') && whales[1]) {
      bumpT -= dt;
      if (bumpT <= 0) {
        bumpT = 4;
        const n = calf.pos.clone().sub(mom.pos).normalize();
        calf.anim.bump(n, 1.2);
        mom.anim.bump(n.clone().negate(), 0.6);
        calf.vel.addScaledVector(n, 4);
      }
    }
    const cam = p.get('cam') || 'follow';
    if (cam === 'follow') game.cameraRig.follow(dt, calf, player.aimYaw, player.aimPitch);
    else {
      const tgt = cam.startsWith('mom') ? mom : cam.startsWith('alpha') ? alpha : calf;
      const k = tgt.L / 4.2;
      const shot = game._devShot || (game._devShot = { pos: new Vector3(), look: new Vector3(), fov: 40 });
      if (cam.endsWith('front')) shot.pos.copy(tgt.pos).addScaledVector(tgt.fwd, 9 * k).addScaledVector(tgt.right, 3 * k).add(new Vector3(0, 1.5 * k, 0));
      else if (cam === 'top') shot.pos.copy(tgt.pos).add(new Vector3(0, 14 * k, 0.1));
      else if (cam === 'low') shot.pos.copy(tgt.pos).addScaledVector(tgt.right, 6 * k).add(new Vector3(0, -4 * k, 0));
      else shot.pos.copy(tgt.pos).addScaledVector(tgt.right, 8 * k).addScaledVector(tgt.fwd, 1 * k).add(new Vector3(0, 1.2 * k, 0));
      shot.look.copy(tgt.pos);
      game.cameraRig.setCinematic(shot, 10);
      game.cameraRig.cineW = 1;
      game.cameraRig.follow(dt, calf, player.aimYaw, player.aimPitch);
    }
    game.focus.copy(calf.pos);
    if (game.cloudSea?.uniforms?.uTrailOn) game.cloudSea.uniforms.uTrailOn.value = 0;
  };
  game.devWhales = whales;
  window.__whales = whales;
}

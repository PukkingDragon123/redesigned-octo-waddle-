// Dev scene: the calf flies with the mother and two adults over the cloud ocean.
// ?debug&test=fly&time=dawn&dt=0.033&warp=8&shells=8&auto=cruise|turn|glide|dive|idle|look|sun&solo
import { Vector3 } from 'three';
import { Whale } from '../creatures/Whale.js';
import { CALF, MOTHER, ADULTS } from '../creatures/WhaleTypes.js';
import { PlayerController } from '../game/PlayerController.js';
import { G } from '../render/Globals.js';
import { rng } from '../core/math.js';

export default async function (game) {
  const s = game.engine.scene;
  const p = game.params;
  const calf = new Whale(CALF);
  const mom = new Whale(MOTHER);
  const a1 = new Whale(ADULTS[0]);
  const a2 = new Whale(ADULTS[1]);
  calf.place(new Vector3(0, 150, 0), Math.PI);
  mom.place(new Vector3(-22, 144, -18), Math.PI);
  a1.place(new Vector3(40, 164, -70), Math.PI);
  a2.place(new Vector3(-60, 148, -110), Math.PI);
  const solo = p.has('solo');
  const whales = solo ? [calf] : [calf, mom, a1, a2];
  for (const w of [calf, mom, a1, a2]) {
    w.group.visible = whales.includes(w);
    if (!w.group.visible) continue;
    s.add(w.group);
    w.model.castShadows(game.engine.shadows);
    w.vel.set(0, 0, -9);
    w.furQuality = game.furQuality;
  }
  if (p.has('shells')) for (const w of whales) w.model.maxShells = Math.min(w.model.maxShells, +p.get('shells'));
  const player = new PlayerController(game, calf);
  player.syncAim();
  const mode = p.get('auto') || 'cruise';
  player.autopilot = (dt) => {
    const t = game.time;
    if (mode === 'cruise') return { swim: 0.8, yaw: Math.PI + Math.sin(t * 0.25) * 0.5, pitch: Math.sin(t * 0.3) * 0.15 };
    if (mode === 'turn') return { swim: 1, yaw: Math.PI + t * 0.6, pitch: 0.1 };
    if (mode === 'glide') return { swim: t < 2 ? 1 : 0, yaw: Math.PI, pitch: -0.05 };
    if (mode === 'dive') return { swim: 1, yaw: Math.PI, pitch: t > 2 ? -0.9 : 0 };
    if (mode === 'idle') return { swim: 0, yaw: Math.PI + t * 0.3, pitch: 0.1 };
    if (mode === 'look') return { swim: 0.6, yaw: Math.PI + 0.3, pitch: -0.45 };
    if (mode === 'sun') {
      const sd = G.uSunDir.value;
      return { swim: 0.6, yaw: Math.atan2(sd.x, sd.z) + (+p.get('yawoff') || 0), pitch: -0.12 };
    }
    return { swim: 0.8 };
  };
  // clouds
  const r = rng(42);
  for (let i = 0; i < 60; i++) {
    const c = new Vector3((r() - 0.5) * 2400, 40 + r() * 140, -r() * 3000 + 400);
    if (Math.abs(c.x) < 90 && c.z < 100 && c.z > -900) c.x += 220 * Math.sign(c.x || 1);
    game.clouds.cumulus(c, 120 + r() * 260, 70 + r() * 160, { seed: i + 1 });
  }
  game.clouds.cumulus(new Vector3(60, 120, -260), 160, 110, { seed: 900 });
  game.clouds.wisps(new Vector3(-30, 150, -420), 120, 30, { seed: 77 });

  const offsets = [new Vector3(-22, -6, -18), new Vector3(40, 14, -70), new Vector3(-60, -2, -110)];
  game.devUpdate = (dt) => {
    const camPos = game.engine.camera.position;
    player.update(dt);
    if (p.has('humdrive')) calf.drive.hum = 1;
    if (p.has('charge')) calf.drive.charge = 1;
    if (p.has('happy')) calf.drive.happy = 1;
    if (p.has('feed')) calf.drive.feed = 1;
    calf.drive.lookAt = whales[1] ? whales[1].pos : null;
    calf.step(dt);
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
    game.cameraRig.follow(dt, calf, player.aimYaw, player.aimPitch);
    game.focus.copy(calf.pos);
    game.cloudSea.uniforms.uTrailOn.value = calf.pos.y < 140 ? 1 : 0;
  };
  game.devWhales = whales;
}

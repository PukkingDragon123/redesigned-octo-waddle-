// Dev scene: the whole of Vur Sok along the migration route. Frames the route at arc length `s`.
// ?debug&test=world&s=1860&lat=0&up=20&back=120&yaw=0&pitch=-0.1  (time defaults to the chapter's)
//   &only=<chapter id> builds one chapter; &cam=x,y,z&look=x,y,z overrides the framing;
//   &fly=<m/s> flies the camera along the route (for LOD / culling checks).
import { Vector3 } from 'three';
import { MigrationPath } from '../world/MigrationPath.js';
import { WorldBuilder } from '../world/WorldBuilder.js';
import { placeholderSea } from '../world/Water.js';

export default async function (game) {
  const p = game.params;
  // &ocean uses the real ocean (world/Ocean.js) when it exists; otherwise a placeholder sea
  if (p.has('ocean') && !game.ocean) {
    try {
      const { Ocean } = await import('../world/Ocean.js');
      game.ocean = new Ocean(game);
      if (game.cloudSea) game.cloudSea.enabled = false;
    } catch (e) { console.warn('[vursok] ocean unavailable', e); }
  }
  placeholderSea(game);
  const path = new MigrationPath();
  const world = new WorldBuilder(game, path);
  const t0 = performance.now();
  const only = p.get('only');
  world.sliceMs = 1e9; // build in one go in the dev scene
  if (only) await world.buildChapter(only);
  else await world.build();
  console.log('[vursok] timing', JSON.stringify(Object.fromEntries(Object.entries(world.timing || {}).map(([k, v]) => [k, Math.round(v)]))));
  console.log('[vursok] world built in', (performance.now() - t0).toFixed(0), 'ms; islands', world.islands.length, 'puffs', game.clouds?.count, 'falls', world.waterfalls.length, 'fish', world.spawns.fish.length, 'reptiles', world.spawns.reptiles.length, 'perches', world.perches.length);
  let s = +(p.get('s') ?? 60);
  const ch = path.chapterAt(s);
  if (!p.get('time')) game.atmosphere.set(ch.time);
  const back = +(p.get('back') ?? 60), up = +(p.get('up') ?? 15), lat = +(p.get('lat') ?? 0);
  const yaw = +(p.get('yaw') ?? 0), pitch = +(p.get('pitch') ?? -0.05);
  const fly = +(p.get('fly') ?? 0);
  const cam = game.engine.camera;
  const camPos = new Vector3(), look = new Vector3();
  const frame = () => {
    const f = path.frameAt(s);
    camPos.copy(f.pos).addScaledVector(f.fwd, -back).addScaledVector(f.up, up).addScaledVector(f.right, lat);
    const dir = f.fwd.clone().applyAxisAngle(new Vector3(0, 1, 0), yaw);
    dir.y += pitch;
    dir.normalize();
    look.copy(camPos).addScaledVector(dir, 100);
    if (p.get('cam')) camPos.fromArray(p.get('cam').split(',').map(Number));
    if (p.get('look')) look.fromArray(p.get('look').split(',').map(Number));
    game.focus.copy(f.pos);
  };
  frame();
  game.cameraRig.update = (dt) => {
    if (fly && dt) { s = Math.min(path.length, s + fly * dt); frame(); }
    cam.position.copy(camPos);
    cam.lookAt(look);
  };
  game.devUpdate = () => world.updateVisibility(s);
  world.updateVisibility(s);
  game.devWorld = world;
}

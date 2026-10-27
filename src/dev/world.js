// Dev scene: the whole migration world. Frames the route at arc length `s`.
// ?debug&test=world&s=1860&lat=0&up=20&back=120&yaw=0&pitch=-0.1  (time defaults to the chapter's)
import { Vector3 } from 'three';
import { MigrationPath } from '../world/MigrationPath.js';
import { WorldBuilder } from '../world/WorldBuilder.js';

export default async function (game) {
  const p = game.params;
  const path = new MigrationPath();
  const world = new WorldBuilder(game, path);
  const t0 = performance.now();
  const only = p.get('only');
  if (only) await world.buildChapter(only);
  else await world.build();
  console.log('[skysong] world built in', (performance.now() - t0).toFixed(0), 'ms; islands', world.islands.length, 'puffs', game.clouds.count, 'falls', world.waterfalls.length);
  const s = +(p.get('s') ?? 60);
  const ch = path.chapterAt(s);
  if (!p.get('time')) game.atmosphere.set(ch.time);
  const f = path.frameAt(s);
  const back = +(p.get('back') ?? 60), up = +(p.get('up') ?? 15), lat = +(p.get('lat') ?? 0);
  const yaw = +(p.get('yaw') ?? 0), pitch = +(p.get('pitch') ?? -0.05);
  const camPos = f.pos.clone().addScaledVector(f.fwd, -back).addScaledVector(f.up, up).addScaledVector(f.right, lat);
  const dir = f.fwd.clone().applyAxisAngle(new Vector3(0, 1, 0), yaw);
  dir.y += pitch;
  dir.normalize();
  const look = camPos.clone().addScaledVector(dir, 100);
  const cam = game.engine.camera;
  game.cameraRig.update = () => {
    cam.position.copy(camPos);
    cam.lookAt(look);
  };
  game.focus.copy(f.pos);
  world.updateVisibility(s);
  game.devWorld = world;
}

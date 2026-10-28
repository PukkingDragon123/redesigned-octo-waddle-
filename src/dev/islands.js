// Dev scene: a showcase archipelago of Vur Sok built with the real world pipeline (rock, reef
// shelves, atoll, flora, trees, scree, basalt, steam, waterfalls, backdrop) away from the route.
// ?debug&test=islands&time=morning&shot=<name>&ocean
//   shots: wide, coil, coilLow, stack, stackLit, cliff, cave, peak, ammonite, forming, arch,
//          atoll, reef, under, top, giant, garden, lod, far
//   &cam=x,y,z&look=x,y,z overrides the shot; &lod=1 forces the far LOD meshes; &noflora;
//   &ocean uses the real ocean (otherwise a placeholder sea)
import { Vector3 } from 'three';
import { MigrationPath } from '../world/MigrationPath.js';
import { WorldBuilder } from '../world/WorldBuilder.js';
import { placeholderSea } from '../world/Water.js';
import { FloraSet, SPECIES, FLORA_PAL } from '../world/Flora.js';
import { SLOT } from '../world/Painted.js';
import '../world/Trees.js';

export default async function (game) {
  const p = game.params;
  if (p.has('ocean') && !game.ocean) {
    try {
      const { Ocean } = await import('../world/Ocean.js');
      game.ocean = new Ocean(game);
      if (game.cloudSea) game.cloudSea.enabled = false;
    } catch (e) { console.warn('[vursok] ocean unavailable', e); }
  }
  placeholderSea(game);
  const t0 = performance.now();
  const world = new WorldBuilder(game, new MigrationPath(), { layout: false });
  world.sliceMs = 1e9;
  if (p.has('noflora')) world.builtinFlora = false;
  const id = world.addChapter('dev', { biome: 'reach', trees: { kind: 'coil', max: 3, per: 3000 } });
  const at = (x, z) => ({ pos: new Vector3(x, 0, z), clear: false, avoid: false, near: true });
  // the hero coil, its horn and falls
  world.island(id, 'coil', { a: 22, b: 0.2, turns: 1.75, kw: 0.23, Hin: 78, fall: 2.0, seed: 5, steps: 12 }, 0, 0, { ...at(0, -380), falls: 3 });
  // a family of helical stacks with a sea cave
  world.island(id, 'stack', { R: 20, H: 92, lobes: 2, lobeAmp: 0.2, twist: 0.7, seed: 3, caves: [{ th: 0.4, w: 0.32, h: 10, depth: 0.42 }] }, 0, 0, { ...at(-170, -170), style: { rock: 'limestone' }, falls: 1 });
  world.island(id, 'stack', { R: 14, H: 70, lobes: 3, lobeAmp: 0.16, twist: 1.0, seed: 9, topFrac: 0.9, bulge: 0.2, notch: 0.24 }, 0, 0, { ...at(150, -150) });
  world.island(id, 'stack', { R: 8, H: 40, lobes: 2, lobeAmp: 0.25, twist: 1.3, seed: 11, cap: 'point', topFrac: 0.3 }, 0, 0, at(-70, -110));
  // the upright ammonite, the spiral peak, a forming volcanic coil
  world.island(id, 'ammonite', { R: 70, yaw: 0.5, seed: 31 }, 0, 0, at(330, -330));
  world.island(id, 'peak', { R: 75, H: 185, turns: 2.3, seed: 6 }, 0, 0, { ...at(-420, -760), style: { rock: 'warm' }, falls: 1 });
  world.island(id, 'coil', { a: 16, b: 0.2, turns: 1.5, kw: 0.28, Hin: 32, seed: 21, steps: 7, dir: -1, tipH: -3, horn: { H: 55, twist: 0.6, lobes: 2 } }, 0, 0, { ...at(420, -700), style: { rock: 'volcanic', meadow: 0.3 }, forming: true });
  // a Coil Forest island: giant coil tree on its horn, giant fiddleheads
  world.island(id, 'coil', { a: 18, b: 0.2, turns: 1.55, kw: 0.25, Hin: 52, fall: 1.8, seed: 404, steps: 9, horn: { R: 22, H: 64, cap: 'dome', topFrac: 0.85, twist: 0.4, lobes: 2, lobeAmp: 0.12, taperPow: 2, capH: 5 } }, 0, 0, { ...at(-560, -260), giant: true, biome: 'forest', falls: 2 });
  // a spiral atoll with motus and palms, and a stack in its lagoon
  world.atoll(id, -650, 260, { a: 150, b: 0.07, turns: 1.2, rimW: 34, seed: 4, rot: 1.0, lagoon: -6, motu: 0.65 });
  world.island(id, 'stack', { R: 11, H: 46, lobes: 2, twist: 0.9, seed: 41 }, 0, 0, { ...at(-660, 250), style: { rock: 'limestone' } });
  // the Spiral Arch over a channel
  world.extra(id, (w) => w._arch(id, null, { center: new Vector3(260, 0, 60), span: new Vector3(1, 0, 0.3).normalize(), along: new Vector3(-0.3, 0, 1).normalize() }));
  // the specimen garden on a sandbar
  const garden = new FloraSet('flora-garden');
  world.shoal(id, 0, 120, 40, 1.4, { seed: 9 });
  const row = [
    ['fern-a', () => SPECIES.fiddlehead(1000, 4, FLORA_PAL.fern), 4], ['fern-b', () => SPECIES.fiddlehead(1001, 4, FLORA_PAL.fernTeal), 3],
    ['anem', () => SPECIES.anemone(7000, 1.5, FLORA_PAL.anemone), 2], ['anem-v', () => SPECIES.anemone(7001, 1.5, FLORA_PAL.anemoneViolet), 2],
    ['kelp', () => SPECIES.kelp(9000, 8, FLORA_PAL.kelp), 0.8], ['tubes', () => SPECIES.tubes(5000, 2.5, FLORA_PAL.tubes), 1.6],
    ['bells', () => SPECIES.bells(6000, 3, FLORA_PAL.bells), 1.6], ['fan', () => SPECIES.fan(8000, 2, FLORA_PAL.fan), 1.4],
    ['puffs', () => SPECIES.puffs(2000, 2, FLORA_PAL.puff), 1.4], ['tuftA', () => SPECIES.tuft(4010, 1, FLORA_PAL.grass, SLOT.grassA), 1.4],
    ['tuftT', () => SPECIES.tuft(4019, 1, FLORA_PAL.grassTeal, SLOT.tendril), 1.4], ['flowers', () => SPECIES.tuft(4100, 1, FLORA_PAL.flowers, SLOT.flowers), 1.2],
    ['moss', () => SPECIES.moss(3000, 2.4, FLORA_PAL.moss), 1.2], ['palm', () => SPECIES.palm(9800, 14), 1], ['cycad', () => SPECIES.cycad(9850, 5), 1],
    ['pine', () => SPECIES.pine(9900, 16), 1], ['coil', () => SPECIES.coilTree(9700, 22), 0.8], ['blossom', () => SPECIES.blossomTree(9600, 18), 0.8],
  ];
  row.forEach(([k, make, sc], i) => garden.add('garden-' + k, make, new Vector3(-50 + i * 6, 1.2, 120), sc, 0.3 * i, [i, 0, 1, 1]));
  world.extra(id, (w) => w.group(id).add(garden.build(game.engine.shadows)));
  await world.buildChapter(id);
  if (p.get('lod') === '1') world.lodDist = -1e9;
  console.log('[islands] built in', (performance.now() - t0).toFixed(0), 'ms', JSON.stringify(Object.fromEntries(Object.entries(world.timing || {}).map(([k, v]) => [k, Math.round(v)]))));
  game.devWorld = world;

  const shots = {
    wide: [[40, 55, 120], [-20, 30, -380]],
    coil: [[120, 230, -120], [0, 20, -400]],
    coilLow: [[230, 25, -560], [0, 35, -380]],
    coilLit: [[150, 70, -650], [0, 30, -380]],
    stack: [[-120, 6, -60], [-170, 40, -170]],
    stackLit: [[-95, 14, -300], [-170, 42, -170]],
    cave: [[-150, 4, -100], [-170, 6, -170]],
    cliff: [[-40, 18, -230], [10, 30, -330]],
    peak: [[-140, 70, -380], [-420, 90, -760]],
    ammonite: [[140, 40, -520], [330, 50, -330]],
    forming: [[260, 40, -430], [420, 15, -700]],
    giant: [[-330, 60, -160], [-560, 80, -260]],
    arch: [[200, 25, 280], [260, 70, 60]],
    atoll: [[-420, 160, 520], [-650, 0, 260]],
    reef: [[-60, 12, -190], [-170, -4, -170]],
    under: [[-140, -6, -110], [-170, -8, -170]],
    top: [[0, 900, -300], [0, 0, -301]],
    garden: [[0, 8, 145], [0, 3, 118]],
    lod: [[0, 120, 1400], [0, 30, -380]],
    far: [[0, 60, 2600], [0, 30, -380]],
  };
  let v = shots[p.get('shot') || 'wide'] || shots.wide;
  if (p.get('cam')) v = [p.get('cam').split(',').map(Number), (p.get('look') || '0,0,-300').split(',').map(Number)];
  const cam = game.engine.camera;
  cam.far = 16000;
  cam.updateProjectionMatrix();
  game.cameraRig.update = () => {
    cam.position.set(...v[0]);
    cam.lookAt(...v[1]);
  };
  game.focus.set(v[1][0], Math.max(10, v[1][1]), v[1][2]);
  game.engine.shadows.radius = 260;
  game.devUpdate = () => world.updateVisibility(0);
}

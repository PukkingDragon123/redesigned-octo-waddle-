// Dev scene: the spiral islands of Vur Sok (archetypes, materials, vegetation) on a sea at y = 0.
// ?debug&test=islands&time=morning&shot=wide|coil|stack|cliff|peak|forming|under|top|lod
//   &cam=x,y,z&look=x,y,z overrides the shot; &lod=1 shows the far LOD meshes.
import { Vector3, Group } from 'three';
import { buildIsland, stackShape, coilShape, peakShape } from '../world/Islands.js';
import { placeholderSea } from '../world/Water.js';

export default async function (game) {
  const p = game.params;
  const scene = game.engine.scene;
  placeholderSea(game);
  const root = new Group();
  root.name = 'islands-dev';
  scene.add(root);
  const useLod = p.get('lod') === '1';
  const t0 = performance.now();
  const specs = [
    { name: 'coil', pos: [0, 0, -380], shape: coilShape({ a: 22, b: 0.2, turns: 1.75, kw: 0.23, Hin: 62, seed: 5, steps: 11 }), style: { rock: 'banded' } },
    { name: 'stackA', pos: [-170, 0, -170], shape: stackShape({ R: 20, H: 92, lobes: 2, lobeAmp: 0.2, twist: 0.7, seed: 3, caves: [{ th: 0.4, w: 0.32, h: 10, depth: 0.42 }] }), style: { rock: 'limestone' } },
    { name: 'stackB', pos: [150, 0, -150], shape: stackShape({ R: 14, H: 70, lobes: 3, lobeAmp: 0.16, twist: 1.0, seed: 9, topFrac: 0.9, bulge: 0.2, notch: 0.24 }), style: { rock: 'banded' } },
    { name: 'stackC', pos: [-60, 0, -120], shape: stackShape({ R: 8, H: 40, lobes: 2, lobeAmp: 0.25, twist: 1.3, seed: 11, cap: 'point', topFrac: 0.3 }), style: { rock: 'banded' } },
    { name: 'peak', pos: [-380, 0, -720], shape: peakShape({ R: 75, H: 185, turns: 2.3, seed: 6 }), style: { rock: 'warm' } },
    { name: 'forming', pos: [380, 0, -640], shape: coilShape({ a: 16, b: 0.2, turns: 1.5, kw: 0.28, Hin: 32, seed: 21, steps: 7, dir: -1, tipH: -3, horn: { H: 55, twist: 0.6, lobes: 2 } }), style: { rock: 'volcanic', meadow: 0.3, heat: (P) => 0 } },
  ];
  const islands = {};
  for (const sp of specs) {
    const isl = buildIsland({ shape: sp.shape, style: sp.style, seed: sp.pos[0] * 7 + sp.pos[2] });
    const m = useLod && isl.far ? isl.far : isl.mesh;
    m.position.set(sp.pos[0], 0, sp.pos[2]);
    root.add(m);
    game.engine.shadows.addCaster(m);
    islands[sp.name] = { isl, pos: new Vector3(...sp.pos) };
  }
  console.log('[islands] built in', (performance.now() - t0).toFixed(0), 'ms');
  game.devIslands = islands;

  const shots = {
    wide: [[40, 55, 120], [-20, 30, -380]],
    coil: [[120, 230, -120], [0, 20, -400]],
    stack: [[-120, 6, -60], [-170, 40, -170]],
    stackLit: [[-95, 14, -300], [-170, 42, -170]],
    coilLit: [[150, 70, -650], [0, 30, -380]],
    coilLow: [[230, 25, -560], [0, 35, -380]],
    cliff: [[-40, 18, -230], [10, 30, -330]],
    peak: [[-140, 70, -380], [-380, 90, -720]],
    forming: [[260, 40, -430], [380, 15, -640]],
    under: [[-140, -6, -110], [-170, -8, -170]],
    top: [[0, 600, -380], [0, 0, -381]],
  };
  let v = shots[p.get('shot') || 'wide'];
  if (p.get('cam')) v = [p.get('cam').split(',').map(Number), (p.get('look') || '0,0,-300').split(',').map(Number)];
  const cam = game.engine.camera;
  cam.far = 16000;
  cam.updateProjectionMatrix();
  game.cameraRig.update = () => {
    cam.position.set(...v[0]);
    cam.lookAt(...v[1]);
  };
  game.focus.set(v[1][0], Math.max(10, v[1][1]), v[1][2]);
  game.engine.shadows.radius = 420;
}

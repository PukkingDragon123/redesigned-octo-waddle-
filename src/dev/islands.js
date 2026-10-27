// Dev scene: floating islands with vegetation over the cloud ocean.
// ?debug&test=islands&time=morning&shot=wide|close|under|tree|giant
import { Vector3 } from 'three';
import { buildIsland } from '../world/Islands.js';
import { Vegetation, TEMPLATES, PALETTES } from '../world/Trees.js';
import { rng } from '../core/math.js';

export default async function (game) {
  const p = game.params;
  const s = game.engine.scene;
  const veg = new Vegetation(game);
  const specs = [
    { R: 70, H: 32, D: 110, seed: 1, pos: [0, 120, -260], trees: 14 },
    { R: 34, H: 18, D: 60, seed: 2, pos: [-120, 170, -200], trees: 5 },
    { R: 120, H: 50, D: 170, seed: 3, pos: [200, 90, -520], giant: true, trees: 10 },
    { R: 22, H: 12, D: 40, seed: 4, pos: [70, 190, -150], trees: 2 },
    { R: 50, H: 60, D: 120, seed: 5, pos: [-260, 140, -560], trees: 8 },
  ];
  const r = rng(5);
  for (const sp of specs) {
    const isl = buildIsland(sp);
    isl.mesh.position.set(...sp.pos);
    s.add(isl.mesh);
    game.engine.shadows.addCaster(isl.mesh);
    const o = new Vector3(...sp.pos);
    const kinds = ['broadleaf', 'umbrella', 'cypress', 'willow'];
    for (let i = 0; i < sp.trees; i++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * sp.R * 0.75;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const kind = kinds[Math.floor(r() * kinds.length)];
      const seed = Math.floor(r() * 4) + 1;
      const pal = kind === 'umbrella' ? PALETTES.deep : kind === 'willow' ? PALETTES.spring : PALETTES.green;
      veg.add(kind + seed, () => TEMPLATES[kind](seed, pal), new Vector3(o.x + x, o.y + isl.surfaceY(x, z) - 0.3, o.z + z), 0.8 + r() * 0.6, r() * 6.28);
    }
    for (let i = 0; i < sp.trees * 2; i++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * sp.R * 0.85;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const b = r() < 0.6;
      veg.add(b ? 'bush1' : 'boulder1', () => (b ? TEMPLATES.bush(1) : TEMPLATES.boulder(1)), new Vector3(o.x + x, o.y + isl.surfaceY(x, z) - 0.2, o.z + z), b ? 0.8 + r() : 1 + r() * 2.5, r() * 6.28);
    }
    if (sp.giant) veg.add('giant1', () => TEMPLATES.giant(1, PALETTES.deep), new Vector3(o.x, o.y + isl.surfaceY(0, 0) - 2, o.z), 1, 0);
  }
  veg.build(s, game.engine.shadows);
  game.clouds.cumulus(new Vector3(-60, 60, -420), 200, 120, { seed: 11 });
  game.clouds.cumulus(new Vector3(160, 140, -300), 120, 80, { seed: 12 });
  const shots = {
    wide: [[30, 160, 40], [0, 120, -300]],
    close: [[40, 140, -150], [0, 110, -260]],
    under: [[20, 30, -120], [0, 60, -260]],
    tree: [[25, 135, -200], [0, 128, -250]],
    giant: [[60, 200, -250], [200, 180, -520]],
  };
  const v = shots[p.get('shot') || 'wide'];
  const cam = game.engine.camera;
  game.cameraRig.update = () => {
    cam.position.set(...v[0]);
    cam.lookAt(...v[1]);
  };
  game.focus.set(0, 120, -260);
  game.engine.shadows.radius = 300;
}

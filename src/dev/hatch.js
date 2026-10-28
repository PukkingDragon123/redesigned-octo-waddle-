// Dev scene: the Spiral Maelstrom and the whale egg in its calm eye.
// ?debug&test=hatch&ocean&shot=aerial|eye|macro|under|crack|hatch
//   &time=<preset>   &radius=<m> &depth=<m> &spin=<rad/s>   &ease=<s> (default: built at once)
//   &orbit (slow circle)  &whales (two guardians circling the rim)  &hatchAt=<s> (shot=hatch: 1.0)
//   &odebug=1..7 ocean debug views   &painterly=0 plain frame
// window.__egg / window.__ocean for poking; window.__mael() prints the costs.
import { Vector3 } from 'three';
import { Ocean } from '../world/Ocean.js';
import { WhaleEgg } from '../creatures/egg/WhaleEgg.js';
import { G } from '../render/Globals.js';

export default async function (game) {
  const p = game.params;
  const ocean = game.ocean && game.ocean instanceof Ocean ? game.ocean : (game.ocean = new Ocean(game));
  window.__ocean = ocean;
  window.__G = G;
  if (!p.has('time')) game.atmosphere.set('noon');
  if (p.has('odebug')) ocean.uniforms.uDebug.value = +p.get('odebug');
  if (game.engine.painterly && p.get('painterly') === '0') game.engine.painterly.enabled = false;
  ocean.setSeaState(+(p.get('state') ?? 0.3), { dur: 0.01 });

  const C = new Vector3(0, 0, -60);
  const R = +(p.get('radius') ?? 90);
  ocean.setWhirlpool('nursery', {
    center: C, radius: R, depth: +(p.get('depth') ?? 10), spin: +(p.get('spin') ?? 0.14), ease: +(p.get('ease') ?? 0.01),
  });
  // force the strength in now (no wait for the ease)
  ocean.update(1 / 60);

  const shot = p.get('shot') || 'aerial';
  const egg = new WhaleEgg(game, { position: C, length: 3.2, glow: 1, pulse: 1.1 });
  window.__egg = egg;
  game.addSystem({ update: (dt) => egg.update(dt) });

  if (shot === 'crack') {
    egg.setPulse(2.2).setGlow(1.4);
    egg.crack(0.75);
  }
  const hatchAt = +(p.get('hatchAt') ?? 1.0);
  if (shot === 'hatch') {
    egg.setPulse(2.4).setGlow(1.5).crack(0.9);
    game.addSystem({ update: () => { if (!egg.hatched && game.time > hatchAt) egg.hatch(); } });
  }

  // two guardians circling the rim (optional: costly in the headless renderer)
  if (p.has('whales')) {
    const { WhaleModel } = await import('../creatures/WhaleModel.js');
    const { ADULTS } = await import('../creatures/WhaleTypes.js');
    const ws = [0, 1].map((i) => {
      const m = new WhaleModel(ADULTS[i] || ADULTS[0]);
      game.engine.scene.add(m.group);
      m.castShadows?.(game.engine.shadows);
      return m;
    });
    game.addSystem({ update: () => {
      ws.forEach((m, i) => {
        const a = game.time * 0.12 + i * Math.PI;
        const r = R * 0.62;
        const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
        m.group.position.set(x, ocean.heightAt(x, z) - 0.6, z);
        m.group.rotation.y = -a;
      });
    } });
  }

  // camera views: [position, look-at]; aerial relative to the vortex centre, the rest to the egg
  const views = {
    aerial: [[0, 95, 150], [0, -6, 0]],
    eye: [[14, 9, 20], [0, -1.2, 0]],
    macro: [[0.3, 0.75, 4.7], [0, -0.05, 0]],
    crack: [[1.4, 1.5, 5.4], [0, 0.1, 0]],
    hatch: [[2.5, 2.6, 9.5], [0, 0.6, 0]],
    under: [[6, -6, 10], [0, -0.3, 0]],
  };
  const v = views[shot] || views.aerial;
  const near = shot !== 'aerial';
  const cam = game.engine.camera;
  const tmp = new Vector3(), lk = new Vector3(), up = new Vector3(0, 1, 0);
  const P0 = new Vector3(...v[0]), L0 = new Vector3(...v[1]);
  game.cameraRig.update = () => {
    const base = near ? egg.position : C;
    tmp.copy(P0);
    if (p.has('orbit')) tmp.applyAxisAngle(up, game.time * 0.06);
    tmp.add(base);
    lk.copy(L0).add(base);
    cam.position.copy(tmp);
    cam.lookAt(lk);
  };
  game.focus.copy(C);
  game.engine.shadows.radius = shot === 'aerial' ? 160 : 40;
  game.engine.shadowFocus?.copy?.(C);

  window.__mael = () => {
    const r = game.engine.renderer.info;
    return {
      calls: r.render.calls, tris: r.render.triangles, eggY: +egg.position.y.toFixed(2),
      sea: +ocean.heightAt(C.x, C.z).toFixed(2), whirl: ocean.getWhirlpool('nursery')?.s,
      programs: r.programs?.length,
    };
  };
}

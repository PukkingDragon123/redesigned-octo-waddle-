// Dev scene (particles builder): a quick gallery of the particle effects over the sea, emitted at
// t = 1 s so a short render shows them in flight.
// ?debug&test=rp-fx&dt=0.033&frames=45 [&shot=above|under|night|boom] [&time=<preset>]
//   above: a splash, a calf's spout, whitewater, droplets and rain rings; under: bubble bursts and
//   curtains from below; night: plankton bokeh and lit spray; boom: a calf's condensation shell.
import { Vector3 } from 'three';
import { Ocean } from '../world/Ocean.js';
import * as Swim from '../game/Swim.js';
import { SonicBooms } from '../game/SonicBoom.js';

export default async function (game) {
  const p = game.params;
  const shot = p.get('shot') || 'above';
  if (game.cloudSea) game.cloudSea.enabled = false;
  if (!p.get('time')) game.atmosphere.set(shot === 'night' ? 'night' : 'morning');
  const ocean = game.ocean && game.ocean instanceof Ocean ? game.ocean : new Ocean(game);
  game.ocean = ocean;
  ocean.setSeaState?.(+(p.get('state') ?? 0.3), { dur: 0.01 });
  const cam = game.engine.camera;
  const under = shot === 'under';
  const eye = under ? new Vector3(0, -6, 14) : shot === 'boom' ? new Vector3(0, 8, 16) : new Vector3(0, 4, 18);
  const look = under ? new Vector3(0, -2, 0) : shot === 'boom' ? new Vector3(0, 7, 0) : new Vector3(0, 2.5, 0);
  game.cameraRig.update = () => { cam.position.copy(eye); cam.lookAt(look); };
  game.focus.copy(look);
  const fakeCalf = {
    L: 4.2, isCalf: true, radius: 0.6, up: new Vector3(0, 1, 0), vel: new Vector3(0, 0, 0),
    fwd: new Vector3(1, 0, 0),
  };
  const booms = { game, _em: { pos: new Vector3(), vel: new Vector3(), color: [1, 1, 1] } };
  let fired = false;
  const v = new Vector3();
  game.devUpdate = () => {
    if (fired || game.time < 1.0) return;
    fired = true;
    const sea = (x, z) => ocean.heightApprox(x, z);
    if (shot === 'above' || shot === 'night') {
      ocean.splash(v.set(-7, sea(-7, 0), 0), 1.6, 3);
      Swim.spoutColumn?.(game, v.set(4, sea(4, 0) + 0.4, 0), fakeCalf, 1);
      for (let i = 0; i < 40; i++) {
        const x = (Math.random() - 0.5) * 20, z = 4 + Math.random() * 8;
        game.mist.emit({ pos: v.set(x, sea(x, z) + 0.03, z), life: 0.7, size: 0.02, sizeEnd: 0.2, kind: 8, stretch: 0.12, alpha: 0.5, drag: 0, fadeIn: 0.02 });
      }
      for (let i = 0; i < 12; i++) {
        game.mist.emit({ pos: v.set(-2 + i * 0.3, 3 + Math.sin(i) * 0.3, 8), vel: new Vector3(3, 4 - i * 0.6, 0), life: 2, size: 0.012, sizeEnd: 0.012, kind: 3, gravity: 9.8, drag: 0.1, alpha: 0.95, fadeIn: 0.01 });
      }
      if (shot === 'night') {
        for (let i = 0; i < 60; i++) {
          game.glow.emit({ pos: v.set((Math.random() - 0.5) * 16, 0.5 + Math.random() * 5, Math.random() * 10), life: 4, size: 0.04 + Math.random() * 0.12, sizeEnd: 0.05, kind: 1, color: [0.25, 0.8, 0.85], alpha: 0.8, drag: 0.1, fadeIn: 0.1 });
        }
      }
    } else if (under) {
      for (let i = 0; i < 160; i++) {
        const u = Math.random();
        game.mist.emit({ pos: v.set(-3 + Math.random() * 1.5, -6 + Math.random() * 4, Math.random() * 2), vel: new Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.2, (Math.random() - 0.5) * 1.5), life: 9, size: 0.004 + 0.07 * u * u * u, sizeEnd: (0.004 + 0.07 * u * u * u) * 1.25, kind: 4, alpha: 0.85, drag: 1.6, fadeIn: 0.03 });
      }
      game.story?.eco?.bubbles?.emit?.(v.set(4, -7, 0), 1.5);
    } else if (shot === 'boom') {
      SonicBooms.prototype._paint.call(booms, new Vector3(1.6, 7, 0), 30, 90, 0.8, fakeCalf);
    }
  };
}

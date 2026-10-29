// The effects systems that replaced the round vapour puffs (docs/VUR_SOK.md 0.10): splashes and
// spouts (Splash), streamlines of moving air (WindLines). One shared instance per game, created on
// first use (the ocean asks for it as it is built, so the meshes exist before the title's
// precompile); each system is a single draw call and steps itself before every render.
import { G } from '../render/Globals.js';
import { Splash } from './Splash.js';
import { WindLines } from './WindLines.js';

class FX {
  constructor(game) {
    this.game = game;
    this.splash = new Splash(game);
    this.wind = new WindLines(game);
    this._t = null;
    game.engine.beforeRender.push(() => this.update());
  }

  update() {
    const t = G.uTime.value;
    const dt = this._t === null ? 0 : Math.min(0.1, Math.max(0, t - this._t));
    this._t = t;
    this.splash.update(dt);
    this.wind.update(dt);
  }
}

/** The game's effects systems (created on the first call). */
export function fx(game) {
  return game.fx || (game.fx = new FX(game));
}

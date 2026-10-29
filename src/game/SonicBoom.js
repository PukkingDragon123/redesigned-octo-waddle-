// Sonic booms from the throat resonator: a pressure wave that blows clouds apart (they slowly reform),
// shows as a burst of air lines racing out with the pressure front and a bright shock line with ring
// waves over the sea below (no vapour puffs: docs/VUR_SOK.md 0.10), shakes the camera,
// scatters creatures and knocks back the falcon.
// Adults' booms are far larger and can be synchronised into one enormous protective wave.
import { Vector3 } from 'three';
import { G } from '../render/Globals.js';
import { clamp, smoothstep } from '../core/math.js';
import { fx } from '../fx/FX.js';

const _d = new Vector3();
const _hz = new Vector3();

export class SonicBooms {
  constructor(game) {
    this.game = game;
    this.active = [];
    this.slot = 0;
    this._em = { pos: new Vector3(), vel: new Vector3(), life: 1, size: 1, sizeEnd: 1, alpha: 1, drag: 1, gravity: 0, kind: 0, color: [1, 1, 1], fadeIn: 0.02, stretch: 4 };
    this.hooks = [];
    this.charge = null; // {pos (Vector3), amount}
  }

  /** Spawn a boom. opts: { power 0..1+, radius (max m), speed (m/s), strength (cloud push m), source } */
  spawn(center, opts = {}) {
    const g = this.game;
    const power = opts.power ?? 1;
    const radius = opts.radius ?? 40 * power;
    const speed = opts.speed ?? 70 + radius * 0.6;
    const strength = opts.strength ?? radius * 0.35;
    const i = this.slot++ % G.uBooms.value.length;
    G.uBooms.value[i].set(center.x, center.y, center.z, g.time);
    G.uBoomParams.value[i].set(radius, strength, speed, 0);
    const b = { center: center.clone(), t: 0, radius, speed, power, hitFalcon: false, source: opts.source };
    this.active.push(b);
    this._paint(center, radius, speed, power, opts.source);
    // camera shake by proximity
    const camD = g.engine.camera.position.distanceTo(center);
    g.cameraRig.addShake(clamp(1.2 - camD / (radius * 2.5), 0, 1) * (0.4 + power * 0.4));
    for (const h of this.hooks) h(b);
    return b;
  }

  update(dt) {
    const g = this.game;
    const cam = g.engine.camera;
    const shocks = g.engine.post.composite.uniforms.uShock.value;
    for (let k = 0; k < shocks.length; k++) shocks[k].set(0, 0, 0, 0);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      b.t += dt;
      const r = b.speed * b.t;
      const life = b.radius / b.speed;
      const fade = 1 - smoothstep(life * 0.5, life * 1.05, b.t);
      b.front = r;
      const F = this.falcon;
      if (b.knockFalcon && !b.hitFalcon && F && F.mode !== 'hidden' && F.mode !== 'knockback' && F.pos.distanceTo(b.center) < r + F.radius) {
        b.hitFalcon = true;
        F.knockback(b.center, b.knockFalcon);
      }
      // the wave passing over the camera: a soft full-screen pulse (no lens ring: it read as a circle)
      if (fade > 0.01) {
        const dist = cam.position.distanceTo(b.center);
        if (dist <= r * 1.1 && dist >= r * 0.6) {
          const pu = g.engine.post.composite.uniforms.uPulse;
          pu.value = Math.max(pu.value, fade * 0.6);
        }
      }
      if (b.t > life * 1.1) {
        this.active.splice(i, 1);
      }
    }
    const pu = g.engine.post.composite.uniforms.uPulse;
    pu.value = Math.max(0, pu.value - dt * 1.5);
    // charging haze at the throat
    const haze = g.engine.post.composite.uniforms.uHaze.value;
    if (this.charge && this.charge.amount > 0.02) {
      const v = _hz.copy(this.charge.pos).project(cam);
      if (v.z < 1) haze.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, 0.08 + this.charge.amount * 0.14, this.charge.amount);
      else haze.set(0, 0, 0, 0);
    } else haze.set(0, 0, 0, 0);
  }

  /**
   * The boom made visible without any vapour: a burst of air lines racing out with the pressure
   * front (src/fx/WindLines.js), a bright shock line and ring waves running over the sea below, and,
   * when the boom is close to the water, a sheet of spray torn off the surface under it.
   */
  _paint(center, radius, speed, power, src) {
    const g = this.game, E = this._em;
    if (!g.engine) return;
    const F = fx(g);
    F.wind.burst(center, radius, speed, power);
    // the pressure wave on the sea, if the boom is low enough to touch it
    const sea = g.ocean?.heightApprox ? g.ocean.heightApprox(center.x, center.z) : G.uSeaLevel.value;
    const h = center.y - sea;
    if (h < radius * 0.9 && h > -2) {
      const reach = Math.sqrt(Math.max(radius * radius - h * h, 1)) * 0.9;
      const near = clamp(1.4 - h / radius, 0.2, 1);
      _d.set(center.x, sea, center.z);
      g.ocean?.ringWave?.(_d, (0.6 + power * 0.6) * near, reach * 0.4);
      // the shock front: a thin bright line racing out over the water (and a fainter echo)
      if (g.mist) {
        for (let k = 0; k < 2; k++) {
          E.pos.set(center.x, sea + 0.05, center.z);
          E.vel.set(0, 0, 0);
          E.life = clamp(reach / speed, 0.4, 3) * (1.1 + k * 0.5); E.size = Math.max(1, h * 0.3); E.sizeEnd = reach * (1 - k * 0.35);
          E.alpha = 0.45 * near * (1 - k * 0.4); E.drag = 0; E.gravity = 0; E.kind = 8; E.fadeIn = 0.03;
          E.stretch = 0.05 + k * 0.05;
          E.color[0] = 1.1; E.color[1] = 1.12; E.color[2] = 1.15;
          g.mist.emit(E);
        }
        E.stretch = 4;
      }
      // close over the water: the blast tears a sheet of spray off the surface below
      if (h < Math.max(8, radius * 0.25)) {
        const k = clamp(1 - h / Math.max(8, radius * 0.25), 0.2, 1);
        F.splash.sheet(_d, clamp(2 + h * 0.4, 2, 10), (1 + 2.2 * power) * k, null, 0.85 * k);
      }
    }
  }
}

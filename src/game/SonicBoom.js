// Sonic booms from the throat resonator: a pressure wave that blows clouds apart (they slowly reform),
// shows as a real condensation flash (a thin vapour shell or cone that forms around the whale and
// evaporates within a second, plus a pressure ripple racing over the sea below), shakes the camera,
// scatters creatures and knocks back the falcon.
// Adults' booms are far larger and can be synchronised into one enormous protective wave.
import { Vector3 } from 'three';
import { G } from '../render/Globals.js';
import { clamp, lerp, smoothstep } from '../core/math.js';

const _f = new Vector3();
const _u = new Vector3();
const _w = new Vector3();
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
   * The boom made visible the way air shows it: the pressure drop condenses the humid air into a
   * thin vapour shell for a moment (a cone opening back from the nose when a whale makes it, a
   * sphere otherwise), dense at first and eroding away in under a second; a dark ripple of
   * roughened water races out over the sea below.
   */
  _paint(center, radius, speed, power, src) {
    const g = this.game, E = this._em;
    if (!g.mist) return;
    const L = src?.L ?? clamp(radius * 0.08, 3, 30);
    const cone = !!src?.fwd;
    if (cone) _f.copy(src.fwd); else _f.set(0, 1, 0);
    _u.set(0, 1, 0).cross(_f);
    if (_u.lengthSq() < 1e-6) _u.set(1, 0, 0);
    _u.normalize();
    _w.copy(_f).cross(_u).normalize();
    // the shell: big enough to wrap the whale, bigger for bigger booms
    const R = clamp(L * 0.55 + radius * 0.012, 1.5, 40);
    // many small, faint puffs that overlap into one smooth translucent veil (a real condensation
    // shell is thin and glassy, gone in a blink; a few big puffs read as a ball of cotton)
    const n = Math.round(clamp(220 + power * 80, 220, 380));
    const puff = R * (cone ? 0.12 : 0.1);
    for (let k = 0; k < n; k++) {
      // even coverage: a golden-angle spiral over the shell
      const u = (k + 0.5) / n;
      const az = k * 2.39996 + Math.random() * 0.3;
      let along, rad;
      if (cone) {
        // a bell from just behind the head flaring back past the wings
        along = -u * R * 1.5;
        rad = R * (0.35 + 0.75 * Math.sqrt(u));
      } else {
        const ct = 1 - 2 * u;
        along = ct * R;
        rad = Math.sqrt(Math.max(0, 1 - ct * ct)) * R;
      }
      _d.copy(_u).multiplyScalar(Math.cos(az) * rad).addScaledVector(_w, Math.sin(az) * rad).addScaledVector(_f, along);
      E.pos.copy(center).add(_d);
      // it barely moves: the vapour forms in place, swells a little, and is left behind
      _d.normalize();
      E.vel.copy(_d).multiplyScalar(R * lerp(0.25, 0.55, Math.random()));
      if (src?.vel) E.vel.addScaledVector(src.vel, 0.25);
      E.life = lerp(0.3, 0.6, Math.random()) * (cone ? 1 : 1.15); E.size = puff * lerp(0.8, 1.25, Math.random()); E.sizeEnd = E.size * 2.3;
      E.alpha = lerp(0.09, 0.18, Math.random()) * (cone ? 1 - 0.45 * u : 1); E.drag = 4; E.gravity = 0; E.kind = 0; E.fadeIn = 0.012;
      E.color[0] = 1; E.color[1] = 1; E.color[2] = 1;
      g.mist.emit(E);
    }
    // the pressure ripple on the sea, if the boom is low enough to touch it
    const sea = g.ocean?.heightApprox ? g.ocean.heightApprox(center.x, center.z) : G.uSeaLevel.value;
    const h = center.y - sea;
    if (h < radius * 0.9 && h > -2) {
      const reach = Math.sqrt(Math.max(radius * radius - h * h, 1)) * 0.9;
      for (let k = 0; k < 2; k++) {
        E.pos.set(center.x, sea + 0.05, center.z);
        E.vel.set(0, 0, 0);
        E.life = clamp(reach / speed, 0.4, 3) * (1.1 + k * 0.5); E.size = Math.max(1, h * 0.3); E.sizeEnd = reach * (1 - k * 0.35);
        E.alpha = 0.4 * clamp(1.4 - h / radius, 0.2, 1) * (1 - k * 0.4); E.drag = 0; E.gravity = 0; E.kind = 8; E.fadeIn = 0.03;
        E.stretch = 0.14 + k * 0.08;
        E.color[0] = 0.95; E.color[1] = 0.97; E.color[2] = 1.0;
        g.mist.emit(E);
      }
      E.stretch = 4;
    }
  }
}

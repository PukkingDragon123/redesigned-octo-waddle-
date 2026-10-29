// Sonic booms from the throat resonator: a pressure wave that blows clouds apart (they slowly reform),
// bursts out as a painted 2D effect (a soft flash and a few hand-drawn arcs and strokes of wind, never a
// perfect ring or a lens circle), shakes the camera, scatters creatures and knocks back the falcon.
// Adults' booms are far larger and can be synchronised into one enormous protective wave.
import { Vector3 } from 'three';
import { G } from '../render/Globals.js';
import { clamp, lerp, smoothstep } from '../core/math.js';

const _f = new Vector3();
const _u = new Vector3();
const _w = new Vector3();
const _d = new Vector3();
const _hz = new Vector3();
const TAU = Math.PI * 2;

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
    this._paint(center, radius, speed, power);
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
   * The boom as a painted burst: a soft flash at the throat and a few hand-drawn arcs of wind flung
   * outward (uneven angles, radii and lengths, so it never closes into a ring), with a handful of
   * straight-ish speed strokes between them. Laid out across the view so it reads on screen.
   */
  _paint(center, radius, speed, power) {
    const g = this.game, E = this._em;
    if (!g.mist) return;
    const cam = g.engine.camera;
    cam.getWorldDirection(_f);
    _u.set(0, 1, 0).cross(_f);
    if (_u.lengthSq() < 1e-6) _u.set(1, 0, 0);
    _u.normalize();
    _w.copy(_f).cross(_u).normalize();
    const camD = Math.max(1, cam.position.distanceTo(center));
    const width = clamp(radius * 0.026, 0.15, 6) * clamp(camD / 25, 0.6, 1.6);
    const out = speed * 0.32;
    // soft flash: a few overlapping painted glow dots, quick
    if (g.glow) {
      for (let k = 0; k < 4; k++) {
        E.pos.copy(center).addScaledVector(_u, (Math.random() - 0.5) * radius * 0.04).addScaledVector(_w, (Math.random() - 0.5) * radius * 0.04);
        E.vel.set(0, 0, 0);
        E.life = 0.16 + Math.random() * 0.1; E.size = clamp(radius * 0.03, 0.4, 9) * (0.6 + Math.random() * 0.6); E.sizeEnd = E.size * 1.5;
        E.alpha = 0.4; E.drag = 0; E.gravity = 0; E.kind = 1; E.fadeIn = 0.01;
        E.color[0] = 1; E.color[1] = 0.96; E.color[2] = 0.88;
        g.glow.emit(E);
      }
    }
    const arcs = Math.round(clamp(5 + power * 3, 5, 10));
    const a0 = Math.random() * TAU;
    for (let k = 0; k < arcs; k++) {
      const a = a0 + ((k + (Math.random() - 0.5) * 0.7) / arcs) * TAU;
      _d.copy(_u).multiplyScalar(Math.cos(a)).addScaledVector(_w, Math.sin(a)).addScaledVector(_f, (Math.random() - 0.5) * 0.3).normalize();
      const sp = out * lerp(0.6, 1.05, Math.random());
      E.pos.copy(center).addScaledVector(_d, radius * lerp(0.04, 0.1, Math.random()));
      E.vel.copy(_d).multiplyScalar(sp);
      E.life = lerp(0.6, 0.9, Math.random()); E.size = width * lerp(0.8, 1.25, Math.random()); E.sizeEnd = E.size * 1.4;
      E.alpha = 0.75; E.drag = 2.4; E.gravity = 0; E.kind = 7; E.fadeIn = 0.02;
      E.stretch = lerp(2.2, 3.4, Math.random());
      E.color[0] = 0.97; E.color[1] = 0.99; E.color[2] = 1.0;
      g.mist.emit(E);
      // a speed stroke between this arc and the next
      if (Math.random() < 0.45) {
        const b = a + (TAU / arcs) * lerp(0.35, 0.65, Math.random());
        _d.copy(_u).multiplyScalar(Math.cos(b)).addScaledVector(_w, Math.sin(b)).normalize();
        E.pos.copy(center).addScaledVector(_d, radius * lerp(0.06, 0.14, Math.random()));
        E.vel.copy(_d).multiplyScalar(sp * 1.1);
        E.life = lerp(0.35, 0.55, Math.random()); E.size = width * 0.55; E.sizeEnd = E.size * 0.8;
        E.alpha = 0.55; E.kind = 6; E.stretch = lerp(3, 4.5, Math.random());
        g.mist.emit(E);
      }
    }
    E.stretch = 4;
  }
}

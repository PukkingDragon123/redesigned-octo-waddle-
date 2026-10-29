// Whales meeting the sea of Vur Sok: buoyancy, water drag, splashes, wakes, bubbles and breath.
// Runs after a whale's flight step (Whale.step), for the player's calf and for every herd whale,
// so the same water feels the same to everyone. It talks to the ocean through its contract API
// (heightAt / splash / wake) and falls back to a flat sea at y = 0.
import { Vector3 } from 'three';
import { clamp, smoothstep } from '../core/math.js';

const _p = new Vector3();
const _v = new Vector3();
// one reusable emit record (Particles.emit copies it), so splashes and bubbles allocate nothing
const _em = { pos: new Vector3(), vel: new Vector3(), life: 1, size: 0.3, sizeEnd: 1, alpha: 0.6, drag: 1, gravity: 0, kind: 0, color: [1, 1, 1], fadeIn: 0.05 };
const BREATH = 28; // seconds a calf can stay under before it must surface (adults: 4x)

/** Per-whale water state, kept on the whale as w.water. */
function state(w) {
  return w.water || (w.water = { sub: 0, depth: -99, inWater: false, air: 1, underT: 0, lastSplash: -9, bubbleT: 0, wasDeep: false });
}

/** Height of the sea surface under (x, z). */
export function seaHeight(game, x, z) {
  const o = game.ocean;
  return o && o.enabled !== false && o.heightAt ? o.heightAt(x, z) : 0;
}

/**
 * Apply the sea to one whale after its flight step. Returns its water state:
 * { sub 0..1 submersion, depth (m below the surface, negative above), inWater, air 0..1 }.
 * opts: { player: true } for the calf the player steers (breath, softer limits),
 *       onSplash(kind, pos, strength) for sounds: 'enter' | 'breach' | 'slap'.
 */
export function waterStep(w, dt, game, opts = {}) {
  const s = state(w);
  const surf = seaHeight(game, w.pos.x, w.pos.z);
  const r = Math.max(0.6, w.radius * 0.7);
  const depth = surf - w.pos.y;
  const sub = smoothstep(-r, r, depth);
  const speed = w.vel.length();
  const t = game.time;
  const wasIn = s.inWater;
  s.depth = depth;
  s.sub = sub;
  // hysteresis: a whale riding the surface in waves does not flicker in and out (and splash each time)
  s.inWater = wasIn ? sub > 0.35 : sub > 0.6;

  if (sub > 0.001) {
    // water is ~800x denser than air: strong drag, linear and quadratic
    const k = (0.55 + 0.9 * speed * 0.06) * sub;
    w.vel.multiplyScalar(Math.exp(-k * dt));
    // buoyancy organs and blubber float the whale up; swimming down overcomes it
    const P = w.phys;
    const lungs = opts.player ? 1 + 2.5 * (1 - s.air) : 1;
    w.vel.y += (P.sink + 3.2 * lungs) * sub * dt;
    // a soft floor: the deep is dark and cold, the body turns back toward the light
    const floor = opts.player ? 34 : 60;
    if (depth > floor) w.vel.y += (depth - floor) * 0.8 * dt;
  }

  // entering the sea: a splash sized by the impact
  if (!wasIn && s.inWater && t - s.lastSplash > 0.6) {
    const imp = Math.max(-w.vel.y, speed * 0.4);
    if (imp > 1.5) {
      s.lastSplash = t;
      const k = clamp(imp / 12, 0.2, 1.6) * (w.L / 6);
      _p.copy(w.pos).setY(surf);
      game.ocean?.splash?.(_p, k, w.L * 0.6);
      spray(game, _p, w, k, 1);
      opts.onSplash?.('enter', _p, k);
    }
  }
  // breaching: bursting out of the sea throws a sheet of water
  if (wasIn && !s.inWater && w.vel.y > 2 && t - s.lastSplash > 0.6) {
    s.lastSplash = t;
    const k = clamp(w.vel.y / 10, 0.2, 1.6) * (w.L / 6);
    _p.copy(w.pos).setY(surf);
    game.ocean?.splash?.(_p, k * 0.8, w.L * 0.5);
    spray(game, _p, w, k, 1.4);
    opts.onSplash?.('breach', _p, k);
  }
  // skimming the surface leaves a wake
  if (Math.abs(depth) < r * 1.4 && speed > 1) {
    _p.copy(w.pos).setY(surf);
    game.ocean?.wake?.(_p, w.vel, w.L * 0.35);
  }

  // breath: a calf holds it for about half a minute; surfacing refills it with a spout
  const limit = opts.player ? BREATH : BREATH * 4;
  if (depth > r * 0.3) {
    s.underT += dt;
    s.air = Math.max(0, s.air - dt / limit);
    if (depth > r * 1.5) s.wasDeep = true;
    // bubbles trickle from the blowhole now and then
    s.bubbleT -= dt;
    if (s.bubbleT <= 0) {
      s.bubbleT = 0.25 + Math.random() * 0.5;
      _p.copy(w.pos).addScaledVector(w.fwd, w.L * 0.25).addScaledVector(w.up, w.radius * 0.8);
      const E = _em;
      for (let i = 0; i < 3 && game.mist; i++) {
        E.pos.copy(_p).add(_v.set((Math.random() - 0.5) * 0.3, Math.random() * 0.2, (Math.random() - 0.5) * 0.3));
        E.vel.set((Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4);
        const u = Math.random();
        E.life = 9; E.size = 0.004 + 0.03 * u * u; E.sizeEnd = E.size * 1.2; E.alpha = 0.85; E.drag = 1.6; E.gravity = 0;
        E.color[0] = 1; E.color[1] = 1; E.color[2] = 1; E.kind = 4; E.fadeIn = 0.05;
        game.mist.emit(E);
      }
    }
  } else {
    if (s.wasDeep && depth < -r * 0.2) {
      // first breath after a dive: a vapour spout from the blowholes
      s.wasDeep = false;
      _p.copy(w.pos).addScaledVector(w.fwd, w.L * 0.22).addScaledVector(w.up, w.radius);
      spoutColumn(game, _p, w, 0.9);
      opts.onSplash?.('spout', _p, 0.5);
    }
    s.underT = 0;
    s.air = Math.min(1, s.air + dt / 3);
  }
  return s;
}

/** A splash: whitewater breaking into fine spray, heavier drops and a little mist around p. */
function spray(game, p, w, k, up) {
  if (!game.mist) return;
  const n = Math.round(12 + 26 * Math.min(k, 1.5));
  const E = _em;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random());
    const drop = i % 4 === 0;
    E.pos.set(p.x + Math.cos(a) * w.radius * rr, p.y + 0.1, p.z + Math.sin(a) * w.radius * rr);
    E.vel.set(Math.cos(a) * (1 + 3 * rr), (2.5 + 5 * Math.random()) * up * Math.min(1.4, 0.5 + k), Math.sin(a) * (1 + 3 * rr)).addScaledVector(w.vel, 0.25);
    E.life = 0.8 + Math.random() * 0.6;
    E.size = drop ? 0.006 + 0.012 * Math.random() : 0.12 + 0.12 * k * Math.random(); E.sizeEnd = drop ? E.size : E.size * 2.4;
    E.alpha = drop ? 0.95 : 0.85; E.drag = drop ? 0.15 : 0.5; E.gravity = 9.8;
    E.color[0] = 0.96; E.color[1] = 0.98; E.color[2] = 1.0; E.kind = drop ? 3 : 9; E.fadeIn = 0.01;
    game.mist.emit(E);
  }
  for (let i = 0; i < 3 + Math.round(3 * Math.min(k, 1.5)); i++) {
    const a = Math.random() * Math.PI * 2;
    E.pos.set(p.x + Math.cos(a) * w.radius, p.y + 0.4, p.z + Math.sin(a) * w.radius);
    E.vel.set(Math.cos(a) * 0.8, 0.8 + Math.random() * 1.2, Math.sin(a) * 0.8).addScaledVector(w.vel, 0.2);
    E.life = 1.8 + Math.random() * 1.2; E.size = w.radius * 0.5; E.sizeEnd = w.radius * (1.6 + Math.random());
    E.alpha = 0.2; E.drag = 1.2; E.gravity = 0.3; E.kind = 0; E.fadeIn = 0.1;
    E.color[0] = 1; E.color[1] = 1; E.color[2] = 1;
    game.mist.emit(E);
  }
}

const _sv = new Vector3();
const _sc = { pos: new Vector3(), vel: new Vector3(), life: 1, size: 0.3, sizeEnd: 1, alpha: 0.5, drag: 1, gravity: 0, kind: 0, color: [1, 1, 1], fadeIn: 0.05 };
/**
 * A whale's blow at the surface: a tall column of fine vapour shot up from the blowholes, slowing as
 * it rises, widening, and drifting off with the wind as it dissipates; a few fine drops fall back.
 * Height scales with the whale (a calf about 3 m, a mother about 9 m). Shared by Swim and the herd.
 */
export function spoutColumn(g, p, w, k = 1) {
  if (!g.mist) return;
  const E = _sc;
  const L = w.L || 4;
  const sc = Math.sqrt(L / 4.2);
  const n = Math.round((w.isCalf || L < 8 ? 34 : 48) * Math.min(k, 1.5));
  for (let i = 0; i < n; i++) {
    const u = i / n;
    E.pos.copy(p);
    // a fast jet (up to ~16 m/s on a calf, more on adults), heavy drag: puffs hang at every height
    const speed = (4 + 12 * Math.pow(Math.random(), 0.7)) * sc * Math.min(1.2, 0.6 + k * 0.4);
    E.vel.copy(w.up).multiplyScalar(speed).add(_sv.set((Math.random() - 0.5) * 2.2 * sc, 0, (Math.random() - 0.5) * 2.2 * sc)).addScaledVector(w.vel, 0.5);
    E.life = 2.4 + Math.random() * 2.2; E.size = (0.18 + 0.2 * u) * sc; E.sizeEnd = (1.0 + 1.0 * Math.random()) * sc;
    E.alpha = 0.3 + 0.15 * Math.random(); E.drag = 2.6 + Math.random(); E.gravity = -0.15; E.kind = 0; E.fadeIn = 0.04;
    E.color[0] = 0.97; E.color[1] = 0.98; E.color[2] = 1.0;
    g.mist.emit(E);
  }
  for (let i = 0; i < Math.round(10 * sc); i++) {
    E.pos.copy(p);
    E.vel.copy(w.up).multiplyScalar((5 + 6 * Math.random()) * sc).add(_sv.set((Math.random() - 0.5) * 2.5, 0, (Math.random() - 0.5) * 2.5)).addScaledVector(w.vel, 0.5);
    E.life = 1.2 + Math.random() * 0.8; E.size = 0.004 + 0.006 * Math.random(); E.sizeEnd = E.size;
    E.alpha = 0.9; E.drag = 0.4; E.gravity = 9.8; E.kind = 3; E.fadeIn = 0.01;
    g.mist.emit(E);
  }
}

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
        E.vel.set((Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.4);
        E.life = 1.6; E.size = 0.06 + Math.random() * 0.08; E.sizeEnd = 0.14; E.alpha = 0.7; E.drag = 0.6; E.gravity = -1.5;
        E.color[0] = 0.85; E.color[1] = 0.95; E.color[2] = 1.0; E.kind = 4; E.fadeIn = 0.05;
        game.mist.emit(E);
      }
    }
  } else {
    if (s.wasDeep && depth < -r * 0.2) {
      // first breath after a dive: a vapour spout from the blowholes
      s.wasDeep = false;
      _p.copy(w.pos).addScaledVector(w.fwd, w.L * 0.22).addScaledVector(w.up, w.radius);
      const E = _em;
      for (let i = 0; i < 14 && game.mist; i++) {
        E.pos.copy(_p);
        E.vel.set((Math.random() - 0.5) * 1.2, 4 + Math.random() * 4, (Math.random() - 0.5) * 1.2).multiplyScalar(w.L / 8);
        E.life = 1.4 + Math.random(); E.size = 0.15 * w.L / 4; E.sizeEnd = 0.9 * w.L / 4; E.alpha = 0.5; E.drag = 1.4; E.gravity = 0;
        E.color[0] = 1; E.color[1] = 1; E.color[2] = 1; E.kind = 0; E.fadeIn = 0.1;
        game.mist.emit(E);
      }
      opts.onSplash?.('spout', _p, 0.5);
    }
    s.underT = 0;
    s.air = Math.min(1, s.air + dt / 3);
  }
  return s;
}

/** A splash: painted spray puffs and a crown of drawn droplets thrown up around p. */
function spray(game, p, w, k, up) {
  if (!game.mist) return;
  const n = Math.round(10 + 22 * Math.min(k, 1.5));
  const E = _em;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.random();
    const drop = i % 3 === 0;
    E.pos.set(p.x + Math.cos(a) * w.radius * rr, p.y + 0.2, p.z + Math.sin(a) * w.radius * rr);
    E.vel.set(Math.cos(a) * (1 + 3 * rr), (3 + 6 * Math.random()) * up * Math.min(1.4, 0.5 + k) * (drop ? 1.25 : 1), Math.sin(a) * (1 + 3 * rr)).addScaledVector(w.vel, 0.25);
    E.life = 0.9 + Math.random() * 0.5;
    E.size = drop ? 0.1 + 0.08 * k : 0.3 + 0.4 * k; E.sizeEnd = drop ? 0.08 : 1.2 + 1.6 * k;
    E.alpha = drop ? 0.9 : 0.6; E.drag = drop ? 0.2 : 0.5; E.gravity = drop ? 9 : 7;
    E.color[0] = 0.95; E.color[1] = 0.98; E.color[2] = 1.0; E.kind = drop ? 3 : 0; E.fadeIn = 0.03;
    game.mist.emit(E);
  }
}

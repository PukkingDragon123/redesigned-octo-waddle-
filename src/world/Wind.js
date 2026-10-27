// Global wind: a slowly veering base wind, gusts, and local turbulence.
// Drives fur, foliage, cloud drift, particles, audio and the calf's flight.
import { Vector3 } from 'three';
import { G } from '../render/Globals.js';
import { noise } from '../core/noise.js';
import { damp } from '../core/math.js';

export class Wind {
  constructor() {
    this.dir = 0.6; // radians, heading of the wind
    this.strength = 3; // m/s
    this.targetStrength = 3;
    this.turbulence = 0.3;
    this.targetTurbulence = 0.3;
    this.gust = 0;
    this.t = 0;
    this.base = new Vector3();
    this.drift = new Vector3(); // integrated cloud drift
    this.driftSpeed = 0.25; // fraction of wind applied to drifting clouds
  }

  set(strength, turbulence) {
    this.targetStrength = strength;
    this.targetTurbulence = turbulence;
  }

  update(dt) {
    this.t += dt;
    this.strength = damp(this.strength, this.targetStrength, 0.3, dt);
    this.turbulence = damp(this.turbulence, this.targetTurbulence, 0.3, dt);
    this.dir += noise.noise2(this.t * 0.01, 3.1) * 0.01 * dt * 60;
    const g = noise.fbm2(this.t * 0.18, 7.3, 3);
    this.gust = Math.max(0, g) * this.turbulence * 2;
    const s = this.strength * (1 + this.gust);
    this.base.set(Math.sin(this.dir) * s, 0, Math.cos(this.dir) * s);
    G.uWind.value.copy(this.base);
    G.uGust.value = this.gust;
    this.drift.addScaledVector(this.base, dt * this.driftSpeed);
  }

  /** Local wind at a world position (turbulent eddies grow with turbulence). */
  sample(p, out = new Vector3()) {
    const k = 0.006, t = this.t * 0.15;
    const tu = this.turbulence * this.strength * 1.4;
    out.copy(this.base);
    out.x += noise.noise3(p.x * k, p.y * k + t, p.z * k) * tu;
    out.y += noise.noise3(p.x * k + 17, p.y * k, p.z * k - t) * tu * 0.6;
    out.z += noise.noise3(p.x * k - t, p.y * k + 31, p.z * k) * tu;
    return out;
  }
}

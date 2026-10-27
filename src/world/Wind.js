// Global wind: a slowly veering base wind, gusts, and local turbulence.
// Drives fur, foliage, cloud drift, particles, audio and the calf's flight.
import { Vector2, Vector3 } from 'three';
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
    this.driftDir = 0.6; // heading of the cloud drift (wanders freely, so the drift stays local)
    this.driftVel = new Vector3();
    this.driftSpeed = 0.25; // fraction of wind applied to drifting clouds
    this.wavePhase = 0; // meadow wave phase, integrated so gusts change speed, not phase
    this.ripple = new Vector2(); // lake ripple scroll (uv)
  }

  set(strength, turbulence) {
    this.targetStrength = strength;
    this.targetTurbulence = turbulence;
  }

  update(dt) {
    this.t += dt;
    this.strength = damp(this.strength, this.targetStrength, 0.3, dt);
    this.turbulence = damp(this.turbulence, this.targetTurbulence, 0.3, dt);
    this.dir = 0.6 + noise.noise2(this.t * 0.002, 3.1) * 0.5; // veers slowly within about +-30 deg
    this.driftDir += noise.noise2(this.t * 0.01, 3.1) * 0.6 * dt;
    const g = noise.fbm2(this.t * 0.18, 7.3, 3);
    this.gust = Math.max(0, g) * this.turbulence * 2;
    const s = this.strength * (1 + this.gust);
    this.base.set(Math.sin(this.dir) * s, 0, Math.cos(this.dir) * s);
    G.uWind.value.copy(this.base);
    G.uGust.value = this.gust;
    this.driftVel.set(Math.sin(this.driftDir), 0, Math.cos(this.driftDir)).multiplyScalar(s * this.driftSpeed);
    this.drift.addScaledVector(this.driftVel, dt);
    this.wavePhase = (this.wavePhase + dt * (1.2 + s * 0.12)) % (2 * Math.PI);
    this.ripple.x = (this.ripple.x + this.base.x * 0.004 * dt) % 1;
    this.ripple.y = (this.ripple.y + this.base.z * 0.004 * dt) % 1;
    G.uWavePhase.value = this.wavePhase;
    G.uRipple.value.copy(this.ripple);
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

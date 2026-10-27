// Time-of-day / weather palettes (the colour script from docs/ART_DIRECTION.md) and smooth
// transitions between them. Writes the global lighting uniforms every frame.
import { Color, Vector3 } from 'three';
import { G } from '../render/Globals.js';
import { DEG, lerp, smoothstep, saturate } from '../core/math.js';

const C = (hex, k = 1) => new Color(hex).multiplyScalar(k);
const V = (x, y, z) => new Vector3(x, y, z);

function preset(o) {
  return Object.assign({
    sunElev: 20, sunAz: 30, sun: C('#fff2dc', 2.4),
    zenith: C('#4a86d6'), horizon: C('#c1def3'),
    ambient: C('#a8c6ee', 0.8), bounce: C('#eef0f2', 0.7), shadowTint: C('#dfe6fb'),
    fog: C('#c6dff1'), scatter: C('#fff1d6', 1.0),
    cloudLit: C('#fffaf2', 1.05), cloudShadow: C('#93a3cf', 0.9),
    bankLit: C('#ffffff'), bankShadow: C('#a3b1d6'),
    fogDist: 0.00007, fogHeight: 0.005, fogFalloff: 0.012, fogBase: 0,
    exposure: 1.0, night: 0, stars: 0, planet: 0.55, cirrus: 0.7, bank: 0.15, storm: 0,
    moonElev: 35, moonAz: 140, moon: C('#7f9cff', 0.0),
    lift: V(0, 0, 0), gamma: V(1, 1, 1), gain: V(1, 1, 1), sat: 1.05, contrast: 1.0,
    vignette: 0.32, vigColor: C('#b7a9c9'),
    bloom: 0.06, threshold: 1.25, rays: 0.25,
  }, o);
}

export const PRESETS = {
  dawn: preset({
    sunElev: 4, sunAz: 72, sun: C('#ffae72', 2.8),
    zenith: C('#3a5797'), horizon: C('#ffb994'),
    ambient: C('#8e98d8', 0.78), bounce: C('#f0b490', 0.62), shadowTint: C('#d9cff6'),
    fog: C('#b8a3c9'), scatter: C('#ffa96f', 1.25),
    cloudLit: C('#ffd2ad', 1.15), cloudShadow: C('#6b6cb0', 0.92),
    bankLit: C('#ffc29a'), bankShadow: C('#7c6fb2'),
    fogDist: 0.00006, fogHeight: 0.004,
    exposure: 0.98, stars: 0.12, planet: 0.9, cirrus: 0.6, bank: 0.13,
    lift: V(0.0, 0.0, 0.02), gain: V(1.03, 1.0, 0.96), sat: 1.06, contrast: 1.06,
    vignette: 0.32, vigColor: C('#9b86b8'), bloom: 0.08, threshold: 1.2, rays: 0.38,
  }),
  menu: preset({
    sunElev: 7, sunAz: 55, sun: C('#ffb57e', 2.7),
    zenith: C('#3d5d9f'), horizon: C('#ffc4a0'),
    ambient: C('#929fdc', 0.8), bounce: C('#f3bb98', 0.65), shadowTint: C('#dbd3f6'),
    fog: C('#bba9cc'), scatter: C('#ffb282', 1.2),
    cloudLit: C('#ffd9bb', 1.12), cloudShadow: C('#7072b4', 0.92),
    bankLit: C('#ffcaa6'), bankShadow: C('#8076b6'),
    fogDist: 0.00006, fogHeight: 0.0045,
    exposure: 0.98, stars: 0.05, planet: 0.95, cirrus: 0.65, bank: 0.14,
    lift: V(0.0, 0.0, 0.02), gain: V(1.03, 1.0, 0.96), sat: 1.06, contrast: 1.06,
    vignette: 0.34, vigColor: C('#9b88ba'), bloom: 0.08, threshold: 1.2, rays: 0.4,
  }),
  morning: preset({
    sunElev: 24, sunAz: 38, sun: C('#fff0d6', 2.5),
    zenith: C('#2f6fc6'), horizon: C('#bcdcf2'),
    ambient: C('#9fbfee', 0.78), bounce: C('#ece9e4', 0.66), shadowTint: C('#dfe6fb'),
    fog: C('#b6cfe8'), scatter: C('#ffeccc', 0.95),
    cloudLit: C('#fffaf2', 1.08), cloudShadow: C('#8193c6', 0.9),
    fogDist: 0.00006, fogHeight: 0.0042,
    planet: 0.55, cirrus: 0.8, bank: 0.17, rays: 0.22, contrast: 1.05,
  }),
  noon: preset({
    sunElev: 50, sunAz: 22, sun: C('#fff8ec', 2.55),
    zenith: C('#3a80d4'), horizon: C('#bde4ef'),
    ambient: C('#a3cdee', 0.8), bounce: C('#e9f4f2', 0.75), shadowTint: C('#e0e9fb'),
    fog: C('#c0e4ee'), scatter: C('#fff6e2', 0.9),
    cloudLit: C('#ffffff', 1.05), cloudShadow: C('#8fb0d4', 0.92),
    bankShadow: C('#9fb8d8'), planet: 0.4, cirrus: 0.75, bank: 0.18, rays: 0.12,
    sat: 1.08,
  }),
  afternoon: preset({
    sunElev: 30, sunAz: -32, sun: C('#ffeccc', 2.4),
    zenith: C('#4c86c8'), horizon: C('#d0e4e4'),
    ambient: C('#a6c8d6', 0.8), bounce: C('#dce9d8', 0.7), shadowTint: C('#dde8f2'),
    fog: C('#cfe2da'), scatter: C('#ffe8c0', 1.1),
    cloudLit: C('#fff6ea', 1.05), cloudShadow: C('#8aa3c0', 0.9),
    bankShadow: C('#9fb4c6'),
    fogDist: 0.00008, fogHeight: 0.009, planet: 0.5, cirrus: 0.6, bank: 0.16, rays: 0.35,
    gain: V(1.0, 1.01, 0.98), sat: 1.06,
  }),
  golden: preset({
    sunElev: 4.5, sunAz: 4, sun: C('#ffa45a', 2.8),
    zenith: C('#4c62a8'), horizon: C('#ffb38a'),
    ambient: C('#a29ad2', 0.75), bounce: C('#ffc19a', 0.82), shadowTint: C('#dccdf3'),
    fog: C('#efb29c'), scatter: C('#ffa463', 1.7),
    cloudLit: C('#ffd1a6', 1.15), cloudShadow: C('#8a7bb8', 0.9),
    bankLit: C('#ffbf8e'), bankShadow: C('#8b70a8'),
    fogDist: 0.00011, fogHeight: 0.011,
    exposure: 1.02, stars: 0.05, planet: 0.85, cirrus: 0.9, bank: 0.15,
    lift: V(0.025, 0.01, 0.04), gain: V(1.05, 0.99, 0.93), sat: 1.1, contrast: 1.03,
    vignette: 0.42, vigColor: C('#a46f8f'), bloom: 0.09, threshold: 1.15, rays: 0.55,
  }),
  dusk: preset({
    sunElev: -3, sunAz: -8, sun: C('#ff8a6a', 0.5),
    zenith: C('#2a3470'), horizon: C('#d8839a'),
    ambient: C('#6f70aa', 0.62), bounce: C('#b07a92', 0.45), shadowTint: C('#cfc6f0'),
    fog: C('#9a7a9e'), scatter: C('#f08a7a', 1.0),
    cloudLit: C('#f0a0a4', 0.8), cloudShadow: C('#5d5b96', 0.85),
    bankLit: C('#e79aa6'), bankShadow: C('#5a5690'),
    night: 0.35, stars: 0.45, planet: 1.0, cirrus: 0.7, bank: 0.13,
    moon: C('#7f9cff', 0.12), exposure: 1.1,
    lift: V(0.02, 0.01, 0.05), gain: V(1.02, 0.98, 1.0), sat: 1.0,
    vignette: 0.45, vigColor: C('#6d5a8f'), bloom: 0.1, threshold: 1.1, rays: 0.2,
  }),
  night: preset({
    sunElev: -22, sunAz: -40, sun: C('#000000', 0),
    zenith: C('#060a22'), horizon: C('#1b2654'),
    ambient: C('#2c3c72', 0.55), bounce: C('#1e2a58', 0.4), shadowTint: C('#c9d2f6'),
    fog: C('#152044'), scatter: C('#27325f', 1.0),
    cloudLit: C('#5262a0', 0.65), cloudShadow: C('#1d2649', 0.9),
    bankLit: C('#3c4a80'), bankShadow: C('#121a3a'),
    fogDist: 0.0001, fogHeight: 0.01,
    night: 1, stars: 1, planet: 1, cirrus: 0.4, bank: 0.12,
    moonElev: 38, moonAz: 150, moon: C('#86a2ff', 0.42), exposure: 1.3,
    lift: V(0.0, 0.012, 0.035), gain: V(0.98, 1.0, 1.05), sat: 0.95, contrast: 1.02,
    vignette: 0.5, vigColor: C('#3a3f6a'), bloom: 0.11, threshold: 0.9, rays: 0.0,
  }),
  storm: preset({
    sunElev: 14, sunAz: 30, sun: C('#9aa7b8', 0.55),
    zenith: C('#28313d'), horizon: C('#4b5865'),
    ambient: C('#5f6d80', 0.62), bounce: C('#4a5262', 0.42), shadowTint: C('#d2dbe8'),
    fog: C('#3d4957'), scatter: C('#6a7584', 1.0),
    cloudLit: C('#8a96a6', 0.82), cloudShadow: C('#2e3745', 0.95),
    bankLit: C('#75808f'), bankShadow: C('#2b333f'),
    fogDist: 0.00035, fogHeight: 0.022, fogFalloff: 0.009,
    storm: 1, night: 0.25, stars: 0, planet: 0, cirrus: 0, bank: 0.24,
    moon: C('#7f9cff', 0.1), exposure: 1.15,
    lift: V(0.01, 0.015, 0.03), gain: V(0.97, 1.0, 1.04), sat: 0.75, contrast: 1.06,
    vignette: 0.52, vigColor: C('#474d66'), bloom: 0.1, threshold: 1.0, rays: 0.0,
  }),
  stormDawn: preset({
    sunElev: 7, sunAz: 58, sun: C('#ffc289', 2.3),
    zenith: C('#45567e'), horizon: C('#d6b29a'),
    ambient: C('#8890ae', 0.72), bounce: C('#b9a191', 0.6), shadowTint: C('#d6d6ee'),
    fog: C('#a59ea6'), scatter: C('#ffbd84', 1.35),
    cloudLit: C('#f3d5bb', 1.05), cloudShadow: C('#626c8e', 0.92),
    bankLit: C('#e8c4a6'), bankShadow: C('#5d6688'),
    fogDist: 0.00012, fogHeight: 0.013,
    storm: 0.22, planet: 0.45, cirrus: 0.3, bank: 0.2,
    lift: V(0.015, 0.012, 0.03), gain: V(1.03, 0.99, 0.95), sat: 0.96, contrast: 1.07,
    vignette: 0.45, vigColor: C('#6a6488'), bloom: 0.08, threshold: 1.15, rays: 0.6,
  }),
  oasis: preset({
    sunElev: 26, sunAz: -14, sun: C('#fff0d0', 2.6),
    zenith: C('#4995dc'), horizon: C('#d4efe8'),
    ambient: C('#acd4e6', 0.85), bounce: C('#f4eedb', 0.8), shadowTint: C('#dfeaf7'),
    fog: C('#d2ebe4'), scatter: C('#ffeec4', 1.2),
    cloudLit: C('#fffaf0', 1.08), cloudShadow: C('#99b2d0', 0.92),
    bankLit: C('#fff8ee'), bankShadow: C('#a6bed8'),
    fogDist: 0.00009, fogHeight: 0.012,
    planet: 0.75, cirrus: 0.6, bank: 0.17,
    lift: V(0.01, 0.015, 0.02), gain: V(1.02, 1.01, 0.98), sat: 1.1, contrast: 1.02,
    vignette: 0.34, vigColor: C('#a7b9a8'), bloom: 0.08, threshold: 1.2, rays: 0.45,
  }),
};

const COLOR_KEYS = ['sun', 'zenith', 'horizon', 'ambient', 'bounce', 'shadowTint', 'fog', 'scatter',
  'cloudLit', 'cloudShadow', 'bankLit', 'bankShadow', 'moon', 'vigColor'];
const NUM_KEYS = ['sunElev', 'sunAz', 'fogDist', 'fogHeight', 'fogFalloff', 'fogBase', 'exposure', 'night',
  'stars', 'planet', 'cirrus', 'bank', 'storm', 'moonElev', 'moonAz', 'sat', 'contrast', 'vignette',
  'bloom', 'threshold', 'rays'];
const VEC_KEYS = ['lift', 'gamma', 'gain'];

function clonePreset(p) {
  const o = {};
  for (const k of COLOR_KEYS) o[k] = p[k].clone();
  for (const k of NUM_KEYS) o[k] = p[k];
  for (const k of VEC_KEYS) o[k] = p[k].clone();
  return o;
}

function mixInto(out, a, b, t) {
  for (const k of COLOR_KEYS) out[k].copy(a[k]).lerp(b[k], t);
  for (const k of NUM_KEYS) out[k] = lerp(a[k], b[k], t);
  for (const k of VEC_KEYS) out[k].copy(a[k]).lerp(b[k], t);
  return out;
}

export class Atmosphere {
  constructor(engine, sky) {
    this.engine = engine;
    this.sky = sky;
    this.current = clonePreset(PRESETS.menu);
    this.from = clonePreset(PRESETS.menu);
    this.to = clonePreset(PRESETS.menu);
    this.t = 1;
    this.duration = 1;
    this.flash = 0;
    this.stormBoost = 0; // extra storm darkening driven by Weather
    this.name = 'menu';
    this._work = clonePreset(PRESETS.menu);
  }

  set(name) {
    const p = PRESETS[name];
    if (!p) return;
    this.name = name;
    this.current = clonePreset(p);
    this.from = clonePreset(p);
    this.to = clonePreset(p);
    this.t = 1;
    this.apply();
  }

  transition(name, duration = 20) {
    const p = PRESETS[name];
    if (!p || name === this.name) return;
    this.name = name;
    this.from = clonePreset(this.current);
    this.to = clonePreset(p);
    this.t = 0;
    this.duration = Math.max(0.01, duration);
  }

  update(dt) {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.duration);
      const e = this.t * this.t * (3 - 2 * this.t);
      mixInto(this.current, this.from, this.to, e);
    }
    this.apply();
  }

  apply() {
    const p = this.current;
    const s = this.stormBoost;
    const el = p.sunElev * DEG, az = p.sunAz * DEG;
    G.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const mel = p.moonElev * DEG, maz = p.moonAz * DEG;
    G.uMoonDir.value.set(Math.sin(maz) * Math.cos(mel), Math.sin(mel), -Math.cos(maz) * Math.cos(mel)).normalize();
    // Sun fades as it touches the horizon.
    const horizonFade = smoothstep(-6, 2, p.sunElev);
    const stormDim = 1 - s * 0.7;
    G.uSunColor.value.copy(p.sun).multiplyScalar(horizonFade * stormDim);
    G.uSkyZenith.value.copy(p.zenith).multiplyScalar(1 - s * 0.45);
    G.uSkyHorizon.value.copy(p.horizon).multiplyScalar(1 - s * 0.4);
    G.uSkyAmbient.value.copy(p.ambient).multiplyScalar(1 - s * 0.3);
    G.uBounce.value.copy(p.bounce).multiplyScalar(1 - s * 0.4);
    G.uShadowTint.value.copy(p.shadowTint);
    G.uFogColor.value.copy(p.fog).multiplyScalar(1 - s * 0.35);
    G.uSunScatter.value.copy(p.scatter).multiplyScalar(1 - s * 0.6);
    G.uCloudLit.value.copy(p.cloudLit).multiplyScalar(1 - s * 0.45);
    G.uCloudShadow.value.copy(p.cloudShadow).multiplyScalar(1 - s * 0.3);
    G.uFogParams.value.set(p.fogDist * (1 + s * 2.5), p.fogHeight * (1 + s), p.fogFalloff, p.fogBase);
    G.uNight.value = p.night;
    G.uMoonColor.value.copy(p.moon);
    G.uStorm.value = saturate(p.storm + s);
    G.uExposure.value = p.exposure;

    if (this.sky) {
      const u = this.sky.uniforms;
      u.uStars.value = p.stars;
      u.uPlanetVis.value = p.planet * (1 - s);
      u.uCirrus.value = p.cirrus * (1 - s);
      u.uBankHeight.value = p.bank + s * 0.08;
      u.uBankLit.value.copy(p.bankLit).multiplyScalar(1 - s * 0.45);
      u.uBankShadow.value.copy(p.bankShadow).multiplyScalar(1 - s * 0.3);
    }
    const post = this.engine.post;
    const g = post.grade;
    g.uLift.value.copy(p.lift);
    g.uGamma.value.copy(p.gamma);
    g.uGain.value.copy(p.gain);
    g.uSaturation.value = p.sat * (1 - s * 0.2);
    g.uContrast.value = p.contrast;
    g.uVignette.value = p.vignette;
    g.uVignetteColor.value.copy(p.vigColor);
    g.uBloomStrength.value = p.bloom;
    g.uRayStrength.value = p.rays * (1 - s);
    post.prefilter.uniforms.uThreshold.value = p.threshold;
    g.uCloudVeil.value.copy(p.cloudLit).lerp(p.fog, 0.5).multiplyScalar(0.95);
  }
}

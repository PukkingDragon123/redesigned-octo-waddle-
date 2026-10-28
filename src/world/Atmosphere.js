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
    zenith: C('#2a66c0'), horizon: C('#bcdcef'),
    ambient: C('#a2c4ec', 0.8), bounce: C('#d9e8ee', 0.62), shadowTint: C('#dbe4fb'),
    fog: C('#c6e2ef'), scatter: C('#fff1d6', 1.0),
    cloudLit: C('#fffaf2', 1.05), cloudShadow: C('#8d9fbd', 0.92),
    bankLit: C('#ffffff'), bankShadow: C('#a3b1d6'),
    // marine haze: thin with distance, denser in the layer just above the sea
    fogDist: 0.00003, fogHeight: 0.00012, fogFalloff: 0.004, fogBase: 0,
    exposure: 1.0, night: 0, stars: 0, planet: 0.55, cirrus: 0.7, bank: 0.12, storm: 0,
    moonElev: 35, moonAz: 140, moon: C('#7f9cff', 0.0),
    // the second, smaller moon (Ilsa: warm, rose-gold) and the spiral galaxy across the night sky
    moon2Elev: 22, moon2Az: -60, moon2: 0, galaxy: 0,
    // the grade: white balance (linear, before the filmic curve), lift / gamma / gain after it,
    // restrained saturation, contrast in log space around mid grey
    lift: V(0, 0, 0), gamma: V(1, 1, 1), gain: V(1, 1, 1), wb: V(1, 1, 1), sat: 1.0, contrast: 1.04,
    vignette: 0.3, vigColor: C('#8f8a86'),
    bloom: 0.06, threshold: 1.25, rays: 0.25, halation: 0.05,
    // the sea: body colour of deep water (reflectance-like, lit here), the turquoise of light through
    // thin crests and shallows, the default sea state, water clarity (1 clear .. 3 murky), night plankton
    sea: C('#0d4a6b'), seaScatter: C('#2bd1b5'), seaState: 0.3, clarity: 1, plankton: 0,
    // the painted light (stylizedLight): sky fill of the shade, warm bounce, shade calm, soft turning
    fill: 0.9, warmth: 1.0, shadeCalm: 0.15, soft: 0.5,
  }, o);
}

// Colour script for an ocean planet: deep blue zeniths, a luminous haze where sea meets sky,
// and a sea colour per light (sapphire offshore, jade-turquoise over sand, slate in storms).
export const PRESETS = {
  dawn: preset({
    fill: 0.75, warmth: 0.9,
    sunElev: 4, sunAz: 72, sun: C('#ffb37a', 2.6),
    zenith: C('#2d4b84'), horizon: C('#f4bf92'),
    ambient: C('#8ea2cc', 0.84), bounce: C('#d8b49a', 0.55), shadowTint: C('#c9d1ec'),
    fog: C('#d6bea8'), scatter: C('#ffad72', 1.2),
    cloudLit: C('#ffd6b0', 1.12), cloudShadow: C('#7180a4', 0.92),
    bankLit: C('#ffc89e'), bankShadow: C('#7c86a6'),
    fogDist: 0.000035, fogHeight: 0.00016,
    exposure: 0.98, stars: 0.14, planet: 0.9, cirrus: 0.6, bank: 0.1,
    moon2: 0.5, moon2Elev: 16, moon2Az: -95, galaxy: 0.08,
    lift: V(0.0, 0.004, 0.01), wb: V(1.035, 1.0, 0.95), sat: 1.0, contrast: 1.06,
    vignette: 0.3, vigColor: C('#8c847c'), bloom: 0.08, threshold: 1.2, rays: 0.38, halation: 0.07,
    sea: C('#1a4a66'), seaScatter: C('#3cc6ae'), seaState: 0.06, clarity: 0.9,
  }),
  menu: preset({
    fill: 0.8, warmth: 0.9,
    sunElev: 7, sunAz: 55, sun: C('#ffb984', 2.55),
    zenith: C('#305894'), horizon: C('#f8c6a0'),
    ambient: C('#8fa3cf', 0.85), bounce: C('#d9b8a0', 0.56), shadowTint: C('#cad2ee'),
    fog: C('#d2bcaa'), scatter: C('#ffb584', 1.15),
    cloudLit: C('#ffdcbc', 1.1), cloudShadow: C('#7484a8', 0.92),
    bankLit: C('#ffcda8'), bankShadow: C('#7e88aa'),
    fogDist: 0.000035, fogHeight: 0.00015,
    exposure: 0.98, stars: 0.05, planet: 0.95, cirrus: 0.65, bank: 0.11,
    moon2: 0.35, moon2Elev: 24, moon2Az: -80, galaxy: 0.04,
    lift: V(0.0, 0.004, 0.01), wb: V(1.03, 1.0, 0.955), sat: 1.0, contrast: 1.06,
    vignette: 0.32, vigColor: C('#8c847c'), bloom: 0.08, threshold: 1.2, rays: 0.4, halation: 0.07,
    sea: C('#1b4b69'), seaScatter: C('#3cc6ae'), seaState: 0.12, clarity: 0.9,
  }),
  morning: preset({
    fill: 0.9,
    sunElev: 24, sunAz: 38, sun: C('#fff0d6', 2.5),
    zenith: C('#2462bf'), horizon: C('#bfe0f2'),
    ambient: C('#9fbfee', 0.78), bounce: C('#dce8ea', 0.62), shadowTint: C('#dfe6fb'),
    fog: C('#c8e3f0'), scatter: C('#ffeccc', 0.95),
    cloudLit: C('#fffaf2', 1.08), cloudShadow: C('#8a9cb9', 0.94),
    planet: 0.55, cirrus: 0.8, bank: 0.13, rays: 0.22, contrast: 1.05,
    moon2: 0.12, moon2Elev: 30, moon2Az: -130,
    sea: C('#0e4a6c'), seaScatter: C('#2bd1b5'), seaState: 0.28,
  }),
  noon: preset({
    fill: 0.95,
    sunElev: 50, sunAz: 22, sun: C('#fff8ec', 2.55),
    zenith: C('#1d58b4'), horizon: C('#b6dcef'),
    ambient: C('#9fcaee', 0.8), bounce: C('#d8eef0', 0.7), shadowTint: C('#e0e9fb'),
    fog: C('#c2e3f0'), scatter: C('#fff6e2', 0.9),
    cloudLit: C('#ffffff', 1.06), cloudShadow: C('#93a9c4', 0.95),
    bankShadow: C('#9fb8d8'), planet: 0.4, cirrus: 0.75, bank: 0.13, rays: 0.12,
    sat: 1.02,
    sea: C('#0b4a70'), seaScatter: C('#26d3bb'), seaState: 0.38, clarity: 1.1,
  }),
  afternoon: preset({
    fill: 0.9,
    sunElev: 30, sunAz: -32, sun: C('#ffeccc', 2.4),
    zenith: C('#285fb2'), horizon: C('#c4e0e8'),
    ambient: C('#a6c8d6', 0.8), bounce: C('#d6e6d8', 0.66), shadowTint: C('#dde8f2'),
    fog: C('#c3dde2'), scatter: C('#ffe4b8', 0.85),
    cloudLit: C('#fff6ea', 1.05), cloudShadow: C('#8fa2b8', 0.93),
    bankShadow: C('#9fb4c6'),
    fogDist: 0.000035, fogHeight: 0.00016, planet: 0.5, cirrus: 0.6, bank: 0.13, rays: 0.35,
    wb: V(1.015, 1.0, 0.975), sat: 1.02,
    sea: C('#0f4f6a'), seaScatter: C('#33d0aa'), seaState: 0.32,
  }),
  golden: preset({
    fill: 0.6, warmth: 1.2, shadeCalm: 0.1,
    sunElev: 4.5, sunAz: 4, sun: C('#ffa45a', 2.8),
    zenith: C('#3a5490'), horizon: C('#ffbc86'),
    ambient: C('#8f9dc6', 0.78), bounce: C('#e5b490', 0.62), shadowTint: C('#cfd3ea'),
    fog: C('#e6bf9a'), scatter: C('#ffa866', 1.6),
    cloudLit: C('#ffd4a6', 1.12), cloudShadow: C('#7d84a4', 0.9),
    bankLit: C('#ffc28e'), bankShadow: C('#84829c'),
    fogDist: 0.00005, fogHeight: 0.00022,
    exposure: 1.02, stars: 0.05, planet: 0.85, cirrus: 0.9, bank: 0.12,
    moon2: 0.3, moon2Elev: 12, moon2Az: 150, galaxy: 0.03,
    lift: V(0.006, 0.005, 0.01), wb: V(1.05, 1.0, 0.92), sat: 1.0, contrast: 1.05,
    vignette: 0.34, vigColor: C('#8a7c70'), bloom: 0.09, threshold: 1.15, rays: 0.55, halation: 0.09,
    sea: C('#1d4a62'), seaScatter: C('#46c49e'), seaState: 0.15,
  }),
  dusk: preset({
    fill: 0.45, warmth: 0.5, shadeCalm: 0.1,
    sunElev: -3, sunAz: -8, sun: C('#ff8a6a', 0.5),
    zenith: C('#1d2a64'), horizon: C('#e2907f'),
    ambient: C('#6f74aa', 0.62), bounce: C('#a07390', 0.45), shadowTint: C('#cfc6f0'),
    fog: C('#86829a'), scatter: C('#f09e76', 1.0),
    cloudLit: C('#e8aa94', 0.82), cloudShadow: C('#5c6290', 0.85),
    bankLit: C('#e2a694'), bankShadow: C('#5a608a'),
    fogDist: 0.00004, fogHeight: 0.00018,
    night: 0.35, stars: 0.45, planet: 1.0, cirrus: 0.7, bank: 0.11,
    moon: C('#7f9cff', 0.12), exposure: 1.1, moon2: 0.7, moon2Elev: 18, moon2Az: 95, galaxy: 0.35,
    lift: V(0.004, 0.008, 0.02), wb: V(1.0, 1.0, 1.0), sat: 0.92, contrast: 1.06,
    vignette: 0.36, vigColor: C('#66646e'), bloom: 0.1, threshold: 1.1, rays: 0.2, halation: 0.06,
    sea: C('#173d5c'), seaScatter: C('#3a9fb0'), seaState: 0.2, plankton: 0.25,
  }),
  night: preset({
    fill: 0.3, warmth: 0, shadeCalm: 0.05, soft: 0.4,
    sunElev: -22, sunAz: -40, sun: C('#000000', 0),
    zenith: C('#0a1324'), horizon: C('#2c3c5c'),
    ambient: C('#506384', 0.6), bounce: C('#2c3852', 0.4), shadowTint: C('#d0d8ee'),
    fog: C('#202c46'), scatter: C('#3a4662', 1.0),
    cloudLit: C('#6a7896', 0.48), cloudShadow: C('#1a2132', 0.85),
    bankLit: C('#5c6a8c'), bankShadow: C('#1a2234'),
    fogDist: 0.00004, fogHeight: 0.00016,
    night: 1, stars: 1, planet: 1, cirrus: 0.4, bank: 0.1,
    moonElev: 38, moonAz: 150, moon: C('#bccbe8', 0.62), exposure: 1.28,
    moon2: 1, moon2Elev: 24, moon2Az: 70, galaxy: 1,
    lift: V(0.004, 0.007, 0.014), wb: V(0.97, 1.0, 1.05), sat: 0.76, contrast: 1.12,
    vignette: 0.36, vigColor: C('#4c5260'), bloom: 0.11, threshold: 0.9, rays: 0.0, halation: 0.04,
    sea: C('#12304a'), seaScatter: C('#2f7ea6'), seaState: 0.18, plankton: 1,
  }),
  storm: preset({
    fill: 0.3, warmth: 0.2, shadeCalm: 0.25, soft: 0.6,
    sunElev: 14, sunAz: 30, sun: C('#b2bbc6', 1.05),
    zenith: C('#3a4450'), horizon: C('#77838c'),
    ambient: C('#8290a0', 0.86), bounce: C('#5e6874', 0.45), shadowTint: C('#d6dde8'),
    fog: C('#66727c'), scatter: C('#86909c', 1.0),
    cloudLit: C('#a4aebb', 0.9), cloudShadow: C('#3c4652', 0.95),
    bankLit: C('#8a95a2'), bankShadow: C('#36404c'),
    fogDist: 0.00026, fogHeight: 0.0011, fogFalloff: 0.004,
    storm: 1, night: 0.12, stars: 0, planet: 0, cirrus: 0, bank: 0.2,
    moon: C('#a8b8d8', 0.1), exposure: 1.42,
    lift: V(0.004, 0.007, 0.011), wb: V(0.98, 1.0, 1.03), sat: 0.82, contrast: 1.2,
    vignette: 0.36, vigColor: C('#50545c'), bloom: 0.1, threshold: 1.0, rays: 0.0, halation: 0.04,
    sea: C('#20414c'), seaScatter: C('#4f9c8f'), seaState: 1, clarity: 2.2,
  }),
  stormDawn: preset({
    fill: 0.6, warmth: 0.8, shadeCalm: 0.18,
    sunElev: 7, sunAz: 58, sun: C('#ffc289', 2.3),
    zenith: C('#3c4d77'), horizon: C('#d6b29a'),
    ambient: C('#8890ae', 0.72), bounce: C('#b9a191', 0.6), shadowTint: C('#d6d6ee'),
    fog: C('#a8a0a8'), scatter: C('#ffbd84', 1.35),
    cloudLit: C('#f3d5bb', 1.05), cloudShadow: C('#626c8e', 0.92),
    bankLit: C('#e8c4a6'), bankShadow: C('#5d6688'),
    fogDist: 0.00006, fogHeight: 0.00035,
    storm: 0.22, planet: 0.45, cirrus: 0.3, bank: 0.16,
    moon2: 0.2, moon2Elev: 20, moon2Az: -100,
    lift: V(0.006, 0.008, 0.014), wb: V(1.03, 1.0, 0.955), sat: 0.94, contrast: 1.08,
    vignette: 0.36, vigColor: C('#6e6a68'), bloom: 0.08, threshold: 1.15, rays: 0.6, halation: 0.07,
    sea: C('#1f4658'), seaScatter: C('#55b2a0'), seaState: 0.7, clarity: 1.7,
  }),
  oasis: preset({
    fill: 1.0, warmth: 1.1,
    sunElev: 19, sunAz: -12, sun: C('#ffe8c2', 2.55),
    zenith: C('#2373cf'), horizon: C('#cfeae4'),
    ambient: C('#acd4e6', 0.85), bounce: C('#e6eedc', 0.78), shadowTint: C('#e2e4f8'),
    fog: C('#c2e2dc'), scatter: C('#ffe2a8', 1.05),
    cloudLit: C('#fffaf0', 1.08), cloudShadow: C('#98aec6', 0.94),
    bankLit: C('#fff8ee'), bankShadow: C('#a6bed8'),
    fogDist: 0.00003, fogHeight: 0.00016,
    planet: 0.75, cirrus: 0.6, bank: 0.13, moon2: 0.15, moon2Elev: 35, moon2Az: 120,
    lift: V(0.004, 0.008, 0.01), wb: V(1.02, 1.0, 0.975), sat: 1.04, contrast: 1.04,
    vignette: 0.3, vigColor: C('#8a8c84'), bloom: 0.09, threshold: 1.18, rays: 0.6,
    sea: C('#0f6a80'), seaScatter: C('#3fe0c0'), seaState: 0.08, clarity: 0.75,
  }),
};

const COLOR_KEYS = ['sun', 'zenith', 'horizon', 'ambient', 'bounce', 'shadowTint', 'fog', 'scatter',
  'cloudLit', 'cloudShadow', 'bankLit', 'bankShadow', 'moon', 'vigColor', 'sea', 'seaScatter'];
const NUM_KEYS = ['sunElev', 'sunAz', 'fogDist', 'fogHeight', 'fogFalloff', 'fogBase', 'exposure', 'night',
  'stars', 'planet', 'cirrus', 'bank', 'storm', 'moonElev', 'moonAz', 'sat', 'contrast', 'vignette',
  'bloom', 'threshold', 'rays', 'seaState', 'clarity', 'plankton', 'moon2Elev', 'moon2Az', 'moon2', 'galaxy',
  'fill', 'warmth', 'shadeCalm', 'soft', 'halation'];
const VEC_KEYS = ['lift', 'gamma', 'gain', 'wb'];

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
    G.uSkyZenith.value.copy(p.zenith).multiplyScalar(1 - s * 0.3);
    G.uSkyHorizon.value.copy(p.horizon).multiplyScalar(1 - s * 0.25);
    G.uSkyAmbient.value.copy(p.ambient).multiplyScalar(1 - s * 0.15);
    G.uBounce.value.copy(p.bounce).multiplyScalar(1 - s * 0.3);
    G.uShadowTint.value.copy(p.shadowTint);
    G.uFogColor.value.copy(p.fog).multiplyScalar(1 - s * 0.22);
    G.uSunScatter.value.copy(p.scatter).multiplyScalar(1 - s * 0.6);
    G.uCloudLit.value.copy(p.cloudLit).multiplyScalar(1 - s * 0.3);
    G.uCloudShadow.value.copy(p.cloudShadow).multiplyScalar(1 - s * 0.2);
    G.uFogParams.value.set(p.fogDist * (1 + s * 2.5), p.fogHeight * (1 + s), p.fogFalloff, p.fogBase);
    G.uNight.value = p.night;
    G.uMoonColor.value.copy(p.moon);
    G.uStorm.value = saturate(p.storm + s);
    G.uExposure.value = p.exposure * (1 + s * 0.12);
    // storms close the sky: flatter, darker shade without the warm bounce
    G.uLightK.value.set(p.fill * (1 - s * 0.6), p.warmth * (1 - s), Math.min(1, p.shadeCalm + s * 0.15), p.soft);

    // The sea: light entering the water (sun through the surface + skylight), lighting the deep
    // body colour, the turquoise crest scatter and the underwater in-scatter.
    const sunY = Math.max(G.uSunDir.value.y, 0);
    const sc = G.uSunColor.value, am = G.uSkyAmbient.value;
    const inR = sc.r * (0.15 + 0.85 * sunY) * 0.55 + am.r * 0.65 + p.moon.r * p.night * 0.4;
    const inG = sc.g * (0.15 + 0.85 * sunY) * 0.55 + am.g * 0.65 + p.moon.g * p.night * 0.4;
    const inB = sc.b * (0.15 + 0.85 * sunY) * 0.55 + am.b * 0.65 + p.moon.b * p.night * 0.4;
    const murk = 1 + s * 0.8;
    G.uSeaBody.value.setRGB(p.sea.r * inR * 0.55, p.sea.g * inG * 0.55, p.sea.b * inB * 0.55);
    G.uSeaScatter.value.copy(p.seaScatter).multiply(sc).multiplyScalar(0.18);
    // under water the light is scattered by the column itself: brighter and greener than the deep
    const wr = lerp(p.sea.r, p.seaScatter.r, 0.35), wg = lerp(p.sea.g, p.seaScatter.g, 0.35), wb = lerp(p.sea.b, p.seaScatter.b, 0.35);
    G.uWaterTint.value.setRGB(wr * inR * 1.05, wg * inG * 1.05, wb * inB * 1.05);
    const cl = p.clarity * murk;
    G.uWaterAbsorb.value.set(0.3 * (0.8 + 0.2 * cl), 0.046 * cl, 0.03 * cl);
    G.uWaterParams.value.z = p.plankton;

    if (this.sky) {
      const u = this.sky.uniforms;
      u.uStars.value = p.stars;
      u.uPlanetVis.value = p.planet * (1 - s);
      u.uCirrus.value = p.cirrus * (1 - s);
      u.uBankHeight.value = p.bank + s * 0.08;
      u.uBankLit.value.copy(p.bankLit).multiplyScalar(1 - s * 0.45);
      u.uBankShadow.value.copy(p.bankShadow).multiplyScalar(1 - s * 0.3);
      if (u.uMoon2Dir) {
        const m2el = p.moon2Elev * DEG, m2az = p.moon2Az * DEG;
        u.uMoon2Dir.value.set(Math.sin(m2az) * Math.cos(m2el), Math.sin(m2el), -Math.cos(m2az) * Math.cos(m2el)).normalize();
        u.uMoon2Vis.value = p.moon2 * (1 - s);
        u.uGalaxy.value = p.galaxy * (1 - s);
      }
    }
    const post = this.engine.post;
    const g = post.grade;
    g.uLift.value.copy(p.lift);
    g.uGamma.value.copy(p.gamma);
    g.uGain.value.copy(p.gain);
    // white balance, normalised so it never changes the brightness
    const wl = p.wb.x * 0.2126 + p.wb.y * 0.7152 + p.wb.z * 0.0722;
    g.uWB.value.copy(p.wb).multiplyScalar(1 / Math.max(wl, 1e-3));
    g.uHalation.value = p.halation;
    g.uSaturation.value = p.sat * (1 - s * 0.15);
    g.uContrast.value = p.contrast;
    g.uVignette.value = p.vignette;
    g.uVignetteColor.value.copy(p.vigColor);
    g.uBloomStrength.value = p.bloom;
    g.uRayStrength.value = p.rays * (1 - s);
    post.prefilter.uniforms.uThreshold.value = p.threshold;
    g.uCloudVeil.value.copy(p.cloudLit).lerp(p.fog, 0.5).multiplyScalar(0.95);
  }
}

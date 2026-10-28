// The spiral islands of Vur Sok. Every island rises from the sea (y = 0) and continues below it
// into its reef shelf. Archetypes:
//   stack   helical sea stack: a lobed column whose cross-section twists with height, wave-cut
//           notch at the waterline, sea caves, a meadow or crag cap (Ko Tapu / Ha Long towers)
//   coil    ammonite island: a ribbed ridge winding inward and upward along a logarithmic spiral
//           to a central peak; the sea fills the spiral channel between its whorls
//   peak    spiral mountain: a twisted cone with a green terrace winding up it to the summit
//   forming a young black coil still being laid down: steam, cooling basalt, faint lava at its tip
// Each archetype returns its rock mesh (local, y = world height), a collision SDF, a sea-level
// footprint SDF (for the seabed shelf), rims (vines, waterfall lips), summits (perches) and the
// paint style. Islands.build() turns an archetype into LOD meshes.
import { Mesh, Color, Vector3 } from 'three';
import { Noise } from '../core/noise.js';
import { rng, clamp, lerp, smoothstep, TAU } from '../core/math.js';
import { terrainMaterial } from '../render/materials.js';
import {
  RockMesh, lathe, sweep, finishGeometry, LogSpiral, notch, terrace, CAP, LEDGE, VOLCANIC, BASALT,
} from './Spirals.js';

const noise = new Noise(4242);

// ---- palettes (painted rock bands) -----------------------------------------------------------
// Albedos are kept in the mid range (lit faces reach ~0.8 after the sun's 2.5x), the painted
// value structure comes from band contrast, not brightness.
const hexes = (a, k = 1) => a.map((h) => new Color(h).multiplyScalar(k));
export const ROCK = {
  banded: { kind: 0, bands: hexes(['#b8a283', '#8f7f70', '#c4ad8b', '#7d7286', '#a57d5f', '#8d8c86', '#bb9c78', '#6b6578', '#a99377'], 0.62) },
  limestone: { kind: 0, bands: hexes(['#bdb4a2', '#a69c89', '#c6bca8', '#958c7c', '#b2a58e', '#a39b8f', '#8e877b'], 0.6) },
  warm: { kind: 0, bands: hexes(['#b98b64', '#9e7056', '#c79f78', '#86695a', '#b0866a', '#927b72', '#a9744f'], 0.62) },
  basalt: { kind: 1, bands: hexes(['#4d5059', '#3f4149', '#58534f', '#474a50', '#5f5b58', '#3b3c40'], 0.85) },
  volcanic: { kind: 1, bands: hexes(['#2f2e32', '#39373b', '#262528', '#48413e', '#5b4038', '#333034'], 0.9) },
};

const _c = new Color(), _c2 = new Color();
const hash = (x) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/**
 * Paint function factory shared by every archetype.
 * style: { rock: key of ROCK, meadow 0..1, moss, heat(P) -> 0..1, bandH, sandFoot }
 */
export function rockPainter(style) {
  const pal = ROCK[style.rock || 'banded'];
  const bands = pal.bands;
  const bandH = style.bandH ?? 4.05; // a multiple of the shader's fine band (1.35 m)
  const meadow = style.meadow ?? 1;
  const volcanic = style.rock === 'volcanic';
  const seed = style.seed ?? 1;
  return (P, N, s, ao, tag, out) => {
    const k = Math.floor(s / bandH);
    const f = s / bandH - k;
    const i0 = Math.floor(hash(k * 1.7 + seed) * bands.length);
    const i1 = Math.floor(hash((k + 1) * 1.7 + seed) * bands.length);
    _c.copy(bands[i0]).lerp(bands[i1], smoothstep(0.75, 1.0, f) * 0.6);
    // weathering: tops bleach, the foot darkens and cools
    const n1 = noise.noise3(P.x * 0.013 + seed, P.y * 0.02, P.z * 0.013);
    _c.multiplyScalar(0.92 + 0.18 * n1);
    if (P.y > 12) _c.lerp(_c2.set(0xffffff).multiplyScalar(_c.r * 0.33 + _c.g * 0.34 + _c.b * 0.33), 0.08);
    _c.multiplyScalar(lerp(0.82, 1.0, smoothstep(-2, 10, P.y)));
    out.r = _c.r; out.g = _c.g; out.b = _c.b;
    out.kind = pal.kind;
    // meadow on caps, ledges and gentle tops above the spray
    const fertile = (tag & (CAP | LEDGE)) ? 1 : 0.55;
    const n2 = noise.noise2(P.x * 0.045 + seed, P.z * 0.045);
    let g = smoothstep(0.62, 0.84, N.y + n2 * 0.08) * smoothstep(4.5, 8.5, P.y) * fertile * meadow;
    if (volcanic) g *= smoothstep(0.2, 0.6, n2) * 0.6; // pioneer moss only
    out.grass = clamp(g, 0, 1);
    // little sandy shelves at the rock foot
    if (!volcanic && style.sandFoot !== false) out.sand = smoothstep(2.6, 1.2, P.y) * smoothstep(0.45, 0.75, N.y) * smoothstep(-6, -1, P.y);
    else if (volcanic) out.sand = smoothstep(2.0, 0.8, P.y) * smoothstep(0.5, 0.8, N.y) * smoothstep(-5, -1, P.y);
    out.heat = style.heat ? style.heat(P) : 0;
    if (out.heat > 0) { const h = out.heat; out.r = lerp(out.r, 0.06, h * 0.5); out.g = lerp(out.g, 0.05, h * 0.5); out.b = lerp(out.b, 0.05, h * 0.5); }
    out.ao = ao;
    out.strata = s;
  };
}

// ---- ring heights: dense around the waterline for notches and the wet band ------------------
function ringHeights(yBot, yTop, step, fine = 0.7, extra = []) {
  const ys = [];
  const coarseBelow = [-18, -11, -7, -4.5, -2.6];
  for (const y of coarseBelow) if (y > yBot - 0.01 && y < Math.min(-1.5, yTop)) ys.push(y);
  if (!ys.length || ys[0] > yBot) ys.unshift(yBot);
  let y = Math.max(-1.6, yBot);
  const fineTop = Math.min(5.5, yTop);
  while (y < fineTop) { ys.push(y); y += fine; }
  y = Math.max(y, fineTop);
  while (y < yTop - step * 0.4) { ys.push(y); y += step * (y > yTop * 0.85 ? 0.6 : 1); }
  ys.push(yTop);
  for (const e of extra) ys.push(e);
  ys.sort((a, b) => a - b);
  // strictly increasing, no slivers
  const out = [];
  for (const v of ys) if (!out.length || v > out[out.length - 1] + 0.3) out.push(v);
  if (out[out.length - 1] < yTop) out[out.length - 1] = yTop;
  return out;
}

const boxStep = (x, a, b, w) => smoothstep(a - w, a + w, x) * (1 - smoothstep(b - w, b + w, x));
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// ---- layered polygon columns -----------------------------------------------------------------
// Rock reads as rock through planes and edges, not blobs: every stratum of a stack is an irregular
// convex polygon (the intersection of a few half-planes: r = min a_i / cos(theta - theta_i)), each
// layer with its own hardness (hard beds protrude, soft beds recess), so ledges, overhangs and
// joint-bounded faces fall out of the construction. The polygons rotate with height: a helix.

/** Strata layers between yBot and yTop. */
export function makeLayers(seed, yBot, yTop, R, o = {}) {
  const r = rng(seed * 7 + 3);
  const layers = [];
  let y = yBot;
  let phase = r() * TAU;
  const nBase = o.sides ?? (5 + Math.min(4, Math.round(R / 18)));
  const mk = (h, hard, jog) => {
    const n = Math.max(4, nBase + Math.round((r() - 0.5) * 3));
    const faces = [];
    for (let i = 0; i < n; i++) faces.push({ th: (i + (r() - 0.5) * 0.6) * TAU / n, a: lerp(0.84, 1.0, r()) });
    let mean = 0;
    for (let k = 0; k < 64; k++) mean += polyR(faces, (k / 64) * TAU, 0);
    mean /= 64;
    for (const f of faces) f.a /= mean;
    layers.push({ y0: y, y1: y + h, faces, phase, scale: hard, tilt: (r() - 0.5) * 0.05 });
    phase += (r() - 0.5) * jog;
    y += h;
  };
  const soft = o.soft ?? 0.9, hardS = o.hard ?? 1.04;
  // formations: massive walls separated by groups of thin beds
  mk(Math.max(4, -yBot + lerp(1, 6, r())), lerp(soft, hardS, 0.7), 0.15); // the sea-level bed
  while (y < yTop + 0.5) {
    if (r() < (o.massive ?? 0.55)) {
      mk(lerp(o.layerMin ?? 8, o.layerMax ?? 24, r()), lerp(0.97, hardS, r()), o.jog ?? 0.35);
    } else {
      const nb = 2 + Math.floor(r() * 4);
      const base = lerp(soft, 1.0, r());
      for (let i = 0; i < nb && y < yTop + 0.5; i++) mk(lerp(1.8, 4.2, r()), base + (i % 2 ? -0.025 : 0.02) + (r() - 0.5) * 0.02, 0.06);
    }
  }
  return layers;
}

export function polyR(faces, th, rot) {
  let m = 3;
  for (let i = 0; i < faces.length; i++) {
    const c = Math.cos(th - faces[i].th - rot);
    if (c > 0.12) { const v = faces[i].a / c; if (v < m) m = v; }
  }
  return m;
}

/** Radius multiplier of a layered column at (theta, y), blending across bed boundaries. */
function layeredR(layers, th, y, rot, edge = 0.45) {
  let k = 0;
  while (k < layers.length - 1 && y > layers[k].y1) k++;
  const L = layers[k];
  const u = (y - L.y0) / (L.y1 - L.y0);
  // each bed narrows slightly toward its top (weathering) and leans a little
  const rr = polyR(L.faces, th, rot + L.phase) * L.scale * (1 - 0.05 * u) * (1 + L.tilt * Math.cos(th - L.phase));
  // blend into the next bed just above the boundary (a crisp ledge or lip)
  if (k < layers.length - 1 && y > L.y1 - edge) {
    const N = layers[k + 1];
    const rn = polyR(N.faces, th, rot + N.phase) * N.scale * (1 + N.tilt * Math.cos(th - N.phase));
    return lerp(rr, rn, smoothstep(L.y1 - edge, L.y1 + edge, y));
  }
  return rr;
}

function layerBreaks(layers, yMin, yMax) {
  const out = [];
  for (const L of layers) if (L.y1 > yMin && L.y1 < yMax) out.push(L.y1 - 0.45, L.y1 + 0.45);
  return out;
}

// ---- archetype: helical sea stack --------------------------------------------------------------
/**
 * o: { R, H, lobes (0-3), lobeAmp, twist (turns over H), topFrac, bulge, lean: [x,z], notch,
 *      flutes, caves: [{ th, w, h, depth }], cap: 'dome'|'point', capH, seed, sides, layerMin/Max }
 */
export function stackShape(o) {
  const R = o.R, H = o.H;
  const seed = o.seed ?? 1;
  const n = o.lobes ?? 2;
  const la = o.lobeAmp ?? 0.14;
  const tw = (o.twist ?? 0.6) * TAU;
  const ph = (o.phase ?? hash(seed) * TAU);
  const topFrac = o.topFrac ?? 0.8;
  const bulge = o.bulge ?? 0.08;
  const lean = o.lean || [0, 0];
  const nd = o.notch ?? 0.18;
  const flutes = o.flutes ?? 0.025;
  const nFl = Math.max(7, Math.round(R * 0.9));
  const caves = o.caves || [];
  const strPitch = 4.05 * (o.strataTurns ?? 2);
  const yBot = o.yBot ?? -20;
  const pointy = o.cap === 'point';
  const layers = makeLayers(seed, yBot, H, R, o);
  const prof = (u) => {
    let k = lerp(1, topFrac, Math.pow(u, o.taperPow ?? 1.3)) * (1 + bulge * Math.sin(Math.PI * Math.min(1, u * 1.1)));
    if (pointy) k *= Math.pow(Math.max(0, 1 - u), 0.35) * 0.9 + 0.1 * (1 - u);
    return k;
  };
  const rotAt = (y) => tw * clamp(y / H, 0, 1) + ph;
  const macro = (th, y) => {
    const u = clamp(y / H, 0, 1);
    let r = R * prof(u);
    if (n > 0) r *= 1 + la * Math.cos(n * (th - rotAt(y)));
    r *= notch(y, nd, 1.3, 2.3);
    if (y < 0) r *= 1 + 0.4 * smoothstep(0, -16, y); // talus apron under water
    for (const c of caves) r *= 1 - c.depth * boxStep(angDiff(th, c.th), -c.w, c.w, c.w * 0.4) * boxStep(y, -1.5, c.h, 1.4);
    return r;
  };
  const center = (y) => { const u = clamp(y / H, 0, 1); const k = u * u; return [lean[0] * k, lean[1] * k]; };
  const radius = (th, y) => {
    const c = Math.cos(th), s = Math.sin(th);
    let r = macro(th, y) * layeredR(layers, th, y, rotAt(y));
    r *= 1 + flutes * Math.sin(th * nFl + 3 * noise.noise2(c * 2 + seed, y * 0.05)) * smoothstep(2, 9, y);
    r *= 1 + 0.035 * noise.noise3(c * 1.6 + seed, y / 16, s * 1.6) + 0.018 * noise.noise3(c * 5, y / 5 + seed, s * 5);
    return r;
  };
  const strata = (th, y) => {
    let a = (th - rotAt(y)) / TAU; a -= Math.floor(a);
    return y + (o.spiralStrata === false ? 0 : a * strPitch);
  };
  const cavity = (th, y, r) => {
    let ao = 1 - 0.38 * Math.exp(-(((y - 1.3) / 2.0) ** 2)) * clamp(nd / 0.18, 0, 1.5);
    for (const L of layers) ao -= 0.22 * Math.exp(-(((y - L.y1 + 0.9) / 0.8) ** 2)); // under each ledge
    for (const c of caves) ao -= 0.6 * boxStep(angDiff(th, c.th), -c.w * 0.7, c.w * 0.7, c.w * 0.3) * boxStep(y, -1, c.h * 0.8, 1.2);
    return clamp(ao, 0.25, 1);
  };
  const capH = o.capH ?? (pointy ? R * 0.3 : R * topFrac * 0.16);
  const dist = (x, y, z) => {
    const yy = clamp(y, yBot, H);
    const c = center(yy);
    const dx = x - c[0], dz = z - c[1];
    const rho = Math.hypot(dx, dz);
    let th = Math.atan2(dz, dx); if (th < 0) th += TAU;
    const r = macro(th, yy) * layeredR(layers, th, yy, rotAt(yy)) * 1.04;
    const dSide = (rho - r) * 0.9;
    const q = clamp(rho / Math.max(r, 1), 0, 1);
    const topY = H + capH * Math.pow(1 - q * q, 0.75);
    return Math.max(dSide, y - topY);
  };
  const footprint = (x, z) => {
    const rho = Math.hypot(x, z);
    let th = Math.atan2(z, x); if (th < 0) th += TAU;
    return rho - macro(th, 0) * layeredR(layers, th, 0, rotAt(0)) * 1.3; // talus apron
  };
  return {
    type: 'stack', R, H: H + capH, yBot, radius, center, strata, cavity, dist, footprint, layers, top: H,
    build(det = 1) {
      const step = clamp(H / 50, 1.0, 3.0) / det;
      const ys = ringHeights(yBot, H, step, 0.7 / Math.max(0.6, det), det > 0.6 ? layerBreaks(layers, 4, H - 1) : []);
      const segs = clamp(Math.round((R * TAU) / 2.2 * det), 18, 140);
      const cap = pointy
        ? { kind: 'point', height: capH }
        : { kind: 'dome', height: capH, rings: Math.max(3, Math.round(6 * det)), bump: (th, f) => noise.noise2(Math.cos(th) * f * 2 + seed, Math.sin(th) * f * 2) * capH * 0.4 * f };
      const res = lathe({ ys, segs, radius, center, strata, cavity, cap, tag: 0 });
      return { mesh: res.mesh, rim: res.rim };
    },
  };
}

// ---- archetype: coiled ammonite island -------------------------------------------------------
/**
 * o: { a (inner radius of the coil), b (growth), turns, kw (ridge half-width / rho), Hin (inner
 *      crest height), tipH (crest height at the outer tip, below 0 sinks into the sea), steps (crest
 *      terraces), ribs, ribAmp, dir (+1/-1), rot, horn: { H, R, twist } | null, seed }
 */
export function coilShape(o) {
  const seed = o.seed ?? 1;
  const sp = new LogSpiral({ a: o.a ?? 18, b: o.b ?? 0.19, phi0: 0, phi1: (o.turns ?? 1.6) * TAU, dir: o.dir ?? 1, rot: o.rot ?? 0 });
  const kw = o.kw ?? 0.24;
  const Hin = o.Hin ?? 60;
  const tipH = o.tipH ?? -4;
  const nSteps = o.steps ?? 9;
  const ribs = o.ribs ?? nSteps;
  const ribAmp = o.ribAmp ?? 0.1;
  const yBot = -20;
  const rhoOut = sp.rho(sp.phi1);
  const sb = Math.sqrt(1 + sp.b * sp.b) / sp.b;
  const arcLen = sb * (rhoOut - sp.a);
  const phiAt = (t) => Math.log((sp.a + t * (rhoOut - sp.a)) / sp.a) / sp.b;
  const tAt = (phi) => (sp.rho(phi) - sp.a) / (rhoOut - sp.a);
  const ribF = (t) => Math.pow(0.5 + 0.5 * Math.cos(t * ribs * TAU), 4);
  // crest: a spiral staircase of terraces descending outward, each tread sloping gently
  const topAt = (t) => {
    const smooth = tipH + (Hin - tipH) * Math.pow(1 - t, o.fall ?? 1.15);
    const q = t * nSteps;
    const k = Math.floor(q), f = q - k;
    const t0 = k / nSteps;
    const tread = tipH + (Hin - tipH) * Math.pow(1 - t0, o.fall ?? 1.15);
    const next = tipH + (Hin - tipH) * Math.pow(1 - Math.min(1, (k + 1) / nSteps), o.fall ?? 1.15);
    const stepped = lerp(tread, next, smoothstep(0.78, 0.97, f) * 0.9 + f * 0.1);
    const base = lerp(smooth, stepped, o.stepMix ?? 0.75);
    return base + noise.noise2(t * 7 + seed, 1.3) * Math.max(0, base) * 0.05;
  };
  const halfW = (t) => {
    const rho = sp.rho(phiAt(t));
    const endTaper = smoothstep(1.0, 0.85, t);
    return Math.min(rho * kw, rho * 0.6) * (1 + ribAmp * ribF(t)) * (0.3 + 0.7 * endTaper) + 2;
  };
  // horizontal beds: hardness per bed makes the flanks step in and out
  const layers = makeLayers(seed + 11, yBot, Hin + 10, 40, { massive: 0.45, layerMin: 5, layerMax: 14 });
  const bedK = (y) => {
    let k = 0;
    while (k < layers.length - 1 && y > layers[k].y1) k++;
    const L = layers[k];
    let v = L.scale * (1 - 0.04 * (y - L.y0) / (L.y1 - L.y0));
    if (k < layers.length - 1 && y > L.y1 - 0.45) v = lerp(v, layers[k + 1].scale, smoothstep(L.y1 - 0.45, L.y1 + 0.45, y));
    return { v, k };
  };
  // facets along the arc: piecewise-linear jitter per bed and flank
  const fr = rng(seed * 3 + 1);
  const knots = [];
  for (let i = 0; i < 400; i++) knots.push(fr() * 2 - 1);
  const facet = (sArc, bed, side) => {
    const sp2 = 9 + 4 * hash(bed * 3.1 + side);
    const x = sArc / sp2 + bed * 7.3 + side * 31;
    const i = Math.floor(x), f = x - i;
    const a0 = knots[((i % 400) + 400) % 400], a1 = knots[(((i + 1) % 400) + 400) % 400];
    return lerp(a0, a1, f);
  };
  const sideW = (y, top, w) => {
    const u = clamp(y / Math.max(top, 1), 0, 1);
    let k = lerp(1.06, 0.9, Math.pow(u, 0.9));
    if (y < 0) k *= 1 + 0.42 * smoothstep(0, -14, y);
    k *= notch(y, o.notch ?? 0.12, 1.2, 2.2);
    return w * k;
  };
  const horn = o.horn === null ? null : stackShape(Object.assign({
    R: sp.a * 0.9 + halfW(0) * 0.5, H: Hin * 1.8, lobes: 3, lobeAmp: 0.2, twist: 1.3, topFrac: 0.12, taperPow: 0.9,
    bulge: 0.0, seed: seed + 7, cap: 'point', capH: 6, notch: 0.1, massive: 0.7, lean: [(hash(seed) - 0.5) * 16, (hash(seed + 1) - 0.5) * 16],
  }, o.horn || {}));

  // flank rows at absolute heights so bed ledges run continuously along the ridge
  const flankYs = (det) => ringHeights(yBot, Hin + 4, 3.0 / det, 0.8 / Math.max(0.6, det), det > 0.6 ? layerBreaks(layers, 3, Hin) : []);
  const tmp = { x: 0, z: 0 }, tg = { x: 0, z: 0 };
  const frameP = new Vector3(), frameS = new Vector3(), frameU = new Vector3(0, 1, 0);
  const frame = (t) => {
    const phi = phiAt(t);
    sp.point(phi, tmp);
    sp.tangent(phi, tg);
    frameP.set(tmp.x, 0, tmp.z);
    frameS.set(tg.z, 0, -tg.x);
    if (frameS.x * tmp.x + frameS.z * tmp.z < 0) frameS.negate();
    return { p: frameP, s: frameS, u: frameU };
  };
  const nC = 7;
  const makeProfile = (Ys) => {
    const nS = Ys.length;
    const prof = new Float32Array((nS * 2 + nC) * 2);
    return (t) => {
      const top = topAt(t);
      const w = halfW(t);
      const sArc = t * arcLen;
      const crownH = Math.max(1.0, w * 0.1);
      let q = 0;
      const flank = (k, side) => {
        let y = Ys[k];
        // rows above the crest collapse onto the crest shoulder
        const lim = top - 0.35 - (nS - k) * 0.002;
        if (y > lim) y = lim;
        const bed = bedK(y);
        let a = sideW(y, top, w) * bed.v * (1 + 0.06 * facet(sArc, bed.k, side) * smoothstep(-2, 3, y));
        a *= 1 + 0.025 * noise.noise3(sArc / 9 + seed, y / 7, side * 3);
        return [a, y];
      };
      for (let k = 0; k < nS; k++) { const [a, y] = flank(k, 0); prof[q++] = -a; prof[q++] = y; }
      const wt = sideW(top - 0.4, top, w) * bedK(top - 0.4).v * 0.97;
      for (let k = 1; k <= nC; k++) {
        const c = -1 + (2 * k) / (nC + 1);
        prof[q++] = c * wt;
        prof[q++] = top + crownH * Math.pow(1 - c * c, 0.6) + noise.noise2(c * 2 + seed, t * 11) * crownH * 0.4;
      }
      for (let k = nS - 1; k >= 0; k--) { const [a, y] = flank(k, 1); prof[q++] = a; prof[q++] = y; }
      return prof;
    };
  };

  let _qy = 0, _best = 0;
  const armDist = (phi, dPerp) => {
    const t = clamp(tAt(phi), 0, 1);
    const top = topAt(t);
    const hw = halfW(t);
    const y = clamp(_qy, yBot, top);
    const w = sideW(y, top, hw) * bedK(y).v * 1.07;
    const d = Math.max(dPerp - w, _qy - (top + Math.max(1.0, hw * 0.1)));
    if (d < _best) _best = d;
  };
  const armFoot = (phi, dPerp) => {
    const t = clamp(tAt(phi), 0, 1);
    const top = topAt(t);
    const d = top < -1 ? 1e3 : dPerp - sideW(0, top, halfW(t)) * 1.35;
    if (d < _best) _best = d;
  };
  const dist = (x, y, z) => {
    _qy = y; _best = 1e9;
    sp.arms(x, z, armDist);
    let d = _best;
    if (horn) d = Math.min(d, horn.dist(x, y, z));
    return d * 0.95;
  };
  const footprint = (x, z) => {
    _best = 1e9;
    sp.arms(x, z, armFoot);
    let d = _best;
    if (horn) d = Math.min(d, horn.footprint(x, z));
    return d;
  };
  const R = rhoOut + halfW(1) + 10;
  return {
    type: 'coil', spiral: sp, R, H: Math.max(Hin, horn ? horn.H : 0) + 10, yBot, dist, footprint, topAt, halfW, phiAt, tAt, arcLen, horn,
    build(det = 1) {
      const Ys = flankYs(det);
      const nS = Ys.length;
      const n = clamp(Math.round(arcLen / (2.5 / det)), 40, 900);
      const mesh = new RockMesh();
      const res = sweep(frame, makeProfile(Ys), {
        n, closed: false,
        strata: (t, k, P) => P.y,
        tag: (t, k) => (k >= nS && k < nS + nC ? LEDGE : 0),
        cavity: (t, k, a, b) => {
          let ao = 1 - 0.32 * Math.exp(-(((b - 1.2) / 2.0) ** 2));
          if (a < 0) ao *= lerp(1, 0.82, smoothstep(10, -5, b));
          return ao;
        },
        capEnd: true,
      }, mesh);
      const rim = [];
      for (let i = 0; i <= n; i += Math.max(1, Math.round(3 * det))) {
        const t = i / n;
        if (topAt(t) < 8) continue;
        for (const k of [nS, nS + nC - 1]) {
          const v = res.rows[i][k];
          const pOut = res.rows[i][k === nS ? nS - 1 : nS + nC];
          const px = mesh.p[v * 3], py = mesh.p[v * 3 + 1], pz = mesh.p[v * 3 + 2];
          const ox = mesh.p[pOut * 3] - px, oz = mesh.p[pOut * 3 + 2] - pz;
          const l = Math.hypot(ox, oz) || 1;
          rim.push({ x: px, y: py, z: pz, ox: ox / l, oz: oz / l, t, inner: k === nS });
        }
      }
      if (horn) {
        const pr = horn.build(det);
        mesh.append(pr.mesh);
      }
      return { mesh, rim };
    },
  };
}

// ---- archetype: spiral peak with a green terrace winding up to the summit --------------------
export function peakShape(o) {
  const seed = o.seed ?? 1;
  const R = o.R, H = o.H;
  const turns = o.turns ?? 2.2;
  const cone = stackShape({
    R, H, lobes: o.lobes ?? 1, lobeAmp: o.lobeAmp ?? 0.14, twist: turns, topFrac: o.topFrac ?? 0.18, bulge: 0.0,
    seed, cap: o.cap ?? 'point', capH: o.capH ?? R * 0.25, ledges: 0.06, flutes: 0.035, notch: o.notch ?? 0.12,
    strataTurns: 3, lean: o.lean,
  });
  // the terrace follows a conical helix hugging the cone surface
  const W = o.terraceW ?? R * 0.16;
  const y0 = o.terraceY0 ?? 6, y1 = H * (o.terraceTop ?? 0.88);
  const ph = hash(seed + 3) * TAU;
  const helixAt = (t, out) => {
    const y = lerp(y0, y1, t);
    const a = ph + t * turns * TAU;
    const r = cone.radius(a, y) * 0.94;
    const c = cone.center(y);
    return out.set(c[0] + Math.cos(a) * r, y, c[1] + Math.sin(a) * r);
  };
  const fp = new Vector3(), fs = new Vector3(), fu = new Vector3(0, 1, 0);
  const frame = (t) => {
    helixAt(t, fp);
    const a = ph + t * turns * TAU;
    fs.set(Math.cos(a), 0, Math.sin(a));
    return { p: fp, s: fs, u: fu };
  };
  const prof = new Float32Array(16);
  const profile = (t) => {
    const w = W * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.1))) * (1 + 0.25 * noise.noise2(t * 14 + seed, 2));
    const th = Math.max(2.5, w * 0.6);
    const pts = [[-w * 0.6, -th * 1.6], [w * 0.2, -th * 1.25], [w * 0.75, -th * 0.6], [w, -th * 0.15], [w * 0.98, 0.05 * w], [w * 0.6, 0.14 * w], [0, 0.16 * w], [-w * 0.6, 0.2 * w]];
    for (let k = 0; k < 8; k++) { prof[k * 2] = pts[k][0]; prof[k * 2 + 1] = pts[k][1]; }
    return prof;
  };
  const len = turns * TAU * R * 0.7;
  const dist = (x, y, z) => {
    let d = cone.dist(x, y, z);
    // terrace: the cone widened by W around the helix height band (approximate)
    const c = cone.center(clamp(y, 0, H));
    let a = Math.atan2(z - c[1], x - c[0]);
    const u = (((a - ph) / TAU) % 1 + 1) % 1;
    for (let k = 0; k < Math.ceil(turns) + 1; k++) {
      const t = (u + k) / turns;
      if (t < 0 || t > 1) continue;
      const yT = lerp(y0, y1, t);
      if (Math.abs(y - yT) > W * 1.2) continue;
      const rr = Math.hypot(x - c[0], z - c[1]) - (cone.radius(a < 0 ? a + TAU : a, yT) * 0.94 + W * 0.9);
      d = Math.min(d, Math.max(rr, Math.abs(y - (yT - W * 0.3)) - W * 0.5));
    }
    return d;
  };
  return {
    type: 'peak', R: R * 1.3, H: H + (o.capH ?? R * 0.25), yBot: -20, dist, footprint: cone.footprint, cone,
    build(det = 1) {
      const c = cone.build(det);
      const n = clamp(Math.round(len / (2.4 / det)), 40, 700);
      sweep(frame, profile, { n, closed: false, tag: (t, k) => (k >= 4 ? LEDGE : 0), strata: (t, k, P) => P.y, cavity: (t, k) => (k < 3 ? 0.75 : 1), capStart: true, capEnd: true }, c.mesh);
      const rim = c.rim.slice();
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        helixAt(t, fp);
        const a = ph + t * turns * TAU;
        const w = W * 0.95;
        rim.push({ x: fp.x + Math.cos(a) * w, y: fp.y + 0.1 * W, z: fp.z + Math.sin(a) * w, ox: Math.cos(a), oz: Math.sin(a), t, terrace: true });
      }
      return { mesh: c.mesh, rim };
    },
    terraceAt: helixAt,
  };
}

// ---- assembly --------------------------------------------------------------------------------

/**
 * Build an island record from an archetype: LOD meshes (local; the group sits at y = 0), the
 * world-space collision SDF, and the scatter metadata.
 * spec: { shape (from *Shape()), pos: Vector3 (y ignored: islands sit on the sea), rotY, style, lods }
 */
export function buildIsland(spec) {
  const shape = spec.shape;
  const style = Object.assign({ seed: spec.seed ?? 1 }, spec.style);
  const paint = rockPainter(style);
  const b0 = shape.build(spec.detail ?? 1);
  const geo0 = finishGeometry(b0.mesh, paint, { keep: true });
  let geo1 = null;
  if (spec.lod !== false) {
    const b1 = shape.build((spec.detail ?? 1) * 0.42);
    geo1 = finishGeometry(b1.mesh, paint);
  }
  const mat = terrainMaterial();
  const mesh = new Mesh(geo0, mat);
  mesh.name = 'island-' + shape.type;
  const far = geo1 ? new Mesh(geo1, mat) : null;
  if (far) far.name = mesh.name + '-lod1';
  return { shape, mesh, far, geo0, geo1, rim: b0.rim, style };
}

export { CAP, LEDGE, VOLCANIC, BASALT };

// Floating islands: a grassy, gently domed top with a soft lip, layered sedimentary cliffs
// (the banded strata of the Avatar concept art), and a craggy underside tapering into a root
// spire with hanging stalactites. Vertex-coloured for a hand-painted look.
import { BufferGeometry, Float32BufferAttribute, Mesh, Color, Vector3, Group } from 'three';
import { Noise } from '../core/noise.js';
import { rng, clamp, lerp, smoothstep, TAU } from '../core/math.js';
import { terrainMaterial } from '../render/materials.js';

const noise = new Noise(4242);

const STRATA = ['#c9b79c', '#9c93ad', '#d6c4a8', '#8a8296', '#b89f86', '#a89aa6', '#cdb99e', '#7f7a8e'].map((h) => new Color(h));
const GRASS = new Color('#86a566');
const GRASS_HI = new Color('#b3c77f');
const GRASS_DRY = new Color('#c9ba8c');
const MOSS = new Color('#6c8f55');
const UNDER = new Color('#7d7282');
const UNDER_DEEP = new Color('#5c5566');
const ROOT = new Color('#6f5c4c');

export function islandMaterial() {
  return terrainMaterial();
}

/**
 * opts: { R, H (cliff), D (underside depth), dome, seed, style: 'grass'|'forest'|'barren'|'lake'|'spire',
 *         lake: bool (flat basin on top), detail: 0.5..1 }
 */
export function buildIsland(opts) {
  const r = rng(opts.seed ?? 1);
  const seed = (opts.seed ?? 1) * 1.731;
  const R = opts.R ?? 60;
  const H = opts.H ?? R * 0.45;
  const D = opts.D ?? R * 1.4;
  const dome = opts.dome ?? R * 0.12;
  const detail = opts.detail ?? 1;
  const nT = Math.max(24, Math.round((opts.segments ?? 72) * detail));
  const style = opts.style ?? 'grass';
  const lake = !!opts.lake;
  const tipOff = new Vector3((r() - 0.5) * R * 0.35, 0, (r() - 0.5) * R * 0.35);

  const outline = (th) => {
    const c = Math.cos(th), s = Math.sin(th);
    return 1 + 0.18 * noise.fbm2(c * 1.3 + seed, s * 1.3 - seed, 3) + 0.035 * noise.noise2(c * 3.3 + seed * 2, s * 3.3);
  };
  const topY = (rr, th) => {
    // gentle dome with rolling bumps; lakes get a shallow basin rim
    const k = clamp(rr, 0, 1);
    let y = dome * Math.pow(1 - k * k, 0.7);
    const c = Math.cos(th), s = Math.sin(th);
    y += noise.fbm2(c * rr * 2.2 + seed * 3, s * rr * 2.2, 3) * dome * 0.6 * (1 - k);
    if (lake) y = lerp(y, dome * 0.15 + (k > 0.82 ? (k - 0.82) * dome * 2.5 : -dome * 0.25), smoothstep(0.0, 0.2, 1 - k) * 0.9);
    return y;
  };

  // ring definitions: [kind, param]
  const rings = [];
  const nTop = Math.max(6, Math.round(14 * detail));
  for (let i = 1; i <= nTop; i++) rings.push(['top', i / nTop]);
  rings.push(['lip', 0]);
  const nCliff = Math.max(8, Math.round(20 * detail));
  for (let i = 1; i <= nCliff; i++) rings.push(['cliff', i / nCliff]);
  const nUnder = Math.max(7, Math.round(16 * detail));
  for (let i = 1; i <= nUnder; i++) rings.push(['under', i / nUnder]);

  const pos = [], col = [], grass = [];
  const idx = [];
  const c = new Color();
  const grassy = style === 'barren' ? 0.4 : 1;
  // top centre pole
  pos.push(0, topY(0, 0), 0);
  c.copy(GRASS).lerp(GRASS_HI, 0.4);
  col.push(c.r, c.g, c.b);
  grass.push(grassy);
  const strataPhase = r() * 10;
  for (const [kind, t] of rings) {
    for (let j = 0; j < nT; j++) {
      const th = (j / nT) * TAU;
      const ol = outline(th) * R;
      const cs = Math.cos(th), sn = Math.sin(th);
      let rad, y;
      if (kind === 'top') {
        rad = ol * t * 0.985;
        y = topY(t * 0.985, th);
        const gN = noise.fbm2(cs * rad * 0.03 + seed, sn * rad * 0.03, 3);
        c.copy(GRASS).lerp(GRASS_HI, clamp(0.5 + gN, 0, 1) * 0.7);
        if (style === 'barren') c.lerp(GRASS_DRY, 0.6);
        c.lerp(GRASS_DRY, smoothstep(0.1, 0.4, noise.noise2(cs * rad * 0.012 + 9, sn * rad * 0.012)) * 0.35);
        c.lerp(MOSS, smoothstep(0.8, 1.0, t) * 0.5);
      } else if (kind === 'lip') {
        rad = ol * 1.03;
        y = topY(1, th) - 0.8;
        c.copy(MOSS);
      } else if (kind === 'cliff') {
        y = topY(1, th) - 1.5 - t * H;
        // strata terraces: alternating ledges and recesses, with vertical erosion flutes
        const band = Math.sin((y / H) * 8.5 + strataPhase + noise.noise2(cs * 2 + seed, sn * 2) * 1.2);
        const terrace = band * 0.45 + Math.round(band * 1.5) / 1.5 * 0.55;
        const flute = Math.sin(th * Math.round(R / 3.5) + noise.noise2(cs * 3 + seed, sn * 3) * 3) * 0.018;
        rad = ol * (1.0 - t * 0.07 + terrace * 0.055 + flute + noise.noise3(cs * 3, y * 0.05, sn * 3 + seed) * 0.05);
        const bi = Math.floor(((y / H) * 3.7 + strataPhase + noise.noise2(cs + seed, sn) * 0.6) % STRATA.length + STRATA.length) % STRATA.length;
        c.copy(STRATA[bi]).lerp(STRATA[(bi + 1) % STRATA.length], 0.3 + 0.3 * noise.noise2(cs * 5, y * 0.2));
        c.lerp(MOSS, smoothstep(0.25, 0.0, t) * 0.5);
      } else {
        // underside: craggy inverted cone toward an offset tip
        const u = t;
        const shape = Math.pow(1 - u, 1.25) * (1 + 0.22 * noise.noise3(cs * 2.5, u * 3 + seed, sn * 2.5) + 0.1 * noise.noise3(cs * 7, u * 9, sn * 7 - seed));
        rad = ol * Math.max(0.015, shape * (1 - 0.06));
        y = topY(1, th) - 1.5 - H - u * D;
        c.copy(UNDER).lerp(UNDER_DEEP, u);
        c.lerp(ROOT, smoothstep(0.3, 0.7, noise.noise3(cs * 6, u * 5, sn * 6 + seed)) * 0.45);
        c.lerp(STRATA[Math.floor(u * 9 + strataPhase) % STRATA.length], (1 - u) * 0.35);
      }
      let x = cs * rad, z = sn * rad;
      if (kind === 'under') {
        x += tipOff.x * t * t;
        z += tipOff.z * t * t;
      }
      pos.push(x, y, z);
      col.push(c.r, c.g, c.b);
      grass.push(kind === 'top' ? grassy : kind === 'lip' ? grassy * 0.6 : 0);
    }
  }
  // bottom tip pole
  const tipY = topY(1, 0) - 1.5 - H - D - R * 0.05;
  pos.push(tipOff.x, tipY, tipOff.z);
  c.copy(UNDER_DEEP);
  col.push(c.r, c.g, c.b);
  grass.push(0);
  const nRings = rings.length;
  const ringStart = (k) => 1 + k * nT;
  // fan from top pole
  for (let j = 0; j < nT; j++) idx.push(0, ringStart(0) + ((j + 1) % nT), ringStart(0) + j);
  for (let k = 0; k < nRings - 1; k++) {
    for (let j = 0; j < nT; j++) {
      const a = ringStart(k) + j, b = ringStart(k) + ((j + 1) % nT);
      const cc = ringStart(k + 1) + j, d = ringStart(k + 1) + ((j + 1) % nT);
      idx.push(a, b, cc, b, d, cc);
    }
  }
  const tip = pos.length / 3 - 1;
  const last = ringStart(nRings - 1);
  for (let j = 0; j < nT; j++) idx.push(last + j, last + ((j + 1) % nT), tip);

  // hanging stalactites / root spikes under the island
  const nSpikes = Math.round((opts.spikes ?? 8) * detail);
  for (let i = 0; i < nSpikes; i++) {
    const th = r() * TAU;
    const u = lerp(0.15, 0.6, r());
    const ol = outline(th) * R;
    const shape = Math.pow(1 - u, 1.25);
    const cx = Math.cos(th) * ol * shape * 0.85 + tipOff.x * u * u;
    const cz = Math.sin(th) * ol * shape * 0.85 + tipOff.z * u * u;
    const cy = topY(1, th) - 1.5 - H - u * D;
    const len = lerp(0.15, 0.45, r()) * D;
    const rad = lerp(0.04, 0.09, r()) * R;
    addSpike(pos, col, idx, cx, cy + rad, cz, rad, len, r);
  }
  while (grass.length < pos.length / 3) grass.push(0);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setAttribute('aGrass', new Float32BufferAttribute(grass, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new Mesh(geo, islandMaterial());
  mesh.name = 'island';

  const surfaceY = (x, z) => {
    const rr = Math.hypot(x, z);
    const th = Math.atan2(z, x);
    const ol = outline(th) * R;
    return topY(clamp(rr / ol, 0, 1), th);
  };
  const outlineR = (th) => outline(th) * R;
  return {
    mesh, R, H, D, dome, surfaceY, outlineR, tipOff, tipY,
    collider: { R: R * 1.05, top: dome, H: H + 1.5, D, tip: tipOff.clone() },
  };
}

function addSpike(pos, col, idx, x, y, z, rad, len, r) {
  const n = 7;
  const base = pos.length / 3;
  const c = new Color();
  for (let k = 0; k < 4; k++) {
    const t = k / 3;
    const rr = rad * Math.pow(1 - t, 1.3) + 0.05;
    const yy = y - t * len;
    const wob = (r() - 0.5) * rad * 0.6 * t;
    for (let j = 0; j < n; j++) {
      const th = (j / n) * TAU;
      pos.push(x + Math.cos(th) * rr + wob, yy, z + Math.sin(th) * rr + wob);
      c.copy(UNDER).lerp(UNDER_DEEP, t * 0.8).lerp(ROOT, 0.3);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let k = 0; k < 3; k++) {
    for (let j = 0; j < n; j++) {
      const a = base + k * n + j, b = base + k * n + ((j + 1) % n);
      const cc = base + (k + 1) * n + j, d = base + (k + 1) * n + ((j + 1) % n);
      idx.push(a, b, cc, b, d, cc);
    }
  }
}

/** Approximate signed distance from a world point to an island (for soft collisions). */
export function islandDistance(isl, p) {
  const lx = p.x - isl.pos.x, ly = p.y - isl.pos.y, lz = p.z - isl.pos.z;
  const s = isl.scale || 1;
  const C = isl.collider;
  const R = C.R * s, H = C.H * s, D = C.D * s, top = C.top * s;
  let rad, cx = 0, cz = 0;
  if (ly > 0) {
    const h = Math.hypot(lx, lz);
    if (h >= R) return Math.hypot(h - R, ly); // beside/above the rim: distance to the rim edge
    const q = h / R;
    return ly - top * Math.sqrt(1 - q * q); // over the meadow: height above the dome (negative inside)
  } else if (ly > -H) {
    rad = R;
  } else {
    // underside cone, its axis leaning toward the offset tip
    const u = (-H - ly) / D;
    const w = Math.min(u, 1) ** 2;
    cx = C.tip.x * s * w;
    cz = C.tip.z * s * w;
    if (u >= 1) return Math.hypot(lx - cx, lz - cz, ly + H + D);
    rad = R * Math.pow(1 - u, 1.25);
  }
  return Math.hypot(lx - cx, lz - cz) - rad;
}

// Biome rules: which alien plants grow where, how they clump, and how a patch keeps a harmonious
// palette. Plants grow in clusters (one rhizome, one colony) with a patch-wide hue drift, cluster
// hue and a little per-plant jitter; filler (moss cushions, curled sprouts) drifts across the
// ground with a low-frequency density field so a patch reads as a living meadow, not confetti.
//
// Ground samples: sample(x, z) -> { y, normal, slope (0 flat .. 1 vertical, default 1 - normal.y),
// wet 0..1, tidal 0..1 } or null where nothing can grow.
import { Vector3, Quaternion } from 'three';
import { rng, smoothstep, clamp, lerp, TAU } from '../core/math.js';
import { Noise } from '../core/noise.js';

const noise = new Noise(9173);
const UP = new Vector3(0, 1, 0);

// ---- ground suitability ------------------------------------------------------------------------
const slopeOf = (g) => g.slope ?? (1 - (g.normal ? g.normal.y : 1));
// dry land above the spray, gentle slopes
const dry = (g) => smoothstep(1.0, 2.6, g.y) * (1 - smoothstep(0.32, 0.55, slopeOf(g)));
const dryWet = (g) => dry(g) * (0.45 + 0.55 * (g.wet ?? 0.5));
const ledge = (g) => smoothstep(1.5, 3, g.y) * (1 - smoothstep(0.5, 0.75, slopeOf(g)));
const steep = (g) => smoothstep(1.5, 3, g.y) * smoothstep(0.25, 0.5, slopeOf(g)) * (1 - smoothstep(0.8, 0.95, slopeOf(g)));
const shoreline = (g) => smoothstep(-0.6, 0.4, g.y) * (1 - smoothstep(3.5, 6, g.y)) * (1 - smoothstep(0.4, 0.65, slopeOf(g)));
const tidal = (g) => Math.max(g.tidal ?? 0, smoothstep(-2.5, -0.6, g.y) * (1 - smoothstep(0.6, 1.4, g.y))) * (1 - smoothstep(0.55, 0.8, slopeOf(g)));
const submerged = (g) => smoothstep(-0.4, -1.5, g.y) * (1 - smoothstep(-16, -24, g.y)) * (1 - smoothstep(0.55, 0.8, slopeOf(g)));
const reefOrTidal = (g) => Math.max(tidal(g), submerged(g));
const anyGround = (g) => (1 - smoothstep(0.6, 0.85, slopeOf(g))) * smoothstep(-0.2, 0.8, g.y);

/**
 * Per biome and species: dens (plants per 100 m2 at density 1), clump [min, max] members, spread (m),
 * scale [min, max], where(g) suitability, pal (weights of the species' 4 palettes), align (0 grow
 * straight up .. 1 follow the ground normal). filler: scattered by a density field, no clusters.
 */
export const BIOMES = {
  meadow: {
    fiddle: { dens: 1.3, clump: [2, 6], spread: 3.0, scale: [0.75, 1.75], where: dryWet, pal: [0.75, 0.15, 0, 0.1] },
    tubes: { dens: 0.5, clump: [1, 3], spread: 3.2, scale: [0.7, 1.4], where: dry, pal: [0.6, 0.25, 0.05, 0.1] },
    bells: { dens: 1.0, clump: [2, 6], spread: 2.6, scale: [0.8, 1.4], where: dryWet, pal: [0.65, 0.2, 0, 0.15] },
    anemone: { dens: 1.4, clump: [4, 12], spread: 2.2, scale: [0.55, 1.25], where: dryWet, pal: [0.55, 0.25, 0.1, 0.1] },
    kelp: { dens: 0.45, clump: [2, 6], spread: 3.0, scale: [0.7, 1.35], where: dry, pal: [0.6, 0.3, 0, 0.1] },
    puffball: { dens: 0.9, clump: [3, 8], spread: 2.2, scale: [0.5, 1.2], where: dry, pal: [0.6, 0.25, 0, 0.15] },
    moss: { dens: 22, filler: true, scale: [0.5, 1.6], where: (g) => anyGround(g) * smoothstep(1.2, 2.6, g.y), pal: [0.7, 0.2, 0, 0.1] },
    sprouts: { dens: 80, filler: true, scale: [0.7, 1.5], where: dry, pal: [0.6, 0.25, 0.05, 0.1] },
  },
  shore: {
    anemone: { dens: 2.2, clump: [5, 14], spread: 2.6, scale: [0.5, 1.2], where: (g) => Math.max(shoreline(g), tidal(g) * 0.8), pal: [0.15, 0.65, 0.1, 0.1] },
    seafan: { dens: 1.8, clump: [3, 9], spread: 2.4, scale: [0.55, 1.3], where: reefOrTidal, pal: [0.55, 0.3, 0.15, 0] },
    kelp: { dens: 0.8, clump: [3, 8], spread: 2.8, scale: [0.6, 1.25], where: (g) => Math.max(shoreline(g) * 0.7, submerged(g)), pal: [0.7, 0.2, 0, 0.1] },
    tubes: { dens: 0.35, clump: [1, 3], spread: 3, scale: [0.6, 1.2], where: (g) => Math.max(shoreline(g), tidal(g)), pal: [0.3, 0.5, 0.2, 0] },
    puffball: { dens: 0.35, clump: [2, 5], spread: 1.8, scale: [0.4, 0.9], where: (g) => shoreline(g) * smoothstep(1.2, 2.5, g.y), pal: [0.3, 0.6, 0, 0.1] },
    moss: { dens: 10, filler: true, scale: [0.45, 1.3], where: (g) => anyGround(g) * smoothstep(2.4, 4.0, g.y), pal: [0.2, 0.7, 0, 0.1] },
    sprouts: { dens: 30, filler: true, scale: [0.6, 1.3], where: (g) => shoreline(g) * smoothstep(1.0, 2.0, g.y), pal: [0.2, 0.7, 0, 0.1] },
  },
  cliff: {
    fiddle: { dens: 0.8, clump: [1, 4], spread: 2.2, scale: [0.6, 1.4], where: ledge, pal: [0.4, 0.5, 0, 0.1], align: 0.45 },
    kelp: { dens: 0.9, clump: [2, 6], spread: 2.4, scale: [0.6, 1.2], where: (g) => Math.max(steep(g), ledge(g) * 0.5), pal: [0.5, 0.4, 0, 0.1], align: 0.55 },
    bells: { dens: 0.8, clump: [2, 5], spread: 2.0, scale: [0.7, 1.2], where: (g) => Math.max(steep(g), ledge(g)), pal: [0.4, 0.5, 0, 0.1], align: 0.6 },
    moss: { dens: 26, filler: true, scale: [0.4, 1.2], where: (g) => (1 - smoothstep(0.75, 0.92, slopeOf(g))) * smoothstep(1.5, 3, g.y), pal: [0.5, 0.4, 0, 0.1], align: 1 },
    sprouts: { dens: 30, filler: true, scale: [0.5, 1.2], where: ledge, pal: [0.5, 0.4, 0, 0.1] },
  },
  reef: {
    seafan: { dens: 2.6, clump: [3, 10], spread: 2.8, scale: [0.6, 1.6], where: reefOrTidal, pal: [0.4, 0.35, 0.25, 0] },
    anemone: { dens: 2.4, clump: [5, 14], spread: 2.6, scale: [0.55, 1.4], where: reefOrTidal, pal: [0, 0.35, 0.2, 0.45] },
    kelp: { dens: 1.2, clump: [3, 9], spread: 3.0, scale: [0.8, 1.6], where: submerged, pal: [0.75, 0.25, 0, 0] },
    tubes: { dens: 0.9, clump: [1, 4], spread: 2.6, scale: [0.6, 1.4], where: reefOrTidal, pal: [0.15, 0.35, 0.5, 0] },
    moss: { dens: 12, filler: true, scale: [0.4, 1.3], where: (g) => reefOrTidal(g), pal: [0.2, 0.3, 0, 0.5] },
  },
  oasis: {
    fiddle: { dens: 1.8, clump: [3, 7], spread: 3.0, scale: [0.9, 2.0], where: dryWet, pal: [0.2, 0.1, 0, 0.7] },
    tubes: { dens: 0.7, clump: [1, 4], spread: 3.0, scale: [0.8, 1.5], where: dry, pal: [0.4, 0.1, 0, 0.5] },
    bells: { dens: 1.5, clump: [2, 7], spread: 2.8, scale: [0.85, 1.5], where: dryWet, pal: [0.35, 0.15, 0, 0.5] },
    anemone: { dens: 1.6, clump: [4, 12], spread: 2.4, scale: [0.6, 1.4], where: dryWet, pal: [0.3, 0.2, 0, 0.5] },
    kelp: { dens: 0.6, clump: [2, 6], spread: 3.0, scale: [0.8, 1.5], where: dry, pal: [0.3, 0.2, 0, 0.5] },
    puffball: { dens: 1.1, clump: [3, 9], spread: 2.4, scale: [0.55, 1.3], where: dry, pal: [0.4, 0.1, 0, 0.5] },
    seafan: { dens: 1.6, clump: [3, 8], spread: 2.4, scale: [0.6, 1.4], where: reefOrTidal, pal: [0.3, 0.2, 0, 0.5] },
    moss: { dens: 32, filler: true, scale: [0.55, 1.7], where: (g) => anyGround(g) * smoothstep(1.2, 2.6, g.y), pal: [0.3, 0.1, 0, 0.6] },
    sprouts: { dens: 130, filler: true, scale: [0.7, 1.6], where: dry, pal: [0.3, 0.1, 0, 0.6] },
  },
  volcanic: {
    puffball: { dens: 0.9, clump: [3, 8], spread: 1.8, scale: [0.4, 1.0], where: anyGround, pal: [0, 0.1, 0.9, 0] },
    tubes: { dens: 0.35, clump: [1, 3], spread: 2.6, scale: [0.5, 1.0], where: anyGround, pal: [0, 0, 1, 0] },
    fiddle: { dens: 0.3, clump: [1, 3], spread: 2, scale: [0.5, 1.0], where: dry, pal: [0, 0, 1, 0] },
    moss: { dens: 18, filler: true, scale: [0.4, 1.1], where: anyGround, pal: [0, 0, 1, 0] },
    sprouts: { dens: 40, filler: true, scale: [0.5, 1.2], where: anyGround, pal: [0, 0, 1, 0] },
  },
};

// per species: minimum spacing at scale 1 (m), default ground alignment, base sink (m)
// filler: at most `cap` plants of the species per 2 m cell, across every patch (patches overlap)
export const FOOTPRINT = {
  fiddle: { space: 1.3, align: 0.18, sink: 0.08 },
  tubes: { space: 1.8, align: 0.3, sink: 0.1 },
  bells: { space: 1.4, align: 0.25, sink: 0.05 },
  anemone: { space: 1.0, align: 0.6, sink: 0.06 },
  kelp: { space: 1.2, align: 0.15, sink: 0.05 },
  seafan: { space: 1.1, align: 0.35, sink: 0.04 },
  puffball: { space: 0.9, align: 0.5, sink: 0.05 },
  moss: { space: 0.6, align: 0.95, sink: 0.06, cap: 3 },
  sprouts: { space: 0.25, align: 0.5, sink: 0.02, cap: 11 },
};

const _q = new Quaternion(), _qy = new Quaternion(), _up = new Vector3(), _n = new Vector3();

// the patch's dominant palette: strongly favours the biome's main palette (weights squared)
function pickPalette(w, r) {
  let sum = 0;
  for (const x of w) sum += x * x;
  let t = r() * sum;
  for (let i = 0; i < w.length; i++) { t -= w[i] * w[i]; if (t <= 0) return i; }
  return 0;
}

/** Orientation quaternion: local +Y toward a blend of world up and the ground normal, random yaw. */
export function plantQuat(normal, align, yaw, out = new Quaternion()) {
  _n.copy(normal || UP);
  _up.copy(UP).lerp(_n, align).normalize();
  out.setFromUnitVectors(UP, _up);
  _qy.setFromAxisAngle(UP, yaw);
  return out.multiply(_qy);
}

/**
 * Scatter one patch. emit(speciesName, x, y, z, scale, quat, seed, hue, palette, aux) is called for
 * every plant. known: Set of species names the flora can draw. shared: { occ: Map, fill: Map } kept
 * across patches so overlapping patches (meadow / cliff / shore on one island) never stack plants.
 * Returns { [species]: count }.
 */
export const SCATTER_ORDER = ['kelp', 'fiddle', 'tubes', 'bells', 'seafan', 'anemone', 'puffball', 'moss', 'sprouts'];

export function scatterPatch(patch, known, emit, shared = null) {
  const { center, radius } = patch;
  const sample = patch.sample;
  const density = clamp(patch.density ?? 1, 0, 2);
  const rules = BIOMES[patch.biome] || BIOMES.meadow;
  // patch.mult: per-species density multipliers ({ moss: 0.2 }); patch.fillerCap: max filler plants
  // of one species in this patch (a route of islands needs far less ground cover than a showcase)
  const mult = patch.mult || null;
  // patch.only: scatter just these species (a caller can split a big patch across frames); each
  // species then draws from its own seeded stream
  const only = patch.only || null;
  const r = rng((((patch.seed ?? 1) * 7919 + 101) + (only ? only.join('').length * 7717 + only[0].charCodeAt(0) * 131 : 0)) >>> 0);
  const area = Math.PI * radius * radius;
  const counts = {};
  // occupied footprints of the big plants (hash grid, 2 m cells, shared across patches)
  const occ = shared?.occ ?? new Map();
  const fill = shared?.fill ?? new Map();
  const cell = 2;
  const keyOf = (ix, iz) => ix * 73856093 ^ iz * 19349663;
  const blocked = (x, z, rad) => {
    const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
    const k = Math.ceil((rad + 2.2) / cell);
    for (let a = -k; a <= k; a++) {
      for (let b = -k; b <= k; b++) {
        const list = occ.get(keyOf(ix + a, iz + b));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 3) {
          const dx = list[i] - x, dz = list[i + 1] - z;
          const rr = list[i + 2] + rad;
          if (dx * dx + dz * dz < rr * rr) return true;
        }
      }
    }
    return false;
  };
  const occupy = (x, z, rad) => {
    const k = keyOf(Math.floor(x / cell), Math.floor(z / cell));
    let list = occ.get(k);
    if (!list) occ.set(k, (list = []));
    list.push(x, z, rad);
  };
  const inDisc = (x, z) => {
    const dx = x - center.x, dz = z - center.z;
    return dx * dx + dz * dz <= radius * radius;
  };
  const patchHue = (r() - 0.5) * 0.7;
  // big plants first (largest footprints claim space), then filler
  const order = ['kelp', 'fiddle', 'tubes', 'bells', 'seafan', 'anemone', 'puffball', 'moss', 'sprouts'];
  for (const name of order) {
    const rule = rules[name];
    if (!rule || !known.has(name) || (only && !only.includes(name))) continue;
    const fp = FOOTPRINT[name];
    const align = rule.align ?? fp.align;
    const palMain = pickPalette(rule.pal, r);
    let palAlt = palMain;
    {
      let best = -1;
      for (let i = 0; i < rule.pal.length; i++) if (i !== palMain && rule.pal[i] > best) { best = rule.pal[i]; palAlt = i; }
      if (best <= 0) palAlt = palMain;
    }
    const spHue = patchHue + (r() - 0.5) * 0.3;
    let n = 0;
    const place = (x, z, g, scale, hue, pal) => {
      const q = plantQuat(g.normal, align, r() * TAU, _q);
      const y = g.y - fp.sink * scale;
      emit(name, x, y, z, scale, q, r(), clamp(hue, -1, 1), pal, r());
      n++;
    };
    if (rule.filler) {
      // filler is capped per patch so a huge atoll cannot flood memory (drifts stay dense nearby)
      const target = Math.min(Math.round((area / 100) * rule.dens * density * (mult?.[name] ?? 1)), patch.fillerCap ?? rule.cap ?? 24000);
      const fs = 0.06 + r() * 0.04; // density field frequency (drifts ~10-17 m across)
      const off = r() * 100;
      for (let i = 0; i < target * 1.6 && n < target; i++) {
        const a = r() * TAU, rr = Math.sqrt(r()) * radius;
        const x = center.x + Math.cos(a) * rr, z = center.z + Math.sin(a) * rr;
        const field = noise.fbm2(x * fs + off, z * fs - off, 3) * 0.5 + 0.5;
        if (r() > smoothstep(0.28, 0.72, field)) continue;
        const g = sample(x, z);
        if (!g) continue;
        if (r() > rule.where(g)) continue;
        const scale = lerp(rule.scale[0], rule.scale[1], Math.pow(r(), 1.4)) * lerp(0.75, 1.15, field);
        if (blocked(x, z, fp.space * scale * 0.35)) continue;
        if (fp.cap) {
          const fk = (keyOf(Math.floor(x / cell), Math.floor(z / cell)) * 31 + name.length) | 0;
          const nf = fill.get(fk) || 0;
          if (nf >= fp.cap) continue;
          fill.set(fk, nf + 1);
        }
        const hue = spHue + (field - 0.5) * 0.5 + (r() - 0.5) * 0.12;
        place(x, z, g, scale, hue, r() < 0.12 ? palAlt : palMain);
      }
    } else {
      const avg = (rule.clump[0] + rule.clump[1]) * 0.5;
      const clusters = Math.max(0, Math.round((area / 100) * rule.dens * density * (mult?.[name] ?? 1) / avg + (r() - 0.5)));
      for (let c = 0; c < clusters; c++) {
        let cx = 0, cz = 0, g0 = null;
        for (let tries = 0; tries < 4 && !g0; tries++) {
          const a = r() * TAU, rr = Math.sqrt(r()) * radius;
          cx = center.x + Math.cos(a) * rr; cz = center.z + Math.sin(a) * rr;
          const g = sample(cx, cz);
          if (g && r() <= rule.where(g)) g0 = g;
        }
        if (!g0) continue;
        const members = rule.clump[0] + Math.floor(r() * (rule.clump[1] - rule.clump[0] + 1));
        const cHue = spHue + (r() - 0.5) * 0.4;
        const cPal = r() < 0.15 ? palAlt : palMain;
        const cScale = lerp(0.85, 1.15, r());
        let placed = 0;
        for (let m = 0; m < members * 3 && placed < members; m++) {
          // gaussian spread (widening as the colony fills), the first member at the centre is
          // the biggest (the parent)
          const first = m === 0;
          const gr = first ? 0 : Math.sqrt(-2 * Math.log(Math.max(1e-6, r()))) * rule.spread * (0.5 + 0.15 * placed);
          const ga = r() * TAU;
          const x = cx + Math.cos(ga) * gr, z = cz + Math.sin(ga) * gr;
          if (!inDisc(x, z)) continue;
          const g = first ? g0 : sample(x, z);
          if (!g || (!first && r() > rule.where(g) * 1.3)) continue;
          let scale = lerp(rule.scale[0], rule.scale[1], Math.pow(r(), 1.3)) * cScale;
          if (first) scale = Math.max(scale, lerp(rule.scale[0], rule.scale[1], 0.75));
          const rad = fp.space * scale * 0.5;
          if (blocked(x, z, rad)) continue;
          occupy(x, z, rad);
          place(x, z, g, scale, cHue + (r() - 0.5) * 0.14, cPal);
          placed++;
        }
      }
    }
    counts[name] = n;
  }
  return counts;
}

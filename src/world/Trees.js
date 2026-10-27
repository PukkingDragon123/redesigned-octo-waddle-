// Stylized vegetation built as instanced templates.
// Canopies are clusters of noise-displaced blobs whose normals are transferred from the
// overall crown (soft, painterly shading), with leaf translucency when backlit and wind sway
// weighted from trunk to twig. Templates: broadleaf (Ghibli camphor), umbrella pine, cypress,
// weeping willow, bush, boulder, giant tree (buttress roots, layered crowns, hanging moss),
// and hanging vines.
import {
  BufferGeometry, Float32BufferAttribute, InstancedMesh, ShaderMaterial, Color, Vector3, Matrix4,
  Quaternion, IcosahedronGeometry, DoubleSide, Object3D,
} from 'three';
import { G } from '../render/Globals.js';
import { UNIFORMS, NOISE, SHADOW, LIGHTING, WIND } from '../render/shaders/common.js';
import { getNoiseTexture } from '../render/NoiseTex.js';
import { Noise } from '../core/noise.js';
import { rng, lerp, clamp, TAU, smoothstep } from '../core/math.js';

const noise = new Noise(777);

const VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${WIND}
attribute vec4 aVeg;   // x flex (0 rigid .. 1 tip), y leaf (0 bark, 1 leaf, 2 vine), z phase, w ao
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying vec4 vVeg;
uniform float uSwayAmt;
void main() {
  vec3 transformed = position;
  vec3 n = normal;
  #ifdef USE_INSTANCING
    transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  float ph = aVeg.z + wp.x * 0.013 + wp.z * 0.011;
  vec3 sway = windSway(wp.xyz, aVeg.x * uSwayAmt, ph);
  // vines and leaves flutter more
  sway *= 1.0 + aVeg.y * 0.6;
  wp.xyz += sway;
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  #ifdef USE_COLOR
    vColor = color;
  #else
    vColor = vec3(1.0);
  #endif
  vVeg = aVeg;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
uniform sampler2D uNoise;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying vec4 vVeg;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 albedo = vColor;
  float leaf = step(0.5, vVeg.y) * step(vVeg.y, 1.5);
  float vine = step(1.5, vVeg.y);
  Surface s = makeSurface(albedo, N, vWorldPos);
  if (leaf > 0.5) {
    // leaf clumps: soft value variation across the crown
    float c1 = texture2D(uNoise, vWorldPos.xz / 9.0 + vWorldPos.y / 13.0).g;
    float c2 = texture2D(uNoise, vWorldPos.xy / 3.1 + vWorldPos.z / 5.0).b;
    s.albedo *= 0.8 + 0.3 * c1 + 0.12 * (c2 - 0.5);
    s.trans = 0.65;
    s.wrap = 0.3;
    s.rim = 0.35;
  } else if (vine > 0.5) {
    s.trans = 0.45;
    s.wrap = 0.3;
    s.rim = 0.3;
  } else {
    float bark = texture2D(uNoise, vec2(atan(vWorldPos.x, vWorldPos.z) * 2.0, vWorldPos.y / 7.0)).b;
    s.albedo *= 0.85 + 0.25 * bark;
    s.rim = 0.25;
    s.wrap = 0.18;
  }
  s.ao = vVeg.w;
  s.shadow = sampleShadow(vWorldPos, N);
  vec3 col = stylizedLight(s);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

let _mat = null;
export function vegMaterial() {
  if (_mat) return _mat;
  _mat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: Object.assign({}, G, { uNoise: { value: getNoiseTexture() }, uSwayAmt: { value: 1 } }),
    vertexColors: true,
    side: DoubleSide,
  });
  return _mat;
}

// ---- geometry builder ------------------------------------------------------------------
class Builder {
  constructor() {
    this.pos = []; this.nor = []; this.col = []; this.veg = []; this.idx = [];
  }
  get count() { return this.pos.length / 3; }
  vert(p, n, c, flex, kind, phase, ao) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(c.r, c.g, c.b);
    this.veg.push(flex, kind, phase, ao);
    return this.count - 1;
  }
  /** Tapered tube along a polyline of points with radii. */
  tube(points, radii, color, flexFn, seg = 8, kind = 0, colorFn = null) {
    const base = this.count;
    const n = points.length;
    const tmpN = new Vector3(), side = new Vector3(), up = new Vector3();
    const c = new Color();
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const t = new Vector3().subVectors(points[Math.min(n - 1, i + 1)], points[Math.max(0, i - 1)]).normalize();
      const ref = Math.abs(t.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
      side.crossVectors(t, ref).normalize();
      up.crossVectors(side, t).normalize();
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * TAU;
        tmpN.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
        const rr = radii[i] * (1 + 0.08 * Math.sin(a * 3 + i));
        const v = p.clone().addScaledVector(tmpN, rr);
        c.copy(colorFn ? colorFn(i / (n - 1), a) : color);
        this.vert(v, tmpN, c, flexFn(i / (n - 1)), kind, i * 0.3, 0.8 + 0.2 * (i / (n - 1)));
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = base + i * seg + j, b = base + i * seg + ((j + 1) % seg);
        const cc = base + (i + 1) * seg + j, d = base + (i + 1) * seg + ((j + 1) % seg);
        this.idx.push(a, cc, b, b, cc, d);
      }
    }
  }
  /** Noise-displaced blob whose normals come from the crown centre (soft painterly shading). */
  blob(center, radius, crownCenter, crownR, color, flex, opts = {}) {
    const ico = new IcosahedronGeometry(1, opts.detail ?? 2);
    const p = ico.attributes.position;
    const base = this.count;
    const v = new Vector3(), n = new Vector3(), c = new Color();
    const sq = opts.squash ?? 0.85;
    const seed = opts.seed ?? 0;
    // de-index: icosahedron geometry is non-indexed in three (each face its own verts)
    const map = new Map();
    const indices = [];
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
      let id = map.get(key);
      if (id === undefined) {
        const dir = v.clone().normalize();
        const disp = 1 + 0.22 * noise.noise3(dir.x * 1.7 + seed, dir.y * 1.7, dir.z * 1.7 - seed) + 0.1 * noise.noise3(dir.x * 4 + seed, dir.y * 4, dir.z * 4);
        const wp = dir.clone().multiplyScalar(radius * disp);
        wp.y *= sq;
        wp.add(center);
        // transferred normal: from the crown centre, blended with the blob's own
        n.copy(wp).sub(crownCenter).normalize().multiplyScalar(0.7).addScaledVector(dir, 0.45).normalize();
        const lightness = clamp(0.5 + (wp.y - crownCenter.y) / (crownR * 2) + 0.3 * noise.noise3(wp.x * 0.1, wp.y * 0.1, wp.z * 0.1), 0, 1);
        c.copy(color.dark).lerp(color.light, lightness);
        const ao = clamp(0.55 + 0.45 * ((wp.distanceTo(crownCenter) / crownR) * 0.8 + (wp.y > crownCenter.y ? 0.25 : 0)), 0.4, 1);
        id = this.vert(wp, n, c, flex, 1, seed, ao);
        map.set(key, id);
      }
      indices.push(id);
    }
    for (let i = 0; i < indices.length; i += 3) this.idx.push(indices[i], indices[i + 1], indices[i + 2]);
    ico.dispose();
    return base;
  }
  /** Hanging strand (vine / moss curtain): a narrow ribbon, flex grows downward. */
  strand(top, length, width, color, seg = 6, phase = 0) {
    const base = this.count;
    const c = new Color();
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const y = top.y - t * length;
      const w = width * (1 - t * 0.7);
      const curl = Math.sin(t * 3 + phase) * length * 0.04;
      c.copy(color.top).lerp(color.bottom, t);
      this.vert(new Vector3(top.x - w + curl, y, top.z), new Vector3(0, 0, 1), c, t * t * 1.5, 2, phase, 0.85);
      this.vert(new Vector3(top.x + w + curl, y, top.z), new Vector3(0, 0, 1), c, t * t * 1.5, 2, phase, 0.85);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  build() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('aVeg', new Float32BufferAttribute(this.veg, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const LEAF = {
  green: { dark: new Color('#3f6b3d'), light: new Color('#8db063') },
  spring: { dark: new Color('#4b7a45'), light: new Color('#a6c46e') },
  deep: { dark: new Color('#2f5640'), light: new Color('#6f9a5c') },
  autumn: { dark: new Color('#7a6a3c'), light: new Color('#d0b46a') },
  blossom: { dark: new Color('#c98aa0'), light: new Color('#f6d6dc') },
  teal: { dark: new Color('#2f5f5a'), light: new Color('#7fb2a0') },
};
const BARK = new Color('#7c6a5c');
const BARK_LIGHT = new Color('#a39282');

function curvedLine(base, height, bend, steps, r) {
  const pts = [];
  const dx = (r() - 0.5) * bend, dz = (r() - 0.5) * bend;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(new Vector3(base.x + dx * t * t, base.y + t * height, base.z + dz * t * t));
  }
  return pts;
}

/** Template generators. Each returns a BufferGeometry with the tree base at the origin. */
export const TEMPLATES = {
  broadleaf(seed = 1, palette = LEAF.green) {
    const r = rng(seed);
    const b = new Builder();
    const h = lerp(8, 12, r());
    const trunk = curvedLine(new Vector3(), h, 2.5, 6, r);
    b.tube(trunk, trunk.map((_, i) => lerp(0.75, 0.32, i / 6)), BARK, (t) => t * 0.25, 9, 0, (t) => BARK.clone().lerp(BARK_LIGHT, t * 0.5));
    const top = trunk[trunk.length - 1];
    const crown = top.clone().add(new Vector3(0, 2.5, 0));
    const crownR = lerp(5.5, 7.5, r());
    // a few branches reaching into the crown
    for (let k = 0; k < 3; k++) {
      const a = r() * TAU;
      const start = trunk[3 + (k % 3)];
      const end = crown.clone().add(new Vector3(Math.cos(a) * crownR * 0.6, (r() - 0.3) * 2, Math.sin(a) * crownR * 0.6));
      const pts = [start, start.clone().lerp(end, 0.5).add(new Vector3(0, 0.6, 0)), end];
      b.tube(pts, [0.3, 0.2, 0.1], BARK, (t) => 0.25 + t * 0.35, 6);
    }
    const nb = 9 + Math.floor(r() * 5);
    for (let k = 0; k < nb; k++) {
      const d = r.onSphere(new Vector3());
      d.y = Math.abs(d.y) * 0.7 - 0.1;
      const c = crown.clone().addScaledVector(d, crownR * lerp(0.35, 0.75, r()));
      b.blob(c, crownR * lerp(0.42, 0.6, r()), crown, crownR, palette, 0.6 + 0.4 * r(), { seed: k * 3.1 + seed, squash: 0.82 });
    }
    return { geo: b.build(), height: h + crownR * 1.6, radius: crownR * 1.3 };
  },
  umbrella(seed = 1, palette = LEAF.deep) {
    const r = rng(seed);
    const b = new Builder();
    const h = lerp(14, 20, r());
    const trunk = curvedLine(new Vector3(), h, 5, 8, r);
    b.tube(trunk, trunk.map((_, i) => lerp(0.7, 0.28, i / 8)), BARK, (t) => t * 0.3, 8, 0, (t) => BARK.clone().lerp(BARK_LIGHT, t * 0.6));
    const top = trunk[trunk.length - 1];
    const crownR = lerp(7, 10, r());
    // a forked crown of flat pads
    const nb = 7 + Math.floor(r() * 4);
    for (let k = 0; k < nb; k++) {
      const a = (k / nb) * TAU + r() * 0.4;
      const rr = crownR * lerp(0.2, 0.75, r());
      const c = top.clone().add(new Vector3(Math.cos(a) * rr, 1 + r() * 1.5, Math.sin(a) * rr));
      if (k % 2 === 0) b.tube([trunk[6], c.clone().add(new Vector3(0, -0.6, 0))], [0.22, 0.1], BARK, (t) => 0.3 + t * 0.4, 5);
      b.blob(c, crownR * lerp(0.35, 0.48, r()), top.clone().add(new Vector3(0, 1.8, 0)), crownR, palette, 0.6 + 0.4 * r(), { seed: k * 2.3 + seed, squash: 0.42 });
    }
    return { geo: b.build(), height: h + 4, radius: crownR * 1.2 };
  },
  cypress(seed = 1, palette = LEAF.deep) {
    const r = rng(seed);
    const b = new Builder();
    const h = lerp(12, 18, r());
    const trunk = curvedLine(new Vector3(), h * 0.4, 0.6, 3, r);
    b.tube(trunk, [0.45, 0.4, 0.33, 0.3], BARK, (t) => t * 0.2, 7);
    const n = 7;
    const crown = new Vector3(0, h * 0.55, 0);
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const y = lerp(h * 0.18, h * 0.95, t);
      const rad = lerp(2.4, 0.9, t) * lerp(0.9, 1.1, r());
      b.blob(new Vector3((r() - 0.5) * 0.6, y, (r() - 0.5) * 0.6), rad, crown, h * 0.5, palette, 0.35 + t * 0.6, { seed: k + seed, squash: 1.25, detail: 1 });
    }
    return { geo: b.build(), height: h, radius: 3 };
  },
  willow(seed = 1, palette = LEAF.spring) {
    const r = rng(seed);
    const b = new Builder();
    const h = lerp(7, 10, r());
    const trunk = curvedLine(new Vector3(), h, 4, 6, r);
    b.tube(trunk, trunk.map((_, i) => lerp(0.7, 0.3, i / 6)), BARK, (t) => t * 0.3, 8);
    const top = trunk[trunk.length - 1];
    const crownR = lerp(5, 7, r());
    for (let k = 0; k < 6; k++) {
      const d = r.onSphere(new Vector3());
      d.y = Math.abs(d.y) * 0.5;
      b.blob(top.clone().addScaledVector(d, crownR * 0.45), crownR * 0.5, top, crownR, palette, 0.7, { seed: k + seed, squash: 0.7, detail: 1 });
    }
    // weeping curtains
    const vc = { top: palette.dark.clone().lerp(palette.light, 0.4), bottom: palette.light.clone() };
    for (let k = 0; k < 34; k++) {
      const a = r() * TAU;
      const rr = crownR * lerp(0.5, 1.0, r());
      const p = top.clone().add(new Vector3(Math.cos(a) * rr, -0.5 + r() * 1.5, Math.sin(a) * rr));
      b.strand(p, lerp(4, 8, r()), lerp(0.25, 0.45, r()), vc, 5, r() * 6);
    }
    return { geo: b.build(), height: h + 3, radius: crownR * 1.2 };
  },
  bush(seed = 1, palette = LEAF.green) {
    const r = rng(seed);
    const b = new Builder();
    const R = lerp(1.2, 2.2, r());
    const cc = new Vector3(0, R * 0.6, 0);
    for (let k = 0; k < 4; k++) {
      const d = r.onSphere(new Vector3());
      d.y = Math.abs(d.y) * 0.4;
      b.blob(cc.clone().addScaledVector(d, R * 0.45), R * lerp(0.55, 0.75, r()), cc, R, palette, 0.25, { seed: k + seed, squash: 0.75, detail: 1 });
    }
    return { geo: b.build(), height: R * 1.5, radius: R * 1.3 };
  },
  boulder(seed = 1) {
    const r = rng(seed);
    const b = new Builder();
    const ico = new IcosahedronGeometry(1, 2);
    const p = ico.attributes.position;
    const map = new Map();
    const ids = [];
    const c = new Color();
    const v = new Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
      let id = map.get(key);
      if (id === undefined) {
        const d = v.clone().normalize();
        const disp = 1 + 0.25 * noise.noise3(d.x * 1.5 + seed, d.y * 1.5, d.z * 1.5) + 0.12 * noise.noise3(d.x * 4, d.y * 4 + seed, d.z * 4);
        const w = d.clone().multiplyScalar(disp);
        w.y = w.y * 0.7 + 0.35;
        c.set('#a69c9a').lerp(new Color('#6f8f58'), smoothstep(0.3, 0.8, d.y) * 0.8);
        id = b.vert(w, d, c, 0, 0, 0, 0.7 + 0.3 * Math.max(d.y, 0));
        map.set(key, id);
      }
      ids.push(id);
    }
    for (let i = 0; i < ids.length; i += 3) b.idx.push(ids[i], ids[i + 1], ids[i + 2]);
    ico.dispose();
    return { geo: b.build(), height: 1, radius: 1 };
  },
  giant(seed = 1, palette = LEAF.deep, opts = {}) {
    const r = rng(seed);
    const b = new Builder();
    const H = opts.height ?? lerp(130, 180, r());
    const R0 = opts.trunkR ?? H * 0.075;
    // buttress roots flaring into the island
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU + r() * 0.3;
      const pts = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        const rad = lerp(R0 * 2.6, R0 * 0.6, Math.pow(t, 0.6));
        pts.push(new Vector3(Math.cos(a) * rad, lerp(-R0 * 0.8, H * 0.12, t), Math.sin(a) * rad));
      }
      b.tube(pts, pts.map((_, i) => lerp(R0 * 0.35, R0 * 0.25, i / 5)), BARK, () => 0, 7, 0, (t) => BARK.clone().lerp(new Color('#6b7f58'), 0.35 * (1 - t)));
    }
    // trunk: slightly twisting column
    const trunk = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      trunk.push(new Vector3(Math.sin(t * 2.2 + seed) * R0 * 0.6, t * H * 0.78, Math.cos(t * 1.7 + seed) * R0 * 0.6));
    }
    b.tube(trunk, trunk.map((_, i) => lerp(R0, R0 * 0.45, i / 12)), BARK, (t) => t * 0.05, 14, 0,
      (t, a) => BARK.clone().lerp(BARK_LIGHT, 0.2 + 0.3 * Math.sin(a * 5 + t * 20) * 0.5).lerp(new Color('#6f8a5a'), smoothstep(0.6, 1, Math.sin(a + 1.2)) * 0.25));
    // layered crowns on great curving limbs
    const layers = opts.layers ?? 5;
    const crownC = new Vector3(0, H * 0.8, 0);
    for (let l = 0; l < layers; l++) {
      const lt = l / Math.max(1, layers - 1);
      const y = lerp(H * 0.42, H * 0.9, lt);
      const spread = lerp(H * 0.4, H * 0.16, lt);
      const nLimbs = l === layers - 1 ? 3 : 5;
      for (let k = 0; k < nLimbs; k++) {
        const a = (k / nLimbs) * TAU + l * 1.3 + r() * 0.5;
        const start = new Vector3(0, y - H * 0.08, 0);
        const end = new Vector3(Math.cos(a) * spread, y + H * 0.05 + r() * H * 0.04, Math.sin(a) * spread);
        const m1 = start.clone().lerp(end, 0.35).add(new Vector3(0, H * 0.03, 0));
        const m2 = start.clone().lerp(end, 0.7).add(new Vector3(0, H * 0.06, 0));
        b.tube([start, m1, m2, end], [R0 * 0.42, R0 * 0.3, R0 * 0.2, R0 * 0.1], BARK, (t) => 0.04 + t * 0.12, 8);
        const padR = lerp(H * 0.08, H * 0.11, r()) * (1.15 - lt * 0.3);
        const nPads = 6;
        for (let q = 0; q < nPads; q++) {
          const off = new Vector3((r() - 0.5) * padR * 2.0, (r() - 0.25) * padR * 0.8, (r() - 0.5) * padR * 2.0);
          b.blob(end.clone().lerp(m2, q < 2 ? 0.5 : 0).add(off), padR * lerp(0.7, 1.0, r()), crownC, H * 0.45, palette, 0.22, { seed: l * 10 + k * 3 + q + seed, squash: 0.62 });
        }
        // hanging moss curtains from the limb
        const mc = { top: new Color('#7f9a64'), bottom: new Color('#b7c98c') };
        for (let q = 0; q < 5; q++) {
          const t = 0.3 + r() * 0.6;
          const p2 = start.clone().lerp(end, t).add(new Vector3(0, -R0 * 0.15, 0));
          b.strand(p2, lerp(H * 0.06, H * 0.16, r()), lerp(0.4, 0.9, r()), mc, 6, r() * 6);
        }
      }
    }
    // crown cap
    for (let q = 0; q < 5; q++) {
      const off = new Vector3((r() - 0.5) * H * 0.12, H * 0.96 + r() * H * 0.04, (r() - 0.5) * H * 0.12);
      b.blob(off, H * 0.09, crownC, H * 0.45, palette, 0.22, { seed: 99 + q + seed, squash: 0.7 });
    }
    return { geo: b.build(), height: H, radius: H * 0.5 };
  },
  vine(seed = 1) {
    const r = rng(seed);
    const b = new Builder();
    const vc = { top: new Color('#5d7f4e'), bottom: new Color('#9fbf78') };
    for (let k = 0; k < 3; k++) {
      b.strand(new Vector3((r() - 0.5) * 1.2, 0, (r() - 0.5) * 1.2), lerp(0.7, 1.0, r()), 0.035, vc, 8, r() * 6);
    }
    return { geo: b.build(), height: 1, radius: 1 };
  },
};

export const PALETTES = LEAF;

/**
 * Instanced forest: collects placements per template key, then builds one InstancedMesh per key.
 */
export class Vegetation {
  constructor(game) {
    this.game = game;
    this.templates = new Map(); // key -> {geo, height, radius}
    this.placements = new Map(); // key -> [matrix]
    this.meshes = [];
  }

  template(key, factory) {
    if (!this.templates.has(key)) this.templates.set(key, factory());
    return this.templates.get(key);
  }

  add(key, factory, pos, scale = 1, rotY = 0, tilt = null) {
    this.template(key, factory);
    if (!this.placements.has(key)) this.placements.set(key, []);
    const m = new Matrix4();
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rotY);
    if (tilt) q.premultiply(tilt);
    m.compose(pos, q, new Vector3(scale, scale, scale));
    this.placements.get(key).push(m);
  }

  build(scene, shadows, castShadows = true) {
    const mat = vegMaterial();
    for (const [key, list] of this.placements) {
      const t = this.templates.get(key);
      const mesh = new InstancedMesh(t.geo, mat, list.length);
      for (let i = 0; i < list.length; i++) mesh.setMatrixAt(i, list[i]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = 'veg-' + key;
      scene.add(mesh);
      if (castShadows && shadows && !key.startsWith('vine')) shadows.addCaster(mesh);
      this.meshes.push(mesh);
    }
    this.placements.clear();
    return this.meshes;
  }
}

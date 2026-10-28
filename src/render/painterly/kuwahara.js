// Anisotropic Kuwahara kernel (Kyprianidis, Kang, Doellner 2009; polynomial sector weights from
// Kyprianidis, Semmo, Kang, Doellner 2010, "Anisotropic Kuwahara Filtering with Polynomial
// Weighting Functions").
//
// The filter maps each pixel's neighbourhood to the unit disk through the local structure: an
// ellipse stretched along the edge tangent (a = r(alpha + A)/alpha, b = r alpha/(alpha + A), so the
// area stays pi r^2). The disk is split into 8 overlapping sectors; each sector's weighted mean and
// variance are computed, and the output favours the flattest sectors: edges stay crisp while
// surfaces settle into soft directional strokes.
//
// Here the disk is sampled with a FIXED set of points (rings of 8, in antipodal pairs). The sector
// weights of a point depend only on its disk position, so they are evaluated once in JS and baked
// into the generated GLSL as constants (only the non-zero terms are emitted). Per pixel the shader
// only places the points on the ellipse (two FMAs per point), fetches them (bilinear) and
// accumulates: no per-tap polynomial math, no loops over all pixels of the bounding box.

/** Polynomial sector weights w_k(v), k = 0..7, for a point v of the unit disk (normalised, Gaussian). */
export function sectorWeights(vx, vy, zeta, eta) {
  const w = new Array(8).fill(0);
  let vxx = zeta - eta * vx * vx;
  let vyy = zeta - eta * vy * vy;
  let z = Math.max(0, vy + vxx); w[0] = z * z;
  z = Math.max(0, -vx + vyy); w[2] = z * z;
  z = Math.max(0, -vy + vxx); w[4] = z * z;
  z = Math.max(0, vx + vyy); w[6] = z * z;
  const rx = Math.SQRT1_2 * (vx - vy), ry = Math.SQRT1_2 * (vx + vy);
  vxx = zeta - eta * rx * rx;
  vyy = zeta - eta * ry * ry;
  z = Math.max(0, ry + vxx); w[1] = z * z;
  z = Math.max(0, -rx + vyy); w[3] = z * z;
  z = Math.max(0, -ry + vxx); w[5] = z * z;
  z = Math.max(0, rx + vyy); w[7] = z * z;
  let sum = 0;
  for (const x of w) sum += x;
  const g = Math.exp(-3.125 * (vx * vx + vy * vy)) / Math.max(sum, 1e-9);
  return w.map((x) => x * g);
}

/**
 * Build the sample set: `rings` equal-area rings of 8 points (4 antipodal pairs each), staggered
 * half a sector on alternate rings, plus the centre.
 */
export function buildKernel({ rings = 4, zeta = 0.33, zeroCross = 0.62, twist = 0.21 } = {}) {
  const eta = (zeta + Math.cos(zeroCross)) / (Math.sin(zeroCross) ** 2);
  const pairs = [];
  let terms = 0;
  for (let i = 0; i < rings; i++) {
    const r = Math.sqrt((i + 0.5) / rings) * 0.97;
    for (let j = 0; j < 4; j++) {
      const th = ((j + 0.5 * (i & 1)) / 8) * Math.PI * 2 + i * twist;
      const vx = Math.cos(th) * r, vy = Math.sin(th) * r;
      const w = sectorWeights(vx, vy, zeta, eta);
      const max = Math.max(...w);
      const ws = w.map((x) => (x > max * 0.02 ? x : 0));
      terms += ws.filter((x) => x > 0).length * 2;
      pairs.push({ vx, vy, w: ws });
    }
  }
  // the centre belongs equally to every sector; weight it like one ring sample
  const wc = sectorWeights(0, 0, zeta, eta)[0];
  return { pairs, wc, terms, samples: pairs.length * 2 + 1, zeta, eta };
}

const f = (x) => {
  const s = x.toFixed(6);
  return s.includes('.') ? s : s + '.0';
};

/**
 * GLSL function `vec3 kuwahara(vec2 uv, vec2 ax, vec2 by)`: ax/by are the ellipse half-axes in uv
 * units (major along the edge tangent, minor across). Needs `uniform sampler2D tColor` and
 * `uniform float uHard` (variance hardness).
 */
export function kuwaharaGLSL(kernel) {
  const L = [];
  L.push('vec3 kuwahara(vec2 uv, vec2 ax, vec2 by) {');
  L.push('  vec4 m0 = vec4(0.0), m1 = vec4(0.0), m2 = vec4(0.0), m3 = vec4(0.0), m4 = vec4(0.0), m5 = vec4(0.0), m6 = vec4(0.0), m7 = vec4(0.0);');
  L.push('  float s0 = 0.0, s1 = 0.0, s2 = 0.0, s3 = 0.0, s4 = 0.0, s5 = 0.0, s6 = 0.0, s7 = 0.0;');
  L.push('  vec3 c0, c1; float q0, q1; vec4 a0, a1; vec2 ko;');
  L.push(`  c0 = texture(tColor, uv).rgb; q0 = dot(c0, c0) * ${f(kernel.wc)}; a0 = vec4(c0, 1.0) * ${f(kernel.wc)};`);
  for (let k = 0; k < 8; k++) L.push(`  m${k} += a0; s${k} += q0;`);
  for (const p of kernel.pairs) {
    L.push(`  ko = ${f(p.vx)} * ax + ${f(p.vy)} * by;`);
    L.push('  c0 = texture(tColor, uv + ko).rgb; c1 = texture(tColor, uv - ko).rgb; q0 = dot(c0, c0); q1 = dot(c1, c1);');
    L.push('  a0 = vec4(c0, 1.0); a1 = vec4(c1, 1.0);');
    for (let k = 0; k < 8; k++) {
      const w = p.w[k];
      if (!w) continue;
      const k2 = (k + 4) & 7;
      L.push(`  m${k} += a0 * ${f(w)}; s${k} += q0 * ${f(w)}; m${k2} += a1 * ${f(w)}; s${k2} += q1 * ${f(w)};`);
    }
  }
  L.push('  vec4 acc = vec4(0.0);');
  for (let k = 0; k < 8; k++) L.push(`  acc += kuwSector(m${k}, s${k});`);
  L.push('  return acc.rgb / max(acc.a, 1e-6);');
  L.push('}');
  return /* glsl */ `
// sector mean weighted by 1 / (1 + (hardness * variance)^4)  (q = 8)
vec4 kuwSector(vec4 m, float s) {
  vec3 mu = m.rgb / m.a;
  float v = max(s / m.a - dot(mu, mu), 0.0);
  float x = uHard * v;
  x *= x;
  float w = 1.0 / (1.0 + x * x);
  return vec4(mu * w, w);
}
${L.join('\n')}
`;
}

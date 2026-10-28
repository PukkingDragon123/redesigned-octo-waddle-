// Giant spiral fiddlehead: a rosette of three croziers that slowly coil and uncoil, each at its own
// stage (the planet's spiral motif). A stem is a real tube whose centreline is integrated in the
// vertex shader from a curvature that grows toward the tip (an Euler-like spiral), so one parameter
// (curl) morphs it from an open shepherd's crook to a tight two-turn coil. Leaflets (pinnae) unroll
// out of the crozier wherever the stem has unrolled and stay furled as tiny scrolls where it is
// still coiled. Startled fronds coil up tight.
import { Template, adaptiveRings } from '../geometry.js';

const TH = 11.5; // coil angle at full curl (rad, ~1.8 turns)
const PW = 2.35; // curvature growth exponent
const FRONDS = [
  // azimuth, length, phase offset, lean outward
  [0.0, 1.0, 0.0, 0.22],
  [2.3, 0.78, 0.37, 0.5],
  [4.25, 0.6, 0.71, 0.7],
];

function template(lod) {
  const t = new Template();
  const rings = lod === 0 ? 34 : 15;
  const sides = lod === 0 ? 8 : 5;
  const ss = adaptiveRings(rings, (s) => TH * PW * Math.pow(s, PW - 1) * 0.3, 0.01);
  FRONDS.forEach((F, f) => {
    const q = [f, F[0], F[1], F[2]];
    const base = t.count;
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j <= sides; j++) t.v(ss[i], (j / sides) * Math.PI * 2, 0, [0, 0, 0, F[3]], q);
    }
    const cols = sides + 1;
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const a = base + i * cols + j;
        // front faces outward (the shader's tube normal)
        t.quad(a, a + cols, a + 1, a + cols + 1);
      }
    }
    // pinnae: pairs of leaflets along the stem
    const K = lod === 0 ? 7 : 4;
    const M = lod === 0 ? 4 : 2;
    const across = lod === 0 ? [-1, 0, 1] : [-1, 1];
    for (let k = 0; k < K; k++) {
      const sk = 0.3 + (0.58 * k) / (K - 1);
      for (const side of [-1, 1]) {
        t.grid(M + 1, across.length, (i, j) => t.v(sk, 0, 1, [i / M, across[j], side, k / K + F[3]], q));
      }
    }
  });
  // the shared crown the fronds rise from: a low fibrous mound
  const cr = lod === 0 ? 4 : 2, cs = lod === 0 ? 12 : 6;
  t.grid(cr + 1, cs + 1, (i, j) => t.v(i / cr, (j / cs) * Math.PI * 2, 2, null, [-1, 0, 0, 0]), true);
  return t.finish();
}

const VERT = /* glsl */ `
attribute vec4 aP;
attribute vec4 aQ;
float fTheta(float s, float lean, float coil) { return -lean + lean * 1.3 * s + coil * pow(s, ${PW.toFixed(2)}); }
vec2 fSpine(float s, float L, float lean, float coil) {
  vec2 c = vec2(0.0);
  float s0 = 0.0, t0 = fTheta(0.0, lean, coil);
  int spineN = int(uLodCfg.x + 0.5);
  for (int i = 1; i <= 16; i++) {
    if (i > spineN) break;
    float u = float(i) / float(spineN);
    float s1 = s * u * (1.5 - 0.5 * u);
    float t1 = fTheta(s1, lean, coil);
    float hd = 0.5 * (t1 - t0);
    float tm = t0 + hd;
    c += (s1 - s0) * L * sinc(hd) * vec2(sin(tm), cos(tm));
    s0 = s1; t0 = t1;
  }
  return c;
}

void main() {
  vec3 B = iPos.xyz;
  float S = iPos.w, seed = iPrm.x;
  float shrink = 1.0;
  float fade = lodFade(B, shrink);
  if (fade == 0.0) FLORA_CULL
  vFade = fade;
  float part = position.z;
  float fid = aQ.x, az = aQ.y + (fhash(seed * 11.0 + aQ.x) - 0.5) * 0.7;
  float lean = aP.w * mix(0.7, 1.3, fhash(seed * 5.7 + fid));
  // the slow coil / uncoil cycle; fronds linger fully coiled and fully open
  float per = mix(30.0, 50.0, fhash(seed * 91.7 + fid * 3.1));
  float cyc = 0.5 + 0.5 * sin(TAU * (uTime / per + seed + aQ.w));
  cyc = cyc * cyc * (3.0 - 2.0 * cyc);
  if (iPrm.w > 1.5) cyc = iPrm.w - 2.0;  // frozen pose (lab / heroes)
  float curl = mix(0.22, 1.0, cyc);
  curl = mix(curl, 1.06, iState);
  float L = 4.0 * aQ.z * mix(0.88, 1.12, fhash(seed * 13.1 + fid));
  float coil = curl * ${TH.toFixed(2)};
  float s = position.x;
  vec2 c2 = fSpine(s, L, lean, coil);
  float th = fTheta(s, lean, coil);
  // frond frame: local x toward the rosette centre (the coil rolls inward), z across
  vec3 ox = vec3(-cos(az), 0.0, -sin(az));
  vec3 oz = vec3(-sin(az), 0.0, cos(az));
  vec3 C = ox * c2.x + vec3(0.0, c2.y, 0.0) - ox * 0.08;
  vec3 T = ox * sin(th) + vec3(0.0, cos(th), 0.0);
  vec3 Nout = -ox * cos(th) + vec3(0.0, sin(th), 0.0);
  vec3 Bn = oz;
  // not perfectly planar: a slight helical drift
  float twist = (fhash(seed * 3.3 + fid) - 0.5) * 0.8;
  C += Bn * twist * s * s * L * 0.1;
  float coilAt = coil * pow(s, ${PW.toFixed(2)});
  float r0 = 0.1 * mix(0.88, 1.12, fhash(seed * 7.9 + fid)) * mix(0.8, 1.0, aQ.z);
  float rs = r0 * (1.0 - 0.62 * s);
  vec3 lp, ln;
  float ao = 1.0, trans = 0.22, across = 0.0;
  if (part > 1.5) {
    // crown mound
    float u = position.x, a = position.y;
    float rc = 0.3 * (1.0 + 0.14 * sin(a * 3.0 + seed * 20.0) + 0.08 * sin(a * 7.0 + seed * 9.0));
    float e = u * 1.5707963;
    lp = vec3(cos(a) * rc * cos(e), 0.34 * sin(e) - 0.06, sin(a) * rc * cos(e));
    ln = normalize(vec3(cos(a) * cos(e), sin(e) * 1.2, sin(a) * cos(e)));
    across = a / TAU;
    ao = mix(0.4, 0.7, u);
    s = 0.0;
    coilAt = 0.0;
  } else if (part < 0.5) {
    float a = position.y;
    // the rolled crozier is plump, knobbed by the leaflets furled inside it
    float knobs = smoothstep(3.0, 6.0, coilAt) * (0.5 + 0.5 * sin(s * L * 7.0 + a * 0.5));
    float r = rs * (1.0 + 0.3 * smoothstep(0.45, 0.8, s) * curl + 0.22 * knobs);
    r *= sqrt(max(1.0 - pow(max(s - 0.955, 0.0) / 0.045, 2.0), 0.0));
    float ga = a - 3.14159265;
    r *= 1.0 - 0.24 * exp(-ga * ga / 0.16);
    vec3 dir = cos(a) * Nout + sin(a) * Bn;
    lp = C + dir * r;
    ln = normalize(dir - T * 0.4 * smoothstep(0.92, 1.0, s));
    across = a / TAU;
    ao = mix(0.45, 1.0, smoothstep(0.0, 0.2, s)) * mix(0.75, 1.0, smoothstep(0.2, 1.3, abs(ga)));
    // inner turns of the coil are shaded by the outer ones
    ao *= mix(1.0, 0.7, smoothstep(5.0, 11.0, coilAt));
  } else {
    // a leaflet unrolling out of the crozier
    float u = aP.x, v = aP.y, side = aP.z;
    float kk = fract(aP.w);
    float spread = smoothstep(2.8, 0.9, coilAt);
    float len = 0.55 * (1.0 - 0.45 * s) * mix(0.45, 1.0, spread) * mix(0.85, 1.12, fhash(seed * 17.0 + kk * 7.0 + fid));
    vec3 sideDir = Bn * side;
    vec3 d0 = normalize(sideDir * 0.82 + T * 0.52 + Nout * 0.1);
    vec3 n0 = -Nout - d0 * dot(-Nout, d0);
    n0 = normalize(n0 + 1e-4);
    // spread leaflets arch gently, furled ones are rolled into tight scrolls
    float k = mix(15.0, -0.9, spread) / len;
    k += sin(uTime * 2.1 + kk * 19.0 + side * 2.0 + seed * 30.0 + fid) * 0.5 * spread / len;
    float phi = k * len * u;
    vec3 base = C + sideDir * rs * 0.7;
    vec3 pc = base + len * u * sinc(phi * 0.5) * (d0 * cos(phi * 0.5) + n0 * sin(phi * 0.5));
    vec3 wd = normalize(cross(d0, n0));
    vec3 nrm = n0 * cos(phi) - d0 * sin(phi);
    float w = 0.14 * len * pow(max(sin(3.14159 * pow(u, 0.62)), 0.0), 0.75) * (1.0 + 0.1 * sin(u * 22.0));
    lp = pc + wd * v * w + nrm * (1.0 - abs(v)) * w * 0.3;
    ln = nrm;
    across = v;
    trans = 0.85;
    ao = mix(0.6, 1.0, u) * mix(0.82, 1.0, spread);
  }
  float H = L * 0.75;
  vec3 rel = qrot(iQuat, lp * S * shrink);
  vec3 nw = qrot(iQuat, ln);
  float sub;
  vec2 bend = floraBend(B, 2.6, seed, sub);
  float f = pow(clamp(lp.y / H, 0.0, 1.3), 1.5);
  rel = applyBend(rel, bend, f);
  nw = applyBend(nw, bend, f);
  vec3 P = B + rel;
  vPos = P;
  vNrm = nw;
  vec3 col = mix(palCol(0), palCol(1), smoothstep(0.0, 0.45, s));
  col = mix(col, palCol(2), smoothstep(0.5, 0.99, s));
  if (part > 1.5) col = mix(palCol(3) * 0.6, palCol(0) * 0.8, 0.5);
  else if (part > 0.5) col = mix(palCol(1), palCol(2), 0.2 + 0.6 * aP.x);
  vCol = instTint(col);
  vAcc = instTint(palCol(3));
  vUv = vec4(s, across, part, coilAt);
  vMat = vec4(ao, trans, 0.0, 0.0);
  vW = vec3(0.0);
  vV = vec3(0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}
`;

const FRAG = /* glsl */ `
void main() {
  lodDither();
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vNrm);
  if (!gl_FrontFacing) N = -N;
  float s = vUv.x, part = vUv.z;
  vec3 alb = vCol;
  // painterly strokes along the form
  float br = noiseTex(vec2(vUv.y * 1.3 + part * 0.37, s * 3.5), 0);
  float br2 = noiseTex(vec2(vUv.y * 0.4 + 0.5, s * 9.0), 3);
  alb *= 0.84 + 0.26 * br + 0.1 * (br2 - 0.5);
  float thin = 0.0;
  float spec = 0.12;
  if (part < 0.5) {
    // fine ribs along the stem, a felt of amber hairs over the rolled crozier
    float rib = sin(vUv.y * TAU * 12.0 + br * 3.0);
    alb *= 1.0 - 0.07 * smoothstep(0.3, 1.0, rib);
    // the outer face of the rolled crozier wears a rust felt, the inner flesh stays pale
    float outer = 1.0 - smoothstep(0.12, 0.34, min(vUv.y, 1.0 - vUv.y));
    float sc = noiseTex(vec2(vUv.y * 3.0 + 0.11, s * 24.0), 1);
    float felt = smoothstep(1.4, 4.0, vUv.w) * smoothstep(0.25, 0.7, outer + (sc - 0.5) * 0.6 + br * 0.2);
    alb = mix(alb, vAcc * (0.75 + 0.45 * br) * (0.85 + 0.3 * sc), felt * 0.85);
    alb = mix(alb, alb * vec3(1.05, 1.08, 0.95), (1.0 - outer) * smoothstep(2.0, 5.0, vUv.w) * 0.5);
    spec *= 1.0 - felt;
  } else {
    // leaflet: pale midrib, darker margins
    float mid = exp(-vUv.y * vUv.y * 36.0);
    alb = mix(alb * mix(0.8, 1.0, 1.0 - abs(vUv.y)), alb * 1.22, mid * 0.6);
    thin = 1.0;
  }
  vec3 col = floraLight(alb, N, vPos, vMat.x, vMat.y, thin, 0.3, mix(0.12, 0.3, thin), spec, 0.45, vec3(0.0));
  col = applyFog(col, vPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

export default {
  name: 'fiddle',
  lod: [32, 165, 650],
  band: [5, 14, 50],
  spine: [12, 7],
  shadow: true,
  reacts: true,
  radius: 2.2,
  height: 3.6,
  imp: { kind: 0, w: 1.2, h: 3.4 },
  palettes: [
    ['#203a30', '#3f6e55', '#93b884', '#5e4630', '#7fffd4'], // jade
    ['#272240', '#4f4878', '#a99cc8', '#6e4c3c', '#c8a0ff'], // dusk violet
    ['#2c201b', '#5e4031', '#b98d6c', '#3a2519', '#ff9a50'], // ember
    ['#183e44', '#2e7a72', '#b8c98c', '#7c5e38', '#a0fff0'], // lagoon
  ],
  template,
  vert: VERT,
  frag: FRAG,
};

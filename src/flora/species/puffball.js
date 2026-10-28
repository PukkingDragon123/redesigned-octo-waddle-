// Spore puffballs: clusters of soft round fruiting bodies on short stalks, their skins scaled in
// phyllotaxis spirals (two families of log spirals around the vent, like a pine cone). They breathe
// slowly, and every so often one contracts sharply and puffs a cloud of spores from its vent
// (AlienFlora mirrors the same schedule on the CPU to emit the particles); a passing whale makes
// them all puff at once. At night the scales glow faintly.
import { Template } from '../geometry.js';

export const BALLS = [
  // offset x, z, radius, stalk height
  [0.0, 0.0, 0.32, 0.1],
  [0.36, 0.16, 0.22, 0.05],
  [-0.2, 0.3, 0.17, 0.04],
];
// puff schedule (seconds): period and phase per ball from the instance seed. Low-frequency linear
// hashes so the CPU (float64) and the shader (float32) agree on every puff.
const fract = (x) => x - Math.floor(x);
export function puffPeriod(seed, k) { return 22 + 30 * fract(seed * 7.13 + k * 0.37); }
export function puffPhase(seed, k) { return fract(seed * 3.71 + k * 0.59) * 60; }

function template(lod) {
  const t = new Template();
  const rings = lod === 0 ? 10 : 5, sides = lod === 0 ? 14 : 7;
  BALLS.forEach((b, k) => {
    const P = [b[0], b[1], b[2], b[3]];
    t.grid(rings + 1, sides + 1, (i, j) => t.v((i / rings) * Math.PI, (j / sides) * Math.PI * 2, 0, P, [k, 0, 0, 0]), true);
    const sr = lod === 0 ? 4 : 2;
    t.strip(sr, (i, v) => t.v(i / (sr - 1), v, 1, P, [k, 0, 0, 0]));
  });
  return t.finish();
}

const VERT = /* glsl */ `
attribute vec4 aP;
attribute vec4 aQ;
float puffPeriod(float seed, float k) { return 22.0 + 30.0 * fract(seed * 7.13 + k * 0.37); }
float puffPhase(float seed, float k) { return fract(seed * 3.71 + k * 0.59) * 60.0; }
void main() {
  vec3 B = iPos.xyz;
  float S = iPos.w, seed = iPrm.x;
  float shrink = 1.0;
  float fade = lodFade(B, shrink);
  if (fade == 0.0) FLORA_CULL
  vFade = fade;
  float part = position.z;
  float k = aQ.x;
  float R = aP.z * mix(0.85, 1.15, fhash(seed * 7.0 + k));
  float sh = aP.w;
  // time since this ball last puffed: a sharp contraction, then a slow re-inflation
  float per = puffPeriod(seed, k);
  float tau = mod(uTime + puffPhase(seed, k), per);
  float puff = smoothstep(0.0, 0.1, tau) * exp(-max(tau - 0.1, 0.0) / 1.1);
  puff = max(puff, iState);
  float breathe = sin(uTime * 0.7 + seed * 20.0 + k * 2.0);
  float scale = (1.0 + 0.03 * breathe) * (1.0 - 0.16 * puff);
  vec3 ctr = vec3(aP.x, sh + R * 0.82, aP.y);
  float sub;
  vec2 bend = floraBend(B, 6.0, seed, sub);
  vec3 P, N;
  vec3 col;
  float ao = 1.0;
  if (part < 0.5) {
    float psi = position.x, a = position.y;
    // the vent at the crown opens as it puffs
    float vent = smoothstep(2.75, 3.1416, psi);
    float rr = R * scale * (1.0 - vent * (0.22 + 0.25 * puff));
    vec3 dir = vec3(sin(psi) * cos(a), -cos(psi) * 0.86, sin(psi) * sin(a));
    // soft lobes so no two balls are perfect spheres
    rr *= 1.0 + 0.05 * sin(a * 3.0 + seed * 9.0 + k) * sin(psi);
    vec3 lp = ctr + dir * rr - vec3(0.0, vent * R * 0.1 * puff, 0.0);
    vec3 ln = normalize(vec3(dir.x, dir.y / 0.74, dir.z));
    vec3 rel = qrot(iQuat, lp * S * shrink);
    vec3 nw = qrot(iQuat, ln);
    float f = clamp(lp.y / 0.8, 0.0, 1.0);
    rel = applyBend(rel, bend, f);
    nw = applyBend(nw, bend, f);
    P = B + rel;
    N = nw;
    col = mix(palCol(0), palCol(1), smoothstep(0.3, 1.6, psi));
    col = mix(col, palCol(2), smoothstep(1.8, 3.0, psi));
    ao = mix(0.45, 1.0, smoothstep(0.2, 1.4, psi)) * mix(1.0, 0.6, vent);
    vUv = vec4(psi, a, 0.0, k);
    vW = vec3(0.0); vV = vec3(0.0);
  } else {
    float s = position.x;
    vec3 C = vec3(aP.x, (sh + R * 0.3) * s, aP.y);
    vec3 Cw = B + qrot(iQuat, C * S * shrink);
    vec3 Tw = qrot(iQuat, vec3(0.0, 1.0, 0.0));
    vec3 W, Vp;
    stripFrame(Cw, Tw, W, Vp);
    float hw = stripHalfWidth(Cw, R * 0.34 * S * shrink * (1.0 - 0.25 * s));
    P = Cw + W * position.y * hw;
    N = W * position.y;
    vW = W; vV = Vp;
    vUv = vec4(s, position.y, 1.0, k);
    col = palCol(0) * 0.9;
    ao = mix(0.5, 0.8, s);
  }
  vPos = P;
  vNrm = N;
  vCol = instTint(col);
  vAcc = instTint(palCol(3));
  vMat = vec4(ao, 0.35, uNight * (0.6 + 0.4 * sin(uTime * 0.5 + seed * 9.0 + k)), puff);
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
  vec3 alb = vCol;
  vec3 N;
  vec3 emi = vec3(0.0);
  float spec = 0.05;
  if (vUv.z < 0.5) {
    N = normalize(vNrm);
    if (!gl_FrontFacing) N = -N;
    // phyllotaxis scales: two families of log spirals (8 and 13) around the vent
    float psiT = 3.14159265 - vUv.x;
    float rho = tan(clamp(psiT * 0.5, 0.0, 1.5));
    float lu = log(max(rho, 1e-3));
    float a = vUv.y;
    float ph1 = 8.0 * a + 9.0 * lu + vUv.w * 2.0;
    float ph2 = 13.0 * a - 9.5 * lu + vUv.w * 3.0;
    float d1 = abs(sin(ph1 * 0.5)), d2 = abs(sin(ph2 * 0.5));
    float pw = fwidth(ph1) + fwidth(ph2);
    float detail = (1.0 - smoothstep(0.8, 2.5, pw)) * smoothstep(0.0, 0.6, vUv.x) * (1.0 - smoothstep(2.3, 2.9, psiT));
    // overlapping scales: a fine soft seam, each scale lighter toward its upper tip
    float seam = 1.0 - smoothstep(0.0, 0.12 + pw * 0.2, min(d1, d2));
    float plate = smoothstep(0.15, 1.0, d1 * d2);
    float tipL = 0.5 + 0.5 * sin(ph1 * 0.5 + ph2 * 0.5);
    alb = mix(alb, alb * 0.72 + vAcc * 0.12, seam * 0.45 * detail);
    alb = mix(alb, alb * (1.0 + 0.22 * tipL), plate * detail * 0.7);
    // speckled warts and an earthy foot
    float wart = smoothstep(0.78, 0.92, noiseTex(vec2(a * 1.3, vUv.x * 2.1) + vUv.w * 0.29, 1));
    alb = mix(alb, vAcc * 0.8, wart * 0.3 * detail);
    alb = mix(alb * vec3(0.7, 0.72, 0.6), alb, smoothstep(0.2, 1.1, vUv.x));
    alb *= 0.9 + 0.18 * noiseTex(vec2(a * 0.6, vUv.x * 0.7) + vUv.w * 0.37, 0);
    float sc = plate * detail;
    spec = 0.05 + 0.08 * sc;
    emi = vAcc * vMat.z * 0.22 * seam * detail;
    // the open vent darkens
    alb *= 1.0 - 0.5 * smoothstep(2.85, 3.1, vUv.x) * (0.4 + vMat.w);
  } else {
    N = stripNormal(vUv.y);
  }
  vec3 col = floraLight(alb, N, vPos, vMat.x, vMat.y, 0.0, 0.36, 0.3, spec, 0.6, emi);
  col = applyFog(col, vPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

export default {
  name: 'puffball',
  lod: [26, 75, 260],
  band: [4, 10, 30],
  shadow: true,
  reacts: true,
  closeRate: 14,
  reopen: 2.5,
  radius: 0.8,
  height: 0.8,
  imp: { kind: 6, w: 0.6, h: 0.75, stiff: 6, c0: 1, c1: 2 },
  palettes: [
    ['#4e4838', '#9a9076', '#d4cab0', '#6a4a2c', '#e0ffa0'], // ivory with umber seams
    ['#4a4458', '#8a809e', '#c8c0d8', '#4a2a60', '#d0a0ff'], // lilac grey
    ['#5a4c1c', '#a8923a', '#dcca7a', '#4a300c', '#ffe060'], // sulfur
    ['#5a4038', '#aa8072', '#e0c0b2', '#7a3424', '#ffc0a0'], // peach
  ],
  template,
  vert: VERT,
  frag: FRAG,
};

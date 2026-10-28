// Bell plants: arching stalks hung with translucent lantern bells. The stalks sway, each bell swings
// on its pedicel like a pendulum lagging the wind, and the bells breathe (their mouths swelling
// open and closed). Startled, the stalks curl tighter and the bells pinch shut. At night the
// inside of each bell glows faintly, like a paper lantern.
import { Template } from '../geometry.js';

const STALKS = [
  // azimuth, initial angle, total turn, length
  [0.4, 0.1, 2.5, 1.6],
  [2.5, 0.22, 2.3, 1.3],
  [4.5, 0.16, 2.7, 1.1],
];
const BELLS = [0.58, 0.76, 0.92];

function template(lod) {
  const t = new Template();
  const sr = lod === 0 ? 14 : 6;
  const br = lod === 0 ? 6 : 3, bs = lod === 0 ? 9 : 6;
  STALKS.forEach((st, k) => {
    const P = [st[0], st[1], st[2], st[3]];
    t.strip(sr, (i, v) => t.v(i / (sr - 1), v, 0, P, [k, 0, 0, 0]));
    BELLS.forEach((sa, b) => {
      const size = 0.75 + 0.35 * b + 0.1 * Math.sin(k * 3 + b);
      t.grid(br + 1, bs + 1, (i, j) => t.v(i / br, (j / bs) * Math.PI * 2, 1, P, [k, b, sa, size]));
    });
  });
  return t.finish();
}

const VERT = /* glsl */ `
attribute vec4 aP;
attribute vec4 aQ;
// bell profile: radius (in bell radii) along y 0 (pedicel) .. 1 (mouth)
float bellR(float y, float open) {
  float r = 0.06 + 0.94 * sin(1.5707963 * pow(clamp(y, 0.0, 1.0), 0.55));
  r *= 1.0 + 0.32 * smoothstep(0.72, 1.0, y) * open;
  return r;
}
void main() {
  vec3 B = iPos.xyz;
  float S = iPos.w, seed = iPrm.x;
  float shrink = 1.0;
  float fade = lodFade(B, shrink);
  if (fade == 0.0) FLORA_CULL
  vFade = fade;
  float part = position.z;
  float st = iState;
  if (iPrm.w > 1.5) st = iPrm.w - 2.0;
  float phi = aP.x + (fhash(seed * 3.0 + aQ.x) - 0.5) * 0.8;
  float alpha = aP.y;
  float turn = aP.z * mix(0.9, 1.1, fhash(seed * 9.0 + aQ.x)) * (1.0 + 0.35 * st);
  float L = aP.w * mix(0.85, 1.15, fhash(seed * 5.0 + aQ.x * 2.0));
  float sway = sin(uTime * 0.9 + seed * 20.0 + aQ.x * 2.0) * 0.07;
  vec3 outD = vec3(cos(phi), 0.0, sin(phi));
  float sub;
  vec2 bend = floraBend(B, 2.0, seed, sub);
  vec3 P, N;
  vec3 col;
  float ao = 1.0, trans = 0.6;
  float glow = 0.0;
  // stalk centreline at s: rises, then arches over (curvature grows along the stalk)
  float s = part < 0.5 ? position.x : aQ.z;
  vec2 c2 = vec2(0.0);
  float s0 = 0.0, t0 = alpha;
  for (int i = 1; i <= 8; i++) {
    float u = float(i) / 8.0;
    float s1 = s * u;
    float t1 = alpha + (turn + sway) * pow(s1, 1.9);
    float hd = 0.5 * (t1 - t0);
    float tm = t0 + hd;
    c2 += (s1 - s0) * L * sinc(hd) * vec2(sin(tm), cos(tm));
    s0 = s1; t0 = t1;
  }
  vec3 C = outD * c2.x + vec3(0.0, c2.y, 0.0);
  vec3 T = outD * sin(t0) + vec3(0.0, cos(t0), 0.0);
  vec3 Cw = qrot(iQuat, C * S * shrink);
  vec3 Tw = qrot(iQuat, T);
  float f = clamp(C.y / 1.2, 0.0, 1.2);
  Cw = applyBend(Cw, bend, f);
  Tw = applyBend(Tw, bend, f);
  Cw += B;
  if (part < 0.5) {
    vec3 W, Vp;
    stripFrame(Cw, Tw, W, Vp);
    float v = position.y;
    float hw = 0.026 * S * shrink * (1.0 - 0.5 * s);
    hw = stripHalfWidth(Cw, hw);
    P = Cw + W * v * hw;
    N = W * v;
    vW = W; vV = Vp;
    col = mix(palCol(0) * 1.5, mix(palCol(0), palCol(1), 0.6) * 1.2, s);
    ao = mix(0.5, 1.0, smoothstep(0.0, 0.3, s));
    vUv = vec4(s, v, 0.0, 0.0);
    trans = 0.6;
  } else {
    // a lantern bell hanging from the stalk, swinging behind the wind
    float y = position.x, a = position.y;
    float size = aQ.w;
    float bph = seed * 30.0 + aQ.x * 7.0 + aQ.y * 3.0;
    float breathe = 0.5 + 0.5 * sin(uTime * 1.1 + bph);
    float open = mix(0.55, 1.0, breathe) * (1.0 - 0.75 * st);
    float Hb = 0.24 * size * S * shrink;
    float Rb = 0.12 * size * S * shrink * (1.0 + 0.05 * breathe);
    vec3 windH = vec3(bend.x, 0.0, bend.y);
    vec3 hang = normalize(vec3(0.0, -1.0, 0.0) + windH * 0.9
      + vec3(sin(uTime * 1.3 + bph), 0.0, cos(uTime * 1.1 + bph * 1.3)) * 0.12);
    vec3 e1 = normalize(cross(hang, vec3(0.31, 0.0, 0.95)));
    vec3 e2 = cross(hang, e1);
    float r = bellR(y, open);
    // scalloped mouth
    r *= 1.0 + 0.09 * cos(a * 5.0) * smoothstep(0.75, 1.0, y);
    float dr = (bellR(y + 0.02, open) - bellR(y - 0.02, open)) / 0.04;
    vec3 radial = cos(a) * e1 + sin(a) * e2;
    P = Cw + hang * (y * Hb + 0.012 * S) + radial * r * Rb;
    // the mouth rim curls outward a little
    P += hang * smoothstep(0.85, 1.0, y) * 0.01 * S;
    N = normalize(radial * Hb - hang * dr * Rb);
    col = mix(palCol(1), palCol(2), smoothstep(0.1, 1.0, y));
    ao = mix(0.6, 1.0, smoothstep(0.0, 0.4, y));
    vUv = vec4(a / TAU, y, 1.0, size);
    vW = vec3(0.0); vV = vec3(0.0);
    trans = 0.85;
    glow = uNight * (0.6 + 0.4 * sin(uTime * 0.6 + bph));
  }
  vPos = P;
  vNrm = N;
  vCol = instTint(col);
  vAcc = palCol(4);
  vMat = vec4(ao, trans, glow, palCol(3).r);
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
  float part = vUv.z;
  vec3 alb = vCol;
  vec3 N;
  float thin = 0.0, spec = 0.08;
  vec3 emi = vec3(0.0);
  if (part < 0.5) {
    N = stripNormal(vUv.y);
  } else {
    N = normalize(vNrm);
    bool inside = !gl_FrontFacing;
    if (inside) N = -N;
    float y = vUv.y;
    // fine veins running down the petals, lighter between them
    float vein = smoothstep(0.75, 1.0, sin(vUv.x * TAU * 10.0 + y * 1.5));
    alb *= 1.0 - 0.18 * vein;
    alb *= 0.88 + 0.22 * noiseTex(vec2(vUv.x * 2.0 + vUv.w, y * 0.8), 0);
    if (inside) {
      // inner throat: a deeper, warmer tone and the lantern glow
      alb = mix(alb * 0.55, alb * vec3(1.2, 0.7, 0.9), 0.4);
      emi = vAcc * vMat.z * 0.45 * smoothstep(0.2, 0.9, y);
    } else {
      emi = vAcc * vMat.z * 0.12 * smoothstep(0.5, 1.0, y);
    }
    thin = 1.0;
    spec = 0.1;
  }
  vec3 col = floraLight(alb, N, vPos, vMat.x, vMat.y, thin, 0.34, 0.3, spec, 0.6, emi);
  col = applyFog(col, vPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

export default {
  name: 'bells',
  lod: [26, 110, 380],
  band: [4, 12, 40],
  shadow: true,
  reacts: true,
  closeRate: 5,
  reopen: 6,
  radius: 1.4,
  height: 1.6,
  imp: { kind: 2, w: 1.0, h: 1.4, stiff: 2, c0: 1, c1: 2 },
  palettes: [
    ['#3e4a30', '#6a5690', '#d8c4e4', '#4a1a50', '#d4a0ff'], // lilac lanterns
    ['#3e4c30', '#c07e50', '#f6d4ac', '#5a2a1a', '#ffc080'], // apricot lanterns
    ['#36423e', '#5e7ebc', '#cde2f8', '#1a2a5a', '#a0d0ff'], // moon bells
    ['#3e4a32', '#9c5a70', '#ecc8d4', '#5a1a34', '#ffa0c8'], // rose lanterns
  ],
  template,
  vert: VERT,
  frag: FRAG,
};

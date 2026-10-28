// Anemone frond clusters: a squat fleshy column crowned with fronds in a phyllotaxis spiral, each
// frond a tapered tentacle ending in a pale bulb. They sway and writhe slowly, breathe open and
// closed, and when a whale passes they recoil (fronds curl inward over the disc and the column
// squats), the recoil travelling through the colony one plant after another, then reopen slowly.
// Fronds are camera-facing strips shaded as round tubes; bulbs are sphere-shaded sprites.
import { Template } from '../geometry.js';

const F = 44;
const GOLDEN = 2.399963;

function template(lod) {
  const t = new Template();
  // column (part 0): u 0..1 along the profile, angle around
  const rings = lod === 0 ? 7 : 3, sides = lod === 0 ? 14 : 7;
  t.grid(rings + 1, sides + 1, (i, j) => t.v(i / rings, (j / sides) * Math.PI * 2, 0), true);
  // fronds (part 1) and their bulbs (part 2)
  const fr = lod === 0 ? 9 : 5;
  for (let k = 0; k < F; k++) {
    const rk = Math.sqrt((k + 0.5) / F);
    const phi = k * GOLDEN;
    const eps = 0.08 + 1.12 * rk;
    const len = (0.36 + 0.24 * rk) * (0.9 + 0.2 * Math.abs(Math.sin(k * 12.9898) * 43758.5453 % 1));
    const P = [rk, phi, eps, len];
    const Q = [(k * 0.618034) % 1, 0, 0, 0];
    t.strip(fr, (i, v) => t.v(i / (fr - 1), v, 1, P, Q));
    t.grid(2, 2, (i, j) => t.v(j * 2 - 1, i * 2 - 1, 2, P, Q));
  }
  return t.finish();
}

const VERT = /* glsl */ `
attribute vec4 aP;
attribute vec4 aQ;
void main() {
  vec3 B = iPos.xyz;
  float S = iPos.w, seed = iPrm.x;
  float shrink = 1.0;
  float fade = lodFade(B, shrink);
  if (fade == 0.0) FLORA_CULL
  vFade = fade;
  float part = position.z;
  // closedness: a slow breath plus the startle recoil
  float breath = 0.5 + 0.5 * sin(uTime * (0.26 + 0.08 * fhash(seed * 3.7)) + seed * 40.0);
  float c = clamp(max(iState * 1.05, breath * 0.14), 0.0, 1.0);
  if (iPrm.w > 1.5) c = iPrm.w - 2.0;
  float cs = c * c * (3.0 - 2.0 * c);
  float Rt = 0.36, Hm = 0.3 * mix(1.0, 0.72, cs);
  float sub;
  vec2 bend = floraBend(B, 3.0, seed, sub);
  vec3 upW = qrot(iQuat, vec3(0.0, 1.0, 0.0));
  float ao = 1.0, trans = 0.5;
  vec3 col;
  vec3 P, N;
  vMat = vec4(1.0, 0.5, 0.0, 0.0);
  if (part < 0.5) {
    // the column: a squat waisted cylinder with a slightly concave oral disc
    float u = position.x, a = position.y;
    float r, y; vec2 n2;
    if (u < 0.72) {
      float t = u / 0.72;
      r = mix(0.3, Rt, t) * (1.0 + 0.08 * sin(t * 3.14159) - 0.06 * sin(t * 6.283));
      y = Hm * t;
      n2 = normalize(vec2(1.0, -0.15));
    } else {
      float t = (u - 0.72) / 0.28;
      r = Rt * (1.0 - t) + 0.02 * (1.0 - t) * sin(t * 9.0);
      y = Hm - 0.035 * sin(t * 3.14159) * (1.0 - t * 0.3) + 0.01 * t;
      n2 = normalize(vec2(0.35 * (1.0 - t), 1.0));
    }
    r *= 1.0 + 0.05 * sin(a * 5.0 + seed * 30.0) * (1.0 - cs * 0.5);
    r *= mix(1.0, 1.08, cs);
    vec3 lp = vec3(cos(a) * r, y, sin(a) * r);
    vec3 ln = vec3(cos(a) * n2.x, n2.y, sin(a) * n2.x);
    vec3 rel = qrot(iQuat, lp * S * shrink);
    rel = applyBend(rel, bend, 0.15 * y / 0.3);
    P = B + rel;
    N = qrot(iQuat, ln);
    col = mix(palCol(0) * 0.8, palCol(0) * 1.25, smoothstep(0.0, 0.7, u));
    col = mix(col, palCol(1) * 0.7, smoothstep(0.75, 1.0, u));
    ao = mix(0.45, 1.0, smoothstep(0.0, 0.6, u)) * mix(1.0, 0.75, smoothstep(0.8, 1.0, u));
    vUv = vec4(u, a / TAU, 0.0, 0.0);
    vW = vec3(0.0); vV = vec3(0.0);
    trans = 0.15;
  } else {
    float rk = aP.x, phi = aP.y, eps0 = aP.z, len0 = aP.w;
    float fs = aQ.x;
    vec3 outD = vec3(cos(phi), 0.0, sin(phi));
    vec3 Bn = vec3(-sin(phi), 0.0, cos(phi));
    vec3 b = outD * rk * Rt * mix(0.92, 0.7, cs) + vec3(0.0, Hm - 0.03 * rk * rk, 0.0);
    // open: fronds splay and droop outward; closed: they curl in over the disc and shorten
    float eps = mix(eps0, eps0 * 0.25 - 0.1, cs);
    float L = len0 * mix(1.0, 0.62, cs);
    float wr = sin(uTime * (0.8 + 0.5 * fs) + phi * 3.0 + seed * 20.0);
    float kap = (mix(2.3, -5.0, cs) + wr * mix(0.8, 0.15, cs)) / L;
    float s = part < 1.5 ? position.x : 1.0;
    float d = kap * L * s;
    float th = eps + d;
    vec2 ch = L * s * sinc(d * 0.5) * vec2(sin(eps + d * 0.5), cos(eps + d * 0.5));
    vec3 C = b + outD * ch.x + vec3(0.0, ch.y, 0.0);
    vec3 T = outD * sin(th) + vec3(0.0, cos(th), 0.0);
    // a slow sideways sway travelling up the frond
    C += Bn * sin(uTime * 1.25 + phi * 2.0 + seed * 9.0 - s * 3.2) * 0.1 * s * s * L * (1.0 - cs * 0.7);
    vec3 Cw = qrot(iQuat, C * S * shrink);
    vec3 Tw = qrot(iQuat, T);
    float f = clamp(C.y / 0.75, 0.0, 1.2);
    Cw = applyBend(Cw, bend, f * f);
    Tw = applyBend(Tw, bend, f * f);
    Cw += B;
    vec3 W, Vp;
    stripFrame(Cw, Tw, W, Vp);
    float tipR = 0.042 * S * mix(0.85, 1.15, fs) * shrink;
    if (part < 1.5) {
      float v = position.y;
      float hw = 0.034 * S * shrink * (1.0 - 0.45 * s) * mix(0.85, 1.15, fs);
      hw = stripHalfWidth(Cw, hw);
      P = Cw + W * v * hw;
      N = W * v;
      vUv = vec4(s, v, 1.0, fs);
      col = mix(palCol(1), palCol(2), pow(s, 0.8));
      ao = mix(0.55, 1.0, smoothstep(0.0, 0.5, s)) * mix(0.75, 1.0, rk);
      vMat.w = 0.0;
    } else {
      // bulb tip: a sphere-shaded sprite facing the camera
      vec3 tc = toCamDir(Cw);
      vec3 R = normalize(cross(vec3(0.0, 1.0, 0.0), tc) + 1e-4);
      vec3 U = cross(tc, R);
      vec3 ctr = Cw + Tw * tipR * 0.55;
      float rr = max(tipR, pixelWorld(ctr) * 0.8);
      P = ctr + (R * position.x + U * position.y) * rr;
      N = tc;
      W = R; Vp = U;
      vUv = vec4(position.x, position.y, 2.0, fs);
      col = palCol(3);
      ao = 1.0;
      // night: the bulbs glow faintly, like bioluminescent tips
      vMat.z = uNight * (0.55 + 0.45 * sin(uTime * 0.7 + fs * 12.0 + seed * 7.0));
    }
    vW = W; vV = Vp;
    trans = 0.65;
  }
  vPos = P;
  vNrm = N;
  vCol = instTint(col);
  vAcc = palCol(4);
  vMat.x = ao;
  vMat.y = trans;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}
`;

const FRAG = /* glsl */ `
void main() {
  lodDither();
  float part = vUv.z;
  float alpha = 1.0;
  vec3 N;
  if (part > 1.5) {
    float r2 = dot(vUv.xy, vUv.xy);
    alpha = clamp((1.0 - r2) / max(fwidth(r2), 1e-3), 0.0, 1.0);
    if (r2 > 1.0) discard;
    vec3 tc = normalize(cameraPosition - vPos);
    N = normalize(vW * vUv.x + vV * vUv.y + tc * sqrt(max(1.0 - r2, 0.0)));
  }
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 alb = vCol;
  float thin = 0.0;
  if (part < 0.5) {
    N = normalize(vNrm);
    if (!gl_FrontFacing) N = -N;
    // vertical stripes and blotches on the column, a darker mouth on the disc
    float a = vUv.y * TAU;
    float stripe = 0.5 + 0.5 * sin(a * 9.0 + noiseTex(vUv.xy * vec2(1.0, 0.5), 0) * 4.0);
    alb *= 0.85 + 0.25 * stripe * smoothstep(0.75, 0.3, vUv.x);
    float mouth = smoothstep(0.93, 0.99, vUv.x);
    alb = mix(alb, alb * 0.45, mouth);
  } else if (part < 1.5) {
    N = stripNormal(vUv.y);
    // faint rings along the tentacle and a paler line on its crest
    float ring = smoothstep(0.55, 1.0, sin(vUv.x * 46.0 + vUv.w * 6.0));
    alb *= 1.0 - 0.07 * ring;
    alb *= 0.9 + 0.2 * noiseTex(vec2(vUv.w * 3.1, vUv.x * 2.0), 0);
    thin = 1.0;
  } else {
    alb *= 0.92 + 0.12 * vUv.y;
    thin = 1.0;
  }
  vec3 emi = vAcc * vMat.z * 0.32 * smoothstep(0.0, 1.0, part - 1.0);
  // wet sheen: a small sharp highlight, not a broad band
  float spec = part < 0.5 ? 0.06 : 0.1;
  vec3 col = floraLight(alb, N, vPos, vMat.x, vMat.y, thin, 0.32, 0.18, spec, 0.9, emi);
  col = applyFog(col, vPos);
  gl_FragColor = vec4(col, alpha);
}
`;

export default {
  name: 'anemone',
  lod: [26, 75, 260],
  band: [4, 10, 30],
  shadow: true,
  reacts: true,
  alpha: true,
  closeRate: 9,
  reopen: 5.5,
  radius: 0.9,
  height: 0.9,
  imp: { kind: 3, w: 0.75, h: 0.85, stiff: 3, c0: 1, c1: 3 },
  palettes: [
    ['#5a2f52', '#7a4478', '#d88c90', '#ffe3cf', '#ffb0e0'], // rose
    ['#264a4a', '#347a76', '#8acbb4', '#eefce8', '#a0fff0'], // sea glass
    ['#56402a', '#86603a', '#d8a860', '#fff0c0', '#ffd080'], // amber
    ['#4a2452', '#86347e', '#e07ab8', '#ffd8f0', '#ff90e0'], // reef magenta
  ],
  template,
  vert: VERT,
  frag: FRAG,
};

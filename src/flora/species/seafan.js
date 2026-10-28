// Glassy sea fans: two or three curved, lace-like fans on a short trunk, in the tidal band and on
// the reef. Each fan is a gently cupped sheet whose reticulated lattice (a Voronoi mesh threaded
// by radial main veins) is painted in the fragment shader and cut out with alpha-to-coverage, so it
// stays smooth at any distance (fading to a frosted membrane where the mesh is finer than a
// pixel). Glass-like: a fresnel sheen of the sky, a thin-film shimmer at grazing angles and light
// passing through. They rock slowly with the swell, stiffly with the wind.
import { Template } from '../geometry.js';

const FANS = [
  // azimuth, tilt, size, span
  [0.0, 0.05, 1.0, 1.05],
  [1.1, -0.18, 0.78, 0.95],
  [-1.25, 0.22, 0.66, 0.9],
];

function template(lod) {
  const t = new Template();
  const rows = lod === 0 ? 7 : 3, cols = lod === 0 ? 11 : 5;
  FANS.forEach((f, k) => {
    const P = [f[0], f[1], f[2], f[3]];
    t.grid(rows + 1, cols + 1, (i, j) => t.v(i / rows, (j / cols) * 2 - 1, 0, P, [k, 0, 0, 0]), true);
  });
  // trunk
  const tr = lod === 0 ? 5 : 3;
  t.strip(tr, (i, v) => t.v(i / (tr - 1), v, 1, [0, 0, 0, 0], [-1, 0, 0, 0]));
  return t.finish();
}

const VERT = /* glsl */ `
attribute vec4 aP;
attribute vec4 aQ;
vec3 fanPoint(float r, float g, float R, float span, float cup, float seed, vec3 L, vec3 U, vec3 Nk) {
  float ang = g * span;
  vec3 p = R * r * (sin(ang) * L + cos(ang) * U);
  // cupped toward the current, with a soft wave along the rim
  p += Nk * R * (cup * r * r * (1.0 - 0.35 * g * g) + 0.035 * sin(g * 4.0 + r * 3.0 + seed * 9.0) * r);
  return p;
}
void main() {
  vec3 B = iPos.xyz;
  float S = iPos.w, seed = iPrm.x;
  float shrink = 1.0;
  float fade = lodFade(B, shrink);
  if (fade == 0.0) FLORA_CULL
  vFade = fade;
  float part = position.z;
  float sub;
  vec2 bend = floraBend(B, 5.0, seed, sub);
  float h0 = 0.14;
  vec3 P, N;
  vec3 col;
  if (part < 0.5) {
    float k = aQ.x;
    float phi = aP.x + (fhash(seed * 7.0 + k) - 0.5) * 0.5;
    float tilt = aP.y + (fhash(seed * 3.0 + k) - 0.5) * 0.2;
    float R = 1.15 * aP.z * mix(0.85, 1.15, fhash(seed * 11.0 + k));
    float span = aP.w;
    float cup = mix(0.1, 0.24, fhash(seed * 13.0 + k));
    vec3 L = vec3(cos(phi), 0.0, sin(phi));
    vec3 Nk = vec3(-sin(phi), 0.0, cos(phi));
    // the fan rocks slowly about its foot
    float rock = sin(uTime * (0.55 + 0.2 * fhash(k + seed)) + seed * 20.0 + k * 1.7) * mix(0.03, 0.1, sub);
    vec3 U = normalize(vec3(0.0, cos(tilt + rock), 0.0) + Nk * sin(tilt + rock));
    Nk = normalize(cross(L, U));
    float r = position.x, g = position.y;
    vec3 p = fanPoint(r, g, R, span, cup, seed, L, U, Nk);
    vec3 pr = fanPoint(r + 0.02, g, R, span, cup, seed, L, U, Nk);
    vec3 pg = fanPoint(r, g + 0.02, R, span, cup, seed, L, U, Nk);
    vec3 ln = normalize(cross(pr - p, pg - p) + Nk * 1e-3);
    if (r < 0.02) ln = Nk;
    vec3 lp = vec3(0.0, h0, 0.0) + p;
    vec3 rel = qrot(iQuat, lp * S * shrink);
    vec3 nw = qrot(iQuat, ln);
    float f = clamp(lp.y / 1.2, 0.0, 1.2);
    rel = applyBend(rel, bend, f);
    nw = applyBend(nw, bend, f);
    P = B + rel;
    N = nw;
    // fan coordinates in metres (lattice) and the rim distance
    float ang = g * span;
    vUv = vec4(R * r * sin(ang) * 1.0, R * r * cos(ang), r, g);
    col = mix(palCol(0), palCol(1), smoothstep(0.0, 0.5, r));
    col = mix(col, palCol(2), smoothstep(0.55, 1.0, r));
    vMat = vec4(mix(0.6, 1.0, r), 0.9, 0.0, k + 1.0);
    vW = vec3(0.0); vV = vec3(0.0);
  } else {
    float s = position.x;
    vec3 C = vec3(0.0, s * h0 * 1.15, 0.0);
    vec3 Cw = B + qrot(iQuat, C * S * shrink);
    vec3 Tw = qrot(iQuat, vec3(0.0, 1.0, 0.0));
    vec3 W, Vp;
    stripFrame(Cw, Tw, W, Vp);
    float hw = stripHalfWidth(Cw, 0.035 * S * shrink * (1.0 - 0.3 * s));
    P = Cw + W * position.y * hw;
    N = W * position.y;
    vW = W; vV = Vp;
    vUv = vec4(s, position.y, -1.0, 0.0);
    col = palCol(0) * 0.8;
    vMat = vec4(0.6, 0.3, 0.0, 0.0);
  }
  vPos = P;
  vNrm = N;
  vCol = instTint(col);
  vAcc = palCol(3);
  vMat.z = uNight;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}
`;

const FRAG = /* glsl */ `
// Voronoi edge distance (F2 - F1) and the nearest cell id
vec2 fanCells(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash22(i + g) * 0.75 + 0.125;
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash12(i + g); }
    else if (d < d2) d2 = d;
  }
  return vec2(sqrt(d2) - sqrt(d1), id);
}
void main() {
  lodDither();
  float alpha = 1.0;
  vec3 alb = vCol;
  float vein = 1.0;
  if (vUv.z >= 0.0) {
    vec2 q = vUv.xy;
    float r = vUv.z, g = vUv.w;
    // irregular rounded rim
    float rim = 1.0 - 0.07 * sin(g * 9.0 + vMat.w * 3.0) - 0.05 * sin(g * 23.0 + vMat.w) - 0.22 * smoothstep(0.75, 1.0, abs(g));
    float edgeAA = fwidth(r) * 1.5 + 1e-4;
    float shape = smoothstep(rim, rim - edgeAA, r);
    // lattice: a Voronoi mesh whose cells grow toward the rim, threaded by radial main veins
    float cs = 24.0 / (1.0 + r * 0.7);
    vec2 cc = fanCells(q * cs + vMat.w * 17.0);
    float pw = fwidth(cc.x) + 1e-4;
    float th = 0.07 + 0.07 * (1.0 - r);
    float mesh = 1.0 - smoothstep(th - pw, th + pw, cc.x);
    float rad = abs(sin(g * 6.5 + sin(r * 5.0 + vMat.w) * 0.6));
    float rw = fwidth(rad) + 1e-4;
    float rth = 0.13 * (1.15 - r);
    float radial = 1.0 - smoothstep(rth - rw, rth + rw, rad);
    vein = max(mesh, radial * smoothstep(0.95, 0.4, r));
    // where the mesh is finer than a pixel it reads as a frosted membrane
    float fine = smoothstep(0.25, 0.6, pw);
    vein = mix(vein, 0.55, fine);
    float membrane = 0.1;
    alpha = shape * max(vein, membrane);
    alb = mix(alb * 0.85, alb * 1.2, vein);
    alb *= 0.9 + 0.2 * cc.y;
  }
  #ifdef DEPTH_PASS
    if (alpha < 0.5) discard;
    gl_FragColor = vec4(1.0);
    return;
  #endif
  if (alpha < 0.01) discard;
  vec3 N;
  float thin = 1.0;
  if (vUv.z < 0.0) { N = stripNormal(vUv.y); thin = 0.0; alpha = 1.0; }
  else {
    N = normalize(vNrm);
    if (!gl_FrontFacing) N = -N;
  }
  vec3 V = normalize(uCamPos - vPos);
  float ndv = max(dot(N, V), 0.0);
  // thin-film shimmer at grazing angles
  vec3 film = 0.5 + 0.5 * cos(TAU * (ndv * 1.3 + vec3(0.0, 0.33, 0.67)));
  alb = mix(alb, alb * film * 1.6, 0.18 * (1.0 - ndv));
  vec3 col = floraLight(alb, N, vPos, vMat.x, vMat.y, thin, 0.4, 0.6, 0.55, 0.9, vec3(0.0));
  // glass: a fresnel reflection of the sky
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, clamp(R.y, 0.0, 1.0)) * (1.0 - uNight * 0.7);
  float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  col += sky * F * 0.6 * vein;
  // night: the vein tips hold a faint cold light
  col += vAcc * vMat.z * 0.18 * vein * smoothstep(0.55, 1.0, vUv.z);
  col = applyFog(col, vPos);
  gl_FragColor = vec4(col, alpha);
}
`;

export default {
  name: 'seafan',
  lod: [32, 95, 320],
  band: [4, 12, 30],
  shadow: true,
  reacts: false,
  alpha: true,
  radius: 1.2,
  height: 1.4,
  imp: { kind: 5, w: 1.0, h: 1.3, stiff: 5, c0: 1, c1: 2 },
  palettes: [
    ['#2c6a72', '#52a8b2', '#9cd8de', '#a0f0ff', '#a0f0ff'], // sea glass
    ['#7a4864', '#c88aac', '#f2d0e2', '#ffc0e0', '#ffc0e0'], // rose quartz
    ['#4a4a86', '#8e86d4', '#d8d2f6', '#c0b0ff', '#c0b0ff'], // amethyst
    ['#7a6a34', '#ccb478', '#f2e6c4', '#ffe8a0', '#ffe8a0'], // citrine
  ],
  template,
  vert: VERT,
  frag: FRAG,
};

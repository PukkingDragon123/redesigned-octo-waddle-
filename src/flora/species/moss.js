// Moss cushions: low rounded hummocks hugging the ground, their skins a mosaic of tiny rosettes
// (like cushion plants) with a scatter of bright sporophyte capsules. Static (cushions do not sway)
// and cheap: the rosette relief is a screen-space bump from a cellular pattern that fades out
// before it can shimmer at distance.
import { Template } from '../geometry.js';

function template(lod) {
  const t = new Template();
  const rings = lod === 0 ? 4 : 2, sides = lod === 0 ? 16 : 9;
  t.grid(rings + 1, sides + 1, (i, j) => t.v(i / rings, (j / sides) * Math.PI * 2, 0), true);
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
  float u = position.x, a = position.y;
  // irregular soft outline and height per cushion
  float wob = 1.0 + 0.2 * sin(a * 2.0 + seed * 31.0) + 0.12 * sin(a * 3.0 + seed * 17.0) + 0.06 * sin(a * 5.0 + seed * 7.0);
  float R = 0.38 * wob * mix(0.8, 1.25, fhash(seed * 2.3));
  float Hc = 0.2 * mix(0.7, 1.3, fhash(seed * 5.1));
  float e = u * 1.5707963;
  float rr = R * cos(e) * (1.0 + 0.1 * (1.0 - u));
  float y = Hc * pow(sin(e), 0.55) - 0.035;
  // a cushion is several merged mounds: low-frequency lumps over the dome
  float lump = sin(a * 3.0 + seed * 41.0) * sin(e * 2.0 + seed * 13.0) + 0.6 * sin(a * 5.0 - seed * 23.0) * sin(e * 3.0);
  y *= 1.0 + 0.16 * lump * sin(e);
  rr *= 1.0 + 0.04 * lump;
  vec3 lp = vec3(cos(a) * rr, y, sin(a) * rr);
  vec3 ln = normalize(vec3(cos(a) * cos(e) * Hc / R * 2.2, sin(e) + 0.3, sin(a) * cos(e) * Hc / R * 2.2));
  vec3 P = B + qrot(iQuat, lp * S * shrink);
  vec3 N = qrot(iQuat, ln);
  vPos = P;
  vNrm = N;
  // the rim fades into the ground colour; the crown catches the light
  vec3 col = mix(palCol(0) * 0.85, palCol(1), smoothstep(0.0, 0.5, u));
  col = mix(col, palCol(2), smoothstep(0.55, 1.0, u) * 0.5);
  vCol = instTint(col);
  vAcc = palCol(3);
  vUv = vec4(lp.x * S, lp.z * S, u, seed);
  vMat = vec4(mix(0.5, 1.0, smoothstep(0.0, 0.6, u)), 0.25, 0.0, 0.0);
  vW = vec3(0.0); vV = vec3(0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}
`;

const FRAG = /* glsl */ `
vec3 cellsF(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash22(i + g) * 0.8 + 0.1;
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash12(i + g); }
    else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2) - sqrt(d1), id);
}
void main() {
  lodDither();
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vNrm);
  if (!gl_FrontFacing) N = -N;
  vec3 alb = vCol;
  // soft painterly mottling (yellower crowns, cooler hollows)
  float mott = noiseTex(vUv.xy * 0.8 + vUv.w * 3.0, 3);
  float mott2 = noiseTex(vUv.xy * 2.3 + vUv.w * 7.0, 0);
  alb = mix(alb, alb * vec3(1.15, 1.12, 0.8), smoothstep(0.5, 0.8, mott) * 0.55);
  alb = mix(alb, alb * vec3(0.8, 0.92, 0.98), smoothstep(0.45, 0.2, mott) * 0.45);
  alb *= 0.9 + 0.2 * mott2;
  // close up: a mosaic of tiny rosettes with sporophyte capsules
  vec2 q = vUv.xy * 24.0 + vUv.w * 40.0;
  float pw = fwidth(q.x) + fwidth(q.y);
  float detail = 1.0 - smoothstep(0.12, 0.3, pw);
  float h = 0.0;
  if (detail > 0.0) {
    vec3 c = cellsF(q);
    float dome = 1.0 - smoothstep(0.0, 0.62, c.x);
    float seam = 1.0 - smoothstep(0.02, 0.12, c.y);
    h = (dome * 0.5 - seam * 0.3) * detail;
    alb *= mix(1.0, 0.92 + 0.14 * c.z, detail);
    alb *= 1.0 - seam * 0.15 * detail;
    float spore = step(0.94, c.z) * (1.0 - smoothstep(0.08, 0.22, c.x)) * detail * smoothstep(0.3, 0.7, vUv.z);
    alb = mix(alb, vAcc, spore);
  }
  // lumpy skin: the cushion is a pile of soft rounded rosette clumps
  float lumps = noiseTex(vUv.xy * 2.2 + vUv.w * 5.0, 1);
  h += lumps * 1.6 * (1.0 - smoothstep(0.6, 2.0, pw * 0.1));
  alb *= 0.82 + 0.3 * lumps;
  vec3 dpx = dFdx(vPos), dpy = dFdy(vPos);
  float hx = dFdx(h), hy = dFdy(h);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  if (abs(det) > 1e-10) N = normalize(abs(det) * N - sign(det) * (hx * r1 + hy * r2) * 0.01);
  vec3 col = floraLight(alb, N, vPos, vMat.x, vMat.y, 0.0, 0.34, 0.55, 0.0, 0.4, vec3(0.0));
  col = applyFog(col, vPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

export default {
  name: 'moss',
  lod: [18, 60, 0],
  band: [4, 14, 0],
  shadow: false,
  reacts: false,
  filler: true,
  chunk: 8,
  radius: 0.6,
  height: 0.25,
  palettes: [
    ['#232c16', '#3a4a1e', '#647a36', '#d0603a', '#ffffff'], // olive with ember capsules
    ['#1a2c24', '#2e5240', '#5c8a66', '#e8c860', '#ffffff'], // sea-green with gold capsules
    ['#2e2418', '#5a4428', '#a0844a', '#e0e070', '#ffffff'], // rust
    ['#1a3430', '#2a5e52', '#5e9a80', '#ff8aa0', '#ffffff'], // oasis teal with pink capsules
  ],
  template,
  vert: VERT,
  frag: FRAG,
};

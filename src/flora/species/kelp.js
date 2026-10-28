// Kelp ribbons: long translucent blades held aloft by gas bladders, streaming and rippling in the
// wind like banners (on land), or swaying with the swell's surge and floating up into a canopy at
// the surface (on the reef). Each blade is integrated in world space: its centreline bends toward
// the wind with a travelling wave, twists about itself, and its ruffled edges ripple.
import { Template } from '../geometry.js';

const BLADES = [
  // azimuth, length, width, base offset
  [0.3, 1.0, 1.0, 0.3],
  [1.6, 0.8, 0.85, 0.42],
  [2.9, 1.15, 1.05, 0.22],
  [4.1, 0.7, 0.8, 0.45],
  [5.3, 0.92, 0.95, 0.36],
];

function template(lod) {
  const t = new Template();
  const rows = lod === 0 ? 30 : 12;
  const across = lod === 0 ? [-1, 0, 1] : [-1, 1];
  BLADES.forEach((b, k) => {
    const P = [Math.cos(b[0]) * b[3], Math.sin(b[0]) * b[3], b[0], b[1]];
    const Q = [(k * 0.618034 + 0.13) % 1, b[2], 0, 0];
    t.grid(rows, across.length, (i, j) => t.v(i / (rows - 1), across[j], 0, P, Q));
    // the gas bladder where the stipe opens into the blade
    t.grid(2, 2, (i, j) => t.v(j * 2 - 1, i * 2 - 1, 1, P, Q));
  });
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
  float az = aP.z, bs = aQ.x;
  float L = 4.4 * aP.w * S * shrink * mix(0.9, 1.1, fhash(seed * 7.0 + bs));
  vec3 up = qrot(iQuat, vec3(0.0, 1.0, 0.0));
  vec3 base = B + qrot(iQuat, vec3(aP.x, 0.0, aP.y)) * S * shrink;
  float sub;
  vec2 bend = floraBend(B, 1.0, seed, sub);
  float ws = length(uWind.xz) * uWindAmt;
  vec2 wd2 = length(uWind.xz) > 1e-3 ? normalize(uWind.xz) : vec2(0.8, 0.6);
  vec3 own = qrot(iQuat, vec3(cos(az), 0.0, sin(az)));
  own.y = 0.0;
  own = normalize(own + 1e-4);
  // streaming: the stronger the wind (and its gust bands), the more the blades lie downwind
  float wk = smoothstep(0.3, 8.0, ws) * (1.0 - sub);
  vec3 bendDir = vec3(bend.x, 0.0, bend.y);
  float bm = length(bend);
  vec3 dirH = normalize(own * mix(0.45, 0.08, wk) + (bm > 1e-4 ? bendDir / bm : vec3(wd2.x, 0.0, wd2.y)) * min(bm * 2.5, 1.0) + 1e-4);
  float thMax = mix(0.35 + 0.35 * fhash(bs * 9.0 + seed), 0.2, sub) + bm * 1.3;
  thMax = min(thMax, 1.45);
  float flow = 0.55 + 0.12 * ws * (1.0 - sub);
  float ph = TAU * fhash(bs * 3.0 + seed * 5.0);
  vec3 Pn = normalize(cross(up, dirH));
  // integrate the centreline (exact arc chords) with a wave running down the blade
  float s = part < 0.5 ? position.x : 0.07;
  vec3 C = base;
  float s0 = 0.0;
  float waveA = mix(0.3, 0.5, wk) + 0.15 * sub;
  float t0 = 0.0;
  int spineN = int(uLodCfg.x + 0.5);
  for (int i = 1; i <= 16; i++) {
    if (i > spineN) break;
    float u = float(i) / float(spineN);
    float s1 = s * u;
    float t1 = thMax * (1.0 - (1.0 - s1) * (1.0 - s1)) + waveA * s1 * sin(TAU * (1.7 * s1 - flow * uTime) + ph);
    float hd = 0.5 * (t1 - t0);
    float tm = t0 + hd;
    C += (s1 - s0) * L * sinc(hd) * (dirH * sin(tm) + up * cos(tm));
    s0 = s1; t0 = t1;
  }
  float th = t0;
  vec3 T = normalize(dirH * sin(th) + up * cos(th));
  // reef kelp floats up into a canopy just under the surface
  float surf = uSeaLevel - 0.25;
  if (sub > 0.5 && C.y > surf - 0.6) {
    float over = C.y - (surf - 0.6);
    C.y = surf - 0.6 + 0.6 * (1.0 - exp(-over / 0.6));
    C += dirH * over * 0.6;
    T = normalize(mix(T, dirH, smoothstep(0.0, 1.0, over)));
  }
  // twist about the blade and the face direction
  float tw = 1.35 * sin(TAU * (0.9 * s - 0.6 * flow * uTime) + ph * 1.7) * s + (fhash(bs + seed) - 0.5) * 1.2;
  vec3 W0 = normalize(Pn - T * dot(Pn, T) + 1e-5);
  vec3 W1 = cross(T, W0);
  vec3 W = W0 * cos(tw) + W1 * sin(tw);
  vec3 Nf = cross(W, T);
  vec3 P;
  vec3 col;
  float ao = 1.0;
  if (part < 0.5) {
    float v = position.y;
    float w0 = 0.16 * aQ.y * S * shrink;
    float hw = w0 * (0.12 + 0.88 * smoothstep(0.02, 0.2, s)) * (1.0 - 0.92 * smoothstep(0.5, 1.0, s));
    hw = max(hw, pixelWorld(C) * 0.6);
    // ruffled margins and a raised midrib
    float rph = s * L * 6.5 - uTime * (2.0 + 0.3 * ws) + bs * 20.0;
    float ruffle = 0.045 * S * v * v * sin(rph) * smoothstep(0.1, 0.3, s);
    float rib = (1.0 - abs(v)) * 0.012 * S;
    P = C + W * v * hw + Nf * (ruffle + rib);
    vec3 N = normalize(Nf - W * v * 0.25 + Nf * 0.0);
    vNrm = N;
    vUv = vec4(s, v, 0.0, rph);
    col = mix(palCol(0), palCol(1), smoothstep(0.0, 0.3, s));
    col = mix(col, palCol(2), smoothstep(0.45, 1.0, s));
    ao = mix(0.5, 1.0, smoothstep(0.0, 0.25, s));
    vW = W;
    vV = Nf;
  } else {
    // bladder sprite
    vec3 tc = toCamDir(C);
    vec3 R = normalize(cross(vec3(0.0, 1.0, 0.0), tc) + 1e-4);
    vec3 U = cross(tc, R);
    float rr = max(0.055 * S * shrink, pixelWorld(C) * 0.7);
    P = C + Nf * 0.02 * S + (R * position.x + U * position.y) * rr;
    vNrm = tc;
    vUv = vec4(position.x, position.y, 1.0, 0.0);
    col = palCol(3);
    vW = R;
    vV = U;
  }
  vPos = P;
  vCol = instTint(col);
  vAcc = instTint(palCol(1)) * 0.6;
  vMat = vec4(ao, 0.7, 0.0, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}
`;

const FRAG = /* glsl */ `
void main() {
  lodDither();
  float part = vUv.z;
  float alpha = 1.0;
  if (part > 0.5) {
    float r2 = dot(vUv.xy, vUv.xy);
    if (r2 > 1.0) discard;
    alpha = clamp((1.0 - r2) / max(fwidth(r2), 1e-3), 0.0, 1.0);
  }
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 alb = vCol;
  vec3 N;
  float thin = 1.0, spec = 0.1, gloss = 0.55;
  if (part < 0.5) {
    N = normalize(vNrm);
    if (!gl_FrontFacing) N = -N;
    float s = vUv.x, v = vUv.y;
    // ripples catch the light across the ruffled margins
    N = normalize(N + vW * cos(vUv.w) * v * 0.45);
    // darker midrib, paler margins, long painted streaks
    float mid = exp(-v * v * 50.0);
    alb = mix(alb, vAcc, mid * 0.6);
    alb *= 0.82 + 0.3 * noiseTex(vec2(v * 0.9 + vUv.x * 0.05, s * 0.7 + vUv.w * 0.0005), 0);
    alb = mix(alb, alb * 1.25, smoothstep(0.55, 1.0, abs(v)) * 0.5);
  } else {
    vec3 tc = normalize(cameraPosition - vPos);
    float r2 = dot(vUv.xy, vUv.xy);
    N = normalize(vW * vUv.x + vV * vUv.y + tc * sqrt(max(1.0 - r2, 0.0)));
    thin = 0.0;
    spec = 0.35;
    gloss = 0.85;
  }
  vec3 col = floraLight(alb, N, vPos, vMat.x, vMat.y, thin, 0.34, 0.25, spec, gloss, vec3(0.0));
  col = applyFog(col, vPos);
  gl_FragColor = vec4(col, alpha);
}
`;

export default {
  name: 'kelp',
  lod: [44, 165, 650],
  band: [5, 14, 50],
  spine: [10, 6],
  shadow: true,
  reacts: false,
  alpha: true,
  radius: 2.6,
  height: 4.4,
  imp: { kind: 4, w: 1.0, h: 3.6, stiff: 1.0, c0: 1, c1: 2 },
  palettes: [
    ['#2c2e17', '#5f5626', '#b09454', '#58562a', '#ffd070'], // amber kelp
    ['#1c3430', '#2c6656', '#8cc092', '#3c6650', '#a0ffd0'], // jade ribbon
    ['#3a2028', '#7e4250', '#d6a090', '#6a3a46', '#ffb0b0'], // rose banner
    ['#2a2620', '#55462e', '#a08048', '#4a4030', '#ffc070'], // ash
  ],
  template,
  vert: VERT,
  frag: FRAG,
};

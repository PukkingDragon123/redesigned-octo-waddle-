// Curled sprouts: tufts of small croziers that make the ground read as a living meadow. Each sprout
// is a camera-facing strip along a little spiral centreline (integrated in the shader), shaded as
// a round shoot. They sway with the wind, breathe their curls tighter and looser, curl up tight
// when a whale passes overhead, and sink into the ground at the edge of their range.
import { Template } from '../geometry.js';

const SPROUTS = [
  // offset x, z, azimuth, length
  [0.0, 0.0, 0.3, 0.32],
  [0.09, 0.05, 2.4, 0.24],
  [-0.06, 0.08, 4.4, 0.27],
  [0.03, -0.09, 5.6, 0.2],
];

function template(lod) {
  const t = new Template();
  const n = lod === 0 ? 10 : 5;
  const count = lod === 0 ? 3 : 2;
  for (let k = 0; k < count; k++) {
    const sp = SPROUTS[k];
    t.strip(n, (i, v) => t.v(i / (n - 1), v, 0, sp, [k, 0, 0, 0]));
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
  float k = aQ.x;
  float az = aP.z + (fhash(seed * 3.0 + k) - 0.5) * 1.2;
  float L = aP.w * mix(0.8, 1.25, fhash(seed * 7.0 + k)) * S * shrink;
  float startle = nearDisturb(B);
  float breath = 0.5 + 0.5 * sin(uTime * 0.5 + seed * 30.0 + k * 1.7);
  float curl = mix(0.6, 0.95, breath);
  curl = mix(curl, 1.2, startle);
  float lean = mix(0.15, 0.45, fhash(seed * 11.0 + k));
  float TH = 8.5;
  vec3 outD = qrot(iQuat, vec3(cos(az), 0.0, sin(az)));
  vec3 up = qrot(iQuat, vec3(0.0, 1.0, 0.0));
  vec3 base = B + qrot(iQuat, vec3(aP.x, 0.0, aP.y)) * S * shrink;
  float s = position.x;
  // centreline: leaning out, then rolling back in over the top (theta = lean*s - curl*TH*s^2.5)
  vec3 C = base;
  float s0 = 0.0, t0 = 0.0;
  int spineN = int(uLodCfg.x + 0.5);
  for (int i = 1; i <= 16; i++) {
    if (i > spineN) break;
    float u = float(i) / float(spineN);
    float s1 = s * u * (1.5 - 0.5 * u);
    float t1 = lean * s1 - curl * TH * pow(s1, 2.6);
    float hd = 0.5 * (t1 - t0);
    float tm = t0 + hd;
    C += (s1 - s0) * L * sinc(hd) * (outD * sin(tm) + up * cos(tm));
    s0 = s1; t0 = t1;
  }
  vec3 T = normalize(outD * sin(t0) + up * cos(t0));
  float sub;
  vec2 bend = floraBend(B, 1.6, seed + k, sub);
  vec3 rel = applyBend(C - B, bend, smoothstep(0.0, 1.0, s));
  T = applyBend(T, bend, smoothstep(0.0, 1.0, s));
  C = B + rel;
  vec3 W, Vp;
  stripFrame(C, T, W, Vp);
  float hw = 0.0095 * S * shrink * (1.0 - 0.5 * s);
  hw = stripHalfWidth(C, hw);
  vec3 P = C + W * position.y * hw;
  vPos = P;
  vNrm = W * position.y;
  vW = W; vV = Vp;
  vec3 col = mix(palCol(0), palCol(1), smoothstep(0.0, 0.5, s));
  col = mix(col, palCol(2), smoothstep(0.6, 1.0, s));
  vCol = instTint(col);
  vAcc = palCol(3);
  vUv = vec4(s, position.y, k, 0.0);
  vMat = vec4(mix(0.45, 1.0, smoothstep(0.0, 0.5, s)), 0.5, 0.0, 0.0);
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
  vec3 N = stripNormal(vUv.y);
  vec3 alb = vCol * (0.9 + 0.2 * noiseTex(vec2(vUv.z * 0.3 + vPos.x * 0.05, vUv.x * 0.6 + vPos.z * 0.05), 0));
  vec3 col = floraLight(alb, N, vPos, vMat.x, vMat.y, 1.0, 0.34, 0.25, 0.04, 0.4, vec3(0.0));
  col = applyFog(col, vPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

export default {
  name: 'sprouts',
  lod: [16, 36, 0],
  band: [4, 10, 0],
  spine: [8, 5],
  shadow: false,
  reacts: false,
  filler: true,
  chunk: 8,
  radius: 0.3,
  height: 0.35,
  palettes: [
    ['#2a361a', '#4c6a30', '#a2be6c', '#ffffff', '#ffffff'], // meadow sage
    ['#1c3632', '#2f6a5e', '#8ecab0', '#ffffff', '#ffffff'], // sea-glass teal
    ['#2a2018', '#4e3826', '#8c6844', '#ffffff', '#ffffff'], // ash and ember
    ['#2c2a3e', '#564a84', '#b0a2d8', '#ffffff', '#ffffff'], // violet
  ],
  template,
  vert: VERT,
  frag: FRAG,
};

// Tube plants: a cluster of trumpet tubes rising from one fleshy foot. A slow peristaltic swell
// climbs each tube and the flared bells open and close as if breathing; helical ribs wind up the
// walls (the spiral motif). A whale passing makes them contract and pinch their mouths shut.
// The walls are real double-sided lathes: the outer skin, a rolled rim and a dark inner throat
// that glows faintly at night.
import { Template } from '../geometry.js';

const TUBES = [
  // offset x, z, lean azimuth, lean angle, height, radius
  [0.0, 0.0, 0.0, 0.06, 1.75, 0.17],
  [0.27, 0.1, 0.35, 0.24, 1.2, 0.14],
  [-0.22, 0.2, 2.5, 0.27, 1.38, 0.15],
  [-0.05, -0.28, 4.4, 0.22, 0.95, 0.125],
  [0.24, -0.21, 5.6, 0.32, 0.68, 0.11],
];

// profile: outer wall (y 0..1), rim roll, inner throat down to y 0.55 -> [r, y, region, normal angle]
function profile(lod) {
  const out = [];
  const n = lod === 0 ? 10 : 5;
  const R = (y) => (1.0 - 0.16 * Math.sin(Math.PI * y)) * (1 + 0.95 * Math.pow(Math.max(0, (y - 0.62) / 0.38), 2));
  for (let i = 0; i <= n; i++) {
    const y = i / n;
    const e = 0.01;
    const dr = (R(Math.min(1, y + e)) - R(Math.max(0, y - e))) / (Math.min(1, y + e) - Math.max(0, y - e));
    out.push([R(y), y, 0, Math.atan2(-dr * 0.12, 1)]);
  }
  // rim: roll over the lip (thickness 0.05 in units of the tube radius)
  const top = R(1), th = 0.09;
  const rimN = lod === 0 ? 2 : 1;
  for (let i = 1; i <= rimN; i++) {
    const a = (i / (rimN + 1)) * Math.PI;
    out.push([top - th * 0.5 + Math.cos(a) * th * 0.5, 1 + Math.sin(a) * 0.035, 1, a]);
  }
  const m = lod === 0 ? 3 : 1;
  for (let i = 0; i <= m; i++) {
    const y = 1 - (i / m) * 0.45;
    out.push([R(y) - th, y, 2, Math.PI]);
  }
  return out;
}

function template(lod) {
  const t = new Template();
  const prof = profile(lod);
  const sides = lod === 0 ? 11 : 6;
  TUBES.forEach((tb, k) => {
    const P = [tb[0], tb[1], tb[2], tb[3]];
    t.grid(prof.length, sides + 1, (i, j) => {
      const [r, y, region, psi] = prof[i];
      return t.v(r, y, (j / sides) * Math.PI * 2, P, [tb[4], tb[5], k + region * 0.25, psi]);
    }, true);
  });
  // the shared fleshy foot
  const fr = lod === 0 ? 3 : 2, fs = lod === 0 ? 12 : 6;
  t.grid(fr + 1, fs + 1, (i, j) => {
    const e = (i / fr) * Math.PI * 0.5;
    return t.v(Math.cos(e), Math.sin(e), (j / fs) * Math.PI * 2, [0, 0, 0, 0], [0.24, 0.5, -1 + 0.75, e]);
  }, true);
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
  float k = floor(aQ.z + 0.01);
  float region = floor(fract(aQ.z) * 4.0 + 0.5);
  float r = position.x, y = position.y, a = position.z, psi = aQ.w;
  float st = iState;
  if (iPrm.w > 1.5) st = iPrm.w - 2.0;
  vec3 lp, ln;
  float ao = 1.0;
  vec3 col;
  float glow = 0.0;
  float yy = y;
  if (region > 2.5) {
    // foot: a low fleshy dome joining the tubes
    float rf = 0.46 * (1.0 + 0.1 * sin(a * 3.0 + seed * 17.0));
    lp = vec3(cos(a) * r * rf, y * 0.2 - 0.03, sin(a) * r * rf);
    ln = normalize(vec3(cos(a) * r, y * 2.0, sin(a) * r));
    col = palCol(0) * 0.85;
    ao = mix(0.5, 0.8, y);
    yy = 0.0;
  } else {
    float H = aQ.x * mix(0.78, 1.22, fhash(seed * 7.0 + k * 1.3));
    float rho = aQ.y * mix(0.9, 1.12, fhash(seed * 5.0 + k));
    float ph = fhash(k * 3.1 + seed * 11.0) * TAU;
    // breathing: a swell climbing the tube, the bell opening and closing
    float swell = sin(uTime * 0.8 - y * 4.5 + ph);
    float flare = smoothstep(0.62, 1.0, y);
    float rr = r * rho * (1.0 + 0.06 * swell * (1.0 - flare * 0.5));
    rr *= 1.0 + flare * (0.14 * sin(uTime * 0.45 + ph * 1.3) - 0.45 * st);
    float hh = min(y, 1.02) * H * (1.0 - 0.14 * st);
    float alpha = aP.w, phi = aP.z;
    vec3 dirO = vec3(cos(phi), 0.0, sin(phi));
    float kap = 0.28 / H;
    float d = kap * hh;
    vec2 ch = hh * sinc(d * 0.5) * vec2(sin(alpha + d * 0.5), cos(alpha + d * 0.5));
    vec3 axisP = vec3(aP.x, 0.0, aP.y) + dirO * ch.x + vec3(0.0, ch.y, 0.0);
    float th = alpha + d;
    vec3 T = dirO * sin(th) + vec3(0.0, cos(th), 0.0);
    vec3 e1 = dirO * cos(th) - vec3(0.0, sin(th), 0.0);
    vec3 e2 = vec3(-sin(phi), 0.0, cos(phi));
    vec3 radial = cos(a) * e1 + sin(a) * e2;
    // rim roll: lift above the top ring
    float lift = region > 0.5 && region < 1.5 ? (y - 1.0) * H * 0.6 : 0.0;
    lp = axisP + radial * rr + T * lift;
    ln = normalize(radial * cos(psi) + T * sin(psi));
    if (region > 1.5) ln = -radial;
    col = mix(palCol(0), palCol(1), smoothstep(0.0, 0.55, y));
    col = mix(col, palCol(2), smoothstep(0.7, 1.0, y));
    if (region > 1.5) col = palCol(3);
    ao = mix(0.5, 1.0, smoothstep(0.0, 0.35, y));
    if (region > 1.5) ao = mix(0.25, 0.85, smoothstep(0.55, 1.0, y));
    // the throat glows faintly at night, brightest just inside the rim
    glow = (region > 1.5 ? smoothstep(0.55, 0.95, y) : 0.0) * uNight;
    yy = y * H;
  }
  vec3 rel = qrot(iQuat, lp * S * shrink);
  vec3 nw = qrot(iQuat, ln);
  float sub;
  vec2 bend = floraBend(B, 4.0, seed, sub);
  float f = clamp(lp.y / 1.6, 0.0, 1.2);
  rel = applyBend(rel, bend, f * f);
  nw = applyBend(nw, bend, f * f);
  vec3 P = B + rel;
  vPos = P;
  vNrm = nw;
  vCol = instTint(col);
  vAcc = palCol(4);
  vUv = vec4(a / TAU, y, region, yy);
  vMat = vec4(ao, region > 1.5 ? 0.2 : 0.45, glow, k);
  vW = qrot(iQuat, vec3(-sin(a), 0.0, cos(a)));
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
  bool inside = !gl_FrontFacing;
  if (inside) N = -N;
  float region = vUv.z;
  vec3 alb = vCol;
  float u = vUv.x, y = vUv.y;
  float ao = vMat.x;
  if (region < 0.5 && !inside) {
    // helical ribs winding up the wall
    float ribPh = u * TAU * 11.0 + vUv.w * 2.6 + vMat.w * 1.7;
    float rib = sin(ribPh);
    N = normalize(N + vW * cos(ribPh) * 0.55 * smoothstep(0.02, 0.2, y));
    alb *= 0.82 + 0.26 * smoothstep(-0.2, 1.0, rib);
    // pale speckles toward the lip, painterly streaks along the tube
    float sp = noiseTex(vec2(u * 6.0 + vMat.w * 0.3, y * 2.5), 1);
    alb *= 0.84 + 0.24 * noiseTex(vec2(u * 2.0 + vMat.w * 0.3, y * 0.6), 0);
    alb = mix(alb, alb * 1.35 + 0.03, smoothstep(0.72, 0.9, sp) * smoothstep(0.3, 0.9, y) * 0.6);
  } else if (region < 1.5 && !inside) {
    alb = mix(alb, alb * 1.2, 0.5);
  } else {
    // the throat: deep and warm, darker with depth
    alb = mix(vCol, vAcc * 0.3 + vCol * 0.7, 0.2);
    ao *= mix(0.35, 1.0, smoothstep(0.55, 1.0, y));
  }
  vec3 emi = vAcc * vMat.z * 0.28 * (region > 1.5 || inside ? 1.0 : 0.0);
  vec3 col = floraLight(alb, N, vPos, ao, vMat.y, 0.0, 0.3, 0.3, 0.08, 0.7, emi);
  col = applyFog(col, vPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

export default {
  name: 'tubes',
  lod: [28, 125, 420],
  band: [4, 12, 40],
  shadow: true,
  reacts: true,
  closeRate: 4,
  reopen: 7,
  radius: 1.0,
  height: 2.0,
  imp: { kind: 1, w: 0.75, h: 1.9, stiff: 4, c0: 1, c1: 2 },
  palettes: [
    ['#3a2a2e', '#7e5458', '#d8bca8', '#3a1420', '#ff9a70'], // dusty coral
    ['#22323e', '#40627a', '#b4d2da', '#1a2a50', '#80c0ff'], // tidepool blue
    ['#42341c', '#986c30', '#e8d094', '#5a2a10', '#ffb050'], // sponge gold
    ['#1e3a34', '#3a8070', '#d0f0c0', '#14302a', '#80ffd0'], // jade
  ],
  template,
  vert: VERT,
  frag: FRAG,
};

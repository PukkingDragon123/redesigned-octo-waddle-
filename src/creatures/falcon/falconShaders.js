// Shaders for the storm falcon: painted body (feathered skin, beak, legs, talons), layered
// alpha-tested feather cards (fan / fold / raise / twist / bend posed per group on the GPU)
// and raptor eyes. Everything is skinned against one skeleton and lit with stylizedLight().
// Every fragment shader returns early under DEPTH_PASS so Shadows.js can reuse the programs.
import { UNIFORMS, NOISE, SHADOW, LIGHTING } from '../../render/shaders/common.js';

/** Number of feather groups (see FalconModel FG). */
export const NG = 20;

const ROT = /* glsl */ `
vec3 rotAxis(vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
`;

// Screen-door dissolve used when the falcon vanishes into the clouds.
const VANISH = /* glsl */ `
uniform float uVanish;
void vanishClip() {
  if (uVanish > 0.0) {
    float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (n < uVanish) discard;
  }
}
`;

// ---------------------------------------------------------------------------------------
// Body: lofted trunk + head, beak, legs, wing arms. Toes curl on the GPU (arc bend).
export const BODY_VERT = /* glsl */ `
${UNIFORMS}
${ROT}
#include <skinning_pars_vertex>
attribute vec4 aToe;     // xyz toe root (bind), w toe index (-1 = not a toe)
attribute vec4 aPart;    // x part id, y along param, z around param, w aux
uniform vec3 uToeDir[8];
uniform vec3 uToeAxis[8];
uniform vec4 uToe[8];    // x curl angle, y spread angle, z length
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vBind;
varying vec3 vBindN;
varying vec4 vPart;
varying vec2 vUv;

void main() {
  vec3 p = position;
  vec3 n = normal;
  if (aToe.w > -0.5) {
    int ti = int(aToe.w + 0.5);
    vec4 tp = uToe[ti];
    vec3 dir = uToeDir[ti];
    vec3 ax = uToeAxis[ti];
    vec3 d = p - aToe.xyz;
    // spread: yaw the whole toe about the foot's vertical axis
    d = rotAxis(d, vec3(0.0, 1.0, 0.0), tp.y);
    n = rotAxis(n, vec3(0.0, 1.0, 0.0), tp.y);
    dir = rotAxis(dir, vec3(0.0, 1.0, 0.0), tp.y);
    ax = rotAxis(ax, vec3(0.0, 1.0, 0.0), tp.y);
    // curl: bend the toe into a circular arc (exact for a uniformly curled digit)
    float L = tp.z;
    float along = dot(d, dir);
    float a = clamp(along, 0.0, L);
    float ext = max(along - L, 0.0);
    vec3 off = d - dir * along;
    float phi = tp.x * a / L;
    float hh = 0.5 * phi;
    float chord = abs(hh) > 1e-3 ? a * sin(hh) / hh : a;
    vec3 c = rotAxis(dir, ax, hh) * chord + rotAxis(dir, ax, phi) * ext;
    p = aToe.xyz + c + rotAxis(off, ax, phi);
    n = rotAxis(n, ax, phi);
  }
  vec3 transformed = p;
  #include <skinbase_vertex>
  vec3 objectNormal = n;
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * objectNormal);
  vBind = position;
  vBindN = normal;
  vPart = aPart;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const BODY_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
${VANISH}
uniform vec3 uBack;
uniform vec3 uBackDark;
uniform vec3 uHood;
uniform vec3 uBelly;
uniform vec3 uBar;
uniform vec3 uCere;
uniform vec3 uFeet;
uniform vec3 uTalon;
uniform vec3 uBeak;
uniform vec3 uBeakTip;
uniform vec3 uMouth;
uniform vec4 uEye;    // main eye centre (+X side, bind), radius
uniform vec4 uEye2;   // secondary eye
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vBind;
varying vec3 vBindN;
varying vec4 vPart;
varying vec2 vUv;

// Overlapping rounded feather tips (scallops) in a metre-space uv; returns
// x: fringe (pale edge), y: centre streak, z: overlap shade.
vec3 scallops(vec2 uv, vec2 cellSize) {
  vec2 c = uv / cellSize;
  float row = floor(c.y);
  c.x += mod(row, 2.0) * 0.5;
  vec2 f = fract(c);
  vec2 q = vec2((f.x - 0.5) * 1.7, f.y * 1.15);
  float r = length(q);
  float fringe = smoothstep(0.62, 0.86, r) * (1.0 - smoothstep(0.86, 1.02, r));
  float streak = smoothstep(0.12, 0.0, abs(f.x - 0.5)) * (1.0 - f.y) * 0.6;
  float shade = smoothstep(0.35, 1.0, f.y);
  return vec3(fringe, streak, shade);
}

void main() {
  vanishClip();
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  float part = vPart.x;
  vec3 P = vBind;
  vec3 BN = normalize(vBindN);
  vec3 albedo = uBack;
  float spec = 0.05, gloss = 0.45, trans = 0.06, rim = 0.55, ao = 1.0, wrap = 0.2;
  float n1 = vnoise(P.xz * 0.9 + P.y * 0.37);

  if (part < 0.5) {
    // ---- trunk, neck and head -------------------------------------------------------
    float ax = abs(P.x);
    vec3 E = vec3(uEye.x, uEye.y, uEye.z);
    float head = smoothstep(4.6, 5.8, P.z);
    // back / belly split along the flanks (a little lower on the trunk sides)
    float dv = BN.y + 0.18 * (1.0 - head) + (n1 - 0.5) * 0.25;
    float backM = smoothstep(-0.28, 0.12, dv);
    // the head: dark hood down to the eye line, pale cheek and throat
    float hoodLine = E.y - 0.35 - 0.25 * smoothstep(E.z - 0.5, E.z - 1.8, P.z);
    float hood = head * smoothstep(hoodLine - 0.25, hoodLine + 0.2, P.y);
    // malar stripe: the falcon's dark "moustache" under the eye
    vec2 m0 = vec2(E.y - 0.35, E.z + 0.12), m1 = vec2(E.y - 1.75, E.z - 0.1);
    vec2 mp = vec2(P.y, P.z);
    vec2 md = m1 - m0;
    float mh = clamp(dot(mp - m0, md) / dot(md, md), 0.0, 1.0);
    float mw = mix(0.46, 0.2, mh);
    float malar = smoothstep(mw, mw * 0.55, length(mp - (m0 + md * mh))) * smoothstep(0.35, 0.8, ax) * head;
    vec3 back = uBack;
    vec3 belly = uBelly;
    // back: soft scalloped feather rows
    // soft painted feather masses on the mantle rather than a graphic scale pattern
    vec3 sc = scallops(vec2(vUv.x, P.z), vec2(1.6, 1.3));
    float mantle = smoothstep(4.8, 2.6, P.z) * smoothstep(-5.0, -2.0, P.z);
    back = mix(back, uBackDark, (sc.y * 0.22 + sc.z * 0.12) * mantle);
    back = mix(back, uBack * 1.22 + 0.01, sc.x * 0.1 * mantle);
    back *= 0.95 + 0.08 * fbm2(vec2(vUv.x * 0.4, P.z * 0.35));
    // belly: chevron bars on the flanks and belly, drop spots on the upper breast
    float chev = sin((P.z + ax * 0.45) * 2.3 + n1 * 0.8);
    float bars = smoothstep(0.45, 0.85, chev) * smoothstep(-0.15, -0.45, BN.y + 0.0) * (1.0 - smoothstep(2.4, 3.4, P.z));
    vec2 sp = vec2(vUv.x * 0.9, P.z * 1.25);
    vec2 spc = fract(sp + vec2(mod(floor(sp.y), 2.0) * 0.5, 0.0)) - 0.5;
    float spots = smoothstep(0.2, 0.1, length(spc * vec2(1.6, 1.0))) * smoothstep(2.0, 3.0, P.z) * (1.0 - smoothstep(4.6, 5.4, P.z));
    belly = mix(belly, uBar, max(bars * 0.62, spots * 0.55));
    belly *= 0.97 + 0.06 * n1;
    albedo = mix(belly, back, backM);
    // under-tail and vent stay clean cream
    albedo = mix(albedo, uBelly, smoothstep(-5.0, -6.2, P.z) * (1.0 - backM));
    // hood and moustache
    vec3 hoodC = mix(uHood, uHood * 1.25, sc.x * 0.4);
    albedo = mix(albedo, hoodC, max(hood, malar));
    // pale cheek and throat on the head
    float cheek = head * (1.0 - hood) * (1.0 - malar) * smoothstep(-0.7, 0.2, BN.y + 0.6);
    albedo = mix(albedo, uBelly * 1.02, cheek * (1.0 - backM * 0.6));
    // bare yellow orbital ring around the main eye and a dark ring around the small eye
    float de = length(vec3(ax, P.y, P.z) - E) - uEye.w;
    albedo = mix(albedo, uCere, smoothstep(0.13, 0.05, de) * (1.0 - smoothstep(-0.25, 0.2, P.y - E.y)));
    float de2 = length(vec3(ax, P.y, P.z) - uEye2.xyz) - uEye2.w;
    albedo = mix(albedo, uHood * 0.7, smoothstep(0.16, 0.06, de2));
    // brow ridge and socket read as form, not paint
    ao *= mix(1.0, 0.72, smoothstep(0.55, 0.0, de) * smoothstep(E.y - 0.6, E.y + 0.5, P.y));
    ao *= mix(0.8, 1.0, smoothstep(-0.9, 0.2, BN.y));
    trans = 0.05;
  } else if (part < 1.5) {
    // ---- upper mandible: yellow cere, horn-blue beak darkening to the hook ----------
    float u = vPart.y;
    float cere = 1.0 - smoothstep(0.17, 0.25, u);
    vec3 horn = mix(uBeak, uBeakTip, smoothstep(0.3, 0.86, u));
    horn = mix(horn, horn * 1.35, smoothstep(0.75, 0.97, BN.y) * (1.0 - smoothstep(0.5, 0.8, u)) * 0.6);
    albedo = mix(horn, uCere, cere);
    // nostril with its central tubercle
    vec2 nd = vec2((u - 0.115) * 5.2, (P.y - (vPart.w)) * 2.4);
    float nos = smoothstep(0.42, 0.3, length(nd)) * smoothstep(0.35, 0.6, abs(BN.x));
    float tub = smoothstep(0.14, 0.06, length(nd));
    albedo = mix(albedo, uHood * 0.6, nos * (1.0 - tub * 0.8));
    // palate (only seen when the beak opens)
    float pal = smoothstep(0.84, 0.95, abs(vPart.z)) * (1.0 - smoothstep(0.55, 0.72, u));
    albedo = mix(albedo, uMouth, pal);
    spec = mix(0.42, 0.08, cere); gloss = 0.82; rim = 0.4; trans = 0.0; wrap = 0.14;
  } else if (part < 2.5) {
    // ---- lower mandible -----------------------------------------------------------------
    float u = vPart.y;
    albedo = mix(uBeak * 1.08, uBeakTip, smoothstep(0.35, 0.95, u));
    albedo = mix(albedo, uCere * 0.92, (1.0 - smoothstep(0.08, 0.22, u)) * 0.8);
    float tongue = (1.0 - smoothstep(0.12, 0.3, abs(vPart.z))) * (1.0 - smoothstep(0.55, 0.75, u));
    albedo = mix(albedo, mix(uMouth, uMouth * 1.6 + vec3(0.1, 0.02, 0.04), smoothstep(0.1, 0.6, u)), tongue);
    spec = 0.35; gloss = 0.8; rim = 0.4; trans = 0.0; wrap = 0.14;
  } else if (part < 3.5) {
    // ---- feathered "trousers" -------------------------------------------------------------
    vec3 sc = scallops(vec2(vUv.x * 1.3, vUv.y), vec2(0.9, 0.7));
    float bar = smoothstep(0.5, 0.85, sin(vUv.y * 4.4 + n1 * 1.2));
    albedo = mix(uBelly, uBar, bar * 0.5);
    albedo = mix(albedo, uBelly * 1.06, sc.x * 0.4);
    albedo *= 0.96 + 0.06 * n1;
    trans = 0.12; rim = 0.7; wrap = 0.26;
  } else if (part < 4.5) {
    // ---- bare yellow tarsus with transverse scutes ------------------------------------------
    float sc = smoothstep(0.08, 0.0, abs(fract(vPart.y * 9.0) - 0.5) - 0.38);
    float front = smoothstep(-0.2, 0.6, vPart.z);
    albedo = mix(uFeet, uFeet * 0.62, sc * mix(0.35, 0.8, front));
    albedo *= 0.93 + 0.12 * vnoise(vUv * 6.0);
    spec = 0.22; gloss = 0.6; rim = 0.45; trans = 0.03;
  } else if (part < 5.5) {
    // ---- toes: scaled tops, pale knobbly pads ----------------------------------------------
    float sc = smoothstep(0.1, 0.0, abs(fract(vPart.y * 5.0) - 0.5) - 0.36);
    float pad = smoothstep(0.2, -0.5, vPart.z);
    albedo = mix(uFeet, uFeet * 0.6, sc * 0.6 * (1.0 - pad));
    albedo = mix(albedo, mix(uFeet, vec3(0.95, 0.86, 0.66), 0.45), pad * 0.7);
    spec = 0.2; gloss = 0.6; rim = 0.45;
  } else if (part < 6.5) {
    // ---- talons: glossy horn, lighter at the root ---------------------------------------------
    albedo = mix(uTalon * 2.2, uTalon, smoothstep(0.0, 0.35, vPart.y));
    spec = 0.75; gloss = 0.9; rim = 0.6; trans = 0.0; wrap = 0.12;
  } else if (part < 7.5) {
    // ---- rictus: fleshy yellow gape outside, dark mouth inside ----------------------------------------
    albedo = gl_FrontFacing ? mix(uCere * 0.9, uMouth, smoothstep(0.55, 1.0, vPart.y) * 0.5) : uMouth * 0.7;
    ao = gl_FrontFacing ? 0.85 : 0.5; rim = 0.1; spec = 0.3;
  } else {
    // ---- wing arms (fore and hind): lesser coverts on top, barred cream below -----------------
    float top = smoothstep(-0.5, 0.5, vPart.w + BN.y * 0.35);
    vec3 sc = scallops(vec2(vPart.y * 9.0, vPart.z * 4.5), vec2(0.95, 0.85));
    vec3 upper = mix(uBack, uBackDark, sc.y * 0.4 + sc.z * 0.1);
    upper = mix(upper, uBack * 1.4 + 0.02, sc.x * 0.42);
    upper = mix(upper, uBack * 1.12, smoothstep(0.25, 0.0, vPart.z) * 0.5);
    float sp = smoothstep(0.55, 0.85, sin(vPart.y * 40.0 + n1 * 2.0) * sin(vPart.z * 12.0 + 1.0));
    vec3 lower = mix(uBelly, uBar, sp * 0.25);
    albedo = mix(lower, upper, top);
    trans = 0.18; wrap = 0.24; rim = 0.6;
  }

  Surface s = makeSurface(albedo, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.ao = ao;
  s.rim = rim;
  s.spec = spec * (1.0 + uWet * 1.5);
  s.gloss = gloss;
  s.trans = trans;
  s.wrap = wrap;
  vec3 col = stylizedLight(s);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------------------
// Feathers: one card per feather. Per-feather attributes + per-group uniforms pose them
// on the GPU: fan/fold (in-plane, about the card normal), raise (about the side axis),
// twist (about the rachis), bend (aero load / droop) and flutter.
export const FEATHER_VERT = /* glsl */ `
${UNIFORMS}
${ROT}
#include <skinning_pars_vertex>
#define NG ${NG}
attribute vec4 aRoot;   // xyz root (bind), w group
attribute vec4 aAxis;   // xyz rachis direction (bind), w length (m)
attribute vec4 aP1;     // x fan coef, y fold angle, z raise coef, w kind
attribute vec4 aP2;     // x seed, y notch, z stacking offset (m), w twist coef
attribute vec3 aShape;  // x across (-1..1 of the feather's max half width), y along 0..1, z max half width (m)
uniform vec4 uGA[NG];   // x spread, y fold, z twist, w bend
uniform vec4 uGB[NG];   // x flutter amp, y raise, z ruffle, w flutter freq
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vShape;
varying vec4 vInfo;     // x kind, y seed, z notch, w length

void main() {
  int gi = int(aRoot.w + 0.5);
  vec4 ga = uGA[gi];
  vec4 gb = uGB[gi];
  vec3 root = aRoot.xyz;
  vec3 dir = aAxis.xyz;
  float len = aAxis.w;
  float along = aShape.y;
  vec3 N = normal;
  vec3 p = position - root;
  // 1. fan / fold in the feather plane
  float a1 = ga.x * aP1.x + ga.y * aP1.y;
  p = rotAxis(p, N, a1);
  dir = rotAxis(dir, N, a1);
  // 2. raise (crest flare, alula, ruffled coverts in the airflow)
  vec3 S = normalize(cross(dir, N));
  float ruffle = gb.z * (0.55 + 0.45 * sin(uTime * 11.0 + aP2.x * 37.0));
  float a2 = gb.y * aP1.z + ruffle * 0.5 * (0.3 + aP1.z);
  p = rotAxis(p, S, a2);
  N = rotAxis(N, S, a2);
  dir = rotAxis(dir, S, a2);
  // 3. twist about the rachis, growing toward the tip
  float a3 = ga.z * aP2.w * (0.35 + 0.65 * along);
  p = rotAxis(p, dir, a3);
  N = rotAxis(N, dir, a3);
  // 4. bend under load + travelling flutter
  float fl = sin(uTime * gb.w - along * 4.0 + aP2.x * 6.2831) * gb.x;
  float k = ga.w + fl;
  p += N * (k * along * along * len);
  N = normalize(N - dir * (2.0 * k * along));
  // 5. stacking order (keeps folded feathers from interpenetrating)
  p += normal * aP2.z;
  vec3 transformed = root + p;
  #include <skinbase_vertex>
  vec3 objectNormal = N;
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * objectNormal);
  vShape = aShape;
  vInfo = vec4(aP1.w, aP2.x, aP2.y, len);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const FEATHER_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
${VANISH}
uniform vec3 uFTop;
uniform vec3 uFTopDark;
uniform vec3 uFUnder;
uniform vec3 uFBar;
uniform vec3 uCrest;
uniform vec3 uCrestTip;
uniform vec3 uBelly;
uniform vec3 uBar;
uniform vec3 uHood;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vShape;
varying vec4 vInfo;

// Half width of the vane (in units of the feather's max half width) at (y, side of x).
float vaneW(float kind, float y, float x, float notch) {
  float quill = mix(0.2, 1.0, smoothstep(0.0, 0.14, y));
  if (kind < 0.5) {
    // primary: narrow outer vane, long tapering tip, emarginated "finger" on the outer ones
    float tip = sqrt(clamp(1.0 - pow(max(y - 0.55, 0.0) / 0.45, 2.0), 0.0, 1.0));
    float w = (x < 0.0 ? 0.46 : 1.0) * quill * tip;
    float nz = smoothstep(0.4, 0.56, y) * notch;
    return w * (x > 0.0 ? 1.0 - nz * 0.5 : 1.0 - nz * 0.22);
  }
  if (kind < 1.5) {
    // secondary / tertial: broad, blunt rounded tip
    float tip = sqrt(clamp(1.0 - pow(max(y - 0.76, 0.0) / 0.24, 2.0), 0.0, 1.0));
    return (x < 0.0 ? 0.72 : 1.0) * quill * tip;
  }
  if (kind < 2.5) {
    // covert: a rounded shield
    float tip = sqrt(clamp(1.0 - pow(max(y - 0.36, 0.0) / 0.64, 2.0), 0.0, 1.0));
    return mix(0.55, 1.0, smoothstep(0.0, 0.3, y)) * tip;
  }
  if (kind < 3.5) {
    // tail rectrix
    float tip = sqrt(clamp(1.0 - pow(max(y - 0.8, 0.0) / 0.2, 2.0), 0.0, 1.0));
    return quill * tip;
  }
  if (kind < 4.5) {
    // streamer: slender shaft ending in a broad racket
    float rk = smoothstep(0.66, 0.84, y);
    float tip = sqrt(clamp(1.0 - pow(max(y - 0.88, 0.0) / 0.12, 2.0), 0.0, 1.0));
    return mix(0.16, 1.0, rk) * quill * tip;
  }
  if (kind < 5.5) {
    // crest plume: a slender lanceolate blade drawn to a sharp point (reads as flame / spike)
    float body = smoothstep(0.04, 0.5, y);
    float tip = pow(clamp((1.0 - y) / 0.52, 0.0, 1.0), 0.75);
    return mix(0.16, 1.0, body) * tip;
  }
  if (kind < 6.5 || kind > 7.5) {
    // contour feather (scapulars, trousers, flanks, under-tail): soft leaf
    float tip = sqrt(clamp(1.0 - pow(max(y - 0.3, 0.0) / 0.7, 2.0), 0.0, 1.0));
    return mix(0.45, 1.0, smoothstep(0.0, 0.3, y)) * tip;
  }
  // alula: short and pointed
  return quill * pow(clamp(1.0 - y, 0.0, 1.0), 0.55);
}

void main() {
  float kind = vInfo.x;
  float seed = vInfo.y;
  float len = vInfo.w;
  float y = vShape.y;
  float x = vShape.x;
  float w = vaneW(kind, y, x, vInfo.z);
  float d = abs(x) - w;
  float aa = max(fwidth(x), 1e-4) * 1.1;
  float cov = 1.0 - smoothstep(-aa, aa, d);
  vanishClip();
  #ifdef DEPTH_PASS
    if (cov < 0.5) discard;
    gl_FragColor = vec4(1.0);
    return;
  #else
  if (cov < 0.02) discard;
  bool top = gl_FrontFacing;
  vec3 N = normalize(vNormal);
  if (!top) N = -N;
  float ax = abs(x);
  float edge = ax / max(w, 1e-3);
  float rachX = kind < 0.5 ? -0.08 : 0.0;
  float rach = smoothstep(0.05, 0.015, abs(x - rachX)) * (1.0 - smoothstep(0.82, 1.0, y)) * step(kind, 4.5);
  float var = 0.95 + 0.1 * fract(seed * 7.13);
  float m = y * len; // metres from the root
  vec3 col;
  float trans = 0.75, rimA = 0.55, specA = 0.05;
  if (kind > 4.5 && kind < 5.5) {
    // crimson sound-sensing plume: deep base, bright fan tip with a pale rim and a
    // concentric "ear" ring that catches the light
    col = mix(uCrest * 0.42, uCrest, smoothstep(0.0, 0.45, y));
    col = mix(col, uCrestTip, smoothstep(0.55, 1.0, y) * 0.6);
    // fine barbs angled along the vane give the plume a filamentous, sound-sensing texture
    float barbs = sin((ax * 2.2 - y * 9.0) * 6.2831 + seed * 9.0);
    col *= 0.92 + 0.08 * barbs;
    col = mix(col, uCrestTip * 1.2 + 0.04, smoothstep(0.8, 0.99, edge) * smoothstep(0.3, 0.6, y) * 0.55);
    col = mix(col, uCrest * 0.35, smoothstep(0.06, 0.0, abs(x)) * 0.6);
    trans = 1.5; rimA = 0.7;
  } else if (kind > 3.5 && kind < 4.5) {
    // streamer: dark slate shaft, crimson racket with a pale rim
    col = mix(uFTopDark, uFTop, 0.25);
    float rk = smoothstep(0.7, 0.8, y);
    col = mix(col, uCrest * 0.9, rk);
    col = mix(col, uCrestTip * 1.2, rk * smoothstep(0.7, 0.98, edge) * 0.7);
    col = mix(col, uFTopDark * 0.6, rk * smoothstep(0.06, 0.0, abs(x)) * 0.8);
    trans = 1.1;
  } else if (kind > 7.5) {
    // pale contour feathers (trousers, flanks, under-tail): cream with soft bars on both sides
    float bars = smoothstep(0.4, 0.8, sin(m * 4.2 + x * 0.7 + seed * 4.0));
    col = mix(uBelly * var, uBar, bars * 0.42);
    col = mix(col, uBelly * 1.05, smoothstep(0.75, 0.98, edge) * 0.4);
    trans = 0.6; rimA = 0.7;
  } else if (top) {
    col = uFTop * var;
    if (kind < 0.5) {
      col = mix(col, uFTopDark, smoothstep(0.2, 0.85, y));
      col = mix(col, uFTop * 1.25, smoothstep(0.85, 1.0, edge) * (1.0 - y) * 0.35);
      col *= 1.0 - smoothstep(0.55, 0.92, sin(m * 3.1 + seed * 5.0)) * 0.1 * (1.0 - y);
    } else if (kind < 1.5) {
      col = mix(col, uFTopDark, smoothstep(0.55, 1.0, y) * 0.55);
      col *= 1.0 - smoothstep(0.6, 0.95, sin(m * 3.4 + seed * 5.0)) * 0.12;
      col = mix(col, uFTop * 1.45 + 0.03, smoothstep(0.9, 1.0, y) * 0.35);
    } else if (kind < 2.5 || kind > 6.5) {
      // coverts: pale scalloped fringe and a darker shaft streak
      col = mix(col, uFTopDark, smoothstep(0.35, 0.0, edge) * 0.25 * smoothstep(0.1, 0.7, y));
      float fr = max(smoothstep(0.72, 0.96, edge), smoothstep(0.8, 0.98, y)) * smoothstep(0.2, 0.5, y);
      col = mix(col, uFTop * 1.5 + 0.035, fr * 0.42);
    } else if (kind < 3.5) {
      // tail: barred, broad dark subterminal band, pale tip
      col *= 1.0 - smoothstep(0.55, 0.85, sin(m * 2.6 + 1.0)) * 0.2 * (1.0 - smoothstep(0.7, 0.8, y));
      col = mix(col, uFTopDark, smoothstep(0.7, 0.76, y) * (1.0 - smoothstep(0.9, 0.95, y)));
      col = mix(col, uFUnder * 0.95, smoothstep(0.94, 0.98, y));
    } else {
      // contour feathers on the back keep the body colour
      col = mix(col, uFTop * 1.3, smoothstep(0.75, 0.98, edge) * 0.3);
    }
    col = mix(col, col * 0.7, rach * (kind < 1.5 ? 0.6 : 0.3));
  } else {
    // undersides: pale cream with soft grey barring; primaries keep dark tips
    col = uFUnder * var;
    float bars = smoothstep(0.5, 0.85, sin(m * 4.4 + x * 0.35));
    float barAmt = kind < 1.5 ? 0.3 : kind < 2.5 ? 0.14 : kind < 3.5 ? 0.42 : 0.2;
    col = mix(col, uFBar, bars * barAmt);
    if (kind < 0.5) col = mix(col, uFTopDark * 1.3, smoothstep(0.6, 0.9, y) * 0.85);
    if (kind > 0.5 && kind < 1.5) col = mix(col, uFTopDark * 1.4, smoothstep(0.85, 1.0, y) * 0.5);
    if (kind > 2.5 && kind < 3.5) col = mix(col, uFTopDark * 1.5, smoothstep(0.72, 0.78, y) * (1.0 - smoothstep(0.9, 0.95, y)) * 0.7);
    col = mix(col, col * 0.85, rach * 0.5);
    trans = 0.95;
  }
  Surface s = makeSurface(col, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  // feathers are darker where they overlap at the root
  s.ao = mix(0.72, 1.0, smoothstep(0.0, 0.45, y));
  s.rim = rimA;
  s.spec = specA;
  s.gloss = 0.5;
  s.trans = trans;
  s.wrap = 0.3;
  vec3 c = stylizedLight(s);
  c = applyFog(c, vWorldPos);
  gl_FragColor = vec4(c, cov);
  #endif
}
`;

// ---------------------------------------------------------------------------------------
// Eyes: four spheres (two big primary eyes, two small secondary eyes) skinned rigidly to
// the head. Gaze, pupil, lids and the nictitating membrane are painted in socket space.
export const EYE_VERT = /* glsl */ `
${UNIFORMS}
#include <skinning_pars_vertex>
attribute vec4 aEye;   // xyz unit direction in socket space, w eye index
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vIdx;
void main() {
  vec3 transformed = position;
  #include <skinbase_vertex>
  vec3 objectNormal = normal;
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * objectNormal);
  vLocal = aEye.xyz;
  vIdx = aEye.w;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const EYE_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
${VANISH}
uniform vec3 uGaze[4];    // socket-space gaze per eye
uniform vec4 uLids;       // main eyes: x upper elevation, y lower elevation, z frown slant, w lower curve
uniform vec4 uLids2;      // small eyes
uniform float uNict;      // nictitating membrane 0..1
uniform float uPupil;     // pupil radius (radians), main eyes
uniform vec3 uIris;
uniform vec3 uIris2;
uniform vec3 uLidCol;
uniform vec3 uRing;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vIdx;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vanishClip();
  int idx = int(vIdx + 0.5);
  bool small = idx >= 2;
  float side = (idx == 0 || idx == 2) ? 1.0 : -1.0;
  vec3 n = normalize(vLocal);
  vec3 N = normalize(vNormal);
  vec3 g = normalize(uGaze[idx]);
  // socket space: +z rest gaze, +y up, +x toward the beak on both sides (frontness)
  float az = atan(n.x, n.z);
  float el = asin(clamp(n.y, -1.0, 1.0));
  vec4 L = small ? uLids2 : uLids;
  float up = L.x - L.z * az - 0.18 * az * az;
  float lo = L.y + L.w * az * az;
  float lid = clamp(smoothstep(up - 0.03, up + 0.03, el) + smoothstep(lo + 0.03, lo - 0.03, el), 0.0, 1.0);
  float ang = acos(clamp(dot(n, g), -1.0, 1.0));
  vec3 eye;
  if (!small) {
    float irisR = 1.45;
    float pr = uPupil;
    vec3 tang = normalize(cross(g, vec3(0.0, 1.0, 0.0)) + 1e-4);
    float rad = atan(dot(n, cross(g, tang)), dot(n, tang));
    float streak = vnoise(vec2(rad * 9.0, ang * 26.0));
    vec3 irisCol = mix(uIris, uIris2, smoothstep(pr + 0.05, 1.1, ang) * 0.8);
    irisCol *= 0.82 + 0.3 * streak;
    // dark limbal ring just inside the lids
    irisCol = mix(irisCol, uIris2 * 0.35, smoothstep(irisR * 0.8, irisR, ang));
    irisCol += uIris * 0.45 * smoothstep(0.0, -0.7, n.y - g.y) * smoothstep(pr, irisR, ang);
    eye = mix(vec3(0.9, 0.86, 0.78), irisCol, smoothstep(irisR + 0.03, irisR - 0.03, ang));
    eye = mix(eye, vec3(0.012, 0.014, 0.025), smoothstep(pr + 0.02, pr - 0.02, ang));
  } else {
    // small secondary eyes: dark glossy orbs with a thin amber ring
    eye = mix(uIris2 * 0.25, vec3(0.01, 0.012, 0.02), smoothstep(0.75, 0.55, ang));
    eye = mix(eye, uIris * 0.9, smoothstep(0.09, 0.0, abs(ang - 0.8)) * 0.8);
  }
  // shadow of the brow / upper lid on the eyeball
  eye *= mix(1.0, 0.45, smoothstep(up - 0.45, up, el));
  // nictitating membrane sweeps from the front corner
  float front = az;
  float b = mix(1.7, -1.7, uNict);
  float mem = smoothstep(b - 0.12, b + 0.12, front) * step(0.01, uNict) * (small ? 0.0 : 1.0);
  eye = mix(eye, vec3(0.8, 0.84, 0.9), mem * 0.72);
  Surface s = makeSurface(uLidCol, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.rim = 0.35; s.wrap = 0.2;
  vec3 lidLit = stylizedLight(s);
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 eyeLit = eye * (hemiAmbient(N) * 0.75 + uSunColor * 0.22 * (0.4 + 0.6 * s.shadow));
  eyeLit += uSkyAmbient * 0.12 * pow(1.0 - max(dot(N, V), 0.0), 2.0);
  // a single crisp view-space highlight: predatory, not cute
  vec3 camRight = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 camUp = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  vec3 L1 = normalize(V + camUp * 0.6 - camRight * 0.3 * side);
  float h1 = smoothstep(0.978, 0.986, dot(N, normalize(L1 + V)));
  eyeLit += vec3(1.0) * h1 * 1.3 * (1.0 - lid);
  // the ring of bare skin right at the lid margin
  float ringM = small ? 0.0 : smoothstep(0.08, 0.0, min(abs(el - up), abs(el - lo))) * (1.0 - lid * 0.5);
  vec3 col = mix(eyeLit, lidLit, lid);
  col = mix(col, uRing * (hemiAmbient(N) * 0.6 + uSunColor * 0.3), ringM * 0.85);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

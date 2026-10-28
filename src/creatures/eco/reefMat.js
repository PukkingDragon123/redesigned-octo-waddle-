// Materials for the reef life (reefGeo.js meshes). One vertex / fragment program per KIND, all
// instanced with three vec4s per instance:
//   iA: world position (holdfast / body centre), yaw
//   iB: scale, seed, then two kind-specific values
//   iC: pitch, roll (fauna) or kind-specific state
// uActors (xyz position, w radius) are the whales nearest the camera: kelp parts around them,
// anemones close, tube corals retract and fans bend away, all on the GPU.
// Lit by stylizedLight and fogged by applyFog (water column, caustics, the underwater view);
// bioluminescence is added again after the fog so it carries through the dark water at night.
import { ShaderMaterial, DoubleSide, FrontSide, AdditiveBlending, Vector4, Color } from 'three';
import { G } from '../../render/Globals.js';
import { UNIFORMS, NOISE, LIGHTING } from '../../render/shaders/common.js';
import { ECO_GLSL } from './glsl.js';

export const KIND = { kelp: 0, tubes: 1, anemone: 2, shell: 3, fan: 4, crab: 5, jelly: 6, ray: 7, puffer: 8, eel: 9 };

const VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${ECO_GLSL}
attribute vec4 aP;
attribute vec4 aQ;
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
uniform vec4 uActors[4];
uniform vec4 uFade;
varying vec3 vWorldPos;
varying vec3 vN;
varying vec4 vP;
varying vec4 vI;
varying vec3 vLoc;

float actorNear(vec3 P, out vec3 away) {
  float near = 0.0;
  away = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec4 a = uActors[i];
    if (a.w <= 0.0) continue;
    vec3 v = P - a.xyz;
    float l = length(v);
    float k = 1.0 - smoothstep(a.w * 0.7, a.w * 2.6, l);
    near = max(near, k);
    away += v / max(l, 0.01) * k;
  }
  return near;
}

void main() {
  vec3 pos = position;
  vec3 nrm = normal;
  float part = floor(aP.x + 0.5);
  float seed = iB.y;
  float yaw = iA.w;
  vec3 base = iA.xyz;
  vec4 info = vec4(seed, iB.z, 0.0, 0.0);
  vec3 W;
  mat3 R = rotY(yaw);
  vec3 away;
  vLoc = position;

#if KIND == 0
  // ---- kelp: a bending spine reaching the surface, then a canopy lying along it ----------------
  float H = iB.z;
  float t = aP.y;
  float near = actorNear(base + vec3(0.0, min(H, uSeaLevel - base.y) * 0.6, 0.0), away);
  float roomUp = max(uSeaLevel - 0.45 - base.y, 0.5);
  float ph = uTime * 0.5 + seed * 6.2831;
  float surge = sin(ph) * 0.6 + sin(ph * 0.43 + 1.7) * 0.4;
  vec2 cur = vec2(0.82, 0.36) * (0.55 + 0.45 * surge);
  float h = t * H;
  float over = max(h - roomUp, 0.0);
  float bendK = pow(t, 1.5) * min(H, roomUp) * 0.16;
  vec3 spine = base + vec3(0.0, min(h, roomUp), 0.0);
  spine.xz += (cur + vec2(sin(ph * 1.3 + t * 4.0), cos(ph * 1.1 + t * 3.0)) * 0.22) * bendK;
  spine.xz += normalize(vec2(0.82, 0.36) + vec2(0.0, surge * 0.3)) * over;
  spine.y += sin(uTime * 0.8 + over * 0.6 + seed) * 0.08 * step(0.01, over);
  // a whale pushing through parts the forest
  spine.xz += away.xz * pow(t, 1.2) * 3.2 * min(H, 10.0) * 0.12;
  vec3 local = pos * iB.x;
  if (part > 0.5 && part < 1.5) {
    float u = aP.z;
    // blades stream with the surge and flutter along their length
    local.y += sin(uTime * 2.1 + u * 6.0 + seed * 9.0 + t * 5.0) * 0.12 * u;
    vec3 sw = vec3(cur.x, 0.0, cur.y) * u * u * 0.9;
    local = R * local + sw;
    local.x += sin(uTime * 1.7 + u * 5.0 + aQ.w) * 0.1 * u;
  } else {
    local = R * local;
  }
  W = spine + local;
  nrm = R * nrm;
  info.z = near;
  info.w = t;
#elif KIND == 1
  // ---- tube corals: retract when a whale comes close ------------------------------------------
  float near = actorNear(base, away);
  vec3 p = pos;
  float t = aP.y;
  float pull = mix(1.0, 0.35, smoothstep(0.1, 0.8, near));
  vec3 root = vec3(aQ.x, 0.0, aQ.z);
  p = root + (p - root) * vec3(1.0, pull, 1.0);
  p.x += sin(uTime * 1.1 + seed * 7.0 + aP.z * 1.7) * 0.05 * t;
  p.z += cos(uTime * 0.9 + seed * 5.0 + aP.z * 2.1) * 0.05 * t;
  W = base + R * (p * iB.x);
  nrm = R * nrm;
  info.z = near;
  info.w = t;
#elif KIND == 2
  // ---- anemones: tentacles sway, and close up into a bud when a whale passes ---------------------
  float near = actorNear(base, away);
  float close = smoothstep(0.15, 0.75, near);
  vec3 p = pos;
  if (part > 4.5) {
    vec3 root = aQ.xyz;
    vec3 off = p - root;
    float t = aP.y, a = aP.z;
    off += vec3(sin(uTime * 1.6 + a * 3.0 + t * 3.0 + seed * 5.0), 0.0, cos(uTime * 1.3 + a * 2.0 + t * 2.5)) * 0.07 * t;
    vec3 bud = vec3(-cos(a) * 0.12, 0.08 + aP.w * 0.25, -sin(a) * 0.12) * t;
    off = mix(off, bud, close);
    p = root * mix(1.0, 0.7, close) + off;
  } else {
    p.y *= mix(1.0, 0.8, close);
  }
  W = base + R * (p * iB.x);
  nrm = R * nrm;
  info.z = close;
  info.w = aP.y;
#elif KIND == 3
  // ---- spiral shells ---------------------------------------------------------------------------
  W = base + R * (rotZ(1.35) * pos * iB.x) + vec3(0.0, 0.08 * iB.x, 0.0);
  nrm = R * (rotZ(1.35) * nrm);
  info.w = aP.y;
#elif KIND == 4
  // ---- sea fans: a flat lattice that bends with the surge and away from whales -----------------
  float near = actorNear(base, away);
  vec3 p = pos;
  float v = aP.y;
  p.z += (sin(uTime * 0.9 + seed * 6.0) * 0.18 + sin(uTime * 2.3 + aP.z * 4.0) * 0.04) * v * v;
  vec3 wp = R * (p * iB.x);
  wp.xz += away.xz * v * v * 0.9 * iB.x;
  W = base + wp;
  nrm = R * nrm;
  info.z = near;
  info.w = v;
#elif KIND == 5
  // ---- crabs: walk cycle, claw waving, hiding (hermit: into its shell, glass: burrow, plate: clamp)
  float variant = iB.z;
  float walkPh = iB.w;
  float hide = iC.x, claw = iC.y, walk = iC.z;
  vec3 p = pos;
  bool hermit = variant < 0.5;
  bool glass = variant > 0.5 && variant < 1.5;
  bool plate = variant > 1.5;
  float side = aP.w;
  if (part > 10.5 && part < 11.5 || part > 14.5) {
    // legs (and the joint beads that ride on them)
    vec3 hinge = aQ.xyz;
    vec3 rel = p - hinge;
    if (glass) rel *= vec3(1.5, 2.2, 1.5);
    if (plate) rel *= vec3(1.15, 1.0, 1.1);
    float legPh = walkPh + aP.z * 2.1 + (side > 0.0 ? 3.14159 : 0.0);
    rel = rotY(sin(legPh) * 0.4 * walk) * rel;
    rel.y += max(0.0, cos(legPh)) * 0.07 * walk * (part > 14.5 ? 0.5 : aP.y);
    // hiding: legs fold up under the body
    vec3 tuck = vec3(rel.x * 0.35, -0.04 * aP.y, rel.z * 0.6);
    rel = mix(rel, tuck, hide * (glass ? 0.3 : 1.0));
    p = hinge + rel;
  } else if (part > 11.5 && part < 12.5) {
    vec3 hinge = aQ.xyz;
    vec3 rel = p - hinge;
    if (plate) rel *= 1.25;
    // the claws rise and wave (a threat display), the pincer snaps
    float lift = claw * (0.75 + 0.35 * sin(uTime * 7.0 + side * 1.3));
    rel = rotX(-lift) * rel;
    rel = rotY(-side * claw * 0.3 * sin(uTime * 5.0 + side)) * rel;
    rel = mix(rel, rel * vec3(0.7, 0.5, 0.5) + vec3(0.0, -0.05, -0.06), hide);
    p = hinge + rel;
  } else if (part > 12.5 && part < 13.5) {
    // eye stalks drop flat when hiding
    p.y = mix(p.y, 0.2, hide * step(0.3, aP.y) * 0.8);
  }
  if (part > 9.5 && part < 10.5 && plate) p.xz *= vec2(1.3, 1.15);
  if (part > 13.5 && part < 14.5 && !hermit) p *= 0.0;
  // glass crabs stand tall on their long legs
  if (glass && !(part > 10.5 && part < 11.5) && part < 14.5) p.y += 0.18;
  if (glass && part > 14.5) p.y += 0.18;
  if (hermit && part < 14.5) {
    // the hermit pulls everything into the shell's mouth
    vec3 mouth = vec3(0.0, 0.3, 0.02);
    p = mouth + (p - mouth) * (1.0 - hide * 0.88);
  }
  // body bob while walking
  p.y += sin(walkPh * 2.0) * 0.012 * walk;
  // glass crabs burrow into the sand
  if (glass) p.y -= hide * 0.42;
  W = base + R * (p * iB.x);
  nrm = R * nrm;
  info.z = hide;
  info.w = iC.w;
#elif KIND == 6
  // ---- jellies: the bell contracts and relaxes, arms and tentacles trail -----------------------
  float pul = iB.z;
  float c = pow(max(sin(pul), 0.0), 1.5);
  vec3 p = pos;
  if (part < 20.5) {
    float rimK = aP.y;
    p.xz *= 1.0 - 0.2 * c * (0.3 + rimK);
    p.y *= 1.0 + 0.12 * c;
    p.y += sin(aP.z * 6.2831 * 8.0 + uTime * 3.0) * 0.025 * rimK * rimK;
  } else if (part < 21.5) {
    p *= 1.0 + 0.08 * sin(uTime * 2.0 + seed * 9.0);
  } else {
    float t = aP.y;
    p.xz *= 1.0 - 0.25 * c * (1.0 - t * 0.5);
    float lag = pul - t * 2.0;
    p.x += sin(uTime * 0.9 + t * 4.0 + aP.z * 2.0 + seed * 3.0) * 0.28 * t + sin(lag) * 0.06 * t;
    p.z += cos(uTime * 0.8 + t * 3.5 + aP.z * 1.7 + seed * 2.0) * 0.28 * t;
    p.y *= 1.0 - 0.15 * c * t;
  }
  mat3 O = R * rotX(-iC.x) * rotZ(iC.y);
  W = base + O * (p * iB.x);
  nrm = O * nrm;
  info.z = iB.w;
  info.w = c;
#elif KIND == 7
  // ---- rays: slow wing beats travelling out along the wings, a whip tail -----------------------
  float flap = iB.z;
  float amp = iC.z;
  vec3 p = pos;
  if (part < 30.5) {
    float u = abs(aP.z), v = aP.y;
    p.y += sin(flap - u * 1.9) * pow(u, 1.5) * 0.55 * amp;
    p.y += sin(flap * 0.5 - v * 3.0) * 0.04 * amp;
    // wing tips curl a little on the downstroke
    p.x *= 1.0 - 0.06 * u * max(-sin(flap - u * 1.9), 0.0) * amp;
  } else if (part < 31.5) {
    p.x += aP.z * sin(uTime * 1.3 + seed * 4.0) * 0.03 * aP.y;
  } else {
    p.x += sin(uTime * 2.0 + aP.y * 4.0 + seed * 3.0) * 0.18 * aP.y;
    p.y += sin(flap - 1.5 - aP.y * 2.0) * 0.12 * aP.y;
  }
  mat3 O = R * rotX(-iC.x) * rotZ(iC.y);
  W = base + O * (p * iB.x);
  nrm = O * nrm;
  info.z = iC.w;
  info.w = aP.z;
#elif KIND == 8
  // ---- lantern puffers: inflate into a spiky ball when startled ---------------------------------
  float inf = iB.w;
  vec3 p = pos;
  float grow = 1.0 + 0.7 * inf;
  if (part < 40.5) {
    p = mix(p, normalize(p) * 0.23, inf * 0.8) * grow;
  } else if (part < 41.5) {
    p *= mix(1.0, 1.55, inf);
  } else if (part < 42.5) {
    vec3 hinge = aQ.xyz;
    vec3 rel = p - hinge;
    rel.y += sin(uTime * 13.0 + aP.z * 1.7 + seed * 5.0) * 0.05 * aP.w;
    rel.x += sin(iB.z) * 0.07 * aP.y * (1.0 - aP.w);
    p = hinge * mix(1.0, 1.5, inf) + rel;
  } else {
    vec3 root = aQ.xyz;
    vec3 rel = p - root;
    vec3 r2 = mix(root, normalize(root) * 0.23, inf * 0.8) * grow;
    p = r2 + rel * (0.25 + 1.6 * inf);
  }
  mat3 O = R * rotX(-iC.x) * rotZ(iC.y);
  W = base + O * (p * iB.x);
  nrm = O * nrm;
  info.z = inf;
  info.w = iC.z;
#else
  // ---- ribbon eels: a travelling wave down a long flat body -------------------------------------
  float L = iB.x;
  float wph = iB.z;
  vec3 p = pos;
  float t = aP.y;
  float wv = sin(t * 8.5 - wph) * (0.05 + 0.16 * t);
  p *= vec3(0.6 + L * 0.25, 0.6 + L * 0.25, L);
  p.x += wv * L * 0.5;
  if (part > 50.5) p.x += sin(t * 40.0 - uTime * 9.0) * 0.025 * aP.z * L;
  mat3 O = R * rotX(-iC.x) * rotZ(iC.y);
  W = base + O * p;
  nrm = O * nrm;
  info.z = iB.w;
  info.w = t;
#endif
  // creatures and plants at the edge of the living radius grow in and out instead of popping
  float fade = 1.0 - smoothstep(uFade.z, uFade.w, length(base.xz - uFade.xy));
  W = base + (W - base) * fade;
  vWorldPos = W;
  vN = nrm;
  vP = aP;
  vI = info;
  gl_Position = projectionMatrix * viewMatrix * vec4(W, 1.0);
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
uniform vec3 uTintA;
uniform vec3 uGlow;
varying vec3 vWorldPos;
varying vec3 vN;
varying vec4 vP;
varying vec4 vI;
varying vec3 vLoc;

vec3 hue(float h) { return 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67))); }

void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamPos - vWorldPos);
  float part = floor(vP.x + 0.5);
  float seed = vI.x;
  vec3 albedo = uTintA;
  vec3 emis = vec3(0.0);
  float trans = 0.2, spec = 0.15, gloss = 0.5, rim = 0.5, wrap = 0.22, ao = 1.0, alpha = 1.0;
  float glowK = 0.5 + 1.4 * uNight;
  float hs = fract(seed * 7.13);

#if KIND == 0
  float t = vI.w;
  if (part < 0.5) {
    albedo = mix(vec3(0.16, 0.13, 0.05), vec3(0.42, 0.33, 0.1), t);
    ao = mix(0.55, 1.0, t);
  } else if (part < 1.5) {
    float u = vP.z, w = abs(vP.w);
    // blades: olive-gold near the stalk to amber and teal, a dark midrib, glowing edges
    vec3 a = mix(vec3(0.32, 0.2, 0.03), vec3(0.1, 0.22, 0.08), hs);
    vec3 b = mix(vec3(0.75, 0.42, 0.06), vec3(0.42, 0.55, 0.12), hs);
    albedo = mix(a, b, u) * (0.85 + 0.15 * sin(u * 40.0 + vLoc.y * 9.0 + vnoise(vec2(u * 12.0, vP.w * 3.0 + seed * 7.0)) * 2.4));
    albedo *= mix(0.7, 1.0, smoothstep(0.05, 0.3, w));
    trans = 0.75;
    rim = 0.55;
    ao = mix(0.6, 1.0, u);
    emis = mix(vec3(0.1, 0.8, 0.9), vec3(0.6, 0.3, 1.0), hs) * smoothstep(0.75, 1.0, w) * 0.25 * u;
  } else {
    // gas bladders: pearly, glowing from within
    albedo = vec3(0.5, 0.36, 0.08);
    spec = 0.7; gloss = 0.8; trans = 0.6;
    emis = mix(vec3(0.15, 0.85, 1.0), vec3(0.75, 0.4, 1.0), hs) * (0.22 + 0.14 * sin(uTime * 1.7 + seed * 20.0 + t * 9.0));
  }
  // kelp near a passing whale glows brighter (stirred)
  emis *= 1.0 + vI.z * 2.0;
#elif KIND == 1
  float t = vI.w;
  vec3 c = hue(0.83 + hs * 0.35 + vP.z * 0.03);
  albedo = mix(vec3(0.35, 0.22, 0.3), c * 0.6, 0.5) * mix(0.5, 1.0, t);
  albedo *= 0.85 + 0.15 * sin(t * 30.0 + vnoise(vLoc.xz * 25.0 + vP.z) * 2.0);
  rim = 0.8; trans = 0.5;
  float lip = smoothstep(0.82, 0.98, t) * step(vP.w, 1.5);
  emis = c * lip * (0.6 + 0.4 * sin(uTime * 2.0 + vP.z * 1.3 + seed * 11.0)) * (1.0 + vI.z * 2.5);
  if (vP.w > 1.5) { albedo = vec3(0.02, 0.015, 0.03); emis = c * 0.25 * (1.0 + vI.z); }
#elif KIND == 2
  float t = vI.w;
  if (part < 4.5) {
    albedo = mix(vec3(0.4, 0.12, 0.18), vec3(0.15, 0.22, 0.35), hs);
  } else {
    vec3 c = mix(vec3(0.95, 0.4, 0.6), vec3(0.4, 0.9, 0.8), hs);
    albedo = mix(c * 0.35, c * 0.8, t);
    trans = 0.9; rim = 0.8;
    emis = c * smoothstep(0.7, 1.0, t) * 0.7 * (1.0 + vI.z * 1.5);
  }
#elif KIND == 3
  float t = vI.w;
  // spiral bands across the whorl, nacre at the mouth
  float wob = vnoise(vLoc.xz * 18.0 + t * 6.0) * 1.6 + vnoise(vLoc.xy * 31.0) * 0.6;
  float band = 0.5 + 0.5 * sin(t * 70.0 + atan(vLoc.z, vLoc.x) * 2.0 + wob);
  band = smoothstep(0.2, 0.8, band) * (0.75 + 0.25 * vnoise(vLoc.xz * 40.0));
  vec3 a = mix(vec3(0.72, 0.55, 0.42), vec3(0.6, 0.5, 0.65), hs);
  albedo = mix(a * 0.55, a, band) * mix(0.8, 1.0, t);
  spec = 0.5; gloss = 0.7;
  emis = vec3(0.3, 0.8, 1.0) * smoothstep(0.9, 1.0, t) * 0.15;
#elif KIND == 4
  // a lattice of veins: branching curves, discarded between
  vec2 uv = vec2(vP.z, vP.y);
  float a = (uv.x - 0.5) * 2.2;
  float r = uv.y;
  vec2 fw = vec2(vnoise(uv * 9.0 + hs * 7.0), vnoise(uv * 8.0 + 4.0)) - 0.5;
  float rays = abs(sin(a * 14.0 + sin(r * 6.0 + hs * 6.0) * 0.8 + fw.x * 2.2));
  float rings = abs(sin(r * 26.0 + sin(a * 5.0) * 1.2 + fw.y * 3.0));
  float vein = max(smoothstep(0.62, 0.86, 1.0 - rays), smoothstep(0.66, 0.9, 1.0 - rings) * step(0.15, r));
  vein = max(vein, smoothstep(0.75, 0.25, abs(uv.x - 0.5) * 2.0) * smoothstep(0.35, 0.0, r));
  float edge = smoothstep(0.92, 1.0, r);
  if (max(vein, edge) < 0.5) discard;
  vec3 c = mix(vec3(0.9, 0.35, 0.25), vec3(0.85, 0.65, 0.2), hs);
  albedo = c * 0.75;
  trans = 0.8; rim = 0.8;
  emis = c * 0.12 * edge;
#elif KIND == 5
  float variant = vI.y;
  float hide = vI.z;
  if (variant < 0.5) {
    // hermit: rusty red crab, a banded spiral shell
    albedo = part > 13.5 && part < 14.5 ? mix(vec3(0.6, 0.48, 0.38), vec3(0.3, 0.2, 0.25), 0.5 + 0.5 * sin(vP.y * 50.0)) : vec3(0.55, 0.15, 0.08);
    spec = 0.35;
    if (part > 12.5 && part < 13.5 && vP.y > 0.9) emis = vec3(0.2, 1.0, 0.7);
    if (part > 14.5) emis = vec3(0.9, 0.5, 0.2) * 0.4;
  } else if (variant < 1.5) {
    // glass crab: a pale translucent shell with a glowing heart
    albedo = vec3(0.55, 0.7, 0.75);
    trans = 1.4; rim = 1.3; spec = 0.9; gloss = 0.9;
    float core = part < 10.5 ? exp(-dot(vLoc.xz, vLoc.xz) * 40.0) : 0.0;
    emis = vec3(0.3, 0.8, 1.0) * (core * 1.2 + (part > 14.5 ? 0.6 : 0.0));
    if (part > 12.5 && part < 13.5 && vP.y > 0.9) emis = vec3(1.0, 0.6, 0.9);
  } else {
    // armoured plate crab: dark slate plates, glowing joints
    // plate seams as pen strokes: domain-warped, varying in width, broken here and there
    vec2 wq = vLoc.xz * 9.0 + vec2(vnoise(vLoc.xz * 14.0 + seed * 9.0), vnoise(vLoc.zx * 13.0 + 3.0)) * 0.9;
    float seamW = 0.06 + 0.08 * vnoise(vLoc.xz * 21.0 + 5.0);
    float plates = smoothstep(0.0, seamW, abs(sin(wq.y * 2.4 + wq.x * 0.6 + sin(wq.x * 1.7) * 0.5)));
    plates = max(plates, step(0.78, vnoise(vLoc.xz * 17.0 + 11.0)));
    albedo = mix(vec3(0.05, 0.06, 0.08), vec3(0.16, 0.18, 0.22), plates);
    spec = 0.5; gloss = 0.7;
    vec3 jc = vec3(1.0, 0.45, 0.1);
    if (part > 14.5) emis = jc * (0.7 + 0.8 * hide + 0.3 * sin(uTime * 3.0 + seed * 9.0));
    if (part > 9.5 && part < 10.5) emis = jc * (1.0 - plates) * 0.35 * (1.0 + hide);
    if (part > 12.5 && part < 13.5 && vP.y > 0.9) emis = vec3(1.0, 0.8, 0.3);
  }
  emis *= 1.0 + vI.w * 2.0;
#elif KIND == 7
  // ray: dark ink-blue back with rows of glowing spots, a pale belly
  float top = step(0.0, vP.w);
  float u = vI.w;
  float spots = 0.0;
  if (part < 30.5) {
    vec2 q = vec2(abs(vLoc.x) * 7.0, vLoc.z * 7.0);
    vec2 cell = fract(q) - 0.5;
    float onRow = step(0.45, hash12(floor(q) + seed));
    spots = onRow * smoothstep(0.24, 0.12, length(cell)) * smoothstep(0.98, 0.5, abs(u));
  }
  vec3 back = mix(vec3(0.03, 0.06, 0.12), vec3(0.1, 0.05, 0.14), hs);
  vec3 belly = vec3(0.7, 0.72, 0.75);
  albedo = mix(belly, back, top);
  albedo += vec3(0.2, 0.3, 0.4) * (1.0 - abs(u)) * 0.12 * top;
  spec = 0.4; gloss = 0.7; rim = 0.9; trans = 0.3;
  vec3 sc = mix(vec3(0.2, 0.9, 1.0), vec3(0.6, 0.4, 1.0), hs);
  emis = sc * spots * top * (0.8 + 0.4 * sin(uTime * 1.5 + vLoc.z * 6.0)) * (1.0 + vI.z * 2.0);
  emis += sc * smoothstep(0.85, 1.0, abs(u)) * 0.25 * top;
#elif KIND == 8
  float inf = vI.z;
  if (part < 40.5) {
    // mottled sand-gold with dark saddles, a pale belly
    float saddle = smoothstep(0.3, 0.7, sin(vLoc.z * 30.0) * 0.5 + 0.5) * step(0.0, vLoc.y);
    albedo = mix(vec3(0.75, 0.6, 0.3), vec3(0.2, 0.18, 0.12), saddle * 0.7);
    albedo = mix(albedo, vec3(0.85, 0.85, 0.75), smoothstep(0.0, -0.12, vLoc.y));
    spec = 0.4; rim = 0.6;
    emis = vec3(0.1, 0.5, 0.6) * inf * 0.3;
  } else if (part < 41.5) {
    // the lanterns: big glowing eyes with a dark pupil
    float pupil = smoothstep(0.75, 0.9, vP.w);
    albedo = vec3(0.05);
    emis = mix(vec3(0.3, 1.0, 0.8), vec3(0.02), pupil) * (1.0 + inf * 1.5 + vI.w);
    spec = 1.0; gloss = 0.95;
  } else if (part < 42.5) {
    albedo = vec3(0.6, 0.55, 0.4); trans = 1.0;
  } else {
    albedo = vec3(0.9, 0.8, 0.6);
    emis = vec3(0.3, 0.9, 1.0) * inf * 0.5;
  }
#elif KIND == 9
  float t = vI.w;
  vec3 c = mix(vec3(0.15, 0.25, 0.9), vec3(0.85, 0.75, 0.15), hs);
  float stripe = smoothstep(0.3, 0.6, sin(t * 60.0 + vnoise(vec2(t * 20.0, vLoc.y * 30.0 + seed * 9.0)) * 2.5) * 0.5 + 0.5);
  albedo = mix(c * 0.35, c, stripe);
  if (part > 50.5) { albedo = mix(vec3(0.9, 0.85, 0.3), c, 0.4); trans = 1.0; emis = c * 0.25 * vP.z; }
  spec = 0.6; gloss = 0.8; rim = 0.8;
  emis += vec3(0.4, 0.9, 1.0) * smoothstep(0.03, 0.0, t) * 0.8;
  emis *= 1.0 + vI.z * 2.0;
#endif

#if KIND == 6
  // jellies: additive glass, lit at the rim and from their glowing organs
  float fres = pow(1.0 - abs(dot(N, V)), 2.0);
  vec3 c = mix(uGlow, hue(0.55 + hs * 0.4), 0.5);
  float pulse = vI.w;
  float flare = vI.z;
  vec3 col;
  if (part < 20.5) {
    float rimK = vP.y;
    float ribs = smoothstep(0.6, 1.0, abs(sin(vP.z * 6.2831 * 8.0)));
    col = c * (0.08 + fres * 0.7 + ribs * 0.12 * rimK + smoothstep(0.85, 1.0, rimK) * 0.6);
    col += uSunColor * 0.06 * max(dot(N, uSunDir), 0.0);
  } else if (part < 21.5) {
    col = mix(c, vec3(1.0, 0.5, 0.8), 0.5) * (0.6 + 0.4 * pulse);
  } else if (part < 22.5) {
    col = c * (0.25 + 0.3 * fres);
  } else {
    col = c * 0.35 * (1.0 - vP.y * 0.7);
  }
  col *= (0.55 + 1.3 * uNight) * (1.0 + flare * 2.5) * (0.8 + 0.5 * pulse);
  // through the water: glow fades with the path, and the surface dims it seen from above
  float dist = length(vWorldPos - uCamPos);
  vec3 T = exp(-uWaterAbsorb * dist * mix(0.0, 1.0, uUnderwater) * 0.8);
  float above = (1.0 - uUnderwater) * step(vWorldPos.y, uSeaLevel);
  T *= mix(vec3(1.0), exp(-uWaterAbsorb * max(uSeaLevel - vWorldPos.y, 0.0) * 2.0) * 0.5, above);
  gl_FragColor = vec4(col * T, 1.0);
#else
  Surface sf = makeSurface(albedo, N, vWorldPos);
  sf.ao = ao; sf.rim = rim; sf.trans = trans; sf.spec = spec; sf.gloss = gloss; sf.wrap = wrap;
  sf.emissive = emis * glowK;
  vec3 col = stylizedLight(sf);
  vec3 lit = col;
  col = applyFog(col, vWorldPos);
  // bioluminescence carries through the dark water further than reflected light
  float dist = length(vWorldPos - uCamPos);
  // painterly vividness: close to the eye under water the reef keeps some of its own colour
  // (the absorption would otherwise wash every creature to the same teal)
  col = mix(col, lit * vec3(0.95, 0.9, 0.85), 0.4 * exp(-dist / 14.0) * uUnderwater);
  col += emis * glowK * exp(-dist * 0.035) * 0.5 * smoothstep(0.0, 0.5, uUnderwater + uNight);
  gl_FragColor = vec4(col, alpha);
#endif
}
`;

/** One material per kind. actors: makeActors(); fade: Vector4(focus x, z, fade start r, end r). */
export function reefMaterial(kind, actors, fade = null) {
  const k = KIND[kind];
  const jelly = kind === 'jelly';
  const params = {
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: { KIND: k },
    uniforms: Object.assign({}, G, {
      uActors: { value: actors },
      uFade: { value: fade || new Vector4(0, 0, 1e6, 2e6) },
      uTintA: { value: new Color(0.5, 0.5, 0.5) },
      uGlow: { value: new Color(0.3, 0.8, 1.0) },
    }),
    side: kind === 'kelp' || kind === 'fan' || kind === 'eel' || jelly ? DoubleSide : FrontSide,
  };
  if (jelly) Object.assign(params, { transparent: true, depthWrite: false, blending: AdditiveBlending });
  return new ShaderMaterial(params);
}

export function makeActors() { return [new Vector4(), new Vector4(), new Vector4(), new Vector4()]; }

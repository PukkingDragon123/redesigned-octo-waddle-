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

export const KIND = { kelp: 0, tubes: 1, anemone: 2, shell: 3, fan: 4, jelly: 6, ray: 7, rayFar: 7, puffer: 8, eel: 9 };

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

// the puffer's stomach balloons: belly most, the head and the peduncle hardly at all
float puffW(vec3 p) { return smoothstep(-0.2, -0.06, p.z) * (1.0 - smoothstep(0.17, 0.27, p.z)); }
vec3 puff(vec3 p, float inf) {
  float w = puffW(p);
  vec3 c = vec3(0.0, 0.0, 0.02);
  vec3 d = p - c;
  float r = length(d);
  float R0 = 0.265 + 0.03 * smoothstep(0.0, -0.15, d.y);
  vec3 q = mix(p, c + d / max(r, 1e-4) * R0, inf * 0.85 * w);
  q.y -= inf * 0.025 * w;
  return q;
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
    // a blade right at the lens folds away to a sliver (it never fills the frame as a flat sheet)
    float camD = length(spine - uCamPos);
    local *= mix(0.12, 1.0, smoothstep(1.2, 4.5, camD));
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
  // ---- mantas: slow wing beats as a wave running from the leading edge out to the tips (the tips
  // lag and curl), the inner wing beating less in a turn; cephalic lobes rolled into horns while
  // cruising, unfurled into a funnel (and the mouth agape) when feeding; the whip tail trails.
  float flap = iB.z;
  float fg = iB.w;
  float giant = step(1.5, fg);
  float feed = clamp(fg - giant * 2.0, 0.0, 1.0);
  float amp = iC.z;
  float turn = clamp(iC.w, -1.0, 1.0);
  vec3 p = pos;
  float heave = sin(flap + 0.5) * 0.02 * amp;
  float thin = 0.0;
  if (part < 30.5) {
    float u = aP.z, au = abs(u), v = aP.y, side = u < 0.0 ? -1.0 : 1.0;
    // the terminal mouth: the lower jaw drops when feeding
    float mz = (1.0 - smoothstep(0.085, 0.125, au)) * (1.0 - smoothstep(0.0, 0.05, v));
    p.y -= mz * feed * 0.05 * smoothstep(0.0, -0.2, aP.w);
    p.y += mz * feed * 0.008 * smoothstep(0.0, 0.2, aP.w);
    // wings: bend about a hinge beside the body; the bend grows outward (the outer wing curves)
    float r = max(au - 0.17, 0.0);
    float a = amp * (1.0 - 0.4 * turn * side);
    float wph = flap - r * 1.7 - v * 0.95;
    float th = (sin(wph) * 0.5 + 0.08) * a * smoothstep(0.0, 0.3, r);
    th += sin(wph - 1.0) * 0.42 * a * smoothstep(0.4, 0.83, r);
    // the trailing edge flutters a little in the wake
    th += sin(uTime * 3.1 + seed * 7.0 - au * 6.0) * 0.03 * smoothstep(0.7, 1.0, v) * smoothstep(0.2, 0.6, r);
    vec3 hinge = vec3(side * 0.17, 0.0, p.z);
    mat3 Rz = rotZ(side * th);
    p = hinge + Rz * (p - hinge);
    nrm = Rz * nrm;
    thin = 1.0 - smoothstep(0.004, 0.035, aQ.x);
  } else if (part < 31.5) {
    // cephalic lobes: a sheet attached along its top edge, rolled up like a horn or unfurled
    float t = aP.y, c = aP.z, side = aP.w;
    float curl = (1.0 - feed * 0.92) * (0.93 + 0.07 * sin(uTime * 0.8 + seed * 9.0 + side * 1.7));
    vec3 root = vec3(side * 0.125, -0.006, 0.452);
    vec3 f = normalize(vec3(-side * mix(0.04, 0.2, feed), mix(-0.1, -0.5, feed), 1.0));
    vec3 d = vec3(side * mix(0.35, 0.15, feed), -1.0, 0.0);
    d = normalize(d - f * dot(d, f));
    vec3 nn = normalize(cross(f, d)) * side;
    float L = mix(0.16, 0.2, feed);
    float wdt = 0.07 * (0.9 - 0.4 * t * t) + 0.012;
    float s = c * wdt;
    float ang = curl * c * (4.0 + 2.2 * c) * (1.0 - 0.2 * t);
    float sc = ang > 1e-3 ? sin(ang) / ang : 1.0;
    float cc = ang > 1e-3 ? (1.0 - cos(ang)) / ang : 0.0;
    p = root + f * (t * L) + (d * sc + nn * cc) * s;
    p.y += sin(uTime * 1.9 + t * 3.0 + seed * 5.0) * 0.008 * t * (0.3 + feed);
    vec3 tg = d * cos(ang) + nn * sin(ang);
    nrm = normalize(cross(f, tg)) * side;
    thin = 0.8;
  } else if (part < 32.5) {
    // the tail trails: a lazy sway, bent out of the turn, the beat arriving late
    float t = aP.y;
    p.x += sin(uTime * 1.4 + t * 4.0 + seed * 3.0) * 0.06 * t * t - turn * 0.22 * t * t;
    p.y += sin(flap - 1.8 - t * 2.6) * 0.07 * t * amp;
  } else if (part > 34.5) {
    p.y += sin(flap - 1.2) * 0.012 * aP.y * amp;
  }
  p.y += heave;
  mat3 O = R * rotX(-iC.x) * rotZ(iC.y);
  W = base + O * (p * iB.x);
  nrm = O * nrm;
  info.y = feed + giant * 2.0;
  info.z = thin;
  info.w = aP.z;
#elif KIND == 8
  // ---- lantern puffers: scull along on dorsal and anal fins, pectorals whirring; startled, the
  // belly balloons (the head and tail stay put) and the prickles rise out of their pockets -------
  float inf = iB.w;
  float ph = iB.z;
  vec3 p = pos;
  vec3 hinge = aQ.xyz;
  if (part < 40.5 || part > 43.5) {
    float w = puffW(p);
    nrm = normalize(mix(nrm, normalize(p - vec3(0.0, 0.0, 0.02)), inf * 0.8 * w));
    p = puff(p, inf);
    // the beak and lips work as it breathes (water over the gills)
    if (part > 43.5 || p.z > 0.25) {
      float br = sin(uTime * 2.6 + seed * 11.0) * 0.5 + 0.5;
      p.y += (p.y + 0.038) * 0.12 * br * smoothstep(0.25, 0.275, pos.z);
    }
  } else if (part < 41.5) {
    // the eyes swivel independently in their orbits
    vec3 rel = p - hinge;
    float side = aQ.w;
    float look = 0.28 * sin(uTime * 0.53 + seed * 9.0 + side * 1.7) + 0.12 * sin(uTime * 1.37 + side);
    rel = rotY(look) * rel;
    nrm = rotY(look) * nrm;
    p = puff(hinge, inf) + rel * (1.0 + 0.15 * inf);
  } else if (part < 42.5) {
    vec3 rel = p - hinge;
    float s = aP.y, u = aP.z, id = aP.w, side = aQ.w;
    if (id < 0.5) {
      // the tail: a slow rudder, curled aside when puffed up
      float a = sin(ph * 0.35 + seed * 3.0) * 0.18 + inf * 0.7;
      rel.x += (sin(ph * 0.35 - s * 1.5) * 0.02 + inf * 0.05) * s;
      rel = rotY(a * 0.5) * rel;
      rel.y *= mix(0.86, 1.0, s) - inf * 0.25;
    } else if (id < 2.5) {
      // dorsal and anal sculling in step: a wave runs back along each fin as it sweeps
      float sc = sin(ph - u * 2.2 - s * 0.8);
      rel.x += sc * 0.045 * s * (0.6 + 0.4 * s);
    } else {
      // pectorals: fast fanning, a ripple running across the rays
      float f = uTime * 13.0 + seed * 7.0 + side;
      rel = rotY(side * (0.32 * sin(f) - 0.25)) * rel;
      rel.x += side * sin(f - u * 4.0 - s * 1.5) * 0.018 * s;
    }
    p = puff(hinge, inf) + rel;
  } else {
    // prickles: lying back in their skin pockets, erect when inflated
    vec3 root = hinge;
    vec3 n = normalize(vec3(aP.z, aP.w, aQ.w));
    vec3 rel = p - root;
    vec3 ax = cross(n, vec3(0.0, 0.0, -1.0));
    float la = length(ax);
    float fold = (1.0 - smoothstep(0.15, 0.85, inf)) * 1.35;
    if (la > 1e-3) { rel = rotAxis(rel, ax / la, fold); nrm = rotAxis(nrm, ax / la, fold); }
    rel *= mix(0.42, 1.0, smoothstep(0.1, 0.9, inf));
    p = puff(root, inf) + rel;
  }
  mat3 O = R * rotX(-iC.x) * rotZ(iC.y);
  W = base + O * (p * iB.x);
  nrm = O * nrm;
  info.z = inf;
  info.w = iC.z;
#else
  // ---- ribbon eels: an anguilliform wave runs the whole length; the fins ripple ----------------
  float L = iB.x;
  float wph = iB.z;
  vec3 p = pos;
  float t = aP.y;
  float alarm = iB.w;
  float k = 6.2831853 * 1.7;
  float amp = (0.018 + 0.085 * t) * (1.0 + alarm * 0.5);
  float w = k * t - wph;
  float X = amp * sin(w);
  float dX = 0.085 * (1.0 + alarm * 0.5) * sin(w) + amp * k * cos(w);
  float zs = 0.5 - t;
  float sl = -dX;
  float c = inversesqrt(1.0 + sl * sl), sn = sl * c;
  if (part > 50.5 && part < 51.5) p.x += sin(t * 70.0 - uTime * 11.0 + aP.w) * 0.0022 * aP.z;
  if (part > 52.5) {
    // nostril flaps and barbels tremble in the flow
    p.x += sin(uTime * 9.0 + aP.w * 2.0 + seed * 5.0) * 0.0008 * aP.y;
  }
  vec3 q = vec3(p.x, p.y, p.z - zs);
  p = vec3(X + q.x * c + q.z * sn, q.y + 0.004 * sin(w * 0.5 + 1.0) * t, zs - q.x * sn + q.z * c);
  nrm = vec3(nrm.x * c + nrm.z * sn, nrm.y, -nrm.x * sn + nrm.z * c);
  mat3 O = R * rotX(-iC.x) * rotZ(iC.y);
  W = base + O * (p * L);
  nrm = O * nrm;
  info.z = alarm;
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
// manta planform (reefGeo.js mantaLE / mantaTE): leading and trailing edge z at |x| = u
float mantaLE(float u) { return u < 0.2 ? 0.47 - 0.09 * smoothstep(0.08, 0.2, u) : 0.38 - 0.6 * pow(max((u - 0.2) / 0.8, 0.0), 1.45); }
float mantaTE(float u) { return -0.45 + 0.23 * u + 0.17 * sin(3.14159265 * pow(max(u, 0.0), 0.8)) * smoothstep(0.0, 0.35, u); }

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
  vec3 kelpBack = vec3(0.0);

#if KIND == 0
  float t = vI.w;
  if (part < 0.5) {
    albedo = mix(vec3(0.16, 0.13, 0.05), vec3(0.42, 0.33, 0.1), t);
    ao = mix(0.55, 1.0, t);
  } else if (part < 1.5) {
    float u = vP.z, sw = vP.w, w = abs(sw);
    // ruffled, rippled margins: the edge wanders in and out along the blade (never a straight cut)
    float ruff = 0.8 + 0.1 * sin(u * 47.0 + seed * 9.0 + sign(sw) * 1.7) + 0.06 * sin(u * 113.0 + seed * 4.0)
               + 0.04 * vnoise(vec2(u * 60.0, sign(sw) * 5.0 + seed * 11.0));
    ruff *= smoothstep(1.02, 0.9, u) * 0.35 + 0.65;
    if (w > ruff) discard;
    float edgeK = smoothstep(ruff - 0.16, ruff, w);
    // corrugated blade: bullate blisters running across it catch and lose the light
    float corr = sin(u * 70.0 + w * 6.0 + vnoise(vec2(u * 18.0, sw * 2.0 + seed)) * 3.0);
    N = normalize(N + (vec3(0.0, 1.0, 0.0) - N * N.y) * corr * 0.18);
    // colour: dark olive-brown at the base, golden amber in the body, paler worn tips; each plant its
    // own shade, mottled along every blade
    vec3 baseC = mix(vec3(0.14, 0.09, 0.03), vec3(0.08, 0.1, 0.04), hs);
    vec3 bodyC = mix(vec3(0.52, 0.32, 0.07), vec3(0.4, 0.38, 0.1), hs);
    vec3 tipC = mix(vec3(0.62, 0.5, 0.2), vec3(0.5, 0.52, 0.24), hs);
    albedo = mix(baseC, bodyC, smoothstep(0.0, 0.35, u));
    albedo = mix(albedo, tipC, smoothstep(0.7, 1.0, u));
    albedo *= 0.85 + 0.3 * vnoise(vec2(u * 9.0 + seed * 13.0, sw * 1.5));
    albedo *= 0.88 + 0.12 * corr;
    // the midrib: a darker, slightly wandering vein that fades out toward the tip
    float rib = smoothstep(0.09, 0.0, abs(sw - 0.05 * sin(u * 9.0 + seed * 5.0))) * smoothstep(0.95, 0.4, u);
    albedo = mix(albedo, albedo * vec3(0.55, 0.5, 0.42), rib * 0.8);
    // thin, light-catching margins
    albedo = mix(albedo, tipC * 1.15, edgeK * 0.35);
    trans = 0.0;
    rim = 0.4;
    ao = mix(0.45, 1.0, smoothstep(0.0, 0.45, u)) * mix(0.75, 1.0, t);
    // backlight: sunlight through the blade glows warm amber, strongest at the thin margins and
    // weakest along the thick midrib
    float thinT = mix(1.0, 0.35, rib) * (0.75 + 0.5 * edgeK);
    float through = max(-dot(N, uSunDir), 0.0) * (0.35 + 0.9 * pow(max(dot(-V, uSunDir), 0.0), 3.0));
    kelpBack = albedo * vec3(1.25, 0.95, 0.45) * uSunColor * through * thinT * 0.55;
    emis = mix(vec3(0.1, 0.8, 0.9), vec3(0.6, 0.3, 1.0), hs) * edgeK * 0.12 * u;
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
  float rays = abs(sin(a * 14.0 + sin(r * 6.0 + hs * 6.0) * 0.8 + fw.x * 3.4));
  float rings = abs(sin(r * 26.0 + sin(a * 5.0) * 1.2 + fw.y * 4.4));
  // each strand swells and thins along its length, and some cross-links are broken (hand-drawn)
  float wv = 0.12 * (vnoise(uv * 14.0 + 3.0 + hs) - 0.5);
  float brk = smoothstep(0.22, 0.38, vnoise(uv * vec2(7.0, 11.0) + 9.0 + hs * 3.0));
  float vein = max(smoothstep(0.62 + wv, 0.86 + wv, 1.0 - rays), smoothstep(0.66 - wv, 0.9 - wv, 1.0 - rings) * step(0.15, r) * brk);
  vein = max(vein, smoothstep(0.75, 0.25, abs(uv.x - 0.5) * 2.0) * smoothstep(0.35, 0.0, r));
  float edge = smoothstep(0.92, 1.0, r);
  if (max(vein, edge) < 0.5) discard;
  vec3 c = mix(vec3(0.9, 0.35, 0.25), vec3(0.85, 0.65, 0.2), hs);
  albedo = c * 0.75;
  trans = 0.8; rim = 0.8;
  emis = c * 0.12 * edge;
#elif KIND == 7
  // manta: countershaded (a deep slate-indigo back with pale shoulder patches drawn by hand, a
  // white belly with this one's own dark spots and five pairs of gill slits), a soft sheen,
  // light through the thin wing margins, and bioluminescent beads along the wing edges at night
  float fg = vI.y;
  float giant = step(1.5, fg);
  float feed = clamp(fg - giant * 2.0, 0.0, 1.0);
  float thin = vI.z;
  float topK = vP.w;
  vec2 L2 = vLoc.xz;
  float ax = abs(L2.x);
  // hand-drawn wobble shared by every line on the body
  vec2 wob = vec2(vnoise(L2 * 23.0 + seed * 17.0), vnoise(L2.yx * 19.0 + 5.3 + seed * 11.0)) - 0.5;
  float zl = mantaLE(min(ax, 1.0)), zt = mantaTE(min(ax, 1.0));
  vec3 back = mix(vec3(0.03, 0.038, 0.07), vec3(0.045, 0.04, 0.085), hs);
  back = mix(back, vec3(0.018, 0.02, 0.03), giant * 0.7);
  back *= 0.85 + 0.3 * vnoise(L2 * 7.0 + seed * 3.0);
  // shoulder patches: a crescent set in from the leading edge, wide at the head, tapering out
  float dz = zl - L2.y + wob.x * 0.03;
  float pw = mix(0.1, 0.16, giant) * (1.0 - smoothstep(0.14, mix(0.5, 0.62, giant), ax + wob.y * 0.05));
  float pin = mix(0.06, 0.09, giant) + 0.012 * sin(ax * 13.0 + seed * 5.0);
  float pd = max(pin - dz, dz - pin - pw);
  float patchK = (1.0 - smoothstep(-0.006, 0.008, pd)) * smoothstep(0.08, 0.13, ax + wob.x * 0.02);
  vec3 pale = mix(vec3(0.42, 0.45, 0.5), vec3(0.78, 0.8, 0.82), giant);
  vec3 dorsal = mix(back, pale * (0.85 + 0.15 * vnoise(L2 * 30.0)), patchK * mix(0.75, 0.95, giant));
  // a soft ink line along the patch edge, swelling and thinning
  float inkW = 0.004 + 0.004 * vnoise(L2 * 17.0 + 2.0);
  dorsal *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, inkW, abs(pd))) * step(0.11, ax);
  // belly: white, the margins dusky with a ragged edge
  vec3 belly = vec3(0.8, 0.82, 0.84);
  float vv = clamp((zl - L2.y) / max(zl - zt, 0.01), 0.0, 1.0);
  float marg = max(smoothstep(0.72, 0.95, ax + wob.x * 0.08), smoothstep(0.8, 0.97, vv + wob.y * 0.1) * smoothstep(0.2, 0.4, ax));
  belly = mix(belly, back * 2.2 + 0.04, marg * 0.85);
#ifndef RAY_FAR
  // this individual's belly spots (blotchy, scattered between the gills and the vent)
  vec2 sq = L2 * 9.0 + wob * 0.45 + seed * 37.0;
  vec2 sc = floor(sq);
  float spot = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cc = sc + vec2(float(i), float(j));
    vec2 h = vec2(hash12(cc), hash12(cc + 7.7));
    float has = step(0.7, hash12(cc + 3.1));
    float rr = 0.14 + 0.22 * h.y;
    spot = max(spot, has * (1.0 - smoothstep(rr * 0.75, rr, length(sq - cc - h))));
  }
  spot *= (1.0 - smoothstep(0.32, 0.45, ax)) * smoothstep(-0.42, -0.25, L2.y) * (1.0 - smoothstep(0.2, 0.32, L2.y));
  belly = mix(belly, vec3(0.08, 0.08, 0.1), spot * 0.85);
  // five pairs of gill slits: short curved strokes, tapered at both ends
  float gk = clamp(floor((0.29 - L2.y) / 0.034 + 0.5), 0.0, 4.0);
  float gx = clamp((ax - 0.075) / 0.085, 0.0, 1.0);
  float gz = 0.29 - gk * 0.034 - 0.02 * gx + 0.018 * (gx - 0.5) * (gx - 0.5) + wob.x * 0.006;
  float gw = 0.0045 * pow(sin(3.14159 * gx), 0.7) * (1.0 - 0.15 * gk) * (0.7 + 0.6 * vnoise(vec2(ax * 40.0, gk)));
  float gill = (1.0 - smoothstep(gw * 0.5, gw, abs(L2.y - gz))) * step(0.075, ax) * step(ax, 0.16);
  belly = mix(belly, vec3(0.12, 0.1, 0.12), gill);
#endif
  // the dark back wraps over the rims (leading edge, tips and the tail root) onto the belly a little
  float topW = smoothstep(-0.6, -0.15, topK + wob.y * 0.3);
  albedo = mix(belly, dorsal, topW);
  // the mouth: a dark slot across the front of the head, a gaping funnel when feeding
  if (part < 30.5) {
    float mouth = (1.0 - smoothstep(0.095, 0.12, ax + wob.x * 0.01)) * (1.0 - smoothstep(0.1 + feed * 0.55, 0.16 + feed * 0.6, abs(topK + 0.08)));
    mouth *= 1.0 - smoothstep(0.0, 0.035 + feed * 0.04, vP.y);
    albedo = mix(albedo, vec3(0.025, 0.02, 0.03), mouth);
  }
  if (part > 30.5 && part < 31.5) albedo = mix(dorsal, belly * 0.7, 0.35);
  if (part > 31.5 && part < 32.5) albedo = back * 1.1;
  if (part > 32.5 && part < 33.5) {
    // eyes: dark and glossy, a faint golden ring
    vec3 en = normalize(vLoc - vec3(sign(vLoc.x) * 0.19, 0.012, 0.36));
    float side = abs(en.x);
    albedo = mix(vec3(0.05, 0.04, 0.035), vec3(0.01), smoothstep(0.6, 0.8, side));
    albedo += vec3(0.25, 0.18, 0.06) * smoothstep(0.45, 0.55, side) * (1.0 - smoothstep(0.6, 0.7, side));
    spec = 1.0; gloss = 0.95;
  } else { spec = 0.32; gloss = 0.62; }
  if (part > 33.5) albedo = back;
  rim = 0.55; wrap = 0.24;
  trans = 0.15 + 1.1 * thin;
  // bioluminescent beads in rows along the leading and trailing edges of the outer wings
  float rowL = abs(dz - 0.028 - wob.y * 0.004);
  float cL = (fract(ax / 0.042 + wob.x * 0.2) - 0.5) * 0.042;
  float beadL = (1.0 - smoothstep(0.004, 0.009, length(vec2(cL, rowL)))) * smoothstep(0.28, 0.4, ax) * (1.0 - smoothstep(0.92, 0.98, ax));
  float dzt = L2.y - zt;
  float cT = (fract(ax / 0.05 + 0.5 + wob.y * 0.2) - 0.5) * 0.05;
  float beadT = (1.0 - smoothstep(0.003, 0.008, length(vec2(cT, abs(dzt - 0.022))))) * smoothstep(0.35, 0.5, ax) * (1.0 - smoothstep(0.9, 0.97, ax));
  float bead = max(beadL, beadT) * smoothstep(-0.2, 0.3, topK);
  float nightK = smoothstep(0.3, 0.8, uNight);
  vec3 bc = mix(vec3(0.25, 0.85, 1.0), vec3(0.55, 0.45, 1.0), hs);
  emis = bc * bead * nightK * (0.55 + 0.45 * sin(uTime * 1.1 - ax * 9.0 + seed * 20.0)) * 1.4;
  emis += bc * 0.05 * nightK * smoothstep(0.85, 1.0, ax) * topW;
#elif KIND == 8
  // ---- lantern puffer: a map-puffer maze of hand-drawn dark lines over olive-gold skin, a pale
  // belly with wavy pinstripes, photophores that wake at night or when it puffs up, glossy eyes
  float inf = vI.z;
  vec3 Lc = vLoc;
  float dep = uSeaLevel - vWorldPos.y;
  if (part < 40.5) {
    float t = vP.y;
    float topK = smoothstep(-0.06, 0.07, Lc.y - 0.012 * sin(Lc.z * 31.0 + seed * 6.0));
    vec3 back = mix(vec3(0.2, 0.18, 0.08), vec3(0.27, 0.22, 0.1), hs);
    vec3 belly = vec3(0.8, 0.79, 0.7);
    albedo = mix(belly, back, topK);
    // the maze: warped noise iso-lines, thick here and thin there, broken into strokes
    vec2 mp = vec2(Lc.z * 19.0, atan(Lc.x, Lc.y + 0.01) * 2.8);
    vec2 wq = mp + vec2(vnoise(mp * 1.7 + seed * 13.0), vnoise(mp * 1.7 + 4.1)) * 0.9;
    float iso = abs(fract(vnoise(wq * 1.3) * 3.2 + vnoise(wq * 3.1) * 0.35) - 0.5);
    float wid = 0.07 + 0.06 * vnoise(wq * 2.3 + 7.0);
    float maze = smoothstep(wid, wid * 0.35, iso) * smoothstep(0.18, 0.55, vnoise(wq * 0.9 + 2.0) + 0.25);
    maze *= smoothstep(-0.11, 0.0, Lc.y) * smoothstep(-0.215, -0.17, Lc.z);
    albedo = mix(albedo, vec3(0.05, 0.045, 0.03), maze * 0.85);
    // lines radiate from the eye (puffers wear them like a sunburst)
    vec2 eo = vec2(Lc.z - 0.17, Lc.y - 0.094);
    float er = length(eo);
    float rays = smoothstep(0.65, 0.95, sin(atan(eo.y, eo.x) * 9.0 + vnoise(eo * 60.0) * 2.0)) * smoothstep(0.04, 0.05, er) * smoothstep(0.11, 0.06, er) * step(0.05, abs(Lc.x));
    albedo = mix(albedo, vec3(0.04), rays * 0.8);
    // dark saddles over the back
    float sad = smoothstep(0.35, 0.75, sin(Lc.z * 22.0 + 1.2 + vnoise(Lc.xz * 18.0) * 1.5)) * smoothstep(0.04, 0.12, Lc.y);
    albedo = mix(albedo, back * 0.35, sad * 0.55);
    // belly: fine wavy pinstripes, and a dusky chin
    float pin = smoothstep(0.35, 0.0, abs(fract(Lc.y * 70.0 + sin(Lc.z * 40.0 + Lc.x * 30.0) * 0.6 + vnoise(Lc.xz * 30.0) * 0.8) - 0.5) - 0.1) * (1.0 - topK) * smoothstep(0.24, 0.16, Lc.z);
    albedo = mix(albedo, vec3(0.32, 0.3, 0.24), pin * 0.45);
    // pale spots on the flanks
    vec2 sp = vec2(Lc.z * 34.0, Lc.y * 34.0 + sign(Lc.x) * 0.5);
    vec2 cell = floor(sp), f = fract(sp) - 0.5;
    vec2 jt = hash22(cell + seed * 7.0) - 0.5;
    float spot = smoothstep(0.2, 0.11, length(f - jt * 0.5)) * step(0.45, hash12(cell + 3.0)) * topK * (1.0 - maze);
    albedo = mix(albedo, vec3(0.85, 0.82, 0.62), spot * 0.7);
    // photophores: a dotted line along each flank and round the lips
    float lineY = 0.02 - 0.07 * smoothstep(0.2, -0.2, Lc.z) + 0.006 * sin(Lc.z * 25.0 + seed * 4.0);
    float dots = smoothstep(0.3, 0.1, length(vec2(fract(Lc.z * 26.0) - 0.5, (Lc.y - lineY) * 26.0))) * smoothstep(-0.19, -0.12, Lc.z) * smoothstep(0.2, 0.12, Lc.z);
    vec3 lum = mix(vec3(0.25, 0.95, 0.85), vec3(0.6, 1.0, 0.45), hs);
    emis += lum * dots * (0.12 + 1.4 * uNight + 1.6 * inf);
    // gill slit: a dark crescent before the pectoral base
    float gz = Lc.z - 0.09 - 0.012 * (Lc.y - 0.02) * (Lc.y - 0.02) * 400.0 * 0.03;
    float gill = smoothstep(0.0045, 0.0015, abs(gz)) * smoothstep(0.045, 0.02, abs(Lc.y - 0.012)) * step(0.12, abs(Lc.x));
    albedo = mix(albedo, vec3(0.03, 0.02, 0.02), gill);
    // prickle pockets and leathery micro relief
    float pk = vnoise(Lc.zy * 160.0 + sign(Lc.x) * 9.0);
    albedo *= 0.9 + 0.2 * pk;
    vec3 bump = vec3(vnoise(Lc.yz * 140.0) - 0.5, vnoise(Lc.zx * 140.0 + 3.0) - 0.5, vnoise(Lc.xy * 140.0 + 7.0) - 0.5);
    N = normalize(N + bump * 0.22 * (1.0 - inf * 0.6));
    // stretched taut and pale when inflated
    albedo = mix(albedo, albedo * 1.25 + 0.04, inf * (1.0 - topK) * 0.6);
    spec = 0.55 + 0.25 * inf; gloss = 0.72; rim = 0.6; wrap = 0.26; trans = 0.12;
    ao = mix(0.65, 1.0, smoothstep(-0.14, 0.02, Lc.y));
    // caustics on the back in the shallows
    if (dep > 0.15 && N.y > 0.0 && uWaterParams.x > 0.0) {
      float sunUp = smoothstep(-0.05, 0.25, uSunDir.y) * (1.0 - uStorm * 0.7);
      emis += vec3(0.5, 0.7, 0.65) * uSunColor * waterCaustics(vWorldPos, dep) * 0.12 * N.y * sunUp * exp(-dep * 0.12) / max(glowK, 0.3);
    }
  } else if (part < 41.5) {
    // a glossy eye: dark pupil, a lantern-gold iris ring, cornea catchlight
    vec2 q = vP.zw;
    float d = length(q - vec2(0.05, 0.0));
    float pupil = smoothstep(0.42, 0.36, length((q - vec2(0.06, 0.02)) * vec2(0.85, 1.15)));
    float iris = smoothstep(0.92, 0.84, d);
    float stri = 0.75 + 0.25 * sin(atan(q.y, q.x) * 27.0 + d * 11.0 + vnoise(q * 9.0) * 2.0);
    vec3 irisC = mix(vec3(0.55, 0.4, 0.1), vec3(0.22, 0.4, 0.26), smoothstep(0.42, 0.85, d)) * stri;
    albedo = mix(vec3(0.05, 0.045, 0.03), irisC, iris);
    albedo = mix(albedo, vec3(0.006, 0.007, 0.01), pupil);
    emis = mix(vec3(0.2, 0.9, 0.7), vec3(0.0), pupil) * smoothstep(0.5, 0.8, d) * iris * (1.2 * uNight + 1.5 * inf);
    spec = 1.8; gloss = 0.97; rim = 0.9; trans = 0.0;
    // a fixed soft catchlight on the cornea (the bright water overhead)
    float cl = pow(max(dot(N, normalize(V + vec3(0.0, 0.9, 0.0))), 0.0), 120.0);
    emis += vec3(0.9, 0.95, 1.0) * cl * 1.2 / max(glowK, 0.3);
  } else if (part < 42.5) {
    // fins: translucent amber membranes with fine branching rays and a dusky margin
    float s = vP.y, u = vP.z, id = vP.w;
    float nR = id < 0.5 ? 13.0 : (id < 2.5 ? 9.0 : 11.0);
    float rr = u * (nR - 1.0) + 0.5;
    float split = s > 0.55 ? 2.0 : 1.0;
    float ray = smoothstep(0.38, 0.12, abs(fract(rr * split + 0.15 * sin(s * 6.0 + u * 5.0)) - 0.5)) * smoothstep(0.02, 0.12, s);
    float joints = 0.85 + 0.15 * smoothstep(0.6, 1.0, sin(s * 38.0));
    vec3 mem = mix(vec3(0.62, 0.5, 0.24), vec3(0.5, 0.46, 0.3), hs);
    albedo = mem * (1.0 - ray * 0.35 * joints);
    albedo = mix(albedo, vec3(0.12, 0.1, 0.06), smoothstep(0.82, 0.98, s) * 0.55);
    // the tail wears a dark crescent bar
    if (id < 0.5) albedo = mix(albedo, vec3(0.08, 0.07, 0.04), smoothstep(0.05, 0.0, abs(s - 0.62 - 0.04 * sin(u * 9.0))) * 0.7);
    trans = 1.1; spec = 0.4; gloss = 0.75; rim = 0.6; wrap = 0.4;
    // the edge: scalloped between ray tips, slightly ragged
    float edge = 0.94 + 0.05 * cos(rr * 6.2831853) + 0.02 * (vnoise(vec2(u * 30.0, seed * 9.0)) - 0.5);
    if (s > edge) discard;
  } else if (part < 43.5) {
    // prickles: ivory spines, darker at the base
    albedo = mix(vec3(0.3, 0.27, 0.16), vec3(0.88, 0.84, 0.7), vP.y);
    emis = vec3(0.3, 0.9, 1.0) * inf * 0.25 * vP.y;
    spec = 0.5; gloss = 0.8;
  } else if (part < 44.5) {
    // the beak: fused ivory tooth plates
    albedo = vec3(0.86, 0.82, 0.68) * (0.85 + 0.15 * sin(vP.y * 30.0));
    spec = 0.8; gloss = 0.85; rim = 0.5;
  } else {
    albedo = vec3(0.04, 0.02, 0.02);
    spec = 0.1;
  }
#elif KIND == 9
  // ---- ribbon eel: velvet skin (blue males, black juveniles, gold females), yellow fins with a
  // white margin and fine rays, a gold jaw and nostril leaves, a small glossy eye
  float t = vI.w;
  float alarm = vI.z;
  vec3 Lc = vLoc;
  float morph = hs;
  vec3 bodyC = morph < 0.55 ? vec3(0.02, 0.09, 0.42) : (morph < 0.8 ? vec3(0.025, 0.028, 0.04) : vec3(0.78, 0.62, 0.08));
  vec3 finC = morph < 0.8 ? vec3(0.95, 0.78, 0.08) : vec3(0.95, 0.85, 0.3);
  if (part < 50.5) {
    float topK = smoothstep(-0.006, 0.01, Lc.y);
    albedo = bodyC * mix(1.25, 0.75, topK);
    // a velvet sheen band along the upper flank
    albedo += bodyC * 0.35 * exp(-pow((Lc.y - 0.007) / 0.004, 2.0));
    // the head: gold jaw and a pale lip line drawn by hand
    float head = smoothstep(0.075, 0.03, t);
    float jaw = smoothstep(0.0, -0.004, Lc.y - 0.0015 * sin(t * 220.0 + seed * 5.0)) * head;
    albedo = mix(albedo, finC * 0.9, jaw * 0.85);
    float lip = smoothstep(0.0012, 0.0002, abs(Lc.y + 0.0018 + (0.5 - Lc.z) * 0.05 + 0.0004 * sin(Lc.z * 2000.0))) * smoothstep(0.035, 0.012, t);
    albedo = mix(albedo, vec3(0.02), lip);
    // gill pore and a faint lateral line of pores
    float ll = smoothstep(0.0009, 0.0, abs(Lc.y - 0.006 * (1.0 - t))) * smoothstep(0.55, 0.85, fract(t * 140.0 + 0.3 * sin(t * 30.0))) * smoothstep(0.08, 0.12, t);
    albedo = mix(albedo, albedo * 2.0 + 0.04, ll * 0.6);
    // velvet micro relief and mucus gloss
    N = normalize(N + (vec3(vnoise(Lc.zy * 900.0), vnoise(Lc.zx * 900.0 + 3.0), 0.0) - 0.5) * 0.12);
    spec = 0.75; gloss = 0.8; rim = 0.8; wrap = 0.24; trans = 0.25;
    emis += vec3(0.4, 0.9, 1.0) * ll * (0.3 * uNight + alarm * 1.2);
  } else if (part < 51.5) {
    float s = vP.z;
    float ray = smoothstep(0.35, 0.1, abs(fract(t * 260.0 + s * 0.4) - 0.5)) * smoothstep(0.05, 0.3, s);
    albedo = finC * (1.0 - ray * 0.3);
    float marg = smoothstep(0.72, 0.9, s + 0.06 * sin(t * 90.0 + seed * 7.0));
    albedo = mix(albedo, vec3(0.95, 0.95, 0.9), marg * 0.85);
    albedo = mix(albedo, bodyC, smoothstep(0.25, 0.0, s) * 0.6);
    trans = 1.2; spec = 0.4; gloss = 0.75; rim = 0.7; wrap = 0.4;
    emis += vec3(0.35, 0.95, 1.0) * marg * (0.25 * uNight + alarm * 0.9);
    float edge = 0.97 + 0.03 * cos(t * 260.0 * 6.2831853);
    if (s > edge) discard;
  } else if (part < 52.5) {
    vec2 q = vP.zw;
    float d = length(q);
    float pupil = smoothstep(0.5, 0.42, d);
    albedo = mix(finC * 0.8, vec3(0.005), pupil);
    albedo = mix(albedo, vec3(0.04), smoothstep(0.85, 1.0, d));
    spec = 1.8; gloss = 0.97; rim = 0.9;
    emis += vec3(0.9, 0.95, 1.0) * pow(max(dot(N, normalize(V + vec3(0.0, 0.9, 0.0))), 0.0), 90.0) * 1.2 / max(glowK, 0.3);
  } else {
    albedo = finC;
    trans = 1.0; spec = 0.4; rim = 0.8;
  }
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
    // radial canals drawn by hand (they wander and fade), four horseshoe gonads round the apex,
    // and a wobbling ring canal just inside the scalloped margin
    float az = vP.z * 6.2831;
    float wa = az + 0.06 * sin(rimK * 9.0 + az * 3.0 + hs * 6.0);
    float ribs = smoothstep(0.6, 1.0, abs(sin(wa * 8.0))) * smoothstep(0.1, 0.45, rimK);
    float lobes = smoothstep(0.55, 0.95, cos(az * 4.0 + 0.4 + 0.2 * sin(rimK * 12.0))) * smoothstep(0.12, 0.28, rimK) * smoothstep(0.58, 0.36, rimK);
    float ringC = smoothstep(0.035, 0.0, abs(rimK - 0.86 - 0.015 * sin(az * 11.0 + hs * 5.0)));
    col = c * (0.08 + fres * 0.7 + ribs * 0.12 * rimK + smoothstep(0.85, 1.0, rimK) * 0.6 + lobes * 0.22 + ringC * 0.3);
    col += uSunColor * 0.06 * max(dot(N, uSunDir), 0.0);
  } else if (part < 21.5) {
    col = mix(c, vec3(1.0, 0.5, 0.8), 0.5) * (0.6 + 0.4 * pulse);
  } else if (part < 22.5) {
    col = c * (0.25 + 0.3 * fres);
  } else {
    col = c * 0.35 * (1.0 - vP.y * 0.7);
  }
  col *= (1.1 + 1.2 * uNight) * (1.0 + flare * 2.5) * (0.8 + 0.5 * pulse);
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
#if KIND == 7
  // light through the thin wing margins and lobes (backlit or lit from the far side), and the
  // surface caustics dancing over the dark back in shallow water
  float tb7 = pow(max(dot(-V, uSunDir), 0.0), 2.0) + 0.4 * max(-dot(N, uSunDir), 0.0);
  col += vec3(0.16, 0.3, 0.38) * uSunColor * thin * tb7 * 0.45;
  float dep7 = uSeaLevel - vWorldPos.y;
#ifndef RAY_FAR
  if (dep7 > 0.15 && N.y > 0.05 && uWaterParams.x > 0.0) {
    float sunUp7 = smoothstep(-0.05, 0.25, uSunDir.y) * (1.0 - uStorm * 0.7);
    float cs7 = waterCaustics(vWorldPos, dep7);
    col += vec3(0.45, 0.65, 0.62) * uSunColor * cs7 * 0.11 * topW * N.y * sunUp7 * exp(-dep7 * 0.12) * smoothstep(0.15, 1.0, dep7);
  }
#endif
#endif
  col += kelpBack;
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
    defines: kind === 'rayFar' ? { KIND: k, RAY_FAR: 1 } : { KIND: k },
    uniforms: Object.assign({}, G, {
      uActors: { value: actors },
      uFade: { value: fade || new Vector4(0, 0, 1e6, 2e6) },
      uTintA: { value: new Color(0.5, 0.5, 0.5) },
      uGlow: { value: new Color(0.3, 0.8, 1.0) },
    }),
    side: kind === 'kelp' || kind === 'fan' || kind === 'eel' || kind === 'puffer' || kind === 'ray' || kind === 'rayFar' || jelly ? DoubleSide : FrontSide,
  };
  if (jelly) Object.assign(params, { transparent: true, depthWrite: false, blending: AdditiveBlending });
  return new ShaderMaterial(params);
}

export function makeActors() { return [new Vector4(), new Vector4(), new Vector4(), new Vector4()]; }

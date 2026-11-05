// Materials for the reef life (reefGeo.js meshes). One vertex / fragment program per KIND, all
// instanced with three vec4s per instance:
//   iA: world position (holdfast / body centre), yaw
//   iB: scale, seed, then two kind-specific values
//   iC: pitch, roll (fauna) or kind-specific state
// uActors (xyz position, w radius) are the whales nearest the camera: kelp parts around them,
// anemones close, tube corals retract and fans bend away, all on the GPU.
// Lit by stylizedLight and fogged by applyFog (water column, caustics, the underwater view);
// bioluminescence is added again after the fog so it carries through the dark water at night.
import { ShaderMaterial, DoubleSide, FrontSide, CustomBlending, OneFactor, OneMinusSrcAlphaFactor, AddEquation, Vector4, Color } from 'three';
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
varying vec4 vQ;
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

#if KIND == 6
// ---- jelly helpers: the species shape (0 a tall ribbed lantern, 1 a low crown of five drooping
// lobes, 2 a spired bell with a second bell nested inside), the contraction that ripples round the
// margin from a pacemaker, and the drift of the tentacles
float jSp, jPul, jSeed, jVy;
// the hunt: the reach toward prey (unit, in the jelly's yawed frame) and its strength, and the phase
// of a catch (0 none .. 1: the tentacles lash and curl, a glow runs up them to the bell)
vec3 jReach;
float jStr, jCatch;
void jUnpack(float w, float fc) {
  float q = floor(w + 1e-4);
  jStr = clamp(w - q, 0.0, 1.0);
  float el = mod(q, 32.0);
  float az = floor(q / 32.0 + 1e-4);
  float A = az / 1023.0 * 6.2831853, E = (el / 31.0 - 0.5) * 3.14159265;
  jReach = vec3(cos(E) * sin(A), sin(E), cos(E) * cos(A));
  jCatch = floor(fc + 1e-4) / 100.0;
}
float jC(float az) {
  float az0 = jSeed * 6.2831853 + uTime * 0.17;
  float lag = 0.85 * (1.0 - cos(az - az0));
  return pow(max(sin(jPul - lag), 0.0), 1.5);
}
float jH() { return jSp < 0.5 ? 0.86 : (jSp < 1.5 ? 0.32 : 0.48); }
vec3 jBell(float v, float u, float layer) {
  float az = u * 6.2831853;
  float ph = v * 1.5707963;
  float H = jH();
  float nRib = jSp < 0.5 ? 12.0 : (jSp < 1.5 ? 10.0 : 8.0);
  // the ribs wander a little (hand-made, never ruled)
  float aw = az + 0.05 * sin(az * 3.0 + jSeed * 11.0) + 0.04 * sin(v * 5.0 + az * 2.0);
  float rib = pow(abs(cos(aw * nRib * 0.5)), 6.0);
  float r = 0.5 * pow(sin(ph), jSp < 0.5 ? 0.7 : 0.9);
  float y = H * cos(ph);
  // the lantern pinches in a waist above a flared margin
  if (jSp < 0.5) r *= 1.0 - 0.2 * smoothstep(0.45, 0.8, v) + 0.24 * smoothstep(0.8, 1.0, v);
  r += rib * (jSp < 0.5 ? 0.075 : 0.05) * sin(ph * 2.0) * (1.0 - layer);
  y += rib * 0.018 * (1.0 - v) * (1.0 - layer);
  if (jSp > 0.5 && jSp < 1.5) {
    float lob = pow(abs(cos(az * 2.5)), 1.8);
    float m = smoothstep(0.3, 1.0, v);
    r *= 1.0 - 0.42 * (1.0 - lob) * m;
    y -= 0.3 * lob * m * m;
    y += 0.06 * (1.0 - lob) * m;
    r += 0.1 * lob * m;
  } else if (jSp > 1.5) {
    y += 0.34 * pow(1.0 - v, 4.0);
    r *= 1.0 - 0.35 * pow(1.0 - v, 2.5);
  }
  if (layer > 0.5) {
    if (jSp > 1.5) { r *= 0.5; y = y * 0.72 - 0.1; }
    else { r *= 0.84; y = y * 0.78 - 0.04; }
  }
  float c = jC(az);
  r *= 1.0 - 0.22 * c * (0.3 + v);
  y *= 1.0 + 0.14 * c;
  return vec3(cos(az) * r, y, sin(az) * r);
}
// tentacle sway at t along a tentacle hanging from margin angle a
vec3 jTentOff(float t, float a, float hunt) {
  float lag = jPul - t * 2.6;
  float sw = 1.0 - clamp(jVy * 1.2, 0.0, 0.6);
  vec3 o = vec3(sin(uTime * 0.9 + t * 4.0 + a * 2.0 + jSeed * 3.0) * 0.28 * t + sin(lag) * 0.06 * t, 0.0,
                cos(uTime * 0.8 + t * 3.5 + a * 1.7 + jSeed * 2.0) * 0.28 * t) * sw;
  // sinking between beats, they billow out
  o.xz += vec2(cos(a), sin(a)) * t * (0.12 + max(-jVy, 0.0) * 0.6);
  // fine tentacles crinkle; the hunting ones wind into corkscrews toward their hooks
  o.xz += vec2(sin(t * 47.0 + a * 7.0), cos(t * 41.0 + a * 5.0)) * 0.015 * t * (1.0 - hunt);
  float ck = hunt * smoothstep(0.55, 1.0, t);
  float w = t * 34.0 + a * 3.0 + uTime * 0.5;
  o.xz += vec2(cos(w), sin(w)) * 0.1 * ck;
  return o;
}
float jLen() { return jSp < 0.5 ? 1.25 : (jSp < 1.5 ? 0.6 : 0.95); }
float jRootA(float a) {
  // the crown's tentacles gather under its lobes
  float L = 6.2831853 / 5.0;
  return jSp > 0.5 && jSp < 1.5 ? mix(a, floor(a / L + 0.5) * L, 0.55) : a;
}
#endif

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
  // ---- jellies: the bell contracts in a ripple round the margin; curtains, tentacles and their
  // hooks trail and coil in the water ---------------------------------------------------------------
  jSeed = seed;
  jPul = iB.z;
  jVy = iC.z;
  jSp = floor(fract(seed * 7.31) * 3.0);
  jUnpack(iC.w, iB.w);
  vec3 p = pos;
  float H = jH();
  float cHere = jC(atan(pos.z, pos.x));
  if (part < 20.5) {
    float v = aP.y, u = aP.z, layer = aP.w;
    p = jBell(v, u, layer);
    vec3 pu = jBell(v, u + 0.008, layer);
    vec3 pv = jBell(min(v + 0.02, 1.0), u, layer) - jBell(max(v - 0.02, 0.0), u, layer);
    vec3 nn = cross(pu - p, pv);
    nrm = length(nn) > 1e-7 ? normalize(nn) : vec3(0.0, 1.0, 0.0);
    cHere = jC(u * 6.2831853);
  } else if (part < 21.5) {
    // the organ churns slowly
    float a = atan(pos.z, pos.x);
    if (aP.w < 0.5) p += nrm * 0.014 * sin(pos.y * 38.0 + a * 3.0 + uTime * 0.7 + seed * 5.0);
    p.xz *= 1.0 - 0.12 * cHere;
    p.y = p.y * mix(1.0, H / 0.42, 0.7) - (jSp > 1.5 ? 0.06 : 0.0);
  } else if (part < 22.5) {
    // oral curtains: frilled edges, hanging and trailing
    float t = aP.y, a = aP.z, s = aP.w;
    float d = sin(t * 30.0 + s * 2.5 + uTime * 1.2 + a * 3.0) * 0.045 * pow(abs(s), 1.5) * (0.3 + t)
            + sin(t * 71.0 + s * 4.0 + seed * 9.0) * 0.012 * abs(s);
    p += nrm * d;
    p.y *= jSp < 0.5 ? 1.5 : (jSp < 1.5 ? 0.6 : 1.05);
    p.xz *= 1.0 - 0.25 * cHere * (1.0 - t * 0.5);
    p += jTentOff(t * 0.8, a, 0.0) * 0.8;
  } else if (part < 23.5 || part > 27.5) {
    // tentacles (and their barbs and hooks, which ride on them)
    float a = aP.z;
    float t = aP.y;
    float hunt = part > 27.5 ? 1.0 : aP.w;
    float a2 = jRootA(a);
    vec3 restRoot = vec3(cos(a) * 0.46, 0.0, sin(a) * 0.46);
    vec3 local = pos - restRoot;
    vec3 root = jBell(1.0, a2 / 6.2831853, 0.0) * vec3(0.93, 1.0, 0.93);
    float c = jC(a2);
    float along = -local.y * jLen() * (1.0 - 0.15 * c * t) * (1.0 - 0.2 * hunt * smoothstep(0.55, 1.0, t));
    // hunting: the tentacles fan out into a net and the long ones swing toward the prey; a catch
    // makes them lash, shorten and curl round it
    float lash = sin(3.14159 * jCatch) * (0.4 + 0.6 * hunt);
    along *= 1.0 - 0.35 * lash * smoothstep(0.2, 1.0, t);
    vec3 dirT = normalize(mix(vec3(0.0, -1.0, 0.0), jReach, jStr * (0.2 + 0.65 * hunt)));
    p = root + vec3(local.x, 0.0, local.z) + dirT * along + jTentOff(t, a2, hunt) * (1.0 - 0.5 * jStr * hunt);
    p.xz += vec2(cos(a2), sin(a2)) * jStr * along * 0.22;
    float w2 = t * 18.0 + a2 * 2.0 + uTime * 0.8;
    p += vec3(cos(w2), 0.0, sin(w2)) * 0.15 * lash * t * hunt;
    if (part > 27.5) p += aQ.xyz * (1.0 + 0.3 * step(1.5, jSp));
  } else if (part < 24.5) {
    // lens-eyes ride on the margin
    float a = aQ.x;
    vec3 restC = vec3(cos(a) * 0.47, 0.035, sin(a) * 0.47);
    p = pos - restC + jBell(0.94, a / 6.2831853, 0.0) * 0.965;
  } else if (part < 25.5) {
    // the velum: a frilled skirt folded in under the margin
    float k = aP.y, u = aP.z;
    vec3 rim = jBell(1.0, u, 0.0);
    vec2 dir = normalize(rim.xz + 1e-5);
    p = rim + vec3(-dir.x * 0.11 * k, -0.06 * k, -dir.y * 0.11 * k);
    p.y += sin(u * 6.2831853 * 21.0 + uTime * 1.8 + seed * 9.0) * 0.016 * k;
    nrm = normalize(vec3(dir.x * 0.3, -1.0, dir.y * 0.3));
    cHere = jC(u * 6.2831853);
  } else {
    // the organ cage
    p.xz *= 1.0 - 0.16 * cHere;
    p.y = p.y * mix(1.0, H / 0.42, 0.8);
  }
  mat3 O = R * rotX(-iC.x) * rotZ(iC.y);
  W = base + O * (p * iB.x);
  nrm = O * nrm;
  info.y = jSp;
  info.z = iB.w;
  info.w = cHere;
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
    float L = mix(0.2, 0.27, feed) * (1.0 + 0.25 * giant);
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
  } else if (part < 32.5 || (part > 35.5 && part < 36.5)) {
    // the twin tails trail: a lazy sway, bent out of the turn, the beat arriving late; their barbs
    // ride on them
    float t = aP.y, side = aP.w;
    p.x += sin(uTime * 1.4 + t * 4.0 + seed * 3.0 + side * 0.9) * 0.06 * t * t - turn * 0.22 * t * t;
    p.y += sin(flap - 1.8 - t * 2.6 + side * 0.5) * 0.07 * t * amp;
    if (part > 32.5) p += aQ.xyz * (1.0 + 0.3 * giant);
  } else if (part > 36.5 && part < 37.5) {
    // fangs: the lower row drops with the jaw; the ring round the under-maw splays open to feed
    float ring = aP.w;
    if (ring < -0.5) p.y -= feed * 0.05;
    else if (ring < 0.5) {
      float a = aQ.w;
      vec3 rel = p - aQ.xyz;
      rel = rotAxis(rel, vec3(-sin(a), 0.0, cos(a)), feed * 1.3 + 0.12 * sin(uTime * 1.1 + a * 2.0 + seed * 5.0));
      nrm = rotAxis(nrm, vec3(-sin(a), 0.0, cos(a)), feed * 1.3);
      p = aQ.xyz + rel;
    }
  } else if ((part > 32.5 && part < 33.5) || (part > 37.5 && part < 38.5)) {
    // the eyes on stalks peer about on their own
    float id = part < 33.5 ? aQ.w : aP.z;
    float k = part < 33.5 ? 1.0 : aP.y;
    if (id > 0.5) {
      float sd = sign(aP.w + 1e-4);
      p += vec3(sin(uTime * 0.9 + id * 2.1 + seed * 7.0 + sd) * 0.012, sin(uTime * 0.6 + id + sd * 2.0) * 0.004, cos(uTime * 0.7 + id * 3.0 + sd) * 0.01) * k;
    }
  } else if (part > 38.5) {
    // horns: the giant's are huge; they flare out when it feeds
    float side = aP.w;
    vec3 rel = (p - aQ.xyz) * (1.0 + 0.45 * giant);
    mat3 Rh = rotZ(-side * (feed * 0.45 + 0.03 * sin(uTime * 0.5 + seed * 4.0)));
    p = aQ.xyz + Rh * rel;
    nrm = Rh * nrm;
  } else if (part > 34.5 && part < 35.5) {
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
  if (part < 40.5 || (part > 43.5 && part < 45.5)) {
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
      float f = uTime * 13.0 + seed * 7.0 + side + step(3.5, id) * 1.7;
      rel = rotY(side * (0.32 * sin(f) - 0.25)) * rel;
      rel.x += side * sin(f - u * 4.0 - s * 1.5) * 0.018 * s;
    }
    p = puff(hinge, inf) + rel;
  } else if (part > 45.5 && part < 46.5) {
    // mandibles: they scissor as it breathes, and gape wide when it puffs up to threaten
    float side = aQ.w;
    float open = 0.16 + 0.14 * sin(uTime * 1.7 + seed * 5.0) + inf * 0.6;
    vec3 rel = rotY(side * open) * (p - hinge);
    nrm = rotY(side * open) * nrm;
    p = puff(hinge, inf) + rel;
  } else if (part > 46.5) {
    // brow horns ride on the skull; the spine crest bristles taller when it puffs up
    vec3 rel = (p - hinge) * (1.0 + 0.45 * inf * aQ.w);
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
  // the nostril flaps and barbels (53) keep their own coordinate in aP.y: they ride at the snout
  float t = part > 52.5 && part < 53.5 ? 0.004 : aP.y;
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
  if (part > 52.5 && part < 53.5) {
    // nostril flaps and barbels tremble in the flow
    p.x += sin(uTime * 9.0 + aP.w * 2.0 + seed * 5.0) * 0.0008 * aP.y;
  }
  if (part > 53.5 && part < 55.5 && (part < 54.5 || aP.w < 0.0)) {
    // the lower jaw: it works slowly open and shut as the eel breathes, and gapes when alarmed
    float gape = 0.12 + 0.12 * sin(uTime * 1.3 + seed * 7.0) + alarm * 0.5;
    vec3 hg = vec3(0.0, aQ.y, aQ.z);
    p = hg + rotX(gape) * (p - hg);
    nrm = rotX(gape) * nrm;
  }
  if (part > 55.5) {
    // the gill plumes stream back and tremble
    p.x += aP.w * sin(uTime * 6.0 + aQ.w * 3.0 + seed * 5.0) * 0.0012 * aP.z;
    p.z -= 0.002 * aP.z * (1.0 + alarm);
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
  vQ = aQ;
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
varying vec4 vQ;
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
  // manta of Vur Sok: a charcoal-violet hide stretched over bone struts that fan from the shoulder
  // to a scalloped trailing edge, veined membranes that glow red when backlit, old claw scars and
  // leathery tubercles; a pale belly with a fanged under-maw and gill slits that flare as it
  // breathes; keratin horns, scutes and fangs; small alien eyes with a W-shaped slit
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
  float chord = max(zl - zt, 0.005);
  float vv = clamp((zl - L2.y) / chord, 0.0, 1.0);
  float wingK = smoothstep(0.17, 0.26, ax);
  vec3 back = mix(vec3(0.034, 0.028, 0.045), vec3(0.05, 0.032, 0.05), hs);
  back = mix(back, vec3(0.028, 0.03, 0.034), giant * 0.75);
  back *= 0.8 + 0.4 * vnoise(L2 * 7.0 + seed * 3.0);
  // bone struts fanning from the shoulder (like the fingers of a bat's wing), wandering a little
  vec2 d0 = vec2(ax, L2.y) - vec2(0.13, 0.22);
  float r0 = length(d0);
  float ang = atan(d0.y, d0.x) + 0.05 * sin(r0 * 14.0 + seed * 5.0) + 0.05 * wob.x;
  float sk = (-0.05 - ang) / 1.4 * 7.0;
  float sDist = abs(fract(sk + 0.5) - 0.5) * (1.4 / 7.0) * r0;
  float sW = (0.007 - 0.004 * r0) * (0.8 + 0.4 * vnoise(vec2(r0 * 20.0, sk)));
  float strut = (1.0 - smoothstep(sW * 0.4, sW, sDist)) * wingK * step(-0.3, sk) * step(sk, 7.3) * smoothstep(0.03, 0.1, r0);
  // the trailing edge: scalloped between the strut tips (a ragged, torn-looking hem on the giant)
  if (part < 30.5) {
    float sc = pow(sin(3.14159 * clamp(fract(sk), 0.0, 1.0)), 0.75) * step(0.0, sk) * step(sk, 7.0);
    float cut = min(0.4, (0.03 + 0.012 * giant * vnoise(vec2(sk * 3.0, seed * 7.0))) * sc / chord) * smoothstep(0.24, 0.36, ax);
    if (vv > 1.0 - cut + 0.02 * wob.y) discard;
  }
  // fine veins branching across the membrane between the struts
  float vn = vnoise(L2 * 13.0 + wob * 1.6 + seed * 3.0);
  float vein = (1.0 - smoothstep(0.0, 0.035, abs(vn - 0.5))) * wingK * (1.0 - strut) * smoothstep(0.1, 0.4, vv);
  vec3 bone = mix(vec3(0.42, 0.38, 0.33), vec3(0.6, 0.57, 0.5), giant);
  vec3 dorsal = mix(back, bone * (0.8 + 0.2 * vnoise(L2 * 40.0)), strut * 0.55);
  dorsal = mix(dorsal, back * 0.55, vein * 0.5);
  // jagged pale shoulder flashes (each animal its own), inked along their edge
  float dz = zl - L2.y + wob.x * 0.03;
  float pw = mix(0.1, 0.15, giant) * (1.0 - smoothstep(0.14, mix(0.48, 0.6, giant), ax + wob.y * 0.06));
  float pin = mix(0.06, 0.09, giant) + 0.016 * sin(ax * 23.0 + seed * 5.0) + 0.008 * sin(ax * 61.0);
  float pd = max(pin - dz, dz - pin - pw);
  float patchK = (1.0 - smoothstep(-0.006, 0.008, pd)) * smoothstep(0.08, 0.13, ax + wob.x * 0.02);
  vec3 pale = mix(vec3(0.36, 0.37, 0.4), vec3(0.62, 0.62, 0.6), giant);
  dorsal = mix(dorsal, pale * (0.8 + 0.2 * vnoise(L2 * 30.0)), patchK * 0.8);
  float inkW = 0.004 + 0.004 * vnoise(L2 * 17.0 + 2.0);
  dorsal *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, inkW, abs(pd))) * step(0.11, ax);
  // old claw scars: sets of three parallel strokes, wobbling, tapered at both ends
  float scar = 0.0;
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    if (fk > giant + 0.5 + step(0.6, hs)) break;
    vec2 c0 = vec2((0.25 + 0.4 * fract(seed * 13.7 + fk * 0.37)) * (fract(seed * 5.3 + fk) < 0.5 ? -1.0 : 1.0), 0.05 - 0.25 * fract(seed * 7.1 + fk * 0.61));
    float a0 = 6.2831 * fract(seed * 3.3 + fk * 0.21);
    vec2 dir = vec2(cos(a0), sin(a0)), nor = vec2(-dir.y, dir.x);
    vec2 q = L2 - c0;
    float along = dot(q, dir), across = dot(q, nor) + 0.008 * sin(along * 40.0 + fk * 3.0) + 0.006 * wob.y;
    float len = 0.11 + 0.08 * giant;
    float taper = 1.0 - smoothstep(len * 0.5, len, abs(along));
    for (int j = 0; j < 3; j++) {
      float off = (float(j) - 1.0) * 0.028 + 0.004 * sin(along * 25.0 + float(j));
      float w = 0.0035 * taper * (0.6 + 0.4 * sin(along * 30.0 + float(j) * 2.0));
      scar = max(scar, (1.0 - smoothstep(w * 0.4, w, abs(across - off))) * taper);
    }
  }
  dorsal = mix(dorsal, vec3(0.5, 0.42, 0.42), scar * 0.75);
  // the giant's crust: pale encrusting growths about the head and the wing roots
  float crust = smoothstep(0.6, 0.75, vnoise(L2 * 14.0 + wob * 0.8 + seed * 9.0)) * smoothstep(0.42, 0.12, length(vec2(ax, L2.y) - vec2(0.08, 0.22))) * giant;
  dorsal = mix(dorsal, vec3(0.4, 0.38, 0.34) * (0.8 + 0.2 * vnoise(L2 * 30.0)), crust * 0.6);
  // belly: pale, the margins dusky with a ragged edge, veins showing through the thin wings
  vec3 belly = vec3(0.74, 0.73, 0.72);
  float marg = max(smoothstep(0.72, 0.95, ax + wob.x * 0.08), smoothstep(0.8, 0.97, vv + wob.y * 0.1) * smoothstep(0.2, 0.4, ax));
  belly = mix(belly, back * 2.2 + 0.04, marg * 0.85);
  belly = mix(belly, vec3(0.42, 0.2, 0.24), vein * 0.35);
  belly = mix(belly, bone * 0.8, strut * 0.3);
#ifndef RAY_FAR
  // this individual's belly spots (blotchy, scattered between the gills and the vent)
  vec2 sq = L2 * 9.0 + wob * 0.45 + seed * 37.0;
  vec2 sc2 = floor(sq);
  float spot = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cc = sc2 + vec2(float(i), float(j));
    vec2 h = vec2(hash12(cc), hash12(cc + 7.7));
    float has = step(0.7, hash12(cc + 3.1));
    float rr = 0.14 + 0.22 * h.y;
    spot = max(spot, has * (1.0 - smoothstep(rr * 0.75, rr, length(sq - cc - h))));
  }
  spot *= (1.0 - smoothstep(0.32, 0.45, ax)) * smoothstep(-0.42, -0.25, L2.y) * (1.0 - smoothstep(0.2, 0.32, L2.y));
  belly = mix(belly, vec3(0.08, 0.07, 0.09), spot * 0.85);
  // five pairs of gill slits that flare open and shut as it breathes, raw red inside
  float breath = 0.5 + 0.5 * sin(uTime * 0.8 + seed * 5.0);
  float gk = clamp(floor((0.24 - L2.y) / 0.034 + 0.5), 0.0, 4.0);
  float gx = clamp((ax - 0.075) / 0.085, 0.0, 1.0);
  float gz = 0.24 - gk * 0.034 - 0.02 * gx + 0.018 * (gx - 0.5) * (gx - 0.5) + wob.x * 0.006;
  float gw = 0.0045 * pow(sin(3.14159 * gx), 0.7) * (1.0 - 0.15 * gk) * (0.7 + 0.6 * vnoise(vec2(ax * 40.0, gk))) * (0.7 + 1.6 * breath + feed);
  float gd = abs(L2.y - gz);
  float gill = (1.0 - smoothstep(gw * 0.5, gw, gd)) * step(0.075, ax) * step(ax, 0.16);
  belly = mix(belly, mix(vec3(0.42, 0.05, 0.06), vec3(0.06, 0.02, 0.03), smoothstep(gw * 0.6, 0.0, gd)), gill);
  // the under-maw: a puckered, fleshy ring of lips round a dark throat (it gapes to feed)
  float md = length((L2 - vec2(0.0, 0.3)) * vec2(1.0, 0.83)) + 0.004 * sin(atan(L2.y - 0.3, L2.x) * 10.0);
  float mr = 0.03 + 0.022 * feed;
  belly = mix(belly, vec3(0.5, 0.2, 0.22), (1.0 - smoothstep(0.004, 0.012, abs(md - mr - 0.012))) * 0.8);
  belly = mix(belly, vec3(0.05, 0.01, 0.02), 1.0 - smoothstep(mr - 0.006, mr, md));
#endif
  // the dark back wraps over the rims (leading edge, tips and the tail root) onto the belly a little
  float topW = smoothstep(-0.6, -0.15, topK + wob.y * 0.3);
  albedo = mix(belly, dorsal, topW);
  // leathery tubercles and the raised struts
  N = normalize(N + (vec3(vnoise(L2 * 140.0), 0.0, vnoise(L2.yx * 140.0 + 3.0)) - 0.5) * 0.18 + vec3(0.0, strut * 0.15, 0.0));
  // the terminal mouth: a dark slot across the front of the head, a gaping funnel when feeding
  if (part < 30.5) {
    float mouth = (1.0 - smoothstep(0.095, 0.12, ax + wob.x * 0.01)) * (1.0 - smoothstep(0.1 + feed * 0.55, 0.16 + feed * 0.6, abs(topK + 0.08)));
    mouth *= 1.0 - smoothstep(0.0, 0.035 + feed * 0.04, vP.y);
    albedo = mix(albedo, vec3(0.025, 0.01, 0.015), mouth);
  }
  spec = 0.32; gloss = 0.62;
  if (part > 30.5 && part < 31.5) {
    // cephalic lobes: split into two hooked tines, the inner face raw pink
    float t = vP.y, c = vP.z;
    if (t > 0.45 && abs(c - 0.5) < 0.16 * (t - 0.45) / 0.55) discard;
    if (c > 0.9 - 0.12 * pow(fract(t * 6.0 + 0.3), 2.0) * smoothstep(0.2, 0.4, t)) discard;
    albedo = mix(dorsal, vec3(0.42, 0.22, 0.24), smoothstep(0.3, 1.0, c) * 0.6);
  } else if (part > 31.5 && part < 32.5) {
    // the tails: dark, ringed pale toward the root
    float t = vP.y;
    albedo = back * 1.1;
    albedo = mix(albedo, bone * 0.7, smoothstep(0.6, 0.9, sin(t * 70.0 + wob.x * 2.0)) * smoothstep(0.45, 0.1, t) * 0.6);
  } else if (part > 32.5 && part < 33.5) {
    // eyes: wet black with a molten amber iris and a W-shaped slit
    vec3 ec = vQ.xyz;
    float side = sign(ec.x);
    vec3 axE = vQ.w > 0.5 ? normalize(vec3(side * 0.5, 0.8, 0.35)) : normalize(vec3(side, 0.25, 0.25));
    vec3 e = normalize(vLoc - ec);
    float cosA = dot(e, axE);
    vec3 rv = normalize(cross(vec3(0.0, 1.0, 0.0) + vec3(0.0, 0.0, 0.3), axE));
    vec3 uv3 = cross(axE, rv);
    vec2 q = vec2(dot(e, rv), dot(e, uv3));
    float iris = smoothstep(0.5, 0.62, cosA);
    float slit = (1.0 - smoothstep(0.035, 0.06, abs(q.y + 0.07 * cos(q.x * 16.0) - 0.02))) * smoothstep(0.7, 0.8, cosA);
    vec3 irisC = mix(vec3(0.85, 0.42, 0.06), vec3(0.95, 0.75, 0.2), smoothstep(0.62, 0.95, cosA)) * (0.65 + 0.35 * sin(atan(q.y, q.x) * 21.0 + cosA * 30.0));
    albedo = mix(vec3(0.01), irisC, iris);
    albedo = mix(albedo, vec3(0.0), slit);
    spec = 1.3; gloss = 0.95;
  } else if (part > 33.5 && part < 34.5) {
    // the dorsal fin, and the scutes: ridged keratin, dark at the root, worn pale at the point
    albedo = vP.w > 1.5 ? mix(back * 1.4, bone * 0.9, smoothstep(0.2, 1.0, vP.y)) * (0.85 + 0.15 * sin(vP.y * 40.0 + vLoc.z * 90.0)) : back;
    spec = 0.4; gloss = 0.6;
  } else if (part > 34.5 && part < 35.5) {
    albedo = back;
  } else if (part > 35.5 && part < 37.5) {
    // barbs and fangs: yellowed ivory, translucent toward the point
    float t = part < 36.5 ? vQ.w : vP.y;
    albedo = mix(vec3(0.3, 0.18, 0.16), vec3(0.85, 0.8, 0.66), smoothstep(0.0, 0.5, t));
    spec = 0.7; gloss = 0.85; trans = 0.5;
  } else if (part > 37.5 && part < 38.5) {
    albedo = mix(back * 1.3, belly * 0.6, 0.2);
  } else if (part > 38.5) {
    // horns: ridged keratin with growth rings and chips, a dark base fading to pale worn tips
    float t = vP.y;
    float ringH = 0.82 + 0.18 * smoothstep(0.3, 0.9, sin(t * 85.0 + vnoise(vLoc.xy * 80.0) * 3.0));
    albedo = mix(vec3(0.05, 0.045, 0.045), mix(bone, vec3(0.78, 0.74, 0.64), giant), smoothstep(0.15, 1.0, t)) * ringH;
    albedo *= 0.85 + 0.3 * vnoise(vLoc.xy * 200.0);
    spec = 0.5; gloss = 0.7;
  }
  rim = 0.55; wrap = 0.24;
  trans = max(trans, 0.15 + 1.1 * thin * (1.0 - strut));
#elif KIND == 8
  // ---- lantern puffer: a map-puffer maze of hand-drawn dark lines over olive-gold skin, a pale
  // belly with wavy pinstripes, photophores that wake at night or when it puffs up, glossy eyes
  float inf = vI.z;
  vec3 Lc = vLoc;
  float dep = uSeaLevel - vWorldPos.y;
  if (part < 40.5) {
    float t = vP.y;
    float topK = smoothstep(-0.06, 0.07, Lc.y - 0.012 * sin(Lc.z * 31.0 + seed * 6.0));
    vec3 back = mix(vec3(0.17, 0.12, 0.09), vec3(0.22, 0.18, 0.08), hs);
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
    albedo = mix(albedo, vec3(0.6, 0.55, 0.42), spot * 0.35);
    // armour: bony plates over the back and the crown; their seams wander (domain-warped cells),
    // the plate centres are paler and raised, and they part when it puffs up
    vec2 ap = vec2(Lc.z * 24.0, atan(Lc.x, Lc.y + 0.03) * 4.2) + (vec2(vnoise(Lc.zy * 28.0 + seed * 5.0), vnoise(Lc.xz * 28.0 + 2.0)) - 0.5) * 0.8;
    vec2 ac = floor(ap);
    float d1 = 9.0, d2 = 9.0;
    vec2 bo = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 dd = ac + o + hash22(ac + o + floor(seed * 50.0)) - ap;
      float dq = dot(dd, dd);
      if (dq < d1) { d2 = d1; d1 = dq; bo = dd; } else if (dq < d2) d2 = dq;
    }
    float seam = sqrt(d2) - sqrt(d1);
    float plateK = smoothstep(-0.03, 0.06, Lc.y) * smoothstep(-0.2, -0.12, Lc.z);
    float seamK = (1.0 - smoothstep(0.03 + 0.04 * inf, 0.1 + 0.05 * vnoise(ap * 3.0) + 0.06 * inf, seam)) * plateK;
    albedo = mix(albedo, albedo * 1.4 + vec3(0.05, 0.04, 0.02), plateK * smoothstep(0.55, 0.0, sqrt(d1)) * 0.55);
    albedo = mix(albedo, mix(vec3(0.025, 0.02, 0.015), vec3(0.42, 0.24, 0.24), inf), seamK * 0.85);
    N = normalize(N - vec3(bo.y * 0.0, 0.0, bo.x) * 0.25 * plateK * (1.0 - seamK));
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
    emis = vec3(0.0);
    spec = 1.8; gloss = 0.97; rim = 0.9; trans = 0.0;
    // a fixed soft catchlight on the cornea (the bright water overhead)
    float cl = pow(max(dot(N, normalize(V + vec3(0.0, 0.9, 0.0))), 0.0), 30.0);
    emis += vec3(0.9, 0.95, 1.0) * cl * 0.25 / max(glowK, 0.3);
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
    albedo = mix(vec3(0.22, 0.14, 0.12), vec3(0.88, 0.84, 0.7), vP.y);
    spec = 0.5; gloss = 0.8;
  } else if (part < 44.5) {
    // the beak: fused ivory tooth plates
    albedo = vec3(0.86, 0.82, 0.68) * (0.85 + 0.15 * sin(vP.y * 30.0));
    spec = 0.8; gloss = 0.85; rim = 0.5;
  } else if (part < 45.5) {
    albedo = vec3(0.04, 0.02, 0.02);
    spec = 0.1;
  } else if (part < 46.5) {
    // mandibles: lacquered oxblood chitin fading to bone at the hooks; ivory teeth
    albedo = vP.z > 0.5 ? vec3(0.85, 0.8, 0.66) : mix(vec3(0.16, 0.04, 0.03), vec3(0.8, 0.72, 0.56), smoothstep(0.55, 1.0, vP.y));
    albedo *= 0.85 + 0.15 * sin(vP.y * 50.0 + vnoise(Lc.xz * 200.0) * 2.0);
    spec = 0.9; gloss = 0.88; rim = 0.6;
  } else {
    // brow horns and crest spines: ringed bone, dark at the root
    albedo = mix(vec3(0.12, 0.09, 0.06), vec3(0.86, 0.8, 0.64), smoothstep(0.1, 0.9, vP.y));
    albedo *= 0.82 + 0.18 * smoothstep(0.2, 0.8, sin(vP.y * 60.0 + vnoise(Lc.xy * 150.0) * 3.0));
    spec = 0.6; gloss = 0.75; rim = 0.5;
  }
#elif KIND == 9
  // ---- ribbon eel: velvet skin (blue males, black juveniles, gold females), yellow fins with a
  // white margin and fine rays, a gold jaw and nostril leaves, a small glossy eye
  float t = vI.w;
  float alarm = vI.z;
  vec3 Lc = vLoc;
  float morph = hs;
  // an alien moray, not a reef-shop ribbon eel: dark slate, near-black or rust bronze hide, dusky
  // violet fins edged in blood red
  vec3 bodyC = morph < 0.55 ? vec3(0.035, 0.07, 0.08) : (morph < 0.8 ? vec3(0.02, 0.022, 0.03) : vec3(0.2, 0.09, 0.035));
  vec3 finC = morph < 0.8 ? vec3(0.3, 0.2, 0.3) : vec3(0.36, 0.2, 0.16);
  if (part < 50.5) {
    float topK = smoothstep(-0.006, 0.01, Lc.y);
    albedo = bodyC * mix(1.25, 0.75, topK);
    // leopard mottling: pale, irregular rosettes over the dark hide (thinning toward the belly)
    float mot = vnoise(vec2(t * 170.0 + seed * 7.0, Lc.y * 950.0)) * 0.65 + vnoise(vec2(t * 420.0, Lc.y * 2300.0 + seed)) * 0.35;
    albedo = mix(albedo, vec3(0.42, 0.4, 0.3) * (0.6 + 0.4 * morph), smoothstep(0.6, 0.72, mot) * 0.55 * (0.5 + 0.5 * topK));
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
    // armour: overlapping bony bands down the back, their seams wobbling (never ruled)
    float bandP = t * 48.0 + 0.25 * sin(Lc.y * 500.0 + t * 37.0) + 0.3 * vnoise(vec2(t * 90.0, Lc.y * 300.0 + seed * 9.0));
    float seamB = (1.0 - smoothstep(0.0, 0.09 + 0.05 * vnoise(vec2(t * 200.0, seed)), fract(bandP))) * smoothstep(-0.004, 0.004, Lc.y) * smoothstep(0.06, 0.1, t);
    albedo = mix(albedo, albedo * 0.25, seamB * 0.85);
    albedo *= 1.0 + 0.25 * smoothstep(0.3, 1.0, fract(bandP)) * smoothstep(-0.004, 0.004, Lc.y) * smoothstep(0.06, 0.1, t);
    // the palate (hidden under the jaw until it gapes)
    albedo = mix(albedo, vec3(0.28, 0.04, 0.05), smoothstep(-0.002, -0.006, Lc.y) * smoothstep(0.066, 0.055, t));
    // velvet micro relief and mucus gloss
    N = normalize(N + (vec3(vnoise(Lc.zy * 900.0), vnoise(Lc.zx * 900.0 + 3.0), 0.0) - 0.5) * 0.12 + vec3(0.0, 0.0, seamB * 0.25));
    spec = 0.75; gloss = 0.8; rim = 0.8; wrap = 0.24; trans = 0.25;
    emis += vec3(0.4, 0.9, 1.0) * ll * (0.3 * uNight + alarm * 1.2);
  } else if (part < 51.5) {
    float s = vP.z;
    float spF = vP.w > 0.0 ? 130.0 : 200.0;
    float ray = smoothstep(0.32, 0.08, abs(fract(t * spF + s * 0.25) - 0.5)) * smoothstep(0.05, 0.3, s);
    albedo = finC * (1.0 - ray * 0.3);
    float marg = smoothstep(0.72, 0.9, s + 0.06 * sin(t * 90.0 + seed * 7.0));
    albedo = mix(albedo, vec3(0.5, 0.06, 0.08), marg * 0.85);
    albedo = mix(albedo, bodyC, smoothstep(0.25, 0.0, s) * 0.6);
    trans = 1.2; spec = 0.4; gloss = 0.75; rim = 0.7; wrap = 0.4;
    emis += vec3(0.35, 0.95, 1.0) * marg * (0.25 * uNight + alarm * 0.9);
    // the membrane is torn back between spines that stand proud of it (dorsal), scalloped (anal)
    float ph9 = fract(t * spF + s * 0.25 + 0.5);
    float edge = vP.w > 0.0 ? 0.58 + 0.42 * pow(max(1.0 - abs(ph9 - 0.5) * 2.0, 0.0), 5.0) + 0.04 * vnoise(vec2(t * 400.0, seed)) : 0.9 + 0.1 * cos(t * spF * 6.2831853);
    if (s > edge) discard;
    albedo = mix(albedo, vec3(0.1, 0.08, 0.06), smoothstep(0.6, 0.95, s) * step(0.0, vP.w) * ray);
  } else if (part < 52.5) {
    vec2 q = vP.zw;
    float d = length(q);
    float pupil = smoothstep(0.5, 0.42, d);
    albedo = mix(finC * 0.8, vec3(0.005), pupil);
    albedo = mix(albedo, vec3(0.04), smoothstep(0.85, 1.0, d));
    spec = 1.8; gloss = 0.97; rim = 0.9;
    emis += vec3(0.9, 0.95, 1.0) * pow(max(dot(N, normalize(V + vec3(0.0, 0.9, 0.0))), 0.0), 30.0) * 0.25 / max(glowK, 0.3);
  } else if (part < 53.5) {
    albedo = finC;
    trans = 1.0; spec = 0.4; rim = 0.8;
  } else if (part < 54.5) {
    // the lower jaw: gold-scaled outside, the tongue dark red
    albedo = finC * 0.85 * (0.85 + 0.15 * vnoise(Lc.zx * 2000.0));
    float lip9 = smoothstep(0.0012, 0.0002, abs(Lc.y + 0.0018 + 0.0004 * sin(Lc.z * 2000.0)));
    albedo = mix(albedo, vec3(0.02), lip9 * 0.6);
    if (vP.z > 0.68) albedo = vec3(0.3, 0.05, 0.06);
    spec = 0.7; gloss = 0.8; rim = 0.7;
  } else if (part < 55.5) {
    // needle teeth: glassy ivory
    albedo = mix(vec3(0.5, 0.35, 0.3), vec3(0.92, 0.9, 0.82), vP.z);
    spec = 0.9; gloss = 0.9; trans = 0.6;
  } else {
    // gill plumes: blood-red feathery filaments, darker at the root
    float fil = smoothstep(0.3, 0.0, abs(fract(vP.z * 14.0 + vP.w * 0.3) - 0.5));
    albedo = mix(vec3(0.25, 0.03, 0.04), vec3(0.75, 0.16, 0.12), vP.z) * (0.75 + 0.35 * fil);
    trans = 1.3; spec = 0.4; rim = 0.9; wrap = 0.4;
    if (vP.z > 0.92 + 0.08 * sin(vP.y * 900.0 + vQ.w * 20.0)) discard;
  }
#endif

#if KIND == 6
  // jellies: glass that glows from within, premultiplied so their pigment, eyes and hooks can
  // darken what is behind them. Three species, three palettes (apex core, body, margin).
  float fres = pow(1.0 - abs(dot(N, V)), 2.0);
  float sp = vI.y;
  float pulse = vI.w;
  float cq = floor(vI.z + 1e-4);
  float flare = vI.z - cq;
  float jcat = cq / 100.0;
  // a catch: a soft glow runs up the tentacles from the prey to the bell, which brightens as it
  // arrives (once, steady; never a flicker)
  float arrive = jcat > 0.0 ? sin(3.14159 * clamp((jcat - 0.72) / 0.28, 0.0, 1.0)) : 0.0;
  vec3 cA, cB, cR;
  if (sp < 0.5) { cA = vec3(1.0, 0.28, 0.42); cB = vec3(0.32, 0.5, 0.95); cR = vec3(0.4, 1.0, 0.88); }
  else if (sp < 1.5) { cA = vec3(1.0, 0.52, 0.14); cB = vec3(0.8, 0.3, 0.55); cR = vec3(0.32, 0.82, 1.0); }
  else { cA = vec3(0.62, 0.32, 1.0); cB = vec3(0.22, 0.72, 0.66); cR = vec3(0.8, 1.0, 0.5); }
  cB = mix(cB, uGlow, 0.15);
  float sunK = smoothstep(-0.05, 0.25, uSunDir.y) * (1.0 - uStorm * 0.6);
  float lit = 0.3 + 0.7 * max(dot(N, uSunDir), 0.0) * sunK;
  vec3 col;
  if (part < 20.5) {
    float v = vP.y, u = vP.z, layer = vP.w;
    float az = u * 6.2831853;
    vec3 grad = mix(cA, cB, smoothstep(0.0, 0.55, v));
    grad = mix(grad, cR, smoothstep(0.62, 1.0, v));
    // radial canals that wander and branch toward the margin, and a wobbling ring canal
    float nR = sp < 0.5 ? 12.0 : (sp < 1.5 ? 10.0 : 8.0);
    float wa = az + 0.07 * sin(v * 9.0 + az * 3.0 + hs * 6.0) + 0.05 * (vnoise(vec2(az * 5.0, v * 7.0) + hs * 9.0) - 0.5);
    float canal = pow(abs(cos(wa * nR * 0.5)), 26.0) * smoothstep(0.05, 0.3, v) * (0.6 + 0.4 * vnoise(vec2(az * 4.0, v * 20.0)));
    canal = max(canal, pow(abs(cos(wa * nR + 0.4 * sin(v * 7.0 + az))), 34.0) * smoothstep(0.55, 0.82, v) * 0.7);
    float ringC = smoothstep(0.03, 0.0, abs(v - 0.87 - 0.012 * sin(az * 11.0 + hs * 5.0)));
    // pigment: bruise-dark clouds about the apex and a band of tiny dark ocelli above the margin
    float blot = smoothstep(0.52, 0.82, vnoise(vec2(az * 3.0, v * 6.0) + hs * 7.0)) * smoothstep(0.65, 0.15, v);
    vec2 pq = vec2(az * 10.0, v * 30.0);
    vec2 pc = floor(pq), pf = fract(pq) - 0.5, pj = hash22(pc + hs * 13.0) - 0.5;
    float oc = smoothstep(0.3, 0.14, length(pf - pj * 0.4)) * step(0.45, hash12(pc + 2.0)) * smoothstep(0.62, 0.7, v) * smoothstep(0.84, 0.76, v);
    float glow = 0.05 + 0.42 * fres + canal * 0.45 + ringC * 0.3 + smoothstep(0.92, 1.0, v) * 0.18;
    if (layer > 0.5) glow = 0.04 + (sp > 1.5 ? 0.5 : 0.25) * fres;
    glow += arrive * 0.12 * (1.0 - v);
    col = grad * glow;
    float dark = max(blot * 0.55, oc * 0.85) * (1.0 - layer);
    col = col * (1.0 - dark) + vec3(0.16, 0.04, 0.08) * dark * lit * 0.25;
    alpha = 0.05 + 0.32 * fres + canal * 0.12 + dark * 0.6;
    col += uSunColor * 0.05 * max(dot(N, uSunDir), 0.0) * sunK;
  } else if (part < 21.5) {
    // the gastric organ (deep wine, veined) and the gonads that hold the light
    if (vP.w > 0.5) { col = cA * (0.55 + 0.25 * pulse + 0.9 * arrive) * (0.7 + 0.3 * sin(vP.y * 9.0 + hs * 4.0)); alpha = 0.45; }
    else {
      float vein = smoothstep(0.75, 0.95, abs(sin(vLoc.y * 70.0 + vnoise(vLoc.xz * 30.0) * 4.0)));
      col = mix(cA * 0.18, cA * 0.6, fres) + cA * vein * 0.2;
      alpha = 0.55;
    }
  } else if (part < 22.5) {
    // oral curtains: thin frills, darker at their ruffled edges
    float s2 = abs(vP.w), t = vP.y;
    col = mix(cA, cB, t * 0.6) * (0.16 + 0.45 * s2 * s2) * (1.0 - 0.5 * t);
    float edgeD = smoothstep(0.7, 1.0, s2) * (0.5 + 0.5 * vnoise(vec2(t * 40.0, vP.z * 3.0)));
    col = col * (1.0 - edgeD * 0.6) + vec3(0.14, 0.02, 0.06) * edgeD * lit * 0.3;
    alpha = 0.14 + 0.36 * s2 * s2 + edgeD * 0.3;
  } else if (part < 23.5) {
    // tentacles: the hunting ones banded with dark stinging batteries
    float t = vP.y, hunt = vP.w;
    col = mix(cR, cA, t) * (0.26 - 0.12 * t);
    alpha = 0.22 * (1.0 - 0.55 * t);
    float rip = jcat > 0.0 ? exp(-pow((t - (1.0 - jcat * 1.05)) / 0.07, 2.0)) * (1.0 - smoothstep(0.85, 1.0, jcat)) : 0.0;
    col += mix(cA, cR, 0.3) * rip * (0.5 + 0.5 * hunt);
    alpha += rip * 0.15;
    float band = smoothstep(0.35, 0.9, sin(t * 55.0 + vnoise(vec2(t * 12.0, vP.z * 3.0)) * 5.0)) * hunt * smoothstep(0.2, 0.4, t) * (0.5 + 0.5 * vnoise(vec2(t * 9.0, vP.z)));
    col = col * (1.0 - band * 0.5) + vec3(0.2, 0.03, 0.06) * band * lit * 0.4;
    alpha += band * 0.3 + hunt * 0.2;
  } else if (part < 24.5) {
    // lens-eyes: dark lenses with an amber iris round a slit pupil
    vec2 q = vP.zw;
    float d = length(q);
    float pupil = smoothstep(0.3, 0.2, length(q * vec2(1.0, 0.45)));
    float iris = smoothstep(0.85, 0.7, d);
    col = mix(vec3(0.02, 0.01, 0.015), vec3(0.75, 0.45, 0.1) * (0.55 + 0.45 * sin(atan(q.y, q.x) * 13.0 + d * 9.0)) * 0.4, iris);
    col = mix(col, vec3(0.0), pupil);
    col *= 0.6 + 0.4 * lit;
    col += vec3(0.6, 0.7, 0.75) * pow(max(dot(N, normalize(V + vec3(0.0, 0.9, 0.0))), 0.0), 40.0) * 0.15;
    alpha = 0.9;
  } else if (part < 25.5) {
    // the velum: a scalloped skirt
    float k = vP.y, u = vP.z;
    float edge = 0.62 + 0.38 * pow(abs(cos(u * 6.2831853 * 14.0 + 0.5 * sin(u * 37.0 + hs * 5.0))), 0.6);
    if (k > edge) discard;
    col = cR * (0.03 + 0.1 * k);
    alpha = 0.05 + 0.12 * k;
  } else if (part < 27.5) {
    // the organ cage: pale cartilage hoops
    col = vec3(0.82, 0.78, 0.7) * 0.22 * lit + cB * 0.12 + cB * fres * 0.2;
    alpha = 0.5;
  } else {
    // barbs and the claw: amber horn, dark at the points
    float tt = vQ.w;
    col = mix(vec3(0.75, 0.55, 0.3), vec3(0.08, 0.04, 0.03), smoothstep(0.3, 1.0, tt)) * 0.35 * lit;
    alpha = 0.85;
  }
  // steady glow (no flicker): brighter at night, flaring when startled, swelling with each beat
  col *= (1.0 + 1.0 * uNight) * (1.0 + flare * 1.6) * (0.88 + 0.24 * pulse);
  // through the water: the light fades with the path, and the surface dims it seen from above
  float dist = length(vWorldPos - uCamPos);
  vec3 T = exp(-uWaterAbsorb * dist * mix(0.0, 1.0, uUnderwater) * 0.8);
  float above = (1.0 - uUnderwater) * step(vWorldPos.y, uSeaLevel);
  T *= mix(vec3(1.0), exp(-uWaterAbsorb * max(uSeaLevel - vWorldPos.y, 0.0) * 2.0) * 0.5, above);
  gl_FragColor = vec4(col * T, clamp(alpha, 0.0, 1.0) * dot(T, vec3(0.333)));
#else
  Surface sf = makeSurface(albedo, N, vWorldPos);
  sf.ao = ao; sf.rim = rim; sf.trans = trans; sf.spec = spec; sf.gloss = gloss; sf.wrap = wrap;
  sf.emissive = emis * glowK;
  vec3 col = stylizedLight(sf);
#if KIND == 7
  // light through the thin wing margins and lobes (backlit or lit from the far side), and the
  // surface caustics dancing over the dark back in shallow water
  float tb7 = pow(max(dot(-V, uSunDir), 0.0), 2.0) + 0.4 * max(-dot(N, uSunDir), 0.0);
  col += mix(vec3(0.16, 0.3, 0.38), vec3(0.45, 0.12, 0.1), 0.45) * uSunColor * thin * tb7 * 0.45;
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
  // premultiplied: glowing glass adds light, pigment, eyes and hooks darken what lies behind
  if (jelly) Object.assign(params, { transparent: true, depthWrite: false, blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor });
  return new ShaderMaterial(params);
}

export function makeActors() { return [new Vector4(), new Vector4(), new Vector4(), new Vector4()]; }

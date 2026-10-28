// Bird-reptile materials (skimmer: SPECIES 0, coilwing: SPECIES 1).
//
// Vertex: a procedural skeleton. Each wing is a bone chain (shoulder, elbow, wrist, finger / hand)
// whose absolute yaw and elevation blend three poses (spread, dive arrow, folded at rest) plus a
// flapping stroke with elbow and wrist lag; the membrane (skimmer) or feather sheet (coilwing)
// spans the leading-edge chain and a trailing edge that runs back to the ankle, bellies with
// camber, and collapses along the arm when folded. Neck and tail are curves between frames; the
// coilwing's tail rolls into a spiral when it perches. Jaws open, crests flare, heads turn.
//
// Fragment: wing membranes with actinofibrils, veins and backlit translucency; pycnofibre fuzz;
// iridescent feathers with vanes, rachis, slotted primaries and banded tails; scaled heads;
// the skimmer's coral spiral crest and long two-tone beak. Lit by stylizedLight, fogged by
// applyFog (so a skimmer that plunges is tinted by the sea).
import { ShaderMaterial, Color, DoubleSide } from 'three';
import { G } from '../../render/Globals.js';
import { UNIFORMS, NOISE, SHADOW, LIGHTING, SEA } from '../../render/shaders/common.js';
import { ECO_GLSL, ECO_FRAG } from './glsl.js';
import { SKIMMER, COILWING } from './reptileGeo.js';

const C = (h) => new Color(h);
const fl = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const v3 = (a) => a.map(fl).join(', ');
/** Palettes: [a, b, c, d] colours per variant. */
export const REPTILE_PALETTES = {
  // back, belly, wing membrane, crest
  skimmer: [
    [C('#3b4652'), C('#e9e2d6'), C('#c99a5e'), C('#e2553f')],
    [C('#2f3d3a'), C('#ece6dc'), C('#b3784c'), C('#f08a3a')],
    [C('#4b3f4f'), C('#efe5df'), C('#c48a7a'), C('#d94a6a')],
    [C('#3a4a5e'), C('#e6e9ea'), C('#9fa7b8'), C('#3fb3c9')],
  ],
  // plumage, belly / throat, iridescent sheen, bars
  coilwing: [
    [C('#1d2a33'), C('#c9b28a'), C('#2fd0c4'), C('#c4642c')],
    [C('#2a2033'), C('#d2b8a4'), C('#8a5cff'), C('#e0a33a')],
    [C('#1f2e22'), C('#cfc39a'), C('#55e07a'), C('#b8442e')],
    [C('#2b2522'), C('#e0cfb2'), C('#ffb347'), C('#3a7ab8')],
  ],
};

const VERT = /* glsl */ `
${UNIFORMS}
${ECO_GLSL}
attribute vec4 aB;
attribute vec4 aB2;
attribute vec4 iPos;   // xyz, scale (half wingspan, m)
attribute vec4 iQuat;  // orientation
attribute vec4 iAnim;  // flap phase, flap amplitude, fold (rest) 0..1, sweep (dive) 0..1
attribute vec4 iAnim2; // head yaw, head pitch, jaw open, tail curl / crest flare
attribute vec4 iSeed;  // seed, palette + tint, legs down 0..1, glide twist / feather spread
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vB;
varying vec3 vLocal;
varying vec4 vSeed;
varying vec4 vPose;
varying float vPx;

// absolute bone direction from yaw (back-sweep, +toward the tail) and elevation (up)
vec3 boneDir(float yaw, float elev, float side) {
  return vec3(side * cos(elev) * cos(yaw), sin(elev), -sin(yaw) * cos(elev));
}

struct Chain { vec3 S; vec3 E; vec3 W; vec3 F; vec3 A; vec3 nrm; };

#if SPECIES == 0
  const vec3 SH = vec3(${v3(SKIMMER.shoulder)});
  const float LH = ${fl(SKIMMER.hum)}, LF = ${fl(SKIMMER.fore)}, LI = ${fl(SKIMMER.finger)};
#else
  const vec3 SH = vec3(${v3(COILWING.shoulder)});
  const float LH = ${fl(COILWING.hum)}, LF = ${fl(COILWING.fore)}, LI = ${fl(COILWING.finger)};
#endif

// The fore wing's chain for this frame (side +1 right, -1 left).
Chain foreChain(float side, float ph, float amp, float fold, float sweep, float twist) {
  // spread / dive / folded poses as (yaw, elev) per bone
#if SPECIES == 0
  vec3 yawS = vec3(0.12, -0.1, 0.2), elS = vec3(0.06, 0.0, -0.05);
  vec3 yawD = vec3(0.95, 0.25, 0.75), elD = vec3(0.12, 0.05, 0.02);
  // at rest: humerus back and down, forearm forward and down to the ground (the knuckle walks),
  // the long wing finger folded back along the flank
  vec3 yawF = vec3(1.2, -1.35, 1.58), elF = vec3(-0.55, -1.0, 0.22);
#else
  vec3 yawS = vec3(0.3, -0.18, 0.28), elS = vec3(0.04, 0.02, -0.04);
  vec3 yawD = vec3(1.0, 0.35, 0.8), elD = vec3(0.1, 0.0, 0.0);
  vec3 yawF = vec3(1.45, -1.9, 1.62), elF = vec3(-0.2, -0.25, 0.05);
#endif
  vec3 yaw = mix(mix(yawS, yawD, sweep), yawF, fold);
  vec3 el = mix(mix(elS, elD, sweep), elF, fold);
  // the stroke: shoulder leads, elbow and wrist lag; the wing sweeps a little forward on the
  // downstroke and back on the upstroke
  float s0 = sin(ph), s1 = sin(ph - 0.7), s2 = sin(ph - 1.3);
  float k = amp * (1.0 - fold);
  el += vec3(k * s0, k * 0.45 * s1, k * 0.5 * s2);
  yaw += vec3(-k * 0.18 * cos(ph), k * 0.1 * cos(ph - 0.7), k * 0.25 * cos(ph - 1.3) + twist * 0.0);
  Chain c;
  c.S = vec3(SH.x * side, SH.y, SH.z);
  c.E = c.S + boneDir(yaw.x, el.x, side) * LH;
  c.W = c.E + boneDir(yaw.y, el.y, side) * LF;
  c.F = c.W + boneDir(yaw.z, el.z, side) * LI;
  // the membrane's root on the leg (ankle), trailing behind in flight, tucked when perched
#if SPECIES == 0
  vec3 ankFly = vec3(side * 0.07, -0.02, -0.17);
  vec3 ankRest = vec3(side * 0.06, -0.12, -0.08);
#else
  vec3 ankFly = vec3(side * 0.06, -0.02, -0.12);
  vec3 ankRest = vec3(side * 0.05, -0.03, -0.08);
#endif
  c.A = mix(ankFly, ankRest, fold);
  vec3 span = c.F - c.S;
  vec3 chord = c.A - c.W;
  c.nrm = normalize(cross(chord, span)) * side;
  return c;
}

// The coilwing's hind wing: the leg (hip - knee - ankle - toe) held out back and to the side
// in flight with long feathers on the shank; tucked down to stand when perched.
Chain hindChain(float side, float ph, float amp, float fold, float sweep) {
  // in flight the legs sprawl out to the sides and back (a second, smaller pair of wings
  // behind the first); perched, they fold down to stand
  vec3 yawS = vec3(0.62, 0.95, 1.15), elS = vec3(-0.12, -0.04, 0.0);
  vec3 yawF = vec3(0.3, -0.5, 0.2), elF = vec3(-1.2, -1.25, -0.4);
  vec3 yaw = mix(yawS, yawF, fold);
  vec3 el = mix(elS, elF, fold);
  float k = amp * 0.5 * (1.0 - fold);
  el += vec3(k * sin(ph - 1.6), k * 0.6 * sin(ph - 2.0), 0.0);
  yaw += vec3(sweep * 0.25, sweep * 0.1, 0.0);
  Chain c;
  c.S = vec3(side * ${fl(COILWING.hipJoint[0])}, ${fl(COILWING.hipJoint[1])}, ${fl(COILWING.hipJoint[2])});
  c.E = c.S + boneDir(yaw.x, el.x, side) * 0.16;
  c.W = c.E + boneDir(yaw.y, el.y, side) * 0.19;
  c.F = c.W + boneDir(yaw.z, el.z, side) * 0.11;
  c.A = vec3(side * 0.02, 0.0, -0.3);
  c.nrm = normalize(cross(c.A - c.W, c.F - c.S)) * side;
  return c;
}

// leading edge along the chain by span u (breakpoints at the elbow and wrist)
vec3 chainPoint(Chain c, float u, float uE, float uW) {
  if (u < uE) return mix(c.S, c.E, u / uE);
  if (u < uW) return mix(c.E, c.W, (u - uE) / (uW - uE));
  return mix(c.W, c.F, (u - uW) / (1.0 - uW));
}

// a point on a wing surface: span u, chord v, top / bottom sheet sgn
vec3 wingSurface(Chain c, float u, float v, float sgn, float side, float fold, float hind) {
  float uE = hind > 0.5 ? 0.35 : LH / (LH + LF + LI);
  float uW = hind > 0.5 ? 0.75 : (LH + LF) / (LH + LF + LI);
  vec3 le = chainPoint(c, u, uE, uW);
  vec3 te;
#if SPECIES == 0
  // membrane: from the ankle out to the wing-finger tip, the trailing edge bowed inward
  te = mix(c.A, c.F, smoothstep(0.0, 1.0, u * 1.02));
  vec3 tipDir = normalize(c.F - c.W);
  te += (le - te) * 0.18 * sin(3.14159 * u) ;
  // propatagium: a narrow membrane in front of the arm, from shoulder to wrist
  vec3 fwdBody = vec3(0.0, 0.0, 1.0);
  le += fwdBody * 0.035 * sin(3.14159 * clamp(u / uW, 0.0, 1.0)) * (1.0 - fold);
  // wing finger tip: the membrane narrows to a point; folded, it collapses along the arm
  te = mix(te, le, smoothstep(0.86, 1.0, u));
  te = mix(te, le, fold * 0.88);
#else
  // feathers: the trailing edge is the line of feather tips, longest at the hand (primaries)
  vec3 back = normalize(mix(vec3(0.0, -0.05, -1.0), -normalize(c.F - c.S) * 0.3 + vec3(0.0, 0.0, -1.0), 0.35));
  float fl;
  // (secondaries along the forearm, long primaries on the hand, the tip rounded)
  if (hind > 0.5) fl = 0.1 + 0.15 * smoothstep(0.1, 0.85, u) - 0.06 * smoothstep(0.9, 1.0, u);
  else fl = 0.15 + 0.22 * smoothstep(0.25, 0.8, u) - 0.2 * smoothstep(0.88, 1.0, u);
  // the feathers sweep toward the tip along the hand, back along the arm
  vec3 along = normalize(c.F - c.S);
  vec3 fdir = normalize(back * (1.0 - u * 0.5) + along * u * 0.75);
  fdir = mix(fdir, normalize(vec3(0.0, -0.05, -1.0)), fold * 0.8);
  te = le + fdir * fl;
#endif
  float chordLen = length(te - le);
  vec3 p = mix(le, te, v);
  // camber (the membrane / feather sheet bellies under the airflow) and the arm's thickness
  float cam = 4.0 * v * (1.0 - v) * chordLen * (0.08 + 0.04 * (1.0 - fold));
  float th = (0.022 * (1.0 - u * 0.75)) * smoothstep(0.35, 0.0, v) + 0.0015;
  p += c.nrm * (cam + sgn * th * 0.5);
  return p;
}

// Hermite curve
vec3 herm(vec3 p0, vec3 t0, vec3 p1, vec3 t1, float u) {
  float u2 = u * u, u3 = u2 * u;
  return (2.0 * u3 - 3.0 * u2 + 1.0) * p0 + (u3 - 2.0 * u2 + u) * t0 + (-2.0 * u3 + 3.0 * u2) * p1 + (u3 - u2) * t1;
}

// tail centreline (u 0..1 from the hip): streaming with a lazy wave, or rolled into a coil
vec3 tailPoint(float u, float curl, float ph, float seed, out vec3 tang) {
  vec3 hip = vec3(0.0, 0.0, -0.12);
#if SPECIES == 0
  float L = ${fl(SKIMMER.tailLen)};
#else
  float L = ${fl(COILWING.tailLen)};
#endif
  // integrate a curve whose curvature grows along the tail (a spiral when curl -> 1)
  vec3 p = hip;
  float ang = 0.15 * curl;
  const int N = 10;
  float du = u / float(N);
  vec3 d = vec3(0.0, 0.0, -1.0);
  for (int i = 0; i < N; i++) {
    float s = (float(i) + 0.5) * du;
    float k = curl * (1.2 + 9.0 * pow(s, 2.2));
    ang += k * du;
    d = vec3(0.0, -sin(ang), -cos(ang));
    p += d * du * L;
  }
  // a wave travels down the streaming tail
  float wv = (1.0 - curl) * 0.05 * u * sin(ph * 0.5 - u * 6.0 + seed);
  p.x += wv;
  p.y += (1.0 - curl) * 0.02 * u * sin(ph * 0.5 - u * 5.0 + 1.0);
  tang = d;
  return p;
}

void main() {
  float part = aB.x;
  float u = aB.y, v = aB.z, side = aB.w;
  float sc = iPos.w;
  float ph = iAnim.x, amp = iAnim.y, fold = iAnim.z, sweep = iAnim.w;
  float hy = iAnim2.x, hp = iAnim2.y, jaw = iAnim2.z;
#if SPECIES == 1
  float curl = iAnim2.w;   // the tail's coil
  float crest = iSeed.w;   // quills raised
#else
  float curl = 0.0;
  float crest = iAnim2.w;  // crest display
#endif
  float legs = iSeed.z;
  vec3 p = position;
  vec3 n = normal;
  // breathing and the body's bob with the wingbeat
  float bob = -0.012 * amp * sin(ph + 0.4) * (1.0 - fold);
  // head frame (neck turns with the head)
#if SPECIES == 0
  vec3 nb = vec3(${v3(SKIMMER.neckBase)});
  vec3 hb = vec3(${v3(SKIMMER.headBase)});
#else
  vec3 nb = vec3(${v3(COILWING.neckBase)});
  vec3 hb = vec3(${v3(COILWING.headBase)});
#endif
  // perched: the neck rises
  vec3 hbR = hb + vec3(0.0, 0.06 * fold, -0.03 * fold);
  mat3 RH = rotY(hy) * rotX(-hp - 0.25 * fold);
  vec3 headP = nb + RH * (hbR - nb);
  if (part < 0.5) {
    // torso
    p.y += bob;
    p *= 1.0 + 0.02 * sin(uTime * 2.2 + iSeed.x * 7.0) * smoothstep(-0.05, 0.08, p.z);
  } else if (part < 1.5) {
    // neck: a curve from the shoulders to the head
    vec3 t0 = normalize(hb - nb) * 0.2;
    vec3 t1 = RH * normalize(hb - nb) * 0.2;
    vec3 c = herm(nb + vec3(0.0, bob, 0.0), t0, headP, t1, u);
    vec3 tg = normalize(herm(nb, t0, headP, t1, min(u + 0.02, 1.0)) - herm(nb, t0, headP, t1, max(u - 0.02, 0.0)));
    vec3 X = normalize(cross(vec3(0.0, 1.0, 0.0), tg) + 1e-5);
    vec3 Y = cross(tg, X);
    vec3 ring = X * aB2.x + Y * aB2.y;
    p = c + ring * aB2.z;
    n = ring;
  } else if (part < 5.5 || (part > 10.5 && part < 11.5)) {
    // head, beak, jaw, crest, eyes: rigid in the head frame
    vec3 q = p;
    if (part > 3.5 && part < 4.5) {
      // the lower jaw hinges open (skimming, calling, swallowing)
      vec3 hinge = vec3(0.0, -0.006, 0.09);
      q = hinge + rotX(jaw) * (q - hinge);
      n = rotX(jaw) * n;
    }
    if (part > 4.5 && part < 5.5) {
#if SPECIES == 0
      // the spiral crest flushes and lifts a little when displaying
      q = vec3(0.0, 0.065, -0.035) + (q - vec3(0.0, 0.065, -0.035)) * (1.0 + 0.08 * crest);
#else
      // quills raise (alarm, display) or lie flat
      vec3 r0 = vec3(0.0, 0.03, 0.05);
      q = r0 + rotX(-(1.0 - crest) * 0.9) * (q - r0);
      n = rotX(-(1.0 - crest) * 0.9) * n;
#endif
    }
    p = headP + RH * q;
    n = RH * n;
  } else if (part < 7.5) {
    // tail and its vane / frond
    vec3 tg;
    if (part < 6.5) {
      vec3 c = tailPoint(u, curl, ph, iSeed.x * 6.0, tg);
      vec3 X = normalize(cross(vec3(0.0, 1.0, 0.0), tg) + vec3(1e-5, 0.0, 0.0));
      if (abs(tg.y) > 0.98) X = vec3(1.0, 0.0, 0.0);
      vec3 Y = cross(tg, X);
      vec3 ring = X * aB2.x + Y * aB2.y;
      p = c + ring * aB2.z;
      n = ring;
    } else {
#if SPECIES == 0
      // diamond vane at the tip
      vec3 c = tailPoint(1.0, curl, ph, iSeed.x * 6.0, tg);
      p = c + vec3(p.x, p.y, 0.0) + tg * (-p.z);
#else
      // a frond of feathers along the last part of the tail
      float uu = 0.8 + u * 0.2;
      vec3 c = tailPoint(uu, curl, ph, iSeed.x * 6.0, tg);
      vec3 X = normalize(cross(vec3(0.0, 1.0, 0.0), tg) + vec3(1e-5, 0.0, 0.0));
      p = c + X * p.x * (1.0 + 0.3 * (1.0 - curl)) + tg * 0.04 * v;
      n = cross(tg, X);
#endif
    }
  } else if (part < 9.5) {
    // wings
    float hind = part > 8.5 ? 1.0 : 0.0;
    float sgn = aB2.x;
    Chain c;
#if SPECIES == 1
    if (hind > 0.5) c = hindChain(side, ph, amp, fold, sweep);
    else
#endif
    c = foreChain(side, ph, amp, fold, sweep, iSeed.w);
    p = wingSurface(c, u, v, sgn, side, fold, hind);
    vec3 pu = wingSurface(c, min(u + 0.01, 1.0), v, sgn, side, fold, hind) - wingSurface(c, max(u - 0.01, 0.0), v, sgn, side, fold, hind);
    vec3 pv = wingSurface(c, u, min(v + 0.02, 1.0), sgn, side, fold, hind) - wingSurface(c, u, max(v - 0.02, 0.0), sgn, side, fold, hind);
    n = normalize(cross(pv, pu)) * side * sgn;
    p.y += bob * (1.0 - u);
  } else if (part < 10.5) {
    // legs: hip - knee - ankle, trailing in flight, standing when perched or landing
    vec3 hip = vec3(side * 0.035, -0.02, -0.1);
    vec3 kneeF = hip + vec3(side * 0.02, -0.03, -0.06);
    vec3 ankF = kneeF + vec3(side * 0.01, -0.005, -0.08);
    vec3 kneeD = hip + vec3(side * 0.02, -0.05, 0.03);
    vec3 ankD = kneeD + vec3(0.0, -0.08, -0.02);
    vec3 knee = mix(kneeF, kneeD, legs);
    vec3 ank = mix(ankF, ankD, legs);
    vec3 c = u < 0.5 ? mix(hip, knee, u * 2.0) : mix(knee, ank, u * 2.0 - 1.0);
    vec3 tg = normalize(u < 0.5 ? knee - hip : ank - knee);
    vec3 X = normalize(cross(vec3(1.0, 0.0, 0.0), tg) + 1e-5);
    vec3 Y = cross(tg, X);
    vec3 ring = X * aB2.x + Y * aB2.y;
    p = c + ring * aB2.z;
    n = ring;
  } else {
    // wrist claws ride the wrist of the fore wing
    Chain c = foreChain(side, ph, amp, fold, sweep, 0.0);
    vec3 fwd = normalize(c.W - c.E);
    vec3 q = vec3(p.x * side, p.y, p.z);
    p = c.W + vec3(0.0, q.y, 0.0) + fwd * q.z * 0.5 + vec3(0.0, 0.0, q.z * 0.6) + vec3(side * 0.006, 0.0, 0.0);
  }
  vec3 wp = iPos.xyz + qrot(iQuat, p * sc);
  vWorldPos = wp;
  vNormal = normalize(qrot(iQuat, n));
  vB = aB;
  vLocal = position;
  vSeed = iSeed;
  vPose = vec4(fold, jaw, crest, amp);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vPx = sc * projectionMatrix[1][1] * uResolution.y * 0.5 / max(-mv.z, 0.01);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
${SEA}
${ECO_FRAG}
uniform vec3 uPalA[4];
uniform vec3 uPalB[4];
uniform vec3 uPalC[4];
uniform vec3 uPalD[4];
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vB;
varying vec3 vLocal;
varying vec4 vSeed;
varying vec4 vPose;
varying float vPx;

void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  float part = vB.x;
  float u = vB.y, v = vB.z, side = vB.w;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  // thin parts (membranes, feathers, crests, vanes) show whichever face looks at us
  bool thin = (part > 4.5 && part < 5.5) || (part > 6.5 && part < 9.5) || part > 11.5;
  if (thin && dot(N, V) < 0.0) N = -N;
  int pal = int(clamp(floor(vSeed.y), 0.0, 3.0));
  float tint = fract(vSeed.y);
  float seed = vSeed.x;
  vec3 pA = uPalA[pal] * (0.88 + 0.24 * tint), pB = uPalB[pal], pC = uPalC[pal], pD = uPalD[pal];
  vec3 albedo = pA;
  float trans = 0.15, spec = 0.15, gloss = 0.6, rim = 0.6, wrap = 0.3, ao = 1.0;
  float alpha = 1.0;
  vec3 emis = vec3(0.0);
  float sheen = 0.0;
  vec3 sheenCol = vec3(0.0);
  vec3 L = vLocal;
#if SPECIES == 0
  // ======================= skimmer =======================
  if (part < 0.5 || (part > 0.5 && part < 1.5)) {
    // pycnofibre fur: slate back, cream belly, a darker saddle; fine fuzz
    float under = smoothstep(-0.2, -0.7, dot(N, normalize(vec3(0.0, 1.0, 0.0))));
    albedo = mix(pA, pB, under);
    float fuzz = vnoise(vec2(u * 140.0, v * 90.0) + seed * 7.0);
    albedo *= 0.85 + 0.3 * fuzz;
    trans = 0.35; rim = 1.1; wrap = 0.4;
  } else if (part < 2.5) {
    // skull: smooth skin, a dark mask through the eye, cream throat
    float under = smoothstep(-0.1, -0.6, N.y);
    albedo = mix(pA * 0.9, pB, under);
    float mask = smoothstep(0.012, 0.002, abs(L.y - 0.012 - (L.z - 0.06) * 0.15)) * smoothstep(0.0, 0.03, L.z);
    albedo = mix(albedo, vec3(0.03), mask * 0.8);
    spec = 0.25; gloss = 0.7;
  } else if (part < 4.5) {
    // the long two-tone beak: dark upper, bright orange-red lower blade with a black tip
    float tip = smoothstep(0.75, 0.95, u);
    if (part < 3.5) albedo = mix(vec3(0.07, 0.06, 0.06), vec3(0.02), tip);
    else albedo = mix(mix(pD, vec3(0.95, 0.55, 0.15), 0.4), vec3(0.03), tip);
    // tiny needle teeth along the cutting edges
    float teeth = smoothstep(0.6, 0.95, sin(u * 120.0)) * smoothstep(0.004, 0.0, abs(abs(L.x) - 0.004)) * step(0.2, u) * step(u, 0.85);
    albedo = mix(albedo, vec3(0.9, 0.88, 0.8), teeth);
    spec = 0.6; gloss = 0.85; rim = 0.5;
  } else if (part < 5.5) {
    // the spiral crest: bone and skin, coral with growth bands that follow the coil
    float band = 0.5 + 0.5 * sin(u * 70.0);
    albedo = mix(pD * 0.75, pD * 1.1, band * 0.5);
    albedo = mix(albedo, vec3(0.95, 0.9, 0.82), smoothstep(0.8, 1.0, v) * 0.6);
    albedo = mix(albedo, pA * 0.6, smoothstep(0.25, 0.0, v));
    trans = 1.0; rim = 0.9; spec = 0.3;
    // flushes with blood when displaying
    emis += pD * 0.08 * vPose.z;
  } else if (part < 6.5) {
    albedo = mix(pA, pB, smoothstep(-0.2, -0.6, N.y));
    albedo *= 0.85 + 0.25 * smoothstep(0.6, 0.9, sin(u * 40.0));
    trans = 0.3;
  } else if (part < 7.5) {
    // tail vane: a pale diamond with a dark rim
    float rimV = smoothstep(0.6, 1.0, abs(u - 0.5) * 2.0 + abs(v - 0.5) * 0.6);
    albedo = mix(pD * 0.9, vec3(0.08), rimV);
    trans = 1.0;
  } else if (part < 9.5) {
    // wing membrane: warm translucent skin, darker toward the trailing edge, actinofibrils
    // running from the leading edge to the trailing edge, a vein net, the arm furred
    float arm = smoothstep(0.22, 0.05, v);
    // actinofibrils drawn by hand: they wander, swell and fade instead of ruling the wing
    float fw = vnoise(vec2(u * 7.0, v * 3.0) + seed * 3.0);
    float fib = smoothstep(0.55, 1.0, sin(u * 160.0 + v * 22.0 + fw * 3.0 + sin(v * 7.0 + u * 13.0) * 1.2)) * (0.45 + 0.55 * vnoise(vec2(u * 25.0, v * 4.0) - seed));
    float veins = smoothstep(0.12, 0.0, abs(sin(u * 30.0 + v * 6.0 + vnoise(vec2(u, v) * 18.0) * 2.0)) - 0.0) * 0.4;
    vec3 mem = mix(pC, pA, 0.35) * 0.62 * (0.8 + 0.2 * vnoise(vec2(u * 9.0, v * 5.0) + seed));
    mem = mix(mem, mem * 0.55, smoothstep(0.55, 1.0, v));
    mem *= 1.0 - fib * 0.12 - veins * 0.2;
    // a dark band near the tip
    mem = mix(mem, pA * 0.5, smoothstep(0.75, 0.9, u) * 0.6);
    albedo = mix(mem, pA, arm);
    trans = mix(1.8, 0.3, arm);
    rim = 0.5;
    wrap = 0.45;
    // ragged trailing edge
    float edge = 0.965 + 0.025 * sin(u * 90.0 + seed * 10.0 + sin(u * 23.0) * 1.5) + 0.02 * (vnoise(vec2(u * 40.0, seed * 7.0)) - 0.5);
    alpha = 1.0 - smoothstep(edge - 0.02, edge + 0.01, v);
  } else if (part < 10.5) {
    albedo = mix(pA * 0.7, vec3(0.12, 0.1, 0.09), smoothstep(0.6, 1.0, u));
    trans = 0.2;
  } else if (part < 11.5) {
    // small dark eye with a gold ring and a wet highlight
    float r = length(L.yz - vec2(0.012, 0.075)) / 0.009;
    albedo = mix(vec3(0.01), vec3(0.75, 0.55, 0.15), smoothstep(0.55, 0.75, r) * 0.6);
    spec = 2.0; gloss = 0.97; rim = 0.2;
  } else {
    albedo = vec3(0.1, 0.09, 0.08);
  }
#else
  // ======================= coilwing =======================
  if (part < 1.5) {
    // feathered body: dark iridescent plumage, a buff throat and belly
    float under = smoothstep(-0.15, -0.65, N.y);
    albedo = mix(pA, pB, under * 0.85);
    float fea = vnoise(vec2(u * 60.0, v * 40.0) + seed * 3.0);
    albedo *= 0.85 + 0.3 * fea;
    sheen = 0.6 * (1.0 - under);
    sheenCol = pC;
    trans = 0.3; rim = 1.0; wrap = 0.4;
  } else if (part < 2.5) {
    // scaled head: small scales, a pale lip line, dark mask
    vec4 sc = fishScales(vec2(L.z * 260.0, atan(L.x, L.y) * 9.0));
    albedo = mix(pA * 0.9, pB * 0.8, smoothstep(-0.2, -0.7, N.y));
    albedo *= 1.0 - smoothstep(0.75, 1.0, sc.x) * 0.3;
    // a long gape with a pale lip line and tiny teeth, a dark stripe through the eye
    float gy = -0.006 - (L.z - 0.06) * 0.1;
    float lip = smoothstep(0.003, 0.0, abs(L.y - gy)) * smoothstep(0.03, 0.06, L.z);
    albedo = mix(albedo, vec3(0.85, 0.8, 0.65), lip * 0.8);
    float teeth = smoothstep(0.55, 0.95, sin(L.z * 900.0)) * smoothstep(0.004, 0.0015, abs(L.y - gy + 0.002)) * smoothstep(0.06, 0.08, L.z);
    albedo = mix(albedo, vec3(0.92, 0.9, 0.82), teeth * 0.7);
    float stripe = smoothstep(0.006, 0.0, abs(L.y - 0.012 - (L.z - 0.045) * 0.25)) * step(abs(L.x), 0.035) * smoothstep(0.0, 0.02, L.z);
    albedo = mix(albedo, pA * 0.3, stripe * 0.6);
    sheen = 0.4; sheenCol = pC;
    spec = 0.3; gloss = 0.75;
  } else if (part < 5.5) {
    // quill crest: dark barred spines tipped with colour
    albedo = mix(pA, pD, smoothstep(0.5, 1.0, v));
    albedo *= 0.8 + 0.2 * smoothstep(0.6, 0.9, sin(v * 30.0));
    trans = 0.8;
    float qedge = abs(fract(u * 6.0) - 0.5);
    alpha = smoothstep(0.5, 0.3, qedge + v * 0.15);
  } else if (part < 6.5) {
    // tail: scaled at the base, feathered (banded) toward the tip
    albedo = mix(pA, pB, smoothstep(-0.2, -0.6, N.y) * 0.5);
    float bands = smoothstep(0.2, 0.0, abs(fract(u * 9.0 + 0.12 * sin(N.x * 4.0 + u * 31.0)) - 0.5) - 0.3) * smoothstep(0.25, 0.4, u);
    albedo = mix(albedo, pD * 0.9, bands * 0.55);
    sheen = 0.3; sheenCol = pC;
  } else if (part < 7.5) {
    // tail frond: banded feathers with dark tips
    float fe = fract(u * 7.0);
    albedo = mix(pA, pD, smoothstep(0.3, 0.7, v));
    albedo = mix(albedo, vec3(0.04), smoothstep(0.85, 1.0, v));
    alpha = smoothstep(1.0, 0.85, v + abs(fe - 0.5) * 0.35);
    sheen = 0.5; sheenCol = pC;
    trans = 0.7;
  } else if (part < 9.5) {
    // feathered wings: coverts near the arm, then long flight feathers with a rachis, vanes
    // and dark tips; the hand's primaries separate into slotted 'fingers'
    float hind = part > 8.5 ? 1.0 : 0.0;
    float nF = hind > 0.5 ? 9.0 : 15.0;
    // feather boundaries curve and wander a little (hand-drawn, never ruled)
    float f = u * nF + 0.18 * sin(v * 4.5 + u * 9.0 + seed) + (vnoise(vec2(u * 30.0, v * 2.0) + seed) - 0.5) * 0.18;
    float fi = fract(f);
    float vw = v + 0.02 * sin(u * 37.0 + seed * 3.0);
    float covert = smoothstep(0.42, 0.25, v);
    float rachis = smoothstep(0.06, 0.0, abs(fi - 0.5 + (v - 0.5) * 0.2)) * (1.0 - covert);
    float tipD = smoothstep(0.78, 0.95, v);
    albedo = mix(pA * 1.1, pA * 0.7, v);
    // one coloured bar across the coverts, and a thin pale fringe on each feather
    float bar = smoothstep(0.2, 0.3, vw) * smoothstep(0.42, 0.32, vw);
    albedo = mix(albedo, pD * 0.85, bar * 0.8 * (1.0 - hind * 0.5));
    float fringe = smoothstep(0.035, 0.0, abs(abs(fi - 0.5) - 0.47)) * (1.0 - covert);
    albedo = mix(albedo, pB * 0.6, fringe * 0.35);
    albedo = mix(albedo, vec3(0.9, 0.86, 0.78) * 0.7, tipD * 0.35);
    albedo = mix(albedo, pB * 0.7, covert * 0.2);
    albedo *= 1.0 - rachis * 0.35;
    // every feather a little different, a dark seam where the vanes overlap, barbs
    float fid = hash11(floor(f) + seed * 13.0);
    albedo *= 0.82 + 0.3 * fid;
    float seam = smoothstep(0.08, 0.0, min(fi, 1.0 - fi)) * (1.0 - covert);
    albedo *= 1.0 - seam * 0.45;
    float barbs = smoothstep(0.5, 1.0, sin((fi - v * 0.6) * 90.0)) * (1.0 - covert) * smoothstep(40.0, 120.0, vPx);
    albedo *= 1.0 - barbs * 0.12;
    // covert rows: small rounded feathers in offset rows near the arm
    float cr = fract(u * nF * 2.0 + floor(v * 9.0) * 0.5);
    albedo *= 1.0 - covert * smoothstep(0.75, 1.0, fract(v * 9.0)) * (0.3 + 0.2 * cr);
    // each feather's rounded tip; primaries at the hand separate (slots)
    float slot = hind < 0.5 ? smoothstep(0.62, 0.85, u) : 0.0;
    float tipShape = 0.92 - 0.18 * pow(abs(fi - 0.5) * 2.0, 2.0) * (0.5 + slot);
    alpha = smoothstep(tipShape + 0.02, tipShape - 0.02, v);
    sheen = 0.75 * (1.0 - covert * 0.4);
    sheenCol = pC;
    trans = 0.4; rim = 0.6; wrap = 0.4;
  } else if (part < 10.5) {
    // scaled legs and claws
    albedo = mix(vec3(0.16, 0.13, 0.1), vec3(0.05), smoothstep(0.7, 1.0, u));
    spec = 0.3;
  } else {
    // eye: large, gold iris with a round pupil
    vec2 q = (L.yz - vec2(0.012, 0.045)) / 0.0095;
    float r = length(q);
    albedo = mix(vec3(0.012), mix(vec3(0.85, 0.6, 0.12), vec3(0.35, 0.2, 0.05), r), smoothstep(0.42, 0.5, r));
    spec = 2.2; gloss = 0.97; rim = 0.2;
  }
#endif
  if (alpha < 0.02) discard;
  Surface sf = makeSurface(albedo, N, vWorldPos);
  sf.shadow = vPx > 8.0 ? sampleShadow(vWorldPos, N) : 1.0;
  sf.ao = ao;
  sf.rim = rim;
  sf.trans = trans;
  // painted look: broad, soft highlights on bodies and fins (eyes keep their sharp catchlight)
  float eyeK = step(1.5, spec);
  sf.spec = mix(spec * 0.6, spec, eyeK);
  sf.gloss = mix(min(gloss, 0.72), gloss, eyeK);
  sf.wrap = wrap;
  sf.emissive = emis;
  vec3 col = stylizedLight(sf);
  // iridescent plumage: a structural colour that shifts with the angle and catches the sky
  if (sheen > 0.0) {
    float cosT = abs(dot(N, V));
    vec3 ir = iridescence(cosT, 1.6 + tint * 0.6) * sheenCol;
    vec3 R = reflect(-V, N);
    float ndl = clamp(dot(N, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
    vec3 env = seaLightField(R, 1.0) * 0.5 + uSunColor * pow(max(dot(R, uSunDir), 0.0), 12.0) * 0.6;
    col += ir * (env * 0.6 + uSunColor * 0.15 * ndl) * sheen * (0.25 + 0.75 * pow(1.0 - cosT, 1.5)) * sf.shadow;
  }
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, alpha);
}
`;

export function reptileMaterial(species) {
  const P = REPTILE_PALETTES[species];
  const m = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: { SPECIES: species === 'skimmer' ? 0 : 1 },
    uniforms: Object.assign({}, G, {
      uPalA: { value: P.map((p) => p[0]) },
      uPalB: { value: P.map((p) => p[1]) },
      uPalC: { value: P.map((p) => p[2]) },
      uPalD: { value: P.map((p) => p[3]) },
    }),
    side: DoubleSide,
  });
  m.alphaToCoverage = true;
  return m;
}

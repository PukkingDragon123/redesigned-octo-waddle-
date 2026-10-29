// Flying bugs of Vur Sok: three alien sky-insect species the calf can catch and eat.
//  - lumen moth:  big soft four-winged moths with glowing eye spots; drifting clouds near islands,
//                 brighter at dusk and night. Also flown into rings for the playmates' races.
//  - spiral gnat: tiny glowing gnats in tight clouds that coil like the planet's spirals.
//  - skitterfly:  iridescent four-winged skimmers in shimmering ribbons just over the sea.
// One instanced draw per species (5 quads per bug: body billboard + two pairs of flapping wings),
// CPU-simulated in swarms (formation + a sprung flee offset), only swarms near the camera are
// simulated and drawn. No per-frame allocations.
import {
  InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor, DynamicDrawUsage, Vector3, Vector4, Color,
} from 'three';
import { G } from '../../render/Globals.js';
import { UNIFORMS, NOISE, LIGHTING } from '../../render/shaders/common.js';

const TAU = Math.PI * 2;
const smoothstep01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Species definitions (sizes in metres; the calf is 4.2 m long). */
export const BUG_SPECIES = {
  moth: {
    slots: 12, block: 32, size: 0.62, flap: 9, amp: 0.8, base: 0.3, minPx: 2.2,
    bodyW: 0.1, bodyL: 0.42, wing: [1.0, 0.85, 0.82, 0.8],
    colA: 0xf0a868, colB: 0x7c68b8, glow: 0xffc870, glowDay: 0.35, glowNight: 2.4,
    flee: 6.5, fleeR: 6.5, catchR: 1.9, energy: 0.03, wake: 1, shape: 0, drawDist: 520,
  },
  gnat: {
    slots: 5, block: 96, size: 0.24, flap: 38, amp: 0.55, base: 0.35, minPx: 1.7,
    bodyW: 0.3, bodyL: 0.42, wing: [0.8, 0.5, 0.6, 0.45],
    colA: 0xc8ff9a, colB: 0x6ff2d8, glow: 0xb8ff8a, glowDay: 0.4, glowNight: 2.0,
    flee: 3.2, fleeR: 4.5, catchR: 2.3, energy: 0.009, wake: 0.6, shape: 1, drawDist: 380,
  },
  skitter: {
    slots: 5, block: 40, size: 0.56, flap: 24, amp: 0.42, base: 0.04, minPx: 1.9,
    bodyW: 0.07, bodyL: 0.95, wing: [1.0, 0.36, 0.95, 0.34],
    colA: 0x5ff2e6, colB: 0xd27aff, glow: 0x8ff0ff, glowDay: 0.3, glowNight: 1.6,
    flee: 9, fleeR: 9, catchR: 1.7, energy: 0.04, wake: 1.2, shape: 2, drawDist: 420,
  },
};

const VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
attribute vec4 aP; // xyz position, w size multiplier
attribute vec4 aD; // xyz heading, w phase
attribute vec4 aS; // x flap rate, y excitement (fleeing), z variant, w alpha
attribute vec4 aX; // x streak (being sucked in), y roll (spin), z flap amplitude (glide 0..1), w -
uniform float uSize, uFlap, uAmp, uBase, uMinPx, uBodyW, uBodyL;
uniform vec4 uWing;
varying vec2 vUv;
varying float vPart;
varying float vAlpha;
varying float vFar;
varying float vFog;
varying vec3 vFogCol;
varying vec3 vN;
varying vec3 vV;
varying vec2 vVar;
varying float vBlur;
varying float vStreak;
void main() {
  vec3 f = aD.xyz;
  float fl = length(f);
  f = fl > 1e-4 ? f / fl : vec3(0.0, 0.0, 1.0);
  vec3 r = cross(vec3(0.0, 1.0, 0.0), f);
  float rl = length(r);
  r = rl > 1e-3 ? r / rl : vec3(1.0, 0.0, 0.0);
  vec3 u = cross(f, r);
  // spinning as it is sucked in: roll the body frame about its heading
  float cr = cos(aX.y), sr = sin(aX.y);
  vec3 r0 = r;
  r = r0 * cr + u * sr;
  u = u * cr - r0 * sr;
  vStreak = aX.x;
  vBlur = 0.0;
  vec3 toC = uCamPos - aP.xyz;
  float dist = max(length(toC), 0.05);
  vec3 V = toC / dist;
  // keep a minimum size on screen (far swarms read as glittering specks, never alias away)
  float px = aP.w * uSize * projectionMatrix[1][1] * uResolution.y * 0.5 / dist;
  float grow = max(1.0, uMinPx / max(px, 1e-3));
  float s = aP.w * uSize * grow;
  vFar = smoothstep(1.2, 3.0, grow);
  float part = position.y;
  float ph = uTime * uFlap * aS.x + aD.w * 6.2831;
  vec3 lp;
  if (part < 0.5) {
    vec3 side = cross(f, V);
    float sl = length(side);
    side = sl > 1e-3 ? side / sl : r;
    // the wide quad (antennae, legs) shrinks back to the body's own when far: no wasted fill
    vec2 pq = mix(position.xz, clamp(position.xz, -1.0, 1.0), vFar);
    // sucked in: the glow streaks out behind it
    float tail = pq.y < 0.0 ? 1.0 + aX.x * 7.0 : 1.0;
    lp = side * pq.x * uBodyW * (1.0 + vFar * 2.0) + f * pq.y * uBodyL * tail;
    vN = V;
    vUv = pq;
  } else {
    float hind = part > 2.5 ? 1.0 : 0.0;
    float sgn = position.x < 0.0 ? -1.0 : 1.0;
    float span = abs(position.x);
    // the stroke: amplitude eases down to a held V when gliding; the hindwings lag the forewings
    float flapK = aX.z;
    float wph = ph - hind * 0.7;
    float a = uBase + (1.0 - flapK) * 0.45 + sin(wph) * uAmp * flapK * (1.0 - 0.15 * hind) * (1.0 + aS.y * 0.4);
    // figure-of-eight: the tip sweeps forward and back at twice the beat, and the wing feathers
    // (pitches) through each stroke, leading edge down on the downstroke
    float sweep = ((0.12 + 0.12 * sin(wph)) + 0.16 * sin(2.0 * wph) * flapK) * span;
    float feather = cos(wph) * 0.55 * flapK;
    float sx = mix(uWing.x, uWing.z, hind), sz = mix(uWing.y, uWing.w, hind);
    span *= sx * (1.0 - vFar * 0.6);
    vec3 sd = r * sgn * cos(a) + u * sin(a);
    vec3 wn = -r * sgn * sin(a) + u * cos(a);
    vec3 cd = f * cos(feather) - wn * sin(feather);
    lp = sd * span + cd * position.z * sz - f * sweep;
    vN = normalize(cross(cd, sd));
    // motion blur: the faster the wing sweeps, the more it smears into a translucent fan
    vBlur = clamp(uFlap * aS.x * uAmp * flapK * abs(cos(wph)) / 24.0, 0.0, 0.85);
    vUv = vec2(abs(position.x), position.z + (hind > 0.5 ? 0.95 : 0.3));
  }
  vPart = part;
  vec3 wp = aP.xyz + lp * s;
  vAlpha = aS.w / mix(1.0, grow, 0.7);
  vVar = aS.zy;
  vV = V;
  vFog = fogAmount(aP.xyz);
  vFogCol = fogColorFor(-V);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
uniform vec3 uColA, uColB, uGlowCol;
uniform float uGlowDay, uGlowNight, uShape, uBodyW, uBodyL;
varying vec2 vUv;
varying float vPart;
varying float vAlpha;
varying float vFar;
varying float vFog;
varying vec3 vFogCol;
varying vec3 vN;
varying vec3 vV;
varying vec2 vVar;
varying float vBlur;
varying float vStreak;
float ell(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; return dot(q, q); }
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// a limb or antenna: two bent segments (a knee), width w tapering to the tip; returns coverage
float limb(vec2 p, vec2 a, vec2 k, vec2 b, float w) {
  float d1 = seg(p, a, k), d2 = seg(p, k, b);
  float t2 = clamp(dot(p - k, b - k) / dot(b - k, b - k), 0.0, 1.0);
  float d = min(d1, d2);
  float ww = d2 < d1 ? w * (1.0 - 0.6 * t2) : w;
  float aa = max(fwidth(d), 1e-5);
  return clamp(0.5 + (ww - d) / aa, 0.0, 1.0);
}
// an insect body seen from above: head with compound eyes, furred thorax, segmented abdomen,
// antennae and six legs (n: body coordinates in units of the body length, +y forward).
// Returns coverage; writes colour, emission and a bulge for shading.
float insect(vec2 n, vec3 cA, vec3 cB, float var, out vec3 col, out float emis, out float bulge) {
  float a = 0.0; emis = 0.0; bulge = 0.0; col = vec3(0.0);
  vec2 sn = vec2(abs(n.x), n.y);
  // hand-drawn: segment rings and outlines wobble a little
  float wob = sin(n.y * 21.0 + var * 6.0) * 0.012 + sin(n.x * 37.0 - n.y * 9.0) * 0.006;
  float head, thor, abd, eye, ant, legs, ring = 0.0;
  if (uShape < 0.5) {
    // lumen moth: a fat furry body, big feathered antennae
    head = ell(n, vec2(0.0, 0.8), vec2(0.13, 0.12));
    eye = ell(sn, vec2(0.1, 0.83), vec2(0.075, 0.08));
    thor = ell(n, vec2(0.0, 0.43), vec2(0.21 + wob, 0.27));
    abd = ell(n, vec2(0.0, -0.36), vec2(0.17 * (0.75 + 0.25 * smoothstep(-1.0, 0.1, n.y)) + wob, 0.62));
    ring = smoothstep(0.78, 0.97, abs(sin((n.y + wob) * 26.0))) * step(n.y, 0.12);
    // feathered (bipectinate) antennae: a shaft with a comb of barbs
    float sh = limb(sn, vec2(0.04, 0.9), vec2(0.17, 1.35), vec2(0.42, 1.72), 0.016);
    float dS = min(seg(sn, vec2(0.04, 0.9), vec2(0.17, 1.35)), seg(sn, vec2(0.17, 1.35), vec2(0.42, 1.72)));
    float barbs = smoothstep(0.075, 0.03, dS) * smoothstep(0.55, 0.9, sin((sn.y * 1.0 + sn.x * 0.6) * 90.0)) * smoothstep(0.95, 1.2, n.y);
    ant = max(sh, barbs * 0.55);
    // legs tucked up under the thorax in flight, the hind pair trailing along the abdomen
    legs = max(max(limb(sn, vec2(0.12, 0.55), vec2(0.25, 0.62), vec2(0.2, 0.42), 0.016),
                   limb(sn, vec2(0.15, 0.42), vec2(0.27, 0.3), vec2(0.2, 0.08), 0.016)),
                   limb(sn, vec2(0.13, 0.3), vec2(0.24, 0.05), vec2(0.15, -0.3), 0.016));
  } else if (uShape < 1.5) {
    // spiral gnat: a round glowing abdomen, a hunched thorax, long trailing legs
    head = ell(n, vec2(0.0, 0.62), vec2(0.18, 0.16));
    eye = ell(sn, vec2(0.12, 0.66), vec2(0.09, 0.1));
    thor = ell(n, vec2(0.0, 0.32), vec2(0.26 + wob, 0.24));
    abd = ell(n, vec2(0.0, -0.25), vec2(0.32 + wob, 0.48));
    ring = smoothstep(0.8, 0.97, abs(sin((n.y + wob) * 18.0))) * step(n.y, 0.1);
    ant = limb(sn, vec2(0.05, 0.74), vec2(0.18, 1.0), vec2(0.34, 1.2), 0.02);
    // long legs held back and dangling under the glowing belly, like a crane fly's
    legs = max(limb(sn, vec2(0.16, 0.34), vec2(0.36, 0.2), vec2(0.4, -0.35), 0.018), limb(sn, vec2(0.14, 0.24), vec2(0.3, -0.25), vec2(0.34, -0.95), 0.018));
  } else {
    // skitterfly: dragonfly-like, huge wraparound eyes, a long segmented abdomen
    head = ell(n, vec2(0.0, 0.88), vec2(0.075, 0.05));
    eye = ell(sn, vec2(0.045, 0.9), vec2(0.055, 0.06));
    thor = ell(n, vec2(0.0, 0.69), vec2(0.07 + wob * 0.4, 0.14));
    float w = 0.03 * (1.0 + 0.25 * smoothstep(0.3, 0.55, n.y)) * (1.0 - 0.3 * smoothstep(-0.2, -0.95, n.y)) + wob * 0.15;
    abd = n.y < 0.58 && n.y > -0.98 ? pow(abs(n.x) / w, 2.0) : 9.0;
    // segment joints, each a slightly darker, thicker ring
    float sj = fract((n.y + wob * 0.3) * 9.0);
    ring = smoothstep(0.82, 0.96, sj) * step(n.y, 0.56);
    ant = limb(sn, vec2(0.02, 0.92), vec2(0.04, 0.97), vec2(0.07, 1.0), 0.006);
    // a dragonfly's basket of legs folded forward under the thorax
    legs = max(limb(sn, vec2(0.04, 0.74), vec2(0.08, 0.8), vec2(0.06, 0.86), 0.007), limb(sn, vec2(0.04, 0.66), vec2(0.09, 0.66), vec2(0.07, 0.76), 0.007));
  }
  float aa = max(fwidth(n.y), 1e-4) * 6.0;
  float mH = smoothstep(1.0, 1.0 - aa * 4.0, head), mE = smoothstep(1.0, 1.0 - aa * 4.0, eye);
  float mT = smoothstep(1.0, 1.0 - aa * 4.0, thor), mA = smoothstep(1.0, 1.0 - aa * 4.0, abd);
  float body = max(max(mH, mT), max(mA, mE));
  // limbs and antennae: dark chitin
  vec3 chitin = mix(cB * 0.12, vec3(0.03, 0.025, 0.04), 0.5);
  col = chitin;
  a = max(ant, legs) * 0.95;
  // body: furred thorax, banded abdomen, glossy compound eyes
  vec3 furC = mix(cA * 0.55, cB * 0.35, 0.3 + 0.3 * sin(n.x * 60.0 + n.y * 50.0));
  vec3 abdC = mix(cB * 0.4, cA * 0.75, smoothstep(-0.9, 0.2, n.y));
  vec3 bc = mT > 0.0 && thor < min(abd, 1.0) ? furC : abdC;
  bc = mix(bc, cB * 0.2, mH * step(head, thor));
  bc *= 1.0 - ring * 0.45;
  // eyes: dark faceted domes with a tiny highlight
  float fac = 0.5 + 0.5 * sin(n.x * 160.0) * sin(n.y * 160.0);
  vec3 eyeC = mix(vec3(0.05, 0.06, 0.08), cA * 0.4, 0.25 + 0.1 * fac);
  bc = mix(bc, eyeC, mE);
  float shell = max(max(1.0 - min(head, 1.0), 1.0 - min(thor, 1.0)), max(1.0 - min(abd, 1.0), 1.0 - min(eye, 1.0)));
  bulge = sqrt(clamp(shell, 0.0, 1.0));
  // an ink contour along the body's edge, broken into strokes
  float edgeD = min(min(head, thor), min(abd, eye));
  float ink = smoothstep(0.62, 0.9, edgeD) * smoothstep(1.02, 0.92, edgeD) * smoothstep(-0.3, 0.4, sin(n.y * 17.0 + n.x * 23.0 + var * 4.0));
  bc = mix(bc, chitin * 0.6, ink * 0.6);
  col = mix(col, bc, body);
  a = max(a, body);
  // the lumen: the moth's abdomen tip and the gnat's belly glow
  if (uShape < 0.5) emis = smoothstep(-0.55, -0.95, n.y) * mA * 1.4 + mE * 0.25;
  else if (uShape < 1.5) emis = mA * (0.6 + 0.6 * (1.0 - min(abd, 1.0))) * 1.2;
  else emis = mE * 0.5 + ring * mA * 0.25;
  return a;
}
// hand-drawn: wobble a coordinate like a brush that never quite runs straight
vec2 wob(vec2 p, float k) { return p + k * vec2(sin(p.y * 13.0 + sin(p.x * 7.0) * 1.7), sin(p.x * 11.0 + sin(p.y * 9.0) * 1.3)); }
// a painted contour: an ink band inside the edge whose width swells and thins along it, broken into strokes
float contour(float d, vec2 p, float w) {
  float a = atan(p.y - 0.5, p.x - 0.5);
  float width = w * (0.55 + 0.45 * sin(a * 3.0 + p.x * 4.0)) * smoothstep(-0.2, 0.5, sin(a * 5.0 + 1.3));
  return smoothstep(1.0 - width - 0.06, 1.0 - width, d) * smoothstep(1.0, 0.97, d);
}
void main() {
  float a = 0.0;
  float emis = 0.0;
  vec3 col;
  float var = vVar.x;
  vec3 cA = mix(uColA, uColB, var * 0.35);
  vec3 cB = mix(uColB, uColA, var * 0.25);
  float bodyBulge = -1.0;
  if (vPart < 0.5) {
    vec2 q = vUv;
    {
      // up close: the insect itself (head, eyes, thorax, abdomen, antennae, legs); evaluated in
      // uniform control flow (its strokes use screen derivatives)
      vec2 n = vec2(q.x * uBodyW, q.y * uBodyL) / uBodyL;
      float bl;
      vec3 ic; float ie;
      a = insect(n, cA, cB, var, ic, ie, bl) * (1.0 - vFar);
      col = ic; emis = ie; bodyBulge = bl;
    }
    // far: a soft glowing mote
    float d = length(vec2(q.x, q.y * mix(1.0, 0.35, vFar)));
    float far = vFar * max(smoothstep(1.0, 0.55, d), exp(-d * d * 3.0));
    if (far > a) {
      col = mix(cB * 0.25, cA * 0.7, 0.5 + 0.5 * q.y);
      // far: a small steady speck of its colour (no twinkle: a blinking dot in the sky read as a glitch)
      emis = ((1.0 - min(d, 1.0)) * (uShape > 0.5 && uShape < 1.5 ? 0.8 : 0.45) + vFar * 0.35);
      a = far;
    }
    // being sucked into a mouth: the glow streaks out behind, thin and tapering
    if (vStreak > 0.01 && q.y < 0.3) {
      float tl = clamp(-q.y / 1.25, 0.0, 1.0);
      float sw = exp(-q.x * q.x * mix(2.5, 14.0, tl)) * (1.0 - tl) * smoothstep(0.3, -0.1, q.y) * vStreak;
      if (sw > 0.01) {
        col = mix(col, cA, sw * (1.0 - a));
        emis = max(emis, sw * 2.2);
        a = max(a, sw * 0.85);
      }
    }
  } else {
    float hind = vPart > 2.5 ? 1.0 : 0.0;
    vec2 p = vUv; // x: span 0..1, y: chord 0..1
    float d;
    float vein = 0.0;
    float edgeSoft = 0.18 + vBlur * 0.35;
    if (uShape < 0.5) {
      // lumen moth: a falcate forewing (curved costa, hooked apex, scalloped outer margin) and a
      // rounded, tailed hindwing; scale dust, a wavy postmedian line, a marginal band of pale
      // dots between the veins, and the glowing eye spots
      vec2 pw = wob(p, 0.01);
      vec2 R = hind < 0.5 ? vec2(0.0, 0.72) : vec2(0.0, 0.85);
      vec2 rp = pw - R;
      float th = atan(rp.y, rp.x);
      float rr = length(rp);
      float rad;
      if (hind < 0.5) {
        rad = 1.04 * smoothstep(0.42, 0.05, th) * smoothstep(-1.5, -0.65, th) + 0.0;
        rad = mix(rad, 1.06, smoothstep(0.1, 0.0, abs(th + 0.06)) * 0.4); // the hooked apex
        rad = max(rad, 0.62 * smoothstep(-1.62, -1.05, th) * step(th, -0.6));
      } else {
        rad = 0.84 * smoothstep(0.25, -0.1, th) * smoothstep(-1.75, -1.0, th);
        rad += 0.3 * smoothstep(0.12, 0.0, abs(th + 1.3)) ; // the tail
      }
      // scalloped margin between the vein tips
      rad *= 1.0 - 0.035 * (1.0 - abs(sin(th * 9.0 + 0.4)));
      d = rad > 0.05 ? rr / rad : 9.0;
      // venation: radial veins from the root, branching past the discal cell, hand-wobbled
      float vw = th * 7.5 / 3.1416 + sin(rr * 7.0 + th * 3.0) * 0.18 + sin(rr * 19.0 + var * 5.0) * 0.05;
      float v1 = smoothstep(0.075 * (1.3 - rr), 0.0, abs(fract(vw) - 0.5)) * smoothstep(0.06, 0.2, rr);
      float v2 = smoothstep(0.06 * (1.3 - rr), 0.0, abs(fract(vw * 2.0 + 0.5) - 0.5)) * smoothstep(0.42, 0.6, rr);
      float cell = abs(length((pw - vec2(0.32, hind < 0.5 ? 0.6 : 0.62)) / vec2(0.2, 0.11)) - 1.0);
      float v3 = smoothstep(0.12, 0.0, cell) * 0.7;
      vein = max(max(v1, v2 * 0.7), v3) * 0.38 * (1.0 - smoothstep(0.88, 1.0, d));
      // ground colour: violet at the root, warm amber outward, with dusty scale texture
      float dust = fbm2(pw * 34.0 + var * 7.0);
      col = mix(cB * 0.9, cA, smoothstep(0.15, 0.85, rr)) * (0.82 + 0.3 * dust);
      // the wavy postmedian line and a darker marginal band with pale dots between the veins
      float pm = abs(rr - 0.62 - 0.04 * sin(th * 11.0 + var * 3.0));
      col = mix(col, cB * 0.35, smoothstep(0.03, 0.0, pm) * 0.75);
      float band = smoothstep(0.8, 0.86, d);
      col = mix(col, cB * 0.45, band * 0.6);
      float dots = smoothstep(0.35, 0.15, length(vec2(fract(vw) - 0.5, (d - 0.9) * 6.0)));
      col = mix(col, cA * 1.25 + 0.1, dots * band);
      // the eye spot: a dark ring around a glowing iris with a pale pupil highlight
      vec2 ec = hind < 0.5 ? vec2(0.6, 0.52) : vec2(0.4, 0.55);
      float er = hind < 0.5 ? 0.13 : 0.085;
      float eye = length((pw - ec) / vec2(1.0, 1.15)) / er;
      col = mix(col, vec3(0.06, 0.04, 0.09), smoothstep(1.15, 1.0, eye) * smoothstep(0.62, 0.78, eye));
      col = mix(col, cA * 1.2, smoothstep(0.7, 0.55, eye));
      emis = smoothstep(0.72, 0.4, eye) * (0.7 + 0.3 * smoothstep(0.3, 0.0, eye)) * 2.2 + smoothstep(0.84, 1.0, d) * 0.3 + dots * band * 0.5;
      vein += contour(d, pw, 0.08) * 0.6;
    } else if (uShape < 1.5) {
      // spiral gnat: little clear wings, a dark costa along the leading edge, three veins, all shimmer
      d = ell(p, vec2(0.5, hind > 0.5 ? 0.6 : 0.45), vec2(0.5, 0.32));
      vec2 q = wob(p, 0.015);
      float cy = hind > 0.5 ? 0.6 : 0.45;
      vein = smoothstep(0.05, 0.0, abs(q.y - cy - 0.28 + q.x * q.x * 0.12)) * 0.8;
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        vein = max(vein, smoothstep(0.03, 0.0, abs(q.y - cy - 0.14 + fk * 0.12 - q.x * (0.1 + fk * 0.06))) * smoothstep(0.05, 0.2, q.x) * 0.5);
      }
      vein *= 0.5 * (1.0 - smoothstep(0.8, 1.0, d));
      float irid = 0.5 + 0.5 * sin(dot(normalize(vN), vV) * 9.0 + p.x * 6.0 + var * 6.0);
      col = mix(mix(cA, vec3(1.0), 0.45), cB * 1.2, irid * 0.5);
      emis = 0.25 + irid * 0.2;
    } else {
      // skitterfly: long narrow dragonfly wings, iridescent, a dark pterostigma near the tip
      d = ell(p, vec2(0.5, hind > 0.5 ? 0.62 : 0.4), vec2(0.52, 0.42));
      float irid = 0.5 + 0.5 * sin(dot(normalize(vN), vV) * 7.0 + p.x * 5.0 + var * 6.0);
      col = mix(cA, cB, irid);
      vec2 q = wob(p, 0.02);
      vein = (smoothstep(0.9, 1.0, sin(q.x * 34.0 + sin(q.y * 12.0) * 1.4)) * (0.6 + 0.4 * sin(q.x * 5.0))
            + smoothstep(0.86, 1.0, sin(q.y * 15.0 + sin(q.x * 10.0) * 1.8)) * smoothstep(0.0, 0.3, q.x)) * 0.18 * (1.0 - smoothstep(0.5, 0.95, d));
      vein += contour(d, p, 0.12) * 0.5;
      col = mix(col, vec3(0.06, 0.08, 0.14), smoothstep(0.05, 0.02, length((p - vec2(0.86, 0.55)) / vec2(1.0, 2.5))));
      emis = smoothstep(0.7, 1.0, d) * 0.6 + irid * 0.25;
    }
    a = smoothstep(1.0, 1.0 - edgeSoft, d);
    // the veins blur away with the beat; the membrane smears into a translucent fan
    col *= 1.0 - vein * (1.0 - vBlur * 0.8);
    // wings are thin: translucent toward the light, fading out when far (the body glow takes over)
    a *= (uShape > 0.5 && uShape < 1.5 ? 0.4 : 0.88) * (1.0 - vFar) * (1.0 - vBlur * 0.6);
  }
  if (a < 0.004) discard;
  float dusk = smoothstep(0.3, -0.05, uSunDir.y);
  float glowK = mix(uGlowDay, uGlowNight, max(uNight, dusk)) * (1.0 + vVar.y * 0.8);
  vec3 N = normalize(vN);
  float wrap = 0.35 + 0.65 * abs(dot(N, uSunDir));
  // a rounded body: lit on its crown, darker toward its sides, a soft wet sheen on the eyes
  if (bodyBulge >= 0.0) wrap = 0.3 + 0.7 * bodyBulge * (0.6 + 0.4 * max(uSunDir.y, 0.0));
  float back = pow(max(dot(-vV, uSunDir), 0.0), 4.0) * 0.8; // the sun through the wing
  vec3 lit = col * (uSkyAmbient * 0.8 + uSunColor * (wrap * 0.45 + back) + uMoonColor * uNight * 0.4);
  col = lit + uGlowCol * emis * glowK;
  col = mix(col, vFogCol, vFog * 0.92);
  a *= vAlpha;
  gl_FragColor = vec4(col * a, a);
}
`;

/** 5 quads: body (billboard), forewing L/R, hindwing L/R. position = (span, part, chord). */
function bugGeometry() {
  const P = [], I = [];
  const quad = (part, x0, x1, z0, z1) => {
    const b = P.length / 3;
    P.push(x0, part, z0, x1, part, z0, x1, part, z1, x0, part, z1);
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  // the body quad reaches past the body for the antennae and legs (|x| to 2.6 body widths)
  quad(0, -2.6, 2.6, -1.25, 1.95);
  quad(1, 0, -1, -0.3, 0.7);
  quad(2, 0, 1, -0.3, 0.7);
  quad(3, 0, -0.95, -0.95, 0.05);
  quad(4, 0, 0.95, -0.95, 0.05);
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  geo.setIndex(I);
  return geo;
}

const _c = new Vector3();

export class SkyBugs {
  constructor(game, opts = {}) {
    this.game = game;
    this.kinds = {};
    this.swarms = [];
    this.t = 0;
    this.frame = 0;
    this.stats = { ms: 0, msAvg: 0, drawn: 0, sim: 0, eaten: 0 };
    this.mouthWant = 0; // 0..1: a live bug is right in front of the first eater's mouth
    this.nearest = Infinity;
    this.onCatch = null; // (kind, x, y, z, swarm) for the first eater: a bug reached the mouth
    this.onSuck = null;  // (kind, x, y, z) a bug started being drawn into the mouth
    this.reach = 0;      // 0..1 how close the nearest bug in front of the mouth is (opens it wider)
    this.focus = new Vector3(); // where the bugs in front of the mouth are (eyes and head turn to it)
    this.focusW = 0;     // 0..1 how many / how close
    this.sucking = 0;    // bugs on their way into the mouth
    this.slow = 1;       // suction duration multiplier (the dev scene's slow motion)
    const scene = opts.scene || game.engine.sceneT;
    for (const name of Object.keys(BUG_SPECIES)) {
      const def = BUG_SPECIES[name];
      const cap = def.slots * def.block;
      const geo = bugGeometry();
      const aP = new InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(DynamicDrawUsage);
      const aD = new InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(DynamicDrawUsage);
      const aS = new InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(DynamicDrawUsage);
      const aX = new InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(DynamicDrawUsage);
      geo.setAttribute('aP', aP);
      geo.setAttribute('aD', aD);
      geo.setAttribute('aS', aS);
      geo.setAttribute('aX', aX);
      geo.instanceCount = 0;
      const mat = new ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: Object.assign({}, G, {
          uSize: { value: def.size }, uFlap: { value: def.flap }, uAmp: { value: def.amp }, uBase: { value: def.base },
          uMinPx: { value: def.minPx }, uBodyW: { value: def.bodyW }, uBodyL: { value: def.bodyL },
          uWing: { value: new Vector4(def.wing[0], def.wing[1], def.wing[2], def.wing[3]) },
          uColA: { value: new Color(def.colA) }, uColB: { value: new Color(def.colB) }, uGlowCol: { value: new Color(def.glow) },
          uGlowDay: { value: def.glowDay }, uGlowNight: { value: def.glowNight }, uShape: { value: def.shape },
        }),
        transparent: true, depthWrite: false, depthTest: true, side: 2,
        blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor, premultipliedAlpha: true,
      });
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 24;
      mesh.name = `bugs-${name}`;
      scene.add(mesh);
      const K = {
        name, def, cap, mesh, geo, aP, aD, aS, aX, attrs: [aP, aD, aS, aX],
        pos: new Float32Array(cap * 3), off: new Float32Array(cap * 3), offV: new Float32Array(cap * 3),
        head: new Float32Array(cap * 3), seed: new Float32Array(cap * 4), fade: new Float32Array(cap),
        alive: new Uint8Array(cap), respawn: new Float32Array(cap), fleeCd: new Float32Array(cap),
        excite: new Float32Array(cap), seaY: new Float32Array(cap), init: new Uint8Array(cap),
        // suction into a mouth: progress (<0 none), its duration, the start offset from the mouth
        suck: new Float32Array(cap).fill(-1), suckDur: new Float32Array(cap), rel: new Float32Array(cap * 3),
        // flight: dart timers, flap amplitude (gliding), roll
        dartT: new Float32Array(cap), flapK: new Float32Array(cap).fill(1), roll: new Float32Array(cap),
        glowCol: new Color(def.glow), colA: new Color(def.colA),
      };
      let s = 12345 + name.length * 977;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < cap * 4; i++) K.seed[i] = rnd();
      this.kinds[name] = K;
      for (let k = 0; k < def.slots; k++) {
        this.swarms.push({
          kind: name, K, first: k * def.block, block: def.block, count: 0, active: false, dying: false, fade: 0,
          center: new Vector3(), vel: new Vector3(), dir: new Vector3(1, 0, 0), lat: new Vector3(0, 0, 1),
          e1: new Vector3(1, 0, 0), e2: new Vector3(0, 1, 0), axis: new Vector3(0, 0, 1),
          radius: 6, shape: 'cloud', t: 0, seaY: 0, age: 0, near: false, tag: null, ringR: 5, eaten: 0, life: Infinity,
        });
      }
    }
  }

  /** Spawn a swarm. opts: { count, radius, shape: cloud|coil|ribbon|ring, dir (Vector3), normal, ringR, seaY, drift, tag, life } */
  spawn(kind, center, opts = {}) {
    const K = this.kinds[kind];
    if (!K) return null;
    let S = null;
    for (const s of this.swarms) if (s.kind === kind && !s.active) { S = s; break; }
    if (!S) return null;
    S.active = true;
    S.dying = false;
    S.fade = 0;
    S.t = Math.random() * 50;
    S.age = 0;
    S.eaten = 0;
    S.tag = opts.tag || null;
    S.life = opts.life ?? Infinity;
    S.center.copy(center);
    S.count = Math.min(S.block, Math.max(1, Math.round(opts.count ?? S.block * 0.75)));
    S.radius = opts.radius ?? (kind === 'gnat' ? 4.5 : kind === 'skitter' ? 7 : 9);
    S.shape = opts.shape || (kind === 'gnat' ? 'coil' : kind === 'skitter' ? 'ribbon' : 'cloud');
    S.seaY = opts.seaY ?? 0;
    S.ringR = opts.ringR ?? 5.5;
    S.dir.copy(opts.dir || S.dir).setY(0);
    if (S.dir.lengthSq() < 1e-6) S.dir.set(1, 0, 0);
    S.dir.normalize();
    S.lat.set(-S.dir.z, 0, S.dir.x);
    S.vel.set(0, 0, 0);
    if (opts.drift !== undefined) S.vel.copy(S.dir).multiplyScalar(opts.drift);
    if (S.shape === 'ring') {
      S.axis.copy(opts.normal || S.dir).normalize();
      S.e1.set(0, 1, 0).cross(S.axis);
      if (S.e1.lengthSq() < 1e-6) S.e1.set(1, 0, 0);
      S.e1.normalize();
      S.e2.copy(S.axis).cross(S.e1).normalize();
    }
    for (let j = 0; j < S.count; j++) {
      const i = S.first + j;
      K.alive[i] = 1;
      K.fade[i] = 0;
      K.respawn[i] = 0;
      K.fleeCd[i] = 0;
      K.excite[i] = 0;
      K.init[i] = 0;
      K.suck[i] = -1;
      K.flapK[i] = 1;
      K.dartT[i] = 1 + K.seed[i * 4] * 4;
      K.off[i * 3] = K.off[i * 3 + 1] = K.off[i * 3 + 2] = 0;
      K.offV[i * 3] = K.offV[i * 3 + 1] = K.offV[i * 3 + 2] = 0;
      K.seaY[i] = S.seaY;
    }
    return S;
  }

  /** Let a swarm fade away (its slot frees when invisible). */
  release(S) {
    if (S && S.active) S.dying = true;
  }

  clear() {
    for (const S of this.swarms) { S.active = false; S.dying = false; S.count = 0; }
    for (const k in this.kinds) this.kinds[k].geo.instanceCount = 0;
  }

  countActive(kind) {
    let n = 0;
    for (const S of this.swarms) if (S.active && !S.dying && S.kind === kind && !S.tag) n++;
    return n;
  }

  /** Every bug within radius bolts away from center. */
  scatter(center, radius, strength = 1) {
    const r2 = radius * radius;
    for (const S of this.swarms) {
      if (!S.active || S.center.distanceToSquared(center) > (radius + S.radius * 3) ** 2) continue;
      const K = S.K;
      for (let j = 0; j < S.count; j++) {
        const i = S.first + j, i3 = i * 3;
        const dx = K.pos[i3] - center.x, dy = K.pos[i3 + 1] - center.y, dz = K.pos[i3 + 2] - center.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2) + 1e-3, k = K.def.flee * strength * (1.2 - d / radius);
        K.offV[i3] += (dx / d) * k;
        K.offV[i3 + 1] += (dy / d) * k + k * 0.3;
        K.offV[i3 + 2] += (dz / d) * k;
        K.excite[i] = 1;
      }
    }
  }

  /**
   * Simulate and upload. eater: { mouth: Vector3, fwd: Vector3, speed, open 0..1, body: Vector3 } or null.
   * Bugs that come within catch range of an open mouth are eaten (onCatch is called).
   */
  update(dt, eater = null) {
    const t0 = performance.now();
    this.t += dt;
    this.frame++;
    const cam = this.game.engine.camera.position;
    const ocean = this.game.ocean;
    if (ocean !== this._ocean) {
      this._ocean = ocean;
      this._seaFn = ocean ? (ocean.heightApprox ? ocean.heightApprox.bind(ocean) : ocean.heightAt ? ocean.heightAt.bind(ocean) : null) : null;
    }
    const seaFn = ocean && ocean.enabled !== false ? this._seaFn : null;
    let want = 0, nearest = Infinity;
    const mx = eater ? eater.mouth.x : 0, my = eater ? eater.mouth.y : 0, mz = eater ? eater.mouth.z : 0;
    const bx = eater ? eater.body.x : 0, by = eater ? eater.body.y : 0, bz = eater ? eater.body.z : 0;
    const fx = eater ? eater.fwd.x : 0, fy = eater ? eater.fwd.y : 0, fz = eater ? eater.fwd.z : 1;
    const openR = eater ? 5 + Math.min(eater.speed, 20) * 0.45 : 0;
    // the eater's up (for the suction's curving path): world up made perpendicular to fwd
    let ux = -fx * fy, uy = 1 - fy * fy, uz = -fz * fy;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    let sucking = 0, reachD = Infinity, fw = 0, fsx = 0, fsy = 0, fsz = 0;
    const maxSuck = 9;
    let drawn = 0, sim = 0;
    for (const k in this.kinds) this.kinds[k].n = 0;
    for (const S of this.swarms) {
      if (!S.active) continue;
      const K = S.K, def = K.def;
      S.age += dt;
      if (S.age > S.life) S.dying = true;
      S.fade = Math.min(1, Math.max(0, S.fade + (S.dying ? -dt * 0.8 : dt * 0.6)));
      if (S.dying && S.fade <= 0) { S.active = false; continue; }
      S.t += dt;
      S.center.addScaledVector(S.vel, dt);
      const dc = S.center.distanceTo(cam);
      S.near = dc < def.drawDist + S.radius * 4;
      if (!S.near) continue;
      sim += S.count;
      const R = S.radius, t = S.t, cx = S.center.x, cy = S.center.y, cz = S.center.z;
      const eaterNear = eater && Math.abs(bx - cx) < R * 3 + 30 && Math.abs(bz - cz) < R * 3 + 30 && Math.abs(by - cy) < R * 3 + 30;
      const fleeR2 = def.fleeR * def.fleeR, catchR2 = def.catchR * def.catchR;
      const refresh = this.frame & 3;
      for (let j = 0; j < S.count; j++) {
        const i = S.first + j, i3 = i * 3, i4 = i * 4;
        const k1 = K.seed[i4], k2 = K.seed[i4 + 1], k3 = K.seed[i4 + 2], ph = K.seed[i4 + 3];
        if (!K.alive[i]) {
          K.respawn[i] -= dt;
          if (K.respawn[i] > 0 || S.dying || S.shape === 'ring') continue;
          K.alive[i] = 1;
          K.fade[i] = 0;
          K.suck[i] = -1;
          K.off[i3] = K.off[i3 + 1] = K.off[i3 + 2] = 0;
          K.offV[i3] = K.offV[i3 + 1] = K.offV[i3 + 2] = 0;
        }
        // ---- drawn into a mouth: a curving, accelerating spiral; spinning, shrinking, streaking ----
        if (K.suck[i] >= 0) {
          let e = K.suck[i] + dt / (K.suckDur[i] * this.slow);
          if (!eater || e >= 1) {
            // it reached the mouth: eaten
            K.suck[i] = -1;
            K.alive[i] = 0;
            K.respawn[i] = 7 + k1 * 8;
            S.eaten++;
            this.stats.eaten++;
            if (eater && this.onCatch) this.onCatch(S.kind, mx, my, mz, S);
            continue;
          }
          K.suck[i] = e;
          sucking++;
          const ee = e * e * (1.6 - 0.6 * e); // eases in: a gentle tug, then a rush
          const th = (k2 < 0.5 ? -1 : 1) * (1.6 + k3 * 1.4) * ee;
          const c = Math.cos(th), sn = Math.sin(th);
          const rx = K.rel[i3], ry = K.rel[i3 + 1], rz = K.rel[i3 + 2];
          // Rodrigues: rotate the start offset about the mouth's forward axis
          const dfv = fx * rx + fy * ry + fz * rz;
          const cx2 = fy * rz - fz * ry, cy2 = fz * rx - fx * rz, cz2 = fx * ry - fy * rx;
          const shrink = 1 - ee;
          const arc = Math.sin(Math.PI * e) * Math.hypot(rx, ry, rz) * 0.22;
          const qx = mx + (rx * c + cx2 * sn + fx * dfv * (1 - c)) * shrink + ux * arc;
          const qy = my + (ry * c + cy2 * sn + fy * dfv * (1 - c)) * shrink + uy * arc;
          const qz = mz + (rz * c + cz2 * sn + fz * dfv * (1 - c)) * shrink + uz * arc;
          const inv = 1 / Math.max(dt, 1e-4);
          const hx = (qx - K.pos[i3]) * inv, hy = (qy - K.pos[i3 + 1]) * inv, hz = (qz - K.pos[i3 + 2]) * inv;
          K.head[i3] = hx; K.head[i3 + 1] = hy; K.head[i3 + 2] = hz;
          K.pos[i3] = qx; K.pos[i3 + 1] = qy; K.pos[i3 + 2] = qz;
          K.roll[i] += dt * (6 + 22 * ee) * (k2 < 0.5 ? -1 : 1);
          const n = K.n++;
          const P = K.aP.array, D = K.aD.array, A = K.aS.array, X = K.aX.array, n4 = n * 4;
          P[n4] = qx; P[n4 + 1] = qy; P[n4 + 2] = qz; P[n4 + 3] = (0.8 + 0.4 * k2) * (1 - 0.7 * ee);
          D[n4] = hx; D[n4 + 1] = hy; D[n4 + 2] = hz; D[n4 + 3] = ph;
          A[n4] = 1.6; A[n4 + 1] = 1; A[n4 + 2] = k1; A[n4 + 3] = S.fade * Math.min(1, (1 - e) * 6);
          X[n4] = smoothstep01(0.1, 0.7, e); X[n4 + 1] = K.roll[i]; X[n4 + 2] = 1; X[n4 + 3] = 0;
          continue;
        }
        // ---- formation target ----
        let x, y, z;
        if (S.shape === 'coil') {
          // a tight cloud that coils: a spinning helix, twisting along its height
          const ang = t * (2.0 + k2 * 1.6) + ph * TAU;
          const h = (k1 - 0.5) * R * 1.5;
          const rr = R * (0.2 + 0.8 * k3) * (0.65 + 0.35 * Math.sin(t * 0.8 + k1 * 6));
          const tw = h * 0.35 + t * 0.4;
          x = cx + Math.cos(ang) * rr + Math.cos(tw) * R * 0.35;
          z = cz + Math.sin(ang) * rr + Math.sin(tw) * R * 0.35;
          y = cy + h + Math.sin(ang * 0.5 + t) * R * 0.08;
        } else if (S.shape === 'ribbon') {
          // a shimmering ribbon skimming the sea, sliding along itself
          let a = (k1 + t * 0.05 * (0.8 + 0.4 * k2)) % 1;
          a = (a - 0.5) * R * 5;
          const lat = Math.sin(a * 0.09 + t * 0.8 + k3) * R * 0.4 + (k2 - 0.5) * R * 0.35;
          x = cx + S.dir.x * a + S.lat.x * lat;
          z = cz + S.dir.z * a + S.lat.z * lat;
          if (seaFn && ((i + refresh) & 3) === 0) K.seaY[i] = seaFn(x, z);
          y = K.seaY[i] + 0.55 + 0.45 * Math.abs(Math.sin(t * 2.6 + ph * TAU)) + k3 * 0.5;
        } else if (S.shape === 'ring') {
          // a living ring to fly through: moths circling a hoop
          const ag = (j / S.count) * TAU + t * 0.45;
          const rr = S.ringR * (1 + 0.05 * Math.sin(t * 3 + k1 * 9));
          const wob = Math.sin(t * 2 + k2 * 6) * 0.35;
          x = cx + S.e1.x * Math.cos(ag) * rr + S.e2.x * Math.sin(ag) * rr + S.axis.x * wob;
          y = cy + S.e1.y * Math.cos(ag) * rr + S.e2.y * Math.sin(ag) * rr + S.axis.y * wob;
          z = cz + S.e1.z * Math.cos(ag) * rr + S.e2.z * Math.sin(ag) * rr + S.axis.z * wob;
        } else {
          // drifting cloud: lazy looping paths
          const a = t * (0.3 + 0.35 * k2) + ph * TAU;
          const rr = R * (0.35 + 0.65 * k1);
          x = cx + Math.sin(a) * rr + Math.sin(t * 0.7 + k3 * 9) * R * 0.15;
          z = cz + Math.cos(a * 0.83 + k3 * 3) * rr;
          y = cy + Math.sin(t * (0.5 + k1 * 0.4) + ph * 11) * R * 0.3 + (k3 - 0.5) * R * 0.45;
        }
        // ---- flee offset (a damped spring back to the formation) ----
        let ox = K.off[i3], oy = K.off[i3 + 1], oz = K.off[i3 + 2];
        let vx = K.offV[i3], vy = K.offV[i3 + 1], vz = K.offV[i3 + 2];
        // now and then a bug darts off on its own and drifts back (skitterflies dart hardest)
        K.dartT[i] -= dt;
        if (K.dartT[i] <= 0) {
          const h = Math.sin(t * 12.9898 + i * 78.233) * 43758.5453, r1 = h - Math.floor(h);
          const ang = r1 * TAU, kick = def.shape === 2 ? 7 : def.shape === 1 ? 2.5 : 2.2;
          vx += Math.cos(ang) * kick; vz += Math.sin(ang) * kick; vy += (r1 - 0.4) * kick * 0.5;
          K.dartT[i] = (def.shape === 2 ? 1.5 : 2.5) + k1 * 5 + r1 * 2;
          K.excite[i] = Math.max(K.excite[i], 0.35);
        }
        // moths glide on held wings between bursts; skitterflies hold still to hover-hunt
        const glide = def.shape === 0 ? Math.sin(t * (0.35 + k3 * 0.3) + ph * TAU) > 0.55 : def.shape === 2 && Math.sin(t * 0.8 + k2 * 9) > 0.7;
        K.flapK[i] += ((glide && K.excite[i] < 0.3 ? 0.12 : 1) - K.flapK[i]) * Math.min(1, dt * 4);
        vx += (-ox * 1.6 - vx * 1.5) * dt;
        vy += (-oy * 1.6 - vy * 1.5) * dt;
        vz += (-oz * 1.6 - vz * 1.5) * dt;
        ox += vx * dt; oy += vy * dt; oz += vz * dt;
        K.fleeCd[i] -= dt;
        K.excite[i] = Math.max(0, K.excite[i] - dt * 0.8);
        let px = x + ox, py = y + oy, pz = z + oz;
        if (eaterNear && K.alive[i]) {
          const ex = px - bx, ey = py - by, ez = pz - bz;
          const d2 = ex * ex + ey * ey + ez * ez;
          if (d2 < fleeR2 && K.fleeCd[i] <= 0) {
            // a little burst away, sideways to the calf's path (so a quick calf still gets some)
            const d = Math.sqrt(d2) + 1e-3;
            const along = (ex * fx + ey * fy + ez * fz) / d;
            const k = def.flee * (0.7 + 0.6 * k2);
            vx += ((ex / d) - fx * along * 0.7) * k + (k3 - 0.5) * 2;
            vy += ((ey / d) - fy * along * 0.7) * k + k * 0.35;
            vz += ((ez / d) - fz * along * 0.7) * k + (k1 - 0.5) * 2;
            K.fleeCd[i] = 0.9 + k1 * 0.8;
            K.excite[i] = 1;
          }
          const mx2 = px - mx, my2 = py - my, mz2 = pz - mz;
          const m2 = mx2 * mx2 + my2 * my2 + mz2 * mz2;
          if (m2 < nearest) nearest = m2;
          const ahead = mx2 * fx + my2 * fy + mz2 * fz;
          if (m2 < openR * openR && ahead > -1.2) {
            want = 1;
            // what the eyes lock on: the bugs ahead, the nearest weighted most
            const w = 1 / (1 + m2 * 0.08);
            fw += w; fsx += px * w; fsy += py * w; fsz += pz * w;
            if (ahead > 0 && m2 < reachD) reachD = m2;
          }
          // within reach of an open mouth: it is caught in the suction
          const suckR2 = catchR2 * 2.6 * (0.6 + 0.4 * eater.open) * (1 + Math.min(eater.speed, 20) * 0.04);
          if (eater.open > 0.3 && m2 < suckR2 && ahead > -0.6 && sucking < maxSuck) {
            K.suck[i] = 0;
            K.suckDur[i] = (def.shape === 0 ? 0.42 : def.shape === 1 ? 0.26 : 0.34) * (0.85 + 0.3 * k3);
            K.rel[i3] = mx2; K.rel[i3 + 1] = my2; K.rel[i3 + 2] = mz2;
            K.off[i3] = ox; K.off[i3 + 1] = oy; K.off[i3 + 2] = oz;
            K.offV[i3] = 0; K.offV[i3 + 1] = 0; K.offV[i3 + 2] = 0;
            K.pos[i3] = px; K.pos[i3 + 1] = py; K.pos[i3 + 2] = pz;
            K.excite[i] = 1;
            sucking++;
            if (this.onSuck) this.onSuck(S.kind, px, py, pz);
          }
        }
        K.off[i3] = ox; K.off[i3 + 1] = oy; K.off[i3 + 2] = oz;
        K.offV[i3] = vx; K.offV[i3 + 1] = vy; K.offV[i3 + 2] = vz;
        // heading from motion (smoothed)
        let hx, hy, hz;
        if (!K.init[i]) {
          K.init[i] = 1;
          hx = S.dir.x; hy = 0; hz = S.dir.z;
        } else {
          const inv = 1 / Math.max(dt, 1e-4), kh = 1 - Math.exp(-dt * 8);
          hx = K.head[i3] + ((px - K.pos[i3]) * inv - K.head[i3]) * kh;
          hy = K.head[i3 + 1] + ((py - K.pos[i3 + 1]) * inv - K.head[i3 + 1]) * kh;
          hz = K.head[i3 + 2] + ((pz - K.pos[i3 + 2]) * inv - K.head[i3 + 2]) * kh;
        }
        K.head[i3] = hx; K.head[i3 + 1] = hy; K.head[i3 + 2] = hz;
        K.pos[i3] = px; K.pos[i3 + 1] = py; K.pos[i3 + 2] = pz;
        K.fade[i] = Math.min(1, K.fade[i] + dt * 1.2);
        // ---- pack for drawing ----
        const n = K.n++;
        const P = K.aP.array, D = K.aD.array, A = K.aS.array, n4 = n * 4;
        P[n4] = px; P[n4 + 1] = py; P[n4 + 2] = pz; P[n4 + 3] = 0.8 + 0.4 * k2;
        D[n4] = hx; D[n4 + 1] = hy * 0.5; D[n4 + 2] = hz; D[n4 + 3] = ph;
        A[n4] = 0.8 + 0.4 * k3 + K.excite[i] * 0.5; A[n4 + 1] = K.excite[i]; A[n4 + 2] = k1; A[n4 + 3] = K.fade[i] * S.fade;
        const X = K.aX.array;
        X[n4] = 0; X[n4 + 1] = 0; X[n4 + 2] = K.flapK[i]; X[n4 + 3] = 0;
      }
    }
    for (const k in this.kinds) {
      const K = this.kinds[k];
      K.geo.instanceCount = K.n;
      drawn += K.n;
      if (K.n > 0) {
        for (let ai = 0; ai < 4; ai++) {
          const a = K.attrs[ai];
          a.clearUpdateRanges?.();
          a.addUpdateRange?.(0, K.n * 4);
          a.needsUpdate = true;
        }
      }
    }
    this.mouthWant = want;
    this.nearest = Math.sqrt(nearest);
    this.sucking = sucking;
    // anticipation: the mouth opens wider as the nearest bug ahead comes within reach
    const rd = Math.sqrt(reachD);
    this.reach = eater && reachD < Infinity ? 1 - Math.min(1, Math.max(0, (rd - 2) / Math.max(openR - 2, 1))) : 0;
    if (fw > 0) { this.focus.set(fsx / fw, fsy / fw, fsz / fw); this.focusW = Math.min(1, fw * 0.6); } else this.focusW = 0;
    const ms = performance.now() - t0;
    this.stats.ms = ms;
    this.stats.msAvg = this.stats.msAvg * 0.95 + ms * 0.05;
    this.stats.drawn = drawn;
    this.stats.sim = sim;
  }
}

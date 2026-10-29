// Fish materials: one shader for all three species (selected by SPECIES), near and far variants.
//
// Vertex: every fish rides a carangiform swimming wave (amplitude growing toward the tail,
// travelling back along the body), bends into turns, banks, arches in leaps; fins flex, flare,
// fold and ripple; the spiralback's sail rolls into a fiddlehead coil; the lanternjack's lures
// trail and sway. GPU extrapolation (pos + vel * age) keeps reduced-rate schools moving smoothly.
//
// Fragment: countershading, overlapping scales with per-scale platelet tilt, and mirror-silver
// flanks whose platelets stay vertical (Denton): they reflect the underwater light field, so a
// school is camouflaged until fish roll, when the flanks catch Snell's window and the sun and the
// whole bait ball flashes. Iridescent bands and glint fins, fin rays and translucent membranes,
// eyes (the spiralback's split "four-eyed" pupils, the lanternjack's eyeshine), and the jack's
// bioluminescent lures. Lit by stylizedLight, then applyFog (water column, caustics, underwater).
import { ShaderMaterial, Color, Vector4, FrontSide } from 'three';
import { G } from '../../render/Globals.js';
import { UNIFORMS, NOISE, SHADOW, LIGHTING, SEA } from '../../render/shaders/common.js';
import { ECO_GLSL, ECO_VERT, ECO_FRAG } from './glsl.js';
import { GLINT_EYE, SPIRAL_EYE, LANTERN_EYE } from './fishGeo.js';

export const SPECIES_ID = { glintfin: 0, spiralback: 1, lanternjack: 2 };

const C = (h) => new Color(h);
/** Per-species palettes: [a, b, c, d] colours per variant (meaning differs by species). */
export const FISH_PALETTES = {
  // back, lateral band, fin tint, accent
  glintfin: [
    [C('#173f52'), C('#e2cf73'), C('#d9c27a'), C('#2a6c86')],
    [C('#1e3554'), C('#d6a6e0'), C('#c5c8d8'), C('#3a5f93')],
    [C('#26442f'), C('#e8a65e'), C('#d8c06c'), C('#4b7a52')],
    [C('#0f4146'), C('#91e6d2'), C('#b8d6cf'), C('#227a7a')],
  ],
  // back, dark bands, sail membrane, sail edge
  spiralback: [
    [C('#1f5b63'), C('#0a1d27'), C('#2e55a8'), C('#f2c35a')],
    [C('#283b70'), C('#0d1230'), C('#7244ab'), C('#f0a7d0')],
    [C('#55562c'), C('#1b190c'), C('#a8542c'), C('#f3dd8a')],
    [C('#24504a'), C('#0b1c18'), C('#c23d52'), C('#ffd59a')],
  ],
  // back, flank, lure light, fin tint
  lanternjack: [
    [C('#2a3236'), C('#8e7c58'), C('#5ff2e2'), C('#1d2a33')],
    [C('#1b2433'), C('#8696a8'), C('#7df7ae'), C('#1a2238')],
    [C('#3b2c25'), C('#a48a52'), C('#72d8ff'), C('#2a1d1a')],
    [C('#26302a'), C('#9a9a78'), C('#ffd27a'), C('#1c2620')],
  ],
};

const VERT = /* glsl */ `
${UNIFORMS}
${ECO_GLSL}
${ECO_VERT}
attribute vec4 aF;
attribute vec4 aR;
attribute vec4 iPos;   // xyz, time written
attribute vec4 iVel;   // velocity (m/s), w visibility (grows in after regrowing)
attribute vec4 iAnim;  // tail-beat phase, tail amplitude (body lengths), lateral bend, roll
attribute vec4 iMisc;  // arch (leap bow), fin flare 0..1, special (sail curl / lure glow), flash
attribute vec4 iSeed;  // seed, length (m), palette + tint, surface height (m)
uniform vec4 uFishLod; // x: hide below px, y: fade-in band px
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec4 vF;
varying vec4 vR;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vFwd;
varying vec4 vMisc;
varying vec4 vSeed;
float envT(float t) { return 0.03 + 0.12 * t + 0.85 * t * t; }
void main() {
  float age = clamp(uTime - iPos.w, 0.0, 0.4);
  vec3 C = iPos.xyz + iVel.xyz * age;
  float vis = iVel.w;
  float len = iSeed.y;
  float vz = -(viewMatrix * vec4(C, 1.0)).z;
  float px = projPx(len, vz);
  if (vis < 0.01 || px < uFishLod.x || vz < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 vel = iVel.xyz;
  float sp = length(vel);
  vec3 f = sp > 1e-3 ? vel / sp : vec3(0.0, 0.0, 1.0);
  mat3 B = basisFromFwd(f, iAnim.w);
  float part = aF.x;
  float t = aF.y;
  float s = aF.z;
  vec3 p = position;
  vec3 n = normal;
  float ph = iAnim.x;
  float amp = iAnim.y;
  float bend = iAnim.z;
  float arch = iMisc.x;
  float flare = iMisc.y;
  float special = iMisc.z;
  vec3 root = aR.xyz;
  float side = aF.w < 0.0 ? -1.0 : 1.0;
  // ---- fins: local motion before riding the body wave -----------------------------------
  if (part > 0.5 && part < 1.5) {
    // caudal lobes lag the peduncle, flexing through each stroke
    float fl = s * s * (0.7 + 3.0 * abs(p.y));
    p.x += fl * amp * 0.55 * sin(ph - 1.35);
  } else if (part > 1.5 && part < 2.5) {
#if SPECIES == 1
    // the spiral sail: folded flat along the back while cruising (like a sailfish), raised when
    // alarmed, singing or leaping; its upper edge always rolls into a fiddlehead curl
    vec3 d = p - root;
    float L0 = length(d);
    if (L0 > 1e-5) {
      vec3 dir = d / L0;
      float Lr = L0 / max(s, 1e-3);
      // a wave crest: straight rays whose top third rolls back into a curl
      float s0 = 0.62;
      float sp2 = max(s - s0, 0.0) / (1.0 - s0);
      float th = (1.0 + 1.6 * special) * pow(sp2, 1.6) + 0.15 * sp2 * sin(ph * 0.5 + aR.w * 6.0);
      float l = sp2 * Lr * (1.0 - s0);
      vec3 cn = -normalize(vec3(0.0, -dir.z, dir.y));
      vec3 c0 = root + dir * min(s, s0) * Lr;
      vec2 q2 = th > 1e-3 ? (l / th) * vec2(sin(th), 1.0 - cos(th)) : vec2(l, 0.0);
      vec3 pr = c0 + dir * q2.x + cn * q2.y - root;
      // fold back about the root (x axis) until the ray lies almost flat along the back
      float rake = atan(-dir.z, max(dir.y, 1e-3));
      float fold = (1.0 - special) * max(1.48 - rake, 0.0);
      pr = rotX(-fold) * pr;
      p = root + pr;
      p.x += s * s * 0.012 * sin(ph * 0.55 + aR.w * 7.0 - s * 3.0) * (0.3 + 0.7 * special);
    }
#else
    p.x += s * s * 0.012 * sin(ph * 0.6 + t * 9.0 + aR.w * 2.0);
#endif
  } else if (part > 2.5 && part < 3.5) {
    p.x += s * s * 0.01 * sin(ph * 0.7 + t * 8.0 + 1.3);
  } else if (part > 3.5 && part < 4.5) {
    // pectorals: folded along the flank when cruising, flared out (glint fins flash, spiralbacks
    // glide) when alarmed or leaping; a slow paddle when hovering
    vec3 d = p - root;
    // flaring fans the rays apart (about the fin's own normal), like opening a hand fan
    vec3 fnrm = normalize(vec3(0.35 * side, 1.0, 0.0));
    d = rotAxis(d, fnrm, flare * (aR.w - 0.5) * 1.1 * side);
    float paddle = 0.12 * sin(ph * 0.35 + side) * (1.0 - flare * 0.6);
    float sweep = mix(-0.32, 0.62, flare) + paddle;
    d = rotY(-side * sweep) * d;
    n = rotY(-side * sweep) * n;
    float dih = mix(0.08, -0.55, flare);
    d = rotZ(side * dih) * d;
    n = rotZ(side * dih) * n;
    p = root + d;
  } else if (part > 4.5 && part < 5.5) {
    vec3 d = p - root;
    float a = 0.2 * sin(ph * 0.5 + side * 1.7) + flare * 0.3;
    d = rotZ(side * a) * d;
    p = root + d;
  } else if (part > 5.5 && part < 7.5) {
    // lure whips trail and sway; the bulb rides the tip
    float u = s;
    float sway = 0.035 * sin(uTime * 1.7 + aF.w * 2.1 - u * 3.0) + 0.02 * sin(ph * 0.3 + aF.w);
    float drag = clamp(sp * 0.04, 0.0, 0.25);
    p.x += u * u * sway * 1.6;
    p.y += u * u * (0.02 * sin(uTime * 1.3 + aF.w * 1.7) - drag * 0.5);
    p.z -= u * u * drag;
  } else if (part > 7.5 && part < 8.5) {
    p.x += s * 0.01 * sin(ph * 1.2 + t * 25.0);
  } else if (part > 8.5 && part < 9.5) {
    p.x += s * s * 0.012 * sin(ph * 0.7 + t * 8.0);
  }
  // ---- the body wave: every vertex rides the spine point at its t ---------------------------
  float zs = 0.5 - t;
  float e = envT(t);
  float k = 6.2831853 / WAVELEN;
  float w = k * t - ph;
  float X = amp * e * sin(w) + bend * t * t;
  float dXdt = amp * ((0.12 + 1.7 * t) * sin(w) + e * k * cos(w)) + 2.0 * bend * t;
  float sl = -dXdt;
  float c = inversesqrt(1.0 + sl * sl), sn = sl * c;
  vec3 q = vec3(p.x, p.y, p.z - zs);
  p = vec3(X + q.x * c + q.z * sn, q.y, zs - q.x * sn + q.z * c);
  n = vec3(n.x * c + n.z * sn, n.y, -n.x * sn + n.z * c);
  // leaps: the body bows (head and tail down)
  float ta = t - 0.45;
  p.y -= arch * ta * ta;
  float dY = arch * 2.0 * ta;
  float c2 = inversesqrt(1.0 + dY * dY), s2 = dY * c2;
  n = vec3(n.x, n.y * c2 + n.z * s2, -n.y * s2 + n.z * c2);
  // grow in after regrowing
  float sc = len * smoothstep(0.0, 1.0, vis);
  vec3 wp = C + B * (p * sc);
  vWorldPos = wp;
  vNormal = normalize(B * n);
  vLocal = position;
  vF = aF;
  vR = aR;
  vRight = B[0];
  vUp = B[1];
  vFwd = B[2];
  vMisc = vec4(flare, special, iMisc.w, px);
  vSeed = vec4(iSeed.x, iSeed.z, iSeed.w, len);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
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
varying vec3 vLocal;
varying vec4 vF;
varying vec4 vR;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vFwd;
varying vec4 vMisc;
varying vec4 vSeed;

// eye: a domed eye with a metallic iris (it mirrors the light like the flank does), a large
// dark pupil and a wet corneal highlight. Returns albedo in .rgb, coverage in .a; iris weight
// (for the mirror) in irisK, and the cornea's gloss in specK.
vec4 fishEye(vec3 L, vec3 eyeC, float r, float split, vec3 irisTint, out float irisK, out float specK) {
  vec2 q = vec2(L.z - eyeC.z, L.y - eyeC.y) / r;
  float d = length(q);
  irisK = 0.0;
  specK = 0.0;
  if (d > 1.2 || abs(L.x) < 0.25 * r) return vec4(0.0);
  float cover = smoothstep(1.12, 1.0, d);
  float eye = smoothstep(1.0, 0.95, d);
  float pupil;
  if (split > 0.5) {
    // the spiralback's split eye: an upper pupil for the air, a lower one for the water
    // (Anableps-like): one pupil pinched into a figure eight by a band of iris
    float pu = length((q - vec2(0.05, 0.2)) * vec2(1.0, 1.35));
    float pl = length((q - vec2(0.05, -0.2)) * vec2(1.0, 1.3));
    pupil = max(smoothstep(0.4, 0.33, pu), smoothstep(0.42, 0.35, pl));
  } else {
    // a big round pupil, slightly forward (fish look ahead)
    pupil = smoothstep(0.66, 0.59, length((q - vec2(0.05, 0.0)) * vec2(0.97, 1.0)));
  }
  // the orbit: a thin dark ring of skin around the eye
  vec3 col = mix(vec3(0.05, 0.06, 0.07), vec3(0.02), eye);
  irisK = eye * (1.0 - pupil);
  // radial striations in the iris (wobbling, broken like brush strokes), a dark limbal ring and
  // a bright inner ring round the pupil
  float an = atan(q.y, q.x);
  float stri = 0.72 + 0.28 * sin(an * 23.0 + d * 9.0 + 0.6 * sin(an * 5.0 + d * 4.0));
  vec3 iris = mix(irisTint * 0.55, irisTint * 1.25, smoothstep(0.85, 0.62, d)) * stri;
  iris = mix(iris, vec3(0.03, 0.03, 0.025), smoothstep(0.8, 0.97, d));
  iris += irisTint * 0.25 * smoothstep(0.08, 0.0, abs(d - 0.7 - 0.02 * sin(an * 7.0)));
  col = mix(col, iris, irisK);
  if (split > 0.5) col = mix(col, vec3(0.16, 0.13, 0.08), smoothstep(0.05, 0.0, abs(q.y)) * eye * 0.6);
  col = mix(col, vec3(0.006, 0.007, 0.01), pupil * eye);
  specK = eye;
  return vec4(col, cover);
}

void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  float part = vF.x;
  vec3 L = vLocal;
  float t = vF.y;
  float side = L.x >= 0.0 ? 1.0 : -1.0;
  float px = vMisc.w;
  float flare = vMisc.x;
  float special = vMisc.y;
  float flash = vMisc.z;
  int pal = int(clamp(floor(vSeed.y), 0.0, 3.0));
  float tint = fract(vSeed.y);
  float seed = vSeed.x;
  vec3 pA = uPalA[pal], pB = uPalB[pal], pC = uPalC[pal], pD = uPalD[pal];
  // angle round the body: 0 on the back .. PI under the belly (mirror-symmetric)
  float phi = atan(abs(L.x), L.y - 0.005);
  float air = smoothstep(-0.04, 0.12, vWorldPos.y - vSeed.z);

  vec3 albedo = vec3(0.5);
  float mirror = 0.0;
  vec3 mirTint = vec3(1.0);
  vec3 Nm = N;
  vec3 emis = vec3(0.0);
  float trans = 0.12, spec = 0.55, gloss = 0.85, rim = 0.55, wrap = 0.22, ao = 1.0;
  float alpha = 1.0;
  float eyeSpec = 0.0;
  vec3 T = vFwd;
  vec3 U = normalize(cross(N, T) + 1e-5);

  if (part < 0.5 || part > 9.5) {
    // ================= body =================
    float dors = smoothstep(1.32, 0.72, phi);
    float belly = smoothstep(2.05, 2.75, phi);
    float scaleEdge = 0.0, scaleId = 0.5;
    vec2 sOff = vec2(0.0);
#ifdef NEAR
    if (px > 22.0) {
      vec2 sp = vec2(t * SCALE_ALONG, phi / 3.14159 * SCALE_AROUND);
      vec4 sc = fishScales(sp);
      float fade = smoothstep(22.0, 70.0, px);
      // only each scale's free (posterior) margin shows, as a thin line
      scaleEdge = smoothstep(0.7, 0.97, sc.x) * smoothstep(-0.15, 0.35, sc.z) * fade;
      scaleId = sc.y;
      sOff = sc.zw * fade;
      // overlapping scales are lifted at their free (posterior) edge
      float h = smoothstep(0.35, 1.0, sc.x);
      N = normalize(N + (T * sOff.x * 0.6 - U * sOff.y * 0.35) * h * 0.55 * SCALE_RELIEF);
    }
#endif
    // the head (in front of the gill cover) is scaleless and plated
    // the gill cover's edge: a curved brush stroke that wobbles, swells and tapers at both ends
    float opz = OPER_Z + 0.016 * cos(phi * 1.15) + 0.0028 * sin(phi * 6.3 + seed * 5.0) + 0.0012 * sin(phi * 17.0 + seed * 2.0);
    float head = smoothstep(opz - 0.004, opz + 0.004, L.z);
    float operTaper = smoothstep(0.45, 0.8, phi) * smoothstep(2.8, 2.35, phi);
    float operW = 0.0045 * (0.55 + 0.45 * sin(phi * 2.2 + 0.8 + seed)) * (0.35 + 0.65 * operTaper);
    float operLine = smoothstep(operW, operW * 0.25, abs(L.z - opz)) * operTaper;
#if SPECIES == 0
    // ---- glintfin: blue-green back, gold band, mirror-silver flanks, keeled white belly
    vec3 back = pA * (0.7 + 0.3 * tint);
    // silvered skin is nearly all mirror: very little diffuse light, the rest is reflection
    vec3 silver = vec3(0.7, 0.75, 0.8);
    albedo = mix(silver * 0.3, back, dors);
    albedo = mix(albedo, vec3(0.86, 0.88, 0.9) * 0.5, belly);
    mirror = mix(0.62, 0.03, dors);
    // the gold lateral band and a row of dark spots above it
    float bandC = 1.18 - 0.12 * t;
    float band = exp(-pow((phi - bandC) * 10.0, 2.0)) * smoothstep(0.05, 0.22, t) * smoothstep(0.85, 0.55, t);
    mirTint = mix(vec3(1.0), pB * 1.4 * iridescence(dot(N, V), 1.3 + tint), band * 0.85);
    albedo = mix(albedo, pB * 0.45, band * 0.6);
    // a row of small dark spots above the band (not every fish has them, they fade backward)
    float spotRow = exp(-pow((phi - 0.95 - 0.04 * sin(t * 20.0 + seed * 9.0)) * 11.0, 2.0)) * smoothstep(0.2, 0.28, t) * smoothstep(0.6, 0.36, t) * step(0.35, fract(seed * 7.7));
    float spots = smoothstep(0.26, 0.1, abs(fract(t * 18.0 + seed * 3.0) - 0.5)) * spotRow;
    albedo = mix(albedo, back * 0.25, spots * 0.85);
    mirror *= 1.0 - spots * 0.8;
    // the shoulder spot behind the gill cover
    float shoulder = smoothstep(0.012, 0.006, length(vec2(L.z - (opz - 0.03), (phi - 0.98) * 0.05))) * step(0.5, fract(seed * 3.1));
    albedo = mix(albedo, back * 0.2, shoulder * 0.9);
    mirror *= 1.0 - shoulder * 0.9;
    // head: golden-silver plates with a spiral iridescent whorl on the gill cover
    vec2 qo = vec2(L.z - (opz + 0.04), L.y + 0.004);
    float ro = length(qo);
    float whorl = smoothstep(0.35, 0.95, sin(atan(qo.y, qo.x) - log(max(ro, 1e-4)) * 5.5)) * smoothstep(0.045, 0.012, ro) * head;
    mirTint = mix(mirTint, vec3(1.15, 1.0, 0.72), head * 0.45);
    mirTint = mix(mirTint, iridescence(dot(N, V), 2.2) * 1.5, whorl * 0.8);
    // fine keel scutes along the belly
    float keel = smoothstep(2.85, 3.05, phi) * (0.5 + 0.5 * sin(t * 140.0));
    albedo *= 1.0 - keel * 0.25;
    // mouth: a thin dark gape line along the snout
    float gz = L.z - 0.5;
    float mouth = smoothstep(0.0035, 0.0, abs(L.y - (-0.006 + gz * 0.05 - gz * gz * 2.2 + 0.0006 * sin(L.z * 900.0)))) * smoothstep(0.455, 0.47, L.z);
    albedo = mix(albedo, vec3(0.03), mouth * 0.9);
    mirror *= 1.0 - mouth;
    // eye
    float irisK;
    vec4 eye = fishEye(L, vec3(0.0, EYE_Y, EYE_Z), EYE_R, 0.0, vec3(0.75, 0.6, 0.28), irisK, eyeSpec);
    albedo = mix(albedo, eye.rgb, eye.a);
    mirror = mix(mirror, 0.3 * irisK, eye.a);
    mirTint = mix(mirTint, vec3(1.1, 0.95, 0.7), eye.a);
#elif SPECIES == 1
    // ---- spiralback: teal back with dark helical bands, silver-bronze flanks, white belly
    vec3 back = pA * (0.85 + 0.3 * tint);
    float helix = t * 15.0 + phi * 1.6 * side + sin(t * 30.0 + phi * 3.0) * 0.12 + (vnoise(vec2(t * 40.0 + seed * 11.0, phi * 4.0)) - 0.5) * 0.35;
    float bandsK = smoothstep(0.15, 0.0, abs(fract(helix) - 0.5) - 0.17) * smoothstep(1.95, 0.9, phi);
    bandsK *= smoothstep(0.08, 0.2, t) * smoothstep(0.98, 0.84, t);
    vec3 flankC = vec3(0.66, 0.72, 0.7);
    albedo = mix(flankC * 0.3, back, dors);
    albedo = mix(albedo, pB, bandsK * 0.92);
    albedo = mix(albedo, vec3(0.9, 0.9, 0.86) * 0.5, belly);
    mirror = mix(0.58, 0.05, dors) * (1.0 - bandsK * 0.85);
    mirTint = mix(vec3(1.0, 0.95, 0.85), iridescence(dot(N, V), 1.6 + tint * 0.6) * 1.3, 0.35 * (1.0 - belly));
    // a bright bronze lateral stripe
    float stripe = exp(-pow((phi - 1.5 + 0.1 * t) * 8.0, 2.0)) * smoothstep(0.1, 0.25, t) * smoothstep(0.95, 0.7, t);
    mirTint = mix(mirTint, vec3(1.4, 1.05, 0.6), stripe * 0.8);
    // keels on the peduncle
    float keelP = smoothstep(0.7, 0.78, t) * exp(-pow((phi - 1.57) * 6.0, 2.0));
    albedo = mix(albedo, pD * 0.6, keelP * 0.7);
    float gz = L.z - 0.5;
    float mouth = smoothstep(0.004, 0.0, abs(L.y - (-0.012 + gz * 0.06 - gz * gz * 2.0 + 0.0008 * sin(L.z * 700.0)))) * smoothstep(0.445, 0.465, L.z);
    albedo = mix(albedo, vec3(0.03), mouth * 0.9);
    mirror *= 1.0 - mouth;
    float irisK;
    vec4 eye = fishEye(L, vec3(0.0, EYE_Y, EYE_Z), EYE_R, 1.0, vec3(0.8, 0.55, 0.2), irisK, eyeSpec);
    albedo = mix(albedo, eye.rgb, eye.a);
    mirror = mix(mirror, 0.3 * irisK, eye.a);
    mirTint = mix(mirTint, vec3(0.95, 0.78, 0.45), eye.a);
#else
    // ---- lanternjack: slate-bronze mottled back, big bronze scales with dark rims, scutes,
    // luminous lateral-line pores, a heavy plated head with an underbite, scars
    vec3 back = pA * (0.8 + 0.3 * tint);
    vec3 flank = pB * (0.9 + 0.2 * tint);
    float mott = fbm2(vec2(t * 9.0, phi * 3.0) + seed * 7.0);
    // faint dark saddles across the back, and blotchy mottling
    float saddle = smoothstep(0.55, 0.85, sin(t * 22.0 + seed * 5.0 + phi * 0.8)) * smoothstep(1.7, 0.6, phi) * smoothstep(0.15, 0.3, t) * smoothstep(0.85, 0.7, t);
    albedo = mix(flank * 0.42, back * (0.7 + 0.6 * mott), dors);
    albedo = mix(albedo, back * 0.45, saddle * 0.6);
    albedo = mix(albedo, vec3(0.86, 0.84, 0.78) * 0.55, belly);
    mirror = mix(0.5, 0.06, dors) * (1.0 - head * 0.5) * (1.0 - saddle * 0.5);
    mirTint = mix(vec3(1.05, 0.9, 0.7), vec3(1.0), belly);
    // scale margins: a little darker
    albedo *= 1.0 - scaleEdge * 0.2;
    mirror *= 1.0 - scaleEdge * 0.25;
    // the lateral line arches over the pectoral, then runs straight along the tail with scutes
    float llY = mix(0.6 + 0.25 * sin(clamp((t - 0.1) / 0.5, 0.0, 1.0) * 3.14159), 1.45, smoothstep(0.55, 0.75, t));
    float ll = exp(-pow((phi - llY) * 14.0, 2.0)) * smoothstep(0.12, 0.2, t);
    float scute = ll * smoothstep(0.6, 0.72, t) * (0.6 + 0.4 * sin(t * 260.0));
    albedo = mix(albedo, pD * 0.8 + vec3(0.06), scute * 0.7);
    N = normalize(N + T * sin(t * 260.0) * scute * 0.25);
    float pores = ll * smoothstep(0.7, 0.95, sin(t * 120.0)) * (1.0 - smoothstep(0.6, 0.7, t));
    emis += pC * pores * (0.04 + 0.5 * uNight + 0.6 * special) * 0.6;
    // scars: a few pale slashes
    float u1 = (L.z - 0.08 - seed * 0.05) / 0.07, u2 = (L.z + 0.04) / 0.05;
    float w1 = 0.004 * max(1.0 - u1 * u1, 0.05) * (0.7 + 0.3 * sin(u1 * 9.0 + seed));
    float w2 = 0.003 * max(1.0 - u2 * u2, 0.05) * (0.7 + 0.3 * sin(u2 * 7.0 - seed));
    float sc1 = smoothstep(w1, w1 * 0.2, abs(L.y - 0.03 - (L.z - 0.1) * 0.7 + 0.03 * sin(seed * 6.0) + 0.004 * sin(u1 * 5.0 + seed * 3.0) + 0.006 * u1 * u1)) * step(abs(u1), 1.0) * step(0.4, fract(seed * 3.7));
    float sc2 = smoothstep(w2, w2 * 0.2, abs(L.y + 0.02 + (L.z + 0.05) * 1.1 + 0.003 * sin(u2 * 6.0 + seed * 2.0) - 0.004 * u2 * u2)) * step(abs(u2), 1.0) * step(0.5, fract(seed * 5.3));
    albedo = mix(albedo, vec3(0.75, 0.68, 0.62), (sc1 + sc2) * 0.8);
    mirror *= 1.0 - (sc1 + sc2);
    // head plates: rough, darker, with sutures
    float plates = head * (0.6 + 0.4 * vnoise(vec2(L.z * 90.0, L.y * 90.0)));
    albedo = mix(albedo, back * 0.9 + flank * 0.15, head * 0.55);
    albedo *= 1.0 - head * smoothstep(0.75, 0.95, vnoise(vec2(L.z * 60.0, phi * 9.0))) * 0.35 * plates;
    // the dark opercular spot
    float ospot = smoothstep(0.03, 0.015, length(vec2(L.z - (opz + 0.012), (phi - 0.75) * 0.08)));
    albedo = mix(albedo, vec3(0.02), ospot * 0.85);
    // gape: a deep, upturned mouth line with an underbite
    float gy = -0.036 - (L.z - 0.5) * 0.3 + (L.z - 0.43) * (L.z - 0.43) * 3.0 + 0.0012 * sin(L.z * 400.0);
    float mouth = smoothstep(0.005, 0.0, abs(L.y - gy)) * smoothstep(0.405, 0.43, L.z);
    albedo = mix(albedo, vec3(0.02, 0.01, 0.01), mouth);
    mirror *= 1.0 - mouth;
    float irisK;
    vec4 eye = fishEye(L, vec3(0.0, EYE_Y, EYE_Z), EYE_R, 0.0, vec3(0.85, 0.62, 0.22), irisK, eyeSpec);
    albedo = mix(albedo, eye.rgb, eye.a);
    mirror = mix(mirror, 0.35 * irisK, eye.a);
    mirTint = mix(mirTint, vec3(1.2, 0.95, 0.55), eye.a);
    // eyeshine: a tapetum returns light toward its source (lures, moon, the viewer's side)
    vec2 qe = vec2(L.z - EYE_Z, L.y - EYE_Y) / EYE_R;
    float pupilK = smoothstep(0.5, 0.4, length(qe)) * eye.a;
    emis += pC * pupilK * pow(max(dot(N, V), 0.0), 6.0) * (1.2 * uNight + 0.8 * special) * 0.35;
#endif
    albedo = mix(albedo, albedo * 0.45, operLine * 0.8);
    mirror *= 1.0 - operLine * 0.7;
    // the gill cover overlaps the body: its free edge steps down (a shaded lip), its plate bulges
    float operBand = exp(-pow((L.z - opz) / 0.0035, 2.0)) * operTaper;
    float operPlate = smoothstep(opz, opz + 0.03, L.z) * smoothstep(opz + 0.075, opz + 0.03, L.z) * operTaper;
    N = normalize(N - T * operBand * 0.9 + T * operPlate * 0.12);
#if SPECIES != 2
    // the lateral line: a row of pored scales drawn as a slightly wavering dotted stroke
    float llC = 1.28 - 0.18 * smoothstep(0.1, 0.4, t) + 0.025 * sin(t * 13.0 + seed * 4.0);
    float llK = exp(-pow((phi - llC) * 28.0, 2.0)) * smoothstep(0.08, 0.16, t) * smoothstep(0.92, 0.8, t);
    float llDot = smoothstep(0.55, 0.9, sin(t * SCALE_ALONG * 3.14159 + 0.5));
    albedo = mix(albedo, albedo * 0.35, llK * (0.35 + 0.5 * llDot));
    mirror *= 1.0 - llK * 0.45;
#endif
    // every scale's guanine platelets shift the hue a little differently (thin film), and the
    // mirror breaks into a mosaic of slightly different silvers
    vec3 film = iridescence(dot(N, V) * 0.75 + scaleId * 0.55, 1.15 + scaleId * 0.8);
    mirTint *= mix(vec3(1.0), film * 1.25, 0.38 * (1.0 - dors * 0.6) * (1.0 - belly * 0.6));
    mirTint *= 0.82 + 0.36 * fract(scaleId * 13.7);
    mirror *= 1.0 - scaleEdge * 0.4;
    // scale margins catch a little dark pigment; each scale's platelets tilt a little differently
    albedo *= 1.0 - scaleEdge * 0.18;
    // platelets stay (nearly) vertical across the curved flank: a mirror facing sideways
    vec3 lateral = vRight * side;
    // (the belly's platelets face down: seen from below, fish are dark against the surface)
    Nm = normalize(mix(N, lateral, 0.42 * (1.0 - dors * 0.7) * (1.0 - eyeSpec) * (1.0 - belly * 0.8)));
    // each scale's platelets tilt a little differently: a fine mosaic of silvers, not sequins
    Nm = normalize(Nm + (T * (scaleId - 0.5) * 0.16 + vUp * (fract(scaleId * 7.31) - 0.5) * 0.12) * (1.0 - dors));
    trans = 0.08;
    // wet skin catches the sun as a soft sheen (the water above blurs and dims it); the cornea
    // keeps a sharp highlight
    spec = (0.12 + 0.18 * dors) * (1.0 - 0.6 * smoothstep(0.0, 2.0, uSeaLevel - vWorldPos.y)) + eyeSpec * 1.6;
    gloss = 0.7 + eyeSpec * 0.28;
    rim = 0.45;
    wrap = 0.24;
    ao = mix(0.72, 1.0, smoothstep(2.9, 1.2, phi));
  } else if (part < 1.5 || (part > 1.5 && part < 3.5) || part > 7.5) {
    // ================= median fins: caudal, dorsal / sail, anal, finlets =================
    float ray = vR.w;
    float s = vF.z;
#if SPECIES == 0
    vec3 fin = part < 1.5 ? mix(vec3(0.62, 0.62, 0.5), pC, 0.35 + 0.25 * (1.0 - s)) : mix(vec3(0.5, 0.55, 0.55), pA, 0.45);
    float nR = part < 1.5 ? 14.0 : 8.0;
#elif SPECIES == 1
    vec3 fin = part > 1.5 && part < 2.5 ? pC * 0.7 : (part > 7.5 ? vec3(0.32, 0.28, 0.14) : mix(pA, pB, 0.5));
    float nR = part > 1.5 && part < 2.5 ? 22.0 : 12.0;
#else
    vec3 fin = mix(pD, pA, 0.35);
    float nR = part < 1.5 ? 18.0 : 12.0;
#endif
    // soft rays branch in two past mid-fin and are jointed (segmented) along their length
    float br = s > 0.5 ? 2.0 : 1.0;
    float rays = smoothstep(0.42, 0.18, abs(fract(ray * nR * br + 0.08 * sin(s * 7.0 + ray * 11.0)) - 0.5)) * smoothstep(0.02, 0.15, s);
    rays *= 0.8 + 0.2 * smoothstep(0.3, 0.8, sin(s * 60.0 + ray * 3.0));
    // hyaline membrane with fine, slightly darker rays
    albedo = fin * (1.0 - rays * 0.35) * 0.9;
    // translucent membrane, thicker and darker at the margins
    float margin = smoothstep(0.82, 1.0, s);
    albedo = mix(albedo, albedo * 0.4, margin * 0.6);
#if SPECIES == 0
    // the tail fork's dark tips
    if (part < 1.5) albedo = mix(albedo, vec3(0.05, 0.06, 0.07), smoothstep(0.8, 1.0, s) * smoothstep(0.25, 0.9, abs(ray - 0.5) * 2.0));
#elif SPECIES == 1
    if (part > 1.5 && part < 2.5) {
      // sail: dark eye-spots ringed in gold between the rays, a dusky base, a gold crest that
      // curls; an iridescent sheen across the membrane
      vec2 sq = vec2(fract(ray * 6.0) - 0.5, (fract(s * 2.6 + 0.3) - 0.5) * 1.5);
      float sd = length(sq);
      float spot = smoothstep(0.24, 0.16, sd) * smoothstep(0.15, 0.35, s) * smoothstep(0.85, 0.62, s);
      float ringS = smoothstep(0.3, 0.24, sd) * (1.0 - smoothstep(0.24, 0.18, sd)) * smoothstep(0.15, 0.35, s) * smoothstep(0.85, 0.62, s);
      albedo = mix(albedo, pB * 0.6, smoothstep(0.35, 0.0, s) * 0.7);
      albedo = mix(albedo, pB * 0.5, spot * 0.85);
      albedo = mix(albedo, pD * 0.9, ringS * 0.8);
      albedo = mix(albedo, pD, smoothstep(0.84, 0.97, s) * 0.85);
      mirror = 0.22;
      mirTint = iridescence(dot(N, V), 2.4 + tint) * 1.2;
    }
    if (part < 1.5) albedo = mix(albedo, pB, smoothstep(0.35, 0.95, s) * 0.5);
#else
    // charcoal fins with a faint luminous edge
    emis += pC * smoothstep(0.93, 1.0, s) * (0.02 + 0.25 * uNight + 0.3 * special) * 0.4;
#endif
    // scalloped margins between the ray tips; thin membrane between the rays
    float edge = 0.94 + 0.06 * cos(ray * nR * 6.2831853);
#if SPECIES == 2
    float memA = 0.82;
#elif SPECIES == 1
    float memA = part > 1.5 && part < 2.5 ? 0.78 : 0.66;
#else
    float memA = 0.8;
#endif
    alpha = (1.0 - smoothstep(edge - 0.035, edge + 0.01, s)) * mix(memA, min(memA + 0.12, 1.0), max(rays, smoothstep(0.3, 0.0, s)));
    if (dot(N, V) < 0.0) N = -N;
    trans = part > 7.5 ? 0.15 : 0.45;
    spec = 0.3;
    gloss = 0.8;
    rim = 0.35;
    wrap = 0.35;
    Nm = N;
    mirror = max(mirror, 0.06);
  } else if (part < 5.5) {
    // ================= paired fins: pectorals (glint fins) and pelvics =================
    float ray = vR.w;
    float s = vF.z;
    float nR = 9.0;
    float rays = smoothstep(0.3, 0.05, abs(fract(ray * nR) - 0.5)) * smoothstep(0.03, 0.2, s);
#if SPECIES == 0
    if (part < 4.5) {
      // glint fins: thin-film iridescent membranes; flared, they flash a signal through the school
      albedo = vec3(0.06, 0.08, 0.1);
      mirror = 0.3 + 0.6 * flare;
      mirTint = iridescence(dot(N, V), 1.9 + tint * 0.8 + s * 0.6) * (0.9 + flare * 0.9);
      Nm = N;
    } else {
      albedo = vec3(0.7, 0.72, 0.7);
    }
#elif SPECIES == 1
    albedo = mix(pA, pB, 0.4) * (1.0 - rays * 0.3);
    if (part < 4.5) { mirror = 0.2; mirTint = iridescence(dot(N, V), 2.0) * 1.2; }
#else
    albedo = mix(pD, pA, 0.5) * (1.0 - rays * 0.3);
#endif
    albedo *= 1.0 - rays * 0.25;
    float edge = 0.95 + 0.05 * cos(ray * nR * 6.2831853);
    alpha = (1.0 - smoothstep(edge - 0.04, edge + 0.01, s)) * mix(0.55, 0.8, rays);
    if (dot(N, V) < 0.0) N = -N;
    Nm = dot(Nm, V) < 0.0 ? -Nm : Nm;
    trans = 0.7;
    spec = 0.5;
    rim = 0.7;
    wrap = 0.35;
  } else if (part < 6.5) {
    // ================= lure filament =================
    albedo = mix(pD * 0.6, pC * 0.25, vF.z);
    emis += pC * smoothstep(0.75, 1.0, vF.z) * (0.05 + 0.5 * uNight + 0.5 * special) * 0.5;
    trans = 0.8;
    spec = 0.4;
  } else if (part < 7.5) {
    // ================= lure bulb: a living light in a translucent sac =================
    float pulse = 0.75 + 0.25 * sin(uTime * (1.6 + vF.w * 0.37) + seed * 9.0);
    float core = pow(max(dot(N, V), 0.0), 1.5);
    float glow = (0.18 + 1.6 * uNight + 1.4 * special) * pulse;
    albedo = mix(pC * 0.5, vec3(0.9), 0.2);
    emis += pC * glow * (0.35 + 1.4 * core);
    spec = 1.0;
    gloss = 0.95;
    trans = 1.5;
    rim = 1.0;
  }

  Surface sf = makeSurface(albedo, N, vWorldPos);
#ifdef NEAR
  sf.shadow = sampleShadow(vWorldPos, N);
#else
  sf.shadow = 1.0;
#endif
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
  // mirror-silver: the reflected light field (plus an alarm flash when the school startles)
  if (mirror > 0.0) {
    vec3 R = reflect(-V, Nm);
    vec3 env = seaLightField(R, air);
    float fres = 0.75 + 0.25 * pow(1.0 - max(dot(N, V), 0.0), 2.0);
    col = mix(col, col * 0.45 + env * mirTint * fres, mirror);
    col += env * mirTint * mirror * flash * 1.6;
  }
#ifdef NEAR
  // each scale's platelets tilt their own way: a few catch the (refracted) sun and glint
  if (part < 0.5 && mirror > 0.05) {
    vec3 sunD = normalize(mix(-waterSunRefract(), uSunDir, air));
    float sunUpG = smoothstep(-0.05, 0.25, uSunDir.y) * (1.0 - uStorm * 0.8);
    float g = pow(max(dot(reflect(-V, Nm), sunD), 0.0), 48.0);
    col += uSunColor * mirTint * g * mirror * sunUpG * 1.6;
  }
#endif
  // wet skin: a fresnel rim of the bright water above
  float fr = pow(1.0 - abs(dot(N, V)), 4.0);
  col += seaLightField(reflect(-V, N), air) * fr * (part < 0.5 ? 0.28 : 0.12);
  // fins glow when the light comes through them
  if (part > 0.5 && part < 5.5) {
    float back = pow(max(dot(-V, uSunDir), 0.0), 3.0) + 0.25 * max(-dot(N, uSunDir), 0.0);
    col += albedo * uSunColor * back * 0.55 * (1.0 - 0.5 * uNight);
  }
#ifdef NEAR
  // caustics play over the back in the shallows
  float depC = uSeaLevel - vWorldPos.y;
  if (depC > 0.15 && depC < 25.0 && N.y > 0.0 && uWaterParams.x > 0.0 && part < 0.5) {
    float sunUp = smoothstep(-0.05, 0.25, uSunDir.y) * (1.0 - uStorm * 0.7);
    col += vec3(0.5, 0.72, 0.66) * uSunColor * waterCaustics(vWorldPos, depC) * 0.16 * N.y * sunUp * exp(-depC * 0.12);
  }
#endif
  // the cornea's catchlight: the bright water overhead and the sun
  if (eyeSpec > 0.0) {
    float cl = pow(max(dot(N, normalize(V + vec3(0.0, 0.9, 0.0) + vFwd * 0.3)), 0.0), 140.0);
    col += vec3(0.95, 0.97, 1.0) * cl * eyeSpec * 1.6;
  }
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, alpha);
}
`;

const SPEC_DEFS = {
  glintfin: { SPECIES: 0, WAVELEN: '0.95', EYE_Y: GLINT_EYE.y, EYE_Z: GLINT_EYE.z, EYE_R: GLINT_EYE.r, SCALE_ALONG: '58.0', SCALE_AROUND: '16.0', SCALE_RELIEF: '0.35', OPER_Z: '0.352' },
  spiralback: { SPECIES: 1, WAVELEN: '1.05', EYE_Y: SPIRAL_EYE.y, EYE_Z: SPIRAL_EYE.z, EYE_R: SPIRAL_EYE.r, SCALE_ALONG: '80.0', SCALE_AROUND: '24.0', SCALE_RELIEF: '0.25', OPER_Z: '0.345' },
  lanternjack: { SPECIES: 2, WAVELEN: '1.1', EYE_Y: LANTERN_EYE.y, EYE_Z: LANTERN_EYE.z, EYE_R: LANTERN_EYE.r, SCALE_ALONG: '64.0', SCALE_AROUND: '20.0', SCALE_RELIEF: '0.3', OPER_Z: '0.32' },
};

const f = (x) => (typeof x === 'number' ? (Number.isInteger(x) ? x.toFixed(1) : String(x)) : x);

export function fishMaterial(species, near, lod) {
  const d = SPEC_DEFS[species];
  const defines = {};
  for (const [k, v] of Object.entries(d)) defines[k] = k === 'SPECIES' ? v : f(v);
  if (near) defines.NEAR = '';
  const P = FISH_PALETTES[species];
  const m = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines,
    uniforms: Object.assign({}, G, {
      uPalA: { value: P.map((p) => p[0]) },
      uPalB: { value: P.map((p) => p[1]) },
      uPalC: { value: P.map((p) => p[2]) },
      uPalD: { value: P.map((p) => p[3]) },
      uFishLod: { value: lod || new Vector4(0.6, 1, 0, 0) },
    }),
    side: FrontSide,
  });
  m.alphaToCoverage = true;
  return m;
}

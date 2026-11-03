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
import { GLINT_EYE, SPIRAL_EYE, LANTERN_EYE, LANTERN_EYES, LANTERN_LURE, JACK_JAW } from './fishGeo.js';

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
    [C('#1c2527'), C('#7d6040'), C('#6ff0d8'), C('#141c22')],
    [C('#171c29'), C('#6d7088'), C('#8cf5b4'), C('#141826')],
    [C('#2a1f1b'), C('#8c5c3a'), C('#7ad2ff'), C('#22160f')],
    [C('#1d2621'), C('#7f7c5c'), C('#ffcf86'), C('#151d18')],
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
varying float vJaw;
float envT(float t) { return 0.03 + 0.12 * t + 0.85 * t * t; }
#if SPECIES == 2
// the gape line (fishGeo.js jackMouth)
float jackMouth(float z) { float g = clamp(0.5 - z, 0.0, 0.17); return -0.03 + g * 0.12 - 0.3 * g * (0.17 - g); }
#endif
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
      // cruising, the sail stays half raised (its coil still shows); alarmed or leaping it stands
      float fold = (1.0 - max(special, 0.4)) * max(1.48 - rake, 0.0);
      pr = rotX(-fold) * pr;
      // the corkscrew: each ray leans further round the body axis than the one before it, and
      // twists along its own length, so the crest winds like a helix down the back
      float twist = (aR.w - 0.45) * 1.9 + s * s * 0.8 + 0.1 * sin(ph * 0.4 + aR.w * 5.0);
      mat3 Rt = rotZ(twist * (0.55 + 0.45 * max(special, 0.4)));
      pr = Rt * pr;
      n = Rt * n;
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
#if SPECIES == 2
    // the brow lure: a hinged stalk folded back along the crest while the jack cruises, swung
    // forward when it stalks and charges to dangle the bulb before its jaws; the pendant line
    // hangs from the stalk's last joint, trails with speed and swings slowly
    float raise = smoothstep(0.25, 0.85, special);
    float fold = (1.0 - raise) * 1.15 + 0.05 * sin(uTime * 0.7 + iSeed.x * 9.0);
    mat3 Rf = rotX(-fold);
    vec3 J1 = root + Rf * (LURE_J - root);
    p = root + Rf * (p - root);
    n = Rf * n;
    if (s > 0.6) {
      float drag = clamp(sp * 0.06, 0.0, 0.7);
      float swing = fold + drag + 0.1 * sin(uTime * 1.1 + iSeed.x * 5.0);
      mat3 Rp = rotZ(0.16 * sin(uTime * 0.8 + iSeed.x * 3.0) + 0.08 * sin(ph * 0.3)) * rotX(swing);
      p = J1 + Rp * (p - J1);
      n = Rp * n;
    }
#else
    // lure whips trail and sway; the bulb rides the tip
    float u = s;
    float sway = 0.035 * sin(uTime * 1.7 + aF.w * 2.1 - u * 3.0) + 0.02 * sin(ph * 0.3 + aF.w);
    float drag = clamp(sp * 0.04, 0.0, 0.25);
    p.x += u * u * sway * 1.6;
    p.y += u * u * (0.02 * sin(uTime * 1.3 + aF.w * 1.7) - drag * 0.5);
    p.z -= u * u * drag;
#endif
  } else if (part > 7.5 && part < 8.5) {
    p.x += s * 0.01 * sin(ph * 1.2 + t * 25.0);
  } else if (part > 8.5 && part < 9.5) {
    p.x += s * s * 0.012 * sin(ph * 0.7 + t * 8.0);
  }
  // ---- the jaw: the lanternjack's lower jaw (everything below the gape line in front of the jaw
  // joint, and the lower fangs) drops and splays; the lips tear apart over a dark gullet
  float jawK = 0.0;
#if SPECIES == 2
  float gapeA = iMisc.w;
  {
    float zj = position.z;
    float mz = smoothstep(JAW_Z - 0.004, JAW_Z + 0.03, zj);
    float dyj = position.y - jackMouth(zj);
    // the mandible swings fully; the throat skin under it follows only part way (a gular pouch)
    if (part < 0.5) jawK = (1.0 - smoothstep(-0.0015, 0.0025, dyj)) * mz * (0.35 + 0.65 * smoothstep(-0.12, -0.05, dyj));
    else if (part > 10.5 && aF.w > 0.5 && aF.w < 1.5) jawK = mz;
    if (jawK > 0.0 && gapeA > 0.001) {
      vec3 hj = vec3(0.0, JAW_Y, JAW_Z);
      mat3 Rj = rotX(gapeA * 0.62 * jawK);
      p = hj + Rj * (p - hj);
      n = Rj * n;
      p.x *= 1.0 + gapeA * 0.22 * jawK * smoothstep(JAW_Z, 0.5, zj);
    }
  }
#endif
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
  vJaw = jawK;
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
varying float vJaw;
#if SPECIES == 2
float jackMouth(float z) { float g = clamp(0.5 - z, 0.0, 0.17); return -0.03 + g * 0.12 - 0.3 * g * (0.17 - g); }
#endif

// armour plates: wobbly cells (a domain-warped Voronoi, so no suture is ever ruled): x the
// distance to the nearest suture, y the plate's id, zw the offset from the plate's centre
vec4 plateCells(vec2 p) {
  p += vec2(vnoise(p * 1.3), vnoise(p * 1.3 + 5.3)) * 0.55;
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  vec2 c1 = vec2(0.0), o1 = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 r = g + 0.15 + 0.7 * hash22(i + g) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; c1 = i + g; o1 = r; } else if (d < d2) d2 = d;
  }
  return vec4(sqrt(d2) - sqrt(d1), hash12(c1), -o1);
}

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

  if (part > 10.5) {
    // ================= bone: fangs, horns, spines, the corkscrew bill =================
    float s = vF.z;
    float kind = vF.w;
    if (kind < 1.5) {
      // fangs: wet ivory, glassy toward the tips, stained dark where they leave the gum
      albedo = mix(vec3(0.3, 0.17, 0.15), vec3(0.8, 0.76, 0.64), smoothstep(0.0, 0.3, s));
      albedo = mix(albedo, vec3(0.62, 0.66, 0.64), smoothstep(0.65, 1.0, s));
      albedo *= 0.9 + 0.1 * sin(s * 30.0 + vR.w * 6.2831853);
      trans = 0.5 * s; spec = 0.8; gloss = 0.85; rim = 0.45; wrap = 0.3;
    } else {
      // horn: dark keratin with wavering growth rings, worn pale toward the tip
      float wob = 0.6 * sin(vR.w * 6.2831853 + s * 5.0) + 0.4 * vnoise(vec2(s * 20.0, vR.w * 6.0 + seed * 7.0));
      float rings = smoothstep(0.25, 0.9, sin(s * 46.0 + wob * 1.6));
      vec3 base = pA * 0.4 + vec3(0.025, 0.02, 0.02);
      albedo = mix(base, vec3(0.6, 0.55, 0.45), smoothstep(0.3, 1.0, s) * (0.75 + 0.25 * wob));
      albedo *= 1.0 - rings * 0.22 * (1.0 - s * 0.6);
      N = normalize(N + vFwd * (rings - 0.5) * 0.12);
      trans = 0.08; spec = 0.3; gloss = 0.55; rim = 0.5; wrap = 0.25;
#if SPECIES == 1
      if (kind > 2.5) {
        // the spiralback's bill: a twisted tusk whose helical grooves run to the tip
        float hel = fract(s * 9.0 + vR.w * 2.0 + 0.04 * sin(s * 23.0 + seed * 4.0));
        float groove = smoothstep(0.18, 0.0, abs(hel - 0.5) - 0.28);
        albedo = mix(mix(pA * 0.55, vec3(0.62, 0.6, 0.52), smoothstep(0.1, 0.9, s)), pA * 0.2, groove * 0.75);
        N = normalize(N + vRight * (hel - 0.5) * 0.35 * (1.0 - s));
        spec = 0.45; gloss = 0.7;
      }
#endif
    }
    Nm = N;
    mirror = 0.0;
  } else if (part < 0.5 || part > 9.5) {
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
    // the head is glass-clear (like a barreleye's): through it show the skull (a pale braincase,
    // the bony orbit round the eye, the jaw bones) and the blood-red gill arches; all drawn as
    // soft, wavering strokes seen through living tissue
    float glass = smoothstep(opz - 0.002, opz + 0.012, L.z);
    {
      float wob = 0.0015 * sin(L.z * 310.0 + seed * 4.0) + 0.001 * sin(L.y * 520.0);
      // braincase: a dome above and behind the eye
      vec2 bq = vec2((L.z - 0.402) / 0.04, (L.y - 0.024) / 0.026);
      float bc = length(bq) + wob * 30.0;
      float brain = smoothstep(1.0, 0.82, bc);
      float brainRim = smoothstep(0.16, 0.0, abs(bc - 0.92));
      // the orbit: a ring of bone round the eye
      float od = length(vec2(L.z - EYE_Z, L.y - EYE_Y)) / EYE_R;
      float orbit = smoothstep(0.18, 0.0, abs(od - 1.32 - 6.0 * wob));
      // jaw bones: the maxilla above the gape, the dentary below, a hinge knob
      float gz2 = L.z - 0.5;
      float gape = -0.006 + gz2 * 0.05 - gz2 * gz2 * 2.2;
      float maxilla = smoothstep(0.0028, 0.0, abs(L.y - gape - 0.006 - wob)) * smoothstep(0.43, 0.45, L.z);
      float dentary = smoothstep(0.0032, 0.0, abs(L.y - gape + 0.008 + wob)) * smoothstep(0.42, 0.45, L.z);
      // gill arches: four red crescents in front of the gill cover's edge
      float ga = 0.0;
      for (int k = 0; k < 4; k++) {
        float zk = opz + 0.008 + float(k) * 0.0065 + 0.002 * cos(phi * 2.0 + float(k));
        ga = max(ga, smoothstep(0.0022, 0.0, abs(L.z - zk - 0.004 * cos(phi * 1.6))) * smoothstep(0.6, 1.0, phi) * smoothstep(2.6, 2.1, phi));
      }
      vec3 deep = mix(vec3(0.03, 0.07, 0.09), back * 0.25, 0.3);
      vec3 inner = deep;
      inner = mix(inner, vec3(0.5, 0.48, 0.42), brain * 0.35);
      inner = mix(inner, vec3(0.82, 0.8, 0.72), max(max(brainRim * 0.7, orbit), max(maxilla, dentary) * 0.8));
      inner = mix(inner, vec3(0.55, 0.06, 0.07), ga * 0.85);
      albedo = mix(albedo, inner, glass);
      mirror *= 1.0 - glass * 0.85;
      mirTint = mix(mirTint, vec3(0.9, 1.0, 1.05), glass);
    }
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
    mirror = mix(mirror, 0.1 * irisK, eye.a);
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
    mirror = mix(mirror, 0.1 * irisK, eye.a);
    mirTint = mix(mirTint, vec3(0.95, 0.78, 0.45), eye.a);
#else
    // ---- lanternjack: a dark, war-painted hunter: charcoal back, rust-bronze flank broken by
    // ragged tiger bars, big rough scales, bony scutes, a skull armoured in domed plates with
    // dark sutures, a crimson gullet behind interlocking fangs, three eyes a side
    vec3 back = pA * (0.8 + 0.3 * tint);
    vec3 flank = pB * (0.9 + 0.2 * tint);
    float mott = fbm2(vec2(t * 9.0, phi * 3.0) + seed * 7.0);
    albedo = mix(flank * 0.42, back * (0.7 + 0.6 * mott), dors);
    albedo = mix(albedo, vec3(0.78, 0.74, 0.68) * 0.5, belly);
    // tiger bars: hand-drawn strokes that waver, fork and break, fading into the belly
    float bw = vnoise(vec2(t * 26.0, phi * 5.0) + seed * 3.0);
    float barF = t * 8.5 + 0.18 * sin(phi * 2.6 + seed * 4.0 + t * 9.0) + 0.22 * bw;
    float bars = smoothstep(0.3, 0.12, abs(fract(barF) - 0.5) - 0.06 * sin(phi * 7.0 + t * 30.0)) * smoothstep(2.3, 1.2, phi) * smoothstep(0.1, 0.2, t) * smoothstep(0.86, 0.68, t);
    bars *= smoothstep(0.25, 0.55, vnoise(vec2(t * 14.0 + seed, phi * 2.2)) + 0.25);
    albedo = mix(albedo, back * 0.3, bars * 0.75);
    mirror = mix(0.36, 0.04, dors) * (1.0 - head * 0.85) * (1.0 - bars * 0.7);
    mirTint = mix(vec3(1.05, 0.88, 0.66), vec3(0.95), belly);
    // scale margins: a little darker
    albedo *= 1.0 - scaleEdge * 0.25;
    mirror *= 1.0 - scaleEdge * 0.3;
    // the lateral line arches over the pectoral, then runs straight along the tail with scutes
    float llY = mix(0.6 + 0.25 * sin(clamp((t - 0.1) / 0.5, 0.0, 1.0) * 3.14159), 1.45, smoothstep(0.55, 0.75, t));
    float ll = exp(-pow((phi - llY) * 14.0, 2.0)) * smoothstep(0.12, 0.2, t);
    float scute = ll * smoothstep(0.55, 0.7, t) * (0.6 + 0.4 * sin(t * 260.0));
    albedo = mix(albedo, vec3(0.5, 0.46, 0.4) * 0.6, scute * 0.7);
    N = normalize(N + T * sin(t * 260.0) * scute * 0.3);
    // pored scales along the line: dark pits (no lights)
    float pores = ll * smoothstep(0.7, 0.95, sin(t * 120.0)) * (1.0 - smoothstep(0.6, 0.7, t));
    albedo *= 1.0 - pores * 0.5;
    // scars: a few pale slashes
    float u1 = (L.z - 0.08 - seed * 0.05) / 0.07, u2 = (L.z + 0.04) / 0.05;
    float w1 = 0.004 * max(1.0 - u1 * u1, 0.05) * (0.7 + 0.3 * sin(u1 * 9.0 + seed));
    float w2 = 0.003 * max(1.0 - u2 * u2, 0.05) * (0.7 + 0.3 * sin(u2 * 7.0 - seed));
    float sc1 = smoothstep(w1, w1 * 0.2, abs(L.y - 0.03 - (L.z - 0.1) * 0.7 + 0.03 * sin(seed * 6.0) + 0.004 * sin(u1 * 5.0 + seed * 3.0) + 0.006 * u1 * u1)) * step(abs(u1), 1.0) * step(0.4, fract(seed * 3.7));
    float sc2 = smoothstep(w2, w2 * 0.2, abs(L.y + 0.02 + (L.z + 0.05) * 1.1 + 0.003 * sin(u2 * 6.0 + seed * 2.0) - 0.004 * u2 * u2)) * step(abs(u2), 1.0) * step(0.5, fract(seed * 5.3));
    albedo = mix(albedo, vec3(0.7, 0.62, 0.56), (sc1 + sc2) * 0.8);
    mirror *= 1.0 - (sc1 + sc2);
    // armour: the skull and the nape are tiled with domed bony plates, dark sutures between
    // them, their rims worn pale; the plates grow larger over the crown
    float armour = max(head, smoothstep(0.24, 0.3, L.z) * smoothstep(1.0, 0.55, phi));
#ifdef NEAR
    if (armour > 0.01 && px > 18.0) {
      vec4 pc = plateCells(vec2(L.z * 58.0, phi * (3.4 + 1.2 * smoothstep(0.9, 0.2, phi))) + seed * 11.0);
      float sw = 0.05 + 0.04 * vnoise(vec2(L.z * 300.0, phi * 30.0));
      float suture = smoothstep(sw, sw * 0.3, pc.x);
      float worn = smoothstep(0.08, 0.2, pc.x) * smoothstep(0.32, 0.18, pc.x);
      vec3 plate = mix(back * 1.05 + vec3(0.04, 0.035, 0.03), vec3(0.5, 0.47, 0.42) * 0.55, 0.35 + 0.3 * pc.y);
      plate *= 0.75 + 0.35 * fbm2(vec2(L.z * 140.0, phi * 14.0) + pc.y * 9.0);
      plate = mix(plate, plate * 1.35 + vec3(0.03), worn * 0.5);
      plate = mix(plate, vec3(0.012, 0.01, 0.01), suture * 0.9);
      float ak = armour * smoothstep(18.0, 50.0, px);
      albedo = mix(albedo, plate, ak);
      N = normalize(N + (T * pc.z * 0.5 - U * pc.w * 0.5) * ak * (1.0 - suture));
      mirror *= 1.0 - ak;
    }
#endif
    albedo = mix(albedo, back * 0.75 + flank * 0.12, head * 0.35 * (1.0 - armour));
    // the gape: a jagged dark line with pale-gummed lips; opened, a crimson-black gullet
    float gy = jackMouth(L.z) + 0.0012 * sin(L.z * 400.0 + seed);
    float mouthK = smoothstep(0.335, 0.35, L.z);
    float mouth = smoothstep(0.0055, 0.0, abs(L.y - gy)) * mouthK;
    float gum = smoothstep(0.013, 0.005, abs(L.y - gy)) * mouthK;
    albedo = mix(albedo, vec3(0.32, 0.16, 0.15), gum * 0.6);
    albedo = mix(albedo, vec3(0.02, 0.005, 0.005), mouth);
    float gapeA = flash;
    float maw = gapeA * smoothstep(0.02, 0.25, vJaw) * smoothstep(0.98, 0.75, vJaw) * mouthK;
    float throat = fbm2(vec2(L.z * 90.0, L.y * 140.0));
    vec3 gullet = mix(vec3(0.16, 0.025, 0.03), vec3(0.008, 0.002, 0.004), smoothstep(0.3, 0.8, throat + 0.25 * smoothstep(0.36, 0.48, L.z)));
    albedo = mix(albedo, gullet, maw);
    mirror *= 1.0 - max(mouth, maw);
    float irisK = 0.0;
    float eS = 0.0;
    vec4 eye = fishEye(L, vec3(0.0, EYE_Y, EYE_Z), EYE_R, 0.0, vec3(0.85, 0.5, 0.16), irisK, eyeSpec);
    // the second and third eyes of the cluster: smaller, blood-amber
    float i2, s2, i3, s3;
    vec4 e2 = fishEye(L, vec3(0.0, EYE2.x, EYE2.y), EYE2.z, 0.0, vec3(0.8, 0.32, 0.12), i2, s2);
    vec4 e3 = fishEye(L, vec3(0.0, EYE3.x, EYE3.y), EYE3.z, 0.0, vec3(0.8, 0.32, 0.12), i3, s3);
    if (e2.a > eye.a) { eye = e2; irisK = i2; eyeSpec = s2; }
    if (e3.a > eye.a) { eye = e3; irisK = i3; eyeSpec = s3; }
    albedo = mix(albedo, eye.rgb, eye.a);
    mirror = mix(mirror, 0.08 * irisK, eye.a);
    mirTint = mix(mirTint, vec3(1.2, 0.85, 0.5), eye.a);
    // eyeshine at night: a tapetum returns light toward its source (steady, faint)
    vec2 qe = vec2(L.z - EYE_Z, L.y - EYE_Y) / EYE_R;
    float pupilK = smoothstep(0.5, 0.4, length(qe)) * eye.a;
    emis += pC * pupilK * pow(max(dot(N, V), 0.0), 6.0) * uNight * 0.25;
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
#if SPECIES == 0
    trans = mix(0.08, 0.9, glass);
#endif
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
    vec3 fin = part < 1.5 ? mix(pA * 0.9, pC * 0.8, 0.25 + 0.45 * (1.0 - s)) : mix(vec3(0.5, 0.55, 0.55), pA, 0.45);
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
    if (part < 1.5) albedo = mix(albedo, vec3(0.04, 0.05, 0.06), smoothstep(0.62, 0.98, s) * (0.55 + 0.45 * smoothstep(0.25, 0.9, abs(ray - 0.5) * 2.0)));
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
    // charcoal fins, darkening to the ragged margin
    albedo = mix(albedo, albedo * 0.45, smoothstep(0.6, 0.95, s));
#endif
    // scalloped margins between the ray tips; thin membrane between the rays
#if SPECIES == 2
    float edge;
    if (part > 1.5 && part < 2.5) {
      // the spiny crest: venomous spines webbed only near their roots, the web torn ragged
      float fr = fract(ray * 8.0);
      float gap = min(fr, 1.0 - fr) * 2.0;
      edge = 1.0 - 0.52 * pow(gap, 0.5) - 0.05 * vnoise(vec2(ray * 40.0, seed * 3.0));
      float spine = smoothstep(0.16, 0.0, gap);
      albedo = mix(albedo, vec3(0.05, 0.04, 0.035), spine * 0.6);
      albedo = mix(albedo, vec3(0.55, 0.5, 0.42) * 0.6, spine * smoothstep(0.7, 1.0, s));
    } else {
      // serrated margins: a saw of small hooks raked back
      float k = part < 1.5 ? 24.0 : 15.0;
      edge = 0.985 - 0.085 * fract(ray * k + 0.12 * sin(ray * 9.0 + seed));
    }
#else
    float edge = 0.94 + 0.06 * cos(ray * nR * 6.2831853);
#endif
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
#if SPECIES == 2
    // the jack's pectorals: spiny rays standing proud of a deeply notched web
    float frP = fract(ray * 6.0);
    float edge = 1.0 - 0.2 * pow(min(frP, 1.0 - frP) * 2.0, 0.6);
#else
    float edge = 0.95 + 0.05 * cos(ray * nR * 6.2831853);
#endif
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
    emis += pC * smoothstep(0.75, 1.0, vF.z) * (0.05 + 0.5 * uNight + 0.5 * special) * 0.5 * smoothstep(14.0, 60.0, px);
#if SPECIES == 2
    // the stalk: a jointed spine of dark bone, banded, paling toward the pendant line
    albedo = mix(pA * 0.5, vec3(0.45, 0.42, 0.36), smoothstep(0.3, 0.6, vF.z)) * (0.8 + 0.2 * sin(vF.z * 60.0));
    trans = 0.4;
#endif
    trans = 0.8;
    spec = 0.4;
  } else if (part < 7.5) {
    // ================= lure bulb: a living light in a translucent sac =================
    // a steady, soft light (it brightens and dims only with the hunter's mood, over seconds)
    float core = pow(max(dot(N, V), 0.0), 1.5);
    float glow = (0.18 + 1.3 * uNight + 1.2 * special) * (vF.w > 0.5 ? 0.35 : 1.0);
    // far off, the bulb is a body part, not a point of light (no glowing specks at distance)
    glow *= smoothstep(14.0, 60.0, px);
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
#if SPECIES != 2
    col += env * mirTint * mirror * flash * 1.1;
#endif
  }
#ifdef NEAR
  // the silvered flank catches the (refracted) sun as one broad, soft sheen (no per-scale glints)
  if (part < 0.5 && mirror > 0.05) {
    vec3 sunD = normalize(mix(-waterSunRefract(), uSunDir, air));
    float sunUpG = smoothstep(-0.05, 0.25, uSunDir.y) * (1.0 - uStorm * 0.8);
    float g = pow(max(dot(reflect(-V, N), sunD), 0.0), 8.0);
    col += uSunColor * mirTint * g * mirror * sunUpG * 0.35;
  }
#endif
  // wet skin: a fresnel rim of the bright water above
  float fr = pow(1.0 - abs(dot(N, V)), 4.0);
#if SPECIES == 0
  // the glass head: a clear fresnel skin over the skull
  if (part < 0.5) fr *= 1.0 + 2.2 * smoothstep(OPER_Z, OPER_Z + 0.02, L.z);
#endif
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
  glintfin: { SPECIES: 0, WAVELEN: '0.95', EYE_Y: GLINT_EYE.y, EYE_Z: GLINT_EYE.z, EYE_R: GLINT_EYE.r, SCALE_ALONG: '40.0', SCALE_AROUND: '11.0', SCALE_RELIEF: '0.5', OPER_Z: '0.352' },
  spiralback: { SPECIES: 1, WAVELEN: '1.05', EYE_Y: SPIRAL_EYE.y, EYE_Z: SPIRAL_EYE.z, EYE_R: SPIRAL_EYE.r, SCALE_ALONG: '80.0', SCALE_AROUND: '24.0', SCALE_RELIEF: '0.25', OPER_Z: '0.345' },
  lanternjack: {
    SPECIES: 2, WAVELEN: '1.1', EYE_Y: LANTERN_EYE.y, EYE_Z: LANTERN_EYE.z, EYE_R: LANTERN_EYE.r, SCALE_ALONG: '56.0', SCALE_AROUND: '17.0', SCALE_RELIEF: '0.45', OPER_Z: '0.31',
    EYE2: `vec3(${LANTERN_EYES[1].y}, ${LANTERN_EYES[1].z}, ${LANTERN_EYES[1].r})`, EYE3: `vec3(${LANTERN_EYES[2].y}, ${LANTERN_EYES[2].z}, ${LANTERN_EYES[2].r})`,
    LURE_J: `vec3(0.0, ${LANTERN_LURE.joint[1]}, ${LANTERN_LURE.joint[2]})`, JAW_Y: JACK_JAW.y, JAW_Z: JACK_JAW.z,
  },
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

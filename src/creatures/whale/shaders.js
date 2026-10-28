// Runtime shaders of the Vur Sok whale. Everything is skinned against one skeleton and lit with
// the shared stylized model (common.js) plus a physically based wet-skin specular and sky
// reflection, so the creatures read as real, wet, heavy animals inside the painted world.
import { UNIFORMS, NOISE, SHADOW, LIGHTING, SEA } from '../../render/shaders/common.js';
import { PLEATS } from './skinGLSL.js';

const SKIN_PARS = /* glsl */ `
#include <skinning_pars_vertex>
`;

// ---- shared helpers: wet specular, environment reflection, procedural bump -------------------
export const WET = /* glsl */ `
float ggxD(float nh, float a) {
  float a2 = a * a;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (3.14159265 * d * d);
}
float smithV(float nv, float nl, float a) {
  float k = a * 0.5;
  return 0.25 / ((nv * (1.0 - k) + k) * (nl * (1.0 - k) + k));
}
// Sun highlight + sky reflection of a wet dielectric (F0 ~ 0.028 for skin and keratin).
vec3 wetSpecular(vec3 N, vec3 V, vec3 P, float rough, float shadow, float occ, float f0) {
  float a = max(rough * rough, 0.004);
  vec3 L = uSunDir;
  vec3 H = normalize(L + V);
  float nl = max(dot(N, L), 0.0);
  float nv = max(dot(N, V), 1e-3);
  float nh = max(dot(N, H), 0.0);
  float vh = max(dot(V, H), 0.0);
  float F = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
  vec3 sun = uSunColor * ggxD(nh, a) * smithV(nv, nl, a) * F * nl * shadow;
  // moon at night
  vec3 Hm = normalize(uMoonDir + V);
  float nlm = max(dot(N, uMoonDir), 0.0);
  sun += uMoonColor * ggxD(max(dot(N, Hm), 0.0), a) * smithV(nv, nlm, a) * F * nlm * uNight * 2.0;
  vec3 R = reflect(-V, N);
  float Fe = (f0 + (1.0 - f0) * pow(1.0 - nv, 5.0) / (1.0 + rough * 14.0)) * (1.0 - rough) * (1.0 - rough);
  vec3 env = skyEnv(normalize(vec3(R.x, abs(R.y) * 0.85 + 0.05, R.z)), rough * 6.0);
  // the lower hemisphere reflects the dark sea
  env = mix(env, uSeaBody * 2.0 + uFogColor * 0.08, smoothstep(0.05, -0.25, R.y));
  return sun + env * Fe * occ;
}
// Perturb N by the screen-space gradient of a height h (metres): bump mapping with no tangents.
vec3 bumpN(vec3 N, vec3 P, float h, float k) {
  vec3 dpx = dFdx(P), dpy = dFdy(P);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * N - grad * k);
}
`;

// ---------------------------------------------------------------------------------------------
// Body: skin, mouth, baleen, horns, plates, crest, dome bands, spikes
export const BODY_VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${SKIN_PARS}
attribute vec3 aTan;
attribute vec2 aTex;
attribute vec2 aLoft;
attribute float aPart;
attribute vec4 aP;
attribute vec4 aMask;
uniform float uLen;
uniform float uSac;
uniform float uThroat;
uniform float uVib;
uniform float uBreath;
uniform float uVent;
uniform vec4 uCrest;     // x raise 0..1, y flare 0..1, z shiver, w -
uniform vec3 uAirflow;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vTan;
varying vec2 vTex;
varying vec2 vLoft;
varying float vPart;
varying vec4 vP;
varying vec4 vMask;
void main() {
  #include <skinbase_vertex>
  vec3 objectNormal = normal;
  vec3 transformed = position;
  vec3 tan0 = aTan;
  float part = aPart;
  if (part < 0.5) {
    // breathing swells the ribcage; the flank air sacs follow the buoyancy organs
    transformed += normal * (uBreath * aMask.z * 0.005 + uSac * 0.0015 * aMask.z) * uLen;
    // throat bellows: the pleated throat balloons, buzzing when the whale sings
    float vib = sin(uTime * 83.0 + aLoft.x * 70.0) * uVib;
    float bell = aMask.y;
    float shape = bell * bell * (3.0 - 2.0 * bell);
    transformed += normal * shape * (uThroat * 0.05 + vib * 0.0045) * uLen;
  } else if (part > 4.5 && part < 5.5) {
    // sensor crest: folds back when relaxed, rises, then the two leaves flare apart
    float side = aP.x, w = aP.z;
    vec3 B = vec3(0.0, aP.y, aMask.x);
    vec3 rel = transformed - B;
    float fold = (1.0 - uCrest.x) * 0.95;
    float cf = cos(fold), sf = sin(fold);
    rel = vec3(rel.x, rel.y * cf + rel.z * sf, -rel.y * sf + rel.z * cf);
    vec3 nn = vec3(objectNormal.x, objectNormal.y * cf + objectNormal.z * sf, -objectNormal.y * sf + objectNormal.z * cf);
    float shiver = sin(uTime * 53.0 + aMask.z * 30.0 + w * 4.0) * uCrest.z * w * w;
    float a = side * (uCrest.y * 0.62 + shiver * 0.06);
    // the wind tugs at the free edge a little
    a += side * dot(uAirflow, vec3(side, 0.0, 0.0)) * 0.002 * w;
    float ca = cos(a), sa = sin(a);
    rel = vec3(rel.x * ca + rel.y * sa, -rel.x * sa + rel.y * ca, rel.z);
    nn = vec3(nn.x * ca + nn.y * sa, -nn.x * sa + nn.y * ca, nn.z);
    transformed = B + rel;
    objectNormal = nn;
  } else if (part > 2.5 && part < 3.5) {
    // horn vents: the lips around each slit flare open when the whale sings
    float sdf = aP.z * uLen;
    float rim = exp(-pow(sdf / (uLen * 0.0016), 2.0));
    transformed += normal * uVent * rim * uLen * 0.0009;
  } else if (part > 5.5 && part < 6.5) {
    // keratin bands of the sonic dome buzz at their free (rear) edge
    float rear = smoothstep(0.0, -1.0, aP.y / max(abs(aP.y) + 0.001, 0.2)) * aP.z;
    transformed += normal * sin(uTime * 71.0 + aMask.w * 9.0) * uVib * rear * uLen * 0.0006;
  }
  #include <skinnormal_vertex>
  vec3 objectTangent = vec4(skinMatrix * vec4(tan0, 0.0)).xyz;
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * objectNormal);
  vTan = normalize(mat3(modelMatrix) * objectTangent);
  vTex = aTex;
  vLoft = aLoft;
  vPart = aPart;
  vP = aP;
  vMask = aMask;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const BODY_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
${SEA}
${WET}
${PLEATS}
uniform vec4 uPleat;
uniform sampler2D uSkinA;
uniform sampler2D uSkinB;
uniform float uBaked;
uniform vec3 uBack;
uniform vec3 uBelly;
uniform vec3 uHornBase;
uniform vec3 uHornTip;
uniform vec3 uPlateCol;
uniform vec3 uCrestIn;
uniform vec3 uMouthColor;
uniform float uLen;
uniform float uThroat;
uniform float uVib;
uniform float uVent;
uniform float uFlush;
uniform float uBlow;
uniform float uWetSelf;
uniform vec4 uCrest;
uniform vec4 uBlowLoc;   // x t, y half-length (t units), z gap (s units), w splay
uniform float uSeed;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vTan;
varying vec2 vTex;
varying vec2 vLoft;
varying float vPart;
varying vec4 vP;
varying vec4 vMask;

vec3 decodeAlbedo(vec3 c) { return c * c; }

void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamPos - vWorldPos);
  float part = vPart;
  vec3 albedo = uBack;
  float rough = 0.42;
  float ao = 1.0;
  float trans = 0.04;
  float rim = 0.5;
  float f0 = 0.028;
  float wrap = 0.2;
  vec3 emis = vec3(0.0);
  float wet = clamp(uWet + uWetSelf + uUnderwater, 0.0, 1.0);

  if (part < 0.5) {
    // ---------------- skin ----------------
    float dorsal = -cos(vLoft.y * 6.2831853);
    if (uBaked > 0.5) {
      vec4 ta = texture2D(uSkinA, vTex);
      vec4 tb = texture2D(uSkinB, vTex);
      albedo = decodeAlbedo(ta.rgb);
      vec2 nxy = tb.xy * 2.0 - 1.0;
      vec3 nT = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
      vec3 T = normalize(vTan - N * dot(vTan, N));
      vec3 Bt = cross(N, T);
      N = normalize(T * nT.x + Bt * nT.y + N * nT.z);
      rough = tb.z;
      ao = tb.w;
    } else {
      float cs = smoothstep(-0.45, 0.25, dorsal + (fbm2(vTex * vec2(40.0, 30.0)) - 0.5) * 0.5);
      albedo = mix(uBelly, uBack, cs);
    }
    // skin under the coat is shaded by it
    albedo *= mix(1.0, 0.82, smoothstep(0.1, 0.6, vMask.x));
    // throat bellows: stretched pleat grooves open into veined, translucent pink tissue
    float bell = vMask.y;
    if (bell > 0.01) {
      float infl = clamp(uThroat, 0.0, 1.5);
      vec3 pl = pleatAt(vLoft.y, vLoft.x, uPleat.z, uPleat.x, uPleat.y);
      // stretched, each groove opens wider and shows the tissue in its floor
      float sb = vLoft.y < 0.5 ? vLoft.y : 1.0 - vLoft.y;
      float px = sb / mix(0.13, 0.235, smoothstep(uPleat.x + 0.02, uPleat.x + 0.26, vLoft.x)) * uPleat.z * 0.5;
      px += sin(vLoft.x * 140.0 + floor(px) * 2.3) * 0.08;
      float fx = fract(px);
      float wv = 0.6 + 0.8 * hash12(vec2(floor(px), 3.1));
      float groove = smoothstep((0.1 + 0.16 * infl) * wv, 0.0, abs(fx - 0.5) - 0.02) * pl.y;
      // the floor of each groove: thin pink-grey tissue with dark veins, deeper red where the
      // stretch is greatest; the ridges keep their own pale skin
      vec3 flesh = mix(vec3(0.62, 0.36, 0.36), vec3(0.42, 0.16, 0.18), smoothstep(0.3, 1.2, infl));
      float vein = smoothstep(0.045, 0.0, abs(vnoise(vTex * vec2(260.0, 70.0) + uSeed) - 0.5));
      float vein2 = smoothstep(0.03, 0.0, abs(vnoise(vTex * vec2(600.0, 160.0)) - 0.5));
      flesh = mix(flesh, vec3(0.28, 0.06, 0.1), vein * 0.55 + vein2 * 0.3);
      flesh *= 0.85 + 0.3 * vnoise(vTex * vec2(90.0, 30.0));
      float open = groove * bell * smoothstep(0.05, 0.9, infl);
      albedo = mix(albedo, flesh, open * 0.7);
      albedo = mix(albedo, albedo * vec3(1.08, 0.86, 0.86), uFlush * bell * 0.6);
      trans += open * 1.2 + bell * infl * 0.25;
      rough = mix(rough, 0.3, open);
    }
    // blowholes: two slits that gape open with each breath
    vec2 bq = vec2((vLoft.x - uBlowLoc.x) / uBlowLoc.y, 0.0);
    float sd = vLoft.y - 0.5;
    float holes = 0.0;
    for (int k = 0; k < 2; k++) {
      float sg = k == 0 ? 1.0 : -1.0;
      // slits converge toward the front
      float off = sg * (uBlowLoc.z + uBlowLoc.w * uBlowLoc.z * (bq.x + 1.0));
      float along = abs(bq.x);
      float wdt = uBlowLoc.z * (0.18 + 0.9 * clamp(uBlow, 0.0, 1.0)) * sqrt(max(0.0, 1.0 - along * along));
      float d = abs(sd - off);
      holes = max(holes, smoothstep(wdt, wdt * 0.4, d) * step(along, 1.0));
    }
    albedo = mix(albedo, vec3(0.03, 0.015, 0.02), holes);
    ao *= 1.0 - holes * 0.6;
    // gape: the lip seam is a dark wet line
    rim = 0.45;
  } else if (part < 1.5 || part > 7.5) {
    // mouth: palate ridges and the tongue
    float k = vP.y;
    albedo = uMouthColor * (part > 7.5 ? 1.1 : 0.8);
    albedo *= 0.85 + 0.15 * sin(vLoft.x * 900.0);
    // the lips' inner margin is dark; the pink only shows deeper in an open mouth
    albedo = mix(vec3(0.05, 0.03, 0.035), albedo, smoothstep(0.0, 0.35, vP.z));
    ao = mix(0.3, 0.8, vP.z);
    rough = 0.25;
    trans = 0.0;
    rim = 0.1;
  } else if (part < 2.5) {
    // baleen: fibrous cream-grey plates with dark fringes
    float fib = 0.5 + 0.5 * sin(vP.x * 160.0 + vnoise(vP.xy * vec2(40.0, 3.0)) * 3.0);
    albedo = mix(vec3(0.62, 0.58, 0.5), vec3(0.18, 0.16, 0.14), smoothstep(0.55, 1.0, vP.y) * 0.8 + fib * 0.2);
    rough = 0.55;
    trans = 0.5;
    rim = 0.2;
  } else if (part < 3.5) {
    // horn: ringed keratin, dark base fading to a pale worn tip, fibres, chips, vents underneath
    float s = vP.x, around = vP.y;
    float rings = 16.0;
    float ph = rings * (1.0 - pow(1.0 - s, 1.35));
    float ring = pow(0.5 + 0.5 * cos(6.2831853 * ph), 3.0);
    float fib = vnoise(vec2(around * 90.0, s * 6.0) + uSeed) * 0.6 + vnoise(vec2(around * 240.0, s * 20.0)) * 0.4;
    float wear = smoothstep(0.55, 0.95, s);
    float hgt = ring * (1.0 - wear) * 0.6 + fib * 0.25;
    // chips: small flakes knocked out of the ridges
    float chipN = vnoise(vec2(around * 11.0, s * 34.0) + uSeed * 3.0) * 0.7 + vnoise(vec2(around * 37.0, s * 90.0)) * 0.3;
    float chip = smoothstep(0.86, 0.9, chipN) * ring * (1.0 - wear * 0.6);
    hgt -= chip * 0.5;
    N = bumpN(N, vWorldPos, hgt * uLen * 0.0012, 1.0);
    vec3 base = uHornBase * (0.85 + 0.3 * fib);
    vec3 tip = uHornTip * (0.88 + 0.18 * fib);
    albedo = mix(base, tip, smoothstep(0.3, 0.98, s + (fib - 0.5) * 0.15));
    albedo *= 0.82 + 0.3 * ring * (1.0 - wear);
    albedo = mix(albedo, mix(albedo, uHornTip, 0.55), chip * 0.6);
    // fine dark cracks running along the fibres
    float crack = smoothstep(0.03, 0.0, abs(vnoise(vec2(around * 14.0, s * 3.0) + 7.0) - 0.5)) * smoothstep(0.1, 0.4, s);
    albedo *= 1.0 - crack * 0.5;
    float sdf = vP.z * uLen;
    float open = smoothstep(uLen * 0.0004, -uLen * 0.0008, sdf - uLen * 0.0016 * uVent);
    float lipRim = exp(-pow(sdf / (uLen * 0.0012), 2.0));
    albedo = mix(albedo, albedo * 0.6, lipRim * 0.4);
    albedo = mix(albedo, mix(vec3(0.12, 0.02, 0.03), vec3(0.42, 0.08, 0.08), uFlush), open);
    ao *= 1.0 - open * 0.5;
    if (vP.w > 0.5) {
      // snapped tip: pale fibrous break, the hollow core dark inside
      float fb = vnoise(vWorldPos.xz * 40.0) * 0.5 + 0.5;
      albedo = vP.w > 1.5 ? vec3(0.015, 0.01, 0.01) : vec3(0.7, 0.64, 0.52) * (0.8 + 0.3 * fb);
      rough = 0.8;
    }
    rough = mix(0.5, 0.28, s) + chip * 0.3;
    f0 = 0.04;
    rim = 0.4;
  } else if (part < 4.5) {
    // dorsal plates: thick slate-like armour with cleavage terraces, cracks and chipped edges
    vec2 q = vP.xy / uLen;
    float seed = floor(vP.w);
    float kind = fract(vP.w) * 4.0;  // 0 top, 1 bevel, 2 foot
    float n1 = fbm2(q * 32.0 + seed * 1.3);
    // terraces: stepped layers of slate
    float terr = floor(n1 * 6.0) / 6.0;
    float stepEdge = smoothstep(0.06, 0.0, abs(fract(n1 * 6.0) - 0.5) - 0.44);
    // big cracks
    float w = worley2(q * 9.0 + seed * 2.1);
    vec2 wc = q * 9.0 + seed * 2.1;
    float crack = smoothstep(0.035, 0.0, abs(w - 0.45 - 0.08 * vnoise(wc * 3.0)) - 0.01) * step(0.45, vnoise(wc * 0.7 + seed));
    float edge = smoothstep(0.82, 1.0, vP.z);
    float hgt = terr * 0.6 + vnoise(q * 220.0) * 0.08 - crack * 0.8;
    N = bumpN(N, vWorldPos, hgt * uLen * 0.0018, 1.0);
    vec3 slate = uPlateCol * (0.8 + 0.3 * terr + 0.08 * fbm2(q * 90.0 + seed));
    // laminations on the bevelled edge, pale streaks and lichen-like crust on top
    float lam = 0.5 + 0.5 * sin(dot(vWorldPos, vec3(0.0, 1.0, 0.0)) / (uLen * 0.0016));
    slate = mix(slate, slate * (0.75 + 0.4 * lam), kind > 0.5 ? 0.8 : 0.0);
    float streak = smoothstep(0.035, 0.0, abs(vnoise(q * vec2(30.0, 90.0) + seed) - 0.5)) * 0.5;
    slate = mix(slate, slate * 1.45 + 0.03, streak * 0.5 + stepEdge * 0.25);
    slate = mix(slate, slate * 1.3 + 0.05, edge * 0.5 * (0.5 + 0.5 * vnoise(q * 200.0)));
    slate *= 1.0 - crack * 0.65;
    albedo = slate;
    ao *= (1.0 - crack * 0.5) * mix(1.0, 0.55, step(1.5, kind)) * mix(1.0, 0.8, step(0.5, kind));
    rough = 0.62 - stepEdge * 0.1;
    rim = 0.35;
  } else if (part > 5.5 && part < 6.5) {
    // keratin bands of the sonic dome: dark, finely ridged, a little glossy
    // keratin scutes of the sonic dome: concentric growth rings like a turtle's, a worn crown
    vec2 q = vP.xy / uLen;
    float rho = vP.z + (vnoise(q * 160.0) - 0.5) * 0.08;
    float grow = (0.5 + 0.5 * sin(rho * 34.0)) * 0.45 + 0.3 * vnoise(vec2(rho * 60.0, 1.0));
    float radial = vnoise(vec2(atan(vP.y, vP.x) * 6.0, rho * 3.0));
    float crown = 1.0 - smoothstep(0.0, 0.45, vP.z);
    N = bumpN(N, vWorldPos, (grow * 0.5 * (1.0 - crown) + radial * 0.2) * uLen * 0.00045, 1.0);
    albedo = mix(uHornBase, uPlateCol, 0.55) * (0.85 + 0.14 * grow * (1.0 - crown) + 0.08 * radial);
    albedo = mix(albedo, mix(uHornTip, uPlateCol, 0.75), crown * 0.18);
    albedo *= 1.0 - smoothstep(0.85, 1.0, vP.z) * 0.25;
    rough = 0.36 + crown * 0.1;
    f0 = 0.04;
    rim = 0.4;
  } else if (part < 5.5) {
    // crest leaves: dark ribbed outside, red-pink flesh lined with sensor pits inside
    float inner = vP.w * smoothstep(1.0, 0.93, vTex.y);
    float rib = vMask.y;
    vec3 outer = uBack * (0.75 + 0.5 * rib) * (0.9 + 0.2 * vnoise(vTex * vec2(60.0, 20.0)));
    // sensor pits in rows between the ribs, each a dark pore with a raised pale rim
    vec2 pq = vec2(vTex.x * 58.0, vTex.y * 11.0 + floor(vTex.x * 58.0) * 0.5);
    vec2 pc = fract(pq) - 0.5;
    float jit = hash12(floor(pq));
    float pr = length(pc * vec2(1.0, 1.25)) + (jit - 0.5) * 0.08;
    float pitSize = mix(0.16, 0.32, smoothstep(0.1, 0.9, vTex.y)) * step(0.15, jit);
    float pit = smoothstep(pitSize, pitSize * 0.55, pr);
    float pitRim = smoothstep(pitSize * 1.7, pitSize * 1.05, pr) * (1.0 - pit);
    // deep maroon at the root, rosy toward the free edge, mottled
    vec3 flesh = mix(uCrestIn * 0.32, uCrestIn * 0.8, smoothstep(0.0, 0.85, vTex.y));
    flesh *= 0.85 + 0.3 * vnoise(vTex * vec2(40.0, 9.0));
    flesh = mix(flesh, vec3(0.08, 0.01, 0.02), pit * 0.9);
    flesh = mix(flesh, flesh * 1.25 + vec3(0.04, 0.025, 0.02), pitRim * 0.6);
    float vein = smoothstep(0.04, 0.0, abs(vnoise(vTex * vec2(24.0, 40.0)) - 0.5));
    flesh = mix(flesh, vec3(0.25, 0.03, 0.07), vein * 0.5);
    flesh = mix(flesh, flesh * vec3(1.2, 0.85, 0.85), uFlush * 0.5);
    float hgt = inner > 0.5 ? (pitRim * 0.5 - pit * 1.0) : rib;
    N = bumpN(N, vWorldPos, hgt * uLen * 0.0007, 1.0);
    // the edge of each leaf is darker, the outer face pale near its base under the fur
    albedo = mix(outer, flesh, inner);
    albedo = mix(albedo, albedo * 0.55, smoothstep(0.85, 1.0, vTex.y) * (1.0 - inner));
    trans = mix(0.45, 0.6, inner);
    rough = mix(0.45, 0.2, inner);
    wet = max(wet, inner * 0.7);
    ao *= mix(1.0, 0.7, pit * inner);
    rim = 0.5;
  } else {
    // spikes: dark keratin with pale worn tips
    float fib = vnoise(vec2(vP.y * 40.0, vP.x * 8.0));
    albedo = mix(uHornBase * (0.85 + 0.3 * fib), uHornTip, smoothstep(0.55, 1.0, vP.x));
    rough = mix(0.5, 0.3, vP.x);
    f0 = 0.04;
  }

  rough = mix(rough, rough * 0.55, wet);
  Surface s = makeSurface(albedo, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.ao = ao * mix(0.72, 1.0, smoothstep(-1.0, 0.3, N.y));
  s.rim = rim * 0.5;
  s.spec = 0.0;
  s.trans = trans;
  s.wrap = wrap;
  vec3 col = stylizedLight(s);
  col += wetSpecular(N, V, vWorldPos, rough, s.shadow, ao, f0) * mix(0.7, 1.0, wet);
  col += emis;
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Fins: wings, rear fins, flukes (one mesh, per-fin dynamics from uniform arrays)
export const FIN_VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${SKIN_PARS}
attribute vec4 aFin;
attribute vec4 aFin2;
attribute vec3 aTan;
uniform float uBillow[6];
uniform float uFlutter[6];
uniform vec3 uFinUp[6];
uniform float uChord[6];
uniform vec4 uTear;      // x torn fin id (-1 none), y amount
uniform float uLen;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vFin;
varying vec4 vFin2;
void main() {
  #include <skinbase_vertex>
  vec3 objectNormal = normal;
  vec3 transformed = position;
  int id = int(aFin.z + 0.5);
  float span = aFin.x, chord = aFin.y, mem = aFin2.w;
  // billow: the membrane bellies out between the rays, lagging the arm on each stroke
  float belly = mem * sin(3.14159 * clamp(span * 1.1, 0.0, 1.0));
  float ph = uTime * 13.0 + span * 9.0 + chord * 4.0;
  float fl = (sin(ph) + 0.35 * sin(ph * 2.3 + 1.7)) * uFlutter[id] * mem * mem * mem;
  // torn wing: the ragged flaps around the split flutter fast and loose
  if (float(id) == uTear.x) {
    float flap = smoothstep(0.35, 1.0, chord) * exp(-pow((span - 0.53) / 0.07, 2.0)) + smoothstep(0.85, 1.0, chord) * 0.3;
    fl += sin(uTime * 31.0 + span * 40.0 + chord * 12.0) * flap * uTear.y * (0.02 + uFlutter[id] * 2.0) * mem;
  }
  // the whole outer wing bends against the stroke (a flexible flipper, stiffest at the root)
  float bend = span * span * (1.0 - chord * 0.3) * float(id < 2);
  transformed += uFinUp[id] * (belly * uBillow[id] + fl + bend * uBillow[id] * 0.35) * uChord[id];
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * objectNormal);
  vFin = aFin;
  vFin2 = aFin2;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const FIN_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
${SEA}
${WET}
uniform vec3 uBack;
uniform vec3 uBelly;
uniform vec3 uMembrane;
uniform vec3 uFinTip;
uniform vec3 uFinMark;
uniform float uFinMarkAmt;
uniform vec4 uTear;
uniform float uSeed;
uniform float uLen;
uniform float uWetSelf;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vFin;
varying vec4 vFin2;

// Holes and a split torn through the membrane (the alpha's wing): ragged, healed edges.
float tearField(vec2 uv, vec2 m) {
  float n = vnoise(m * 2.2) * 0.6 + vnoise(m * 7.0) * 0.4;
  // split from the trailing edge between the 2nd and 3rd rays
  float splitU = 0.535 + 0.025 * sin(uv.y * 9.0) + 0.012 * (n - 0.5);
  float w = mix(0.002, 0.05, smoothstep(0.38, 1.0, uv.y));
  float split = (w - abs(uv.x - splitU)) * step(0.36, uv.y);
  float f = split * 30.0;
  // ragged holes in metres
  vec2 c1 = vec2(0.31, 0.66), c2 = vec2(0.72, 0.58), c3 = vec2(0.62, 0.86), c4 = vec2(0.42, 0.9);
  float hs = uLen * 0.012;
  f = max(f, (1.0 - length((uv - c1) * vec2(1.0, 0.7)) / 0.06) * 3.0 + (n - 0.5) * 2.0);
  f = max(f, (1.0 - length((uv - c2) * vec2(1.0, 0.8)) / 0.045) * 3.0 + (n - 0.5) * 2.0);
  f = max(f, (1.0 - length((uv - c3) * vec2(1.0, 1.4)) / 0.035) * 3.0 + (n - 0.5) * 2.5);
  f = max(f, (1.0 - length((uv - c4) * vec2(1.0, 1.2)) / 0.03) * 3.0 + (n - 0.5) * 2.5);
  return f; // > 0: missing
}

void main() {
  vec2 uv = vFin.xy;
  float mem = vFin2.w;
  float tear = -1.0;
  if (abs(vFin.z - uTear.x) < 0.5 && mem > 0.05) {
    tear = tearField(uv, vFin2.xy);
    if (tear > 0.0) discard;
  }
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamPos - vWorldPos);
  float top = vFin.w;
  float arm = 1.0 - smoothstep(0.05, 0.3, mem);
  float ray = vFin2.z;
  vec2 m = vFin2.xy;               // metres along the span and the chord
  float id = vFin.z;
  float isWing = step(id, 1.5);
  // countershaded skin: dark above, pale below with dark mottles
  float mott = smoothstep(0.42, 0.62, fbm2(m * 0.9 + uSeed + id * 3.0));
  vec3 skinTop = uBack * (0.85 + 0.25 * fbm2(m * 0.5 + uSeed));
  vec3 skinBot = mix(uBelly, uBack * 1.2, mott * 0.55);
  vec3 skin = mix(skinBot, skinTop, top);
  // pale flipper markings (the mother's are bold): big white areas spreading from the leading edge
  float markN = fbm2(m * 0.28 + uSeed * 2.0 + id) + (1.0 - smoothstep(0.0, 0.5, uv.y)) * 0.18 + (1.0 - top) * 0.22;
  // only pale-flippered whales (the mother) carry the white onto the upper side
  float topK = mix(1.0, smoothstep(0.35, 0.75, uFinMarkAmt), top);
  float mark = smoothstep(0.62, 0.67, markN + uFinMarkAmt * 0.3 - 0.12) * topK * smoothstep(0.0, 0.25, uFinMarkAmt);
  skin = mix(skin, uFinMark * (0.92 + 0.12 * fbm2(m * 3.0)), mark);
  // leading-edge tubercles: worn pale knobs, wrinkled skin across the arm
  float tubU = (uv.x - 0.14) / 0.8;
  float tub = isWing * pow(max(0.0, sin(3.14159 * 9.0 * clamp(tubU, 0.0, 1.0))), 1.6) * step(0.0, tubU) * step(tubU, 1.0) * (1.0 - smoothstep(0.03, 0.12, uv.y));
  skin = mix(skin, skin * 1.25 + 0.02, tub * 0.4);
  float wr = sin(m.x / (uLen * 0.0045) + vnoise(m * 2.0) * 3.0) * arm;
  float hgt = wr * 0.3 + tub * 1.0 + ray * 0.4;
  // membrane: thin dark skin with veins following the rays, lighter toward the trailing edge
  // the membrane is thin dorsal skin: the back's colour, a little warmer and lighter toward the edge
  vec3 memBase = mix(uBack * 1.15, uMembrane, 0.32);
  vec3 memCol = mix(memBase, mix(memBase, uFinTip, 0.6), smoothstep(0.45, 1.0, uv.y) * 0.8 + 0.2 * fbm2(m * 0.7));
  memCol = mix(memCol, mix(uBelly, memBase, 0.6), (1.0 - top) * 0.35);
  float veinN = vnoise(vec2(m.x * 3.0, m.y * 0.6) + uSeed);
  float vein = smoothstep(0.06, 0.0, abs(veinN - 0.5)) * mem;
  memCol *= 1.0 - vein * 0.25;
  hgt += vein * 0.25;
  vec3 albedo = mix(memCol, skin, max(arm, ray * 0.85));
  // healed scar tissue around the tears
  if (tear > -0.6) albedo = mix(albedo, uBack * 0.55 + vec3(0.1, 0.07, 0.07), smoothstep(-0.6, 0.0, tear) * 0.85);
  N = bumpN(N, vWorldPos, hgt * uLen * 0.0006, 1.0);
  float wet = clamp(uWet + uWetSelf + uUnderwater, 0.0, 1.0);
  Surface s = makeSurface(albedo, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.rim = 0.4;
  s.spec = 0.0;
  // thin membrane glows warm when backlit; the arm and rays stay dark against the sun
  s.trans = mix(0.42, 0.05, max(arm, ray * 0.75));
  s.wrap = 0.26;
  s.ao = mix(1.0, 0.85, arm);
  vec3 col = stylizedLight(s);
  col += wetSpecular(N, V, vWorldPos, mix(mix(0.4, 0.5, mem), 0.25, wet), s.shadow, 1.0, 0.028);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Eyes: small, dark and wet. A sphere sunk in its socket; lids, gaze and pupil are painted in
// socket space so they can take any expression. The lids show the baked skin around the socket
// (uSkinJ maps socket angles to skin uv), so wrinkles and the eye patch run onto them.
export const EYE_VERT = /* glsl */ `
${UNIFORMS}
uniform vec3 uGaze;
uniform vec3 uSkinNL;  // the skin's normal at the socket, in socket space
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vViewL;   // view direction in socket space
varying vec3 vGazeW;   // gaze in world space
varying vec3 vSkinN;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLocal = normalize(position);
  mat3 R = mat3(modelMatrix);
  vec3 V = normalize(uCamPos - wp.xyz);
  vViewL = normalize(V * R);
  vGazeW = normalize(R * uGaze);
  vSkinN = normalize(R * uSkinNL);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const EYE_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
${SEA}
${WET}
uniform vec3 uGaze;       // socket space unit vector
uniform vec4 uLids;       // x upper lid elevation, y lower lid elevation, z upper curve, w lower curve
uniform float uPupil;     // pupil radius (radians)
uniform float uIrisR;     // iris radius (radians)
uniform vec3 uIris;
uniform vec3 uIris2;
uniform vec3 uLidCol;
uniform vec3 uSclera;
uniform float uSide;
uniform float uSparkle;
uniform sampler2D uSkinA;
uniform float uBaked;
uniform vec4 uSkinUV;     // xy: skin uv of the eye centre
uniform vec4 uSkinJ;      // ds/daz, ds/del, dv/daz, dv/del (skin uv per radian of socket angle)
uniform float uWetSelf;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vViewL;
varying vec3 vGazeW;
varying vec3 vSkinN;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 n = normalize(vLocal);
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  float az = atan(n.x, n.z);
  float el = asin(clamp(n.y, -1.0, 1.0));
  // lids: an almond opening; the margins are thick and slightly rolled
  float up = uLids.x + uLids.z * az * az;
  float lo = uLids.y + uLids.w * az * az;
  float aa = 0.02 + fwidth(el) * 1.5;
  float upperLid = smoothstep(up - aa, up + aa, el);
  float lowerLid = smoothstep(lo + aa, lo - aa, el);
  float lidMask = clamp(upperLid + lowerLid, 0.0, 1.0);
  // ---- the eyeball ----
  vec3 g = normalize(uGaze);
  // refraction parallax: the iris lies under the corneal bulge
  vec3 Vl = normalize(vViewL);
  vec3 ni = normalize(n - Vl * 0.08 * smoothstep(uIrisR * 1.3, 0.0, acos(clamp(dot(n, g), -1.0, 1.0))));
  float ang = acos(clamp(dot(ni, g), -1.0, 1.0));
  vec3 tx = normalize(cross(vec3(0.0, 1.0, 0.0), g) + 1e-4);
  vec3 ty = cross(g, tx);
  vec2 ip = vec2(dot(ni, tx), dot(ni, ty));
  float rad = atan(ip.y, ip.x);
  float rn = ang / uIrisR;                     // 0 centre .. 1 iris edge
  // golden-amber iris: radial fibres, crypts, a dark limbal ring, a darker collarette
  float fib = vnoise(vec2(rad * 18.0, rn * 4.0)) * 0.6 + vnoise(vec2(rad * 46.0, rn * 9.0)) * 0.4;
  float crypt = smoothstep(0.55, 0.75, vnoise(vec2(rad * 7.0, rn * 6.0) + 3.0)) * smoothstep(0.25, 0.5, rn) * (1.0 - smoothstep(0.75, 0.9, rn));
  vec3 iris = mix(uIris * 0.9, uIris2, smoothstep(0.25, 1.0, rn) * 0.9);
  iris *= 0.6 + 0.55 * fib;
  iris = mix(iris, uIris2 * 0.6, crypt * 0.5);
  iris = mix(iris, uIris2 * 0.35, smoothstep(0.28, 0.36, rn) * smoothstep(0.44, 0.36, rn) * 0.5);
  iris = mix(iris, uIris2 * 0.15, smoothstep(0.82, 1.0, rn));
  // horizontal kidney-shaped pupil with a soft notch above (cetacean)
  vec2 pp = ip / max(uPupil, 1e-3);
  pp.x *= 0.52;
  pp.y += 0.22 * smoothstep(0.6, 0.0, abs(pp.x)) * step(0.0, pp.y);
  float pupil = smoothstep(1.06, 0.94, length(pp));
  // the sclera: dark brown-grey, a little paler toward the inner corner; veins
  vec3 sclera = uSclera * (0.75 + 0.25 * vnoise(vec2(az, el) * 12.0));
  float veins = smoothstep(0.05, 0.0, abs(vnoise(vec2(az * 9.0, el * 14.0)) - 0.5)) * 0.4;
  sclera = mix(sclera, vec3(0.5, 0.2, 0.2) * uSclera, veins);
  float irisM = smoothstep(uIrisR + 0.03, uIrisR - 0.03, ang);
  vec3 ball = mix(sclera, iris, irisM);
  ball = mix(ball, vec3(0.008, 0.006, 0.006), pupil * irisM);
  // conjunctiva: wet pink toward the lid margins
  float nearLid = smoothstep(0.16, 0.0, min(up - el, el - lo));
  ball = mix(ball, mix(ball, vec3(0.45, 0.16, 0.16), 0.6), nearLid * (1.0 - irisM) * 0.7);
  // the upper lid shades the eye
  ball *= mix(1.0, 0.4, smoothstep(up - 0.35, up, el));
  ball *= mix(1.0, 0.75, smoothstep(lo + 0.15, lo, el));
  // ---- lids: the socket's own skin ----
  vec3 lid = uLidCol;
  if (uBaked > 0.5) {
    vec2 suv = uSkinUV.xy + vec2(uSkinJ.x * az + uSkinJ.y * el, uSkinJ.z * az + uSkinJ.w * el);
    vec3 sk = texture2D(uSkinA, suv).rgb;
    lid = sk * sk;
  }
  // folds parallel to each margin, darker in the creases
  float du = el - up, dl = lo - el;
  float foldU = sin(du * 38.0) * exp(-du * 4.0) * step(0.0, du);
  float foldL = sin(dl * 34.0) * exp(-dl * 5.0) * step(0.0, dl);
  float fold = (foldU + foldL);
  lid *= 0.9 + 0.18 * fold;
  // rolled margin: dark wet rim with a bright tear meniscus on the lower lid
  float margin = smoothstep(0.07, 0.0, abs(du)) * upperLid + smoothstep(0.06, 0.0, abs(dl)) * lowerLid;
  lid = mix(lid, vec3(0.06, 0.04, 0.045), margin * 0.75);
  // ---- lighting ----
  float wet = clamp(uWet + uWetSelf + uUnderwater, 0.0, 1.0);
  vec3 Ns = normalize(vSkinN);
  vec3 Nlid = normalize(mix(Ns, N, 0.25) + (N - Ns * dot(N, Ns)) * fold * 0.3);
  Surface s = makeSurface(lid, Nlid, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.rim = 0.35; s.wrap = 0.22; s.spec = 0.0;
  vec3 lidLit = stylizedLight(s) + wetSpecular(Nlid, V, vWorldPos, mix(0.45, 0.32, wet), s.shadow, 0.8, 0.028);
  // the eyeball: diffuse is soft (the cornea scatters), reflections are sharp
  Surface e = makeSurface(ball, N, vWorldPos);
  e.shadow = s.shadow;
  e.rim = 0.0; e.wrap = 0.35; e.spec = 0.0;
  vec3 eyeLit = stylizedLight(e) * 0.85;
  // corneal bulge: highlights sit on a more curved surface over the iris
  vec3 Nc = normalize(N + normalize(vGazeW) * 0.35 * irisM);
  // the wet cornea mirrors the sky: the dominant cue that the eye is alive and wet
  eyeLit = eyeLit * 0.8 + wetSpecular(Nc, V, vWorldPos, 0.03, s.shadow, 1.0, 0.045) * 1.6;
  // a small catchlight from the sky so the eye reads alive even in shade
  vec3 R = reflect(-V, Nc);
  eyeLit += uSkyAmbient * 0.25 * smoothstep(0.85, 0.97, R.y) * uSparkle;
  vec3 col = mix(eyeLit, lidLit, lidMask);
  float meniscus = smoothstep(0.025, 0.0, abs(el - lo - 0.015)) * (1.0 - lowerLid) * (1.0 - upperLid);
  col += meniscus * (skyEnv(R, 0.0) * 0.35 + uSunColor * 0.05) * s.shadow;
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Hair lighting (Kajiya-Kay with a shifted, coloured second lobe) on top of the shared diffuse.
export const HAIR = /* glsl */ `
vec3 hairLight(vec3 albedo, vec3 T, vec3 N, vec3 V, vec3 P, float shadow, float ao, float h, float trans) {
  Surface s = makeSurface(albedo, N, P);
  s.shadow = shadow;
  s.ao = ao;
  s.rim = 0.06 * h;
  s.spec = 0.0;
  s.trans = trans;
  s.wrap = 0.34;
  vec3 col = stylizedLight(s);
  // rim light through the hair tips, tinted by the hair (glows against the sun, never frosty)
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  float back = pow(max(dot(-V, uSunDir), 0.0), 2.0);
  col += albedo * (uSunColor * (0.15 + 1.1 * back) * shadow + uSkyAmbient * 0.35) * fres * h * 0.55;
  vec3 L = uSunDir;
  vec3 H = normalize(L + V);
  vec3 T1 = normalize(T + N * 0.12);
  vec3 T2 = normalize(T - N * 0.18);
  float th1 = dot(T1, H), th2 = dot(T2, H);
  float s1 = pow(sqrt(max(0.0, 1.0 - th1 * th1)), 90.0);
  float s2 = pow(sqrt(max(0.0, 1.0 - th2 * th2)), 22.0);
  float nl = smoothstep(-0.1, 0.4, dot(N, L));
  col += uSunColor * (s1 * 0.12 + s2 * 0.1 * albedo * 3.0) * nl * shadow * mix(0.6, 1.0, h);
  return col;
}
`;

export const FUR_VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${SKIN_PARS}
attribute vec2 aTex;
attribute vec2 aLoft;
attribute vec4 aFur;      // x length factor, y 0 body / 1 fin, zw metric coords (m)
attribute vec3 aComb;
uniform float uShellH[${32}];
uniform float uFurLen;
uniform float uLen;
uniform vec3 uInertia;
uniform vec3 uAirflow;
uniform vec4 uJiggle;     // xyz world impulse direction * amount, w phase
uniform sampler2D uSkinA;
uniform float uBaked;
uniform vec3 uBack;
uniform vec3 uBelly;
uniform float uFurShade;
uniform float uFurTip;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vComb;
varying vec2 vUv;
varying float vH;
varying float vLen;
varying vec3 vAlb;
varying float vShadow;
void main() {
  float h = uShellH[gl_InstanceID];
  #include <skinbase_vertex>
  vec3 objectNormal = normal;
  #include <skinnormal_vertex>
  vec3 combS = vec4(skinMatrix * vec4(aComb, 0.0)).xyz;
  float len = uFurLen * aFur.x * (1.0 - uWet * 0.5);
  vec3 transformed = position + normal * (h * len) + aComb * (h * h) * len * 0.85;
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vec3 N = normalize(mat3(modelMatrix) * objectNormal);
  // wind, flight inertia, a bump's ripple and gravity bend the coat; never into the skin
  float flutter = 0.7 + 0.3 * sin(uTime * 7.0 + dot(wp.xyz, vec3(1.3, 2.1, 0.9)));
  float gust = 0.8 + 0.4 * sin(uTime * 2.3 + dot(wp.xyz, vec3(0.21, 0.13, 0.17))) + uGust;
  vec3 disp = uAirflow * 0.016 * flutter * gust - uInertia + vec3(0.0, -0.22, 0.0);
  disp += uJiggle.xyz * sin(uJiggle.w + dot(wp.xyz, vec3(0.7, 0.5, 0.9)) / uLen * 9.0);
  disp *= 1.0 - uWet * 0.6;
  disp -= N * min(dot(disp, N), 0.0);
  wp.xyz += disp * h * h * len * 1.25;
  vWorldPos = wp.xyz;
  vNormal = N;
  vComb = normalize(mat3(modelMatrix) * combS + disp * 0.6 + N * 0.2);
  vUv = aFur.zw;
  vH = h;
  vLen = aFur.x;
  vec3 alb = mix(uBelly, uBack, 0.5);
  if (uBaked > 0.5) { vec3 c = textureLod(uSkinA, aTex, 4.0).rgb; alb = c * c; }
  vAlb = alb;
  vShadow = sampleShadow(wp.xyz, N);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const FUR_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
${HAIR}
uniform float uFurDensity;
uniform float uFurTip;
uniform float uFurShade;
uniform float uSeed;
uniform float uCurl;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vComb;
varying vec2 vUv;
varying float vH;
varying float vLen;
varying vec3 vAlb;
varying float vShadow;
void main() {
  if (vLen < 0.03) discard;
  float h = vH;
  vec2 fuv = vUv * uFurDensity;
  // clumping: strands lean toward their tuft's centre as they grow
  vec2 cuv = fuv * 0.22;
  vec2 ci = floor(cuv);
  vec2 cc = (ci + hash22(ci + 3.7) * 0.6 + 0.2) / 0.22;
  fuv = mix(fuv, cc, h * h * 0.62);
  // curl: the strand tips wander in small circles
  float cph = hash12(floor(fuv) + 1.3) * 6.28;
  fuv += vec2(cos(h * 9.0 + cph), sin(h * 9.0 + cph)) * uCurl * h * 0.35;
  vec2 cell = floor(fuv);
  vec2 f = fract(fuv);
  float rnd = hash12(cell + uSeed);
  vec2 c = hash22(cell + 7.0) * 0.6 + 0.2;
  float d = length(f - c);
  float clumpLen = 0.75 + 0.35 * vnoise(cuv * 1.7 + uSeed);
  float strandLen = mix(0.5, 1.0, rnd) * clumpLen * smoothstep(0.02, 0.35, vLen);
  if (h > strandLen) discard;
  float hr = h / strandLen;
  float radius = mix(0.62, 0.16, pow(hr, 1.25));
  float cov = smoothstep(radius, radius * 0.4, d + (vnoise(f * 6.0 + cell) - 0.5) * 0.12);
  // dense undercoat close to the skin hides it
  cov = max(cov, smoothstep(0.32, 0.0, h) * smoothstep(0.03, 0.25, vLen));
  if (cov < 0.3) discard;
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 albedo = vAlb * mix(uFurShade, 1.0, smoothstep(0.0, 0.7, h));
  // lighter, slightly warmer tips
  albedo = mix(albedo, albedo * uFurTip + vec3(0.025, 0.02, 0.012), smoothstep(0.55, 1.0, hr));
  albedo *= 0.88 + 0.24 * rnd;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 T = normalize(vComb);
  // depth: light reaches the inner coat poorly (self-shadowing of the fur)
  float depthAO = mix(0.45, 1.0, smoothstep(0.0, 0.9, h));
  vec3 col = hairLight(albedo, T, N, V, vWorldPos, vShadow * mix(0.6, 1.0, h), depthAO, h, 0.9 * hr);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, cov);
}
`;

// Locks: camera-facing ribbons of strands rooted in the skin.
export const LOCK_VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${SKIN_PARS}
attribute vec4 aRoot;     // bind root xyz, length
attribute vec3 aNrm;
attribute vec3 aDir;
attribute vec4 aShape;    // width, lift, droop, curl + 10 * seed
attribute vec4 aLockTex;  // skin uv, mane flag, random
uniform vec3 uInertia;
uniform vec3 uAirflow;
uniform vec4 uJiggle;
uniform float uLen;
uniform sampler2D uSkinA;
uniform float uBaked;
uniform vec3 uBack;
uniform vec3 uBelly;
uniform float uLockGrow;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vTan;
varying vec2 vCard;
varying vec3 vAlb;
varying float vSeed;
varying float vShadow;
void main() {
  float a = position.y, side = position.x;
  float len = aRoot.w * (1.0 - uWet * 0.3) * uLockGrow;
  vec3 n = aNrm, d = aDir;
  vec3 b = normalize(cross(n, d));
  float lift = aShape.y, droop = aShape.z;
  float curl = mod(aShape.w, 10.0);
  float seed = floor(aShape.w / 10.0) * 0.1;
  // centreline: rises off the skin, flows along the comb, a loose helix (curl)
  float ph = a * 6.2831853 * (0.5 + curl * 1.4) + seed;
  vec3 p = aRoot.xyz - n * len * 0.04;
  p += len * (n * lift * a * (1.0 - 0.6 * a) + d * a * (1.0 - 0.15 * a));
  p += (b * sin(ph) + n * (cos(ph) - 1.0) * 0.4) * curl * len * 0.16 * a;
  vec3 tan = n * lift * (1.0 - 1.2 * a) + d * (1.0 - 0.3 * a) + (b * cos(ph) - n * sin(ph) * 0.4) * curl * 0.16 * 6.2831853 * (0.5 + curl * 1.4) * a;
  vec3 transformed = p;
  #include <skinbase_vertex>
  vec3 objectNormal = n;
  #include <skinnormal_vertex>
  vec3 tanS = vec4(skinMatrix * vec4(tan, 0.0)).xyz;
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vec3 N = normalize(mat3(modelMatrix) * objectNormal);
  vec3 T = normalize(mat3(modelMatrix) * tanS);
  // gravity, wind, inertia and a bump's ripple swing the lock from its root
  float flutter = 0.65 + 0.35 * sin(uTime * (5.0 + seed * 3.0) + a * 3.0 + seed * 20.0);
  float gust = 0.75 + 0.45 * sin(uTime * 1.9 + dot(wp.xyz, vec3(0.17, 0.11, 0.19))) + uGust;
  vec3 disp = vec3(0.0, -1.0, 0.0) * droop * 0.45 + uAirflow * 0.014 * flutter * gust - uInertia * 1.3;
  disp += uJiggle.xyz * 1.5 * sin(uJiggle.w + seed * 4.0);
  disp *= 1.0 - uWet * 0.5;
  disp -= N * min(dot(disp, N), 0.0) * 0.8;
  wp.xyz += disp * len * a * a;
  T = normalize(T + disp * 2.0 * a);
  // face the camera around the strand axis
  vec3 V = normalize(uCamPos - wp.xyz);
  vec3 W = normalize(cross(T, V) + 1e-5);
  float wid = aShape.x * uLockGrow * (1.0 - pow(a, 1.5) * 0.7) * (0.45 + 0.55 * smoothstep(0.0, 0.12, a));
  wp.xyz += W * side * wid;
  vWorldPos = wp.xyz;
  vNormal = normalize(mix(N, -V, 0.3));
  vTan = T;
  vCard = vec2(side, a);
  vec3 alb = mix(uBelly, uBack, 0.6);
  if (uBaked > 0.5) { vec3 c = textureLod(uSkinA, aLockTex.xy, 4.0).rgb; alb = c * c; }
  vAlb = alb;
  vSeed = aLockTex.w;
  vShadow = sampleShadow(wp.xyz, N);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const LOCK_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
${HAIR}
uniform float uFurTip;
uniform float uFurShade;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vTan;
varying vec2 vCard;
varying vec3 vAlb;
varying float vSeed;
varying float vShadow;
void main() {
  float a = vCard.y, x = vCard.x;
  // a lock is a loose bundle of strands: they gather at the root, splay and thin toward the tip,
  // each with its own length and wave; some are missing, so light passes between them
  float N = 7.0 + floor(vSeed * 6.0);
  float spread = mix(0.5, 1.0, sqrt(a));
  float xs = clamp(x / spread * 0.5 + 0.5, 0.0, 1.0);
  float fi = xs * N;
  float sid = floor(fi);
  float hs = hash12(vec2(sid, vSeed * 91.0));
  float wave = sin(a * (5.0 + hs * 7.0) + hs * 6.28) * 0.22 * a;
  float d = abs(fract(fi) - 0.5 - wave);
  float sLen = mix(0.55, 1.0, hs);
  float wdt = mix(0.48, 0.16, clamp(a / sLen, 0.0, 1.0));
  float cov = smoothstep(wdt, wdt * 0.35, d) * smoothstep(sLen, sLen - 0.08, a);
  cov *= step(0.18, hash12(vec2(sid * 1.7, vSeed * 13.0)));
  cov = max(cov, smoothstep(0.22, 0.0, a) * 0.85);
  cov *= smoothstep(1.0, 0.8, abs(x) / spread);
  if (cov < 0.3) discard;
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 albedo = vAlb * mix(uFurShade, 1.0, smoothstep(0.0, 0.5, a));
  albedo = mix(albedo, albedo * uFurTip + vec3(0.03, 0.024, 0.015), smoothstep(0.45, 1.0, a));
  albedo *= 0.85 + 0.3 * hs;
  vec3 Nn = normalize(vNormal);
  if (!gl_FrontFacing) Nn = -Nn;
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 col = hairLight(albedo, normalize(vTan), Nn, V, vWorldPos, vShadow, mix(0.6, 1.0, a), a, 1.1 * a);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, cov);
}
`;

// ---------------------------------------------------------------------------------------------
// Barbels (sensor whips) under the mouth. The centreline is evaluated in world space so gravity,
// the relative wind and inertia act in the world; the tube is rebuilt around it per vertex.
export const BARBEL_VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
attribute vec4 aB;       // index, along 0..1, angle, radius
attribute vec4 aRoot;    // root in the jaw frame, length
attribute vec3 aDir;
uniform vec3 uInertia;
uniform vec3 uAirflow;
uniform float uWhip;     // extra activity (excitement, feeding)
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vA;
vec3 centre(float a, float len, vec3 rootW, vec3 dirW, float idx) {
  // rest curve: out along the rest direction, curling back under gravity
  vec3 p = rootW + dirW * len * a;
  float a2 = a * a;
  vec3 g = vec3(0.0, -1.0, 0.0) * 0.35 + uAirflow * 0.03 - uInertia * 1.4;
  p += g * len * a2;
  // slow travelling wave, faster when excited
  float ph = uTime * (1.6 + uWhip * 3.0) - a * 5.0 + idx * 1.7;
  vec3 side = normalize(cross(dirW, vec3(0.0, 1.0, 0.0)) + 1e-4);
  p += (side * sin(ph) + vec3(0.0, 1.0, 0.0) * cos(ph * 0.8) * 0.5) * len * 0.07 * a2 * (1.0 + uWhip);
  return p;
}
void main() {
  float a = aB.y, ang = aB.z, rad = aB.w, len = aRoot.w;
  vec3 rootW = (modelMatrix * vec4(aRoot.xyz, 1.0)).xyz;
  vec3 dirW = normalize(mat3(modelMatrix) * aDir);
  vec3 c0 = centre(a, len, rootW, dirW, aB.x);
  vec3 c1 = centre(min(a + 0.03, 1.0), len, rootW, dirW, aB.x);
  vec3 cm = centre(max(a - 0.03, 0.0), len, rootW, dirW, aB.x);
  vec3 T = normalize(c1 - cm);
  vec3 Nn = normalize(cross(T, vec3(0.31, 0.92, 0.23)));
  vec3 Bn = cross(T, Nn);
  vec3 off = Nn * cos(ang) + Bn * sin(ang);
  vec3 wp = c0 + off * rad;
  vWorldPos = wp;
  vNormal = off;
  vA = a;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const BARBEL_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
${SEA}
${WET}
uniform vec3 uBack;
uniform vec3 uBelly;
uniform float uWetSelf;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vA;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  // dark at the root, paler and more translucent toward the sensitive tip; fine rings
  vec3 albedo = mix(uBack * 0.9, mix(uBelly, vec3(0.75, 0.55, 0.55), 0.35), smoothstep(0.2, 1.0, vA));
  albedo *= 0.9 + 0.1 * sin(vA * 140.0);
  float wet = clamp(uWet + uWetSelf + uUnderwater, 0.0, 1.0);
  Surface s = makeSurface(albedo, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.rim = 0.4; s.spec = 0.0; s.trans = 0.4 + vA * 0.8; s.wrap = 0.3;
  vec3 col = stylizedLight(s) + wetSpecular(N, V, vWorldPos, mix(0.35, 0.22, wet), s.shadow, 1.0, 0.028);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

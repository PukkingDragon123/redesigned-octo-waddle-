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
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2) * k;
  // cap the tilt (about 45 degrees): a step in h across one pixel quad (a terrace riser, a crack
  // edge, a grazing view) would otherwise flip the normal and speckle the surface with dark pixels
  grad -= N * dot(grad, N);
  float gl = length(grad), lim = abs(det);
  grad *= gl > lim ? lim / gl : 1.0;
  vec3 r = abs(det) * N - grad;
  return dot(r, r) > 1e-30 ? normalize(r) : N;
}
`;

// ---- shadow lookup for big curved bodies ------------------------------------------------------
// The shared sampler filters with a wide Poisson kernel rotated per world cell. The lookup follows
// the true surface (a bumped normal would scatter the offset per pixel) and is pushed out by a
// fraction of the kernel's footprint in metres, so the domed armour never self-shadows in grain.
const WSHADOW = /* glsl */ `
float bodyShadow(vec3 P, vec3 Ng) {
  float uvPerM = length(vec3(uShadowMatrix[0].x, uShadowMatrix[1].x, uShadowMatrix[2].x));
  float kM = min(4.0 * uShadowParams.x / max(uvPerM, 1e-6), 1.5);
  return sampleShadow(P + Ng * kM * 0.3, Ng);
}
`;

// ---- painterly finish ---------------------------------------------------------------------
// Layered over the world's light (stylizedLight, so fog, night and the sea still apply): the
// terminator breaks into brush strokes that follow the body's flow, the light is blocked into
// a few broad soft values, shade turns cool (sky hue) instead of grey, the lit side warm, the
// turning edge gets a little extra chroma, and a thin hand-drawn ink line darkens the
// silhouette and the creases. q: stroke-space coordinates, x along the flow.
export const PAINT = /* glsl */ `
float pLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float brush(vec2 q) {
  vec2 w = vec2(q.x * 0.16, q.y);
  w.y += (vnoise(w * vec2(0.6, 0.25)) - 0.5) * 1.6;   // strokes wander along their length
  float a = vnoise(w + vec2(0.0, 0.5 * vnoise(w * 0.3)));
  float b = vnoise(w * vec2(1.7, 2.2) + 5.2);
  return a * 0.62 + b * 0.38;
}
// col: lit colour (stylizedLight + specular); Ng: geometric normal (the ink follows the form, not
// the bump); st: brush value 0..1; ink: crease ink 0..1; k: strength; lineK: silhouette ink.
vec3 paintFinish(vec3 col, vec3 N, vec3 Ng, vec3 V, float shadow, float st, float ink, float k, float lineK) {
  float day = 1.0 - uNight * 0.7;
  float NdL = dot(N, uSunDir);
  float l = smoothstep(-0.18, 0.5, NdL + (st - 0.5) * 0.5) * mix(0.25, 1.0, shadow);
  // soft value blocking: three broad bands with soft edges
  float f = l * 2.0;
  float q = (floor(f) + smoothstep(0.3, 0.7, fract(f))) * 0.5;
  col *= mix(1.0, (0.45 + 0.55 * q) / (0.45 + 0.55 * l), 0.75 * k);
  // shade turns toward the sky's hue, light toward the sun's
  vec3 sky = clamp(uSkyAmbient / max(pLum(uSkyAmbient), 1e-3), 0.0, 2.0);
  vec3 cool = mix(vec3(1.0), sky * vec3(0.94, 0.95, 1.08), 0.4);
  col *= mix(vec3(1.0), cool, (1.0 - l) * 0.5 * k * day);
  col *= mix(vec3(1.0), vec3(1.08, 1.0, 0.88), l * 0.5 * k * day * smoothstep(-0.05, 0.3, uSunDir.y));
  // painters push chroma where the form turns
  float term = l * (1.0 - l) * 4.0;
  float lum = pLum(col);
  col = max(vec3(0.0), mix(vec3(lum), col, 1.0 + (0.2 * term - 0.06) * k));
  col *= 1.0 + vec3(0.05, 0.0, -0.04) * term * k * day;
  // broken colour: each stroke a touch lighter or darker, warmer or cooler
  col *= 1.0 + (st - 0.5) * 0.32 * k;
  col *= 1.0 + vec3(0.035, 0.0, -0.035) * (fract(st * 7.13) - 0.5) * 2.0 * k;
  // hand-drawn ink: thin at the silhouette (about two pixels, wavering with the stroke), and the
  // creases the caller marks; tinted dark indigo, never black
  float nv = abs(dot(Ng, V));
  // the line swells and thins with the brush value along the stroke and wavers a little, so the
  // contour reads as a pen line drawn by hand (never a uniform ruled outline)
  float w = (fwidth(nv) * 1.8 + 0.035) * (0.5 + 1.0 * st);
  float line = 1.0 - smoothstep(w * 0.5, w * 1.5, nv + (st - 0.5) * 0.08);
  float inkA = clamp(line * lineK * 0.8 + ink, 0.0, 1.0) * k;
  col = mix(col, col * vec3(0.26, 0.24, 0.34), inkA * 0.75);
  return col;
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
${WSHADOW}
${PAINT}
${PLEATS}
uniform vec4 uPleat;
uniform float uDbg;      // dev scene debug views (0 off)
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
  vec3 Ng = N;
  vec3 V = normalize(uCamPos - vWorldPos);
  float part = vPart;
  float creaseInk = 0.0;
  float paintK = 1.0;
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
      px += pleatWob(sb, vLoft.x);
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
    creaseInk += holes * 0.5;
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
    creaseInk += crack * 0.35 + ring * 0.12 * (1.0 - wear);
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
    // skin sleeve over the flared root: folded hide creeping up the horn, its edge wavering
    float sleeveEdge = 0.055 + 0.018 * (vnoise(vec2(around * 9.0, 2.0) + uSeed) - 0.5) * 2.0;
    float sleeve = 1.0 - smoothstep(sleeveEdge - 0.012, sleeveEdge + 0.004, s);
    float sfold = sin(s * 260.0 + vnoise(vec2(around * 30.0, s * 40.0)) * 3.0);
    albedo = mix(albedo, uBack * (0.72 + 0.12 * sfold), sleeve);
    rough = mix(rough, 0.45, sleeve);
    creaseInk += smoothstep(0.012, 0.0, abs(s - sleeveEdge)) * 0.4;
    f0 = 0.04;
    rim = 0.4;
  } else if (part < 4.5) {
    // dorsal plates: thick slate-like armour with cleavage terraces, cracks and chipped edges.
    // Every octave fades out before it gets smaller than a couple of pixels (no speckle at a
    // distance), and every edge is antialiased by its own screen-space width.
    vec2 q = vP.xy / uLen;
    float pxq = max(length(fwidth(q)), 1e-6);           // plate units per pixel
    #define PFADE(F) (1.0 - smoothstep(0.12, 0.45, (F) * pxq))
    // vP.w = plate seed (an integer) + ring kind * 0.25. The interpolated value can land a hair
    // below the integer (36.99999 for 37): a plain floor() then flips the seed and reads the
    // fraction as "foot" on random pixels, the source of the dark speckle on the plates
    float seed = floor(vP.w + 0.1);
    float kind = max(vP.w - seed, 0.0) * 4.0;  // 0 top, 1 bevel, 2 foot
    // hand-drawn warp so the terraces and cracks never run ruler-straight
    vec2 qw = q + (vec2(vnoise(q * 14.0 + seed), vnoise(q * 14.0 + seed + 5.1)) - 0.5) * 0.035;
    float n1 = fbm2(qw * 32.0 + seed * 1.3);
    // terraces: soft stepped layers of slate (smoothed risers instead of hard floor() steps)
    float tf = n1 * 6.0;
    float tw = clamp(fwidth(tf) * 1.5, 0.08, 0.5);
    float terr = (floor(tf) + smoothstep(0.5 - tw, 0.5 + tw, fract(tf))) / 6.0;
    float stepEdge = (1.0 - smoothstep(0.0, 0.06 + tw, abs(fract(tf) - 0.5))) * PFADE(32.0 * 6.0 * 0.35);
    // big cracks: wavering, swelling and thinning, broken into strokes
    vec2 wc = qw * 9.0 + seed * 2.1;
    float w = worley2(wc);
    float cw = 0.012 + 0.04 * vnoise(wc * 2.1 + 4.0);
    float cd = abs(w - 0.45 - 0.08 * vnoise(wc * 3.0) - 0.03 * vnoise(wc * 11.0) * PFADE(99.0)) - 0.01;
    float caa = fwidth(w) * 1.2;
    float crack = smoothstep(cw + caa, -caa * 0.5, cd) * smoothstep(0.38, 0.52, vnoise(wc * 0.7 + seed));
    crack *= mix(0.55, 1.0, PFADE(9.0 * 3.0));            // far away a crack is a soft dark seam
    float edge = smoothstep(0.82, 1.0, vP.z);
    float grit = vnoise(q * 220.0) * PFADE(220.0);
    float hgt = terr * 0.6 + grit * 0.08 - crack * 0.8;
    N = bumpN(N, vWorldPos, hgt * uLen * 0.0018, PFADE(40.0) * 0.8 + 0.2);
    vec3 slate = uPlateCol * (0.8 + 0.3 * terr + 0.08 * (fbm2(q * 90.0 + seed) - 0.5) * PFADE(90.0) + 0.04);
    // broad lichen-dark / weathered-pale blotches so a plate never reads flat from far away
    float blotch = fbm2(q * 7.0 + seed * 0.7);
    slate *= 0.86 + 0.28 * blotch;
    // laminations on the bevelled edge, pale streaks and a worn crust on top
    // (stacked down the bevel in the plate's own frame, wavering like hand-drawn layers)
    float lam = 0.5 + 0.5 * sin(kind * 19.0 + (fbm2(q * 60.0 + seed) - 0.5) * 3.2 + (vnoise(q * 320.0 + seed) - 0.5) * 0.9 * PFADE(320.0));
    slate = mix(slate, slate * (0.75 + 0.4 * lam), kind > 0.5 ? 0.8 : 0.0);
    float sn = vnoise(q * vec2(30.0, 90.0) + seed);
    float saa = fwidth(sn);
    float streak = smoothstep(0.035 + saa, 0.0, abs(sn - 0.5)) * 0.5 * PFADE(90.0);
    slate = mix(slate, slate * 1.4 + 0.025, streak * 0.5 + stepEdge * 0.14);
    // a worn, slightly paler lip (kept low: bright rims on every plate read as a rib cage)
    slate = mix(slate, slate * 1.18 + 0.02, edge * 0.3 * (0.5 + 0.5 * mix(0.5, vnoise(q * 200.0), PFADE(200.0))));
    slate *= 1.0 - crack * 0.65;
    albedo = slate;
    creaseInk += crack * 0.4 + stepEdge * 0.1 + step(1.5, kind) * 0.12;
    ao *= (1.0 - crack * 0.45) * mix(1.0, 0.72, step(1.5, kind)) * mix(1.0, 0.88, step(0.5, kind));
    rough = 0.62 - stepEdge * 0.1;
    rim = 0.35;
    #undef PFADE
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
  // the shadow lookup follows the true surface (a bumped normal would scatter the offset and
  // speckle the soft penumbra), pushed a little further out on big bodies against acne
  s.shadow = bodyShadow(vWorldPos, Ng);
  if (uDbg > 0.5) {
    // 1 shadow, 2 bumped normal, 3 albedo, 4 ao, 5 crease ink
    vec3 dv = uDbg < 1.5 ? vec3(s.shadow) : uDbg < 2.5 ? N * 0.5 + 0.5 : uDbg < 3.5 ? albedo : uDbg < 4.5 ? vec3(ao) : vec3(creaseInk);
    gl_FragColor = vec4(dv, 1.0);
    return;
  }
  s.ao = ao * mix(0.72, 1.0, smoothstep(-1.0, 0.3, N.y));
  s.spec = 0.0;
  s.trans = trans;
  s.wrap = wrap;
  s.rim = rim * 0.9;
  vec3 col = stylizedLight(s);
  // a soft painted sheen rather than a plastic coat: broad, gentle, brighter when wet
  // (dry skin keeps only a faint satin; the glossy coat is for a whale fresh from the sea)
  vec3 spec = wetSpecular(N, V, vWorldPos, max(rough, mix(0.4, 0.3, wet)), s.shadow, ao, f0);
  col += min(spec, vec3(1.2)) * mix(0.2, 0.8, wet);
  col += emis;
  // brush strokes run along the body (t) and wrap around it, mirrored at the midlines
  float sb = vLoft.y < 0.5 ? vLoft.y : 1.0 - vLoft.y;
  float st = brush(vec2(vLoft.x * uLen, sb * uLen * 1.1) / (uLen * 0.017) + uSeed * 7.0);
  creaseInk += smoothstep(0.78, 0.3, ao) * 0.45;
  col = paintFinish(col, N, Ng, V, s.shadow, st, creaseInk, paintK, 1.0);
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
  // the soft trailing edge lags the stroke more than the leading-edge arm (a living membrane)
  float trail = chord * chord * smoothstep(0.1, 0.6, span) * float(id < 2);
  transformed += uFinUp[id] * (belly * uBillow[id] + fl + (bend * 0.55 + trail * 0.3) * uBillow[id]) * uChord[id];
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
${WSHADOW}
${PAINT}
uniform vec3 uBack;
uniform vec3 uBelly;
uniform vec3 uMembrane;
uniform vec3 uFinTip;
uniform vec3 uFinMark;
uniform float uFinMarkAmt;
uniform float uFinBarn;   // barnacle load on the leading edges and fluke tips (old whales)
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
  vec3 Ng = N;
  vec3 V = normalize(uCamPos - vWorldPos);
  float top = vFin.w;
  float arm = 1.0 - smoothstep(0.05, 0.3, mem);
  vec2 m = vFin2.xy;               // metres along the span and the chord
  // the finger rays are drawn by hand: each swells and thins along its length and its edges waver
  float ray = clamp(vFin2.z * (0.75 + 0.5 * vnoise(vec2(m.x * 1.1, m.y * 0.35) + vFin.z * 7.0)) + (vnoise(m * 2.6 + 5.0) - 0.5) * 0.2 * vFin2.z, 0.0, 1.0);
  float id = vFin.z;
  float isWing = step(id, 1.5);
  // countershaded skin: dark above, pale below with dark mottles
  float mott = smoothstep(0.42, 0.62, fbm2(m * 0.9 + uSeed + id * 3.0));
  vec3 skinTop = uBack * (0.85 + 0.25 * fbm2(m * 0.5 + uSeed));
  vec3 skinBot = mix(uBelly, uBack * 1.2, mott * 0.55);
  vec3 skin = mix(skinBot, skinTop, top);
  // pale flipper markings (the mother's are bold): big white areas spreading from the leading edge
  float markN = fbm2(m * 0.28 + uSeed * 2.0 + id) + (1.0 - smoothstep(0.0, 0.5, uv.y)) * 0.18 + (1.0 - top) * 0.22;
  // only pale-flippered whales (the mother) carry a little white onto the upper side, and only
  // near the leading edge: from above a wing reads as the back's own dark skin
  float topK = mix(1.0, smoothstep(0.35, 0.75, uFinMarkAmt) * 0.45 * (1.0 - smoothstep(0.08, 0.3, uv.y)), top);
  float mark = smoothstep(0.62, 0.67, markN + uFinMarkAmt * 0.3 - 0.12) * topK * smoothstep(0.0, 0.25, uFinMarkAmt);
  skin = mix(skin, uFinMark * (0.92 + 0.12 * fbm2(m * 3.0)), mark);
  // leading-edge tubercles: worn pale knobs, wrinkled skin across the arm
  float tubU = (uv.x - 0.14) / 0.8;
  float tub = isWing * pow(max(0.0, sin(3.14159 * 9.0 * clamp(tubU, 0.0, 1.0))), 1.6) * step(0.0, tubU) * step(tubU, 1.0) * (1.0 - smoothstep(0.03, 0.12, uv.y));
  skin = mix(skin, skin * 1.25 + 0.02, tub * 0.4);
  float wr = sin(m.x / (uLen * 0.0045) + vnoise(m * 2.0) * 3.0) * arm;
  float hgt = wr * 0.3 + tub * 1.0 + ray * 0.4;
  // barnacle clusters on the knobs of the leading edge and the fluke tips (humpback-like),
  // pale volcano shells with dark openings, crowded where the edge meets the water first
  float barn = 0.0;
  float pxM = length(fwidth(m));   // metres per pixel (outside the branch: derivatives stay defined)
  float zone = (1.0 - smoothstep(0.04, 0.2, uv.y)) * smoothstep(0.1, 0.25, uv.x) * mix(0.6, 1.0, tub);
  zone = max(zone, step(3.5, id) * smoothstep(0.55, 0.85, uv.x) * (1.0 - smoothstep(0.1, 0.35, uv.y))) * uFinBarn;
  if (zone > 0.01) {
    zone *= smoothstep(0.35, 0.6, fbm2(m * 0.6 + uSeed * 1.3));
    float cellM = uLen * 0.0042;
    vec2 cp = m / cellM;
    vec2 ci = floor(cp), cf = fract(cp);
    float best = 9.0, bsz = 1.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash22(ci + g + id * 13.0) * 0.7 + 0.15;
      float sz = 0.5 + 0.5 * hash12(ci + g + 7.7);
      float dd = length(g + o - cf) / (0.48 * sz);
      if (hash12(ci + g + 3.1) < zone * 1.3 && dd < best) { best = dd; bsz = sz; }
    }
    float aaB = pxM / (cellM * 0.48 * bsz) + 1e-4;
    barn = 1.0 - smoothstep(1.0 - aaB, 1.0 + aaB, best);
    float open = 1.0 - smoothstep(0.24, 0.34 + aaB, best);
    vec3 shell = mix(vec3(0.8, 0.78, 0.72), vec3(0.6, 0.6, 0.55), bsz) * (0.85 + 0.15 * (1.0 - best));
    shell = mix(shell, vec3(0.05, 0.045, 0.04), open);
    skin = mix(skin, shell, barn * 0.95);
    hgt += barn * (1.0 - best) * 2.2 - open * 0.8;
  }
  // membrane: thin living skin that follows the body's countershading: the back's own dark,
  // mottled colour on top (a touch warmer and lighter where it thins toward the trailing edge),
  // a paler slate below; never a flat pale sheet
  vec3 memTop = mix(uBack * 1.08, uMembrane, 0.22) * (0.88 + 0.24 * fbm2(m * 0.45 + uSeed));
  memTop = mix(memTop, mix(memTop * vec3(1.22, 1.12, 1.1), uFinTip, 0.18), smoothstep(0.5, 1.0, uv.y) * (0.45 + 0.2 * fbm2(m * 0.7)));
  vec3 memBot = mix(mix(uBelly, uBack, 0.4), uBack * 1.1, mott * 0.5);
  vec3 memCol = mix(memBot, memTop, top);
  float veinN = vnoise(vec2(m.x * 3.0, m.y * 0.6) + uSeed);
  float vein = smoothstep(0.06, 0.0, abs(veinN - 0.5)) * mem;
  memCol *= 1.0 - vein * 0.25;
  hgt += vein * 0.25;
  // painted membrane: between the finger rays the skin thins, warmer and lighter toward the
  // trailing edge, with soft streaks fanning out along the rays
  float between = mem * (1.0 - ray);
  float stM = brush(vec2(m.x, m.y * 2.0) / (uLen * 0.012) + uSeed * 5.0 + id * 11.0);
  memCol = mix(memCol, memCol * vec3(1.1, 1.03, 1.0) + vec3(0.012, 0.006, 0.008), between * smoothstep(0.25, 1.0, uv.y) * (0.45 + 0.4 * stM));
  memCol *= 0.94 + 0.12 * stM;
  // the finger rays read as gentle ridges of the arm's skin running out through the membrane
  vec3 albedo = mix(memCol, skin, max(max(arm, ray * 0.6), barn));
  float finInk = smoothstep(0.45, 0.95, ray) * mem * 0.16 + tub * 0.18 * (1.0 - tub) * 4.0 * 0.3;
  // the trailing edge: only a faint hem (the membrane thins out, it is not cut from paper)
  finInk += smoothstep(0.93, 1.0, uv.y) * mem * 0.1;
  // healed scar tissue around the tears
  if (tear > -0.6) albedo = mix(albedo, uBack * 0.55 + vec3(0.1, 0.07, 0.07), smoothstep(-0.6, 0.0, tear) * 0.85);
  N = bumpN(N, vWorldPos, hgt * uLen * 0.0006, 1.0);
  float wet = clamp(uWet + uWetSelf + uUnderwater, 0.0, 1.0);
  Surface s = makeSurface(albedo, N, vWorldPos);
  // the shadow lookup follows the true surface (a bumped normal would scatter the offset and
  // speckle the soft penumbra), pushed a little further out on big bodies against acne
  s.shadow = bodyShadow(vWorldPos, Ng);
  s.rim = 0.3;
  s.spec = 0.0;
  // thin membrane glows warm when backlit; the arm and rays stay dark against the sun
  s.trans = mix(0.55, 0.05, max(arm, ray * 0.75));
  s.wrap = 0.3;
  s.ao = mix(1.0, 0.85, arm);
  vec3 col = stylizedLight(s);
  // light through the membrane from the sky side (soft, even when not straight backlit)
  float through = max(dot(-N, uSunDir), 0.0) * between;
  col += albedo * uSunColor * vec3(1.0, 0.72, 0.62) * through * 0.3 * s.shadow;
  // soft against the sky: the thin membrane takes a little of the sky's colour through it
  col = mix(col, col * 0.75 + uSkyAmbient * albedo * 0.9, between * (1.0 - top) * 0.25);
  vec3 spec = wetSpecular(N, V, vWorldPos, max(mix(mix(0.5, 0.6, mem), 0.25, wet), 0.4), s.shadow, 1.0, 0.028);
  col += min(spec, vec3(1.2)) * mix(0.16, 0.7, wet);
  float stF = brush(vec2(m.x, m.y * 1.5) / (uLen * 0.016) + uSeed * 3.0 + id * 7.0);
  col = paintFinish(col, N, Ng, V, s.shadow, mix(stF, stM, 0.4), finInk, 1.0, 1.0);
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
  // golden-amber iris: a bright sunburst of radial fibres around the pupil, crypts, a wavering
  // darker collarette, gold flecks, concentric contraction furrows and a dark limbal ring
  // (wrapped angle so the pattern has no seam)
  vec2 rc = vec2(cos(rad), sin(rad));
  float fib = vnoise(rc * 3.0 + vec2(rn * 4.0, 0.0)) * 0.35 + vnoise(rc * 8.0 + vec2(0.0, rn * 9.0)) * 0.4 + vnoise(rc * 19.0 + rn * 3.0) * 0.25;
  float crypt = smoothstep(0.58, 0.78, vnoise(rc * 3.5 + rn * 6.0 + 3.0)) * smoothstep(0.25, 0.5, rn) * (1.0 - smoothstep(0.75, 0.9, rn));
  vec3 iris = mix(uIris * 1.15 + vec3(0.06, 0.04, 0.0), uIris * 0.8, smoothstep(0.2, 0.55, rn));
  iris = mix(iris, mix(uIris, uIris2, 0.55), smoothstep(0.55, 1.0, rn) * 0.8);
  iris *= 0.62 + 0.55 * fib;
  iris = mix(iris, uIris2 * 0.6, crypt * 0.5);
  float coll = 0.38 + 0.05 * (vnoise(rc * 4.0 + 11.0) - 0.5) * 2.0;
  iris = mix(iris, uIris2 * 0.35, smoothstep(0.07, 0.0, abs(rn - coll)) * 0.55);
  float furrow = smoothstep(0.8, 1.0, sin(rn * 31.0 + vnoise(rc * 5.0) * 2.0)) * smoothstep(0.55, 0.7, rn);
  iris *= 1.0 - furrow * 0.25;
  float fleck = smoothstep(0.82, 0.92, vnoise(rc * 12.0 + rn * 14.0 + uSide * 7.0)) * smoothstep(0.3, 0.5, rn) * (1.0 - smoothstep(0.8, 0.9, rn));
  iris = mix(iris, vec3(1.0, 0.78, 0.32) * 1.2, fleck * 0.6);
  iris = mix(iris, uIris2 * 0.12, smoothstep(0.8, 1.0, rn));
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
  // painted glints: a crisp key glint where the sun (or the brightest sky above) would sit on the
  // wet cornea, and a soft secondary one opposite, so a small eye always reads wet and alive
  vec3 kDir = normalize(mix(vec3(0.0, 1.0, 0.0), uSunDir, 0.65) + V * 0.6);
  float g1 = smoothstep(0.986, 0.996, dot(Nc, kDir));
  vec3 kDir2 = normalize(V * 1.4 - kDir * 0.5);
  float g2 = smoothstep(0.975, 0.99, dot(Nc, kDir2)) * 0.35;
  float lidCover = 1.0 - smoothstep(up - 0.18, up - 0.02, el);   // the lid's shade hides it
  eyeLit += (uSunColor * 0.6 + uSkyAmbient * 1.2 + 0.25) * (g1 + g2) * (0.55 + 0.45 * uSparkle) * lidCover * mix(0.5, 1.0, s.shadow) * (1.0 - uNight * 0.6);
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
  float s1 = pow(sqrt(max(0.0, 1.0 - th1 * th1)), 40.0);
  float s2 = pow(sqrt(max(0.0, 1.0 - th2 * th2)), 14.0);
  float nl = smoothstep(-0.1, 0.4, dot(N, L));
  col += uSunColor * (s1 * 0.05 + s2 * 0.12 * albedo * 3.0) * nl * shadow * mix(0.6, 1.0, h);
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
uniform float uWetSelf;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vComb;
varying vec2 vUv;
varying float vH;
varying float vLen;
varying vec3 vAlb;
varying float vShadow;
varying float vReg;
varying float vWet;
void main() {
  float h = uShellH[gl_InstanceID];
  #include <skinbase_vertex>
  vec3 objectNormal = normal;
  #include <skinnormal_vertex>
  vec3 combS = vec4(skinMatrix * vec4(aComb, 0.0)).xyz;
  // a wet coat (rain, or fresh from the sea) is shorter, slicked flat along the comb
  float wetF = clamp(uWet + uWetSelf, 0.0, 1.0);
  vWet = wetF;
  float len = uFurLen * aFur.x * (1.0 - wetF * 0.45);
  vec3 transformed = position + normal * (h * len) * (1.0 - wetF * 0.35) + aComb * (h * h) * len * (0.85 + wetF * 0.5);
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vec3 N = normalize(mat3(modelMatrix) * objectNormal);
  // wind, flight inertia, a bump's ripple and gravity bend the coat; never into the skin
  float flutter = 0.7 + 0.3 * sin(uTime * 7.0 + dot(wp.xyz, vec3(1.3, 2.1, 0.9)));
  float gust = 0.8 + 0.4 * sin(uTime * 2.3 + dot(wp.xyz, vec3(0.21, 0.13, 0.17))) + uGust;
  vec3 disp = uAirflow * 0.016 * flutter * gust - uInertia + vec3(0.0, -0.22, 0.0);
  disp += uJiggle.xyz * sin(uJiggle.w + dot(wp.xyz, vec3(0.7, 0.5, 0.9)) / uLen * 9.0);
  disp *= 1.0 - wetF * 0.6;
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
  // the coat follows the skin pattern but leans to the dorsal colour, so it stays rich in tone
  alb = mix(alb, uBack, 0.3);
  // fin tufts take the fin's own upper colour (the baked skin is the body's)
  if (aFur.y > 0.5) alb = uBack * 1.2 + 0.01;
  vAlb = alb;
  vReg = aFur.y;
  vShadow = sampleShadow(wp.xyz, N);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const FUR_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
${HAIR}
${PAINT}
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
varying float vReg;
varying float vWet;
void main() {
  if (vLen < 0.03) discard;
  float h = vH;
  vec2 fuv = vUv * uFurDensity;
  // far away the clumps shrink to a few pixels: they melt into an even coat that covers by
  // height alone, so the fur never shimmers or sparkles at distance
  float calm = smoothstep(0.22, 0.6, length(fwidth(fuv * 0.2)));
  // locks: each strand belongs to the nearest of a loose lattice of clumps; with height the
  // strands gather toward their lock's axis, so every lock is a soft cone drawn to a point
  vec2 cuv = fuv * 0.2;
  vec2 base = floor(cuv - 0.5);
  float bd = 9.0, crnd = 0.0;
  vec2 cc = vec2(0.0);
  for (int k = 0; k < 4; k++) {
    vec2 ck = base + vec2(mod(float(k), 2.0), floor(float(k) * 0.5));
    vec2 cp = ck + 0.15 + 0.7 * hash22(ck + 3.7);
    float dd = length(cuv - cp);
    if (dd < bd) { bd = dd; cc = cp; crnd = hash12(ck + 11.0 + uSeed); }
  }
  float lockLen = mix(mix(0.62, 1.0, crnd), 0.72, calm) * smoothstep(0.02, 0.35, vLen);
  if (h > lockLen) discard;
  float hr = h / lockLen;
  // curl: the lock's tip wanders in a small circle
  float cph = crnd * 6.28;
  vec2 tipOff = vec2(cos(hr * 5.0 + cph), sin(hr * 5.0 + cph)) * uCurl * hr * hr * 0.18;
  // locks stream back with the comb (toward the tail on the body, the trailing edge on fins)
  // and are drawn out along it into soft teardrops
  float lean = vReg > 0.5 ? 1.0 : -1.0;
  vec2 off = cuv - cc - tipOff - vec2(0.0, lean) * pow(hr, 1.4) * 0.55;
  off.y *= 0.62;
  float r0 = length(off);
  // the lock's radius (clump units): full at the root, drawing to a point at the tip
  float lockR = (0.72 * pow(max(0.0, 1.0 - hr), 0.7) + 0.04) * (1.0 - vWet * 0.3);   // wet locks clump
  // fine strands break the lock's edge: fibres drawn along the comb (stretched noise), so the
  // edge frays into soft hairs instead of blocky cells
  vec2 fq = fuv * vec2(3.2, 0.55) + vec2(cph * 3.0, 0.0);
  float sr = vnoise(fq);
  float edgeN = (sr - 0.5) * 0.3 + (vnoise(fuv * vec2(7.0, 1.1) + cph) - 0.5) * 0.14;
  float cov = smoothstep(lockR, lockR * 0.72, r0 + edgeN * (0.4 + hr));
  // dense undercoat close to the skin hides it
  cov = max(cov, smoothstep(0.3, 0.0, h) * smoothstep(0.03, 0.25, vLen));
  cov = mix(cov, 1.0, calm);
  if (cov < 0.18) discard;
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 T = normalize(vComb);
  // each lock is shaded as a rounded volume: its surface turns away from the lock's axis
  float dome = sqrt(max(0.0, 1.0 - min(r0 / max(lockR, 1e-3), 1.0)));
  vec2 od = r0 > 1e-4 ? off / r0 : vec2(0.0);
  vec3 B = normalize(cross(N, T));
  vec3 Nl = normalize(N * (0.7 + 0.5 * dome) + (B * od.x + T * od.y * 0.5) * (1.0 - dome) * 0.4);
  vec3 albedo = vAlb * mix(uFurShade, 1.0, smoothstep(0.0, 0.75, h));
  // lighter, warmer tips; each lock its own value
  albedo = mix(albedo, albedo * uFurTip + vec3(0.018, 0.014, 0.008), smoothstep(0.5, 1.0, hr));
  albedo *= 0.9 + 0.2 * crnd + (sr - 0.5) * 0.06;
  // depth: light reaches the inner coat poorly (self-shadowing of the fur)
  float depthAO = mix(0.55, 1.0, smoothstep(0.0, 0.8, h)) * mix(0.9, 1.0, dome);
  albedo *= mix(1.0, 0.6, vWet);   // wet hair darkens
  vec3 col = hairLight(albedo, T, Nl, V, vWorldPos, vShadow * mix(0.65, 1.0, h), depthAO, h, 0.9 * hr);
  // wet: a glossy sheen runs along each slicked lock
  vec3 Hh = normalize(uSunDir + V);
  float tH = dot(T, Hh);
  col += uSunColor * pow(sqrt(max(0.0, 1.0 - tH * tH)), 90.0) * 0.35 * vWet * vShadow;
  col = paintFinish(col, Nl, N, V, vShadow, crnd * 0.6 + sr * 0.15 + 0.12, 0.0, 0.7, 0.0);
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
uniform float uWetSelf;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vTan;
varying vec2 vCard;
varying vec3 vAlb;
varying float vSeed;
varying float vShadow;
varying float vWet;
void main() {
  float a = position.y, side = position.x;
  // wet locks (rain, or fresh from the sea) cling: shorter, flatter, heavier, thinner
  float wetF = clamp(uWet + uWetSelf, 0.0, 1.0);
  vWet = wetF;
  float len = aRoot.w * (1.0 - wetF * 0.3) * uLockGrow;
  vec3 n = aNrm, d = aDir;
  vec3 b = normalize(cross(n, d));
  float lift = aShape.y * (1.0 - wetF * 0.6), droop = aShape.z + wetF * 0.4;
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
  disp *= 1.0 - wetF * 0.5;
  disp -= N * min(dot(disp, N), 0.0) * 0.8;
  wp.xyz += disp * len * a * a;
  T = normalize(T + disp * 2.0 * a);
  // face the camera around the strand axis
  vec3 V = normalize(uCamPos - wp.xyz);
  vec3 W = normalize(cross(T, V) + 1e-5);
  float wid = aShape.x * uLockGrow * (1.0 - pow(a, 1.5) * 0.7) * (0.45 + 0.55 * smoothstep(0.0, 0.12, a)) * (1.0 - wetF * 0.4);
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
${PAINT}
uniform float uFurTip;
uniform float uFurShade;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vTan;
varying vec2 vCard;
varying vec3 vAlb;
varying float vSeed;
varying float vShadow;
varying float vWet;
void main() {
  float a = vCard.y, x = vCard.x;
  // a card only a few pixels wide draws as one soft tuft (the strands would only sparkle)
  float far = smoothstep(0.25, 0.7, fwidth(x));
  // a lock is a loose bundle of strands: they gather at the root, splay and thin toward the tip,
  // each with its own length and wave; some are missing, so light passes between them
  float N = 4.0 + floor(vSeed * 3.0);
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
  // the lock's body: one soft tapering tuft; only its tip splits into strands
  float hw = 0.95 * pow(max(0.0, 1.0 - smoothstep(0.3, 0.95, a)), 0.8);
  cov = max(cov, smoothstep(hw, hw * 0.7, abs(x)) * (0.75 + 0.25 * smoothstep(0.0, 0.2, a)));
  cov *= smoothstep(1.0, 0.85, abs(x) / spread);
  cov = mix(cov, smoothstep(1.0, 0.55, abs(x) / spread) * smoothstep(1.0, 0.75, a), far);
  if (cov < 0.18) discard;
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 albedo = vAlb * mix(uFurShade, 1.0, smoothstep(0.0, 0.5, a));
  albedo = mix(albedo, albedo * uFurTip + vec3(0.03, 0.024, 0.015), smoothstep(0.45, 1.0, a));
  // rounded across the lock, each strand a touch apart
  float rnd = sqrt(max(0.0, 1.0 - x * x));
  albedo *= (0.78 + 0.3 * rnd) * (0.94 + 0.12 * hs) * (0.9 + 0.2 * vSeed);
  vec3 Nn = normalize(vNormal);
  if (!gl_FrontFacing) Nn = -Nn;
  vec3 V = normalize(uCamPos - vWorldPos);
  albedo *= mix(1.0, 0.6, vWet);
  vec3 col = hairLight(albedo, normalize(vTan), Nn, V, vWorldPos, vShadow, mix(0.6, 1.0, a) * mix(0.85, 1.0, rnd), a, 1.1 * a);
  vec3 Hh = normalize(uSunDir + V);
  float tH = dot(normalize(vTan), Hh);
  col += uSunColor * pow(sqrt(max(0.0, 1.0 - tH * tH)), 90.0) * 0.35 * vWet * vShadow;
  col = paintFinish(col, Nn, Nn, V, vShadow, vSeed * 0.5 + hs * 0.3 + 0.1, 0.0, 0.7, 0.0);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, cov);
}
`;

// ---------------------------------------------------------------------------------------------
// Barbels (sensor whips) under the mouth. The centreline is integrated in world space as a
// flexible rod: each step keeps its length, turns toward the load (gravity, the relative wind,
// inertia) more freely toward the tip, curls about the whip's own axis and carries a slow
// travelling sway, so the whips drape in soft curves even when nothing moves.
export const BARBEL_VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
attribute vec4 aB;       // index, along 0..1, angle, radius
attribute vec4 aRoot;    // root in the jaw frame, length
attribute vec3 aDir;
uniform vec3 uInertia;
uniform vec3 uAirflow;
uniform float uWhip;     // extra activity (excitement, feeding)
uniform float uWetSelf;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vA;
#define WSTEPS 14
// position and tangent of the whip at a (0 root .. 1 tip)
vec3 whip(float a, float len, vec3 rootW, vec3 dirW, float idx, out vec3 T) {
  float hk = hash11(idx * 3.17 + 0.5);
  vec3 load = vec3(0.0, -1.0, 0.0) + uAirflow * 0.035 - uInertia * 1.6;
  float lw = length(load);
  load = lw > 1e-4 ? load / lw : vec3(0.0, -1.0, 0.0);
  float lk = min(lw, 2.5);
  // the whip's own curl: about an axis across it, so the tip hooks back and in like a whisker
  vec3 sideW = normalize(cross(dirW, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
  vec3 curlAx = normalize(sideW + vec3(0.0, 0.35 * (hk - 0.5), 0.0));
  float curl = (1.1 + 1.0 * hk) * (hk > 0.5 ? 1.0 : -0.8) * (1.0 - uWetSelf * 0.2);
  float ph0 = uTime * (0.9 + 0.35 * hk + uWhip * 3.0) + idx * 1.7;
  float amp = (0.35 + uWhip * 1.2) * (1.0 + 0.4 * sin(uTime * 0.37 + idx));
  vec3 p = rootW;
  vec3 d = dirW;
  float n = a * float(WSTEPS);
  float stepL = len / float(WSTEPS);
  for (int i = 0; i < WSTEPS; i++) {
    float fi = float(i);
    if (fi >= n) break;
    float st = min(1.0, n - fi);
    float u = (fi + 0.5) / float(WSTEPS);
    // limp toward the tip: turns toward the load (wet whips hang heavier)
    // springy, like a cat's whisker: it holds its curve and only the tip gives to the load
    float flex = mix(0.008, 0.1, u * u) * lk * (1.0 + uWetSelf * 0.5);
    d = normalize(d + (load - d * dot(load, d)) * flex * st);
    // natural curvature, strongest in the outer half
    d = normalize(d + cross(curlAx, d) * curl * smoothstep(0.25, 1.0, u) / float(WSTEPS) * 2.0 * st);
    // slow travelling sway (side to side and up and down), growing toward the tip
    float ph = ph0 - u * 5.5;
    vec3 sw = sideW * sin(ph) + vec3(0.0, 1.0, 0.0) * cos(ph * 0.8 + hk * 3.0) * 0.6;
    d = normalize(d + (sw - d * dot(sw, d)) * amp * u * 0.16 * st);
    p += d * stepL * st;
  }
  T = d;
  return p;
}
void main() {
  float a = aB.y, ang = aB.z, rad = aB.w, len = aRoot.w;
  vec3 rootW = (modelMatrix * vec4(aRoot.xyz, 1.0)).xyz;
  vec3 dirW = normalize(mat3(modelMatrix) * aDir);
  vec3 T;
  vec3 c0 = whip(a, len, rootW, dirW, aB.x, T);
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
  vec3 albedo = mix(uBack * 0.85, mix(uBelly, vec3(0.78, 0.52, 0.52), 0.45), smoothstep(0.12, 0.95, vA));
  // soft annular rings (wavering, never ruled) and a dark fleshy collar at the root
  float ringPh = vA * 120.0 + sin(vA * 23.0) * 1.4;
  albedo *= 0.88 + 0.12 * smoothstep(-0.3, 0.6, sin(ringPh));
  albedo = mix(albedo, uBack * 0.5, smoothstep(0.08, 0.0, vA) * 0.7);
  float wet = clamp(uWet + uWetSelf + uUnderwater, 0.0, 1.0);
  Surface s = makeSurface(albedo, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.rim = 0.4; s.spec = 0.0; s.trans = 0.4 + vA * 0.8; s.wrap = 0.3;
  vec3 col = stylizedLight(s) + wetSpecular(N, V, vWorldPos, mix(0.35, 0.22, wet), s.shadow, 1.0, 0.028);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

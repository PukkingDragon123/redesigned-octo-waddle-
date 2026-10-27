// Shaders for the skywhale: skin, shell fur, membrane fins, expressive eyes, gill fronds.
// All are skinned against one shared skeleton and lit with the stylized light model.
import { UNIFORMS, NOISE, SHADOW, LIGHTING } from '../render/shaders/common.js';

// ---------------------------------------------------------------------------------------
// Shared colour/pattern logic (body and fur must agree exactly).
export const WHALE_COMMON = /* glsl */ `
uniform vec3 uBack;
uniform vec3 uBelly;
uniform vec3 uMark;
uniform vec3 uMark2;
uniform vec4 uPattern;   // x spots, y stripes, z eye crescent, w dorsal blaze
uniform vec4 uEyeLoc;    // x eye t, y eye ring-param (right), z mark radius (t units)
uniform float uSeed;
uniform float uGarden;
uniform float uLen;
uniform vec3 uBlush;
uniform float uBlushAmt;

vec3 whaleAlbedo(vec2 loft, vec2 uvw, out float dorsal) {
  float t = loft.x;
  float s = loft.y;
  dorsal = -cos(s * 6.2831853);
  float n1 = fbm2(uvw * 0.45 + uSeed);
  float n2 = vnoise(uvw * 1.9 + uSeed * 3.0);
  float cs = smoothstep(-0.5, 0.2, dorsal + (n1 - 0.5) * 0.55 + 0.07 * sin(t * 42.0 + uSeed));
  vec3 col = mix(uBelly, uBack, cs);
  col *= 0.93 + 0.14 * n1;
  if (uPattern.y > 0.0) {
    float band = sin(t * 30.0 + n2 * 2.2 + abs(dorsal) * 1.6 + uSeed);
    float m = smoothstep(0.5, 0.82, band)
      * smoothstep(-0.7, -0.05, dorsal) * smoothstep(0.9, 0.35, dorsal)
      * smoothstep(0.1, 0.28, t) * smoothstep(0.82, 0.66, t);
    col = mix(col, uMark, m * uPattern.y);
  }
  if (uPattern.x > 0.0) {
    float w = worley2(uvw * 2.1 + uSeed * 1.3);
    float spot = smoothstep(0.34, 0.2, w) * smoothstep(0.05, 0.55, dorsal)
      * smoothstep(0.06, 0.22, t) * smoothstep(0.86, 0.68, t);
    col = mix(col, uMark2, spot * uPattern.x);
  }
  if (uPattern.z > 0.0) {
    // pale crescent cupping each eye from below: lets the calf recognise its mother anywhere
    float dEye = -cos(uEyeLoc.y * 6.2831853);
    for (int k = 0; k < 2; k++) {
      float es = k == 0 ? uEyeLoc.y : 1.0 - uEyeLoc.y;
      vec2 d = vec2((t - uEyeLoc.x) / uEyeLoc.z, (s - es) / (uEyeLoc.z * 1.3));
      float r = length(d);
      float cres = smoothstep(1.85, 1.5, r) * smoothstep(1.0, 1.3, r) * smoothstep(0.05, -0.25, dorsal - dEye);
      col = mix(col, uMark2, cres * uPattern.z);
    }
  }
  if (uPattern.w > 0.0) {
    float blaze = smoothstep(0.86, 0.97, dorsal + (n2 - 0.5) * 0.12) * smoothstep(0.2, 0.45, t) * smoothstep(0.95, 0.8, t);
    col = mix(col, uMark2, blaze * uPattern.w);
  }
  if (uBlushAmt > 0.0) {
    // soft cheek blush under each eye (calves)
    for (int k = 0; k < 2; k++) {
      float es = k == 0 ? uEyeLoc.y : 1.0 - uEyeLoc.y;
      float sd = (k == 0 ? -1.0 : 1.0) * 0.06;
      vec2 d = vec2((t - (uEyeLoc.x - 0.035)) / 0.045, (s - (es + sd)) / 0.05);
      col = mix(col, uBlush, smoothstep(1.0, 0.0, length(d)) * uBlushAmt);
    }
  }
  if (uGarden > 0.0) {
    float g = smoothstep(0.55, 0.8, dorsal + (fbm2(uvw * 0.8) - 0.5) * 0.5) * smoothstep(0.2, 0.32, t) * smoothstep(0.78, 0.62, t);
    vec3 moss = mix(vec3(0.32, 0.45, 0.22), vec3(0.55, 0.62, 0.3), fbm2(uvw * 3.0));
    float flower = step(0.92, hash12(floor(uvw * 6.0))) * smoothstep(0.3, 0.2, length(fract(uvw * 6.0) - 0.5));
    moss = mix(moss, mix(vec3(1.0, 0.85, 0.9), vec3(1.0, 0.95, 0.6), hash12(floor(uvw * 6.0) + 3.0)), flower);
    col = mix(col, moss, g * uGarden);
  }
  return col;
}
`;

const SKIN_PARS = /* glsl */ `
#include <skinning_pars_vertex>
`;

// ---------------------------------------------------------------------------------------
export const BODY_VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${SKIN_PARS}
attribute vec2 aLoft;
attribute vec4 aMask;   // x fur, y buoyancy sac, z gills, w throat
attribute float aInner; // 0 outer skin, 1 mouth interior, 2 filter combs
uniform float uSac;
uniform float uThroat;
uniform float uVib;
uniform float uGill;
uniform float uLen;
uniform float uBreath;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vLoft;
varying vec2 vUvw;
varying vec4 vMask;
varying float vInner;
void main() {
  #include <skinbase_vertex>
  vec3 objectNormal = normal;
  #include <skinnormal_vertex>
  vec3 transformed = position;
  // breathing swells the ribcage
  float breathMask = smoothstep(0.3, 0.45, aLoft.x) * (1.0 - smoothstep(0.62, 0.78, aLoft.x)) * (1.0 - aInner);
  transformed += normal * uBreath * breathMask * uLen * 0.006;
  // Buoyancy sacs swell along their dome.
  transformed += normal * aMask.y * uSac * uLen * 0.03;
  // Throat resonator: inflates with pleats, vibrates while humming / charging.
  float pleat = 0.82 + 0.18 * sin(aLoft.y * 6.2831853 * 26.0);
  float vib = sin(uTime * 87.0 + aLoft.x * 60.0) * uVib;
  transformed += normal * aMask.w * (uThroat * pleat + vib * 0.18) * uLen * 0.032;
  // Gill slit lips lift when filtering.
  float slit = sin((aLoft.x * 140.0)) * 0.5 + 0.5;
  transformed += normal * aMask.z * uGill * slit * uLen * 0.004;
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * objectNormal);
  vLoft = aLoft;
  vUvw = uv;
  vMask = aMask;
  vInner = aInner;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const BODY_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
${WHALE_COMMON}
uniform float uGill;
uniform float uSac;
uniform float uThroat;
uniform vec3 uGillColor;
uniform vec3 uMouthColor;
uniform float uFurShade;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vLoft;
varying vec2 vUvw;
varying vec4 vMask;
varying float vInner;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  float dorsal;
  vec3 albedo = whaleAlbedo(vLoft, vUvw, dorsal);
  // Under the fur the skin is a touch darker so shells read as depth.
  albedo *= mix(1.0, uFurShade, smoothstep(0.05, 0.4, vMask.x));
  float trans = 0.05;
  float spec = 0.12;
  float rim = 0.55;
  vec3 emis = vec3(0.0);
  // Gills: dark slits that bloom coral when open.
  if (vMask.z > 0.01) {
    float sp = fract(vLoft.x * 140.0 / 6.2831853);
    float line = smoothstep(0.16, 0.0, abs(sp - 0.5) - 0.02 - 0.12 * uGill);
    vec3 inner = mix(uGillColor * 0.35, uGillColor, uGill);
    albedo = mix(albedo, inner, line * vMask.z);
    trans += line * vMask.z * 0.6;
  }
  // Buoyancy sacs: pale, translucent, with faint veins.
  if (vMask.y > 0.01) {
    float vein = smoothstep(0.08, 0.0, abs(vnoise(vUvw * 6.0) - 0.5)) * 0.35;
    vec3 sacCol = mix(vec3(0.86, 0.93, 0.98), vec3(0.78, 0.88, 1.0), vein);
    float m = smoothstep(0.05, 0.6, vMask.y);
    albedo = mix(albedo, sacCol * (0.92 + 0.08 * uSac), m * 0.75);
    trans += m * (0.9 + 0.4 * uSac);
    spec += m * 0.4;
  }
  // Throat resonator: pleat grooves, flushing pink when swollen.
  if (vMask.w > 0.01) {
    float groove = smoothstep(0.35, 0.0, abs(fract(vLoft.y * 26.0) - 0.5) - 0.3);
    albedo *= mix(1.0, 0.82 - 0.1 * uThroat, groove * vMask.w);
    albedo = mix(albedo, vec3(1.0, 0.78, 0.78), uThroat * 0.25 * vMask.w);
    trans += vMask.w * 0.25 * uThroat;
  }
  if (vInner > 0.5) {
    if (vInner < 1.5) {
      float deep = smoothstep(0.0, 1.0, vMask.x);
      albedo = mix(uMouthColor, uMouthColor * 0.35, deep);
      rim = 0.1; spec = 0.35; trans = 0.0;
    } else {
      albedo = vec3(0.93, 0.88, 0.78) * (0.85 + 0.15 * vnoise(vUvw * 40.0));
      trans = 0.6; spec = 0.2;
    }
  }
  Surface s = makeSurface(albedo, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.ao = mix(0.7, 1.0, smoothstep(-0.8, 0.4, dorsal));
  if (vInner > 0.5 && vInner < 1.5) s.ao = 0.45;
  s.rim = rim;
  s.spec = spec * (1.0 + uWet * 2.0);
  s.gloss = 0.55 + uWet * 0.3;
  s.trans = trans;
  s.wrap = 0.2;
  vec3 col = stylizedLight(s);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------------------
export const FUR_VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${WHALE_COMMON}
${SKIN_PARS}
attribute vec2 aLoft;
attribute vec4 aMask;
attribute float aShell;
attribute vec3 aComb;
uniform float uFurLen;
uniform float uSac;
uniform float uThroat;
uniform float uFurShade;
uniform float uFurTip;
uniform vec3 uInertia;   // world-space, from spring-filtered acceleration (m)
uniform vec3 uAirflow;   // world-space relative wind (m/s)
uniform float uBreath;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUvw;
varying float vShell;
varying float vFur;
varying vec3 vAlbedo;
varying float vShadow;
varying float vDorsal;
void main() {
  #include <skinbase_vertex>
  vec3 objectNormal = normal;
  #include <skinnormal_vertex>
  float len = uFurLen * aMask.x * (1.0 - uWet * 0.45);
  float h = aShell;
  vec3 transformed = position;
  transformed += normal * aMask.y * uSac * uLen * 0.03;
  transformed += normal * aMask.w * uThroat * uLen * 0.032;
  float breathMask = smoothstep(0.3, 0.45, aLoft.x) * (1.0 - smoothstep(0.62, 0.78, aLoft.x));
  transformed += normal * uBreath * breathMask * uLen * 0.006;
  // Extrude along the normal, combed back toward the tail.
  transformed += normal * h * len;
  transformed += aComb * (h * h) * len * 0.75;
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vec3 N = normalize(mat3(modelMatrix) * objectNormal);
  // Dynamics: airflow (wind + motion), inertia (lag behind acceleration), gravity droop.
  float flutter = 0.65 + 0.35 * sin(uTime * 9.0 + dot(wp.xyz, vec3(1.7, 2.3, 1.1)));
  vec3 disp = uAirflow * 0.018 * flutter - uInertia + vec3(0.0, -0.18, 0.0);
  disp *= (1.0 - uWet * 0.6);
  disp -= N * min(dot(disp, N), 0.0);
  float hh = h * h;
  wp.xyz += disp * hh * len * 1.3;
  vWorldPos = wp.xyz;
  vNormal = N;
  vUvw = uv;
  vShell = h;
  vFur = aMask.x;
  // Colour and shadow are evaluated per vertex: shells overlap heavily on screen,
  // so this moves the expensive work off the fragment stage.
  float dorsal;
  vec3 albedo = whaleAlbedo(aLoft, uv, dorsal);
  albedo *= mix(uFurShade, 1.0, smoothstep(0.0, 0.85, h));
  vAlbedo = albedo;
  vDorsal = dorsal;
  vShadow = sampleShadow(wp.xyz, N);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const FUR_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
uniform float uFurDensity;
uniform float uFurTip;
uniform float uSeed;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUvw;
varying float vShell;
varying float vFur;
varying vec3 vAlbedo;
varying float vShadow;
varying float vDorsal;
void main() {
  #ifdef FUR_DEBUG
    gl_FragColor = vec4(vShell, vFur, 0.0, 1.0);
    return;
  #endif
  if (vFur < 0.02) discard;
  vec2 fuv = vUvw * uFurDensity;
  vec2 cell = floor(fuv);
  vec2 f = fract(fuv);
  float rnd = hash12(cell + uSeed);
  vec2 c = hash22(cell + 7.0) * 0.6 + 0.2;
  float d = length(f - c);
  // Tufts: neighbouring strands clump into a soft painted mass.
  float clump = vnoise(vUvw * uFurDensity * 0.18 + uSeed);
  float strandLen = mix(0.45, 1.0, rnd) * mix(0.75, 1.15, clump) * smoothstep(0.0, 0.35, vFur);
  float h = vShell;
  if (h > strandLen) discard;
  float radius = (1.0 - h / strandLen) * 0.62 + 0.08;
  float cov = smoothstep(radius, radius - 0.22, d);
  cov = max(cov, smoothstep(0.3, 0.0, h) * 0.95);
  if (cov < 0.05) discard;
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 albedo = mix(vAlbedo, vAlbedo * uFurTip, smoothstep(0.5, 1.0, h / strandLen));
  Surface s = makeSurface(albedo, normalize(vNormal), vWorldPos);
  s.shadow = vShadow;
  s.ao = mix(0.62, 1.0, h) * mix(0.75, 1.0, smoothstep(-0.8, 0.4, vDorsal));
  s.rim = 0.75 * h;
  s.spec = 0.05;
  s.trans = 0.35 * h;
  s.wrap = 0.26;
  vec3 col = stylizedLight(s);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, cov);
}
`;

// ---------------------------------------------------------------------------------------
export const FIN_VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${SKIN_PARS}
attribute vec4 aFin;   // x span 0..1, y chord 0..1, z ray mask, w fur
uniform float uBillow;   // signed: membrane bulge from flapping
uniform vec3 uFinUp;     // bind-space bending direction
uniform float uFlutter;
uniform float uLen;
uniform float uChordLen;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vFin;
varying vec2 vUvw;
void main() {
  #include <skinbase_vertex>
  vec3 objectNormal = normal;
  #include <skinnormal_vertex>
  vec3 transformed = position;
  float span = aFin.x, chord = aFin.y;
  float mem = smoothstep(0.12, 1.0, chord);
  // billow: membrane belly lags behind the arm on each stroke
  float belly = mem * mem * sin(3.14159 * clamp(span * 1.1, 0.0, 1.0));
  // trailing-edge flutter in the airflow
  float fl = sin(uTime * 13.0 + span * 9.0 + chord * 4.0) * uFlutter * mem * mem * mem;
  transformed += uFinUp * (belly * uBillow + fl) * uChordLen;
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * objectNormal);
  vFin = aFin;
  vUvw = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const FIN_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
uniform vec3 uArm;
uniform vec3 uMembrane;
uniform vec3 uFinTip;
uniform vec3 uRayCol;
uniform float uSeed;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vFin;
varying vec2 vUvw;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  float span = vFin.x, chord = vFin.y;
  float arm = 1.0 - smoothstep(0.08, 0.22, chord);
  vec3 mem = mix(uMembrane, uFinTip, smoothstep(0.55, 1.0, max(span, chord * 0.8)));
  // Rays: bony fingers running through the membrane.
  float ray = vFin.z;
  mem = mix(mem, uRayCol, ray * 0.55);
  // fine painted veining
  float vein = smoothstep(0.06, 0.0, abs(vnoise(vec2(span * 18.0, chord * 4.0) + uSeed) - 0.5));
  mem *= 1.0 - vein * 0.08;
  vec3 albedo = mix(mem, uArm, arm);
  Surface s = makeSurface(albedo, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.rim = 0.5;
  s.spec = 0.15;
  s.gloss = 0.6;
  // Thin membrane glows when backlit; the rays and arm stay darker in silhouette.
  s.trans = mix(1.6, 0.2, max(arm, ray * 0.6));
  s.wrap = 0.3;
  s.ao = mix(1.0, 0.85, arm);
  vec3 col = stylizedLight(s);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------------------
// Eyes: a fixed sphere in the socket. Gaze, pupil and lids are painted procedurally in
// socket space so the lids can take any expressive shape (smile, squint, wide, sleepy).
export const EYE_VERT = /* glsl */ `
${UNIFORMS}
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLocal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLocal = normalize(position);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const EYE_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
uniform vec3 uGaze;       // socket space unit vector
uniform vec4 uLids;       // x upper lid elevation, y lower lid elevation, z upper curve, w lower curve
uniform float uPupil;     // pupil radius (radians)
uniform float uIrisR;     // iris radius (radians)
uniform vec3 uIris;
uniform vec3 uIris2;
uniform vec3 uLidCol;
uniform vec3 uSclera;
uniform float uSide;      // +1 right, -1 left
uniform float uSparkle;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLocal;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 n = normalize(vLocal);
  vec3 N = normalize(vNormal);
  // lids in socket space
  float az = atan(n.x, n.z);
  float el = asin(clamp(n.y, -1.0, 1.0));
  float up = uLids.x + uLids.z * az * az;
  float lo = uLids.y + uLids.w * az * az;
  float lidMask = smoothstep(up - 0.025, up + 0.025, el) + smoothstep(lo + 0.025, lo - 0.025, el);
  lidMask = clamp(lidMask, 0.0, 1.0);
  // eye surface
  float ang = acos(clamp(dot(n, normalize(uGaze)), -1.0, 1.0));
  vec3 eye = uSclera;
  float iris = smoothstep(uIrisR + 0.02, uIrisR - 0.02, ang);
  // radial iris streaks and a darker limbal ring
  vec3 tang = normalize(cross(uGaze, vec3(0.0, 1.0, 0.0)) + 1e-4);
  float rad = atan(dot(n, cross(uGaze, tang)), dot(n, tang));
  float streak = vnoise(vec2(rad * 7.0, ang * 30.0));
  vec3 irisCol = mix(uIris2, uIris, smoothstep(uIrisR, uPupil, ang));
  irisCol *= 0.85 + 0.3 * streak;
  irisCol = mix(irisCol, uIris2 * 0.35, smoothstep(uIrisR * 0.75, uIrisR, ang));
  // light pools in the lower iris (cornea caustic)
  irisCol += uIris * 0.55 * smoothstep(0.0, -0.6, n.y - dot(uGaze, vec3(0.0, 1.0, 0.0))) * smoothstep(uPupil, uIrisR, ang);
  eye = mix(eye, irisCol, iris);
  float pupil = smoothstep(uPupil + 0.015, uPupil - 0.015, ang);
  eye = mix(eye, vec3(0.015, 0.02, 0.04), pupil);
  // upper-lid shadow cast on the eye
  eye *= mix(1.0, 0.55, smoothstep(up - 0.32, up, el));
  // lash line
  float lash = smoothstep(0.07, 0.0, abs(el - up)) + smoothstep(0.05, 0.0, abs(el - lo)) * 0.5;
  Surface s = makeSurface(uLidCol, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.rim = 0.4; s.wrap = 0.22;
  vec3 lidLit = stylizedLight(s);
  // The eye itself: mostly self-lit tone + sky reflection + anime highlights.
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 R = reflect(-V, N);
  vec3 eyeLit = eye * (hemiAmbient(N) * 0.9 + uSunColor * 0.18);
  eyeLit += uSkyAmbient * 0.1 * pow(1.0 - max(dot(N, V), 0.0), 2.0);
  // Highlights are placed in view space (anime convention), so they always sparkle.
  vec3 camRight = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 camUp = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  vec3 L1 = normalize(V + camUp * 0.55 - camRight * 0.35 * uSide);
  vec3 L2 = normalize(V - camUp * 0.45 + camRight * 0.3 * uSide);
  float h1 = smoothstep(0.965, 0.975, dot(N, normalize(L1 + V)));
  float h2 = smoothstep(0.988, 0.992, dot(N, normalize(L2 + V)));
  eyeLit += vec3(1.0) * (h1 * 1.6 + h2 * 0.9) * uSparkle * (1.0 - lidMask);
  vec3 col = mix(eyeLit, lidLit, lidMask);
  col = mix(col, uLidCol * 0.18, lash * 0.85);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------------------
// Gill fronds: feathery external gills (stalk + fringe) that flare while filtering,
// stream back with speed, perk up when happy and flatten when afraid.
export const FROND_VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
attribute vec3 aFrond;  // x along stalk 0..1, y fringe 0..1 (0 = stalk), z frond index
uniform float uFlare;
uniform float uStream;
uniform float uWiggle;
uniform float uFrondLen;
uniform vec3 uFlowDir;   // local space flow direction (usually -Z)
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vFrond;
void main() {
  float a = aFrond.x;
  vec3 p = position;
  // bend the frond: flare lifts it away from the body (local +X), stream lays it back
  float bend = a * a;
  p.x += bend * uFrondLen * (uFlare * 0.55 - 0.15);
  p += uFlowDir * bend * uFrondLen * uStream * 0.6;
  float w = sin(uTime * 6.0 - a * 5.0 + aFrond.z * 2.1) * uWiggle;
  p.y += w * bend * uFrondLen * 0.18;
  p.x += cos(uTime * 4.3 - a * 4.0 + aFrond.z) * uWiggle * bend * uFrondLen * 0.08;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vFrond = aFrond;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const FROND_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
uniform vec3 uFrondCol;
uniform vec3 uFrondTip;
uniform float uFlareF;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vFrond;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 albedo = mix(uFrondCol, uFrondTip, smoothstep(0.2, 1.0, vFrond.y) * 0.8 + vFrond.x * 0.2);
  albedo *= 1.0 + uFlareF * 0.15;
  Surface s = makeSurface(albedo, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.rim = 0.6;
  s.trans = 1.2;
  s.wrap = 0.3;
  vec3 col = stylizedLight(s);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

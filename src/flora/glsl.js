// Shared GLSL for the alien flora of Vur Sok.
//
// Every species is drawn as instances of a parametric template: the template vertices carry
// coordinates along the plant (arc length, ring angle, part ids), and the vertex shader rebuilds the
// posed plant each frame (coiling, breathing, swaying, recoiling from whales). Thin parts are
// camera-facing strips shaded as round tubes ("2D cards with 3D light"), thick parts real geometry.
//
// Per-instance attributes (InstancedBufferAttribute, packed per LOD by AlienFlora):
//   iPos   xyz base position (world), w uniform scale
//   iQuat  orientation (local +Y is the growth axis)
//   iPrm   x seed 0..1, y hue shift -1..1, z palette index 0..3, w species aux 0..1
//   iState startle 0..1 (CPU: recoil when a whale passes, then slowly reopen)
import { UNIFORMS, NOISE, SHADOW, LIGHTING } from '../render/shaders/common.js';

export const FLORA_VERT_HEAD = /* glsl */ `
${UNIFORMS}
attribute vec4 iPos;
attribute vec4 iQuat;
attribute vec4 iPrm;
attribute float iState;
uniform vec4 uDist[8];     // disturbers: xyz centre, w radius
uniform vec4 uDistV[8];    // xyz velocity, w strength
uniform int uDistN;
uniform vec4 uLod;         // x lo, y hi, z band at lo, w band at hi
uniform vec2 uLodCfg;      // x spine integration steps for this LOD, y 1: sink into the ground at hi
uniform float uWindAmt;
uniform vec3 uPal[20];     // 4 palettes x 5 colours (base, mid, tip, accent, glow)
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
varying vec3 vAcc;
varying vec4 vUv;
varying vec4 vMat;         // x ao, y translucency, z glow, w species-specific
varying vec3 vW;           // strip width direction (strips) / around direction (tubes)
varying vec3 vV;           // strip view-perpendicular direction
varying float vFade;       // LOD dither: +w fading out, -w fading in

#define FLORA_CULL { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vFade = 0.0; return; }
#define TAU 6.28318531

float fhash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
vec3 rotAxis(vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
// sin(x)/x, stable at 0 (chord length of a circular arc)
float sinc(float x) { return abs(x) > 1e-4 ? sin(x) / x : 1.0 - x * x / 6.0; }

vec3 palCol(int k) { int p = int(iPrm.z + 0.5); return uPal[p * 5 + k]; }

// hue rotation in YIQ space (harmonious per-instance variation)
vec3 hueShift(vec3 c, float h) {
  float Y = dot(c, vec3(0.299, 0.587, 0.114));
  float I = dot(c, vec3(0.596, -0.274, -0.322));
  float Q = dot(c, vec3(0.211, -0.523, 0.312));
  float cs = cos(h), sn = sin(h);
  float I2 = I * cs - Q * sn, Q2 = I * sn + Q * cs;
  return max(vec3(Y + 0.956 * I2 + 0.621 * Q2, Y - 0.272 * I2 - 0.647 * Q2, Y - 1.106 * I2 + 1.703 * Q2), vec3(0.0));
}
vec3 instTint(vec3 c) {
  vec3 h = hueShift(c, iPrm.y * 0.32);
  return h * (0.92 + 0.16 * fhash(iPrm.x * 53.1));
}

// Signed LOD weight for this instance (distance from the main camera, the same in every pass).
// uLod: x lo, y hi, z band at lo, w band at hi. 0 culls the instance; +w fades out (keep where
// dither < w), -w fades in (keep where dither >= 1-w), so neighbouring LODs exactly complement.
// uLodCfg.y: the last LOD of small plants sinks into the ground instead of dithering away.
float lodFade(vec3 B, inout float shrink) {
  // big plants keep their detail farther away (giant hero croziers)
  float d = distance(B, uCamPos) / max(1.0, iPos.w * 0.6);
  float bl = max(uLod.z, 1e-3), bh = max(uLod.w, 1e-3);
  float wIn = uLod.x > 0.0 ? clamp((d - (uLod.x - bl * 0.5)) / bl, 0.0, 1.0) : 1.0;
  float wOut = clamp(((uLod.y + bh * 0.5) - d) / bh, 0.0, 1.0);
  if (uLodCfg.y > 0.5) {
    shrink = wOut;
    wOut = wOut > 0.0 ? 1.0 : 0.0;
  }
  if (wOut <= 0.0) return 0.0;
  if (wIn < 1.0) return -wIn;
  return wOut;
}

bool isOrtho() { return projectionMatrix[3][3] > 0.5; }
// direction toward the camera of the current pass (the sun camera in the shadow pass)
vec3 toCamDir(vec3 P) {
  if (isOrtho()) return normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));
  return normalize(cameraPosition - P);
}
// world size of one pixel at P (0 in the shadow pass)
float pixelWorld(vec3 P) {
  if (isOrtho()) return 0.0;
  return 2.0 * distance(P, cameraPosition) / (projectionMatrix[1][1] * uResolution.y);
}
// camera-facing strip around a centreline: width direction and the view-perpendicular normal
void stripFrame(vec3 C, vec3 T, out vec3 W, out vec3 Vp) {
  vec3 tc = toCamDir(C);
  W = cross(T, tc);
  float l = length(W);
  W = l > 1e-4 ? W / l : normalize(cross(T, vec3(0.31, 0.9, 0.3)));
  Vp = normalize(tc - T * dot(tc, T) + 1e-5);
}
// half width widened to stay at least ~0.7 px (thin far strands would flicker otherwise)
float stripHalfWidth(vec3 C, float hw) {
  return max(hw, pixelWorld(C) * 0.7);
}

// Wind, swell surge and disturbers as one horizontal bend vector (direction * angle, radians) for
// the whole instance, so plants bend as bodies (rotation about the base), never shear.
vec2 floraBend(vec3 B, float stiff, float seed, out float submerged) {
  submerged = smoothstep(0.4, -0.8, B.y - uSeaLevel);
  float ws = length(uWind.xz) * uWindAmt;
  vec2 wd = length(uWind.xz) > 1e-3 ? normalize(uWind.xz) : vec2(0.8, 0.6);
  // gust bands rolling across the meadow (same wave as the painted terrain grass)
  float wave = sin(dot(B.xz, wd) * 0.08 - uWavePhase);
  float gust = 0.6 + 0.28 * wave + 0.3 * uGust;
  float flick = sin(uTime * (1.6 + seed * 0.7) + seed * 40.0) * 0.1 + sin(uTime * 2.9 + seed * 17.0) * 0.05;
  float amt = ws * 0.045 / stiff;
  vec2 bend = wd * amt * (gust + flick);
  bend += vec2(-wd.y, wd.x) * amt * 0.22 * sin(uTime * 1.1 + seed * 20.0);
  // under water the swell's surge rocks plants slowly back and forth
  vec2 surge = vec2(0.8, 0.6) * sin(uTime * 0.7 + dot(B.xz, vec2(0.05, 0.04))) * (0.28 + 0.4 * uSeaState) / stiff
             + vec2(-0.6, 0.8) * sin(uTime * 0.41 + seed * 6.0) * 0.1 / stiff;
  bend = mix(bend, surge, submerged);
  // whales: plants lean away from a passing body and its wing downwash
  for (int i = 0; i < 8; i++) {
    if (i >= uDistN) break;
    vec4 D = uDist[i];
    vec3 dd = B - D.xyz;
    float d = length(dd);
    float infl = smoothstep(D.w * 2.4 + 3.0, D.w * 0.55, d) * uDistV[i].w;
    vec2 away = dd.xz / max(length(dd.xz), 0.75);
    bend += (away * 0.85 + uDistV[i].xz * 0.025) * infl / stiff;
  }
  float m = length(bend);
  if (m > 1.2) bend *= 1.2 / m;
  return bend;
}
// rotate a point (relative to the base) by the bend vector, scaled by f (0 at the root, 1 at the top)
vec3 applyBend(vec3 rel, vec2 bend, float f) {
  float m = length(bend);
  float a = m * f;
  if (a < 1e-5) return rel;
  vec3 axis = vec3(bend.y, 0.0, -bend.x) / m;
  return rotAxis(rel, axis, a);
}
// startle field for species without CPU state (tiny sprouts): 0..1 from nearby disturbers
float nearDisturb(vec3 B) {
  float s = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uDistN) break;
    float d = distance(B, uDist[i].xyz);
    s = max(s, smoothstep(uDist[i].w * 2.2 + 3.0, uDist[i].w * 0.8, d) * uDistV[i].w);
  }
  return s;
}
`;

export const FLORA_FRAG_HEAD = /* glsl */ `
#define TAU 6.28318531
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
uniform sampler2D uNoise;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
varying vec3 vAcc;
varying vec4 vUv;
varying vec4 vMat;
varying vec3 vW;
varying vec3 vV;
varying float vFade;

void lodDither() {
  if (vFade >= 0.999) return;
  float h = ign(gl_FragCoord.xy);
  if (vFade > 0.0) { if (h >= vFade) discard; }
  else if (h < 1.0 + vFade) discard;
}
// round normal of a camera-facing strip (v: -1..1 across)
vec3 stripNormal(float v) {
  float c = sqrt(max(1.0 - v * v, 0.0));
  return normalize(vW * v + vV * c);
}
float noiseTex(vec2 uv, int ch) {
  vec4 n = texture2D(uNoise, uv);
  return ch == 0 ? n.r : ch == 1 ? n.g : ch == 2 ? n.b : n.a;
}

/**
 * The painterly plant light: the world's stylized model (wrapped diffuse, tinted shadows, sky
 * ambient, rim, translucency) plus diffuse transmission through thin tissue lit from behind.
 * thin: 0 solid (tubes, bulbs) .. 1 thin sheet (ribbons, petals, fronds)
 */
vec3 floraLight(vec3 albedo, vec3 N, vec3 P, float ao, float trans, float thin, float wrap, float rim,
                float spec, float gloss, vec3 emissive) {
  float ndl = dot(N, uSunDir);
  // thin sheets take the shadow of their sunward face
  vec3 Ns = (thin > 0.5 && ndl < 0.0) ? -N : N;
  Surface s = makeSurface(albedo, N, P);
  s.shadow = sampleShadow(P, Ns);
  // keep only a whisper of the white sky rim; the painterly rim below takes the surface colour
  s.ao = ao; s.trans = trans; s.wrap = wrap; s.rim = rim * 0.25; s.spec = spec; s.gloss = gloss;
  s.emissive = emissive;
  vec3 col = stylizedLight(s);
  float fres = pow(1.0 - max(dot(N, s.V), 0.0), 2.5);
  float backV = pow(max(dot(-s.V, uSunDir), 0.0), 2.0);
  vec3 rimLight = hemiAmbient(N) * 0.6 + uSunColor * (0.08 + 0.5 * backV) * mix(0.3, 1.0, s.shadow);
  col += fres * rim * rimLight * saturation(albedo, 1.3) * 1.6 * (0.6 + 0.4 * ao);
  // light passing through the leaf from its sunlit back face: warm and saturated
  // (thin tissue scatters forward: brightest looking into the sun through it, a soft glow from
  // the side, and the light deepens toward the leaf's own saturated colour as it passes)
  float back = max(-ndl, 0.0) * thin;
  float fwd = pow(max(dot(-s.V, uSunDir), 0.0), 3.0);
  vec3 through = saturation(albedo, 1.25 + 0.25 * fwd) * 1.15;
  col += through * uSunColor * back * trans * (0.3 + 0.55 * fwd) * s.shadow * vec3(1.0, 0.94, 0.78);
  return col;
}
`;

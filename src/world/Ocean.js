// The living ocean of Vur Sok.
//
// Waves: a directional sea spectrum (wind sea + a crossing swell) sampled into four cascades of
// trochoidal (Gerstner) waves. Each cascade lives on a periodic lattice tile, so its whole sum is
// evaluated once per frame into small mipmapped textures (displacement, slopes, slope variance,
// Jacobian foam that lingers where crests broke). The surface mesh is a camera-centred radial
// grid displaced by the band-limited cascades, so it never shows an edge or a tile, and the sky
// dome continues the same optics to the horizon. Every wave is a plain sum the CPU mirrors
// exactly (heightAt / normalAt), and sea state changes only re-weight amplitudes, so the sea
// eases from glassy to storm without a phase jump.
//
// Interaction: a camera-following wave-equation sheet takes splashes and wakes (rings, V-wakes,
// foam that drifts apart and fades, plankton glow at night).
//
// Optics: fresnel reflection of the rendered sky (plus screen-space reflections of islands and
// whales), a LEAN-filtered sun and moon glitter path, refraction of the scene below through the
// water column, sub-surface light through thin crests, crest / intersection / wake foam, and,
// seen from below, Snell's window with total internal reflection.
import {
  Mesh, BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, ShaderMaterial, Vector2, Vector3,
  Vector4, Matrix4, WebGLRenderTarget, HalfFloatType, RGBAFormat, LinearFilter, LinearMipmapLinearFilter,
  RepeatWrapping, ClampToEdgeWrapping, DoubleSide, NoBlending, GLSL3,
} from 'three';
import { G } from '../render/Globals.js';
import { UNIFORMS, NOISE, SHADOW, LIGHTING, DEPTH, SEA } from '../render/shaders/common.js';
import { getNoiseTexture } from '../render/NoiseTex.js';
import { FullscreenPass, FS_VERT } from '../render/FullscreenPass.js';
import { rng, clamp, lerp, smoothstep, saturate, wrapAngle } from '../core/math.js';

const GRAV = 9.81;
const TAU = Math.PI * 2;
// mean wind heading the wave set is built around (Wind.js veers within about +-0.5 rad of it)
const WIND0 = 0.6;
// the long swell arrives from elsewhere: crossing seas read as a real ocean
const SWELL_DIR = -0.45;
const SWELL_LAMBDA = 230;

// Cascades: periodic tile (m), wave count, wavelength band (m), tile rotation, texture size.
// Tile sizes are incommensurate and rotated, so no two cascades repeat together.
const CASCADES = [
  { L: 1517, n: 52, lmin: 118, lmax: 760, rot: 0.37, res: 256, disp: true },
  { L: 211.3, n: 56, lmin: 15.5, lmax: 118, rot: 1.13, res: 256, disp: true },
  { L: 23.71, n: 52, lmin: 1.9, lmax: 15.5, rot: 2.29, res: 256, disp: true },
  { L: 3.137, n: 40, lmin: 0.21, lmax: 1.9, rot: 0.71, res: 128, disp: false },
];
const MAXW = 64;

// Sea state keys: 0 glassy, 0.3 calm, 0.6 lively, 1 storm (6-12 m swells).
const KEYS = [0, 0.3, 0.6, 1];
const HS = [0.035, 0.6, 2.2, 9.0]; // significant height of the wind sea (m)
const TP = [2.4, 5.2, 7.4, 9.2]; // peak period (s)
const HSW = [0.14, 0.42, 0.85, 2.4]; // swell height (m)
const CHOP = [0.55, 0.85, 1.05, 1.25];
const FOAMJ = [-0.4, 0.2, 0.5, 0.86]; // Jacobian below which crests break into foam
function keyed(arr, s) {
  if (s <= 0) return arr[0];
  for (let i = 1; i < KEYS.length; i++) {
    if (s <= KEYS[i]) {
      const t = (s - KEYS[i - 1]) / (KEYS[i] - KEYS[i - 1]);
      return lerp(arr[i - 1], arr[i], t * t * (3 - 2 * t));
    }
  }
  return arr[arr.length - 1];
}

// ------------------------------------------------------------------------------------------
// Cascade evaluation: one fullscreen pass per cascade into three float targets.
//  t0: Dx, Dy, Dz, J          (vertex displacement)
//  t1: Hx, Hz, Dxx, Dzz       (slopes and horizontal compression)
//  t2: Hx^2, Hz^2, Dxz, foam  (second moments for filtered roughness, lingering crest foam)
// The normal-only detail cascade writes one target: Hx, Hz, Hx^2, Hz^2.
const CASCADE_FRAG = /* glsl */ `
precision highp float;
uniform vec4 uW[${MAXW}]; // tile-space kx, kz, amplitude, phase
uniform vec4 uK[${MAXW}]; // world-space kx, kz, |k|
uniform int uN;
uniform float uL;
uniform float uChop;
uniform sampler2D uPrev;
uniform float uDecay;
uniform vec2 uFoamJ; // x: Jacobian threshold, y: gain
varying vec2 vUv;
layout(location = 0) out vec4 o0;
#ifndef DETAIL
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
#endif
void main() {
  vec2 x = vUv * uL;
  float dy = 0.0, dx = 0.0, dz = 0.0, hx = 0.0, hz = 0.0, dxx = 0.0, dzz = 0.0, dxz = 0.0;
  for (int i = 0; i < ${MAXW}; i++) {
    if (i >= uN) break;
    vec4 w = uW[i];
    vec4 k = uK[i];
    float th = dot(w.xy, x) + w.w;
    float s = sin(th), c = cos(th);
    float A = w.z;
    dy += A * c;
    hx -= A * k.x * s;
    hz -= A * k.y * s;
#ifndef DETAIL
    float ch = uChop * A / k.z;
    dx -= ch * k.x * s;
    dz -= ch * k.y * s;
    dxx -= ch * k.x * k.x * c;
    dzz -= ch * k.y * k.y * c;
    dxz -= ch * k.x * k.y * c;
#endif
  }
#ifdef DETAIL
  o0 = vec4(hx, hz, hx * hx, hz * hz);
#else
  float J = (1.0 + dxx) * (1.0 + dzz) - dxz * dxz;
  float prev = texture(uPrev, vUv).w;
  float brk = clamp((uFoamJ.x - J) * uFoamJ.y, 0.0, 1.0);
  float foam = max(prev * uDecay, brk);
  o0 = vec4(dx, dy, dz, J);
  o1 = vec4(hx, hz, dxx, dzz);
  o2 = vec4(hx * hx, hz * hz, dxz, foam);
#endif
}
`;

// ------------------------------------------------------------------------------------------
// Interaction sheet: damped wave equation + foam + plankton glow, scrolled with the camera.
const SIM_FRAG = /* glsl */ `
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform vec2 uShift;
uniform float uDt;
uniform float uAlpha;   // c^2 dt / dx^2
uniform float uDamp;
uniform float uFoamDecay;
uniform float uGlowDecay;
uniform vec4 uSrc[16];  // uv x, uv y, radius (uv), height (m)
uniform vec4 uSrcB[16]; // foam, glow, mode (0 disc kick, 1 ring kick, 2 hull pressure), unused
uniform int uSrcN;
uniform float uFoamGen;
uniform float uCell;
varying vec2 vUv;
vec4 at(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(uPrev, uv);
}
void main() {
  vec2 uv = vUv + uShift;
  vec4 s = at(uv);
  vec4 l = at(uv - vec2(uTexel.x, 0.0)), r = at(uv + vec2(uTexel.x, 0.0));
  vec4 d = at(uv - vec2(0.0, uTexel.y)), u = at(uv + vec2(0.0, uTexel.y));
  float lap = l.r + r.r + d.r + u.r - 4.0 * s.r;
  float v = (s.g + uAlpha * lap) * uDamp;
  float h0 = s.r;
  float foam = s.b;
  float glow = s.a;
  for (int i = 0; i < 16; i++) {
    if (i >= uSrcN) break;
    vec4 a = uSrc[i];
    vec4 b = uSrcB[i];
    float q = length(vUv - a.xy) / max(a.z, 1e-5);
    float disc = exp(-q * q * 2.0);
    if (b.z > 1.5) {
      // a hull pushing the water down as it passes: the rebound behind it is the wake
      h0 = mix(h0, min(h0, a.w), disc * 0.35);
      v *= 1.0 - disc * 0.2;
    } else {
      float k = b.z > 0.5 ? exp(-pow((q - 0.75) * 4.0, 2.0)) : exp(-q * q * 2.5);
      h0 += a.w * k;
    }
    foam += b.x * disc;
    glow += b.y * disc;
  }
  float h = h0 + v * uDt;
  // steep ripple fronts whiten a little
  float slope = length(vec2(r.r - l.r, u.r - d.r)) * 0.5 / uCell;
  foam += max(slope - 0.25, 0.0) * uFoamGen;
  // foam spreads slowly and thins as it ages: thick fresh foam collapses fast, lace lingers
  float fa = (l.b + r.b + d.b + u.b) * 0.25;
  float fast = smoothstep(0.5, 1.4, foam);
  foam = mix(foam, fa, 0.06) * mix(uFoamDecay, uFoamDecay * uFoamDecay * uFoamDecay * uFoamDecay * uFoamDecay, fast);
  glow = mix(glow, (l.a + r.a + d.a + u.a) * 0.25, 0.08) * uGlowDecay;
  // absorbing border
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = smoothstep(0.0, 0.06, min(e.x, e.y));
  gl_FragColor = vec4(h * edge, v * edge, clamp(foam, 0.0, 4.0) * edge, clamp(glow, 0.0, 4.0) * edge);
}
`;

// ------------------------------------------------------------------------------------------
const OCEAN_VERT = /* glsl */ `
${UNIFORMS}
uniform vec2 uCenter;
uniform sampler2D uA0;
uniform sampler2D uA1;
uniform sampler2D uA2;
uniform vec4 uCas[4];     // world -> tile uv: (cos/L, sin/L), z: texel size (m)
uniform sampler2D uSim;
uniform vec4 uSimXf;      // xy domain centre, z size (m), w on
uniform vec4 uShelter[8]; // x, z, radius, strength
uniform int uShelterN;
attribute float aSpacing;
varying vec3 vWorld;
varying vec2 vGrid;
varying float vViewZ;
varying float vShelter;
varying float vDispY;
varying vec2 vCrest;
varying float vSpacing;
uniform vec2 uCrestNorm;

vec2 casUv(vec2 p, vec4 c) { return vec2(dot(p, c.xy), dot(p, vec2(-c.y, c.x))); }
float shelterAt(vec2 p) {
  float f = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uShelterN) break;
    vec4 s = uShelter[i];
    float d = length(p - s.xy);
    f *= 1.0 - s.w * smoothstep(s.z, s.z * 0.55, d);
  }
  return f;
}
void main() {
  vec2 grid = uCenter + position.xz;
  float sp = aSpacing;
  vec3 D = vec3(0.0);
  D += textureLod(uA0, casUv(grid, uCas[0]), max(log2(sp / uCas[0].z), 0.0)).xyz;
  D += textureLod(uA1, casUv(grid, uCas[1]), max(log2(sp / uCas[1].z), 0.0)).xyz;
  vec3 D2 = textureLod(uA2, casUv(grid, uCas[2]), max(log2(sp / uCas[2].z), 0.0)).xyz;
  vCrest = vec2(D2.y * uCrestNorm.x, D.y * uCrestNorm.y);
  D += D2;
  float sh = shelterAt(grid);
  D *= sh;
  if (uSimXf.w > 0.0) {
    vec2 su = (grid - uSimXf.xy) / uSimXf.z + 0.5;
    if (su.x > 0.0 && su.y > 0.0 && su.x < 1.0 && su.y < 1.0) {
      float fine = 1.0 - smoothstep(0.6, 2.5, sp);
      D.y += textureLod(uSim, su, 0.0).r * fine;
    }
  }
  vec3 wp = vec3(grid.x + D.x, uSeaLevel + D.y, grid.y + D.z);
  vWorld = wp;
  vGrid = grid;
  vShelter = sh;
  vDispY = D.y;
  vSpacing = sp;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const OCEAN_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
${DEPTH}
${SEA}
uniform sampler2D uB0;
uniform sampler2D uB1;
uniform sampler2D uB2;
uniform sampler2D uC0;
uniform sampler2D uC1;
uniform sampler2D uC2;
uniform sampler2D uD3;
uniform vec4 uCas[4];
uniform sampler2D uSim;
uniform vec4 uSimXf;
uniform sampler2D uNoise;
uniform sampler2D uSceneTex;
uniform mat4 uProj;
uniform vec4 uOcean;     // x capillary variance, y patchiness, z refraction strength, w ssr steps
uniform vec4 uFoamCtl;   // x crest foam gain, y streaks, z intersection foam, w far fade start (m)
uniform vec2 uWindDir;   // unit, the way the wind blows
uniform vec2 uDrift;     // wind drift of foam patterns (m)
uniform float uMeshEdge;
varying vec3 vWorld;
varying vec2 vGrid;
varying float vViewZ;
varying float vShelter;
varying float vDispY;
varying vec2 vCrest;
varying float vSpacing;
uniform vec2 uFoamJ;
uniform int uDebug;
uniform vec4 uRings[8];   // splash ring trains: x, z, start time, strength
uniform vec4 uWakeP[64];  // 4 wake trails x 16 points, head first: x, z, time, speed
uniform vec4 uWakeB[4];   // per trail: bounds centre xz, bounds radius, body width
uniform vec4 uWakeN;      // points per trail

// Kelvin wake behind a trail: chevrons of divergent waves inside a 19.5 degree wedge, strongest
// along the cusp lines. Returns the slope (dh/dx, dh/dz) and the arm crest mask in z.
vec3 kelvinWake(vec2 p, int tr, float n) {
  vec4 B = uWakeB[tr];
  if (n < 2.0 || length(p - B.xy) > B.z) return vec3(0.0);
  float best = 1e9, sAt = 0.0, side = 1.0, v = 0.0, born = 0.0, acc = 0.0;
  vec2 dirAt = vec2(1.0, 0.0);
  for (int i = 0; i < 15; i++) {
    if (float(i + 1) >= n) break;
    vec4 a = uWakeP[tr * 16 + i], b = uWakeP[tr * 16 + i + 1];
    vec2 seg = b.xy - a.xy;
    float L = max(length(seg), 1e-3);
    float t = clamp(dot(p - a.xy, seg) / (L * L), 0.0, 1.0);
    vec2 q = a.xy + seg * t;
    float d = length(p - q);
    if (d < best) {
      best = d;
      sAt = acc + t * L;
      vec2 sd = seg / L;
      side = sign(sd.x * (p.y - a.y) - sd.y * (p.x - a.x));
      dirAt = sd;
      v = mix(a.w, b.w, t);
      born = mix(a.z, b.z, t);
    }
    acc += L;
  }
  float W = B.w;
  float u = sAt;                       // metres behind the head
  float w = best;                      // metres from the track
  float edge = u * 0.354 + W * 0.6;    // tan(19.47 deg)
  if (w > edge + 6.0) return vec3(0.0);
  float age = max(uTime - born, 0.0);
  float lam = 1.1 + v * 0.32;
  float K = 6.2831 / lam;
  const float ca = 0.819, sa = 0.574; // chevron crests at 35 degrees to the track
  float ph = K * (w * ca - u * sa);
  float arm = exp(-pow((w - edge) / (lam * 1.2 + u * 0.05), 2.0));
  float inside = smoothstep(edge + lam, edge - lam * 0.5, w);
  float A = 0.07 * clamp(v / 6.0, 0.0, 2.0) * (0.35 * inside + arm) * exp(-age / 7.0) * smoothstep(0.0, W * 0.5 + 1.0, u);
  // slope in track coordinates (u back along the track, w out to this side)
  float c = cos(ph);
  float dw = A * K * ca * c, du = -A * K * sa * c;
  vec2 back = dirAt;
  vec2 outw = vec2(-back.y, back.x) * side;
  vec2 g = back * du + outw * dw;
  return vec3(g, arm * max(sin(ph), 0.0) * A * 6.0);
}

vec2 casUv(vec2 p, vec4 c) { return vec2(dot(p, c.xy), dot(p, vec2(-c.y, c.x))); }

// The sea needs only a soft hint of shadow (glitter, foam, the light inside the water): 4 taps.
float seaShadow(vec3 P) {
  float cs = cloudShade(P);
  if (uShadowParams.w <= 0.0) return cs;
  vec4 sc = uShadowMatrix * vec4(P, 1.0);
  vec2 e = abs(sc.xy - 0.5) * 2.0;
  float edge = max(e.x, e.y);
  if (edge > 1.0 || sc.z > 1.0 || sc.z < 0.0) return cs;
  float r = uShadowParams.x * 3.5;
  float z = sc.z - uShadowParams.y * 1.5;
  float s = texture(uShadowMap, vec3(sc.xy + vec2(-0.7, -0.3) * r, z)) + texture(uShadowMap, vec3(sc.xy + vec2(0.3, -0.7) * r, z))
          + texture(uShadowMap, vec3(sc.xy + vec2(0.7, 0.3) * r, z)) + texture(uShadowMap, vec3(sc.xy + vec2(-0.3, 0.7) * r, z));
  s *= 0.25;
  return mix(mix(1.0, s, uShadowParams.w), 1.0, smoothstep(0.82, 1.0, edge)) * cs;
}

// Screen-space reflection: march the reflected ray in growing steps until it crosses behind the
// opaque depth, then bisect the crossing. blur > 0 averages a small footprint (rough or distant).
vec4 ssr(vec3 P, vec3 R, float jit, int steps, float blur) {
  float t = 0.8 + jit * 0.25;
  float tPrev = 0.0;
  bool prevFront = true;
  for (int i = 0; i < 28; i++) {
    if (i >= steps) break;
    vec3 Q = P + R * t;
    vec4 vq = viewMatrix * vec4(Q, 1.0);
    if (vq.z > -0.5) break;
    vec4 cq = uProj * vq;
    vec2 uv = cq.xy / cq.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float sz = sceneDepthAt(uv);
    float rz = -vq.z;
    bool front = rz <= sz;
    if (!front && prevFront && sz < uNearFar.y * 0.9 && rz < sz + max(t - tPrev, 1.0) * 1.5 + 1.0) {
      // bisect between the last point in front and this one behind
      float a = tPrev, b = t;
      for (int j = 0; j < 6; j++) {
        float m = 0.5 * (a + b);
        vec4 vm = viewMatrix * vec4(P + R * m, 1.0);
        vec4 cm = uProj * vm;
        vec2 um = cm.xy / cm.w * 0.5 + 0.5;
        if (-vm.z > sceneDepthAt(um)) { b = m; uv = um; } else a = m;
      }
      vec2 eg = smoothstep(0.0, 0.08, uv) * smoothstep(1.0, 0.92, uv);
      float conf = eg.x * eg.y;
      vec3 c = texture2D(uSceneTex, uv).rgb;
      if (blur > 0.0) {
        vec2 o = blur / uResolution;
        c = c * 0.4 + 0.15 * (texture2D(uSceneTex, uv + vec2(o.x, o.y)).rgb + texture2D(uSceneTex, uv + vec2(-o.x, o.y)).rgb
                            + texture2D(uSceneTex, uv + vec2(o.x, -o.y)).rgb + texture2D(uSceneTex, uv - o).rgb);
      }
      return vec4(c, conf);
    }
    prevFront = front;
    tPrev = t;
    t *= 1.45;
  }
  return vec4(0.0);
}

void main() {
  vec2 p = vGrid;
  vec3 P = vWorld;
  vec3 toCam = uCamPos - P;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  // ---- wave slopes and their filtered variance from the cascades --------------------------------
  vec2 u0 = casUv(p, uCas[0]), u1 = casUv(p, uCas[1]), u2 = casUv(p, uCas[2]), u3 = casUv(p, uCas[3]);
  vec4 b0 = texture2D(uB0, u0), b1 = texture2D(uB1, u1), b2 = texture2D(uB2, u2);
  vec4 c0 = texture2D(uC0, u0), c1 = texture2D(uC1, u1), c2 = texture2D(uC2, u2);
  vec4 d3 = texture2D(uD3, u3);
  // wind patches: cat's paws and glassy slicks drift over calm water
  float patchN = texture2D(uNoise, (p + uDrift) / 1400.0).r * 0.65 + texture2D(uNoise, (p + uDrift * 1.3) / 380.0).a * 0.35;
  float patchy = mix(1.0, smoothstep(0.32, 0.72, patchN) * 1.5 + 0.12, uOcean.y);
  float sh = vShelter;
  float shs = sh * mix(1.0, patchy, 0.7);
  float hx = (b0.x + b1.x) * sh + b2.x * shs;
  float hz = (b0.y + b1.y) * sh + b2.y * shs;
  float dxx = (b0.z + b1.z + b2.z) * sh;
  float dzz = (b0.w + b1.w + b2.w) * sh;
  float dxz = (c0.z + c1.z + c2.z) * sh;
  float vx = (max(c0.x - b0.x * b0.x, 0.0) + max(c1.x - b1.x * b1.x, 0.0)) * sh * sh
           + (max(c2.x - b2.x * b2.x, 0.0) + max(d3.z - d3.x * d3.x, 0.0)) * shs * shs;
  float vz = (max(c0.y - b0.y * b0.y, 0.0) + max(c1.y - b1.y * b1.y, 0.0)) * sh * sh
           + (max(c2.y - b2.y * b2.y, 0.0) + max(d3.w - d3.y * d3.y, 0.0)) * shs * shs;
  float cap = uOcean.x * mix(0.25, 1.0, sh) * patchy * mix(1.0, 0.45, 1.0 - smoothstep(18.0, 70.0, dist));
  float crestFoam = (c0.w * 1.0 + c1.w * 0.9 + c2.w * 0.55) * sh;

  // interaction sheet: ripples, wakes, splash foam, plankton glow
  float simFoam = 0.0, simGlow = 0.0, simH = 0.0;
  if (uSimXf.w > 0.0) {
    vec2 su = (p - uSimXf.xy) / uSimXf.z + 0.5;
    if (su.x > 0.0 && su.y > 0.0 && su.x < 1.0 && su.y < 1.0) {
      float tx = 1.0 / 512.0;
      vec4 s0 = texture2D(uSim, su);
      float hl = texture2D(uSim, su - vec2(tx, 0.0)).r, hr = texture2D(uSim, su + vec2(tx, 0.0)).r;
      float hd = texture2D(uSim, su - vec2(0.0, tx)).r, hu = texture2D(uSim, su + vec2(0.0, tx)).r;
      float cell = uSimXf.z * tx * 2.0;
      hx += (hr - hl) / cell;
      hz += (hu - hd) / cell;
      simFoam = s0.b;
      simGlow = s0.a;
      simH = s0.r;
    }
  }

  // splash ring trains: ripples run out through an envelope that spreads at half their speed
  // (deep-water dispersion), fading as they widen
  for (int i = 0; i < 8; i++) {
    vec4 rg = uRings[i];
    float age = uTime - rg.z;
    if (rg.w <= 0.0 || age < 0.0 || age > 9.0) continue;
    vec2 dv = p - rg.xy;
    float r = length(dv);
    float cg = 1.6 + rg.w * 0.4;
    float rc = cg * age + 1.0;
    float wdt = 1.2 + age * 0.9;
    float env = exp(-pow((r - rc) / wdt, 2.0));
    if (env < 0.003) continue;
    float kk = 6.2831 / (1.4 + age * 0.35 + rg.w * 0.4);
    float A = rg.w * 0.12 / (1.0 + age * 0.6) / sqrt(1.0 + r * 0.25);
    float dh = clamp(A * kk, 0.0, 0.45) * cos(kk * (r - 2.0 * cg * age)) * env;
    vec2 dir = dv / max(r, 1e-3);
    hx += dir.x * dh;
    hz += dir.y * dh;
  }

  // the smooth surface (no ripples finer than a metre): reflected rays of SSR follow it, so
  // reflections break into coherent streaks instead of salt-and-pepper speckle
  float hxS = hx, hzS = hz;
  hx += d3.x * shs;
  hz += d3.y * shs;

  // capillary ripples right under the eye: two drifting layers of fine noise relief
  float capNear = 1.0 - smoothstep(18.0, 70.0, dist);
  if (capNear > 0.0) {
    vec2 wdir = uWindDir;
    vec2 qa = p / 2.3 + wdir * uTime * 0.21;
    vec2 qb = p / 1.37 + vec2(-wdir.y, wdir.x) * uTime * 0.13 + 0.5;
    const float e = 1.0 / 256.0;
    float a0 = texture2D(uNoise, qa).b, ax = texture2D(uNoise, qa + vec2(e, 0.0)).b, az = texture2D(uNoise, qa + vec2(0.0, e)).b;
    float b0 = texture2D(uNoise, qb).b, bx = texture2D(uNoise, qb + vec2(e, 0.0)).b, bz = texture2D(uNoise, qb + vec2(0.0, e)).b;
    float amp = (0.006 + 0.03 * sqrt(uOcean.x)) * capNear * shs;
    hx += ((ax - a0) * 256.0 / 2.3 + (bx - b0) * 256.0 / 1.37 * 0.6) * amp;
    hz += ((az - a0) * 256.0 / 2.3 + (bz - b0) * 256.0 / 1.37 * 0.6) * amp;
  }

  // wakes of whales moving at the surface
  float wakeArm = 0.0;
  for (int i = 0; i < 4; i++) {
    float n = uWakeN[i];
    if (n < 2.0) continue;
    vec3 kw = kelvinWake(p, i, n);
    hx += kw.x;
    hz += kw.y;
    hxS += kw.x;
    hzS += kw.y;
    wakeArm += kw.z;
  }

  // rain: expanding ring ripples where drops land (two staggered layers of cells)
  if (uWet > 0.02 && dist < 120.0) {
    vec2 rg = vec2(0.0);
    for (int l = 0; l < 2; l++) {
      vec2 q = p * (l == 0 ? 0.9 : 1.37) + float(l) * 7.31;
      vec2 ci = floor(q), cf = fract(q);
      vec2 o = hash22(ci + float(l) * 13.0);
      float ph = fract(uTime * 1.3 + o.x * 7.0);
      vec2 dv = cf - (0.25 + o * 0.5);
      float r = length(dv);
      float ring = r - ph * 0.45;
      float w = exp(-ring * ring * 900.0) * (1.0 - ph) * (1.0 - ph);
      rg += dv / max(r, 1e-3) * sin(ring * 90.0) * w;
    }
    float rk = uWet * 0.35 * (1.0 - smoothstep(40.0, 120.0, dist));
    hx += rg.x * rk;
    hz += rg.y * rk;
  }

  // normal of the displaced (trochoidal) surface
  float jx = max(1.0 + dxx, 0.15), jz = max(1.0 + dzz, 0.15);
  float Jt = (1.0 + dxx) * (1.0 + dzz) - dxz * dxz;
  float J = max(jx * jz - dxz * dxz, 0.05);
  // crests breaking right now (the whole sea's compression), on top of the lingering foam
  crestFoam = max(crestFoam, clamp((uFoamJ.x - Jt) * uFoamJ.y, 0.0, 1.0) * sh);
  vec3 N = normalize(vec3(hz * dxz - hx * jz, J, dxz * hx - hz * jx));
  vec3 NS = normalize(vec3(hzS * dxz - hxS * jz, J, dxz * hxS - hzS * jx));
  float s2 = 0.5 * (vx + vz) + cap;

  // far away the mesh hands over to the analytic sea the sky dome draws past its edge
  float farK = smoothstep(uFoamCtl.w, uMeshEdge, length(P.xz - uCamPos.xz));
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), farK));
  s2 = mix(s2, uSeaFar.x, farK);

  vec2 suv = gl_FragCoord.xy / uResolution;
  float surfZ = vViewZ;
  // white-noise jitter (interleaved gradient noise would print its lattice into reflections)
  float jit = hash12(gl_FragCoord.xy + fract(uTime) * 17.0) * 0.5;
  vec3 col;
  vec4 dbg = vec4(0.0);

  if (uUnderwater < 0.5) {
    // ================================ seen from above ================================
    float nv = max(dot(N, V), 0.0);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y) + 0.002;
    R = normalize(R);
    float rough = sqrt(s2);
    float F = seaFresnel(nv) / (1.0 + rough * 4.0 * (1.0 - nv));
    vec3 env = skyEnv(R, seaEnvLod(s2));
    if (uOcean.w > 0.5 && farK < 0.99) {
      vec3 RS = reflect(-V, normalize(mix(NS, vec3(0.0, 1.0, 0.0), farK)));
      RS.y = abs(RS.y) + 0.002;
      vec4 ss = ssr(P, normalize(RS), 0.0, int(uOcean.w), rough * 40.0);
      env = mix(env, ss.rgb, ss.a * smoothstep(0.35, 0.05, rough));
    }
    float shadow = seaShadow(P + vec3(0.0, 0.3, 0.0));
    vec3 spec = seaGlitter(N, V, uSunDir, s2 + 1.2e-4, uSunColor) * shadow * (1.0 - uStorm * 0.85);
    spec += seaGlitter(N, V, uMoonDir, s2 + 1.2e-4, uMoonColor * 0.9) * uNight;

    // what lies below: refracted scene through the water column
    float sceneZ = sceneDepthAt(suv);
    // bend by the tilt of the surface only (a flat sea refracts straight down the view ray)
    vec3 Nv = mat3(viewMatrix) * vec3(N.x, 0.0, N.z);
    float thick0 = max(sceneZ - surfZ, 0.0);
    vec2 off = Nv.xy * uOcean.z * min(thick0, 8.0) / max(surfZ, 1.0);
    // no bending near the frame edges (there is nothing to fetch beyond them)
    vec2 eg = smoothstep(0.0, 0.06, suv) * smoothstep(1.0, 0.94, suv);
    off *= eg.x * eg.y;
    vec2 ruv = clamp(suv - off, vec2(0.0005), vec2(0.9995));
    float rz = sceneDepthAt(ruv);
    if (rz < surfZ + 0.05) { ruv = suv; rz = sceneZ; }
    bool open = rz > uNearFar.y * 0.95;
    float path = max(rz - surfZ, 0.0) * dist / max(surfZ, 1e-3);
    vec3 e = open ? vec3(0.0) : exp(-uWaterAbsorb * path);
    vec3 Rf = open ? vec3(0.0) : texture2D(uSceneTex, ruv).rgb;

    // light scattered up out of the water; thin crests glow turquoise when backlit
    vec3 Lh = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(1e-4));
    float toward = pow(clamp(dot(-V, Lh) * 0.5 + 0.5, 0.0, 1.0), 4.0);
    // thin water near the tops of the short wind waves, backlit; strongest with a low sun
    float crest = smoothstep(0.2, 1.8, vCrest.x);
    float face = pow(1.0 - nv, 2.0);
    // the big swells: light through the thin, steep upper part of a wave face
    float big = smoothstep(0.9, 2.6, vCrest.y) * smoothstep(0.85, 0.4, J) * face * 2.0;
    crest = max(crest, big);
    float sunUp = smoothstep(-0.05, 0.2, uSunDir.y);
    float lowSun = mix(1.0, 0.45, smoothstep(0.3, 0.8, uSunDir.y));
    float sss = crest * toward * (0.25 + face * 1.6) * sunUp * lowSun * mix(0.35, 1.0, shadow);
    sss *= (1.0 - farK);
    // light scattered up from inside the water dims under island and cloud shade
    vec3 body = (uSeaBody * (0.75 + 0.5 * pow(1.0 - nv, 3.0)) + uSeaScatter * sss) * mix(0.6, 1.0, shadow);

    float Tf = 1.0 - F;
    vec3 S = env * F + spec;
    float f = airFogAmount(P);
    vec3 C = fogColorFor(-V);
    col = (S + Tf * body * (1.0 - e)) * (1.0 - f) + C * f * (1.0 - Tf * e) + Tf * e * Rf;

    // ---- foam ---------------------------------------------------------------------------------
    vec2 wd = uWindDir;
    vec2 wa = vec2(dot(p, wd), dot(p, vec2(-wd.y, wd.x)));
    float bub1 = texture2D(uNoise, (p + uDrift * 0.08) / 9.0).g;
    float bub2 = texture2D(uNoise, (p - uDrift * 0.05) / 3.1 + 0.37).g;
    float lace = texture2D(uNoise, (p + uDrift * 0.06) / 23.0).r;
    float bub3 = texture2D(uNoise, (p + uDrift * 0.03) / 1.15 + 0.71).g;
    float near = 1.0 - smoothstep(12.0, 45.0, dist);
    float bubbles = mix(bub1 * 0.6 + bub2 * 0.4, bub1 * 0.45 + bub2 * 0.3 + bub3 * 0.25, near);
    // whitecaps and the lace they leave behind
    float cover = crestFoam * uFoamCtl.x;
    // storm streaks along the wind
    float streak = texture2D(uNoise, vec2(wa.x / 140.0, wa.y / 9.0) + uDrift / 900.0).b;
    streak = smoothstep(0.55, 0.85, streak) * smoothstep(0.35, 0.75, lace) * uFoamCtl.y;
    cover += streak * 0.6 + simFoam + wakeArm * 0.6;
    // where the sea meets rock, whales and fish at the surface
    float shore = 0.0;
    if (!open) {
      float wz = max(sceneZ - surfZ, 0.0);
      float churn = texture2D(uNoise, p / 4.3 + vec2(uTime * 0.03, -uTime * 0.021)).g;
      shore = smoothstep(0.55, 0.0, wz) * (0.4 + 0.6 * churn) * uFoamCtl.z;
      cover += shore;
    }
    // coverage eats into the bubble pattern: sparse specks, then lace, then solid foam
    float pat = clamp((bubbles * 0.6 + lace * 0.4 - 0.3) * 2.0, 0.0, 1.0);
    float thr = 1.0 - min(cover, 1.2);
    float foamA = smoothstep(thr - 0.12, thr + 0.06, pat) * smoothstep(0.0, 0.12, cover);
    // far away the lace is below a pixel: show its average cover instead of sparkling specks
    float farFoam = smoothstep(60.0, 500.0, dist);
    foamA = mix(foamA, clamp(cover * 0.75, 0.0, 0.9), farFoam);
    foamA = clamp(foamA, 0.0, 1.0) * (1.0 - farK * 0.6);
    vec3 foamLit = uSunColor * (max(dot(N, uSunDir), 0.0) * 0.8 + 0.2) * mix(0.35, 1.0, shadow) + uSkyAmbient * 0.9;
    foamLit += uMoonColor * uNight * 0.5;
    vec3 foamCol = foamLit * mix(0.78, 0.95, bub2);
    // churned water full of bubbles glows pale turquoise around and under the foam
    float aer = smoothstep(0.04, 0.7, cover) * (1.0 - foamA) * (1.0 - farK);
    col += (uSeaScatter * 1.6 + uSkyAmbient * 0.12) * mix(0.4, 1.0, shadow) * aer * 0.55 * (1.0 - f);
    col = mix(col, foamCol * (1.0 - f) + C * f, foamA);
    dbg = vec4(foamA, cover, pat, 0.0);

    // night: plankton flare where the water is churned
    // (sparkly: countless single cells flashing, not a smooth neon)
    float glow = (simGlow * 0.8 + crestFoam * 0.2 + shore * 0.4 + simFoam * 0.2 + wakeArm * 0.3) * uWaterParams.z;
    float sparkle = 0.25 + 1.6 * pow(bub3 * 0.5 + bub2 * 0.5, 3.0) + 0.6 * pow(bub1, 4.0);
    col += vec3(0.06, 0.5, 0.9) * min(glow, 1.5) * sparkle * (1.0 - f);
    // and a sparse field of single motes blinking as the swell lifts them
    if (uWaterParams.z > 0.01 && dist < 90.0) {
      vec2 cp = p * 1.7;
      vec2 ci = floor(cp);
      vec2 o = hash22(ci);
      float on = step(0.93, o.x);
      vec2 dd = fract(cp) - (0.2 + o * 0.6);
      float blink = pow(max(sin(uTime * (0.6 + o.y * 1.5) + o.x * 40.0 + vDispY * 3.0), 0.0), 6.0);
      float mote = on * exp(-dot(dd, dd) * 900.0) * blink * (1.0 - smoothstep(30.0, 90.0, dist));
      col += vec3(0.15, 0.7, 1.0) * mote * uWaterParams.z * 0.9 * (1.0 - f);
    }

    // far: blend to exactly what the sky dome draws beyond the mesh
    if (farK > 0.001) {
      vec3 far = seaFarColor(-V);
      far = far * (1.0 - f) + C * f;
      col = mix(col, far, farK);
    }
  } else {
    // ================================ seen from below ================================
    vec3 Nd = -N;
    vec3 I = -V;
    vec3 T = refract(I, Nd, 1.333);
    float cosI = max(dot(V, Nd), 0.0);
    bool tir = dot(T, T) < 1e-4;
    float F = tir ? 1.0 : seaFresnel(max(T.y, 0.0));
    vec3 Tp = exp(-uWaterAbsorb * dist);
    vec3 fogc = waterFogColor(I, max(uSeaLevel - P.y, 0.0) * 0.5 + max(uSeaLevel - uCamPos.y, 0.0) * 0.5);
    vec3 through = vec3(0.0);
    if (!tir) {
      // through the window: the scene above, displaced by the tilt of the surface
      vec3 Tv = mat3(viewMatrix) * vec3(N.x, 0.0, N.z);
      vec2 eg = smoothstep(0.0, 0.06, suv) * smoothstep(1.0, 0.94, suv);
      vec2 ruv = clamp(suv - Tv.xy * 0.25 * eg.x * eg.y, vec2(0.0005), vec2(0.9995));
      float rz = sceneDepthAt(ruv);
      if (rz > uNearFar.y * 0.95 || rz < surfZ) {
        vec3 sky = skyEnv(normalize(vec3(T.x, max(T.y, 0.0), T.z)), 0.5);
        sky += uSunColor * pow(max(dot(T, uSunDir), 0.0), 900.0) * 30.0 * (1.0 - uStorm);
        sky += uSunColor * pow(max(dot(T, uSunDir), 0.0), 40.0) * 0.6 * (1.0 - uStorm);
        through = sky * Tp + fogc * (1.0 - Tp);
      } else {
        through = texture2D(uSceneTex, ruv).rgb;
      }
    }
    // outside Snell's window the surface is a rippled silvery mirror of the lit water below
    vec3 Rd = reflect(I, Nd);
    vec3 below = waterFogColor(Rd, max(uSeaLevel - P.y, 0.0) + 4.0) * 1.15;
    // the ripples on the underside catch the light
    below *= 1.0 + 0.8 * smoothstep(0.02, 0.3, length(N.xz));
    below = below * Tp + fogc * (1.0 - Tp);
    col = through * (1.0 - F) + below * F;
    float foamU = clamp(crestFoam * uFoamCtl.x + simFoam, 0.0, 1.0);
    col = mix(col, fogc * 0.6 + uWaterTint * 0.4, foamU * 0.5);
    col += vec3(0.08, 0.55, 0.85) * (simGlow + crestFoam * 0.2) * uWaterParams.z * 0.6;
  }
  if (uDebug == 1) col = vec3(crestFoam, simFoam, 0.0);
  else if (uDebug == 2) col = vec3(Jt * 0.5, J * 0.5, 0.0);
  else if (uDebug == 3) col = N * 0.5 + 0.5;
  else if (uDebug == 4) col = vec3(sqrt(s2) * 4.0, patchy * 0.5, vCrest.x * 0.25 + 0.5);
  else if (uDebug == 5) col = vec3(vDispY * 0.1 + 0.5);
  else if (uDebug == 6) col = dbg.xyz;
  else if (uDebug == 7) col = vec3(simH * 2.0 + 0.5, simFoam, simGlow);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------------------------------
/** Camera-centred radial grid: square cells whose size grows with distance. */
function buildGrid(nTheta, minStep, maxR) {
  const radii = [0];
  const g = TAU / nTheta;
  let r = 0;
  while (r < maxR) {
    r += Math.max(minStep, r * g);
    radii.push(Math.min(r, maxR));
  }
  const nr = radii.length;
  const pos = new Float32Array((1 + (nr - 1) * nTheta) * 3);
  const spc = new Float32Array(1 + (nr - 1) * nTheta);
  spc[0] = minStep;
  let v = 1;
  for (let i = 1; i < nr; i++) {
    const rr = radii[i];
    const dr = rr - radii[i - 1];
    const off = (i & 1) * 0.5;
    for (let j = 0; j < nTheta; j++) {
      const th = ((j + off) / nTheta) * TAU;
      pos[v * 3] = Math.cos(th) * rr;
      pos[v * 3 + 2] = Math.sin(th) * rr;
      spc[v] = Math.max(dr, rr * g);
      v++;
    }
  }
  const idx = [];
  for (let j = 0; j < nTheta; j++) idx.push(0, 1 + ((j + 1) % nTheta), 1 + j);
  for (let i = 1; i < nr - 1; i++) {
    const a0 = 1 + (i - 1) * nTheta, b0 = 1 + i * nTheta;
    const odd = i & 1; // ring i is rotated by half a cell when odd; ring i+1 the other way
    for (let j = 0; j < nTheta; j++) {
      const j1 = (j + 1) % nTheta;
      const a = a0 + j, a1 = a0 + j1;
      if (odd) {
        // inner ring shifted +half: inner j sits between outer j and j+1
        const b = b0 + j1, bb = b0 + j;
        idx.push(a, b, bb, a, a1, b);
      } else {
        const b = b0 + j, b1 = b0 + j1;
        idx.push(a, b1, b, a, a1, b1);
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aSpacing', new Float32BufferAttribute(spc, 1));
  geo.setIndex(new Uint32BufferAttribute(new Uint32Array(idx), 1));
  geo.boundingSphere = null;
  return geo;
}

function floatTarget(size, opts = {}) {
  const rt = new WebGLRenderTarget(size, size, Object.assign({
    type: HalfFloatType, format: RGBAFormat, depthBuffer: false, stencilBuffer: false,
    minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false,
    wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping,
  }, opts));
  return rt;
}

// ------------------------------------------------------------------------------------------
export class Ocean {
  constructor(game, opts = {}) {
    this.game = game;
    this.engine = game.engine;
    this.level = 0;
    this.enabled = true;
    this.time = 0;
    this._lastT = null;
    // sea state: explicit (setSeaState) or following the atmosphere preset
    this.state = 0.3;
    this._from = 0.3;
    this._to = 0.3;
    this._t = 1;
    this._dur = 1;
    this.auto = true;
    this.windDir = WIND0;
    this.underwater = 0;
    this.camSurface = 0;
    this.quality = 1;
    this.shelters = [];
    this._sources = [];
    this._noise = getNoiseTexture();
    this._v = new Vector3();
    this._v2 = new Vector3();
    this._d = { x: 0, y: 0, z: 0, hx: 0, hz: 0, dxx: 0, dzz: 0, dxz: 0 };

    this._buildWaves(opts.seed ?? 7);
    this._buildCascades();
    this._buildSim();
    this._buildSurface();

    // the sky dome renders an environment map of itself for reflections (created on first use,
    // so the ocean may be built before or after the sky)
    this.envRT = new WebGLRenderTarget(512, 128, {
      type: HalfFloatType, format: RGBAFormat, depthBuffer: false, generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: ClampToEdgeWrapping,
    });
    this.envPass = null;

    // compatibility with the cloud sea's call sites (Game, Weather, Story set these)
    this.uniforms.uSeaOffset = { value: new Vector2() };
    this.uniforms.uTrailOn = { value: 0 };
    this.uniforms.uStormDark = { value: 0 };
    this.uniforms.uSteps = { value: 48 };

    this._hook = (cam) => this._beforeRender(cam);
    this.engine.beforeRender.push(this._hook);
    this.setQuality(opts.quality ?? 1);
    this.updateSpectrum(true);
  }

  // ------------------------------------------------------------------ wave set
  _buildWaves(seed) {
    const r = rng(seed);
    this.cascades = [];
    for (let ci = 0; ci < CASCADES.length; ci++) {
      const c = CASCADES[ci];
      const kLo = TAU / c.lmax, kHi = TAU / c.lmin;
      const cr = Math.cos(c.rot), sr = Math.sin(c.rot);
      const lnK = Math.log(kHi / kLo);
      const seen = new Set();
      const waves = [];
      const nSw = ci === 0 ? 10 : 0;
      const nMain = c.n - nSw;
      const kS = TAU / SWELL_LAMBDA;
      const pdfMain = (k, th) => {
        const dth = wrapAngle(th - WIND0);
        const q = 0.72 * Math.exp(-0.5 * (dth / 0.7) ** 2) / (0.7 * Math.sqrt(TAU)) + 0.28 / TAU;
        return (1 / (k * lnK)) * q / k;
      };
      const pdfSw = (k, th) => {
        const dth = wrapAngle(th - SWELL_DIR);
        const q = Math.exp(-0.5 * (dth / 0.22) ** 2) / (0.22 * Math.sqrt(TAU));
        const pk = Math.exp(-0.5 * ((k - kS) / (0.22 * kS)) ** 2) / (0.22 * kS * Math.sqrt(TAU));
        return pk * q / k;
      };
      let tries = 0;
      while (waves.length < c.n && tries++ < 4000) {
        const sw = waves.length < nSw;
        let k, th;
        if (sw) {
          k = kS * (1 + r.gauss() * 0.22);
          th = SWELL_DIR + r.gauss() * 0.22;
        } else {
          k = kLo * Math.pow(kHi / kLo, r());
          th = r() < 0.72 ? WIND0 + r.gauss() * 0.7 : r() * TAU;
        }
        const kx = Math.sin(th) * k, kz = Math.cos(th) * k;
        // tile space (u = R x): snap to the lattice so the tile is exactly periodic
        const tdx = cr * kx + sr * kz, tdz = -sr * kx + cr * kz;
        const m = Math.round((tdx * c.L) / TAU), n = Math.round((tdz * c.L) / TAU);
        if (m === 0 && n === 0) continue;
        const key = m * 4096 + n;
        if (seen.has(key)) continue;
        const qdx = (m * TAU) / c.L, qdz = (n * TAU) / c.L;
        const qk = Math.hypot(qdx, qdz);
        if (!sw && (qk < kLo * 0.98 || qk > kHi * 1.02)) continue;
        if (sw && (qk < kLo * 0.98 || qk > kHi * 1.02)) continue;
        seen.add(key);
        // back to world space
        const wx = cr * qdx - sr * qdz, wz = sr * qdx + cr * qdz;
        const wth = Math.atan2(wx, wz);
        const pdf = (nMain * pdfMain(qk, wth) + nSw * pdfSw(qk, wth)) / c.n;
        waves.push({
          tx: qdx, tz: qdz, kx: wx, kz: wz, k: qk, th: wth,
          area: 1 / (c.n * pdf), omega: Math.sqrt(GRAV * qk), phi0: r() * TAU,
          aw: 0, as: 0, A: 0,
        });
      }
      const res = c.res;
      this.cascades.push({
        def: c, waves, res, cos: cr, sin: sr,
        uW: new Float32Array(MAXW * 4), uK: new Float32Array(MAXW * 4),
        texel: c.L / res,
      });
    }
  }

  /** Re-weight every wave for the current sea state and wind (phase-continuous). */
  updateSpectrum(force = false) {
    const s = this.state;
    const wd = this.windDir;
    if (!force && Math.abs(s - (this._specS ?? -1)) < 1e-4 && Math.abs(wd - (this._specW ?? 99)) < 2e-3) return;
    this._specS = s;
    this._specW = wd;
    const Hs = keyed(HS, s), Tp = keyed(TP, s), Hsw = keyed(HSW, s);
    const kp = (TAU / Tp) ** 2 / GRAV;
    const kS = TAU / SWELL_LAMBDA;
    const sPeak = lerp(3, 7, s);
    let mw = 0, ms = 0;
    for (const c of this.cascades) {
      for (const w of c.waves) {
        const k = w.k;
        // Pierson-Moskowitz in wavenumber with a mild JONSWAP peak
        const x = kp / k;
        let F = Math.pow(k, -3) * Math.exp(-1.25 * x * x);
        const sig = k < kp ? 0.07 : 0.09;
        F *= Math.pow(2.2, Math.exp(-((Math.sqrt(k / kp) - 1) ** 2) / (2 * sig * sig)));
        // short waves spread wider than the peak (Mitsuyasu)
        const sp = k > kp ? Math.max(1.2, sPeak * Math.pow(k / kp, -1.0)) : sPeak;
        const dth = wrapAngle(w.th - wd);
        const D = Math.pow(Math.max(Math.cos(dth * 0.5), 0), 2 * sp) * Math.sqrt(sp) * (1 + 1 / (8 * sp)) / (2 * Math.sqrt(Math.PI));
        w.aw = (2 * F * D / k) * w.area;
        const dsw = wrapAngle(w.th - SWELL_DIR);
        const Ds = Math.pow(Math.max(Math.cos(dsw * 0.5), 0), 48);
        const Fs = Math.exp(-0.5 * ((k - kS) / (0.16 * kS)) ** 2);
        w.as = (2 * Fs * Ds / k) * w.area;
        mw += w.aw * 0.5;
        ms += w.as * 0.5;
      }
    }
    const sw = mw > 0 ? (Hs / 4) ** 2 / mw : 0;
    const ss = ms > 0 ? (Hsw / 4) ** 2 / ms : 0;
    let slopeVar = 0, m0 = 0;
    const active = this._active || (this._active = []);
    active.length = 0;
    for (let ci = 0; ci < this.cascades.length; ci++) {
      const c = this.cascades[ci];
      for (const w of c.waves) {
        w.A = Math.sqrt(Math.max(w.aw * sw + w.as * ss, 0));
        slopeVar += (w.A * w.k) ** 2 * 0.25;
        m0 += w.A * w.A * 0.5;
        if (c.def.disp && w.A > 0.003) active.push(w);
      }
    }
    active.sort((a, b) => b.A - a.A);
    this._specV = (this._specV || 0) + 1;
    this.chop = keyed(CHOP, s);
    this.foamJ = keyed(FOAMJ, s);
    // each cascade breaks at its share of the whole sea's compression
    let sigT = 0, m12 = 0, m01 = 0;
    for (const c of this.cascades) {
      let v = 0;
      for (const w of c.waves) v += (w.A * w.k) ** 2 * 0.5;
      c.sig = c.def.disp ? this.chop * Math.sqrt(v) : 0;
      sigT += c.sig * c.sig;
      if (c.def.disp && c.def.L < 100) for (const w of c.waves) m12 += w.A * w.A * 0.5;
      else if (c.def.disp) for (const w of c.waves) m01 += w.A * w.A * 0.5;
    }
    sigT = Math.sqrt(sigT);
    for (const c of this.cascades) c.foamJ = 1 - (1 - this.foamJ) * (sigT > 0 ? c.sig / sigT : 1);
    if (this.uniforms) {
      this.uniforms.uCrestNorm.value.set(1 / Math.max(Math.sqrt(m12), 0.01), 1 / Math.max(Math.sqrt(m01), 0.05));
      this.uniforms.uFoamJ.value.set(this.foamJ, 2.5);
    }
    this.rms = Math.sqrt(m0);
    this.Hs = Hs;
    // capillary ripples below the smallest cascade
    const wind = this.game.wind?.strength ?? 3;
    this.capVar = lerp(0.0004, 0.0035, smoothstep(0, 0.7, s)) * (0.6 + 0.4 * clamp(wind / 8, 0, 1.5));
    this.slopeVar = slopeVar + this.capVar;
    G.uSeaFar.value.set(this.slopeVar, keyed([0, 0.002, 0.03, 0.22], s), this.rms, 0);
    G.uSeaState.value = s;
    G.uWaterParams.value.w = Math.max(0.25, this.rms * 2.2);
  }

  // ------------------------------------------------------------------ GPU passes
  _buildCascades() {
    this.casMats = [];
    for (const c of this.cascades) {
      const detail = !c.def.disp;
      const mk = () => floatTarget(c.res, {
        count: detail ? 1 : 3, generateMipmaps: true, minFilter: LinearMipmapLinearFilter,
        wrapS: RepeatWrapping, wrapT: RepeatWrapping,
      });
      c.rt = [mk(), mk()];
      for (const rt of c.rt) for (const t of rt.textures) t.anisotropy = 8;
      c.cur = 0;
      const mat = new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: FS_VERT,
        fragmentShader: CASCADE_FRAG,
        defines: detail ? { DETAIL: '' } : {},
        uniforms: {
          uW: { value: c.uW }, uK: { value: c.uK }, uN: { value: c.waves.length }, uL: { value: c.def.L },
          uChop: { value: 1 }, uPrev: { value: null }, uDecay: { value: 0.9 }, uFoamJ: { value: new Vector2(0.3, 3) },
        },
      });
      c.pass = new FullscreenPass(mat);
    }
  }

  _buildSim() {
    this.simRes = 512;
    this.simSize = 300;
    const mk = () => floatTarget(this.simRes);
    this.simRT = [mk(), mk()];
    this.simCur = 0;
    this.simCenter = new Vector2(1e9, 1e9);
    this.simU = {
      uPrev: { value: null }, uTexel: { value: new Vector2(1 / this.simRes, 1 / this.simRes) },
      uShift: { value: new Vector2() }, uDt: { value: 1 / 60 }, uAlpha: { value: 0.1 }, uDamp: { value: 0.999 },
      uFoamDecay: { value: 0.99 }, uGlowDecay: { value: 0.97 },
      uSrc: { value: Array.from({ length: 16 }, () => new Vector4()) },
      uSrcB: { value: Array.from({ length: 16 }, () => new Vector4()) },
      uSrcN: { value: 0 }, uFoamGen: { value: 0.02 }, uCell: { value: this.simSize / this.simRes },
    };
    this.simPass = new FullscreenPass({ vertexShader: FS_VERT, fragmentShader: SIM_FRAG, uniforms: this.simU });
    this._simCleared = false;
  }

  _buildSurface() {
    const c = this.cascades;
    this.uniforms = Object.assign({}, G, {
      uCenter: { value: new Vector2() },
      uA0: { value: null }, uA1: { value: null }, uA2: { value: null },
      uB0: { value: null }, uB1: { value: null }, uB2: { value: null },
      uC0: { value: null }, uC1: { value: null }, uC2: { value: null }, uD3: { value: null },
      uCas: { value: c.map((cc) => new Vector4(cc.cos / cc.def.L, cc.sin / cc.def.L, cc.texel, 0)) },
      uSim: { value: null }, uSimXf: { value: new Vector4(0, 0, this.simSize, 0) },
      uShelter: { value: Array.from({ length: 8 }, () => new Vector4()) }, uShelterN: { value: 0 },
      uNoise: { value: this._noise },
      uProj: { value: new Matrix4() },
      uOcean: { value: new Vector4(0.002, 0.6, 0.5, 20) },
      uFoamCtl: { value: new Vector4(1, 0, 1, 5000) },
      uWindDir: { value: new Vector2(Math.sin(WIND0), Math.cos(WIND0)) },
      uDrift: { value: new Vector2() },
      uMeshEdge: { value: 7600 },
      uCrestNorm: { value: new Vector2(1, 1) },
      uFoamJ: { value: new Vector2(0.3, 3) },
      uDebug: { value: 0 },
      uRings: { value: Array.from({ length: 8 }, () => new Vector4(0, 0, -99, 0)) },
      uWakeP: { value: Array.from({ length: 64 }, () => new Vector4()) },
      uWakeB: { value: Array.from({ length: 4 }, () => new Vector4()) },
      uWakeN: { value: new Vector4() },
    });
    // wake trails of things moving at the surface (matched frame to frame by position)
    this.trails = Array.from({ length: 4 }, () => ({
      pts: Array.from({ length: 16 }, () => ({ x: 0, z: 0, t: -99, v: 0 })), n: 0, seen: -99, width: 2,
    }));
    this.material = new ShaderMaterial({
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
      uniforms: this.uniforms,
      side: DoubleSide,
      depthWrite: true,
      depthTest: true,
      transparent: false,
      blending: NoBlending,
    });
    this.meshEdge = 7600;
    this.geos = {};
    this.mesh = new Mesh(this._grid(320), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.mesh.name = 'ocean';
    this.engine.sceneT.add(this.mesh);
  }

  _grid(n) {
    if (!this.geos[n]) this.geos[n] = buildGrid(n, n >= 320 ? 0.3 : n >= 256 ? 0.4 : 0.55, this.meshEdge);
    return this.geos[n];
  }

  /** 0..1 like the old cloud sea: mesh density, reflections, cascade work. */
  setQuality(q) {
    this.quality = q;
    const n = q >= 0.9 ? 320 : q >= 0.7 ? 256 : 192;
    if (this.mesh.geometry !== this._grid(n)) this.mesh.geometry = this._grid(n);
    this.uniforms.uOcean.value.w = q >= 0.9 ? 16 : q >= 0.7 ? 11 : 0;
  }

  // ------------------------------------------------------------------ public API
  /** Current (eased) sea state 0..1. */
  get seaState() { return this.state; }

  /** 0 glassy .. 0.3 calm .. 0.6 lively .. 1 storm, eased over dur seconds. Null: follow the sky. */
  setSeaState(k, { dur = 6 } = {}) {
    if (k === null || k === undefined) {
      this.auto = true;
      return;
    }
    this.auto = false;
    this._ease(clamp(k, 0, 1), dur);
  }

  _ease(k, dur) {
    if (Math.abs(k - this._to) < 1e-4) return;
    this._from = this.state;
    this._to = k;
    this._t = 0;
    this._dur = Math.max(0.01, dur);
  }

  /** Sheltered water (lagoons inside atolls): waves fade toward the centre. */
  shelter(x, z, radius, strength = 0.85) {
    if (this.shelters.length >= 8) return;
    this.shelters.push(new Vector4(x, z, radius, clamp(strength, 0, 1)));
    this._syncShelters();
  }

  clearShelters() {
    this.shelters.length = 0;
    this._syncShelters();
  }

  _syncShelters() {
    const u = this.uniforms.uShelter.value;
    for (let i = 0; i < 8; i++) {
      if (i < this.shelters.length) u[i].copy(this.shelters[i]);
      else u[i].set(0, 0, 0, 0);
    }
    this.uniforms.uShelterN.value = this.shelters.length;
  }

  _shelterAt(x, z) {
    let f = 1;
    for (const s of this.shelters) {
      const d = Math.hypot(x - s.x, z - s.y);
      f *= 1 - s.w * smoothstep(s.z, s.z * 0.55, d);
    }
    return f;
  }

  /** Displacement and derivatives of the displacing cascades at a tile (Lagrangian) point. */
  _eval(x, z, t, deriv, count = Infinity) {
    const d = this._d;
    if (t !== this._phT || this._phV !== this._specV) this._packActive(t);
    const KX = this._aKx, KZ = this._aKz, AM = this._aA, PH = this._aPh, QX = this._aQx, QZ = this._aQz;
    let dx = 0, dy = 0, dz = 0, hx = 0, hz = 0, dxx = 0, dzz = 0, dxz = 0;
    const n = Math.min(this._aN, count);
    if (deriv) {
      for (let i = 0; i < n; i++) {
        const kx = KX[i], kz = KZ[i];
        const th = kx * x + kz * z + PH[i];
        const s = Math.sin(th), c = Math.cos(th);
        const A = AM[i], qx = QX[i], qz = QZ[i];
        dy += A * c;
        dx -= qx * s;
        dz -= qz * s;
        hx -= A * kx * s;
        hz -= A * kz * s;
        dxx -= qx * kx * c;
        dzz -= qz * kz * c;
        dxz -= qx * kz * c;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const th = KX[i] * x + KZ[i] * z + PH[i];
        const s = Math.sin(th);
        dy += AM[i] * Math.cos(th);
        dx -= QX[i] * s;
        dz -= QZ[i] * s;
      }
    }
    d.x = dx; d.y = dy; d.z = dz; d.hx = hx; d.hz = hz; d.dxx = dxx; d.dzz = dzz; d.dxz = dxz;
    return d;
  }

  /** Flat arrays of the displacing waves with their phases at time t (fast CPU evaluation). */
  _packActive(t) {
    const act = this._active;
    const n = act.length;
    if (!this._aKx || this._aKx.length < n) {
      const m = Math.max(n, 256);
      this._aKx = new Float64Array(m); this._aKz = new Float64Array(m); this._aA = new Float64Array(m);
      this._aPh = new Float64Array(m); this._aQx = new Float64Array(m); this._aQz = new Float64Array(m);
    }
    const ch = this.chop;
    for (let i = 0; i < n; i++) {
      const w = act[i];
      this._aKx[i] = w.kx;
      this._aKz[i] = w.kz;
      this._aA[i] = w.A;
      this._aPh[i] = (w.phi0 - w.omega * t) % TAU;
      const q = (ch * w.A) / w.k;
      this._aQx[i] = q * w.kx;
      this._aQz[i] = q * w.kz;
    }
    this._aN = n;
    this._phT = t;
    this._phV = this._specV;
  }

  /** Find the tile point whose displaced position lands on (x, z) (Newton on p + D(p) = x).
   *  The strongest waves steer the solve; returns the last (strong-wave) slopes in _d. */
  _lagrange(x, z, t, n = this.state > 0.7 ? 80 : 40) {
    let px = x, pz = z;
    const sheltered = this.shelters.length > 0;
    let d = null;
    for (let it = 0; it < 5; it++) {
      d = this._eval(px, pz, t, true, n);
      const sh = sheltered ? this._shelterAt(px, pz) : 1;
      const fx = px + d.x * sh - x, fz = pz + d.z * sh - z;
      if (Math.abs(fx) + Math.abs(fz) < 0.002) break;
      const a = 1 + d.dxx * sh, b = d.dxz * sh, c = 1 + d.dzz * sh;
      let det = a * c - b * b;
      if (det < 0.25) {
        // near a fold the Jacobian is unreliable: damped fixed-point step instead
        px -= fx * 0.6;
        pz -= fz * 0.6;
      } else {
        det = 1 / det;
        px -= (c * fx - b * fz) * det;
        pz -= (a * fz - b * fx) * det;
      }
    }
    this._lx = px;
    this._lz = pz;
    this._shx = d.hx;
    this._shz = d.hz;
  }

  /** Sea surface height at a world point, now (matches the rendered waves to a few cm). */
  heightAt(x, z, t = G.uTime.value) {
    this._lagrange(x, z, t);
    const px = this._lx, pz = this._lz;
    // one Newton step with every wave, and the height carried along it to first order
    const d = this._eval(px, pz, t, true);
    const sh = this.shelters.length ? this._shelterAt(px, pz) : 1;
    const fx = px + d.x * sh - x, fz = pz + d.z * sh - z;
    const a = 1 + d.dxx * sh, b = d.dxz * sh, c = 1 + d.dzz * sh;
    const det = a * c - b * b;
    let ux = 0, uz = 0;
    if (det > 0.2) {
      ux = -(c * fx - b * fz) / det;
      uz = -(a * fz - b * fx) / det;
    }
    return this.level + (d.y + d.hx * ux + d.hz * uz) * sh;
  }

  /** Surface normal at a world point. */
  normalAt(x, z, out = new Vector3()) {
    const t = G.uTime.value;
    this._lagrange(x, z, t);
    const d = this._eval(this._lx, this._lz, t, true);
    const sh = this.shelters.length ? this._shelterAt(this._lx, this._lz) : 1;
    const hx = d.hx * sh, hz = d.hz * sh, dxx = d.dxx * sh, dzz = d.dzz * sh, dxz = d.dxz * sh;
    const jx = Math.max(1 + dxx, 0.15), jz = Math.max(1 + dzz, 0.15);
    const J = Math.max(jx * jz - dxz * dxz, 0.05);
    return out.set(hz * dxz - hx * jz, J, dxz * hx - hz * jx).normalize();
  }

  /** Vertical speed of the surface at a world point (floating things bob with it). */
  riseAt(x, z) {
    const e = 0.05;
    return (this.heightAt(x, z, G.uTime.value + e) - this.heightAt(x, z)) / e;
  }

  /**
   * Foam ring + spray + wave ring (whale lunges, breaches, slaps). strength ~0.2..3.
   * dir (optional, any Vector3-like): throws the spray that way, e.g. a tail or fin slap.
   */
  splash(pos, strength = 1, radius = 4, dir = null) {
    const s = clamp(strength, 0, 4);
    // ring trains (analytic) for real impacts; small, constant splashes (falls, spray) only
    // touch the sheet. A new train takes the slot whose ring has faded most.
    if (s >= 0.35) {
      const rings = this.uniforms.uRings.value;
      const now = G.uTime.value;
      let slot = rings[0], best = Infinity;
      for (const rg of rings) {
        const left = rg.w * Math.max(0, 1 - (now - rg.z) / 9);
        if (left < best) { best = left; slot = rg; }
      }
      slot.set(pos.x, pos.z, now, Math.min(s, 3) * Math.sqrt(Math.max(radius, 1) / 4));
    }
    // a crater that rebounds into ring waves, ringed by a raised lip, and a sheet of foam
    this._addSource(pos.x, pos.z, radius, -0.55 * s, 0.6 * s, 1.4 * s, 0);
    this._addSource(pos.x, pos.z, radius * 1.5, 0.22 * s, 0.5 * s, 0.5 * s, 1);
    this._spray(pos, s, radius, 1, dir);
  }

  /** A quick height (strongest waves only, ~0.1-0.3 m): for effects, not for physics. */
  heightApprox(x, z) {
    const t = G.uTime.value;
    let px = x, pz = z, d = null;
    for (let it = 0; it < 2; it++) {
      d = this._eval(px, pz, t, false, 24);
      px = x - d.x;
      pz = z - d.z;
    }
    d = this._eval(px, pz, t, false, 24);
    return this.level + d.y * (this.shelters.length ? this._shelterAt(px, pz) : 1);
  }

  /** Per-frame wake of something moving at (or just under) the surface. */
  wake(pos, vel, width = 2) {
    const h = this.heightApprox(pos.x, pos.z);
    const depth = h - pos.y; // >0 below the surface
    const near = smoothstep(width * 1.6, 0, Math.abs(depth + width * 0.15));
    if (near <= 0.001) return;
    const sp = Math.hypot(vel.x, vel.z);
    const dt = this._frameDt || 1 / 60;
    const k = near * clamp(sp / 6, 0, 2.5);
    if (sp > 1.5 && near > 0.2) this._trail(pos.x, pos.z, sp, width);
    // hull depression (its rebound draws the V wake), churned foam and plankton glow along the track
    this._addSource(pos.x, pos.z, width * 0.75, -0.5 * near * clamp(sp / 4, 0.3, 1.5), 2.2 * k * dt, 5 * k * dt, 2, true);
    if (sp > 7 && near > 0.5 && Math.random() < dt * sp * 0.25) {
      this._v.set(pos.x + vel.x * 0.08, h + 0.2, pos.z + vel.z * 0.08);
      this._spray(this._v, 0.25 * clamp(sp / 12, 0, 1.5), width * 0.6, 0);
    }
  }

  /** A reused position for particle emission (Particles.emit copies it at once). */
  _tp(x, y, z) {
    const p = this._tpos || (this._tpos = { x: 0, y: 0, z: 0 });
    p.x = x; p.y = y; p.z = z;
    return p;
  }

  /** Extend (or start) the wake trail whose head is at this mover. Points are pooled. */
  _trail(x, z, speed, width) {
    const now = G.uTime.value;
    let best = null, bd = Infinity;
    for (const tr of this.trails) {
      if (!tr.n || now - tr.seen > 1.5) continue;
      const h = tr.pts[0];
      const d = Math.hypot(h.x - x, h.z - z);
      if (d < bd) { bd = d; best = tr; }
    }
    if (!best || bd > speed * 0.4 + width + 3) {
      // a new trail replaces the stalest one
      best = this.trails[0];
      for (const tr of this.trails) if (tr.seen < best.seen) best = tr;
      best.n = 2;
      for (let i = 0; i < 2; i++) { const q = best.pts[i]; q.x = x; q.z = z; q.t = now; q.v = speed; }
    }
    best.seen = now;
    best.width = width;
    const pts = best.pts;
    // the head follows the mover; a fixed point is laid every few metres behind it
    const h = pts[0];
    h.x = x; h.z = z; h.t = now; h.v = speed;
    const p1 = pts[1];
    if (Math.hypot(p1.x - x, p1.z - z) > Math.max(3, width * 0.8)) {
      // shift the chain back one slot (the oldest point is recycled)
      const last = pts[15];
      for (let i = 15; i > 1; i--) pts[i] = pts[i - 1];
      pts[1] = last;
      last.x = x; last.z = z; last.t = now; last.v = speed;
      best.n = Math.min(16, best.n + 1);
    }
    while (best.n > 2 && now - pts[best.n - 1].t > 16) best.n--;
  }

  _syncTrails() {
    const u = this.uniforms;
    const P = u.uWakeP.value, B = u.uWakeB.value, N = u.uWakeN.value;
    const now = G.uTime.value;
    for (let i = 0; i < 4; i++) {
      const tr = this.trails[i];
      const live = tr.n >= 2 && now - tr.seen < 14;
      let n = live ? tr.n : 0;
      let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity, len = 0;
      for (let j = 0; j < 16; j++) {
        const v = P[i * 16 + j];
        if (j < n) {
          const q = tr.pts[j];
          v.set(q.x, q.z, q.t, q.v);
          minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x);
          minz = Math.min(minz, q.z); maxz = Math.max(maxz, q.z);
          if (j > 0) len += Math.hypot(q.x - tr.pts[j - 1].x, q.z - tr.pts[j - 1].z);
        } else v.set(0, 0, -99, 0);
      }
      if (n >= 2) {
        const cx = (minx + maxx) * 0.5, cz = (minz + maxz) * 0.5;
        const r = Math.hypot(maxx - minx, maxz - minz) * 0.5 + len * 0.36 + tr.width + 8;
        B[i].set(cx, cz, r, tr.width);
      } else {
        n = 0;
        B[i].set(0, 0, 0, 0);
      }
      N.setComponent(i, n);
    }
  }

  /** Gale-torn spray off breaking crests near the camera (lively seas and storms). */
  _weatherSpray(dt) {
    const s = this.state;
    if (s < 0.5 || !this.game.mist || dt <= 0) return;
    const cam = this.engine.camera.position;
    const wind = this.game.wind?.base;
    const wx = wind ? wind.x : 0, wz = wind ? wind.z : 0;
    const t = G.uTime.value;
    // a few probes per frame; each breaking crest found throws a sheet of spray downwind
    this._sprayAcc = (this._sprayAcc || 0) + dt * lerp(4, 40, smoothstep(0.5, 1, s));
    let tries = Math.min(8, Math.floor(this._sprayAcc));
    this._sprayAcc -= tries;
    const v = this._v2;
    while (tries-- > 0) {
      const a = Math.random() * TAU, r = 15 + Math.random() * 110;
      const x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
      const d = this._eval(x, z, t, true, 60);
      const J = (1 + d.dxx) * (1 + d.dzz) - d.dxz * d.dxz;
      if (J > this.foamJ * 0.8 || d.y < this.rms * 0.6) continue;
      const k = clamp((this.foamJ - J) * 2, 0.2, 1.2);
      const px = x + d.x, pz = z + d.z, py = this.level + d.y;
      for (let i = 0; i < 6; i++) {
        v.set(wx * (0.6 + Math.random() * 0.5) + (Math.random() - 0.5) * 2, 1.5 + Math.random() * 3 * k, wz * (0.6 + Math.random() * 0.5) + (Math.random() - 0.5) * 2);
        this.game.mist.emit({
          pos: this._tp(px + (Math.random() - 0.5) * 4, py + 0.3, pz + (Math.random() - 0.5) * 4), vel: v,
          life: 1.2 + Math.random() * 1.4, size: 0.8 + Math.random() * 1.2, sizeEnd: 3.5 + Math.random() * 3,
          color: [0.92, 0.95, 1.0], alpha: 0.32 * k, drag: 0.7, gravity: 2.5, kind: 0, fadeIn: 0.1,
        });
      }
    }
  }

  /** Specks drifting in the water around a submerged camera: depth and motion cues. */
  _marineSnow(dt) {
    const mist = this.game.mist;
    if (!mist || dt <= 0) return;
    const cam = this.engine.camera.position;
    this._snowAcc = (this._snowAcc || 0) + dt * 45;
    const v = this._v2;
    while (this._snowAcc >= 1) {
      this._snowAcc -= 1;
      const a = Math.random() * TAU, r = 1.5 + Math.random() * 14, y = (Math.random() - 0.5) * 12;
      const py = Math.min(cam.y + y, this.camSurface - 0.3);
      v.set((Math.random() - 0.5) * 0.15, -0.05 - Math.random() * 0.1, (Math.random() - 0.5) * 0.15);
      mist.emit({
        pos: this._tp(cam.x + Math.cos(a) * r, py, cam.z + Math.sin(a) * r), vel: v,
        life: 5 + Math.random() * 4, size: 0.025 + Math.random() * 0.04, sizeEnd: 0.03,
        color: [1, 1, 1], alpha: 0.5 + Math.random() * 0.4, drag: 0.05, gravity: 0, kind: 5, fadeIn: 1.2,
      });
    }
    // drifting plankton: tiny living motes that catch the light (and glow blue-green at night)
    const glow = this.game.glow;
    if (!glow) return;
    const night = G.uNight.value;
    this._plAcc = (this._plAcc || 0) + dt * (6 + 30 * night);
    while (this._plAcc >= 1) {
      this._plAcc -= 1;
      const a = Math.random() * TAU, r = 2 + Math.random() * 12, y = (Math.random() - 0.5) * 10;
      const py = Math.min(cam.y + y, this.camSurface - 0.4);
      v.set((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.25);
      const warm = Math.random() < 0.25;
      glow.emit({
        pos: this._tp(cam.x + Math.cos(a) * r, py, cam.z + Math.sin(a) * r), vel: v,
        life: 3 + Math.random() * 4, size: 0.03 + Math.random() * 0.05, sizeEnd: 0.02,
        color: warm ? [0.9, 0.6, 1.0] : [0.25, 0.95, 0.85], alpha: (0.1 + 0.6 * night) * (0.5 + Math.random() * 0.5),
        drag: 0.1, gravity: 0, kind: 1, fadeIn: 0.8,
      });
    }
    // now and then a stream of bubbles rises from the sea floor below
    this._bubAcc = (this._bubAcc || 0) + dt * 0.6;
    if (this._bubAcc >= 1) {
      this._bubAcc -= 1;
      const a = Math.random() * TAU, r = 4 + Math.random() * 14;
      const bx = cam.x + Math.cos(a) * r, bz = cam.z + Math.sin(a) * r;
      const floor = this.game.story?.world?.seabedAt?.(bx, bz) ?? this.game.ecoFloor?.(bx, bz) ?? cam.y - 12;
      const by = Math.max(floor, cam.y - 16);
      for (let i = 0; i < 10; i++) {
        v.set((Math.random() - 0.5) * 0.15, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.15);
        mist.emit({
          pos: this._tp(bx + (Math.random() - 0.5) * 0.3, by + i * 0.35, bz + (Math.random() - 0.5) * 0.3), vel: v,
          life: 4 + Math.random() * 3, size: 0.03 + Math.random() * 0.06, sizeEnd: 0.08,
          color: [0.9, 1, 1], alpha: 0.7, drag: 0.3, gravity: -0.8, kind: 4, fadeIn: 0.1,
        });
      }
    }
  }

  _addSource(x, z, r, imp, foam, glow, ring, merge = false) {
    if (this._sources.length >= 16) {
      if (!merge) {
        // a splash matters more than a wake: replace the weakest
        let wi = 0;
        for (let i = 1; i < 16; i++) if (Math.abs(this._sources[i].imp) < Math.abs(this._sources[wi].imp)) wi = i;
        this._sources[wi] = { x, z, r, imp, foam, glow, ring };
      }
      return;
    }
    this._sources.push({ x, z, r, imp, foam, glow, ring });
  }

  _spray(pos, s, radius, mistK = 1, dir = null) {
    const g = this.game;
    const mist = g.mist, glow = g.glow;
    if (!mist) return;
    const v = this._v2;
    const n = Math.round(8 + 40 * Math.min(s, 2.5));
    const lit = 0.9;
    // a slap throws a fan of water along dir instead of a crown
    let dx = 0, dz = 0;
    if (dir) {
      const l = Math.hypot(dir.x, dir.z);
      if (l > 1e-4) { dx = dir.x / l; dz = dir.z / l; }
    }
    const fan = dx !== 0 || dz !== 0 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const a = fan ? Math.atan2(dz, dx) + (Math.random() - 0.5) * 1.6 : Math.random() * TAU;
      const rr = Math.sqrt(Math.random()) * radius * 0.8;
      const up = (3 + Math.random() * 7) * Math.sqrt(s) * (fan ? 0.8 : 1);
      const out = (1.5 + Math.random() * 3) * Math.sqrt(s) * (fan ? 2.4 : 1);
      v.set(Math.cos(a) * out, up, Math.sin(a) * out);
      mist.emit({
        pos: this._tp(pos.x + Math.cos(a) * rr, pos.y + 0.2, pos.z + Math.sin(a) * rr), vel: v,
        life: 0.9 + Math.random() * 1.2, size: 0.12 + Math.random() * 0.2, sizeEnd: 0.05,
        color: [lit, lit, lit], alpha: 0.9, drag: 0.25, gravity: 9.8, kind: 3, fadeIn: 0.02,
      });
    }
    // a thin veil of mist over the crown, drifting off downwind
    const m = Math.round((2 + 5 * Math.min(s, 2.5)) * mistK);
    for (let i = 0; i < m; i++) {
      const a = Math.random() * TAU;
      const rr = (0.5 + Math.random() * 0.5) * radius * 0.8;
      v.set(Math.cos(a) * 1.2, (0.8 + Math.random() * 2.2) * Math.sqrt(s), Math.sin(a) * 1.2);
      mist.emit({
        pos: this._tp(pos.x + Math.cos(a) * rr, pos.y + 0.6, pos.z + Math.sin(a) * rr), vel: v,
        life: 1.8 + Math.random() * 1.6, size: radius * 0.25 * Math.sqrt(s), sizeEnd: radius * 0.9 * Math.sqrt(s),
        color: [1, 1, 1], alpha: 0.2, drag: 1.1, gravity: 0.4, kind: 0, fadeIn: 0.1,
      });
    }
    if (glow && G.uWaterParams.value.z > 0.05) {
      const q = Math.round(6 + 14 * Math.min(s, 2));
      for (let i = 0; i < q; i++) {
        const a = Math.random() * TAU;
        v.set(Math.cos(a) * 2, 2 + Math.random() * 4, Math.sin(a) * 2);
        glow.emit({
          pos: this._tp(pos.x + Math.cos(a) * radius * 0.5, pos.y + 0.3, pos.z + Math.sin(a) * radius * 0.5), vel: v,
          life: 0.8 + Math.random(), size: 0.18, sizeEnd: 0.06, color: [0.25, 0.75, 1.0],
          alpha: 0.6 * G.uWaterParams.value.z, drag: 0.4, gravity: 9.8, kind: 1,
        });
      }
    }
  }

  // ------------------------------------------------------------------ frame
  _beforeRender(cam) {
    const t = G.uTime.value;
    const dt = this._lastT === null ? 1 / 60 : clamp(t - this._lastT, 0, 0.25);
    this._lastT = t;
    this._frameDt = dt;
    this.mesh.visible = this.enabled;
    this.update(dt);
    if (!this.enabled) {
      G.uUnderwater.value = 0;
      G.uSkyEnvOn.value = 0;
      this._sources.length = 0;
      return;
    }
    const r = this.engine.renderer;
    const prevRT = r.getRenderTarget();
    this.engine.post?.warmup?.(r);
    // sky environment
    if (!this.envPass) this.envPass = this.game.sky?.createEnvPass?.() || null;
    if (this.envPass) {
      this.envPass.render(r, this.envRT);
      G.uSkyEnv.value = this.envRT.texture;
      G.uSkyEnvOn.value = 1;
    }
    this._renderCascades(r, t, dt);
    this._renderSim(r, cam, dt);
    r.setRenderTarget(prevRT);
    // surface
    const u = this.uniforms;
    u.uCenter.value.set(cam.position.x, cam.position.z);
    u.uProj.value.copy(cam.projectionMatrix);
    this._syncTrails();
    G.uSceneTex.value = this.engine.rt.texture;
  }

  /** Called by the ocean itself before each frame renders (no need to call it from the game). */
  update(dt) {
    if (this._updT === G.uTime.value && dt > 0) return;
    this._updT = G.uTime.value;
    const g = this.game;
    // sea state: eased explicit target, or the atmosphere's preset
    if (this.auto) {
      // the atmosphere already eases between presets; storms build on top of it
      const a = g.atmosphere;
      // a rising gale builds the sea on top of the preset (a slow, smoothed response)
      const gale = smoothstep(5, 15, g.wind?.strength ?? 3) * 0.35;
      this.state = clamp((a?.current?.seaState ?? 0.3) + (a?.stormBoost ?? 0) * 0.6 + gale, 0, 1);
      this._from = this._to = this.state;
      this._t = 1;
    } else if (this._t < 1) {
      this._t = Math.min(1, this._t + dt / this._dur);
      const e = this._t * this._t * (3 - 2 * this._t);
      this.state = lerp(this._from, this._to, e);
    }
    if (g.wind) this.windDir = g.wind.dir;
    this.updateSpectrum();
    const u = this.uniforms;
    const s = this.state;
    u.uWindDir.value.set(Math.sin(this.windDir), Math.cos(this.windDir));
    if (g.wind) u.uDrift.value.set(g.wind.drift.x, g.wind.drift.z);
    u.uOcean.value.x = this.capVar;
    u.uOcean.value.y = lerp(0.5, 0.1, smoothstep(0.2, 0.8, s));
    u.uFoamCtl.value.set(1, smoothstep(0.55, 1.0, s) * 0.9, 1, this.meshEdge * 0.62);
    u.uMeshEdge.value = this.meshEdge;
    if (this.enabled) this._weatherSpray(dt);
    if (this.enabled && this.underwater > 0.5) this._marineSnow(dt);
    // camera submersion
    const cam = this.engine.camera.position;
    const h = this.enabled ? this.heightAt(cam.x, cam.z) : -1e9;
    this.camSurface = h;
    const und = this.enabled ? smoothstep(0.12, -0.12, cam.y - h) : 0;
    this.underwater = und;
    G.uUnderwater.value = und;
    if (this.engine.post) this.engine.post.surfaceY = h;
    G.uSeaLevel.value = this.level;
  }

  _renderCascades(r, t, dt) {
    const decayBase = lerp(2.5, 11, this.state);
    for (const c of this.cascades) {
      const n = c.waves.length;
      for (let i = 0; i < n; i++) {
        const w = c.waves[i];
        let ph = (w.phi0 - w.omega * t) % TAU;
        if (ph < 0) ph += TAU;
        c.uW[i * 4] = w.tx; c.uW[i * 4 + 1] = w.tz; c.uW[i * 4 + 2] = w.A; c.uW[i * 4 + 3] = ph;
        c.uK[i * 4] = w.kx; c.uK[i * 4 + 1] = w.kz; c.uK[i * 4 + 2] = w.k; c.uK[i * 4 + 3] = 0;
      }
      const prev = c.rt[c.cur];
      c.cur ^= 1;
      const dst = c.rt[c.cur];
      const m = c.pass.uniforms;
      m.uN.value = n;
      m.uChop.value = this.chop;
      m.uPrev.value = c.def.disp ? prev.textures[2] : null;
      // big breakers leave foam longer than small ones
      const tau = decayBase * (c.def.L > 1000 ? 1.4 : c.def.L > 100 ? 1 : 0.55);
      m.uDecay.value = Math.exp(-dt / tau);
      m.uFoamJ.value.set(c.foamJ ?? this.foamJ, 2.2);
      c.pass.render(r, dst);
    }
    const [c0, c1, c2, c3] = this.cascades;
    const u = this.uniforms;
    u.uA0.value = c0.rt[c0.cur].textures[0]; u.uB0.value = c0.rt[c0.cur].textures[1]; u.uC0.value = c0.rt[c0.cur].textures[2];
    u.uA1.value = c1.rt[c1.cur].textures[0]; u.uB1.value = c1.rt[c1.cur].textures[1]; u.uC1.value = c1.rt[c1.cur].textures[2];
    u.uA2.value = c2.rt[c2.cur].textures[0]; u.uB2.value = c2.rt[c2.cur].textures[1]; u.uC2.value = c2.rt[c2.cur].textures[2];
    u.uD3.value = c3.rt[c3.cur].textures[0];
  }

  _renderSim(r, cam, dt) {
    const size = this.simSize, N = this.simRes, cell = size / N;
    // the sheet sits a little ahead of the camera, snapped to whole texels
    const dir = this._v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const ahead = clamp(size * 0.22, 0, 80) * smoothstep(-2, 30, cam.position.y);
    const cx = Math.round((cam.position.x + dir.x * ahead) / cell) * cell;
    const cz = Math.round((cam.position.z + dir.z * ahead) / cell) * cell;
    const u = this.simU;
    const jump = Math.abs(cx - this.simCenter.x) > size * 0.5 || Math.abs(cz - this.simCenter.y) > size * 0.5;
    if (jump || !this._simCleared) {
      for (const rt of this.simRT) {
        r.setRenderTarget(rt);
        r.setClearColor(0x000000, 0);
        r.clear(true, false, false);
      }
      r.setClearColor(0x000000, 1);
      this._simCleared = true;
      u.uShift.value.set(0, 0);
    } else {
      u.uShift.value.set((cx - this.simCenter.x) / size, (cz - this.simCenter.y) / size);
    }
    this.simCenter.set(cx, cz);
    // sources in sheet uv
    const ns = Math.min(this._sources.length, 16);
    for (let i = 0; i < 16; i++) {
      const a = u.uSrc.value[i], b = u.uSrcB.value[i];
      if (i < ns) {
        const s = this._sources[i];
        a.set((s.x - cx) / size + 0.5, (s.z - cz) / size + 0.5, Math.max(s.r, cell * 1.5) / size, s.imp);
        b.set(s.foam, s.glow, s.ring, 0);
      } else {
        a.set(-9, -9, 0, 0);
        b.set(0, 0, 0, 0);
      }
    }
    this._sources.length = 0;
    const steps = Math.min(4, Math.max(1, Math.ceil(dt / (1 / 60))));
    const sdt = dt / steps;
    const c = 4.2; // ripple speed (m/s)
    for (let k = 0; k < steps; k++) {
      u.uSrcN.value = k === 0 ? ns : 0;
      if (k > 0) u.uShift.value.set(0, 0);
      u.uDt.value = sdt;
      u.uAlpha.value = Math.min(0.4 / sdt, (c * c * sdt) / (cell * cell));
      u.uDamp.value = Math.exp(-sdt * 0.16);
      u.uFoamDecay.value = Math.exp(-sdt / 9);
      u.uGlowDecay.value = Math.exp(-sdt / 2.5);
      u.uFoamGen.value = 0.25 * sdt;
      const src = this.simRT[this.simCur];
      this.simCur ^= 1;
      u.uPrev.value = src.texture;
      this.simPass.render(r, this.simRT[this.simCur]);
    }
    const su = this.uniforms;
    su.uSim.value = this.simRT[this.simCur].texture;
    su.uSimXf.value.set(cx, cz, size, 1);
  }

  dispose() {
    const i = this.engine.beforeRender.indexOf(this._hook);
    if (i >= 0) this.engine.beforeRender.splice(i, 1);
    this.engine.sceneT.remove(this.mesh);
  }
}

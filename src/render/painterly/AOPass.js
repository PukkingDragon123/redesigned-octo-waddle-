// Screen-space ambient occlusion for the painted look.
//
// GTAO (Jimenez et al. 2016, "Practical Real-Time Strategies for Accurate Indirect Occlusion"),
// structured after Intel's XeGTAO (MIT): horizon search along a few screen-space slices per pixel
// with the analytic cosine-weighted visibility integral. Everything runs at half resolution:
//
//   prep      full-res depth -> half-res linear view depth: anchored on the nearest of each 2x2
//             (thin silhouettes survive), smoothed over 4x4 within ~1% of the depth, so shell fur,
//             grass and depth jitter read as soft masses instead of a field of spikes
//   gtao      normals from the half-res surface, then slices x steps horizon search with a 4x4
//             interleaved (R2-sequence) pattern and a small horizon angle bias; the second channel
//             is a cheap direct-sun estimate (N.L x the sun shadow map) used to keep the occlusion
//             on ambient light only
//   blur      separable bilateral (plane-distance weights), 8-texel footprint that exactly cancels
//             the 4x4 pattern
//   temporal  reprojected history (depth-rejected, neighbourhood-clamped), so a moving camera does
//             not make the pattern crawl; the pattern rotates per frame only while this is on
//   apply     full-res joint-bilateral upsample, multiplied into the HDR target with blending.
//             Occlusion darkens toward a cool shade colour (never black), weighted by the ambient
//             share of the pixel's light and faded by the atmosphere so fog is never occluded.
//
// The apply step belongs right after the opaque pass and before the transparent pass: the ocean
// (transparent, no depth) then refracts the occluded scene and is not itself darkened.
import {
  WebGLRenderTarget, FloatType, HalfFloatType, RedFormat, RGBAFormat,
  NearestFilter, LinearFilter, Vector2, Vector3, Vector4, Matrix4, Color, GLSL3, CustomBlending,
  AddEquation, DstColorFactor, ZeroFactor, OneFactor, NoBlending, ClampToEdgeWrapping,
} from 'three';
import { FullscreenPass, FS_VERT } from '../FullscreenPass.js';
import { G } from '../Globals.js';
import { VIEW, SURFACE } from './glsl.js';

const PREP = /* glsl */ `
uniform highp sampler2D tDepth;
uniform vec2 uFull;
uniform float uSmooth;   // depth tolerance (fraction of depth) of the edge-aware smoothing
${VIEW}
${SURFACE}
layout(location = 0) out vec4 oZ;
float zAt(ivec2 q) {
  q = clamp(q, ivec2(0), ivec2(uFull) - 1);
  float d = texelFetch(tDepth, q, 0).r;
  return d >= 1.0 ? 1.0e6 : linZ(d);
}
void main() {
  // anchor on the nearest of the 2x2 block (thin silhouettes survive), then average the 4x4
  // neighbourhood within a small depth tolerance: shell fur, grass and depth jitter settle into a
  // smooth envelope, while real edges (beyond ~1% of the depth) stay sharp
  ivec2 fp = ivec2(gl_FragCoord.xy) * 2;
  float zz[16];
  for (int k = 0; k < 16; k++) zz[k] = zAt(fp + ivec2(k % 4 - 1, k / 4 - 1));
  float zc = min(min(zz[5], zz[6]), min(zz[9], zz[10]));
  // the sea never writes depth: its flat plane joins the occluders here, so rocks and whales get
  // contact shading at the waterline (sea pixels themselves are never darkened, see apply)
  float zs = surfaceZ(gl_FragCoord.xy / (uFull * 0.5), 1.0e6);
  if (zs < zc * 0.998) { oZ = vec4(zs, 0.0, 0.0, 1.0); return; }
  if (zc >= 1.0e5) { oZ = vec4(1.0e6, 0.0, 0.0, 1.0); return; }
  float acc = 0.0, ws = 0.0;
  float tol = 1.0 / (zc * uSmooth);
  for (int k = 0; k < 16; k++) {
    float t = (zz[k] - zc) * tol;
    bool inner = k == 5 || k == 6 || k == 9 || k == 10;
    float w = exp2(-t * t) * (inner ? 1.0 : 0.5);
    acc += zz[k] * w;
    ws += w;
  }
  oZ = vec4(acc / ws, 0.0, 0.0, 1.0);
}
`;

const GTAO = /* glsl */ `
uniform highp sampler2D tZ;
uniform vec2 uHalf;
${VIEW}
uniform vec4 uAO;    // x radius (m), y radius growth per metre of depth, z max screen radius (half px), w falloff fraction
uniform vec4 uAO2;   // x fade start (m), y fade end (m), z final power, w frame (temporal pattern)
uniform vec2 uBias;  // x horizon angle bias (rad), y extra bias on rough (spiky) surfaces
uniform int uSlices;
uniform int uSteps;
${SURFACE}
uniform vec3 uSunDir;
uniform highp sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform vec4 uShadowParams;
layout(location = 0) out vec4 oAO;

const float PI = 3.14159265;
const float HALF_PI = 1.57079633;

float fastAcos(float x) {
  float ax = min(abs(x), 1.0);
  float r = (-0.156583 * ax + HALF_PI) * sqrt(1.0 - ax);
  return x >= 0.0 ? r : PI - r;
}
int bayer4(ivec2 p) {
  const int B[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return B[(p.y & 3) * 4 + (p.x & 3)];
}
vec3 posH(ivec2 q, float z) { return viewPos((vec2(q) + 0.5) / uHalf, z); }
// How much direct sun this point gets (N.L ramp x a 4-tap sun shadow lookup).
float sunVisibility(vec3 Pv, vec3 Nv) {
  vec3 Pw = (uViewInv * vec4(Pv, 1.0)).xyz;
  vec3 Nw = normalize(mat3(uViewInv) * Nv);
  float lit = smoothstep(-0.02, 0.3, dot(Nw, uSunDir));
  if (lit <= 0.0 || uShadowParams.w <= 0.0) return lit;
  vec4 sc = uShadowMatrix * vec4(Pw + Nw * uShadowParams.z, 1.0);
  vec2 e = abs(sc.xy - 0.5) * 2.0;
  float edge = max(e.x, e.y);
  if (edge > 1.0 || sc.z > 1.0 || sc.z < 0.0) return lit;
  float zc = sc.z - uShadowParams.y;
  float r = uShadowParams.x * 2.5;
  float s = texture(uShadowMap, vec3(sc.xy + vec2(-0.7, -0.3) * r, zc))
          + texture(uShadowMap, vec3(sc.xy + vec2(0.3, -0.7) * r, zc))
          + texture(uShadowMap, vec3(sc.xy + vec2(0.7, 0.3) * r, zc))
          + texture(uShadowMap, vec3(sc.xy + vec2(-0.3, 0.7) * r, zc));
  s = mix(mix(1.0, s * 0.25, uShadowParams.w), 1.0, smoothstep(0.82, 1.0, edge));
  return lit * s;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 hmax = ivec2(uHalf) - 1;
  float z = texelFetch(tZ, p, 0).r;
  // the sky and the sea plane never count as sunlit neighbours for the warm bounce
  if (z >= 1.0e5) { oAO = vec4(1.0, 0.0, 0.0, 0.0); return; }
  vec3 P = posH(p, z);
  bool sea = surfaceZ((vec2(p) + 0.5) / uHalf, 1.0e6) <= z * 1.0005;
  // normal from the half-res surface, taking the smaller step on each axis (robust at edges)
  float zl = texelFetch(tZ, max(p - ivec2(1, 0), ivec2(0)), 0).r;
  float zr = texelFetch(tZ, min(p + ivec2(1, 0), hmax), 0).r;
  float zd = texelFetch(tZ, max(p - ivec2(0, 1), ivec2(0)), 0).r;
  float zu = texelFetch(tZ, min(p + ivec2(0, 1), hmax), 0).r;
  float pix = 2.0 * z / (uProj.y * uHalf.y);
  vec3 dx = abs(zr - z) < abs(z - zl) ? posH(p + ivec2(1, 0), zr) - P : P - posH(p - ivec2(1, 0), zl);
  vec3 dy = abs(zu - z) < abs(z - zd) ? posH(p + ivec2(0, 1), zu) - P : P - posH(p - ivec2(0, 1), zd);
  if (min(abs(zr - z), abs(z - zl)) > 0.25 * z) dx = vec3(pix, 0.0, 0.0);
  if (min(abs(zu - z), abs(z - zd)) > 0.25 * z) dy = vec3(0.0, pix, 0.0);
  vec3 N = normalize(cross(dx, dy));
  if (dot(N, P) > 0.0) N = -N;
  vec3 V = normalize(-P);
  // spikiness: a texel that is a local depth extremum on an axis (fur strand tips, grass blades)
  // gets a larger horizon bias, so fuzz does not occlude itself while real creases still do
  float ex = (zl - z) * (zr - z) > 0.0 ? min(abs(zl - z), abs(zr - z)) : 0.0;
  float ey = (zd - z) * (zu - z) > 0.0 ? min(abs(zd - z), abs(zu - z)) : 0.0;
  float bias = uBias.x + uBias.y * smoothstep(0.15, 1.0, (ex + ey) / pix);
  // open silhouettes: where neighbours fall away into the background (fur against the sky, fin
  // edges), the reconstructed surface is unreliable and the point sees open space anyway
  float open = 0.25 * (step(z * 1.25, zl) + step(z * 1.25, zr) + step(z * 1.25, zd) + step(z * 1.25, zu));
  float sv = sea ? 0.0 : sunVisibility(P, N);
  float pxPerM = 1.0 / pix;
  float worldR = uAO.x * (1.0 + z * uAO.y);
  float screenR = min(worldR * pxPerM, uAO.z);
  worldR = screenR / pxPerM;
  float fade = smoothstep(uAO2.y, uAO2.x, z) * smoothstep(1.0, 3.0, screenR);
  if (fade <= 0.0) { oAO = vec4(1.0, sv, N.xy); return; }
  P *= 0.9999;
  float fr = max(uAO.w * worldR, 1e-4);
  float falloffMul = -1.0 / fr;
  float falloffAdd = worldR * (1.0 - uAO.w) / fr + 1.0;
  float minS = 1.3 / screenR;
  float bi = float(bayer4(p) + 16 * int(uAO2.w));
  vec2 nz = fract(0.5 + bi * vec2(0.7548776662, 0.5698402910));
  float fSlices = float(uSlices);
  float fSteps = float(uSteps);
  float vis = 0.0;
  for (int slice = 0; slice < 8; slice++) {
    if (slice >= uSlices) break;
    float phi = (float(slice) + nz.x) / fSlices * PI;
    vec2 omega = vec2(cos(phi), sin(phi));
    vec3 dirV = vec3(omega, 0.0);
    vec3 ortho = dirV - dot(dirV, V) * V;
    vec3 axis = normalize(cross(ortho, V));
    vec3 projN = N - axis * dot(N, axis);
    float projLen = length(projN);
    float cosN = clamp(dot(projN, V) / max(projLen, 1e-4), 0.0, 1.0);
    float n = (dot(ortho, projN) >= 0.0 ? 1.0 : -1.0) * fastAcos(cosN);
    // horizons start on the tangent plane, raised by the bias
    float lo0 = cos(max(n + HALF_PI - bias, 0.0));
    float lo1 = cos(min(n - HALF_PI + bias, 0.0));
    float h0 = lo0, h1 = lo1;
    for (int st = 0; st < 16; st++) {
      if (st >= uSteps) break;
      float s = (float(st) + nz.y) / fSteps;
      s = s * s + minS;
      ivec2 o = ivec2(floor(omega * (s * screenR) + 0.5));
      ivec2 q0 = p + o, q1 = p - o;
      bool in0 = all(greaterThanEqual(q0, ivec2(0))) && all(lessThanEqual(q0, hmax));
      bool in1 = all(greaterThanEqual(q1, ivec2(0))) && all(lessThanEqual(q1, hmax));
      float z0 = texelFetch(tZ, clamp(q0, ivec2(0), hmax), 0).r;
      float z1 = texelFetch(tZ, clamp(q1, ivec2(0), hmax), 0).r;
      vec3 d0 = posH(q0, z0) - P;
      vec3 d1 = posH(q1, z1) - P;
      float l0 = length(d0), l1 = length(d1);
      float w0 = in0 ? clamp(l0 * falloffMul + falloffAdd, 0.0, 1.0) : 0.0;
      float w1 = in1 ? clamp(l1 * falloffMul + falloffAdd, 0.0, 1.0) : 0.0;
      h0 = max(h0, mix(lo0, dot(d0, V) / max(l0, 1e-4), w0));
      h1 = max(h1, mix(lo1, dot(d1, V) / max(l1, 1e-4), w1));
    }
    projLen = mix(projLen, 1.0, 0.05);
    float a0 = -fastAcos(h1) - bias;
    float a1 = fastAcos(h0) + bias;
    a0 = n + clamp(a0 - n, -HALF_PI, HALF_PI);
    a1 = n + clamp(a1 - n, -HALF_PI, HALF_PI);
    float sinN = sin(n);
    vis += projLen * 0.25 * ((cosN + 2.0 * a0 * sinN - cos(2.0 * a0 - n)) + (cosN + 2.0 * a1 * sinN - cos(2.0 * a1 - n)));
  }
  vis = pow(clamp(vis / fSlices, 0.0, 1.0), uAO2.z);
  vis = mix(vis, 1.0, open * 0.8);
  oAO = vec4(mix(1.0, vis, fade), sv, N.xy);
}
`;

const BLUR = /* glsl */ `
uniform sampler2D tAO;     // x ao, y direct-sun estimate, z sunlit neighbourhood (after the first pass)
uniform sampler2D tRaw;    // the GTAO output: zw view normal
uniform highp sampler2D tZ;
uniform vec2 uHalf;
uniform vec2 uDir;
uniform float uSharp;
uniform float uFirst;      // 1 on the first (horizontal) pass: the neighbourhood starts from y
uniform int uRadius;       // 4 (8-texel window) or 2 (4-texel window): both cancel the 4x4 pattern
${VIEW}
layout(location = 0) out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 hmax = ivec2(uHalf) - 1;
  vec4 c = texelFetch(tAO, p, 0);
  float z = texelFetch(tZ, p, 0).r;
  ivec2 dir = ivec2(uDir);
  // the sunlit neighbourhood: a plain (not bilateral) box over 25 texels per axis, across surfaces,
  // so a shaded crease learns that the rock beside it stands in the sun (warm bounce)
  float near = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec4 s = texelFetch(tAO, clamp(p + dir * (i * 4), ivec2(0), hmax), 0);
    near += uFirst > 0.5 ? s.y : s.z;
  }
  near /= 7.0;
  if (z >= 1.0e5) { o = vec4(c.xy, near, 1.0); return; }
  vec2 nr = texelFetch(tRaw, p, 0).zw;
  vec3 N = vec3(nr, sqrt(max(1.0 - dot(nr, nr), 0.0)));
  vec3 P = viewPos((vec2(p) + 0.5) / uHalf, z);
  vec2 acc = c.xy;
  float ws = 1.0;
  for (int i = -4; i <= 4; i++) {
    if (i == 0 || i < -uRadius || i > uRadius) continue;
    ivec2 q = clamp(p + dir * i, ivec2(0), hmax);
    float zq = texelFetch(tZ, q, 0).r;
    vec3 Pq = viewPos((vec2(q) + 0.5) / uHalf, zq);
    float pd = dot(Pq - P, N) / z;
    // flat weights over whole periods of the 4x4 pattern (half weight at both ends), soft only
    // off the surface plane
    float w = (i == uRadius || i == -uRadius ? 0.5 : 1.0) * exp2(-pd * pd * uSharp);
    acc += texelFetch(tAO, q, 0).xy * w;
    ws += w;
  }
  o = vec4(acc / ws, near, 1.0);
}
`;

const TEMPORAL = /* glsl */ `
uniform sampler2D tCur;
uniform sampler2D tHist;
uniform highp sampler2D tZ;
uniform highp sampler2D tZPrev;
uniform vec2 uHalf;
uniform mat4 uViewInv;
uniform mat4 uPrevViewProj;
uniform vec2 uTemporal;   // x weight of the new frame, y reset
${VIEW}
layout(location = 0) out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 hmax = ivec2(uHalf) - 1;
  vec4 c4 = texelFetch(tCur, p, 0);
  vec3 cur = c4.rgb;
  float z = texelFetch(tZ, p, 0).r;
  if (z >= 1.0e5 || uTemporal.y > 0.5) { o = c4; return; }
  vec2 uv = (vec2(p) + 0.5) / uHalf;
  vec4 pc = uPrevViewProj * (uViewInv * vec4(viewPos(uv, z), 1.0));
  if (pc.w <= 0.0) { o = c4; return; }
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  if (puv.x <= 0.0 || puv.y <= 0.0 || puv.x >= 1.0 || puv.y >= 1.0) { o = c4; return; }
  float zp = texelFetch(tZPrev, clamp(ivec2(puv * uHalf), ivec2(0), hmax), 0).r;
  float valid = 1.0 - smoothstep(0.015, 0.05, abs(zp - pc.w) / pc.w);
  vec3 hist = texture(tHist, puv).rgb;
  // never let a bad value live on in the history (comparisons with NaN are false)
  if (!all(greaterThanEqual(hist, vec3(-0.5))) || !all(lessThanEqual(hist, vec3(1.5)))) hist = cur;
  vec3 mn = cur, mx = cur;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec3 v = texelFetch(tCur, clamp(p + ivec2(i, j), ivec2(0), hmax), 0).rgb;
      mn = min(mn, v);
      mx = max(mx, v);
    }
  }
  hist = clamp(hist, mn - 0.03, mx + 0.03);
  o = vec4(mix(hist, cur, mix(1.0, uTemporal.x, valid)), 1.0);
}
`;

const APPLY = /* glsl */ `
#ifndef AO_DEBUG
#define AO_DEBUG 0
#endif
uniform highp sampler2D tDepth;
uniform sampler2D tAO;
uniform sampler2D tRaw;
uniform highp sampler2D tZ;
uniform vec2 uFull;
uniform vec2 uHalf;
uniform vec3 uTint;
uniform vec4 uBounce;    // rgb warm bounce colour x strength (0 at night), w: unused
uniform vec4 uApply;     // x strength, y floor of the ambient share in full sun, z sun luminance, w ambient luminance
uniform vec4 uFogParams; // G.uFogParams: x distance density, y height density, z height falloff, w base height
uniform float uUnderwater;
uniform vec3 uWaterAbsorb;
uniform float uSplit;
${VIEW}
${SURFACE}
layout(location = 0) out vec4 o;

// The share of a pixel that is atmosphere (mirrors airFogAmount in common.js): fog is in-scattered
// light and is never occluded.
float fogAmount(vec3 P) {
  vec3 v = P - uCamPos;
  float dist = length(v);
  vec3 rd = v / max(dist, 1e-4);
  float fd = 1.0 - exp(-dist * uFogParams.x);
  float k = max(uFogParams.z, 1e-6);
  float base = uFogParams.y * exp(-k * (uCamPos.y - uFogParams.w));
  float hf = abs(rd.y) > 1e-3 ? base * (1.0 - exp(-k * rd.y * dist)) / (k * rd.y) : base * dist;
  float a = clamp(1.0 - (1.0 - fd) * exp(-max(hf, 0.0)), 0.0, 1.0);
  if (uUnderwater > 0.0) a = mix(a, 1.0 - dot(exp(-uWaterAbsorb * dist), vec3(0.2, 0.5, 0.3)), uUnderwater);
  return a;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 uv = (vec2(p) + 0.5) / uFull;
  // nothing to do (sky, sea, the bypassed split, no occlusion) costs no blend traffic
#if AO_DEBUG == 0
  if (uv.x < uSplit) discard;
#endif
  float d = texelFetch(tDepth, p, 0).r;
#if AO_DEBUG == 0
  if (d >= 1.0) discard;
#else
  if (d >= 1.0) { o = vec4(1.0); return; }
#endif
  float z = linZ(d);
  // seen through the sea surface: leave the water (and what it refracts) alone
#if AO_DEBUG == 0
  if (surfaceZ(uv, z) < z * 0.999) discard;
#else
  if (surfaceZ(uv, z) < z * 0.999) { o = vec4(1.0); return; }
#endif
  // joint bilateral upsample: bilinear weights x depth agreement; fall back to the closest depth
  vec2 hp = (vec2(p) + 0.5) * 0.5 - 0.5;
  ivec2 b = ivec2(floor(hp));
  vec2 f = hp - vec2(b);
  ivec2 hmax = ivec2(uHalf) - 1;
  vec3 acc = vec3(0.0);
  float ws = 0.0;
  float bestD = 1.0e9;
  vec3 best = vec3(1.0);
  for (int j = 0; j <= 1; j++) {
    for (int i = 0; i <= 1; i++) {
      ivec2 q = clamp(b + ivec2(i, j), ivec2(0), hmax);
      float dz = abs(texelFetch(tZ, q, 0).r - z) / z;
      vec3 aq = texelFetch(tAO, q, 0).rgb;
      float bw = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
      float w = bw * exp2(-dz * dz * 4.0e4);
      acc += aq * w;
      ws += w;
      if (dz < bestD) { bestD = dz; best = aq; }
    }
  }
  vec3 a = ws > 1e-3 ? acc / ws : best;
  vec3 Pw = (uViewInv * vec4(viewPos(uv, z), 1.0)).xyz;
  float clear = 1.0 - fogAmount(Pw);
  // occlusion only removes ambient light: in full sun most of the light is direct
  float amb = uApply.w / max(uApply.w + uApply.z * a.y, 1e-4);
  amb = max(amb, uApply.y);
  float k = clamp(uApply.x * (1.0 - a.x) * amb * clear, 0.0, 1.0);
  // warm bounce: an enclosed, shaded point whose neighbourhood stands in the sun glows warm
  // (multiplied, so it takes the colour of the surface it lands on, like real bounce light)
  float bounce = (1.0 - a.x) * (1.0 - a.y) * smoothstep(0.1, 0.7, a.z) * clear;
#if AO_DEBUG == 2
  o = vec4(vec3(a.y), 1.0);
#elif AO_DEBUG == 3
  o = vec4(vec3(a.x), 1.0);
#elif AO_DEBUG == 4
  vec2 nn = texelFetch(tRaw, clamp(b, ivec2(0), hmax), 0).zw;
  o = vec4(nn * 0.5 + 0.5, sqrt(max(1.0 - dot(nn, nn), 0.0)), 1.0);
#else
  vec3 m = mix(vec3(1.0), uTint, k) * (1.0 + uBounce.rgb * bounce);
#if AO_DEBUG == 0
  if (k < 0.002 && bounce * uBounce.r < 0.002) discard;
  // a non-finite multiplier would poison the HDR frame (and bloom would spread it): drop it
  if (!(m.r >= 0.0 && m.g >= 0.0 && m.b >= 0.0 && m.r < 8.0 && m.g < 8.0 && m.b < 8.0)) discard;
#endif
  o = vec4(m, 1.0);
#endif
}
`;

const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

function target(w, h, type, format, filter = NearestFilter) {
  return new WebGLRenderTarget(w, h, {
    type, format, minFilter: filter, magFilter: filter, depthBuffer: false, stencilBuffer: false,
    generateMipmaps: false, wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping,
  });
}

export const AO_DEFAULTS = {
  radius: 3.0, // metres at the camera; grows with distance (wide, soft occlusion)
  grow: 0.02, // radius growth per metre of view depth
  maxScreen: 0.12, // max horizon search radius as a fraction of the screen height
  falloff: 0.55, // fraction of the radius over which occluders fade out
  bias: 0.1, // horizon angle bias (rad): occluders barely above the surface do not count
  roughBias: 0.4, // extra bias on spiky surfaces (shell fur, grass) so fuzz does not self-occlude
  smooth: 0.012, // depth tolerance of the edge-aware depth smoothing (fraction of the depth)
  power: 2.2, // contrast of the visibility term
  fadeStart: 600, // occlusion fades with distance (m)
  fadeEnd: 2200,
  strength: 0.9,
  litFloor: 0.5, // how much occlusion still shows in full sun (0: ambient only, 1: everywhere)
  tint: new Color(0.5, 0.52, 0.57), // the shade colour full occlusion multiplies toward (cool, never violet)
  bounce: 0.7, // warm bounce in shaded creases next to sunlit surfaces (0 off)
  bounceColor: new Color(1.0, 0.62, 0.36),
  sharp: 4.0e4, // bilateral plane-distance sharpness
  blend: 0.14, // weight of the new frame in the temporal history
};

export class AOPass {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.temporal = opts.temporal ?? true;
    this.params = Object.assign({}, AO_DEFAULTS, opts.params || {});
    this.params.tint = (opts.params?.tint || AO_DEFAULTS.tint).clone();
    this.params.bounceColor = (opts.params?.bounceColor || AO_DEFAULTS.bounceColor).clone();
    this.split = 0;
    this.sea = opts.sea ?? true; // the flat sea at G.uSeaLevel occludes (the ocean writes no depth)
    this.slices = 3;
    this.steps = 4;
    this.blurRadius = 4;
    this.width = 1;
    this.height = 1;
    this.halfW = 1;
    this.halfH = 1;
    this.frame = 0;
    this._cur = 0;
    this._valid = false;
    this._prevViewProj = new Matrix4();
    this._prevPos = new Vector3();
    this._prevDir = new Vector3();
    this._v = new Vector3();
    this._d = new Vector3();

    const zType = renderer.extensions?.has?.('EXT_color_buffer_float') ? FloatType : HalfFloatType;
    // half-res linear depth, ping-ponged so the temporal pass can test last frame's depth
    this.prep = [target(1, 1, zType, RedFormat), target(1, 1, zType, RedFormat)];
    // ao, direct-sun estimate, view normal xy
    this.raw = target(1, 1, HalfFloatType, RGBAFormat);
    this.tmp = target(1, 1, HalfFloatType, RGBAFormat);
    this.blurred = target(1, 1, HalfFloatType, RGBAFormat);
    this.hist = [target(1, 1, HalfFloatType, RGBAFormat, LinearFilter), target(1, 1, HalfFloatType, RGBAFormat, LinearFilter)];

    // shared uniform objects (updated once per frame)
    this.u = {
      uProj: { value: new Vector4(1, 1, 0, 0) },
      uDepthLin: { value: new Vector2(-1, -1) },
      uViewInv: { value: new Matrix4() },
      uCamPos: { value: new Vector3() },
      uSeaY: G.uSeaLevel || { value: 0 },
      uSeaOn: { value: 1 },
      uFull: { value: new Vector2(1, 1) },
      uHalf: { value: new Vector2(1, 1) },
    };
    const u = this.u;
    const view = { uProj: u.uProj, uDepthLin: u.uDepthLin, uViewInv: u.uViewInv, uCamPos: u.uCamPos, uSeaY: u.uSeaY, uSeaOn: u.uSeaOn };
    const mk = (frag, uniforms, extra = {}) => new FullscreenPass(Object.assign({
      vertexShader: FS_VERT, fragmentShader: frag, glslVersion: GLSL3, uniforms,
    }, extra));

    this.prepPass = mk(PREP, Object.assign({ tDepth: { value: null }, uFull: u.uFull, uSmooth: { value: 0.012 } }, view));
    this.gtaoPass = mk(GTAO, {
      tZ: { value: null }, uHalf: u.uHalf, uCamPos: u.uCamPos, uSeaY: u.uSeaY, uSeaOn: u.uSeaOn, uProj: u.uProj, uDepthLin: u.uDepthLin,
      uAO: { value: new Vector4() }, uAO2: { value: new Vector4() }, uBias: { value: new Vector2(0.1, 0.35) },
      uSlices: { value: 2 }, uSteps: { value: 5 },
      uViewInv: u.uViewInv, uSunDir: G.uSunDir,
      uShadowMap: G.uShadowMap, uShadowMatrix: G.uShadowMatrix, uShadowParams: G.uShadowParams,
    });
    this.blurPass = mk(BLUR, {
      tAO: { value: null }, tRaw: { value: null }, tZ: { value: null }, uHalf: u.uHalf, uFirst: { value: 1 }, uRadius: { value: 4 },
      uDir: { value: new Vector2(1, 0) }, uSharp: { value: this.params.sharp }, uProj: u.uProj, uDepthLin: u.uDepthLin,
    });
    this.temporalPass = mk(TEMPORAL, {
      tCur: { value: null }, tHist: { value: null }, tZ: { value: null }, tZPrev: { value: null },
      uHalf: u.uHalf, uViewInv: u.uViewInv, uPrevViewProj: { value: new Matrix4() },
      uTemporal: { value: new Vector2(1, 1) }, uProj: u.uProj, uDepthLin: u.uDepthLin,
    });
    const applyUniforms = {
      tDepth: { value: null }, tAO: { value: null }, tRaw: { value: null }, tZ: { value: null },
      uFull: u.uFull, uHalf: u.uHalf, uTint: { value: this.params.tint }, uApply: { value: new Vector4() },
      uBounce: { value: new Vector4() },
      uFogParams: G.uFogParams, uUnderwater: G.uUnderwater || { value: 0 },
      uWaterAbsorb: G.uWaterAbsorb || { value: new Vector3(0.3, 0.07, 0.045) },
      uSplit: { value: 0 },
    };
    Object.assign(applyUniforms, view);
    this.applyPass = mk(APPLY, applyUniforms);
    const m = this.applyPass.material;
    m.blending = CustomBlending;
    m.blendEquation = AddEquation;
    m.blendSrc = DstColorFactor;
    m.blendDst = ZeroFactor;
    m.blendEquationAlpha = AddEquation;
    m.blendSrcAlpha = ZeroFactor;
    m.blendDstAlpha = OneFactor;
    // debug views (straight to the screen): 1 the occlusion multiplier, 2 the sun estimate
    this.debugPass = mk(APPLY, applyUniforms, { defines: { AO_DEBUG: 1 } });
    this.debugSunPass = mk(APPLY, applyUniforms, { defines: { AO_DEBUG: 2 } });
    this.debugRawPass = mk(APPLY, applyUniforms, { defines: { AO_DEBUG: 3 } });
    this.debugNormalPass = mk(APPLY, applyUniforms, { defines: { AO_DEBUG: 4 } });
    for (const d of [this.debugPass, this.debugSunPass, this.debugRawPass, this.debugNormalPass]) d.material.blending = NoBlending;
    const names = ['prep', 'gtao', 'blur', 'temporal', 'apply', 'debug', 'debugSun', 'debugRaw', 'debugNormal'];
    this.passes = [this.prepPass, this.gtaoPass, this.blurPass, this.temporalPass, this.applyPass, this.debugPass, this.debugSunPass, this.debugRawPass, this.debugNormalPass];
    this.passes.forEach((p, i) => { p.material.name = 'painterly-ao-' + names[i]; });
    this.setQuality(opts.quality ?? 1);
  }

  /** 0..1: horizon slices and steps (all from one program, so switching never compiles). */
  setQuality(q) {
    this.quality = q;
    if (q >= 0.75) { this.slices = 3; this.steps = 4; } else if (q >= 0.4) { this.slices = 2; this.steps = 3; } else { this.slices = 1; this.steps = 3; }
    this.blurRadius = q >= 0.75 ? 4 : 2;
  }

  setSize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.halfW = Math.max(1, (w + 1) >> 1);
    this.halfH = Math.max(1, (h + 1) >> 1);
    for (const rt of this.prep) rt.setSize(this.halfW, this.halfH);
    for (const rt of [this.raw, this.tmp, this.blurred, ...this.hist]) rt.setSize(this.halfW, this.halfH);
    this.u.uFull.value.set(w, h);
    this.u.uHalf.value.set(this.halfW, this.halfH);
    this._valid = false;
  }

  /** The AO texture of the last render (half res; r visibility 0..1, g direct-sun estimate, b sunlit neighbourhood). */
  get texture() {
    return this.temporal ? this.hist[this._cur].texture : this.blurred.texture;
  }

  _updateCamera(camera) {
    const e = camera.projectionMatrix.elements;
    this.u.uProj.value.set(e[0], e[5], e[8], e[9]);
    this.u.uDepthLin.value.set(e[10], e[14]);
    this.u.uViewInv.value.copy(camera.matrixWorld);
    this.u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    // the sea plane takes part only while the camera is above the water (and when there is a sea)
    this.u.uSeaOn.value = this.sea && !((G.uUnderwater?.value ?? 0) > 0.5) ? 1 : 0;
  }

  /** Compute the AO for this frame from the resolved opaque depth. Returns the AO texture. */
  render(depthTex, camera) {
    const r = this.renderer;
    const p = this.params;
    this._updateCamera(camera);
    const prev = r.getRenderTarget();
    const prepCur = this.prep[this.frame & 1];
    const prepPrev = this.prep[(this.frame + 1) & 1];

    this.prepPass.uniforms.tDepth.value = depthTex;
    this.prepPass.uniforms.uSmooth.value = p.smooth;
    this.prepPass.render(r, prepCur);

    const g = this.gtaoPass.uniforms;
    g.tZ.value = prepCur.texture;
    g.uBias.value.set(p.bias, p.roughBias);
    g.uAO.value.set(p.radius, p.grow, p.maxScreen * this.halfH, p.falloff);
    g.uAO2.value.set(p.fadeStart, p.fadeEnd, p.power, this.temporal ? this.frame % 64 : 0);
    g.uSlices.value = this.slices;
    g.uSteps.value = this.steps;
    this.gtaoPass.render(r, this.raw);

    const b = this.blurPass.uniforms;
    b.tZ.value = prepCur.texture;
    b.uSharp.value = p.sharp;
    b.uRadius.value = this.blurRadius;
    b.tRaw.value = this.raw.texture;
    b.tAO.value = this.raw.texture;
    b.uDir.value.set(1, 0);
    b.uFirst.value = 1;
    this.blurPass.render(r, this.tmp);
    b.tAO.value = this.tmp.texture;
    b.uDir.value.set(0, 1);
    b.uFirst.value = 0;
    this.blurPass.render(r, this.blurred);

    if (this.temporal) {
      // a camera cut (teleport or a sharp swing) restarts the history
      const pos = this._v.setFromMatrixPosition(camera.matrixWorld);
      const dir = this._d.set(0, 0, -1).transformDirection(camera.matrixWorld);
      const cut = !this._valid || pos.distanceTo(this._prevPos) > 40 || dir.dot(this._prevDir) < 0.85;
      this._prevPos.copy(pos);
      this._prevDir.copy(dir);
      const t = this.temporalPass.uniforms;
      const next = this._cur ^ 1;
      t.tCur.value = this.blurred.texture;
      t.tHist.value = this.hist[this._cur].texture;
      t.tZ.value = prepCur.texture;
      t.tZPrev.value = prepPrev.texture;
      t.uPrevViewProj.value.copy(this._prevViewProj);
      t.uTemporal.value.set(p.blend, cut ? 1 : 0);
      this.temporalPass.render(r, this.hist[next]);
      this._cur = next;
      this._valid = true;
    } else {
      this._valid = false;
    }
    this._prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._zTex = prepCur.texture;
    this._depthTex = depthTex;
    this.frame++;
    r.setRenderTarget(prev);
    return this.texture;
  }

  _applyUniforms(sunColor, ambient) {
    const p = this.params;
    const a = this.applyPass.uniforms;
    a.tDepth.value = this._depthTex;
    a.tAO.value = this.texture;
    a.tZ.value = this._zTex;
    a.uSplit.value = this.split;
    // the shade is lit by the sky ambient plus the painted fill (stylizedLight's uLightK.x)
    const fill = 1 + 0.85 * (G.uLightK?.value.x ?? 0);
    const sun = lum(sunColor || G.uSunColor.value), amb = lum(ambient || G.uSkyAmbient.value) * fill;
    a.uApply.value.set(p.strength, p.litFloor, sun, amb);
    a.tRaw.value = this.raw.texture;
    // bounce follows the sun's share of the light (none at night or under heavy overcast)
    const k = p.bounce * Math.min(1, sun / Math.max(sun + amb, 1e-4) * 1.4);
    a.uBounce.value.set(p.bounceColor.r * k, p.bounceColor.g * k, p.bounceColor.b * k, 0);
  }

  /** Multiply the occlusion into an HDR target (multisampled is fine). Call after render(). */
  apply(target) {
    if (!this._depthTex) return;
    this._applyUniforms();
    const r = this.renderer;
    const prev = r.getRenderTarget();
    // depth is untouched here: skip its (multisampled) resolve, only colour needs one
    const rd = target ? target.resolveDepthBuffer : undefined;
    if (target) target.resolveDepthBuffer = false;
    this.applyPass.render(r, target);
    if (target) target.resolveDepthBuffer = rd;
    r.setRenderTarget(prev);
  }

  /** Forget the history (after a cut, or when the AO was switched off for a while). */
  invalidate() {
    this._valid = false;
  }

  /** Debug: draw the occlusion multiplier (1), the direct-sun estimate (2) or the raw visibility (3). */
  renderDebug(target = null, mode = 1) {
    if (!this._depthTex) return;
    this._applyUniforms();
    const pass = [this.debugPass, this.debugPass, this.debugSunPass, this.debugRawPass, this.debugNormalPass][mode] || this.debugPass;
    pass.render(this.renderer, target);
  }

  dispose() {
    for (const rt of [...this.prep, this.raw, this.tmp, this.blurred, ...this.hist]) rt.dispose();
    for (const p of this.passes) p.material.dispose();
  }
}

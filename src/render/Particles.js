// Instanced particles with CPU simulation, shaded as physically based effects (docs/VUR_SOK.md 0.9):
// volumetric vapour lit with forward scattering, refractive droplets motion-blurred by their real
// velocity over the shutter time, whitewater spray clusters, air bubbles with total-internal-reflection
// rims, soft bokeh glows and capillary rings on the sea. Nothing is outlined or drawn.
// Two flavours (one draw each):
//  - 'mist': alpha-blended (vapour, breath, spray, droplets, bubbles, rings, motes, petals)
//  - 'glow': additive, restrained (bioluminescence, bug glow, glints)
import {
  InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor, Vector3, DynamicDrawUsage,
} from 'three';
import { G } from './Globals.js';
import { UNIFORMS, NOISE, LIGHTING, DEPTH } from './shaders/common.js';
import { getNoiseTexture } from './NoiseTex.js';

// Kinds (emit({ kind })):
//  0 vapour / mist / breath / spray cloud     1 glow (bokeh disc)          2 glint (tiny bright point)
//  3 droplet (refractive sphere)              4 air bubble (under water)   5 underwater mote
//  6, 7 legacy wind strokes: drawn as a faint vapour wisp stretched along the motion
//  8 ring on the sea (rain splash, bubble pop, pressure ripple; stretch < 1 sets the ring width)
//  9 whitewater spray cluster (a breaking sheet of fine droplets)   10 petal / leaf (tumbling)
const VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
attribute vec4 aPos;    // xyz, size (radius, m)
attribute vec4 aCol;    // rgb, alpha
attribute vec4 aParam;  // x seed, y age01, z stretch, w kind
attribute vec3 aVel;    // world velocity (motion blur)
uniform float uShutter; // exposure time (s): streaks are exactly the distance moved while it is open
varying vec2 vUv;       // shape frame: x along the motion (streaked kinds) or a spun axis
varying vec2 vScr;      // the same point in the screen frame (x right, y up)
varying float vLen;     // long-axis stretch (1 = round)
varying vec2 vAx;       // the long axis on screen
varying vec4 vCol;
varying vec4 vParam;
varying float vFog;
varying vec3 vFogCol;
varying float vViewZ;
varying float vSize;
varying float vPx;      // radius on screen in pixels
varying vec3 vSun;      // sunlight (and moonlight) reaching it, times the scattering phase
varying vec3 vSunIso;   // the same light without the phase (multiply scattered)
void main() {
  float s = aPos.w;
  float kind = aParam.w;
  float seed = aParam.x;
  float age = aParam.y;
  vec3 P = aPos.xyz;
  // a "drop" much bigger than a few centimetres is really a clump of water breaking up
  if (kind > 2.5 && kind < 3.5 && s > 0.06) kind = 9.0;
  if (kind > 3.5 && kind < 4.5) {
    // bubbles rock and spiral as they rise (bigger ones more)
    float w = uTime * (4.0 + 5.0 * fract(seed * 3.7)) + seed * 6.0;
    float amp = s * (0.35 + 0.6 * smoothstep(0.01, 0.15, s));
    P.x += sin(w) * amp; P.z += cos(w * 0.83) * amp;
  }
  vec4 mvc = viewMatrix * vec4(P, 1.0);
  float z = max(-mvc.z, 0.05);
  float pxPerM = projectionMatrix[1][1] * uResolution.y * 0.5 / z;
  // anything smaller than a pixel is drawn a pixel wide with its coverage as alpha: it never
  // shimmers away, it only gets fainter (fine droplets read as a haze of glints, as on film)
  float cover = 1.0;
  if ((kind > 1.5 && kind < 5.5) || kind > 9.5) {
    float px0 = s * pxPerM;
    // bubbles flash as bright silver points even when tiny (light reflects totally inside them)
    bool bub = kind > 3.5 && kind < 4.5;
    float grow = max(1.0, (bub ? 1.6 : 0.8) / max(px0, 1e-3));
    cover = bub ? 1.0 / grow : 1.0 / (grow * grow);
    s *= grow;
  }
  vec2 ax = vec2(1.0, 0.0);
  float len = 1.0;
  bool streak = (kind > 2.5 && kind < 3.5) || (kind > 5.5 && kind < 7.5) || (kind > 8.5 && kind < 9.5);
  if (streak) {
    vec3 vv = mat3(viewMatrix) * aVel;
    vec2 sd = vv.xy * z + mvc.xy * vv.z;
    float sp = length(sd) / z; // speed across the view at its depth (m/s)
    float th0 = seed * 6.2831;
    ax = sp > 1e-3 ? sd / max(length(sd), 1e-6) : vec2(cos(th0), sin(th0));
    len = clamp(1.0 + sp * uShutter / (2.0 * s), 1.0, 14.0);
    if (kind > 5.5 && kind < 7.5) len = max(len, 1.0 + 0.25 * aParam.z);
  } else if (kind > 3.5 && kind < 5.5) {
    ax = vec2(1.0, 0.0); // bubbles keep the light above them
  } else {
    float th = seed * 6.2831 + age * (fract(seed * 7.31) - 0.5) * 1.6;
    ax = vec2(cos(th), sin(th));
  }
  if (kind > 0.5 && kind < 1.5) s *= 0.75 + 0.5 * fract(seed * 5.31); // bokeh: varied sizes
  vec2 bx = vec2(-ax.y, ax.x);
  vec2 q = ax * (position.x * len) + bx * position.y;
  vUv = position.xy;
  vScr = q;
  vLen = len;
  vAx = ax;
  vCol = vec4(aCol.rgb, aCol.a * cover);
  vParam = vec4(aParam.xyz, kind);
  vec3 toP = P - uCamPos;
  float d = length(toP);
  vec3 rd = toP / max(d, 1e-3);
  vFog = fogAmount(P);
  vFogCol = fogColorFor(rd);
  // light: two-lobe Henyey-Greenstein (strong forward lobe: silver linings when backlit)
  float mu = dot(rd, uSunDir);
  float g1 = 0.62, g2 = -0.2;
  float hg = 0.75 * (1.0 - g1 * g1) / pow(1.0 + g1 * g1 - 2.0 * g1 * mu, 1.5)
           + 0.25 * (1.0 - g2 * g2) / pow(1.0 + g2 * g2 - 2.0 * g2 * mu, 1.5);
  float muM = dot(rd, uMoonDir);
  float hgM = (1.0 - g1 * g1) / pow(1.0 + g1 * g1 - 2.0 * g1 * muM, 1.5);
  float sunUp = smoothstep(-0.06, 0.08, uSunDir.y);
  vec3 sunC = uSunColor * sunUp * (1.0 - 0.7 * uStorm);
  vec3 moonC = uMoonColor * uNight * 0.6;
  vSun = sunC * hg + moonC * hgM;
  vSunIso = sunC + moonC;
  vec4 mv;
  if (kind > 7.5 && kind < 8.5) {
    // a ring lies flat on the sea
    mv = viewMatrix * vec4(P + vec3(position.x, 0.0, position.y) * s, 1.0);
    // pulled a little toward the eye along its ray: the waves under it never swallow it
    mv.xyz -= normalize(mv.xyz) * min(0.35, -mv.z * 0.02);
    vScr = position.xy;
  } else {
    mv = mvc + vec4(q * s, 0.0, 0.0);
  }
  vViewZ = -mv.z;
  vSize = s;
  vPx = s * pxPerM;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
${DEPTH}
uniform sampler2D uNoise;
uniform float uAdditive;
varying vec2 vUv;
varying vec2 vScr;
varying float vLen;
varying vec2 vAx;
varying vec4 vCol;
varying vec4 vParam;
varying float vFog;
varying vec3 vFogCol;
varying float vViewZ;
varying float vSize;
varying float vPx;
varying vec3 vSun;
varying vec3 vSunIso;
float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
vec3 camRight() { return vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); }
vec3 camUp() { return vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]); }
vec3 camBack() { return vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]); }
// a sphere's normal (world) at screen-frame point q (|q| < 1)
vec3 sphereN(vec2 q) {
  float nz = sqrt(max(1.0 - dot(q, q), 0.0));
  return normalize(camRight() * q.x + camUp() * q.y + camBack() * nz);
}
vec3 skyLight(vec3 n) {
  // sky above, the darker sea below, the horizon between
  float up = n.y;
  vec3 sky = mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.8, up));
  vec3 sea = uFogColor * 0.22 + uBounce * 0.3;
  return mix(sea, sky, smoothstep(-0.25, 0.12, up));
}
void main() {
  float kind = vParam.w;
  float seed = vParam.x;
  float age = vParam.y;
  vec2 p = vUv;
  float a = 0.0;
  vec3 col = vCol.rgb;
  vec3 L = uSunDir;
  if (kind < 0.5 || (kind > 5.5 && kind < 7.5)) {
    // ---- vapour: a soft volume, density from layered noise, each puff its own seed and slow churn
    vec2 pp = vec2(p.x * vLen, p.y);
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    vec2 o = vec2(h1(seed), h1(seed + 3.1)) * 9.0;
    float t = uTime * 0.025 + age * 0.3;
    vec2 uv = pp * 0.2 + o;
    float n1 = texture(uNoise, uv + vec2(t, -t * 0.7)).r;
    vec2 wv = uv * 2.2 + (n1 - 0.5) * 0.45 + vec2(-t * 1.6, t * 1.1);
    float n2 = texture(uNoise, wv).a;
    float n3 = texture(uNoise, uv * 4.7 + (n2 - 0.5) * 0.3 + vec2(t * 2.3, t * 1.9)).b;
    float lo = (n1 * 0.55 + n2 * 0.45 - 0.5) * 2.4;
    float hi = (n2 * 0.4 + n3 * 0.6 - 0.5) * 2.6;
    // coverage-style density: the noise decides the silhouette, the round falloff only biases it,
    // so no puff ever shows a circular edge; it erodes into finer wisps as it ages
    float cov = clamp(0.5 + 0.5 * mix(lo, hi, 0.3 + 0.5 * age), 0.0, 1.0);
    float base = 1.0 - r2;
    base = base * base * (3.0 - 2.0 * base);
    float dens = clamp((base * 1.1 - (1.0 - cov) * 0.95 - age * age * 0.45) * 1.7, 0.0, 1.0);
    a = 1.0 - exp(-dens * 2.4);
    // light: a lumpy volume, the undersides self-shadowed, thin parts forward-scattering the sun
    vec2 qn = vScr / vLen * 0.55 + vec2(n2 - 0.5, n1 - 0.5) * 1.1;
    vec3 n = sphereN(qn * min(1.0, 0.95 / max(length(qn), 1e-3)));
    float ndl = dot(n, L);
    float tau = dens * 1.6 * (1.2 - ndl);
    float trans = exp(-tau) * 0.6 + 0.4 * (0.6 + 0.4 * ndl);
    vec3 sunTerm = mix(vSun, vSunIso, dens * 0.8) * trans;
    vec3 amb = skyLight(n) * (1.0 - 0.3 * dens * (0.5 - 0.5 * n.y)) * 0.95;
    col = vCol.rgb * (sunTerm * 0.9 + amb + vec3(0.8, 0.85, 1.0) * uFlash * 0.6);
  } else if (kind < 1.5) {
    // ---- glow: a soft bokeh disc with a gentle core (bioluminescence out of focus)
    float r = length(p);
    float disc = 1.0 - smoothstep(0.78, 1.0, r);
    float core = exp(-r * r * 10.0);
    a = disc * (0.26 + 0.08 * smoothstep(0.5, 0.92, r)) + core * 0.6;
    col = mix(vec3(dot(vCol.rgb, vec3(0.2126, 0.7152, 0.0722))), vCol.rgb, 0.82);
  } else if (kind < 2.5) {
    // ---- glint: a tiny bright point with a faint halo, twinkling
    float r2 = dot(p, p);
    float tw = 0.65 + 0.35 * sin(uTime * 7.0 + seed * 17.0);
    a = (exp(-r2 * 16.0) * 0.9 + exp(-r2 * 3.5) * 0.12) * tw;
  } else if (kind < 3.5 || (kind > 8.5 && kind < 9.5)) {
    // ---- droplets. A water drop is a tiny lens: it shows the world upside down (sky in its lower
    // half, the sea in its upper half), a dark rim, a sharp sun glint and a caustic spot opposite.
    vec3 Vw = camBack();
    vec3 H = normalize(L + Vw);
    vec3 Lv = vec3(dot(L, camRight()), dot(L, camUp()), dot(L, camBack()));
    float fwd = clamp(-Lv.z * 0.5 + 0.5, 0.0, 1.0); // 1 when the sun is behind the drop
    vec3 sunC = vSunIso;
    float hl = vLen - 1.0;
    if (kind < 3.5) {
      // the streak frame: along the motion in drop radii
      vec2 m = vec2(p.x * vLen, p.y);
      vec2 dd = m - vec2(clamp(m.x, -hl, hl), 0.0);
      float r2 = dot(dd, dd);
      if (r2 > 1.0) discard;
      // back to the screen frame for the normal
      vec2 d2 = vAx * dd.x + vec2(-vAx.y, vAx.x) * dd.y;
      vec3 n = sphereN(d2);
      float aa = clamp(1.5 / max(vPx, 1.0), 0.02, 0.6);
      float edge = 1.0 - smoothstep(1.0 - aa, 1.0, sqrt(r2));
      float rr = sqrt(r2);
      vec3 env = mix(skyLight(vec3(0.0, 0.6, 0.0)) * 1.15, skyLight(vec3(0.0, -0.5, 0.0)), smoothstep(-0.45, 0.55, n.y));
      float rim = smoothstep(0.55, 0.97, rr);
      col = env * (1.0 - 0.75 * rim);
      float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, Vw), 0.0), 5.0);
      col += skyLight(reflect(-Vw, n)) * F * 0.8;
      float sharp = mix(60.0, 900.0, clamp(vPx / 14.0, 0.0, 1.0));
      col += sunC * pow(max(dot(n, H), 0.0), sharp) * (6.0 + sharp * 0.02);
      vec2 cs = -Lv.xy * 0.55;
      col += sunC * exp(-dot(d2 - cs, d2 - cs) * 30.0) * (0.4 + 1.6 * fwd);
      col += vec3(0.06, 0.45, 0.8) * uWaterParams.z * 0.5;
      col *= vCol.rgb;
      // a streak is as faint as the fraction of the exposure each pixel saw the drop
      a = edge * sqrt(max(1.0 - dd.y * dd.y, 0.0)) / vLen;
      a *= 0.75 + 0.25 * rim;
    } else {
      // ---- whitewater spray: a sheet breaking into fine droplets, streaked along its flight
      vec2 m = vec2(p.x * vLen, p.y);
      float spread = 0.3 + 0.7 * sqrt(age);
      float acc = 0.0, gl = 0.0;
      float px = max(vPx, 0.5);
      for (int i = 0; i < 12; i++) {
        float fi = float(i);
        vec2 off = (vec2(h1(seed + fi * 1.37), h1(seed + fi * 2.71)) * 2.0 - 1.0) * spread * 0.82;
        float hs = h1(seed + fi * 3.33);
        float rr = (0.025 + 0.09 * hs * hs) * (1.0 - 0.4 * age);
        float rmin = 0.75 / px;
        float k = rr < rmin ? (rr / rmin) * (rr / rmin) : 1.0;
        rr = max(rr, rmin);
        vec2 dd = m - off;
        dd.x -= clamp(dd.x, -hl, hl);
        float dist = length(dd) / rr;
        float c = (1.0 - smoothstep(0.6, 1.0, dist)) * k / (1.0 + hl / rr);
        acc += c;
        gl = max(gl, c * pow(fract(seed * 7.7 + fi * 0.618 + uTime * 0.9), 24.0));
      }
      // the unbroken sheet early on: a torn translucent film
      float n = texture(uNoise, p * 0.25 + seed * 0.37).g;
      float sheet = (1.0 - smoothstep(0.0, 1.0, dot(p, p))) * smoothstep(age * 1.6, age * 1.6 + 0.25, n) * (1.0 - smoothstep(0.0, 0.35, age)) * 0.55;
      // the fine mist between the drops
      float haze = (1.0 - smoothstep(0.1, 1.0, length(m / vec2(vLen, 1.0)))) * 0.12 * (1.0 - age);
      a = clamp(acc + sheet + haze, 0.0, 1.0);
      if (a < 0.003) discard;
      // whitewater is white by multiple scattering: lit by the sun all round, the sky, a glint
      vec3 amb = skyLight(vec3(0.0, 0.7, 0.0));
      col = vCol.rgb * (sunC * (0.55 + 0.35 * fwd) + amb * 0.9) + sunC * gl * 4.0;
      col += vec3(0.06, 0.45, 0.8) * uWaterParams.z * 0.5;
    }
  } else if (kind < 4.5) {
    // ---- an air bubble in water: clear, with a silver rim where the light reflects totally inside
    // (past 48.6 degrees), the bright surface mirrored in its top, a sharp highlight and a caustic
    float wob = 0.07 * sin(uTime * 11.0 + seed * 9.0) * smoothstep(0.004, 0.05, vSize);
    float flat_ = mix(1.0, 1.3, smoothstep(0.04, 0.3, vSize)); // big bubbles flatten into caps
    vec2 q = vec2(p.x * (1.0 + wob), p.y * (1.0 - wob) * flat_);
    float r2 = dot(q, q);
    if (r2 > 1.0) discard;
    float rr = sqrt(r2);
    vec3 n = sphereN(q);
    vec3 Vw = camBack();
    vec3 R = reflect(-Vw, n);
    vec3 surf = (uSkyAmbient * 1.4 + vSunIso * 0.6 * max(uSunDir.y, 0.0)) * (1.0 - uNight * 0.6) + uWaterTint * 1.5;
    vec3 deep = uWaterTint * 0.8 + uFogColor * 0.05;
    vec3 env = mix(deep, surf, smoothstep(-0.2, 0.45, R.y));
    float tir = smoothstep(0.6, 0.8, rr);
    float aa = clamp(1.5 / max(vPx, 1.0), 0.02, 0.6);
    float edge = 1.0 - smoothstep(1.0 - aa, 1.0, rr);
    // the sun under water: bent into Snell's window
    vec3 Lw = normalize(vec3(uSunDir.x * 0.75, max(uSunDir.y, 0.05) + 0.6, uSunDir.z * 0.75));
    float sharp = mix(40.0, 500.0, clamp(vPx / 14.0, 0.0, 1.0));
    float spec = pow(max(dot(R, Lw), 0.0), sharp) * (3.0 + sharp * 0.01);
    vec3 Lv = vec3(dot(Lw, camRight()), dot(Lw, camUp()), dot(Lw, camBack()));
    vec2 cs = -Lv.xy * 0.5;
    float caus = exp(-dot(q - cs, q - cs) * 18.0) * 0.35;
    col = env * (0.25 + 0.9 * tir) + (vSunIso + uSkyAmbient * 0.5) * (spec + caus);
    col += vec3(0.06, 0.45, 0.8) * uWaterParams.z * 0.3;
    col *= vCol.rgb;
    a = edge * (0.1 + 0.75 * tir + min(spec + caus, 1.0) * 0.8);
    // a bubble only a few pixels wide reads as a silver glint, as on film
    float tiny = 1.0 - smoothstep(1.5, 4.0, vPx);
    col = mix(col, (surf * 1.25 + vSunIso * 0.45) * vCol.rgb, tiny);
    a = mix(a, edge * (0.55 + 0.4 * (1.0 - rr)), tiny);
  } else if (kind < 5.5) {
    // ---- marine snow: a soft, slightly out-of-focus fleck lit by the water light
    float r = length(p);
    float n = texture(uNoise, p * 0.2 + seed).r;
    a = (1.0 - smoothstep(0.25, 1.0, r)) * (0.55 + 0.45 * n) * 0.8;
    col = (uWaterTint * 2.2 + uSkyAmbient * 0.12 + vSunIso * 0.03) * vCol.rgb;
  } else if (kind < 8.5) {
    // ---- a capillary ring on the sea: a crest that mirrors the bright sky, a darker trough inside
    float r = length(vScr);
    if (r > 1.0) discard;
    float w = vParam.z < 1.0 ? max(vParam.z, 0.01) : 0.06;
    float R0 = 0.82;
    float x = (r - R0) / w;
    float crest = exp(-x * x * 1.6);
    float trough = exp(-(x + 1.7) * (x + 1.7) * 1.6);
    float inner = exp(-pow((r - R0 * 0.55) / (w * 0.8), 2.0) * 1.6) * 0.45 * (1.0 - age);
    float fadeR = 1.0 - smoothstep(0.9, 1.0, r);
    vec3 skyc = skyLight(vec3(0.0, 0.35, 0.0)) * 1.1 + vSunIso * 0.04;
    vec3 dark = uFogColor * 0.18 + uWaterTint * 0.4;
    float cr = crest + inner;
    col = mix(dark, skyc, cr / max(cr + trough, 1e-3)) * vCol.rgb;
    a = (cr * 0.6 + trough * 0.35) * fadeR * (1.0 - age * age);
  } else {
    // ---- petal / leaf: a small soft-edged oval tumbling as it falls, lit through when backlit
    float fl = abs(cos(age * 9.0 * (0.5 + h1(seed)) + seed * 3.0));
    vec2 q = vec2(p.x, p.y / max(fl, 0.18) * 1.8);
    float r = length(q);
    a = 1.0 - smoothstep(0.75, 1.0, r);
    vec3 Lv = vec3(dot(L, camRight()), dot(L, camUp()), dot(L, camBack()));
    float back = clamp(-Lv.z, 0.0, 1.0);
    col = vCol.rgb * (vSunIso * (0.35 + 0.4 * fl + 0.5 * back) + skyLight(vec3(0.0, 0.6, 0.0)) * 0.8);
  }
  a *= vCol.a;
  vec2 suv = gl_FragCoord.xy / uResolution;
  float sceneZ = sceneDepthAt(suv);
  // soft against geometry (rings on the sea tolerate a little: they lie on it)
  float soft = kind > 7.5 && kind < 8.5 ? 0.6 : max(vSize * 0.6, 0.05);
  a *= clamp((sceneZ - vViewZ + (kind > 7.5 && kind < 8.5 ? 0.3 : 0.0)) / soft, 0.0, 1.0);
  // nothing veils the view: puffs fade as the camera nears them or they fill much of the screen
  float nearK = kind < 0.5 || (kind > 5.5 && kind < 7.5)
    ? smoothstep(vSize * 1.2, vSize * 4.0, vViewZ) * (1.0 - smoothstep(0.08, 0.25, vSize / max(vViewZ, 0.1)))
    : smoothstep(vSize * 0.35, vSize * 1.5, vViewZ);
  a *= smoothstep(0.3, 1.5, vViewZ) * nearK;
  if (a < 0.002) discard;
  if (uAdditive > 0.5) {
    col *= 1.0 - vFog;
    gl_FragColor = vec4(col * a, 0.0);
  } else {
    col = mix(col, vFogCol, vFog);
    gl_FragColor = vec4(col * a, a);
  }
}
`;

const MAXPOP = 48;

export class Particles {
  constructor(game, { max = 3000, additive = false, name = 'particles', order = 20 } = {}) {
    this.game = game;
    this.max = max;
    this.additive = additive;
    this.n = 0;
    // sim state
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.kind = new Float32Array(max);
    this.seed = new Float32Array(max);
    this.fadeIn = new Float32Array(max);
    this.stretch = new Float32Array(max);
    this.surf = new Float32Array(max); // bubbles: the sea surface above them (refreshed near it)
    this._pops = new Float32Array(MAXPOP * 4);
    this._nPop = 0;
    this._pe = { pos: new Vector3(), vel: new Vector3(), life: 0.6, size: 0.05, sizeEnd: 0.3, alpha: 0.5, drag: 0, gravity: 0, kind: 8, color: [1, 1, 1], fadeIn: 0.02, stretch: 0.08 };
    const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new BufferAttribute(quad, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(DynamicDrawUsage);
    this.aCol = new InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(DynamicDrawUsage);
    this.aParam = new InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(DynamicDrawUsage);
    this.aVel = new InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(DynamicDrawUsage);
    this._attrs = [this.aPos, this.aCol, this.aParam];
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aVel', this.aVel);
    geo.setAttribute('aCol', this.aCol);
    geo.setAttribute('aParam', this.aParam);
    geo.instanceCount = 0;
    this.geo = geo;
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: Object.assign({}, G, {
        uNoise: { value: getNoiseTexture() },
        uAdditive: { value: additive ? 1 : 0 },
        uShutter: { value: 1 / 120 },
      }),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: additive ? OneFactor : OneMinusSrcAlphaFactor,
      premultipliedAlpha: true,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.name = name;
    game.engine.sceneT.add(this.mesh);
    this.wind = null;
  }

  /**
   * o: { pos, vel, life, size (radius, m), sizeEnd, color (Color or [r,g,b]), alpha, drag, gravity,
   *      kind (see the table at the top), fadeIn,
   *      stretch (6/7: wisp length; 8: ring width as a fraction of its radius when < 1) }
   */
  emit(o) {
    let i;
    if (this.n < this.max) i = this.n++;
    else {
      // recycle the oldest-looking particle
      i = (this._rr = ((this._rr || 0) + 1) % this.max);
    }
    const p = o.pos, v = o.vel;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v ? v.x : 0; this.vel[i * 3 + 1] = v ? v.y : 0; this.vel[i * 3 + 2] = v ? v.z : 0;
    const c = o.color;
    const cr = c ? (c.isColor ? c.r : c[0]) : 1, cg = c ? (c.isColor ? c.g : c[1]) : 1, cb = c ? (c.isColor ? c.b : c[2]) : 1;
    this.col[i * 4] = cr; this.col[i * 4 + 1] = cg; this.col[i * 4 + 2] = cb; this.col[i * 4 + 3] = o.alpha ?? 1;
    this.life[i] = o.life ?? 2;
    this.age[i] = 0;
    this.size0[i] = o.size ?? 1;
    this.size1[i] = o.sizeEnd ?? (o.size ?? 1) * 2;
    this.drag[i] = o.drag ?? 0.6;
    this.grav[i] = o.gravity ?? 0;
    this.kind[i] = o.kind ?? 0;
    this.seed[i] = Math.random() * 10;
    this.fadeIn[i] = o.fadeIn ?? 0.15;
    this.stretch[i] = o.stretch ?? 4;
    this.surf[i] = G.uSeaLevel.value;
  }

  update(dt) {
    let w = 0;
    const P = this.aPos.array, C = this.aCol.array, Q = this.aParam.array, V = this.aVel.array;
    const wind = G.uWind.value;
    // a 180-degree shutter: streaks are the distance moved in half a frame
    if (dt > 0) this.material.uniforms.uShutter.value = Math.min(1 / 30, Math.max(1 / 480, dt * 0.5));
    const ocean = this.game?.ocean;
    let probes = 24; // sea-height lookups per frame for bubbles nearing the surface
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // swap-remove
        const last = this.n - 1;
        if (i !== last) this._copy(last, i);
        this.n--;
        i--;
        continue;
      }
      const kd = this.kind[i];
      const k = Math.exp(-this.drag[i] * dt);
      const i3 = i * 3;
      if (kd === 4) {
        // an air bubble: buoyancy against drag holds it near its terminal rise speed (bigger rise
        // faster), and it bursts when it reaches the surface
        const r = this.size0[i] + (this.size1[i] - this.size0[i]) * (this.age[i] / this.life[i]);
        const vt = 0.22 + 0.75 * Math.sqrt(9.8 * Math.min(r, 0.5));
        const kb = Math.exp(-Math.max(this.drag[i], 1.5) * dt);
        this.vel[i3] *= kb;
        this.vel[i3 + 2] *= kb;
        this.vel[i3 + 1] = this.vel[i3 + 1] * kb + vt * (1 - kb);
        const y = this.pos[i3 + 1];
        if (y > this.surf[i] - 1.2 && probes > 0 && ocean?.heightApprox) {
          probes--;
          this.surf[i] = ocean.heightApprox(this.pos[i3], this.pos[i3 + 2]);
        }
        if (y > this.surf[i] - r * 0.5) {
          if (this._nPop < MAXPOP && G.uUnderwater.value < 0.5) {
            const q = this._nPop++ * 4;
            this._pops[q] = this.pos[i3]; this._pops[q + 1] = this.surf[i]; this._pops[q + 2] = this.pos[i3 + 2]; this._pops[q + 3] = r;
          }
          this.age[i] = this.life[i];
          i--;
          continue;
        }
      } else {
        // bubbles and motes live under the sea, out of the wind; vapour rides it fully
        const wk = kd > 3.5 && kd < 5.5 ? 0 : (1 - k) * (kd === 0 ? 0.9 : 0.6);
        this.vel[i3] = this.vel[i3] * k + wind.x * wk;
        this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * dt;
        this.vel[i3 + 2] = this.vel[i3 + 2] * k + wind.z * wk;
      }
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = this.age[i] / this.life[i];
      const fade = Math.min(1, this.age[i] / Math.max(this.fadeIn[i], 1e-3)) * (1 - t * t);
      const w4 = w * 4;
      P[w4] = this.pos[i3]; P[w4 + 1] = this.pos[i3 + 1]; P[w4 + 2] = this.pos[i3 + 2];
      P[w4 + 3] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      C[w4] = this.col[i * 4]; C[w4 + 1] = this.col[i * 4 + 1]; C[w4 + 2] = this.col[i * 4 + 2];
      C[w4 + 3] = this.col[i * 4 + 3] * fade;
      Q[w4] = this.seed[i]; Q[w4 + 1] = t; Q[w4 + 2] = this.stretch[i]; Q[w4 + 3] = kd;
      const w3 = w * 3;
      V[w3] = this.vel[i3]; V[w3 + 1] = this.vel[i3 + 1]; V[w3 + 2] = this.vel[i3 + 2];
      w++;
    }
    this.geo.instanceCount = w;
    if (w > 0) {
      for (let k = 0; k < 3; k++) {
        const a = this._attrs[k];
        a.clearUpdateRanges();
        a.addUpdateRange(0, w * 4);
        a.needsUpdate = true;
      }
      this.aVel.clearUpdateRanges();
      this.aVel.addUpdateRange(0, w * 3);
      this.aVel.needsUpdate = true;
    }
    if (this._nPop) this._burst();
  }

  /** Bubbles that reached the surface: a ring, and for the bigger ones a jet of tiny drops. */
  _burst() {
    const E = this._pe, pp = this._pops;
    for (let j = 0; j < this._nPop; j++) {
      const q = j * 4, r = pp[q + 3];
      E.pos.set(pp[q], pp[q + 1] + 0.03, pp[q + 2]);
      E.vel.set(0, 0, 0);
      E.kind = 8; E.life = 0.5 + r * 4; E.size = r * 1.2; E.sizeEnd = r * 5 + 0.15; E.alpha = 0.45;
      E.drag = 0; E.gravity = 0; E.fadeIn = 0.02; E.stretch = 0.09;
      E.color[0] = 1; E.color[1] = 1; E.color[2] = 1;
      this.emit(E);
      const nd = r > 0.04 ? 2 + (r > 0.12 ? 2 : 0) : (Math.random() < 0.4 ? 1 : 0);
      for (let d = 0; d < nd; d++) {
        E.kind = 3; E.life = 0.35 + Math.random() * 0.3; E.size = 0.004 + r * 0.06; E.sizeEnd = E.size;
        E.vel.set((Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 2.2 * Math.sqrt(r * 10 + 0.2), (Math.random() - 0.5) * 0.6);
        E.alpha = 0.9; E.drag = 0.3; E.gravity = 9.8; E.fadeIn = 0.01;
        this.emit(E);
      }
    }
    this._nPop = 0;
  }

  _copy(from, to) {
    for (let k = 0; k < 3; k++) { this.pos[to * 3 + k] = this.pos[from * 3 + k]; this.vel[to * 3 + k] = this.vel[from * 3 + k]; }
    for (let k = 0; k < 4; k++) this.col[to * 4 + k] = this.col[from * 4 + k];
    this.life[to] = this.life[from]; this.age[to] = this.age[from];
    this.size0[to] = this.size0[from]; this.size1[to] = this.size1[from];
    this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from];
    this.kind[to] = this.kind[from]; this.seed[to] = this.seed[from]; this.fadeIn[to] = this.fadeIn[from];
    this.stretch[to] = this.stretch[from]; this.surf[to] = this.surf[from];
  }
}

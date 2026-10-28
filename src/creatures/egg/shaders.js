// GLSL of the whale egg: the translucent membrane (refracting the embryo drawn in the opaque pass,
// milky amniotic glow, hand-drawn veins, spreading crack lines with light leaking through), the
// embryo's skin and the burst shell's fragments. Painterly light from common.js (stylizedLight,
// applyFog); fog is applied against the local water level so an egg floating in the dip of a
// maelstrom's eye is not tinted as if it were metres under the sea.
import { UNIFORMS, NOISE, SHADOW, LIGHTING, DEPTH } from '../../render/shaders/common.js';

/** Shared bits: local-sea fog, veins (ridged warped noise: wobbling, branching, tapering lines). */
const EGG_COMMON = /* glsl */ `
uniform float uLocalSea;   // the water surface height at the egg (m)
vec3 eggFog(vec3 col, vec3 P) {
  return applyFog(col, P - vec3(0.0, uLocalSea - uSeaLevel, 0.0));
}
// veins on the membrane (q: egg-local position, unit scale): big vessels and finer capillaries
float eggVeins(vec3 q, out float cap) {
  vec3 w = q * 2.1 + vec3(fbm3(q * 1.7 + 3.1), fbm3(q * 1.7 + 7.7), fbm3(q * 1.7 + 1.3)) * 1.1;
  float n = fbm3(w);
  float big = 1.0 - abs(n - 0.5) * 2.0;
  float wid = mix(0.86, 0.95, vnoise3(q * 5.0 + 2.0));
  float vb = smoothstep(wid, 0.995, big);
  vec3 w2 = q * 5.3 + w * 0.6;
  float n2 = fbm3(w2 + 11.0);
  float small = 1.0 - abs(n2 - 0.5) * 2.0;
  // capillaries thin out away from the vessels and break into strokes
  cap = smoothstep(0.9, 0.99, small) * smoothstep(0.6, 0.9, big) * smoothstep(0.3, 0.6, vnoise3(q * 9.0));
  return vb;
}
`;

// ------------------------------------------------------------------------------------------
export const SHELL_VERT = /* glsl */ `
${UNIFORMS}
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying float vViewZ;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 mv = viewMatrix * wp;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const SHELL_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
${DEPTH}
${EGG_COMMON}
uniform sampler2D uSceneTex;
uniform mat4 uProj;
uniform vec3 uHalf;         // egg semi-axes (m)
uniform float uGlow;        // inner light 0..~2
uniform float uBeat;        // heartbeat 0..1 (the throb right now)
uniform float uCrack;       // 0..1 crack spread
uniform vec3 uCrackDir;     // egg-local unit direction where the first crack starts
uniform float uAlpha;       // whole-shell fade
uniform vec3 uMembrane;     // membrane tint
uniform vec3 uFluid;        // amniotic fluid tint
uniform vec3 uVein;         // vein colour
uniform vec3 uLeak;         // light leaking through cracks
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying float vViewZ;

// hand-drawn crack network spreading from uCrackDir: a few wobbling main lines radiating from the
// origin, branching jagged side cracks near them; widths swell and taper, the front fades in strokes
float crackLines(vec3 q, out float halo) {
  vec3 u = normalize(q / uHalf);
  vec3 o = normalize(uCrackDir);
  float gd = acos(clamp(dot(u, o), -1.0, 1.0));                   // geodesic distance (rad)
  vec3 t1 = normalize(cross(o, abs(o.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(o, t1);
  float az = atan(dot(u, t2), dot(u, t1));
  float reach = uCrack * 2.4;
  // main cracks: 5 radiating lines whose azimuth wanders with distance (no straight strokes)
  float wander = (fbm2(vec2(gd * 3.1, az * 0.8 + 4.0)) - 0.5) * 1.3 + sin(gd * 9.0 + az * 3.0) * 0.06;
  float a = az * 5.0 / 6.2831853 + wander;
  float d = abs(fract(a) - 0.5) / 5.0 * 6.2831853 * sin(max(gd, 0.05));
  float wdt = 0.045 * (0.5 + 0.9 * vnoise(vec2(gd * 14.0, floor(a) * 3.7))) * (1.0 - smoothstep(reach * 0.75, reach, gd)) * smoothstep(0.0, 0.12, gd + 0.04);
  float main = smoothstep(wdt, wdt * 0.3, d) * step(gd, reach);
  // branching side cracks: a ridged warped field, only near the main lines and inside the reach
  vec3 w = u * 6.0 + vec3(fbm3(u * 4.0), fbm3(u * 4.0 + 5.0), 0.0) * 0.8;
  float r = 1.0 - abs(fbm3(w + 2.0) - 0.5) * 2.0;
  float side = smoothstep(0.9, 0.975, r) * smoothstep(0.3, 0.0, d) * step(gd, reach * 0.85);
  side *= smoothstep(0.25, 0.55, vnoise3(u * 11.0));
  // a fine craze of hairlines around the origin
  float hz = 1.0 - abs(vnoise3(u * 22.0 + w) - 0.5) * 2.0;
  float craze = smoothstep(0.95, 0.99, hz) * (1.0 - smoothstep(reach * 0.15, reach * 0.4, gd)) * step(0.02, uCrack);
  halo = exp(-d * 12.0) * step(gd, reach) * (1.0 - gd / max(reach, 1e-3));
  return max(main, max(side * 0.8, craze * 0.6));
}

void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 P = vWorld;
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - P);
  float nv = clamp(dot(N, V), 0.0, 1.0);
  vec2 suv = gl_FragCoord.xy / uResolution;
  // drawn after the sea (its waterline must not hide the shell): test against the opaque depth
  float sceneZ = sceneDepthAt(suv);
  if (sceneZ < vViewZ - 0.03) discard;
  vec3 q = vLocal / max(uHalf.y, 1e-3);

  float cap;
  float vein = eggVeins(q, cap);
  float halo;
  float crack = uCrack > 0.0 ? crackLines(vLocal, halo) : 0.0;
  if (uCrack <= 0.0) halo = 0.0;

  // ---- inside: the embryo (opaque pass) seen through the fluid, magnified and softened -----------
  float thick = 2.0 * uHalf.y * nv + 0.15;
  vec3 Nv = mat3(viewMatrix) * N;
  vec2 off = Nv.xy * (0.06 + 0.05 * (1.0 - nv)) * (uHalf.y / max(vViewZ, 0.5)) * 3.0;
  vec2 ruv = clamp(suv + off, vec2(0.001), vec2(0.999));
  float bz = sceneDepthAt(ruv);
  float behind = bz - vViewZ;
  float inside = step(-0.05, behind) * step(behind, uHalf.x * 2.2);
  float blur = clamp(behind * 2.5, 0.5, 4.0) / uResolution.y * 900.0 / max(vViewZ, 1.0);
  vec2 bo = vec2(blur) / uResolution * 2.0;
  vec3 emb = texture(uSceneTex, ruv).rgb * 0.36
           + (texture(uSceneTex, ruv + vec2(bo.x, bo.y)).rgb + texture(uSceneTex, ruv + vec2(-bo.x, bo.y)).rgb
           + texture(uSceneTex, ruv + vec2(bo.x, -bo.y)).rgb + texture(uSceneTex, ruv - bo).rgb) * 0.16;
  // light inside: the egg's own glow throbbing with the heart, and sunlight soaking through
  float sunUp = smoothstep(-0.1, 0.25, uSunDir.y);
  float back = pow(max(dot(-V, uSunDir), 0.0), 2.0);
  float beat = 0.75 + 0.5 * uBeat;
  vec3 inner = uFluid * (uGlow * beat * 0.55 + 0.08) + uFluid * uSunColor * (0.15 + 1.0 * back) * sunUp * 0.35
             + uFluid * uSkyAmbient * 0.3 + uFluid * uMoonColor * uNight * 0.4;
  // brighter toward the middle of the egg (the light source is the embryo's heart and yolk)
  inner *= 0.35 + 0.95 * pow(nv, 1.8);
  // toward the rim the fluid cools to the membrane's sea-glass teal
  inner = mix(inner, uMembrane * (uSkyAmbient * 0.9 + uSunColor * 0.25), pow(1.0 - nv, 2.0) * 0.6);
  vec3 fluidT = exp(-vec3(0.3, 0.55, 0.8) * max(behind, 0.0) * 0.55);
  // the calf reads as a warm, shadowed form against the glowing fluid (a backlit silhouette)
  vec3 interior = mix(inner, emb * fluidT * vec3(0.95, 0.62, 0.55) + inner * (1.0 - fluidT) * 0.5, inside * 0.95);

  // ---- the membrane ----------------------------------------------------------------------------
  vec3 albedo = uMembrane * (0.9 + 0.2 * fbm3(q * 7.0));
  albedo = mix(albedo, uVein, vein * 0.75 + cap * 0.35);
  Surface s = makeSurface(albedo, N, P);
  s.shadow = 1.0;
  s.rim = 0.9;
  s.spec = 0.0;
  s.wrap = 0.32;
  s.trans = 0.9;
  vec3 mem = stylizedLight(s);
  // pearly, milkier where the membrane is seen edge-on; veins a little more opaque
  float fres = pow(1.0 - nv, 2.2);
  float opac = clamp(0.2 + 0.62 * fres + vein * 0.42 + cap * 0.2, 0.0, 0.95);
  vec3 col = mix(interior, mem, opac);
  // the vessels carry the pulse: a faint warm throb along them
  col += uVein * (vein + cap * 0.5) * uBeat * uGlow * 0.35;
  // wet glossy highlights: sun, sky and a soft sheen
  vec3 H = normalize(V + uSunDir);
  float sp = pow(max(dot(N, H), 0.0), 220.0) * 5.0 + pow(max(dot(N, H), 0.0), 30.0) * 0.18;
  col += uSunColor * sp * sunUp;
  vec3 R = reflect(-V, N);
  col += mix(uSkyHorizon, uSkyZenith, clamp(R.y, 0.0, 1.0)) * fres * 0.28;
  col += uMoonColor * pow(max(dot(N, normalize(V + uMoonDir)), 0.0), 120.0) * 2.0 * uNight;

  // ---- cracks: dark broken edges with hot light leaking through ---------------------------------
  if (uCrack > 0.0) {
    // a dark torn rim either side of a hot seam of light
    float edge = smoothstep(0.0, 0.35, crack + halo * 0.4);
    col = mix(col, vec3(0.16, 0.06, 0.07), edge * 0.7);
    float seam = smoothstep(0.55, 1.0, crack);
    col += uLeak * (seam * (3.0 + 2.5 * uBeat) + halo * 0.35) * (0.6 + uGlow * 0.6) * min(1.0, uCrack * 3.0);
  }
  // the waterline: a bright wobbling meniscus, and the submerged half seen through the water
  float wl = P.y - uLocalSea + (vnoise(P.xz * 3.0 + uTime * 0.6) - 0.5) * 0.05;
  float subm = smoothstep(0.01, -0.06, wl);
  vec3 wcol = uWaterTint * (1.2 + 0.6 * dot(uSkyAmbient, vec3(0.33)));
  vec3 Tw = exp(-uWaterAbsorb * (max(-wl, 0.0) * 2.0 + 0.6));
  col = mix(col, col * Tw + wcol * (1.0 - Tw), subm);
  col += (uSkyAmbient * 0.8 + uSunColor * 0.3) * exp(-abs(wl) / 0.025) * 0.5;
  col = eggFog(col, P);
  gl_FragColor = vec4(col * uAlpha, uAlpha);
}
`;

// ------------------------------------------------------------------------------------------
// The embryo: a tube along a curled spine (uniform samples written by the CPU each frame), with fin
// buds, flukes, closed eyes. aT: spine parameter 0 (snout) .. 1 (tail tip); aOff: offset in the
// spine frame (along, in-plane normal = dorsal, lateral); aRing.x: angle around the body, y: part.
export const EMBRYO_VERT = /* glsl */ `
${UNIFORMS}
#define NSPINE 24
uniform vec4 uSpine[NSPINE];   // xyz position (egg-local), w: heading angle in the curl plane
uniform vec2 uSpineZ[NSPINE];  // x: lateral (helix) offset, y: unused
attribute float aT;
attribute vec3 aOff;
attribute vec2 aRing;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vRing;
varying float vT;
void main() {
  float f = clamp(aT, 0.0, 1.0) * float(NSPINE - 1);
  int i0 = int(floor(f));
  int i1 = min(i0 + 1, NSPINE - 1);
  float k = f - float(i0);
  vec4 s0 = uSpine[i0], s1 = uSpine[i1];
  vec3 sp = mix(s0.xyz, s1.xyz, k);
  float ang = mix(s0.w, s1.w, k);
  float lat = mix(uSpineZ[i0].x, uSpineZ[i1].x, k);
  vec3 T = vec3(cos(ang), sin(ang), 0.0);
  vec3 Nd = vec3(-sin(ang), cos(ang), 0.0);
  vec3 L = vec3(0.0, 0.0, 1.0);
  vec3 lp = sp + vec3(0.0, 0.0, lat) + T * aOff.x + Nd * aOff.y + L * aOff.z;
  // the normal: the cross-section's own direction (tube) or the fin's face
  vec3 n0 = normal;
  vec3 nl = normalize(T * n0.x + Nd * n0.y + L * n0.z);
  vec4 wp = modelMatrix * vec4(lp, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * nl);
  vRing = aRing;
  vT = aT;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const EMBRYO_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
${EGG_COMMON}
uniform float uGlow;
uniform float uBeat;
uniform vec3 uSkin;      // pale flesh
uniform vec3 uBack;      // the first blue of the back
uniform vec3 uFluid;
uniform float uFade;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vRing;
varying float vT;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  if (uFade <= 0.0) discard;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float part = vRing.y;          // 0 body, 1 fin
  float ca = cos(vRing.x);       // +1 dorsal, -1 ventral (body)
  float lateral = sin(vRing.x);
  // countershading already: a soft blue-grey back over translucent pink flesh
  float dors = smoothstep(-0.2, 0.7, ca) * (part < 0.5 ? 1.0 : 0.6);
  vec3 alb = mix(uSkin, uBack, dors * 0.55);
  // faint dorsal spots and the first ventral pleat lines (wobbling, broken)
  float pleat = 1.0 - abs(fract(vRing.x * 3.2 + sin(vT * 40.0) * 0.08) - 0.5) * 2.0;
  pleat = smoothstep(0.86, 0.97, pleat) * smoothstep(0.1, 0.25, vT) * smoothstep(0.45, 0.3, vT) * smoothstep(-0.3, -0.7, ca);
  alb *= 1.0 - pleat * 0.25;
  float spots = smoothstep(0.62, 0.72, vnoise(vec2(vT * 38.0, vRing.x * 5.0))) * dors;
  alb = mix(alb, uBack * 0.8, spots * 0.4);
  // fine vessels under the thin skin
  float vv = 1.0 - abs(vnoise(vec2(vT * 60.0, vRing.x * 9.0)) - 0.5) * 2.0;
  alb = mix(alb, vec3(0.75, 0.25, 0.3), smoothstep(0.9, 0.98, vv) * 0.35);
  // four closed eyes (two each side): soft dark lid creases, hand-drawn crescents
  float eye = 0.0;
  if (part < 0.5) {
    for (int e = 0; e < 2; e++) {
      float te = e == 0 ? 0.075 : 0.105;
      float ae = e == 0 ? 0.55 : 0.85;
      vec2 d = vec2((vT - te) * 26.0, abs(vRing.x) - ae);
      d.y += d.x * d.x * 0.18;                    // the lid line curves
      float r = length(d * vec2(1.0, 2.6));
      eye = max(eye, smoothstep(0.32, 0.18, r) * 0.5 + smoothstep(0.06, 0.015, abs(d.y + 0.02)) * smoothstep(0.3, 0.1, abs(d.x)) * 0.9);
    }
  }
  alb = mix(alb, vec3(0.16, 0.1, 0.14), clamp(eye, 0.0, 1.0) * 0.85);
  // the mouth line, a gentle smile under the snout
  if (part < 0.5) {
    float m = abs(ca + 0.25 + (vT - 0.05) * 1.5);
    alb = mix(alb, vec3(0.45, 0.2, 0.25), smoothstep(0.05, 0.0, m) * smoothstep(0.1, 0.02, vT) * 0.7);
  }
  Surface s = makeSurface(alb, N, vWorld);
  s.shadow = 1.0;
  s.ao = mix(0.7, 1.0, smoothstep(-0.8, 0.4, ca));
  s.rim = 0.8;
  s.wrap = 0.34;
  s.trans = 1.2;
  s.spec = 0.25;
  s.gloss = 0.8;
  vec3 col = stylizedLight(s) * 0.7;
  // lit from within the egg: warm glow wrapping the body, the heart throbbing in the chest
  float heart = exp(-pow((vT - 0.24) / 0.06, 2.0)) * smoothstep(0.2, -0.6, ca);
  col += alb * uFluid * uGlow * (0.55 + 0.45 * uBeat) * 0.55;
  col += vec3(1.0, 0.35, 0.3) * heart * uBeat * uGlow * 0.6;
  col = eggFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------------------------------
// Shell fragments after the hatch: curved membrane shards (instanced), lit from both sides.
export const SHARD_VERT = /* glsl */ `
${UNIFORMS}
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying float vSeed;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vSeed = float(gl_InstanceID) * 0.6180339;
  vLocal = position * 1.7 + vec3(fract(vSeed) * 7.0, fract(vSeed * 3.1) * 5.0, 0.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const SHARD_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
${EGG_COMMON}
uniform vec3 uMembrane;
uniform vec3 uVein;
uniform vec3 uLeak;
uniform vec3 uFluid;
uniform float uHot;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying float vSeed;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float cap;
  float vein = eggVeins(vLocal, cap);
  vec3 alb = mix(uMembrane * 0.9, uVein, vein * 0.7 + cap * 0.3);
  Surface s = makeSurface(alb, N, vWorld);
  s.shadow = sampleShadow(vWorld, N);
  s.rim = 0.9;
  s.wrap = 0.3;
  s.trans = 1.0;
  s.spec = 0.6;
  s.gloss = 0.9;
  vec3 col = stylizedLight(s);
  // inner faces still glow with the fluid for a moment after the burst
  col += uFluid * uHot * (0.6 + 0.4 * (1.0 - vein));
  col += uLeak * uHot * vein * 0.6;
  col = eggFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

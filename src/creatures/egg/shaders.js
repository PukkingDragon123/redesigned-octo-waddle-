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
  return applyFog(col, P - vec3(0.0, uLocalSea - localSeaLevel(P.xz), 0.0));
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
uniform vec3 uHalf;         // egg semi-axes (m)
uniform vec3 uCamLocal;     // the camera in egg space
uniform float uGlow;        // inner light 0..~2
uniform float uBeat;        // heartbeat 0..1 (the throb right now)
uniform float uCrack;       // 0..1 crack spread
uniform vec3 uCrackDir;     // egg-local unit direction where the first crack starts
uniform float uAlpha;       // whole-shell fade
uniform vec3 uMembrane;     // membrane tint
uniform vec3 uFluid;        // the inner light (yolk and heart), warm
uniform vec3 uFluidAbs;     // amniotic fluid extinction per metre (rgb): what colour the depth turns
uniform vec3 uScatter;      // light scattered by the fluid itself
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
  float uw = step(0.5, uUnderwater);

  float cap;
  float vein = eggVeins(q, cap);
  float halo = 0.0;
  float crack = uCrack > 0.0 ? crackLines(vLocal, halo) : 0.0;

  // ---- the view ray through the egg: fluid thickness and how close it passes the glowing core ----
  vec3 rd = normalize(vLocal - uCamLocal);
  vec3 ro1 = vLocal / uHalf, rd1 = rd / uHalf;
  float qa = dot(rd1, rd1), qb = 2.0 * dot(ro1, rd1), qc = dot(ro1, ro1) - 1.0;
  float thick = max((-qb + sqrt(max(qb * qb - 4.0 * qa * qc, 0.0))) / (2.0 * qa), 0.02);
  float tc = clamp(-dot(vLocal, rd), 0.0, thick);
  float dc = length(vLocal + rd * tc) / uHalf.y;
  float core = exp(-dc * dc * 3.2);

  // ---- light inside ----------------------------------------------------------------------------
  float sunUp = smoothstep(-0.1, 0.25, uSunDir.y);
  float back = pow(max(dot(-V, uSunDir), 0.0), 2.0);
  float beat = 0.7 + 0.6 * uBeat;
  // daylight coming through the far side of the egg (from the sky, or the bright surface above)
  vec3 envBack = uSkyAmbient * 0.9 + uSunColor * (0.1 + 1.4 * back) * sunUp * 0.45 + uMoonColor * uNight * 0.3;
  vec3 upW = uSkyAmbient * 1.1 + uSunColor * 0.25 * sunUp;
  envBack = mix(envBack, mix(uWaterTint * 4.0, upW, clamp(-V.y, 0.0, 1.0)), uw);
  envBack *= uMembrane;
  // the yolk-and-heart light at the middle and the fluid's own soft scatter
  vec3 glowIn = uFluid * uGlow * beat * (core * 1.6 + 0.12);
  vec3 scat = uScatter * (uSkyAmbient * 0.35 + uSunColor * 0.06 * sunUp + uFluid * uGlow * 0.12);
  vec3 T = exp(-uFluidAbs * thick);
  vec3 inner = envBack * T + (scat + glowIn * 0.6) * (1.0 - T) + glowIn * core * 0.5;

  // ---- the curled calf (drawn in the opaque pass), seen through the fluid in front of it --------
  vec3 Nv = mat3(viewMatrix) * N;
  vec2 off = Nv.xy * (0.04 + 0.05 * (1.0 - nv)) * (uHalf.y / max(vViewZ, 0.5)) * 3.0;
  vec2 ruv = clamp(suv + off, vec2(0.001), vec2(0.999));
  float bz = sceneDepthAt(ruv);
  float behind = bz - vViewZ;
  float inside = step(-0.05, behind) * step(behind, thick + 0.1);
  float blur = clamp(behind * 1.6, 0.3, 3.0) / max(vViewZ, 1.0) * uResolution.y * 0.004;
  vec2 bo = vec2(blur) / uResolution;
  vec3 emb = texture(uSceneTex, ruv).rgb * 0.4
           + (texture(uSceneTex, ruv + vec2(bo.x, bo.y)).rgb + texture(uSceneTex, ruv + vec2(-bo.x, bo.y)).rgb
           + texture(uSceneTex, ruv + vec2(bo.x, -bo.y)).rgb + texture(uSceneTex, ruv - bo).rgb) * 0.15;
  vec3 Te = exp(-uFluidAbs * max(behind, 0.0));
  float front = clamp(behind / thick, 0.0, 1.0);
  // the calf blocks the light behind it: a darker form, rimmed where the glow wraps round it
  vec3 embSeen = emb * Te * 0.8 + scat * (1.0 - Te) * 0.7 + glowIn * 0.08 * front;
  vec3 interior = mix(inner, embSeen, inside);

  // ---- the membrane: clear and wet, veined, milky only edge-on ------------------------------------
  vec3 albedo = uMembrane * (0.85 + 0.25 * fbm3(q * 7.0));
  albedo = mix(albedo, uVein, clamp(vein * 0.9 + cap * 0.5, 0.0, 1.0));
  Surface s = makeSurface(albedo, N, P);
  s.shadow = 1.0;
  s.rim = 0.6;
  s.wrap = 0.3;
  s.trans = 0.6;
  vec3 mem = stylizedLight(s) * 0.85;
  float fres = pow(1.0 - nv, 2.5);
  float opac = clamp(0.05 + 0.6 * fres + vein * 0.6 + cap * 0.3, 0.0, 0.92);
  vec3 col = mix(interior, mem, opac);
  // the vessels carry the pulse
  col += uVein * (vein + cap * 0.5) * uBeat * uGlow * 0.25;
  // wet glossy highlights: a hard sun glint, a broad sheen, the sky in the rim
  vec3 H = normalize(V + uSunDir);
  float nh = max(dot(N, H), 0.0);
  float sp = pow(nh, 420.0) * 9.0 + pow(nh, 60.0) * 0.35;
  col += uSunColor * sp * sunUp * (1.0 - uw * 0.7);
  vec3 R = reflect(-V, N);
  col += mix(uSkyHorizon, uSkyZenith, clamp(R.y, 0.0, 1.0)) * (0.04 + fres * 0.45) * (1.0 - uw * 0.6);
  col += uMoonColor * pow(max(dot(N, normalize(V + uMoonDir)), 0.0), 160.0) * 3.0 * uNight;

  // ---- cracks: dark torn rims with a hot seam of light ------------------------------------------
  if (uCrack > 0.0) {
    float on = min(1.0, uCrack * 4.0);
    float edge = smoothstep(0.0, 0.3, crack + halo * 0.35);
    col = mix(col, vec3(0.05, 0.02, 0.025), edge * 0.85 * on);
    float seam = smoothstep(0.5, 1.0, crack);
    col += uLeak * (seam * (3.5 + 2.5 * uBeat) + halo * 0.25) * (0.7 + uGlow * 0.5) * on;
  }

  // ---- the waterline -------------------------------------------------------------------------------
  float wl = P.y - uLocalSea + (vnoise(P.xz * 3.0 + uTime * 0.6) - 0.5) * 0.05;
  float subm = smoothstep(0.01, -0.06, wl);
  if (uw < 0.5) {
    // from above: the submerged half seen down through the water
    vec3 wcol = uWaterTint * (1.2 + 0.6 * dot(uSkyAmbient, vec3(0.33)));
    vec3 Tw = exp(-uWaterAbsorb * (max(-wl, 0.0) * 2.0 + 0.4));
    col = mix(col, col * Tw + wcol * (1.0 - Tw), subm);
  } else {
    // from below: the part above the water is only glimpsed through the surface
    col = mix(col, col * 0.35 + uWaterTint * 2.0, (1.0 - subm) * 0.6);
  }
  col += (uSkyAmbient * 0.8 + uSunColor * 0.3) * exp(-abs(wl) / 0.025) * 0.4;
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
uniform float uInside;   // 1 while the shell is whole
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
  // inside the egg the daylight arrives dimmed through membrane and fluid (the hatched calf gets it all)
  vec3 col = stylizedLight(s) * mix(0.2, 0.8, 1.0 - uFade * step(0.5, uInside));
  // backlit by the glow at the egg's heart: warm translucent rims around a darker form
  vec3 V = normalize(uCamPos - vWorld);
  float fr = pow(1.0 - max(dot(N, V), 0.0), 2.2);
  col += uFluid * uGlow * fr * (part > 0.5 ? 0.9 : 0.55) * (0.7 + 0.3 * uBeat);
  col += alb * uFluid * uGlow * 0.12;
  // the heart throbbing in the chest, seen through the thin skin
  float heart = exp(-pow((vT - 0.23) / 0.05, 2.0)) * smoothstep(0.3, -0.5, ca);
  col += vec3(1.0, 0.28, 0.2) * heart * (0.25 + uBeat) * uGlow * 1.2;
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

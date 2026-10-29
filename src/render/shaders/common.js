// Shared GLSL: uniforms, noise, the stylized light model, shadows and atmospheric fog.
// The light model follows docs/ART_DIRECTION.md: soft cel ramp, tinted (never black)
// shadows, warm saturated terminator band, sky/bounce hemisphere ambient, rim and translucency.

export const UNIFORMS = /* glsl */ `
uniform float uTime;
uniform vec3 uCamPos;
uniform vec2 uResolution;
uniform vec2 uNearFar;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyAmbient;
uniform vec3 uBounce;
uniform vec3 uShadowTint;
uniform vec3 uFogColor;
uniform vec3 uSunScatter;
uniform vec4 uFogParams;
uniform vec3 uCloudLit;
uniform vec3 uCloudShadow;
uniform float uNight;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uWind;
uniform float uGust;
uniform float uWavePhase;
uniform vec2 uRipple;
uniform float uWet;
uniform float uFlash;
uniform vec3 uFlashPos;
uniform float uInCloud;
uniform float uStorm;
uniform float uSeaLevel;
uniform float uSeaState;
uniform float uUnderwater;
uniform vec3 uWaterTint;
uniform vec3 uWaterAbsorb;
uniform vec4 uWaterParams;
uniform vec4 uCloudShade[16];
uniform vec2 uCloudShadeK;
uniform vec4 uLightK;
uniform vec4 uWhirl[2];
uniform vec4 uWhirlB[2];
uniform float uWhirlOn;
#ifndef WHIRL_FUNCS
#define WHIRL_FUNCS
// The Spiral Maelstrom's funnel (world/Ocean.js mirrors this on the CPU): a calm flat eye, a steep
// throat, a long skirt; zero slope at both ends.
float whirlProfile(float q) {
  float u = pow(clamp((q - 0.06) / 0.94, 0.0, 1.0), 0.8);
  float a = 1.0 - u;
  return a * a * a * (1.0 + 3.0 * u);
}
// surface height of the vortices at p (m, <= 0 in a funnel) with their rotating spiral swell arms
float whirlH(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < 2; i++) {
    vec4 A = uWhirl[i];
    vec4 B = uWhirlB[i];
    if (B.x <= 0.0) continue;
    vec2 d = p - A.xy;
    float q = length(d) / A.z;
    if (q >= 1.0) continue;
    float th = atan(d.y, d.x);
    float env = smoothstep(0.07, 0.3, q) * (1.0 - smoothstep(0.45, 1.0, q));
    float arm = cos(3.0 * (th - B.z) + B.w * log(max(q, 0.03)));
    h -= B.x * A.w * (whirlProfile(q) - 0.035 * env * arm);
  }
  return h;
}
// the mean water level at p: the sea level, dipped by any maelstrom
float localSeaLevel(vec2 p) {
  return uWhirlOn > 0.5 ? uSeaLevel + whirlH(p) : uSeaLevel;
}
#endif
`;

export const NOISE = /* glsl */ `
float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }

float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(i), b = hash13(i + vec3(1,0,0)), c = hash13(i + vec3(0,1,0)), d = hash13(i + vec3(1,1,0));
  float e = hash13(i + vec3(0,0,1)), f1 = hash13(i + vec3(1,0,1)), g = hash13(i + vec3(0,1,1)), h = hash13(i + vec3(1,1,1));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f1, u.x), mix(g, h, u.x), u.y), u.z);
}
const mat2 ROT2 = mat2(0.80, 0.60, -0.60, 0.80);
float fbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = ROT2 * p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
float fbm2_6(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = ROT2 * p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.984375;
}
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise3(p); p = p * 2.02 + vec3(13.7, 7.3, 3.1); a *= 0.5; }
  return s / 0.9375;
}
// Cellular (F1) noise: rounded billows for clouds.
float worley2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float d = 8.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash22(i + g);
    vec2 r = g + o - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}
float ign(vec2 fc) { return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715)))); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 saturation(vec3 c, float s) { return mix(vec3(luma(c)), c, s); }
`;

export const SHADOW = /* glsl */ `
uniform mat4 uShadowMatrix;
uniform vec4 uShadowParams;
#ifdef DEPTH_PASS
// The shadow map is bound as the render target during the depth pass, so it must not be sampled.
float sampleShadow(vec3 P, vec3 N) { return 1.0; }
#else
uniform sampler2DShadow uShadowMap;
const vec2 POISSON[12] = vec2[](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
);
// Soft shade of the cumulus overhead: each tower's footprint, cast along the sun from its base.
float cloudShade(vec3 P) {
  if (uCloudShadeK.x <= 0.0) return 1.0;
  vec2 sxz = uSunDir.xz / max(uSunDir.y, 0.12);
  float lit = 1.0;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= uCloudShadeK.y) break;
    vec4 c = uCloudShade[i];
    vec2 q = P.xz + sxz * (c.w - P.y) - c.xy;
    float d = length(q) / c.z;
    lit *= 1.0 - smoothstep(1.0, 0.45, d) * 0.85;
  }
  return mix(1.0, lit, uCloudShadeK.x);
}
float sampleShadow(vec3 P, vec3 N) {
  float cs = cloudShade(P);
  if (uShadowParams.w <= 0.0) return cs;
  vec3 Pb = P + N * uShadowParams.z;
  vec4 sc = uShadowMatrix * vec4(Pb, 1.0);
  vec3 uvz = sc.xyz;
  vec2 e = abs(uvz.xy - 0.5) * 2.0;
  float edge = max(e.x, e.y);
  if (edge > 1.0 || uvz.z > 1.0 || uvz.z < 0.0) return cs;
  // Soft, wide penumbra (the painted look): a Poisson disc rotated by a world-anchored hash, so
  // the soft edge never crawls as the camera moves; the bias grows with the kernel.
  float r = uShadowParams.x * 4.0;
  float z = uvz.z - uShadowParams.y * 1.5;
  vec3 hp = fract(floor(P * 23.0) * vec3(0.1031, 0.1030, 0.0973));
  hp += dot(hp, hp.yzx + 33.33);
  float ang = fract((hp.x + hp.y) * hp.z) * 6.2831853;
  float ca = cos(ang), sa = sin(ang);
  mat2 rot = mat2(ca, sa, -sa, ca);
  float s = 0.0;
  for (int i = 0; i < 12; i++) s += texture(uShadowMap, vec3(uvz.xy + rot * POISSON[i] * r, z));
  s *= (1.0 / 12.0);
  // shape the falloff: a soft but present core, like a brushed shadow edge
  s = smoothstep(0.0, 1.0, s);
  float fade = smoothstep(0.82, 1.0, edge);
  return mix(mix(1.0, s, uShadowParams.w), 1.0, fade) * cs;
}
#endif
`;

export const LIGHTING = /* glsl */ `
struct Surface {
  vec3 albedo;
  vec3 N;
  vec3 V;
  vec3 P;
  float shadow;
  float ao;
  float rim;
  float spec;
  float gloss;   // 0..1, sharper highlight when higher
  float trans;   // translucency for thin parts (fins, fur tips, leaves)
  float wrap;    // terminator softness (0.08 crisp .. 0.3 very soft)
  vec3 emissive;
};

Surface makeSurface(vec3 albedo, vec3 N, vec3 P) {
  Surface s;
  s.albedo = albedo; s.N = N; s.P = P;
  s.V = normalize(uCamPos - P);
  s.shadow = 1.0; s.ao = 1.0; s.rim = 0.5; s.spec = 0.0; s.gloss = 0.5;
  s.trans = 0.0; s.wrap = 0.16; s.emissive = vec3(0.0);
  return s;
}

vec3 hemiAmbient(vec3 N) {
  float up = N.y * 0.5 + 0.5;
  return mix(uBounce, uSkyAmbient, smoothstep(0.0, 1.0, up));
}

// uLightK (Atmosphere, per preset; a material without it falls back to the plain model):
//   x sky fill: the whole bright sky lights what the sun does not reach (Tiny Glade's luminous,
//     filled shade; full by day, little at night and in storms)
//   y warm bounce from sunlit ground and sea, strongest on faces turned down and sideways
//   z shade calm: how much the shade side desaturates (cool, slightly muted shadows)
//   w terminator softness: how far the light wraps around the form (soft, painted turning)
vec3 stylizedLight(Surface s) {
  float NdL = dot(s.N, uSunDir);
  float h = NdL * 0.5 + 0.5;
  float ramp = smoothstep(0.5 - s.wrap, 0.5 + s.wrap * 0.7, h);
  // soften the cel ramp toward a wrapped falloff: light turns the form gently, like paint
  float soft = smoothstep(0.5 - s.wrap * 1.9, 0.5 + s.wrap * 1.5, h);
  ramp = mix(ramp, soft, 0.35 + 0.4 * uLightK.w);
  float lit = ramp * s.shadow;
  vec3 hemi = hemiAmbient(s.N);
  float upN = s.N.y * 0.5 + 0.5;
  vec3 fill = hemi * (1.0 + uLightK.x * mix(0.7, 1.0, upN));
  float sunUp = clamp(uSunDir.y * 4.0, 0.0, 1.0);
  vec3 warm = uSunColor * vec3(1.0, 0.7, 0.48) * (uLightK.y * 0.055 * sunUp * (1.3 - upN));
  // occlusion (baked cavities and creases) takes the fill away: creases stay deep in bright shade
  vec3 ambient = (fill + warm) * s.ao;
  // Shadow side keeps the colour but cools and calms it; never black.
  vec3 shadowCol = s.albedo * ambient * uShadowTint;
  shadowCol = mix(shadowCol, vec3(dot(shadowCol, vec3(0.2126, 0.7152, 0.0722))), uLightK.z * (1.0 - s.shadow * ramp));
  // the lit side still turns with the form: faces square to the sun take its full light, glancing
  // ones a little less (a wrapped cosine, so planes read without the cel ramp going hard)
  float lam = clamp((NdL + s.wrap) / (1.0 + s.wrap), 0.0, 1.0);
  float sunI = mix(1.0, 0.62 + 0.38 * sqrt(lam), 0.55);
  vec3 litCol = s.albedo * (uSunColor * sunI * mix(0.85, 1.0, s.ao) + ambient * 0.55);
  vec3 col = mix(shadowCol, litCol, lit);
  // Warm, saturated terminator band: reads as subsurface scattering in organic forms.
  float band = smoothstep(0.5 - s.wrap * 1.5, 0.5 - s.wrap * 0.1, h) * (1.0 - smoothstep(0.5 - s.wrap * 0.1, 0.5 + s.wrap * 1.1, h));
  col += s.albedo * uSunColor * band * 0.16 * vec3(1.0, 0.42, 0.28) * s.shadow;
  // Moonlight at night (soft and blue).
  float mdl = max(dot(s.N, uMoonDir), 0.0);
  col += s.albedo * uMoonColor * smoothstep(0.0, 0.6, mdl) * uNight;
  // Rim light: sky-tinted, strongly sun-tinted when backlit.
  float NdV = max(dot(s.N, s.V), 0.0);
  float fres = pow(1.0 - NdV, 3.0);
  float back = pow(max(dot(-s.V, uSunDir), 0.0), 2.0);
  vec3 rimCol = uSkyAmbient * 0.35 + uSunColor * (0.12 + 0.9 * back) * mix(0.35, 1.0, s.shadow);
  col += fres * s.rim * rimCol * (0.6 + 0.4 * s.ao);
  // Specular: a GGX sun lobe (soft round highlights that sharpen with gloss and flare at grazing
  // angles, never a hard plastic blob) and, for wet and glossy things, the sky they mirror.
  if (s.spec > 0.0) {
    vec3 H = normalize(uSunDir + s.V);
    float nh = max(dot(s.N, H), 0.0);
    float nl = max(NdL, 0.0);
    float nvs = max(NdV, 1e-3);
    float rgh = mix(0.62, 0.1, clamp(s.gloss, 0.0, 1.0));
    float a = rgh * rgh;
    float a2 = a * a;
    float dd = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (3.14159265 * dd * dd);
    float vh = max(dot(s.V, H), 0.0);
    float Fs = 0.04 + 0.96 * pow(1.0 - vh, 5.0);
    float kv = a * 0.5;
    float Vis = 1.0 / (4.0 * (nl * (1.0 - kv) + kv) * (nvs * (1.0 - kv) + kv));
    float sp = min(D * Fs * Vis * nl * 3.0, 6.0);
    col += uSunColor * sp * s.spec * s.shadow * mix(0.5, 1.0, s.ao);
    // the sky in a wet surface: horizon glow at grazing angles, the zenith looking down; the warm
    // sun-side sky in the direction of the sun; a rough surface sees a dimmer, averaged sky
    vec3 Rv = reflect(-s.V, s.N);
    vec3 skyR = mix(uSkyHorizon, uSkyZenith, smoothstep(0.02, 0.65, Rv.y));
    skyR = mix(skyR, uBounce * 0.6 + uSkyHorizon * 0.15, smoothstep(0.02, -0.3, Rv.y));
    skyR += uSunScatter * pow(max(dot(Rv, uSunDir), 0.0), 6.0) * 0.6;
    float Fv = 0.04 + 0.96 * pow(1.0 - nvs, 5.0);
    float envK = s.spec * Fv * mix(0.3, 1.0, s.gloss) * s.ao * (1.0 - uNight * 0.6);
    col = col * (1.0 - envK * 0.5) + skyR * envK * 0.85;
  }
  // Translucency: thin tissue glows warm when the sun is behind it.
  float tb = pow(max(dot(-s.V, uSunDir), 0.0), 3.0);
  col += s.albedo * uSunColor * vec3(1.0, 0.75, 0.55) * tb * s.trans * (0.35 + 0.65 * s.shadow);
  // Lightning flash.
  if (uFlash > 0.0) {
    vec3 L = normalize(uFlashPos - s.P);
    float fl = max(dot(s.N, L), 0.0) * 0.7 + 0.3;
    col += s.albedo * vec3(0.75, 0.8, 1.0) * uFlash * fl * 2.0;
  }
  col += s.emissive;
  return col;
}

// ---- Water column (the sea of Vur Sok) ----------------------------------------------------
// Everything below the sea level is lit by light that came down through the water: red is
// absorbed first, so submerged surfaces turn blue-green with depth, and the moving surface
// focuses sunlight into caustics. When the camera itself is under the surface, the view path is
// water, not air. Self-contained (no NOISE dependency): some shaders include LIGHTING alone.
vec2 wcHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
// Animated cellular edges (F2 - F1): thin bright filaments where neighbouring cells meet.
float wcCells(vec2 p, float t) {
  vec2 i = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = wcHash(i + g);
    o = 0.5 + 0.38 * sin(t + 6.2831 * o);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
  }
  return sqrt(f2) - sqrt(f1);
}
// Direction sunlight travels after refracting into the sea (pointing down).
vec3 waterSunRefract() {
  return refract(-uSunDir, vec3(0.0, 1.0, 0.0), 0.7519);
}
/** Caustic light 0..~1.5 at a submerged point (needs the depth below the surface). */
float waterCaustics(vec3 P, float depth) {
  vec3 sr = waterSunRefract();
  // the patch of surface that focused this light: walk back up the refracted sun ray
  vec2 S = P.xz + sr.xz * (depth / min(sr.y, -0.2));
  vec2 q = S * uWaterParams.y;
  float t = uTime;
  // two crossing sine fields bend the filaments so they curve and wobble like real caustics
  vec2 wq = q + 0.42 * vec2(sin(q.y * 1.7 + t * 0.7) + sin((q.x + q.y) * 0.61 - t * 0.31),
                            sin(q.x * 1.5 - t * 0.6) + sin((q.x - q.y) * 0.67 + t * 0.4));
  // hand-drawn threads (no straight polygon edges): a finer, slowly drifting tremor on top bends
  // every cell edge into a wavering curve
  wq += 0.11 * vec2(sin(wq.y * 4.3 + wq.x * 1.3 - t * 0.9), sin(wq.x * 3.9 - wq.y * 1.1 + t * 0.8));
  float a = wcCells(wq, t * 0.9);
  float b = wcCells(wq * 0.71 + vec2(3.7 + t * 0.05, 8.1 - t * 0.04), t * 1.13 + 2.0);
  // each thread swells and thins along its length and tapers out in places, like brushed light
  float sa = 0.5 + 0.5 * sin(wq.x * 2.3 + wq.y * 1.9 + t * 0.5) * sin(wq.y * 2.9 - wq.x * 0.7 - t * 0.4);
  float sb = 0.5 + 0.5 * sin(wq.x * 1.7 - wq.y * 2.4 - t * 0.45) * sin(wq.x * 0.9 + wq.y * 2.2 + t * 0.35);
  // filaments are sharp near the surface and blur with depth
  float w = 0.055 + 0.02 * depth;
  float wa = w * (0.55 + 0.8 * sa), wb = w * (0.55 + 0.8 * sb);
  float la = exp(-a * a / (wa * wa)) * smoothstep(0.08, 0.42, sa);
  float lb = exp(-b * b / (wb * wb * 1.6)) * smoothstep(0.08, 0.42, sb);
  return max(la, lb) * 0.95 + la * lb * 0.9;
}
/** Light reaching a submerged surface: depth attenuation, blue-green tint and caustics. */
vec3 waterSubmerge(vec3 col, vec3 P) {
  float d = localSeaLevel(P.xz) - P.y;
  // a short blend across the mean level (whatever skims the waves above it stays dry)
  float w = smoothstep(-0.1, 0.45, d);
  if (w <= 0.0) return col;
  float dd = max(d, 0.0);
  vec3 Td = exp(-uWaterAbsorb * (dd * 1.15 + 0.4));
  float sunUp = smoothstep(-0.05, 0.25, uSunDir.y) * (1.0 - uStorm * 0.7);
  // filaments finer than a pixel would alias into a regular net: fade them with distance
  float far = 1.0 - smoothstep(30.0, 110.0, length(P - uCamPos));
  float k = uWaterParams.x * sunUp * smoothstep(0.1, 1.4, dd) * exp(-dd * 0.05) * far;
  // focusing moves light around rather than adding it: dim between the filaments
  float cs = k > 0.002 ? (waterCaustics(P, dd) * 1.5 - 0.32) * k : 0.0;
  vec3 lit = col * Td * (1.0 + cs);
  return mix(col, lit, w);
}
/** In-scattered light of the water column toward the viewer along rd, at a given depth. */
vec3 waterFogColor(vec3 rd, float depth) {
  float up = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  // the water column reads in planes: a luminous green-cyan toward the surface, the level view
  // fading through clear blue, and below it a deep, darker, purer blue (never one flat teal)
  vec3 c = uWaterTint * (0.14 + 1.5 * pow(up, 2.4));
  c *= mix(vec3(0.42, 0.68, 1.12), vec3(1.0), smoothstep(0.12, 0.62, up));
  c *= mix(vec3(1.0), vec3(1.05, 1.04, 0.94), smoothstep(0.55, 1.0, up));
  vec3 sr = waterSunRefract();
  float toward = pow(max(dot(rd, -sr), 0.0), 5.0);
  float sunUp = smoothstep(-0.05, 0.25, uSunDir.y) * (1.0 - uStorm * 0.6);
  c += uWaterTint * toward * 2.2 * sunUp;
  return c * exp(-uWaterAbsorb * max(depth, 0.0) * 0.55);
}
/** Hue of the water column at long range: distance takes the green-cyan out, leaving deep blue. */
vec3 waterFarTint(float dist) {
  return mix(vec3(1.0), vec3(0.52, 0.74, 1.08), smoothstep(5.0, 65.0, dist));
}
/** Metres of water between the camera and P (camera under the surface). */
float waterPathLength(vec3 P, float dist) {
  float sea = localSeaLevel(uCamPos.xz);
  float cy = sea - uCamPos.y;
  if (cy <= 0.0) return 0.0;
  if (P.y <= sea) return dist;
  return dist * clamp(cy / max(P.y - uCamPos.y, 1e-4), 0.0, 1.0);
}
vec3 underwaterFog(vec3 col, vec3 P) {
  vec3 v = P - uCamPos;
  float dist = length(v);
  vec3 rd = v / max(dist, 1e-4);
  float dw = waterPathLength(P, dist);
  // above the surface: the air part of the path hazes first
  float air = max(dist - dw, 0.0);
  col = mix(col, uFogColor, 1.0 - exp(-air * uFogParams.x * 2.0));
  vec3 T = exp(-uWaterAbsorb * dw);
  float midDepth = max(uSeaLevel - (uCamPos.y + rd.y * dw * 0.5), 0.0);
  return col * T + waterFogColor(rd, midDepth) * waterFarTint(dw) * (1.0 - T);
}

vec3 airFog(vec3 col, vec3 P) {
  vec3 v = P - uCamPos;
  float dist = length(v);
  vec3 rd = v / max(dist, 1e-4);
  float fd = 1.0 - exp(-dist * uFogParams.x);
  float k = uFogParams.z;
  float h0 = uCamPos.y - uFogParams.w;
  float base = uFogParams.y * exp(-k * h0);
  float hf = abs(rd.y) > 1e-3 ? base * (1.0 - exp(-k * rd.y * dist)) / (k * rd.y) : base * dist;
  float fh = 1.0 - exp(-max(hf, 0.0));
  float f = 1.0 - (1.0 - fd) * (1.0 - fh);
  float sunAmt = pow(max(dot(rd, uSunDir), 0.0), 10.0);
  vec3 fogCol = mix(uFogColor, uSunScatter, sunAmt * 0.85);
  fogCol += vec3(0.8, 0.85, 1.0) * uFlash * 0.25;
  return mix(col, fogCol, clamp(f, 0.0, 1.0));
}

// Atmospheric (or, with the camera submerged, underwater) fog for a lit surface at P. Geometry
// below the sea level is first lit as submerged (attenuation + caustics); seen from above, the
// ocean surface in front of it adds the view-path absorption itself.
vec3 applyFog(vec3 col, vec3 P) {
  col = waterSubmerge(col, P);
  vec3 a = airFog(col, P);
  if (uUnderwater <= 0.0) return a;
  return mix(a, underwaterFog(col, P), uUnderwater);
}

float airFogAmount(vec3 P) {
  vec3 v = P - uCamPos;
  float dist = length(v);
  vec3 rd = v / max(dist, 1e-4);
  float fd = 1.0 - exp(-dist * uFogParams.x);
  float k = uFogParams.z;
  float h0 = uCamPos.y - uFogParams.w;
  float base = uFogParams.y * exp(-k * h0);
  float hf = abs(rd.y) > 1e-3 ? base * (1.0 - exp(-k * rd.y * dist)) / (k * rd.y) : base * dist;
  float fh = 1.0 - exp(-max(hf, 0.0));
  return clamp(1.0 - (1.0 - fd) * (1.0 - fh), 0.0, 1.0);
}

float fogAmount(vec3 P) {
  float a = airFogAmount(P);
  if (uUnderwater <= 0.0) return a;
  float dist = length(P - uCamPos);
  vec3 T = exp(-uWaterAbsorb * waterPathLength(P, dist));
  float w = 1.0 - dot(T, vec3(0.2, 0.5, 0.3));
  return mix(a, w, uUnderwater);
}

vec3 fogColorFor(vec3 rd) {
  float sunAmt = pow(max(dot(rd, uSunDir), 0.0), 10.0);
  vec3 a = mix(uFogColor, uSunScatter, sunAmt * 0.85) + vec3(0.8, 0.85, 1.0) * uFlash * 0.25;
  if (uUnderwater <= 0.0) return a;
  return mix(a, waterFogColor(rd, max(uSeaLevel - uCamPos.y, 0.0)), uUnderwater);
}
`;

/** Linearize a [0,1] perspective depth value. */
export const DEPTH = /* glsl */ `
uniform sampler2D uDepthTex;
float linearDepth(float d) {
  float n = uNearFar.x, f = uNearFar.y;
  float z = d * 2.0 - 1.0;
  return (2.0 * n * f) / (f + n - z * (f - n));
}
float sceneDepthAt(vec2 uv) { return linearDepth(texture(uDepthTex, uv).r); }
`;

/** Wind sway helper used by vegetation, hanging vines, fur and grass. */
export const WIND = /* glsl */ `
vec3 windSway(vec3 worldPos, float flex, float phase) {
  float t = uTime;
  vec3 w = uWind;
  float gust = 0.6 + 0.4 * sin(t * 0.7 + worldPos.x * 0.013 + phase) + uGust;
  float flutter = sin(t * 2.3 + dot(worldPos, vec3(0.31, 0.17, 0.27)) + phase * 6.0) * 0.5
                + sin(t * 4.1 + dot(worldPos, vec3(0.17, 0.41, 0.13)) + phase * 3.0) * 0.25;
  vec3 dir = length(w) > 0.001 ? normalize(w) : vec3(1.0, 0.0, 0.0);
  float s = length(w) * 0.06;
  return (dir * (gust * s) + vec3(dir.z, 0.15, -dir.x) * flutter * s * 0.6) * flex;
}
`;

/**
 * The sea's optics, shared by the ocean surface and the sky dome (which continues the ocean past
 * the end of the surface mesh, so the two meet without a seam). Needs UNIFORMS.
 * skyEnv(dir, lod) also gives any glossy material the current sky radiance for reflections.
 */
export const SEA = /* glsl */ `
uniform sampler2D uSkyEnv;
uniform float uSkyEnvOn;
uniform vec3 uSeaBody;
uniform vec3 uSeaScatter;
uniform vec4 uSeaFar;

// Upper-hemisphere equirect, elevation warped so the horizon gets most of the texels.
vec2 skyEnvUv(vec3 d) {
  float az = atan(d.x, d.z);
  float el = asin(clamp(d.y, 0.0, 1.0));
  return vec2(az * 0.15915494 + 0.5, sqrt(el * 0.63661977));
}
vec3 skyEnv(vec3 d, float lod) {
  if (uSkyEnvOn < 0.5) {
    // no rendered sky yet: the painted gradient
    float hz = pow(1.0 - clamp(d.y, 0.0, 1.0), 3.6);
    return mix(mix(uSkyZenith, uSkyHorizon, hz), uFogColor, exp(-max(d.y, 0.0) * 28.0) * 0.85);
  }
  return textureLod(uSkyEnv, skyEnvUv(d), lod).rgb;
}
float seaFresnel(float c) {
  float f = 1.0 - clamp(c, 0.0, 1.0);
  float f2 = f * f;
  return 0.02 + 0.98 * f2 * f2 * f;
}
// Beckmann microfacet glitter for a light of the given radiance, from the mean normal and the
// per-axis slope variance of everything the pixel averages (LEAN-style), so the sun path keeps
// its width at any distance instead of collapsing into a mirror.
vec3 seaGlitter(vec3 N, vec3 V, vec3 L, float s2, vec3 lightCol) {
  vec3 H = normalize(V + L);
  float nh = max(dot(N, H), 1e-3);
  float nh2 = nh * nh;
  float m2 = max(2.0 * s2, 2e-4);
  float tan2 = (1.0 - nh2) / nh2;
  float D = exp(-tan2 / m2) / (3.14159265 * m2 * nh2 * nh2);
  float nv = max(dot(N, V), 0.02);
  float nl = max(dot(N, L), 0.0);
  float F = seaFresnel(max(dot(V, H), 0.0));
  // Smith-like masking for rough seas at grazing view
  float g = nv / (nv + sqrt(m2) * 0.5);
  return lightCol * D * F * g * smoothstep(0.0, 0.05, nl) / (4.0 * nv);
}
float seaEnvLod(float s2) {
  return clamp(log2(1.0 + sqrt(s2) * 64.0) * 1.15, 0.0, 6.0);
}
// The open sea far away: flat mean surface, all waves below a pixel, so only their statistics
// remain (roughened reflection, glitter, mean foam). rd points down; returns unfogged radiance.
vec3 seaFarColor(vec3 rd) {
  vec3 V = -rd;
  float nv = max(V.y, 1e-3);
  float s2 = uSeaFar.x;
  // rough seas reflect less at grazing angles (wave faces turn toward the viewer)
  float F = seaFresnel(nv) / (1.0 + sqrt(s2) * 4.0 * (1.0 - nv));
  vec3 R = vec3(rd.x, abs(rd.y) + sqrt(s2) * 0.5, rd.z);
  vec3 refl = skyEnv(normalize(R), seaEnvLod(s2) + 1.0);
  vec3 col = refl * F + uSeaBody * (1.0 - F);
  vec3 N = vec3(0.0, 1.0, 0.0);
  col += seaGlitter(N, V, uSunDir, s2 + 1e-4, uSunColor) * (1.0 - uStorm * 0.85);
  col += seaGlitter(N, V, uMoonDir, s2 + 1e-4, uMoonColor * 0.9) * uNight;
  vec3 foamCol = uSunColor * max(uSunDir.y, 0.0) * 0.75 + uSkyAmbient * 0.8;
  return mix(col, foamCol, uSeaFar.y * 0.5);
}
`;

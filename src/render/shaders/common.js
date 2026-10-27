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
uniform float uWet;
uniform float uFlash;
uniform vec3 uFlashPos;
uniform float uInCloud;
uniform float uStorm;
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
float sampleShadow(vec3 P, vec3 N) {
  if (uShadowParams.w <= 0.0) return 1.0;
  vec3 Pb = P + N * uShadowParams.z;
  vec4 sc = uShadowMatrix * vec4(Pb, 1.0);
  vec3 uvz = sc.xyz;
  vec2 e = abs(uvz.xy - 0.5) * 2.0;
  float edge = max(e.x, e.y);
  if (edge > 1.0 || uvz.z > 1.0 || uvz.z < 0.0) return 1.0;
  float z = uvz.z - uShadowParams.y;
  float r = uShadowParams.x * 1.8;
  float s = 0.0;
  for (int i = 0; i < 12; i++) s += texture(uShadowMap, vec3(uvz.xy + POISSON[i] * r, z));
  s *= (1.0 / 12.0);
  float fade = smoothstep(0.82, 1.0, edge);
  return mix(mix(1.0, s, uShadowParams.w), 1.0, fade);
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

vec3 stylizedLight(Surface s) {
  float NdL = dot(s.N, uSunDir);
  float h = NdL * 0.5 + 0.5;
  float ramp = smoothstep(0.5 - s.wrap, 0.5 + s.wrap * 0.7, h);
  float lit = ramp * s.shadow;
  vec3 hemi = hemiAmbient(s.N);
  vec3 ambient = hemi * s.ao;
  // Shadow side keeps the colour but cools it; never black.
  vec3 shadowCol = s.albedo * ambient * uShadowTint;
  vec3 litCol = s.albedo * (uSunColor * mix(0.85, 1.0, s.ao) + ambient * 0.55);
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
  // Soft anime specular.
  vec3 H = normalize(uSunDir + s.V);
  float sharp = mix(0.86, 0.985, s.gloss);
  float sp = smoothstep(sharp, sharp + (1.0 - sharp) * 0.35, dot(s.N, H));
  col += uSunColor * sp * s.spec * lit;
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

vec3 applyFog(vec3 col, vec3 P) {
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

float fogAmount(vec3 P) {
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

vec3 fogColorFor(vec3 rd) {
  float sunAmt = pow(max(dot(rd, uSunDir), 0.0), 10.0);
  return mix(uFogColor, uSunScatter, sunAmt * 0.85) + vec3(0.8, 0.85, 1.0) * uFlash * 0.25;
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

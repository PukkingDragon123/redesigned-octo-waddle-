// Generic stylized materials for props, terrain and vegetation.
import { ShaderMaterial, Color, DoubleSide, Vector3 } from 'three';
import { G } from './Globals.js';
import { UNIFORMS, NOISE, SHADOW, LIGHTING, WIND } from './shaders/common.js';

const TOON_VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${WIND}
attribute float aFlex;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vObjPos;
uniform float uSway;
void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
  #ifdef USE_INSTANCING
    transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    objectNormal = mat3(instanceMatrix) * objectNormal;
  #endif
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  #ifdef USE_SWAY
    wp.xyz += windSway(wp.xyz, aFlex * uSway, 0.0);
  #endif
  vWorldPos = wp.xyz;
  vObjPos = position;
  vNormal = normalize(mat3(modelMatrix) * objectNormal);
  #ifdef USE_COLOR
    vColor = color;
  #else
    vColor = vec3(1.0);
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const TOON_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
uniform vec3 uColor;
uniform float uRim;
uniform float uSpec;
uniform float uGloss;
uniform float uWrap;
uniform float uTrans;
uniform float uPaint;
uniform float uMoss;
uniform vec3 uMossColor;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vObjPos;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 albedo = uColor * vColor;
  // Hand-painted variation: broad value shifts + directional brush streaks.
  float broad = fbm2(vWorldPos.xz * 0.012 + vWorldPos.y * 0.01);
  float streak = vnoise(vec2(dot(vWorldPos.xz, vec2(0.7, 0.7)) * 0.08, vWorldPos.y * 0.6));
  albedo *= mix(1.0, 0.86 + 0.24 * broad + 0.08 * (streak - 0.5), uPaint);
  // Moss/grass on upward surfaces.
  if (uMoss > 0.0) {
    float m = smoothstep(0.35, 0.8, N.y + (fbm2(vWorldPos.xz * 0.05) - 0.5) * 0.6);
    albedo = mix(albedo, uMossColor * (0.85 + 0.3 * broad), m * uMoss);
  }
  Surface s = makeSurface(albedo, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.rim = uRim; s.spec = uSpec; s.gloss = uGloss; s.wrap = uWrap; s.trans = uTrans;
  s.ao = mix(0.75, 1.0, smoothstep(-0.6, 0.6, N.y));
  vec3 col = stylizedLight(s);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function toonMaterial(opts = {}) {
  const defines = {};
  if (opts.sway) defines.USE_SWAY = '';
  const m = new ShaderMaterial({
    vertexShader: TOON_VERT,
    fragmentShader: TOON_FRAG,
    uniforms: Object.assign({}, G, {
      uColor: { value: new Color(opts.color ?? 0xffffff) },
      uRim: { value: opts.rim ?? 0.35 },
      uSpec: { value: opts.spec ?? 0 },
      uGloss: { value: opts.gloss ?? 0.5 },
      uWrap: { value: opts.wrap ?? 0.16 },
      uTrans: { value: opts.trans ?? 0 },
      uPaint: { value: opts.paint ?? 1 },
      uMoss: { value: opts.moss ?? 0 },
      uMossColor: { value: new Color(opts.mossColor ?? 0x6f9a52) },
      uSway: { value: opts.sway ?? 0 },
    }),
    defines,
    vertexColors: !!opts.vertexColors,
  });
  if (opts.side !== undefined) m.side = opts.side;
  if (opts.doubleSide) m.side = DoubleSide;
  return m;
}

// ---------------------------------------------------------------------------------------
// Terrain: vertex-coloured rock with painted meadows. Grass areas (aGrass) are coloured in
// the shader: broad tonal patches, dry spots, sparse flowers, fine blade texture and wind
// waves sweeping across the field, so tops stay painterly at any distance.
import { getNoiseTexture } from './NoiseTex.js';

const TERRAIN_VERT = /* glsl */ `
${UNIFORMS}
attribute float aGrass;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying float vGrass;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  #ifdef USE_COLOR
    vColor = color;
  #else
    vColor = vec3(1.0);
  #endif
  vGrass = aGrass;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const TERRAIN_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
uniform sampler2D uNoise;
uniform vec3 uGrassDark;
uniform vec3 uGrassLight;
uniform vec3 uGrassDry;
uniform vec3 uMossColor;
uniform float uFlowers;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying float vGrass;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 albedo = vColor;
  vec2 wp = vWorldPos.xz;
  // painted rock: broad value shifts and soft vertical streaks
  float broad = texture2D(uNoise, wp / 140.0 + vWorldPos.y / 300.0).r;
  float streak = texture2D(uNoise, vec2(wp.x / 9.0 + wp.y / 11.0, vWorldPos.y / 60.0)).b;
  albedo *= 0.86 + 0.22 * broad + 0.1 * (streak - 0.5);
  // painted sediment lines and fine cracks on the steep faces
  float steep = 1.0 - smoothstep(0.35, 0.7, abs(N.y));
  if (steep > 0.01) {
    float wob = texture2D(uNoise, vec2(wp.x / 160.0 - wp.y / 170.0, vWorldPos.y / 400.0)).r;
    float sy = vWorldPos.y / 3.4 + wob * 1.1;
    float lineW = 0.06 + 0.06 * streak;
    float sed = smoothstep(lineW, 0.0, abs(fract(sy) - 0.5) - (0.5 - lineW)) * smoothstep(0.3, 0.6, fract(sy * 0.37 + broad));
    float cr = worley2(vec2(wp.x * 0.7 + wp.y * 0.7, vWorldPos.y * 0.45) / 3.5 + broad * 2.0);
    float crack = smoothstep(0.09, 0.02, cr) * smoothstep(0.35, 0.7, streak);
    albedo *= 1.0 - steep * (sed * 0.13 + crack * 0.2);
    // sun-bleached lips above each line
    albedo *= 1.0 + steep * 0.06 * smoothstep(0.0, 0.2, fract(sy) - 0.5) * (1.0 - smoothstep(0.2, 0.45, fract(sy) - 0.5));
  }
  // moss gathers on ledges
  float ledge = smoothstep(0.45, 0.85, N.y + (texture2D(uNoise, wp / 30.0).a - 0.5) * 0.5);
  albedo = mix(albedo, uMossColor * (0.85 + 0.3 * broad), ledge * 0.55 * (1.0 - vGrass));
  float gr = vGrass * smoothstep(0.25, 0.6, N.y);
  if (gr > 0.001) {
    float patchA = texture2D(uNoise, wp / 110.0).r;
    float patchB = texture2D(uNoise, wp / 31.0 + 0.37).a;
    float blades = texture2D(uNoise, wp / 2.7).b;
    vec3 g = mix(uGrassDark, uGrassLight, smoothstep(0.28, 0.72, patchA));
    g = mix(g, uGrassDry, smoothstep(0.55, 0.9, patchB) * 0.32);
    g *= 0.88 + 0.24 * blades;
    // wind waves rolling over the meadow
    vec2 wd = normalize(uWind.xz + vec2(1e-3));
    float wave = sin(dot(wp, wd) * 0.07 - uTime * (1.2 + length(uWind) * 0.12) + patchA * 4.0);
    g *= 1.0 + 0.1 * smoothstep(0.55, 1.0, wave) * (0.4 + 0.6 * smoothstep(0.0, 6.0, length(uWind)));
    // sparse flowers
    if (uFlowers > 0.0) {
      vec2 cell = floor(wp / 1.6);
      float h = hash12(cell);
      vec2 f = fract(wp / 1.6) - 0.5;
      float fl = step(1.0 - uFlowers * 0.08, h) * smoothstep(0.22, 0.1, length(f));
      vec3 fc = mix(vec3(1.0, 0.82, 0.88), vec3(1.0, 0.95, 0.7), hash12(cell + 7.0));
      fc = mix(fc, vec3(0.78, 0.82, 1.0), step(0.7, hash12(cell + 3.0)));
      g = mix(g, fc, fl * smoothstep(0.35, 0.65, patchA));
    }
    albedo = mix(albedo, g, gr);
  }
  Surface s = makeSurface(albedo, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.rim = 0.22;
  s.wrap = 0.2;
  s.trans = gr * 0.25;
  s.ao = mix(0.72, 1.0, smoothstep(-0.7, 0.5, N.y));
  vec3 col = stylizedLight(s);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

let _terrain = null;
export function terrainMaterial(opts = {}) {
  if (_terrain && !opts.unique) return _terrain;
  const m = new ShaderMaterial({
    vertexShader: TERRAIN_VERT,
    fragmentShader: TERRAIN_FRAG,
    uniforms: Object.assign({}, G, {
      uNoise: { value: getNoiseTexture() },
      uGrassDark: { value: new Color(opts.grassDark ?? '#4a7444') },
      uGrassLight: { value: new Color(opts.grassLight ?? '#86a560') },
      uGrassDry: { value: new Color(opts.grassDry ?? '#b0a677') },
      uMossColor: { value: new Color(opts.moss ?? '#6c8f55') },
      uFlowers: { value: opts.flowers ?? 1 },
    }),
    vertexColors: true,
  });
  if (!opts.unique) _terrain = m;
  return m;
}

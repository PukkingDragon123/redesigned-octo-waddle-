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

// Stylized water: waterfalls that arc off island rims and plunge into the cloud ocean
// (scrolling streaks, foam, soft edges, mist), and floating-lake surfaces with a painted sky
// reflection, wind ripples, sun glints and shoreline foam.
import {
  BufferGeometry, Float32BufferAttribute, Mesh, ShaderMaterial, Vector3, Color, DoubleSide,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor, CircleGeometry,
} from 'three';
import { G } from '../render/Globals.js';
import { UNIFORMS, NOISE, LIGHTING, DEPTH } from '../render/shaders/common.js';
import { getNoiseTexture } from '../render/NoiseTex.js';
import { lerp, rng } from '../core/math.js';

const FALL_VERT = /* glsl */ `
${UNIFORMS}
attribute vec2 aFall; // x along fall 0..1, y across -1..1
varying vec3 vWorldPos;
varying vec2 vFall;
varying vec3 vNormal;
varying float vDist;
varying float vViewZ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vFall = aFall;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vDist = aFall.x;
  vec4 mv = viewMatrix * wp;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FALL_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
${DEPTH}
uniform sampler2D uNoise;
uniform float uLength;
uniform float uWidth;
uniform vec3 uWater;
varying vec3 vWorldPos;
varying vec2 vFall;
varying vec3 vNormal;
varying float vDist;
varying float vViewZ;
void main() {
  float along = vFall.x;
  float across = vFall.y;
  // streaks scroll down, accelerating as the water falls
  float speed = 0.35 + along * 0.6;
  float v = along * uLength / 14.0 - uTime * speed * 1.4;
  float u = across * uWidth / 6.0;
  float st1 = texture2D(uNoise, vec2(u * 0.9, v * 0.25)).b;
  float st2 = texture2D(uNoise, vec2(u * 2.1 + 0.3, v * 0.5)).g;
  float streak = smoothstep(0.35, 0.85, st1 * 0.6 + st2 * 0.6);
  // soft, frayed sides that widen into spray
  float edge = 1.0 - smoothstep(0.55 - along * 0.3, 1.0, abs(across) + (st2 - 0.5) * 0.35);
  float a = edge * mix(0.95, 0.35, smoothstep(0.35, 1.0, along));
  a *= smoothstep(0.0, 0.015, along);
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 base = mix(uWater, vec3(1.0), 0.45 + 0.5 * streak);
  // foam at the lip and churn lower down
  float foam = smoothstep(0.08, 0.0, along) + smoothstep(0.55, 1.0, along) * 0.6;
  base = mix(base, vec3(1.0), clamp(foam, 0.0, 1.0) * 0.6);
  vec3 col = base * (hemiAmbient(N) * 0.9 + uSunColor * 0.45);
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  col += uSunColor * back * 0.35 * (0.5 + streak);
  col = applyFog(col, vWorldPos);
  vec2 suv = gl_FragCoord.xy / uResolution;
  float sceneZ = sceneDepthAt(suv);
  a *= clamp((sceneZ - vViewZ) / 3.0, 0.0, 1.0);
  a *= 0.92;
#ifdef FALL_DEPTH
  if (a < 0.35) discard;
  gl_FragColor = vec4(0.0);
  return;
#endif
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a);
}
`;

let _fallMat = null;
function fallMaterial(len, width) {
  const m = new ShaderMaterial({
    vertexShader: FALL_VERT,
    fragmentShader: FALL_FRAG,
    uniforms: Object.assign({}, G, {
      uNoise: { value: getNoiseTexture() },
      uLength: { value: len },
      uWidth: { value: width },
      uWater: { value: new Color('#bfe3ea') },
    }),
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    premultipliedAlpha: true,
  });
  return m;
}

function fallDepthMaterial(colorMat) {
  return new ShaderMaterial({
    vertexShader: FALL_VERT,
    fragmentShader: FALL_FRAG,
    uniforms: colorMat.uniforms,
    defines: { FALL_DEPTH: '' },
    colorWrite: false,
    depthWrite: true,
    transparent: true,
    side: DoubleSide,
  });
}

/**
 * A waterfall leaving `lip` (world) in horizontal direction `out` (unit), falling `drop` metres.
 */
export function buildWaterfall(lip, out, width, drop, seed = 1) {
  const r = rng(seed);
  const nSeg = 44;
  const pos = [], nor = [], fall = [], idx = [];
  const side = new Vector3().crossVectors(out, new Vector3(0, 1, 0)).normalize();
  const v0 = lerp(3, 6, r());
  const g = 9.8;
  // time to fall the drop: drop = v * t + 0.5 g t^2 with small initial vertical vel 0
  const T = Math.sqrt((2 * drop) / g);
  for (let i = 0; i <= nSeg; i++) {
    const t = Math.pow(i / nSeg, 1.35) * T;
    const x = v0 * t * (1 - Math.min(0.6, t / T * 0.6));
    const y = -0.5 * g * t * t;
    const c = lip.clone().addScaledVector(out, x).add(new Vector3(0, y, 0));
    const along = i / nSeg;
    const w = width * (1 + along * 1.4);
    // normal: facing outward (away from cliff)
    const n = out.clone().multiplyScalar(0.8).add(new Vector3(0, 0.2, 0)).normalize();
    for (const s of [-1, 1]) {
      const p = c.clone().addScaledVector(side, s * w * 0.5);
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      fall.push(along, s);
    }
  }
  for (let i = 0; i < nSeg; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geo.setAttribute('aFall', new Float32BufferAttribute(fall, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mesh = new Mesh(geo, fallMaterial(drop, width));
  // before the cloud puffs (10) so clouds in front blend over it; the depth-only twin (drawn
  // first) hides puffs behind the dense part of the fall
  mesh.renderOrder = 9;
  mesh.name = 'waterfall';
  const twin = new Mesh(geo, fallDepthMaterial(mesh.material));
  twin.renderOrder = 7;
  twin.name = 'waterfall-depth';
  mesh.add(twin);
  mesh.userData.lip = lip.clone();
  mesh.userData.out = out.clone();
  mesh.userData.width = width;
  mesh.userData.drop = drop;
  return mesh;
}

// ---- Lakes ------------------------------------------------------------------------------
const LAKE_VERT = /* glsl */ `
${UNIFORMS}
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const LAKE_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
${DEPTH}
uniform sampler2D uNoise;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform float uDepthK;
varying vec3 vWorldPos;
void main() {
  vec2 p = vWorldPos.xz;
  float n1 = texture2D(uNoise, p / 38.0 + uRipple + uTime * vec2(0.004, 0.003)).r;
  float n2 = texture2D(uNoise, p / 14.0 - uTime * vec2(0.006, -0.004)).b;
  vec3 N = normalize(vec3((n1 - 0.5) * 0.18 + (n2 - 0.5) * 0.12, 1.0, (n2 - 0.5) * 0.18 - (n1 - 0.5) * 0.1));
  vec3 V = normalize(uCamPos - vWorldPos);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  // painted sky reflection: horizon colour at grazing angles, zenith overhead
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.6, R.y));
  sky = mix(sky, uCloudLit, smoothstep(0.55, 0.8, texture2D(uNoise, R.xz / (R.y + 0.3) * 0.4 + uTime * 0.002).g) * 0.5);
  // depth: shallow turquoise near shore, deeper jade further out
  vec2 suv = gl_FragCoord.xy / uResolution;
  float sceneZ = sceneDepthAt(suv);
  float z = length(vWorldPos - uCamPos) * dot(normalize(vWorldPos - uCamPos), normalize(-vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2])));
  float depth = max(sceneZ - z, 0.0);
  vec3 body = mix(uShallow, uDeep, smoothstep(0.5, uDepthK, depth));
  body *= hemiAmbient(vec3(0.0, 1.0, 0.0)) * 0.9 + uSunColor * 0.35;
  vec3 col = mix(body, sky, 0.25 + 0.6 * fres);
  // sun glints
  vec3 H = normalize(uSunDir + V);
  float gl = pow(max(dot(N, H), 0.0), 220.0);
  col += uSunColor * gl * 2.5;
  // shoreline foam
  float foam = smoothstep(1.2, 0.0, depth) * (0.6 + 0.4 * sin(uTime * 1.5 + n1 * 12.0));
  col = mix(col, vec3(1.0) * (uSunColor * 0.4 + uSkyAmbient * 0.7), foam * 0.6);
  col = applyFog(col, vWorldPos);
  float a = clamp(0.75 + fres * 0.25 + foam * 0.2, 0.0, 1.0) * smoothstep(0.0, 0.4, depth + 0.05);
  gl_FragColor = vec4(col * a, a);
}
`;

export function buildLake(center, radiusFn, segments = 64) {
  const pos = [0, 0, 0];
  const idx = [];
  for (let i = 0; i < segments; i++) {
    const th = (i / segments) * Math.PI * 2;
    const r = radiusFn(th);
    pos.push(Math.cos(th) * r, 0, Math.sin(th) * r);
  }
  for (let i = 0; i < segments; i++) idx.push(0, 1 + ((i + 1) % segments), 1 + i);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mat = new ShaderMaterial({
    vertexShader: LAKE_VERT,
    fragmentShader: LAKE_FRAG,
    uniforms: Object.assign({}, G, {
      uNoise: { value: getNoiseTexture() },
      uShallow: { value: new Color('#8fe0d6') },
      uDeep: { value: new Color('#2f8c88') },
      uDepthK: { value: 9 },
    }),
    transparent: true,
    depthWrite: true,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    premultipliedAlpha: true,
  });
  const mesh = new Mesh(geo, mat);
  mesh.position.copy(center);
  mesh.renderOrder = 8; // before the cloud puffs (10); writes depth so puffs behind it are hidden
  mesh.name = 'lake';
  return mesh;
}

/**
 * Dev scenes only: a plain sea at y = 0 until the real ocean (game.ocean) exists. Reuses the
 * lake shader: depth-tinted turquoise shallows over the reefs, painted sky reflection.
 */
export function placeholderSea(game, radius = 9000) {
  if (game.ocean) return null;
  if (game.cloudSea) game.cloudSea.enabled = false;
  const sea = buildLake(new Vector3(0, 0, 0), () => radius, 96);
  sea.material.uniforms.uShallow.value.set('#6fd6cf');
  sea.material.uniforms.uDeep.value.set('#0f4f66');
  sea.material.uniforms.uDepthK.value = 30;
  sea.name = 'placeholder-sea';
  sea.frustumCulled = false;
  game.engine.sceneT.add(sea);
  game.engine.beforeRender.push((cam) => { sea.position.set(cam.position.x, 0, cam.position.z); });
  return sea;
}

// Fluffy hand-painted grass for the meadows of Vur Sok (Tiny Glade / Ghibli meadows).
//
// Each clump is ONE painted card: a canvas texture of many overlapping tapered blades over a soft
// dome of fluff (dark roots, lighter warm tips, a few flower heads), drawn at startup. Cards are
// camera-facing billboards anchored at their roots, so the meadow reads as a soft carpet of round
// tufts from the flight camera (20-60 m up) and as upright painted clumps from the ground. The
// clump's normal is bent spherically (a soft fur volume: lit crown, shaded flanks), the colour is
// the terrain's own meadow colour at that spot (the grass melts into the painted ground at its
// roots and in the distance), wind waves roll through it in step with the terrain's meadow waves,
// and far clumps shrink away before they would shimmer.
//
//   const pts = [];  pts.push(x, y, z, scale, seed, flower);   // per clump
//   const mesh = buildGrass(pts);                                // one instanced draw call
//   setGrassQuality(q);                                          // 0..1: fade distance
import {
  InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial,
  CanvasTexture, LinearFilter, LinearMipmapLinearFilter, ClampToEdgeWrapping, DoubleSide, Sphere, Vector3,
} from 'three';
import { G } from '../render/Globals.js';
import { UNIFORMS, NOISE, SHADOW, LIGHTING } from '../render/shaders/common.js';
import { getNoiseTexture } from '../render/NoiseTex.js';
import { terrainMaterial } from '../render/materials.js';
import { rng, lerp } from '../core/math.js';

const VERT = /* glsl */ `
${UNIFORMS}
attribute vec4 iPos;   // root xyz, scale
attribute vec4 iPrm;   // seed, flower, -, -
uniform vec2 uGrassFade;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vN;
varying float vSeed;
varying float vFlower;
varying float vWave;
varying float vFade;
void main() {
  vec3 base = iPos.xyz;
  vec3 toCam = uCamPos - base;
  float d = length(toCam);
  vec3 V = toCam / max(d, 1e-3);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  // far clumps shrink away (the painted terrain meadow carries the colour on), near ones thin out
  float fade = 1.0 - smoothstep(uGrassFade.x, uGrassFade.y, d);
  float sc = iPos.w * fade * smoothstep(0.6, 2.2, d);
  vFade = fade;
  float w = 0.95 * sc, h = 0.95 * sc;
  // wind waves rolling over the meadow (the terrain's meadow waves: whole multiples of the phase)
  vec2 wd = normalize(uWind.xz + vec2(1e-3));
  float wl = length(uWind);
  float wave = sin(dot(base.xz, wd) * 0.08 - uWavePhase + iPrm.x * 0.6);
  float crest = smoothstep(0.4, 1.0, wave);
  vWave = crest;
  float bend = (0.08 + 0.3 * crest) * (0.35 + 0.65 * smoothstep(0.0, 8.0, wl)) + 0.05 * sin(uTime * 1.9 + iPrm.x * 40.0 + base.x * 0.31);
  float y = position.y;
  vec3 p = base + right * position.x * w + up * y * h;
  p.xz += wd * bend * y * y * h;
  p.y -= bend * bend * y * h * 0.4;
  // a soft fur volume: the normal bends round the clump (lit crown, shaded flanks)
  vN = normalize(right * position.x * 0.8 + vec3(0.0, 1.0, 0.0) * (0.3 + y * 0.9) + V * 0.5);
  float flip = step(0.5, fract(iPrm.x * 7.13));
  vUv = vec2(mix(position.x * 0.5 + 0.5, 0.5 - position.x * 0.5, flip), y);
  vSeed = iPrm.x;
  vFlower = iPrm.y;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
uniform sampler2D uGrassTex;
uniform sampler2D uNoise;
uniform vec3 uGrassDark;
uniform vec3 uGrassLight;
uniform vec3 uGrassDry;
uniform vec3 uGrassTeal;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vN;
varying float vSeed;
varying float vFlower;
varying float vWave;
varying float vFade;
void main() {
  vec4 t = texture2D(uGrassTex, vUv);
  // dithered fade at the far edge of the grass (no hard ring)
  float dith = hash12(gl_FragCoord.xy);
  float a = t.a;
  if (a < 0.32 || dith > vFade * 1.4) discard;
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  // the terrain's own meadow colour at this spot: the clump melts into the painted ground
  vec2 wp = vWorld.xz;
  float patchA = texture2D(uNoise, wp / 120.0).r;
  float patchB = texture2D(uNoise, wp / 33.0 + 0.37).a;
  vec3 g = mix(uGrassDark, uGrassLight, smoothstep(0.25, 0.75, patchA));
  g = mix(g, uGrassTeal, smoothstep(0.55, 0.85, patchB) * 0.45);
  g = mix(g, uGrassDry, smoothstep(0.6, 0.92, texture2D(uNoise, wp / 61.0 + 0.71).g) * 0.4);
  // painted value per blade, dark roots, lighter warm tips
  vec3 col = g * (0.66 + 0.5 * t.r);
  col *= mix(0.62, 1.0, smoothstep(0.0, 0.55, t.g));
  col = mix(col, col * vec3(1.16, 1.14, 0.86) + vec3(0.035, 0.035, 0.0), smoothstep(0.55, 1.0, t.g) * 0.75);
  // flower heads on some clumps: violet, cream, coral
  if (vFlower > 0.5 && t.b > 0.5) {
    float h = fract(vSeed * 13.7);
    vec3 fc = h < 0.4 ? vec3(0.62, 0.42, 0.85) : h < 0.75 ? vec3(1.0, 0.93, 0.78) : vec3(1.0, 0.55, 0.42);
    col = mix(col, fc * 0.8, smoothstep(0.5, 0.9, t.b));
  }
  // the wind crest catches the light
  col *= 1.0 + 0.12 * vWave;
  vec3 N = normalize(vN);
  Surface s = makeSurface(col, N, vWorld);
  s.shadow = sampleShadow(vWorld, vec3(0.0, 1.0, 0.0));
  s.ao = mix(0.6, 1.0, smoothstep(0.0, 0.6, t.g));
  s.trans = 0.35;
  s.wrap = 0.35;
  s.rim = 0.22;
  vec3 c = stylizedLight(s);
  c = applyFog(c, vWorld);
  gl_FragColor = vec4(c, smoothstep(0.32, 0.6, a));
}
`;

// ---- the painted clump ----------------------------------------------------------------------
let _tex = null;
/** R: painted value, G: height along the blade (0 root .. 1 tip), B: flower heads, A: coverage. */
export function getGrassTexture() {
  if (_tex) return _tex;
  const W = 256, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const r = rng(4711);
  ctx.clearRect(0, 0, W, H);
  // a soft dome of fluff under the blades: the clump reads as one round volume
  ctx.save();
  ctx.translate(W / 2, H);
  ctx.scale(1, 0.62);
  const dome = ctx.createRadialGradient(0, 0, 0, 0, 0, 112);
  dome.addColorStop(0, 'rgba(110, 90, 0, 1)');
  dome.addColorStop(0.75, 'rgba(120, 150, 0, 0.95)');
  dome.addColorStop(1, 'rgba(120, 170, 0, 0)');
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.arc(0, 0, 112, Math.PI, 0);
  ctx.fill();
  ctx.restore();
  // blades, back to front: taller in the middle (the round silhouette), leaning outward
  const N = 170;
  const tips = [];
  for (let i = 0; i < N; i++) {
    const g = (r() + r() + r() - 1.5) / 1.5; // ~gaussian -1..1
    const bx = W / 2 + g * 108;
    const prof = Math.max(0, 1 - Math.pow(Math.abs(bx - W / 2) / (W / 2 - 6), 2));
    const h = (H - 6) * Math.pow(prof, 0.6) * lerp(0.5, 1.0, r());
    if (h < 8) continue;
    const lean = (bx - W / 2) * 0.35 + (r() - 0.5) * 34;
    const tx = bx + lean, ty = H - h;
    const cx = bx + lean * 0.25 + (r() - 0.5) * 10, cy = H - h * 0.55;
    const bw = lerp(3.0, 6.5, r());
    const v = Math.round(lerp(0.55, 1.0, r()) * 255);
    const grad = ctx.createLinearGradient(bx, H, tx, ty);
    grad.addColorStop(0, `rgba(${Math.round(v * 0.55)}, 0, 0, 1)`);
    grad.addColorStop(0.55, `rgba(${v}, 140, 0, 1)`);
    grad.addColorStop(1, `rgba(${Math.min(255, v + 30)}, 255, 0, 1)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(bx - bw / 2, H);
    ctx.quadraticCurveTo(cx - bw * 0.3, cy, tx, ty);
    ctx.quadraticCurveTo(cx + bw * 0.3, cy, bx + bw / 2, H);
    ctx.closePath();
    ctx.fill();
    if (h > 50) tips.push([tx, ty]);
  }
  // flower heads near some tips (the shader colours them on flowering clumps only)
  for (let i = 0; i < Math.min(9, tips.length); i++) {
    const [x, y] = tips[Math.floor(r() * tips.length)];
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    ctx.beginPath();
    ctx.arc(x, y + 3, lerp(2.2, 3.4, r()), 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new CanvasTexture(cv);
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  _tex = tex;
  return tex;
}

// ---- material / mesh --------------------------------------------------------------------------
let _mat = null;
export function grassMaterial() {
  if (_mat) return _mat;
  const t = terrainMaterial().uniforms;
  _mat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    // the meadow colours are the terrain's own uniforms (shared by reference)
    uniforms: Object.assign({}, G, {
      uGrassTex: { value: getGrassTexture() },
      uNoise: { value: getNoiseTexture() },
      uGrassFade: { value: [150, 210] },
      uGrassDark: t.uGrassDark, uGrassLight: t.uGrassLight, uGrassDry: t.uGrassDry, uGrassTeal: t.uGrassTeal,
    }),
    side: DoubleSide,
  });
  _mat.alphaToCoverage = true;
  _mat.name = 'grass';
  return _mat;
}

/** 0..1 (engine quality): how far the grass reaches before the painted terrain takes over. */
export function setGrassQuality(q) {
  const m = grassMaterial();
  const f = lerp(0.55, 1, Math.max(0, Math.min(1, q)));
  m.uniforms.uGrassFade.value = [150 * f, 210 * f];
}

/** One instanced mesh of clumps. pts: flat [x, y, z, scale, seed, flower, ...]. */
export function buildGrass(pts) {
  const n = pts.length / 6;
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const P = new Float32Array(n * 4), M = new Float32Array(n * 4);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    P[i * 4] = pts[o]; P[i * 4 + 1] = pts[o + 1]; P[i * 4 + 2] = pts[o + 2]; P[i * 4 + 3] = pts[o + 3];
    M[i * 4] = pts[o + 4]; M[i * 4 + 1] = pts[o + 5];
    x0 = Math.min(x0, pts[o]); x1 = Math.max(x1, pts[o]); y0 = Math.min(y0, pts[o + 1]); y1 = Math.max(y1, pts[o + 1]); z0 = Math.min(z0, pts[o + 2]); z1 = Math.max(z1, pts[o + 2]);
  }
  geo.setAttribute('iPos', new InstancedBufferAttribute(P, 4));
  geo.setAttribute('iPrm', new InstancedBufferAttribute(M, 4));
  geo.instanceCount = n;
  geo.boundingSphere = new Sphere(new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 4);
  const mesh = new Mesh(geo, grassMaterial());
  mesh.name = 'grass';
  mesh.renderOrder = 1;
  return mesh;
}

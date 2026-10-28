// Post-processing: restrained bloom, crepuscular rays, sonic-boom pressure distortion,
// in-cloud veil, colour grading, neutral tone mapping, vignette and dithering.
import {
  WebGLRenderTarget, HalfFloatType, LinearFilter, Vector2, Vector3, Vector4, Color, Matrix4,
  AdditiveBlending, NoBlending, RGBAFormat,
} from 'three';
import { FullscreenPass, FS_VERT } from './FullscreenPass.js';
import { G } from './Globals.js';
import { getNoiseTexture } from './NoiseTex.js';

const PREFILTER = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
vec3 q(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  // 13-tap filter (Jimenez 2014) with a Karis-style average to tame fireflies.
  vec3 a = q(vec2(-2,-2)), b = q(vec2(0,-2)), c = q(vec2(2,-2));
  vec3 d = q(vec2(-1,-1)), e = q(vec2(1,-1));
  vec3 f = q(vec2(-2,0)), g = q(vec2(0,0)), h = q(vec2(2,0));
  vec3 i = q(vec2(-1,1)), j = q(vec2(1,1));
  vec3 k = q(vec2(-2,2)), l = q(vec2(0,2)), m = q(vec2(2,2));
  vec3 col = (d + e + i + j) * 0.125 + (a + b + g + f) * 0.03125 + (b + c + h + g) * 0.03125
           + (f + g + l + k) * 0.03125 + (g + h + m + l) * 0.03125;
  col = min(col, vec3(40.0));
  float br = max(col.r, max(col.g, col.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(col * contrib, 1.0);
}
`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 q(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 a = q(vec2(-2,-2)), b = q(vec2(0,-2)), c = q(vec2(2,-2));
  vec3 d = q(vec2(-1,-1)), e = q(vec2(1,-1));
  vec3 f = q(vec2(-2,0)), g = q(vec2(0,0)), h = q(vec2(2,0));
  vec3 i = q(vec2(-1,1)), j = q(vec2(1,1));
  vec3 k = q(vec2(-2,2)), l = q(vec2(0,2)), m = q(vec2(2,2));
  vec3 col = (d + e + i + j) * 0.125 + (a + b + g + f) * 0.03125 + (b + c + h + g) * 0.03125
           + (f + g + l + k) * 0.03125 + (g + h + m + l) * 0.03125;
  gl_FragColor = vec4(col, 1.0);
}
`;

const UP = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uScatter;
varying vec2 vUv;
vec3 q(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 s = q(vec2(-1,-1)) + q(vec2(1,-1)) + q(vec2(-1,1)) + q(vec2(1,1));
  s += 2.0 * (q(vec2(0,-1)) + q(vec2(-1,0)) + q(vec2(1,0)) + q(vec2(0,1)));
  s += 4.0 * q(vec2(0,0));
  gl_FragColor = vec4(s / 16.0 * uScatter, 1.0);
}
`;

const RAYMASK = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tDepth;
uniform vec3 uSunScreen;
uniform float uAspect;
varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).r;
  float sky = step(0.99999, d);
  vec3 c = texture2D(tSrc, vUv).rgb;
  vec2 dv = vUv - uSunScreen.xy; dv.x *= uAspect;
  float fall = smoothstep(0.75, 0.0, length(dv));
  float l = max(c.r, max(c.g, c.b));
  vec3 m = c * smoothstep(0.55, 2.2, l) * sky * fall;
  gl_FragColor = vec4(min(m, vec3(6.0)), 1.0);
}
`;

const RAYBLUR = /* glsl */ `
uniform sampler2D tSrc;
uniform vec3 uSunScreen;
varying vec2 vUv;
void main() {
  const int N = 40;
  vec2 delta = (vUv - uSunScreen.xy) * (0.92 / float(N));
  vec2 uv = vUv;
  vec3 acc = vec3(0.0);
  float w = 1.0;
  for (int i = 0; i < N; i++) {
    uv -= delta;
    acc += texture2D(tSrc, uv).rgb * w;
    w *= 0.955;
  }
  gl_FragColor = vec4(acc / float(N) * 2.4, 1.0);
}
`;

// Under the sea: shafts of sunlight falling through the moving surface, marched through the
// water along each view ray (quarter resolution), then smeared toward the refracted sun.
const SHAFTS = /* glsl */ `
uniform sampler2D tDepth;
uniform sampler2D uNoise;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uWaterAbsorb;
uniform vec2 uNearFar;
uniform float uSeaLevel;
uniform float uTime;
uniform float uSurfY;
varying vec2 vUv;
float linDepth(float d) {
  float n = uNearFar.x, f = uNearFar.y;
  float z = d * 2.0 - 1.0;
  return (2.0 * n * f) / (f + n - z * (f - n));
}
void main() {
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 vdir = normalize(vp.xyz / vp.w);
  vec3 rd = normalize(mat3(uCamWorld) * vdir);
  float zd = linDepth(texture2D(tDepth, vUv).r);
  float tEnd = min(zd / max(-vdir.z, 1e-3), 70.0);
  // stop at the surface when looking up
  if (rd.y > 1e-3) tEnd = min(tEnd, max((uSurfY - uCamPos.y) / rd.y, 0.0));
  vec3 sr = refract(-uSunDir, vec3(0.0, 1.0, 0.0), 0.7519);
  float sunUp = smoothstep(-0.02, 0.2, uSunDir.y);
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  const int N = 20;
  float acc = 0.0;
  float dt = tEnd / float(N);
  float sigma = dot(uWaterAbsorb, vec3(0.15, 0.55, 0.3));
  for (int i = 0; i < N; i++) {
    float t = (float(i) + jit) * dt;
    vec3 X = uCamPos + rd * t;
    float depth = uSeaLevel - X.y;
    if (depth < 0.0) continue;
    vec2 S = X.xz + sr.xz * (depth / min(sr.y, -0.2));
    float n1 = texture2D(uNoise, S / 9.0 + vec2(uTime * 0.012, uTime * 0.007)).g;
    float n2 = texture2D(uNoise, S / 3.7 - vec2(uTime * 0.02, -uTime * 0.013)).b;
    float shaft = pow(smoothstep(0.45, 0.95, n1 * 0.75 + n2 * 0.4), 2.0);
    acc += shaft * exp(-sigma * (depth * 1.2 + t)) * dt;
  }
  float phase = 0.5 + 0.8 * pow(max(dot(rd, -sr), 0.0), 3.0);
  gl_FragColor = vec4(vec3(acc * 0.06 * phase * sunUp), 1.0);
}
`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tRays;
uniform float uBloomStrength;
uniform float uRayStrength;
uniform vec3 uSunScreen;
uniform float uExposure;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform vec3 uVignetteColor;
uniform vec3 uFadeColor;
uniform float uFade;
uniform vec4 uShock[6];
uniform vec4 uHaze;
uniform float uInCloud;
uniform vec3 uCloudVeil;
uniform float uFlash;
uniform float uAspect;
uniform float uTime;
uniform vec2 uResolution;
uniform float uPulse;
uniform float uUnderwater;
uniform vec3 uWaterTint;
uniform vec3 uShaftCol;
uniform vec2 uLens;      // x: wet lens 0..1 (just surfaced), y: seconds since surfacing
varying vec2 vUv;



float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1,0)), u.x), mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), u.x), u.y);
}

// Water running off the lens after surfacing: beads that slide down and smear the view.
vec2 lensDrops(vec2 uv, float t, out float rim) {
  vec2 g = vec2(uv.x * uAspect, uv.y) * vec2(9.0, 6.0);
  rim = 0.0;
  vec2 off = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = g * (k == 0 ? 1.0 : 1.9) + float(k) * 3.7;
    float col = floor(q.x);
    float sp = 0.25 + hash12(vec2(col, float(k))) * 0.6;
    q.y += t * sp * (1.0 + t * 0.6);
    vec2 ci = floor(q), cf = fract(q) - 0.5;
    float h = hash12(ci + float(k) * 19.0);
    if (h < 0.45) continue;
    vec2 c = vec2(hash12(ci + 3.1) - 0.5, hash12(ci + 7.3) - 0.5) * 0.5;
    vec2 d = (cf - c) * vec2(1.0, 0.75);
    float r = mix(0.12, 0.3, hash12(ci + 11.0)) * (k == 0 ? 1.0 : 0.6);
    float m = smoothstep(r, r * 0.6, length(d));
    // a short trail above the bead
    float trail = smoothstep(0.07, 0.0, abs(d.x)) * smoothstep(-0.05, 0.4, d.y) * smoothstep(0.9, 0.2, d.y) * 0.35;
    off += d / r * m * 0.035 + vec2(0.0, -0.004) * trail;
    rim += smoothstep(r * 0.6, r * 0.95, length(d)) * m;
  }
  return off;
}

vec3 neutralTonemap(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

vec3 srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 uv = vUv;
  vec2 offs = vec2(0.0);
  float ringLight = 0.0;
  float chroma = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 s = uShock[i];
    if (s.w <= 0.0) continue;
    vec2 d = uv - s.xy; d.x *= uAspect;
    float r = length(d);
    float thick = max(0.015, s.z * 0.22);
    float x = (r - s.z) / thick;
    float ring = exp(-x * x);
    // Compression ahead of the front, rarefaction behind: a refracting lens.
    float lens = ring * (x < 0.0 ? 1.0 : 0.6);
    vec2 n = r > 1e-4 ? d / r : vec2(0.0);
    n.x /= uAspect;
    offs -= n * lens * s.w * 0.045;
    ringLight += ring * s.w;
    chroma += ring * s.w;
  }
  // Heat-haze-like shimmer around a charging throat.
  if (uHaze.w > 0.0) {
    vec2 d = uv - uHaze.xy; d.x *= uAspect;
    float fall = smoothstep(uHaze.z, 0.0, length(d));
    float nx = vnoise(uv * 38.0 + vec2(uTime * 5.0, 0.0)) - 0.5;
    float ny = vnoise(uv * 38.0 + vec2(0.0, uTime * 5.3) + 7.0) - 0.5;
    offs += vec2(nx, ny) * fall * uHaze.w * 0.012;
  }
  // under water the whole view wavers a little
  if (uUnderwater > 0.0) {
    float wx = vnoise(uv * 9.0 + vec2(uTime * 0.6, 0.0)) - 0.5;
    float wy = vnoise(uv * 9.0 + vec2(3.1, uTime * 0.55)) - 0.5;
    offs += vec2(wx, wy) * 0.0035 * uUnderwater;
  }
  float lensRim = 0.0;
  if (uLens.x > 0.001) offs += lensDrops(uv, uLens.y, lensRim) * uLens.x;
  vec2 suv = uv + offs;
  vec3 col;
  if (chroma > 0.01) {
    float ca = min(chroma, 1.0) * 0.004;
    col.r = texture2D(tScene, suv + offs * 0.5 + vec2(ca, 0.0)).r;
    col.g = texture2D(tScene, suv).g;
    col.b = texture2D(tScene, suv - offs * 0.5 - vec2(ca, 0.0)).b;
  } else {
    col = texture2D(tScene, suv).rgb;
  }
  col *= 1.0 + lensRim * uLens.x * 0.12;
  col += texture2D(tBloom, suv).rgb * uBloomStrength;
  if (uUnderwater > 0.5) col += texture2D(tRays, suv).rgb * uShaftCol;
  else col += texture2D(tRays, suv).rgb * uRayStrength * uSunScreen.z;
  col *= 1.0 + ringLight * 0.06;

  // Inside a cloud: a soft luminous veil that thickens toward the edges of view.
  if (uInCloud > 0.0) {
    float vn = vnoise(uv * 3.0 + uTime * 0.05) * 0.5 + 0.5;
    float veil = uInCloud * (0.55 + 0.35 * vn);
    col = mix(col, uCloudVeil, clamp(veil, 0.0, 0.95));
  }

  col *= uExposure * (1.0 + uFlash * 0.35);
  col = neutralTonemap(col);

  // Grade: lift / gamma / gain, contrast around mid grey, saturation.
  col = uGain * (col + uLift * (1.0 - col));
  col = pow(max(col, 0.0), 1.0 / uGamma);
  col = mix(vec3(0.5), col, uContrast) ;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);

  // Vignette (soft and tinted, never a black frame).
  vec2 vd = (vUv - 0.5) * vec2(uAspect, 1.0);
  float vig = smoothstep(0.35, 1.05, length(vd));
  col = mix(col, col * uVignetteColor, vig * uVignette);
  col *= 1.0 - vig * uUnderwater * 0.35;
  col *= 1.0 - uPulse * vig * 0.4;

  col = mix(col, uFadeColor, uFade);
  col = srgb(col);
  // Dither against banding in soft skies.
  float dn = hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5;
  col += dn / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class PostFX {
  constructor(engine) {
    this.engine = engine;
    const opts = { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false };
    this.levels = 6;
    this.mips = [];
    for (let i = 0; i < this.levels; i++) this.mips.push(new WebGLRenderTarget(4, 4, opts));
    this.rayA = new WebGLRenderTarget(4, 4, opts);
    this.rayB = new WebGLRenderTarget(4, 4, opts);

    this.prefilter = new FullscreenPass({
      vertexShader: FS_VERT, fragmentShader: PREFILTER,
      uniforms: { tSrc: { value: null }, uTexel: { value: new Vector2() }, uThreshold: { value: 1.1 }, uKnee: { value: 0.6 } },
    });
    this.down = new FullscreenPass({
      vertexShader: FS_VERT, fragmentShader: DOWN,
      uniforms: { tSrc: { value: null }, uTexel: { value: new Vector2() } },
    });
    this.up = new FullscreenPass({
      vertexShader: FS_VERT, fragmentShader: UP,
      uniforms: { tSrc: { value: null }, uTexel: { value: new Vector2() }, uScatter: { value: 0.85 } },
    });
    this.up.material.blending = AdditiveBlending;
    this.up.material.transparent = true;
    this.rayMask = new FullscreenPass({
      vertexShader: FS_VERT, fragmentShader: RAYMASK,
      uniforms: { tSrc: { value: null }, tDepth: { value: null }, uSunScreen: { value: new Vector3() }, uAspect: { value: 1 } },
    });
    this.rayBlur = new FullscreenPass({
      vertexShader: FS_VERT, fragmentShader: RAYBLUR,
      uniforms: { tSrc: { value: null }, uSunScreen: { value: new Vector3() } },
    });
    this.composite = new FullscreenPass({
      vertexShader: FS_VERT, fragmentShader: COMPOSITE,
      uniforms: {
        tScene: { value: null }, tBloom: { value: null }, tRays: { value: null },
        uBloomStrength: { value: 0.08 }, uRayStrength: { value: 0.3 },
        uSunScreen: { value: new Vector3() }, uExposure: G.uExposure,
        uLift: { value: new Vector3(0, 0, 0) }, uGamma: { value: new Vector3(1, 1, 1) }, uGain: { value: new Vector3(1, 1, 1) },
        uSaturation: { value: 1 }, uContrast: { value: 1 },
        uVignette: { value: 0.35 }, uVignetteColor: { value: new Color(0.75, 0.72, 0.85) },
        uFadeColor: { value: new Color(0, 0, 0) }, uFade: { value: 1 },
        uShock: { value: Array.from({ length: 6 }, () => new Vector4(0, 0, 0, 0)) },
        uHaze: { value: new Vector4(0, 0, 0, 0) },
        uInCloud: G.uInCloud, uCloudVeil: { value: new Color(0.9, 0.92, 0.96) },
        uFlash: G.uFlash, uAspect: { value: 1 }, uTime: G.uTime, uResolution: G.uResolution,
        uPulse: { value: 0 },
        uUnderwater: G.uUnderwater, uWaterTint: G.uWaterTint, uShaftCol: { value: new Color(0.6, 0.9, 1.0) },
        uLens: { value: new Vector2(0, 0) },
      },
    });
    this.shafts = new FullscreenPass({
      vertexShader: FS_VERT, fragmentShader: SHAFTS,
      uniforms: {
        tDepth: { value: null }, uNoise: { value: getNoiseTexture() },
        uInvProj: { value: new Matrix4() }, uCamWorld: { value: new Matrix4() },
        uCamPos: G.uCamPos, uSunDir: G.uSunDir, uWaterAbsorb: G.uWaterAbsorb, uNearFar: G.uNearFar,
        uSeaLevel: G.uSeaLevel, uTime: G.uTime, uSurfY: { value: 0 },
      },
    });
    this.composite.material.blending = NoBlending;
    this.grade = this.composite.uniforms;
    this.bloomEnabled = true;
    this.raysEnabled = true;
    this._v = new Vector3();
    this._v2 = new Vector3();
    this._v3 = new Vector3();
    this.surfaceY = 0;
    // optional painterly pass (src/render/painterly PainterlyPost): set engine.post.painterly = pp
    this.painterly = null;
  }

  setSize(w, h) {
    let mw = Math.max(1, w >> 1), mh = Math.max(1, h >> 1);
    for (const m of this.mips) {
      m.setSize(mw, mh);
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
    }
    this.rayA.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    this.rayB.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    this.composite.uniforms.uAspect.value = w / h;
    this.rayMask.uniforms.uAspect.value = w / h;
  }

  /** Project the sun into screen space for the ray passes. */
  updateSun(camera) {
    const v = this._v.copy(G.uSunDir.value).multiplyScalar(5000).add(camera.position);
    v.project(camera);
    const camDir = camera.getWorldDirection(new Vector3());
    const facing = camDir.dot(G.uSunDir.value);
    const vis = Math.max(0, Math.min(1, (facing - 0.1) * 2.5)) * Math.max(0, Math.min(1, (G.uSunDir.value.y + 0.04) * 10));
    const s = this.composite.uniforms.uSunScreen.value;
    s.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, vis);
    this.rayMask.uniforms.uSunScreen.value.copy(s);
    this.rayBlur.uniforms.uSunScreen.value.copy(s);
  }

  render(renderer, sceneRT, camera) {
    const src = sceneRT.texture;
    // surfacing leaves water running off the lens for a moment
    const und = G.uUnderwater.value;
    const now = G.uTime.value;
    if (this._wasUnder && und < 0.5) this._surfacedAt = now;
    this._wasUnder = und > 0.5;
    const since = now - (this._surfacedAt ?? -99);
    const lens = this.composite.uniforms.uLens.value;
    lens.set(since >= 0 && since < 2.2 && und < 0.5 ? Math.max(0, 1 - since / 2.2) ** 0.7 : 0, Math.max(since, 0));
    // Bloom
    if (this.bloomEnabled) {
      const m0 = this.mips[0];
      this.prefilter.uniforms.tSrc.value = src;
      this.prefilter.uniforms.uTexel.value.set(1 / sceneRT.width, 1 / sceneRT.height);
      this.prefilter.render(renderer, m0);
      for (let i = 1; i < this.levels; i++) {
        this.down.uniforms.tSrc.value = this.mips[i - 1].texture;
        this.down.uniforms.uTexel.value.set(1 / this.mips[i - 1].width, 1 / this.mips[i - 1].height);
        this.down.render(renderer, this.mips[i]);
      }
      for (let i = this.levels - 1; i > 0; i--) {
        this.up.uniforms.tSrc.value = this.mips[i].texture;
        this.up.uniforms.uTexel.value.set(1 / this.mips[i].width, 1 / this.mips[i].height);
        this.up.render(renderer, this.mips[i - 1]);
      }
      this.composite.uniforms.tBloom.value = m0.texture;
    } else {
      this.composite.uniforms.tBloom.value = null;
    }
    // Crepuscular rays (in the air) or shafts through the sea (under it)
    this.updateSun(camera);
    const under = G.uUnderwater.value > 0.5;
    if (under) {
      const su = this.shafts.uniforms;
      su.tDepth.value = sceneRT.depthTexture;
      su.uInvProj.value.copy(camera.projectionMatrixInverse);
      su.uCamWorld.value.copy(camera.matrixWorld);
      su.uSurfY.value = this.surfaceY ?? 0;
      this.shafts.render(renderer, this.rayA);
      // smear toward where the sun shines down from
      const sr = this._v2.copy(G.uSunDir.value).negate();
      const eta = 0.7519, c = -sr.y, k = 1 - eta * eta * (1 - c * c);
      sr.multiplyScalar(eta).add(this._v3.set(0, 1, 0).multiplyScalar(eta * c - Math.sqrt(Math.max(k, 0)))).negate();
      const v = this._v.copy(sr).multiplyScalar(100).add(camera.position).project(camera);
      this.rayBlur.uniforms.uSunScreen.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, 1);
      this.rayBlur.uniforms.tSrc.value = this.rayA.texture;
      this.rayBlur.render(renderer, this.rayB);
      this.composite.uniforms.tRays.value = this.rayB.texture;
      const wt = G.uWaterTint.value;
      this.composite.uniforms.uShaftCol.value.setRGB(0.35 + wt.r * 4, 0.45 + wt.g * 4, 0.45 + wt.b * 4).multiply(G.uSunColor.value).multiplyScalar(0.5);
    } else if (this.raysEnabled && this.composite.uniforms.uSunScreen.value.z > 0.001) {
      this.rayMask.uniforms.tSrc.value = src;
      this.rayMask.uniforms.tDepth.value = sceneRT.depthTexture;
      this.rayMask.render(renderer, this.rayA);
      this.rayBlur.uniforms.tSrc.value = this.rayA.texture;
      this.rayBlur.render(renderer, this.rayB);
      this.composite.uniforms.tRays.value = this.rayB.texture;
    } else {
      this.composite.uniforms.uSunScreen.value.z = 0;
      this.composite.uniforms.tRays.value = this.rayB.texture;
    }
    this.composite.uniforms.tScene.value = src;
    // the painterly pass (src/render/painterly) paints the graded frame when it is attached
    const pp = this.painterly;
    if (pp && pp.enabled !== false && pp.ldrTarget && pp.apply) {
      if (pp.width !== this.engine.width || pp.height !== this.engine.height) pp.setSize?.(this.engine.width, this.engine.height);
      const vig = this.composite.uniforms.uVignette;
      const v0 = vig.value;
      vig.value = v0 * 0.5; // the paint pass owns the soft edge darkening
      this.composite.render(renderer, pp.ldrTarget);
      vig.value = v0;
      pp.apply(pp.ldrTarget.texture, sceneRT.depthTexture, camera, null, { time: G.uTime.value });
      return;
    }
    this.composite.render(renderer, null);
  }
}

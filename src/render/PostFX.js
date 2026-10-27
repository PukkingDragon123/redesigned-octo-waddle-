// Post-processing: restrained bloom, crepuscular rays, sonic-boom pressure distortion,
// in-cloud veil, colour grading, neutral tone mapping, vignette and dithering.
import {
  WebGLRenderTarget, HalfFloatType, LinearFilter, Vector2, Vector3, Vector4, Color,
  AdditiveBlending, NoBlending, RGBAFormat,
} from 'three';
import { FullscreenPass, FS_VERT } from './FullscreenPass.js';
import { G } from './Globals.js';

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
varying vec2 vUv;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1,0)), u.x), mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), u.x), u.y);
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
  col += texture2D(tBloom, suv).rgb * uBloomStrength;
  col += texture2D(tRays, suv).rgb * uRayStrength * uSunScreen.z;
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
      },
    });
    this.composite.material.blending = NoBlending;
    this.grade = this.composite.uniforms;
    this.bloomEnabled = true;
    this.raysEnabled = true;
    this._v = new Vector3();
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
    // Crepuscular rays
    this.updateSun(camera);
    if (this.raysEnabled && this.composite.uniforms.uSunScreen.value.z > 0.001) {
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
    this.composite.render(renderer, null);
  }
}

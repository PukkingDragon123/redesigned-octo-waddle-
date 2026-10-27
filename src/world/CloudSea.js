// The endless cloud ocean below the herd: a soft heightfield layer raymarched in screen space.
// Billowed surface, sun self-shadowing, silver lining toward the sun, wakes where whales skim it,
// soft intersection with islands, and real shadows (islands, whales) cast onto its tops.
import { ShaderMaterial, CustomBlending, OneFactor, OneMinusSrcAlphaFactor, Matrix4, Vector4, Vector2 } from 'three';
import { FullscreenPass, FS_VERT } from '../render/FullscreenPass.js';
import { G } from '../render/Globals.js';
import { UNIFORMS, NOISE, SHADOW, LIGHTING, DEPTH } from '../render/shaders/common.js';
import { getNoiseTexture } from '../render/NoiseTex.js';

const FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
${DEPTH}
uniform sampler2D uNoise;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec4 uSea;        // x base height, y amplitude, z top, w bottom
uniform vec2 uSeaOffset;  // wind drift (m)
uniform float uSeaDensity;
uniform float uSteps;
uniform vec4 uTrail[24];
uniform float uTrailOn;
uniform float uStormDark;
varying vec2 vUv;

float seaH(vec2 xz, float detail) {
  vec2 o = uSeaOffset;
  float big = texture2D(uNoise, (xz + o * 0.2) / 4200.0).r;
  float bil = texture2D(uNoise, (xz + o * 0.5) / 1500.0 + big * 0.25).g;
  float sml = texture2D(uNoise, (xz + o * 0.8) / 380.0 + bil * 0.12).g;
  float h = uSea.x + (big - 0.5) * uSea.y * 2.2 + pow(bil, 1.5) * uSea.y * 2.8 + sml * uSea.y * 0.65;
  if (detail > 0.0) {
    float det = texture2D(uNoise, (xz + o) / 95.0 + sml * 0.1).b;
    h += (det - 0.5) * uSea.y * 0.28 * detail;
  }
  return h;
}

float wake(vec2 xz, float y) {
  if (uTrailOn <= 0.0) return 0.0;
  float w = 0.0;
  for (int i = 0; i < 24; i++) {
    vec4 tp = uTrail[i];
    float age = uTime - tp.w;
    if (age < 0.0 || age > 12.0) continue;
    vec2 d = xz - tp.xz;
    float r = 6.0 + age * 2.2;
    float near = smoothstep(26.0, 2.0, abs(tp.y - y));
    w += exp(-dot(d, d) / (r * r)) * (1.0 - age / 12.0) * near;
  }
  return min(w, 1.6) * 9.0;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 vp = uInvProj * vec4(ndc, 1.0, 1.0);
  vec3 vdir = normalize(vp.xyz / vp.w);
  vec3 rd = normalize(mat3(uCamWorld) * vdir);
  vec3 ro = uCamPos;
  float raw = texture2D(uDepthTex, vUv).r;
  float sceneT = raw >= 0.999999 ? 1e9 : linearDepth(raw) / max(-vdir.z, 1e-4);

  float top = uSea.z, bot = uSea.w;
  float t0 = 0.0, t1 = 1e9;
  if (abs(rd.y) < 1e-5) {
    if (ro.y > top || ro.y < bot) { gl_FragColor = vec4(0.0); return; }
  } else {
    float ta = (top - ro.y) / rd.y, tb = (bot - ro.y) / rd.y;
    t0 = max(min(ta, tb), 0.0);
    t1 = max(ta, tb);
  }
  if (t1 <= 0.0 || t0 >= sceneT || t0 > 30000.0) { gl_FragColor = vec4(0.0); return; }
  float tMax = min(min(t1, sceneT), 30000.0);

  // Phase 1: relaxed heightfield trace to the soft surface.
  float t = t0;
  bool hit = false;
  int steps = int(uSteps);
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float clear = p.y - seaH(p.xz, 0.0);
    if (clear < 4.0) { hit = true; break; }
    t += max(clear * 0.7 / max(-rd.y, 0.04), 0.5 + t * 0.022);
    if (t > tMax) break;
  }
  if (!hit) {
    // Grazing rays that run out of steps far away still see the ocean, wrapped in haze.
    if (rd.y < 0.0 && sceneT > 1e8 && t > 1500.0) {
      vec3 fc = fogColorFor(rd);
      vec3 far = mix(uCloudLit * 0.92, fc, 0.75);
      gl_FragColor = vec4(far, 1.0);
      return;
    }
    gl_FragColor = vec4(0.0);
    return;
  }

  // Light once at the surface: normal, wake, sun self-occlusion and cast shadows.
  t = max(t - 8.0, t0);
  float tHit = t;
  float detail = 1.0 - smoothstep(1500.0, 5000.0, t);
  vec3 ph = ro + rd * (t + 8.0);
  float wk = wake(ph.xz, ph.y);
  float h0 = seaH(ph.xz, detail) - wk;
  float e = 5.0 + t * 0.006;
  float hx = seaH(ph.xz + vec2(e, 0.0), detail) - wk;
  float hz = seaH(ph.xz + vec2(0.0, e), detail) - wk;
  vec3 N = normalize(vec3(h0 - hx, e, h0 - hz));
  float lit = smoothstep(-0.12, 0.42, dot(N, uSunDir));
  // crevices between billows sit in soft shadow
  float bigH = uSea.x + (texture2D(uNoise, (ph.xz + uSeaOffset * 0.2) / 4200.0).r - 0.5) * uSea.y * 2.2;
  float crev = smoothstep(uSea.y * 0.4, uSea.y * 2.6, h0 - bigH);
  vec3 ps = ph + uSunDir * 30.0;
  lit *= 1.0 - 0.8 * smoothstep(-6.0, 18.0, seaH(ps.xz, 0.0) - ps.y);
  float sh = sampleShadow(vec3(ph.x, h0 + 2.0, ph.z), N);
  lit *= mix(0.25, 1.0, sh);
  lit *= mix(0.55, 1.0, crev);
  vec3 surf = mix(uCloudShadow, uCloudLit, lit);
  surf *= mix(0.82, 1.0, crev);
  surf += uSkyAmbient * 0.06 * (N.y * 0.5 + 0.5);
  float back = pow(max(dot(rd, uSunDir), 0.0), 7.0);
  vec3 rimC = uSunScatter * back * 0.9 * (0.4 + 0.6 * sh);
  if (uFlash > 0.0) surf += vec3(0.75, 0.8, 1.0) * uFlash * 0.6 * exp(-length(ph - uFlashPos) / 900.0);
  surf *= 1.0 - uStormDark * 0.35;

  // Integrate density through the soft boundary (colour darkens with depth).
  vec3 acc = vec3(0.0);
  float T = 1.0;
  float stepL = clamp(t * 0.006, 1.6, 40.0);
  for (int j = 0; j < 10; j++) {
    if (t > tMax) break;
    vec3 p = ro + rd * t;
    float hh = seaH(p.xz, detail) - wk;
    float dens = clamp((hh - p.y) / (9.0 + t * 0.004), 0.0, 1.0);
    if (dens > 0.0) {
      float depthIn = clamp((hh - p.y) / 50.0, 0.0, 1.0);
      vec3 c = surf * mix(1.0, 0.72, depthIn) + rimC * (1.0 - dens);
      float a = 1.0 - exp(-dens * stepL * uSeaDensity);
      acc += T * a * c;
      T *= 1.0 - a;
      if (T < 0.03) break;
    }
    t += stepL;
  }
  float alpha = 1.0 - T;
  vec3 hp = ro + rd * tHit;
  float fa = fogAmount(hp);
  acc = mix(acc, fogColorFor(rd) * alpha, fa);
  gl_FragColor = vec4(acc, alpha);
}
`;

export class CloudSea {
  constructor(engine) {
    this.engine = engine;
    this.uniforms = Object.assign({}, G, {
      uNoise: { value: getNoiseTexture() },
      uInvProj: { value: new Matrix4() },
      uCamWorld: { value: new Matrix4() },
      uSea: { value: new Vector4(-30, 26, 105, -260) },
      uSeaOffset: { value: new Vector2() },
      uSeaDensity: { value: 0.09 },
      uSteps: { value: 48 },
      uTrailOn: { value: 0 },
      uStormDark: { value: 0 },
    });
    const mat = new ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      premultipliedAlpha: true,
    });
    this.pass = new FullscreenPass(mat);
    this.enabled = true;
  }

  setQuality(q) {
    this.uniforms.uSteps.value = Math.round(28 + 28 * q);
  }

  /** CPU mirror of the surface height (for gameplay: skimming, soft floor). */
  heightAt(x, z) {
    // coarse approximation using the same large-scale shape
    return this.uniforms.uSea.value.x + this.uniforms.uSea.value.y * 0.6;
  }

  render(renderer, target, camera) {
    if (!this.enabled) return;
    const u = this.uniforms;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    this.pass.render(renderer, target);
  }
}

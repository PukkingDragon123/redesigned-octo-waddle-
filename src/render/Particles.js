// Instanced soft particles with CPU simulation. Two flavours:
//  - 'mist': alpha-blended, lit like cloud (mist trails, spray, breath, dust)
//  - 'glow': additive, restrained (krill sparkle, plankton motes, embers of lightning)
import {
  InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor, AdditiveBlending, Vector3, Color, DynamicDrawUsage,
} from 'three';
import { G } from './Globals.js';
import { UNIFORMS, NOISE, LIGHTING, DEPTH } from './shaders/common.js';
import { getNoiseTexture } from './NoiseTex.js';

const VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
attribute vec4 aPos;    // xyz, size
attribute vec4 aCol;    // rgb, alpha
attribute vec4 aParam;  // x seed, y age01, z stretch, w kind
uniform vec3 uStretchVel;
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vParam;
varying float vFog;
varying vec3 vFogCol;
varying float vViewZ;
varying float vSize;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float s = aPos.w;
  vec3 wp = aPos.xyz + (right * position.x + up * position.y) * s;
  vUv = position.xy;
  vCol = aCol;
  vParam = aParam;
  vec3 toP = aPos.xyz - uCamPos;
  float d = length(toP);
  vFog = fogAmount(aPos.xyz);
  vFogCol = fogColorFor(toP / max(d, 1e-3));
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vViewZ = -mv.z;
  vSize = s;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
${DEPTH}
uniform sampler2D uNoise;
uniform float uAdditive;
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vParam;
varying float vFog;
varying vec3 vFogCol;
varying float vViewZ;
varying float vSize;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float kind = vParam.w;
  float a;
  vec3 col = vCol.rgb;
  if (kind < 0.5) {
    // mist: soft noisy puff, lit like cloud
    float n = texture2D(uNoise, vUv * 0.25 + vParam.x).g;
    a = smoothstep(1.0, 0.1, r2 + (n - 0.5) * 0.7);
    vec3 lit = mix(uCloudShadow, uCloudLit, 0.55 + 0.45 * vUv.y);
    col = lit * vCol.rgb;
  } else if (kind < 1.5) {
    // glow mote: tight core, soft halo
    a = exp(-r2 * 6.0) + exp(-r2 * 28.0) * 0.8;
  } else if (kind > 4.5) {
    // drifting mote in the water (marine snow): a soft speck lit by the light in the water
    a = exp(-r2 * 4.0);
    col = (uWaterTint * 2.5 + uSunColor * 0.04) * vCol.rgb;
  } else if (kind > 3.5) {
    // bubble: clear centre, bright rim and a glint (rises through the water)
    float r = sqrt(r2);
    a = smoothstep(0.55, 0.85, r) * smoothstep(1.0, 0.86, r) * 0.9 + exp(-dot(vUv - vec2(-0.35, 0.35), vUv - vec2(-0.35, 0.35)) * 40.0) * 0.8;
    col = mix(uWaterTint * 3.0 + uSkyAmbient * 0.4, vec3(1.0), 0.35) * vCol.rgb;
  } else if (kind > 2.5) {
    // sea spray droplet: dense bright core, lit by sun and sky, a little glint toward the sun
    a = exp(-r2 * 3.5);
    vec3 lit = uSunColor * 0.55 + uSkyAmbient * 0.75 + uMoonColor * uNight * 0.5;
    col = lit * vCol.rgb;
  } else {
    // sparkle: four-point glint
    float c = exp(-r2 * 30.0);
    float st = exp(-abs(vUv.x) * 18.0) * exp(-abs(vUv.y) * 2.5) + exp(-abs(vUv.y) * 18.0) * exp(-abs(vUv.x) * 2.5);
    a = c + st * 0.6;
  }
  a *= vCol.a;
  vec2 suv = gl_FragCoord.xy / uResolution;
  float sceneZ = sceneDepthAt(suv);
  a *= clamp((sceneZ - vViewZ) / max(vSize * 0.8, 0.3), 0.0, 1.0);
  // fade puffs the camera is inside of, so a burst never veils the whole view
  a *= smoothstep(0.3, 1.2, vViewZ) * smoothstep(vSize * 0.35, vSize * 1.5, vViewZ);
  if (a < 0.002) discard;
  if (uAdditive > 0.5) {
    col *= mix(1.0, 0.0, vFog);
    gl_FragColor = vec4(col * a, 0.0);
  } else {
    col = mix(col, vFogCol, vFog);
    gl_FragColor = vec4(col * a, a);
  }
}
`;

export class Particles {
  constructor(game, { max = 3000, additive = false, name = 'particles', order = 20 } = {}) {
    this.max = max;
    this.additive = additive;
    this.n = 0;
    // sim state
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.kind = new Float32Array(max);
    this.seed = new Float32Array(max);
    this.fadeIn = new Float32Array(max);
    const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new BufferAttribute(quad, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(DynamicDrawUsage);
    this.aCol = new InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(DynamicDrawUsage);
    this.aParam = new InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aCol', this.aCol);
    geo.setAttribute('aParam', this.aParam);
    geo.instanceCount = 0;
    this.geo = geo;
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: Object.assign({}, G, {
        uNoise: { value: getNoiseTexture() },
        uAdditive: { value: additive ? 1 : 0 },
        uStretchVel: { value: new Vector3() },
      }),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: additive ? OneFactor : OneMinusSrcAlphaFactor,
      premultipliedAlpha: true,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.name = name;
    game.engine.sceneT.add(this.mesh);
    this.wind = null;
  }

  /**
   * o: { pos, vel, life, size, sizeEnd, color (Color or [r,g,b]), alpha, drag, gravity,
   *      kind (0 mist, 1 glow, 2 sparkle, 3 sea spray droplet, 4 bubble, 5 underwater mote) }
   */
  emit(o) {
    let i;
    if (this.n < this.max) i = this.n++;
    else {
      // recycle the oldest-looking particle
      i = (this._rr = ((this._rr || 0) + 1) % this.max);
    }
    const p = o.pos, v = o.vel;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v ? v.x : 0; this.vel[i * 3 + 1] = v ? v.y : 0; this.vel[i * 3 + 2] = v ? v.z : 0;
    const c = o.color;
    const cr = c ? (c.isColor ? c.r : c[0]) : 1, cg = c ? (c.isColor ? c.g : c[1]) : 1, cb = c ? (c.isColor ? c.b : c[2]) : 1;
    this.col[i * 4] = cr; this.col[i * 4 + 1] = cg; this.col[i * 4 + 2] = cb; this.col[i * 4 + 3] = o.alpha ?? 1;
    this.life[i] = o.life ?? 2;
    this.age[i] = 0;
    this.size0[i] = o.size ?? 1;
    this.size1[i] = o.sizeEnd ?? (o.size ?? 1) * 2;
    this.drag[i] = o.drag ?? 0.6;
    this.grav[i] = o.gravity ?? 0;
    this.kind[i] = o.kind ?? 0;
    this.seed[i] = Math.random() * 10;
    this.fadeIn[i] = o.fadeIn ?? 0.15;
  }

  update(dt) {
    let w = 0;
    const P = this.aPos.array, C = this.aCol.array, Q = this.aParam.array;
    const wind = G.uWind.value;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // swap-remove
        const last = this.n - 1;
        if (i !== last) this._copy(last, i);
        this.n--;
        i--;
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      const i3 = i * 3;
      // bubbles and motes live under the sea, out of the wind
      const wk = this.kind[i] > 3.5 ? 0 : (1 - k) * 0.6;
      this.vel[i3] = this.vel[i3] * k + wind.x * wk;
      this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * dt;
      this.vel[i3 + 2] = this.vel[i3 + 2] * k + wind.z * wk;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = this.age[i] / this.life[i];
      const fade = Math.min(1, this.age[i] / Math.max(this.fadeIn[i], 1e-3)) * (1 - t * t);
      const w4 = w * 4;
      P[w4] = this.pos[i3]; P[w4 + 1] = this.pos[i3 + 1]; P[w4 + 2] = this.pos[i3 + 2];
      P[w4 + 3] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      C[w4] = this.col[i * 4]; C[w4 + 1] = this.col[i * 4 + 1]; C[w4 + 2] = this.col[i * 4 + 2];
      C[w4 + 3] = this.col[i * 4 + 3] * fade;
      Q[w4] = this.seed[i]; Q[w4 + 1] = t; Q[w4 + 2] = 0; Q[w4 + 3] = this.kind[i];
      w++;
    }
    this.geo.instanceCount = w;
    if (w > 0) {
      for (const a of [this.aPos, this.aCol, this.aParam]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, w * 4);
        a.needsUpdate = true;
      }
    }
  }

  _copy(from, to) {
    for (let k = 0; k < 3; k++) { this.pos[to * 3 + k] = this.pos[from * 3 + k]; this.vel[to * 3 + k] = this.vel[from * 3 + k]; }
    for (let k = 0; k < 4; k++) this.col[to * 4 + k] = this.col[from * 4 + k];
    this.life[to] = this.life[from]; this.age[to] = this.age[from];
    this.size0[to] = this.size0[from]; this.size1[to] = this.size1[from];
    this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from];
    this.kind[to] = this.kind[from]; this.seed[to] = this.seed[from]; this.fadeIn[to] = this.fadeIn[from];
  }
}

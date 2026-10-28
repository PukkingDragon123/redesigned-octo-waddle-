// Storm weather: intensity ramps the atmosphere, wind and rain; lightning bolts flash through
// the clouds (lighting them from inside) with thunder delayed by distance.
import {
  InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, BufferGeometry, Float32BufferAttribute,
  Mesh, ShaderMaterial, Vector3, AdditiveBlending, DynamicDrawUsage, Color,
} from 'three';
import { G } from '../render/Globals.js';
import { UNIFORMS, DEPTH } from '../render/shaders/common.js';
import { clamp, damp, lerp, rng, smoothstep } from '../core/math.js';

const RAIN_VERT = /* glsl */ `
${UNIFORMS}
attribute vec4 aDrop; // xyz offset in the box, w speed factor
uniform vec3 uBoxCenter;
uniform float uBox;
uniform float uFall;
uniform float uRain;
uniform vec3 uRainOff; // wind-carried offset, integrated on the CPU
varying float vA;
varying vec2 vUv;
void main() {
  vec3 vel = vec3(uWind.x * 0.8, -uFall * aDrop.w, uWind.z * 0.8);
  vec3 p = aDrop.xyz + uRainOff + vec3(0.0, vel.y * uTime * 0.07, 0.0);
  p = mod(p - uBoxCenter + uBox * 0.5, uBox) - uBox * 0.5 + uBoxCenter;
  // stretch the drop along its velocity, facing the camera
  vec3 dir = normalize(vel);
  vec3 toCam = normalize(uCamPos - p);
  vec3 side = normalize(cross(dir, toCam));
  float len = 1.6 + length(vel) * 0.05;
  vec3 wp = p + side * position.x * 0.025 + dir * position.y * len;
  vUv = position.xy;
  float d = length(uCamPos - p);
  vA = uRain * smoothstep(uBox * 0.5, uBox * 0.15, d) * smoothstep(0.5, 2.0, d) * (0.35 + 0.65 * fract(aDrop.w * 13.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const RAIN_FRAG = /* glsl */ `
${UNIFORMS}
varying float vA;
varying vec2 vUv;
void main() {
  float a = vA * (1.0 - abs(vUv.x)) * smoothstep(-1.0, 0.2, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
  vec3 c = mix(uSkyAmbient, vec3(0.85, 0.9, 1.0), 0.5) * 0.6 + vec3(0.8, 0.85, 1.0) * uFlash * 0.8;
  gl_FragColor = vec4(c * a, a);
}
`;

const BOLT_VERT = /* glsl */ `
attribute float aW;
varying float vW;
void main() {
  vW = aW;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const BOLT_FRAG = /* glsl */ `
uniform float uAlpha;
varying float vW;
void main() {
  float core = 1.0 - abs(vW);
  float a = (pow(core, 6.0) * 3.0 + pow(core, 1.5) * 0.4) * uAlpha;
  gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, 0.0);
}
`;

export class Weather {
  constructor(game) {
    this.game = game;
    this.storm = 0; // 0..1 target
    this.level = 0; // smoothed
    this.rain = 0;
    this.lightningRate = 0; // strikes per second
    this.spots = [];
    this.flash = 0;
    this.flashT = 0;
    this.bolts = [];
    this.r = rng(321);
    this.onThunder = null; // (pos, dist) => void
    this.onStrike = null;
    // rain
    const N = 3200;
    const drops = new Float32Array(N * 4);
    const box = 70;
    for (let i = 0; i < N; i++) {
      drops[i * 4] = (Math.random() - 0.5) * box;
      drops[i * 4 + 1] = (Math.random() - 0.5) * box;
      drops[i * 4 + 2] = (Math.random() - 0.5) * box;
      drops[i * 4 + 3] = 0.7 + Math.random() * 0.6;
    }
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aDrop', new InstancedBufferAttribute(drops, 4));
    geo.instanceCount = N;
    this.rainU = Object.assign({}, G, {
      uBoxCenter: { value: new Vector3() }, uBox: { value: box }, uFall: { value: 34 }, uRain: { value: 0 },
      uRainOff: { value: new Vector3() },
    });
    this.rainMesh = new Mesh(geo, new ShaderMaterial({
      vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, uniforms: this.rainU,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    }));
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    this.rainMesh.renderOrder = 40;
    game.engine.sceneT.add(this.rainMesh);
  }

  set(storm, opts = {}) {
    this.storm = storm;
    if (opts.lightning !== undefined) this.lightningRate = opts.lightning;
    if (opts.spots) this.spots = opts.spots;
  }

  strike(pos = null) {
    const cam = this.game.engine.camera.position;
    let top = pos;
    if (!top) {
      if (this.spots.length) {
        // nearest few spots to the camera
        const near = this.spots.slice().sort((a, b) => a.distanceToSquared(cam) - b.distanceToSquared(cam)).slice(0, 5);
        top = near[Math.floor(this.r() * near.length)].clone();
      } else {
        top = cam.clone().add(new Vector3((this.r() - 0.5) * 1600, 300, (this.r() - 0.5) * 1600));
      }
    }
    const bottom = top.clone().add(new Vector3((this.r() - 0.5) * 200, -lerp(260, 420, this.r()), (this.r() - 0.5) * 200));
    this.bolts.push(this._bolt(top, bottom));
    this.flash = 1;
    this.flashT = 0;
    G.uFlashPos.value.copy(top.clone().lerp(bottom, 0.3));
    const dist = top.distanceTo(cam);
    this.onStrike?.(top, dist);
    setTimeout(() => this.onThunder?.(top, dist), Math.min(6000, (dist / 343) * 1000));
  }

  _bolt(a, b) {
    // jagged main channel with branches, built as camera-facing ribbons
    const pts = [];
    const n = 18;
    const r = this.r;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t);
      if (i > 0 && i < n) p.add(new Vector3((r() - 0.5) * 40, (r() - 0.5) * 10, (r() - 0.5) * 40));
      pts.push(p);
    }
    const strands = [{ pts, w: 3.2 }];
    for (let k = 0; k < 3; k++) {
      const st = 3 + Math.floor(r() * (n - 6));
      const br = [pts[st].clone()];
      const dir = new Vector3((r() - 0.5) * 2, -1, (r() - 0.5) * 2).normalize();
      for (let i = 1; i <= 6; i++) br.push(br[i - 1].clone().addScaledVector(dir, 18 + r() * 14).add(new Vector3((r() - 0.5) * 16, 0, (r() - 0.5) * 16)));
      strands.push({ pts: br, w: 1.6 });
    }
    const pos = [], w = [], idx = [];
    const cam = this.game.engine.camera.position;
    for (const s of strands) {
      const base = pos.length / 3;
      for (let i = 0; i < s.pts.length; i++) {
        const p = s.pts[i];
        const t = new Vector3().subVectors(s.pts[Math.min(s.pts.length - 1, i + 1)], s.pts[Math.max(0, i - 1)]).normalize();
        const side = new Vector3().crossVectors(t, new Vector3().subVectors(cam, p).normalize()).normalize().multiplyScalar(s.w * 3);
        pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
        w.push(-1, 1);
      }
      for (let i = 0; i < s.pts.length - 1; i++) {
        const q = base + i * 2;
        idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('aW', new Float32BufferAttribute(w, 1));
    geo.setIndex(idx);
    const mat = new ShaderMaterial({
      vertexShader: BOLT_VERT, fragmentShader: BOLT_FRAG, uniforms: { uAlpha: { value: 1 } },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 45;
    this.game.engine.sceneT.add(mesh);
    return { mesh, t: 0, life: 0.45 + this.r() * 0.25 };
  }

  update(dt) {
    const g = this.game;
    this.level = damp(this.level, this.storm, 0.25, dt);
    const L = this.level;
    g.atmosphere.stormBoost = L * 0.85;
    this.rain = damp(this.rain, L > 0.35 ? smoothstep(0.35, 0.8, L) : 0, 0.5, dt);
    this.rainU.uRain.value = this.rain;
    this.rainMesh.visible = this.rain > 0.01;
    this.rainU.uBoxCenter.value.copy(g.engine.camera.position);
    // drops drift with the live wind (integrated, so gusts do not jolt the whole curtain)
    const off = this.rainU.uRainOff.value, box = this.rainU.uBox.value, w = g.wind.base;
    off.x = (off.x + w.x * 0.056 * dt) % box;
    off.z = (off.z + w.z * 0.056 * dt) % box;
    G.uWet.value = damp(G.uWet.value, this.rain, 0.3, dt);
    // lightning
    if (this.lightningRate > 0 && L > 0.5 && this.r() < this.lightningRate * dt * L) this.strike();
    this.flashT += dt;
    // a flash flickers: two or three pulses
    const ft = this.flashT;
    let fl = 0;
    if (this.flash > 0) {
      fl = Math.exp(-ft * 9) * (0.7 + 0.3 * Math.sin(ft * 70)) + (ft > 0.12 ? Math.exp(-(ft - 0.12) * 12) * 0.7 : 0);
      if (ft > 1.2) this.flash = 0;
    }
    G.uFlash.value = fl * this.flash;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      const a = b.t < b.life ? (1 - b.t / b.life) * (0.6 + 0.4 * Math.sin(b.t * 60)) : 0;
      b.mesh.material.uniforms.uAlpha.value = a;
      if (b.t >= b.life) {
        g.engine.sceneT.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        this.bolts.splice(i, 1);
      }
    }
  }
}

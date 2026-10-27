// Sonic booms from the throat resonator: an expanding pressure shell that refracts the air
// (screen-space lens ring), blows clouds apart (they slowly reform), bursts mist, shakes the
// camera, scatters creatures and knocks back the falcon. Adults' booms are far larger and can
// be synchronised into one enormous protective wave.
import { Mesh, SphereGeometry, ShaderMaterial, Vector3, Vector4, AdditiveBlending, Color } from 'three';
import { G } from '../render/Globals.js';
import { UNIFORMS } from '../render/shaders/common.js';
import { clamp, lerp, smoothstep } from '../core/math.js';

const SHELL_VERT = /* glsl */ `
${UNIFORMS}
varying vec3 vN;
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const SHELL_FRAG = /* glsl */ `
${UNIFORMS}
uniform float uAlpha;
uniform vec3 uTint;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 V = normalize(uCamPos - vW);
  float f = pow(1.0 - abs(dot(normalize(vN), V)), 3.0);
  float a = f * uAlpha;
  gl_FragColor = vec4(uTint * a, 0.0);
}
`;

export class SonicBooms {
  constructor(game) {
    this.game = game;
    this.active = [];
    this.slot = 0;
    this.shellGeo = new SphereGeometry(1, 48, 24);
    this.hooks = [];
    this.charge = null; // {pos (Vector3), amount}
  }

  /** Spawn a boom. opts: { power 0..1+, radius (max m), speed (m/s), strength (cloud push m), source } */
  spawn(center, opts = {}) {
    const g = this.game;
    const power = opts.power ?? 1;
    const radius = opts.radius ?? 40 * power;
    const speed = opts.speed ?? 70 + radius * 0.6;
    const strength = opts.strength ?? radius * 0.35;
    const i = this.slot++ % G.uBooms.value.length;
    G.uBooms.value[i].set(center.x, center.y, center.z, g.time);
    G.uBoomParams.value[i].set(radius, strength, speed, 0);
    const mat = new ShaderMaterial({
      vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG,
      uniforms: Object.assign({}, G, { uAlpha: { value: 0.5 }, uTint: { value: new Color(opts.tint ?? 0xe8f0ff) } }),
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    const shell = new Mesh(this.shellGeo, mat);
    shell.position.copy(center);
    shell.frustumCulled = false;
    shell.renderOrder = 35;
    g.engine.sceneT.add(shell);
    const b = { center: center.clone(), t: 0, radius, speed, power, shell, hitFalcon: false, source: opts.source };
    this.active.push(b);
    // mist burst
    const n = Math.round(20 + radius * 0.6);
    for (let k = 0; k < n; k++) {
      const d = new Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.7, Math.random() - 0.5).normalize();
      g.mist.emit({
        pos: center.clone().addScaledVector(d, radius * 0.05), vel: d.multiplyScalar(speed * lerp(0.25, 0.6, Math.random())),
        life: lerp(1.2, 2.6, Math.random()), size: radius * 0.06 + 1, sizeEnd: radius * 0.18 + 3, alpha: 0.5, drag: 1.6, kind: 0,
      });
    }
    // camera shake by proximity
    const camD = g.engine.camera.position.distanceTo(center);
    g.cameraRig.addShake(clamp(1.2 - camD / (radius * 2.5), 0, 1) * (0.4 + power * 0.4));
    for (const h of this.hooks) h(b);
    return b;
  }

  update(dt) {
    const g = this.game;
    const cam = g.engine.camera;
    const shocks = g.engine.post.composite.uniforms.uShock.value;
    for (const s of shocks) s.set(0, 0, 0, 0);
    let k = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      b.t += dt;
      const r = b.speed * b.t;
      const life = b.radius / b.speed;
      const fade = 1 - smoothstep(life * 0.5, life * 1.05, b.t);
      b.shell.scale.setScalar(Math.max(0.1, r));
      b.shell.material.uniforms.uAlpha.value = 0.35 * fade * (0.6 + 0.4 * b.power);
      b.front = r;
      // screen-space lens ring
      if (k < shocks.length && fade > 0.01) {
        const v = b.center.clone().project(cam);
        const dist = cam.position.distanceTo(b.center);
        if (v.z < 1 && dist > r * 0.8) {
          const tanH = Math.tan((cam.fov * Math.PI) / 360);
          const sr = r / (dist * tanH) * 0.5;
          shocks[k++].set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, sr, fade * clamp(b.power, 0.3, 1.6));
        } else if (dist <= r * 1.1 && dist >= r * 0.6) {
          // the wave passes over the camera: a full-screen pulse
          g.engine.post.composite.uniforms.uPulse.value = Math.max(g.engine.post.composite.uniforms.uPulse.value, fade * 0.8);
        }
      }
      if (b.t > life * 1.1) {
        g.engine.sceneT.remove(b.shell);
        b.shell.material.dispose();
        this.active.splice(i, 1);
      }
    }
    const pu = g.engine.post.composite.uniforms.uPulse;
    pu.value = Math.max(0, pu.value - dt * 1.5);
    // charging haze at the throat
    const haze = g.engine.post.composite.uniforms.uHaze.value;
    if (this.charge && this.charge.amount > 0.02) {
      const v = this.charge.pos.clone().project(cam);
      if (v.z < 1) haze.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, 0.08 + this.charge.amount * 0.14, this.charge.amount);
      else haze.set(0, 0, 0, 0);
    } else haze.set(0, 0, 0, 0);
  }
}

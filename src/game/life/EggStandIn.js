// A stand-in for the maelstrom builder's WhaleEgg (src/creatures/egg/WhaleEgg.js), with the same
// API (docs/VUR_SOK.md 0.7), used only while that module is missing: a translucent glowing egg with
// the curled embryo visible inside (a short raymarch through a curled-calf distance field), a
// heartbeat pulse, hand-drawn cracks, and a burst of light and bubbles when it hatches.
import { Group, Mesh, SphereGeometry, ShaderMaterial, Vector3, Matrix4 } from 'three';
import { G } from '../../render/Globals.js';
import { UNIFORMS } from '../../render/shaders/common.js';
import { clamp, damp } from '../../core/math.js';

const VERT = /* glsl */ `
${UNIFORMS}
varying vec3 vObj;
varying vec3 vN;
void main() {
  vObj = position;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
uniform vec3 uCamObj;
uniform float uGlow;
uniform float uBeat;
uniform float uCrack;
uniform float uKick;
uniform float uCurl;
varying vec3 vObj;
varying vec3 vN;

float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}

// the curled embryo: a tapering arc (head thick, tail thin) wrapped around the egg's centre
float embryo(vec3 p) {
  p.xy += vec2(sin(uKick * 7.0), cos(uKick * 5.0)) * 0.05 * uKick;
  float a = atan(p.y, p.x);
  float span = 2.35 * uCurl;
  float ac = clamp(a, -span, span);
  float u = (ac + span) / (2.0 * span);
  float R = 0.46;
  vec3 c = vec3(cos(ac) * R, sin(ac) * R, 0.06 * sin(u * 3.0));
  float th = mix(0.25, 0.045, pow(u, 0.8));
  float d = length(p - c) - th;
  // the head and its four small eyes' bump; the folded wings along the arc
  vec3 hc = vec3(cos(-span) * R, sin(-span) * R, 0.0);
  d = min(d, length(p - hc) - 0.29);
  return d;
}

void main() {
  vec3 ro = uCamObj;
  vec3 rd = normalize(vObj - ro);
  // entry on this (front) face, exit on the far side of the unit sphere
  float b = dot(vObj, rd);
  float tExit = -2.0 * b;
  float acc = 0.0, body = 0.0;
  float t = 0.02;
  float stepL = max(tExit, 0.01) / 22.0;
  for (int i = 0; i < 22; i++) {
    vec3 p = vObj + rd * t;
    float d = embryo(p);
    body += smoothstep(0.05, -0.02, d) * stepL * 6.0;
    acc += exp(-max(d, 0.0) * 9.0) * stepL;
    t += stepL;
  }
  body = clamp(body, 0.0, 1.0);
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - (modelMatrix * vec4(vObj, 1.0)).xyz);
  float fr = pow(1.0 - abs(dot(N, V)), 2.2);
  // the fluid inside glows warm, brighter with each heartbeat
  float beat = 0.55 + 0.45 * uBeat;
  vec3 fluid = mix(vec3(0.95, 0.55, 0.42), vec3(1.0, 0.82, 0.6), 0.5 + 0.5 * uBeat) * (0.35 + 0.65 * uGlow);
  vec3 col = fluid * (0.35 + acc * 1.8 * beat);
  // the calf's body: a soft dark silhouette with a glowing heart
  vec3 flesh = vec3(0.32, 0.16, 0.2) + vec3(0.9, 0.35, 0.3) * uBeat * 0.35;
  col = mix(col, flesh, body * 0.75);
  // the shell: pale, pearly, rim-lit, faint growth swirls
  float sw = n3(vObj * 4.0 + vec3(0.0, uTime * 0.02, 0.0));
  vec3 shell = mix(vec3(0.72, 0.84, 0.9), vec3(0.98, 0.93, 0.85), sw);
  col = mix(col, shell * (0.6 + 0.6 * uGlow), fr * 0.7);
  // hand-drawn cracks: domain-warped, broken, tapering lines that spread with uCrack
  if (uCrack > 0.0) {
    vec3 q = vObj * 2.6 + vec3(n3(vObj * 3.0), n3(vObj * 3.0 + 7.0), n3(vObj * 3.0 + 13.0)) * 0.9;
    float f = n3(q) - 0.5;
    float w = 0.035 * (0.5 + n3(vObj * 9.0));
    float line = smoothstep(w, 0.0, abs(f)) * step(n3(vObj * 1.7 + 3.0), uCrack * 1.15);
    col = mix(col, vec3(1.0, 0.9, 0.7) * (1.4 + uBeat), line * 0.85);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const _m = new Matrix4();
const _c = new Vector3();

export class EggStandIn {
  constructor(game, opts = {}) {
    this.game = game;
    this.radius = opts.radius ?? 2.2;
    this.group = new Group();
    this.mat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: Object.assign({}, G, {
        uCamObj: { value: new Vector3() }, uGlow: { value: 1 }, uBeat: { value: 0 }, uCrack: { value: 0 },
        uKick: { value: 0 }, uCurl: { value: 1 },
      }),
    });
    this.mesh = new Mesh(new SphereGeometry(1, 40, 28), this.mat);
    this.mesh.scale.set(this.radius, this.radius * 1.12, this.radius);
    this.group.add(this.mesh);
    this.position = this.group.position;
    if (opts.position) this.position.copy(opts.position);
    this.glow = 1;
    this.glowT = 1;
    this.rate = 1.2; // heartbeats per second
    this.phase = 0;
    this.kickK = 0;
    this.hatched = false;
    this.t = 0;
    const self = this;
    this.embryo = { kick() { self.kickK = 1; } };
    (opts.scene || game.engine.scene).add(this.group);
    this._em = { pos: new Vector3(), vel: new Vector3(), life: 3, size: 0.3, sizeEnd: 0.1, alpha: 0.8, drag: 0.6, kind: 0, color: [1, 0.86, 0.7], fadeIn: 0.1 };
  }

  setGlow(k) { this.glowT = clamp(k, 0, 1.5); }
  setPulse(rate) { this.rate = rate; }
  crack(k) { this.mat.uniforms.uCrack.value = clamp(k, 0, 1); }

  update(dt) {
    if (this.hatched) return;
    this.t += dt;
    this.glow = damp(this.glow, this.glowT, 2, dt);
    this.phase += dt * this.rate;
    const f = this.phase % 1;
    // lub-dub
    const beat = Math.exp(-Math.pow((f - 0.08) / 0.05, 2)) + 0.6 * Math.exp(-Math.pow((f - 0.28) / 0.06, 2));
    const u = this.mat.uniforms;
    u.uBeat.value = beat;
    u.uGlow.value = this.glow;
    this.kickK = Math.max(0, this.kickK - dt * 1.6);
    u.uKick.value = this.kickK;
    // a gentle rock in the eye's current, a jolt on a kick
    this.mesh.rotation.z = Math.sin(this.t * 0.7) * 0.05 + Math.sin(this.t * 13) * 0.05 * this.kickK;
    this.mesh.rotation.y += dt * 0.05;
    const s = 1 + beat * 0.012;
    this.mesh.scale.set(this.radius * s, this.radius * 1.12 * s, this.radius * s);
    this.group.updateMatrixWorld();
    _m.copy(this.mesh.matrixWorld).invert();
    u.uCamObj.value.copy(_c.copy(this.game.engine.camera.position).applyMatrix4(_m));
  }

  hatch() {
    if (this.hatched) return;
    this.hatched = true;
    this.mesh.visible = false;
    const g = this.game, E = this._em, p = this.position;
    for (let i = 0; i < 60; i++) {
      E.pos.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).normalize().multiplyScalar(this.radius).add(p);
      E.vel.copy(E.pos).sub(p).multiplyScalar(0.8 + Math.random());
      E.vel.y += 1.5;
      E.life = 2 + Math.random() * 2;
      E.size = 0.15 + Math.random() * 0.3;
      g.glow?.emit(E);
    }
    for (let i = 0; i < 40; i++) {
      E.pos.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3).add(p);
      E.vel.set((Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 0.6);
      E.life = 3;
      E.size = 0.08 + Math.random() * 0.12;
      g.mist?.emit(E);
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

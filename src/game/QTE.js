// Quick-time moments, wordless (docs/VUR_SOK.md 0.8: no text). A cue is a brushed stroke of light
// drawn over the film, anchored to a world point (the egg, the mother's eye) or a screen point:
// never a letter, a key name or a button icon. Any "do it" input counts as the act (Space, Enter,
// a left click, a touch, gamepad A, or any other non-steering key or face button). There is no fail
// state: a miss only softens what happens next (or the caller gently tries again).
//
// The vocabulary (the hatching teaches it, in this order):
//   press  a brushed ring contracts onto an inner mark; act when it meets it (window ~0.35 s)
//   mash   a cracked ring that shudders; each act bursts it a little more
//   hold   a ring that fills while the act is held; letting go drains it
//   steer  a brush-stroke chevron pointing a world direction; steer the calf that way
//
// Inside a Script coroutine (src/game/Script.js):
//   const h = game.qte.press({ at, lead: 1.2, window: 0.35 }); // at: Vector3 / whale / {x, y} screen 0..1 (y down)
//   const h = game.qte.mash({ at, need: 10, time: 6 });
//   const h = game.qte.hold({ at, time: 1.5, grace: 3 });
//   const h = game.qte.steer({ dir, from, time: 3, tol: 0.5 });   // tol: radians
//   yield* game.qte.wait(h);   // h: { done, ok, score 0..1, progress 0..1, cancel() }
// Optional on any: onHit(h), onMiss(h), onDone(h), onPress(h) (each mash act), retry (press: gentle
// retries after a miss), size (cue scale, default 1), quiet (no sound).
// Timing runs on real time (slow motion does not change the window); the autopilot (?auto) always
// succeeds, a little late, like a person would.
import { Mesh, PlaneGeometry, ShaderMaterial, Vector3, Vector2, CustomBlending, OneFactor, OneMinusSrcAlphaFactor } from 'three';
import { clamp, lerp } from '../core/math.js';

const POOL = 4;
const _v = new Vector3();
const _w = new Vector3();
const _r = new Vector3();
const _u = new Vector3();
const _f = new Vector3();
const _s = new Vector2();
const UP = new Vector3(0, 1, 0);
const KIND = { press: 0, mash: 1, hold: 2, steer: 3 };

const VERT = /* glsl */ `
uniform vec2 uCenter;
uniform float uSize;
uniform float uAspect;
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = vec4(uCenter + position.xy * vec2(uSize / uAspect, uSize), 0.0, 1.0);
}`;

// Every mark is a brush stroke: wobbling radius (integer harmonics, so a ring has no seam), width
// swelling and tapering along its length, drawn in a few overlapping strokes that overshoot, with
// dry-brush streaks toward each tail. uBoil steps a few times a second (a hand-drawn line boils).
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vP;
uniform float uKind, uA, uRing, uMark, uNear, uFill, uBurst, uOut, uOutK, uBoil, uTime, uHeld, uBeat;
uniform vec2 uDir;
uniform vec3 uLight;
#define PI 3.14159265
#define TAU 6.28318531
float h11(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float wob(float a, float s) { return sin(a * 2.0 + s * 6.1) * 0.5 + sin(a * 3.0 + s * 3.7) * 0.32 + sin(a * 5.0 + s * 9.3) * 0.18; }

// x: the stroke's core, y: its soft halo
vec2 brushRing(vec2 p, float r, float w, float s, float nS, float gap, float wobA) {
  float a = atan(p.y, p.x);
  float rr = length(p);
  vec2 best = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    if (fi >= nS) break;
    float a0 = (fi + h11(s + fi) * 0.4) / nS * TAU;
    float len = TAU / nS * (1.0 + 0.22 * h11(s + fi * 3.1)) - gap;
    float u = mod(a - a0, TAU) / len;
    if (u <= 1.0) {
      float taper = smoothstep(0.0, 0.16, u) * (1.0 - smoothstep(0.66, 1.0, u));
      float rad = r * (1.0 + wobA * wob(a, s + fi) + 0.035 * (h11(s + fi * 7.3) - 0.5) + 0.05 * (u - 0.5) * (h11(s + fi * 5.0) - 0.5));
      float ww = w * (0.4 + 0.8 * taper) * (0.82 + 0.3 * sin(u * 8.0 + fi * 2.0 + s));
      float d = abs(rr - rad);
      float c = 1.0 - smoothstep(ww * 0.35, ww, d);
      float br = 0.62 + 0.38 * sin((rr - rad) / max(ww, 1e-4) * 8.0 + h11(fi + s) * 20.0 + u * 4.0);
      c *= mix(1.0, br, smoothstep(0.45, 1.0, u));
      float hl = 1.0 - smoothstep(ww * 0.5, ww * 3.2, d);
      best = max(best, vec2(c * taper, hl * taper));
    }
  }
  return best;
}

// one arm of a chevron, slightly bowed, bold at the tip and thinning to a dry tail
vec2 arm(vec2 q, vec2 a, vec2 b, float w, float s) {
  vec2 pa = q - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), -0.06, 1.0);
  vec2 n = normalize(vec2(-ba.y, ba.x));
  float bow = 0.03 * sin(h * PI) + 0.01 * sin(h * 9.0 + s * 5.0);
  float d = length(pa - ba * h - n * bow);
  float ww = w * (1.0 - 0.65 * h) * (0.85 + 0.25 * sin(h * 7.0 + s));
  float c = 1.0 - smoothstep(ww * 0.35, ww, d);
  c *= mix(1.0, 0.6 + 0.4 * sin(d / max(ww, 1e-4) * 9.0 + s * 13.0), smoothstep(0.5, 1.0, h));
  c *= 1.0 - smoothstep(0.82, 1.0, h);
  float hl = (1.0 - smoothstep(ww * 0.5, ww * 3.5, d)) * (1.0 - smoothstep(0.7, 1.0, h));
  return vec2(c, hl);
}

void main() {
  vec2 p = vP;
  float s = uBoil;
  vec2 cov = vec2(0.0);
  float glow = 0.0;
  float bright = 1.0;
  float miss = uOut < 0.0 ? uOutK : 0.0;
  float win = uOut > 0.0 ? uOutK : 0.0;
  // a miss: the mark sags, as if it lost heart
  p.y += miss * miss * 0.22 * (1.0 - 0.4 * p.x * p.x);
  if (uKind < 0.5) {
    // ---- press: the ring closes onto the mark; it meets it on the beat ----
    float beat = uBeat;
    vec2 mk = brushRing(p, uMark * (1.0 + 0.06 * beat + win * 0.9), 0.024 + 0.012 * uNear, s + 1.7, 3.0, 0.55, 0.05);
    cov = max(cov, mk * (0.5 + 0.5 * uNear + 0.3 * beat));
    vec2 rg = brushRing(p, uRing * (1.0 + win * 0.6), 0.034 + 0.02 * uNear, s, 2.0, -0.2, 0.04 + 0.03 * (1.0 - uNear));
    float ra = smoothstep(0.0, 0.25, uFill) * (1.0 - win);
    cov = max(cov, rg * ra);
    float rr = length(p);
    glow = exp(-pow((rr - uMark) / 0.09, 2.0)) * (0.25 * uNear + 0.9 * uBurst);
    glow += exp(-rr * rr / 0.05) * uBurst * 0.6;
  } else if (uKind < 1.5) {
    // ---- mash: a cracked ring, shuddering; light leaks through the cracks as they widen ----
    float K = 7.0;
    float rr = length(p);
    float a = atan(p.y, p.x);
    float r0 = 0.42 * (1.0 + 0.1 * uBurst + win * 0.7);
    float f = (a + PI) / TAU * K + 0.05 * sin(rr * 46.0 + floor((a + PI) / TAU * K) * 3.0) + 0.03 * sin(rr * 90.0 + s);
    float id = floor(f), lo = fract(f);
    float gh = 0.035 + 0.16 * uFill + 0.05 * uBurst + win * 0.2;
    float inS = smoothstep(gh, gh + 0.05, lo) * (1.0 - smoothstep(1.0 - gh - 0.05, 1.0 - gh, lo));
    float sh = sin(uTime * 47.0 + id * 2.3) * 0.016 * (0.35 + uBurst + uFill * 0.5);
    float ri = r0 * (1.0 + 0.04 * wob(a, s + id * 0.37)) + sh + win * 0.15 * h11(id);
    float ww = 0.032 * (0.75 + 0.5 * sin(lo * PI)) * (1.0 + 0.3 * uBurst);
    float d = abs(rr - ri);
    float c = (1.0 - smoothstep(ww * 0.35, ww, d)) * inS;
    float hl = (1.0 - smoothstep(ww * 0.5, ww * 3.2, d)) * inS;
    cov = vec2(c, hl) * (1.0 - win);
    float gapC = 1.0 - inS;
    float leak = gapC * exp(-pow((rr - ri) / (0.07 + 0.2 * uFill), 2.0)) * (0.35 + 0.9 * uFill + 0.6 * uBurst);
    leak *= smoothstep(r0 - 0.12, r0, rr) + 0.3;
    glow = leak + exp(-rr * rr / 0.06) * (0.15 * uFill + 0.4 * uBurst) + win * exp(-rr * rr / 0.2) * (1.0 - win);
  } else if (uKind < 2.5) {
    // ---- hold: a faint guide, and a stroke that sweeps round while held ----
    float rr = length(p);
    float a = atan(p.y, p.x);
    float r0 = 0.42 * (1.0 + win * 0.6);
    vec2 gd = brushRing(p, r0, 0.014, s + 3.3, 3.0, 0.4, 0.04);
    cov = gd * 0.45 * (1.0 - win);
    float u = mod(PI * 0.5 - a, TAU) / TAU;
    float fill = uFill;
    float rad = r0 * (1.0 + 0.04 * wob(a, s) + 0.02 * u);
    float tip = 1.0 - smoothstep(fill - 0.06, fill, u);
    float ww = 0.04 * (0.6 + 0.5 * smoothstep(0.0, 0.08, u)) * (1.0 + 0.25 * uHeld);
    float d = abs(rr - rad);
    float c = (1.0 - smoothstep(ww * 0.35, ww, d)) * tip * step(0.001, fill);
    float hl = (1.0 - smoothstep(ww * 0.5, ww * 3.5, d)) * tip * step(0.001, fill);
    cov = max(cov, vec2(c, hl) * (0.55 + 0.45 * uHeld) * (1.0 - win));
    glow = exp(-rr * rr / 0.09) * fill * (0.25 + 0.3 * uHeld) + exp(-pow((rr - r0) / 0.1, 2.0)) * win * (1.0 - win) * 2.0;
    // the tip of the stroke glows like a wet brush
    vec2 tp = r0 * vec2(cos(PI * 0.5 - fill * TAU), sin(PI * 0.5 - fill * TAU));
    glow += exp(-dot(p - tp, p - tp) / 0.004) * uHeld * step(0.001, fill) * 0.8;
  } else {
    // ---- steer: chevrons streaming the way to go ----
    vec2 dir = normalize(uDir + 1e-5);
    vec2 q = vec2(dot(p, dir), dot(p, vec2(-dir.y, dir.x)));
    float flow = fract(uTime * 0.9);
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float x = -0.36 + (fk + flow) * 0.24;
      float fade = smoothstep(-0.4, -0.2, x) * (1.0 - smoothstep(0.3, 0.5, x));
      vec2 tipP = vec2(x + 0.1, 0.0);
      float sk = s + fk * 1.3;
      vec2 c1 = arm(q, tipP, tipP + vec2(-0.16, 0.19), 0.036, sk);
      vec2 c2 = arm(q, tipP + vec2(0.01, -0.004), tipP + vec2(-0.15, -0.2), 0.034, sk + 2.0);
      float lit = 0.45 + 0.55 * clamp(uFill * 3.0 - fk, 0.0, 1.0);
      cov = max(cov, max(c1, c2) * fade * lit);
    }
    glow = exp(-dot(q - vec2(0.15, 0.0), q - vec2(0.15, 0.0)) / 0.05) * (0.15 + 0.5 * uFill);
    cov *= 1.0 - win;
    glow += win * (1.0 - win) * exp(-dot(q, q) / 0.15) * 1.5;
  }
  // light over a faint ink halo (the halo keeps it readable on a bright sea)
  float A = uA * (1.0 - miss * 0.85);
  vec3 lightC = mix(uLight, vec3(0.62, 0.66, 0.72), miss);
  float core = clamp(cov.x, 0.0, 1.0) * A;
  float halo = clamp(cov.y, 0.0, 1.0) * A * 0.26 * (1.0 - win);
  glow = clamp(glow, 0.0, 2.0) * A;
  vec3 ink = vec3(0.05, 0.06, 0.09);
  vec3 col = lightC * core * bright + ink * halo * (1.0 - core) + lightC * glow * 0.45;
  float alpha = core + halo * (1.0 - core) + glow * 0.08;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`;

/** One pooled visual. */
class Cue {
  constructor(geo, scene) {
    this.u = {
      uCenter: { value: new Vector2() }, uSize: { value: 0.24 }, uAspect: { value: 1.6 },
      uKind: { value: 0 }, uA: { value: 0 }, uRing: { value: 1 }, uMark: { value: 0.36 }, uNear: { value: 0 },
      uFill: { value: 0 }, uBurst: { value: 0 }, uOut: { value: 0 }, uOutK: { value: 0 }, uBoil: { value: 0 },
      uTime: { value: 0 }, uHeld: { value: 0 }, uBeat: { value: 0 }, uDir: { value: new Vector2(1, 0) },
      uLight: { value: new Vector3(1.0, 0.9, 0.72) },
    };
    this.mat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u,
      transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true,
      blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
    this.mesh.visible = false;
    this.mesh.name = 'qte-cue';
    scene.add(this.mesh);
    this.st = null;
  }
}

export class QTE {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.time = 0;
    this.punch = 0;
    this._boilT = 0;
    this.boil = 0;
    const scene = game.engine.sceneUI || game.engine.sceneT;
    this._geo = new PlaneGeometry(2, 2);
    this.cues = Array.from({ length: POOL }, () => new Cue(this._geo, scene));
    // cues are placed on the final camera of the frame; the success punch narrows the lens a moment
    this._hook = (cam) => this._draw(cam);
    game.engine.beforeRender.push(this._hook);
  }

  get active() { return this.list.some((st) => !st.h.done); }

  // ---- the API ----------------------------------------------------------------------------
  press(o = {}) {
    return this._make('press', o, { lead: o.lead ?? 1.2, window: o.window ?? 0.35, retry: o.retry ?? 0, early: 0 });
  }

  mash(o = {}) {
    return this._make('mash', o, { need: Math.max(1, o.need ?? 10), time: o.time ?? 6, presses: 0 });
  }

  hold(o = {}) {
    return this._make('hold', o, { time: o.time ?? 1.5, grace: o.grace ?? 3, fill: 0, held: false });
  }

  steer(o = {}) {
    const dir = (o.dir ? _v.copy(o.dir) : _v.set(0, 0, 1)).normalize().clone();
    return this._make('steer', o, { dir, time: o.time ?? 3, tol: o.tol ?? 0.5, aligned: 0, need: o.need ?? 0.5, at: o.at ?? o.from });
  }

  /** Coroutine helper: yields until the cue is done; returns the handle. */
  *wait(h) {
    while (h && !h.done) yield 0;
    return h;
  }

  /** Cancel every cue (a skipped or cancelled scene). */
  clear() {
    for (const st of this.list) st.h.cancel();
  }

  // ---- internals ----------------------------------------------------------------------------
  _make(kind, o, extra) {
    const st = Object.assign({ kind, o, t: 0, vis: 0, out: 0, outT: 0, burst: 0, beat: 0, beatsDone: 0, cue: null, auto: 0 }, extra);
    st.at = extra.at ?? o.at;
    const h = {
      kind, done: false, ok: false, score: 0, progress: 0, cancelled: false,
      cancel: () => {
        if (h.done) return;
        h.done = true;
        h.cancelled = true;
        st.out = -1;
        st.quiet = true;
      },
    };
    st.h = h;
    st.cue = this.cues.find((c) => !c.st) || null;
    if (st.cue) { st.cue.st = st; st.cue.mesh.visible = true; }
    this.list.push(st);
    return h;
  }

  _auto() { return !!this.game.story?.autoplay; }

  update(dt) {
    const S = this.game.story;
    const paused = S && S.state === 'paused';
    if (!paused) this.time += dt;
    this._boilT += dt;
    if (this._boilT > 0.14) { this._boilT = 0; this.boil = (this.boil + 1.618) % 97; }
    this.punch = Math.max(0, this.punch - dt * 4);
    const inp = this.game.input;
    let pressed = !paused && inp.actAnyPressed;
    const down = !paused && inp.actAnyDown;
    for (const st of this.list) {
      if (st.h.done) {
        st.outT += dt;
        st.vis = Math.max(0, st.vis - dt * (st.quiet ? 3 : 1.3));
        continue;
      }
      if (paused) continue;
      st.t += dt;
      st.vis = Math.min(1, st.vis + dt * 4);
      st.burst = Math.max(0, st.burst - dt * 5);
      st.beat = Math.max(0, st.beat - dt * 4);
      const used = this['_' + st.kind](st, dt, pressed, down);
      if (used) pressed = false; // one press goes to one cue
    }
    // free finished cues once they have faded
    for (let i = this.list.length - 1; i >= 0; i--) {
      const st = this.list[i];
      if (st.h.done && st.vis <= 0.001 && st.outT > 0.5) {
        if (st.cue) { st.cue.st = null; st.cue.mesh.visible = false; }
        this.list.splice(i, 1);
      }
    }
    // a cue whose visual was not free (more than POOL at once) takes one as it frees
    for (const st of this.list) {
      if (!st.cue && !st.h.done) {
        const c = this.cues.find((q) => !q.st);
        if (c) { st.cue = c; c.st = st; c.mesh.visible = true; }
      }
    }
  }

  _press(st, dt, pressed) {
    const h = st.h, L = st.lead, W = st.window * 0.5;
    const e = st.t - L;
    h.progress = clamp(st.t / L, 0, 1);
    // a heartbeat counts the ring in: two beats before the mark, the third on it
    const beatGap = Math.min(0.6, L / 2.2);
    const next = L - (2 - st.beatsDone) * beatGap;
    if (st.beatsDone < 3 && st.t >= next) {
      st.beatsDone++;
      st.beat = 1;
      this._heartbeat(st.beatsDone === 3 ? 1 : 0.6);
    }
    let act = pressed;
    if (this._auto() && st.t >= L + 0.04) act = true;
    if (act) {
      if (Math.abs(e) <= W) {
        this._win(st, 1 - 0.5 * Math.abs(e) / W);
        return true;
      }
      if (e < -W) {
        // too early: close (a nervous jump) counts as a miss; far off it only shudders the ring
        if (e > -W - 0.28 || ++st.early >= 3) this._miss(st);
        else { st.burst = 0.6; this._thud(0.25); }
        return true;
      }
    }
    if (e > W) this._miss(st);
    return false;
  }

  _mash(st, dt, pressed) {
    const h = st.h;
    let act = pressed;
    if (this._auto()) {
      st.auto += dt;
      if (st.t > 0.35 && st.auto > 0.13) { st.auto = 0; act = true; }
    }
    if (act) {
      st.presses++;
      h.progress = clamp(st.presses / st.need, 0, 1);
      st.burst = 1;
      this._drum(0.45 + h.progress * 0.5, 0.8 + h.progress * 0.5);
      this.rumble(0.25 + h.progress * 0.4, 0.3, 70);
      st.o.onPress?.(h);
      if (h.progress >= 1) this._win(st, clamp(1 - st.t / (st.time * 1.6), 0.4, 1));
    }
    if (!h.done && st.t >= st.time) {
      h.score = h.progress;
      this._miss(st);
    }
    return act;
  }

  _hold(st, dt, pressed, down) {
    const h = st.h;
    let held = down;
    if (this._auto()) held = st.t > 0.4;
    if (held && !st.held) this._heartbeat(0.5);
    st.held = held;
    if (held) st.fill = Math.min(1, st.fill + dt / st.time);
    else st.fill = Math.max(0, st.fill - dt / (st.time * 0.8));
    h.progress = st.fill;
    // a slow heartbeat while it fills
    if (held) {
      st.auto += dt;
      if (st.auto > 0.75) { st.auto = 0; st.beat = 1; this._heartbeat(0.35 + st.fill * 0.4); this.rumble(0.1 + st.fill * 0.3, 0.05, 90); }
    }
    if (st.fill >= 1) { this._win(st, 1); return held; }
    if (st.t > st.time + st.grace) {
      h.score = st.fill;
      this._miss(st);
    }
    return false;
  }

  _steer(st, dt) {
    const h = st.h;
    let ok = this._auto() && st.t > 0.5;
    if (!ok) {
      const ang = this._steerAngle(st);
      ok = ang < st.tol + 0.15;
    }
    st.aligned = ok ? st.aligned + dt : Math.max(0, st.aligned - dt * 0.5);
    h.progress = clamp(st.aligned / st.need, 0, 1);
    if (h.progress >= 1) { this._win(st, clamp(1 - st.t / (st.time * 2), 0.5, 1)); return false; }
    if (st.t >= st.time) { h.score = h.progress * 0.6; this._miss(st); }
    return false;
  }

  /** The smallest angle between the cue's direction and the calf's heading or the player's steer. */
  _steerAngle(st) {
    const g = this.game, inp = g.input, cam = g.engine.camera;
    const dir = st.dir;
    let best = Math.PI;
    const calf = g.story?.herd?.calf;
    if (calf && calf.vel && calf.vel.lengthSq() > 2) {
      best = Math.min(best, calf.vel.angleTo(dir));
    }
    // the player's intent in camera space: turn/strafe, climb, swim forward, mouse and stick
    cam.getWorldDirection(_f);
    _r.crossVectors(_f, UP).normalize();
    _u.crossVectors(_r, _f).normalize();
    st.mx = (st.mx || 0) * 0.85 + (inp.mouseDX || 0) * 0.15;
    st.my = (st.my || 0) * 0.85 + (inp.mouseDY || 0) * 0.15;
    const ix = clamp(inp.turn + st.mx * 0.08 + (inp.gpAxes?.[2] || 0), -1, 1);
    const iy = clamp(inp.climb - st.my * 0.08 - (inp.gpAxes?.[3] || 0), -1, 1);
    const iz = clamp(inp.swim - inp.brake, -1, 1) * 0.6;
    _w.set(0, 0, 0).addScaledVector(_r, ix).addScaledVector(_u, iy).addScaledVector(_f, iz);
    if (_w.lengthSq() > 0.09) best = Math.min(best, _w.angleTo(dir));
    return best;
  }

  _win(st, score) {
    const h = st.h;
    h.done = true;
    h.ok = true;
    h.score = clamp(score, 0, 1);
    h.progress = 1;
    st.out = 1;
    st.outT = 0;
    st.burst = 1;
    this.punch = 1;
    this._chime(0.5 + h.score * 0.4);
    this._heartbeat(1.1);
    this.rumble(0.7, 0.5, 180);
    st.o.onHit?.(h);
    st.o.onDone?.(h);
  }

  _miss(st) {
    const h = st.h;
    if (h.done) return;
    // a gentle retry: the ring simply comes round again
    if (st.kind === 'press' && st.retry > 0) {
      st.retry--;
      st.t = Math.min(0, -0.3);
      st.beatsDone = 0;
      st.early = 0;
      st.burst = 0.5;
      this._thud(0.35);
      st.o.onMiss?.(h, true);
      return;
    }
    h.done = true;
    h.ok = false;
    st.out = -1;
    st.outT = 0;
    this._thud(0.55);
    this.rumble(0.35, 0, 120);
    st.o.onMiss?.(h, false);
    st.o.onDone?.(h);
  }

  // ---- drawing (on the frame's final camera) -----------------------------------------------
  _anchor(at, cam, out) {
    let a = typeof at === 'function' ? at() : at;
    if (a && !a.isVector3 && a.pos && a.pos.isVector3) a = a.pos;
    if (!a) return out.set(0, 0);
    if (a.isVector3) {
      _v.copy(a).project(cam);
      const behind = _v.z > 1;
      let x = behind ? -_v.x : _v.x, y = behind ? -_v.y : _v.y;
      if (behind) { const m = Math.max(Math.abs(x), Math.abs(y), 1e-3); x /= m; y /= m; }
      return out.set(clamp(x, -0.82, 0.82), clamp(y, -0.78, 0.78));
    }
    // a screen point, 0..1 with y down (as on a page)
    return out.set(clamp((a.x ?? 0.5) * 2 - 1, -0.9, 0.9), clamp(1 - (a.y ?? 0.5) * 2, -0.9, 0.9));
  }

  _draw(cam) {
    const eng = this.game.engine;
    const aspect = Math.max(0.3, (eng.width || innerWidth) / Math.max(1, eng.height || innerHeight));
    if (this.punch > 0.001) {
      const base = this.game.cameraRig?.fov ?? cam.fov;
      cam.fov = base * (1 - 0.045 * Math.sin(Math.min(1, this.punch) * Math.PI * 0.5) * this.punch);
      cam.updateProjectionMatrix();
    }
    for (const c of this.cues) {
      const st = c.st;
      if (!st) continue;
      const u = c.u;
      this._anchor(st.at, cam, u.uCenter.value);
      u.uAspect.value = aspect;
      // a narrow portrait screen: size by the shorter side
      u.uSize.value = 0.24 * (st.o.size ?? 1) * (aspect < 1 ? aspect : 1);
      u.uKind.value = KIND[st.kind];
      const outK = st.h.done ? clamp(st.outT / (st.out > 0 ? 0.7 : 0.9), 0, 1) : 0;
      u.uOut.value = st.h.done ? (st.out >= 0 ? 1 : -1) : 0;
      u.uOutK.value = outK;
      u.uA.value = st.vis * (st.h.done ? 1 - outK * 0.2 : 1);
      u.uBoil.value = this.boil + (KIND[st.kind] * 13.1);
      u.uTime.value = this.time;
      u.uBurst.value = st.burst;
      u.uBeat.value = st.beat;
      u.uHeld.value = st.held ? 1 : 0;
      if (st.kind === 'press') {
        const k = clamp(st.t / st.lead, 0, 1.4);
        u.uRing.value = lerp(1.0, 0.36, Math.min(1, k)) - Math.max(0, k - 1) * 0.3;
        u.uMark.value = 0.36;
        u.uNear.value = clamp(1 - Math.abs(st.t - st.lead) / Math.max(0.3, st.lead * 0.6), 0, 1);
        u.uFill.value = clamp(st.t / 0.3, 0, 1);
      } else if (st.kind === 'mash') {
        u.uFill.value = st.h.progress;
      } else if (st.kind === 'hold') {
        u.uFill.value = st.fill;
      } else if (st.kind === 'steer') {
        u.uFill.value = st.h.progress;
        // the world direction as seen on screen, from the anchor
        const from = typeof st.at === 'function' ? st.at() : st.at;
        const fp = from ? (from.isVector3 ? from : from.pos) : null;
        if (fp && fp.isVector3) {
          _v.copy(fp).project(cam);
          _w.copy(fp).addScaledVector(st.dir, 5).project(cam);
          _s.set((_w.x - _v.x) * aspect, _w.y - _v.y);
          if (_v.z > 1 || _w.z > 1) _s.set(st.dir.x, st.dir.y);
        } else {
          // no anchor in the world: the direction relative to the camera
          cam.getWorldDirection(_f);
          _r.crossVectors(_f, UP).normalize();
          _u.crossVectors(_r, _f).normalize();
          _s.set(st.dir.dot(_r), st.dir.dot(_u) + st.dir.dot(_f) * 0.6);
        }
        if (_s.lengthSq() < 1e-6) _s.set(0, 1);
        u.uDir.value.copy(_s.normalize());
      }
    }
  }

  // ---- sound and touch ----------------------------------------------------------------------
  _audio() {
    const a = this.game.story?.audio;
    return a && a.ready && a.ctx && a.bus && a.bus.sfx ? a : null;
  }

  /** A heartbeat outside any cue (the scene's own pulse), with a soft rumble. */
  heartbeat(gain = 0.6) {
    this._heartbeat(gain);
    this.rumble(0.12 * gain, 0.04, 80);
  }

  /** A low heartbeat drum: a lub-dub, felt more than heard. */
  _heartbeat(gain = 1) {
    const a = this._audio();
    if (!a) return;
    try {
      const ctx = a.ctx, t = ctx.currentTime + 0.01;
      const out = ctx.createGain();
      out.gain.value = 0.55 * gain;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 220;
      out.connect(lp);
      lp.connect(a.bus.sfx);
      for (const [dt, f0, amp] of [[0, 78, 1], [0.17, 66, 0.6]]) {
        const o = ctx.createOscillator();
        const e = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(f0, t + dt);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + dt + 0.16);
        e.gain.setValueAtTime(0.0001, t + dt);
        e.gain.exponentialRampToValueAtTime(amp, t + dt + 0.012);
        e.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.22);
        o.connect(e);
        e.connect(out);
        o.start(t + dt);
        o.stop(t + dt + 0.26);
      }
      setTimeout(() => { try { out.disconnect(); lp.disconnect(); } catch (e) { /* gone */ } }, 700);
    } catch (e) { /* audio unavailable */ }
  }

  /** A skin-drum tick for each mash (pitch climbs with progress). */
  _drum(gain = 0.6, pitch = 1) {
    const a = this._audio();
    if (!a) return;
    try {
      const ctx = a.ctx, t = ctx.currentTime + 0.005;
      const o = ctx.createOscillator(), e = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 600 * pitch;
      o.type = 'triangle';
      o.frequency.setValueAtTime(120 * pitch, t);
      o.frequency.exponentialRampToValueAtTime(60 * pitch, t + 0.09);
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(0.5 * gain, t + 0.006);
      e.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(e); e.connect(lp); lp.connect(a.bus.sfx);
      o.start(t); o.stop(t + 0.16);
      setTimeout(() => { try { lp.disconnect(); } catch (err) { /* gone */ } }, 400);
    } catch (e) { /* audio unavailable */ }
  }

  /** A muffled thud: the softer outcome. */
  _thud(gain = 0.5) {
    const a = this._audio();
    if (!a) return;
    try {
      const ctx = a.ctx, t = ctx.currentTime + 0.005;
      const len = Math.floor(ctx.sampleRate * 0.25);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.18));
      const n = ctx.createBufferSource();
      n.buffer = buf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 160;
      const e = ctx.createGain();
      e.gain.value = 0.9 * gain;
      const o = ctx.createOscillator(), oe = ctx.createGain();
      o.frequency.setValueAtTime(58, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.2);
      oe.gain.setValueAtTime(0.0001, t);
      oe.gain.exponentialRampToValueAtTime(0.4 * gain, t + 0.02);
      oe.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      n.connect(lp); lp.connect(e); e.connect(a.bus.sfx);
      o.connect(oe); oe.connect(a.bus.sfx);
      n.start(t); o.start(t); o.stop(t + 0.32);
      setTimeout(() => { try { e.disconnect(); oe.disconnect(); } catch (err) { /* gone */ } }, 600);
    } catch (e) { /* audio unavailable */ }
  }

  _chime(gain = 0.7) {
    const a = this.game.story?.audio;
    a?.sfx?.('chime', { gain });
  }

  /** Rumble the gamepad if it can (dual-rumble), quietly ignored otherwise. */
  rumble(strong = 0.5, weak = 0.3, ms = 120) {
    const inp = this.game.input;
    if (inp.gamepadBlocked || !navigator.getGamepads) return;
    try {
      for (const p of navigator.getGamepads() || []) {
        const va = p && p.connected && p.vibrationActuator;
        if (va && va.playEffect) {
          const r = va.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) });
          if (r && r.catch) r.catch(() => {});
        }
      }
    } catch (e) { /* no rumble */ }
  }

  dispose() {
    const i = this.game.engine.beforeRender.indexOf(this._hook);
    if (i >= 0) this.game.engine.beforeRender.splice(i, 1);
    for (const c of this.cues) { c.mesh.parent?.remove(c.mesh); c.mat.dispose(); }
    this._geo.dispose();
  }
}

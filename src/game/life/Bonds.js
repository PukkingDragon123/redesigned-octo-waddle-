// Stick to her (docs/VUR_SOK.md 0.11; the user's "you need to stick to her, she will get panicked and
// put you in her mouth"). Early in ACT I, in the Dawn Lagoon after the hatching, the first danger:
// skimmers wheel down out of the dawn and lanternjack lures rise from the deep under the calf.
//  1. the mother calls; the calf must stick to her: steer cues into her lee as she swings through a
//     tight turn (src/game/QTE.js steer). A miss: she swings back for it (softer, never a fail).
//  2. she panics (fast breathing, wide eyes, frantic calls: drive.fear), and scoops the calf into her
//     mouth, a mouthbrooder carrying its young.
//  3. inside her mouth (a dark, wet cavity built here; light through her lips and the fringe of her
//     baleen; the world outside muffled, her heartbeat): hold to stay calm while she fights and flees
//     (thuds, the light swinging, her muffled roar).
//  4. outside, safe: she opens her mouth, lets the calf out gently and checks it over (her eye, a
//     nuzzle, a slow circle), then a coo.
// Later in ACT I, if the calf strays far and something really goes for it, she may (rarely) fetch it
// and carry it a short way in her mouth again (update()).
// Story creates it (new Bonds(game, story)), calls update(dt), and runs danger() in the Dawn Lagoon.
// Debug: ?debug&chapter=0&scene=mouth plays the scene at once.
import {
  Vector3, Mesh, SphereGeometry, ShaderMaterial, BackSide, Group, Color,
} from 'three';
import { clamp, damp, lerp, smoothstep } from '../../core/math.js';
import { seaHeight } from '../Swim.js';

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const UP = new Vector3(0, 1, 0);

// The cavity: an ellipsoid seen from inside, wet dark flesh with soft ridges of palate (domain-warped,
// never straight), warm translucence near the lips where the daylight soaks through, a slit of lips
// open at the front with a fringe of baleen strands across it, all pulsing faintly with her heartbeat.
const VERT = /* glsl */ `
varying vec3 vL;
varying vec3 vN;
varying vec3 vW;
void main() {
  vL = position;
  vN = normalize(normalMatrix * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = /* glsl */ `
precision highp float;
varying vec3 vL;
varying vec3 vN;
varying vec3 vW;
uniform float uTime, uBeat, uOpen, uLight, uFear;
uniform vec3 uSky;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * n2(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
void main() {
  // local frame: z forward (toward the lips), y up, x across; unit ellipsoid
  vec3 p = vL;
  float fwd = p.z;
  // the lips: a slit at the front, wider in the middle, curving like a mouth (warped, never straight)
  float across = abs(p.x);
  float lip = (0.10 + 0.18 * uOpen) * (1.0 - smoothstep(0.35, 0.95, across)) + 0.02 * sin(p.x * 9.0 + uTime * 0.7);
  float curve = -0.06 * (1.0 - across * across) + 0.03 * fbm(p.xz * 6.0);
  float inSlit = step(0.62, fwd) * (1.0 - smoothstep(lip * 0.75, lip, abs(p.y - curve)));
  // baleen fringe across the opening: hanging strands, wobbling, tapering, some broken
  float bx = p.x * 34.0 + 1.6 * fbm(vec2(p.x * 5.0, p.y * 3.0 + uTime * 0.15)) + 0.4 * sin(p.y * 12.0);
  float strand = 1.0 - smoothstep(0.08, 0.32, abs(fract(bx) - 0.5) * (1.6 + 0.8 * h(vec2(floor(bx), 3.0))));
  float hang = smoothstep(-0.4, 0.9, (curve + lip - p.y) / max(lip * 2.0, 1e-3)) * step(0.25, h(vec2(floor(bx), 7.0)));
  float baleen = strand * hang * inSlit;
  if (inSlit > 0.5 && baleen < 0.35) discard;
  // flesh: dark wet red-brown, ridges of palate along the roof
  float ridges = sin(fwd * 26.0 + 2.5 * fbm(p.xy * 3.0) + abs(p.x) * 4.0);
  ridges = smoothstep(0.2, 0.95, ridges) * smoothstep(0.0, 0.6, p.y);
  float mott = fbm(p.xz * 7.0 + p.y * 3.0);
  vec3 flesh = mix(vec3(0.16, 0.035, 0.04), vec3(0.42, 0.11, 0.1), mott * 0.7 + ridges * 0.3);
  // the tongue below: a paler soft bed
  flesh = mix(flesh, vec3(0.5, 0.2, 0.2), smoothstep(-0.35, -0.75, p.y) * 0.6);
  // daylight soaking through the lips and cheeks near the front (warm translucence), pulsing
  float near = smoothstep(0.1, 0.95, fwd) * (0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.7, abs(p.y - curve))));
  float pulse = 0.8 + 0.2 * uBeat;
  vec3 glow = vec3(1.0, 0.36, 0.22) * near * uLight * pulse * (0.9 + 0.3 * mott);
  // a wet sheen: thin bright streaks catching the slit's light
  float sheen = pow(max(0.0, fbm(p.yz * 14.0 + uTime * 0.05) - 0.45), 2.0) * 6.0 * near;
  vec3 col = flesh * (0.25 + 0.75 * uLight * (0.3 + near)) + glow * 0.9 + vec3(1.0, 0.8, 0.7) * sheen * uLight;
  // the baleen: dark horn, rimmed by the daylight behind it
  col = mix(col, vec3(0.12, 0.08, 0.05) + uSky * 0.6 * smoothstep(0.35, 0.8, baleen), step(0.35, baleen));
  // the throat at the back falls into darkness
  col *= mix(0.15, 1.0, smoothstep(-0.95, -0.2, fwd));
  col *= 1.0 + 0.4 * uFear * uBeat;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Bonds {
  constructor(game, story) {
    this.game = game;
    this.story = story;
    this.carrying = false;
    this.inside = false;
    this.cd = 120; // seconds before a later rescue may happen again
    this.count = 0;
    this.log = [];
    this.beat = 0;
    this.beatT = 0;
    this.rate = 1.1; // heartbeats per second
    this.muffle = 0;
    this.dark = 0;
    this._hits = 0;
    this._lagoonDone = false;
    this.mouth = null; // the cavity (built on first use)
  }

  get herd() { return this.story.herd; }

  // ---- the cavity -----------------------------------------------------------------------------
  _build() {
    if (this.mouth) return this.mouth;
    const mat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, side: BackSide,
      uniforms: { uTime: { value: 0 }, uBeat: { value: 0 }, uOpen: { value: 0.3 }, uLight: { value: 1 }, uFear: { value: 0 }, uSky: { value: new Color(0.9, 0.85, 0.75) } },
    });
    const geo = new SphereGeometry(1, 64, 40);
    // a little irregular, like a real mouth (never a perfect ellipsoid)
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = 1 + 0.05 * Math.sin(x * 5 + z * 3) + 0.04 * Math.sin(y * 7 + x * 2) - 0.12 * Math.max(0, -y) * (1 - Math.abs(x));
      pos.setXYZ(i, x * k, y * k * (y > 0 ? 1 : 0.85), z * k);
    }
    geo.computeVertexNormals();
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    const grp = new Group();
    grp.add(mesh);
    grp.visible = false;
    this.game.engine.scene.add(grp);
    this.mouth = { grp, mesh, mat };
    return this.mouth;
  }

  /** The cavity's frame in the mother's head: centre, axes (z to the lips), half-sizes. */
  _frame(m, out = {}) {
    const L = m.L;
    out.c = (out.c || new Vector3()).copy(m.pos).addScaledVector(m.fwd, L * 0.36).addScaledVector(m.up, -L * 0.035);
    out.s = (out.s || new Vector3()).set(L * 0.085, L * 0.06, L * 0.14);
    return out;
  }

  _place(m) {
    const M = this._build();
    const f = this._frame(m, this._f || (this._f = {}));
    M.grp.position.copy(f.c);
    M.grp.quaternion.copy(m.group.quaternion);
    M.mesh.scale.copy(f.s);
    return f;
  }

  // ---- per frame ------------------------------------------------------------------------------
  update(dt) {
    const S = this.story, g = this.game, herd = this.herd;
    if (!herd) return;
    const calf = herd.calf, mom = herd.mother;
    // her heart (faster when afraid): drives the cavity's pulse and the thumps inside
    const want = this.carrying ? lerp(0.9, 2.3, mom.drive.fear) : 1;
    this.rate = damp(this.rate, want, 1.5, dt);
    this.beatT += dt * this.rate;
    let thump = false;
    if (this.beatT >= 1) { this.beatT -= 1; thump = true; }
    const ph = this.beatT;
    this.beat = Math.exp(-ph * 9) + 0.6 * Math.exp(-Math.max(0, ph - 0.18) * 11) * (ph > 0.18 ? 1 : 0);
    if (this.mouth?.grp.visible) {
      this._place(mom);
      const u = this.mouth.mat.uniforms;
      u.uTime.value = g.time;
      u.uBeat.value = this.beat;
      u.uFear.value = mom.drive.fear;
      u.uOpen.value = damp(u.uOpen.value, this.open ?? 0.3, 3, dt);
      u.uLight.value = damp(u.uLight.value, this.light ?? 1, 2, dt);
      if (thump && this.inside) {
        g.qte?._heartbeat?.(0.55 + 0.4 * mom.drive.fear);
        if (!g.qte?._heartbeat) S.audio?.sfx?.('bonk', { position: calf.pos, gain: 0.35, pitch: 0.35 });
      }
    }
    // the inside: muffled world, darker frame
    this.muffle = damp(this.muffle, this.inside ? 1 : 0, this.inside ? 3 : 1.5, dt);
    this.dark = damp(this.dark, this.inside ? 1 : 0, 3, dt);
    this._mix();
    this._grade();
    // a carried calf rides inside her (kinematic, hidden from outside)
    if (this.carrying) {
      const f = this._frame(mom, this._f2 || (this._f2 = {}));
      const sc = calf.group.scale.x;
      calf.pos.copy(f.c).addScaledVector(mom.fwd, -calf.L * sc * 0.05).addScaledVector(mom.up, -f.s.y * 0.25);
      calf.vel.copy(mom.vel);
      calf.yaw = mom.yaw;
      calf.pitch = mom.pitch;
      calf._syncTransform?.();
      calf.group.visible = this.inside;
      calf.drive.sleep = 0.4;
    }
    // later in ACT I: a stray in real danger may be fetched again (rarely)
    this.cd -= dt;
    const hunt = S.activities?.hunt;
    if (hunt) {
      if (hunt.hits > this._hits && !this.carrying && this._lagoonDone && this.cd <= 0 && S.act === 1 && S.state === 'play' &&
        !S.cine?.active && !S.script.running('bondsScene') && !S.script.running('abilityScene') && hunt.stray > 0.45 &&
        !S.song?.active && (S.weather?.level ?? 0) < 0.3 && !herd.threat && herd.mode === 'travel') {
        this.cd = 240;
        S.script.run(this.rescue(), 'bondsScene');
      }
      this._hits = hunt.hits;
    }
  }

  _mix() {
    const a = this.story.audio, B = a?.bus, ctx = a?.ctx;
    if (!B || !ctx || !B.worldLP) return;
    const m = this.muffle;
    if (m < 0.002 && !this._muffled) return;
    this._muffled = m > 0.002;
    try {
      const now = ctx.currentTime;
      const cloud = a._cloud || 0;
      const base = (lo) => 20000 * Math.pow(lo / 20000, cloud);
      B.worldLP.frequency.setTargetAtTime(lerp(base(950), 380, m), now, 0.05);
      B.musicLP?.frequency.setTargetAtTime(lerp(base(4200), 900, m), now, 0.08);
    } catch (e) { /* the audio graph changed */ }
  }

  _grade() {
    const gr = this.game.engine?.post?.grade;
    if (!gr || this.dark < 0.002) return;
    const d = this.dark;
    gr.uVignette.value += 0.55 * d;
    gr.uSaturation.value *= 1 - 0.1 * d;
    const vc = gr.uVignetteColor?.value;
    if (vc) { vc.r *= 1 - 0.3 * d; vc.g *= 1 - 0.75 * d; vc.b *= 1 - 0.75 * d; }
  }

  /** Mother's panic: fast breath, wide eyes, frantic calls. */
  _panic(m, k) {
    m.drive.fear = Math.max(m.drive.fear, k);
    m.drive.excite = Math.max(m.drive.excite, k * 0.8);
    m.anim.breatheRate = lerp(1, 3, k);
  }

  // ---- the predators ----------------------------------------------------------------------------
  _spawnThreats(center) {
    const S = this.story, eco = S.eco, g = this.game;
    const T = [];
    try {
      const sky = center.clone().add(_v.set(-60, 70, -40));
      const f = eco?.addReptileFlock?.(sky, 'skimmer', 4, { anchor: sky.clone(), leash: 30, perch: false, roost: false });
      if (f) T.push({ kind: 'skimmer', school: f, anchor: f.anchor || null });
      const deep = center.clone();
      deep.y = seaHeight(g, deep.x, deep.z) - 14;
      const j = eco?.addFishSchool?.(deep, 'lanternjack', 3, { anchor: deep.clone(), leash: 14 });
      if (j) T.push({ kind: 'lanternjack', school: j, anchor: j.anchor || null });
    } catch (e) { /* the ecosystem changed */ }
    return T;
  }

  _moveThreats(T, calf, k) {
    for (const t of T) {
      const a = t.school?.anchor;
      if (!a || !a.lerp) continue;
      _v.copy(calf.pos);
      if (t.kind === 'lanternjack') _v.y = Math.min(_v.y - 5, seaHeight(this.game, _v.x, _v.z) - 4);
      else _v.y += 12;
      a.lerp(_v, k);
    }
  }

  _releaseThreats(T, from) {
    const S = this.story;
    for (const t of T) {
      try {
        if (t.kind === 'skimmer') { t.school.anchor = null; t.school.home?.set?.(from.x + 600, 160, from.z - 500); }
        else S.eco?.fish?.removeSchool?.(t.school);
      } catch (e) { /* ignore */ }
    }
    S.eco?.scatter?.(from, 60, 1.4);
  }

  // ---- the first danger (the Dawn Lagoon) -----------------------------------------------------------
  *danger(opts = {}) {
    const S = this.story, g = this.game, herd = this.herd, mom = herd.mother, calf = herd.calf, C = S.cine;
    const Q = g.qte;
    if (!Q || S.act !== 1) { this._lagoonDone = true; return; }
    if (this._lagoonDone && !opts.force) return;
    this._lagoonDone = true;
    let t = 0;
    while ((S.state !== 'play' || C.active) && t < 15) t += yield 0;
    if (S.state !== 'play' || C.active) return;
    this.log.push({ t: g.time, kind: 'lagoon' });
    const mode0 = herd.mode, speed0 = herd.targetSpeed;
    herd.mode = 'rest';
    herd.targetSpeed = 0;
    const T = this._spawnThreats(calf.pos);
    S.eco && (S.eco.threat = calf.pos.clone().add(_v.set(0, 40, 0)));
    // 1. something is wrong: the light dims under wings, lures glow in the deep; she tenses and calls
    const lee = new Vector3();
    const side = _v.copy(calf.pos).sub(mom.pos).dot(mom.right) >= 0 ? 1 : -1;
    const leeOf = (m) => lee.copy(m.pos).addScaledVector(m.right, side * (m.radius + calf.radius + 1.5)).addScaledVector(m.fwd, -m.L * 0.05).addScaledVector(m.up, -m.radius * 0.2);
    let turn = 0;
    const turnC = new Vector3();
    herd.motherScript = (m) => {
      if (turn === 0) return { target: _v2.copy(m.pos).addScaledVector(m.fwd, 6), speed: 2, arrive: 8, lookAt: calf.pos };
      // a tight turn around the calf's side of the lagoon, low, calling
      const a = g.time * 0.55 * side;
      _v2.set(turnC.x + Math.cos(a) * 34, Math.max(seaHeight(g, m.pos.x, m.pos.z) + m.radius * 0.8, turnC.y), turnC.z + Math.sin(a) * 34);
      return { target: _v2, speed: 9 + 3 * turn, arrive: 6, minSpeed: 6, lookAt: calf.pos };
    };
    C.begin({ focus: mom, rate: 0.5, lead: mom });
    S.audio.setMood?.('chase', { fade: 3 });
    S.audio.setIntensity?.(0.45);
    // the sky: wings wheeling down out of the dawn, a long lens past the calf
    yield* C.play(C.rel({ subject: calf, side: [-4, -3], up: [-0.4, 0.2], back: [7, 6], ahead: 0, lookUp: [22, 26], lookSide: [-14, -10], fov: [34, 28], worldUp: true }), 2.6, {
      onFrame: (k) => this._moveThreats(T, calf, 0.01),
    });
    this._panic(mom, 0.5);
    S.voiceCall(mom, 'warn');
    calf.anim.flinch?.(0.6);
    calf.drive.fear = 0.6;
    // the deep: lures rising under the calf, seen from below
    yield* C.play(C.macro({ subject: calf, dist: [9, 7], angle: [calf.yaw + 1.2, calf.yaw + 1.5], height: [-6, -5], fov: [42, 38], under: true }), 2.4, {
      onFrame: () => this._moveThreats(T, calf, 0.02),
    });
    C.end({ rate: 0.9 });
    // 2. stick to her: steer into her lee as she swings away through a tight turn
    turnC.copy(mom.pos).addScaledVector(mom.right, side * 34);
    turn = 1;
    S.life.autoGoal = () => leeOf(mom);
    let stuck = 0;
    for (let i = 0; i < 2; i++) {
      leeOf(mom);
      const dir = _v3.copy(lee).sub(calf.pos);
      if (dir.lengthSq() < 1) dir.copy(mom.fwd);
      const h = Q.steer({ dir: dir.normalize(), from: () => calf.pos, time: 3.2, tol: 0.55 });
      while (!h.done) {
        yield 0;
        this._moveThreats(T, calf, 0.015);
      }
      if (h.ok) { stuck++; calf.drive.happy = 0.4; }
      else {
        // it lags: she swings back for it, calling (softer)
        S.voiceCall(mom, 'warn');
        calf.vel.lerp(_v.copy(lee).sub(calf.pos).normalize().multiplyScalar(9), 0.6);
      }
      this._panic(mom, 0.6 + 0.2 * i);
      turn = 2;
      S.voiceCall(mom, i ? 'roar' : 'warn');
      yield 0.6;
    }
    // something strikes: a lure flashes from below, wings rake past
    calf.anim.flinch?.(1.2);
    calf.drive.fear = 1;
    S.voiceCall(calf, 'chirp');
    g.cameraRig?.addShake?.(0.35);
    S.audio?.sfx?.('splash', { position: calf.pos, gain: 0.6 });
    // 3. her panic peaks: she scoops the calf into her mouth (slow motion, close)
    this._panic(mom, 1);
    S.life.autoGoal = null;
    C.begin({ focus: calf, rate: 1.4, lead: mom });
    C.slowmo(0.45);
    S.life.kin.add(calf);
    const start = calf.pos.clone();
    const f = this._frame(mom, {});
    let tt = 0;
    const scoop = C.rel({ subject: mom, side: [side * 9, side * 7], up: [0.5, 0.2], back: [-mom.L * 0.42, -mom.L * 0.36], ahead: mom.L * 0.3, fov: [40, 34], worldUp: true });
    S.audio.stinger?.('strike');
    while (tt < 1.8 && !C.skipped) {
      const dt = yield 0;
      tt += g.dtReal ?? dt;
      const u = smoothstep(0.15, 1.2, tt);
      mom.drive.mouth = tt < 1.25 ? Math.min(1, tt * 2.2) : Math.max(0, 1 - (tt - 1.25) * 4);
      this._frame(mom, f);
      calf.pos.copy(start).lerp(f.c, u);
      calf.vel.copy(mom.vel);
      calf.yaw = lerp(calf.yaw, mom.yaw, u * 0.2);
      calf._syncTransform?.();
      scoop(clamp(tt / 1.8, 0, 1), tt, C.shot);
      if (tt > 1.2 && !this.carrying) { this.carrying = true; mom.anim.gulp?.(0.6); S.audio?.sfx?.('gulp', { position: mom.pos, gain: 0.7, pitch: 0.6 }); }
    }
    this.carrying = true;
    mom.drive.mouth = 0;
    C.slowmo(1);
    // 4. inside her mouth: dark, wet, warm light through her lips and baleen, her heart; stay calm
    yield* this._inside(T, side, { qte: true, fight: true });
    // 5. outside: she flees through the lagoon, then slows in calm water
    S.eco && (S.eco.threat = null);
    this._releaseThreats(T, calf.pos);
    herd.motherScript = (m) => ({ target: _v2.copy(m.pos).addScaledVector(m.fwd, 30).setY(seaHeight(g, m.pos.x, m.pos.z) + m.radius * 0.7), speed: lerp(4, 14, m.drive.fear), arrive: 10, lookAt: null });
    yield* C.play(C.track({ subject: mom, side: [side * 40, side * 32], up: [3, 6], ahead: [10, 18], fov: [42, 46] }), 3.0, { onFrame: () => { mom.drive.fear = Math.max(0.2, mom.drive.fear - 0.004); } });
    yield* this._release(side);
    calf.drive.fear = 0;
    S.audio.setMood?.('dawn', { fade: 6 });
    S.audio.setIntensity?.(0.35);
    herd.mode = mode0;
    herd.targetSpeed = speed0;
    C.end({ rate: 0.45 });
  }

  /** Inside her mouth. opts.qte: hold to stay calm; opts.fight: thuds and her roar as she fights. */
  *_inside(T, side, opts = {}) {
    const S = this.story, g = this.game, herd = this.herd, mom = herd.mother, calf = herd.calf, C = S.cine;
    const Q = g.qte;
    const M = this._build();
    this._place(mom);
    M.grp.visible = true;
    this.inside = true;
    this.open = 0.32;
    this.light = 1;
    mom.group.visible = false;
    calf.group.visible = true;
    calf.drive.sleep = 0.4;
    const fr = this._f;
    // the lens at the back of her mouth, the calf curled before it, the lips' light beyond
    const shot = (k, t, s) => {
      this._place(mom);
      s.pos.copy(fr.c).addScaledVector(mom.fwd, -fr.s.z * lerp(0.62, 0.5, k)).addScaledVector(mom.up, fr.s.y * 0.3).addScaledVector(mom.right, side * fr.s.x * 0.25);
      s.look.copy(fr.c).addScaledVector(mom.fwd, fr.s.z).addScaledVector(mom.up, -fr.s.y * 0.05);
      s.fov = lerp(62, 56, k);
      s.roll = 0.04 * Math.sin(t * 0.7) * mom.drive.fear;
    };
    g.cameraRig.cineW = 1;
    g.cameraRig.cutNow?.();
    let t = 0, thudT = 0.6, calmK = 0, calmAt = null;
    const h = opts.qte && Q ? Q.hold({ at: { x: 0.5, y: 0.62 }, time: 2.6, grace: 5 }) : null;
    let tries = 0;
    let hh = h;
    const dur = opts.qte ? 12 : 3.5;
    while (t < dur && !C.skipped) {
      const dt = yield 0;
      t += dt;
      shot(clamp(t / dur, 0, 1), t, C.shot);
      C.handheld(C.shot, 0.6 + mom.drive.fear);
      // she fights and flees: the world outside lurches, muffled blows, the light swings
      thudT -= dt;
      if (opts.fight && thudT <= 0 && t < dur - 3) {
        thudT = lerp(0.9, 1.6, Math.random());
        g.cameraRig?.addShake?.(0.18 + 0.2 * mom.drive.fear);
        S.audio?.sfx?.(Math.random() < 0.5 ? 'tailSlap' : 'boomSmall', { position: mom.pos, gain: 0.5, pitch: 0.6 });
        this.light = 0.55 + 0.5 * Math.random();
        if (Math.random() < 0.35) S.voiceCall(mom, 'roar');
        calf.anim.flinch?.(0.3 * (1 - calmK));
      }
      // the calf: held, it calms (its breath slows, eyes half-close); otherwise it squirms
      if (hh) {
        calmK = hh.progress;
        calf.drive.fear = 1 - 0.8 * calmK;
        calf.drive.sleep = 0.3 + 0.5 * calmK;
        if (hh.done) {
          if (hh.ok) { calf.drive.happy = 0.4; mom.drive.fear = Math.max(0.35, mom.drive.fear - 0.3); this.light = 1.1; hh = null; }
          else if (tries++ < 1) {
            // it squirms; she hums to it through her own body, and it tries again
            calf.anim.flinch?.(0.8);
            g.cameraRig?.addShake?.(0.12);
            S.voiceHum(mom, S.song.midi(0, -2), 2.4);
            hh = Q.hold({ at: { x: 0.5, y: 0.62 }, time: 2.0, grace: 5 });
          } else hh = null;
        }
      } else if (opts.qte) {
        // calm again: a few more heartbeats in the dark, then out
        calmAt = calmAt ?? t;
        if (t > Math.max(6, calmAt + 2.5)) break;
      }
      mom.drive.fear = Math.max(0.35, mom.drive.fear - dt * 0.03);
    }
    if (hh && !hh.done) hh.cancel?.();
    // back outside
    M.grp.visible = false;
    this.inside = false;
    mom.group.visible = true;
    calf.group.visible = false;
    g.cameraRig?.cutNow?.();
  }

  /** Safe: she slows, opens her mouth and lets the calf out, then checks it over. */
  *_release(side) {
    const S = this.story, g = this.game, herd = this.herd, mom = herd.mother, calf = herd.calf, C = S.cine;
    herd.motherScript = (m) => ({ target: _v2.copy(m.pos).addScaledVector(m.fwd, 10).setY(seaHeight(g, m.pos.x, m.pos.z) + m.radius * 0.6), speed: 1.5, arrive: 10, lookAt: null });
    C.setFocus(mom);
    const out = C.rel({ subject: mom, side: [side * 11, side * 9], up: [0.6, 0.8], back: [-mom.L * 0.55, -mom.L * 0.5], ahead: mom.L * 0.3, fov: [36, 32], worldUp: true });
    let t = 0;
    const f = this._frame(mom, {});
    const exitP = new Vector3();
    let freed = false;
    while (t < 3.4 && !C.skipped) {
      const dt = yield 0;
      t += dt;
      out(clamp(t / 3.4, 0, 1), t, C.shot);
      C.handheld(C.shot, 0.8);
      mom.drive.mouth = smoothstep(0.2, 1.0, t) * (1 - smoothstep(2.4, 3.2, t)) * 0.9;
      if (t > 0.9 && !freed) {
        freed = true;
        this.carrying = false;
        calf.group.visible = true;
        this._frame(mom, f);
        exitP.copy(f.c);
      }
      if (freed) {
        // it drifts out between her lips, blinking in the light
        const u = smoothstep(0.9, 2.6, t);
        this._frame(mom, f);
        calf.pos.copy(f.c).addScaledVector(mom.fwd, lerp(0, mom.L * 0.32 + calf.L * 0.8, u)).addScaledVector(mom.right, side * u * calf.L * 0.5);
        calf.vel.copy(mom.vel);
        calf.yaw = mom.yaw + side * u * 0.6;
        calf.pitch = 0;
        calf._syncTransform?.();
      }
    }
    this.carrying = false;
    mom.drive.mouth = 0;
    calf.group.visible = true;
    S.life.kin.delete(calf);
    calf.drive.sleep = 0;
    calf.vel.copy(mom.vel).addScaledVector(mom.fwd, 1.5);
    S.voiceCall(calf, 'chirp');
    // she checks it over: her eye on it, a nuzzle, a slow look along its body
    mom.drive.fear = 0.15;
    mom.anim.breatheRate = 1;
    herd.motherScript = (m) => ({ target: _v2.copy(calf.pos).addScaledVector(calf.right, -side * (m.radius + calf.radius + 2)).addScaledVector(m.fwd, -m.L * 0.3), speed: 3, arrive: 8, lookAt: calf.pos, face: calf.pos });
    C.setFocus(calf);
    yield* C.play(C.eye({ whale: mom, side: side, dist: [0.55, 0.42], fov: [32, 28] }), 2.2, { onFrame: (k, tt) => { mom.drive.lookAt = calf.pos; if (tt > 0.6 && !this._nz) { this._nz = true; mom.anim.gesture?.('nuzzle', { side: side }); } } });
    this._nz = false;
    S.voiceCall(mom, 'coo');
    mom.drive.happy = 1;
    calf.drive.happy = 1;
    yield* C.play(C.orbit({ center: calf, radius: [12, 16], height: [2.5, 4], angle: [calf.yaw + side * 2.2, calf.yaw + side * 1.6], fov: [40, 42], look: calf }), 2.6, { onFrame: (k, tt) => { if (tt > 1.4 && !this._wg) { this._wg = true; calf.anim.gesture?.('happyWiggle'); S.voiceCall(calf, 'play'); } } });
    this._wg = false;
    herd.motherScript = null;
    mom.drive.fear = 0;
  }

  /** Later in ACT I, rarely: a stray in real danger is fetched and carried a short way. */
  *rescue() {
    const S = this.story, g = this.game, herd = this.herd, mom = herd.mother, calf = herd.calf, C = S.cine;
    this.log.push({ t: g.time, kind: 'rescue' });
    this.count++;
    this._panic(mom, 0.9);
    S.voiceCall(mom, 'warn');
    herd.care.mode = 'fetch';
    // she races to it
    herd.motherScript = (m) => ({ target: _v2.copy(calf.pos).addScaledVector(_v.copy(m.pos).sub(calf.pos).normalize(), m.L * 0.4), speed: 26, arrive: 12, minSpeed: 10, lookAt: calf.pos, face: calf.pos });
    let t = 0;
    while (mom.pos.distanceTo(calf.pos) > mom.L * 0.6 + 6 && t < 14) t += yield 0;
    if (C.active || S.state !== 'play') { herd.motherScript = null; mom.drive.fear = 0; return; }
    const side = _v.copy(calf.pos).sub(mom.pos).dot(mom.right) >= 0 ? 1 : -1;
    C.begin({ focus: mom, rate: 1.2, lead: mom });
    C.slowmo(0.5);
    S.life.kin.add(calf);
    const start = calf.pos.clone();
    const f = this._frame(mom, {});
    t = 0;
    const shot = C.rel({ subject: mom, side: side * 10, up: 1, back: -mom.L * 0.45, ahead: mom.L * 0.3, fov: 38, worldUp: true });
    while (t < 1.4 && !C.skipped) {
      const dt = yield 0;
      t += g.dtReal ?? dt;
      mom.drive.mouth = t < 1 ? Math.min(1, t * 2.5) : Math.max(0, 1 - (t - 1) * 4);
      this._frame(mom, f);
      calf.pos.copy(start).lerp(f.c, smoothstep(0.1, 1, t));
      calf._syncTransform?.();
      shot(clamp(t / 1.4, 0, 1), t, C.shot);
    }
    this.carrying = true;
    mom.drive.mouth = 0;
    C.slowmo(1);
    // back to the herd, the calf safe inside
    herd.motherScript = (m) => ({ target: _v2.copy(herd.anchor || m.pos).setY(Math.max(herd.anchor?.y ?? m.pos.y, seaHeight(g, m.pos.x, m.pos.z) + 10)), speed: 18, arrive: 20, lookAt: null });
    yield* this._inside(null, side, { qte: false, fight: false });
    yield* C.play(C.track({ subject: mom, side: side * 36, up: 4, ahead: 12, fov: 44 }), 2.4);
    yield* this._release(side);
    S.activities?.hunt && (S.activities.hunt.hunting = 0);
    herd.care.mode = 'lead';
    C.end({ rate: 0.45 });
  }
}

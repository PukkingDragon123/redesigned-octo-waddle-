// The whale egg of Vur Sok: a single embryo-like egg laid in the calm eye of the Spiral Maelstrom.
// A translucent, veined, softly glowing membrane; inside, the curled calf (Embryo) seen through the
// milky fluid, its heart throbbing; it cracks with hand-drawn lines leaking light, then bursts into
// membrane shards that float and sink, a cloud of fluid, bubbles and a soft flash, and the calf
// uncurls and swims out.
//
//   const egg = new WhaleEgg(game, { position, length: 3.2, glow: 1, pulse: 1.1 });
//   egg.update(dt); egg.setGlow(k); egg.setPulse(rate); egg.crack(k); egg.embryo.kick();
//   await egg.hatch();  // or egg.on('hatch' | 'emerged', fn); egg.dispose();
//
// The embryo is drawn in the opaque pass; the membrane in the transparent pass (after the sea, so the
// waterline never cuts it), refracting what the opaque pass drew inside it.
import {
  Group, Mesh, SphereGeometry, ShaderMaterial, InstancedMesh, BufferGeometry, Float32BufferAttribute,
  Vector3, Quaternion, Matrix4, Euler, Color, CustomBlending, OneFactor, OneMinusSrcAlphaFactor,
  AlwaysDepth, DoubleSide, FrontSide, DynamicDrawUsage,
} from 'three';
import { G } from '../../render/Globals.js';
import { SHELL_VERT, SHELL_FRAG, SHARD_VERT, SHARD_FRAG } from './shaders.js';
import { Embryo } from './Embryo.js';

const NSHARD = 36;
// amniotic fluid extinction per metre: what the depth of the egg turns to (opts.tint)
const TINTS = { teal: [1.15, 0.5, 0.42], cornflower: [1.25, 0.72, 0.26], amber: [0.35, 0.6, 1.3] };
const TAU = Math.PI * 2;

/** An egg-shaped ellipsoid: long axis along local x, one end a little blunter. */
function eggGeometry(a, b) {
  const g = new SphereGeometry(1, 96, 64);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.085 * x - 0.03 * x * x;
    p.setXYZ(i, x * a, y * b * k, z * b * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A curved membrane shard with a torn, hand-drawn rim (a jittered fan on a sphere cap). */
function shardGeometry(seed = 3) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const n = 11, Rc = 1.2;
  const pos = [0, 0, 0], nrm = [0, 0, 1], idx = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (rnd() - 0.5) * 0.4;
    const r = 0.55 + rnd() * 0.45;
    const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.8;
    const z = -(x * x + y * y) / (2 * Rc);
    pos.push(x, y, z);
    const l = Math.hypot(x / Rc, y / Rc, 1);
    nrm.push(x / Rc / l, y / Rc / l, 1 / l);
    idx.push(0, 1 + i, 1 + ((i + 1) % n));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

export class WhaleEgg {
  constructor(game, opts = {}) {
    this.game = game;
    this.engine = game.engine;
    this.length = opts.length ?? 3.2;
    this.width = opts.width ?? this.length * 0.72;
    const a = this.length / 2, b = this.width / 2;
    this.half = new Vector3(a, b, b);
    this.float = opts.float ?? true;          // ride the sea surface (else .position.y is kept)
    this.floatLift = opts.floatLift ?? b * 0.28; // centre above the water: ~35% submerged
    this.time = 0;
    this.hatched = false;
    this.disposed = false;
    this._glow = opts.glow ?? 1;
    this._glowTarget = this._glow;
    this._rate = opts.pulse ?? 1.1;           // heartbeats per second
    this._phase = 0;
    this._crack = 0;
    this._crackTarget = 0;
    this._jolt = 0;
    this._yaw = opts.yaw ?? 0;
    this._vy = 0;
    this._fade = 1;
    this._handlers = {};
    this._seed = (opts.seed ?? 11) * 7919 + 13;
    this._idle = opts.idleKicks ?? true;
    this._nextKick = 4;
    this._hatchT = -1;

    this.group = new Group();
    this.group.name = 'whale-egg';
    if (opts.position) this.group.position.copy(opts.position);
    this.position = this.group.position;
    this.engine.scene.add(this.group);

    const col = (c, d) => new Color(c ?? d);
    const shellU = Object.assign({}, G, {
      uHalf: { value: this.half },
      uGlow: { value: this._glow },
      uBeat: { value: 0 },
      uCrack: { value: 0 },
      uCrackDir: { value: new Vector3(0.35, 0.9, 0.25).normalize() },
      uAlpha: { value: 1 },
      uMembrane: { value: col(opts.membrane, '#e4f1f2') },
      uFluid: { value: col(opts.fluid, '#ffb066') },
      uFluidAbs: { value: opts.fluidAbs ? new Vector3().copy(opts.fluidAbs) : new Vector3().fromArray(TINTS[opts.tint] || TINTS.teal) },
      uScatter: { value: col(opts.scatter, (opts.tint === 'cornflower') ? '#5e7fd6' : '#3e9a9e') },
      uVein: { value: col(opts.vein, '#8e2238') },
      uLeak: { value: col(opts.leak, '#ffcf7a') },
      uLocalSea: { value: 0 },
      uCamLocal: { value: new Vector3() },
    });
    this.uniforms = shellU;
    const geo = eggGeometry(a, b);
    this.shellMat = new ShaderMaterial({
      vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, uniforms: shellU,
      transparent: true, depthWrite: true, depthTest: true, depthFunc: AlwaysDepth, side: FrontSide,
      blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
    });
    // the membrane lives in the transparent scene; its matrix follows the group each frame
    this.shell = new Mesh(geo, this.shellMat);
    this.shell.name = 'whale-egg-shell';
    this.shell.matrixAutoUpdate = false;
    this.shell.renderOrder = -90; // right after the sea (-100)
    this.engine.sceneT.add(this.shell);
    // a shadow-only stand-in (the sea and the shards catch the egg's soft shadow)
    this.proxy = new Mesh(geo, this.shellMat);
    this.proxy.name = 'whale-egg-shadow';
    this._shadowEntry = this.engine.shadows?.addCaster?.(this.proxy) || null;
    this.proxy.layers.disable(0);
    this.group.add(this.proxy);

    // the curled calf
    this.embryo = new Embryo(this.length * 0.82, { skin: opts.skin, back: opts.back, fluid: opts.fluid });
    this.embryo.uniforms.uFluid = shellU.uFluid;
    this.embryo.uniforms.uLocalSea = shellU.uLocalSea;
    this.embryo.mesh.rotation.y = 0;
    this.group.add(this.embryo.mesh);

    // shell shards (after the hatch), pooled
    this.shardMat = new ShaderMaterial({
      vertexShader: SHARD_VERT, fragmentShader: SHARD_FRAG, side: DoubleSide,
      uniforms: Object.assign({}, G, {
        uMembrane: shellU.uMembrane, uVein: shellU.uVein, uLeak: shellU.uLeak, uFluid: shellU.uFluid,
        uHot: { value: 0 }, uLocalSea: shellU.uLocalSea,
      }),
    });
    this.shards = new InstancedMesh(shardGeometry(this._seed), this.shardMat, NSHARD);
    this.shards.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shards.count = 0;
    this.shards.frustumCulled = false;
    this.shards.visible = false;
    this.shards.name = 'whale-egg-shards';
    this.engine.scene.add(this.shards);
    this._sh = Array.from({ length: NSHARD }, () => ({
      p: new Vector3(), v: new Vector3(), q: new Quaternion(), w: new Vector3(), s: 1, float: true, age: 0,
    }));

    // scratch (no per-frame allocation)
    this._m = new Matrix4();
    this._sm = new Matrix4();
    this._inv = new Matrix4();
    this._q = new Quaternion();
    this._q2 = new Quaternion();
    this._e = new Euler();
    this._v = new Vector3();
    this._v2 = new Vector3();
    this._one = new Vector3(1, 1, 1);
    this._up = new Vector3(0, 0, 1);
    this._tpos = { x: 0, y: 0, z: 0 };
    this._sea = 0;
    this._settled = false;

    // the camera in egg space, as it renders (the view ray's path through the fluid)
    this._hook = (cam) => {
      this._inv.copy(this.shell.matrix).invert();
      this.uniforms.uCamLocal.value.setFromMatrixPosition(cam.matrixWorld).applyMatrix4(this._inv);
    };
    this.engine.beforeRender.push(this._hook);
    this.update(0);
    this.precompile();
  }

  // ------------------------------------------------------------------ API
  /** Inner light 0..~2 (eased over dur seconds). */
  setGlow(k, dur = 1.2) {
    this._glowTarget = Math.max(0, k);
    this._glowDur = Math.max(0.01, dur);
    return this;
  }

  /** Heartbeat rate (beats per second; ~0.6 resting .. 2.5 racing before the hatch). */
  setPulse(rate) {
    this._rate = Math.max(0, rate);
    return this;
  }

  /** Crack spread 0..1: hand-drawn lines run out from the crown, light leaking through. */
  crack(k) {
    const n = Math.min(1, Math.max(0, k));
    if (n > this._crackTarget + 0.02) {
      this._jolt = Math.min(1, this._jolt + (n - this._crackTarget) * 3 + 0.15);
      this.embryo.kick(0.6 + n);
    }
    this._crackTarget = n;
    return this;
  }

  /** Burst: shards, fluid, bubbles, a soft flash; the calf uncurls and swims out.
   *  Emits 'hatch' now and 'emerged' when the calf is clear (~3.5 s); the promise resolves then. */
  hatch() {
    if (this.hatched) return this._hatchPromise;
    this.hatched = true;
    this._hatchT = 0;
    this._crackTarget = 1;
    this._hatchPromise = new Promise((res) => { this._resolveHatch = res; });
    this._burst();
    this.embryo.curlTarget = 0.18;
    this.embryo.swim = 0.5;
    this.embryo.kick(1.6);
    this._emit('hatch', this);
    return this._hatchPromise;
  }

  on(name, fn) {
    (this._handlers[name] || (this._handlers[name] = [])).push(fn);
    return this;
  }

  _emit(name, arg) {
    const hs = this._handlers[name];
    if (hs) for (const h of hs) { try { h(arg); } catch (e) { console.error(e); } }
  }

  /** World position of the embryo (for handing over to the calf after the hatch). */
  embryoPosition(out = new Vector3()) {
    return this.embryo.mesh.getWorldPosition(out);
  }

  /** Compile every material now (the egg is built behind a cut, not mid-shot). */
  precompile() {
    const r = this.engine.renderer;
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(this.engine.rt);
      this.shards.visible = true;
      r.compile(this.group, this.engine.camera, this.engine.scene);
      r.compile(this.shards, this.engine.camera, this.engine.scene);
      r.compile(this.shell, this.engine.camera, this.engine.sceneT);
      const e = this._shadowEntry;
      if (e && this.engine.shadows?.cam) {
        this.proxy.material = e.depthMat;
        r.compile(this.proxy, this.engine.shadows.cam, this.engine.scene);
        this.proxy.material = this.shellMat;
      }
    } catch (err) {
      console.warn('[egg] precompile', err);
    } finally {
      this.shards.visible = this.hatched;
      r.setRenderTarget(prev);
    }
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    if (this.disposed) return;
    this.time += dt;
    const t = this.time;
    const ocean = this.game.ocean;
    // heartbeat: a lub-dub, then rest
    this._phase = (this._phase + dt * this._rate) % 1;
    const ph = this._phase;
    const beat = Math.exp(-(((ph - 0.08) / 0.05) ** 2)) + 0.6 * Math.exp(-(((ph - 0.26) / 0.055) ** 2));
    const k = Math.min(1, dt / (this._glowDur || 1.2));
    this._glow += (this._glowTarget - this._glow) * k;
    this._crack += (this._crackTarget - this._crack) * Math.min(1, dt * 2.2);
    this._jolt *= Math.exp(-dt * 3);

    // float in the sea (in a maelstrom's eye the funnel sets the level), turning with the eye
    const g = this.group;
    let sea = this._sea;
    if (ocean && ocean.enabled !== false) {
      sea = ocean.heightAt(g.position.x, g.position.z);
      let spin = 0;
      for (const w of ocean.whirls || []) {
        if (w.id === null || w.s <= 0) continue;
        const d = Math.hypot(g.position.x - w.x, g.position.z - w.z);
        if (d < w.radius * 0.2) spin += w.spin * w.s * 0.6 * (1 - d / (w.radius * 0.2));
      }
      this._yaw += spin * dt;
    }
    this._sea = sea;
    if (this.float) {
      const target = sea + this.floatLift + 0.02 * beat;
      if (!this._settled || dt <= 0) { g.position.y = target; this._vy = 0; this._settled = true; }
      // a soft spring: the egg lags the swell a little and bobs
      this._vy += ((target - g.position.y) * 6 - this._vy * 2.6) * dt;
      g.position.y += this._vy * dt;
    }
    const jolt = this._jolt * Math.sin(t * 38) * 0.05;
    this._e.set(Math.sin(t * 0.63) * 0.05 + jolt, this._yaw, Math.sin(t * 0.41 + 1) * 0.04 + jolt * 0.6, 'YXZ');
    g.quaternion.setFromEuler(this._e);
    g.updateMatrixWorld(true);
    // the membrane breathes with the heart
    const sc = 1 + 0.009 * beat * (this.hatched ? 0 : 1);
    this._sm.makeScale(sc, sc, sc);
    this.shell.matrix.multiplyMatrices(g.matrixWorld, this._sm);
    this.shell.matrixWorld.copy(this.shell.matrix);
    this.shell.visible = g.visible && this._fade > 0.001;

    // uniforms
    const u = this.uniforms;
    u.uGlow.value = this._glow;
    u.uBeat.value = Math.min(1, beat);
    u.uCrack.value = this._crack;
    u.uLocalSea.value = sea;
    u.uAlpha.value = this._fade;
    if (!G.uSceneTex.value && this.engine.rt) G.uSceneTex.value = this.engine.rt.texture;
    const eu = this.embryo.uniforms;
    eu.uGlow.value = this._glow;
    eu.uBeat.value = Math.min(1, beat);

    // idle life: a twitch now and then
    if (this._idle && !this.hatched) {
      this._nextKick -= dt;
      if (this._nextKick <= 0) {
        this._nextKick = 5 + this._rand() * 7;
        this.embryo.kick(0.35 + this._rand() * 0.5);
      }
    }
    this.embryo.update(dt);
    if (this.hatched) this._updateHatch(dt);
  }

  _rand() {
    this._seed = (this._seed * 16807) % 2147483647;
    return this._seed / 2147483647;
  }

  // ------------------------------------------------------------------ the hatch
  _tp(x, y, z) {
    const p = this._tpos;
    p.x = x; p.y = y; p.z = z;
    return p;
  }

  _burst() {
    const g = this.group;
    const m = g.matrixWorld;
    const c = g.position;
    const { x: a, y: b } = this.half;
    // shards from all over the shell, thrown out from the crown
    const up = this._v2.copy(this.uniforms.uCrackDir.value).transformDirection(m);
    for (let i = 0; i < NSHARD; i++) {
      const s = this._sh[i];
      // a direction on the egg, biased toward the crack
      let dx = this._rand() * 2 - 1, dy = this._rand() * 2 - 1, dz = this._rand() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      s.p.set(dx * a, dy * b, dz * b).applyMatrix4(m);
      const n = this._v.set(dx / a, dy / b, dz / b).normalize().transformDirection(m);
      const crown = Math.max(0, n.dot(up));
      const sp = 1.2 + crown * 4 + this._rand() * 1.5;
      s.v.copy(n).multiplyScalar(sp);
      s.v.y += 1.5 + crown * 3 + this._rand() * 1.5;
      s.q.setFromUnitVectors(this._up, n);
      s.w.set(this._rand() - 0.5, this._rand() - 0.5, this._rand() - 0.5).multiplyScalar(6);
      s.s = b * (0.42 + this._rand() * 0.38);
      s.float = this._rand() < 0.62;
      s.age = 0;
    }
    this.shards.count = NSHARD;
    this.shards.visible = true;
    this.shardMat.uniforms.uHot.value = 1;

    // fluid, bubbles, spray and a soft flash of the inner light
    const mist = this.game.mist, glow = this.game.glow;
    const v = this._v;
    const sea = this._sea;
    if (mist) {
      // the shell's fluid bursting out: sheets breaking into fine spray, and heavier drops
      for (let i = 0; i < 70; i++) {
        const th = this._rand() * TAU;
        const out = 1 + this._rand() * 3.5;
        v.set(Math.cos(th) * out, 2 + this._rand() * 5, Math.sin(th) * out);
        const drop = i % 3 === 0;
        mist.emit({
          pos: this._tp(c.x + Math.cos(th) * b * 0.8, c.y + b * 0.4, c.z + Math.sin(th) * b * 0.8), vel: v,
          life: 0.8 + this._rand(), size: drop ? 0.006 + this._rand() * 0.012 : 0.1 + this._rand() * 0.12, sizeEnd: drop ? 0.012 : 0.3,
          color: [1, 0.97, 0.92], alpha: drop ? 0.95 : 0.85, drag: drop ? 0.15 : 0.5, gravity: 9.8, kind: drop ? 3 : 9, fadeIn: 0.01,
        });
      }
      // the fluid spilling over the water is foam on the sea (src/fx/Splash.js), not a cloud of puffs
      if (this.game.ocean?.splash) this.game.ocean.splash(this._tp(c.x, sea, c.z), 0.6, b * 2.2);
      // bubbles boiling up around the submerged half
      for (let i = 0; i < 60; i++) {
        const th = this._rand() * TAU, rr = this._rand() * b * 1.4;
        v.set(Math.cos(th) * 0.4, 0.6 + this._rand() * 1.2, Math.sin(th) * 0.4);
        const bs = 0.004 + 0.05 * Math.pow(this._rand(), 3);
        mist.emit({
          pos: this._tp(c.x + Math.cos(th) * rr, sea - 0.3 - this._rand() * b * 1.2, c.z + Math.sin(th) * rr), vel: v,
          life: 8, size: bs, sizeEnd: bs * 1.3,
          color: [1, 1, 1], alpha: 0.85, drag: 1.6, gravity: 0, kind: 4, fadeIn: 0.05,
        });
      }
    }
    if (glow) {
      v.set(0, 0.4, 0);
      glow.emit({
        pos: this._tp(c.x, c.y + b * 0.2, c.z), vel: v, life: 0.9, size: this.length * 1.6, sizeEnd: this.length * 3.2,
        color: [1, 0.82, 0.6], alpha: 0.75, drag: 0, gravity: 0, kind: 1, fadeIn: 0.04,
      });
      for (let i = 0; i < 40; i++) {
        const th = this._rand() * TAU;
        const out = 0.5 + this._rand() * 2;
        v.set(Math.cos(th) * out, 0.5 + this._rand() * 2.5, Math.sin(th) * out);
        glow.emit({
          pos: this._tp(c.x + Math.cos(th) * b * 0.6, c.y, c.z + Math.sin(th) * b * 0.6), vel: v,
          life: 1.5 + this._rand() * 2, size: 0.06 + this._rand() * 0.08, sizeEnd: 0.02,
          color: [1, 0.72, 0.42], alpha: 0.7, drag: 0.8, gravity: 0.3, kind: 1, fadeIn: 0.05,
        });
      }
    }
    this.game.ocean?.splash?.(this._tp(c.x, sea, c.z), 0.9, this.width * 1.1);
  }

  _updateHatch(dt) {
    this._hatchT += dt;
    const ht = this._hatchT;
    // the shell is gone in a blink; the light inside flares and fades
    this._fade = Math.max(0, 1 - ht / 0.12);
    this.embryo.uniforms.uInside.value = 0;
    if (ht < 0.3) this._glowTarget = 2.2;
    else if (ht < 0.4) this._glowTarget = 0.5;
    this.shardMat.uniforms.uHot.value = Math.exp(-ht * 0.9);
    // the calf uncurls and swims up and out
    const e = this.embryo;
    const swim = Math.min(1, Math.max(0, (ht - 0.4) / 3));
    e.mesh.position.set(swim * swim * this.length * 0.9, swim * this.half.y * 0.6, 0);
    e.mesh.rotation.z = swim * 0.25;
    if (ht > 3.4) {
      e.uniforms.uFade.value = Math.max(0, 1 - (ht - 3.4) / 0.6);
      if (!this._emerged) {
        this._emerged = true;
        this._emit('emerged', this);
        this._resolveHatch?.(this);
      }
    }
    // shards: thrown, then floating on the surface or sinking slowly
    const ocean = this.game.ocean;
    const flow = this._v2;
    let alive = 0;
    for (let i = 0; i < NSHARD; i++) {
      const s = this._sh[i];
      s.age += dt;
      const water = this.game.ocean ? (ocean.level ?? 0) + (ocean.whirlHeightAt?.(s.p.x, s.p.z) ?? 0) : 0;
      if (s.p.y > water + 0.02) {
        s.v.y -= 9.8 * dt;
        s.v.multiplyScalar(Math.exp(-dt * 0.4));
      } else if (s.float) {
        // buoyant: settle on the surface, lie flat, ride the swirl
        s.v.y += ((water - s.p.y) * 12 - s.v.y * 4) * dt;
        s.v.x *= Math.exp(-dt * 2);
        s.v.z *= Math.exp(-dt * 2);
        if (ocean?.whirlFlowAt) {
          ocean.whirlFlowAt(s.p.x, s.p.z, flow);
          s.v.x += flow.x * dt * 2;
          s.v.z += flow.z * dt * 2;
        }
        s.w.multiplyScalar(Math.exp(-dt * 3));
        this._q2.setFromUnitVectors(this._up, this._v.set(0, 1, 0));
        s.q.slerp(this._q2, Math.min(1, dt * 1.5));
      } else {
        // sinking: drifting down, rocking like a leaf
        s.v.multiplyScalar(Math.exp(-dt * 3));
        s.v.y = Math.max(s.v.y - dt * 2, -0.35);
        s.v.x += Math.sin(s.age * 2.1 + i) * dt * 0.6;
      }
      s.p.addScaledVector(s.v, dt);
      const wl = s.w.length();
      if (wl > 1e-4) {
        this._q.setFromAxisAngle(this._v.copy(s.w).divideScalar(wl), wl * dt);
        s.q.premultiply(this._q);
      }
      // the fragments fade away over half a minute (the sinkers sooner)
      const life = s.float ? 30 : 14;
      const k = Math.max(0, 1 - Math.max(0, s.age - life * 0.7) / (life * 0.3));
      if (k > 0) alive++;
      this._v.setScalar(s.s * k + 1e-4);
      this._m.compose(s.p, s.q, this._v);
      this.shards.setMatrixAt(i, this._m);
    }
    this.shards.instanceMatrix.needsUpdate = true;
    if (!alive) this.shards.visible = false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const hi = this.engine.beforeRender.indexOf(this._hook);
    if (hi >= 0) this.engine.beforeRender.splice(hi, 1);
    this.engine.scene.remove(this.group);
    this.engine.scene.remove(this.shards);
    this.engine.sceneT.remove(this.shell);
    this.engine.shadows?.removeCaster?.(this.proxy);
    this.shell.geometry.dispose();
    this.shellMat.dispose();
    this.shards.geometry.dispose();
    this.shardMat.dispose();
    this.shards.dispose?.();
    this.embryo.dispose();
    this._handlers = {};
  }
}

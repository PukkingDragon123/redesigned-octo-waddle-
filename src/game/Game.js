// Top-level orchestration: owns the engine and the shared world systems, runs the loop,
// and hands control to either the story (menu -> journey) or a dev test scene.
import { Vector2, Vector3 } from 'three';
import { Engine } from '../render/Engine.js';
import { Input } from '../core/Input.js';
import { Sky } from '../world/Sky.js';
import { Atmosphere } from '../world/Atmosphere.js';
import { G } from '../render/Globals.js';
import { CameraRig } from './CameraRig.js';
import { Ocean } from '../world/Ocean.js';
import { Clouds } from '../world/Clouds.js';
import { Wind } from '../world/Wind.js';
import { Particles } from '../render/Particles.js';
import { Whale } from '../creatures/Whale.js';
import { flushWhaleBakes } from '../creatures/WhaleModel.js';

// Dev scenes are only bundled in development builds.
const DEV_TESTS = import.meta.env.DEV ? import.meta.glob('../dev/*.js') : {};

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.veil = opts.veil;
    this.params = new URLSearchParams(location.search);
    this.debug = this.params.has('debug');
    this.settings = loadSettings();
    // automatic quality starts every session from the default; step-downs only last for the session
    if (this.settings.autoQuality) this.settings.quality = detectStartQuality();
    const quality = this.params.get('quality') || this.settings.quality;
    this.engine = new Engine(canvas, quality, { preserve: this.debug });
    this.input = new Input(canvas);
    this.input.settings.invertY = this.settings.invertY;
    this.input.settings.sensitivity = this.settings.sensitivity;
    this.sky = new Sky();
    this.engine.scene.add(this.sky.mesh);
    this.atmosphere = new Atmosphere(this.engine, this.sky);
    this.atmosphere.set(this.params.get('time') || 'menu');
    this.wind = new Wind();
    // the living sea of Vur Sok, built before the story (the world registers calm lagoons with it).
    // Dev scenes get it only when they ask (&ocean), since it is the costliest thing to render.
    const devScene = this.params.get('test');
    this.ocean = !devScene || this.params.has('ocean') ? new Ocean(this) : null;
    // the old cloud sea is gone; its few remaining call sites (dev scenes) find a harmless stand-in
    this.cloudSea = {
      enabled: false,
      setQuality() {},
      uniforms: { uTrailOn: { value: 0 }, uStormDark: { value: 0 }, uSeaOffset: { value: new Vector2() }, uSteps: { value: 0 } },
    };
    this.clouds = new Clouds(this);
    this.mist = new Particles(this, { max: 2500, additive: false, name: 'mist', order: 20 });
    this.glow = new Particles(this, { max: 3000, additive: true, name: 'glow', order: 30 });
    this.cameraRig = new CameraRig(this);
    // whale skins are painted between frames, before any render pass
    this.engine.beforeRender.unshift(() => flushWhaleBakes(this.engine.renderer));
    this.applyQuality();

    this.systems = [];
    this.time = 0;
    this.frame = 0;
    this.timeScale = 1;
    this.focus = new Vector3(0, 150, 0); // shadow/cloud interaction focus (the calf)
    this.trail = { t: 0, i: 0 };
    this._last = performance.now();
    this.fixedDt = this.params.has('dt') ? +this.params.get('dt') : 0;
    this.ready = false;
    this.devUpdate = null;
    this.fadeRate = 0;
    // automatic quality: measured once the world is built, until the player picks a quality
    this.perf = { sum: 0, cpu: 0, n: 0, cooldown: 3, calm: 0, slow: 0, ready: false };
    this._cpuMs = 0;
    // frame pacing: on a high-refresh monitor render every k-th refresh (~60 fps, perfectly even)
    this._hz = 60;
    this._frameEvery = 1;
    this._tick = 0;
    this._ticks = [];
    if (this.debug) {
      this.engine.post.grade.uFade.value = 0;
      this.veil?.remove();
      if (this.params.has('nobloom')) this.engine.post.bloomEnabled = false;
      if (this.params.has('norays')) this.engine.post.raysEnabled = false;
      if (this.params.has('noshadow')) this.engine.shadows.enabled = false;
      if (this.params.has('nosea') && this.ocean) this.ocean.enabled = false;
    }
  }

  applyQuality() {
    const q = this.engine.quality;
    this.ocean?.setQuality(q.cloudSteps);
    this.clouds.budget = Math.round(7000 * q.clouds);
    this.furQuality = q.fur;
    this.story?.applyFurQuality?.();
    const k = { high: 1, medium: 0.6, low: 0.25 }[this.engine.qualityName] ?? 1;
    this.story?.world?.setQuality?.(k);
    this.story?.world?.flora?.setQuality?.(Math.max(0.4, k));
    this.story?.eco?.reef?.setDetail?.({ high: 1, medium: 0.6, low: 0.35 }[this.engine.qualityName] ?? 1);
  }

  /**
   * Keeps the frame rate smooth without spoiling the picture. Resolution only drops (to 80% at
   * most) when the GPU is the bottleneck; a slow CPU would gain nothing from a blurrier frame, so
   * then a quality tier steps down instead. A tier only drops after two slow seconds in a row, so a
   * single hitch never costs detail. Never in debug, never after a manual choice.
   */
  governQuality(dtReal) {
    const p = this.perf;
    if (this.debug || !p.ready || !this.settings.autoQuality || document.hidden) return;
    if ((p.cooldown -= dtReal) > 0) return;
    p.sum += dtReal;
    p.cpu += this._cpuMs / 1000;
    p.n++;
    if (p.sum < 1.0) return;
    const avg = p.sum / p.n;
    const cpu = p.cpu / p.n;
    p.sum = 0;
    p.cpu = 0;
    p.n = 0;
    const e = this.engine;
    const target = this._frameEvery / this._hz; // the paced frame interval (about 1/60 s)
    const order = ['high', 'medium', 'low'];
    const i = order.indexOf(e.qualityName);
    if (avg > target * 1.2) {
      p.calm = 0;
      const gpuBound = avg > cpu * 1.4 + 0.002;
      if (gpuBound && e.resScale > 0.8) {
        e.setResScale(e.resScale - 0.1);
        p.cooldown = 1;
      } else if (++p.slow >= 2 && i >= 0 && i < order.length - 1) {
        p.slow = 0;
        this.settings.quality = order[i + 1];
        e.setQuality(this.settings.quality);
        this.applyQuality();
        this.saveSettings();
        p.cooldown = 3;
      }
    } else {
      p.slow = 0;
      if (avg < target * 1.05 && ++p.calm >= 6 && e.resScale < 1) {
        p.calm = 0;
        e.setResScale(e.resScale + 0.1);
        p.cooldown = 4;
      }
    }
  }

  addSystem(s) {
    this.systems.push(s);
    return s;
  }

  /** Record the calf's path so clouds and the cloud sea can part around it. */
  pushTrail(pos) {
    const tp = G.uTrail.value[this.trail.i++ % G.uTrail.value.length];
    tp.set(pos.x, pos.y, pos.z, this.time);
  }

  async init() {
    const test = this.params.get('test');
    if (test) {
      const key = `../dev/${test}.js`;
      if (DEV_TESTS[key]) {
        const mod = await DEV_TESTS[key]();
        await mod.default(this);
        this.ready = true;
        return;
      }
      console.warn('[skysong] unknown dev test', test);
    }
    const { Story } = await import('./Story.js');
    this.story = new Story(this);
    await this.story.init();
    this.ready = true;
  }

  start() {
    const maxFrames = this.debug && this.params.has('frames') ? +this.params.get('frames') : Infinity;
    const uncapped = this.params.has('uncapped') || this.settings.fpsCap === false;
    let prevTick = 0;
    const loop = (now) => {
      if (this.frame >= maxFrames) { this.halted = true; return; }
      requestAnimationFrame(loop);
      // measure the display's refresh rate from the first ticks, then pace to about 60 fps
      if (prevTick && this._ticks.length < 90) {
        this._ticks.push(now - prevTick);
        if (this._ticks.length === 90) {
          const t = this._ticks.slice().sort((x, y) => x - y)[45];
          this._hz = Math.round(1000 / t);
          this._frameEvery = uncapped || this._hz < 75 ? 1 : Math.max(1, Math.round(this._hz / 60));
        }
      }
      prevTick = now;
      if (++this._tick % this._frameEvery) return;
      const dt = Math.min(0.05, Math.max(0.0001, (now - this._last) / 1000));
      this._last = now;
      if (!this.ready) return;
      try {
        const c0 = performance.now();
        this.update(dt);
        this._cpuMs = performance.now() - c0;
      } catch (e) {
        // keep flying: report the first failure, then carry on with the next frame
        if (!this._frameError) console.error(e);
        this._frameError = true;
        window.__skysongError = String(e && e.stack || e);
        this.input.endFrame();
      }
    };
    this.init().then(() => {
      this.input.endFrame();
      if (this.params.has('warp')) this.warp(+this.params.get('warp'));
      this._last = performance.now();
      requestAnimationFrame(loop);
    }).catch((e) => {
      console.error(e);
      window.__skysongError = String(e && e.stack || e);
      this.opts.onError?.(e);
    });
  }

  /** Debug: advance the simulation without rendering. */
  warp(seconds) {
    const dt = this.fixedDt || 1 / 30;
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      this.simulate(dt);
      // particles age during a warp too, so a warped frame does not show everything emitted on the way
      this.mist.update(dt);
      this.glow.update(dt);
    }
  }

  simulate(dt) {
    this.time += dt;
    G.uTime.value = this.time;
    this.atmosphere.update(dt);
    this.wind.update(dt);
    for (const s of this.systems) s.update(dt);
    if (this.devUpdate) this.devUpdate(dt);
    if (this.story) this.story.update(dt);
    this.trail.t += dt;
    if (this.trail.t > 0.25) {
      this.trail.t = 0;
      this.pushTrail(this.focus);
    }
    this.cameraRig.update(dt);
  }

  update(dtReal) {
    this.governQuality(dtReal);
    this.dtReal = this.fixedDt || dtReal;
    let dt = this.fixedDt || dtReal;
    dt *= this.timeScale;
    this.frame++;
    this.input.update();
    this.simulate(dt);
    const cam = this.engine.camera;
    cam.updateMatrixWorld();
    Whale.pxPerRad = this.engine.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    this.engine.shadowFocus.copy(this.focus);
    this.clouds.uniforms.uDrift.value.copy(this.wind.drift);
    this.clouds.update(dt, cam, this.focus);
    G.uInCloud.value = Math.max(G.uInCloud.value * Math.exp(-dt * 3), this.clouds.inCloud);
    this.mist.update(dt);
    this.glow.update(dt);
    this.sky.update(cam);
    const post = this.engine.post.grade;
    // fades run on real time, so pausing mid-fade never leaves the screen dark
    if (!this.debug && this.fadeRate) post.uFade.value = Math.max(0, Math.min(1, post.uFade.value + this.fadeRate * this.dtReal));
    this.engine.render();
    if (this.frame === 2 && this.veil) this.veil.classList.add('gone');
    this.input.endFrame();
  }

  debugInfo() {
    const r = this.engine.renderer.info;
    return { puffs: this.clouds.visible, calls: r.render.calls, tris: r.render.triangles };
  }

  saveSettings() {
    try { localStorage.setItem('skysong.settings', JSON.stringify(this.settings)); } catch (e) { /* storage unavailable */ }
  }
}

function loadSettings() {
  const def = { quality: 'high', autoQuality: true, fpsCap: true, music: 0.8, sound: 1.0, invertY: false, sensitivity: 1.0 };
  try {
    const s = JSON.parse(localStorage.getItem('skysong.settings') || 'null');
    return Object.assign(def, s || {});
  } catch (e) {
    return def;
  }
}

/** Start on High everywhere; only a software renderer (no GPU acceleration) starts on Low. */
function detectStartQuality() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) {
      window.__skysongSoftwareGL = name;
      return 'low';
    }
  } catch (e) { /* fall through */ }
  return 'high';
}

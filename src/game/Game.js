// Top-level orchestration: owns the engine and the shared world systems, runs the loop,
// and hands control to either the story (menu -> journey) or a dev test scene.
import { Vector3 } from 'three';
import { Engine } from '../render/Engine.js';
import { Input } from '../core/Input.js';
import { Sky } from '../world/Sky.js';
import { Atmosphere } from '../world/Atmosphere.js';
import { G } from '../render/Globals.js';
import { CameraRig } from './CameraRig.js';
import { CloudSea } from '../world/CloudSea.js';
import { Clouds } from '../world/Clouds.js';
import { Wind } from '../world/Wind.js';
import { Particles } from '../render/Particles.js';
import { Whale } from '../creatures/Whale.js';

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
    if (this.settings.autoQuality) this.settings.quality = 'high';
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
    this.cloudSea = new CloudSea(this.engine);
    this.clouds = new Clouds(this);
    this.mist = new Particles(this, { max: 2500, additive: false, name: 'mist', order: 20 });
    this.glow = new Particles(this, { max: 3000, additive: true, name: 'glow', order: 30 });
    this.cameraRig = new CameraRig(this);
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
    this.perf = { sum: 0, n: 0, cooldown: 3, calm: 0, ready: false };
    if (this.debug) {
      this.engine.post.grade.uFade.value = 0;
      this.veil?.remove();
      if (this.params.has('nobloom')) this.engine.post.bloomEnabled = false;
      if (this.params.has('norays')) this.engine.post.raysEnabled = false;
      if (this.params.has('noshadow')) this.engine.shadows.enabled = false;
      if (this.params.has('nosea')) this.cloudSea.enabled = false;
      if (this.params.has('seasteps')) this.cloudSea.uniforms.uSteps.value = +this.params.get('seasteps');
    }
  }

  applyQuality() {
    const q = this.engine.quality;
    this.cloudSea.setQuality(q.cloudSteps);
    this.clouds.budget = Math.round(7000 * q.clouds);
    this.furQuality = q.fur;
    this.story?.applyFurQuality?.();
  }

  /** Steps quality down while frames are slow (never in debug, never after a manual choice). */
  governQuality(dtReal) {
    const p = this.perf;
    if (this.debug || !p.ready || !this.settings.autoQuality || document.hidden) return;
    if ((p.cooldown -= dtReal) > 0) return;
    p.sum += dtReal;
    p.n++;
    if (p.sum < 2.5) return;
    const avg = p.sum / p.n;
    p.sum = 0;
    p.n = 0;
    const order = ['high', 'medium', 'low'];
    const i = order.indexOf(this.engine.qualityName);
    if (avg > 1 / 40 && i >= 0 && i < order.length - 1) {
      this.settings.quality = order[i + 1];
      this.engine.setQuality(this.settings.quality);
      this.applyQuality();
      this.saveSettings();
      p.cooldown = 3;
      p.calm = 0;
    } else if (avg < 1 / 50 && ++p.calm >= 4) {
      // smooth for a while: check less often, but keep watching for heavier chapters
      p.calm = 0;
      p.cooldown = 20;
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
    const loop = (now) => {
      if (this.frame >= maxFrames) { this.halted = true; return; }
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0.0001, (now - this._last) / 1000));
      this._last = now;
      if (!this.ready) return;
      try {
        this.update(dt);
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
    for (let i = 0; i < n; i++) this.simulate(dt);
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
    this.cloudSea.uniforms.uSeaOffset.value.set(this.wind.drift.x, this.wind.drift.z);
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
  const def = { quality: 'high', autoQuality: true, music: 0.8, sound: 1.0, invertY: false, sensitivity: 1.0 };
  try {
    const s = JSON.parse(localStorage.getItem('skysong.settings') || 'null');
    return Object.assign(def, s || {});
  } catch (e) {
    return def;
  }
}

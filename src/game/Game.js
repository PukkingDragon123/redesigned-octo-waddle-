// Top-level orchestration (grows as systems are added).
import { Mesh, SphereGeometry, Vector3, BoxGeometry, MeshBasicMaterial } from 'three';
import { Engine } from '../render/Engine.js';
import { Input } from '../core/Input.js';
import { Sky } from '../world/Sky.js';
import { Atmosphere } from '../world/Atmosphere.js';
import { G } from '../render/Globals.js';
import { toonMaterial } from '../render/materials.js';
import { WhaleModel } from '../creatures/WhaleModel.js';
import { CALF, MOTHER, ADULTS } from '../creatures/WhaleTypes.js';
import { Whale } from '../creatures/Whale.js';
import { CameraRig } from './CameraRig.js';
import { PlayerController } from './PlayerController.js';
import { CloudSea } from '../world/CloudSea.js';
import { Clouds } from '../world/Clouds.js';
import { Wind } from '../world/Wind.js';
import { rng } from '../core/math.js';

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.veil = opts.veil;
    this.params = new URLSearchParams(location.search);
    this.debug = this.params.has('debug');
    this.engine = new Engine(canvas, this.params.get('quality') || 'high', { preserve: this.debug });
    this.input = new Input(canvas);
    this.sky = new Sky();
    this.engine.scene.add(this.sky.mesh);
    this.atmosphere = new Atmosphere(this.engine, this.sky);
    this.atmosphere.set(this.params.get('time') || 'menu');
    this.time = 0;
    this.frame = 0;
    this._last = performance.now();
    this.fixedDt = this.params.has('dt') ? +this.params.get('dt') : 0;
    this.buildTest();
    if (this.params.has('warp') && this.flyTest) {
      const n = Math.round(+this.params.get('warp') / (this.fixedDt || 1 / 30));
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        this.time += this.fixedDt || 1 / 30;
        G.uTime.value = this.time;
        this.updateFlyTest(this.fixedDt || 1 / 30);
        if (i % 30 === 0) console.log('[skysong] warp', i, (performance.now() - t0).toFixed(0), 'ms', this.whales[0].pos.toArray().map((v) => v.toFixed(1)).join(','));
      }
    }
    if (this.debug) {
      this.engine.post.grade.uFade.value = 0;
      this.veil?.remove();
      if (this.params.has('nobloom')) this.engine.post.bloomEnabled = false;
      if (this.params.has('norays')) this.engine.post.raysEnabled = false;
      if (this.params.has('noshadow')) this.engine.shadows.enabled = false;
    }
  }

  buildTest() {
    const s = this.engine.scene;
    if (this.params.get('test') === 'whale') return this.buildWhaleTest();
    if (this.params.get('test') === 'fly') return this.buildFlyTest();
    const colors = [0xf2e6d8, 0x9fb6d8, 0xe8b8a0, 0x7f9a6a];
    for (let i = 0; i < 4; i++) {
      const mat = this.params.has('basic') ? new MeshBasicMaterial({ color: colors[i] }) : toonMaterial({ color: colors[i], rim: 0.5, spec: 0.3 });
      const m = new Mesh(new SphereGeometry(6, 64, 32), mat);
      m.position.set((i - 1.5) * 16, 100, -40);
      s.add(m);
      this.engine.shadows.addCaster(m);
    }
    const ground = new Mesh(new BoxGeometry(200, 4, 120), toonMaterial({ color: 0x9a8f86, moss: 1 }));
    ground.position.set(0, 88, -40);
    s.add(ground);
    this.engine.shadows.addCaster(ground);
    const cam = this.engine.camera;
    cam.position.set(0, 112, 10);
    cam.lookAt(0, 100, -40);
    this.engine.shadowFocus.set(0, 100, -40);
  }

  buildWhaleTest() {
    const s = this.engine.scene;
    const t0 = performance.now();
    const calf = new WhaleModel(CALF);
    const mom = new WhaleModel(MOTHER);
    console.log('[skysong] whale build ms', (performance.now() - t0).toFixed(1));
    calf.group.position.set(0, 100, 0);
    mom.group.position.set(-16, 98, -22);
    s.add(calf.group, mom.group);
    calf.castShadows(this.engine.shadows);
    mom.castShadows(this.engine.shadows);
    this.testWhales = [calf, mom];
    if (this.params.has('shells')) for (const w of this.testWhales) w.setFurShells(+this.params.get('shells'));
    if (this.params.has('furscale')) for (const w of this.testWhales) w.u.uFurLen.value *= +this.params.get('furscale');
    window.__whales = this.testWhales;
    if (this.params.get('a2c') === '0') for (const w of this.testWhales) { w.fur.material.alphaToCoverage = false; w.fur.material.needsUpdate = true; }
    if (this.params.has('furdebug')) for (const w of this.testWhales) { w.fur.material.defines.FUR_DEBUG = ''; w.fur.material.needsUpdate = true; }
    const cam = this.engine.camera;
    const v = (this.params.get('view') || 'side');
    if (v === 'side') { cam.position.set(7.5, 101.5, 3.5); cam.lookAt(0, 100, 0.2); }
    else if (v === 'front') { cam.position.set(2.5, 100.8, 6.5); cam.lookAt(0, 100.2, 1); }
    else if (v === 'top') { cam.position.set(3, 106, -1); cam.lookAt(0, 100, 0); }
    else if (v === 'mom') { cam.position.set(14, 108, 10); cam.lookAt(-14, 98, -20); }
    else if (v === 'back') { cam.position.set(-3, 102.5, -8); cam.lookAt(0, 100, 0); }
    else if (v === 'close') { cam.position.set(3.2, 101.2, 3.4); cam.lookAt(0, 100.2, 0.3); }
    else if (v === 'q') { cam.position.set(6, 103.5, 7); cam.lookAt(0, 100, 0); }
    else if (v === 'under') { cam.position.set(4, 96, 5); cam.lookAt(0, 100, 0); }
    else if (v === 'momtop') { cam.position.set(-16, 140, -22.01); cam.lookAt(-16, 98, -22); }
    else if (v === 'calftop') { cam.position.set(0, 109, 0.01); cam.lookAt(0, 100, 0); }
    else if (v === 'momq') { cam.position.set(10, 112, 12); cam.lookAt(-16, 98, -22); }
    this.engine.shadowFocus.set(-6, 100, -10);
  }

  buildFlyTest() {
    const s = this.engine.scene;
    this.cameraRig = new CameraRig(this);
    const calf = new Whale(CALF);
    const mom = new Whale(MOTHER);
    const a1 = new Whale(ADULTS[0]);
    const a2 = new Whale(ADULTS[1]);
    calf.place(new Vector3(0, 150, 0), Math.PI);
    mom.place(new Vector3(-14, 152, -10), Math.PI);
    a1.place(new Vector3(30, 160, -40), Math.PI);
    a2.place(new Vector3(-45, 145, -70), Math.PI);
    this.whales = this.params.has('solo') ? [calf] : [calf, mom, a1, a2];
    if (this.params.has('solo')) { mom.group.visible = false; a1.group.visible = false; a2.group.visible = false; }
    for (const w of this.whales) {
      s.add(w.group);
      w.model.castShadows(this.engine.shadows);
      w.vel.set(0, 0, -9);
    }
    this.player = new PlayerController(this, calf);
    this.player.syncAim();
    const mode = this.params.get('auto') || 'cruise';
    this.player.autopilot = (dt, pc) => {
      const t = this.time;
      if (mode === 'cruise') return { swim: 0.8, yaw: Math.PI + Math.sin(t * 0.25) * 0.5, pitch: Math.sin(t * 0.3) * 0.15 };
      if (mode === 'turn') return { swim: 1, yaw: Math.PI + t * 0.6, pitch: 0.1 };
      if (mode === 'glide') return { swim: t < 2 ? 1 : 0, yaw: Math.PI, pitch: -0.05 };
      if (mode === 'dive') return { swim: 1, yaw: Math.PI, pitch: t > 2 ? -0.9 : 0 };
      if (mode === 'look') return { swim: 0.6, yaw: Math.PI + 0.3, pitch: -0.45 };
      if (mode === 'sun') {
        const sd = G.uSunDir.value;
        return { swim: 0.6, yaw: Math.atan2(sd.x, sd.z) + (+this.params.get('yawoff') || 0), pitch: -0.12 };
      }
      if (mode === 'idle') return { swim: 0, yaw: Math.PI + t * 0.3, pitch: 0.1 };
      return { swim: 0.8 };
    };
    if (this.params.get('hum')) calf.drive.hum = 1;
    this.flyTest = true;
    // clouds
    this.wind = new Wind();
    this.cloudSea = new CloudSea(this.engine);
    this.engine.midPasses.push(this.cloudSea);
    if (this.params.has('seasteps')) this.cloudSea.uniforms.uSteps.value = +this.params.get('seasteps');
    if (this.params.has('nosea')) this.cloudSea.enabled = false;
    this.clouds = new Clouds(this);
    const r = rng(42);
    for (let i = 0; i < 60; i++) {
      const c = new Vector3((r() - 0.5) * 2400, 40 + r() * 140, -r() * 3000 + 400);
      if (Math.abs(c.x) < 90 && c.z < 100 && c.z > -900) c.x += 220 * Math.sign(c.x || 1);
      this.clouds.cumulus(c, 120 + r() * 260, 70 + r() * 160, { seed: i + 1 });
    }
    this.clouds.cumulus(new Vector3(60, 120, -260), 160, 110, { seed: 900 });
    this.clouds.wisps(new Vector3(-30, 150, -420), 120, 30, { seed: 77 });
    this.trail = { t: 0, i: 0 };
  }

  updateFlyTest(dt) {
    const camPos = this.engine.camera.position;
    const [calf, ...adults] = this.whales;
    this.player.update(dt);
    if (this.params.has('humdrive')) calf.drive.hum = 1;
    if (this.params.has('charge')) calf.drive.charge = 1;
    if (this.params.has('happy')) calf.drive.happy = 1;
    if (this.params.has('feed')) calf.drive.feed = 1;
    calf.drive.lookAt = adults[0] ? adults[0].pos : null;
    calf.step(dt);
    calf.animate(dt, camPos);
    for (const a of adults) {
      // simple formation: keep pace beside the calf
      const target = calf.pos.clone().add(a === adults[0] ? new Vector3(-22, -6, -18) : a === adults[1] ? new Vector3(40, 14, -70) : new Vector3(-60, -2, -110));
      const to = target.sub(a.pos);
      a.ctl.targetYaw = Math.atan2(to.x, to.z);
      a.ctl.targetPitch = Math.atan2(to.y, Math.hypot(to.x, to.z)) * 0.5;
      const want = 9 + to.length() * 0.2;
      a.ctl.thrust = Math.max(0, Math.min(1, (want - a.vel.length()) * 0.4 + 0.4));
      a.drive.effort = a.ctl.thrust;
      a.drive.glide = 0.4;
      a.drive.lookAt = calf.pos;
      a.step(dt);
      a.animate(dt, camPos);
    }
    this.cameraRig.follow(dt, calf, this.player.aimYaw, this.player.aimPitch);
    this.cameraRig.update(dt);
    this.engine.shadowFocus.copy(calf.pos);
    this.wind.update(dt);
    // player wake through clouds
    this.trail.t += dt;
    if (this.trail.t > 0.25) {
      this.trail.t = 0;
      const tp = G.uTrail.value[this.trail.i++ % 24];
      tp.set(calf.pos.x, calf.pos.y, calf.pos.z, this.time);
    }
    this.cloudSea.uniforms.uTrailOn.value = calf.pos.y < 120 ? 1 : 0;
    this.engine.camera.updateMatrixWorld();
    this.clouds.update(dt, this.engine.camera, calf.pos);
    G.uInCloud.value = this.clouds.inCloud;
    if (this.params.has('nopuffs')) this.clouds.mesh.visible = false;
  }

  start() {
    const maxFrames = this.debug && this.params.has('frames') ? +this.params.get('frames') : Infinity;
    const loop = (now) => {
      if (this.frame >= maxFrames) { this.halted = true; return; }
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0.0001, (now - this._last) / 1000));
      this._last = now;
      this.update(dt);
    };
    requestAnimationFrame(loop);
  }

  update(dt) {
    if (this.fixedDt) dt = this.fixedDt;
    this.time += dt;
    this.frame++;
    G.uTime.value = this.time;
    this.input.update();
    this.atmosphere.update(dt);
    if (this.flyTest) this.updateFlyTest(dt);
    this.sky.update(this.engine.camera);
    const post = this.engine.post.grade;
    post.uFade.value = Math.max(0, post.uFade.value - dt * 0.6);
    this.engine.render();
    if (this.frame === 2 && this.veil) this.veil.classList.add('gone');
    this.input.endFrame();
  }
}

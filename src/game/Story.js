// The story director: menu -> opening cinematic -> ten chapters of one seamless migration ->
// the Oasis -> the ending song -> back to the title. Owns the calf's moment-to-moment play
// (flight, collisions, eating, humming, sonic booms), weather, the falcon encounter, saving,
// and the hand-off between gameplay and cinematic cameras. Communicates only through the
// world: no HUD, no prompts.
import { Vector3, Quaternion, Color } from 'three';
import { MigrationPath } from '../world/MigrationPath.js';
import { WorldBuilder } from '../world/WorldBuilder.js';
import { Herd } from './Herd.js';
import { PlayerController } from './PlayerController.js';
import { Weather } from './Weather.js';
import { SonicBooms } from './SonicBoom.js';
import { Menu } from './Menu.js';
import { Script, until } from './Script.js';
import { SongGame } from './SongGame.js';
import { Cinematics } from './Cinematics.js';
import { LifeCycle } from './life/LifeCycle.js';
import { hatching, restoreHatching } from './life/Hatching.js';
import { waterStep, seaHeight } from './Swim.js';
import { Whale } from '../creatures/Whale.js';
import { ADULTS, CALVES } from '../creatures/WhaleTypes.js';
import { G } from '../render/Globals.js';
import { clamp, damp, lerp, smoothstep, rng, TAU, dirFromYawPitch, easeInOut } from '../core/math.js';

const _mOff = new Vector3();
// one reused particle record for the story's ambient effects (Particles.emit copies it)
const _pfx = { pos: new Vector3(), vel: new Vector3(), life: 1, size: 1, sizeEnd: 1, alpha: 1, drag: 1, gravity: 0, kind: 0, color: [1, 1, 1], fadeIn: 0.1 };
const _avA = new Vector3();
const _avB = new Vector3();
const _avD = new Vector3();
// the colour a travel dissolve passes through: sea haze by day, deep blue at night, grey in the storm
const HAZE = { night: [0.06, 0.08, 0.14], storm: [0.42, 0.45, 0.5], stormDawn: [0.62, 0.64, 0.68] };
const HAZE_DAY = [0.86, 0.88, 0.9];
const OPTIONAL = import.meta.glob(['../audio/AudioSystem.js', '../creatures/Ecosystem.js', '../creatures/Falcon.js', './Activities.js']);
const SAVE_KEY = 'skysong.save';

class VoiceStub {
  setPosition() {}
  hum() {}
  release() {}
  call() {}
  setChargeLevel() {}
}
class AudioStub {
  constructor() { this.ready = false; }
  async start() {}
  update() {}
  setVolumes() {}
  setMood() {}
  setIntensity() {}
  stinger() {}
  getKey() { return { rootMidi: 62, scale: [0, 2, 4, 5, 7, 9, 11], chord: [62, 66, 69], beat: 60 / 66 }; }
  createVoice() { return new VoiceStub(); }
  sfx() {}
  setAmbience() {}
  duck() {}
}

export class Story {
  constructor(game) {
    this.game = game;
    this.state = 'boot';
    this.script = new Script();
    this.audio = new AudioStub();
    this.eco = null;
    // splashes and spouts from whales meeting the sea (Swim.js)
    this._onSplash = (kind, pos, k) => {
      if (kind === 'spout') this.audio.sfx?.('whoosh', { position: pos, gain: 0.25 });
      else this.audio.sfx?.('splash', { position: pos, gain: clamp(0.35 + k * 0.4, 0, 1.2) });
    };
    this.falcon = null;
    this.chapterIndex = -1;
    this.voices = new Map();
    this.humTimers = new Map();
    this.shot = { pos: new Vector3(), look: new Vector3(), fov: 50, roll: 0 };
    this.eaten = 0;
    this.calfHums = 0;
    this.lastBonk = 0;
    this.spawned = new Set();
    this.completed = false;
    this.act = 1; // the life cycle: 1 the calf (the ten chapters), 2 the song of two, 3 new life, 4 the elder
    this._v = new Vector3();
    this._v2 = new Vector3();
  }

  // ---- setup ----------------------------------------------------------------------------
  async init() {
    const g = this.game;
    try {
      await Promise.race([
        Promise.all([
          ...['300 96px', '400 96px', 'italic 400 96px'].map((f) => document.fonts?.load(`${f} "Cormorant Garamond"`)),
          document.fonts?.load('400 96px "Almendra SC"'),
          document.fonts?.load('400 96px "Almendra"'),
        ]),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    } catch (e) { /* fonts unavailable: fall back to Georgia */ }
    this.path = new MigrationPath();
    this.world = new WorldBuilder(g, this.path);
    this.world.setQuality?.({ high: 1, medium: 0.6, low: 0.25 }[g.engine.qualityName] ?? 1);
    // the cradle first, so the menu has a world to look at; the rest grows behind it
    await this.world.buildChapter('cradle');
    this.herd = new Herd(g, this.path, this.world);
    this.herd.voiceHooks = (w, kind) => this.voiceCall(w, kind);
    this.herd.onSplash = this._onSplash; // tail and fin slaps hitting the water
    this.herd.physics.onContact = (a, b, point, k) => this.onWhaleContact(a, b, point, k);
    this.player = new PlayerController(g, this.herd.calf);
    this.weather = new Weather(g);
    this.weather.onStrike = (pos, dist) => {
      this.audio.sfx?.('thunder', { position: pos, gain: 1 });
      if (dist < 500) this.audio.sfx?.('lightningCrack', { position: pos, gain: 1 });
    };
    this.booms = new SonicBooms(g);
    this.song = new SongGame(this);
    this.cine = new Cinematics(this);
    this.life = new LifeCycle(this);
    g.cameraRig.collide = (from, to) => this.cameraHit(from, to);
    g.cameraRig.avoid = (pos, out) => this.cameraAvoid(pos, out);
    await this.loadOptional();
    this.player.on('hum', () => this.onCalfHum());
    this.player.on('humEnd', () => this.onCalfHumEnd());
    this.player.on('boom', (e) => this.onCalfBoom(e));
    this.player.on('roll', () => { this.voiceCall(this.herd.calf, 'play'); this.life?.onRoll(); });
    this.herd.onCaught = (c) => { this.herd.calf.drive.happy = 1; this.audio.sfx?.('chime', { position: c.pos, gain: 0.5 }); };
    this.menu = new Menu(g, {
      onAction: (a) => this.onMenu(a),
      hasSave: () => !!this.loadSave(),
    });
    this.world.build((p) => { this.buildProgress = p; }).then(() => {
      this.worldReady = true;
      this.prepareGathering();
      this.life.prepare();
      // chapters built after the title appeared get their creatures now
      this.populateEcosystem(Math.max(0, this.chapterIndex));
      // compile every remaining shader (falcon, creatures, shadow variants) while the title is up,
      // so nothing stalls the first time it appears in the journey
      setTimeout(() => g.engine.precompile([g.engine.scene, g.engine.sceneT, g.engine.sceneUI].filter(Boolean)), 1200);
      // start judging the frame rate once the background building has settled
      setTimeout(() => { g.perf.ready = true; }, 2500);
    });
    // first user gesture wakes the audio
    const wake = () => {
      this.audio.start?.().then(() => this.applyVolumes()).catch(() => {});
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    window.addEventListener('touchend', wake); // iOS unlocks audio on touchend, not touchstart
    window.addEventListener('blur', () => { if (this.state === 'play' && !g.debug) this.pause(); });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'play' && g.input.lockWanted && !g.debug) this.pause();
    });
    const p = g.params;
    if (g.debug && p.has('auto')) {
      // headless testing: a simple autopilot that follows the herd and its mother
      this.autoplay = true;
      this.player.autopilot = () => {
        const calf = this.herd.calf;
        const lg = this.life?.autoGoal?.();
        if (lg) {
          const to = this._v2.copy(lg).sub(calf.pos);
          const d = to.length();
          return { swim: d > 8 ? 1 : 0.4, yaw: Math.atan2(to.x, to.z), pitch: Math.asin(clamp(to.y / Math.max(d, 1), -1, 1)) * 0.9, surge: d > 60 };
        }
        const n = this.feastInvite ? this.eco?.nearestSwarm?.(calf.pos, 'glintfin') : null;
        const goal = n ? n.pos.clone() : this.herd.mother.pos.clone().addScaledVector(this.herd.mother.fwd, -6).add(new Vector3(6, 2, 0));
        const to = goal.sub(calf.pos);
        const d = to.length();
        return { swim: d > 10 ? 1 : 0.4, yaw: Math.atan2(to.x, to.z), pitch: Math.asin(clamp(to.y / Math.max(d, 1), -1, 1)) * 0.8, surge: d > 60 };
      };
    }
    const chQ = p.has('chapter') ? +p.get('chapter') : -1;
    if (g.debug && (p.has('act') || chQ >= 10)) {
      // debug: jump straight into an act of the life cycle (?act=2|3|4, or chapter=10|11|12)
      await this.waitWorld();
      this.life.start(p.has('act') ? clamp(+p.get('act'), 2, 4) : clamp(chQ - 8, 2, 4));
    } else if (g.debug && p.has('chapter')) {
      // debug: jump straight into a chapter
      await this.waitWorld();
      this.startChapter(+p.get('chapter'), { skipIntro: true });
    } else if (g.debug && p.has('hatch')) {
      // debug: straight into the hatching opening (?hatch, or ?hatch=push for the push beat)
      await this.waitWorld();
      this.enterMenu();
      this.menu.dissolveAll();
      this.state = 'intro';
      g.engine.setLook?.('cinematic', { focusOn: this.herd.calf.pos, ease: 0 });
      this.script.run(this.intro({ from: p.get('hatch'), snap: true }), 'intro');
    } else if (g.debug && p.has('intro')) {
      this.enterMenu();
      this.onMenu('new');
    } else {
      this.enterMenu();
    }
  }

  async loadOptional() {
    const g = this.game;
    try {
      const m = OPTIONAL['../audio/AudioSystem.js'];
      if (m) {
        const { AudioSystem } = await m();
        // phones get plain stereo panning for whale voices: HRTF is costly on the audio thread
        const touchOnly = navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches;
        this.audio = new AudioSystem(g, { hrtf: !touchOnly });
      }
    } catch (e) { console.warn('[skysong] audio unavailable', e); this.audio = new AudioStub(); }
    try {
      const m = OPTIONAL['../creatures/Ecosystem.js'];
      if (m) {
        const { Ecosystem } = await m();
        this.eco = new Ecosystem(g);
        this.eco.roosts = [this.herd.elder, ...this.herd.adults.filter((w) => w.role === 'adult').slice(0, 3)];
        // adults lunging with open mouths really eat (the calf feeds through eat() below)
        this.eco.feeders = this.herd.adults;
        // fish swim under the real sea; bird-reptiles land on the world's perches (the array grows as chapters build)
        this.eco.ocean = g.ocean;
        this.eco.perches = this.world.perches;
      }
    } catch (e) { console.warn('[skysong] ecosystem unavailable', e); this.eco = null; }
    try {
      // things to do while flying: catching bugs, tricks, slaps and spouts (src/game/Activities.js)
      const m = OPTIONAL['./Activities.js'];
      if (m) {
        const { Activities } = await m();
        this.activities = new Activities(g, this);
      }
    } catch (e) { console.warn('[skysong] activities unavailable', e); this.activities = null; }
    try {
      const m = OPTIONAL['../creatures/Falcon.js'];
      if (m) {
        const { Falcon } = await m();
        this.falcon = new Falcon(g);
        this.falcon.setMode?.('hidden');
        const F = this.falcon;
        // adults on the attack line block its dives: calves are safest hidden between them
        F.obstacles = this.herd.adults;
        this.booms.falcon = F;
        F.on?.('strikeHit', () => { this.falconResult = 'hit'; });
        F.on?.('strikeMiss', (e) => {
          this.falconResult = 'miss';
          if (e && e.blocked && e.by) this.falconBlockedBy = e.by;
        });
        F.on?.('screech', (e) => {
          // while hidden it is a far-off cry somewhere ahead of the herd
          const far = e && e.distant;
          const at = far ? this.herd.calf.pos.clone().add(new Vector3(-900, 300, -1400)) : F.pos;
          this.audio.sfx?.('falconScreech', { position: at, gain: far ? 0.5 : 1 });
        });
        F.on?.('flap', (e) => this.audio.sfx?.('falconWing', { position: F.pos, gain: 0.45 + 0.35 * clamp(e?.strength ?? 1, 0, 1) }));
        F.on?.('shadowOver', () => { this.falconShadowT = g.time; });
      }
    } catch (e) { console.warn('[skysong] falcon unavailable', e); this.falcon = null; }
  }

  async waitWorld() {
    while (!this.worldReady) await new Promise((r) => setTimeout(r, 50));
  }

  applyVolumes() {
    const s = this.game.settings;
    this.audio.setVolumes?.(s.music, s.sound);
  }

  // ---- saving ---------------------------------------------------------------------------
  loadSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; }
  }

  save(chapter, act = this.act, lifeDone = false) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ chapter, act: lifeDone ? 1 : act, completed: this.completed, t: Date.now() })); } catch (e) { /* private mode */ }
  }

  // ---- voices ---------------------------------------------------------------------------
  voiceOf(w) {
    let v = this.voices.get(w);
    if (!v) {
      v = this.audio.createVoice?.(w.genome.voice || { base: w.isCalf ? 72 : 50, formant: 1, breath: 0.2 }) || new VoiceStub();
      v.setPosition?.(w.pos);
      this.voices.set(w, v);
    }
    return v;
  }

  voiceHum(w, midi, dur) {
    this.voiceOf(w).hum?.(midi, dur, { gain: w.role === 'player' || w.role === 'mother' ? 1 : 0.6 });
    w.drive.hum = 1;
    this.humTimers.set(w, dur);
  }

  voiceCall(w, kind) {
    this.voiceOf(w).call?.(kind);
    w.drive.hum = 1;
    this.humTimers.set(w, kind === 'warn' ? 1.6 : 0.9);
    if (kind === 'answer' || kind === 'chirp' || kind === 'coo') w.anim.sHeadPitch.impulse(-1);
  }

  // ---- menu -------------------------------------------------------------------------------
  /** Clear every transient story state (used when entering the menu or a chapter). */
  resetWorldState() {
    const g = this.game, herd = this.herd;
    if (this.cine?.active) this.cine.end({ release: false });
    this.cine?.hideCard(true);
    this.cine?.clearText();
    this.script.cancel('moment');
    this.script.cancel('card');
    this.script.cancel('opening');
    this._lungeShown = false;
    this.life?.nursery?.close();
    if (this.life) restoreHatching(this);
    herd.motherScript = null;
    herd.songCenter = null;
    herd.protectCenter = null;
    herd.threat = null;
    herd.feedHook = null;
    herd.formationTight = 0;
    herd.stopPlay();
    herd.stopBubbleNet?.();
    this.activities?.reset?.();
    this.feastInvite = false;
    herd.care.mode = 'lead';
    this.protecting = false;
    for (const w of herd.whales) {
      Object.assign(w.drive, { charge: 0, sing: 0, hum: 0, fear: 0, feed: 0, mouth: 0, excite: 0 });
    }
    this.falcon?.setMode?.('hidden');
    this.falconBlockedBy = null;
    this.falconShadowT = null;
    g.engine.shadows.radius = 170;
    // a fresh sky: creatures are re-spawned for wherever the story resumes
    if (this.eco) { this.eco.clear(); this.eco.songRadius = 16; this.spawned.clear(); }
    this.weather.set(0, { lightning: 0 });
    this.weather.level = 0;
    g.wind.set(3, 0.3);
    g.atmosphere.stormBoost = 0;
    G.uSongAmp.value = 0;
    g.timeScale = 1;
    g.timeScaleTarget = 1;
    this.showGathering(false);
    this.player.charge = 0;
    this.player.charging = false;
    if (this.player.humming) { this.player.humming = false; this.onCalfHumEnd(); }
    Object.assign(this.song, { listening: false, active: false, expect: null, presses: [] });
    herd.care.answerAt = -1;
    for (const w of this.gathering || []) { w.drive.sing = 0; w.drive.hum = 0; this.humTimers.delete(w); }
    herd.calf.energy = 1;
    herd.calf.drive.tired = 0;
    this.player.cooldown = 0;
    this.weather.rain = 0;
    this.weather.rainU.uRain.value = 0;
    this.weather.rainMesh.visible = false;
    this.weather.flash = 0;
    G.uFlash.value = 0;
    G.uWet.value = 0;
  }

  enterMenu() {
    const g = this.game;
    this.state = 'menu';
    g.engine.setLook?.('title', { focusOn: this.herd.mother.pos, ease: 0 });
    this.chapterIndex = -1;
    this.script.cancel();
    this.resetWorldState();
    this.life?.restore();
    this.act = 1;
    this.player.enabled = false;
    g.input.setGameplayMode(false);
    document.body.classList.remove('playing');
    this.herd.placeAt(60);
    this.herd.mode = 'rest';
    this.herd.targetSpeed = 0;
    this.herd.calf.drive.sleep = 1;
    this.herd.mother.drive.sleep = 0.5;
    this.herd.motherScript = null;
    g.atmosphere.set('menu');
    this.weather.set(0, { lightning: 0 });
    g.wind.set(3, 0.3);
    this.menuT = 0;
    this.menu.returnPage = 'main';
    this.menu.dissolving = false;
    for (const it of [this.menu.title, this.menu.subtitle]) it.dissolve = 0;
    this.menu.show('main');
    this.audio.setMood?.('title', { fade: 4 });
    this.audio.setIntensity?.(0.5);
    g.cameraRig.setCinematic(this.shot, 0.25);
    g.cameraRig.cineW = 1;
    this.menuShot(0);
    if (!g.debug) {
      g.engine.post.grade.uFade.value = 1;
      g.fadeRate = -0.35;
    }
    this.populateEcosystem(0);
  }

  menuShot(t) {
    // a slow drift between the resting whales, high and wide
    const c = this.path.pointAt(60);
    const a = 2.2 + t * 0.012;
    const r = 120 + Math.sin(t * 0.05) * 25;
    this.shot.pos.set(c.x + Math.cos(a) * r, c.y + 18 + Math.sin(t * 0.07) * 8, c.z + Math.sin(a) * r);
    this.shot.look.copy(c).add(new Vector3(Math.sin(t * 0.03) * 20, 6, -10));
    this.shot.fov = 46;
    this.shot.roll = Math.sin(t * 0.04) * 0.02;
  }

  onMenu(a) {
    const g = this.game;
    if (a === 'settingsChanged') {
      this.applyVolumes();
      g.input.settings.invertY = g.settings.invertY;
      g.input.settings.sensitivity = g.settings.sensitivity;
      if (g.engine.qualityName !== g.settings.quality) {
        g.engine.setQuality(g.settings.quality);
        g.applyQuality();
        this.applyFurQuality();
      }
      return;
    }
    if (a === 'new') {
      this.audio.start?.().then(() => this.applyVolumes());
      this.menu.dissolveAll();
      this.state = 'intro';
      this.cine.seen.clear();
      g.engine.setLook?.('cinematic', { focusOn: this.herd.calf.pos, ease: 2 });
      this.script.run(this.intro(), 'intro');
      return;
    }
    if (a === 'continue') {
      this.audio.start?.().then(() => this.applyVolumes());
      const s = this.loadSave();
      this.menu.dissolveAll();
      this.script.run(this.continueFrom(s ? s.chapter : 0, s ? s.act || 1 : 1), 'continue');
      return;
    }
    if (a === 'resume') return this.resume();
    if (a === 'title') {
      this.resume(true);
      this.fadeThen(() => this.enterMenu());
    }
  }

  *continueFrom(ch, act = 1) {
    const g = this.game;
    g.fadeRate = 0.9;
    yield () => g.engine.post.grade.uFade.value >= 0.99;
    this.menu.hide();
    yield* this.waitPromise(this.waitWorld());
    if (act >= 2) this.life.start(act);
    else this.startChapter(ch, { skipIntro: true });
    g.fadeRate = -0.5;
  }

  *waitPromise(p) {
    let done = false;
    p.then(() => { done = true; });
    yield () => done;
  }

  fadeThen(fn) {
    const g = this.game;
    g.fadeRate = 1.2;
    this.script.run((function* () {
      yield () => g.engine.post.grade.uFade.value >= 0.99;
      fn();
      g.fadeRate = -0.6;
    })(), 'fade');
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.game.timeScaleTarget = 0.02;
    this.player.enabled = false;
    this.game.input.setGameplayMode(false);
    document.body.classList.remove('playing');
    this.cine?.hideCard(true);
    this.cine?.clearText();
    this.menu.returnPage = 'pause';
    this.menu.dissolving = false;
    for (const it of [this.menu.title, this.menu.subtitle]) it.dissolve = 0;
    this.game.engine.setLook?.('title', { focusOn: this.herd.calf.pos, ease: 0.8 });
    this.menu.show('pause');
    this.audio.duck?.(0.5, 0.4);
  }

  resume(silent = false) {
    if (this.state !== 'paused') return;
    this.state = 'play';
    this.game.timeScaleTarget = 1;
    this.game.engine.setLook?.('gameplay', { focusOn: this.herd.calf.pos });
    this.menu.hide();
    // a cinematic in progress keeps the controls until it hands them back
    this.player.enabled = !this.cine?.held;
    if (this.cine && this.cine.slow !== 1) this.game.timeScaleTarget = this.cine.slow;
    this.game.input.setGameplayMode(true);
    document.body.classList.add('playing');
  }

  // ---- the opening ----------------------------------------------------------------------
  /**
   * ACT I opens with the player's hatching in the Spiral Maelstrom, filmed like a nature
   * documentary (src/game/life/Hatching.js); it hands over to the Dawn Lagoon chapter itself.
   */
  *intro(opts = {}) {
    const g = this.game;
    this.menu.dissolveAll();
    this.act = 1;
    g.atmosphere.transition('dawn', 14);
    this.audio.setMood?.('dawn', { fade: 6 });
    yield* hatching(this, opts);
  }

  // ---- chapters ----------------------------------------------------------------------------
  startChapter(i, opts = {}) {
    const g = this.game, herd = this.herd;
    const ch = this.path.chapters[i];
    this.script.cancel('chapter');
    if (!opts.fromIntro) {
      this.resetWorldState();
      this.life?.restore();
    }
    this.act = 1;
    this.state = 'play';
    g.engine.setLook?.('gameplay', { focusOn: herd.calf.pos });
    this.player.enabled = true;
    g.input.setGameplayMode(true);
    document.body.classList.add('playing');
    if (!opts.fromIntro) {
      herd.placeAt(ch.start + 30, { speed: i === 0 ? 0 : 6 });
      herd.calf.drive.sleep = 0;
      herd.mother.drive.sleep = 0;
      this.player.syncAim();
      g.cameraRig.cineTarget = 0;
      g.cameraRig.cineW = 0;
      g.cameraRig.initialized = false;
      g.atmosphere.set(ch.time);
      this.menu.hide();
    }
    this.chapterIndex = i;
    this.enterChapter(i, !opts.fromIntro);
  }

  enterChapter(i, instant = false) {
    const g = this.game, herd = this.herd;
    const ch = this.path.chapters[i];
    this.chapterIndex = i;
    this.save(i);
    this.populateEcosystem(i);
    if (!instant) g.atmosphere.transition(ch.time, i === 0 ? 120 : 45);
    this.audio.setMood?.(ch.mood, { fade: 8 });
    this.audio.setIntensity?.(0.5);
    const gen = this['chapter_' + ch.id];
    if (gen) this.script.run(gen.call(this), 'chapter');
    this.chapterStartT = g.time;
  }

  /** Species reveals and chapter establishing shots are gone (docs/VUR_SOK.md 0.8: no labels). */
  docWatch() {}

  populateEcosystem(i) {
    if (!this.eco) return;
    // creatures of chapters left far behind are released
    if (this.herd) this.eco.prune?.(this.path.pointAt(this.herd.s), 2500);
    const ids = [i, i + 1].map((k) => this.path.chapters[k]?.id).filter(Boolean);
    for (const id of ids) {
      // a chapter still being built has no spawns yet: it is picked up later, not marked done
      if (this.spawned.has(id) || !this.world.done.has(id)) continue;
      this.spawned.add(id);
      const sp = this.world.spawns;
      for (const k of sp.fish?.filter((s) => s.chapter === id) || []) this.eco.addFishSchool?.(k.pos, k.species, k.count);
      for (const k of sp.reptiles?.filter((s) => s.chapter === id) || []) this.eco.addReptileFlock?.(k.pos, k.species, k.count);
    }
  }

  *chapter_cradle() {
    const g = this.game, herd = this.herd, mom = herd.mother, calf = herd.calf;
    herd.mode = 'rest';
    herd.targetSpeed = 0;
    // the mother shows the way: a short swim, then she turns and calls
    let phase = 0;
    const spot = this.path.offsetAt(Math.max(130, herd.s + 70), -6, 6);
    herd.motherScript = (m) => {
      if (phase === 0) return { target: spot, speed: 5, arrive: 10, lookAt: calf.pos };
      return { target: spot, speed: 3, arrive: 12, lookAt: calf.pos, face: calf.pos };
    };
    yield 2;
    phase = 1;
    this.voiceCall(mom, 'answer');
    yield* until(() => calf.pos.distanceTo(mom.pos) < 26, 14);
    mom.drive.happy = 1;
    this.voiceCall(mom, 'answer');
    calf.drive.happy = 1;
    yield 1;
    // the herd wakes and lifts off over the sea
    herd.motherScript = null;
    herd.mode = 'travel';
    herd.targetSpeed = 12;
    this.voiceCall(herd.elder, 'answer');
    yield 4;
    herd.targetSpeed = 17;
    yield () => herd.s > this.path.chapters[1].start;
  }

  // ---- cinematic helpers ------------------------------------------------------------------------
  /** A cinematic moment inside a chapter: the camera is taken, the calf carried beside its mother. */
  *moment(body, opts = {}) {
    const C = this.cine;
    if (!C || C.active || (this.state !== 'play' && this.state !== 'paused')) return;
    C.begin(Object.assign({ focus: this.herd.mother, rate: 0.7 }, opts));
    yield* body.call(this, C);
    C.end();
  }

  /**
   * A travel cut: a soft dissolve through sea haze (never black), the herd further along the route
   * (arc length toS). The play camera stays the player's; nothing is taken from them.
   */
  *travelCut(toS) {
    const g = this.game, herd = this.herd, C = this.cine;
    if (!C || C.active || toS < herd.s + 120 || this.state !== 'play') return;
    const ch = this.path.chapters[this.chapterIndex];
    yield* this.dissolve(() => {
      const sp = herd.speed;
      herd.placeAt(toS, { speed: sp });
      herd.speed = sp;
      this.player.syncAim();
      g.cameraRig.initialized = false;
      this.populateEcosystem(this.chapterIndex);
    }, HAZE[ch?.time] || HAZE_DAY);
  }

  /**
   * One soft dissolve: the frame melts into a colour (sea haze, or warm gold for the seasons
   * turning), fn() runs while it is covered, then the picture comes back. Never a black dip.
   */
  *dissolve(fn, color = HAZE_DAY, rateIn = 1.25, rateOut = -0.75, hold = 0) {
    const g = this.game, grade = g.engine.post.grade;
    this.script.cancel('fadeColor');
    grade.uFadeColor?.value.setRGB(color[0], color[1], color[2]);
    g.fadeRate = rateIn;
    let t = 0;
    while (!g.debug && grade.uFade.value < 0.99 && t < 3) t += yield 0;
    fn?.();
    if (hold > 0) yield hold;
    g.fadeRate = rateOut;
    // back to black for the menu's own fades once this one has cleared
    this.script.run((function* () {
      let u = 0;
      while (!g.debug && grade.uFade.value > 0.001 && u < 6) u += yield 0;
      if (g.fadeRate === rateOut) grade.uFadeColor?.value.setRGB(0, 0, 0);
    })(), 'fadeColor');
  }

  /** The bubble-net lunge seen from the waterline, in slow motion as the mother breaches. */
  *lungeMoment(m) {
    const g = this.game, C = this.cine;
    if (!C || C.active || this.state !== 'play') return;
    C.begin({ focus: m, rate: 0.7 });
    const shot = C.low({ subject: m, side: [24, 16], back: [-30, -12], height: [0.9, 1.8], fov: [46, 36], lookUp: 2 });
    let t = 0, slowT = 0, slow = false;
    while (t < 7 && !C.skipped) {
      const dt = yield 0;
      t += dt;
      shot(Math.min(1, t / 7), t, C.shot);
      if (!slow && m.pos.y > seaHeight(g, m.pos.x, m.pos.z) - m.radius * 0.5) {
        slow = true;
        C.slowmo(0.4);
        this.audio.stinger?.('discover');
        g.cameraRig.addShake(0.2);
      }
      if (slow && (slowT += g.dtReal ?? dt) > 2.6) break;
    }
    C.end();
  }

  *chapter_valleys() {
    const herd = this.herd, mom = herd.mother, calf = herd.calf;
    herd.mode = 'travel';
    herd.targetSpeed = 17;
    yield 5;
    // call and answer: the mother hums and waits for the calf's reply
    this.voiceCall(mom, 'answer');
    mom.drive.lookAt = calf.pos;
    const before = this.calfHums;
    let tries = 0;
    while (this.calfHums === before && tries < 2) {
      yield* until(() => this.calfHums > before, 5);
      if (this.calfHums === before) this.voiceCall(mom, 'answer');
      tries++;
    }
    const archS = this.world.archInfo?.s ?? 1860;
    yield () => herd.s > archS - 150;
    // the first sight of the Spiral Arch: a low angle as the herd sweeps beneath it
    this.audio.stinger?.('discover');
    calf.drive.excite = 1;
    yield* this.moment(function* (C) {
      yield* C.play(C.low({ subject: mom, side: [34, 24], back: [-80, -40], height: 2, fov: [50, 44], lookUp: [16, 32] }), 5.5);
    }, { rate: 0.4 });
    yield () => herd.s > archS + 40;
    yield* this.travelCut(this.path.chapters[2].start - 160);
    yield () => herd.s > this.path.chapters[2].start;
  }

  *chapter_krill() {
    // The Feasting Shoals: the herd drops to the sea, the adults ring a glintfin bait ball with a spiral
    // bubble net and lunge up through it together, and the mother takes her calf down to feast.
    const g = this.game, herd = this.herd, mom = herd.mother, calf = herd.calf;
    herd.mode = 'travel';
    herd.targetSpeed = 14;
    yield 1;
    herd.mode = 'feed';
    herd.targetSpeed = 3;
    herd.feedHook = (w) => {
      const n = this.eco?.nearestSwarm?.(w.pos);
      return n && n.dist < 400 ? n.pos : null;
    };
    const school = () => this.eco?.nearestSwarm?.(calf.pos, 'glintfin') || this.eco?.nearestSwarm?.(calf.pos);
    const first = school();
    if (first) herd.startBubbleNet?.(first.pos.clone());
    // the mother shows how: down beneath the fish, then up through them with her mouth wide
    const tgt = new Vector3(), look = new Vector3();
    let phase = 0, phaseT = g.time;
    const next = (p) => { phase = p; phaseT = g.time; };
    const bal = (m, y, dt) => herd.behaviors?.ballast?.(m, y, dt);
    herd.motherScript = (m, dt) => {
      const n = school();
      if (!n) return null;
      const surf = seaHeight(g, n.pos.x, n.pos.z);
      look.copy(n.pos);
      if (phase === 0) {
        // glide in low over the shoal
        tgt.copy(n.pos).setY(surf + 6);
        if (m.pos.distanceTo(tgt) < 16 || g.time - phaseT > 16) next(1);
        return { target: tgt, speed: 9, arrive: 6, lookAt: look };
      }
      if (phase === 1) {
        // dive beneath the bait ball
        tgt.copy(n.pos).y -= 10;
        // her ballast carries her down against the sea's lift
        if (m.pos.y < surf + 2) bal(m, tgt.y, dt);
        if (m.pos.y < n.pos.y - 5 || g.time - phaseT > 12) {
          next(2);
          // the breach, in slow motion from the waterline
          if (!this._lungeShown) { this._lungeShown = true; this.script.run(this.lungeMoment(m), 'moment'); }
        }
        return { target: tgt, speed: 8, arrive: 3, minSpeed: 5, lookAt: look, maxPitch: 1.15, pitchGain: 1.3 };
      }
      if (phase === 2) {
        // the lunge: up through the fish and out into the air
        const near = m.pos.distanceTo(n.pos) < 20;
        m.drive.feed = near ? 1 : 0.4;
        m.drive.mouth = m.drive.feed;
        tgt.copy(n.pos).setY(surf + 14);
        if (m.pos.y > surf + 4 || g.time - phaseT > 8) { m.drive.feed = 0; m.drive.mouth = 0; next(3); }
        return { target: tgt, speed: 13, arrive: 1, minSpeed: 10, lookAt: tgt, maxPitch: 1.2, pitchGain: 1.3 };
      }
      // then beside her calf: following it down when it dives, waiting at the surface when it does not
      m.drive.feed = 0;
      m.drive.mouth = 0;
      const deep = (this.calfWater?.depth ?? -9) > 1;
      tgt.copy(calf.pos).add(_mOff.set(-7, deep ? -1 : 0, 5));
      const sy = seaHeight(g, tgt.x, tgt.z);
      // waiting low over the shoal (never climbing after a calf that hovers above her)
      if (!deep) tgt.y = Math.max(sy + 2, Math.min(tgt.y, sy + 8));
      else bal(m, tgt.y, dt);
      return { target: tgt, speed: deep ? 7 : 6, arrive: 8, lookAt: calf.pos, maxPitch: deep ? 1 : 0.6 };
    };
    yield* until(() => phase === 3, 40);
    // her invitation: a call, and again while the calf stays up in the air
    this.voiceCall(mom, 'answer');
    this.feastInvite = true;
    const eaten0 = this.eaten;
    const t0 = g.time;
    let lastCall = g.time;
    yield* until(() => {
      if (g.time - lastCall > 9 && (this.calfWater?.depth ?? -9) < 0) { lastCall = g.time; this.voiceCall(mom, 'answer'); }
      return this.eaten - eaten0 > 10 || g.time - t0 > 32;
    }, 36);
    if (this.eaten - eaten0 > 10) {
      mom.drive.happy = 1;
      this.voiceCall(mom, 'answer');
      this.audio.stinger?.('discover');
    }
    yield 3;
    // a last rising lunge from the adults, then everyone surfaces, breathes and lifts off
    this.feastInvite = false;
    herd.stopBubbleNet?.();
    herd.motherScript = null;
    herd.feedHook = null;
    this.voiceCall(herd.elder, 'answer');
    herd.mode = 'travel';
    herd.targetSpeed = 13;
    yield 3;
    herd.targetSpeed = 17;
    yield* this.travelCut(this.path.chapters[3].start - 160);
    yield () => herd.s > this.path.chapters[3].start;
  }

  *chapter_forest() {
    const herd = this.herd;
    herd.mode = 'travel';
    herd.targetSpeed = 16;
    yield 3;
    // a playmate comes to invite the calf into a chase
    for (let k = 0; k < Math.min(1, herd.calves.length); k++) {
      const c = herd.calves[k];
      herd.startPlay(c);
      this.voiceCall(c, 'play');
      yield* until(() => (c.play?.caught ?? 0) > 0, 22);
      yield 3;
      c.play = null;
      if (herd.s > this.path.chapters[4].start - 200) break;
    }
    herd.stopPlay();
    yield* this.travelCut(this.path.chapters[4].start - 160);
    yield () => herd.s > this.path.chapters[4].start;
  }

  *chapter_song() {
    const g = this.game, herd = this.herd;
    herd.mode = 'travel';
    herd.targetSpeed = 17;
    const center = this.world.songCenter || this.path.pointAt(5800);
    yield () => herd.s > 5650;
    herd.mode = 'gather';
    herd.songCenter = center.clone();
    herd.targetSpeed = 0;
    yield* until(() => herd.calf.pos.distanceTo(center) < 140, 14);
    // the ring of whales at golden hour, before the first note
    yield* this.moment(function* (C) {
      yield* C.play(C.orbit({ center, radius: [170, 120], height: [50, 24], angle: [0.6, 1.2], fov: [48, 44], look: center }), 5);
    }, { focus: center, rate: 0.4 });
    yield* this.song.run();
    // dusk falls as the herd moves on
    herd.mode = 'travel';
    herd.songCenter = null;
    herd.targetSpeed = 17;
    g.atmosphere.transition('dusk', 18);
    this.audio.setMood?.('night', { fade: 12 });
    yield 4;
    yield* this.travelCut(this.path.chapters[5].start - 150);
    yield () => herd.s > this.path.chapters[5].start;
  }

  *chapter_night() {
    const herd = this.herd, mom = herd.mother;
    herd.mode = 'travel';
    herd.targetSpeed = 18;
    yield 4;
    // the herd under the spiral galaxy, plankton glowing in its wakes
    yield* this.moment(function* (C) {
      yield* C.play(C.track({ subject: mom, side: [-60, -44], up: [4, 22], ahead: [0, 26], fov: [48, 54] }), 5);
    }, { rate: 0.4 });
    yield () => herd.s > this.path.chapters[6].start;
  }

  *chapter_storm() {
    const g = this.game, herd = this.herd, mom = herd.mother, calf = herd.calf;
    herd.mode = 'travel';
    herd.targetSpeed = 15;
    this.weather.set(0.6, { lightning: 0.08, spots: this.world.lightningSpots });
    g.wind.set(9, 0.7);
    yield 6;
    this.weather.set(1, { lightning: 0.22 });
    g.wind.set(15, 0.95);
    herd.mode = 'shield';
    herd.formationTight = 1;
    this.audio.setIntensity?.(0.7);
    yield () => herd.s > 7550;
    // a downdraft tears the calf away from its mother: lightning, in slow motion
    this.weather.strike(calf.pos.clone().add(new Vector3(40, 140, -60)));
    calf.vel.add(new Vector3(18, -16, 10));
    calf.anim.flinch(1.5);
    calf.drive.fear = 1;
    this.voiceCall(calf, 'coo');
    yield* this.moment(function* (C) {
      C.slowmo(0.4);
      yield* C.play(C.rel({ subject: calf, side: [10, 7], up: [-3, -1], back: [-8, -5], ahead: 0, lookUp: [3, 0], fov: [40, 48], worldUp: true }), 1.3);
      this.weather.strike(calf.pos.clone().add(new Vector3(-80, 160, -120)));
    }, { focus: calf, rate: 2, hold: false });
    yield 0.6;
    this.voiceCall(mom, 'warn');
    this.audio.setIntensity?.(1);
    herd.care.mode = 'fetch';
    yield* until(() => calf.pos.distanceTo(mom.pos) < 24, 30);
    calf.drive.fear = 0;
    mom.drive.happy = 1;
    this.voiceCall(mom, 'answer');
    this.audio.setIntensity?.(0.6);
    yield 3;
    yield* this.travelCut(Math.min(8200, this.path.chapters[7].start - 150));
    yield () => herd.s > 8150;
    this.weather.set(0.25, { lightning: 0.02 });
    g.wind.set(5, 0.4);
    herd.mode = 'travel';
    herd.formationTight = 0;
    yield () => herd.s > this.path.chapters[7].start;
    this.weather.set(0, { lightning: 0 });
  }

  *chapter_falcon() {
    const g = this.game, herd = this.herd, mom = herd.mother, calf = herd.calf;
    const F = this.falcon;
    herd.mode = 'travel';
    herd.targetSpeed = 15;
    g.wind.set(4, 0.3);
    if (F) F.target = calf;
    yield 3;
    // something is wrong: a far cry, the herd tenses
    if (F) F.screech();
    else this.audio.sfx?.('falconScreech', { position: calf.pos.clone().add(new Vector3(-900, 300, -1400)), gain: 0.5 });
    for (const w of herd.adults) w.drive.fear = 0.35;
    this.audio.setIntensity?.(0.3);
    yield 4;
    if (this.eco) this.eco.threat = calf.pos.clone().add(new Vector3(0, 200, -500));
    yield 3;
    // a vast shadow sweeps over the herd: the hunter passes high between the herd and the sun
    this.falconShadowT = null;
    if (F) {
      g.engine.shadows.radius = 420; // wide enough for its shadow to cross the herd and the sea
      F.setMode('shadowPass', { crossIn: 5.5, altitude: 90, speed: 36, then: 'hidden', exitDistance: 380, fadeIn: 1.5 });
      yield* until(() => this.falconShadowT !== null, 9);
    } else yield 6;
    // everyone flinches and looks up
    for (const w of herd.adults) { w.drive.fear = 0.8; w.anim.flinch?.(0.5); }
    calf.anim.flinch(0.8);
    calf.drive.fear = 0.7;
    this.lookUpUntil = g.time + 4;
    g.cameraRig.addShake(0.15);
    yield 4;
    g.engine.shadows.radius = 170;
    this.voiceCall(mom, 'warn');
    for (const c of herd.calves) this.voiceCall(c, 'coo');
    yield 2;
    // the herd closes around its calves: a living shelter the calf must fly into
    herd.mode = 'protect';
    this.audio.setMood?.('chase', { fade: 3 });
    this.audio.setIntensity?.(0.5);
    herd.protectCenter = this.path.offsetAt(herd.s + 40, 0, 6);
    herd.targetSpeed = 2;
    this.protecting = true;
    const safe = () => calf.pos.distanceTo(herd.protectCenter) < 30;
    if (F) {
      // it shows itself, circles high over the herd, then stalks out of the sun
      F.screech();
      F.setMode('circle', { center: herd.protectCenter, radius: 240, altitude: herd.protectCenter.y + 190, fadeIn: 1.5 });
      herd.threat = F.pos;
      if (this.eco) this.eco.threat = F.pos;
      // the reveal: looking up past the calf at the hunter wheeling against the clouds
      yield* this.moment(function* (C) {
        yield* C.play((k, t, s) => {
          s.pos.copy(calf.pos).addScaledVector(calf.fwd, -12).addScaledVector(calf.right, 5).y -= 3;
          s.look.copy(F.pos);
          s.fov = lerp(52, 30, k);
          s.roll = 0.03 * k;
        }, 4);
      }, { focus: F, rate: 0.5 });
      F.setMode('stalk', { behind: 140, above: 100 });
      yield 3;
    }
    for (let wave = 0; wave < 2; wave++) {
      yield* until(() => safe(), wave === 0 ? 4 : 3);
      if (F) {
        // it dives from its stalking station: high, and neither too close nor too far
        yield* until(() => {
          const d = F.pos.distanceTo(calf.pos);
          return F.mode === 'stalk' && d > 120 && d < 260 && F.pos.y - calf.pos.y > 50;
        }, 12);
        F.screech();
        F.setMode('dive', { height: 60, maxTime: 22 });
        this.falconResult = null;
        this.falconBlockedBy = null;
        let boomed = false;
        let t = 0;
        while (this.falconResult === null && t < 26) {
          // the adults answer together as the hunter closes on a sheltered calf
          if (!boomed && t > 1 && safe() && F.mode !== 'knockback' && F.pos.distanceTo(calf.pos) < 95) {
            boomed = true;
            this.herdBoom(0.8 + wave * 0.15);
          }
          t += yield 0;
        }
        if (this.falconResult === 'hit') yield* this.rescue();
        else if (this.falconBlockedBy) {
          // the adult in its path roars it away
          const w = this.falconBlockedBy;
          this.falconBlockedBy = null;
          yield 0.6;
          w.anim.blast(1.1);
          this.voiceCall(w, 'roar');
          this.booms.spawn(w.pos.clone().addScaledVector(w.fwd, w.L * 0.5), { power: 1, radius: 90, source: w });
          F.knockback(w.pos, 1.2);
        }
        // it climbs away to circle and stalk again
        yield 4;
        if (wave < 1) F.setMode('stalk', { behind: 140, above: 100 });
      } else {
        yield 6;
        this.herdBoom(0.9);
      }
      this.audio.setIntensity?.(0.55 + wave * 0.15);
      yield 4;
    }
    // the final stand: every adult gathers its voice; the calf joins in
    for (const w of herd.adults) w.drive.charge = 0;
    let t = 0;
    while (t < 3.2) {
      for (const w of herd.adults) w.drive.charge = clamp(t / 3, 0, 1);
      this.audio.setIntensity?.(0.8 + t * 0.06);
      t += yield 0;
    }
    const hitF = this.herdBoom(1.6, true);
    for (const w of herd.adults) w.drive.charge = 0;
    if (F) {
      if (!hitF) F.knockback(herd.protectCenter || calf.pos, 2);
      yield 2.5;
      F.setMode('retreat', { from: herd.protectCenter || calf.pos });
    }
    herd.threat = null;
    this.protecting = false;
    if (this.eco) this.eco.threat = null;
    yield 3;
    // relief
    herd.mode = 'travel';
    herd.targetSpeed = 17;
    herd.protectCenter = null;
    this.audio.setMood?.('relief', { fade: 6 });
    this.audio.stinger?.('resolve');
    for (const w of herd.whales) w.drive.fear = 0;
    herd.motherScript = (m) => ({ target: calf.pos.clone().add(new Vector3(-5, 1.5, 3)), speed: 6, arrive: 6, lookAt: calf.pos });
    mom.drive.happy = 1;
    calf.drive.happy = 1;
    this.voiceCall(mom, 'answer');
    yield 4;
    herd.motherScript = null;
    yield* this.travelCut(this.path.chapters[8].start - 150);
    yield () => herd.s > this.path.chapters[8].start;
  }

  /**
   * Distance from `from` toward `to` at which the camera would enter rock or one of the big whales
   * (a capsule along each adult's body), or null. A whale the calf is already touching is ignored.
   */
  cameraHit(from, to) {
    let best = this.world.raycast(from, to);
    const dir = this._chDir || (this._chDir = new Vector3());
    const a = this._chA || (this._chA = new Vector3()), b = this._chB || (this._chB = new Vector3());
    const p = this._chP || (this._chP = new Vector3());
    dir.subVectors(to, from);
    const len = dir.length();
    if (len < 1e-3) return best;
    dir.divideScalar(len);
    const segDist = (q) => {
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const t = clamp(((q.x - a.x) * abx + (q.y - a.y) * aby + (q.z - a.z) * abz) / (abx * abx + aby * aby + abz * abz || 1), 0, 1);
      return Math.hypot(q.x - a.x - abx * t, q.y - a.y - aby * t, q.z - a.z - abz * t);
    };
    for (const w of this.herd.adults) {
      if (!w.group.visible) continue;
      const half = Math.max(0, w.L * 0.5 - w.radius);
      a.copy(w.pos).addScaledVector(w.fwd, -half);
      b.copy(w.pos).addScaledVector(w.fwd, half);
      const rc = w.radius * 1.1;
      if (segDist(from) < rc) continue;
      if (Math.min(w.pos.distanceTo(from), w.pos.distanceTo(to)) > len + w.L) continue;
      for (let t = 0; t <= len; t += 0.5) {
        if (best !== null && t >= best) break;
        if (segDist(p.copy(from).addScaledVector(dir, t)) < rc) { best = t; break; }
      }
    }
    return best;
  }

  /**
   * A push that keeps the play camera at a comfortable distance from the big whales' bodies (a
   * capsule along each adult), so an adult never fills the frame or sits on the lens. out = push.
   */
  cameraAvoid(pos, out) {
    out.set(0, 0, 0);
    const me = this.herd.calf;
    const sc = Math.max(1, me.L / 4.2);
    for (const w of this.herd.adults) {
      if (w === me || !w.group.visible) continue;
      const half = Math.max(0, w.L * 0.5 - w.radius);
      _avA.copy(w.pos).addScaledVector(w.fwd, -half);
      _avB.copy(w.pos).addScaledVector(w.fwd, half).sub(_avA);
      const L2 = _avB.lengthSq() || 1;
      const t = clamp(_avD.copy(pos).sub(_avA).dot(_avB) / L2, 0, 1);
      _avD.copy(_avA).addScaledVector(_avB, t);
      _avD.subVectors(pos, _avD);
      const d = _avD.length();
      const clear = w.radius * 2.2 + 7 * sc;
      if (d >= clear) continue;
      // out and a little up, around the body rather than through it
      if (d < 1e-3) _avD.set(0, 1, 0); else _avD.divideScalar(d);
      out.addScaledVector(_avD, clear - d);
      out.y += (clear - d) * 0.35;
    }
    const L = out.length();
    if (L > 24 * sc) out.multiplyScalar((24 * sc) / L);
    return out;
  }

  /** Yields until the score's next beat (offset seconds earlier), so a voice lands on the music's grid. */
  *untilNextBeat(maxWait = 2, early = 0) {
    const ctx = this.audio.ctx;
    const k = this.audio.getKey?.();
    if (!ctx || !k || !Number.isFinite(k.nextBeatTime)) return;
    yield clamp(k.nextBeatTime - ctx.currentTime - early, 0, maxWait);
  }

  nearFalcon(r) {
    return !!this.falcon && this.falcon.pos && this.falcon.pos.distanceTo(this.herd.calf.pos) < r;
  }

  *rescue() {
    const herd = this.herd, mom = herd.mother, calf = herd.calf;
    // talons graze the calf: it tumbles free; the mother answers with a blast
    calf.vel.add(new Vector3(0, -8, 0)).addScaledVector(calf.right, 6);
    calf.anim.flinch(2);
    calf.drive.fear = 1;
    this.voiceCall(calf, 'coo');
    this.game.cameraRig.addShake(0.9);
    this.audio.stinger?.('strike');
    yield 0.4;
    mom.anim.blast(1.2);
    this.voiceCall(mom, 'roar');
    this.booms.spawn(mom.pos.clone().addScaledVector(mom.fwd, mom.L * 0.5), { power: 1.4, radius: 110, source: mom });
    this.falcon?.knockback?.(mom.pos, 1.4);
    yield 1.5;
    calf.drive.fear = 0.4;
  }

  /** Adults release a synchronised boom from around the calf. */
  herdBoom(power = 1, giant = false) {
    const herd = this.herd;
    let center = new Vector3();
    let n = 0;
    for (const w of herd.adults) {
      w.anim.blast(1.2);
      this.voiceCall(w, 'roar');
      center.add(w.pos);
      n++;
      if (!giant) this.booms.spawn(w.pos.clone().addScaledVector(w.fwd, w.L * 0.5), { power: power * 0.8, radius: 70 * power, source: w });
    }
    center.divideScalar(Math.max(1, n));
    if (giant) {
      this.booms.spawn(center, { power: 2.2, radius: 320, speed: 160, strength: 120 });
      this.game.cameraRig.addShake(1.3);
    }
    this.audio.sfx?.('boom', { position: center, gain: 1.2 });
    this.audio.stinger?.('boom');
    this.audio.duck?.(0.4, 1.2);
    const F = this.falcon;
    const reach = giant ? 400 : Math.max(120 * power, 110);
    const hitF = !!F && F.mode !== 'hidden' && Math.min(F.pos.distanceTo(center), F.pos.distanceTo(herd.calf.pos)) < reach;
    if (hitF) F.knockback?.(center, giant ? 2 : power);
    this.eco?.scatter?.(center, giant ? 320 : 150, 1.5, giant ? 160 : undefined);
    return hitF;
  }

  *chapter_wall() {
    const herd = this.herd, mom = herd.mother, calf = herd.calf;
    herd.mode = 'travel';
    herd.targetSpeed = 15;
    // through the wall the mother stays close and keeps calling
    herd.motherScript = () => {
      const sA = clamp(herd.calfS + 25, herd.s - 40, herd.s + 40);
      return { target: this.path.offsetAt(sA, -6, 3).lerp(calf.pos, 0.3), speed: Math.max(7, calf.vel.length() + 1), arrive: 8, minSpeed: 3, lookAt: calf.pos };
    };
    let t = 0;
    while (herd.s < this.path.chapters[9].start - 40) {
      if (t > 6) { this.voiceCall(mom, 'answer'); t = 0; }
      t += yield 0;
    }
    herd.motherScript = null;
  }

  *chapter_oasis() {
    const g = this.game, herd = this.herd, calf = herd.calf, mom = herd.mother;
    herd.mode = 'travel';
    herd.targetSpeed = 13;
    this.audio.stinger?.('discover');
    this.showGathering(true);
    // the reveal: the camera rises wide as the calf emerges from the wall
    const t0 = g.time;
    const mt = this.world.motherTree || this.path.pointAt(11150);
    yield* this.moment(function* (C) {
      yield* C.play((k, t, s) => {
        s.pos.copy(calf.pos).addScaledVector(calf.fwd, -20 - k * 30).addScaledVector(calf.right, 14);
        s.pos.y += 8 + k * 34;
        s.look.copy(calf.pos).addScaledVector(calf.fwd, 220);
        s.look.y -= 20;
        s.fov = 52;
        s.roll = 0;
      }, 8);
    }, { focus: calf, rate: 0.35 });
    // free to explore; the herd drifts toward the Mother Tree
    herd.targetSpeed = 15;
    yield 8;
    yield* this.travelCut(10850);
    yield () => herd.s > 11000 || g.time - t0 > 70;
    yield* until(() => calf.pos.distanceTo(mom.pos) < 120 && calf.pos.distanceTo(mt) < 600, 20);
    yield* this.ending();
  }

  // ---- the Oasis gathering ---------------------------------------------------------------
  prepareGathering() {
    // many herds gather at the Oasis: built quietly in the background
    const g = this.game;
    this.gathering = [];
    const r = rng(77);
    const mt = this.world.motherTree || this.path.pointAt(11150);
    const make = (genome, k) => {
      const w = new Whale(Object.assign({}, genome, { seed: genome.seed + 1000 + k, name: genome.name + '-' + k }));
      w.furQuality = g.furQuality * 0.5;
      w.group.visible = !!this.gatheringOn;
      g.engine.scene.add(w.group);
      const a = r() * TAU, rad = lerp(180, 700, r());
      w.orbit = { a, rad, h: lerp(-30, 160, r()), speed: lerp(0.02, 0.05, r()) * (r() < 0.5 ? -1 : 1), center: mt };
      w.place(new Vector3(mt.x + Math.cos(a) * rad, mt.y + 150 + w.orbit.h, mt.z + Math.sin(a) * rad), a);
      this.gathering.push(w);
    };
    let k = 0;
    const queue = [];
    for (let i = 0; i < 14; i++) queue.push(ADULTS[i % ADULTS.length]);
    for (let i = 0; i < 5; i++) queue.push(CALVES[i % CALVES.length]);
    const step = () => {
      if (!queue.length) return;
      make(queue.shift(), k++);
      setTimeout(step, 30);
    };
    step();
  }

  applyFurQuality() {
    const g = this.game;
    for (const w of this.herd?.whales || []) w.furQuality = g.furQuality;
    for (const w of this.gathering || []) w.furQuality = g.furQuality * 0.5;
  }

  showGathering(v) {
    for (const w of this.gathering || []) w.group.visible = v;
    this.gatheringOn = v;
    // the Oasis whales collide with the herd too
    this.herd.extraWhales = v ? this.gathering : null;
  }

  /** Two whales touched (WhalePhysics): a soft bonk, the calf's voice, a nudge of the camera. */
  onWhaleContact(a, b, point, k) {
    const g = this.game, calf = this.herd.calf;
    if (k > 0.2 && g.time - (this.lastWhaleBonk || 0) > 0.25 && point.distanceTo(g.engine.camera.position) < 160) {
      this.lastWhaleBonk = g.time;
      this.audio.sfx?.('bonk', { position: point.clone(), gain: clamp(0.2 + k * 0.45, 0, 1) });
    }
    if (a !== calf && b !== calf) return;
    const o = a === calf ? b : a;
    if (k > 0.6) g.cameraRig.addShake?.(Math.min(0.3, k * 0.12));
    calf.drive.happy = Math.max(calf.drive.happy, 0.8);
    if (g.time - (this.lastNuzzle || 0) < 2.5) return;
    this.lastNuzzle = g.time;
    if (o === this.herd.mother) this.voiceCall(calf, k < 0.4 ? 'coo' : 'chirp');
    else if (o.isCalf) this.voiceCall(calf, 'play');
    else if (k < 0.5) this.voiceCall(calf, 'coo');
  }

  updateGathering(dt) {
    if (!this.gatheringOn) return;
    const cam = this.game.engine.camera.position;
    for (const w of this.gathering) {
      const o = w.orbit;
      o.a += o.speed * dt;
      const target = new Vector3(o.center.x + Math.cos(o.a) * o.rad, o.center.y + 150 + o.h + Math.sin(o.a * 3) * 10, o.center.z + Math.sin(o.a) * o.rad);
      this.herd.steer(w, target, w.isCalf ? 7 : 6, dt, { arrive: 20, minSpeed: 3 });
      w.step(dt);
      this.voices.get(w)?.setPosition?.(w.pos);
      const ht = this.humTimers.get(w);
      if (ht !== undefined) {
        const nt = ht - dt;
        if (nt <= 0) { w.drive.hum = 0; this.humTimers.delete(w); } else this.humTimers.set(w, nt);
      }
      w.animate(dt, cam);
    }
  }

  // ---- the ending -----------------------------------------------------------------------
  *ending() {
    const g = this.game, herd = this.herd, calf = herd.calf, mom = herd.mother;
    // the finale cannot start under the pause menu (Resume would then be dead)
    while (this.state === 'paused') yield 0;
    this.state = 'ending';
    g.engine.setLook?.('cinematic', { focusOn: calf.pos, ease: 3 });
    const mt = this.world.motherTree || this.path.pointAt(11150);
    const center = mt.clone().add(new Vector3(0, 120, 0));
    herd.mode = 'gather';
    herd.songCenter = center;
    herd.targetSpeed = 0;
    const p = this.player;
    if (p.humming) { p.humming = false; this.onCalfHumEnd(); }
    p.charge = 0;
    p.charging = false;
    calf.drive.charge = 0;
    this.audio.setMood?.('finale', { fade: 6 });
    // the mother begins on the finale's first downbeat
    let wait = 0;
    while (this.audio.getKey?.().mood !== 'finale' && wait < 6) wait += yield 0;
    yield* this.untilNextBeat(4);
    // the mother begins the song of the herd
    const key = this.song;
    const theme = [[2, 2], [4, 1], [7, 1], [6, 3], [5, 1], [4, 2], [2, 1], [1, 1], [2, 4]];
    const beat = key.key().beat;
    herd.motherScript = (m) => ({ target: calf.pos.clone().add(new Vector3(-10, 2, 6)), speed: 4, arrive: 10, lookAt: calf.pos, face: center });
    for (const [deg, b] of theme) {
      this.voiceHum(mom, key.midi(deg, -1), b * beat * 0.95);
      mom.drive.sing = 1;
      yield b * beat;
    }
    // everyone joins, the calf with them: the herd and the nearest gathered whales are heard,
    // the far ones sing with their bodies (the voice budget is 16)
    const near = (this.gathering || []).slice().sort((a, b) => a.pos.distanceToSquared(calf.pos) - b.pos.distanceToSquared(calf.pos)).slice(0, 3);
    for (const w of this.gathering || []) w.drive.sing = 1;
    for (const w of [...herd.whales, ...near]) {
      if (w === calf) continue;
      w.drive.sing = 1;
      const deg = [0, 4, 2, 7][Math.floor(Math.random() * 4)];
      setTimeout(() => this.voiceHum(w, key.midi(deg, w.isCalf ? 1 : -2), beat * 10), Math.random() * 1200);
    }
    this.voiceHum(calf, key.midi(4, 1), beat * 10);
    calf.drive.sing = 1;
    calf.drive.happy = 1;
    G.uSongRipple.value.set(center.x, center.y, center.z, g.time);
    G.uSongAmp.value = 2.2;
    // the song centres on the Mother Tree's trunk: creatures circle wide of the bark
    if (this.eco) { this.eco.songFocus = center; this.eco.songRadius = 44; }
    this.audio.setIntensity?.(1);
    // a slow rising crane shot around the herd and the Mother Tree
    this.player.enabled = false;
    this.cine.begin({ hold: false, focus: calf, rate: 0.18 });
    g.cameraRig.setCinematic(this.shot, 0.18);
    const t0 = g.time;
    this.endTitle = null;
    while (g.time - t0 < 20 && !this.cine.skipped) {
      const k = (g.time - t0) / 20;
      const a = 0.5 + k * 1.3;
      const rad = lerp(40, 260, easeInOut(k));
      this.shot.pos.set(calf.pos.x + Math.cos(a) * rad, calf.pos.y + lerp(6, 160, easeInOut(k)), calf.pos.z + Math.sin(a) * rad);
      this.shot.look.copy(calf.pos).lerp(mt.clone().add(new Vector3(0, 200, 0)), easeInOut(k) * 0.7);
      this.shot.fov = lerp(45, 55, k);
      yield 0;
    }
    this.audio.stinger?.('resolve');
    this.completed = true;
    this.save(9, 2);
    // the seasons turn: the calf grows up (Act II), through one warm dissolve
    yield* this.life.seasonsTurn();
    this.cine.end({ release: false });
    G.uSongAmp.value = 0;
    if (this.eco) { this.eco.songFocus = null; this.eco.songRadius = 16; }
    this.showGathering(false);
    this.life.start(2);
  }

  // ---- calf interaction events ---------------------------------------------------------
  onCalfHum() {
    const calf = this.herd.calf;
    this.calfHums++;
    if (this.act > 1) this.life.onHum();
    let midi = this.song.listening ? this.song.humStart() : null;
    if (midi === null) {
      // free humming: nose-up raises the pitch, snapped to the key
      const k = this.song.key();
      const deg = Math.round(clamp((this.player.aimPitch + 0.6) * 5, 0, 9));
      midi = k.rootMidi + 12 + k.scale[deg % 7] + 12 * Math.floor(deg / 7);
      if (!this.song.active) this.herd.calfHummed();
    }
    this.voiceOf(calf).hum?.(midi, undefined, { gain: 1, glideFrom: midi - 2 });
    calf.drive.hum = 1;
    this.humTimers.set(calf, 99);
    calf.drive.happy = Math.max(calf.drive.happy, 0.5);
  }

  onCalfHumEnd() {
    const calf = this.herd.calf;
    this.song.humEnd();
    this.voiceOf(calf).release?.(0.35);
    this.humTimers.set(calf, 0.05);
  }

  onCalfBoom(e) {
    const calf = this.herd.calf;
    const pos = calf.pos.clone().addScaledVector(calf.fwd, calf.L * 0.6);
    const b = this.booms.spawn(pos, { power: e.power, radius: 16 + 26 * e.power, source: calf });
    this.voiceOf(calf).setChargeLevel?.(0);
    this.voiceCall(calf, 'roar');
    this.audio.sfx?.('boomSmall', { position: pos, gain: 0.6 + e.power * 0.5 });
    this.eco?.scatter?.(pos, 30 + 40 * e.power, e.power);
    // the expanding front knocks the falcon back if it reaches its body (SonicBooms.update)
    if (b) b.knockFalcon = 0.5 + e.power * 0.6;
  }

  // ---- per-frame --------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    // pause handling (eases time down/up)
    const ud = g.dtReal ?? Math.max(dt, 0.016);
    if (g.timeScaleTarget !== undefined) g.timeScale = damp(g.timeScale, g.timeScaleTarget, 4, ud);
    if (g.input.pausePressed) {
      if (this.state === 'play') this.pause();
      else if (this.state === 'paused' && this.menu.page === 'pause') this.resume();
    }
    this.script.update(dt);
    this.cine.update(ud);
    this.menu.update(ud);
    if (this.state === 'menu') {
      this.menuT = (this.menuT || 0) + dt;
      this.menuShot(this.menuT);
    }
    this.updateCalf(dt);
    this.life.update(dt);
    this.docWatch(dt);
    this.activities?.update?.(dt);
    this.herd.update(dt);
    for (const w of this.herd.whales) if (w !== this.herd.calf) waterStep(w, dt, g, { onSplash: this._onSplash });
    for (const w of this.gatheringOn ? this.gathering : []) waterStep(w, dt, g);
    const cam = g.engine.camera.position;
    for (const w of this.herd.whales) {
      if (w.role !== 'player') w.animate(dt, cam);
      const ht = this.humTimers.get(w);
      if (ht !== undefined) {
        const nt = ht - dt;
        if (nt <= 0) { w.drive.hum = 0; this.humTimers.delete(w); } else this.humTimers.set(w, nt);
      }
      const v = this.voices.get(w);
      if (v) v.setPosition?.(w.pos);
    }
    this.updateGathering(dt);
    this.waterfallMist(dt);
    this.oasisPetals(dt);
    this.weather.update(dt);
    this.booms.update(dt);
    this.falcon?.update?.(dt);
    this.eco?.update?.(dt);
    if (this.protecting && this.herd.protectCenter) {
      this.herd.protectCenter.lerp(this.path.offsetAt(this.herd.s + 40, 0, 6), 1 - Math.exp(-dt * 0.3));
    }
    // chapter progression
    if (this.state === 'play' || this.state === 'ending') {
      const next = this.path.chapters[this.chapterIndex + 1];
      if (next && this.act === 1 && this.herd.s >= next.start && this.state === 'play') this.enterChapter(this.chapterIndex + 1);
    }
    // alien plants recoil from whales passing low over them
    const fl = this.world.flora;
    if (fl) {
      const D = this._floraD || (this._floraD = []);
      D.length = 0;
      const near = (w) => { if (D.length < 8 && w.pos.y < 70 && w.pos.distanceToSquared(cam) < 160000) D.push(w); };
      for (const w of this.herd.whales) near(w);
      if (this.gatheringOn) for (const w of this.gathering) near(w);
      fl.update?.(dt, { disturbers: D });
    }
    this.world.update?.(dt);
    this.world.updateVisibility(this.state === 'menu' ? 60 : this.herd.s);
    this.updateAudio(dt);
    // big whales part the clouds
    // the falcon owns the last mover slot (it parts clouds too)
    const nM = G.uMovers.value.length - (this.falcon && this.falcon.moverSlot >= 0 ? 1 : 0);
    let mi = 0;
    for (const w of this.herd.adults) {
      if (mi >= nM) break;
      if (w.pos.distanceTo(cam) > 900) continue;
      G.uMoverVel.value[mi].set(w.vel.x, w.vel.y, w.vel.z, 0);
      G.uMovers.value[mi++].set(w.pos.x, w.pos.y, w.pos.z, w.L * 0.45);
    }
    for (; mi < nM; mi++) G.uMovers.value[mi].w = 0;
  }

  updateCalf(dt) {
    const g = this.game, herd = this.herd, calf = herd.calf;
    const playing = this.state === 'play' || this.state === 'paused';
    // a whale the act scripts pose by hand (the courtship helix, the elder's descent)
    const kin = this.life.isKinematic(calf);
    // the calf sleeps in the menu; it is the player's to steer in play
    if (kin) { /* posed by the life cycle */ } else if (playing) this.player.update(dt);
    else {
      calf.ctl.thrust = 0;
      calf.ctl.targetYaw = calf.yaw;
      calf.ctl.targetPitch = 0;
      calf.drive.effort = 0;
      calf.drive.glide = 0.2;
      if (this.state === 'menu' || this.state === 'intro') {
        // nestle against the mother's cheek, just under her eye and clear of her fin, drifting with her
        const mom = herd.mother;
        const spot = mom.pos.clone().addScaledVector(mom.right, 0.2 * mom.L).addScaledVector(mom.fwd, 0.36 * mom.L).addScaledVector(mom.up, -0.03 * mom.L);
        const want = spot.sub(calf.pos).multiplyScalar(0.9).add(mom.vel);
        calf.vel.lerp(want, 1 - Math.exp(-dt * 2.5));
        calf.ctl.targetYaw = mom.yaw;
      }
      if (this.state === 'ending') {
        const spot = herd.songCenter ? herd.songCenter.clone().add(new Vector3(-8, -2, 46)) : calf.pos;
        herd.steer(calf, spot, 5, dt, { arrive: 20 });
      }
    }
    // wind: the storm buffets the calf unless it shelters in its mother's lee
    g.wind.sample(calf.pos, calf.wind).multiplyScalar(herd.windShelter * (0.35 + this.weather.level * 0.9));
    // the herd's slipstream: flying with the travelling herd, the young one is carried along
    // (the air it swims through moves with the herd), so it keeps pace at migration speed
    if (playing && (herd.mode === 'travel' || herd.mode === 'shield') && herd.speed > 4) {
      const fr = herd.frame;
      const near = 1 - smoothstep(120, 320, calf.pos.distanceTo(herd.mother.pos));
      if (fr && near > 0) calf.wind.addScaledVector(fr.fwd, herd.speed * 0.5 * near);
    }
    if (!kin) {
      calf.step(dt);
      this.calfWater = waterStep(calf, dt, g, { player: true, onSplash: this._onSplash });
    }
    // soft world limits: the sea below (Swim.js), thin air above, the herd's pull around
    const anchor = herd.anchor;
    const ceiling = anchor.y + 260;
    const free = this.life.free || kin;
    if (!free && calf.pos.y > ceiling) calf.vel.y -= (calf.pos.y - ceiling) * 0.5 * dt;
    const away = this._v.copy(calf.pos).sub(anchor);
    const far = away.length();
    if (playing && !free && far > 420) {
      // a homeward wind turns the calf back toward its family
      calf.vel.addScaledVector(away.normalize(), -(far - 420) * 0.04 * dt * 10);
      herd.care.mode = 'fetch';
    }
    // collisions with rock
    const push = kin ? this._v2.set(0, 0, 0) : this.world.collide(calf.pos, calf.radius * 0.95, this._v2);
    if (push.lengthSq() > 1e-6) {
      const n = push.clone().normalize();
      const vn = calf.vel.dot(n);
      calf.pos.add(push);
      if (vn < 0) {
        calf.vel.addScaledVector(n, -vn * 1.5);
        if (-vn > 4 && g.time - this.lastBonk > 0.8) {
          this.lastBonk = g.time;
          calf.anim.flinch(Math.min(2, -vn / 6));
          this.audio.sfx?.('bonk', { position: calf.pos, gain: Math.min(1, -vn / 12) });
          g.cameraRig.addShake(0.25);
        }
      }
      calf._syncTransform();
    }
    // bumping into other whales is resolved by the herd's physics (herd.update, onWhaleContact)
    // eating: the mouth opens by itself near krill
    let feed = 0;
    if (this.eco && playing) {
      const n = this.eco.nearestSwarm?.(calf.pos);
      const sp = calf.vel.length();
      // the mouth opens at the fish, under or just over the sea, not high above them
      if (n && n.dist < 28 && sp > 2.5 && calf.pos.y < seaHeight(g, calf.pos.x, calf.pos.z) + 4) feed = 1;
      const mouth = calf.pos.clone().addScaledVector(calf.fwd, calf.L * 0.48);
      if (calf.drive.mouth > 0.4) {
        const eaten = this.eco.eat?.(mouth, calf.L * 0.35 + 0.6, dt, calf) || 0;
        if (eaten > 0) {
          this.eaten += eaten;
          calf.energy = Math.min(1, calf.energy + eaten * 0.012);
          calf.drive.happy = Math.max(calf.drive.happy, 0.8);
          if (g.time - (this.lastGulp || 0) > 0.35) {
            this.lastGulp = g.time;
            this.audio.sfx?.('gulp', { position: mouth, gain: 0.6 });
            // the same bite as with bugs: the jaw snaps shut and a swallow runs down the throat
            calf.anim.snap?.(0.7);
            calf.anim.gulp?.(Math.min(1.2, 0.4 + eaten * 0.05));
          }
        }
      }
    }
    calf.drive.feed = damp(calf.drive.feed, feed, 4, dt);
    calf.drive.mouth = damp(calf.drive.mouth, Math.max(feed, calf.drive.charge > 0 ? 0 : 0), 6, dt);
    calf.drive.happy = damp(calf.drive.happy, 0.25, 0.25, dt);
    if (playing) {
      const near = herd.mother.pos.distanceTo(calf.pos) < 40;
      calf.drive.lookAt = near && Math.sin(g.time * 0.4) > 0.3 ? herd.mother.pos : (this.falcon && herd.threat ? this.falcon.pos : null);
    }
    // sonic boom charge feedback
    const ch = this.player.charge;
    this.voiceOf(calf).setChargeLevel?.(ch);
    this.booms.charge = ch > 0.02 ? { pos: calf.pos.clone().addScaledVector(calf.fwd, calf.L * 0.55), amount: ch } : null;
    calf.animate(dt, g.engine.camera.position);
    g.focus.copy(calf.pos);
    // mist trails when slicing through cloud
    const inCloud = g.clouds.playerInCloud;
    const sp = calf.vel.length();
    if ((inCloud > 0.15 || calf.pos.y < 70) && sp > 3) {
      const rate = (inCloud > 0.15 ? inCloud : 0.4) * sp * 0.25;
      this.mistAcc = (this.mistAcc || 0) + rate * dt;
      while (this.mistAcc > 1) {
        this.mistAcc -= 1;
        // the wingtips' vortices stir the cloud into curling wisps that hang behind
        for (let side = -1; side <= 1; side += 2) {
          const E = _pfx;
          E.pos.copy(calf.pos).addScaledVector(calf.right, side * calf.L * 0.55).addScaledVector(calf.fwd, -calf.L * 0.1);
          E.vel.copy(calf.vel).multiplyScalar(0.08);
          E.life = 1.4 + Math.random() * 0.6; E.size = 0.3; E.sizeEnd = 1.8 + Math.random(); E.alpha = 0.35; E.drag = 1.2; E.gravity = 0;
          E.kind = 0; E.fadeIn = 0.1; E.color[0] = 1; E.color[1] = 1; E.color[2] = 1;
          g.mist.emit(E);
        }
      }
    }
    // camera
    if (playing || this.state === 'ending') {
      const opts = {};
      if (herd.mode === 'gather' && herd.songCenter) { opts.lookBias = herd.songCenter; opts.lookBiasW = 0.25; opts.lookBiasMax = 8; opts.extraDist = 4; opts.busy = true; }
      const fv = this.falcon && this.falcon.mode !== 'hidden' && this.falcon.group?.visible;
      if (herd.mode === 'protect' && fv) { opts.lookBias = this.falcon.pos; opts.lookBiasW = 0.2; opts.lookBiasMax = 6; opts.extraDist = 3; opts.busy = true; }
      if (fv && this.lookUpUntil && g.time < this.lookUpUntil) { opts.lookBias = this.falcon.pos; opts.lookBiasW = 0.3; opts.lookBiasMax = 6; opts.busy = true; }
      // guarding the egg: the view leans toward the nearest predator closing in
      const th = this.life.nursery.threats.length ? this.life.nursery.nearestThreat(calf.pos) : null;
      if (th && !opts.lookBias) { opts.lookBias = th.pos; opts.lookBiasW = 0.18; opts.lookBiasMax = 6; opts.busy = true; }
      opts.surfaceY = seaHeight(g, g.cameraRig.gPos.x, g.cameraRig.gPos.z);
      if (this.calfWater && this.calfWater.depth > 0) { opts.distance = 7; opts.busy = true; }
      g.cameraRig.follow(dt, calf, this.player.aimYaw, this.player.aimPitch, opts);
    }
    if (this.state === 'intro' || this.state === 'menu') g.cameraRig.follow(dt, calf, calf.yaw, 0, {});
    // cloud sea wakes when skimming
  }

  /** Blossom petals from the Oasis trees, drifting on the breeze around the calf. */
  oasisPetals(dt) {
    const ch = this.path.chapters[this.chapterIndex];
    if (!ch || ch.id !== 'oasis' || !['play', 'paused', 'ending'].includes(this.state)) return;
    const g = this.game, calf = this.herd.calf;
    this.petalT = (this.petalT || 0) + dt;
    const wind = g.wind.base;
    while (this.petalT > 0.06) {
      this.petalT -= 0.06;
      const E = _pfx;
      E.pos.copy(calf.pos).add(_mOff.set((Math.random() - 0.5) * 90, (Math.random() - 0.2) * 45, (Math.random() - 0.5) * 90));
      E.vel.set(wind.x * 0.6 + (Math.random() - 0.5) * 1.5, -0.4 - Math.random() * 0.6, wind.z * 0.6 + (Math.random() - 0.5) * 1.5);
      // a real petal: a couple of centimetres, tumbling as it falls, lit through when backlit
      const pink = Math.random();
      E.life = 7 + Math.random() * 5; E.size = 0.035 + Math.random() * 0.02; E.sizeEnd = E.size;
      E.color[0] = 1.0; E.color[1] = lerp(0.72, 0.9, pink); E.color[2] = lerp(0.8, 0.9, pink);
      E.alpha = 0.95; E.drag = 0.15; E.gravity = 0; E.kind = 10; E.fadeIn = 1.2;
      g.mist.emit(E);
    }
  }

  waterfallMist(dt) {
    const g = this.game;
    const cam = g.engine.camera.position;
    this.mistT = (this.mistT || 0) + dt;
    if (this.mistT < 0.12) return;
    this.mistT = 0;
    for (const w of this.world.waterfalls) {
      if (!w.visible) continue;
      const lip = w.userData.lip;
      if (Math.abs(lip.x - cam.x) > 600 || Math.abs(lip.z - cam.z) > 600) continue;
      const out = w.userData.out;
      const drop = w.userData.drop;
      // churning spray where the fall meets the cloud ocean, plus a fine veil along it
      const k = Math.random();
      const y = lip.y - (0.55 + 0.45 * k) * drop;
      const E = _pfx;
      E.pos.copy(lip).addScaledVector(out, 4 + k * 10).add(_mOff.set((Math.random() - 0.5) * w.userData.width * 2, y - lip.y, (Math.random() - 0.5) * w.userData.width * 2));
      E.vel.set((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3);
      // the fall's spray billowing up as fine vapour, eroding into wisps on the breeze
      E.life = 4 + Math.random() * 2; E.size = w.userData.width * 1.0; E.sizeEnd = w.userData.width * (3.5 + Math.random());
      E.alpha = 0.3; E.drag = 0.4; E.gravity = -0.05; E.kind = 0; E.fadeIn = 0.8; E.color[0] = 1; E.color[1] = 1; E.color[2] = 1;
      g.mist.emit(E);
    }
  }

  updateAudio(dt) {
    const g = this.game, a = this.audio;
    if (!a || !a.update) return;
    a.update(dt);
    const calf = this.herd.calf;
    const wf = this.world.nearestWaterfall(calf.pos);
    const cam = g.engine.camera.position;
    const camH = cam.y - seaHeight(g, cam.x, cam.z);
    a.setAmbience?.({
      wind: clamp(0.25 + g.wind.strength / 18, 0, 1),
      rain: this.weather.rain,
      storm: this.weather.level,
      speed: calf.vel.length(),
      inCloud: Math.max(g.clouds.inCloud, g.clouds.playerInCloud),
      waterfall: wf && wf.dist < 400 ? { pos: wf.wf.userData.lip.clone().add(new Vector3(0, -Math.min(wf.wf.userData.drop * 0.5, 80), 0)), gain: 1 - wf.dist / 400 } : null,
      night: G.uNight.value,
      birds: this.chapterIndex >= 0 && this.chapterIndex < 4 ? 0.4 : this.chapterIndex === 9 ? 0.7 : 0.1,
      // the sea below: louder as the camera comes down to it, muffled once it slips under
      sea: 1 - smoothstep(8, 260, camH),
      seaState: clamp(g.ocean?.seaState ?? 0.25 + this.weather.level * 0.7, 0, 1),
      under: clamp(-camH / 1.2, 0, 1),
    });
    if (this.state === 'play') {
      const ch = this.path.chapters[this.chapterIndex];
      if (this.act === 1 && ch && (ch.mood === 'flight' || ch.mood === 'krill' || ch.mood === 'forest' || ch.mood === 'oasis')) a.setIntensity?.(Math.max(clamp(calf.vel.length() / 20, 0, 1), this.activities?.intensity ?? 0));
    }
  }

  onSongSuccess() {
    this.herd.calf.drive.happy = 1;
  }
}

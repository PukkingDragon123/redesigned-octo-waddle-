// Things to do while flying, told only through the world (no HUD, no score):
//  - flying bugs to catch and eat (src/creatures/bugs/SkyBugs.js): swarms placed along the route by
//    chapter and time of day, recycled as the herd moves on; the mouth opens by itself near them,
//    each catch sparkles, chimes up the chord with the combo, and gives energy;
//  - reactions to the calf's moves (src/game/Moves.js): playmates copy slaps, rolls and breaches,
//    the mother answers spouts and calls out when the calf is having fun;
//  - playmate races through living rings of lumen moths along the route;
//  - joy: catches and tricks build it, it decays; it shows as sparkle trails, the calf's smile,
//    the mother's happy calls, music stingers and `intensity` (for the score; see the report).
// Story creates it (new Activities(game, story)), calls update(dt) after updateCalf and reset().
import { Vector3 } from 'three';
import { clamp, lerp, smoothstep, TAU } from '../core/math.js';
import { G } from '../render/Globals.js';
import { SkyBugs, BUG_SPECIES } from '../creatures/bugs/SkyBugs.js';
import { seaHeight } from './Swim.js';

// ambient swarms per chapter: [moth, gnat, skitter]
const DENSITY = {
  cradle: [3, 2, 2], valleys: [4, 2, 2], krill: [2, 2, 3], forest: [5, 3, 1], song: [4, 2, 2],
  night: [5, 1, 1], storm: [0, 0, 0], falcon: [0, 1, 0], wall: [1, 0, 0], oasis: [5, 3, 3],
};
const RACE_CHAPTERS = new Set(['cradle', 'valleys', 'forest', 'song', 'oasis']);
const KINDS = ['moth', 'gnat', 'skitter'];

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _mouth = new Vector3();
const _tan = new Vector3();

export class Activities {
  constructor(game, story) {
    this.game = game;
    this.story = story;
    this.bugs = new SkyBugs(game);
    this.bugs.onCatch = (kind, x, y, z, S) => this.onCatch(kind, x, y, z, S);
    this.joy = 0;
    this.intensity = 0; // 0..1 how lively the music could be (Story may blend it in)
    this.combo = 0;
    this.lastCatch = -9;
    this.lastCatchSfx = -9;
    this.caught = { moth: 0, gnat: 0, skitter: 0 };
    this.spawnT = 0;
    this.momCallT = -99;
    this.milestone = 0;
    this.reactions = []; // scheduled playmate reactions { w, t, kind }
    this.race = null;
    this.raceCd = 45;
    this.raceCount = 0;
    this.r = 1;
    this._eater = { mouth: _mouth, fwd: new Vector3(), body: new Vector3(), speed: 0, open: 0 };
    this._em = { pos: new Vector3(), vel: new Vector3(), life: 1, size: 0.3, sizeEnd: 0.1, alpha: 1, drag: 1.2, gravity: 0, kind: 1, color: [1, 1, 1], fadeIn: 0.02 };
    this._col = {};
    for (const k of KINDS) { const c = this.bugs.kinds[k].glowCol; this._col[k] = [c.r, c.g, c.b]; }
    this.moves = story?.player?.moves || null;
    this.moves?.on((e) => this.onMove(e));
  }

  rand() { return Math.random(); }

  get herd() { return this.story?.herd; }

  reset() {
    this.bugs.clear();
    this.joy = 0;
    this.combo = 0;
    this.reactions.length = 0;
    this.endRace(false);
    this.raceCd = 45;
    this.milestone = 0;
    this.spawnT = 0;
    this.moves?.reset?.();
  }

  // ---- per frame ----------------------------------------------------------------------------
  update(dt) {
    const g = this.game, st = this.story, herd = this.herd;
    if (!herd) return;
    const calf = herd.calf;
    const playing = st.state === 'play';
    // spawning and recycling, twice a second
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 0.5; this.populate(); }
    // the calf's mouth: bugs right in front of it open it by itself
    const E = this._eater;
    E.fwd.copy(calf.fwd);
    E.body.copy(calf.pos);
    E.speed = calf.vel.length();
    _mouth.copy(calf.pos).addScaledVector(calf.fwd, calf.L * 0.5);
    E.open = playing ? calf.anim.mouth ?? calf.drive.mouth : 0;
    this.bugs.update(dt, playing ? E : null);
    if (playing && this.bugs.mouthWant > 0 && calf.drive.charge <= 0) {
      calf.drive.mouth = Math.max(calf.drive.mouth, 1);
      calf.drive.feed = Math.max(calf.drive.feed, 0.45);
    }
    // joy decays; it lights the calf up
    this.joy = Math.max(0, this.joy - dt * 0.05 * (1 + this.joy));
    if (this.moves) this.moves.joy = this.joy;
    if (this.joy > 0.2) calf.drive.happy = Math.max(calf.drive.happy, clamp(this.joy * 0.7, 0, 1));
    this.intensity = clamp(0.3 + this.joy * 0.4, 0, 1) * smoothstep(0, 0.25, this.joy);
    this._milestones();
    this._reactions(dt);
    if (playing) this._raceUpdate(dt);
    else if (this.race) this.endRace(false);
  }

  // ---- bugs -------------------------------------------------------------------------------------
  onCatch(kind, x, y, z, S) {
    const g = this.game, st = this.story, calf = this.herd.calf, def = BUG_SPECIES[kind];
    this.caught[kind]++;
    const now = g.time;
    this.combo = now - this.lastCatch < 2.2 ? this.combo + 1 : 0;
    this.lastCatch = now;
    calf.energy = Math.min(1, calf.energy + def.energy);
    calf.drive.happy = Math.max(calf.drive.happy, 0.85);
    this.joy += kind === 'gnat' ? 0.025 : 0.07;
    // sparkle and vanish
    const E = this._em, col = this._col[kind];
    const n = kind === 'gnat' ? 4 : 9;
    for (let i = 0; i < n; i++) {
      E.pos.set(x, y, z);
      E.vel.set((Math.random() - 0.5) * 3, (Math.random() - 0.2) * 3, (Math.random() - 0.5) * 3).addScaledVector(calf.vel, 0.6);
      E.life = 0.5 + Math.random() * 0.6; E.size = kind === 'gnat' ? 0.18 : 0.32; E.sizeEnd = 0.04; E.alpha = 1;
      E.drag = 2.5; E.gravity = -0.3; E.kind = 1; E.fadeIn = 0.01;
      E.color[0] = col[0] * 1.6; E.color[1] = col[1] * 1.6; E.color[2] = col[2] * 1.6;
      g.glow?.emit(E);
    }
    if (now - this.lastCatchSfx > 0.08) {
      this.lastCatchSfx = now;
      const a = st.audio;
      a?.sfx?.('bugCatch', { position: _v.set(x, y, z), gain: kind === 'gnat' ? 0.4 : 0.6, pitch: kind === 'gnat' ? 1.25 : kind === 'skitter' ? 0.9 : 1, step: this.combo });
      if (this.combo > 0 && this.combo % 5 === 4) a?.sfx?.('sparkle', { position: _v, gain: 0.6 });
    }
  }

  /** Keep swarms ahead of the herd, by chapter, time of day and weather; recycle the ones left behind. */
  populate() {
    const st = this.story, herd = this.herd, g = this.game;
    if (!herd || !st.path) return;
    const calf = herd.calf;
    const path = st.path;
    const ch = path.chapters[Math.max(0, st.chapterIndex)];
    const id = ch ? ch.id : 'cradle';
    const s0 = Math.max(herd.s, herd.calfS ?? herd.s);
    path.tangentAt(Math.min(path.length - 1, s0), _tan);
    // recycle
    for (const S of this.bugs.swarms) {
      if (!S.active || S.dying || S.shape === 'ring') continue;
      _v.copy(S.center).sub(calf.pos);
      const d = _v.length();
      if (d > 800 || (_v.dot(_tan) < -260 && d > 260) || (S.kind === 'skitter' && S.center.distanceTo(calf.pos) > 650)) this.bugs.release(S);
    }
    const dens = DENSITY[id] || DENSITY.cradle;
    const storm = clamp((st.weather?.level ?? 0) * 1.5, 0, 1);
    const night = G.uNight?.value ?? 0;
    let spawned = 0;
    const empty = this.bugs.countActive('moth') + this.bugs.countActive('gnat') + this.bugs.countActive('skitter') === 0;
    // the insects' day: lumen moths come out at dusk and night, gnats dance at dusk, skitterflies
    // hunt the shallows by day; in a storm everyone shelters in the island lee
    const dusk = clamp((0.3 - (G.uSunDir?.value.y ?? 0.5)) / 0.35, 0, 1) * (1 - night);
    const eve = Math.max(dusk, night);
    const tod = [0.25 + 0.75 * eve, 0.3 + 0.7 * dusk + 0.35 * night, 1 - 0.7 * night];
    for (let k = 0; k < 3; k++) {
      const kind = KINDS[k];
      let want = dens[k] + (k === 0 ? Math.round(night * 2) : 0);
      want = Math.round(want * tod[k] * (1 - storm));
      if (st.state === 'menu') want = Math.min(want, 2);
      const have = this.bugs.countActive(kind);
      if (have >= want) continue;
      // fill quickly when the sky is empty (chapter start), then one at a time
      const n = empty ? want - have : 1;
      for (let i = 0; i < n; i++) if (this.spawnOne(kind, s0, empty)) spawned++;
    }
    return spawned;
  }

  spawnOne(kind, s0, near) {
    const st = this.story, path = st.path, world = st.world, calf = this.herd.calf, g = this.game;
    const r = Math.random;
    const sA = clamp(s0 + (near ? lerp(-40, 420, r()) : lerp(220, 560, r())), 0, path.length - 1);
    const side = r() < 0.5 ? -1 : 1;
    const c = _v2;
    if (kind === 'moth') {
      // near the islands: perches (rock tops, ledges) close to the route ahead
      let placed = false;
      const P = world?.perches;
      if (P && P.length) {
        const pt = path.pointAt(sA, _v3);
        for (let tries = 0; tries < 24 && !placed; tries++) {
          const q = P[Math.floor(r() * P.length)];
          if (!q || !q.p) continue;
          const dd = q.p.distanceTo(pt);
          if (dd < 420 && q.p.distanceTo(calf.pos) > (near ? 40 : 160)) {
            c.copy(q.p).addScaledVector(q.n || _v.set(0, 1, 0), 5 + r() * 6);
            c.y += 3 + r() * 8;
            placed = true;
          }
        }
      }
      // no rock near: by the nearest island's shore, or not at all (no moths over the open sea)
      if (!placed && !this._shore(sA, c, 18, 70)) return false;
      const sea = seaHeight(g, c.x, c.z);
      c.y = Math.max(c.y, sea + 7 + r() * 8);
      return this.bugs.spawn('moth', c, { count: 18 + Math.floor(r() * 12), radius: 7 + r() * 5 });
    }
    if (kind === 'gnat') {
      // gnat clouds dance in the lee of islands, over meadows and in waterfall spray
      if (!this._shore(sA, c, 4, 40, true)) return false;
      c.y = Math.max(c.y, seaHeight(g, c.x, c.z) + 6 + r() * 10);
      return this.bugs.spawn('gnat', c, { count: 60 + Math.floor(r() * 36), radius: 3.5 + r() * 2.5 });
    }
    // skitterflies: ribbons skimming the shallows along a shore, sliding along the swell
    const isl = this._shore(sA, c, 6, 45);
    if (!isl) return false;
    const sea = seaHeight(g, c.x, c.z);
    c.y = sea;
    // drift along the shoreline (tangent to the island), a little in or out
    const ox = c.x - isl.pos.x, oz = c.z - isl.pos.z, ol = Math.hypot(ox, oz) || 1;
    const a = (r() - 0.5) * 0.7, sgn = side;
    const tx = -oz / ol * sgn, tz = ox / ol * sgn;
    const dir = _v3.set(tx * Math.cos(a) - tz * Math.sin(a), 0, tx * Math.sin(a) + tz * Math.cos(a));
    return this.bugs.spawn('skitter', c, { count: 26 + Math.floor(r() * 14), radius: 6 + r() * 4, dir, drift: 1.2 + r() * 1.5, seaY: sea });
  }

  /**
   * A spot by the shore of the island nearest the route at sA (within ~460 m), `out` metres off
   * its edge (lo..hi); `falls` prefers islands with waterfalls. Returns the island, or null.
   */
  _shore(sA, c, lo, hi, falls = false) {
    const st = this.story, isl = st.world?.islands;
    if (!isl || !isl.length) return null;
    const pt = st.path.pointAt(sA, _v);
    const calf = this.herd.calf;
    let best = null, bd = 460;
    for (const rec of isl) {
      if (!rec?.pos) continue;
      const R = rec.R || 40;
      let d = Math.hypot(rec.pos.x - pt.x, rec.pos.z - pt.z) - R;
      if (falls && rec.falls) d -= 120;
      if (d < bd) { bd = d; best = rec; }
    }
    if (!best) return null;
    const R = best.R || 40, r = Math.random;
    // the side of the island that faces the route, spread along the shore
    let ang = Math.atan2(pt.z - best.pos.z, pt.x - best.pos.x) + (r() - 0.5) * 1.6;
    const rr = R * 0.92 + lerp(lo, hi, r());
    c.set(best.pos.x + Math.cos(ang) * rr, 0, best.pos.z + Math.sin(ang) * rr);
    if (c.distanceTo(calf.pos) < 30) { ang += 0.8; c.set(best.pos.x + Math.cos(ang) * rr, 0, best.pos.z + Math.sin(ang) * rr); }
    c.y = seaHeight(this.game, c.x, c.z);
    return best;
  }

  // ---- moves -> world reactions -----------------------------------------------------------------
  onMove(e) {
    const st = this.story, herd = this.herd;
    if (!herd || st.state !== 'play') return;
    const calf = herd.calf;
    const near = (w, d) => w.pos.distanceTo(calf.pos) < d;
    switch (e.name) {
      case 'slap':
        this.joy += 0.15;
        this.bugs.scatter(e.pos, 22, 1);
        for (const c of herd.calves) if (near(c, 80)) this.schedule(c, 0.5 + Math.random() * 0.8, 'tailSlap');
        for (const w of herd.adults) if (w !== herd.mother && near(w, 90) && Math.random() < 0.35) this.schedule(w, 1 + Math.random() * 1.5, 'finSlap');
        break;
      case 'flick': case 'kick':
        this.joy += 0.04;
        break;
      case 'spout':
        this.joy += 0.08;
        if (near(herd.mother, 140)) this.schedule(herd.mother, 1.1 + Math.random() * 0.5, 'blow');
        for (const c of herd.calves) if (near(c, 70) && Math.random() < 0.6) this.schedule(c, 0.8 + Math.random(), 'blow');
        break;
      case 'bubbles': case 'puff':
        this.joy += 0.04;
        for (const c of herd.calves) if (near(c, 60)) this.schedule(c, 0.4 + Math.random() * 0.6, 'chirp');
        break;
      case 'loop':
        this.joy += 0.25 * e.power;
        for (const c of herd.calves) if (near(c, 80)) this.schedule(c, 0.3 + Math.random() * 0.7, Math.random() < 0.5 ? 'roll' : 'wiggle');
        break;
      case 'corkscrew':
        this.joy += 0.06 * e.chain;
        break;
      case 'dash':
        this.joy += 0.04;
        break;
      case 'diveBomb':
        this.joy += 0.25;
        this.bugs.scatter(e.pos, 25, 1);
        for (const c of herd.calves) if (near(c, 90)) this.schedule(c, 0.6 + Math.random(), 'wiggle');
        break;
      case 'breach':
        this.joy += 0.3 * e.power;
        for (const c of herd.calves) if (near(c, 100)) this.schedule(c, 0.4 + Math.random() * 0.8, 'breachArch');
        if (near(herd.mother, 160)) this.schedule(herd.mother, 1.2, 'answer');
        break;
      case 'breachSpin':
        this.joy += 0.3;
        this.story.audio?.sfx?.('sparkle', { position: e.pos, gain: 0.8 });
        break;
      case 'splashdown':
        this.joy += 0.08;
        break;
    }
  }

  schedule(w, t, kind) {
    if (this.reactions.length > 24) return;
    this.reactions.push({ w, t, kind });
  }

  _reactions(dt) {
    const st = this.story, R = this.reactions;
    for (let i = R.length - 1; i >= 0; i--) {
      const r = R[i];
      r.t -= dt;
      if (r.t > 0) continue;
      R.splice(i, 1);
      const w = r.w;
      if (!w || (w.beh && w.beh.netI >= 0)) continue;
      switch (r.kind) {
        case 'tailSlap': case 'finSlap': case 'breachArch':
          w.anim?.gesture?.(r.kind, { speed: w.isCalf ? 1.4 : 1 });
          w.drive.happy = 1;
          if (w.isCalf && Math.random() < 0.5) st.voiceCall?.(w, 'play');
          break;
        case 'blow':
          if (w.water && Math.abs(w.water.depth) < w.radius * 2.5) w.blow?.(this.game, 1);
          else w.anim?.breathe?.(0.6);
          if (w === this.herd.mother) st.voiceCall?.(w, 'coo');
          break;
        case 'chirp':
          st.voiceCall?.(w, 'chirp');
          w.drive.happy = 1;
          break;
        case 'roll':
          w.barrelRoll?.(Math.random() < 0.5 ? 1 : -1);
          w.drive.happy = 1;
          st.voiceCall?.(w, 'play');
          break;
        case 'wiggle':
          w.anim?.gesture?.('happyWiggle');
          w.drive.happy = 1;
          break;
        case 'answer':
          st.voiceCall?.(w, 'answer');
          w.anim?.gesture?.('happyWiggle');
          w.drive.happy = 1;
          break;
      }
    }
  }

  /** Joy thresholds: the mother calls out, the score answers. */
  _milestones() {
    const st = this.story, herd = this.herd, g = this.game;
    const lv = this.joy > 2 ? 3 : this.joy > 1.2 ? 2 : this.joy > 0.6 ? 1 : 0;
    if (lv > this.milestone && g.time - this.momCallT > 14 && st.state === 'play') {
      this.momCallT = g.time;
      const mom = herd.mother;
      if (mom.pos.distanceTo(herd.calf.pos) < 220) this.schedule(mom, 0.4, 'answer');
      if (lv >= 2) st.audio?.stinger?.(lv >= 3 ? 'harmony' : 'discover');
    }
    if (lv < this.milestone - 1 || lv === 0) this.milestone = lv;
    else this.milestone = Math.max(this.milestone, lv);
    this.joy = Math.min(this.joy, 3);
  }

  // ---- playmate races through moth rings -----------------------------------------------------
  _raceUpdate(dt) {
    const st = this.story, herd = this.herd;
    if (!this.race) {
      this.raceCd -= dt;
      if (this.raceCd > 0) return;
      this.raceCd = 8; // try again soon if the moment is not right
      const ch = st.path.chapters[st.chapterIndex];
      if (!ch || !RACE_CHAPTERS.has(ch.id) || herd.mode !== 'travel' || herd.motherScript) return;
      if ((this.game.timeScaleTarget ?? 1) !== 1 || (st.weather?.level ?? 0) > 0.3) return;
      const calf = herd.calf;
      if (calf.water && calf.water.depth > -1) return;
      let mate = null, best = 160;
      for (const c of herd.calves) {
        if (c.play || (c.beh && c.beh.type)) continue;
        const d = c.pos.distanceTo(calf.pos);
        if (d < best) { best = d; mate = c; }
      }
      if (!mate) return;
      this.startRace(mate);
      return;
    }
    const R = this.race, calf = herd.calf, c = R.mate;
    R.t += dt;
    if (!c.play || c.play.mode !== 'race') { this.endRace(false); return; }
    if (R.phase === 'come') {
      // the playmate swims up beside the calf, chirps and spins: catch me!
      _v.copy(calf.pos).addScaledVector(calf.right, 6).addScaledVector(calf.fwd, 5);
      _v.y = Math.max(_v.y, herd.floorY(c, _v.x, _v.z));
      const d = herd.steer(c, _v, Math.max(10, calf.vel.length() + 5), dt, this._steerOpts(4, 4));
      c.drive.lookAt = calf.pos;
      c.drive.excite = 1;
      if (d < 14 || R.t > 7) {
        R.phase = 'race';
        R.t = 0;
        st.voiceCall?.(c, 'play');
        c.anim?.gesture?.('happyWiggle');
        c.barrelRoll(1);
        this.spawnCourse(R);
      }
      return;
    }
    // the race: the playmate flies the course, rubber-banded to the calf
    const rings = R.rings;
    if (R.mateI < rings.length) {
      const ring = rings[R.mateI];
      const ahead = c.pos.distanceTo(calf.pos);
      const lead = _v2.copy(c.pos).sub(calf.pos).dot(c.fwd);
      const speed = lead > 25 ? 7.5 : lead < -5 ? 16 : clamp(calf.vel.length() + 1.5, 9, 15);
      _v.copy(ring.c).addScaledVector(ring.n, 3);
      const d = herd.steer(c, _v, speed, dt, this._steerOpts(1, 6));
      c.drive.excite = 1;
      c.drive.lookAt = ahead > 30 ? calf.pos : null;
      if (d < 4.5) {
        R.mateI++;
        if (Math.random() < 0.4) c.barrelRoll(Math.random() < 0.5 ? 1 : -1);
      }
    } else {
      // done: hover nearby, watching
      _v.copy(calf.pos).addScaledVector(calf.right, -8);
      _v.y = Math.max(_v.y, herd.floorY(c, _v.x, _v.z));
      herd.steer(c, _v, Math.max(6, calf.vel.length()), dt, this._steerOpts(8, 2));
      c.drive.lookAt = calf.pos;
    }
    // the calf through its rings
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      if (ring.passed || !ring.S.active) continue;
      _v.copy(calf.pos).sub(ring.c);
      const side = _v.dot(ring.n);
      const lat = Math.sqrt(Math.max(0, _v.lengthSq() - side * side));
      if (ring.last < 0 && side >= 0 && lat < ring.r * 1.35) this.passRing(R, ring);
      ring.last = side;
    }
    if (R.passed >= rings.length) { this.endRace(true); return; }
    if (R.t > 60 || calf.pos.distanceTo(rings[rings.length - 1].c) > 900) this.endRace(false);
  }

  _steerOpts(arrive, minSpeed) {
    const o = this._so || (this._so = { arrive: 4, minSpeed: 4, pitchGain: 1.0, maxPitch: 0.75, sepScale: 0.4, touch: null });
    o.arrive = arrive;
    o.minSpeed = minSpeed;
    o.touch = this.herd.calf;
    return o;
  }

  startRace(mate) {
    mate.play = { mode: 'race', t: 0 };
    this.herd.behaviors?.end?.(mate);
    this.race = { mate, phase: 'come', t: 0, rings: [], mateI: 0, passed: 0 };
    this.raceCount++;
    this.story.voiceCall?.(mate, 'chirp');
  }

  spawnCourse(R) {
    const st = this.story, path = st.path, herd = this.herd, calf = herd.calf, g = this.game;
    const s0 = herd.calfS ?? herd.s;
    path.tangentAt(s0, _tan);
    const n = 5;
    let lat = 0;
    for (let i = 0; i < n; i++) {
      const s = Math.min(path.length - 1, s0 + 55 + i * 48);
      lat = clamp(lat + (Math.random() - 0.5) * 30, -35, 35);
      const c = path.offsetAt(s, lat, (i % 2 ? 6 : -4) + Math.random() * 6, 0, new Vector3());
      // the first ring sits where the calf is heading
      if (i === 0) c.copy(calf.pos).addScaledVector(calf.fwd, 45).lerp(c, 0.5);
      c.y = Math.max(c.y, seaHeight(g, c.x, c.z) + 9);
      const nrm = new Vector3();
      if (i === 0) nrm.copy(c).sub(calf.pos); else nrm.copy(c).sub(R.rings[i - 1].c);
      nrm.y *= 0.5;
      nrm.normalize();
      const S = this.bugs.spawn('moth', c, { shape: 'ring', count: 20, ringR: 5.5, normal: nrm, tag: 'race', life: 70 });
      if (!S) break;
      R.rings.push({ c, n: nrm, r: 5.5, S, passed: false, last: -1 });
    }
    if (!R.rings.length) this.endRace(false);
  }

  passRing(R, ring) {
    const g = this.game, st = this.story, calf = this.herd.calf;
    ring.passed = true;
    R.passed++;
    this.joy += 0.2;
    // the ring bursts into a halo of sparks and the moths scatter
    this.bugs.scatter(ring.c, ring.r * 2.2, 1.3);
    ring.S.life = ring.S.age + 1.6;
    const E = this._em;
    _v.set(0, 1, 0).cross(ring.n);
    if (_v.lengthSq() < 1e-6) _v.set(1, 0, 0);
    _v.normalize();
    _v2.copy(ring.n).cross(_v).normalize();
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU;
      E.pos.copy(ring.c).addScaledVector(_v, Math.cos(a) * ring.r).addScaledVector(_v2, Math.sin(a) * ring.r);
      E.vel.copy(_v).multiplyScalar(Math.cos(a) * 3).addScaledVector(_v2, Math.sin(a) * 3).addScaledVector(ring.n, 2);
      E.life = 0.9 + Math.random() * 0.5; E.size = 0.35; E.sizeEnd = 0.05; E.alpha = 1; E.drag = 1.6; E.gravity = 0.2; E.kind = 1;
      E.color[0] = 1.6; E.color[1] = 1.3; E.color[2] = 0.7;
      g.glow?.emit(E);
    }
    st.audio?.sfx?.('trick', { position: ring.c, gain: 0.8, step: R.passed });
    // a speed ring: a little push forward
    calf.vel.addScaledVector(calf.fwd, 3);
    calf.drive.happy = 1;
  }

  endRace(won) {
    const R = this.race;
    if (!R) return;
    this.race = null;
    this.raceCd = 80 + Math.random() * 50;
    for (const ring of R.rings) if (ring.S.active && !ring.passed) this.bugs.release(ring.S);
    const c = R.mate;
    if (c && c.play && c.play.mode === 'race') c.play = null;
    if (!won) return;
    const st = this.story, herd = this.herd, calf = herd.calf, g = this.game;
    this.joy += 0.6;
    st.audio?.stinger?.('harmony');
    st.audio?.sfx?.('sparkle', { position: calf.pos, gain: 1 });
    st.voiceCall?.(c, 'chirp');
    c.anim?.gesture?.('happyWiggle');
    c.barrelRoll(-1);
    calf.anim?.gesture?.('happyWiggle');
    if (herd.mother.pos.distanceTo(calf.pos) < 250) this.schedule(herd.mother, 0.8, 'answer');
    const E = this._em;
    for (let i = 0; i < 60; i++) {
      E.pos.copy(calf.pos);
      E.vel.set((Math.random() - 0.5) * 8, Math.random() * 7, (Math.random() - 0.5) * 8).addScaledVector(calf.vel, 0.5);
      E.life = 1.2 + Math.random(); E.size = 0.3; E.sizeEnd = 0.05; E.alpha = 1; E.drag = 1.2; E.gravity = 1.5; E.kind = 1;
      E.color[0] = 1.5; E.color[1] = 1.2; E.color[2] = 0.8;
      g.glow?.emit(E);
    }
  }
}

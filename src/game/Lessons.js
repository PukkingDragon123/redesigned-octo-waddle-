// Lessons from the mother (docs/VUR_SOK.md 0.11): wordless things the calf does WITH her during the
// migration, told only through her body, her voice, the camera and the music (no text, no HUD).
//  - COPY ME: she swims up into view, turns her head to the calf and calls, then shows a move with a
//    clear wind-up (a barrel roll, a tail flick or slap, a spout, a loop). The calf copying it (Moves.js
//    events, the player's rolls) earns a duet hum, her nuzzle and a burst of joy; she escalates to two
//    and then three moves. A miss: she shows it once more, slower; then a coo and no more (no fail).
//  - TAG: she slips right up beside the calf, wiggles, taps it with her flipper and rolls away; she
//    weaves around a sea stack (or along the route), glancing back and easing off when it lags. Catch
//    her and she squeals, turns and gives chase; a caught calf gets nuzzled, an escaped one laughed at.
//  - DISCOVERY: she stops, lifts her head toward something wondrous near the route (a waterfall
//    pouring off an island into the sea, a plankton bloom glowing at night), calls and leads a short
//    detour; when the calf joins her there a short in-engine camera glide (Cinematics.js) frames the
//    pair before it while she hums a phrase and the calf answers.
//  - HUNTING: over a school near the surface she calls, glides low over it, dives beneath and circles
//    blowing a spiral curtain of bubbles until the fish ball up (eco.bubbleNet), then holds under it
//    and calls the calf in: a lunge (B) through the ball is a big mouthful. She finishes the ball with
//    a rising lunge of her own.
// Something mother-led about every 45-90 s of free flight in ACT I; never during cinematics, songs,
// races, the bubble-net feast, storms or the falcon, and never while the calf is busy eating. A lesson
// owns the mother through herd.motherScript and steps aside the moment anyone else takes her.
// Activities creates it (new Lessons(game, story, activities)) and calls update(dt) and reset().
// Story.updateCalf reads `camHint` ({ pos, w, max } or null) as a gentle look bias for the camera.
//
// Testing: `story.activities.lessons.start('copy' | 'tag' | 'discover' | 'hunt')` forces one now (it
// returns false when the moment does not allow it); `.log` lists what happened. With ?auto the
// autopilot copies her moves and bites in the bait ball by itself.
import { Vector3 } from 'three';
import { clamp, lerp, TAU, wrapAngle, dirFromYawPitch } from '../core/math.js';
import { G } from '../render/Globals.js';
import { Script } from './Script.js';
import { seaHeight } from './Swim.js';

const FREE = new Set(['cradle', 'valleys', 'krill', 'forest', 'song', 'night', 'oasis']);
// Moves.js events -> the move the calf just made
const COPY = { slap: 'slap', flick: 'slap', kick: 'slap', spout: 'spout', puff: 'spout', bubbles: 'spout', loop: 'loop' };
const UP = new Vector3(0, 1, 0);

const _v = new Vector3();
const _v2 = new Vector3();
const _f = new Vector3();
const _r = new Vector3();
const _body = new Vector3();

export class Lessons {
  constructor(game, story, act) {
    this.game = game;
    this.story = story;
    this.act = act;
    this.script = new Script();
    this.cur = null; // the lesson in progress: { kind, t, side, ... }
    this.cd = 28; // seconds of free flight before the next one
    this.camHint = null;
    this._hint = { pos: new Vector3(), w: 0.25, max: 6 };
    // what the mother is told to do this frame (herd.motherScript returns it)
    this.ms = { target: new Vector3(), speed: 8, arrive: 8, minSpeed: 0, lookAt: null, maxPitch: 0.6, pitchGain: 0.8, face: null };
    this._ms = (m, dt) => this._mom(m, dt);
    this.loop = null; // her loop in progress (she flies it by hand, like the calf's in Moves.js)
    this.expect = null; // copy me: the moves she waits for { seq, i, done }
    this.ownCine = false;
    this.order = ['copy', 'tag', 'copy', 'discover', 'hunt', 'tag'];
    this.next = 0;
    this.seen = new Set(); // discovery targets already visited
    this.stats = { copy: 0, tag: 0, discover: 0, hunt: 0, copied: 0, rounds: 0, caught: 0, found: 0, fed: 0, aborted: 0 };
    this.log = [];
    this._lastCalf = new Vector3();
    this._course = [];
    for (let i = 0; i < 8; i++) this._course.push(new Vector3());
    this.firstCopy = true;
    const P = story?.player;
    P?.moves?.on((e) => { const k = COPY[e.name]; if (k) this.onCalfMove(k); });
    P?.on?.('roll', () => this.onCalfMove('roll'));
  }

  get herd() { return this.story?.herd; }

  note(s) {
    this.log.push(`${this.game.time.toFixed(1)} ${s}`);
    if (this.log.length > 80) this.log.shift();
  }

  reset() {
    if (this.cur) this.stop('reset');
    this.cd = 28;
  }

  // ---- scheduling ----------------------------------------------------------------------------
  /** Free flight with nothing else going on: the moment for her to start something. */
  free() {
    const S = this.story, herd = this.herd, g = this.game, A = this.act;
    if (!herd || S.state !== 'play' || S.act !== 1 || S.cine?.active) return false;
    if (herd.mode !== 'travel' || herd.motherScript || herd.songCenter || herd.protectCenter || herd.behaviors?.net) return false;
    if (herd.care && herd.care.mode !== 'lead') return false;
    if (A?.race || herd.calves.some((c) => c.play && c.play.mode)) return false;
    if (S.song?.active || S.song?.listening || S.player?.humming || S.player?.charging || S.feastInvite) return false;
    if ((g.timeScaleTarget ?? 1) !== 1 || (S.weather?.level ?? 0) > 0.3) return false;
    // busy eating: a swarm in reach, a mouthful just taken, a lunge
    const now = g.time;
    if (A && (now - A.lastCatch < 4 || now - A.biteT < 3 || (A.hunt && A.hunt.t >= 0) || A.bugs?.mouthWant > 0)) return false;
    // the hunger builder's mother-leads-to-food (src/game/Needs.js), whatever it calls it
    const N = S.needs || A?.needs;
    if (N && (N.busy || N.leading || N.lead || N.nurse)) return false;
    const ch = S.path?.chapters[S.chapterIndex];
    if (!ch || !FREE.has(ch.id)) return false;
    const nx = S.path.chapters[S.chapterIndex + 1];
    if (nx && herd.s > nx.start - 260) return false;
    if (now - (S.chapterStartT ?? 0) < 10) return false;
    const calf = herd.calf;
    if (calf.pos.distanceTo(herd.mother.pos) > 110) return false;
    if (calf.water && calf.water.depth > 0.5 && calf.water.air < 0.7) return false;
    return true;
  }

  update(dt) {
    const herd = this.herd, S = this.story;
    if (!herd) return;
    const calf = herd.calf;
    const jumped = calf.pos.distanceTo(this._lastCalf) > 60;
    this._lastCalf.copy(calf.pos);
    if (this.cur) {
      this.cur.t += dt;
      // someone else took her, or the story moved on: step aside at once
      const why = herd.motherScript !== this._ms ? 'taken' : S.state !== 'play' && S.state !== 'paused' ? 'state'
        : herd.mode !== 'travel' ? 'mode' : (S.cine?.active && !this.ownCine) ? 'cinematic' : jumped ? 'cut'
          : calf.pos.distanceTo(herd.mother.pos) > 190 ? 'far' : this.cur.t > 120 ? 'long' : null;
      if (why) { this.stop(why); return; }
      if (S.state === 'paused') return;
      this.script.update(dt);
      if (this.cur && !this.script.tasks.length) this.stop('done');
      return;
    }
    this.camHint = null;
    if (!this.free()) return;
    this.cd -= dt;
    if (this.cd > 0) return;
    // the next lesson the moment allows (place-bound ones only where their place is)
    // a hungry calf is led to food (Needs.js): only the hunting lesson then
    const hungry = (S.needs?.hunger ?? 0) > 0.4;
    for (let k = 0; k < this.order.length; k++) {
      const kind = this.order[(this.next + k) % this.order.length];
      if (hungry && kind !== 'hunt') continue;
      if (this.start(kind)) { this.next = (this.next + k + 1) % this.order.length; return; }
    }
    this.cd = 8;
  }

  /** Begin a lesson now (tests may call it). Returns false if this one has nowhere or no way to happen. */
  start(kind) {
    const herd = this.herd, S = this.story;
    if (!herd || this.cur || S.state !== 'play') return false;
    const m = herd.mother, calf = herd.calf;
    const L = { kind, t: 0, side: this._sideOf(m) };
    let gen = null;
    if (kind === 'copy') gen = this._copy(L);
    else if (kind === 'tag') gen = this._tag(L);
    else if (kind === 'discover') {
      L.place = this._findWonder();
      if (!L.place) return false;
      gen = this._discover(L);
    } else if (kind === 'hunt') {
      L.school = this._findSchool();
      if (!L.school) return false;
      gen = this._hunt(L);
    }
    if (!gen) return false;
    if (herd.motherScript && herd.motherScript !== this._ms) return false;
    this.cur = L;
    this.stats[kind]++;
    herd.motherScript = this._ms;
    m.playT = 999; // no idle rolls of her own while she is showing one
    this.ms.target.copy(m.pos).addScaledVector(m.vel, 1);
    this.ms.speed = Math.max(6, m.vel.length());
    this.ms.lookAt = calf.pos;
    this.ms.face = null;
    this.script.run(gen, kind);
    this.note(`start ${kind}`);
    return true;
  }

  /** End the lesson (finished, or someone else needs her), handing her back to the herd. */
  stop(why = 'done') {
    const L = this.cur, herd = this.herd, S = this.story;
    if (!L) return;
    this.cur = null;
    this.script.cancel();
    this.expect = null;
    this.camHint = null;
    if (this.loop) this._endLoop(herd.mother);
    if (L.auto && S.player) S.player.autopilot = L.auto;
    if (L.net) { S.eco?.stopBubbleNet?.(L.net); L.net = null; }
    if (this.ownCine) { this.ownCine = false; if (S.cine?.active) S.cine.end(); }
    if (herd.motherScript === this._ms) herd.motherScript = null;
    herd.mother.playT = lerp(35, 90, Math.random());
    if (why !== 'done') this.stats.aborted++;
    // the next one after a while of free flight (sooner after one that was cut short)
    this.cd = why === 'done' ? lerp(45, 80, Math.random()) : lerp(20, 35, Math.random());
    this.note(`end ${L.kind} (${why})`);
  }

  // ---- the mother's steering --------------------------------------------------------------------
  _mom(m, dt) {
    if (!this.cur) return null;
    if (this.loop) return this._loopStep(m, dt);
    return this.ms;
  }

  /** Steer her toward p at a speed, arriving softly (lookAt: her gaze; undefined keeps it). */
  _go(p, speed, arrive = 8, minSpeed = 0, lookAt) {
    const s = this.ms;
    s.target.copy(p);
    s.speed = speed;
    s.arrive = arrive;
    s.minSpeed = minSpeed;
    s.maxPitch = 0.6;
    s.pitchGain = 0.8;
    s.face = null;
    if (lookAt !== undefined) s.lookAt = lookAt;
    return this.herd.mother.pos.distanceTo(p);
  }

  /** The calf's view: flat forward and side directions from where the player is looking. */
  _view() {
    const P = this.story.player, calf = this.herd.calf;
    const yaw = P ? P.aimYaw : calf.yaw;
    _f.set(Math.sin(yaw), 0, Math.cos(yaw));
    _r.crossVectors(_f, UP).normalize();
  }

  _sideOf(m) {
    this._view();
    return _v.copy(m.pos).sub(this.herd.calf.pos).dot(_r) >= 0 ? 1 : -1;
  }

  /**
   * Hold her in view to show the calf something: ahead of it and off to one side (the side she is
   * already on), at its height, matching its pace. Returns her distance from that spot.
   */
  _show(side, lookAt) {
    const herd = this.herd, m = herd.mother, calf = herd.calf;
    this._view();
    const p = _v2.copy(calf.pos).addScaledVector(_f, m.L * 0.75 + 12).addScaledVector(_r, side * (m.radius * 1.4 + 9));
    p.y = calf.pos.y + 3;
    p.addScaledVector(calf.vel, 0.5);
    p.y = Math.max(p.y, herd.floorY(m, p.x, p.z));
    const d = m.pos.distanceTo(p);
    const cs = Math.max(0, calf.vel.dot(_f));
    return this._go(p, 4 + d * 0.25, 10, Math.max(3, cs * 0.85), lookAt) || d;
  }

  /** Distance from the calf to the nearest point of her body (touching is ~ radius sum). */
  _reach() {
    const m = this.herd.mother, calf = this.herd.calf;
    if (m.nearestOnBody) { m.nearestOnBody(calf.pos, _body); return calf.pos.distanceTo(_body) - calf.radius; }
    return calf.pos.distanceTo(m.pos) - m.radius - calf.radius;
  }

  _hintAt(p, w = 0.25, max = 6) {
    const h = this._hint;
    h.pos.copy(p);
    h.w = w;
    h.max = max;
    this.camHint = h;
  }

  // ---- her loop (flown by hand, as the calf's in Moves.js) ----------------------------------------
  _startLoop(m) {
    const speed = Math.max(m.vel.length(), 15);
    this.loop = { t: 0, dur: 6.2, p0: clamp(m.pitch, -0.3, 0.3), yaw: m.yaw, speed, saved: m.phys.maxPitch };
    m.phys.maxPitch = 100;
    this.story.audio?.sfx?.('whoosh', { position: m.pos, gain: 0.6, pitch: 0.6 });
  }

  _loopStep(m, dt) {
    const c = this.loop;
    c.t += dt;
    const u = clamp(c.t / c.dur, 0, 1);
    const pitch = c.p0 + TAU * (u - Math.sin(TAU * u) * 0.12);
    m.pitch = pitch;
    m.pitchRate = 0;
    m.yaw = c.yaw;
    m.yawRate = 0;
    m.ctl.targetPitch = pitch;
    m.ctl.targetYaw = c.yaw;
    m.ctl.thrust = 1;
    m.ctl.brake = 0;
    dirFromYawPitch(c.yaw, pitch, _v);
    m.vel.copy(_v).multiplyScalar(c.speed * (1 - 0.18 * Math.sin(Math.PI * u)));
    m.drive.effort = 1;
    m.drive.excite = 1;
    if (u >= 1) this._endLoop(m);
    return null;
  }

  _endLoop(m) {
    const c = this.loop;
    if (!c) return;
    this.loop = null;
    m.phys.maxPitch = c.saved;
    m.pitch = clamp(wrapAngle(m.pitch), -c.saved, c.saved);
    m.ctl.targetPitch = m.pitch;
  }

  // ---- COPY ME ----------------------------------------------------------------------------------
  /** A move the calf made (Moves events and rolls): does it match what she is waiting for? */
  onCalfMove(kind) {
    const E = this.expect;
    if (!E || E.done) return;
    if (kind !== E.seq[E.i]) return; // a different move: she just keeps waiting
    E.i++;
    E.bonus += 2;
    const S = this.story, m = this.herd.mother, calf = this.herd.calf;
    calf.drive.happy = 1;
    m.drive.happy = 1;
    if (E.i >= E.seq.length) { E.done = true; return; }
    // one right, more to go: a little nod and a soft sound of approval
    m.anim.sHeadPitch?.impulse?.(1.2);
    S.voiceCall(m, 'coo');
    S.audio?.sfx?.('chime', { position: calf.pos, gain: 0.3, pitch: 1 + E.i * 0.12 });
  }

  _pickSeq(round) {
    const calf = this.herd.calf;
    const pool = ['roll', 'slap', 'spout'];
    // a loop needs the open air (and the calf up in it)
    if (round > 1 && (!calf.water || calf.water.depth < -calf.radius * 3)) pool.push('loop');
    const seq = [];
    if (this.firstCopy) { seq.push('roll'); this.firstCopy = false; }
    while (seq.length < round) {
      const k = pool[Math.floor(Math.random() * pool.length)];
      if (k === seq[seq.length - 1] || (k === 'loop' && seq.includes('loop'))) continue;
      seq.push(k);
    }
    return seq;
  }

  /** Hold her place in view for sec seconds (watching lookAt). */
  *_hold(L, sec, lookAt) {
    let t = 0;
    while (t < sec) {
      if (!this.loop) this._show(L.side, lookAt);
      this._hintAt(this.herd.mother.pos, 0.28, 5);
      t += yield 0;
    }
  }

  /** One move, with its wind-up. slow: the patient second showing. */
  *_demo(L, move, slow) {
    const S = this.story, g = this.game, m = this.herd.mother, a = m.anim;
    const k = slow ? 1.4 : 1;
    // her eyes leave the calf for the move itself
    if (move === 'roll') {
      // a dip of the head and a flare of the fins, then a slow, full barrel roll
      a.sHeadPitch?.impulse?.(1.4);
      a.sFinFlare?.impulse?.(6);
      yield* this._hold(L, 0.55 * k, null);
      m.barrelRoll(-L.side);
      S.audio?.sfx?.('whoosh', { position: m.pos, gain: 0.45, pitch: 0.55 });
      let t = 0;
      while (m.rollSpin > 0 && t < 5) { this._show(L.side, null); this._hintAt(m.pos, 0.28, 5); t += yield 0; }
    } else if (move === 'slap') {
      // the head lifts, the flukes rise... and flick down (a slap if she is low over the sea)
      a.sHeadPitch?.impulse?.(-1.6);
      yield* this._hold(L, 0.45 * k, null);
      a.gesture?.('tailSlap', { speed: slow ? 0.95 : 1.15 });
      const dur = a.gest ? a.gest.dur : 3.3;
      let t = 0, hit = false;
      while (t < dur) {
        if (!hit && t > dur * 0.66) {
          hit = true;
          _v.copy(m.pos).addScaledVector(m.fwd, -m.L * 0.46);
          S.audio?.sfx?.('whoosh', { position: _v, gain: 0.55, pitch: 0.7 });
          g.cameraRig?.addShake?.(0.04);
        }
        this._show(L.side, null);
        this._hintAt(m.pos, 0.28, 5);
        t += yield 0;
      }
    } else if (move === 'spout') {
      // a long breath in, the head up, then the blow
      a.sHeadPitch?.impulse?.(-2.2);
      a.sFinFlare?.impulse?.(3);
      yield* this._hold(L, 0.8 * k, null);
      const p = m.blow ? m.blow(g, 1.3) : m.pos;
      S.audio?.sfx?.('spout', { position: p, gain: 0.85 });
      yield* this._hold(L, 1.6, null);
    } else if (move === 'loop') {
      // a surge and the nose lifting, then a tall loop
      a.sHeadPitch?.impulse?.(-2);
      m.vel.addScaledVector(m.fwd, 3);
      yield* this._hold(L, 0.6 * k, null);
      this._startLoop(m);
      while (this.loop) { this._hintAt(m.pos, 0.3, 6); yield 0; }
    }
  }

  /** The calf's turn: she watches it, drifting beside it. True if it copied the whole sequence. */
  *_waitCopy(L, seq) {
    const S = this.story, herd = this.herd, calf = herd.calf;
    const E = this.expect || (this.expect = { seq, i: 0, done: false, bonus: 0 });
    E.seq = seq;
    let t = 0, auto = 1.1, ai = E.i, nudged = false;
    const win = 5.5 + seq.length * 2.5;
    while (t < win + E.bonus && !E.done) {
      const dt = yield 0;
      t += dt;
      this._show(L.side, calf.pos);
      this._hintAt(herd.mother.pos, 0.18, 4);
      // halfway through, a soft prompting call
      if (!nudged && t > win * 0.5 && E.i === 0) { nudged = true; S.voiceCall(herd.mother, 'coo'); }
      // headless testing: the autopilot copies her
      if (S.autoplay && ai < seq.length) {
        auto -= dt;
        if (auto <= 0) { this._autoMove(seq[ai++]); auto = 1.4; }
      }
    }
    this.expect = null;
    return E.done;
  }

  _autoMove(k) {
    const P = this.story.player, calf = this.herd.calf, mv = P?.moves;
    const sea = seaHeight(this.game, calf.pos.x, calf.pos.z);
    if (k === 'roll') { if (calf.barrelRoll(1)) P.emit('roll', 1); } else if (k === 'slap') mv?.slap(sea);
    else if (k === 'spout') { if (mv) mv.cd.spout = 0; mv?.spout(sea); } else if (k === 'loop') mv?.loop();
  }

  *_copy(L) {
    const S = this.story, herd = this.herd, m = herd.mother, calf = herd.calf;
    // she comes up into view beside the calf
    let t = 0;
    while (t < 10) {
      const d = this._show(L.side, calf.pos);
      this._hintAt(m.pos, 0.2, 4);
      if ((d < 22 && t > 1.5) || t > 6) break;
      t += yield 0;
    }
    for (let round = 1; round <= 3; round++) {
      const seq = this._pickSeq(round);
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        // watch me: her head turns to the calf, a call, a beat with their eyes on each other
        S.voiceCall(m, attempt ? 'coo' : 'answer');
        m.anim.sFinFlare?.impulse?.(4);
        yield* this._hold(L, attempt ? 1.6 : 1.2, calf.pos);
        this.note(`copy round ${round}${attempt ? ' again' : ''}: ${seq.join(' ')}`);
        for (let i = 0; i < seq.length; i++) {
          // the calf may join in from the last move on
          if (i === seq.length - 1) this.expect = { seq, i: 0, done: false, bonus: 0 };
          yield* this._demo(L, seq[i], attempt > 0);
          if (i < seq.length - 1) yield* this._hold(L, attempt ? 1.0 : 0.6, calf.pos);
        }
        ok = yield* this._waitCopy(L, seq);
      }
      if (!ok) {
        // no matter: a soft coo, a nuzzle anyway, and she takes the lead again
        S.voiceCall(m, 'coo');
        yield* this._nuzzle(2.2);
        return;
      }
      this.stats.copied++;
      this.stats.rounds = Math.max(this.stats.rounds, round);
      this.note(`copied round ${round}`);
      yield* this._praise(round, round === 3);
    }
  }

  /** The calf did it: a duet, her nuzzle and a burst of joy (bigger each round). */
  *_praise(level, finale) {
    const S = this.story, herd = this.herd, m = herd.mother, calf = herd.calf, A = this.act;
    m.drive.happy = 1;
    calf.drive.happy = 1;
    m.anim.gesture?.('happyWiggle');
    calf.anim.gesture?.('happyWiggle');
    if (A) A.joy += 0.3 + 0.25 * level;
    S.audio?.stinger?.(finale ? 'harmony' : 'discover');
    S.audio?.sfx?.('sparkle', { position: calf.pos, gain: 0.5 + 0.15 * level });
    // the duet: she sings a rising figure, the calf a third above her
    const sg = S.song;
    const notes = finale ? [[0, 2], [2, 4], [4, 7]] : level > 1 ? [[2, 4], [4, 6]] : [[4, 6]];
    for (let i = 0; i < notes.length; i++) {
      const [a, b] = notes[i];
      if (sg?.midi) S.voiceHum(m, sg.midi(a, -1), 1.3);
      else S.voiceCall(m, 'answer');
      yield* this._near(0.32);
      if (sg?.midi) S.voiceHum(calf, sg.midi(b, 1), 1.0);
      else S.voiceCall(calf, 'chirp');
      yield* this._near(0.6);
    }
    yield* this._nuzzle(finale ? 3.2 : 2.4);
    if (finale && A) A.joy += 0.5;
  }

  /** Keep close to the calf for a moment (between notes). */
  *_near(sec) {
    const herd = this.herd, m = herd.mother, calf = herd.calf;
    let t = 0;
    while (t < sec) {
      _v.copy(calf.pos).addScaledVector(calf.right, -this.cur.side * (m.radius + calf.radius + 3)).addScaledVector(calf.vel, 0.4);
      this._go(_v, calf.vel.length() + 2, 6, 0, calf.pos);
      t += yield 0;
    }
  }

  /** Her head to the calf's, a slow nuzzle. */
  *_nuzzle(sec) {
    const herd = this.herd, m = herd.mother, calf = herd.calf;
    m.anim.gesture?.('nuzzle', { side: -this.cur.side });
    m.drive.happy = 1;
    let t = 0;
    while (t < sec) {
      _v.copy(calf.pos).addScaledVector(m.fwd, -m.L * 0.33).addScaledVector(calf.vel, 0.3);
      this._go(_v, calf.vel.length() + 0.8, 4, 0, calf.pos);
      if (t > sec * 0.4 && this._reach() < 2.5) calf.drive.happy = 1;
      t += yield 0;
    }
  }

  // ---- TAG ---------------------------------------------------------------------------------------
  /** A weaving course: around a sea stack near the calf, or zigzags along the route ahead. */
  _tagCourse() {
    const S = this.story, herd = this.herd, calf = herd.calf, m = herd.mother;
    const C = this._course;
    let stack = null, bd = 260;
    for (const isl of S.world?.islands || []) {
      if (!isl.pos || isl.R > 70 || (isl.H ?? 0) < 25) continue;
      const d = Math.hypot(isl.pos.x - calf.pos.x, isl.pos.z - calf.pos.z) - isl.R;
      if (d < bd) { bd = d; stack = isl; }
    }
    if (stack) {
      const R = stack.R + m.radius + 18;
      const a0 = Math.atan2(calf.pos.z - stack.pos.z, calf.pos.x - stack.pos.x) + 0.6 * -this.cur.side;
      for (let i = 0; i < C.length; i++) {
        const a = a0 - this.cur.side * (i + 1) * (TAU / 7);
        const p = C[i].set(stack.pos.x + Math.cos(a) * R, 0, stack.pos.z + Math.sin(a) * R);
        p.y = Math.min(herd.floorY(m, p.x, p.z) + 6 + (i % 3) * 5, (stack.H ?? 40) * 0.8 + 8);
        p.y = Math.max(p.y, herd.floorY(m, p.x, p.z));
      }
      this.note('tag around a stack');
      return C;
    }
    const s0 = herd.calfS ?? herd.s;
    let lat = _v.copy(calf.pos).sub(S.path.pointAt(s0, _v2)).dot(S.path.frameAt(s0).right);
    for (let i = 0; i < C.length; i++) {
      lat = clamp(lat + (i % 2 ? 1 : -1) * this.cur.side * (35 + Math.random() * 20), -80, 80);
      const p = S.path.offsetAt(Math.min(S.path.length - 1, s0 + 40 + i * 42), lat, 0, 0, C[i]);
      p.y = Math.max(calf.pos.y + (Math.random() - 0.4) * 14, herd.floorY(m, p.x, p.z) + 3);
    }
    return C;
  }

  *_tag(L) {
    const S = this.story, herd = this.herd, m = herd.mother, calf = herd.calf, g = this.game, A = this.act;
    // the invitation: right up beside the calf, a wiggle and a playful call
    m.anim.gesture?.('happyWiggle');
    S.voiceCall(m, 'play');
    let t = 0, tapped = false;
    while (t < 10) {
      this._view();
      _v.copy(calf.pos).addScaledVector(_r, L.side * (m.radius + calf.radius + 1)).addScaledVector(calf.vel, 0.45).addScaledVector(_f, 2);
      const cs = calf.vel.length();
      this._go(_v, cs + 3 + m.pos.distanceTo(_v) * 0.2, 4, cs * 0.7, calf.pos);
      this._hintAt(m.pos, 0.18, 4);
      if (this._reach() < 3.5 && t > 0.8) { tapped = true; break; }
      t += yield 0;
    }
    // tap! you're it: a nudge with her flipper and she rolls away
    if (tapped) {
      _v.copy(calf.pos).sub(m.pos).normalize();
      calf.anim.bump?.(_v, 0.6);
      calf.vel.addScaledVector(_v, 2.5);
      S.audio?.sfx?.('bonk', { position: calf.pos, gain: 0.25, pitch: 1.3 });
    }
    S.voiceCall(m, 'play');
    m.barrelRoll(-L.side);
    m.vel.addScaledVector(m.fwd, 4);
    const course = this._tagCourse();
    let i = 0, caught = false;
    t = 0;
    while (t < 32) {
      const dt = yield 0;
      t += dt;
      const wp = course[i];
      if (m.pos.distanceTo(wp) < m.radius + 10) i = (i + 1) % course.length;
      const d = this._reach();
      const cs = calf.vel.length();
      // just out of reach: easing off when the calf lags, slipping away when it closes in; tiring late
      let sp = d > 50 ? 5 : d > 28 ? cs * 0.8 + 1 : cs + 2.5;
      if (t > 18) sp *= 0.65;
      this._go(wp, clamp(sp, 4, 21), 6, 2, d > 26 ? calf.pos : null);
      if (d > 22) this._hintAt(m.pos, 0.22, 6); else this.camHint = null;
      if (d < 3.5) { caught = true; break; }
      if (d > 140) break;
    }
    if (!caught) {
      // the calf did not follow: she comes back, a little coo
      S.voiceCall(m, 'coo');
      yield* this._nuzzle(2);
      return;
    }
    // caught! a squeal of delight... and now she is it
    this.stats.caught++;
    this.note('tag: caught her');
    S.voiceCall(m, 'play');
    m.anim.gesture?.('happyWiggle');
    calf.anim.gesture?.('happyWiggle');
    calf.drive.happy = 1;
    if (A) A.joy += 0.5;
    S.audio?.sfx?.('chime', { position: m.pos, gain: 0.6 });
    S.audio?.sfx?.('sparkle', { position: calf.pos, gain: 0.5 });
    yield* this._near(0.9);
    S.voiceCall(m, 'answer');
    t = 0;
    let got = false;
    while (t < 9) {
      const dt = yield 0;
      t += dt;
      _v.copy(calf.pos).addScaledVector(calf.vel, 0.5);
      this._go(_v, calf.vel.length() * 0.85 + 3, 3, 2, calf.pos);
      this._hintAt(m.pos, 0.15, 4);
      if (this._reach() < 3) { got = true; break; }
    }
    if (A) A.joy += 0.4;
    S.audio?.stinger?.('harmony');
    if (got) {
      // got you: a nuzzle and a happy rumble
      S.voiceCall(m, 'answer');
      S.voiceCall(calf, 'chirp');
      yield* this._nuzzle(2.6);
    } else {
      // it got away: she rolls over, laughing, and gives up
      S.voiceCall(m, 'play');
      m.barrelRoll(L.side);
      yield* this._near(2.5);
    }
    void g;
  }

  // ---- DISCOVERY -------------------------------------------------------------------------------
  /** Something wondrous near the route ahead: a waterfall, or a glowing bloom at night. */
  _findWonder() {
    const S = this.story, W = S.world, herd = this.herd, calf = herd.calf, m = herd.mother, g = this.game;
    if (!W) return null;
    const fwd = S.path.tangentAt(Math.min(S.path.length - 1, herd.calfS ?? herd.s), _f);
    let best = null, bd = Infinity;
    const night = G.uNight?.value ?? 0;
    const falls = W.waterfalls || [];
    for (let i = 0; i < falls.length; i++) {
      const u = falls[i].userData;
      if (!u || !u.lip || this.seen.has('fall' + i)) continue;
      const lip = u.lip;
      const d = Math.hypot(lip.x - calf.pos.x, lip.z - calf.pos.z);
      if (d < 90 || d > 380) continue;
      if (_v.copy(lip).sub(calf.pos).dot(fwd) < -40) continue; // not behind
      // hover in front of the fall, at about half its height
      const out = u.out || _v2.set(1, 0, 0);
      const spot = new Vector3().copy(lip).addScaledVector(out, 26 + (u.width || 6) + m.radius);
      const sea = seaHeight(g, spot.x, spot.z);
      spot.y = clamp(lip.y - (u.drop || 20) * 0.45, sea + m.radius * 1.6 + 6, lip.y + 6);
      for (let k = 0; k < 4 && W.distance && W.distance(spot, 60) < m.radius * 1.4 + 4; k++) spot.addScaledVector(out, 10);
      const look = new Vector3().copy(lip).addScaledVector(out, 2);
      look.y = lip.y - (u.drop || 20) * 0.4;
      if (d < bd) { bd = d; best = { key: 'fall' + i, kind: 'fall', spot, look }; }
    }
    if (night > 0.5) {
      const P = W.spawns?.plankton || [];
      for (let i = 0; i < P.length; i++) {
        const q = P[i];
        if (!q.pos || this.seen.has('bloom' + i)) continue;
        const d = Math.hypot(q.pos.x - calf.pos.x, q.pos.z - calf.pos.z);
        if (d > 420) continue;
        const sea = seaHeight(g, q.pos.x, q.pos.z);
        // a point in the bloom ahead of the calf
        const spot = new Vector3().copy(calf.pos).addScaledVector(fwd, 90).sub(q.pos).setY(0);
        if (spot.length() > q.radius * 0.6) spot.setLength(q.radius * 0.6);
        spot.add(q.pos);
        spot.y = sea - m.radius * 0.3;
        const look = new Vector3().copy(spot).addScaledVector(fwd, 40);
        look.y = sea;
        const dd = d * 0.8; // the night's bloom wins over a far fall
        if (dd < bd) { bd = dd; best = { key: 'bloom' + i, kind: 'bloom', spot, look }; }
      }
    }
    return best;
  }

  *_discover(L) {
    const S = this.story, herd = this.herd, m = herd.mother, calf = herd.calf, g = this.game, A = this.act;
    const P = L.place;
    this.seen.add(P.key);
    this.note(`discover ${P.kind}`);
    // she notices: slows, lifts her head toward it, then looks back to the calf and calls
    S.voiceCall(m, 'coo');
    m.anim.sHeadPitch?.impulse?.(-2);
    let t = 0;
    while (t < 1.6) {
      _v.copy(m.pos).addScaledVector(m.vel, 0.6);
      this._go(_v, Math.max(5, calf.vel.length() * 0.7), 10, 0, P.look);
      t += yield 0;
    }
    S.voiceCall(m, 'answer');
    // the detour: she leads, glancing back, waiting when it lags; calls if it lags far
    t = 0;
    let callT = 7, arrived = false;
    while (t < 45) {
      const dt = yield 0;
      t += dt;
      callT -= dt;
      const dc = m.pos.distanceTo(calf.pos);
      const ds = m.pos.distanceTo(P.spot);
      const sp = dc > 70 ? 3 : dc > 40 ? 7 : clamp(calf.vel.length() + 3, 9, 17);
      this._go(P.spot, sp, 20, 0, dc > 45 ? calf.pos : P.look);
      if (P.kind === 'bloom' && ds < 30) herd.behaviors?.ballast?.(m, P.spot.y, dt, 0.6);
      if (calf.pos.distanceTo(P.spot) < 220) this._hintAt(P.look, 0.16, 5);
      if (dc > 55 && callT <= 0) { S.voiceCall(m, 'answer'); callT = 7; }
      if (ds < m.radius + 12 && calf.pos.distanceTo(P.spot) < m.radius + 40) { arrived = true; break; }
    }
    if (!arrived) { S.voiceCall(m, 'coo'); return; }
    this.stats.found++;
    // the moment: she stops before it and sings; the camera glides out to frame the pair and it
    const face = P.look;
    if (P.kind === 'bloom') m.anim.gesture?.('finSlap'); // stirring the glow
    const C = S.cine;
    if (C && !C.active) {
      this.ownCine = true;
      C.begin({ focus: P.look, rate: 0.5, lead: m });
      const dir = new Vector3().copy(P.spot).sub(P.look).setY(0).normalize();
      const side = new Vector3().crossVectors(dir, UP).normalize();
      const mid = new Vector3();
      const shot = (k, tt, s) => {
        mid.copy(m.pos).lerp(calf.pos, 0.4);
        s.pos.copy(mid).addScaledVector(dir, lerp(34, 22, k) + m.radius).addScaledVector(side, lerp(14, 8, k) * L.side);
        s.pos.y = Math.max(mid.y + lerp(7, 3, k), seaHeight(g, s.pos.x, s.pos.z) + 2);
        s.look.copy(mid).lerp(P.look, lerp(0.5, 0.68, k));
        s.fov = lerp(50, 42, k);
        s.roll = 0;
      };
      yield* C.play(shot, 5.4, { onFrame: (k, tt) => { this._hover(P, face); this._duetAt(tt); } });
      if (this.ownCine) { this.ownCine = false; C.end(); }
    } else {
      let u = 0;
      while (u < 4.5) { this._hover(P, face); this._duetAt(u); u += yield 0; }
    }
    this._duetT = -1;
    S.audio?.stinger?.('discover');
    if (A) A.joy += 0.6;
    calf.drive.happy = 1;
    yield* this._nuzzle(2.4);
  }

  /** Hovering before the wonder, facing it. */
  _hover(P, face) {
    const herd = this.herd, m = herd.mother;
    this._go(P.spot, 2.5, 10, 0, face);
    this.ms.face = face;
    if (P.kind === 'bloom') herd.behaviors?.ballast?.(m, P.spot.y, 1 / 60, 0.6);
  }

  /** Her phrase before the wonder and the calf's answer, timed from t (seconds into the moment). */
  _duetAt(t) {
    const S = this.story, herd = this.herd, sg = S.song;
    if (this._duetT === undefined || this._duetT < 0 || t < this._duetT) this._duetT = 0;
    const cues = [[0.5, 'm', 0, 1.6], [1.9, 'm', 4, 1.4], [2.3, 'c', 6, 1.1], [3.3, 'm', 2, 2.0], [3.6, 'c', 4, 1.8]];
    for (const [at, who, deg, dur] of cues) {
      if (this._duetT <= at && t > at) {
        const w = who === 'm' ? herd.mother : herd.calf;
        if (sg?.midi) S.voiceHum(w, sg.midi(deg, who === 'm' ? -1 : 1), dur);
        else S.voiceCall(w, who === 'm' ? 'answer' : 'chirp');
      }
    }
    this._duetT = t + 1e-4;
  }

  // ---- HUNTING ------------------------------------------------------------------------------------
  /** A school of small fish near the surface, close to the calf. */
  _findSchool() {
    const S = this.story, eco = S.eco, calf = this.herd.calf;
    if (!eco?.nearestSwarm) return null;
    const n = eco.nearestSwarm(calf.pos, 'glintfin');
    if (!n || !n.pos || n.dist > 300 || n.dist < 30) return null;
    const sea = seaHeight(this.game, n.pos.x, n.pos.z);
    if (sea - n.pos.y > 14) return null;
    // open water: room beneath the fish for a 22 m whale to dive and circle (not a lagoon shelf)
    const W = S.world, m = this.herd.mother;
    if (W?.seabedAt && W.seabedAt(n.pos.x, n.pos.z) > n.pos.y - m.L * 1.6) return null;
    return new Vector3().copy(n.pos);
  }

  *_hunt(L) {
    const S = this.story, herd = this.herd, m = herd.mother, calf = herd.calf, g = this.game, A = this.act, eco = S.eco;
    const c = L.school;
    const ball = new Vector3().copy(c);
    const track = () => {
      const n = eco?.nearestSwarm?.(ball, 'glintfin');
      if (n && n.pos && n.pos.distanceTo(ball) < 40) ball.lerp(n.pos, 0.1);
      return n;
    };
    const bal = (y, dt, k = 0.8) => herd.behaviors?.ballast?.(m, y, dt, k);
    this.note('hunt');
    // the call: she looks at the calf, then down at the water, and glides out low over the school
    S.voiceCall(m, 'answer');
    let t = 0, callT = 8, ready = false;
    while (t < 35) {
      const dt = yield 0;
      t += dt;
      callT -= dt;
      track();
      const sea = seaHeight(g, ball.x, ball.z);
      _v.copy(ball).setY(sea + m.radius + 4);
      const dc = m.pos.distanceTo(calf.pos);
      const d = this._go(_v, dc > 70 ? 3 : 11, 10, 0, dc > 45 ? calf.pos : ball);
      if (calf.pos.distanceTo(ball) < 160) this._hintAt(ball, 0.15, 5);
      if (dc > 60 && callT <= 0) { S.voiceCall(m, 'answer'); callT = 8; }
      if (d < 18 && calf.pos.distanceTo(ball) < 60) { ready = true; break; }
    }
    if (!ready) { this.note('hunt: the calf did not come'); return; }
    this.note('hunt: dive');
    // down beneath the fish
    t = 0;
    while (t < 8) {
      const dt = yield 0;
      t += dt;
      track();
      _v.copy(ball);
      _v.y -= 11;
      this._go(_v, 8, 3, 5, ball);
      this.ms.maxPitch = 1.15;
      this.ms.pitchGain = 1.3;
      if (m.pos.y < seaHeight(g, m.pos.x, m.pos.z) + 2) bal(_v.y, dt);
      if (m.pos.y < ball.y - 6) break;
    }
    // the net: she circles beneath, blowing a spiral curtain of bubbles; the fish crowd in and up
    L.net = ball;
    eco?.bubbleNet?.(ball, 18, 1, 40);
    const B = herd.behaviors;
    let ang = Math.atan2(m.pos.z - ball.z, m.pos.x - ball.x);
    const dir = L.side;
    t = 0;
    while (t < 7) {
      const dt = yield 0;
      t += dt;
      track();
      const sea = seaHeight(g, ball.x, ball.z);
      const R = lerp(17, 9, t / 7) + m.radius * 0.4;
      ang += dir * (11 / R) * dt;
      _v.set(ball.x + Math.cos(ang + dir * 0.5) * R, Math.min(ball.y - 7, sea - m.radius - 3), ball.z + Math.sin(ang + dir * 0.5) * R);
      this._go(_v, 9, 2, 4, ball);
      this.ms.maxPitch = 0.9;
      this.ms.pitchGain = 1.3;
      bal(_v.y, dt, 0.9);
      B?._bubbles?.(m, dt, 12);
      if (sea - m.pos.y < 10) B?._froth?.(m, dt, sea);
      if (calf.pos.distanceTo(ball) < 120) this._hintAt(ball, 0.18, 5);
      if (Math.floor(t / 2.7) !== Math.floor((t - dt) / 2.7)) eco?.bubbleNet?.(ball, lerp(16, 9, t / 7), 1, 30);
    }
    // now you: she holds beneath the ball, still blowing, and calls the calf in
    this.note('hunt: the ball is ready');
    S.voiceCall(m, 'coo');
    const fish0 = A?.hunt?.caught?.fish ?? 0, eaten0 = S.eaten || 0;
    // headless testing: the autopilot swims into the ball (restored when the lesson moves on)
    const P = S.player;
    if (S.autoplay && P) {
      L.auto = P.autopilot;
      P.autopilot = () => {
        _v.copy(ball).sub(calf.pos);
        const d = _v.length();
        return { swim: 1, yaw: Math.atan2(_v.x, _v.z), pitch: Math.asin(clamp(_v.y / Math.max(d, 1), -1, 1)), surge: d > 30 };
      };
    }
    t = 0;
    callT = 6;
    let fed = false, autoT = 0;
    while (t < 22) {
      const dt = yield 0;
      t += dt;
      callT -= dt;
      track();
      const sea = seaHeight(g, ball.x, ball.z);
      ang += dir * 0.35 * dt;
      _v.set(ball.x + Math.cos(ang) * 8, Math.min(ball.y - 9, sea - m.radius - 3), ball.z + Math.sin(ang) * 8);
      this._go(_v, 4, 4, 1, calf.pos.distanceTo(ball) < 30 ? ball : calf.pos);
      this.ms.maxPitch = 0.9;
      bal(_v.y, dt, 0.9);
      B?._bubbles?.(m, dt, 6);
      this._hintAt(ball, 0.18, 5);
      if (callT <= 0 && calf.pos.distanceTo(ball) > 25) { S.voiceCall(m, 'coo'); callT = 7; }
      // headless testing: the autopilot lunges when it is in the ball
      if (S.autoplay && calf.pos.distanceTo(ball) < 9) { autoT -= dt; if (autoT <= 0) { A?.hunt?.bite?.(); autoT = 1; } }
      const bit = (A?.hunt?.caught?.fish ?? 0) > fish0;
      if (bit || (S.eaten || 0) - eaten0 > 2.5) { fed = true; break; }
      if (calf.water && calf.water.depth > 0.5 && calf.water.air < 0.3) break; // up for air first
    }
    if (L.auto) { P.autopilot = L.auto; L.auto = null; }
    if (fed) {
      // a big mouthful: the gulp swells, the calf glows with it, she rumbles her pride
      this.stats.fed++;
      this.note('hunt: fed');
      if (A) { A.morsel += 1.2; A.biteT = g.time; A.joy += 0.8; }
      calf.energy = Math.min(1, calf.energy + 0.2);
      calf.drive.happy = 1;
      S.audio?.sfx?.('gulp', { position: calf.pos, gain: 0.9, pitch: 0.75 });
      S.audio?.stinger?.('discover');
      S.voiceCall(m, 'answer');
      yield 0.4;
    }
    // she finishes the ball: up through it with her mouth wide and out into the air
    eco?.stopBubbleNet?.(ball);
    L.net = null;
    t = 0;
    let out = false;
    while (t < 9) {
      const dt = yield 0;
      t += dt;
      const sea = seaHeight(g, ball.x, ball.z);
      _v.copy(ball).setY(sea + 16);
      this._go(_v, 14, 1, 10, _v);
      this.ms.maxPitch = 1.2;
      this.ms.pitchGain = 1.3;
      const depth = sea - m.pos.y;
      if (depth > 0) m.vel.y += 6 * dt;
      const near = m.pos.distanceTo(ball) < 20;
      m.drive.mouth = near ? 1 : 0.5;
      m.drive.feed = m.drive.mouth;
      if (!out && depth < -m.radius * 0.25 && m.vel.y > 1.5) { out = true; m.anim.gesture?.('breachArch'); }
      if (out && t > 2.5) break;
    }
    m.drive.mouth = 0;
    m.drive.feed = 0;
    yield* this._nuzzle(2.2);
  }
}

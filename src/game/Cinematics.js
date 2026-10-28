// Cinematic moments: scripted camera shots (establishing aerials, crane-ups, slow orbits, flybys,
// low angles over the water, tracking shots beside the herd, close-ups on an eye), letterbox bars,
// title cards, slow motion and depth of field, all skippable by holding any key, button or touch.
//
// Inside a story coroutine:
//   const C = story.cine;
//   C.begin({ focus: mom.pos });                       // takes the camera, bars slide in, the player is carried
//   yield* C.play(C.orbit({ center, radius: [80, 140], height: [10, 60], angle: [0, 1.2] }), 7);
//   yield* C.showCard({ kicker: 'ACT I · THE CALF', title: 'The Dawn Lagoon', line: '...' }, 4);
//   C.end();                                           // the camera glides back to the player
// Every shot is a function (k, t, shot) that writes shot.pos / look / fov / roll; k is the eased
// progress 0..1, t the seconds into the shot. Subjects may be a Vector3 or anything with .pos.
// A skip ends the remaining shots and waits of the current cinematic at once (C.skipped stays
// true until end()), so a sequence never traps the player.
//
// Documentary language (docs/VUR_SOK.md 0.7): long-lens observational shots (longLens, narrow FOV,
// an operator's slow follow), drone aerials (drone), macro close-ups (macro), time-lapse and slow
// motion (timelapse / slowmo), a faint hand-held sway on every shot, lower-third captions
// (C.lower({ place, name, sci })) and sparse narrator subtitles (C.say(line), yield* C.narrate(...)).
import { Vector3 } from 'three';
import { clamp, lerp, easeInOut, easeInOutSine } from '../core/math.js';

const UP = new Vector3(0, 1, 0);
const _a = new Vector3();
const _b = new Vector3();
const _f = new Vector3();
const _r = new Vector3();
const P = (s) => (s && s.isVector3 ? s : s ? s.pos : _a.set(0, 0, 0));
const R = (v, k) => (Array.isArray(v) ? lerp(v[0], v[1], k) : v);
const SKIP_HOLD = 0.9;

export class Cinematics {
  constructor(story) {
    this.story = story;
    this.game = story.game;
    this.shot = story.shot;
    this.active = false;
    this.skipped = false;
    this.skippable = true;
    this.skipT = 0;
    this.armed = false;
    this.holding = false;
    this.slow = 1;
    this.depth = 0;
    const doc = typeof document !== 'undefined' ? document : null;
    this.el = doc?.getElementById('cine') || null;
    this.cardEl = this.el?.querySelector('.card') || null;
    this.kickerEl = this.el?.querySelector('.kicker') || null;
    this.titleEl = this.el?.querySelector('.title') || null;
    this.lineEl = this.el?.querySelector('.line') || null;
    this.skipEl = this.el?.querySelector('.skip') || null;
    this.skipBar = this.skipEl?.querySelector('i') || null;
    this.lowerEl = this.el?.querySelector('.lower') || null;
    this.lowerPlace = this.lowerEl?.querySelector('.place') || null;
    this.lowerName = this.lowerEl?.querySelector('.name') || null;
    this.lowerSci = this.lowerEl?.querySelector('.sci') || null;
    this.subEl = this.el?.querySelector('.sub') || null;
    this.cardText = null; // the card on screen (for headless checks)
    this.lowerText = null; // the lower-third on screen
    this.subText = null; // the narrator line on screen
    this.lowerT = 0;
    this.subT = 0;
    this.seen = new Set(); // documentary captions already shown (species reveals happen once)
    this.sway = 1; // the hand-held drift of the camera operator (0 for locked-off shots)
    this.swayT = 0;
    this._goal = new Vector3();
    this._lb = false;
    // carries the player's whale beside its leader while the camera is away (PlayerController.autopilot)
    this.lead = null;
    this.carry = () => {
      const S = this.story, w = S.herd.calf;
      const lead = this.lead || S.herd.mother;
      const off = (lead.L + w.L) * 0.45 + 3;
      const goal = this._goal.copy(lead.pos).addScaledVector(lead.right, off).addScaledVector(lead.fwd, -lead.L * 0.15);
      goal.sub(w.pos);
      const d = goal.length();
      return { swim: d > 6 ? 1 : 0.35, yaw: Math.atan2(goal.x, goal.z), pitch: Math.asin(clamp(goal.y / Math.max(d, 1), -1, 1)) * 0.8, surge: d > 50 };
    };
  }

  /**
   * Take the camera for a cinematic moment.
   * opts: letterbox (true), rate (camera blend speed), focus (Vector3 or whale kept sharp; null for
   * autofocus), hold (true: the player's whale is carried beside opts.lead), skippable (true), slow.
   */
  begin(opts = {}) {
    const S = this.story, g = this.game;
    this.depth++;
    this.active = true;
    this.skipped = false;
    this.skippable = opts.skippable ?? true;
    this.armed = false;
    this.skipT = 0;
    this.lead = opts.lead || null;
    this.letterbox(opts.letterbox ?? true);
    g.cameraRig.setCinematic(this.shot, opts.rate ?? 0.6);
    if (opts.snap) g.cameraRig.cineW = 1;
    this.setFocus(opts.focus ?? null);
    if ((opts.hold ?? true) && S.player && !this.held) {
      this.held = { auto: S.player.autopilot, enabled: S.player.enabled };
      if (!S.player.autopilot) S.player.autopilot = this.carry;
      S.player.enabled = false;
      if (S.player.humming) { S.player.humming = false; S.onCalfHumEnd?.(); }
      S.player.charge = 0;
      S.player.charging = false;
    }
    if (opts.slow) this.slowmo(opts.slow);
    return this;
  }

  /** Hand the camera back (blending over ~1/rate seconds) and the whale back to the player. */
  end(opts = {}) {
    const S = this.story, g = this.game;
    this.depth = 0;
    this.active = false;
    this.skipped = false;
    this.letterbox(false);
    this.hideCard(true);
    if (!opts.keepText) this.clearText();
    this.sway = 1;
    this.slowmo(1);
    g.cameraRig.cineRate = opts.rate ?? 0.5;
    g.cameraRig.cineTarget = 0;
    if (this.held) {
      if (S.player.autopilot === this.carry) S.player.autopilot = this.held.auto;
      // the player only gets the controls back in play (never under the pause menu)
      S.player.enabled = S.state === 'play' && (opts.release ?? true);
      if (S.player.enabled) S.player.syncAim?.();
      this.held = null;
    }
    this.lead = null;
    if (S.state === 'play') g.engine.setLook?.('gameplay', { focusOn: S.herd.calf.pos, ease: 1.5 });
    this.skipEl?.classList.remove('on');
  }

  setFocus(subject) {
    const g = this.game;
    const f = subject ? P(subject) : null;
    g.engine.setLook?.('cinematic', { focusOn: f, ease: 1.2 });
  }

  letterbox(on) {
    this._lb = !!on;
    this.el?.classList.toggle('lb', !!on);
  }

  slowmo(scale = 1) {
    this.slow = scale;
    if (this.story.state !== 'paused') this.game.timeScaleTarget = scale;
  }

  // ---- title cards ------------------------------------------------------------------------
  /** Show a title card: { kicker, title, line, logo, low }. */
  card(c) {
    if (!this.cardEl) { this.cardText = c; return; }
    this.kickerEl.textContent = c.kicker || '';
    this.titleEl.textContent = c.title || '';
    this.titleEl.classList.toggle('logo', !!c.logo);
    this.lineEl.textContent = c.line || '';
    this.cardEl.classList.toggle('low', !!c.low);
    // restart the slow letter-spacing drift
    this.cardEl.classList.remove('on');
    void this.cardEl.offsetWidth;
    this.cardEl.classList.add('on');
    this.cardText = c;
  }

  hideCard(now = false) {
    this.cardEl?.classList.remove('on');
    if (now && this.cardEl) {
      this.cardEl.style.transition = 'opacity .35s ease';
      setTimeout(() => { if (this.cardEl) this.cardEl.style.transition = ''; }, 400);
    }
    this.cardText = null;
  }

  /** Coroutine: a card that holds, then fades (skippable when inside a cinematic). */
  *showCard(c, hold = 4.5) {
    this.card(c);
    yield* this.wait(hold);
    this.hideCard(this.skipped);
    yield* this.wait(1.2);
  }

  /** A card over gameplay that clears itself (no letterbox, no camera change). */
  flashCard(c, hold = 4.5) {
    const S = this.story;
    S.script.cancel('card');
    const self = this;
    S.script.run((function* () {
      self.card(c);
      yield hold;
      self.hideCard();
    })(), 'card');
  }

  // ---- documentary text ---------------------------------------------------------------------
  /**
   * A lower-third caption: { place, name, sci } (place: a small kicker like "VUR SOK", name in
   * Almendra SC, sci the invented scientific name in italics). Clears itself after hold seconds.
   * once: a key so the caption is only ever shown the first time (species reveals).
   */
  lower(c, hold = 6, once = null) {
    if (!c) return false;
    if (once) {
      if (this.seen.has(once)) return false;
      this.seen.add(once);
    }
    this.lowerText = c;
    this.lowerT = hold;
    if (!this.lowerEl) return true;
    this.lowerPlace.textContent = c.place || '';
    this.lowerName.textContent = c.name || '';
    this.lowerSci.textContent = c.sci || '';
    this.lowerEl.classList.remove('on');
    void this.lowerEl.offsetWidth;
    this.lowerEl.classList.add('on');
    return true;
  }

  hideLower() {
    this.lowerEl?.classList.remove('on');
    this.lowerText = null;
    this.lowerT = 0;
  }

  /** A narrator subtitle at the bottom of the frame (Cormorant italic); clears after hold seconds. */
  say(line, hold = 4.6) {
    if (!line) return;
    this.subText = line;
    this.subT = hold;
    if (!this.subEl) return;
    this.subEl.textContent = line;
    this.subEl.classList.remove('on');
    void this.subEl.offsetWidth;
    this.subEl.classList.add('on');
  }

  hideSay() {
    this.subEl?.classList.remove('on');
    this.subText = null;
    this.subT = 0;
  }

  clearText() {
    this.hideLower();
    this.hideSay();
  }

  /** Coroutine: narrator lines one after another (each holds, then a short breath between). */
  *narrate(lines, hold = 4.2, gap = 0.7) {
    for (const l of [].concat(lines)) {
      if (this.skipped) break;
      this.say(l, hold);
      yield* this.wait(hold + gap);
    }
  }

  /** Time-lapse (scale > 1) or slow motion (scale < 1); 1 restores real time. */
  timelapse(scale = 3) {
    this.slowmo(scale);
  }

  // ---- running shots ------------------------------------------------------------------------
  /** Wait seconds of story time, ending early on a skip. */
  *wait(sec) {
    let t = 0;
    while (t < sec && !this.skipped) t += yield 0;
  }

  /**
   * Run one shot for dur seconds. opts: ease (fn of 0..1, default easeInOut), until (a condition
   * that ends it early), onFrame(k, t).
   */
  *play(fn, dur, opts = {}) {
    const ease = opts.ease || easeInOut;
    let t = 0;
    fn(0, 0, this.shot);
    while (t < dur && !this.skipped) {
      const k = ease(clamp(t / dur, 0, 1));
      fn(k, t, this.shot);
      this.handheld(this.shot, opts.sway ?? this.sway);
      opts.onFrame?.(k, t);
      if (opts.until && opts.until()) break;
      t += yield 0;
    }
    if (!this.skipped) fn(ease(1), dur, this.shot);
  }

  // ---- shot library ---------------------------------------------------------------------------
  /** A slow orbit around a point or a moving subject: radius, height and angle may be [from, to]. */
  orbit({ center, radius = 80, height = 20, angle = [0, 0.8], fov = 45, look = null, lookUp = 0, roll = 0 }) {
    return (k, t, s) => {
      const c = P(center);
      const a = R(angle, k), r = R(radius, k);
      s.pos.set(c.x + Math.cos(a) * r, c.y + R(height, k), c.z + Math.sin(a) * r);
      if (look) s.look.copy(P(look)); else s.look.copy(c);
      s.look.y += R(lookUp, k);
      s.fov = R(fov, k);
      s.roll = R(roll, k);
    };
  }

  /**
   * Relative to a whale's (or the path's) frame: { side, up, back } offsets, each a value or
   * [from, to]. Positive back is behind the subject, side is to its right. look: { ahead, up }.
   */
  rel({ subject, side = 0, up = 2, back = 10, ahead = 0, lookUp = 0, lookSide = 0, fov = 45, roll = 0, frame = null, worldUp = false }) {
    return (k, t, s) => {
      const w = subject;
      const p = P(w);
      const fr = frame ? frame() : w;
      _f.copy(fr.fwd || _f.set(0, 0, 1));
      if (worldUp) _f.setY(0).normalize();
      _r.crossVectors(_f, UP).normalize();
      s.pos.copy(p).addScaledVector(_r, R(side, k)).addScaledVector(UP, R(up, k)).addScaledVector(_f, -R(back, k));
      s.look.copy(p).addScaledVector(_f, R(ahead, k)).addScaledVector(UP, R(lookUp, k)).addScaledVector(_r, R(lookSide, k));
      s.fov = R(fov, k);
      s.roll = R(roll, k);
    };
  }

  /** Tracking shot alongside a moving subject (the herd, a pair of whales). */
  track({ subject, side = 30, up = 4, back = 0, ahead = 10, fov = 42, roll = 0 }) {
    return this.rel({ subject, side, up, back, ahead, fov, roll, worldUp: true });
  }

  /** The subject sweeps past a camera held beside its path. */
  flyby({ subject, side = 12, up = 2, to = 30, fov = 38 }) {
    const anchor = new Vector3(), dir = new Vector3();
    let set = false;
    return (k, t, s) => {
      const w = subject, p = P(w);
      if (!set) {
        set = true;
        dir.copy(w.fwd || _f.set(0, 0, 1)).setY(0).normalize();
        _r.crossVectors(dir, UP).normalize();
        // a fixed point beside the subject's line, a little ahead
        anchor.copy(p).addScaledVector(dir, to).addScaledVector(_r, side).addScaledVector(UP, up);
      }
      s.pos.copy(anchor);
      s.look.copy(p);
      s.fov = R(fov, k);
      s.roll = 0;
    };
  }

  /** A low angle just over the water, looking up at the subject. */
  low({ subject, side = 18, back = -20, height = 1.6, fov = 50, lookUp = 0 }) {
    const g = this.game;
    return (k, t, s) => {
      const w = subject, p = P(w);
      _f.copy(w.fwd || _f.set(0, 0, 1)).setY(0).normalize();
      _r.crossVectors(_f, UP).normalize();
      s.pos.copy(p).addScaledVector(_r, R(side, k)).addScaledVector(_f, -R(back, k));
      const sea = g.ocean?.heightAt ? g.ocean.heightAt(s.pos.x, s.pos.z) : 0;
      s.pos.y = sea + R(height, k);
      s.look.copy(p);
      s.look.y += R(lookUp, k);
      s.fov = R(fov, k);
      s.roll = 0;
    };
  }

  /** Close-up on a whale's eye (the primary pair), from the side. */
  eye({ whale, side = 1, dist = 0.32, fov = 30 }) {
    return (k, t, s) => {
      const w = whale, L = w.L;
      const eyeP = _b.copy(w.pos).addScaledVector(w.fwd, L * 0.33).addScaledVector(w.up, L * 0.04).addScaledVector(w.right, side * L * 0.08);
      s.pos.copy(eyeP).addScaledVector(w.right, side * L * R(dist, k)).addScaledVector(w.fwd, L * 0.12).addScaledVector(w.up, L * 0.03);
      s.look.copy(eyeP);
      s.fov = R(fov, k);
      s.roll = 0;
    };
  }

  /** A high establishing aerial: from far and high, drifting. */
  aerial({ center, dist = [700, 520], height = [260, 180], angle = [0.4, 0.7], fov = 50, lookUp = 0 }) {
    return this.orbit({ center, radius: dist, height, angle, fov, lookUp });
  }

  /**
   * The camera operator's hand: a faint, slow drift of the aim (a few hundredths of a degree at
   * long lenses, where it reads most). Applied after a shot writes its frame.
   */
  handheld(s, amount = 1) {
    if (!amount) return;
    const T = this.swayT;
    const d = s.pos.distanceTo(s.look);
    // narrower lenses magnify the hand: keep the on-screen drift about constant
    const a = amount * d * 0.0026 * clamp((s.fov || 45) / 45, 0.25, 1.2);
    s.look.x += (Math.sin(T * 0.53) + 0.5 * Math.sin(T * 1.31 + 2.1)) * a;
    s.look.y += (Math.sin(T * 0.71 + 1.3) + 0.4 * Math.sin(T * 1.73)) * a * 0.6;
    s.look.z += (Math.sin(T * 0.47 + 4.2) + 0.5 * Math.sin(T * 1.19 + 0.7)) * a;
  }

  /**
   * A long-lens observational shot: the camera far off (dist m) beside the subject's path, a narrow
   * lens (fov 9..20), panning after its subject with an operator's slight lag. angle is the bearing
   * (radians, world) from the subject at the start; height above the sea.
   */
  longLens({ subject, dist = 260, angle = 0, height = 6, fov = 14, lag = 1.6, sea = true }) {
    const g = this.game;
    const anchor = new Vector3(), aim = new Vector3();
    let set = false, prevT = 0;
    return (k, t, s) => {
      const p = P(subject);
      const dt = Math.max(0, t - prevT);
      prevT = t;
      if (!set) {
        set = true;
        const a = R(angle, 0), r = R(dist, 0);
        anchor.set(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
        aim.copy(p);
      }
      const a = R(angle, k), r = R(dist, k);
      // a slow dolly along the bank, the camera itself barely moving
      const fa = 1 - Math.exp(-dt * 0.3);
      anchor.x = lerp(anchor.x, p.x + Math.cos(a) * r, fa);
      anchor.z = lerp(anchor.z, p.z + Math.sin(a) * r, fa);
      const base = sea && g.ocean?.heightAt ? Math.max(g.ocean.heightAt(anchor.x, anchor.z), 0) : 0;
      s.pos.set(anchor.x, (sea ? base : p.y) + R(height, k), anchor.z);
      // the pan trails the subject a little, as a hand on a fluid head would
      if (t === 0) aim.copy(p); else aim.lerp(p, 1 - Math.exp(-dt * 4 / Math.max(lag, 0.05)));
      s.look.copy(aim);
      s.fov = R(fov, k);
      s.roll = 0;
    };
  }

  /** A drone aerial: high, slow, rising or sinking, looking down at a point (tilt: look below it). */
  drone({ center, radius = [260, 200], height = [140, 90], angle = [0, 0.5], fov = 42, tilt = 0 }) {
    return (k, t, s) => {
      const c = P(center);
      const a = R(angle, k), r = R(radius, k);
      s.pos.set(c.x + Math.cos(a) * r, c.y + R(height, k), c.z + Math.sin(a) * r);
      s.look.copy(c);
      s.look.y -= R(tilt, k);
      s.fov = R(fov, k);
      s.roll = 0;
    };
  }

  /**
   * A macro close-up: very near a small subject (an egg, an eye), slowly circling, with a narrow
   * lens. under: keep the lens beneath the sea surface (an underwater macro).
   */
  macro({ subject, dist = [3.2, 2.4], angle = [0, 0.4], height = [0.3, 0.1], fov = [26, 22], under = false }) {
    const g = this.game;
    return (k, t, s) => {
      const c = P(subject);
      const a = R(angle, k), r = R(dist, k);
      s.pos.set(c.x + Math.cos(a) * r, c.y + R(height, k), c.z + Math.sin(a) * r);
      if (under && g.ocean?.heightAt) s.pos.y = Math.min(s.pos.y, g.ocean.heightAt(s.pos.x, s.pos.z) - 0.6);
      s.look.copy(c);
      s.fov = R(fov, k);
      s.roll = 0;
    };
  }

  /** Blend between two shots (both evaluated each frame). */
  blend(fa, fb) {
    const sa = { pos: new Vector3(), look: new Vector3(), fov: 45, roll: 0 };
    const sb = { pos: new Vector3(), look: new Vector3(), fov: 45, roll: 0 };
    return (k, t, s) => {
      fa(k, t, sa);
      fb(k, t, sb);
      const e = easeInOutSine(k);
      s.pos.copy(sa.pos).lerp(sb.pos, e);
      s.look.copy(sa.look).lerp(sb.look, e);
      s.fov = lerp(sa.fov, sb.fov, e);
      s.roll = lerp(sa.roll, sb.roll, e);
    };
  }

  // ---- per frame (real time) -------------------------------------------------------------------
  update(dtReal) {
    const inp = this.game.input;
    this.swayT += dtReal;
    if (this.story.state !== 'paused') {
      if (this.lowerT > 0 && (this.lowerT -= dtReal) <= 0) this.hideLower();
      if (this.subT > 0 && (this.subT -= dtReal) <= 0) this.hideSay();
    }
    if (!this.active || !this.skippable || this.story.state === 'paused' || this.story.state === 'menu') {
      this.skipT = 0;
      if (this.holding) { this.holding = false; this.skipEl?.classList.remove('on'); }
      return;
    }
    const held = inp.keys.size > 0 || inp.mouseButtons > 0 || (inp.touches && inp.touches.size > 0) ||
      inp.gpButtons.some((b) => b > 0.5);
    // a hold that began before the cinematic (still swimming) does not count
    if (!held) this.armed = true;
    if (held && this.armed && !this.skipped) {
      this.skipT += dtReal;
      if (this.skipT > 0.2 && !this.holding) { this.holding = true; this.skipEl?.classList.add('on'); }
      if (this.skipBar) this.skipBar.style.transform = `scaleX(${clamp(this.skipT / SKIP_HOLD, 0, 1).toFixed(3)})`;
      if (this.skipT >= SKIP_HOLD) {
        this.skipped = true;
        this.hideCard(true);
        this.clearText();
        this.skipEl?.classList.remove('on');
        this.holding = false;
      }
    } else {
      this.skipT = Math.max(0, this.skipT - dtReal * 3);
      if (this.holding && this.skipT <= 0) { this.holding = false; this.skipEl?.classList.remove('on'); }
      if (this.skipBar) this.skipBar.style.transform = `scaleX(${clamp(this.skipT / SKIP_HOLD, 0, 1).toFixed(3)})`;
    }
  }
}


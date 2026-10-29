// The calf's needs: hunger and its mother, told only through the world (docs/VUR_SOK.md 0.11;
// no text, no HUD, no fail state, nothing can die).
//  - hunger (calf.hunger 0 full .. 1 starving) rises over about three minutes of play; bugs,
//    the bite (fish, jacks, birds, eels) and the feast's fish bring it down (feed(), called from
//    Activities.onCatch, Hunt._snap and Story.updateCalf). A hungry calf flies weaker and slower
//    (less thrust, stamina that no longer refills, heavy lids, dull eyes, a thinner chest), the
//    world drains of colour, the edges darken, the score thins and the calf sighs now and then.
//    Full: a warm, contented grade, bright eyes, a rounder chest and a little more speed.
//  - the mother: close to her the calf rides her slipstream (the air moves with her, less drag),
//    stays warmer (warm grade) and gets hungry more slowly, and she hums to it; far from her the
//    world turns cooler and lonelier (cool grade, wider camera, thinner music, louder wind), and
//    lanternjacks and skimmers grow bold with a stray (Hunt.stray -> eco.hunter). Her own calls,
//    turning back and fetching are Herd.updateMother's (wait / fetch).
//  - she leads a hungry calf to food (herd.motherNeed, called by Herd.updateMother below the
//    story's own direction): the nearest bug swarm or fish school near the route; she flies to it
//    calling, circles it snapping at it, and waits for her calf there. A starving calf she feeds
//    herself: it nestles under her eye and she passes it a mouthful of krill, a few gulps, a coo.
// Story creates it (new Needs(game, story)) and calls update(dt) in updateCalf before the calf's
// step, pose() after its animate, camera(opts) before the follow camera, and reset().
import { Vector3 } from 'three';
import { clamp, damp, lerp, smoothstep } from '../core/math.js';
import { seaHeight } from './Swim.js';
import { G } from '../render/Globals.js';

/** Full to starving in a little over three minutes of play (slower at rest and by mother). */
const HUNGER_RATE = 1 / 170;
const START_HUNGER = 0.22;
const LEAD_AT = 0.45; // the mother leads the calf to food from here
const NURSE_AT = 0.86; // and feeds it herself from here
const LONELY0 = 100, LONELY1 = 280; // m from the mother: loneliness ramps in
const NEAR0 = 26, NEAR1 = 75; // m: her warmth

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _tgt = new Vector3();
const _look = new Vector3();
const _tan = new Vector3();

export class Needs {
  constructor(game, story) {
    this.game = game;
    this.story = story;
    this.hunger = START_HUNGER;
    this.k = 0; // 0..1 how much the needs show (act I play only)
    this.weak = 0; // smoothed effect of hunger
    this.fullK = 0; // smoothed contentment
    this.relief = 0; // the warm flush after a good meal when hungry
    this.near = 0;
    this.lonely = 0;
    this.slip = 0;
    this.windBoost = 0; // Story.updateAudio adds it to the wind ambience
    this.lead = null; // the mother leading to food
    this.nurse = null; // the mother feeding her calf
    this.leadCd = 20;
    this.nurseCd = 0;
    this.sighT = 0;
    this.lostT = 0;
    this.humT = 30;
    this.lastFed = -99;
    this.fedTotal = 0;
    this.stats = { leads: 0, nursed: 0, fed: 0 };
    this._base = null;
    this._ret = { target: new Vector3(), speed: 8, arrive: 8, minSpeed: 0, lookAt: null };
    this._em = { pos: new Vector3(), vel: new Vector3(), life: 1, size: 0.04, sizeEnd: 0.04, alpha: 1, drag: 1.5, gravity: 0, kind: 10, color: [1, 0.6, 0.5], fadeIn: 0.05 };
    const herd = story.herd;
    if (herd) {
      herd.motherNeed = (m, dt) => this.motherNeed(m, dt);
      herd.calf.hunger = this.hunger;
    }
  }

  get herd() { return this.story.herd; }

  reset(hunger = START_HUNGER) {
    this.hunger = hunger;
    this.lead = null;
    this.nurse = null;
    this.leadCd = 20;
    this.nurseCd = 0;
    this.relief = 0;
    const calf = this.herd?.calf;
    if (calf) { calf.hunger = this.hunger; calf.regen = 1; }
  }

  /** Food reached the calf's belly: `amount` of hunger taken away (a moth ~0.06, a fish bite ~0.1). */
  feed(amount) {
    if (!(amount > 0)) return;
    const was = this.hunger;
    this.hunger = clamp(this.hunger - amount, 0, 1);
    this.fedTotal += amount;
    this.stats.fed += amount;
    this.lastFed = this.game.time;
    // the first good mouthfuls after a long hunger: a warm flush through the world
    if (was > 0.4) this.relief = Math.min(1, this.relief + amount * 3);
    const calf = this.herd?.calf;
    if (calf) calf.hunger = this.hunger;
  }

  /** Is the calf the player's to fly in act I (the needs only show then)? */
  _active() {
    const st = this.story;
    if (st.state !== 'play' || st.act !== 1) return false;
    if (st.cine?.active || st.life?.free) return false;
    if (st.life?.isKinematic?.(st.herd.calf)) return false;
    return true;
  }

  // ---- per frame, before the calf's step ---------------------------------------------------------
  update(dt) {
    const st = this.story, g = this.game, herd = this.herd;
    if (!herd) return;
    const calf = herd.calf, mom = herd.mother;
    if (!this._base || this._base.phys !== calf.phys) this._base = { phys: calf.phys, thrust: calf.phys.thrust, drag: calf.phys.drag };
    const active = this._active();
    this.k = damp(this.k, active ? 1 : 0, active ? 0.8 : 2.5, dt);
    const k = this.k;
    const now = g.time;
    const d = mom.pos.distanceTo(calf.pos);
    const speed = calf.vel.length();
    // ---- the mother's nearness ----
    const scripted = !!herd.motherScript;
    this.near = damp(this.near, 1 - smoothstep(NEAR0, NEAR1, d), 1.2, dt);
    const lonelyT = smoothstep(LONELY0, LONELY1, d) * (scripted ? 0.5 : 1) * (herd.mode === 'gather' ? 0.4 : 1);
    this.lonely = damp(this.lonely, lonelyT, lonelyT > this.lonely ? 0.35 : 0.9, dt);
    // ---- hunger ----
    if (active) {
      let rate = HUNGER_RATE;
      if (calf.ctl.surge) rate *= 1.7;
      else if (calf.ctl.thrust < 0.1) rate *= 0.8;
      rate *= 1 - 0.25 * this.near; // her warmth
      if (herd.mode === 'rest' || herd.mode === 'sleep') rate *= 0.5;
      else if (herd.mode !== 'travel' && herd.mode !== 'feed') rate *= 0.35; // the story's big moments
      if (this.nurse && this.nurse.phase === 'feed') rate = 0;
      this.hunger = clamp(this.hunger + rate * dt, 0, 1);
    }
    calf.hunger = this.hunger;
    this.weak = damp(this.weak, smoothstep(0.35, 0.97, this.hunger), 0.6, dt);
    this.fullK = damp(this.fullK, smoothstep(0.22, 0.04, this.hunger), 0.5, dt);
    this.relief = Math.max(0, this.relief - dt * 0.12);
    const weak = this.weak * k, full = this.fullK * k;
    // ---- the slipstream: behind or beside her the air moves with her ----
    const L = mom.L;
    _v.copy(calf.pos).sub(mom.pos);
    const along = _v.dot(mom.fwd);
    const lat = Math.sqrt(Math.max(0, _v.lengthSq() - along * along));
    const a = -along / L; // body lengths behind her
    const ms = mom.vel.length();
    const slipT = smoothstep(-0.45, -0.05, a) * (1 - smoothstep(1.5, 2.6, a)) * (1 - smoothstep(0.55, 1.5, lat / L)) * smoothstep(2.5, 6, ms);
    this.slip = damp(this.slip, slipT * k, 2, dt);
    if (this.slip > 0.01) calf.wind.addScaledVector(mom.vel, 0.4 * this.slip);
    // being fed at her cheek, a calf not steering anywhere turns with her (set by _nurse last frame)
    if (this._yawHold != null) { calf.ctl.targetYaw = this._yawHold; this._yawHold = null; }
    // ---- the body: thrust, drag, stamina, droop ----
    const B = this._base;
    calf.phys.thrust = B.thrust * (1 + 0.07 * full - 0.3 * weak);
    calf.phys.drag = B.drag * (1 - 0.3 * this.slip);
    calf.regen = lerp(1, 0.2, weak) * (1 + 0.8 * this.near * k);
    if (k > 0.01) {
      calf.energy = Math.min(calf.energy, 1 - 0.42 * weak);
      // (kept under 0.6: above it her care reads the calf as exhausted and buoys it up)
      calf.drive.tired = Math.max(calf.drive.tired, weak * 0.58);
      if (full > 0.3) calf.drive.happy = Math.max(calf.drive.happy, 0.45 * full);
    }
    // ---- voices: a hungry calf sighs, a lost one cries; she hums to a calf at her side ----
    if (active) {
      this.sighT -= dt;
      if (this.weak > 0.5 && this.sighT <= 0 && !this.nurse) {
        this.sighT = lerp(15, 26, Math.random());
        st.voiceCall?.(calf, 'yawn');
        calf.anim.breathe?.(0.8);
        if (d < 260 && !scripted) this._answerSoon(1.4);
      } else if (this.sighT <= 0) this.sighT = 6;
      this.lostT -= dt;
      if (this.lonely > 0.6 && this.lostT <= 0) {
        this.lostT = lerp(11, 18, Math.random());
        st.voiceCall?.(calf, 'chirp');
      } else if (this.lostT <= 0) this.lostT = 4;
      this.humT -= dt;
      if (this.near > 0.75 && speed < 13 && this.humT <= 0 && !scripted && !this.lead) {
        this.humT = lerp(28, 45, Math.random());
        st.voiceCall?.(mom, 'coo');
        mom.drive.happy = Math.max(mom.drive.happy, 0.8);
      } else if (this.humT <= 0) this.humT = 8;
      if (this._answerAt > 0 && now >= this._answerAt) {
        this._answerAt = -1;
        st.voiceCall?.(mom, 'answer');
        mom.drive.lookAt = calf.pos;
      }
    }
    // ---- predators: a stray far from its mother is fair game ----
    const hunt = st.activities?.hunt;
    if (hunt) hunt.stray = active ? clamp((this.lonely - 0.3) / 0.7, 0, 1) * (0.7 + 0.3 * this.weak) : 0;
    this._grade(dt);
    this._audio();
  }

  _answerSoon(t) {
    if (!(this._answerAt > 0)) this._answerAt = this.game.time + t;
  }

  /** The world's colour and edges: hungry desaturates and darkens them, lonely cools them, near and full warm them. */
  _grade() {
    const post = this.game.engine?.post;
    const gr = post?.grade;
    if (!gr || this.k < 0.002) return;
    const k = this.k;
    const h = this.weak * k, lo = this.lonely * k;
    const warm = clamp(Math.max(this.near * 0.55, this.fullK * 0.6, this.relief * 0.8), 0, 1) * k * (1 - 0.6 * this.weak);
    gr.uSaturation.value *= clamp(1 - 0.3 * h - 0.2 * lo + 0.05 * warm, 0.4, 1.1);
    gr.uContrast.value *= 1 - 0.05 * h;
    gr.uVignette.value += 0.3 * h + 0.18 * lo;
    const vc = gr.uVignetteColor.value;
    vc.r *= (1 - 0.22 * h) * (1 - 0.1 * lo);
    vc.g *= (1 - 0.22 * h) * (1 - 0.04 * lo);
    vc.b *= (1 - 0.18 * h) * (1 + 0.04 * lo);
    // white balance: warm by her, cool alone (normalised, so it never changes the brightness)
    const wb = gr.uWB.value;
    wb.x *= 1 + 0.035 * warm - 0.08 * lo;
    wb.y *= 1 + 0.008 * warm - 0.012 * lo;
    wb.z *= 1 - 0.04 * warm + 0.1 * lo;
    const wl = wb.x * 0.2126 + wb.y * 0.7152 + wb.z * 0.0722;
    wb.multiplyScalar(1 / Math.max(wl, 1e-3));
    G.uExposure.value *= 1 - 0.06 * h - 0.03 * lo + 0.02 * warm;
  }

  _audio() {
    const st = this.story, a = st.audio;
    const k = this.k;
    const thin = clamp(0.45 * this.weak + 0.6 * this.lonely, 0, 0.8) * k;
    if (Math.abs(thin - (this._thin ?? -1)) > 0.015 || (thin === 0 && this._thin !== 0)) {
      this._thin = thin;
      a?.setThin?.(thin);
    }
    this.windBoost = 0.3 * this.lonely * k;
  }

  // ---- after the calf's animate: the body shows its belly ---------------------------------------
  pose() {
    const calf = this.herd?.calf;
    if (!calf || this.k < 0.002) return;
    const k = this.k;
    // a hungry calf's chest thins, a full one is round (children compensate: head, eyes, wings keep size)
    const girth = 1 + 0.045 * this.fullK * k - 0.08 * this.weak * k;
    const b = calf.model.bones;
    if (b?.chest && Math.abs(girth - 1) > 1e-3) {
      b.chest.scale.x *= girth;
      b.chest.scale.y *= lerp(1, girth, 0.6);
      const ix = 1 / girth, iy = 1 / lerp(1, girth, 0.6);
      for (const n of ['neck', 'finR1', 'finL1']) if (b[n]) { b[n].scale.x *= ix; b[n].scale.y *= iy; }
    }
    // the eyes: bright when fed, dull when starving
    const sp = clamp(1 + 0.15 * this.fullK * k - 0.6 * this.weak * k + 0.15 * this.relief * k, 0.3, 1.2);
    const E = calf.model.eyes;
    if (E) for (const key in E) if (E[key].u?.uSparkle) E[key].u.uSparkle.value = sp;
  }

  /** Camera hints for the follow camera: wide and lonely far from her, a lean toward her when she feeds it. */
  camera(opts) {
    if (this.k < 0.01) return;
    const mom = this.herd.mother;
    if (this.nurse && this.nurse.phase === 'feed') {
      if (!opts.lookBias) {
        opts.lookBias = _look.copy(mom.pos).addScaledVector(mom.fwd, mom.L * 0.4);
        opts.lookBiasW = 0.22;
        opts.lookBiasMax = 5;
      }
      opts.extraDist = (opts.extraDist || 0) + 2;
      opts.busy = true;
      return;
    }
    if (this.lead && this.lead.phase === 'circle' && !opts.lookBias) {
      const calf = this.herd.calf;
      if (calf.pos.distanceTo(this.lead.pos) < 90) {
        opts.lookBias = _look.copy(this.lead.pos);
        opts.lookBiasW = 0.1;
        opts.lookBiasMax = 4;
      }
    }
    if (this.lonely > 0.05) opts.extraDist = (opts.extraDist || 0) + 4 * this.lonely * this.k;
  }

  /** The headless autopilot (?auto) follows these: into her food, or to her cheek to be fed. */
  autoGoal() {
    if (this.k < 0.5) return null;
    if (this.nurse && this._spot) return this._spot;
    if (this.lead && this.lead.phase === 'circle' && this.hunger > 0.15) return this.lead.pos;
    return null;
  }

  // ---- the mother (Herd.updateMother asks, below the story's own direction) ----------------------
  /** Returns { target, speed, arrive, minSpeed, lookAt } while she leads to food or feeds her calf, else null. */
  motherNeed(m, dt) {
    const st = this.story, herd = this.herd, calf = herd.calf, g = this.game;
    this.leadCd -= dt;
    this.nurseCd -= dt;
    if (!this._active() || this.k < 0.5) { this._endAll(); return null; }
    if (herd.mode !== 'travel' && herd.mode !== 'rest') { this._endAll(); return null; }
    if ((st.weather?.level ?? 0) > 0.35 || herd.threat) { this._endAll(); return null; }
    const d = m.pos.distanceTo(calf.pos);
    const depth = calf.water ? calf.water.depth : -99;
    // feeding the calf herself
    if (!this.nurse && this.hunger > NURSE_AT && this.nurseCd <= 0 && d < 170 && depth < 0.5) {
      this.lead = null;
      this.nurse = { phase: 'come', t: 0, ft: 0, gulpT: 0, emitT: 0, side: _v.copy(calf.pos).sub(m.pos).dot(m.right) > 0 ? 1 : -1, gulps: 0 };
      this.stats.nursed++;
      st.voiceCall?.(m, 'answer');
    }
    if (this.nurse) return this._nurse(m, dt, d);
    // a diving calf: her own care follows it down
    if (depth > 0.5 && !(this.lead && this.lead.fish)) return null;
    if (!this.lead && this.hunger > LEAD_AT && this.leadCd <= 0 && d < 130) {
      this.leadCd = 6;
      const f = this._findFood(m);
      if (f) {
        this.lead = f;
        this.stats.leads++;
        st.voiceCall?.(m, 'answer');
        m.drive.happy = 1;
      }
    }
    if (this.lead) return this._lead(m, dt, d);
    return null;
  }

  _endAll() {
    if (this.lead) this._endLead(8);
    if (this.nurse) this._endNurse(20);
  }

  /** The nearest food near the route: a bug swarm in the air or a fish school under the sea. */
  _findFood(m) {
    const st = this.story, herd = this.herd, calf = herd.calf;
    const path = st.path;
    if (path) path.tangentAt(Math.min(path.length - 1, herd.calfS ?? herd.s), _tan);
    else _tan.copy(m.fwd);
    let best = null, bs = Infinity;
    const score = (p) => {
      const dc = p.distanceTo(calf.pos);
      const ahead = _v.copy(p).sub(calf.pos).dot(_tan);
      if (ahead < -120) return Infinity; // never back the way they came
      return dc - 0.35 * clamp(ahead, -120, 200);
    };
    const bugs = st.activities?.bugs;
    if (bugs) {
      for (const S of bugs.swarms) {
        if (!S.active || S.dying || S.tag || S.count < 6) continue;
        const dc = S.center.distanceTo(calf.pos);
        if (dc > 300 || S.center.distanceTo(m.pos) > 340) continue;
        const s = score(S.center) - (S.kind === 'moth' ? 20 : 0);
        if (s < bs) { bs = s; best = { S, fish: false, pos: S.center.clone(), R: S.radius }; }
      }
    }
    const eco = st.eco;
    const n = eco?.nearestSwarm?.(calf.pos);
    if (n && n.pos && n.dist < 260 && n.species !== 'lanternjack' && n.pos.y > seaHeight(this.game, n.pos.x, n.pos.z) - 14) {
      const s = score(n.pos) + 25; // bugs are easier for a calf in the air
      if (s < bs) { bs = s; best = { S: null, fish: true, pos: n.pos.clone(), R: Math.max(4, n.radius || 6) }; }
    }
    if (!best) return null;
    Object.assign(best, { phase: 'go', t: 0, callT: this.game.time + 5, snapT: 0, ang: 0, dir: Math.random() < 0.5 ? 1 : -1, slapped: false, mouth: 0 });
    best.ang = Math.atan2(m.pos.z - best.pos.z, m.pos.x - best.pos.x);
    return best;
  }

  _endLead(cd = 25) {
    const m = this.herd?.mother;
    if (m && this.lead) m.drive.mouth = 0;
    this.lead = null;
    this.leadCd = cd;
  }

  _lead(m, dt, d) {
    const st = this.story, g = this.game, herd = this.herd, calf = herd.calf, now = g.time;
    const F = this.lead;
    F.t += dt;
    // the food moves (and may be gone)
    if (F.S) {
      if (!F.S.active || F.S.dying) { this._endLead(10); return null; }
      F.pos.copy(F.S.center);
      F.R = F.S.radius;
    } else {
      const n = st.eco?.nearestSwarm?.(F.pos);
      if (!n || !n.pos || n.pos.distanceTo(F.pos) > 50) { this._endLead(10); return null; }
      F.pos.lerp(n.pos, 1 - Math.exp(-dt * 2));
    }
    if (this.hunger < 0.12 || F.t > 60 || (F.t > 8 && d > 170)) { this._endLead(this.hunger < 0.12 ? 40 : 18); return null; }
    const toFood = m.pos.distanceTo(F.pos);
    const calfFood = calf.pos.distanceTo(F.pos);
    const cs = calf.vel.length();
    const R = F.R + m.radius * 1.3 + 7;
    const sea = seaHeight(g, F.pos.x, F.pos.z);
    const out = this._ret;
    const T = out.target;
    if (now > F.callT) {
      // she calls her calf on; once it is at the food, a soft coo
      st.voiceCall?.(m, calfFood < R + 15 ? 'coo' : 'answer');
      F.callT = now + (calfFood < R + 15 ? 11 : 6.5);
    }
    if (F.phase === 'go') {
      T.copy(F.pos);
      if (F.fish) T.y = sea + m.radius * 0.7 + 1.5;
      else T.y += 3;
      // she leads, never leaves: slows and looks back while her calf lags
      const lag = d > 55 ? smoothstep(55, 120, d) : 0;
      out.speed = lerp(Math.max(10, cs + 3), 3, lag);
      out.arrive = 12;
      out.minSpeed = 2;
      out.lookAt = Math.sin(now * 0.7) > 0 || lag > 0.3 ? calf.pos : F.pos;
      if (toFood < R + 12) { F.phase = 'circle'; F.snapT = now + 1; }
    } else {
      // to and fro along an arc on the calf's side of it (the open side: moths hang by the rocks),
      // low, snapping at it: here
      const toCalf = Math.atan2(calf.pos.z - F.pos.z, calf.pos.x - F.pos.x);
      F.base = F.base === undefined ? toCalf : F.base + Math.atan2(Math.sin(toCalf - F.base), Math.cos(toCalf - F.base)) * Math.min(1, dt * 0.15);
      F.sw = (F.sw || 0) + dt * F.dir * clamp(5 / R, 0.12, 0.4);
      F.ang = F.base + Math.sin(F.sw) * 1.1;
      T.set(F.pos.x + Math.cos(F.ang) * R, F.pos.y + 2 + Math.sin(F.sw * 2) * 1.5, F.pos.z + Math.sin(F.ang) * R);
      if (F.fish) T.y = sea + m.radius * 0.7 + 1;
      // lead the arc a little ahead so she flows along it instead of chasing a point
      const sd = Math.cos(F.sw) * F.dir;
      _v.set(-Math.sin(F.ang) * sd, 0, Math.cos(F.ang) * sd);
      T.addScaledVector(_v, 5);
      out.speed = 5;
      out.arrive = 5;
      out.minSpeed = 2.5;
      out.lookAt = calfFood > R + 25 && Math.sin(now * 0.6) > 0.2 ? calf.pos : F.pos;
      if (now > F.snapT) {
        F.snapT = now + lerp(2.2, 4, Math.random());
        m.anim.snap?.(1);
        F.mouth = 1;
        if (F.fish && !F.slapped && Math.random() < 0.6) { F.slapped = true; m.anim.gesture?.('finSlap'); }
      }
    }
    F.mouth = Math.max(0, F.mouth - dt * 1.4);
    m.drive.mouth = damp(m.drive.mouth, F.mouth > 0.4 ? 0.8 : 0.1, 7, dt);
    m.drive.feed = damp(m.drive.feed, F.phase === 'circle' ? 0.6 : 0, 2, dt);
    this.herd._lift(m, T);
    return out;
  }

  _endNurse(cd = 70) {
    const herd = this.herd;
    if (this.nurse && herd) {
      herd.mother.drive.mouth = 0;
      herd.mother.drive.feed = 0;
    }
    this.nurse = null;
    this.nurseCd = cd;
  }

  /** A starving calf: it nestles under her eye and she feeds it a mouthful of krill, gulp by gulp. */
  _nurse(m, dt, d) {
    const st = this.story, g = this.game, herd = this.herd, calf = herd.calf, now = g.time;
    const N = this.nurse;
    N.t += dt;
    const out = this._ret;
    // the calf's spot: under her eye, by the corner of her mouth (like the title's nestle)
    const spot = _v2.copy(m.pos).addScaledVector(m.right, N.side * (0.17 * m.L + calf.radius)).addScaledVector(m.fwd, 0.36 * m.L).addScaledVector(m.up, -0.04 * m.L);
    (this._spot || (this._spot = new Vector3())).copy(spot);
    const mouthM = _v3.copy(m.pos).addScaledVector(m.fwd, 0.46 * m.L).addScaledVector(m.up, -0.03 * m.L).addScaledVector(m.right, N.side * 0.06 * m.L);
    const cs = calf.vel.length();
    // she brings her head to the calf: her body aims so the spot lands on it
    out.target.copy(calf.pos).sub(spot).add(m.pos).addScaledVector(calf.vel, 0.4);
    out.lookAt = calf.pos;
    out.arrive = 6;
    out.minSpeed = 0;
    const gap = spot.distanceTo(calf.pos);
    if (N.phase === 'come') {
      out.speed = d > 40 ? Math.max(12, cs + 5) : Math.max(4, cs + 2);
      if (gap < 9 || (d < m.L * 0.7 && N.t > 2)) {
        N.phase = 'feed';
        N.ft = 0;
        st.voiceCall?.(m, 'coo');
        m.anim.gesture?.('nuzzle', { side: -N.side });
        m.drive.happy = 1;
      }
      if (N.t > 30) { this._endNurse(25); return null; }
      return out;
    }
    // feeding: matching the calf's pace, her mouth a little open; the calf is drawn in to her cheek
    N.ft += dt;
    out.speed = Math.max(2.5, Math.min(cs, 9) + 0.5);
    out.arrive = 3;
    m.drive.mouth = damp(m.drive.mouth, 0.28 + 0.1 * Math.sin(now * 3), 4, dt);
    m.drive.feed = 0.4;
    const pull = 1 - smoothstep(12, 26, gap);
    if (pull > 0) {
      _v.copy(spot).sub(calf.pos).multiplyScalar(0.9).add(m.vel);
      calf.vel.lerp(_v, 1 - Math.exp(-dt * 2.4 * pull));
      // a calf not steering anywhere turns with her
      if ((this.game.input?.swim ?? 0) < 0.1) this._yawHold = m.yaw;
    }
    calf.drive.lookAt = mouthM;
    const calfMouth = _v.copy(calf.pos).addScaledVector(calf.fwd, calf.L * 0.48);
    const reach = calfMouth.distanceTo(mouthM);
    if (reach < 7) {
      calf.drive.mouth = Math.max(calf.drive.mouth, 0.6);
      calf.drive.feed = Math.max(calf.drive.feed, 0.6);
      // the krill: little pink morsels tumbling from her lips to the calf's (no glow)
      N.emitT -= dt;
      if (N.emitT <= 0) {
        N.emitT = 0.045;
        const E = this._em;
        E.pos.copy(mouthM).addScaledVector(m.right, N.side * 0.4);
        E.vel.copy(calfMouth).sub(E.pos).multiplyScalar(1.6).add(m.vel);
        E.vel.x += (Math.random() - 0.5) * 0.8; E.vel.y += (Math.random() - 0.5) * 0.6; E.vel.z += (Math.random() - 0.5) * 0.8;
        E.life = 0.6 + Math.random() * 0.3; E.size = 0.05 + Math.random() * 0.03; E.sizeEnd = E.size * 0.6;
        E.alpha = 0.95; E.drag = 1.2; E.gravity = 0.4; E.kind = 10; E.fadeIn = 0.04;
        const p = Math.random();
        E.color[0] = 0.95; E.color[1] = lerp(0.45, 0.62, p); E.color[2] = lerp(0.4, 0.5, p);
        g.mist?.emit?.(E);
      }
      N.gulpT -= dt;
      if (N.gulpT <= 0) {
        N.gulpT = 0.75;
        N.gulps++;
        calf.anim.snap?.(0.55);
        calf.anim.gulp?.(0.8);
        st.audio?.sfx?.('gulp', { position: calfMouth, gain: 0.45, pitch: 1.15 });
        this.feed(0.065);
        calf.drive.happy = 1;
      }
    }
    if (this.hunger < 0.4 || N.ft > 12 || N.gulps >= 9) {
      st.voiceCall?.(m, 'coo');
      if (this.story.activities) this.story.activities.schedule(calf, 0.6, 'wiggle');
      else calf.anim.gesture?.('happyWiggle');
      this._endNurse(120);
      return null;
    }
    if (gap > 40 && N.ft > 3) { this._endNurse(25); return null; }
    return out;
  }
}

// The player calf: input -> intentions. The calf swims where the camera looks (Abzû-style),
// glides when not swimming, rolls, hums and charges its throat organ. No UI: its condition
// is shown through breathing, flap strength and body language.
import { Vector3 } from 'three';
import { clamp, damp, lerp, smoothstep, wrapAngle, dirFromYawPitch } from '../core/math.js';
import { Moves } from './Moves.js';

export class PlayerController {
  constructor(game, whale) {
    this.game = game;
    this.w = whale;
    this.input = game.input;
    this.aimYaw = whale.yaw;
    this.aimPitch = 0;
    this.enabled = false;
    this.steering = 0;
    this.humming = false;
    this.humTime = 0;
    this.charge = 0;
    this.charging = false;
    this.cooldown = 0;
    this.surgeHeld = 0;
    this.autopilot = null; // debug/test: function(dt) -> {swim, yaw, pitch}
    this.events = { hum: [], humEnd: [], boom: [], roll: [] };
    this.idleT = 0;
    this.lastHum = -10;
    // tail slaps, spouts, loops, dashes, corkscrews and breaches (src/game/Moves.js)
    this.moves = new Moves(game, whale, this);
  }

  on(ev, fn) { this.events[ev].push(fn); }
  emit(ev, a) { for (const f of this.events[ev]) f(a); }

  syncAim() {
    this.aimYaw = this.w.yaw;
    this.aimPitch = this.w.pitch;
  }

  update(dt) {
    const w = this.w, inp = this.input;
    const d = w.drive;
    let swim = 0, brake = 0, surge = false, turn = 0, climb = 0, lookX = 0, lookY = 0;
    if (this.enabled) {
      swim = inp.swim;
      brake = inp.brake;
      surge = inp.surge;
      turn = inp.turn;
      climb = inp.climb;
      lookX = inp.lookX + inp.stickLookX * 2.2 * dt;
      lookY = inp.lookY + inp.stickLookY * 1.6 * dt;
    }
    if (this.autopilot) {
      const a = this.autopilot(dt, this);
      swim = a.swim ?? swim;
      if (a.yaw !== undefined) this.aimYaw = a.yaw;
      if (a.pitch !== undefined) this.aimPitch = a.pitch;
      if (a.turn !== undefined) turn = a.turn;
      if (a.surge !== undefined) surge = a.surge;
    }
    // aim: mouse/right-stick look plus keyboard / left-stick steering
    this.aimYaw = wrapAngle(this.aimYaw - lookX - turn * 1.55 * dt);
    this.aimPitch = clamp(this.aimPitch - lookY + climb * 1.1 * dt, -1.15, 1.15);
    // with no vertical input, the aim relaxes gently toward level flight
    if (Math.abs(climb) < 0.05 && Math.abs(lookY) < 1e-4) this.aimPitch = damp(this.aimPitch, this.aimPitch * 0.85, 0.5, dt);

    const speed = w.vel.length();
    const active = swim > 0.05 || Math.abs(turn) > 0.05 || Math.abs(climb) > 0.05 || speed > 3.5;
    this.steering = damp(this.steering, active ? 1 : 0, 3, dt);
    if (this.steering > 0.05) {
      w.ctl.targetYaw = w.yaw + wrapAngle(this.aimYaw - w.yaw) * this.steering;
      w.ctl.targetPitch = lerp(w.pitch, this.aimPitch, this.steering);
    } else {
      w.ctl.targetYaw = w.yaw;
      w.ctl.targetPitch = damp(w.pitch, 0, 1, dt);
    }
    // energy: surging and booming tire the calf; gliding and eating restore it
    const canSurge = surge && w.energy > 0.15 && swim > 0.1;
    this.surgeHeld = canSurge ? this.surgeHeld + dt : 0;
    // (w.regen: hunger slows the recovery, the mother's nearness speeds it; src/game/Needs.js)
    w.energy = clamp(w.energy - (canSurge ? 0.045 : 0) * dt + (swim < 0.1 ? 0.018 : 0.006) * (w.regen ?? 1) * dt, 0, 1);
    w.ctl.thrust = clamp(swim + (climb > 0.2 ? 0.25 : 0), 0, 1);
    w.ctl.surge = canSurge;
    w.ctl.brake = brake;
    w.ctl.lift = climb > 0 ? climb * 0.4 : 0;

    // barrel rolls
    if (this.enabled) {
      // a roll pressed mid-roll queues the next one: chained, they spin up into a corkscrew
      if (inp.rollLeftPressed) { if (w.barrelRoll(1)) this.emit('roll', 1); else this.moves.queueRoll(1); }
      if (inp.rollRightPressed) { if (w.barrelRoll(-1)) this.emit('roll', -1); else this.moves.queueRoll(-1); }
    }

    // humming (a newborn has no voice yet: a squeak, src/game/Abilities.js)
    const A = this.game.story?.abilities;
    let humHeld = this.enabled && inp.hum;
    if (humHeld && A && !A.has('voice') && !this.humming) { if (!this._lockHum) A.attempt('voice'); this._lockHum = true; humHeld = false; } else if (!inp.hum) this._lockHum = false;
    if (humHeld && !this.humming) {
      this.humming = true;
      this.humTime = 0;
      this.lastHum = this.game.time;
      this.emit('hum', { pitch: this.aimPitch });
    } else if (!humHeld && this.humming) {
      this.humming = false;
      this.emit('humEnd', { duration: this.humTime });
    }
    if (this.humming) this.humTime += dt;

    // sonic boom: hold to charge, release to unleash
    this.cooldown = Math.max(0, this.cooldown - dt);
    let boomHeld = this.enabled && inp.boom && this.cooldown <= 0;
    if (boomHeld && A && !A.has('boom') && !this.charging) { if (!this._lockBoom) A.attempt('boom'); this._lockBoom = true; boomHeld = false; } else if (!inp.boom) this._lockBoom = false;
    if (boomHeld) {
      this.charging = true;
      this.charge = Math.min(1, this.charge + dt / 1.6);
    } else if (this.charging) {
      this.charging = false;
      if (this.enabled && this.charge > 0.22) {
        this.emit('boom', { power: this.charge });
        w.energy = clamp(w.energy - 0.12 * this.charge, 0, 1);
        w.anim.blast(0.6 + this.charge * 0.6);
        w.vel.addScaledVector(w.fwd, -5 * this.charge);
        this.cooldown = 0.9;
      }
      this.charge = 0;
    }

    // body language
    const tired = smoothstep(0.45, 0.05, w.energy);
    d.effort = clamp(swim * (canSurge ? 1 : 0.72) + (climb > 0.2 ? 0.3 : 0), 0, 1);
    d.glide = swim < 0.1 && speed > 3 ? 1 : 0.2;
    d.climb = clamp(Math.sin(w.pitch) * 1.6, -1, 1);
    d.hum = this.humming ? 1 : 0;
    d.charge = this.charge;
    d.tired = tired;
    d.excite = damp(d.excite, canSurge || w.rollSpin > 0 ? 1 : 0, 2, dt);
    this.idleT = swim > 0.05 || this.humming ? 0 : this.idleT + dt;
    // moves last: a loop or a dive bomb may take the body's controls for a moment
    this.moves.update(dt, inp, this.enabled);
  }
}

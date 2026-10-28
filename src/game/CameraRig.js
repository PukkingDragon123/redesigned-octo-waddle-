// Cinematic third-person camera: follows gently, tilts into turns, pulls back in dives,
// widens to show scale, and blends seamlessly with scripted cinematic shots.
import { Vector3, Quaternion, Matrix4, MathUtils } from 'three';
import { damp, dampVec3, clamp, lerp, smoothstep, dirFromYawPitch, easeInOut } from '../core/math.js';

const _f = new Vector3();
const _r = new Vector3();
const _u = new Vector3();
const _t = new Vector3();
const _m = new Matrix4();
const UP = new Vector3(0, 1, 0);

export class CameraRig {
  constructor(game) {
    this.game = game;
    this.cam = game.engine.camera;
    this.pos = new Vector3(0, 120, 20);
    this.look = new Vector3(0, 110, 0);
    this.fov = 52;
    this.roll = 0;
    this.shake = 0;
    this.shakeT = 0;
    // gameplay state
    this.gPos = new Vector3();
    this.gLook = new Vector3();
    this.gFov = 52;
    this.gRoll = 0;
    this.distExtra = 0;
    this.wide = 0;
    this.calmT = 0;
    // cinematic
    this.cine = null; // { pos: Vector3, look: Vector3, fov, roll }
    this.cineW = 0;
    this.cineTarget = 0;
    this.cineRate = 0.5;
    this.lookOffset = new Vector3();
    this.collide = null; // function(from, to) -> shortened distance or null
    this.initialized = false;
  }

  setCinematic(shot, rate = 0.6) {
    this.cine = shot;
    this.cineTarget = shot ? 1 : 0;
    this.cineRate = rate;
  }

  addShake(a) {
    this.shake = Math.min(1.5, this.shake + a);
  }

  /** Gameplay follow. aimYaw/aimPitch define where the player looks/steers. */
  follow(dt, whale, aimYaw, aimPitch, opts = {}) {
    const speed = whale.vel.length();
    const aim = dirFromYawPitch(aimYaw, aimPitch, _f.clone());
    const diving = clamp(-whale.vel.y / 14, 0, 1);
    // when gliding calmly for a while, drift wider to reveal the scale of the world
    const calm = speed > 4 && speed < 14 && Math.abs(whale.yawRate) < 0.25 && !opts.busy;
    this.calmT = calm ? this.calmT + dt : Math.max(0, this.calmT - dt * 3);
    this.wide = damp(this.wide, smoothstep(5, 9, this.calmT), 0.5, dt);
    const base = opts.distance ?? 8.5;
    const distT = base + speed * 0.2 + diving * 4 + this.wide * 6 + (opts.extraDist || 0);
    this.distExtra = damp(this.distExtra, distT, 2.2, dt);
    let dist = this.distExtra;
    const height = 1.7 + this.wide * 2.2 + (opts.extraHeight || 0) - aimPitch * 1.2;
    const desired = _r.copy(whale.pos).addScaledVector(aim, -dist).addScaledVector(UP, height);
    // keep the camera out of rock
    if (this.collide) {
      const d = this.collide(whale.pos, desired);
      if (d !== null && d < dist) {
        dist = Math.max(2.5, d - 1);
        desired.copy(whale.pos).addScaledVector(aim, -dist).addScaledVector(UP, height * (dist / this.distExtra));
      }
    }
    const lookT = _u.copy(whale.pos).addScaledVector(aim, 3.5 + speed * 0.12).addScaledVector(UP, 0.8 + this.wide * 0.5);
    if (opts.lookBias) {
      // lookBiasMax caps the shift in metres, so a far target (a falcon 500 m away) turns the view
      // toward it without losing the calf
      if (opts.lookBiasMax !== undefined) {
        _t.copy(opts.lookBias).sub(lookT);
        const L = _t.length();
        if (L > 1e-3) lookT.addScaledVector(_t, Math.min(opts.lookBiasW || 0.3, opts.lookBiasMax / L));
      } else lookT.lerp(opts.lookBias, opts.lookBiasW || 0.3);
    }
    if (!this.initialized) {
      this.gPos.copy(desired);
      this.gLook.copy(lookT);
      this.initialized = true;
    }
    // responsive but soft
    dampVec3(this.gPos, desired, 4.2, dt);
    dampVec3(this.gLook, lookT, 7, dt);
    // never fall behind too far at speed
    const maxLag = dist * 1.6;
    if (this.gPos.distanceTo(whale.pos) > maxLag) this.gPos.sub(whale.pos).setLength(maxLag).add(whale.pos);
    // the waterline: stay clearly on the whale's side of the sea surface (opts.surfaceY), so the view
    // is never split half above and half below the water
    if (opts.surfaceY !== undefined) {
      const s = opts.surfaceY, below = whale.pos.y < s - 0.4;
      if (below && this.gPos.y > s - 0.7) this.gPos.y = s - 0.7;
      else if (!below && this.gPos.y < s + 0.9) this.gPos.y = s + 0.9;
    }
    this.gFov = damp(this.gFov, clamp(51 + speed * 0.55 + diving * 6 + this.wide * 4, 50, 72), 2, dt);
    this.gRoll = damp(this.gRoll, -whale.roll * 0.28 + (whale.rollSpin > 0 ? 0 : 0), 3, dt);
  }

  update(dt) {
    this.cineW = damp(this.cineW, this.cineTarget, this.cineRate * 3, dt);
    if (Math.abs(this.cineW - this.cineTarget) < 0.002) this.cineW = this.cineTarget;
    const w = easeInOut(clamp(this.cineW, 0, 1));
    if (this.cine && w > 0) {
      this.pos.copy(this.gPos).lerp(this.cine.pos, w);
      this.look.copy(this.gLook).lerp(this.cine.look, w);
      this.fov = lerp(this.gFov, this.cine.fov ?? 50, w);
      this.roll = lerp(this.gRoll, this.cine.roll ?? 0, w);
    } else {
      this.pos.copy(this.gPos);
      this.look.copy(this.gLook);
      this.fov = this.gFov;
      this.roll = this.gRoll;
    }
    // shake
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.shakeT += dt;
    const sh = this.shake * this.shake;
    const p = this.pos.clone();
    if (sh > 0) {
      p.x += Math.sin(this.shakeT * 37) * sh * 0.25;
      p.y += Math.sin(this.shakeT * 43 + 1) * sh * 0.25;
      p.z += Math.sin(this.shakeT * 31 + 2) * sh * 0.25;
    }
    const cam = this.cam;
    cam.position.copy(p);
    _f.copy(this.look).sub(p).normalize();
    _r.crossVectors(_f, UP).normalize();
    if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
    _u.crossVectors(_r, _f).normalize();
    // roll about the view axis
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const rx = _r.clone().multiplyScalar(cr).addScaledVector(_u, sr);
    const ux = _u.clone().multiplyScalar(cr).addScaledVector(_r, -sr);
    _m.makeBasis(rx, ux, _f.clone().negate());
    cam.quaternion.setFromRotationMatrix(_m);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}

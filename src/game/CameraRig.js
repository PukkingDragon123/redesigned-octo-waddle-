// Cinematic third-person camera: a steady, film-like follow on the calf (a slightly long lens, a
// gentle lag, the calf on the lower third with lead room into turns), pushed smoothly around the big
// adults so they never fill the frame, and blended seamlessly with scripted cinematic shots: a jump
// between two shots is never a hard cut, the lens glides from the old framing to the new one.
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
    this.avoid = null; // function(pos, out) -> out: a push keeping pos clear of the big whales
    this._avoid = new Vector3();
    this._push = new Vector3();
    this.lead = 0; // lateral lead room into turns
    this.initialized = false;
    // shot-to-shot glide: the offset of the old framing from the new one, decaying to zero
    this._cPrev = new Vector3();
    this._cPrevLook = new Vector3();
    this._cPrevFov = 50;
    this._cHas = false;
    this._cutPos = new Vector3();
    this._cutLook = new Vector3();
    this._cutFov = 0;
    this._cutT = 1;
    this._cutDur = 1.6;
  }

  /** Forget the previous cinematic framing (the next shot starts exactly where it says). */
  cutNow() {
    this._cHas = false;
    this._cutT = 1;
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
    // framing scales with the whale: the calf (4 m) as before, a grown whale (15-32 m) further out
    const sc = Math.max(1, Math.pow(whale.L / 4.2, 0.8));
    const base = (opts.distance ?? 11) * sc;
    const distT = base + speed * 0.22 + (diving * 4 + this.wide * 5) * sc + (opts.extraDist || 0);
    this.distExtra = damp(this.distExtra, distT, 1.6, dt);
    let dist = this.distExtra;
    const height = (2.4 + this.wide * 2.2 - aimPitch * 1.2) * sc + (opts.extraHeight || 0);
    const desired = _r.copy(whale.pos).addScaledVector(aim, -dist).addScaledVector(UP, height);
    // the big adults never crowd the lens: the camera eases out and around their bodies
    if (this.avoid) {
      this.avoid(desired, this._avoid);
      dampVec3(this._push, this._avoid, 1.8, dt);
      desired.add(this._push);
    }
    // keep the camera out of rock
    if (this.collide) {
      const d = this.collide(whale.pos, desired);
      if (d !== null && d < dist) {
        dist = Math.max(2.5 * sc, d - 1);
        desired.copy(whale.pos).addScaledVector(aim, -dist).addScaledVector(UP, height * (dist / this.distExtra)).addScaledVector(this._push, dist / this.distExtra);
      }
    }
    // the calf sits on the lower third, with a little lead room into its turns
    this.lead = damp(this.lead, clamp(whale.yawRate || 0, -1, 1), 1.2, dt);
    _t.crossVectors(aim, UP);
    const lookT = _u.copy(whale.pos).addScaledVector(aim, 4 * sc + speed * 0.12).addScaledVector(UP, (1.25 + this.wide * 0.5) * sc);
    if (_t.lengthSq() > 1e-6) lookT.addScaledVector(_t.normalize(), this.lead * 1.6 * sc);
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
    dampVec3(this.gPos, desired, 3.0, dt);
    dampVec3(this.gLook, lookT, 4.8, dt);
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
    // a slightly longer lens than before: calmer, less fish-eye at speed
    this.gFov = damp(this.gFov, clamp(44 + speed * 0.38 + diving * 5 + this.wide * 3, 43, 62), 1.4, dt);
    this.gRoll = damp(this.gRoll, -whale.roll * 0.2, 2.2, dt);
  }

  update(dt) {
    this.cineW = damp(this.cineW, this.cineTarget, this.cineRate * 3, dt);
    if (Math.abs(this.cineW - this.cineTarget) < 0.002) this.cineW = this.cineTarget;
    const w = easeInOut(clamp(this.cineW, 0, 1));
    const c = this.cine;
    if (c && w > 0) {
      // a jump between two shots glides instead of cutting: the old framing's offset from the new
      // one decays smoothly to zero over _cutDur seconds (the new shot keeps its own motion)
      if (this._cHas && dt > 0) {
        const jump = c.pos.distanceTo(this._cPrev), lookJump = c.look.distanceTo(this._cPrevLook);
        const covered = this.game.engine.post?.grade?.uFade?.value > 0.6;
        if (!covered && (jump > 5 + 60 * dt || lookJump > 14 + 80 * dt || Math.abs((c.fov ?? 50) - this._cPrevFov) > 6)) {
          // carry what is left of an earlier glide into the new one
          const k = this._cutT < 1 ? 1 - easeInOut(this._cutT) : 0;
          this._cutPos.multiplyScalar(k).add(this._cPrev).sub(c.pos);
          this._cutLook.multiplyScalar(k).add(this._cPrevLook).sub(c.look);
          this._cutFov = this._cutFov * k + this._cPrevFov - (c.fov ?? 50);
          this._cutT = 0;
          this._cutDur = clamp(1.2 + jump / 160, 1.4, 2.6);
        }
      }
      this._cPrev.copy(c.pos);
      this._cPrevLook.copy(c.look);
      this._cPrevFov = c.fov ?? 50;
      this._cHas = true;
      let ox = 0;
      if (this._cutT < 1) {
        this._cutT = Math.min(1, this._cutT + dt / this._cutDur);
        ox = 1 - easeInOut(this._cutT);
      }
      this.pos.copy(c.pos).addScaledVector(this._cutPos, ox);
      this.look.copy(c.look).addScaledVector(this._cutLook, ox);
      const cf = (c.fov ?? 50) + this._cutFov * ox;
      this.pos.lerp(this.gPos, 1 - w);
      this.look.lerp(this.gLook, 1 - w);
      this.fov = lerp(this.gFov, cf, w);
      this.roll = lerp(this.gRoll, c.roll ?? 0, w);
    } else {
      this._cHas = false;
      this._cutT = 1;
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

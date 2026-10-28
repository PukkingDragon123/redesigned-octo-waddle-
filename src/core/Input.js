// Unified keyboard / mouse / gamepad input with action mapping.
// Nothing here draws anything: SKYSONG has no on-screen prompts.

const KEYMAP = {
  swim: ['KeyW'],
  brake: ['KeyS'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['Space', 'ArrowUp'],
  down: ['KeyC', 'ArrowDown'], // not Ctrl: Ctrl+W/R/Q mid-flight would close or reload the tab
  surge: ['ShiftLeft', 'ShiftRight'],
  rollLeft: ['KeyQ'],
  rollRight: ['KeyE'],
  hum: ['KeyF', 'KeyH'],
  boom: ['KeyR'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter', 'Space'],
  menuUp: ['ArrowUp', 'KeyW'],
  menuDown: ['ArrowDown', 'KeyS'],
  menuLeft: ['ArrowLeft', 'KeyA'],
  menuRight: ['ArrowRight', 'KeyD'],
  back: ['Escape', 'Backspace'],
};

// Standard gamepad mapping indices
const GP = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.keysPressed = new Set();
    this.keysReleased = new Set();
    this.mouseButtons = 0;
    this.mousePressed = 0;
    this.mouseReleased = 0;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseX = 0; // NDC
    this.mouseY = 0;
    this.mouseMovedThisFrame = false;
    this.locked = false;
    this.lockWanted = false;
    this.anyPressed = false;
    this.gamepad = null;
    this.gpButtons = new Array(17).fill(0);
    this.gpPrev = new Array(17).fill(0);
    this.gpAxes = [0, 0, 0, 0];
    this.usingGamepad = false;
    this.gamepadBlocked = false;
    this.settings = { invertY: false, sensitivity: 1.0 };
    this.enabled = true;
    this.lastActivity = performance.now();

    const kd = (e) => {
      if (e.repeat) { if (this.capturesKey(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code);
      this.keysPressed.add(e.code);
      this.anyPressed = true;
      this.usingGamepad = false;
      this.lastActivity = performance.now();
      if (this.capturesKey(e.code)) e.preventDefault();
    };
    const ku = (e) => {
      this.keys.delete(e.code);
      this.keysReleased.add(e.code);
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => {
      for (const k of this.keys) this.keysReleased.add(k);
      this.keys.clear();
      this.mouseButtons = 0;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      const bit = 1 << e.button;
      this.mouseButtons |= bit;
      this.mousePressed |= bit;
      this.anyPressed = true;
      this.usingGamepad = false;
      this.lastActivity = performance.now();
      if (this.lockWanted && !this.locked) this.requestLock();
    });
    window.addEventListener('mouseup', (e) => {
      const bit = 1 << e.button;
      this.mouseButtons &= ~bit;
      this.mouseReleased |= bit;
    });
    window.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouseY = -(((e.clientY - r.top) / r.height) * 2 - 1);
      this.mouseMovedThisFrame = true;
      if (this.locked || (this.mouseButtons & 1)) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
      this.lastActivity = performance.now();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepad = e.gamepad.index;
    });
    this._initTouch(canvas);
  }

  /**
   * Touch, with no on-screen controls: drag to look (and swim while touching), two fingers to
   * hum, double-tap-and-hold to gather a sonic boom, a quick sideways flick to roll, a
   * three-finger tap to pause, and a tap on the floating menu text to choose it. Gestures map
   * onto the mouse buttons the game reads.
   */
  _initTouch(canvas) {
    this.touches = new Map();
    this.touchSwim = false;
    this.rollFlick = 0;
    let lastEnd = 0;
    const setPointer = (t) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = ((t.clientX - r.left) / r.width) * 2 - 1;
      this.mouseY = -(((t.clientY - r.top) / r.height) * 2 - 1);
      this.mouseMovedThisFrame = true;
    };
    const press = (bit) => { if (!(this.mouseButtons & bit)) { this.mouseButtons |= bit; this.mousePressed |= bit; } };
    const release = (bit) => { if (this.mouseButtons & bit) { this.mouseButtons &= ~bit; this.mouseReleased |= bit; } };
    const sync = () => {
      const n = this.touches.size;
      this.touchSwim = this.lockWanted && n >= 1;
      if (n >= 2) press(4); else release(4);
    };
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const now = performance.now();
      for (const t of e.changedTouches) {
        const boom = this.touches.size === 0 && now - lastEnd < 280;
        // menu: began while the menu was up; gesture: began with other fingers already down
        this.touches.set(t.identifier, {
          x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY, t0: now, boom,
          menu: !this.lockWanted, gesture: this.touches.size > 0,
        });
        if (boom && this.lockWanted) press(2);
        setPointer(t);
      }
      if (this.touches.size === 3 && this.lockWanted) this.touchPause = true;
      this.anyPressed = true;
      this.usingGamepad = false;
      this.lastActivity = now;
      sync();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const first = this.touches.keys().next().value;
      for (const t of e.changedTouches) {
        const tr = this.touches.get(t.identifier);
        if (!tr) continue;
        if (t.identifier === first && this.lockWanted) {
          this.mouseDX += (t.clientX - tr.x) * 1.4;
          this.mouseDY += (t.clientY - tr.y) * 1.4;
        }
        tr.x = t.clientX;
        tr.y = t.clientY;
        if (!this.lockWanted) setPointer(t);
      }
      this.lastActivity = performance.now();
    }, { passive: false });
    const end = (e) => {
      e.preventDefault();
      const now = performance.now();
      for (const t of e.changedTouches) {
        const tr = this.touches.get(t.identifier);
        if (!tr) continue;
        this.touches.delete(t.identifier);
        const dx = t.clientX - tr.x0, dy = t.clientY - tr.y0;
        const quick = now - tr.t0 < 250;
        if (tr.boom) release(2);
        if (!this.lockWanted && tr.menu && !tr.gesture && quick && Math.hypot(dx, dy) < 24) {
          // a one-finger tap begun in the menu: point and click (lifting the three-finger
          // pause tap must not click the menu it just opened)
          setPointer(t);
          this.mousePressed |= 1;
        } else if (this.lockWanted && quick && this.touches.size === 0 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 2) {
          this.rollFlick = Math.sign(dx);
        }
        // only a tap arms the double-tap boom (not a roll flick, not a menu tap)
        if (this.touches.size === 0 && quick && this.lockWanted && Math.hypot(dx, dy) < 24) lastEnd = now;
      }
      sync();
    };
    canvas.addEventListener('touchend', end, { passive: false });
    canvas.addEventListener('touchcancel', end, { passive: false });
  }

  capturesKey(code) {
    return ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(code);
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* pointer lock not available (e.g. sandboxed iframe): drag-to-look fallback */ }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  setGameplayMode(on) {
    this.lockWanted = on;
    if (!on) {
      this.releaseLock();
      this.touchSwim = false;
    }
  }

  update() {
    // Gamepad polling (getGamepads throws when a permissions policy blocks 'gamepad', e.g. in an
    // iframe: stop asking rather than fail every frame)
    let pads = [];
    if (!this.gamepadBlocked) {
      try { pads = navigator.getGamepads ? (navigator.getGamepads() || []) : []; } catch (e) { this.gamepadBlocked = true; }
    }
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    for (let i = 0; i < this.gpButtons.length; i++) this.gpPrev[i] = this.gpButtons[i];
    if (pad) {
      for (let i = 0; i < this.gpButtons.length; i++) {
        const b = pad.buttons[i];
        this.gpButtons[i] = b ? (typeof b === 'object' ? b.value : b) : 0;
      }
      const dz = (v) => (Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86);
      this.gpAxes[0] = dz(pad.axes[0] || 0);
      this.gpAxes[1] = dz(pad.axes[1] || 0);
      this.gpAxes[2] = dz(pad.axes[2] || 0);
      this.gpAxes[3] = dz(pad.axes[3] || 0);
      let active = false;
      for (let i = 0; i < 17; i++) if (this.gpButtons[i] > 0.5 && this.gpPrev[i] <= 0.5) active = true;
      for (let i = 0; i < 4; i++) if (Math.abs(this.gpAxes[i]) > 0.3) active = true;
      if (active) {
        this.usingGamepad = true;
        this.anyPressed = this.anyPressed || this.gpButtons.some((b, i) => b > 0.5 && this.gpPrev[i] <= 0.5);
        this.lastActivity = performance.now();
      }
    } else {
      this.gpButtons.fill(0);
      this.gpAxes.fill(0);
    }
  }

  endFrame() {
    this.keysPressed.clear();
    this.keysReleased.clear();
    this.mousePressed = 0;
    this.mouseReleased = 0;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.anyPressed = false;
    this.mouseMovedThisFrame = false;
    this.rollFlick = 0;
    this.touchPause = false;
  }

  _k(action) { return KEYMAP[action] || []; }
  key(action) { return this._k(action).some((c) => this.keys.has(c)); }
  keyPressed(action) { return this._k(action).some((c) => this.keysPressed.has(c)); }
  keyReleased(action) { return this._k(action).some((c) => this.keysReleased.has(c)); }
  gp(i) { return this.gpButtons[i] > 0.5; }
  gpPressed(i) { return this.gpButtons[i] > 0.5 && this.gpPrev[i] <= 0.5; }
  gpReleased(i) { return this.gpButtons[i] <= 0.5 && this.gpPrev[i] > 0.5; }

  // ---- Gameplay actions -------------------------------------------------
  get swim() {
    if (!this.enabled) return 0;
    let v = this.key('swim') || (this.mouseButtons & 1 && this.locked) || this.touchSwim ? 1 : 0;
    v = Math.max(v, this.gpButtons[GP.RT]);
    return v;
  }
  get brake() {
    if (!this.enabled) return 0;
    return Math.max(this.key('brake') ? 1 : 0, this.gpButtons[GP.LT]);
  }
  get surge() { return this.enabled && (this.key('surge') || this.gp(GP.L3)); }
  /** -1..1 yaw input (keyboard / left stick) */
  get turn() {
    if (!this.enabled) return 0;
    return (this.key('right') ? 1 : 0) - (this.key('left') ? 1 : 0) + this.gpAxes[0];
  }
  /** -1..1 pitch input, positive = up */
  get climb() {
    if (!this.enabled) return 0;
    let v = (this.key('up') ? 1 : 0) - (this.key('down') ? 1 : 0);
    v += this.gp(GP.A) ? 1 : 0;
    v -= this.gp(GP.B) ? 1 : 0;
    v += -this.gpAxes[1] * (this.settings.invertY ? -1 : 1);
    return Math.max(-1, Math.min(1, v));
  }
  /** Mouse / right-stick look delta in radians-ish units */
  get lookX() {
    if (!this.enabled) return 0;
    return this.mouseDX * 0.0022 * this.settings.sensitivity;
  }
  get lookY() {
    if (!this.enabled) return 0;
    return this.mouseDY * 0.0022 * this.settings.sensitivity * (this.settings.invertY ? -1 : 1);
  }
  get stickLookX() { return this.enabled ? this.gpAxes[2] * this.settings.sensitivity : 0; }
  get stickLookY() { return this.enabled ? this.gpAxes[3] * this.settings.sensitivity * (this.settings.invertY ? -1 : 1) : 0; }

  get rollLeftPressed() { return this.enabled && (this.keyPressed('rollLeft') || this.gpPressed(GP.LB) || this.rollFlick < 0); }
  get rollRightPressed() { return this.enabled && (this.keyPressed('rollRight') || this.gpPressed(GP.RB) || this.rollFlick > 0); }
  get hum() { return this.enabled && (this.key('hum') || this.gp(GP.X) || !!(this.mouseButtons & 4)); }
  get humPressed() { return this.enabled && (this.keyPressed('hum') || this.gpPressed(GP.X) || !!(this.mousePressed & 4)); }
  get humReleased() { return this.keyReleased('hum') || this.gpReleased(GP.X) || !!(this.mouseReleased & 4); }
  get boom() { return this.enabled && (this.key('boom') || this.gp(GP.Y) || !!(this.mouseButtons & 2)); }
  get boomPressed() { return this.enabled && (this.keyPressed('boom') || this.gpPressed(GP.Y) || !!(this.mousePressed & 2)); }
  get boomReleased() { return this.keyReleased('boom') || this.gpReleased(GP.Y) || !!(this.mouseReleased & 2); }
  get pausePressed() { return this.keyPressed('pause') || this.gpPressed(GP.START) || this.touchPause; }

  // ---- Menu actions ------------------------------------------------------
  get menuUp() { return this.keyPressed('menuUp') || this.gpPressed(GP.UP) || (this.gpAxes[1] < -0.6 && this._stickEdge('up')); }
  get menuDown() { return this.keyPressed('menuDown') || this.gpPressed(GP.DOWN) || (this.gpAxes[1] > 0.6 && this._stickEdge('down')); }
  get menuLeft() { return this.keyPressed('menuLeft') || this.gpPressed(GP.LEFT); }
  get menuRight() { return this.keyPressed('menuRight') || this.gpPressed(GP.RIGHT); }
  get menuConfirm() { return this.keyPressed('confirm') || this.gpPressed(GP.A); }
  get menuBack() { return this.keyPressed('back') || this.gpPressed(GP.B); }
  get clicked() { return !!(this.mousePressed & 1); }

  _stickEdge(dir) {
    const now = performance.now();
    if (!this._edge) this._edge = {};
    if (this._edge[dir] && now - this._edge[dir] < 280) return false;
    this._edge[dir] = now;
    return true;
  }
}

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
  // moves (src/game/Moves.js)
  slap: ['KeyX'],
  spout: ['KeyV'],
  loop: ['KeyZ'],
  dash: ['KeyG'],
  // the hunt (src/game/Hunt.js)
  bite: ['KeyB'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter', 'Space'],
  menuUp: ['ArrowUp', 'KeyW'],
  menuDown: ['ArrowDown', 'KeyS'],
  menuLeft: ['ArrowLeft', 'KeyA'],
  menuRight: ['ArrowRight', 'KeyD'],
  back: ['Escape', 'Backspace'],
};

/**
 * The controls as the Settings -> Controls page lists them (Menu.js reads these, so a new move
 * only needs adding here). Each entry is one line of text.
 */
export const CONTROL_LINES = {
  keyboard: [
    'Mouse — look, and swim where you look',
    'W  or  left click — swim        Shift — surge',
    'A  D — turn      Space  C — rise and dive',
    'Q  E — barrel roll  (tap again mid-roll: corkscrew)',
    'Z — loop        G  or  double-tap Shift — dash',
    'X — tail slap        V — spout  (bubbles under water)',
    'B — bite  (a lunge, jaws wide: hunt fish, birds and reef critters)',
    'Dive deep, then race up — breach',
    'F — hum  (hold to sing)',
    'R  or  right click — hold to gather a sonic boom, release',
    'Esc — pause',
  ],
  gamepad: [
    'Right stick — look      Left stick — steer      RT — swim',
    'LT — slow      L3 — surge      A — rise      B — bite',
    'LB  RB — barrel roll      D-pad left  or  R3 — loop',
    'D-pad down — tail slap      D-pad up — spout      D-pad right — dash',
    'X — hum      Y — hold to gather a sonic boom      Start — pause',
  ],
  touch: [
    'Drag — look, and swim where you look',
    'Two fingers — hum  (hold to sing);  a quick two-finger tap — spout',
    'Tap — bite;  flick sideways — barrel roll;  flick up — loop;  flick down — tail slap',
    'Double-tap — dash;  double-tap and hold — sonic boom, release',
    'Three fingers — pause',
  ],
};

// A friend on the same keyboard (local co-op, src/game/Friends.js): the right half. These keys are
// not P1's: they never count as P1's presses (cinematic skips, QTE presses).
const KEYMAP2 = {
  swim: ['KeyI'],
  brake: ['KeyK'],
  left: ['KeyJ'],
  right: ['KeyL'],
  up: ['KeyU'],
  down: ['KeyO'],
  surge: ['Semicolon'],
  roll: ['KeyM'],
  hum: ['KeyY'],
  bite: ['KeyN'],
  slap: ['Comma'],
  spout: ['Period'],
  loop: ['Slash'],
};
const P2_CODES = new Set(Object.values(KEYMAP2).flat());
/** The friend's controls (README "Play with a friend"; Settings -> Controls could list them). */
export const CONTROL_LINES_P2 = {
  keyboard: [
    'I — swim      K — slow      J  L — turn      U  O — rise and dive      ; — surge',
    'M — barrel roll      , — tail slap      . — spout      / — loop',
    'Y — hum  (hold to sing)      N — bite      Backspace — leave',
  ],
  gamepad: ['A second gamepad: Start or A to join, Back to leave; the same buttons as player one'],
};

// keys that steer the calf (a steer cue reads them; they never count as an act press)
const STEER_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyC',
  'ShiftLeft', 'ShiftRight', 'KeyQ', 'KeyE', 'Escape', 'KeyP', 'Tab', 'AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight']);

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

    this.lastTap = {};
    this.dashTap = false;
    // the friend's half of the keyboard, kept apart from P1's keys
    this.keys2 = new Set();
    this.keysPressed2 = new Set();
    this.padIndex = -1; // P1's gamepad
    this.p2 = new SecondInput(this);
    const kd = (e) => {
      if (e.repeat) { if (this.capturesKey(e.code)) e.preventDefault(); return; }
      if (P2_CODES.has(e.code)) { this.keys2.add(e.code); this.keysPressed2.add(e.code); if (e.code === 'Slash' || e.code === 'Semicolon') e.preventDefault(); return; }
      // double-tap Shift dashes
      const now0 = performance.now();
      const tapKey = e.code === 'ShiftLeft' || e.code === 'ShiftRight' ? 'Shift' : null;
      if (tapKey) {
        if (now0 - (this.lastTap[tapKey] || -1e9) < 280) { this.dashTap = true; this.lastTap[tapKey] = -1e9; } else this.lastTap[tapKey] = now0;
      }
      this.keys.add(e.code);
      this.keysPressed.add(e.code);
      this.anyPressed = true;
      this.usingGamepad = false;
      this.lastActivity = performance.now();
      if (this.capturesKey(e.code)) e.preventDefault();
    };
    const ku = (e) => {
      this.keys2.delete(e.code);
      this.keys.delete(e.code);
      this.keysReleased.add(e.code);
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => {
      for (const k of this.keys) this.keysReleased.add(k);
      this.keys.clear();
      this.keys2.clear();
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
    this.vFlick = 0; // +1 flick up (loop), -1 flick down (tail slap)
    this.twoTap = false; // a quick two-finger tap (spout)
    this.biteTap = false; // a single quick tap (bite), resolved once no second tap follows
    this._tapT = -1;
    let twoT0 = -1, twoMoved = false;
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
        this._tapT = -1; // a second finger or a second tap: not a bite
        this.touchAct = true; // a fresh finger is an act press (the wordless QTE cues, src/game/QTE.js)
        setPointer(t);
      }
      if (this.touches.size === 3 && this.lockWanted) this.touchPause = true;
      if (this.touches.size === 2) { twoT0 = now; twoMoved = false; } else if (this.touches.size > 2) twoT0 = -1;
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
        if (tr.boom) {
          release(2);
          // a quick double-tap (not held to gather a boom) is a dash
          if (quick && Math.hypot(dx, dy) < 30 && this.lockWanted) this.dashTap = true;
        }
        if (Math.hypot(dx, dy) > 30) twoMoved = true;
        if (!this.lockWanted && tr.menu && !tr.gesture && quick && Math.hypot(dx, dy) < 24) {
          // a one-finger tap begun in the menu: point and click (lifting the three-finger
          // pause tap must not click the menu it just opened)
          setPointer(t);
          this.mousePressed |= 1;
        } else if (this.lockWanted && quick && this.touches.size === 0 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 2) {
          this.rollFlick = Math.sign(dx);
        } else if (this.lockWanted && quick && this.touches.size === 0 && !tr.gesture && Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 2) {
          this.vFlick = -Math.sign(dy); // screen y grows downward: a flick up is +1
        }
        // only a tap arms the double-tap boom (not a roll flick, not a menu tap)
        if (this.touches.size === 0 && quick && this.lockWanted && Math.hypot(dx, dy) < 24 && !tr.boom && !tr.gesture) { lastEnd = now; this._tapT = now; }
        if (this.touches.size === 0 && twoT0 >= 0) {
          if (now - twoT0 < 300 && !twoMoved && this.lockWanted) this.twoTap = true;
          twoT0 = -1;
        }
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
    // P1 plays on the first gamepad; one a friend has taken (index p2.padIndex) is theirs
    for (const p of pads) if (p && p.connected && p.index !== this.p2.padIndex) { pad = p; break; }
    this.padIndex = pad ? pad.index : -1;
    this.p2.update(pads);
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
      // double-click L3 (surge) dashes
      if (this.gpPressed(GP.L3)) {
        const now = performance.now();
        if (now - (this._l3T ?? -1e9) < 300) { this.dashTap = true; this._l3T = -1e9; } else this._l3T = now;
      }
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
    // a lone tap becomes a bite once the double-tap window has passed
    if (this._tapT >= 0 && performance.now() - this._tapT > 290) {
      this._tapT = -1;
      if (this.lockWanted && this.touches.size === 0) this.biteTap = true;
    }
  }

  endFrame() {
    this.keysPressed.clear();
    this.keysPressed2.clear();
    this.p2.endFrame();
    this.keysReleased.clear();
    this.mousePressed = 0;
    this.mouseReleased = 0;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.anyPressed = false;
    this.mouseMovedThisFrame = false;
    this.rollFlick = 0;
    this.vFlick = 0;
    this.twoTap = false;
    this.biteTap = false;
    this.dashTap = false;
    this.touchPause = false;
    this.touchAct = false;
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
  // ---- moves (src/game/Moves.js) -------------------------------------------
  get slapPressed() { return this.enabled && (this.keyPressed('slap') || this.gpPressed(GP.DOWN) || this.vFlick < 0); }
  get spoutPressed() { return this.enabled && (this.keyPressed('spout') || this.gpPressed(GP.UP) || this.twoTap); }
  get loopPressed() { return this.enabled && (this.keyPressed('loop') || this.gpPressed(GP.LEFT) || this.gpPressed(GP.R3) || this.vFlick > 0); }
  get dashPressed() { return this.enabled && (this.keyPressed('dash') || this.gpPressed(GP.RIGHT) || this.dashTap); }
  /** The hunt's bite: B, gamepad B, or a single tap. */
  get bitePressed() { return this.enabled && (this.keyPressed('bite') || this.gpPressed(GP.B) || this.biteTap); }
  /** Rolls queued while a roll is spinning chain into a corkscrew (the press itself is enough). */
  get rollHeld() { return this.enabled && (this.key('rollLeft') || this.key('rollRight') || this.gp(GP.LB) || this.gp(GP.RB)); }

  // ---- act (the wordless QTE cues, src/game/QTE.js) ------------------------------------------
  // Any of the obvious "do it" inputs: Space, Enter, left click, a touch, gamepad A. The cues show
  // no key names, so the QTE also takes any other non-steering key or face button (actAny*).
  get actPressed() {
    return this.keysPressed.has('Space') || this.keysPressed.has('Enter') || this.keysPressed.has('NumpadEnter') ||
      !!(this.mousePressed & 1) || !!this.touchAct || this.gpPressed(GP.A);
  }
  get actDown() {
    return this.keys.has('Space') || this.keys.has('Enter') || this.keys.has('NumpadEnter') ||
      !!(this.mouseButtons & 1) || (this.touches?.size ?? 0) > 0 || this.gp(GP.A);
  }
  get actReleased() {
    return this.keysReleased.has('Space') || this.keysReleased.has('Enter') || !!(this.mouseReleased & 1) || this.gpReleased(GP.A);
  }
  /** act, or any other key / face button that does not steer (mashing anything works). */
  get actAnyPressed() {
    if (this.actPressed) return true;
    for (const c of this.keysPressed) if (!STEER_KEYS.has(c)) return true;
    return this.gpPressed(GP.B) || this.gpPressed(GP.X) || this.gpPressed(GP.Y) || !!(this.mousePressed & 2);
  }
  get actAnyDown() {
    if (this.actDown) return true;
    for (const c of this.keys) if (!STEER_KEYS.has(c)) return true;
    return this.gp(GP.B) || this.gp(GP.X) || this.gp(GP.Y) || !!(this.mouseButtons & 2);
  }

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

/**
 * The second player's input (local co-op, src/game/Friends.js): a second gamepad (Start or A to
 * join, Back to leave) or the right half of the keyboard (any of its keys joins, Backspace leaves).
 * It offers the getters PlayerController and Moves read, so a second controller can take it as is.
 */
export class SecondInput {
  constructor(main) {
    this.main = main;
    this.enabled = true;
    this.padIndex = -1; // the gamepad it has taken (-1: none)
    this.btn = new Array(17).fill(0);
    this.prev = new Array(17).fill(0);
    this.axes = [0, 0, 0, 0];
    this._edge = new Map(); // other pads: last Start / A state (join presses)
    this.joinPad = -1; // a free pad pressed Start or A this frame
    this.lastRollDir = 1;
  }

  update(pads) {
    const M = this.main;
    for (let i = 0; i < 17; i++) this.prev[i] = this.btn[i];
    this.joinPad = -1;
    let pad = null;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      if (p.index === this.padIndex) { pad = p; continue; }
      // a pad other than P1's pressing Start or A: a friend wants in
      const down = (p.buttons[9]?.value ?? p.buttons[9] ?? 0) > 0.5 || (p.buttons[0]?.value ?? p.buttons[0] ?? 0) > 0.5;
      const was = this._edge.get(p.index) || false;
      this._edge.set(p.index, down);
      if (down && !was && p.index !== M.padIndex && this.padIndex < 0) this.joinPad = p.index;
    }
    if (this.padIndex >= 0 && !pad) this.padIndex = -1; // unplugged
    if (pad) {
      for (let i = 0; i < 17; i++) { const b = pad.buttons[i]; this.btn[i] = b ? (typeof b === 'object' ? b.value : b) : 0; }
      const dz = (v) => (Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86);
      for (let i = 0; i < 4; i++) this.axes[i] = dz(pad.axes[i] || 0);
    } else {
      this.btn.fill(0);
      this.axes.fill(0);
    }
  }

  endFrame() {}

  // keyboard half
  _k(a) { return KEYMAP2[a].some((c) => this.main.keys2.has(c)); }
  _kp(a) { return KEYMAP2[a].some((c) => this.main.keysPressed2.has(c)); }
  get keysUsed() { return this.main.keysPressed2.size > 0; }
  get leavePressed() { return this.main.keysPressed.has('Backspace') || (this.btn[GP.BACK] > 0.5 && this.prev[GP.BACK] <= 0.5); }
  gp(i) { return this.btn[i] > 0.5; }
  gpPressed(i) { return this.btn[i] > 0.5 && this.prev[i] <= 0.5; }

  get swim() { return this.enabled ? Math.max(this._k('swim') ? 1 : 0, this.btn[GP.RT]) : 0; }
  get brake() { return this.enabled ? Math.max(this._k('brake') ? 1 : 0, this.btn[GP.LT]) : 0; }
  get surge() { return this.enabled && (this._k('surge') || this.gp(GP.L3)); }
  get turn() {
    if (!this.enabled) return 0;
    const t = (this._k('right') ? 1 : 0) - (this._k('left') ? 1 : 0) + this.axes[0];
    if (Math.abs(t) > 0.3) this.lastRollDir = t > 0 ? -1 : 1;
    return t;
  }
  get climb() {
    if (!this.enabled) return 0;
    const v = (this._k('up') ? 1 : 0) - (this._k('down') ? 1 : 0) + (this.gp(GP.A) ? 1 : 0) - this.axes[1];
    return Math.max(-1, Math.min(1, v));
  }
  get lookX() { return 0; }
  get lookY() { return 0; }
  get stickLookX() { return this.enabled ? this.axes[2] : 0; }
  get stickLookY() { return this.enabled ? this.axes[3] : 0; }
  get rollLeftPressed() { return this.enabled && (this.gpPressed(GP.LB) || (this._kp('roll') && this.lastRollDir > 0)); }
  get rollRightPressed() { return this.enabled && (this.gpPressed(GP.RB) || (this._kp('roll') && this.lastRollDir < 0)); }
  get rollHeld() { return this.enabled && (this._k('roll') || this.gp(GP.LB) || this.gp(GP.RB)); }
  get hum() { return this.enabled && (this._k('hum') || this.gp(GP.X)); }
  get boom() { return this.enabled && this.gp(GP.Y); }
  get slapPressed() { return this.enabled && (this._kp('slap') || this.gpPressed(GP.DOWN)); }
  get spoutPressed() { return this.enabled && (this._kp('spout') || this.gpPressed(GP.UP)); }
  get loopPressed() { return this.enabled && (this._kp('loop') || this.gpPressed(GP.LEFT) || this.gpPressed(GP.R3)); }
  get dashPressed() { return this.enabled && this.gpPressed(GP.RIGHT); }
  get bitePressed() { return this.enabled && (this._kp('bite') || this.gpPressed(GP.B)); }
}

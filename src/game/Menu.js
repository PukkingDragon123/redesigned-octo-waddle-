// The cinematic menu: a few lines of elegant floating text placed in the sky in front of the
// drifting camera. No panels, no frames. Mouse hover/click, keyboard and gamepad all work.
import {
  Mesh, PlaneGeometry, ShaderMaterial, CanvasTexture, LinearFilter, Group, Raycaster, Vector2, Vector3,
  Quaternion, SRGBColorSpace,
} from 'three';
import { damp, clamp, lerp, smoothstep } from '../core/math.js';
import { CONTROL_LINES } from '../core/Input.js';

// Lettering: Cinzel Decorative for the SKYSONG logo, Cinzel (carved Roman capitals) for the menu
// lines, Cormorant Garamond italic for the subtitles (all loaded in index.html; Story.init waits).
export const FONTS = {
  logo: '"Cinzel Decorative", "Cinzel", Georgia, "Times New Roman", serif',
  caps: '"Cinzel", "Trajan Pro", Georgia, "Times New Roman", serif',
  italic: '"Cormorant Garamond", "Cormorant", Georgia, "Times New Roman", serif',
};
const FONT = FONTS.caps;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
uniform float uGlow;
uniform float uDissolve;
uniform float uTime;
uniform vec3 uTint;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
void main() {
  vec4 t = texture2D(uMap, vUv);
  float core = t.a;
  float halo = t.r; // red channel holds the blurred glow
  float d = n(vUv * vec2(18.0, 5.0) + uTime * 0.3);
  float keep = smoothstep(uDissolve - 0.08, uDissolve + 0.08, d);
  // crisp letters over a soft dark halo (legible on bright dawn skies) plus a glow on hover.
  // Letters are slightly over-bright so they still read as white after tone mapping.
  float shadowA = halo * 0.46 * uOpacity * keep;
  float textA = core * uOpacity * keep;
  vec3 col = uTint * 1.3 * (1.0 + uGlow * 0.3) * textA + uTint * halo * uGlow * 0.3 * uOpacity * keep;
  float a = max(textA, shadowA);
  gl_FragColor = vec4(col, a);
}
`;

function makeTextTexture(text, size = 96, opts = {}) {
  const pad = size * 0.6;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const weight = opts.weight ?? 300;
  const spacing = opts.spacing ?? 0.08;
  const font = opts.font || (opts.italic ? FONTS.italic : FONT);
  ctx.font = `${opts.italic ? 'italic ' : ''}${weight} ${size}px ${font}`;
  // manual letter spacing
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * size * (chars.length - 1);
  c.width = Math.ceil(total + pad * 2);
  c.height = Math.ceil(size * 1.5 + pad * 2);
  const draw = (blur, style) => {
    ctx.font = `${opts.italic ? 'italic ' : ''}${weight} ${size}px ${font}`;
    ctx.textBaseline = 'middle';
    ctx.filter = blur ? `blur(${blur}px)` : 'none';
    ctx.fillStyle = style;
    let x = pad;
    chars.forEach((ch, i) => {
      ctx.fillText(ch, x, c.height / 2);
      x += widths[i] + spacing * size;
    });
  };
  // glow goes to the red channel only, crisp letters to alpha
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, c.width, c.height);
  // alpha mask
  draw(0, 'rgba(255,255,255,1)');
  const crisp = ctx.getImageData(0, 0, c.width, c.height);
  ctx.clearRect(0, 0, c.width, c.height);
  draw(size * 0.22, 'rgba(255,255,255,1)');
  const glow = ctx.getImageData(0, 0, c.width, c.height);
  const out = ctx.createImageData(c.width, c.height);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = glow.data[i + 3];
    out.data[i + 1] = 0;
    out.data[i + 2] = 0;
    out.data[i + 3] = crisp.data[i + 3];
  }
  ctx.putImageData(out, 0, 0);
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  return { tex, w: c.width, h: c.height };
}

class TextItem {
  constructor(text, height, opts = {}) {
    this.text = text;
    this.height = height;
    this.opts = opts;
    this.u = {
      uMap: { value: null }, uOpacity: { value: 0 }, uGlow: { value: 0 }, uDissolve: { value: 0 },
      uTime: { value: 0 }, uTint: { value: opts.tint || new Vector3(1, 0.98, 0.95) },
    };
    this.mat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, transparent: true,
      depthTest: false, depthWrite: false, premultipliedAlpha: true,
    });
    this.mat.blending = 5; // CustomBlending
    this.mat.blendSrc = 201; // OneFactor
    this.mat.blendDst = 205; // OneMinusSrcAlphaFactor
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.mat);
    this.mesh.renderOrder = 100;
    this.mesh.frustumCulled = false;
    this.mesh.userData.item = this;
    this.opacity = 0;
    this.targetOpacity = 0;
    this.glow = 0;
    this.hover = false;
    this.dissolve = 0;
    this.setText(text);
  }

  setText(text) {
    this.text = text;
    if (this.u.uMap.value) this.u.uMap.value.dispose();
    const { tex, w, h } = makeTextTexture(text, this.opts.size ?? 96, this.opts);
    this.u.uMap.value = tex;
    const aspect = w / h;
    this.mesh.scale.set(this.height * aspect, this.height, 1);
    this.width = this.height * aspect;
  }

  update(dt, t) {
    this.opacity = damp(this.opacity, this.targetOpacity, 2.5, dt);
    this.glow = damp(this.glow, this.hover ? 1 : 0, 6, dt);
    this.u.uOpacity.value = this.opacity * (this.opts.dim ? 0.55 : 1) * (0.78 + 0.22 * this.glow);
    this.u.uGlow.value = 0.25 + this.glow * 0.9;
    this.u.uDissolve.value = this.dissolve;
    this.u.uTime.value = t;
  }
}

export class Menu {
  constructor(game, opts = {}) {
    this.game = game;
    this.group = new Group();
    this.group.name = 'menu';
    // the lettering stays crisp: no brush strokes or depth of field, but graded and faded with the frame
    (game.engine.sceneUI || game.engine.sceneT).add(this.group);
    this.page = null;
    this.items = [];
    this.sel = 0;
    this.visible = false;
    this.ray = new Raycaster();
    this.mouse = new Vector2();
    this.t = 0;
    this.anchor = new Vector3();
    this.anchorQ = new Quaternion();
    this.onAction = opts.onAction || (() => {});
    this.hasSave = opts.hasSave || (() => false);
    this.title = new TextItem('SKYSONG', 8.4, { size: 150, weight: 700, spacing: 0.2, font: FONTS.logo, tint: new Vector3(1, 0.95, 0.84) });
    this.subtitle = new TextItem('a whole life across the seas of Vur Sok', 2.7, { size: 72, italic: true, weight: 400, spacing: 0.05 });
    this.group.add(this.title.mesh, this.subtitle.mesh);
    this.dist = 34;
  }

  show(page = 'main') {
    this.visible = true;
    this.build(page);
  }

  hide() {
    this.visible = false;
    for (const it of this.items) it.targetOpacity = 0;
    this.title.targetOpacity = 0;
    this.subtitle.targetOpacity = 0;
  }

  dissolveAll() {
    this.dissolving = true;
  }

  build(page) {
    for (const it of this.items) {
      this.group.remove(it.mesh);
      it.u.uMap.value.dispose();
      it.mat.dispose();
    }
    this.items = [];
    this.page = page;
    const s = this.game.settings;
    const pct = (v) => `${Math.round(v * 100)}%`;
    let entries = [];
    if (page === 'main') {
      entries = [['New Game', 'new']];
      if (this.hasSave()) entries.push(['Continue', 'continue']);
      entries.push(['Settings', 'settings']);
    } else if (page === 'pause') {
      entries = [['Resume', 'resume'], ['Settings', 'settings'], ['Return to the Title', 'title']];
    } else if (page === 'settings') {
      entries = [
        [`Quality — ${s.quality[0].toUpperCase() + s.quality.slice(1)}${s.autoQuality ? ' (auto)' : ''}`, 'quality'],
        [`Music — ${pct(s.music)}`, 'music'],
        [`Sound — ${pct(s.sound)}`, 'sound'],
        [`Invert Look — ${s.invertY ? 'On' : 'Off'}`, 'invert'],
        [`Look Speed — ${s.sensitivity.toFixed(1)}`, 'sens'],
        ['Controls', 'controls'],
        ['Back', 'back'],
      ];
    } else if (page === 'controls' && navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches) {
      entries = [...CONTROL_LINES.touch.map((l) => [l, null]), ['Back', 'back']];
    } else if (page === 'controls') {
      entries = [...(this.game.input.usingGamepad ? CONTROL_LINES.gamepad : CONTROL_LINES.keyboard).map((l) => [l, null]), ['Back', 'back']];
    }
    const small = page === 'controls';
    const h = small ? 1.85 : page === 'settings' ? 2.7 : 3.5;
    const gap = small ? 2.4 : page === 'settings' ? 3.5 : 4.5;
    // under the title on the main and pause pages, vertically centred elsewhere
    const top = page === 'main' || page === 'pause' ? 0 : (entries.length - 1) * gap * 0.5;
    entries.forEach(([label, action], i) => {
      const it = new TextItem(label, h * (small ? 0.92 : 0.86), { size: small ? 60 : 80, weight: small ? 400 : 500, spacing: small ? 0.06 : 0.16, dim: action === null, font: small ? FONTS.italic : FONT });
      it.action = action;
      it.mesh.position.set(0, top - i * gap, 0);
      it.baseY = top - i * gap;
      it.index = i;
      this.group.add(it.mesh);
      this.items.push(it);
      it.targetOpacity = 1;
      it.opacity = 0;
    });
    this.sel = this.items.findIndex((it) => it.action);
    // with a save, Continue is the default (a stray confirm must not start over)
    const cont = this.items.findIndex((it) => it.action === 'continue');
    if (cont >= 0) this.sel = cont;
    const showTitle = page === 'main' || page === 'pause';
    this.title.targetOpacity = showTitle ? 1 : 0;
    this.subtitle.targetOpacity = page === 'main' ? 0.85 : 0;
    this.title.mesh.position.set(0, 8.2, 0);
    this.subtitle.mesh.position.set(0, 4.9, 0);
    // left-align items under the title
    const left = -this.title.width * 0.5;
    for (const it of this.items) it.mesh.position.x = left + it.width * 0.5 + 0.4;
    this.subtitle.mesh.position.x = left + this.subtitle.width * 0.5 + 0.2;
  }

  select(i) {
    const n = this.items.length;
    for (let k = 0; k < n; k++) {
      const j = (((i + k) % n) + n) % n;
      if (this.items[j].action) { this.sel = j; return; }
    }
  }

  /** Rebuild the page after a settings change, keeping the selection and each line's fade. */
  refresh() {
    const sel = this.sel, prev = this.items.map((it) => [it.opacity, it.glow]);
    this.build(this.page);
    this.items.forEach((it, i) => { if (prev[i]) [it.opacity, it.glow] = prev[i]; });
    this.sel = sel;
    this.game.saveSettings();
    this.onAction('settingsChanged');
  }

  activate(it) {
    if (!it || !it.action) return;
    const s = this.game.settings;
    const a = it.action;
    const refresh = () => this.refresh();
    if (a === 'settings') return this.build('settings');
    if (a === 'controls') return this.build('controls');
    if (a === 'back') return this.build(this.page === 'controls' ? 'settings' : this.returnPage || 'main');
    if (a === 'quality') { const q = ['high', 'medium', 'low']; s.quality = q[(q.indexOf(s.quality) + 1) % 3]; s.autoQuality = false; return refresh(); }
    if (a === 'music') { s.music = s.music >= 0.95 ? 0 : Math.min(1, Math.round((s.music + 0.2) * 10) / 10); return refresh(); }
    if (a === 'sound') { s.sound = s.sound >= 0.95 ? 0 : Math.min(1, Math.round((s.sound + 0.2) * 10) / 10); return refresh(); }
    if (a === 'invert') { s.invertY = !s.invertY; return refresh(); }
    if (a === 'sens') { s.sensitivity = Math.round(((s.sensitivity + 0.25 - 0.25) % 2 + 0.25) * 100) / 100; if (s.sensitivity > 2) s.sensitivity = 0.25; return refresh(); }
    this.onAction(a);
  }

  adjust(it, dir) {
    if (!it) return;
    const s = this.game.settings;
    const a = it.action;
    const refresh = () => this.refresh();
    if (a === 'music') { s.music = clamp(Math.round((s.music + dir * 0.1) * 10) / 10, 0, 1); refresh(); }
    else if (a === 'sound') { s.sound = clamp(Math.round((s.sound + dir * 0.1) * 10) / 10, 0, 1); refresh(); }
    else if (a === 'sens') { s.sensitivity = clamp(Math.round((s.sensitivity + dir * 0.25) * 100) / 100, 0.25, 2.5); refresh(); }
    else if (a === 'quality' || a === 'invert') this.activate(it);
  }

  update(dt) {
    this.t += dt;
    const g = this.game, inp = g.input, cam = g.engine.camera;
    // float in front of the camera in the left third, lagging gently; narrow screens shrink it
    const fwd = cam.getWorldDirection(new Vector3());
    const right = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0)).normalize();
    const halfH = this.dist * Math.tan((cam.fov * Math.PI) / 360);
    const halfW = halfH * cam.aspect;
    const fit = Math.min(1, (halfW * 1.68) / this.title.width, (halfH * 1.7) / 26);
    this.group.scale.setScalar(fit);
    const across = -halfW * 0.86 + this.title.width * 0.5 * fit;
    const target = cam.position.clone().addScaledVector(fwd, this.dist).addScaledVector(right, across).add(new Vector3(0, -this.dist * 0.04, 0));
    // snap on the first frame and after camera cuts, glide otherwise
    if (this.anchor.lengthSq() === 0 || this.anchor.distanceTo(target) > this.dist * 0.5) {
      this.anchor.copy(target);
      this.anchorQ.copy(cam.quaternion);
    }
    this.anchor.lerp(target, 1 - Math.exp(-dt * 2.2));
    this.group.position.copy(this.anchor);
    this.anchorQ.slerp(cam.quaternion, 1 - Math.exp(-dt * 2.2));
    this.group.quaternion.copy(this.anchorQ);
    const bob = Math.sin(this.t * 0.6) * 0.12;
    this.group.position.y += bob;

    if (this.dissolving) {
      for (const it of [...this.items, this.title, this.subtitle]) it.dissolve = Math.min(1.1, it.dissolve + dt * 0.9);
    }
    if (this.visible && !this.dissolving) {
      // input
      if (inp.menuUp) this.select(this.sel - 1);
      if (inp.menuDown) this.select(this.sel + 1);
      const cur = this.items[this.sel];
      if (inp.menuLeft) this.adjust(cur, -1);
      if (inp.menuRight) this.adjust(cur, 1);
      if (inp.menuConfirm) this.activate(cur);
      if (inp.menuBack && this.page !== 'main') {
        // Esc toggles pause in Story; here only Backspace / gamepad B resume (else Esc would reopen and close in one frame)
        if (this.page === 'pause') { if (!inp.pausePressed) this.onAction('resume'); }
        else this.build(this.page === 'controls' ? 'settings' : this.returnPage || 'main');
      }
      // mouse hover
      if (inp.mouseMovedThisFrame || inp.clicked) {
        this.mouse.set(inp.mouseX, inp.mouseY);
        this.ray.setFromCamera(this.mouse, cam);
        this.group.updateMatrixWorld(true);
        const hits = this.ray.intersectObjects(this.items.filter((i) => i.action).map((i) => i.mesh), false);
        if (hits.length) {
          const it = hits[0].object.userData.item;
          this.sel = this.items.indexOf(it);
          if (inp.clicked) this.activate(it);
        }
      }
    }
    this.items.forEach((it, i) => {
      it.hover = this.visible && i === this.sel && !!it.action;
      it.mesh.position.y = it.baseY + Math.sin(this.t * 0.8 + i * 0.7) * 0.05;
      const sc = 1 + it.glow * 0.04;
      it.mesh.scale.y = it.height * sc;
      it.mesh.scale.x = it.width * sc;
      it.update(dt, this.t);
    });
    this.title.update(dt, this.t);
    this.subtitle.update(dt, this.t);
  }
}

// Renderer orchestration: shadow pass -> opaque (MSAA HDR) -> mid passes (painterly AO first)
// -> transparent pass (ocean, clouds, mist) -> post (bloom, rays, grade, tonemap) -> painterly
// paint pass (strokes, depth of field, painted grade, canvas) to the screen.
import {
  WebGLRenderer, Scene, PerspectiveCamera, WebGLRenderTarget, HalfFloatType, DepthTexture,
  UnsignedIntType, LinearFilter, NearestFilter, Vector3, NoToneMapping, RGBAFormat,
} from 'three';
import { G } from './Globals.js';
import { Shadows } from './Shadows.js';
import { PostFX } from './PostFX.js';
import { PainterlyPost } from './painterly/PainterlyPost.js';

// paint: the painterly quality (PainterlyPost): >= 0.75 full 33-tap strokes and 3-slice AO, >= 0.4
// 17-tap strokes and 2 slices, below that no strokes (painted grade, canvas, 1-slice AO only).
export const QUALITY = {
  high: { scale: 1.0, maxDpr: 1.5, samples: 4, shadow: 2048, fur: 1.0, cloudSteps: 1.0, clouds: 1.0, rays: true, paint: 1 },
  medium: { scale: 0.85, maxDpr: 1.25, samples: 4, shadow: 2048, fur: 0.7, cloudSteps: 0.75, clouds: 0.8, rays: true, paint: 0.6 },
  low: { scale: 0.7, maxDpr: 1.0, samples: 2, shadow: 1024, fur: 0.45, cloudSteps: 0.55, clouds: 0.55, rays: false, paint: 0.3 },
};

// The painted looks (engine.setLook): depth of field preset and paint strength.
//   title      miniature depth of field on the herd (tilt bands, soft islands and sky)
//   gameplay   only the far distance softens a little, focus follows the subject at screen centre
//   cinematic  shallow focus on a subject (pass focusOn: a world position, tracked every frame)
//   plain      no strokes or depth of field (debug comparisons)
export const LOOKS = {
  title: { dof: 'title', strength: 1 },
  gameplay: { dof: 'gameplay', strength: 1 },
  cinematic: { dof: 'cinematic', strength: 1 },
  plain: { dof: 'off', strength: 0 },
};

export class Engine {
  constructor(canvas, qualityName = 'high', opts = {}) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve,
    });
    this.renderer.autoClear = false;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setClearColor(0x000000, 1);
    this.scene = new Scene();
    this.sceneT = new Scene();
    // drawn over the finished frame, before the paint pass, and protected from its strokes and depth
    // of field (the title menu's lettering): crisp, but still graded, canvas-textured and faded
    this.sceneUI = new Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this.camera = new PerspectiveCamera(52, 1, 0.4, 16000);
    this.camera.position.set(0, 150, 30);
    this.shadowFocus = new Vector3();
    this.midPasses = [];
    this.beforeRender = [];
    this.qualityName = qualityName;
    this.quality = QUALITY[qualityName] || QUALITY.high;
    this.shadows = new Shadows(this.quality.shadow);
    this.post = new PostFX(this);
    this.post.raysEnabled = this.quality.rays;
    // the painted look: soft GTAO into the HDR frame as the FIRST mid pass (right after the opaque
    // pass, before the transparent one), then strokes, depth of field and canvas on the graded frame
    this.painterly = new PainterlyPost(this.renderer, { quality: this.quality.paint });
    this.painterly.sea = true; // the ocean writes no depth: its flat plane stands in for it
    this.midPasses.unshift(this.painterly.aoPass);
    this.post.painterly = this.painterly;
    this._look = {
      name: 'gameplay', dof: 'gameplay', over: null, strength: 1, target: 1, ease: 1.5,
      amount: 1, pending: null, focusOn: null, last: -1, _v: new Vector3(),
    };
    this.painterly.setDof('gameplay');
    this.rt = null;
    this.width = 1;
    this.height = 1;
    this._createTarget();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // a restored context has lost every target's contents: restart the painterly histories
    canvas.addEventListener('webglcontextrestored', () => {
      this.renderer.properties.get(this.rt).__useRenderToTexture = false;
      this.painterly.ao.invalidate();
      this.painterly.paint._focusValid = false;
    });
  }

  /**
   * The painted look: 'title' | 'gameplay' | 'cinematic' | 'plain' (see LOOKS), eased in.
   * opts: strength (0..1 paint strength), dof (preset name or an object of DOF overrides),
   * focusOn (Vector3 kept in focus, tracked every frame; null: autofocus at focusUv),
   * focusUv ({x, y} 0..1 screen point the autofocus looks at), focus (fixed focus distance in m,
   * disables autofocus), ease (seconds, default 1.5; 0 switches at once).
   */
  setLook(name, opts = {}) {
    const base = LOOKS[name] || LOOKS.gameplay;
    const L = this._look;
    const pp = this.painterly;
    const dof = typeof opts.dof === 'string' ? opts.dof : base.dof;
    const over = opts.dof && typeof opts.dof === 'object' ? Object.assign({}, opts.dof) : {};
    if (opts.focus !== undefined) {
      over.focus = opts.focus;
      over.autoFocus = false;
    }
    L.name = name;
    L.target = opts.strength ?? base.strength;
    L.ease = opts.ease ?? 1.5;
    L.focusOn = opts.focusOn || null;
    if (opts.focusUv) pp.paint.dof.focusUv.set(opts.focusUv.x, opts.focusUv.y);
    else if (!L.focusOn) pp.paint.dof.focusUv.set(0.5, 0.5);
    if (L.ease <= 0) {
      L.strength = L.target;
      L.pending = null;
      L.dof = dof;
      L.over = over;
      pp.setDof(dof, over);
      L.amount = 1;
    } else if (dof !== L.dof || L.pending) {
      // fade the current depth of field out, then the new one in
      L.pending = dof;
      L.over = over;
    } else {
      pp.setDof(dof, over);
      L.over = over;
    }
    return this;
  }

  /** Per frame: ease the paint strength and depth of field, track the focus subject. */
  _updateLook(cam) {
    const L = this._look;
    const pp = this.painterly;
    const now = performance.now() / 1000;
    const dt = L.last < 0 ? 0 : Math.min(0.1, now - L.last);
    L.last = now;
    const k = L.ease > 0 ? Math.min(1, dt / L.ease) : 1;
    L.strength += Math.sign(L.target - L.strength) * Math.min(Math.abs(L.target - L.strength), k);
    pp.strength = L.strength;
    if (L.pending) {
      L.amount -= k * 2;
      if (L.amount <= 0) {
        L.amount = 0;
        L.dof = L.pending;
        L.pending = null;
        pp.setDof(L.dof, L.over);
        pp.paint._focusValid = false;
      }
    } else {
      L.amount = Math.min(1, L.amount + k * 2);
    }
    const d = pp.paint.dof;
    const preset = pp.dofPresets[L.dof] || pp.dofPresets.off;
    d.amount = (L.over?.amount ?? preset.amount ?? 0) * L.amount;
    if (L.focusOn) {
      const v = L._v.copy(L.focusOn).project(cam);
      if (v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2) {
        d.focusUv.set(Math.min(0.97, Math.max(0.03, v.x * 0.5 + 0.5)), Math.min(0.97, Math.max(0.03, v.y * 0.5 + 0.5)));
      }
    }
  }

  setQuality(name) {
    const q = QUALITY[name];
    if (!q) return;
    const samplesChanged = q.samples !== this.quality.samples;
    this.qualityName = name;
    this.quality = q;
    this.shadows.setSize(q.shadow);
    this.post.raysEnabled = q.rays;
    this.painterly.setQuality(q.paint);
    if (samplesChanged) {
      this.rt.dispose();
      this._createTarget();
    }
    this.resize();
  }

  _createTarget() {
    const samples = Math.max(2, this.quality.samples);
    const depth = new DepthTexture(4, 4, UnsignedIntType);
    depth.minFilter = NearestFilter;
    depth.magFilter = NearestFilter;
    this.rt = new WebGLRenderTarget(4, 4, {
      type: HalfFloatType, format: RGBAFormat, samples, depthBuffer: true, stencilBuffer: false,
      depthTexture: depth, minFilter: LinearFilter, magFilter: LinearFilter,
    });
    // Never use render-to-texture MSAA: the depth texture must stay separate from the
    // multisampled framebuffer so transparent passes can sample it.
    this.renderer.properties.get(this.rt).__useRenderToTexture = false;
    G.uDepthTex.value = depth;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.maxDpr);
    const w = Math.max(1, Math.floor(window.innerWidth));
    const h = Math.max(1, Math.floor(window.innerHeight));
    this.renderer.setPixelRatio(dpr * this.quality.scale);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const pw = Math.max(1, Math.floor(w * dpr * this.quality.scale));
    const ph = Math.max(1, Math.floor(h * dpr * this.quality.scale));
    this.width = pw;
    this.height = ph;
    this.rt.setSize(pw, ph);
    // setSize disposes the target's GPU state, and with it this override
    this.renderer.properties.get(this.rt).__useRenderToTexture = false;
    this.post.setSize(pw, ph);
    for (const p of this.midPasses) p.setSize?.(pw, ph);
    if (!this.midPasses.includes(this.painterly.aoPass)) this.painterly.setSize(pw, ph);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    G.uResolution.value.set(pw, ph);
  }

  /**
   * Compile every material under the given roots now, hidden objects included, plus the shadow-pass
   * variant of every caster, so no shader compiles mid-journey when something first appears.
   * Programs are keyed by render target, so compile against the HDR target the scene draws into.
   */
  precompile(roots) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    try {
      for (const root of roots) r.compile(root, this.camera, root.isScene ? root : this.scene);
      for (const c of this.shadows.casters) {
        const m = c.mesh.material;
        c.mesh.material = c.depthMat;
        r.compile(c.mesh, this.shadows.cam, this.scene);
        c.mesh.material = m;
      }
    } catch (e) {
      console.warn('[skysong] precompile', e);
    } finally {
      r.setRenderTarget(prev);
    }
    // the post chain: every painterly variant, the composite as it renders into the paint target,
    // and the passes that only run under water
    this.painterly.precompile(this.camera);
    this.post.precompile?.(r);
  }

  render() {
    const r = this.renderer;
    // count every pass of the frame, not just the last one
    r.info.autoReset = false;
    r.info.reset();
    const cam = this.camera;
    cam.updateMatrixWorld();
    G.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    G.uNearFar.value.set(cam.near, cam.far);
    for (const f of this.beforeRender) f(cam);

    this.shadows.update(this.shadowFocus, G.uSunDir.value);
    this.shadows.render(r, this.scene);

    r.setRenderTarget(this.rt);
    r.clear(true, true, false);
    r.render(this.scene, cam);

    // the AO must come first: it shades the opaque frame before anything is drawn over it
    const ao = this.painterly.aoPass;
    if (this.midPasses[0] !== ao) {
      const i = this.midPasses.indexOf(ao);
      if (i > 0) {
        this.midPasses.splice(i, 1);
        this.midPasses.unshift(ao);
      }
    }
    for (const p of this.midPasses) p.render(r, this.rt, cam);

    r.setRenderTarget(this.rt);
    r.render(this.sceneT, cam);

    this._updateLook(cam);
    this.post.render(r, this.rt, cam);
  }
}

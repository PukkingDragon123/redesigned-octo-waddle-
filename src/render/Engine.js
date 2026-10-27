// Renderer orchestration: shadow pass -> opaque (MSAA HDR) -> mid passes (cloud sea)
// -> transparent pass (clouds, mist, water) -> post.
import {
  WebGLRenderer, Scene, PerspectiveCamera, WebGLRenderTarget, HalfFloatType, DepthTexture,
  UnsignedIntType, LinearFilter, NearestFilter, Vector3, NoToneMapping, RGBAFormat,
} from 'three';
import { G } from './Globals.js';
import { Shadows } from './Shadows.js';
import { PostFX } from './PostFX.js';

export const QUALITY = {
  high: { scale: 1.0, maxDpr: 1.5, samples: 4, shadow: 2048, fur: 1.0, cloudSteps: 1.0, clouds: 1.0, rays: true },
  medium: { scale: 0.85, maxDpr: 1.25, samples: 4, shadow: 2048, fur: 0.7, cloudSteps: 0.75, clouds: 0.8, rays: true },
  low: { scale: 0.7, maxDpr: 1.0, samples: 2, shadow: 1024, fur: 0.45, cloudSteps: 0.55, clouds: 0.55, rays: false },
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
    this.rt = null;
    this.width = 1;
    this.height = 1;
    this._createTarget();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(name) {
    const q = QUALITY[name];
    if (!q) return;
    const samplesChanged = q.samples !== this.quality.samples;
    this.qualityName = name;
    this.quality = q;
    this.shadows.setSize(q.shadow);
    this.post.raysEnabled = q.rays;
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

    for (const p of this.midPasses) p.render(r, this.rt, cam);

    r.setRenderTarget(this.rt);
    r.render(this.sceneT, cam);

    this.post.render(r, this.rt, cam);
  }
}

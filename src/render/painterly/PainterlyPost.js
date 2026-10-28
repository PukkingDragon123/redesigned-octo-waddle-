// PainterlyPost: the Tiny Glade-like painted look as two insertion points in the frame.
//
//   1. AO (HDR, after the opaque pass, before the transparent pass):
//        post.renderAO(depthTex, camera)   half-res GTAO + bilateral blur + temporal history
//        post.applyAO(hdrTarget)           multiplies a cool-tinted occlusion into the HDR target
//      or simply push `post.aoPass` to the front of engine.midPasses (it does both).
//   2. Paint (LDR, after tonemapping/grading, instead of writing the composite to the screen):
//        render the composite into post.ldrTarget, then
//        post.apply(post.ldrTarget.texture, depthTex, camera, null, { strength, dof, time })
//
// Everything is created up front; precompile(camera) compiles every program behind the title.
import { PerspectiveCamera } from 'three';
import { AOPass } from './AOPass.js';
import { PaintPass, DOF_PRESETS } from './PaintPass.js';

const NO_OPTS = Object.freeze({});

export class PainterlyPost {
  /**
   * @param {WebGLRenderer} renderer
   * @param {{ quality?: number, ao?: object, paint?: object }} opts  ao / paint: parameter overrides
   *   (see AO_DEFAULTS and PAINT_DEFAULTS)
   */
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.enabled = true;
    this.aoEnabled = true;
    this.paintEnabled = true;
    this.strength = 1;
    this.ao = new AOPass(renderer, { quality: opts.quality ?? 1, params: opts.ao });
    this.paint = new PaintPass(renderer, { quality: opts.quality ?? 1, params: opts.paint });
    this.quality = opts.quality ?? 1;
    this.width = 1;
    this.height = 1;
    const self = this;
    // drop-in for engine.midPasses: runs right after the opaque pass, before the transparent one
    this.aoPass = {
      render(r, rt, cam) {
        if (!self.enabled || !self.aoEnabled) {
          self.ao.invalidate();
          return;
        }
        self.renderAO(rt.depthTexture, cam);
        self.applyAO(rt);
      },
      setSize(w, h) { self.setSize(w, h); },
    };
  }

  get dofPresets() { return DOF_PRESETS; }
  get aoParams() { return this.ao.params; }
  get paintParams() { return this.paint.params; }
  /** The LDR target the composite should render into while the paint pass is on. */
  get ldrTarget() { return this.paint.ldr; }
  /** The AO texture of the current frame (half res; r visibility, g direct-sun estimate, b sunlit neighbourhood). */
  get aoTexture() { return this.ao.texture; }
  /** Whether the flat sea at G.uSeaLevel counts as a surface (the ocean writes no depth). */
  set sea(v) { this.ao.sea = v; this.paint.sea = v; }
  get sea() { return this.paint.sea; }
  /** Screen x (0..1) left of which the passes are bypassed, for before/after comparisons. */
  set split(x) { this.ao.split = x; this.paint.split = x; }
  get split() { return this.paint.split; }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    this.ao.setSize(w, h);
    this.paint.setSize(w, h);
  }

  /** 0..1. >= 0.75 high, >= 0.4 medium, below: low (no Kuwahara, 1-slice AO). Never compiles. */
  setQuality(q) {
    this.quality = q;
    this.ao.setQuality(q);
    this.paint.setQuality(q);
  }

  /** Depth of field: 'off' | 'gameplay' | 'title' | 'cinematic', plus overrides. */
  setDof(name, over) { return this.paint.setDof(name, over); }

  renderAO(depthTex, camera) {
    return this.ao.render(depthTex, camera);
  }

  applyAO(target) {
    this.ao.apply(target);
  }

  /**
   * The painted frame: Kuwahara strokes, depth of field, grade, canvas, edge darkening, dither.
   * input is the tonemapped, display-encoded frame; out null draws to the screen.
   */
  apply(input, depthTex, camera, out = null, opts = NO_OPTS) {
    const on = this.enabled && this.paintEnabled;
    // switched off, the frame still passes through (with dither) so the caller's flow never changes
    this.paint.render(input, depthTex, camera, out, opts, on ? (opts.strength ?? this.strength) : 0, on);
  }

  /** Compile every program now (all quality variants), so nothing compiles mid-journey. */
  precompile(camera = new PerspectiveCamera()) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    try {
      const into = [
        [this.ao.prep[0], [this.ao.prepPass]],
        [this.ao.raw, [this.ao.gtaoPass, this.ao.blurPass, this.ao.temporalPass, this.ao.applyPass]],
        [this.paint.tensorA, [this.paint.tensorPass, this.paint.blurPass, this.paint.dofDownPass, this.paint.dofGatherPass]],
        [this.paint.focusRT[0], [this.paint.focusPass]],
        [null, [...this.paint.paintPasses, this.ao.debugPass, this.ao.debugSunPass, this.ao.debugRawPass, this.ao.debugNormalPass]],
      ];
      for (const [target, passes] of into) {
        r.setRenderTarget(target);
        for (const p of passes) r.compile(p.mesh, camera);
      }
    } catch (e) {
      console.warn('[painterly] precompile', e);
    } finally {
      r.setRenderTarget(prev);
    }
  }

  dispose() {
    this.ao.dispose();
    this.paint.dispose();
  }
}

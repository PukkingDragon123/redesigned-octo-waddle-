// The painted look, on the tonemapped (display-encoded LDR) frame:
//
//   tensor     half-res structure tensor (Sobel on the 2x2-prefiltered frame), then a separable
//              Gaussian, so brush directions follow coherent edges instead of pixel noise
//   [dof]      gentle depth of field at half resolution: CoC from depth (the sea plane stands in for
//              the depth-less ocean), far-weighted downsample, scatter-as-gather disc blur that never
//              lets sharp foreground leak into the blurred background (no silhouette halos), and a
//              1x1 GPU autofocus with eased focus pulls
//   paint      one full-res pass: anisotropic Kuwahara (kuwahara.js) with a radius that scales with
//              resolution, eases off near the camera and on isolated fine detail (eyes, specks);
//              the DOF blend; a painterly grade (split tone, vibrance that calms loud colours, soft
//              S-curve, coloured blacks and paper white); a screen-stable canvas weave; a soft
//              tinted edge darkening; dither.
import {
  WebGLRenderTarget, HalfFloatType, FloatType, UnsignedByteType, RGBAFormat, LinearFilter, NearestFilter,
  Vector2, Vector3, Vector4, Color, GLSL3, NoBlending, ClampToEdgeWrapping, Matrix4,
} from 'three';
import { FullscreenPass, FS_VERT } from '../FullscreenPass.js';
import { G } from '../Globals.js';
import { VIEW, SURFACE, HASH, COC } from './glsl.js';
import { buildKernel, kuwaharaGLSL } from './kuwahara.js';

const TENSOR = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uSrcTexel;
uniform vec2 uDst;
layout(location = 0) out vec4 o;
vec3 px(vec2 uv) { return texture(tColor, uv).rgb; }
void main() {
  // half-res texel centres sit on full-res texel corners: every tap is a 2x2 box average
  vec2 uv = gl_FragCoord.xy / uDst;
  vec2 d = uSrcTexel * 2.0;
  vec3 tl = px(uv + vec2(-d.x, d.y)), tc = px(uv + vec2(0.0, d.y)), tr = px(uv + d);
  vec3 ml = px(uv - vec2(d.x, 0.0)), mr = px(uv + vec2(d.x, 0.0));
  vec3 bl = px(uv - d), bc = px(uv - vec2(0.0, d.y)), br = px(uv + vec2(d.x, -d.y));
  vec3 gx = (tr + 2.0 * mr + br - tl - 2.0 * ml - bl) * 0.25;
  vec3 gy = (tl + 2.0 * tc + tr - bl - 2.0 * bc - br) * 0.25;
  o = vec4(dot(gx, gx), dot(gy, gy), dot(gx, gy), 1.0);
}
`;

const BLUR5 = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDst;
uniform vec2 uDir;
uniform float uW[5];
layout(location = 0) out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uDst;
  vec2 st = uDir / uDst;
  vec4 acc = texture(tSrc, uv) * uW[0];
  for (int i = 1; i < 5; i++) acc += (texture(tSrc, uv + st * float(i)) + texture(tSrc, uv - st * float(i))) * uW[i];
  o = acc;
}
`;

const FOCUS = /* glsl */ `
uniform highp sampler2D tDepth;
uniform sampler2D tPrev;
uniform vec4 uFocusCtl;   // xy focus point (uv), z ease (0..1 this frame), w reset
${VIEW}
${SURFACE}
layout(location = 0) out vec4 o;
void main() {
  // the nearest solid subject above the water around the focus point (a whale, a rock) wins;
  // with none there, the sea at the focus point; with no sea either, the far distance
  float zo = 1.0e9;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 uv = clamp(uFocusCtl.xy + vec2(float(i) * 0.035, float(j) * 0.05), vec2(0.001), vec2(0.999));
      float d = texture(tDepth, uv).r;
      if (d < 1.0) {
        float z = linZ(d);
        if (surfaceZ(uv, z) >= z * 0.999) zo = min(zo, z);
      }
    }
  }
  float zf = zo < 1.0e8 ? zo : min(surfaceZ(uFocusCtl.xy, 6000.0), 6000.0);
  zf = clamp(zf, 1.0, 6000.0);
  float prev = texture(tPrev, vec2(0.5)).r;
  float f = (uFocusCtl.w > 0.5 || !(prev > 0.0)) ? zf : exp(mix(log(prev), log(zf), uFocusCtl.z));
  o = vec4(f, 0.0, 0.0, 1.0);
}
`;

const DOF_DOWN = /* glsl */ `
uniform sampler2D tColor;
uniform highp sampler2D tDepth;
uniform vec2 uFull;
${VIEW}
${SURFACE}
${COC}
layout(location = 0) out vec4 o;
void main() {
  ivec2 fp = ivec2(gl_FragCoord.xy) * 2;
  ivec2 fmax = ivec2(uFull) - 1;
  float focus = dofFocus();
  vec3 acc = vec3(0.0);
  float ws = 0.0, cmax = 0.0, cmin = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      ivec2 q = min(fp + ivec2(i, j), fmax);
      vec2 uv = (vec2(q) + 0.5) / uFull;
      float k = cocFromZ(uv, sceneZ(uv, texelFetch(tDepth, q, 0).r), focus);
      vec3 c = texelFetch(tColor, q, 0).rgb;
      // blurrier pixels dominate, so a texel straddling a sharp silhouette belongs to the blur
      float w = 0.05 + abs(k);
      acc += c * c * w;   // ~linear light, so bright detail keeps its weight in the blur
      ws += w;
      cmax = max(cmax, k);
      cmin = min(cmin, k);
    }
  }
  o = vec4(acc / ws, cmax >= -cmin ? cmax : cmin);
}
`;

const DOF_GATHER = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uHalf;
uniform vec2 uKernel[32];
uniform int uTaps;
layout(location = 0) out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uHalf;
  vec4 c = texture(tSrc, uv);
  float r = abs(c.a);
  if (r < 0.5) { o = c; return; }
  vec3 acc = c.rgb;
  float ws = 1.0;
  for (int i = 0; i < 32; i++) {
    if (i >= uTaps) break;
    vec2 k = uKernel[i];
    float dist = length(k) * r;
    vec4 s = texture(tSrc, uv + k * (r / uHalf));
    // scatter-as-gather: a sample reaches this pixel only if its own blur is that wide
    float w = clamp(abs(s.a) - dist + 1.0, 0.0, 1.0);
    acc += s.rgb * w;
    ws += w;
  }
  o = vec4(acc / ws, c.a);
}
`;

function paintFrag(kernel) {
  return /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tTensor;
uniform highp sampler2D tDepth;
uniform sampler2D tDof;
uniform vec2 uTexel;
uniform vec2 uDofHalf;
uniform vec4 uKuw;        // x radius (px), y anisotropy alpha, z mix, w highlight protection
uniform vec4 uKuwDepth;   // x near start (m), y full strength from (m), z near scale, w far scale
uniform float uHard;      // sector variance hardness
uniform vec4 uStroke;     // x fine texture kept under the strokes, y bristle streaks, z bristle length (px at 1080p)
uniform vec4 uGradeA;     // x split tone, y vibrance, z loud-colour calming, w S-curve
uniform vec3 uShadeTone;
uniform vec3 uLightTone;
uniform vec3 uShadeLift;  // the deep shade colour the darkest values lean toward
uniform vec4 uGradeB;     // x shadow lift, y dark desaturation, z shadow hue lean, w day factor
uniform vec3 uBlack;
uniform vec3 uWhite;
uniform vec4 uGrain;      // x amount, y thread period (px at 1080p), z px scale (height / 1080), w fibre mix
uniform vec4 uVig;        // x amount, y inner, z outer, w aspect
uniform vec3 uVigTint;
uniform float uDofOn;
uniform float uSplit;
uniform float uDebug;
${VIEW}
${SURFACE}
${HASH}
${COC}
layout(location = 0) out vec4 o;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

#ifdef KUWAHARA
${kernel ? kuwaharaGLSL(kernel) : ''}
#endif

vec3 dofSample(vec2 uv, float coc) {
  vec2 hp = uv * uDofHalf - 0.5;
  ivec2 b = ivec2(floor(hp));
  vec2 f = hp - vec2(b);
  ivec2 hmax = ivec2(uDofHalf) - 1;
  vec3 acc = vec3(0.0);
  float ws = 0.0;
  for (int j = 0; j <= 1; j++) {
    for (int i = 0; i <= 1; i++) {
      vec4 s = texelFetch(tDof, clamp(b + ivec2(i, j), ivec2(0), hmax), 0);
      float bw = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
      float w = bw / (0.25 + abs(abs(s.a) - abs(coc)));
      acc += s.rgb * w;
      ws += w;
    }
  }
  return sqrt(max(acc / max(ws, 1e-5), 0.0));
}

vec3 grade(vec3 c) {
  float l = dot(c, LUMA);
  // harmonious shadows: the darks lean toward one shade hue at their own value, a little muted,
  // and lift a touch (painted, never inky); night keeps its depth
  float sh = (1.0 - smoothstep(0.0, 0.45, l)) * uGradeB.w;
  vec3 hue = uShadeLift / max(dot(uShadeLift, LUMA), 1e-4);
  c = mix(c, hue * l, sh * uGradeB.z);
  c = mix(c, vec3(dot(c, LUMA)), sh * uGradeB.y);
  c += uShadeLift * sh * uGradeB.x;
  c *= mix(vec3(1.0), uShadeTone, (1.0 - smoothstep(0.0, 0.5, l)) * uGradeA.x);
  c *= mix(vec3(1.0), uLightTone, smoothstep(0.45, 1.0, l) * uGradeA.x);
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float sat = (mx - mn) / max(mx, 1e-4);
  // vibrance lifts muted colours; only loud colours (bright and saturated) are calmed
  float vib = uGradeA.y * (1.0 - sat) * (1.0 - sat) - uGradeA.z * smoothstep(0.5, 1.0, sat) * smoothstep(0.35, 0.85, mx);
  c = max(mix(vec3(dot(c, LUMA)), c, 1.0 + vib), 0.0);
  c = clamp(c, 0.0, 1.0);
  c = mix(c, c * c * (3.0 - 2.0 * c), uGradeA.w);
  vec3 blk = uBlack * uGradeB.w;
  return blk + c * (uWhite - blk);
}

// Plain-weave canvas height (0..1), fixed to the screen like the canvas under a painting: threads
// wander and vary in thickness from thread to thread, with fibres and soft sizing blotches.
float canvas(vec2 p) {
  vec2 q = p / uGrain.y;
  vec2 wob = (vec2(pNoise(p * 0.031), pNoise(p * 0.029 + 19.3)) - 0.5) * 1.6;
  vec2 g = q + wob;
  float thickX = 0.65 + 0.9 * pHash12(vec2(floor(g.x + 0.5), 3.7));
  float thickY = 0.65 + 0.9 * pHash12(vec2(floor(g.y + 0.5), 9.1));
  float tx = pow(0.5 + 0.5 * cos(g.x * 6.2831853), thickX);
  float ty = pow(0.5 + 0.5 * cos(g.y * 6.2831853), thickY);
  float over = 0.5 + 0.5 * sin(q.x * 3.14159265) * sin(q.y * 3.14159265);
  float h = mix(tx * (0.45 + 0.55 * ty), ty * (0.45 + 0.55 * tx), over);
  float fib = 0.5 * pNoise(vec2(p.x * 0.7, p.y * 0.11) + 7.0) + 0.5 * pNoise(vec2(p.x * 0.11, p.y * 0.7) + 3.0);
  float blot = pNoise(p * 0.012 + 41.0) * 0.6 + pNoise(p * 0.004 + 11.0) * 0.4;
  return mix(h, fib, uGrain.w) * 0.8 + blot * 0.2;
}

void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec3 src = texture(tColor, uv).rgb;
  vec3 col = src;
  if (uv.x >= uSplit) {
    float z = sceneZ(uv, texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r);
    float coc = 0.0, dofT = 0.0;
    if (uDofOn > 0.5) {
      coc = cocFromZ(uv, z, dofFocus());
      dofT = smoothstep(0.3, 1.3, abs(coc));
    }
#ifdef KUWAHARA
    if (dofT < 0.999 && uKuw.x > 0.0) {
      vec3 g = texture(tTensor, uv).xyz;            // E, G, F
      float tr = g.x + g.y;
      float disc = sqrt(max((g.x - g.y) * (g.x - g.y) + 4.0 * g.z * g.z, 0.0));
      float l1 = 0.5 * (tr + disc), l2 = 0.5 * (tr - disc);
      vec2 e1a = vec2(g.z, l1 - g.x), e1b = vec2(l1 - g.y, g.z);
      vec2 e1 = dot(e1a, e1a) > dot(e1b, e1b) ? e1a : e1b;
      vec2 t = dot(e1, e1) > 1e-14 ? normalize(vec2(-e1.y, e1.x)) : vec2(1.0, 0.0);
      // anisotropy only where there is structure (flat sky gradients stay round)
      float A = tr > 1e-9 ? (l1 - l2) / (l1 + l2) * smoothstep(1.0e-5, 1.5e-4, l1) : 0.0;
      float zr = smoothstep(uKuwDepth.x, uKuwDepth.y, z);
      float r = uKuw.x * mix(uKuwDepth.z, 1.0, zr) * mix(1.0, uKuwDepth.w, smoothstep(600.0, 4000.0, z));
      float keep = 0.0;
      if (r > 0.35) {
        float a = r * clamp((uKuw.y + A) / uKuw.y, 0.1, 2.0);
        float b = r * clamp(uKuw.y / (uKuw.y + A), 0.1, 2.0);
        vec2 ax = t * a * uTexel;
        vec2 by = vec2(-t.y, t.x) * b * uTexel;
        vec3 k = kuwahara(uv, ax, by);
        // a painter keeps the sparkle (eye glints, specular dots) and paints over dark speckle
        keep = smoothstep(0.08, 0.24, dot(src - k, LUMA)) * uKuw.w;
        // and suggests the fine texture rather than erasing it: some of it stays under the strokes
        // (less along strong coherent edges, where the stroke itself draws the form), so textured
        // surfaces read as brushwork instead of flat posterised cells
        k += (src - k) * uStroke.x * (1.0 - 0.5 * A);
        // bristles: fine grain fixed to the canvas, smeared along the stroke direction (a short line
        // integral), so every stroke carries a brush texture that follows the form
        if (uStroke.y > 0.0) {
          vec2 fp = gl_FragCoord.xy / uGrain.z;
          vec2 st = t * (uStroke.z * 0.25);
          float bn = 0.0;
          for (int i = -2; i <= 2; i++) bn += pNoise((fp + st * float(i)) * 0.6);
          bn = bn * 0.2 - 0.5;
          k *= 1.0 + bn * uStroke.y * (0.4 + 0.6 * A) * min(r / uKuw.x, 1.0);
        }
        col = mix(src, mix(k, src, keep), uKuw.z);
      }
      if (uDebug > 0.5) col = vec3(r / max(uKuw.x, 1e-3), A, keep);
    }
#endif
    if (dofT > 0.0) col = mix(col, dofSample(uv, coc), dofT);
    if (uDebug < 0.5) {
      col = grade(col);
      float h = canvas(gl_FragCoord.xy / uGrain.z) - 0.5;
      float l = dot(col, LUMA);
      col *= 1.0 + h * uGrain.x * (0.55 + (1.0 - l));
      vec2 vd = (uv - 0.5) * vec2(uVig.w, 1.0);
      col = mix(col, col * uVigTint, smoothstep(uVig.y, uVig.z, length(vd)) * uVig.x);
    }
  }
  col += (pIgn(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}
`;
}

const NO_OPTS = Object.freeze({});

function gaussW(sigma) {
  const w = [];
  let s = 0;
  for (let i = 0; i < 5; i++) {
    w[i] = Math.exp(-(i * i) / (2 * sigma * sigma));
    s += i === 0 ? w[i] : 2 * w[i];
  }
  return w.map((x) => x / s);
}

/** Vogel (golden angle) disk, sorted by radius. */
function vogelDisk(n) {
  const out = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    out.push(new Vector2(Math.cos(i * ga) * r, Math.sin(i * ga) * r));
  }
  while (out.length < 32) out.push(new Vector2());
  return out;
}

function rt(w, h, type, filter = LinearFilter, format = RGBAFormat) {
  return new WebGLRenderTarget(w, h, {
    type, format, minFilter: filter, magFilter: filter, depthBuffer: false, stencilBuffer: false,
    generateMipmaps: false, wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping,
  });
}

export const PAINT_DEFAULTS = {
  radius: 3.6, // Kuwahara radius in px at 1080p (scaled with the frame height)
  alpha: 0.75, // anisotropy (smaller: longer strokes along edges)
  mix: 1.0,
  hardness: 140, // sector variance hardness (higher: crisper, more posterised strokes)
  texture: 0.3, // fine texture kept under the strokes (0: flat Kuwahara cells, 1: no strokes)
  bristle: 0.12, // brush-bristle streaks along the strokes
  bristleLen: 9, // their length (px at 1080p)
  detail: 0.85, // how much small bright detail (eye glints, sparkle) the filter must keep
  nearStart: 3, // metres: from here the filter eases in...
  nearFull: 45, // ...to full strength
  nearScale: 0.3, // filter radius right at the lens
  farScale: 1.25, // radius far away (distant land reads as broader strokes)
  split: 0.45, // split-tone strength
  vibrance: 0.22,
  calm: 0.12, // pull back the loudest saturations
  curve: 0.12, // soft S-curve
  lift: 0.45, // additive shadow lift (by shadeLift)
  hueLean: 0.22, // how far the darks lean toward the shade hue (value preserved)
  shadeLift: new Color(0.075, 0.062, 0.078), // deep violet-grey: the shadows' shared hue and lift
  darkCalm: 0.2, // muted (not inky) deep shadows
  shadeTone: new Color(0.98, 0.98, 1.02), // cool, slightly violet shadows
  lightTone: new Color(1.05, 1.0, 0.92), // warm highlights
  black: new Color(0.014, 0.012, 0.02), // painted (never pure) black
  white: new Color(0.985, 0.97, 0.935), // warm paper white
  grain: 0.05, // canvas strength
  thread: 3.4, // canvas thread period (px at 1080p)
  fibre: 0.4,
  vignette: 0.22,
  vigInner: 0.55,
  vigOuter: 1.2,
  vigTint: new Color(0.82, 0.76, 0.72), // warm umber edge
};

export const DOF_PRESETS = {
  off: { amount: 0 },
  // gameplay: only the far distance softens a little (focus follows the subject)
  gameplay: { amount: 1, autoFocus: true, sharp: 0.55, farRamp: 0.45, far: 2.2, near: 0, nearRamp: 1, tilt: 0 },
  // title menu: miniature-like, focus on the herd, islands and sky soft, gentle tilt bands
  title: { amount: 1, autoFocus: true, sharp: 0.22, farRamp: 0.6, far: 5.5, near: 3.0, nearRamp: 0.7, tilt: 1.6, tiltCenter: 0.5, tiltBand: 0.18 },
  // cinematic close moments: shallow, strong separation
  cinematic: { amount: 1, autoFocus: true, sharp: 0.12, farRamp: 0.4, far: 6, near: 5, nearRamp: 0.4, tilt: 0 },
};

export class PaintPass {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.params = {};
    for (const [k, v] of Object.entries(PAINT_DEFAULTS)) this.params[k] = v && v.isColor ? v.clone() : v;
    Object.assign(this.params, opts.params || {});
    this.dof = Object.assign({ focus: 60, focusUv: new Vector2(0.5, 0.5), focusRate: 2.5 }, DOF_PRESETS.off);
    this.split = 0;
    this.debug = 0;
    this.sea = opts.sea ?? true; // the flat sea at G.uSeaLevel stands in for the depth-less ocean
    this.width = 1;
    this.height = 1;
    this.halfW = 1;
    this.halfH = 1;
    this.level = 2; // 2 full kernel, 1 light kernel, 0 no Kuwahara
    this._focusCur = 0;
    this._focusValid = false;
    this._lastTime = null;

    const fType = renderer.extensions?.has?.('EXT_color_buffer_float') ? FloatType : HalfFloatType;
    this.tensorA = rt(1, 1, HalfFloatType);
    this.tensorB = rt(1, 1, HalfFloatType);
    this.dofA = rt(1, 1, HalfFloatType);
    this.dofB = rt(1, 1, HalfFloatType);
    this.focusRT = [rt(1, 1, fType, NearestFilter), rt(1, 1, fType, NearestFilter)];
    // the tonemapped frame the composite should render into when the painterly pass is on
    this.ldr = rt(1, 1, UnsignedByteType);

    this.u = {
      uProj: { value: new Vector4(1, 1, 0, 0) },
      uDepthLin: { value: new Vector2(-1, -1) },
      uViewInv: { value: new Matrix4() },
      uCamPos: { value: new Vector3() },
      uSeaY: G.uSeaLevel || { value: 0 },
      uSeaOn: { value: 1 },
      uDofA: { value: new Vector4() },
      uDofB: { value: new Vector4() },
      uDofC: { value: new Vector2(0.5, 0.5) },
      tFocus: { value: null },
    };
    const u = this.u;
    const mk = (frag, uniforms, extra = {}) => new FullscreenPass(Object.assign({
      vertexShader: FS_VERT, fragmentShader: frag, glslVersion: GLSL3, uniforms,
    }, extra));
    const view = { uProj: u.uProj, uDepthLin: u.uDepthLin, uViewInv: u.uViewInv, uCamPos: u.uCamPos, uSeaY: u.uSeaY, uSeaOn: u.uSeaOn };
    const coc = { uDofA: u.uDofA, uDofB: u.uDofB, uDofC: u.uDofC, tFocus: u.tFocus };

    this.tensorPass = mk(TENSOR, { tColor: { value: null }, uSrcTexel: { value: new Vector2() }, uDst: { value: new Vector2() } });
    this.blurPass = mk(BLUR5, { tSrc: { value: null }, uDst: { value: new Vector2() }, uDir: { value: new Vector2(1, 0) }, uW: { value: gaussW(1.6) } });
    this.focusPass = mk(FOCUS, Object.assign({ tDepth: { value: null }, tPrev: { value: null }, uFocusCtl: { value: new Vector4(0.5, 0.5, 0.1, 1) } }, view));
    this.dofDownPass = mk(DOF_DOWN, Object.assign({ tColor: { value: null }, tDepth: { value: null }, uFull: { value: new Vector2() } }, view, coc));
    this.dofGatherPass = mk(DOF_GATHER, { tSrc: { value: null }, uHalf: { value: new Vector2() }, uKernel: { value: vogelDisk(24) }, uTaps: { value: 24 } });

    // 0: no strokes (low), 1: 17 samples (medium), 2: 33 samples (high)
    this.kernels = [null, buildKernel({ rings: 2 }), buildKernel({ rings: 4 })];
    const paintUniforms = Object.assign({
      tColor: { value: null }, tTensor: { value: null }, tDepth: { value: null }, tDof: { value: null },
      uTexel: { value: new Vector2() }, uDofHalf: { value: new Vector2(1, 1) },
      uKuw: { value: new Vector4() }, uKuwDepth: { value: new Vector4() }, uHard: { value: 140 },
      uStroke: { value: new Vector4() },
      uGradeA: { value: new Vector4() }, uShadeTone: { value: new Vector3() }, uLightTone: { value: new Vector3() },
      uShadeLift: { value: new Vector3() }, uGradeB: { value: new Vector4() },
      uBlack: { value: new Vector3() }, uWhite: { value: new Vector3() },
      uGrain: { value: new Vector4() }, uVig: { value: new Vector4() }, uVigTint: { value: new Vector3() },
      uDofOn: { value: 0 }, uSplit: { value: 0 }, uDebug: { value: 0 },
    }, view, coc);
    this.paintPasses = this.kernels.map((k) => {
      const p = mk(paintFrag(k), paintUniforms, { defines: k ? { KUWAHARA: 1 } : {} });
      p.material.blending = NoBlending;
      return p;
    });
    this.paintUniforms = paintUniforms;
    this.passes = [this.tensorPass, this.blurPass, this.focusPass, this.dofDownPass, this.dofGatherPass, ...this.paintPasses];
    const names = ['tensor', 'tensorBlur', 'focus', 'dofDown', 'dofGather', 'paint0', 'paint1', 'paint2'];
    this.passes.forEach((p, i) => { p.material.name = 'painterly-' + names[i]; });
    this.setQuality(opts.quality ?? 1);
  }

  setQuality(q) {
    this.quality = q;
    this.level = q >= 0.75 ? 2 : q >= 0.4 ? 1 : 0;
    this.dofGatherPass.uniforms.uTaps.value = q >= 0.75 ? 24 : q >= 0.4 ? 16 : 10;
  }

  /** Apply a DOF preset by name ('off' | 'gameplay' | 'title' | 'cinematic') plus overrides. */
  setDof(name, over = {}) {
    const keep = { focus: this.dof.focus, focusUv: this.dof.focusUv, focusRate: this.dof.focusRate };
    this.dof = Object.assign(keep, DOF_PRESETS.off, DOF_PRESETS[name] || {}, over);
    return this.dof;
  }

  setSize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.halfW = Math.max(1, (w + 1) >> 1);
    this.halfH = Math.max(1, (h + 1) >> 1);
    for (const t of [this.tensorA, this.tensorB, this.dofA, this.dofB]) t.setSize(this.halfW, this.halfH);
    this.ldr.setSize(w, h);
  }

  _camera(camera) {
    const e = camera.projectionMatrix.elements;
    this.u.uProj.value.set(e[0], e[5], e[8], e[9]);
    this.u.uDepthLin.value.set(e[10], e[14]);
    this.u.uViewInv.value.copy(camera.matrixWorld);
    this.u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    this.u.uSeaOn.value = this.sea ? 1 : 0;
  }

  /**
   * input: display-encoded LDR frame (e.g. this.ldr.texture), depth: the resolved opaque depth.
   * opts: { strength 0..1 (default 1), dof: preset name or object or false, time (s) }
   * strength / dofAllowed override opts (PainterlyPost passes them, so no per-frame objects).
   */
  render(input, depth, camera, out = null, opts = NO_OPTS, strength = opts.strength ?? 1, dofAllowed = true) {
    const r = this.renderer;
    const p = this.params;
    const s = strength;
    const res = this.height / 1080;
    this._camera(camera);
    if (typeof opts.dof === 'string') {
      if (opts.dof !== this._dofName) this.setDof(opts.dof);
      this._dofName = opts.dof;
    } else if (opts.dof === false) {
      this.dof.amount = 0;
      this._dofName = null;
    } else if (opts.dof && typeof opts.dof === 'object') {
      Object.assign(this.dof, opts.dof);
      this._dofName = null;
    }
    const level = s > 0 ? this.level : 0;
    const pass = this.paintPasses[level];
    const U = this.paintUniforms;

    // structure tensor (only when the Kuwahara variant runs)
    if (level > 0) {
      const t = this.tensorPass.uniforms;
      t.tColor.value = input;
      t.uSrcTexel.value.set(1 / this.width, 1 / this.height);
      t.uDst.value.set(this.halfW, this.halfH);
      this.tensorPass.render(r, this.tensorA);
      const b = this.blurPass.uniforms;
      b.uDst.value.set(this.halfW, this.halfH);
      b.tSrc.value = this.tensorA.texture;
      b.uDir.value.set(1, 0);
      this.blurPass.render(r, this.tensorB);
      b.tSrc.value = this.tensorB.texture;
      b.uDir.value.set(0, 1);
      this.blurPass.render(r, this.tensorA);
    }

    // depth of field
    const d = this.dof;
    const dofOn = dofAllowed && d.amount > 0 && (d.far > 0 || d.near > 0 || d.tilt > 0);
    if (dofOn) {
      const k = d.amount * res;
      this.u.uDofA.value.set(d.focus, d.sharp ?? 0.3, (d.far || 0) * k, (d.near || 0) * k);
      this.u.uDofB.value.set((d.tilt || 0) * k, d.tiltCenter ?? 0.5, d.tiltBand ?? 0.16, d.autoFocus ? 1 : 0);
      this.u.uDofC.value.set(d.farRamp ?? 0.5, d.nearRamp ?? 0.5);
      if (d.autoFocus) {
        const time = opts.time ?? performance.now() / 1000;
        const dt = this._lastTime === null ? 1 / 60 : Math.min(0.25, Math.max(0, time - this._lastTime));
        this._lastTime = time;
        const f = this.focusPass.uniforms;
        const next = this._focusCur ^ 1;
        f.tDepth.value = depth;
        f.tPrev.value = this.focusRT[this._focusCur].texture;
        f.uFocusCtl.value.set(d.focusUv.x, d.focusUv.y, 1 - Math.exp(-dt * (d.focusRate || 2.5)), this._focusValid ? 0 : 1);
        this.focusPass.render(r, this.focusRT[next]);
        this._focusCur = next;
        this._focusValid = true;
        this.u.tFocus.value = this.focusRT[next].texture;
      } else {
        this._focusValid = false;
      }
      const dd = this.dofDownPass.uniforms;
      dd.tColor.value = input;
      dd.tDepth.value = depth;
      dd.uFull.value.set(this.width, this.height);
      this.dofDownPass.render(r, this.dofA);
      const dg = this.dofGatherPass.uniforms;
      dg.tSrc.value = this.dofA.texture;
      dg.uHalf.value.set(this.halfW, this.halfH);
      this.dofGatherPass.render(r, this.dofB);
    } else {
      this._focusValid = false;
    }

    U.tColor.value = input;
    U.tTensor.value = this.tensorA.texture;
    U.tDepth.value = depth;
    U.tDof.value = this.dofB.texture;
    U.uTexel.value.set(1 / this.width, 1 / this.height);
    U.uDofHalf.value.set(this.halfW, this.halfH);
    U.uKuw.value.set(p.radius * Math.max(res, 0.5) * s, p.alpha, p.mix, p.detail);
    U.uKuwDepth.value.set(p.nearStart, p.nearFull, p.nearScale, p.farScale);
    U.uHard.value = p.hardness;
    U.uStroke.value.set(p.texture, p.bristle * s, p.bristleLen, 0);
    U.uGradeA.value.set(p.split * s, p.vibrance * s, p.calm * s, p.curve * s);
    U.uShadeTone.value.set(p.shadeTone.r, p.shadeTone.g, p.shadeTone.b);
    U.uLightTone.value.set(p.lightTone.r, p.lightTone.g, p.lightTone.b);
    U.uShadeLift.value.set(p.shadeLift.r, p.shadeLift.g, p.shadeLift.b);
    // night, storms and the deep keep their depth and colour: the shadow grading eases off
    const day = (1 - 0.85 * (G.uNight?.value ?? 0)) * (1 - 0.5 * (G.uStorm?.value ?? 0)) * (1 - 0.85 * (G.uUnderwater?.value ?? 0));
    U.uGradeB.value.set(p.lift * s, p.darkCalm * s, p.hueLean * s, day);
    U.uBlack.value.set(p.black.r * s, p.black.g * s, p.black.b * s);
    U.uWhite.value.set(1 + (p.white.r - 1) * s, 1 + (p.white.g - 1) * s, 1 + (p.white.b - 1) * s);
    U.uGrain.value.set(p.grain * s, p.thread, Math.max(res, 0.75), p.fibre);
    U.uVig.value.set(p.vignette * s, p.vigInner, p.vigOuter, this.width / this.height);
    U.uVigTint.value.set(p.vigTint.r, p.vigTint.g, p.vigTint.b);
    U.uDofOn.value = dofOn ? 1 : 0;
    U.uSplit.value = this.split;
    U.uDebug.value = this.debug;
    pass.render(r, out);
  }

  dispose() {
    for (const t of [this.tensorA, this.tensorB, this.dofA, this.dofB, ...this.focusRT, this.ldr]) t.dispose();
    for (const p of this.passes) p.material.dispose();
  }
}

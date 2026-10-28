// Painted horizon of Vur Sok: three panorama bands of far spiral islands, helical sea stacks,
// terraced peaks and ammonite rings, standing on the sea 5-10 km away. Each band is a cylinder that
// follows the camera with a little parallax, painted at load time per channel:
//   R = facing (0 faces the band's left, 1 its right: lit or shaded by the sun's side)
//   G = painted value (strata, crevices, ledges)   B = vegetation caps   A = coverage
// The shader lights the silhouettes with the sun's side, cools and lifts them with aerial
// perspective toward the horizon colour, and adds the depth fog of the scene.
import {
  CylinderGeometry, Mesh, ShaderMaterial, DataTexture, RGBAFormat, UnsignedByteType, LinearFilter,
  LinearMipmapLinearFilter, RepeatWrapping, ClampToEdgeWrapping, DoubleSide, Vector3, Color,
} from 'three';
import { G } from '../render/Globals.js';
import { UNIFORMS, NOISE, LIGHTING } from '../render/shaders/common.js';
import { rng, lerp, clamp, TAU } from '../core/math.js';

const VERT = /* glsl */ `
${UNIFORMS}
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vDir;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vDir = normalize(vec3(position.x, 0.0, position.z));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
uniform sampler2D uPaint;
uniform float uHaze;
uniform vec3 uRock;
uniform vec3 uVeg;
uniform float uBottom;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vDir;
void main() {
  vec4 t = texture2D(uPaint, vUv);
  float a = clamp((t.a - 0.5) / max(fwidth(t.a), 1e-4) + 0.5, 0.0, 1.0);
  if (a < 0.01) discard;
  // the band's tangent at this azimuth (toward increasing u)
  vec3 tang = normalize(vec3(-vDir.z, 0.0, vDir.x));
  vec3 sunH = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-4);
  float side = dot(sunH, tang);            // sun to the band's right (+) or left (-)
  float facing = t.r * 2.0 - 1.0;          // surface faces right (+) or left (-)
  float toward = dot(sunH, -vDir);         // sun behind the silhouette: rim-lit, front in shade
  float lit = clamp(0.5 + 0.5 * facing * side * 1.6 - 0.35 * max(toward, 0.0), 0.0, 1.0);
  lit *= smoothstep(-0.12, 0.12, uSunDir.y);
  vec3 base = mix(uRock, uVeg, t.b * 0.8) * (0.7 + 0.6 * t.g);
  vec3 col = base * (uSkyAmbient * 0.55 + uSunColor * lit * 0.55);
  col += base * uMoonColor * uNight * 0.6;
  // aerial perspective: distant land takes the colour of the air and the horizon
  vec3 rd = normalize(vWorldPos - uCamPos);
  float hz = clamp(uHaze + (1.0 - vUv.y / 0.6) * 0.18 * smoothstep(0.0, 0.25, 1.0 - vUv.y), 0.0, 0.97);
  vec3 air = mix(fogColorFor(rd), uSkyHorizon, 0.35);
  col = mix(col, air, hz);
  // the foot of the band dissolves into sea haze
  col = mix(col, air, smoothstep(uBottom + 0.035, uBottom, vUv.y) * 0.85);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, a);
}
`;

const W = 4096, H = 384;

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width: w, height: h });
  return null;
}

/**
 * Paint one panorama band. Shapes stand on a baseline (the sea) near the bottom of the texture.
 * o: { seed, count, hMin, hMax, density }
 */
function paintBand(o) {
  const cf = makeCanvas(W, H), cv = makeCanvas(W, H), cg = makeCanvas(W, H);
  if (!cf) return null;
  const ctxOpts = { willReadFrequently: true };
  const F = cf.getContext('2d', ctxOpts), V = cv.getContext('2d', ctxOpts), Gg = cg.getContext('2d', ctxOpts);
  const r = rng(o.seed);
  const base = H * (1 - o.bottom);
  // every shape is painted three times (facing gradient, value, vegetation), wrapped in u
  const shapes = [];
  for (let i = 0; i < o.count; i++) {
    const x = r() * W;
    const h = lerp(o.hMin, o.hMax, Math.pow(r(), 1.7)) * H;
    const kind = r();
    shapes.push({ x, h, kind, seed: Math.floor(r() * 1e6) });
  }
  shapes.sort((a, b) => b.h - a.h); // tall ones behind
  const outline = (ctx, s, dx) => {
    const rr = rng(s.seed);
    const x0 = s.x + dx;
    ctx.beginPath();
    if (s.kind < 0.38) {
      // helical stack: a column whose edges weave (twisted lobes), notch at the waterline
      const w = s.h * lerp(0.18, 0.32, rr());
      const tw = lerp(2, 5, rr()), ph = rr() * TAU;
      const L = [], R = [];
      for (let k = 0; k <= 24; k++) {
        const t = k / 24;
        const y = base - t * s.h;
        const wob = Math.sin(t * tw * Math.PI + ph) * w * 0.14;
        const taper = lerp(1, lerp(0.6, 0.95, rr() * 0 + 0.7), t) * (t < 0.06 ? 0.82 : 1);
        L.push([x0 - w * 0.5 * taper + wob, y]);
        R.push([x0 + w * 0.5 * taper + wob * 0.6, y]);
      }
      ctx.moveTo(L[0][0], L[0][1]);
      for (const q of L) ctx.lineTo(q[0], q[1]);
      // rounded meadow cap
      ctx.quadraticCurveTo(x0, base - s.h - w * 0.15, R[R.length - 1][0], R[R.length - 1][1]);
      for (let k = R.length - 1; k >= 0; k--) ctx.lineTo(R[k][0], R[k][1]);
      ctx.closePath();
    } else if (s.kind < 0.62) {
      // coiled island: a wide stepped mound climbing to a horn
      const w = s.h * lerp(2.2, 3.4, rr());
      const steps = 5 + Math.floor(rr() * 4);
      ctx.moveTo(x0 - w * 0.5, base);
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const x = lerp(x0 - w * 0.5, x0 - w * 0.06, t);
        const y = base - s.h * 0.55 * Math.pow(t, 0.8);
        ctx.lineTo(x, y + s.h * 0.03);
        ctx.lineTo(x + w * 0.02, y);
      }
      ctx.lineTo(x0 - w * 0.03, base - s.h * 0.62);
      ctx.lineTo(x0, base - s.h); // the horn
      ctx.lineTo(x0 + w * 0.03, base - s.h * 0.6);
      for (let k = steps; k >= 0; k--) {
        const t = k / steps;
        const x = lerp(x0 + w * 0.5, x0 + w * 0.06, t);
        const y = base - s.h * 0.5 * Math.pow(t, 0.9);
        ctx.lineTo(x - w * 0.02, y);
        ctx.lineTo(x, y + s.h * 0.03);
      }
      ctx.lineTo(x0 + w * 0.5, base);
      ctx.closePath();
    } else if (s.kind < 0.8) {
      // spiral peak: a tall cone with a shoulder where the terrace winds
      const w = s.h * lerp(1.1, 1.6, rr());
      ctx.moveTo(x0 - w * 0.5, base);
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        ctx.lineTo(lerp(x0 - w * 0.5, x0, t) + Math.sin(t * 9) * w * 0.02, base - s.h * Math.pow(t, 1.15));
      }
      for (let k = 16; k >= 0; k--) {
        const t = k / 16;
        ctx.lineTo(lerp(x0 + w * 0.5, x0, t) + Math.sin(t * 7 + 1) * w * 0.02, base - s.h * Math.pow(t, 1.25));
      }
      ctx.closePath();
    } else if (s.kind < 0.9) {
      // ammonite ring standing on edge
      const R = s.h * 0.5;
      const cy = base - R * 0.85;
      ctx.arc(x0, cy, R, 0, TAU);
      ctx.moveTo(x0 + R * 0.55, cy);
      ctx.arc(x0, cy, R * 0.55, 0, TAU, true);
    } else {
      // a low islet chain with a stack
      const w = s.h * lerp(4, 7, rr());
      ctx.moveTo(x0 - w * 0.5, base);
      for (let k = 0; k <= 30; k++) {
        const t = k / 30;
        ctx.lineTo(lerp(x0 - w * 0.5, x0 + w * 0.5, t), base - s.h * 0.25 * Math.max(0, Math.sin(t * Math.PI * 3 + rr())) * (0.5 + 0.5 * Math.sin(t * Math.PI)));
      }
      ctx.closePath();
      const sx = x0 + (rr() - 0.5) * w * 0.4, sw = s.h * 0.2;
      ctx.moveTo(sx - sw, base);
      ctx.lineTo(sx - sw * 0.8, base - s.h);
      ctx.lineTo(sx + sw * 0.8, base - s.h * 0.95);
      ctx.lineTo(sx + sw, base);
      ctx.closePath();
    }
  };
  // pass 1: silhouettes (facing gradient, base value, vegetation mask base)
  const copies = [];
  for (const s of shapes) {
    const wEst = s.h * 4;
    for (const dx of [0, -W, W]) {
      if (s.x + dx < -wEst || s.x + dx > W + wEst) continue;
      copies.push([s, dx, wEst]);
      const span = s.kind < 0.38 ? s.h * 0.2 : s.h * 1.2;
      const grad = F.createLinearGradient(s.x + dx - span, 0, s.x + dx + span, 0);
      grad.addColorStop(0, 'rgb(20,20,20)');
      grad.addColorStop(0.45, 'rgb(110,110,110)');
      grad.addColorStop(0.55, 'rgb(150,150,150)');
      grad.addColorStop(1, 'rgb(235,235,235)');
      F.fillStyle = grad;
      outline(F, s, dx);
      F.fill('evenodd');
      const tone = Math.round(lerp(110, 170, rng(s.seed + 3)()));
      V.fillStyle = `rgb(${tone},${tone},${tone})`;
      outline(V, s, dx);
      V.fill('evenodd');
      Gg.fillStyle = 'rgb(0,0,0)';
      outline(Gg, s, dx);
      Gg.fill('evenodd');
    }
  }
  // pass 2: strata and vegetation painted only onto the silhouettes
  V.globalCompositeOperation = 'source-atop';
  Gg.globalCompositeOperation = 'source-atop';
  Gg.fillStyle = 'rgb(255,255,255)';
  for (const [s, dx, wEst] of copies) {
    const sr = rng(s.seed + 9);
    const x0 = s.x + dx - wEst * 0.5, ww = wEst;
    for (let k = 0; k < 10; k++) {
      const y = base - sr() * s.h;
      const v = Math.round(lerp(60, 210, sr()));
      V.fillStyle = `rgba(${v},${v},${v},0.55)`;
      V.fillRect(x0, y, ww, lerp(1, 3.5, sr()) * (H / 512));
    }
    for (let k = 0; k < 18; k++) {
      Gg.beginPath();
      Gg.ellipse(s.x + dx + (sr() - 0.5) * wEst * 0.5, base - s.h * lerp(0.35, 1.02, sr()), lerp(3, 9, sr()) * (H / 512), lerp(2, 5, sr()) * (H / 512), 0, 0, TAU);
      Gg.fill();
    }
  }
  const f = F.getImageData(0, 0, W, H).data, v = V.getImageData(0, 0, W, H).data, g = Gg.getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W * 4, dst = y * W * 4; // flip for GL
    for (let x = 0; x < W * 4; x += 4) {
      const a = f[src + x + 3];
      out[dst + x] = a ? f[src + x] : 128;
      out[dst + x + 1] = v[src + x] || 140;
      out[dst + x + 2] = g[src + x];
      out[dst + x + 3] = a;
    }
  }
  const tex = new DataTexture(out, W, H, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const LAYERS = [
  // radius (m), band height (m), parallax, haze, painting
  { R: 5200, H: 760, parallax: 0.06, haze: 0.42, rock: '#6f6a70', veg: '#4f6a4e', paint: { seed: 11, count: 70, hMin: 0.12, hMax: 0.52, bottom: 0.08 } },
  { R: 7400, H: 980, parallax: 0.035, haze: 0.6, rock: '#7a7684', veg: '#5a7064', paint: { seed: 23, count: 60, hMin: 0.1, hMax: 0.5, bottom: 0.07 } },
  { R: 10200, H: 1400, parallax: 0.015, haze: 0.76, rock: '#8a8a9a', veg: '#6a7a78', paint: { seed: 37, count: 48, hMin: 0.08, hMax: 0.42, bottom: 0.06 } },
];

export class Backdrop {
  constructor(game, opts = {}) {
    this.game = game;
    this.meshes = [];
    this.anchor = opts.anchor ? opts.anchor.clone() : new Vector3(0, 0, -6000);
    this.enabled = true;
    for (const L of LAYERS) {
      const tex = paintBand(L.paint);
      if (!tex) continue;
      const geo = new CylinderGeometry(L.R, L.R, L.H, 160, 1, true);
      // the band sits on the sea: its painted baseline (paint.bottom) lands at y = 0
      geo.translate(0, L.H * 0.5 - L.H * L.paint.bottom, 0);
      const mat = new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: Object.assign({}, G, {
          uPaint: { value: tex },
          uHaze: { value: L.haze },
          uRock: { value: hex(L.rock) },
          uVeg: { value: hex(L.veg) },
          uBottom: { value: L.paint.bottom },
        }),
        side: DoubleSide,
      });
      mat.alphaToCoverage = true;
      const m = new Mesh(geo, mat);
      m.name = 'backdrop';
      m.frustumCulled = false;
      m.renderOrder = 9000; // after the scene, before the sky
      m.userData.layer = L;
      game.engine.scene.add(m);
      this.meshes.push(m);
    }
    this._hook = (cam) => this.follow(cam);
    game.engine.beforeRender?.push(this._hook);
  }

  follow(cam) {
    for (const m of this.meshes) {
      const L = m.userData.layer;
      m.visible = this.enabled;
      m.position.set(lerp(cam.position.x, this.anchor.x, L.parallax), 0, lerp(cam.position.z, this.anchor.z, L.parallax));
    }
  }

  dispose() {
    const i = this.game.engine.beforeRender.indexOf(this._hook);
    if (i >= 0) this.game.engine.beforeRender.splice(i, 1);
    for (const m of this.meshes) { m.parent?.remove(m); m.geometry.dispose(); m.material.dispose(); }
  }
}

function hex(h) {
  return new Color(h);
}

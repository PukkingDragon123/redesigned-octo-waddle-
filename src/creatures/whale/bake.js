// GPU skin baker. At load, each whale type's skin is painted once into two RGBA8 textures:
//   A: albedo (sqrt-encoded rgb) + relief height
//   B: tangent-space normal (xy) + roughness + cavity AO
// Pass 1 rasterizes the hero body mesh in texture space (gl_Position = uv), so every feature is
// evaluated on the true 3D surface: countershading with an irregular boundary, pale flank bars,
// the fine streak network, eye patches, mottling, throat pleats, rostrum tubercles, barnacle
// clusters with whale lice, rake and cookie-cutter scars, wrinkles at the eyes, gape and flippers.
// Pass 2 turns the height field into normals (metric central differences) and cavity occlusion.
// Textures are shared by every whale of the same base genome (the Oasis gathering reuses them).
import {
  BufferGeometry, Mesh, ShaderMaterial, WebGLRenderTarget, HalfFloatType, UnsignedByteType, RGBAFormat,
  LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, ClampToEdgeWrapping, NearestFilter, GLSL3,
  OrthographicCamera, Scene, Vector2, Vector4, Color, DoubleSide,
} from 'three';
import { NOISE } from '../../render/shaders/common.js';
import { PLEATS } from './skinGLSL.js';
import { FullscreenPass } from '../../render/FullscreenPass.js';

const MAX_TUB = 64, MAX_SCAR = 40, MAX_BARN = 24;

const BAKE_VERT = /* glsl */ `
attribute vec2 aTex;
attribute vec2 aLoft;
varying vec3 vPos;
varying vec3 vNrm;
varying vec2 vST;
void main() {
  vPos = position;
  vNrm = normal;
  vST = aLoft;
  gl_Position = vec4(aTex * 2.0 - 1.0, 0.0, 1.0);
}
`;

const BAKE_FRAG = /* glsl */ `
precision highp float;
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oB;
${NOISE}
${PLEATS}
uniform vec2 uRes;
uniform float uL;
uniform float uSeed;
uniform float uCalf;
uniform vec3 uBack;
uniform vec3 uBelly;
uniform vec3 uMark;
uniform vec3 uMark2;
uniform vec4 uAmt;       // x bars, y streaks, z mottle, w algae
uniform vec4 uAmt2;      // x scars, y barnacles, z crescent, w worn
uniform vec4 uEye;       // s, t of the primary eye (+X side), s, t of the secondary
uniform vec2 uEyeR;      // eye radii (m)
uniform vec4 uPatch;     // size, len, angle, darkness
uniform vec4 uWing;      // s, t of the wing root, s, t of the rear fin root
uniform vec4 uHead;      // hinge t, jaw fraction (lip seam s), splashguard t, navel t
uniform vec4 uPleat;     // t0, t1, count, -
uniform vec4 uBlow;      // t, half length (t), gap (s), splay
uniform vec4 uDome;      // t0, t1, half width (rad), height (L)
uniform vec4 uTub[${MAX_TUB}];   // s, t, radius (m), height (m)
uniform int uNTub;
uniform vec4 uScarA[${MAX_SCAR}]; // s, t, angle, length (m)
uniform vec4 uScarB[${MAX_SCAR}]; // lines, gap (m), width (m), age + 10 * kind
uniform int uNScar;
uniform vec4 uBarn[${MAX_BARN}];  // s, t, radius (m), density
uniform int uNBarn;
varying vec3 vPos;
varying vec3 vNrm;
varying vec2 vST;

float perim;
float wrapS(float d) { return d - floor(d + 0.5); }
// metric offset (metres) on the skin from a feature centre (s, t)
vec2 lm(vec2 st, vec2 c) { return vec2(wrapS(st.x - c.x) * perim, (st.y - c.y) * uL); }
float h21(vec2 p) { return hash12(p); }

void main() {
  float t = vST.x, s = vST.y;
  vec3 P = vPos;
  float L = uL;
  perim = max(length(dFdx(vPos)) * uRes.x, 1e-3);
  vec2 st = vec2(s, t);
  float dorsal = -cos(s * 6.2831853);
  float sm = s < 0.5 ? s : 1.0 - s;
  vec2 stm = vec2(sm, t);
  vec3 q = P / L;
  float h = 0.0;
  float rough = 0.36;
  float calf = uCalf;

  // ---- countershading: black back, pale belly, an irregular splashed boundary ----
  float nB = fbm3(q * vec3(7.0, 7.0, 3.2) + uSeed) - 0.5;
  float nB2 = fbm3(q * 26.0 + uSeed * 1.7) - 0.5;
  // the pale belly climbs higher behind the flippers and on the throat
  float rise = 0.18 * exp(-pow((t - uWing.y + 0.06) / 0.09, 2.0)) + 0.12 * smoothstep(0.7, 0.9, t);
  float bound = dorsal + 0.08 - rise + nB * 0.75 + nB2 * 0.22;
  float cs = smoothstep(-0.16, 0.16, bound);
  vec3 col = mix(uBelly, uBack, cs);
  // broad tonal variation and cool / warm shifts so no area reads flat
  float tone = fbm3(q * 3.0 + uSeed * 0.3);
  col *= 0.9 + 0.2 * tone;
  col = mix(col, col * vec3(0.94, 0.98, 1.06), smoothstep(0.4, 0.7, fbm3(q * 5.0 - uSeed)) * 0.5);

  // ---- mottling: dark marbling on the pale belly, faint pale freckles on the back ----
  float w1 = worley2(vec2(s * perim, t * L) / (L * 0.022) + uSeed);
  float w2 = worley2(vec2(s * perim, t * L) / (L * 0.008) + uSeed * 3.1);
  float blot = smoothstep(0.42, 0.16, w1 + (fbm3(q * 18.0) - 0.5) * 0.4);
  col = mix(col, mix(uMark, uBack, 0.5) * 0.9, blot * (1.0 - cs) * uAmt.z * 0.75);
  float speck = smoothstep(0.2, 0.08, w2) * step(0.62, h21(floor(vec2(s * perim, t * L) / (L * 0.008) + uSeed * 3.1)));
  col = mix(col, mix(col, uMark2, 0.5), speck * cs * uAmt.z * 0.12 * step(0.8, hash12(floor(vec2(s * perim, t * L) / (L * 0.008)) + 4.0)));
  col = mix(col, uBack * 0.55, speck * (1.0 - cs) * uAmt.z * 0.35);

  // ---- bold pale bars along the flank behind the head: four, each with its own shape ----
  {
    float zone = smoothstep(0.54, 0.6, t) * (1.0 - smoothstep(0.7, 0.735, t)) * smoothstep(-0.55, -0.25, dorsal);
    float bars = 0.0;
    for (int k = 0; k < 4; k++) {
      float hk = hash11(float(k) * 7.31 + uSeed);
      float tc = mix(0.585, 0.705, (float(k) + 0.5) / 4.0) + (hk - 0.5) * 0.012;
      float wdt = mix(0.0045, 0.011, hk);
      float slant = 0.03 + 0.025 * hash11(float(k) + 3.1 + uSeed);
      float c = t - tc + (dorsal + 0.3) * slant;
      float edge = (fbm3(q * 38.0 + float(k) * 5.0) - 0.5) * 0.007 + (vnoise(vec2(dorsal * 34.0, float(k) * 3.0)) - 0.5) * 0.004;
      float b = smoothstep(wdt + 0.0025, wdt - 0.0015, abs(c + edge));
      // each bar tapers and breaks up toward the back at its own height
      b *= smoothstep(0.42 + hk * 0.3, 0.08 + hk * 0.15, dorsal + (fbm3(q * 20.0 + float(k)) - 0.5) * 0.25);
      bars = max(bars, b);
    }
    float sp = hash12(floor(vec2(s * perim, t * L) / (L * 0.0026)));
    float breakup = mix(0.72, 1.0, step(0.35, sp));
    col = mix(col, mix(uMark2, uBelly, 0.25), bars * zone * uAmt.x * 0.9 * breakup);
  }

  // ---- the fine network of pale streaks across the dark skin (tulkun) ----
  {
    vec2 sp = vec2(s * perim, t * L) / (L * 0.016);
    sp += vec2(fbm2(sp * 0.35 + 1.7), fbm2(sp * 0.35 + 9.2)) * 1.6;
    // hand-drawn: a finer pen tremor on top of the slow warp, so no cell edge runs straight
    sp += (vec2(vnoise(sp * 2.3 + 3.7), vnoise(sp * 2.3 + 8.1)) - 0.5) * 0.32;
    vec2 i = floor(sp), f = fract(sp);
    float f1 = 8.0, f2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash22(i + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
    float edge = sqrt(f2) - sqrt(f1);
    // the width swells and thins along each streak, and the strokes fade out at their ends
    float lw = 0.045 * (0.35 + 1.3 * vnoise(sp * 1.4 + 5.3));
    float line = smoothstep(lw, lw * 0.15, edge) * smoothstep(0.45, 0.72, fbm3(q * 7.0 + 7.0)) * smoothstep(0.25, 0.5, vnoise(sp * 0.9 + 2.2));
    col = mix(col, mix(col, uMark2, 0.45), line * cs * uAmt.y * 0.7);
    h += line * cs * uAmt.y * L * 0.00008;
  }

  // ---- eye patches (and the mother's pale crescent under each eye) ----
  {
    vec2 de = lm(stm, uEye.xy);
    vec2 de2 = lm(stm, uEye.zw);
    float r = uEyeR.x;
    // teardrop: round in front of the eye, trailing back toward the nape
    float ca = cos(uPatch.z), sa = sin(uPatch.z);
    vec2 pd = vec2(ca * de.x - sa * de.y, sa * de.x + ca * de.y);
    float back = max(-pd.y, 0.0);
    vec2 e;
    e.y = pd.y > 0.0 ? pd.y / (r * 6.5 * uPatch.x) : pd.y / (r * (8.0 + 16.0 * uPatch.y) * uPatch.x);
    e.x = pd.x / (r * 7.0 * uPatch.x) * (1.0 + back / (r * 30.0 * uPatch.y + 0.001) * 0.6);
    float pe = length(e) + (fbm3(q * 30.0 + 11.0) - 0.5) * 0.35;
    float ptc = smoothstep(1.05, 0.75, pe);
    col = mix(col, uBack * mix(1.0, 0.35, uPatch.w), ptc * uPatch.w);
    // pale crescent cupping the eye from below (toward the belly is smaller s on this side)
    float cr = length(de / vec2(r * 4.2, r * 3.4));
    float lowSide = smoothstep(0.0, -1.0, de.x / (r * 2.5));
    float cres = smoothstep(1.28, 1.08, cr) * smoothstep(0.92, 1.06, cr) * lowSide;
    col = mix(col, mix(col, uMark2, 0.7), cres * uAmt2.z * 0.6);
    // wrinkled skin around the eyes: concentric folds and crow's feet
    float d1 = length(de) / r, d2 = length(de2) / uEyeR.y;
    float ang = atan(de.y, de.x);
    float wrin = sin(d1 * 5.2 + (fbm2(vec2(ang * 3.0, d1)) - 0.5) * 2.5) * exp(-d1 * 0.32) * smoothstep(1.1, 1.6, d1);
    wrin += 0.6 * sin(d2 * 5.6) * exp(-d2 * 0.4) * smoothstep(1.1, 1.6, d2);
    float feet = smoothstep(0.65, 1.0, abs(sin(ang * 7.0 + d1 * 0.4 + (fbm2(vec2(ang * 2.0, d1 * 0.7) + 4.0) - 0.5) * 2.2))) * smoothstep(1.5, 2.5, d1) * (1.0 - smoothstep(4.0, 7.0, d1)) * step(de.y, 0.0);
    h += (wrin * 0.5 + feet * 0.4) * r * 0.06;
    rough += smoothstep(5.0, 1.5, d1) * 0.04;
  }

  // ---- throat pleats: deep grooves from chin to navel, paler ridges, dark groove floors ----
  {
    vec3 pl = pleatAt(s, t, uPleat.z, uPleat.x, uPleat.y);
    float g = pl.x * pl.y;
    h -= g * L * 0.0016;
    col = mix(col, col * vec3(0.7, 0.66, 0.68), g * 0.55);
    col = mix(col, mix(col, uBelly, 0.4), (1.0 - pl.x) * pl.y * 0.25);
    rough -= g * 0.06;
  }

  // ---- the gape: dark wet lip line, paler lower lip, folds at the corner ----
  {
    float lipW = (fbm2(vec2(t * 90.0, uSeed)) - 0.5) * 0.0035 + (vnoise(vec2(t * 420.0, 3.0)) - 0.5) * 0.0009;
    float sl = abs(sm - uHead.y + lipW);
    float on = smoothstep(uHead.x - 0.012, uHead.x + 0.004, t) * (1.0 - smoothstep(0.985, 0.998, t));
    float lipT = 0.65 + 0.7 * vnoise(vec2(t * 160.0, 7.0));
    float lip = smoothstep(0.004 * lipT, 0.0012 * lipT, sl) * on;
    col = mix(col, vec3(0.05, 0.04, 0.05), lip * 0.9);
    float lower = smoothstep(0.0, 0.004, uHead.y - sm) * smoothstep(0.012, 0.004, uHead.y - sm) * on;
    col = mix(col, mix(col, uBelly, 0.3), lower * 0.35);
    // corner folds radiating from the gape
    vec2 dc = lm(stm, vec2(uHead.y, uHead.x));
    float dcl = length(dc) / (L * 0.012);
    float fold = sin(atan(dc.y, dc.x) * 9.0 + (vnoise(dc / (L * 0.01) + 2.0) - 0.5) * 2.4) * exp(-dcl * 1.2) * smoothstep(0.3, 0.8, dcl);
    h += fold * L * 0.0006;
  }

  // ---- blowholes and the splashguard (the slits open at runtime) ----
  {
    float bt = (t - uBlow.x) / uBlow.y;
    float near = exp(-pow((t - uBlow.x) / (uBlow.y * 2.5), 2.0)) * smoothstep(0.08, 0.02, abs(s - 0.5));
    col = mix(col, col * 0.75, near * 0.4);
    float lips = 0.0;
    for (int k = 0; k < 2; k++) {
      float sg = k == 0 ? 1.0 : -1.0;
      float off = sg * (uBlow.z + uBlow.w * uBlow.z * (bt + 1.0));
      float d = abs((s - 0.5) - off) / uBlow.z;
      lips += exp(-d * d * 2.0) * smoothstep(1.4, 0.8, abs(bt));
    }
    h += lips * L * 0.0008;
    float guard = exp(-pow((t - uHead.z) / 0.004, 2.0)) * smoothstep(0.05, 0.0, abs(s - 0.5));
    col = mix(col, col * 1.15, guard * 0.3);
  }

  // ---- sonic dome: scaled skin under the keratin bands ----
  {
    float dd = length(vec2((t - (uDome.x + uDome.y) * 0.5) / ((uDome.y - uDome.x) * 0.55), (s - 0.5) * 6.2831853 / uDome.z));
    col = mix(col, col * 0.8, smoothstep(1.1, 0.8, dd) * 0.5);
  }

  // ---- tubercles: knobs with a tiny hair follicle, worn pale on old whales ----
  for (int i = 0; i < ${MAX_TUB}; i++) {
    if (i >= uNTub) break;
    vec4 tb = uTub[i];
    vec2 d = lm(st, tb.xy);
    float dl = length(d) / tb.z;
    if (dl > 2.2) continue;
    float k = max(0.0, 1.0 - dl * dl);
    h += tb.w * 0.35 * pow(k, 1.5);
    col = mix(col, col * (1.0 + 0.25 * uAmt2.w) + uAmt2.w * 0.05, k * 0.5);
    float ring = exp(-pow((dl - 1.05) / 0.18, 2.0));
    col *= 1.0 - ring * 0.25;
    float follicle = smoothstep(0.12, 0.05, dl);
    col = mix(col, vec3(0.08, 0.07, 0.07), follicle * 0.8);
    h -= follicle * tb.w * 0.2;
  }

  // ---- scars: rake marks and cookie-cutter ovals; pale, smooth, slightly raised ----
  float scarM = 0.0;
  for (int i = 0; i < ${MAX_SCAR}; i++) {
    if (i >= uNScar) break;
    vec4 a = uScarA[i], b = uScarB[i];
    vec2 d = lm(st, a.xy);
    float reach = a.w + b.y * b.x + b.z * 4.0;
    if (abs(d.x) > reach * 1.2 && abs(d.y) > reach * 1.2) continue;
    float kind = floor(b.w / 10.0);
    float age = b.w - kind * 10.0;
    float m = 0.0;
    if (kind < 0.5) {
      float c = cos(a.z), sn = sin(a.z);
      vec2 r = vec2(c * d.x + sn * d.y, -sn * d.x + c * d.y);
      for (int k = 0; k < 5; k++) {
        if (float(k) >= b.x) break;
        float hk = h21(vec2(float(i), float(k)) + uSeed);
        float y0 = (float(k) - (b.x - 1.0) * 0.5) * b.y + sin(r.x / max(a.w, 0.01) * 3.0 + hk * 6.0) * b.y * 0.25;
        float hl = a.w * (0.35 + 0.15 * hk);
        y0 += (vnoise(vec2(r.x / (b.z * 3.0), hk * 17.0)) - 0.5) * b.z * 0.9;
        float ex = (r.x - (hk - 0.5) * a.w * 0.2) / hl;
        ex = ex > 0.0 ? ex / (1.0 + 0.25 * hk) : ex / (1.25 - 0.25 * hk);
        float tap = sqrt(max(0.0, 1.0 - ex * ex));
        float wv = b.z * (0.7 + 0.6 * vnoise(vec2(r.x / (b.z * 6.0), hk * 10.0))) * (0.25 + 0.75 * tap);
        float line = smoothstep(wv, wv * 0.3, abs(r.y - y0)) * smoothstep(0.0, 0.15, tap);
        m = max(m, line);
      }
    } else {
      float c = cos(a.z), sn = sin(a.z);
      vec2 r = vec2(c * d.x + sn * d.y, -sn * d.x + c * d.y) / vec2(a.w, b.z);
      float rl = length(r);
      rl += (vnoise(r * 3.0 + float(i)) - 0.5) * 0.25;
      m = smoothstep(1.0, 0.7, rl) * 0.32;
      h -= smoothstep(1.0, 0.6, rl) * b.z * 0.08;
      col = mix(col, col * 0.55, smoothstep(1.15, 1.0, rl) * smoothstep(0.8, 1.0, rl) * 0.5);
    }
    m *= uAmt2.x;
    scarM = max(scarM, m);
    vec3 scarCol = mix(mix(uMark2, vec3(0.55, 0.42, 0.44), 0.25), uMark2, age);
    col = mix(col, scarCol, m * mix(0.55, 0.9, age));
    h += m * b.z * mix(-0.15, 0.22, age);
  }
  rough -= scarM * 0.08;

  // ---- barnacle clusters with whale lice in their lee ----
  float barnM = 0.0;
  for (int i = 0; i < ${MAX_BARN}; i++) {
    if (i >= uNBarn) break;
    vec4 bc = uBarn[i];
    vec2 d = lm(st, bc.xy);
    float R = bc.z;
    float dl = length(d) / R;
    if (dl > 1.6) continue;
    // a cluster: cells of barnacles, denser at the centre
    float cell = L * 0.0062;
    vec2 cp = d / cell + bc.xy * 37.0;
    vec2 ci = floor(cp);
    float best = 9.0, bh = 0.0, bang = 0.0, bsz = 1.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = ci + vec2(float(x), float(y));
      vec2 o = hash22(g + 5.3) * 0.7 + 0.15;
      vec2 r = g + o - cp;
      float pres = h21(g * 1.7 + 2.0);
      vec2 cc = (g + o - bc.xy * 37.0) * cell;
      float fall = 1.0 - smoothstep(0.35, 1.05, length(cc) / R);
      if (pres > bc.w * fall * 0.95) continue;
      float sz = 0.55 + 0.45 * h21(g + 9.0);
      float dd = length(r) / (0.45 * sz);
      if (dd < best) { best = dd; bh = sz; bang = atan(r.y, r.x); }
    }
    if (best < 1.0) {
      // volcano shell: radial plates, a dark opening at the top
      float plates = 1.0 + 0.12 * cos(bang * 6.0);
      float cone = (1.0 - best) * plates;
      float open = smoothstep(0.34, 0.24, best);
      h += (cone * 0.9 - open * 0.55) * L * 0.0012 * bh * uAmt2.y;
      vec3 shell = mix(vec3(0.78, 0.76, 0.7), vec3(0.6, 0.6, 0.56), h21(vec2(bang, best)));
      shell = mix(shell, vec3(0.04, 0.035, 0.03), open);
      float m = smoothstep(1.0, 0.85, best) * uAmt2.y;
      col = mix(col, shell, m);
      rough = mix(rough, 0.82, m);
      barnM = max(barnM, m);
    } else {
      // skin between barnacles: darker, roughened, with a greenish film
      float ring = (1.0 - smoothstep(0.6, 1.3, dl)) * uAmt2.y;
      col = mix(col, col * vec3(0.72, 0.76, 0.7), ring * 0.6);
      rough = mix(rough, 0.6, ring * 0.5);
      // whale lice: small orange-pink crowds in the creases
      vec2 lp = d / (L * 0.0011);
      vec2 li = floor(lp);
      float lh = h21(li + bc.xy * 91.0);
      vec2 lo = fract(lp) - 0.5;
      float louse = smoothstep(0.32, 0.18, length(lo * vec2(1.0, 1.5))) * step(0.72, lh) * smoothstep(1.45, 0.9, dl) * smoothstep(0.5, 0.95, dl);
      col = mix(col, mix(vec3(0.85, 0.48, 0.28), vec3(0.95, 0.75, 0.55), lh), louse * uAmt2.y * 0.9);
      h += louse * L * 0.0003 * uAmt2.y;
    }
  }

  // ---- wrinkles: flipper base, cheeks, tail stock knuckles ----
  {
    for (int k = 0; k < 2; k++) {
      vec2 c = k == 0 ? uWing.xy : uWing.zw;
      vec2 d = lm(stm, c);
      float r = L * (k == 0 ? 0.045 : 0.02);
      float dl = length(d) / r;
      float w = sin(d.y / (L * 0.0035) + fbm2(d / r * 2.0) * 3.0) * exp(-dl * dl) * smoothstep(0.2, 0.6, dl);
      h += w * L * 0.0005;
    }
    float knuckle = smoothstep(0.3, 0.05, t) * smoothstep(0.75, 0.95, dorsal);
    h += knuckle * sin(t / 0.012 + (fbm2(vec2(s * 9.0, t * 30.0)) - 0.5) * 3.0) * L * 0.0004;
  }

  // ---- skin texture: soft undulations, fine crackle, pores ----
  {
    float und = fbm3(q * 48.0 + uSeed) - 0.5;
    vec2 cp = vec2(s * perim, t * L) / (L * 0.006);
    float c1 = worley2(cp + fbm2(cp * 0.3) * 0.8);
    h += und * L * 0.00055;
    h += (c1 - 0.4) * L * 0.00012 * (1.0 - calf * 0.6);
    float pores = smoothstep(0.12, 0.04, worley2(vec2(s * perim, t * L) / (L * 0.0018) + 3.3));
    h -= pores * L * 0.00004;
    rough += (fbm3(q * 30.0) - 0.5) * 0.08;
  }

  // ---- algae / diatom film on old skin ----
  {
    float al = smoothstep(0.5, 0.75, fbm3(q * 6.0 + 2.0)) * smoothstep(-0.2, 0.5, dorsal) * uAmt.w;
    col = mix(col, col * vec3(0.95, 1.05, 0.72) + vec3(0.03, 0.04, 0.0), al * 0.6);
    rough = mix(rough, 0.55, al * 0.4);
  }

  // calves: softer, smoother, fewer marks
  rough = clamp(rough, 0.2, 0.9);
  oA = vec4(max(col, vec3(0.0)), h);
  oB = vec4(rough, perim / uRes.x, length(dFdy(vPos)), 1.0);
}
`;

const NORM_FRAG = /* glsl */ `
precision highp float;
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oB;
uniform sampler2D tA;
uniform sampler2D tB;
uniform vec2 uTexel;
uniform float uL;
varying vec2 vUv;
void main() {
  vec4 a = texture(tA, vUv);
  vec4 b = texture(tB, vUv);
  float h = a.a;
  float mu = max(b.y, 1e-5), mv = max(b.z, 1e-5); // metres per texel
  float hx1 = texture(tA, vUv + vec2(uTexel.x, 0.0)).a;
  float hx0 = texture(tA, vUv - vec2(uTexel.x, 0.0)).a;
  float hy1 = texture(tA, vUv + vec2(0.0, uTexel.y)).a;
  float hy0 = texture(tA, vUv - vec2(0.0, uTexel.y)).a;
  vec2 grad = vec2((hx1 - hx0) / (2.0 * mu), (hy1 - hy0) / (2.0 * mv));
  vec3 n = normalize(vec3(-grad, 1.0));
  // cavity occlusion: how far this point sits below its surroundings (two radii, ~2 and ~7 cm on
  // a 22 m whale)
  float acc = 0.0;
  for (int i = 0; i < 12; i++) {
    float an = float(i) * 2.39996;
    vec2 dir = vec2(cos(an), sin(an));
    float rm = (i < 6 ? 0.0011 : 0.0034) * uL;
    vec2 off = dir * vec2(rm / mu, rm / mv) * uTexel;
    float hn = texture(tA, vUv + off).a;
    acc += clamp((hn - h) / rm, -1.0, 1.0);
  }
  float ao = clamp(1.0 - max(acc / 12.0, 0.0) * 1.6, 0.25, 1.0);
  ao *= clamp(1.0 + min(acc / 12.0, 0.0) * 0.2, 0.9, 1.0);
  vec3 alb = sqrt(clamp(a.rgb, 0.0, 1.0));
  oA = vec4(alb, clamp(h / (uL * 0.004) * 0.5 + 0.5, 0.0, 1.0));
  oB = vec4(n.xy * 0.5 + 0.5, b.x, ao);
}
`;

const CACHE = new Map();
const _cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** Skin textures for a model: from the cache, or baked now with the renderer. */
export function bakeSkin(renderer, model, res) {
  const key = model.A.baseName + '|' + (model.calf ? 'c' : 'a') + '|' + res;
  let entry = CACHE.get(key);
  if (entry) return entry;
  const t0 = performance.now();
  const A = model.A, P = A.P, L = A.L, g = A.g, lay = A.layout;
  const W = res, H = res;
  const rt1 = new WebGLRenderTarget(W, H, { count: 2, type: HalfFloatType, format: RGBAFormat, depthBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter });
  for (const t of rt1.textures) { t.wrapS = RepeatWrapping; t.wrapT = ClampToEdgeWrapping; t.generateMipmaps = false; }
  const rt2 = new WebGLRenderTarget(W, H, { count: 2, type: UnsignedByteType, format: RGBAFormat, depthBuffer: false, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter });
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 1);
  for (const t of rt2.textures) {
    t.wrapS = RepeatWrapping; t.wrapT = ClampToEdgeWrapping; t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.anisotropy = aniso;
  }
  // bake geometry: the skin triangles of the hero mesh (attributes shared, own index)
  // the finest mesh built so far (features are evaluated per pixel in 3D either way)
  const src = model.cache.body[0] || model.cache.body[1] || model.cache.body[2];
  const bg = new BufferGeometry();
  for (const k of ['position', 'normal', 'aTex', 'aLoft']) bg.setAttribute(k, src.geo.attributes[k]);
  const idx = src.geo.index.array.subarray(0, src.outerIndexCount);
  bg.setIndex(Array.from(idx));
  // uniforms
  const lm = A.landmarks();
  const tub = lay.tubercles.slice(0, MAX_TUB).map((k) => new Vector4(A.sOf(k.t, k.th), k.t, k.r, k.h));
  while (tub.length < MAX_TUB) tub.push(new Vector4());
  const scA = [], scB = [];
  for (const sc of lay.scars.slice(0, MAX_SCAR)) {
    scA.push(new Vector4(sc.s, sc.t, sc.ang, sc.len));
    scB.push(new Vector4(sc.n, sc.gap, sc.w, Math.min(0.99, sc.age) + 10 * sc.kind));
  }
  const nScar = scA.length;
  while (scA.length < MAX_SCAR) { scA.push(new Vector4()); scB.push(new Vector4()); }
  const barn = lay.barnacles.slice(0, MAX_BARN).map((b) => new Vector4(b.s, b.t, b.rad, b.dens));
  const nBarn = barn.length;
  while (barn.length < MAX_BARN) barn.push(new Vector4());
  const ep = lay.eyePatch;
  const col = (h, d) => new Color(h || d);
  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: BAKE_VERT,
    fragmentShader: BAKE_FRAG,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uRes: { value: new Vector2(W, H) },
      uL: { value: L },
      uSeed: { value: (A.shapeSeed % 997) * 0.173 },
      uCalf: { value: A.calf ? 1 : 0 },
      uBack: { value: col(g.back, '#333a44') },
      uBelly: { value: col(g.belly_c, '#e8e2d6') },
      uMark: { value: col(g.mark, g.back) },
      uMark2: { value: col(g.mark2, '#eeece6') },
      uAmt: { value: new Vector4(g.bars ?? 0.5, g.streaks ?? 0.4, g.mottle ?? 0.4, g.algae ?? 0) },
      uAmt2: { value: new Vector4(1, g.barnacles ?? 0, g.pattern?.crescent ?? 0, g.wornTubercles ? 1 : 0) },
      uEye: { value: new Vector4(lm.sEye, P.eye.t, lm.sEye2, P.eye2.t) },
      uEyeR: { value: new Vector2(P.eye.r * L, P.eye2.r * L) },
      uPatch: { value: new Vector4(ep.size, ep.len, ep.angle, ep.dark) },
      uWing: { value: new Vector4(lm.sWing, P.wing.t, lm.sRear, P.rearFin.t) },
      uHead: { value: new Vector4(P.hinge, P.jawFrac, P.splash, P.navel) },
      uPleat: { value: new Vector4(P.pleats.t0, P.pleats.t1, P.pleats.n, 0) },
      uBlow: { value: new Vector4(P.blow.t, P.blow.len * 0.5, P.blow.gap, P.blow.splay) },
      uDome: { value: new Vector4(P.dome.t0, P.dome.t1, P.dome.w, P.dome.h) },
      uTub: { value: tub },
      uNTub: { value: Math.min(lay.tubercles.length, MAX_TUB) },
      uScarA: { value: scA },
      uScarB: { value: scB },
      uNScar: { value: nScar },
      uBarn: { value: barn },
      uNBarn: { value: nBarn },
    },
  });
  const mesh = new Mesh(bg, mat);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  const prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  const prevInfo = renderer.info.autoReset;
  renderer.info.autoReset = false;
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(rt1);
  renderer.clear(true, false, false);
  renderer.render(scene, _cam);
  // pass 2: normals + cavity
  const pass = new FullscreenPass({
    glslVersion: GLSL3,
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: NORM_FRAG,
    uniforms: {
      tA: { value: rt1.textures[0] },
      tB: { value: rt1.textures[1] },
      uTexel: { value: new Vector2(1 / W, 1 / H) },
      uL: { value: L },
    },
  });
  pass.render(renderer, rt2, true);
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAuto;
  renderer.info.autoReset = prevInfo;
  // free the intermediates
  rt1.dispose();
  mat.dispose();
  pass.material.dispose();
  bg.dispose();
  entry = { texA: rt2.textures[0], texB: rt2.textures[1], rt: rt2, ms: performance.now() - t0, res };
  CACHE.set(key, entry);
  return entry;
}

/** Textures already baked for a key (to share without a renderer), or null. */
export function cachedSkin(model, res) {
  return CACHE.get(model.A.baseName + '|' + (model.calf ? 'c' : 'a') + '|' + res) || null;
}

/** Global bake resolution scale (tests use small textures headless). */
export const BAKE = { scale: 1, max: 2048 };

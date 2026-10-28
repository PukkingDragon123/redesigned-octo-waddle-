// Far plants: one instanced mesh of painted cards for every species (a single draw call). Each
// card is a billboard that turns about the plant's up axis (tilting toward the camera when seen
// from above), painted in the fragment shader with the species' silhouette as soft brush shapes
// in its palette and lit like the near plants. They take over from the mid LOD with the same
// dithered cross-fade and dissolve at the far cull distance.
import {
  Mesh, BufferAttribute, InstancedBufferGeometry, InstancedBufferAttribute, ShaderMaterial,
  DoubleSide, Vector2, Vector4, Color, DynamicDrawUsage,
} from 'three';
import { G } from '../render/Globals.js';
import { FLORA_VERT_HEAD, FLORA_FRAG_HEAD } from './glsl.js';

const MAXSP = 9;
const ATTRS = ['iPos', 'iQuat', 'iPrm', 'iSpecies'];

const VERT = /* glsl */ `
attribute float iSpecies;
uniform vec4 uImpA[${MAXSP}];   // lo, hi, band lo, band hi
uniform vec4 uImpB[${MAXSP}];   // half width, height, kind, stiffness
uniform vec3 uImpPal[${MAXSP * 8}];
void main() {
  int sp = int(iSpecies + 0.5);
  vec4 A = uImpA[sp], Bv = uImpB[sp];
  vec3 Bp = iPos.xyz;
  float S = iPos.w, seed = iPrm.x;
  float d = distance(Bp, uCamPos) / max(1.0, S * 0.6);
  float wIn = clamp((d - (A.x - A.z * 0.5)) / max(A.z, 1e-3), 0.0, 1.0);
  float wOut = clamp(((A.y + A.w * 0.5) - d) / max(A.w, 1e-3), 0.0, 1.0);
  if (wIn <= 0.0 || wOut <= 0.0) FLORA_CULL
  vFade = wIn < 1.0 ? -wIn : wOut;
  vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), qrot(iQuat, vec3(0.0, 1.0, 0.0)), 0.5));
  vec3 tc = toCamDir(Bp + up * Bv.y * S * 0.5);
  vec3 right = cross(up, tc);
  right = length(right) > 1e-4 ? normalize(right) : vec3(1.0, 0.0, 0.0);
  vec3 upCard = normalize(cross(tc, right));
  vec3 cu = normalize(mix(up, upCard, 0.55));
  float hw = Bv.x * S, h = Bv.y * S;
  // keep at least a couple of pixels so far silhouettes do not sparkle
  float px = pixelWorld(Bp);
  hw = max(hw, px * 1.2);
  h = max(h, px * 1.6);
  vec2 c = position.xy;
  vec3 P = Bp + right * c.x * hw + cu * c.y * h;
  float sub;
  vec2 bend = floraBend(Bp, Bv.w, seed, sub);
  P = Bp + applyBend(P - Bp, bend, c.y * c.y);
  vPos = P;
  vNrm = normalize(tc * 0.55 + cu * 0.45);
  vW = right;
  vV = cu;
  int p = int(iPrm.z + 0.5);
  vCol = instTint(uImpPal[sp * 8 + p * 2]);
  vAcc = instTint(uImpPal[sp * 8 + p * 2 + 1]);
  vUv = vec4(c.x, c.y, Bv.z, seed);
  vMat = vec4(1.0, 0.3, 0.0, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}
`;

const FRAG = /* glsl */ `
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  lodDither();
  vec2 p = vec2(vUv.x, vUv.y);
  float kind = vUv.z, seed = vUv.w;
  float d = 1.0, lit = 0.5, tipW = 0.0;
  float j = seed * 6.2831;
  if (kind < 0.5) {
    // fiddlehead rosette: three croziers leaning out of the crown, each rolled into a coil
    d = 1.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i) - 1.0;
      float h = fi == 0.0 ? 0.8 : 0.6;
      vec2 top = vec2(fi * 0.42, h);
      vec2 bow = vec2(fi * 0.32 + 0.04, h * 0.55);
      float st = min(sdSeg(p, vec2(fi * 0.08, 0.0), bow), sdSeg(p, bow, top)) - 0.055 * (1.0 - p.y * 0.45);
      vec2 cc = p - (top + vec2(fi == 0.0 ? 0.1 : -fi * 0.09, 0.08));
      float ring = abs(length(cc) - 0.1) - 0.05;
      d = min(d, min(st, ring));
    }
    tipW = smoothstep(0.45, 0.85, p.y);
  } else if (kind < 1.5) {
    // tube cluster: rounded fluted pipes flaring into open mouths
    float t1 = sdSeg(p, vec2(-0.42, 0.0), vec2(-0.5, 0.62)) - (0.13 + 0.12 * smoothstep(0.4, 0.66, p.y));
    float t2 = sdSeg(p, vec2(0.0, 0.0), vec2(0.03, 0.9)) - (0.15 + 0.14 * smoothstep(0.62, 0.95, p.y));
    float t3 = sdSeg(p, vec2(0.42, 0.0), vec2(0.5, 0.72)) - (0.12 + 0.12 * smoothstep(0.48, 0.76, p.y));
    d = min(min(t1, t2), t3);
    tipW = smoothstep(0.45, 0.9, p.y);
  } else if (kind < 2.5) {
    // bells: a mound of arching stalks hung with lanterns
    vec2 q = p - vec2(0.0, 0.1);
    float arch = abs(length(q * vec2(1.0, 1.25)) - 0.7) - 0.06;
    arch = max(arch, -q.y + 0.1);
    float bl = 1.0;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      vec2 c = vec2(-0.72 + fi * 0.36, 0.42 + 0.14 * sin(fi * 1.7) - abs(fi - 2.0) * 0.08);
      vec2 r = p - c;
      bl = min(bl, max(length(r * vec2(1.0, 0.8)) - 0.16, -r.y - 0.12));
    }
    d = min(arch, bl);
    tipW = 1.0 - smoothstep(0.0, 0.04, bl);
  } else if (kind < 3.5) {
    // anemone: low mound crowned with a fringe of fronds
    float mound = length((p - vec2(0.0, 0.18)) * vec2(1.0, 2.2)) - 0.62;
    float fr = length((p - vec2(0.0, 0.45)) * vec2(0.9, 1.4)) - 0.68 - 0.08 * sin(atan(p.y - 0.45, p.x) * 11.0 + j);
    d = min(mound, max(fr, -p.y + 0.15));
    tipW = smoothstep(0.55, 0.95, p.y + abs(p.x) * 0.3);
  } else if (kind < 4.5) {
    // kelp: ribbons streaming up
    d = 1.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float x0 = -0.45 + fi * 0.3;
      float xs = x0 + 0.12 * sin(p.y * 6.0 + fi * 1.7 + j) + p.y * 0.25;
      float w = 0.09 * (1.0 - p.y * 0.6);
      d = min(d, abs(p.x - xs) - w);
    }
    d = max(d, p.y - 0.97);
    tipW = smoothstep(0.4, 1.0, p.y);
  } else if (kind < 5.5) {
    // sea fan: a translucent lattice fan
    vec2 q = p - vec2(0.0, 0.05);
    float fan = length(q * vec2(1.0, 1.05)) - 0.9;
    fan = max(fan, -q.y);
    float trunk = sdSeg(p, vec2(0.0, 0.0), vec2(0.0, 0.2)) - 0.05;
    d = min(fan, trunk);
    tipW = smoothstep(0.5, 0.9, length(q));
  } else {
    // puffballs
    float b1 = length(p - vec2(-0.3, 0.32)) - 0.32;
    float b2 = length(p - vec2(0.35, 0.24)) - 0.24;
    float b3 = length(p - vec2(0.05, 0.62)) - 0.2;
    d = min(min(b1, b2), b3);
    tipW = smoothstep(0.2, 0.8, p.y);
  }
  float aa = max(fwidth(d), 1e-3);
  float a = smoothstep(aa, -aa, d);
  if (kind > 4.5 && kind < 5.5) a *= 0.75;
  #ifdef DEPTH_PASS
    if (a < 0.5) discard;
    gl_FragColor = vec4(1.0);
    return;
  #endif
  if (a < 0.02) discard;
  vec3 alb = mix(vCol, vAcc, tipW);
  float br = noiseTex(vec2(p.x * 0.7 + seed, p.y * 1.3), 0);
  alb *= 0.85 + 0.3 * br;
  // a rounded volume: lit from the sun side of the silhouette, darker at the foot
  vec3 N = normalize(vNrm + vW * clamp(-d * 2.0, 0.0, 0.6) * sign(p.x) * 0.0 + vW * p.x * 0.35);
  float ao = mix(0.55, 1.0, smoothstep(0.0, 0.45, p.y));
  vec3 col = floraLight(alb, N, vPos, ao, 0.35, 0.0, 0.32, 0.3, 0.0, 0.4, vec3(0.0));
  col = applyFog(col, vPos);
  gl_FragColor = vec4(col, a);
}
`;

export function buildImpostor(flora) {
  const quad = new InstancedBufferGeometry();
  quad.setAttribute('position', new BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
  quad.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 2, 1, 3]), 1));
  quad.instanceCount = 0;
  const A = Array.from({ length: MAXSP }, () => new Vector4(0, 0, 1, 1));
  const B = Array.from({ length: MAXSP }, () => new Vector4(1, 1, 0, 2));
  const pal = Array.from({ length: MAXSP * 8 }, () => new Color(0.4, 0.5, 0.3));
  flora.species.forEach((sp, i) => {
    const imp = sp.def.imp;
    if (!imp) return;
    B[i].set(imp.w, imp.h, imp.kind, imp.stiff ?? 2.2);
    for (let p = 0; p < 4; p++) {
      const P = sp.def.palettes[p % sp.def.palettes.length];
      pal[i * 8 + p * 2].set(P[imp.c0 ?? 1]);
      pal[i * 8 + p * 2 + 1].set(P[imp.c1 ?? 2]);
    }
  });
  const mat = new ShaderMaterial({
    vertexShader: FLORA_VERT_HEAD + VERT,
    fragmentShader: FLORA_FRAG_HEAD + FRAG,
    uniforms: Object.assign({}, G, flora.shared, {
      uPal: { value: Array.from({ length: 20 }, () => new Color()) },
      uLod: { value: new Vector4() },
      uLodCfg: { value: new Vector2(8, 0) },
      uImpA: { value: A },
      uImpB: { value: B },
      uImpPal: { value: pal },
    }),
    side: DoubleSide,
  });
  mat.alphaToCoverage = true;
  mat.name = 'flora-impostor';
  const mesh = new Mesh(quad, mat);
  mesh.name = 'flora-far';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.matrixAutoUpdate = false;

  const imp = {
    mesh, material: mat, count: 0, dirty: true, bufs: null,
    allocate() {
      let cap = 0;
      for (const sp of flora.species) if (sp.def.imp && sp.def.lod[2]) cap += sp.n;
      cap = Math.max(1, cap);
      const mk = (n) => new InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(DynamicDrawUsage);
      const g = new InstancedBufferGeometry();
      g.setAttribute('position', quad.getAttribute('position'));
      g.setIndex(quad.getIndex());
      this.bufs = { iPos: mk(4), iQuat: mk(4), iPrm: mk(4), iState: mk(1), iSpecies: mk(1) };
      for (const k in this.bufs) g.setAttribute(k, this.bufs[k]);
      g.instanceCount = 0;
      if (mesh.geometry !== quad) mesh.geometry.dispose();
      mesh.geometry = g;
      this.dirty = true;
    },
    setDistances(ds) {
      flora.species.forEach((sp, i) => {
        const L = sp.def.lod, Bd = sp.def.band;
        if (!sp.def.imp || !L[2]) { A[i].set(0, 0, 1, 1); return; }
        A[i].set(L[1] * ds, L[2] * ds, Bd[1] * ds, Bd[2] * ds);
      });
      this.dirty = true;
    },
    pack() {
      this.dirty = false;
      if (!this.bufs) return;
      const b = this.bufs;
      let o = 0;
      for (const sp of flora.species) {
        if (!sp.def.imp || !sp.def.lod[2]) continue;
        for (const c of sp.active) {
          if (!(c.mask & 4)) { c.off[2] = -1; continue; }
          b.iPos.array.set(c.vPosAll, o * 4);
          b.iQuat.array.set(c.vQuatAll, o * 4);
          b.iPrm.array.set(c.vPrmAll, o * 4);
          b.iSpecies.array.fill(sp.id, o, o + c.count);
          c.off[2] = o;
          o += c.count;
        }
      }
      this.count = o;
      for (const k of ATTRS) {
        const attr = b[k];
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, Math.max(1, o * attr.itemSize));
        attr.needsUpdate = true;
      }
      mesh.geometry.instanceCount = o;
      mesh.visible = o > 0;
    },
    dispose() {
      mesh.geometry.dispose();
      quad.dispose();
      mat.dispose();
    },
  };
  return imp;
}

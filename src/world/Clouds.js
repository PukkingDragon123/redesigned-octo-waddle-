// Volumetric-looking cumulus built from lit spherical impostors ("puffs").
// Each puff is a soft cauliflower sphere with stylized lighting: warm lit tops, cool lilac
// undersides, silver linings when backlit. Puffs part and swirl around the calf's path,
// are blown apart by sonic booms, ripple with the herd's song and glow inside lightning.
import {
  InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor, Vector3, DynamicDrawUsage,
} from 'three';
import { G } from '../render/Globals.js';
import { UNIFORMS, NOISE, LIGHTING, DEPTH } from '../render/shaders/common.js';
import { getNoiseTexture } from '../render/NoiseTex.js';
import { rng, clamp, smoothstep, lerp } from '../core/math.js';

const VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
attribute vec4 aPuff;   // xyz centre, radius
attribute vec4 aLocal;  // offset from cluster centre (normalised), seed
attribute vec4 aExtra;  // x opacity, y moisture, z storm darkness, w flatness (sea fog lenses)
uniform vec3 uDrift;
uniform vec4 uTrail[24];
uniform vec4 uMovers[12];
uniform vec4 uBooms[6];
uniform vec4 uBoomParams[6];
uniform vec4 uSongRipple;
uniform float uSongAmp;
varying vec2 vUv;
varying float vShade;
varying float vSeed;
varying float vAlpha;
varying vec3 vFogCol;
varying float vFog;
varying float vViewZ;
varying float vRadius;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vBack;
varying float vBacklit;
varying float vFlash;
varying float vDark;
varying vec3 vWorld;
varying vec3 vClusterN;
varying float vPeriph;
varying vec2 vOutDir;

vec3 interact(vec3 c, float r) {
  vec3 d = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    vec4 tp = uTrail[i];
    float age = uTime - tp.w;
    if (age < 0.0 || age > 14.0) continue;
    vec3 v = c - tp.xyz;
    float dist = length(v);
    float R = r * 0.85 + 9.0;
    if (dist > R * 2.2) continue;
    float f = exp(-dist * dist / (R * R)) * (1.0 - age / 14.0);
    vec3 n = v / max(dist, 1e-3);
    d += n * f * min(r * 0.4, 11.0);
    d += cross(vec3(0.0, 1.0, 0.0), n) * f * min(r * 0.25, 6.0) * sin(age * 0.7 + 0.5);
  }
  for (int i = 0; i < 12; i++) {
    vec4 m = uMovers[i];
    if (m.w <= 0.0) continue;
    vec3 v = c - m.xyz;
    float dist = length(v);
    float R = r + m.w;
    float f = smoothstep(R * 1.5, R * 0.4, dist);
    d += (v / max(dist, 1e-3)) * f * m.w * 0.6;
  }
  for (int i = 0; i < 6; i++) {
    vec4 b = uBooms[i];
    vec4 bp = uBoomParams[i];
    float age = uTime - b.w;
    if (age < 0.0 || age > 16.0) continue;
    vec3 v = c - b.xyz;
    float dist = length(v);
    float reach = bp.x;
    if (dist > reach + r) continue;
    float front = bp.z * age;
    float passed = smoothstep(front + r, front - r * 0.3, dist);
    float since = max(age - dist / bp.z, 0.0);
    float relax = exp(-since * 0.28);
    d += (v / max(dist, 1e-3)) * passed * relax * bp.y * (1.0 - dist / (reach + r));
  }
  if (uSongAmp > 0.0) {
    vec3 v = c - uSongRipple.xyz;
    float dist = length(v);
    float age = uTime - uSongRipple.w;
    d.y += sin(dist * 0.045 - age * 1.7) * uSongAmp * 3.0 * exp(-dist / 900.0);
  }
  return d;
}

void main() {
  vec3 c = aPuff.xyz + uDrift;
  float r = aPuff.w;
  c += interact(c, r);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 back = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float sz = r * 1.18;
  // flat puffs are lenses: squashed when seen from the side, still round from above
  float flatK = aExtra.w;
  vec3 rightF = right - vec3(0.0, right.y * flatK, 0.0);
  vec3 upF = up - vec3(0.0, up.y * flatK, 0.0);
  vec3 wp = c + (rightF * position.x + upF * position.y) * sz;
  vUv = position.xy * 1.18;
  vRight = right; vUp = up; vBack = back;
  // self-shadowing inside the cluster: sun-facing and upper puffs are brighter
  float sunSide = dot(aLocal.xyz, uSunDir);
  vShade = clamp(0.62 + 0.42 * sunSide + 0.32 * aLocal.y, 0.08, 1.0);
  // a fog bank is lit evenly across its width: only its top is a little brighter
  vShade = mix(vShade, 0.82 + 0.18 * clamp(aLocal.y * 2.0, -1.0, 1.0), flatK);
  vSeed = aLocal.w;
  vClusterN = normalize(aLocal.xyz + vec3(0.0, 0.35, 0.0));
  // silhouette puffs: offset from the cluster centre measured across the view direction
  vec3 vdir = normalize(c - uCamPos);
  vec3 lo = aLocal.xyz;
  vec3 across = lo - dot(lo, vdir) * vdir;
  vPeriph = smoothstep(0.5, 0.95, length(across)) * smoothstep(-0.2, 0.3, -dot(lo, vdir) + 0.3);
  vec2 od = vec2(dot(lo, right), dot(lo, up));
  vOutDir = length(od) > 1e-4 ? normalize(od) : vec2(0.0, 1.0);
  vRadius = r;
  vDark = aExtra.z;
  vec3 toC = c - uCamPos;
  float dist = length(toC);
  vBacklit = pow(max(dot(toC / max(dist, 1e-3), uSunDir), 0.0), 5.0);
  // fade very near puffs (the camera is inside them: the screen veil takes over)
  float near = smoothstep(r * 0.55, r * 1.25, dist);
  vAlpha = aExtra.x * near;
  vFog = fogAmount(c);
  vFogCol = fogColorFor(toC / max(dist, 1e-3));
  vFlash = uFlash * exp(-length(c - uFlashPos) / 700.0);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vViewZ = -mv.z;
  vWorld = wp;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
${DEPTH}
uniform sampler2D uNoise;
varying vec2 vUv;
varying float vShade;
varying float vSeed;
varying float vAlpha;
varying vec3 vFogCol;
varying float vFog;
varying float vViewZ;
varying float vRadius;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vBack;
varying float vBacklit;
varying float vFlash;
varying float vDark;
varying vec3 vWorld;
varying vec3 vClusterN;
varying float vPeriph;
varying vec2 vOutDir;
void main() {
  vec2 uv = vUv;
  float r2 = dot(uv, uv);
  if (r2 > 1.4) discard;
  vec2 sd = vec2(vSeed, vSeed * 1.37);
  float n1 = texture2D(uNoise, uv * 0.3 + sd).g;
  float n2 = texture2D(uNoise, uv * 0.8 + sd * 1.7 + uTime * 0.004).b;
  // cauliflower silhouette
  float edge = r2 + (n1 - 0.55) * 0.6 + (n2 - 0.5) * 0.28;
  // a softer core: overlapping puffs build one continuous mass instead of stacked discs
  float a = smoothstep(1.0, 0.22, edge) * vAlpha;
  if (a < 0.003) discard;
  // pseudo-normal: the cluster's outward normal blended with the lumpy puff surface,
  // so a cloud is lit as one mass instead of a pile of bubbles
  float z = sqrt(max(1.0 - min(r2, 1.0), 0.0));
  vec3 nv = normalize(vec3(uv * (1.0 + (n1 - 0.5) * 0.7), z + 0.2));
  vec3 Np = normalize(vRight * nv.x + vUp * nv.y + vBack * nv.z);
  vec3 N = normalize(vClusterN * 0.8 + Np * 0.34);
  float ndl = dot(N, uSunDir);
  float light = smoothstep(-0.35, 0.7, ndl) * vShade;
  light = mix(light, light * light * (3.0 - 2.0 * light), 0.4);
  // backlit masses are thick and dim in the middle
  light *= 1.0 - vBacklit * 0.35 * (1.0 - vPeriph);
  // shade: skylight fills the upper shadows, the darker sea below fills the base
  vec3 shade = uCloudShadow * mix(0.72, 1.08, smoothstep(-0.6, 0.7, N.y));
  vec3 col = mix(shade, uCloudLit, light);
  col *= mix(0.9, 1.04, N.y * 0.5 + 0.5);
  // billow texture: small cauliflower bumps catch the light on the sunny side
  col *= 1.0 + (n2 - 0.5) * 0.18 * light;
  col += uSkyAmbient * 0.04;
  col += uMoonColor * smoothstep(0.0, 0.8, dot(N, uMoonDir)) * uNight * 0.6;
  // silver lining only along the outer silhouette of the cloud
  float outward = smoothstep(0.1, 0.8, dot(normalize(uv + 1e-4), vOutDir));
  float rim = smoothstep(0.5, 1.0, edge) * vPeriph * outward;
  col += uSunScatter * vBacklit * rim * 1.3;
  col += uSunColor * vBacklit * rim * 0.15;
  // storm clouds are heavier and darker
  col *= 1.0 - vDark * 0.45 * (1.0 - light * 0.5);
  col += vec3(0.75, 0.8, 1.0) * vFlash * (0.6 + 0.6 * (1.0 - edge));
  col = mix(col, vFogCol, vFog);
  // spherical depth: soft intersection with islands and whales
  vec2 suv = gl_FragCoord.xy / uResolution;
  float sceneZ = sceneDepthAt(suv);
  float front = vViewZ - z * vRadius * 0.9;
  float thick = max(vRadius * 0.6, 2.0);
  a *= clamp((sceneZ - front) / thick, 0.0, 1.0);
  // sea fog melts into the sea instead of being cut by it
  a *= smoothstep(uSeaLevel - 0.5, uSeaLevel + max(vRadius * 0.35, 1.5), vWorld.y);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, a);
}
`;

const MAX_PUFFS = 40000;

export class Clouds {
  constructor(game) {
    this.game = game;
    this.max = MAX_PUFFS;
    this.count = 0;
    // master data (unsorted): 12 floats per puff
    this.data = new Float32Array(MAX_PUFFS * 12);
    this.clusters = []; // {center, radius, start, count, moisture}
    const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new BufferAttribute(quad, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPuff = new InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4).setUsage(DynamicDrawUsage);
    this.aLocal = new InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4).setUsage(DynamicDrawUsage);
    this.aExtra = new InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4).setUsage(DynamicDrawUsage);
    geo.setAttribute('aPuff', this.aPuff);
    geo.setAttribute('aLocal', this.aLocal);
    geo.setAttribute('aExtra', this.aExtra);
    geo.instanceCount = 0;
    this.geo = geo;
    this.uniforms = Object.assign({}, G, {
      uNoise: { value: getNoiseTexture() },
      uDrift: { value: new Vector3() },
    });
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      premultipliedAlpha: true,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'clouds';
    game.engine.sceneT.add(this.mesh);
    this.keys = new Float32Array(MAX_PUFFS);
    this.idx = new Uint32Array(MAX_PUFFS);
    this.tmpIdx = new Uint32Array(MAX_PUFFS);
    this.counts = new Uint32Array(256);
    this.qkeys = new Uint16Array(MAX_PUFFS);
    this.inCloud = 0;
    this.playerInCloud = 0;
    this.maxDist = 7500;
    this.budget = 7000;
    // how dark cloud shade is on the sea and land (0 off)
    this.shadowStrength = 0.7;
    this._fwd = new Vector3();
  }

  addPuff(x, y, z, r, lx, ly, lz, seed, opacity = 1, moisture = 0, dark = 0, flat = 0) {
    if (this.count >= this.max) return -1;
    const i = this.count++;
    const o = i * 12;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = r;
    d[o + 4] = lx; d[o + 5] = ly; d[o + 6] = lz; d[o + 7] = seed;
    d[o + 8] = opacity; d[o + 9] = moisture; d[o + 10] = dark; d[o + 11] = flat;
    return i;
  }

  /**
   * A cumulus: a flat base at the condensation level, a few rounded towers rising from it with
   * cauliflower billows over their sunlit tops. w = width, h = height (m); center.y is the base.
   * opts: { seed, opacity, moisture, dark, density, towers, maxPuffs, depth, sparse, minR }
   */
  cumulus(center, w, h, opts = {}) {
    const r = rng(opts.seed ?? 1);
    const start = this.count;
    const ax = w * 0.5, az = w * 0.5 * (opts.depth ?? lerp(0.55, 0.95, r()));
    const base = center.y;
    const cc = new Vector3(center.x, base + h * 0.4, center.z);
    const rad = Math.max(ax, az, h * 0.6);
    // towers: one main dome and a few shoulders, tallest near the middle
    const nT = opts.towers ?? Math.max(1, Math.min(6, Math.round(1 + w / 140 + r() * 1.5)));
    const towers = [];
    let wsum = 0;
    for (let i = 0; i < nT; i++) {
      const main = i === 0;
      const a = r() * Math.PI * 2, d = main ? r() * 0.15 : lerp(0.3, 0.75, Math.sqrt(r()));
      const tx = center.x + Math.cos(a) * ax * d, tz = center.z + Math.sin(a) * az * d;
      const tr = (main ? lerp(0.42, 0.55, r()) : lerp(0.24, 0.4, r())) * Math.min(ax, az) * 1.25;
      // towers no taller than about their width: tall thin stacks read as trees, not cumulus
      const th = Math.min(h * (main ? 1 : lerp(0.45, 0.8, r()) * (1 - d * 0.35)), tr * 2.6);
      const t = { x: tx, z: tz, rx: tr, ry: th * 0.6, rz: tr * lerp(0.85, 1.1, r()), cy: base + th * 0.42 };
      t.wgt = t.rx * (t.ry + t.rx);
      wsum += t.wgt;
      towers.push(t);
    }
    const n = Math.round(clamp((w * h) / (opts.sparse ? 520 : 300), 14, opts.maxPuffs ?? 240) * (opts.density ?? 1));
    const v = new Vector3();
    const minR = opts.minR ?? 5;
    const add = (px, py, pz, pr, op) => {
      v.set(px - cc.x, py - cc.y, pz - cc.z).divideScalar(rad);
      this.addPuff(px, py, pz, pr, v.x, v.y, v.z, r() * 10, (opts.opacity ?? 1) * op, opts.moisture ?? 0, opts.dark ?? 0);
    };
    // a few big core puffs keep the body solid from any angle
    for (const t of towers) add(t.x, Math.max(t.cy, base + t.rx * 0.5), t.z, Math.max(minR, Math.min(t.rx, t.ry) * 0.8), 0.9);
    for (let i = 0; i < n; i++) {
      // pick a tower by size, then a point on its upper shell
      let k = r() * wsum, t = towers[0];
      for (const tt of towers) { k -= tt.wgt; if (k <= 0) { t = tt; break; } }
      const u = r() * 2 - 1, phi = r() * Math.PI * 2;
      let dy = lerp(-0.35, 1, Math.sqrt((u + 1) * 0.5));
      const ring = Math.sqrt(Math.max(0, 1 - dy * dy));
      const shell = lerp(0.78, 1.0, r());
      let px = t.x + Math.cos(phi) * ring * t.rx * shell;
      let pz = t.z + Math.sin(phi) * ring * t.rz * shell;
      let py = t.cy + dy * t.ry * shell;
      // billows shrink toward the cauliflower tops and widen at the flat base
      const top = smoothstep(0.1, 0.9, dy);
      let pr = Math.min(t.rx, t.ry) * lerp(0.36, 0.2, top) * lerp(0.75, 1.2, r());
      pr = Math.max(pr, minR);
      // the base is flat: nothing hangs below the condensation level
      if (py - pr * 0.45 < base) py = base + pr * 0.45;
      add(px, py, pz, pr, lerp(0.85, 1, r()));
    }
    // a skirt of flatter puffs along the base hides the spheres' lower curves
    const nb = Math.round(n * 0.12);
    for (let i = 0; i < nb; i++) {
      const t = towers[Math.floor(r() * towers.length)];
      const phi = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.9;
      const pr = Math.max(minR, t.rx * lerp(0.3, 0.45, r()));
      add(t.x + Math.cos(phi) * t.rx * d, base + pr * 0.42, t.z + Math.sin(phi) * t.rz * d, pr, 0.75);
    }
    const cl = { center: cc.clone(), radius: rad * 1.3, start, count: this.count - start, moisture: opts.moisture ?? 0, kind: 'cumulus',
      // footprints for cast shadows: the towers (xz, radius) on the cloud base
      towers: towers.map((t) => ({ x: t.x, z: t.z, r: Math.max(t.rx, t.rz) * 0.95, y: base })), opacity: opts.opacity ?? 1 };
    this.clusters.push(cl);
    return cl;
  }

  /**
   * A broad, flat sheet of soft puffs (stratus, sea-fog banks). Puffs are flattened lenses
   * (opts.flat, default 0.55) whose density thins toward the edges of the sheet.
   */
  sheet(center, w, d, thickness, opts = {}) {
    const r = rng(opts.seed ?? 3);
    const start = this.count;
    const n = Math.round(clamp((w * d) / (opts.spacing ?? 2600), 4, opts.maxPuffs ?? 220));
    const flat = opts.flat ?? 0.55;
    for (let i = 0; i < n; i++) {
      const x = (r() * 2 - 1) * w * 0.5, z = (r() * 2 - 1) * d * 0.5;
      const pr = lerp(opts.minR ?? 18, opts.maxR ?? 46, r());
      const y = center.y + (r() - 0.5) * thickness;
      // a soft, ragged edge rather than a box
      const ex = Math.max(Math.abs(x) / (w * 0.5), Math.abs(z) / (d * 0.5));
      const edge = 1 - smoothstep(0.6, 1.0, ex + (r() - 0.5) * 0.25);
      this.addPuff(center.x + x, y, center.z + z, pr, x / w, (y - center.y) / Math.max(thickness, 1) * 0.5, z / d, r() * 10,
        (opts.opacity ?? 0.65) * lerp(0.6, 1, r()) * (0.35 + 0.65 * edge), opts.moisture ?? 0, opts.dark ?? 0, flat);
    }
    const cl = { center: center.clone(), radius: Math.max(w, d) * 0.6, start, count: this.count - start, moisture: opts.moisture ?? 0, kind: 'sheet' };
    this.clusters.push(cl);
    return cl;
  }

  /** Wispy moisture-rich cloudlets where plankton blooms. */
  wisps(center, spread, n, opts = {}) {
    const r = rng(opts.seed ?? 5);
    const start = this.count;
    for (let i = 0; i < n; i++) {
      const p = r.inSphere(new Vector3()).multiply(new Vector3(spread, spread * 0.3, spread)).add(center);
      const pr = lerp(opts.minR ?? 10, opts.maxR ?? 26, r());
      this.addPuff(p.x, p.y, p.z, pr, 0, 0.2, 0, r() * 10, (opts.opacity ?? 0.42) * lerp(0.6, 1, r()), opts.moisture ?? 1, opts.dark ?? 0, opts.flat ?? 0.35);
    }
    const cl = { center: center.clone(), radius: spread * 1.2, start, count: this.count - start, moisture: opts.moisture ?? 1, kind: 'wisps' };
    this.clusters.push(cl);
    return cl;
  }

  /** A towering storm cell. */
  tower(center, w, h, opts = {}) {
    const r = rng(opts.seed ?? 9);
    const layers = Math.max(2, Math.round(h / (w * 0.45)));
    let cl = null;
    for (let i = 0; i < layers; i++) {
      const f = i / layers;
      const lw = w * lerp(1.0, 0.65, f) * (i === layers - 1 ? 1.3 : 1);
      const c = new Vector3(center.x + (r() - 0.5) * w * 0.15, center.y + f * h * 0.85, center.z + (r() - 0.5) * w * 0.15);
      cl = this.cumulus(c, lw, h / layers * 1.6, Object.assign({}, opts, { seed: (opts.seed ?? 9) + i * 13 }));
    }
    return cl;
  }

  /** Is a world point inside a cloud? Returns 0..1 (cheap: near clusters only). */
  densityAt(p) {
    // under the sea there is no cloud (sea-fog puffs dip below the surface)
    if (p.y < G.uSeaLevel.value - 0.2) return 0;
    let best = 0;
    const d = this.data;
    const drift = this.uniforms.uDrift.value;
    for (const cl of this.clusters) {
      const cx = cl.center.x + drift.x - p.x, cy = cl.center.y + drift.y - p.y, cz = cl.center.z + drift.z - p.z;
      if (cx * cx + cy * cy + cz * cz > (cl.radius + 80) ** 2) continue;
      for (let i = cl.start; i < cl.start + cl.count; i++) {
        const o = i * 12;
        const dx = d[o] + drift.x - p.x, dy = d[o + 1] + drift.y - p.y, dz = d[o + 2] + drift.z - p.z;
        const r = d[o + 3];
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd < r * r) {
          const k = (1 - Math.sqrt(dd) / r) * 1.6 * d[o + 8];
          if (k > best) best = k;
        }
      }
    }
    return clamp(best, 0, 1);
  }

  /** Nearest moisture-rich cluster to a point (for plankton/krill). */
  moistClusters() {
    return this.clusters.filter((c) => c.moisture > 0.3);
  }

  /** Publish the shadows of the cloud towers nearest the focus (sampleShadow uses them). */
  _shadows(focus) {
    const u = G.uCloudShade.value;
    const drift = this.uniforms.uDrift.value;
    const sun = G.uSunDir.value;
    const sy = Math.max(sun.y, 0.12);
    const list = this._shadeList || (this._shadeList = []);
    list.length = 0;
    for (const cl of this.clusters) {
      if (!cl.towers) continue;
      for (const t of cl.towers) {
        // where the tower's shade lands at the focus height
        const k = (t.y - focus.y) / sy;
        const x = t.x + drift.x, z = t.z + drift.z;
        const gx = x - sun.x * k, gz = z - sun.z * k;
        const d2 = (gx - focus.x) ** 2 + (gz - focus.z) ** 2;
        if (d2 > (2600 + t.r) ** 2) continue;
        t._d2 = d2;
        t._x = x;
        t._z = z;
        list.push(t);
      }
    }
    list.sort((a, b) => a._d2 - b._d2);
    const n = Math.min(16, list.length);
    for (let i = 0; i < 16; i++) {
      if (i < n) u[i].set(list[i]._x, list[i]._z, list[i].r, list[i].y);
      else u[i].set(0, 0, 0, 0);
    }
    // shade needs a sun to cast it
    const k = smoothstep(0.02, 0.2, sun.y) * this.shadowStrength;
    G.uCloudShadeK.value.set(n > 0 ? k : 0, n);
  }

  /** The biggest clouds as seen from the camera, for the sea's reflection map. */
  _blobs(cam) {
    const u = G.uCloudBlobs.value;
    const drift = this.uniforms.uDrift.value;
    const list = this._blobList || (this._blobList = []);
    list.length = 0;
    for (const cl of this.clusters) {
      if (cl.kind !== 'cumulus') continue;
      const x = cl.center.x + drift.x - cam.x, y = cl.center.y + drift.y - cam.y, z = cl.center.z + drift.z - cam.z;
      const d = Math.hypot(x, y, z);
      if (d < cl.radius * 1.2 || y < -cl.radius * 0.3) continue;
      cl._ang = Math.atan(cl.radius * 0.62 / d);
      cl._dx = x / d; cl._dy = y / d; cl._dz = z / d;
      list.push(cl);
    }
    list.sort((a, b) => b._ang - a._ang);
    const n = Math.min(12, list.length);
    for (let i = 0; i < 12; i++) {
      if (i < n) u[i].set(list[i]._dx, list[i]._dy, list[i]._dz, list[i]._ang);
      else u[i].set(0, 1, 0, 0);
    }
    G.uCloudBlobN.value = n;
  }

  update(dt, camera, playerPos) {
    this._shadows(playerPos || camera.position);
    this._blobs(camera.position);
    const cam = camera.position;
    const fwd = camera.getWorldDirection(this._fwd);
    const d = this.data;
    const drift = this.uniforms.uDrift.value;
    let vis = 0;
    const maxD2 = this.maxDist * this.maxDist;
    // cluster-level culling, nearest clusters first so the budget keeps what matters
    const near = this._near || (this._near = []);
    near.length = 0;
    for (const cl of this.clusters) {
      const cx = cl.center.x + drift.x - cam.x, cy = cl.center.y + drift.y - cam.y, cz = cl.center.z + drift.z - cam.z;
      const cd2 = cx * cx + cy * cy + cz * cz;
      if (cd2 > (this.maxDist + cl.radius) ** 2) continue;
      if (cx * fwd.x + cy * fwd.y + cz * fwd.z < -cl.radius - 60) continue;
      cl._d2 = cd2;
      near.push(cl);
    }
    near.sort((a, b) => a._d2 - b._d2);
    for (const cl of near) {
      for (let i = cl.start; i < cl.start + cl.count; i++) {
        const o = i * 12;
        const px = d[o] + drift.x - cam.x, py = d[o + 1] + drift.y - cam.y, pz = d[o + 2] + drift.z - cam.z;
        const r = d[o + 3];
        const depth = px * fwd.x + py * fwd.y + pz * fwd.z;
        if (depth < -r * 1.3) continue;
        const d2 = px * px + py * py + pz * pz;
        if (d2 > maxD2) continue;
        this.keys[vis] = depth;
        this.idx[vis] = i;
        vis++;
        if (vis >= this.budget) break;
      }
      if (vis >= this.budget) break;
    }
    // back-to-front radix sort on quantised depth (two 8-bit passes)
    const n = vis;
    const q = this.qkeys;
    for (let i = 0; i < n; i++) {
      const k = clamp(this.keys[i] / this.maxDist, -0.05, 1) + 0.05;
      q[i] = 65535 - Math.min(65535, Math.floor(k / 1.05 * 65535));
    }
    this._radix(n);
    // upload in sorted order
    const P = this.aPuff.array, Lc = this.aLocal.array, E = this.aExtra.array;
    for (let j = 0; j < n; j++) {
      const i = this.idx[j];
      const o = i * 12, w = j * 4;
      P[w] = d[o]; P[w + 1] = d[o + 1]; P[w + 2] = d[o + 2]; P[w + 3] = d[o + 3];
      Lc[w] = d[o + 4]; Lc[w + 1] = d[o + 5]; Lc[w + 2] = d[o + 6]; Lc[w + 3] = d[o + 7];
      E[w] = d[o + 8]; E[w + 1] = d[o + 9]; E[w + 2] = d[o + 10]; E[w + 3] = d[o + 11];
    }
    this.geo.instanceCount = n;
    if (n > 0) {
      this.aPuff.clearUpdateRanges(); this.aPuff.addUpdateRange(0, n * 4); this.aPuff.needsUpdate = true;
      this.aLocal.clearUpdateRanges(); this.aLocal.addUpdateRange(0, n * 4); this.aLocal.needsUpdate = true;
      this.aExtra.clearUpdateRanges(); this.aExtra.addUpdateRange(0, n * 4); this.aExtra.needsUpdate = true;
    }
    this.visible = n;
    // camera / player inside clouds
    this.inCloud = this.densityAt(cam);
    this.playerInCloud = playerPos ? this.densityAt(playerPos) : 0;
  }

  _radix(n) {
    const q = this.qkeys, idx = this.idx, tmp = this.tmpIdx, counts = this.counts;
    const tmpQ = this._tmpQ || (this._tmpQ = new Uint16Array(this.max));
    for (let pass = 0; pass < 2; pass++) {
      const shift = pass * 8;
      counts.fill(0);
      for (let i = 0; i < n; i++) counts[(q[i] >> shift) & 255]++;
      let sum = 0;
      for (let b = 0; b < 256; b++) { const c = counts[b]; counts[b] = sum; sum += c; }
      for (let i = 0; i < n; i++) {
        const bkt = (q[i] >> shift) & 255;
        const dst = counts[bkt]++;
        tmp[dst] = idx[i];
        tmpQ[dst] = q[i];
      }
      idx.set(tmp.subarray(0, n));
      q.set(tmpQ.subarray(0, n));
    }
  }
}

// WhaleModel: one Vur Sok whale (rorqual / humpback / tulkun body plan that flies) built from a
// genome. Geometry is shared between whales of the same build (only bones, uniforms and baked skin
// are per individual or per type), with three levels of detail swapped by Whale.animate.
//
// Public API (game contract, docs/VUR_SOK.md 4.3): group, bones (+ boneAbs), meshes,
// castShadows(shadows), prof(t), eyes.{R,L,R2,L2}.{mesh, u.uLids, u.uGaze, u.uPupil}, fins.{R,L},
// flukes, rear, u (uniforms the animator drives), L, setFurShells(n), maxShells, setLOD(n).
//
// Building: a new genome builds only its far LOD at once (a few ms). The mid LOD, the fur shells
// and the locks follow in a shared time-sliced queue (run on timers), and the hero LOD is built the
// first time a whale asks for it. WhaleModel.flush() finishes everything at once.
import {
  SkinnedMesh, Mesh, Group, ShaderMaterial, Color, Vector3, Vector4, Matrix4, Quaternion, Sphere,
  SphereGeometry, DoubleSide, InstancedBufferGeometry, Float32BufferAttribute,
} from 'three';
import { G } from '../../render/Globals.js';
import { Anatomy, T_ORIGIN } from './anatomy.js';
import { buildSkeleton } from './skeleton.js';
import { buildBody, BODY_RES } from './body.js';
import { buildFins, FIN_RES } from './fins.js';
import { buildBarbels } from './barbels.js';
import {
  BODY_VERT, BODY_FRAG, FIN_VERT, FIN_FRAG, EYE_VERT, EYE_FRAG, FUR_VERT, FUR_FRAG, LOCK_VERT, LOCK_FRAG,
  BARBEL_VERT, BARBEL_FRAG,
} from './shaders.js';
import { buildShellGeometry, buildLocks, MAX_SHELLS } from './fur.js';
import { bakeSkin, cachedSkin, BAKE } from './bake.js';

export { T_ORIGIN, BAKE };

// Whales waiting for their skin to be painted. The game paints them before a frame starts
// (flushWhaleBakes from engine.beforeRender), never in the middle of a render pass: a bake inside
// the main pass (at night, when no shadow pass runs first) would leave the body undrawn.
const PENDING = new Set();

/** Paint every whale skin still waiting (call between frames, with the renderer). */
export function flushWhaleBakes(renderer) {
  if (!PENDING.size) return;
  for (const m of PENDING) m.bake(renderer);
  PENDING.clear();
}

const GEO_CACHE = new Map();

// ---- shared build queue -------------------------------------------------------------------------
const QUEUE = [];
let pumpTimer = null;
function schedule(job, front = false) {
  if (front) QUEUE.unshift(job); else QUEUE.push(job);
  if (!pumpTimer && typeof setTimeout === 'function') pumpTimer = setTimeout(pump, 16);
}
function runJob(job) {
  try { job(); } catch (e) { console.warn('[whale] build job failed', e); }
}
function pump() {
  pumpTimer = null;
  const t0 = performance.now();
  // one job per tick at least; more while the tick stays short
  do {
    const job = QUEUE.shift();
    if (!job) break;
    runJob(job);
  } while (QUEUE.length && performance.now() - t0 < 8);
  if (QUEUE.length) pumpTimer = setTimeout(pump, 16);
}

// an empty geometry used until the real one is built (keeps the programs compilable)
let _placeholder = null;
function placeholder() {
  if (_placeholder) return _placeholder;
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.instanceCount = 0;
  _placeholder = g;
  return g;
}

export class WhaleModel {
  constructor(genome) {
    this.g = genome;
    const A = (this.A = new Anatomy(genome));
    this.P = A.P;
    this.L = A.L;
    this.calf = A.calf;
    this.group = new Group();
    this.group.name = genome.name || 'whale';
    this.girth = A.girth;
    this.finScale = A.finScale;
    this.key = [A.baseName, A.calf ? 'c' : 'a', this.L, this.girth, this.finScale, A.bellyK, genome.notchedFluke || '', genome.lockDensity ?? 1].join('|');
    this.cacheHit = GEO_CACHE.has(this.key);
    const sk = buildSkeleton(A);
    this.bones = sk.bones;
    this.boneAbs = sk.abs;
    this.boneList = sk.list;
    this.skeleton = sk.skeleton;
    this.boneIndex = sk.boneIndex;
    this.group.add(this.bones.root);
    this.group.updateMatrixWorld(true);
    if (!this.cacheHit) GEO_CACHE.set(this.key, { A, boneIndex: sk.boneIndex, boneAbs: sk.abs, body: [], fins: [], users: new Set(), wants0: false });
    this.cache = GEO_CACHE.get(this.key);
    this.cache.users.add(this);

    this._buildUniforms();
    this._ensure(2);
    if (!this.cacheHit) this._queueBuilds();
    this._buildBody();
    this._buildFins();
    this._buildEyes();
    this._buildFur();
    this._buildBarbels();
    this._bindAll();
    this.lod = -1;
    this.wantLOD = 1;
    this.setLOD(1);
  }

  /** Finish every queued geometry build now (dev scenes, loading screens). */
  static flush() {
    while (QUEUE.length) runJob(QUEUE.shift());
  }

  /** Number of geometry builds still queued. */
  static get pending() {
    return QUEUE.length;
  }

  // ---- shape (contract) ----------------------------------------------------------------------
  prof(t) {
    return this.A.prof(t, {});
  }

  surfacePoint(t, theta, out = new Vector3()) {
    return this.A.surfacePointR(t, theta, out);
  }

  // ---- geometry cache ----------------------------------------------------------------------------
  _ensure(n) {
    const C = this.cache;
    if (!C.body[n]) C.body[n] = buildBody(C.A, C.boneIndex, BODY_RES[n]);
    if (!C.fins[n]) C.fins[n] = buildFins(C.A, C.boneIndex, C.boneAbs, FIN_RES[n]);
  }

  _queueBuilds() {
    const C = this.cache;
    const notify = (what) => { for (const m of C.users) m._onBuilt(what); };
    schedule(() => { if (!C.body[1]) C.body[1] = buildBody(C.A, C.boneIndex, BODY_RES[1]); });
    schedule(() => { if (!C.fins[1]) C.fins[1] = buildFins(C.A, C.boneIndex, C.boneAbs, FIN_RES[1]); notify('lod1'); });
    schedule(() => {
      const b = C.body[1] || C.body[2];
      C.shells = buildShellGeometry(C.A, b.geo, b.outerIndexCount / 3, (C.fins[1] || C.fins[2]).geo);
      notify('shells');
    });
    schedule(() => {
      const b = C.body[1] || C.body[2];
      C.locks = buildLocks(C.A, b.geo, b.outerIndexCount / 3, (C.fins[1] || C.fins[2]).geo, C.A.g.lockDensity ?? 1);
      notify('locks');
    });
  }

  _queueHero() {
    const C = this.cache;
    if (C.wants0) return;
    C.wants0 = true;
    const notify = () => { for (const m of C.users) m._onBuilt('lod0'); };
    // after whatever is queued for this genome's mid LOD (the hero builds on it being there)
    schedule(() => { if (!C.body[0]) C.body[0] = buildBody(C.A, C.boneIndex, BODY_RES[0]); });
    schedule(() => { if (!C.fins[0]) C.fins[0] = buildFins(C.A, C.boneIndex, C.boneAbs, FIN_RES[0]); notify(); });
  }

  _onBuilt(what) {
    if (what === 'lod1' || what === 'lod0') { const w = this.wantLOD; this.lod = -1; this.setLOD(w); }
    if (what === 'shells') this._attachShells();
    if (what === 'locks') this._attachLocks();
  }

  /** Build everything for this whale now, hero LOD included. */
  prepare() {
    this._queueHero();
    WhaleModel.flush();
    this.setLOD(this.wantLOD);
  }

  // ---- uniforms ------------------------------------------------------------------------------
  _buildUniforms() {
    const g = this.g, P = this.P, L = this.L;
    const c = (h, d) => new Color(h || d);
    this.u = {
      uBack: { value: c(g.back, '#3a4250') },
      uBelly: { value: c(g.belly_c, '#e8e2d6') },
      uMark: { value: c(g.mark, g.back) },
      uMark2: { value: c(g.mark2, '#f2f0ea') },
      uHornBase: { value: c(g.hornBase, '#2a2420') },
      uHornTip: { value: c(g.hornTip, '#d9ccb2') },
      uPlateCol: { value: c(g.plate, '#3b4048') },
      uCrestIn: { value: c(g.crestIn, '#c2525a') },
      uMouthColor: { value: c(g.mouth, '#8c4458') },
      uSkinA: { value: null },
      uSkinB: { value: null },
      uBaked: { value: 0 },
      uDbg: { value: 0 },
      uSeed: { value: ((g.seed || 1) * 0.37) % 10 },
      uLen: { value: L },
      // drivers (WhaleAnimator)
      uSac: { value: 0.3 },
      uThroat: { value: 0 },
      uVib: { value: 0 },
      uGill: { value: 0 },
      uBreath: { value: 0 },
      uFlush: { value: 0 },
      uBlow: { value: 0 },
      uVent: { value: 0 },
      uCrest: { value: new Vector4(0.7, 0, 0, 0) },
      uWetSelf: { value: 0 },
      uWhip: { value: 0 },
      uInertia: { value: new Vector3() },
      uAirflow: { value: new Vector3() },
      // fur (Birds.js reads uFurLen to perch on the back)
      uFurLen: { value: 0.017 * L * (g.furScale ?? 1) },
      // strands per metre: coarse enough that each lock reads as a soft painted tuft
      uFurDensity: { value: (this.calf ? 64 : 10 * Math.sqrt(22 / Math.max(L, 8))) * (g.furDensityScale ?? 1) },
      uFurShade: { value: g.furShade ?? 0.72 },
      uFurTip: { value: g.furTip ?? 1.12 },
      uBlowLoc: { value: new Vector4(P.blow.t, P.blow.len * 0.5, P.blow.gap, P.blow.splay) },
      uPleat: { value: new Vector4(P.pleats.t0, P.pleats.t1, P.pleats.n, 0) },
    };
  }

  // ---- body -------------------------------------------------------------------------------------
  _buildBody() {
    const mat = new ShaderMaterial({
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      uniforms: Object.assign({}, G, this.u),
      side: DoubleSide,
    });
    mat.extensions = { derivatives: true };
    const mesh = new SkinnedMesh(this.cache.body[2].geo, mat);
    mesh.name = 'body';
    this.body = mesh;
    this.group.add(mesh);
    // the skin is painted on the GPU the first time this whale is drawn (shared per type)
    this.skinRes = Math.max(128, Math.min(BAKE.max, Math.round((this.g.skinRes || 1024) * BAKE.scale)));
    const have = cachedSkin(this, this.skinRes);
    if (have) this._useSkin(have);
    else PENDING.add(this);
  }

  /** Bake (or fetch) this whale's skin textures. Safe to call any time with the renderer. */
  bake(renderer) {
    if (this.u.uBaked.value > 0.5) return;
    try {
      this._useSkin(bakeSkin(renderer, this, this.skinRes));
    } catch (e) {
      console.warn('[whale] skin bake failed', e);
      this.u.uBaked.value = 0;
    }
    PENDING.delete(this);
  }

  _useSkin(entry) {
    this.u.uSkinA.value = entry.texA;
    this.u.uSkinB.value = entry.texB;
    this.u.uBaked.value = 1;
    this.skin = entry;
  }

  // ---- fins -------------------------------------------------------------------------------------
  _buildFins() {
    const P = this.P, L = this.L, g = this.g;
    const info = this.cache.fins[2].info;
    const up = (xf) => new Vector3(0, 1, 0).applyQuaternion(new Quaternion().setFromRotationMatrix(xf));
    const finUp = [
      up(info.wings.R.xf), up(info.wings.L.xf), up(info.rear.R.xf), up(info.rear.L.xf), new Vector3(0, 1, 0), new Vector3(0, 1, 0),
    ];
    const chord = [P.wing.chordMax * L, P.wing.chordMax * L, P.rearFin.chord * L, P.rearFin.chord * L, P.fluke.chord * L, P.fluke.chord * L];
    const torn = g.tornWing === 'R' ? 0 : g.tornWing === 'L' ? 1 : -1;
    this.finU = {
      uBillow: { value: [0, 0, 0, 0, 0, 0] },
      uFlutter: { value: [0.01, 0.01, 0.01, 0.01, 0.01, 0.01] },
      uFinUp: { value: finUp },
      uChord: { value: chord },
      uTear: { value: new Vector4(torn, 1, 0, 0) },
      uMembrane: { value: new Color(g.membrane || '#5d5560') },
      uFinTip: { value: new Color(g.finTip || g.membrane || '#6d5f68') },
      uFinMark: { value: new Color(g.finMark || '#e8e4dc') },
      uFinMarkAmt: { value: g.finMarkAmt ?? 0.15 },
      uFinBarn: { value: this.calf ? 0 : Math.min(1, (g.barnacles ?? 0) * 1.1) },
    };
    const mat = new ShaderMaterial({
      vertexShader: FIN_VERT,
      fragmentShader: FIN_FRAG,
      uniforms: Object.assign({}, G, this.u, this.finU),
      side: DoubleSide,
    });
    mat.extensions = { derivatives: true };
    const mesh = new SkinnedMesh(this.cache.fins[2].geo, mat);
    mesh.name = 'fins';
    this.finMesh = mesh;
    this.group.add(mesh);
    // contract aliases: one merged mesh serves every fin
    this.fins = { R: mesh, L: mesh };
    this.flukes = { R: mesh, L: mesh };
    this.rear = { R: mesh, L: mesh };
  }

  // ---- eyes ------------------------------------------------------------------------------------
  _buildEyes() {
    const P = this.P, L = this.L, g = this.g, A = this.A;
    this.eyes = {};
    const C = this.cache;
    const mk = (name, e, side, primary) => {
      const r = e.r * L * (g.eyeScale ?? 1);
      const key = 'eyeGeo' + Math.round(r * 10000);
      const geo = C[key] || (C[key] = new SphereGeometry(r, 36, 26));
      const sp = A.spot(e.t, e.m, side);
      // sunk deep in its socket: only a shallow cap shows between the lids
      const center = sp.p.clone().addScaledVector(sp.n, -r * 0.72);
      // socket frame: looking out and a little forward, up = world up
      const fwd = sp.n.clone().multiplyScalar(0.8).add(new Vector3(0, 0.02, 0.2)).normalize();
      const upv = new Vector3(0, 1, 0);
      const x = new Vector3().crossVectors(upv, fwd).normalize();
      const y = new Vector3().crossVectors(fwd, x).normalize();
      const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, fwd));
      // map socket angles to the baked skin's uv around the eye (the lids show that skin)
      const th = sp.th;
      const sC = A.sOf(e.t, th), vC = A.texV(e.t);
      const dt = 0.002;
      const pT = A.surfacePoint(e.t + dt, th).sub(A.surfacePoint(e.t - dt, th)).divideScalar(2 * dt);
      const dth = 0.004;
      const dsdth = (A.sOf(e.t, th + dth) - A.sOf(e.t, th - dth)) / (2 * dth);
      // dP/ds = (dP/dtheta) / (ds/dtheta)
      const pS = A.surfacePoint(e.t, th + dth).sub(A.surfacePoint(e.t, th - dth)).divideScalar(2 * dth * dsdth);
      const dv = A.texDvDt(e.t);
      const J = new Vector4(
        (x.dot(pS) / pS.lengthSq()) * r, (y.dot(pS) / pS.lengthSq()) * r,
        (x.dot(pT) / pT.lengthSq()) * r * dv, (y.dot(pT) / pT.lengthSq()) * r * dv,
      );
      const u = Object.assign({}, G, {
        uGaze: { value: new Vector3(0, 0, 1) },
        uLids: { value: new Vector4(0.3, -0.26, -0.55, 0.32) },
        uPupil: { value: this.calf ? 0.2 : 0.17 },
        uIrisR: { value: this.calf ? 0.82 : 0.76 },
        uIris: { value: new Color(g.iris || '#c98a2c') },
        uIris2: { value: new Color(g.iris2 || '#3a1e08') },
        uLidCol: { value: new Color(g.lid || g.back || '#333') },
        uSclera: { value: new Color(g.sclera || '#cbbfae') },
        uSide: { value: side },
        uSparkle: { value: this.calf ? 1 : 0.6 },
        uSkinA: this.u.uSkinA,
        uBaked: this.u.uBaked,
        uSkinUV: { value: new Vector4(sC, vC, 0, 0) },
        uSkinJ: { value: J },
        uSkinNL: { value: sp.n.clone().applyQuaternion(q.clone().invert()) },
        uWetSelf: this.u.uWetSelf,
      });
      const mat = new ShaderMaterial({ vertexShader: EYE_VERT, fragmentShader: EYE_FRAG, uniforms: u });
      mat.extensions = { derivatives: true };
      const mesh = new Mesh(geo, mat);
      mesh.name = 'eye' + name;
      mesh.position.copy(center).sub(this.boneAbs.head);
      mesh.quaternion.copy(q);
      this.bones.head.add(mesh);
      this.eyes[name] = { mesh, u, basis: q.clone(), center, r, primary };
    };
    mk('R', P.eye, 1, true);
    mk('L', P.eye, -1, true);
    mk('R2', P.eye2, 1, false);
    mk('L2', P.eye2, -1, false);
  }

  // ---- fur: shells (instanced per shell) and locks (instanced cards) ---------------------------
  _buildFur() {
    const g = this.g;
    this.maxShells = this.calf ? 20 : 24;
    this.furU = {
      uShellH: { value: new Array(MAX_SHELLS).fill(1) },
      uCurl: { value: g.furCurl ?? (this.calf ? 0.4 : 0.5) },
      uJiggle: { value: new Vector4() },
      uLockGrow: { value: 1 },
    };
    const mat = new ShaderMaterial({
      vertexShader: FUR_VERT,
      fragmentShader: FUR_FRAG,
      uniforms: Object.assign({}, G, this.u, this.furU),
      side: DoubleSide,
    });
    mat.alphaToCoverage = true;
    const fur = new SkinnedMesh(placeholder(), mat);
    fur.name = 'fur';
    fur.visible = false;
    this.fur = fur;
    this.group.add(fur);
    const lmat = new ShaderMaterial({
      vertexShader: LOCK_VERT,
      fragmentShader: LOCK_FRAG,
      uniforms: Object.assign({}, G, this.u, this.furU),
      side: DoubleSide,
    });
    lmat.alphaToCoverage = true;
    const locks = new SkinnedMesh(placeholder(), lmat);
    locks.name = 'locks';
    locks.visible = false;
    this.locks = locks;
    this.group.add(locks);
    this.furShells = this.maxShells;
    this.lockFrac = 1;
    this.lockCount = 0;
    if (this.cache.shells) this._attachShells();
    if (this.cache.locks) this._attachLocks();
  }

  _wrap(src) {
    const geo = new InstancedBufferGeometry();
    for (const k in src.attributes) geo.setAttribute(k, src.attributes[k]);
    geo.setIndex(src.index);
    geo.instanceCount = 0;
    return geo;
  }

  _attachShells() {
    if (this.fur.geometry !== placeholder()) return;
    this.fur.geometry = this._wrap(this.cache.shells);
    const n = this.furShells;
    this.furShells = -1;
    this.setFurShells(n);
  }

  _attachLocks() {
    if (this.locks.geometry !== placeholder()) return;
    this.locks.geometry = this._wrap(this.cache.locks);
    this.lockCount = this.cache.locks.userData.cards;
    this.setLocks(this.lockFrac);
  }

  // ---- barbels ---------------------------------------------------------------------------------
  _buildBarbels() {
    const C = this.cache;
    if (!C.barbels) C.barbels = buildBarbels(this.A, this.boneAbs.jaw);
    const mat = new ShaderMaterial({
      vertexShader: BARBEL_VERT,
      fragmentShader: BARBEL_FRAG,
      uniforms: Object.assign({}, G, this.u),
    });
    const mesh = new Mesh(C.barbels.geo, mat);
    mesh.name = 'barbels';
    mesh.frustumCulled = false;
    this.bones.jaw.add(mesh);
    this.barbels = mesh;
  }

  _bindAll() {
    this.group.updateMatrixWorld(true);
    const ident = new Matrix4();
    for (const m of [this.body, this.finMesh, this.fur, this.locks]) {
      m.bind(this.skeleton, ident);
      // preset bounds (radius ~L holds wings, horns, flukes and hair): three would otherwise skin
      // every vertex on the CPU to compute them; with bounds set, whole whales cull cheaply
      m.boundingSphere = new Sphere(new Vector3(0, 0, -0.05 * this.L), this.L * 0.85);
      m.frustumCulled = true;
    }
    this.meshes = [this.body, this.finMesh];
  }

  /** Level of detail 0 (hero) .. 2 (far): swaps the shared geometries (finest built so far). */
  setLOD(n) {
    n = Math.max(0, Math.min(2, n | 0));
    this.wantLOD = n;
    if (n === 0 && !this.cache.body[0]) this._queueHero();
    let k = n;
    while (k < 2 && !(this.cache.body[k] && this.cache.fins[k])) k++;
    if (k === this.lod) return;
    this.lod = k;
    this.body.geometry = this.cache.body[k].geo;
    this.finMesh.geometry = this.cache.fins[k].geo;
    for (const key in this.eyes) this.eyes[key].mesh.visible = n === 0 || (n === 1 && this.eyes[key].primary);
    this.barbels.visible = n < 2;
  }

  castShadows(shadows) {
    for (const m of this.meshes) shadows.addCaster(m);
  }

  /** Shell fur LOD: number of shells drawn (0 hides the coat); heights stay evenly spread. */
  setFurShells(n) {
    n = Math.max(0, Math.min(this.maxShells, Math.round(n)));
    if (n !== this.furShells) {
      const H = this.furU.uShellH.value;
      for (let i = 0; i < n; i++) H[i] = (i + 1) / n;
      this.furShells = n;
    }
    const ready = this.fur.geometry !== placeholder();
    this.fur.geometry.instanceCount = ready ? n : 0;
    this.fur.visible = ready && n > 0;
  }

  /** Lock LOD: fraction of the hair cards drawn (they are shuffled, so any prefix is even). */
  setLocks(frac) {
    this.lockFrac = Math.max(0, Math.min(1, frac));
    if (this.locks.geometry === placeholder()) return;
    const n = Math.round(this.lockCount * this.lockFrac);
    this.locks.geometry.instanceCount = n;
    this.locks.visible = n > 0;
    // fewer, fuller locks keep the silhouette when thinned
    this.furU.uLockGrow.value = 1 + (1 - Math.max(0.15, this.lockFrac)) * (this.calf ? 0.12 : 0.35);
  }

  setVisible(v) {
    this.group.visible = v;
  }

  // ---- world-space landmarks (effects, gestures) ------------------------------------------------
  /** World position of the blowholes (between the twin slits). */
  blowholePos(out = new Vector3()) {
    const A = this.A;
    A.surfacePointR(A.P.blow.t, 0, out);
    out.y += this.L * 0.004;
    const b = this.bones.head;
    b.updateWorldMatrix(true, false);
    return out.sub(this.boneAbs.head).applyMatrix4(b.matrixWorld);
  }

  /** World position of a fluke lobe tip ('R' | 'L'), or of the notch with no side. */
  flukePos(side, out = new Vector3()) {
    const name = side ? 'fluke' + side : 'fluke';
    const b = this.bones[name];
    b.updateWorldMatrix(true, false);
    if (!side) return out.set(0, 0, 0).applyMatrix4(b.matrixWorld);
    const F = this.P.fluke;
    // lobe tips sweep back: relative to the lobe bone, out along the span and back
    out.set((side === 'R' ? 1 : -1) * F.span * this.L * 0.8, 0, -F.span * this.L * 0.55);
    return out.applyMatrix4(b.matrixWorld);
  }

  /** World position of a wing tip ('R' | 'L'). */
  wingTipPos(side, out = new Vector3()) {
    const b = this.bones['fin' + side + '3'];
    b.updateWorldMatrix(true, false);
    const span = this.P.wing.span * this.L * this.finScale;
    return out.set((side === 'R' ? 1 : -1) * span * 0.28, 0, -span * 0.06).applyMatrix4(b.matrixWorld);
  }
}

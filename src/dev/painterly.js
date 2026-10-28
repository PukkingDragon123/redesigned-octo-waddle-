// Dev scene: the painterly passes (src/render/painterly) on spiral islands, whales, the sea and
// clouds. The passes are wired into the running engine at runtime (no engine file is touched):
// the AO runs as the first engine mid pass (after the opaque pass, before the transparent one),
// and PostFX's final composite is redirected into the painterly LDR target, then painted.
//
// ?debug&test=painterly&view=coast|whale|face|wide|title|cliff|stack&time=morning
//   &pp=0|1            the whole painterly chain off / on (default on)
//   &ao=0|1|only|sun|raw|normal   AO off / on / the occlusion multiplier / the direct-sun estimate /
//                      raw GTAO / reconstructed normals            &temporal=0  AO without history
//   &kuw=<s>           painterly strength (0: no strokes, grade or canvas; default 1)
//   &dof=0|gameplay|title|cinematic   depth of field preset (default off, title view: title)
//   &q=<0..1>          quality (default 1)
//   &split=<x>         left of x shows the unprocessed frame (before/after in one image)
//   &dbg=1             Kuwahara debug (r: radius, g: anisotropy, b: fine-detail measure)
//   &orbit=<deg/s>     orbit the camera around its target (temporal stability checks)
//   &ocean=1           the real Ocean instead of the placeholder sea (slow headless)
//   &shells=N          whale fur shells (fewer is faster headless)
//   &aor=<m> &aos=<s> &aop=<pow> &bounce=<s> &kr=<px> &kh=<hardness>   tuning overrides
//   &cam=x,y,z&look=x,y,z   free camera
import { Vector3, Group, Mesh, CylinderGeometry, Color, Float32BufferAttribute } from 'three';
import { PainterlyPost } from '../render/painterly/index.js';
import { WhaleModel } from '../creatures/WhaleModel.js';
import { CALF, MOTHER, ELDER, ADULTS } from '../creatures/WhaleTypes.js';
import { rng } from '../core/math.js';

const ISLANDS = [
  { name: 'coil', pos: [0, 0, -380], shape: (I) => I.coilShape({ a: 22, b: 0.2, turns: 1.75, kw: 0.23, Hin: 78, fall: 2.0, seed: 5, steps: 12 }), style: { rock: 'banded' } },
  { name: 'stackA', pos: [-170, 0, -170], shape: (I) => I.stackShape({ R: 20, H: 92, lobes: 2, lobeAmp: 0.2, twist: 0.7, seed: 3, caves: [{ th: 0.4, w: 0.32, h: 10, depth: 0.42 }] }), style: { rock: 'limestone' } },
  { name: 'stackB', pos: [150, 0, -150], shape: (I) => I.stackShape({ R: 14, H: 70, lobes: 3, lobeAmp: 0.16, twist: 1.0, seed: 9, topFrac: 0.9, bulge: 0.2, notch: 0.24 }), style: { rock: 'banded' } },
  { name: 'stackC', pos: [-60, 0, -120], shape: (I) => I.stackShape({ R: 8, H: 40, lobes: 2, lobeAmp: 0.25, twist: 1.3, seed: 11, cap: 'point', topFrac: 0.3 }), style: { rock: 'banded' } },
  { name: 'ammonite', pos: [260, 0, -330], shape: (I) => I.ammoniteShape({ R: 70, yaw: 0.5, seed: 31 }), style: { rock: 'banded' } },
  { name: 'peak', pos: [-380, 0, -720], shape: (I) => I.peakShape({ R: 75, H: 185, turns: 2.3, seed: 6 }), style: { rock: 'warm' } },
];

const VIEWS = {
  coast: [[2, 6, -52], [-44, 5, -112]],
  whale: [[-14, 5.5, -106], [-33, 1.2, -97]],
  face: [[-22.5, 2.4, -95.5], [-30.8, 1.2, -94.2]],
  wide: [[80, 70, 90], [-30, 20, -330]],
  title: [[6, 7, -50], [-36, 3.5, -100]],
  cliff: [[-118, 8, -118], [-160, 14, -168]],
  stack: [[-20, 18, -60], [-60, 16, -122]],
};

// Fallback rock if the island builder is mid-edit: a coiled column like the ocean dev scene's.
async function fallbackRock(seed, radius, height) {
  const { toonMaterial } = await import('../render/materials.js');
  const r = rng(seed);
  const geo = new CylinderGeometry(radius * 0.55, radius, height + 20, 48, 40, false);
  geo.translate(0, (height + 20) * 0.5 - 20, 0);
  const pos = geo.attributes.position;
  const col = [];
  const tint = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const coil = Math.sin(a * 2 - y * 0.18) * 0.18 + Math.sin(a * 5 + y * 0.4 + seed) * 0.05;
    const k = 1 + coil + (r() - 0.5) * 0.04;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
    tint.setRGB(0.5, 0.42, 0.34).multiplyScalar(0.85 + coil);
    col.push(tint.r, tint.g, tint.b);
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new Mesh(geo, toonMaterial({ color: 0xffffff, vertexColors: true, rim: 0.2, paint: 1 }));
}

export default async function (game) {
  const p = game.params;
  const eng = game.engine;
  const scene = eng.scene;
  const shells = p.has('shells') ? +p.get('shells') : null;
  if (!p.get('time')) game.atmosphere.set('morning');

  // ---- sea ------------------------------------------------------------------------------
  if (p.get('ocean') === '1') {
    try {
      const { Ocean } = await import('../world/Ocean.js');
      game.ocean = game.ocean || new Ocean(game);
      if (game.cloudSea) game.cloudSea.enabled = false;
    } catch (e) {
      console.warn('[painterly] ocean unavailable', e);
    }
  }
  if (!game.ocean) {
    try {
      const { placeholderSea } = await import('../world/Water.js');
      placeholderSea(game);
    } catch (e) {
      console.warn('[painterly] placeholder sea unavailable', e);
    }
  }

  // ---- islands ----------------------------------------------------------------------------
  const root = new Group();
  root.name = 'painterly-dev';
  scene.add(root);
  let I = null;
  try {
    I = await import('../world/Islands.js');
  } catch (e) {
    console.warn('[painterly] island builder unavailable, using fallback rocks', e);
  }
  for (const sp of ISLANDS) {
    let m = null;
    try {
      if (I) m = I.buildIsland({ shape: sp.shape(I), style: sp.style, seed: sp.pos[0] * 7 + sp.pos[2] }).mesh;
    } catch (e) {
      console.warn('[painterly] island', sp.name, e);
    }
    if (!m) m = await fallbackRock(sp.pos[0] + sp.pos[2], sp.name === 'stackC' ? 8 : 18, sp.name === 'peak' ? 160 : 60);
    m.position.set(sp.pos[0], 0, sp.pos[2]);
    root.add(m);
    eng.shadows.addCaster(m);
  }

  // ---- whales -------------------------------------------------------------------------------
  const whales = [];
  const addWhale = (genome, pos, yaw, pitch = 0, roll = 0) => {
    const w = new WhaleModel(genome);
    w.group.position.set(...pos);
    w.group.rotation.set(pitch, yaw, roll, 'YXZ');
    if (shells !== null) w.setFurShells(shells);
    scene.add(w.group);
    w.castShadows(eng.shadows);
    whales.push(w);
    return w;
  };
  addWhale(MOTHER, [-35, 0.35, -100], 0.6, -0.04);
  addWhale(CALF, [-40, 0.55, -88], 0.2, 0.02, 0.1);
  addWhale(ELDER, [64, 34, -232], -2.4, 0.05, -0.12);
  addWhale(ADULTS[1], [-96, 26, -258], 1.9, -0.06, 0.15);
  addWhale(ADULTS[0], [-150, 9, -128], 2.6, 0.08, 0.2);
  window.__whales = whales;

  // ---- clouds -------------------------------------------------------------------------------
  const r = rng(11);
  for (let i = 0; i < 16; i++) {
    const c = new Vector3((r() - 0.5) * 3600, 280 + r() * 380, -600 - r() * 2600);
    game.clouds.cumulus(c, 220 + r() * 300, 120 + r() * 200, { seed: 60 + i, sparse: true });
  }

  // ---- camera ---------------------------------------------------------------------------------
  const viewName = p.get('view') || 'coast';
  let v = VIEWS[viewName] || VIEWS.coast;
  if (p.get('cam')) v = [p.get('cam').split(',').map(Number), (p.get('look') || '0,0,-300').split(',').map(Number)];
  const camPos = new Vector3(...v[0]);
  const look = new Vector3(...v[1]);
  const orbit = ((+p.get('orbit') || 0) * Math.PI) / 180;
  const cam = eng.camera;
  cam.far = 16000;
  cam.updateProjectionMatrix();
  const tmp = new Vector3();
  game.cameraRig.update = () => {
    tmp.copy(camPos).sub(look).applyAxisAngle(new Vector3(0, 1, 0), orbit * game.time).add(look);
    cam.position.copy(tmp);
    cam.lookAt(look);
  };
  game.focus.copy(look).setY(Math.max(10, look.y));
  eng.shadows.radius = 260;

  // ---- the painterly passes, wired in at runtime ---------------------------------------------
  // Reuse an instance the engine already carries (once the lead integrates it); otherwise wire one
  // in here: the AO as the first mid pass, the paint pass after PostFX's composite.
  const q = p.has('q') ? +p.get('q') : 1;
  const own = !(eng.painterly instanceof PainterlyPost);
  const pp = own ? new PainterlyPost(eng.renderer, { quality: q }) : eng.painterly;
  if (!own && p.has('q')) pp.setQuality(q);
  pp.setSize(eng.width, eng.height);
  const ppOn = p.get('pp') !== '0';
  const aoMode = p.get('ao') || '1';
  pp.enabled = ppOn;
  pp.aoEnabled = aoMode !== '0';
  if (p.has('temporal')) pp.ao.temporal = p.get('temporal') !== '0';
  if (p.has('kuw')) pp.strength = +p.get('kuw');
  if (p.has('split')) pp.split = +p.get('split');
  if (p.has('dbg')) pp.paint.debug = 1;
  if (p.has('aor')) pp.aoParams.radius = +p.get('aor');
  if (p.has('aos')) pp.aoParams.strength = +p.get('aos');
  if (p.has('aop')) pp.aoParams.power = +p.get('aop');
  if (p.has('bounce')) pp.aoParams.bounce = +p.get('bounce');
  if (p.has('kr')) pp.paintParams.radius = +p.get('kr');
  if (p.has('kh')) pp.paintParams.hardness = +p.get('kh');
  const dofName = p.get('dof') || (viewName === 'title' ? 'title' : 'off');
  pp.setDof(dofName === '0' ? 'off' : dofName === '1' ? 'cinematic' : dofName);
  if (own) pp.precompile(cam);

  if (!eng.midPasses.includes(pp.aoPass)) eng.midPasses.unshift(pp.aoPass);
  const post = eng.post;
  const postRender = post.render.bind(post);
  const renderer = eng.renderer;
  // PostFX may already carry the integration hook (post.painterly: composite -> ldrTarget -> apply)
  const hooked = /painterly/.test(String(post.render));
  if (hooked) post.painterly = ppOn ? pp : null;
  const setRT = renderer.setRenderTarget;
  const toLdr = function (t, ...rest) { return setRT.call(this, t === null ? pp.ldrTarget : t, ...rest); };
  const opts = { time: 0 };
  post.render = (rr, rt, camera) => {
    if (pp.width !== eng.width || pp.height !== eng.height) pp.setSize(eng.width, eng.height);
    if (!ppOn || hooked) {
      postRender(rr, rt, camera);
    } else {
      // the composite (tonemap + grade) lands in the painterly LDR target instead of the screen;
      // the painterly pass then owns the soft edge darkening, so the composite's vignette halves
      const vig = post.grade?.uVignette;
      const vig0 = vig ? vig.value : 0;
      if (vig) vig.value = vig0 * 0.5;
      renderer.setRenderTarget = toLdr;
      try {
        postRender(rr, rt, camera);
      } finally {
        renderer.setRenderTarget = setRT;
        if (vig) vig.value = vig0;
      }
      opts.time = game.time;
      pp.apply(pp.ldrTarget.texture, rt.depthTexture, camera, null, opts);
    }
    if (!ppOn) return;
    if (aoMode === 'only') pp.ao.renderDebug(null, 1);
    if (aoMode === 'sun') pp.ao.renderDebug(null, 2);
    if (aoMode === 'raw') pp.ao.renderDebug(null, 3);
    if (aoMode === 'normal') pp.ao.renderDebug(null, 4);
  };
  game.painterly = pp;
  window.__pp = pp;
}

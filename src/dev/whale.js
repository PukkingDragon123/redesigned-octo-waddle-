// Dev scene: static inspection of every whale variant, organ states and close-ups.
// ?debug&test=whale&who=calf|mother|elder|alpha|a1..a5|pip|moss|ember|young|mate|newborn|elderself|lineup|life
//   &view=<view>&time=<preset>   (life: the life-cycle genomes side by side)
//   views: side | q (three-quarter front) | front | back | top | under | face | eye | eye2 | organs |
//          crest | horn | throat | wing | wingup | wingL | wingLup | fluke | plates | mane | skin | belly | far
//   organ states: &sing=0..1 &hum=0..1 &charge=0..1 &blow=0..1 &mouth=0..1 &throat=0..1
//                 &crest=raise,flare &vent=0..1 &flush=0..1
//   &sea          the real Ocean under the whales (slow headless)    &alt=<m> altitude (default 26)
//   &lod=0|1|2    force a level of detail                             &shells=N fur shells  &locks=<0..1>
//   &yaw=<deg>    turn the subject       &cam=x,y,z&look=x,y,z (relative to the subject)   &fov=<deg>
//   &orbit=<deg/s> orbit the camera      &dist=<k> scale the view distance
//   &anim         drive the models with WhaleAnimator (hovering in place)
//   &gesture=<name>&gt=<0..1>  hold a gesture at that phase (with &anim)   &flap=<0..1> hold a wingbeat phase
//   &effort=<0..1> wingbeat effort   &bumpdir=x,y,z  a bump every 3 s
//   &wet=<0..1>   the wet sheen of a whale fresh from the sea (skin, eyes, coat, whips)
//   &noao         no screen-space AO      &paint=plain   no painterly strokes
import { Vector3, Euler } from 'three';
import { WhaleModel, BAKE } from '../creatures/whale/Model.js';
import { WhaleAnimator, GESTURES } from '../creatures/WhaleAnimator.js';
import { Quaternion } from 'three';
import * as TYPES from '../creatures/WhaleTypes.js';
const { CALF, MOTHER, ELDER, ADULTS, CALVES } = TYPES;
import { G } from '../render/Globals.js';

const GENOMES = () => ({
  calf: CALF, mother: MOTHER, elder: ELDER, alpha: ADULTS[0],
  a1: ADULTS[1], a2: ADULTS[2], a3: ADULTS[3], a4: ADULTS[4], a5: ADULTS[5],
  pip: CALVES[0], moss: CALVES[1], ember: CALVES[2],
  // life-cycle genomes (the story builder's; absent ones fall back)
  young: TYPES.YOUNG || MOTHER, mate: TYPES.MATE || MOTHER, newborn: TYPES.NEWBORN || CALF, elderself: TYPES.ELDER_SELF || ELDER,
});

export default async function (game) {
  const p = game.params;
  const s = game.engine.scene;
  if (!p.get('time')) game.atmosphere.set('morning');
  // &noao: no screen-space AO (its temporal filter needs many frames to settle headless)
  // &paint=plain: no painterly strokes (debug comparisons)
  if (p.has('noao') && game.engine.painterly) game.engine.painterly.aoEnabled = false;
  if (p.get('paint') === 'plain') game.engine.setLook?.('plain');
  if (game.cloudSea) game.cloudSea.enabled = false;
  if (p.has('sea')) {
    try {
      const { Ocean } = await import('../world/Ocean.js');
      game.ocean = new Ocean(game);
      game.ocean.setSeaState?.(+(p.get('state') ?? 0.3), { dur: 0.01 });
    } catch (e) { console.warn('[whale] ocean unavailable', e); }
  }
  const alt = +(p.get('alt') ?? 26);
  // &skin=<scale> bakes smaller skin textures (headless SwiftShader is slow)
  if (p.has('skin')) BAKE.scale = +p.get('skin');
  const who = p.get('who') || 'mother';
  const all = GENOMES();
  const models = [];
  const add = (genome, pos, yaw = 0) => {
    if (p.has('eyescale')) genome = Object.assign({}, genome, { eyeScale: +p.get('eyescale') });
    const m = new WhaleModel(genome);
    const lod = p.has('lod') ? +p.get('lod') : who === 'lineup' ? 1 : 0;
    if (lod === 0) m.prepare();
    else WhaleModel.flush();
    m.setLOD(lod);
    m.group.position.copy(pos);
    m.group.rotation.set(0, yaw, 0);
    s.add(m.group);
    m.castShadows(game.engine.shadows);
    models.push(m);
    return m;
  };
  let subject;
  const yaw = ((+p.get('yaw') || 0) * Math.PI) / 180;
  if (who === 'lineup') {
    // adults in a 4 x 2 grid, all turned three-quarters toward the camera; calves in front
    const adults = ['alpha', 'mother', 'elder', 'a1', 'a2', 'a3', 'a4', 'a5'];
    adults.forEach((k, i) => {
      const col = i % 4, row = Math.floor(i / 4);
      add(all[k], new Vector3(col * 46 - 69, alt + row * 22, -row * 70), 0.75 + yaw);
    });
    ['calf', 'pip', 'moss', 'ember'].forEach((k, i) => add(all[k], new Vector3(i * 9 - 13, alt - 10, 38), 0.75 + yaw));
    subject = models[1];
  } else if (who === 'life') {
    // the player's life: newborn, young adult, mate, elder self (subject: the young adult)
    add(all.newborn, new Vector3(-20, alt - 4, 26), 0.75 + yaw);
    subject = add(all.young, new Vector3(0, alt, 0), 0.75 + yaw);
    add(all.mate, new Vector3(-26, alt + 6, -24), 0.75 + yaw);
    add(all.elderself, new Vector3(34, alt + 4, -46), 0.75 + yaw);
  } else {
    subject = add(all[who] || MOTHER, new Vector3(0, alt, 0), yaw);
  }
  window.__whales = models;
  // organ states
  const num = (k, d = 0) => (p.has(k) ? +p.get(k) : d);
  for (const m of models) {
    const u = m.u;
    const sing = num('sing'), hum = num('hum'), charge = num('charge');
    u.uThroat.value = num('throat', Math.max(sing * 0.55, hum * 0.4, charge));
    u.uVib.value = Math.max(sing * 0.2, hum * 0.3, charge);
    u.uVent.value = num('vent', Math.max(sing, hum * 0.5, charge));
    u.uFlush.value = num('flush', charge * 0.8 + sing * 0.25);
    u.uBlow.value = num('blow');
    const cr = (p.get('crest') || '').split(',').map(Number);
    u.uCrest.value.set(cr[0] >= 0 && p.has('crest') ? cr[0] : Math.max(0.7, sing, hum * 0.85, charge), cr.length > 1 ? cr[1] : Math.max(sing * 0.8, hum * 0.4, charge), Math.max(sing, charge) * 0.5, 0);
    if (p.has('mouth')) m.bones.jaw.rotation.x = num('mouth') * (m.calf ? 0.5 : 0.38);
    if (p.has('shells')) m.setFurShells(+p.get('shells'));
    if (p.has('locks')) m.setLocks(+p.get('locks'));
    if (p.has('wet')) u.uWetSelf.value = num('wet');
    if (p.has('dbg')) u.uDbg.value = num('dbg'); // body debug: 1 shadow 2 normal 3 albedo 4 ao 5 ink
  }

  // camera views relative to the subject (metres scale with its length)
  const L = subject.L;
  const A = subject.A;
  const P = A.P;
  const sub = subject.group.position;
  const eye = A.spot(P.eye.t, P.eye.m, 1).p;
  const eye2 = A.spot(P.eye2.t, P.eye2.m, 1).p;
  const head = A.surfacePoint(P.eye.t + 0.05, 0);
  const V = {
    side: [[L * 1.15, L * 0.12, L * 0.02], [0, 0, -L * 0.02]],
    q: [[L * 0.75, L * 0.25, L * 0.8], [0, 0, L * 0.05]],
    front: [[L * 0.15, L * 0.05, L * 1.1], [0, 0, L * 0.2]],
    back: [[-L * 0.35, L * 0.32, -L * 1.0], [0, 0, 0]],
    top: [[L * 0.2, L * 1.2, -L * 0.05], [0, 0, 0]],
    under: [[L * 0.55, -L * 0.6, L * 0.35], [0, 0, L * 0.05]],
    face: [[eye.x + L * 0.32, eye.y + L * 0.06, eye.z + L * 0.18], [eye.x, eye.y - L * 0.02, eye.z + L * 0.05]],
    eye: [[eye.x + L * 0.045, eye.y + L * 0.01, eye.z + L * 0.03], [eye.x, eye.y, eye.z]],
    eye2: [[eye2.x + L * 0.05, eye2.y + L * 0.015, eye2.z + L * 0.02], [eye2.x, eye2.y, eye2.z]],
    organs: [[L * 0.22, head.y + L * 0.22, head.z + L * 0.16], [0, head.y, head.z - L * 0.04]],
    crest: [[L * 0.24, head.y + L * 0.1, head.z - L * 0.04], [0, head.y + L * 0.04, head.z - L * 0.07]],
    horn: [[L * 0.3, head.y + L * 0.14, head.z - L * 0.25], [L * 0.05, head.y + L * 0.05, head.z - L * 0.12]],
    throat: [[L * 0.3, -L * 0.3, L * 0.38], [0, -L * 0.08, L * 0.2]],
    wing: [[L * 0.45, L * 0.35, L * 0.05], [L * 0.3, -L * 0.02, -L * 0.05]],
    wingup: [[L * 0.35, -L * 0.25, L * 0.05], [L * 0.3, 0, -L * 0.08]],
    wingL: [[-L * 0.42, L * 0.42, L * 0.12], [-L * 0.32, -L * 0.02, -L * 0.06]],
    wingLup: [[-L * 0.3, -L * 0.3, -L * 0.2], [-L * 0.32, 0, -L * 0.06]],
    fluke: [[L * 0.3, L * 0.22, -L * 0.75], [0, 0, -L * 0.52]],
    plates: [[L * 0.25, L * 0.32, -L * 0.25], [0, L * 0.1, -L * 0.1]],
    mane: [[L * 0.32, L * 0.2, L * 0.25], [0, L * 0.1, L * 0.08]],
    skin: [[L * 0.2, L * 0.02, L * 0.42], [0, 0, L * 0.38]],
    belly: [[L * 0.4, -L * 0.45, -L * 0.1], [0, -L * 0.05, 0]],
    far: [[L * 3.5, L * 1.0, L * 2.0], [0, 0, 0]],
  };
  if (who === 'lineup') {
    // relative to the mother (models[1], at grid x = -23, row 0)
    V.q = [[80, 40, 175], [23, 8, -20]];
    V.row0 = [[60, 12, 105], [23, 0, 0]];
    V.row1 = [[60, 34, 40], [23, 22, -70]];
    V.calves = [[40, -6, 62], [23, -10, 38]];
  }
  const camRel = new Vector3(), lookRel = new Vector3();
  const setView = (name, k = +(p.get('dist') || 1)) => {
    const view = V[name] || V.side;
    camRel.set(...view[0]);
    lookRel.set(...view[1]);
    camRel.sub(lookRel).multiplyScalar(k).add(lookRel);
  };
  setView(p.get('view') || 'side');
  if (p.has('cam')) camRel.set(...p.get('cam').split(',').map(Number));
  if (p.has('look')) lookRel.set(...p.get('look').split(',').map(Number));
  // headless multi-shot tools switch views without reloading
  window.__whaleView = (name, k) => setView(name, k);
  window.__info = () => ({ calls: game.engine.renderer.info.render.calls, tris: game.engine.renderer.info.render.triangles });
  const rot = new Euler(0, subject.group.rotation.y, 0);
  const cam = game.engine.camera;
  if (p.has('fov')) { cam.fov = +p.get('fov'); cam.updateProjectionMatrix(); }
  game.cameraRig.update = () => {
    const c = camRel.clone();
    if (p.has('orbit')) c.sub(lookRel).applyAxisAngle(new Vector3(0, 1, 0), game.time * (+p.get('orbit') * Math.PI / 180)).add(lookRel);
    const cp = c.applyEuler(rot).add(sub);
    const lk = lookRel.clone().applyEuler(rot).add(sub);
    cam.position.copy(cp);
    cam.lookAt(lk);
  };
  // animated inspection: animators drive the static models (hovering), gestures held at a phase
  if (p.has('anim')) {
    const anims = models.map((m, i) => new WhaleAnimator(m, (m.g.seed || 1) + i));
    const vel = new Vector3(0, 0, 0);
    const wind = new Vector3(2, 0, 1);
    const quats = models.map((m) => new Quaternion().copy(m.group.quaternion));
    const state = (i) => ({
      vel: vel.set(0, 0, 4).applyQuaternion(quats[i]), quat: quats[i], angVel: { yaw: 0, pitch: 0, roll: 0 },
      effort: num('effort', 0.6), glide: 0.2, climb: 0, mouth: num('mouth'), feed: num('feed'), hum: num('hum'),
      charge: num('charge'), sing: num('sing'), sleep: 0, fear: 0, happy: num('happy'), excite: 0, tired: 0,
      lookAt: null, worldPos: models[i].group.position, wind, wet: p.has('wet') ? num('wet') : undefined,
    });
    let gname = p.get('gesture');
    let gt = p.has('gt') ? +p.get('gt') : null;
    // headless tools pose every model at a gesture phase without reloading
    window.__pose = (name, phase) => { gname = name; gt = phase; anims.forEach((a) => { a.gest = null; }); };
    // warm up so the springs settle into the pose
    for (let k = 0; k < 60; k++) anims.forEach((a, i) => a.update(1 / 30, state(i), 0));
    let bumpT = 1;
    game.devUpdate = (dt) => {
      anims.forEach((a, i) => {
        if (gname && GESTURES[gname] && (!a.gest || a.gest.name !== gname)) a.gesture(gname, { side: 1 });
        if (gt !== null && a.gest) a.gest.t = gt * a.gest.dur;
        if (p.has('flap')) a.phase = +p.get('flap') * Math.PI * 2;
        a.update(gt !== null || p.has('flap') ? 1 / 60 : dt, state(i), 0);
      });
      if (p.has('bumpdir')) {
        bumpT -= dt;
        if (bumpT <= 0) { bumpT = 3; anims.forEach((a) => a.bump(new Vector3(...p.get('bumpdir').split(',').map(Number)), 1.5)); }
      }
    };
    window.__anims = anims;
  }
  game.focus.copy(sub);
  game.engine.shadows.radius = Math.max(60, L * 3);
  game.devWhales = models;
  window.__G = G;
}

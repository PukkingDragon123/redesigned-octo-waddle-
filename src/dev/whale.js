// Dev scene: static inspection of every whale variant, organ states and close-ups.
// ?debug&test=whale&who=calf|mother|elder|alpha|a1..a5|pip|moss|ember|lineup&view=<view>&time=<preset>
//   views: side | q (three-quarter front) | front | back | top | under | face | eye | eye2 | organs |
//          crest | horn | throat | wing | wingup | fluke | plates | mane | skin | belly | far
//   organ states: &sing=0..1 &hum=0..1 &charge=0..1 &blow=0..1 &mouth=0..1 &throat=0..1
//                 &crest=raise,flare &vent=0..1 &flush=0..1
//   &sea          the real Ocean under the whales (slow headless)    &alt=<m> altitude (default 26)
//   &lod=0|1|2    force a level of detail                             &shells=N fur shells
//   &yaw=<deg>    turn the subject       &cam=x,y,z&look=x,y,z (relative to the subject)   &fov=<deg>
//   &orbit=<deg/s> orbit the camera      &dist=<k> scale the view distance
import { Vector3, Euler } from 'three';
import { WhaleModel, BAKE } from '../creatures/whale/Model.js';
import { CALF, MOTHER, ELDER, ADULTS, CALVES } from '../creatures/WhaleTypes.js';
import { G } from '../render/Globals.js';

const GENOMES = () => ({
  calf: CALF, mother: MOTHER, elder: ELDER, alpha: ADULTS[0],
  a1: ADULTS[1], a2: ADULTS[2], a3: ADULTS[3], a4: ADULTS[4], a5: ADULTS[5],
  pip: CALVES[0], moss: CALVES[1], ember: CALVES[2],
});

export default async function (game) {
  const p = game.params;
  const s = game.engine.scene;
  if (!p.get('time')) game.atmosphere.set('morning');
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
    m.prepare();
    m.setLOD(p.has('lod') ? +p.get('lod') : 0);
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
    const order = ['calf', 'pip', 'moss', 'ember', 'mother', 'a1', 'a2', 'a3', 'a4', 'a5', 'alpha', 'elder'];
    let x = 0;
    for (const k of order) {
      const g = all[k];
      const m = add(g, new Vector3(0, alt, 0), Math.PI / 2 + yaw);
      x += g.length * 0.7;
      m.group.position.set(0, alt, -x);
      x += g.length * 0.7;
    }
    subject = models[4];
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
    fluke: [[L * 0.3, L * 0.22, -L * 0.75], [0, 0, -L * 0.52]],
    plates: [[L * 0.25, L * 0.32, -L * 0.25], [0, L * 0.1, -L * 0.1]],
    mane: [[L * 0.32, L * 0.2, L * 0.25], [0, L * 0.1, L * 0.08]],
    skin: [[L * 0.2, L * 0.02, L * 0.42], [0, 0, L * 0.38]],
    belly: [[L * 0.4, -L * 0.45, -L * 0.1], [0, -L * 0.05, 0]],
    far: [[L * 3.5, L * 1.0, L * 2.0], [0, 0, 0]],
  };
  if (who === 'lineup') {
    V.side = [[150, 14, -150], [0, 0, -150]];
    V.q = [[110, 40, -40], [0, 0, -160]];
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
  game.focus.copy(sub);
  game.engine.shadows.radius = Math.max(60, L * 3);
  game.devWhales = models;
  window.__G = G;
}

// Dev scene: the flying bugs of Vur Sok (lumen moths, spiral gnats, skitterflies) and the calf's moves.
// ?debug&test=bugs                          the calf flies an autopilot loop through swarms of all three
//   &species=moth|gnat|skitter|all          which swarms (default all)      &ring  a race ring of moths
//   &move=slap|spout|loop|dash|dive|breach|roll|bubbles|none   repeat one move every few seconds
//   &cam=follow|side|swarm|wide             camera (default follow; swarm: close on the first swarm)
//   &time=<preset> (night shows the moths' glow)   &state=<0..1> sea state   &play  steer it yourself
// window.__bugs() -> stats (CPU ms, bugs drawn, caught, moves done).
import { Vector3 } from 'three';
import { Whale } from '../creatures/Whale.js';
import { BAKE } from '../creatures/WhaleModel.js';
import { CALF } from '../creatures/WhaleTypes.js';
import { PlayerController } from '../game/PlayerController.js';
import { waterStep, seaHeight } from '../game/Swim.js';
import { SkyBugs } from '../creatures/bugs/SkyBugs.js';
import { clamp, damp } from '../core/math.js';

export default async function (game) {
  const p = game.params;
  if (p.has('skin')) BAKE.scale = +p.get('skin');
  if (!p.get('time')) game.atmosphere.set('morning');
  if (game.cloudSea) game.cloudSea.enabled = false;
  try {
    const { Ocean } = await import('../world/Ocean.js');
    if (!game.ocean) game.ocean = new Ocean(game);
    game.ocean.setSeaState?.(+(p.get('state') ?? 0.3), { dur: 0.01 });
  } catch (e) { console.warn('[bugs] ocean unavailable', e); }
  Whale.game = game;

  const calf = new Whale(CALF);
  calf.place(new Vector3(0, 14, 40), Math.PI);
  calf.model.prepare?.();
  game.engine.scene.add(calf.group);
  if (calf.model.castShadows) calf.model.castShadows(game.engine.shadows);
  const player = new PlayerController(game, calf);
  player.enabled = p.has('play');
  if (p.has('play')) game.input.setGameplayMode(true);
  const moves = player.moves;
  const log = [];
  moves.on((e) => { log.push(`${game.time.toFixed(1)} ${e.name} ${e.zone} p=${e.power.toFixed(2)}`); if (log.length > 200) log.shift(); });

  // the swarms
  const bugs = new SkyBugs(game);
  const caught = { moth: 0, gnat: 0, skitter: 0 };
  bugs.onCatch = (kind, x, y, z) => {
    caught[kind]++;
    for (let i = 0; i < 6; i++) game.glow.emit({ pos: new Vector3(x, y, z), vel: new Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3), life: 0.7, size: 0.3, sizeEnd: 0.05, kind: 2, color: [1.5, 1.3, 0.8], drag: 2 });
  };
  const sp = p.get('species') || 'all';
  const sea = (x, z) => seaHeight(game, x, z);
  const centers = [];
  const add = (kind, c, o) => { const S = bugs.spawn(kind, c, o); if (S) centers.push(S.center); return S; };
  if (sp === 'all' || sp === 'moth') {
    add('moth', new Vector3(0, 13, -10), { count: 28, radius: 8 });
    add('moth', new Vector3(-40, 18, -70), { count: 24, radius: 9 });
  }
  if (sp === 'all' || sp === 'gnat') {
    add('gnat', new Vector3(25, 12, -40), { count: 90, radius: 4.5 });
    add('gnat', new Vector3(-20, 16, 20), { count: 70, radius: 4 });
  }
  if (sp === 'all' || sp === 'skitter') {
    add('skitter', new Vector3(10, sea(10, -100), -100), { count: 36, radius: 7, dir: new Vector3(1, 0, 0.3), drift: 1.5, seaY: sea(10, -100) });
    add('skitter', new Vector3(-30, sea(-30, 60), 60), { count: 30, radius: 6, dir: new Vector3(-0.4, 0, 1), drift: 1.2, seaY: sea(-30, 60) });
  }
  if (p.has('ring')) add('moth', new Vector3(0, 14, -25), { shape: 'ring', count: 20, ringR: 5.5, normal: new Vector3(0, 0, -1), tag: 'race' });

  // autopilot: weave through the swarms (or a scripted move)
  const move = p.get('move') || 'none';
  let target = 0, moveT = 0, phase = 0;
  const tgt = new Vector3();
  if (!p.has('play')) {
    player.autopilot = (dt) => {
      if (!centers.length) return { swim: 0.6 };
      if (move === 'breach') {
        // down under the sea, then race up through it
        moveT += dt;
        const s = sea(calf.pos.x, calf.pos.z);
        if (phase === 0) { tgt.copy(calf.pos).addScaledVector(calf.fwd, 10); tgt.y = s - 8; if (calf.pos.y < s - 6) { phase = 1; moveT = 0; } }
        else if (phase === 1) { tgt.copy(calf.pos).addScaledVector(calf.fwd, 3); tgt.y = calf.pos.y + 30; if (moveT > 4) { phase = 2; moveT = 0; } }
        else { tgt.copy(calf.pos).addScaledVector(calf.fwd, 20); tgt.y = 14; if (moveT > 5) { phase = 0; moveT = 0; } }
        const to = tgt.clone().sub(calf.pos), d = to.length();
        return { swim: 1, yaw: Math.atan2(to.x, to.z), pitch: Math.asin(clamp(to.y / Math.max(d, 1), -1, 1)) * 1.1, surge: phase === 1 };
      }
      const c = centers[target % centers.length];
      tgt.copy(c);
      if (move === 'dive' && moveT > 4) tgt.y = sea(c.x, c.z) - 3;
      const to = tgt.clone().sub(calf.pos), d = to.length();
      if (d < 3) target++;
      return { swim: 1, yaw: Math.atan2(to.x, to.z), pitch: Math.asin(clamp(to.y / Math.max(d, 1), -1, 1)) * 0.9 };
    };
  }

  const cam = game.engine.camera;
  const camMode = p.get('cam') || 'follow';
  const cp = new Vector3(), cl = new Vector3(), want = new Vector3(), wantL = new Vector3();
  let camInit = false;
  if (camMode !== 'follow') {
    game.cameraRig.update = (dt) => {
      if (camMode === 'swarm') {
        wantL.copy(centers[0] || calf.pos);
        want.copy(wantL).add(new Vector3(9, 3, 12));
      } else if (camMode === 'wide') {
        wantL.copy(calf.pos);
        want.copy(calf.pos).add(new Vector3(40, 25, 40));
      } else {
        wantL.copy(calf.pos);
        want.copy(calf.pos).addScaledVector(calf.right, 14).add(new Vector3(0, 3, 0));
      }
      if (!camInit) { cp.copy(want); cl.copy(wantL); camInit = true; }
      cp.lerp(want, 1 - Math.exp(-dt * 2.5));
      cl.lerp(wantL, 1 - Math.exp(-dt * 4));
      cam.position.copy(cp);
      cam.lookAt(cl);
    };
  }

  const eater = { mouth: new Vector3(), fwd: new Vector3(), body: new Vector3(), speed: 0, open: 0 };
  let moveClock = 0;
  game.devUpdate = (dt) => {
    if (game.frame === 0) { game.mist.update(dt); game.glow.update(dt); }
    // slow motion eases like the story's
    game.timeScale = damp(game.timeScale ?? 1, game.timeScaleTarget ?? 1, 4, game.dtReal ?? dt);
    // a scripted move every few seconds
    moveClock += dt;
    if (move !== 'none' && move !== 'breach' && moveClock > 3.5) {
      moveClock = 0;
      const s = sea(calf.pos.x, calf.pos.z);
      if (move === 'slap') moves.slap(s);
      else if (move === 'spout' || move === 'bubbles') moves.spout(s);
      else if (move === 'loop') moves.loop();
      else if (move === 'dash') moves.dash(s);
      else if (move === 'roll') { calf.barrelRoll(1); moves.queueRoll(1); setTimeout(() => moves.queueRoll(1), 500); }
      else if (move === 'dive') { calf.pitch = -0.8; moves.dash(s); }
    }
    player.update(dt);
    calf.step(dt);
    waterStep(calf, dt, game, { player: true });
    eater.fwd.copy(calf.fwd);
    eater.body.copy(calf.pos);
    eater.speed = calf.vel.length();
    eater.mouth.copy(calf.pos).addScaledVector(calf.fwd, calf.L * 0.5);
    eater.open = calf.anim.mouth ?? 0;
    bugs.update(dt, eater);
    calf.drive.mouth = damp(calf.drive.mouth, bugs.mouthWant, 6, dt);
    calf.drive.happy = damp(calf.drive.happy, 0.3, 0.3, dt);
    calf.animate(dt, cam.position);
    if (camMode === 'follow') game.cameraRig.follow(dt, calf, player.aimYaw, player.aimPitch, { surfaceY: sea(cam.position.x, cam.position.z) });
    game.focus.copy(calf.pos);
  };
  window.__bugs = () => ({
    t: +game.time.toFixed(1), ms: +bugs.stats.ms.toFixed(3), msAvg: +bugs.stats.msAvg.toFixed(3), drawn: bugs.stats.drawn, sim: bugs.stats.sim,
    caught, moves: Object.assign({}, moves.count), zone: moves.zone, depth: +moves.depth.toFixed(1),
    calf: calf.pos.toArray().map((v) => +v.toFixed(1)), speed: +calf.vel.length().toFixed(1), mouth: +(calf.anim.mouth ?? 0).toFixed(2),
    log: log.slice(-8),
  });
  window.__bugsSys = bugs;
  window.__calf = calf;
}

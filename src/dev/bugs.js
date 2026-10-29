// Dev scene: the flying bugs of Vur Sok (lumen moths, spiral gnats, skitterflies) and the calf's moves.
// ?debug&test=bugs                          the calf flies an autopilot loop through swarms of all three
//   &species=moth|gnat|skitter|all          which swarms (default all)      &ring  a race ring of moths
//   &move=slap|spout|loop|dash|dive|breach|roll|bubbles|none   repeat one move every few seconds
//   &cam=follow|side|swarm|wide|macro       camera (default follow; swarm: close on the first swarm;
//                                           macro: a lens on one bug, &bug=N &dist=k)
//   &time=<preset> (night shows the moths' glow)   &state=<0..1> sea state   &play  steer it yourself
//   &eat [&slow=0.35]   the calf eats moths up close in slow motion (camera on its face): anticipation,
//                       suction, the snap, the gulp, the contented afterglow (see Activities.js)
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
    for (let i = 0; i < 6; i++) game.glow.emit({ pos: new Vector3(x, y, z), vel: new Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3), life: 0.7, size: 0.3, sizeEnd: 0.05, kind: 1, color: [1.5, 1.3, 0.8], drag: 2 });
  };
  const eat = p.has('eat');
  const sp = eat ? 'none' : (p.get('species') || 'all');
  if (eat) {
    // a compact cloud of moths just ahead, a little shy (they still flutter off the calf's flank)
    bugs.kinds.moth.def.fleeR = 3.2;
    bugs.slow = 1;
    game.timeScaleTarget = +(p.get('slow') || 0.35);
  }
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
  if (eat) {
    add('moth', new Vector3(0, 14.5, 18), { count: 14, radius: 2.6 });
    add('moth', new Vector3(1, 14, -6), { count: 16, radius: 3 });
    add('moth', new Vector3(-1, 14.5, -30), { count: 16, radius: 3 });
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
      if (eat) {
        // a slow, deliberate pass through each cloud
        const to = tgt.clone().sub(calf.pos), d = to.length();
        if (d < 2 || to.dot(calf.fwd) < -1) target++;
        return { swim: 0.35, yaw: Math.atan2(to.x, to.z), pitch: Math.asin(clamp(to.y / Math.max(d, 1), -1, 1)) * 0.6 };
      }
      if (move === 'slap' || move === 'spout') tgt.y = sea(c.x, c.z) + 0.2; // skim the surface
      if (move === 'bubbles') tgt.y = sea(c.x, c.z) - 4;
      const to = tgt.clone().sub(calf.pos), d = to.length();
      if (d < 3) target++;
      return { swim: 1, yaw: Math.atan2(to.x, to.z), pitch: Math.asin(clamp(to.y / Math.max(d, 1), -1, 1)) * 0.9 };
    };
  }

  const cam = game.engine.camera;
  const camMode = p.get('cam') || (eat ? 'face' : 'follow');
  const cp = new Vector3(), cl = new Vector3(), want = new Vector3(), wantL = new Vector3(), _off = new Vector3();
  let camInit = false;
  if (camMode !== 'follow') {
    game.cameraRig.update = (dt) => {
      if (camMode === 'swarm') {
        wantL.copy(centers[0] || calf.pos);
        want.copy(wantL).add(_off.set(5, 1.5, 7));
      } else if (camMode === 'macro') {
        // a macro lens on one bug of the first swarm (&cam=macro&bug=N)
        const S = bugs.swarms.find((q) => q.active) || null;
        const i = S ? S.first + (+(p.get('bug') || 0) % Math.max(1, S.count)) : -1;
        if (S) wantL.set(S.K.pos[i * 3], S.K.pos[i * 3 + 1], S.K.pos[i * 3 + 2]); else wantL.copy(calf.pos);
        want.copy(wantL).add(_off.set(1.0, 0.35, 0.8).multiplyScalar(+(p.get('dist') || 1)));
        camInit = false;
      } else if (camMode === 'face') {
        // close on the calf's face from the side and a little ahead: the mouth, eyes and throat
        wantL.copy(calf.pos).addScaledVector(calf.fwd, calf.L * 0.32);
        want.copy(calf.pos).addScaledVector(calf.fwd, calf.L * 0.75).addScaledVector(calf.right, calf.L * 0.95).addScaledVector(calf.up, calf.L * 0.12);
        camInit = camInit && cp.distanceTo(want) < 30;
      } else if (camMode === 'wide') {
        wantL.copy(calf.pos);
        want.copy(calf.pos).add(_off.set(40, 25, 40));
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
  // the eating sequence, as Activities runs it in the game (snap on arrival, gulp a beat later)
  let morsel = 0, biteT = -9, motes = 0, moteT = 0;
  const corner = new Vector3();
  const prevCatch = bugs.onCatch;
  bugs.onCatch = (kind, x, y, z, S) => {
    calf.anim.snap(kind === 'gnat' ? 0.45 : 1);
    morsel += kind === 'gnat' ? 0.12 : 0.4;
    biteT = game.time;
    calf.drive.happy = Math.max(calf.drive.happy, 0.85);
    if (eat) caught[kind]++; else prevCatch(kind, x, y, z, S);
  };
  const eatStep = (dt) => {
    const reach = bugs.reach;
    if (bugs.mouthWant > 0) {
      calf.drive.mouth = Math.max(calf.drive.mouth, 0.7 + 0.3 * reach);
      calf.drive.feed = Math.max(calf.drive.feed, 0.3 + 0.2 * reach);
      calf.anim.focus(bugs.focus, bugs.focusW, reach);
    } else calf.drive.feed = damp(calf.drive.feed, 0, 4, dt);
    if (morsel > 0 && game.time - biteT > 0.16) { calf.anim.gulp(Math.min(1.3, 0.45 + morsel)); motes += 3; moteT = 0.25; morsel = 0; }
    if (motes > 0 && (moteT -= dt) <= 0) {
      moteT = 0.11; motes--;
      const side = motes % 2 ? 1 : -1;
      corner.copy(calf.pos).addScaledVector(calf.fwd, calf.L * 0.44).addScaledVector(calf.right, side * calf.L * 0.07).addScaledVector(calf.up, -calf.L * 0.025);
      game.glow.emit({ pos: corner, vel: calf.vel.clone().multiplyScalar(0.85).addScaledVector(calf.right, side).addScaledVector(calf.up, 0.5), life: 1.1, size: 0.13, sizeEnd: 0.03, kind: 1, color: [1.5, 1.2, 0.7], drag: 1.8, gravity: -0.25, fadeIn: 0.05 });
    }
  };
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
    eatStep(dt);
    calf.drive.happy = damp(calf.drive.happy, 0.3, 0.3, dt);
    calf.animate(dt, cam.position);
    if (camMode === 'follow') game.cameraRig.follow(dt, calf, player.aimYaw, player.aimPitch, { surfaceY: sea(cam.position.x, cam.position.z) });
    game.focus.copy(calf.pos);
  };
  window.__bugs = () => ({
    t: +game.time.toFixed(1), ms: +bugs.stats.ms.toFixed(3), msAvg: +bugs.stats.msAvg.toFixed(3), drawn: bugs.stats.drawn, sim: bugs.stats.sim,
    caught, moves: Object.assign({}, moves.count), zone: moves.zone, depth: +moves.depth.toFixed(1),
    calf: calf.pos.toArray().map((v) => +v.toFixed(1)), speed: +calf.vel.length().toFixed(1), mouth: +(calf.anim.mouth ?? 0).toFixed(2),
    jaw: +(calf.anim.jawAngle ?? 0).toFixed(3), bolus: +(calf.anim.bolusP ?? 0).toFixed(2), reach: +bugs.reach.toFixed(2), focusW: +calf.anim.focusW.toFixed(2), sucking: bugs.sucking,
    log: log.slice(-8),
  });
  window.__bugsSys = bugs;
  window.__calf = calf;
}

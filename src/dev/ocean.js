// Dev scene: the ocean of Vur Sok (world/Ocean.js), its sky, clouds and underwater mode.
// ?debug&test=ocean&state=0..1&time=<preset>&cam=<view>
//   views: high | skim | under | look | window | deep | horizon | sun | shallow | whale | storm |
//          stormlow | calm | moons | galaxy | tiles | top | sky | wake | splash | trail
//   &splash          a splash every 2.5 s        &wake      a mover circling at the surface (wake)
//   &clouds          cumulus at 380-800 m        &fog       a sea-fog bank and wisps on the water
//   &nowhale         hide the test whale         &yaw=<deg> turn the camera   &orbit  slow circle
//   &lookdir=x,y,z   look along a direction      &bob=<s>   camera rises and sinks through the surface
//   &odebug=1..7     ocean debug views (1 foam, 2 Jacobian, 3 normal, 4 roughness, 5 height, 6 foam mask, 7 sim)
//   &set=uName:x,y,z pin an ocean uniform        &quality=low|medium|high
//   &game            the real story on this ocean (with &chapter=N&auto&dt=0.05&warp=20)
// Test objects: two coiled rock columns standing in deep water, a sandy shelf (shallows, caustics,
// shore foam) and a whale model floating half-submerged.
import {
  Vector3, Mesh, CylinderGeometry, CircleGeometry, Color, Float32BufferAttribute,
} from 'three';
import { Ocean } from '../world/Ocean.js';
import { toonMaterial } from '../render/materials.js';
import { WhaleModel } from '../creatures/WhaleModel.js';
import { MOTHER } from '../creatures/WhaleTypes.js';
import { G } from '../render/Globals.js';
import { rng } from '../core/math.js';

function rockColumn(seed, radius, height, depth) {
  const r = rng(seed);
  const geo = new CylinderGeometry(radius * 0.55, radius, height + depth, 48, 40, false);
  geo.translate(0, (height + depth) * 0.5 - depth, 0);
  const pos = geo.attributes.position;
  const col = [];
  const tint = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    // a coiled ridge wraps the column: the planet's spiral
    const coil = Math.sin(a * 2 - y * 0.18) * 0.18 + Math.sin(a * 5 + y * 0.4 + seed) * 0.05;
    const k = 1 + coil + (r() - 0.5) * 0.04;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
    const wet = y < 1.2 ? 0.55 : 1;
    tint.setRGB(0.42, 0.36, 0.3).multiplyScalar(wet * (0.85 + coil));
    if (y < -0.5) tint.setRGB(0.35, 0.38, 0.32);
    col.push(tint.r, tint.g, tint.b);
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new Mesh(geo, toonMaterial({ color: 0xffffff, vertexColors: true, rim: 0.2, paint: 1 }));
}

function shelf(radius, depthIn, depthOut) {
  // a sandy shelf around the rock: shallow at the centre, falling away to the deep
  const geo = new CircleGeometry(radius, 96, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const d = Math.hypot(x, z) / radius;
    const ripple = Math.sin(x * 0.7 + Math.sin(z * 0.3) * 2) * 0.15;
    const y = -(depthIn + (depthOut - depthIn) * Math.pow(d, 1.6)) + ripple;
    pos.setY(i, y);
    const s = 0.75 + 0.25 * Math.sin(x * 0.11 + z * 0.07);
    col.push(0.86 * s, 0.78 * s, 0.6 * s);
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new Mesh(geo, toonMaterial({ color: 0xffffff, vertexColors: true, rim: 0.1, paint: 1 }));
}

export default async function (game) {
  const p = game.params;
  const s = game.engine.scene;
  if (game.cloudSea) game.cloudSea.enabled = false;
  const ocean = game.ocean && game.ocean instanceof Ocean ? game.ocean : new Ocean(game);
  game.ocean = ocean;
  window.__ocean = ocean;
  window.__G = G;

  // &game: the real story on the real ocean (integration check before Game.js swaps it in):
  // ?debug&test=ocean&game&chapter=2&auto&dt=0.05&warp=20
  if (p.has('game')) {
    const { Story } = await import('../game/Story.js');
    game.story = new Story(game);
    await game.story.init();
    return;
  }
  if (p.has('state')) ocean.setSeaState(+p.get('state'), { dur: 0.01 });
  if (p.has('odebug')) ocean.uniforms.uDebug.value = +p.get('odebug');
  // the painted look is on by default (engine.painterly); &painterly=0 shows the plain frame,
  // &look=title|gameplay|cinematic picks the engine look
  if (game.engine.painterly) {
    game.painterly = game.engine.painterly;
    if (p.get('painterly') === '0') game.engine.painterly.enabled = false;
    if (p.get('look')) game.engine.setLook(p.get('look'), { ease: 0 });
  }
  // &set=uniform:x,y,z  pins an ocean uniform for experiments
  const pins = (p.get('set') || '').split(';').filter(Boolean).map((e) => e.split(':'));
  game.addSystem({ update() {
    for (const [k, v] of pins) {
      const u = ocean.uniforms[k];
      if (!u) continue;
      const a = v.split(',').map(Number);
      if (typeof u.value === 'number') u.value = a[0];
      else u.value.fromArray(a);
    }
  } });
  if (!p.has('time')) game.atmosphere.set('noon');

  // test objects
  const rock = rockColumn(3, 9, 34, 40);
  rock.position.set(26, 0, -70);
  s.add(rock);
  game.engine.shadows.addCaster(rock);
  const rock2 = rockColumn(8, 5, 18, 40);
  rock2.position.set(-60, 0, -130);
  s.add(rock2);
  game.engine.shadows.addCaster(rock2);
  const sand = shelf(70, 1.5, 34);
  sand.position.set(26, 0, -70);
  s.add(sand);

  let whale = null;
  if (!p.has('nowhale')) {
    whale = new WhaleModel(MOTHER);
    whale.group.position.set(-8, -0.8, -42);
    whale.group.rotation.y = 0.9;
    s.add(whale.group);
    whale.castShadows(game.engine.shadows);
  }

  if (p.has('clouds')) {
    const r = rng(9);
    for (let i = 0; i < 26; i++) {
      const c = new Vector3((r() - 0.5) * 5000, 380 + r() * 420, -r() * 5000 + 600);
      game.clouds.cumulus(c, 260 + r() * 380, 140 + r() * 260, { seed: 40 + i, sparse: true });
    }
  }
  if (p.has('fog')) {
    game.clouds.sheet(new Vector3(-200, 18, -500), 900, 500, 30, { seed: 5, minR: 26, maxR: 60, opacity: 0.55 });
    game.clouds.wisps(new Vector3(120, 8, -260), 160, 30, { seed: 6, minR: 10, maxR: 24, opacity: 0.35, moisture: 0 });
  }

  const views = {
    high: [[0, 70, 60], [0, 0, -160]],
    skim: [[0, 2.4, 18], [0, 1.0, -40]],
    under: [[-2, -5, 4], [10, -6, -40]],
    look: [[0, -6, -10], [5, 0, -20]],
    window: [[0, -8, -20], [0.5, 0, -20.3]],
    deep: [[-4, -12, -12], [10, -4, -50]],
    horizon: [[0, 28, 0], [0, 22, -600]],
    sun: [[0, 20, 0], null],
    shallow: [[36, 16, -30], [26, -4, -70]],
    whale: [[6, 5, -22], [-8, -0.5, -42]],
    storm: [[0, 32, 40], [0, 6, -200]],
    stormlow: [[0, 9, 40], [0, 6, -200]],
    calm: [[0, 14, 30], [0, 4, -400]],
    moons: [[0, 12, 0], [-1000, 520, -700]],
    tiles: [[0, 320, 300], [0, 0, -900]],
    top: [[0, 600, 0.01], [0, 0, 0]],
    galaxy: [[0, 12, 0], [-520, 500, -690]],
    sky: [[0, 60, 200], [0, 330, -1500]],
    wake: [[0, 26, 10], [0, 0, -40]],
    splash: [[0, 7, -6], [4, 0, -30]],
    trail: [[22, 9, -8], [24, 0, -40]],
    mirror: [[26, 10, 6], [26, 3, -70]],
  };
  const name = p.get('cam') || 'high';
  const v = views[name] || views.high;
  // &lookdir=x,y,z: from the chosen position, look along a direction
  if (p.has('lookdir')) {
    const d = p.get('lookdir').split(',').map(Number);
    v[1] = [v[0][0] + d[0] * 100, v[0][1] + d[1] * 100, v[0][2] + d[2] * 100];
  }
  const cam = game.engine.camera;
  const pos = new Vector3(...v[0]);
  const look = v[1] ? new Vector3(...v[1]) : null;
  const yaw = ((+p.get('yaw') || 0) * Math.PI) / 180;
  game.cameraRig.update = (dt) => {
    let cp = pos, lk = look;
    if (name === 'sun') {
      const sd = G.uSunDir.value;
      lk = pos.clone().add(new Vector3(sd.x, Math.min(sd.y, 0.05) - 0.12, sd.z).normalize().multiplyScalar(100));
    }
    if (p.has('orbit')) {
      const a = game.time * 0.05;
      cp = pos.clone().applyAxisAngle(new Vector3(0, 1, 0), a);
    }
    // &bob=<period s>: the camera rises and sinks through the surface (waterline, wet lens)
    if (p.has('bob')) {
      const per = +p.get('bob') || 6;
      cp = cp.clone();
      cp.y = Math.sin((game.time / per) * Math.PI * 2) * 2.2;
    }
    cam.position.copy(cp);
    const dir = lk.clone().sub(cp).applyAxisAngle(new Vector3(0, 1, 0), yaw);
    cam.lookAt(cp.clone().add(dir));
  };
  game.focus.set(0, 0, -40);
  game.engine.shadows.radius = 140;

  // splash and wake tests
  let tSplash = 0.2;
  const mover = new Vector3();
  const mvel = new Vector3();
  game.devUpdate = (dt) => {
    if (p.has('splash')) {
      tSplash -= dt;
      if (tSplash <= 0) {
        tSplash = 2.5;
        ocean.splash(new Vector3(4, 0, -30), 1.6, 4);
      }
    }
    if (p.has('wake')) {
      const a = game.time * 0.35;
      mover.set(Math.cos(a) * 30, -0.5, -40 + Math.sin(a) * 30);
      mvel.set(-Math.sin(a) * 10.5, 0, Math.cos(a) * 10.5);
      ocean.wake(mover, mvel, 3);
    }
    if (whale) {
      const h = ocean.heightAt(-8, -42);
      whale.group.position.y = h - 0.8;
    }
  };
  game.devOcean = ocean;
  window.__ocean = ocean;
}

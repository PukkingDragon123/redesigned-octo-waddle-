// Dev scene: the alien flora of Vur Sok on a showcase island (meadow plateau, a north cliff, a
// south beach falling into a reef shelf, a lush oasis corner and a young volcanic corner).
//   ?debug&test=flora&shot=<name>   wide | flyover | meadow | fiddle | tubes | bells | anemone | kelp |
//                                    fan | puff | moss | shore | reef | cliff | oasis | volcanic | whale |
//                                    top | far
//   &time=<Atmosphere preset>       default morning (dawn, golden, night, storm ...)
//   &wind=<m/s>                     wind strength (kelp streams, everything bends)
//   &whale[&whaleT=0..2]            a whale stand-in sweeps low over the meadow and the shore; plants
//                                   lean away, anemones / tubes / bells / croziers recoil, puffballs puff
//   &q=0..1                         flora quality      &density=<x>  global density multiplier
//   &lodscale=<x>                   scale every LOD distance (0.12 shows the far painted cards up close)
//   &cam=x,y,z&look=x,y,z  &orbit  &noflora  &stats (logs costs after 3 s)
//   &lab=<species>&n=5&gap=3&scale=1&pal=0&yaw=0&dist=..&camh=..&looky=..  a row of one species on a
//                                   flat pad in frozen poses 0..1 (curl / closed / startle); &live animates
import {
  Vector3, Mesh, PlaneGeometry, ShaderMaterial, SphereGeometry, Float32BufferAttribute,
} from 'three';
import { AlienFlora } from '../flora/AlienFlora.js';
import { placeholderSea } from '../world/Water.js';
import { G } from '../render/Globals.js';
import { UNIFORMS, NOISE, SHADOW, LIGHTING } from '../render/shaders/common.js';
import { getNoiseTexture } from '../render/NoiseTex.js';
import { Noise } from '../core/noise.js';
import { smoothstep, lerp, clamp } from '../core/math.js';

const noise = new Noise(311);
const CX = 0, CZ = -40;
let LAB = false; // lab mode flattens a pad around (0, -40)

/** Island height (m): plateau, gentle south beach into a reef shelf, a steep north cliff. */
export function height(x, z) {
  const dx = x - CX, dz = z - CZ;
  const r = Math.hypot(dx, dz);
  const th = Math.atan2(dz, dx);
  const north = smoothstep(0.1, 0.85, -dz / Math.max(r, 1));
  const R = 64 + 7 * noise.noise2(Math.cos(th) * 1.3 + 4, Math.sin(th) * 1.3) + 4 * noise.noise2(Math.cos(th) * 3, Math.sin(th) * 3 + 9);
  const u = r / R;
  const Hp = 12 + 3.5 * noise.fbm2(x * 0.025 + 3, z * 0.025, 3) + 2.5 * smoothstep(0.5, 0.0, u);
  // south: plateau rolling down to a beach that slides gently under the sea onto a reef shelf
  const south = Hp * Math.pow(1 - smoothstep(0.28, 1.0, u), 1.35) + 3.2 * (1 - u)
    - 6 * smoothstep(1.1, 1.6, u) - 14 * smoothstep(1.55, 2.1, u);
  // north: the plateau ends in a cliff with a narrow ledge, dropping into deep water
  const cliff = Hp * (1 - smoothstep(0.8, 0.9, u)) + 1.4 * (1 - smoothstep(0.88, 0.98, u)) - 22 * smoothstep(0.9, 1.15, u);
  let h = lerp(south, cliff, north);
  // small undulations and hummocks on land
  h += 0.6 * noise.noise2(x * 0.09, z * 0.09) * smoothstep(-1, 3, h);
  if (LAB) h = lerp(h, 14, smoothstep(34, 22, Math.hypot(x, z + 40)));
  return Math.max(h, -26);
}

const _n = new Vector3();
function normalAt(x, z, out = _n) {
  const e = 0.6;
  const hx = height(x + e, z) - height(x - e, z);
  const hz = height(x, z + e) - height(x, z - e);
  return out.set(-hx, 2 * e, -hz).normalize();
}

function sample(x, z) {
  const y = height(x, z);
  if (y < -18) return null;
  const n = normalAt(x, z, new Vector3());
  const wet = clamp(0.5 + 0.5 * noise.noise2(x * 0.03 + 11, z * 0.03 - 4) + smoothstep(4, 0, y) * 0.3, 0, 1);
  const tidal = smoothstep(-2.2, -0.6, y) * (1 - smoothstep(0.6, 1.5, y));
  return { y, normal: n, slope: 1 - n.y, wet, tidal };
}

const GROUND_VERT = /* glsl */ `
${UNIFORMS}
varying vec3 vP;
varying vec3 vN;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const GROUND_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
uniform sampler2D uNoise;
varying vec3 vP;
varying vec3 vN;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vN);
  vec3 P = vP;
  float slope = 1.0 - N.y;
  float n1 = texture2D(uNoise, P.xz / 70.0).r;
  float n2 = texture2D(uNoise, P.xz / 11.0 + 0.3).g;
  float n3 = texture2D(uNoise, P.xz / 1.9).b;
  float n4 = texture2D(uNoise, P.xz / 23.0 + 0.7).a;
  // muted painted meadow: olive and sage with warm dry patches and cool teal hollows
  vec3 grass = mix(vec3(0.05, 0.075, 0.032), vec3(0.12, 0.15, 0.06), smoothstep(0.3, 0.75, n1));
  grass = mix(grass, vec3(0.04, 0.085, 0.07), smoothstep(0.55, 0.8, n4) * 0.5);
  grass = mix(grass, vec3(0.15, 0.14, 0.075), smoothstep(0.6, 0.95, n2 * 0.6 + n1 * 0.4) * 0.3);
  grass *= 0.84 + 0.3 * n3;
  vec3 rock = vec3(0.26, 0.23, 0.2) * (0.7 + 0.45 * n2) * (0.9 + 0.2 * n3);
  rock = mix(rock, rock * vec3(0.85, 0.95, 1.1), smoothstep(0.4, 0.7, n4) * 0.5);
  vec3 sand = vec3(0.56, 0.49, 0.37) * (0.9 + 0.14 * n3) * (0.92 + 0.12 * n1);
  float rockW = smoothstep(0.38, 0.62, slope + (n2 - 0.5) * 0.25);
  float sandW = smoothstep(2.4, 1.0, P.y + (n1 - 0.5) * 1.6);
  vec3 alb = mix(grass, sand, sandW);
  // volcanic corner (west): black sand and basalt
  float volc = smoothstep(26.0, 14.0, length(P.xz - vec2(-46.0, -42.0)) + (n2 - 0.5) * 8.0);
  alb = mix(alb, vec3(0.05, 0.05, 0.055) * (0.8 + 0.4 * n3), volc * 0.9);
  alb = mix(alb, rock, rockW);
  // the wet dark band at the waterline, green film below it
  float wet = smoothstep(1.0, 0.1, P.y);
  alb *= mix(1.0, 0.6, wet);
  alb = mix(alb, vec3(0.08, 0.12, 0.07), smoothstep(-0.4, -2.0, P.y) * 0.4);
  Surface s = makeSurface(alb, N, P);
  s.shadow = sampleShadow(P, N);
  s.wrap = 0.24;
  s.rim = 0.12;
  s.ao = mix(0.8, 1.0, smoothstep(0.0, 0.5, N.y));
  s.spec = wet * 0.4 * smoothstep(-0.3, 0.3, P.y);
  s.gloss = 0.7;
  vec3 col = stylizedLight(s);
  col = applyFog(col, P);
  gl_FragColor = vec4(col, 1.0);
}
`;

function buildGround() {
  const size = 240, seg = 180;
  const geo = new PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate(CX, 0, CZ + 10);
  const pos = geo.attributes.position;
  const nor = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, height(x, z));
    const n = normalAt(x, z);
    nor[i * 3] = n.x; nor[i * 3 + 1] = n.y; nor[i * 3 + 2] = n.z;
  }
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geo.computeBoundingSphere();
  const mat = new ShaderMaterial({
    vertexShader: GROUND_VERT,
    fragmentShader: GROUND_FRAG,
    uniforms: Object.assign({}, G, { uNoise: { value: getNoiseTexture() } }),
  });
  const m = new Mesh(geo, mat);
  m.name = 'flora-dev-ground';
  return m;
}

const WHALE_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
varying vec3 vP;
varying vec3 vN;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vN);
  float belly = smoothstep(0.1, -0.5, N.y);
  vec3 alb = mix(vec3(0.12, 0.13, 0.17), vec3(0.62, 0.6, 0.58), belly);
  Surface s = makeSurface(alb, N, vP);
  s.shadow = sampleShadow(vP, N);
  s.spec = 0.3; s.gloss = 0.7; s.rim = 0.4;
  gl_FragColor = vec4(applyFog(stylizedLight(s), vP), 1.0);
}
`;

export default async function (game) {
  const p = game.params;
  const eng = game.engine;
  if (!p.has('time')) game.atmosphere.set('morning');
  LAB = p.has('lab');
  placeholderSea(game);
  const ground = buildGround();
  eng.scene.add(ground);
  eng.shadows.addCaster(ground);

  const t0 = performance.now();
  const flora = new AlienFlora(game, { seed: +(p.get('seed') ?? 7), lodScale: +(p.get('lodscale') ?? 1), density: +(p.get('density') ?? 1) });
  if (p.has('q')) flora.setQuality(+p.get('q'));
  const h = (x, z) => height(x, z);
  const V = (x, z, dy = 0) => new Vector3(x, h(x, z) + dy, z);
  const patches = [
    { center: V(0, -40), radius: 30, biome: 'meadow', density: 1 },
    { center: V(-22, -14), radius: 18, biome: 'meadow', density: 0.8 },
    { center: V(14, 18), radius: 22, biome: 'shore', density: 1 },
    { center: V(-16, 22), radius: 16, biome: 'shore', density: 0.8 },
    { center: V(4, 44), radius: 22, biome: 'reef', density: 1 },
    { center: V(-4, -94), radius: 20, biome: 'cliff', density: 1 },
    { center: V(40, -38), radius: 17, biome: 'oasis', density: 1 },
    { center: V(-46, -42), radius: 15, biome: 'volcanic', density: 1 },
  ];
  const lab = p.get('lab');
  if (lab) {
    // lab: one species in a row of frozen poses (aux 2..3 = fixed pose 0..1), facing the camera
    const n = +(p.get('n') ?? 5);
    const sc = +(p.get('scale') ?? 1);
    const pal = +(p.get('pal') ?? 0);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * +(p.get('gap') ?? 3.2 * sc);
      flora.place(lab, V(x, -40, -0.05), null, sc, 0.13 + i * 0.217, { palette: pal, yaw: +(p.get('yaw') ?? 0), aux: p.has('live') ? 0.5 : 2 + i / Math.max(1, n - 1) });
    }
  } else {
    for (const pt of patches) flora.addPatch(Object.assign({ sample }, pt));
    // hero plants for the close-ups: [x, z, scale, yaw, palette]
    const heroes = {
      fiddle: [[4, -30, 2.2, 0.4, 0], [-3, -34, 1.8, 0, 0], [9, -38, 1.5, 0.9, 0], [-24, -60, 2.0, 1.4, 1]],
      tubes: [[8, -22, 1.4, 0.3, 0], [12, -26, 1.0, 2.0, 0], [-6, 30, 1.3, 1.0, 2]],
      bells: [[-14, -24, 1.4, 0.5, 0], [-17, -28, 1.15, 2.4, 0], [-11, -30, 1.0, 4.0, 3]],
      anemone: [[4, 8, 1.6, 0, 0], [8, 10, 1.2, 1, 1], [1, 11, 1.0, 2, 0], [6, 13, 0.9, 3, 1]],
      kelp: [[-8, -86, 1.2, 0, 0], [-2, -87, 1.0, 1.5, 0], [-6, 34, 1.3, 0.4, 0], [2, 36, 1.1, 2.2, 0]],
      seafan: [[10, 16, 1.3, 0.2, 0], [14, 19, 1.1, 1.4, 1], [6, 19, 1.0, -0.5, 2]],
      puffball: [[-12, -36, 1.5, 0, 0], [-9, -39, 1.1, 1.5, 0], [-14, -40, 0.9, 3.0, 1]],
    };
    for (const [sp, list] of Object.entries(heroes)) {
      for (const [x, z, s, yaw, pal] of list) {
        flora.place(sp, V(x, z, -0.05), null, s, (Math.abs(x * 0.37 + z * 0.11) + 0.5) % 1, { palette: pal, yaw });
      }
    }
  }
  flora.build();
  eng.scene.add(flora.root);
  if (p.has('noflora')) flora.enabled = false;
  const tBuild = performance.now() - t0;
  console.log('[flora] built in', tBuild.toFixed(0), 'ms', JSON.stringify(flora.stats().species));

  // wind
  if (p.has('wind')) {
    const w = +p.get('wind');
    game.wind.set(w, 0.35);
    game.wind.strength = w;
  }

  // a whale stand-in sweeping low over the meadow and the shore
  let whale = null;
  const whalePos = new Vector3();
  const disturbers = [];
  if (p.has('whale')) {
    const geo = new SphereGeometry(1, 32, 16);
    geo.scale(3.2, 2.6, 9);
    const mat = new ShaderMaterial({
      vertexShader: GROUND_VERT,
      fragmentShader: WHALE_FRAG,
      uniforms: Object.assign({}, G),
    });
    whale = new Mesh(geo, mat);
    whale.name = 'flora-dev-whale';
    eng.scene.add(whale);
    eng.shadows.addCaster(whale);
    disturbers.push({ pos: whalePos, radius: 6 });
  }

  // shots: [camera, target] as [x, height above the ground (or the sea), z]
  const shots = {
    wide: [[40, 14, 66], [-2, 3, -30]],
    meadow: [[16, 3.2, -6], [0, 1.2, -38]],
    fiddle: [[13, 2.6, -20], [4, 2.6, -32]],
    tubes: [[14, 1.9, -15], [9, 0.9, -23]],
    bells: [[-8, 1.7, -18], [-15, 0.8, -27]],
    anemone: [[7, 1.5, 3], [4, 0.3, 10]],
    kelp: [[-16, 2.5, -74], [-6, 3, -88]],
    fan: [[16, 1.4, 11], [10, 0.3, 18]],
    puff: [[-6, 1.4, -32], [-11, 0.4, -38]],
    moss: [[-2, 1.4, -44], [-7, 0.1, -49]],
    shore: [[30, 4, 36], [4, 1, 10]],
    reef: [[18, 3, 62], [4, -1, 40]],
    cliff: [[30, 10, -112], [-4, 2, -92]],
    oasis: [[56, 5, -20], [40, 1.5, -38]],
    volcanic: [[-28, 4, -26], [-46, 1, -42]],
    whale: [[24, 9, 24], [0, 2, -14]],
    flyover: [[34, 26, 8], [0, 0, -36]],
    top: [[0, 150, 10], [0, 0, -30]],
    far: [[120, 60, 260], [0, 6, -40]],
  };
  const gy = (x, z) => Math.max(h(x, z), 0);
  let sv = shots[p.get('shot') || 'wide'] || shots.wide;
  let v = sv.map(([x, dy, z]) => [x, gy(x, z) + dy, z]);
  if (lab) {
    const n = +(p.get('n') ?? 5), sc = +(p.get('scale') ?? 1);
    const dist = +(p.get('dist') ?? (n * +(p.get('gap') ?? 3.2 * sc) * 0.55 + 3 * sc));
    const camH = +(p.get('camh') ?? 1.6 * sc);
    v = [[0, gy(0, -40) + camH, -40 + dist], [0, gy(0, -40) + +(p.get('looky') ?? 1.4 * sc), -40]];
  }
  if (p.get('cam')) v = [p.get('cam').split(',').map(Number), (p.get('look') || '0,8,-30').split(',').map(Number)];
  const cam = eng.camera;
  const camPos = new Vector3(...v[0]), look = new Vector3(...v[1]);
  const orbit = p.has('orbit');
  const shotName = p.get('shot') || 'wide';
  game.cameraRig.update = () => {
    if (shotName === 'whale' && whale && !p.get('cam')) {
      // follow the whale stand-in from the side, looking at the plants below it
      look.set(whalePos.x, gy(whalePos.x, whalePos.z) + 1, whalePos.z);
      camPos.set(whalePos.x + 14, look.y + 7, whalePos.z + 16);
      cam.position.copy(camPos);
      cam.lookAt(look);
      game.focus.copy(look);
      return;
    }
    if (orbit) {
      const a = game.time * 0.05;
      const off = camPos.clone().sub(look).applyAxisAngle(new Vector3(0, 1, 0), a);
      cam.position.copy(look).add(off);
    } else cam.position.copy(camPos);
    cam.lookAt(look);
  };
  game.focus.copy(look);
  eng.shadows.radius = Math.max(60, Math.min(200, camPos.distanceTo(look) * 2.2));

  const t1 = +(p.get('whaleT') ?? 0);
  game.devUpdate = (dt) => {
    if (whale) {
      // a slow pass over the meadow, then back along the shore
      const T = game.time * 0.055 + t1;
      const ph = T % 2;
      const k = ph < 1 ? ph : 2 - ph;
      const zLine = lerp(-22, 6, 0.5 - 0.5 * Math.cos(Math.floor(T) * 1.7));
      const x = lerp(-70, 70, k);
      const z = zLine + Math.sin(k * 6.0) * 6;
      const gh = Math.max(h(x, z), 0);
      whalePos.set(x, gh + 5.5 + Math.sin(game.time * 0.9) * 0.8, z);
      whale.position.copy(whalePos);
      whale.rotation.set(Math.sin(game.time * 0.9) * 0.08, ph < 1 ? Math.PI / 2 : -Math.PI / 2, 0);
    }
    flora.update(dt, { disturbers });
  };
  game.devFlora = flora;
  game.devFloraBuildMs = tBuild;
  window.__flora = flora;
  if (p.has('stats')) {
    setTimeout(() => console.log('[flora] stats', JSON.stringify(flora.stats()), JSON.stringify(game.debugInfo())), 3000);
  }
}

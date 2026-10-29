// The sky of Vur Sok: a painted dome over an ocean planet. A deep blue zenith fading to a luminous
// sea haze at the horizon, the sun and its glow, low cumulus banks far out over the sea, high
// cirrus, the huge ringed gas giant (with its own spiral storm), and at night two moons with
// real phases, a spiral galaxy wheeling across the sky (the planet's spiral motif), and stars.
// Storms close the sky with a low, heavy deck. Below the horizon the dome draws the open sea the
// ocean mesh hands over to, and under the surface it draws the water itself.
// The same sky function renders a small environment map every frame for the sea's reflections.
import { Mesh, SphereGeometry, ShaderMaterial, BackSide, Vector3, Color, LessEqualDepth } from 'three';
import { G } from '../render/Globals.js';
import { UNIFORMS, NOISE, LIGHTING, SEA } from '../render/shaders/common.js';
import { FullscreenPass, FS_VERT } from '../render/FullscreenPass.js';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FN = /* glsl */ `
uniform vec3 uPlanetDir;
uniform vec3 uPlanetAxis;
uniform float uPlanetSize;
uniform float uPlanetVis;
uniform float uStars;
uniform float uBankHeight;
uniform float uCirrus;
uniform vec3 uBankLit;
uniform vec3 uBankShadow;
uniform vec3 uMoon2Dir;
uniform float uMoon2Vis;
uniform float uGalaxy;
uniform vec3 uGalaxyDir;
uniform vec3 uGalaxyU;
uniform vec3 uGalaxyV;

// Distant cumulus over the sea horizon. Returns (alpha, light). Rounded billowing tops (cellular
// bumps) over a broad base; azimuth is mapped onto a circle so the banks wrap without a seam.
vec2 cloudBank(vec3 rd, float seed, float height, float scale) {
  float az = atan(rd.x, rd.z);
  float el = asin(clamp(rd.y, -1.0, 1.0));
  vec2 ring = vec2(cos(az), sin(az));
  vec2 o = vec2(seed * 7.1, seed * 3.7);
  float mass = smoothstep(0.38, 0.72, fbm2(ring * 1.1 * scale + o));
  float towers = 1.0 - worley2(ring * 4.2 * scale + o * 1.7);
  float prof = mass * (0.45 + 0.75 * towers * towers);
  float top = height * prof;
  // cauliflower edge: round cells along the top, not spikes
  float bil = 1.0 - worley2(ring * 11.0 * scale + vec2(0.0, el * 15.0) + o * 2.1);
  float d = top - el + (bil - 0.55) * height * 0.32;
  float alpha = smoothstep(0.0, height * 0.16 + 0.003, d) * smoothstep(-0.02, 0.004, el) * step(0.002, mass);
  float sunAz = atan(uSunDir.x, uSunDir.z);
  float face = cos(az - sunAz) * 0.5 + 0.5;
  float h = clamp(1.0 - d / max(top, 1e-3), 0.0, 1.0);
  float light = clamp(0.2 + 0.5 * h * h + 0.3 * face + (bil - 0.5) * 0.35, 0.0, 1.0);
  return vec2(alpha, light);
}

// A moon: a lit sphere with a phase from the sun direction, maria, limb darkening and a halo.
vec3 moonDisk(vec3 rd, vec3 m, float radius, vec3 tint, float seed, out float cover) {
  float md = dot(rd, m);
  cover = 0.0;
  if (md < cos(radius * 7.0)) return vec3(0.0);
  vec3 mu = normalize(cross(m, abs(m.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 mv = cross(mu, m);
  vec2 q = vec2(dot(rd, mu), dot(rd, mv)) / sin(radius);
  float r = length(q);
  float halo = exp(-max(r - 1.0, 0.0) * 1.6) * 0.035 + exp(-max(r - 1.0, 0.0) * 0.35) * 0.012;
  vec3 col = tint * halo;
  if (r < 1.0) {
    float z = sqrt(1.0 - r * r);
    vec3 n = mu * q.x + mv * q.y - m * z;
    float lit = smoothstep(-0.06, 0.18, dot(n, uSunDir));
    float maria = fbm2(q * 2.3 + seed) * 0.6 + fbm2(q * 7.0 + seed * 3.0) * 0.4;
    float alb = mix(0.62, 1.0, smoothstep(0.38, 0.62, maria));
    float crater = 1.0 - worley2(q * 9.0 + seed) ;
    alb *= 0.9 + 0.12 * smoothstep(0.75, 0.95, crater);
    float limb = mix(0.55, 1.0, pow(z, 0.4));
    float shine = 0.05; // light from the gas giant on the dark side
    vec3 c = tint * alb * limb * (lit * 1.6 + shine);
    float edge = smoothstep(1.0, 0.96, r);
    cover = edge;
    col = mix(col, c, edge);
  }
  return col;
}

// The spiral galaxy: a tilted two-armed disc, brushed along its arms, with dust lanes,
// rose star-forming knots and a warm core. Subtle and painterly.
vec3 galaxy(vec3 rd) {
  float c = dot(rd, uGalaxyDir);
  if (c < 0.2) return vec3(0.0);
  vec2 p = vec2(dot(rd, uGalaxyU), dot(rd, uGalaxyV)) / c;
  p.y /= 0.46;              // inclination
  float r = length(p) / 0.3;
  if (r > 2.2) return vec3(0.0);
  float th = atan(p.y, p.x);
  float lr = log(max(r, 0.02));
  float pitch = 2.6;        // arm winding
  float spin = th - lr * pitch;
  float arms = 0.5 + 0.5 * cos(2.0 * spin);
  arms = pow(arms, 3.2);
  // brush strokes along the arms
  vec2 ap = vec2(spin * 1.6, lr * 3.0);
  float brush = fbm2(ap * vec2(1.0, 4.0) + 3.0) * 0.6 + fbm2(p * 6.0 + 11.0) * 0.4;
  float disc = exp(-r * 2.1);
  float armLight = arms * exp(-r * 1.25) * (0.55 + 0.9 * brush) * smoothstep(0.06, 0.3, r);
  float dust = 0.5 + 0.5 * cos(2.0 * spin - 0.9);
  dust = pow(dust, 6.0) * smoothstep(0.12, 0.5, r) * exp(-r * 1.0) * smoothstep(0.35, 0.7, brush);
  float core = exp(-r * r * 38.0) * 1.4 + exp(-r * 6.5) * 0.45;
  float knots = pow(max(fbm2(p * 16.0 + 4.0), 0.0), 6.0) * 26.0 * arms * smoothstep(0.15, 0.5, r) * exp(-r * 1.5);
  vec3 col = vec3(0.5, 0.64, 1.0) * armLight * 0.24
           + vec3(0.4, 0.44, 0.72) * disc * 0.14
           + vec3(1.0, 0.8, 0.55) * core * 0.32
           + vec3(1.0, 0.45, 0.62) * knots * 0.05;
  col *= 1.0 - dust * 0.75;
  float fade = smoothstep(2.2, 1.2, r);
  return col * fade;
}

vec3 starField(vec3 rd, float scale, float thresh, float env) {
  vec3 p = rd * scale;
  vec3 cell = floor(p);
  float h = hash13(cell);
  vec3 jit = hash33(cell) - 0.5;
  vec3 f = fract(p) - 0.5 - jit * 0.6;
  float size = mix(0.05, 0.11, hash11(h * 91.0));
  float star = smoothstep(size, 0.0, length(f)) * step(thresh, h);
  float tw = 0.65 + 0.35 * sin(uTime * (1.3 + h * 3.0) + h * 40.0);
  // stellar colours: blue-white to warm
  float temp = hash11(h * 17.0);
  vec3 sc = mix(vec3(1.0, 0.82, 0.62), vec3(0.75, 0.85, 1.0), temp);
  float bright = pow(hash11(h * 53.0), 3.0) * 2.5 + 0.35;
  // in the reflection map points would alias: keep only their average glow
  return mix(sc * star * tw * bright, sc * (1.0 - thresh) * 0.8, env);
}

// env: 1 when rendering the reflection map (no sun disk: the sea adds its own glitter).
vec3 skyColor(vec3 rd, float env) {
  float y = rd.y;
  float sd = max(dot(rd, uSunDir), 0.0);
  float yc = max(y, 0.0);

  // --- Base gradient --------------------------------------------------------------------------
  float hz = pow(1.0 - yc, 3.6);
  vec3 col = mix(uSkyZenith, uSkyHorizon, hz);
  col = mix(col, uSunScatter, pow(sd, 3.0) * hz * 0.55);
  // a slightly deeper band high up (the zenith of an ocean world is a saturated blue)
  col *= mix(1.0, 0.9, smoothstep(0.35, 0.95, yc) * (1.0 - uNight));

  // --- Night: galaxy, stars, moons --------------------------------------------------------------
  float above = smoothstep(-0.03, 0.12, y);
  if (uStars > 0.001) {
    vec3 sky = vec3(0.0);
    float band = exp(-pow(dot(rd, normalize(vec3(0.42, 0.25, 0.87))) * 2.6, 2.0));
    float azs = atan(rd.x, rd.z);
    vec2 ring = vec2(cos(azs), sin(azs));
    float dust = fbm2(ring * 4.0 + rd.y * 6.0) * band;
    sky += vec3(0.22, 0.25, 0.42) * dust * 0.4;
    sky += starField(rd, 230.0, 0.982, env) * 1.5;
    sky += starField(rd, 520.0, 0.965 - band * 0.05, env) * 0.7;
    if (uGalaxy > 0.001) sky += galaxy(rd) * uGalaxy;
    col += sky * uStars * above;
  }
  float mc1 = 0.0, mc2 = 0.0;
  if (uStars > 0.001 || uMoon2Vis > 0.001) {
    // the big pale moon (Aru) and the small rose-gold one (Ilsa)
    vec3 m1 = moonDisk(rd, uMoonDir, 0.028, vec3(0.86, 0.9, 1.0), 3.1, mc1);
    col = mix(col, m1 * 2.2, mc1 * uStars) + m1 * (1.0 - mc1) * uStars;
    vec3 m2 = moonDisk(rd, uMoon2Dir, 0.017, vec3(1.0, 0.8, 0.68), 7.7, mc2);
    col = mix(col, m2 * 2.0 + col * 0.15, mc2 * uMoon2Vis) + m2 * (1.0 - mc2) * uMoon2Vis * 0.6;
    col += uMoonColor * pow(max(dot(rd, uMoonDir), 0.0), 60.0) * 0.25 * uStars;
  }

  // --- Gas giant ----------------------------------------------------------------------------------
  if (uPlanetVis > 0.001) {
    float pd = dot(rd, uPlanetDir);
    float ang = acos(clamp(pd, -1.0, 1.0));
    float r = ang / uPlanetSize;
    vec3 pu = normalize(cross(uPlanetDir, uPlanetAxis));
    vec3 pv = normalize(cross(pu, uPlanetDir));
    vec2 q = vec2(dot(rd - uPlanetDir * pd, pu), dot(rd - uPlanetDir * pd, pv)) / sin(uPlanetSize);
    vec2 rq = vec2(q.x, q.y * 3.6 + q.x * 0.55);
    float rr = length(rq);
    float ringMask = smoothstep(1.35, 1.38, rr) * smoothstep(2.25, 2.2, rr);
    float gap = smoothstep(1.76, 1.79, rr) * smoothstep(1.86, 1.83, rr);
    float ringBands = 0.55 + 0.45 * sin(rr * 46.0) * sin(rr * 13.0 + 1.0);
    float pcov = 0.0;
    if (r < 1.0) {
      float z = sqrt(max(1.0 - r * r, 0.0));
      vec3 n = normalize(pu * q.x + pv * q.y - uPlanetDir * z);
      float lat = dot(n, normalize(pv + pu * 0.25));
      float lon = dot(n, pu);
      // a great spiral storm in the southern belts: the planet's spiral again
      vec2 sp = vec2(lon - 0.25, lat + 0.42);
      float sr = length(sp * vec2(1.0, 1.8));
      float swirl = exp(-sr * 9.0);
      float ang2 = atan(sp.y, sp.x) + sr * 22.0;
      float bandsIn = lat * 18.0 + fbm2(vec2(lat * 9.0, lon * 2.0)) * 2.8 + swirl * sin(ang2 * 2.0) * 1.6;
      float bands = sin(bandsIn);
      vec3 pc = mix(vec3(0.82, 0.86, 0.95), vec3(0.95, 0.86, 0.76), bands * 0.5 + 0.5);
      pc = mix(pc, vec3(0.98, 0.72, 0.58), swirl * 0.6);
      pc = mix(pc, vec3(0.72, 0.76, 0.92), smoothstep(0.6, 0.9, abs(lat)));
      float sun = smoothstep(-0.15, 0.35, dot(n, uSunDir));
      // the rings cast a thin shadow band across the disc
      float rshadow = 1.0 - 0.35 * smoothstep(0.08, 0.0, abs(q.y * 3.6 + q.x * 0.55 - 0.35)) * step(0.0, uSunDir.y);
      float rimA = pow(1.0 - z, 3.0);
      vec3 lit = pc * mix(vec3(0.14, 0.18, 0.32), vec3(1.0), sun * rshadow);
      lit += vec3(0.6, 0.75, 1.0) * rimA * 0.6;
      float edgeA = smoothstep(1.0, 0.97, r);
      float veil = mix(0.6, 0.38, uNight) * (1.0 - smoothstep(0.0, 0.25, yc) * 0.35);
      lit *= mix(1.0, 0.55, uNight);
      vec3 pcol = mix(lit, col, veil);
      col = mix(col, pcol, edgeA * uPlanetVis);
      pcov = edgeA;
    }
    // (only on the planet's side of the sky: the projection would mirror the rings at the antipode)
    float ringVis = ringMask * (1.0 - gap * 0.7) * (r < 1.0 ? step(0.0, q.y * 3.6 + q.x * 0.55) : 1.0) * step(0.5, pd);
    vec3 ringCol = mix(vec3(0.85, 0.82, 0.78), vec3(1.0, 0.95, 0.88), ringBands) * mix(0.7, 1.0, sd);
    ringCol *= mix(1.0, 0.5, uNight);
    col = mix(col, mix(ringCol, col, mix(0.6, 0.4, uNight)), ringVis * 0.75 * uPlanetVis);
  }

  // --- High cirrus -----------------------------------------------------------------------------
  if (y > 0.0 && uCirrus > 0.0) {
    vec2 p = rd.xz / (y + 0.12);
    vec2 w = normalize(uWind.xz + vec2(1e-3));
    vec2 pw = vec2(dot(p, w), dot(p, vec2(-w.y, w.x)));
    float c = fbm2(vec2(pw.x * 0.9, pw.y * 3.6) + uTime * 0.002);
    c = smoothstep(0.52, 0.85, c) * fbm2(p * 0.7 - 3.0);
    float fade = smoothstep(0.0, 0.25, y);
    vec3 cc = mix(uCloudLit, uSunScatter, pow(sd, 2.0) * 0.6);
    col = mix(col, cc, c * fade * uCirrus * 0.55);
  }

  // --- Luminous sea haze at the horizon ---------------------------------------------------------
  vec3 haze = mix(uFogColor, uSunScatter, pow(sd, 8.0) * 0.8);
  col = mix(col, haze, exp(-yc * 28.0) * 0.85);

  // --- Distant cumulus over the sea --------------------------------------------------------------
  {
    vec2 far = cloudBank(rd, 4.0, uBankHeight * 0.45, 1.0);
    vec3 farCol = mix(uBankShadow, uBankLit, far.y);
    farCol = mix(farCol, haze, 0.6);
    col = mix(col, farCol, far.x * 0.8);
    vec2 near = cloudBank(rd, 11.0, uBankHeight, 1.5);
    vec3 nearCol = mix(uBankShadow, uBankLit, near.y);
    nearCol += uSunScatter * pow(sd, 18.0) * (1.0 - near.y) * 1.5;
    nearCol = mix(nearCol, haze, 0.32 + 0.4 * smoothstep(0.03, 0.0, yc));
    col = mix(col, nearCol, near.x);
  }

  // --- Storm deck: a low, heavy overcast closes over the sky ---------------------------------------
  if (uStorm > 0.01) {
    vec2 p = rd.xz / (yc + 0.08);
    vec2 drift = uWind.xz * uTime * 0.0006;
    float d1 = fbm2_6(p * 0.55 + drift);
    float d2 = fbm2(p * 1.7 - drift * 1.6 + 5.0);
    float deck = smoothstep(0.3, 0.75, d1 * 0.75 + d2 * 0.35);
    vec3 under = mix(uCloudShadow * 0.75, uCloudLit * 0.85, deck * 0.6 + 0.2 * smoothstep(0.0, 0.5, yc));
    under = mix(under, uFogColor, exp(-yc * 7.0) * 0.6);
    float cov = uStorm * mix(0.75, 1.0, deck);
    col = mix(col, under, cov * smoothstep(-0.05, 0.03, y));
  }

  // --- Sun ------------------------------------------------------------------------------------------
  float storm = uStorm;
  col += uSunScatter * pow(sd, 10.0) * 0.18 * (1.0 - storm);
  col += uSunColor * pow(sd, 120.0) * 0.06 * (1.0 - storm);
  float disk = smoothstep(0.99955, 0.99975, sd);
  col += uSunColor * disk * 7.0 * (1.0 - storm) * smoothstep(-0.03, 0.01, y) * (1.0 - env);

  // --- Lightning ----------------------------------------------------------------------------------
  if (uFlash > 0.0) {
    float fl = fbm2(rd.xz / (abs(y) + 0.2) * 1.5 + 13.0);
    col += vec3(0.75, 0.78, 1.0) * uFlash * (0.4 + fl * 0.8) * 0.9;
  }
  return col;
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
${SEA}
${SKY_FN}
varying vec3 vDir;
void main() {
  vec3 rd = normalize(vDir);
  vec3 col;
  if (uUnderwater > 0.5) {
    // under the surface everything not drawn is water
    col = waterFogColor(rd, max(uSeaLevel - uCamPos.y, 0.0) + max(-rd.y, 0.0) * 40.0) * waterFarTint(1e4);
  } else if (rd.y < 0.0 && uCamPos.y > uSeaLevel) {
    // the open sea past the end of the ocean mesh, out to the horizon
    float t = (uCamPos.y - uSeaLevel) / max(-rd.y, 1e-5);
    vec3 P = uCamPos + rd * min(t, 1e6);
    col = airFog(seaFarColor(rd), P);
  } else {
    col = skyColor(rd, 0.0);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const ENV_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SKY_FN}
uniform vec4 uCloudBlobs[12];
uniform float uCloudBlobN;
varying vec2 vUv;
void main() {
  float az = (vUv.x - 0.5) * 6.28318530718;
  float el = vUv.y * vUv.y * 1.5707963;
  vec3 rd = vec3(sin(az) * cos(el), sin(el), cos(az) * cos(el));
  vec3 col = skyColor(rd, 1.0);
  // the big cumulus around, as soft lit masses (the sea reflects them; they are not in the dome)
  for (int i = 0; i < 12; i++) {
    if (float(i) >= uCloudBlobN) break;
    vec4 b = uCloudBlobs[i];
    float ang = acos(clamp(dot(rd, b.xyz), -1.0, 1.0));
    float q = ang / max(b.w, 1e-3);
    if (q > 1.6) continue;
    // flat base, rounded top
    vec3 up = normalize(vec3(0.0, 1.0, 0.0) - b.xyz * b.y);
    float v = dot(rd - b.xyz, up) / max(b.w, 1e-3);
    float lump = fbm2(vec2(atan(dot(rd, cross(up, b.xyz)), dot(rd, b.xyz)) * 18.0, v * 2.0) + float(i) * 7.0);
    float a = smoothstep(1.15, 0.6, q + (lump - 0.5) * 0.5) * smoothstep(-0.75, -0.45, v);
    float lit = clamp(0.45 + 0.5 * v + 0.3 * dot(b.xyz, uSunDir), 0.0, 1.0);
    vec3 cc = mix(uCloudShadow, uCloudLit, lit);
    cc = mix(cc, uFogColor, smoothstep(0.25, 0.0, b.y) * 0.6);
    col = mix(col, cc, a * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  constructor() {
    const gDir = new Vector3(-0.52, 0.5, -0.69).normalize();
    const gU = new Vector3().crossVectors(gDir, new Vector3(0.25, 1, 0.1).normalize()).normalize();
    const gV = new Vector3().crossVectors(gU, gDir).normalize();
    // tilt the galaxy's major axis across the sky
    const tilt = 0.55;
    const u2 = gU.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(gV, Math.sin(tilt));
    const v2 = gV.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(gU, -Math.sin(tilt));
    this.uniforms = Object.assign({}, G, {
      uPlanetDir: { value: new Vector3(-0.3, 0.11, -1).normalize() },
      uPlanetAxis: { value: new Vector3(0.35, 1, 0.1).normalize() },
      uPlanetSize: { value: 0.12 },
      uPlanetVis: { value: 1 },
      uStars: { value: 0 },
      uBankHeight: { value: 0.12 },
      uCirrus: { value: 0.7 },
      uBankLit: { value: new Color(1, 0.95, 0.9) },
      uBankShadow: { value: new Color(0.6, 0.62, 0.8) },
      uMoon2Dir: { value: new Vector3(0.6, 0.35, -0.7).normalize() },
      uMoon2Vis: { value: 0 },
      uGalaxy: { value: 0 },
      uGalaxyDir: { value: gDir },
      uGalaxyU: { value: u2 },
      uGalaxyV: { value: v2 },
    });
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      side: BackSide,
      depthWrite: false,
      depthTest: true,
      depthFunc: LessEqualDepth,
    });
    this.mesh = new Mesh(new SphereGeometry(1000, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10000;
    this.mesh.name = 'sky';
  }

  update(camera) {
    this.mesh.position.copy(camera.position);
  }

  /** A fullscreen pass that renders this sky into an upper-hemisphere equirect map (sea reflections). */
  createEnvPass() {
    return new FullscreenPass(new ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: ENV_FRAG,
      uniforms: this.uniforms,
    }));
  }
}

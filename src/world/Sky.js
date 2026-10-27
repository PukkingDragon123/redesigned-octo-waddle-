// Painted sky dome: soft gradient, sun & glow, towering cumulus banks rising out of the
// cloud ocean at the horizon, high cirrus, a huge ringed gas giant, stars and moon.
import { Mesh, SphereGeometry, ShaderMaterial, BackSide, Vector3, Color, LessEqualDepth } from 'three';
import { G } from '../render/Globals.js';
import { UNIFORMS, NOISE } from '../render/shaders/common.js';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
uniform vec3 uPlanetDir;
uniform vec3 uPlanetAxis;
uniform float uPlanetSize;
uniform float uPlanetVis;
uniform float uStars;
uniform float uBankHeight;
uniform float uCirrus;
uniform vec3 uBankLit;
uniform vec3 uBankShadow;
varying vec3 vDir;

// Towering cloud banks around the horizon. Returns (alpha, light).
// Azimuth is mapped onto a circle in noise space so the banks wrap without a seam.
vec2 cloudBank(vec3 rd, float seed, float height, float scale) {
  float az = atan(rd.x, rd.z);
  float el = asin(clamp(rd.y, -1.0, 1.0));
  vec2 ring = vec2(cos(az), sin(az));
  vec2 o = vec2(seed * 7.1, seed * 3.7);
  float prof = 0.0;
  prof += (fbm2(ring * 1.3 * scale + o) - 0.35) * 1.2;
  prof += pow(1.0 - worley2(ring * 3.4 * scale + o * 1.7), 2.0) * 0.55;
  prof = max(prof, 0.0);
  float top = height * prof;
  float edgeN = fbm2(ring * 14.0 * scale + vec2(el * 40.0) + o);
  float d = top - el + (edgeN - 0.5) * height * 0.22;
  float alpha = smoothstep(0.0, height * 0.12, d) * smoothstep(-0.08, 0.0, el);
  float sunAz = atan(uSunDir.x, uSunDir.z);
  float face = cos(az - sunAz) * 0.5 + 0.5;
  float inner = worley2(ring * 9.0 * scale + vec2(el * 55.0) + o * 2.3);
  float h = clamp(1.0 - d / max(top, 1e-3), 0.0, 1.0);
  float light = clamp(0.25 + 0.55 * h + 0.35 * face - inner * 0.35, 0.0, 1.0);
  return vec2(alpha, light);
}

void main() {
  vec3 rd = normalize(vDir);
  float y = rd.y;
  float sd = max(dot(rd, uSunDir), 0.0);

  // --- Base gradient (four-colour painter's palette) ------------------------------
  float t = clamp(y, 0.0, 1.0);
  float hz = pow(1.0 - t, 3.2);
  vec3 col = mix(uSkyZenith, uSkyHorizon, hz);
  col = mix(col, uSunScatter, pow(sd, 3.0) * hz * 0.55);
  col = mix(col, uFogColor, smoothstep(0.03, -0.12, y));

  // --- Night sky ---------------------------------------------------------------------
  if (uStars > 0.001) {
    vec3 p = rd * 260.0;
    vec3 cell = floor(p);
    float h = hash13(cell);
    vec3 f = fract(p) - 0.5;
    float star = smoothstep(0.08, 0.0, length(f)) * step(0.985, h);
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
    float band = exp(-pow(dot(rd, normalize(vec3(0.3, 0.6, -0.7))) * 3.0, 2.0));
    float azs = atan(rd.x, rd.z);
    vec2 ring = vec2(cos(azs), sin(azs));
    float dust = fbm2(ring * 4.0 + rd.y * 6.0) * band;
    col += vec3(0.85, 0.9, 1.0) * star * tw * uStars * smoothstep(-0.05, 0.2, y) * 1.6;
    col += vec3(0.25, 0.28, 0.45) * dust * uStars * 0.35 * smoothstep(0.0, 0.3, y);
    float md = dot(rd, uMoonDir);
    float disk = smoothstep(0.99955, 0.9997, md);
    vec3 mUp = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    float crater = fbm2(vec2(dot(rd, mUp), rd.y) * 900.0);
    col += vec3(0.85, 0.88, 1.0) * disk * (0.9 + 0.3 * crater) * uStars * 2.0;
    col += uMoonColor * pow(max(md, 0.0), 220.0) * 0.6 * uStars;
  }

  // --- Gas giant ----------------------------------------------------------------------
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
    float ringBands = 0.55 + 0.45 * sin(rr * 46.0) * sin(rr * 13.0 + 1.0);
    if (r < 1.0) {
      float z = sqrt(max(1.0 - r * r, 0.0));
      vec3 n = normalize(pu * q.x + pv * q.y - uPlanetDir * z);
      float lat = dot(n, normalize(pv + pu * 0.25));
      float bands = sin(lat * 18.0 + fbm2(vec2(lat * 9.0, dot(n, pu) * 2.0)) * 2.8);
      vec3 pc = mix(vec3(0.82, 0.86, 0.95), vec3(0.95, 0.88, 0.80), bands * 0.5 + 0.5);
      pc = mix(pc, vec3(0.72, 0.76, 0.92), smoothstep(0.6, 0.9, abs(lat)));
      float sun = smoothstep(-0.15, 0.35, dot(n, uSunDir));
      float rimA = pow(1.0 - z, 3.0);
      vec3 lit = pc * mix(vec3(0.16, 0.2, 0.35), vec3(1.0), sun);
      lit += vec3(0.6, 0.75, 1.0) * rimA * 0.6;
      float edgeA = smoothstep(1.0, 0.97, r);
      float veil = mix(0.55, 0.12, uNight) * (1.0 - smoothstep(0.0, 0.25, y) * 0.35);
      vec3 pcol = mix(lit, col, veil);
      col = mix(col, pcol, edgeA * uPlanetVis);
    }
    float ringVis = ringMask * (r < 1.0 ? step(0.0, q.y * 3.6 + q.x * 0.55) : 1.0);
    vec3 ringCol = mix(vec3(0.85, 0.82, 0.78), vec3(1.0, 0.95, 0.88), ringBands) * mix(0.7, 1.0, sd);
    col = mix(col, mix(ringCol, col, mix(0.6, 0.25, uNight)), ringVis * 0.75 * uPlanetVis);
  }

  // --- High cirrus -----------------------------------------------------------------------
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

  // --- Cumulus banks around the horizon ----------------------------------------------------
  {
    vec2 far = cloudBank(rd, 4.0, uBankHeight * 0.55, 1.0);
    vec3 farCol = mix(uBankShadow, uBankLit, far.y);
    farCol = mix(farCol, uSkyHorizon, 0.55);
    col = mix(col, farCol, far.x * 0.85);
    vec2 near = cloudBank(rd, 11.0, uBankHeight, 1.6);
    vec3 nearCol = mix(uBankShadow, uBankLit, near.y);
    nearCol += uSunScatter * pow(sd, 18.0) * (1.0 - near.x) * 2.0;
    nearCol = mix(nearCol, uSkyHorizon, 0.28);
    col = mix(col, nearCol, near.x);
  }

  // --- Sun -------------------------------------------------------------------------------
  float storm = uStorm;
  col += uSunScatter * pow(sd, 10.0) * 0.18 * (1.0 - storm);
  col += uSunColor * pow(sd, 120.0) * 0.06 * (1.0 - storm);
  float disk = smoothstep(0.99955, 0.99975, sd);
  col += uSunColor * disk * 7.0 * (1.0 - storm) * smoothstep(-0.03, 0.01, y);

  // --- Storm & lightning -------------------------------------------------------------------
  if (uFlash > 0.0) {
    float fl = fbm2(rd.xz / (abs(y) + 0.2) * 1.5 + 13.0);
    col += vec3(0.75, 0.78, 1.0) * uFlash * (0.4 + fl * 0.8) * 0.9;
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  constructor() {
    this.uniforms = Object.assign({}, G, {
      uPlanetDir: { value: new Vector3(-0.25, 0.16, -1).normalize() },
      uPlanetAxis: { value: new Vector3(0.35, 1, 0.1).normalize() },
      uPlanetSize: { value: 0.17 },
      uPlanetVis: { value: 1 },
      uStars: { value: 0 },
      uBankHeight: { value: 0.16 },
      uCirrus: { value: 0.7 },
      uBankLit: { value: new Color(1, 0.95, 0.9) },
      uBankShadow: { value: new Color(0.6, 0.62, 0.8) },
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
}

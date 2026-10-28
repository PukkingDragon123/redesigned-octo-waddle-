// Terrain shading for Vur Sok: sea-worn sedimentary rock and basalt, painted meadows, sand,
// the intertidal wet line (black lichen, barnacles, algae), moss, and the faint glow of young
// lava. Layered detail at three scales: macro value patches (~90 m), meso strata, streaks and
// joints (~6-20 m), micro grain and cracks (~1-2 m) with screen-space bump from the micro height.
//
// Vertex attributes: color (painted rock albedo), aMat (x meadow, y sand, z rock kind 0 sedimentary
// .. 1 basalt, w heat), aExt (x cavity AO, y strata coordinate winding with the spiral).
import { UNIFORMS, NOISE, SHADOW, LIGHTING } from '../../render/shaders/common.js';

// the ocean owner adds uSeaState to the shared uniform block; declare it ourselves until then
export const SEA_DECL = /uniform\s+float\s+uSeaState\b/.test(UNIFORMS) ? '' : 'uniform float uSeaState;';

export const TERRAIN_VERT = /* glsl */ `
${UNIFORMS}
attribute vec4 aMat;
attribute vec3 aExt;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying vec4 vMat;
varying vec3 vExt;
void main() {
  vec3 transformed = position;
  vec3 n = normal;
  #ifdef USE_INSTANCING
    transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  #ifdef USE_COLOR
    vColor = color;
  #else
    vColor = vec3(1.0);
  #endif
  vMat = aMat;
  vExt = aExt;
  #ifdef USE_INSTANCING
    // instanced props (boulders, basalt columns) carry their strata in world height
    vExt.y = aExt.y + wp.y;
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const TERRAIN_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
uniform sampler2D uNoise;
uniform vec3 uGrassDark;
uniform vec3 uGrassLight;
uniform vec3 uGrassDry;
uniform vec3 uGrassTeal;
uniform vec3 uMossColor;
uniform vec3 uSandLight;
uniform vec3 uSandBlack;
uniform vec3 uLava;
uniform float uFlowers;
${SEA_DECL}
uniform float uDetail;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying vec4 vMat;
varying vec3 vExt;

vec4 triN(vec3 p, vec3 w, float s) {
  return texture2D(uNoise, p.zy * s) * w.x + texture2D(uNoise, p.xz * s) * w.y + texture2D(uNoise, p.xy * s + 0.37) * w.z;
}

// cell pattern for columnar joints / barnacles / lichen: returns (edge distance, cell id hash)
vec2 cells(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0; float id = 0.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash22(i + g) * 0.8 + 0.1;
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash12(i + g); }
    else if (d < d2) { d2 = d; }
  }
  return vec2(sqrt(d2) - sqrt(d1), id);
}

void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 P = vWorldPos;
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  float dist = length(uCamPos - P);
  // pixel footprint (m): procedural detail fades before it can alias into speckle
  float px = max(length(dFdx(P)), length(dFdy(P)));
  float fineF = uDetail * (1.0 - smoothstep(0.05, 0.22, px));   // ~0.3-1 m features
  float mesoF = uDetail * (1.0 - smoothstep(0.25, 1.4, px));    // ~2-6 m features
  float detail = mesoF;
  vec3 w = pow(abs(N), vec3(4.0));
  w /= (w.x + w.y + w.z);

  float meadowIn = vMat.x, sandIn = vMat.y, kind = vMat.z, heat = vMat.w;
  float cav = vExt.x;
  float edgeW = vExt.z;
  float steep = 1.0 - smoothstep(0.45, 0.8, N.y);

  vec4 nM = triN(P, w, 1.0 / 95.0);
  vec4 nm = triN(P, w, 1.0 / 17.0);
  vec4 nu = triN(P, w, 1.0 / 2.6);
  float micro = nu.b;

  // ---------------- rock ----------------
  vec3 rock = vColor;
  float sed = 1.0 - kind;
  // cliff projections: z-y plane (faces looking along x) and x-y plane (faces looking along z)
  vec2 ax = w.xz / (w.x + w.z + 1e-4);
  // macro value patches (painterly): broad warm/cool shifts
  rock *= 0.78 + 0.38 * nM.r;
  rock = mix(rock, rock * vec3(1.07, 0.97, 0.88), smoothstep(0.45, 0.75, nM.a) * 0.7);
  rock = mix(rock, rock * vec3(0.9, 0.95, 1.04), smoothstep(0.5, 0.8, nM.g) * 0.5);
  // fine strata bands following the spiral coordinate (sedimentary)
  float st = vExt.y + (nm.r - 0.5) * 1.6 + (nM.a - 0.5) * 3.0;
  float bandId = floor(st / 1.35);
  float bf = fract(st / 1.35);
  float bandTone = 0.84 + 0.3 * hash11(bandId * 1.37 + 3.1);
  float bedLine = smoothstep(0.1, 0.0, bf) + smoothstep(0.92, 1.0, bf) * 0.6;
  rock *= mix(1.0, bandTone * (1.0 - bedLine * 0.25 * steep * mesoF), sed * (0.5 + 0.5 * steep));

  // chiselled facets: joint-bounded blocks (beds for sedimentary rock, tall prisms for basalt),
  // each a plane with its own tilt, at two scales; joints between them are dark cracks
  vec2 cellS = mix(vec2(1.0 / 3.4, 1.0 / 1.7), vec2(1.0 / 1.5, 1.0 / 6.5), kind);
  vec2 cA = cells(vec2(P.z, P.y + nm.r * 1.5) * cellS + 13.1);
  vec2 cB = cells(vec2(P.x, P.y + nm.r * 1.5) * cellS + 71.7);
  vec2 cT = cells(P.xz * mix(0.42, 0.62, kind) + 5.3);
  vec2 bA = cells(vec2(P.z, P.y) * cellS * 0.28 + 3.7);
  vec2 bB = cells(vec2(P.x, P.y) * cellS * 0.28 + 9.1);
  vec2 tA = vec2(hash11(cA.y * 17.3), hash11(cA.y * 29.1)) * 2.0 - 1.0;
  vec2 tB = vec2(hash11(cB.y * 17.3), hash11(cB.y * 29.1)) * 2.0 - 1.0;
  vec2 tT = vec2(hash11(cT.y * 17.3), hash11(cT.y * 29.1)) * 2.0 - 1.0;
  vec2 uA = vec2(hash11(bA.y * 7.3), hash11(bA.y * 13.9)) * 2.0 - 1.0;
  vec2 uB = vec2(hash11(bB.y * 7.3), hash11(bB.y * 13.9)) * 2.0 - 1.0;
  vec3 facetOff = steep * (ax.x * (vec3(0.0, tA.y * 0.5, tA.x) * 0.55 * mesoF + vec3(0.0, uA.y * 0.6, uA.x) * 1.3)
                         + ax.y * (vec3(tB.x, tB.y * 0.5, 0.0) * 0.55 * mesoF + vec3(uB.x, uB.y * 0.6, 0.0) * 1.3))
                + (1.0 - steep) * vec3(tT.x, 0.0, tT.y) * 0.6 * mesoF;
  float edgeD = mix(cT.x, ax.x * cA.x + ax.y * cB.x, steep);
  float bigEdge = ax.x * bA.x + ax.y * bB.x;
  float facetId = mix(cT.y, ax.x > 0.5 ? cA.y : cB.y, step(0.5, steep));
  rock *= mix(1.0, 0.9 + 0.2 * facetId, mesoF);
  float bigId = ax.x > 0.5 ? bA.y : bB.y;
  rock *= mix(1.0, 0.86 + 0.28 * bigId, steep);
  // fresh rockfall scars: a few joint-bounded blocks recently fallen away, paler and unweathered
  float scar = step(0.86, hash11(bigId * 41.3)) * steep * smoothstep(0.02, 0.06, bigEdge) * smoothstep(6.0, 12.0, P.y);
  rock = mix(rock, mix(vec3(luma(rock)), rock, 0.6) * 1.32 + vec3(0.03, 0.025, 0.015), scar * 0.55);
  rock = mix(rock, rock * mix(vec3(1.08, 0.98, 0.9), vec3(0.92, 0.97, 1.06), hash11(bigId * 9.1)), steep * 0.6);
  float jointMask = smoothstep(0.35, 0.7, nm.g + 0.3 * (hash11(facetId * 5.3) - 0.5));
  // joints are anti-aliased against their own screen-space width
  float jw = max(fwidth(edgeD), 1e-4), bw = max(fwidth(bigEdge), 1e-4);
  float joint = (1.0 - smoothstep(0.0, max(0.06, jw * 1.5), edgeD)) * mesoF * jointMask * smoothstep(0.12, 0.03, jw)
              + (1.0 - smoothstep(0.0, max(0.03, bw * 1.5), bigEdge)) * steep * 0.9 * smoothstep(0.1, 0.02, bw);
  rock *= 1.0 - joint * 0.4;

  // edge wear: convex lips and corners chipped pale (geometric), plus the lit lip of each facet
  float wear = clamp(edgeW * (0.6 + 0.6 * nm.b), 0.0, 1.0);
  rock = mix(rock, mix(rock, vec3(luma(rock)), 0.35) * 1.38, wear * 0.55);
  // rain streaks down steep faces (tiger stripes on limestone), rust seeps
  float streakA = texture2D(uNoise, vec2(P.z / 7.0, P.y / 75.0)).b;
  float streakB = texture2D(uNoise, vec2(P.x / 7.0 + 0.5, P.y / 75.0)).b;
  float streak = ax.x * streakA + ax.y * streakB;
  float streak2 = ax.x * texture2D(uNoise, vec2(P.z / 2.3, P.y / 30.0)).r + ax.y * texture2D(uNoise, vec2(P.x / 2.3, P.y / 30.0)).r;
  float stain = smoothstep(0.5, 0.78, streak) * steep * (1.0 - scar * 0.8);
  rock *= 1.0 - stain * mix(0.38, 0.2, kind);
  rock = mix(rock, rock * vec3(1.12, 0.94, 0.8), smoothstep(0.55, 0.75, streak2) * steep * sed * 0.5);
  // basalt: polygonal column tops on flats
  float jointLine = joint;
  // cracks
  float crack = smoothstep(0.06, 0.0, edgeD) * smoothstep(0.35, 0.7, nm.b) * fineF;
  rock *= 1.0 - crack * 0.3;
  // micro grain
  rock *= 1.0 + 0.12 * (micro - 0.5) * fineF;
  // lichen: pale and orange crust spots on sedimentary rock above the spray, grey on basalt
  vec2 lc = cells(P.xz * 0.9 + P.y * 0.6);
  float lichen = smoothstep(0.62, 0.9, nm.g) * step(0.55, lc.y) * smoothstep(0.0, 0.25, lc.x) * smoothstep(5.0, 9.0, P.y) * fineF;
  vec3 lichenCol = mix(vec3(0.62, 0.58, 0.4), vec3(0.7, 0.38, 0.16), step(0.85, lc.y));
  rock = mix(rock, lichenCol * (0.7 + 0.3 * nm.r), lichen * 0.55 * (1.0 - kind * 0.6));
  // moss on ledges and damp hollows
  float mossW = smoothstep(0.5, 0.85, N.y + (nm.a - 0.5) * 0.6) * (1.0 - meadowIn) * smoothstep(3.0, 7.0, P.y);
  mossW = max(mossW, smoothstep(0.75, 0.35, cav) * smoothstep(4.0, 8.0, P.y) * 0.6);
  rock = mix(rock, uMossColor * (0.75 + 0.45 * nm.b), clamp(mossW, 0.0, 1.0) * 0.72);

  // ---------------- intertidal zone ----------------
  float yN = P.y + (nm.r - 0.5) * 1.4 + (streak - 0.5) * 0.8;
  float splash = 1.4 + uSeaState * 4.5;
  float wet = smoothstep(splash + 1.2, splash - 0.6, yN);
  float blackZone = smoothstep(splash + 3.6, splash + 1.4, yN) * (1.0 - wet);
  float barnZone = smoothstep(1.6, 0.9, yN) * smoothstep(-0.5, 0.3, yN);
  float algae = smoothstep(0.5, -0.1, yN) * smoothstep(-2.5, -0.6, yN);
  vec2 bc = cells(vec2(ax.x * P.z + ax.y * P.x, P.y) * 3.2 + P.xz * 0.5);
  float barn = barnZone * smoothstep(0.12, 0.3, bc.x) * step(0.35, bc.y) * fineF * smoothstep(0.08, 0.03, px);
  rock *= 1.0 - blackZone * 0.5 * (0.6 + 0.4 * streak);
  rock = mix(rock, rock * vec3(0.42, 0.44, 0.46), wet * 0.85);
  rock = mix(rock, vec3(0.42, 0.4, 0.36), barn * 0.6);
  rock = mix(rock, vec3(0.1, 0.16, 0.07) * (0.8 + 0.4 * nm.g), algae * 0.75);
  // below the waterline: encrusting coralline pinks and green film
  float sub = smoothstep(-0.8, -2.5, P.y);
  vec3 subCol = mix(vec3(0.2, 0.24, 0.16), vec3(0.42, 0.24, 0.3), smoothstep(0.55, 0.8, nm.g));
  rock = mix(rock, subCol * (0.7 + 0.5 * nM.b), sub * 0.6 * (1.0 - sandIn));

  vec3 albedo = rock;
  float heightB = (micro - 0.5) * 0.5 * fineF + nm.b * 0.4 * mesoF - crack * 0.4 - joint * 0.35;

  // ---------------- sand ----------------
  float sandW = smoothstep(0.25, 0.65, sandIn + (nm.g - 0.5) * 0.35);
  if (sandW > 0.001) {
    vec3 sc = mix(mix(uSandLight * 0.8, vColor * 1.12, 0.55), uSandBlack, kind);
    sc *= 0.9 + 0.16 * nM.r + 0.06 * micro;
    // ripples on shallow and beach sand
    vec2 rd = vec2(0.8, 0.6);
    float rip = sin(dot(P.xz, rd) * 2.4 + nm.r * 6.0 + nM.g * 10.0);
    float ripW = smoothstep(2.0, -0.5, P.y) * (0.5 + 0.5 * nm.b) * detail;
    sc *= 1.0 + rip * 0.07 * ripW;
    // wet sand and the swash line
    float wetS = smoothstep(0.9 + uSeaState, 0.2, P.y + (nm.r - 0.5) * 0.5);
    sc = mix(sc, sc * vec3(0.66, 0.68, 0.7), wetS);
    // shell grit and seaweed wrack along the strand line
    float wrack = smoothstep(0.06, 0.0, abs(P.y - 1.1 - uSeaState * 0.8 + (nm.g - 0.5) * 0.6)) * step(0.5, nu.g);
    sc = mix(sc, vec3(0.22, 0.2, 0.14), wrack * 0.5 * detail);
    // dark volcanic sand glints
    sc += kind * vec3(0.5, 0.48, 0.45) * step(0.985, hash12(floor(P.xz * 9.0))) * detail * 0.4;
    albedo = mix(albedo, sc, sandW);
    heightB = mix(heightB, rip * 0.25 * ripW + micro * 0.2, sandW);
  }

  // ---------------- tide pools: still water in hollows of the rock platforms ----------------
  float pool = 0.0;
  if (P.y > 0.15 && P.y < 1.9 && N.y > 0.8) {
    vec2 pc = cells(P.xz / 3.6 + nm.rg * 0.6);
    float rim = smoothstep(0.18, 0.32, pc.x + (nm.b - 0.5) * 0.12);
    pool = rim * step(0.45, pc.y) * smoothstep(0.8, 0.95, N.y) * (1.0 - sandW) * smoothstep(1.9, 1.2, P.y) * smoothstep(0.15, 0.45, P.y);
    // a ring of green weed at the pool's lip
    float lipW = smoothstep(0.12, 0.2, pc.x) * (1.0 - rim) * step(0.45, pc.y);
    albedo = mix(albedo, vec3(0.08, 0.14, 0.06), lipW * 0.7 * (1.0 - sandW));
  }

  // ---------------- meadow ----------------
  float gr = smoothstep(0.3, 0.62, meadowIn + (nm.g - 0.5) * 0.45 + (nu.r - 0.5) * 0.2) * smoothstep(0.42, 0.72, N.y);
  float grassAmt = 0.0;
  if (gr > 0.001) {
    vec2 wp = P.xz;
    float patchA = texture2D(uNoise, wp / 120.0).r;
    float patchB = texture2D(uNoise, wp / 33.0 + 0.37).a;
    float blades = texture2D(uNoise, wp / 1.9).b;
    vec3 g = mix(uGrassDark, uGrassLight, smoothstep(0.25, 0.75, patchA));
    g = mix(g, uGrassTeal, smoothstep(0.55, 0.85, patchB) * 0.45);
    g = mix(g, uGrassDry, smoothstep(0.6, 0.92, texture2D(uNoise, wp / 61.0 + 0.71).g) * 0.4);
    g = mix(g, uGrassDry * 0.9, smoothstep(0.55, 0.85, steep) * 0.5);
    g *= 0.86 + 0.26 * blades * (0.4 + 0.6 * detail);
    // wind waves rolling over the meadow
    vec2 wd = normalize(uWind.xz + vec2(1e-3));
    float wave = sin(dot(wp, wd) * 0.08 - uWavePhase * 1.3 + patchA * 5.0);
    g *= 1.0 + 0.12 * smoothstep(0.5, 1.0, wave) * (0.4 + 0.6 * smoothstep(0.0, 6.0, length(uWind)));
    // flowers: violet, cream and coral sprinkles
    if (uFlowers > 0.0) {
      vec2 cell = floor(wp / 1.3);
      float h = hash12(cell);
      vec2 f = fract(wp / 1.3) - 0.5;
      float fl = step(1.0 - uFlowers * 0.1, h) * smoothstep(0.24, 0.1, length(f)) * detail;
      vec3 fc = mix(vec3(0.62, 0.42, 0.85), vec3(1.0, 0.93, 0.78), hash12(cell + 7.0));
      fc = mix(fc, vec3(1.0, 0.52, 0.42), step(0.8, hash12(cell + 3.0)));
      g = mix(g, fc, fl * smoothstep(0.3, 0.6, patchB));
    }
    albedo = mix(albedo, g, gr);
    grassAmt = gr;
    heightB = mix(heightB, blades * 0.7, gr);
  }

  // ---------------- facets + bump (screen-space, from the micro height) ----------------
  N = normalize(N + facetOff * 0.32 * (1.0 - grassAmt) * (1.0 - sandW));
  float bumpAmt = (0.45 + 0.5 * steep) * (1.0 - grassAmt * 0.6);
  vec3 dpdx = dFdx(P), dpdy = dFdy(P);
  float dhx = dFdx(heightB), dhy = dFdy(heightB);
  vec3 r1 = cross(dpdy, N), r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  vec3 Nb = normalize(abs(det) * N - grad * bumpAmt * 0.9);
  if (abs(det) > 1e-8) N = normalize(mix(N, Nb, 0.85));

  Surface s = makeSurface(albedo, N, P);
  s.shadow = sampleShadow(P, normalize(vNormal));
  s.rim = 0.2;
  s.wrap = 0.22;
  s.trans = grassAmt * 0.22;
  float wetAll = max(wet * (1.0 - sandW), smoothstep(0.7, 0.1, P.y) * sandW);
  s.spec = wetAll * 0.55 * smoothstep(-0.5, 0.3, P.y);
  s.gloss = 0.75;
  if (pool > 0.01) {
    // the pool mirrors the sky over a dark, weedy floor
    vec3 Vp = normalize(uCamPos - P);
    float fr = 0.04 + 0.96 * pow(1.0 - max(Vp.y, 0.0), 5.0);
    vec3 R = reflect(-Vp, vec3(0.0, 1.0, 0.0));
    vec3 sky = mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.6, R.y));
    s.albedo = mix(s.albedo, s.albedo * vec3(0.25, 0.32, 0.3), pool);
    s.N = normalize(mix(s.N, vec3(0.0, 1.0, 0.0), pool));
    s.emissive += sky * fr * pool * 0.9 * (1.0 - uNight * 0.7);
    s.spec = mix(s.spec, 1.0, pool);
    s.gloss = mix(s.gloss, 0.97, pool);
  }
  s.ao = cav * mix(0.74, 1.0, smoothstep(-0.7, 0.5, N.y)) * (0.85 + 0.15 * micro);
  // lava: faint glowing fissures at the foot of forming islands (restrained, natural light only)
  if (heat > 0.01) {
    // fissures between cooling crust plates: lines widened to at least a pixel and dimmed in
    // proportion, so far away they read as a soft glow instead of sparkling dots
    vec2 lc2 = cells(P.xz / 4.2 + nm.rg * 1.5 + vec2(P.y * 0.15));
    float fw = max(fwidth(lc2.x), 1e-4);
    float lw = max(0.07, fw * 1.2);
    float fis = (1.0 - smoothstep(0.0, lw, lc2.x)) * (0.07 / lw) * heat;
    float pulse = 0.75 + 0.25 * sin(uTime * 0.7 + lc2.y * 6.28);
    float foot = smoothstep(9.0, 0.5, P.y);
    float hot = fis * pulse * foot;
    // a dull underglow where the young rock meets the water
    float under = heat * foot * smoothstep(3.0, 0.0, P.y) * 0.18;
    s.emissive += uLava * (hot + under) * (1.4 + 2.0 * uNight);
    s.albedo *= 1.0 - fis * 0.5;
  }
  vec3 col = stylizedLight(s);
  col = applyFog(col, P);
  gl_FragColor = vec4(col, 1.0);
}
`;

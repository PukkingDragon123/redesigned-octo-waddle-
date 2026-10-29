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

// World-space height gradient (per metre) of a noise-channel mix over the three projection planes:
// the triplanar detail normal (three taps per plane; planes with no weight are skipped).
vec3 triGrad(vec3 p, vec3 w, float s, vec4 ch) {
  const float e = 1.0 / 256.0;
  vec3 g = vec3(0.0);
  if (w.x > 0.03) {
    vec2 uv = p.zy * s;
    float h0 = dot(texture2D(uNoise, uv), ch);
    g += w.x * vec3(0.0, dot(texture2D(uNoise, uv + vec2(0.0, e)), ch) - h0, dot(texture2D(uNoise, uv + vec2(e, 0.0)), ch) - h0);
  }
  if (w.y > 0.03) {
    vec2 uv = p.xz * s;
    float h0 = dot(texture2D(uNoise, uv), ch);
    g += w.y * vec3(dot(texture2D(uNoise, uv + vec2(e, 0.0)), ch) - h0, 0.0, dot(texture2D(uNoise, uv + vec2(0.0, e)), ch) - h0);
  }
  if (w.z > 0.03) {
    vec2 uv = p.xy * s + 0.37;
    float h0 = dot(texture2D(uNoise, uv), ch);
    g += w.z * vec3(dot(texture2D(uNoise, uv + vec2(e, 0.0)), ch) - h0, dot(texture2D(uNoise, uv + vec2(0.0, e)), ch) - h0, 0.0);
  }
  return g * (s / e);
}

// Voronoi: x = F2 - F1 (distance to the cell edge), y = cell id hash, z = F1 (distance to the
// cell's feature point)
vec3 cells(vec2 p) {
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
  return vec3(sqrt(d2) - sqrt(d1), id, sqrt(d1));
}

// Pebbles / barnacles: xy = vector from the nearest feature point, z = its distance, w = id
vec4 stones(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0; vec2 best = vec2(0.0); float id = 0.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash22(i + g) * 0.7 + 0.15;
    vec2 r = f - g - o;
    float d = dot(r, r);
    if (d < d1) { d1 = d; best = r; id = hash12(i + g + 17.0); }
  }
  return vec4(best, sqrt(d1), id);
}

// remove the normal component of a gradient and bend the normal against it
vec3 bendN(vec3 N, vec3 g, float amt) {
  return normalize(N - (g - N * dot(N, g)) * amt);
}

void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 P = vWorldPos;
  vec3 N0 = normalize(vNormal);
  if (!gl_FrontFacing) N0 = -N0;
  vec3 N = N0;
  // pixel footprint (m): procedural detail fades before it can alias into speckle
  float px = max(length(dFdx(P)), length(dFdy(P)));
  float microF = uDetail * (1.0 - smoothstep(0.006, 0.025, px));  // < 10 cm features (grain, barnacles)
  float fineF = uDetail * (1.0 - smoothstep(0.05, 0.22, px));    // ~0.3-1 m features
  float mesoF = uDetail * (1.0 - smoothstep(0.25, 1.4, px));     // ~2-6 m features
  float detail = mesoF;
  vec3 w = pow(abs(N), vec3(4.0));
  w /= (w.x + w.y + w.z);

  float meadowIn = vMat.x, sandIn = vMat.y, kind = vMat.z, heat = vMat.w;
  float cav = vExt.x;
  float edgeW = vExt.z;
  float steep = 1.0 - smoothstep(0.45, 0.8, N.y);
  float sed = 1.0 - kind;

  vec4 nM = triN(P, w, 1.0 / 95.0);
  vec4 nm = triN(P, w, 1.0 / 17.0);
  vec4 nu = triN(P, w, 1.0 / 2.6);
  float micro = nu.b;
  // cliff projections: z-y plane (faces looking along x) and x-y plane (faces looking along z)
  vec2 ax = w.xz / (w.x + w.z + 1e-4);
  // horizontal coordinate along a cliff face, and the face's horizontal tangent
  float uF = ax.x * P.z + ax.y * P.x;
  vec3 tU = normalize(cross(vec3(0.0, 1.0, 0.0), N0) + vec3(1e-4, 0.0, 0.0));
  // hand-drawn lines (no ruler-straight crack, joint or bed anywhere): every line below is drawn
  // through coordinates warped by a slow wobble (nm, nu) plus a fine pen tremor (nj, ~1 m, faded
  // with the pixel footprint so it never shimmers), and its width swells and thins along it
  vec4 nj = texture2D(uNoise, mix(P.xz, vec2(uF, P.y), steep) / 1.15 + 0.29);
  vec4 pen = (nu - 0.5) + (nj - 0.5) * 0.45 * fineF;

  // coverage first: rock work is skipped where meadow or sand hide it entirely
  float sandW = smoothstep(0.25, 0.65, sandIn + (nm.g - 0.5) * 0.35);
  float gr = smoothstep(0.3, 0.62, meadowIn + (nm.g - 0.5) * 0.45 + (nu.r - 0.5) * 0.2) * smoothstep(0.42, 0.72, N0.y);
  float rockVis = (1.0 - sandW) * (1.0 - gr);

  // ======================= rock =======================
  vec3 rock = vColor;
  float heightB = 0.0;     // relief for the screen-space bump (sharp structures: beds, joints, cracks)
  vec3 facetOff = vec3(0.0);
  float crevice = 0.0;     // 0 open face .. 1 deep in a joint / bedding notch (cavity AO, moss)
  float wear = 0.0;
  float wet = 0.0, splashZ = 0.0, barnZone = 0.0, algae = 0.0, streak = 0.5;
  if (rockVis > 0.002) {
    // macro: broad painterly value and temperature shifts (~100 m)
    rock *= 0.8 + 0.36 * nM.r;
    rock = mix(rock, rock * vec3(1.08, 0.97, 0.86), smoothstep(0.45, 0.75, nM.a) * 0.7);
    rock = mix(rock, rock * vec3(0.9, 0.96, 1.05), smoothstep(0.5, 0.8, nM.g) * 0.5);

    // ---- bedding (sedimentary): beds of uneven hardness winding with the spiral ----
    // (the pen wobble also hides the kinks of the per-vertex strata coordinate at triangle edges)
    float st = vExt.y + (nm.r - 0.5) * 1.6 + (nM.a - 0.5) * 3.0 + (nm.b - 0.5) * 0.9 + pen.r * 0.42 * mesoF;
    float bedT = 1.35;
    // beds of uneven thickness, gathered in packages (thick massive beds, runs of thin ones): a
    // gently varying, always increasing bed coordinate, so the strata never print as even stripes
    float bedU = st / bedT + 0.32 * sin(st * 0.29 + 1.3) + 0.18 * sin(st * 0.73 + 4.1);
    float bandId = floor(bedU);
    float bf = fract(bedU);
    float hard = hash11(bandId * 1.37 + 3.1);
    // mineral colour of each bed: buff, iron-red, grey-blue, greenish, cream
    float mh = hash11(bandId * 7.13 + 1.7);
    vec3 mineral = mh < 0.22 ? vec3(1.12, 0.94, 0.8) : mh < 0.42 ? vec3(0.9, 0.95, 1.05) : mh < 0.55 ? vec3(0.95, 1.02, 0.92) : mh < 0.7 ? vec3(1.07, 1.04, 0.95) : vec3(1.0);
    float bandTone = 0.89 + 0.2 * hard;
    // the bedding plane is an eroded notch; hard beds stand proud with a lit lip
    // some bedding planes are deep notches, most only faint partings (massive beds, thin beds)
    // (each plane's depth hashes on the bed above it, so both sides of a plane agree)
    // a deep notch fades in and out along its length like a re-inked stroke, and swells and thins
    float notchFade = smoothstep(0.28, 0.55, nm.a + pen.g * 0.5);
    float notchLo = mix(0.22, 1.0, step(0.58, hash11(bandId * 2.31 + 0.4)) * notchFade);
    float notchHi = mix(0.22, 1.0, step(0.58, hash11((bandId + 1.0) * 2.31 + 0.4)) * notchFade);
    float nW = 0.6 + 0.8 * clamp(nu.a + (nj.a - 0.5) * 0.5 * fineF, 0.0, 1.0);
    float notch = smoothstep(0.16 * nW, 0.0, bf) * notchLo + smoothstep(1.0 - 0.1 * nW, 1.0, bf) * 0.5 * notchHi;
    float bedRelief = (hard - 0.5) * 0.35 - notch * 0.45;
    // thin laminae inside the softer beds
    float lam = sin(st * 18.0 + nm.b * 3.0) * (1.0 - hard) * 0.5 + 0.5;
    float sedK = sed * (0.45 + 0.55 * steep);
    // (far away a bed is a pixel or two: its colour steps calm down so the stack reads as one
    // weathered rock with strata in it, not a striped cake; up close each bed keeps its colour)
    float bedCalm = mix(1.0, 0.45, smoothstep(0.04, 0.3, px));
    mineral = mix(vec3(1.0), mineral, 0.6); // beds differ in tone more than in hue: no candy stripes
    rock *= mix(vec3(1.0), mineral * bandTone * (1.0 - lam * 0.08 * fineF), sedK * bedCalm);
    heightB += (bedRelief + lam * 0.04 * fineF) * steep * sed * mesoF;
    crevice = max(crevice, notch * steep * sed * mesoF);

    // ---- joints: vertical fractures through each bed (offset bed to bed), master joints running
    // the full height; basalt: polygonal column joints and cross fractures ----
    // bed joints bow and waver down through their bed (the pen wobble varies with height)
    float jWarp = (nm.g - 0.5) * 1.2 + pen.b * 0.55;
    float sp = mix(2.2, 6.5, hash11(bandId * 3.31 + 0.7));
    float jx = (uF + jWarp + hash11(bandId * 5.9) * sp) / sp;
    float blockSed = bandId * 31.0 + floor(jx);
    float jh = hash11(blockSed * 0.53 + 2.1);
    jx += (bf - 0.5) * (bf - 0.5) * (jh - 0.5) * 1.6 / sp;                  // each one curves its own way
    float dJ = min(fract(jx), 1.0 - fract(jx)) * sp;                         // m to the bed joint
    float jOn = step(0.8, hash11(blockSed * 0.37));                         // few bed joints open
    // a bed joint is a stroke: it tapers to a point before (or just past) the bed's edges
    float jTap = smoothstep(-0.06 + 0.2 * jh, 0.3, bf) * smoothstep(1.06 - 0.2 * hash11(blockSed * 0.71), 0.7, bf);
    dJ += (1.0 - jTap) * 0.12;
    float mSp = mix(5.0, 9.0, hash11(floor(st / 9.0) * 2.7));
    float mWarp = (nM.r - 0.5) * 6.0 + (nm.b - 0.5) * 1.8 + (nm.g - 0.5) * 0.8;
    float mx = (uF + mWarp + pen.r * 0.8) / mSp;
    float dM = min(fract(mx), 1.0 - fract(mx)) * mSp;                        // m to a master joint
    float blockM = floor(mx);
    // master joints are drawn in overlapping strokes: one fades out (tapering) as a second,
    // slightly offset one takes over, so long fractures never run ruler-straight
    float mSel = nm.a + pen.g * 0.35;
    float mx2 = (uF + mWarp + 0.3 + pen.b * 0.7 + (nm.r - 0.5) * 0.6) / mSp;
    float dM2 = min(fract(mx2), 1.0 - fract(mx2)) * mSp;
    dM = min(dM + smoothstep(0.42, 0.62, mSel) * 0.35, dM2 + smoothstep(0.58, 0.36, mSel) * 0.35);
    // basalt columns (only where there is basalt): warped cells, so the column edges are drawn
    // curves that waver up the face instead of polygons ruled straight down it
    vec3 col = kind > 0.01 ? cells(P.xz * 0.62 + nm.rg * 0.35 + pen.rg * 0.28) : vec3(9.0, 0.5, 1.0);
    float dC = col.x / 0.62;
    float colP = mix(0.8, 1.9, col.y);
    float yX = P.y + col.y * 7.3 + pen.b * 0.3 + (nm.g - 0.5) * 0.4;
    float crossF = fract(yX / colP);
    float dX = min(crossF, 1.0 - crossF) * colP;
    // distance to the nearest open joint (m) and the block id, per rock kind
    float dSed = min(mix(9.0, dJ, jOn), dM + 0.02);
    float dBas = min(dC, mix(9.0, dX, step(0.4, hash11(col.y * 13.7 + floor(yX / colP)))) * steep + 9.0 * (1.0 - steep));
    float dJoint = mix(dSed, dBas, kind);
    float blockId = mix(fract(blockSed * 0.123 + blockM * 0.371), col.y, kind);
    // flats of sedimentary rock: desiccation-like jointing on the bed tops, in rounded warped cells
    vec3 flatJ = steep < 0.99 ? cells(P.xz * 0.45 + 5.3 + (nm.rg - 0.5) * 0.45 + pen.ba * 0.22) : vec3(9.0, 0.5, 1.0);
    dJoint = mix(dJoint, mix(flatJ.x / 0.45, dC, kind), 1.0 - steep);
    blockId = mix(blockId, mix(flatJ.y, col.y, kind), step(steep, 0.5));
    // joints are anti-aliased against their own screen-space width; the width swells and thins
    // along each joint like a pen line
    float jwid = (mix(0.05, 0.035, kind) + 0.04 * hash11(blockId * 9.7)) * (0.55 + 0.9 * clamp(nu.g + (nj.r - 0.5) * 0.6 * fineF, 0.0, 1.0));
    // the pixel footprint (dJoint is a distance in metres; its own fwidth spikes at the seams)
    float jfw = max(px * 1.2, 1e-4);
    float jointK = mesoF * smoothstep(0.35, 0.05, jfw);
    // drawn at its true width: a crack thinner than a pixel only darkens by the pixel it covers
    // (a crack thinner than ~1.5 px is drawn 1.5 px wide and proportionally fainter: no dotted lines)
    float jEff = max(jwid, jfw * 1.5);
    float joint = (1.0 - smoothstep(jEff * 0.45, jEff, dJoint)) * (jwid / jEff) * jointK;
    // the joint's broken shoulders: a shallow groove each side of the crack
    float shoulder = (1.0 - smoothstep(jwid, jwid * 5.0 + 0.25, dJoint)) * jointK;
    heightB -= joint * 0.25 + shoulder * 0.05;
    crevice = max(crevice, max(joint, shoulder * 0.45));
    // each block is its own tilted plane (chiselled, sharp edged), its own tone and weathering
    vec2 tilt = vec2(hash11(blockId * 17.3), hash11(blockId * 29.1)) * 2.0 - 1.0;
    facetOff = (tU * tilt.x * mix(0.3, 0.55, kind) + vec3(0.0, 1.0, 0.0) * tilt.y * 0.22) * steep * mesoF + vec3(tilt.x, 0.0, tilt.y) * 0.3 * (1.0 - steep) * mesoF;
    rock *= mix(1.0, 0.86 + 0.28 * blockId, mesoF);
    rock = mix(rock, rock * mix(vec3(1.06, 0.98, 0.9), vec3(0.93, 0.97, 1.05), hash11(blockId * 9.1)), 0.5 * mesoF);
    // fresh rockfall scars: a few blocks recently fallen away, paler and unweathered
    float scar = step(0.9, hash11(blockId * 41.3)) * steep * smoothstep(6.0, 12.0, P.y) * mesoF;
    rock = mix(rock, mix(vec3(luma(rock)), rock, 0.6) * 1.32 + vec3(0.03, 0.025, 0.015), scar * 0.55);

    // ---- edge wear: convex lips (geometry) and block edges along the joints, chipped pale ----
    float lip = smoothstep(jwid * 1.2, jwid * 2.5 + 0.06, dJoint) * (1.0 - smoothstep(jwid * 3.0 + 0.1, jwid * 6.0 + 0.3, dJoint)) * jointK;
    wear = clamp(edgeW * (0.6 + 0.6 * nm.b) + lip * 0.2 * (0.5 + nu.g), 0.0, 1.0);
    rock = mix(rock, mix(rock, vec3(luma(rock)), 0.35) * 1.38, wear * 0.55);

    // ---- weathering: rain streaks down the faces, rust seeps below joints, salt crust ----
    // (the streaks meander a little as they run down, never ruled vertical hatching)
    float sWob = (nm.r - 0.5) * 0.12 + pen.b * 0.05;
    float streakA = texture2D(uNoise, vec2(P.z / 7.0 + sWob, P.y / 75.0)).b;
    float streakB = texture2D(uNoise, vec2(P.x / 7.0 + 0.5 + sWob, P.y / 75.0)).b;
    streak = ax.x * streakA + ax.y * streakB;
    float streak2 = ax.x * texture2D(uNoise, vec2(P.z / 2.3, P.y / 30.0)).r + ax.y * texture2D(uNoise, vec2(P.x / 2.3, P.y / 30.0)).r;
    float stain = smoothstep(0.5, 0.78, streak) * steep * (1.0 - scar * 0.8);
    rock *= 1.0 - stain * mix(0.36, 0.2, kind);
    rock = mix(rock, rock * vec3(1.16, 0.92, 0.76), smoothstep(0.58, 0.78, streak2) * steep * sed * 0.55);
    // pale salt and guano streaks running down from the high ledges of the stacks
    float guano = smoothstep(0.72, 0.9, streak2) * smoothstep(0.5, 0.2, streak) * smoothstep(18.0, 40.0, P.y) * steep;
    rock = mix(rock, vec3(0.78, 0.76, 0.7), guano * 0.45 * mesoF);
    // calcite veins: thin pale seams cutting across the beds (sedimentary)
    float vn = (ax.x * texture2D(uNoise, vec2(P.z, P.y) / 13.0 + 0.21).a + ax.y * texture2D(uNoise, vec2(P.x, P.y) / 13.0 + 0.63).a) * steep + texture2D(uNoise, P.xz / 13.0).a * (1.0 - steep);
    float vfw = max(px / 13.0 * 1.5, 1e-5);
    float vein = (1.0 - smoothstep(0.002, 0.002 + vfw * 1.2, abs(vn - 0.5))) * smoothstep(0.68, 0.8, nM.g) * sed * fineF * smoothstep(0.02, 0.005, vfw) * smoothstep(4.0, 7.0, P.y);
    rock = mix(rock, mix(rock, vec3(0.84, 0.82, 0.76), 0.6), vein * 0.5);

    // ---- micro: mineral grain, pitting (vesicles on basalt), fine cracks ----
    float grain = texture2D(uNoise, (ax.x * P.zy + ax.y * P.xy) * steep / 0.37 + P.xz * (1.0 - steep) / 0.37).b;
    rock *= 1.0 + (grain - 0.5) * 0.22 * microF + (micro - 0.5) * 0.12 * fineF;
    // vesicles: small gas pits in the basalt (close up only; sedimentary rock stays unpitted)
    float pits = kind * microF > 0.01 ? smoothstep(0.66, 0.9, texture2D(uNoise, (ax.x * P.zy + ax.y * P.xy) * steep / 0.45 + P.xz * (1.0 - steep) / 0.45 + 0.5).g) * kind : 0.0;
    rock *= 1.0 - pits * 0.3 * microF;
    heightB -= pits * 0.03 * microF;
    // hairline cracks: short branches off the joints into the blocks (only where they resolve)
    // (warped cells: the cracks wander; their width swells and thins and they fade out in strokes)
    vec3 hc = microF * steep > 0.01 ? cells(vec2(uF, P.y * 0.6) * 1.7 + nm.rg + pen.gr * 0.9 + (nj.ba - 0.5) * 0.35) : vec3(9.0, 0.0, 1.0);
    float hcW = 0.012 * (0.4 + 1.2 * nj.g);
    float hcw = hcW / max(px * 1.7, 1e-4);
    float crack = (1.0 - smoothstep(0.0, hcW * 2.5 + px * 1.7, hc.x / 1.7)) * min(1.0, hcw) * smoothstep(0.5, 0.75, nu.r + (nj.r - 0.5) * 0.3) * step(0.45, hc.y) * steep * microF;
    rock *= 1.0 - crack * 0.4;
    heightB -= crack * 0.05;

    // ---- life on the rock: lichen rosettes on the faces, moss in the crevices and on ledges ----
    vec3 lc = fineF > 0.01 && P.y > 4.5 ? cells(P.xz * 1.6 + P.y * 0.9 + nm.rg * 0.5) : vec3(9.0, 0.0, 1.0);
    float rose = smoothstep(0.42, 0.22, lc.z + (nu.g - 0.5) * 0.3) * step(0.6, lc.y);
    float lichen = rose * smoothstep(0.55, 0.85, nm.g) * smoothstep(4.5, 9.0, P.y) * fineF;
    vec3 lichenCol = lc.y > 0.9 ? vec3(0.72, 0.4, 0.15) : lc.y > 0.75 ? vec3(0.64, 0.62, 0.36) : vec3(0.66, 0.66, 0.6);
    lichenCol *= 0.8 + 0.4 * smoothstep(0.2, 0.42, lc.z); // darker centre, pale growing rim
    rock = mix(rock, lichenCol, lichen * 0.6 * (1.0 - kind * 0.4));
    float damp = smoothstep(0.35, 0.75, nm.a + (1.0 - cav) * 0.4);
    float mossW = smoothstep(0.5, 0.85, N0.y + (nm.a - 0.5) * 0.6) * (1.0 - meadowIn) * smoothstep(3.0, 7.0, P.y);
    mossW = max(mossW, smoothstep(0.75, 0.35, cav) * smoothstep(4.0, 8.0, P.y) * 0.6);
    mossW = max(mossW, crevice * damp * smoothstep(3.5, 7.0, P.y) * (1.0 - kind * 0.5) * 0.9);
    vec3 mossC = uMossColor * (0.7 + 0.5 * nm.b) * mix(vec3(1.0), vec3(0.85, 1.05, 0.8), crevice);
    rock = mix(rock, mossC, clamp(mossW, 0.0, 1.0) * 0.72);
    // dirt and darkness deep in the cracks
    rock *= 1.0 - crevice * 0.38 * (1.0 - mossW * 0.5);

    // ---- intertidal zone: black lichen band, barnacles, mussels, wet algae, coralline ----
    float yN = P.y + (nm.r - 0.5) * 1.4 + (streak - 0.5) * 0.8;
    float splash = 1.4 + uSeaState * 4.5;
    splashZ = splash;
    wet = smoothstep(splash + 1.2, splash - 0.6, yN);
    float blackZone = smoothstep(splash + 3.6, splash + 1.4, yN) * (1.0 - wet);
    barnZone = smoothstep(1.7, 0.9, yN) * smoothstep(-0.4, 0.4, yN);
    algae = smoothstep(0.5, -0.1, yN) * smoothstep(-2.5, -0.6, yN);
    rock *= 1.0 - blackZone * 0.45 * (0.6 + 0.4 * streak);
    // wet rock: water fills the pores, so it darkens and its colour deepens (not a grey wash)
    vec3 wetRock = rock * vec3(0.5, 0.52, 0.55);
    wetRock = max(mix(vec3(luma(wetRock)), wetRock, 1.3), vec3(0.0));
    rock = mix(rock, wetRock, wet * 0.85);
    if (barnZone > 0.01 && microF > 0.01) {
      // barnacles: little volcano shells with a dark opening, crowded in the cracks
      vec4 bc = stones(vec2(uF, P.y) * 11.0 * steep + P.xz * 11.0 * (1.0 - steep));
      float br = 0.28 + 0.14 * bc.w;
      float occ = step(0.3 - crevice * 0.3, hash11(bc.w * 31.7)) * barnZone;
      float shell = smoothstep(br, br * 0.8, bc.z) * occ * microF;
      float hole = smoothstep(br * 0.38, br * 0.22, bc.z) * shell;
      rock = mix(rock, vec3(0.6, 0.58, 0.52) * (0.85 + 0.3 * bc.w), shell * 0.85);
      rock = mix(rock, vec3(0.08, 0.08, 0.08), hole * 0.9);
      heightB += (shell * (1.0 - bc.z / br) * 0.05 - hole * 0.04) * microF;
      // mussel beds: blue-black shells in the lower barnacle zone
      vec4 mc = stones(vec2(uF * 1.8, P.y * 3.4) * 2.4 * steep + P.xz * 4.0 * (1.0 - steep));
      float mus = smoothstep(0.55, 0.38, mc.z) * smoothstep(0.75, 0.3, yN) * smoothstep(0.55, 0.85, nm.g) * microF;
      rock = mix(rock, vec3(0.05, 0.06, 0.09) * (0.8 + 0.6 * smoothstep(0.3, 0.0, mc.z)), mus * 0.9);
      heightB += mus * (0.55 - mc.z) * 0.06;
    }
    rock = mix(rock, vec3(0.1, 0.16, 0.07) * (0.8 + 0.4 * nm.g), algae * 0.78);
    // below the waterline: encrusting coralline pinks and green film
    float sub = smoothstep(-0.8, -2.5, P.y);
    vec3 subCol = mix(vec3(0.2, 0.24, 0.16), vec3(0.42, 0.24, 0.3), smoothstep(0.55, 0.8, nm.g));
    rock = mix(rock, subCol * (0.7 + 0.5 * nM.b), sub * 0.6 * (1.0 - sandIn));

    // ---- detail normals: blocks' facets, triplanar meso and micro relief ----
    N = normalize(N + facetOff * 0.3);
    vec3 gMeso = triGrad(P, w, 1.0 / 5.5, vec4(0.55, 0.0, 0.0, 0.45));
    N = bendN(N, gMeso, 0.9 * mesoF * (0.5 + 0.5 * steep) * rockVis);
    if (fineF > 0.01) {
      vec3 gMicro = triGrad(P, w, 1.0 / 0.8, vec4(0.0, 0.45, 0.55, 0.0));
      N = bendN(N, gMicro, mix(0.09, 0.13, kind) * fineF * rockVis * (1.0 - wet * 0.7));
    }
    if (microF > 0.01) {
      // grain: sand-sized relief on sedimentary rock, vesicles and rough crystals on basalt
      vec3 gGrain = triGrad(P, w, 1.0 / 0.22, vec4(0.0, 0.5, 0.5, 0.0));
      N = bendN(N, gGrain, 0.025 * microF * rockVis * (1.0 - wet * 0.9));
    }
  }

  vec3 albedo = rock;
  float sandGlint = 0.0;

  // ======================= sand, shingle and pebbles =======================
  if (sandW > 0.001) {
    vec3 sc = mix(mix(uSandLight * 0.8, vColor * 1.12, 0.55), uSandBlack, kind);
    sc *= 0.9 + 0.16 * nM.r + 0.06 * micro;
    // ripples on shallow and beach sand
    vec2 rd = vec2(0.8, 0.6);
    // (crests meander and fork like a hand-drawn ripple, never ruled parallel lines)
    float rip = sin(dot(P.xz, rd) * 2.4 + nm.r * 6.0 + nM.g * 10.0 + (nu.g - 0.5) * 2.4);
    float ripW = smoothstep(2.0, -0.5, P.y) * (0.5 + 0.5 * nm.b) * detail;
    sc *= 1.0 + rip * 0.07 * ripW;
    float sh = rip * 0.25 * ripW + micro * 0.2;
    // shingle: pebble and cobble banks along the top of the beach and at the cliff foot
    float footZ = smoothstep(0.98, 0.6, sandIn);   // where the sand thins out against the rock
    float shingle = smoothstep(0.5, 0.75, nM.b * 0.6 + footZ * 0.7 + kind * 0.3 + (nm.r - 0.5) * 0.3) * smoothstep(-0.6, 0.4, P.y) * smoothstep(3.4, 2.0, P.y);
    if (shingle > 0.01 && fineF > 0.01) {
      // pebbles on the beach, cobbles where the beach meets the cliff foot
      vec4 pb = footZ > 0.5 ? stones(P.xz / 0.85 + 3.7) : stones(P.xz / 0.42);
      float pr = 0.42 + 0.16 * hash11(pb.w * 53.1);
      // each stone is there or not (the shingle mask thins them out), never half transparent
      float there = step(hash11(pb.w * 71.3), shingle * 1.2);
      float peb = smoothstep(pr, pr * 0.84, pb.z) * there;
      vec3 pc = pb.w < 0.3 ? vec3(0.42, 0.42, 0.44) : pb.w < 0.55 ? vec3(0.3, 0.3, 0.32) : pb.w < 0.75 ? vec3(0.55, 0.47, 0.38) : pb.w < 0.9 ? vec3(0.2, 0.2, 0.22) : vec3(0.8, 0.78, 0.74);
      pc = mix(pc, pc * vec3(0.6, 0.6, 0.65), kind * 0.5) * (0.85 + 0.3 * hash11(pb.w * 91.0));
      // rounded: darker toward the rim where it turns away and sits in the sand
      pc *= mix(0.62, 1.0, smoothstep(pr, pr * 0.35, pb.z));
      pc = mix(pc, sc, 0.12);
      // the sand between the stones lies in their shade
      float gap = smoothstep(pr * 1.25, pr, pb.z) * (1.0 - peb) * there;
      sc *= 1.0 - gap * 0.35 * fineF;
      sc = mix(sc, pc, peb * fineF);
      // a domed pebble normal
      vec2 dn = pb.xy / pr;
      vec3 pn = normalize(vec3(dn.x * 1.4, sqrt(max(0.0, 1.0 - min(1.0, dot(dn, dn)))) + 0.3, dn.y * 1.4));
      N = normalize(mix(N, pn, peb * fineF * 0.85 * sandW));
      sh = mix(sh, 0.0, peb);
      crevice = max(crevice, gap * fineF * 0.7 * sandW);
    }
    // wet sand and the swash line
    float wetS = smoothstep(0.9 + uSeaState, 0.2, P.y + (nm.r - 0.5) * 0.5);
    sc = mix(sc, sc * vec3(0.66, 0.68, 0.7), wetS);
    // shell grit and seaweed wrack along the strand line
    float wrack = smoothstep(0.06, 0.0, abs(P.y - 1.1 - uSeaState * 0.8 + (nm.g - 0.5) * 0.6)) * step(0.5, nu.g);
    sc = mix(sc, vec3(0.22, 0.2, 0.14), wrack * 0.5 * detail);
    // dark volcanic sand glints
    sc += kind * vec3(0.5, 0.48, 0.45) * step(0.985, hash12(floor(P.xz * 9.0))) * detail * 0.4;
    albedo = mix(albedo, sc, sandW);
    heightB = mix(heightB, sh, sandW);
    // sparkle: quartz and mica grains flash when their facet mirrors the sun (only where single
    // grains still cover at least a pixel or so; each flash is a soft dot, never a hard speck)
    float spkF = (1.0 - smoothstep(0.012, 0.05, px)) * uDetail;
    if (spkF > 0.01) {
      vec2 gq = P.xz * 9.0;
      vec2 gi = floor(gq);
      vec2 go = hash22(gi + 5.3);
      vec3 gn = normalize(vec3(go.x - 0.5, 1.1, go.y - 0.5));
      vec3 Vg = normalize(uCamPos - P);
      float facet = pow(max(dot(reflect(-Vg, gn), uSunDir), 0.0), 90.0);
      vec2 gd = fract(gq) - (0.25 + go * 0.5);
      float dotR = max(0.07, px * 9.0 * 0.6);
      float spot = smoothstep(dotR, dotR * 0.3, length(gd)) * step(0.55, hash12(gi + 11.7));
      sandGlint = facet * spot * spkF * sandW * (1.0 - kind * 0.4) * (0.6 + 0.4 * (1.0 - wetS));
    }
  }

  // ---------------- tide pools: still water in hollows of the rock platforms ----------------
  float pool = 0.0;
  if (P.y > 0.15 && P.y < 1.9 && N0.y > 0.8) {
    vec3 pc = cells(P.xz / 3.6 + nm.rg * 0.6);
    float rim = smoothstep(0.18, 0.32, pc.x + (nm.b - 0.5) * 0.12);
    pool = rim * step(0.45, pc.y) * smoothstep(0.8, 0.95, N0.y) * (1.0 - sandW) * smoothstep(1.9, 1.2, P.y) * smoothstep(0.15, 0.45, P.y);
    // a ring of green weed and pink coralline at the pool's lip
    float lipW = smoothstep(0.12, 0.2, pc.x) * (1.0 - rim) * step(0.45, pc.y);
    albedo = mix(albedo, mix(vec3(0.08, 0.14, 0.06), vec3(0.5, 0.3, 0.34), step(0.7, nu.r)), lipW * 0.7 * (1.0 - sandW));
  }

  // ---------------- meadow ----------------
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
    // mid-scale life in the meadow (~8 m): sun-warmed yellowing swells, lush cool hollows, and the
    // greener, darker grass in the folds of the ground
    float mv = texture2D(uNoise, wp / 7.5 + 0.13).g;
    g *= 0.9 + 0.2 * mv;
    g = mix(g, g * vec3(1.07, 1.01, 0.82), smoothstep(0.55, 0.85, mv) * 0.55);
    g = mix(g, g * vec3(0.84, 1.0, 1.04), smoothstep(0.45, 0.15, mv) * 0.45);
    g *= mix(0.8, 1.0, smoothstep(0.35, 0.9, cav));
    // wind waves rolling over the meadow (whole multiples of the wrapping wave phase: no jump)
    vec2 wd = normalize(uWind.xz + vec2(1e-3));
    float wave = sin(dot(wp, wd) * 0.08 - uWavePhase + patchA * 5.0);
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

  // ---------------- screen-space bump from the sharp relief (beds, joints, cracks, shells) ----------------
  float bumpAmt = (0.45 + 0.55 * steep) * (1.0 - grassAmt * 0.6);
  vec3 dpdx = dFdx(P), dpdy = dFdy(P);
  float dhx = dFdx(heightB), dhy = dFdy(heightB);
  vec3 r1 = cross(dpdy, N), r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  vec3 Nb = normalize(abs(det) * N - grad * bumpAmt * 0.9);
  if (abs(det) > 1e-8) N = normalize(mix(N, Nb, 0.85));

  Surface s = makeSurface(albedo, N, P);
  s.shadow = sampleShadow(P, N0);
  s.rim = 0.2;
  s.wrap = 0.22;
  s.trans = grassAmt * 0.22;
  float wetAll = max(wet * (1.0 - sandW), smoothstep(0.7, 0.1, P.y) * sandW);
  // fresh splash just above the wet band: glistening runnels down the rock between waves
  float runnel = smoothstep(0.55, 0.75, streak) * smoothstep(splashZ + 2.6, splashZ + 0.4, P.y) * (1.0 - wet) * rockVis;
  // dry rock and sand keep a faint rough sheen; wet rock, weed and the swash a glossy film that
  // mirrors the sky (stylizedLight's wet specular)
  float wetGloss = clamp(wetAll + algae * 0.6 + runnel * 0.7, 0.0, 1.0);
  s.spec = (wetAll * 0.75 + runnel * 0.35) * smoothstep(-0.5, 0.3, P.y) + algae * 0.3 * (1.0 - sandW)
         + 0.05 * (1.0 - wetGloss) * (1.0 - grassAmt);
  s.gloss = mix(0.22, 0.82, wetGloss);
  s.emissive += uSunColor * sandGlint * 1.6 * s.shadow * (1.0 - uNight);
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
  // baked cavity, crevices and joints, the underside of overhangs, grain
  float creviceAO = 1.0 - crevice * 0.55 * (1.0 - grassAmt);
  s.ao = cav * creviceAO * mix(0.72, 1.0, smoothstep(-0.7, 0.5, N.y)) * (0.86 + 0.14 * micro);
  // lava: faint glowing fissures at the foot of forming islands (restrained, natural light only)
  if (heat > 0.01) {
    // fissures between cooling crust plates: lines widened to at least a pixel and dimmed in
    // proportion, so far away they read as a soft glow instead of sparkling dots
    vec3 lc2 = cells(P.xz / 4.2 + nm.rg * 1.5 + vec2(P.y * 0.15) + pen.rg * 0.22);
    float fw = max(fwidth(lc2.x), 1e-4);
    float lw = max(0.07 * (0.5 + nu.b), fw * 1.2);
    float fis = (1.0 - smoothstep(0.0, lw, lc2.x)) * (0.07 / lw) * heat;
    float pulse = 0.75 + 0.25 * sin(uTime * 0.7 + lc2.y * 6.28);
    float foot = smoothstep(14.0, 0.5, P.y);
    float hot = fis * pulse * foot;
    // a dull underglow where the young rock meets the water
    float under = heat * foot * smoothstep(4.0, 0.0, P.y) * 0.25;
    s.emissive += uLava * (hot + under) * (1.4 + 2.0 * uNight);
    s.albedo *= 1.0 - fis * 0.5;
  }
  vec3 outc = stylizedLight(s);
  outc = applyFog(outc, P);
  gl_FragColor = vec4(outc, 1.0);
}
`;

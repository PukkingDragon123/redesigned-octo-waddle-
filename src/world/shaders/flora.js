// Alien flora of Vur Sok. Every plant is made of "chains": a centreline of length L leaving a base
// point at an azimuth and tilt, bent by a curvature profile integrated in the vertex shader. Tubes
// (stalks, tentacles, pipes), flat painted cards (fern pinnae, kelp ribbons, glass fans, grass) and
// camera-facing painted billboards (puffballs, canopy clumps) ride on the same chain, so everything
// moves together: fiddleheads slowly coil and uncoil, anemones close up when a whale passes, kelp
// streams in the wind (and rises with the swell underwater), tubes and bells breathe.
//
// Chain kinds (aB.w): 0 rigid bend, 1 fiddlehead, 2 anemone tentacle, 3 ribbon / kelp, 4 tube /
// bell stalk (breathing), 5 glass fan, 6 puff stalk, 7 grass, 8 hanging vine.
// Parts (aP.x): 0 tube, 1 two-sided card, 2 billboard, 3 bell cap (breathing lathe).
import { UNIFORMS, NOISE, SHADOW, LIGHTING } from '../../render/shaders/common.js';

export const FLORA_VERT = /* glsl */ `
${UNIFORMS}
attribute vec4 aV;    // s (0..1 along the chain), ox (binormal), oy (normal), oz (tangent)
attribute vec4 aA;    // chain base (plant-local), chain length
attribute vec4 aB;    // azimuth, tilt (from vertical, toward the azimuth), curl, kind
attribute vec2 aUV;   // atlas uv (cards / billboards) or (around, s) for tubes
attribute vec2 aP;    // part, flexibility
attribute vec3 aAcc;  // accent colour
#ifdef USE_INSTANCING
attribute vec4 aInst; // phase, hue shift, growth, openness
#endif
uniform vec4 uMovers[12];
uniform vec2 uFade;
uniform vec2 uFadeIn; // impostors appear only beyond this distance band
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vAcc;
varying vec2 vUV;
varying vec4 vInfo;   // part, s, kind, close
varying vec2 vBill;   // billboard local coords (-1..1)

const float TAUF = 6.2831853;

float chainCurv(float u, float kind, float curl, float t, float ph, float close, float under) {
  if (kind < 0.5) return curl;
  if (kind < 1.5) {
    // crozier: curvature grows toward the tip like a logarithmic spiral; slowly coils and uncoils
    float c = curl * (0.62 + 0.38 * (0.5 + 0.5 * sin(t * 0.13 + ph)));
    return c * 3.6 * smoothstep(0.3, 0.55, u) / (1.035 - u);
  }
  if (kind < 2.5) {
    // tentacle: droops outward, curls in and up when something big passes
    return curl * (1.0 - close) - close * 5.5 * (0.3 + u) + 0.35 * sin(t * 1.3 + ph + u * 3.0) * u;
  }
  if (kind < 3.5) {
    // ribbon: flapping wave in the wind; underwater a slow swaying rise
    float air = 0.8 * sin(u * 9.0 - t * 4.6 + ph) * (0.25 + u) + 0.35;
    float wat = 0.55 * sin(u * 5.0 - t * 1.1 + ph) * u;
    return mix(air, wat, under);
  }
  if (kind < 4.5) return curl + 0.06 * sin(t * 0.7 + ph);
  if (kind < 5.5) return curl * 0.2;
  if (kind < 6.5) return curl;
  if (kind < 7.5) return curl * (1.0 + 0.6 * u);
  return 0.0;
}

void main() {
  float s = aV.x;
  float L = aA.w;
  float az = aB.x, tilt = aB.y, curl = aB.z, kind = aB.w;
  float part = aP.x, flex = aP.y;
  float ph = 0.0, hue = 0.0, growth = 1.0, open = 1.0;
  #ifdef USE_INSTANCING
    ph = aInst.x; hue = aInst.y; growth = aInst.z; open = aInst.w;
    mat4 M = modelMatrix * instanceMatrix;
  #else
    mat4 M = modelMatrix;
  #endif
  vec3 base = (M * vec4(aA.xyz, 1.0)).xyz;
  vec3 root = (M * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float sc = length(M[0].xyz);
  // distance fade: plants shrink into their base instead of popping
  float camD = length(uCamPos - root);
  float fade = (1.0 - smoothstep(uFade.x, uFade.y, camD)) * smoothstep(uFadeIn.x, uFadeIn.y, camD);
  float t = uTime;
  ph += aA.x * 0.37 + aA.z * 0.23 + az * 0.5;
  // horizontal bend direction in world space
  vec3 D = normalize(mat3(M) * vec3(cos(az), 0.0, sin(az)) + vec3(1e-5, 0.0, 0.0));
  D.y = 0.0;
  D = normalize(D + vec3(1e-5, 0.0, 0.0));
  float under = smoothstep(0.5, -1.5, base.y);
  // wind (air only): ribbons stream downwind; everything else leans and flutters
  vec2 w2 = uWind.xz;
  float ws = length(w2) * (1.0 - under);
  vec2 wd = ws > 1e-3 ? w2 / length(w2) : vec2(1.0, 0.0);
  if (kind > 2.5 && kind < 3.5) {
    vec3 W = vec3(wd.x, 0.0, wd.y);
    D = normalize(mix(D, W, 0.85 * (1.0 - under)) + vec3(1e-5, 0.0, 0.0));
    tilt = mix(mix(tilt, 1.3, smoothstep(1.0, 6.0, ws)), 0.15, under);
  }
  float par = dot(D.xz, wd), perp = D.x * wd.y - D.z * wd.x;
  float gust = 0.65 + 0.35 * sin(t * 0.9 + ph) + uGust;
  float windBend = par * ws * 0.035 * flex * gust;
  // movers (whales) near the plant
  float close = 0.0;
  if (kind > 1.5 && kind < 2.5) {
    for (int i = 0; i < 12; i++) {
      vec4 m = uMovers[i];
      if (m.w <= 0.0) continue;
      float dd = length(m.xyz - root);
      close = max(close, smoothstep(m.w * 2.6 + 10.0, m.w + 2.0, dd));
    }
    close = max(close, 1.0 - open);
  }
  // integrate the bend along the chain (finer steps toward the tip)
  float ang = tilt;
  vec2 p = vec2(0.0);
  const int N = 14;
  float uPrev = 0.0;
  for (int i = 1; i <= N; i++) {
    float f = float(i) / float(N);
    float u1 = 1.0 - (1.0 - f) * (1.0 - f);
    if (uPrev >= s) break;
    float h = min(u1, s) - uPrev;
    float um = uPrev + h * 0.5;
    float k = chainCurv(um, kind, curl, t, ph, close, under) + windBend * (0.5 + um)
            + flex * 0.06 * sin(t * 2.1 + ph * 3.0 + um * 4.0) * (0.3 + ws * 0.08) * um;
    float a = ang + k * h * 0.5;
    p += vec2(sin(a), cos(a)) * h * L;
    ang += k * h;
    uPrev = u1;
  }
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 T = D * sin(ang) + up * cos(ang);
  vec3 Nn = D * cos(ang) - up * sin(ang);
  vec3 B = normalize(cross(up, D));
  float g = growth * fade;
  vec3 P = base + (D * p.x + up * p.y) * sc;
  // out-of-plane flutter downwind
  P += B * (perp * ws * 0.02 * flex * s * s * L * gust) * sc;
  vec3 ofs = aV.y * B + aV.z * Nn + aV.w * T;
  // breathing: tubes swell in a slow wave travelling up; bells pulse
  if (kind > 3.5 && kind < 4.5) ofs *= 1.0 + 0.13 * sin(t * 1.25 + ph - s * 4.0);
  if (part > 2.5) ofs *= 1.0 + 0.1 * sin(t * 1.25 + ph - 3.0);
  vec3 nrm;
  vBill = vec2(0.0);
  if (part > 1.5 && part < 2.5) {
    // camera-facing painted billboard at the chain point
    vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    P += (camR * aV.y + camU * aV.z) * sc;
    nrm = normalize(uCamPos - P);
    vBill = vec2(sign(aV.y), sign(aV.z));
  } else {
    P += ofs * sc;
    nrm = part > 0.5 && part < 1.5 ? Nn : normalize(aV.y * B + aV.z * Nn + aV.w * T * 0.4 + 1e-5);
  }
  P = root + (P - root) * g;
  vWorldPos = P;
  vNormal = nrm;
  #ifdef USE_COLOR
    vColor = color;
  #else
    vColor = vec3(1.0);
  #endif
  // per-instance hue drift (cheap: rotate toward the accent)
  vColor = mix(vColor, vColor.gbr * 0.9 + vColor * 0.1, clamp(hue, 0.0, 1.0) * 0.35);
  vAcc = aAcc;
  vUV = aUV;
  vInfo = vec4(part, s, kind, close);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}
`;

export const FLORA_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
uniform sampler2D uAtlas;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vAcc;
varying vec2 vUV;
varying vec4 vInfo;
varying vec2 vBill;

void main() {
  float part = vInfo.x, s = vInfo.y, kind = vInfo.z, close = vInfo.w;
  vec4 tex = vec4(0.7, 0.0, 0.5, 1.0);
  float alpha = 1.0;
  if (part > 0.5 && part < 2.5) {
    tex = texture2D(uAtlas, vUV);
    // mipmapped alpha thins out with distance (thin fronds vanish, leaving bare stems): restore the
    // coverage in proportion to the mip level being sampled
    vec2 tuv = vUV * 2048.0;
    vec2 tdx = dFdx(tuv), tdy = dFdy(tuv);
    float mip = max(0.0, 0.5 * log2(max(dot(tdx, tdx), dot(tdy, tdy)) + 1e-8));
    tex.a = min(1.0, tex.a * (1.0 + mip * 0.28));
    #ifdef DEPTH_PASS
      if (tex.a < 0.45) discard;
      gl_FragColor = vec4(1.0);
      return;
    #endif
    // keep painted edges crisp but soft at any mip (alpha-to-coverage friendly)
    alpha = clamp((tex.a - 0.42) / max(fwidth(tex.a), 1e-4) + 0.5, 0.0, 1.0);
    if (alpha < 0.01) discard;
  } else {
    #ifdef DEPTH_PASS
      gl_FragColor = vec4(1.0);
      return;
    #endif
    // tubes: procedural growth bands and spots
    float around = vUV.x;
    float band = 0.5 + 0.5 * sin(s * 42.0);
    float fib = vnoise(vec2(vUV.x * 14.0, s * 3.0));
    tex.r = 0.6 + 0.18 * band * (0.5 + 0.5 * fib) + 0.12 * fib;
    if (kind > 1.5 && kind < 2.5) tex.g = smoothstep(0.35, 0.65, fract(s * 5.0 + 0.25)) * 0.55 + smoothstep(0.86, 1.0, s);
    else if (kind > 0.5 && kind < 1.5) tex.g = smoothstep(0.75, 1.0, s) * 0.7;
    else tex.g = smoothstep(0.9, 1.0, s) * 0.9 + step(0.86, hash12(floor(vec2(vUV.x * 8.0, s * 18.0)))) * 0.25;
    if (part > 2.5) tex.g = smoothstep(0.55, 1.0, vUV.y);
    // inside an open pipe or bell: deep shade
    if (!gl_FrontFacing) tex.r *= 0.35;
  }
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  if (part > 1.5 && part < 2.5) {
    // billboard: bent spherical normal from the painted volume
    vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec2 q = vBill * 0.85;
    float z = sqrt(max(0.0, 1.0 - dot(q, q))) + tex.b * 0.4;
    N = normalize(camR * q.x + camU * q.y + V * z);
  } else {
    if (dot(N, V) < 0.0) N = -N;
    if (part > 0.5) N = normalize(N + (V * 0.35) + (tex.b - 0.5) * 0.3 * N);
  }
  vec3 albedo = vColor * (0.5 + 0.75 * tex.r);
  albedo = mix(albedo, vAcc * (0.7 + 0.5 * tex.r), clamp(tex.g, 0.0, 1.0) * 0.85);
  albedo *= mix(0.62, 1.05, smoothstep(0.0, 0.6, s));
  Surface srf = makeSurface(albedo, N, vWorldPos);
  srf.shadow = sampleShadow(vWorldPos, N);
  srf.trans = part > 0.5 ? 0.85 : 0.45;
  srf.wrap = 0.32;
  srf.rim = 0.4;
  srf.ao = mix(0.6, 1.0, smoothstep(0.0, 0.5, s)) * (0.85 + 0.15 * tex.b);
  if (kind > 4.5 && kind < 5.5) {
    // glassy fans: iridescent film, a sharp glint
    float fr = pow(1.0 - abs(dot(N, V)), 2.0);
    srf.albedo += (0.5 + 0.5 * cos(6.2831 * (fr * 1.4 + vec3(0.0, 0.33, 0.67)))) * 0.22 * fr;
    srf.spec = 0.7;
    srf.gloss = 0.92;
    srf.trans = 1.1;
  }
  // a faint natural bioluminescence at night in tentacle tips and tube rims
  float glow = (kind > 1.5 && kind < 2.5 ? smoothstep(0.8, 1.0, s) : 0.0) + (kind > 3.5 && kind < 4.5 ? smoothstep(0.92, 1.0, s) : 0.0);
  srf.emissive = vAcc * glow * uNight * 0.55 * (1.0 - close * 0.6);
  vec3 col = stylizedLight(srf);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, alpha);
}
`;

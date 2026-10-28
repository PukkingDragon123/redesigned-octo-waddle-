// Shared GLSL for the wildlife of Vur Sok: orientation helpers, the light field a creature sees
// (under the sea: the water's own glow, Snell's window and the refracted sun; in air: the sky and
// the sea), thin-film iridescence, overlapping fish scales and feather / membrane helpers.
// Everything is lit by the shared stylizedLight() and fogged by applyFog() (which also handles the
// water column, caustics and the underwater view) from render/shaders/common.js.

export const ECO_GLSL = /* glsl */ `
#ifndef ECO_GLSL_DONE
#define ECO_GLSL_DONE
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
// rotate v about a unit axis
vec3 rotAxis(vec3 v, vec3 ax, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(ax, v) * s + ax * dot(ax, v) * (1.0 - c);
}
// Orthonormal basis (columns: right, up, forward) from a forward direction, with a roll.
mat3 basisFromFwd(vec3 f, float roll) {
  vec3 X = cross(vec3(0.0, 1.0, 0.0), f);
  float lx = length(X);
  X = lx > 1e-4 ? X / lx : vec3(1.0, 0.0, 0.0);
  vec3 Y = cross(f, X);
  float c = cos(roll), s = sin(roll);
  return mat3(X * c + Y * s, Y * c - X * s, f);
}
#endif
`;

/** Vertex stage: projected size (px) of a world length at view depth z. */
export const ECO_VERT = /* glsl */ `
float projPx(float size, float viewZ) {
  return size * projectionMatrix[1][1] * uResolution.y * 0.5 / max(viewZ, 0.01);
}
`;

/**
 * Fragment helpers. Needs UNIFORMS, NOISE, LIGHTING and SEA (skyEnv) from common.js.
 */
export const ECO_FRAG = /* glsl */ `
// Thin-film iridescence (guanine platelets, feather barbules): a hue that walks with the angle.
vec3 iridescence(float cosT, float thick) {
  float d = thick * mix(1.0, 1.7, 1.0 - clamp(cosT, 0.0, 1.0));
  return 0.5 + 0.5 * cos(6.2831853 * (d * vec3(1.0, 1.13, 1.29) + vec3(0.0, 0.22, 0.43)));
}

// What a mirror at P sees along R. Under the sea: the light field of the water (very bright
// overhead, falling steeply toward the horizon and dark below: this is what gives silver fish
// their form), the sky compressed into Snell's window with its bright rim, and the refracted
// sun. In air: the sky above and the sea below. inAir 0..1.
vec3 seaLightField(vec3 R, float inAir) {
  vec3 col = vec3(0.0);
  if (inAir < 0.999) {
    float u = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);
    // radiance relative to the horizontal view (which is what the water behind a fish shows)
    float k = 0.06 + 0.42 * smoothstep(0.0, 0.5, u) + 3.4 * pow(smoothstep(0.45, 1.0, u), 2.2);
    vec3 w = uWaterTint * k;
    float win = smoothstep(0.6, 0.72, R.y);
    vec3 sky = mix(uSkyHorizon, uSkyZenith, smoothstep(0.72, 1.0, R.y)) * 0.75 + uSkyAmbient * 0.2;
    vec3 sr = -waterSunRefract();
    float sunUp = smoothstep(-0.05, 0.25, uSunDir.y) * (1.0 - uStorm * 0.8);
    float cs = max(dot(R, sr), 0.0);
    float g = pow(cs, 140.0) * 3.0 + pow(cs, 14.0) * 0.3;
    // the bright rim of Snell's window (the whole horizon squeezed into a ring)
    float ring = exp(-pow((R.y - 0.67) * 16.0, 2.0)) * 0.5;
    vec3 under = w + (sky * win + mix(uFogColor, uSkyHorizon, 0.5) * ring) * 0.45 + uSunColor * g * sunUp;
    under += uMoonColor * pow(max(dot(R, uMoonDir), 0.0), 60.0) * uNight * 2.0 * win;
    col = under * (1.0 - inAir);
  }
  if (inAir > 0.001) {
    vec3 a = R.y > 0.0 ? skyEnv(R, 1.5) : mix(uSeaBody * 2.5, skyEnv(vec3(R.x, -R.y, R.z), 2.5) * 0.35, 0.35);
    col += a * inAir;
  }
  return col;
}

// Overlapping fish scales. p in scale units (x toward the tail, y around the body).
// Returns x: distance to the visible scale's rim (0 centre .. 1 rim), y: per-scale hash,
// zw: offset from that scale's centre (for the bump).
vec4 fishScales(vec2 p) {
  float ry = floor(p.y + 0.5);
  float bestX = 1e9;
  vec2 bc = vec2(0.0);
  float bd = 1.0;
  for (int j = -1; j <= 1; j++) {
    float row = ry + float(j);
    float off = 0.5 * mod(row, 2.0);
    float kx = floor(p.x - off + 0.5);
    for (int i = -1; i <= 1; i++) {
      vec2 c = vec2(kx + float(i) + off, row);
      // scales are not a perfect lattice
      c += (hash22(c + 3.1) - 0.5) * 0.18;
      vec2 d = p - c;
      float dist = length(d * vec2(1.0, 1.1));
      // the most anterior scale covering the point is on top (scales overlap like roof tiles)
      if (dist < 0.74 && c.x < bestX) { bestX = c.x; bc = c; bd = dist / 0.74; }
    }
  }
  return vec4(bd, hash12(bc + 17.0), p - bc);
}
`;

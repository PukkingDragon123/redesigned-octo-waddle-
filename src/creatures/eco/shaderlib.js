// Shared GLSL helpers and colour palettes for the sky ecosystem (krill, rays, jellies,
// puffbirds, plankton). All creature materials are built from the common chunks in
// render/shaders/common.js and lit with stylizedLight + applyFog like everything else.
import { Color } from 'three';

export const ECO_GLSL = /* glsl */ `
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
// Orthonormal basis (columns: right, up, forward) from a forward direction, with a roll.
mat3 basisFromFwd(vec3 f, float roll) {
  vec3 X = cross(vec3(0.0, 1.0, 0.0), f);
  float lx = length(X);
  X = lx > 1e-4 ? X / lx : vec3(1.0, 0.0, 0.0);
  vec3 Y = cross(f, X);
  float c = cos(roll), s = sin(roll);
  return mat3(X * c + Y * s, Y * c - X * s, f);
}
`;

/** Vertex-stage only: projected size in pixels of a world-space length at view depth z. */
export const ECO_VERT_GLSL = /* glsl */ `
float projPx(float size, float viewZ) {
  return size * projectionMatrix[1][1] * uResolution.y * 0.5 / max(viewZ, 0.01);
}
// Camera-facing strip expansion for thin parts (tails, ribbons, tentacles). Returns the
// world offset for a vertex at P with tangent T and half-width hw (m). Thin parts are widened
// to at least minPx pixels and the lost coverage is returned in cov (for alpha / coverage).
vec3 stripOffset(vec3 P, vec3 T, float hw, float side, float minPx, out float cov, out vec3 across) {
  vec3 V = normalize(uCamPos - P);
  vec3 S = cross(T, V);
  float ls = length(S);
  S = ls > 1e-5 ? S / ls : vec3(1.0, 0.0, 0.0);
  across = S;
  float vz = max(-(viewMatrix * vec4(P, 1.0)).z, 0.01);
  float px = hw * projectionMatrix[1][1] * uResolution.y * 0.5 / vz;
  float k = max(1.0, minPx / max(px, 1e-5));
  cov = 1.0 / k;
  return S * hw * k * side;
}
`;

const C = (hex) => new Color(hex);

/** Krill: pastel translucent bodies, deeper gut tint; bioluminescent spot is blue-green. */
export const KRILL_PALETTES = [
  { body: C('#f6a892'), gut: C('#dc5f4b') }, // peach coral
  { body: C('#f3a6c0'), gut: C('#d4607f') }, // rose
  { body: C('#c6b0f2'), gut: C('#8667cf') }, // lilac
  { body: C('#a2e2d2'), gut: C('#4cb29b') }, // sea mint
]
export const KRILL_GLOW = C('#7ff2df');

/** Sky rays: dorsal colour, belly, wing-membrane margin, ribbon accent, marking colour. */
export const RAY_PALETTES = [
  { top: C('#2f4a68'), belly: C('#f2eee6'), margin: C('#6f8fb4'), ribbon: C('#ffb08f'), mark: C('#c3d6ea') }, // dusk blue
  { top: C('#4a4170'), belly: C('#f4eef2'), margin: C('#8a7fb8'), ribbon: C('#ffa6c0'), mark: C('#d6cdee') }, // plum
  { top: C('#30545c'), belly: C('#f1eee4'), margin: C('#6f979b'), ribbon: C('#ffcf94'), mark: C('#c7ded9') }, // sea slate
  { top: C('#5a4a60'), belly: C('#f6eee8'), margin: C('#9b829e'), ribbon: C('#f5c2df'), mark: C('#e6d3e0') }, // mauve
]

/** Sky jellies: membrane tint, deeper margin tint, core organ, faint night glow. */
export const JELLY_PALETTES = [
  { mem: C('#e7d6ff'), margin: C('#b49be6'), core: C('#efc3d8'), glow: C('#a89bff') },
  { mem: C('#d2f2f4'), margin: C('#84c6d6'), core: C('#f5d6bb'), glow: C('#7fe6e0') },
  { mem: C('#ffe0d6'), margin: C('#eda7a0'), core: C('#f9e1bd'), glow: C('#ffb38a') },
  { mem: C('#e4f4dc'), margin: C('#9dcca2'), core: C('#f1ccd2'), glow: C('#a6f0c2') },
]

/** Puffbirds: body, breast, cap, wing. */
export const BIRD_PALETTES = [
  { body: C('#f4ead9'), breast: C('#f6bf9f'), cap: C('#7f91b6'), wing: C('#97a3c2') }, // cream, peach breast, slate cap
  { body: C('#d8e7f4'), breast: C('#fffaf2'), cap: C('#6a8abb'), wing: C('#849fca') }, // pale sky
  { body: C('#efdacd'), breast: C('#efa9a4'), cap: C('#9c8077'), wing: C('#b49a90') }, // rose sand
  { body: C('#e5dcee'), breast: C('#f8efe2'), cap: C('#8676a6'), wing: C('#a295bd') }, // lilac
]

export const PLANKTON_GLOW = [C('#86f5e0'), C('#a9c8ff'), C('#c4f7a6')];

/** Pack a palette list into flat uniform arrays: { key: Color[] }. */
export function paletteUniforms(list, keys) {
  const out = {};
  for (const k of keys) out[k] = list.map((p) => p[k].clone());
  return out;
}

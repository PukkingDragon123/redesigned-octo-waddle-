// Shared GLSL for the painterly passes (self-contained: nothing here depends on common.js).
//
// Conventions: GL view space (x right, y up, the camera looks down -z). "z" in these helpers is
// the positive distance along the view axis in metres. uv is the 0..1 screen position with
// y up (gl_FragCoord / size), exactly what the fullscreen triangle's vUv gives.

/** View-space reconstruction from a standard (non-reversed, non-log) perspective depth buffer. */
export const VIEW = /* glsl */ `
uniform vec4 uProj;      // P00, P11, P20, P21 (three's projectionMatrix.elements 0, 5, 8, 9)
uniform vec2 uDepthLin;  // P22, P32 (elements 10, 14)
float linZ(float d) { return uDepthLin.y / (d * 2.0 - 1.0 + uDepthLin.x); }
vec3 viewPos(vec2 uv, float z) {
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3((ndc.x + uProj.z) * z / uProj.x, (ndc.y + uProj.w) * z / uProj.y, -z);
}
`;

/**
 * The visible surface along a pixel ray. The ocean is drawn in the transparent pass and never
 * writes depth, so the opaque depth of a sea pixel is the sea floor or the sky; the flat sea plane
 * stands in for it (waves are a few metres: plenty for depth of field and filter strength).
 * Needs VIEW.
 */
export const SURFACE = /* glsl */ `
uniform mat4 uViewInv;   // camera.matrixWorld
uniform vec3 uCamPos;
uniform float uSeaY;
uniform float uSeaOn;
const float SKY_Z = 1.0e6;
float surfaceZ(vec2 uv, float zOpaque) {
  if (uSeaOn < 0.5) return zOpaque;
  vec3 dw = mat3(uViewInv) * viewPos(uv, 1.0);   // world displacement per metre of view depth
  float h = uSeaY - uCamPos.y;
  if (dw.y * h <= 0.0) return zOpaque;
  return min(zOpaque, h / dw.y);
}
// opaque depth sample -> view depth of what the eye sees (sky: SKY_Z)
float sceneZ(vec2 uv, float d) {
  float z = d >= 1.0 ? SKY_Z : linZ(d);
  return surfaceZ(uv, z);
}
`;

export const HASH = /* glsl */ `
float pHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float pIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float pNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash12(i), pHash12(i + vec2(1.0, 0.0)), u.x), mix(pHash12(i + vec2(0.0, 1.0)), pHash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/**
 * Circle of confusion in half-resolution pixels: positive for the far field (and the tilt-shift
 * bands, which blur like the far field), negative for the near field. Needs VIEW and SURFACE.
 * A thin-lens-like model: blur grows with |1 - focus / z| and saturates toward infinity.
 */
export const COC = /* glsl */ `
uniform vec4 uDofA;   // x focus distance (m), y sharp zone (fraction of focus), z far max CoC (half px), w near max CoC (half px)
uniform vec4 uDofB;   // x tilt-shift CoC (half px), y tilt centre (uv.y), z tilt half-band (uv), w autofocus on
uniform vec2 uDofC;   // x far ramp (relative), y near ramp (relative)
uniform sampler2D tFocus;
float dofFocus() {
  return uDofB.w > 0.5 ? max(texture(tFocus, vec2(0.5)).r, 0.5) : uDofA.x;
}
float cocFromZ(vec2 uv, float z, float focus) {
  float k = 1.0 - focus / max(z, 1e-3);              // 0 at focus, ->1 at infinity, negative when near
  float sharp = uDofA.y;
  float far = clamp((k - sharp) / max(uDofC.x, 1e-3), 0.0, 1.0);
  float nearK = (focus / max(z, 1e-3) - 1.0);           // 0 at focus, grows toward the lens
  float near = clamp((nearK - sharp) / max(uDofC.y, 1e-3), 0.0, 1.0);
  float tilt = uDofB.x * smoothstep(uDofB.z, uDofB.z + 0.32, abs(uv.y - uDofB.y));
  float cf = max(far * far * (3.0 - 2.0 * far) * uDofA.z, tilt);
  float cn = near * near * (3.0 - 2.0 * near) * uDofA.w;
  return cf >= cn ? cf : -cn;
}
`;

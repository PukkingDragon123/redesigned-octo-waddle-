// GLSL shared by the skin baker and the runtime skin shader, so the throat pleats the baker
// carves are the same pleats that open when the bellows inflate.
export const PLEATS = /* glsl */ `
// Ventral throat pleats (chin to navel). Returns x: groove 0..1 (1 at a groove floor),
// y: band mask 0..1, z: pleat index. s, t canonical loft parameters; n grooves across the band.
vec3 pleatAt(float s, float t, float n, float t0, float t1) {
  float sb = s < 0.5 ? s : 1.0 - s;       // 0 belly midline .. 0.5 dorsal midline
  float sg = s < 0.5 ? 1.0 : -1.0;
  float bandMax = mix(0.13, 0.235, smoothstep(t0 + 0.02, t0 + 0.26, t)) * (1.0 - 0.25 * smoothstep(0.93, 0.99, t));
  float band = 1.0 - smoothstep(bandMax * 0.86, bandMax, sb);
  float x = sb / bandMax * n * 0.5;
  float idx = floor(x) * sg;
  float f = fract(x);
  float groove = smoothstep(0.42, 0.0, abs(f - 0.5) - 0.06);
  // each pleat ends at its own place near the navel; the outer ones end sooner
  float h = fract(sin(idx * 12.9898 + 4.1) * 43758.5453);
  float tEnd = t0 + 0.01 + h * 0.05 + (sb / bandMax) * 0.09;
  band *= smoothstep(tEnd, tEnd + 0.03, t) * (1.0 - smoothstep(t1 - 0.02, t1, t));
  return vec3(groove, band, idx);
}
`;

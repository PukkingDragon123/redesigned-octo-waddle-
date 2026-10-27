// Global uniforms shared (by reference) across every material in the game.
// Atmosphere.js writes lighting values, Shadows.js writes the shadow data, Wind.js the wind.
import { Vector2, Vector3, Vector4, Color, Matrix4 } from 'three';

export const G = {
  uTime: { value: 0 },
  uCamPos: { value: new Vector3() },
  uResolution: { value: new Vector2(1, 1) },
  uNearFar: { value: new Vector2(0.5, 16000) },

  // Lighting
  uSunDir: { value: new Vector3(0.2, 0.4, -1).normalize() },
  uSunColor: { value: new Color(3, 2.8, 2.5) },
  uSkyZenith: { value: new Color(0.1, 0.3, 0.8) },
  uSkyHorizon: { value: new Color(0.6, 0.75, 0.9) },
  uSkyAmbient: { value: new Color(0.5, 0.6, 0.8) },
  uBounce: { value: new Color(0.6, 0.6, 0.6) },
  uShadowTint: { value: new Color(0.55, 0.6, 0.85) },
  uFogColor: { value: new Color(0.6, 0.7, 0.85) },
  uSunScatter: { value: new Color(1.0, 0.85, 0.6) },
  // x: distance density, y: height-fog density, z: height falloff, w: fog base height
  uFogParams: { value: new Vector4(0.00012, 0.01, 0.012, 0) },
  uCloudLit: { value: new Color(1, 0.97, 0.93) },
  uCloudShadow: { value: new Color(0.55, 0.6, 0.78) },
  uNight: { value: 0 },
  uMoonDir: { value: new Vector3(-0.3, 0.6, 0.5).normalize() },
  uMoonColor: { value: new Color(0.3, 0.4, 0.6) },
  uExposure: { value: 1 },

  // Weather
  uWind: { value: new Vector3(2, 0, 1) },
  uGust: { value: 0 },
  uWet: { value: 0 },
  uFlash: { value: 0 },
  uFlashPos: { value: new Vector3(0, 300, 0) },
  uInCloud: { value: 0 },
  uStorm: { value: 0 },

  // Shadows
  uShadowMap: { value: null },
  uShadowMatrix: { value: new Matrix4() },
  // x: uv texel size, y: depth bias, z: normal offset (m), w: strength
  uShadowParams: { value: new Vector4(1 / 2048, 0.0006, 0.35, 1) },

  // Scene depth (resolved after the opaque pass) for soft particles
  uDepthTex: { value: null },

  // Interaction with clouds: trail of the player calf + big whales (xyz, birth time)
  uTrail: { value: Array.from({ length: 24 }, () => new Vector4(0, -9999, 0, -999)) },
  uMovers: { value: Array.from({ length: 12 }, () => new Vector4(0, -9999, 0, 0)) }, // xyz, radius
  uMoverVel: { value: Array.from({ length: 12 }, () => new Vector4(0, 0, 0, 0)) },
  // Sonic booms: xyz center, w: start time ; params: x radius max, y strength, z speed
  uBooms: { value: Array.from({ length: 6 }, () => new Vector4(0, -9999, 0, -999)) },
  uBoomParams: { value: Array.from({ length: 6 }, () => new Vector4(0, 0, 1, 0)) },
  // Song ripples through clouds: xyz center, w start time
  uSongRipple: { value: new Vector4(0, -9999, 0, -999) },
  uSongAmp: { value: 0 },
};

/** Convenience to merge the global uniform references into a material's uniforms. */
export function withGlobals(uniforms = {}) {
  return Object.assign({}, G, uniforms);
}

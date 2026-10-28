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
  // the painted light model (stylizedLight in common.js), set per preset by Atmosphere.js:
  // x sky fill of the shade, y warm bounce, z shade desaturation, w terminator softness
  uLightK: { value: new Vector4(0, 0, 0, 0) },

  // Weather
  uWind: { value: new Vector3(2, 0, 1) },
  uGust: { value: 0 },
  // integrated by Wind.js, so the meadow waves and lake ripples speed up with the wind smoothly
  uWavePhase: { value: 0 },
  uRipple: { value: new Vector2() },
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

  // Ocean of Vur Sok (written by world/Ocean.js and Atmosphere.js; read by every material through
  // common.js: applyFog tints and attenuates geometry below the sea, caustics, underwater fog)
  uSeaLevel: { value: 0 },
  uSeaState: { value: 0.3 },
  // the Spiral Maelstrom (world/Ocean.js setWhirlpool): up to 2 sea vortices dipping the surface into a
  // funnel. uWhirl: centre x, z, radius, depth (m); uWhirlB: strength 0..1, spin, phase, arm pitch.
  // common.js whirlH(xz) gives the funnel's surface drop, so waterSubmerge measures depth from it.
  uWhirl: { value: [new Vector4(0, 0, 100, 0), new Vector4(0, 0, 100, 0)] },
  uWhirlB: { value: [new Vector4(), new Vector4()] },
  uWhirlOn: { value: 0 },
  // camera submersion 0 (above) .. 1 (below the local wave surface)
  uUnderwater: { value: 0 },
  // lit in-scatter colour of the water column (what deep water and underwater distance fade to)
  uWaterTint: { value: new Color(0.012, 0.075, 0.1) },
  // extinction per metre (rgb): red goes first, blue-green travels furthest
  uWaterAbsorb: { value: new Vector3(0.3, 0.07, 0.045) },
  // x caustic strength, y caustic scale (1/m), z night plankton glow, w wave band (m, ~2x rms height)
  uWaterParams: { value: new Vector4(1, 0.55, 0, 0) },
  // resolved opaque colour of the frame (refraction through the sea surface); set by the ocean
  uSceneTex: { value: null },
  // equirect sky radiance (reflections, Snell's window); rendered each frame by the ocean
  uSkyEnv: { value: null },
  // 1 once uSkyEnv holds a rendered sky (otherwise skyEnv() falls back to the analytic gradient)
  uSkyEnvOn: { value: 0 },
  // lit upwelling colour of deep open water, and the turquoise light scattered through thin crests
  uSeaBody: { value: new Color(0.004, 0.03, 0.05) },
  uSeaScatter: { value: new Color(0.05, 0.4, 0.38) },
  // x: total slope variance of the waves (far roughness), y: mean foam cover, z: wave rms (m), w: shallow tint mix
  uSeaFar: { value: new Vector4(0.01, 0, 0.3, 0) },

  // Shadows of the nearest cumulus towers (Clouds.js): xz centre, radius, cloud base height.
  // sampleShadow() darkens everything under them, so their shade drifts over sea and islands.
  uCloudShade: { value: Array.from({ length: 16 }, () => new Vector4(0, 0, 0, 0)) },
  // x: strength 0..1, y: active count
  uCloudShadeK: { value: new Vector2(0, 0) },
  // The biggest cumulus as seen from the camera (Clouds.js), so the sea can reflect them:
  // xyz direction, w angular radius (rad); count in uCloudBlobN
  uCloudBlobs: { value: Array.from({ length: 12 }, () => new Vector4(0, 1, 0, 0)) },
  uCloudBlobN: { value: 0 },
};

/** Convenience to merge the global uniform references into a material's uniforms. */
export function withGlobals(uniforms = {}) {
  return Object.assign({}, G, uniforms);
}

// Directional sun shadow map that follows the player with texel snapping.
// Casters render with a depth variant of their own material so procedural
// vertex animation (skinning, wind sway, flapping) is reflected in shadows.
import {
  WebGLRenderTarget, DepthTexture, UnsignedIntType, LessEqualCompare, LinearFilter,
  OrthographicCamera, Matrix4, Vector3, ShaderMaterial,
} from 'three';
import { G } from './Globals.js';

export const LAYER_SHADOW = 3;

const _fwd = new Vector3();
const _upRef = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _bias = new Matrix4().set(
  0.5, 0, 0, 0.5,
  0, 0.5, 0, 0.5,
  0, 0, 0.5, 0.5,
  0, 0, 0, 1,
);

/** Create a depth-only twin of a ShaderMaterial (same vertex program, DEPTH_PASS define). */
export function depthVariant(mat) {
  const m = new ShaderMaterial({
    vertexShader: mat.vertexShader,
    fragmentShader: mat.fragmentShader,
    uniforms: mat.uniforms,
    defines: Object.assign({}, mat.defines, { DEPTH_PASS: '' }),
    side: mat.side,
  });
  m.colorWrite = false;
  return m;
}

export class Shadows {
  constructor(size = 2048, radius = 170) {
    this.size = size;
    this.radius = radius;
    this.depthRange = 2400;
    const dt = new DepthTexture(size, size, UnsignedIntType);
    dt.compareFunction = LessEqualCompare;
    dt.minFilter = LinearFilter;
    dt.magFilter = LinearFilter;
    this.rt = new WebGLRenderTarget(size, size, { depthBuffer: true, depthTexture: dt });
    this.cam = new OrthographicCamera(-radius, radius, radius, -radius, 1, this.depthRange);
    this.cam.layers.set(LAYER_SHADOW);
    this.casters = [];
    this.enabled = true;
    this._center = new Vector3();
    G.uShadowMap.value = dt;
    G.uShadowParams.value.set(1 / size, 0.0007, 0.25, 1);
  }

  setSize(size) {
    if (size === this.size) return;
    this.size = size;
    this.rt.setSize(size, size);
    G.uShadowParams.value.x = 1 / size;
  }

  /** Register a mesh as a shadow caster. depthMat is optional (auto variant). */
  addCaster(mesh, depthMat = null) {
    mesh.layers.enable(LAYER_SHADOW);
    const entry = { mesh, depthMat: depthMat || depthVariant(mesh.material), mat: null };
    this.casters.push(entry);
    mesh.userData.shadowEntry = entry;
    return entry;
  }

  removeCaster(mesh) {
    const i = this.casters.findIndex((c) => c.mesh === mesh);
    if (i >= 0) this.casters.splice(i, 1);
    mesh.layers.disable(LAYER_SHADOW);
  }

  update(focus, sunDir) {
    const r = this.radius;
    const cam = this.cam;
    // Light-space basis for texel snapping.
    const fwd = _fwd.copy(sunDir).negate();
    const upRef = Math.abs(fwd.y) > 0.99 ? _upRef.set(1, 0, 0) : _upRef.set(0, 1, 0);
    const right = _right.crossVectors(upRef, fwd).normalize();
    const up = _up.crossVectors(fwd, right).normalize();
    const texel = (2 * r) / this.size;
    const x = Math.round(focus.dot(right) / texel) * texel;
    const y = Math.round(focus.dot(up) / texel) * texel;
    const z = focus.dot(fwd);
    this._center.copy(right).multiplyScalar(x).addScaledVector(up, y).addScaledVector(fwd, z);
    cam.position.copy(this._center).addScaledVector(sunDir, this.depthRange * 0.5);
    cam.up.copy(up);
    cam.lookAt(this._center);
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 1; cam.far = this.depthRange;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    G.uShadowMatrix.value.multiplyMatrices(_bias, cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    // Fade shadows out when the sun is at the horizon / below it.
    const elev = sunDir.y;
    G.uShadowParams.value.w = this.enabled ? Math.min(1, Math.max(0, (elev + 0.02) * 8)) : 0;
  }

  render(renderer, scene) {
    if (!this._initialized) {
      // Allocate the depth texture once so the shadow sampler is always valid.
      renderer.setRenderTarget(this.rt);
      renderer.clear(false, true, false);
      this._initialized = true;
    }
    if (!this.enabled || G.uShadowParams.value.w <= 0) return;
    for (const c of this.casters) {
      c.mat = c.mesh.material;
      c.mesh.material = c.depthMat;
    }
    renderer.setRenderTarget(this.rt);
    renderer.clear(false, true, false);
    renderer.render(scene, this.cam);
    for (const c of this.casters) {
      c.mesh.material = c.mat;
      c.mat = null;
    }
  }
}

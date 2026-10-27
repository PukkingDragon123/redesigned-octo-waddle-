import { BufferGeometry, Float32BufferAttribute, Mesh, OrthographicCamera, ShaderMaterial } from 'three';

const _cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
let _geo = null;

function triangle() {
  if (_geo) return _geo;
  _geo = new BufferGeometry();
  _geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  _geo.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return _geo;
}

export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export class FullscreenPass {
  constructor(material) {
    this.material = material instanceof ShaderMaterial ? material : new ShaderMaterial(material);
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.mesh = new Mesh(triangle(), this.material);
    this.mesh.frustumCulled = false;
  }
  get uniforms() { return this.material.uniforms; }
  render(renderer, target = null, clear = false) {
    renderer.setRenderTarget(target);
    if (clear) renderer.clear(true, false, false);
    renderer.render(this.mesh, _cam);
  }
}

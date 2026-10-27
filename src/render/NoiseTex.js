// Baked, tileable noise texture shared by clouds, water and terrain shaders.
// R: fbm value noise, G: inverted worley billows, B: fine detail fbm, A: second fbm.
// Mipmapped so distant lookups stay smooth instead of shimmering.
import { DataTexture, RGBAFormat, UnsignedByteType, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter } from 'three';

function hash2(x, y, p, seed) {
  x = ((x % p) + p) % p;
  y = ((y % p) + p) % p;
  let h = (x * 374761393 + y * 668265263 + seed * 2654435761) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(u, v, period, seed) {
  const x = u * period, y = v * period;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, period, seed), b = hash2(xi + 1, yi, period, seed);
  const c = hash2(xi, yi + 1, period, seed), d = hash2(xi + 1, yi + 1, period, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(u, v, base, oct, seed) {
  let s = 0, a = 0.5, n = 0, p = base;
  for (let i = 0; i < oct; i++) {
    s += a * valueNoise(u, v, p, seed + i * 17);
    n += a;
    a *= 0.5;
    p *= 2;
  }
  return s / n;
}

function worley(u, v, period, seed) {
  const x = u * period, y = v * period;
  const xi = Math.floor(x), yi = Math.floor(y);
  let d = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const px = cx + hash2(cx, cy, period, seed), py = cy + hash2(cx, cy, period, seed + 99);
      const dx = px - x, dy = py - y;
      d = Math.min(d, dx * dx + dy * dy);
    }
  }
  return Math.sqrt(d);
}

let _tex = null;

export function getNoiseTexture(size = 256) {
  if (_tex) return _tex;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const r = fbm(u, v, 4, 5, 11);
      const w1 = 1 - worley(u, v, 8, 23);
      const w2 = 1 - worley(u, v, 16, 37);
      const g = Math.min(1, Math.max(0, w1 * 0.7 + w2 * 0.3));
      const b = fbm(u, v, 16, 4, 51);
      const a = fbm(u, v, 8, 5, 71);
      const i = (y * size + x) * 4;
      data[i] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
      data[i + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  _tex = tex;
  return tex;
}

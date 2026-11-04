# A painted look: Kuwahara (flat, brush-like colour areas with crisp edges), a soft ink line on
# strong edges, gentle colour lift, and a canvas weave. usage: painter.py <in> <out> [radius]
#   or as a module: paint(np_float_rgb, r)
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

def _quadrants(a, r):
    k = r + 1
    m = nd.uniform_filter(a, size=(k, k) + ((1,) if a.ndim == 3 else ()), mode='reflect')
    h = r // 2
    out = []
    for dy in (-h, h):
        for dx in (-h, h):
            out.append(np.roll(np.roll(m, dy, 0), dx, 1))
    return out

def kuwahara(img, r=4):
    P = r + 2
    pad = ((P, P), (P, P), (0, 0))
    img = np.pad(img, pad, mode='edge')
    out = _kuw(img, r)
    return out[P:-P, P:-P]

def _kuw(img, r):
    L = img @ np.array([0.299, 0.587, 0.114], np.float32)
    mL = _quadrants(L, r)
    mL2 = _quadrants(L * L, r)
    mC = _quadrants(img, r)
    var = np.stack([b - a * a for a, b in zip(mL, mL2)], 0)
    idx = np.argmin(var, 0)
    out = np.zeros_like(img)
    for q in range(4):
        sel = idx == q
        out[sel] = mC[q][sel]
    return out

_tex = {}
def canvas(h, w):
    if (h, w) in _tex: return _tex[(h, w)]
    rng = np.random.default_rng(3)
    n = nd.gaussian_filter(rng.random((h, w)).astype(np.float32), 1.6)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    weave = 0.5 + 0.25 * np.sin(xx * 1.9 + 0.6 * np.sin(yy * 0.13)) * np.sin(yy * 1.7 + 0.6 * np.sin(xx * 0.11))
    fib = nd.gaussian_filter(rng.random((h, w)).astype(np.float32), (0.6, 6.0))
    t = 0.45 * n + 0.35 * weave + 0.2 * fib
    t = (t - t.mean()) / (t.std() + 1e-6)
    _tex[(h, w)] = t
    return t

def flow(img, steps=5, sigma=3.0):
    """Smear along the image's own contours (a line-integral blur): brush strokes that follow form."""
    L = img @ np.array([0.299, 0.587, 0.114], np.float32)
    Ls = nd.gaussian_filter(L, 1.2)
    gx, gy = nd.sobel(Ls, 1), nd.sobel(Ls, 0)
    J11 = nd.gaussian_filter(gx * gx, sigma); J22 = nd.gaussian_filter(gy * gy, sigma); J12 = nd.gaussian_filter(gx * gy, sigma)
    th = 0.5 * np.arctan2(2 * J12, J11 - J22) + np.pi / 2
    cx, cy = np.cos(th), np.sin(th)
    H, W = L.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    acc = np.zeros_like(img); wsum = 0.0
    for s in range(-steps, steps + 1):
        w = np.exp(-(s / (steps * 0.7)) ** 2)
        coords = [yy + s * cy, xx + s * cx]
        for c in range(3):
            acc[..., c] += w * nd.map_coordinates(img[..., c], coords, order=1, mode='nearest')
        wsum += w
    return acc / wsum

def paint(img, r=3, ink=0.18, tex=0.018):
    a = kuwahara(img, r)
    a = flow(a, 5)
    a = kuwahara(a, 2)
    L = a @ np.array([0.299, 0.587, 0.114], np.float32)
    gx, gy = nd.sobel(L, 1), nd.sobel(L, 0)
    e = np.hypot(gx, gy)
    e = np.clip((e - 0.08) / 0.5, 0, 1)
    e = nd.gaussian_filter(e, 0.7)
    a = a * (1 - ink * e[..., None])
    # a gentle lift of colour, the way gouache sits brighter than a photo
    g = a.mean(2, keepdims=True)
    a = g + (a - g) * 1.12
    a = a * (1 + tex * canvas(*a.shape[:2])[..., None])
    return np.clip(a, 0, 1)

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    r = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    im = np.asarray(Image.open(src).convert('RGB'), np.float32) / 255
    Image.fromarray((paint(im, r) * 255).astype(np.uint8)).save(dst)

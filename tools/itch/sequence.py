# The painted cover: three painted scenes joined by brush-stroke wipes, ending on the whale's song
# forming the title, then wiping back to the start so the GIF loops.
# usage: python3 sequence.py <out_dir> <song_frames_dir>
import sys, os, glob, math
import numpy as np
from PIL import Image
from scipy import ndimage as nd
sys.path.insert(0, os.path.dirname(__file__))
from painter import paint

out, songdir = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
W, H = 630, 500
HERE = os.path.dirname(os.path.abspath(__file__))

def load(p):
    return np.asarray(Image.open(p).convert('RGB'), np.float32) / 255

def crop_to(img, cx, cy, ar=W / H, scale=1.0):
    h, w = img.shape[:2]
    ch = h * scale
    cw = ch * ar
    if cw > w: cw = w; ch = cw / ar
    x0 = min(max(cx * w - cw / 2, 0), w - cw); y0 = min(max(cy * h - ch / 2, 0), h - ch)
    return img[int(y0):int(y0 + ch), int(x0):int(x0 + cw)]

def big(img, size):
    return np.asarray(Image.fromarray((img * 255).astype(np.uint8)).resize(size, Image.LANCZOS), np.float32) / 255

# scene 1: mother and calf against the low sun; scene 2: the herd through the arch
s1 = paint(big(crop_to(load(os.environ.get('SCENE1', os.path.join(HERE, 'hugB-0.png'))), 0.45, 0.5), (756, 600)), 3)
s2 = paint(crop_to(load(os.environ.get('SCENE2', os.path.join(HERE, 'bannerD-0.png'))), 0.5, 0.5), 3)
song = [load(f) for f in sorted(glob.glob(os.path.join(songdir, 'c*.png')))]

def ken(img, k, z0=1.0, z1=1.0, fx=0.5, fy=0.5):
    """A slow push-in on a painted still (painted once, so the brushwork never shimmers)."""
    z = z0 + (z1 - z0) * k
    h, w = img.shape[:2]
    ch, cw = h / z, w / z
    y0 = (h - ch) * fy; x0 = (w - cw) * fx
    return np.asarray(Image.fromarray((img * 255).astype(np.uint8)).crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch))).resize((W, H), Image.LANCZOS), np.float32) / 255

# brush-stroke wipe: broad slanted strokes laid one under another, each sweeping across with a
# dry, ragged leading edge and a faint wet rim
rng = np.random.default_rng(11)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
ANG = math.radians(-11)
xr = xx * math.cos(ANG) - yy * math.sin(ANG)
yr = xx * math.sin(ANG) + yy * math.cos(ANG)
NS = 7
ymin, ymax = yr.min(), yr.max()
band = (ymax - ymin) / NS
# bristle marks: a few thick streaks running with the stroke, not a comb of fine lines
_n1 = nd.gaussian_filter1d(rng.random(2000).astype(np.float32), 2.2)
_n2 = nd.gaussian_filter1d(rng.random(2000).astype(np.float32), 6.0)
_yi = np.clip((yr - yr.min()).astype(int), 0, 1999)
streak = 0.65 * _n1[_yi] + 0.35 * _n2[_yi]
streak = streak + 0.08 * nd.gaussian_filter(rng.random((H, W)).astype(np.float32), 3)
streak = (streak - streak.min()) / (streak.max() - streak.min())
edge_noise = [nd.gaussian_filter1d(rng.random(1400).astype(np.float32), 12) for _ in range(NS)]
order = list(range(NS)); rng.shuffle(order)
def wipe_mask(p):
    m = np.zeros((H, W), np.float32)
    for j, i in enumerate(order):
        start = j * 0.075
        k = np.clip((p - start) / 0.5, 0, 1)
        k = k * k * (3 - 2 * k)
        if k <= 0: continue
        yc = ymin + (i + 0.5) * band
        xi = np.clip((xr - xr.min()).astype(int), 0, 1399)
        en = edge_noise[i][xi]
        half = band * (0.62 + 0.5 * (en - en.mean()) / (en.std() + 1e-6) * 0.18)
        inband = np.clip((half - np.abs(yr - yc)) / 3.0, 0, 1)
        head = xr.min() - 60 + k * (xr.max() - xr.min() + 160)
        behind = np.clip((head - xr) / 4.0, 0, 1)
        dry = np.clip((head - xr) / 55.0, 0, 1)
        dryk = np.where(dry < 1, np.clip((streak - (0.7 - 0.7 * dry)) * 8.0, 0, 1), 1.0)
        m = np.maximum(m, inband * behind * dryk)
    return nd.gaussian_filter(m, 0.8)

def mix(a, b, p):
    m = wipe_mask(p)[..., None]
    rim = (m * (1 - m) * 4)
    o = a * (1 - m) + b * m
    return o * (1 - 0.18 * rim)

frames = []
N1, NW, N2 = 16, 9, 16
for i in range(N1):
    frames.append(ken(s1, i / (N1 + NW), fx=0.45))
for i in range(NW):
    p = (i + 1) / (NW + 1)
    frames.append(mix(ken(s1, (N1 + i) / (N1 + NW), fx=0.45), ken(s2, i / (N2 + NW + NW)), p))
for i in range(N2):
    frames.append(ken(s2, (NW + i) / (N2 + NW + NW)))
for i in range(NW):
    p = (i + 1) / (NW + 1)
    frames.append(mix(ken(s2, (NW + N2 + i) / (N2 + NW + NW)), song[i], p))
for i in range(NW, len(song)):
    frames.append(song[i])
for i in range(NW):
    p = (i + 1) / (NW + 1)
    frames.append(mix(song[-1], ken(s1, 0.0, fx=0.45), p))
for i, f in enumerate(frames):
    Image.fromarray((np.clip(f, 0, 1) * 255).astype(np.uint8)).save(os.path.join(out, f's{i:03d}.png'))
print('frames', len(frames))

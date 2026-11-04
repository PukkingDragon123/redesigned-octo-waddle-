# Composite the SKYSONG cover: song ribbons rise from the whale's mouth and become the title.
# usage: python3 compose.py <frames_dir> <out_dir> <mouth_x> <mouth_y> [fps]
import sys, os, math, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

src, dst, MX, MY = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
FPS = float(sys.argv[5]) if len(sys.argv) > 5 else 12
os.makedirs(dst, exist_ok=True)
files = sorted(glob.glob(os.path.join(src, 'f*.png')))
import json
if os.environ.get('LIMIT'): files = files[:int(os.environ['LIMIT'])]
if os.environ.get('PINGPONG'):
    legs = int(os.environ.get('LEGS', '2'))
    seq = list(files)
    for k in range(1, legs):
        seq += (files[-2::-1] if k % 2 else files[1:])
    files = seq
MOUTHS = None
if os.path.exists(os.path.join(src, 'mouth.json')):
    MOUTHS = [m for m in json.load(open(os.path.join(src, 'mouth.json')))]
base0 = Image.open(files[0]).convert('RGB')
W, H = base0.size
SS = 2
FONT = os.path.join(os.path.dirname(__file__), 'fonts', 'AlmendraSC.ttf')
TITLE = 'SKYSONG'
fsize = int(H * 0.2) * SS
font = ImageFont.truetype(FONT, fsize)
track = int(fsize * 0.1)

# lay out the letters, centred in the upper sky
widths = [font.getbbox(c)[2] - font.getbbox(c)[0] for c in TITLE]
total = sum(widths) + track * (len(TITLE) - 1)
x = (W * SS - total) / 2
TY = int(H * 0.08) * SS
letters = []
for c, w in zip(TITLE, widths):
    bb = font.getbbox(c)
    m = Image.new('L', (W * SS, H * SS), 0)
    ImageDraw.Draw(m).text((x - bb[0], TY - bb[1] * 0), c, font=font, fill=255)
    a = np.asarray(m, dtype=np.float32) / 255.0
    ys, xs = np.nonzero(a > 0.1)
    letters.append({'mask': a, 'cx': xs.mean(), 'cy': ys.mean(), 'top': ys.min(), 'bot': ys.max()})
    x += w + track

N = len(files)
DUR = N / FPS
rng = np.random.default_rng(7)
P0 = np.array([MX * SS, MY * SS])
# timeline (seconds)
LAUNCH0, LAUNCH_STEP, TRAVEL, REVEAL = 0.35, 0.2, 1.05, 0.55
FADE_OUT = 0.0 if os.environ.get('NOFADE') else 0.45  # at the very end, so the loop restarts cleanly

def bez(p0, p1, p2, p3, s):
    u = 1 - s
    return (u ** 3)[:, None] * p0 + (3 * u * u * s)[:, None] * p1 + (3 * u * s * s)[:, None] * p2 + (s ** 3)[:, None] * p3

ribbons = []
for k, L in enumerate(letters):
    p3 = np.array([L['cx'], L['bot'] + 0.02 * fsize])
    side = (p3[0] - P0[0])
    p1 = P0 + np.array([side * 0.15 + rng.uniform(-40, 40) * SS, -H * SS * 0.28])
    p2 = p3 + np.array([-side * 0.12 + rng.uniform(-30, 30) * SS, H * SS * 0.22])
    ribbons.append({'p': (P0, p1, p2, p3), 'd1': p1 - P0, 't0': LAUNCH0 + LAUNCH_STEP * k, 'ph': rng.uniform(0, 6.28), 'amp': rng.uniform(3.5, 6) * SS})

S = np.linspace(0, 1, 220)
def ribbon_pts(r, t, m0):
    _, _, p2, p3 = r['p']
    pts = bez(m0, m0 + r['d1'], p2, p3, S)
    d = np.gradient(pts, axis=0)
    n = np.stack([-d[:, 1], d[:, 0]], 1)
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-6
    # a travelling sound wave along the ribbon, calming as it reaches the letter
    wob = r['amp'] * np.sin(S * 7.5 - t * 6.0 + r['ph']) * (0.35 + 0.65 * (1 - S)) * np.sin(np.pi * np.clip(S, 0, 1)) ** 0.5
    return pts + n * wob[:, None]

def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)

coreCol = np.array([1.0, 0.97, 0.9], dtype=np.float32)
glowCol = np.array([1.0, 0.72, 0.42], dtype=np.float32)
for i, f in enumerate(files):
    t = i / FPS
    if MOUTHS and MOUTHS[i]:
        P0 = np.array([MOUTHS[i][0] * SS, MOUTHS[i][1] * SS])
    endK = 1 - smooth((t - (DUR - FADE_OUT)) / FADE_OUT) if FADE_OUT > 0 else 1.0
    base = np.asarray(Image.open(f).convert('RGB'), dtype=np.float32) / 255.0
    rib = Image.new('L', (W * SS, H * SS), 0)
    dr = ImageDraw.Draw(rib)
    # sound arcs breathing out of the mouth (open crescents, hand-wobbled; never full rings)
    for j in range(4):
        age = (t * 0.9 + j / 4.0) % 1.0
        rad = (14 + age * 120) * SS
        al = (1 - age) ** 1.6 * 0.55 * min(1, t / 0.4) * endK
        if al < 0.02: continue
        a0, a1 = -150, -25
        pts = []
        for a in np.linspace(a0, a1, 40):
            rr = rad * (1 + 0.03 * math.sin(a * 0.15 + j * 2 + t * 3))
            pts.append((P0[0] + rr * math.cos(math.radians(a)), P0[1] + rr * math.sin(math.radians(a)) * 0.8))
        for q in range(len(pts) - 1):
            e = math.sin(math.pi * q / (len(pts) - 1))
            dr.line([pts[q], pts[q + 1]], fill=int(255 * al * e), width=max(1, int((1.2 + 1.6 * (1 - age)) * SS)))
    lettersA = np.zeros((H * SS, W * SS), np.float32)
    flash = 0.0
    for k, r in enumerate(ribbons):
        u = (t - r['t0']) / TRAVEL
        if u > 0:
            head = smooth(min(u, 1.0)) if u < 1 else 1.0
            tail = max(0.0, head - 0.5) if u < 1 else min(1.0, (u - 1) * 2.2 + 0.5)
            pts = ribbon_pts(r, t, P0)
            lo, hi = int(tail * (len(S) - 1)), int(head * (len(S) - 1))
            fade = 1.0 if u < 1 else max(0.0, 1 - (u - 1) * 2.2)
            for q in range(lo, hi):
                s = (q - lo) / max(1, hi - lo)  # 0 at the tail, 1 at the head
                w = (1.0 + 3.0 * s) * SS
                a = (0.15 + 0.85 * s) * fade * endK
                dr.line([tuple(pts[q]), tuple(pts[q + 1])], fill=int(255 * min(1, a)), width=max(1, int(w)))
        # the letter inks in from the bottom as its ribbon arrives
        v = (t - r['t0'] - TRAVEL * 0.92) / REVEAL
        if v > 0:
            L = letters[k]
            yy = np.arange(H * SS, dtype=np.float32)[:, None]
            front = L['bot'] - (L['bot'] - L['top'] + 0.2 * fsize) * smooth(v)
            wipe = smooth((yy - front) / (0.12 * fsize) + 0.5)
            lettersA = np.maximum(lettersA, L['mask'] * wipe * endK)
            flash += max(0.0, 1 - abs(v - 0.6) * 2.0) * 0.12
    ribA = np.asarray(rib, dtype=np.float32) / 255.0
    core = np.maximum(ribA, lettersA)
    def down(a):
        return np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS), dtype=np.float32) / 255.0
    glowBig = np.asarray(Image.fromarray((core * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(16 * SS / 2)), dtype=np.float32) / 255.0
    glowSmall = np.asarray(Image.fromarray((core * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5 * SS / 2)), dtype=np.float32) / 255.0
    shadow = np.asarray(Image.fromarray((lettersA * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(14 * SS / 2)), dtype=np.float32) / 255.0
    shadow = np.roll(np.roll(shadow, 4 * SS, 0), 2 * SS, 1)
    c1, g1, g2, sh = down(core), down(glowBig), down(glowSmall), down(shadow)
    breathe = 1.0 + 0.08 * math.sin(t * 2.2)
    out = base * (1 - 0.6 * np.clip(sh * 1.4, 0, 1)[..., None])
    gl = (g1 * (1.1 + flash) * breathe + g2 * 0.9)[..., None] * glowCol
    out = 1 - (1 - out) * (1 - np.clip(gl, 0, 1))
    out = out * (1 - c1[..., None]) + coreCol * c1[..., None]
    Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).save(os.path.join(dst, f'c{i:03d}.png'))
print('frames', N, 'dur', round(DUR, 2))

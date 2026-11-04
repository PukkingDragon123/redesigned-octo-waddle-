# Lay the SKYSONG lettering over the banner render: warm ivory, soft shadow and glow.
# usage: python3 banner.py <in.png> <out.png> <x_frac> <y_frac> [size_frac] [align]
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
src, out = sys.argv[1], sys.argv[2]
xf, yf = float(sys.argv[3]), float(sys.argv[4])
sf = float(sys.argv[5]) if len(sys.argv) > 5 else 0.2
align = sys.argv[6] if len(sys.argv) > 6 else 'center'
base = Image.open(src).convert('RGB')
W, H = base.size
SS = 2
font = ImageFont.truetype(os.path.join(os.path.dirname(__file__), 'fonts', 'AlmendraSC.ttf'), int(H * sf) * SS)
title = 'SKYSONG'
track = int(H * sf * SS * 0.1)
ws = [font.getbbox(c)[2] - font.getbbox(c)[0] for c in title]
total = sum(ws) + track * (len(title) - 1)
x = xf * W * SS - (total / 2 if align == 'center' else 0)
m = Image.new('L', (W * SS, H * SS), 0)
d = ImageDraw.Draw(m)
asc = font.getbbox('S')
y = yf * H * SS - (asc[3] - asc[1]) / 2 - asc[1]
for c, w in zip(title, ws):
    bb = font.getbbox(c)
    d.text((x - bb[0], y), c, font=font, fill=255)
    x += w + track
def f(img, r):
    return np.asarray(img.filter(ImageFilter.GaussianBlur(r)).resize((W, H), Image.LANCZOS), dtype=np.float32) / 255.0
core = np.asarray(m.resize((W, H), Image.LANCZOS), dtype=np.float32) / 255.0
glow = f(m, 18 * SS)
sh = np.roll(np.roll(f(m, 10 * SS), int(H * 0.008), 0), int(H * 0.004), 1)
b = np.asarray(base, dtype=np.float32) / 255.0
o = b * (1 - 0.45 * sh[..., None])
o = 1 - (1 - o) * (1 - np.clip(glow[..., None] * np.array([1.0, 0.7, 0.4]) * 0.75, 0, 1))
o = o * (1 - core[..., None]) + np.array([1.0, 0.95, 0.86]) * core[..., None]
Image.fromarray((np.clip(o, 0, 1) * 255).astype(np.uint8)).save(out)
print('ok', W, H)

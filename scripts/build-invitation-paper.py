#!/usr/bin/env python3
"""Build public/images/watercolor/invitation-paper.webp, the invitation card's
floral paper.

It starts from a screenshot of the original event poster (a macOS Preview
window capture, 1556x2000), crops the window chrome, fades the poster's faint
inner frame lines, and masks out the text block, QR panel and corner marks with
a feathered alpha channel. The result is the poster's watercolor paper and
florals only, which the card stretches to its own size.

Usage:
  pip install pillow numpy
  python3 scripts/build-invitation-paper.py <poster-screenshot.(png|webp|jpg)>
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

if len(sys.argv) < 2:
    sys.exit(__doc__)
src = Image.open(sys.argv[1]).convert('RGB')
if src.size != (1556, 2000):
    sys.exit(f'expected a 1556x2000 poster screenshot, got {src.size}')
a = np.asarray(src).astype(int)
# --- locate the faint coral frame lines (screenshot coords) by r-b contrast
def best(axis_vals, sampler):
    s = [sampler(v) for v in axis_vals]; i = int(np.argmax(s)); return axis_vals[i], s[i]
rb = lambda sub: (sub[..., 0] - sub[..., 2]).mean()
top,  st = best(list(range(215, 245)), lambda y: rb(a[y, 400:900]))
left, sl = best(list(range(135, 165)), lambda x: rb(a[380:520, x]))
right, sr = best(list(range(1390, 1420)), lambda x: rb(a[1100:1200, x]))
bot,  sb = best(list(range(1860, 1895)), lambda y: rb(a[y, 1000:1100]))
print('frame lines: top', top, st, 'left', left, sl, 'right', right, sr, 'bottom', bot, sb)
# --- inpaint them: coral pixels within ±3px of a line get the perpendicular neighbours' mean
out = a.copy()
def fix_h(y0, x0, x1):
    for y in range(y0 - 3, y0 + 4):
        row = a[y, x0:x1]; m = (row[:, 0] - row[:, 2]) > 48
        out[y, x0:x1][m] = ((a[y0 - 8, x0:x1] + a[y0 + 8, x0:x1]) // 2)[m]
def fix_v(x0, y0, y1):
    for x in range(x0 - 3, x0 + 4):
        col = a[y0:y1, x]; m = (col[:, 0] - col[:, 2]) > 48
        out[y0:y1, x][m] = ((a[y0:y1, x0 - 8] + a[y0:y1, x0 + 8]) // 2)[m]
fix_h(top, left - 5, right + 6); fix_h(bot, left - 5, right + 6)
fix_v(left, top - 5, bot + 6); fix_v(right, top - 5, bot + 6)
im = Image.fromarray(out.astype(np.uint8))
L, T, R, B = 30, 86, 1526, 1984          # crop away the macOS Preview window chrome
im = im.crop((L, T, R, B)); W, H = im.size
ex = Image.new('L', (W, H), 0); d = ImageDraw.Draw(ex)
S = lambda x, y: (x - L, y - T)
# text block, keeping the peony/leaf intrusions top-right and bottom-left
poly = [(215,285),(1105,285),(1105,395),(1345,395),(1345,1595),(1425,1595),(1425,1930),
        (1115,1930),(1115,1820),(440,1820),(440,1560),(370,1560),(370,1290),(215,1290)]
d.polygon([S(x, y) for x, y in poly], fill=255)
d.rectangle((*S(150, 235), *S(325, 415)), fill=255)        # top-left corner mark
d.rectangle((*S(1230, 1840), *S(1435, 1965)), fill=255)    # bottom-right corner mark
d.ellipse((*S(1445, 1895), *S(1540, 1990)), fill=255)      # Preview's scan icon
ex = ex.filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(18))
keep = Image.eval(ex, lambda v: 255 - v)
im.putalpha(keep)
im = im.resize((1216, round(H * 1216 / W)), Image.LANCZOS)
outp = os.path.join(os.path.dirname(__file__), '..', 'public', 'images', 'watercolor', 'invitation-paper.webp')
im.save(outp, quality=82, method=6)
print('size', im.size, 'bytes', os.path.getsize(outp))

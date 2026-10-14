#!/usr/bin/env python3
"""Generate public/images/invitation-title.svg (the 成果展 title artwork).

The title is rendered from Noto Serif CJK TC Black glyph outlines with
watercolor-style SVG filters, so it looks the same on every device instead of
depending on whichever CJK serif the visitor's system happens to have.

Usage:
  pip install fonttools
  curl -L -o /tmp/NotoSerifCJKtc-Black.otf \
    https://github.com/notofonts/noto-cjk/raw/main/Serif/OTF/TraditionalChinese/NotoSerifCJKtc-Black.otf
  python3 scripts/build-invitation-title.py /tmp/NotoSerifCJKtc-Black.otf
"""
import os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

font_path = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
font = TTFont(font_path)
cmap = font.getBestCmap(); gs = font.getGlyphSet()
d = {'glyphs': []}
for ch in '成果展':
    g = gs[cmap[ord(ch)]]
    pen = SVGPathPen(gs); g.draw(pen)
    d['glyphs'].append({'d': pen.getCommands(), 'adv': g.width})
gap = 40
glyphs = []; x = 0
for g in d['glyphs']:
    glyphs.append((x, g['d']))
    x += g['adv'] + gap
x -= gap
W = x
left, top, right, bottom = -300, -900, W + 300, 240
vb = f'{left} {top} {right - left} {bottom - top}'
fills = ['url(#green)', 'url(#coral)', 'url(#green)']
filts = ['url(#wcGreen)', 'url(#wcCoral)', 'url(#wcGreen)']
paths = '\n'.join(
    f'    <g filter="{fl}"><path transform="translate({gx},0) scale(1,-1)" fill="{f}" d="{dd}"/></g>'
    for (gx, dd), f, fl in zip(glyphs, fills, filts))

def wc(fid, tint, seed, pool):
    return f'''    <filter id="{fid}" x="-6%" y="-6%" width="112%" height="112%" color-interpolation-filters="sRGB">
      <!-- coarse pigment blotches, used both as a tint mask and as shading -->
      <feTurbulence type="fractalNoise" baseFrequency="0.0024 0.0030" numOctaves="3" seed="{seed}" result="n1"/>
      <feColorMatrix in="n1" type="matrix" values="0 0 0 0 {tint[0]}  0 0 0 0 {tint[1]}  0 0 0 0 {tint[2]}  2.2 0 0 0 -1.0" result="tintA"/>
      <feComposite in="tintA" in2="SourceGraphic" operator="over" result="tinted"/>
      <feColorMatrix in="n1" type="matrix" values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1" result="g1"/>
      <feComponentTransfer in="g1" result="c1">
        <feFuncR type="linear" slope="1.5" intercept="-0.25"/>
        <feFuncG type="linear" slope="1.5" intercept="-0.25"/>
        <feFuncB type="linear" slope="1.5" intercept="-0.25"/>
      </feComponentTransfer>
      <!-- fine paper granulation -->
      <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="{seed+4}" result="n2"/>
      <feColorMatrix in="n2" type="matrix" values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1" result="g2"/>
      <feComponentTransfer in="g2" result="c2">
        <feFuncR type="linear" slope="1.15" intercept="-0.08"/>
        <feFuncG type="linear" slope="1.15" intercept="-0.08"/>
        <feFuncB type="linear" slope="1.15" intercept="-0.08"/>
      </feComponentTransfer>
      <feBlend in="c2" in2="c1" mode="overlay" result="grain"/>
      <feBlend in="grain" in2="tinted" mode="soft-light" result="textured"/>
      <!-- pigment pooling at the stroke edges -->
      <feMorphology in="SourceAlpha" operator="erode" radius="12" result="eroded"/>
      <feGaussianBlur in="eroded" stdDeviation="10" result="erodedBlur"/>
      <feComposite in="SourceAlpha" in2="erodedBlur" operator="arithmetic" k2="1" k3="-1" result="edge"/>
      <feFlood flood-color="{pool}" flood-opacity="0.3" result="dark"/>
      <feComposite in="dark" in2="edge" operator="in" result="edgeDark"/>
      <feBlend in="edgeDark" in2="textured" mode="multiply" result="painted"/>
      <!-- gold flecks -->
      <feTurbulence type="turbulence" baseFrequency="0.075" numOctaves="1" seed="{seed+1}" result="n3"/>
      <feColorMatrix in="n3" type="matrix" values="0 0 0 0 0.95  0 0 0 0 0.82  0 0 0 0 0.45  6 0 0 0 -4.2" result="flecks"/>
      <feComposite in="flecks" in2="SourceAlpha" operator="in" result="flecksIn"/>
      <feBlend in="flecksIn" in2="painted" mode="screen" result="gilded"/>
      <feColorMatrix in="gilded" type="saturate" values="1.25" result="vivid"/>
      <feComposite in="vivid" in2="SourceAlpha" operator="in"/>
    </filter>'''
filters = wc('wcGreen', (0.50, 0.60, 0.30), 5, '#13271f') + '\n' + wc('wcCoral', (0.98, 0.52, 0.30), 21, '#7a2e22')
# warm gold washes on the green glyphs (lower-left of 成, lower-right of 展)
g0x, g0d = glyphs[0]; g2x, g2d = glyphs[2]
washes = f'''      <path transform="translate({g0x},0) scale(1,-1)" fill="url(#goldWashA)" d="{g0d}"/>
      <path transform="translate({g2x},0) scale(1,-1)" fill="url(#goldWashB)" d="{g2d}"/>'''
swash = ("M -330 -430 C -230 -200, -180 70, 30 120 C 170 150, 130 -50, -40 -10 "
         "C -150 20, -60 160, 170 150 S 820 60, 1220 110 S 1900 180, 2420 90 S 3020 40, 3350 110")
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="成果展">
  <defs>
    <linearGradient id="green" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#4a7a5f"/>
      <stop offset="0.4" stop-color="#2f5a47"/>
      <stop offset="0.7" stop-color="#22443a"/>
      <stop offset="1" stop-color="#3f6b52"/>
    </linearGradient>
    <linearGradient id="coral" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#ec8f73"/>
      <stop offset="0.45" stop-color="#d9684f"/>
      <stop offset="0.75" stop-color="#c7533f"/>
      <stop offset="1" stop-color="#e98461"/>
    </linearGradient>
    <radialGradient id="goldWashA" cx="0.18" cy="0.95" r="0.75">
      <stop offset="0" stop-color="#d9b25a" stop-opacity="0.85"/>
      <stop offset="0.45" stop-color="#c9a850" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#c9a850" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="goldWashB" cx="0.9" cy="0.9" r="0.7">
      <stop offset="0" stop-color="#d9b25a" stop-opacity="0.7"/>
      <stop offset="0.5" stop-color="#c9a850" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#c9a850" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ribbon" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#e9896f"/>
      <stop offset="0.5" stop-color="#d9684f"/>
      <stop offset="1" stop-color="#eda182"/>
    </linearGradient>
{filters}
  </defs>
  <g>
{paths}
    <g opacity="0.45">
{washes}
    </g>
    <path d="{swash}" fill="none" stroke="url(#ribbon)" stroke-width="13" stroke-linecap="round" opacity="0.92"/>
  </g>
</svg>
'''
out = os.path.join(os.path.dirname(__file__), '..', 'public', 'images', 'invitation-title.svg')
open(out, 'w').write(svg)
print('viewBox', vb, 'bytes', len(svg))

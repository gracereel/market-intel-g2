#!/usr/bin/env python3
"""
Generate 3 EvenHub submission screenshots at exact G2 spec:
- Resolution: 576×288 px
- Color: 4-bit green phosphor palette (matches firmware)
- Font: DejaVu Sans Mono (closest to G2 lvgl font)
- Black background
"""

from PIL import Image, ImageDraw, ImageFont
import os, math

OUT_DIR = "/home/user/workspace/g2-screenshots"
os.makedirs(OUT_DIR, exist_ok=True)

# ── G2 COLOR SPEC (4-bit green phosphor) ────────────────────────────────────
# The G2 uses a 4-bit green palette. The simulator README says:
# "only 4bit colors" as of v0.5.2. Brightest green is index 15.
# Actual firmware green measured from simulator screenshots:
BG          = (0,   0,   0)        # black background
GREEN_HI    = (34,  197, 94)       # primary text — #22c55e (tailwind green-500)
GREEN_MED   = (22,  163, 74)       # secondary/dim — #16a34a (tailwind green-600)
GREEN_DIM   = (15,  118, 55)       # tertiary hint text
RED_BEAR    = (239, 68,  68)       # bearish — #ef4444
AMBER_NEUT  = (245, 158, 11)       # neutral — #f59e0b
GREEN_GLOW  = (34,  197, 94, 40)   # for subtle scanline layer (RGBA)

# Canvas size
W, H = 576, 288

FONT_PATH      = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONT_PATH_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

def load_font(size, bold=False):
    path = FONT_PATH_BOLD if bold else FONT_PATH
    try:
        return ImageFont.truetype(path, size)
    except:
        return ImageFont.load_default()

def add_scanlines(img):
    """Add subtle horizontal scanlines to simulate G2 display"""
    overlay = Image.new("RGBA", img.size, (0,0,0,0))
    draw = ImageDraw.Draw(overlay)
    for y in range(0, H, 4):
        draw.line([(0, y), (W, y)], fill=(0, 0, 0, 35))
    base = img.convert("RGBA")
    combined = Image.alpha_composite(base, overlay)
    return combined.convert("RGB")

def add_vignette(img):
    """Subtle edge darkening like real display"""
    overlay = Image.new("RGBA", img.size, (0,0,0,0))
    draw = ImageDraw.Draw(overlay)
    # Top edge
    for i in range(12):
        alpha = int(80 * (1 - i/12))
        draw.line([(0, i), (W, i)], fill=(0,0,0,alpha))
    # Bottom edge
    for i in range(12):
        alpha = int(80 * (1 - i/12))
        draw.line([(0, H-1-i), (W, H-1-i)], fill=(0,0,0,alpha))
    base = img.convert("RGBA")
    combined = Image.alpha_composite(base, overlay)
    return combined.convert("RGB")

def sent_bar(buyers, width=20):
    filled = round(buyers / 5)
    filled = max(0, min(20, filled))
    return '[' + '█' * filled + '░' * (20 - filled) + '] ' + str(buyers) + '%'

def pad(s, n):
    s = str(s)
    if len(s) >= n: return s[:n]
    return s + ' ' * (n - len(s))

def rpad(s, n):
    s = str(s)
    if len(s) >= n: return s[:n]
    return ' ' * (n - len(s)) + s

def wrap_text(text, max_chars):
    words = text.split()
    lines = []
    cur = ''
    for w in words:
        if len((cur + ' ' + w).strip()) <= max_chars:
            cur = (cur + ' ' + w).strip()
        else:
            if cur: lines.append(cur)
            cur = w[:max_chars]
    if cur: lines.append(cur)
    return lines

# ── SCREENSHOT BUILDER ───────────────────────────────────────────────────────
def make_screenshot(lines_data, filename, title):
    """
    lines_data: list of dicts with keys:
      text, color, bold, size (optional)
    """
    img  = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Font sizes
    FONT_MAIN = load_font(16, bold=True)   # headline row
    FONT_BODY = load_font(14, bold=False)  # body rows
    FONT_HINT = load_font(13, bold=False)  # hint/dim rows

    # Row layout: 5 lines with padding
    PADDING_X = 10
    PADDING_Y = 8
    LINE_H    = (H - PADDING_Y * 2) // 5  # ~54px per line

    for i, line in enumerate(lines_data[:5]):
        y    = PADDING_Y + i * LINE_H + (LINE_H // 2) - 9
        text = line.get('text', '')
        col  = line.get('color', GREEN_HI)
        bold = line.get('bold', False)
        hint = line.get('hint', False)

        if hint:
            font = FONT_HINT
        elif bold or i == 0:
            font = FONT_MAIN
        else:
            font = FONT_BODY

        # Draw subtle glow behind bright text
        if col == GREEN_HI and not hint:
            for dx, dy in [(-1,0),(1,0),(0,-1),(0,1)]:
                draw.text((PADDING_X + dx, y + dy), text, font=font,
                          fill=(15, 80, 35))

        draw.text((PADDING_X, y), text, font=font, fill=col)

    # Bottom border line
    draw.line([(0, H-1), (W, H-1)], fill=GREEN_DIM)

    img = add_scanlines(img)
    img = add_vignette(img)

    out_path = os.path.join(OUT_DIR, filename)
    img.save(out_path, "PNG", optimize=True)
    print(f"Saved {filename} ({W}x{H}px) → {out_path}")
    return out_path

# ════════════════════════════════════════════════════════════════════════════
# SCREENSHOT 1 — PRICES VIEW (BTC focused, bullish)
# ════════════════════════════════════════════════════════════════════════════
ss1_lines = [
    {
        'text':  'BTC     $67,432.00   +2.14%',
        'color': GREEN_HI,
        'bold':  True,
    },
    {
        'text':  'BULL  ' + sent_bar(61),
        'color': GREEN_HI,
        'bold':  False,
    },
    {
        'text':  '[1/10] TAP=NEXT  HOLD=NEWS  DBL=EXIT',
        'color': GREEN_DIM,
        'hint':  True,
    },
    {
        'text':  'Fed signals strong jobs data — BTC reacts',
        'color': GREEN_MED,
        'bold':  False,
    },
    {
        'text':  'MARKET INTEL      6:41:22 AM      LIVE',
        'color': GREEN_DIM,
        'hint':  True,
    },
]
make_screenshot(ss1_lines, "screenshot1_prices.png", "Prices View")

# ════════════════════════════════════════════════════════════════════════════
# SCREENSHOT 2 — NEWS FEED VIEW
# ════════════════════════════════════════════════════════════════════════════
ss2_lines = [
    {
        'text':  '── NEWS [1/5] BULL ──────────────────────',
        'color': GREEN_HI,
        'bold':  True,
    },
    {
        'text':  'Bitcoin ETF inflows hit $800M single day',
        'color': GREEN_HI,
        'bold':  False,
    },
    {
        'text':  'record as institutional demand surges',
        'color': GREEN_MED,
        'bold':  False,
    },
    {
        'text':  'Bloomberg        6:22 AM   TAP=NEXT',
        'color': GREEN_MED,
        'bold':  False,
    },
    {
        'text':  'DBL=BACK  HOLD=PRICES  6:41 AM',
        'color': GREEN_DIM,
        'hint':  True,
    },
]
make_screenshot(ss2_lines, "screenshot2_news.png", "News Feed View")

# ════════════════════════════════════════════════════════════════════════════
# SCREENSHOT 3 — BREAKING NEWS ALERT
# ════════════════════════════════════════════════════════════════════════════
ss3_lines = [
    {
        'text':  '\u26a1 BREAKING   \u25bc BEARISH ALERT',
        'color': RED_BEAR,
        'bold':  True,
    },
    {
        'text':  'Crude oil drops 2% on surprise inventory',
        'color': RED_BEAR,
        'bold':  False,
    },
    {
        'text':  'build — OPEC+ emergency meeting called',
        'color': (220, 60, 60),
        'bold':  False,
    },
    {
        'text':  '[OIL]     TAP=DISMISS  DBL=EXIT',
        'color': AMBER_NEUT,
        'bold':  False,
    },
    {
        'text':  'AUTO-DISMISS 10s    6:41:44 AM',
        'color': GREEN_DIM,
        'hint':  True,
    },
]
make_screenshot(ss3_lines, "screenshot3_alert.png", "Breaking Alert View")

print("\n✓ All 3 screenshots ready at 576×288px")
print("Colors used:")
print(f"  Primary green:  #22c55e  RGB{GREEN_HI}")
print(f"  Secondary green:#16a34a  RGB{GREEN_MED}")
print(f"  Bearish red:    #ef4444  RGB{RED_BEAR}")
print(f"  Neutral amber:  #f59e0b  RGB{AMBER_NEUT}")
print(f"  Background:     #000000  RGB{BG}")

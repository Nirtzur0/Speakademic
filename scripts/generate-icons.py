"""Generate Speakademic extension icons at 16, 48, and 128px."""
from PIL import Image, ImageDraw, ImageFont
import math
import os

ICON_DIR = os.path.join(
    os.path.dirname(__file__), '..', 'extension', 'icons'
)

# Speakademic brand colors
ACCENT = (218, 119, 86)       # #DA7756
ACCENT_LIGHT = (232, 149, 110) # #E8956E
BG_DARK = (28, 25, 23)        # #1C1917
WHITE = (250, 249, 246)       # #FAF9F6


def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))


def draw_icon(size):
    # High-res then downscale for anti-aliasing
    scale = 8 if size < 64 else 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded rectangle background with gradient feel
    margin = int(s * 0.02)
    radius = int(s * 0.22)

    # Draw rounded rect background
    draw.rounded_rectangle(
        [margin, margin, s - margin, s - margin],
        radius=radius,
        fill=BG_DARK,
    )

    # Inner subtle border
    draw.rounded_rectangle(
        [margin, margin, s - margin, s - margin],
        radius=radius,
        outline=(*ACCENT, 50),
        width=max(1, int(s * 0.01)),
    )

    cx, cy = s // 2, s // 2

    # --- Draw a stylized open book with sound waves ---

    # Book: two angled pages meeting at center
    book_w = int(s * 0.28)
    book_h = int(s * 0.32)
    book_cx = cx - int(s * 0.06)
    book_cy = cy + int(s * 0.02)
    line_w = max(2, int(s * 0.025))

    # Left page
    left_page = [
        (book_cx, book_cy - int(book_h * 0.05)),  # spine top
        (book_cx - book_w, book_cy - book_h // 2),  # top left
        (book_cx - book_w, book_cy + book_h // 2),  # bottom left
        (book_cx, book_cy + int(book_h * 0.4)),     # spine bottom
    ]
    draw.polygon(left_page, fill=(*WHITE, 220))
    draw.line(left_page + [left_page[0]], fill=(*ACCENT, 180), width=line_w)

    # Right page
    right_page = [
        (book_cx, book_cy - int(book_h * 0.05)),
        (book_cx + book_w, book_cy - book_h // 2),
        (book_cx + book_w, book_cy + book_h // 2),
        (book_cx, book_cy + int(book_h * 0.4)),
    ]
    draw.polygon(right_page, fill=(*WHITE, 200))
    draw.line(right_page + [right_page[0]], fill=(*ACCENT, 180), width=line_w)

    # Spine line
    draw.line(
        [(book_cx, book_cy - int(book_h * 0.05)),
         (book_cx, book_cy + int(book_h * 0.4))],
        fill=(*ACCENT, 200), width=line_w
    )

    # Text lines on left page
    text_line_w = max(1, int(s * 0.015))
    for i in range(3):
        y = book_cy - book_h // 4 + i * int(book_h * 0.18)
        x1 = book_cx - book_w + int(book_w * 0.25)
        x2 = book_cx - int(book_w * 0.15)
        lw = x2 - x1 if i < 2 else int((x2 - x1) * 0.65)
        draw.line(
            [(x1, y), (x1 + lw, y)],
            fill=(*ACCENT, 100), width=text_line_w
        )

    # --- Sound waves emanating from right side ---
    wave_cx = cx + int(s * 0.18)
    wave_cy = cy
    wave_color = ACCENT_LIGHT

    for i, r in enumerate([int(s * 0.1), int(s * 0.17), int(s * 0.24)]):
        alpha = 220 - i * 50
        arc_w = max(2, int(s * 0.028) - i * max(1, int(s * 0.004)))
        bbox = [wave_cx - r, wave_cy - r, wave_cx + r, wave_cy + r]
        draw.arc(
            bbox, start=-45, end=45,
            fill=(*wave_color, alpha), width=arc_w
        )

    # --- Accent dot (brand element) ---
    dot_r = int(s * 0.035)
    dot_x = cx + int(s * 0.18)
    dot_y = cy
    draw.ellipse(
        [dot_x - dot_r, dot_y - dot_r,
         dot_x + dot_r, dot_y + dot_r],
        fill=(*ACCENT, 255),
    )

    # Downscale with high-quality resampling
    img = img.resize((size, size), Image.LANCZOS)
    return img


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    for size in [16, 48, 128]:
        icon = draw_icon(size)
        path = os.path.join(ICON_DIR, f'icon{size}.png')
        icon.save(path, 'PNG')
        print(f'Generated {path} ({size}x{size})')


if __name__ == '__main__':
    main()

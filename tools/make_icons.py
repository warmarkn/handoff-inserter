"""Write docs/icon-180.png and docs/icon-512.png (teal square, white document + plus). Stdlib only."""
import os
import struct
import zlib

TEAL = (15, 110, 102)
WHITE = (255, 255, 255)
OUT = os.path.join(os.path.dirname(__file__), "..", "docs")


def draw(size):
    px = [[TEAL] * size for _ in range(size)]

    def rect(x0, y0, x1, y1, color):
        for y in range(int(y0 * size), int(y1 * size)):
            for x in range(int(x0 * size), int(x1 * size)):
                px[y][x] = color

    rect(0.27, 0.18, 0.73, 0.82, WHITE)          # page
    for i, w in enumerate((0.34, 0.34, 0.22)):   # text lines
        y = 0.30 + i * 0.09
        rect(0.34, y, 0.34 + w, y + 0.035, TEAL)
    rect(0.47, 0.57, 0.53, 0.75, TEAL)            # plus
    rect(0.41, 0.63, 0.59, 0.69, TEAL)
    return px


def png(px):
    h, w = len(px), len(px[0])
    raw = b"".join(b"\x00" + bytes(c for p in row for c in p) for row in px)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


for size in (180, 512):
    with open(os.path.join(OUT, f"icon-{size}.png"), "wb") as f:
        f.write(png(draw(size)))
print("icons written")

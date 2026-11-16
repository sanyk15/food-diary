"""Генерирует PNG-иконки дневника питания без внешних зависимостей.

Запуск: python3 scripts/gen-icons.py
Результат: public/icon-192.png, public/icon-512.png, public/apple-touch-icon.png

Рисунок: скруглённый квадрат с градиентом, белая тарелка и «еда» в центре.
"""
import os
import struct
import sys
import zlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")

C1 = (0x4C, 0xC0, 0x8A)
C2 = (0x21, 0x8A, 0x5C)
RADIUS = 15 / 64
PLATE_R = 17 / 64
FOOD_R = 9 / 64
FOOD = (0xF0, 0xA1, 0x3A)


def inside_round_rect(px, py, x, y, w, h, r):
    if px < x or px > x + w or py < y or py > y + h:
        return False
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def sample(u, v):
    """u, v в долях [0,1] — возвращает (r,g,b,a)."""
    if not inside_round_rect(u, v, 0, 0, 1, 1, RADIUS):
        return (0, 0, 0, 0)
    dx, dy = u - 0.5, v - 0.5
    d2 = dx * dx + dy * dy
    if d2 <= FOOD_R * FOOD_R:
        return (*FOOD, 255)
    if d2 <= PLATE_R * PLATE_R:
        return (255, 255, 255, 255)
    t = (u + v) / 2
    return (
        int(C1[0] + (C2[0] - C1[0]) * t),
        int(C1[1] + (C2[1] - C1[1]) * t),
        int(C1[2] + (C2[2] - C1[2]) * t),
        255,
    )


def render(size, ss):
    rows = []
    step = 1.0 / (size * ss)
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = a = 0
            for sy in range(ss):
                for sx in range(ss):
                    u = (x * ss + sx + 0.5) * step
                    v = (y * ss + sy + 0.5) * step
                    sr, sg, sb, sa = sample(u, v)
                    r += sr * sa
                    g += sg * sa
                    b += sb * sa
                    a += sa
            n = ss * ss
            if a == 0:
                row.extend((0, 0, 0, 0))
            else:
                row.extend((r // a, g // a, b // a, a // n))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    jobs = [
        ("icon-192.png", 192, 4),
        ("icon-512.png", 512, 2),
        ("apple-touch-icon.png", 180, 4),
    ]
    for name, size, ss in jobs:
        rows = render(size, ss)
        write_png(os.path.join(OUT, name), size, rows)
        print("ok", name, size)


if __name__ == "__main__":
    sys.exit(main())

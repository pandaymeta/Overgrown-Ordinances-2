"""Build an original illustrated itch.io thumbnail for Overgrown Ordinances."""
from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT_PATH = ROOT / 'assets' / 'fonts' / 'averia-libre-bold.ttf'
FONT_REGULAR = ROOT / 'tools' / '_thumbnail_work' / 'AveriaLibre-Regular.ttf'
OUT_PATH = ROOT / 'assets' / 'overgrown-ordinances-thumbnail-itch.png'
OUT_2X_PATH = ROOT / 'assets' / 'overgrown-ordinances-thumbnail-itch@2x.png'

WIDTH = 630
HEIGHT = 500
BANNER_RATIO = 0.34

PAPER_CREAM = (247, 243, 235)
PAPER_TEXT = (107, 101, 96)
PAPER_SHADOW = (78, 72, 66)
TITLE = 'Overgrown Ordinances'

# Illustration palette — matches the game's warm civic-afternoon look.
SKY_TOP = (255, 168, 108)
SKY_MID = (255, 206, 162)
SKY_HORIZON = (196, 214, 226)
ASPHALT = (34, 36, 40)
ASPHALT_LIGHT = (52, 54, 58)
SIDEWALK = (196, 186, 168)
GRASS = (88, 158, 92)
GRASS_DARK = (62, 128, 68)
BUILDING = (228, 196, 156)
BUILDING_SHADE = (196, 158, 118)
ROOF = (84, 68, 62)
TRAM_GREEN = (52, 132, 78)
TRAM_WHITE = (242, 238, 230)
TAXI = (248, 204, 54)
TAXI_SHADE = (214, 168, 36)
MAILBOX = (214, 62, 54)
MAILBOX_SHADE = (168, 42, 38)
SIGN = (248, 246, 240)
SIGN_POLE = (118, 112, 104)
BLOSSOM = (244, 136, 168)
BLOSSOM_DEEP = (214, 96, 132)
VINE = (48, 124, 66)
VINE_LIGHT = (88, 168, 96)
CONE = (236, 118, 42)
PETAL = (250, 170, 190)


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _lerp_color(c1: tuple[int, int, int], c2: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(_lerp(c1[i], c2[i], t)) for i in range(3))  # type: ignore[return-value]


def _shade(color: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, int(c * amount))) for c in color)  # type: ignore[return-value]


class Canvas:
    def __init__(self, w: int, h: int, scale: float) -> None:
        self.w = w
        self.h = h
        self.scale = scale
        self.img = Image.new('RGBA', (w, h), (0, 0, 0, 255))
        self.draw = ImageDraw.Draw(self.img, 'RGBA')

    def s(self, value: float) -> float:
        return value * self.scale


def draw_sky(c: Canvas) -> None:
    for y in range(c.h):
        t = y / max(1, c.h - 1)
        if t < 0.55:
            color = _lerp_color(SKY_TOP, SKY_MID, t / 0.55)
        else:
            color = _lerp_color(SKY_MID, SKY_HORIZON, (t - 0.55) / 0.45)
        c.draw.line([(0, y), (c.w, y)], fill=color + (255,))

    # Sun disc.
    sun_x, sun_y, sun_r = c.s(500), c.s(72), c.s(34)
    c.draw.ellipse((sun_x - sun_r, sun_y - sun_r, sun_x + sun_r, sun_y + sun_r), fill=(255, 228, 168, 220))
    c.draw.ellipse((sun_x - sun_r * 0.72, sun_y - sun_r * 0.72, sun_x + sun_r * 0.72, sun_y + sun_r * 0.72), fill=(255, 244, 210, 240))

    # Low-poly sunset clouds.
    clouds = (
        ((40, 58, 180, 34), (255, 220, 190)),
        ((210, 44, 120, 28), (255, 198, 168)),
        ((430, 52, 150, 30), (255, 210, 178)),
        ((520, 78, 90, 22), (240, 200, 176)),
    )
    for (x, y, w, h), tone in clouds:
        pts = [
            (c.s(x), c.s(y + h * 0.45)),
            (c.s(x + w * 0.22), c.s(y)),
            (c.s(x + w * 0.55), c.s(y + h * 0.12)),
            (c.s(x + w * 0.82), c.s(y)),
            (c.s(x + w), c.s(y + h * 0.55)),
            (c.s(x + w * 0.72), c.s(y + h)),
            (c.s(x + w * 0.35), c.s(y + h * 0.82)),
        ]
        c.draw.polygon(pts, fill=tone + (220,))


def draw_hills(c: Canvas, base_y: float) -> None:
    y0 = c.s(base_y)
    pts = [
        (0, c.h),
        (0, y0),
        (c.s(80), y0 - c.s(18)),
        (c.s(180), y0 - c.s(8)),
        (c.s(290), y0 - c.s(24)),
        (c.s(420), y0 - c.s(10)),
        (c.s(520), y0 - c.s(20)),
        (c.w, y0 - c.s(6)),
        (c.w, c.h),
    ]
    c.draw.polygon(pts, fill=GRASS_DARK + (255,))
    c.draw.polygon(
        [(c.s(0), y0), (c.s(120), y0 - c.s(12)), (c.s(260), y0 - c.s(4)), (c.s(420), y0 - c.s(16)), (c.s(630), y0 - c.s(5)), (c.w, y0), (c.w, y0 + c.s(40)), (0, y0 + c.s(40))],
        fill=GRASS + (255,),
    )


def draw_building(c: Canvas, x: float, base_y: float, w: float, h: float, depth: float, awning: bool = False) -> None:
    bx, by = c.s(x), c.s(base_y)
    bw, bh, bd = c.s(w), c.s(h), c.s(depth)
    c.draw.polygon([(bx, by), (bx + bw, by), (bx + bw, by - bh), (bx, by - bh)], fill=BUILDING + (255,))
    c.draw.polygon([(bx + bw, by), (bx + bw + bd, by - bd * 0.45), (bx + bw + bd, by - bh - bd * 0.45), (bx + bw, by - bh)], fill=BUILDING_SHADE + (255,))
    c.draw.polygon([(bx - c.s(4), by - bh), (bx + bw + c.s(4), by - bh), (bx + bw + bd, by - bh - bd * 0.45), (bx + bd * 0.3, by - bh - bd * 0.55)], fill=ROOF + (255,))
    for row in range(2):
        wy = by - bh * (0.28 + row * 0.28)
        c.draw.rectangle((bx + bw * 0.18, wy, bx + bw * 0.42, wy + bh * 0.14), fill=(120, 168, 196, 180))
        c.draw.rectangle((bx + bw * 0.56, wy, bx + bw * 0.8, wy + bh * 0.14), fill=(120, 168, 196, 180))
    if awning:
        c.draw.polygon([(bx + bw * 0.08, by - bh * 0.08), (bx + bw * 0.92, by - bh * 0.08), (bx + bw * 0.86, by - bh * 0.18), (bx + bw * 0.14, by - bh * 0.18)], fill=(214, 72, 68, 255))
        c.draw.line([(bx + bw * 0.08, by - bh * 0.08), (bx + bw * 0.92, by - bh * 0.08)], fill=(250, 246, 238, 220), width=max(1, int(c.s(2))))


def draw_power_lines(c: Canvas, base_y: float) -> None:
    pole_x = [c.s(150), c.s(340), c.s(510)]
    ground = c.s(base_y - 120)
    for px in pole_x:
        c.draw.rectangle((px - c.s(3), ground, px + c.s(3), c.s(base_y - 10)), fill=SIGN_POLE + (255,))
        c.draw.ellipse((px - c.s(5), ground - c.s(8), px + c.s(5), ground + c.s(2)), fill=(72, 66, 60, 255))
    c.draw.line([(c.s(40), ground + c.s(8)), (c.s(590), ground + c.s(2))], fill=(48, 44, 42, 220), width=max(1, int(c.s(2))))
    c.draw.line([(c.s(60), ground + c.s(18)), (c.s(580), ground + c.s(12))], fill=(48, 44, 42, 180), width=max(1, int(c.s(1.5))))


def draw_road(c: Canvas, base_y: float) -> None:
    y = c.s(base_y)
    c.draw.polygon(
        [(c.s(40), y), (c.s(590), y), (c.s(540), c.h), (c.s(90), c.h)],
        fill=ASPHALT + (255,),
    )
    c.draw.polygon(
        [(c.s(90), c.h), (c.s(540), c.h), (c.s(500), y + c.s(18)), (c.s(130), y + c.s(18))],
        fill=ASPHALT_LIGHT + (255,),
    )
    # Crosswalk.
    for i in range(6):
        x = c.s(250 + i * 22)
        c.draw.polygon(
            [(x, y + c.s(8)), (x + c.s(12), y + c.s(8)), (x + c.s(18), c.h - c.s(40)), (x + c.s(6), c.h - c.s(40))],
            fill=(238, 234, 226, 240),
        )
    # Sidewalk strips.
    c.draw.polygon([(c.s(40), y), (c.s(90), c.h), (c.s(130), c.h), (c.s(130), y + c.s(18))], fill=SIDEWALK + (255,))
    c.draw.polygon([(c.s(500), y + c.s(18)), (c.s(540), c.h), (c.s(590), y), (c.s(540), y)], fill=_shade(SIDEWALK, 0.92) + (255,))


def draw_blossom_tree(c: Canvas, x: float, base_y: float, scale: float) -> None:
    bx, by = c.s(x), c.s(base_y)
    sc = c.s(scale)
    trunk_w = 14 * sc
    c.draw.rectangle((bx - trunk_w / 2, by - 42 * sc, bx + trunk_w / 2, by), fill=(98, 72, 58, 255))
    crown_y = by - 58 * sc
    for ox, oy, r in (
        (-26, 8, 24), (0, 0, 30), (24, 10, 22), (-10, -18, 26), (16, -14, 20), (-18, 16, 18),
    ):
        cx, cy, rad = bx + ox * sc, crown_y + oy * sc, r * sc
        c.draw.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=BLOSSOM + (255,))
        c.draw.ellipse((cx - rad * 0.55, cy - rad * 0.65, cx + rad * 0.35, cy + rad * 0.15), fill=BLOSSOM_DEEP + (180,))


def draw_vine(c: Canvas, points: list[tuple[float, float]], width: float) -> None:
    scaled = [(c.s(x), c.s(y)) for x, y in points]
    c.draw.line(scaled, fill=VINE + (230,), width=max(2, int(c.s(width))), joint='curve')
    for x, y in points[3::4]:
        sx, sy = c.s(x), c.s(y)
        r = c.s(4)
        c.draw.ellipse((sx - r, sy - r, sx + r, sy + r * 1.2), fill=VINE_LIGHT + (240,))


def draw_sign(c: Canvas, x: float, base_y: float, board_w: float, board_h: float, lean: float = 0.0, label: str | None = None) -> None:
    bx, by = c.s(x), c.s(base_y)
    pole_h = c.s(58)
    c.draw.rectangle((bx - c.s(2), by - pole_h, bx + c.s(2), by), fill=SIGN_POLE + (255,))
    tilt = c.s(lean)
    board = [
        (bx - c.s(board_w / 2) + tilt, by - pole_h - c.s(board_h)),
        (bx + c.s(board_w / 2) + tilt, by - pole_h - c.s(board_h)),
        (bx + c.s(board_w / 2) - tilt, by - pole_h - c.s(4)),
        (bx - c.s(board_w / 2) - tilt, by - pole_h - c.s(4)),
    ]
    c.draw.polygon(board, fill=SIGN + (255,), outline=(170, 162, 152, 255))
    if label and FONT_REGULAR.exists():
        font = ImageFont.truetype(str(FONT_REGULAR), max(7, int(c.s(7))))
        bbox = c.draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = bx - tw / 2 + tilt - bbox[0]
        ty = by - pole_h - c.s(board_h * 0.72) - th / 2 - bbox[1]
        c.draw.text((tx, ty), label, font=font, fill=(52, 48, 44, 255))
    else:
        c.draw.line(
            [(bx - c.s(board_w * 0.28) + tilt, by - pole_h - c.s(board_h * 0.55)), (bx + c.s(board_w * 0.28) + tilt, by - pole_h - c.s(board_h * 0.55))],
            fill=(196, 190, 180, 180),
            width=max(1, int(c.s(2))),
        )


def draw_cone(c: Canvas, x: float, y: float, scale: float) -> None:
    sx, sy = c.s(x), c.s(y)
    sc = c.s(scale)
    c.draw.polygon([(sx, sy - 18 * sc), (sx - 10 * sc, sy), (sx + 10 * sc, sy)], fill=CONE + (255,))
    c.draw.rectangle((sx - 11 * sc, sy - 2 * sc, sx + 11 * sc, sy + 3 * sc), fill=(240, 236, 228, 255))
    c.draw.line([(sx - 7 * sc, sy - 10 * sc), (sx + 7 * sc, sy - 10 * sc)], fill=(250, 246, 238, 220), width=max(1, int(sc)))


def draw_tram(c: Canvas, x: float, y: float) -> None:
    sx, sy = c.s(x), c.s(y)
    body = [(sx, sy), (sx + c.s(118), sy), (sx + c.s(126), sy - c.s(34)), (sx + c.s(8), sy - c.s(34))]
    c.draw.polygon(body, fill=TRAM_WHITE + (255,), outline=(148, 140, 132, 255))
    c.draw.polygon([(sx + c.s(8), sy - c.s(34)), (sx + c.s(126), sy - c.s(34)), (sx + c.s(118), sy - c.s(42)), (sx, sy - c.s(42))], fill=TRAM_GREEN + (255,))
    for wx in (22, 52, 82):
        c.draw.rectangle((sx + c.s(wx), sy - c.s(28), sx + c.s(wx + 18), sy - c.s(10)), fill=(156, 198, 216, 210))
    c.draw.rectangle((sx + c.s(18), sy - c.s(6), sx + c.s(108), sy - c.s(2)), fill=(58, 58, 62, 255))
    # Pantograph.
    c.draw.line([(sx + c.s(62), sy - c.s(42)), (sx + c.s(62), sy - c.s(56))], fill=(68, 64, 60, 255), width=max(1, int(c.s(2))))


def draw_taxi(c: Canvas, x: float, y: float) -> None:
    sx, sy = c.s(x), c.s(y)
    c.draw.polygon([(sx, sy), (sx + c.s(72), sy), (sx + c.s(78), sy - c.s(24)), (sx + c.s(6), sy - c.s(24))], fill=TAXI + (255,))
    c.draw.polygon([(sx + c.s(6), sy - c.s(24)), (sx + c.s(78), sy - c.s(24)), (sx + c.s(72), sy - c.s(30)), (sx, sy - c.s(30))], fill=TAXI_SHADE + (255,))
    c.draw.rectangle((sx + c.s(18), sy - c.s(22), sx + c.s(34), sy - c.s(10)), fill=(180, 220, 232, 220))
    c.draw.rectangle((sx + c.s(44), sy - c.s(22), sx + c.s(60), sy - c.s(10)), fill=(180, 220, 232, 220))
    c.draw.ellipse((sx + c.s(10), sy - c.s(4), sx + c.s(22), sy + c.s(6)), fill=(36, 36, 40, 255))
    c.draw.ellipse((sx + c.s(54), sy - c.s(4), sx + c.s(66), sy + c.s(6)), fill=(36, 36, 40, 255))


def draw_mailbox(c: Canvas, x: float, y: float) -> None:
    sx, sy = c.s(x), c.s(y)
    c.draw.rectangle((sx - c.s(8), sy - c.s(52), sx + c.s(8), sy), fill=(88, 72, 64, 255))
    c.draw.rounded_rectangle((sx - c.s(34), sy - c.s(88), sx + c.s(34), sy - c.s(18)), radius=c.s(8), fill=MAILBOX + (255,))
    c.draw.rounded_rectangle((sx - c.s(34), sy - c.s(88), sx + c.s(34), sy - c.s(58)), radius=c.s(8), fill=MAILBOX_SHADE + (255,))
    c.draw.arc((sx - c.s(18), sy - c.s(52), sx + c.s(18), sy - c.s(24)), 20, 160, fill=(250, 246, 238, 255), width=max(2, int(c.s(3))))
    # Envelope.
    c.draw.rectangle((sx + c.s(8), sy - c.s(46), sx + c.s(28), sy - c.s(34)), fill=(248, 244, 236, 255), outline=(180, 60, 52, 255))
    c.draw.polygon([(sx + c.s(8), sy - c.s(46)), (sx + c.s(18), sy - c.s(40)), (sx + c.s(28), sy - c.s(46))], fill=(240, 236, 228, 255))
    draw_vine(
        c,
        [(x - 34, y - 70), (x - 48, y - 92), (x - 22, y - 108), (x - 8, y - 96), (x + 6, y - 118), (x + 18, y - 88), (x + 36, y - 102), (x + 42, y - 72)],
        2.4,
    )


def draw_petals(c: Canvas, count: int) -> None:
    random.seed(11)
    for _ in range(count):
        px = random.uniform(20, 610)
        py = random.uniform(30, 280)
        r = random.uniform(2.5, 5)
        c.draw.ellipse((c.s(px - r), c.s(py - r), c.s(px + r), c.s(py + r * 0.7)), fill=PETAL + (random.randint(140, 210),))


def draw_illustrated_scene(c: Canvas) -> None:
    base_y = 292
    draw_sky(c)
    draw_hills(c, base_y - 36)
    draw_building(c, 350, base_y - 38, 92, 78, 28, awning=True)
    draw_building(c, 452, base_y - 28, 76, 62, 22)
    draw_building(c, 82, base_y - 32, 98, 70, 26)
    draw_building(c, 198, base_y - 24, 68, 52, 18)
    draw_power_lines(c, base_y - 4)
    draw_blossom_tree(c, 36, base_y + 10, 1.15)
    draw_blossom_tree(c, 596, base_y + 6, 1.0)
    draw_vine(c, [(350, base_y - 110), (338, base_y - 132), (360, base_y - 148), (378, base_y - 126)], 2.0)
    draw_vine(c, [(452, base_y - 88), (468, base_y - 108), (446, base_y - 122), (438, base_y - 98)], 1.8)
    draw_road(c, base_y + 18)
    draw_tram(c, 268, base_y + 48)
    draw_taxi(c, 418, base_y + 58)
    draw_sign(c, 156, base_y + 20, 30, 18, 3, 'NO SIGNS')
    draw_sign(c, 206, base_y + 12, 26, 16, -2)
    draw_sign(c, 238, base_y + 24, 24, 15, 1, 'RULES')
    draw_sign(c, 508, base_y + 16, 28, 17, -4)
    draw_sign(c, 538, base_y + 24, 22, 14, 2)
    draw_sign(c, 562, base_y + 18, 20, 13, -1)
    draw_sign(c, 108, base_y + 28, 20, 12, -1)
    draw_sign(c, 332, base_y + 30, 22, 14, 2, 'STOP')
    draw_cone(c, 346, base_y + 76, 1.05)
    draw_cone(c, 374, base_y + 80, 0.9)
    draw_cone(c, 232, base_y + 84, 0.95)
    draw_cone(c, 468, base_y + 78, 0.85)
    draw_mailbox(c, 58, base_y + 90)
    draw_petals(c, 36)

    # Warm foreground glow.
    glow = Image.new('RGBA', (c.w, c.h), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    for y in range(c.h):
        t = y / max(1, c.h - 1)
        if t > 0.55:
            alpha = int(_lerp(0, 28, (t - 0.55) / 0.45))
            gdraw.line([(0, y), (c.w, y)], fill=(255, 196, 132, alpha))
    c.img = Image.alpha_composite(c.img, glow)


def paper_grain(size: tuple[int, int], scale: float) -> Image.Image:
    w, h = size
    random.seed(42)
    grain = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = grain.load()
    for _ in range(int(w * h * 0.07)):
        x = random.randrange(w)
        y = random.randrange(h)
        px[x, y] = ((255, 255, 255, 14) if random.randint(0, 1) else (40, 34, 28, 12))
    return grain.filter(ImageFilter.GaussianBlur(radius=max(0.4, 0.5 * scale)))


def draw_paper_banner(w: int, banner_h: int, scale: float) -> Image.Image:
    banner = Image.new('RGBA', (w, banner_h), PAPER_CREAM + (255,))

    edge = Image.new('RGBA', (w, banner_h), (0, 0, 0, 0))
    edge_draw = ImageDraw.Draw(edge)
    edge_y = int(8 * scale)
    points: list[tuple[int, int]] = [(0, edge_y)]
    step = max(8, int(14 * scale))
    random.seed(7)
    x = 0
    while x < w:
        points.append((x, edge_y + random.randint(-2, 3)))
        x += step
    points.extend([(w, edge_y), (w, 0), (0, 0)])
    edge_draw.polygon(points, fill=(220, 212, 198, 255))
    banner = Image.alpha_composite(banner, edge)

    shadow = Image.new('RGBA', (w, banner_h), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    for y in range(int(10 * scale)):
        alpha = int(_lerp(34, 0, y / (10 * scale)))
        shadow_draw.line([(0, y), (w, y)], fill=(28, 24, 20, alpha))
    banner = Image.alpha_composite(banner, shadow)
    return Image.alpha_composite(banner, paper_grain((w, banner_h), scale))


def draw_vine_accent(draw: ImageDraw.ImageDraw, x: float, y: float, scale: float, flip: bool) -> None:
    direction = -1 if flip else 1
    points: list[tuple[float, float]] = []
    for i in range(16):
        t = i / 15
        px = x + direction * (8 + t * 34 * scale)
        py = y + math.sin(t * math.pi * 1.2) * 8 * scale + t * 18 * scale
        points.append((px, py))
    draw.line(points, fill=VINE + (220,), width=max(2, int(3 * scale)), joint='curve')
    lx, ly = points[-1]
    draw.ellipse((lx - 4 * scale, ly - 3 * scale, lx + 4 * scale, ly + 5 * scale), fill=VINE_LIGHT + (230,))


def render_title(banner: Image.Image, scale: float) -> Image.Image:
    w, h = banner.size
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    font = ImageFont.truetype(str(FONT_PATH), int(46 * scale))
    bbox = draw.textbbox((0, 0), TITLE, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (w - tw) / 2 - bbox[0]
    ty = (h * 0.52) - th / 2 - bbox[1]

    for dx, dy in ((0, int(3 * scale)), (int(2 * scale), int(4 * scale))):
        draw.text((tx + dx, ty + dy), TITLE, font=font, fill=PAPER_SHADOW + (120,))
    draw.text((tx, ty), TITLE, font=font, fill=PAPER_TEXT + (255,))
    draw_vine_accent(draw, tx - 24 * scale, ty + th * 0.55, scale, True)
    draw_vine_accent(draw, tx + tw + 18 * scale, ty + th * 0.35, scale, False)
    return Image.alpha_composite(banner, layer)


def build_thumbnail(out_w: int, out_h: int, out_path: Path) -> None:
    scale = out_w / WIDTH
    banner_h = int(out_h * BANNER_RATIO)
    scene_h = out_h - banner_h

    scene_canvas = Canvas(out_w, scene_h, scale)
    draw_illustrated_scene(scene_canvas)

    banner = draw_paper_banner(out_w, banner_h, scale)
    banner = render_title(banner, scale)

    canvas = Image.new('RGBA', (out_w, out_h), (0, 0, 0, 255))
    canvas.paste(scene_canvas.img, (0, 0))
    canvas.paste(banner, (0, scene_h), banner)

    final = canvas.filter(ImageFilter.UnsharpMask(radius=1.0, percent=85, threshold=2))
    final.convert('RGB').save(out_path, optimize=True)
    print(f'Wrote {out_path} ({out_w}x{out_h})')


def main() -> None:
    if not FONT_PATH.exists():
        raise FileNotFoundError(f'Missing font: {FONT_PATH}')
    build_thumbnail(WIDTH, HEIGHT, OUT_PATH)
    build_thumbnail(WIDTH * 2, HEIGHT * 2, OUT_2X_PATH)


if __name__ == '__main__':
    main()

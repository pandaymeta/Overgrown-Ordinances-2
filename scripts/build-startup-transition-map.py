"""
Build a continuous Summer-Afternoon-style luminance transition map.

Dark = reveals first. Runtime sharp-thresholds this field, so the silhouette can
be very irregular/splashy without blur rims or frame stutter.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules")
OUT_PNG = ROOT / "assets" / "textures" / "startup-splash" / "transition-intro.png"
OUT_SIZE = 2048


def smin(a: np.ndarray, b: np.ndarray, k: float) -> np.ndarray:
  """Polynomial smooth-min — keeps the field continuous for jitter-free thresholds."""
  h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
  return a * h + b * (1.0 - h) - k * h * (1.0 - h)


def ellipse_sdf(
  x: np.ndarray,
  y: np.ndarray,
  cx: float,
  cy: float,
  rx: float,
  ry: float,
  rot: float,
) -> np.ndarray:
  ca = np.cos(rot)
  sa = np.sin(rot)
  dx = x - cx
  dy = y - cy
  lx = dx * ca + dy * sa
  ly = -dx * sa + dy * ca
  # Approximate ellipse distance (good enough for iso-contour splash).
  q = np.sqrt((lx / rx) ** 2 + (ly / ry) ** 2)
  return q - 1.0


def main() -> None:
  size = OUT_SIZE
  yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
  x = (xx + 0.5) / size * 2.0 - 1.0
  y = (yy + 0.5) / size * 2.0 - 1.0
  r = np.sqrt(x * x + y * y)
  ang = np.arctan2(y, x)

  # Core splash body — strong asymmetric lobes (water hit), still C0-smooth.
  core_lobes = (
    0.34 * np.cos(3.0 * ang + 0.55)
    + 0.26 * np.cos(5.0 * ang - 1.15)
    + 0.18 * np.cos(7.0 * ang + 0.8)
    + 0.14 * np.sin(4.0 * ang + 1.7)
    + 0.10 * np.cos(9.0 * ang - 0.4)
    + 0.08 * np.sin(2.0 * ang - 2.3)
    + 0.06 * np.cos(11.0 * ang + 1.1)
  )
  # Angular pinch for sharper spray tips without discontinuous jumps.
  tips = 0.12 * np.maximum(0.0, np.cos(6.0 * ang + 0.3)) ** 2
  core_radius = 0.22 * (1.0 + core_lobes + tips)
  field = r - core_radius

  # Satellite droplets / spray blobs (offset ellipses) for a splashier silhouette.
  droplets = [
    # (cx, cy, rx, ry, rot, blend_k)
    (0.28, -0.18, 0.16, 0.10, 0.55, 0.08),
    (-0.26, -0.12, 0.14, 0.11, -0.7, 0.08),
    (0.08, 0.30, 0.15, 0.09, 0.2, 0.07),
    (-0.18, 0.26, 0.12, 0.14, -0.35, 0.07),
    (0.36, 0.14, 0.11, 0.07, 0.9, 0.06),
    (-0.34, 0.08, 0.10, 0.08, -1.1, 0.06),
    (0.22, 0.36, 0.08, 0.12, 0.45, 0.05),
    (-0.08, -0.34, 0.13, 0.07, -0.15, 0.06),
    (0.42, -0.06, 0.07, 0.05, 0.3, 0.045),
    (-0.40, -0.22, 0.06, 0.09, -0.8, 0.045),
    (0.14, -0.40, 0.09, 0.05, 0.1, 0.05),
    (-0.30, 0.34, 0.07, 0.06, -0.5, 0.05),
  ]
  for cx, cy, rx, ry, rot, k in droplets:
    field = smin(field, ellipse_sdf(x, y, cx, cy, rx, ry, rot), k)

  # Mild spiral warp so UV-zoom reads as spinning water, not a static cutout.
  spin = 0.045 * r * np.sin(3.0 * ang + r * 7.5)
  field = field + spin

  # Map SDF → 0..1 luminance (dark centre opens first). Keep continuous — no posterize.
  # Shift so interior is negative → near 0 after normalize.
  field = field + 0.04
  # Compress dynamic range so mid-progress silhouettes stay splashy, not circular.
  lum = np.clip(field * 0.95 + 0.42, 0.0, 1.0)
  # Guaranteed clean dark seed at the very centre.
  lum = np.where(r < 0.018, 0.0, lum)

  img = Image.fromarray((lum * 255.0).astype(np.uint8), mode="L")
  OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
  img.save(OUT_PNG, optimize=True)
  print(f"wrote {OUT_PNG} {img.size}")


if __name__ == "__main__":
  main()

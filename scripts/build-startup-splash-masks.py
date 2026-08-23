"""
Build cleaned soft splash masks from reference video frames.

- White overlay vs hole via luma/sat threshold
- Remove white speckles inside the hole + stray hole dots in the cover
- Soft feathered edges (rounded, less pixelated)
- High-res LANCZOS output for CSS mask-image
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

RAW = Path(r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules\tmp-splash-raw")
OUT = Path(r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules\assets\textures\startup-splash")
OUT_WIDTH = 1280
MAX_FRAMES = 28
EDGE_BLUR_RADIUS = 3.2
MIN_COVER_ISLAND_FRAC = 0.0004
MIN_HOLE_ISLAND_FRAC = 0.00025


def threshold_cover(arr: np.ndarray) -> np.ndarray:
  """bool cover mask from RGB uint8 HxWx3/4."""
  rgb = arr[..., :3].astype(np.float32)
  lum = rgb.mean(axis=2)
  sat = rgb.max(axis=2) - rgb.min(axis=2)
  return (lum >= 232.0) & (sat <= 32.0)


def label_components(binary: np.ndarray) -> tuple[np.ndarray, int]:
  """4-connected component labels. Returns labels (0=bg), count."""
  h, w = binary.shape
  labels = np.zeros((h, w), dtype=np.int32)
  current = 0
  for y in range(h):
    for x in range(w):
      if not binary[y, x] or labels[y, x]:
        continue
      current += 1
      stack = [(y, x)]
      labels[y, x] = current
      while stack:
        cy, cx = stack.pop()
        for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
          if ny < 0 or nx < 0 or ny >= h or nx >= w:
            continue
          if not binary[ny, nx] or labels[ny, nx]:
            continue
          labels[ny, nx] = current
          stack.append((ny, nx))
  return labels, current


def filter_islands(
  binary: np.ndarray,
  *,
  min_pixels: int,
  keep_border_touching: bool,
  keep_largest: bool,
) -> np.ndarray:
  labels, count = label_components(binary)
  if count == 0:
    return binary
  h, w = binary.shape
  sizes = np.bincount(labels.ravel())
  keep = np.zeros(count + 1, dtype=bool)
  if keep_largest:
    keep[int(np.argmax(sizes[1:])) + 1] = True
  for i in range(1, count + 1):
    if sizes[i] >= min_pixels:
      keep[i] = True
    if keep_border_touching:
      ys, xs = np.where(labels == i)
      if (
        (xs == 0).any()
        or (ys == 0).any()
        or (xs == w - 1).any()
        or (ys == h - 1).any()
      ):
        keep[i] = True
  out = keep[labels]
  return out


def process_frame(path: Path) -> tuple[Image.Image, float] | None:
  im = Image.open(path).convert("RGBA")
  arr = np.asarray(im)
  cover = threshold_cover(arr)
  h, w = cover.shape
  min_cover = max(24, int(h * w * MIN_COVER_ISLAND_FRAC))
  min_hole = max(16, int(h * w * MIN_HOLE_ISLAND_FRAC))

  # Drop tiny white islands inside the hole (unless they touch the border).
  cover = filter_islands(
    cover,
    min_pixels=min_cover,
    keep_border_touching=True,
    keep_largest=False,
  )
  # Drop stray hole dots in the cover; keep the main centre hole (+ large pieces).
  hole = ~cover
  hole = filter_islands(
    hole,
    min_pixels=min_hole,
    keep_border_touching=False,
    keep_largest=True,
  )
  cover = ~hole

  hole_frac = float(hole.mean())
  if not (0.002 <= hole_frac <= 0.94):
    return None

  mask = Image.fromarray((cover.astype(np.uint8) * 255), mode="L")
  soft = mask.filter(ImageFilter.GaussianBlur(radius=EDGE_BLUR_RADIUS))
  soft_arr = np.asarray(soft)
  rgba = np.zeros((h, w, 4), dtype=np.uint8)
  rgba[..., 0:3] = 255
  rgba[..., 3] = soft_arr
  out = Image.fromarray(rgba, mode="RGBA")
  return out, hole_frac


def main() -> None:
  OUT.mkdir(parents=True, exist_ok=True)
  for old in OUT.glob("splash-*.png"):
    old.unlink()

  frames = sorted(RAW.glob("frame-*.png"))
  if not frames:
    raise SystemExit(f"No raw frames in {RAW}")

  seq: list[tuple[Image.Image, float]] = []
  for path in frames:
    result = process_frame(path)
    if result is not None:
      seq.append(result)

  if not seq:
    raise SystemExit("No usable splash frames after threshold")

  if len(seq) > MAX_FRAMES:
    step = len(seq) / MAX_FRAMES
    seq = [seq[min(len(seq) - 1, int(i * step))] for i in range(MAX_FRAMES)]

  manifest = []
  for idx, (rgba, frac) in enumerate(seq):
    tw = OUT_WIDTH
    th = max(1, int(round(OUT_WIDTH * rgba.size[1] / rgba.size[0])))
    rgba = rgba.resize((tw, th), Image.Resampling.LANCZOS)
    name = f"splash-{idx:02d}.png"
    rgba.save(OUT / name, optimize=True)
    manifest.append({"file": name, "hole": round(frac, 4)})

  (OUT / "manifest.json").write_text(json.dumps({"frames": manifest}, indent=2), encoding="utf-8")
  print(f"wrote {len(manifest)} masks @ {OUT_WIDTH}px")
  print("hole range", manifest[0]["hole"], "->", manifest[-1]["hole"])


if __name__ == "__main__":
  main()

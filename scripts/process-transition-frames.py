"""Rebuild cream transition frames: uniform #f4f1ea cover, clean holes, no UI/cursor junk."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VIDEO = Path(r"C:\Users\Reyjhon Entenia\Documents\Overgrown\transitionplease.mp4")
RAW = ROOT / "assets" / "textures" / "startup-splash" / "transition-raw"
OUT_PNG = ROOT / "assets" / "textures" / "startup-splash" / "transition-cream-png"
ATLAS_PATH = ROOT / "assets" / "textures" / "startup-splash" / "transition-cream-atlas.png"
ATLAS_META = ROOT / "assets" / "textures" / "startup-splash" / "transition-cream-atlas.json"

# Match Overgrown Rules panel cream (#f4f1ea).
CREAM = np.array([0xF4, 0xF1, 0xEA], dtype=np.uint8)
TARGET_W = 1280
FPS = 30
ATLAS_FRAME_W = 640
ATLAS_FRAME_H = 357
ATLAS_COLS = 6
STRUCTURE = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=np.uint8)


def probe_video(video: Path) -> float:
  result = subprocess.check_output(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=duration",
      "-of",
      "csv=p=0",
      str(video),
    ],
    text=True,
  ).strip()
  return float(result)


def extract_raw(video: Path) -> list[Path]:
  RAW.mkdir(parents=True, exist_ok=True)
  for old in RAW.glob("frame-*.png"):
    old.unlink()
  subprocess.check_call(
    ["ffmpeg", "-y", "-i", str(video), "-vsync", "0", str(RAW / "frame-%02d.png")],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
  )
  frames = sorted(RAW.glob("frame-*.png"))
  if len(frames) < 10:
    raise SystemExit(f"Expected video frames in {RAW}, got {len(frames)}")
  return frames


def green_score(r: np.ndarray, g: np.ndarray, b: np.ndarray) -> np.ndarray:
  dom = (g - np.maximum(r, b)) / 255.0
  sat = (g - (r + b) * 0.5) / 255.0
  score = np.clip(dom * 1.5 + sat * 0.7, 0.0, 1.0)
  score = np.where(g < 70.0, 0.0, score)
  key_dist = np.sqrt(r * r + (g - 255.0) ** 2 + b * b)
  near_key = np.clip(1.0 - key_dist / 100.0, 0.0, 1.0)
  return np.maximum(score, near_key)


def keep_top_connected(opaque: np.ndarray) -> np.ndarray:
  labeled, _ = ndi.label(opaque, structure=STRUCTURE)
  top_labels = set(np.unique(labeled[0, :]).tolist()) - {0}
  if not top_labels:
    return np.zeros_like(opaque, dtype=bool)
  return np.isin(labeled, list(top_labels))


def fill_enclosed_holes(keep: np.ndarray, max_hole_area: int) -> np.ndarray:
  h, w = keep.shape
  holes = ~keep
  hole_labels, hole_count = ndi.label(holes, structure=STRUCTURE)
  out = keep.copy()
  for hid in range(1, hole_count + 1):
    mask = hole_labels == hid
    area = int(mask.sum())
    if area == 0 or area > max_hole_area:
      continue
    ys, xs = np.where(mask)
    if ys.min() == 0 or xs.min() == 0 or ys.max() == h - 1 or xs.max() == w - 1:
      continue
    out[mask] = True
  return out


def scrub_ui_floaters(keep: np.ndarray, ui_zone: np.ndarray, min_area: int) -> np.ndarray:
  floating = ui_zone & keep
  labeled, count = ndi.label(floating, structure=STRUCTURE)
  out = keep.copy()
  for uid in range(1, count + 1):
    mask = labeled == uid
    if int(mask.sum()) < min_area:
      out[mask] = False
  return out


def process_frame(im: Image.Image) -> Image.Image:
  rgb = np.asarray(im.convert("RGB"), dtype=np.float32)
  r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
  h, w = r.shape
  luma = (r + g + b) / 3.0
  gn = green_score(r, g, b)

  near_white = (luma > 232.0) & (np.abs(r - g) < 22.0) & (np.abs(g - b) < 22.0)
  cover = gn >= 0.22
  beige = (
    (luma > 180.0)
    & (luma <= 245.0)
    & (r > g - 8)
    & (g > b - 8)
    & (r - b > 4)
    & (gn < 0.22)
    & (~near_white)
  )

  yy = np.linspace(0, 1, h, endpoint=False)[:, None]
  xx = np.linspace(0, 1, w, endpoint=False)[None, :]
  ui_zone = (yy > 0.86) & (xx > 0.58)

  opaque = (cover | beige) & (~near_white)
  keep = keep_top_connected(opaque)
  keep = fill_enclosed_holes(keep, max_hole_area=max(150, (h * w) // 5000))
  keep = scrub_ui_floaters(keep, ui_zone, min_area=max(500, (h * w) // 1500))
  keep = keep_top_connected(keep)

  out = np.zeros((h, w, 4), dtype=np.uint8)
  out[..., 0] = CREAM[0]
  out[..., 1] = CREAM[1]
  out[..., 2] = CREAM[2]
  out[..., 3] = np.where(keep, 255, 0).astype(np.uint8)
  return Image.fromarray(out, "RGBA")


def build_atlas(frames: list[Image.Image], duration_sec: float) -> None:
  imgs = [
    im.resize((ATLAS_FRAME_W, ATLAS_FRAME_H), Image.Resampling.LANCZOS) for im in frames
  ]
  cols = ATLAS_COLS
  rows = (len(imgs) + cols - 1) // cols
  atlas = Image.new("RGBA", (cols * ATLAS_FRAME_W, rows * ATLAS_FRAME_H), (0, 0, 0, 0))
  for i, im in enumerate(imgs):
    c, row = i % cols, i // cols
    atlas.paste(im, (c * ATLAS_FRAME_W, row * ATLAS_FRAME_H))
  atlas.save(ATLAS_PATH, "PNG", optimize=True)
  ATLAS_META.write_text(
    json.dumps(
      {
        "frameCount": len(imgs),
        "cols": cols,
        "rows": rows,
        "frameWidth": ATLAS_FRAME_W,
        "frameHeight": ATLAS_FRAME_H,
        "durationSec": duration_sec,
        "fps": FPS,
        "cream": "#f4f1ea",
      },
      indent=2,
    )
    + "\n",
    encoding="utf-8",
  )
  print(f"atlas {ATLAS_PATH} {ATLAS_PATH.stat().st_size} bytes {atlas.size}")


def main() -> None:
  parser = argparse.ArgumentParser(description="Process green-screen transition video into cream atlas.")
  parser.add_argument(
    "--video",
    type=Path,
    default=DEFAULT_VIDEO,
    help="Source MP4 (green = cream cover, white = scene hole).",
  )
  args = parser.parse_args()
  video = args.video.resolve()
  if not video.is_file():
    raise SystemExit(f"Video not found: {video}")

  duration_sec = probe_video(video)
  OUT_PNG.mkdir(parents=True, exist_ok=True)
  raw_frames = extract_raw(video)
  cleaned: list[Image.Image] = []
  manifest = []
  for i, path in enumerate(raw_frames):
    im = Image.open(path)
    if im.width > TARGET_W:
      ratio = TARGET_W / im.width
      im = im.resize((TARGET_W, max(1, int(im.height * ratio))), Image.Resampling.LANCZOS)
    out = process_frame(im)
    name = f"cream-{i:02d}.png"
    out.save(OUT_PNG / name, "PNG", optimize=True)
    arr = np.asarray(out)
    opaque = arr[..., 3] > 8
    if opaque.any():
      rgb = arr[opaque][:, :3]
      if not np.all(rgb == CREAM):
        raise SystemExit(f"Non-uniform cream in {name}")
    cleaned.append(out)
    manifest.append({"file": name, "opaqueApprox": round(float(opaque.mean()), 4)})
    print(f"{name} opaque~{float(opaque.mean()):.2%}")

  (OUT_PNG / "manifest.json").write_text(
    json.dumps(
      {
        "frameCount": len(manifest),
        "durationSec": duration_sec,
        "fps": FPS,
        "sourceVideo": str(video),
        "cream": "#f4f1ea",
        "frames": manifest,
      },
      indent=2,
    )
    + "\n",
    encoding="utf-8",
  )
  build_atlas(cleaned, duration_sec)
  print("done")


if __name__ == "__main__":
  main()

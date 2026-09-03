"""Rebuild the cream paper-tear transition from its green-screen source video."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VIDEO = Path(r"C:\Users\Reyjhon Entenia\Documents\Overgrown\TransitionTear.mp4")
RAW = ROOT / "assets" / "textures" / "startup-splash" / "transition-raw"
OUT_PNG = ROOT / "assets" / "textures" / "startup-splash" / "transition-cream-png"
ATLAS_PATH = ROOT / "assets" / "textures" / "startup-splash" / "transition-tear-cream-atlas.png"
ATLAS_META = ROOT / "assets" / "textures" / "startup-splash" / "transition-tear-cream-atlas.json"

# Match Overgrown Rules panel cream (#f4f1ea).
CREAM = np.array([0xF4, 0xF1, 0xEA], dtype=np.uint8)
TARGET_W = 1280
FPS = 30
ATLAS_FRAME_W = 640
ATLAS_FRAME_H = 360
ATLAS_COLS = 6

# The source finishes its horizontal tear on frame 35, then clears the bottom
# sheet before the top sheet. Keep the tear itself intact and rebuild only the
# two clearing phases so the upper paper leaves first.
TEAR_COMPLETE_FRAME = 35
TOP_CLEAR_OUTPUT = range(36, 49)
BOTTOM_CLEAR_OUTPUT = range(49, 60)
TOP_CLEAR_SOURCE = (48, 59)
BOTTOM_CLEAR_SOURCE = (36, 49)


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


def process_frame(im: Image.Image) -> Image.Image:
  rgb = np.asarray(im.convert("RGB"), dtype=np.float32)
  r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]

  # Green is the scene opening. Use dominance instead of a single RGB value so
  # compression noise and the cast shadow over the key color remain transparent.
  # The transition band keeps a soft antialiased edge from the source tear.
  green_dominance = g - np.maximum(r, b)
  green_strength = np.clip((green_dominance - 20.0) / 55.0, 0.0, 1.0)
  brightness_gate = np.clip((g - 45.0) / 75.0, 0.0, 1.0)
  green_strength *= brightness_gate
  alpha = np.rint((1.0 - green_strength) * 255.0).astype(np.uint8)
  alpha[green_strength >= 0.96] = 0
  alpha[green_strength <= 0.04] = 255

  # Tint the source paper luminance into the loading-screen cream. This retains
  # the original grain together with the rolled cylinder, shadows, and torn
  # fibres, while discarding the source RGB so no green spill survives.
  source_luma = r * 0.2126 + g * 0.7152 + b * 0.0722
  lighting_mix = np.clip((source_luma - 80.0) / 160.0, 0.0, 1.0)
  shade_factor = 0.72 + 0.28 * lighting_mix
  cream_shaded = np.rint(CREAM[None, None, :] * shade_factor[..., None]).astype(np.uint8)

  out = np.zeros((*r.shape, 4), dtype=np.uint8)
  out[..., :3] = cream_shaded
  out[..., 3] = alpha
  return Image.fromarray(out, "RGBA")


def remap_index(output_index: int, output_range: range, source_range: tuple[int, int]) -> int:
  if len(output_range) == 1:
    return source_range[1]
  progress = (output_index - output_range.start) / (len(output_range) - 1)
  return round(source_range[0] + progress * (source_range[1] - source_range[0]))


def reverse_sheet_removal(frames: list[Image.Image]) -> list[Image.Image]:
  """Preserve the rolling tear, then clear the top sheet before the bottom."""
  if len(frames) < 60:
    raise SystemExit(f"Expected at least 60 transition frames, got {len(frames)}")

  base = frames[TEAR_COMPLETE_FRAME]
  width, height = base.size
  split_y = height // 2
  reordered = list(frames[: TEAR_COMPLETE_FRAME + 1])

  # First phase: animate only the upper sheet; hold the lower sheet in its
  # fully torn position until the upper one has disappeared.
  for output_index in TOP_CLEAR_OUTPUT:
    top_index = remap_index(output_index, TOP_CLEAR_OUTPUT, TOP_CLEAR_SOURCE)
    frame = Image.new("RGBA", base.size, (0, 0, 0, 0))
    frame.paste(frames[top_index].crop((0, 0, width, split_y)), (0, 0))
    frame.paste(base.crop((0, split_y, width, height)), (0, split_y))
    reordered.append(frame)

  # Second phase: the upper sheet remains gone while the lower sheet follows
  # the source video's original lower-sheet clearing motion.
  for output_index in BOTTOM_CLEAR_OUTPUT:
    bottom_index = remap_index(output_index, BOTTOM_CLEAR_OUTPUT, BOTTOM_CLEAR_SOURCE)
    frame = Image.new("RGBA", base.size, (0, 0, 0, 0))
    frame.paste(frames[bottom_index].crop((0, split_y, width, height)), (0, split_y))
    reordered.append(frame)

  return reordered


def build_atlas(frames: list[Image.Image], duration_sec: float, source_video: Path) -> None:
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
        "sourceVideo": str(source_video),
        "sheetRemovalOrder": ["top", "bottom"],
        "tearCompleteFrame": TEAR_COMPLETE_FRAME,
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
    help="Source MP4 (green = scene opening, paper = cream cover).",
  )
  args = parser.parse_args()
  video = args.video.resolve()
  if not video.is_file():
    raise SystemExit(f"Video not found: {video}")

  duration_sec = probe_video(video)
  OUT_PNG.mkdir(parents=True, exist_ok=True)
  raw_frames = extract_raw(video)
  cleaned: list[Image.Image] = []
  for path in raw_frames:
    im = Image.open(path)
    if im.width > TARGET_W:
      ratio = TARGET_W / im.width
      im = im.resize((TARGET_W, max(1, int(im.height * ratio))), Image.Resampling.LANCZOS)
    cleaned.append(process_frame(im))

  cleaned = reverse_sheet_removal(cleaned)
  manifest = []
  for i, out in enumerate(cleaned):
    name = f"cream-{i:02d}.png"
    out.save(OUT_PNG / name, "PNG", optimize=True)
    arr = np.asarray(out)
    opaque = arr[..., 3] > 8
    if opaque.any():
      rgb = arr[opaque][:, :3]
      if np.any(rgb > CREAM) or np.any(rgb[:, 0] < rgb[:, 1]) or np.any(rgb[:, 1] < rgb[:, 2]):
        raise SystemExit(f"Non-cream shading in {name}")
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
        "sheetRemovalOrder": ["top", "bottom"],
        "tearCompleteFrame": TEAR_COMPLETE_FRAME,
        "frames": manifest,
      },
      indent=2,
    )
    + "\n",
    encoding="utf-8",
  )
  build_atlas(cleaned, duration_sec, video)
  print("done")


if __name__ == "__main__":
  main()

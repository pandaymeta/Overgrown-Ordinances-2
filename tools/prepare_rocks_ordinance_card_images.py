"""Prepare the supplied Rocks sign art for the standard two-sided ordinance card.

The runtime transform is baked into the bitmap pixels; the card GLB keeps the
same fixed UV layout as the verified Bench/FireHydrant cards.
"""

from pathlib import Path

from PIL import Image

IMAGE_DIR = Path(r"C:\Users\Reyjhon Entenia\Documents\Overgrown\Ordinances\BenchStandardCardImages")
source = IMAGE_DIR / "Rocks_Source.png"

if not source.exists():
    raise FileNotFoundError(source)

image = Image.open(source).convert("RGBA")
# Standard upright-board compensation, proven by Bench/FireHydrant v5 cards.
image.transpose(Image.Transpose.FLIP_LEFT_RIGHT).save(IMAGE_DIR / "Rocks_RuntimeFront.png")
image.transpose(Image.Transpose.FLIP_LEFT_RIGHT).transpose(
    Image.Transpose.ROTATE_270
).save(IMAGE_DIR / "Rocks_RuntimeBack.png")

print("Prepared Rocks runtime card bitmaps")

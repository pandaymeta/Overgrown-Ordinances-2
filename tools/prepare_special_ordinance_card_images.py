from pathlib import Path
from PIL import Image

SOURCE = Path(r"C:\Users\Reyjhon Entenia\Documents\Overgrown\Ordinances")
DESTINATION = SOURCE / "BenchStandardCardImages"
CARDS = ("DoNotStep", "HighVoltage", "JayWalking", "PoleCut")

for card in CARDS:
    image = Image.open(SOURCE / f"{card}.png").convert("RGBA")
    if card == "JayWalking":
        # The JayWalking clean board has its own face axes. Compensate the
        # observed renderer transforms in the source pixels, never the UVs.
        # Front was 180° inverted in Studio: bake the compensating half-turn.
        image.transpose(Image.Transpose.FLIP_LEFT_RIGHT).save(
            DESTINATION / f"{card}_RuntimeFront.png")
        # Back was still one quarter-turn from upright. Apply that correction
        # to the bitmap itself; keep the GLB UVs untouched.
        image.transpose(Image.Transpose.FLIP_LEFT_RIGHT).transpose(
            Image.Transpose.ROTATE_270).transpose(Image.Transpose.ROTATE_270).transpose(
            Image.Transpose.ROTATE_270).transpose(Image.Transpose.ROTATE_270).transpose(
            Image.Transpose.ROTATE_270).save(
            DESTINATION / f"{card}_RuntimeBack.png")
    elif card in {"HighVoltage", "PoleCut"}:
        # Keep the model UV map fixed.  The front face's UV basis is already
        # upright, while the rear face swaps its U/V axes.  Bake the matching
        # transpose into the *bitmap* (rather than rotating any UVs).  This
        # avoids the mirrored/upside-down result in the Studio importer.
        image.save(DESTINATION / f"{card}_RuntimeFront.png")
        image.transpose(Image.Transpose.TRANSPOSE).save(
            DESTINATION / f"{card}_RuntimeBack.png")
    else:
        # Preserve the already-correct Do Not Step card transforms.
        image.transpose(Image.Transpose.FLIP_LEFT_RIGHT).save(
            DESTINATION / f"{card}_RuntimeFront.png")
        image.transpose(Image.Transpose.FLIP_LEFT_RIGHT).transpose(
            Image.Transpose.ROTATE_270).save(
            DESTINATION / f"{card}_RuntimeBack.png")
    print(f"Prepared {card}")

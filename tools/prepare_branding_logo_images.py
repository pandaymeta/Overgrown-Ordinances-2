"""Prepare branding logo bitmaps like ordinance RuntimeBack PNGs — transparent, cropped, no recolour."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_DIR = ROOT / 'assets' / 'branding' / 'runtime'
SOURCE_DIR = ROOT / 'assets' / 'branding' / 'source'

LOGOS = {
    'OvergrownLogo': 'overgrown-logo.png',
    'ByEntenium': 'by-entenium.png',
}


def prepare_runtime_back(source: Path, destination: Path) -> tuple[int, int]:
    image = Image.open(source).convert('RGBA')
    pixels = np.array(image)

    rgb = pixels[:, :, :3]
    alpha = pixels[:, :, 3]

    # Ordinance card art is cut out — no matte backdrop. Drop opaque black/dark
    # background only; never recolour the logo ink.
    dark_backdrop = (rgb.max(axis=2) < 48) & (alpha > 0)
    pixels[dark_backdrop, 3] = 0

    result = Image.fromarray(pixels, 'RGBA')
    bbox = result.split()[-1].getbbox()
    if bbox:
        result = result.crop(bbox)

    destination.parent.mkdir(parents=True, exist_ok=True)
    result.save(destination)
    return result.width, result.height


def main() -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    for card, filename in LOGOS.items():
        source = SOURCE_DIR / filename
        if not source.exists():
            raise FileNotFoundError(f'Missing source logo: {source}')
        target = RUNTIME_DIR / f'{card}_RuntimeBack.png'
        width, height = prepare_runtime_back(source, target)
        print(f'Prepared {target.name} ({width}x{height})')


if __name__ == '__main__':
    main()

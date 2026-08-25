"""Create compact SVG artwork from ordinance sign PNGs.

The SVGs contain a base sign color plus vector paths for dark lettering and red
warning marks. They deliberately exclude anti-aliased edge shades so the final
Blender meshes stay lightweight and crisp at gameplay distance.
"""

from collections import Counter
from pathlib import Path
import sys

import numpy as np
from PIL import Image
from skimage.measure import approximate_polygon, find_contours

SOURCE = Path(sys.argv[1])
OUT = Path(sys.argv[2])
# Ink-only SVGs intentionally omit the paper/yellow sign rectangle.  They are
# used when the physical sign board supplies its own base material and only the
# dark/red artwork should become raised geometry.
INK_ONLY = '--ink-only' in sys.argv[3:]
BLACK_ONLY = '--black-only' in sys.argv[3:]
DROP_FRAME = '--drop-frame' in sys.argv[3:]
OUT.mkdir(parents=True, exist_ok=True)
MAX_WIDTH = 512


def svg_paths(mask: np.ndarray, drop_frame: bool = False) -> str:
    paths: list[str] = []
    for contour in find_contours(mask.astype(np.uint8), 0.5):
        simplified = approximate_polygon(contour, tolerance=1.15)
        if len(simplified) < 4:
            continue
        if drop_frame:
            contour_width = simplified[:, 1].max() - simplified[:, 1].min()
            contour_height = simplified[:, 0].max() - simplified[:, 0].min()
            # The surrounding sign border produces two near-full-canvas paths.
            # Blender's SVG importer fills each path individually, so omit them
            # and retain the board's existing physical border instead.
            if contour_width > width * 0.84 and contour_height > height * 0.84:
                continue
        # contour stores (row, column); SVG stores (x, y).
        path = 'M ' + ' L '.join(f'{point[1]:.2f},{point[0]:.2f}' for point in simplified) + ' Z'
        paths.append(path)
    return ''.join(f'<path d="{path}"/>' for path in paths)


for png in sorted(SOURCE.glob('*.png')):
    image = Image.open(png).convert('RGB')
    scale = min(1.0, MAX_WIDTH / image.width)
    width = max(1, round(image.width * scale))
    height = max(1, round(image.height * scale))
    image = image.resize((width, height), Image.Resampling.LANCZOS)
    pixels = np.asarray(image)

    # Dominant colour is the sign's solid paper/yellow background.
    base = Counter(map(tuple, pixels.reshape(-1, 3))).most_common(1)[0][0]
    brightness = pixels.mean(axis=2)
    # Crisp dark shapes includes type, outlines, and black pictograms.
    # Keep red warning symbols separate; excludes warm yellow sign boards.
    red = (pixels[:, :, 0] > 125) & (pixels[:, :, 1] < 115) & (pixels[:, :, 2] < 115)
    # Red is visually dark by average brightness, but belongs only to its
    # dedicated warning geometry—not the black lettering/pictogram mask.
    dark = (brightness < 105) & ~red

    base_rect = '' if INK_ONLY else f'<rect width="{width}" height="{height}" fill="rgb({base[0]},{base[1]},{base[2]})"/>'
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
{base_rect}
<g fill="#111111" fill-rule="evenodd">{svg_paths(dark, DROP_FRAME)}</g>
{'' if BLACK_ONLY else f'<g fill="#e01f24" fill-rule="evenodd">{svg_paths(red, DROP_FRAME)}</g>'}
</svg>\n'''
    (OUT / f'{png.stem}.svg').write_text(svg, encoding='utf-8')
    print(f'VECTORIZED {png.name} -> {png.stem}.svg')

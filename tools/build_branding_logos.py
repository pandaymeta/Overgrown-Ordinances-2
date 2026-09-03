"""Build branding logo GLBs using the ordinance ShopSign single-face card recipe."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from pygltflib import (
    GLTF2,
    Accessor,
    Asset,
    Buffer,
    BufferView,
    Image as GltfImage,
    Material,
    Mesh,
    Node,
    PbrMetallicRoughness,
    Primitive,
    Sampler,
    Scene,
    Texture,
    TextureInfo,
)

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_DIR = ROOT / 'assets' / 'branding' / 'runtime'
OUTPUT_DIR = ROOT / 'assets' / 'branding'

# Same face depth as tools/build_streetlight_single_cards_v5.py (ShopSign style).
CARD_WIDTH = 0.887272 + 0.752728  # measured ordinance card width
BACK_FACE_DEPTH = -0.018

LOGOS = {
    'OvergrownLogo': 'overgrown-logo.glb',
    'ByEntenium': 'by-entenium.glb',
}


def _pad4(data: bytes) -> bytes:
    pad = (4 - (len(data) % 4)) % 4
    return data + b'\x00' * pad


def build_shopsign_style_glb(out_glb: Path, runtime_png: Path) -> None:
    """Mirror build_streetlight_single_cards_v5.py single_back_face + material."""
    image = Image.open(runtime_png)
    if image.width <= 0 or image.height <= 0:
        raise ValueError(f'Invalid runtime image size: {runtime_png}')

    # Keep pixel aspect exactly — width fixed to ordinance card span, height derived.
    aspect = image.width / image.height
    plane_width = CARD_WIDTH
    plane_height = plane_width / aspect
    half_width = plane_width * 0.5
    half_height = plane_height * 0.5

    y = BACK_FACE_DEPTH
    positions = np.array(
        [
            [-half_width, y, -half_height],
            [half_width, y, -half_height],
            [half_width, y, half_height],
            [-half_width, y, half_height],
        ],
        dtype=np.float32,
    )
    # Fixed UV mapping from ordinance cards — orientation comes from RuntimeBack pixels.
    uvs = np.array(
        [
            [0.0, 0.0],
            [0.0, 1.0],
            [1.0, 1.0],
            [1.0, 0.0],
        ],
        dtype=np.float32,
    )
    indices = np.array([0, 1, 2, 0, 2, 3], dtype=np.uint16)

    pos_bytes = _pad4(positions.tobytes())
    uv_bytes = _pad4(uvs.tobytes())
    idx_bytes = _pad4(indices.tobytes())
    png_bytes = _pad4(runtime_png.read_bytes())

    pos_offset = 0
    uv_offset = len(pos_bytes)
    idx_offset = uv_offset + len(uv_bytes)
    png_offset = idx_offset + len(idx_bytes)
    total_bin = png_offset + len(png_bytes)

    gltf = GLTF2(
        asset=Asset(version='2.0', generator='build_branding_logos.py'),
        scene=0,
        scenes=[Scene(nodes=[0])],
        nodes=[Node(mesh=0, name=out_glb.stem)],
        meshes=[Mesh(primitives=[Primitive(
            attributes={'POSITION': 0, 'TEXCOORD_0': 1},
            indices=2,
            material=0,
        )])],
        materials=[Material(
            name=f'{out_glb.stem}-mat',
            pbrMetallicRoughness=PbrMetallicRoughness(
                baseColorTexture=TextureInfo(index=0),
                metallicFactor=0.0,
                roughnessFactor=0.88,
            ),
            alphaMode='BLEND',
            doubleSided=True,
        )],
        textures=[Texture(source=0, sampler=0)],
        images=[GltfImage(mimeType='image/png', bufferView=3)],
        samplers=[Sampler(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)],
        accessors=[
            Accessor(
                bufferView=0,
                componentType=5126,
                count=4,
                type='VEC3',
                max=positions.max(axis=0).tolist(),
                min=positions.min(axis=0).tolist(),
            ),
            Accessor(
                bufferView=1,
                componentType=5126,
                count=4,
                type='VEC2',
                max=uvs.max(axis=0).tolist(),
                min=uvs.min(axis=0).tolist(),
            ),
            Accessor(
                bufferView=2,
                componentType=5123,
                count=6,
                type='SCALAR',
                max=[int(indices.max())],
                min=[int(indices.min())],
            ),
        ],
        bufferViews=[
            BufferView(buffer=0, byteOffset=pos_offset, byteLength=len(pos_bytes), target=34962),
            BufferView(buffer=0, byteOffset=uv_offset, byteLength=len(uv_bytes), target=34962),
            BufferView(buffer=0, byteOffset=idx_offset, byteLength=len(idx_bytes), target=34963),
            BufferView(buffer=0, byteOffset=png_offset, byteLength=len(png_bytes)),
        ],
        buffers=[Buffer(byteLength=total_bin)],
    )

    gltf.set_binary_blob(pos_bytes + uv_bytes + idx_bytes + png_bytes)
    out_glb.parent.mkdir(parents=True, exist_ok=True)
    gltf.save(str(out_glb))


def main() -> None:
    outputs = {}
    for card, glb_name in LOGOS.items():
        runtime_png = RUNTIME_DIR / f'{card}_RuntimeBack.png'
        if not runtime_png.exists():
            raise FileNotFoundError(
                f'Missing {runtime_png}. Run tools/prepare_branding_logo_images.py first.',
            )
        out_glb = OUTPUT_DIR / glb_name
        build_shopsign_style_glb(out_glb, runtime_png)
        outputs[card] = str(out_glb)
        print(f'Exported {out_glb.name}')

    print(json.dumps(outputs))


if __name__ == '__main__':
    main()

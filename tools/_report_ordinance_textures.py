"""Report embedded image sizes in ordinance card GLBs (read-only)."""
from __future__ import annotations

import json
import struct
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DIRS = [
    ROOT / "assets" / "OrdinanceCards" / "Clean",
    ROOT / "assets" / "OrdinanceCards" / "Cards",
    ROOT / "assets" / "generated" / "OrdinanceCards" / "v5",
    ROOT / "assets" / "generated" / "OrdinanceCards" / "streetlights",
    ROOT / "assets" / "generated" / "OrdinanceCards" / "v7",
]


def parse_glb(path: Path):
    data = path.read_bytes()
    if data[:4] != b"glTF":
        return None, None
    offset = 12
    json_chunk = None
    bin_chunk = b""
    while offset + 8 <= len(data):
        chunk_len, chunk_type = struct.unpack_from("<I4s", data, offset)
        offset += 8
        chunk = data[offset : offset + chunk_len]
        offset += chunk_len
        if chunk_type == b"JSON":
            json_chunk = chunk
        elif chunk_type == b"BIN\x00":
            bin_chunk = chunk
    if json_chunk is None:
        return None, None
    return json.loads(json_chunk.decode("utf-8")), bin_chunk


def main() -> None:
    rows = []
    max_edge = 0
    over = []
    texels = []
    for folder in DIRS:
        if not folder.exists():
            continue
        for path in sorted(folder.glob("*.glb")):
            gltf, bin_chunk = parse_glb(path)
            if not gltf:
                continue
            imgs = []
            for img in gltf.get("images") or []:
                if "bufferView" not in img:
                    continue
                bv = gltf["bufferViews"][img["bufferView"]]
                start = bv.get("byteOffset", 0)
                blob = bin_chunk[start : start + bv["byteLength"]]
                try:
                    with Image.open(BytesIO(blob)) as im:
                        w, h = im.size
                        fmt = im.format or "?"
                except Exception:
                    w = h = 0
                    fmt = "?"
                max_edge = max(max_edge, w, h)
                texels.append(w * h)
                if max(w, h) > 1024:
                    over.append((str(path.relative_to(ROOT)), w, h))
                imgs.append((w, h, fmt, len(blob)))
            rows.append((str(path.relative_to(ROOT)), path.stat().st_size, imgs))

    print("FILE | GLB MB | images WxH (fmt, compressed KB)")
    for rel, size, imgs in rows:
        if imgs:
            desc = ", ".join(f"{w}x{h} {fmt} {blen/1024:.0f}KB" for w, h, fmt, blen in imgs)
        else:
            desc = "(no embedded images)"
        print(f"{rel} | {size/1024/1024:.2f}MB | {desc}")

    print("---")
    print("GLBs scanned:", len(rows))
    print("embedded images:", len(texels))
    print("max long edge:", max_edge)
    print("images > 1024:", len(over))
    for item in over:
        print(" ", item)
    if texels:
        print("sum W*H texels:", sum(texels))
        print("approx RGBA VRAM if all unique uncompressed:", f"{sum(texels)*4/1024/1024:.0f} MB")
        # +mips ~33%
        print("approx with mipmaps (~1.33x):", f"{sum(texels)*4*1.33/1024/1024:.0f} MB")


if __name__ == "__main__":
    main()

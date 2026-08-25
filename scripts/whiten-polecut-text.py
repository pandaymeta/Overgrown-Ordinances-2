"""Rewrite PoleCut board texture: black text/outline → white. Red fill stays."""
from __future__ import annotations

import json
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules\assets\PolyforkAssets\Ordinances")
GLB = ROOT / "PoleCut.glb"
SRC = ROOT / "_extract_PoleCut_0.png"
OUT_PNG = ROOT / "PoleCut_board_white_text.png"


def load_glb(path: Path):
    data = path.read_bytes()
    json_len = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + json_len])
    bin_start = 20 + json_len
    if bin_start % 4:
        bin_start += 4 - (bin_start % 4)
    bin_len, _ = struct.unpack_from("<I4s", data, bin_start)
    header = data[:bin_start]
    blob = bytearray(data[bin_start + 8 : bin_start + 8 + bin_len])
    return gltf, blob, header, bin_start


def save_glb(path: Path, gltf: dict, blob: bytes, header_prefix: bytes):
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4:
        json_bytes += b" "
    bin_bytes = bytes(blob)
    while len(bin_bytes) % 4:
        bin_bytes += b"\x00"
    gltf["buffers"][0]["byteLength"] = len(bin_bytes)
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4:
        json_bytes += b" "

    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    out = bytearray()
    out += struct.pack("<4sII", b"glTF", 2, total)
    out += struct.pack("<I4s", len(json_bytes), b"JSON")
    out += json_bytes
    out += struct.pack("<I4s", len(bin_bytes), b"BIN\x00")
    out += bin_bytes
    path.write_bytes(out)


def whiten_dark_ink(img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            # Red board fill stays; dark ink (text + outline) → white.
            is_reddish = r > 90 and r >= g + 25 and r >= b + 25
            luminance = (r + g + b) / 3
            if (not is_reddish) and luminance < 140:
                px[x, y] = (255, 255, 255, a)
            elif is_reddish and luminance < 70:
                # Near-black outline on red → white
                px[x, y] = (255, 255, 255, a)
    return rgba


def main() -> None:
    src = Image.open(SRC)
    whitened = whiten_dark_ink(src)
    whitened.save(OUT_PNG, optimize=True)
    png_bytes = OUT_PNG.read_bytes()
    print("whitened", OUT_PNG, "bytes", len(png_bytes))

    gltf, blob, _, _ = load_glb(GLB)
    img = gltf["images"][0]
    bv_i = img["bufferView"]
    bv = gltf["bufferViews"][bv_i]
    old_off = bv.get("byteOffset", 0)
    old_len = bv["byteLength"]

    # Append new image at end of buffer to avoid shifting other views.
    new_off = len(blob)
    while new_off % 4:
        blob.append(0)
        new_off = len(blob)
    blob.extend(png_bytes)
    bv["byteOffset"] = new_off
    bv["byteLength"] = len(png_bytes)
    img["mimeType"] = "image/png"
    if "uri" in img:
        del img["uri"]

    save_glb(GLB, gltf, blob, b"")
    print("updated", GLB, "oldLen", old_len, "newLen", len(png_bytes), "total", GLB.stat().st_size)


if __name__ == "__main__":
    main()

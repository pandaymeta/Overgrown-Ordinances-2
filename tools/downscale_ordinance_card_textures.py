"""
Downscale embedded ordinance-card images so GPU VRAM stays sane late-game.

Target: max long-edge 1024px. Mesh/UVs untouched. Rewrites GLB image buffers only.
"""

from __future__ import annotations

import json
import struct
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    ROOT / "assets" / "generated" / "OrdinanceCards",
    ROOT / "assets" / "OrdinanceCards",
]
MAX_LONG_EDGE = 1024
PNG_COMPRESS_LEVEL = 6


def _parse_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    if data[:4] != b"glTF":
        raise ValueError(f"Not a GLB: {path}")
    offset = 12
    json_chunk: bytes | None = None
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
        raise ValueError(f"Missing JSON chunk: {path}")
    # JSON chunk is space-padded to 4-byte alignment.
    gltf = json.loads(json_chunk.decode("utf-8"))
    return gltf, bin_chunk


def _pad_json(blob: bytes) -> bytes:
    """glTF JSON chunks must be padded with spaces (0x20), never NUL."""
    pad = (4 - (len(blob) % 4)) % 4
    return blob + (b" " * pad)


def _pad_bin(blob: bytes) -> bytes:
    pad = (4 - (len(blob) % 4)) % 4
    return blob + (b"\x00" * pad)


def _write_glb(path: Path, gltf: dict, bin_chunk: bytes) -> None:
    json_bytes = _pad_json(json.dumps(gltf, separators=(",", ":")).encode("utf-8"))
    bin_bytes = _pad_bin(bin_chunk)
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    out = bytearray()
    out += struct.pack("<4sII", b"glTF", 2, total)
    out += struct.pack("<I4s", len(json_bytes), b"JSON")
    out += json_bytes
    out += struct.pack("<I4s", len(bin_bytes), b"BIN\x00")
    out += bin_bytes
    path.write_bytes(out)


def _image_size(blob: bytes) -> tuple[int, int] | None:
    try:
        with Image.open(BytesIO(blob)) as img:
            return img.size
    except Exception:
        return None


def _downscale_image(blob: bytes) -> tuple[bytes, str] | None:
    try:
        with Image.open(BytesIO(blob)) as img:
            img.load()
            w, h = img.size
            long_edge = max(w, h)
            if long_edge <= MAX_LONG_EDGE:
                return None
            scale = MAX_LONG_EDGE / float(long_edge)
            nw = max(1, int(round(w * scale)))
            nh = max(1, int(round(h * scale)))
            # Keep alpha if present (card art).
            mode = "RGBA" if ("A" in img.getbands()) else "RGB"
            resized = img.convert(mode).resize((nw, nh), Image.Resampling.LANCZOS)
            out = BytesIO()
            resized.save(out, format="PNG", optimize=True, compress_level=PNG_COMPRESS_LEVEL)
            return out.getvalue(), f"{w}x{h}->{nw}x{nh}"
    except Exception as exc:
        return None


def process_glb(path: Path) -> dict:
    gltf, bin_chunk = _parse_glb(path)
    images = gltf.get("images") or []
    buffer_views = gltf.get("bufferViews") or []
    if not images:
        return {"path": str(path.relative_to(ROOT)), "changed": False, "reason": "no-images"}

    # Rebuild binary by copying untouched ranges and replacing image views.
    replacements: dict[int, bytes] = {}
    notes: list[str] = []
    for image in images:
        if "bufferView" not in image:
            continue
        view_index = int(image["bufferView"])
        view = buffer_views[view_index]
        start = int(view.get("byteOffset", 0))
        length = int(view["byteLength"])
        blob = bin_chunk[start : start + length]
        result = _downscale_image(blob)
        if result is None:
            size = _image_size(blob)
            notes.append(f"keep {image.get('name', view_index)} {size}")
            continue
        new_blob, note = result
        replacements[view_index] = new_blob
        image["mimeType"] = "image/png"
        notes.append(f"{image.get('name', view_index)} {note}")

    if not replacements:
        return {"path": str(path.relative_to(ROOT)), "changed": False, "notes": notes}

    # Reconstruct bin: walk bufferViews in offset order for buffer 0.
    indexed = list(enumerate(buffer_views))
    indexed.sort(key=lambda item: int(item[1].get("byteOffset", 0)))
    new_bin = bytearray()
    for view_index, view in indexed:
        if int(view.get("buffer", 0)) != 0:
            continue
        start = int(view.get("byteOffset", 0))
        length = int(view["byteLength"])
        blob = replacements.get(view_index, bin_chunk[start : start + length])
        # Align each view to 4 bytes.
        while len(new_bin) % 4:
            new_bin.append(0)
        view["byteOffset"] = len(new_bin)
        view["byteLength"] = len(blob)
        new_bin.extend(blob)

    while len(new_bin) % 4:
        new_bin.append(0)

    buffers = gltf.setdefault("buffers", [{"byteLength": 0}])
    buffers[0]["byteLength"] = len(new_bin)

    before = path.stat().st_size
    _write_glb(path, gltf, bytes(new_bin))
    after = path.stat().st_size
    return {
        "path": str(path.relative_to(ROOT)),
        "changed": True,
        "bytesBefore": before,
        "bytesAfter": after,
        "notes": notes,
    }


def main() -> None:
    glbs: list[Path] = []
    for folder in TARGETS:
        if folder.is_dir():
            glbs.extend(sorted(folder.rglob("*.glb")))
    if not glbs:
        raise SystemExit("No ordinance card GLBs found.")

    changed = 0
    skipped = 0
    for path in glbs:
        result = process_glb(path)
        if result.get("changed"):
            changed += 1
            saved = result["bytesBefore"] - result["bytesAfter"]
            print(
                f"OK  {result['path']}  "
                f"{result['bytesBefore']/1024:.0f}KB -> {result['bytesAfter']/1024:.0f}KB  "
                f"({saved/1024:.0f}KB)  {', '.join(result.get('notes') or [])}"
            )
        else:
            skipped += 1
            print(f"--  {result['path']}  unchanged")
    print(f"\nDone. changed={changed} unchanged={skipped} maxLongEdge={MAX_LONG_EDGE}")


if __name__ == "__main__":
    main()

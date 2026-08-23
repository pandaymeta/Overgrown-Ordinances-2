from pathlib import Path
import base64
from PIL import Image

root = Path(r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules")
png = root / "assets" / "textures" / "startup-splash" / "transition-intro.png"
jpg = root / "assets" / "textures" / "startup-splash" / "transition-intro.jpg"
out = root / "src" / "startup-splash-frames.ts"

im = Image.open(png).convert("L")
im.save(jpg, quality=93, optimize=True)
b64 = base64.b64encode(jpg.read_bytes()).decode("ascii")

out.write_text(
  "\n".join(
    [
      "/**",
      " * Single Summer-Afternoon-style intro transition map (luminance).",
      " * Dark pixels reveal first. Sharp edges come from a progress threshold at runtime.",
      " * Regenerate: python scripts/build-startup-transition-map.py && python scripts/embed-startup-splash-frames.py",
      " */",
      "",
      "export const STARTUP_TRANSITION_INTRO_DATA_URL =",
      f"  'data:image/jpeg;base64,{b64}';",
      "",
    ]
  ),
  encoding="utf-8",
)
print(f"wrote {out} ({out.stat().st_size} bytes), jpg={jpg.stat().st_size}")

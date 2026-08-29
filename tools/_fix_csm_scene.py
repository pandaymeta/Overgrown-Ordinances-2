"""Post-process sun light after Studio save so Play Mode does not auto-raise CSM.

Studio serializes csmCascadeCount before csmMaxFar and often omits shadowFar when it
equals the engine default (100). Deserializing cascade first hits csmMaxFar=1000 and
raises shadowFar to 2000. Strip cascade from the file (runtime sets it) and force
shadowFar: 100 into both assets and .dist copies.
"""
from __future__ import annotations

import json
import pathlib
import shutil
from collections import OrderedDict

ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "default.genesys-scene"
DIST = ROOT / ".dist" / "assets" / "default.genesys-scene"
BC = "$bc"


def is_directional_light(obj: dict) -> bool:
    return obj.get(BC) == "ENGINE.DirectionalLightNode"


def fix_light(obj) -> bool:
    if not isinstance(obj, dict):
        return False
    if is_directional_light(obj):
        obj.pop("csmCascadeCount", None)
        obj["csmMaxFar"] = 100
        obj["shadowFar"] = 100
        obj["shadowMapSize"] = 1024
        obj["useCsmShadows"] = True
        obj["csmFade"] = True
        obj["csmLightMargin"] = 40
        return True
    changed = False
    for value in obj.values():
        if isinstance(value, dict):
            changed = fix_light(value) or changed
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    changed = fix_light(item) or changed
    return changed


def summarize(path: pathlib.Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    light = data["$root"]["children"][0]
    return {
        "csmMaxFar": light.get("csmMaxFar"),
        "csmCascadeCount": light.get("csmCascadeCount"),
        "shadowFar": light.get("shadowFar"),
        "shadowMapSize": light.get("shadowMapSize"),
        "useCsmShadows": light.get("useCsmShadows"),
    }


def main() -> None:
    data = json.loads(ASSETS.read_text(encoding="utf-8"), object_pairs_hook=OrderedDict)
    if not fix_light(data):
        raise SystemExit("DirectionalLightNode not found")
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    ASSETS.write_text(text, encoding="utf-8")
    DIST.parent.mkdir(parents=True, exist_ok=True)
    DIST.write_text(text, encoding="utf-8")
    print("assets", summarize(ASSETS))
    print(".dist ", summarize(DIST))


if __name__ == "__main__":
    main()

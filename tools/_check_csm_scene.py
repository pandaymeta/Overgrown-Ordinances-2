import json
from pathlib import Path

BC = "$bc"
for rel in ("assets/default.genesys-scene", ".dist/assets/default.genesys-scene"):
    p = Path(rel)
    data = json.loads(p.read_text(encoding="utf-8"))
    light = data["$root"]["children"][0]
    keys = list(light.keys())[:12]
    print(rel)
    print("  first keys:", keys)
    print(
        "  values:",
        {
            BC: light.get(BC),
            "csmMaxFar": light.get("csmMaxFar"),
            "csmCascadeCount": light.get("csmCascadeCount"),
            "shadowFar": light.get("shadowFar"),
            "shadowMapSize": light.get("shadowMapSize"),
            "useCsmShadows": light.get("useCsmShadows"),
        },
    )

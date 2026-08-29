"""Remove serialized empty THREE.LineSegments orphans from a genesys scene."""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCENE = REPO_ROOT / 'assets' / 'default.genesys-scene'


def clean_node(node: object, removed: list[int]) -> object | None:
    if not isinstance(node, dict):
        return node
    if node.get('$bc') == 'THREE.LineSegments' and 'geometry' not in node:
        removed[0] += 1
        return None
    children = node.get('children')
    if isinstance(children, list):
        node['children'] = [
            cleaned
            for child in children
            if (cleaned := clean_node(child, removed)) is not None
        ]
    return node


def main() -> int:
    scene_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SCENE
    data = json.loads(scene_path.read_text(encoding='utf-8'))
    removed = [0]
    data['$root'] = clean_node(data['$root'], removed)
    scene_path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8',
    )
    print(f'Removed {removed[0]} empty THREE.LineSegments node(s) from {scene_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

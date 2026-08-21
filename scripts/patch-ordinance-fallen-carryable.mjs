import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = path.resolve('assets/prefabs');
const files = fs.readdirSync(dir).filter((f) => /^ordinance-.*-fallen\.prefab\.json$/i.test(f));

function hex16() {
  return crypto.randomBytes(8).toString('hex');
}

for (const file of files) {
  const full = path.join(dir, file);
  const prefab = JSON.parse(fs.readFileSync(full, 'utf8'));
  const mesh = prefab?.$root?.rootNode?.children?.[0];
  if (!mesh || mesh.$bc !== 'ENGINE.ModelMeshNode') {
    console.warn('skip (no mesh):', file);
    continue;
  }

  const label = String(mesh.name ?? 'Ordinance').replace(/ Fallen Mesh$/i, '');
  mesh.children = [
    {
      $bc: 'GAME.CarryableCrateNode',
      carryHeightOverride: 0.8,
      children: [],
      name: `Carryable ${label}`,
      nodeId: Math.floor(Math.random() * 50000) + 10000,
      prefabId: hex16(),
      throwDistanceOverride: 5,
    },
  ];

  fs.writeFileSync(full, `${JSON.stringify(prefab, null, 2)}\n`);
  console.log('updated', file);
}

console.log(`done: ${files.length} prefabs`);

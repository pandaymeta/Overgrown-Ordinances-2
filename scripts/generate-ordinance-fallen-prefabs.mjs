import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = path.resolve('assets/prefabs');
const models = [
  'Maintenance',
  'JayWalking',
  'Crates',
  'Bench',
  'Logs',
  'WoodPlanks',
  'Metals',
  'Bushes',
  'PoleCut',
  'HighVoltage',
  'StreetLightsDestroy',
  'StreetLightsClimb',
  'ShopSign',
  'Signs',
  'FireHydrant',
  'TreesCutting',
  'TreesClimbing',
  'Cones',
  'DoNotStep',
  'Kiosk',
  'Cats',
  'Wires',
  'Plastics',
  'Tram',
  'Car',
  'CatFeed',
];

function slug(name) {
  return name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function displayName(name) {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function hex16() {
  return crypto.randomBytes(8).toString('hex');
}

const tipRad = 0.35;
for (const base of models) {
  const modelUrl = `@project/assets/PolyforkAssets/Ordinances/${base}.glb`;
  const fileSlug = `ordinance-${slug(base)}-fallen.prefab.json`;
  const label = displayName(base);
  const prefab = {
    $root: {
      $bc: 'ENGINE.Prefab',
      $uuid: hex16(),
      rootNode: {
        $bc: 'ENGINE.SceneNode',
        children: [
          {
            $bc: 'ENGINE.ModelMeshNode',
            castShadow: true,
            children: [
              {
                $bc: 'GAME.CarryableCrateNode',
                carryHeightOverride: 0.8,
                children: [],
                name: `Carryable ${label}`,
                nodeId: Math.floor(Math.random() * 50000) + 10000,
                prefabId: hex16(),
                throwDistanceOverride: 5,
              },
            ],
            modelUrl,
            name: `${label} Fallen Mesh`,
            nodeId: Math.floor(Math.random() * 50000) + 10000,
            physicsOptions: {
              collisionMeshType: 'convexHull',
              density: 2000,
              motionType: 'dynamic',
            },
            position: {
              $bc: 'v3',
              _: [0, 0.2, 0],
            },
            prefabId: hex16(),
            receiveShadow: true,
            rotation: {
              $bc: 'e',
              _: [tipRad, 0.1, 0],
            },
            scale: {
              $bc: 'v3',
              _: [1, 1, 1],
            },
          },
        ],
        name: `${label} Fallen`,
        nodeId: Math.floor(Math.random() * 50000) + 10000,
        prefabId: hex16(),
      },
    },
    $version: 3,
  };
  fs.writeFileSync(path.join(dir, fileSlug), `${JSON.stringify(prefab, null, 2)}\n`);
  console.log(`wrote ${fileSlug}`);
}

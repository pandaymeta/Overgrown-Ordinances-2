import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import {
  refreshEnvironmentArtDirection,
  SKIP_ENVIRONMENT_ART_FLAG,
} from './environment-art-direction.js';

/** Existing rim cloud nodes placed in the scene. */
const RIM_CLOUD_NAME = /\bSm Sb Env Cloud\b/i;
/** Extra static fog banks the team can place and name in the editor. */
const HEAVY_FOG_NAME = /\b(heavy[\s_-]?fog|fog[\s_-]?bank|static[\s_-]?fog|smoke[\s_-]?bank)\b/i;
const STATIC_FOG_STYLE_FLAG = 'staticHeavyFogV1';
const FOG_COLOR = new THREE.Color('#cfd9e0');
const FOG_EMISSIVE = new THREE.Color('#b8c5cf');

const fogMeshHooks = new WeakSet<ENGINE.ModelMeshNode>();
let heavyFogColorMap: THREE.CanvasTexture | null = null;

function isStaticFogMesh(node: ENGINE.ModelMeshNode): boolean {
  const label = node.name ?? '';
  return RIM_CLOUD_NAME.test(label) || HEAVY_FOG_NAME.test(label);
}

function getHeavyFogColorMap(): THREE.CanvasTexture | null {
  if (heavyFogColorMap) {
    return heavyFogColorMap;
  }
  if (typeof document === 'undefined') {
    return null;
  }

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  // Soft, low-contrast variation so overlapping meshes read as one dense fog mass.
  const gradient = context.createRadialGradient(
    size * 0.5,
    size * 0.5,
    size * 0.15,
    size * 0.5,
    size * 0.5,
    size * 0.5,
  );
  gradient.addColorStop(0, '#dbe3e8');
  gradient.addColorStop(0.55, '#cfd9e0');
  gradient.addColorStop(1, '#c3ced6');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  context.globalAlpha = 0.35;
  context.globalCompositeOperation = 'soft-light';
  context.fillStyle = '#eef3f6';
  context.fillRect(size * 0.1, size * 0.55, size * 0.8, size * 0.35);

  heavyFogColorMap = new THREE.CanvasTexture(canvas);
  heavyFogColorMap.wrapS = THREE.RepeatWrapping;
  heavyFogColorMap.wrapT = THREE.RepeatWrapping;
  heavyFogColorMap.repeat.set(3, 3);
  heavyFogColorMap.colorSpace = THREE.SRGBColorSpace;
  heavyFogColorMap.needsUpdate = true;
  return heavyFogColorMap;
}

function createStaticHeavyFogMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: FOG_COLOR.clone(),
    map: getHeavyFogColorMap() ?? undefined,
    emissive: FOG_EMISSIVE.clone(),
    emissiveIntensity: 0.06,
    roughness: 1,
    metalness: 0,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  material.userData[STATIC_FOG_STYLE_FLAG] = true;
  return material;
}

function applyStaticHeavyFogStyle(meshNode: ENGINE.ModelMeshNode): void {
  meshNode.userData[SKIP_ENVIRONMENT_ART_FLAG] = true;

  for (const mesh of meshNode.getAllMeshes()) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const source of materials) {
      if (source.userData[STATIC_FOG_STYLE_FLAG]) {
        continue;
      }
      source.dispose?.();
    }
    mesh.material = createStaticHeavyFogMaterial();
    mesh.renderOrder = 8;
  }

  if (!fogMeshHooks.has(meshNode)) {
    fogMeshHooks.add(meshNode);
    meshNode.onMeshLoaded.add(() => applyStaticHeavyFogStyle(meshNode));
  }
}

/**
 * Styles authored cloud / fog-bank meshes as static heavy fog without moving them.
 * Place engine cloud models in the editor, flatten them on Y, and overlap a few
 * meshes where you want denser banks.
 */
@ENGINE.GameClass()
export class IslandRimCloudSystem extends ENGINE.SceneNode {
  private stylePending = false;

  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({ name: 'Static Heavy Fog', ...options });
  }

  public override postLoad(): void {
    super.postLoad();
    void this.styleStaticFogMeshes();
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    void this.styleStaticFogMeshes();
    return true;
  }

  private async styleStaticFogMeshes(): Promise<void> {
    if (this.stylePending) {
      return;
    }
    this.stylePending = true;
    try {
      const world = this.getWorld();
      if (!world) {
        return;
      }

      const fogMeshes = world.getNodes(ENGINE.ModelMeshNode).filter(isStaticFogMesh);
      if (fogMeshes.length === 0) {
        return;
      }

      await Promise.all(fogMeshes.map((meshNode) => meshNode.waitForLoad()));
      await refreshEnvironmentArtDirection(world);
      for (const meshNode of fogMeshes) {
        applyStaticHeavyFogStyle(meshNode);
      }
    } finally {
      this.stylePending = false;
    }
  }
}

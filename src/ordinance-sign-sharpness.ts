/**
 * Keep ordinance signs identical in Sandbox Studio's editor and Play mode.
 *
 * The earlier implementation replaced GLB materials with new unlit materials.
 * That made the board backfaces visible in Play, which mirrored the printed
 * ordinance graphics. This system deliberately leaves color, lighting, sides,
 * and maps authored by the original GitHub GLBs untouched; it only requests
 * stable texture sampling for readable text during camera movement.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

const ORDINANCE_MODEL_PATH = /PolyforkAssets\/Ordinances\//i;
const TEXTURE_ANISOTROPY = 8;
const patchedNodes = new WeakSet<ENGINE.ModelMeshNode>();

function isOrdinanceModelUrl(modelUrl: string | null | undefined): boolean {
  return typeof modelUrl === 'string' && ORDINANCE_MODEL_PATH.test(modelUrl);
}

function applyStableSampling(texture: THREE.Texture | null | undefined): void {
  if (!texture) {
    return;
  }
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = TEXTURE_ANISOTROPY;
  texture.needsUpdate = true;
}

type TexturedMaterial = THREE.Material & { map?: THREE.Texture | null };

/** Apply only non-visual sampling settings; never replace or relight a GLB material. */
export function applyOrdinanceSignSharpness(node: ENGINE.ModelMeshNode): void {
  if (!isOrdinanceModelUrl(node.modelUrl)) {
    return;
  }
  for (const mesh of node.getAllMeshes()) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) {
        continue;
      }
      applyStableSampling((material as TexturedMaterial).map);
    }
  }
}

function ensureMeshLoadedHook(node: ENGINE.ModelMeshNode): void {
  if (patchedNodes.has(node)) {
    return;
  }
  patchedNodes.add(node);
  node.onMeshLoaded.add(() => applyOrdinanceSignSharpness(node));
}

/** Refresh every ordinance model without changing its authored appearance. */
export async function refreshOrdinanceSignSharpness(
  world: ENGINE.World | null | undefined,
): Promise<number> {
  if (!world) {
    return 0;
  }

  let count = 0;
  for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
    if (!isOrdinanceModelUrl(node.modelUrl)) {
      continue;
    }
    ensureMeshLoadedHook(node);
    if (node.isLoading()) {
      await node.waitForLoad();
    }
    applyOrdinanceSignSharpness(node);
    count += 1;
  }
  return count;
}

@ENGINE.GameClass()
export class OrdinanceSignSharpnessSystem extends ENGINE.SceneNode {
  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({ name: 'OrdinanceSignSharpness', ...options });
  }

  public override postLoad(): void {
    super.postLoad();
    void refreshOrdinanceSignSharpness(this.getWorld());
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    void refreshOrdinanceSignSharpness(this.getWorld());
    return true;
  }
}

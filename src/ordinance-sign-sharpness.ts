/**
 * Ordinance ModelMeshNode presentation for Play ≈ editor:
 * - Unlit (MeshBasic) so game lights/shadows don't wash lettering
 * - Trilinear mipmaps + moderate anisotropy for readable, stable distant lettering
 * - Red boards (PoleCut / Wires / StreetLightsDestroy) stay lit — unlit made them too dark
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

const ORDINANCE_MODEL_PATH = /PolyforkAssets\/Ordinances\//i;
/** Keep these lit (standard materials) — dark Kanji-red fills need scene lighting. */
const LIT_RED_BOARD_PATH = /PolyforkAssets\/Ordinances\/(PoleCut|Wires|StreetLightsDestroy)\.glb/i;
const DEFAULT_ANISOTROPY = 8;
const UNLIT_FLAG = 'ordinanceSignUnlit';

const patchedNodes = new WeakSet<ENGINE.ModelMeshNode>();

function isOrdinanceModelUrl(modelUrl: string | null | undefined): boolean {
  return typeof modelUrl === 'string' && ORDINANCE_MODEL_PATH.test(modelUrl);
}

function shouldKeepLit(modelUrl: string | null | undefined): boolean {
  return typeof modelUrl === 'string' && LIT_RED_BOARD_PATH.test(modelUrl);
}

function applyStableSamplingToTexture(texture: THREE.Texture | null | undefined): void {
  if (!texture) {
    return;
  }
  // Trilinear mips stabilize camera motion; moderate anisotropy keeps text clear without harsh shimmer.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = DEFAULT_ANISOTROPY;
  texture.needsUpdate = true;
}

type MappedMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  color?: THREE.Color;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
  depthWrite?: boolean;
  toneMapped?: boolean;
};

function toUnlitSignMaterial(source: THREE.Material): THREE.MeshBasicMaterial {
  if (source instanceof THREE.MeshBasicMaterial && source.userData?.[UNLIT_FLAG]) {
    applyStableSamplingToTexture(source.map);
    source.toneMapped = false;
    source.needsUpdate = true;
    return source;
  }

  const mapped = source as MappedMaterial;
  const map = mapped.map ?? null;
  if (map) {
    applyStableSamplingToTexture(map);
  }

  const basic = new THREE.MeshBasicMaterial({
    name: source.name || 'OrdinanceSignUnlit',
    map,
    color: map ? new THREE.Color(0xffffff) : (mapped.color?.clone?.() ?? new THREE.Color(0xffffff)),
    side: mapped.side ?? THREE.FrontSide,
    transparent: mapped.transparent ?? false,
    opacity: mapped.opacity ?? 1,
    alphaTest: mapped.alphaTest ?? 0,
    depthWrite: mapped.depthWrite ?? true,
    toneMapped: false,
  });
  basic.userData[UNLIT_FLAG] = true;
  basic.needsUpdate = true;
  return basic;
}

function applyStableSamplingToMaterial(material: THREE.Material): void {
  const mapped = material as MappedMaterial;
  if (mapped.map) {
    applyStableSamplingToTexture(mapped.map);
  }
  material.needsUpdate = true;
}

function patchMeshMaterials(mesh: THREE.Mesh, keepLit: boolean): void {
  const current = mesh.material;
  if (Array.isArray(current)) {
    mesh.material = current.map((mat) => {
      if (!mat) {
        return mat;
      }
      if (keepLit) {
        applyStableSamplingToMaterial(mat);
        return mat;
      }
      return toUnlitSignMaterial(mat);
    });
  } else if (current) {
    if (keepLit) {
      applyStableSamplingToMaterial(current);
    } else {
      mesh.material = toUnlitSignMaterial(current);
    }
  }
}

/** Stable sampling; unlit for most ordinance signs, lit for the three red boards. */
export function applyOrdinanceSignSharpness(node: ENGINE.ModelMeshNode): void {
  if (!isOrdinanceModelUrl(node.modelUrl)) {
    return;
  }

  const keepLit = shouldKeepLit(node.modelUrl);
  for (const mesh of node.getAllMeshes()) {
    patchMeshMaterials(mesh, keepLit);
  }
}

function ensureMeshLoadedHook(node: ENGINE.ModelMeshNode): void {
  if (patchedNodes.has(node)) {
    return;
  }
  patchedNodes.add(node);
  node.onMeshLoaded.add(() => {
    applyOrdinanceSignSharpness(node);
  });
}

/** Find ordinance signs in the world and apply Play≈editor presentation. */
export async function refreshOrdinanceSignSharpness(world: ENGINE.World | null | undefined): Promise<number> {
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

/**
 * Scene root that reapplies presentation when the scene loads (editor + play).
 * Place once in the level; GameMode also calls the same refresh as a backup.
 */
@ENGINE.GameClass()
export class OrdinanceSignSharpnessSystem extends ENGINE.SceneNode {
  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({
      name: 'OrdinanceSignSharpness',
      ...options,
    });
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

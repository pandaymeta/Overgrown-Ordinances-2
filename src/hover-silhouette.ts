import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

const HIGHLIGHT_GREEN = 0x39ff63;
/** Skip absurdly dense props (keeps hover hitch small). */
const MAX_HIGHLIGHT_MESHES = 48;
/**
 * Climb / contact volumes parented under lamps, trams, trees, etc.
 * Never include these in the green hover highlight.
 */
const OUTLINE_EXCLUDED_TRIGGER_NAME = /^(?:LampTrigger|TramTrigger|TramRoofTrigger|TreeTrigg+er|WireTrigger|CarRoofTrigger)(?:\s+\d+)?$/i;

type MaterialSwap = {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
  highlight: THREE.Material | THREE.Material[];
};

/**
 * Green material-tint hover cue for pickups and axe dismantle targets.
 *
 * Same aim triggers as the old wireframe, but tints the live GLB meshes
 * (like the red axe hit flash — steady green, no pulse). No extra MeshNodes.
 */
export class HoverSilhouette {
  private target: THREE.Object3D | null = null;
  private readonly swaps: MaterialSwap[] = [];
  /** Highlight still referenced by an active red hit flash — restore next frames. */
  private readonly pendingRestores: MaterialSwap[] = [];
  private loadToken = 0;

  public get activeTarget(): THREE.Object3D | null {
    return this.target;
  }

  public setTarget(world: ENGINE.World | null, target: THREE.Object3D | null): void {
    if (this.target === target) {
      return;
    }
    this.target = target;
    this.loadToken += 1;
    this.restoreMaterials(false);
    if (
      !world
      || !target
      || isOutlineExcludedTrigger(target)
    ) {
      return;
    }
    this.applyHighlightMaterials(target, this.loadToken);
    this.waitForPrefabMeshes(world, target, this.loadToken);
  }

  /** Drain deferred restores after a red hit flash releases the mesh. */
  public syncTransforms(): void {
    this.flushPendingRestores();
    // Recover if something stripped the tint while we still track a target
    // (e.g. legacy flushDeferredDestroys callers during cinematic frames).
    if (
      this.target
      && this.swaps.length === 0
      && this.pendingRestores.length === 0
      && !isOutlineExcludedTrigger(this.target)
    ) {
      this.applyHighlightMaterials(this.target, this.loadToken);
    }
  }

  public clear(): void {
    this.target = null;
    this.loadToken += 1;
    this.restoreMaterials(true);
  }

  /**
   * Kept for cinematic callers that used to tear down deferred wireframe MeshNodes.
   * Material highlights restore via clear()/setTarget — do not strip tint every frame.
   */
  public flushDeferredDestroys(_forceAll = false): void {
    // no-op
  }

  private waitForPrefabMeshes(
    _world: ENGINE.World,
    target: THREE.Object3D,
    token: number,
  ): void {
    if (!(target instanceof ENGINE.SceneNode)) {
      return;
    }
    const models = target instanceof ENGINE.ModelMeshNode
      ? [target]
      : target.getNodes(ENGINE.ModelMeshNode);
    for (const model of models) {
      void model.waitForLoad().then(() => {
        if (token !== this.loadToken || this.target !== target) {
          return;
        }
        this.restoreMaterials(false);
        this.applyHighlightMaterials(target, token);
      });
    }
  }

  private applyHighlightMaterials(target: THREE.Object3D, token: number): void {
    if (token !== this.loadToken) {
      return;
    }
    const meshes = this.collectMeshes(target);
    if (meshes.length === 0) {
      return;
    }
    if (meshes.length > MAX_HIGHLIGHT_MESHES) {
      meshes.sort((a, b) => triangleCount(b) - triangleCount(a));
      meshes.length = MAX_HIGHLIGHT_MESHES;
    }

    for (const mesh of meshes) {
      const original = mesh.material;
      const highlight = Array.isArray(original)
        ? original.map((material) => this.createHighlightMaterial(material))
        : this.createHighlightMaterial(original);
      this.swaps.push({ mesh, original, highlight });
      mesh.material = highlight;
    }
  }

  private createHighlightMaterial(material: THREE.Material): THREE.Material {
    const highlight = material.clone() as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
      transparent?: boolean;
      opacity?: number;
      depthWrite?: boolean;
    };
    highlight.color?.setHex(HIGHLIGHT_GREEN);
    highlight.emissive?.setHex(HIGHLIGHT_GREEN);
    if (highlight.emissiveIntensity !== undefined) {
      highlight.emissiveIntensity = Math.max(highlight.emissiveIntensity, 0.85);
    }
    highlight.transparent = true;
    highlight.opacity = 0.5;
    highlight.depthWrite = false;
    highlight.needsUpdate = true;
    return highlight;
  }

  private restoreMaterials(force: boolean): void {
    for (const swap of this.swaps.splice(0)) {
      if (!this.tryRestoreSwap(swap, force)) {
        this.pendingRestores.push(swap);
      }
    }
    if (force) {
      this.flushPendingRestores(true);
    }
  }

  private flushPendingRestores(force = false): void {
    if (this.pendingRestores.length === 0) {
      return;
    }
    const stillPending: MaterialSwap[] = [];
    for (const swap of this.pendingRestores.splice(0)) {
      if (!this.tryRestoreSwap(swap, force)) {
        stillPending.push(swap);
      }
    }
    this.pendingRestores.push(...stillPending);
  }

  private tryRestoreSwap(swap: MaterialSwap, force: boolean): boolean {
    const { mesh, original, highlight } = swap;
    const current = mesh.material;
    const ownsSlot = materialsMatch(current, highlight);
    if (!ownsSlot && !force) {
      // Red hit flash owns the mesh — wait until it puts our highlight back.
      // If the mesh already shows the true original, only dispose the highlight.
      if (!materialsMatch(current, original)) {
        return false;
      }
    } else {
      mesh.material = original;
    }
    const list = Array.isArray(highlight) ? highlight : [highlight];
    for (const material of list) {
      material.dispose();
    }
    return true;
  }

  /**
   * ModelMeshNode targets: that node's GLB meshes, plus child ModelMeshNodes
   * (ordinance blank board + printed card). Skip climb/contact trigger volumes.
   */
  private collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    const seen = new Set<THREE.Mesh>();

    const addMesh = (mesh: THREE.Mesh): void => {
      if (!mesh.geometry || seen.has(mesh) || !mesh.visible) {
        return;
      }
      if (isUnderOutlineExcludedTrigger(mesh)) {
        return;
      }
      seen.add(mesh);
      meshes.push(mesh);
    };

    if (root instanceof ENGINE.ModelMeshNode) {
      const models: ENGINE.ModelMeshNode[] = [root];
      for (const child of root.getNodes(ENGINE.ModelMeshNode)) {
        if (child !== root) {
          models.push(child);
        }
      }
      for (const model of models) {
        if (isOutlineExcludedTrigger(model) || isUnderOutlineExcludedTrigger(model)) {
          continue;
        }
        for (const mesh of model.getAllMeshes()) {
          addMesh(mesh);
        }
      }
      return meshes;
    }

    if (root instanceof ENGINE.SceneNode) {
      for (const model of root.getNodes(ENGINE.ModelMeshNode)) {
        if (isOutlineExcludedTrigger(model) || isUnderOutlineExcludedTrigger(model)) {
          continue;
        }
        for (const mesh of model.getAllMeshes()) {
          addMesh(mesh);
        }
      }
    }

    return meshes;
  }
}

function triangleCount(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  if (!geometry) {
    return 0;
  }
  if (geometry.index) {
    return geometry.index.count / 3;
  }
  const positions = geometry.getAttribute('position');
  return positions ? positions.count / 3 : 0;
}

function materialsMatch(
  current: THREE.Material | THREE.Material[],
  expected: THREE.Material | THREE.Material[],
): boolean {
  if (current === expected) {
    return true;
  }
  if (!Array.isArray(current) || !Array.isArray(expected)) {
    return false;
  }
  if (current.length !== expected.length) {
    return false;
  }
  return current.every((mat, index) => mat === expected[index]);
}

function isOutlineExcludedTrigger(object: THREE.Object3D): boolean {
  return OUTLINE_EXCLUDED_TRIGGER_NAME.test(object.name ?? '');
}

function isUnderOutlineExcludedTrigger(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (isOutlineExcludedTrigger(current)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { ThirdPersonPlayer } from './player.js';

const SHOPHOUSE_NAME = /shophouse/i;
const STANDALONE_OCCLUDER_NAME = /^(?:Cherry Blossom Tree|City Tram$)/i;
const CLOUD_NAME = /\bcloud\b/i;
const SHOPHOUSE_DEPENDENT_NAMES = new Map<string, readonly string[]>([
  [
    'Corner Shophouse Ad 15 C 2',
    ['Air Con Unit 9 Fadc 03', 'Air Con Unit 9 Fadc 04', 'Air Con Unit 9 Fadc 05'],
  ],
  [
    'Three Storey Shophouse 2 F 6378',
    ['Kanji Sign', 'Fabric Awning 4 D 6 Acc'],
  ],
  [
    'Wide Shophouse 089 F 20',
    [
      'Tiled Roof Section 6 F 1121',
      'Tiled Roof Section 6 F 1122',
      'Tiled Roof Section 6 F 1123',
    ],
  ],
]);
const PLAYER_TARGET_LIFT = 0.9;
const RAYCAST_CLEARANCE = 0.1;

type MaterialSwap = {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
  hidden: THREE.Material | THREE.Material[];
};

/**
 * Keeps the player visible when a shophouse lies between the gameplay camera
 * and the character. The building becomes translucent, then restores as soon
 * as the view clears.
 */
@ENGINE.GameClass()
export class ShophouseCameraOcclusionSystem extends ENGINE.SceneNode {
  private readonly raycaster = new THREE.Raycaster();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly playerPosition = new THREE.Vector3();
  private readonly rayDirection = new THREE.Vector3();
  private readonly shophouses: ENGINE.ModelMeshNode[] = [];
  private readonly dependentModels = new Map<
    ENGINE.ModelMeshNode,
    ENGINE.ModelMeshNode[]
  >();
  private readonly standaloneOccluders: ENGINE.ModelMeshNode[] = [];
  private readonly clouds: ENGINE.ModelMeshNode[] = [];
  private readonly cloudAuthoredVisibility = new Map<ENGINE.ModelMeshNode, boolean>();
  private readonly hiddenMaterials = new Map<ENGINE.ModelMeshNode, MaterialSwap[]>();
  private player: ThirdPersonPlayer | null = null;

  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({
      name: 'Shophouse Camera Occlusion',
      ...options,
    });
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    const world = this.getWorld();
    if (!world) {
      return true;
    }
    this.player = world.getNodes(ThirdPersonPlayer)[0] ?? null;
    const models = world.getNodes(ENGINE.ModelMeshNode);
    this.shophouses.length = 0;
    this.shophouses.push(...models.filter((node) => SHOPHOUSE_NAME.test(node.name)));
    this.dependentModels.clear();
    this.standaloneOccluders.length = 0;
    this.standaloneOccluders.push(
      ...models.filter((node) => STANDALONE_OCCLUDER_NAME.test(node.name)),
    );
    this.clouds.length = 0;
    this.clouds.push(...models.filter((node) => CLOUD_NAME.test(node.name)));
    this.cloudAuthoredVisibility.clear();
    for (const cloud of this.clouds) {
      this.cloudAuthoredVisibility.set(cloud, cloud.visible);
    }
    for (const shophouse of this.shophouses) {
      const names = SHOPHOUSE_DEPENDENT_NAMES.get(shophouse.name) ?? [];
      this.dependentModels.set(
        shophouse,
        models.filter((node) => names.includes(node.name)),
      );
    }
    return true;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this.restoreAll();
    this.restoreClouds();
    this.player = null;
    return true;
  }

  public override tickPostPhysics(_deltaTime: number): void {
    super.tickPostPhysics(_deltaTime);
    const world = this.getWorld();
    if (!world) {
      return;
    }
    this.player ??= world.getNodes(ThirdPersonPlayer)[0] ?? null;
    const camera = this.player?.getGameplayCamera();
    if (!this.player || !camera) {
      return;
    }

    camera.getWorldPosition(this.cameraPosition);
    this.player.getWorldPosition(this.playerPosition);
    this.playerPosition.y += PLAYER_TARGET_LIFT;
    this.rayDirection.subVectors(this.playerPosition, this.cameraPosition);
    const distance = this.rayDirection.length();
    if (distance <= RAYCAST_CLEARANCE) {
      this.restoreAll();
      this.restoreClouds();
      return;
    }

    this.rayDirection.multiplyScalar(1 / distance);
    this.raycaster.set(this.cameraPosition, this.rayDirection);
    this.raycaster.near = RAYCAST_CLEARANCE;
    this.raycaster.far = distance - RAYCAST_CLEARANCE;

    // Test clouds in their authored visible state every frame. A cloud that
    // was hidden in the previous frame must still be eligible to reappear as
    // soon as the camera/player line is clear again.
    for (const cloud of this.clouds) {
      cloud.visible = this.cloudAuthoredVisibility.get(cloud) ?? true;
    }

    const occluding = new Set<ENGINE.ModelMeshNode>();
    for (const shophouse of this.shophouses) {
      const meshes = shophouse.getAllMeshes();
      if (meshes.length === 0) {
        continue;
      }
      if (this.raycaster.intersectObjects(meshes, true).length > 0) {
        occluding.add(shophouse);
      }
    }

    for (const shophouse of this.shophouses) {
      if (occluding.has(shophouse)) {
        this.makeTranslucent(shophouse);
      } else {
        this.restore(shophouse);
      }
    }
    for (const occluder of this.standaloneOccluders) {
      if (this.raycaster.intersectObjects(occluder.getAllMeshes(), true).length > 0) {
        this.makeModelTranslucent(occluder);
      } else {
        this.restoreModel(occluder);
      }
    }
    for (const cloud of this.clouds) {
      const blocksPlayer = cloud.visible
        && this.raycaster.intersectObjects(cloud.getAllMeshes(), true).length > 0;
      // Clouds should disappear completely—not become translucent—so the
      // player never has a pale cloud layer covering them.
      cloud.visible = !blocksPlayer;
    }
  }

  private makeTranslucent(shophouse: ENGINE.ModelMeshNode): void {
    for (const model of [shophouse, ...(this.dependentModels.get(shophouse) ?? [])]) {
      this.makeModelTranslucent(model);
    }
  }

  private makeModelTranslucent(model: ENGINE.ModelMeshNode): void {
    if (this.hiddenMaterials.has(model)) {
      return;
    }
    const swaps: MaterialSwap[] = [];
    for (const mesh of model.getAllMeshes()) {
      const original = mesh.material;
      const hidden = Array.isArray(original)
        ? original.map((material) => this.createHiddenMaterial(material))
        : this.createHiddenMaterial(original);
      mesh.material = hidden;
      swaps.push({ mesh, original, hidden });
    }
    this.hiddenMaterials.set(model, swaps);
  }

  private createHiddenMaterial(material: THREE.Material): THREE.Material {
    const hidden = material.clone();
    hidden.transparent = true;
    hidden.opacity = 0.12;
    hidden.depthWrite = false;
    hidden.needsUpdate = true;
    return hidden;
  }

  private restore(shophouse: ENGINE.ModelMeshNode): void {
    for (const model of [shophouse, ...(this.dependentModels.get(shophouse) ?? [])]) {
      this.restoreModel(model);
    }
  }

  private restoreModel(model: ENGINE.ModelMeshNode): void {
    const swaps = this.hiddenMaterials.get(model);
    if (!swaps) {
      return;
    }
    for (const swap of swaps) {
      swap.mesh.material = swap.original;
      const hiddenMaterials = Array.isArray(swap.hidden) ? swap.hidden : [swap.hidden];
      for (const material of hiddenMaterials) {
        material.dispose();
      }
    }
    this.hiddenMaterials.delete(model);
  }

  private restoreAll(): void {
    for (const model of [...this.hiddenMaterials.keys()]) {
      this.restoreModel(model);
    }
  }

  private restoreClouds(): void {
    for (const cloud of this.clouds) {
      cloud.visible = this.cloudAuthoredVisibility.get(cloud) ?? true;
    }
  }
}

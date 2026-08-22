import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { ThirdPersonPlayer } from './player.js';

const AXE_NAME = /^Axe$/i;
const INNER_RADIUS = 0.52;
const OUTER_RADIUS = 0.78;

/** Red ground guide shown beneath the Axe until it is first picked up. */
@ENGINE.GameClass()
export class AxePickupRingSystem extends ENGINE.SceneNode {
  private axe: ENGINE.ModelMeshNode | null = null;
  private player: ThirdPersonPlayer | null = null;
  private ring: ENGINE.MeshNode | null = null;
  private pickedUp = false;

  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({
      name: 'Axe Pickup Ring',
      ...options,
    });
    this.ring = ENGINE.MeshNode.create({
      name: 'Axe Pickup Ring Visual',
      geometry: new THREE.RingGeometry(INNER_RADIUS, OUTER_RADIUS, 40),
      material: new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      castShadow: false,
      receiveShadow: false,
      physicsOptions: { enabled: false },
    });
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 850;
    this.add(this.ring);
  }

  public override postLoad(): void {
    super.postLoad();
    this.applyVisualStyle();
    const world = this.getWorld();
    if (world) {
      this.initializePreview(world);
    }
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    this.applyVisualStyle();
    const world = this.getWorld();
    if (world) {
      this.pickedUp = false;
      this.initializePreview(world);
      this.player = world.getNodes(ThirdPersonPlayer)[0] ?? null;
    }
    return true;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    // Restore the preview ring when returning to editor mode.
    this.pickedUp = false;
    this.player = null;
    if (this.ring) {
      this.ring.visible = true;
    }
    return true;
  }

  public override tickPostPhysics(_deltaTime: number): void {
    super.tickPostPhysics(_deltaTime);
    if (this.pickedUp || !this.ring || !this.axe) {
      return;
    }
    const world = this.getWorld();
    this.player ??= world?.getNodes(ThirdPersonPlayer)[0] ?? null;
    if (this.player?.isHoldingTool(this.axe)) {
      this.pickedUp = true;
      this.destroyRing();
      return;
    }

  }

  private applyVisualStyle(): void {
    if (!this.ring) {
      return;
    }
    this.ring.geometry = new THREE.RingGeometry(INNER_RADIUS, OUTER_RADIUS, 40);
    this.ring.material = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 850;
  }

  private initializePreview(world: ENGINE.World): void {
    this.axe ??= world.getNodes(ENGINE.ModelMeshNode).find((node) => AXE_NAME.test(node.name)) ?? null;
    if (this.axe && !this.pickedUp && this.ring) {
      // The authored scene transform keeps this ring flush with the pavement.
      this.ring.visible = true;
    }
  }

  private destroyRing(): void {
    if (this.ring) {
      this.ring.visible = false;
    }
  }
}

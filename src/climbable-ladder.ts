/**
 * Invisible trigger volume that makes a parent ladder model climbable.
 * Fits the host mesh on play and registers with the player's movement node.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

function hasClimbTarget(
  node: object,
): node is { setClimbTarget(volume: ClimbableLadder | null): void } {
  return typeof (node as { setClimbTarget?: unknown }).setClimbTarget === 'function';
}

@ENGINE.GameClass()
export class ClimbableLadder extends ENGINE.TriggerZoneNode {
  private readonly worldScale = new THREE.Vector3();
  private readonly worldPos = new THREE.Vector3();
  private fitted = false;
  private standoffDistance = 0.7;

  @ENGINE.property({
    type: 'number',
    min: 0.5,
    max: 8,
    step: 0.1,
    category: 'Climb',
    description: 'Vertical climb speed in meters per second.',
  })
  public climbSpeed: number = 2.4;

  public override initialize(options?: ENGINE.TriggerZoneNodeOptions): void {
    super.initialize({
      geometry: new THREE.BoxGeometry(1, 1, 1),
      scale: new THREE.Vector3(1.2, 3, 1.2),
      filter: ENGINE.TriggerFilter.PlayerOnly,
      enableStayEvents: false,
      enableDebugVisualization: false,
      ...options,
      physicsOptions: {
        enabled: true,
        motionType: ENGINE.PhysicsMotionType.Static,
        generateCollisionEvents: true,
        collisionProfile: ENGINE.DefaultCollisionProfile.Trigger,
        contributeToParentCollider: false,
        ...options?.physicsOptions,
      },
    });
    this.filter = ENGINE.TriggerFilter.PlayerOnly;
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }

    this.onActorEntered.add((actor) => this.bindPlayer(actor, this));
    this.onActorExited.add((actor) => this.bindPlayer(actor, null));

    const host = this.findHostMesh();
    if (!host) {
      return true;
    }
    if (host.isModelLoaded()) {
      this.fitToHost(host);
    } else {
      host.onMeshLoaded.add(() => this.fitToHost(host));
    }
    return true;
  }

  public getClimbSpeed(): number {
    return this.climbSpeed;
  }

  public getStandoffDistance(): number {
    return this.standoffDistance;
  }

  public getRailWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.getWorldPosition(target);
  }

  public getClimbMinY(): number {
    this.getWorldPosition(this.worldPos);
    this.getWorldScale(this.worldScale);
    return this.worldPos.y - this.worldScale.y * 0.5;
  }

  public getClimbMaxY(): number {
    this.getWorldPosition(this.worldPos);
    this.getWorldScale(this.worldScale);
    return this.worldPos.y + this.worldScale.y * 0.5;
  }

  private findHostMesh(): ENGINE.ModelMeshNode | null {
    if (this.parent instanceof ENGINE.ModelMeshNode) {
      return this.parent;
    }
    const root = this.getRoot();
    return root instanceof ENGINE.ModelMeshNode ? root : null;
  }

  private fitToHost(host: ENGINE.ModelMeshNode): void {
    if (this.fitted) {
      return;
    }

    const worldBox = new THREE.Box3();
    for (const mesh of host.getAllMeshes()) {
      mesh.geometry.computeBoundingBox();
      const meshBox = mesh.geometry.boundingBox;
      if (!meshBox || meshBox.isEmpty()) {
        continue;
      }
      worldBox.union(meshBox.clone().applyMatrix4(mesh.matrixWorld));
    }
    if (worldBox.isEmpty()) {
      return;
    }

    const localBox = new THREE.Box3();
    const corner = new THREE.Vector3();
    const min = worldBox.min;
    const max = worldBox.max;
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) {
          corner.set(x, y, z);
          host.worldToLocal(corner);
          localBox.expandByPoint(corner);
        }
      }
    }

    const size = localBox.getSize(new THREE.Vector3());
    const center = localBox.getCenter(new THREE.Vector3());
    const padX = Math.max(0.35, size.x * 0.35);
    const padZ = Math.max(0.35, size.z * 0.35);

    this.position.copy(center);
    this.scale.set(size.x + padX * 2, size.y + 0.3, size.z + padZ * 2);

    const worldSize = size.clone().multiply(host.scale);
    this.standoffDistance = Math.min(worldSize.x, worldSize.z) * 0.5 + 0.55;
    this.fitted = true;
    this.refreshPhysicsBody();
  }

  private bindPlayer(actor: ENGINE.SceneNode, volume: ClimbableLadder | null): void {
    if (!(actor instanceof ENGINE.MovementPawn)) {
      return;
    }
    const movement = actor.movementNode;
    if (movement && hasClimbTarget(movement)) {
      movement.setClimbTarget(volume);
    }
  }
}

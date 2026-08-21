/**
 * Invisible slope collider so a character capsule can walk a staircase.
 * Discrete stair treads are thinner than the capsule, so trimesh steps feel like walls.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

@ENGINE.GameClass()
export class StairWalkRamp extends ENGINE.MeshNode {
  public override initialize(options?: ENGINE.MeshNodeOptions): void {
    const width = 1.4;
    const thickness = 0.18;
    const run = 3.12;
    const rise = 3.77;
    const length = Math.hypot(run, rise);
    const pitch = Math.atan2(rise, run);

    super.initialize({
      name: 'WalkRamp',
      ...options,
      geometry: new THREE.BoxGeometry(width, thickness, length),
      selfHidden: true,
      castShadow: false,
      receiveShadow: false,
      physicsOptions: {
        enabled: true,
        motionType: ENGINE.PhysicsMotionType.Static,
        collisionMeshType: ENGINE.CollisionMeshType.BoundingBox,
        ...options?.physicsOptions,
      },
    });

    if (!options?.position) {
      this.position.set(0, rise / 2, -0.02);
    }
    if (!options?.rotation) {
      this.setLocalRotation(ENGINE.MathHelpers.makeRotation({ pitch }));
    }
  }
}

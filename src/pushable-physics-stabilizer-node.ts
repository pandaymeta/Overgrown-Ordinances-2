import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

/** Stabilizes a heavy grounded dynamic prop while preserving gravity and meaningful pushes. */
@ENGINE.GameClass()
export class PushablePhysicsStabilizerNode extends ENGINE.SceneNode {
  @ENGINE.property({ type: 'number', min: 0, max: 20, step: 0.25, category: 'Physics' })
  public linearDamping: number = 6;

  @ENGINE.property({ type: 'number', min: 0.05, max: 2, step: 0.05, category: 'Physics' })
  public settleVelocity: number = 0.35;

  private readonly bounds = new THREE.Box3();
  private readonly groundRayOrigin = new THREE.Vector3();
  private readonly groundRayDirection = new THREE.Vector3(0, -1, 0);
  private physicsRoot: ENGINE.PrimitiveNode | null = null;

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }

    const root = this.getRoot();
    if (!(root instanceof ENGINE.PrimitiveNode)) {
      return true;
    }

    this.physicsRoot = root;
    root.setPhysicsScalarParam(ENGINE.PhysicsScalarParam.LinearDamping, this.linearDamping);
    root.setPhysicsScalarParam(ENGINE.PhysicsScalarParam.AngularDamping, 20);
    root.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.AngularVelocity, [0, 0, 0]);
    return true;
  }

  public override tickPostPhysics(deltaTime: number): void {
    super.tickPostPhysics(deltaTime);
    const root = this.physicsRoot;
    if (!root) {
      return;
    }

    let angular: [number, number, number] | number[] | null = null;
    let linear: [number, number, number] | number[] | null = null;
    try {
      angular = root.getPhysicsVectorParam(ENGINE.PhysicsVectorParam.AngularVelocity);
      linear = root.getPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity);
    } catch {
      // Rapier may still hold borrows after a physics fault — skip this frame.
      return;
    }

    if (angular && (Math.abs(angular[0]) > 1e-6 || Math.abs(angular[1]) > 1e-6 || Math.abs(angular[2]) > 1e-6)) {
      try {
        root.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.AngularVelocity, [0, 0, 0]);
      } catch {
        return;
      }
    }

    if (!linear || !this.isNearGround(root)) {
      return;
    }

    const horizontalSpeedSquared = linear[0] ** 2 + linear[2] ** 2;
    const shouldSettleHorizontal = horizontalSpeedSquared < this.settleVelocity ** 2;
    const shouldSettleVertical = Math.abs(linear[1]) < this.settleVelocity;
    if (shouldSettleHorizontal || shouldSettleVertical) {
      try {
        root.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity, [
          shouldSettleHorizontal ? 0 : linear[0],
          shouldSettleVertical ? 0 : linear[1],
          shouldSettleHorizontal ? 0 : linear[2],
        ]);
      } catch {
        // ignore
      }
    }
  }

  private isNearGround(root: ENGINE.PrimitiveNode): boolean {
    const physicsEngine = this.getPhysicsEngine();
    if (!physicsEngine) {
      return false;
    }

    root.updateMatrixWorld(true);
    this.bounds.setFromObject(root);
    if (this.bounds.isEmpty()) {
      return false;
    }

    this.bounds.getCenter(this.groundRayOrigin);
    this.groundRayOrigin.y = this.bounds.min.y + 0.1;
    const hit = physicsEngine.performHitTest({
      origin: this.groundRayOrigin,
      direction: this.groundRayDirection,
      maxDistance: 0.15,
      stopOnFirstHit: true,
      ignoredRootNodes: [root],
    })[0];
    return hit !== undefined && this.bounds.min.y - hit.hitLocation.y <= 0.03;
  }
}

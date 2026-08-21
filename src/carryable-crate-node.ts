import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

/** Reusable behavior that lets a dynamic PrimitiveNode be carried and released safely. */
@ENGINE.GameClass()
export class CarryableCrateNode extends ENGINE.SceneNode {
  private static readonly activeInstances = new Set<CarryableCrateNode>();

  private originalPhysicsOptions: ENGINE.NodePhysicsOptions | null = null;
  private carried = false;

  @ENGINE.property({ type: 'number', min: 0.5, max: 10, step: 0.1, category: 'Carry' })
  public pickupRange: number = 3;

  /** Whether left-click can throw this object while it is carried. */
  @ENGINE.property({ type: 'boolean', category: 'Carry' })
  public throwEnabled: boolean = true;

  /** Stop and align this object upright when its predicted throw flight finishes. */
  @ENGINE.property({ type: 'boolean', category: 'Carry' })
  public settleFlatAfterThrow: boolean = false;

  /** Attach this object to the avatar's animated right-hand transform while carried. */
  @ENGINE.property({ type: 'boolean', category: 'Carry' })
  public attachToRightHand: boolean = false;

  /** Wear this object around the pawn body (hiding cover) instead of the carry slot. */
  @ENGINE.property({ type: 'boolean', category: 'Carry' })
  public attachToBodyCenter: boolean = false;

  /** Local offset from the body/visual origin while worn as cover. */
  @ENGINE.property({ type: 'vector3', category: 'Carry' })
  public bodyCenterPositionOffset: THREE.Vector3 = new THREE.Vector3();

  @ENGINE.property({ type: 'vector3', category: 'Carry' })
  public rightHandPositionOffset: THREE.Vector3 = new THREE.Vector3();

  @ENGINE.property({ type: 'euler', category: 'Carry' })
  public rightHandRotationOffset: THREE.Euler = new THREE.Euler();

  /** Local rotation applied only while this object is in the regular carry slot. */
  @ENGINE.property({ type: 'euler', category: 'Carry' })
  public carryRotationOffset: THREE.Euler = new THREE.Euler();

  /** Zero uses the player's default range; positive values override it for this object. */
  @ENGINE.property({ type: 'number', min: 0, max: 30, step: 0.5, category: 'Carry' })
  public throwDistanceOverride: number = 0;

  /** Zero uses the player's default apex height; positive values override it. */
  @ENGINE.property({ type: 'number', min: 0, max: 10, step: 0.25, category: 'Carry' })
  public throwArcHeightOverride: number = 0;

  /** Zero uses the player's default carry distance; positive values override it. */
  @ENGINE.property({ type: 'number', min: 0, max: 5, step: 0.1, category: 'Carry' })
  public carryDistanceOverride: number = 0;

  /** Negative values use the player's default carry height. */
  @ENGINE.property({ type: 'number', min: -1, max: 5, step: 0.1, category: 'Carry' })
  public carryHeightOverride: number = -1;

  public static getActiveInstances(world: ENGINE.World): CarryableCrateNode[] {
    return [...this.activeInstances].filter((crate) => crate.getWorld() === world);
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    CarryableCrateNode.activeInstances.add(this);
    return true;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    CarryableCrateNode.activeInstances.delete(this);
    return true;
  }

  public isCarried(): boolean {
    return this.carried;
  }

  public getCrateRoot(): ENGINE.PrimitiveNode | null {
    const root = this.getRoot();
    if (root instanceof ENGINE.PrimitiveNode) {
      return root;
    }
    // Prefab roots are often plain SceneNodes — use the nearest Primitive parent (mesh).
    let current: ENGINE.SceneNode | THREE.Object3D | null = this.parent;
    while (current) {
      if (current instanceof ENGINE.PrimitiveNode) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  public canBeCarried(): boolean {
    return !this.carried && this.getCrateRoot() !== null;
  }

  public beginCarry(): boolean {
    const root = this.getCrateRoot();
    if (!root || this.carried) {
      return false;
    }

    this.originalPhysicsOptions = { ...root.getPhysicsOptions() };
    root.overridePhysicsOptions({ enabled: false });
    this.carried = true;
    return true;
  }

  public moveToWorldPosition(worldPosition: THREE.Vector3): void {
    const root = this.getCrateRoot();
    if (!root || !this.carried) {
      return;
    }

    const localPosition = worldPosition.clone();
    root.parent?.worldToLocal(localPosition);
    root.position.copy(localPosition);
    root.updateMatrixWorld(true);
  }

  public release(linearVelocity?: THREE.Vector3): boolean {
    const root = this.getCrateRoot();
    if (!root || !this.carried) {
      return false;
    }

    const restoredOptions: ENGINE.NodePhysicsOptions = {
      ...this.originalPhysicsOptions,
      enabled: true,
      motionType: ENGINE.PhysicsMotionType.Dynamic,
    };
    root.replacePhysicsOptions(restoredOptions);
    root.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity, [
      linearVelocity?.x ?? 0,
      linearVelocity?.y ?? 0,
      linearVelocity?.z ?? 0,
    ]);
    root.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.AngularVelocity, linearVelocity
      ? [0, 2.5, 1.5]
      : [0, 0, 0]);

    this.carried = false;
    this.originalPhysicsOptions = null;
    return true;
  }
}

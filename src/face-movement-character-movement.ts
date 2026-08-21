import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { ClimbableLadder } from './climbable-ladder.js';

const PAWN_HALF_HEIGHT = 0.9;

/**
 * Character movement on a configurable horizontal basis (world or camera yaw).
 * Root yaw stays locked; RMB orbit look is buffered for the pawn camera.
 */
@ENGINE.GameClass()
export class FaceMovementCharacterMovementNode extends ENGINE.CharacterMovementNode {
  private readonly moveForwardAxis = new THREE.Vector3(0, 0, -1);
  private readonly moveRightAxis = new THREE.Vector3(1, 0, 0);
  private readonly climbAway = new THREE.Vector3();
  private readonly climbFace = new THREE.Vector3(0, 0, -1);
  private readonly climbRail = new THREE.Vector3();
  private readonly climbDelta = new THREE.Vector3();

  private orbiting = false;
  private orbitLookRight = 0;
  private orbitLookUp = 0;

  private climbVolume: ClimbableLadder | null = null;
  private climbing = false;
  private climbLockout = 0;
  private movementFrozen = false;

  /** Sets the horizontal axes used for WASD (typically camera yaw forward/right). */
  public setMoveBasis(forward: THREE.Vector3, right: THREE.Vector3): void {
    this.moveForwardAxis.copy(forward);
    this.moveRightAxis.copy(right);
  }

  /** Pending RMB orbit deltas for this frame (mouse-sensitivity scaled). */
  public consumeOrbitLook(): { right: number; up: number } {
    const look = { right: this.orbitLookRight, up: this.orbitLookUp };
    this.orbitLookRight = 0;
    this.orbitLookUp = 0;
    return look;
  }

  public setClimbTarget(volume: ClimbableLadder | null): void {
    if (this.climbVolume === volume) {
      return;
    }
    this.climbVolume = volume;
    if (!volume && this.climbing) {
      this.endClimb();
    }
  }

  public isClimbing(): boolean {
    return this.climbing;
  }

  public getClimbFace(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.climbFace);
  }

  public getClimbPlayRate(): number {
    if (!this.climbing) {
      return 0;
    }
    const speed = Math.abs(this.verticalVelocity);
    if (speed < 0.15) {
      return 0;
    }
    return this.verticalVelocity >= 0 ? 1 : -1;
  }

  /** Hard-stop locomotion (input + character controller step). */
  public setMovementFrozen(frozen: boolean): void {
    this.movementFrozen = frozen;
    if (frozen) {
      this.addForwardInput(0);
      this.addRightInput(0);
      this.setVelocities(0, 0, 0);
    }
  }

  public isMovementFrozen(): boolean {
    return this.movementFrozen;
  }

  public override initialize(options?: ENGINE.CharacterMovementOptions): void {
    const defaults = ENGINE.CharacterMovementNode.DEFAULT_CHARACTER_CONTROLLER_OPTIONS;
    super.initialize({
      ...options,
      characterControllerOptions: {
        ...defaults,
        ...options?.characterControllerOptions,
        // Handle normal stair treads without snapping onto elevated props such as benches.
        maxSlopeClimbAngle: (70 * Math.PI) / 180,
        minSlopeSlideAngle: (70 * Math.PI) / 180,
        snapToGroundDistance: 0.12,
        autoStepConfig: {
          maxHeight: 0.35,
          minWidth: 0.15,
          includeDynamicBodies: false,
        },
      },
    });
  }

  public override handleMouseDown(button: ENGINE.MouseButton, e: MouseEvent): boolean {
    if (button !== ENGINE.MouseButton.Right) {
      return false;
    }

    this.orbiting = true;
    e.preventDefault();

    const controller = this.getRoot()?.getPlayerController();
    controller?.getInputManager()?.requestPointerLock({ unadjustedMovement: true });
    return true;
  }

  public override handleMouseUp(button: ENGINE.MouseButton, _e: MouseEvent): boolean {
    if (button !== ENGINE.MouseButton.Right) {
      return false;
    }

    this.orbiting = false;
    const controller = this.getRoot()?.getPlayerController();
    controller?.getInputManager()?.exitPointerLock();
    return true;
  }

  public override handleMouseMove(e: MouseEvent): boolean {
    if (!this.orbiting) {
      return false;
    }

    const sensitivity = ENGINE.DefaultPlayerController.inputSettings.lookSensitivity;
    this.orbitLookRight += e.movementX * sensitivity;
    this.orbitLookUp += -e.movementY * sensitivity;
    return true;
  }

  public override jump(strength: number = 1): void {
    if (this.movementFrozen) {
      return;
    }
    if (this.climbing) {
      this.endClimb();
      this.climbLockout = 0.55;
      super.jump(strength);
      return;
    }
    super.jump(strength);
  }

  protected override performMovementStep(deltaTime: number, immediateBodySync: boolean = false): void {
    if (this.movementFrozen) {
      this.addForwardInput(0);
      this.addRightInput(0);
      this.setVelocities(0, 0, 0);
      return;
    }

    const owner = this.getRoot();
    if (!owner) {
      super.performMovementStep(deltaTime, immediateBodySync);
      return;
    }

    this.climbLockout = Math.max(0, this.climbLockout - deltaTime);
    if (this.updateClimbing(deltaTime, immediateBodySync)) {
      owner.rotation.y = 0;
      return;
    }

    const previousForward = owner.forwardDirection.bind(owner);
    const previousRight = owner.rightDirection.bind(owner);
    const lookRightValue = this.lookRightInput.value;
    const lookRightAbsolute = this.lookRightInput.isAbsolute;

    owner.forwardDirection = () => this.moveForwardAxis.clone();
    owner.rightDirection = () => this.moveRightAxis.clone();
    // Root yaw is not mouse-driven; camera yaw pivot handles orbit.
    this.lookRightInput.value = 0;

    try {
      super.performMovementStep(deltaTime, immediateBodySync);
    } finally {
      owner.forwardDirection = previousForward;
      owner.rightDirection = previousRight;
      this.lookRightInput.value = lookRightValue;
      this.lookRightInput.isAbsolute = lookRightAbsolute;
    }

    owner.rotation.y = 0;
  }

  private updateClimbing(deltaTime: number, immediateBodySync: boolean): boolean {
    const volume = this.climbVolume;
    const owner = this.getRoot();
    if (!volume || !owner) {
      if (this.climbing) {
        this.endClimb();
      }
      return false;
    }

    if (!this.climbing) {
      if (this.climbLockout > 0) {
        return false;
      }
      this.beginClimb(volume, owner);
    }

    return this.applyClimbMovement(volume, owner, deltaTime, immediateBodySync);
  }

  private beginClimb(volume: ClimbableLadder, owner: ENGINE.SceneNode): void {
    volume.getRailWorldPosition(this.climbRail);
    this.climbAway.copy(owner.position).sub(this.climbRail);
    this.climbAway.y = 0;
    if (this.climbAway.lengthSq() < 1e-6) {
      this.climbAway.copy(this.moveForwardAxis);
      this.climbAway.y = 0;
    }
    if (this.climbAway.lengthSq() < 1e-6) {
      this.climbAway.set(0, 0, 1);
    } else {
      this.climbAway.normalize();
    }
    this.climbFace.copy(this.climbAway).multiplyScalar(-1);

    const standoff = volume.getStandoffDistance();
    owner.position.x = this.climbRail.x + this.climbAway.x * standoff;
    owner.position.z = this.climbRail.z + this.climbAway.z * standoff;
    if (owner instanceof ENGINE.PrimitiveNode) {
      this.setPawnWorldTransform({ position: owner.position });
    }

    this.climbing = true;
    this.forwardVelocity = 0;
    this.rightVelocity = 0;
    this.verticalVelocity = 0;
    this.setGrounded(true);
  }

  private applyClimbMovement(
    volume: ClimbableLadder,
    owner: ENGINE.SceneNode,
    deltaTime: number,
    immediateBodySync: boolean,
  ): boolean {
    const minY = volume.getClimbMinY() + PAWN_HALF_HEIGHT;
    const maxY = volume.getClimbMaxY() - 0.2;
    const input = this.forwardInput.value;
    const climbSpeed = volume.getClimbSpeed();

    if (owner.position.y >= maxY && input > 0.1) {
      this.endClimb();
      this.climbLockout = 0.2;
      return false;
    }
    if (owner.position.y <= minY && input < -0.1) {
      this.endClimb();
      this.climbLockout = 0.2;
      return false;
    }

    this.verticalVelocity = input * climbSpeed;
    volume.getRailWorldPosition(this.climbRail);
    const standoff = volume.getStandoffDistance();
    const targetX = this.climbRail.x + this.climbAway.x * standoff;
    const targetZ = this.climbRail.z + this.climbAway.z * standoff;

    this.climbDelta.set(
      targetX - owner.position.x,
      this.verticalVelocity * deltaTime,
      targetZ - owner.position.z,
    );

    const root = this.getRoot();
    if (this.hasCharacterController && root instanceof ENGINE.PrimitiveNode) {
      const physicsEngine = this.getPhysicsEngine();
      if (physicsEngine) {
        const { actualMovement } = physicsEngine.computeCharacterMovement(
          this,
          root,
          this.climbDelta.toArray(),
          false,
          deltaTime,
          immediateBodySync,
        );
        root.position.x += actualMovement.x;
        root.position.y += actualMovement.y;
        root.position.z += actualMovement.z;
        root.setPhysicsTransformUpdateFlags({
          sendPosition: true,
          sendRotation: false,
          receivePosition: false,
          receiveRotation: false,
        });
      }
    } else {
      owner.position.add(this.climbDelta);
    }

    owner.position.y = THREE.MathUtils.clamp(owner.position.y, minY, maxY);
    this.forwardVelocity = 0;
    this.rightVelocity = 0;
    this.setGrounded(true);
    this.jumpFrames = 0;
    return true;
  }

  private endClimb(): void {
    this.climbing = false;
    this.verticalVelocity = 0;
  }
}

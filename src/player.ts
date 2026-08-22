import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { createAirmailEnvelope, disposeAirmailEnvelope } from './airmail-envelope.js';
import { installAnimationOneShotHostPatch } from './animation-oneshot-host-patch.js';
import { CarryableCrateNode } from './carryable-crate-node.js';
import { FaceMovementCharacterMovementNode } from './face-movement-character-movement.js';
import { StreetLampDismantlingSystem } from './street-lamp-dismantling-system.js';

installAnimationOneShotHostPatch(ENGINE);

/** Avatar.glb faces the pawn's native forward axis without a yaw correction. */
const MESH_YAW_OFFSET = 0;

/** Pitch from the horizon: -45 looks down at 45° from the floor. */
const LOCKED_CAMERA_PITCH_DEGREES = -45;

/** Camera spring-arm distances in meters. */
const INITIAL_CAMERA_DISTANCE = 3;
const MIN_CAMERA_DISTANCE = 2;
const MAX_CAMERA_DISTANCE = 40;

const AXE_ATTACK_CLIP = 'Attack 01';
const AXE_ATTACK_PLAY_RATE = 2;
/** Left-hand-local placement: keep the hand on the envelope edge, not over its center. */
const MAIL_ENVELOPE_LEFT_HAND_OFFSET = new THREE.Vector3(0.03, -0.075, 0);
const MAIL_ENVELOPE_GRIP_GEOMETRY_OFFSET = new THREE.Vector3(0, -0.08, 0);
/** Hold the envelope on its side in the fingers. */
const MAIL_ENVELOPE_LEFT_HAND_ROTATION = new THREE.Euler(
  Math.PI / 2,
  Math.PI / 2,
  0,
);
const MAIL_ENVELOPE_HIGHLIGHT_RED = new THREE.Color(0xff2f2f);
const MAIL_ENVELOPE_HIGHLIGHT_EMISSIVE = new THREE.Color(0xff0000);

type LocomotionAnimationParameters = {
  isClimbing: boolean;
  isWalking: boolean;
  isRunning: boolean;
  isJumping: boolean;
  forward: number;
};

/**
 * Third person player: WASD relative to camera yaw, mesh faces move direction,
 * pitch locked at 45° from the floor, hold RMB to orbit yaw (root/body stay decoupled).
 */
@ENGINE.GameClass()
export class ThirdPersonPlayer extends ENGINE.CharacterPawn {
  private readonly moveDir = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly carryWorldQuaternion = new THREE.Quaternion();
  private readonly carryParentQuaternion = new THREE.Quaternion();
  private readonly carryGripQuaternion = new THREE.Quaternion();
  private readonly carryGripTwistQuaternion = new THREE.Quaternion();
  private readonly carryGripEuler = new THREE.Euler();
  private readonly carryGripAxis = new THREE.Vector3(1, 0, 0);
  private readonly yawQuat = new THREE.Quaternion();
  private readonly climbFace = new THREE.Vector3();
  private readonly carryPosition = new THREE.Vector3();
  private readonly throwVelocity = new THREE.Vector3();
  private readonly trajectorySegment = new THREE.Vector3();
  private readonly carryAimNdc = new THREE.Vector2();
  private readonly carryAimTarget = new THREE.Vector3();
  private readonly carryAimDelta = new THREE.Vector3();
  private readonly carryAimRaycaster = new THREE.Raycaster();
  private readonly respawnPosition = new THREE.Vector3();
  private readonly respawnRotation = new THREE.Euler();
  private readonly settlePosition = new THREE.Vector3();
  private readonly settleForward = new THREE.Vector3();
  private readonly settleQuaternion = new THREE.Quaternion();
  private readonly downDir = new THREE.Vector3(0, -1, 0);
  private readonly streetLampDismantling = new StreetLampDismantlingSystem();
  private readonly playAxeAttackAnimation = (): void => {
    if (!this.animationNode?.isReady()) {
      return;
    }
    const playPromise = this.animationNode.playOneShot(AXE_ATTACK_CLIP);
    const attackAction = this.animationNode.getActionsMap().get(AXE_ATTACK_CLIP);
    if (attackAction) {
      attackAction.timeScale = AXE_ATTACK_PLAY_RATE;
    }
    void playPromise.then(() => {
      this.restoreLocomotionAnimationAfterAttack();
    }).catch((error: unknown) => {
      console.warn('[Player] Failed to play axe attack animation.', error);
    });
  };

  private cameraYawPivot: ENGINE.SceneNode | null = null;
  private cameraTargetDistance = INITIAL_CAMERA_DISTANCE;
  private cinematicCameraLock = false;
  private movementFrozen = false;
  private mailDeliveryClickHandler: (() => boolean) | null = null;
  private readonly cameraLookTarget = new THREE.Vector3();
  private hasCameraLookTarget = false;
  private cameraLookSmoothing = 7;
  private carriedCrate: ENGINE.PrimitiveNode | null = null;
  private carriedPhysicsOptions: ENGINE.NodePhysicsOptions | null = null;
  private heldTool: ENGINE.PrimitiveNode | null = null;
  private heldToolPhysicsOptions: ENGINE.NodePhysicsOptions | null = null;
  private mailEnvelopeMesh: THREE.Mesh | null = null;
  private mailEnvelopeRequested = false;
  private mailEnvelopeHighlightPulsing = false;
  private mailEnvelopeHighlightTime = 0;
  private readonly mailEnvelopeOffset = new THREE.Vector3();
  private readonly mailEnvelopeBaseColors: THREE.Color[] = [];
  private hoveredCarryable: ENGINE.PrimitiveNode | null = null;
  private calculatedThrowFlightTime: number = 0.65;
  private readonly thrownGravityRestores: Array<{
    crate: ENGINE.PrimitiveNode;
    remaining: number;
    gravityScale: number;
    settleFlat: boolean;
  }> = [];
  private trajectoryRibbon: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;

  /** Radians/sec toward the target body facing. Higher = snappier turn. */
  @ENGINE.property({ type: 'number', min: 1, max: 40, step: 0.5, category: 'Movement' })
  public bodyTurnSpeed: number = 18;

  @ENGINE.property({ type: 'number', min: -100, max: 0, step: 1, category: 'Respawn' })
  public respawnHeight: number = -20;

  @ENGINE.property({ type: 'number', min: 1, max: 10000, step: 1, category: 'Camera' })
  public override cameraMinDistance: number = MIN_CAMERA_DISTANCE;

  @ENGINE.property({ type: 'number', min: 1, max: 10000, step: 1, category: 'Camera' })
  public override cameraMaxDistance: number = MAX_CAMERA_DISTANCE;

  /** Exponential interpolation speed toward the wheel-selected camera distance. */
  @ENGINE.property({ type: 'number', min: 1, max: 30, step: 0.5, category: 'Camera' })
  public cameraZoomSmoothing: number = 10;

  @ENGINE.property({ type: 'number', min: 0.5, max: 10, step: 0.1, category: 'Carry' })
  public pickupRange: number = 2;

  @ENGINE.property({ type: 'number', min: 0.5, max: 5, step: 0.1, category: 'Carry' })
  public carryDistance: number = 1.25;

  @ENGINE.property({ type: 'number', min: 0, max: 3, step: 0.05, category: 'Carry' })
  public carryHeight: number = 0.35;

  @ENGINE.property({ type: 'number', min: 0.25, max: 5, step: 0.25, category: 'Carry' })
  public throwArcHeight: number = 1.5;

  @ENGINE.property({ type: 'number', min: 1, max: 30, step: 0.5, category: 'Carry' })
  public maxThrowDistance: number = 5;

  public override cameraMinPitchDegrees: number = LOCKED_CAMERA_PITCH_DEGREES;
  public override cameraMaxPitchDegrees: number = LOCKED_CAMERA_PITCH_DEGREES;

  protected override createMovementNode(): ENGINE.BasePawnMovementNode {
    return FaceMovementCharacterMovementNode.create({
      name: 'MovementNode',
    });
  }

  protected override setupVisualNode(): ENGINE.SceneNode | null {
    const mesh = super.setupVisualNode();
    if (mesh instanceof ENGINE.ModelMeshNode) {
      // Register before changing modelUrl so late-loading meshes still get shadows.
      mesh.onMeshLoaded.add((_node, object) => {
        this.applyShadowsToVisualObject(object);
      });
      mesh.modelUrl = '@project/assets/character/avatar.glb';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (mesh.isModelLoaded()) {
        this.applyShadowsToVisualObject(mesh);
      }
    }
    return mesh;
  }

  private applyShadowsToVisualObject(root: THREE.Object3D): void {
    root.castShadow = true;
    root.receiveShadow = true;
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh || (child as THREE.SkinnedMesh).isSkinnedMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  private readonly suppressBrowserContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    const world = this.getWorld();
    if (world) {
      this.streetLampDismantling.initialize(world);
      const container = world.gameContainer;
      if (container) {
        container.addEventListener('contextmenu', this.suppressBrowserContextMenu);
        container.querySelector('canvas')?.addEventListener(
          'contextmenu',
          this.suppressBrowserContextMenu,
        );
      }
    }
    const visual = this.visualNode;
    if (visual instanceof ENGINE.ModelMeshNode) {
      void visual.waitForLoad().then(() => {
        this.applyShadowsToVisualObject(visual);
        for (const mesh of visual.getAllMeshes()) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
        for (const { skinnedMesh } of visual.getAllSkinnedMeshes()) {
          skinnedMesh.castShadow = true;
          skinnedMesh.receiveShadow = true;
        }
      });
    }
    return true;
  }

  protected override setupAnimationNode(): ENGINE.AnimationStateMachineNode | null {
    const animationNode = ENGINE.AnimationStateMachineNode.create({
      name: 'AnimationNode',
      configUrl: '@project/assets/character/player.animconfig.json',
    });
    this.add(animationNode);
    return animationNode;
  }

  protected override getInitialCameraPositions(): {
    pivotPosition: THREE.Vector3;
    cameraPosition: THREE.Vector3;
  } {
    return {
      pivotPosition: new THREE.Vector3(0, 0, 0),
      cameraPosition: new THREE.Vector3(0, 0, INITIAL_CAMERA_DISTANCE),
    };
  }

  protected override setupCamera(): THREE.Camera {
    const camera = super.setupCamera();

    // Insert yaw pivot above the pitch pivot so RMB orbit does not rotate the root/mesh.
    // Hierarchy: root -> CameraYawPivot -> CameraPivot -> SpringArm -> Camera
    if (this.cameraPivot) {
      this.cameraYawPivot = ENGINE.SceneNode.create({
        name: 'CameraYawPivot',
      });
      this.add(this.cameraYawPivot);
      this.cameraYawPivot.add(this.cameraPivot);
    }

    if (this.springArm) {
      this.springArm.collisionEnabled = false;
      this.cameraTargetDistance = this.springArm.armLength ?? INITIAL_CAMERA_DISTANCE;
    }

    this.applyLockedPitch();
    return camera;
  }

  public override zoomStep(direction: number): void {
    if (this.cinematicCameraLock) {
      return;
    }
    this.cameraTargetDistance = THREE.MathUtils.clamp(
      this.cameraTargetDistance + direction * this.cameraZoomSensitivity,
      this.cameraMinDistance,
      this.cameraMaxDistance,
    );
  }

  /** Scripted camera distance (meters). Pass `immediate` to snap spring-arm length. */
  public setCameraTargetDistance(distance: number, immediate = false): void {
    this.cameraTargetDistance = THREE.MathUtils.clamp(
      distance,
      this.cameraMinDistance,
      this.cameraMaxDistance,
    );
    if (immediate && this.springArm) {
      this.springArm.armLength = this.cameraTargetDistance;
    }
  }

  /**
   * Reset orbit yaw, pitch lock, look-target, and spring-arm distance for free play.
   * Use after cinematics / next-day teleports so the handoff does not snap.
   */
  public resetGameplayCameraToDefault(distance: number): void {
    this.setCameraLookWorldTarget(null);
    this.setCameraTargetDistance(distance, true);
    if (this.cameraYawPivot) {
      this.cameraYawPivot.rotation.set(0, 0, 0);
    }
    this.applyLockedPitch();
    this.updateMatrixWorld(true);
    if (this.camera) {
      this.camera.updateMatrixWorld(true);
    }
  }

  public getCameraTargetDistance(): number {
    return this.cameraTargetDistance;
  }

  /** Current spring-arm length (meters), falling back to the scripted target. */
  public getCameraArmLength(): number {
    return this.springArm?.armLength ?? this.cameraTargetDistance;
  }

  /** Whether the player is currently providing movement input. */
  public hasMovementInput(): boolean {
    const movementNode = this.movementNode;
    if (!(movementNode instanceof ENGINE.CharacterMovementNode)) {
      return false;
    }
    const { forward, right } = movementNode.getMovementInputs();
    return Math.abs(forward) > 0.01 || Math.abs(right) > 0.01;
  }

  /** When true, player zoom input is ignored (cinematics). */
  public setCinematicCameraLock(locked: boolean): void {
    this.cinematicCameraLock = locked;
  }

  /** Drop carried/thrown objects so a day reset can restore their transforms. */
  public prepareForDayReset(): void {
    this.releaseHeldItemsForDayReset();
    this.streetLampDismantling.prepareScrapForCinematic();
    this.streetLampDismantling.resetDay(this.getWorld());
  }

  /** Release carried/thrown items without touching scrap or world restore. */
  public releaseHeldItemsForDayReset(): void {
    this.releaseCarriedCrate();
    this.releaseHeldTool();
    for (const record of this.thrownGravityRestores) {
      this.restoreCrateGravity(record.crate, record.gravityScale);
      record.crate.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity, [0, 0, 0]);
      record.crate.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.AngularVelocity, [0, 0, 0]);
    }
    this.thrownGravityRestores.length = 0;
    this.setHoveredCarryable(null);
  }

  /** Lighten scrap GPU cost before mailbox / ordinance cinematics (keeps physics). */
  public prepareScrapForCinematic(): void {
    this.streetLampDismantling.prepareScrapForCinematic();
  }

  /** Stage 1 of black-screen day transition: detach scrap, queue deferred destroy. */
  public retireScrapForDayReset(): void {
    this.streetLampDismantling.retireAllScrap();
  }

  public hasPendingScrapDestroys(): boolean {
    return this.streetLampDismantling.hasPendingScrapDestroys();
  }

  /** Queue an orphan / leftover root for deferred GPU-safe destroy (day reset). */
  public retireDetachedRootForDayReset(root: ENGINE.SceneNode): void {
    this.streetLampDismantling.retireDetachedRoot(root);
  }

  public flushPendingScrapDestroys(): void {
    this.streetLampDismantling.flushPendingScrapDestroysNow();
  }

  /** Stage 2: restore dismantled props / health after scrap GPU teardown. */
  public finishDayResetRest(): void {
    this.streetLampDismantling.finishDayReset(this.getWorld());
  }

  /** True while this primitive is held as the player's equipped tool. */
  public isHoldingTool(node: ENGINE.PrimitiveNode | null | undefined): boolean {
    return !!node && this.heldTool === node;
  }

  /** True while this primitive is in the player's carry / body-cover slot. */
  public isCarryingObject(node: ENGINE.SceneNode | null | undefined): boolean {
    return !!node && this.carriedCrate === node;
  }

  /** Current carried crate/prop root, if any. */
  public getCarriedObject(): ENGINE.PrimitiveNode | null {
    return this.carriedCrate;
  }

  /** True while a body-cover bush (attachToBodyCenter) is worn as a disguise. */
  public isWearingBush(): boolean {
    return this.getBodyCoverSettings(this.carriedCrate) !== null;
  }

  /** Mail-delivery flow: traffic cone 5th axe hit → DontRemoveTheCones ordinance. */
  public setTrafficConeFifthHitHandler(handler: (() => void) | null): void {
    this.streetLampDismantling.setTrafficConeFifthHitHandler(handler);
  }

  /** Mail-delivery flow: utility pole dismantled → DontCutThisPole soft-loop when active. */
  public setUtilityPoleDismantledHandler(handler: (() => void) | null): void {
    this.streetLampDismantling.setUtilityPoleDismantledHandler(handler);
  }

  /** Mail-delivery flow: Kanji Sign dismantled → Do not destroy this sign unlock / soft-loop. */
  public setKanjiSignDismantledHandler(handler: (() => void) | null): void {
    this.streetLampDismantling.setKanjiSignDismantledHandler(handler);
  }

  /** Mail-delivery flow: fire hydrant spray → Dont hit the fire hydrant unlock / soft-loop. */
  public setFireHydrantActivatedHandler(handler: (() => void) | null): void {
    this.streetLampDismantling.setFireHydrantActivatedHandler(handler);
  }

  /** Mail-delivery flow: cherry tree cut → No cutting of trees soft-loop when active. */
  public setCherryTreeDismantledHandler(handler: (() => void) | null): void {
    this.streetLampDismantling.setCherryTreeDismantledHandler(handler);
  }

  /** Mail-delivery flow: trail map kiosk dismantled → Dont remove this kiosk unlock / soft-loop. */
  public setTrailMapKioskDismantledHandler(handler: (() => void) | null): void {
    this.streetLampDismantling.setTrailMapKioskDismantledHandler(handler);
  }

  /** Mail-delivery flow: ordinance board axe → Do not remove the SIGNS unlock / soft-loop. */
  public setOrdinanceBoardDismantledHandler(handler: (() => void) | null): void {
    this.streetLampDismantling.setOrdinanceBoardDismantledHandler(handler);
  }

  /** Mail-delivery flow: street lamp dismantled → Dont destroy the street lights soft-loop. */
  public setStreetLampDismantledHandler(handler: (() => void) | null): void {
    this.streetLampDismantling.setStreetLampDismantledHandler(handler);
  }

  /** Freeze/unfreeze WASD + character-controller movement. */
  public setMovementFrozen(frozen: boolean): void {
    this.movementFrozen = frozen;
    if (this.movementNode instanceof FaceMovementCharacterMovementNode) {
      this.movementNode.setMovementFrozen(frozen);
    }
    this.applyMovementFreeze();
  }

  public isMovementFrozen(): boolean {
    return this.movementFrozen;
  }

  /** Snap locomotion animation to idle (clears mid-stride / airborne freeze poses). */
  public forceIdlePose(): void {
    if (this.movementNode instanceof FaceMovementCharacterMovementNode) {
      this.movementNode.addForwardInput(0);
      this.movementNode.addRightInput(0);
      this.movementNode.setVelocities(0, 0, 0);
      this.movementNode.setGrounded(true);
    } else if (this.movementNode instanceof ENGINE.CharacterMovementNode) {
      this.movementNode.addForwardInput(0);
      this.movementNode.addRightInput(0);
      this.movementNode.setVelocities(0, 0, 0);
      this.movementNode.setGrounded(true);
    }
    this.applyMovementFreeze();
    if (!this.animationNode?.isReady()) {
      return;
    }
    const idleParams: LocomotionAnimationParameters = {
      isClimbing: false,
      isWalking: false,
      isRunning: false,
      isJumping: false,
      forward: 0,
    };
    this.animationNode.setParameter(idleParams);
    this.animationNode.transitionGraphToState('base', 'idle');
  }

  private applyMovementFreeze(): void {
    if (!this.movementFrozen) {
      return;
    }
    const movementNode = this.movementNode;
    if (!(movementNode instanceof ENGINE.CharacterMovementNode)) {
      return;
    }
    movementNode.addForwardInput(0);
    movementNode.addRightInput(0);
    movementNode.setVelocities(0, 0, 0);
  }

  /** Teleport to Player Start and clear velocities. */
  public teleportToPlayerStart(): boolean {
    const world = this.getWorld();
    const playerStart = world?.getNodes(ENGINE.PlayerStart)[0];
    if (!playerStart) {
      return false;
    }
    this.releaseCarriedCrate();
    this.releaseHeldTool();
    playerStart.getWorldPosition(this.respawnPosition);
    playerStart.getWorldQuaternion(this.yawQuat);
    this.respawnRotation.setFromQuaternion(this.yawQuat);
    this.movementNode?.setPawnWorldTransform({
      position: this.respawnPosition,
      rotation: this.respawnRotation,
    });
    if (this.movementNode instanceof ENGINE.CharacterMovementNode) {
      this.movementNode.setVelocities(0, 0, 0);
      this.movementNode.setGrounded(false);
    }
    return true;
  }

  /**
   * Snap the capsule onto the ground under the current XZ (Player Start / teleport).
   * Call after teleport and before long freezes so cinematic return does not show a floater.
   */
  public settleOnGround(): boolean {
    const physicsEngine = this.getPhysicsEngine();
    const movementNode = this.movementNode;
    if (!(movementNode instanceof ENGINE.CharacterMovementNode)) {
      this.forceIdlePose();
      return false;
    }

    this.getWorldPosition(this.respawnPosition);
    this.getWorldQuaternion(this.yawQuat);
    this.respawnRotation.setFromQuaternion(this.yawQuat, 'YXZ');

    const castOrigin = this.settlePosition.copy(this.respawnPosition);
    castOrigin.y += 3;
    const hit = physicsEngine?.performHitTest({
      origin: castOrigin,
      direction: this.downDir,
      maxDistance: 14,
      stopOnFirstHit: true,
      ignoredRootNodes: [this],
    })[0];

    if (hit?.hitLocation) {
      // Root is capsule center (~0.9 m above feet).
      this.respawnPosition.y = hit.hitLocation.y + 0.9;
    }

    movementNode.setPawnWorldTransform({
      position: this.respawnPosition,
      rotation: this.respawnRotation,
    });
    movementNode.setVelocities(0, 0, 0);
    movementNode.setGrounded(true);
    this.updateMatrixWorld(true);
    this.forceIdlePose();
    return Boolean(hit?.hitLocation);
  }

  /** Teleport home, plant on the floor, then idle — safe before cinematic freezes. */
  public teleportToPlayerStartAndSettle(): boolean {
    if (!this.teleportToPlayerStart()) {
      return false;
    }
    this.settleOnGround();
    return true;
  }

  public getGameplayCamera(): THREE.Camera | null {
    return this.camera;
  }

  public getAimNdc(out: THREE.Vector2): THREE.Vector2 {
    return out.copy(this.carryAimNdc);
  }

  /** Aim the orbit camera toward a world point (XZ). Smooths over time while set. */
  public setCameraLookWorldTarget(worldPoint: THREE.Vector3 | null): void {
    if (!worldPoint) {
      this.hasCameraLookTarget = false;
      return;
    }
    this.cameraLookTarget.copy(worldPoint);
    this.hasCameraLookTarget = true;
  }

  /** Aim the orbit camera toward a world point (XZ), for cinematics. */
  public lookCameraTowardWorldPoint(worldPoint: THREE.Vector3): void {
    this.setCameraLookWorldTarget(worldPoint);
    this.applyCameraLookYaw(1);
  }

  private applyCameraLookYaw(blend: number): void {
    if (!this.cameraYawPivot || !this.hasCameraLookTarget) {
      return;
    }
    this.getWorldPosition(this.respawnPosition);
    const dx = this.cameraLookTarget.x - this.respawnPosition.x;
    const dz = this.cameraLookTarget.z - this.respawnPosition.z;
    if (dx * dx + dz * dz < 1e-6) {
      return;
    }
    const desiredWorldYaw = Math.atan2(-dx, -dz);
    this.getWorldQuaternion(this.yawQuat);
    this.respawnRotation.setFromQuaternion(this.yawQuat, 'YXZ');
    const desiredLocalYaw = desiredWorldYaw - this.respawnRotation.y;
    const current = this.cameraYawPivot.rotation.y;
    let delta = desiredLocalYaw - current;
    while (delta > Math.PI) {
      delta -= Math.PI * 2;
    }
    while (delta < -Math.PI) {
      delta += Math.PI * 2;
    }
    this.cameraYawPivot.rotation.y = current + delta * THREE.MathUtils.clamp(blend, 0, 1);
  }

  private updateSmoothCameraLook(deltaTime: number): void {
    if (!this.hasCameraLookTarget) {
      return;
    }
    const blend = 1 - Math.exp(-this.cameraLookSmoothing * deltaTime);
    this.applyCameraLookYaw(blend);
  }

  public override tickPrePhysics(deltaTime: number): void {
    this.applyMovementFreeze();
    this.updateSmoothCameraZoom(deltaTime);
    this.updateSmoothCameraLook(deltaTime);
    this.updateMoveBasisFromCamera();
    super.tickPrePhysics(deltaTime);
    this.applyMovementFreeze();
    this.updateBodyFacing(deltaTime);
    this.updateClimbAnimationRate();
    this.updateThrownCrateGravity(deltaTime);
    this.updateHeldTool();
    this.updateCarriedCrate();
    this.updateMailEnvelope(deltaTime);
    this.streetLampDismantling.update(
      this,
      this.heldTool,
      this.camera,
      this.carryAimNdc,
      deltaTime,
    );
    this.updateHoveredCarryable();
    this.respawnIfBelowWorld();
  }

  public override tickPostPhysics(deltaTime: number): void {
    super.tickPostPhysics(deltaTime);
    this.applyMovementFreeze();
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }

    const container = this.getWorld()?.gameContainer;
    if (container) {
      container.removeEventListener('contextmenu', this.suppressBrowserContextMenu);
      container.querySelector('canvas')?.removeEventListener(
        'contextmenu',
        this.suppressBrowserContextMenu,
      );
    }

    this.streetLampDismantling.clear(this.getWorld());
    this.getWorld()?.postProcessManager.clearOutlineSelection();
    this.hoveredCarryable = null;
    this.releaseCarriedCrate();
    this.releaseHeldTool();
    this.mailEnvelopeRequested = false;
    this.clearMailEnvelope();
    for (const record of this.thrownGravityRestores) {
      this.restoreCrateGravity(record.crate, record.gravityScale);
    }
    this.thrownGravityRestores.length = 0;
    if (this.trajectoryRibbon) {
      this.trajectoryRibbon.removeFromParent();
      this.trajectoryRibbon.geometry.dispose();
      this.trajectoryRibbon.material.dispose();
      this.trajectoryRibbon = null;
    }
    return true;
  }

  /** Standard-controller E action (structural IInteractPawn support). */
  public interact(): boolean {
    return this.toggleCarry();
  }

  public endInteract(): void {
    // Pickup/drop is a press action, so release needs no handling.
  }

  public getInteractionNode(): ENGINE.InteractionNode | null {
    return null;
  }

  /** Standard-controller left-click action (structural ICombatPawn support). */
  public fire(): boolean {
    return this.handleCarryPrimaryAction();
  }

  /** Optional LMB intercept (e.g. mailbox delivery click). */
  public setMailDeliveryClickHandler(handler: (() => boolean) | null): void {
    this.mailDeliveryClickHandler = handler;
  }

  /** Show or remove the current mail in the animated left hand. */
  public setMailEnvelopeCarried(carried: boolean): void {
    this.mailEnvelopeRequested = carried;
    if (!carried) {
      this.clearMailEnvelope();
      return;
    }
    this.ensureMailEnvelope();
    this.updateMailEnvelope(0);
  }

  public setMailEnvelopeHighlightPulsing(enabled: boolean): void {
    this.mailEnvelopeHighlightPulsing = enabled;
    if (enabled) {
      this.ensureMailEnvelope();
      return;
    }
    this.restoreMailEnvelopeMaterials();
  }

  public handleCarryPrimaryAction(): boolean {
    if (this.mailDeliveryClickHandler?.()) {
      return true;
    }
    if (this.streetLampDismantling.handlePrimaryAction(
      this,
      this.heldTool,
      this.camera,
      this.carryAimNdc,
      this.playAxeAttackAnimation,
    )) {
      return true;
    }
    const pointedCarryable = this.findPointedCarryable();
    if (pointedCarryable) {
      return this.pickUpCarryable(pointedCarryable);
    }
    return this.throwCarriedCrate();
  }

  public endFire(): boolean {
    return false;
  }

  public altFire(): boolean {
    return false;
  }

  public endAltFire(): boolean {
    return false;
  }

  public reload(): boolean {
    return false;
  }

  public toggleCarry(): boolean {
    if (this.carriedCrate && this.getBodyCoverSettings(this.carriedCrate)) {
      return this.releaseCarriedCrate();
    }
    if (this.heldTool) {
      return this.releaseHeldTool();
    }

    const axe = this.findNearestTool();
    if (axe) {
      return this.pickUpCarryable(axe);
    }
    const hidingBush = this.findNearestBodyCover();
    return hidingBush ? this.pickUpCarryable(hidingBush) : false;
  }

  private pickUpCarryable(crate: ENGINE.PrimitiveNode): boolean {
    if (crate === this.heldTool) {
      return false;
    }

    this.restorePendingCrateGravity(crate);
    if (this.isToolObject(crate)) {
      if (this.heldTool) {
        return false;
      }
      this.heldToolPhysicsOptions = { ...crate.getPhysicsOptions() };
      crate.overridePhysicsOptions({ enabled: false });
      this.heldTool = crate;
      this.setHoveredCarryable(null);
      this.hideTrajectory();
      this.updateHeldTool();
      return true;
    }

    if (this.carriedCrate) {
      return false;
    }
    this.carriedPhysicsOptions = { ...crate.getPhysicsOptions() };
    crate.overridePhysicsOptions({ enabled: false });
    this.carriedCrate = crate;
    this.setHoveredCarryable(null);
    this.updateCarriedCrate();
    return true;
  }

  public throwCarriedCrate(): boolean {
    if (!this.carriedCrate || !this.canThrowCarriedObject()) {
      return false;
    }
    const origin = this.carriedCrate.getWorldPosition(new THREE.Vector3());
    this.calculateThrowVelocity(this.throwVelocity, origin);
    return this.releaseCarriedCrate(this.throwVelocity);
  }

  public setCarryAimCursor(event: MouseEvent): void {
    const container = this.getWorld()?.gameContainer;
    if (!container) {
      return;
    }
    const canvas = container.querySelector('canvas');
    const rect = (canvas ?? container).getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    this.carryAimNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
  }

  private releaseCarriedCrate(linearVelocity?: THREE.Vector3): boolean {
    const crate = this.carriedCrate;
    if (!crate) {
      return false;
    }

    const originalGravityScale = this.carriedPhysicsOptions?.gravityScale ?? 1;
    const isThrow = linearVelocity !== undefined;
    const settleFlat = isThrow && this.shouldSettleCarriedObjectFlat();
    crate.replacePhysicsOptions({
      ...this.carriedPhysicsOptions,
      enabled: true,
      motionType: ENGINE.PhysicsMotionType.Dynamic,
      gravityScale: originalGravityScale,
    });
    crate.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity, [
      linearVelocity?.x ?? 0,
      linearVelocity?.y ?? 0,
      linearVelocity?.z ?? 0,
    ]);
    crate.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.AngularVelocity, [0, 0, 0]);
    if (isThrow) {
      this.thrownGravityRestores.push({
        crate,
        remaining: this.calculatedThrowFlightTime + 0.15,
        gravityScale: originalGravityScale,
        settleFlat,
      });
    }

    this.carriedCrate = null;
    this.carriedPhysicsOptions = null;
    this.hideTrajectory();
    return true;
  }

  private releaseHeldTool(): boolean {
    const tool = this.heldTool;
    if (!tool) {
      return false;
    }

    const originalGravityScale = this.heldToolPhysicsOptions?.gravityScale ?? 1;
    tool.replacePhysicsOptions({
      ...this.heldToolPhysicsOptions,
      enabled: true,
      motionType: ENGINE.PhysicsMotionType.Dynamic,
      gravityScale: originalGravityScale,
    });
    tool.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity, [0, 0, 0]);
    tool.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.AngularVelocity, [0, 0, 0]);
    this.heldTool = null;
    this.heldToolPhysicsOptions = null;
    return true;
  }

  protected override updateCamera(_deltaTime: number): void {
    const movementNode = this.movementNode;
    if (!(movementNode instanceof FaceMovementCharacterMovementNode)) {
      super.updateCamera(_deltaTime);
      return;
    }

    const orbitLook = movementNode.consumeOrbitLook();
    if (this.cameraYawPivot && orbitLook.right !== 0) {
      // Match CharacterMovement yaw sign: makeRotation yaw → -Y
      this.cameraYawPivot.rotation.y -= orbitLook.right * movementNode.lookRightSpeed;
    }

    // Pitch stays locked; RMB vertical look is ignored.
    this.applyLockedPitch();
  }

  private applyLockedPitch(): void {
    if (!this.cameraPivot) {
      return;
    }

    this.cameraPivot.setLocalRotation(
      ENGINE.MathHelpers.makeRotationDegrees({ pitch: LOCKED_CAMERA_PITCH_DEGREES }),
    );
  }

  private updateSmoothCameraZoom(deltaTime: number): void {
    if (!this.springArm) {
      return;
    }

    const currentDistance = this.springArm.armLength ?? this.cameraTargetDistance;
    const blend = 1 - Math.exp(-this.cameraZoomSmoothing * deltaTime);
    const nextDistance = THREE.MathUtils.lerp(currentDistance, this.cameraTargetDistance, blend);
    this.springArm.armLength = Math.abs(nextDistance - this.cameraTargetDistance) < 0.001
      ? this.cameraTargetDistance
      : nextDistance;
  }

  private updateHoveredCarryable(): void {
    const target = this.carriedCrate ? null : this.findPointedCarryable();
    this.setHoveredCarryable(target);
  }

  private setHoveredCarryable(target: ENGINE.PrimitiveNode | null): void {
    if (this.hoveredCarryable === target) {
      return;
    }

    this.hoveredCarryable = target;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    if (target) {
      world.postProcessManager.setOutlineSelection([target]);
    } else if (!this.streetLampDismantling.hasTargetLamp()) {
      world.postProcessManager.clearOutlineSelection();
    }
  }

  private findPointedCarryable(): ENGINE.PrimitiveNode | null {
    const world = this.getWorld();
    const physicsEngine = this.getPhysicsEngine();
    if (!world || this.carriedCrate) {
      return null;
    }
    if (!physicsEngine) {
      return this.findNearestBodyCover();
    }

    this.camera.updateMatrixWorld(true);
    this.carryAimRaycaster.setFromCamera(this.carryAimNdc, this.camera);
    const hit = physicsEngine.performHitTest({
      origin: this.carryAimRaycaster.ray.origin,
      direction: this.carryAimRaycaster.ray.direction,
      maxDistance: 200,
      stopOnFirstHit: true,
      ignoredRootNodes: [this, this.heldTool].filter(
        (node): node is ENGINE.PrimitiveNode => node !== null,
      ),
    })[0];
    const carryable = this.findCarryableAncestor(hit?.hitNode ?? hit?.hitRoot ?? null);
    if (!carryable || carryable === this.heldTool) {
      return this.findNearestBodyCover();
    }

    const playerPosition = this.getWorldPosition(new THREE.Vector3());
    const distance = carryable.getWorldPosition(new THREE.Vector3()).distanceTo(playerPosition);
    return distance <= this.pickupRange ? carryable : this.findNearestBodyCover();
  }

  private findCarryableAncestor(node: THREE.Object3D | null): ENGINE.PrimitiveNode | null {
    let current = node;
    while (current) {
      if (current instanceof ENGINE.PrimitiveNode && this.isDesignatedCarryableCrate(current)) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  private findNearestTool(): ENGINE.PrimitiveNode | null {
    const world = this.getWorld();
    if (!world) {
      return null;
    }

    const playerPosition = this.getWorldPosition(new THREE.Vector3());
    let nearest: ENGINE.PrimitiveNode | null = null;
    let nearestDistance = Infinity;
    for (const primitive of world.getNodes(ENGINE.PrimitiveNode)) {
      if (primitive === this.heldTool || !this.isToolObject(primitive)) {
        continue;
      }
      const distance = primitive.getWorldPosition(new THREE.Vector3()).distanceTo(playerPosition);
      if (distance <= this.pickupRange && distance < nearestDistance) {
        nearest = primitive;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private findNearestBodyCover(): ENGINE.PrimitiveNode | null {
    const world = this.getWorld();
    if (!world || this.carriedCrate) {
      return null;
    }

    const playerPosition = this.getWorldPosition(new THREE.Vector3());
    let nearest: ENGINE.PrimitiveNode | null = null;
    let nearestDistance = Infinity;
    for (const primitive of world.getNodes(ENGINE.PrimitiveNode)) {
      if (
        primitive === this.heldTool
        || !this.isDesignatedCarryableCrate(primitive)
        || !this.getBodyCoverSettings(primitive)
      ) {
        continue;
      }
      const distance = primitive.getWorldPosition(new THREE.Vector3()).distanceTo(playerPosition);
      if (distance <= this.pickupRange && distance < nearestDistance) {
        nearest = primitive;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private isDesignatedCarryableCrate(root: ENGINE.PrimitiveNode): boolean {
    if (/^Cargo Crate 9 Afc (44|45)$/i.test(root.name ?? '')) {
      return true;
    }
    return root.getNodesByPredicate(
      (node) => node instanceof CarryableCrateNode
        || /^Carryable (Crate|Bench|Bush)/i.test(node.name ?? '')
        || ('attachToBodyCenter' in node
          && (node as { attachToBodyCenter?: boolean }).attachToBodyCenter === true),
      1,
    ).length > 0;
  }

  private isToolObject(root: ENGINE.PrimitiveNode): boolean {
    const marker = root.getNodesByPredicate(
      (node) => 'attachToRightHand' in node && 'throwEnabled' in node,
      1,
    )[0] as (ENGINE.SceneNode & {
      attachToRightHand?: boolean;
      throwEnabled?: boolean;
    }) | undefined;
    return marker?.attachToRightHand === true && marker.throwEnabled === false;
  }

  private respawnIfBelowWorld(): void {
    if (this.getWorldPosition(this.respawnPosition).y >= this.respawnHeight) {
      return;
    }

    const world = this.getWorld();
    const playerStart = world?.getNodes(ENGINE.PlayerStart)[0];
    if (!playerStart) {
      return;
    }

    this.releaseCarriedCrate();
    this.releaseHeldTool();
    playerStart.getWorldPosition(this.respawnPosition);
    playerStart.getWorldQuaternion(this.yawQuat);
    this.respawnRotation.setFromQuaternion(this.yawQuat);
    this.movementNode?.setPawnWorldTransform({
      position: this.respawnPosition,
      rotation: this.respawnRotation,
    });
    if (this.movementNode instanceof ENGINE.CharacterMovementNode) {
      this.movementNode.setVelocities(0, 0, 0);
      this.movementNode.setGrounded(false);
    }
  }

  private getCarriedObjectCarryHeight(): number {
    const marker = this.carriedCrate?.getNodesByPredicate(
      (node) => 'carryHeightOverride' in node,
      1,
    )[0] as (ENGINE.SceneNode & { carryHeightOverride?: number }) | undefined;
    const override = marker?.carryHeightOverride ?? -1;
    return override >= 0 ? override : this.carryHeight;
  }

  private getCarriedObjectCarryDistance(): number {
    const marker = this.carriedCrate?.getNodesByPredicate(
      (node) => 'carryDistanceOverride' in node,
      1,
    )[0] as (ENGINE.SceneNode & { carryDistanceOverride?: number }) | undefined;
    const override = marker?.carryDistanceOverride ?? 0;
    return override > 0 ? override : this.carryDistance;
  }

  private canThrowCarriedObject(): boolean {
    const marker = this.carriedCrate?.getNodesByPredicate(
      (node) => 'throwEnabled' in node,
      1,
    )[0] as (ENGINE.SceneNode & { throwEnabled?: boolean }) | undefined;
    return marker?.throwEnabled ?? true;
  }

  private shouldSettleCarriedObjectFlat(): boolean {
    const marker = this.carriedCrate?.getNodesByPredicate(
      (node) => 'settleFlatAfterThrow' in node,
      1,
    )[0] as (ENGINE.SceneNode & { settleFlatAfterThrow?: boolean }) | undefined;
    return marker?.settleFlatAfterThrow ?? false;
  }

  private getRightHandCarrySettings(
    carriedObject: ENGINE.PrimitiveNode | null = this.carriedCrate,
  ): {
    position: THREE.Vector3;
    rotation: THREE.Euler;
  } | null {
    const marker = carriedObject?.getNodesByPredicate(
      (node) => 'attachToRightHand' in node,
      1,
    )[0] as (ENGINE.SceneNode & {
      attachToRightHand?: boolean;
      rightHandPositionOffset?: THREE.Vector3;
      rightHandRotationOffset?: THREE.Euler;
    }) | undefined;
    if (!marker?.attachToRightHand) {
      return null;
    }
    return {
      position: marker.rightHandPositionOffset ?? new THREE.Vector3(),
      rotation: marker.rightHandRotationOffset ?? new THREE.Euler(),
    };
  }

  private getBodyCoverSettings(
    carriedObject: ENGINE.PrimitiveNode | null = this.carriedCrate,
  ): { position: THREE.Vector3 } | null {
    const marker = carriedObject?.getNodesByPredicate(
      (node) => 'attachToBodyCenter' in node,
      1,
    )[0] as (ENGINE.SceneNode & {
      attachToBodyCenter?: boolean;
      bodyCenterPositionOffset?: THREE.Vector3;
    }) | undefined;
    if (!marker?.attachToBodyCenter) {
      return null;
    }
    return {
      position: marker.bodyCenterPositionOffset ?? new THREE.Vector3(),
    };
  }

  private getCarryRotationOffset(carriedObject: ENGINE.PrimitiveNode): THREE.Euler {
    const marker = carriedObject.getNodesByPredicate(
      (node) => 'carryRotationOffset' in node,
      1,
    )[0] as (ENGINE.SceneNode & { carryRotationOffset?: THREE.Euler }) | undefined;
    return marker?.carryRotationOffset ?? this.carryGripEuler.set(0, 0, 0);
  }

  private getCarriedObjectThrowDistance(): number {
    const marker = this.carriedCrate?.getNodesByPredicate(
      (node) => 'throwDistanceOverride' in node,
      1,
    )[0] as (ENGINE.SceneNode & { throwDistanceOverride?: number }) | undefined;
    const override = marker?.throwDistanceOverride ?? 0;
    return override > 0 ? override : this.maxThrowDistance;
  }

  private getCarriedObjectArcHeight(): number {
    const marker = this.carriedCrate?.getNodesByPredicate(
      (node) => 'throwArcHeightOverride' in node,
      1,
    )[0] as (ENGINE.SceneNode & { throwArcHeightOverride?: number }) | undefined;
    const override = marker?.throwArcHeightOverride ?? 0;
    return override > 0 ? override : this.throwArcHeight;
  }

  private updateThrownCrateGravity(deltaTime: number): void {
    for (let index = this.thrownGravityRestores.length - 1; index >= 0; index--) {
      const record = this.thrownGravityRestores[index];
      record.remaining -= deltaTime;
      if (record.remaining > 0) {
        continue;
      }
      this.restoreCrateGravity(record.crate, record.gravityScale);
      if (record.settleFlat) {
        this.settleCrateFlat(record.crate);
      }
      this.thrownGravityRestores.splice(index, 1);
    }
  }

  private restorePendingCrateGravity(crate: ENGINE.PrimitiveNode): void {
    const index = this.thrownGravityRestores.findIndex((record) => record.crate === crate);
    if (index < 0) {
      return;
    }
    const [record] = this.thrownGravityRestores.splice(index, 1);
    this.restoreCrateGravity(crate, record.gravityScale);
  }

  private restoreCrateGravity(crate: ENGINE.PrimitiveNode, gravityScale: number): void {
    crate.getPhysicsOptions().gravityScale = gravityScale;
    crate.setPhysicsScalarParam(ENGINE.PhysicsScalarParam.GravityScale, gravityScale);
  }

  private settleCrateFlat(crate: ENGINE.PrimitiveNode): void {
    const physicsEngine = this.getPhysicsEngine();
    if (!physicsEngine) {
      return;
    }

    crate.getWorldPosition(this.settlePosition);
    crate.getWorldQuaternion(this.settleQuaternion);
    this.settleForward.set(0, 0, -1).applyQuaternion(this.settleQuaternion);
    this.settleForward.y = 0;
    const yaw = this.settleForward.lengthSq() > 1e-8
      ? Math.atan2(-this.settleForward.x, -this.settleForward.z)
      : 0;
    this.settleQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    physicsEngine.teleportBody(crate, this.settlePosition, this.settleQuaternion);
    crate.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity, [0, 0, 0]);
    crate.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.AngularVelocity, [0, 0, 0]);
  }

  private updateHeldTool(): void {
    const tool = this.heldTool;
    const rightHandSettings = this.getRightHandCarrySettings(tool);
    if (!tool || !rightHandSettings) {
      return;
    }
    this.updateCarriedObjectTransform(tool, rightHandSettings);
  }

  private ensureMailEnvelope(): void {
    if (!this.mailEnvelopeRequested || this.mailEnvelopeMesh) {
      return;
    }
    const mesh = createAirmailEnvelope(0.22, 0.02, 0.16, MAIL_ENVELOPE_GRIP_GEOMETRY_OFFSET);
    mesh.name = 'PlayerMailEnvelope';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.visible = false;
    this.add(mesh);
    this.mailEnvelopeMesh = mesh;
    this.captureMailEnvelopeBaseColors(mesh);
  }

  private updateMailEnvelope(deltaTime: number): void {
    this.ensureMailEnvelope();
    const mesh = this.mailEnvelopeMesh;
    const leftHandAnchor = this.visualNode?.getObjectByName('Left_Hand-Global');
    if (!mesh || !leftHandAnchor) {
      if (mesh) {
        mesh.visible = false;
      }
      return;
    }

    this.mailEnvelopeOffset.copy(MAIL_ENVELOPE_LEFT_HAND_OFFSET);
    this.carryPosition.copy(this.mailEnvelopeOffset);
    leftHandAnchor.localToWorld(this.carryPosition);
    this.worldToLocal(this.carryPosition);
    mesh.position.copy(this.carryPosition);

    leftHandAnchor.getWorldQuaternion(this.carryWorldQuaternion);
    this.carryGripQuaternion.setFromEuler(MAIL_ENVELOPE_LEFT_HAND_ROTATION);
    this.carryWorldQuaternion.multiply(this.carryGripQuaternion);
    this.getWorldQuaternion(this.carryParentQuaternion).invert();
    mesh.quaternion.copy(this.carryParentQuaternion.multiply(this.carryWorldQuaternion));
    mesh.visible = true;
    this.updateMailEnvelopeHighlight(deltaTime);
    mesh.updateMatrixWorld(true);
  }

  private clearMailEnvelope(): void {
    if (!this.mailEnvelopeMesh) {
      return;
    }
    disposeAirmailEnvelope(this.mailEnvelopeMesh);
    this.mailEnvelopeMesh = null;
    this.mailEnvelopeBaseColors.length = 0;
    this.mailEnvelopeHighlightTime = 0;
  }

  private captureMailEnvelopeBaseColors(mesh: THREE.Mesh): void {
    this.mailEnvelopeBaseColors.length = 0;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const tintable = material as THREE.Material & { color?: THREE.Color };
      this.mailEnvelopeBaseColors.push(tintable.color?.clone() ?? new THREE.Color(0xffffff));
    }
  }

  private updateMailEnvelopeHighlight(deltaTime: number): void {
    if (!this.mailEnvelopeMesh) {
      return;
    }
    if (!this.mailEnvelopeHighlightPulsing) {
      this.restoreMailEnvelopeMaterials();
      return;
    }

    this.mailEnvelopeHighlightTime += deltaTime;
    const pulse = 0.5 + 0.5 * Math.sin(this.mailEnvelopeHighlightTime * 7);
    const tint = new THREE.Color(0xffffff).lerp(MAIL_ENVELOPE_HIGHLIGHT_RED, 0.35 + pulse * 0.45);
    const materials = Array.isArray(this.mailEnvelopeMesh.material)
      ? this.mailEnvelopeMesh.material
      : [this.mailEnvelopeMesh.material];
    for (const material of materials) {
      const tintable = material as THREE.Material & {
        color?: THREE.Color;
        emissive?: THREE.Color;
        emissiveIntensity?: number;
      };
      tintable.color?.copy(tint);
      tintable.emissive?.copy(MAIL_ENVELOPE_HIGHLIGHT_EMISSIVE);
      if (typeof tintable.emissiveIntensity === 'number') {
        tintable.emissiveIntensity = 0.45 + pulse * 1.35;
      }
      material.needsUpdate = true;
    }
  }

  private restoreMailEnvelopeMaterials(): void {
    if (!this.mailEnvelopeMesh) {
      return;
    }
    const materials = Array.isArray(this.mailEnvelopeMesh.material)
      ? this.mailEnvelopeMesh.material
      : [this.mailEnvelopeMesh.material];
    materials.forEach((material, index) => {
      const tintable = material as THREE.Material & {
        color?: THREE.Color;
        emissive?: THREE.Color;
        emissiveIntensity?: number;
      };
      tintable.color?.copy(this.mailEnvelopeBaseColors[index] ?? new THREE.Color(0xffffff));
      tintable.emissive?.set(0x000000);
      if (typeof tintable.emissiveIntensity === 'number') {
        tintable.emissiveIntensity = 0;
      }
      material.needsUpdate = true;
    });
  }

  private updateCarriedCrate(): void {
    const crate = this.carriedCrate;
    if (!crate) {
      return;
    }

    const bodyCover = this.getBodyCoverSettings(crate);
    if (bodyCover) {
      this.updateBodyCoverTransform(crate, bodyCover);
      this.hideTrajectory();
      return;
    }

    this.updateCarriedObjectTransform(crate, this.getRightHandCarrySettings(crate));
    if (this.canThrowCarriedObject()) {
      this.updateTrajectoryPreview(crate);
    } else {
      this.hideTrajectory();
    }
  }

  private updateBodyCoverTransform(
    carriedObject: ENGINE.PrimitiveNode,
    bodyCover: { position: THREE.Vector3 },
  ): void {
    const carryAnchor = this.visualNode ?? this;
    this.carryPosition.copy(bodyCover.position);
    carryAnchor.localToWorld(this.carryPosition);
    carriedObject.parent?.worldToLocal(this.carryPosition);
    carriedObject.position.copy(this.carryPosition);

    carryAnchor.getWorldQuaternion(this.carryWorldQuaternion);
    if (carriedObject.parent) {
      carriedObject.parent.getWorldQuaternion(this.carryParentQuaternion);
      this.carryParentQuaternion.invert();
      carriedObject.quaternion.copy(
        this.carryParentQuaternion.multiply(this.carryWorldQuaternion),
      );
    } else {
      carriedObject.quaternion.copy(this.carryWorldQuaternion);
    }
    carriedObject.updateMatrixWorld(true);
  }

  private updateCarriedObjectTransform(
    carriedObject: ENGINE.PrimitiveNode,
    rightHandSettings: { position: THREE.Vector3; rotation: THREE.Euler } | null,
  ): void {
    const rightHandAnchor = rightHandSettings
      ? this.visualNode?.getObjectByName('Right_Hand-Global')
      : null;
    const carryAnchor = rightHandAnchor ?? this.visualNode ?? this;
    if (rightHandSettings && rightHandAnchor) {
      this.carryPosition.copy(rightHandSettings.position);
    } else {
      this.carryPosition.set(
        0,
        this.getCarriedObjectCarryHeight(),
        -this.getCarriedObjectCarryDistance(),
      );
    }
    carryAnchor.localToWorld(this.carryPosition);
    carriedObject.parent?.worldToLocal(this.carryPosition);
    carriedObject.position.copy(this.carryPosition);

    carryAnchor.getWorldQuaternion(this.carryWorldQuaternion);
    if (rightHandSettings && rightHandAnchor) {
      const rotation = rightHandSettings.rotation;
      this.carryGripEuler.set(rotation.x, rotation.y, 0, rotation.order);
      this.carryGripQuaternion.setFromEuler(this.carryGripEuler);
      this.carryGripTwistQuaternion.setFromAxisAngle(this.carryGripAxis, rotation.z);
      this.carryGripQuaternion.multiply(this.carryGripTwistQuaternion);
      this.carryWorldQuaternion.multiply(this.carryGripQuaternion);
    } else {
      this.carryGripQuaternion.setFromEuler(this.getCarryRotationOffset(carriedObject));
      this.carryWorldQuaternion.multiply(this.carryGripQuaternion);
    }
    if (carriedObject.parent) {
      carriedObject.parent.getWorldQuaternion(this.carryParentQuaternion);
      this.carryParentQuaternion.invert();
      carriedObject.quaternion.copy(
        this.carryParentQuaternion.multiply(this.carryWorldQuaternion),
      );
    } else {
      carriedObject.quaternion.copy(this.carryWorldQuaternion);
    }
    carriedObject.updateMatrixWorld(true);
  }

  private calculateThrowVelocity(target: THREE.Vector3, origin: THREE.Vector3): THREE.Vector3 {
    const physicsEngine = this.getPhysicsEngine();
    this.camera.updateMatrixWorld(true);
    this.carryAimRaycaster.setFromCamera(this.carryAimNdc, this.camera);

    const ray = this.carryAimRaycaster.ray;
    const hit = physicsEngine?.performHitTest({
      origin: ray.origin,
      direction: ray.direction,
      maxDistance: 200,
      stopOnFirstHit: true,
      ignoredRootNodes: [this, this.carriedCrate, this.heldTool].filter(
        (node): node is ENGINE.PrimitiveNode => node !== null,
      ),
    })[0];
    if (hit) {
      this.carryAimTarget.copy(hit.hitLocation);
    } else {
      this.carryAimTarget.copy(ray.direction).multiplyScalar(30).add(ray.origin);
    }

    this.carryAimDelta.copy(this.carryAimTarget).sub(origin);
    let horizontalDistance = Math.hypot(this.carryAimDelta.x, this.carryAimDelta.z);
    const maxThrowDistance = this.getCarriedObjectThrowDistance();
    if (horizontalDistance > maxThrowDistance) {
      const distanceScale = maxThrowDistance / horizontalDistance;
      this.carryAimDelta.x *= distanceScale;
      this.carryAimDelta.z *= distanceScale;
      horizontalDistance = maxThrowDistance;
    }
    const gravityScale = this.carriedPhysicsOptions?.gravityScale ?? 1;
    const gravityY = (physicsEngine?.getOptions()?.gravity.y ?? -9.81) * gravityScale;
    const gravityMagnitude = Math.max(0.001, Math.abs(gravityY));
    const arcHeight = this.getCarriedObjectArcHeight();
    const apexAboveOrigin = Math.max(arcHeight, this.carryAimDelta.y + 0.1);
    const verticalVelocity = Math.sqrt(2 * gravityMagnitude * apexAboveOrigin);
    const ascentTime = verticalVelocity / gravityMagnitude;
    const descentDistance = Math.max(0, apexAboveOrigin - this.carryAimDelta.y);
    const descentTime = Math.sqrt(2 * descentDistance / gravityMagnitude);
    const flightTime = ascentTime + descentTime;
    this.calculatedThrowFlightTime = flightTime;

    target.set(
      this.carryAimDelta.x / flightTime,
      verticalVelocity,
      this.carryAimDelta.z / flightTime,
    );
    return target;
  }

  private updateTrajectoryPreview(root: ENGINE.PrimitiveNode): void {
    const physicsEngine = this.getPhysicsEngine();
    const world = this.getWorld();
    if (!physicsEngine || !world) {
      return;
    }

    if (!this.trajectoryRibbon) {
      this.trajectoryRibbon = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0.92,
          side: THREE.DoubleSide,
        }),
      );
      this.trajectoryRibbon.name = 'ThrowTrajectoryPreview';
      this.trajectoryRibbon.frustumCulled = false;
      this.trajectoryRibbon.renderOrder = 1000;
      this.trajectoryRibbon.setTransient(true);
      world.add(this.trajectoryRibbon);
    }

    const origin = root.getWorldPosition(new THREE.Vector3());
    const velocity = this.calculateThrowVelocity(new THREE.Vector3(), origin);
    const gravityScale = this.carriedPhysicsOptions?.gravityScale ?? 1;
    const gravityY = (physicsEngine.getOptions()?.gravity.y ?? -9.81) * gravityScale;
    const points: THREE.Vector3[] = [origin.clone()];
    let previous = origin;

    for (let step = 1; step <= 60; step++) {
      const time = step * 0.05;
      const next = origin.clone()
        .addScaledVector(velocity, time);
      next.y += 0.5 * gravityY * time * time;

      this.trajectorySegment.copy(next).sub(previous);
      const segmentLength = this.trajectorySegment.length();
      const hit = segmentLength > 1e-6
        ? physicsEngine.performHitTest({
          origin: previous,
          direction: this.trajectorySegment.normalize(),
          maxDistance: segmentLength,
          stopOnFirstHit: true,
          ignoredRootNodes: [this, root],
        })[0]
        : undefined;

      if (hit) {
        points.push(hit.hitLocation.clone());
        break;
      }
      points.push(next);
      previous = next;
    }

    const geometry = this.createTaperedTrajectoryGeometry(points);
    this.trajectoryRibbon.geometry.dispose();
    this.trajectoryRibbon.geometry = geometry;
    this.trajectoryRibbon.visible = true;
  }

  private createTaperedTrajectoryGeometry(points: THREE.Vector3[]): THREE.BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    const cameraPosition = this.camera.getWorldPosition(new THREE.Vector3());

    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      const tangent = next.clone().sub(previous).normalize();
      const viewDirection = cameraPosition.clone().sub(point).normalize();
      const side = new THREE.Vector3().crossVectors(tangent, viewDirection);
      if (side.lengthSq() < 1e-8) {
        side.copy(this.cameraRight);
      } else {
        side.normalize();
      }

      const progress = points.length > 1 ? index / (points.length - 1) : 1;
      const halfWidth = 0.14 * Math.pow(1 - progress, 0.8);
      positions.push(
        point.x + side.x * halfWidth,
        point.y + side.y * halfWidth,
        point.z + side.z * halfWidth,
        point.x - side.x * halfWidth,
        point.y - side.y * halfWidth,
        point.z - side.z * halfWidth,
      );

      if (index < points.length - 1) {
        const base = index * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  private hideTrajectory(): void {
    if (this.trajectoryRibbon) {
      this.trajectoryRibbon.visible = false;
    }
  }

  private updateMoveBasisFromCamera(): void {
    const movementNode = this.movementNode;
    if (!(movementNode instanceof FaceMovementCharacterMovementNode)) {
      return;
    }

    const yawSource = this.cameraYawPivot ?? this;
    yawSource.getWorldQuaternion(this.yawQuat);

    this.cameraForward.set(0, 0, -1).applyQuaternion(this.yawQuat);
    this.cameraForward.y = 0;
    if (this.cameraForward.lengthSq() < 1e-8) {
      this.cameraForward.set(0, 0, -1);
    } else {
      this.cameraForward.normalize();
    }

    this.cameraRight.set(1, 0, 0).applyQuaternion(this.yawQuat);
    this.cameraRight.y = 0;
    if (this.cameraRight.lengthSq() < 1e-8) {
      this.cameraRight.set(1, 0, 0);
    } else {
      this.cameraRight.normalize();
    }

    movementNode.setMoveBasis(this.cameraForward, this.cameraRight);
  }

  private updateBodyFacing(deltaTime: number): void {
    const mesh = this.visualNode;
    const movementNode = this.movementNode;
    if (!mesh || !(movementNode instanceof ENGINE.CharacterMovementNode)) {
      return;
    }

    if (movementNode instanceof FaceMovementCharacterMovementNode && movementNode.isClimbing()) {
      movementNode.getClimbFace(this.climbFace);
      this.climbFace.y = 0;
      if (this.climbFace.lengthSq() < 1e-8) {
        return;
      }
      this.climbFace.normalize();
      const facingYaw = Math.atan2(-this.climbFace.x, -this.climbFace.z);
      mesh.rotation.y = this.dampAngle(
        mesh.rotation.y,
        MESH_YAW_OFFSET + facingYaw,
        this.bodyTurnSpeed,
        deltaTime,
      );
      return;
    }

    const { forward, right } = movementNode.getMovementInputs();
    if (Math.hypot(forward, right) < 0.01) {
      return;
    }

    // Face the world-space move direction (camera-relative WASD).
    this.moveDir
      .copy(this.cameraForward)
      .multiplyScalar(forward)
      .addScaledVector(this.cameraRight, right);
    this.moveDir.y = 0;
    if (this.moveDir.lengthSq() < 1e-8) {
      return;
    }
    this.moveDir.normalize();

    const facingYaw = Math.atan2(-this.moveDir.x, -this.moveDir.z);
    const targetYaw = MESH_YAW_OFFSET + facingYaw;
    mesh.rotation.y = this.dampAngle(mesh.rotation.y, targetYaw, this.bodyTurnSpeed, deltaTime);
  }

  private updateClimbAnimationRate(): void {
    if (!this.animationNode?.isReady()) {
      return;
    }
    const movementNode = this.movementNode;
    if (!(movementNode instanceof FaceMovementCharacterMovementNode) || !movementNode.isClimbing()) {
      return;
    }

    const playRate = movementNode.getClimbPlayRate();
    for (const action of this.animationNode.getActiveActions()) {
      action.timeScale = playRate;
    }
  }

  private dampAngle(current: number, target: number, lambda: number, deltaTime: number): number {
    let positionDelta = target - current;
    while (positionDelta > Math.PI) positionDelta -= Math.PI * 2;
    while (positionDelta < -Math.PI) positionDelta += Math.PI * 2;
    return current + positionDelta * (1 - Math.exp(-lambda * deltaTime));
  }

  private restoreLocomotionAnimationAfterAttack(): void {
    if (!this.animationNode?.isReady()) {
      return;
    }
    const params = this.getLocomotionAnimationParameters();
    this.animationNode.setParameter(params);
    this.animationNode.transitionGraphToState('base', this.getLocomotionState(params));
  }

  private getLocomotionState(params: LocomotionAnimationParameters): string {
    if (params.isClimbing) {
      return 'climb';
    }
    if (params.isJumping) {
      return 'jump';
    }
    if (params.isRunning) {
      return 'run';
    }
    if (params.isWalking) {
      return 'walk';
    }
    return 'idle';
  }

  private getLocomotionAnimationParameters(): LocomotionAnimationParameters {
    const movementNode = this.movementNode;
    if (!(movementNode instanceof ENGINE.CharacterMovementNode)) {
      return {
        isClimbing: false,
        isWalking: false,
        isRunning: false,
        isJumping: false,
        forward: 0,
      };
    }

    const { forward, right } = movementNode.getMovementInputs();
    const { forward: forwardVelocity, right: rightVelocity } = movementNode.getVelocities();
    const grounded = movementNode.getGrounded?.() ?? true;
    const inputMoving = Math.hypot(forward, right) > 0.01;
    const planarSpeed = Math.hypot(forwardVelocity, rightVelocity);
    const climbing = movementNode instanceof FaceMovementCharacterMovementNode
      && movementNode.isClimbing();

    return {
      isClimbing: climbing,
      isWalking: !climbing && grounded && inputMoving && planarSpeed <= 2,
      isRunning: !climbing && inputMoving && planarSpeed > 2,
      isJumping: !climbing && !grounded,
      forward: inputMoving ? planarSpeed : 0,
    };
  }

  protected override getAnimationParameters(): Record<string, unknown> {
    // Keep a clean idle while movement is frozen (avoids jump pose after teleport).
    if (this.movementFrozen) {
      return {
        isClimbing: false,
        isWalking: false,
        isRunning: false,
        isJumping: false,
        forward: 0,
      };
    }
    return this.getLocomotionAnimationParameters();
  }
}

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { createAirmailEnvelope, disposeAirmailEnvelope } from './airmail-envelope.js';
import { GameSound, playSoundAt } from './game-audio.js';
import { HoverSilhouette } from './hover-silhouette.js';
import type { ThirdPersonPlayer } from './player.js';

const CAT_NAME = /^Cat$/i;
const PEACH_NAME = /^Peach(?:\s|$)/i;
const PEACH_MODEL = /peach-100232/i;
const CHERRY_TREE_NAME = /^Cherry Blossom Tree/i;
const TWO_STOREY_SHOP_NAME = /^Two Storey Shophouse/i;
const THREE_STOREY_SHOP_NAME = /^Three Storey Shophouse/i;
const WIRE_TRIGGER_NAME = /^WireTrigger/i;
const KANJI_SIGN_NAME = /^Kanji Sign$/i;
/** Only asphalt road lanes — not pavement. Used when chasing a peach across the street. */
const ASPHALT_ROAD_NAME = /^(?:MainRoad|LeftSideRoad|RightSideRoad)/i;

const PEACH_LURE_RADIUS = 4;
const PLAYER_INTERACT_RANGE = 2.5;
const MAILBOX_ARRIVE_DISTANCE = 1.75;
const CAT_WALK_SPEED = 2.4;
const CAT_JUMP_SPEED = 11.5;
const PEACH_ARRIVE_DISTANCE = 0.55;
const WAYPOINT_ARRIVE_DISTANCE = 0.35;
const PATROL_STAY_SEC = 10;
/** Soft bob only — keep small so paws stay planted on sidewalk. */
const WALK_BOB_AMPLITUDE = 0.012;
const WALK_BOB_HZ = 5;
/** Extra mid-air height above the start→end chord (scaled by jump length). */
const JUMP_ARC_MIN = 0.4;
const JUMP_ARC_PER_METER = 0.06;
const JUMP_ARC_MAX = 0.95;
const JUMP_DURATION_MIN = 0.16;
/** Sit on canopy top with a slight settle (was floating with a positive pad). */
const TREE_TOP_SETTLE = 0.35;
/** Sit on top of the wire volume, not inside/below the cables. */
const WIRE_TOP_PAD = 0.35;
/** Roof deck as fraction of building AABB height (higher = more on top of roof). */
const TWO_STOREY_ROOF_FRAC = 0.9;
const THREE_STOREY_ROOF_FRAC = 0.96;
/** Extra lift so paws clear the three-storey roof deck. */
const THREE_STOREY_ROOF_LIFT = 0.08;

export type CatMailCourierHooks = {
  getPlayer: () => ThirdPersonPlayer | null;
  getMailbox: () => ENGINE.ModelMeshNode | null;
  isDeliveryPhase: () => boolean;
  /** Fired when the cat reaches a thrown peach (unlock / soft-loop hook). */
  onCatReachedPeach: () => void;
  /** Fired when the cat arrives at the mailbox with mail. */
  onCatDeliveredMail: (via: 'peach' | 'unfed') => void;
  /**
   * Fired as soon as the cat starts walking mail to the mailbox (before arrival).
   * Lets the day claim the cat ordinance immediately so deferred rocks / a mailbox
   * click cannot steal the unlock while the cat is still en route.
   */
  onCatBeganMailboxDelivery: (via: 'peach' | 'unfed') => void;
  /**
   * Fired when the player clicks the cat without a peach-feed credit.
   * Return true if the click was consumed (e.g. soft-loop) and delivery must not start.
   */
  onCatClickedUnfed: () => boolean;
};

enum CatState {
  Idle = 'idle',
  Patrol = 'patrol',
  WalkToPeach = 'walkToPeach',
  WaitingNearPeach = 'waitingNearPeach',
  DeliverToMailbox = 'deliverToMailbox',
}

type PatrolMove = 'walk' | 'jump';

type PatrolWaypoint = {
  world: THREE.Vector3;
  staySec: number;
  move: PatrolMove;
};

/**
 * Peach-lure cat courier + timed roof/wire patrol.
 * Idle/patrol → peach lure → player click (2.5m) → mailbox delivery.
 * Unfed click (in range, aiming) queues No cats on streets.
 */
export class CatMailCourier {
  private readonly hooks: CatMailCourierHooks;
  private cat: ENGINE.ModelMeshNode | null = null;
  private state: CatState = CatState.Idle;
  private targetPeach: ENGINE.ModelMeshNode | null = null;
  private homePosition = new THREE.Vector3();
  private homeQuaternion = new THREE.Quaternion();
  private homeLocalY = 0;
  /** World Y the cat root should use so mesh feet sit on the sidewalk. */
  private groundRootY = 0;
  /** World Y of the sidewalk surface under the cat (mesh feet). */
  private sidewalkSurfaceY = 0;
  /** Root Y − mesh AABB min Y (positive). */
  private feetToRoot = 0.5;
  /** World Y the cat should rest at while idle / after a move. */
  private restWorldY = 0;
  private mixer: THREE.AnimationMixer | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private envelopeMesh: THREE.Mesh | null = null;
  private walkBobElapsed = 0;
  private interactable = false;
  private streetsClickable = false;
  private hovered = false;
  /** How the current mailbox run was started (for ordinance delivery picker). */
  private deliveryVia: 'peach' | 'unfed' | null = null;
  private readonly waypoints: PatrolWaypoint[] = [];
  private patrolIndex = 0;
  private patrolStayRemaining = 0;
  private patrolMoving = false;
  /** Waypoint index to resume toward after a peach / mail interrupt. */
  private patrolResumeIndex = 1;
  /** After eating a peach, wait then resume roam if not clicked for mail. */
  private peachWaitRemaining = 0;
  /**
   * Sticky credit after the cat reaches a thrown peach. Survives the post-eat wait /
   * resume-patrol so a later click still counts as peach-fed (Dont feed the cat).
   */
  private peachFedPending = false;
  private readonly hoverSilhouette = new HoverSilhouette();
  private jumpElapsed = 0;
  private jumpDuration = 0.01;
  /** Peak height above the linear start→end path for the current jump. */
  private jumpArcHeight = JUMP_ARC_MIN;
  private readonly jumpStart = new THREE.Vector3();
  private readonly jumpEnd = new THREE.Vector3();
  private readonly tmpCatPos = new THREE.Vector3();
  private readonly tmpTargetPos = new THREE.Vector3();
  private readonly tmpPlayerPos = new THREE.Vector3();
  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpNdc = new THREE.Vector2();
  private readonly tmpBounds = new THREE.Box3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly lookMatrix = new THREE.Matrix4();
  private readonly lookQuat = new THREE.Quaternion();
  /** Fox GLB faces −Z opposite of THREE.lookAt forward; flip yaw when walking. */
  private readonly faceYawFlip = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI,
  );
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
  private readonly parentWorldQuat = new THREE.Quaternion();
  private readonly tmpLocalPos = new THREE.Vector3();

  constructor(hooks: CatMailCourierHooks) {
    this.hooks = hooks;
  }

  public initialize(world: ENGINE.World): void {
    this.cat = null;
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (CAT_NAME.test(node.name ?? '')) {
        this.cat = node;
        break;
      }
    }
    if (!this.cat) {
      return;
    }

    this.cat.getWorldPosition(this.homePosition);
    this.cat.getWorldQuaternion(this.homeQuaternion);
    this.homeLocalY = this.cat.position.y;
    // Keep authored pavement Y for points 1–2; only measure feet offset for elevated stands.
    this.calibrateFeetOffset();
    this.groundRootY = this.homePosition.y;
    this.sidewalkSurfaceY = this.homePosition.y - this.feetToRoot;
    this.restWorldY = this.groundRootY;
    this.buildPatrolWaypoints(world);
    this.setupAnimations();
    this.setAnimIdle();
    this.state = CatState.Patrol;
    this.patrolIndex = 0;
    this.patrolMoving = false;
    this.patrolStayRemaining = this.waypoints[0]?.staySec ?? PATROL_STAY_SEC;
    this.patrolResumeIndex = 1;
    this.peachWaitRemaining = 0;
    this.peachFedPending = false;
    this.interactable = false;
    this.streetsClickable = false;
    this.clearEnvelope();
  }

  public resetToHome(): void {
    if (!this.cat) {
      return;
    }
    this.state = CatState.Patrol;
    this.targetPeach = null;
    this.interactable = false;
    this.streetsClickable = false;
    this.peachFedPending = false;
    this.setHovered(false);
    this.clearEnvelope();
    this.cat.position.copy(this.homePosition);
    this.cat.quaternion.copy(this.homeQuaternion);
    this.restWorldY = this.homePosition.y;
    this.cat.updateMatrixWorld(true);
    this.patrolIndex = 0;
    this.patrolMoving = false;
    this.patrolStayRemaining = this.waypoints[0]?.staySec ?? PATROL_STAY_SEC;
    this.patrolResumeIndex = 1;
    this.peachWaitRemaining = 0;
    this.setAnimIdle();
  }

  public dispose(): void {
    this.setHovered(false);
    this.hoverSilhouette.clear();
    this.peachFedPending = false;
    this.clearEnvelope();
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.idleAction = null;
    this.walkAction = null;
    this.cat = null;
    this.waypoints.length = 0;
  }

  public tick(deltaTime: number): void {
    if (!this.cat || !this.hooks.isDeliveryPhase()) {
      this.setHovered(false);
      return;
    }

    this.mixer?.update(deltaTime);
    this.hoverSilhouette.syncTransforms();

    switch (this.state) {
      case CatState.Idle:
      case CatState.Patrol:
        this.pollPeachLure();
        if (this.state === CatState.Idle || this.state === CatState.Patrol) {
          this.tickPatrol(deltaTime);
          this.updateStreetsClickable();
        }
        break;
      case CatState.WalkToPeach:
        this.tickWalkToPeach(deltaTime);
        break;
      case CatState.WaitingNearPeach:
        // Keep accepting new thrown peaches so the cat can be re-lured.
        this.pollPeachLure();
        if (this.state === CatState.WaitingNearPeach) {
          this.updateInteractable();
          this.streetsClickable = false;
          this.peachWaitRemaining -= deltaTime;
          if (this.peachWaitRemaining <= 0) {
            this.resumePatrolAfterInterrupt({ continueRoute: true });
          }
        }
        break;
      case CatState.DeliverToMailbox:
        this.tickDeliverToMailbox(deltaTime);
        this.streetsClickable = false;
        break;
      default:
        break;
    }
  }

  /** Call after mailbox outline so cat hover wins when interactable. */
  public tickHoverOutline(): void {
    if (!this.cat || !this.hooks.isDeliveryPhase()) {
      this.setHovered(false);
      return;
    }
    this.updateHoverOutline();
  }

  /**
   * Left-click in range: hand the envelope for mailbox delivery.
   * A peach-fed credit (sticky) always counts as peach delivery — even after the
   * post-eat wait resumes patrol — so Dont feed the cat unlocks correctly.
   */
  public tryInteractByClick(): boolean {
    if (!this.cat || this.state === CatState.DeliverToMailbox) {
      return false;
    }
    if (!this.isAimingAtCat()) {
      return false;
    }
    const inRange = this.isPlayerInInteractRange();
    if (!inRange || this.state === CatState.WalkToPeach) {
      return false;
    }

    // Sticky peach credit beats "unfed" even after WaitingNearPeach timed out.
    if (this.peachFedPending) {
      this.beginMailboxDelivery('peach');
      return true;
    }

    // Unfed click — soft-loop (when No cats is live) must not also start a delivery.
    if (this.hooks.onCatClickedUnfed()) {
      return true;
    }
    this.beginMailboxDelivery('unfed');
    return true;
  }

  /** Drop sticky peach credit (e.g. when Dont feed soft-loops on lure). */
  public clearPeachFedCredit(): void {
    this.peachFedPending = false;
    this.peachWaitRemaining = 0;
  }

  public isInteractable(): boolean {
    if (this.state === CatState.DeliverToMailbox || this.state === CatState.WalkToPeach) {
      return false;
    }
    if (!this.isPlayerInInteractRange()) {
      return false;
    }
    return this.peachFedPending || this.streetsClickable || this.interactable;
  }

  /** True while the cat is carrying mail to the mailbox. */
  public isDeliveringMail(): boolean {
    return this.state === CatState.DeliverToMailbox;
  }

  private buildPatrolWaypoints(world: ENGINE.World): void {
    this.waypoints.length = 0;

    const tree = this.findNearestNamedModel(world, CHERRY_TREE_NAME, this.homePosition);
    const twoStorey = this.findNearestNamedModel(world, TWO_STOREY_SHOP_NAME, this.homePosition);
    const threeStorey = this.findNearestNamedModel(world, THREE_STOREY_SHOP_NAME, this.homePosition);
    const kanji = this.findNearestNamedModel(world, KANJI_SIGN_NAME, this.homePosition);
    const wireTop = this.sampleWireTopY(world);

    // Point 2: same sidewalk lane as home (shared Z), straight +X toward the cherry tree.
    const sidewalk2 = this.pointOnStraightSidewalk(tree);
    const treeTop = tree
      ? this.pointAboveTree(tree)
      : sidewalk2.clone().setY(this.rootYForSurface(wireTop));
    const wireNearTree = new THREE.Vector3(
      -0.2,
      this.rootYForSurface(wireTop + WIRE_TOP_PAD),
      treeTop.z,
    );
    const twoRoof = twoStorey
      ? this.pointOnRoofToward(twoStorey, -0.2, TWO_STOREY_ROOF_FRAC)
      : new THREE.Vector3(11.5, this.rootYForSurface(wireTop + 0.15), -16.3);
    const wireNearTwo = new THREE.Vector3(
      -0.2,
      this.rootYForSurface(wireTop + WIRE_TOP_PAD),
      twoRoof.z,
    );
    const threeRoof = threeStorey
      ? this.pointOnRoofToward(threeStorey, -0.2, THREE_STOREY_ROOF_FRAC, THREE_STOREY_ROOF_LIFT)
      : new THREE.Vector3(11.5, this.rootYForSurface(wireTop + 2.4), -10.4);
    const kanjiApproach = threeStorey && kanji
      ? this.pointOnRoofTowardKanji(threeStorey, kanji)
      : threeRoof.clone().lerp(
        new THREE.Vector3(kanji?.position.x ?? 9, threeRoof.y, kanji?.position.z ?? -13),
        0.45,
      );
    const wireNearKanji = new THREE.Vector3(
      -0.2,
      this.rootYForSurface(wireTop + WIRE_TOP_PAD),
      kanji?.position.z ?? treeTop.z,
    );

    const homeGround = this.homePosition.clone();

    // 1 stay → 2 stay (straight sidewalk) → 3 stay → 4 wire → 5 stay → 6 stay →
    // toward kanji → 7 wire → 8 stay → jump to 2 → walk to 1.
    this.pushWaypoint(homeGround, PATROL_STAY_SEC, 'walk');
    this.pushWaypoint(sidewalk2, PATROL_STAY_SEC, 'walk');
    this.pushWaypoint(treeTop, PATROL_STAY_SEC, 'jump');
    this.pushWaypoint(wireNearTree, 0, 'walk');
    this.pushWaypoint(wireNearTwo, 0, 'walk');
    this.pushWaypoint(twoRoof, PATROL_STAY_SEC, 'jump');
    this.pushWaypoint(threeRoof, PATROL_STAY_SEC, 'jump');
    this.pushWaypoint(kanjiApproach, 0, 'walk');
    this.pushWaypoint(wireNearKanji, 0, 'jump');
    this.pushWaypoint(treeTop.clone(), PATROL_STAY_SEC, 'walk');
    this.pushWaypoint(sidewalk2.clone(), 0, 'jump');
    this.pushWaypoint(homeGround.clone(), 0, 'walk');
  }

  private pushWaypoint(world: THREE.Vector3, staySec: number, move: PatrolMove): void {
    this.waypoints.push({ world, staySec, move });
  }

  /** Measure root↔feet for elevated stands only — does not change authored pavement Y. */
  private calibrateFeetOffset(): void {
    if (!this.cat) {
      return;
    }
    this.cat.updateMatrixWorld(true);
    this.tmpBounds.setFromObject(this.cat);
    this.cat.getWorldPosition(this.tmpCatPos);
    if (this.tmpBounds.isEmpty()) {
      this.feetToRoot = 0.35;
      return;
    }
    this.feetToRoot = Math.max(0.05, this.tmpCatPos.y - this.tmpBounds.min.y);
  }

  /**
   * Asphalt road top under XZ, or null when standing on pavement / off-road.
   * Only MainRoad / LeftSideRoad / RightSideRoad adjust Y (peach chase).
   */
  private sampleAsphaltSurfaceY(world: ENGINE.World, near: THREE.Vector3): number | null {
    let containingY = -Infinity;
    let found = false;
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!ASPHALT_ROAD_NAME.test(node.name ?? '')) {
        continue;
      }
      this.tmpBounds.setFromObject(node);
      if (this.tmpBounds.isEmpty()) {
        continue;
      }
      const pad = 0.15;
      const contains = near.x >= this.tmpBounds.min.x + pad
        && near.x <= this.tmpBounds.max.x - pad
        && near.z >= this.tmpBounds.min.z + pad
        && near.z <= this.tmpBounds.max.z - pad;
      if (!contains) {
        continue;
      }
      found = true;
      containingY = Math.max(containingY, this.tmpBounds.max.y);
    }
    return found ? containingY : null;
  }

  /**
   * Pavement keeps authored home Y. Only when XZ is on Main/Left/Right side roads
   * do we snap feet to that asphalt surface (peach chase across the street).
   */
  private traversalRootYAt(worldX: number, worldZ: number): number {
    const world = this.cat?.getWorld();
    if (!world) {
      return this.groundRootY;
    }
    this.tmpTargetPos.set(worldX, 0, worldZ);
    const asphalt = this.sampleAsphaltSurfaceY(world, this.tmpTargetPos);
    if (asphalt === null) {
      return this.groundRootY;
    }
    return asphalt + this.feetToRoot;
  }

  /** Root Y that plants feet on a given surface (sidewalk / roof / wire). */
  private rootYForSurface(surfaceY: number): number {
    return surfaceY + this.feetToRoot;
  }

  /**
   * Point 2 on the same sidewalk strip as home: identical Z, X toward the tree.
   * Uses authored pavement Y (no road retarget).
   */
  private pointOnStraightSidewalk(tree: ENGINE.ModelMeshNode | null): THREE.Vector3 {
    let targetX = this.homePosition.x + 5.5;
    if (tree) {
      tree.getWorldPosition(this.tmpTargetPos);
      // Stay on the sidewalk lane — don't pull Z toward the tree trunk.
      targetX = THREE.MathUtils.lerp(this.homePosition.x, this.tmpTargetPos.x, 0.55);
    }
    return new THREE.Vector3(targetX, this.groundRootY, this.homePosition.z);
  }

  private findNearestNamedModel(
    world: ENGINE.World,
    pattern: RegExp,
    near: THREE.Vector3,
  ): ENGINE.ModelMeshNode | null {
    let best: ENGINE.ModelMeshNode | null = null;
    let bestDist = Infinity;
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!pattern.test(node.name ?? '')) {
        continue;
      }
      node.getWorldPosition(this.tmpTargetPos);
      const dist = near.distanceToSquared(this.tmpTargetPos);
      if (dist < bestDist) {
        bestDist = dist;
        best = node;
      }
    }
    return best;
  }

  /** Top of the nearest WireTrigger volume (cables sit near the top). */
  private sampleWireTopY(world: ENGINE.World): number {
    let bestTop = 7.1;
    let bestDist = Infinity;
    for (const node of world.getNodes(ENGINE.SceneNode)) {
      if (!WIRE_TRIGGER_NAME.test(node.name ?? '')) {
        continue;
      }
      node.getWorldPosition(this.tmpTargetPos);
      const dist = Math.abs(this.tmpTargetPos.z - this.homePosition.z);
      if (dist >= bestDist) {
        continue;
      }
      bestDist = dist;
      this.tmpBounds.setFromObject(node);
      bestTop = this.tmpBounds.isEmpty()
        ? this.tmpTargetPos.y + 0.5
        : this.tmpBounds.max.y;
    }
    return bestTop;
  }

  /** Stand on the cherry canopy (slightly settled so paws meet the mesh). */
  private pointAboveTree(node: ENGINE.ModelMeshNode): THREE.Vector3 {
    this.tmpBounds.setFromObject(node);
    if (this.tmpBounds.isEmpty()) {
      node.getWorldPosition(this.tmpTargetPos);
      return new THREE.Vector3(
        this.tmpTargetPos.x,
        this.rootYForSurface(this.tmpTargetPos.y + 5.5),
        this.tmpTargetPos.z,
      );
    }
    this.tmpBounds.getCenter(this.tmpTargetPos);
    return new THREE.Vector3(
      this.tmpTargetPos.x,
      this.rootYForSurface(this.tmpBounds.max.y - TREE_TOP_SETTLE),
      this.tmpTargetPos.z,
    );
  }

  private pointOnRoofToward(
    node: ENGINE.ModelMeshNode,
    towardX: number,
    roofFrac: number,
    lift = 0,
  ): THREE.Vector3 {
    this.tmpBounds.setFromObject(node);
    if (this.tmpBounds.isEmpty()) {
      node.getWorldPosition(this.tmpTargetPos);
      return this.tmpTargetPos.clone().setY(
        this.rootYForSurface(this.tmpTargetPos.y + 5.5 * roofFrac + lift),
      );
    }
    this.tmpBounds.getCenter(this.tmpTargetPos);
    const spanX = this.tmpBounds.max.x - this.tmpBounds.min.x;
    const height = this.tmpBounds.max.y - this.tmpBounds.min.y;
    const x = towardX < this.tmpTargetPos.x
      ? this.tmpBounds.min.x + spanX * 0.22
      : this.tmpBounds.max.x - spanX * 0.22;
    // Prefer near the top of the building AABB so the cat sits on the roof deck.
    const roofDeck = this.tmpBounds.min.y + height * roofFrac + lift;
    return new THREE.Vector3(
      x,
      this.rootYForSurface(roofDeck),
      this.tmpTargetPos.z,
    );
  }

  private pointOnRoofTowardKanji(
    roofBuilding: ENGINE.ModelMeshNode,
    kanji: ENGINE.ModelMeshNode,
  ): THREE.Vector3 {
    const roof = this.pointOnRoofToward(
      roofBuilding,
      -0.2,
      THREE_STOREY_ROOF_FRAC,
      THREE_STOREY_ROOF_LIFT,
    );
    kanji.getWorldPosition(this.tmpTargetPos);
    return new THREE.Vector3(
      THREE.MathUtils.lerp(roof.x, this.tmpTargetPos.x, 0.55),
      roof.y,
      THREE.MathUtils.lerp(roof.z, this.tmpTargetPos.z, 0.65),
    );
  }

  private tickPatrol(deltaTime: number): void {
    if (!this.cat || this.waypoints.length === 0) {
      return;
    }

    this.state = CatState.Patrol;

    if (!this.patrolMoving) {
      this.patrolStayRemaining -= deltaTime;
      if (this.patrolStayRemaining > 0) {
        this.setAnimIdle();
        return;
      }
      this.advancePatrolTarget();
      return;
    }

    const target = this.waypoints[this.patrolIndex];
    if (!target) {
      this.patrolMoving = false;
      return;
    }

    const arrived = target.move === 'jump'
      ? this.tickJumpToward(target.world, deltaTime)
      : this.moveTowardWorld(
        target.world,
        deltaTime,
        WAYPOINT_ARRIVE_DISTANCE,
        CAT_WALK_SPEED,
        this.isGroundLevelTarget(target.world.y),
      );

    if (!arrived) {
      return;
    }

    this.restWorldY = target.world.y;
    this.patrolMoving = false;
    this.patrolStayRemaining = target.staySec;
    this.setAnimIdle();
  }

  private advancePatrolTarget(): void {
    if (this.waypoints.length === 0) {
      return;
    }
    this.patrolIndex = (this.patrolIndex + 1) % this.waypoints.length;
    this.patrolMoving = true;
    const target = this.waypoints[this.patrolIndex];
    if (!target) {
      this.patrolMoving = false;
      return;
    }
    if (target.move === 'jump') {
      this.beginJumpTo(target.world);
    }
    this.setAnimWalk();
  }

  private beginJumpTo(worldTarget: THREE.Vector3): void {
    if (!this.cat) {
      return;
    }
    this.cat.getWorldPosition(this.jumpStart);
    this.jumpEnd.copy(worldTarget);
    const horizontal = Math.hypot(
      this.jumpEnd.x - this.jumpStart.x,
      this.jumpEnd.z - this.jumpStart.z,
    );
    const vertical = this.jumpEnd.y - this.jumpStart.y;
    // Longer / higher leaps get a taller visible arc.
    this.jumpArcHeight = THREE.MathUtils.clamp(
      JUMP_ARC_MIN + horizontal * JUMP_ARC_PER_METER + Math.max(0, vertical) * 0.2,
      JUMP_ARC_MIN,
      JUMP_ARC_MAX,
    );
    const pathLen = Math.hypot(horizontal, Math.abs(vertical));
    this.jumpDuration = Math.max(
      JUMP_DURATION_MIN,
      pathLen / CAT_JUMP_SPEED,
    );
    this.jumpElapsed = 0;
  }

  private tickJumpToward(_worldTarget: THREE.Vector3, deltaTime: number): boolean {
    if (!this.cat) {
      return true;
    }
    this.jumpElapsed += deltaTime;
    const t = Math.min(1, this.jumpElapsed / this.jumpDuration);
    // Steady horizontal travel; ballistic Y = chord + 4h t(1-t) (peaks at mid-air).
    this.tmpCatPos.x = THREE.MathUtils.lerp(this.jumpStart.x, this.jumpEnd.x, t);
    this.tmpCatPos.z = THREE.MathUtils.lerp(this.jumpStart.z, this.jumpEnd.z, t);
    const chordY = THREE.MathUtils.lerp(this.jumpStart.y, this.jumpEnd.y, t);
    this.tmpCatPos.y = chordY + 4 * this.jumpArcHeight * t * (1 - t);

    this.tmpForward.copy(this.jumpEnd).sub(this.jumpStart);
    this.tmpForward.y = 0;
    if (this.tmpForward.lengthSq() > 1e-6) {
      this.tmpForward.normalize();
      this.tmpTargetPos.copy(this.tmpCatPos).add(this.tmpForward);
      this.lookMatrix.lookAt(this.tmpCatPos, this.tmpTargetPos, this.upAxis);
      this.lookQuat.setFromRotationMatrix(this.lookMatrix).multiply(this.faceYawFlip);
    }

    this.applyWorldPose(this.tmpCatPos, this.lookQuat, this.tmpCatPos.y);
    return t >= 1;
  }

  private setupAnimations(): void {
    if (!this.cat) {
      return;
    }
    const clips = this.cat.getAnimations();
    if (!clips.length) {
      this.mixer = null;
      return;
    }
    const root = this.cat;
    this.mixer = new THREE.AnimationMixer(root);
    const idleClip = clips.find((c) => /idle/i.test(c.name)) ?? null;
    const walkClip = clips.find((c) => /walk|run|locomotion/i.test(c.name))
      ?? clips[0]
      ?? null;
    this.idleAction = idleClip ? this.mixer.clipAction(idleClip) : null;
    this.walkAction = walkClip ? this.mixer.clipAction(walkClip) : null;
  }

  private setAnimIdle(): void {
    this.walkBobElapsed = 0;
    if (this.cat) {
      this.snapWorldY(this.restWorldY);
    }
    if (!this.mixer) {
      return;
    }
    this.walkAction?.fadeOut(0.15);
    if (this.idleAction) {
      this.idleAction.reset().fadeIn(0.15).play();
    } else {
      this.walkAction?.stop();
    }
  }

  private setAnimWalk(): void {
    if (!this.mixer) {
      return;
    }
    this.idleAction?.fadeOut(0.15);
    if (this.walkAction) {
      this.walkAction.reset().fadeIn(0.15).play();
    }
  }

  private isPeachProp(node: ENGINE.ModelMeshNode): boolean {
    if (PEACH_NAME.test(node.name ?? '')) {
      return true;
    }
    return PEACH_MODEL.test(node.modelUrl ?? '');
  }

  private pollPeachLure(): void {
    if (!this.cat) {
      return;
    }
    const world = this.cat.getWorld();
    const player = this.hooks.getPlayer();
    if (!world || !player) {
      return;
    }

    this.cat.getWorldPosition(this.tmpCatPos);
    let best: ENGINE.ModelMeshNode | null = null;
    let bestDist = Infinity;
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!this.isPeachProp(node) || !node.visible) {
        continue;
      }
      if (player.isCarryingObject(node)) {
        continue;
      }
      if (this.state === CatState.WalkToPeach && node === this.targetPeach) {
        continue;
      }
      node.getWorldPosition(this.tmpTargetPos);
      // Horizontal lure so an elevated cat still notices peaches on the ground.
      const dist = Math.hypot(
        this.tmpTargetPos.x - this.tmpCatPos.x,
        this.tmpTargetPos.z - this.tmpCatPos.z,
      );
      if (dist > PEACH_LURE_RADIUS || dist >= bestDist) {
        continue;
      }
      best = node;
      bestDist = dist;
    }
    if (!best) {
      return;
    }

    this.rememberPatrolResumeIndex();
    this.targetPeach = best;
    this.interactable = false;
    this.streetsClickable = false;
    this.peachWaitRemaining = 0;
    this.setHovered(false);
    this.state = CatState.WalkToPeach;
    this.setAnimWalk();
  }

  private rememberPatrolResumeIndex(): void {
    if (this.waypoints.length === 0) {
      this.patrolResumeIndex = 1;
      return;
    }
    if (this.state === CatState.Patrol || this.state === CatState.Idle) {
      // If already walking to a waypoint, keep that destination; if staying, go next.
      this.patrolResumeIndex = this.patrolMoving
        ? this.patrolIndex
        : (this.patrolIndex + 1) % this.waypoints.length;
    }
  }

  private tickWalkToPeach(deltaTime: number): void {
    if (!this.cat || !this.targetPeach || !this.targetPeach.visible) {
      this.resumePatrolAfterInterrupt({ continueRoute: true });
      this.targetPeach = null;
      return;
    }

    // Straight to the peach XZ — only dip Y when the path crosses asphalt roads.
    this.targetPeach.getWorldPosition(this.tmpTargetPos);
    this.tmpTargetPos.y = this.traversalRootYAt(this.tmpTargetPos.x, this.tmpTargetPos.z);
    const arrived = this.moveTowardWorld(
      this.tmpTargetPos,
      deltaTime,
      PEACH_ARRIVE_DISTANCE,
      CAT_WALK_SPEED,
      true,
    );
    if (!arrived) {
      return;
    }

    this.hidePeach(this.targetPeach);
    this.targetPeach = null;
    this.cat.getWorldPosition(this.tmpCatPos);
    this.restWorldY = this.traversalRootYAt(this.tmpCatPos.x, this.tmpCatPos.z);
    this.peachWaitRemaining = PATROL_STAY_SEC;
    this.peachFedPending = true;
    this.state = CatState.WaitingNearPeach;
    this.setAnimIdle();
    this.hooks.onCatReachedPeach();
    this.updateInteractable();
  }

  private hidePeach(peach: ENGINE.ModelMeshNode): void {
    peach.visible = false;
    peach.overridePhysicsOptions({ enabled: false });
  }

  private updateInteractable(): void {
    const player = this.hooks.getPlayer();
    if (!this.cat || !player) {
      this.interactable = false;
      return;
    }
    this.cat.getWorldPosition(this.tmpCatPos);
    player.getWorldPosition(this.tmpPlayerPos);
    this.interactable = this.tmpCatPos.distanceTo(this.tmpPlayerPos) <= PLAYER_INTERACT_RANGE;
  }

  private updateStreetsClickable(): void {
    const player = this.hooks.getPlayer();
    if (!this.cat || !player) {
      this.streetsClickable = false;
      return;
    }
    this.cat.getWorldPosition(this.tmpCatPos);
    player.getWorldPosition(this.tmpPlayerPos);
    this.streetsClickable = this.tmpCatPos.distanceTo(this.tmpPlayerPos) <= PLAYER_INTERACT_RANGE;
  }

  private beginMailboxDelivery(via: 'peach' | 'unfed'): void {
    if (!this.cat) {
      return;
    }
    // A peach-fed cat sounds content; an unfed one sounds like it wants paying.
    const meowAt = new THREE.Vector3();
    this.cat.getWorldPosition(meowAt);
    playSoundAt(
      this.cat.getWorld(),
      via === 'peach' ? GameSound.CatMeow : GameSound.CatMeowHungry,
      meowAt,
      0.9,
    );
    this.deliveryVia = via;
    this.interactable = false;
    this.streetsClickable = false;
    this.peachWaitRemaining = 0;
    this.peachFedPending = false;
    this.setHovered(false);
    this.attachEnvelope();
    this.state = CatState.DeliverToMailbox;
    this.setAnimWalk();
    this.hooks.onCatBeganMailboxDelivery(via);
  }

  private tickDeliverToMailbox(deltaTime: number): void {
    const mailbox = this.hooks.getMailbox();
    if (!this.cat || !mailbox) {
      return;
    }
    mailbox.getWorldPosition(this.tmpTargetPos);
    this.tmpTargetPos.y = this.traversalRootYAt(this.tmpTargetPos.x, this.tmpTargetPos.z);
    const arrived = this.moveTowardWorld(
      this.tmpTargetPos,
      deltaTime,
      MAILBOX_ARRIVE_DISTANCE,
      CAT_WALK_SPEED,
      true,
    );
    if (!arrived) {
      return;
    }

    this.clearEnvelope();
    const via = this.deliveryVia ?? 'peach';
    this.deliveryVia = null;
    this.hooks.onCatDeliveredMail(via);
    this.resumePatrolAfterInterrupt({ continueRoute: false });
  }

  private resumePatrolAfterInterrupt(options: { continueRoute: boolean }): void {
    this.peachWaitRemaining = 0;
    this.interactable = false;
    this.streetsClickable = false;
    this.setHovered(false);
    this.cat?.getWorldPosition(this.tmpCatPos);
    this.restWorldY = this.traversalRootYAt(this.tmpCatPos.x, this.tmpCatPos.z);
    this.state = CatState.Patrol;

    if (!options.continueRoute || this.waypoints.length === 0) {
      this.patrolIndex = 0;
      this.patrolMoving = false;
      this.patrolStayRemaining = this.waypoints[0]?.staySec ?? PATROL_STAY_SEC;
      this.patrolResumeIndex = 1;
      this.setAnimIdle();
      return;
    }

    // Jump back onto the saved destination and keep the roam loop going.
    this.patrolIndex = this.patrolResumeIndex;
    this.patrolMoving = true;
    this.patrolStayRemaining = 0;
    const target = this.waypoints[this.patrolIndex];
    if (!target) {
      this.patrolMoving = false;
      this.setAnimIdle();
      return;
    }
    if (target.move === 'jump') {
      this.beginJumpTo(target.world);
    }
    this.setAnimWalk();
  }

  private moveTowardWorld(
    worldTarget: THREE.Vector3,
    deltaTime: number,
    arriveDistance: number,
    speed: number,
    followGround = false,
  ): boolean {
    if (!this.cat) {
      return true;
    }
    this.cat.getWorldPosition(this.tmpCatPos);
    this.tmpForward.copy(worldTarget).sub(this.tmpCatPos);
    // Peach / pavement walks are always straight in XZ toward the target.
    if (followGround || this.isGroundLevelTarget(worldTarget.y)) {
      this.tmpForward.y = 0;
    }
    const distance = this.tmpForward.length();
    if (distance <= arriveDistance) {
      const landY = (followGround || this.isGroundLevelTarget(worldTarget.y))
        ? this.traversalRootYAt(worldTarget.x, worldTarget.z)
        : worldTarget.y;
      this.tmpTargetPos.copy(worldTarget);
      this.tmpTargetPos.y = landY;
      this.applyWorldPose(this.tmpTargetPos, null, landY);
      this.restWorldY = landY;
      return true;
    }

    this.tmpForward.multiplyScalar(1 / distance);
    const step = Math.min(distance, speed * deltaTime);
    this.tmpCatPos.addScaledVector(this.tmpForward, step);

    if (followGround || this.isGroundLevelTarget(worldTarget.y)) {
      this.tmpCatPos.y = this.traversalRootYAt(this.tmpCatPos.x, this.tmpCatPos.z);
    }

    this.tmpTargetPos.copy(this.tmpCatPos).add(this.tmpForward);
    this.lookMatrix.lookAt(this.tmpCatPos, this.tmpTargetPos, this.upAxis);
    this.lookQuat.setFromRotationMatrix(this.lookMatrix).multiply(this.faceYawFlip);

    let y = this.tmpCatPos.y;
    if (!this.walkAction) {
      this.walkBobElapsed += deltaTime;
      y += Math.sin(this.walkBobElapsed * Math.PI * 2 * WALK_BOB_HZ) * WALK_BOB_AMPLITUDE;
    }

    this.applyWorldPose(this.tmpCatPos, this.lookQuat, y);
    return false;
  }

  private isGroundLevelTarget(worldY: number): boolean {
    return worldY <= this.groundRootY + 1.75;
  }

  /** Legacy ground-only helper still used conceptually via moveTowardWorld. */
  private applyWorldPose(
    worldPos: THREE.Vector3,
    worldQuat: THREE.Quaternion | null,
    worldY: number,
  ): void {
    if (!this.cat) {
      return;
    }
    this.tmpLocalPos.copy(worldPos);
    this.tmpLocalPos.y = worldY;
    if (this.cat.parent) {
      this.cat.parent.worldToLocal(this.tmpLocalPos);
      this.cat.position.copy(this.tmpLocalPos);
      if (worldQuat) {
        this.cat.parent.getWorldQuaternion(this.parentWorldQuat);
        this.cat.quaternion.copy(this.parentWorldQuat.invert()).multiply(worldQuat);
      }
    } else {
      this.cat.position.copy(this.tmpLocalPos);
      if (worldQuat) {
        this.cat.quaternion.copy(worldQuat);
      }
    }
    this.cat.updateMatrixWorld(true);
  }

  private snapWorldY(worldY: number): void {
    if (!this.cat) {
      return;
    }
    this.cat.getWorldPosition(this.tmpCatPos);
    this.tmpCatPos.y = worldY;
    this.applyWorldPose(this.tmpCatPos, null, worldY);
  }

  private attachEnvelope(): void {
    this.clearEnvelope();
    if (!this.cat) {
      return;
    }
    const mesh = createAirmailEnvelope(0.22, 0.02, 0.16);
    mesh.name = 'CatMailEnvelope';
    // After faceYawFlip, snout is +Z in local space — keep the letter at the mouth.
    mesh.position.set(0, 0.38, 0.55);
    this.cat.add(mesh);
    this.envelopeMesh = mesh;
  }

  private clearEnvelope(): void {
    if (!this.envelopeMesh) {
      return;
    }
    disposeAirmailEnvelope(this.envelopeMesh);
    this.envelopeMesh = null;
  }

  private updateHoverOutline(): void {
    const ready = this.isInteractable() && this.isAimingAtCat();
    this.setHovered(ready);
  }

  private isPlayerInInteractRange(): boolean {
    const player = this.hooks.getPlayer();
    if (!player || !this.cat) {
      return false;
    }
    this.cat.getWorldPosition(this.tmpCatPos);
    player.getWorldPosition(this.tmpPlayerPos);
    return this.tmpCatPos.distanceTo(this.tmpPlayerPos) <= PLAYER_INTERACT_RANGE;
  }

  private setHovered(enabled: boolean): void {
    if (this.hovered === enabled) {
      if (enabled) {
        this.hoverSilhouette.syncTransforms();
      }
      return;
    }
    this.hovered = enabled;
    const world = this.cat?.getWorld();
    if (!world || !this.cat) {
      this.hoverSilhouette.setTarget(null, null);
      return;
    }
    this.hoverSilhouette.setTarget(world, enabled ? this.cat : null);
  }

  private isAimingAtCat(): boolean {
    const player = this.hooks.getPlayer();
    if (!player || !this.cat) {
      return false;
    }
    const camera = player.getGameplayCamera();
    if (!camera) {
      return false;
    }
    player.getAimNdc(this.tmpNdc);
    this.raycaster.setFromCamera(this.tmpNdc, camera);
    this.raycaster.far = 200;
    const meshes = this.cat.getAllMeshes();
    if (meshes.length > 0) {
      const hits = this.raycaster.intersectObjects(meshes, true);
      if (hits.length > 0) {
        return true;
      }
    }
    const bounds = new THREE.Box3().setFromObject(this.cat);
    if (bounds.isEmpty()) {
      this.cat.getWorldPosition(this.tmpCatPos);
      bounds.setFromCenterAndSize(this.tmpCatPos, new THREE.Vector3(1.2, 1.2, 1.2));
    } else {
      bounds.expandByScalar(0.25);
    }
    return this.raycaster.ray.intersectBox(bounds, this.tmpTargetPos) !== null;
  }
}

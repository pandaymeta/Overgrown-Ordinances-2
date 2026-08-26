import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';
import { CarryableCrateNode } from './carryable-crate-node.js';
import { SKIP_ENVIRONMENT_ART_FLAG } from './environment-art-direction.js';
import { GameSound, playSoundAt } from './game-audio.js';
import { HoverSilhouette } from './hover-silhouette.js';
import { HydrantWaterStream } from './hydrant-water-stream.js';

const STREET_LAMP_NAME = /^Street Lamp(?:\s|$)/i;
const GUARDRAIL_D_NAME = /^Guardrail D(?:\s|$)/i;
const GUARDRAIL_SECTION_NAME = /^Guardrail Section(?:\s|$)/i;
const PARK_BENCH_NAME = /^Park Bench(?:\s|$)/i;
const CHERRY_BLOSSOM_TREE_NAME = /^Cherry Blossom Tree(?:\s|$)/i;
const TRAIL_MAP_KIOSK_NAME = /^Trail Map Kiosk(?:\s|$)/i;
const STONE_LANTERN_NAME = /^Stone Lantern(?:\s|$)/i;
const TRAFFIC_CONE_C_NAME = /^Traffic Cone C(?! flat(?:\s|$))(?:\s|$)/i;
const CARGO_CRATE_NAME = /^Cargo Crate(?:\s|$)/i;
const BUSH_8_BB_NAME = /^Bush 8 Bb\s+\d+/i;
const FIRE_HYDRANT_NAME = /^Fire Hydrant\b(?!\s*\d*\s*$)/i;
const KANJI_SIGN_NAME = /^Kanji Sign$/i;
const KANJI_SIGN_POSE_NAME = /^Kanji Sign 02$/i;
const UTILITY_POLE_16_NAME = /^Utility Pole 16$/i;
const UTILITY_POLE_17_NAME = /^Utility Pole 17$/i;
const UTILITY_POLE_15_NAME = /^Utility Pole 15$/i;
const UTILITY_POLE_19_POSE_NAME = /^Utility Pole 19$/i;
const UTILITY_POLE_20_DUMMY_NAME = /^Utility Pole 20$/i;
const UTILITY_POLE_20_STANDING_NAME = /^Utility Pole 20 Mesh$/i;
const UTILITY_POLE_18_TARGET_NAME = /^Utility Pole 18$/i;
const UTILITY_POLE_18_MODEL_URL = '@project/assets/PolyforkAssets/utilitypole/utility-pole-16.glb';
const SMALL_ROCK_NAME = /^Small Rock/i;
const PEACH_PROJECTILE_NAME = /^Peach(?:\s|$)/i;
const SMALL_ROCK_MODEL = /small-rock-457be8/i;
const PEACH_PROJECTILE_MODEL = /peach-100232/i;
const AXE_MODEL_NAME = /(?:^|\/)Axe\.glb$/i;
const OUTLINE_GREEN = 0x39ff63;
/**
 * Camera→hit ray can be much longer than player interaction range in iso view.
 * Proximity is checked against the player, not this length.
 */
const AIM_RAY_MAX = 40;
const INTERACTION_RANGE = 2;
const BUSH_INTERACTION_RANGE = 5;
const KANJI_SIGN_INTERACTION_RANGE = 10;
const ORDINANCE_BOARD_INTERACTION_RANGE = 6;
const UTILITY_POLE_INTERACTION_RANGE = 2.5;
/** Standing ordinance boards (axe → fallen dynamic prefab). */
const ORDINANCE_BOARD_MODEL_PATH = /PolyforkAssets\/Ordinances\/([^/?#]+)\.glb/i;
/** Current generated cards use a separate v5 folder rather than the legacy Ordinances path. */
const ORDINANCE_CARD_V5_MODEL_PATH = /(?:^|\/)([A-Za-z]+)_Card_(?:[A-Za-z]+_)?v5\.glb$/i;
/** Pole/lamp scrap drops and already-fallen meshes — not axe targets. */
const ORDINANCE_BOARD_NON_TARGET_NAME = /(?:\s+Drop|\s+Fallen(?:\s+Mesh)?)(?:\s+\d+)?$/i;
/**
 * Explicit @project literals so Genesys build copies these into `.dist`.
 * Keys match Ordinances/*.glb basenames (case-insensitive lookup at runtime).
 */
const ORDINANCE_BOARD_FALLEN_PREFABS: Record<string, string> = {
  Bench: '@project/assets/prefabs/ordinance-bench-fallen.prefab.json',
  Birds: '@project/assets/prefabs/ordinance-birds-fallen.prefab.json',
  Bushes: '@project/assets/prefabs/ordinance-bushes-fallen.prefab.json',
  Car: '@project/assets/prefabs/ordinance-car-fallen.prefab.json',
  CatFeed: '@project/assets/prefabs/ordinance-cat-feed-fallen.prefab.json',
  Cats: '@project/assets/prefabs/ordinance-cats-fallen.prefab.json',
  Cones: '@project/assets/prefabs/ordinance-cones-fallen.prefab.json',
  Crates: '@project/assets/prefabs/ordinance-crates-fallen.prefab.json',
  DoNotStep: '@project/assets/prefabs/ordinance-do-not-step-fallen.prefab.json',
  FireHydrant: '@project/assets/prefabs/ordinance-fire-hydrant-fallen.prefab.json',
  HighVoltage: '@project/assets/prefabs/ordinance-high-voltage-fallen.prefab.json',
  JayWalking: '@project/assets/prefabs/ordinance-jay-walking-fallen.prefab.json',
  Kiosk: '@project/assets/prefabs/ordinance-kiosk-fallen.prefab.json',
  Logs: '@project/assets/prefabs/ordinance-logs-fallen.prefab.json',
  Maintenance: '@project/assets/prefabs/ordinance-maintenance-fallen.prefab.json',
  Metals: '@project/assets/prefabs/ordinance-metals-fallen.prefab.json',
  Plastics: '@project/assets/prefabs/ordinance-plastics-fallen.prefab.json',
  PoleCut: '@project/assets/prefabs/ordinance-pole-cut-fallen.prefab.json',
  ShopSign: '@project/assets/prefabs/ordinance-shop-sign-fallen.prefab.json',
  Signs: '@project/assets/prefabs/ordinance-signs-fallen.prefab.json',
  StreetLightsClimb: '@project/assets/prefabs/ordinance-street-lights-climb-fallen.prefab.json',
  StreetLightsDestroy: '@project/assets/prefabs/ordinance-street-lights-destroy-fallen.prefab.json',
  Tram: '@project/assets/prefabs/ordinance-tram-fallen.prefab.json',
  TreesClimbing: '@project/assets/prefabs/ordinance-trees-climbing-fallen.prefab.json',
  TreesCutting: '@project/assets/prefabs/ordinance-trees-cutting-fallen.prefab.json',
  Wires: '@project/assets/prefabs/ordinance-wires-fallen.prefab.json',
  WoodPlanks: '@project/assets/prefabs/ordinance-wood-planks-fallen.prefab.json',
};
const ORDINANCE_BOARD_FALLEN_PREFABS_BY_LOWER = new Map(
  Object.entries(ORDINANCE_BOARD_FALLEN_PREFABS).map(([key, path]) => [key.toLowerCase(), path]),
);
const UTILITY_POLE_FOOTPRINT_HALF = 1;
const POSE_FALL_DURATION = 2.2;
const KANJI_SIGN_FALL_POSE_POSITION = new THREE.Vector3(9.5, 8, -11.3);
const KANJI_SIGN_FALL_POSE_EULER = new THREE.Euler(1.735, -0.05943, 2.79742, 'XYZ');
const KANJI_SIGN_LAND_PHYSICS: ENGINE.NodePhysicsOptions = {
  enabled: true,
  motionType: ENGINE.PhysicsMotionType.Static,
};
const STREET_LAMP_SCRAP_PREFAB = '@project/assets/prefabs/street-lamp-metal-scraps.prefab.json';
const UTILITY_POLE_FALLEN_PREFAB = '@project/assets/prefabs/utility-pole-fallen.prefab.json';
const UTILITY_POLE_20_PREFAB = '@project/assets/prefabs/utility-pole-20.prefab.json';
const UTILITY_POLE_20_FALLEN_PREFAB = '@project/assets/prefabs/utility-pole-20-fallen.prefab.json';
const UTILITY_POLE_18_FALLEN_PREFAB = '@project/assets/prefabs/utility-pole-18-fallen.prefab.json';
const FALLEN_UTILITY_POLE_PREFABS = new Set([
  UTILITY_POLE_FALLEN_PREFAB,
  UTILITY_POLE_20_FALLEN_PREFAB,
  UTILITY_POLE_18_FALLEN_PREFAB,
]);
/** Scene Pole Cut boards mounted on utility poles (fall with dismantled prefab). */
const POLE_CUT_BOARD_NAME = /^(?:DontCutThisPole|Dont Cut this pole|Pole Cut)(?:\s+\d+)?$/i;
const POLE_CUT_DROP_NAME = /^Pole Cut Drop$/i;
const HIGH_VOLTAGE_BOARD_NAME = /^High Voltage(?:\s+\d+)?$/i;
const HIGH_VOLTAGE_DROP_NAME = /^High Voltage Drop(?:\s+\d+)?$/i;
const STREET_LIGHTS_BOARD_NAME = /^Street Lights (?:Climb|Destroy)(?:\s+\d+)?$/i;
const TREES_CUTTING_BOARD_NAME = /^(?:NoCuttingOfTrees|No cutting of trees|Trees Cutting)(?:\s+\d+)?$/i;
const GUARDRAIL_SCRAP_PREFAB = '@project/assets/prefabs/guardrail-d-dismantled-parts.prefab.json';
const GUARDRAIL_SECTION_DROP_PREFAB = '@project/assets/prefabs/guardrail-section-dismantled-parts.prefab.json';
const PARK_BENCH_SCRAP_PREFAB = '@project/assets/prefabs/park-bench-dismantled-parts.prefab.json';
const CHERRY_TREE_DROP_PREFAB = '@project/assets/prefabs/cherry-blossom-tree-drops.prefab.json';
const CHERRY_PEACH_DROP_PREFAB = '@project/assets/prefabs/cherry-blossom-peach-drop.prefab.json';
const TRAIL_MAP_KIOSK_DROP_PREFAB = '@project/assets/prefabs/trail-map-kiosk-dismantled-parts.prefab.json';
const STONE_LANTERN_DROP_PREFAB = '@project/assets/prefabs/stone-lantern-dismantled-rocks.prefab.json';
const TRAFFIC_CONE_C_DROP_PREFAB = '@project/assets/prefabs/traffic-cone-c-dismantled.prefab.json';
const CARGO_CRATE_DROP_PREFAB = '@project/assets/prefabs/cargo-crate-dismantled-planks.prefab.json';
const BUSH_8_BB_DROP_PREFAB = '@project/assets/prefabs/bush-8-bb-hide.prefab.json';
const CHERRY_TREE_MAX_HEALTH = 5;
const HIT_FLASH_DURATION = 0.18;
const PROJECTILE_HIT_COOLDOWN = 0.8;
const PROJECTILE_MIN_SPEED = 2;
const PROJECTILE_HEALTH_BAR_TIME = 2.75;

interface HitFlashRecord {
  mesh: THREE.Mesh;
  originalMaterial: THREE.Material | THREE.Material[];
  flashMaterial: THREE.Material | THREE.Material[];
}

interface PoseFallAnimation {
  node: ENGINE.ModelMeshNode;
  elapsed: number;
  duration: number;
  startPosition: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
  startScale: THREE.Vector3;
  endPosition: THREE.Vector3;
  endQuaternion: THREE.Quaternion;
  endScale: THREE.Vector3;
  easeRotation: boolean;
  localSpace: boolean;
  landPhysics: ENGINE.NodePhysicsOptions;
}

interface BushAppearAnimation {
  node: ENGINE.SceneNode;
  elapsed: number;
  duration: number;
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
}

/** Axe-gated proximity outline and dismantling for authored breakable environment props. */
export class StreetLampDismantlingSystem {
  constructor(private readonly hoverSilhouette: HoverSilhouette) {}

  private readonly playerPosition = new THREE.Vector3();
  private readonly targetBounds = new THREE.Box3();
  private readonly targetCenter = new THREE.Vector3();
  private readonly targetRotation = new THREE.Quaternion();
  private readonly targetSize = new THREE.Vector3();
  private readonly dropPosition = new THREE.Vector3();
  private readonly shakeRotation = new THREE.Quaternion();
  private readonly shakeEuler = new THREE.Euler();
  private readonly hitShakeBaseQuaternion = new THREE.Quaternion();
  private readonly hitShakeOffsetQuaternion = new THREE.Quaternion();
  private readonly hitShakeEuler = new THREE.Euler();
  private readonly healthAnchor = new THREE.Vector3();
  private readonly healthScreenPosition = new THREE.Vector3();
  private readonly aimRaycaster = new THREE.Raycaster();
  private readonly dismantledTargets = new Set<ENGINE.SceneNode>();
  private readonly dismantledPhysics = new Map<ENGINE.SceneNode, ENGINE.NodePhysicsOptions>();
  private readonly spawnedScrapRoots: ENGINE.SceneNode[] = [];
  /** Fallen utility poles stay in scrap tracking for day-reset, but are not pickups. */
  private readonly nonPickupableScrapRoots = new Set<ENGINE.SceneNode>();
  /**
   * Scrap roots retired from the world but not destroyed yet — destroying heavy
   * scrap in the same frame as a cinematic/reset can lose the WebGPU device.
   */
  private readonly pendingDestroyRoots: ENGINE.SceneNode[] = [];
  private pendingDestroyFrames = 0;
  private readonly meshSwapRecords: Array<{ node: ENGINE.ModelMeshNode; modelUrl: string }> = [];
  private readonly poseFallHomePoses = new Map<ENGINE.ModelMeshNode, {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    scale: THREE.Vector3;
    physics: ENGINE.NodePhysicsOptions;
  }>();
  private readonly cherryTreeHealth = new Map<ENGINE.ModelMeshNode, number>();
  /** Fired when a Traffic Cone C reaches 0 health (5th axe hit). */
  private trafficConeFifthHitHandler: (() => void) | null = null;
  private utilityPoleDismantledHandler: (() => void) | null = null;
  private kanjiSignDismantledHandler: (() => void) | null = null;
  private fireHydrantActivatedHandler: (() => void) | null = null;
  private cherryTreeDismantledHandler: (() => void) | null = null;
  private trailMapKioskDismantledHandler: (() => void) | null = null;
  private ordinanceBoardDismantledHandler: (() => void) | null = null;
  private streetLampDismantledHandler: (() => void) | null = null;
  private readonly hitFlashRecords: HitFlashRecord[] = [];
  private readonly bushAppearAnimations: BushAppearAnimation[] = [];
  private readonly poseFallAnimations: PoseFallAnimation[] = [];
  private readonly hydrantWaterStreams: HydrantWaterStream[] = [];
  private readonly hydrantCollisionNodes: ENGINE.PrimitiveNode[] = [];
  private readonly projectileHitTime = new WeakMap<ENGINE.SceneNode, number>();
  private readonly projectileHitReady = new WeakMap<ENGINE.SceneNode, boolean>();
  private readonly projectilePosition = new THREE.Vector3();
  private readonly kanjiSignFallEndPosition = KANJI_SIGN_FALL_POSE_POSITION.clone();
  private readonly kanjiSignFallEndQuaternion = new THREE.Quaternion().setFromEuler(
    KANJI_SIGN_FALL_POSE_EULER,
  );
  private readonly poseFallWorldPosition = new THREE.Vector3();
  private readonly poseFallWorldQuaternion = new THREE.Quaternion();
  private readonly poseFallWorldScale = new THREE.Vector3();
  private readonly poseFallParentQuaternion = new THREE.Quaternion();
  private kanjiSignLandPhysics: ENGINE.NodePhysicsOptions = { ...KANJI_SIGN_LAND_PHYSICS };

  private targetObject: ENGINE.ModelMeshNode | null = null;
  private lastCamera: THREE.Camera | null = null;
  private healthDisplayTarget: ENGINE.ModelMeshNode | null = null;
  private healthDisplayTime = 0;
  private simulationTime = 0;
  private readonly onHydrantCollide = (
    hydrantNode: ENGINE.PrimitiveNode,
    other: ENGINE.PrimitiveNode,
    event: { relativeVelocity: number | null },
  ): void => {
    this.handleHydrantCollision(hydrantNode, other, event);
  };
  private flashedTarget: ENGINE.ModelMeshNode | null = null;
  private hitShakeTarget: ENGINE.ModelMeshNode | null = null;
  private pendingDismantle: ENGINE.ModelMeshNode | null = null;
  private hitFlashRemaining = 0;
  private hitFlashElapsed = 0;
  private treeHealthBar: ENGINE.ProgressBar | null = null;
  private treeHealthBarReady = false;
  private destroyed = false;
  private dismantleCandidateCache: ENGINE.ModelMeshNode[] = [];
  private dismantleCandidateCacheDirty = true;
  /** Aim outline recheck interval — avoids per-frame mesh scans while hovering. */
  private aimOutlineElapsed = 0;
  private static readonly AIM_OUTLINE_INTERVAL = 0.1;

  public initialize(world: ENGINE.World): void {
    this.destroyed = false;
    this.dismantleCandidateCacheDirty = true;
    // Keep ObjectOutline off — hover uses a cheap AABB wireframe instead.
    world.postProcessManager.configureEffect(ENGINE.PostProcessPass.ObjectOutline, {
      enabled: false,
      edgeStrength: 2,
      edgeThickness: 1.5,
      visibleEdgeColor: OUTLINE_GREEN,
      hiddenEdgeColor: OUTLINE_GREEN,
      showHiddenEdge: false,
      useRootGrouping: true,
      edgeBlur: 0,
    });
    this.hoverSilhouette.setTarget(null, null);

    const healthBar = new ENGINE.ProgressBar(world.uiManager, {
      currentValue: CHERRY_TREE_MAX_HEALTH,
      maxValue: CHERRY_TREE_MAX_HEALTH,
      width: 80,
      height: 16,
      theme: 'custom',
      size: 'large',
      fillColor: '#ef4444',
      backgroundColor: 'rgba(20, 24, 30, 0.72)',
      label: '',
      textDisplay: 'none',
      animate: true,
      position: 'none',
      visible: false,
    });
    this.treeHealthBar = healthBar;
    void healthBar.initialize().then(() => {
      if (this.destroyed) {
        healthBar.destroy();
        return;
      }
      this.treeHealthBarReady = true;
      healthBar.setPosition({ display: 'none' }, '[data-progress-bar-header]');
      healthBar.hide();
    });

    this.enableBushAxeHits(world);
    this.parentPoleCutBoardsOntoUtilityPoles(world);
    this.bindHydrantProjectileHits(world);
    this.cachePoseFallTargets(world);
    this.hidePoseFallTargets(world);
  }

  public update(
    player: ENGINE.SceneNode,
    carriedObject: ENGINE.PrimitiveNode | null,
    camera: THREE.Camera,
    aimNdc: THREE.Vector2,
    deltaTime: number,
  ): void {
    this.lastCamera = camera;
    this.simulationTime += deltaTime;
    this.updateHitFlash(deltaTime);
    this.updateBushAppearAnimations(deltaTime);
    this.updatePoseFallAnimations(deltaTime);
    this.updateHydrantWater(deltaTime, camera);
    this.flushPendingScrapDestroys();
    const world = player.getWorld();
    if (world) {
      this.updateHydrantProjectileHits(world);
    }
    this.healthDisplayTime = Math.max(0, this.healthDisplayTime - deltaTime);
    if (this.healthDisplayTime <= 0) {
      this.healthDisplayTarget = null;
    }
    // Axe outline sequence:
    // 1) holding axe → 2) cursor hit → 3) destructible → 4) in range → 5) green outline
    if (!world || !this.isAxe(carriedObject)) {
      this.aimOutlineElapsed = 0;
      this.setTarget(world, null);
      this.updateTreeHealthBar(world, camera, this.healthDisplayTarget);
      return;
    }

    this.aimOutlineElapsed += deltaTime;
    if (this.aimOutlineElapsed >= StreetLampDismantlingSystem.AIM_OUTLINE_INTERVAL) {
      this.aimOutlineElapsed = 0;
      const target = this.findPointedDismantleTarget(
        player,
        carriedObject,
        camera,
        aimNdc,
        // Mesh fallback so dense foliage (bushes) still outline when physics misses.
        { meshFallback: true },
      );
      this.setTarget(world, target);
    }
    this.updateTreeHealthBar(world, camera, this.healthDisplayTarget ?? this.targetObject);
  }

  /**
   * Lighten scrap GPU cost before cinematics without changing motion/physics.
   * Hides scrap from the renderer (physics bodies stay as-is).
   */
  public prepareScrapForCinematic(): void {
    for (const scrap of this.spawnedScrapRoots) {
      this.disableScrapShadows(scrap);
      scrap.visible = false;
      scrap.traverse((child) => {
        child.visible = false;
      });
      this.setScrapMeshesRenderable(scrap, false);
    }
  }

  /** Detach scrap from the world and queue deferred GPU-safe destroy. */
  public retireAllScrap(): void {
    for (const scrap of this.spawnedScrapRoots.splice(0)) {
      this.retireScrapRoot(scrap);
    }
  }

  /** Queue an already-detached (or still-parented) root for deferred GPU-safe destroy. */
  public retireDetachedRoot(root: ENGINE.SceneNode): void {
    const tracked = this.spawnedScrapRoots.indexOf(root);
    if (tracked >= 0) {
      this.spawnedScrapRoots.splice(tracked, 1);
    }
    this.retireScrapRoot(root);
  }

  public hasPendingScrapDestroys(): boolean {
    return this.pendingDestroyRoots.length > 0;
  }

  /** Force-progress deferred scrap destroys (call while screen is black). */
  public flushPendingScrapDestroysNow(): void {
    this.flushPendingScrapDestroys();
  }

  /**
   * Restore dismantled originals / pose falls / health after scrap has been
   * retired (and preferably after pending destroys have flushed).
   */
  public finishDayReset(world: ENGINE.World | null): void {
    if (!world) {
      return;
    }

    this.dismantleCandidateCacheDirty = true;
    this.setTarget(world, null);
    this.pendingDismantle = null;
    this.restoreHitFlash();
    this.bushAppearAnimations.length = 0;
    this.poseFallAnimations.length = 0;

    for (const stream of this.hydrantWaterStreams) {
      stream.destroy();
    }
    this.hydrantWaterStreams.length = 0;

    for (const [node, home] of this.poseFallHomePoses) {
      if (!node.parent) {
        continue;
      }
      this.applyPoseFallWorldPose(node, home.position, home.quaternion, home.scale);
      node.overridePhysicsOptions({ ...home.physics });
      node.setPhysicsTransformUpdateFlags({
        sendPosition: false,
        sendRotation: false,
        receivePosition: false,
        receiveRotation: false,
      });
      node.visible = true;
    }
    this.poseFallHomePoses.clear();

    // Mesh reloads after scrap GPU teardown (staged day transition waits first).
    const meshSwaps = this.meshSwapRecords.splice(0);
    if (meshSwaps.length > 0) {
      window.setTimeout(() => {
        for (const record of meshSwaps) {
          if (!record.node.parent || !record.modelUrl) {
            continue;
          }
          void record.node.loadModel(ENGINE.AssetPath.fromString(record.modelUrl)).then(() => {
            void record.node.waitForLoad();
          });
        }
      }, 220);
    }

    for (const node of [...this.dismantledTargets]) {
      this.restoreDismantledNode(node);
    }
    this.dismantledTargets.clear();
    this.dismantledPhysics.clear();
    this.clearAllTargetHealth();

    this.hidePoseFallTargets(world);
    this.bindHydrantProjectileHits(world);
    this.parentPoleCutBoardsOntoUtilityPoles(world);
  }

  /**
   * Immediate full reset (editor clear / teardown). Prefer staged retire → finish
   * during play day transitions.
   */
  public resetDay(world: ENGINE.World | null): void {
    if (!world) {
      return;
    }
    this.prepareScrapForCinematic();
    this.retireAllScrap();
    this.pendingDestroyFrames = 99;
    this.flushPendingScrapDestroys();
    this.finishDayReset(world);
  }

  /** Dismantles the pointed in-range target on click; otherwise leaves LMB for carry/throw. */
  public handlePrimaryAction(
    player: ENGINE.SceneNode,
    carriedObject: ENGINE.PrimitiveNode | null,
    camera: THREE.Camera,
    aimNdc: THREE.Vector2,
    onSuccessfulHit?: () => void,
  ): boolean {
    if (!this.isAxe(carriedObject)) {
      return false;
    }

    const world = player.getWorld();
    if (!world) {
      return false;
    }

    // Prefer outlined aim; otherwise full resolve (physics + mesh) on click only.
    const target = (this.targetObject
      && this.isValidDismantleTarget(player, this.targetObject))
      ? this.targetObject
      : this.findPointedDismantleTarget(player, carriedObject, camera, aimNdc, {
        meshFallback: true,
      });
    if (!target) {
      return false;
    }

    if (this.pendingDismantle === target) {
      return true;
    }
    const health = this.applyTargetHit(target);
    onSuccessfulHit?.();
    if (CHERRY_BLOSSOM_TREE_NAME.test(target.name ?? '')) {
      this.spawnPeachForHit(world, target, CHERRY_TREE_MAX_HEALTH - health);
    }
    return true;
  }

  public clear(world: ENGINE.World | null): void {
    this.destroyed = true;
    this.setTarget(world, null);
    this.hoverSilhouette.clear();
    this.pendingDismantle = null;
    this.restoreHitFlash();
    this.bushAppearAnimations.length = 0;
    this.poseFallAnimations.length = 0;
    for (const stream of this.hydrantWaterStreams) {
      stream.destroy();
    }
    this.hydrantWaterStreams.length = 0;
    this.unbindHydrantProjectileHits();
    this.healthDisplayTarget = null;
    this.healthDisplayTime = 0;
    this.lastCamera = null;
    this.treeHealthBar?.destroy();
    this.treeHealthBar = null;
    this.treeHealthBarReady = false;
    for (const scrap of this.spawnedScrapRoots.splice(0)) {
      this.retireScrapRoot(scrap);
    }
    this.pendingDestroyFrames = 99;
    this.flushPendingScrapDestroys();
    this.meshSwapRecords.length = 0;
    this.dismantledTargets.clear();
    this.dismantledPhysics.clear();
    this.nonPickupableScrapRoots.clear();
    this.poseFallHomePoses.clear();
    this.clearAllTargetHealth();
  }

  /** Fresh day / soft-loop: every axe target starts at full health again. */
  private clearAllTargetHealth(): void {
    this.cherryTreeHealth.clear();
    this.healthDisplayTarget = null;
    this.healthDisplayTime = 0;
    if (this.treeHealthBarReady) {
      this.treeHealthBar?.setValue(CHERRY_TREE_MAX_HEALTH, false);
      this.treeHealthBar?.hide();
    }
  }

  private retireScrapRoot(scrap: ENGINE.SceneNode): void {
    this.nonPickupableScrapRoots.delete(scrap);
    this.disableScrapShadows(scrap);
    // Disable physics only while retiring for destroy — do not convert motion types
    // during normal play (poles must keep falling / settling dynamically).
    const stack: ENGINE.SceneNode[] = [scrap];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      node.visible = false;
      if (node instanceof ENGINE.PrimitiveNode) {
        node.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity, [0, 0, 0]);
        node.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.AngularVelocity, [0, 0, 0]);
        node.overridePhysicsOptions({ enabled: false });
      }
      for (const child of node.children) {
        if (child instanceof ENGINE.SceneNode) {
          stack.push(child);
        }
      }
    }
    scrap.removeFromParent();
    this.pendingDestroyRoots.push(scrap);
    this.pendingDestroyFrames = 0;
  }

  private flushPendingScrapDestroys(): void {
    if (this.pendingDestroyRoots.length === 0) {
      return;
    }
    this.pendingDestroyFrames += 1;
    // Wait enough update ticks for WebGPU to drop mesh/shadow refs before destroy.
    if (this.pendingDestroyFrames < 16) {
      return;
    }
    for (const scrap of this.pendingDestroyRoots.splice(0)) {
      try {
        scrap.destroy();
      } catch (error) {
        console.warn('[StreetLampDismantlingSystem] Scrap destroy after retire failed.', error);
      }
    }
    this.pendingDestroyFrames = 0;
  }

  /** Shadows on large scrap meshes are expensive for WebGPU; physics stays unchanged. */
  private disableScrapShadows(root: ENGINE.SceneNode): void {
    root.traverse((child) => {
      if (child instanceof ENGINE.ModelMeshNode) {
        child.castShadow = false;
        child.receiveShadow = false;
      }
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
  }

  /**
   * Render-only hide/show for scrap GLBs. Does not call overridePhysicsOptions —
   * physics keeps simulating while the GPU stops drawing the meshes.
   */
  private setScrapMeshesRenderable(root: ENGINE.SceneNode, renderable: boolean): void {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.visible = renderable;
      }
    });
  }

  private markDismantled(node: ENGINE.SceneNode): void {
    if (!this.dismantledPhysics.has(node) && node instanceof ENGINE.PrimitiveNode) {
      this.dismantledPhysics.set(node, { ...node.getPhysicsOptions() });
    }
    this.dismantledTargets.add(node);
  }

  private hideDismantledOriginal(node: ENGINE.ModelMeshNode): void {
    this.markDismantled(node);
    node.visible = false;
    node.overridePhysicsOptions({ enabled: false });
  }

  /** Street-lamp ordinance boards are not spawned on scrap — hide + disable physics. */
  private hideStreetLampOrdinanceBoards(lamp: ENGINE.ModelMeshNode): void {
    this.hideMountedOrdinanceBoards(lamp, STREET_LIGHTS_BOARD_NAME);
  }

  /** Tree-mounted Trees Cutting boards stay on the tree — hide when the tree is cut. */
  private hideTreesCuttingBoards(tree: ENGINE.ModelMeshNode): void {
    this.hideMountedOrdinanceBoards(tree, TREES_CUTTING_BOARD_NAME);
  }

  private hideMountedOrdinanceBoards(host: ENGINE.ModelMeshNode, namePattern: RegExp): void {
    for (const child of host.children) {
      if (!(child instanceof ENGINE.ModelMeshNode)) {
        continue;
      }
      if (!namePattern.test(child.name ?? '')) {
        continue;
      }
      // Include mounted boards in the reset set so tree/lamp props return with
      // their host after the next-day transition.
      this.markDismantled(child);
      child.visible = false;
      child.overridePhysicsOptions({
        enabled: false,
        motionType: ENGINE.PhysicsMotionType.Static,
      });
      child.setPhysicsTransformUpdateFlags({
        sendPosition: false,
        sendRotation: false,
        receivePosition: false,
        receiveRotation: false,
      });
    }
  }

  private restoreDismantledNode(node: ENGINE.SceneNode): void {
    if (!node.parent) {
      return;
    }
    const physics = this.dismantledPhysics.get(node);
    node.visible = true;
    if (node instanceof ENGINE.PrimitiveNode) {
      if (physics) {
        node.overridePhysicsOptions({ ...physics, enabled: physics.enabled !== false });
      } else {
        node.overridePhysicsOptions({ enabled: true });
      }
      node.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity, [0, 0, 0]);
      node.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.AngularVelocity, [0, 0, 0]);
    }
  }

  public hasTargetLamp(): boolean {
    return this.targetObject !== null;
  }

  /**
   * Resolve a spawned dismantle scrap piece (metal scraps, planks, rocks, …)
   * under the cursor hit for pickup / hover outline.
   */
  public findPickupableScrapPiece(from: THREE.Object3D | null): ENGINE.PrimitiveNode | null {
    let current: THREE.Object3D | null = from;
    while (current) {
      if (current instanceof ENGINE.PrimitiveNode) {
        for (const root of this.spawnedScrapRoots) {
          if (!root.parent) {
            continue;
          }
          if (this.isNonPickupableFallenUtilityPole(root)) {
            continue;
          }
          if (current === root || this.isNodeUnderRoot(current, root)) {
            return current;
          }
        }
      }
      current = current.parent;
    }
    return null;
  }

  /** Fallen utility poles are platforms, not carryables. */
  private isNonPickupableFallenUtilityPole(root: ENGINE.SceneNode): boolean {
    if (this.nonPickupableScrapRoots.has(root)) {
      return true;
    }
    if (/Utility Pole Fallen/i.test(root.name ?? '')) {
      return true;
    }
    for (const model of root.getNodes(ENGINE.ModelMeshNode)) {
      const url = model.modelUrl ?? '';
      if (/utilitypole\/utility-pole/i.test(url)) {
        return true;
      }
    }
    return false;
  }

  private isNodeUnderRoot(node: THREE.Object3D, root: ENGINE.SceneNode): boolean {
    let current: THREE.Object3D | null = node;
    while (current) {
      if (current === root) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  private enableBushAxeHits(world: ENGINE.World): void {
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!BUSH_8_BB_NAME.test(node.name ?? '')) {
        continue;
      }
      node.overridePhysicsOptions({
        enabled: true,
        collisionProfile: ENGINE.DefaultCollisionProfile.IgnoreOnlyPawns,
        motionType: ENGINE.PhysicsMotionType.Static,
      });
    }
  }

  /**
   * Ensure pole/lamp-mounted ordinance boards stay visual-only (no nested physics).
   * Scene parents them in edit mode; do not re-attach at runtime.
   */
  private parentPoleCutBoardsOntoUtilityPoles(world: ENGINE.World): void {
    for (const board of world.getNodes(ENGINE.ModelMeshNode)) {
      const name = board.name ?? '';
      if (
        !POLE_CUT_BOARD_NAME.test(name)
        && !HIGH_VOLTAGE_BOARD_NAME.test(name)
        && !STREET_LIGHTS_BOARD_NAME.test(name)
        && !TREES_CUTTING_BOARD_NAME.test(name)
      ) {
        continue;
      }

      board.overridePhysicsOptions({
        enabled: false,
        motionType: ENGINE.PhysicsMotionType.Static,
      });
      board.setPhysicsTransformUpdateFlags({
        sendPosition: false,
        sendRotation: false,
        receivePosition: false,
        receiveRotation: false,
      });

      const rot = board.rotation;
      if (![rot.x, rot.y, rot.z].every(Number.isFinite)) {
        board.rotation.set(0, 0, 0);
      }
      const scl = board.scale;
      if (![scl.x, scl.y, scl.z].every(Number.isFinite) || scl.x === 0 || scl.y === 0 || scl.z === 0) {
        const parentScale = board.parent instanceof ENGINE.ModelMeshNode
          ? board.parent.scale.x || 1.5
          : 1.5;
        const inv = 1 / parentScale;
        board.scale.set(inv, inv, inv);
      }
      const pos = board.position;
      if (![pos.x, pos.y, pos.z].every(Number.isFinite)) {
        board.position.set(0, 2, 0);
      }
    }
  }

  private bindHydrantProjectileHits(world: ENGINE.World): void {
    this.unbindHydrantProjectileHits();
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!FIRE_HYDRANT_NAME.test(node.name ?? '')) {
        continue;
      }
      node.onCollideWith.add(this.onHydrantCollide);
      this.hydrantCollisionNodes.push(node);
    }
  }

  private unbindHydrantProjectileHits(): void {
    for (const node of this.hydrantCollisionNodes) {
      node.onCollideWith.remove(this.onHydrantCollide);
    }
    this.hydrantCollisionNodes.length = 0;
  }

  private handleHydrantCollision(
    hydrantNode: ENGINE.PrimitiveNode,
    other: ENGINE.PrimitiveNode,
    event: { relativeVelocity: number | null },
  ): void {
    const hydrant = this.findHydrantNode(hydrantNode);
    const projectile = this.getProjectileHitKey(this.findHydrantProjectile(other));
    if (!hydrant || !projectile) {
      return;
    }
    const impactSpeed = event.relativeVelocity ?? 0;
    this.tryHydrantProjectileHit(hydrant, projectile, impactSpeed);
  }

  private updateHydrantProjectileHits(world: ENGINE.World): void {
    const flyingCrates: ReturnType<typeof CarryableCrateNode.getActiveInstances> = [];
    for (const crate of CarryableCrateNode.getActiveInstances(world)) {
      const parent = crate.parent;
      const projectile = this.getProjectileHitKey(
        parent instanceof ENGINE.PrimitiveNode
          ? parent
          : crate.getCrateRoot(),
      );
      if (!projectile || crate.isCarried() || !this.isHydrantProjectile(projectile)) {
        continue;
      }
      flyingCrates.push(crate);
    }
    // No thrown props in flight — skip hydrant mesh scans entirely.
    if (flyingCrates.length === 0) {
      return;
    }

    const hydrants: ENGINE.ModelMeshNode[] = [];
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (
        FIRE_HYDRANT_NAME.test(node.name ?? '')
        && !this.dismantledTargets.has(node)
        && node.visible
      ) {
        hydrants.push(node);
      }
    }
    if (hydrants.length === 0) {
      return;
    }

    for (const crate of flyingCrates) {
      const parent = crate.parent;
      const projectile = this.getProjectileHitKey(
        parent instanceof ENGINE.PrimitiveNode
          ? parent
          : crate.getCrateRoot(),
      );
      if (!projectile) {
        continue;
      }
      const speed = this.getProjectileSpeed(projectile);
      projectile.getWorldPosition(this.projectilePosition);
      let nearestHydrantDistance = Number.POSITIVE_INFINITY;
      for (const hydrant of hydrants) {
        this.targetBounds.setFromObject(hydrant);
        const distance = this.targetBounds.isEmpty()
          ? hydrant.getWorldPosition(this.targetCenter).distanceTo(this.projectilePosition)
          : this.targetBounds.distanceToPoint(this.projectilePosition);
        nearestHydrantDistance = Math.min(nearestHydrantDistance, distance);
        if (distance > 0.28) {
          continue;
        }
        this.tryHydrantProjectileHit(hydrant, projectile, speed);
      }
      if (speed < PROJECTILE_MIN_SPEED || nearestHydrantDistance > 2) {
        this.projectileHitReady.set(projectile, true);
      }
    }
  }

  private tryHydrantProjectileHit(
    hydrant: ENGINE.ModelMeshNode,
    projectile: ENGINE.PrimitiveNode,
    impactSpeed: number,
  ): void {
    if (this.dismantledTargets.has(hydrant) || this.pendingDismantle === hydrant) {
      return;
    }
    if (impactSpeed < PROJECTILE_MIN_SPEED) {
      return;
    }
    const hitKey = this.getProjectileHitKey(projectile) ?? projectile;
    if (this.projectileHitReady.get(hitKey) === false) {
      return;
    }
    const lastHit = this.projectileHitTime.get(hitKey) ?? Number.NEGATIVE_INFINITY;
    if (this.simulationTime - lastHit < PROJECTILE_HIT_COOLDOWN) {
      return;
    }
    if (!hydrant.getWorld()) {
      return;
    }
    this.projectileHitTime.set(hitKey, this.simulationTime);
    this.projectileHitReady.set(hitKey, false);
    this.applyTargetHit(hydrant);
    this.healthDisplayTarget = hydrant;
    this.healthDisplayTime = PROJECTILE_HEALTH_BAR_TIME;
  }

  private getProjectileHitKey(
    node: ENGINE.PrimitiveNode | null,
  ): ENGINE.PrimitiveNode | null {
    if (!node) {
      return null;
    }
    let key = node;
    let current: ENGINE.SceneNode | THREE.Object3D | null = node;
    while (current) {
      if (current instanceof ENGINE.PrimitiveNode && this.isHydrantProjectile(current)) {
        key = current;
      }
      current = current.parent;
    }
    return key;
  }

  public setTrafficConeFifthHitHandler(handler: (() => void) | null): void {
    this.trafficConeFifthHitHandler = handler;
  }

  /** Fires after a utility pole finishes dismantling (fallen prefab spawn started). */
  public setUtilityPoleDismantledHandler(handler: (() => void) | null): void {
    this.utilityPoleDismantledHandler = handler;
  }

  /** Fires when the Kanji Sign begins its pose-fall dismantle. */
  public setKanjiSignDismantledHandler(handler: (() => void) | null): void {
    this.kanjiSignDismantledHandler = handler;
  }

  /** Fires when a fire hydrant starts spraying water (axe or rock). */
  public setFireHydrantActivatedHandler(handler: (() => void) | null): void {
    this.fireHydrantActivatedHandler = handler;
  }

  /** Fires when a cherry blossom tree finishes dismantling (log drops spawn). */
  public setCherryTreeDismantledHandler(handler: (() => void) | null): void {
    this.cherryTreeDismantledHandler = handler;
  }

  /** Fires when a trail map kiosk finishes dismantling (wood parts spawn). */
  public setTrailMapKioskDismantledHandler(handler: (() => void) | null): void {
    this.trailMapKioskDismantledHandler = handler;
  }

  /** Fires when an ordinance board is replaced with its fallen prefab. */
  public setOrdinanceBoardDismantledHandler(handler: (() => void) | null): void {
    this.ordinanceBoardDismantledHandler = handler;
  }

  /** Fires after a street lamp finishes dismantling (scrap prefab spawn started). */
  public setStreetLampDismantledHandler(handler: (() => void) | null): void {
    this.streetLampDismantledHandler = handler;
  }

  private isOrdinanceBoardTarget(node: ENGINE.ModelMeshNode): boolean {
    const name = node.name ?? '';
    if (ORDINANCE_BOARD_NON_TARGET_NAME.test(name)) {
      return false;
    }
    return this.getOrdinanceBoardKey(node) !== null;
  }

  /** Resolve both legacy board models and the generated v5 card models. */
  private getOrdinanceBoardKey(node: ENGINE.ModelMeshNode): string | null {
    const modelUrl = node.modelUrl ?? '';
    const v5Match = modelUrl.match(ORDINANCE_CARD_V5_MODEL_PATH);
    if (v5Match?.[1]) {
      return v5Match[1];
    }
    const match = modelUrl.match(ORDINANCE_BOARD_MODEL_PATH);
    if (match?.[1]) {
      return match[1];
    }
    // The name fallback also covers cards whose asset URL is supplied at runtime.
    const nameMatch = (node.name ?? '').match(/^([A-Za-z]+)\s+Card\s+Upright\s+v5$/i);
    return nameMatch?.[1] ?? null;
  }

  private resolveOrdinanceBoardFallenPrefab(target: ENGINE.ModelMeshNode): string | null {
    const key = this.getOrdinanceBoardKey(target);
    return key ? ORDINANCE_BOARD_FALLEN_PREFABS_BY_LOWER.get(key.toLowerCase()) ?? null : null;
  }

  private applyTargetHit(target: ENGINE.ModelMeshNode): number {
    const health = Math.max(
      0,
      (this.cherryTreeHealth.get(target) ?? CHERRY_TREE_MAX_HEALTH) - 1,
    );
    this.cherryTreeHealth.set(target, health);
    const hitAt = new THREE.Vector3();
    target.getWorldPosition(hitAt);
    playSoundAt(target.getWorld(), GameSound.AxeChop, hitAt, 0.85);
    // Mark a final hit before applying feedback so the standing lamp is never
    // moved while its dismantled replacement is being created.
    if (health <= 0) {
      this.pendingDismantle = target;
    }
    this.applyRedHitFlash(target);
    if (this.treeHealthBarReady) {
      this.treeHealthBar?.setValue(health, true);
    }
    if (health <= 0) {
      if (TRAFFIC_CONE_C_NAME.test(target.name ?? '')) {
        this.trafficConeFifthHitHandler?.();
      }
    }
    return health;
  }

  private getProjectileSpeed(projectile: ENGINE.PrimitiveNode): number {
    // Never call during onCollide / physics step — Rapier throws unsafe-aliasing.
    try {
      const velocity = projectile.getPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity);
      if (!velocity) {
        return 0;
      }
      return Math.hypot(velocity[0], velocity[1], velocity[2]);
    } catch {
      return 0;
    }
  }

  private isHydrantProjectile(node: ENGINE.PrimitiveNode): boolean {
    const name = node.name ?? '';
    if (SMALL_ROCK_NAME.test(name) || PEACH_PROJECTILE_NAME.test(name)) {
      return true;
    }
    if (!(node instanceof ENGINE.ModelMeshNode)) {
      return false;
    }
    const modelUrl = node.modelUrl ?? '';
    return SMALL_ROCK_MODEL.test(modelUrl) || PEACH_PROJECTILE_MODEL.test(modelUrl);
  }

  private findHydrantNode(node: ENGINE.SceneNode | null): ENGINE.ModelMeshNode | null {
    let current: ENGINE.SceneNode | THREE.Object3D | null = node;
    while (current) {
      if (current instanceof ENGINE.ModelMeshNode && FIRE_HYDRANT_NAME.test(current.name ?? '')) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  private findHydrantProjectile(node: ENGINE.SceneNode | null): ENGINE.PrimitiveNode | null {
    let current: ENGINE.SceneNode | THREE.Object3D | null = node;
    while (current) {
      if (current instanceof ENGINE.PrimitiveNode && this.isHydrantProjectile(current)) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  private isAxe(carriedObject: ENGINE.PrimitiveNode | null): boolean {
    return carriedObject?.name === 'Axe'
      || (carriedObject instanceof ENGINE.ModelMeshNode
        && AXE_MODEL_NAME.test(carriedObject.modelUrl ?? ''));
  }

  private findPointedDismantleTarget(
    player: ENGINE.SceneNode,
    carriedObject: ENGINE.PrimitiveNode | null,
    camera: THREE.Camera,
    aimNdc: THREE.Vector2,
    options: { meshFallback: boolean } = { meshFallback: true },
  ): ENGINE.ModelMeshNode | null {
    const world = player.getWorld();
    if (!world) {
      return null;
    }

    // Step 2: what is under the cursor (camera ray — iso length ≠ player range).
    camera.updateMatrixWorld(true);
    this.aimRaycaster.setFromCamera(aimNdc, camera);
    this.aimRaycaster.far = AIM_RAY_MAX;

    const physicsEngine = player.getPhysicsEngine();
    const physicsHit = physicsEngine?.performHitTest({
      origin: this.aimRaycaster.ray.origin,
      direction: this.aimRaycaster.ray.direction,
      maxDistance: AIM_RAY_MAX,
      stopOnFirstHit: true,
      ignoredRootNodes: [player, carriedObject].filter(
        (node): node is ENGINE.SceneNode => node !== null,
      ),
    })[0];

    // Step 3: is that hit a destructible prop?
    const physicsTarget = this.findDismantleTargetAncestor(
      physicsHit?.hitNode ?? physicsHit?.hitRoot ?? null,
    );
    // Step 4: close enough for this prop's range?
    if (physicsTarget && this.isCloseEnoughDismantleTarget(player, physicsTarget)) {
      return physicsTarget;
    }

    // Mesh scan of every breakable is expensive — click only (still steps 3–4).
    if (!options.meshFallback) {
      return null;
    }
    return this.findMeshRaycastDismantleTarget(world, player);
  }

  private findMeshRaycastDismantleTarget(
    world: ENGINE.World,
    player: ENGINE.SceneNode,
  ): ENGINE.ModelMeshNode | null {
    const candidates = this.getDismantleCandidates(world, player);
    if (candidates.length === 0) {
      return null;
    }

    const hits = this.aimRaycaster.intersectObjects(candidates, true);
    for (const hit of hits) {
      const target = this.findDismantleTargetAncestor(hit.object);
      if (target && this.isCloseEnoughDismantleTarget(player, target)) {
        return target;
      }
    }
    return null;
  }

  private getDismantleCandidates(
    world: ENGINE.World,
    player: ENGINE.SceneNode,
  ): ENGINE.ModelMeshNode[] {
    if (this.dismantleCandidateCacheDirty) {
      this.dismantleCandidateCache = [];
      for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
        if (this.isDismantleTargetNode(node)) {
          this.dismantleCandidateCache.push(node);
        }
      }
      this.dismantleCandidateCacheDirty = false;
    }
    return this.dismantleCandidateCache.filter(
      (node) => this.isCloseEnoughDismantleTarget(player, node),
    );
  }

  public invalidateDismantleCandidates(): void {
    this.dismantleCandidateCacheDirty = true;
  }

  /** Kept for click validation / callers that expect the old name. */
  private isValidDismantleTarget(
    player: ENGINE.SceneNode,
    target: ENGINE.ModelMeshNode,
  ): boolean {
    return this.isCloseEnoughDismantleTarget(player, target);
  }

  /**
   * Cheap proximity check (no mesh AABB rebuild). Tall props use horizontal
   * distance so tree/lamp height does not push the player "out of range".
   */
  private isCloseEnoughDismantleTarget(
    player: ENGINE.SceneNode,
    target: ENGINE.ModelMeshNode,
  ): boolean {
    if (this.dismantledTargets.has(target) || !target.visible) {
      return false;
    }
    if (this.isPoseFallDummy(target.name ?? '')) {
      return false;
    }

    const range = this.getDismantleInteractionRange(target);
    player.getWorldPosition(this.playerPosition);
    const name = target.name ?? '';

    if (this.isUtilityPoleTarget(name)) {
      target.updateMatrixWorld(true);
      target.getWorldPosition(this.targetCenter);
      const minX = this.targetCenter.x - UTILITY_POLE_FOOTPRINT_HALF;
      const maxX = this.targetCenter.x + UTILITY_POLE_FOOTPRINT_HALF;
      const minZ = this.targetCenter.z - UTILITY_POLE_FOOTPRINT_HALF;
      const maxZ = this.targetCenter.z + UTILITY_POLE_FOOTPRINT_HALF;
      const closestX = THREE.MathUtils.clamp(this.playerPosition.x, minX, maxX);
      const closestZ = THREE.MathUtils.clamp(this.playerPosition.z, minZ, maxZ);
      return Math.hypot(
        this.playerPosition.x - closestX,
        this.playerPosition.z - closestZ,
      ) <= range;
    }

    target.getWorldPosition(this.targetCenter);
    const pad = CHERRY_BLOSSOM_TREE_NAME.test(name) ? 3.5
      : BUSH_8_BB_NAME.test(name) ? 2
        : TRAIL_MAP_KIOSK_NAME.test(name) ? 2
          : 1;
    const horizontal = Math.hypot(
      this.playerPosition.x - this.targetCenter.x,
      this.playerPosition.z - this.targetCenter.z,
    );
    return horizontal <= range + pad;
  }

  private getPlayerToTargetDistance(
    player: ENGINE.SceneNode,
    target: ENGINE.ModelMeshNode,
  ): number {
    player.getWorldPosition(this.playerPosition);
    const name = target.name ?? '';

    if (this.isUtilityPoleTarget(name)) {
      target.updateMatrixWorld(true);
      target.getWorldPosition(this.targetCenter);
      const minX = this.targetCenter.x - UTILITY_POLE_FOOTPRINT_HALF;
      const maxX = this.targetCenter.x + UTILITY_POLE_FOOTPRINT_HALF;
      const minZ = this.targetCenter.z - UTILITY_POLE_FOOTPRINT_HALF;
      const maxZ = this.targetCenter.z + UTILITY_POLE_FOOTPRINT_HALF;
      const closestX = THREE.MathUtils.clamp(this.playerPosition.x, minX, maxX);
      const closestZ = THREE.MathUtils.clamp(this.playerPosition.z, minZ, maxZ);
      return Math.hypot(
        this.playerPosition.x - closestX,
        this.playerPosition.z - closestZ,
      );
    }

    this.targetBounds.setFromObject(target);
    if (this.targetBounds.isEmpty()) {
      target.getWorldPosition(this.targetCenter);
      return this.targetCenter.distanceTo(this.playerPosition);
    }
    return this.targetBounds.distanceToPoint(this.playerPosition);
  }

  private isDismantleTargetNode(node: ENGINE.ModelMeshNode): boolean {
    const name = node.name ?? '';
    return STREET_LAMP_NAME.test(name)
      || GUARDRAIL_D_NAME.test(name)
      || GUARDRAIL_SECTION_NAME.test(name)
      || PARK_BENCH_NAME.test(name)
      || CHERRY_BLOSSOM_TREE_NAME.test(name)
      || TRAIL_MAP_KIOSK_NAME.test(name)
      || STONE_LANTERN_NAME.test(name)
      || TRAFFIC_CONE_C_NAME.test(name)
      || CARGO_CRATE_NAME.test(name)
      || BUSH_8_BB_NAME.test(name)
      || FIRE_HYDRANT_NAME.test(name)
      || KANJI_SIGN_NAME.test(name)
      || UTILITY_POLE_16_NAME.test(name)
      || UTILITY_POLE_17_NAME.test(name)
      || UTILITY_POLE_18_TARGET_NAME.test(name)
      || this.isUtilityPole15Or20Target(name)
      || this.isOrdinanceBoardTarget(node);
  }

  private getDismantleInteractionRange(target: ENGINE.ModelMeshNode): number {
    const name = target.name ?? '';
    if (BUSH_8_BB_NAME.test(name)) {
      return BUSH_INTERACTION_RANGE;
    }
    if (KANJI_SIGN_NAME.test(name)) {
      return KANJI_SIGN_INTERACTION_RANGE;
    }
    if (this.isOrdinanceBoardTarget(target)) {
      return ORDINANCE_BOARD_INTERACTION_RANGE;
    }
    if (
      UTILITY_POLE_16_NAME.test(name)
      || UTILITY_POLE_17_NAME.test(name)
      || UTILITY_POLE_18_TARGET_NAME.test(name)
      || this.isUtilityPole15Or20Target(name)
    ) {
      return UTILITY_POLE_INTERACTION_RANGE;
    }
    return INTERACTION_RANGE;
  }

  private findDismantleTargetAncestor(node: THREE.Object3D | null): ENGINE.ModelMeshNode | null {
    let current = node;
    while (current) {
      if (current instanceof ENGINE.ModelMeshNode && this.isDismantleTargetNode(current)) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  private updateTreeHealthBar(
    world: ENGINE.World | null,
    camera: THREE.Camera,
    displayTarget: ENGINE.ModelMeshNode | null = this.targetObject,
  ): void {
    const bar = this.treeHealthBar;
    const target = displayTarget;
    if (!world || !bar || !this.treeHealthBarReady || !target) {
      if (this.treeHealthBarReady) {
        bar?.hide();
      }
      return;
    }

    this.targetBounds.setFromObject(target);
    const targetName = target.name ?? '';
    const placeOnPole = this.isUtilityPoleTarget(targetName);
    const placeAboveModel = !placeOnPole && (
      GUARDRAIL_D_NAME.test(targetName)
      || GUARDRAIL_SECTION_NAME.test(targetName)
      || PARK_BENCH_NAME.test(targetName)
      || STONE_LANTERN_NAME.test(targetName)
      || TRAFFIC_CONE_C_NAME.test(targetName)
      || CARGO_CRATE_NAME.test(targetName)
      || BUSH_8_BB_NAME.test(targetName)
      || FIRE_HYDRANT_NAME.test(targetName)
      || KANJI_SIGN_NAME.test(targetName)
      || this.isOrdinanceBoardTarget(target)
    );
    if (this.targetBounds.isEmpty()) {
      target.getWorldPosition(this.healthAnchor);
      if (placeOnPole) {
        this.healthAnchor.y += 2.5;
      } else if (placeAboveModel) {
        this.healthAnchor.y += 0.5;
      }
    } else if (placeOnPole) {
      target.getWorldPosition(this.healthAnchor);
      this.targetBounds.getSize(this.targetSize);
      this.healthAnchor.y = this.targetBounds.min.y + this.targetSize.y * 0.5;
    } else {
      this.targetBounds.getCenter(this.healthAnchor);
      if (placeAboveModel) {
        this.healthAnchor.y = this.targetBounds.max.y + 0.12;
      }
    }

    camera.updateMatrixWorld(true);
    this.healthScreenPosition.copy(this.healthAnchor).project(camera);
    if (this.healthScreenPosition.z < -1 || this.healthScreenPosition.z > 1) {
      bar.hide();
      return;
    }

    const container = world.gameContainer;
    if (!container) {
      bar.hide();
      return;
    }
    const x = (this.healthScreenPosition.x * 0.5 + 0.5) * container.clientWidth;
    const y = (-this.healthScreenPosition.y * 0.5 + 0.5) * container.clientHeight;
    bar.setValue(this.cherryTreeHealth.get(target) ?? CHERRY_TREE_MAX_HEALTH, false);
    bar.setPosition({
      position: 'absolute',
      left: `${x}px`,
      top: `${y}px`,
      transform: placeAboveModel
        ? 'translate(-50%, calc(-100% - 4px))'
        : 'translate(-50%, -50%)',
      'z-index': '1002',
      'pointer-events': 'none',
    });
    bar.show();
  }

  private spawnPeachForHit(
    world: ENGINE.World,
    target: ENGINE.ModelMeshNode,
    hitNumber: number,
  ): void {
    this.targetBounds.setFromObject(target);
    if (this.targetBounds.isEmpty()) {
      target.getWorldPosition(this.dropPosition);
      this.dropPosition.y += 2;
    } else {
      this.targetBounds.getCenter(this.dropPosition);
      this.targetBounds.getSize(this.targetSize);
      const angle = (hitNumber - 1) * 2.399963;
      const radius = Math.max(0.35, Math.min(this.targetSize.x, this.targetSize.z) * 0.14);
      this.dropPosition.x += Math.cos(angle) * radius;
      this.dropPosition.y += this.targetSize.y * 0.2;
      this.dropPosition.z += Math.sin(angle) * radius;
    }
    target.getWorldQuaternion(this.targetRotation);
    void this.spawnScrapPrefab(
      world,
      CHERRY_PEACH_DROP_PREFAB,
      this.dropPosition.clone(),
      this.targetRotation.clone(),
    );
  }

  private applyRedHitFlash(target: ENGINE.ModelMeshNode): void {
    this.restoreHitFlash();
    this.flashedTarget = target;
    this.hitFlashRemaining = HIT_FLASH_DURATION;
    this.hitFlashElapsed = 0;
    // Give ordinary axe hits a short physical-looking response.  The final hit
    // stays still so it cannot fight the physics/replacement handoff.
    if (this.pendingDismantle !== target) {
      this.hitShakeTarget = target;
      this.hitShakeBaseQuaternion.copy(target.quaternion);
    }

    target.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }
      const originalMaterial = object.material;
      const flashMaterial = Array.isArray(originalMaterial)
        ? originalMaterial.map((material) => this.createRedFlashMaterial(material))
        : this.createRedFlashMaterial(originalMaterial);
      this.hitFlashRecords.push({ mesh: object, originalMaterial, flashMaterial });
      object.material = flashMaterial;
    });
  }

  private createRedFlashMaterial(material: THREE.Material): THREE.Material {
    const flash = material.clone() as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
    };
    flash.color?.setHex(0xff2020);
    flash.emissive?.setHex(0xff0000);
    if (flash.emissiveIntensity !== undefined) {
      flash.emissiveIntensity = Math.max(flash.emissiveIntensity, 1.25);
    }
    flash.needsUpdate = true;
    return flash;
  }

  private updateHitFlash(deltaTime: number): void {
    if (!this.flashedTarget) {
      return;
    }
    this.hitFlashRemaining -= deltaTime;
    this.hitFlashElapsed += deltaTime;
    if (this.hitShakeTarget) {
      const progress = Math.min(1, this.hitFlashElapsed / HIT_FLASH_DURATION);
      const envelope = (1 - progress) * (1 - progress);
      const angle = Math.sin(progress * Math.PI * 5) * 0.055 * envelope;
      this.hitShakeEuler.set(angle * 0.45, 0, -angle, 'XYZ');
      this.hitShakeOffsetQuaternion.setFromEuler(this.hitShakeEuler);
      this.hitShakeTarget.quaternion
        .copy(this.hitShakeBaseQuaternion)
        .multiply(this.hitShakeOffsetQuaternion);
      this.hitShakeTarget.updateMatrixWorld(true);
    }
    if (this.hitFlashRemaining <= 0) {
      const pendingDismantle = this.pendingDismantle;
      this.pendingDismantle = null;
      this.restoreHitFlash();
      const world = pendingDismantle?.getWorld();
      if (pendingDismantle && world) {
        this.dismantleTarget(world, pendingDismantle);
      }
    }
  }

  private restoreHitFlash(): void {
    if (this.hitShakeTarget) {
      this.hitShakeTarget.quaternion.copy(this.hitShakeBaseQuaternion);
      this.hitShakeTarget.updateMatrixWorld(true);
      this.hitShakeTarget = null;
    }
    for (const record of this.hitFlashRecords) {
      record.mesh.material = record.originalMaterial;
      const flashMaterials = Array.isArray(record.flashMaterial)
        ? record.flashMaterial
        : [record.flashMaterial];
      for (const material of flashMaterials) {
        material.dispose();
      }
    }
    this.hitFlashRecords.length = 0;
    this.flashedTarget = null;
    this.hitFlashRemaining = 0;
    this.hitFlashElapsed = 0;
  }

  private setTarget(world: ENGINE.World | null, target: ENGINE.ModelMeshNode | null): void {
    const previous = this.targetObject;
    if (previous === target) {
      return;
    }
    this.targetObject = target;
    if (!target) {
      this.treeHealthBar?.hide();
      // Do not clear a pickup/scrap silhouette — only dismiss our dismantle outline.
      if (previous && this.hoverSilhouette.activeTarget === previous) {
        this.hoverSilhouette.setTarget(world, null);
      }
      return;
    }
    this.hoverSilhouette.setTarget(world, target);
  }

  private dismantleTarget(world: ENGINE.World, target: ENGINE.ModelMeshNode): void {
    this.dismantleCandidateCacheDirty = true;
    if (this.flashedTarget === target) {
      this.restoreHitFlash();
    }
    this.targetBounds.setFromObject(target);
    const isOrdinanceBoard = this.isOrdinanceBoardTarget(target);
    const spawnAtNodePosition = BUSH_8_BB_NAME.test(target.name ?? '')
      || UTILITY_POLE_16_NAME.test(target.name ?? '')
      || UTILITY_POLE_17_NAME.test(target.name ?? '')
      || UTILITY_POLE_18_TARGET_NAME.test(target.name ?? '')
      || this.isUtilityPole15Or20Target(target.name ?? '')
      || isOrdinanceBoard;
    if (spawnAtNodePosition || this.targetBounds.isEmpty()) {
      target.getWorldPosition(this.targetCenter);
    } else {
      this.targetBounds.getCenter(this.targetCenter);
    }
    target.getWorldQuaternion(this.targetRotation);

    const targetName = target.name ?? '';
    if (FIRE_HYDRANT_NAME.test(targetName)) {
      this.activateHydrantWater(world, target);
      return;
    }
    if (KANJI_SIGN_NAME.test(targetName)) {
      this.startPoseFall(
        world,
        target,
        KANJI_SIGN_POSE_NAME,
        KANJI_SIGN_FALL_POSE_POSITION,
        KANJI_SIGN_FALL_POSE_EULER,
      );
      this.kanjiSignDismantledHandler?.();
      return;
    }

    if (isOrdinanceBoard) {
      const boardPrefab = this.resolveOrdinanceBoardFallenPrefab(target);
      if (!boardPrefab) {
        console.error(
          '[StreetLampDismantlingSystem] No fallen prefab for ordinance board.',
          target.modelUrl,
        );
        return;
      }
      this.hideDismantledOriginal(target);
      this.setTarget(world, null);
      void this.spawnScrapPrefab(
        world,
        boardPrefab,
        this.targetCenter.clone(),
        this.targetRotation.clone(),
      ).then(() => {
        this.ordinanceBoardDismantledHandler?.();
      });
      return;
    }

    let prefabPath = STREET_LAMP_SCRAP_PREFAB;
    if (GUARDRAIL_D_NAME.test(targetName)) {
      prefabPath = GUARDRAIL_SCRAP_PREFAB;
    } else if (GUARDRAIL_SECTION_NAME.test(targetName)) {
      prefabPath = GUARDRAIL_SECTION_DROP_PREFAB;
    } else if (PARK_BENCH_NAME.test(targetName)) {
      prefabPath = PARK_BENCH_SCRAP_PREFAB;
    } else if (CHERRY_BLOSSOM_TREE_NAME.test(targetName)) {
      prefabPath = CHERRY_TREE_DROP_PREFAB;
    } else if (TRAIL_MAP_KIOSK_NAME.test(targetName)) {
      prefabPath = TRAIL_MAP_KIOSK_DROP_PREFAB;
    } else if (STONE_LANTERN_NAME.test(targetName)) {
      prefabPath = STONE_LANTERN_DROP_PREFAB;
    } else if (TRAFFIC_CONE_C_NAME.test(targetName)) {
      prefabPath = TRAFFIC_CONE_C_DROP_PREFAB;
    } else if (CARGO_CRATE_NAME.test(targetName)) {
      prefabPath = CARGO_CRATE_DROP_PREFAB;
    } else if (BUSH_8_BB_NAME.test(targetName)) {
      prefabPath = BUSH_8_BB_DROP_PREFAB;
    } else if (UTILITY_POLE_16_NAME.test(targetName)) {
      prefabPath = UTILITY_POLE_FALLEN_PREFAB;
      this.replaceStandingPole(world, UTILITY_POLE_15_NAME, UTILITY_POLE_20_PREFAB);
    } else if (UTILITY_POLE_18_TARGET_NAME.test(targetName)) {
      prefabPath = UTILITY_POLE_18_FALLEN_PREFAB;
      void this.swapUtilityPoleMesh(world, UTILITY_POLE_17_NAME);
    } else if (UTILITY_POLE_17_NAME.test(targetName)) {
      prefabPath = UTILITY_POLE_18_FALLEN_PREFAB;
      void this.swapUtilityPoleMesh(world, UTILITY_POLE_16_NAME);
    } else if (this.isUtilityPole15Or20Target(targetName)) {
      prefabPath = UTILITY_POLE_20_FALLEN_PREFAB;
    }

    const notifyPoleCut = this.isUtilityPoleTarget(targetName);
    const isStreetLamp = STREET_LAMP_NAME.test(targetName);
    const isCherryTree = CHERRY_BLOSSOM_TREE_NAME.test(targetName);
    const isTrailMapKiosk = TRAIL_MAP_KIOSK_NAME.test(targetName);
    const isParkBench = PARK_BENCH_NAME.test(targetName);
    const poleOrdinanceDrops = notifyPoleCut
      ? this.collectPoleOrdinanceDropFlags(target)
      : undefined;
    // Capture before hide — scrap prefab GLBs use a different baked palette.
    const parkBenchMaterials = isParkBench
      ? this.captureModelMaterials(target)
      : null;

    if (isStreetLamp) {
      this.hideStreetLampOrdinanceBoards(target);
    }
    if (isCherryTree) {
      this.hideTreesCuttingBoards(target);
    }
    this.hideDismantledOriginal(target);
    this.setTarget(world, null);

    void this.spawnScrapPrefab(
      world,
      prefabPath,
      this.targetCenter.clone(),
      this.targetRotation.clone(),
      poleOrdinanceDrops,
      parkBenchMaterials,
    ).then(() => {
      // Metal poles and lamps clatter; trees, benches and kiosks land woody.
      playSoundAt(
        world,
        isStreetLamp || notifyPoleCut ? GameSound.MetalCrash : GameSound.WoodCrash,
        this.targetCenter,
        1,
      );
      if (notifyPoleCut) {
        this.utilityPoleDismantledHandler?.();
      }
      if (isStreetLamp) {
        this.streetLampDismantledHandler?.();
      }
      if (isCherryTree) {
        this.cherryTreeDismantledHandler?.();
      }
      if (isTrailMapKiosk) {
        this.trailMapKioskDismantledHandler?.();
      }
    });
  }

  private async spawnScrapPrefab(
    world: ENGINE.World,
    prefabPath: string,
    position: THREE.Vector3,
    rotation: THREE.Quaternion,
    poleOrdinanceDrops?: { poleCut: boolean; highVoltage: boolean },
    sourceMaterials?: THREE.Material[] | null,
  ): Promise<void> {
    try {
      const scraps = await ENGINE.spawnAsync<ENGINE.SceneNode>(prefabPath);
      scraps.position.copy(position);
      scraps.quaternion.copy(rotation);
      world.add(scraps);
      this.spawnedScrapRoots.push(scraps);
      if (FALLEN_UTILITY_POLE_PREFABS.has(prefabPath)) {
        this.nonPickupableScrapRoots.add(scraps);
      }
      this.dismantleCandidateCacheDirty = true;
      // WebGPU: scrap GLBs with castShadow are a major device-loss source.
      this.disableScrapShadows(scraps);
      // Late-loaded child meshes can re-enable shadows — clear again next ticks.
      queueMicrotask(() => this.disableScrapShadows(scraps));
      window.setTimeout(() => this.disableScrapShadows(scraps), 250);
      if (sourceMaterials && sourceMaterials.length > 0) {
        this.markScrapSkipEnvironmentArt(scraps);
        await this.waitForScrapModels(scraps);
        this.applySourceMaterialsToScrap(scraps, sourceMaterials);
        this.bindScrapMaterialReapply(scraps, sourceMaterials);
        queueMicrotask(() => this.applySourceMaterialsToScrap(scraps, sourceMaterials));
        window.setTimeout(() => this.applySourceMaterialsToScrap(scraps, sourceMaterials), 250);
        window.setTimeout(() => this.applySourceMaterialsToScrap(scraps, sourceMaterials), 1000);
      }
      if (prefabPath === BUSH_8_BB_DROP_PREFAB) {
        this.enableWearableBushPhysics(scraps);
        this.playBushTransformAnimation(scraps);
      }
      if (FALLEN_UTILITY_POLE_PREFABS.has(prefabPath) && poleOrdinanceDrops) {
        this.applyFallenPoleOrdinanceDrops(scraps, poleOrdinanceDrops);
      }
    } catch (error) {
      console.error('[StreetLampDismantlingSystem] Failed to spawn scrap prefab.', error);
    }
  }

  private async waitForScrapModels(scraps: ENGINE.SceneNode): Promise<void> {
    const models = scraps instanceof ENGINE.ModelMeshNode
      ? [scraps]
      : scraps.getNodes(ENGINE.ModelMeshNode);
    await Promise.all(models.map((model) => model.waitForLoad()));
  }

  private markScrapSkipEnvironmentArt(scraps: ENGINE.SceneNode): void {
    const models = scraps instanceof ENGINE.ModelMeshNode
      ? [scraps]
      : scraps.getNodes(ENGINE.ModelMeshNode);
    for (const model of models) {
      model.userData[SKIP_ENVIRONMENT_ART_FLAG] = true;
    }
  }

  private bindScrapMaterialReapply(
    scraps: ENGINE.SceneNode,
    sourceMaterials: THREE.Material[],
  ): void {
    const models = scraps instanceof ENGINE.ModelMeshNode
      ? [scraps]
      : scraps.getNodes(ENGINE.ModelMeshNode);
    for (const model of models) {
      model.userData[SKIP_ENVIRONMENT_ART_FLAG] = true;
      model.onMeshLoaded.add(() => {
        model.userData[SKIP_ENVIRONMENT_ART_FLAG] = true;
        this.applySourceMaterialsToScrap(scraps, sourceMaterials);
      });
    }
  }

  /** Full material clones from the standing prop (keeps green albedo maps). */
  private captureModelMaterials(source: ENGINE.ModelMeshNode): THREE.Material[] {
    const materials: THREE.Material[] = [];
    for (const mesh of source.getAllMeshes()) {
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) {
        if (!material) {
          continue;
        }
        const cloned = material.clone();
        cloned.userData.summerAfternoonSurfaceStyle = true;
        materials.push(cloned);
      }
    }
    return materials;
  }

  private applySourceMaterialsToScrap(
    scraps: ENGINE.SceneNode,
    sourceMaterials: THREE.Material[],
  ): void {
    if (sourceMaterials.length === 0) {
      return;
    }
    let materialIndex = 0;
    const models = scraps instanceof ENGINE.ModelMeshNode
      ? [scraps]
      : scraps.getNodes(ENGINE.ModelMeshNode);
    for (const model of models) {
      model.userData[SKIP_ENVIRONMENT_ART_FLAG] = true;
      for (const mesh of model.getAllMeshes()) {
        const slots = Array.isArray(mesh.material) ? mesh.material.length : 1;
        if (slots <= 1) {
          const source = sourceMaterials[materialIndex % sourceMaterials.length]!;
          materialIndex += 1;
          const cloned = source.clone();
          cloned.userData.summerAfternoonSurfaceStyle = true;
          cloned.needsUpdate = true;
          mesh.material = cloned;
          continue;
        }
        const next: THREE.Material[] = [];
        for (let slot = 0; slot < slots; slot += 1) {
          const source = sourceMaterials[materialIndex % sourceMaterials.length]!;
          materialIndex += 1;
          const cloned = source.clone();
          cloned.userData.summerAfternoonSurfaceStyle = true;
          cloned.needsUpdate = true;
          next.push(cloned);
        }
        mesh.material = next;
      }
    }
  }

  /**
   * Which pole-mounted ordinance boards were visible before the pole was hidden.
   * Scene boards stay in the hierarchy (edit-mode / day-reset); prefab drops mirror them.
   */
  private collectPoleOrdinanceDropFlags(
    pole: ENGINE.ModelMeshNode,
  ): { poleCut: boolean; highVoltage: boolean } {
    let poleCut = false;
    let highVoltage = false;
    for (const child of pole.children) {
      if (!(child instanceof ENGINE.ModelMeshNode) || !child.visible) {
        continue;
      }
      const name = child.name ?? '';
      if (POLE_CUT_BOARD_NAME.test(name)) {
        poleCut = true;
      }
      if (HIGH_VOLTAGE_BOARD_NAME.test(name)) {
        highVoltage = true;
      }
    }
    return { poleCut, highVoltage };
  }

  /**
   * Show prefab ordinance drops when those boards were already active/visible on the pole.
   * Does not remove scene boards — they remain parented for edit mode / reset.
   */
  private applyFallenPoleOrdinanceDrops(
    scraps: ENGINE.SceneNode,
    flags: { poleCut: boolean; highVoltage: boolean },
  ): void {
    this.setFallenOrdinanceDropVisibility(scraps, POLE_CUT_DROP_NAME, flags.poleCut);
    this.setFallenOrdinanceDropVisibility(scraps, HIGH_VOLTAGE_DROP_NAME, flags.highVoltage);
  }

  private setFallenOrdinanceDropVisibility(
    scraps: ENGINE.SceneNode,
    namePattern: RegExp,
    visible: boolean,
  ): void {
    for (const drop of this.findFallenOrdinanceDrops(scraps, namePattern)) {
      drop.visible = visible;
      if (visible) {
        this.enableFallenPoleOrdinanceDropPhysics(drop);
      } else {
        drop.overridePhysicsOptions({ enabled: false });
      }
    }
  }

  private findFallenOrdinanceDrops(
    scraps: ENGINE.SceneNode,
    namePattern: RegExp,
  ): ENGINE.ModelMeshNode[] {
    const found: ENGINE.ModelMeshNode[] = [];
    const stack: ENGINE.SceneNode[] = [];
    for (const child of scraps.children) {
      if (child instanceof ENGINE.SceneNode) {
        stack.push(child);
      }
    }
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if (node instanceof ENGINE.ModelMeshNode && namePattern.test(node.name ?? '')) {
        found.push(node);
      }
      for (const child of node.children) {
        if (child instanceof ENGINE.SceneNode) {
          stack.push(child);
        }
      }
    }
    return found;
  }

  private enableFallenPoleOrdinanceDropPhysics(board: ENGINE.ModelMeshNode): void {
    board.overridePhysicsOptions({ enabled: false });
    board.setPhysicsTransformUpdateFlags({
      sendPosition: false,
      sendRotation: false,
      receivePosition: false,
      receiveRotation: false,
    });
  }

  private replaceStandingPole(
    world: ENGINE.World,
    standingName: RegExp,
    prefabPath: string,
  ): void {
    const standing = this.findPoseFallDummy(world, standingName);
    if (!standing || this.dismantledTargets.has(standing)) {
      return;
    }

    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    standing.getWorldPosition(position);
    standing.getWorldQuaternion(rotation);
    this.hideDismantledOriginal(standing);

    void this.spawnScrapPrefab(world, prefabPath, position, rotation);
  }

  private async swapUtilityPoleMesh(world: ENGINE.World, poleName: RegExp): Promise<void> {
    const pole = this.findPoseFallDummy(world, poleName);
    if (!pole || this.dismantledTargets.has(pole)) {
      return;
    }

    const originalUrl = typeof pole.modelUrl === 'string'
      ? pole.modelUrl
      : String(pole.modelUrl ?? '');
    if (originalUrl && !this.meshSwapRecords.some((record) => record.node === pole)) {
      this.meshSwapRecords.push({ node: pole, modelUrl: originalUrl });
    }
    // Visual-only swap for the linked standing pole — do NOT mark dismantled,
    // or that pole becomes untargetable (e.g. Pole 16 after chopping Pole 17).

    try {
      await pole.loadModel(ENGINE.AssetPath.fromString(UTILITY_POLE_18_MODEL_URL));
      await pole.waitForLoad();
      this.dismantleCandidateCacheDirty = true;
    } catch (error) {
      console.error('[StreetLampDismantlingSystem] Failed to swap utility pole mesh.', error);
    }
  }

  private isUtilityPole15Or20Target(name: string): boolean {
    return UTILITY_POLE_15_NAME.test(name) || UTILITY_POLE_20_STANDING_NAME.test(name);
  }

  private isUtilityPoleTarget(name: string): boolean {
    return UTILITY_POLE_16_NAME.test(name)
      || UTILITY_POLE_17_NAME.test(name)
      || UTILITY_POLE_18_TARGET_NAME.test(name)
      || this.isUtilityPole15Or20Target(name);
  }

  private activateHydrantWater(world: ENGINE.World, hydrant: ENGINE.ModelMeshNode): void {
    this.markDismantled(hydrant);
    this.setTarget(world, null);
    const camera = this.lastCamera;
    if (camera) {
      const stream = new HydrantWaterStream();
      stream.start(world, hydrant, camera);
      this.hydrantWaterStreams.push(stream);
    }
    this.fireHydrantActivatedHandler?.();
  }

  private isPoseFallDummy(name: string): boolean {
    return KANJI_SIGN_POSE_NAME.test(name)
      || UTILITY_POLE_19_POSE_NAME.test(name)
      || UTILITY_POLE_20_DUMMY_NAME.test(name);
  }

  private findPoseFallDummy(world: ENGINE.World, poseName: RegExp): ENGINE.ModelMeshNode | null {
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (poseName.test(node.name ?? '')) {
        return node;
      }
    }
    return null;
  }

  private cachePoseFallTargets(world: ENGINE.World): void {
    this.kanjiSignFallEndPosition.copy(KANJI_SIGN_FALL_POSE_POSITION);
    this.kanjiSignFallEndQuaternion.setFromEuler(KANJI_SIGN_FALL_POSE_EULER);
    this.kanjiSignLandPhysics = { ...KANJI_SIGN_LAND_PHYSICS };
    const kanjiPose = this.findPoseFallDummy(world, KANJI_SIGN_POSE_NAME);
    if (kanjiPose) {
      kanjiPose.getWorldPosition(this.kanjiSignFallEndPosition);
      kanjiPose.getWorldQuaternion(this.kanjiSignFallEndQuaternion);
      this.kanjiSignLandPhysics = {
        ...kanjiPose.getPhysicsOptions(),
        enabled: true,
      };
    }
  }

  private hidePoseFallTargets(world: ENGINE.World): void {
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!this.isPoseFallDummy(node.name ?? '')) {
        continue;
      }
      node.overridePhysicsOptions({ enabled: false });
    }
  }

  private startPoseFall(
    world: ENGINE.World,
    node: ENGINE.ModelMeshNode,
    poseName: RegExp,
    fallbackPosition: THREE.Vector3,
    fallbackEuler: THREE.Euler,
  ): void {
    this.markDismantled(node);
    this.setTarget(world, null);
    this.cachePoseFallTargets(world);

    const pose = this.findPoseFallDummy(world, poseName);
    const endPosition = this.kanjiSignFallEndPosition.clone();
    const endQuaternion = this.kanjiSignFallEndQuaternion.clone();
    const endScale = (pose?.scale ?? node.scale).clone();
    const resolvedPhysics = this.kanjiSignLandPhysics;
    if (!pose) {
      endPosition.copy(fallbackPosition);
      endQuaternion.setFromEuler(fallbackEuler);
    }

    const startPosition = new THREE.Vector3();
    const startQuaternion = new THREE.Quaternion();
    node.getWorldPosition(startPosition);
    node.getWorldQuaternion(startQuaternion);
    if (!this.poseFallHomePoses.has(node)) {
      this.poseFallHomePoses.set(node, {
        position: startPosition.clone(),
        quaternion: startQuaternion.clone(),
        scale: node.scale.clone(),
        physics: { ...node.getPhysicsOptions() },
      });
    }
    this.beginPoseFall(
      node,
      startPosition,
      startQuaternion,
      node.scale.clone(),
      endPosition,
      endQuaternion,
      endScale,
      resolvedPhysics,
      true,
    );
  }

  private beginPoseFall(
    node: ENGINE.ModelMeshNode,
    startPosition: THREE.Vector3,
    startQuaternion: THREE.Quaternion,
    startScale: THREE.Vector3,
    endPosition: THREE.Vector3,
    endQuaternion: THREE.Quaternion,
    endScale: THREE.Vector3,
    landPhysics: ENGINE.NodePhysicsOptions,
    easeRotation = true,
  ): void {
    node.visible = true;
    node.static = false;
    node.matrixAutoUpdate = true;
    node.overridePhysicsOptions({ enabled: false });
    node.setPhysicsTransformUpdateFlags({
      sendPosition: false,
      sendRotation: false,
      receivePosition: false,
      receiveRotation: false,
    });
    this.applyPoseFallWorldPose(node, startPosition, startQuaternion, startScale);
    this.poseFallAnimations.push({
      node,
      elapsed: 0,
      duration: POSE_FALL_DURATION,
      startPosition: startPosition.clone(),
      startQuaternion: startQuaternion.clone(),
      startScale: startScale.clone(),
      endPosition: endPosition.clone(),
      endQuaternion: endQuaternion.clone(),
      endScale: endScale.clone(),
      easeRotation,
      localSpace: false,
      landPhysics: { ...landPhysics, enabled: true },
    });
  }

  private applyPoseFallWorldPose(
    node: ENGINE.ModelMeshNode,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    scale: THREE.Vector3,
  ): void {
    const parent = node.parent;
    if (!parent) {
      node.position.copy(position);
      node.quaternion.copy(quaternion);
      node.scale.copy(scale);
      node.updateMatrixWorld(true);
      return;
    }

    parent.updateMatrixWorld(true);
    node.position.copy(position);
    parent.worldToLocal(node.position);
    parent.getWorldQuaternion(this.poseFallParentQuaternion);
    node.quaternion.copy(this.poseFallParentQuaternion).invert().multiply(quaternion);
    node.scale.copy(scale);
    node.updateMatrixWorld(true);
  }

  private finishPoseFall(animation: PoseFallAnimation): void {
    if (animation.easeRotation) {
      this.applyPoseFallWorldPose(
        animation.node,
        animation.endPosition,
        animation.endQuaternion,
        animation.endScale,
      );
    } else {
      animation.node.position.copy(animation.endPosition);
    }
    const landPhysics = animation.landPhysics;
    const isDynamic = landPhysics.motionType === ENGINE.PhysicsMotionType.Dynamic;
    animation.node.overridePhysicsOptions({
      ...landPhysics,
      enabled: true,
    });
    animation.node.setPhysicsTransformUpdateFlags({
      sendPosition: false,
      sendRotation: false,
      receivePosition: isDynamic,
      receiveRotation: isDynamic,
    });
    if (isDynamic) {
      animation.node.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity, [0, 0, 0]);
      animation.node.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.AngularVelocity, [0, 0, 0]);
    }
  }

  private updatePoseFallAnimations(deltaTime: number): void {
    for (let index = this.poseFallAnimations.length - 1; index >= 0; index--) {
      const animation = this.poseFallAnimations[index];
      if (!animation.node.parent) {
        this.poseFallAnimations.splice(index, 1);
        continue;
      }

      animation.elapsed += deltaTime;
      const t = Math.min(1, animation.elapsed / animation.duration);
      const eased = t * t * (3 - 2 * t);
      if (animation.easeRotation) {
        this.poseFallWorldPosition.lerpVectors(animation.startPosition, animation.endPosition, eased);
        this.poseFallWorldQuaternion.copy(animation.startQuaternion).slerp(animation.endQuaternion, eased);
        this.poseFallWorldScale.lerpVectors(animation.startScale, animation.endScale, eased);
        this.applyPoseFallWorldPose(
          animation.node,
          this.poseFallWorldPosition,
          this.poseFallWorldQuaternion,
          this.poseFallWorldScale,
        );
      } else {
        animation.node.position.lerpVectors(animation.startPosition, animation.endPosition, eased);
      }

      if (t >= 1) {
        this.finishPoseFall(animation);
        this.poseFallAnimations.splice(index, 1);
      }
    }
  }

  private updateHydrantWater(deltaTime: number, camera: THREE.Camera): void {
    for (const stream of this.hydrantWaterStreams) {
      stream.update(deltaTime, camera);
    }
  }

  private playBushTransformAnimation(node: ENGINE.SceneNode): void {
    this.bushAppearAnimations.push({
      node,
      elapsed: 0,
      duration: 0.7,
      basePosition: node.position.clone(),
      baseQuaternion: node.quaternion.clone(),
    });
  }

  /** Ensure the hide-bush drop is physically pickable / wearable after spawn. */
  private enableWearableBushPhysics(scraps: ENGINE.SceneNode): void {
    const models = scraps instanceof ENGINE.ModelMeshNode
      ? [scraps]
      : scraps.getNodes(ENGINE.ModelMeshNode);
    for (const model of models) {
      model.replacePhysicsOptions({
        enabled: true,
        collisionMeshType: ENGINE.CollisionMeshType.BoundingBox,
        collisionProfile: ENGINE.DefaultCollisionProfile.BlockAll,
        motionType: ENGINE.PhysicsMotionType.Dynamic,
        density: 40,
      });
      model.setPhysicsTransformUpdateFlags({
        sendPosition: true,
        sendRotation: true,
        receivePosition: true,
        receiveRotation: true,
      });
    }
  }

  private updateBushAppearAnimations(deltaTime: number): void {
    for (let index = this.bushAppearAnimations.length - 1; index >= 0; index--) {
      const animation = this.bushAppearAnimations[index];
      if (!animation.node.parent) {
        this.bushAppearAnimations.splice(index, 1);
        continue;
      }

      animation.elapsed += deltaTime;
      const t = Math.min(1, animation.elapsed / animation.duration);
      const fade = 1 - t;
      const bounce = Math.sin(t * Math.PI) * 0.42;
      const shake = fade * fade;
      animation.node.position.copy(animation.basePosition);
      animation.node.position.x += Math.sin(animation.elapsed * 54) * 0.08 * shake;
      animation.node.position.y += bounce;
      animation.node.position.z += Math.cos(animation.elapsed * 47) * 0.07 * shake;
      this.shakeEuler.set(
        Math.sin(animation.elapsed * 40) * 0.09 * shake,
        0,
        Math.cos(animation.elapsed * 36) * 0.08 * shake,
      );
      this.shakeRotation.setFromEuler(this.shakeEuler);
      animation.node.quaternion.copy(animation.baseQuaternion).multiply(this.shakeRotation);

      if (t >= 1) {
        animation.node.position.copy(animation.basePosition);
        animation.node.quaternion.copy(animation.baseQuaternion);
        this.bushAppearAnimations.splice(index, 1);
      }
    }
  }
}

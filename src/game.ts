/**
 * Third person game template - third-person character controller setup.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import './consume-studio-link-preloads.js';
import { installAnimationOneShotHostPatch } from './animation-oneshot-host-patch.js';
import { CarryPlayerController } from './carry-player-controller.js';
import { ClimbableLadder } from './climbable-ladder.js';
import { ThirdPersonPlayer } from './player.js';
import { installEditorTrimeshPatch, patchTrimeshColliderScale } from './rapier-trimesh-patch.js';
import { installStreetLampOrdinanceEditorPhysicsGuard } from './street-lamp-dismantling-system.js';
import {
  beginSpawnPhysicsGrace,
  patchRapierSimulationBudget,
  setRapierSimulationPaused,
} from './rapier-simulation-budget.js';
import { MailDeliveryFlowSystem } from './mail-delivery-flow.js';
import { StairWalkRamp } from './stair-walk-ramp.js';
import { ShophouseCameraOcclusionSystem } from './shophouse-camera-occlusion.js';
import { AxePickupRingSystem } from './axe-pickup-ring.js';
import { StartupBrushRevealSystem } from './startup-brush-reveal.js';
import { DeliveryProgressHudSystem } from './delivery-progress-hud.js';
import { GameCursorSystem } from './game-cursor.js';
import { StartupLoadingScreenSystem } from './startup-loading-screen.js';
import { TutorialKeysGuide } from './tutorial-keys-guide.js';
import { StreetLampGroundLightsSystem } from './street-lamp-ground-lights.js';
import { applyDirectionalShadowBudget } from './environment-art-direction.js';
import { guardSceneGeometryEarly } from './ordinance-sign-sharpness.js';
import { preloadGameAudio, startGoldenHourAudio } from './game-audio.js';
import { waitForStartupLoading } from './startup-loading-screen.js';

installAnimationOneShotHostPatch(ENGINE);
installEditorTrimeshPatch(ENGINE);
installStreetLampOrdinanceEditorPhysicsGuard(ENGINE);

@ENGINE.GameClass()
class ThirdPersonGameMode extends ENGINE.GameMode {
  constructor() {
    super();
  }

  public override initialize(options?: ENGINE.GameModeOptions): void {
    super.initialize({
      ...options,
      pawnFactory: async () => ThirdPersonPlayer.create(),
      // Free cursor until RMB orbit requests pointer lock.
      playerControllerFactory: async () => CarryPlayerController.create({
        noPointerLock: true,
      }),
    });
  }

  public override beginPlay(): boolean {
    // Don't step Rapier until the pawn is planted — first ticks overlap WebGPU
    // init and dump 0.0667s of catch-up (spawn hitch → late-game device loss).
    beginSpawnPhysicsGrace();
    if (!super.beginPlay()) {
      setRapierSimulationPaused(false);
      return false;
    }
    guardSceneGeometryEarly(this.getWorld(), 'GameMode.beginPlay');
    // Cream cover before anything else so the world never flashes on the first frames.
    this.ensureStartupLoadingScreen();
    // Begin the background track under the loading copy. If browser autoplay is
    // locked, this arms the first input gesture instead of waiting for reveal.
    startGoldenHourAudio(this.getWorld());
    // Keep sun shadows/CSM off after scene load (isSunLight can re-enable expensive cascades).
    applyDirectionalShadowBudget(this.getWorld());
    // Warm audio after the cream screen — avoids parallel loadSound preloads at spawn.
    void waitForStartupLoading().then(() => preloadGameAudio());
    this.ensureStartupBrushReveal();
    this.attachAccessStairWalkRamp();
    this.attachClimbableLadders();
    this.ensureStreetLampGroundLights();
    this.ensureMailDeliveryFlow();
    this.ensureShophouseCameraOcclusion();
    this.ensureAxePickupRing();
    this.ensureTutorialKeysGuide();
    this.ensureDeliveryProgressHud();
    this.ensureGameCursor();
    return true;
  }

  private ensureTutorialKeysGuide(): void {
    const world = this.getWorld();
    if (!world || world.getNodes(TutorialKeysGuide).length > 0) {
      return;
    }
    // Fallback if the scene was not authored with a guide yet — snap near the
    // intended RightSideRoad asphalt tile so keys are not at world origin.
    const guide = TutorialKeysGuide.create();
    const road = world.getNodes(ENGINE.ModelMeshNode).find((node) => (
      /RightSideRoad\s+Asphalt\s+Road\s+Tile\s+Straight\s+Both\s+02/i.test(node.name ?? '')
    ));
    if (road) {
      const pos = new THREE.Vector3();
      road.getWorldPosition(pos);
      guide.position.set(pos.x, pos.y + 0.05, pos.z);
    }
    world.add(guide);
  }

  private ensureStartupLoadingScreen(): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }
    const existing = world.getNodes(StartupLoadingScreenSystem)[0];
    const loading = existing ?? StartupLoadingScreenSystem.create();
    if (!existing) {
      world.add(loading);
    }
    // Nodes added from GameMode.beginPlay can miss their own beginPlay call in
    // some Studio startup paths. Start explicitly so cream covers the first frame.
    loading.startLoadingSequence();
  }

  private ensureGameCursor(): void {
    const world = this.getWorld();
    if (!world || world.getNodes(GameCursorSystem).length > 0) {
      return;
    }
    world.add(GameCursorSystem.create());
  }

  private ensureMailDeliveryFlow(): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }
    if (world.getNodes(MailDeliveryFlowSystem).length > 0) {
      return;
    }
    world.add(MailDeliveryFlowSystem.create());
  }

  private ensureAxePickupRing(): void {
    const world = this.getWorld();
    if (!world || world.getNodes(AxePickupRingSystem).length > 0) {
      return;
    }
    world.add(AxePickupRingSystem.create());
  }

  private ensureStartupBrushReveal(): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }
    const existing = world.getNodes(StartupBrushRevealSystem)[0];
    if (existing) {
      return;
    }
    // Do not start the splash here — StartupLoadingScreenSystem owns that handoff.
    world.add(StartupBrushRevealSystem.create());
  }

  private ensureDeliveryProgressHud(): void {
    const world = this.getWorld();
    if (!world || world.getNodes(DeliveryProgressHudSystem).length > 0) {
      return;
    }
    world.add(DeliveryProgressHudSystem.create());
  }

  private ensureShophouseCameraOcclusion(): void {
    const world = this.getWorld();
    if (!world || world.getNodes(ShophouseCameraOcclusionSystem).length > 0) {
      return;
    }
    world.add(ShophouseCameraOcclusionSystem.create());
  }

  private ensureStreetLampGroundLights(): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }
    if (world.getNodes(StreetLampGroundLightsSystem).length > 0) {
      return;
    }
    world.add(StreetLampGroundLightsSystem.create());
  }

  private attachClimbableLadders(): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }

    for (const root of world.getRootNodes()) {
      if (!/^Bolted Ladder/i.test(root.name ?? '')) {
        continue;
      }
      if (root.getNodes(ClimbableLadder).length > 0) {
        continue;
      }
      if (root instanceof ENGINE.PrimitiveNode) {
        root.overridePhysicsOptions({
          collisionProfile: ENGINE.DefaultCollisionProfile.IgnoreOnlyPawns,
        });
      }
      root.add(ClimbableLadder.create({ name: 'ClimbVolume' }));
    }
  }

  private attachAccessStairWalkRamp(): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }

    for (const root of world.getRootNodes()) {
      if (!/^Access Stair/i.test(root.name ?? '')) {
        continue;
      }
      if (root.getNodes(StairWalkRamp).length > 0) {
        continue;
      }
      if (root instanceof ENGINE.PrimitiveNode) {
        root.overridePhysicsOptions({ enabled: false });
      }
      root.add(StairWalkRamp.create({ name: 'WalkRamp' }));
    }
  }
}

class ThirdPersonGame extends ENGINE.BaseGameLoop {
  public override async ensurePhysicsEngine(world: ENGINE.World): Promise<void> {
    await super.ensurePhysicsEngine(world);
    patchTrimeshColliderScale(this.physicsEngine);
    patchRapierSimulationBudget(this.physicsEngine);
    // Physics stays off until mail-flow releases spawn grace after intro.
    beginSpawnPhysicsGrace();
  }
}

export function main(container: HTMLElement, options?: Partial<ENGINE.BaseGameLoopOptions>): ENGINE.IGameLoop {
  const mergedOptions: Partial<ENGINE.BaseGameLoopOptions> = {
    ...options,
    defaultGameModeClass: ThirdPersonGameMode,
  };
  const game = new ThirdPersonGame(container, mergedOptions);
  return game;
}

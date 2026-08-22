/**
 * Third person game template - third-person character controller setup.
 */

import * as ENGINE from '@gnsx/genesys.js';

import { installAnimationOneShotHostPatch } from './animation-oneshot-host-patch.js';
import { CarryPlayerController } from './carry-player-controller.js';
import { ClimbableLadder } from './climbable-ladder.js';
import { ThirdPersonPlayer } from './player.js';
import { patchTrimeshColliderScale } from './rapier-trimesh-patch.js';
import {
  OrdinanceSignSharpnessSystem,
  refreshOrdinanceSignSharpness,
} from './ordinance-sign-sharpness.js';
import { MailDeliveryFlowSystem } from './mail-delivery-flow.js';
import './sharp-sign-board-material.js';
import { StairWalkRamp } from './stair-walk-ramp.js';
import { ShophouseCameraOcclusionSystem } from './shophouse-camera-occlusion.js';

installAnimationOneShotHostPatch(ENGINE);

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
    if (!super.beginPlay()) {
      return false;
    }
    this.attachAccessStairWalkRamp();
    this.attachClimbableLadders();
    this.ensureOrdinanceSignSharpness();
    void refreshOrdinanceSignSharpness(this.getWorld());
    this.ensureMailDeliveryFlow();
    this.ensureShophouseCameraOcclusion();
    return true;
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

  private ensureShophouseCameraOcclusion(): void {
    const world = this.getWorld();
    if (!world || world.getNodes(ShophouseCameraOcclusionSystem).length > 0) {
      return;
    }
    world.add(ShophouseCameraOcclusionSystem.create());
  }

  private ensureOrdinanceSignSharpness(): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }
    if (world.getNodes(OrdinanceSignSharpnessSystem).length > 0) {
      return;
    }
    world.add(OrdinanceSignSharpnessSystem.create());
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

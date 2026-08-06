/**
 * Third person game template - third-person character controller setup.
 */

import * as ENGINE from '@gnsx/genesys.js';

import { ThirdPersonPlayer } from './player.js';

@ENGINE.GameClass()
class ThirdPersonGameMode extends ENGINE.GameMode {
  constructor() {
    super();
  }

  public override initialize(options?: ENGINE.GameModeOptions): void {
    super.initialize({
      ...options,
      pawnFactory: async () => ThirdPersonPlayer.create(),
    });
  }
}

class ThirdPersonGame extends ENGINE.BaseGameLoop {
}

export function main(container: HTMLElement, options?: Partial<ENGINE.BaseGameLoopOptions>): ENGINE.IGameLoop {
  const mergedOptions: Partial<ENGINE.BaseGameLoopOptions> = {
    ...options,
    defaultGameModeClass: ThirdPersonGameMode,
  };
  const game = new ThirdPersonGame(container, mergedOptions);
  return game;
}

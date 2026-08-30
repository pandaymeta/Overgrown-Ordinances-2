/**
 * Rapier hitch catch-up: a slow frame (spawn, next-day, scrap load) accumulates
 * more than 4 substeps (~0.0667s). The engine then warns "Physics substep budget
 * exceeded" and dumps that time — the pawn/crates jump, and late-game the extra
 * steps overlap WebGPU and lose the device.
 *
 * Pause stepping until the pawn is planted, discard hitch frames entirely, and
 * never feed more than one 60 Hz step after a hitch.
 */

const MAX_PHYSICS_STEP_SEC = 1 / 60;
/** Wall-clock longer than this → discard the physics tick (no substep catch-up). */
const HITCH_DISCARD_SEC = MAX_PHYSICS_STEP_SEC * 1.25;
/** Default hold after teleport / respawn / day reset. */
export const SPAWN_PHYSICS_HOLD_TICKS = 24;

let simulationPaused = false;
let holdTicksRemaining = 0;
let spawnGraceActive = false;

interface TickablePhysicsEngine {
  tick?: (deltaTime: number, ...rest: unknown[]) => unknown;
  __overgrownSimulationBudgetPatch?: boolean;
}

export function setRapierSimulationPaused(paused: boolean): void {
  simulationPaused = paused;
  if (!paused) {
    spawnGraceActive = false;
  }
}

/** Skip this many World physics ticks (in addition to an explicit pause). */
export function holdRapierSimulation(ticks: number): void {
  holdTicksRemaining = Math.max(holdTicksRemaining, Math.max(0, ticks));
}

/**
 * Spawn / respawn / next-day: optionally pause Rapier and queue a post-release
 * hold so the first real steps never catch up a GPU hitch frame.
 *
 * Use `pauseSimulation: false` when releasing early under a loading cover so the
 * capsule can settle while movement stays frozen.
 */
export function beginSpawnPhysicsGrace(
  holdTicks = SPAWN_PHYSICS_HOLD_TICKS,
  pauseSimulation = true,
): void {
  if (pauseSimulation) {
    simulationPaused = true;
  } else {
    simulationPaused = false;
  }
  spawnGraceActive = true;
  holdTicksRemaining = Math.max(holdTicksRemaining, holdTicks);
}

/** First moment the player can move — release pause, then drain hold ticks. */
export function releaseSpawnPhysicsGrace(holdTicks = SPAWN_PHYSICS_HOLD_TICKS): void {
  simulationPaused = false;
  spawnGraceActive = false;
  holdTicksRemaining = Math.max(holdTicksRemaining, holdTicks);
}

export function isRapierSimulationPaused(): boolean {
  return simulationPaused || holdTicksRemaining > 0;
}

function shouldSkipPhysicsTick(deltaTime: number): boolean {
  if (simulationPaused || holdTicksRemaining > 0) {
    if (holdTicksRemaining > 0) {
      holdTicksRemaining -= 1;
    }
    return true;
  }
  if (typeof deltaTime === 'number' && deltaTime > HITCH_DISCARD_SEC) {
    // Late-game GPU hitch: discard catch-up only — do not add extra hold ticks
    // or freshly spawned scrap floats until the hold drains.
    return true;
  }
  return false;
}

function wrapTick(
  target: TickablePhysicsEngine,
  original: (deltaTime: number, ...rest: unknown[]) => unknown,
): void {
  if (target.__overgrownSimulationBudgetPatch) {
    return;
  }
  target.tick = function patchedPhysicsTick(
    this: unknown,
    deltaTime: number,
    ...rest: unknown[]
  ) {
    if (shouldSkipPhysicsTick(deltaTime)) {
      return;
    }
    const dt = typeof deltaTime === 'number'
      ? Math.min(Math.max(deltaTime, 0), MAX_PHYSICS_STEP_SEC)
      : deltaTime;
    return original.call(this, dt, ...rest);
  };
  target.__overgrownSimulationBudgetPatch = true;
}

export function patchRapierSimulationBudget(physicsEngine: object | null | undefined): void {
  if (!physicsEngine) {
    return;
  }
  const engine = physicsEngine as TickablePhysicsEngine;
  if (typeof engine.tick === 'function') {
    wrapTick(engine, engine.tick.bind(engine));
  }
  const proto = Object.getPrototypeOf(physicsEngine) as TickablePhysicsEngine;
  if (proto && typeof proto.tick === 'function' && proto !== engine) {
    wrapTick(proto, proto.tick);
  }
}

export function isSpawnPhysicsGraceActive(): boolean {
  return spawnGraceActive || simulationPaused;
}

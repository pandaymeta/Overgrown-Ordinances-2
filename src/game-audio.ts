/**
 * Game audio — one-shot effects, looping music and street ambience.
 *
 * Comedy is rhythm, and rhythm is sound: the ordinance stamp is the punchline
 * of the whole game, so it is deliberately the loudest thing in the mix.
 *
 * Two things to know about the engine's audio:
 * - Effects route through `globalAudioManager`, which needs no scene nodes.
 * - Browsers start the AudioContext suspended until the player interacts, so
 *   the looping tracks are queued and started by the first gesture.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

/** Full literal paths — project asset paths must never be built programmatically. */
export const GameSound = {
  /** The punchline. Swap for `ordinance-stamp-woody.mp3` if a drier stamp reads better. */
  OrdinanceStamp: '@project/assets/audio/sfx/ordinance-stamp.mp3',
  OrdinanceReveal: '@project/assets/audio/sfx/ordinance-reveal.mp3',
  NextDaySting: '@project/assets/audio/sfx/next-day-sting.mp3',
  NextDayType: '@project/assets/audio/sfx/next-day-type.mp3',
  MailDelivered: '@project/assets/audio/sfx/mail-delivered.mp3',
  MailboxLatch: '@project/assets/audio/sfx/mailbox-latch.mp3',
  EnvelopePaper: '@project/assets/audio/sfx/envelope-paper.mp3',
  AxeChop: '@project/assets/audio/sfx/axe-chop.mp3',
  AxeHitWood: '@project/assets/audio/sfx/axe-hit-wood.mp3',
  WoodCrash: '@project/assets/audio/sfx/wood-crash.mp3',
  MetalCrash: '@project/assets/audio/sfx/metal-crash.mp3',
  PickupTool: '@project/assets/audio/sfx/pickup-tool.mp3',
  PickupSoft: '@project/assets/audio/sfx/pickup-soft.mp3',
  CatMeow: '@project/assets/audio/sfx/cat-meow.mp3',
  CatMeowHungry: '@project/assets/audio/sfx/cat-meow-hungry.mp3',
  UiClick: '@project/assets/audio/sfx/ui-click.mp3',
  UiOpen: '@project/assets/audio/sfx/ui-open.mp3',
  UiClose: '@project/assets/audio/sfx/ui-close.mp3',
  Victory: '@project/assets/audio/sfx/victory.mp3',
} as const;

const FOOTSTEPS = [
  '@project/assets/audio/sfx/footstep-01.mp3',
  '@project/assets/audio/sfx/footstep-02.mp3',
  '@project/assets/audio/sfx/footstep-03.mp3',
  '@project/assets/audio/sfx/footstep-04.mp3',
] as const;

const MUSIC_TRACK = '@project/assets/audio/music/golden-hour-stroll.mp3';
const AMBIENCE_TRACK = '@project/assets/audio/ambience/evening-crickets.mp3';

const MUSIC_VOLUME = 0.34;
const AMBIENCE_VOLUME = 0.2;
const SFX_BUS_VOLUME = 0.85;

/** Walk/run stride spacing in seconds. */
const WALK_STRIDE_SEC = 0.5;
const RUN_STRIDE_SEC = 0.33;

let activeWorld: ENGINE.World | null = null;
let busesConfigured = false;
let loopsRequested = false;
let loopsStarted = false;
let unlockHooked = false;

function getManager(
  world: ENGINE.World | null | undefined,
): ENGINE.World['globalAudioManager'] | null {
  return world?.globalAudioManager ?? null;
}

/**
 * Module state is process-wide, so a second play session in the editor would
 * otherwise inherit "already started" flags and come up silent.
 */
function syncWorld(world: ENGINE.World): void {
  if (activeWorld === world) {
    return;
  }
  activeWorld = world;
  busesConfigured = false;
  loopsRequested = false;
  loopsStarted = false;
  unlockHooked = false;
}

function configureBuses(world: ENGINE.World): void {
  syncWorld(world);
  if (busesConfigured) {
    return;
  }
  const manager = getManager(world);
  // The buses only exist once the listener has bound an AudioContext; leaving
  // this unlatched means the volumes get applied on a later call instead.
  const music = manager?.getBus('Music');
  if (!manager || !music) {
    return;
  }
  // Music sits well under the effects so the stamp always cuts through.
  music.setVolume(MUSIC_VOLUME);
  manager.getBus('Ambience')?.setVolume(AMBIENCE_VOLUME);
  manager.getBus('SFX')?.setVolume(SFX_BUS_VOLUME);
  busesConfigured = true;
}

/** Plays a non-positional one-shot. Use for UI, stings and the player's own actions. */
export function playSound(
  world: ENGINE.World | null | undefined,
  url: string,
  volume = 1,
): void {
  const manager = getManager(world);
  if (!manager || !world) {
    return;
  }
  configureBuses(world);
  void manager.playGlobalSound(url, { volume, bus: 'SFX' });
}

/** Plays a one-shot at a world position so it pans and falls off with distance. */
export function playSoundAt(
  world: ENGINE.World | null | undefined,
  url: string,
  position: THREE.Vector3,
  volume = 1,
): void {
  const manager = getManager(world);
  if (!manager || !world) {
    return;
  }
  configureBuses(world);
  void manager.playSoundAtPosition(url, position.clone(), {
    volume,
    bus: 'SFX',
    maxDistance: 60,
    rolloffFactor: 1.1,
  });
}

function startLoops(world: ENGINE.World): void {
  if (loopsStarted) {
    return;
  }
  const manager = getManager(world);
  if (!manager) {
    return;
  }
  // Buses may not have existed when audio was first requested; the AudioContext
  // is live by now, so this is the point where the mix levels reliably apply.
  configureBuses(world);
  loopsStarted = true;
  void manager.playGlobalSound(MUSIC_TRACK, {
    volume: 1,
    loop: true,
    bus: 'Music',
  });
  // Dusk crickets — a small, very Japanese golden-hour detail.
  void manager.playGlobalSound(AMBIENCE_TRACK, {
    volume: 1,
    loop: true,
    bus: 'Ambience',
  });
}

/**
 * Starts music and ambience, deferring until the player's first gesture when the
 * browser has the AudioContext suspended (which is the normal cold-start case).
 */
export function startGoldenHourAudio(world: ENGINE.World | null | undefined): void {
  if (!world) {
    return;
  }
  configureBuses(world);
  if (loopsRequested) {
    return;
  }
  loopsRequested = true;

  const context = world.audioListener?.context;
  if (!context) {
    return;
  }
  if (context.state === 'running') {
    startLoops(world);
    return;
  }
  if (unlockHooked) {
    return;
  }
  unlockHooked = true;

  const unlock = (): void => {
    void context.resume().then(() => startLoops(world));
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** Warms the decode cache so the first stamp or chop is not silent. */
export async function preloadGameAudio(): Promise<void> {
  const urls = [...Object.values(GameSound), ...FOOTSTEPS];
  await Promise.all(urls.map(async (url) => {
    try {
      await ENGINE.resourceManager.loadSound(ENGINE.AssetPath.fromString(url));
    } catch {
      // A missing clip should never block startup.
    }
  }));
}

/**
 * Stride-timed footsteps. Owned by the player so the cadence survives across
 * frames; call `update` every tick with the current locomotion state.
 */
export class FootstepPlayer {
  private sinceLastStep = 0;
  private nextIndex = 0;

  public update(
    world: ENGINE.World | null | undefined,
    deltaTime: number,
    moving: boolean,
    running: boolean,
  ): void {
    if (!moving) {
      // Land the next step immediately on move so walking feels responsive.
      this.sinceLastStep = WALK_STRIDE_SEC;
      return;
    }
    this.sinceLastStep += deltaTime;
    const stride = running ? RUN_STRIDE_SEC : WALK_STRIDE_SEC;
    if (this.sinceLastStep < stride) {
      return;
    }
    this.sinceLastStep = 0;
    const url = FOOTSTEPS[this.nextIndex % FOOTSTEPS.length];
    this.nextIndex += 1;
    // Own footsteps stay non-positional: the third-person camera sits metres
    // behind the avatar, which would make spatialised steps too quiet.
    playSound(world, url, running ? 0.5 : 0.36);
  }
}

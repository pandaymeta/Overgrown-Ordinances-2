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
  /** The punchline when a new ordinance is imposed. */
  OrdinanceStamp: '@project/assets/audio/sfx/ordinance-stamp.mp3',
  OrdinanceStampWoody: '@project/assets/audio/sfx/ordinance-stamp-woody.mp3',
  OrdinanceReveal: '@project/assets/audio/sfx/ordinance-reveal.mp3',
  NextDaySting: '@project/assets/audio/sfx/next-day-sting.mp3',
  NextDayType: '@project/assets/audio/sfx/next-day-type.mp3',
  MailDelivered: '@project/assets/audio/sfx/mail-delivered.mp3',
  MailboxLatch: '@project/assets/audio/sfx/mailbox-latch.mp3',
  EnvelopePaper: '@project/assets/audio/sfx/envelope-paper.mp3',
  AxeHitWood: '@project/assets/audio/sfx/axe-hit-wood.mp3',
  AxeHitMetal: '@project/assets/audio/sfx/axe-hit-metal.ogg',
  AxeHitRock: '@project/assets/audio/sfx/axe-hit-rock.ogg',
  AxeHitBush: '@project/assets/audio/sfx/axe-hit-bush.ogg',
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
  /** Player broke a live ordinance (soft-loop re-violation). */
  Error: '@project/assets/audio/sfx/Error.mp3',
} as const;

const FOOTSTEPS = [
  '@project/assets/audio/sfx/footstep-01.mp3',
  '@project/assets/audio/sfx/footstep-02.mp3',
  '@project/assets/audio/sfx/footstep-03.mp3',
  '@project/assets/audio/sfx/footstep-04.mp3',
] as const;

const MUSIC_TRACK = '@project/assets/audio/music/sonican-sneaky-curious-jazzy-loop-no2.mp3';
const AMBIENCE_TRACK = '@project/assets/audio/ambience/Street-Corner.mp3';

/** Master mute for looping BGM. Ambience / SFX are unaffected. */
const MUSIC_ENABLED = true;

/** Master mute for looping street ambience. Music / SFX are unaffected. */
const AMBIENCE_ENABLED = false;

const MUSIC_VOLUME = 0.17;
const AMBIENCE_VOLUME = 0.2;
// Keep effect requests at their authored gain.  Individual calls below are
// responsible for balancing; a reduced master SFX bus made the requested
// 2× impact/stamp gains far less noticeable in play mode.
const SFX_BUS_VOLUME = 1;

/** Walk/run stride spacing in seconds. */
const WALK_STRIDE_SEC = 0.5;
const RUN_STRIDE_SEC = 0.33;
/**
 * Footstep playback gain. Loudness is baked into the MP3s (peak ~0.33);
 * keep these near unity so a broken runtime gain path cannot re-blast them.
 */
const FOOTSTEP_WALK_VOLUME = 2.1;
const FOOTSTEP_RUN_VOLUME = 2.1;
const FOOTSTEP_LAND_VOLUME = 2.325;

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
  music.setVolume(MUSIC_ENABLED ? MUSIC_VOLUME : 0);
  manager.getBus('Ambience')?.setVolume(AMBIENCE_ENABLED ? AMBIENCE_VOLUME : 0);
  manager.getBus('SFX')?.setVolume(SFX_BUS_VOLUME);
  busesConfigured = true;
}

/**
 * One-shot SFX with immediate gain. Three.js Audio.setVolume() ramps from 1.0
 * via setTargetAtTime, so short hits (axe, stamp, latch, paper) never reach the
 * requested 2× level after the first sample — they keep sounding like volume 1.
 */
function playImmediateGainSound(
  world: ENGINE.World,
  url: string,
  volume: number,
  position: THREE.Vector3 | null,
  positional: { maxDistance: number; rolloffFactor: number } | null = null,
): void {
  const manager = getManager(world);
  const listener = world.audioListener;
  if (!manager || !listener) {
    return;
  }
  configureBuses(world);

  const context = listener.context;
  const destination = manager.getBus('SFX')?.getInput() ?? listener.getInput();

  void (async () => {
    try {
      if (context.state !== 'running') {
        await context.resume();
      }
      const buffer = await ENGINE.resourceManager.loadSound(
        ENGINE.AssetPath.fromString(url),
      );
      if (!buffer) {
        return;
      }

      if (context.state !== 'running') {
        return;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;

      const gain = context.createGain();
      gain.gain.value = volume;
      source.connect(gain);

      let panner: PannerNode | null = null;
      if (position && positional) {
        panner = context.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1;
        panner.maxDistance = positional.maxDistance;
        panner.rolloffFactor = positional.rolloffFactor;
        panner.positionX.value = position.x;
        panner.positionY.value = position.y;
        panner.positionZ.value = position.z;
        gain.connect(panner);
        panner.connect(destination);
      } else {
        gain.connect(destination);
      }

      source.start(0);
      source.onended = () => {
        try {
          source.disconnect();
          gain.disconnect();
          panner?.disconnect();
        } catch {
          // Already disconnected.
        }
      };
    } catch {
      // A missing clip should never block gameplay.
    }
  })();
}

/** Plays a non-positional one-shot. Use for UI, stings and the player's own actions. */
export function playSound(
  world: ENGINE.World | null | undefined,
  url: string,
  volume = 1,
): void {
  if (!world) {
    return;
  }
  playImmediateGainSound(world, url, volume, null);
}

/**
 * Ordinance punchline: stamp clip looped 3× in sequence (not stacked).
 * Interval matches ordinance-stamp.mp3 duration (~0.43s) so each hit finishes
 * before the next. Volume stays at 2× the prior single-hit level (was 2 → 4).
 */
const ORDINANCE_STAMP_LOOP_COUNT = 3;
const ORDINANCE_STAMP_DURATION_MS = 430;
const ORDINANCE_STAMP_VOLUME = 4;
export const ORDINANCE_BREAK_ERROR_VOLUME = 4;
/** Mailbox latch when the letter slots in (2× prior 3.6 level). */
export const MAILBOX_LATCH_VOLUME = 7.2;
/** Letter / paper UI and envelope interactions. */
export const ENVELOPE_PAPER_VOLUME = 3.2;

export function playOrdinanceStamp(world: ENGINE.World | null | undefined): void {
  for (let index = 0; index < ORDINANCE_STAMP_LOOP_COUNT; index++) {
    const delayMs = index * ORDINANCE_STAMP_DURATION_MS;
    window.setTimeout(
      () => playSound(world, GameSound.OrdinanceStamp, ORDINANCE_STAMP_VOLUME),
      delayMs,
    );
  }
}

/** Same-day rule break sting when a live ordinance is re-violated. */
export function playOrdinanceBreakError(world: ENGINE.World | null | undefined): void {
  playSound(world, GameSound.Error, ORDINANCE_BREAK_ERROR_VOLUME);
}

/** Plays a one-shot at a world position so it pans and falls off with distance. */
export function playSoundAt(
  world: ENGINE.World | null | undefined,
  url: string,
  position: THREE.Vector3,
  volume = 1,
): void {
  if (!world) {
    return;
  }
  playImmediateGainSound(world, url, volume, position.clone(), {
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
  if (MUSIC_ENABLED) {
    void manager.playGlobalSound(MUSIC_TRACK, {
      volume: 1,
      loop: true,
      bus: 'Music',
    });
  }
  if (AMBIENCE_ENABLED) {
    // Street-corner ambience for the overgrown town loop.
    void manager.playGlobalSound(AMBIENCE_TRACK, {
      volume: 1,
      loop: true,
      bus: 'Ambience',
    });
  }
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
  loopsRequested = true;

  // An early loading-screen request can arrive before the listener/context is
  // ready. Keep later idempotent calls able to finish starting the loops.
  if (loopsStarted) {
    return;
  }
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

/**
 * Footsteps use the same immediate-gain path as other short SFX.
 */
function playFootstepSound(
  world: ENGINE.World | null | undefined,
  url: string,
  volume: number,
): void {
  if (!world) {
    return;
  }
  playImmediateGainSound(world, url, volume, null);
}

/**
 * Stride-timed footsteps. Owned by the player so the cadence survives across
 * frames; call `update` every tick with the current locomotion state.
 */
export class FootstepPlayer {
  private sinceLastStep = 0;
  private nextIndex = 0;
  /** null until the first grounded sample — avoids a false land on spawn. */
  private wasGrounded: boolean | null = null;

  /**
   * Clear jump/land edge tracking (movement freeze, teleport, cinematic).
   * Next update re-seeds from the live grounded flag without playing a step.
   */
  public clearAirborneTracking(): void {
    this.wasGrounded = null;
  }

  public update(
    world: ENGINE.World | null | undefined,
    deltaTime: number,
    moving: boolean,
    running: boolean,
    grounded: boolean,
  ): void {
    this.updateJumpAndLand(world, grounded);

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
    this.playNextStep(world, running ? FOOTSTEP_RUN_VOLUME : FOOTSTEP_WALK_VOLUME);
  }

  private updateJumpAndLand(
    world: ENGINE.World | null | undefined,
    grounded: boolean,
  ): void {
    if (this.wasGrounded === null) {
      this.wasGrounded = grounded;
      return;
    }
    // Footstep only on landing — jump takeoff stays silent.
    if (!this.wasGrounded && grounded) {
      this.playNextStep(world, FOOTSTEP_LAND_VOLUME);
    }
    this.wasGrounded = grounded;
  }

  private playNextStep(
    world: ENGINE.World | null | undefined,
    volume: number,
  ): void {
    const url = FOOTSTEPS[this.nextIndex % FOOTSTEPS.length];
    this.nextIndex += 1;
    // Own footsteps stay non-positional: the third-person camera sits metres
    // behind the avatar, which would make spatialised steps too quiet.
    playFootstepSound(world, url, volume);
  }
}

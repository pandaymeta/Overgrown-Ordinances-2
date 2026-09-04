/**
 * Assets required before the cream title screen can hand off to the paper-tear reveal.
 * Scene models are collected by StartupLoadingScreenSystem at runtime.
 */
export const STARTUP_PRELOAD_ASSETS: readonly string[] = [
  '@project/assets/audio/music/sonican-sneaky-curious-jazzy-loop-no2.mp3',
  '@project/assets/audio/sfx/Error.mp3',
  '@project/assets/audio/sfx/transition-tear.mp3',
  '@project/assets/textures/startup-splash/transition-cream-png/cream-00.png',
  '@project/assets/textures/startup-splash/transition-tear-cream-atlas.png',
] as const;

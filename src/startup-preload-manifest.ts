/**
 * Assets required before the cream loading screen can hand off to the scene.
 * Scene models are collected by StartupLoadingScreenSystem at runtime.
 */
export const STARTUP_WALKER_FRAME_PATHS = [
  '@project/assets/ui/startup-walker/1-envelope.svg',
  '@project/assets/ui/startup-walker/2-envelope.svg',
  '@project/assets/ui/startup-walker/3-envelope.svg',
  '@project/assets/ui/startup-walker/4-envelope.svg',
  '@project/assets/ui/startup-walker/5-envelope.svg',
  '@project/assets/ui/startup-walker/6-envelope.svg',
  '@project/assets/ui/startup-walker/7-envelope.svg',
  '@project/assets/ui/startup-walker/8-envelope.svg',
] as const;

export const STARTUP_PRELOAD_ASSETS: readonly string[] = [
  '@project/assets/audio/music/sonican-sneaky-curious-jazzy-loop-no2.mp3',
  '@project/assets/textures/startup-splash/transition-cream-atlas.png',
  ...STARTUP_WALKER_FRAME_PATHS,
] as const;

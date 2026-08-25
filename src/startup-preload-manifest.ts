/**
 * Assets required before the cream loading screen can hand off to the scene.
 * Scene models are collected by StartupLoadingScreenSystem at runtime.
 */
export const STARTUP_PRELOAD_ASSETS: readonly string[] = [
  '@project/assets/textures/startup-splash/transition-cream-atlas.png',
] as const;

/**
 * Cream startup title screen: type the title while preloading, wait for click, then paper-tear.
 */

import * as ENGINE from '@gnsx/genesys.js';

import { ensureOvergrownAveriaFont } from './overgrown-averia-font.js';
import { startGoldenHourAudio } from './game-audio.js';
import { waitForIntroPhysicsPrimed } from './intro-physics-gate.js';
import { STARTUP_PRELOAD_ASSETS } from './startup-preload-manifest.js';
import { StartupBrushRevealSystem } from './startup-brush-reveal.js';

const CREAM_CSS = '#f4f1ea';
const TEXT_CSS = '#6b6560';
const LOADING_PAPER_FRAME_PATH =
  '@project/assets/textures/startup-splash/transition-cream-png/cream-00.png';
const LOADING_TITLE = 'Overgrown Ordinances';
const BEGIN_PROMPT_TEXT = '[ Click Anywhere ]';
const TYPEWRITER_CHAR_INTERVAL_MS = 55;
const LOADING_TITLE_FONT_PX = 56;
const PRELOAD_CONCURRENCY = 8;
/** Match the complete 60-frame paper-tear source. */
const STARTUP_REVEAL_HOLD_MS = 200;
const STARTUP_REVEAL_MS = 2000;

let loadingFinished = false;
const loadingWaiters: Array<() => void> = [];

/** Resolves once the cream loading screen has finished and handed off to the splash. */
export function waitForStartupLoading(): Promise<void> {
  if (loadingFinished) {
    return Promise.resolve();
  }
  return new Promise((resolve) => loadingWaiters.push(resolve));
}

export function isStartupLoadingFinished(): boolean {
  return loadingFinished;
}

function finishLoading(): void {
  if (loadingFinished) {
    return;
  }
  loadingFinished = true;
  loadingWaiters.splice(0).forEach((resolve) => resolve());
}

function isModelPath(path: string): boolean {
  return /\.(glb|gltf|usd|usda|usdc|usdz)$/i.test(path);
}

function isJsonPath(path: string): boolean {
  return /\.json$/i.test(path);
}

function isSoundPath(path: string): boolean {
  return /\.(mp3|ogg|wav|flac|aiff?|aac|m4a)$/i.test(path);
}

function isTexturePath(path: string): boolean {
  return /\.(png|jpe?g|webp|ktx2|gif)$/i.test(path);
}

async function preloadOne(path: string): Promise<void> {
  const asset = ENGINE.AssetPath.fromString(path);
  try {
    if (isModelPath(path)) {
      await ENGINE.resourceManager.loadModel(asset);
      return;
    }
    if (isJsonPath(path)) {
      await ENGINE.resourceManager.loadJsonObject(asset);
      return;
    }
    if (isSoundPath(path)) {
      await ENGINE.resourceManager.loadSound(asset);
      return;
    }
    if (isTexturePath(path)) {
      await ENGINE.resourceManager.loadTexture(asset);
    }
  } catch (error) {
    console.warn('[StartupLoading] Preload skipped:', path, error);
  }
}

async function preloadPool(paths: readonly string[]): Promise<void> {
  let next = 0;

  if (paths.length === 0) {
    return;
  }

  const workers = Array.from({ length: PRELOAD_CONCURRENCY }, async () => {
    while (next < paths.length) {
      const index = next;
      next += 1;
      await preloadOne(paths[index]);
    }
  });
  await Promise.all(workers);
}

function collectSceneModelUrls(world: ENGINE.World): string[] {
  const urls: string[] = [];
  for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
    const url = node.modelUrl;
    if (typeof url === 'string' && url.length > 0) {
      urls.push(url);
      continue;
    }
    if (url && typeof url === 'object' && 'toString' in url) {
      const asString = String(url);
      if (asString.includes('@project/') || asString.includes('@engine/')) {
        urls.push(asString);
      }
    }
  }
  return urls;
}

async function resolveProjectAssetUrl(logicalPath: string): Promise<string> {
  const resolved = await ENGINE.resolveAssetPathsInText(`"${logicalPath}"`);
  const url = resolved.replace(/^["']|["']$/g, '').trim();
  if (!url || url.includes('@project/') || url.includes('@engine/')) {
    throw new Error(`Unresolved asset: ${logicalPath} -> ${resolved}`);
  }
  return url;
}

@ENGINE.GameClass()
export class StartupLoadingScreenSystem extends ENGINE.SceneNode {
  private overlay: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private titleEl: HTMLHeadingElement | null = null;
  private beginPromptEl: HTMLParagraphElement | null = null;
  private typingGeneration = 0;
  private started = false;
  private sequenceGeneration = 0;
  private earlyPreloadPromise: Promise<void> | null = null;
  private beginGestureCleanup: (() => void) | null = null;

  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({ name: 'Startup Loading Screen', ...options });
  }

  public override postLoad(): void {
    super.postLoad();
    void this.ensureEarlyAssetWarmup();
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    void this.startLoadingSequence();
    return true;
  }

  public startLoadingSequence(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    const container = this.getWorld()?.gameContainer ?? null;
    if (container) {
      this.mountUi(container);
    }
    void this.runSequence();
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this.sequenceGeneration += 1;
    this.started = false;
    this.teardownUi();
    return true;
  }

  private async runEarlyAssetWarmup(): Promise<void> {
    const world = this.getWorld();
    if (!world) {
      return;
    }
    const paths = Array.from(
      new Set([
        ...STARTUP_PRELOAD_ASSETS,
        ...collectSceneModelUrls(world),
      ]),
    );
    await preloadPool(paths);
  }

  private ensureEarlyAssetWarmup(): Promise<void> {
    this.earlyPreloadPromise ??= this.runEarlyAssetWarmup();
    return this.earlyPreloadPromise;
  }

  private async runSequence(): Promise<void> {
    const generation = this.sequenceGeneration;
    const world = this.getWorld();
    const container = await this.waitForContainer();
    if (generation !== this.sequenceGeneration) {
      return;
    }
    if (!container) {
      finishLoading();
      return;
    }

    this.mountUi(container);
    await Promise.all([
      ensureOvergrownAveriaFont(),
      this.applyLoadingPaperBackground(),
    ]);
    if (generation !== this.sequenceGeneration) {
      return;
    }

    // Title screen owns all preload work; click only unlocks after assets + physics are ready.
    const preloadPromise = (async (): Promise<void> => {
      await this.ensureEarlyAssetWarmup();
      try {
        await ENGINE.resourceManager.waitForResources(ENGINE.ResourceType.All);
      } catch (error) {
        console.warn('[StartupLoading] waitForResources failed', error);
      }
      await waitForIntroPhysicsPrimed();
    })();

    await this.runTitleSequence(this.typingGeneration);
    if (generation !== this.sequenceGeneration) {
      return;
    }

    await preloadPromise;
    if (generation !== this.sequenceGeneration) {
      return;
    }

    this.showBeginPrompt();
    await this.waitForBeginGesture();
    if (generation !== this.sequenceGeneration) {
      this.teardownUi();
      return;
    }

    await this.handOffToBrushReveal(world);
    if (generation !== this.sequenceGeneration) {
      this.teardownUi();
      return;
    }
    finishLoading();
  }

  /** Use the tear's first paper frame behind the title screen. */
  private async applyLoadingPaperBackground(): Promise<void> {
    try {
      const url = await resolveProjectAssetUrl(LOADING_PAPER_FRAME_PATH);
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`Failed to load paper background: ${url}`));
        image.src = url;
      });
      if (!this.overlay) {
        return;
      }
      this.overlay.style.backgroundColor = CREAM_CSS;
      this.overlay.style.backgroundImage = `url(${JSON.stringify(url)})`;
      this.overlay.style.backgroundPosition = 'center';
      this.overlay.style.backgroundRepeat = 'no-repeat';
      this.overlay.style.backgroundSize = 'cover';
    } catch (error) {
      console.warn('[StartupLoading] Paper background failed; using solid cream.', error);
    }
  }

  private async handOffToBrushReveal(world: ENGINE.World | null): Promise<void> {
    if (!world) {
      this.teardownUi();
      return;
    }
    let reveal = world.getNodes(StartupBrushRevealSystem)[0];
    if (!reveal) {
      reveal = StartupBrushRevealSystem.create();
      world.add(reveal);
    }
    await reveal.playReveal({
      holdMs: STARTUP_REVEAL_HOLD_MS,
      revealMs: STARTUP_REVEAL_MS,
      onCoverReady: () => this.teardownUi(),
    });
  }

  private mountUi(container: HTMLElement): void {
    if (this.overlay) {
      return;
    }

    if (!container.querySelector('#startup-loading-style')) {
      const style = document.createElement('style');
      style.id = 'startup-loading-style';
      style.textContent = [
        '@keyframes startup-begin-pulse {',
        '0%,100% { opacity:0.55; transform:translateX(-50%) scale(0.97); }',
        '50% { opacity:1; transform:translateX(-50%) scale(1.04); }',
        '}',
        '#startup-loading-style-root .startup-begin-prompt {',
        'animation:startup-begin-pulse 1.35s ease-in-out infinite;',
        'will-change:opacity,transform;',
        '}',
        '@media (prefers-reduced-motion: reduce) {',
        '#startup-loading-style-root .startup-begin-prompt { animation:none; opacity:1; }',
        '}',
      ].join('');
      container.appendChild(style);
      this.styleEl = style;
    }

    const overlay = document.createElement('div');
    overlay.id = 'startup-loading-style-root';
    overlay.setAttribute('aria-label', 'Title');
    overlay.style.cssText = [
      'position:absolute',
      'inset:0',
      'z-index:5200',
      `background:${CREAM_CSS}`,
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'gap:28px',
      'pointer-events:auto',
      'font-family:"Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif',
    ].join(';');

    const contentShell = document.createElement('div');
    contentShell.style.cssText = [
      'position:relative',
      'width:100%',
      `height:${Math.ceil(LOADING_TITLE_FONT_PX * 1.15)}px`,
    ].join(';');

    const title = document.createElement('h1');
    title.textContent = '';
    title.style.cssText = [
      'position:absolute',
      'left:50%',
      'top:50%',
      'transform:translate(-50%,-50%)',
      'width:100%',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'margin:0',
      'max-width:min(720px,92vw)',
      `color:${TEXT_CSS}`,
      `font:700 ${LOADING_TITLE_FONT_PX}px/1.15 "Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif`,
      'text-align:center',
      'padding:0 20px',
      'letter-spacing:-0.03em',
      'min-height:1.15em',
    ].join(';');

    const beginPrompt = document.createElement('p');
    beginPrompt.className = 'startup-begin-prompt';
    beginPrompt.textContent = '';
    beginPrompt.style.cssText = [
      'position:absolute',
      'left:50%',
      'top:calc(50% + 62px)',
      'transform:translateX(-50%)',
      'display:none',
      'margin:0',
      `color:${TEXT_CSS}`,
      'font:700 20px/1.3 "Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif',
      'letter-spacing:0.04em',
      'text-align:center',
      'white-space:nowrap',
      'cursor:pointer',
      'user-select:none',
    ].join(';');

    contentShell.appendChild(title);
    contentShell.appendChild(beginPrompt);
    overlay.appendChild(contentShell);
    container.appendChild(overlay);

    this.overlay = overlay;
    this.titleEl = title;
    this.beginPromptEl = beginPrompt;
  }

  private async runTitleSequence(typingGeneration: number): Promise<void> {
    if (!this.titleEl || !this.beginPromptEl) {
      return;
    }

    this.titleEl.textContent = '';
    this.titleEl.style.display = 'flex';
    this.beginPromptEl.textContent = '';
    this.beginPromptEl.style.display = 'none';

    for (let charIndex = 0; charIndex < LOADING_TITLE.length; charIndex += 1) {
      if (typingGeneration !== this.typingGeneration || !this.titleEl) {
        return;
      }
      this.titleEl.textContent = LOADING_TITLE.slice(0, charIndex + 1);
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, TYPEWRITER_CHAR_INTERVAL_MS);
      });
    }
  }

  private showBeginPrompt(): void {
    if (!this.beginPromptEl) {
      return;
    }
    this.beginPromptEl.textContent = BEGIN_PROMPT_TEXT;
    this.beginPromptEl.style.display = 'block';
  }

  /** Wait for a trusted gesture; synthetic clicks cannot unlock browser audio. */
  private waitForBeginGesture(): Promise<void> {
    const overlay = this.overlay;
    if (!overlay) {
      return Promise.resolve();
    }
    const gestureTarget: HTMLDivElement = overlay;
    this.beginGestureCleanup?.();

    return new Promise<void>((resolve) => {
      let finished = false;
      const owner = this;

      function removeListeners(): void {
        gestureTarget.removeEventListener('pointerdown', onGesture);
        window.removeEventListener('keydown', onGesture);
        if (owner.beginGestureCleanup === cancel) {
          owner.beginGestureCleanup = null;
        }
      }

      function finish(): void {
        if (finished) {
          return;
        }
        finished = true;
        removeListeners();
        resolve();
      }

      function onGesture(event: Event): void {
        if (!event.isTrusted) {
          return;
        }
        startGoldenHourAudio(owner.getWorld());
        finish();
      }

      function cancel(): void {
        finish();
      }

      gestureTarget.addEventListener('pointerdown', onGesture);
      window.addEventListener('keydown', onGesture);
      this.beginGestureCleanup = cancel;
    });
  }

  private teardownUi(): void {
    this.typingGeneration += 1;
    this.beginGestureCleanup?.();
    this.beginGestureCleanup = null;
    this.styleEl?.remove();
    this.styleEl = null;
    this.overlay?.remove();
    this.overlay = null;
    this.titleEl = null;
    this.beginPromptEl = null;
  }

  private async waitForContainer(): Promise<HTMLElement | null> {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const container = this.getWorld()?.gameContainer ?? null;
      if (container) {
        return container;
      }
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
    return this.getWorld()?.gameContainer ?? null;
  }
}

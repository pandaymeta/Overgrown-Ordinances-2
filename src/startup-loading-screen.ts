/**
 * Cream startup loading screen: title + stick-figure mailman + letter message, then splash reveal.
 */

import * as ENGINE from '@gnsx/genesys.js';

import { ensureOvergrownAveriaFont } from './overgrown-averia-font.js';
import { waitForIntroPhysicsPrimed } from './intro-physics-gate.js';
import { STARTUP_PRELOAD_ASSETS, STARTUP_WALKER_FRAME_PATHS } from './startup-preload-manifest.js';
import { StartupBrushRevealSystem } from './startup-brush-reveal.js';

const CREAM_CSS = '#f4f1ea';
const TEXT_CSS = '#6b6560';
const LOADING_TITLE = 'Overgrown Ordinances';
const LOADING_MESSAGE = 'One last letter.\nThe mailbox is still open.';
const LOADING_MESSAGE_LINES = LOADING_MESSAGE.split('\n');
const TYPEWRITER_CHAR_INTERVAL_MS = 55;
/** Hold after the title finishes typing, before it disappears. */
const POST_TITLE_HOLD_MS = 3500;
/** Hold after the message finishes typing, before the splash opens. */
const POST_MESSAGE_HOLD_MS = 4500;
const LOADING_TITLE_FONT_PX = 56;
const LOADING_MESSAGE_FONT_PX = 30;
const LOADING_MESSAGE_LINE_HEIGHT = 1.45;
/** Walk cycle length for the SVG frame sequence. */
const WALKER_CYCLE_SEC = 0.8;
const WALKER_STAGE_HEIGHT_PX = 220;
const PRELOAD_CONCURRENCY = 8;
/** Slower cream splash so the open reads clearly after loading. */
const STARTUP_REVEAL_HOLD_MS = 200;
const STARTUP_REVEAL_MS = 1667;

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

async function preloadWalkerFrames(): Promise<string[]> {
  const urls = await Promise.all(STARTUP_WALKER_FRAME_PATHS.map(resolveProjectAssetUrl));
  await Promise.all(urls.map((url) => new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Failed to preload walker frame: ${url}`));
    image.src = url;
  })));
  return urls;
}

/** Flipbook walk cycle from authored SVG frames. */
async function mountWalkerFrameAnimation(container: HTMLElement): Promise<() => void> {
  const urls = await preloadWalkerFrames();
  container.replaceChildren();
  container.style.cssText = 'position:relative;width:100%;height:100%;';

  const images = urls.map((url, index) => {
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.draggable = false;
    image.style.cssText = [
      'position:absolute',
      'inset:0',
      'width:100%',
      'height:100%',
      'object-fit:contain',
      'object-position:center bottom',
      `opacity:${index === 0 ? '1' : '0'}`,
      'pointer-events:none',
      'user-select:none',
    ].join(';');
    container.appendChild(image);
    return image;
  });

  const frameMs = (WALKER_CYCLE_SEC * 1000) / images.length;
  let frame = 0;
  const timer = window.setInterval(() => {
    images[frame].style.opacity = '0';
    frame = (frame + 1) % images.length;
    images[frame].style.opacity = '1';
  }, frameMs);

  return () => {
    window.clearInterval(timer);
    container.replaceChildren();
  };
}

@ENGINE.GameClass()
export class StartupLoadingScreenSystem extends ENGINE.SceneNode {
  private overlay: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private titleEl: HTMLHeadingElement | null = null;
  private messageStage: HTMLDivElement | null = null;
  private messageLineEls: HTMLParagraphElement[] = [];
  private typingGeneration = 0;
  private started = false;
  private sequenceGeneration = 0;
  private earlyPreloadPromise: Promise<void> | null = null;
  private walkerAnimCleanup: (() => void) | null = null;

  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({ name: 'Startup Loading Screen', ...options });
  }

  public override postLoad(): void {
    super.postLoad();
    this.earlyPreloadPromise = this.runEarlyAssetWarmup();
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
    await ensureOvergrownAveriaFont();
    if (generation !== this.sequenceGeneration) {
      return;
    }

    const paths = Array.from(
      new Set([
        ...STARTUP_PRELOAD_ASSETS,
        ...(world ? collectSceneModelUrls(world) : []),
      ]),
    );

    const preloadPromise = (async (): Promise<void> => {
      if (this.earlyPreloadPromise) {
        await this.earlyPreloadPromise;
        this.earlyPreloadPromise = null;
      }
      await preloadPool(paths);
      try {
        await ENGINE.resourceManager.waitForResources(ENGINE.ResourceType.All);
      } catch (error) {
        console.warn('[StartupLoading] waitForResources failed', error);
      }
      await waitForIntroPhysicsPrimed();
    })();

    const copyPromise = (async (): Promise<void> => {
      await this.runLoadingCopySequence(this.typingGeneration);
      if (generation !== this.sequenceGeneration) {
        return;
      }
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, POST_MESSAGE_HOLD_MS);
      });
    })();

    await Promise.all([preloadPromise, copyPromise]);
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
        '#startup-loading-style-root .startup-walker-stage {',
        'will-change:opacity;',
        '}',
        '#startup-loading-style-root .startup-walker-frames img {',
        '-webkit-user-drag:none;',
        '}',
      ].join('');
      container.appendChild(style);
      this.styleEl = style;
    }

    const overlay = document.createElement('div');
    overlay.id = 'startup-loading-style-root';
    overlay.setAttribute('aria-label', 'Loading');
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
    const messageBlockHeight = WALKER_STAGE_HEIGHT_PX
      + 28
      + LOADING_MESSAGE_LINES.length * LOADING_MESSAGE_FONT_PX * LOADING_MESSAGE_LINE_HEIGHT;
    const contentHeight = Math.max(
      Math.ceil(LOADING_TITLE_FONT_PX * 1.15),
      messageBlockHeight,
    );
    contentShell.style.cssText = [
      'position:relative',
      'width:100%',
      `height:${contentHeight}px`,
    ].join(';');

    const centeredStageStyle = [
      'position:absolute',
      'left:50%',
      'top:50%',
      'transform:translate(-50%,-50%)',
      'width:100%',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
    ].join(';');

    const title = document.createElement('h1');
    title.textContent = '';
    title.style.cssText = [
      centeredStageStyle,
      'margin:0',
      'max-width:min(720px,92vw)',
      `color:${TEXT_CSS}`,
      `font:700 ${LOADING_TITLE_FONT_PX}px/1.15 "Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif`,
      'text-align:center',
      'padding:0 20px',
      'letter-spacing:-0.03em',
      'min-height:1.15em',
    ].join(';');

    const messageStage = document.createElement('div');
    messageStage.style.cssText = [
      centeredStageStyle,
      'display:none',
      'gap:28px',
      'max-width:min(520px,86vw)',
    ].join(';');

    const walkerStage = document.createElement('div');
    walkerStage.className = 'startup-walker-stage';
    walkerStage.style.cssText = [
      'width:min(200px,48vw)',
      `height:min(${WALKER_STAGE_HEIGHT_PX}px,52vw)`,
      `flex:0 0 min(${WALKER_STAGE_HEIGHT_PX}px,52vw)`,
      'display:flex',
      'align-items:flex-end',
      'justify-content:center',
    ].join(';');
    const walkerFrames = document.createElement('div');
    walkerFrames.className = 'startup-walker-frames';
    walkerFrames.style.cssText = 'width:100%;height:100%;';
    walkerStage.appendChild(walkerFrames);
    void mountWalkerFrameAnimation(walkerFrames)
      .then((cleanup) => {
        if (!walkerStage.isConnected) {
          cleanup();
          return;
        }
        this.walkerAnimCleanup = cleanup;
      })
      .catch((error) => {
        console.warn('[StartupLoading] Walker frames failed to load', error);
      });

    const messageCopy = document.createElement('div');
    messageCopy.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'gap:0',
      'width:100%',
      `min-height:${LOADING_MESSAGE_LINES.length * LOADING_MESSAGE_FONT_PX * LOADING_MESSAGE_LINE_HEIGHT}px`,
    ].join(';');

    const messageLineEls: HTMLParagraphElement[] = [];
    const lineHeightPx = LOADING_MESSAGE_FONT_PX * LOADING_MESSAGE_LINE_HEIGHT;
    for (let lineIndex = 0; lineIndex < LOADING_MESSAGE_LINES.length; lineIndex += 1) {
      const line = document.createElement('p');
      line.textContent = '';
      line.style.cssText = [
        'margin:0',
        `color:${TEXT_CSS}`,
        `font:700 ${LOADING_MESSAGE_FONT_PX}px/${LOADING_MESSAGE_LINE_HEIGHT} "Overgrown Averia","Segoe UI",sans-serif`,
        'text-align:center',
        'padding:0 16px',
        `min-height:${lineHeightPx}px`,
        'width:100%',
        'box-sizing:border-box',
      ].join(';');
      messageCopy.appendChild(line);
      messageLineEls.push(line);
    }

    messageStage.appendChild(walkerStage);
    messageStage.appendChild(messageCopy);

    contentShell.appendChild(title);
    contentShell.appendChild(messageStage);
    overlay.appendChild(contentShell);
    container.appendChild(overlay);

    this.overlay = overlay;
    this.titleEl = title;
    this.messageStage = messageStage;
    this.messageLineEls = messageLineEls;
  }

  private async runLoadingCopySequence(typingGeneration: number): Promise<void> {
    if (!this.titleEl || !this.messageStage || this.messageLineEls.length === 0) {
      return;
    }

    this.titleEl.textContent = '';
    this.titleEl.style.display = 'flex';
    this.messageStage.style.display = 'none';
    for (const lineEl of this.messageLineEls) {
      lineEl.textContent = '';
    }

    for (let charIndex = 0; charIndex < LOADING_TITLE.length; charIndex += 1) {
      if (typingGeneration !== this.typingGeneration || !this.titleEl) {
        return;
      }
      this.titleEl.textContent = LOADING_TITLE.slice(0, charIndex + 1);
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, TYPEWRITER_CHAR_INTERVAL_MS);
      });
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, POST_TITLE_HOLD_MS);
    });
    if (typingGeneration !== this.typingGeneration || !this.messageStage) {
      return;
    }

    this.titleEl.style.display = 'none';
    this.messageStage.style.display = 'flex';

    for (let lineIndex = 0; lineIndex < LOADING_MESSAGE_LINES.length; lineIndex += 1) {
      const lineText = LOADING_MESSAGE_LINES[lineIndex];
      const lineEl = this.messageLineEls[lineIndex];
      if (!lineEl) {
        continue;
      }
      for (let charIndex = 0; charIndex < lineText.length; charIndex += 1) {
        if (typingGeneration !== this.typingGeneration) {
          return;
        }
        lineEl.textContent = lineText.slice(0, charIndex + 1);
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, TYPEWRITER_CHAR_INTERVAL_MS);
        });
      }
    }
  }

  private teardownUi(): void {
    this.typingGeneration += 1;
    this.walkerAnimCleanup?.();
    this.walkerAnimCleanup = null;
    this.styleEl?.remove();
    this.styleEl = null;
    this.overlay?.remove();
    this.overlay = null;
    this.titleEl = null;
    this.messageStage = null;
    this.messageLineEls = [];
  }

  private async waitForContainer(): Promise<HTMLElement | null> {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const container = this.getWorld()?.gameContainer ?? null;
      if (container) {
        container.style.background = CREAM_CSS;
        return container;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    const fallback = this.getWorld()?.gameContainer ?? null;
    if (fallback) {
      fallback.style.background = CREAM_CSS;
    }
    return fallback;
  }
}

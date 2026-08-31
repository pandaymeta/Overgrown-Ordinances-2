/**
 * Cream startup loading screen: title + letter message, then splash reveal.
 */

import * as ENGINE from '@gnsx/genesys.js';

import { ensureOvergrownAveriaFont } from './overgrown-averia-font.js';
import { waitForIntroPhysicsPrimed } from './intro-physics-gate.js';
import { STARTUP_PRELOAD_ASSETS } from './startup-preload-manifest.js';
import { StartupBrushRevealSystem } from './startup-brush-reveal.js';

const CREAM_CSS = '#f4f1ea';
const TEXT_CSS = '#6b6560';
const LOADING_TITLE = 'Overgrown Ordinances';
const LOADING_MESSAGE = 'One last letter.\nThe mailbox is still open.';
const TYPEWRITER_CHAR_INTERVAL_MS = 55;
const LOADING_MESSAGE_GAP_MS = 1000;
/** Hold after the message finishes typing, before the splash opens. */
const POST_MESSAGE_HOLD_MS = 2500;
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

/** Sketchy closed envelope matching the hand-drawn reference. */
function createHandDrawnLetterSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 160 110');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'width:100%;height:100%;overflow:visible';

  const stroke = {
    fill: 'none',
    stroke: TEXT_CSS,
    'stroke-width': '3.2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };

  const path = (d: string, extra?: Record<string, string>): SVGPathElement => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    el.setAttribute('d', d);
    for (const [key, value] of Object.entries({ ...stroke, ...extra })) {
      el.setAttribute(key, value);
    }
    return el;
  };

  svg.appendChild(path(
    'M 18 22 '
    + 'Q 14 20 22 18 '
    + 'L 138 16 '
    + 'Q 146 17 144 24 '
    + 'L 146 86 '
    + 'Q 146 94 138 93 '
    + 'L 22 95 '
    + 'Q 14 94 16 86 '
    + 'Z',
  ));
  svg.appendChild(path('M 22 22 L 80 62 L 140 20'));
  svg.appendChild(path('M 18 88 L 68 58'));
  svg.appendChild(path('M 142 86 L 92 58'));

  return svg;
}

@ENGINE.GameClass()
export class StartupLoadingScreenSystem extends ENGINE.SceneNode {
  private overlay: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private titleEl: HTMLHeadingElement | null = null;
  private messageStage: HTMLDivElement | null = null;
  private copyEl: HTMLParagraphElement | null = null;
  private typingGeneration = 0;
  private started = false;
  private sequenceGeneration = 0;
  private earlyPreloadPromise: Promise<void> | null = null;

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

    if (!document.getElementById('startup-loading-style')) {
      const style = document.createElement('style');
      style.id = 'startup-loading-style';
      style.textContent = [
        '@keyframes startup-letter-float {',
        '0% { transform: translate(0, 5px) rotate(-4deg) scale(0.98); }',
        '50% { transform: translate(0, -12px) rotate(4deg) scale(1.03); }',
        '100% { transform: translate(0, 5px) rotate(-4deg) scale(0.98); }',
        '}',
        '@keyframes startup-letter-draw {',
        '0% { stroke-dashoffset: 420; opacity: 0.4; }',
        '40% { stroke-dashoffset: 0; opacity: 1; }',
        '70% { stroke-dashoffset: 0; opacity: 1; }',
        '100% { stroke-dashoffset: 420; opacity: 0.4; }',
        '}',
        '#startup-loading-style-root .startup-letter-path {',
        'stroke-dasharray: 420;',
        'animation: startup-letter-draw 2.4s ease-in-out infinite;',
        '}',
        '#startup-loading-style-root .startup-letter-path:nth-child(2) { animation-delay: 0.1s; }',
        '#startup-loading-style-root .startup-letter-path:nth-child(3) { animation-delay: 0.18s; }',
        '#startup-loading-style-root .startup-letter-path:nth-child(4) { animation-delay: 0.26s; }',
      ].join('');
      document.head.appendChild(style);
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

    const title = document.createElement('h1');
    title.textContent = '';
    title.style.cssText = [
      'margin:0',
      'max-width:min(720px,92vw)',
      `color:${TEXT_CSS}`,
      'font:700 56px/1.15 "Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif',
      'text-align:center',
      'padding:0 20px',
      'letter-spacing:-0.03em',
    ].join(';');

    const messageStage = document.createElement('div');
    messageStage.style.cssText = [
      'display:none',
      'flex-direction:column',
      'align-items:center',
      'gap:18px',
      'max-width:min(520px,86vw)',
    ].join(';');

    const letterStage = document.createElement('div');
    letterStage.style.cssText = [
      'width:min(140px,34vw)',
      'height:min(98px,24vw)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'animation:startup-letter-float 2.8s ease-in-out infinite',
    ].join(';');

    const letter = createHandDrawnLetterSvg();
    for (const child of Array.from(letter.children)) {
      if (child instanceof SVGPathElement) {
        child.classList.add('startup-letter-path');
      }
    }
    letterStage.appendChild(letter);

    const copy = document.createElement('p');
    copy.textContent = '';
    copy.style.cssText = [
      'margin:0',
      `color:${TEXT_CSS}`,
      'font:700 30px/1.45 "Overgrown Averia","Segoe UI",sans-serif',
      'text-align:center',
      'white-space:pre-wrap',
      'padding:0 16px',
    ].join(';');

    messageStage.appendChild(letterStage);
    messageStage.appendChild(copy);

    overlay.appendChild(title);
    overlay.appendChild(messageStage);
    container.appendChild(overlay);

    this.overlay = overlay;
    this.titleEl = title;
    this.messageStage = messageStage;
    this.copyEl = copy;
  }

  private async runLoadingCopySequence(typingGeneration: number): Promise<void> {
    if (!this.titleEl || !this.messageStage || !this.copyEl) {
      return;
    }

    this.titleEl.textContent = '';
    this.titleEl.style.display = '';
    this.copyEl.textContent = '';
    this.messageStage.style.display = 'none';

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
      window.setTimeout(resolve, LOADING_MESSAGE_GAP_MS);
    });
    if (typingGeneration !== this.typingGeneration || !this.messageStage || !this.copyEl) {
      return;
    }

    this.titleEl.style.display = 'none';
    this.messageStage.style.display = 'flex';
    this.copyEl.textContent = '';

    for (let charIndex = 0; charIndex < LOADING_MESSAGE.length; charIndex += 1) {
      if (typingGeneration !== this.typingGeneration || !this.copyEl) {
        return;
      }
      this.copyEl.textContent = LOADING_MESSAGE.slice(0, charIndex + 1);
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, TYPEWRITER_CHAR_INTERVAL_MS);
      });
    }
  }

  private teardownUi(): void {
    this.typingGeneration += 1;
    this.overlay?.remove();
    this.overlay = null;
    this.titleEl = null;
    this.messageStage = null;
    this.copyEl = null;
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

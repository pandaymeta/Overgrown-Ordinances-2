/**
 * Cream startup loading screen: hand-drawn letter + progress bar, then splash reveal.
 */

import * as ENGINE from '@gnsx/genesys.js';

import { ensureOvergrownAveriaFont } from './overgrown-averia-font.js';
import { waitForIntroPhysicsPrimed } from './intro-physics-gate.js';
import { STARTUP_PRELOAD_ASSETS } from './startup-preload-manifest.js';
import { StartupBrushRevealSystem } from './startup-brush-reveal.js';

const CREAM_CSS = '#f4f1ea';
const TEXT_CSS = '#6b6560';
const LOADING_MESSAGES = [
  'You\'re playing Overgrown Ordinances...',
  'One last letter. The mailbox is still open.',
] as const;
const TYPEWRITER_CHAR_INTERVAL_MS = 55;
const LOADING_MESSAGE_GAP_MS = 1000;
const MIN_VISIBLE_MS = 1400;
const PRELOAD_CONCURRENCY = 8;
/** Slower cream splash so the open reads clearly after loading. */
const STARTUP_REVEAL_HOLD_MS = 200;
const STARTUP_REVEAL_MS = 1600;

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

async function preloadPool(
  paths: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const total = paths.length;
  let done = 0;
  let next = 0;
  onProgress?.(0, Math.max(1, total));

  if (total === 0) {
    onProgress?.(1, 1);
    return;
  }

  const workers = Array.from({ length: PRELOAD_CONCURRENCY }, async () => {
    while (next < paths.length) {
      const index = next;
      next += 1;
      await preloadOne(paths[index]);
      done += 1;
      onProgress?.(done, total);
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

  // Outer rectangle — slightly wobbly corners
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

  // Top flap V
  svg.appendChild(path('M 22 22 L 80 62 L 140 20'));

  // Lower folds meeting the flap (closed-envelope X)
  svg.appendChild(path('M 18 88 L 68 58'));
  svg.appendChild(path('M 142 86 L 92 58'));

  return svg;
}

@ENGINE.GameClass()
export class StartupLoadingScreenSystem extends ENGINE.SceneNode {
  private overlay: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private progressFill: HTMLDivElement | null = null;
  private progressLabel: HTMLParagraphElement | null = null;
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
    // Consume Studio <link rel="preload"> hints before the browser warns (~3s).
    this.earlyPreloadPromise = this.runEarlyAssetWarmup();
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    void this.startLoadingSequence();
    return true;
  }

  /** Idempotent entry used from GameMode when beginPlay may be skipped. */
  public startLoadingSequence(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    // Cover the world on the same tick if the container already exists.
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

    // Cream cover first — font can load underneath so the world never flashes.
    this.mountUi(container);
    void this.runLoadingCopyTypewriter(this.typingGeneration);
    await ensureOvergrownAveriaFont();
    if (generation !== this.sequenceGeneration) {
      return;
    }

    const startedAt = performance.now();
    const paths = Array.from(
      new Set([
        ...STARTUP_PRELOAD_ASSETS,
        ...(world ? collectSceneModelUrls(world) : []),
      ]),
    );

    if (this.earlyPreloadPromise) {
      await this.earlyPreloadPromise;
      this.earlyPreloadPromise = null;
    }

    // Reserve the last ~12% of the bar for waitForResources + min display time.
    await preloadPool(paths, (done, total) => {
      if (generation !== this.sequenceGeneration) {
        return;
      }
      const preloadShare = total <= 0 ? 0.88 : (done / total) * 0.88;
      this.setProgress(preloadShare);
    });
    if (generation !== this.sequenceGeneration) {
      this.teardownUi();
      return;
    }
    this.setProgress(0.9);

    try {
      await ENGINE.resourceManager.waitForResources(ENGINE.ResourceType.All);
    } catch (error) {
      console.warn('[StartupLoading] waitForResources failed', error);
    }
    if (generation !== this.sequenceGeneration) {
      this.teardownUi();
      return;
    }
    this.setProgress(0.97);

    const remaining = MIN_VISIBLE_MS - (performance.now() - startedAt);
    if (remaining > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
    }
    if (generation !== this.sequenceGeneration) {
      this.teardownUi();
      return;
    }
    this.setProgress(1);

    this.setProgressLabel('Settling in...');
    await waitForIntroPhysicsPrimed();
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
      'gap:22px',
      'pointer-events:auto',
      'font-family:"Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif',
    ].join(';');

    const stage = document.createElement('div');
    stage.style.cssText = [
      'width:min(200px,46vw)',
      'height:min(140px,32vw)',
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
    stage.appendChild(letter);

    const copy = document.createElement('p');
    copy.textContent = '';
    copy.style.cssText = [
      'margin:0',
      'max-width:min(520px,86vw)',
      `color:${TEXT_CSS}`,
      'font:700 22px/1.45 "Overgrown Averia","Segoe UI",sans-serif',
      'text-align:center',
      'padding:0 16px',
    ].join(';');

    const barWrap = document.createElement('div');
    barWrap.style.cssText = [
      'width:min(280px,70vw)',
      'display:flex',
      'flex-direction:column',
      'align-items:stretch',
      'gap:8px',
      'margin-top:4px',
    ].join(';');

    const track = document.createElement('div');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', '0');
    track.style.cssText = [
      'height:10px',
      'border-radius:999px',
      `border:2px solid ${TEXT_CSS}`,
      'background:rgba(107,101,96,0.08)',
      'overflow:hidden',
      'box-sizing:border-box',
    ].join(';');

    const fill = document.createElement('div');
    fill.style.cssText = [
      'height:100%',
      'width:0%',
      `background:${TEXT_CSS}`,
      'border-radius:999px',
      'transition:width 0.18s ease-out',
    ].join(';');
    track.appendChild(fill);

    const label = document.createElement('p');
    label.textContent = 'Loading 0%';
    label.style.cssText = [
      'margin:0',
      `color:${TEXT_CSS}`,
      'font:600 13px/1.2 "Overgrown Averia","Segoe UI",sans-serif',
      'text-align:center',
      'letter-spacing:0.02em',
    ].join(';');

    barWrap.appendChild(track);
    barWrap.appendChild(label);

    overlay.appendChild(stage);
    overlay.appendChild(copy);
    overlay.appendChild(barWrap);
    container.appendChild(overlay);

    this.overlay = overlay;
    this.progressFill = fill;
    this.progressLabel = label;
    this.copyEl = copy;
    this.setProgress(0);
  }

  private async runLoadingCopyTypewriter(typingGeneration: number): Promise<void> {
    if (!this.copyEl) {
      return;
    }
    for (let messageIndex = 0; messageIndex < LOADING_MESSAGES.length; messageIndex += 1) {
      if (typingGeneration !== this.typingGeneration) {
        return;
      }
      const message = LOADING_MESSAGES[messageIndex];
      this.copyEl.textContent = '';
      for (let charIndex = 0; charIndex < message.length; charIndex += 1) {
        if (typingGeneration !== this.typingGeneration || !this.copyEl) {
          return;
        }
        this.copyEl.textContent = message.slice(0, charIndex + 1);
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, TYPEWRITER_CHAR_INTERVAL_MS);
        });
      }
      if (messageIndex < LOADING_MESSAGES.length - 1) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, LOADING_MESSAGE_GAP_MS);
        });
      }
    }
  }

  private setProgress(ratio: number): void {
    const clamped = Math.max(0, Math.min(1, ratio));
    const pct = Math.round(clamped * 100);
    if (this.progressFill) {
      this.progressFill.style.width = `${pct}%`;
    }
    if (this.progressLabel) {
      this.progressLabel.textContent = `Loading ${pct}%`;
    }
    const track = this.progressFill?.parentElement;
    if (track) {
      track.setAttribute('aria-valuenow', String(pct));
    }
  }

  private setProgressLabel(text: string): void {
    if (this.progressLabel) {
      this.progressLabel.textContent = text;
    }
  }

  private teardownUi(): void {
    this.typingGeneration += 1;
    this.overlay?.remove();
    this.overlay = null;
    this.progressFill = null;
    this.progressLabel = null;
    this.copyEl = null;
  }

  private async waitForContainer(): Promise<HTMLElement | null> {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const container = this.getWorld()?.gameContainer ?? null;
      if (container) {
        // Paint cream on the container itself so the 3D canvas cannot flash
        // through before the overlay is mounted.
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

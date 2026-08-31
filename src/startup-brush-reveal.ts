/**
 * Cream splash reveal (startup only):
 * Plays the authored transition as a spritesheet atlas (green keyed → cream).
 * Frame 0 is full cream cover; later frames open to the scene.
 * Next-day / soft-loop day resets use a solid black CSS fade — not this splash.
 */

import * as ENGINE from '@gnsx/genesys.js';

const ATLAS_PATH = '@project/assets/textures/startup-splash/transition-cream-atlas.png';
const FRAME_COUNT = 50;
const ATLAS_COLS = 6;
const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 357;
const VIDEO_DURATION_MS = 1667;
const CREAM_CSS = '#f4f1ea';
/** Default splash open length when callers omit revealMs. */
const DEFAULT_REVEAL_MS = 1600;
const DEFAULT_HOLD_MS = 200;

export type BrushRevealOptions = {
  /** Solid cream hold on frame 0 before the splash opens. */
  holdMs?: number;
  /** Splash open duration (defaults to the source video length). */
  revealMs?: number;
  /** Fired once the fullscreen cream cover is painted (safe to drop other fades). */
  onCoverReady?: () => void;
};

let revealFinished = false;
const revealWaiters: Array<() => void> = [];

/** Lets other startup systems wait until the player can see the game. */
export function waitForStartupBrushReveal(): Promise<void> {
  if (revealFinished) {
    return Promise.resolve();
  }
  return new Promise((resolve) => revealWaiters.push(resolve));
}

function finishReveal(): void {
  if (revealFinished) {
    return;
  }
  revealFinished = true;
  revealWaiters.splice(0).forEach((resolve) => resolve());
}

/**
 * Plays the cream splash (startup path). Not used for next-day / day reset.
 * Resolves when the cream cover has fully opened.
 */
export async function playBrushReveal(
  world: ENGINE.World | null | undefined,
  options?: BrushRevealOptions,
): Promise<void> {
  if (!world) {
    return;
  }
  let system = world.getNodes(StartupBrushRevealSystem)[0];
  if (!system) {
    system = StartupBrushRevealSystem.create();
    world.add(system);
  }
  await system.playReveal(options);
}

async function resolveAssetUrl(logicalPath: string): Promise<string> {
  const resolved = await ENGINE.resolveAssetPathsInText(`"${logicalPath}"`);
  const url = resolved.replace(/^["']|["']$/g, '').trim();
  if (!url || url.includes('@project/') || url.includes('@engine/')) {
    throw new Error(`Unresolved transition asset: ${logicalPath} -> ${resolved}`);
  }
  return url;
}

function sourceSize(source: CanvasImageSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return {
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
    };
  }
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    return { width: source.width, height: source.height };
  }
  if (source instanceof HTMLCanvasElement) {
    return { width: source.width, height: source.height };
  }
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  return { width: FRAME_WIDTH * ATLAS_COLS, height: FRAME_HEIGHT * 6 };
}

/** Startup cream splash atlas from transitionplease.mp4. */
@ENGINE.GameClass()
export class StartupBrushRevealSystem extends ENGINE.SceneNode {
  private overlay: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private animationFrame: number | null = null;
  private running = false;
  private atlas: CanvasImageSource | null = null;
  private atlasObjectUrl: string | null = null;
  private activeHoldMs = DEFAULT_HOLD_MS;
  private activeRevealMs = VIDEO_DURATION_MS;
  private onCoverReady: (() => void) | null = null;
  private playWaiters: Array<() => void> = [];
  private sequenceGeneration = 0;

  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({ name: 'Startup Brush Reveal', ...options });
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    // Startup reveal is started by StartupLoadingScreenSystem after preload.
    return true;
  }

  public startReveal(): void {
    void this.playReveal();
  }

  /** Play (or replay) the cream splash reveal; resolves when finished. */
  public playReveal(options?: BrushRevealOptions): Promise<void> {
    if (this.running || this.overlay) {
      return new Promise((resolve) => this.playWaiters.push(resolve));
    }
    this.activeHoldMs = options?.holdMs ?? DEFAULT_HOLD_MS;
    this.activeRevealMs = options?.revealMs ?? DEFAULT_REVEAL_MS;
    this.onCoverReady = options?.onCoverReady ?? null;
    this.running = true;
    revealFinished = false;
    const done = new Promise<void>((resolve) => this.playWaiters.push(resolve));
    void this.beginRevealSequence(this.sequenceGeneration);
    return done;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this.sequenceGeneration += 1;
    this.running = false;
    this.onCoverReady = null;
    this.removeOverlay(true);
    this.disposeAtlas();
    this.resolvePlayWaiters();
    return true;
  }

  private async beginRevealSequence(generation: number): Promise<void> {
    const container = await this.waitForLaidOutContainer();
    if (generation !== this.sequenceGeneration) {
      return;
    }
    if (!container) {
      console.warn('[StartupBrushReveal] No game container; skipping reveal.');
      this.running = false;
      this.resolvePlayWaiters();
      finishReveal();
      return;
    }
    if (this.overlay) {
      return;
    }

    const overlay = document.createElement('div');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = [
      'position:absolute',
      'inset:0',
      'overflow:hidden',
      'pointer-events:auto',
      'z-index:5000',
      `background:${CREAM_CSS}`,
    ].join(';');

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%;background:transparent';
    overlay.appendChild(canvas);
    container.appendChild(overlay);
    this.overlay = overlay;
    this.canvas = canvas;

    this.resizeAndPaintSolidCream();
    const coverReady = this.onCoverReady;
    this.onCoverReady = null;
    coverReady?.();

    try {
      if (!this.atlas) {
        this.atlas = await this.loadAtlas();
      }
    } catch (error) {
      if (generation !== this.sequenceGeneration) {
        return;
      }
      console.warn('[StartupBrushReveal] Atlas load failed; fading cream out.', error);
      await this.fadeSolidCreamOut();
      this.removeOverlay(true);
      return;
    }

    if (generation !== this.sequenceGeneration || !this.overlay) {
      return;
    }

    overlay.style.background = 'transparent';
    this.paintFrame(0);

    const start = performance.now();
    const holdMs = this.activeHoldMs;
    const revealMs = Math.max(1, this.activeRevealMs);
    const lastIndex = FRAME_COUNT - 1;

    const tick = (now: number): void => {
      if (!this.overlay || !this.canvas) {
        return;
      }
      const elapsed = now - start;
      if (elapsed < holdMs) {
        this.paintFrame(0);
        this.animationFrame = requestAnimationFrame(tick);
        return;
      }

      const raw = Math.min(1, Math.max(0, (elapsed - holdMs) / revealMs));
      const index = Math.min(lastIndex, Math.floor(raw * (lastIndex + 0.999)));
      this.paintFrame(index);

      if (elapsed >= holdMs + revealMs) {
        this.paintFrame(lastIndex);
        this.removeOverlay(true);
        return;
      }
      this.animationFrame = requestAnimationFrame(tick);
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  /**
   * Prefer engine texture loading (same path as trail arrows / materials).
   * Fall back to resolved URL + fetch blob for HTML canvas drawing.
   */
  private async loadAtlas(): Promise<CanvasImageSource> {
    try {
      const texture = await ENGINE.resourceManager.loadTexture(
        ENGINE.AssetPath.fromString(ATLAS_PATH),
      );
      if (texture) {
        const image = texture.image as CanvasImageSource | undefined;
        if (image) {
          const size = sourceSize(image);
          if (size.width >= FRAME_WIDTH && size.height >= FRAME_HEIGHT) {
            return image;
          }
        }
      }
    } catch (error) {
      console.warn('[StartupBrushReveal] loadTexture atlas failed; trying fetch.', error);
    }

    const url = await resolveAssetUrl(ATLAS_PATH);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Atlas fetch failed (${response.status}): ${url}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    this.atlasObjectUrl = objectUrl;
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Atlas image decode failed: ${url}`));
      el.src = objectUrl;
    });
    if (typeof img.decode === 'function') {
      try {
        await img.decode();
      } catch {
        // decode is best-effort
      }
    }
    return img;
  }

  private async fadeSolidCreamOut(): Promise<void> {
    const overlay = this.overlay;
    if (!overlay) {
      return;
    }
    overlay.style.background = CREAM_CSS;
    overlay.style.transition = 'opacity 0.7s ease-out';
    void overlay.offsetWidth;
    overlay.style.opacity = '0';
    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), 720);
    });
  }

  private resizeCanvas(): { width: number; height: number } | null {
    const overlay = this.overlay;
    const canvas = this.canvas;
    if (!overlay || !canvas) {
      return null;
    }
    const rect = overlay.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    const dpr = 1;
    const pixelW = Math.max(1, Math.round(cssW * dpr));
    const pixelH = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    return { width: pixelW, height: pixelH };
  }

  private resizeAndPaintSolidCream(): void {
    const size = this.resizeCanvas();
    const canvas = this.canvas;
    if (!size || !canvas) {
      return;
    }
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = CREAM_CSS;
    ctx.fillRect(0, 0, size.width, size.height);
  }

  private paintFrame(index: number): void {
    const size = this.resizeCanvas();
    const canvas = this.canvas;
    const atlas = this.atlas;
    if (!size || !canvas || !atlas) {
      return;
    }
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      return;
    }

    const col = index % ATLAS_COLS;
    const row = Math.floor(index / ATLAS_COLS);
    const sx = col * FRAME_WIDTH;
    const sy = row * FRAME_HEIGHT;

    // Cover-fit the frame cell into the overlay canvas.
    const scale = Math.max(size.width / FRAME_WIDTH, size.height / FRAME_HEIGHT);
    const dw = FRAME_WIDTH * scale;
    const dh = FRAME_HEIGHT * scale;
    const dx = (size.width - dw) * 0.5;
    const dy = (size.height - dh) * 0.5;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.drawImage(
      atlas,
      sx,
      sy,
      FRAME_WIDTH,
      FRAME_HEIGHT,
      dx,
      dy,
      dw,
      dh,
    );
  }

  private async waitForContainer(): Promise<HTMLElement | null> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const container = this.getWorld()?.gameContainer ?? null;
      if (container) {
        return container;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return this.getWorld()?.gameContainer ?? null;
  }

  private async waitForLaidOutContainer(): Promise<HTMLElement | null> {
    const container = await this.waitForContainer();
    if (!container) {
      return null;
    }
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const rect = container.getBoundingClientRect();
      if (rect.width > 8 && rect.height > 8) {
        return container;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return container;
  }

  private resolvePlayWaiters(): void {
    this.playWaiters.splice(0).forEach((resolve) => resolve());
  }

  private disposeAtlas(): void {
    this.atlas = null;
    if (this.atlasObjectUrl) {
      URL.revokeObjectURL(this.atlasObjectUrl);
      this.atlasObjectUrl = null;
    }
  }

  private removeOverlay(completeReveal: boolean): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.canvas = null;
    this.overlay?.remove();
    this.overlay = null;
    this.running = false;
    this.resolvePlayWaiters();
    if (completeReveal) {
      // Drop startup cream from the container — play / day resets stay black.
      const container = this.getWorld()?.gameContainer;
      if (container) {
        container.style.background = '#000000';
      }
      finishReveal();
    }
  }
}

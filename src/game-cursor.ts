/**
 * In-game mouse cursor: Kenney hand_small_point, cream + HUD text outline.
 */

import * as ENGINE from '@gnsx/genesys.js';

const CURSOR_ASSET = '@project/assets/cursors/hand_small_point.png';
/** Hotspot near the pointing fingertip (32×32 Kenney cursor). */
const HOTSPOT_X = 9;
const HOTSPOT_Y = 5;

async function resolveAssetUrl(logicalPath: string): Promise<string> {
  const resolved = await ENGINE.resolveAssetPathsInText(`"${logicalPath}"`);
  const url = resolved.replace(/^["']|["']$/g, '').trim();
  if (!url || url.includes('@project/') || url.includes('@engine/')) {
    throw new Error(`Unresolved cursor asset: ${logicalPath} -> ${resolved}`);
  }
  return url;
}

@ENGINE.GameClass()
export class GameCursorSystem extends ENGINE.SceneNode {
  private appliedCss: string | null = null;
  private observer: MutationObserver | null = null;

  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({ name: 'Game Cursor', ...options });
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    void this.applyCursor();
    return true;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this.observer?.disconnect();
    this.observer = null;
    this.clearCursor();
    return true;
  }

  private async applyCursor(): Promise<void> {
    const container = this.getWorld()?.gameContainer;
    if (!container) {
      return;
    }
    try {
      const url = await resolveAssetUrl(CURSOR_ASSET);
      this.appliedCss = `url("${url}") ${HOTSPOT_X} ${HOTSPOT_Y}, auto`;
      this.setCursorOn(container);
      this.watchForCanvas(container);
    } catch (error) {
      console.warn('[GameCursor] Failed to apply custom cursor', error);
    }
  }

  private setCursorOn(root: HTMLElement): void {
    if (!this.appliedCss) {
      return;
    }
    root.style.cursor = this.appliedCss;
    const canvas = root.querySelector('canvas');
    if (canvas instanceof HTMLElement) {
      canvas.style.cursor = this.appliedCss;
    }
  }

  private watchForCanvas(container: HTMLElement): void {
    this.observer?.disconnect();
    if (container.querySelector('canvas')) {
      this.setCursorOn(container);
      return;
    }
    this.observer = new MutationObserver(() => {
      if (!container.querySelector('canvas')) {
        return;
      }
      this.setCursorOn(container);
      this.observer?.disconnect();
      this.observer = null;
    });
    this.observer.observe(container, { childList: true, subtree: true });
    requestAnimationFrame(() => this.setCursorOn(container));
  }

  private clearCursor(): void {
    const container = this.getWorld()?.gameContainer;
    if (!container) {
      return;
    }
    container.style.cursor = '';
    const canvas = container.querySelector('canvas');
    if (canvas instanceof HTMLElement) {
      canvas.style.cursor = '';
    }
  }
}

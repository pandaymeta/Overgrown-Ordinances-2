/**
 * Left-side delivery progress HUD (Summer Afternoon style):
 * info tip + broken-ordinance counter, each opening a cream modal panel.
 * At goal/goal, or on an unknown successful delivery, shows Continue Playing / Victory.
 */

import * as ENGINE from '@gnsx/genesys.js';

import {
  DELIVERY_WAY_GOAL,
  FULL_ORDINANCE_GOAL,
  MailDeliveryFlowSystem,
} from './mail-delivery-flow.js';
import { ENVELOPE_PAPER_VOLUME, GameSound, playSound } from './game-audio.js';
import { ensureOvergrownAveriaFont } from './overgrown-averia-font.js';
import { ThirdPersonPlayer } from './player.js';
import { isStartupLoadingFinished } from './startup-loading-screen.js';

const INFO_TITLE = 'Overgrown Rules';
const PLAYTHROUGH_TITLE = 'Disclaimer';
const PLAYTHROUGH_BODY =
  'This Playthrough is made available for the Game Jam. Only watch the video if you wish to know how to unlock the rest of the ordinances.';
const PLAYTHROUGH_WATCH_VIDEO = 'Watch Video';
const PLAYTHROUGH_VIDEO_URL = 'https://youtu.be/ZmUS98D4lng';
const PLAYTHROUGH_ICON_PATH = '@project/assets/ui/playthrough-video-icon.png';
const HUD_BUTTON_ICON_COLOR = '#4a463f';
/** Before the first ordinance — no checklist spoiler. */
const INFO_BODY_EARLY =
  'Just get this letter to the mailbox. The town looks quiet enough.';
/** After the first sign — teach the joke, then the collector goal. */
const INFO_BODY_AFTER =
  `Every new route becomes a new rule overnight. There are at least ${DELIVERY_WAY_GOAL} ways to deliver without breaking an ordinance — how many can you find?`;
const INFO_SIGNATURE = '-Entenium';
const LIST_TITLE = 'Overgrown Ordinances';
const LIST_EMPTY = 'No ordinances broken yet. Keep exploring.';
const COMPLETION_TITLE = 'The town noticed.';
const COMPLETION_BODY =
  'Twelve signs went up overnight. That\'s only half the trouble you can cause. Keep going, or open the letter.';
const FULL_COMPLETION_TITLE = 'Fully overgrown.';
const FULL_COMPLETION_BODY =
  'Twenty-four rules. Twenty-four workarounds. The sidewalks have more warnings than pavement. You earned this. Open the letter.';
const MYSTERY_TITLE = 'No sign for that.';
const MYSTERY_BODY =
  'You found a way the town has no ordinance for. Yet.';
const COMPLETION_CONTINUE = 'Continue Playing';
const COMPLETION_VICTORY = 'Open the letter';
const VICTORY_LETTER_BODY =
  'Dear Mayor,\n\n'
  + 'Your ordinances have overgrown this town.\n'
  + 'Please catch whoever is making you post new ordinances.\n\n'
  + 'Sincerely,\n'
  + 'A concerned citizen';
const FULL_VICTORY_LETTER_BODY =
  'Dear Mayor,\n\n'
  + 'Your ordinances have overgrown this town. I have lost count.\n'
  + 'Please catch whoever is making you post new ordinances.\n\n'
  + 'Sincerely,\n'
  + 'A concerned citizen';
const VICTORY_THANKS_TITLE = 'Thanks for Playing';
const COMPLETION_END_GAME_ACTION = 'End Game';
const VICTORY_ACTION = 'Victory';
const PAUSE_TITLE = 'Game Paused';
const PAUSE_RESPAWN = 'Respawn';
const PAUSE_EXIT = 'Exit';

/** Painterly grit — kept very light so cards stay clean, not muddy. */
const PAPER_GRAIN_PATH = '@project/assets/textures/style/painterly-brush-detail-v1.png';
/** Fine fiber fallback (low contrast). */
const PAPER_FIBER_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.42 0 0 0 0 0.38 0 0 0 0 0.32 0 0 0 0.12 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
/** Axis-aligned back sheet that peeks as the outline. */
const PAPER_BACK = '#6a6560';
/** Cream front sheet (no border). */
const PAPER_CREAM = '#f7f3eb';
/** Shared title / body / signature ink — never darker on headings. */
const PAPER_TEXT = '#6b6560';
/** Back sheet peek under the flat front (right + down). */
const PAPER_BACK_OFFSET_X_PX = 12;
const PAPER_BACK_OFFSET_Y_PX = 11;
/** Resting tilt after open — back sheet stays slightly CW vs flat front (Summer Afternoon). */
const PAPER_BACK_REST_ROTATE_DEG = 2.5;
const PAPER_FONT_FAMILY = '"Overgrown Averia","Segoe UI",sans-serif';
const PAPER_CARD_WIDTH = 'min(600px,92vw)';
const PAPER_CARD_PADDING = '34px 40px 36px';
const PAPER_CARD_LARGE_PADDING = '40px 44px 44px';
const PAPER_TITLE_FONT = `700 36px/1.2 ${PAPER_FONT_FAMILY}`;
const PAPER_BODY_FONT = `700 22px/1.55 ${PAPER_FONT_FAMILY}`;
const PAPER_VICTORY_TITLE_FONT = `700 30px/1.2 ${PAPER_FONT_FAMILY}`;
const PAPER_VICTORY_BODY_FONT = `700 24px/1.55 ${PAPER_FONT_FAMILY}`;
/** Dim scrim behind info / ordinances / choice / letter HUD (not loading). */
const HUD_SCRIM = 'rgba(244,241,234,0.5)';
const HUD_OVERLAY_STYLE_ID = 'overgrown-hud-overlay-anim';
/** Summer Afternoon reference — slow, eased paper stack (~2s+ for sheets). */
const HUD_ANIM_BACKDROP_MS = 700;
const HUD_ANIM_BACKDROP_DELAY_MS = 0;
const HUD_ANIM_BACK_ENTER_MS = 2000;
const HUD_ANIM_BACK_DELAY_MS = 200;
const HUD_ANIM_PANEL_ENTER_MS = 1100;
/** Front sheet follows the back almost immediately — just a brief stagger. */
const HUD_ANIM_PANEL_STAGGER_MS = 90;
const HUD_ANIM_PANEL_DELAY_MS = HUD_ANIM_BACK_DELAY_MS + HUD_ANIM_PANEL_STAGGER_MS;
/** Fade text in soon after the front sheet starts — not after the whole open finishes. */
const HUD_ANIM_CONTENT_DELAY_MS = HUD_ANIM_PANEL_DELAY_MS + 160;
const HUD_ANIM_CONTENT_MS = 320;
const HUD_ANIM_CLOSE_MS = 480;
const HUD_ANIM_EASE_SMOOTH = 'cubic-bezier(0.16, 1, 0.3, 1)';
const HUD_ANIM_EASE_SOFT = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

const HUD_OVERLAY_ANIM_CSS = `
[data-hud-overlay] {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}
[data-hud-backdrop] {
  position: absolute;
  inset: 0;
  background: ${HUD_SCRIM};
  opacity: 0;
}
[data-hud-stack-wrap] {
  position: relative;
  z-index: 1;
  pointer-events: none;
}
[data-hud-stack-wrap] > [data-paper-stack] {
  pointer-events: auto;
}
[data-paper-back],
[data-paper-panel] {
  transform-origin: center center;
}
[data-hud-hover-button] {
  transform-origin: center center;
  transition: transform 150ms ${HUD_ANIM_EASE_SMOOTH};
  will-change: transform;
}
@media (hover: hover) and (pointer: fine) {
  [data-hud-hover-button]:hover:not(:disabled) {
    transform: scale(1.1);
  }
}
[data-hud-hover-button]:active:not(:disabled) {
  transform: scale(0.96);
  transition-duration: 70ms;
}
@media (prefers-reduced-motion: reduce) {
  [data-hud-hover-button] {
    transition-duration: 1ms;
  }
}
`.trim();

/** Summer Afternoon–inspired left HUD + tip / ordinance list panels. */
@ENGINE.GameClass()
export class DeliveryProgressHudSystem extends ENGINE.SceneNode {
  private root: HTMLDivElement | null = null;
  private countLabel: HTMLSpanElement | null = null;
  private infoModal: HTMLDivElement | null = null;
  private playthroughModal: HTMLDivElement | null = null;
  private listModal: HTMLDivElement | null = null;
  private listBody: HTMLDivElement | null = null;
  private choiceModal: HTMLDivElement | null = null;
  private lastCount = -1;
  private completionShown = false;
  private fullCompletionShown = false;
  private mysteryWinShown = false;
  private victoryLetterScreen: HTMLDivElement | null = null;
  private victoryThanksScreen: HTMLDivElement | null = null;
  private pauseModal: HTMLDivElement | null = null;
  private playerMovementFrozenBeforePause = false;
  /** Resolved `url("…")` for the paper grain overlay (or SVG fallback). */
  private paperGrainCssUrl = PAPER_FIBER_SVG;
  private hudAnimStylesMounted = false;

  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({ name: 'Delivery Progress HUD', ...options });
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    void this.mountUi();
    return true;
  }

  public override tickPostPhysics(_deltaTime: number): void {
    super.tickPostPhysics(_deltaTime);
    this.refreshCount();
  }

  /** Escape: close overlays first, then toggle the pause menu. */
  public handleEscapeKey(): boolean {
    if (this.pauseModal) {
      this.onPauseContinue();
      return true;
    }
    if (this.victoryLetterScreen) {
      playSound(this.getWorld(), GameSound.UiClose, 0.6);
      this.closeVictoryLetterScreen(true);
      return true;
    }
    if (this.victoryThanksScreen) {
      this.onVictoryContinuePlaying();
      return true;
    }
    if (this.choiceModal) {
      this.onDismissChoiceModal();
      return true;
    }
    if (this.infoModal || this.playthroughModal || this.listModal) {
      playSound(this.getWorld(), GameSound.UiClose, 0.6);
      this.closeModals(true);
      return true;
    }
    if (!this.canOpenPauseMenu()) {
      return false;
    }
    this.openPauseMenu();
    return true;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this.teardownUi();
    return true;
  }

  private async mountUi(): Promise<void> {
    const container = await this.waitForContainer();
    if (!container || this.root) {
      return;
    }
    await ensureOvergrownAveriaFont();
    await this.resolvePaperGrainUrl();
    this.ensureHudAnimStyles();

    const root = document.createElement('div');
    root.setAttribute('aria-label', 'Delivery progress');
    root.style.cssText = [
      'position:absolute',
      'top:5%',
      'right:3%',
      'left:auto',
      'display:flex',
      'flex-direction:column',
      'gap:10px',
      'z-index:1600',
      'pointer-events:none',
      'font-family:"Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif',
    ].join(';');

    const playthroughBtn = this.createHudButton('');
    playthroughBtn.setAttribute('aria-label', 'Playthrough video');
    playthroughBtn.appendChild(await this.createHudIcon(PLAYTHROUGH_ICON_PATH));
    playthroughBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openPlaythroughModal();
    });

    const infoBtn = this.createHudButton('i');
    infoBtn.setAttribute('aria-label', 'Delivery tip');
    infoBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openInfoModal();
    });

    const countBtn = this.createHudButton(`0/${DELIVERY_WAY_GOAL}`);
    countBtn.setAttribute('aria-label', 'Ordinances broken');
    countBtn.style.background = 'transparent';
    countBtn.style.boxShadow = 'none';
    const countLabel = document.createElement('span');
    countLabel.textContent = `0/${DELIVERY_WAY_GOAL}`;
    countLabel.style.cssText = [
      'color:#f5efe4',
      'font:700 28px/1 "Overgrown Averia","Segoe UI",sans-serif',
      'text-shadow:2px 2px 0 #756f68',
      'letter-spacing:-0.04em',
    ].join(';');
    countBtn.textContent = '';
    countBtn.appendChild(countLabel);
    countBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openListModal();
    });

    root.appendChild(playthroughBtn);
    root.appendChild(infoBtn);
    root.appendChild(countBtn);
    container.appendChild(root);
    this.ensureHudAnimStyles(container);
    this.root = root;
    this.countLabel = countLabel;
    this.refreshCount();
  }

  private async resolvePaperGrainUrl(): Promise<void> {
    try {
      const resolved = await ENGINE.resolveAssetPathsInText(`url("${PAPER_GRAIN_PATH}")`);
      if (resolved.includes('url(') && !resolved.includes(PAPER_GRAIN_PATH)) {
        this.paperGrainCssUrl = resolved;
      }
    } catch {
      this.paperGrainCssUrl = PAPER_FIBER_SVG;
    }
  }

  /**
   * Two-sheet paper: flat cream front, dark back sheet offset right + down.
   * Returns the front face — append titles/body there.
   */
  private createPaperStack(options?: {
    width?: string;
    large?: boolean;
    padding?: string;
  }): { stack: HTMLDivElement; panel: HTMLDivElement } {
    const large = options?.large === true;
    const stack = document.createElement('div');
    stack.setAttribute('data-paper-stack', '');
    stack.style.cssText = [
      'position:relative',
      `width:${options?.width ?? PAPER_CARD_WIDTH}`,
      'pointer-events:auto',
    ].join(';');

    const back = document.createElement('div');
    back.setAttribute('data-paper-back', '');
    back.setAttribute('aria-hidden', 'true');
    back.style.cssText = [
      'position:absolute',
      'inset:0',
      `background:${PAPER_BACK}`,
      'border:none',
      'border-radius:2px',
      'box-shadow:6px 10px 26px rgba(40,36,30,0.16)',
      'z-index:0',
    ].join(';');

    const panel = document.createElement('div');
    panel.setAttribute('data-paper-panel', '');
    panel.style.cssText = [
      'position:relative',
      'z-index:1',
      `padding:${options?.padding ?? PAPER_CARD_PADDING}`,
      `background:${PAPER_CREAM}`,
      'border:none',
      'border-radius:2px',
      'outline:none',
      'box-shadow:none',
    ].join(';');
    this.applyPaperFrontSurface(panel, { large });

    stack.appendChild(back);
    stack.appendChild(panel);
    requestAnimationFrame(() => this.syncPaperBackToFront(stack, panel, back));
    return { stack, panel };
  }

  private syncPaperBackToFront(
    stack: HTMLDivElement,
    panel: HTMLDivElement,
    back: HTMLDivElement,
  ): void {
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    if (width <= 0 || height <= 0) {
      return;
    }
    // Lock the front width — block layout would otherwise stretch it to fill the
    // wider stack and hide the right-side back-sheet peek.
    panel.style.width = `${width}px`;
    panel.style.boxSizing = 'border-box';
    stack.style.width = `${width + PAPER_BACK_OFFSET_X_PX}px`;
    stack.style.paddingBottom = `${PAPER_BACK_OFFSET_Y_PX}px`;
    stack.style.overflow = 'visible';
    back.style.boxSizing = 'border-box';
    back.style.width = `${width}px`;
    back.style.height = `${height}px`;
    back.style.inset = 'auto';
    back.style.left = `${PAPER_BACK_OFFSET_X_PX}px`;
    back.style.top = `${PAPER_BACK_OFFSET_Y_PX}px`;
  }

  /** Cream front only — grain, no outline stroke. */
  private applyPaperFrontSurface(el: HTMLElement, options?: { large?: boolean }): void {
    const large = options?.large === true;
    el.style.overflow = 'hidden';
    el.style.background = PAPER_CREAM;
    el.style.border = 'none';
    el.style.outline = 'none';

    let grain = el.querySelector('[data-paper-grain]') as HTMLDivElement | null;
    if (!grain) {
      grain = document.createElement('div');
      grain.setAttribute('data-paper-grain', '');
      grain.setAttribute('aria-hidden', 'true');
      el.insertBefore(grain, el.firstChild);
    }
    grain.style.cssText = [
      'position:absolute',
      'inset:0',
      'pointer-events:none',
      'z-index:0',
      `background-image:${this.paperGrainCssUrl}`,
      `background-size:${large ? '240px 240px' : '180px 180px'}`,
      'background-repeat:repeat',
      'opacity:0.14',
      'mix-blend-mode:multiply',
    ].join(';');
  }

  /** Keep titles/body/buttons above the absolute grain layer. */
  private finalizePaperContent(el: HTMLElement): void {
    const grain = el.querySelector('[data-paper-grain]');
    Array.from(el.children).forEach((child) => {
      if (child === grain) {
        return;
      }
      const node = child as HTMLElement;
      if (!node.style.position || node.style.position === 'static') {
        node.style.position = 'relative';
      }
      node.style.zIndex = '1';
    });
    const stack = el.parentElement;
    const back = stack?.querySelector('[data-paper-back]') as HTMLDivElement | null;
    if (stack && back) {
      requestAnimationFrame(() => this.syncPaperBackToFront(stack as HTMLDivElement, el as HTMLDivElement, back));
    }
  }

  private createPaperCloseButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-hud-hover-button', '');
    btn.setAttribute('aria-label', 'Close');
    btn.textContent = '×';
    btn.style.cssText = [
      'position:absolute',
      'top:12px',
      'right:20px',
      'width:28px',
      'height:28px',
      'margin:0',
      'padding:0',
      'border:none',
      'border-radius:2px',
      `background:${PAPER_CREAM}`,
      `color:${PAPER_TEXT}`,
      'font:700 18px/1 "Overgrown Averia","Segoe UI",sans-serif',
      'cursor:pointer',
      'z-index:2',
      // Flat face with a small dark sheet peek (same language as the main stack).
      `box-shadow:${PAPER_BACK_OFFSET_X_PX / 2}px ${PAPER_BACK_OFFSET_Y_PX / 2}px 0 ${PAPER_BACK}`,
    ].join(';');
    return btn;
  }

  private createHudButton(label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-hud-hover-button', '');
    btn.textContent = label;
    btn.style.cssText = [
      'width:48px',
      'height:48px',
      'margin:0',
      'padding:0',
      'border:none',
      'border-radius:12px',
      'background:rgba(248,246,240,0.88)',
      'box-shadow:0 2px 10px rgba(0,0,0,0.12)',
      `color:${HUD_BUTTON_ICON_COLOR}`,
      'font:700 28px/1 "Overgrown Averia","Segoe UI",sans-serif',
      'cursor:pointer',
      'pointer-events:auto',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'user-select:none',
    ].join(';');
    return btn;
  }

  private async createHudIcon(assetPath: string): Promise<HTMLSpanElement> {
    let iconUrl = assetPath;
    try {
      const resolved = await ENGINE.resolveAssetPathsInText(`url("${assetPath}")`);
      const match = resolved.match(/url\(["']?([^"')]+)["']?\)/);
      if (match?.[1]) {
        iconUrl = match[1];
      }
    } catch {
      // Fall back to the logical asset path.
    }

    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.style.cssText = [
      'display:block',
      'width:26px',
      'height:26px',
      `background-color:${HUD_BUTTON_ICON_COLOR}`,
      `-webkit-mask:url("${iconUrl}") center/contain no-repeat`,
      `mask:url("${iconUrl}") center/contain no-repeat`,
    ].join(';');
    return icon;
  }

  private openInfoModal(): void {
    if (this.choiceModal || this.pauseModal || this.victoryLetterScreen || this.victoryThanksScreen) {
      return;
    }
    playSound(this.getWorld(), GameSound.UiOpen, 0.6);
    this.closeModals();
    const broken = this.getFlow()?.getBrokenOrdinanceCount() ?? 0;
    const modal = this.createModalShell(INFO_TITLE);
    const body = document.createElement('p');
    body.textContent = broken > 0 ? INFO_BODY_AFTER : INFO_BODY_EARLY;
    body.style.cssText = [
      'margin:18px 0 0',
      `color:${PAPER_TEXT}`,
      `font:${PAPER_BODY_FONT}`,
      'white-space:pre-wrap',
    ].join(';');
    const signature = document.createElement('p');
    signature.textContent = INFO_SIGNATURE;
    signature.style.cssText = [
      'margin:1.7em 0 0',
      `color:${PAPER_TEXT}`,
      `font:${PAPER_BODY_FONT}`,
    ].join(';');
    modal.panel.appendChild(body);
    modal.panel.appendChild(signature);
    this.finalizePaperContent(modal.panel);
    this.attachModal(modal.root);
    this.infoModal = modal.root;
  }

  private openPlaythroughModal(): void {
    if (this.choiceModal || this.pauseModal || this.victoryLetterScreen || this.victoryThanksScreen) {
      return;
    }
    playSound(this.getWorld(), GameSound.UiOpen, 0.6);
    this.closeModals();
    const modal = this.createModalShell(PLAYTHROUGH_TITLE);
    const body = document.createElement('p');
    body.textContent = PLAYTHROUGH_BODY;
    body.style.cssText = [
      'margin:18px 0 0',
      `color:${PAPER_TEXT}`,
      `font:${PAPER_BODY_FONT}`,
      'white-space:pre-wrap',
    ].join(';');
    modal.panel.appendChild(body);

    const actions = document.createElement('div');
    actions.style.cssText = [
      'display:flex',
      'flex-wrap:wrap',
      'gap:12px',
      'margin-top:28px',
      'justify-content:flex-start',
    ].join(';');

    const watchBtn = this.createModalActionButton(PLAYTHROUGH_WATCH_VIDEO, true);
    watchBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      window.open(PLAYTHROUGH_VIDEO_URL, '_blank', 'noopener,noreferrer');
    });
    actions.appendChild(watchBtn);
    modal.panel.appendChild(actions);
    this.finalizePaperContent(modal.panel);
    this.attachModal(modal.root);
    this.playthroughModal = modal.root;
  }

  private openListModal(): void {
    if (this.choiceModal || this.pauseModal || this.victoryLetterScreen || this.victoryThanksScreen) {
      return;
    }
    playSound(this.getWorld(), GameSound.UiOpen, 0.6);
    this.closeModals();
    const modal = this.createModalShell(LIST_TITLE);
    const body = document.createElement('div');
    body.style.cssText = [
      'margin:18px 0 0',
      `color:${PAPER_TEXT}`,
      `font:${PAPER_BODY_FONT}`,
      'max-height:min(52vh,460px)',
      'overflow:auto',
    ].join(';');
    modal.panel.appendChild(body);
    this.listBody = body;
    this.populateOrdinanceList();
    this.finalizePaperContent(modal.panel);
    this.attachModal(modal.root);
    this.listModal = modal.root;
  }

  private populateOrdinanceList(): void {
    if (!this.listBody) {
      return;
    }
    while (this.listBody.firstChild) {
      this.listBody.removeChild(this.listBody.firstChild);
    }
    const titles = this.getFlow()?.getBrokenOrdinanceTitlesInOrder() ?? [];
    if (titles.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = LIST_EMPTY;
      empty.style.margin = '0';
      this.listBody.appendChild(empty);
      return;
    }
    const list = document.createElement('div');
    list.style.cssText = 'margin:0;';
    titles.forEach((title, index) => {
      const item = document.createElement('p');
      item.textContent = `${index + 1}. ${title}`;
      item.style.cssText = 'margin:0 0 8px;';
      list.appendChild(item);
    });
    this.listBody.appendChild(list);
  }

  private playChoiceEnvelopeSound(): void {
    playSound(this.getWorld(), GameSound.EnvelopePaper, ENVELOPE_PAPER_VOLUME);
  }

  private openChoiceModal(title: string, bodyText: string): void {
    if (this.choiceModal || this.pauseModal || this.victoryLetterScreen || this.victoryThanksScreen) {
      return;
    }
    this.closeModals();
    this.getFlow()?.setCompletionInteractionPaused(true);

    const modal = this.createModalShell(title, {
      dismissible: true,
      onDismiss: () => this.onDismissChoiceModal(),
      dismissSound: 'none',
    });
    if (bodyText.length > 0) {
      const body = document.createElement('p');
      body.textContent = bodyText;
      body.style.cssText = [
        'margin:18px 0 0',
        `color:${PAPER_TEXT}`,
        `font:${PAPER_BODY_FONT}`,
      ].join(';');
      modal.panel.appendChild(body);
    }

    const actions = document.createElement('div');
    actions.style.cssText = [
      'display:flex',
      'flex-wrap:wrap',
      'gap:12px',
      'margin-top:28px',
      'justify-content:flex-start',
    ].join(';');

    const continueBtn = this.createModalActionButton(COMPLETION_CONTINUE);
    continueBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onContinuePlaying();
    });

    const victoryBtn = this.createModalActionButton(COMPLETION_VICTORY);
    victoryBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onVictory();
    });

    actions.appendChild(continueBtn);
    actions.appendChild(victoryBtn);
    modal.panel.appendChild(actions);
    this.finalizePaperContent(modal.panel);
    this.attachModal(modal.root);
    this.choiceModal = modal.root;
    this.playChoiceEnvelopeSound();
  }

  private createModalActionButton(label: string, primary = false): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-hud-hover-button', '');
    btn.textContent = label;
    btn.style.cssText = [
      'margin:0',
      'padding:12px 18px',
      'border:none',
      'border-radius:2px',
      primary ? `background:${PAPER_BACK}` : `background:${PAPER_CREAM}`,
      primary ? `color:${PAPER_CREAM}` : `color:${PAPER_TEXT}`,
      'font:700 18px/1.2 "Overgrown Averia","Segoe UI",sans-serif',
      'cursor:pointer',
      'pointer-events:auto',
      primary
        ? 'box-shadow:none'
        : `box-shadow:${PAPER_BACK_OFFSET_X_PX / 2}px ${PAPER_BACK_OFFSET_Y_PX / 2}px 0 ${PAPER_BACK}`,
    ].join(';');
    return btn;
  }

  private onDismissChoiceModal(): void {
    this.dismissChoiceModal(true);
    this.getFlow()?.dismissCompletionOverlay();
  }

  private canOpenPauseMenu(): boolean {
    return isStartupLoadingFinished();
  }

  private openPauseMenu(): void {
    if (this.pauseModal) {
      return;
    }
    playSound(this.getWorld(), GameSound.UiOpen, 0.6);
    this.closeModals();
    const player = this.getPlayer();
    this.playerMovementFrozenBeforePause = player?.isMovementFrozen() ?? false;
    player?.setMovementFrozen(true);
    player?.forceIdlePose();

    const modal = this.createModalShell(PAUSE_TITLE, { dismissible: false });
    const actions = document.createElement('div');
    actions.style.cssText = [
      'display:flex',
      'flex-wrap:wrap',
      'gap:12px',
      'margin-top:28px',
      'justify-content:flex-start',
    ].join(';');

    const continueBtn = this.createModalActionButton(COMPLETION_CONTINUE);
    continueBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onPauseContinue();
    });

    const respawnBtn = this.createModalActionButton(PAUSE_RESPAWN);
    respawnBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onPauseRespawn();
    });

    const exitBtn = this.createModalActionButton(PAUSE_EXIT);
    exitBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onPauseExit();
    });

    actions.appendChild(continueBtn);
    actions.appendChild(respawnBtn);
    actions.appendChild(exitBtn);
    modal.panel.appendChild(actions);
    this.finalizePaperContent(modal.panel);
    this.attachModal(modal.root);
    this.pauseModal = modal.root;
  }

  private closePauseMenu(animated = false): void {
    if (!this.pauseModal) {
      return;
    }
    const overlay = this.pauseModal;
    this.pauseModal = null;
    const player = this.getPlayer();
    if (player) {
      player.setMovementFrozen(this.playerMovementFrozenBeforePause);
    }
    this.removeHudOverlay(overlay, !animated);
  }

  private onPauseContinue(): void {
    playSound(this.getWorld(), GameSound.UiClose, 0.6);
    this.closePauseMenu(true);
  }

  private onPauseRespawn(): void {
    playSound(this.getWorld(), GameSound.UiClose, 0.6);
    this.getFlow()?.respawnPlayerWithoutDayReset();
    this.closePauseMenu(true);
    this.playerMovementFrozenBeforePause = false;
  }

  private onPauseExit(): void {
    playSound(this.getWorld(), GameSound.UiClose, 0.6);
    this.closePauseMenu();
    this.onVictoryExit();
  }

  private onContinuePlaying(): void {
    const flow = this.getFlow();
    const mysteryContinue = flow?.isMysteryDeliveryWinReady() ?? false;
    this.dismissChoiceModal(true);
    this.mysteryWinShown = false;
    if (mysteryContinue) {
      flow?.continueMysteryIntoNextDay();
      return;
    }
    flow?.dismissCompletionOverlay();
  }

  private onVictory(): void {
    this.getFlow()?.setCompletionInteractionPaused(true);
    this.dismissChoiceModal(false);
    this.closeModals(false);
    this.showVictoryEndScreen();
  }

  private showVictoryEndScreen(): void {
    this.showVictoryLetterScreen();
  }

  private showVictoryLetterScreen(): void {
    if (this.victoryLetterScreen || !this.getWorld()?.gameContainer) {
      return;
    }
    const { root: end, stackWrap } = this.createHudOverlayShell(9000, 'Victory letter');

    const { stack, panel: card } = this.createPaperStack({
      large: true,
      padding: PAPER_CARD_LARGE_PADDING,
    });

    const close = this.createPaperCloseButton();
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      playSound(this.getWorld(), GameSound.UiClose, 0.6);
      this.closeVictoryLetterScreen(true);
    });
    card.appendChild(close);

    const body = document.createElement('p');
    const ordinanceCount = this.getFlow()?.getBrokenOrdinanceCount() ?? 0;
    body.textContent = ordinanceCount >= FULL_ORDINANCE_GOAL
      ? FULL_VICTORY_LETTER_BODY
      : VICTORY_LETTER_BODY;
    body.style.cssText = [
      'margin:0',
      'padding-right:36px',
      `color:${PAPER_TEXT}`,
      `font:${PAPER_VICTORY_BODY_FONT}`,
      'white-space:pre-wrap',
    ].join(';');

    card.appendChild(body);
    this.finalizePaperContent(card);
    stackWrap.appendChild(stack);
    this.attachAnimatedOverlay(end);
    this.victoryLetterScreen = end;
  }

  private showVictoryThanksScreen(): void {
    if (this.victoryThanksScreen || !this.getWorld()?.gameContainer) {
      return;
    }
    const { root: end, stackWrap } = this.createHudOverlayShell(9000, 'Victory thanks');

    const { stack, panel: card } = this.createPaperStack({
      large: true,
      padding: PAPER_CARD_LARGE_PADDING,
    });

    const title = document.createElement('h2');
    title.textContent = VICTORY_THANKS_TITLE;
    title.style.cssText = [
      'margin:0',
      `color:${PAPER_TEXT}`,
      `font:${PAPER_VICTORY_TITLE_FONT}`,
    ].join(';');

    const actions = document.createElement('div');
    actions.style.cssText = [
      'display:flex',
      'flex-wrap:wrap',
      'gap:12px',
      'margin-top:28px',
      'justify-content:flex-start',
    ].join(';');

    const continueBtn = this.createModalActionButton(COMPLETION_CONTINUE);
    continueBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onVictoryContinuePlaying();
    });

    const ordinanceCount = this.getFlow()?.getBrokenOrdinanceCount() ?? 0;
    const endActionLabel = ordinanceCount >= FULL_ORDINANCE_GOAL
      ? VICTORY_ACTION
      : COMPLETION_END_GAME_ACTION;
    const exitBtn = this.createModalActionButton(endActionLabel);
    exitBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onVictoryExit();
    });

    actions.appendChild(continueBtn);
    actions.appendChild(exitBtn);
    card.appendChild(title);
    card.appendChild(actions);
    this.finalizePaperContent(card);
    stackWrap.appendChild(stack);
    this.attachAnimatedOverlay(end);
    this.victoryThanksScreen = end;
  }

  private closeVictoryLetterScreen(animated = false, showThanksAfter = true): void {
    const overlay = this.victoryLetterScreen;
    this.victoryLetterScreen = null;
    if (!overlay) {
      return;
    }
    const afterClose = showThanksAfter ? () => this.showVictoryThanksScreen() : undefined;
    if (animated) {
      void this.animateHudOverlayClose(overlay).then(() => {
        overlay.remove();
        afterClose?.();
      });
      return;
    }
    overlay.remove();
    afterClose?.();
  }

  private closeVictoryThanksScreen(animated = false): void {
    const overlay = this.victoryThanksScreen;
    this.victoryThanksScreen = null;
    this.removeHudOverlay(overlay, !animated);
  }

  private onVictoryContinuePlaying(): void {
    this.closeVictoryThanksScreen(true);
    this.getFlow()?.dismissCompletionOverlay();
  }

  private onVictoryExit(): void {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) {
        window.location.replace('about:blank');
      }
    }, 120);
  }

  private createModalShell(
    title: string,
    options?: {
      dismissible?: boolean;
      onDismiss?: () => void;
      /** Choice/completion HUD uses envelope-paper on dismiss via dismissChoiceModal. */
      dismissSound?: 'ui-close' | 'none';
    },
  ): {
    root: HTMLDivElement;
    panel: HTMLDivElement;
  } {
    const dismissible = options?.dismissible !== false;
    const dismiss = options?.onDismiss ?? (() => this.closeModals(true));
    const dismissSound = options?.dismissSound ?? 'ui-close';
    const playDismissSound = (): void => {
      if (dismissSound === 'ui-close') {
        playSound(this.getWorld(), GameSound.UiClose, 0.6);
      }
    };
    const { root, stackWrap } = this.createHudOverlayShell(3200);
    if (dismissible) {
      root.addEventListener('click', () => {
        playDismissSound();
        dismiss();
      });
    }

    const { stack, panel } = this.createPaperStack();
    panel.addEventListener('click', (event) => event.stopPropagation());
    stack.addEventListener('click', (event) => event.stopPropagation());

    const heading = document.createElement('h2');
    heading.textContent = title;
    heading.style.cssText = [
      dismissible ? 'margin:0 36px 0 0' : 'margin:0',
      `color:${PAPER_TEXT}`,
      `font:${PAPER_TITLE_FONT}`,
    ].join(';');
    panel.appendChild(heading);

    if (dismissible) {
      const close = this.createPaperCloseButton();
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        playDismissSound();
        dismiss();
      });
      panel.appendChild(close);
    }

    stackWrap.appendChild(stack);
    this.finalizePaperContent(panel);
    return { root, panel };
  }

  private ensureHudAnimStyles(container?: HTMLElement | null): void {
    if (this.hudAnimStylesMounted || typeof document === 'undefined') {
      return;
    }
    const mountTarget = container ?? this.getWorld()?.gameContainer ?? document.head;
    if (mountTarget.querySelector(`#${HUD_OVERLAY_STYLE_ID}`)) {
      this.hudAnimStylesMounted = true;
      return;
    }
    const style = document.createElement('style');
    style.id = HUD_OVERLAY_STYLE_ID;
    style.textContent = HUD_OVERLAY_ANIM_CSS;
    mountTarget.appendChild(style);
    this.hudAnimStylesMounted = true;
  }

  private createHudOverlayShell(
    zIndex: number,
    ariaLabel?: string,
  ): {
    root: HTMLDivElement;
    backdrop: HTMLDivElement;
    stackWrap: HTMLDivElement;
  } {
    const container = this.getWorld()?.gameContainer ?? null;
    this.ensureHudAnimStyles(container);
    const root = document.createElement('div');
    root.setAttribute('data-hud-overlay', '');
    if (ariaLabel) {
      root.setAttribute('aria-label', ariaLabel);
    }
    root.style.cssText = [
      `z-index:${zIndex}`,
      'font-family:"Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif',
    ].join(';');

    const backdrop = document.createElement('div');
    backdrop.setAttribute('data-hud-backdrop', '');

    const stackWrap = document.createElement('div');
    stackWrap.setAttribute('data-hud-stack-wrap', '');

    root.appendChild(backdrop);
    root.appendChild(stackWrap);
    return { root, backdrop, stackWrap };
  }

  private attachAnimatedOverlay(root: HTMLDivElement): void {
    const container = this.getWorld()?.gameContainer;
    if (!container) {
      return;
    }
    this.ensureHudAnimStyles(container);
    this.prepareHudOverlayForOpen(root);
    container.appendChild(root);
    requestAnimationFrame(() => {
      const stack = root.querySelector('[data-paper-stack]');
      const panel = root.querySelector('[data-paper-panel]');
      const back = root.querySelector('[data-paper-back]');
      if (
        stack instanceof HTMLDivElement
        && panel instanceof HTMLDivElement
        && back instanceof HTMLDivElement
      ) {
        this.syncPaperBackToFront(stack, panel, back);
      }
      requestAnimationFrame(() => this.playHudOverlayOpen(root));
    });
  }

  /** Match reference: dark back alone (CCW), then cream front (CW); back keeps a slight CW tilt. */
  private prepareHudOverlayForOpen(root: HTMLDivElement): void {
    const stackWrap = root.querySelector('[data-hud-stack-wrap]');
    const back = root.querySelector('[data-paper-back]');
    const panel = root.querySelector('[data-paper-panel]');
    if (stackWrap instanceof HTMLElement) {
      stackWrap.style.opacity = '1';
      stackWrap.style.transform = 'none';
    }
    if (back instanceof HTMLElement) {
      back.style.opacity = '0';
      back.style.transform = 'scale(0.62) rotate(-38deg)';
    }
    if (panel instanceof HTMLElement) {
      panel.style.opacity = '0';
      panel.style.transform = 'scale(0.52) rotate(18deg)';
      this.setHudPanelContentOpacity(panel, 0);
    }
  }

  private setHudPanelContentOpacity(panel: HTMLElement | null, opacity: number): void {
    if (!panel) {
      return;
    }
    for (const child of Array.from(panel.children)) {
      if (child instanceof HTMLElement && !child.hasAttribute('data-paper-grain')) {
        child.style.opacity = String(opacity);
      }
    }
  }

  private fadeHudPanelContent(panel: HTMLElement | null, delayMs: number, durationMs: number): void {
    if (!panel) {
      return;
    }
    for (const child of Array.from(panel.children)) {
      if (!(child instanceof HTMLElement) || child.hasAttribute('data-paper-grain')) {
        continue;
      }
      child.style.opacity = '0';
      child.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: durationMs, delay: delayMs, easing: HUD_ANIM_EASE_SOFT, fill: 'forwards' },
      );
    }
  }

  private playHudOverlayOpen(root: HTMLDivElement): void {
    const backdrop = root.querySelector('[data-hud-backdrop]');
    const back = root.querySelector('[data-paper-back]');
    const panel = root.querySelector('[data-paper-panel]');

    if (backdrop instanceof HTMLElement) {
      backdrop.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        {
          duration: HUD_ANIM_BACKDROP_MS,
          delay: HUD_ANIM_BACKDROP_DELAY_MS,
          easing: HUD_ANIM_EASE_SOFT,
          fill: 'forwards',
        },
      );
    }

    if (back instanceof HTMLElement) {
      back.animate(
        [
          { opacity: 0, transform: 'scale(0.62) rotate(-38deg)' },
          { opacity: 0.85, transform: 'scale(0.88) rotate(-22deg)', offset: 0.28 },
          { opacity: 1, transform: 'scale(0.96) rotate(-10deg)', offset: 0.58 },
          { opacity: 1, transform: `scale(1) rotate(${PAPER_BACK_REST_ROTATE_DEG}deg)` },
        ],
        {
          duration: HUD_ANIM_BACK_ENTER_MS,
          delay: HUD_ANIM_BACK_DELAY_MS,
          easing: HUD_ANIM_EASE_SMOOTH,
          fill: 'forwards',
        },
      );
    }

    if (panel instanceof HTMLElement) {
      panel.animate(
        [
          { opacity: 0, transform: 'scale(0.52) rotate(18deg)' },
          { opacity: 0.7, transform: 'scale(0.82) rotate(10deg)', offset: 0.35 },
          { opacity: 1, transform: 'scale(0.96) rotate(3deg)', offset: 0.72 },
          { opacity: 1, transform: 'scale(1) rotate(0deg)' },
        ],
        {
          duration: HUD_ANIM_PANEL_ENTER_MS,
          delay: HUD_ANIM_PANEL_DELAY_MS,
          easing: HUD_ANIM_EASE_SMOOTH,
          fill: 'forwards',
        },
      );
      this.fadeHudPanelContent(panel, HUD_ANIM_CONTENT_DELAY_MS, HUD_ANIM_CONTENT_MS);
    }
  }

  private animateHudOverlayClose(root: HTMLDivElement): Promise<void> {
    const backdrop = root.querySelector('[data-hud-backdrop]');
    const back = root.querySelector('[data-paper-back]');
    const panel = root.querySelector('[data-paper-panel]');
    const animations: Animation[] = [];

    if (panel instanceof HTMLElement) {
      for (const child of Array.from(panel.children)) {
        if (child instanceof HTMLElement && !child.hasAttribute('data-paper-grain')) {
          animations.push(child.animate(
            [{ opacity: 1 }, { opacity: 0 }],
            { duration: 180, easing: HUD_ANIM_EASE_SOFT, fill: 'forwards' },
          ));
        }
      }
      animations.push(panel.animate(
        [
          { opacity: 1, transform: 'scale(1) rotate(0deg)' },
          { opacity: 0, transform: 'scale(0.88) rotate(14deg)' },
        ],
        { duration: 380, delay: 60, easing: HUD_ANIM_EASE_SMOOTH, fill: 'forwards' },
      ));
    }

    if (back instanceof HTMLElement) {
      animations.push(back.animate(
        [
          { opacity: 1, transform: `scale(1) rotate(${PAPER_BACK_REST_ROTATE_DEG}deg)` },
          { opacity: 0, transform: 'scale(0.68) rotate(-34deg)' },
        ],
        { duration: 400, delay: 100, easing: HUD_ANIM_EASE_SMOOTH, fill: 'forwards' },
      ));
    }

    if (backdrop instanceof HTMLElement) {
      animations.push(backdrop.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: HUD_ANIM_CLOSE_MS, delay: 120, easing: HUD_ANIM_EASE_SOFT, fill: 'forwards' },
      ));
    }

    if (animations.length === 0) {
      return Promise.resolve();
    }
    return Promise.all(
      animations.map((animation) => animation.finished.catch(() => undefined)),
    ).then(() => undefined);
  }

  private removeHudOverlay(overlay: HTMLDivElement | null, instant: boolean): void {
    if (!overlay) {
      return;
    }
    if (instant) {
      overlay.remove();
      return;
    }
    void this.animateHudOverlayClose(overlay).then(() => {
      if (overlay.parentElement) {
        overlay.remove();
      }
    });
  }

  private attachModal(root: HTMLDivElement): void {
    this.attachAnimatedOverlay(root);
  }

  private closeModals(animated = false): void {
    this.removeHudOverlay(this.infoModal, !animated);
    this.removeHudOverlay(this.playthroughModal, !animated);
    this.removeHudOverlay(this.listModal, !animated);
    this.infoModal = null;
    this.playthroughModal = null;
    this.listModal = null;
    this.listBody = null;
  }

  private dismissChoiceModal(animated: boolean): void {
    const overlay = this.choiceModal;
    this.choiceModal = null;
    if (overlay) {
      this.playChoiceEnvelopeSound();
    }
    this.removeHudOverlay(overlay, !animated);
  }

  private refreshCount(): void {
    if (!this.countLabel) {
      return;
    }
    const flow = this.getFlow();
    const count = flow?.getBrokenOrdinanceCount() ?? 0;
    if (count !== this.lastCount) {
      this.lastCount = count;
      const goal = count >= DELIVERY_WAY_GOAL ? FULL_ORDINANCE_GOAL : DELIVERY_WAY_GOAL;
      this.countLabel.textContent = `${count}/${goal}`;
      if (this.listModal && this.listBody) {
        this.populateOrdinanceList();
      }
    }

    if (
      !this.mysteryWinShown
      && !this.choiceModal
      && !this.pauseModal
      && !this.victoryLetterScreen
      && !this.victoryThanksScreen
      && flow?.isMysteryDeliveryWinReady()
    ) {
      this.mysteryWinShown = true;
      this.openChoiceModal(MYSTERY_TITLE, MYSTERY_BODY);
      return;
    }

    if (
      !this.fullCompletionShown
      && !this.choiceModal
      && !this.pauseModal
      && !this.victoryLetterScreen
      && !this.victoryThanksScreen
      && count >= FULL_ORDINANCE_GOAL
      && flow?.isAwaitingDelivery()
    ) {
      this.fullCompletionShown = true;
      this.openChoiceModal(FULL_COMPLETION_TITLE, FULL_COMPLETION_BODY);
      return;
    }

    if (
      !this.completionShown
      && !this.choiceModal
      && !this.pauseModal
      && !this.victoryLetterScreen
      && !this.victoryThanksScreen
      && count >= DELIVERY_WAY_GOAL
      && flow?.isAwaitingDelivery()
    ) {
      this.completionShown = true;
      this.openChoiceModal(COMPLETION_TITLE, COMPLETION_BODY);
    }
  }

  private getFlow(): MailDeliveryFlowSystem | null {
    return this.getWorld()?.getNodes(MailDeliveryFlowSystem)[0] ?? null;
  }

  private getPlayer(): ThirdPersonPlayer | null {
    return this.getWorld()?.getNodes(ThirdPersonPlayer)[0] ?? null;
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

  private teardownUi(): void {
    this.closeModals(false);
    this.dismissChoiceModal(false);
    this.closePauseMenu(false);
    this.closeVictoryLetterScreen(false, false);
    this.closeVictoryThanksScreen(false);
    this.root?.remove();
    this.root = null;
    this.countLabel = null;
    this.lastCount = -1;
    this.completionShown = false;
    this.fullCompletionShown = false;
    this.mysteryWinShown = false;
  }
}

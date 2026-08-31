/**
 * Left-side delivery progress HUD (Summer Afternoon style):
 * info tip + broken-ordinance counter, each opening a cream modal panel.
 * At goal/goal, or on an unknown successful delivery, shows Continue Playing / Victory.
 */

import * as ENGINE from '@gnsx/genesys.js';

import {
  DELIVERY_WAY_GOAL,
  MailDeliveryFlowSystem,
} from './mail-delivery-flow.js';
import { GameSound, playSound } from './game-audio.js';
import { ensureOvergrownAveriaFont } from './overgrown-averia-font.js';

const INFO_TITLE = 'Overgrown Rules';
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
const MYSTERY_TITLE = 'No sign for that.';
const MYSTERY_BODY =
  'You found a way the town has no ordinance for. Yet.';
const COMPLETION_CONTINUE = 'Continue Playing';
const COMPLETION_VICTORY = 'Open the letter';
const VICTORY_LETTER_TITLE = 'The letter';
const VICTORY_LETTER_BODY =
  'Too many signs on these streets.\nSomeone should do something.';
const VICTORY_LETTER_FROM = '— A concerned resident';
const VICTORY_PUNCHLINE_PREFIX = 'You created ';
const VICTORY_PUNCHLINE_SUFFIX = ' more.';
const VICTORY_THANKS = 'Thanks for playing.';

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
const PAPER_BACK_OFFSET_X_PX = 8;
const PAPER_BACK_OFFSET_Y_PX = 8;
/** Dim scrim behind info / ordinances / choice / letter HUD (not loading). */
const HUD_SCRIM = 'rgba(244,241,234,0.90)';

/** Summer Afternoon–inspired left HUD + tip / ordinance list panels. */
@ENGINE.GameClass()
export class DeliveryProgressHudSystem extends ENGINE.SceneNode {
  private root: HTMLDivElement | null = null;
  private countLabel: HTMLSpanElement | null = null;
  private infoModal: HTMLDivElement | null = null;
  private listModal: HTMLDivElement | null = null;
  private listBody: HTMLDivElement | null = null;
  private choiceModal: HTMLDivElement | null = null;
  private lastCount = -1;
  private completionShown = false;
  private mysteryWinShown = false;
  private victoryEndScreen: HTMLDivElement | null = null;
  /** Resolved `url("…")` for the paper grain overlay (or SVG fallback). */
  private paperGrainCssUrl = PAPER_FIBER_SVG;

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

    root.appendChild(infoBtn);
    root.appendChild(countBtn);
    container.appendChild(root);
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
    stack.style.cssText = [
      'position:relative',
      `width:${options?.width ?? 'min(540px,90vw)'}`,
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
    panel.style.cssText = [
      'position:relative',
      'z-index:1',
      `padding:${options?.padding ?? '30px 34px 32px'}`,
      `background:${PAPER_CREAM}`,
      'border:none',
      'border-radius:2px',
      'outline:none',
      'box-shadow:none',
      'transform:none',
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
    btn.setAttribute('aria-label', 'Close');
    btn.textContent = '×';
    btn.style.cssText = [
      'position:absolute',
      'top:12px',
      'right:12px',
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
      'transform:none',
    ].join(';');
    return btn;
  }

  private createHudButton(label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
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
      'color:#4a463f',
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

  private openInfoModal(): void {
    if (this.choiceModal || this.victoryEndScreen) {
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
      'font:700 20px/1.55 "Overgrown Averia","Segoe UI",sans-serif',
      'white-space:pre-wrap',
    ].join(';');
    const signature = document.createElement('p');
    signature.textContent = INFO_SIGNATURE;
    signature.style.cssText = [
      'margin:1.7em 0 0',
      `color:${PAPER_TEXT}`,
      'font:700 20px/1.55 "Overgrown Averia","Segoe UI",sans-serif',
    ].join(';');
    modal.panel.appendChild(body);
    modal.panel.appendChild(signature);
    this.finalizePaperContent(modal.panel);
    this.attachModal(modal.root);
    this.infoModal = modal.root;
  }

  private openListModal(): void {
    if (this.choiceModal || this.victoryEndScreen) {
      return;
    }
    playSound(this.getWorld(), GameSound.UiOpen, 0.6);
    this.closeModals();
    const modal = this.createModalShell(LIST_TITLE);
    const body = document.createElement('div');
    body.style.cssText = [
      'margin:18px 0 0',
      `color:${PAPER_TEXT}`,
      'font:700 20px/1.55 "Overgrown Averia","Segoe UI",sans-serif',
      'max-height:min(52vh,420px)',
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

  private openChoiceModal(title: string, bodyText: string): void {
    if (this.choiceModal || this.victoryEndScreen) {
      return;
    }
    this.closeModals();
    this.getFlow()?.setCompletionInteractionPaused(true);

    const modal = this.createModalShell(title, { dismissible: false });
    if (bodyText.length > 0) {
      const body = document.createElement('p');
      body.textContent = bodyText;
      body.style.cssText = [
        'margin:18px 0 0',
        `color:${PAPER_TEXT}`,
        'font:700 20px/1.55 "Overgrown Averia","Segoe UI",sans-serif',
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

    const victoryBtn = this.createModalActionButton(COMPLETION_VICTORY, true);
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
  }

  private createModalActionButton(label: string, primary = false): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
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
        : `box-shadow:${PAPER_BACK_OFFSET_X_PX / 2}px ${PAPER_BACK_OFFSET_Y_PX / 2}px 0 ${PAPER_BACK};transform:none`,
    ].join(';');
    return btn;
  }

  private onContinuePlaying(): void {
    const flow = this.getFlow();
    const mysteryContinue = flow?.isMysteryDeliveryWinReady() ?? false;
    this.choiceModal?.remove();
    this.choiceModal = null;
    this.mysteryWinShown = false;
    if (mysteryContinue) {
      flow?.continueMysteryIntoNextDay();
      return;
    }
    flow?.dismissCompletionOverlay();
  }

  private onVictory(): void {
    playSound(this.getWorld(), GameSound.Victory, 0.9);
    this.getFlow()?.setCompletionInteractionPaused(true);
    this.choiceModal?.remove();
    this.choiceModal = null;
    this.closeModals();
    this.showVictoryEndScreen();
  }

  private showVictoryEndScreen(): void {
    if (this.victoryEndScreen) {
      return;
    }
    const container = this.getWorld()?.gameContainer;
    if (!container) {
      return;
    }
    const createdCount = Math.max(
      this.getFlow()?.getBrokenOrdinanceCount() ?? 0,
      DELIVERY_WAY_GOAL,
    );
    const end = document.createElement('div');
    end.setAttribute('aria-label', 'Victory');
    end.style.cssText = [
      'position:absolute',
      'inset:0',
      'z-index:9000',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      `background:${HUD_SCRIM}`,
      'pointer-events:auto',
      'font-family:"Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif',
    ].join(';');

    const { stack, panel: card } = this.createPaperStack({
      width: 'min(520px,90vw)',
      large: true,
      padding: '36px 40px 40px',
    });

    const title = document.createElement('h2');
    title.textContent = VICTORY_LETTER_TITLE;
    title.style.cssText = [
      'margin:0 0 20px',
      `color:${PAPER_TEXT}`,
      'font:700 28px/1.2 "Overgrown Averia","Segoe UI",sans-serif',
    ].join(';');

    const body = document.createElement('p');
    body.textContent = VICTORY_LETTER_BODY;
    body.style.cssText = [
      'margin:0',
      `color:${PAPER_TEXT}`,
      'font:700 22px/1.55 "Overgrown Averia","Segoe UI",sans-serif',
      'white-space:pre-wrap',
    ].join(';');

    const from = document.createElement('p');
    from.textContent = VICTORY_LETTER_FROM;
    from.style.cssText = [
      'margin:22px 0 0',
      `color:${PAPER_TEXT}`,
      'font:700 20px/1.4 "Overgrown Averia","Segoe UI",sans-serif',
    ].join(';');

    const punchline = document.createElement('p');
    punchline.textContent =
      `${VICTORY_PUNCHLINE_PREFIX}${createdCount}${VICTORY_PUNCHLINE_SUFFIX}`;
    punchline.style.cssText = [
      'margin:36px 0 0',
      `color:${PAPER_TEXT}`,
      'font:700 22px/1.4 "Overgrown Averia","Segoe UI",sans-serif',
    ].join(';');

    const thanks = document.createElement('p');
    thanks.textContent = VICTORY_THANKS;
    thanks.style.cssText = [
      'margin:10px 0 0',
      `color:${PAPER_TEXT}`,
      'font:700 20px/1.4 "Overgrown Averia","Segoe UI",sans-serif',
    ].join(';');

    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(from);
    card.appendChild(punchline);
    card.appendChild(thanks);
    this.finalizePaperContent(card);
    end.appendChild(stack);
    container.appendChild(end);
    this.victoryEndScreen = end;
  }

  private createModalShell(
    title: string,
    options?: { dismissible?: boolean },
  ): {
    root: HTMLDivElement;
    panel: HTMLDivElement;
  } {
    const dismissible = options?.dismissible !== false;
    const root = document.createElement('div');
    root.style.cssText = [
      'position:absolute',
      'inset:0',
      'z-index:3200',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      `background:${HUD_SCRIM}`,
      'pointer-events:auto',
      'font-family:"Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif',
    ].join(';');
    if (dismissible) {
      root.addEventListener('click', () => this.closeModals());
    }

    const { stack, panel } = this.createPaperStack();
    panel.addEventListener('click', (event) => event.stopPropagation());
    stack.addEventListener('click', (event) => event.stopPropagation());

    const heading = document.createElement('h2');
    heading.textContent = title;
    heading.style.cssText = [
      dismissible ? 'margin:0 36px 0 0' : 'margin:0',
      `color:${PAPER_TEXT}`,
      'font:700 32px/1.2 "Overgrown Averia","Segoe UI",sans-serif',
    ].join(';');
    panel.appendChild(heading);

    if (dismissible) {
      const close = this.createPaperCloseButton();
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        playSound(this.getWorld(), GameSound.UiClose, 0.6);
        this.closeModals();
      });
      panel.appendChild(close);
    }

    root.appendChild(stack);
    this.finalizePaperContent(panel);
    return { root, panel };
  }

  private attachModal(root: HTMLDivElement): void {
    const container = this.getWorld()?.gameContainer;
    if (!container) {
      return;
    }
    container.appendChild(root);
  }

  private closeModals(): void {
    this.infoModal?.remove();
    this.listModal?.remove();
    this.infoModal = null;
    this.listModal = null;
    this.listBody = null;
  }

  private refreshCount(): void {
    if (!this.countLabel) {
      return;
    }
    const flow = this.getFlow();
    const count = flow?.getBrokenOrdinanceCount() ?? 0;
    if (count !== this.lastCount) {
      this.lastCount = count;
      this.countLabel.textContent = `${count}/${DELIVERY_WAY_GOAL}`;
      if (this.listModal && this.listBody) {
        this.populateOrdinanceList();
      }
    }

    if (
      !this.mysteryWinShown
      && !this.choiceModal
      && !this.victoryEndScreen
      && flow?.isMysteryDeliveryWinReady()
    ) {
      this.mysteryWinShown = true;
      this.openChoiceModal(MYSTERY_TITLE, MYSTERY_BODY);
      return;
    }

    if (
      !this.completionShown
      && !this.choiceModal
      && !this.victoryEndScreen
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
    this.closeModals();
    this.choiceModal?.remove();
    this.choiceModal = null;
    this.victoryEndScreen?.remove();
    this.victoryEndScreen = null;
    this.root?.remove();
    this.root = null;
    this.countLabel = null;
    this.lastCount = -1;
    this.completionShown = false;
    this.mysteryWinShown = false;
  }
}

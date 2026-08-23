/**
 * Left-side delivery progress HUD (Summer Afternoon style):
 * info tip + broken-ordinance counter, each opening a cream modal panel.
 * At 20/20, or on an unknown successful delivery, shows Continue Playing / Victory.
 */

import * as ENGINE from '@gnsx/genesys.js';

import {
  DELIVERY_WAY_GOAL,
  MailDeliveryFlowSystem,
} from './mail-delivery-flow.js';
import { ensureOvergrownAveriaFont } from './overgrown-averia-font.js';

const INFO_TITLE = 'Overgrown Rules';
const INFO_BODY =
  'There were at least 20 ways you can deliver the letter to mailbox. Let\'s see how many you can find.';
const INFO_SIGNATURE = '-Entenium';
const LIST_TITLE = 'Overgrown Ordinances';
const LIST_EMPTY = 'No ordinances broken yet. Keep exploring.';
const COMPLETION_TITLE = 'Congratulations!';
const COMPLETION_BODY =
  'You just created 20 ordinances. You may still find crazy ways to deliver the letter.';
const MYSTERY_MESSAGE = 'We don\'t know how you deliver it. You won!';
const COMPLETION_CONTINUE = 'Continue Playing';
const COMPLETION_VICTORY = 'Victory';
const VICTORY_THANKS = 'Thanks for playing.';

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

    const countBtn = this.createHudButton('0/20');
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
    this.closeModals();
    const modal = this.createModalShell(INFO_TITLE);
    const body = document.createElement('p');
    body.textContent = INFO_BODY;
    body.style.cssText = [
      'margin:18px 0 0',
      'color:#6b6560',
      'font:700 20px/1.55 "Overgrown Averia","Segoe UI",sans-serif',
      'white-space:pre-wrap',
    ].join(';');
    const signature = document.createElement('p');
    signature.textContent = INFO_SIGNATURE;
    signature.style.cssText = [
      'margin:1.7em 0 0',
      'color:#6b6560',
      'font:700 20px/1.55 "Overgrown Averia","Segoe UI",sans-serif',
    ].join(';');
    modal.panel.appendChild(body);
    modal.panel.appendChild(signature);
    this.attachModal(modal.root);
    this.infoModal = modal.root;
  }

  private openListModal(): void {
    if (this.choiceModal || this.victoryEndScreen) {
      return;
    }
    this.closeModals();
    const modal = this.createModalShell(LIST_TITLE);
    const body = document.createElement('div');
    body.style.cssText = [
      'margin:18px 0 0',
      'color:#6b6560',
      'font:700 20px/1.55 "Overgrown Averia","Segoe UI",sans-serif',
      'max-height:min(52vh,420px)',
      'overflow:auto',
    ].join(';');
    modal.panel.appendChild(body);
    this.listBody = body;
    this.populateOrdinanceList();
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
        'color:#6b6560',
        'font:700 20px/1.55 "Overgrown Averia","Segoe UI",sans-serif',
        'white-space:pre-wrap',
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
      'border:1px solid #c8c2b8',
      'border-radius:10px',
      primary ? 'background:#6b6560' : 'background:transparent',
      primary ? 'color:#f4f1ea' : 'color:#6b6560',
      'font:700 18px/1.2 "Overgrown Averia","Segoe UI",sans-serif',
      'cursor:pointer',
      'pointer-events:auto',
    ].join(';');
    return btn;
  }

  private onContinuePlaying(): void {
    this.choiceModal?.remove();
    this.choiceModal = null;
    this.mysteryWinShown = false;
    this.getFlow()?.continuePlayingAfterCompletion();
  }

  private onVictory(): void {
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
    const end = document.createElement('div');
    end.setAttribute('aria-label', 'Victory');
    end.style.cssText = [
      'position:absolute',
      'inset:0',
      'z-index:9000',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'background:#f4f1ea',
      'pointer-events:auto',
      'font-family:"Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif',
    ].join(';');
    const message = document.createElement('p');
    message.textContent = VICTORY_THANKS;
    message.style.cssText = [
      'margin:0',
      'color:#6b6560',
      'font:700 32px/1.3 "Overgrown Averia","Segoe UI",sans-serif',
      'text-align:center',
      'padding:24px',
    ].join(';');
    end.appendChild(message);
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
      'background:rgba(255,253,248,0.7)',
      'pointer-events:auto',
      'font-family:"Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif',
    ].join(';');
    if (dismissible) {
      root.addEventListener('click', () => this.closeModals());
    }

    const panel = document.createElement('div');
    panel.style.cssText = [
      'position:relative',
      'width:min(540px,90vw)',
      'padding:30px 34px 32px',
      'border-radius:14px',
      'background:#f4f1ea',
      'box-shadow:0 10px 28px rgba(0,0,0,0.18)',
      'pointer-events:auto',
    ].join(';');
    panel.addEventListener('click', (event) => event.stopPropagation());

    const heading = document.createElement('h2');
    heading.textContent = title;
    heading.style.cssText = [
      dismissible ? 'margin:0 36px 0 0' : 'margin:0',
      'color:#6b6560',
      'font:700 32px/1.2 "Overgrown Averia","Segoe UI",sans-serif',
    ].join(';');
    panel.appendChild(heading);

    if (dismissible) {
      const close = document.createElement('button');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      close.textContent = '×';
      close.style.cssText = [
        'position:absolute',
        'top:12px',
        'right:12px',
        'width:28px',
        'height:28px',
        'margin:0',
        'padding:0',
        'border:1px solid #c8c2b8',
        'border-radius:6px',
        'background:transparent',
        'color:#8a847c',
        'font:700 18px/1 "Overgrown Averia","Segoe UI",sans-serif',
        'cursor:pointer',
      ].join(';');
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        this.closeModals();
      });
      panel.appendChild(close);
    }

    root.appendChild(panel);
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
      this.openChoiceModal(MYSTERY_MESSAGE, '');
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

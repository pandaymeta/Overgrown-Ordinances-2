import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { ensureOvergrownAveriaFont } from './overgrown-averia-font.js';
import { ThirdPersonPlayer } from './player.js';

const AXE_NAME = /^Axe$/i;
const INNER_RADIUS = 0.52;
const OUTER_RADIUS = 0.78;
/** Show the pick prompt when the player is within this distance of the axe. */
const PROMPT_RANGE = 3;
/** Extra world lift above the axe AABB top. */
const PROMPT_ABOVE_MODEL = 0.12;
const PROMPT_KEY_SIZE_PX = 42;
const PROMPT_LABEL_SIZE_PX = Math.round(PROMPT_KEY_SIZE_PX / 3);
/** Match tutorial-keys breathe rate. */
const PULSE_HZ = 0.4;
/** Hint pulse after tutorial keys end (or until the axe is picked up). */
const PULSE_HINT_DURATION_SEC = 5;
const PULSE_OPACITY_MIN = 0;
const PULSE_OPACITY_MAX = 1;
const RING_IDLE_OPACITY = 0.9;

/** Red ground guide + screen-space "E / Pick/Drop" prompt for the Axe. */
@ENGINE.GameClass()
export class AxePickupRingSystem extends ENGINE.SceneNode {
  private axe: ENGINE.ModelMeshNode | null = null;
  private player: ThirdPersonPlayer | null = null;
  private ring: ENGINE.MeshNode | null = null;
  /** Kept by reference — Genesys may wrap `.material`, so instanceof checks can miss. */
  private ringMaterial: THREE.MeshBasicMaterial | null = null;
  private promptEl: HTMLDivElement | null = null;
  /** True while the axe is currently held this day. */
  private pickedUp = false;
  /** Once true for the play session, next-day resets never show the ring again. */
  private everPickedUp = false;
  /** Day-0 hides the ring; unlocked after the first next-day reset / axe hint. */
  private guideUnlocked = false;
  private pulseRemaining = 0;
  private pulseElapsed = 0;
  private readonly axeBounds = new THREE.Box3();
  private readonly axeAnchor = new THREE.Vector3();
  private readonly playerWorldPos = new THREE.Vector3();
  private readonly screenPos = new THREE.Vector3();

  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({
      name: 'Axe Pickup Ring',
      ...options,
    });
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: RING_IDLE_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring = ENGINE.MeshNode.create({
      name: 'Axe Pickup Ring Visual',
      geometry: new THREE.RingGeometry(INNER_RADIUS, OUTER_RADIUS, 40),
      material: this.ringMaterial,
      castShadow: false,
      receiveShadow: false,
      physicsOptions: { enabled: false },
    });
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 850;
    this.add(this.ring);
  }

  public override postLoad(): void {
    super.postLoad();
    const world = this.getWorld();
    if (world) {
      this.initializePreview(world);
    }
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    this.applyVisualStyle();
    const world = this.getWorld();
    if (world) {
      this.pickedUp = false;
      this.everPickedUp = false;
      this.guideUnlocked = false;
      this.pulseRemaining = 0;
      this.pulseElapsed = 0;
      this.initializePreview(world);
      this.player = world.getNodes(ThirdPersonPlayer)[0] ?? null;
      this.ensurePromptUi(world);
      // Day one: no ground ring — unlock after the first next day.
      if (this.ring) {
        this.ring.visible = false;
      }
    }
    return true;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    // Restore the preview ring when returning to editor mode.
    this.pickedUp = false;
    this.everPickedUp = false;
    this.guideUnlocked = false;
    this.pulseRemaining = 0;
    this.pulseElapsed = 0;
    this.player = null;
    if (this.ring) {
      this.ring.visible = true;
      this.setRingOpacity(RING_IDLE_OPACITY);
    }
    this.destroyPromptUi();
    return true;
  }

  public override tickPostPhysics(deltaTime: number): void {
    super.tickPostPhysics(deltaTime);
    if (this.player?.isMovementFrozen()) {
      this.hidePrompt();
    } else {
      this.updatePrompt();
    }
    this.updatePulse(deltaTime);
    if (this.pickedUp || !this.ring || !this.axe) {
      return;
    }
    const world = this.getWorld();
    this.player ??= world?.getNodes(ThirdPersonPlayer)[0] ?? null;
    if (this.player?.isHoldingTool(this.axe)) {
      this.markAxePickedUp();
    }
  }

  /** True after the axe has been equipped at least once this play session. */
  public hasEverPickedUp(): boolean {
    return this.everPickedUp;
  }

  /**
   * Tutorial-keys-style opacity pulse for {@link PULSE_HINT_DURATION_SEC},
   * or until the axe is picked up.
   */
  public playHint(): void {
    if (this.everPickedUp || !this.ring) {
      return;
    }
    this.guideUnlocked = true;
    const world = this.getWorld();
    if (world) {
      this.initializePreview(world);
    }
    this.ring.visible = true;
    this.ring.scale.setScalar(1);
    this.pulseElapsed = 0;
    this.pulseRemaining = PULSE_HINT_DURATION_SEC;
    this.setRingOpacity(PULSE_OPACITY_MIN);
  }

  /** Show the ring again at the axe after a next-day reset (axe is put back). */
  public resetForNewDay(): void {
    this.pickedUp = false;
    this.pulseRemaining = 0;
    this.pulseElapsed = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    this.axe = null;
    this.player = world.getNodes(ThirdPersonPlayer)[0] ?? null;
    this.hidePrompt();
    this.ensurePromptUi(world);
    if (this.everPickedUp) {
      // First pickup already happened — never guide the axe again.
      if (this.ring) {
        this.ring.visible = false;
      }
      return;
    }
    this.initializePreview(world);
    if (this.ring) {
      // Stay hidden until the axe-speech morning calls playHint().
      this.ring.visible = this.guideUnlocked;
      this.ring.scale.setScalar(1);
      this.setRingOpacity(RING_IDLE_OPACITY);
    }
  }

  private markAxePickedUp(): void {
    this.pickedUp = true;
    this.everPickedUp = true;
    this.pulseRemaining = 0;
    this.pulseElapsed = 0;
    this.destroyRing();
  }

  private updatePulse(deltaTime: number): void {
    if (this.pulseRemaining <= 0 || !this.ring) {
      return;
    }
    this.pulseRemaining = Math.max(0, this.pulseRemaining - deltaTime);
    this.pulseElapsed += deltaTime;
    // Transparent → opaque → transparent (same envelope as tutorial keys).
    const wave = 0.5 - 0.5 * Math.cos(this.pulseElapsed * Math.PI * 2 * PULSE_HZ);
    this.setRingOpacity(
      PULSE_OPACITY_MIN + wave * (PULSE_OPACITY_MAX - PULSE_OPACITY_MIN),
    );
    // Slight scale breathe so the pulse reads even if opacity writes are muted.
    const scale = 0.92 + wave * 0.2;
    this.ring.scale.setScalar(scale);
    if (this.pulseRemaining <= 0 && !this.everPickedUp) {
      this.setRingOpacity(RING_IDLE_OPACITY);
      this.ring.scale.setScalar(1);
    }
  }

  private setRingOpacity(opacity: number): void {
    const apply = (material: THREE.Material | THREE.Material[] | null | undefined): void => {
      if (!material) {
        return;
      }
      const list = Array.isArray(material) ? material : [material];
      for (const entry of list) {
        if (!entry || typeof entry.opacity !== 'number') {
          continue;
        }
        entry.transparent = true;
        entry.opacity = opacity;
        entry.needsUpdate = true;
      }
    };

    if (this.ringMaterial) {
      this.ringMaterial.transparent = true;
      this.ringMaterial.opacity = opacity;
      this.ringMaterial.needsUpdate = true;
    }
    apply(this.ring?.material as THREE.Material | THREE.Material[] | undefined);
    this.ring?.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        apply(mesh.material);
      }
    });
  }

  private applyVisualStyle(): void {
    if (!this.ring) {
      return;
    }
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: RING_IDLE_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring.geometry = new THREE.RingGeometry(INNER_RADIUS, OUTER_RADIUS, 40);
    this.ring.material = this.ringMaterial;
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 850;
    this.ring.scale.setScalar(1);
  }

  private ensurePromptUi(world: ENGINE.World): void {
    if (this.promptEl) {
      return;
    }
    const container = world.gameContainer;
    if (!container) {
      return;
    }
    void ensureOvergrownAveriaFont();

    const root = document.createElement('div');
    root.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'transform:translate(-50%, -100%)',
      'display:none',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'gap:0',
      'margin:0',
      'padding:0',
      'border:none',
      'background:transparent',
      'box-shadow:none',
      'pointer-events:none',
      'z-index:1001',
      'line-height:1',
      'text-align:center',
      'white-space:nowrap',
      'user-select:none',
      'font-family:"Overgrown Averia", Georgia, serif',
      'color:#fff8e7',
      '-webkit-text-stroke:0',
      'text-shadow:none',
    ].join(';');

    const key = document.createElement('div');
    key.textContent = 'E';
    key.style.cssText = [
      'margin:0',
      'padding:0',
      'border:none',
      'background:transparent',
      `font-size:${PROMPT_KEY_SIZE_PX}px`,
      'font-weight:700',
      'line-height:1',
      'color:#fff8e7',
      '-webkit-text-stroke:0',
      'text-shadow:none',
    ].join(';');

    const label = document.createElement('div');
    label.textContent = 'Pick/Drop';
    label.style.cssText = [
      'margin:0',
      'padding:0',
      'border:none',
      'background:transparent',
      `font-size:${PROMPT_LABEL_SIZE_PX}px`,
      'font-weight:700',
      'line-height:1.1',
      'letter-spacing:0.02em',
      'color:#fff8e7',
      '-webkit-text-stroke:0',
      'text-shadow:none',
    ].join(';');

    root.append(key, label);
    container.appendChild(root);
    this.promptEl = root;
  }

  private destroyPromptUi(): void {
    this.promptEl?.remove();
    this.promptEl = null;
  }

  private hidePrompt(): void {
    if (this.promptEl) {
      this.promptEl.style.display = 'none';
    }
  }

  private updatePrompt(): void {
    const world = this.getWorld();
    if (!world) {
      this.hidePrompt();
      return;
    }
    this.ensurePromptUi(world);
    const prompt = this.promptEl;
    if (!prompt) {
      return;
    }

    this.axe ??= world.getNodes(ENGINE.ModelMeshNode).find(
      (node) => AXE_NAME.test(node.name ?? ''),
    ) ?? null;
    this.player ??= world.getNodes(ThirdPersonPlayer)[0] ?? null;
    const axe = this.axe;
    const player = this.player;
    if (!axe || !player || !axe.visible) {
      this.hidePrompt();
      return;
    }
    // Hide while equipped; show again after drop when in range.
    if (player.isHoldingTool(axe)) {
      this.hidePrompt();
      return;
    }

    this.axeBounds.setFromObject(axe);
    if (this.axeBounds.isEmpty()) {
      axe.getWorldPosition(this.axeAnchor);
    } else {
      this.axeBounds.getCenter(this.axeAnchor);
      // Sit just above the mesh top, still horizontally centered on the model.
      this.axeAnchor.y = this.axeBounds.max.y + PROMPT_ABOVE_MODEL;
    }

    player.getWorldPosition(this.playerWorldPos);
    if (this.axeAnchor.distanceTo(this.playerWorldPos) > PROMPT_RANGE) {
      this.hidePrompt();
      return;
    }

    const camera = player.getGameplayCamera();
    const container = world.gameContainer;
    if (!camera || !container) {
      this.hidePrompt();
      return;
    }

    camera.updateMatrixWorld(true);
    this.screenPos.copy(this.axeAnchor).project(camera);
    if (this.screenPos.z < -1 || this.screenPos.z > 1) {
      this.hidePrompt();
      return;
    }

    const x = (this.screenPos.x * 0.5 + 0.5) * container.clientWidth;
    const y = (-this.screenPos.y * 0.5 + 0.5) * container.clientHeight;
    prompt.style.display = 'flex';
    prompt.style.left = `${x}px`;
    prompt.style.top = `${y}px`;
  }

  private initializePreview(world: ENGINE.World): void {
    this.axe ??= world.getNodes(ENGINE.ModelMeshNode).find(
      (node) => AXE_NAME.test(node.name ?? ''),
    ) ?? null;
    if (this.axe && !this.pickedUp && !this.everPickedUp && this.guideUnlocked && this.ring) {
      // The authored scene transform keeps this ring flush with the pavement.
      this.ring.visible = true;
    }
  }

  private destroyRing(): void {
    if (this.ring) {
      this.ring.visible = false;
    }
  }
}

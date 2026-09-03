import * as ENGINE from '@gnsx/genesys.js';

import { DeliveryProgressHudSystem } from './delivery-progress-hud.js';

interface CarryPawn {
  toggleCarry(): boolean;
  handleCarryPrimaryAction(): boolean;
  handleTouchWorldPress(): boolean;
  handleTouchWorldRelease(): boolean;
  isTouchThrowAiming(): boolean;
  rotateCameraFromTouch(deltaX: number): void;
  zoomCameraFromTouch(deltaDistance: number): void;
  setCarryAimCursor(event: MouseEvent): void;
  setCarryAimScreenPoint(clientX: number, clientY: number): void;
}

type WorldTouchPoint = {
  x: number;
  y: number;
  startX: number;
  startY: number;
};

type WorldTouchMode = 'aim' | 'orbit' | 'action';

function isCarryPawn(value: unknown): value is CarryPawn {
  return value !== null
    && typeof value === 'object'
    && 'toggleCarry' in value
    && typeof (value as CarryPawn).toggleCarry === 'function'
    && 'handleCarryPrimaryAction' in value
    && typeof (value as CarryPawn).handleCarryPrimaryAction === 'function'
    && 'handleTouchWorldPress' in value
    && typeof (value as CarryPawn).handleTouchWorldPress === 'function'
    && 'handleTouchWorldRelease' in value
    && typeof (value as CarryPawn).handleTouchWorldRelease === 'function'
    && 'isTouchThrowAiming' in value
    && typeof (value as CarryPawn).isTouchThrowAiming === 'function'
    && 'rotateCameraFromTouch' in value
    && typeof (value as CarryPawn).rotateCameraFromTouch === 'function'
    && 'zoomCameraFromTouch' in value
    && typeof (value as CarryPawn).zoomCameraFromTouch === 'function'
    && 'setCarryAimCursor' in value
    && typeof (value as CarryPawn).setCarryAimCursor === 'function'
    && 'setCarryAimScreenPoint' in value
    && typeof (value as CarryPawn).setCarryAimScreenPoint === 'function';
}

/** Explicit input route for crate pickup/drop and throwing. */
@ENGINE.GameClass()
export class CarryPlayerController extends ENGINE.DefaultPlayerController {
  private static readonly TOUCH_DRAG_THRESHOLD_SQ = 8 * 8;

  private touchInputAbortController: AbortController | null = null;
  private touchInputCanvas: HTMLCanvasElement | null = null;
  private previousCanvasTouchAction = '';
  private readonly worldTouches = new Map<number, WorldTouchPoint>();
  private activeWorldTouchId: number | null = null;
  private worldTouchMode: WorldTouchMode = 'orbit';
  private worldTouchDragged = false;
  private worldTouchPinched = false;
  private pinchDistance: number | null = null;
  private touchPressConsumed = false;

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    this.bindWorldTouchInput();
    return true;
  }

  public override endPlay(): boolean {
    this.unbindWorldTouchInput();
    return super.endPlay();
  }

  public override handleKeyDown(event: KeyboardEvent): boolean {
    if (event.code === 'KeyE' && isCarryPawn(this.pawn)) {
      if (event.repeat) return true;
      if (this.pawn.toggleCarry()) return true;
    }
    if (event.code === 'Escape') {
      if (event.repeat) {
        return true;
      }
      const world = this.pawn instanceof ENGINE.SceneNode ? this.pawn.getWorld() : null;
      const hud = world?.getNodes(DeliveryProgressHudSystem)[0];
      if (hud?.handleEscapeKey()) {
        return true;
      }
    }
    return super.handleKeyDown(event);
  }

  public override handleMouseMove(event: MouseEvent): boolean {
    if (isCarryPawn(this.pawn)) {
      this.pawn.setCarryAimCursor(event);
    }
    return super.handleMouseMove(event);
  }

  public override handleMouseDown(button: ENGINE.MouseButton, event: MouseEvent): boolean {
    if (button === ENGINE.MouseButton.Right) {
      event.preventDefault();
    }
    if (button === ENGINE.MouseButton.Left && isCarryPawn(this.pawn)) {
      this.pawn.setCarryAimCursor(event);
      if (this.pawn.handleCarryPrimaryAction()) {
        event.preventDefault();
        return true;
      }
    }
    return super.handleMouseDown(button, event);
  }

  public override handleVirtualJoystick(
    index: ENGINE.VirtualJoystickIndex,
    joystickData: ENGINE.VirtualJoystickData,
  ): boolean {
    if (index === ENGINE.VirtualJoystickIndex.Right) {
      if (joystickData.type === 'start' && this.pawn instanceof ENGINE.MovementPawn) {
        this.pawn.jump();
      }
      // The right control is a jump button only. Do not forward its movement to
      // DefaultPlayerController, which would convert it into look input.
      return true;
    }

    return super.handleVirtualJoystick(index, joystickData);
  }

  private bindWorldTouchInput(): void {
    this.unbindWorldTouchInput();
    const canvas = this.getWorld()?.gameContainer?.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }

    const abortController = new AbortController();
    const options: AddEventListenerOptions = {
      passive: false,
      signal: abortController.signal,
    };
    canvas.addEventListener('pointerdown', this.handleWorldPointerDown, options);
    canvas.addEventListener('pointermove', this.handleWorldPointerMove, options);
    canvas.addEventListener('pointerup', this.handleWorldPointerUp, options);
    canvas.addEventListener('pointercancel', this.handleWorldPointerCancel, options);
    this.previousCanvasTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';
    this.touchInputAbortController = abortController;
    this.touchInputCanvas = canvas;
  }

  private unbindWorldTouchInput(): void {
    this.touchInputAbortController?.abort();
    if (this.touchInputCanvas) {
      this.touchInputCanvas.style.touchAction = this.previousCanvasTouchAction;
    }
    this.touchInputAbortController = null;
    this.touchInputCanvas = null;
    this.previousCanvasTouchAction = '';
    this.worldTouches.clear();
    this.activeWorldTouchId = null;
    this.worldTouchMode = 'orbit';
    this.worldTouchDragged = false;
    this.worldTouchPinched = false;
    this.pinchDistance = null;
    this.touchPressConsumed = false;
  }

  private readonly handleWorldPointerDown = (event: PointerEvent): void => {
    if (
      event.pointerType !== 'touch'
      || !isCarryPawn(this.pawn)
    ) {
      return;
    }

    this.worldTouches.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
    });
    this.touchInputCanvas?.setPointerCapture(event.pointerId);

    if (this.activeWorldTouchId === null) {
      this.activeWorldTouchId = event.pointerId;
      this.worldTouchDragged = false;
      this.worldTouchPinched = false;
      this.pinchDistance = null;
      this.pawn.setCarryAimScreenPoint(event.clientX, event.clientY);
      this.touchPressConsumed = this.pawn.handleTouchWorldPress();
      this.worldTouchMode = this.touchPressConsumed
        ? 'action'
        : (this.pawn.isTouchThrowAiming() ? 'aim' : 'orbit');
    } else if (this.worldTouches.size === 2) {
      this.worldTouchPinched = true;
      this.pinchDistance = this.getCurrentPinchDistance();
    }
    event.preventDefault();
  };

  private readonly handleWorldPointerMove = (event: PointerEvent): void => {
    const point = this.worldTouches.get(event.pointerId);
    if (!point || !isCarryPawn(this.pawn)) {
      return;
    }

    const deltaX = event.clientX - point.x;
    point.x = event.clientX;
    point.y = event.clientY;

    if (this.worldTouches.size >= 2) {
      const distance = this.getCurrentPinchDistance();
      if (distance !== null && this.pinchDistance !== null) {
        this.pawn.zoomCameraFromTouch(distance - this.pinchDistance);
      }
      this.pinchDistance = distance;
      event.preventDefault();
      return;
    }

    if (event.pointerId !== this.activeWorldTouchId) {
      return;
    }

    this.pawn.setCarryAimScreenPoint(event.clientX, event.clientY);
    const totalX = event.clientX - point.startX;
    const totalY = event.clientY - point.startY;
    if (totalX * totalX + totalY * totalY >= CarryPlayerController.TOUCH_DRAG_THRESHOLD_SQ) {
      this.worldTouchDragged = true;
    }
    if (this.worldTouchMode === 'orbit' && this.worldTouchDragged) {
      this.pawn.rotateCameraFromTouch(deltaX);
    }
    event.preventDefault();
  };

  private readonly handleWorldPointerUp = (event: PointerEvent): void => {
    if (!this.worldTouches.has(event.pointerId)) {
      return;
    }

    const wasPrimary = event.pointerId === this.activeWorldTouchId;
    const wasMultiTouch = this.worldTouches.size >= 2;
    if (wasPrimary && !wasMultiTouch && isCarryPawn(this.pawn)) {
      // Apply the release coordinate before throwing so the projectile follows
      // the finger all the way through the final touch sample.
      this.pawn.setCarryAimScreenPoint(event.clientX, event.clientY);
      if (
        !this.touchPressConsumed
        && !this.worldTouchPinched
        && (this.worldTouchMode === 'aim' || !this.worldTouchDragged)
      ) {
        this.pawn.handleTouchWorldRelease();
      }
    }
    this.releaseWorldTouch(event.pointerId);
    event.preventDefault();
  };

  private readonly handleWorldPointerCancel = (event: PointerEvent): void => {
    if (!this.worldTouches.has(event.pointerId)) {
      return;
    }
    this.releaseWorldTouch(event.pointerId);
  };

  private releaseWorldTouch(pointerId: number): void {
    if (this.touchInputCanvas?.hasPointerCapture(pointerId)) {
      this.touchInputCanvas.releasePointerCapture(pointerId);
    }
    this.worldTouches.delete(pointerId);
    this.pinchDistance = this.getCurrentPinchDistance();

    if (pointerId === this.activeWorldTouchId) {
      const remaining = this.worldTouches.entries().next().value as [number, WorldTouchPoint] | undefined;
      this.activeWorldTouchId = remaining?.[0] ?? null;
      if (remaining && isCarryPawn(this.pawn)) {
        const point = remaining[1];
        point.startX = point.x;
        point.startY = point.y;
        this.worldTouchMode = this.pawn.isTouchThrowAiming() ? 'aim' : 'orbit';
      }
    }

    if (this.worldTouches.size === 0) {
      this.activeWorldTouchId = null;
      this.worldTouchMode = 'orbit';
      this.worldTouchDragged = false;
      this.worldTouchPinched = false;
      this.pinchDistance = null;
      this.touchPressConsumed = false;
    }
  }

  private getCurrentPinchDistance(): number | null {
    if (this.worldTouches.size < 2) {
      return null;
    }
    const points = [...this.worldTouches.values()];
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }
}

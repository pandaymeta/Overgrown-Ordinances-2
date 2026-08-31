import * as ENGINE from '@gnsx/genesys.js';

import { DeliveryProgressHudSystem } from './delivery-progress-hud.js';

interface CarryPawn {
  toggleCarry(): boolean;
  handleCarryPrimaryAction(): boolean;
  setCarryAimCursor(event: MouseEvent): void;
}

function isCarryPawn(value: unknown): value is CarryPawn {
  return value !== null
    && typeof value === 'object'
    && 'toggleCarry' in value
    && typeof (value as CarryPawn).toggleCarry === 'function'
    && 'handleCarryPrimaryAction' in value
    && typeof (value as CarryPawn).handleCarryPrimaryAction === 'function'
    && 'setCarryAimCursor' in value
    && typeof (value as CarryPawn).setCarryAimCursor === 'function';
}

/** Explicit input route for crate pickup/drop and throwing. */
@ENGINE.GameClass()
export class CarryPlayerController extends ENGINE.DefaultPlayerController {
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
}

/**
 * AnimationStateMachineNode.playOneShot delegates to OneShotController, which
 * expects OneShotHost adapters (getOneShotClips, getMixer, …). The node stores
 * those values but never exposes the host methods, so axe attacks throw
 * "this.host.getOneShotClips is not a function".
 */

import type * as ENGINE from '@gnsx/genesys.js';
import type * as THREE from 'three';

interface AnimationGraphRuntimeLike {
  currentState: string | null;
}

interface AnimationEventProcessorLike {
  resetActionTime(action: THREE.AnimationAction): void;
}

interface AnimationStateMachineHost {
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  oneShotClips: Set<string>;
  layerActions: Map<string, THREE.AnimationAction>;
  maskedActions: Map<string, THREE.AnimationAction>;
  eventProcessor: AnimationEventProcessorLike;
  getGraphRuntime(graphId: string): AnimationGraphRuntimeLike | null;
  getOneShotClips?(): Set<string>;
  getMixer?(): THREE.AnimationMixer | null;
  getAction?(name: string): THREE.AnimationAction | undefined;
  getActions?(): Map<string, THREE.AnimationAction>;
  setBaseCurrentState?(state: string | null): void;
  getBaseGraphRuntime?(): AnimationGraphRuntimeLike | null;
  getLayerActions?(): Map<string, THREE.AnimationAction>;
  getMaskedActions?(): Map<string, THREE.AnimationAction>;
  resetActionTime?(action: THREE.AnimationAction): void;
  __overgrownOneShotHostPatch?: boolean;
}

export function installAnimationOneShotHostPatch(
  engine: typeof ENGINE,
): void {
  const prototype = engine.AnimationStateMachineNode.prototype as unknown as AnimationStateMachineHost;
  if (prototype.__overgrownOneShotHostPatch) {
    return;
  }
  prototype.__overgrownOneShotHostPatch = true;

  if (typeof prototype.getOneShotClips !== 'function') {
    prototype.getOneShotClips = function getOneShotClips(this: AnimationStateMachineHost) {
      return this.oneShotClips ?? new Set<string>();
    };
  }
  if (typeof prototype.getMixer !== 'function') {
    prototype.getMixer = function getMixer(this: AnimationStateMachineHost) {
      return this.mixer;
    };
  }
  if (typeof prototype.getAction !== 'function') {
    prototype.getAction = function getAction(this: AnimationStateMachineHost, name: string) {
      return this.actions.get(name);
    };
  }
  if (typeof prototype.getActions !== 'function') {
    prototype.getActions = function getActions(this: AnimationStateMachineHost) {
      return this.actions;
    };
  }
  if (typeof prototype.setBaseCurrentState !== 'function') {
    prototype.setBaseCurrentState = function setBaseCurrentState(
      this: AnimationStateMachineHost,
      state: string | null,
    ) {
      const runtime = this.getGraphRuntime('base');
      if (runtime) {
        runtime.currentState = state;
      }
    };
  }
  if (typeof prototype.getBaseGraphRuntime !== 'function') {
    prototype.getBaseGraphRuntime = function getBaseGraphRuntime(this: AnimationStateMachineHost) {
      return this.getGraphRuntime('base');
    };
  }
  if (typeof prototype.getLayerActions !== 'function') {
    prototype.getLayerActions = function getLayerActions(this: AnimationStateMachineHost) {
      return this.layerActions;
    };
  }
  if (typeof prototype.getMaskedActions !== 'function') {
    prototype.getMaskedActions = function getMaskedActions(this: AnimationStateMachineHost) {
      return this.maskedActions;
    };
  }
  if (typeof prototype.resetActionTime !== 'function') {
    prototype.resetActionTime = function resetActionTime(
      this: AnimationStateMachineHost,
      action: THREE.AnimationAction,
    ) {
      this.eventProcessor.resetActionTime(action);
    };
  }
}

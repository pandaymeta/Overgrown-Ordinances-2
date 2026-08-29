/**
 * Street-lamp ground spots:
 * - Authored SpotLight nodes stay lit for the late-afternoon haze
 * - Spots are detached to world roots so axe / dismantle / lamp physics
 *   never tear down an active SpotLight under a Street Lamp hierarchy
 * - Never toggle visible/intensity at runtime — day reset and cinematics
 *   must leave these lights alone
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

const STREET_LAMP_NAME = /^Street Lamp/i;
const SPOT_NAME = /^Lamp Ground Spot/i;
const POOL_NAME = /^Lamp Ground Pool$/i;
const GLASS_GLOW_NAME = /^Lamp Glass Glow$/i;

/** Local lantern head (matches authored LampTrigger height / arm overhang). */
const SPOT_LOCAL_POS = new THREE.Vector3(0, 4.55, 0.9);

const SPOT_COLOR = new THREE.Color('#ffd2a0');

/** Soft readable pool under haze — between “stamp” and “invisible”. */
const SPOT_ANGLE = 0.44;
const SPOT_PENUMBRA = 0.4;
export const STREET_LAMP_SPOT_INTENSITY = 52;
const SPOT_INTENSITY = STREET_LAMP_SPOT_INTENSITY;
const SPOT_DISTANCE = 14;
const SPOT_DECAY = 1.55;

const OWNER_UUID_KEY = 'streetLampOwnerUuid';

/** lamp.uuid → detached world-root spot */
const detachedSpotsByLampUuid = new Map<string, ENGINE.SpotLightNode>();

const scratchWorldPos = new THREE.Vector3();
const scratchWorldQuat = new THREE.Quaternion();
const scratchWorldScale = new THREE.Vector3();

function findNamedChild<T extends ENGINE.SceneNode>(
  parent: ENGINE.SceneNode,
  ctor: abstract new (...args: never[]) => T,
  nameTest: RegExp,
): T | null {
  for (const child of parent.getNodes(ctor)) {
    if (nameTest.test(child.name ?? '')) {
      return child;
    }
  }
  return null;
}

function removeLegacyOverlays(lamp: ENGINE.ModelMeshNode): void {
  for (const child of [...lamp.getNodes(ENGINE.MeshNode)]) {
    const name = child.name ?? '';
    if (!POOL_NAME.test(name) && !GLASS_GLOW_NAME.test(name)) {
      continue;
    }
    // Mid-play overlays may still be NotStarted — removeFromParent/endPlay would ensure-fail.
    if (child.isPlaying()) {
      child.destroy();
    } else if (child.parent) {
      THREE.Object3D.prototype.remove.call(child.parent, child);
    }
  }
}

/**
 * Reparent a spot to the world without SceneNode.removeFromParent().
 * That path calls endPlay when an ancestor is playing — NotStarted spots fail
 * ensure, and Playing spots become Ended so world.add beginPlay also fails.
 * Prefer detachSceneNodeForReparent (world roots) or raw Object3D.remove (keeps
 * playState; also bypasses SceneNode's deferred remove-while-ticking queue).
 */
function reparentSpotToWorld(
  world: ENGINE.World,
  spot: ENGINE.SpotLightNode,
): void {
  if (spot.parent === world) {
    return;
  }
  if (!world.detachSceneNodeForReparent(spot) && spot.parent) {
    THREE.Object3D.prototype.remove.call(spot.parent, spot);
  }
  world.add(spot);
}

function findSpotForLamp(lamp: ENGINE.ModelMeshNode): ENGINE.SpotLightNode | null {
  const tracked = detachedSpotsByLampUuid.get(lamp.uuid);
  if (tracked?.parent) {
    return tracked;
  }
  return findNamedChild(lamp, ENGINE.SpotLightNode, SPOT_NAME);
}

/** Defaults only for newly created spots — never overwrite authored values. */
function applyNewSpotDefaults(spot: ENGINE.SpotLightNode): void {
  spot.name = 'Lamp Ground Spot';
  spot.color = SPOT_COLOR;
  spot.intensity = SPOT_INTENSITY;
  spot.distance = SPOT_DISTANCE;
  spot.decay = SPOT_DECAY;
  spot.angle = SPOT_ANGLE;
  spot.penumbra = SPOT_PENUMBRA;
  spot.castShadow = false;
  spot.position.copy(SPOT_LOCAL_POS);
  // Genesys light forward: +90° X aims at the ground.
  spot.rotation.set(Math.PI / 2, 0, 0);
}

function ensureSpotExists(lamp: ENGINE.ModelMeshNode): ENGINE.SpotLightNode {
  const existing = findSpotForLamp(lamp);
  if (existing) {
    return existing;
  }
  const spot = ENGINE.SpotLightNode.create({
    name: 'Lamp Ground Spot',
    color: SPOT_COLOR,
    intensity: SPOT_INTENSITY,
    distance: SPOT_DISTANCE,
    decay: SPOT_DECAY,
    angle: SPOT_ANGLE,
    penumbra: SPOT_PENUMBRA,
    castShadow: false,
  });
  lamp.add(spot);
  applyNewSpotDefaults(spot);
  return spot;
}

/**
 * Keep spots lit, but not parented under Street Lamps — dismantle / physics
 * rebuilds on the lamp must never touch an active SpotLight child.
 * Does not change visible, intensity, or other authored spot properties.
 */
export function detachStreetLampSpotsToWorld(
  world: ENGINE.World | null | undefined,
): number {
  if (!world) {
    return 0;
  }

  let count = 0;
  for (const lamp of world.getNodes(ENGINE.ModelMeshNode)) {
    if (!STREET_LAMP_NAME.test(lamp.name ?? '')) {
      continue;
    }
    const spot = findNamedChild(lamp, ENGINE.SpotLightNode, SPOT_NAME)
      ?? detachedSpotsByLampUuid.get(lamp.uuid)
      ?? null;
    if (!spot) {
      continue;
    }

    if (spot.parent !== world) {
      spot.updateWorldMatrix(true, false);
      spot.matrixWorld.decompose(scratchWorldPos, scratchWorldQuat, scratchWorldScale);
      reparentSpotToWorld(world, spot);
      spot.position.copy(scratchWorldPos);
      spot.quaternion.copy(scratchWorldQuat);
      spot.scale.copy(scratchWorldScale);
    }

    spot.userData[OWNER_UUID_KEY] = lamp.uuid;
    detachedSpotsByLampUuid.set(lamp.uuid, spot);
    count += 1;
  }
  return count;
}

/**
 * One-time / startup: strip legacy pool meshes, create missing spots if needed,
 * then detach every spot to the world. Safe to call again — existing spots are
 * not retuned or toggled.
 */
export function refreshStreetLampGroundLights(
  world: ENGINE.World | null | undefined,
): number {
  if (!world) {
    return 0;
  }

  for (const lamp of world.getNodes(ENGINE.ModelMeshNode)) {
    if (!STREET_LAMP_NAME.test(lamp.name ?? '')) {
      continue;
    }
    removeLegacyOverlays(lamp);
    ensureSpotExists(lamp);
  }
  return detachStreetLampSpotsToWorld(world);
}

@ENGINE.GameClass()
export class StreetLampGroundLightsSystem extends ENGINE.SceneNode {
  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({
      name: 'Street Lamp Ground Lights',
      ...options,
    });
  }

  public override postLoad(): void {
    super.postLoad();
    refreshStreetLampGroundLights(this.getWorld());
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    // Detach only — never toggle spots during play / day reset.
    detachStreetLampSpotsToWorld(this.getWorld());
    return true;
  }
}

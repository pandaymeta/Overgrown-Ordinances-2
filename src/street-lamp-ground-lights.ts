/**
 * Street-lamp lighting for the late-afternoon haze:
 * - Real downward SpotLight (soft warm pool on the ground)
 * - Glazing "on" look comes from the street-lamp-29f365.glb lens material
 * - Spots live as world roots (not lamp children) so axe/dismantle never
 *   tears down an active SpotLight under a ModelMeshNode hierarchy
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
    if (POOL_NAME.test(name) || GLASS_GLOW_NAME.test(name)) {
      child.destroy();
    }
  }
}

function findSpotForLamp(lamp: ENGINE.ModelMeshNode): ENGINE.SpotLightNode | null {
  const tracked = detachedSpotsByLampUuid.get(lamp.uuid);
  if (tracked?.parent) {
    return tracked;
  }
  return findNamedChild(lamp, ENGINE.SpotLightNode, SPOT_NAME);
}

function retuneSpot(spot: ENGINE.SpotLightNode): void {
  spot.name = spot.name?.startsWith('Lamp Ground Spot') ? spot.name : 'Lamp Ground Spot';
  spot.visible = true;
  spot.color = SPOT_COLOR;
  spot.intensity = SPOT_INTENSITY;
  spot.distance = SPOT_DISTANCE;
  spot.decay = SPOT_DECAY;
  spot.angle = SPOT_ANGLE;
  spot.penumbra = SPOT_PENUMBRA;
  spot.castShadow = false;
}

function ensureSpot(lamp: ENGINE.ModelMeshNode): ENGINE.SpotLightNode {
  let spot = findSpotForLamp(lamp);
  if (!spot) {
    spot = ENGINE.SpotLightNode.create({
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
    // Defaults only for newly created spots — authored transforms stay as-is.
    spot.position.copy(SPOT_LOCAL_POS);
    // Genesys light forward: +90° X aims at the ground.
    spot.rotation.set(Math.PI / 2, 0, 0);
  }

  retuneSpot(spot);
  return spot;
}

/**
 * Keep spots lit, but not parented under Street Lamps — dismantle / physics
 * rebuilds on the lamp must never touch an active SpotLight child.
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

    spot.updateWorldMatrix(true, false);
    spot.matrixWorld.decompose(scratchWorldPos, scratchWorldQuat, scratchWorldScale);

    if (spot.parent !== world) {
      spot.removeFromParent();
      world.add(spot);
      spot.position.copy(scratchWorldPos);
      spot.quaternion.copy(scratchWorldQuat);
      spot.scale.copy(scratchWorldScale);
    }

    spot.userData[OWNER_UUID_KEY] = lamp.uuid;
    detachedSpotsByLampUuid.set(lamp.uuid, spot);
    retuneSpot(spot);
    count += 1;
  }
  return count;
}

/** Dim every lamp spot — extra lights are expensive during cinematics / fade. */
export function setStreetLampGroundLightsEnabled(
  world: ENGINE.World | null | undefined,
  enabled: boolean,
): void {
  if (!world) {
    return;
  }

  const seen = new Set<ENGINE.SpotLightNode>();
  for (const spot of detachedSpotsByLampUuid.values()) {
    if (!spot.parent) {
      continue;
    }
    // Keep intensity stable — zeroing SpotLight intensity jitters the camera.
    spot.visible = enabled;
    if (enabled) {
      spot.intensity = SPOT_INTENSITY;
    }
    seen.add(spot);
  }

  for (const lamp of world.getNodes(ENGINE.ModelMeshNode)) {
    if (!STREET_LAMP_NAME.test(lamp.name ?? '')) {
      continue;
    }
    const spot = findNamedChild(lamp, ENGINE.SpotLightNode, SPOT_NAME);
    if (!spot || seen.has(spot)) {
      continue;
    }
    spot.visible = enabled;
    if (enabled) {
      spot.intensity = SPOT_INTENSITY;
    }
  }
}

/** Attach / retune spots, detach to world roots, strip fake pool discs. */
export function refreshStreetLampGroundLights(
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
    removeLegacyOverlays(lamp);
    ensureSpot(lamp);
    count += 1;
  }
  detachStreetLampSpotsToWorld(world);
  return count;
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
    refreshStreetLampGroundLights(this.getWorld());
    return true;
  }
}

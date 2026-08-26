/**
 * Street-lamp lighting for the late-afternoon haze:
 * - Real downward SpotLight (soft warm pool on the ground)
 * - Glazing "on" look comes from the street-lamp-29f365.glb lens material
 * - No fake ground-disc or overlay glass meshes
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

const STREET_LAMP_NAME = /^Street Lamp/i;
const SPOT_NAME = /^Lamp Ground Spot$/i;
const POOL_NAME = /^Lamp Ground Pool$/i;
const GLASS_GLOW_NAME = /^Lamp Glass Glow$/i;

/** Local lantern head (matches authored LampTrigger height / arm overhang). */
const SPOT_LOCAL_POS = new THREE.Vector3(0, 4.55, 0.9);

const SPOT_COLOR = new THREE.Color('#ffd2a0');

/**
 * Soft readable pool under haze — between “stamp” and “invisible”.
 * Dusk level: lamps reading as just-flicked-on is a nice golden-hour beat, but
 * at full night strength they fight the low sun and pull the street toward night.
 */
const SPOT_ANGLE = 0.44;
const SPOT_PENUMBRA = 0.4;
const SPOT_INTENSITY = 30;
const SPOT_DISTANCE = 13;
const SPOT_DECAY = 1.55;

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

function ensureSpot(lamp: ENGINE.ModelMeshNode): ENGINE.SpotLightNode {
  let spot = findNamedChild(lamp, ENGINE.SpotLightNode, SPOT_NAME);
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

  spot.name = 'Lamp Ground Spot';
  spot.visible = true;
  spot.color = SPOT_COLOR;
  spot.intensity = SPOT_INTENSITY;
  spot.distance = SPOT_DISTANCE;
  spot.decay = SPOT_DECAY;
  spot.angle = SPOT_ANGLE;
  spot.penumbra = SPOT_PENUMBRA;
  spot.castShadow = false;
  return spot;
}

/** Attach / retune spots; strip fake pool discs and old glass overlays. */
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

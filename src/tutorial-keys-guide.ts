/**
 * Ground tutorial keys (WASD + Space + plus + pointer).
 * Positions/sizes stay scene-authored. Hidden in the editor; shown + pulsed only in play.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

const KEY_SIZE = 0.85;
const KEY_GAP = 0.14;
/** Native keyboard_spacebar.png aspect — keep that ratio, never squash. */
const SPACEBAR_NATIVE_ASPECT = 355 / 128;
const SPACEBAR_HEIGHT = 0.7;
const SPACEBAR_WIDTH = SPACEBAR_HEIGHT * SPACEBAR_NATIVE_ASPECT;
const PLUS_SIZE = 0.55;
const POINTER_SIZE = 0.9;
const LIFT_Y = 0.04;
/** Exactly three soft→opaque breathes, then hide. */
const PULSE_COUNT = 3;
/** Slow opacity breathe (~one full cycle every ~2.5s). */
const PULSE_HZ = 0.4;
const PULSE_DURATION_SEC = PULSE_COUNT / PULSE_HZ;
/** Begin fully transparent, then breathe up to opaque and back again. */
const PULSE_OPACITY_MIN = 0;
const PULSE_OPACITY_MAX = 1;
/** Lane marking paint on AsphaltRoadTile — warm cream, not pure white. */
const ROAD_MARKING_PAINT_RGB = { r: 0xf2, g: 0xef, b: 0xe7 };
/** Match AsphaltRoadTile `finish()` — lit vertex paint, not emissive UI. */
const ROAD_PAINT_ROUGHNESS = 0.85;
const ROAD_PAINT_METALNESS = 0;

type IconSpec = {
  name: string;
  texturePath: string;
  width: number;
  height: number;
  localX: number;
  localZ: number;
};

const RIGHT_CLUSTER_X = KEY_SIZE * 2 + KEY_GAP * 2.4;

/** Defaults used only when seeding a brand-new guide (no MeshNode children yet). */
const ICON_SPECS: readonly IconSpec[] = [
  {
    name: 'Tutorial Key W',
    texturePath: '@project/assets/textures/Keys/keyboard_w_outline.png',
    width: KEY_SIZE,
    height: KEY_SIZE,
    localX: 0,
    localZ: -(KEY_SIZE + KEY_GAP),
  },
  {
    name: 'Tutorial Key A',
    texturePath: '@project/assets/textures/Keys/keyboard_a_outline.png',
    width: KEY_SIZE,
    height: KEY_SIZE,
    localX: -(KEY_SIZE + KEY_GAP),
    localZ: 0,
  },
  {
    name: 'Tutorial Key S',
    texturePath: '@project/assets/textures/Keys/keyboard_s_outline.png',
    width: KEY_SIZE,
    height: KEY_SIZE,
    localX: 0,
    localZ: 0,
  },
  {
    name: 'Tutorial Key D',
    texturePath: '@project/assets/textures/Keys/keyboard_d_outline.png',
    width: KEY_SIZE,
    height: KEY_SIZE,
    localX: KEY_SIZE + KEY_GAP,
    localZ: 0,
  },
  {
    name: 'Tutorial Key Space',
    texturePath: '@project/assets/textures/Keys/keyboard_spacebar.png',
    width: SPACEBAR_WIDTH,
    height: SPACEBAR_HEIGHT,
    localX: 0,
    localZ: KEY_SIZE + KEY_GAP + SPACEBAR_HEIGHT * 0.5,
  },
  {
    name: 'Tutorial Key Plus',
    texturePath: '@project/assets/textures/Keys/line_cross.png',
    width: PLUS_SIZE,
    height: PLUS_SIZE,
    localX: RIGHT_CLUSTER_X,
    localZ: 0,
  },
  {
    name: 'Tutorial Key Pointer',
    texturePath: '@project/assets/textures/Keys/pointer_b.png',
    width: POINTER_SIZE,
    height: POINTER_SIZE,
    localX: RIGHT_CLUSTER_X + PLUS_SIZE * 0.5 + KEY_GAP + POINTER_SIZE * 0.5,
    localZ: 0,
  },
];

const ICON_SPEC_BY_NAME = new Map(ICON_SPECS.map((spec) => [spec.name, spec]));

/**
 * Placeable root: children keep editor transforms; visuals only load in play.
 * Hidden in the editor to avoid CanvasTexture / extra GPU work that can black the viewport.
 */
@ENGINE.GameClass()
export class TutorialKeysGuide extends ENGINE.SceneNode {
  private readonly iconMeshes: ENGINE.MeshNode[] = [];
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly bakedTextures: THREE.Texture[] = [];
  private pulseRemaining = 0;
  private pulseElapsed = 0;
  private onHintFinished: (() => void) | null = null;
  private materialsReady = false;
  private materialsPromise: Promise<void> | null = null;

  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({ name: 'Tutorial Keys Guide', ...options });
    this.syncIconChildren();
    this.setIconsVisible(false);
  }

  public override postLoad(): void {
    super.postLoad();
    this.syncIconChildren();
    // Editor: never upload runtime textures — scene poses stay, icons stay hidden.
    this.setIconsVisible(false);
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    this.syncIconChildren();
    this.pulseRemaining = 0;
    // Scene may have saved the root hidden for the editor — children cannot show while parent is off.
    this.visible = true;
    this.setIconsVisible(false);
    void this.ensureMaterials();
    return true;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this.pulseRemaining = 0;
    this.disposeRuntimeMaterials();
    this.setIconsVisible(false);
    return true;
  }

  public override tickPostPhysics(deltaTime: number): void {
    super.tickPostPhysics(deltaTime);
    if (this.pulseRemaining <= 0) {
      return;
    }
    this.pulseRemaining = Math.max(0, this.pulseRemaining - deltaTime);
    this.pulseElapsed += deltaTime;
    // Transparent → opaque → transparent. The cosine starts at the transparent
    // end so the tutorial appears by fading in rather than abruptly popping on.
    const wave = 0.5 - 0.5 * Math.cos(this.pulseElapsed * Math.PI * 2 * PULSE_HZ);
    this.setIconsOpacity(
      PULSE_OPACITY_MIN + wave * (PULSE_OPACITY_MAX - PULSE_OPACITY_MIN),
    );
    if (this.pulseRemaining <= 0) {
      this.setIconsVisible(false);
      const finished = this.onHintFinished;
      this.onHintFinished = null;
      finished?.();
    }
  }

  /** Show keys, pulse, then hide after {@link PULSE_DURATION_SEC}. */
  public playHint(onFinished?: () => void): void {
    this.onHintFinished = onFinished ?? null;
    void this.ensureMaterials()
      .catch(() => {
        // Still run the pulse so downstream axe-ring hints are not blocked.
      })
      .then(() => {
        this.beginPulse();
      });
  }

  private beginPulse(): void {
    this.visible = true;
    this.pulseElapsed = 0;
    this.pulseRemaining = PULSE_DURATION_SEC;
    this.setIconsVisible(true);
    this.setIconsOpacity(PULSE_OPACITY_MIN);
  }

  /**
   * If the guide already has MeshNode children (scene-authored), only bind those.
   * Never recreate icons the user deleted. Seed defaults only on an empty guide.
   */
  private syncIconChildren(): void {
    this.iconMeshes.length = 0;
    const existing = this.getNodes(ENGINE.MeshNode).filter((node) => (
      typeof node.name === 'string' && node.name.startsWith('Tutorial Key ')
    ));

    if (existing.length > 0) {
      for (const child of existing) {
        child.renderOrder = 860;
        this.iconMeshes.push(child);
      }
      return;
    }

    this.seedDefaultIcons();
  }

  private seedDefaultIcons(): void {
    for (const spec of ICON_SPECS) {
      this.seedIcon(spec, () => ENGINE.MeshNode.create({
        name: spec.name,
        geometry: new THREE.PlaneGeometry(spec.width, spec.height),
        material: this.createPlaceholderMaterial(),
        castShadow: false,
        receiveShadow: false,
        physicsOptions: { enabled: false },
      }));
    }
  }

  private seedIcon(spec: IconSpec, createMesh: () => ENGINE.MeshNode): void {
    const child = createMesh();
    child.position.set(spec.localX, LIFT_Y, spec.localZ);
    child.rotation.x = -Math.PI / 2;
    child.renderOrder = 860;
    child.visible = false;
    this.add(child);
    this.iconMeshes.push(child);
  }

  private createPlaceholderMaterial(): THREE.MeshStandardMaterial {
    return this.createRoadPaintMaterial();
  }

  /** Lit road-marking material — same response as asphalt lane paint geometry. */
  private createRoadPaintMaterial(map?: THREE.Texture): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      map,
      color: 0xffffff,
      transparent: true,
      opacity: map ? 1 : 0,
      depthWrite: false,
      depthTest: true,
      roughness: ROAD_PAINT_ROUGHNESS,
      metalness: ROAD_PAINT_METALNESS,
      flatShading: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  /**
   * Kenney keys are white-on-black PNGs. Bake cream lane-paint colour + alpha so
   * normal blending and scene lighting match AsphaltRoadTile markings.
   */
  private bakeRoadPaintIconTexture(source: THREE.Texture): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') {
      return null;
    }
    const image = source.image as CanvasImageSource & { width?: number; height?: number };
    const width = image.width ?? 0;
    const height = image.height ?? 0;
    if (!width || !height) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }

    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;
    const { r, g, b } = ROAD_MARKING_PAINT_RGB;
    for (let i = 0; i < data.length; i += 4) {
      const lum = Math.max(data[i], data[i + 1], data[i + 2]);
      if (lum < 8) {
        data[i + 3] = 0;
        continue;
      }
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = lum;
    }
    context.putImageData(imageData, 0, 0);

    const baked = new THREE.CanvasTexture(canvas);
    baked.colorSpace = THREE.SRGBColorSpace;
    baked.magFilter = THREE.LinearFilter;
    baked.minFilter = THREE.LinearMipmapLinearFilter;
    baked.generateMipmaps = true;
    baked.needsUpdate = true;
    return baked;
  }

  private ensureMaterials(): Promise<void> {
    if (this.materialsReady) {
      return Promise.resolve();
    }
    this.materialsPromise ??= this.applyIconMaterials().finally(() => {
      this.materialsPromise = null;
    });
    return this.materialsPromise;
  }

  private async applyIconMaterials(): Promise<void> {
    // Drop previous runtime mats without wiping meshes mid-load.
    for (const material of this.materials) {
      material.dispose();
    }
    this.materials.length = 0;
    this.disposeBakedTextures();
    this.materialsReady = false;

    for (const mesh of this.iconMeshes) {
      const spec = ICON_SPEC_BY_NAME.get(mesh.name);
      if (!spec) {
        continue;
      }
      try {
        const loaded = await ENGINE.resourceManager.loadTexture(
          ENGINE.AssetPath.fromString(spec.texturePath),
        );
        if (!loaded) {
          continue;
        }
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.needsUpdate = true;
        const baked = this.bakeRoadPaintIconTexture(loaded);
        if (!baked) {
          continue;
        }
        this.bakedTextures.push(baked);
        const material = this.createRoadPaintMaterial(baked);
        mesh.material = material;
        const applied = mesh.material;
        if (applied instanceof THREE.MeshStandardMaterial) {
          this.materials.push(applied);
        } else {
          this.materials.push(material);
        }
      } catch (error) {
        console.warn('[TutorialKeys] Failed to load', spec.texturePath, error);
      }
    }
    this.materialsReady = this.materials.length > 0;
  }

  private disposeRuntimeMaterials(): void {
    for (const mesh of this.iconMeshes) {
      mesh.material = this.createPlaceholderMaterial();
    }
    for (const material of this.materials) {
      material.dispose();
    }
    this.materials.length = 0;
    this.disposeBakedTextures();
    this.materialsReady = false;
  }

  private disposeBakedTextures(): void {
    for (const texture of this.bakedTextures) {
      texture.dispose();
    }
    this.bakedTextures.length = 0;
  }

  private setIconsVisible(visible: boolean): void {
    for (const mesh of this.iconMeshes) {
      mesh.visible = visible;
    }
  }

  private setIconsOpacity(opacity: number): void {
    for (const material of this.materials) {
      material.opacity = opacity;
      material.needsUpdate = true;
    }
  }
}

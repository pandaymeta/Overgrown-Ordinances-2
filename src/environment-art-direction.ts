import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { detachStreetLampSpotsToWorld } from './street-lamp-ground-lights.js';
import {
  guardSceneGeometryEarly,
  hideMissingPositionMeshesInWorld,
  isMissingPositionMesh,
} from './ordinance-sign-sharpness.js';
import { isSignBoardModelUrl } from './sign-board-model-paths.js';

type SurfaceStyle = {
  tint: THREE.Color;
  tintAmount: number;
  roughness: number;
  exposure: number;
};

const MOBILE_RENDERING_PROFILE = ENGINE.isMobileBrowser();
const TEXTURE_ANISOTROPY = MOBILE_RENDERING_PROFILE ? 2 : 4;
const PAINTED_TEXTURE_MAX_SIZE = MOBILE_RENDERING_PROFILE ? 512 : 1024;
/** Bump when retuning so already-styled materials get the lighter sharp-mesh pass. */
const STYLED_FLAG = 'civicAfternoonSurfaceStyleV3b';
/** Spawned scrap that already received a source-prop material copy. */
export const SKIP_ENVIRONMENT_ART_FLAG = 'skipEnvironmentArtDirection';
const PAINTERLY_DETAIL_TEXTURE_PATH =
  '@project/assets/textures/style/painterly-brush-detail-v1.png';

let painterlyDetailTexture: THREE.Texture | null | undefined;
const paintedTextureCache = new WeakMap<THREE.Texture, Map<SurfaceStyle, THREE.Texture>>();
const meshLoadHooks = new WeakSet<ENGINE.ModelMeshNode>();

/**
 * Light-touch grading for restored sharp Overgrown-Rules meshes.
 * Cool roads / warm plaster / alive greens — keep edges crisp.
 */
const SURFACE_STYLES: Record<string, SurfaceStyle> = {
  asphalt: {
    tint: new THREE.Color('#7d98aa'),
    tintAmount: 0.2,
    roughness: 0.9,
    exposure: 0.96,
  },
  road: {
    tint: new THREE.Color('#8aa8b4'),
    tintAmount: 0.18,
    roughness: 0.82,
    exposure: 1.0,
  },
  vegetation: {
    tint: new THREE.Color('#58a46c'),
    tintAmount: 0.22,
    roughness: 0.94,
    exposure: 1.05,
  },
  building: {
    tint: new THREE.Color('#f0c292'),
    tintAmount: 0.16,
    roughness: 0.84,
    exposure: 1.05,
  },
  metal: {
    tint: new THREE.Color('#9aafbb'),
    tintAmount: 0.15,
    roughness: 0.8,
    exposure: 1.0,
  },
  prop: {
    tint: new THREE.Color('#e4cbaa'),
    tintAmount: 0.08,
    roughness: 0.88,
    exposure: 1.02,
  },
  cloud: {
    tint: new THREE.Color('#cfd9e0'),
    tintAmount: 0.62,
    roughness: 1,
    exposure: 1,
  },
};

function classifySurface(node: ENGINE.ModelMeshNode): SurfaceStyle {
  const label = `${node.name} ${node.modelUrl ?? ''}`.toLowerCase();

  // Keep the sidewalk/pavement and road-corner assets in the original asphalt
  // family. Only the three named road runs receive the Tram Track match.
  if (/asphalt road tile corner|pavement tile|\bpavement\b/.test(label)) {
    return SURFACE_STYLES.asphalt;
  }
  if (/rightside(?:road)?|leftside(?:road)?|mainroad/.test(label)) {
    return SURFACE_STYLES.road;
  }
  if (/tram track|tram-track/.test(label)) {
    return SURFACE_STYLES.asphalt;
  }
  if (/asphalt|pavement|road|ground tile/.test(label)) {
    return SURFACE_STYLES.asphalt;
  }
  if (/grass|bush|tree|cherry|dirt/.test(label)) {
    return SURFACE_STYLES.vegetation;
  }
  // Soft cream cloud masses — support haze without green vegetation tint.
  if (/\bcloud\b/.test(label)) {
    return SURFACE_STYLES.cloud;
  }
  if (/shop|house|shophouse|roof|awning/.test(label)) {
    return SURFACE_STYLES.building;
  }
  if (/lamp|guardrail|utility|pole|air con|vending|hydrant|tram/.test(label)) {
    return SURFACE_STYLES.metal;
  }
  return SURFACE_STYLES.prop;
}

function sharpenTexture(texture: THREE.Texture | null | undefined): void {
  if (!texture) {
    return;
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = TEXTURE_ANISOTROPY;
  texture.needsUpdate = true;
}

async function loadPainterlyDetailTexture(): Promise<THREE.Texture | null> {
  if (painterlyDetailTexture !== undefined) {
    return painterlyDetailTexture;
  }

  painterlyDetailTexture = await ENGINE.resourceManager.loadTexture(
    ENGINE.AssetPath.fromString(PAINTERLY_DETAIL_TEXTURE_PATH),
  );
  sharpenTexture(painterlyDetailTexture);
  return painterlyDetailTexture;
}

function createPaintedMap(
  baseTexture: THREE.Texture,
  detailTexture: THREE.Texture | null,
  style: SurfaceStyle,
): THREE.Texture | null {
  if (!detailTexture || typeof document === 'undefined') {
    return null;
  }

  const cachedByStyle = paintedTextureCache.get(baseTexture);
  const cached = cachedByStyle?.get(style);
  if (cached) {
    return cached;
  }

  const baseImage = baseTexture.image as CanvasImageSource & {
    width?: number;
    height?: number;
  };
  const detailImage = detailTexture.image as CanvasImageSource;
  const width = Math.min(baseImage?.width ?? 0, PAINTED_TEXTURE_MAX_SIZE);
  const height = Math.min(baseImage?.height ?? 0, PAINTED_TEXTURE_MAX_SIZE);
  if (!width || !height || !detailImage) {
    return null;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }

    context.drawImage(baseImage, 0, 0, width, height);
    // Very light mid-tone lift + soft brush — sharp restored meshes stay crisp.
    context.globalCompositeOperation = 'screen';
    context.globalAlpha = 0.04;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'soft-light';
    context.globalAlpha = 0.12;
    context.drawImage(detailImage, 0, 0, width, height);

    const painted = new THREE.CanvasTexture(canvas);
    painted.colorSpace = THREE.SRGBColorSpace;
    painted.flipY = baseTexture.flipY;
    painted.wrapS = baseTexture.wrapS;
    painted.wrapT = baseTexture.wrapT;
    painted.magFilter = THREE.LinearFilter;
    painted.minFilter = THREE.LinearMipmapLinearFilter;
    painted.generateMipmaps = true;
    painted.anisotropy = TEXTURE_ANISOTROPY;
    painted.needsUpdate = true;

    const byStyle = cachedByStyle ?? new Map<SurfaceStyle, THREE.Texture>();
    byStyle.set(style, painted);
    paintedTextureCache.set(baseTexture, byStyle);
    return painted;
  } catch {
    return null;
  }
}

function styleMaterial(
  source: THREE.Material,
  style: SurfaceStyle,
  detailTexture: THREE.Texture | null,
): THREE.Material {
  // Keep author/export emissive accents (e.g. street-lamp lens) out of the wash.
  const emissiveProbe = source as THREE.Material & {
    emissiveIntensity?: number;
    name?: string;
  };
  if (
    (emissiveProbe.emissiveIntensity ?? 0) >= 0.35
    || /lens|emissive|glow/i.test(emissiveProbe.name ?? '')
  ) {
    return source;
  }

  if (source.userData[STYLED_FLAG]) {
    return source;
  }

  const material = source.clone();
  material.userData[STYLED_FLAG] = true;
  const textured = material as THREE.Material & {
    map?: THREE.Texture | null;
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
    roughness?: number;
    metalness?: number;
  };

  const paintedMap = style === SURFACE_STYLES.cloud
    ? null
    : textured.map
      ? createPaintedMap(textured.map, detailTexture, style)
      : null;
  if (paintedMap) {
    textured.map = paintedMap;
  }
  sharpenTexture(textured.map);
  if (textured.color) {
    textured.color.lerp(style.tint, style.tintAmount);
    textured.color.multiplyScalar(style.exposure);
  }
  // Soft coloured bounce — keep tiny so sharp albedo stays dominant.
  if (textured.emissive) {
    textured.emissive.copy(style.tint).multiplyScalar(0.015);
    textured.emissiveIntensity = Math.max(textured.emissiveIntensity ?? 0, 0.08);
  }
  if (typeof textured.roughness === 'number') {
    textured.roughness = Math.max(textured.roughness, style.roughness);
  }
  if (typeof textured.metalness === 'number' && style !== SURFACE_STYLES.metal) {
    textured.metalness *= 0.45;
  }
  if (style === SURFACE_STYLES.cloud) {
    textured.map = null;
    material.transparent = false;
    material.opacity = 1;
    material.depthWrite = true;
    material.side = THREE.DoubleSide;
    if (textured.emissive) {
      textured.emissive.set('#b8c5cf');
      textured.emissiveIntensity = 0.06;
    }
  }
  material.needsUpdate = true;
  return material;
}

function styleModel(node: ENGINE.ModelMeshNode, detailTexture: THREE.Texture | null): void {
  if (node.userData[SKIP_ENVIRONMENT_ART_FLAG]) {
    return;
  }
  if (isSignBoardModelUrl(node.modelUrl)) {
    return;
  }
  // Keep player beacons / authored accents out of the wash.
  const label = `${node.name} ${node.modelUrl ?? ''}`;
  if (/bench[_\s-]?scrapt/i.test(label)) {
    return;
  }
  if (/mailbox/i.test(label) || /^axe$/i.test(node.name ?? '')) {
    return;
  }

  const style = classifySurface(node);
  for (const mesh of node.getAllMeshes()) {
    if (isMissingPositionMesh(mesh)) {
      continue;
    }
    const position = mesh.geometry?.getAttribute('position');
    if (!position || position.count < 1) {
      continue;
    }
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => styleMaterial(material, style, detailTexture))
      : styleMaterial(mesh.material, style, detailTexture);
  }
}

/**
 * Clamp sun CSM to scene-authored budget values. Scene load + isSunLight can
 * re-enable expensive cascades (shadowFar auto-raised to 2000) and tank FPS.
 */
const SUN_SHADOW_MAP_SIZE = MOBILE_RENDERING_PROFILE ? 512 : 1024;
const SUN_CSM_CASCADE_COUNT = MOBILE_RENDERING_PROFILE ? 1 : 2;
const SUN_CSM_MAX_FAR = MOBILE_RENDERING_PROFILE ? 75 : 100;
const SUN_SHADOW_FAR_CAP = 250;

export function applyDirectionalShadowBudget(world: ENGINE.World | null | undefined): void {
  if (!world) {
    return;
  }
  for (const light of world.getNodes(ENGINE.DirectionalLightNode)) {
    if (!light.isSunLight) {
      if (light.castShadow) {
        light.castShadow = false;
      }
      if (light.useCsmShadows) {
        light.useCsmShadows = false;
      }
      continue;
    }
    if (!light.castShadow) {
      light.castShadow = true;
    }
    if (!light.useCsmShadows) {
      light.useCsmShadows = true;
    }
    if (light.csmCascadeCount !== SUN_CSM_CASCADE_COUNT) {
      light.csmCascadeCount = SUN_CSM_CASCADE_COUNT;
    }
    if (light.csmMaxFar !== SUN_CSM_MAX_FAR) {
      light.csmMaxFar = SUN_CSM_MAX_FAR;
    }
    if (light.shadowMapSize !== SUN_SHADOW_MAP_SIZE) {
      light.shadowMapSize = SUN_SHADOW_MAP_SIZE;
    }
    if (light.shadowFar > SUN_SHADOW_FAR_CAP) {
      light.shadowFar = SUN_SHADOW_FAR_CAP;
    }
  }
}

/** Applies a non-destructive, warm low-poly presentation to existing scene assets. */
export async function refreshEnvironmentArtDirection(
  world: ENGINE.World | null | undefined,
): Promise<number> {
  if (!world) {
    return 0;
  }

  applyDirectionalShadowBudget(world);
  const detailTexture = await loadPainterlyDetailTexture();
  const models = world.getNodes(ENGINE.ModelMeshNode);
  await Promise.all(models.map(async (node) => {
    if (!meshLoadHooks.has(node)) {
      meshLoadHooks.add(node);
      node.onMeshLoaded.add(() => styleModel(node, painterlyDetailTexture ?? null));
    }
    if (node.isLoading()) {
      await node.waitForLoad();
    }
    styleModel(node, detailTexture);
  }));
  hideMissingPositionMeshesInWorld(world);
  // Spots stay world-rooted after art pass — detach only, never retune/toggle.
  detachStreetLampSpotsToWorld(world);
  applyDirectionalShadowBudget(world);
  return models.length;
}

@ENGINE.GameClass()
export class EnvironmentArtDirectionSystem extends ENGINE.SceneNode {
  /** Sparse checkpoints catch late engine sun setup without writing light state every frame. */
  private shadowBudgetFrame = 0;
  private refreshPromise: Promise<number> | null = null;

  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({
      name: 'Environment Art Direction',
      ...options,
    });
  }

  public override postLoad(): void {
    super.postLoad();
    guardSceneGeometryEarly(this.getWorld(), 'EnvironmentArtDirection.postLoad');
    applyDirectionalShadowBudget(this.getWorld());
    void this.ensureEnvironmentRefresh();
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    applyDirectionalShadowBudget(this.getWorld());
    this.shadowBudgetFrame = 0;
    void this.ensureEnvironmentRefresh();
    return true;
  }

  public override tickPostPhysics(_deltaTime: number): void {
    super.tickPostPhysics(_deltaTime);
    this.shadowBudgetFrame += 1;
    if (
      this.shadowBudgetFrame === 1
      || this.shadowBudgetFrame === 30
      || this.shadowBudgetFrame === 90
    ) {
      applyDirectionalShadowBudget(this.getWorld());
    }
  }

  private ensureEnvironmentRefresh(): Promise<number> {
    this.refreshPromise ??= refreshEnvironmentArtDirection(this.getWorld());
    return this.refreshPromise;
  }
}

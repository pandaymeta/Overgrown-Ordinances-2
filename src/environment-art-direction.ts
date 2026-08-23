import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

type SurfaceStyle = {
  tint: THREE.Color;
  tintAmount: number;
  roughness: number;
  exposure: number;
};

const TEXTURE_ANISOTROPY = 8;
/** Bump when retuning so already-styled materials get the lighter sharp-mesh pass. */
const STYLED_FLAG = 'civicAfternoonSurfaceStyleV3b';
/** Spawned scrap that already received a source-prop material copy. */
export const SKIP_ENVIRONMENT_ART_FLAG = 'skipEnvironmentArtDirection';
const ORDINANCE_MODEL_PATH = /PolyforkAssets\/Ordinances\//i;
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
    tint: new THREE.Color('#f2ebe2'),
    tintAmount: 0.22,
    roughness: 1,
    exposure: 1.06,
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
  const width = Math.min(baseImage?.width ?? 0, 1024);
  const height = Math.min(baseImage?.height ?? 0, 1024);
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

  const paintedMap = textured.map
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
  material.needsUpdate = true;
  return material;
}

function styleModel(node: ENGINE.ModelMeshNode, detailTexture: THREE.Texture | null): void {
  if (node.userData[SKIP_ENVIRONMENT_ART_FLAG]) {
    return;
  }
  if (ORDINANCE_MODEL_PATH.test(node.modelUrl ?? '')) {
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
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => styleMaterial(material, style, detailTexture))
      : styleMaterial(mesh.material, style, detailTexture);
  }
}

/** Applies a non-destructive, warm low-poly presentation to existing scene assets. */
export async function refreshEnvironmentArtDirection(
  world: ENGINE.World | null | undefined,
): Promise<number> {
  if (!world) {
    return 0;
  }

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
  return models.length;
}

@ENGINE.GameClass()
export class EnvironmentArtDirectionSystem extends ENGINE.SceneNode {
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
    void refreshEnvironmentArtDirection(this.getWorld());
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    void refreshEnvironmentArtDirection(this.getWorld());
    return true;
  }
}

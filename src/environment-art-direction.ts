import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

type SurfaceStyle = {
  tint: THREE.Color;
  tintAmount: number;
  roughness: number;
  exposure: number;
};

const TEXTURE_ANISOTROPY = 8;
const STYLED_FLAG = 'summerAfternoonSurfaceStyle';
const ORDINANCE_MODEL_PATH = /PolyforkAssets\/Ordinances\//i;
const PAINTERLY_DETAIL_TEXTURE_PATH =
  '@project/assets/textures/style/painterly-brush-detail-v1.png';

let painterlyDetailTexture: THREE.Texture | null | undefined;
const paintedTextureCache = new WeakMap<THREE.Texture, Map<SurfaceStyle, THREE.Texture>>();
const meshLoadHooks = new WeakSet<ENGINE.ModelMeshNode>();

const SURFACE_STYLES: Record<string, SurfaceStyle> = {
  asphalt: {
    tint: new THREE.Color('#8ba9b9'),
    tintAmount: 0.34,
    roughness: 0.9,
    exposure: 1,
  },
  road: {
    // Matches the Tram Track Tile's blue-grey presentation so the left,
    // right, and main road surfaces sit in the same visual family.
    tint: new THREE.Color('#b3cbd1'),
    tintAmount: 0.28,
    roughness: 0.76,
    exposure: 1.12,
  },
  vegetation: {
    tint: new THREE.Color('#76b985'),
    tintAmount: 0.34,
    roughness: 0.95,
    exposure: 1.13,
  },
  building: {
    tint: new THREE.Color('#f4cea9'),
    tintAmount: 0.3,
    roughness: 0.82,
    exposure: 1.15,
  },
  metal: {
    tint: new THREE.Color('#b3cbd1'),
    tintAmount: 0.28,
    roughness: 0.76,
    exposure: 1.12,
  },
  prop: {
    tint: new THREE.Color('#ead1aa'),
    tintAmount: 0.22,
    roughness: 0.88,
    exposure: 1.1,
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
  if (/grass|bush|tree|cherry|dirt|cloud/.test(label)) {
    return SURFACE_STYLES.vegetation;
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
    // Keep the original artwork, but lift its mid-tones so painted detail does
    // not make low-poly shaded faces read as black in the outdoor sun.
    context.globalCompositeOperation = 'screen';
    context.globalAlpha = 0.1;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'soft-light';
    context.globalAlpha = 0.28;
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
  // A very small, tinted emissive lift replaces harsh black fill with the
  // soft coloured bounce characteristic of the painted reference.
  if (textured.emissive) {
    textured.emissive.copy(style.tint).multiplyScalar(0.035);
    textured.emissiveIntensity = Math.max(textured.emissiveIntensity ?? 0, 0.16);
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
  if (ORDINANCE_MODEL_PATH.test(node.modelUrl ?? '')) {
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

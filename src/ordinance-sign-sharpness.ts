/**
 * Keep ordinance signs identical in Sandbox Studio's editor and Play mode.
 *
 * The earlier implementation replaced GLB materials with new unlit materials.
 * That made the board backfaces visible in Play, which mirrored the printed
 * ordinance graphics. This system deliberately leaves color, lighting, sides,
 * and maps authored by the original GitHub GLBs untouched; it only requests
 * stable texture sampling for readable text during camera movement.
 * Anisotropy stays low (2) — late-game board count makes 8× sampling too expensive.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

const ORDINANCE_MODEL_PATH =
  /(?:PolyforkAssets\/Ordinances\/|(?:generated\/)?OrdinanceCards\/)/i;
const MISSING_POSITION_KEY = 'missingPositionAttr';
const MISSING_POSITION_LOGGED = 'missingPositionLogged';
/** Runtime ribbons fill `position` on the next update — hide, do not dummy-patch. */
const SKIP_EMPTY_GEOMETRY_PATCH =
  /^(?:ThrowTrajectoryPreview|HydrantWaterStream|HydrantWaterDroplet\d*)$/;
const DIAGNOSTIC_LOG_PREFIX = '[MissingPositionMesh]';
const TEXTURE_ANISOTROPY = 2;
const meshLoadHooks = new WeakSet<ENGINE.ModelMeshNode>();
const sharpnessAppliedNodes = new WeakSet<ENGINE.ModelMeshNode>();

function isOrdinanceModelUrl(modelUrl: string | null | undefined): boolean {
  return typeof modelUrl === 'string' && ORDINANCE_MODEL_PATH.test(modelUrl);
}

function resolveModelUrlForDiagnostics(object: THREE.Object3D): string {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current instanceof ENGINE.ModelMeshNode) {
      return String(current.modelUrl ?? current.name ?? '(unknown model)');
    }
    current = current.parent;
  }
  return '(no ModelMeshNode ancestor)';
}

function describeObjectPath(object: THREE.Object3D): string {
  const segments: string[] = [];
  let current: THREE.Object3D | null = object;
  while (current) {
    const label = current.name
      || (current instanceof ENGINE.ModelMeshNode
        ? `ModelMesh:${current.modelUrl ?? current.uuid}`
        : current.type || current.uuid);
    segments.push(label);
    current = current.parent;
  }
  return segments.join(' ← ');
}

function geometryMissingPosition(
  object: THREE.Mesh | THREE.Line | THREE.Points,
): boolean {
  const geometry = object.geometry;
  if (!geometry) {
    return true;
  }
  const position = geometry.getAttribute('position');
  return !position || position.count === 0;
}

function shouldSkipEmptyGeometryPatch(object: THREE.Object3D): boolean {
  if (SKIP_EMPTY_GEOMETRY_PATCH.test(object.name ?? '')) {
    return true;
  }
  let parent: THREE.Object3D | null = object.parent;
  while (parent) {
    if (SKIP_EMPTY_GEOMETRY_PATCH.test(parent.name ?? '')) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

function logMissingPositionMesh(
  object: THREE.Mesh | THREE.Line | THREE.Points,
  modelLoading: boolean,
  phaseLabel?: string,
): void {
  if (object.userData[MISSING_POSITION_LOGGED]) {
    return;
  }
  object.userData[MISSING_POSITION_LOGGED] = true;
  const phase = phaseLabel ? ` phase=${phaseLabel}` : '';
  console.warn(
    DIAGNOSTIC_LOG_PREFIX,
    'Mesh missing position attribute:',
    object.name || '(unnamed mesh)',
    `uuid=${object.uuid}`,
    `visible=${object.visible}`,
    `path=${describeObjectPath(object)}`,
    `parentModel=${resolveModelUrlForDiagnostics(object)}`,
    modelLoading ? '(still loading)' : '(confirmed empty)',
    phase,
  );
}

function applyStableSampling(texture: THREE.Texture | null | undefined): void {
  if (!texture) {
    return;
  }
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = TEXTURE_ANISOTROPY;
  texture.needsUpdate = true;
}

type TexturedMaterial = THREE.Material & { map?: THREE.Texture | null };

function isLineLikeObject(object: THREE.Object3D): object is THREE.Line {
  return object instanceof THREE.Line
    || object.type === 'LineSegments'
    || object.type === 'Line'
    || object.type === 'LineLoop';
}

function isRenderableWithGeometry(
  object: THREE.Object3D,
): object is THREE.Mesh | THREE.Line | THREE.Points {
  return object instanceof THREE.Mesh
    || isLineLikeObject(object)
    || object instanceof THREE.Points
    || object.type === 'Mesh'
    || object.type === 'Points';
}

function patchEmptyGeometryObject(
  object: THREE.Mesh | THREE.Line | THREE.Points,
  modelLoading = false,
  phaseLabel?: string,
): boolean {
  if (shouldSkipEmptyGeometryPatch(object)) {
    if (geometryMissingPosition(object)) {
      object.visible = false;
    }
    return false;
  }
  const geometry = object.geometry;
  if (!geometry) {
    logMissingPositionMesh(object, modelLoading, phaseLabel);
    object.visible = false;
    object.userData[MISSING_POSITION_KEY] = true;
    return true;
  }
  const position = geometry.getAttribute('position');
  if (position && position.count > 0) {
    if (object.userData.pendingEmptyPlaceholder) {
      delete object.userData.pendingEmptyPlaceholder;
      object.visible = true;
    }
    return false;
  }
  logMissingPositionMesh(object, modelLoading, phaseLabel);
  // Hide immediately so TSL does not draw an empty BufferGeometry this frame.
  object.visible = false;
  if (modelLoading) {
    object.userData.pendingEmptyPlaceholder = true;
    return true;
  }
  // Confirmed empty after load — dummy triangle so a later unhide cannot
  // compile a NodeMaterial without `position`.
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(9), 3),
  );
  object.frustumCulled = true;
  object.userData[MISSING_POSITION_KEY] = true;
  return true;
}

/**
 * WebGPU TSL warns every frame and can lose the device when a mesh has no
 * `position` attribute. Hide those and give them a dummy triangle.
 */
export function hideMeshesMissingPosition(
  root: ENGINE.SceneNode,
  phaseLabel?: string,
): void {
  const modelLoading = root instanceof ENGINE.ModelMeshNode && root.isLoading();
  if (root instanceof ENGINE.ModelMeshNode) {
    for (const mesh of root.getAllMeshes()) {
      patchEmptyGeometryObject(mesh, modelLoading, phaseLabel);
    }
  }
  root.traverse((child) => {
    if (isRenderableWithGeometry(child)) {
      const childLoading = child instanceof ENGINE.ModelMeshNode
        ? child.isLoading()
        : modelLoading;
      patchEmptyGeometryObject(child, childLoading, phaseLabel);
    }
    if (child instanceof ENGINE.ModelMeshNode && child !== root) {
      const childLoading = child.isLoading();
      for (const mesh of child.getAllMeshes()) {
        patchEmptyGeometryObject(mesh, childLoading, phaseLabel);
      }
    }
  });
}

function traverseWorldRenderables(
  world: ENGINE.World,
  visitor: (object: THREE.Object3D) => void,
): void {
  const sceneRoot = world as unknown as THREE.Object3D;
  if (typeof sceneRoot.traverse === 'function') {
    sceneRoot.traverse(visitor);
    return;
  }
  for (const root of world.getRootNodes()) {
    root.traverse(visitor);
  }
}

/**
 * Empty THREE.LineSegments serialized into the scene (editor leftovers) compile
 * TSL without a `position` attribute and can take down WebGPU.
 */
export function removeEmptySceneLineSegments(world: ENGINE.World): number {
  const detach: THREE.Object3D[] = [];
  traverseWorldRenderables(world, (child) => {
    if (child.type !== 'LineSegments') {
      return;
    }
    if (!geometryMissingPosition(child as THREE.Line)) {
      return;
    }
    detach.push(child);
  });
  for (const object of detach) {
    object.visible = false;
    object.removeFromParent();
  }
  if (detach.length > 0) {
    console.warn(
      DIAGNOSTIC_LOG_PREFIX,
      `Removed ${detach.length} empty THREE.LineSegments scene orphan(s)`,
    );
  }
  return detach.length;
}

/** Run before the first render pass — postLoad async art passes are too late. */
export function guardSceneGeometryEarly(
  world: ENGINE.World | null | undefined,
  phaseLabel = 'early',
): void {
  if (!world) {
    return;
  }
  removeEmptySceneLineSegments(world);
  hideMissingPositionMeshesInWorld(world, phaseLabel);
}

export function hideMissingPositionMeshesInWorld(
  world: ENGINE.World,
  phaseLabel?: string,
): void {
  for (const model of world.getNodes(ENGINE.ModelMeshNode)) {
    hideMeshesMissingPosition(model, phaseLabel);
  }
  traverseWorldRenderables(world, (child) => {
    if (!isRenderableWithGeometry(child)) {
      return;
    }
    let modelLoading = false;
    let ancestor: THREE.Object3D | null = child.parent;
    while (ancestor) {
      if (ancestor instanceof ENGINE.ModelMeshNode) {
        modelLoading = ancestor.isLoading();
        break;
      }
      ancestor = ancestor.parent;
    }
    patchEmptyGeometryObject(child, modelLoading, phaseLabel);
  });
}

/** Log every visible mesh that still lacks a position attribute (diagnostic). */
export function diagnoseVisibleMeshesMissingPosition(
  world: ENGINE.World | null | undefined,
  phaseLabel: string,
): number {
  if (!world) {
    return 0;
  }
  let count = 0;
  traverseWorldRenderables(world, (child) => {
    if (!isRenderableWithGeometry(child) || !child.visible) {
      return;
    }
    if (!geometryMissingPosition(child)) {
      return;
    }
    count += 1;
    logMissingPositionMesh(child, false, phaseLabel);
    patchEmptyGeometryObject(child, false, phaseLabel);
  });
  if (count > 0) {
    console.warn(
      DIAGNOSTIC_LOG_PREFIX,
      `Found ${count} visible mesh(es) without position during ${phaseLabel}`,
    );
  }
  return count;
}

let missingPositionWarnHookInstalled = false;

/** When THREE.AttributeNode warns, scan the world and log the offending mesh path. */
export function installMissingPositionDiagnosticHook(
  world: ENGINE.World | null | undefined,
): void {
  if (!world || missingPositionWarnHookInstalled) {
    return;
  }
  missingPositionWarnHookInstalled = true;
  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const message = args.map((arg) => String(arg)).join(' ');
    if (message.includes('Vertex attribute "position" not found')) {
      diagnoseVisibleMeshesMissingPosition(world, 'THREE.AttributeNode-warn');
      hideMissingPositionMeshesInWorld(world, 'THREE.AttributeNode-warn');
    }
    originalWarn(...args);
  };
}

export function isMissingPositionMesh(object: THREE.Object3D): boolean {
  return object.userData[MISSING_POSITION_KEY] === true
    || object.userData.pendingEmptyPlaceholder === true;
}

function applyOrdinanceSignSharpnessSampling(node: ENGINE.ModelMeshNode): void {
  if (!isOrdinanceModelUrl(node.modelUrl)) {
    return;
  }
  for (const mesh of node.getAllMeshes()) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) {
        continue;
      }
      applyStableSampling((material as TexturedMaterial).map);
    }
  }
  sharpnessAppliedNodes.add(node);
}

/** Apply only non-visual sampling settings; never replace or relight a GLB material. */
export function applyOrdinanceSignSharpness(node: ENGINE.ModelMeshNode): void {
  hideMeshesMissingPosition(node);
  if (!node.visible) {
    return;
  }
  applyOrdinanceSignSharpnessSampling(node);
}

/** Call when a hidden ordinance board is revealed (delivery flow / day reset). */
export function applyOrdinanceSignSharpnessWhenRevealed(node: ENGINE.ModelMeshNode | null): void {
  if (!node) {
    return;
  }
  hideMeshesMissingPosition(node);
  if (sharpnessAppliedNodes.has(node)) {
    return;
  }
  applyOrdinanceSignSharpnessSampling(node);
}

function ensureMeshLoadedHook(node: ENGINE.ModelMeshNode): void {
  if (meshLoadHooks.has(node)) {
    return;
  }
  meshLoadHooks.add(node);
  node.onMeshLoaded.add(() => {
    hideMeshesMissingPosition(node);
    if (node.visible) {
      applyOrdinanceSignSharpnessWhenRevealed(node);
    }
  });
}

/** Register hooks + empty-geometry guard; defer texture mips until boards are visible. */
export async function refreshOrdinanceSignSharpness(
  world: ENGINE.World | null | undefined,
): Promise<number> {
  if (!world) {
    return 0;
  }

  let count = 0;
  for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
    ensureMeshLoadedHook(node);
    if (node.isLoading()) {
      await node.waitForLoad();
    }
    hideMeshesMissingPosition(node);
    if (!isOrdinanceModelUrl(node.modelUrl)) {
      continue;
    }
    count += 1;
    if (node.visible) {
      applyOrdinanceSignSharpnessWhenRevealed(node);
    }
  }
  hideMissingPositionMeshesInWorld(world);
  return count;
}

@ENGINE.GameClass()
export class OrdinanceSignSharpnessSystem extends ENGINE.SceneNode {
  private emptyGeometryScanFrames = 0;

  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({ name: 'OrdinanceSignSharpness', ...options });
  }

  public override postLoad(): void {
    super.postLoad();
    guardSceneGeometryEarly(this.getWorld(), 'OrdinanceSignSharpness.postLoad');
    void refreshOrdinanceSignSharpness(this.getWorld());
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    this.emptyGeometryScanFrames = 0;
    const world = this.getWorld();
    if (world) {
      installMissingPositionDiagnosticHook(world);
      hideMissingPositionMeshesInWorld(world, 'beginPlay');
      diagnoseVisibleMeshesMissingPosition(world, 'beginPlay');
    }
    void refreshOrdinanceSignSharpness(world);
    return true;
  }

  public override tickPostPhysics(_deltaTime: number): void {
    super.tickPostPhysics(_deltaTime);
    this.emptyGeometryScanFrames += 1;
    if (
      this.emptyGeometryScanFrames !== 1
      && this.emptyGeometryScanFrames !== 45
      && this.emptyGeometryScanFrames !== 120
    ) {
      return;
    }
    const world = this.getWorld();
    if (world) {
      hideMissingPositionMeshesInWorld(world);
    }
  }
}

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

const SILHOUETTE_GREEN = 0x39ff63;
/** Skip absurdly dense props (keeps hover hitch small). */
const MAX_WIRE_MESHES = 48;
/** Inflate so wires sit outside the solid surface (foliage needs more lift). */
const WIRE_SCALE = 1.012;
const WIRE_SCALE_FOLIAGE = 1.04;
const FOLIAGE_TARGET_NAME = /bush|tree|cherry|fern|grass/i;
/**
 * Climb / contact volumes parented under lamps, trams, trees, etc.
 * Never include these in the green hover wireframe.
 */
const OUTLINE_EXCLUDED_TRIGGER_NAME = /^(?:LampTrigger|TramTrigger|TramRoofTrigger|TreeTrigg+er|WireTrigger|CarRoofTrigger)(?:\s|$)/i;

type WireBinding = {
  node: ENGINE.MeshNode;
  source: THREE.Mesh;
  owner: ENGINE.ModelMeshNode | null;
};

/**
 * Green trimesh wireframe hover cue for pickups and axe dismantle targets.
 *
 * Uses MeshNode wireframes (Genesys-rendered) instead of raw LineSegments.
 * Geometry is built once per target; transforms sync each frame.
 */
export class HoverSilhouette {
  private target: THREE.Object3D | null = null;
  private wireMaterial: THREE.MeshBasicMaterial | null = null;
  private readonly bindings: WireBinding[] = [];
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly relativeMatrix = new THREE.Matrix4();
  private readonly scratchGeometry = new THREE.BoxGeometry(0.01, 0.01, 0.01);
  private loadToken = 0;

  public get activeTarget(): THREE.Object3D | null {
    return this.target;
  }

  public setTarget(world: ENGINE.World | null, target: THREE.Object3D | null): void {
    if (this.target === target) {
      return;
    }
    this.target = target;
    this.loadToken += 1;
    if (
      !world
      || !target
      || isOutlineExcludedTrigger(target)
    ) {
      this.disposeWires();
      return;
    }
    this.ensureMaterial();
    this.rebuildWires(world, target, this.loadToken);
    this.waitForPrefabMeshes(world, target, this.loadToken);
  }

  /** Copy source mesh poses onto wires — call once per frame while active. */
  public syncTransforms(): void {
    if (this.bindings.length === 0) {
      return;
    }
    for (const { node, source, owner } of this.bindings) {
      if (!source.parent) {
        node.visible = false;
        continue;
      }
      source.updateWorldMatrix(true, false);
      if (owner) {
        owner.updateWorldMatrix(true, false);
        this.relativeMatrix.copy(owner.matrixWorld).invert().multiply(source.matrixWorld);
        this.relativeMatrix.decompose(this.position, this.quaternion, this.scale);
      } else {
        source.matrixWorld.decompose(this.position, this.quaternion, this.scale);
      }
      node.position.copy(this.position);
      node.quaternion.copy(this.quaternion);
      const foliage = FOLIAGE_TARGET_NAME.test(this.target?.name ?? '');
      node.scale.copy(this.scale).multiplyScalar(foliage ? WIRE_SCALE_FOLIAGE : WIRE_SCALE);
      node.visible = source.visible;
    }
  }

  public clear(): void {
    this.target = null;
    this.loadToken += 1;
    this.disposeWires();
    this.wireMaterial?.dispose();
    this.wireMaterial = null;
    this.scratchGeometry.dispose();
  }

  private ensureMaterial(): void {
    if (this.wireMaterial) {
      return;
    }
    this.wireMaterial = new THREE.MeshBasicMaterial({
      color: SILHOUETTE_GREEN,
      wireframe: true,
      transparent: true,
      opacity: 0.95,
      // depthTest off so dense foliage (bushes) still shows the green cage
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }

  private waitForPrefabMeshes(
    world: ENGINE.World,
    target: THREE.Object3D,
    token: number,
  ): void {
    if (!(target instanceof ENGINE.SceneNode)) {
      return;
    }
    const models = target instanceof ENGINE.ModelMeshNode
      ? [target]
      : target.getNodes(ENGINE.ModelMeshNode);
    for (const model of models) {
      void model.waitForLoad().then(() => {
        if (token !== this.loadToken || this.target !== target) {
          return;
        }
        this.rebuildWires(world, target, token);
      });
    }
  }

  private rebuildWires(world: ENGINE.World, target: THREE.Object3D, token: number): void {
    if (token !== this.loadToken || !this.wireMaterial) {
      return;
    }
    this.disposeWires();

    const meshes = this.collectMeshes(target);
    if (meshes.length === 0) {
      return;
    }
    if (meshes.length > MAX_WIRE_MESHES) {
      meshes.sort((a, b) => triangleCount(b.mesh) - triangleCount(a.mesh));
      meshes.length = MAX_WIRE_MESHES;
    }

    for (const { mesh, owner } of meshes) {
      const node = ENGINE.MeshNode.create({
        name: 'Hover Trimesh Wire',
        geometry: mesh.geometry,
        material: this.wireMaterial,
        castShadow: false,
        receiveShadow: false,
        physicsOptions: { enabled: false },
      });
      node.renderOrder = 900;
      (owner ?? world).add(node);
      this.bindings.push({ node, source: mesh, owner });
    }
    this.syncTransforms();
  }

  private collectMeshes(root: THREE.Object3D): Array<{ mesh: THREE.Mesh; owner: ENGINE.ModelMeshNode | null }> {
    const meshes: Array<{ mesh: THREE.Mesh; owner: ENGINE.ModelMeshNode | null }> = [];
    const seen = new Set<THREE.Mesh>();

    const addMesh = (mesh: THREE.Mesh, owner: ENGINE.ModelMeshNode | null = null): void => {
      if (!mesh.geometry || seen.has(mesh) || !mesh.visible) {
        return;
      }
      if (isUnderOutlineExcludedTrigger(mesh)) {
        return;
      }
      seen.add(mesh);
      meshes.push({ mesh, owner });
    };

    if (root instanceof ENGINE.SceneNode) {
      const models = root instanceof ENGINE.ModelMeshNode
        ? [root]
        : [root, ...root.getNodes(ENGINE.ModelMeshNode)];
      for (const model of models) {
        if (!(model instanceof ENGINE.ModelMeshNode)) {
          continue;
        }
        if (isOutlineExcludedTrigger(model) || isUnderOutlineExcludedTrigger(model)) {
          continue;
        }
        for (const mesh of model.getAllMeshes()) {
          addMesh(mesh, model);
        }
      }
    }

    root.traverse((child) => {
      if (isOutlineExcludedTrigger(child)) {
        return;
      }
      if ((child as THREE.Mesh).isMesh) {
        addMesh(child as THREE.Mesh);
      }
    });

    return meshes;
  }

  private disposeWires(): void {
    for (const { node } of this.bindings.splice(0)) {
      // Detach shared source geometry before destroy so we do not dispose the prop.
      node.geometry = this.scratchGeometry;
      node.parent?.remove(node);
      node.destroy();
    }
  }
}

function triangleCount(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  if (!geometry) {
    return 0;
  }
  if (geometry.index) {
    return geometry.index.count / 3;
  }
  const positions = geometry.getAttribute('position');
  return positions ? positions.count / 3 : 0;
}

function isOutlineExcludedTrigger(object: THREE.Object3D): boolean {
  return OUTLINE_EXCLUDED_TRIGGER_NAME.test(object.name ?? '');
}

function isUnderOutlineExcludedTrigger(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (isOutlineExcludedTrigger(current)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

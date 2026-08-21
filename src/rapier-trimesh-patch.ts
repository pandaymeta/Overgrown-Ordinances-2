/**
 * Rapier play-mode crash: "expected instance of I1" while creating mesh colliders.
 *
 * Two engine/Rapier issues:
 * 1. scaleMeshColliderDesc uses Float32Array.map(), which returns a plain Array.
 * 2. ColliderDesc.trimesh → shape.intoRaw() returns undefined for meshes with
 *    empty indices or bad topology, and World.createCollider then asserts.
 *
 * Patch World.createCollider (prototype) to rebuild trimeshes with typed arrays
 * and topology-cleanup flags, and fall back to an AABB cuboid if Rapier rejects
 * the mesh so Play can still start.
 */

import type * as THREE from 'three';

const TRIMESH_SHAPE_TYPE = 6;

/**
 * DELETE_BAD_TOPOLOGY_TRIANGLES | MERGE_DUPLICATE_VERTICES |
 * DELETE_DEGENERATE_TRIANGLES | DELETE_DUPLICATE_TRIANGLES | FIX_INTERNAL_EDGES.
 * Internal-edge fixing prevents character-controller bumps on otherwise smooth trimeshes.
 */
const TRIMESH_CLEANUP_FLAGS = 4 | 16 | 32 | 64 | 144;

interface ColliderDescCtor {
  trimesh?: (vertices: Float32Array, indices: Uint32Array, flags?: number) => unknown;
  cuboid?: (hx: number, hy: number, hz: number) => unknown;
  convexHull?: (vertices: Float32Array) => unknown;
}

interface ColliderShapeLike {
  type?: number;
  vertices?: ArrayLike<number>;
  indices?: ArrayLike<number>;
  flags?: number;
}

interface ColliderDescLike {
  constructor?: ColliderDescCtor;
  shape?: ColliderShapeLike;
  translation?: { x: number; y: number; z: number };
  rotation?: unknown;
  density?: number;
  friction?: number;
  restitution?: number;
  isSensor?: boolean;
  enabled?: boolean;
  activeEvents?: number;
  activeCollisionTypes?: number;
  collisionGroups?: number;
  solverGroups?: number;
  mass?: number;
  setTranslation?: (x: number, y: number, z: number) => unknown;
  setRotation?: (rot: unknown) => unknown;
  setDensity?: (density: number) => unknown;
  setFriction?: (friction: number) => unknown;
  setRestitution?: (restitution: number) => unknown;
  setSensor?: (sensor: boolean) => unknown;
  setEnabled?: (enabled: boolean) => unknown;
  setActiveEvents?: (events: number) => unknown;
  setActiveCollisionTypes?: (types: number) => unknown;
  setCollisionGroups?: (groups: number) => unknown;
  setSolverGroups?: (groups: number) => unknown;
  setMass?: (mass: number) => unknown;
}

interface RapierWorldLike {
  createCollider?: (desc: unknown, parent?: unknown) => unknown;
  createRigidBody?: (desc: unknown) => unknown;
}

interface PhysicsEngineProto {
  scaleMeshColliderDesc?: (colliderDesc: unknown, scale: THREE.Vector3) => unknown;
  doCreateMeshBody?: (desc: unknown, scale: THREE.Vector3) => unknown;
  __overgrownTrimeshScalePatch?: boolean;
}

function toFloat32(values: ArrayLike<number>): Float32Array {
  return new Float32Array(values);
}

function toUint32(values: ArrayLike<number>): Uint32Array {
  return new Uint32Array(values);
}

function sequentialIndices(vertexCount: number): Uint32Array {
  const indices = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    indices[i] = i;
  }
  return indices;
}

function scaleVertices(src: ArrayLike<number>, scale: THREE.Vector3): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const axis = i % 3;
    out[i] = src[i] * (axis === 0 ? scale.x : axis === 1 ? scale.y : scale.z);
  }
  return out;
}

function copyColliderSettings(from: ColliderDescLike, to: ColliderDescLike): void {
  const t = from.translation;
  if (t && to.setTranslation) {
    to.setTranslation(t.x, t.y, t.z);
  }
  if (from.rotation && to.setRotation) {
    to.setRotation(from.rotation);
  }
  if (typeof from.density === 'number' && to.setDensity) {
    to.setDensity(from.density);
  }
  if (typeof from.friction === 'number' && to.setFriction) {
    to.setFriction(from.friction);
  }
  if (typeof from.restitution === 'number' && to.setRestitution) {
    to.setRestitution(from.restitution);
  }
  if (typeof from.isSensor === 'boolean' && to.setSensor) {
    to.setSensor(from.isSensor);
  }
  if (typeof from.enabled === 'boolean' && to.setEnabled) {
    to.setEnabled(from.enabled);
  }
  if (from.activeEvents != null && to.setActiveEvents) {
    to.setActiveEvents(from.activeEvents);
  }
  if (from.activeCollisionTypes != null && to.setActiveCollisionTypes) {
    to.setActiveCollisionTypes(from.activeCollisionTypes);
  }
  if (from.collisionGroups != null && to.setCollisionGroups) {
    to.setCollisionGroups(from.collisionGroups);
  }
  if (from.solverGroups != null && to.setSolverGroups) {
    to.setSolverGroups(from.solverGroups);
  }
  if (typeof from.mass === 'number' && from.mass > 0 && to.setMass) {
    to.setMass(from.mass);
  }
}

function cuboidFromVertices(ctor: ColliderDescCtor, vertices: ArrayLike<number>): ColliderDescLike | null {
  if (typeof ctor.cuboid !== 'function') {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) {
    return ctor.cuboid(0.5, 0.5, 0.5) as ColliderDescLike;
  }
  const hx = Math.max(0.05, (maxX - minX) * 0.5);
  const hy = Math.max(0.05, (maxY - minY) * 0.5);
  const hz = Math.max(0.05, (maxZ - minZ) * 0.5);
  const desc = ctor.cuboid(hx, hy, hz) as ColliderDescLike;
  desc.setTranslation?.((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
  return desc;
}

function rebuildTrimeshDesc(desc: ColliderDescLike): ColliderDescLike {
  const shape = desc.shape;
  const ctor = desc.constructor;
  if (!shape || !ctor || typeof ctor.trimesh !== 'function') {
    return desc;
  }
  if (shape.type !== undefined && shape.type !== TRIMESH_SHAPE_TYPE) {
    return desc;
  }
  if (!shape.vertices || shape.vertices.length < 9) {
    return cuboidFromVertices(ctor, shape.vertices ?? []) ?? desc;
  }

  const vertices = toFloat32(shape.vertices);
  const vertexCount = Math.floor(vertices.length / 3);
  let indices = shape.indices && shape.indices.length >= 3
    ? toUint32(shape.indices)
    : sequentialIndices(vertexCount);
  if (indices.length % 3 !== 0) {
    indices = sequentialIndices(vertexCount);
  }

  const rebuilt = ctor.trimesh(vertices, indices, TRIMESH_CLEANUP_FLAGS) as ColliderDescLike | null;
  if (!rebuilt?.shape) {
    const fallback = cuboidFromVertices(ctor, vertices) ?? desc;
    if (fallback !== desc) {
      copyColliderSettings(desc, fallback);
    }
    return fallback;
  }
  copyColliderSettings(desc, rebuilt);
  return rebuilt;
}

function findRapierWorld(physicsEngine: object): RapierWorldLike | null {
  const direct = (physicsEngine as { world?: RapierWorldLike }).world;
  if (direct && typeof direct.createCollider === 'function') {
    return direct;
  }
  for (const key of Object.getOwnPropertyNames(physicsEngine)) {
    const value = (physicsEngine as Record<string, unknown>)[key];
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as RapierWorldLike).createCollider === 'function' &&
      typeof (value as RapierWorldLike).createRigidBody === 'function'
    ) {
      return value as RapierWorldLike;
    }
  }
  return null;
}

function installCreateColliderPatch(physicsEngine: object): void {
  const world = findRapierWorld(physicsEngine);
  if (!world || typeof world.createCollider !== 'function') {
    return;
  }

  const proto = Object.getPrototypeOf(world) as RapierWorldLike & {
    __overgrownCreateColliderPatch?: boolean;
  };
  if (proto.__overgrownCreateColliderPatch) {
    return;
  }

  const original = proto.createCollider!;
  proto.createCollider = function patchedCreateCollider(this: unknown, desc: unknown, parent?: unknown) {
    let next = desc as ColliderDescLike;
    const shape = next?.shape;
    if (shape && (shape.type === TRIMESH_SHAPE_TYPE || (shape.vertices && shape.indices && shape.type !== 9))) {
      next = rebuildTrimeshDesc(next);
    } else if (shape?.vertices && !(shape.vertices instanceof Float32Array)) {
      shape.vertices = toFloat32(shape.vertices);
    }

    try {
      return original.call(this, next, parent);
    } catch (error) {
      const ctor = next?.constructor;
      const fallback = ctor ? cuboidFromVertices(ctor, next.shape?.vertices ?? []) : null;
      if (!fallback) {
        throw error;
      }
      copyColliderSettings(next, fallback);
      return original.call(this, fallback, parent);
    }
  };
  proto.__overgrownCreateColliderPatch = true;
}

function installScaleMeshColliderDescPatch(proto: PhysicsEngineProto): void {
  if (proto.__overgrownTrimeshScalePatch) {
    return;
  }

  let name = typeof proto.scaleMeshColliderDesc === 'function' ? 'scaleMeshColliderDesc' : null;
  let original = proto.scaleMeshColliderDesc;
  if (!original) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      const value = (proto as Record<string, unknown>)[key];
      if (typeof value !== 'function' || key === 'constructor') {
        continue;
      }
      const src = Function.prototype.toString.call(value);
      if (src.includes('trimesh') && src.includes('map(')) {
        name = key;
        original = value as PhysicsEngineProto['scaleMeshColliderDesc'];
        break;
      }
    }
  }
  if (!name || typeof original !== 'function') {
    return;
  }

  const wrapped = function (this: unknown, colliderDesc: unknown, scale: THREE.Vector3): unknown {
    const desc = colliderDesc as ColliderDescLike | null;
    const shape = desc?.shape;
    const ctor = desc?.constructor;
    const needsScale = scale && !(scale.x === 1 && scale.y === 1 && scale.z === 1);
    if (needsScale && shape?.vertices && ctor) {
      const scaledVerts = scaleVertices(shape.vertices, scale);
      if (shape.type === TRIMESH_SHAPE_TYPE || (shape.indices && typeof ctor.trimesh === 'function')) {
        const vertexCount = Math.floor(scaledVerts.length / 3);
        const indices = shape.indices && shape.indices.length >= 3
          ? toUint32(shape.indices)
          : sequentialIndices(vertexCount);
        const scaled = ctor.trimesh?.(scaledVerts, indices, TRIMESH_CLEANUP_FLAGS) as ColliderDescLike | undefined;
        if (scaled) {
          const t = desc.translation;
          if (t && scaled.setTranslation) {
            scaled.setTranslation(t.x * scale.x, t.y * scale.y, t.z * scale.z);
          }
          return scaled;
        }
      }
      if (typeof ctor.convexHull === 'function' && shape.type !== TRIMESH_SHAPE_TYPE) {
        const scaled = ctor.convexHull(scaledVerts) as ColliderDescLike | null;
        if (scaled) {
          const t = desc.translation;
          if (t && scaled.setTranslation) {
            scaled.setTranslation(t.x * scale.x, t.y * scale.y, t.z * scale.z);
          }
          return scaled;
        }
      }
    }
    return original!.call(this, colliderDesc, scale);
  };

  (proto as Record<string, unknown>)[name] = wrapped;
  proto.scaleMeshColliderDesc = wrapped;
  proto.__overgrownTrimeshScalePatch = true;
}

function installDoCreateMeshBodyGuard(proto: PhysicsEngineProto): void {
  if (typeof proto.doCreateMeshBody === 'function') {
    const original = proto.doCreateMeshBody;
    proto.doCreateMeshBody = function (this: unknown, desc: unknown, scale: THREE.Vector3) {
      try {
        return original.call(this, desc, scale);
      } catch {
        return null;
      }
    };
    return;
  }

  for (const key of Object.getOwnPropertyNames(proto)) {
    const value = (proto as Record<string, unknown>)[key];
    if (typeof value !== 'function' || key === 'constructor') {
      continue;
    }
    const src = Function.prototype.toString.call(value);
    if (src.includes('createBody') && src.includes('meshes')) {
      const original = value as (...args: unknown[]) => unknown;
      (proto as Record<string, unknown>)[key] = function (this: unknown, ...args: unknown[]) {
        try {
          return original.apply(this, args);
        } catch {
          return null;
        }
      };
      break;
    }
  }
}

export function patchTrimeshColliderScale(physicsEngine: object | null | undefined): void {
  if (!physicsEngine) {
    return;
  }

  const proto = Object.getPrototypeOf(physicsEngine) as PhysicsEngineProto;
  installScaleMeshColliderDescPatch(proto);
  installDoCreateMeshBodyGuard(proto);
  installCreateColliderPatch(physicsEngine);
}

/**
 * Inspector trimesh changes rebuild colliders immediately, before Play.
 * Hook PrimitiveNode / BaseGameLoop so the Rapier typed-array patch is installed
 * in the editor world, not only after the first Play session.
 */
export function installEditorTrimeshPatch(engine: typeof import('@gnsx/genesys.js')): void {
  const primitiveProto = engine.PrimitiveNode.prototype as unknown as {
    onEditorPropertyChanged?: (...args: unknown[]) => void;
    onEditorAddToWorld?: () => void;
    refreshPhysicsBody?: () => void;
    getPhysicsEngine?: () => object | null;
    __overgrownEditorTrimeshHook?: boolean;
  };
  if (!primitiveProto.__overgrownEditorTrimeshHook) {
    primitiveProto.__overgrownEditorTrimeshHook = true;

    const wrapPrimitive = (methodName: 'onEditorPropertyChanged' | 'onEditorAddToWorld' | 'refreshPhysicsBody'): void => {
      const original = primitiveProto[methodName];
      if (typeof original !== 'function') {
        return;
      }
      primitiveProto[methodName] = function (this: { getPhysicsEngine?: () => object | null }, ...args: unknown[]) {
        patchTrimeshColliderScale(this.getPhysicsEngine?.() ?? null);
        return original.apply(this, args);
      };
    };

    wrapPrimitive('onEditorPropertyChanged');
    wrapPrimitive('onEditorAddToWorld');
    wrapPrimitive('refreshPhysicsBody');
  }

  const loopProto = engine.BaseGameLoop.prototype as unknown as {
    ensurePhysicsEngine?: (world: unknown) => Promise<void>;
    physicsEngine?: object | null;
    __overgrownEditorTrimeshLoopHook?: boolean;
  };
  if (!loopProto.__overgrownEditorTrimeshLoopHook && typeof loopProto.ensurePhysicsEngine === 'function') {
    loopProto.__overgrownEditorTrimeshLoopHook = true;
    const originalEnsure = loopProto.ensurePhysicsEngine;
    loopProto.ensurePhysicsEngine = async function (this: { physicsEngine?: object | null }, world: unknown) {
      const result = await originalEnsure.call(this, world);
      patchTrimeshColliderScale(this.physicsEngine ?? null);
      return result;
    };
  }
}

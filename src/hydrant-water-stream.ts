import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';
import { AsphaltRoadTile } from './asphalt-road-tile.js';

const OUTLET_HEIGHT_RATIO = 0.32;
const OUTLET_FORWARD_RATIO = 0.14;
const ARC_HEIGHT = 1.85;
const MIN_RANGE = 7;
const MAX_RANGE = 7;
const STREAM_SAMPLES = 28;
const DROPLET_COUNT = 10;
const ROAD_SAMPLE_DISTANCES = [1.5, 3, 4.5, 6, 8, 10, 12];
const WALK_COLLIDER_WIDTH = 0.5;
const WALK_COLLIDER_THICKNESS = 0.12;
const WALK_CLEARANCE_FROM_NOZZLE = 2.3;
const PAWN_RADIUS = 0.5;
const PAWN_HEIGHT = 1.9;

interface WaterDroplet {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  phase: number;
  speed: number;
}

interface PendingWalkSegment {
  start: THREE.Vector3;
  end: THREE.Vector3;
}

/** Persistent arcing hydrant spray from a side outlet across the nearest open ground. */
export class HydrantWaterStream {
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly landing = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly viewDirection = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly samplePoint = new THREE.Vector3();
  private readonly bounds = new THREE.Box3();
  private readonly size = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly segmentTangent = new THREE.Vector3();
  private readonly segmentRight = new THREE.Vector3();
  private readonly segmentNormal = new THREE.Vector3();
  private readonly segmentMid = new THREE.Vector3();
  private readonly basisMatrix = new THREE.Matrix4();
  private readonly segmentQuat = new THREE.Quaternion();
  private readonly pawnPosition = new THREE.Vector3();
  private readonly points: THREE.Vector3[] = [];

  private ribbon: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private splash: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> | null = null;
  private readonly droplets: WaterDroplet[] = [];
  private readonly walkColliders: ENGINE.MeshNode[] = [];
  private readonly pendingWalkSegments: PendingWalkSegment[] = [];
  private world: ENGINE.World | null = null;
  private elapsed = 0;
  private destroyed = false;

  public start(world: ENGINE.World, hydrant: ENGINE.ModelMeshNode, camera: THREE.Camera): void {
    this.destroyed = false;
    this.world = world;
    this.chooseSprayPath(hydrant);
    this.buildPoints();
    this.createRibbon(world);
    this.createSplash(world);
    this.createDroplets(world);
    this.createWalkColliders(world);
    this.update(0, camera);
  }

  public update(deltaTime: number, camera: THREE.Camera): void {
    if (this.destroyed || !this.ribbon) {
      return;
    }
    this.elapsed += deltaTime;
    camera.getWorldPosition(this.cameraPosition);
    this.ribbon.geometry.dispose();
    this.ribbon.geometry = this.createStreamGeometry();
    if (this.splash) {
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(this.elapsed * 9));
      this.splash.scale.setScalar(0.55 + pulse * 0.35);
      this.splash.material.opacity = 0.25 + pulse * 0.2;
    }
    for (const droplet of this.droplets) {
      droplet.phase = (droplet.phase + deltaTime * droplet.speed) % 1;
      this.sampleArc(droplet.phase, this.samplePoint);
      this.samplePoint.x += Math.sin(this.elapsed * 7 + droplet.phase * 12) * 0.04;
      this.samplePoint.z += Math.cos(this.elapsed * 6 + droplet.phase * 9) * 0.04;
      droplet.mesh.position.copy(this.samplePoint);
      droplet.mesh.scale.setScalar(0.07 + (1 - droplet.phase) * 0.08);
    }
    this.trySpawnPendingWalkColliders();
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.ribbon) {
      this.ribbon.removeFromParent();
      this.ribbon.geometry.dispose();
      this.ribbon.material.dispose();
      this.ribbon = null;
    }
    if (this.splash) {
      this.splash.removeFromParent();
      this.splash.geometry.dispose();
      this.splash.material.dispose();
      this.splash = null;
    }
    for (const droplet of this.droplets) {
      droplet.mesh.removeFromParent();
      droplet.mesh.geometry.dispose();
      droplet.mesh.material.dispose();
    }
    this.droplets.length = 0;
    for (const collider of this.walkColliders) {
      collider.destroy();
    }
    this.walkColliders.length = 0;
    this.pendingWalkSegments.length = 0;
    this.world = null;
  }

  private chooseSprayPath(hydrant: ENGINE.ModelMeshNode): void {
    this.bounds.setFromObject(hydrant);
    this.bounds.getCenter(this.center);
    this.bounds.getSize(this.size);
    const world = hydrant.getWorld();
    const physicsEngine = hydrant.getPhysicsEngine();
    const ignoredRootNodes = this.collectIgnoredNodes(hydrant, world);
    const roadBounds = this.collectRoadBounds(world);
    this.origin.copy(this.center);
    this.origin.y = this.bounds.min.y + this.size.y * OUTLET_HEIGHT_RATIO;

    let bestScore = Number.NEGATIVE_INFINITY;
    let bestRange = MIN_RANGE;
    this.direction.set(1, 0, 0);
    const candidate = new THREE.Vector3();
    const probe = new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0);
    for (let index = 0; index < 8; index++) {
      const angle = index * Math.PI * 0.25;
      candidate.set(Math.cos(angle), 0, Math.sin(angle));
      const hit = physicsEngine?.performHitTest({
        origin: this.origin,
        direction: candidate,
        maxDistance: MAX_RANGE,
        stopOnFirstHit: true,
        ignoredRootNodes,
      })[0];
      const clearance = hit ? this.origin.distanceTo(hit.hitLocation) : MAX_RANGE;
      let roadSamples = 0;
      let lastRoadDistance = 0;
      let stepsOntoRoad = false;
      for (const sampleDistance of ROAD_SAMPLE_DISTANCES) {
        if (sampleDistance >= clearance) {
          break;
        }
        probe.copy(this.origin).addScaledVector(candidate, sampleDistance);
        if (!this.isOverRoad(probe, roadBounds)) {
          continue;
        }
        roadSamples += 1;
        lastRoadDistance = sampleDistance;
        if (sampleDistance <= 3) {
          stepsOntoRoad = true;
        }
      }

      // Sidewalk hydrants should cross the asphalt, not spray into the building.
      let score = roadSamples * 25 + Math.min(clearance, MAX_RANGE) * 0.1;
      if (stepsOntoRoad) {
        score += 50;
      }
      if (score > bestScore) {
        bestScore = score;
        this.direction.copy(candidate);
        bestRange = lastRoadDistance > 0
          ? THREE.MathUtils.clamp(lastRoadDistance + 1.7, MIN_RANGE, MAX_RANGE)
          : THREE.MathUtils.clamp(clearance * 0.92, MIN_RANGE, MAX_RANGE);
      }
    }

    this.direction.negate();
    const flippedHit = physicsEngine?.performHitTest({
      origin: this.origin,
      direction: this.direction,
      maxDistance: MAX_RANGE,
      stopOnFirstHit: true,
      ignoredRootNodes,
    })[0];
    const flippedClearance = flippedHit
      ? this.origin.distanceTo(flippedHit.hitLocation)
      : MAX_RANGE;
    const usableClearance = flippedClearance < 4 ? MAX_RANGE : flippedClearance;
    bestRange = THREE.MathUtils.clamp(usableClearance, MIN_RANGE, MAX_RANGE);
    this.origin.addScaledVector(this.direction, this.size.x * OUTLET_FORWARD_RATIO);
    this.landing.copy(this.origin).addScaledVector(this.direction, bestRange);

    const groundHit = physicsEngine?.performHitTest({
      origin: this.landing.clone().setY(this.origin.y + 4),
      direction: down,
      maxDistance: 12,
      stopOnFirstHit: true,
      ignoredRootNodes,
    })[0];
    this.landing.y = groundHit?.hitLocation.y ?? this.bounds.min.y;
  }

  private collectIgnoredNodes(
    hydrant: ENGINE.ModelMeshNode,
    world: ENGINE.World | null,
  ): ENGINE.SceneNode[] {
    const ignored: ENGINE.SceneNode[] = [hydrant];
    if (!world) {
      return ignored;
    }
    for (const pawn of world.getNodes(ENGINE.CharacterPawn)) {
      ignored.push(pawn);
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (/^Street Lamp/i.test(node.name ?? '')) {
        ignored.push(node);
      }
    }
    return ignored;
  }

  private collectRoadBounds(world: ENGINE.World | null): THREE.Box3[] {
    if (!world) {
      return [];
    }
    const boxes: THREE.Box3[] = [];
    for (const tile of world.getNodes(AsphaltRoadTile)) {
      const box = new THREE.Box3().setFromObject(tile);
      if (!box.isEmpty()) {
        boxes.push(box);
      }
    }
    return boxes;
  }

  private isOverRoad(point: THREE.Vector3, roadBounds: THREE.Box3[]): boolean {
    for (const box of roadBounds) {
      if (
        point.x >= box.min.x
        && point.x <= box.max.x
        && point.z >= box.min.z
        && point.z <= box.max.z
      ) {
        return true;
      }
    }
    return false;
  }

  private buildPoints(): void {
    this.points.length = 0;
    for (let index = 0; index <= STREAM_SAMPLES; index++) {
      const t = index / STREAM_SAMPLES;
      this.points.push(this.sampleArc(t, new THREE.Vector3()));
    }
  }

  private sampleArc(t: number, target: THREE.Vector3): THREE.Vector3 {
    target.lerpVectors(this.origin, this.landing, t);
    target.y = THREE.MathUtils.lerp(this.origin.y, this.landing.y, t)
      + ARC_HEIGHT * 4 * t * (1 - t);
    return target;
  }

  private createWalkColliders(world: ENGINE.World): void {
    this.pendingWalkSegments.length = 0;
    for (let index = 0; index < this.points.length - 1; index++) {
      const start = this.points[index];
      const end = this.points[index + 1];
      this.segmentMid.lerpVectors(start, end, 0.5);
      const fromNozzle = Math.hypot(
        this.segmentMid.x - this.origin.x,
        this.segmentMid.z - this.origin.z,
      );
      if (fromNozzle < WALK_CLEARANCE_FROM_NOZZLE) {
        continue;
      }
      if (this.overlapsAnyPawn(world, start, end)) {
        this.pendingWalkSegments.push({
          start: start.clone(),
          end: end.clone(),
        });
        continue;
      }
      this.createWalkSegment(world, start, end, WALK_COLLIDER_WIDTH, WALK_COLLIDER_THICKNESS);
    }
  }

  private trySpawnPendingWalkColliders(): void {
    const world = this.world;
    if (!world || this.pendingWalkSegments.length === 0) {
      return;
    }
    for (let index = this.pendingWalkSegments.length - 1; index >= 0; index--) {
      const segment = this.pendingWalkSegments[index];
      if (this.overlapsAnyPawn(world, segment.start, segment.end)) {
        continue;
      }
      this.createWalkSegment(
        world,
        segment.start,
        segment.end,
        WALK_COLLIDER_WIDTH,
        WALK_COLLIDER_THICKNESS,
      );
      this.pendingWalkSegments.splice(index, 1);
    }
  }

  private overlapsAnyPawn(
    world: ENGINE.World,
    start: THREE.Vector3,
    end: THREE.Vector3,
  ): boolean {
    this.segmentMid.lerpVectors(start, end, 0.5);
    const radius = WALK_COLLIDER_WIDTH * 0.5 + PAWN_RADIUS;
    for (const pawn of world.getNodes(ENGINE.CharacterPawn)) {
      pawn.getWorldPosition(this.pawnPosition);
      const horizontal = Math.hypot(
        this.segmentMid.x - this.pawnPosition.x,
        this.segmentMid.z - this.pawnPosition.z,
      );
      if (horizontal > radius) {
        continue;
      }
      const pawnMinY = this.pawnPosition.y;
      const pawnMaxY = this.pawnPosition.y + PAWN_HEIGHT;
      const segmentMinY = Math.min(start.y, end.y) - WALK_COLLIDER_THICKNESS;
      const segmentMaxY = Math.max(start.y, end.y) + WALK_COLLIDER_THICKNESS;
      if (segmentMaxY >= pawnMinY && segmentMinY <= pawnMaxY) {
        return true;
      }
    }
    return false;
  }

  private createWalkSegment(
    world: ENGINE.World,
    start: THREE.Vector3,
    end: THREE.Vector3,
    width: number,
    thickness: number,
  ): void {
    this.segmentTangent.copy(end).sub(start);
    const length = this.segmentTangent.length();
    if (length < 0.08) {
      return;
    }
    this.segmentTangent.multiplyScalar(1 / length);
    this.segmentRight.crossVectors(this.segmentTangent, this.worldUp);
    if (this.segmentRight.lengthSq() < 1e-6) {
      this.segmentRight.set(1, 0, 0);
    } else {
      this.segmentRight.normalize();
    }
    this.segmentNormal.crossVectors(this.segmentRight, this.segmentTangent).normalize();
    this.segmentMid.lerpVectors(start, end, 0.5);
    this.segmentMid.addScaledVector(this.segmentNormal, -thickness * 0.4);

    this.basisMatrix.makeBasis(this.segmentRight, this.segmentNormal, this.segmentTangent);
    this.segmentQuat.setFromRotationMatrix(this.basisMatrix);

    const collider = ENGINE.MeshNode.create({
      name: 'HydrantWaterWalk',
      isRoot: true,
      geometry: new THREE.BoxGeometry(width, thickness, length),
      selfHidden: true,
      castShadow: false,
      receiveShadow: false,
      physicsOptions: {
        enabled: true,
        motionType: ENGINE.PhysicsMotionType.Static,
        collisionMeshType: ENGINE.CollisionMeshType.BoundingBox,
      },
    });
    collider.position.copy(this.segmentMid);
    collider.quaternion.copy(this.segmentQuat);
    world.add(collider);
    this.walkColliders.push(collider);
  }

  private createRibbon(world: ENGINE.World): void {
    this.ribbon = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x4eb8ff,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.ribbon.name = 'HydrantWaterStream';
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 900;
    this.ribbon.setTransient(true);
    world.add(this.ribbon);
  }

  private createSplash(world: ENGINE.World): void {
    this.splash = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 16),
      new THREE.MeshBasicMaterial({
        color: 0x7ecbff,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.splash.name = 'HydrantWaterSplash';
    this.splash.rotation.x = -Math.PI / 2;
    this.splash.position.copy(this.landing);
    this.splash.position.y += 0.03;
    this.splash.frustumCulled = false;
    this.splash.renderOrder = 899;
    this.splash.setTransient(true);
    world.add(this.splash);
  }

  private createDroplets(world: ENGINE.World): void {
    for (let index = 0; index < DROPLET_COUNT; index++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 8, 8),
        new THREE.MeshBasicMaterial({
          color: 0x9ad8ff,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        }),
      );
      mesh.name = 'HydrantWaterDroplet';
      mesh.frustumCulled = false;
      mesh.renderOrder = 901;
      mesh.setTransient(true);
      world.add(mesh);
      this.droplets.push({
        mesh,
        phase: index / DROPLET_COUNT,
        speed: 0.55 + (index % 4) * 0.12,
      });
    }
  }

  private createStreamGeometry(): THREE.BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let index = 0; index < this.points.length; index++) {
      const point = this.points[index];
      const previous = this.points[Math.max(0, index - 1)];
      const next = this.points[Math.min(this.points.length - 1, index + 1)];
      this.tangent.copy(next).sub(previous);
      if (this.tangent.lengthSq() < 1e-8) {
        this.tangent.copy(this.direction);
      } else {
        this.tangent.normalize();
      }
      this.viewDirection.copy(this.cameraPosition).sub(point);
      if (this.viewDirection.lengthSq() < 1e-8) {
        this.side.set(0, 1, 0);
      } else {
        this.viewDirection.normalize();
        this.side.crossVectors(this.tangent, this.viewDirection);
        if (this.side.lengthSq() < 1e-8) {
          this.side.set(0, 1, 0);
        } else {
          this.side.normalize();
        }
      }

      const progress = this.points.length > 1 ? index / (this.points.length - 1) : 1;
      const pulse = 0.7 + 0.3 * Math.sin(progress * 16 - this.elapsed * 12);
      const halfWidth = (0.11 * (1 - progress * 0.55) + 0.03) * pulse;
      positions.push(
        point.x + this.side.x * halfWidth,
        point.y + this.side.y * halfWidth,
        point.z + this.side.z * halfWidth,
        point.x - this.side.x * halfWidth,
        point.y - this.side.y * halfWidth,
        point.z - this.side.z * halfWidth,
      );
      if (index < this.points.length - 1) {
        const base = index * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

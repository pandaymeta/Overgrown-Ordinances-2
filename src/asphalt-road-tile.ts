/**
 * Remixable Polyfork asphalt road tile. Knobs rebuild vertex-colored geometry
 * (lane markings, junctions, colorways) — this asset has no textures.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

// Polyfork ships an untyped three.js factory. Keep the original file; type it here.
// @ts-expect-error untyped catalog module
import { createAsset, presets } from './polyfork/asphalt-road-tile-f6593c.js';

type AsphaltRoadPiece = 'straight' | 'corner' | 't-junction' | 'crossroads' | 'end';
type AsphaltRoadLines = 'none' | 'centre' | 'edges' | 'both';
type AsphaltRoadPour = 'none' | 'step' | 'tone';
type AsphaltRoadColorway = 'city-asphalt' | 'fresh-blacktop' | 'sun-faded' | 'pale-concrete';
type AsphaltRoadLayout = 'patchwork' | 'courses' | 'blocks';

const COLORWAYS = presets as Record<AsphaltRoadColorway, {
  asphalt: string;
  patchLight: string;
  patchDark: string;
  base: string;
  paint: string;
}>;

const KNOB_PATHS = new Set([
  'piece',
  'lines',
  'pour',
  'crossing',
  'colorway',
  'asphalt',
  'patchLight',
  'patchDark',
  'base',
  'paint',
  'layout',
  'patchCount',
]);

@ENGINE.GameClass()
export class AsphaltRoadTile extends ENGINE.MeshNode {
  constructor() {
    super();
    this.isRoot = true;
  }

  @ENGINE.property({
    type: 'enum',
    options: ['straight', 'corner', 't-junction', 'crossroads', 'end'],
    category: 'Road',
    description: 'Which 4 m road piece to build. Geometry is rebuilt, not rotated.',
  })
  public piece: AsphaltRoadPiece = 'straight';

  @ENGINE.property({
    type: 'enum',
    options: ['none', 'centre', 'edges', 'both'],
    category: 'Road',
    description: 'Painted lane markings as real geometry, 2 mm proud of the asphalt.',
  })
  public lines: AsphaltRoadLines = 'none';

  @ENGINE.property({
    type: 'enum',
    options: ['none', 'step', 'tone'],
    category: 'Road',
    description: 'Junction pour. Does nothing on a straight piece.',
  })
  public pour: AsphaltRoadPour = 'none';

  @ENGINE.property({
    type: 'boolean',
    category: 'Road',
    description: 'Zebra crossing bars across the carriageway.',
  })
  public crossing: boolean = false;

  @ENGINE.property({
    type: 'enum',
    options: ['city-asphalt', 'fresh-blacktop', 'sun-faded', 'pale-concrete'],
    category: 'Look',
    description: 'Curated color scheme. Sets all zone colours at once.',
  })
  public colorway: AsphaltRoadColorway = 'city-asphalt';

  @ENGINE.property({ type: 'color', category: 'Look', description: 'Road surface colour.' })
  public asphalt: string = '#3C4145';

  @ENGINE.property({ type: 'color', category: 'Look', description: 'Older, lighter patch colour (needs Patch count 1+).' })
  public patchLight: string = '#4E5459';

  @ENGINE.property({ type: 'color', category: 'Look', description: 'Newer, darker patch colour (needs Patch count 1+).' })
  public patchDark: string = '#2E3134';

  @ENGINE.property({ type: 'color', category: 'Look', description: 'Sub-base / underside colour.' })
  public base: string = '#E4E2DC';

  @ENGINE.property({ type: 'color', category: 'Look', description: 'Lane marking and zebra paint colour.' })
  public paint: string = '#F2EFE7';

  @ENGINE.property({
    type: 'enum',
    options: ['patchwork', 'courses', 'blocks'],
    category: 'Look',
    description: 'Paving layout. Only visible when Patch count is 1 or more.',
  })
  public layout: AsphaltRoadLayout = 'patchwork';

  @ENGINE.property({
    type: 'number',
    min: 0,
    max: 10,
    step: 1,
    category: 'Look',
    description: 'Patch divisions per axis. 0 is a clean flat road.',
  })
  public patchCount: number = 0;

  public override initialize(options?: ENGINE.MeshNodeOptions): void {
    super.initialize({
      ...options,
      physicsOptions: {
        enabled: true,
        motionType: ENGINE.PhysicsMotionType.Static,
        collisionMeshType: ENGINE.CollisionMeshType.BoundingBox,
        ...options?.physicsOptions,
      },
    });
    this.receiveShadow = true;
    this.rebuildMesh();
  }

  public override postLoad(): void {
    super.postLoad();
    this.rebuildMesh();
  }

  public override onEditorPropertyChanged(
    path: string,
    value: unknown,
    result: ENGINE.EditorPropertyChangedResult,
  ): void {
    super.onEditorPropertyChanged(path, value, result);
    if (!KNOB_PATHS.has(path)) {
      return;
    }

    if (path === 'colorway') {
      this.applyColorway(this.colorway);
      result.refreshInspector = true;
    }

    this.rebuildMesh();
  }

  private applyColorway(colorway: AsphaltRoadColorway): void {
    const preset = COLORWAYS[colorway];
    if (!preset) {
      return;
    }
    this.asphalt = preset.asphalt;
    this.patchLight = preset.patchLight;
    this.patchDark = preset.patchDark;
    this.base = preset.base;
    this.paint = preset.paint;
  }

  private rebuildMesh(): void {
    const group = createAsset({
      piece: this.piece,
      lines: this.lines,
      pour: this.pour,
      crossing: this.crossing,
      colorway: this.colorway,
      asphalt: this.toHex(this.asphalt),
      patchLight: this.toHex(this.patchLight),
      patchDark: this.toHex(this.patchDark),
      base: this.toHex(this.base),
      paint: this.toHex(this.paint),
      layout: this.layout,
      patchCount: this.patchCount,
    }) as THREE.Group;

    const generated = this.findGeneratedMesh(group);
    if (!generated) {
      return;
    }

    generated.removeFromParent();

    const previousGeometry = this.geometry;
    const previousMaterial = this.mesh.material;
    const nextMaterial = generated.material;
    this.geometry = generated.geometry;
    if (nextMaterial instanceof THREE.Material) {
      this.material = nextMaterial;
      this.mesh.material = nextMaterial;
    }
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;

    if (previousGeometry !== this.geometry) {
      previousGeometry.dispose();
    }
    if (previousMaterial instanceof THREE.Material && previousMaterial !== nextMaterial) {
      previousMaterial.dispose();
    }
  }

  private findGeneratedMesh(root: THREE.Object3D): THREE.Mesh | null {
    if (root instanceof THREE.Mesh) {
      return root;
    }
    for (const child of root.children) {
      const mesh = this.findGeneratedMesh(child);
      if (mesh) {
        return mesh;
      }
    }
    return null;
  }

  private toHex(value: unknown): string {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    if (value instanceof THREE.Color) {
      return `#${value.getHexString()}`;
    }
    if (value && typeof value === 'object' && 'r' in value && 'g' in value && 'b' in value) {
      const color = value as { r: number; g: number; b: number };
      return `#${new THREE.Color(color.r, color.g, color.b).getHexString()}`;
    }
    return '#3C4145';
  }
}

/**
 * Unlit signboard material that stays sharp at distance.
 * Default mipmapped filtering softens ordinance graphics when the board is small on screen;
 * this keeps Linear (non-mip) sampling + high anisotropy after the texture finishes loading.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';

@ENGINE.GameClass({
  isNodeMaterialAsset: true,
  nodeMaterialDisplayName: 'Sharp Sign Board',
  nodeMaterialGroup: 'Game Signs',
})
export class SharpSignBoardMaterial extends ENGINE.NodeMaterialAsset(MeshBasicNodeMaterial) {
  @ENGINE.property({ type: 'color', description: 'Tint multiplied with the sign map' })
  override color = new THREE.Color(1, 1, 1);

  @ENGINE.property({ type: 'texturePath', description: 'Sign graphic (PNG map)' })
  mapPath = '';

  @ENGINE.property({
    type: 'number',
    min: 1,
    max: 16,
    step: 1,
    description: 'Anisotropic filtering amount (helps angled / distant boards)',
  })
  anisotropy = 16;

  @ENGINE.property({
    type: 'boolean',
    description: 'Disable mipmaps for max still sharpness (causes shimmer when moving). Prefer off.',
  })
  sharpAtDistance = false;

  constructor() {
    super();
    this.rebuild();
  }

  private applySharpSampling(texture: ENGINE.UrlTexture | THREE.Texture | null | undefined): void {
    if (!texture) {
      return;
    }
    const anisotropy = this.clampFiniteNumber(this.anisotropy, 1, 16, 16);
    texture.magFilter = THREE.LinearFilter;
    if (this.sharpAtDistance) {
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
    } else {
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
    }
    texture.anisotropy = anisotropy;
    texture.needsUpdate = true;
  }

  override rebuild(): void {
    try {
      this.applyCommonMaterialState();
      this.anisotropy = this.clampFiniteNumber(this.anisotropy, 1, 16, 16);
      this.mapPath = this.coerceTexturePath(this.mapPath);
      this.syncTexturePath('map', this.mapPath, THREE.SRGBColorSpace, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping);

      const map = (this as unknown as { map?: ENGINE.UrlTexture | null }).map ?? null;
      this.applySharpSampling(map);
      if (map && 'loadPromise' in map && map.loadPromise) {
        void map.loadPromise.then(() => {
          this.applySharpSampling(map);
          this.needsUpdate = true;
        });
      }

      this.colorNode = null;
      this.needsUpdate = true;
    } catch (error) {
      console.error('[SharpSignBoardMaterial] rebuild failed', error);
      this.needsUpdate = true;
    }
  }

  public serialize(dumper: ENGINE.IDumper): void {
    this.serializeAuthoredFields(dumper);
  }

  public static staticDeserialize(_data: unknown, loader: ENGINE.ILoader): SharpSignBoardMaterial {
    const instance = new SharpSignBoardMaterial();
    SharpSignBoardMaterial.loadAuthoredFields(instance, loader);
    instance.rebuild();
    return instance;
  }
}

ENGINE.registerSpecialization({
  cls: SharpSignBoardMaterial,
  serializeFn: (obj, dumper) => obj.serialize(dumper),
  staticDeserializeFn: (data, loader) => SharpSignBoardMaterial.staticDeserialize(data, loader),
});

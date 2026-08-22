import * as THREE from 'three';

const TEXTURE_WIDTH = 768;
const TEXTURE_HEIGHT = 512;
const BORDER_SIZE = 52;
const STRIPE_LENGTH = 78;
const STRIPE_SLANT = 22;
const AIRMAIL_RED = '#e9494d';
const AIRMAIL_BLUE = '#1689b5';

function drawHorizontalStripes(
  context: CanvasRenderingContext2D,
  y: number,
  direction: 1 | -1,
): void {
  let stripeIndex = 0;
  for (let x = -STRIPE_LENGTH; x < TEXTURE_WIDTH + STRIPE_LENGTH; x += STRIPE_LENGTH) {
    const slant = STRIPE_SLANT * direction;
    context.fillStyle = stripeIndex % 2 === 0 ? AIRMAIL_RED : AIRMAIL_BLUE;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + STRIPE_LENGTH * 0.68, y);
    context.lineTo(x + STRIPE_LENGTH * 0.68 + slant, y + BORDER_SIZE);
    context.lineTo(x + slant, y + BORDER_SIZE);
    context.closePath();
    context.fill();
    stripeIndex += 1;
  }
}

function drawVerticalStripes(
  context: CanvasRenderingContext2D,
  x: number,
  direction: 1 | -1,
): void {
  let stripeIndex = 1;
  for (let y = -STRIPE_LENGTH; y < TEXTURE_HEIGHT + STRIPE_LENGTH; y += STRIPE_LENGTH) {
    const slant = STRIPE_SLANT * direction;
    context.fillStyle = stripeIndex % 2 === 0 ? AIRMAIL_RED : AIRMAIL_BLUE;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + BORDER_SIZE, y + slant);
    context.lineTo(x + BORDER_SIZE, y + STRIPE_LENGTH * 0.68 + slant);
    context.lineTo(x, y + STRIPE_LENGTH * 0.68);
    context.closePath();
    context.fill();
    stripeIndex += 1;
  }
}

function createAirmailTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create the airmail envelope texture.');
  }

  context.fillStyle = '#f7f5ef';
  context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  drawHorizontalStripes(context, 0, 1);
  drawHorizontalStripes(context, TEXTURE_HEIGHT - BORDER_SIZE, -1);
  drawVerticalStripes(context, 0, -1);
  drawVerticalStripes(context, TEXTURE_WIDTH - BORDER_SIZE, 1);

  // Keep the patterned bands crisp while preserving a warm paper-colored center.
  context.fillStyle = '#f7f5ef';
  context.fillRect(
    BORDER_SIZE,
    BORDER_SIZE,
    TEXTURE_WIDTH - BORDER_SIZE * 2,
    TEXTURE_HEIGHT - BORDER_SIZE * 2,
  );

  // Back-flap folds inspired by the reference envelope.
  const inset = BORDER_SIZE + 8;
  const centerX = TEXTURE_WIDTH / 2;
  const flapTipY = TEXTURE_HEIGHT * 0.57;
  const bottomY = TEXTURE_HEIGHT - inset;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 8;
  context.strokeStyle = 'rgba(116, 123, 128, 0.16)';
  context.beginPath();
  context.moveTo(inset, inset);
  context.lineTo(centerX, flapTipY);
  context.lineTo(TEXTURE_WIDTH - inset, inset);
  context.stroke();
  context.lineWidth = 5;
  context.strokeStyle = 'rgba(255, 255, 255, 0.82)';
  context.beginPath();
  context.moveTo(inset + 3, inset + 1);
  context.lineTo(centerX, flapTipY - 3);
  context.lineTo(TEXTURE_WIDTH - inset - 3, inset + 1);
  context.stroke();

  context.lineWidth = 5;
  context.strokeStyle = 'rgba(116, 123, 128, 0.13)';
  context.beginPath();
  context.moveTo(inset, bottomY);
  context.lineTo(centerX, flapTipY + 2);
  context.lineTo(TEXTURE_WIDTH - inset, bottomY);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function createAirmailEnvelope(
  width: number,
  height: number,
  depth: number,
  geometryOffset: THREE.Vector3 | null = null,
): THREE.Mesh {
  const texture = createAirmailTexture();
  const paper = {
    color: 0xffffff,
    roughness: 0.82,
    metalness: 0,
  } as const;
  const materials: THREE.Material[] = [
    new THREE.MeshStandardMaterial({ ...paper, color: 0xe8e3d8 }),
    new THREE.MeshStandardMaterial({ ...paper, color: 0xe8e3d8 }),
    new THREE.MeshStandardMaterial({ ...paper, map: texture }),
    new THREE.MeshStandardMaterial({ ...paper, map: texture }),
    new THREE.MeshStandardMaterial({ ...paper, color: 0xeeeae1 }),
    new THREE.MeshStandardMaterial({ ...paper, color: 0xeeeae1 }),
  ];
  const geometry = new THREE.BoxGeometry(width, height, depth);
  if (geometryOffset) {
    geometry.translate(geometryOffset.x, geometryOffset.y, geometryOffset.z);
  }
  return new THREE.Mesh(geometry, materials);
}

export function disposeAirmailEnvelope(mesh: THREE.Mesh): void {
  mesh.removeFromParent();
  mesh.geometry.dispose();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const textures = new Set<THREE.Texture>();
  for (const material of materials) {
    if (material instanceof THREE.MeshStandardMaterial && material.map) {
      textures.add(material.map);
    }
    material.dispose();
  }
  for (const texture of textures) {
    texture.dispose();
  }
}

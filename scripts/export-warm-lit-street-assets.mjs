import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Blob } from "node:buffer";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

// The Polyfork source modules are deliberately the source of truth.  They use
// bare Three.js imports, so this exporter makes a temporary, importable copy
// with those imports resolved against this project's installed Three.js.
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(ROOT, "..");
const CATALOG = "C:/Users/Reyjhon Entenia/Downloads/polyfork-catalog";
const OUTPUT = path.join(PROJECT, "assets", "PolyforkAssets");
// This is the same warm sodium colour used by the re-exported street-lamp
// lens below.  Keeping one constant prevents floors from drifting to
// different yellows when the source buildings use separate glazing zones.
const LAMP_GLOW = "#FFD36A";
const LAMP_GLOW_COLOR = new THREE.Color(LAMP_GLOW);
const THREE_URL = pathToFileURL(path.join(PROJECT, "node_modules", "three", "build", "three.module.js")).href;
const MERGE_URL = pathToFileURL(path.join(PROJECT, "node_modules", "three", "examples", "jsm", "utils", "BufferGeometryUtils.js")).href;

globalThis.Blob = Blob;
globalThis.FileReader = class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    }, (error) => {
      this.onerror?.(error);
      this.onloadend?.({ target: this });
    });
  }
};

const assets = [
  { source: "two-storey-shophouse-183790.mjs", output: "two-storey-shophouse-183790.glb" },
  { source: "wide-shophouse-089f20.mjs", output: "wide-shophouse-089f20.glb" },
  { source: "corner-shophouse-ad15c2.mjs", output: "corner-shophouse-ad15c2.glb", paneKey: "pane" },
  { source: "three-storey-shophouse-2f6378.mjs", output: "three-storey-shophouse-2f6378.glb" },
];

const warmWindowParams = (paneKey = "glass", shopKey = "shopGlass") => ({
  [paneKey]: LAMP_GLOW,
  [shopKey]: LAMP_GLOW,
  interior: LAMP_GLOW,
});

function copyTriangleSet(source, triangles, omitColor = false) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (omitColor && name === "color") continue;
    const values = new attribute.array.constructor(triangles.length * 3 * attribute.itemSize);
    let write = 0;
    for (const triangle of triangles) {
      const start = triangle * 3 * attribute.itemSize;
      values.set(attribute.array.subarray(start, start + 3 * attribute.itemSize), write);
      write += 3 * attribute.itemSize;
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function splitOutLuminousWindows(group) {
  group.traverse((node) => {
    if (!node.isMesh || !node.geometry?.getAttribute("color")) return;
    const source = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    const colors = source.getAttribute("color");
    const luminous = [];
    const remaining = [];

    for (let triangle = 0; triangle < colors.count / 3; triangle += 1) {
      let isWindow = true;
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const index = triangle * 3 + vertex;
        const red = colors.getX(index) - LAMP_GLOW_COLOR.r;
        const green = colors.getY(index) - LAMP_GLOW_COLOR.g;
        const blue = colors.getZ(index) - LAMP_GLOW_COLOR.b;
        if (red * red + green * green + blue * blue > 0.000001) {
          isWindow = false;
          break;
        }
      }
      (isWindow ? luminous : remaining).push(triangle);
    }

    if (!luminous.length) return;
    node.geometry.dispose();
    node.geometry = copyTriangleSet(source, remaining);

    const glowingWindowMesh = new THREE.Mesh(
      copyTriangleSet(source, luminous, true),
      new THREE.MeshStandardMaterial({
        color: LAMP_GLOW_COLOR,
        emissive: LAMP_GLOW_COLOR,
        emissiveIntensity: 0.95,
        roughness: 0.72,
        metalness: 0,
        flatShading: true,
      }),
    );
    glowingWindowMesh.name = `${node.name || "building"}-luminous-windows`;
    glowingWindowMesh.castShadow = false;
    glowingWindowMesh.receiveShadow = false;
    node.add(glowingWindowMesh);
  });
}

async function exportGroup(group, outputPath) {
  const exporter = new GLTFExporter();
  const binary = await new Promise((resolve, reject) => {
    exporter.parse(group, resolve, reject, { binary: true });
  });
  fs.writeFileSync(outputPath, Buffer.from(binary));
}

async function importSource(source) {
  const original = fs.readFileSync(path.join(CATALOG, source), "utf8")
    .replace(/from ['"]three['"]/g, `from '${THREE_URL}'`)
    .replace(/from ['"]three\/addons\/utils\/BufferGeometryUtils\.js['"]/g, `from '${MERGE_URL}'`);
  const temp = path.join(os.tmpdir(), `overgrown-${source}-${Date.now()}.mjs`);
  fs.writeFileSync(temp, original, "utf8");
  return import(`${pathToFileURL(temp).href}?v=${Date.now()}`);
}

for (const asset of assets) {
  const { createAsset } = await importSource(asset.source);
  const group = createAsset(warmWindowParams(asset.paneKey, asset.source === "corner-shophouse-ad15c2.mjs" ? "shop" : "shopGlass"));
  splitOutLuminousWindows(group);
  await exportGroup(group, path.join(OUTPUT, asset.output));
  console.log(`Exported warm windows: ${asset.output}`);
}

// Street lamp has a dedicated lens mesh/material and already defines a warm
// emissive source.  Re-export it from the MJS so every placed instance updates.
const lamp = await importSource("street-lamp-29f365.mjs");
const lampGroup = lamp.createAsset({ lens: LAMP_GLOW });
await exportGroup(lampGroup, path.join(OUTPUT, "street-lamp-29f365.glb"));
console.log("Exported warm emissive street lamps: street-lamp-29f365.glb");

import fs from "node:fs";
import path from "node:path";
import { Blob } from "node:buffer";
import { fileURLToPath } from "node:url";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { createAsset } from "./street-lamp-29f365.mjs";

globalThis.Blob = Blob;

globalThis.FileReader = class FileReader {
  constructor() {
    this.result = null;
    this.onload = null;
    this.onloadend = null;
    this.onerror = null;
  }
  readAsArrayBuffer(blob) {
    const finish = (buf) => {
      this.result = buf;
      const ev = { target: this };
      this.onload?.(ev);
      this.onloadend?.(ev);
    };
    const fail = (err) => {
      this.onerror?.(err);
      this.onloadend?.({ target: this });
    };
    try {
      if (blob instanceof ArrayBuffer) {
        queueMicrotask(() => finish(blob));
        return;
      }
      if (typeof blob?.arrayBuffer === "function") {
        blob.arrayBuffer().then(finish, fail);
        return;
      }
      if (ArrayBuffer.isView(blob)) {
        queueMicrotask(() => finish(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength)));
        return;
      }
      fail(new Error(`Unsupported blob type: ${Object.prototype.toString.call(blob)}`));
    } catch (err) {
      fail(err);
    }
  }
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogGlb = "C:/Users/Reyjhon Entenia/Downloads/polyfork-catalog/street-lamp-29f365.glb";
const projectGlb = path.resolve(__dirname, "../assets/PolyforkAssets/street-lamp-29f365.glb");

const group = createAsset();
const exporter = new GLTFExporter();
const arrayBuffer = await new Promise((resolve, reject) => {
  exporter.parse(group, resolve, reject, { binary: true });
});
const buf = Buffer.from(arrayBuffer);
fs.writeFileSync(catalogGlb, buf);
fs.writeFileSync(projectGlb, buf);
const lens = group.children.find((c) => c.name === "street-lamp-lens");
console.log(`Wrote ${buf.length} bytes to catalog + project`);
console.log(`children=${group.children.map((c) => c.name).join(",")}`);
console.log(`lens emissive=${lens?.material?.emissive?.getHexString()} intensity=${lens?.material?.emissiveIntensity}`);

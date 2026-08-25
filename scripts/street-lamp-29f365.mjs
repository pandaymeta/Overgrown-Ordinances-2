/*
 * Street Lamp
 * https://polyfork.dev/asset/street-lamp-29f365
 *
 * A parametric low-poly model for three.js: one import, no loader, no
 * textures, one draw call. createAsset() returns a ready THREE.Group.
 *
 * QUICK START
 *
 *   import { createAsset } from './street-lamp-29f365.mjs';
 *   scene.add(createAsset());
 *
 * The bare "three" specifiers below resolve through any bundler, or through
 * an importmap in your page:
 *
 *   { "imports": { "three": "https://unpkg.com/three@0.180.0/build/three.module.js",
 *                  "three/addons/": "https://unpkg.com/three@0.180.0/examples/jsm/" } }
 *
 * Browsers refuse to load ES modules from file:// URLs, so a page of your own
 * that imports this file has to be served over http:  python3 -m http.server
 *
 * The index.html in this asset's .zip download sidesteps that and opens with
 * a double-click. The store page above has the same snippet for Unity, Godot,
 * Blender and GLB.
 *
 * OPTIONS  createAsset({ ... })
 *
 *   colorway     choice  'galvanised'   'galvanised' | 'charcoal' | 'moss-green' | 'cream'
 *   foot         color   '#4e5459'      any hex or THREE.Color
 *   post         color   '#8a9197'      any hex or THREE.Color
 *   collar       color   '#6b7278'      any hex or THREE.Color
 *   head         color   '#a9afb4'      any hex or THREE.Color
 *   lens         color   '#2e3134'      any hex or THREE.Color
 *   tallness     range   1              0.78 to 1.12
 *   postSides    choice  'chamfered'    'square' | 'chamfered' | 'hex'
 *   lanternSize  range   1              0.8 to 1.3
 *
 * Every option is described in full at https://polyfork.dev/cdn/street-lamp-29f365-params.json
 *
 * SPECS  378 triangles, 1 material, 0.85 x 5 x 1.99 m (real-world scale).
 *
 * LICENSE  Personal and commercial use: games, apps, client work. Modify
 *          freely, no attribution required. Do not resell or redistribute
 *          the file itself as an asset. Terms: https://polyfork.dev/licensing
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Warm sodium glazing — lamp reads "on" (matches `night.lens`). */
const LENS_ON = 0xf0c24b;

const BASE = {
  foot:   0x4e5459,
  collar: 0x6b7278,
  post:   0x8a9197,
  head:   0xa9afb4,
  lens:   LENS_ON,
};

const COLORWAYS = {

  'galvanised':  { foot: 0x4e5459, collar: 0x6b7278, post: 0x8a9197, head: 0xa9afb4, lens: LENS_ON },
  'charcoal':    { foot: 0x1b1d20, collar: 0x3c4145, post: 0x4e5459, head: 0x8a9197, lens: LENS_ON },
  'moss-green':  { foot: 0x2e3134, collar: 0x2f6b4f, post: 0x3f8a5e, head: 0xc7cbcc, lens: LENS_ON },
  'cream':       { foot: 0x8c7355, collar: 0xb9a88c, post: 0xe4e2dc, head: 0xf2efe7, lens: LENS_ON },
};
export const presets = COLORWAYS;

export const params = {
  colorway: {
    type: 'choice', default: 'galvanised', label: 'Colorway',
    options: ['galvanised', 'charcoal', 'moss-green', 'cream'],
    describe: 'curated kit-coherent scheme; sets foot, collar, post, lantern and glass '
      + 'together. galvanised is the pale grey municipal lamp of the reference; charcoal '
      + 'is a near-black steel post with a grey lantern; moss-green is a painted dark '
      + 'green post under a near-white lantern; cream is a warm painted post for the '
      + 'shrine end of the block.',
  },
  foot: {
    type: 'color', default: 0x4e5459, label: 'Foot casting',
    describe: 'albedo of the square ground plinth only. Keep it the darkest tone on the '
      + 'asset — it is what visually pins a 5 m mast to the pavement.',
  },
  post: {
    type: 'color', default: 0x8a9197, label: 'Post & arm',
    describe: 'albedo of the whole steel run: lower column, flared taper, upper shaft, '
      + 'elbow and arm. The dominant colour of the asset by a wide margin.',
  },
  collar: {
    type: 'color', default: 0x6b7278, label: 'Fittings',
    describe: 'albedo of the two bolt-on fittings — the proud collar band where the taper '
      + 'meets the shaft, and the mounting boss where the arm lands on the lantern cap. A '
      + 'small accent; keep it a clear value step darker than the post or it disappears.',
  },
  head: {
    type: 'color', default: 0xa9afb4, label: 'Lantern frame',
    describe: 'albedo of the lantern cap, its stepped roof, the wide brim, the frame '
      + 'between the glazed panels and the bottom rim. The lightest mass on the asset, '
      + 'so the head reads against the post from 10 m.',
  },
  lens: {
    type: 'color', default: LENS_ON, label: 'Glazing',
    describe: 'albedo of the four recessed glass panels and the diffuser under the '
      + 'lantern. Warm sodium yellow when lit (night.lens); keep it clearly warmer than '
      + 'the frame around it so the fixture reads as turned on.',
  },
  tallness: {
    type: 'range', default: 1.0, min: 0.78, max: 1.12, label: 'Mast height',
    affects: 'geometry',
    describe: 'rebuilds the straight upper shaft ONLY: the foot, lower column, taper, '
      + 'collar, elbow, arm and lantern all keep their exact size and ride up with it. '
      + 'Total height runs 4.46 m (a low alley lamp) to 5.29 m (a main-street mast). '
      + 'Nothing repeats along a lamp mast — there are no rungs or bays to multiply — so '
      + 'this knob changes ONE member\'s length and no triangles, which is the honest '
      + 'rebuild for this subject; use postSides for a knob that rebuilds the section.',
  },
  postSides: {
    type: 'choice', default: 'chamfered', label: 'Post section',
    options: ['square', 'chamfered', 'hex'], affects: 'geometry',
    describe: 'cross-section of the entire swept run — foot column, taper, shaft, elbow '
      + 'and arm — at a constant flat-to-flat width. square = 4 flats with sharp arrises, '
      + 'the raw reference profile; chamfered = a square with its four corners cut back '
      + '30% (8 flats), the kit\'s crisp-chamfer default; hex = 6 flats, a chunkier cast '
      + 'pole. Triangle count moves with it (88 / 176 / 132 in the sweep).',
  },
  lanternSize: {
    type: 'range', default: 1.0, min: 0.8, max: 1.3, label: 'Lantern size',
    affects: 'geometry',
    describe: 'rebuilds the hanging lantern at a different size about its cap, which '
      + 'stays welded under the arm. At 0.8 the head is a neat 0.68 m box for a back '
      + 'alley; at 1.3 it is a 1.10 m civic lantern that dominates the mast. The post, '
      + 'elbow and arm reach are untouched, so this changes the head-to-mast ratio '
      + '(16% of the height at 1.0, 20% at 1.3).',
  },
};

const FOOT_W   = 0.285;
const FOOT_TOP = 0.250;
const FOOT_H   = 0.145;
const COL_R    = 0.172;
const COL_TOP  = 1.300;
const TAPER_TOP = 1.980;
const SHAFT_R  = 0.094;
const COLLAR_R = 0.124;
const SHAFT_BASE = 2.060;
const SHAFT_LEN  = 2.440;
const ARC_RUN  = 0.420;
const ARC_RISE = 0.400;
const ARC_SEGS = 4;
const ARM_R    = 0.092;
const HEAD_X   = 1.280;

const BOSS_HW  = 0.125;
const BOSS_X   = 1.145;
const HATCH_Y0 = 0.420, HATCH_Y1 = 0.800, HATCH_W = 0.140, HATCH_D = 0.028;

const CAP_TOP   = [0.000, 0.150];
const CAP_STEP  = [0.060, 0.240];
const CAP_RISER = [0.080, 0.240];
const CAP_EAVE  = [0.140, 0.330];
const BRIM_TOP  = [0.180, 0.425];
const BRIM_BOT  = [0.245, 0.425];
const GLASS_TOP = [0.260, 0.355];
const GLASS_BOT = [0.720, 0.205];
const RIM_TOP   = [0.725, 0.225];
const RIM_BOT   = [0.775, 0.225];
const DIFFUSER  = [0.760, 0.190];

const HEX_R = 1 / Math.cos(Math.PI / 6);
const SECTIONS = {
  square: [[1, 1], [-1, 1], [-1, -1], [1, -1]],
  chamfered: [[1, 0.7], [0.7, 1], [-0.7, 1], [-1, 0.7], [-1, -0.7], [-0.7, -1], [0.7, -1], [1, -0.7]],
  hex: [0, 1, 2, 3, 4, 5].map(k => {
    const a = (k + 0.5) * Math.PI / 3;
    return [Math.cos(a) * HEX_R, Math.sin(a) * HEX_R];
  }),
};

const MAT = new THREE.MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0,
});
/** Separate lens material so only the glazing emits — body stays non-emissive. */
const MAT_LENS = new THREE.MeshStandardMaterial({
  name: 'street-lamp-lens',
  vertexColors: true,
  flatShading: true,
  roughness: 0.45,
  metalness: 0,
  color: new THREE.Color(LENS_ON),
  emissive: new THREE.Color('#f0c24b'),
  emissiveIntensity: 0.95,
  toneMapped: false,
});
function prep(geo, hex) {
  if (geo.index) geo = geo.toNonIndexed();
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function tri(out, a, b, c) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
function posGeo(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function face(out, pts, ref) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const p = (nx * ref[0] + ny * ref[1] + nz * ref[2]) < 0 ? pts.slice().reverse() : pts;
  for (let i = 1; i < p.length - 1; i++) tri(out, p[0], p[i], p[i + 1]);
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
function norm(a) { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function sweepTube(stations, sect, skip = {}) {
  const n = stations.length, seg = sect.length;
  const dirs = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = stations[i + 1].x - stations[i].x, dy = stations[i + 1].y - stations[i].y;
    const L = Math.hypot(dx, dy) || 1;
    dirs.push([dx / L, dy / L]);
  }
  const U = [];
  for (let i = 0; i < n; i++) {
    const a = dirs[Math.max(0, i - 1)], b = dirs[Math.min(dirs.length - 1, i)];
    const tx = a[0] + b[0], ty = a[1] + b[1];
    const L = Math.hypot(tx, ty) || 1;
    U.push([-ty / L, tx / L]);
  }
  const rings = stations.map((s, i) => sect.map(([u, v]) =>
    [s.x + U[i][0] * u * s.r, s.y + U[i][1] * u * s.r, v * s.r]));
  const buckets = new Map();
  for (let i = 0; i < n - 1; i++) {
    const c = stations[i + 1].c;
    if (!buckets.has(c)) buckets.set(c, []);
    const out = buckets.get(c);
    const A = rings[i], B = rings[i + 1];
    const ux = (U[i][0] + U[i + 1][0]) / 2, uy = (U[i][1] + U[i + 1][1]) / 2;
    for (let k = 0; k < seg; k++) {
      if (skip[i] && skip[i].has(k)) continue;
      const k2 = (k + 1) % seg;
      const du = (sect[k][0] + sect[k2][0]) / 2, dv = (sect[k][1] + sect[k2][1]) / 2;
      face(out, [A[k], A[k2], B[k2], B[k]], [ux * du, uy * du, dv]);
    }
  }
  return { buckets, rings, U };
}

function insetPanel(a0, a1, b1, b0, s0, s1, t0, t1, depth, outRef) {
  const P = (s, t) => {
    const lo = [a0[0] + (a1[0] - a0[0]) * s, a0[1] + (a1[1] - a0[1]) * s, a0[2] + (a1[2] - a0[2]) * s];
    const hi = [b0[0] + (b1[0] - b0[0]) * s, b0[1] + (b1[1] - b0[1]) * s, b0[2] + (b1[2] - b0[2]) * s];
    return [lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, lo[2] + (hi[2] - lo[2]) * t];
  };
  const sDir = norm(sub(P(1, 0.5), P(0, 0.5)));
  const tDir = norm(sub(P(0.5, 1), P(0.5, 0)));
  let nrm = norm(cross(sDir, tDir));
  if (nrm[0] * outRef[0] + nrm[1] * outRef[1] + nrm[2] * outRef[2] < 0) nrm = mul(nrm, -1);
  const Q = (s, t) => sub(P(s, t), mul(nrm, depth));

  const frame = [], walls = [], floor = [];
  face(frame, [P(0, 0), P(1, 0), P(1, t0), P(0, t0)], nrm);
  face(frame, [P(0, t1), P(1, t1), P(1, 1), P(0, 1)], nrm);
  face(frame, [P(0, t0), P(s0, t0), P(s0, t1), P(0, t1)], nrm);
  face(frame, [P(s1, t0), P(1, t0), P(1, t1), P(s1, t1)], nrm);
  face(walls, [P(s0, t0), P(s0, t1), Q(s0, t1), Q(s0, t0)], sDir);
  face(walls, [P(s1, t0), P(s1, t1), Q(s1, t1), Q(s1, t0)], mul(sDir, -1));
  face(walls, [P(s0, t0), P(s1, t0), Q(s1, t0), Q(s0, t0)], tDir);
  face(walls, [P(s0, t1), P(s1, t1), Q(s1, t1), Q(s0, t1)], mul(tDir, -1));
  face(floor, [Q(s0, t0), Q(s1, t0), Q(s1, t1), Q(s0, t1)], nrm);
  return { frame, walls, floor };
}

const sqRing = (cx, y, h) => [[cx + h, y, h], [cx - h, y, h], [cx - h, y, -h], [cx + h, y, -h]];

function loftBand(out, A, B, cx, outSign = 1) {
  for (let k = 0; k < A.length; k++) {
    const k2 = (k + 1) % A.length;
    const mx = (A[k][0] + A[k2][0] + B[k][0] + B[k2][0]) / 4 - cx;
    const mz = (A[k][2] + A[k2][2] + B[k][2] + B[k2][2]) / 4;
    const L = Math.hypot(mx, mz) || 1;
    const hA = Math.hypot(A[k][0] - cx, A[k][2]), hB = Math.hypot(B[k][0] - cx, B[k][2]);
    const dy = B[k][1] - A[k][1], dh = hB - hA, s = dy >= 0 ? 1 : -1;
    face(out, [A[k], A[k2], B[k2], B[k]],
      [(mx / L) * Math.abs(dy) * outSign, -dh * s * outSign, (mz / L) * Math.abs(dy) * outSign]);
  }
}

const nd = (hex, k) => (hex & 0xffff00) | Math.max(0, Math.min(255, (hex & 0xff) + k));

export function createAsset(userParams = {}) {
  const p = {};
  for (const k of Object.keys(params)) p[k] = params[k].default;
  Object.assign(p, userParams);

  const C = { ...BASE, ...(COLORWAYS[p.colorway] || {}) };
  for (const k of ['foot', 'post', 'collar', 'head', 'lens']) {
    if (userParams[k] !== undefined) C[k] = userParams[k];
  }
  const Z = { ...C };

  if (Z.collar === Z.post) Z.collar = nd(Z.collar, -1);
  if (Z.foot === Z.post) Z.foot = nd(Z.foot, -1);
  if (Z.head === Z.post) Z.head = nd(Z.head, 1);
  if (Z.lens === Z.head) Z.lens = nd(Z.lens, -1);

  const sect = SECTIONS[p.postSides] || SECTIONS.chamfered;
  const k = p.lanternSize;

  const shaftTop = SHAFT_BASE + SHAFT_LEN * p.tallness;
  const armY = shaftTop + ARC_RISE;
  const capTop = armY;

  const bodyParts = [];
  const lensParts = [];
  const addPart = (g, c, bucket = 'body') => {
    if (!g.length) return;
    (bucket === 'lens' ? lensParts : bodyParts).push({ g: posGeo(g), c });
  };

  const st = [
    { x: 0, y: 0.115, r: COL_R, c: Z.post },
    { x: 0, y: COL_TOP, r: COL_R, c: Z.post },
    { x: 0, y: TAPER_TOP, r: SHAFT_R, c: Z.post },
    { x: 0, y: TAPER_TOP + 0.002, r: COLLAR_R, c: Z.collar },
    { x: 0, y: SHAFT_BASE - 0.002, r: COLLAR_R, c: Z.collar },
    { x: 0, y: SHAFT_BASE, r: SHAFT_R, c: Z.collar },
    { x: 0, y: shaftTop, r: SHAFT_R, c: Z.post },
  ];

  for (let i = 1; i <= ARC_SEGS; i++) {
    const t = (i / ARC_SEGS) * Math.PI / 2;
    st.push({
      x: ARC_RUN * (1 - Math.cos(t)),
      y: shaftTop + ARC_RISE * Math.sin(t),
      r: SHAFT_R + (ARM_R - SHAFT_R) * (i / ARC_SEGS),
      c: Z.post,
    });
  }
  st.push({ x: HEAD_X - 0.040, y: armY, r: ARM_R, c: Z.post });

  const front = (() => {
    let best = 0, bx = -Infinity;
    for (let i = 0; i < sect.length; i++) {
      const i2 = (i + 1) % sect.length;

      const mx = -(sect[i][0] + sect[i2][0]) / 2;
      if (mx > bx) { bx = mx; best = i; }
    }
    return best;
  })();
  const { buckets, rings } = sweepTube(st, sect, { 0: new Set([front]) });
  for (const [c, pos] of buckets) addPart(pos, c);

  {
    const f2 = (front + 1) % sect.length;
    const A = rings[0], B = rings[1];
    const y0 = st[0].y, y1 = st[1].y;
    const W = Math.hypot(A[f2][0] - A[front][0], A[f2][2] - A[front][2]);
    const si = Math.max(0.08, (1 - HATCH_W / W) / 2);
    const t0 = (HATCH_Y0 - y0) / (y1 - y0), t1 = (HATCH_Y1 - y0) / (y1 - y0);
    const du = (sect[front][0] + sect[f2][0]) / 2, dv = (sect[front][1] + sect[f2][1]) / 2;
    const panel = insetPanel(A[front], A[f2], B[f2], B[front],
      si, 1 - si, t0, t1, HATCH_D, [-du, 0, dv]);
    addPart(panel.frame, Z.post);
    addPart(panel.walls, Z.post);
    addPart(panel.floor, Z.collar);
  }

  {
    const g = [];
    const r0 = sqRing(0, 0, FOOT_W), r1 = sqRing(0, 0.062, FOOT_W);
    const r2 = sqRing(0, 0.092, FOOT_TOP), r3 = sqRing(0, FOOT_H, FOOT_TOP);
    loftBand(g, r0, r1, 0);
    loftBand(g, r1, r2, 0);
    loftBand(g, r2, r3, 0);
    face(g, r3, [0, 1, 0]);
    face(g, r0, [0, -1, 0]);
    addPart(g, Z.foot);
  }

  const ring = ([d, h]) => sqRing(HEAD_X, capTop - d * k, h * k);
  const rCapTop = ring(CAP_TOP), rStep = ring(CAP_STEP), rRiser = ring(CAP_RISER);
  const rEave = ring(CAP_EAVE), rBrimT = ring(BRIM_TOP), rBrimB = ring(BRIM_BOT);
  const rGlassT = ring(GLASS_TOP), rGlassB = ring(GLASS_BOT);
  const rRimT = ring(RIM_TOP), rRimB = ring(RIM_BOT), rDiff = ring(DIFFUSER);

  {
    const g = [];
    face(g, rCapTop, [0, 1, 0]);
    loftBand(g, rCapTop, rStep, HEAD_X);
    loftBand(g, rStep, rRiser, HEAD_X);
    loftBand(g, rRiser, rEave, HEAD_X);
    loftBand(g, rEave, rBrimT, HEAD_X);
    loftBand(g, rBrimT, rBrimB, HEAD_X);
    loftBand(g, rBrimB, rGlassT, HEAD_X);
    loftBand(g, rGlassB, rRimT, HEAD_X);
    loftBand(g, rRimT, rRimB, HEAD_X);
    loftBand(g, rRimB, rDiff, HEAD_X, -1);
    addPart(g, Z.head);
  }

  {
    const frame = [], walls = [], glass = [];
    for (let i = 0; i < 4; i++) {
      const i2 = (i + 1) % 4;
      const mx = (rGlassB[i][0] + rGlassB[i2][0]) / 2 - HEAD_X;
      const mz = (rGlassB[i][2] + rGlassB[i2][2]) / 2;
      const panel = insetPanel(rGlassB[i], rGlassB[i2], rGlassT[i2], rGlassT[i],
        0.12, 0.88, 0.08, 0.92, 0.030, [mx, 0, mz]);
      frame.push(...panel.frame); walls.push(...panel.walls); glass.push(...panel.floor);
    }
    addPart(frame, Z.head);
    addPart(walls, Z.head);
    addPart(glass, Z.lens, 'lens');
  }
  {
    const g = [];
    face(g, rDiff, [0, -1, 0]);
    addPart(g, Z.lens, 'lens');
  }

  {
    const cx = BOSS_X, y0 = armY - 0.100, y1 = armY + 0.100;
    const a = sqRing(cx, y0, BOSS_HW), b = sqRing(cx, y1, BOSS_HW);
    const g = [];
    loftBand(g, a, b, cx);
    face(g, b, [0, 1, 0]);
    addPart(g, Z.collar);
  }

  // Sync lens material to the resolved glazing colour (night sodium by default).
  MAT_LENS.color.set(Z.lens);
  MAT_LENS.emissive.set(Z.lens);
  MAT_LENS.emissiveIntensity = 0.95;

  function finishGeo(parts) {
    const merged = mergeGeometries(parts.map(q => prep(q.g, q.c)));
    merged.computeVertexNormals();
    merged.rotateY(-Math.PI / 2);
    return merged;
  }

  const bodyMerged = finishGeo(bodyParts);
  const lensMerged = lensParts.length ? finishGeo(lensParts) : null;

  // Shared origin from the full mast (body + lens) so parts stay aligned.
  bodyMerged.computeBoundingBox();
  const bb = bodyMerged.boundingBox.clone();
  if (lensMerged) {
    lensMerged.computeBoundingBox();
    bb.union(lensMerged.boundingBox);
  }
  const ox = -(bb.min.x + bb.max.x) / 2;
  const oy = -bb.min.y;
  const oz = -(bb.min.z + bb.max.z) / 2;
  bodyMerged.translate(ox, oy, oz);
  if (lensMerged) lensMerged.translate(ox, oy, oz);

  const mesh = new THREE.Mesh(bodyMerged, MAT);
  mesh.name = 'street-lamp-body';

  const g = new THREE.Group();
  g.name = 'street-lamp';
  g.add(mesh);
  if (lensMerged) {
    const lensMesh = new THREE.Mesh(lensMerged, MAT_LENS.clone());
    lensMesh.name = 'street-lamp-lens';
    g.add(lensMesh);
  }
  return g;
}

export const rig = {};
export const detach = [];

export const night = {
  lens: { color: '#f0c24b', intensity: 0.95, describe: 'warm sodium lamp behind the four glazed panels' },
};

export default createAsset;

/*
 * Asphalt Road Tile
 * https://polyfork.dev/asset/asphalt-road-tile-f6593c
 *
 * A parametric low-poly model for three.js: one import, no loader, no
 * textures, one draw call. createAsset() returns a ready THREE.Group.
 *
 * QUICK START
 *
 *   import { createAsset } from './asphalt-road-tile-f6593c.mjs';
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
 *   piece       choice  'straight'     'straight' | 'corner' | 't-junction' | 'crossroads' | 'end'
 *   lines       choice  'none'         'none' | 'centre' | 'edges' | 'both'
 *   pour        choice  'none'         'none' | 'step' | 'tone'
 *   crossing    toggle  false          true | false
 *   colorway    choice  'city-asphalt' 'city-asphalt' | 'fresh-blacktop' | 'sun-faded' | 'pale-concrete'
 *   asphalt     color   '#3C4145'      any hex or THREE.Color
 *   patchLight  color   '#4E5459'      any hex or THREE.Color
 *   patchDark   color   '#2E3134'      any hex or THREE.Color
 *   base        color   '#E4E2DC'      any hex or THREE.Color
 *   paint       color   '#F2EFE7'      any hex or THREE.Color
 *   layout      choice  'patchwork'    'patchwork' | 'courses' | 'blocks'
 *   patchCount  range   0              0 to 10
 *
 * Every option is described in full at https://polyfork.dev/cdn/asphalt-road-tile-f6593c-params.json
 *
 * SPECS  20 triangles, 1 material, 4 x 0.05 x 4 m (real-world scale).
 *
 * LICENSE  Personal and commercial use: games, apps, client work. Modify
 *          freely, no attribution required. Do not resell or redistribute
 *          the file itself as an asset. Terms: https://polyfork.dev/licensing
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SIZE = 4.0;
const HALF = SIZE / 2;
const THICK = 0.05;
const TOP_Y = 0.0;
const BOT_Y = TOP_Y - THICK;

const WEAR_BOT = BOT_Y + 0.026;

const COLORWAYS = {
  'city-asphalt':   { asphalt: '#3C4145', patchLight: '#4E5459', patchDark: '#2E3134', base: '#E4E2DC', paint: '#F2EFE7' },
  'fresh-blacktop': { asphalt: '#2E3134', patchLight: '#3C4145', patchDark: '#1B1D20', base: '#A9AFB4', paint: '#F2EFE7' },
  'sun-faded':      { asphalt: '#4E5459', patchLight: '#6B7278', patchDark: '#3C4145', base: '#E4E2DC', paint: '#F2EFE7' },
  'pale-concrete':  { asphalt: '#6B7278', patchLight: '#8A9197', patchDark: '#4E5459', base: '#E4E2DC', paint: '#F2EFE7' },
};
const COLOR_KEYS = ['asphalt', 'patchLight', 'patchDark', 'base', 'paint'];

const TONES = ['asphalt', 'patchLight', 'patchDark'];
const TONE_W = [0.50, 0.28, 0.22];

const DEF = {
  colorway: 'city-asphalt', layout: 'patchwork', patchCount: 0,
  piece: 'straight', lines: 'none', crossing: false, pour: 'none',
};
const RELIEF = { patchwork: 0.012, courses: 0.008, blocks: 0.018 };

function tri(out, a, b, c) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
function quad(out, a, b, c, d) { tri(out, a, b, c); tri(out, a, c, d); }
function posGeo(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
function prng(seed = 1) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function quadN(out, a, b, c, d, want) {
  if (dot(crs(sub(b, a), sub(c, a)), want) < 0) quad(out, d, c, b, a); else quad(out, a, b, c, d);
}

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

function finish(list) {
  const merged = mergeGeometries(list.filter(p => p.g.attributes.position.count > 0)
    .map(p => prep(p.g, p.c)));
  merged.computeVertexNormals();
  return new THREE.Mesh(merged, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0,
  }));
}

function bounds(n, seed, j) {
  const rnd = prng(seed), pitch = SIZE / n, b = [-HALF];
  for (let i = 1; i < n; i++) b.push(-HALF + i * pitch + (rnd() * 2 - 1) * j * pitch);
  b.push(HALF);
  return b;
}

function patches(nx, nz, mergeP, seed) {
  const owner = new Array(nx * nz).fill(-1);
  const rnd = prng(seed);
  const free = (i, j) => i >= 0 && i < nx && j >= 0 && j < nz && owner[j * nx + i] < 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const id = j * nx + i;
      if (owner[id] >= 0) continue;
      let w = 1, h = 1;
      const r = rnd();
      if (r < mergeP * 0.45 && free(i + 1, j) && free(i, j + 1) && free(i + 1, j + 1)) { w = 2; h = 2; }
      else if (r < mergeP && free(i + 1, j)) w = 2;
      else if (r < mergeP * 2 && free(i, j + 1)) h = 2;
      for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) owner[(j + b) * nx + (i + a)] = id;
    }
  }
  return { root: (i, j) => owner[j * nx + i] };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const PIECE_ARMS = {
  straight:     ['S', 'N'],
  corner:       ['S', 'E'],
  't-junction': ['S', 'N', 'E'],
  crossroads:   ['S', 'N', 'E', 'W'],
  end:          ['S'],
};
const PIECE_KEYS = Object.keys(PIECE_ARMS);

const SWEEP = 0.45;

const ARM_STEPS = [[0, 1.40, 1], [1.40, 1.75, 0.55], [1.75, 1.88, 0.22]];
const ARM_STEPS_X = [[0, 1.05, 1], [1.05, 1.20, 0.5]];

const HEAD = [[-1.05, 1.05, -0.40, 1.30], [-1.25, 1.25, -0.10, 1.00]];

const POUR_DROP = 0.024;
const POUR_TONE = 'patchDark';

function pourRects(piece, crossing) {
  if (piece === 'straight') return [];
  const steps = crossing ? ARM_STEPS_X : ARM_STEPS;
  const out = [];
  for (const a of PIECE_ARMS[piece]) {
    for (const [s0, s1, f] of steps) {
      const near = s0 === 0 ? SWEEP : s0;
      if (a === 'S') out.push([-SWEEP, SWEEP, -s1, -near, f]);
      if (a === 'N') out.push([-SWEEP, SWEEP, near, s1, f]);
      if (a === 'E') out.push([near, s1, -SWEEP, SWEEP, f]);
      if (a === 'W') out.push([-s1, -near, -SWEEP, SWEEP, f]);
    }
  }

  out.push([-SWEEP, SWEEP, -SWEEP, SWEEP, 1]);
  if (piece === 'end') out.push(...HEAD.map(r => [...r, 1]));
  return out;
}

const PAINT_UP = 0.002;
const CW = 0.06;
const EDGE_OFF = 1.55;
const E0 = EDGE_OFF - CW, E1 = EDGE_OFF + CW;

const DASH = [[-1.5, -0.5], [0.5, 1.5]];
const STOP = [1.58, 1.70], STOP_X = [1.24, 1.36];
const BAND_IN = 1.42, BAND_OUT = 1.96;
const JUNC = 0.62;

function zebra(out, across, a0, a1) {

  const N = 5, W = 0.24, G = 0.32, span = N * W + (N - 1) * G;
  for (let k = 0; k < N; k++) {
    const c0 = -span / 2 + k * (W + G), c1 = c0 + W;
    out.push(across === 'x' ? [c0, c1, a0, a1] : [a0, a1, c0, c1]);
  }
}

function kerbElbow(R, sx, sz, reach) {
  if (reach <= E1) return;
  const rect = (a, b, c, d) => [Math.min(a, b), Math.max(a, b), Math.min(c, d), Math.max(c, d)];
  R.push(rect(sx * E0, sx * E1, sz * E0, sz * reach));
  R.push(rect(sx * E1, sx * reach, sz * E0, sz * E1));
}

function markingRects(piece, lines, crossing) {
  const R = [];
  const centre = lines === 'centre' || lines === 'both';
  const edges = lines === 'edges' || lines === 'both';
  const arms = PIECE_ARMS[piece];

  if (centre) {

    const CM = crossing && piece !== 'straight' ? BAND_IN : HALF;

    const run = (a, b, across) => {
      const c0 = Math.max(Math.min(a, b), -CM), c1 = Math.min(Math.max(a, b), CM);
      if (c1 - c0 > 1e-6) R.push(across ? [c0, c1, -CW, CW] : [-CW, CW, c0, c1]);
    };
    if (piece === 'straight') {
      for (const [z0, z1] of DASH) run(z0, z1, false);
    } else if (piece === 'corner') {

      run(-HALF, CW, false); R.push(...(CM > CW ? [[CW, CM, -CW, CW]] : []));
    } else if (piece === 't-junction') {

      for (const [z0, z1] of DASH) run(z0, z1, false);
      const [s0, s1] = crossing ? STOP_X : STOP;
      R.push([s0, s1, -E0, E0]);
    } else if (piece === 'crossroads') {

      run(-HALF, -JUNC, false); run(JUNC, HALF, false);
      run(-HALF, -JUNC, true);  run(JUNC, HALF, true);
    } else if (piece === 'end') {
      run(-HALF, -JUNC, false);
    }
  }

  if (edges) {

    const M = crossing && piece !== 'straight' ? BAND_IN : HALF;
    if (piece === 'straight') {
      R.push([-E1, -E0, -HALF, HALF], [E0, E1, -HALF, HALF]);
    } else if (piece === 'corner') {

      R.push([-E1, -E0, -M, E1], [-E0, M, E0, E1]);
      R.push([E0, E1, -M, -E0], [E1, M, -E1, -E0]);
    } else if (piece === 't-junction') {
      R.push([-E1, -E0, -M, M]);
      for (const sz of [-1, 1]) kerbElbow(R, 1, sz, M);
    } else if (piece === 'crossroads') {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) kerbElbow(R, sx, sz, M);
    } else if (piece === 'end') {
      R.push([-E1, -E0, -M, E1], [E0, E1, -M, E1], [-E0, E0, E0, E1]);
    }
  }

  if (crossing) {
    if (piece === 'straight') zebra(R, 'x', -0.30, 0.30);
    else for (const a of arms) {
      if (a === 'S') zebra(R, 'x', -BAND_OUT, -BAND_IN);
      if (a === 'N') zebra(R, 'x', BAND_IN, BAND_OUT);
      if (a === 'E') zebra(R, 'z', BAND_IN, BAND_OUT);
      if (a === 'W') zebra(R, 'z', -BAND_OUT, -BAND_IN);
    }
  }
  return R;
}

function mergeLines(base, extra) {
  const out = base.slice();
  for (const v of extra) {
    if (v <= -HALF + 0.02 || v >= HALF - 0.02) continue;
    if (out.some(b => Math.abs(b - v) < 0.02)) continue;
    out.push(v);
  }
  return out.sort((a, b) => a - b);
}

function cellIndex(arr, v) {
  for (let i = arr.length - 2; i > 0; i--) if (v >= arr[i]) return i;
  return 0;
}

const RIM = [[-HALF, HALF, HALF, HALF, 0, 1], [HALF, -HALF, -HALF, -HALF, 0, -1],
             [HALF, HALF, HALF, -HALF, 1, 0], [-HALF, -HALF, -HALF, HALF, -1, 0]];

function subBase(Z) {
  for (const [x0, z0, x1, z1, nxn, nzn] of RIM) {
    quadN(Z.base, [x0, BOT_Y, z0], [x1, BOT_Y, z1], [x1, WEAR_BOT, z1], [x0, WEAR_BOT, z0], [nxn, 0, nzn]);
  }
  quadN(Z.base, [-HALF, BOT_Y, -HALF], [HALF, BOT_Y, -HALF], [HALF, BOT_Y, HALF], [-HALF, BOT_Y, HALF], [0, -1, 0]);
}

function assemble(Z, C) {
  const g = new THREE.Group();
  g.name = 'asphalt-road-tile';
  const mesh = finish(COLOR_KEYS.map(k => ({ g: posGeo(Z[k]), c: C[k] })));
  mesh.name = 'asphalt-tile-surface';
  g.add(mesh);
  return g;
}

export function createAsset(p = {}) {
  const cw = COLORWAYS[p.colorway] || COLORWAYS[DEF.colorway];
  const C = {};
  for (const k of COLOR_KEYS) C[k] = p[k] !== undefined ? p[k] : cw[k];

  const layout = ['patchwork', 'courses', 'blocks'].includes(p.layout) ? p.layout : DEF.layout;
  const n = Math.round(clamp(p.patchCount !== undefined ? p.patchCount : DEF.patchCount, 0, 10));
  const relief = clamp(p.relief !== undefined ? p.relief : RELIEF[layout], 0, 0.020);
  const piece = PIECE_KEYS.includes(p.piece) ? p.piece : DEF.piece;
  const lines = ['none', 'centre', 'edges', 'both'].includes(p.lines) ? p.lines
    : (p.lines === true ? 'both' : DEF.lines);
  const crossing = p.crossing !== undefined ? !!p.crossing : DEF.crossing;
  const pourMode = ['none', 'step', 'tone'].includes(p.pour) ? p.pour : DEF.pour;

  const Z = { asphalt: [], patchLight: [], patchDark: [], base: [], paint: [] };

  const pour = pourMode === 'none' ? [] : pourRects(piece, crossing);
  const marks = markingRects(piece, lines, crossing);

  const nq0 = n === 0 && layout !== DEF.layout ? 3 : n;

  if (nq0 === 0 && pour.length === 0) {
    quadN(Z.asphalt, [-HALF, TOP_Y, -HALF], [HALF, TOP_Y, -HALF],
      [HALF, TOP_Y, HALF], [-HALF, TOP_Y, HALF], [0, 1, 0]);
    for (const [x0, z0, x1, z1, nxn, nzn] of RIM) {
      quadN(Z.asphalt, [x0, WEAR_BOT, z0], [x1, WEAR_BOT, z1],
        [x1, TOP_Y, z1], [x0, TOP_Y, z0], [nxn, 0, nzn]);
    }

    for (const [x0, x1, z0, z1] of marks) {
      quadN(Z.paint, [x0, TOP_Y + PAINT_UP, z0], [x1, TOP_Y + PAINT_UP, z0],
        [x1, TOP_Y + PAINT_UP, z1], [x0, TOP_Y + PAINT_UP, z1], [0, 1, 0]);
    }
    subBase(Z);
    return assemble(Z, C);
  }

  let nx = 1, nz = 1, xbP = [-HALF, HALF], zbP = [-HALF, HALF];
  let toneOf = () => 'asphalt', levOf = () => 0;
  if (nq0 > 0) {

  const nq = pour.length ? Math.min(nq0, 5) : nq0;
  let jx, jz, mergeP;
  if (layout === 'courses') { nx = 3; nz = nq + 1; jx = 0.38; jz = 0.20; mergeP = 0.35; }
  else if (layout === 'blocks') { nx = nz = Math.max(3, nq - 2); jx = jz = 0.34; mergeP = 0.55; }
  else { nx = nz = nq; jx = jz = 0.30; mergeP = 0.26; }

  xbP = bounds(nx, 1013, jx);
  zbP = bounds(nz, 7717, jz);
  const { root } = patches(nx, nz, mergeP, 4409);

  const interior = new Map();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const r = root(i, j);
      const inner = i > 0 && i < nx - 1 && j > 0 && j < nz - 1;
      interior.set(r, (interior.has(r) ? interior.get(r) : true) && inner);
    }
  }
  const rndT = prng(2801), rndY = prng(6203);
  const tone = new Map(), level = new Map();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const r = root(i, j);
      if (tone.has(r)) continue;
      let t = rndT(), k = 0;
      while (k < TONE_W.length - 1 && t > TONE_W[k]) { t -= TONE_W[k]; k++; }
      tone.set(r, TONES[k]);

      const u = rndY();
      let y = 0;
      if (interior.get(r) && relief > 0) {
        if (u < 0.30) y = -relief;
        else if (u < 0.52) y = -relief * 0.5;
        else if (u < 0.70) y = -relief * 0.75;
      }
      level.set(r, y);
    }
  }
  toneOf = (i, j) => tone.get(root(i, j));
  levOf = (i, j) => level.get(root(i, j));
  }

  const xb = mergeLines(xbP, pour.flatMap(r => [r[0], r[1]]));
  const zb = mergeLines(zbP, pour.flatMap(r => [r[2], r[3]]));
  const NX = xb.length - 1, NZ = zb.length - 1;

  const pourAt = (x, z) => pour.reduce((d, [x0, x1, z0, z1, f]) =>
    (x > x0 && x < x1 && z > z0 && z < z1) ? Math.max(d, f) : d, 0);
  const TONE = [], LEV = [];
  for (let j = 0; j < NZ; j++) {
    TONE.push([]); LEV.push([]);
    for (let i = 0; i < NX; i++) {
      const cx = (xb[i] + xb[i + 1]) / 2, cz = (zb[j] + zb[j + 1]) / 2;
      const pi = cellIndex(xbP, cx), pj = cellIndex(zbP, cz);

      const f = pourAt(cx, cz);

      TONE[j].push(f > 0 && pourMode === 'tone' ? POUR_TONE : toneOf(pi, pj));
      LEV[j].push(f > 0 ? -POUR_DROP * f : levOf(pi, pj));
    }
  }
  const toneAt = (i, j) => TONE[j][i];
  const yAt = (i, j) => LEV[j][i];

  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const y = yAt(i, j);
      quadN(Z[toneAt(i, j)], [xb[i], y, zb[j]], [xb[i + 1], y, zb[j]],
        [xb[i + 1], y, zb[j + 1]], [xb[i], y, zb[j + 1]], [0, 1, 0]);
    }
  }

  for (const [mx0, mx1, mz0, mz1] of marks) {
    for (let j = 0; j < NZ; j++) {
      if (zb[j] >= mz1 || zb[j + 1] <= mz0) continue;
      for (let i = 0; i < NX; i++) {
        if (xb[i] >= mx1 || xb[i + 1] <= mx0) continue;
        const y = yAt(i, j) + PAINT_UP;
        const x0 = Math.max(xb[i], mx0), x1 = Math.min(xb[i + 1], mx1);
        const z0 = Math.max(zb[j], mz0), z1 = Math.min(zb[j + 1], mz1);
        quadN(Z.paint, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0]);
      }
    }
  }

  for (let i = 1; i < NX; i++) {
    for (let j = 0; j < NZ; j++) {
      const ya = yAt(i - 1, j), yb2 = yAt(i, j);
      if (Math.abs(ya - yb2) < 1e-6) continue;
      const hi = ya > yb2, lo = Math.min(ya, yb2), up = Math.max(ya, yb2);
      quadN(Z[toneAt(hi ? i - 1 : i, j)], [xb[i], lo, zb[j]], [xb[i], lo, zb[j + 1]],
        [xb[i], up, zb[j + 1]], [xb[i], up, zb[j]], [hi ? 1 : -1, 0, 0]);
    }
  }
  for (let j = 1; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const ya = yAt(i, j - 1), yb2 = yAt(i, j);
      if (Math.abs(ya - yb2) < 1e-6) continue;
      const hi = ya > yb2, lo = Math.min(ya, yb2), up = Math.max(ya, yb2);
      quadN(Z[toneAt(i, hi ? j - 1 : j)], [xb[i], lo, zb[j]], [xb[i + 1], lo, zb[j]],
        [xb[i + 1], up, zb[j]], [xb[i], up, zb[j]], [0, 0, hi ? 1 : -1]);
    }
  }

  for (let i = 0; i < NX; i++) {
    quadN(Z[toneAt(i, 0)], [xb[i], WEAR_BOT, -HALF], [xb[i + 1], WEAR_BOT, -HALF],
      [xb[i + 1], TOP_Y, -HALF], [xb[i], TOP_Y, -HALF], [0, 0, -1]);
    quadN(Z[toneAt(i, NZ - 1)], [xb[i], WEAR_BOT, HALF], [xb[i + 1], WEAR_BOT, HALF],
      [xb[i + 1], TOP_Y, HALF], [xb[i], TOP_Y, HALF], [0, 0, 1]);
  }
  for (let j = 0; j < NZ; j++) {
    quadN(Z[toneAt(0, j)], [-HALF, WEAR_BOT, zb[j]], [-HALF, WEAR_BOT, zb[j + 1]],
      [-HALF, TOP_Y, zb[j + 1]], [-HALF, TOP_Y, zb[j]], [-1, 0, 0]);
    quadN(Z[toneAt(NX - 1, j)], [HALF, WEAR_BOT, zb[j]], [HALF, WEAR_BOT, zb[j + 1]],
      [HALF, TOP_Y, zb[j + 1]], [HALF, TOP_Y, zb[j]], [1, 0, 0]);
  }

  subBase(Z);
  return assemble(Z, C);
}

export const params = {
  piece: {
    type: 'choice', default: 'straight', label: 'Road piece',
    options: ['straight', 'corner', 't-junction', 'crossroads', 'end'], affects: 'geometry',
    describe: 'Which piece of the road network this tile is — one asset covering every road ' +
      'surface the kit needs. The surface is REBUILT per value: the junction pour, its rims and ' +
      'the markings are different geometry, not one mesh rotated, and the triangle count moves ' +
      'with it — 20 / 170 / 234 / 316 / 274 under pour step, 20 / 32 / 36 / 44 / 28 under lines ' +
      'both. On the SHIPPED defaults, though, all five build the same 20-triangle flat square: ' +
      'pour defaults to none and lines to none, so a bare junction is deliberately as plain as a ' +
      'bare straight, and this knob shows itself once you turn pour, lines or crossing on. ' +
      'Every value is the same exact 4.000 m square ' +
      'centred on the origin and 0.05 m thick, so any piece drops into any cell of the kit grid ' +
      'and butts its neighbours with no gap at any setting of any other knob. straight is a run ' +
      'of road and the shipped default: no junction, so no pour, so the plain tile stays plain. ' +
      'corner turns traffic 90 degrees, entering at -Z and leaving at +X, and relays an L. ' +
      't-junction adds a minor arm at +X and relays a T. crossroads opens all four arms and ' +
      'relays a cross. end closes the road and relays a stepped turning head, the lollipop of a ' +
      'cul-de-sac. Aim a piece in a scene with yaw alone.',
  },
  lines: {
    type: 'choice', default: 'none', label: 'Lane markings',
    options: ['none', 'centre', 'edges', 'both'], affects: 'geometry',
    describe: 'Painted lane markings, as real geometry 2 mm proud of the road in the `paint` ' +
      'zone, clipped to the surface so a stripe crossing the junction pour steps down with it ' +
      'rather than hanging over it. Whatever is selected FOLLOWS THE PIECE. none is the default ' +
      'and leaves the asphalt bare, exactly as this tile ships. centre paints the centre line of ' +
      'a narrow two-way street — broken into 1 m dashes down a straight, phased so a chain of ' +
      'clones dashes evenly across the joints; bent round a corner; running through a T, which ' +
      'also gets a stop bar across its minor arm; and stopped short of the middle of a ' +
      'crossroads, which is painted with nothing at all. A centre line also STOPS at a zebra ' +
      'when `crossing` is on, the way a real one does. edges paints a CONTINUOUS unbroken line ' +
      'along each side of the carriageway, reaching both mouths at the same 1.55 m offset and ' +
      '0.12 m width so butted copies read as one line rather than a row of rectangles. Wherever ' +
      'an arm opens off the through road the kerb line TURNS INTO IT as a mitred right angle — ' +
      'the two bands share the corner square rather than stopping level with each other and ' +
      'stepping past by a line width — so a corner, a T and a crossroads all read as one ' +
      'continuous painted kerb. both paints centre and edges together.',
  },
  pour: {
    type: 'choice', default: 'none', label: 'Junction pour',
    options: ['none', 'step', 'tone'], affects: 'geometry',
    describe: 'What a junction piece does with the area traffic turns over — the course a real ' +
      'street relays first. It does nothing on a straight, which has no junction. none is the ' +
      'DEFAULT and removes it altogether, for a junction as plain and as flat as a bare tile: ' +
      'the shipped tile is the one a scene clones across a whole plan without arguments, and a ' +
      'pour repeats identically on every junction in that plan, so a laid-out road network with ' +
      'it on reads as a stamped pattern rather than as a street. That is the same reasoning that ' +
      'makes patchCount default to 0 and lines default to none — the value that tiles cleanly is ' +
      'the value that ships. step lays the course as REAL GEOMETRY ONLY: a shallow relaid pan in ' +
      'the road\'s own colour, running out along each arm to its own mouth and feathering back to ' +
      'the surface at the tiling edge, so the junction carries ONE flat asphalt tone exactly like ' +
      'the straight tile does and reads through its own rims. tone additionally paints the pour ' +
      'with the fresh-asphalt course colour, which is much the loudest of the three from above — ' +
      'it is how a recently relaid junction really looks, but it is the mark that repeats hardest ' +
      'wherever you place the piece. Both are opt-in; the geometry of each is unchanged.',
  },
  crossing: {
    type: 'toggle', default: false, label: 'Zebra crossing', affects: 'geometry',
    describe: 'Adds a zebra crossing in the same 2 mm proud paint — bars running along the ' +
      'direction of travel and arrayed across the road, which is what makes it read as a ladder ' +
      'from above. OFF by default. On a straight it lies across the middle of the cell; on every ' +
      'junction piece there is one across each arm, and the junction pour is held further back to ' +
      'give the crossing the depth it needs, exactly as nothing gets relaid up to a crossing in ' +
      'the real world. The bars sit inside the edge lines, so markings and crossing can both be ' +
      'on without a single overlapping painted face.',
  },
  colorway: {
    type: 'choice', default: 'city-asphalt', label: 'Colorway',
    options: ['city-asphalt', 'fresh-blacktop', 'sun-faded', 'pale-concrete'],
    describe: 'Curated kit-palette road scheme; sets all four zone colours at once. ' +
      'city-asphalt is the shipped mid-dark street grey of the refs. fresh-blacktop drops the ' +
      'whole ladder one step for a newly laid, almost black road with a pale gravel base ' +
      'course. sun-faded is a bleached, dusty grey main road. pale-concrete takes the top face ' +
      'up to light grey so the same tile reads as a poured concrete carriageway. Every scheme ' +
      'keeps three top-face tones one clear value step apart — on the clean default only the ' +
      'first of them is on the road, so a colorway there reads as the road colour plus its ' +
      'sub-base — and every colour is from the Little Tokyo menu.',
  },
  asphalt: {
    type: 'color', default: '#3C4145', label: 'Asphalt field',
    describe: 'The road itself. On the shipped clean tile (patchCount 0) this one albedo paints ' +
      'the ENTIRE top face and the 40 mm wearing course on the slab edge — every pixel of the ' +
      'road — so it is the colour to move for a different street. Once patches are on it is the ' +
      'dominant resurfacing course, about half of them plus their rims, and the other two patch ' +
      'tones read as steps away from it.',
  },
  patchLight: {
    type: 'color', default: '#4E5459', label: 'Faded patch',
    describe: 'Albedo of the older, sun-bleached asphalt courses — roughly a quarter of the ' +
      'top face once patchCount is 1 or more, and nothing at all on the clean default, where ' +
      'this zone emits no triangles. One desaturated step LIGHTER than the field. Push it further from the field ' +
      'for a heavily patched, much repaired street; bring it closer for a road resurfaced all ' +
      'in one go. Keep it grey: a tinted value here reads as spilled paint, not asphalt.',
  },
  patchDark: {
    type: 'color', default: '#2E3134', label: 'Fresh patch',
    describe: 'Albedo of the newest, blackest courses — roughly a fifth of the top face once ' +
      'patchCount is 1 or more, and nothing at all on the clean default, where this zone emits ' +
      'no triangles. One step DARKER than the field, the tone that makes a patch read as recently laid. Avoid ' +
      'taking it to true black: in a mid-tone field a near-black patch reads as a hole in the ' +
      'road rather than as new asphalt.',
  },
  base: {
    type: 'color', default: '#E4E2DC', label: 'Sub-base',
    describe: 'Albedo of the bottom 26 mm of the slab edge and the whole underside — the ' +
      'compacted aggregate the asphalt is laid on. It is deliberately several rungs lighter than ' +
      'the road: this band is the foundation line under a laid run of tiles, and at whole-asset ' +
      'framing the whole 50 mm section is under ten pixels, so anything closer in value than ' +
      'this renders as one black bar. Take it darker for a road laid straight onto dark earth, ' +
      'and expect the section to close up as you do. It never reaches the top face, so it cannot ' +
      'disturb the patchwork or the markings.',
  },
  paint: {
    type: 'color', default: '#F2EFE7', label: 'Marking paint',
    describe: 'Albedo of every painted marking — centre dashes, edge lines, stop bar and zebra ' +
      'bars alike. It emits no triangles at all while `lines` is none and `crossing` is off, so ' +
      'on the bare road it costs nothing. Keep it the lightest value in the scheme: paint reads ' +
      'by value against its own asphalt, so a mid-grey here disappears on a pale road. Take it ' +
      'warm off-white for old worn thermoplastic, or yellow-white for a street that marks in ' +
      'yellow.',
  },
  layout: {

    type: 'choice', default: 'patchwork', label: 'Paving layout (needs Patch count 1+)',
    options: ['patchwork', 'courses', 'blocks'], affects: 'geometry',
    describe: 'How the top face is laid out — the surface re-plans from scratch per value, with ' +
      'a different cell grid and a different triangle count each time, not the same plan ' +
      'rescaled. patchwork is the default: a jittered square grid of many small unequal ' +
      'patches, the repeatedly repaired street of the refs. courses lays the road in three ' +
      'columns of wide transverse bands, so it reads as asphalt laid strip by strip across the ' +
      'carriageway. blocks uses a much coarser grid with heavy merging: a few big plates, the ' +
      'read of a concrete-slab road or a whole-lane resurfacing. Each layout also carries the ' +
      'step depth that suits it — 12 mm on patchwork, 8 mm on the wide courses, 18 mm on the ' +
      'blocks. All three tile seamlessly. NOTE: this knob only has something to lay out once ' +
      'patchCount is 1 or more; at the shipped clean default of 0 all three values build the ' +
      'same flat road.',
  },
  patchCount: {
    type: 'range', default: 0, min: 0, max: 10, step: 1, label: 'Patch count',
    affects: 'geometry',
    describe: 'How many patch divisions the 4 m tile is cut into per axis — the road surface is ' +
      'rebuilt at every value, so this sets patch SIZE by re-planning the grid, never by ' +
      'scaling, and the triangle count moves with it (roughly 40 triangles per added division). ' +
      '0 is the DEFAULT and means OFF: a completely CLEAN road, one flat colour for the asphalt ' +
      'and one for the sub-base, with no patch, no step, no stain and no speckle anywhere — the ' +
      'tile to pave a whole street with, because nothing on it can repeat in a grid. 1 lays the ' +
      'carriageway as a single pour and 2-4 as a few big plates, a calm recently resurfaced ' +
      'road; 8 is the much-mended street of the ' +
      'refs, ~0.50 m cells (up to 1 m where two or four merge) quilted in three asphalt tones ' +
      'with the settled ones sunk on a real vertical rim; 10 is a busy fine-grained surface of ' +
      'small repairs. Scatter variation per instance rather than baking one tile everywhere. ' +
      'Under the courses layout it sets the number of transverse bands instead of a square grid.',
  },
};

export const presets = COLORWAYS;
export const rig = {};
export const detach = [];
export const night = {};
export default createAsset;

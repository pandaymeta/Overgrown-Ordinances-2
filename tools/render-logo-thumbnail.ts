import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import opentype from 'opentype.js';
import { Resvg } from '@resvg/resvg-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WOFF_PATH = join(ROOT, 'assets/fonts/averia-libre-bold.woff');
const TTF_PATH = join(ROOT, 'assets/fonts/averia-libre-bold.ttf');
const OUT_PATH = join(ROOT, 'assets/overgrown-ordinances-thumbnail-logo.png');

/** Matches delivery-progress-hud paper panel + modal title. */
const PAPER_CREAM = '#f7f3eb';
const PAPER_TEXT = '#6b6560';
const WIDTH = 1920;
const HEIGHT = 1080;
/** Modal shell title: font:700 32px/1.2 — scaled for thumbnail legibility. */
const TITLE_SIZE_PX = 118;
const TITLE = 'Overgrown Ordinances';

function ensureTtf(): void {
  if (existsSync(TTF_PATH)) {
    return;
  }
  const result = spawnSync(
    'python',
    [
      '-c',
      [
        'from fontTools.ttLib import TTFont',
        `f = TTFont(${JSON.stringify(WOFF_PATH)})`,
        `f.save(${JSON.stringify(TTF_PATH)})`,
      ].join(';'),
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || 'Failed to convert Averia WOFF to TTF');
  }
}

ensureTtf();

const font = opentype.parse(readFileSync(TTF_PATH));
const textWidth = font.getAdvanceWidth(TITLE, TITLE_SIZE_PX);
const x = (WIDTH - textWidth) / 2;
const y = HEIGHT / 2 + TITLE_SIZE_PX * 0.34;
const pathData = font.getPath(TITLE, x, y, TITLE_SIZE_PX).toPathData(2);

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="100%" height="100%" fill="${PAPER_CREAM}" />
  <path d="${pathData}" fill="${PAPER_TEXT}" />
</svg>`;

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: WIDTH },
});

writeFileSync(OUT_PATH, resvg.render().asPng());
console.log(`Wrote ${OUT_PATH}`);

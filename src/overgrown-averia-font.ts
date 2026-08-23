import * as ENGINE from '@gnsx/genesys.js';

const FONT_STYLE_ID = 'overgrown-averia-font';
const AVERIA_FONT_ASSET_PATH = '@project/assets/fonts/averia-libre-bold.woff';
const FONT_CSS = [
  '@font-face {',
  'font-family:"Overgrown Averia";',
  `src:url("${AVERIA_FONT_ASSET_PATH}") format("woff");`,
  'font-weight:700;',
  'font-style:normal;',
  'font-display:swap;',
  '}',
].join('');

let fontLoadPromise: Promise<void> | null = null;

/**
 * Registers Averia through Genesys' asset resolver so it works in both the
 * Studio preview and the published browser build (where project URLs differ).
 */
export function ensureOvergrownAveriaFont(): Promise<void> {
  if (fontLoadPromise) {
    return fontLoadPromise;
  }

  fontLoadPromise = (async () => {
    if (document.getElementById(FONT_STYLE_ID)) {
      return;
    }

    const fontFace = document.createElement('style');
    fontFace.id = FONT_STYLE_ID;
    document.head.appendChild(fontFace);

    // @project paths are not browser URLs. Resolve them through the engine so
    // Studio and published builds point at the correct packaged asset.
    fontFace.textContent = await ENGINE.resolveAssetPathsInText(FONT_CSS);
    await document.fonts.load('700 16px "Overgrown Averia"');
  })().catch((error) => {
    fontLoadPromise = null;
    console.warn('[OvergrownFont] Averia Libre Bold failed to load.', error);
  });

  return fontLoadPromise;
}

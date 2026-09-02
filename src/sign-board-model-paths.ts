/** GLB paths that keep authored sign materials — no environment wash; ordinance sharp sampling only. */
export const SIGN_BOARD_MODEL_PATH =
  /(?:PolyforkAssets\/Ordinances\/|(?:generated\/)?OrdinanceCards\/|(?:@project\/)?assets\/branding\/)/i;

export function isSignBoardModelUrl(modelUrl: string | null | undefined): boolean {
  return typeof modelUrl === 'string' && SIGN_BOARD_MODEL_PATH.test(modelUrl);
}

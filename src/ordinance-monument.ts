import * as ENGINE from '@gnsx/genesys.js';

/** Editor-authored sky copies — e.g. "Maintenance Monument", "JayWalking Monument". */
export const ORDINANCE_MONUMENT_NAME = / Monument$/i;

export function isOrdinanceMonumentNode(node: ENGINE.SceneNode): boolean {
  return ORDINANCE_MONUMENT_NAME.test(node.name ?? '');
}

/** Match gameplay boards and their `… Monument` sky copies. */
export function matchesOrdinanceFamily(pattern: RegExp, nodeName: string): boolean {
  const name = nodeName ?? '';
  if (pattern.test(name)) {
    return true;
  }
  if (!ORDINANCE_MONUMENT_NAME.test(name)) {
    return false;
  }
  return pattern.test(name.replace(ORDINANCE_MONUMENT_NAME, ''));
}

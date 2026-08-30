/** Loading screen waits on this before the cream splash opens the world. */

let introPhysicsPrimed = false;
const waiters: Array<() => void> = [];

export function waitForIntroPhysicsPrimed(): Promise<void> {
  if (introPhysicsPrimed) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

export function markIntroPhysicsPrimed(): void {
  if (introPhysicsPrimed) {
    return;
  }
  introPhysicsPrimed = true;
  waiters.splice(0).forEach((resolve) => resolve());
}

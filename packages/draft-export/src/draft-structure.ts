/** The direction a pack moves around a seat list. */
export type PassDirection = 1 | -1;

/** Round one passes forward, and every round after it turns around. */
export function passDirection(round: number): PassDirection {
  return round % 2 === 1 ? 1 : -1;
}

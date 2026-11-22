/**
 * How big a battlefield the lab lets a game reach, and what each surface does
 * about it (issue 302).
 *
 * #307 measured why a ceiling is needed at all: a board-scaled token count
 * (Krenko, Mob Boss on reduced M13) makes one turn cost 0.12s at 268
 * permanents, 1.5s at 1,038 and 27.8s at 4,112, about four times per doubling.
 * The sim ran into its 30-second game budget and threw; a play screen has no
 * budget, so the same game froze the tab. 500 is where Arcana's random sweep
 * put the same ceiling, and at 525 the Krenko turn still took half a second, so
 * no game a person would play reaches it.
 *
 * One number and one reading of it, here because this is the one package every
 * runner of a game already imports and that imports nothing: `@mtg/sim` stops a
 * game with it, `@mtg/netplay` refuses moves past it, and `@mtg/ui`'s play view
 * draws the stop and the warning from it. Each counts the permanents itself,
 * because each holds a different shape of position, and none of them changes
 * the rules: the kernel never ends a game for being large, so a capped game is
 * a draw the surface declares rather than a result in `GameState`.
 */

/** Permanents on the battlefield, both seats together, that a game may hold. */
export const DEFAULT_BOARD_CAP = 500;

/**
 * Where a board stands against the cap.
 *
 * - `clear`: nothing to say.
 * - `near`: past half the cap. A board that doubles every turn, which is the
 *   shape a runaway takes, reaches the cap from here in one turn, so this is
 *   the last point a warning gives a player a turn's notice.
 * - `passed`: over the cap. The game stops here as a draw.
 */
export type BoardCapStanding = 'clear' | 'near' | 'passed';

export function boardCapStanding(permanents: number, cap: number = DEFAULT_BOARD_CAP): BoardCapStanding {
  if (permanents > cap) return 'passed';
  if (permanents > cap / 2) return 'near';
  return 'clear';
}

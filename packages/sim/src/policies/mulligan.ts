/**
 * The opening hand: keep it, or send it back (CR 103.4).
 *
 * The policy was a land count and nothing else, on the argument that in a
 * two-color limited deck the land count carries most of the castability signal.
 * It carries most of it and not all of it, and the part it misses is colors: two
 * Mountains in a blue-black hand is a two-land hand, sits inside the band, and
 * gets kept. So the band now has a second term beside it, and the argument for
 * it is below rather than in a commit message.
 *
 * **What was measured.** `packages/sim/tools/mulligan-report.ts` plays a seeded
 * round robin over the flagship's 253-card build, ten color-pair decks, 13,500
 * seat-games per arm, and watches every opening-hand decision from inside the
 * seat making it. On the shipped land band alone, 5.1% of kept hands could cast
 * nothing they held by turn 3, and 2.1% could not because of colors rather than
 * because of land count. Those hands lose: a keep that casts nothing by turn 3
 * wins 39.2% (n=684) against 50.6% for one that does.
 *
 * **What moving it bought, honestly.** Not games. The cohort is read paired —
 * dealt sevens inside the band that cast nothing by turn 3, the same 556 deals
 * under both arms because nothing is bottomed before the first decision — and it
 * wins 41.5% when kept and 40.1% when the new term sends it back. That is a
 * 1.4-point move on n=556, which is inside the noise of the statistic, so the
 * defensible claim is that mulliganing these hands costs nothing, not that it
 * wins. An aggregate win rate cannot say more: a round robin is zero-sum and
 * both arms read 50% whatever the rule does.
 *
 * The change is therefore a fidelity one and is stated as such. A bot that keeps
 * a hand it cannot cast is playing a different game from the one a human plays
 * at the same table, and a lab whose opponent does that is wrong in a way a win
 * rate is too coarse to report. What the measurement establishes is the price:
 * the mulligan rate goes 12.2% to 16.3%, mean game length 14.49 turns to 14.46,
 * and no color pair's win rate moves more than 0.4 points.
 *
 * **Why turn 3 and not turn 2.** Both were run. At turn 2 the rule demands a
 * one- or two-drop the hand can pay for, which sends back a quarter of all deals
 * (24.4% take a mulligan against 12.2%), moves a pair win rate as far as 1.5
 * points, and buys the same nothing on the paired cohort (41.4%). Turn 3 is
 * where the rule stops describing a curve and starts describing a hand that
 * functions, which is the thing being asked about.
 *
 * **What was left alone.** `landsWantedFor` rounds rather than floors, so a
 * five-card keep is judged against one land rather than two, and flooring it was
 * the first fix considered. It is unreachable: `maximumMulligans` is 2, a hand is
 * only ever judged at five cards after two mulligans, and at that point the
 * policy has already stopped offering to send anything back — the floored arm
 * reproduced the unfloored arm to the digit on every line of the census. The knob
 * exists (`minimumLandsFloor`) and ships at 0, because a rule that changes
 * nothing should not be spent as though it changed something. A one-land
 * five-card keep is 0.3% of keeps and wins 25% of the time; it is rare and it is
 * bad, and it is what the mulligan cap chose, not what the band chose.
 *
 * **The hand judged is the hand that would be kept.** The bottoming is chosen
 * first and the band is applied to what survives it, so a keep after two
 * mulligans is judged as the five cards it really is rather than as the seven
 * that were dealt. The band scales with that size — `landsWantedFor` — so one
 * pair of numbers says "2-5 of seven" and "1-4 of five" without a second table.
 *
 * Which cards go to the bottom is `chooseDiscards`' question under another name,
 * so it is `chooseDiscards`' answer: the least valuable cards in hand, where a
 * land is valuable while the hand still holds something it cannot pay for.
 * Before turn 1 nothing is on the battlefield, so every spell is priced as
 * uncastable and the most expensive one goes first — the right instinct for a
 * hand that has already paid a card to be seen at all.
 */
import type { Action, Decision, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { getObject } from '@mtg/kernel';
import type { GreedyBotConfig, MulliganPolicyConfig } from '../config';
import { readCastability } from './castability';
import { chooseDiscards } from './misc';

export type MulliganDecision = Extract<Decision, { kind: 'mulligan' }>;
export type OpeningHandAction = Extract<Action, { type: 'mulligan' | 'keepHand' }>;

/** Lands among these cards, by printed type. Nothing is on the battlefield yet. */
export function landsIn(state: GameState, cards: readonly ObjectId[]): number {
  let lands = 0;
  for (const oid of cards) {
    if (getObject(state, oid).card.kind === 'land') lands += 1;
  }
  return lands;
}

/**
 * The band a hand of `kept` cards is judged against, scaled from the band for a
 * full opening hand.
 *
 * Rounded rather than floored: the bound that matters on the low side is whether
 * the hand can make its first land drops, and that does not get easier because a
 * card went to the bottom. `minimumLandsFloor` raises the low side back to a
 * stated number for a profile that wants it; the shipped profile does not, and
 * the header says why.
 */
export function landsWantedFor(
  kept: number,
  openingHandSize: number,
  config: MulliganPolicyConfig,
): { readonly min: number; readonly max: number } {
  if (openingHandSize <= 0) return { min: 0, max: 0 };
  const scale = kept / openingHandSize;
  return {
    min: Math.max(Math.round(config.minimumLands * scale), Math.min(config.minimumLandsFloor, kept)),
    max: Math.round(config.maximumLands * scale),
  };
}

/**
 * True when the hand can cast one of its own spells, from its own lands, by
 * `castableByTurn`. Off — and free — at 0.
 */
export function castsSomething(
  state: GameState,
  kept: readonly ObjectId[],
  config: MulliganPolicyConfig,
): boolean {
  if (config.castableByTurn <= 0) return true;
  const cards = kept.map((oid) => getObject(state, oid).card);
  return readCastability(cards, config.castableByTurn).castable;
}

/** True when the hand that would be kept sits inside the band. */
export function keepsHand(
  state: GameState,
  kept: readonly ObjectId[],
  config: MulliganPolicyConfig,
): boolean {
  const band = landsWantedFor(kept.length, state.config.openingHandSize, config);
  const lands = landsIn(state, kept);
  if (lands < band.min || lands > band.max) return false;
  return castsSomething(state, kept, config);
}

/**
 * Keep or mulligan, and which cards a keep pays with.
 *
 * Constructed rather than picked out of `decision.options`, exactly as the
 * discard and the combat declarations are: the keeps enumerate one option per
 * choice of cards to bottom, a run under `FAST_CAPS` sees only the first of
 * them, and a policy that sampled that list would be reading the cap rather than
 * the hand. `validateAction` re-derives the legality either way.
 *
 * `maximumMulligans` is the bot's own floor and sits under the rules' one: the
 * kernel stops offering a mulligan once the whole hand would be bottomed, and a
 * profile that never sends back a five-card hand stops long before that.
 */
export function chooseMulligan(
  state: GameState,
  decision: MulliganDecision,
  config: GreedyBotConfig,
): OpeningHandAction {
  const player: PlayerId = decision.player;
  const bottom = chooseDiscards(state, player, decision.hand, decision.count, config.discard);
  const bottomed = new Set(bottom);
  const kept = decision.hand.filter((oid) => !bottomed.has(oid));
  const mayMulligan = decision.mulligans < config.mulligan.maximumMulligans;
  if (mayMulligan && !keepsHand(state, kept, config.mulligan)) {
    return { type: 'mulligan', player };
  }
  return { type: 'keepHand', player, bottom };
}

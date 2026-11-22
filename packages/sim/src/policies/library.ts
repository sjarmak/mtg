import type { Card, Color } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import type { Action, AgentView, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { getObject, landsControlledBy } from '@mtg/kernel';
import type { GreedyBotConfig } from '../config';
import { printedCardValue } from '../evaluate';

type ScryAction = Extract<Action, { type: 'scry' }>;
type SearchAction = Extract<Action, { type: 'searchLibrary' }>;

function missingColors(state: GameState, player: PlayerId): Readonly<Record<Color, number>> {
  const produced = availableColors(state, player);
  const missing: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const oid of state.players[player].hand) {
    const card = getObject(state, oid).card;
    if (card.kind === 'land') continue;
    for (const color of COLORS) {
      if (card.manaCost[color] > 0 && !produced.has(color)) missing[color] += card.manaCost[color];
    }
  }
  return missing;
}

function availableColors(state: GameState, player: PlayerId): ReadonlySet<Color> {
  const produced = new Set<Color>();
  const lands = [
    ...landsControlledBy(state, player).map((land) => land.card),
    ...state.players[player].hand.map((oid) => getObject(state, oid).card),
  ];
  for (const card of lands) {
    if (card.kind !== 'land') continue;
    for (const color of card.producesMana) if (color !== 'C') produced.add(color);
  }
  return produced;
}

function cardChoiceValue(state: GameState, player: PlayerId, card: Card, config: GreedyBotConfig): number {
  if (card.kind !== 'land') {
    const produced = availableColors(state, player);
    const unsupported = COLORS.reduce(
      (count, color) => count + (produced.has(color) ? 0 : card.manaCost[color]),
      0,
    );
    return unsupported === 0 ? printedCardValue(config.cast, card) : 0;
  }

  const missing = missingColors(state, player);
  const need = card.producesMana.reduce((sum, color) => sum + (color === 'C' ? 0 : missing[color]), 0);
  const handLands = state.players[player].hand.filter(
    (oid) => getObject(state, oid).card.kind === 'land',
  ).length;
  const landCount = landsControlledBy(state, player).length + handLands;
  const curveNeed = Math.max(0, config.land.saturationLands - landCount);
  return config.land.colorNeedWeight * (need + curveNeed);
}

function tieBreak(left: ObjectId, right: ObjectId): number {
  return left.localeCompare(right);
}

/** Choose the highest-value card among the options shown by a scry decision. */
export function chooseScry(view: AgentView, config: GreedyBotConfig): ScryAction {
  const options = view.decision.options.filter((action) => action.type === 'scry') as ScryAction[];
  const drawBaseline = config.cast.spellBaseValue;
  const utility = (action: ScryAction): number =>
    action.top.reduce(
      (sum, oid, index) =>
        sum +
        (cardChoiceValue(view.state, view.player, getObject(view.state, oid).card, config) - drawBaseline) /
          (index + 1),
      0,
    );
  const chosen = options.reduce<ScryAction | null>((best, action) => {
    const value = utility(action);
    const bestValue = best === null ? Number.NEGATIVE_INFINITY : utility(best);
    if (best === null || value > bestValue) return action;
    if (value < bestValue) return best;
    return JSON.stringify(action.top.concat(action.bottom)).localeCompare(
      JSON.stringify(best.top.concat(best.bottom)),
    ) < 0
      ? action
      : best;
  }, null);
  if (chosen === null) throw new Error('greedy bot: scry offered no legal option');
  return chosen;
}

/** Choose the highest-value card among the cards currently offered by a tutor. */
export function chooseSearchLibrary(view: AgentView, config: GreedyBotConfig): SearchAction {
  const options = view.decision.options.filter(
    (action) => action.type === 'searchLibrary' && action.found !== null,
  ) as SearchAction[];
  const chosen = options.reduce<SearchAction | null>((best, action) => {
    const card = getObject(view.state, action.found!).card;
    if (best === null) return action;
    const value = cardChoiceValue(view.state, view.player, card, config);
    const bestValue = cardChoiceValue(
      view.state,
      view.player,
      getObject(view.state, best.found!).card,
      config,
    );
    return value > bestValue || (value === bestValue && tieBreak(action.found!, best.found!) < 0)
      ? action
      : best;
  }, null);
  const fallback = view.decision.options[0];
  if (chosen !== null) return chosen;
  if (fallback === undefined) throw new Error('greedy bot: search offered no legal option');
  return fallback as SearchAction;
}

import { DECK_MODEL } from './model';
import type { Basics, EvaluationCard } from './model';
import { manaSupport } from './mana';

export function deckValue(
  spells: readonly EvaluationCard[],
  lands: readonly EvaluationCard[],
  basics: Basics,
): number {
  const cards = [...spells, ...lands];
  const quality = spells.reduce((sum, card) => {
    const support = manaSupport(card, lands, basics);
    const synergy = card.payoffs.reduce(
      (bonus, payoff) =>
        bonus +
        payoff.weight *
          Math.min(
            1,
            cards.filter((c) => c.id !== card.id && c.tags.includes(payoff.tag)).length / payoff.target,
          ),
      0,
    );
    return sum + (card.quality + synergy) * support - (support === 0 ? DECK_MODEL.unsupportedPenalty : 0);
  }, 0);
  const creatures = spells.filter((c) => c.type === 'creature').length;
  const interaction = spells.filter((c) => c.roles.includes('interaction')).length;
  const early = spells.filter((c) => c.manaValue <= 3 && c.type === 'creature').length;
  const landUtility = lands.reduce((sum, land) => sum + (land.landValue ?? 0), 0);
  return (
    quality +
    landUtility +
    Math.min(creatures, DECK_MODEL.creatureTarget) * DECK_MODEL.creatureWeight +
    Math.min(interaction, DECK_MODEL.interactionTarget) * DECK_MODEL.interactionWeight +
    Math.min(early, DECK_MODEL.earlyTarget) * DECK_MODEL.earlyWeight
  );
}

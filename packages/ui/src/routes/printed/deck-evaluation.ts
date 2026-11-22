/** Apply authored judgments without weakening the physical-copy deck contract. */
import {
  evaluatePrintedCard,
  hasPrintedEvaluation,
  planLimitedPool,
  allocateLimitedMana,
} from '@mtg/draft-export';
import type { PrintedBoosterPayload } from '@mtg/draft-export';
import { suggestLimitedBasics, suggestLimitedDeckWithReport, validateLimitedDeck } from '@mtg/limited';
import type { LimitedDeck } from '@mtg/limited';
import { evaluateRankedPrintedCard, type PrintedDraftRatings } from '../../lab/printed-draft-ratings';

type PrintedDeck = LimitedDeck<PrintedBoosterPayload>;
const supported = (deck: PrintedDeck): boolean =>
  deck.minimumDeckSize === 40 && deck.pool.every((c) => hasPrintedEvaluation(c.payload.printing));
const evaluate = (deck: PrintedDeck) =>
  deck.pool.map((c) => evaluatePrintedCard(c.payload.printing, c.physicalId));

export function suggestPrintedDeck(deck: PrintedDeck, ratings?: PrintedDraftRatings): PrintedDeck {
  if (!supported(deck)) {
    if (ratings !== undefined) {
      const plan = planLimitedPool(
        deck.pool.map((copy) => evaluateRankedPrintedCard(ratings, copy.payload.printing, copy.physicalId)),
      );
      const next = { ...deck, selectedPhysicalIds: plan.selectedIds, basics: plan.basics };
      if (!validateLimitedDeck(next).legal)
        throw new Error('Ranked printed deck plan failed physical validation');
      return next;
    }
    return suggestLimitedDeckWithReport(deck, { policy: 'deck-conditioned/v1' }).deck;
  }
  const plan = planLimitedPool(evaluate(deck));
  const next = { ...deck, selectedPhysicalIds: plan.selectedIds, basics: plan.basics };
  if (!validateLimitedDeck(next).legal) throw new Error('Printed deck plan failed physical validation');
  return next;
}

export function printedDeckCalibrationNote(deck: PrintedDeck, ratings?: PrintedDraftRatings): string {
  if (supported(deck)) return 'Deck suggestions use authored set evaluations.';
  if (ratings !== undefined) return 'Deck suggestions use staged Forge set rankings.';
  return 'Deck suggestions are not format-calibrated.';
}

export function suggestPrintedBasics(deck: PrintedDeck): PrintedDeck {
  if (!supported(deck)) return suggestLimitedBasics(deck);
  const selected = evaluate(deck).filter((c) => deck.selectedPhysicalIds.includes(c.id));
  const lands = selected.filter((c) => c.type === 'nonbasic-land');
  const spells = selected.filter((c) => c.type !== 'nonbasic-land');
  const total = Math.max(deck.suggestedBasicLands, deck.minimumDeckSize - spells.length) - lands.length;
  return { ...deck, basics: allocateLimitedMana(spells, lands, Math.max(0, total)) };
}

/** Shared deterministic Limited pool and deck sampling for Forge diagnostics. */
import { runPrintedLimitedDraft } from '@mtg/draft-export';
import type { PreparedPrintedLimitedFormat, PrintedBoosterCopy } from '@mtg/draft-export';
import { renderDeck } from '@mtg/forge-export';
import { prepareLimitedDeck, suggestLimitedDeck, validateLimitedDeck } from '@mtg/limited';
import { printedLimitedFacts } from '../src/routes/printed/limited-facts';
import { PRINTED_BASELINE_BOT } from '../src/routes/printed/draft-bot';

export interface PrintedSampledDeck {
  readonly file: string;
  readonly cards: readonly { readonly name: string; readonly setCode?: string }[];
  readonly poolPhysicalIds: readonly string[];
  readonly poolPrintingIds: readonly string[];
  readonly selectedPhysicalIds: readonly string[];
  readonly selectedPrintingIds: readonly string[];
  readonly text: string;
}

function sampledPools(
  prepared: PreparedPrintedLimitedFormat,
  mode: 'draft' | 'sealed',
  seed: number,
): readonly (readonly PrintedBoosterCopy[])[] {
  const prefix = `printed-limited-sample/v1/${mode}/${String(seed)}`;
  if (mode === 'sealed')
    return [0, 1].map((seat) => prepared.openSealedPool(`${prefix}/${String(seat)}`).cards);
  const draft = runPrintedLimitedDraft(prepared, {
    seed: prefix,
    ...PRINTED_BASELINE_BOT,
  });
  if (draft.result === null) throw new Error('Printed Limited sample draft did not complete');
  return draft.result.seats.slice(0, 2).map((seat) => seat.picks.map((pick) => pick.card));
}

function sampledDeck(pool: readonly PrintedBoosterCopy[], seat: number): PrintedSampledDeck {
  const deck = suggestLimitedDeck(
    prepareLimitedDeck(pool, (card) => printedLimitedFacts(card.payload.printing)),
  );
  const report = validateLimitedDeck(deck);
  if (report.cards !== 40)
    throw new Error(`Printed Limited sample requires 40-card decks, got ${String(report.cards)}`);
  const selected = pool.filter((card) => deck.selectedPhysicalIds.includes(card.physicalId));
  const cards: readonly { readonly name: string; readonly setCode?: string }[] = [
    ...selected.map((card) => ({
      name: card.payload.printing.correctedName,
      setCode: card.payload.sourceSetCode,
    })),
    ...Object.entries(deck.basics).flatMap(([name, count]) =>
      Array.from({ length: count }, () => ({ name })),
    ),
  ];
  if (
    cards.some(
      (card) =>
        /[\r\n|]/u.test(card.name) || (card.setCode !== undefined && !/^[A-Z0-9]+$/u.test(card.setCode)),
    )
  ) {
    throw new Error('Unsafe printed deck-file card identity');
  }
  const name = `printed-sample-seat-${String(seat)}`;
  return {
    file: `${name}.dck`,
    cards,
    poolPhysicalIds: pool.map((card) => card.physicalId),
    poolPrintingIds: pool.map((card) => card.payload.printing.physicalId),
    selectedPhysicalIds: deck.selectedPhysicalIds,
    selectedPrintingIds: selected.map((card) => card.payload.printing.physicalId),
    text: renderDeck({
      name,
      entries: cards.map((card) => ({
        count: 1,
        cardName: card.name,
        ...(card.setCode === undefined ? {} : { setCode: card.setCode }),
      })),
    }),
  };
}

export function samplePrintedLimitedDecks(
  prepared: PreparedPrintedLimitedFormat,
  mode: 'draft' | 'sealed',
  seed: number,
): readonly [PrintedSampledDeck, PrintedSampledDeck] {
  const decks = sampledPools(prepared, mode, seed).map(sampledDeck);
  if (decks.length !== 2) throw new Error('Printed Limited sample needs two distinct seats');
  return [decks[0]!, decks[1]!];
}

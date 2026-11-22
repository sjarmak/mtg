import { z } from 'zod';

const Text = z.string().trim().min(1);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const DeckId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const SetCode = z.string().regex(/^[A-Z0-9]{2,6}$/);

export const PrintedDeckWinRateSchema = z
  .strictObject({
    name: Text,
    product: Text,
    commander: Text,
    winRatePercent: z.number().min(0).max(100),
    games: z.number().int().positive(),
    setCode: SetCode.optional(),
    deckId: DeckId.optional(),
  })
  .refine((row) => (row.setCode === undefined) === (row.deckId === undefined), {
    message: 'a row names a deck id and the set it was printed in together, or neither',
  });

export const PrintedDeckWinRatesSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('commander-precon-win-rates'),
    source: z.strictObject({
      name: Text,
      url: z.url(),
      retrieved: z.iso.date(),
      sourceUpdated: z.iso.datetime(),
      pageSha256: Hash,
      measure: Text,
      minimumSample: Text,
      lowSampleBelowGames: z.number().int().positive(),
    }),
    decks: z.array(PrintedDeckWinRateSchema).min(1),
  })
  .superRefine((table, context) => {
    const listings = new Set<string>();
    const deckIds = new Set<string>();
    for (const row of table.decks) {
      const listing = `${row.product}\0${row.name}`;
      if (listings.has(listing)) {
        context.addIssue({ code: 'custom', message: `two rows for ${row.name} in ${row.product}` });
      }
      listings.add(listing);
      if (row.deckId === undefined) continue;
      if (deckIds.has(row.deckId)) {
        context.addIssue({ code: 'custom', message: `two rows for deck id ${row.deckId}` });
      }
      deckIds.add(row.deckId);
    }
  });

export type PrintedDeckWinRates = z.infer<typeof PrintedDeckWinRatesSchema>;
export type PrintedDeckWinRate = PrintedDeckWinRates['decks'][number];

export function parsePrintedDeckWinRates(input: unknown): PrintedDeckWinRates {
  return PrintedDeckWinRatesSchema.parse(input);
}

export function deckWinRate(table: PrintedDeckWinRates, deckId: string): PrintedDeckWinRate | undefined {
  return table.decks.find((row) => row.deckId === deckId);
}

export function isLowSampleWinRate(table: PrintedDeckWinRates, row: PrintedDeckWinRate): boolean {
  return row.games < table.source.lowSampleBelowGames;
}

export interface PairingDeck {
  readonly id: string;
  readonly name: string;
}

export function winRatesForDecks(
  table: PrintedDeckWinRates,
  decks: readonly PairingDeck[],
): PrintedDeckWinRates | undefined {
  const carried = new Set(decks.map((deck) => deck.id));
  const rows = table.decks.filter((row) => row.deckId !== undefined && carried.has(row.deckId));
  return rows.length === 0 ? undefined : { ...table, decks: rows };
}

export type RankedOpponent<Deck extends PairingDeck> =
  | {
      readonly measured: true;
      readonly deck: Deck;
      readonly rate: PrintedDeckWinRate;
      readonly gapPoints: number;
    }
  | { readonly measured: false; readonly deck: Deck };

export type OpponentRanking<Deck extends PairingDeck> =
  | { readonly kind: 'unmeasured' }
  | {
      readonly kind: 'ranked';
      readonly mine: PrintedDeckWinRate;
      readonly opponents: readonly RankedOpponent<Deck>[];
    };

export function rankOpponentsByCloseness<Deck extends PairingDeck>(
  mine: PairingDeck,
  opponents: readonly Deck[],
  table: PrintedDeckWinRates,
): OpponentRanking<Deck> {
  const mineRate = deckWinRate(table, mine.id);
  if (mineRate === undefined) return { kind: 'unmeasured' };
  const measured: Extract<RankedOpponent<Deck>, { measured: true }>[] = [];
  const unmeasured: Extract<RankedOpponent<Deck>, { measured: false }>[] = [];
  for (const deck of opponents) {
    const rate = deckWinRate(table, deck.id);
    if (rate === undefined) unmeasured.push({ measured: false, deck });
    else {
      measured.push({
        measured: true,
        deck,
        rate,
        gapPoints: rate.winRatePercent - mineRate.winRatePercent,
      });
    }
  }
  measured.sort((left, right) => Math.abs(left.gapPoints) - Math.abs(right.gapPoints));
  unmeasured.sort((left, right) => left.deck.name.localeCompare(right.deck.name, 'en'));
  return { kind: 'ranked', mine: mineRate, opponents: [...measured, ...unmeasured] };
}

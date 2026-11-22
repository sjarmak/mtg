import { z } from 'zod';
import type { PairingDeck } from './deck-win-rates';

const DeckId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const CommanderHeadToHeadShareSchema = z.strictObject({
  point: z.number().min(0).max(1),
  low: z.number().min(0).max(1),
  high: z.number().min(0).max(1),
});

export const CommanderHeadToHeadPairingSchema = z
  .object({
    a: DeckId,
    b: DeckId,
    games: z.number().int().min(0),
    aWins: z.number().int().min(0),
    bWins: z.number().int().min(0),
    rulesDraws: z.number().int().min(0),
    clockDraws: z.number().int().min(0),
    aShare: CommanderHeadToHeadShareSchema.nullable(),
  })
  .refine((pairing) => pairing.a !== pairing.b, {
    message: 'a pairing names one deck on both sides',
  })
  .refine(
    (pairing) => pairing.aWins + pairing.bWins + pairing.rulesDraws + pairing.clockDraws === pairing.games,
    { message: "a pairing's outcomes must add up to its games" },
  )
  .refine((pairing) => (pairing.aShare === null) === (pairing.aWins + pairing.bWins === 0), {
    message: 'a pairing carries a share exactly when it has a decisive game',
  });

export const CommanderHeadToHeadResultsSchema = z
  .object({
    schemaVersion: z.literal(2),
    pairings: z.array(CommanderHeadToHeadPairingSchema).min(1),
  })
  .superRefine((table, context) => {
    const seen = new Set<string>();
    for (const pairing of table.pairings) {
      const key = [pairing.a, pairing.b].sort().join('\0');
      if (seen.has(key)) {
        context.addIssue({ code: 'custom', message: `two pairings for ${pairing.a} and ${pairing.b}` });
      }
      seen.add(key);
    }
  });

export type CommanderHeadToHeadPairing = z.infer<typeof CommanderHeadToHeadPairingSchema>;
export type CommanderHeadToHeadResults = z.infer<typeof CommanderHeadToHeadResultsSchema>;

export function parseCommanderHeadToHeadResults(input: unknown): CommanderHeadToHeadResults {
  return CommanderHeadToHeadResultsSchema.parse(input);
}

export const HEAD_TO_HEAD_MINIMUM_DECIDED_GAMES = 20;

export function headToHeadDecidedGames(pairing: CommanderHeadToHeadPairing): number {
  return pairing.games - pairing.clockDraws;
}

export function headToHeadForDecks(
  table: CommanderHeadToHeadResults,
  decks: readonly PairingDeck[],
): CommanderHeadToHeadResults | undefined {
  const carried = new Set(decks.map((deck) => deck.id));
  const pairings = table.pairings.filter((pairing) => carried.has(pairing.a) && carried.has(pairing.b));
  return pairings.length === 0 ? undefined : { ...table, pairings };
}

function pairingFor(
  table: CommanderHeadToHeadResults,
  mineId: string,
  opponentId: string,
): CommanderHeadToHeadPairing | undefined {
  return table.pairings.find(
    (pairing) =>
      (pairing.a === mineId && pairing.b === opponentId) ||
      (pairing.a === opponentId && pairing.b === mineId),
  );
}

export type RankedHeadToHeadOpponent<Deck extends PairingDeck> =
  | {
      readonly measured: true;
      readonly deck: Deck;
      readonly decided: number;
      readonly mineWins: number;
      readonly opponentWins: number;
      readonly mineShare: number;
      readonly gap: number;
    }
  | { readonly measured: false; readonly deck: Deck };

export function rankHeadToHeadByCloseness<Deck extends PairingDeck>(
  mine: PairingDeck,
  opponents: readonly Deck[],
  table: CommanderHeadToHeadResults,
): readonly RankedHeadToHeadOpponent<Deck>[] {
  const measured: Extract<RankedHeadToHeadOpponent<Deck>, { measured: true }>[] = [];
  const unmeasured: Extract<RankedHeadToHeadOpponent<Deck>, { measured: false }>[] = [];
  for (const deck of opponents) {
    const pairing = pairingFor(table, mine.id, deck.id);
    const decided = pairing === undefined ? 0 : headToHeadDecidedGames(pairing);
    if (pairing === undefined || decided < HEAD_TO_HEAD_MINIMUM_DECIDED_GAMES || pairing.aShare === null) {
      unmeasured.push({ measured: false, deck });
      continue;
    }
    const mineIsA = pairing.a === mine.id;
    const mineWins = mineIsA ? pairing.aWins : pairing.bWins;
    const opponentWins = mineIsA ? pairing.bWins : pairing.aWins;
    const mineShare = mineIsA ? pairing.aShare.point : 1 - pairing.aShare.point;
    measured.push({
      measured: true,
      deck,
      decided,
      mineWins,
      opponentWins,
      mineShare,
      gap: Math.abs(mineShare - 0.5),
    });
  }
  measured.sort((left, right) => left.gap - right.gap);
  unmeasured.sort((left, right) => left.deck.name.localeCompare(right.deck.name, 'en'));
  return [...measured, ...unmeasured];
}

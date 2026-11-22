import { z } from 'zod';

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const Share = z.strictObject({
  point: z.number().min(0).max(1),
  low: z.number().min(0).max(1),
  high: z.number().min(0).max(1),
});

const PlayOrderCell = z.strictObject({
  games: z.number().int().min(0),
  aWins: z.number().int().min(0),
  bWins: z.number().int().min(0),
});

export const CommanderHeadToHeadDeckSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  deckFileSha256: Sha256,
});

export const CommanderHeadToHeadGameRecordSchema = z
  .strictObject({
    game: z.number().int().positive(),
    listedFirst: z.enum(['a', 'b']),
    playedFirst: z.enum(['a', 'b']),
    outcome: z.enum(['win', 'rules-draw', 'clock-draw']),
    winner: z.enum(['a', 'b']).nullable(),
    turn: z.number().int().positive().nullable(),
    durationMs: z.number().int().min(0),
  })
  .refine((record) => (record.outcome === 'win') === (record.winner !== null), {
    message: 'winner must be set exactly when outcome is win',
  });

export const CommanderHeadToHeadPairingSchema = z.strictObject({
  a: z.string().min(1),
  b: z.string().min(1),
  games: z.number().int().min(0),
  aWins: z.number().int().min(0),
  bWins: z.number().int().min(0),
  rulesDraws: z.number().int().min(0),
  clockDraws: z.number().int().min(0),
  seeds: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  commands: z.tuple([z.string().min(1), z.string().min(1)]),
  aShare: Share.nullable(),
  byPlayOrder: z.strictObject({
    aPlayedFirst: PlayOrderCell,
    bPlayedFirst: PlayOrderCell,
  }),
  aBalancedShare: z.number().min(0).max(1).nullable(),
  meanTurns: z.number().min(0).nullable(),
  meanMs: z.number().min(0),
  gameRecords: z.array(CommanderHeadToHeadGameRecordSchema),
});

export const CommanderHeadToHeadOverallSchema = z.strictObject({
  id: z.string().min(1),
  games: z.number().int().min(0),
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
  rulesDraws: z.number().int().min(0),
  clockDraws: z.number().int().min(0),
  share: Share.nullable(),
});

export const CommanderHeadToHeadResultsSchema = z.strictObject({
  schemaVersion: z.literal(2),
  format: z.strictObject({
    id: z.string().min(1),
    contentSha256: Sha256,
  }),
  forgeVersion: z.string().min(1),
  measuredAt: z.string().min(1),
  gamesPerPairing: z.number().int().positive(),
  clockSeconds: z.number().int().positive(),
  method: z.string().min(1),
  baseSeed: z.number().int().positive(),
  players: z.literal('forge-ai-both-seats'),
  confidence: z.literal(0.95),
  decks: z.array(CommanderHeadToHeadDeckSchema),
  pairings: z.array(CommanderHeadToHeadPairingSchema),
  overall: z.array(CommanderHeadToHeadOverallSchema),
});

export type Share = z.infer<typeof Share>;
export type CommanderHeadToHeadPlayOrderCell = z.infer<typeof PlayOrderCell>;
export type CommanderHeadToHeadDeck = z.infer<typeof CommanderHeadToHeadDeckSchema>;
export type CommanderHeadToHeadGameRecord = z.infer<typeof CommanderHeadToHeadGameRecordSchema>;
export type CommanderHeadToHeadPairing = z.infer<typeof CommanderHeadToHeadPairingSchema>;
export type CommanderHeadToHeadOverall = z.infer<typeof CommanderHeadToHeadOverallSchema>;
export type CommanderHeadToHeadResults = z.infer<typeof CommanderHeadToHeadResultsSchema>;

export function parseCommanderHeadToHeadResults(value: unknown): CommanderHeadToHeadResults {
  return CommanderHeadToHeadResultsSchema.parse(value);
}

export const METHOD_STATEMENT =
  "Forge's own AI plays both seats through Forge's sim entry point; each invocation is seeded, so a pairing can be played again; who plays first is read from Forge's log for every game and is not controlled by the tool; a game Forge's clock stops is recorded as a clock draw and counted for neither deck.";

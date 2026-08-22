/**
 * Native Draft evidence, from pack one through a kernel game.
 *
 * The important join is by physical copy, not card name: a common can appear
 * twice in one drafted pool, and drawn/cast/resolved evidence must say which
 * copy the game moved. These tests therefore follow pick-instance ids into
 * decks and event evidence, and make the worker-width claim over serialized
 * artifact bytes rather than over a summary statistic.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SLICE_BOOSTER } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import {
  DRAFT_CALIBRATION_ARTIFACT_VERSION,
  DRAFT_COLLATION_VERSION,
  MAX_DRAFT_CARD_FLOOR,
  MAX_DRAFT_GAMES_PER_SEAT_ORDER,
  MAX_DRAFT_PACKS_PER_SEAT,
  MAX_DRAFT_PAIRINGS,
  MAX_DRAFT_PATH_LENGTH,
  MAX_DRAFT_RECIPE_SLOT_COUNT,
  MAX_DRAFT_SEED_LENGTH,
  MAX_DRAFT_SET_SIZE,
  MAX_DRAFT_WORKERS,
  clusteredDraftUncertainty,
  gameFingerprint,
  parseDraftCalibrationArgs,
  parseDraftCollation,
  readDraftCalibrationArtifact,
  runDraftCalibration,
  successfulResolutionEventIndexes,
  writeDraftCalibrationArtifactAtomic,
} from '@mtg/metrics';
import type { GameEvent } from '@mtg/kernel';

const SET_PATH = fileURLToPath(
  new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);

function loadSet(): readonly Card[] {
  const value: unknown = JSON.parse(readFileSync(SET_PATH, 'utf8'));
  const cards = (value as { cards?: unknown }).cards;
  if (!Array.isArray(cards)) throw new Error('fixture has no cards');
  return cards.map((card) => parseCard(card));
}

const SET = loadSet();
const COLLATION = {
  version: DRAFT_COLLATION_VERSION,
  recipe: SLICE_BOOSTER,
} as const;
const OPTIONS = {
  seed: 'calibration/test',
  collation: COLLATION,
  gamesPerSeatOrder: 1,
  pairings: [[0, 1]] as const,
  cardFloor: 4,
};

describe('the native Draft calibration journey', { timeout: 60_000 }, () => {
  it('is byte-identical across worker widths', async () => {
    const serialWidth = await runDraftCalibration(SET, { ...OPTIONS, workers: 1 });
    const parallelWidth = await runDraftCalibration(SET, { ...OPTIONS, workers: 2 });

    expect(JSON.stringify(parallelWidth)).toBe(JSON.stringify(serialWidth));
  });

  it('retains draft, legal-deck, native-game, and physical-card evidence', async () => {
    const artifact = await runDraftCalibration(SET, { ...OPTIONS, workers: 1 });

    expect(artifact.version).toBe(DRAFT_CALIBRATION_ARTIFACT_VERSION);
    expect(artifact.scope).toEqual({
      format: 'Draft',
      automated: true,
      humanEvidence: false,
      sealedEvidence: false,
    });
    expect(artifact.draft.seats).toHaveLength(8);
    expect(artifact.draft.seats.every((seat) => seat.picks.length === 36)).toBe(true);
    expect(artifact.decks).toHaveLength(8);
    expect(artifact.decks.every((deck) => deck.cards.length === 40)).toBe(true);
    expect(
      artifact.decks.every((deck) => deck.cards.filter((card) => card.source === 'draftPick').length === 23),
    ).toBe(true);
    expect(
      artifact.decks.every(
        (deck) => deck.cards.filter((card) => card.source === 'basicLandSupply').length === 17,
      ),
    ).toBe(true);

    expect(artifact.summary).toMatchObject({ games: 2, pairings: 1, seatOrders: 2 });
    expect(artifact.summary.distinctGames).toBeGreaterThan(0);
    expect(artifact.games.map((game) => game.draftSeats)).toEqual([
      [0, 1],
      [1, 0],
    ]);
    expect(artifact.games.every((game) => game.replay.extras.sim_game_seed === game.seed)).toBe(true);
    expect(artifact.games.some((game) => game.cardEvents.some((event) => event.drawn))).toBe(true);

    const pickIds = new Set(
      artifact.draft.seats.flatMap((seat) => seat.picks.map((pick) => pick.instanceId)),
    );
    for (const deck of artifact.decks) {
      for (const card of deck.cards) {
        if (card.source === 'draftPick') expect(pickIds.has(card.instanceId)).toBe(true);
      }
    }
    for (const game of artifact.games) {
      const deckIds = new Set(
        game.draftSeats.flatMap((seat) => artifact.decks[seat]?.cards.map((card) => card.instanceId) ?? []),
      );
      for (const event of game.cardEvents) expect(deckIds.has(event.instanceId)).toBe(true);
    }

    for (const card of artifact.cards) {
      const picked = artifact.draft.seats
        .flatMap((seat) => seat.picks)
        .filter((pick) => pick.cardId === card.cardId).length;
      expect(card.inclusionCount + card.unusedCount).toBe(picked);
      expect(card.gamesIncluded).toBeLessThanOrEqual(artifact.games.length);
      expect(card.uncertainty.state).toBe('underSampled');
      expect(card.uncertainty.winRate).toBeNull();
    }
    expect(artifact.cards).toHaveLength(SET.length);

    expect(readDraftCalibrationArtifact(artifact, 'fresh artifact')).toEqual(artifact);
  });

  it('pins the default study to all 28 pairings in both seat orders', async () => {
    const artifact = await runDraftCalibration(SET, {
      seed: 'calibration/default-study',
      collation: COLLATION,
      workers: 2,
      gamesPerSeatOrder: 1,
      cardFloor: 4,
    });
    expect(artifact.summary).toMatchObject({ pairings: 28, seatOrders: 2, gamesPerSeatOrder: 1, games: 56 });
    expect(artifact.games).toHaveLength(28 * 2);
  });
});

describe('hostile calibration inputs', () => {
  it('requires an explicit, versioned, nonempty collation', () => {
    expect(() => parseDraftCollation({}, 'collation.json')).toThrow(/version/i);
    expect(() =>
      parseDraftCollation({ version: DRAFT_COLLATION_VERSION, recipe: [] }, 'collation.json'),
    ).toThrow(/at least one slot/i);
    expect(() =>
      parseDraftCollation(
        { version: DRAFT_COLLATION_VERSION, recipe: [{ rarity: 'common', count: 0 }] },
        'collation.json',
      ),
    ).toThrow(/recipe\[0\]\.count/i);
  });

  it('carries a rare/mythic sheet, and refuses a weighted slot that is malformed', () => {
    // A collation document is the only way a recipe reaches this harness, and
    // the slot object was `.strict()` over `{rarity, count}` alone: the
    // rare/mythic sheet every set with a mythic is opened from was rejected as
    // an unrecognized key, so the harness could not calibrate the set at all.
    const weighted = parseDraftCollation(
      {
        version: DRAFT_COLLATION_VERSION,
        recipe: [
          { rarity: 'common', count: 9 },
          {
            rarity: 'rare',
            count: 1,
            rarityWeights: [
              { rarity: 'rare', weight: 2 },
              { rarity: 'mythic', weight: 1 },
            ],
          },
        ],
      },
      'collation.json',
    );
    expect(weighted.recipe[1]?.rarityWeights).toStrictEqual([
      { rarity: 'rare', weight: 2 },
      { rarity: 'mythic', weight: 1 },
    ]);
    expect(() =>
      parseDraftCollation(
        {
          version: DRAFT_COLLATION_VERSION,
          recipe: [{ rarity: 'rare', count: 1, rarityWeights: [{ rarity: 'mythic', weight: 1 }] }],
        },
        'collation.json',
      ),
    ).toThrow(/must include its primary rarity/i);
    expect(() =>
      parseDraftCollation(
        {
          version: DRAFT_COLLATION_VERSION,
          recipe: [
            {
              rarity: 'rare',
              count: 1,
              rarityWeights: [
                { rarity: 'rare', weight: 1 },
                { rarity: 'rare', weight: 2 },
              ],
            },
          ],
        },
        'collation.json',
      ),
    ).toThrow(/weight one rarity twice/i);
  });

  it('rejects duplicate set ids and pools too thin to make a legal deck', async () => {
    await expect(runDraftCalibration([...SET, SET[0] as Card], { ...OPTIONS, workers: 1 })).rejects.toThrow(
      /share an id/i,
    );
    await expect(runDraftCalibration(SET, { ...OPTIONS, workers: 1, packsPerSeat: 1 })).rejects.toThrow(
      /seat 0:[\s\S]*23 are required/i,
    );

    const rare = {
      ...(SET[0] as Card),
      id: 'tgr-calibration-unreachable-rare',
      rarity: 'rare' as const,
      set: { code: 'TGR', collectorNumber: 999 },
    };
    await expect(runDraftCalibration([...SET, rare], { ...OPTIONS, workers: 1 })).rejects.toThrow(
      /sheet Rare is in no pack slot/i,
    );
  });

  it('rejects malformed logs and dangling physical-card references', async () => {
    const artifact = await runDraftCalibration(SET, { ...OPTIONS, workers: 1 });
    const missingLog = structuredClone(artifact) as Record<string, unknown>;
    const games = missingLog['games'] as Record<string, unknown>[];
    delete games[0]?.['replay'];
    expect(() => readDraftCalibrationArtifact(missingLog, 'missing-log.json')).toThrow(
      /missing-log\.json:[\s\S]*games\[0\]\.replay/i,
    );

    const dangling = structuredClone(artifact);
    const firstEvent = dangling.games[0]?.cardEvents[0];
    if (firstEvent === undefined) throw new Error('fixture game emitted no physical-card evidence');
    (firstEvent as { instanceId: string }).instanceId = 'not-a-deck-instance';
    expect(() => readDraftCalibrationArtifact(dangling, 'dangling.json')).toThrow(/unknown deck instance/i);
  });

  it('rejects a deleted study even when its headline counts were zeroed', async () => {
    const artifact = await runDraftCalibration(SET, { ...OPTIONS, workers: 1 });
    const stale = structuredClone(artifact);
    stale.games = [];
    stale.summary.games = 0;
    stale.summary.distinctGames = 0;
    stale.summary.pairings = 0;
    expect(() => readDraftCalibrationArtifact(stale, 'deleted-study.json')).toThrow(
      /deleted-study\.json:[\s\S]*(pairings|scheduled games|card evidence)/i,
    );
  });

  it('recomputes set and deck identities instead of trusting their headlines', async () => {
    const artifact = await runDraftCalibration(SET, { ...OPTIONS, workers: 1 });
    const wrongCount = structuredClone(artifact);
    wrongCount.set.cards -= 1;
    expect(() => readDraftCalibrationArtifact(wrongCount, 'set-count.json')).toThrow(/set.*card/i);

    const wrongSetIdentity = structuredClone(artifact);
    const identity = wrongSetIdentity.set.cardIdentities[0];
    if (identity === undefined) throw new Error('fixture artifact has no set identities');
    identity.fingerprint = '0'.repeat(64);
    expect(() => readDraftCalibrationArtifact(wrongSetIdentity, 'set-identity.json')).toThrow(
      /set fingerprint/i,
    );

    const wrongDeckIdentity = structuredClone(artifact);
    const deck = wrongDeckIdentity.decks[0];
    if (deck === undefined) throw new Error('fixture artifact has no decks');
    deck.fingerprint = '0'.repeat(64);
    expect(() => readDraftCalibrationArtifact(wrongDeckIdentity, 'deck-identity.json')).toThrow(
      /deck fingerprint/i,
    );
  });

  it.each([
    'inclusionCount',
    'unusedCount',
    'gamesIncluded',
    'winsIncluded',
    'gamesDrawn',
    'winsWhenDrawn',
    'gamesCast',
    'winsWhenCast',
    'gamesResolved',
    'winsWhenResolved',
  ] as const)('recomputes and rejects a stale card aggregate: %s', async (field) => {
    const artifact = await runDraftCalibration(SET, { ...OPTIONS, workers: 1 });
    const stale = structuredClone(artifact);
    const card = stale.cards[0];
    if (card === undefined) throw new Error('fixture artifact has no card rows');
    card[field] += 1;
    expect(() => readDraftCalibrationArtifact(stale, `${field}.json`)).toThrow(/card evidence/i);
  });

  it.each(['games', 'decidedGames', 'distinctGames', 'distinctWins', 'symmetricGames'] as const)(
    'recomputes and rejects stale uncertainty evidence: %s',
    async (field) => {
      const artifact = await runDraftCalibration(SET, { ...OPTIONS, workers: 1 });
      const stale = structuredClone(artifact);
      const card = stale.cards[0];
      if (card === undefined) throw new Error('fixture artifact has no card rows');
      card.uncertainty[field] += 1;
      expect(() => readDraftCalibrationArtifact(stale, `${field}.json`)).toThrow(/card evidence/i);
    },
  );

  it('rejects stale pairing and seat-order counts', async () => {
    const artifact = await runDraftCalibration(SET, { ...OPTIONS, workers: 1 });
    const missingOrder = structuredClone(artifact);
    missingOrder.games.splice(1, 1);
    missingOrder.summary.games -= 1;
    missingOrder.summary.distinctGames = new Set(
      missingOrder.games.map((game) => game.trajectoryFingerprint),
    ).size;
    expect(() => readDraftCalibrationArtifact(missingOrder, 'missing-order.json')).toThrow(
      /(scheduled games|both seat orders)/i,
    );
  });

  it('rejects corruption inside retained pick, game, and card-event transcripts', async () => {
    const artifact = await runDraftCalibration(SET, { ...OPTIONS, workers: 1 });
    const expectRejected = (label: string, mutate: (copy: typeof artifact) => void): void => {
      const copy = structuredClone(artifact);
      mutate(copy);
      expect(() => readDraftCalibrationArtifact(copy, `${label}.json`)).toThrow(
        new RegExp(`${label}\\.json`, 'i'),
      );
    };

    expectRejected('pick-instance', (copy) => {
      const pick = copy.draft.seats[0]?.picks[0];
      if (pick === undefined) throw new Error('fixture artifact has no picks');
      pick.instanceId = 'draft/not-canonical';
    });
    expectRejected('pick-round', (copy) => {
      const pick = copy.draft.seats[0]?.picks[0];
      if (pick === undefined) throw new Error('fixture artifact has no picks');
      pick.round = 8;
    });
    expectRejected('pick-number', (copy) => {
      const pick = copy.draft.seats[0]?.picks[0];
      if (pick === undefined) throw new Error('fixture artifact has no picks');
      pick.pickNumber = 2;
    });
    expectRejected('pick-pack-size', (copy) => {
      const pick = copy.draft.seats[0]?.picks[0];
      if (pick === undefined) throw new Error('fixture artifact has no picks');
      pick.packSize = 999_999_999;
    });
    expectRejected('pick-opener', (copy) => {
      const pick = copy.draft.seats[0]?.picks[1];
      if (pick === undefined) throw new Error('fixture artifact has no second pick');
      pick.openedBy = (pick.openedBy + 1) % 8;
    });
    expectRejected('game-starter', (copy) => {
      const game = copy.games[0];
      if (game === undefined) throw new Error('fixture artifact has no game');
      game.startingPlayer = game.startingPlayer === 0 ? 1 : 0;
    });
    expectRejected('game-starter-schedule', (copy) => {
      const game = copy.games[0];
      if (game === undefined) throw new Error('fixture artifact has no game');
      game.startingPlayer = 1;
      game.replay.metadata.on_play = 0;
      game.trajectoryFingerprint = gameFingerprint(game.replay);
      copy.summary.distinctGames = new Set(
        copy.games.map((candidate) => candidate.trajectoryFingerprint),
      ).size;
    });
    expectRejected('game-turns', (copy) => {
      const game = copy.games[0];
      if (game === undefined) throw new Error('fixture artifact has no game');
      game.turns += 999;
    });
    expectRejected('game-decisions', (copy) => {
      const game = copy.games[0];
      if (game === undefined) throw new Error('fixture artifact has no game');
      game.decisions += 999;
    });
    expectRejected('game-reason', (copy) => {
      const game = copy.games[0];
      if (game === undefined) throw new Error('fixture artifact has no game');
      game.reason = game.reason === 'turnLimit' ? 'concede' : 'turnLimit';
    });
    expectRejected('game-winner', (copy) => {
      const game = copy.games[0];
      if (game === undefined) throw new Error('fixture artifact has no game');
      game.winnerDraftSeat =
        game.winnerDraftSeat === game.draftSeats[0] ? game.draftSeats[1] : game.draftSeats[0];
    });
    expectRejected('card-event-index', (copy) => {
      const observed = copy.games
        .flatMap((game) => game.cardEvents)
        .find((event) => event.drawEventIndexes.length > 0);
      if (observed === undefined) throw new Error('fixture artifact has no drawn card event');
      observed.drawEventIndexes[0] = 999_999_999;
    });
    expectRejected('relevant-event-ledger', (copy) => {
      const game = copy.games.find((candidate) => candidate.relevantCardEvents.length > 0);
      const event = game?.relevantCardEvents[0];
      if (event === undefined) throw new Error('fixture artifact has no relevant event ledger');
      event.index += 1;
    });
    expectRejected('raw-event-count', (copy) => {
      const game = copy.games[0];
      if (game === undefined) throw new Error('fixture artifact has no game');
      game.rawEventCount += 1;
    });
  });

  it('parses a checked CLI contract and refuses missing or unknown arguments', () => {
    expect(
      parseDraftCalibrationArgs([
        '--set',
        'set.json',
        '--collation',
        'collation.json',
        '--seed',
        'run/1',
        '--out',
        'draft.json',
        '--workers',
        '3',
      ]),
    ).toEqual({
      setPath: 'set.json',
      collationPath: 'collation.json',
      seed: 'run/1',
      outputPath: 'draft.json',
      workers: 3,
      gamesPerSeatOrder: 1,
      packsPerSeat: 3,
      cardFloor: 200,
    });
    expect(() => parseDraftCalibrationArgs(['--set', 'set.json'])).toThrow(/--collation/);
    expect(() => parseDraftCalibrationArgs(['--wat', 'no'])).toThrow(/unknown argument --wat/);
    expect(() =>
      parseDraftCalibrationArgs([
        '--set',
        './same.json',
        '--collation',
        'collation.json',
        '--seed',
        'run',
        '--out',
        'same.json',
      ]),
    ).toThrow(/--out.*must differ.*--set/i);
    expect(() =>
      parseDraftCalibrationArgs([
        '--set',
        'set.json',
        '--collation',
        './same.json',
        '--seed',
        'run',
        '--out',
        'same.json',
      ]),
    ).toThrow(/--out.*must differ.*--collation/i);
  });

  it('refuses bounded hostile inputs before a simulation can start', async () => {
    await expect(runDraftCalibration(SET, { ...OPTIONS, workers: MAX_DRAFT_WORKERS + 1 })).rejects.toThrow(
      /workers.*at most/i,
    );
    await expect(
      runDraftCalibration(SET, {
        ...OPTIONS,
        workers: 1,
        gamesPerSeatOrder: MAX_DRAFT_GAMES_PER_SEAT_ORDER + 1,
      }),
    ).rejects.toThrow(/games per seat order.*at most/i);
    await expect(
      runDraftCalibration(SET, { ...OPTIONS, workers: 1, packsPerSeat: MAX_DRAFT_PACKS_PER_SEAT + 1 }),
    ).rejects.toThrow(/packs per seat.*at most/i);
    await expect(
      runDraftCalibration(SET, { ...OPTIONS, workers: 1, cardFloor: MAX_DRAFT_CARD_FLOOR + 1 }),
    ).rejects.toThrow(/card floor.*at most/i);
    await expect(
      runDraftCalibration(SET, { ...OPTIONS, workers: 1, seed: 's'.repeat(MAX_DRAFT_SEED_LENGTH + 1) }),
    ).rejects.toThrow(/seed.*at most/i);
    await expect(
      runDraftCalibration(
        Array.from({ length: MAX_DRAFT_SET_SIZE + 1 }, () => SET[0] as Card),
        {
          ...OPTIONS,
          workers: 1,
        },
      ),
    ).rejects.toThrow(/set.*at most/i);
    expect(() =>
      parseDraftCollation({
        version: DRAFT_COLLATION_VERSION,
        recipe: [{ rarity: 'common', count: MAX_DRAFT_RECIPE_SLOT_COUNT + 1 }],
      }),
    ).toThrow(/count/i);
    expect(() =>
      parseDraftCollation({
        version: DRAFT_COLLATION_VERSION,
        recipe: [
          { rarity: 'common', count: MAX_DRAFT_RECIPE_SLOT_COUNT },
          { rarity: 'uncommon', count: MAX_DRAFT_RECIPE_SLOT_COUNT },
        ],
      }),
    ).toThrow(/pack size.*at most/i);
    await expect(
      runDraftCalibration(SET, {
        ...OPTIONS,
        workers: 1,
        pairings: Array.from(
          { length: MAX_DRAFT_PAIRINGS + 1 },
          (_unused, index) => [index % 7, (index % 7) + 1] as const,
        ),
      }),
    ).rejects.toThrow(/pairings.*at most/i);
    expect(() =>
      parseDraftCalibrationArgs([
        '--set',
        'set.json',
        '--collation',
        'c.json',
        '--seed',
        'run',
        '--out',
        'out.json',
        '--workers',
        String(MAX_DRAFT_WORKERS + 1),
      ]),
    ).toThrow(/workers.*at most/i);
    for (const [flag, value] of [
      ['--games-per-seat-order', MAX_DRAFT_GAMES_PER_SEAT_ORDER + 1],
      ['--packs-per-seat', MAX_DRAFT_PACKS_PER_SEAT + 1],
      ['--card-floor', MAX_DRAFT_CARD_FLOOR + 1],
    ] as const) {
      expect(() =>
        parseDraftCalibrationArgs([
          '--set',
          'set.json',
          '--collation',
          'c.json',
          '--seed',
          'run',
          '--out',
          'out.json',
          flag,
          String(value),
        ]),
      ).toThrow(new RegExp(`${flag}.*at most`, 'i'));
    }
    expect(() =>
      parseDraftCalibrationArgs([
        '--set',
        'set.json',
        '--collation',
        'c.json',
        '--seed',
        's'.repeat(MAX_DRAFT_SEED_LENGTH + 1),
        '--out',
        'out.json',
      ]),
    ).toThrow(/--seed.*at most/i);
    expect(() =>
      parseDraftCalibrationArgs([
        '--set',
        's'.repeat(MAX_DRAFT_PATH_LENGTH + 1),
        '--collation',
        'c.json',
        '--seed',
        'run',
        '--out',
        'out.json',
      ]),
    ).toThrow(/--set.*at most/i);
  });
});

describe('successful resolution evidence', () => {
  const began: GameEvent = { type: 'resolutionBegan', oid: 'o7' };

  it('does not call a spell resolved when the kernel later records its fizzle', () => {
    const events: readonly GameEvent[] = [began, { type: 'spellFizzled', oid: 'o7' }];
    expect(successfulResolutionEventIndexes(events, 'o7', 'instant')).toEqual([]);
  });

  it('requires a permanent to enter after resolution begins', () => {
    const entered: readonly GameEvent[] = [
      began,
      { type: 'zoneChanged', oid: 'o7', from: 'stack', to: 'battlefield', owner: 0 },
      { type: 'permanentEntered', oid: 'o7', controller: 0 },
    ];
    expect(successfulResolutionEventIndexes(entered, 'o7', 'creature')).toEqual([0]);
    expect(successfulResolutionEventIndexes([began], 'o7', 'creature')).toEqual([]);
  });
});

describe('trajectory-clustered uncertainty', () => {
  it('excludes symmetric card-present games instead of counting both seats as independent', () => {
    const uncertainty = clusteredDraftUncertainty(
      [
        { trajectory: 'same', won: true, decided: true, symmetric: true },
        { trajectory: 'same', won: false, decided: true, symmetric: true },
      ],
      1,
      2,
    );
    expect(uncertainty).toMatchObject({
      state: 'underSampled',
      games: 2,
      decidedGames: 0,
      distinctGames: 0,
      symmetricGames: 1,
      winRate: null,
    });
  });

  it('keeps 199 draws plus one decision under a floor of 200', () => {
    const draws = Array.from({ length: 199 }, (_unused, index) => ({
      trajectory: `draw/${String(index)}`,
      won: false,
      decided: false,
      symmetric: false,
    }));
    const uncertainty = clusteredDraftUncertainty(
      [...draws, { trajectory: 'decision', won: true, decided: true, symmetric: false }],
      200,
      200,
    );
    expect(uncertainty).toMatchObject({
      state: 'underSampled',
      games: 200,
      decidedGames: 1,
      distinctGames: 1,
      winRate: null,
    });
  });
});

describe('atomic artifact output', { timeout: 60_000 }, () => {
  it('renames a same-directory temporary file and leaves no partial behind', async () => {
    const root = join(tmpdir(), `mtg-draft-atomic-${String(process.pid)}-${String(Date.now())}`);
    mkdirSync(root);
    try {
      const artifact = await runDraftCalibration(SET, { ...OPTIONS, workers: 1 });
      const output = join(root, 'artifact.json');
      writeDraftCalibrationArtifactAtomic(output, artifact);
      expect(readDraftCalibrationArtifact(JSON.parse(readFileSync(output, 'utf8')), output)).toEqual(
        artifact,
      );
      expect(readdirSync(root)).toEqual(['artifact.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('cleans its temporary file when the final rename fails', async () => {
    const root = join(tmpdir(), `mtg-draft-atomic-fail-${String(process.pid)}-${String(Date.now())}`);
    mkdirSync(root);
    const output = join(root, 'occupied');
    mkdirSync(output);
    try {
      const artifact = await runDraftCalibration(SET, { ...OPTIONS, workers: 1 });
      expect(() => writeDraftCalibrationArtifactAtomic(output, artifact)).toThrow(
        /atomic Draft artifact write/i,
      );
      expect(existsSync(output)).toBe(true);
      expect(readdirSync(root)).toEqual(['occupied']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

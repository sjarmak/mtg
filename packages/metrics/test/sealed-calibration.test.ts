/** The Sealed secondary oracle: six packs per side, never Draft evidence. */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { SLICE_BOOSTER, SLICE_BOOSTER_WITH_RARE_MYTHIC } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import { BASIC_LAND_COLOR, canonicalJson, parseCard } from '@mtg/dsl';
import {
  MAX_SEALED_CARD_FLOOR,
  MAX_SEALED_GAMES_PER_SEAT_ORDER,
  MAX_SEALED_POOL_PAIRS,
  MAX_SEALED_WORKERS,
  parseSealedCalibrationArgs,
  readSealedCalibrationArtifact,
  runSealedCalibration,
  runSealedCalibrationCli,
  writeSealedCalibrationArtifactAtomic,
  type SealedCalibrationArtifact,
  type SealedCollationInput,
} from '../src/sealed-calibration';

const ROOT = new URL('../../../', import.meta.url).pathname;

function loadSet(path: string): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(`${ROOT}${path}`, 'utf8'));
  const cards = (raw as { cards?: unknown }).cards;
  if (!Array.isArray(cards)) throw new Error(`${path} needs cards`);
  return cards.map((card) => parseCard(card));
}

const SET = loadSet('packages/setgen/fixtures/sets/tideglass-reach.set.json');
const COLLATION: SealedCollationInput = {
  version: 'native-draft-collation-v1',
  recipe: SLICE_BOOSTER,
};
const OPTIONS = {
  seed: 'sealed-test-v1',
  collation: COLLATION,
  poolPairs: 2,
  gamesPerSeatOrder: 2,
  cardFloor: 16,
  gameFloor: 16,
} as const;

function copy<T>(value: T): T {
  return structuredClone(value);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

let serial: SealedCalibrationArtifact;

beforeAll(async () => {
  serial = await runSealedCalibration(SET, { ...OPTIONS, workers: 1 });
}, 60_000);

describe('the Sealed campaign contract', () => {
  it('is deterministic across worker widths', async () => {
    const parallel = await runSealedCalibration(SET, { ...OPTIONS, workers: 2 });
    expect(canonicalJson(parallel)).toBe(canonicalJson(serial));
  }, 60_000);

  it('records independent pools, exact opened copies, legal decks, and the games they fed', () => {
    expect(serial.scope).toEqual({
      format: 'Sealed',
      automated: true,
      humanEvidence: false,
      draftEvidence: false,
      interpretation: 'association-not-causal',
    });
    expect(serial.pools).toHaveLength(4);
    expect(new Set(serial.pools.map((pool) => pool.seed)).size).toBe(4);
    for (const pool of serial.pools) {
      expect(pool.boosters).toHaveLength(6);
      expect(pool.openedCards).toBe(72);
      expect(
        new Set(pool.boosters.flatMap((booster) => booster.cards.map((card) => card.instanceId))).size,
      ).toBe(72);
    }

    expect(serial.decks).toHaveLength(4);
    for (const deck of serial.decks) {
      expect(deck.cards).toHaveLength(40);
      expect(deck.spells).toBe(23);
      expect(deck.lands).toBe(17);
      expect(deck.legal40).toBe(true);
      const pool = serial.pools.find(
        (candidate) => candidate.poolIndex === deck.poolIndex && candidate.sealedSeat === deck.sealedSeat,
      );
      const opened = new Set(
        pool?.boosters.flatMap((booster) => booster.cards.map((card) => card.instanceId)) ?? [],
      );
      for (const card of deck.cards) {
        if (card.source === 'opened') expect(opened.has(card.openedInstanceId ?? '')).toBe(true);
        else expect(card.openedInstanceId).toBeNull();
      }
    }

    expect(serial.games).toHaveLength(8);
    for (const poolIndex of [0, 1]) {
      for (const seatOrder of [0, 1]) {
        expect(
          serial.games
            .filter((game) => game.poolIndex === poolIndex && game.seatOrder === seatOrder)
            .map((game) => game.startingPlayer),
        ).toEqual([0, 1]);
      }
    }
    for (const game of serial.games) {
      const expectedDecks = serial.decks.filter((deck) => deck.poolIndex === game.poolIndex);
      expect(expectedDecks).toHaveLength(2);
      expect(game.cardEvents).toHaveLength(80);
      expect(new Set(game.cardEvents.map((event) => event.instanceId))).toEqual(
        new Set(expectedDecks.flatMap((deck) => deck.cards.map((card) => card.instanceId))),
      );
    }
  });

  it('reports pool, mana, game-shape, variance, and non-causal card denominators honestly', () => {
    expect(serial.summary.poolViability).toEqual(expect.objectContaining({ pools: 4, legalDecks: 4 }));
    expect(serial.summary.manaConsistency.decks).toBe(4);
    expect(serial.summary.manaConsistency.selectedColorPairs.reduce((sum, pair) => sum + pair.decks, 0)).toBe(
      4,
    );
    expect(serial.summary.gameShape).toEqual(
      expect.objectContaining({
        state: 'underSampled',
        sampleUnit: 'decidedDistinctTrajectory',
        games: 8,
        floor: 16,
        onPlayWinRate: null,
        interval95: null,
      }),
    );
    expect(serial.summary.gameShape.meanTurns).toBeGreaterThan(0);
    expect(serial.summary.gameShape.turnVariancePopulation).toBeGreaterThanOrEqual(0);
    expect(serial.cards).toHaveLength(SET.length);
    for (const card of serial.cards) {
      expect(card.openedCount).toBe(card.includedCount + card.unusedCount);
      expect(card.gamesResolved).toBeLessThanOrEqual(card.gamesCast);
      expect(card.gamesDrawn).toBeLessThanOrEqual(card.gamesIncluded);
      expect(card.gamesCast).toBeLessThanOrEqual(card.gamesIncluded);
      expect(card.association.claim).toBe('association-not-causal');
      expect(card.association.state).toBe('underSampled');
      expect(card.association.winRate).toBeNull();
    }
  });

  it('round-trips only after recomputing all retained evidence', () => {
    expect(readSealedCalibrationArtifact(JSON.parse(JSON.stringify(serial)), 'round-trip')).toEqual(serial);
  });
});

describe('refusing corrupt or misleading Sealed evidence', () => {
  it('rejects a coordinated rewrite of a supplied basic through the deck and game ledgers', () => {
    const artifact = copy(serial);
    const deck = artifact.decks.find((candidate) =>
      candidate.cards.some((card) => card.source === 'basicLandSupply'),
    );
    const card = deck?.cards.find((candidate) => candidate.source === 'basicLandSupply');
    if (deck === undefined || card === undefined) throw new Error('fixture has no supplied basic');
    (card as { cardId: string; cardName: string }).cardId = 'ghost-basic-land';
    (card as { cardId: string; cardName: string }).cardName = 'Ghost Basic';
    (deck as { fingerprint: string }).fingerprint = sha256(deck.cards);
    for (const game of artifact.games) {
      for (const event of game.cardEvents) {
        if (event.instanceId === card.instanceId) (event as { cardId: string }).cardId = card.cardId;
      }
    }

    expect(() => readSealedCalibrationArtifact(artifact, 'coordinated basic rewrite')).toThrow(
      /invalid Sealed/i,
    );
  });

  it('rejects a coordinated canonical basic-type swap with matching game card ids', () => {
    const artifact = copy(serial);
    const deck = artifact.decks.find((candidate) => {
      const types = new Set(
        candidate.cards.filter((card) => card.source === 'basicLandSupply').map((card) => card.basicLandType),
      );
      return types.size > 1;
    });
    const supplied = deck?.cards.filter((card) => card.source === 'basicLandSupply') ?? [];
    const card = supplied[0];
    const replacement = supplied.find((candidate) => candidate.basicLandType !== card?.basicLandType);
    if (deck === undefined || card === undefined || replacement === undefined) {
      throw new Error('fixture has no two-type supplied basic plan');
    }
    const oldType = card.basicLandType;
    const newType = replacement.basicLandType;
    if (oldType === null || newType === null) throw new Error('supplied basic has no basic type');
    Object.assign(card, {
      cardId: replacement.cardId,
      cardName: replacement.cardName,
      cardKind: replacement.cardKind,
      basicLandType: replacement.basicLandType,
      rarity: replacement.rarity,
      printing: copy(replacement.printing),
      fingerprint: replacement.fingerprint,
    });
    const oldReport = deck.manaReports.find((report) => report.color === BASIC_LAND_COLOR[oldType]);
    const newReport = deck.manaReports.find((report) => report.color === BASIC_LAND_COLOR[newType]);
    if (oldReport === undefined || newReport === undefined)
      throw new Error('fixture mana plan is incomplete');
    (oldReport as { sources: number }).sources -= 1;
    (newReport as { sources: number }).sources += 1;
    (deck as { fingerprint: string }).fingerprint = sha256(deck.cards);
    for (const game of artifact.games) {
      for (const event of game.cardEvents) {
        if (event.instanceId === card.instanceId) (event as { cardId: string }).cardId = card.cardId;
      }
    }

    expect(() => readSealedCalibrationArtifact(artifact, 'canonical basic swap')).toThrow(/invalid Sealed/i);
  });

  it.each([
    [
      'stale version',
      (artifact: SealedCalibrationArtifact) => ((artifact as { version: string }).version = 'old'),
    ],
    [
      'duplicate pool',
      (artifact: SealedCalibrationArtifact) => {
        const pools = artifact.pools as unknown as SealedCalibrationArtifact['pools'][number][];
        pools[1] = copy(pools[0] as SealedCalibrationArtifact['pools'][number]);
      },
    ],
    [
      'mixed set',
      (artifact: SealedCalibrationArtifact) => {
        const card = artifact.pools[0]?.boosters[0]?.cards[0] as { printing: { code: string } };
        card.printing.code = 'OTHER';
      },
    ],
    [
      'mixed collation',
      (artifact: SealedCalibrationArtifact) => {
        (artifact.pools[0] as { collationFingerprint: string }).collationFingerprint = 'a'.repeat(64);
      },
    ],
    [
      'truncated pool',
      (artifact: SealedCalibrationArtifact) => {
        (artifact.pools as unknown as unknown[]).pop();
      },
    ],
    [
      'truncated schedule',
      (artifact: SealedCalibrationArtifact) => {
        (artifact.games as unknown as unknown[]).pop();
      },
    ],
    [
      'truncated deck',
      (artifact: SealedCalibrationArtifact) => {
        (artifact.decks as unknown as unknown[]).pop();
      },
    ],
    [
      'duplicate game seed',
      (artifact: SealedCalibrationArtifact) => {
        const first = artifact.games[0];
        const second = artifact.games[1] as { seed: string } | undefined;
        if (first === undefined || second === undefined) throw new Error('fixture games are missing');
        second.seed = first.seed;
      },
    ],
    [
      'corrupt game seed',
      (artifact: SealedCalibrationArtifact) => {
        (artifact.games[0] as { seed: string }).seed = 'another-study/game/0';
      },
    ],
    [
      'corrupt schedule order',
      (artifact: SealedCalibrationArtifact) => {
        const games = artifact.games as unknown as SealedCalibrationArtifact['games'][number][];
        const first = games[0];
        const second = games[1];
        if (first === undefined || second === undefined) throw new Error('fixture games are missing');
        games[0] = second;
        games[1] = first;
      },
    ],
    [
      'corrupt card-event derivation',
      (artifact: SealedCalibrationArtifact) => {
        const event = artifact.games[0]?.cardEvents[0] as { drawn: boolean } | undefined;
        if (event === undefined) throw new Error('fixture game has no physical card event');
        event.drawn = !event.drawn;
      },
    ],
    [
      'corrupt alternating start',
      (artifact: SealedCalibrationArtifact) => {
        const game = artifact.games[0] as { startingPlayer: 0 | 1 };
        game.startingPlayer = game.startingPlayer === 0 ? 1 : 0;
      },
    ],
    [
      'corrupt event ledger',
      (artifact: SealedCalibrationArtifact) => {
        const game = artifact.games[0];
        const event = game?.relevantCardEvents[0] as { index: number } | undefined;
        if (game === undefined || event === undefined) throw new Error('fixture game has no event');
        event.index = game.rawEventCount;
      },
    ],
    [
      'corrupt card denominator',
      (artifact: SealedCalibrationArtifact) => {
        const card = artifact.cards[0] as { openedCount: number };
        card.openedCount += 1;
      },
    ],
    [
      'corrupt summary',
      (artifact: SealedCalibrationArtifact) => {
        (artifact.summary.poolViability as { legalDecks: number }).legalDecks = 0;
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const artifact = copy(serial);
    mutate(artifact);
    expect(() => readSealedCalibrationArtifact(artifact, 'corrupt artifact')).toThrow(/invalid Sealed/i);
  });
});

describe('bounded operator surface', () => {
  it('rejects direct runs that cannot demonstrate independent pools and alternating starts', async () => {
    await expect(runSealedCalibration(SET, { ...OPTIONS, poolPairs: 1 })).rejects.toThrow(/at least 2/i);
    await expect(runSealedCalibration(SET, { ...OPTIONS, gamesPerSeatOrder: 1 })).rejects.toThrow(
      /at least 2/i,
    );
    await expect(runSealedCalibration(SET, { ...OPTIONS, workers: MAX_SEALED_WORKERS + 1 })).rejects.toThrow(
      /at most/i,
    );
  });

  it('rejects a collation that silently makes a printed rarity unopenable', async () => {
    await expect(
      runSealedCalibration(SET, {
        ...OPTIONS,
        collation: {
          version: 'native-draft-collation-v1',
          recipe: [{ rarity: 'common', count: 9 }],
        },
      }),
    ).rejects.toThrow(/not total.*uncommon/i);
  });

  it('opens a set that prints mythics off the shared rare sheet', async () => {
    // The rare/mythic slot is one sheet supplying two rarities, which is what
    // `boosterRecipeFor` returns the moment a set prints a mythic. Three checks
    // here read a slot's rarity and all three read only the printed word: the
    // collation document rejected the `rarityWeights` key outright, the
    // totality check called every mythic uncollated, and the per-pack check
    // called a pack that rolled the mythic corrupt.
    const mythicSet = SET.map((card, index) =>
      index % 7 === 0
        ? { ...card, rarity: 'mythic' as const }
        : index % 7 === 1
          ? { ...card, rarity: 'rare' as const }
          : card,
    );
    expect(mythicSet.some((card) => card.rarity === 'mythic')).toBe(true);
    const artifact = await runSealedCalibration(mythicSet, {
      ...OPTIONS,
      collation: { version: 'native-draft-collation-v1', recipe: SLICE_BOOSTER_WITH_RARE_MYTHIC },
      workers: 1,
    });
    // The artifact schema re-checks every pack against the recipe, so this is
    // the per-booster count assertion as well as a parse.
    expect(() => readSealedCalibrationArtifact(JSON.parse(JSON.stringify(artifact)))).not.toThrow();
    const opened = artifact.pools.flatMap((pool) => pool.boosters.flatMap((booster) => booster.cards));
    expect(opened.some((card) => card.rarity === 'mythic')).toBe(true);
    expect(opened.some((card) => card.rarity === 'rare')).toBe(true);
    for (const pool of artifact.pools) {
      for (const booster of pool.boosters) {
        const high = booster.cards.filter((card) => card.rarity === 'rare' || card.rarity === 'mythic');
        expect(high).toHaveLength(1);
      }
    }
  }, 120_000);

  it('parses explicit bounded paths and counts', () => {
    expect(
      parseSealedCalibrationArgs([
        '--set',
        'set.json',
        '--collation',
        'collation.json',
        '--seed',
        'study',
        '--out',
        'sealed.json',
        '--workers',
        '2',
        '--pool-pairs',
        '3',
        '--games-per-seat-order',
        '4',
        '--card-floor',
        '5',
        '--game-floor',
        '6',
      ]),
    ).toEqual({
      setPath: 'set.json',
      collationPath: 'collation.json',
      seed: 'study',
      outputPath: 'sealed.json',
      workers: 2,
      poolPairs: 3,
      gamesPerSeatOrder: 4,
      cardFloor: 5,
      gameFloor: 6,
    });
  });

  it.each([
    ['--workers', MAX_SEALED_WORKERS + 1],
    ['--pool-pairs', MAX_SEALED_POOL_PAIRS + 1],
    ['--games-per-seat-order', MAX_SEALED_GAMES_PER_SEAT_ORDER + 1],
    ['--card-floor', MAX_SEALED_CARD_FLOOR + 1],
  ])('rejects an over-bound %s', (flag, value) => {
    expect(() =>
      parseSealedCalibrationArgs([
        '--set',
        'set.json',
        '--collation',
        'collation.json',
        '--seed',
        'study',
        '--out',
        'sealed.json',
        flag,
        String(value),
      ]),
    ).toThrow(/at most/i);
  });

  it('atomically writes an artifact the strict reader accepts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sealed-calibration-'));
    try {
      const output = join(directory, 'sealed.json');
      writeSealedCalibrationArtifactAtomic(output, serial);
      expect(readSealedCalibrationArtifact(JSON.parse(readFileSync(output, 'utf8')), output)).toEqual(serial);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['set', 8 * 1024 * 1024 + 1],
    ['collation', 64 * 1024 + 1],
  ] as const)('rejects an oversized %s before JSON parsing', async (target, bytes) => {
    const directory = mkdtempSync(join(tmpdir(), 'sealed-calibration-input-'));
    try {
      const setPath = join(directory, 'set.json');
      const collationPath = join(directory, 'collation.json');
      writeFileSync(setPath, target === 'set' ? ' '.repeat(bytes) : JSON.stringify({ cards: SET }));
      writeFileSync(
        collationPath,
        target === 'collation'
          ? ' '.repeat(bytes)
          : JSON.stringify({ version: 'native-draft-collation-v1', recipe: SLICE_BOOSTER }),
      );
      await expect(
        runSealedCalibrationCli([
          '--set',
          setPath,
          '--collation',
          collationPath,
          '--seed',
          'bounded-input-test',
          '--out',
          join(directory, 'artifact.json'),
        ]),
      ).rejects.toThrow(/byte limit/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(['set', 'collation'] as const)('refuses a %s FIFO without blocking on open', (target) => {
    const directory = mkdtempSync(join(tmpdir(), 'sealed-calibration-fifo-'));
    try {
      const setPath = join(directory, 'set.json');
      const collationPath = join(directory, 'collation.json');
      const fifoPath = target === 'set' ? setPath : collationPath;
      execFileSync('mkfifo', [fifoPath]);
      if (target !== 'set') writeFileSync(setPath, JSON.stringify({ cards: SET }));
      if (target !== 'collation') {
        writeFileSync(
          collationPath,
          JSON.stringify({ version: 'native-draft-collation-v1', recipe: SLICE_BOOSTER }),
        );
      }
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          join(ROOT, 'packages/metrics/tools/sealed-calibration.ts'),
          '--set',
          setPath,
          '--collation',
          collationPath,
          '--seed',
          'fifo-test',
          '--out',
          join(directory, 'artifact.json'),
        ],
        { cwd: ROOT, encoding: 'utf8', timeout: 2_000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/regular file/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

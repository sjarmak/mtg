/** The printed-cube browser model composes the generic draft, Limited, and engine seams. */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import {
  buildLegacyCubeDeck,
  buildLegacyCubePoolDeck,
  decodeLegacyCubePicks,
  encodeLegacyCubePicks,
  legacyCubeForgeOpeningChoiceSeat,
  legacyCubeSessionSpec,
  legacyCubeDraftPool,
  legacyCubeBotPickValue,
  readLegacyCubeForgeReadyPool,
  readLegacyCubeCatalog,
  runLegacyCubeDraft,
  LEGACY_CUBE_BOT_POLICY,
} from '../../src/routes/legacy-cube/model';
import { stageLegacyCubeForgeReadyPool } from '../../tools/stage-legacy-cube';
import { sha256Text } from '../../src/routes/analysis/calibration-read';
import { writeCompleteLegacyCubeLedgerFixture } from './complete-ledger-fixture';

const CATALOG_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'data',
  'data',
  'legacy-cube-2021-card-catalog-v1.json',
);
const LEDGER_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'data',
  'data',
  'legacy-cube-2021-forge-decisions-v1.json',
);

async function forgeReadyBody(): Promise<unknown> {
  const directory = mkdtempSync(join(tmpdir(), 'mtg-legacy-model-ready-'));
  const target = join(directory, 'ready.json');
  const ledger = writeCompleteLegacyCubeLedgerFixture(LEDGER_FILE, join(directory, 'ledger.json'));
  await stageLegacyCubeForgeReadyPool(CATALOG_FILE, ledger, target);
  return JSON.parse(readFileSync(target, 'utf8')) as unknown;
}

async function catalog(): Promise<PrintedCardCatalog> {
  return readLegacyCubeCatalog(JSON.parse(readFileSync(CATALOG_FILE, 'utf8')) as unknown);
}

describe('Legacy Cube browser model', () => {
  it('accepts the exact checksum-pinned 600-position artifact and rejects drift', async () => {
    const exact = await catalog();
    expect(exact).toMatchObject({ format: 'legacy-cube-2021-08', forgeVersion: '2.0.14' });
    expect(exact.cards).toHaveLength(600);

    const stale = structuredClone(exact);
    stale.cards[0]!.correctedName = 'Drifted card';
    await expect(readLegacyCubeCatalog(stale)).rejects.toThrow(/checksum drift/i);
    await expect(readLegacyCubeCatalog({ cards: [] })).rejects.toThrow();
  });

  it('deals 24 singleton packs, replays 45 human picks, and leaves 240 cards undealt', async () => {
    const exact = await catalog();
    const picks: string[] = [];
    let draft = runLegacyCubeDraft(exact, 'legacy-ui/model', picks);
    const secondSeat = runLegacyCubeDraft(exact, 'legacy-ui/model', [], 'seat-2');
    expect(secondSeat.owed[0]?.seatId).toBe('seat-2');

    expect(draft.packs).toHaveLength(24);
    expect(draft.packs.flatMap((pack) => pack.cards)).toHaveLength(360);
    expect(new Set(draft.packs.flatMap((pack) => pack.cards.map((card) => card.physicalId))).size).toBe(360);
    expect(draft.undealt).toHaveLength(240);

    while (draft.result === null) {
      const choice = draft.owed[0];
      if (choice === undefined) throw new Error('unfinished draft owes no human pick');
      const card = choice.cards[0];
      if (card === undefined) throw new Error('human pack has no card');
      picks.push(card.physicalId);
      draft = runLegacyCubeDraft(exact, 'legacy-ui/model', picks);
    }

    expect(picks).toHaveLength(45);
    expect(draft.result.seats.find((seat) => seat.seatId === 'seat-1')?.picks).toHaveLength(45);
    expect(JSON.stringify(runLegacyCubeDraft(exact, 'legacy-ui/model', picks))).toBe(JSON.stringify(draft));

    const encoded = encodeLegacyCubePicks(exact, picks);
    expect(encoded.length).toBeLessThan(180);
    expect(decodeLegacyCubePicks(exact, encoded)).toEqual({ ok: true, picks });
    expect(decodeLegacyCubePicks(exact, 'zzzz')).toMatchObject({ ok: false });
  });

  it('deals all admitted positions as the official eight-seat singleton draft', async () => {
    const exact = await catalog();
    const artifact = await readLegacyCubeForgeReadyPool(await forgeReadyBody(), exact);
    const pool = legacyCubeDraftPool(exact, 'forge-ready', artifact);
    const draft = runLegacyCubeDraft(pool, 'legacy-ui/accepted', []);

    expect(pool.cards).toHaveLength(600);
    expect(pool.draft).toEqual({ seats: 8, rounds: 3, packSize: 15 });
    expect(draft.packs).toHaveLength(24);
    expect(draft.packs.flatMap((pack) => pack.cards)).toHaveLength(360);
    expect(draft.undealt).toHaveLength(240);
    expect(draft.packs.flatMap((pack) => pack.cards).every((card) => pool.cards.includes(card.payload))).toBe(
      true,
    );
  });

  it('rejects tampered, cross-catalog, and incomplete admission projections', async () => {
    const exact = await catalog();
    const body = (await forgeReadyBody()) as Record<string, unknown>;
    await expect(
      readLegacyCubeForgeReadyPool({ ...body, contentSha256: '0'.repeat(64) }, exact),
    ).rejects.toThrow(/checksum drift/i);
    const anotherCatalog = { ...exact, contentSha256: '0'.repeat(64) };
    await expect(readLegacyCubeForgeReadyPool(body, anotherCatalog)).rejects.toThrow(/catalog/i);

    const complete = body as { positions: number[]; cards: number; contentSha256: string };
    const { contentSha256: _checksum, ...content } = complete;
    const incompleteContent = {
      ...content,
      positions: content.positions.slice(0, -1),
      cards: content.cards - 1,
    };
    await expect(
      readLegacyCubeForgeReadyPool(
        { ...incompleteContent, contentSha256: await sha256Text(JSON.stringify(incompleteContent)) },
        exact,
      ),
    ).rejects.toThrow(/complete.*600.*599|599.*complete.*600/i);
  });

  it('builds legal human and opponent decks and emits only backend-neutral references', async () => {
    const exact = await catalog();
    const picks: string[] = [];
    let draft = runLegacyCubeDraft(exact, 'legacy-cube-live-smoke/v1', picks);
    while (draft.result === null) {
      const card = draft.owed[0]?.cards[0];
      if (card === undefined) throw new Error('unfinished draft owes no card');
      picks.push(card.physicalId);
      draft = runLegacyCubeDraft(exact, 'legacy-cube-live-smoke/v1', picks);
    }

    const human = buildLegacyCubeDeck(draft.result, 'seat-1');
    const opponent = buildLegacyCubeDeck(draft.result, 'seat-2');
    const humanFromPool = buildLegacyCubePoolDeck(
      draft.result.seats.find((seat) => seat.seatId === 'seat-1')!.picks.map((pick) => pick.card),
    );
    expect(LEGACY_CUBE_BOT_POLICY).toMatch(/structural/);
    expect(human.selection.policy).toBe('deck-conditioned/v1');
    expect(humanFromPool).toEqual(human);
    expect(opponent.selection.policy).toBe('deck-conditioned/v1');
    expect(human.report).toMatchObject({ legal: true, cards: 40, draftedCards: 23, basicLands: 17 });
    expect(opponent.report.legal).toBe(true);
    const opening = runLegacyCubeDraft(exact, 'legacy-cube-live-smoke/value', []);
    const offered = opening.owed[0]?.cards;
    if (offered === undefined) throw new Error('opening draft owes no pack');
    expect(
      offered.toSorted(
        (left, right) =>
          legacyCubeBotPickValue(exact, right.payload, []) - legacyCubeBotPickValue(exact, left.payload, []),
      )[0]?.physicalId,
    ).toBe(
      offered.reduce((best, card) =>
        legacyCubeBotPickValue(exact, card.payload, []) > legacyCubeBotPickValue(exact, best.payload, [])
          ? card
          : best,
      ).physicalId,
    );

    const table = legacyCubeSessionSpec(exact, human.deck, opponent.deck, 'legacy-ui/decks/game');
    expect(table).toEqual({
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        { name: 'You', controller: 'local', deck: expect.objectContaining({ name: 'Your draft deck' }) },
        {
          name: 'Forge bot',
          controller: 'engine',
          deck: expect.objectContaining({ name: 'Bot draft deck' }),
        },
      ],
      seed: 'legacy-ui/decks/game',
      maximumTurns: null,
    });
    expect(table.seats[0].deck.cards.reduce((sum, slot) => sum + slot.count, 0)).toBe(40);
    expect(table.seats[1].deck.cards.reduce((sum, slot) => sum + slot.count, 0)).toBe(40);
    expect(table.seats.flatMap((seat) => seat.deck.cards).every((slot) => !slot.name.includes(' // '))).toBe(
      true,
    );

    expect(await legacyCubeForgeOpeningChoiceSeat('legacy-cube-live-smoke/v1/game', '2.0.14', [40, 40])).toBe(
      1,
    );
    expect(await legacyCubeForgeOpeningChoiceSeat('probe/a', '2.0.14', [40, 40])).toBe(0);
    expect(await legacyCubeForgeOpeningChoiceSeat('probe/b', '2.0.14', [40, 40])).toBe(0);
    expect(await legacyCubeForgeOpeningChoiceSeat('probe/c', '2.0.14', [40, 40])).toBe(0);
    const humanSecond = legacyCubeSessionSpec(
      exact,
      human.deck,
      opponent.deck,
      'legacy-cube-live-smoke/v1/game',
      1,
    );
    expect(humanSecond.seats.map((seat) => [seat.name, seat.controller])).toEqual([
      ['Forge bot', 'engine'],
      ['You', 'local'],
    ]);
    expect(humanSecond.seed).toBe('legacy-cube-live-smoke/v1/game');
    await expect(
      legacyCubeForgeOpeningChoiceSeat('legacy-cube-live-smoke/v1/game', '2.0.15', [40, 40]),
    ).rejects.toThrow(/Forge 2\.0\.14/i);
    await expect(legacyCubeForgeOpeningChoiceSeat('unequal', '2.0.14', [40, 39])).rejects.toThrow(
      /equal 40-card main-deck sizes/i,
    );
  });
});

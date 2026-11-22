import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { parsePrintedConstructedFormat } from '@mtg/printed-card';
import { runPairing } from '../tools/commander-head-to-head/run';
import { tallyPairing } from '../tools/commander-head-to-head/tally';
import type { CommanderHeadToHeadGameRecord } from '../tools/commander-head-to-head/schema';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const ROOT = resolve(import.meta.dirname, '../../..');
const FORMAT_PATH = resolve(
  ROOT,
  'packages/data/data/commander-precons/commander-precons-constructed-format-v1.json',
);

function withoutDurations(
  records: readonly CommanderHeadToHeadGameRecord[],
): readonly Omit<CommanderHeadToHeadGameRecord, 'durationMs'>[] {
  return records.map((record) => ({
    game: record.game,
    listedFirst: record.listedFirst,
    playedFirst: record.playedFirst,
    outcome: record.outcome,
    winner: record.winner,
    turn: record.turn,
  }));
}

forgeIt(
  'plays real Commander games through the installed Forge, both decks from our own format file, and replays identically from the same seed',
  async () => {
    const format = parsePrintedConstructedFormat(JSON.parse(readFileSync(FORMAT_PATH, 'utf8')));
    const deckA = format.decks.find((deck) => deck.id === 'chaos-incarnate');
    const deckB = format.decks.find((deck) => deck.id === 'grave-danger');
    if (deckA === undefined || deckB === undefined) throw new Error('fixture deck missing');

    const options = { format, deckA, deckB, gamesPerPairing: 2, clockSeconds: 120, baseSeed: 20261011 };
    const first = await runPairing(options);
    const second = await runPairing(options);

    expect(first.forgeVersion.length).toBeGreaterThan(0);
    expect(first.commands).toHaveLength(2);
    expect(first.decks[0].id).toBe('chaos-incarnate');
    expect(first.decks[1].id).toBe('grave-danger');
    expect(first.decks[0].deckFileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.decks[1].deckFileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.records).toHaveLength(2);
    for (const record of first.records) {
      expect(record.durationMs).toBeGreaterThan(0);
      expect(['a', 'b']).toContain(record.playedFirst);
      expect(['a', 'b', null]).toContain(record.winner);
      expect(['win', 'rules-draw', 'clock-draw']).toContain(record.outcome);
    }

    expect(second.seeds).toEqual(first.seeds);
    expect(second.commands).toEqual(first.commands);
    expect(withoutDurations(second.records)).toEqual(withoutDurations(first.records));

    const pairing = tallyPairing(deckA.id, deckB.id, first.seeds, first.commands, first.records);
    expect(pairing.games).toBe(2);
    expect(pairing.aWins + pairing.bWins + pairing.rulesDraws + pairing.clockDraws).toBe(2);
  },
  20 * 60 * 1000,
);

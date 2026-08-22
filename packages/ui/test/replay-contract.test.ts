/**
 * The contract between this package's column mirror and `@mtg/sim`'s log schema.
 *
 * `src/replay/columns.ts` restates the column grammar so the browser bundle
 * never imports `@mtg/sim` (whose barrel reaches `node:worker_threads` and
 * `node:fs`). That duplication is only safe if something checks it, so this
 * test — which runs in Node and imports `@mtg/sim` for real — asserts the two
 * agree on every field name, every column spelling, the schema version, and the
 * shape of the parsed types. It also round-trips a parsed game back through the
 * sim's own `replayRow` flattening and compares it to the original line, which
 * proves the reader is a true inverse rather than a plausible one.
 */
import { describe, expect, it } from 'vitest';
import type { MutuallyAssignable } from '@mtg/dsl';
import {
  REPLAY_GAME_COLUMNS,
  REPLAY_TOTAL_FIELDS,
  SIDES as SIM_SIDES,
  SIM_LOG_SCHEMA_VERSION,
  TURN_OWNER_FIELDS as SIM_TURN_OWNER_FIELDS,
  TURN_SIDE_EOT_FIELDS as SIM_TURN_SIDE_EOT_FIELDS,
  TURN_SIDE_FIELDS as SIM_TURN_SIDE_FIELDS,
  eotColumn as simEotColumn,
  ownerColumn as simOwnerColumn,
  parseReplayJsonl,
  replayRow,
  sideColumn as simSideColumn,
  totalColumn as simTotalColumn,
} from '@mtg/sim';
import type { GameMetadata, SideTotals, SideTurnStats, SimExtras, TurnRecord } from '@mtg/sim';
import {
  GAME_COLUMNS,
  REPLAY_SCHEMA_VERSION,
  SIDES,
  TOTAL_FIELDS,
  TURN_OWNER_FIELDS,
  TURN_SIDE_EOT_FIELDS,
  TURN_SIDE_FIELDS,
  eotColumn,
  ownerColumn,
  sideColumn,
  totalColumn,
} from '../src/replay/columns';
import { readReplayLog } from '../src/replay/timeline';
import type {
  ReplayExtras,
  ReplayMetadata,
  SideTotals as UiSideTotals,
  SideTurnStats as UiSideTurnStats,
  TimelineTurn,
} from '../src/replay/types';
import { fixtureText } from './support/replay-fixture';

describe('column grammar mirrors @mtg/sim', () => {
  it('pins the same schema version', () => {
    expect(REPLAY_SCHEMA_VERSION).toBe(SIM_LOG_SCHEMA_VERSION);
  });

  it('lists the same fields in the same order', () => {
    expect([...SIDES]).toEqual([...SIM_SIDES]);
    expect([...GAME_COLUMNS]).toEqual([...REPLAY_GAME_COLUMNS]);
    expect([...TOTAL_FIELDS]).toEqual([...REPLAY_TOTAL_FIELDS]);
    expect([...TURN_OWNER_FIELDS]).toEqual([...SIM_TURN_OWNER_FIELDS]);
    expect([...TURN_SIDE_FIELDS]).toEqual([...SIM_TURN_SIDE_FIELDS]);
    expect([...TURN_SIDE_EOT_FIELDS]).toEqual([...SIM_TURN_SIDE_EOT_FIELDS]);
  });

  it('spells every column identically', () => {
    for (const owner of SIDES) {
      for (const turn of [1, 7, 30]) {
        for (const field of TURN_OWNER_FIELDS) {
          expect(ownerColumn(owner, turn, field)).toBe(simOwnerColumn(owner, turn, field));
        }
        for (const side of SIDES) {
          for (const field of TURN_SIDE_FIELDS) {
            expect(sideColumn(owner, turn, side, field)).toBe(simSideColumn(owner, turn, side, field));
          }
          for (const field of TURN_SIDE_EOT_FIELDS) {
            expect(eotColumn(owner, turn, side, field)).toBe(simEotColumn(owner, turn, side, field));
          }
        }
      }
    }
    for (const side of SIDES) {
      for (const field of TOTAL_FIELDS) {
        expect(totalColumn(side, field)).toBe(simTotalColumn(side, field));
      }
    }
  });

  it('declares structurally identical types', () => {
    const turns: MutuallyAssignable<TimelineTurn, TurnRecord> = true;
    const sideStats: MutuallyAssignable<UiSideTurnStats, SideTurnStats> = true;
    const totals: MutuallyAssignable<UiSideTotals, SideTotals> = true;
    const metadata: MutuallyAssignable<ReplayMetadata, GameMetadata> = true;
    const extras: MutuallyAssignable<ReplayExtras, SimExtras> = true;
    expect([turns, sideStats, totals, metadata, extras]).toEqual([true, true, true, true, true]);
  });
});

describe('the reader inverts the sim flattening', () => {
  it('re-flattens each parsed game into the original row', () => {
    const text = fixtureText();
    const parsed = parseReplayJsonl(text);
    const log = readReplayLog(text);
    expect(log.games).toHaveLength(parsed.rows.length);
    for (const [index, game] of log.games.entries()) {
      const rebuilt = replayRow({
        metadata: game.metadata,
        extras: game.extras,
        totals: { user: game.totals.user, oppo: game.totals.oppo },
        turns: [...game.turns],
      });
      expect(rebuilt).toEqual(parsed.rows[index]);
    }
  });
});

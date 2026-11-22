import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { beginTrace, moveObject, scenario, type GameState } from '@mtg/kernel';
import { SnapshotSchema } from '../../src/routes/replay/log-schema';
import type { LogEvent } from '../../src/routes/replay/log-schema';
import { boardNotes } from '../../src/routes/replay/frame';
import { describeEvent, namesFor } from '../../src/routes/replay/narrate';
import type { ReplayGameLog } from '../../src/routes/replay/read-log';
import { snapshotOf } from '../../tools/record-replay';

const CLONE = parseCard({
  kind: 'creature',
  id: 'replay-clone',
  name: 'Clone',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 49 },
  manaCost: { generic: 3, U: 1 },
  colors: ['U'],
  subtypes: ['Shapeshifter'],
  power: 0,
  toughness: 0,
  entryReplacement: { kind: 'entersAsCopyOfCreature' },
});

const SAGE = parseCard({
  kind: 'creature',
  id: 'replay-sage',
  name: 'Replay Sage',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 2, U: 1 },
  colors: ['U'],
  subtypes: ['Wizard'],
  power: 3,
  toughness: 4,
});

describe('copied permanent replay snapshot', () => {
  it('retains the copied battlefield face through the strict log schema', () => {
    const opened = scenario({ battlefield: [{ card: SAGE, controller: 0 }] }).state;
    const oid = opened.battlefield[0];
    if (oid === undefined) throw new Error('scenario built no Clone');
    const state: GameState = {
      ...opened,
      objects: {
        ...opened.objects,
        [oid]: { ...opened.objects[oid]!, card: CLONE, copiableCard: SAGE },
      },
    };

    const snapshot = SnapshotSchema.parse(snapshotOf(state));
    expect(snapshot.battlefield[0]).toHaveProperty('copiedCard', SAGE);
  });

  it('uses the copied face in rendered narration and printed-stat notes', () => {
    const opened = scenario({ battlefield: [{ card: SAGE, controller: 0 }] }).state;
    const oid = opened.battlefield[0];
    if (oid === undefined) throw new Error('scenario built no Clone');
    const state: GameState = {
      ...opened,
      objects: {
        ...opened.objects,
        [oid]: { ...opened.objects[oid]!, card: CLONE, copiableCard: SAGE },
      },
    };
    const snapshot = SnapshotSchema.parse(snapshotOf(state));
    const left = moveObject(beginTrace(state), oid, 'exile').state;
    const leftSnapshot = SnapshotSchema.parse(snapshotOf(left));
    const event: LogEvent = {
      type: 'damageDealt',
      sourceOid: oid,
      target: { kind: 'player', player: 1 },
      amount: 3,
      deathtouch: false,
      combat: false,
    };
    const game: ReplayGameLog = {
      index: 0,
      seed: 'clone-presentation/1',
      startingPlayer: 0,
      maximumTurns: 1,
      seats: [
        { bot: 'none', deck: 'You' },
        { bot: 'none', deck: 'Bot' },
      ],
      result: { winner: 0, loser: 1, reason: 'lifeZero', endedOnTurn: 1 },
      objects: new Map([[oid, { oid, card: CLONE, owner: 0, token: false }]]),
      steps: [
        {
          seq: 0,
          turn: 1,
          step: 'precombatMain',
          active: 0,
          decision: null,
          action: null,
          events: [event],
          state: snapshot,
        },
        {
          seq: 1,
          turn: 1,
          step: 'precombatMain',
          active: 0,
          decision: null,
          action: null,
          events: [],
          state: leftSnapshot,
        },
      ],
    };
    const names = namesFor(game, 0);

    expect(describeEvent(event, names)).toContain(SAGE.name);
    expect(describeEvent(event, names)).not.toContain(CLONE.name);
    expect(boardNotes(game, snapshot, names)).toEqual([]);
    expect(namesFor(game, 1).card(oid)).toBe(CLONE.name);
  });
});

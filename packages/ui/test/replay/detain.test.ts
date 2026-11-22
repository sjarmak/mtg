// @vitest-environment jsdom
/** Detention stays visible when a live position becomes a recorded replay frame. */
import { createElement as h } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { detainPermanent, scenario, type GameState, type ObjectId } from '@mtg/kernel';
import { Battlefield } from '../../src/board/Battlefield';
import { boardPosition } from '../../src/routes/play/position';
import { boardFrame } from '../../src/routes/replay/frame';
import { EVENT_LOG_SCHEMA_VERSION, GameRecordSchema } from '../../src/routes/replay/log-schema';
import { namesFor } from '../../src/routes/replay/narrate';
import { readEventLog } from '../../src/routes/replay/read-log';
import { snapshotOf, stepRecord, writeEventLog } from '../../tools/record-replay';

const DETAINER = parseCard({
  kind: 'creature',
  id: 'ui-detainer',
  name: 'Azorius Justiciar',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 6 },
  manaCost: { generic: 2, W: 2 },
  colors: ['W'],
  power: 2,
  toughness: 2,
});

const SUBJECT = parseCard({
  kind: 'artifact',
  id: 'ui-detained-subject',
  name: 'Street Sweeper',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 234 },
  manaCost: { generic: 6 },
});

function oidOf(state: GameState, cardId: string): ObjectId {
  const oid = state.battlefield.find((candidate) => state.objects[candidate]?.card.id === cardId);
  if (oid === undefined) throw new Error(`the battlefield has no ${cardId}`);
  return oid;
}

function detainedState(): {
  readonly state: GameState;
  readonly source: ObjectId;
  readonly subject: ObjectId;
} {
  const start = scenario({
    battlefield: [
      { card: DETAINER, controller: 0, summoningSick: false },
      { card: SUBJECT, controller: 1, summoningSick: false },
    ],
  }).state;
  const source = oidOf(start, DETAINER.id);
  const subject = oidOf(start, SUBJECT.id);
  return { state: detainPermanent(start, source, subject, 0), source, subject };
}

function recordedDetention() {
  const detained = detainedState();
  const snapshot = snapshotOf(detained.state);
  const step = stepRecord(0, 0, detained.state, [], snapshot, null, null);
  const game = GameRecordSchema.parse({
    record: 'game',
    game: 0,
    seed: 'ui/replay/detain',
    startingPlayer: 0,
    maximumTurns: 1,
    seats: [
      { bot: 'detainer', deck: 'Azorius' },
      { bot: 'subject', deck: 'Artifacts' },
    ],
    cards: { [DETAINER.id]: DETAINER, [SUBJECT.id]: SUBJECT },
    objects: {
      [detained.source]: { card: DETAINER.id, owner: 0, token: false },
      [detained.subject]: { card: SUBJECT.id, owner: 1, token: false },
    },
    steps: 1,
    result: { winner: null, loser: null, reason: 'turnLimit', endedOnTurn: 1 },
  });
  const text = writeEventLog('packages/ui/test/replay/detain.test.ts', [{ game, steps: [step] }]);
  const replay = readEventLog(text);
  const replayGame = replay.games[0];
  const replayStep = replayGame?.steps[0];
  if (replayGame === undefined || replayStep === undefined) throw new Error('the log lost its only step');
  return { detained, replayGame, replayStep, text };
}

afterEach(cleanup);

describe('detention on the live table', () => {
  it('projects and clearly labels the active restriction on its permanent', () => {
    const { state, subject } = detainedState();
    const position = boardPosition(state, 0, ['You', 'Bot']);
    const permanent = position.opponent.battlefield.permanents.find((candidate) => candidate.key === subject);
    expect(permanent).toHaveProperty('detained', true);

    render(h(Battlefield, position.opponent.battlefield));
    expect(screen.getByText('DET')).toBeTruthy();
    expect(
      screen.getByRole('img', {
        name: "Detained: this permanent can't attack, block, or activate abilities until the detaining player's next turn.",
      }),
    ).toBeTruthy();
  });
});

describe('detention in the event log and replay viewer', () => {
  it('round-trips the active restriction into the rendered replay frame', () => {
    const { detained, replayGame, replayStep, text } = recordedDetention();
    expect(text.startsWith(`{"record":"header","schema":"${EVENT_LOG_SCHEMA_VERSION}"`)).toBe(true);
    expect(replayStep.state.battlefield.find((one) => one.oid === detained.subject)).toHaveProperty(
      'detained',
      true,
    );

    const frame = boardFrame(
      replayGame,
      replayStep.state,
      replayStep.active,
      null,
      namesFor(replayGame, replayStep.seq),
    );
    const side = [frame.you, frame.opponent].find((candidate) =>
      candidate.battlefield.permanents.some((permanent) => permanent.key === detained.subject),
    );
    if (side === undefined) throw new Error('the replay frame lost the detained permanent');
    render(h(Battlefield, side.battlefield));
    expect(screen.getByText('DET')).toBeTruthy();
    expect(screen.getByRole('img', { name: /^Detained:/ })).toBeTruthy();
  });

  it.each([
    'mtg-ui/event-log/3',
    'mtg-ui/event-log/4',
    'mtg-ui/event-log/5',
    'mtg-ui/event-log/6',
    'mtg-ui/event-log/7',
  ] as const)('rejects /8 detention evidence under the released %s grammar', (schema) => {
    const { text } = recordedDetention();
    const older = text.replace(EVENT_LOG_SCHEMA_VERSION, schema);

    expect(() => readEventLog(older)).toThrow(/cannot contain \/8 detention evidence/);
  });

  it('keeps a /8 snapshot with no detention field readable and unrestricted', () => {
    const { text } = recordedDetention();
    const unrestricted = text.replace(',"detained":true', '');
    expect(unrestricted).not.toContain('"detained"');

    const replay = readEventLog(unrestricted);
    expect(
      replay.games[0]?.steps[0]?.state.battlefield.every((permanent) => permanent.detained !== true),
    ).toBe(true);
  });
});

/**
 * The lab's log of choices the computer made for a player, and the review queue
 * read back from it (#66).
 *
 * What a wrong implementation gets wrong here: a snapshot carries the whole game
 * log, so a choice already logged is in every later snapshot and must not be
 * logged again; and the queue is in #66's working order, not by count, so the
 * bounce lands come first even when another family has more rows.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMANDER_RULES } from '@mtg/engine';
import type { EngineEvent, ObservedBackend, ObservedSession, SessionSpec, SubmitResult } from '@mtg/engine';
import {
  readUnreviewedChoices,
  recordUnreviewedChoices,
  reviewQueue,
  UNREVIEWED_CHOICE_EVENT,
} from '../tools/unreviewed-choices';
import type { UnreviewedChoiceRow } from '../tools/unreviewed-choices';

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'commander-precons' },
  rules: COMMANDER_RULES,
  seats: [
    {
      name: 'You',
      controller: 'local',
      deck: {
        name: 'You',
        cards: [{ name: 'Swamp', count: 99 }],
        commanders: [{ name: 'Edgar Markov', count: 1 }],
      },
    },
    {
      name: 'Bot',
      controller: 'engine',
      deck: {
        name: 'Bot',
        cards: [{ name: 'Island', count: 99 }],
        commanders: [{ name: "Atraxa, Praetors' Voice", count: 1 }],
      },
    },
  ],
  seed: 'unreviewed-choices-test/v1',
  maximumTurns: 100,
};

function choice(seq: number, source: string, params: string, seatsOwnEffect: boolean | null): EngineEvent {
  return {
    seq,
    type: UNREVIEWED_CHOICE_EVENT,
    text: `The computer chose for You: ${source}`,
    detail: {
      kind: 'unreviewed-choice',
      method: 'chooseSingleEntityForEffect',
      source,
      api: 'ChangeZone',
      params,
      trigger: true,
      seatsOwnEffect,
      seat: 0,
      turn: 3,
      refusal: 'outside every reviewed route',
      answer: 'Swamp',
    },
    reveals: [],
  };
}

const ordinary = (seq: number): EngineEvent => ({
  seq,
  type: 'Land',
  text: 'You played Swamp',
  detail: {},
  reveals: [],
});

/** A backend whose session shows `logs[n]` after the nth submitted move. */
function scripted(logs: readonly (readonly EngineEvent[])[]): ObservedBackend {
  const at = (index: number): ObservedSession =>
    ({
      events: logs[index],
      submit: async (): Promise<SubmitResult<ObservedSession>> => ({ ok: true, session: at(index + 1) }),
    }) as unknown as ObservedSession;
  return { open: async () => ({ ok: true, session: at(0) }) } as unknown as ObservedBackend;
}

describe('unreviewed choice log', () => {
  it('logs each choice once although every later snapshot repeats it', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'unreviewed-')), 'choices.jsonl');
    const carnarium = choice(1, 'Rakdos Carnarium', 'Origin=Battlefield, Destination=Hand', true);
    const backend = recordUnreviewedChoices(
      scripted([
        [ordinary(0), carnarium],
        [ordinary(0), carnarium, ordinary(2), choice(3, 'Syphon Mind', 'Mode=TgtChoose', false)],
      ]),
      log,
    );
    const opened = await backend.open(TABLE);
    if (!opened.ok) throw new Error('open failed');
    await opened.session.submit('pass');

    const rows = readUnreviewedChoices(log);
    expect(rows.map((row) => [row.seq, row.source])).toEqual([
      [1, 'Rakdos Carnarium'],
      [3, 'Syphon Mind'],
    ]);
    expect(rows[0]).toMatchObject({
      format: 'commander-precons',
      variant: 'commander',
      seed: 'unreviewed-choices-test/v1',
      decks: ['Edgar Markov', "Atraxa, Praetors' Voice"],
      turn: 3,
    });
  });
});

describe('review queue', () => {
  const row = (
    game: string,
    source: string,
    params: string,
    seatsOwnEffect: boolean | null,
    trigger = true,
  ) =>
    ({
      at: '2026-11-23T00:00:00.000Z',
      game,
      format: 'commander-precons',
      variant: 'commander',
      seed: game,
      decks: ['A', 'B'],
      seq: 1,
      text: '',
      method: 'chooseSingleEntityForEffect',
      source,
      api: 'ChangeZone',
      params,
      trigger,
      seatsOwnEffect,
      seat: 0,
      turn: 1,
      refusal: '',
      answer: 'x',
    }) satisfies UnreviewedChoiceRow;
  const bounce = '{Origin=Battlefield, Destination=Hand, ChangeType=Land.YouCtrl, Mandatory=True}';

  it("works #66's families in order, and each family's cards most-logged first", () => {
    const queue = reviewQueue([
      row('g1', 'Syphon Mind', 'Defined=Player', false),
      row('g1', 'Geier Reach Sanitarium', 'Defined=Player', false),
      // The seat discarding for its own activation is still a discard from a zone it owns.
      { ...row('g2', 'Geier Reach Sanitarium', 'Defined=Player', true), method: 'chooseCardsToDiscardFrom' },
      // An opponent's bounce land still reads as a bounce land, not as another seat's effect.
      row('g2', 'Azorius Chancery', bounce, false),
      // Returning a land to hand from a spell is not the bounce-land trigger.
      row('g3', 'Tempt with Immortality', bounce, true, false),
      row('g3', 'Skullwinder', 'Defined=You', true),
      row('g3', 'Skullwinder', 'Defined=You', true),
    ]);
    expect(
      queue.families.map((family) => [family.id, family.entries.map((entry) => [entry.source, entry.count])]),
    ).toEqual([
      ['bounce-land', [['Azorius Chancery', 1]]],
      [
        'own-zone',
        [
          ['Geier Reach Sanitarium', 2],
          ['Syphon Mind', 1],
        ],
      ],
      [
        'one-card',
        [
          ['Skullwinder', 2],
          ['Tempt with Immortality', 1],
        ],
      ],
    ]);
    expect(queue.families[1]!.entries[0]!.games).toBe(2);
    expect([queue.total, queue.games]).toEqual([7, 3]);
  });
});

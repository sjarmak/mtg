/**
 * The contract's answer to `mtg-cee`, checked on the board that named it and on
 * the boards it cannot fix.
 *
 * Every subject here is contract values built by hand rather than a session from
 * a backend, which is the honest shape for this claim: `labelDecision` is a pure
 * function of a `PendingDecision` and a `TableView`, so a test that reached for
 * an engine to produce those two would be testing the engine. The last block
 * runs it over a real session from `scriptBackend` anyway, to hold the other
 * half — that a decision with nothing to repair comes back untouched.
 *
 * The three cases worth naming: the bug's own board separates, a board whose
 * twins differ in a projected property separates, and a board whose twins differ
 * only in a *relation* does not and says so. That third one is the limit
 * `labels.ts` argues is structural, and a test that did not park it would let it
 * quietly become a limit nobody remembers choosing.
 */
import { describe, expect, it } from 'vitest';
import type { MoveOption, ObjectView, PendingDecision, SeatId, SeatView, TableView } from '@mtg/engine';
import { PROJECTION_VERSION, labelDecision, scriptBackend } from '@mtg/engine';

function permanent(
  oid: string,
  name: string,
  controller: SeatId,
  extra: Partial<ObjectView> = {},
): ObjectView {
  return {
    oid,
    name,
    typeLine: 'Creature',
    power: 2,
    toughness: 2,
    tapped: false,
    damage: 0,
    controller,
    counters: {},
    ...extra,
  };
}

function seat(id: SeatId, name: string, battlefield: readonly ObjectView[]): SeatView {
  return {
    id,
    name,
    life: 20,
    hand: [],
    handSize: 0,
    librarySize: 40,
    graveyard: [],
    battlefield,
  };
}

function board(north: readonly ObjectView[], south: readonly ObjectView[]): TableView {
  return {
    version: PROJECTION_VERSION,
    turn: { number: 3, active: 0, phase: 'main', step: 'main' },
    priority: 0,
    stack: [],
    seats: [seat(0, 'North', north), seat(1, 'South', south)],
  };
}

function decision(options: readonly MoveOption[]): PendingDecision {
  return { seat: 0, kind: 'priority', prompt: 'You have priority', options, complete: true };
}

/** A cast aimed at one permanent, as a backend that points at its targets writes it. */
function cast(id: string, oid: string, name: string): MoveOption {
  return { id, text: `Cast Lightning Lash → ${name}`, targets: [{ oid, name }] };
}

describe('the board that named mtg-cee', () => {
  const RAIDER = 'Emberflow Raider';
  const view = board([permanent('o1', RAIDER, 0)], [permanent('o2', RAIDER, 1)]);
  const asked = decision([
    { id: '0', text: 'Pass', targets: [] },
    cast('4', 'o1', RAIDER),
    cast('7', 'o2', RAIDER),
  ]);

  it('separates two casts that read the same by whose creature they point at', () => {
    const labels = labelDecision(asked, view);
    expect(labels.map((label) => label.text)).toEqual([
      'Pass',
      `Cast Lightning Lash → ${RAIDER} (North)`,
      `Cast Lightning Lash → ${RAIDER} (South)`,
    ]);
  });

  it('marks nothing as shared once it has separated them', () => {
    expect(labelDecision(asked, view).every((label) => label.sharedWith.length === 0)).toBe(true);
  });

  it('leaves an option nothing collided with exactly as the backend wrote it', () => {
    expect(labelDecision(asked, view)[0]).toEqual({ id: '0', text: 'Pass', sharedWith: [] });
  });

  it('keeps every id, in the order the backend enumerated them', () => {
    expect(labelDecision(asked, view).map((label) => label.id)).toEqual(['0', '4', '7']);
  });
});

describe('twins under one controller', () => {
  const RAIDER = 'Emberflow Raider';

  it('separates them by a projected property, and says only what differs', () => {
    const view = board([permanent('o1', RAIDER, 0), permanent('o2', RAIDER, 0, { damage: 1 })], []);
    const labels = labelDecision(decision([cast('1', 'o1', RAIDER), cast('2', 'o2', RAIDER)]), view);
    expect(labels.map((label) => label.text)).toEqual([
      `Cast Lightning Lash → ${RAIDER}`,
      `Cast Lightning Lash → ${RAIDER} (1 damage marked)`,
    ]);
  });

  it('says every clause the pair disagrees about and no clause it agrees on', () => {
    const view = board(
      [permanent('o1', RAIDER, 0), permanent('o2', RAIDER, 0, { tapped: true, power: 4 })],
      [],
    );
    const labels = labelDecision(decision([cast('1', 'o1', RAIDER), cast('2', 'o2', RAIDER)]), view);
    // Both are North's and both are undamaged, so neither clause appears.
    expect(labels[1]?.text).toBe(`Cast Lightning Lash → ${RAIDER} (4/2 · tapped)`);
    expect(labels[0]?.text).toBe(`Cast Lightning Lash → ${RAIDER} (2/2 · untapped)`);
  });

  it('separates them by a counter kind neither engine has to share', () => {
    const view = board(
      [permanent('o1', RAIDER, 0), permanent('o2', RAIDER, 0, { counters: { oil: 2 } })],
      [],
    );
    const labels = labelDecision(decision([cast('1', 'o1', RAIDER), cast('2', 'o2', RAIDER)]), view);
    expect(labels[1]?.text).toBe(`Cast Lightning Lash → ${RAIDER} (oil x2)`);
  });
});

/**
 * The residue, which is the half of the answer that has to be visible.
 *
 * A neutral rail cannot see what is attached to a permanent or what on the stack
 * is aimed at it, so two twins that differ only in one of those come back
 * carrying the same sentence. `sharedWith` is the whole difference between that
 * and `mtg-cee`.
 */
describe('what the projection cannot separate', () => {
  const RAIDER = 'Emberflow Raider';

  it('reports twins that agree about every projected property, in both directions', () => {
    const view = board([permanent('o1', RAIDER, 0), permanent('o2', RAIDER, 0)], []);
    const labels = labelDecision(decision([cast('1', 'o1', RAIDER), cast('2', 'o2', RAIDER)]), view);
    expect(labels.map((label) => label.text)).toEqual([
      `Cast Lightning Lash → ${RAIDER}`,
      `Cast Lightning Lash → ${RAIDER}`,
    ]);
    expect(labels[0]?.sharedWith).toEqual(['2']);
    expect(labels[1]?.sharedWith).toEqual(['1']);
  });

  it('reports two moves that point at nothing the view carries', () => {
    const view = board([], []);
    const labels = labelDecision(decision([cast('1', 'gone', RAIDER), cast('2', 'also-gone', RAIDER)]), view);
    expect(labels[0]?.sharedWith).toEqual(['2']);
  });

  it('reports colliding moves that point at no object at all', () => {
    const view = board([], []);
    const options = [
      { id: '1', text: 'Pass', targets: [] },
      { id: '2', text: 'Pass', targets: [] },
    ];
    expect(labelDecision(decision(options), view)[0]?.sharedWith).toEqual(['2']);
  });

  it('names all of a group larger than two', () => {
    const view = board(
      [permanent('o1', RAIDER, 0), permanent('o2', RAIDER, 0), permanent('o3', RAIDER, 0)],
      [],
    );
    const labels = labelDecision(
      decision([cast('1', 'o1', RAIDER), cast('2', 'o2', RAIDER), cast('3', 'o3', RAIDER)]),
      view,
    );
    expect(labels[0]?.sharedWith).toEqual(['2', '3']);
  });
});

describe('a move that points at several objects', () => {
  const RAIDER = 'Emberflow Raider';
  const OGRE = 'Ashen Rook';

  /** Two attack declarations over four creatures, differing in one of the two. */
  it('names which of the objects the pair disagrees about', () => {
    const view = board(
      [permanent('a1', RAIDER, 0), permanent('a2', RAIDER, 0, { damage: 3 }), permanent('b1', OGRE, 0)],
      [],
    );
    const text = `Attack with ${RAIDER}, ${OGRE}`;
    const options: readonly MoveOption[] = [
      {
        id: '1',
        text,
        targets: [
          { oid: 'a1', name: RAIDER },
          { oid: 'b1', name: OGRE },
        ],
      },
      {
        id: '2',
        text,
        targets: [
          { oid: 'a2', name: RAIDER },
          { oid: 'b1', name: OGRE },
        ],
      },
    ];
    const labels = labelDecision(decision(options), view);
    // The second position is one object for both, so it contributes no clause
    // and the name prefix says which of the two the one clause is about.
    expect(labels[0]?.text).toBe(text);
    expect(labels[1]?.text).toBe(`${text} (${RAIDER} 3 damage marked)`);
    expect(labels[1]?.sharedWith).toEqual([]);
  });
});

/**
 * The same function over a session from a backend that is not our kernel.
 *
 * The toy's two moves never read alike, so the claim being held here is the one
 * a repair has to keep: a decision with nothing to fix comes back byte for byte
 * as the backend wrote it, and the ids still line up with the ones `submit`
 * accepts.
 */
describe('over a real session', () => {
  it('returns a clean list untouched and still submittable', async () => {
    const opened = await scriptBackend({ clock: 3 }).open({
      content: { kind: 'printed', format: 'legacy' },
      seats: [
        { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
        { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
      ],
      seed: 'labels-test',
      maximumTurns: null,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const asked = opened.session.decision;
    expect(asked).not.toBeNull();
    if (asked === null) return;
    const labels = labelDecision(asked, opened.session.view);
    expect(labels.map((label) => label.text)).toEqual(asked.options.map((option) => option.text));
    expect(labels.every((label) => label.sharedWith.length === 0)).toBe(true);
    const first = labels[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect((await opened.session.submit(first.id)).ok).toBe(true);
  });
});

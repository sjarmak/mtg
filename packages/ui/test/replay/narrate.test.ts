// @vitest-environment jsdom
/**
 * Narration is the difference between a log viewer and a replay viewer, so it
 * gets tested as a contract: every event the fixture actually emits produces a
 * finished English sentence, and the variants the slice does not reach yet are
 * exercised directly rather than left to a future crash.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DecisionPanel } from '../../src/routes/replay/DecisionPanel';
import {
  describeAction,
  describeDecision,
  describeEvent,
  describeResult,
  namesFor,
  optionLabels,
  stepWords,
} from '../../src/routes/replay/narrate';
import type { LogAction, LogDecision, LogEvent } from '../../src/routes/replay/log-schema';
import { fixtureLog } from './support/log-fixture';

afterEach(cleanup);

const LOG = fixtureLog();
const GAME = LOG.games[0];
if (GAME === undefined) throw new Error('the fixture has no games');
const NAMES = namesFor(GAME, 0);

/**
 * Every sentence the recorded game produces, each narrated with the book for
 * its own step. One book for the whole game would be wrong in the slot that
 * carries a possessive: `LogNames.target` says an object as its controller's,
 * and control is a fact about a moment (`mtg-fyo`).
 */
function sentences(): readonly string[] {
  return GAME === undefined
    ? []
    : GAME.steps.flatMap((step) =>
        step.events.map((event) => describeEvent(event, namesFor(GAME, step.seq))),
      );
}

describe('describeEvent over the recorded game', () => {
  it('finishes a sentence for every event in the log', () => {
    const lines = sentences();
    expect(lines.length).toBeGreaterThan(1000);
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(3);
      expect(line.endsWith('.')).toBe(true);
      expect(line).not.toMatch(/undefined|\[object Object\]|NaN/);
    }
  });

  it('names cards and players rather than object ids', () => {
    const lines = sentences();
    for (const line of lines) expect(line).not.toMatch(/\bo\d+\b/);
    expect(lines.some((line) => line.includes('RW Aggro'))).toBe(true);
    expect(lines.some((line) => line.includes('UB Control'))).toBe(true);
  });

  it('covers every event type the kernel emitted here', () => {
    const kinds = new Set(GAME?.steps.flatMap((step) => step.events.map((event) => event.type)) ?? []);
    expect(kinds.size).toBeGreaterThan(15);
    expect(kinds.has('spellCast')).toBe(true);
    expect(kinds.has('damageDealt')).toBe(true);
    expect(kinds.has('attackersDeclared')).toBe(true);
    expect(kinds.has('gameEnded')).toBe(true);
  });
});

describe('describeEvent over variants the slice has not reached', () => {
  const cases: readonly (readonly [LogEvent, RegExp])[] = [
    [{ type: 'drawFromEmptyLibrary', player: 1 }, /empty library/],
    [{ type: 'spellCountered', oid: 'o1', by: 'o2' }, /is countered by/],
    [{ type: 'spellFizzled', oid: 'o1' }, /fizzles/],
    [
      { type: 'effectSkipped', oid: 'o1', index: 0, why: 'no legal target' },
      /skips effect 1: no legal target/,
    ],
    [{ type: 'tokenCreated', oid: 'o9', controller: 0, name: 'Soldier' }, /creates a Soldier token/],
    [
      { type: 'damagePrevented', sourceOid: 'o1', target: { kind: 'player', player: 1 }, amount: 2 },
      /is prevented/,
    ],
    [
      {
        type: 'attackersDeclared',
        player: 0,
        attacks: [{ oid: 'o1', defender: { kind: 'planeswalker', oid: 'o2' } }],
      },
      / at /,
    ],
    [{ type: 'replacementApplied', id: 're1', event: 'draw' }, /replacement effect rewrote a draw event/],
    [{ type: 'countersChanged', oid: 'o1', plusOnePlusOne: 2, minusOneMinusOne: 0 }, /2 \+1\/\+1/],
    [
      { type: 'countersChanged', oid: 'o1', plusOnePlusOne: 0, minusOneMinusOne: 0, loyalty: 4 },
      /4 loyalty counters/,
    ],
    [
      { type: 'continuousEffectAdded', id: 'ce1', targetOid: 'o1', power: 2, toughness: 2, layer: '7c' },
      /gets \+2\/\+2 in layer 7c/,
    ],
    [{ type: 'continuousEffectsExpired', ids: ['ce1'] }, /1 continuous effect expire/],
    [{ type: 'permanentDestroyed', oid: 'o1', reason: 'deathtouch' }, /destroyed by deathtouch/],
    // The one event in the stream that reports a turn-based action *not*
    // happening. Nothing on the board changes when it fires, so the sentence is
    // the whole of the record that the tap cost its controller a turn.
    [{ type: 'untapSkipped', oid: 'o1' }, /stays tapped and does not untap/],
    [{ type: 'blockerOrderChosen', attacker: 'o1', blockers: ['o2', 'o3'] }, /assigns damage to/],
    [{ type: 'cardsMilled', player: 0, oids: ['o1'] }, /mills/],
    [{ type: 'cardsDiscarded', player: 0, oids: ['o1'] }, /discards/],
    [{ type: 'handRevealed', player: 0, oids: ['o1'] }, /reveals/],
    // The empty hand gets its own sentence rather than an empty list, because
    // "reveals ." is a line that reads as a bug and "reveals an empty hand" is
    // the fact the spell established.
    [{ type: 'handRevealed', player: 0, oids: [] }, /reveals an empty hand/],
    [{ type: 'playerLost', player: 0, reason: 'concede' }, /loses the game: conceded/],
    [{ type: 'gameEnded', winner: null, reason: 'turnLimit', turn: 5 }, /draw on turn 5/],
    [{ type: 'manaPoolEmptied', player: 0, wasted: 2 }, /wasting 2/],
    // The condition is in the sentence because it is in the event, and it is in
    // the event because `source` and `index` alone cannot say whether the
    // ability fired on an arrival or on a death.
    [
      { type: 'abilityTriggered', player: 0, oid: 'ab1', source: 'o1', index: 1, condition: 'selfDies' },
      /ability 2 triggers on dying/,
    ],
    [
      {
        type: 'triggerTargetsChosen',
        oid: 'ab1',
        source: 'o1',
        targets: [{ kind: 'permanent', oid: 'o2' }],
      },
      /triggered ability goes on the stack targeting /,
    ],
    // A declined "you may" is a line in the log, not a silence: CR 603.3b puts
    // the ability on the stack either way, and a reader who cannot see the
    // decline cannot tell it apart from a trigger that never fired.
    [{ type: 'triggerDeclined', oid: 'ab1', source: 'o1' }, /declines its triggered ability/],
    [
      { type: 'triggerRemoved', oid: 'ab1', source: 'o1', why: 'no legal target' },
      /removed from the stack: no legal target/,
    ],
    // CR 103.4. The fixture's bots keep both hands, so neither of these two is
    // reached by a recorded game — which is exactly what this block is for.
    [{ type: 'handMulliganed', player: 0, mulligans: 2 }, /opening hand back .*\(mulligan 2\)/],
    [{ type: 'handKept', player: 0, mulligans: 0, bottomed: [] }, /keeps their opening hand/],
    [{ type: 'handKept', player: 1, mulligans: 1, bottomed: ['o1'] }, /on the bottom of their library/],
  ];

  for (const [event, pattern] of cases) {
    it(`narrates ${event.type}`, () => {
      const line = describeEvent(event, NAMES);
      expect(line).toMatch(pattern);
      expect(line).not.toMatch(/undefined/);
    });
  }
});

describe('describeAction', () => {
  const cases: readonly (readonly [LogAction, RegExp])[] = [
    [{ type: 'passPriority', player: 0 }, /^pass priority$/],
    [{ type: 'concede', player: 1 }, /^concede$/],
    [{ type: 'discard', player: 0, oids: ['o1'] }, /^discard /],
    [
      { type: 'orderBlockers', player: 0, orders: [{ attacker: 'o1', blockers: ['o2'] }] },
      /^order blockers /,
    ],
    [{ type: 'declareAttackers', player: 0, attackers: [] }, /^attack with nothing$/],
    [
      {
        type: 'declareAttackers',
        player: 0,
        attackers: [{ oid: 'o1', defender: { kind: 'planeswalker', oid: 'o2' } }],
      },
      /^attack with .* at /,
    ],
    [{ type: 'declareBlockers', player: 1, blocks: [] }, /^block with nothing$/],
    [
      {
        type: 'chooseTriggerTargets',
        player: 0,
        oid: 'ab1',
        targets: [{ kind: 'permanent', oid: 'o1' }],
      },
      /^aim .* targeting /,
    ],
    [{ type: 'answerOptionalTrigger', player: 0, oid: 'ab1', accept: true }, /^take /],
    [{ type: 'answerOptionalTrigger', player: 0, oid: 'ab1', accept: false }, /^decline /],
    [{ type: 'mulligan', player: 0 }, /^mulligan this hand$/],
    [{ type: 'keepHand', player: 0, bottom: [] }, /^keep this hand$/],
    [{ type: 'keepHand', player: 0, bottom: ['o1'] }, /^keep this hand, bottoming /],
  ];

  for (const [action, pattern] of cases) {
    it(`narrates ${action.type}`, () => {
      expect(describeAction(action, NAMES)).toMatch(pattern);
    });
  }
});

describe('optionLabels', () => {
  it('disambiguates identical labels by the object they act on', () => {
    // Two copies of the same basic land: the kernel offers both, and a list
    // that printed one line twice would hide a real choice between objects.
    const byName = new Map<string, string[]>();
    for (const object of GAME?.objects.values() ?? []) {
      const oids = byName.get(object.card.name) ?? [];
      oids.push(object.oid);
      byName.set(object.card.name, oids);
    }
    const twins = [...byName.values()].find((oids) => oids.length >= 2);
    const [firstOid, secondOid] = twins ?? [];
    if (firstOid === undefined || secondOid === undefined) throw new Error('no duplicated card in the game');

    const options: readonly LogAction[] = [
      { type: 'passPriority', player: 0 },
      { type: 'activateManaAbility', player: 0, oid: firstOid, color: 'W' },
      { type: 'activateManaAbility', player: 0, oid: secondOid, color: 'W' },
    ];
    const labels = optionLabels(options, NAMES);
    expect(labels[0]).toBe('pass priority');
    expect(labels[1]).not.toBe(labels[2]);
    expect(labels[1]).toBe(`tap ${NAMES.card(firstOid)} for white (${firstOid})`);
    expect(labels[2]).toBe(`tap ${NAMES.card(secondOid)} for white (${secondOid})`);
  });

  it('leaves unique labels alone', () => {
    const options: readonly LogAction[] = [
      { type: 'passPriority', player: 0 },
      { type: 'concede', player: 0 },
    ];
    expect(optionLabels(options, NAMES)).toEqual(['pass priority', 'concede']);
  });
});

describe('DecisionPanel honesty', () => {
  function decision(overrides: Partial<LogDecision>): LogDecision {
    return {
      kind: 'declareBlockers',
      player: 1,
      optionCount: 2,
      truncated: false,
      complete: true,
      options: [
        { type: 'declareBlockers', player: 1, blocks: [] },
        { type: 'declareBlockers', player: 1, blocks: [{ blocker: 'o1', attacker: 'o2' }] },
      ],
      chosen: 0,
      ...overrides,
    };
  }

  it('says when the list is a prefix of a bigger enumerated space', () => {
    render(
      h(DecisionPanel, {
        decision: decision({ truncated: true, optionCount: 900 }),
        names: NAMES,
        emptyText: 'unused',
      }),
    );
    expect(screen.getByText(/Showing 2 of 900 enumerated options/)).toBeTruthy();
  });

  it('says when the kernel hit its enumeration cap', () => {
    render(h(DecisionPanel, { decision: decision({ complete: false }), names: NAMES, emptyText: 'unused' }));
    expect(screen.getByText(/hit its enumeration cap/)).toBeTruthy();
  });

  it('says when the bot built a declaration the list does not contain', () => {
    render(h(DecisionPanel, { decision: decision({ chosen: null }), names: NAMES, emptyText: 'unused' }));
    expect(screen.getByText(/constructed this declaration itself/)).toBeTruthy();
    expect(screen.queryAllByText('chose').length).toBe(0);
  });
});

describe('summaries', () => {
  it('reads a decided result and a drawn one differently', () => {
    const decided = LOG.games[0];
    const drawn = LOG.games[1];
    if (decided === undefined || drawn === undefined) throw new Error('the fixture lost a game');
    expect(describeResult(decided.result, namesFor(decided, 0))).toMatch(/ wins on turn /);
    expect(describeResult(drawn.result, namesFor(drawn, 0))).toMatch(/^Draw on turn /);
  });

  it('asks both trigger questions by name', () => {
    const asked = (kind: LogDecision['kind']): string =>
      describeDecision(
        { kind, player: 0, optionCount: 1, truncated: false, complete: true, options: [], chosen: 0 },
        NAMES,
      );
    expect(asked('triggerTargets')).toMatch(/chooses targets for a triggered ability\.$/);
    expect(asked('optionalTrigger')).toMatch(/decides whether to take an optional triggered ability\.$/);
  });

  it('asks the opening-hand question by name', () => {
    const asked = describeDecision(
      {
        kind: 'mulligan',
        player: 0,
        optionCount: 2,
        truncated: false,
        complete: true,
        options: [],
        chosen: 0,
      },
      NAMES,
    );
    expect(asked).toMatch(/decides whether to keep their opening hand\.$/);
  });

  it('spells out step names', () => {
    expect(stepWords('precombatMain')).toBe('precombat main');
    expect(stepWords('firstStrikeDamage')).toBe('first-strike damage');
  });

  it('asks the decision question with the seat that owes it', () => {
    const step = GAME?.steps.find((entry) => entry.decision?.kind === 'declareAttackers');
    const asked = step?.decision;
    if (asked === undefined || asked === null) throw new Error('no attack decision in the fixture');
    expect(describeDecision(asked, NAMES)).toMatch(/declares attackers\.$/);
  });
});

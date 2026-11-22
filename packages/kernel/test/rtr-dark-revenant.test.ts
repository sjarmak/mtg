/** Native departed-incarnation behavior for RTR #61, Dark Revenant. */
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  moveObject,
  pendingDecision,
  scenario,
  settle,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { controlledBy, onlyObject, withContinuous } from './continuous-helpers';
import { apply, oidOf } from './helpers';

const DARK_REVENANT = parseCard({
  kind: 'creature',
  id: 'rtr-061-dark-revenant-kernel',
  name: 'Dark Revenant',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 61 },
  manaCost: { generic: 3, B: 1 },
  colors: ['B'],
  subtypes: ['Spirit'],
  keywords: ['flying'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'putDepartedSourceOnTopOfOwnerLibrary' }],
    },
  ],
});

const VOID = parseCard({
  kind: 'enchantment',
  id: 'test-dark-revenant-void',
  name: 'Dark Revenant Probe Void',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { B: 1 },
  colors: ['B'],
  abilities: [{ kind: 'staticPlayerRule', players: 'eachOpponent', rule: 'cardsToGraveyardAreExiled' }],
});

const LIBRARY_TOP = creature('Dark Revenant Library Top', 1, 1);

function pass(current: ReduceResult): ReduceResult {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'priority') throw new Error('Dark Revenant test lost priority');
  return apply(current, { type: 'passPriority', player: decision.player });
}

function fired(token = false): { readonly current: ReduceResult; readonly source: ObjectId } {
  const opened = scenario({
    battlefield: [{ card: DARK_REVENANT, controller: 0, token }],
    libraries: [[LIBRARY_TOP], [LIBRARY_TOP]],
  });
  const source = oidOf(opened.state, DARK_REVENANT.name);
  const moved = settle(moveObject(beginTrace(opened.state), source, 'graveyard'));
  return { current: { state: moved.state, events: moved.events }, source };
}

describe('Dark Revenant in the kernel', () => {
  it('puts the exact departed incarnation on top of its owner library', () => {
    const departed = fired();
    const previousTop = departed.current.state.players[0].library[0];
    const resolved = pass(pass(departed.current));

    expect(resolved.state.players[0].library.slice(0, 2)).toEqual([departed.source, previousTop]);
    expect(resolved.state.objects[departed.source]?.zone).toBe('library');
  });

  it('uses the source owner even when its last controller owns the trigger', () => {
    const opened = scenario({
      battlefield: [{ card: DARK_REVENANT, controller: 0 }],
      libraries: [[LIBRARY_TOP], [LIBRARY_TOP]],
    });
    const source = oidOf(opened.state, DARK_REVENANT.name);
    const stolen = withContinuous(opened.state, [controlledBy(onlyObject(source), 1)]);
    const moved = settle(moveObject(beginTrace(stolen), source, 'graveyard'));
    expect(moved.state.stack[0]?.controller).toBe(1);

    const resolved = pass(pass({ state: moved.state, events: moved.events }));
    expect(resolved.state.players[0].library[0]).toBe(source);
    expect(resolved.state.players[1].library).not.toContain(source);
  });

  it('does not move a later incarnation or a token that ceased to exist', () => {
    const departed = fired();
    const left = moveObject(beginTrace(departed.current.state), departed.source, 'hand');
    const returned = moveObject(left, departed.source, 'graveyard');
    const stale = pass(pass({ state: returned.state, events: departed.current.events }));
    expect(stale.state.objects[departed.source]?.zone).toBe('graveyard');

    const token = fired(true);
    expect(token.current.state.objects[token.source]?.zone).toBe('exile');
    const resolvedToken = pass(pass(token.current));
    expect(resolvedToken.state.players[0].library).not.toContain(token.source);
  });

  it('does not trigger when a graveyard move is replaced with exile', () => {
    const opened = scenario({
      battlefield: [
        { card: DARK_REVENANT, controller: 0 },
        { card: VOID, controller: 1 },
      ],
      libraries: [[LIBRARY_TOP], [LIBRARY_TOP]],
    });
    const source = oidOf(opened.state, DARK_REVENANT.name);
    const moved = settle(moveObject(beginTrace(opened.state), source, 'graveyard'));
    expect(moved.state.objects[source]?.zone).toBe('exile');
    expect(moved.state.stack).toHaveLength(0);
  });
});

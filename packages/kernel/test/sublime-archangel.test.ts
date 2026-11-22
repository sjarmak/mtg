/** Live static triggered-ability grants through copies, control, and layer 6. */
import { exaltedAbility, parseCard } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  moveObject,
  onlyObject,
  pendingDecision,
  powerOf,
  reduce,
  scenario,
  toughnessOf,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { abilities, copies, withContinuous } from './continuous-helpers';
import { apply, oidOf } from './helpers';

const SUBLIME_ARCHANGEL = parseCard({
  kind: 'creature',
  id: 'm13-sublime-archangel',
  name: 'Sublime Archangel',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 36 },
  manaCost: { generic: 2, W: 2 },
  colors: ['W'],
  subtypes: ['Angel'],
  keywords: ['flying'],
  abilities: [
    exaltedAbility(),
    {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: null,
      modification: { kind: 'grantTriggeredAbility', ability: exaltedAbility() },
    },
  ],
  power: 4,
  toughness: 3,
});

const ATTACKER = creature('Sublime Attacker', 2, 2);

function declareSolo(state: GameState, attacker: string): ReduceResult {
  return reduce(state, {
    type: 'declareAttackers',
    player: state.turn.active,
    attackers: [{ oid: attacker, defender: state.turn.active === 0 ? 1 : 0 }],
  });
}

function resolveStack(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 40; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('exalted grant did not reach priority');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('exalted grant stack did not settle');
}

describe('Sublime Archangel in the kernel', () => {
  it('gives each other controlled creature one independent exalted instance', () => {
    const start = scenario({
      battlefield: [
        { card: SUBLIME_ARCHANGEL, controller: 0 },
        { card: ATTACKER, controller: 0 },
        { card: creature('Sublime Witness', 1, 1), controller: 0 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const attacker = oidOf(start, ATTACKER.name);
    const declared = declareSolo(start, attacker);

    expect(eventsOfType(declared.events, 'abilityTriggered')).toHaveLength(3);
    const resolved = resolveStack(declared);
    expect(powerOf(resolved.state, attacker)).toBe(5);
    expect(toughnessOf(resolved.state, attacker)).toBe(5);
  });

  it('stacks every granted instance from multiple Archangels', () => {
    const start = scenario({
      battlefield: [
        { card: SUBLIME_ARCHANGEL, controller: 0 },
        { card: SUBLIME_ARCHANGEL, controller: 0 },
        { card: ATTACKER, controller: 0 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const attacker = oidOf(start, ATTACKER.name);
    const declared = declareSolo(start, attacker);

    expect(eventsOfType(declared.events, 'abilityTriggered')).toHaveLength(6);
    expect(powerOf(resolveStack(declared).state, attacker)).toBe(8);
  });

  it('withdraws the grant when its source leaves or loses the static ability', () => {
    const start = scenario({
      battlefield: [
        { card: SUBLIME_ARCHANGEL, controller: 0 },
        { card: ATTACKER, controller: 0 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const source = oidOf(start, SUBLIME_ARCHANGEL.name);
    const attacker = oidOf(start, ATTACKER.name);
    const gone = moveObject(beginTrace(start), source, 'graveyard').state;
    expect(eventsOfType(declareSolo(gone, attacker).events, 'abilityTriggered')).toEqual([]);

    const silenced = withContinuous(start, [
      abilities(onlyObject(source), { removeAll: true }, { source: 'silence', ts: 100 }),
    ]);
    expect(eventsOfType(declareSolo(silenced, attacker).events, 'abilityTriggered')).toEqual([]);
  });

  it('derives the grant from copied values and follows the source current controller', () => {
    const blank = creature('Blank Archangel Copy', 1, 1);
    const ally = creature('Borrowed Sublime Ally', 2, 2);
    const start = scenario({
      battlefield: [
        { card: SUBLIME_ARCHANGEL, controller: 1 },
        { card: blank, controller: 0 },
        { card: ally, controller: 0 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const original = oidOf(start, SUBLIME_ARCHANGEL.name);
    const copy = oidOf(start, blank.name);
    const attacker = oidOf(start, ally.name);
    const copied = withContinuous(start, [copies(onlyObject(copy), original, { ts: 50 })]);
    const declared = declareSolo(copied, attacker);

    expect(eventsOfType(declared.events, 'abilityTriggered')).toHaveLength(2);
    expect(powerOf(resolveStack(declared).state, attacker)).toBe(4);
  });

  it('orders a recipient ability removal against the live grant by layer-6 timestamp', () => {
    const start = scenario({
      battlefield: [
        { card: SUBLIME_ARCHANGEL, controller: 0 },
        { card: ATTACKER, controller: 0 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const attacker = oidOf(start, ATTACKER.name);

    const removedAfterGrant = withContinuous(start, [
      abilities(onlyObject(attacker), { removeAll: true }, { source: 'late-silence', ts: 100 }),
    ]);
    expect(eventsOfType(declareSolo(removedAfterGrant, attacker).events, 'abilityTriggered')).toHaveLength(1);

    const grantedAfterRemoval = withContinuous(start, [
      abilities(onlyObject(attacker), { removeAll: true }, { source: 'early-silence', ts: -1 }),
    ]);
    expect(eventsOfType(declareSolo(grantedAfterRemoval, attacker).events, 'abilityTriggered')).toHaveLength(
      2,
    );
  });
});

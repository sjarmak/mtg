/** Played-game integration evidence for M13's Jester and Rampage cards. */
import type { Card, Effect } from '@mtg/dsl';
import {
  beginTrace,
  canBlock,
  characteristicsOf,
  moveObject,
  pendingDecision,
  scenario,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, FOREST, instant, lands, MOUNTAIN, sorcery } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const BEAR = creature('Runeclaw Bear', 2, 2);
const OGRE = creature('Test Ogre', 3, 3);
const DRAKE = creature('Test Drake', 2, 2, { keywords: ['flying'] });

function battleJester(): Card {
  return creature('Goblin Battle Jester', 2, 2, {
    abilities: [
      {
        kind: 'triggered',
        condition: 'youCastSpell',
        spellColors: ['R'],
        effects: [{ kind: 'cantBlockThisTurn', target: { kind: 'targetCreature' } } as unknown as Effect],
      },
    ],
  });
}

function passToTriggerTargets(current: ReduceResult): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 12; guard += 1) {
    const decision = pendingDecision(walked.state);
    if (decision?.kind === 'triggerTargets') return walked;
    if (decision?.kind !== 'priority') return walked;
    walked = apply(walked, { type: 'passPriority', player: decision.player });
  }
  throw new Error('passToTriggerTargets: trigger was never aimed');
}

describe('Goblin Battle Jester', () => {
  it('fires only for its controller casting red and installs the restriction when its target remains legal', () => {
    const red = instant('Test Red Spell', [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }], {
      R: 1,
    });
    const green = instant(
      'Test Green Spell',
      [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      { G: 1 },
    );
    const board = (active: 0 | 1, hand: Card) =>
      scenario({
        battlefield: [
          { card: battleJester(), controller: 0 },
          { card: OGRE, controller: 1 },
          ...lands(hand.name === green.name ? FOREST : MOUNTAIN, 2).map((card) => ({
            card,
            controller: active,
          })),
        ],
        hands: active === 0 ? [[hand], []] : [[], [hand]],
        active,
      });

    for (const [active, spell, triggers] of [
      [0, green, false],
      [1, red, false],
      [0, red, true],
    ] as const) {
      const start = board(active, spell);
      const cast = apply(start, {
        type: 'castSpell',
        player: active,
        oid: handOidOf(start.state, active, spell.name),
        targets: [null],
      });
      const stopped = passToTriggerTargets(cast);
      expect(pendingDecision(stopped.state)?.kind === 'triggerTargets').toBe(triggers);
      if (!triggers) continue;

      const target = oidOf(stopped.state, OGRE.name);
      const entry = stopped.state.stack.find((candidate) => candidate.ability !== null);
      if (entry === undefined) throw new Error('Jester trigger was not on the stack');
      const aimed = apply(stopped, {
        type: 'chooseTriggerTargets',
        player: 0,
        oid: entry.oid,
        targets: [{ kind: 'permanent', oid: target }],
      });
      let settled = aimed;
      for (let guard = 0; guard < 10 && settled.state.stack.length > 0; guard += 1) {
        const decision = pendingDecision(settled.state);
        if (decision?.kind !== 'priority') throw new Error('Jester resolution stalled');
        settled = apply(settled, { type: 'passPriority', player: decision.player });
      }
      expect(settled.state.turnCombatRules).toContainEqual({
        rule: 'cantBlockThisTurn',
        sourceOid: oidOf(settled.state, 'Goblin Battle Jester'),
        subject: target,
      });
      const attacker = oidOf(settled.state, 'Goblin Battle Jester');
      expect(canBlock(settled.state, target, attacker)).toBe(false);
    }
  });

  it('rechecks the chosen creature at resolution and fizzles after it leaves', () => {
    const red = instant('Test Red Spell', [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }], {
      R: 1,
    });
    const start = scenario({
      battlefield: [
        { card: battleJester(), controller: 0 },
        { card: OGRE, controller: 1 },
        ...lands(MOUNTAIN, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[red], []],
    });
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, red.name),
      targets: [null],
    });
    const stopped = passToTriggerTargets(cast);
    const target = oidOf(stopped.state, OGRE.name);
    const entry = stopped.state.stack.find((candidate) => candidate.ability !== null);
    if (entry === undefined) throw new Error('Jester trigger was not on the stack');
    const aimed = apply(stopped, {
      type: 'chooseTriggerTargets',
      player: 0,
      oid: entry.oid,
      targets: [{ kind: 'permanent', oid: target }],
    });
    const gone = moveObject(beginTrace(aimed.state), target, 'graveyard');
    let settled: ReduceResult = { state: gone.state, events: [...aimed.events, ...gone.events] };
    for (let guard = 0; guard < 10 && settled.state.stack.length > 0; guard += 1) {
      const decision = pendingDecision(settled.state);
      if (decision?.kind !== 'priority') throw new Error('Jester resolution stalled');
      settled = apply(settled, { type: 'passPriority', player: decision.player });
    }
    expect(settled.state.turnCombatRules.some((candidate) => candidate.subject === target)).toBe(false);
  });
});

describe('Predatory Rampage', () => {
  it('pumps allies, snapshots opposing creatures, ignores later arrivals, and clears at cleanup', () => {
    const rampage = sorcery(
      'Predatory Rampage',
      [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 3,
          toughness: 3,
          target: { kind: 'noTarget' },
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
        },
        {
          kind: 'blocksThisTurnIfAble',
          target: { kind: 'noTarget' },
          scope: 'permanentsOpponentsControl',
          scopeFilter: { cardTypes: ['creature'] },
        } as unknown as Effect,
      ],
      { generic: 3, G: 2 },
    );
    const start = scenario({
      battlefield: [
        { card: BEAR, controller: 0 },
        { card: OGRE, controller: 1 },
        ...lands(FOREST, 5).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[rampage], [DRAKE]],
    });
    const ally = oidOf(start.state, BEAR.name);
    const opposing = oidOf(start.state, OGRE.name);
    let current = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, rampage.name),
      targets: [null, null],
    });
    for (let guard = 0; guard < 12 && current.state.stack.length > 0; guard += 1) {
      const decision = pendingDecision(current.state);
      if (decision?.kind !== 'priority') throw new Error('Rampage resolution stalled');
      current = apply(current, { type: 'passPriority', player: decision.player });
    }

    expect(characteristicsOf(current.state, ally)).toMatchObject({ power: 5, toughness: 5 });
    expect(characteristicsOf(current.state, opposing)).toMatchObject({ power: 3, toughness: 3 });
    expect(current.state.turnCombatRules).toEqual([
      { rule: 'blocksThisTurnIfAble', sourceOid: expect.any(String), subject: opposing },
    ]);

    const late = handOidOf(current.state, 1, DRAKE.name);
    const arrived = moveObject(beginTrace(current.state), late, 'battlefield');
    current = { state: arrived.state, events: [...current.events, ...arrived.events] };
    expect(current.state.objects[late]?.zone).toBe('battlefield');
    expect(current.state.turnCombatRules.some((candidate) => candidate.subject === late)).toBe(false);
    expect(current.state.turnCombatRules.some((candidate) => candidate.subject !== opposing)).toBe(false);

    const startedOn = current.state.turn.number;
    for (let guard = 0; guard < 100 && current.state.turn.number === startedOn; guard += 1) {
      const decision = pendingDecision(current.state);
      if (decision?.kind === 'priority') {
        current = apply(current, { type: 'passPriority', player: decision.player });
      } else if (decision?.kind === 'declareAttackers') {
        current = apply(current, { type: 'declareAttackers', player: decision.player, attackers: [] });
      } else {
        throw new Error(`Rampage cleanup stopped on ${String(decision?.kind ?? 'nothing')}`);
      }
    }
    expect(current.state.turnCombatRules).toEqual([]);
    expect(characteristicsOf(current.state, ally)).toMatchObject({ power: 2, toughness: 2 });
  });
});

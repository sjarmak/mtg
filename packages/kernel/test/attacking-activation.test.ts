/** Native enumeration for an ability available only while its source attacks. */
import { describe, expect, it } from 'vitest';
import { basicLand, parseCard } from '@mtg/dsl';
import {
  legalActions,
  opponentOf,
  pendingDecision,
  scenario,
  type Action,
  type ReduceResult,
} from '@mtg/kernel';
import { creature } from './cards';
import { apply, damageOn, oidOf } from './helpers';

const HELLKITE = parseCard({
  kind: 'creature',
  id: 'tst-ancient-hellkite',
  name: 'Ancient Hellkite',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 122 },
  colors: ['R'],
  manaCost: { generic: 4, R: 3 },
  power: 6,
  toughness: 6,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { R: 1 } },
      effects: [
        {
          kind: 'dealDamage',
          amount: 1,
          target: { kind: 'targetCreatureDefendingPlayerControls' },
        },
      ],
      activateOnlyWhileAttacking: true,
    },
  ],
});

const ALLY = creature('Hellkite Ally', 2, 2);
const ENEMY = creature('Hellkite Enemy', 3, 3);

function activations(
  current: ReduceResult,
  source: string,
): readonly Extract<Action, { type: 'activateAbility' }>[] {
  const oid = oidOf(current.state, source);
  return legalActions(current.state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === oid,
  );
}

function passToAttackers(current: ReduceResult): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 8; guard += 1) {
    const decision = pendingDecision(walked.state);
    if (decision?.kind === 'declareAttackers') return walked;
    if (decision?.kind !== 'priority') throw new Error('combat did not reach attackers');
    walked = apply(walked, { type: 'passPriority', player: decision.player });
  }
  throw new Error('combat did not reach attackers');
}

function resolveAbility(current: ReduceResult): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 8 && walked.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(walked.state);
    if (decision?.kind !== 'priority') throw new Error('ability did not resolve through priority');
    walked = apply(walked, { type: 'passPriority', player: decision.player });
  }
  return walked;
}

describe('activate only while this creature is attacking', () => {
  it('is absent before the attack and offered only at defending-player creatures during it', () => {
    const opened = scenario({
      battlefield: [
        { card: HELLKITE, controller: 0 },
        { card: basicLand('Mountain', 'TST', 123), controller: 0 },
        { card: ALLY, controller: 0 },
        { card: ENEMY, controller: 1 },
      ],
      active: 0,
      turn: 4,
      step: 'beginCombat',
    });
    let current: ReduceResult = { state: opened.state, events: [...opened.events] };
    expect(activations(current, HELLKITE.name)).toEqual([]);

    current = passToAttackers(current);
    const source = oidOf(current.state, HELLKITE.name);
    current = apply(current, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: source, defender: opponentOf(0) }],
    });
    const options = activations(current, HELLKITE.name);
    expect(options.map((action) => action.targets)).toEqual([
      [{ kind: 'permanent', oid: oidOf(current.state, ENEMY.name) }],
    ]);
    expect(options.flatMap((action) => action.targets)).not.toContainEqual({
      kind: 'permanent',
      oid: oidOf(current.state, ALLY.name),
    });

    current = apply(
      current,
      options[0] ??
        (() => {
          throw new Error('no Hellkite activation');
        })(),
    );
    current = resolveAbility(current);
    expect(damageOn(current.state, oidOf(current.state, ENEMY.name))).toBe(1);
  });
});

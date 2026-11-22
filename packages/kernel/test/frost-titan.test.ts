/** Frost Titan's opponent-filtered target toll through the real stack. */
import { describe, expect, it } from 'vitest';
import { parseCard, type AbilityInput } from '@mtg/dsl';
import type { ObjectId, ReduceResult } from '@mtg/kernel';
import { eventsOfType, pendingDecision, scenario } from '@mtg/kernel';
import { artifact, FOREST, instant, lands } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const FROST_TITAN = parseCard({
  kind: 'creature',
  id: 'm11-frost-titan',
  name: 'Frost Titan',
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 55 },
  manaCost: { generic: 4, U: 2 },
  colors: ['U'],
  subtypes: ['Giant'],
  power: 6,
  toughness: 6,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfBecomesTargetByOpponent',
      effects: [],
      counterTriggeringSpellOrAbilityUnless: { cost: { generic: 2 } },
    },
    {
      kind: 'triggered',
      condition: 'selfEntersOrAttacks',
      effects: [
        {
          kind: 'tapPermanent',
          target: { kind: 'targetPermanent' },
          doesNotUntap: true,
        },
      ],
    },
  ],
});

const AIM = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }],
} satisfies AbilityInput;

function passUntilNotPriority(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 30; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    if (current.state.stack.length === 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('the Frost Titan stack did not settle');
}

function targetingSpellBoard(payerLands: number): {
  readonly paused: ReduceResult;
  readonly frost: ObjectId;
  readonly spell: ObjectId;
} {
  const glance = instant('Icy Glance', [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }], {});
  const start = scenario({
    battlefield: [
      { card: FROST_TITAN, controller: 1 },
      ...lands(FOREST, payerLands).map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [[glance], []],
  });
  const frost = oidOf(start.state, 'Frost Titan');
  const spell = handOidOf(start.state, 0, 'Icy Glance');
  const cast = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: spell,
    targets: [{ kind: 'permanent', oid: frost }],
  });
  return { paused: passUntilNotPriority(cast), frost, spell };
}

describe("Frost Titan's target toll", () => {
  it('asks the opposing spell controller and preserves that spell when they pay {2}', () => {
    const { paused, spell } = targetingSpellBoard(2);
    const decision = pendingDecision(paused.state);
    if (decision?.kind !== 'unless') throw new Error('Frost Titan did not ask for its toll');
    expect(decision.player).toBe(0);
    expect(decision.cost.generic).toBe(2);
    const trigger = decision.oid;

    const paid = apply(paused, { type: 'answerUnless', player: 0, oid: trigger, pay: true });
    expect(paid.state.stack.map((entry) => entry.oid)).toContain(spell);
    expect(eventsOfType(paid.events, 'unlessPaid')).toEqual([
      expect.objectContaining({ oid: trigger, source: expect.any(String) }),
    ]);
    expect(eventsOfType(paid.events, 'spellCountered')).toHaveLength(0);
  });

  it('counters the opposing spell when the controller declines or cannot pay', () => {
    const payable = targetingSpellBoard(2);
    const decision = pendingDecision(payable.paused.state);
    if (decision?.kind !== 'unless') throw new Error('Frost Titan did not ask for its toll');
    const declined = apply(payable.paused, {
      type: 'answerUnless',
      player: 0,
      oid: decision.oid,
      pay: false,
    });
    expect(declined.state.objects[payable.spell]?.zone).toBe('graveyard');
    expect(eventsOfType(declined.events, 'spellCountered').map((event) => event.oid)).toContain(
      payable.spell,
    );

    const unaffordable = targetingSpellBoard(0);
    expect(pendingDecision(unaffordable.paused.state)?.kind).toBe('priority');
    expect(unaffordable.paused.state.objects[unaffordable.spell]?.zone).toBe('graveyard');
    expect(eventsOfType(unaffordable.paused.events, 'spellCountered').map((event) => event.oid)).toContain(
      unaffordable.spell,
    );
  });

  it('does not trigger on a spell controlled by Frost Titan’s controller', () => {
    const glance = instant(
      'Friendly Glance',
      [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }],
      {},
    );
    const start = scenario({
      active: 1,
      battlefield: [{ card: FROST_TITAN, controller: 1 }],
      hands: [[], [glance]],
    });
    const frost = oidOf(start.state, 'Frost Titan');
    const cast = apply(start, {
      type: 'castSpell',
      player: 1,
      oid: handOidOf(start.state, 1, 'Friendly Glance'),
      targets: [{ kind: 'permanent', oid: frost }],
    });
    expect(
      eventsOfType(cast.events, 'abilityTriggered').filter(
        (event) => event.source === frost && event.condition === 'selfBecomesTargetByOpponent',
      ),
    ).toHaveLength(0);
  });

  it('counters an opposing activated ability without calling it a spell', () => {
    const start = scenario({
      battlefield: [
        { card: artifact('Aiming Lens', {}, [AIM]), controller: 0 },
        { card: FROST_TITAN, controller: 1 },
      ],
    });
    const frost = oidOf(start.state, 'Frost Titan');
    const aimed = apply(start, {
      type: 'activateAbility',
      player: 0,
      oid: oidOf(start.state, 'Aiming Lens'),
      abilityIndex: 0,
      targets: [{ kind: 'permanent', oid: frost }],
      sacrifices: [],
    });
    const activation = eventsOfType(aimed.events, 'abilityActivated')[0]?.oid;
    if (activation === undefined) throw new Error('the targeting ability was not activated');
    const settled = passUntilNotPriority(aimed);
    expect(settled.state.stack.some((entry) => entry.oid === activation)).toBe(false);
    expect(eventsOfType(settled.events, 'abilityCountered').map((event) => event.oid)).toContain(activation);
    expect(eventsOfType(settled.events, 'spellCountered')).toHaveLength(0);
  });
});

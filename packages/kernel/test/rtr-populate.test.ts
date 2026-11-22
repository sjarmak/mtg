/** CR 701.30: a non-targeting creature-token copy choice during resolution. */
import { describe, expect, it } from 'vitest';
import type { Decision, ReduceResult } from '@mtg/kernel';
import { getObject, ownedDecision, pendingDecision, scenario } from '@mtg/kernel';
import { creature, FOREST, lands, PLAINS, sorcery } from './cards';
import { apply, handOidOf } from './helpers';

const SKY_TOKEN = creature('Sky Token', 2, 2, { keywords: ['flying'] });
const ORDINARY_CREATURE = creature('Ordinary Creature', 3, 3);
const POPULATE_THEN_GAIN = sorcery(
  'Populate Then Gain',
  [{ kind: 'populate' }, { kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
  { generic: 1, G: 1 },
);
const MAKE_THEN_POPULATE = sorcery(
  'Make Then Populate',
  [
    {
      kind: 'createToken',
      count: 1,
      token: {
        name: 'Watching Bird',
        power: 1,
        toughness: 1,
        colors: ['W'],
        subtypes: ['Bird'],
        keywords: ['flying'],
        abilities: [
          {
            kind: 'triggered',
            condition: 'selfEnters',
            effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
          },
        ],
      },
    },
    { kind: 'populate' },
    { kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } },
  ],
  { generic: 2, W: 1 },
);

function castAndResolve(
  battlefield: NonNullable<NonNullable<Parameters<typeof scenario>[0]>['battlefield']>,
): ReduceResult {
  let current = scenario({
    battlefield: [...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })), ...battlefield],
    hands: [[POPULATE_THEN_GAIN], []],
  });
  current = apply(current, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(current.state, 0, POPULATE_THEN_GAIN.name),
    targets: [null, null],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

function populateDecision(current: ReduceResult): Extract<Decision, { kind: 'populate' }> {
  const decision = ownedDecision(current.state);
  if (decision?.kind !== 'populate') {
    throw new Error('Populate choice was not pending');
  }
  return decision;
}

describe('Populate resolution', () => {
  it('is a successful no-op with no eligible creature token and continues the spell', () => {
    const done = castAndResolve([{ card: ORDINARY_CREATURE, controller: 0 }]);

    expect(done.state.players[0].life).toBe(22);
    expect(pendingDecision(done.state)?.kind).toBe('priority');
  });

  it('offers exactly the controlled creature tokens without targeting them', () => {
    const asked = castAndResolve([
      { card: SKY_TOKEN, controller: 0, token: true },
      { card: ORDINARY_CREATURE, controller: 0 },
      { card: SKY_TOKEN, controller: 1, token: true },
    ]);
    const ownToken = asked.state.battlefield.find(
      (oid) => getObject(asked.state, oid).controller === 0 && getObject(asked.state, oid).token,
    );
    if (ownToken === undefined) throw new Error('controlled token was absent');

    const decision = populateDecision(asked);
    expect(decision.player).toBe(0);
    expect(decision.options.filter((option) => option.type === 'choosePopulateToken')).toEqual([
      { type: 'choosePopulateToken', player: 0, token: ownToken },
    ]);
    expect(decision.options.at(-1)).toEqual({ type: 'concede', player: 0 });
  });

  it('copies copiable values but none of the token permanent state, then resumes', () => {
    const asked = castAndResolve([{ card: SKY_TOKEN, controller: 0, token: true, tapped: true, damage: 1 }]);
    const decision = populateDecision(asked);
    const source = decision.options[0];
    if (source === undefined || source.type !== 'choosePopulateToken')
      throw new Error('Populate offered no token');
    const done = apply(asked, source);
    const copies = done.state.battlefield.filter(
      (oid) => getObject(done.state, oid).card.name === SKY_TOKEN.name,
    );
    const created = copies.find((oid) => oid !== source.token);
    if (created === undefined) throw new Error('Populate created no copy');

    expect(getObject(done.state, created)).toMatchObject({
      token: true,
      controller: 0,
      tapped: false,
      damage: 0,
    });
    expect(getObject(done.state, created).card).toEqual(getObject(done.state, source.token).card);
    expect(done.state.players[0].life).toBe(22);
  });

  it('banks entry triggers until the Populate answer and the remaining instructions finish', () => {
    let current = scenario({
      battlefield: lands(PLAINS, 3).map((card) => ({ card, controller: 0 as const })),
      hands: [[MAKE_THEN_POPULATE], []],
    });
    current = apply(current, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(current.state, 0, MAKE_THEN_POPULATE.name),
      targets: [null, null, null],
    });
    current = apply(current, { type: 'passPriority', player: 0 });
    const asked = apply(current, { type: 'passPriority', player: 1 });
    const decision = populateDecision(asked);

    expect(asked.state.stack).toEqual([]);
    expect(asked.state.players[0].life).toBe(20);

    const answer = decision.options[0];
    if (answer === undefined) throw new Error('Populate offered no created token');
    const resumed = apply(asked, answer);
    expect(resumed.state.players[0].life).toBe(22);
    expect(resumed.state.stack).toHaveLength(2);
  });
});

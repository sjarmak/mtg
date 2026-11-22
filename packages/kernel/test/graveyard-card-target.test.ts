/** Enumeration, recheck, and movement for a true graveyard-card target. */
import { describe, expect, it } from 'vitest';
import { PERMANENT_CARD_KINDS, parseCard, type CardInput } from '@mtg/dsl';
import {
  eventsOfType,
  characteristicsOf,
  controllerOf,
  legalActions,
  pendingDecision,
  playerOf,
  reduce,
  scenario,
  targetChoicesForActivation,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { artifact, creature } from './cards';
import { apply, oidOf } from './helpers';

const RECALL_POST = parseCard({
  kind: 'artifact',
  id: 'tst-recall-post',
  name: 'Recall Post',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 1 },
  colors: [],
  manaCost: { generic: 4 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [
        {
          kind: 'returnToHand',
          target: { kind: 'targetCardInYourGraveyard', filter: { cardTypes: ['artifact'] } },
        },
      ],
    },
  ],
} as CardInput);

const TORMOD = parseCard({
  kind: 'artifact',
  id: 'tst-tormod',
  name: "Tormod's Crypt",
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 2 },
  colors: [],
  manaCost: { generic: 0 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true, sacrificeSelf: true },
      effects: [{ kind: 'exileGraveyard', target: { kind: 'targetPlayer' } }],
    },
  ],
} as CardInput);

const RELIC = artifact('Buried Relic');
const BODY = creature('Buried Body', 2, 2);
const THEIR_BODY = creature('Their Buried Body', 3, 3, { subtypes: ['Warrior'] });
const EXPENSIVE_BODY = creature('Expensive Buried Body', 4, 4, { cost: { generic: 4 } });

const GRAVE_LIFTER = parseCard({
  kind: 'artifact',
  id: 'tst-grave-lifter',
  name: 'Grave Lifter',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 3 },
  colors: [],
  manaCost: { generic: 4 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [
        {
          kind: 'returnFromGraveyard',
          target: { kind: 'targetCardInAGraveyard', filter: { cardTypes: ['creature'] } },
          control: 'you',
          alsoBecomes: { colors: ['B'], subtypes: ['Zombie'] },
        },
      ],
    },
  ],
} as CardInput);

const TITAN_LIFTER = parseCard({
  kind: 'artifact',
  id: 'tst-titan-lifter',
  name: 'Titan Lifter',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 4 },
  colors: [],
  manaCost: { generic: 4 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [
        {
          kind: 'returnFromGraveyard',
          target: {
            kind: 'targetCardInYourGraveyard',
            filter: { cardTypes: [...PERMANENT_CARD_KINDS], maxManaValue: 3 },
          },
        },
      ],
    },
  ],
} as CardInput);

function opening(): ReduceResult {
  return scenario({
    battlefield: [
      { card: RECALL_POST, controller: 0 },
      { card: TORMOD, controller: 1 },
    ],
    graveyards: [[RELIC, BODY], []],
  });
}

function eitherGraveyardOpening(): ReduceResult {
  return scenario({
    battlefield: [{ card: GRAVE_LIFTER, controller: 0 }],
    graveyards: [[BODY, RELIC], [THEIR_BODY]],
  });
}

function boundedOpening(): ReduceResult {
  return scenario({
    battlefield: [{ card: TITAN_LIFTER, controller: 0 }],
    graveyards: [[BODY, RELIC, EXPENSIVE_BODY], []],
  });
}

function activation(
  state: GameState,
  source: ObjectId,
  player: 0 | 1,
  target: (
    candidate: NonNullable<Extract<Action, { type: 'activateAbility' }>['targets'][number]>,
  ) => boolean,
): Extract<Action, { type: 'activateAbility' }> {
  const action = legalActions(state).find(
    (candidate): candidate is Extract<Action, { type: 'activateAbility' }> => {
      const aimed = candidate.type === 'activateAbility' ? candidate.targets[0] : undefined;
      return (
        candidate.type === 'activateAbility' &&
        candidate.player === player &&
        candidate.oid === source &&
        aimed !== undefined &&
        aimed !== null &&
        target(aimed)
      );
    },
  );
  if (action === undefined) throw new Error('expected activation was not offered');
  return action;
}

function resolveAll(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 12 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('graveyard-target probe lost priority');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  if (current.state.stack.length > 0) throw new Error('graveyard-target probe did not resolve');
  return current;
}

describe('a targeted card in your graveyard', () => {
  it('enumerates only matching cards in the activating controller’s graveyard', () => {
    const start = opening();
    const source = oidOf(start.state, RECALL_POST.name);
    const ability = RECALL_POST.abilities[0];
    if (ability?.kind !== 'activated') throw new Error('probe lost its activated ability');
    const relic = playerOf(start.state, 0).graveyard.find(
      (oid) => start.state.objects[oid]?.card.name === RELIC.name,
    );
    if (relic === undefined) throw new Error('probe lost its artifact card');

    expect(targetChoicesForActivation(start.state, ability, 0, source)).toEqual([
      [{ kind: 'card', oid: relic }],
    ]);
  });

  it('enumerates matching cards across both graveyards and reanimates the chosen incarnation', () => {
    const start = eitherGraveyardOpening();
    const source = oidOf(start.state, GRAVE_LIFTER.name);
    const ability = GRAVE_LIFTER.abilities[0];
    if (ability?.kind !== 'activated') throw new Error('probe lost its activated ability');
    const ours = playerOf(start.state, 0).graveyard.find(
      (oid) => start.state.objects[oid]?.card.name === BODY.name,
    );
    const theirs = playerOf(start.state, 1).graveyard.find(
      (oid) => start.state.objects[oid]?.card.name === THEIR_BODY.name,
    );
    if (ours === undefined || theirs === undefined) throw new Error('probe lost a graveyard creature');

    expect(targetChoicesForActivation(start.state, ability, 0, source)).toEqual([
      [
        { kind: 'card', oid: ours },
        { kind: 'card', oid: theirs },
      ],
    ]);

    const done = resolveAll(
      reduce(
        start.state,
        activation(start.state, source, 0, (target) => target.kind === 'card' && target.oid === theirs),
      ),
    );
    expect(done.state.objects[theirs]?.zone).toBe('battlefield');
    expect(controllerOf(done.state, theirs)).toBe(0);
    expect(characteristicsOf(done.state, theirs).colors).toContain('B');
    expect(characteristicsOf(done.state, theirs).subtypes).toEqual(['Warrior', 'Zombie']);
    expect(pendingDecision(done.state)?.kind).not.toBe('graveyardChoice');
  });

  it('enumerates only permanent cards within the printed mana-value bound', () => {
    const start = boundedOpening();
    const source = oidOf(start.state, TITAN_LIFTER.name);
    const ability = TITAN_LIFTER.abilities[0];
    if (ability?.kind !== 'activated') throw new Error('probe lost its activated ability');

    const names = targetChoicesForActivation(start.state, ability, 0, source)
      .flat()
      .flatMap((target) => (target?.kind === 'card' ? [start.state.objects[target.oid]?.card.name] : []));

    expect(names).toEqual([BODY.name, RELIC.name]);
    expect(names).not.toContain(EXPENSIVE_BODY.name);
  });

  it('returns the chosen card without opening a resolution-time choice', () => {
    const start = opening();
    const source = oidOf(start.state, RECALL_POST.name);
    const activated = reduce(
      start.state,
      activation(start.state, source, 0, (target) => target.kind === 'card'),
    );
    const done = resolveAll(activated);

    expect(playerOf(done.state, 0).hand.map((oid) => done.state.objects[oid]?.card.name)).toContain(
      RELIC.name,
    );
    expect(pendingDecision(done.state)?.kind).not.toBe('graveyardChoice');
  });

  it('fizzles when an opponent exiles the targeted card in response', () => {
    let current = opening();
    const post = oidOf(current.state, RECALL_POST.name);
    const crypt = oidOf(current.state, TORMOD.name);
    current = apply(
      current,
      activation(current.state, post, 0, (target) => target.kind === 'card'),
    );
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(
      current,
      activation(current.state, crypt, 1, (target) => target.kind === 'player' && target.player === 0),
    );
    const done = resolveAll(current);

    expect(playerOf(done.state, 0).hand.map((oid) => done.state.objects[oid]?.card.name)).not.toContain(
      RELIC.name,
    );
    expect(eventsOfType(done.events, 'effectSkipped')).toContainEqual(
      expect.objectContaining({ why: 'target is no longer legal' }),
    );
  });
});

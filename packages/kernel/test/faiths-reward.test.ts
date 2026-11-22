/** Native Faith's Reward execution across ownership, turn, and CR 400.7 boundaries. */
import { parseCard, type Card, type CardInput, type Effect } from '@mtg/dsl';
import {
  beginTrace,
  attachmentOf,
  cleanupTurnEffects,
  collectTriggers,
  counterCount,
  eventsOfType,
  legalActions,
  moveObject,
  moveObjectsToBattlefieldSimultaneously,
  pendingDecision,
  powerOf,
  reduce,
  scenario,
  validateAction,
  type GameState,
  type ObjectId,
  type Trace,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { applyEffect } from '../src/effects';
import { attachAuraTo } from '../src/attach';
import { answerEntryAura, answerEntryTimestampNext } from '../src/zones';
import { artifact, creature, ISLAND, lands, PLAINS, sorcery } from './cards';
import { controlledBy, onlyObject, retype, withContinuous } from './continuous-helpers';
import { apply, handOidOf, oidOf } from './helpers';

const FAITHS_REWARD = parseCard({
  kind: 'instant',
  id: 'm13-14-faiths-reward-kernel',
  name: "Faith's Reward",
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 14 },
  colors: ['W'],
  manaCost: { generic: 3, W: 1 },
  effects: [
    {
      kind: 'returnFromGraveyard',
      fromBattlefieldThisTurn: true,
      target: { kind: 'noTarget' },
    },
  ],
} as CardInput);

const LEYLINE = parseCard({
  kind: 'enchantment',
  id: 'tst-faiths-reward-leyline',
  name: 'Reward Void Leyline',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  colors: ['B'],
  manaCost: { generic: 2, B: 2 },
  abilities: [
    {
      kind: 'staticPlayerRule',
      players: 'eachOpponent',
      rule: 'cardsToGraveyardAreExiled',
    },
  ],
});

const REWARD_CHECKLAND = parseCard({
  kind: 'land',
  id: 'tst-faiths-reward-checkland',
  name: 'Reward Checkland',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 3 },
  producesMana: ['U'],
  entryReplacement: {
    kind: 'entersTappedUnlessControlsLandSubtype',
    landTypes: ['Island'],
  },
});

const REWARD_HEALER = parseCard({
  kind: 'creature',
  id: 'tst-faiths-reward-healer',
  name: 'Reward Cohort Healer',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 11 },
  manaCost: { generic: 3, W: 1 },
  colors: ['W'],
  subtypes: ['Cleric'],
  power: 2,
  toughness: 3,
  abilities: [
    {
      kind: 'triggered',
      condition: 'anotherControlledCreatureEnters',
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

const REWARD_AURA = parseCard({
  kind: 'enchantment',
  id: 'tst-faiths-reward-aura',
  name: 'Reward Returning Aura',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 12 },
  manaCost: { W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [{ kind: 'statBonus', power: 1, toughness: 1 }],
  },
});

const REWARD_MIND_CONTROL = parseCard({
  kind: 'enchantment',
  id: 'tst-faiths-reward-mind-control',
  name: 'Reward Mind Control',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 14 },
  manaCost: { generic: 3, U: 2 },
  colors: ['U'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [{ kind: 'gainControl' }],
  },
});

function rewardShapeshifter(name: string, collectorNumber: number): Card {
  return parseCard({
    kind: 'creature',
    id: `tst-faiths-reward-shapeshifter-${String(collectorNumber)}`,
    name,
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber },
    manaCost: { generic: 4 },
    colors: [],
    subtypes: ['Shapeshifter'],
    power: 0,
    toughness: 0,
    entryReplacement: {
      kind: 'entersAsCharacteristicChoice',
      modes: [
        { power: 3, toughness: 3 },
        { power: 2, toughness: 2, addKeywords: ['flying'] },
      ],
    },
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
    ],
  });
}

const REWARD_SHAPESHIFTER_ONE = rewardShapeshifter('First Reward Shapeshifter', 4);
const REWARD_SHAPESHIFTER_TWO = rewardShapeshifter('Second Reward Shapeshifter', 5);

function rewardClone(name: string, collectorNumber: number): Card {
  return parseCard({
    kind: 'creature',
    id: `tst-faiths-reward-clone-${String(collectorNumber)}`,
    name,
    rarity: 'rare',
    set: { code: 'TST', collectorNumber },
    manaCost: { generic: 3, U: 1 },
    colors: ['U'],
    subtypes: ['Shapeshifter'],
    power: 0,
    toughness: 0,
    entryReplacement: { kind: 'entersAsCopyOfCreature' },
  });
}

function rewardLich(name: string, collectorNumber: number): Card {
  return parseCard({
    kind: 'creature',
    id: `tst-faiths-reward-lich-${String(collectorNumber)}`,
    name,
    rarity: 'rare',
    set: { code: 'TST', collectorNumber },
    manaCost: { B: 3 },
    colors: ['B'],
    subtypes: ['Zombie'],
    power: 5,
    toughness: 5,
    entryReplacement: {
      kind: 'putCounterOnControlledPermanent',
      permanentType: 'artifact',
      counter: 'phylactery',
      count: 1,
    },
  });
}

const REWARD_CLONE_ONE = rewardClone('First Reward Clone', 7);
const REWARD_CLONE_TWO = rewardClone('Second Reward Clone', 8);
const REWARD_LICH_ONE = rewardLich('First Reward Lich', 9);
const REWARD_LICH_TWO = rewardLich('Second Reward Lich', 10);

const REWARD_THEN_GAIN = parseCard({
  kind: 'instant',
  id: 'tst-faiths-reward-then-gain',
  name: 'Reward Then Gain',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 6 },
  colors: ['W'],
  manaCost: { generic: 3, W: 1 },
  effects: [
    { kind: 'returnFromGraveyard', fromBattlefieldThisTurn: true, target: { kind: 'noTarget' } },
    { kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } },
  ],
});

const RETURN_AURA_THEN_GAIN = parseCard({
  kind: 'instant',
  id: 'tst-return-aura-then-gain',
  name: 'Return Aura Then Gain',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 13 },
  colors: ['W'],
  manaCost: { generic: 3, W: 1 },
  effects: [
    {
      kind: 'returnFromGraveyard',
      target: {
        kind: 'targetCardInYourGraveyard',
        filter: { cardTypes: ['enchantment'] },
      },
    },
    { kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } },
  ],
});

const RETURN_EFFECT: Effect = FAITHS_REWARD.effects[0] as Effect;

function reward(trace: Trace): Trace {
  const source = handOidOf(trace.state, 0, FAITHS_REWARD.name);
  let current = applyEffect(trace, source, 0, RETURN_EFFECT, null, trace.events.length);
  while (pendingDecision(current.state)?.kind === 'entryTimestampOrder') {
    const action = legalActions(current.state).find(
      (candidate) => candidate.type === 'chooseEntryTimestampNext',
    );
    if (action === undefined) throw new Error('missing entry timestamp choice');
    current = answerEntryTimestampNext(current, action.oid);
  }
  return current;
}

function finishTimestampDecisions(initial: ReturnType<typeof reduce>): ReturnType<typeof reduce> {
  let current = initial;
  const events = [...initial.events];
  while (pendingDecision(current.state)?.kind === 'entryTimestampOrder') {
    const action = legalActions(current.state).find(
      (candidate) => candidate.type === 'chooseEntryTimestampNext',
    );
    if (action === undefined) throw new Error('missing entry timestamp choice');
    current = reduce(current.state, action);
    events.push(...current.events);
  }
  return { state: current.state, events };
}

function objectOid(state: GameState, card: Card): ObjectId {
  const matches = Object.values(state.objects).filter((object) => object.card.id === card.id);
  const first = matches[0];
  if (first === undefined) throw new Error(`missing ${card.name}`);
  if (matches.length !== 1) throw new Error(`ambiguous ${card.name}`);
  return first.oid;
}

describe("Faith's Reward resolution", () => {
  it('returns only owned nontoken permanents that moved from the battlefield this turn', () => {
    const creatureCard = creature('Rewarded Creature', 2, 2);
    const artifactCard = artifact('Rewarded Artifact');
    const oldPermanent = creature('Old Graveyard Creature', 1, 1);
    const spentSpell = sorcery('Old Graveyard Spell', [{ kind: 'shuffleLibrary' }], { U: 1 });
    const tokenCard = creature('Rewarded Token', 1, 1);
    const stolenCard = creature('Opponent-Owned Stolen Creature', 3, 3);
    const start = scenario({
      battlefield: [
        { card: creatureCard, controller: 0 },
        { card: artifactCard, controller: 0 },
        { card: tokenCard, controller: 0, token: true },
        { card: stolenCard, controller: 1 },
      ],
      hands: [[FAITHS_REWARD], []],
      graveyards: [[oldPermanent, spentSpell], []],
    });
    const creatureOid = oidOf(start.state, creatureCard.name);
    const artifactOid = oidOf(start.state, artifactCard.name);
    const tokenOid = oidOf(start.state, tokenCard.name);
    const stolenOid = oidOf(start.state, stolenCard.name);
    let current = beginTrace(withContinuous(start.state, [controlledBy(onlyObject(stolenOid), 0)]));
    for (const oid of [creatureOid, artifactOid, tokenOid, stolenOid]) {
      current = moveObject(current, oid, 'graveyard');
    }

    const done = reward(current);

    expect(done.state.objects[creatureOid]?.zone).toBe('battlefield');
    expect(done.state.objects[artifactOid]?.zone).toBe('battlefield');
    expect(done.state.objects[tokenOid]?.zone).toBe('graveyard');
    expect(done.state.objects[stolenOid]?.zone).toBe('graveyard');
    expect(done.state.players[0].graveyard.map((oid) => done.state.objects[oid]?.card.name)).toEqual([
      oldPermanent.name,
      spentSpell.name,
      tokenCard.name,
    ]);
    expect(done.state.players[1].graveyard.map((oid) => done.state.objects[oid]?.card.name)).toEqual([
      stolenCard.name,
    ]);
    expect(eventsOfType(done.events, 'permanentEntered').map((event) => event.oid)).toEqual([
      creatureOid,
      artifactOid,
    ]);
  });

  it('does not follow a card through a later graveyard incarnation or across cleanup', () => {
    const departed = creature('Departed Reward', 2, 2);
    const expired = artifact('Expired Reward');
    const start = scenario({
      battlefield: [
        { card: departed, controller: 0 },
        { card: expired, controller: 0 },
      ],
      hands: [[FAITHS_REWARD], []],
    });
    const departedOid = oidOf(start.state, departed.name);
    const expiredOid = oidOf(start.state, expired.name);
    let current = moveObject(beginTrace(start.state), departedOid, 'graveyard');
    current = moveObject(current, departedOid, 'hand');
    current = moveObject(current, departedOid, 'graveyard');
    current = moveObject(current, expiredOid, 'graveyard');
    current = cleanupTurnEffects(current);

    const done = reward(current);

    expect(done.state.objects[departedOid]?.zone).toBe('graveyard');
    expect(done.state.objects[expiredOid]?.zone).toBe('graveyard');
    expect(eventsOfType(done.events, 'permanentEntered')).toEqual([]);
  });

  it('records the final replaced destination rather than the requested graveyard', () => {
    const body = creature('Exiled Reward', 2, 2);
    const start = scenario({
      battlefield: [
        { card: body, controller: 0 },
        { card: LEYLINE, controller: 1 },
      ],
      hands: [[FAITHS_REWARD], []],
    });
    const bodyOid = objectOid(start.state, body);
    const moved = moveObject(beginTrace(start.state), bodyOid, 'graveyard');

    const done = reward(moved);

    expect(done.state.objects[bodyOid]?.zone).toBe('exile');
    expect(eventsOfType(done.events, 'replacementApplied')).toHaveLength(1);
    expect(eventsOfType(done.events, 'permanentEntered')).toEqual([]);
  });

  it('determines every entry replacement from the shared pre-entry battlefield', () => {
    const start = scenario({
      battlefield: [
        { card: ISLAND, controller: 0 },
        { card: REWARD_CHECKLAND, controller: 0 },
      ],
      hands: [[FAITHS_REWARD], []],
    });
    const island = oidOf(start.state, ISLAND.name);
    const checkland = oidOf(start.state, REWARD_CHECKLAND.name);
    let current = moveObject(beginTrace(start.state), island, 'graveyard');
    current = moveObject(current, checkland, 'graveyard');

    const done = reward(current);

    expect(done.state.objects[island]?.zone).toBe('battlefield');
    expect(done.state.objects[checkland]?.zone).toBe('battlefield');
    expect(done.state.objects[checkland]?.tapped).toBe(true);
  });

  for (const departureOrder of ['companion-first', 'healer-first'] as const) {
    it(`evaluates cross-entry triggers against the final cohort when ${departureOrder}`, () => {
      const companion = creature(`Reward Cohort Companion ${departureOrder}`, 2, 2);
      const battlefield =
        departureOrder === 'companion-first'
          ? [
              { card: companion, controller: 0 as const },
              { card: REWARD_HEALER, controller: 0 as const },
            ]
          : [
              { card: REWARD_HEALER, controller: 0 as const },
              { card: companion, controller: 0 as const },
            ];
      const start = scenario({ battlefield, hands: [[FAITHS_REWARD], []] });
      const companionOid = objectOid(start.state, companion);
      const healerOid = objectOid(start.state, REWARD_HEALER);
      const ordered =
        departureOrder === 'companion-first' ? [companionOid, healerOid] : [healerOid, companionOid];
      let current = beginTrace(start.state);
      for (const oid of ordered) current = moveObject(current, oid, 'graveyard');
      const eventStart = current.events.length;

      const done = reward(current);
      const triggers = collectTriggers(done, eventStart);

      expect(
        eventsOfType(done.events.slice(eventStart), 'permanentEntered').map((event) => event.oid),
      ).toEqual(ordered);
      expect(triggers.map((trigger) => trigger.sourceOid)).toEqual([healerOid]);
    });
  }

  it('banks a legal non-targeted Aura attachment before returning it', () => {
    const host = creature('Reward Aura Host', 2, 2);
    const start = scenario({
      battlefield: [
        { card: host, controller: 0 },
        { card: REWARD_AURA, controller: 0 },
      ],
      hands: [[FAITHS_REWARD], []],
    });
    const hostOid = objectOid(start.state, host);
    const auraOid = objectOid(start.state, REWARD_AURA);
    const attached = attachAuraTo(beginTrace(start.state), auraOid, hostOid);
    const buried = moveObject(attached, auraOid, 'graveyard');

    const stopped = reward(buried);

    expect(pendingDecision(stopped.state)).toMatchObject({
      kind: 'entryAura',
      oid: auraOid,
      permanents: [hostOid],
    });
    expect(stopped.state.objects[auraOid]?.zone).toBe('graveyard');

    const choice = legalActions(stopped.state).find(
      (action) => action.type === 'chooseEntryAuraHost' && action.host === hostOid,
    );
    if (choice === undefined) throw new Error('missing Aura entry host choice');
    const answered = answerEntryAura(stopped, hostOid);
    const enteredIndex = answered.events.findIndex(
      (event) => event.type === 'permanentEntered' && event.oid === auraOid,
    );
    expect(enteredIndex).toBeGreaterThanOrEqual(0);
    expect(answered.eventStates?.[enteredIndex]?.objects[auraOid]?.attachedTo).toBe(hostOid);
    const done = reduce(stopped.state, choice);

    expect(done.state.objects[auraOid]?.zone).toBe('battlefield');
    expect(attachmentOf(done.state, auraOid)).toBe(hostOid);
    expect(powerOf(done.state, hostOid)).toBe(3);
  });

  it('treats a non-spell Aura host choice as public and non-targeted', () => {
    const ordinary = creature('Reward Ordinary Host', 2, 2);
    const hexproof = creature('Reward Hexproof Host', 2, 2, {
      keywordAbilities: [{ kind: 'hexproof' }],
    });
    const shrouded = creature('Reward Shrouded Host', 2, 2, {
      keywordAbilities: [{ kind: 'shroud' }],
    });
    const protectedHost = creature('Reward Protected Host', 2, 2, {
      keywordAbilities: [{ kind: 'protection', quality: { kind: 'color', color: 'W' } }],
    });
    const opponentHost = creature('Reward Opponent Host', 2, 2);
    const start = scenario({
      battlefield: [
        { card: ordinary, controller: 0 },
        { card: hexproof, controller: 0 },
        { card: shrouded, controller: 0 },
        { card: protectedHost, controller: 0 },
        { card: opponentHost, controller: 1 },
        { card: REWARD_AURA, controller: 0 },
      ],
      hands: [[FAITHS_REWARD], []],
    });
    const auraOid = objectOid(start.state, REWARD_AURA);
    const ordinaryOid = objectOid(start.state, ordinary);
    const hexproofOid = objectOid(start.state, hexproof);
    const shroudedOid = objectOid(start.state, shrouded);
    const protectedOid = objectOid(start.state, protectedHost);
    const opponentOid = objectOid(start.state, opponentHost);
    const buried = moveObject(
      attachAuraTo(beginTrace(start.state), auraOid, ordinaryOid),
      auraOid,
      'graveyard',
    );
    const battlefieldBefore = buried.state.battlefield;
    const graveyardBefore = buried.state.players[0].graveyard;

    const stopped = reward(buried);
    expect(pendingDecision(stopped.state)).toMatchObject({
      kind: 'entryAura',
      permanents: [ordinaryOid, hexproofOid, shroudedOid, opponentOid],
    });
    expect(stopped.state.battlefield).toEqual(battlefieldBefore);
    expect(stopped.state.players[0].graveyard).toEqual(graveyardBefore);
    expect(
      validateAction(stopped.state, {
        type: 'chooseEntryAuraHost',
        player: 0,
        oid: auraOid,
        host: protectedOid,
      }),
    ).toContain('not a legal Aura host');
    expect(
      validateAction(stopped.state, {
        type: 'chooseEntryAuraHost',
        player: 0,
        oid: ordinaryOid,
        host: ordinaryOid,
      }),
    ).toContain('not awaiting an entry host');

    const refused = moveObject(beginTrace(buried.state), auraOid, 'battlefield', {
      controller: 0,
      auraHost: protectedOid,
    });
    expect(refused.state.objects[auraOid]?.zone).toBe('graveyard');
    expect(refused.events).toEqual([]);
  });

  it('leaves an Aura in its graveyard when only its simultaneous cohort could host it', () => {
    const host = creature('Reward Departing Aura Host', 2, 2);
    const start = scenario({
      battlefield: [
        { card: host, controller: 0 },
        { card: REWARD_AURA, controller: 0 },
      ],
      hands: [[FAITHS_REWARD], []],
    });
    const hostOid = objectOid(start.state, host);
    const auraOid = objectOid(start.state, REWARD_AURA);
    let current = attachAuraTo(beginTrace(start.state), auraOid, hostOid);
    current = moveObject(current, auraOid, 'graveyard');
    current = moveObject(current, hostOid, 'graveyard');

    const done = reward(current);

    expect(done.state.objects[auraOid]?.zone).toBe('graveyard');
    expect(done.state.objects[hostOid]?.zone).toBe('battlefield');
    expect(pendingDecision(done.state)?.kind).not.toBe('entryAura');
  });

  it('banks every entry choice before the cohort enters and fires triggers afterward', () => {
    const start = scenario({
      battlefield: [
        { card: REWARD_SHAPESHIFTER_ONE, controller: 0 },
        { card: REWARD_SHAPESHIFTER_TWO, controller: 0 },
      ],
      hands: [[FAITHS_REWARD], []],
    });
    const first = objectOid(start.state, REWARD_SHAPESHIFTER_ONE);
    const second = objectOid(start.state, REWARD_SHAPESHIFTER_TWO);
    let current = moveObject(beginTrace(start.state), first, 'graveyard');
    current = moveObject(current, second, 'graveyard');

    const firstStop = reward(current);
    expect(pendingDecision(firstStop.state)).toMatchObject({ kind: 'entryCharacteristics', oid: first });
    expect(firstStop.state.battlefield).toEqual([]);

    const firstChoice = legalActions(firstStop.state).find(
      (action) => action.type === 'chooseEntryCharacteristics' && action.mode === 0,
    );
    if (firstChoice === undefined) throw new Error('missing first entry-characteristics choice');
    const secondStop = reduce(firstStop.state, firstChoice);
    expect(pendingDecision(secondStop.state)).toMatchObject({
      kind: 'entryCharacteristics',
      oid: second,
    });
    expect(secondStop.state.battlefield).toEqual([]);
    expect(secondStop.state.stack).toEqual([]);

    const secondChoice = legalActions(secondStop.state).find(
      (action) => action.type === 'chooseEntryCharacteristics' && action.mode === 1,
    );
    if (secondChoice === undefined) throw new Error('missing second entry-characteristics choice');
    const done = finishTimestampDecisions(reduce(secondStop.state, secondChoice));

    expect(done.state.battlefield).toEqual([first, second]);
    expect(done.state.stack.filter((entry) => entry.ability !== null)).toHaveLength(2);
    expect(eventsOfType(done.events, 'permanentEntered').map((event) => event.oid)).toEqual([first, second]);
  });

  it('resumes the remaining resolution only after the last entry choice', () => {
    const start = scenario({
      battlefield: [
        { card: REWARD_SHAPESHIFTER_ONE, controller: 0 },
        { card: REWARD_SHAPESHIFTER_TWO, controller: 0 },
        ...lands(PLAINS, 4).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[REWARD_THEN_GAIN], []],
    });
    const first = objectOid(start.state, REWARD_SHAPESHIFTER_ONE);
    const second = objectOid(start.state, REWARD_SHAPESHIFTER_TWO);
    let buried = moveObject(beginTrace(start.state), first, 'graveyard');
    buried = moveObject(buried, second, 'graveyard');
    let current = apply(buried, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(buried.state, 0, REWARD_THEN_GAIN.name),
      targets: [null, null],
    });
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });
    expect(pendingDecision(current.state)).toMatchObject({ kind: 'entryCharacteristics', oid: first });
    expect(current.state.players[0].life).toBe(20);

    const firstChoice = legalActions(current.state).find(
      (action) => action.type === 'chooseEntryCharacteristics' && action.mode === 0,
    );
    if (firstChoice === undefined) throw new Error('missing first resolving entry choice');
    current = reduce(current.state, firstChoice);
    expect(pendingDecision(current.state)).toMatchObject({ kind: 'entryCharacteristics', oid: second });
    expect(current.state.players[0].life).toBe(20);

    const secondChoice = legalActions(current.state).find(
      (action) => action.type === 'chooseEntryCharacteristics' && action.mode === 1,
    );
    if (secondChoice === undefined) throw new Error('missing second resolving entry choice');
    const done = finishTimestampDecisions(reduce(current.state, secondChoice));

    expect(done.state.players[0].life).toBe(22);
    expect(done.state.objects[handOidOf(start.state, 0, REWARD_THEN_GAIN.name)]?.zone).toBe('graveyard');
    expect(done.state.battlefield).toEqual(expect.arrayContaining([first, second]));
  });

  it('retains the resolution tail while a directly returned Aura chooses its host', () => {
    const host = creature('Direct Return Aura Host', 2, 2);
    const start = scenario({
      battlefield: [
        { card: host, controller: 0 },
        ...lands(PLAINS, 4).map((card) => ({ card, controller: 0 as const })),
      ],
      graveyards: [[REWARD_AURA], []],
      hands: [[RETURN_AURA_THEN_GAIN], []],
    });
    const hostOid = objectOid(start.state, host);
    const auraOid = objectOid(start.state, REWARD_AURA);
    const spellOid = handOidOf(start.state, 0, RETURN_AURA_THEN_GAIN.name);
    let current = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: spellOid,
      targets: [{ kind: 'card', oid: auraOid }, null],
    });
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });

    expect(pendingDecision(current.state)).toMatchObject({
      kind: 'entryAura',
      oid: auraOid,
      permanents: [hostOid],
    });
    expect(current.state.players[0].life).toBe(20);
    expect(current.state.objects[spellOid]?.zone).toBe('stack');

    const choice = legalActions(current.state).find(
      (action) => action.type === 'chooseEntryAuraHost' && action.host === hostOid,
    );
    if (choice === undefined) throw new Error('missing direct Aura entry host choice');
    const done = reduce(current.state, choice);

    expect(done.state.players[0].life).toBe(22);
    expect(done.state.objects[spellOid]?.zone).toBe('graveyard');
    expect(done.state.objects[auraOid]?.zone).toBe('battlefield');
    expect(attachmentOf(done.state, auraOid)).toBe(hostOid);
  });

  it('freezes copy candidates until every member has chosen', () => {
    const bear = creature('Reward Copy Bear', 2, 2);
    const start = scenario({
      battlefield: [
        { card: bear, controller: 0 },
        { card: REWARD_CLONE_ONE, controller: 0 },
        { card: REWARD_CLONE_TWO, controller: 0 },
      ],
      hands: [[FAITHS_REWARD], []],
    });
    const bearOid = oidOf(start.state, bear.name);
    const first = objectOid(start.state, REWARD_CLONE_ONE);
    const second = objectOid(start.state, REWARD_CLONE_TWO);
    let current = moveObject(beginTrace(start.state), first, 'graveyard');
    current = moveObject(current, second, 'graveyard');

    const firstStop = reward(current);
    expect(pendingDecision(firstStop.state)).toMatchObject({
      kind: 'entryCopy',
      oid: first,
      creatures: [bearOid],
    });
    const firstChoice = legalActions(firstStop.state).find(
      (action) => action.type === 'chooseEntryCopy' && action.copyOf === bearOid,
    );
    if (firstChoice === undefined) throw new Error('missing first copy choice');
    const secondStop = reduce(firstStop.state, firstChoice);
    expect(pendingDecision(secondStop.state)).toMatchObject({
      kind: 'entryCopy',
      oid: second,
      creatures: [bearOid],
    });
    expect(secondStop.state.battlefield).toEqual([bearOid]);

    const secondChoice = legalActions(secondStop.state).find(
      (action) => action.type === 'chooseEntryCopy' && action.copyOf === bearOid,
    );
    if (secondChoice === undefined) throw new Error('missing second copy choice');
    const done = finishTimestampDecisions(reduce(secondStop.state, secondChoice));

    expect(done.state.objects[first]?.copiableCard?.name).toBe(bear.name);
    expect(done.state.objects[second]?.copiableCard?.name).toBe(bear.name);
    expect(done.state.battlefield).toEqual([bearOid, first, second]);
  });

  it('banks every counter recipient before applying any entry counter', () => {
    const relic = artifact('Reward Phylactery Relic');
    const start = scenario({
      battlefield: [
        { card: relic, controller: 0 },
        { card: REWARD_LICH_ONE, controller: 0 },
        { card: REWARD_LICH_TWO, controller: 0 },
      ],
      hands: [[FAITHS_REWARD], []],
    });
    const relicOid = oidOf(start.state, relic.name);
    const first = objectOid(start.state, REWARD_LICH_ONE);
    const second = objectOid(start.state, REWARD_LICH_TWO);
    let current = moveObject(beginTrace(start.state), first, 'graveyard');
    current = moveObject(current, second, 'graveyard');

    const firstStop = reward(current);
    expect(pendingDecision(firstStop.state)).toMatchObject({
      kind: 'entryCounter',
      oid: first,
      permanents: [relicOid],
    });
    const firstChoice = legalActions(firstStop.state).find(
      (action) => action.type === 'chooseEntryCounterPermanent' && action.permanent === relicOid,
    );
    if (firstChoice === undefined) throw new Error('missing first entry-counter choice');
    const secondStop = reduce(firstStop.state, firstChoice);
    expect(pendingDecision(secondStop.state)).toMatchObject({
      kind: 'entryCounter',
      oid: second,
      permanents: [relicOid],
    });
    expect(counterCount(secondStop.state.objects[relicOid]!.counters, 'phylactery')).toBe(0);

    const secondChoice = legalActions(secondStop.state).find(
      (action) => action.type === 'chooseEntryCounterPermanent' && action.permanent === relicOid,
    );
    if (secondChoice === undefined) throw new Error('missing second entry-counter choice');
    const done = finishTimestampDecisions(reduce(secondStop.state, secondChoice));

    expect(counterCount(done.state.objects[relicOid]!.counters, 'phylactery')).toBe(2);
    expect(done.state.battlefield).toEqual([relicOid, first, second]);
  });

  it('uses chosen relative order inside APNAP timestamp groups', () => {
    const activeFirst = artifact('Reward Active First');
    const activeSecond = artifact('Reward Active Second');
    const nonactiveFirst = artifact('Reward Nonactive First');
    const nonactiveSecond = artifact('Reward Nonactive Second');
    const start = scenario({
      graveyards: [
        [activeFirst, activeSecond],
        [nonactiveFirst, nonactiveSecond],
      ],
      active: 0,
    });
    const activeFirstOid = objectOid(start.state, activeFirst);
    const activeSecondOid = objectOid(start.state, activeSecond);
    const nonactiveFirstOid = objectOid(start.state, nonactiveFirst);
    const nonactiveSecondOid = objectOid(start.state, nonactiveSecond);
    const stopped = moveObjectsToBattlefieldSimultaneously(beginTrace(start.state), [
      { oid: nonactiveFirstOid },
      { oid: activeFirstOid },
      { oid: nonactiveSecondOid },
      { oid: activeSecondOid },
    ]);

    expect(pendingDecision(stopped.state)).toMatchObject({
      kind: 'entryTimestampOrder',
      player: 0,
      ordered: [],
      remaining: [activeFirstOid, activeSecondOid],
    });
    expect(
      validateAction(stopped.state, {
        type: 'chooseEntryTimestampNext',
        player: 1,
        oid: activeSecondOid,
      }),
    ).toContain("player 0's decision");
    expect(
      validateAction(stopped.state, {
        type: 'chooseEntryTimestampNext',
        player: 0,
        oid: nonactiveFirstOid,
      }),
    ).toContain('not available');

    const nonactiveStop = answerEntryTimestampNext(stopped, activeSecondOid);
    expect(pendingDecision(nonactiveStop.state)).toMatchObject({
      kind: 'entryTimestampOrder',
      player: 1,
      ordered: [],
      remaining: [nonactiveFirstOid, nonactiveSecondOid],
    });
    expect(
      validateAction(nonactiveStop.state, {
        type: 'chooseEntryTimestampNext',
        player: 1,
        oid: activeSecondOid,
      }),
    ).toContain('not available');

    const done = answerEntryTimestampNext(nonactiveStop, nonactiveSecondOid);
    expect(done.state.battlefield).toEqual([
      activeSecondOid,
      activeFirstOid,
      nonactiveSecondOid,
      nonactiveFirstOid,
    ]);
    const timestamps = [activeSecondOid, activeFirstOid, nonactiveSecondOid, nonactiveFirstOid].map(
      (oid) => done.state.objects[oid]?.battlefieldTimestamp,
    );
    expect(timestamps.every((timestamp) => timestamp !== undefined)).toBe(true);
    expect(timestamps).toEqual([...timestamps].sort((left, right) => (left ?? 0) - (right ?? 0)));
  });

  it('keeps non-battlefield-duration source effects in the pre-entry view', () => {
    const start = scenario({
      battlefield: [{ card: PLAINS, controller: 0 }],
      graveyards: [[REWARD_CHECKLAND], []],
    });
    const plains = start.state.battlefield[0]!;
    const checkland = objectOid(start.state, REWARD_CHECKLAND);
    const state = withContinuous(start.state, [
      retype(onlyObject(plains), { addSubtypes: ['Island'] }, { source: checkland, duration: 'endOfTurn' }),
    ]);

    const done = moveObjectsToBattlefieldSimultaneously(beginTrace(state), [{ oid: checkland }]);

    expect(done.state.objects[checkland]?.tapped).toBe(false);
  });

  it('masks an earlier cohort Aura effect from later entry evaluation', () => {
    const start = scenario({
      battlefield: [
        { card: ISLAND, controller: 1 },
        { card: REWARD_MIND_CONTROL, controller: 0 },
        { card: REWARD_CHECKLAND, controller: 0 },
      ],
      hands: [[FAITHS_REWARD], []],
    });
    const island = start.state.battlefield[0]!;
    const aura = objectOid(start.state, REWARD_MIND_CONTROL);
    const checkland = objectOid(start.state, REWARD_CHECKLAND);
    const animated = withContinuous(start.state, [
      retype(onlyObject(island), { addTypes: ['creature'] }, { duration: 'endOfTurn' }),
    ]);
    let current = attachAuraTo(beginTrace(animated), aura, island);
    current = moveObject(current, aura, 'graveyard');
    current = moveObject(current, checkland, 'graveyard');

    const auraChoice = reward(current);
    expect(pendingDecision(auraChoice.state)).toMatchObject({ kind: 'entryAura', oid: aura });
    const timestampChoice = answerEntryAura(auraChoice, island);
    expect(pendingDecision(timestampChoice.state)).toMatchObject({
      kind: 'entryTimestampOrder',
      remaining: [aura, checkland],
    });
    const done = answerEntryTimestampNext(timestampChoice, aura);

    expect(done.state.objects[checkland]?.tapped).toBe(true);
  });
});

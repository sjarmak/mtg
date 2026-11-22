import { describe, expect, it } from 'vitest';
import { mana, parseCard, type Card } from '@mtg/dsl';
import {
  abilitiesOf,
  attachmentOf,
  characteristicsOf,
  counterCount,
  hasCardType,
  isCreatureObject,
  legalActions,
  moveObject,
  pendingDecision,
  planPayment,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  stateFingerprint,
  toughnessOf,
  type Action,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { beginTrace } from '@mtg/kernel';
import { creature, ISLAND, lands } from './cards';
import { copies, onlyObject, pump, retype, setPt, withContinuous } from './continuous-helpers';
import { handOidOf, oidOf } from './helpers';

const CLONE = parseCard({
  kind: 'creature',
  id: 'm11-clone',
  name: 'Clone',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 49 },
  manaCost: { generic: 3, U: 1 },
  colors: ['U'],
  subtypes: ['Shapeshifter'],
  power: 0,
  toughness: 0,
  entryReplacement: { kind: 'entersAsCopyOfCreature' },
});

const ARCHIVIST = parseCard({
  kind: 'creature',
  id: 'tst-archivist-sage',
  name: 'Archivist Sage',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 5, G: 1 },
  colors: ['G'],
  supertypes: ['legendary'],
  subtypes: ['Elf', 'Wizard'],
  keywords: ['trample'],
  keywordAbilities: [{ kind: 'indestructible' }],
  power: 4,
  toughness: 6,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: false, sacrificeSelf: true },
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

const BEAR = creature('Runeclaw Bear', 2, 2, { cost: { generic: 2 } });

const COUNTING_CRUSADER = parseCard({
  kind: 'creature',
  id: 'tst-counting-crusader',
  name: 'Counting Crusader',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 2 },
  manaCost: { generic: 3 },
  colors: [],
  power: 0,
  toughness: 0,
  characteristicPowerToughness: { kind: 'creaturesYouControl' },
});

const FIELD_CAPTAIN = parseCard({
  kind: 'creature',
  id: 'tst-field-captain',
  name: 'Field Captain',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 3 },
  manaCost: { generic: 3 },
  colors: [],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: null,
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
    },
  ],
});

const COUNTER_GUARD = parseCard({
  kind: 'creature',
  id: 'tst-counter-guard',
  name: 'Counter Guard',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 4 },
  manaCost: { generic: 3 },
  colors: [],
  power: 2,
  toughness: 2,
  entryReplacement: { kind: 'entersWithCounters', counter: 'plusOnePlusOne', count: 2 },
});

const ANIMATED_RELIC = parseCard({
  kind: 'artifact',
  id: 'tst-animated-relic',
  name: 'Animated Relic',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 5 },
  manaCost: { generic: 2 },
  colors: [],
});

const MANA_ELF = parseCard({
  kind: 'creature',
  id: 'tst-mana-elf',
  name: 'Mana Elf',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 6 },
  manaCost: { G: 1 },
  colors: ['G'],
  subtypes: ['Elf', 'Druid'],
  power: 1,
  toughness: 1,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'addMana', produces: ['G'], amount: 1 }],
    },
  ],
});

const TRIGGER_SAGE = parseCard({
  kind: 'creature',
  id: 'tst-trigger-sage',
  name: 'Trigger Sage',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 8 },
  manaCost: { generic: 2, W: 1 },
  colors: ['W'],
  subtypes: ['Wizard'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
    },
  ],
});

const TEST_AURA = parseCard({
  kind: 'enchantment',
  id: 'tst-copy-aura',
  name: 'Copy Aura',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 7 },
  manaCost: { W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [{ kind: 'statBonus', power: 1, toughness: 1 }],
  },
});

const PASSES: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

function startWith(targets: readonly { card: Card; controller: 0 | 1; token?: boolean }[]): GameState {
  return scenario({
    battlefield: [...targets, ...lands(ISLAND, 4).map((card) => ({ card, controller: 0 as const }))],
    hands: [[CLONE], []],
  }).state;
}

function castToEntryChoice(state: GameState): GameState {
  const clone = handOidOf(state, 0, 'Clone');
  const cast = reduce(state, { type: 'castSpell', player: 0, oid: clone, targets: [] });
  return reduceAll(cast.state, PASSES).state;
}

function chooseCopy(state: GameState, copyOf: ObjectId | null): GameState {
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('Clone asked no entry question');
  const option = decision.options.find((candidate) => {
    const fields = candidate as unknown as { type?: string; copyOf?: ObjectId | null };
    return fields.type === 'chooseEntryCopy' && fields.copyOf === copyOf;
  });
  if (option === undefined) throw new Error(`Clone did not offer ${String(copyOf)}`);
  return reduce(state, option).state;
}

function resolveTop(state: GameState): GameState {
  const first = pendingDecision(state);
  if (first?.kind !== 'priority') throw new Error('stack resolution did not begin at priority');
  const once = reduce(state, { type: 'passPriority', player: first.player }).state;
  const second = pendingDecision(once);
  if (second?.kind !== 'priority') throw new Error('stack resolution lost the second priority pass');
  return reduce(once, { type: 'passPriority', player: second.player }).state;
}

describe('Clone copy-as-entry replacement (mtg-nhyv.125)', () => {
  it('offers every creature on the battlefield and the choice to enter normally', () => {
    const awaiting = castToEntryChoice(
      startWith([
        { card: ARCHIVIST, controller: 1 },
        { card: BEAR, controller: 0, token: true },
      ]),
    );
    const sage = oidOf(awaiting, 'Archivist Sage');
    const bear = oidOf(awaiting, 'Runeclaw Bear');

    expect(pendingDecision(awaiting)).toMatchObject({
      kind: 'entryCopy',
      player: 0,
      creatures: [sage, bear],
      complete: true,
    });
    expect(
      legalActions(awaiting)
        .filter((action) => action.type !== 'concede')
        .map((action) => {
          const fields = action as unknown as { type?: string; copyOf?: ObjectId | null };
          return { type: fields.type, copyOf: fields.copyOf };
        }),
    ).toEqual([
      { type: 'chooseEntryCopy', copyOf: sage },
      { type: 'chooseEntryCopy', copyOf: bear },
      { type: 'chooseEntryCopy', copyOf: null },
    ]);
  });

  it('snapshots all copiable card values while retaining Clone ownership and controller', () => {
    const awaiting = castToEntryChoice(startWith([{ card: ARCHIVIST, controller: 1 }]));
    const source = oidOf(awaiting, 'Archivist Sage');
    const copied = chooseCopy(awaiting, source);
    const clone = copied.battlefield.find(
      (oid) => oid !== source && copied.objects[oid]?.card.id === CLONE.id,
    );
    if (clone === undefined) throw new Error('Clone did not enter');
    const characteristics = characteristicsOf(copied, clone);
    const object = copied.objects[clone];

    expect(characteristics).toMatchObject({
      name: 'Archivist Sage',
      power: 4,
      toughness: 6,
      colors: ['G'],
      cardTypes: ['creature'],
      subtypes: ['Elf', 'Wizard'],
      supertypes: ['legendary'],
      keywords: ['trample'],
      keywordAbilities: [{ kind: 'indestructible' }],
    });
    expect(abilitiesOf(copied, clone)).toEqual(ARCHIVIST.abilities);
    expect(object?.owner).toBe(0);
    expect(object?.controller).toBe(0);
    const copiedCard = (object as unknown as { copiableCard?: Card })?.copiableCard;
    expect(copiedCard?.kind).toBe('creature');
    if (copiedCard?.kind !== 'creature' || ARCHIVIST.kind !== 'creature') return;
    expect(copiedCard.manaCost).toEqual(ARCHIVIST.manaCost);
    expect(legalActions(copied)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'activateAbility', player: 0, oid: clone, abilityIndex: 0 }),
      ]),
    );
  });

  it('copies a token by value and no longer depends on the source permanent', () => {
    const awaiting = castToEntryChoice(startWith([{ card: BEAR, controller: 1, token: true }]));
    const source = oidOf(awaiting, 'Runeclaw Bear');
    const copied = chooseCopy(awaiting, source);
    const clone = copied.battlefield.find(
      (oid) => oid !== source && copied.objects[oid]?.card.id === CLONE.id,
    );
    if (clone === undefined) throw new Error('Clone did not enter');

    const departed = moveObject(beginTrace(copied), source, 'graveyard').state;
    expect(powerOf(departed, clone)).toBe(2);
    expect(toughnessOf(departed, clone)).toBe(2);
    expect(departed.objects[clone]?.token).toBe(false);
  });

  it('declining leaves the printed 0/0 to state-based actions', () => {
    const awaiting = castToEntryChoice(startWith([{ card: BEAR, controller: 1 }]));
    const clone = Object.values(awaiting.objects).find((object) => object.card.id === CLONE.id)?.oid;
    if (clone === undefined) throw new Error('Clone object is missing');
    const declined = chooseCopy(awaiting, null);

    expect(declined.objects[clone]?.zone).toBe('graveyard');
  });

  it('offers only entering normally when no creature can be copied', () => {
    const awaiting = castToEntryChoice(startWith([]));
    expect(pendingDecision(awaiting)).toMatchObject({
      kind: 'entryCopy',
      creatures: [],
      options: [{ type: 'chooseEntryCopy', copyOf: null }],
      complete: true,
    });
  });

  it('clears the copied values on a new incarnation and fingerprints replay-stably', () => {
    const awaiting = castToEntryChoice(startWith([{ card: ARCHIVIST, controller: 1 }]));
    const source = oidOf(awaiting, 'Archivist Sage');
    const action = pendingDecision(awaiting)?.options.find(
      (candidate) =>
        (candidate as unknown as { type?: string; copyOf?: ObjectId }).type === 'chooseEntryCopy' &&
        (candidate as unknown as { copyOf?: ObjectId }).copyOf === source,
    );
    if (action === undefined) throw new Error('Clone did not offer the source');

    const first = reduce(awaiting, action).state;
    const replayed = reduce(structuredClone(awaiting), structuredClone(action)).state;
    expect(stateFingerprint(replayed)).toBe(stateFingerprint(first));

    const clone = first.battlefield.find((oid) => oid !== source && first.objects[oid]?.card.id === CLONE.id);
    if (clone === undefined) throw new Error('Clone did not enter');
    const left = moveObject(beginTrace(first), clone, 'exile');
    expect((left.state.objects[clone] as unknown as { copiableCard?: Card }).copiableCard).toBeUndefined();

    const returning = moveObject(left, clone, 'battlefield').state;
    expect(pendingDecision(returning)).toMatchObject({ kind: 'entryCopy', oid: clone });
    const declined = chooseCopy(returning, null);
    expect(declined.objects[clone]?.zone).toBe('graveyard');
  });

  it('copies an earlier copy rather than the physical Clone card', () => {
    const start = scenario({
      battlefield: [
        { card: BEAR, controller: 1 },
        ...lands(ISLAND, 8).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[CLONE, CLONE], []],
    }).state;
    const bear = oidOf(start, BEAR.name);
    const first = chooseCopy(castToEntryChoice(start), bear);
    const firstClone = first.battlefield.find((oid) => first.objects[oid]?.card.id === CLONE.id);
    if (firstClone === undefined) throw new Error('first Clone did not enter');
    const second = chooseCopy(castToEntryChoice(first), firstClone);
    const clones = second.battlefield.filter((oid) => second.objects[oid]?.card.id === CLONE.id);

    expect(clones).toHaveLength(2);
    expect(clones.map((oid) => characteristicsOf(second, oid).name)).toEqual([
      'Runeclaw Bear',
      'Runeclaw Bear',
    ]);
    expect(clones.map((oid) => [powerOf(second, oid), toughnessOf(second, oid)])).toEqual([
      [2, 2],
      [2, 2],
    ]);
  });

  it('copies characteristic-defining abilities and evaluates them for the new controller', () => {
    const awaiting = castToEntryChoice(
      startWith([
        { card: COUNTING_CRUSADER, controller: 1 },
        { card: BEAR, controller: 0 },
      ]),
    );
    const source = oidOf(awaiting, COUNTING_CRUSADER.name);
    const copied = chooseCopy(awaiting, source);
    const clone = copied.battlefield.find((oid) => copied.objects[oid]?.card.id === CLONE.id);
    if (clone === undefined) throw new Error('Clone did not enter');

    expect([powerOf(copied, clone), toughnessOf(copied, clone)]).toEqual([2, 2]);
    const bear = oidOf(copied, BEAR.name);
    const departed = moveObject(beginTrace(copied), bear, 'graveyard').state;
    expect([powerOf(departed, clone), toughnessOf(departed, clone)]).toEqual([1, 1]);
  });

  it('copies only copiable values, not layer-derived animation or stat changes', () => {
    const plain = startWith([{ card: ANIMATED_RELIC, controller: 1 }]);
    const source = oidOf(plain, ANIMATED_RELIC.name);
    const animated = withContinuous(plain, [
      retype(onlyObject(source), { addTypes: ['creature'] }),
      setPt(onlyObject(source), 4, 4),
      pump(onlyObject(source), 3, 3),
    ]);
    const awaiting = castToEntryChoice(animated);
    expect(pendingDecision(awaiting)).toMatchObject({
      kind: 'entryCopy',
      creatures: expect.arrayContaining([source]),
    });
    const copied = chooseCopy(awaiting, source);
    const clone = copied.battlefield.find((oid) => copied.objects[oid]?.card.id === CLONE.id);
    if (clone === undefined) throw new Error('Clone did not enter');

    expect(characteristicsOf(copied, source)).toMatchObject({
      cardTypes: ['artifact', 'creature'],
      power: 7,
      toughness: 7,
    });
    expect(characteristicsOf(copied, clone)).toMatchObject({
      name: ANIMATED_RELIC.name,
      cardTypes: ['artifact'],
      power: 0,
      toughness: 0,
    });

    const expired = { ...copied, continuous: [] };
    expect(isCreatureObject(expired, clone)).toBe(false);
    expect(hasCardType(expired, clone, 'artifact')).toBe(true);
    expect(hasCardType(expired, clone, 'creature')).toBe(false);
  });

  it('snapshots active layer-1 copiable values rather than the source physical card', () => {
    const plain = startWith([
      { card: MANA_ELF, controller: 1 },
      { card: BEAR, controller: 1 },
    ]);
    const sage = oidOf(plain, MANA_ELF.name);
    const bear = oidOf(plain, BEAR.name);
    const layered = withContinuous(plain, [copies(onlyObject(bear), sage)]);
    const copied = chooseCopy(castToEntryChoice(layered), bear);
    const clone = copied.battlefield.find((oid) => copied.objects[oid]?.card.id === CLONE.id);
    if (clone === undefined) throw new Error('Clone did not enter');

    expect(characteristicsOf(copied, clone)).toMatchObject({
      name: MANA_ELF.name,
      power: 1,
      toughness: 1,
      subtypes: ['Elf', 'Druid'],
    });
    expect(abilitiesOf(copied, clone)).toEqual(MANA_ELF.abilities);
  });

  it('enumerates, validates, and executes a copied creature mana ability', () => {
    const awaiting = castToEntryChoice(startWith([{ card: MANA_ELF, controller: 1 }]));
    const elf = oidOf(awaiting, MANA_ELF.name);
    const copied = chooseCopy(awaiting, elf);
    const clone = copied.battlefield.find((oid) => copied.objects[oid]?.card.id === CLONE.id);
    if (clone === undefined) throw new Error('Clone did not enter');
    const ready: GameState = {
      ...copied,
      objects: {
        ...copied.objects,
        [clone]: { ...copied.objects[clone]!, summoningSick: false },
      },
    };
    const activation = legalActions(ready).find(
      (action) => action.type === 'activateManaAbility' && action.oid === clone && action.color === 'G',
    );
    if (activation === undefined) throw new Error('copied mana ability was not offered');
    const activated = reduce(ready, activation).state;

    expect(activated.objects[clone]?.tapped).toBe(true);
    expect(activated.players[0].pool.G).toBe(1);
  });

  it('resolves a copied self-sacrifice activation after a second source zone change', () => {
    const awaiting = castToEntryChoice(startWith([{ card: ARCHIVIST, controller: 1 }]));
    const sage = oidOf(awaiting, ARCHIVIST.name);
    const copied = chooseCopy(awaiting, sage);
    const clone = copied.battlefield.find((oid) => copied.objects[oid]?.card.id === CLONE.id);
    if (clone === undefined) throw new Error('Clone did not enter');
    const activation = legalActions(copied).find(
      (action) => action.type === 'activateAbility' && action.oid === clone,
    );
    if (activation === undefined) throw new Error('copied sacrifice ability was not offered');
    const activated = reduce(copied, activation).state;
    expect(activated.objects[clone]?.zone).toBe('graveyard');
    expect(activated.stack.at(-1)?.sourceCard).toEqual(ARCHIVIST);

    const exiled = moveObject(beginTrace(activated), clone, 'exile').state;
    expect(resolveTop(exiled).players[0].life).toBe(21);
  });

  it('resolves a copied trigger from its firing incarnation after two source zone changes', () => {
    const awaiting = castToEntryChoice(startWith([{ card: TRIGGER_SAGE, controller: 1 }]));
    const sage = oidOf(awaiting, TRIGGER_SAGE.name);
    const triggered = chooseCopy(awaiting, sage);
    const clone = triggered.battlefield.find((oid) => triggered.objects[oid]?.card.id === CLONE.id);
    if (clone === undefined) throw new Error('Clone did not enter');
    expect(triggered.stack).toHaveLength(1);
    expect(triggered.stack[0]?.sourceCard).toEqual(TRIGGER_SAGE);

    const died = moveObject(beginTrace(triggered), clone, 'graveyard');
    const exiled = moveObject(died, clone, 'exile').state;
    expect(resolveTop(exiled).players[0].life).toBe(22);
  });

  it('plans and executes intrinsic mana from current copied land values', () => {
    const plain = scenario({
      battlefield: [
        { card: MANA_ELF, controller: 0 },
        { card: ISLAND, controller: 1 },
      ],
    }).state;
    const source = oidOf(plain, MANA_ELF.name);
    const island = oidOf(plain, ISLAND.name);
    const copied = withContinuous(plain, [copies(onlyObject(source), island)]);

    expect(planPayment(copied, 0, mana({ U: 1 }))).toMatchObject({
      taps: [source],
      produces: ['U'],
      amounts: [1],
    });
    const activation = legalActions(copied).find(
      (action) => action.type === 'activateManaAbility' && action.oid === source && action.color === 'U',
    );
    if (activation === undefined) throw new Error('copied intrinsic mana ability was not offered');
    const activated = reduce(copied, activation).state;
    expect(activated.objects[source]?.tapped).toBe(true);
    expect(activated.players[0].pool.U).toBe(1);
  });

  it('chooses a legal host before a copied Aura enters', () => {
    const protectedHost = creature('Copy Aura Protected Host', 2, 2, {
      keywordAbilities: [{ kind: 'protection', quality: { kind: 'color', color: 'W' } }],
    });
    const plain = startWith([
      { card: ANIMATED_RELIC, controller: 1 },
      { card: BEAR, controller: 1 },
      { card: protectedHost, controller: 1 },
    ]);
    const aura = oidOf(plain, ANIMATED_RELIC.name);
    const host = oidOf(plain, BEAR.name);
    const protectedOid = oidOf(plain, protectedHost.name);
    const attached: GameState = {
      ...plain,
      objects: {
        ...plain.objects,
        [aura]: { ...plain.objects[aura]!, card: TEST_AURA, attachedTo: host },
      },
    };
    const animated = withContinuous(attached, [
      retype(onlyObject(aura), { addTypes: ['creature'] }),
      setPt(onlyObject(aura), 2, 2),
    ]);
    const awaiting = castToEntryChoice(animated);
    const clone = Object.values(awaiting.objects).find((object) => object.card.id === CLONE.id)?.oid;
    if (clone === undefined) throw new Error('Clone object is missing');
    const copied = chooseCopy(awaiting, aura);
    const decision = pendingDecision(copied);
    expect(decision).toMatchObject({ kind: 'entryAura', oid: clone });
    expect(decision?.options).not.toContainEqual({
      type: 'chooseEntryAuraHost',
      player: 0,
      oid: clone,
      host: protectedOid,
    });
    const attach = decision?.options.find(
      (action) => action.type === 'chooseEntryAuraHost' && action.host === host,
    );
    if (attach === undefined) throw new Error('copied Aura did not offer its legal host');
    const entered = reduce(copied, attach).state;

    expect(entered.objects[clone]?.zone).toBe('battlefield');
    expect(attachmentOf(entered, clone)).toBe(host);
  });

  it('registers copied static abilities and applies copied entry replacements', () => {
    const captainChoice = castToEntryChoice(
      startWith([
        { card: FIELD_CAPTAIN, controller: 1 },
        { card: BEAR, controller: 0 },
      ]),
    );
    const captain = oidOf(captainChoice, FIELD_CAPTAIN.name);
    const copiedCaptain = chooseCopy(captainChoice, captain);
    const bear = oidOf(copiedCaptain, BEAR.name);
    expect([powerOf(copiedCaptain, bear), toughnessOf(copiedCaptain, bear)]).toEqual([3, 3]);

    const counterChoice = castToEntryChoice(startWith([{ card: COUNTER_GUARD, controller: 1 }]));
    const guard = oidOf(counterChoice, COUNTER_GUARD.name);
    const copiedGuard = chooseCopy(counterChoice, guard);
    const clone = copiedGuard.battlefield.find((oid) => copiedGuard.objects[oid]?.card.id === CLONE.id);
    if (clone === undefined) throw new Error('Clone did not enter');
    expect(copiedGuard.objects[clone]?.copiableCard).toMatchObject({
      entryReplacement: { kind: 'entersWithCounters', counter: 'plusOnePlusOne', count: 2 },
    });
    expect(counterCount(copiedGuard.objects[clone]!.counters, 'plusOnePlusOne')).toBe(2);
    expect([powerOf(copiedGuard, clone), toughnessOf(copiedGuard, clone)]).toEqual([4, 4]);
  });
});

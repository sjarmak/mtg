/** Native linked revealed-hand decisions for M13 Mindclaw Shaman and Shimian Specter. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  collectTriggers,
  eventsOfType,
  moveObject,
  pendingDecision,
  putTriggersOnStack,
  reduce,
  resolveTop,
  scenario,
  seatState,
  settle,
  validateAction,
  type Action,
  type GameEvent,
  type GameState,
  type ObjectId,
  type ReduceResult,
  type Trace,
} from '@mtg/kernel';
import { creature, MOUNTAIN, sorcery } from './cards';
import { oidOf } from './helpers';

const MINDCLAW_SHAMAN = parseCard({
  kind: 'creature',
  id: 'm13-142-mindclaw-shaman-kernel',
  name: 'Mindclaw Shaman',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 142 },
  manaCost: { generic: 4, R: 1 },
  colors: ['R'],
  subtypes: ['Lizard', 'Shaman'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [
        {
          kind: 'chooseFromRevealedHand',
          target: { kind: 'targetOpponent' },
          filter: { cardTypes: ['instant', 'sorcery'] },
          outcome: { kind: 'mayCastWithoutPayingManaCost' },
        },
      ],
    },
  ],
} as unknown as CardInput);

const SHIMIAN_SPECTER = parseCard({
  kind: 'creature',
  id: 'm13-109-shimian-specter-kernel',
  name: 'Shimian Specter',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 109 },
  manaCost: { generic: 2, B: 2 },
  colors: ['B'],
  subtypes: ['Specter'],
  power: 2,
  toughness: 2,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDealsCombatDamageToPlayer',
      effects: [
        {
          kind: 'chooseFromRevealedHand',
          target: { kind: 'triggeringPlayer' },
          filter: { excludeCardTypes: ['land'] },
          outcome: { kind: 'exileAllCardsWithSameNameThenShuffle' },
        },
      ],
    },
  ],
} as unknown as CardInput);

const STOLEN_RITUAL = sorcery(
  'Stolen Ritual',
  [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
  {
    generic: 9,
    U: 1,
  },
);
const STOLEN_OFFERING = parseCard({
  kind: 'sorcery',
  id: 'mindclaw-additional-cost-probe',
  name: 'Stolen Offering',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 142 },
  manaCost: { generic: 12, B: 1 },
  colors: ['B'],
  additionalCost: { sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } } },
  effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
} as CardInput);
const HELD_CREATURE = creature('Held Witness', 2, 2);
const PURGED_NAME = creature('Named Witness', 2, 2);
const OTHER_NAME = creature('Other Witness', 1, 3);

interface RevealedDecision {
  readonly kind: 'revealedHandChoice';
  readonly player: 0 | 1;
  readonly owner: 0 | 1;
  readonly cards: readonly ObjectId[];
  readonly options: readonly Action[];
}

function triggerFrom(state: GameState, event: GameEvent): Trace {
  const scan: Trace = { state, events: [event], eventStates: [state] };
  const triggers = collectTriggers(scan, 0);
  expect(triggers).toHaveLength(1);
  return settle(putTriggersOnStack(beginTrace(state), triggers));
}

function stackMindclaw(hand: readonly Card[], extraBattlefield: readonly Card[] = []): Trace {
  const opened = scenario({
    seed: 'm13/mindclaw',
    active: 1,
    step: 'upkeep',
    battlefield: [
      { card: MINDCLAW_SHAMAN, controller: 0 },
      ...extraBattlefield.map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [[], hand],
    libraries: [[OTHER_NAME], [OTHER_NAME]],
  });
  const source = oidOf(opened.state, MINDCLAW_SHAMAN.name);
  const stacked = triggerFrom(opened.state, { type: 'permanentEntered', oid: source, controller: 0 });
  const targets = pendingDecision(stacked.state);
  if (targets?.kind !== 'triggerTargets')
    throw new Error(`Mindclaw trigger did not ask for its opponent: ${targets?.kind ?? 'none'}`);
  const choose = targets.options.find(
    (action) =>
      action.type === 'chooseTriggerTargets' &&
      action.targets[0]?.kind === 'player' &&
      action.targets[0].player === 1,
  );
  if (choose?.type !== 'chooseTriggerTargets') throw new Error('Mindclaw could not target its opponent');
  return reduce(stacked.state, choose);
}

function pauseMindclaw(hand: readonly Card[], extraBattlefield: readonly Card[] = []): ReduceResult {
  return resolveTop(stackMindclaw(hand, extraBattlefield));
}

function stackShimian(position: ReduceResult): Trace {
  const source = oidOf(position.state, SHIMIAN_SPECTER.name);
  return triggerFrom(position.state, {
    type: 'damageDealt',
    sourceOid: source,
    target: { kind: 'player', player: 1 },
    amount: 2,
    deathtouch: false,
    combat: true,
  });
}

function pauseShimian(position: ReduceResult): ReduceResult {
  return resolveTop(stackShimian(position));
}

function revealedDecision(position: ReduceResult | Trace): RevealedDecision {
  const decision = pendingDecision(position.state) as unknown as RevealedDecision | null;
  if (decision?.kind !== 'revealedHandChoice') throw new Error('revealed-hand choice did not pause');
  return decision;
}

function choose(position: ReduceResult | Trace, chosen: ObjectId | null): ReduceResult {
  const action = {
    type: 'chooseFromRevealedHand',
    player: 0,
    chosen,
  } as unknown as Action;
  return reduce(position.state, action);
}

describe('Mindclaw Shaman', () => {
  it('reveals the whole hand but offers only instant and sorcery cards, including decline', () => {
    const paused = pauseMindclaw([HELD_CREATURE, MOUNTAIN, STOLEN_RITUAL]);
    const decision = revealedDecision(paused);
    const ritual = paused.state.players[1].hand.find(
      (oid) => paused.state.objects[oid]?.card.name === STOLEN_RITUAL.name,
    );

    expect(decision).toMatchObject({ player: 0, owner: 1, cards: [ritual] });
    expect(decision.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'chooseFromRevealedHand', chosen: null }),
        expect.objectContaining({ type: 'chooseFromRevealedHand', chosen: ritual }),
      ]),
    );
    expect(eventsOfType(paused.events, 'handRevealed').at(-1)?.oids).toEqual(paused.state.players[1].hand);
  });

  it('declines without moving any card', () => {
    const paused = pauseMindclaw([STOLEN_RITUAL]);
    const before = paused.state.players[1].hand;
    const done = choose(paused, null);

    expect(done.state.players[1].hand).toEqual(before);
    expect(done.state.pendingFreeCast).toBeUndefined();
    expect(pendingDecision(done.state)?.kind).toBe('priority');
  });

  it('casts the exact opponent card for free outside sorcery timing while preserving nonmana costs', () => {
    const fodder = creature('Offering Fodder', 3, 2);
    const paused = pauseMindclaw([STOLEN_OFFERING], [fodder]);
    const fodderOid = oidOf(paused.state, fodder.name);
    const selected = choose(paused, revealedDecision(paused).cards[0] ?? null);
    const free = pendingDecision(selected.state);
    if (free?.kind !== 'freeCast') throw new Error('Mindclaw did not open the native free-cast decision');
    expect(selected.state.pendingFreeCast?.card).toEqual(STOLEN_OFFERING);
    expect(seatState(selected.state, 0, 'mindclaw-free-cast').objects[free.oid]?.card).toEqual(
      STOLEN_OFFERING,
    );
    const cast = free.options.find(
      (action) => action.type === 'castSpell' && action.sacrifices?.includes(fodderOid) === true,
    );
    if (cast?.type !== 'castSpell') throw new Error('the additional-cost cast was not offered');

    expect(selected.state.turn).toMatchObject({ step: 'upkeep' });
    expect(free.optional).toBe(true);
    expect(cast).toMatchObject({ player: 0, castingCost: 'withoutMana' });
    expect(validateAction(selected.state, cast)).toBeNull();
    const casted = reduce(selected.state, cast);

    expect(casted.state.stack.at(-1)).toMatchObject({ oid: cast.oid, controller: 0 });
    expect(casted.state.players[0].graveyard.map((oid) => casted.state.objects[oid]?.card.name)).toContain(
      fodder.name,
    );
    expect(casted.state.players[0].pool).toEqual(selected.state.players[0].pool);
  });

  it('shows the chooser only the legal decision subset without leaking either library', () => {
    const paused = pauseMindclaw([HELD_CREATURE, STOLEN_RITUAL]);
    const decision = revealedDecision(paused);
    const chooser = seatState(paused.state, 0, 'mindclaw-chooser');
    const owner = seatState(paused.state, 1, 'mindclaw-owner');

    expect(
      (chooser as unknown as { pendingRevealedHandChoice?: { choosable: readonly ObjectId[] } })
        .pendingRevealedHandChoice?.choosable,
    ).toEqual(decision.cards);
    expect(
      (owner as unknown as { pendingRevealedHandChoice?: unknown }).pendingRevealedHandChoice,
    ).toBeUndefined();
    for (const oid of paused.state.players[1].hand) expect(chooser.objects[oid]?.card.name).toBeDefined();
    for (const oid of [...paused.state.players[0].library, ...paused.state.players[1].library]) {
      expect(chooser.objects[oid]).toBeUndefined();
    }
  });

  it('reveals empty and no-legal hands without asking, and rejects a card outside the frozen subset', () => {
    for (const hand of [[], [HELD_CREATURE, MOUNTAIN]] as const) {
      const done = pauseMindclaw(hand);
      expect(pendingDecision(done.state)?.kind).toBe('priority');
      expect(eventsOfType(done.events, 'handRevealed').at(-1)?.oids ?? []).toEqual(
        done.state.players[1].hand,
      );
    }

    const paused = pauseMindclaw([HELD_CREATURE, STOLEN_RITUAL]);
    const hostile = {
      type: 'chooseFromRevealedHand',
      player: 0,
      chosen: paused.state.players[1].hand.find(
        (oid) => paused.state.objects[oid]?.card.name === HELD_CREATURE.name,
      ),
    } as unknown as Action;
    expect(validateAction(paused.state, hostile)).toMatch(/revealed|eligible|choose/u);
  });

  it('keeps the already-triggered controller and target after the source departs in response', () => {
    const stacked = stackMindclaw([STOLEN_RITUAL]);
    const source = oidOf(stacked.state, MINDCLAW_SHAMAN.name);
    const removed = moveObject(stacked, source, 'graveyard');
    const paused = resolveTop(removed);
    const selected = choose(paused, revealedDecision(paused).cards[0] ?? null);

    expect(pendingDecision(selected.state)).toMatchObject({ kind: 'freeCast', player: 0 });
    expect(selected.state.objects[source]?.zone).toBe('graveyard');
  });
});

describe('Shimian Specter', () => {
  function position(hand: readonly Card[], graveyard: readonly Card[] = [], library: readonly Card[] = []) {
    return scenario({
      seed: 'm13/shimian',
      battlefield: [{ card: SHIMIAN_SPECTER, controller: 0 }],
      hands: [[], hand],
      graveyards: [[], graveyard],
      libraries: [[OTHER_NAME], library],
    });
  }

  it('offers every nonland revealed card and no decline', () => {
    const paused = pauseShimian(position([MOUNTAIN, HELD_CREATURE, PURGED_NAME]));
    const decision = revealedDecision(paused);

    expect(decision.cards.map((oid) => paused.state.objects[oid]?.card.name)).toEqual([
      HELD_CREATURE.name,
      PURGED_NAME.name,
    ]);
    expect(decision.options.every((action) => (action as { chosen?: ObjectId | null }).chosen !== null)).toBe(
      true,
    );
  });

  it('exiles every same-name card across hand, graveyard, and library, then shuffles once', () => {
    const paused = pauseShimian(
      position(
        [PURGED_NAME, PURGED_NAME, OTHER_NAME],
        [PURGED_NAME, OTHER_NAME, PURGED_NAME],
        [PURGED_NAME, OTHER_NAME, PURGED_NAME],
      ),
    );
    const selected = revealedDecision(paused).cards.find(
      (oid) => paused.state.objects[oid]?.card.name === PURGED_NAME.name,
    );
    if (selected === undefined) throw new Error('Shimian did not offer the named card');
    const done = choose(paused, selected);

    const names = (oids: readonly ObjectId[]) => oids.map((oid) => done.state.objects[oid]?.card.name);
    expect(names(done.state.players[1].hand)).toEqual([OTHER_NAME.name]);
    expect(names(done.state.players[1].graveyard)).toEqual([OTHER_NAME.name]);
    expect(names(done.state.players[1].library)).toEqual([OTHER_NAME.name]);
    expect(names(done.state.exile).filter((name) => name === PURGED_NAME.name)).toHaveLength(6);
    expect(eventsOfType(done.events, 'libraryShuffled').map((event) => event.player)).toEqual([1]);
  });

  it('does nothing beyond the reveal when the damaged hand is empty or has only lands', () => {
    for (const hand of [[], [MOUNTAIN]] as const) {
      const done = pauseShimian(position(hand, [PURGED_NAME], [PURGED_NAME]));
      expect(pendingDecision(done.state)?.kind).toBe('priority');
      expect(done.state.exile).toEqual([]);
      expect(eventsOfType(done.events, 'libraryShuffled')).toEqual([]);
    }
  });

  it('retains the damaged player and resolves after the Specter leaves', () => {
    const stacked = stackShimian(position([PURGED_NAME], [PURGED_NAME], [PURGED_NAME]));
    const source = oidOf(stacked.state, SHIMIAN_SPECTER.name);
    const removed = moveObject(stacked, source, 'graveyard');
    const paused = resolveTop(removed);
    const done = choose(paused, revealedDecision(paused).cards[0] ?? null);

    expect(done.state.objects[source]?.zone).toBe('graveyard');
    expect(done.state.exile.map((oid) => done.state.objects[oid]?.card.name)).toEqual([
      PURGED_NAME.name,
      PURGED_NAME.name,
      PURGED_NAME.name,
    ]);
  });
});

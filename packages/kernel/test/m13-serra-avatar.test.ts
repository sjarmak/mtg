import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  characteristicsOf,
  eventsOfType,
  moveObject,
  pendingDecision,
  powerOf,
  scenario,
  settle,
  toughnessOf,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { apply, handOidOf, oidOf } from './helpers';
import { controlledBy, copies, onlyObject, withContinuous } from './continuous-helpers';
import { creature } from './cards';

const SERRA_AVATAR = parseCard({
  kind: 'creature',
  id: 'm13-32-serra-avatar-kernel',
  name: 'Serra Avatar',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 32 },
  manaCost: { generic: 4, W: 3 },
  colors: ['W'],
  subtypes: ['Avatar'],
  power: 0,
  toughness: 0,
  characteristicPowerToughness: { kind: 'controllerLifeTotal' },
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfPutIntoGraveyardFromAnywhere',
      effects: [{ kind: 'shuffleSourceIntoOwnerLibrary' }],
    },
  ],
} satisfies CardInput);

const CLONE = creature('Avatar Clone', 1, 1);

const VOID = parseCard({
  kind: 'enchantment',
  id: 'test-serra-void',
  name: 'Serra Probe Void',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 2 },
  manaCost: { B: 1 },
  colors: ['B'],
  abilities: [{ kind: 'staticPlayerRule', players: 'eachOpponent', rule: 'cardsToGraveyardAreExiled' }],
} satisfies CardInput);

function withLife(state: GameState, mine: number, theirs: number): GameState {
  return {
    ...state,
    players: [
      { ...state.players[0], life: mine },
      { ...state.players[1], life: theirs },
    ],
  };
}

function pass(current: ReduceResult): ReduceResult {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'priority') throw new Error('Serra Avatar test lost priority');
  return apply(current, { type: 'passPriority', player: decision.player });
}

function resolveTop(current: ReduceResult): ReduceResult {
  return pass(pass(current));
}

function departFromHand(): { readonly current: ReduceResult; readonly avatar: ObjectId } {
  const opened = scenario({ hands: [[SERRA_AVATAR], []] });
  const avatar = handOidOf(opened.state, 0, SERRA_AVATAR.name);
  const moved = settle(moveObject(beginTrace(opened.state), avatar, 'graveyard'));
  return { current: { state: moved.state, events: moved.events }, avatar };
}

function anyOid(state: GameState, name: string): ObjectId {
  const object = Object.values(state.objects).find((candidate) => candidate.card.name === name);
  if (object === undefined) throw new Error(`Serra Avatar test cannot find ${name}`);
  return object.oid;
}

describe('M13 Serra Avatar', () => {
  it('continuously follows life gain, loss, control, copies, and zero-life boundaries', () => {
    const opened = scenario({
      battlefield: [
        { card: SERRA_AVATAR, controller: 0 },
        { card: CLONE, controller: 1 },
      ],
    });
    const avatar = oidOf(opened.state, SERRA_AVATAR.name);
    const clone = oidOf(opened.state, CLONE.name);
    const copied = withContinuous(opened.state, [copies(onlyObject(clone), avatar, { id: 'copy', ts: 1 })]);
    const wounded = withLife(copied, 7, 13);
    expect([powerOf(wounded, avatar), toughnessOf(wounded, avatar)]).toEqual([7, 7]);
    expect([powerOf(wounded, clone), toughnessOf(wounded, clone)]).toEqual([13, 13]);

    const stolen = withContinuous(wounded, [controlledBy(onlyObject(avatar), 1)]);
    expect([powerOf(stolen, avatar), toughnessOf(stolen, avatar)]).toEqual([13, 13]);
    expect(powerOf(withLife(stolen, 20, 0), avatar)).toBe(0);
  });

  it('uses the owner and current life total outside the battlefield', () => {
    const opened = scenario({ hands: [[SERRA_AVATAR], []] });
    const avatar = handOidOf(opened.state, 0, SERRA_AVATAR.name);
    const hostile: GameState = {
      ...withLife(opened.state, 6, 17),
      objects: {
        ...opened.state.objects,
        [avatar]: { ...opened.state.objects[avatar]!, controller: 1 },
      },
    };
    expect(characteristicsOf(hostile, avatar).power).toBe(6);
  });

  it('triggers from a hand and shuffles the exact graveyard incarnation into its owner library', () => {
    const fired = departFromHand();
    expect(fired.current.state.stack).toHaveLength(1);
    expect(fired.current.state.stack[0]?.controller).toBe(0);

    const resolved = resolveTop(fired.current);
    expect(resolved.state.players[0].library).toContain(fired.avatar);
    expect(eventsOfType(resolved.events, 'libraryShuffled').map((event) => event.player)).toEqual([0]);
  });

  it('fires from library and exile, but not when a graveyard move is replaced', () => {
    const library = scenario({ libraries: [[SERRA_AVATAR], []] });
    const libraryAvatar = anyOid(library.state, SERRA_AVATAR.name);
    const fromLibrary = settle(moveObject(beginTrace(library.state), libraryAvatar, 'graveyard'));
    expect(fromLibrary.state.stack).toHaveLength(1);

    const hand = scenario({ hands: [[SERRA_AVATAR], []] });
    const exileAvatar = handOidOf(hand.state, 0, SERRA_AVATAR.name);
    const exiled = moveObject(beginTrace(hand.state), exileAvatar, 'exile');
    const fromExile = settle(moveObject(exiled, exileAvatar, 'graveyard'));
    expect(fromExile.state.stack).toHaveLength(1);

    const replaced = scenario({
      battlefield: [{ card: VOID, controller: 1 }],
      hands: [[SERRA_AVATAR], []],
    });
    const replacedAvatar = handOidOf(replaced.state, 0, SERRA_AVATAR.name);
    const diverted = settle(moveObject(beginTrace(replaced.state), replacedAvatar, 'graveyard'));
    expect(diverted.state.objects[replacedAvatar]?.zone).toBe('exile');
    expect(diverted.state.stack).toHaveLength(0);
  });

  it('triggers from a stolen battlefield card for its owner, not its last controller', () => {
    const opened = scenario({ battlefield: [{ card: SERRA_AVATAR, controller: 0 }] });
    const avatar = oidOf(opened.state, SERRA_AVATAR.name);
    const stolen = withContinuous(opened.state, [controlledBy(onlyObject(avatar), 1)]);
    const moved = settle(moveObject(beginTrace(stolen), avatar, 'graveyard'));
    expect(moved.state.stack[0]?.controller).toBe(0);

    const resolved = resolveTop({ state: moved.state, events: moved.events });
    expect(resolved.state.players[0].library).toContain(avatar);
    expect(resolved.state.players[1].library).not.toContain(avatar);
  });

  it('does not move or shuffle after departure or when the source has a later incarnation', () => {
    const departed = departFromHand();
    const left = moveObject(beginTrace(departed.current.state), departed.avatar, 'exile');
    const absent = resolveTop({ state: left.state, events: departed.current.events });
    expect(absent.state.objects[departed.avatar]?.zone).toBe('exile');
    expect(eventsOfType(absent.events, 'libraryShuffled')).toHaveLength(0);

    const reincarnated = departFromHand();
    const toExile = moveObject(beginTrace(reincarnated.current.state), reincarnated.avatar, 'exile');
    const back = moveObject(toExile, reincarnated.avatar, 'graveyard');
    const stale = resolveTop({ state: back.state, events: reincarnated.current.events });
    expect(stale.state.objects[reincarnated.avatar]?.zone).toBe('graveyard');
    expect(eventsOfType(stale.events, 'libraryShuffled')).toHaveLength(0);
  });

  it('does not fire from a battlefield copy that is no longer Serra Avatar in the graveyard', () => {
    const opened = scenario({
      battlefield: [
        { card: SERRA_AVATAR, controller: 0 },
        { card: CLONE, controller: 1 },
      ],
    });
    const avatar = oidOf(opened.state, SERRA_AVATAR.name);
    const clone = oidOf(opened.state, CLONE.name);
    const copied = withContinuous(opened.state, [copies(onlyObject(clone), avatar, { id: 'copy', ts: 1 })]);
    const moved = settle(moveObject(beginTrace(copied), clone, 'graveyard'));
    expect(moved.state.objects[clone]?.card.name).toBe(CLONE.name);
    expect(moved.state.stack).toHaveLength(0);
  });
});

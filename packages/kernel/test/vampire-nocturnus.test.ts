/** Live layers and per-seat visibility for Vampire Nocturnus. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  controllerOf,
  hasKeyword,
  moveObject,
  onlyObject,
  powerOf,
  scenario,
  seatState,
  toughnessOf,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { abilities, controlledBy, copies, retype, withContinuous } from './continuous-helpers';
import { creature } from './cards';
import { oidOf } from './helpers';

const NOCTURNUS = parseCard({
  kind: 'creature',
  id: 'm13-113-vampire-nocturnus-kernel',
  name: 'Vampire Nocturnus',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 113 },
  colors: ['B'],
  manaCost: { generic: 1, B: 3 },
  power: 3,
  toughness: 3,
  subtypes: ['Vampire'],
  keywords: [],
  abilities: [
    { kind: 'staticPlayerRule', players: 'controller', rule: 'playWithTopLibraryRevealed' },
    {
      kind: 'staticBundle',
      scope: 'otherCreaturesYouControl',
      subtype: 'Vampire',
      includeSelf: true,
      enabledWhile: { kind: 'controllerTopLibraryHasColor', color: 'B' },
      modifications: [
        { kind: 'statBonus', power: 2, toughness: 1 },
        { kind: 'grantKeyword', keyword: 'flying' },
      ],
    },
  ],
});

const VAMPIRE = creature('Nocturnus Seatmate', 2, 2, { subtypes: ['Vampire'] });
const HUMAN = creature('Nocturnus Human', 2, 2, { subtypes: ['Human'] });
const BLACK = parseCard({
  ...creature('Nocturnus Black Top', 1, 1),
  colors: ['B'],
  manaCost: { B: 1 },
});
const MULTICOLOR_BLACK = parseCard({
  ...creature('Nocturnus Gold Top', 1, 1),
  colors: ['U', 'B'],
  manaCost: { U: 1, B: 1 },
});
const COLORLESS = parseCard({ ...creature('Nocturnus Colorless Top', 1, 1), colors: [] });

function position(top: Card | null = BLACK): GameState {
  return scenario({
    battlefield: [
      { card: NOCTURNUS, controller: 0 },
      { card: VAMPIRE, controller: 0 },
      { card: HUMAN, controller: 0 },
      { card: VAMPIRE, controller: 1 },
    ],
    libraries: [top === null ? [] : [top, COLORLESS], [MULTICOLOR_BLACK]],
  }).state;
}

function expectBody(
  state: GameState,
  oid: ObjectId,
  power: number,
  toughness: number,
  flying: boolean,
): void {
  expect(powerOf(state, oid)).toBe(power);
  expect(toughnessOf(state, oid)).toBe(toughness);
  expect(hasKeyword(state, oid, 'flying')).toBe(flying);
}

function topOf(state: GameState, player: 0 | 1): ObjectId {
  const top = state.players[player].library[0];
  if (top === undefined) throw new Error(`player ${String(player)} has an empty library`);
  return top;
}

function controlledNamed(state: GameState, name: string, player: 0 | 1): ObjectId {
  const oid = state.battlefield.find(
    (candidate) => state.objects[candidate]?.card.name === name && controllerOf(state, candidate) === player,
  );
  if (oid === undefined) throw new Error(`missing ${name} controlled by player ${String(player)}`);
  return oid;
}

describe('Vampire Nocturnus in the kernel', () => {
  it('applies both layers to the source and other controlled Vampires only while the top card is black', () => {
    const state = position();
    expectBody(state, oidOf(state, NOCTURNUS.name), 5, 4, true);
    expectBody(state, controlledNamed(state, VAMPIRE.name, 0), 4, 3, true);
    expectBody(state, oidOf(state, HUMAN.name), 2, 2, false);
    const opposing = state.battlefield.find(
      (oid) => state.objects[oid]?.card.name === VAMPIRE.name && controllerOf(state, oid) === 1,
    );
    if (opposing === undefined) throw new Error('missing opposing Vampire');
    expectBody(state, opposing, 2, 2, false);

    const moved = moveObject(beginTrace(state), topOf(state, 0), 'hand').state;
    expectBody(moved, oidOf(moved, NOCTURNUS.name), 3, 3, false);
    expectBody(moved, controlledNamed(moved, VAMPIRE.name, 0), 2, 2, false);
  });

  it('accepts multicolor black and rejects colorless and an empty library', () => {
    const multicolor = position(MULTICOLOR_BLACK);
    expectBody(multicolor, oidOf(multicolor, NOCTURNUS.name), 5, 4, true);
    const colorless = position(COLORLESS);
    expectBody(colorless, oidOf(colorless, NOCTURNUS.name), 3, 3, false);
    const empty = position(null);
    expectBody(empty, oidOf(empty, NOCTURNUS.name), 3, 3, false);
  });

  it('reveals exactly its current controller top card to both seats and conceals it again on loss', () => {
    const state = position();
    const controllerTop = topOf(state, 0);
    const opponentTop = topOf(state, 1);
    for (const viewer of [0, 1] as const) {
      const view = seatState(state, viewer, `nocturnus-${String(viewer)}`);
      expect(view.objects[controllerTop]?.card.name).toBe(BLACK.name);
      expect(view.objects[opponentTop]).toBeUndefined();
    }

    const source = oidOf(state, NOCTURNUS.name);
    const gone = moveObject(beginTrace(state), source, 'graveyard').state;
    for (const viewer of [0, 1] as const) {
      expect(seatState(gone, viewer, `gone-${String(viewer)}`).objects[controllerTop]).toBeUndefined();
    }
  });

  it('follows source control, copying, ability loss, and live subtype layers', () => {
    const state = position();
    const source = oidOf(state, NOCTURNUS.name);
    const seatmate = controlledNamed(state, VAMPIRE.name, 0);
    const human = oidOf(state, HUMAN.name);

    const stolen = withContinuous(state, [controlledBy(onlyObject(source), 1)]);
    expectBody(stolen, source, 5, 4, true);
    expectBody(stolen, seatmate, 2, 2, false);
    expect(seatState(stolen, 0, 'stolen').objects[topOf(stolen, 1)]).toBeDefined();
    expect(seatState(stolen, 0, 'stolen').objects[topOf(stolen, 0)]).toBeUndefined();

    const copied = withContinuous(state, [copies(onlyObject(human), source)]);
    expectBody(copied, human, 7, 5, true);

    const stripped = withContinuous(state, [abilities(onlyObject(source), { removeAll: true })]);
    expectBody(stripped, source, 3, 3, false);
    expectBody(stripped, seatmate, 2, 2, false);
    expect(seatState(stripped, 1, 'stripped').objects[topOf(stripped, 0)]).toBeUndefined();

    const sourceRetyped = withContinuous(state, [retype(onlyObject(source), { removeAllSubtypes: true })]);
    expectBody(sourceRetyped, source, 5, 4, true);

    const gainedSubtype = withContinuous(state, [retype(onlyObject(human), { addSubtypes: ['Vampire'] })]);
    expectBody(gainedSubtype, human, 4, 3, true);
  });
});

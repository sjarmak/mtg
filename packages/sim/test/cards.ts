/**
 * Card fixtures for the policy tests.
 *
 * Built through `parseCard` so a fixture that stops being a legal DSL card
 * fails at import time rather than producing a nonsense board state.
 */
import type { Card, CardInput, Color, CombatModification, Effect, Keyword } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';

let counter = 0;

function nextNumber(): number {
  counter += 1;
  return counter;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function creature(
  name: string,
  power: number,
  toughness: number,
  keywords: readonly Keyword[] = [],
  cost: { generic?: number; W?: number; U?: number; B?: number; R?: number; G?: number } = { generic: 1 },
  colors: readonly Color[] = [],
): Card {
  const input: CardInput = {
    kind: 'creature',
    id: `tst-${slug(name)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: nextNumber() },
    manaCost: cost,
    colors: [...colors],
    keywords: [...keywords],
    power,
    toughness,
  };
  return parseCard(input);
}

/**
 * A creature whose own printed line carries one combat rule modifier — a lure
 * (CR 509.1c), a berserker (CR 508.1d), and the four restrictions beside them.
 *
 * Its own rather than an Aura's, because that is the shape the flagship set
 * prints, and separate from `creature` rather than a seventh positional
 * parameter on it: every other argument that function takes describes the
 * creature, and this one describes what combat has to do about it.
 */
export function creatureWithStatic(
  name: string,
  power: number,
  toughness: number,
  modification: CombatModification,
  keywords: readonly Keyword[] = [],
): Card {
  const input: CardInput = {
    kind: 'creature',
    id: `tst-${slug(name)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: nextNumber() },
    manaCost: { generic: 1 },
    colors: [],
    keywords: [...keywords],
    power,
    toughness,
    abilities: [{ kind: 'static', scope: 'self', subtype: null, modification }],
  };
  return parseCard(input);
}

export function sorcery(
  name: string,
  effects: readonly Effect[],
  cost: { generic?: number; W?: number; U?: number; B?: number; R?: number; G?: number },
  colors: readonly Color[] = [],
): Card {
  return parseCard({
    kind: 'sorcery',
    id: `tst-${slug(name)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: nextNumber() },
    manaCost: cost,
    colors: [...colors],
    effects: effects.map((effect) => ({ ...effect })),
  } as CardInput);
}

export function instant(
  name: string,
  effects: readonly Effect[],
  cost: { generic?: number; W?: number; U?: number; B?: number; R?: number; G?: number },
  colors: readonly Color[] = [],
): Card {
  return parseCard({
    kind: 'instant',
    id: `tst-${slug(name)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: nextNumber() },
    manaCost: cost,
    colors: [...colors],
    effects: effects.map((effect) => ({ ...effect })),
  } as CardInput);
}

export const PLAINS = basicLand('Plains', 'TST', 501);
export const SWAMP = basicLand('Swamp', 'TST', 502);
export const MOUNTAIN = basicLand('Mountain', 'TST', 503);
export const FOREST = basicLand('Forest', 'TST', 504);

/** Shared spell-timing legality through Leyline of Anticipation's live permission. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  legalActions,
  moveObject,
  onlyObject,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { abilities, controlledBy, copies, withContinuous } from './continuous-helpers';
import { artifact, creature, enchantment, instant, ISLAND, planeswalker, sorcery } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const LEYLINE = parseCard({
  kind: 'enchantment',
  id: 'm11-61-leyline-of-anticipation-kernel',
  name: 'Leyline of Anticipation',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 61 },
  manaCost: { generic: 2, U: 2 },
  colors: ['U'],
  openingHandAction: { kind: 'beginOnBattlefield' },
  abilities: [{ kind: 'staticPlayerRule', players: 'controller', rule: 'castSpellsAsThoughFlash' }],
});

const BLANK = enchantment('Anticipation Blank');
const BODY = creature('Anticipation Creature', 2, 2, { cost: { U: 1 } });
const RELIC = artifact('Anticipation Artifact', { generic: 1 });
const AURALESS_ENCHANTMENT = enchantment('Anticipation Enchantment', { U: 1 });
const DRAW = { kind: 'drawCards' as const, count: 1, target: { kind: 'noTarget' as const } };
const RESPONSE = instant('Anticipation Instant', [DRAW], { U: 1 });
const STUDY = sorcery('Anticipation Sorcery', [DRAW], { U: 1 });
const WALKER = planeswalker(
  'Anticipation Walker',
  3,
  [
    {
      kind: 'activated',
      loyaltyCost: 1,
      cost: { mana: {} },
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    },
  ],
  { U: 1 },
);
const SPELLS = [BODY, RELIC, AURALESS_ENCHANTMENT, RESPONSE, STUDY, WALKER] as const;

function responseWindow(extraBattlefield: readonly Card[] = []): ReduceResult {
  const start = scenario({
    active: 1,
    battlefield: [
      { card: LEYLINE, controller: 0 },
      ...Array.from({ length: 6 }, () => ({ card: ISLAND, controller: 0 as const })),
      { card: ISLAND, controller: 1 },
      ...extraBattlefield.map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [[...SPELLS], [STUDY]],
  });
  return apply(start, { type: 'passPriority', player: 1 });
}

function castActions(state: GameState): readonly Extract<Action, { type: 'castSpell' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'castSpell' }> => action.type === 'castSpell',
  );
}

function castableNames(state: GameState): readonly string[] {
  return [...new Set(castActions(state).map((action) => state.objects[action.oid]?.card.name))]
    .filter((name): name is string => name !== undefined)
    .sort();
}

function sorceryCast(state: GameState): Extract<Action, { type: 'castSpell' }> {
  return {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(state, 0, STUDY.name),
    targets: [null],
  };
}

function isSorceryCastable(state: GameState, player: 0 | 1 = 0): boolean {
  const oid = handOidOf(state, player, STUDY.name);
  return castActions(state).some((action) => action.oid === oid);
}

describe('flash-casting permission', () => {
  it('enumerates and validates every spell kind while its controller has priority on an opponent turn', () => {
    const current = responseWindow();

    expect(castableNames(current.state)).toEqual(SPELLS.map((card) => card.name).sort());
    expect(validateAction(current.state, sorceryCast(current.state))).toBeNull();
  });

  it('does not override an absolute casting prohibition', () => {
    const current = responseWindow();
    const leyline = oidOf(current.state, LEYLINE.name);
    const blocked: GameState = {
      ...current.state,
      turnPlayerRules: [
        ...current.state.turnPlayerRules,
        { rule: 'cantCastSpells', sourceOid: leyline, player: 0 },
      ],
    };

    expect(castActions(blocked)).toEqual([]);
    expect(validateAction(blocked, sorceryCast(blocked))).toContain("can't cast spells this turn");
  });

  it('follows current control, copying, ability loss, and source departure', () => {
    const current = responseWindow([BLANK]);
    const leyline = oidOf(current.state, LEYLINE.name);
    const blank = oidOf(current.state, BLANK.name);
    expect(isSorceryCastable(current.state)).toBe(true);

    const changed = withContinuous(current.state, [controlledBy(onlyObject(leyline), 1)]);
    expect(isSorceryCastable(changed)).toBe(false);
    const changedControllerPriority = apply(
      { ...current, state: changed },
      { type: 'passPriority', player: 0 },
    );
    expect(isSorceryCastable(changedControllerPriority.state, 1)).toBe(true);

    const copied = withContinuous(current.state, [
      copies(onlyObject(blank), leyline),
      abilities(onlyObject(leyline), { removeAll: true }),
    ]);
    expect(isSorceryCastable(copied)).toBe(true);

    const stripped = withContinuous(copied, [abilities(onlyObject(blank), { removeAll: true })]);
    expect(isSorceryCastable(stripped)).toBe(false);

    const gone = moveObject(beginTrace(current.state), leyline, 'graveyard');
    expect(isSorceryCastable(gone.state)).toBe(false);
    expect(castableNames(gone.state)).toEqual([RESPONSE.name]);
    expect(validateAction(gone.state, sorceryCast(gone.state))).toContain('wrong timing');
  });
});

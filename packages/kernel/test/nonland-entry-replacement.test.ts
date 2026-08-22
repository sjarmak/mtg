/**
 * A mana rock that enters tapped, played (mtg-hgmz).
 *
 * `arrivalOf` read `entryReplacement` only off a land, so the tempo half of a
 * cheap rock's price — Coldsteel Heart's clause, and the reason a two-mana
 * rock is printable at common rates at all — was unreachable even once the
 * schema allowed it. The replacement machinery underneath never asked which
 * card kind produced the modification (`replacement.ts` takes
 * `{ kind: 'entersTapped' }` and sets `tapped: true`), so this is the whole
 * behavior the kernel owed the field.
 *
 * The assertion that matters is the last one: the rock arrives tapped *and*
 * cannot be tapped for mana the turn it arrives. An artifact has no summoning
 * sickness (CR 302.6 is a creature rule), so without the entry replacement the
 * `{T}` ability would be live the moment it resolved, and a test that only
 * checked the `tapped` flag would pass on a kernel that untapped it a moment
 * later.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { Action, GameState } from '@mtg/kernel';
import { eventsOfType, legalActions, playerOf, reduce, reduceAll, scenario } from '@mtg/kernel';
import { artifact, ISLAND } from './cards';
import { handOidOf, oidOf } from './helpers';

/** `Chill Heart enters tapped. {T}: Add {U}.` */
const CHILL_HEART: Card = parseCard({
  kind: 'artifact',
  id: 'tst-chill-heart',
  name: 'Chill Heart',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 301 },
  manaCost: { generic: 2 },
  entryReplacement: { kind: 'entersTapped' },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'addMana', produces: ['U'], amount: 1 }],
    },
  ],
});

/** The same rock with no entry clause, so the control arm is one field apart. */
const WARM_HEART: Card = artifact('Warm Heart', { generic: 2 }, [
  {
    kind: 'activated',
    cost: { mana: {}, tapSelf: true },
    effects: [{ kind: 'addMana', produces: ['U'], amount: 1 }],
  },
]);

function islands(count: number): { readonly card: typeof ISLAND; readonly controller: 0 }[] {
  return Array.from({ length: count }, () => ({ card: ISLAND, controller: 0 as const }));
}

function manaActionsFor(state: GameState, oid: string): readonly Action[] {
  return legalActions(state).filter((action) => action.type === 'activateManaAbility' && action.oid === oid);
}

function resolve(state: GameState): GameState {
  return reduceAll(state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]).state;
}

function play(rock: Card): GameState {
  const start = scenario({ battlefield: islands(2), hands: [[rock], []] }).state;
  const oid = handOidOf(start, 0, rock.name);
  return resolve(reduce(start, { type: 'castSpell', player: 0, oid, targets: [] }).state);
}

describe('a noncreature artifact that enters tapped (mtg-hgmz)', () => {
  it('arrives tapped and emits the tap with the entry', () => {
    const start = scenario({ battlefield: islands(2), hands: [[CHILL_HEART], []] }).state;
    const spell = handOidOf(start, 0, 'Chill Heart');
    const cast = reduce(start, { type: 'castSpell', player: 0, oid: spell, targets: [] });
    const done = reduceAll(cast.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);

    const rock = oidOf(done.state, 'Chill Heart');
    expect(done.state.objects[rock]?.zone).toBe('battlefield');
    expect(done.state.objects[rock]?.tapped).toBe(true);
    expect(eventsOfType(done.events, 'permanentTapped').map((event) => event.oid)).toContain(rock);
  });

  it('cannot be tapped for mana the turn it arrives, and the untapped twin can', () => {
    const chilled = play(CHILL_HEART);
    const chilledOid = oidOf(chilled, 'Chill Heart');
    expect(manaActionsFor(chilled, chilledOid)).toEqual([]);
    expect(playerOf(chilled, 0).pool.U).toBe(0);

    const warm = play(WARM_HEART);
    const warmOid = oidOf(warm, 'Warm Heart');
    expect(manaActionsFor(warm, warmOid).length).toBe(1);
  });
});

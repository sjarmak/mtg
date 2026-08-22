/**
 * `sacrificePermanent`: the sixth resolution effect that stops to ask, and the
 * first whose question is aimed at the spell's target rather than its caster.
 *
 * Every other pausing effect (`scry`, `searchLibrary`, the two discards,
 * `chooseFromGraveyard`) asks the seat the ability already belongs to — the
 * caster looks at their own scry window, discards from their own hand, takes
 * from a graveyard. CR 701.17a's edict does not: "target player sacrifices a
 * creature" hands the choice to whichever seat was targeted, who may be the
 * caster's opponent and usually is. `graveyard-choice.test.ts`'s continuation
 * and concealment assertions apply here unchanged (the battlefield is public,
 * CR 403.2, exactly as a graveyard is CR 400.2), so this file's own burden is
 * the one fact none of those five siblings can demonstrate: that the answering
 * seat is the target, not the caster.
 *
 * `sacrifice-self.test.ts` already proved CR 701.17's half of this ("a
 * sacrifice is not a destruction") for the fixed-target primitive; the tests
 * below repeat the load-bearing half of that proof (a `permanentSacrificed`
 * event and no `permanentDestroyed`) for the targeted one, since the two are
 * siblings in `destruction.ts` rather than one calling the other.
 */
import { describe, expect, it } from 'vitest';
import type { Action, ObjectId, ReduceResult, Target } from '@mtg/kernel';
import { eventsOfType, pendingDecision, scenario, validateAction } from '@mtg/kernel';
import { creature, lands, sorcery, SWAMP } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const EDICT = sorcery('Forced March', [{ kind: 'sacrificePermanent', target: { kind: 'targetOpponent' } }], {
  B: 1,
});

/** Casts `card` from player 0's hand at player 1 and resolves it with both seats passing. */
function resolveSpell(start: ReduceResult, name: string, targets: readonly (Target | null)[]): ReduceResult {
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, name),
    targets: [...targets],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

const AT_OPPONENT: readonly (Target | null)[] = [{ kind: 'player', player: 1 }];

function edictScenario(
  theirs: readonly ReturnType<typeof creature>[],
  spell = EDICT,
  mine: readonly ReturnType<typeof creature>[] = [],
): ReduceResult {
  return scenario({
    battlefield: [
      ...lands(SWAMP, 2).map((land) => ({ card: land, controller: 0 as const })),
      ...mine.map((card) => ({ card, controller: 0 as const })),
      ...theirs.map((card) => ({ card, controller: 1 as const })),
    ],
    hands: [[spell], []],
    libraries: [[creature('Deck', 1, 1)], [creature('Their Deck', 1, 1)]],
    seed: 'edict/forced-march',
  });
}

describe('sacrificePermanent', () => {
  it('offers one option per creature the targeted player controls, and asks that player', () => {
    const asked = resolveSpell(
      edictScenario([creature('Guard', 2, 2), creature('Sentry', 1, 3)]),
      EDICT.name,
      AT_OPPONENT,
    );
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'permanentSacrifice') throw new Error('a permanent sacrifice was not pending');
    expect(decision.player).toBe(1);
    expect(decision.permanents).toHaveLength(2);
    expect(decision.options).toEqual(
      decision.permanents.map((oid): Action => ({ type: 'sacrificePermanent', player: 1, oid })),
    );
  });

  it("refuses the caster's answer, because the choice belongs to the target and never the caster", () => {
    const asked = resolveSpell(
      edictScenario([creature('Guard', 2, 2), creature('Sentry', 1, 3)]),
      EDICT.name,
      AT_OPPONENT,
    );
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'permanentSacrifice') throw new Error('a permanent sacrifice was not pending');
    const candidate = decision.permanents[0];
    if (candidate === undefined) throw new Error('the rig put no creature across the table');

    expect(
      validateAction(asked.state, { type: 'sacrificePermanent', player: 0, oid: candidate }),
    ).not.toBeNull();
    expect(validateAction(asked.state, { type: 'sacrificePermanent', player: 1, oid: candidate })).toBeNull();
  });

  it('moves the chosen creature to its own graveyard as a sacrifice, never a destruction', () => {
    const asked = resolveSpell(
      edictScenario([creature('Guard', 2, 2), creature('Sentry', 1, 3)]),
      EDICT.name,
      AT_OPPONENT,
    );
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'permanentSacrifice') throw new Error('a permanent sacrifice was not pending');
    const chosen = decision.permanents[0];
    if (chosen === undefined) throw new Error('the rig put no creature across the table');

    const done = apply(asked, { type: 'sacrificePermanent', player: 1, oid: chosen });

    expect(done.state.objects[chosen]?.zone).toBe('graveyard');
    expect(done.state.players[1].graveyard).toContain(chosen);
    expect(done.state.battlefield).not.toContain(chosen);
    expect(
      eventsOfType(done.events, 'permanentSacrificed').map((event) => ({
        oid: event.oid,
        player: event.player,
      })),
    ).toEqual([{ oid: chosen, player: 1 }]);
    expect(eventsOfType(done.events, 'permanentDestroyed')).toEqual([]);
  });

  it('leaves the other candidate on the battlefield under its own control', () => {
    const asked = resolveSpell(
      edictScenario([creature('Guard', 2, 2), creature('Sentry', 1, 3)]),
      EDICT.name,
      AT_OPPONENT,
    );
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'permanentSacrifice') throw new Error('a permanent sacrifice was not pending');
    const chosen = decision.permanents[0];
    const spared = decision.permanents[1];
    if (chosen === undefined || spared === undefined) throw new Error('the rig put too few creatures out');

    const done = apply(asked, { type: 'sacrificePermanent', player: 1, oid: chosen });
    expect(done.state.objects[spared]?.zone).toBe('battlefield');
    expect(done.state.objects[spared]?.controller).toBe(1);
  });

  it('does not stop at all when the target controls exactly one creature, and takes it', () => {
    const start = edictScenario([creature('Lone Guard', 2, 2)]);
    const lone = oidOf(start.state, 'Lone Guard');
    const done = resolveSpell(start, EDICT.name, AT_OPPONENT);
    expect(pendingDecision(done.state)?.kind).not.toBe('permanentSacrifice');
    expect(done.state.objects[lone]?.zone).toBe('graveyard');
    expect(eventsOfType(done.events, 'permanentSacrificed').map((event) => event.oid)).toEqual([lone]);
  });

  it('does nothing when the target controls no creatures, because CR 701.17a offers no legal candidate', () => {
    const done = resolveSpell(edictScenario([]), EDICT.name, AT_OPPONENT);
    expect(pendingDecision(done.state)?.kind).not.toBe('permanentSacrifice');
    expect(eventsOfType(done.events, 'permanentSacrificed')).toEqual([]);
    expect(done.state.players[0].graveyard.map((oid) => done.state.objects[oid]?.card.name)).toContain(
      EDICT.name,
    );
  });

  it('refuses a creature the target does not control, and one already gone', () => {
    const asked = resolveSpell(
      edictScenario([creature('Guard', 2, 2), creature('Sentry', 1, 3)], EDICT, [creature('Mine', 4, 4)]),
      EDICT.name,
      AT_OPPONENT,
    );
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'permanentSacrifice') throw new Error('a permanent sacrifice was not pending');
    const chosen = decision.permanents[0];
    if (chosen === undefined) throw new Error('the rig put no creature across the table');
    const notTheirs = oidOf(asked.state, 'Mine');
    const bogus = 'oid-not-on-the-battlefield' as ObjectId;

    expect(
      validateAction(asked.state, { type: 'sacrificePermanent', player: 1, oid: notTheirs }),
    ).not.toBeNull();
    expect(validateAction(asked.state, { type: 'sacrificePermanent', player: 1, oid: bogus })).not.toBeNull();
    expect(validateAction(asked.state, { type: 'sacrificePermanent', player: 1, oid: chosen })).toBeNull();
  });

  it('resumes the effects printed after the sacrifice', () => {
    const spell = sorcery(
      'Grim Toll',
      [
        { kind: 'sacrificePermanent', target: { kind: 'targetOpponent' } },
        { kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } },
      ],
      { B: 1 },
    );
    const asked = resolveSpell(
      edictScenario([creature('Guard', 2, 2), creature('Sentry', 1, 3)], spell),
      spell.name,
      [{ kind: 'player', player: 1 }, null],
    );
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'permanentSacrifice') throw new Error('a permanent sacrifice was not pending');
    const chosen = decision.permanents[0];
    if (chosen === undefined) throw new Error('the rig put no creature across the table');

    const done = apply(asked, { type: 'sacrificePermanent', player: 1, oid: chosen });
    expect(done.state.players[0].life).toBe(22);
  });
});

/**
 * `mtg-899w`: the contract's disambiguation reaches a kernel `castSpell` only
 * if the projector hands it the chosen target, not just the spell.
 *
 * `packages/engine/test/labels.test.ts` builds `PendingDecision` and
 * `TableView` by hand to test `labelDecision` in isolation. This file goes the
 * other way: a real `GameState`, built by `scenario()` the way every other
 * kernel test builds one, run through the real `castSpell` enumeration and the
 * real `backend-projection.ts` functions this bead edited — `projectDecision`
 * and `projectState` — so what reaches `labelDecision` is what the backend
 * would actually hand a surface, not a stand-in for it.
 *
 * The board is `mtg-cee`'s own: one Emberflow Raider a side, and a hand
 * holding one Lightning Lash, whose `anyTarget` effect enumerates a cast at
 * each creature and each player. Before this bead's fix, `objectsIn` reported
 * only the spell's own object for every one of those casts, so all four
 * options carried the identical single-element `targets` list `[lash]` and
 * `labelDecision` had nothing to separate them with. After the fix, the two
 * creature-aimed casts carry `[lash, raider]` with different `raider` oids,
 * which is exactly the fact `labelDecision`'s `ASPECTS` reads controller off
 * of.
 *
 * The two player-aimed casts are `mtg-8yk1`, a second bug the same board
 * caught: a player target has no `ObjectId`, so `objectsIn` still reports only
 * `[lash]` for both of them and `MoveOption.targets` still can't separate
 * them — `labelDecision` never gets a chance. `describeAction`
 * (`../src/backend-projection.ts`) closes that one instead, by naming the
 * targeted player straight in `MoveOption.text`, so the two options never
 * collide at `labelDecision`'s first step and `sharedWith` comes back empty
 * without the qualifier machinery ever running.
 */
import { describe, expect, it } from 'vitest';
import type { SessionSpec } from '@mtg/engine';
import { labelDecision } from '@mtg/engine';
import { exampleCard, parseCard } from '@mtg/dsl';
import type { Action } from '@mtg/kernel';
import { beginTrace, moveObject, pendingDecision, reduce, reduceAll, scenario } from '@mtg/kernel';
import { projectDecision, projectState } from '../src/backend-projection';
import { creature, FOREST, instant, MOUNTAIN } from './cards';

const TABLE: SessionSpec = {
  content: { kind: 'dsl-set', setCode: 'SLC' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'local', deck: { name: 'south', cards: [] } },
  ],
  seed: 'backend-projection/mtg-cee',
  maximumTurns: 40,
};

describe('backend-projection exposes public exile', () => {
  it('projects an exiled card under its owning seat', () => {
    const opened = scenario({ hands: [[FOREST], []] });
    const oid = opened.state.players[0].hand[0];
    if (oid === undefined) throw new Error('expected a card in hand');
    const exiled = moveObject(beginTrace(opened.state), oid, 'exile').state;

    const view = projectState(exiled, TABLE, [0, 1]);

    expect(view.seats[0].exile.map((card) => card.oid)).toEqual([String(oid)]);
    expect(view.seats[1].exile).toEqual([]);
  });

  it('projects the combat relation that moves a declared attacker into the shared band', () => {
    const opened = scenario({ battlefield: [{ card: creature('Attacker', 2, 2), controller: 0 }] });
    const attacker = opened.state.battlefield[0];
    if (attacker === undefined) throw new Error('expected an attacker');
    const attacking = {
      ...opened.state,
      combat: { ...opened.state.combat, attacks: [{ oid: attacker, defender: 1 as const }] },
    };

    expect(projectState(attacking, TABLE, [0, 1]).seats[0].battlefield[0]?.attacking).toBe(true);
    expect(projectState(opened.state, TABLE, [0, 1]).seats[0].battlefield[0]?.attacking).toBe(false);
  });
});

describe('backend-projection points a castSpell at what it targets', () => {
  it('separates two Lightning Lash casts aimed at the two players’ Emberflow Raiders', () => {
    const lash = exampleCard('slc-lightning-lash');
    const opened = scenario({
      battlefield: [
        { card: exampleCard('slc-emberflow-raider'), controller: 0 },
        { card: exampleCard('slc-emberflow-raider'), controller: 1 },
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[lash], []],
    });

    // Float the mana Lightning Lash costs before asking what is legal:
    // `canPay` reads the pool rather than what the board could produce, the
    // same setup `opponent-target.test.ts` uses for the same reason.
    const mountains = opened.state.battlefield.filter(
      (oid) => opened.state.objects[oid]?.card.name === 'Mountain',
    );
    const floated = reduceAll(
      opened.state,
      mountains.map((oid): Action => ({ type: 'activateManaAbility', player: 0, oid, color: 'R' })),
    );

    const decision = pendingDecision(floated.state);
    if (decision === null) throw new Error('expected a pending decision');
    expect(decision.kind).toBe('priority');

    const raiderOf = (controller: 0 | 1): string => {
      const found = floated.state.battlefield.find(
        (oid) =>
          floated.state.objects[oid]?.card.name === 'Emberflow Raider' &&
          floated.state.objects[oid]?.controller === controller,
      );
      if (found === undefined) throw new Error(`no Emberflow Raider under player ${String(controller)}`);
      return found;
    };
    const northRaider = raiderOf(0);
    const southRaider = raiderOf(1);

    const castAt = (raider: string): number =>
      decision.options.findIndex(
        (action) =>
          action.type === 'castSpell' &&
          action.targets[0] !== null &&
          action.targets[0]?.kind === 'permanent' &&
          action.targets[0].oid === raider,
      );
    const atNorth = castAt(northRaider);
    const atSouth = castAt(southRaider);
    expect(atNorth).toBeGreaterThanOrEqual(0);
    expect(atSouth).toBeGreaterThanOrEqual(0);

    // No `ObjectView` exists for a player target, so `targetedObjects` still
    // has nothing to append for either of these two — asserted here as a fact
    // about the fixture, not the claim under test. `mtg-8yk1` is that they
    // stay separable anyway, through `describeAction`'s text rather than
    // `MoveOption.targets`.
    const castAtPlayer = decision.options.filter(
      (action) => action.type === 'castSpell' && action.targets[0]?.kind === 'player',
    );
    expect(castAtPlayer).toHaveLength(2);

    const castAtSeat = (player: 0 | 1): number =>
      decision.options.findIndex(
        (action) =>
          action.type === 'castSpell' &&
          action.targets[0] !== null &&
          action.targets[0]?.kind === 'player' &&
          action.targets[0].player === player,
      );
    const atPlayer0 = castAtSeat(0);
    const atPlayer1 = castAtSeat(1);
    expect(atPlayer0).toBeGreaterThanOrEqual(0);
    expect(atPlayer1).toBeGreaterThanOrEqual(0);

    const pendingProjection = projectDecision(floated.state, decision);
    const view = projectState(floated.state, TABLE, [0, 1]);
    const labels = labelDecision(pendingProjection, view);

    const northLabel = labels[atNorth];
    const southLabel = labels[atSouth];
    if (northLabel === undefined || southLabel === undefined) throw new Error('expected both labels');

    expect(northLabel.text).not.toBe(southLabel.text);
    expect(northLabel.sharedWith).toEqual([]);
    expect(southLabel.sharedWith).toEqual([]);

    const player0Label = labels[atPlayer0];
    const player1Label = labels[atPlayer1];
    if (player0Label === undefined || player1Label === undefined) {
      throw new Error('expected both player-target labels');
    }

    // `describeAction` names the player, so the two options never collide at
    // `labelDecision`'s first step (`sharedText`) — `sharedWith` comes back
    // empty without its qualifier ever running, which is a stronger claim than
    // the permanent-target pair above gets: those two only separate *after*
    // `qualifyGroup` appends a controller name, these two never enter it.
    expect(player0Label.text).not.toBe(player1Label.text);
    expect(player0Label.sharedWith).toEqual([]);
    expect(player1Label.sharedWith).toEqual([]);
  });
});

describe('backend-projection exposes spell discard payments', () => {
  it('points each Wild Guess option at the hand card it will discard', () => {
    const wildGuess = parseCard({
      kind: 'sorcery',
      id: 'projection-wild-guess',
      name: 'Wild Guess',
      rarity: 'common',
      set: { code: 'M13', collectorNumber: 157 },
      colors: ['R'],
      manaCost: { R: 2 },
      additionalCost: { discard: 1 },
      effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
    });
    const opened = scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [
        [
          wildGuess,
          FOREST,
          instant('Valuable Spell', [{ kind: 'drawCards', count: 3, target: { kind: 'noTarget' } }]),
        ],
        [],
      ],
    });
    const floated = reduceAll(
      opened.state,
      opened.state.battlefield.map((oid): Action => ({
        type: 'activateManaAbility',
        player: 0,
        oid,
        color: 'R',
      })),
    );
    const decision = pendingDecision(floated.state);
    if (decision?.kind !== 'priority') throw new Error('expected priority');
    const projected = projectDecision(floated.state, decision);
    const wildGuessOid = floated.state.players[0].hand.find(
      (oid) => floated.state.objects[oid]?.card.name === 'Wild Guess',
    );
    if (wildGuessOid === undefined) throw new Error('Wild Guess left the hand');
    const casts = decision.options.flatMap((action, index) =>
      action.type === 'castSpell' && action.oid === wildGuessOid
        ? [{ action, option: projected.options[index] }]
        : [],
    );

    expect(
      casts.map(({ action, option }) => ({
        discarded: action.discards?.map((oid) => floated.state.objects[oid]?.card.name),
        projected: option?.targets.map((target) => target.name),
        text: option?.text,
      })),
    ).toEqual([
      {
        discarded: ['Forest'],
        projected: ['Wild Guess', 'Forest'],
        text: 'Cast Wild Guess discarding Forest',
      },
      {
        discarded: ['Valuable Spell'],
        projected: ['Wild Guess', 'Valuable Spell'],
        text: 'Cast Wild Guess discarding Valuable Spell',
      },
    ]);
  });
});

describe('backend-projection exposes a chosen cohort payment', () => {
  it('points each activation option at the permanent it will tap', () => {
    const source = parseCard({
      kind: 'artifact',
      id: 'projection-cohort-source',
      name: 'Cohort Source',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 3 },
      manaCost: { generic: 1 },
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {}, tapMatching: { count: 1, filter: { cardTypes: ['creature'] } } },
          effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const opened = scenario({
      battlefield: [
        { card: source, controller: 0 },
        { card: creature('First Payer', 1, 1), controller: 0, summoningSick: true },
        { card: creature('Second Payer', 1, 1), controller: 0, summoningSick: true },
      ],
    });
    const decision = pendingDecision(opened.state);
    if (decision?.kind !== 'priority') throw new Error('expected a priority decision');
    const projected = projectDecision(opened.state, decision);
    const activations = decision.options.flatMap((action, index) =>
      action.type === 'activateAbility' ? [{ action, option: projected.options[index] }] : [],
    );

    expect(activations).toHaveLength(2);
    expect(
      activations.map(({ action, option }) => ({
        tapped: action.taps?.map((oid) => opened.state.objects[oid]?.card.name),
        projected: option?.targets.map((target) => target.name),
      })),
    ).toEqual([
      { tapped: ['First Payer'], projected: ['Cohort Source', 'First Payer'] },
      { tapped: ['Second Payer'], projected: ['Cohort Source', 'Second Payer'] },
    ]);
  });
});

describe('backend-projection names plural player-target choices', () => {
  it('gives each staged Hunters Feast member and completion distinct move text', () => {
    const feast = parseCard({
      kind: 'sorcery',
      id: 'projection-hunters-feast',
      name: "Hunters' Feast",
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 182 },
      manaCost: { generic: 3, G: 1 },
      colors: ['G'],
      effects: [
        {
          kind: 'gainLife',
          amount: 6,
          target: { kind: 'targetPlayer', anyNumber: true },
        },
      ],
    });
    const opened = scenario({
      battlefield: Array.from({ length: 4 }, () => ({ card: FOREST, controller: 0 as const })),
      hands: [[feast], []],
    });
    const floated = reduceAll(
      opened.state,
      opened.state.battlefield.map((oid): Action => ({
        type: 'activateManaAbility',
        player: 0,
        oid,
        color: 'G',
      })),
    );
    const decision = pendingDecision(floated.state);
    if (decision === null) throw new Error('expected a pending decision');
    const start = decision.options.find((action) => action.type === 'beginCastSpell');
    if (start === undefined) throw new Error('expected staged cast start');
    const staged = reduce(floated.state, start);
    const memberDecision = pendingDecision(staged.state);
    if (memberDecision === null) throw new Error('expected staged member decision');
    const projected = projectDecision(staged.state, memberDecision);

    expect(new Set(projected.options.map((option) => option.text)).size).toBe(3);
    expect(projected.options.map((option) => option.text).sort()).toEqual([
      'Add player 0 as a target',
      'Add player 1 as a target',
      "Finish choosing targets for Hunters' Feast",
    ]);
  });
});

describe('backend-projection names resolution-time spell target choices', () => {
  it('points each Redirect option at both the spell and its proposed target', () => {
    const spark = instant(
      'Forked Spark',
      [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
      {},
    );
    const redirect = instant('Redirect', [{ kind: 'changeSpellTargets' }], {});
    const first = creature('First Host', 2, 2);
    const second = creature('Second Host', 2, 2);
    let state = scenario({
      battlefield: [
        { card: first, controller: 0 },
        { card: second, controller: 1 },
      ],
      hands: [[spark, redirect], []],
    }).state;
    const firstOid = state.battlefield[0];
    const secondOid = state.battlefield[1];
    const sparkOid = state.players[0].hand.find((oid) => state.objects[oid]?.card.name === spark.name);
    if (firstOid === undefined || secondOid === undefined || sparkOid === undefined) {
      throw new Error('the Redirect projection fixture is incomplete');
    }
    state = reduce(state, {
      type: 'castSpell',
      player: 0,
      oid: sparkOid,
      targets: [{ kind: 'permanent', oid: firstOid }],
    }).state;
    const priority = pendingDecision(state);
    if (priority?.kind !== 'priority') throw new Error('Redirect has no priority window');
    const redirectCast = priority.options.find(
      (action) =>
        action.type === 'castSpell' &&
        action.targets[0]?.kind === 'spell' &&
        action.targets[0].oid === sparkOid,
    );
    if (redirectCast === undefined) throw new Error('Redirect was not offered');
    state = reduce(state, redirectCast).state;
    for (let count = 0; count < 2; count += 1) {
      const pass = pendingDecision(state);
      if (pass?.kind !== 'priority') throw new Error('Redirect did not reach resolution');
      state = reduce(state, { type: 'passPriority', player: pass.player }).state;
    }
    const targets = pendingDecision(state);
    if (targets?.kind !== 'spellTargets') throw new Error('Redirect did not ask for new targets');
    const firstIndex = targets.options.findIndex(
      (action) =>
        action.type === 'chooseSpellTargets' &&
        action.targets[0]?.kind === 'permanent' &&
        action.targets[0].oid === firstOid,
    );
    const secondIndex = targets.options.findIndex(
      (action) =>
        action.type === 'chooseSpellTargets' &&
        action.targets[0]?.kind === 'permanent' &&
        action.targets[0].oid === secondOid,
    );
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThanOrEqual(0);

    const projected = projectDecision(state, targets);
    expect(projected.options[firstIndex]).toEqual({
      id: String(firstIndex),
      text: 'Aim Forked Spark at First Host',
      targets: [
        { oid: sparkOid, name: 'Forked Spark' },
        { oid: firstOid, name: 'First Host' },
      ],
    });
    expect(projected.options[secondIndex]).toEqual({
      id: String(secondIndex),
      text: 'Aim Forked Spark at Second Host',
      targets: [
        { oid: sparkOid, name: 'Forked Spark' },
        { oid: secondOid, name: 'Second Host' },
      ],
    });
  });
});

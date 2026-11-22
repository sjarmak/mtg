/**
 * Framing is where hidden information leaks if anywhere does.
 *
 * The referee is handed a state the kernel can see all of, and the frame it
 * sends is the only thing the model ever reads. Libraries and the opponent's
 * hand are hidden from the asking player, so they are hidden from the model
 * asked to rule for that player, or a refereed game is a game with a cheat in
 * it.
 */
import { describe, expect, it } from 'vitest';
import { exampleCard, parseCard } from '@mtg/dsl';
import type { AgentView, GameState } from '@mtg/kernel';
import { copiableValuesOf, scenario } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { frameDecision, REFEREE_SYSTEM, renderFrame } from '@mtg/referee';
import { blockingView, cappedTargetingPosition, viewFor } from './positions';

const GOLEM = exampleCard('slc-ironclad-golem');
const GUARDIAN = exampleCard('slc-thornhide-guardian');
const LASH = exampleCard('slc-lightning-lash');
const VERDICT = exampleCard('slc-mortal-verdict');
// Two cards that appear in exactly one hidden zone each, so an assertion about
// their names is an assertion about that zone and nothing else.
const DRAKE = exampleCard('slc-windrider-drake');
const STALKER = exampleCard('slc-graveblade-stalker');

const CAPTIVATING_VAMPIRE = parseCard({
  kind: 'creature',
  id: 'referee-captivating-vampire',
  name: 'Captivating Vampire',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 87 },
  manaCost: { generic: 1, B: 2 },
  colors: ['B'],
  subtypes: ['Vampire'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapMatching: { count: 5, filter: { subtypes: ['Vampire'] } } },
      effects: [
        { kind: 'gainControl', target: { kind: 'targetCreature' } },
        { kind: 'addSubtype', subtype: 'Vampire', target: { kind: 'thatCreature' } },
      ],
    },
  ],
});

function cohortCreature(name: string, collectorNumber: number, subtype: string) {
  return parseCard({
    kind: 'creature',
    id: `referee-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'REF', collectorNumber },
    manaCost: { generic: 1 },
    colors: [],
    subtypes: [subtype],
    power: 1,
    toughness: 1,
  });
}

const COPY_SHELL = cohortCreature('Cohort Copy Shell', 81, 'Shapeshifter');
const COHORT_TARGET = cohortCreature('Cohort Target', 82, 'Bear');
const COHORT_KIN = Array.from({ length: 5 }, (_, index) =>
  cohortCreature(`Cohort Kin ${String(index + 1)}`, 83 + index, 'Vampire'),
);

describe('a framed decision', () => {
  it('frames Populate as a mandatory creature-token copy choice', () => {
    const state = scenario({ battlefield: [{ card: GOLEM, controller: 0, token: true }] }).state;
    const token = state.battlefield[0];
    if (token === undefined) throw new Error('Populate frame board is incomplete');
    const frame = frameDecision({
      state: observeState(state, 0, 'test/frame.test.ts:76'),
      player: 0,
      decision: {
        kind: 'populate',
        player: 0,
        tokens: [token],
        options: [{ type: 'choosePopulateToken', player: 0, token }],
        complete: true,
      },
    });

    expect(frame.question).toContain('Which do you choose?');
    expect(frame.options).toEqual([
      expect.objectContaining({ index: 0, summary: expect.stringContaining('copy of Ironclad Golem') }),
    ]);
  });

  it('numbers every option the kernel enumerated and carries its completeness', () => {
    const view = blockingView();
    const frame = frameDecision(view);

    expect(frame.kind).toBe('declareBlockers');
    expect(frame.asking).toBe(view.player);
    expect(frame.options.map((option) => option.index)).toEqual(
      view.decision.options.map((_, index) => index),
    );
    expect(view.decision.complete).toBe(true);
    expect(frame.enumerationComplete).toBe(true);
    expect(frame.options.every((option) => option.summary.length > 0)).toBe(true);

    // The field is only worth carrying because it is sometimes false: a
    // two-target spell on a 24-creature board is 576 target tuples and the
    // kernel stops at its cap, which is the one gap it admits to and the only
    // input the compile-down backlog has.
    const capped = viewFor(cappedTargetingPosition().state);
    expect(capped.decision.complete).toBe(false);
    expect(frameDecision(capped).enumerationComplete).toBe(false);
    expect(renderFrame(frameDecision(capped))).toContain('this list is a subset');
  });

  it('distinguishes a copied ability by every named cohort tap payment', () => {
    const opened = scenario({
      battlefield: [
        { card: COPY_SHELL, controller: 0 },
        ...COHORT_KIN.map((card) => ({ card, controller: 0 as const })),
        { card: COHORT_TARGET, controller: 1 },
      ],
      step: 'precombatMain',
    }).state;
    const source = opened.battlefield[0];
    const target = opened.battlefield[opened.battlefield.length - 1];
    if (source === undefined || target === undefined) throw new Error('cohort position lost an object');
    const sourceObject = opened.objects[source];
    if (sourceObject === undefined) throw new Error('cohort position lost its source');
    const copied: GameState = {
      ...opened,
      objects: {
        ...opened.objects,
        [source]: { ...sourceObject, copiableCard: CAPTIVATING_VAMPIRE },
      },
    };
    const view = viewFor(copied);
    const frame = frameDecision(view, { maxOptions: 128 });
    const payments = frame.options.flatMap((option) => {
      const action = view.decision.options[option.index];
      return action?.type === 'activateAbility' &&
        action.oid === source &&
        action.targets[0]?.kind === 'permanent' &&
        action.targets[0].oid === target
        ? [{ action, summary: option.summary }]
        : [];
    });

    expect(payments).toHaveLength(6);
    expect(new Set(payments.map(({ summary }) => summary)).size).toBe(6);
    for (const { action, summary } of payments) {
      expect(summary).toContain('Tap five untapped Vampires you control');
      expect(action.taps).toHaveLength(5);
      for (const oid of action.taps ?? []) {
        expect(summary).toContain(`${copiableValuesOf(copied, oid).name} [${oid}]`);
      }
    }
  });

  it('shows divided allocations beside the exact plural targets they belong to', () => {
    const start = scenario({
      battlefield: [{ card: GUARDIAN, controller: 1 }],
      hands: [[LASH], []],
      step: 'precombatMain',
    });
    const spell = start.state.players[0].hand[0];
    const target = start.state.battlefield[0];
    if (spell === undefined || target === undefined)
      throw new Error('referee divided-damage board is incomplete');
    const action = {
      type: 'castSpell',
      player: 0,
      oid: spell,
      targets: [null],
      multiTargets: {
        0: [
          { kind: 'player', player: 1 },
          { kind: 'permanent', oid: target },
        ],
      },
      damageAllocations: { 0: [2, 1] },
    } as const;
    const view: AgentView = {
      state: observeState(start.state, 0, 'test/frame.test.ts:184'),
      player: 0,
      decision: { kind: 'priority', player: 0, options: [action], complete: true },
    };
    const summary = frameDecision(view).options[0]?.summary;

    expect(summary).toContain('effect 1 → player 1 for 2');
    expect(summary).toContain('effect 1 → Thornhide Guardian');
    expect(summary).toContain('for 1)');
  });

  it('never names a card in either library or in the opponent hand', () => {
    const start = scenario({
      battlefield: [
        { card: GOLEM, controller: 0 },
        { card: GUARDIAN, controller: 1 },
      ],
      hands: [[LASH], [VERDICT]],
      // Neither library holds a card that is anywhere else on this board. The
      // asking seat's own library is the arm that matters most: draw order is
      // precisely the thing a referee ruling for that seat must not know, and a
      // leak of it would still produce legal rulings.
      libraries: [
        [DRAKE, DRAKE],
        [STALKER, STALKER],
      ],
      step: 'precombatMain',
    });
    const view = viewFor(start.state);
    const text = renderFrame(frameDecision(view));

    // Player 0 is on the play and owes the decision: their own hand is theirs
    // to see, the other three zones are not.
    expect(view.player).toBe(0);
    expect(text).toContain(LASH.name);
    expect(text).not.toContain(DRAKE.name);
    expect(text).not.toContain(STALKER.name);
    expect(text).not.toContain(VERDICT.name);
    expect(text).toContain('hidden');
  });

  it('reports the opponent hand and both libraries as counts', () => {
    const start = scenario({
      hands: [[LASH], [VERDICT, VERDICT, GOLEM]],
      step: 'precombatMain',
    });
    const view = viewFor(start.state);
    const frame = frameDecision(view);
    // The tuple is seat-ordered, as `GameState.players` is, and player 0 asks.
    const [mine, theirs] = frame.players;
    expect(view.player).toBe(0);

    expect(mine.hand).toHaveLength(1);
    expect(mine.hand?.[0]).toContain(LASH.name);
    expect(theirs.hand).toBeNull();
    expect(theirs.handSize).toBe(3);
    expect(mine.librarySize).toBeGreaterThan(0);
    expect(theirs.librarySize).toBeGreaterThan(0);
  });

  it('shows a prefix of a long option list and says how many it left out', () => {
    const view = blockingView();
    const frame = frameDecision(view, { maxOptions: 2 });

    expect(view.decision.options.length).toBeGreaterThan(2);
    expect(frame.options).toHaveLength(2);
    expect(frame.omittedOptions).toBe(view.decision.options.length - 2);
    // A prefix keeps every shown index addressing the same action it did in the
    // kernel's list, which is what makes the model's answer applicable.
    expect(frame.options[0]?.index).toBe(0);
    expect(frame.options[1]?.index).toBe(1);
    expect(renderFrame(frame)).toContain(`${String(frame.omittedOptions)} further option`);
  });

  it('refuses to build a frame with nothing to choose from', () => {
    // A frame with no options can only be answered wrongly, so the caller hears
    // about it rather than the fallback quietly deciding every ruling.
    expect(() => frameDecision(blockingView(), { maxOptions: 0 })).toThrow('maxOptions');
  });

  it('asks a question the decision kind actually poses', () => {
    const attacking = scenario({
      battlefield: [{ card: GOLEM, controller: 0 }],
      step: 'declareAttackers',
    });
    const attackers = frameDecision(viewFor(attacking.state));
    expect(attackers.kind).toBe('declareAttackers');
    expect(attackers.question).toContain('attack');

    const blockers = frameDecision(blockingView());
    expect(blockers.kind).toBe('declareBlockers');
    expect(blockers.question).toContain('block');

    const priority = frameDecision(viewFor(scenario({ step: 'precombatMain' }).state));
    expect(priority.kind).toBe('priority');
    expect(priority.question).toContain('priority');
  });

  it('names player and planeswalker alternatives in the attack question and options', () => {
    const walker = parseCard({
      kind: 'planeswalker',
      id: 'referee-frame-walker',
      name: 'Frame Arbiter',
      rarity: 'rare',
      set: { code: 'REF', collectorNumber: 1 },
      manaCost: { generic: 3 },
      colors: [],
      supertypes: ['legendary'],
      subtypes: ['Tactician'],
      startingLoyalty: 3,
    });
    const position = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: GOLEM, controller: 0, summoningSick: false },
        { card: walker, controller: 1, loyalty: 1 },
      ],
    }).state;
    const frame = frameDecision(viewFor(position));
    expect(frame.question).toContain('player 1');
    expect(frame.question).toContain('Frame Arbiter');
    expect(frame.question).toContain('planeswalker with 1 loyalty');
    expect(frame.options.some((option) => option.summary.includes('Frame Arbiter'))).toBe(true);
    expect(frame.options.some((option) => option.summary.includes('planeswalker with 1 loyalty'))).toBe(true);
  });
});

describe('the referee system prompt', () => {
  it('states the one thing the model is allowed to return', () => {
    expect(REFEREE_SYSTEM).toContain('index');
    expect(REFEREE_SYSTEM.toLowerCase()).toContain('never');
  });

  it('renders a frame the model can read without the state object', () => {
    const view: AgentView = blockingView();
    const text = renderFrame(frameDecision(view));
    expect(text).toContain('Turn');
    expect(text).toContain('0:');
    expect(text.length).toBeGreaterThan(200);
  });
});

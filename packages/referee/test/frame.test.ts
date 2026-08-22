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
import type { AgentView } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
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

describe('a framed decision', () => {
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

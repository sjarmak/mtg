// @vitest-environment jsdom
/**
 * An activated ability, on the surface a person clicks.
 *
 * The bead's promise is that "enumeration reuses castOptions verbatim, so a new
 * action type reaches the play surface for free". It did not. `Action` grew an
 * arm, four exhaustive switches were never given it, and the measured result in
 * a browser was a button with no words on it, sitting in `PlayView`'s "Other"
 * fallback group, on no permanent at all: `labelOf` fell off the end of its
 * switch and returned `undefined`, and so did `oidsOf`, so `choicesByObject`
 * had nothing to file the choice under.
 *
 * So the assertions are the three things that were wrong. The label says the
 * cost and what the ability does, in the card's own printed words; the choice
 * names the permanent it belongs to; and the kind is one `GROUP_ORDER` places,
 * which is what keeps it out of the fallback bucket.
 */
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { AbilityInput, Card } from '@mtg/dsl';
import { basicLand, parseCard, renderAbility } from '@mtg/dsl';
import type { GameSession, GameState, ObjectId } from '@mtg/kernel';
import { humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import { LEGAL_MOVES_LABEL, PlayView } from '../../src/routes/play/PlayView';
import { buildPrompt, choicesByObject, playableFromHand } from '../../src/routes/play/prompt';
import type { PlayChoice } from '../../src/routes/play/prompt';
import type { SeatNames } from '../../src/routes/play/position';

afterEach(cleanup);

const NAMES: SeatNames = ['Player one', 'Player two'];

/**
 * A found element's text. The workspace tsconfig carries no `lib: dom`, so
 * `HTMLElement` here has no members at all; `click.test.ts` reaches for
 * `textContent` through the same structural cast.
 */
function textOfNode(node: ReturnType<typeof screen.getByRole>): string {
  return (node as unknown as { readonly textContent?: string | null }).textContent ?? '';
}

/** `{1}, {T}: Ashen Beacon deals 1 damage to any target.` */
const PING: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 1 }, tapSelf: true },
  effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
};

const BEACON: Card = parseCard({
  kind: 'artifact',
  id: 'xmp-ashen-beacon',
  name: 'Ashen Beacon',
  rarity: 'uncommon',
  set: { code: 'XMP', collectorNumber: 7 },
  manaCost: { generic: 2 },
  abilities: [PING],
});

const BRIGAND: Card = parseCard({
  kind: 'creature',
  id: 'xmp-brigand-scout',
  name: 'Brigand Scout',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 8 },
  manaCost: { generic: 1, R: 1 },
  colors: ['R'],
  power: 1,
  toughness: 1,
});

const MOUNTAIN = basicLand('Mountain', 'XMP', 250);

function board(): GameState {
  return scenario({
    battlefield: [
      { card: BEACON, controller: 0 },
      { card: BRIGAND, controller: 1 },
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
    ],
  }).state;
}

function activationChoices(state: GameState): readonly PlayChoice[] {
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('no decision pending');
  const prompt = buildPrompt(state, decision, NAMES);
  return prompt.choices.filter((choice) => choice.kind === 'activateAbility');
}

function beaconOid(state: GameState): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === 'Ashen Beacon');
  if (found === undefined) throw new Error('the beacon is not on the battlefield');
  return found;
}

describe('an activated ability in the prompt', () => {
  it('is offered once per legal target, and never with a blank label', () => {
    const state = board();
    const choices = activationChoices(state);
    // `anyTarget` over this board: two players and the one creature. The
    // beacon is an artifact, so it is not a target for its own ping.
    expect(choices).toHaveLength(3);
    for (const choice of choices) {
      expect(choice.label.length).toBeGreaterThan(0);
      expect(choice.label).not.toContain('undefined');
    }
  });

  it('says the cost and what the ability does, in the card printed words', () => {
    const state = board();
    // Read off the parsed card rather than the input literal: `renderAbility`
    // takes the parsed shape, and a fallback to `PING` here would be asserting
    // that the text matches the text this file typed rather than the card's.
    const ability = BEACON.abilities[0];
    if (ability === undefined) throw new Error('the beacon prints no ability');
    const printed = renderAbility(ability, BEACON.name);
    expect(printed).toBe('{1}, {T}: Ashen Beacon deals 1 damage to any target.');
    for (const choice of activationChoices(state)) {
      expect(choice.label).toContain(printed);
      expect(choice.label.startsWith('Activate ')).toBe(true);
    }
  });

  it('names the target it would be aimed at', () => {
    const state = board();
    const labels = activationChoices(state).map((choice) => choice.label);
    expect(labels.some((label) => label.includes('Player two'))).toBe(true);
    // Whose creature it is, said in the label rather than left to the board:
    // this ping can be aimed at either player or at the one creature, and the
    // one creature belongs to the other seat (`mtg-cee`).
    expect(labels.some((label) => label.includes("→ Player two's Brigand Scout"))).toBe(true);
  });

  it('belongs to the permanent it is printed on', () => {
    const state = board();
    const source = beaconOid(state);
    for (const choice of activationChoices(state)) {
      expect(choice.oids).toEqual([source]);
      expect(choice.detail).toBe('Ashen Beacon');
    }
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('no decision pending');
    const prompt = buildPrompt(state, decision, NAMES);
    const onBeacon = choicesByObject(prompt).get(source) ?? [];
    expect(onBeacon.filter((choice) => choice.kind === 'activateAbility')).toHaveLength(3);
  });

  it('does not make the source look like a card that can be played from hand', () => {
    const state = board();
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('no decision pending');
    expect(playableFromHand(buildPrompt(state, decision, NAMES)).size).toBe(0);
  });
});

/**
 * The same three failures, one layer up: what the rail actually draws.
 *
 * `GROUP_ORDER` is the list that decides which heading a choice sits under, and
 * a kind missing from it lands in the unnamed "Other" bucket at the bottom.
 * That bucket exists so a new action type is never invisible, which is exactly
 * why it must not be where a shipped action type lives.
 */
describe('the rail with an activation on it', () => {
  function sessionFor(state: GameState): GameSession {
    return {
      seats: [humanSeat(NAMES[0]), humanSeat(NAMES[1])],
      state,
      events: [],
      result: null,
      pending: pendingDecision(state),
      choices: [],
      decisions: 0,
      // No choice has been recorded, so nothing has committed and nothing is
      // undoable. `@mtg/kernel`'s `undo.ts` carries what closes a boundary.
      beat: null,
      committed: null,
    };
  }

  function railTitles(): readonly string[] {
    const group = screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
    return within(group)
      .queryAllByText(/^(Play|Abilities|Mana|Combat|Hand|Turn|Other)$/)
      .map(textOfNode);
  }

  it('draws the activation under Abilities, not in the Other fallback', () => {
    render(
      createElement(PlayView, {
        session: sessionFor(board()),
        viewer: 0 as const,
        names: NAMES,
        onChoose: () => undefined,
      }),
    );
    const titles = railTitles();
    expect(titles).toContain('Abilities');
    expect(titles).not.toContain('Other');
  });

  it('gives every button words, so none of them is a blank rectangle', () => {
    render(
      createElement(PlayView, {
        session: sessionFor(board()),
        viewer: 0 as const,
        names: NAMES,
        onChoose: () => undefined,
      }),
    );
    const group = screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
    const buttons = within(group).queryAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(textOfNode(button).trim().length).toBeGreaterThan(0);
  });

  /**
   * `mtg-46g`. The three activations are one ability aimed three ways, so the
   * sentence they share is printed once above them and each button carries only
   * its own target. The thing that must not change is what a screen reader
   * hears: the accessible name of every one of the three is still the whole
   * sentence, because a reader lands on a button rather than reading down the
   * column, and a shared line it never reached explains nothing.
   */
  it('prints the shared ability sentence once and keeps it in every name', () => {
    render(
      createElement(PlayView, {
        session: sessionFor(board()),
        viewer: 0 as const,
        names: NAMES,
        onChoose: () => undefined,
      }),
    );
    const group = screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
    const sentence = 'deals 1 damage to any target.';
    const aimed = within(group).queryAllByRole('button', {
      name: new RegExp(`${sentence} → `),
    });
    expect(aimed).toHaveLength(3);
    // Printed on the buttons: never, now that it is printed above them.
    expect(aimed.filter((button) => textOfNode(button).includes(sentence))).toHaveLength(0);
    // And printed above them exactly once, not once per option.
    expect(within(group).queryAllByText(new RegExp(sentence))).toHaveLength(1);
    // A fold removes a repetition and never an option: the three activations
    // are still three buttons among however many the rail holds, and what each
    // one now shows is the end of its own sentence.
    const state = board();
    const targets = activationChoices(state).map((choice) =>
      choice.label.slice(choice.label.indexOf(' → ') + 3),
    );
    expect(aimed.map(textOfNode)).toEqual(targets);
  });
});

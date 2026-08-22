// @vitest-environment jsdom
/**
 * Equipping, on the surface a person plays it on.
 *
 * CR 702.6b landed in the kernel and the generator learned to print weapons,
 * and nothing checked that the table could show either. Three things were
 * measurably wrong, and they are what this file asserts.
 *
 * The rail offered `Activate Equipped creature gets +2/+0. Equip {2} → Merfolk
 * Sentry`: an equip ability carries its meaning in `attach` rather than in
 * `effects` and prints as Magic's two lines, so the button opened by announcing
 * a static ability nobody was activating and buried the move it was actually
 * offering in the middle of the sentence.
 *
 * Taking the move then changed nothing a player could see. `boardPosition` drew
 * the weapon and the creature as two unrelated permanents, and the creature's
 * face kept printing its printed size while the kernel fought combat at the
 * size the layer system reports — 1/3 on the table against 3/3 in `powerOf`,
 * with the derived pair reaching the screen only as a line in the Sizes panel.
 *
 * `activation.test.ts` is the same shape of test one step back, for the
 * ordinary activated ability that reached this surface as a blank button.
 */
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Action, GameSession, GameState, ObjectId } from '@mtg/kernel';
import {
  attachmentOf,
  humanSeat,
  legalActions,
  pendingDecision,
  powerOf,
  reduceAll,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { Card as CardFace, faceAccessibleName, faceDetailText } from '../../src/card/Card';
import { LEGAL_MOVES_LABEL, PlayView } from '../../src/routes/play/PlayView';
import { boardPosition } from '../../src/routes/play/position';
import type { SeatNames } from '../../src/routes/play/position';
import { buildPrompt } from '../../src/routes/play/prompt';
import type { PlayChoice } from '../../src/routes/play/prompt';

afterEach(cleanup);

const NAMES: SeatNames = ['Player one', 'Player two'];

/** The card at the top of the design document's list of named weapons. */
const MOONBLADE: Card = parseCard({
  kind: 'artifact',
  id: 'xmp-moonblade',
  name: 'Moonblade',
  rarity: 'rare',
  set: { code: 'XMP', collectorNumber: 1 },
  manaCost: { generic: 2 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2 } },
      attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
      effects: [],
    },
  ],
});

const MERFOLK_SENTRY: Card = parseCard({
  kind: 'creature',
  id: 'xmp-merfolk-sentry',
  name: 'Merfolk Sentry',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 8 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  power: 1,
  toughness: 3,
});

const ISLAND = basicLand('Island', 'XMP', 251);

const PASS: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

/** A weapon and a creature under one player, with the equip cost payable. */
function board(): GameState {
  return scenario({
    battlefield: [
      { card: MOONBLADE, controller: 0 },
      { card: MERFOLK_SENTRY, controller: 0 },
      { card: ISLAND, controller: 0 },
      { card: ISLAND, controller: 0 },
    ],
  }).state;
}

function named(state: GameState, name: string): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no battlefield object named ${name}`);
  return found;
}

/** The board with the equip paid for and waiting on the stack. */
function activated(): GameState {
  const start = board();
  const equip = legalActions(start).find((action) => action.type === 'activateAbility');
  if (equip === undefined) throw new Error('no equip was offered');
  return reduceAll(start, [equip]).state;
}

/** The board with the sword equipped to the Merfolk and the ability resolved. */
function equipped(): GameState {
  return reduceAll(activated(), PASS).state;
}

function equipChoices(state: GameState): readonly PlayChoice[] {
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('no decision pending');
  return buildPrompt(state, decision, NAMES).choices.filter((choice) => choice.kind === 'activateAbility');
}

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

function show(state: GameState): void {
  render(
    createElement(PlayView, {
      session: sessionFor(state),
      viewer: 0 as const,
      names: NAMES,
      onChoose: () => undefined,
    }),
  );
}

type Node = ReturnType<typeof screen.getByRole>;

function textOfNode(node: Node): string {
  return (node as unknown as { readonly textContent?: string | null }).textContent ?? '';
}

/**
 * A card face by its accessible name, whichever role it carries. A permanent an
 * offered move acts on is a `button` and one with nothing to do is a `group`,
 * and which of the two a face is changes when the weapon becomes equipped.
 */
function faceNamed(name: string): Node {
  const found = [...screen.queryAllByRole('button', { name }), ...screen.queryAllByRole('group', { name })];
  const only = found[0];
  if (only === undefined || found.length > 1) {
    throw new Error(`expected exactly one face named ${name}, found ${String(found.length)}`);
  }
  return only;
}

describe('the equip a weapon offers', () => {
  it('reads as the move, not as the static ability it grants', () => {
    const choices = equipChoices(board());
    expect(choices).toHaveLength(1);
    const [equip] = choices;
    if (equip === undefined) throw new Error('no equip was offered');
    // `mtg-cee`: a target is said as its controller's, so the one Merfolk Sentry
    // on this board reads the same way two of them would.
    expect(equip.label).toBe("Equip {2} → Player one's Merfolk Sentry");
    // The keyword line is the whole label: an equip is not "activated", it is
    // equipped, and Magic prints no other verb for it.
    expect(equip.label).not.toContain('Activate');
    expect(equip.label).not.toContain('\n');
  });

  it('says which weapon is being paid for and what being equipped is worth', () => {
    const [equip] = equipChoices(board());
    if (equip === undefined) throw new Error('no equip was offered');
    expect(equip.detail).toBe('Moonblade · Equipped creature gets +2/+0.');
  });

  it('reaches the rail under Abilities, spelled the same way', () => {
    show(board());
    const group = screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
    expect(within(group).queryAllByText('Abilities')).toHaveLength(1);
    const equip = within(group).getByRole('button', { name: /Equip \{2\}/ });
    expect(textOfNode(equip)).toContain("Equip {2} → Player one's Merfolk Sentry");
    expect(textOfNode(equip)).not.toContain('Activate Equipped creature');
  });
});

describe('the table while the equip is on the stack', () => {
  it('names the weapon on the stack rather than showing an empty one', () => {
    const state = activated();
    expect(state.stack).toHaveLength(1);
    show(state);
    const stack = screen.getByRole('group', { name: 'Stack' });
    // The ability is an object with no card (CR 113.7a), so the row is drawn
    // for the permanent it was printed on. Dropping it left a player who had
    // just paid two mana looking at an empty stack.
    expect(textOfNode(stack)).toContain('Moonblade');
    expect(within(stack).queryAllByText('ability')).toHaveLength(1);
    expect(within(stack).queryAllByText("→ Player one's Merfolk Sentry")).toHaveLength(1);
  });

  it('does not print the source card cost as though it were the activation cost', () => {
    show(activated());
    const stack = screen.getByRole('group', { name: 'Stack' });
    expect(within(stack).queryAllByText('{2}')).toHaveLength(0);
  });
});

describe('the table after the equip resolves', () => {
  it('attaches the weapon in the kernel and says so on the weapon face', () => {
    const state = equipped();
    expect(attachmentOf(state, named(state, 'Moonblade'))).toBe(named(state, 'Merfolk Sentry'));
    show(state);
    expect(screen.queryAllByText('Equipping Merfolk Sentry')).toHaveLength(1);
  });

  it('draws the weapon and the creature as one object, named as one', () => {
    // The relation is laid out now rather than tagged: the pair share a tray,
    // and the tray is a named group so a screen reader is told what the eye is
    // being shown. `EQUIP` in the corner was the whole of it before, and
    // The playtester's report is that a three-letter tag is not attachment.
    show(equipped());
    const tray = screen.getByRole('group', { name: 'Merfolk Sentry, equipped with Moonblade' });
    expect(textOfNode(tray)).toContain('Moonblade');
    expect(textOfNode(tray)).toContain('Merfolk Sentry');
    expect(screen.queryAllByTitle(/^Equipped with/)).toHaveLength(0);
  });

  it('says the size the weapon moved, and names the weapon as what moved it', () => {
    show(equipped());
    // The sentence carries both numbers and where the difference came from, and
    // nothing on the card prints it: the playtester, 2026-08-14, asked for the badge
    // to go and the dotted underline under the foot's pair to carry the fact
    // instead. `../board-marks.test.ts` holds the reasoning and the underline.
    const mark = screen.getByRole('img', { name: 'Now 3/3, printed 1/3, from Moonblade.' });
    expect(textOfNode(mark)).toBe('');
  });

  it('prints the size the layer system reports, never the printed pair', () => {
    const state = equipped();
    const merfolk = named(state, 'Merfolk Sentry');
    expect(powerOf(state, merfolk)).toBe(3);
    expect(toughnessOf(state, merfolk)).toBe(3);
    show(state);
    const face = faceNamed(faceAccessibleName(MERFOLK_SENTRY, { power: 3, toughness: 3 }));
    expect(textOfNode(face)).toContain('3/3');
    // The printed pair is the Sizes panel's business, and the panel says it as
    // a baseline. On the face it would be the number a player counts combat
    // with, and it would be wrong.
    expect(textOfNode(face)).not.toContain('1/3');
  });

  it('leaves an unequipped creature printing its own numbers', () => {
    show(board());
    const face = faceNamed(faceAccessibleName(MERFOLK_SENTRY));
    expect(textOfNode(face)).toContain('1/3');
    expect(screen.queryAllByText('Equipping Merfolk Sentry')).toHaveLength(0);
    expect(screen.queryAllByTitle(/^Equipped with/)).toHaveLength(0);
  });

  it('carries the attachment through the position mapper both ways', () => {
    const state = equipped();
    const permanents = boardPosition(state, 0, NAMES).you.battlefield.permanents;
    const sword = permanents.find((permanent) => permanent.card.name === 'Moonblade');
    const merfolk = permanents.find((permanent) => permanent.card.name === 'Merfolk Sentry');
    expect(sword?.attachedTo).toBe('Merfolk Sentry');
    expect(merfolk?.attachments).toEqual(['Moonblade']);
    expect(merfolk?.stats).toEqual({ power: 3, toughness: 3 });
    // And by key, which is the half the row lays the pair out on: a name cannot
    // tell two copies of one creature apart.
    expect(sword?.attachedToKey).toBe(String(named(state, 'Merfolk Sentry')));
  });
});

/**
 * The other modification `@mtg/dsl` expresses. A board face draws no rules box,
 * so a keyword a weapon granted is a fact with nowhere at all to land: the P/T
 * at least changes a number somebody might notice.
 */
const WIND_TALON: Card = parseCard({
  kind: 'artifact',
  id: 'xmp-wind-talon',
  name: 'Wind Talon',
  rarity: 'uncommon',
  set: { code: 'XMP', collectorNumber: 2 },
  manaCost: { generic: 2 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2 } },
      attach: { modifications: [{ kind: 'grantKeyword', keyword: 'flying' }] },
      effects: [],
    },
  ],
});

function equippedWithTalon(): GameState {
  const start = scenario({
    battlefield: [
      { card: WIND_TALON, controller: 0 },
      { card: MERFOLK_SENTRY, controller: 0 },
      { card: ISLAND, controller: 0 },
      { card: ISLAND, controller: 0 },
    ],
  }).state;
  const equip = legalActions(start).find((action) => action.type === 'activateAbility');
  if (equip === undefined) throw new Error('no equip was offered');
  return reduceAll(reduceAll(start, [equip]).state, PASS).state;
}

describe('a weapon that grants a keyword rather than a size', () => {
  it('is projected as a keyword the card does not print', () => {
    const permanents = boardPosition(equippedWithTalon(), 0, NAMES).you.battlefield.permanents;
    const merfolk = permanents.find((permanent) => permanent.card.name === 'Merfolk Sentry');
    expect(MERFOLK_SENTRY.kind === 'creature' && MERFOLK_SENTRY.keywords).toEqual([]);
    expect(merfolk?.gainedKeywords).toEqual(['flying']);
  });

  it('reaches the table as a mark naming the keyword and the weapon', () => {
    show(equippedWithTalon());
    expect(screen.getByRole('img', { name: 'Gains flying, from Wind Talon.' })).toBeTruthy();
  });

  it('leaves the size alone, so nothing claims a pair was derived', () => {
    show(equippedWithTalon());
    expect(screen.queryAllByRole('img', { name: /^Now / })).toHaveLength(0);
  });
});

describe('a weapon card face', () => {
  it('prints Magic two lines at the size that draws a rules box', () => {
    render(createElement(CardFace, { card: MOONBLADE, size: 'full' }));
    expect(screen.queryAllByText('Equipped creature gets +2/+0.')).toHaveLength(1);
    // The equip cost is a word and a painted symbol (`card/SymbolText.ts`), so
    // the second line is several nodes rather than one. It still reads as
    // `Equip {2}` off the face, which is what the abbreviation keeping its own
    // token text is for.
    const face = screen.getByRole('group', { name: faceAccessibleName(MOONBLADE) });
    const printed = (face as unknown as { readonly textContent: string | null }).textContent ?? '';
    expect(printed).toContain('Equip {2}');
  });

  it('carries both lines as the description at the sizes that drop the box', () => {
    // `board` and `compact` lay out no rules region (`card/anatomy.ts`), so the
    // printed lines reach a reader through `title` or not at all. The collector
    // line is the last of them at every size: the full face no longer draws a
    // footer bar, so the printing's identity lives here too.
    expect(faceDetailText(MOONBLADE)).toBe(
      'Moonblade\nArtifact — Equipment\nEquipped creature gets +2/+0.\nEquip {2}\nXMP 001 · rare · MV 2',
    );
    for (const size of ['board', 'compact'] as const) {
      cleanup();
      render(createElement(CardFace, { card: MOONBLADE, size }));
      const face = screen.getByRole('group', { name: faceAccessibleName(MOONBLADE) });
      const title = (face as unknown as { getAttribute(name: string): string | null }).getAttribute('title');
      expect(title).toBe(faceDetailText(MOONBLADE));
    }
  });
});

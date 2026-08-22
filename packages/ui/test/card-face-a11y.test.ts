// @vitest-environment jsdom
/**
 * What a card face is called, and what it is not called.
 *
 * Nothing in this package asserted the accessible name of a card face until
 * this file, and three UI changes shipped through that hole. Measured in
 * Chromium 151 over the played table, a Swamp in play was announced as
 *
 *     Art pending for slc-swamp Swamp Basic Land — Swamp common
 *
 * which is four fields the face never meant to say in one breath: the art
 * window's production status, an internal card id, the printed name, the type
 * line, and the rarity the seal contributes. A face with no `onSelect` was
 * worse off still, with no accessible name at all, because a `div` carrying no
 * role is not an object a screen reader can perceive.
 *
 * `faceAccessibleName` is the decision and its docblock is the argument. This
 * file holds the three properties that decision has to keep: the name reads the
 * way a player reads a card, it is the same name at all three sizes, and none
 * of the four leaked fields is in it.
 *
 * Testing Library computes the name with the same algorithm the browser does
 * (`dom-accessibility-api`), so `getByRole(..., { name })` is the assertion
 * rather than a read of the attribute that happens to produce it.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Card as DslCard } from '@mtg/dsl';
import {
  BASIC_LANDS,
  EXAMPLE_CARDS,
  formatManaCost,
  isCastable,
  parseCard,
  renderOracleText,
} from '@mtg/dsl';
import { Card, faceAccessibleName, faceDetailText } from '../src/card/Card';
import type { CardSize } from '../src/card/Card';
import { ART_PENDING_LABEL } from '../src/card/ArtSlot';

afterEach(cleanup);

const SIZES: readonly CardSize[] = ['full', 'compact', 'board'];
const ALL_CARDS: readonly DslCard[] = [...EXAMPLE_CARDS, ...BASIC_LANDS];

function named(name: string): DslCard {
  const card = ALL_CARDS.find((entry) => entry.name === name);
  if (card === undefined) throw new Error(`the DSL example set has no card named ${name}`);
  return card;
}

/** The part token of `packages/kernel/test/fuse.test.ts`, printed rather than played. */
const TROPHY_HORN: DslCard = parseCard({
  id: 'xmp-trophy-horn',
  name: 'Trophy Horn',
  kind: 'artifact',
  rarity: 'uncommon',
  set: { code: 'XMP', collectorNumber: 1 },
  manaCost: { generic: 2 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 }, sacrificeSelf: true },
      effects: [{ kind: 'putCounters', counter: 'horn', count: 1, target: { kind: 'targetCreature' } }],
    },
  ],
});

/**
 * A planeswalker, whose fourth spoken field is a starting loyalty rather than
 * a creature's stats. The DSL example set carries none yet — `xmp-vessari-hero-
 * of-time` is the flagship's first — so this is hand-authored, the way
 * `TROPHY_HORN` above is.
 */
const WARDEN: DslCard = parseCard({
  id: 'planeswalker-loyalty-badge',
  name: 'Warden of the Tideglass Vigil',
  kind: 'planeswalker',
  rarity: 'mythic',
  set: { code: 'PWK', collectorNumber: 1 },
  colors: ['G', 'W'],
  subtypes: ['Warden'],
  manaCost: { generic: 2, G: 1, W: 1 },
  startingLoyalty: 5,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 1,
          target: { kind: 'targetCreatureYouControl' },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -2,
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

describe('the name a card face answers to', () => {
  /**
   * The two literals are written out rather than derived from the function
   * under test, because an assertion that asks the implementation what it says
   * and then checks it said that passes whatever it becomes. These are the
   * sentences a player would speak.
   */
  it('reads the card the way a player reads it aloud', () => {
    expect(faceAccessibleName(named('Swamp'))).toBe('Swamp. Basic Land — Swamp.');
    expect(faceAccessibleName(named('Skywatch Sentinel'))).toBe(
      'Skywatch Sentinel. Mana cost {1}{W}. Creature — Bird Soldier. 2/1.',
    );
    expect(faceAccessibleName(TROPHY_HORN)).toBe('Trophy Horn. Mana cost {2}. Artifact.');
    expect(faceAccessibleName(WARDEN)).toBe(
      'Warden of the Tideglass Vigil. Mana cost {2}{W}{G}. Planeswalker — Warden. Loyalty 5.',
    );
  });

  it('gives every face that name at every size, interactive or not', () => {
    for (const size of SIZES) {
      for (const card of [named('Swamp'), named('Skywatch Sentinel'), TROPHY_HORN, WARDEN]) {
        const inert = render(h(Card, { card, size }));
        expect(
          screen.getByRole('group', { name: faceAccessibleName(card) }),
          `${card.id} at ${size}`,
        ).toBeTruthy();
        inert.unmount();

        render(h(Card, { card, size, onSelect: () => undefined }));
        expect(
          screen.getByRole('button', { name: faceAccessibleName(card) }),
          `${card.id} at ${size}, interactive`,
        ).toBeTruthy();
        cleanup();
      }
    }
  });

  /**
   * The regression proper, swept over the whole example set at every size. Each
   * of these four was in the measured name and none of them is on the card: the
   * pending frame is a production status, the id and the art-spec key are
   * internal, and the rarity belongs to the printing rather than to the card
   * being read out.
   */
  it('leaves the art window, the card id and the rarity out of it', () => {
    for (const size of SIZES) {
      for (const card of ALL_CARDS) {
        const name = faceAccessibleName(card);
        const where = `${card.id} at ${size}`;
        expect(name, where).not.toContain(ART_PENDING_LABEL);
        expect(name, where).not.toContain(card.id);
        expect(name, where).not.toContain(card.rarity);

        render(h(Card, { card, size }));
        // The face answers to that name in the tree, not merely in the string.
        expect(screen.getByRole('group', { name }), where).toBeTruthy();
        cleanup();
      }
    }
  });

  /**
   * The fields run together in the measured name because a name built from
   * contents concatenates text nodes with nothing between them: "SwampBasic
   * Land — Swamp" in the DOM, and one space per element in Chromium's own
   * traversal. Neither is a sentence. A face states its own separators.
   */
  it('separates the fields it does carry', () => {
    const name = faceAccessibleName(named('Skywatch Sentinel'));
    expect(name).toContain('Sentinel. Mana cost');
    expect(name).toContain('{1}{W}. Creature');
    expect(name).toContain('Soldier. 2/1.');
    expect(name).not.toContain('SentinelMana');
  });

  it('carries the cost every castable card prints, and none a land does not', () => {
    for (const card of ALL_CARDS) {
      const name = faceAccessibleName(card);
      if (isCastable(card)) {
        expect(name, card.id).toContain(`Mana cost ${formatManaCost(card.manaCost)}`);
      } else {
        expect(name, card.id).not.toContain('Mana cost');
      }
    }
  });

  /**
   * The rules text is a paragraph and a name is what focus says every time it
   * lands, so the text is the face's description instead. Which sizes carry
   * that description and what it says is `./card-face-detail.test.ts`; this
   * file holds only the split.
   */
  it('describes rather than names the rules text', () => {
    const card = TROPHY_HORN;
    const ability = renderOracleText(card);
    expect(ability.length).toBeGreaterThan(0);
    expect(faceAccessibleName(card)).not.toContain(ability);
    expect(faceDetailText(card)).toContain(ability);
  });
});

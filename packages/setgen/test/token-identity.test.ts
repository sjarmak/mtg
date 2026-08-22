/**
 * What a token's identity is, and what the generator's gate says when a set
 * prints two of them under one name.
 *
 * The identity is the **name**, deliberately. `tokenCard` derives a token's card
 * id from the name alone, and that id is the join key for the art manifest, the
 * renderer, the kernel's registry and the Forge token script — so a name is not
 * a label on a token, it is the token. The consequence is that a set in which
 * one name carries two definitions is not a set with two tokens; it is a
 * malformed set, and the only correct response is to report it rather than to
 * disambiguate it.
 *
 * The rejected alternative was identity as name plus power, toughness, subtypes
 * and abilities — hash the shape into the id and let both definitions coexist.
 * That legalizes the game-level bug rather than fixing it (a Golden Direhorn Key is
 * a noncreature artifact while every other Key is a 0/1 creature, and a player
 * reading a block prompt has one word for both), and it moves every existing
 * token id, which is the one thing the art manifest and the Forge scripts cannot
 * absorb.
 *
 * So the check is not "this name appears twice" — the ten cards that agree about
 * a Key are a set doing exactly the right thing, and a check that flagged them
 * would be noise. It is "two incompatible definitions answer to one name", which
 * `tokenNameConflicts` decides by building each `createToken` payload through
 * `tokenCard` and comparing the finished cards.
 *
 * The flagship regression that motivated this is proven against the committed
 * 249-card fixture in a private sibling beside this file, which reads that set
 * by path and so cannot export. These tests build their own cards by hand.
 */
import { describe, expect, it } from 'vitest';
import type { Card, TokenSpecInput } from '@mtg/dsl';
import { mana, parseCard, tokenNameConflicts, validateSetUniqueness } from '@mtg/dsl';
import { checkSetUniqueness, checkTokenNames } from '@mtg/setgen';
import type { Entry, Slot } from '@mtg/setgen';

function slot(id: string): Slot {
  return {
    id,
    index: 0,
    collectorNumber: 1,
    rarity: 'common',
    color: 'B',
    cardKind: 'creature',
    role: 'creature',
    manaValueMin: 2,
    manaValueMax: 2,
    keywords: [],
    effectKinds: [],
    abilityKinds: [],
    auraModifications: [],
    triggerConditions: [],
    mechanics: [],
    archetypes: [],
    signpost: false,
  };
}

/** A Monster that drops one token when it dies, which is the flagship's template. */
function minter(id: string, collectorNumber: number, token: TokenSpecInput): Card {
  return parseCard({
    kind: 'creature',
    id,
    name: id,
    rarity: 'common',
    set: { code: 'XMP', collectorNumber },
    colors: ['B'],
    manaCost: mana({ generic: 1, B: 1 }),
    power: 2,
    toughness: 2,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfDies',
        effects: [{ kind: 'createToken', count: 1, token }],
      },
    ],
  });
}

const KEY: TokenSpecInput = { name: 'Key', power: 0, toughness: 1, subtypes: ['Key'] };
/** The same name with no body: "create two Key tokens. They're artifacts." */
const ARTIFACT_KEY: TokenSpecInput = { name: 'Key', subtypes: ['Key'] };

function entries(...cards: readonly Card[]): Entry[] {
  return cards.map((card, index) => ({ slot: slot(`CB0${String(index + 1)}`), card }));
}

describe('two definitions answering to one token name', () => {
  it('says nothing about a name every card creating it agrees about', () => {
    const many = entries(
      minter('xmp-a', 1, KEY),
      minter('xmp-b', 2, KEY),
      minter('xmp-c', 3, KEY),
      minter('xmp-d', 4, KEY),
    );
    expect(tokenNameConflicts(many.map((entry) => entry.card))).toStrictEqual([]);
    expect(checkTokenNames(many)).toStrictEqual([]);
  });

  it('fails a set where one name is a 0/1 creature on one card and an artifact on another', () => {
    const both = entries(minter('xmp-a', 1, KEY), minter('xmp-b', 2, ARTIFACT_KEY));
    const findings = checkTokenNames(both);
    expect(findings.map((item) => item.code)).toStrictEqual(['DUPLICATE_TOKEN_NAME']);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('"Key"');
    expect(findings[0]?.message).toContain('0/1 vs artifact');
    // Both halves, so the retry round rewrites whichever the model can move
    // rather than keeping whichever the walk happened to reach first.
    expect(findings[0]?.slotIds).toStrictEqual(['CB01', 'CB02']);
  });

  it('fails two bodies of different sizes under one name', () => {
    const both = entries(
      minter('xmp-a', 1, { name: 'Vorn Spare Part', power: 0, toughness: 1, subtypes: ['Construct'] }),
      minter('xmp-b', 2, { name: 'Vorn Spare Part', power: 1, toughness: 1, subtypes: ['Construct'] }),
    );
    const findings = checkTokenNames(both);
    expect(findings.map((item) => item.code)).toStrictEqual(['DUPLICATE_TOKEN_NAME']);
    expect(findings[0]?.message).toContain('0/1 vs 1/1');
  });

  it('says nothing when two names differ, however far apart their shapes are', () => {
    const apart = entries(
      minter('xmp-a', 1, KEY),
      minter('xmp-b', 2, { name: 'Brigand', power: 1, toughness: 1, subtypes: ['Goblin'] }),
    );
    expect(checkTokenNames(apart)).toStrictEqual([]);
  });
});

/**
 * The same fact reaches the generator twice now that `validateSetUniqueness`
 * carries the token walk, and it is reported once. The DSL violation is for a
 * reader holding nothing but a card list; the finding is for the retry loop,
 * which needs the slot ids the violation's `tokens["Key"]` path cannot carry. So
 * `checkSetUniqueness` passes the token codes over and `checkTokenNames` reports
 * them, blamed.
 */
describe('the set-level uniqueness pass and the token check', () => {
  it('reports a token-name conflict once, from the check that can name the slots', () => {
    const both = entries(minter('xmp-a', 1, KEY), minter('xmp-b', 2, ARTIFACT_KEY));
    const cards = both.map((entry) => entry.card);

    expect(validateSetUniqueness(cards).map((item) => item.code)).toStrictEqual(['DUPLICATE_TOKEN_NAME']);
    expect(checkSetUniqueness(both)).toStrictEqual([]);
    expect(checkTokenNames(both).map((item) => item.code)).toStrictEqual(['DUPLICATE_TOKEN_NAME']);
  });

  it('still reports the card-level duplications it always did', () => {
    const twins = entries(minter('xmp-a', 1, KEY), minter('xmp-b', 2, KEY));
    expect(checkSetUniqueness(twins).map((item) => item.code)).toStrictEqual(['DUPLICATE_MECHANICS']);
  });
});

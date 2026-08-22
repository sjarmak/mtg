/**
 * The tokens a set declares, enumerated once.
 *
 * A token is a permanent a player looks at for the whole game, so everything
 * that walks a set's visual surfaces — the art pipeline and its governance check
 * — needs the same answer to "which tokens does this set create, and what card
 * is each one". Deriving that a second time is a second chance to disagree,
 * which is the argument `token.ts` already makes about `tokenCard` itself.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, TokenSpec } from '@mtg/dsl';
import {
  parseCards,
  setTokenCards,
  setTokens,
  TokenSpecSchema,
  tokenCard,
  tokenSlugCollisions,
  validateSetUniqueness,
  validateTokenNames,
  validateTokenSlugCollisions,
} from '@mtg/dsl';

const TROPHY_HORN: TokenSpec = TokenSpecSchema.parse({
  name: 'Direhorn Trophy Horn',
  power: 0,
  toughness: 1,
  subtypes: ['Part'],
});
const KEY: TokenSpec = TokenSpecSchema.parse({ name: 'Key', power: 0, toughness: 1, subtypes: ['Key'] });
/** The same name with no body: "create two Key tokens. They're artifacts." */
const ARTIFACT_KEY: TokenSpec = TokenSpecSchema.parse({ name: 'Key', subtypes: ['Key'] });
/** Two DISTINCT names `tokenSlug` collapses onto one id (mtg-ry1q's own example). */
const TROPHY_HORN_SPACED: TokenSpec = TokenSpecSchema.parse({
  name: 'Trophy Horn Construct',
  power: 0,
  toughness: 1,
  subtypes: ['Construct'],
});
const TROPHY_HORN_HYPHEN: TokenSpec = TokenSpecSchema.parse({
  name: 'Trophy-Horn Construct',
  power: 0,
  toughness: 1,
  subtypes: ['Construct'],
});
/** A second colliding pair from a different axis of the same alphabet: case. */
const RIDER_UPPER: TokenSpec = TokenSpecSchema.parse({
  name: 'RIDER',
  power: 1,
  toughness: 1,
  subtypes: ['Rider'],
});
const RIDER_TITLE: TokenSpec = TokenSpecSchema.parse({
  name: 'Rider',
  power: 1,
  toughness: 1,
  subtypes: ['Rider'],
});

/** A spell whose own effect list creates the token. */
function sorcery(id: string, collectorNumber: number, token: TokenSpec): CardInput {
  return {
    kind: 'sorcery',
    id,
    name: id,
    rarity: 'common',
    set: { code: 'XMP', collectorNumber },
    manaCost: { generic: 1 },
    effects: [{ kind: 'createToken', count: 1, token }],
  };
}

/** A permanent whose activated ability creates it, which is where most of them live. */
function creature(id: string, collectorNumber: number, token: TokenSpec): CardInput {
  return {
    kind: 'creature',
    id,
    name: id,
    rarity: 'common',
    set: { code: 'XMP', collectorNumber },
    manaCost: { generic: 2 },
    power: 2,
    toughness: 2,
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 1 }, sacrificeSelf: true },
        effects: [{ kind: 'createToken', count: 1, token }],
      },
    ],
  };
}

function cards(...inputs: readonly CardInput[]): readonly Card[] {
  return parseCards(inputs);
}

/** A modal spell whose only token-creating mode is not the first one. */
function modalSorcery(id: string, collectorNumber: number, token: TokenSpec): CardInput {
  return {
    kind: 'sorcery',
    id,
    name: id,
    rarity: 'common',
    set: { code: 'XMP', collectorNumber },
    manaCost: { generic: 1 },
    effects: [],
    modes: [
      { effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }] },
      { effects: [{ kind: 'createToken', count: 1, token }] },
    ],
  };
}

describe('setTokens', () => {
  it('finds a token declared in a spell effect list', () => {
    const found = setTokens(cards(sorcery('xmp-a', 1, KEY)));
    expect(found).toHaveLength(1);
    expect(found[0]?.card).toEqual(tokenCard(KEY));
    expect(found[0]?.card.id).toBe('token-key');
    expect(found[0]?.createdBy).toEqual(['xmp-a']);
  });

  it("finds a token declared inside a permanent's ability", () => {
    const found = setTokens(cards(creature('xmp-b', 2, TROPHY_HORN)));
    expect(found.map((entry) => entry.card.id)).toEqual(['token-direhorn-trophy-horn']);
    expect(found[0]?.createdBy).toEqual(['xmp-b']);
  });

  it('reports one token however many cards create it, naming all of them', () => {
    const found = setTokens(cards(sorcery('xmp-a', 1, KEY), creature('xmp-b', 2, KEY)));
    expect(found).toHaveLength(1);
    expect(found[0]?.createdBy).toEqual(['xmp-a', 'xmp-b']);
  });

  it('orders tokens by the first card that creates them, so two runs agree', () => {
    const list = cards(creature('xmp-b', 2, TROPHY_HORN), sorcery('xmp-a', 1, KEY));
    expect(setTokens(list).map((entry) => entry.card.name)).toEqual(['Direhorn Trophy Horn', 'Key']);
  });

  it('is empty for a set that creates none', () => {
    expect(setTokens([])).toEqual([]);
  });

  it('builds each token through tokenCard rather than deriving the card again', () => {
    expect(setTokenCards(cards(sorcery('xmp-a', 1, TROPHY_HORN)))).toEqual([tokenCard(TROPHY_HORN)]);
  });

  /**
   * A modal spell's token-creating effect can live inside any one of its
   * modes, not just an always-printed `effects` list (`checkEffects` requires
   * `effects: []` on a modal card). A walk that reads only `card.effects`
   * would never see this token at all — not "created blank" the way a scored
   * card is, but absent from the art pipeline's whole census of surfaces.
   */
  it('finds a token declared inside a mode of a modal spell', () => {
    const found = setTokens(cards(modalSorcery('xmp-a', 1, KEY)));
    expect(found).toHaveLength(1);
    expect(found[0]?.card).toEqual(tokenCard(KEY));
    expect(found[0]?.createdBy).toEqual(['xmp-a']);
  });

  /**
   * The collapse this walk cannot see, pinned so the reason the uniqueness pass
   * carries `validateTokenNames` is written down beside the walk it protects.
   * A token's identity is its name — `tokenCard` derives the id from the name
   * alone and the art manifest, the renderer and the Forge script all join on
   * it — so two disagreeing specs under one name reduce to one surface here and
   * the second is dropped without a word. The walk is right to do that; the
   * list it was handed is what is wrong, and only a set-level pass can say so.
   */
  it('folds two disagreeing specs under one name into one surface, silently', () => {
    const found = setTokens(cards(creature('xmp-a', 1, KEY), creature('xmp-b', 2, ARTIFACT_KEY)));
    expect(found).toHaveLength(1);
    expect(found[0]?.card).toEqual(tokenCard(KEY));
    expect(found[0]?.createdBy).toEqual(['xmp-a', 'xmp-b']);
  });

  /**
   * The half of `mtg-ry1q` this walk owns: keying by name rather than by
   * `tokenCard(...).id` means two distinct names are never folded into one
   * surface just because `tokenSlug` maps them to the same id. The id
   * collision itself survives in `card.id` — `tokenSlugCollisions` below is
   * what still has to catch that.
   */
  it('keeps two distinct names as two surfaces even when tokenSlug collides them', () => {
    const found = setTokens(
      cards(creature('xmp-a', 1, TROPHY_HORN_SPACED), creature('xmp-b', 2, TROPHY_HORN_HYPHEN)),
    );
    expect(found).toHaveLength(2);
    expect(found.map((entry) => entry.card.name)).toEqual(['Trophy Horn Construct', 'Trophy-Horn Construct']);
    expect(found.map((entry) => entry.createdBy)).toEqual([['xmp-a'], ['xmp-b']]);
    // Both surfaces still carry the id tokenSlug derives, which is why a
    // second pass is what has to flag this rather than this walk staying silent.
    expect(found[0]?.card.id).toBe(found[1]?.card.id);
  });
});

describe('tokenSlugCollisions', () => {
  it('is empty when every surface has its own id', () => {
    const found = cards(sorcery('xmp-a', 1, KEY), creature('xmp-b', 2, TROPHY_HORN));
    expect(tokenSlugCollisions(found)).toEqual([]);
  });

  it('finds a separator collision between two distinct names', () => {
    const found = cards(creature('xmp-a', 1, TROPHY_HORN_SPACED), creature('xmp-b', 2, TROPHY_HORN_HYPHEN));
    const collisions = tokenSlugCollisions(found);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.slug).toBe(tokenCard(TROPHY_HORN_SPACED).id);
    expect(collisions[0]?.names).toEqual(['Trophy Horn Construct', 'Trophy-Horn Construct']);
  });

  it('finds a case-only collision between two distinct names', () => {
    const found = cards(creature('xmp-a', 1, RIDER_UPPER), creature('xmp-b', 2, RIDER_TITLE));
    const collisions = tokenSlugCollisions(found);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.names).toEqual(['RIDER', 'Rider']);
  });
});

describe('validateTokenSlugCollisions', () => {
  it('is clean for a set whose token ids are all distinct', () => {
    const found = cards(sorcery('xmp-a', 1, KEY), creature('xmp-b', 2, TROPHY_HORN));
    expect(validateTokenSlugCollisions(found)).toEqual([]);
  });

  it('flags two distinct names that build the same id', () => {
    const found = cards(creature('xmp-a', 1, TROPHY_HORN_SPACED), creature('xmp-b', 2, TROPHY_HORN_HYPHEN));
    const violations = validateTokenSlugCollisions(found);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('DUPLICATE_TOKEN_ID');
    expect(violations[0]?.message).toContain('"Trophy Horn Construct"');
    expect(violations[0]?.message).toContain('"Trophy-Horn Construct"');
  });
});

describe('validateTokenNames', () => {
  it('is clean when every card creating a name agrees on the token', () => {
    const found = cards(sorcery('xmp-a', 1, KEY), creature('xmp-b', 2, KEY));
    expect(validateTokenNames(found)).toEqual([]);
  });

  it('is clean for two different names, however their shapes differ', () => {
    const found = cards(sorcery('xmp-a', 1, KEY), creature('xmp-b', 2, TROPHY_HORN));
    expect(validateTokenNames(found)).toEqual([]);
  });

  it('flags a creature-body Key against a bodiless-artifact Key', () => {
    const found = cards(creature('xmp-a', 1, KEY), creature('xmp-b', 2, ARTIFACT_KEY));
    const violations = validateTokenNames(found);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('DUPLICATE_TOKEN_NAME');
    expect(violations[0]?.message).toContain('"Key"');
    expect(violations[0]?.message).toContain('xmp-a');
    expect(violations[0]?.message).toContain('xmp-b');
  });

  it('flags two different power/toughness bodies sharing a name', () => {
    const zeroOne: TokenSpec = TokenSpecSchema.parse({
      name: 'Vorn Spare Part',
      power: 0,
      toughness: 1,
      subtypes: ['Construct'],
    });
    const oneOne: TokenSpec = TokenSpecSchema.parse({
      name: 'Vorn Spare Part',
      power: 1,
      toughness: 1,
      subtypes: ['Construct'],
    });
    const found = cards(creature('xmp-a', 1, zeroOne), creature('xmp-b', 2, oneOne));
    const violations = validateTokenNames(found);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('DUPLICATE_TOKEN_NAME');
  });
});

/**
 * The pass that every reader of a card list already runs.
 *
 * `validateTokenNames` was written, tested and correct, and had no production
 * caller: the only check that ran the walk was the generator's own
 * `checkTokenNames`, whose input is an allocation plus a slot-keyed card map —
 * state that exists only inside a live generation run. A set already on disk was
 * therefore never asked. Everything that opens a committed set file (the art
 * pipeline's surface walk, the Forge transpiler, the slice gate, setgen's own
 * `checkSetUniqueness`) runs `validateSetUniqueness`, and that pass compared
 * ids, collector numbers and mechanical fingerprints and said nothing about
 * tokens — so a set carrying two Keys read back clean forever.
 *
 * One name meaning two things is cross-card uniqueness, which is the one thing
 * this pass is for.
 */
describe('validateSetUniqueness carries the token-name pass', () => {
  it('reports a name that two cards in the list define incompatibly', () => {
    const found = cards(creature('xmp-a', 1, KEY), creature('xmp-b', 2, ARTIFACT_KEY));
    expect(validateSetUniqueness(found).map((item) => [item.code, item.path])).toEqual([
      ['DUPLICATE_TOKEN_NAME', 'tokens["Key"]'],
    ]);
  });

  it('says nothing about a list whose token names each mean one thing', () => {
    const found = cards(
      sorcery('xmp-a', 1, KEY),
      creature('xmp-b', 2, KEY),
      creature('xmp-c', 3, TROPHY_HORN),
    );
    expect(validateSetUniqueness(found)).toEqual([]);
  });

  /**
   * `mtg-ry1q`: two distinct names, so `validateTokenNames` (which groups by
   * name) says nothing; `tokenSlug` maps them to one id regardless, and this is
   * the pass that groups by id instead.
   */
  it('reports two distinct names that build the same token id', () => {
    const found = cards(creature('xmp-a', 1, TROPHY_HORN_SPACED), creature('xmp-b', 2, TROPHY_HORN_HYPHEN));
    expect(validateSetUniqueness(found).map((item) => [item.code, item.path])).toEqual([
      ['DUPLICATE_TOKEN_ID', `tokens["${tokenCard(TROPHY_HORN_SPACED).id}"]`],
    ]);
  });
});

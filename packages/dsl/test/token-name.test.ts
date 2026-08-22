/**
 * A token's name is a name, not a paragraph of its rules text.
 *
 * `TokenSpecSchema` caps the field at 80 characters and says nothing else about
 * it, so a generator that packs the token's printed line into the name produces
 * a set that parses, validates, renders and is wrong everywhere the name is
 * shown: on the battlefield, in the oracle text of every card that makes it, in
 * the Forge token script, and — the reason this check was written — as the id of
 * the art the token gets, since `tokenSlug` turns punctuation into hyphens.
 *
 * Observed in a live regeneration of the flagship set: a token named
 * `Wyrmhead Horn — Fuse: Sacrifice this: +1/+1 counter on a creature you control`.
 * Same family as `TOKEN_STATS_INCOMPLETE` and `INVALID_TOKEN_SUBTYPE`: a field
 * whose shape the schema cannot express, checked where the other token fields
 * are checked.
 */
import { describe, expect, it } from 'vitest';
import type { Violation, ViolationCode } from '@mtg/dsl';
import { TOKEN_NAME_MAX_LENGTH, tokenSlug, validateCard } from '@mtg/dsl';

/** A card whose only effect creates a token with the given name. */
function maker(name: string): Record<string, unknown> {
  return {
    kind: 'sorcery',
    id: 'xmp-drop',
    name: 'Drop',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 7 },
    manaCost: { generic: 1 },
    effects: [{ kind: 'createToken', count: 1, token: { name, power: 0, toughness: 1 } }],
  };
}

function codes(violations: readonly Violation[]): ViolationCode[] {
  return violations.map((entry) => entry.code);
}

describe('a token name', () => {
  it('accepts the names real tokens have', () => {
    for (const name of [
      'Key',
      'Part',
      'Direhorn Trophy Horn',
      "Reaper's Scythe",
      'Trophy-Horn Construct',
      'Salvaged Monster Part',
      'Wyrmhead Wing',
    ]) {
      expect(validateCard(maker(name))).toEqual([]);
    }
  });

  it('refuses a name carrying the rules text the model packed into it', () => {
    const found = validateCard(
      maker('Wyrmhead Horn — Fuse: Sacrifice this: +1/+1 counter on a creature you control'),
    );
    expect(codes(found)).toContain('INVALID_TOKEN_NAME');
    expect(found[0]?.path).toBe('effects[0].token.name');
  });

  it('refuses each mark that only rules text carries', () => {
    for (const name of [
      'Horn: Sacrifice this',
      'Horn — Fuse',
      'Horn; Fuse',
      'Horn (a part)',
      'Horn\nFuse',
      '+1/+1 Horn',
      'horn',
    ]) {
      expect(codes(validateCard(maker(name)))).toContain('INVALID_TOKEN_NAME');
    }
  });
});

/**
 * The other half of the rule, and the half the pattern cannot state.
 *
 * A repair told only to take the punctuation out of the observed name produces
 * `Wyvern Horn Fuse Sacrifice This For A Counter On A Creature You Control` — 71
 * characters, every one of them inside the pattern's character classes, inside
 * `TokenSpecSchema`'s 80-character cap, and still the whole activated ability in
 * the name field. The bound is what makes the rule say "a name" rather than "no
 * colons".
 *
 * 40 is measured: every single-face token printing in the card store is 34
 * characters or shorter, and 40 is what `@mtg/setgen` already allows a card name
 * and what `@mtg/ui`'s name-fit ladder is calibrated against. A token is drawn on
 * that same face.
 */
describe('the length of a token name', () => {
  it('is bounded well under the schema cap the field carries', () => {
    expect(TOKEN_NAME_MAX_LENGTH).toBe(40);
  });

  it('accepts a name exactly at the bound and refuses the character after it', () => {
    const atBound = `Aaa${'b'.repeat(TOKEN_NAME_MAX_LENGTH - 3)}`;
    expect(atBound).toHaveLength(TOKEN_NAME_MAX_LENGTH);
    expect(validateCard(maker(atBound))).toEqual([]);

    const overBound = `${atBound}b`;
    const found = validateCard(maker(overBound));
    expect(codes(found)).toContain('INVALID_TOKEN_NAME');
    expect(found[0]?.path).toBe('effects[0].token.name');
    expect(found[0]?.message).toContain(String(TOKEN_NAME_MAX_LENGTH));
  });

  it('refuses the ability written out in plain words, which the pattern admits', () => {
    const depunctuated = 'Wyvern Horn Fuse Sacrifice This For A Counter On A Creature You Control';
    expect(depunctuated).toHaveLength(71);
    expect(codes(validateCard(maker(depunctuated)))).toContain('INVALID_TOKEN_NAME');
  });

  it('accepts the longest token name Magic has printed', () => {
    const longest = 'Shadows Over Innistrad Checklist 2';
    expect(longest.length).toBeLessThanOrEqual(TOKEN_NAME_MAX_LENGTH);
    expect(validateCard(maker(longest))).toEqual([]);
  });
});

/**
 * The comma, which is the mark this rule is really about (`mtg-arg`).
 *
 * The argument and its numbers are on `TOKEN_NAME_PATTERN`; these are the three
 * claims it turns on, held as behavior so that widening the pattern to admit a
 * comma cannot happen without reading the argument first. Each claim is a
 * different one, and the middle one is why the rule exists at all: under the
 * length cap, spelled in plain words, a trigger clause carries no colon and no
 * dash, and the comma that ends it is the entire difference between an ability
 * and a name.
 */
describe('the comma a token name may not carry', () => {
  it('costs the DSL the legendary-style titles real Magic prints', () => {
    for (const title of ['Primo, the Indivisible', 'Voja, Friend to Elves']) {
      expect(codes(validateCard(maker(title)))).toContain('INVALID_TOKEN_NAME');
    }
  });

  it('is the only mark a trigger clause carries inside the length bound', () => {
    const clause = 'When this creature dies, draw a card';
    expect(clause.length).toBeLessThanOrEqual(TOKEN_NAME_MAX_LENGTH);
    expect(codes(validateCard(maker(clause)))).toContain('INVALID_TOKEN_NAME');
  });

  it('cannot be admitted by the grammar of an appositive, which an imperative also fits', () => {
    for (const imperative of ['Horn, Sacrifice This', 'Scythe, Destroy Target Creature']) {
      expect(codes(validateCard(maker(imperative)))).toContain('INVALID_TOKEN_NAME');
    }
  });
});

/**
 * Letters outside ASCII, decided separately from the punctuation.
 *
 * The store offers no game token that wants one, and the id derivation cannot
 * carry one: `tokenSlug` turns every character outside `[a-z0-9]` into a
 * separator, and that slug is the token's card id, which is what the art
 * manifest, the renderer and the Forge token script all join on. So an accented
 * name and the name with the letter knocked out of it are one surface. The
 * second assertion is the containment claim rather than a restatement of the
 * first: it goes red if the slug ever learns to transliterate, which is the
 * change that would make admitting the letter safe.
 */
describe('a letter outside ASCII', () => {
  it('is refused, and the id a token is keyed by says why', () => {
    const accented = 'Rōnin Blade';
    expect(codes(validateCard(maker(accented)))).toContain('INVALID_TOKEN_NAME');
    expect(tokenSlug(accented)).toBe(tokenSlug('R nin Blade'));
  });
});

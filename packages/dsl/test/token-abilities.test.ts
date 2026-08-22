/**
 * A token carries printed abilities, and a token without a body is an artifact.
 *
 * `mtg-bc2.132.7`. The two halves are one change because the flagship set
 * needs them together: "a part token is an artifact whose only ability is Fuse"
 * is a sentence the DSL could not hold in either direction, and a part with a
 * body would be a 0/0 the state-based actions bury on arrival.
 *
 * These are the DSL's half. The kernel plays the same token end to end in
 * `packages/kernel/test/monster-drop.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { TokenSpec, Violation, ViolationCode } from '@mtg/dsl';
import {
  isCreatureTokenSpec,
  ModelTokenSpecSchema,
  renderEffect,
  renderTokenOracleText,
  tokenAbilities,
  TokenSpecSchema,
  tokenCard,
  tokenReferenceName,
  validateCard,
} from '@mtg/dsl';

const FUSE = {
  kind: 'activated',
  cost: { mana: { generic: 1 }, sacrificeSelf: true },
  effects: [{ kind: 'putCounters', counter: 'horn', count: 1, target: { kind: 'targetCreature' } }],
} as const;

const FUSE_TEXT =
  '{1}, Sacrifice Trophy Horn: Put a horn counter on target creature. (A creature with a horn counter gets +1/+1 and has first strike.)';

function token(input: Record<string, unknown>): TokenSpec {
  return TokenSpecSchema.parse(input);
}

const TROPHY_HORN = token({ name: 'Trophy Horn', subtypes: ['Part'], abilities: [FUSE] });

/** A printed ability for a token that has a body, so the name clause is reached. */
const BELL = {
  kind: 'triggered',
  condition: 'selfEnters',
  effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
} as const;

/** A card whose only effect creates the given token. */
function maker(tokenInput: unknown, count = 1): Record<string, unknown> {
  return {
    kind: 'sorcery',
    id: 'xmp-drop',
    name: 'Drop',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 7 },
    manaCost: { generic: 1 },
    effects: [{ kind: 'createToken', count, token: tokenInput }],
  };
}

function codes(violations: readonly Violation[]): ViolationCode[] {
  return violations.map((entry) => entry.code);
}

describe('a token with no body', () => {
  it('is an artifact card with no power or toughness', () => {
    const card = tokenCard(TROPHY_HORN);
    expect(card.kind).toBe('artifact');
    expect(card.power).toBeUndefined();
    expect(card.toughness).toBeUndefined();
    expect(isCreatureTokenSpec(TROPHY_HORN)).toBe(false);
  });

  it('is a creature card the moment it states both stats', () => {
    const body = token({ name: 'Sylvanok', power: 1, toughness: 1 });
    const card = tokenCard(body);
    expect(card.kind).toBe('creature');
    expect(card.power).toBe(1);
    expect(card.toughness).toBe(1);
  });

  it('states both stats or neither', () => {
    const half = validateCard(maker({ name: 'Half', power: 2 }));
    expect(codes(half)).toContain('TOKEN_STATS_INCOMPLETE');
    expect(half[0]?.path).toBe('effects[0].token.toughness');
    expect(validateCard(maker({ name: 'Key' }))).toEqual([]);
  });
});

describe('a token that carries abilities', () => {
  it('prints them as its own rules text', () => {
    expect(renderTokenOracleText(TROPHY_HORN)).toBe(FUSE_TEXT);
    expect(tokenAbilities(TROPHY_HORN)).toHaveLength(1);
    expect(tokenAbilities(token({ name: 'Key' }))).toEqual([]);
  });

  it('names the token, not the creating card, in its own text', () => {
    // `renderAbility` fills CARDNAME slots from the name it is handed, and the
    // name a token's ability sacrifices is the token's.
    expect(renderTokenOracleText(TROPHY_HORN)).toContain('Sacrifice Trophy Horn');
  });

  /**
   * Moved by `mtg-hmb`. The creating card used to quote `FUSE_TEXT` in full,
   * which put the whole Fuse ability inside every card that drops a part and
   * pushed seventeen flagship set cards past the 140-character printed cap,
   * the worst at 258. The name is the pointer now, and the text is printed
   * once, on the token — `renderTokenOracleText` above still returns all of it.
   */
  it('is referenced by name, not quoted, by the card that creates it', () => {
    expect(renderEffect({ kind: 'createToken', count: 1, token: TROPHY_HORN }, 'Silver Direhorn')).toBe(
      "Create a Trophy Horn token. It's an artifact.",
    );
    expect(renderEffect({ kind: 'createToken', count: 2, token: TROPHY_HORN }, 'Silver Direhorn')).toBe(
      "Create two Trophy Horn tokens. They're artifacts.",
    );
  });

  it('leaves the creating card well inside the 140-character printed cap', () => {
    const dropper = renderEffect({ kind: 'createToken', count: 1, token: TROPHY_HORN }, 'Silver Direhorn');
    expect(dropper.length).toBeLessThan(FUSE_TEXT.length);
    expect(`When Silver Direhorn dies, ${dropper}`.length).toBeLessThanOrEqual(140);
  });

  /**
   * The pointer and the card it points at are one derivation: `tokenCard` names
   * the token, and the creating card prints that name through
   * `tokenReferenceName`. A second derivation of a token's identity is what
   * keyed the art manifest apart from the renderer before.
   */
  it('prints the name the token card itself carries', () => {
    const herald = token({ name: 'Herald of Hope', power: 1, toughness: 1, abilities: [BELL] });
    expect(renderEffect({ kind: 'createToken', count: 1, token: herald }, 'Seraphine')).toContain(
      `named ${tokenCard(herald).name}`,
    );
    expect(tokenReferenceName(herald)).toBe(tokenCard(herald).name);
  });

  it('names a bodiless token with no abilities and stops there', () => {
    expect(renderEffect({ kind: 'createToken', count: 1, token: token({ name: 'Key' }) }, 'Brigand')).toBe(
      "Create a Key token. It's an artifact.",
    );
  });

  /**
   * The article is chosen from the token's own name, not fixed at `a`. Every
   * other bodiless token in this suite starts with a consonant, so `a` was
   * right for all of them by accident; an Ancient Gear reads "an".
   */
  it('picks the article from the name, so a vowel-initial part reads "an"', () => {
    expect(
      renderEffect({ kind: 'createToken', count: 1, token: token({ name: 'Ancient Gear' }) }, 'Brigand'),
    ).toBe("Create an Ancient Gear token. It's an artifact.");
  });

  /**
   * Moved by `mtg-hmb`, and the reason the "named" clause exists at all: a
   * creature token's phrase describes its body, so dropping the ability text
   * without naming it would leave the reader nothing to look the token up by.
   * Keywords stay inline — "with flying" is three words, and Magic prints it
   * that way too.
   */
  it('names a creature token whose abilities it no longer prints, and keeps its keywords', () => {
    const herald = token({
      name: 'Herald',
      power: 1,
      toughness: 1,
      colors: ['W'],
      subtypes: ['Spirit'],
      keywords: ['flying'],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
        },
      ],
    });
    expect(renderEffect({ kind: 'createToken', count: 1, token: herald }, 'Seraphine')).toBe(
      'Create a 1/1 white Spirit creature token named Herald with flying.',
    );
    expect(renderTokenOracleText(herald)).toBe('Flying When Herald enters the battlefield, you gain 2 life.');
  });

  it('leaves a vanilla creature token printing exactly what it printed before', () => {
    const spirit = token({
      name: 'Spirit',
      power: 1,
      toughness: 1,
      colors: ['W'],
      subtypes: ['Spirit'],
      keywords: ['flying'],
    });
    expect(renderEffect({ kind: 'createToken', count: 1, token: spirit }, 'Anything')).toBe(
      'Create a 1/1 white Spirit creature token with flying.',
    );
  });
});

describe('a token is held to the rules its own card type is held to', () => {
  it('refuses a self static on an artifact token, as it refuses one on an artifact card', () => {
    const found = validateCard(
      maker({
        name: 'Trophy Horn',
        abilities: [
          {
            kind: 'static',
            scope: 'self',
            modification: { kind: 'statBonus', power: 1, toughness: 1 },
          },
        ],
      }),
    );
    expect(codes(found)).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');
    expect(found[0]?.path).toBe('effects[0].token.abilities[0].scope');
  });

  it('refuses keywords on a bodiless token, which is not a creature', () => {
    const found = validateCard(maker({ name: 'Trophy Horn', keywords: ['flying'] }));
    expect(codes(found)).toContain('KEYWORD_ILLEGAL_ON_CARD_TYPE');
    expect(found[0]?.path).toBe('effects[0].token.keywords');
  });

  it('refuses a free repeatable ability on a token, as it refuses one on a card', () => {
    const found = validateCard(
      maker({
        name: 'Fountain',
        abilities: [
          {
            kind: 'activated',
            cost: { mana: { generic: 0 } },
            effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
          },
        ],
      }),
    );
    expect(codes(found)).toContain('ABILITY_COST_INVALID');
  });

  it('accepts the part token the design document describes', () => {
    expect(validateCard(maker(TROPHY_HORN))).toEqual([]);
  });
});

describe('what a token may not do', () => {
  /**
   * The one narrowing: a token's abilities are the card vocabulary minus
   * `createToken`. An effect that carries a token, inside an ability that a
   * token carries, is a schema with no bottom and a Forge export with no place
   * to declare the inner token — `collectTokenFiles` walks the tokens a *card*
   * declares.
   */
  it('cannot carry an ability that creates another token', () => {
    const found = validateCard(
      maker({
        name: 'Chest',
        abilities: [
          {
            kind: 'activated',
            cost: { mana: { generic: 1 }, sacrificeSelf: true },
            effects: [
              {
                kind: 'createToken',
                count: 1,
                token: { name: 'Trophy Horn' },
              },
            ],
          },
        ],
      }),
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.path).toContain('effects[0].token.abilities[0].effects[0]');
  });

  it('holds more than two abilities to the same cap a card is held to', () => {
    const three = Array.from({ length: 3 }, (_ignored, index) => ({
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'gainLife', amount: index + 1, target: { kind: 'noTarget' } }],
    }));
    expect(validateCard(maker({ name: 'Loud', abilities: three })).length).toBeGreaterThan(0);
  });
});

describe('the shape the generator is shown', () => {
  /**
   * The model's token schema is deliberately the old one. Its JSON Schema is
   * part of every recorded fixture's key (`packages/llm/src/schema.ts` hashes
   * the answer schema), so a field added here renames every fixture in
   * `packages/setgen/fixtures/llm/`, and the whole recorded generator run goes
   * red. Teaching the generator to design a token's abilities is a setgen slice
   * with a re-record behind it.
   */
  it('still requires a body and still has no abilities field', () => {
    const shape = Object.keys(ModelTokenSpecSchema.shape);
    expect(shape).toEqual(['name', 'power', 'toughness', 'colors', 'subtypes', 'keywords']);
    expect(ModelTokenSpecSchema.safeParse({ name: 'Key' }).success).toBe(false);
  });
});

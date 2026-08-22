/**
 * `grantKeywordUntilEndOfTurn`: CR 613.1f, layer 6, for one turn.
 *
 * The DSL could already grant a keyword forever — `grantKeyword` is a printed
 * `StaticModification`, and a lord's line registers a layer-6 record that lives
 * as long as the lord does. What it could not do is grant one for a turn, which
 * is the shape almost every printed keyword grant has, so the entire combat
 * trick family was unprintable. `effects.ts` argues why the duration belongs on
 * a resolved effect rather than on the modification, and `vocabulary.ts` argues
 * why the kind carries no price.
 *
 * This file covers the DSL boundary: the schema, the printed sentence over all
 * nine keywords, and the containment invariant. The kernel half — that the
 * creature actually gains the ability, that the record sits in layer 6, and
 * that it is gone next turn — is `@mtg/kernel`'s file of the same name.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect } from '@mtg/dsl';
import { z } from 'zod';
import {
  ALL_EFFECT_KINDS,
  CardEffectSchema,
  EFFECT_KINDS,
  GRANTABLE_KEYWORDS,
  KEYWORDS,
  legalTargetsFor,
  MODEL_EFFECT_KINDS,
  renderOracleText,
  UNPRICED_EFFECT_KINDS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

function instantInput(effects: readonly Effect[]): Record<string, unknown> {
  return {
    kind: 'instant',
    id: 'xmp-grant-probe',
    name: 'Sudden Updraft Probe',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 32 },
    manaCost: { generic: 1, U: 1 },
    colors: ['U'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  };
}

/** `parseCard` throws on a violation, so a refusal is asserted off the record. */
function codesFor(input: Record<string, unknown>): readonly string[] {
  return validateCard(input as unknown as Card).map((found) => found.code);
}

function textOf(input: Record<string, unknown>): string {
  return renderOracleText(parseCard(input as CardInput));
}

describe('containment: hand-authored vocabulary the model cannot name', () => {
  it('reaches ALL_EFFECT_KINDS and UNPRICED_EFFECT_KINDS and neither priced list', () => {
    const priced: readonly string[] = EFFECT_KINDS;
    const chooseable: readonly string[] = MODEL_EFFECT_KINDS;
    expect(ALL_EFFECT_KINDS).toContain('grantKeywordUntilEndOfTurn');
    expect(UNPRICED_EFFECT_KINDS).toContain('grantKeywordUntilEndOfTurn');
    expect(priced).not.toContain('grantKeywordUntilEndOfTurn');
    expect(chooseable).not.toContain('grantKeywordUntilEndOfTurn');
  });

  it('lands after the member that was last when it arrived', () => {
    const kinds: readonly string[] = UNPRICED_EFFECT_KINDS;
    expect(kinds.indexOf('grantKeywordUntilEndOfTurn')).toBe(kinds.indexOf('untapPermanent') + 1);
  });
});

describe('the printed sentence', () => {
  it('names the subject first, the way a printed grant does', () => {
    expect(
      textOf(
        instantInput([
          { kind: 'grantKeywordUntilEndOfTurn', keyword: 'trample', target: { kind: 'targetCreature' } },
        ]),
      ),
    ).toBe('Target creature gains trample until end of turn.');
  });

  it('prints the narrower English when the card names a creature it controls', () => {
    expect(
      textOf(
        instantInput([
          {
            kind: 'grantKeywordUntilEndOfTurn',
            keyword: 'deathtouch',
            target: { kind: 'targetCreatureYouControl' },
          },
        ]),
      ),
    ).toBe('Target creature you control gains deathtouch until end of turn.');
  });

  /**
   * `firstStrike` is the one keyword whose enum spelling is not its printed
   * one, so it is the one that proves the sentence goes through
   * `KEYWORD_PRINT_NAMES` rather than interpolating the field.
   */
  it('prints every keyword the layer carries, and the two-word one as two words', () => {
    const lines = KEYWORDS.map((keyword) =>
      textOf(
        instantInput([{ kind: 'grantKeywordUntilEndOfTurn', keyword, target: { kind: 'targetCreature' } }]),
      ),
    );
    expect(lines).toContain('Target creature gains first strike until end of turn.');
    expect(lines.every((line) => line.startsWith('Target creature gains '))).toBe(true);
    expect(lines.every((line) => line.endsWith(' until end of turn.'))).toBe(true);
    expect(new Set(lines).size).toBe(KEYWORDS.length);
  });
});

describe('what a card may aim it at', () => {
  it('states the four kinds its row names and no more', () => {
    expect(legalTargetsFor('grantKeywordUntilEndOfTurn')).toStrictEqual([
      'targetCreature',
      'targetCreatureYouControl',
      'selfCreature',
      'noTarget',
    ]);
  });

  /**
   * A permanent that is not a creature has no combat to use any of the nine in,
   * and the layer would honor the grant anyway — so the refusal is the DSL's
   * rather than the kernel's, and it has to be asserted here.
   */
  it('refuses a permanent slot, which the layer would otherwise honor', () => {
    expect(
      codesFor(
        instantInput([
          { kind: 'grantKeywordUntilEndOfTurn', keyword: 'flying', target: { kind: 'targetPermanent' } },
        ]),
      ),
    ).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });

  it('refuses a player slot', () => {
    expect(
      codesFor(
        instantInput([
          { kind: 'grantKeywordUntilEndOfTurn', keyword: 'flying', target: { kind: 'targetPlayer' } },
        ]),
      ),
    ).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });
});

/**
 * Overwhelming Stampede's second clause (M11 189) and Cleaver Riot's whole
 * line: the grant reaching a group rather than a chosen creature.
 *
 * The kind declined a `scope` when it landed, on the argument that reaching a
 * group through the *player* it named was a shape no card wanted. That was
 * true, and it was about the wrong half of the vocabulary: the scopes
 * `mtg-9u18` appended name a region of the board and choose nobody (CR 115.1),
 * which is exactly what "creatures you control" is. So the sweep arrives
 * through the same `SWEEP_FIELD` the pump beside it has carried since, and
 * `SCOPES_LEGAL_ON` admits one member of it, by census.
 */
const STAMPEDE: Effect = {
  kind: 'grantKeywordUntilEndOfTurn',
  keyword: 'trample',
  target: { kind: 'noTarget' },
  scope: 'permanentsYouControl',
  scopeFilter: { cardTypes: ['creature'] },
};

describe('the group a scope reaches', () => {
  it('accepts the mass grant M11 prints', () => {
    expect(codesFor(instantInput([STAMPEDE]))).toStrictEqual([]);
  });

  it('prints the subject group and the plural verb', () => {
    expect(textOf(instantInput([STAMPEDE]))).toBe('Creatures you control gain trample until end of turn.');
  });

  /**
   * The one word that separates the two forms, asserted as the one word: the
   * targeted sentence conjugates for a single creature and the group sentence
   * does not, and nothing else about the line moves.
   */
  it('keeps the singular verb on the targeted form', () => {
    expect(
      textOf(
        instantInput([
          { kind: 'grantKeywordUntilEndOfTurn', keyword: 'trample', target: { kind: 'targetCreature' } },
        ]),
      ),
    ).toBe('Target creature gains trample until end of turn.');
  });

  it('refuses every scope but the one the population prints', () => {
    for (const scope of ['allPermanents', 'permanentsOpponentsControl'] as const) {
      expect(codesFor(instantInput([{ ...STAMPEDE, scope }]))).toContain('ILLEGAL_EFFECT_SCOPE');
    }
  });

  /**
   * The three older scopes read a targeted player, and no printed keyword grant
   * names one — so the row refuses them at the scope rather than at the target,
   * which is what makes the message name the legal list.
   */
  it('refuses a scope that reads its group off a targeted player', () => {
    expect(
      codesFor(
        instantInput([
          {
            kind: 'grantKeywordUntilEndOfTurn',
            keyword: 'trample',
            target: { kind: 'targetPlayer' },
            scope: 'creaturesThatPlayerControls',
          },
        ]),
      ),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
  });

  it('refuses a chosen creature beside the group, which would be a choice nobody reads', () => {
    expect(codesFor(instantInput([{ ...STAMPEDE, target: { kind: 'targetCreature' } }]))).toContain(
      'ILLEGAL_EFFECT_SCOPE',
    );
  });

  it('refuses a slot that names nobody with no group beside it', () => {
    expect(
      codesFor(
        instantInput([
          { kind: 'grantKeywordUntilEndOfTurn', keyword: 'trample', target: { kind: 'noTarget' } },
        ]),
      ),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
  });

  it('refuses a region of the board with nothing saying which permanents in it', () => {
    const { scopeFilter: _dropped, ...unfiltered } = STAMPEDE as Extract<
      Effect,
      { kind: 'grantKeywordUntilEndOfTurn' }
    >;
    expect(codesFor(instantInput([unfiltered as Effect]))).toContain('ILLEGAL_EFFECT_SCOPE');
  });

  it('refuses a filter with no group for it to narrow', () => {
    expect(
      codesFor(
        instantInput([
          {
            kind: 'grantKeywordUntilEndOfTurn',
            keyword: 'trample',
            target: { kind: 'targetCreature' },
            scopeFilter: { cardTypes: ['creature'] },
          },
        ]),
      ),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
  });

  /**
   * The sweep is where "target land gains flying" becomes reachable again: the
   * scope names a region and the filter is the only thing narrowing it, so the
   * rule the targeted row states by leaving `targetPermanent` off has to be
   * stated a second time against the filter.
   */
  it('refuses a group of bodies that take no part in combat', () => {
    for (const cardTypes of [['artifact'], ['artifact', 'enchantment']] as const) {
      expect(codesFor(instantInput([{ ...STAMPEDE, scopeFilter: { cardTypes: [...cardTypes] } }]))).toContain(
        'ILLEGAL_EFFECT_SCOPE',
      );
    }
  });

  /**
   * A filter that narrows by something other than the card type leaves the
   * scope naming every permanent in the region, so it is refused for the same
   * reason and the message says so differently: no card type at all.
   */
  it('refuses a filter that narrows the region by anything but the body', () => {
    expect(codesFor(instantInput([{ ...STAMPEDE, scopeFilter: { subtypes: ['Goblin'] } }]))).toContain(
      'ILLEGAL_EFFECT_SCOPE',
    );
  });

  /**
   * A conjunction is one object that is all of the named types at once, so one
   * creature member carries the whole filter — an artifact creature is a
   * creature, and layer 6 reaches it.
   */
  it('accepts a conjunction one of whose members is a creature', () => {
    expect(
      codesFor(instantInput([{ ...STAMPEDE, scopeFilter: { allCardTypes: ['artifact', 'creature'] } }])),
    ).toStrictEqual([]);
  });
});

/**
 * The keyword *abilities* a grant may name, and Cleaver Riot (M13 125), which
 * is the card that asked for one (`mtg-nhyv.63`).
 *
 * This field read `KeywordSchema` — the evergreen nine — while the printed
 * static beside it had read `GrantableKeywordSchema` since `mtg-nhyv.74`. The
 * asymmetry made "creatures you control have double strike" expressible and
 * "creatures you control gain double strike until end of turn" refusable, which
 * is a rule about the duration a sentence is printed in rather than about what
 * this vocabulary can say. The first claim below is that the two enums are now
 * one enum, asserted off the schemas rather than off a list written twice.
 *
 * Containment does not move. The claim at the top of this file — that
 * `MODEL_EFFECT_KINDS` does not carry this kind at all — is what makes the
 * widening free: `grantKeywordUntilEndOfTurn` is absent from
 * `generatableEffects`, so no answer schema holds this field and no recorded
 * fixture re-addresses. Measured at the time: 0 of the 151 recorded calls under
 * `packages/setgen/fixtures/llm/` mention either the kind or `doubleStrike`,
 * and `packages/setgen/test/answer-schema-freeze.test.ts` holds the bytes.
 */
function grantEffectKeywords(): readonly string[] {
  const option = CardEffectSchema.options.find(
    (candidate) => candidate.shape.kind.value === 'grantKeywordUntilEndOfTurn',
  );
  if (option === undefined) throw new Error('CardEffectSchema no longer carries the grant');
  const shape: Readonly<Record<string, unknown>> = option.shape;
  const keyword = shape['keyword'];
  if (!(keyword instanceof z.ZodEnum)) throw new Error('the grant no longer names an enum');
  return keyword.options.map((value) => String(value));
}

describe('the keyword abilities a grant may name', () => {
  it('reads the same enum the printed static reads', () => {
    expect(grantEffectKeywords()).toStrictEqual([...GRANTABLE_KEYWORDS]);
  });

  it('accepts Cleaver Riot and prints its whole line', () => {
    const riot = instantInput([{ ...STAMPEDE, keyword: 'doubleStrike' }]);
    expect(codesFor(riot)).toStrictEqual([]);
    expect(textOf(riot)).toBe('Creatures you control gain double strike until end of turn.');
  });

  /**
   * `doubleStrike` is the second enum spelling that is not its printed one, so
   * this is `firstStrike`'s claim one table over: the sentence goes through
   * `GRANTABLE_KEYWORD_PRINT_NAMES` rather than interpolating the field.
   */
  it('prints every grantable name, and both two-word ones as two words', () => {
    const lines = GRANTABLE_KEYWORDS.map((keyword) =>
      textOf(
        instantInput([{ kind: 'grantKeywordUntilEndOfTurn', keyword, target: { kind: 'targetCreature' } }]),
      ),
    );
    expect(lines).toContain('Target creature gains first strike until end of turn.');
    expect(lines).toContain('Target creature gains double strike until end of turn.');
    expect(lines).toContain('Target creature gains indestructible until end of turn.');
    expect(lines.every((line) => line.startsWith('Target creature gains '))).toBe(true);
  });

  /**
   * The cast is the second half of the claim. `landwalk` is a keyword ability
   * the DSL has and a grant may not name, and after the widening the compiler
   * refuses it in this position outright — so the runtime refusal has to be
   * asked for through a cast, and the fact that the cast is needed is itself
   * the evidence that the field is an enum rather than a string.
   */
  it('still refuses a name that is on neither list', () => {
    const offList = [
      { kind: 'grantKeywordUntilEndOfTurn', keyword: 'landwalk', target: { kind: 'targetCreature' } },
    ] as unknown as readonly Effect[];
    expect(codesFor(instantInput(offList))).not.toStrictEqual([]);
  });
});

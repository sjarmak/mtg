/**
 * "Untap target Forest", and "target Merfolk creature": the subtype dimension
 * on a target slot, and the two positions printed Magic puts it in.
 *
 * `mtg-nhyv.56`. `TargetFilterSchema` carried five characteristic fields and no
 * subtype, and the docblock above it recorded that absence as a finding: the
 * `mtg-ts5j.3.15` preflight went through its cohort and found nothing naming a
 * creature type or a land type in a target. The cohort was the twenty-three
 * named filtered-battlefield-target cards that lane scoped, and its own note
 * says what it did with the rest — "no named card uses untap, subtype, or
 * controller filters, so those were removed from scope". Over the whole 305-
 * identity M11/M13 population the census reads differently: three identities
 * name one, and two of the three print it in *different* positions.
 *
 *   Arbor Elf          "{T}: Untap target Forest."          a land type, no noun
 *   Merfolk Sovereign  "Target Merfolk creature can't ..."  a creature type, noun kept
 *   Awakener Druid     "target Forest becomes a 4/5 ..."    a land type, no noun
 *
 * That is the objection the old docblock raised — Magic prints "destroy target
 * Zombie" and drops the noun, where every other arm of `targetNounPhrase` keeps
 * it — and the population answers it rather than leaving it to a guess. **The
 * subtype prints where the slot's noun comes from.** On `targetPermanent` the
 * filter already supplies the noun (that is `cardTypeFilterFitsTargetKind`'s
 * whole rule, and why Demolish prints "target artifact or land" rather than
 * "target artifact permanent"), so the subtype supplies it and the noun is
 * dropped: "target Forest". On every other kind the *kind* supplies the noun
 * and a filter can only qualify it, so the subtype is an adjective in front of
 * it: "target Merfolk creature". Both printed sentences come out verbatim, and
 * no other arm of `targetNounPhrase` moves.
 *
 * A subtype and a card type in one filter are refused, which is what keeps the
 * two positions from becoming two spellings of one card: CR 205.3 gives each
 * subtype to exactly one card type, so a filter naming both states the
 * dimension twice, and "target Forest land" and "target Forest" would be the
 * same slot written two ways.
 *
 * The generator cannot reach the field. `ModelTargetSpecSchema` is `{ kind }`
 * and `ModelEffectSchema` carries no `filter`, so the JSON Schema every fill
 * batch is shown is byte-identical and every recorded call still replays.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect } from '../src/index';
import { renderOracleText, validateCard } from '../src/index';
import { parseCard } from '../src/parse';
import { TargetFilterSchema, targetFilterIsEmpty } from '../src/targets';

function instantInput(effects: readonly Effect[]): Record<string, unknown> {
  return {
    kind: 'instant',
    id: 'xmp-subtype-probe',
    name: 'Reedwater Signal',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 4 },
    manaCost: { generic: 1, U: 1 },
    colors: ['U'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  };
}

function card(effects: readonly Effect[]): Card {
  return parseCard(instantInput(effects) as CardInput);
}

/** `parseCard` throws on a violation, so a refusal is asserted off the record. */
function codes(effects: readonly Effect[]): readonly string[] {
  return validateCard(instantInput(effects) as unknown as Card).map((found) => found.code);
}

describe('a subtype on a target filter', () => {
  it('is a field of the filter, and a filter that names one is not empty', () => {
    expect(TargetFilterSchema.parse({ subtypes: ['Merfolk'] })).toEqual({ subtypes: ['Merfolk'] });
    expect(TargetFilterSchema.safeParse({ subtypes: [] }).success).toBe(false);
    expect(targetFilterIsEmpty({ subtypes: ['Merfolk'] })).toBe(false);
  });

  it('is an adjective in front of the noun the kind already prints', () => {
    const printed = card([
      { kind: 'tapPermanent', target: { kind: 'targetCreature', filter: { subtypes: ['Merfolk'] } } },
    ]);
    expect(renderOracleText(printed)).toBe('Tap target Merfolk creature.');
  });

  it('is the noun itself on the one kind whose noun the filter supplies', () => {
    const printed = card([
      { kind: 'untapPermanent', target: { kind: 'targetPermanent', filter: { subtypes: ['Forest'] } } },
    ]);
    expect(renderOracleText(printed)).toBe('Untap target Forest.');
  });

  it('keeps the older adjectives in front of it, closest to the noun last', () => {
    const printed = card([
      {
        kind: 'tapPermanent',
        target: {
          kind: 'targetCreature',
          filter: { subtypes: ['Merfolk'], colors: ['U'], combat: 'attacking' },
        },
      },
    ]);
    expect(renderOracleText(printed)).toBe('Tap target attacking blue Merfolk creature.');
  });

  it('leaves every other arm of the noun phrase where it was', () => {
    const demolish = card([
      {
        kind: 'destroyPermanent',
        target: { kind: 'targetPermanent', filter: { cardTypes: ['artifact', 'land'] } },
      },
    ]);
    expect(renderOracleText(demolish)).toBe('Destroy target artifact or land.');
    const bare = card([{ kind: 'destroyPermanent', target: { kind: 'targetPermanent' } }]);
    expect(renderOracleText(bare)).toBe('Destroy target permanent.');
  });

  it('round-trips through the schema unchanged', () => {
    const effects: readonly Effect[] = [
      { kind: 'untapPermanent', target: { kind: 'targetPermanent', filter: { subtypes: ['Forest'] } } },
    ];
    expect(card(effects).effects).toEqual(effects);
  });
});

describe('the refusals a subtype filter carries', () => {
  it('refuses a subtype beside a card type, because CR 205.3 already fixed it', () => {
    expect(
      codes([
        {
          kind: 'untapPermanent',
          target: { kind: 'targetPermanent', filter: { cardTypes: ['land'], subtypes: ['Forest'] } },
        },
      ]),
    ).toEqual(['ILLEGAL_TARGET_FILTER']);
    expect(
      codes([
        {
          kind: 'untapPermanent',
          target: {
            kind: 'targetPermanent',
            filter: { allCardTypes: ['artifact', 'creature'], subtypes: ['Golem'] },
          },
        },
      ]),
    ).toEqual(['ILLEGAL_TARGET_FILTER']);
  });

  it('refuses a subtype that is not a capitalized word', () => {
    expect(
      codes([
        { kind: 'tapPermanent', target: { kind: 'targetCreature', filter: { subtypes: ['merfolk'] } } },
      ]),
    ).toEqual(['INVALID_SUBTYPE']);
  });

  it('refuses the same subtype named twice', () => {
    expect(
      codes([
        {
          kind: 'tapPermanent',
          target: { kind: 'targetCreature', filter: { subtypes: ['Merfolk', 'Merfolk'] } },
        },
      ]),
    ).toEqual(['ILLEGAL_TARGET_FILTER']);
  });

  it('refuses a filter on a kind that names a player, subtype and all', () => {
    expect(
      codes([
        { kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget', filter: { subtypes: ['Merfolk'] } } },
      ]),
    ).toContain('ILLEGAL_TARGET_FILTER');
  });
});

/**
 * The keyword rider on `pumpUntilEndOfTurn`: "target creature gets +2/+2 and
 * gains flying until end of turn" as one effect over one target (`mtg-oc3f`).
 *
 * ## What was missing, and it was not a verb
 *
 * `pumpUntilEndOfTurn` and `grantKeywordUntilEndOfTurn` both shipped before
 * this file existed, so the two halves of Mighty Leap were each expressible on
 * their own. Writing them as two effects does not print Mighty Leap, and the
 * reason is targeting rather than vocabulary: `targetChoicesForEffects`
 * (`@mtg/kernel`) enumerates one target slot *per effect*, `Action.targets` is
 * parallel to the effect list, and CR 608.2b rechecks each slot on its own. So
 * the two-effect spelling is a spell with two independently chosen targets —
 * which is a real printed template ("target creature gets +2/+0 until end of
 * turn. Target creature gains trample until end of turn.") and a different
 * card. `renderOracleText` says so outright by printing two sentences.
 *
 * The rider is therefore the binder: one slot, one chosen creature, and both
 * modifications land on the body that slot named.
 *
 * ## Why a field and not a kind
 *
 * `putCounters`' `scope` settled this shape of question already: a second kind
 * would be a second row in `EFFECT_EXECUTION`, in `EFFECT_PRICING`, in
 * `EFFECT_RULES`, in the Forge map and in the coverage instrument, every one of
 * them saying "pump, but with a keyword on it". Forge agrees at the far end —
 * its `Pump` API takes `NumAtt`/`NumDef` and `KW` on one line, so the rider
 * exports as one script line rather than two.
 *
 * ## One card, one spelling
 *
 * A +0/+0 pump is still refused with the rider on it, so "gains flying until
 * end of turn" has exactly one encoding and it is `grantKeywordUntilEndOfTurn`.
 * The rider is refused beside a `scope` for the same reason the grant kind
 * carries no `scope` of its own: a mass grant is a capability that kind
 * declined, and reaching it sideways by stapling a pump to it would be the
 * second definition this vocabulary exists to prevent.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { CardEffectSchema, EffectSchema, ModelEffectSchema, renderOracleText, safeParseCard } from '@mtg/dsl';
import { parseCard } from '../src/parse';

/** Mighty Leap (M11 20): `{1}{W}` instant, "+2/+2 and gains flying". */
function mightyLeapInput(): CardInput {
  return {
    kind: 'instant',
    id: 'ref-mighty-leap',
    name: 'Mighty Leap',
    rarity: 'common',
    set: { code: 'REF', collectorNumber: 20 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: 2,
        toughness: 2,
        keyword: 'flying',
        target: { kind: 'targetCreature' },
      },
    ],
  } as CardInput;
}

describe('the keyword rider on pumpUntilEndOfTurn', () => {
  it("is on a card's union and off both the priced one and the model's", () => {
    const effect = {
      kind: 'pumpUntilEndOfTurn',
      power: 2,
      toughness: 2,
      keyword: 'flying',
      target: { kind: 'targetCreature' },
    };
    // Three tiers, and the rider is declared on exactly one of them. The two
    // narrower unions refuse it by name (`mtg-nhyv.69`) instead of dropping the
    // key: a spell priced without the keyword it was going to grant, or a
    // generated card carrying a field its prompt never taught, is now a parse
    // error rather than a quieter card. A recorded fixture key hashes the JSON
    // Schema of `ModelEffectSchema`, and a field it never declares cannot
    // appear in those bytes.
    const authored = CardEffectSchema.parse(effect);
    expect(authored.kind === 'pumpUntilEndOfTurn' && authored.keyword).toBe('flying');

    const priced = EffectSchema.safeParse(effect);
    expect(priced.success).toBe(false);
    expect(priced.error?.issues.map((issue) => issue.message)).toContainEqual(
      expect.stringContaining('"keyword"'),
    );

    const model = ModelEffectSchema.safeParse(effect);
    expect(model.success).toBe(false);
    expect(model.error?.issues.map((issue) => issue.message)).toContainEqual(
      expect.stringContaining('"keyword"'),
    );
  });

  it('prints Mighty Leap as one sentence about one creature', () => {
    const card = parseCard(mightyLeapInput());
    expect(renderOracleText(card)).toBe('Target creature gets +2/+2 and gains flying until end of turn.');
  });

  it('prints Thunder Strike, whose keyword is two printed words', () => {
    const card = parseCard({
      ...mightyLeapInput(),
      id: 'ref-thunder-strike',
      name: 'Thunder Strike',
      set: { code: 'REF', collectorNumber: 158 },
      manaCost: { generic: 1, R: 1 },
      colors: ['R'],
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 2,
          toughness: 0,
          keyword: 'firstStrike',
          target: { kind: 'targetCreature' },
        },
      ],
    } as CardInput);
    expect(renderOracleText(card)).toBe(
      'Target creature gets +2/+0 and gains first strike until end of turn.',
    );
  });

  it('refuses the rider beside a scope, which would be a mass grant by the side door', () => {
    const result = safeParseCard({
      kind: 'sorcery',
      id: 'ref-overrun-by-the-side-door',
      name: 'Trampling Charge',
      rarity: 'rare',
      set: { code: 'REF', collectorNumber: 21 },
      manaCost: { generic: 2, G: 2 },
      colors: ['G'],
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 3,
          toughness: 3,
          keyword: 'trample',
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
          target: { kind: 'noTarget' },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((found) => found.message).join(' ')).toContain(
      'a keyword rider names one body',
    );
  });

  it('refuses the rider on a slot that names no creature', () => {
    const result = safeParseCard({
      kind: 'instant',
      id: 'ref-riderless-charge',
      name: 'Riderless Charge',
      rarity: 'common',
      set: { code: 'REF', collectorNumber: 22 },
      manaCost: { generic: 1, W: 1 },
      colors: ['W'],
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 2,
          toughness: 2,
          keyword: 'flying',
          target: { kind: 'targetPlayer' },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((found) => found.code)).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });

  it('still refuses a +0/+0 pump, so a pure grant keeps its one spelling', () => {
    const result = safeParseCard({
      ...mightyLeapInput(),
      id: 'ref-featherweight',
      name: 'Featherweight',
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 0,
          toughness: 0,
          keyword: 'flying',
          target: { kind: 'targetCreature' },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((found) => found.message).join(' ')).toContain('a +0/+0 pump is a no-op');
  });
});

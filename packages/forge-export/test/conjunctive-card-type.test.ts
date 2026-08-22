/**
 * A conjunctive card type is refused by name, not guessed at.
 *
 * `mtg-nhyv.2` gave the DSL `allCardTypes`, so "each artifact creature you
 * control" is now a sentence a card can say and the kernel can run. Forge's
 * selector grammar plausibly spells that `Creature.Artifact` — and plausibly is
 * the whole problem. Every row in `vocabulary-map.ts` is read off
 * `res/cardsfolder`; this checkout carries only a README under `tools/forge/`,
 * so nothing here can attest that selector. A parity oracle that invents one
 * reports a mismatch as agreement, which is worse than reporting nothing, so
 * the exporter refuses and says which field and why. Writing the mapping is
 * `mtg-17a`, where every other unverified row already sits.
 *
 * The union arm of each pair is the control: `cardTypes` is attested (Demolish
 * is `ValidTgts$ Artifact,Land`) and keeps working, which is what says the
 * refusal is about the new field rather than about filters.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, Effect, EffectInput, TargetFilter } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { forgeFilteredTargets, transpileCard, transpileEffect } from '@mtg/forge-export';
import { mustTranspile, spell } from './helpers';

const CONJUNCTION: TargetFilter = { allCardTypes: ['artifact', 'creature'] };

const NO_SELECTOR =
  'a conjunctive card type ("allCardTypes") has no Forge selector attested in res/cardsfolder, and this exporter does not guess one';

/** Every refusal carries this reason; asserting it pins the cause, not the code. */
function refusalReasons(result: ReturnType<typeof transpileEffect>): readonly string[] {
  if (result.ok) throw new Error('expected a rejection');
  return result.rejections.map((found) => found.message);
}

function transpiled(effect: EffectInput): ReturnType<typeof transpileEffect> {
  return transpileEffect(effect as Effect, 'tst-conjunctive', 'effects[0]');
}

describe('forgeFilteredTargets', () => {
  it('returns null for a conjunction and a selector list for a union', () => {
    expect(forgeFilteredTargets('Permanent', CONJUNCTION, 'base')).toBeNull();
    expect(forgeFilteredTargets('Card', CONJUNCTION, 'qualifier')).toBeNull();
    expect(forgeFilteredTargets('Permanent', { cardTypes: ['artifact', 'land'] }, 'base')).toEqual([
      'Artifact',
      'Land',
    ]);
  });
});

describe('a conjunctive card type reaching the transpiler', () => {
  it('is refused on a target slot, where a union still transpiles', () => {
    expect(
      refusalReasons(
        transpiled({
          kind: 'destroyPermanent',
          target: { kind: 'targetPermanent', filter: CONJUNCTION },
        }),
      ),
    ).toEqual([NO_SELECTOR]);

    const demolish = spell('Union Control', [
      {
        kind: 'destroyPermanent',
        target: { kind: 'targetPermanent', filter: { cardTypes: ['artifact', 'land'] } },
      },
    ]);
    expect(mustTranspile(demolish)).toContain('ValidTgts$ Artifact,Land');
  });

  it('is refused on a sweep, and names the scopeFilter that caused it', () => {
    const result = transpiled({
      kind: 'destroyPermanent',
      scope: 'allPermanents',
      scopeFilter: CONJUNCTION,
      target: { kind: 'noTarget' },
    });
    expect(refusalReasons(result)).toEqual([NO_SELECTOR]);
    if (result.ok) return;
    expect(result.rejections[0]?.path).toBe('effects[0].scopeFilter');
  });

  it('is refused on a spell filter, where the object on the stack is a Card', () => {
    expect(refusalReasons(transpiled({ kind: 'counterSpell', spellFilter: CONJUNCTION }))).toEqual([
      NO_SELECTOR,
    ]);
  });

  /**
   * Steel Overseer's own line, through the whole card. The kernel runs this
   * card; Forge is told it cannot, which is the outcome a parity oracle should
   * produce for a card it has no attested spelling for.
   */
  it('refuses the whole card rather than exporting a widened one', () => {
    const ability: AbilityInput = {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 1,
          scope: 'permanentsYouControl',
          scopeFilter: CONJUNCTION,
          target: { kind: 'noTarget' },
        },
      ],
    };
    const overseer = parseCard({
      kind: 'creature',
      id: 'tst-forge-overseer',
      name: 'Forge Overseer',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 901 },
      manaCost: { generic: 2 },
      colors: [],
      supertypes: [],
      subtypes: ['Construct'],
      keywords: [],
      artifact: true,
      power: 1,
      toughness: 1,
      abilities: [ability],
    } as unknown as Card);

    const result = transpileCard(overseer);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((found) => found.message)).toEqual([NO_SELECTOR]);
  });
});

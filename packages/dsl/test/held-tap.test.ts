/**
 * The rider that makes a tap cost a turn instead of a blocker: `doesNotUntap`
 * on `tapPermanent`.
 *
 * Two properties are worth a file. The first is the wording, which has to be
 * two templates rather than one — a single-target tap says "that creature" and
 * a sweep says "those creatures", and English does not let one string cover
 * both. The second is the freeze, in the shape `opponent-target.test.ts` and
 * `amount.test.ts` state it: the field is on the engine's unions and on none of
 * the model's, because `@mtg/llm` derives a fixture key from the answer schema
 * and a field on `ModelEffectSchema` renames every recorded generation run. The
 * last test is what stops that split silently closing.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Effect } from '@mtg/dsl';
import {
  CardEffectSchema,
  EffectSchema,
  ModelEffectSchema,
  PartBearingModelEffectSchema,
  parseCard,
  renderOracleText,
  ZoneReachingModelEffectSchema,
} from '@mtg/dsl';

const ONE: Effect = { kind: 'tapPermanent', target: { kind: 'targetCreature' }, doesNotUntap: true };
const SWEEP: Effect = {
  kind: 'tapPermanent',
  scope: 'creaturesThatPlayerControls',
  target: { kind: 'targetOpponent' },
  doesNotUntap: true,
};

function spell(kind: 'instant' | 'sorcery', name: string, effects: readonly Effect[]) {
  return parseCard({
    kind,
    id: `xmp-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 1 },
    manaCost: { U: 1 },
    colors: ['U'],
    effects: [...effects],
  });
}

describe('a tap that holds', () => {
  it('parses on both engine unions', () => {
    expect(EffectSchema.parse(ONE)).toEqual(ONE);
    expect(CardEffectSchema.parse(SWEEP)).toEqual(SWEEP);
  });

  /**
   * "Creature" rather than "permanent" in both arms, and that is provable
   * rather than a guess: `UNSCOPED_MAY_NAME_A_PLAYER.tapPermanent` is false, so
   * the unscoped arm can only be pointed at a creature, and `SCOPES_LEGAL_ON`
   * admits only the battlefield-creature scope, so the swept arm can only reach
   * creatures either.
   */
  it('says which creature stays down, in the number the arm reaches', () => {
    expect(renderOracleText(spell('instant', 'Stasis Rune', [ONE]))).toBe(
      "Tap target creature. That creature doesn't untap during its controller's next untap step.",
    );
    expect(renderOracleText(spell('sorcery', 'Sleep of the Thornwood Tree', [SWEEP]))).toBe(
      "Tap all creatures target opponent controls. Those creatures don't untap during their controller's next untap step.",
    );
  });

  it('leaves a bare tap printing exactly the sentence it printed before', () => {
    const bare: Effect = { kind: 'tapPermanent', target: { kind: 'targetCreature' } };
    expect(renderOracleText(spell('instant', 'Bewildering Gust', [bare]))).toBe('Tap target creature.');
  });

  /**
   * The freeze, from both ends. The field is absent from every JSON Schema the
   * model is shown, and an answer that carries it anyway is refused by the name
   * of the key rather than quietly stripped (`mtg-nhyv.69`) — the same fact
   * stated forwards and backwards.
   */
  it('is unreachable from every schema the generator is shown', () => {
    for (const schema of [ModelEffectSchema, PartBearingModelEffectSchema, ZoneReachingModelEffectSchema]) {
      expect(JSON.stringify(z.toJSONSchema(schema, { io: 'output' }))).not.toContain('doesNotUntap');
    }
    const parsed = ModelEffectSchema.safeParse(ONE);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContainEqual(
      expect.stringContaining('doesNotUntap'),
    );
    expect(JSON.stringify(z.toJSONSchema(CardEffectSchema, { io: 'output' }))).toContain('doesNotUntap');
  });
});

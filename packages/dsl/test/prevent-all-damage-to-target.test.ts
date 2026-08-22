/**
 * `preventAllDamageToTarget`: CR 615.1's other printed shape, Dawn Charm's
 * first mode rather than a wider Fog. `preventCombatDamage`'s own docblock in
 * `effects.ts` argues every widening of the blanket primitive away — amount,
 * recipient, the combat restriction — and this is not that primitive grown a
 * field. It is the sibling CR 615 actually prints: one named creature,
 * uncapped, not restricted to combat.
 *
 * This file covers the three surfaces the bead named at the DSL boundary —
 * the schema, the printed sentence, and the containment invariant that keeps
 * the new kind reachable by a hand-authored card and unreachable from the
 * generator. The kernel half, proving the shield actually holds and expires,
 * is `@mtg/kernel`'s `prevent-all-damage-to-target.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect } from '@mtg/dsl';
import {
  ALL_EFFECT_KINDS,
  EFFECT_KINDS,
  legalTargetsFor,
  MODEL_EFFECT_KINDS,
  renderOracleText,
  UNPRICED_EFFECT_KINDS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

function sorceryInput(effects: readonly Effect[]): Record<string, unknown> {
  return {
    kind: 'sorcery',
    id: 'xmp-prevent-target-probe',
    name: 'Restorative Tonic',
    rarity: 'uncommon',
    set: { code: 'XMP', collectorNumber: 30 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
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
    expect(ALL_EFFECT_KINDS).toContain('preventAllDamageToTarget');
    expect(UNPRICED_EFFECT_KINDS).toContain('preventAllDamageToTarget');
    expect(priced).not.toContain('preventAllDamageToTarget');
    expect(chooseable).not.toContain('preventAllDamageToTarget');
  });

  /**
   * Appended rather than inserted: it landed after `chooseFromGraveyard` rather
   * than beside its `preventCombatDamage` sibling, for the reason
   * `life-vocabulary.test.ts` already states for that lane.
   *
   * It was written as a tail assertion and the prose beside it predicted the
   * failure: a tail assertion breaks the first time a later lane appends
   * correctly. `untapPermanent` was that lane, so the claim is now what it
   * should always have been — position relative to the member that was last
   * when this one arrived, which survives every correct append and still fails
   * an insertion.
   */
  it('lands after the member that was last when it arrived', () => {
    const kinds: readonly string[] = UNPRICED_EFFECT_KINDS;
    expect(kinds.indexOf('preventAllDamageToTarget')).toBe(kinds.indexOf('chooseFromGraveyard') + 1);
    const all: readonly string[] = ALL_EFFECT_KINDS;
    expect(all.indexOf('preventAllDamageToTarget')).toBe(all.indexOf('chooseFromGraveyard') + 1);
  });
});

describe('the printed sentence', () => {
  it('prints the bead-requested line for a plain creature target', () => {
    expect(
      textOf(sorceryInput([{ kind: 'preventAllDamageToTarget', target: { kind: 'targetCreature' } }])),
    ).toBe('Until end of turn, prevent all damage to target creature.');
  });
});

describe('the target rules', () => {
  it('names no generatable target but one hand-authored one', () => {
    expect([...legalTargetsFor('preventAllDamageToTarget')]).toEqual(['targetCreature']);
  });

  it('parses a card that names the one legal target', () => {
    expect(
      codesFor(sorceryInput([{ kind: 'preventAllDamageToTarget', target: { kind: 'targetCreature' } }])),
    ).toEqual([]);
  });

  it('refuses a target kind the effect does not legalize', () => {
    expect(
      codesFor(sorceryInput([{ kind: 'preventAllDamageToTarget', target: { kind: 'targetPlayer' } }])),
    ).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });
});

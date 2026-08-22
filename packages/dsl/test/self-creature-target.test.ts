/**
 * The targeting mode that names the ability's own source: "this creature".
 *
 * `TARGET_KINDS` gained `selfCreature` because Fiery Hellhound ("{R}: This
 * creature gets +1/+0 until end of turn.") and Griffin Protector ("Whenever
 * Griffin Protector attacks, this creature gets +1/+1 until end of turn.")
 * print the identical CR 115.6a self-reference on an activated ability and a
 * triggered one respectively, and neither is a CR 115 target: an object that
 * refers to itself is not targeting itself. `triggeringCreature` already
 * proved the pattern — a referent retained outside `StackEntry.targets` — for
 * a kind filled from the *event* that triggered the ability. This kind fills
 * from the ability's own `sourceOid` instead, a fact every ability on the
 * stack carries whether a trigger put it there or a player activated it, so
 * it needs one permission rather than one per condition: the printed card is
 * a creature (`checkSelfCreatureTarget`, `validate/abilities.ts`).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, CardInput, TargetKind } from '../src/index';
import {
  HAND_AUTHORED_TARGETS,
  legalTargetsFor,
  MODEL_TARGET_KINDS,
  renderOracleText,
  restrictionFitsTargetKind,
  safeParseCard,
  TARGET_KINDS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';
import { targetKindsCanCollide } from '../src/targets';

const SELF_CREATURE: TargetKind = 'selfCreature';

/** "{R}: This creature gets +1/+0 until end of turn." — Fiery Hellhound (M11). */
const ACTIVATED_SELF_PUMP: AbilityInput = {
  kind: 'activated',
  cost: { mana: { R: 1 }, tapSelf: false },
  effects: [{ kind: 'pumpUntilEndOfTurn', power: 1, toughness: 0, target: { kind: SELF_CREATURE } }],
};

/**
 * "Whenever CARDNAME attacks, this creature gets +1/+1 until end of turn." —
 * Griffin Protector's shape (M13), on the `selfAttacks` condition every other
 * attack trigger in this test suite already uses.
 */
const TRIGGERED_SELF_PUMP: AbilityInput = {
  kind: 'triggered',
  condition: 'selfAttacks',
  effects: [{ kind: 'pumpUntilEndOfTurn', power: 1, toughness: 1, target: { kind: SELF_CREATURE } }],
};

function creatureInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'creature',
    id: 'xmp-selfcreature-probe',
    name: 'Probe Bear',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 1 },
    manaCost: { generic: 1, R: 1 },
    colors: ['R'],
    subtypes: ['Bear'],
    keywords: [],
    abilities: [],
    power: 2,
    toughness: 2,
    ...overrides,
  };
}

function artifactInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'artifact',
    id: 'xmp-selfcreature-relic',
    name: 'Probe Relic',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 2 },
    manaCost: { generic: 2 },
    abilities: [],
    ...overrides,
  };
}

function instantInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'instant',
    id: 'xmp-selfcreature-bolt',
    name: 'Probe Bolt',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 3 },
    manaCost: { generic: 1, R: 1 },
    colors: ['R'],
    effects: [],
    ...overrides,
  };
}

describe("the targeting mode that names the ability's own source", () => {
  it('is a kind the engine knows and the generator may not choose', () => {
    expect(TARGET_KINDS).toContain(SELF_CREATURE);
    expect([...MODEL_TARGET_KINDS]).not.toContain(SELF_CREATURE);
  });

  it('is hand-authored on pumpUntilEndOfTurn, the only row it answers', () => {
    expect(HAND_AUTHORED_TARGETS['pumpUntilEndOfTurn']).toContain(SELF_CREATURE);
    expect(legalTargetsFor('pumpUntilEndOfTurn')).toContain(SELF_CREATURE);
  });

  it('is legal on both an activated and a triggered ability of a creature card', () => {
    const activated = parseCard(creatureInput({ abilities: [ACTIVATED_SELF_PUMP] }) as CardInput);
    expect(validateCard(activated)).toEqual([]);

    const triggered = parseCard(
      creatureInput({ id: 'xmp-selfcreature-probe-2', abilities: [TRIGGERED_SELF_PUMP] }) as CardInput,
    );
    expect(validateCard(triggered)).toEqual([]);
  });

  it('prints "this creature", the fixed phrase Fiery Hellhound and Griffin Protector both use', () => {
    const activated = parseCard(creatureInput({ abilities: [ACTIVATED_SELF_PUMP] }) as CardInput);
    expect(renderOracleText(activated)).toBe('{R}: This creature gets +1/+0 until end of turn.');

    const triggered = parseCard(
      creatureInput({
        id: 'xmp-selfcreature-probe-2',
        name: 'Probe Griffin',
        abilities: [TRIGGERED_SELF_PUMP],
      }) as CardInput,
    );
    expect(renderOracleText(triggered)).toBe(
      'Whenever Probe Griffin attacks, this creature gets +1/+1 until end of turn.',
    );
  });

  it('is refused on a card that is not a creature, activated or triggered alike', () => {
    const activatedOnRelic = safeParseCard(artifactInput({ abilities: [ACTIVATED_SELF_PUMP] }));
    expect(activatedOnRelic.ok).toBe(false);
    if (activatedOnRelic.ok) return;
    expect(activatedOnRelic.violations.map((found) => found.code)).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');

    const triggeredOnRelic = safeParseCard(
      artifactInput({ id: 'xmp-selfcreature-relic-2', abilities: [TRIGGERED_SELF_PUMP] }),
    );
    expect(triggeredOnRelic.ok).toBe(false);
    if (triggeredOnRelic.ok) return;
    expect(triggeredOnRelic.violations.map((found) => found.code)).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');
  });

  it('is refused on a spell, which has no source body for "this creature" to name', () => {
    const result = safeParseCard(
      instantInput({
        effects: [{ kind: 'pumpUntilEndOfTurn', power: 1, toughness: 0, target: { kind: SELF_CREATURE } }],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((found) => found.code)).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });

  it('carries no target restriction and collides with nothing, the footing triggeringCreature has too', () => {
    expect(restrictionFitsTargetKind(SELF_CREATURE)).toBe(false);
    expect(targetKindsCanCollide(SELF_CREATURE, 'targetCreature')).toBe(false);
    expect(targetKindsCanCollide(SELF_CREATURE, SELF_CREATURE)).toBe(false);
  });
});

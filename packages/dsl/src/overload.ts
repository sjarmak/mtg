/** Structured CR 702.96 alternate casting profiles for hand-authored cards. */
import { z } from 'zod';
import { AmountSchema, PumpAmountSchema } from './amount';
import type { Card } from './card';
import { CardEffectSchema, type Effect } from './effects';
import { formatManaCost, ManaCostSchema } from './mana';
import { effectsFor } from './modal';
import { TargetFilterSchema } from './targets';

export const PERMANENTS_YOU_DONT_CONTROL = 'permanentsYouDontControl' as const;

const NoTargetSchema = z.strictObject({ kind: z.literal('noTarget') });
const OpposingPermanentSweepShape = {
  scope: z.literal(PERMANENTS_YOU_DONT_CONTROL),
  scopeFilter: TargetFilterSchema,
  target: NoTargetSchema,
};
const YourPermanentSweepShape = {
  scope: z.literal('permanentsYouControl'),
  scopeFilter: TargetFilterSchema,
  target: NoTargetSchema,
};

/** Replacement-only instructions withheld from the ordinary Effect schema. */
export const OverloadOnlyEffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('dealDamage'), amount: AmountSchema, ...OpposingPermanentSweepShape }),
  z.strictObject({ kind: z.literal('destroyPermanent'), ...OpposingPermanentSweepShape }),
  z.strictObject({
    kind: z.literal('pumpUntilEndOfTurn'),
    power: PumpAmountSchema,
    toughness: PumpAmountSchema,
    ...OpposingPermanentSweepShape,
  }),
  z.strictObject({ kind: z.literal('tapPermanent'), ...OpposingPermanentSweepShape }),
  z.strictObject({ kind: z.literal('returnToHand'), ...OpposingPermanentSweepShape }),
  z.strictObject({ kind: z.literal('attacksThisTurnIfAble'), ...OpposingPermanentSweepShape }),
  z.strictObject({ kind: z.literal('cantBeBlockedThisTurn'), ...YourPermanentSweepShape }),
  z.strictObject({
    kind: z.literal('counterSpell'),
    spellSelection: z.literal('spellsYouDontControl'),
  }),
]);

export const OverloadEffectSchema = z.union([CardEffectSchema, OverloadOnlyEffectSchema]);
export type OverloadOnlyEffect = z.infer<typeof OverloadOnlyEffectSchema>;
export type OverloadEffect = z.infer<typeof OverloadEffectSchema>;
export type OverloadBoardEffect = Exclude<OverloadOnlyEffect, { readonly kind: 'counterSpell' }>;
export type OpposingTargetCounterSpell = Extract<Effect, { kind: 'counterSpell' }> & {
  readonly spellSelection: 'targetSpellYouDontControl';
};
export type ExecutableSpellEffect = Effect | OverloadOnlyEffect | OpposingTargetCounterSpell;

function isOpposingCounterSweep(
  effect: OverloadEffect | undefined,
): effect is Extract<OverloadOnlyEffect, { kind: 'counterSpell' }> {
  return effect?.kind === 'counterSpell' && 'spellSelection' in effect;
}

export function isOverloadOnlyEffect(effect: ExecutableSpellEffect): effect is OverloadOnlyEffect {
  return OverloadOnlyEffectSchema.safeParse(effect).success;
}

/** The ordinary per-permanent instruction represented by one board replacement. */
export function overloadEffectForMember(effect: OverloadBoardEffect): Effect {
  switch (effect.kind) {
    case 'dealDamage':
      return { kind: effect.kind, amount: effect.amount, target: { kind: 'targetCreature' } };
    case 'destroyPermanent':
      return { kind: effect.kind, target: { kind: 'targetPermanent' } };
    case 'pumpUntilEndOfTurn':
      return {
        kind: effect.kind,
        power: effect.power,
        toughness: effect.toughness,
        target: { kind: 'targetCreature' },
      };
    case 'tapPermanent':
    case 'attacksThisTurnIfAble':
    case 'cantBeBlockedThisTurn':
      return { kind: effect.kind, target: { kind: 'targetCreature' } };
    case 'returnToHand':
      return { kind: effect.kind, target: { kind: 'targetPermanent' } };
  }
}

/**
 * The alternate price and complete replacement effect list printed by Overload.
 *
 * The replacement is authored as effects rather than derived from Oracle text:
 * the kernel never substitutes words or branches on card names. `xSymbols` is
 * outside `ManaCostSchema` because one announced X may occur more than once in
 * this particular price; absent means the ordinary single `{X}` spelling.
 */
export const OverloadProfileSchema = z.strictObject({
  cost: ManaCostSchema,
  xSymbols: z.literal(2).optional(),
  effects: z.array(OverloadEffectSchema).min(1),
});

export type OverloadProfile = z.infer<typeof OverloadProfileSchema>;
export type SpellEffectProfile = 'ordinary' | 'overload';

/** Prints the alternate price, including Street Spasm's repeated X symbol. */
export function formatOverloadCost(profile: OverloadProfile): string {
  if (profile.xSymbols === undefined) return formatManaCost(profile.cost);
  const withoutX = { ...profile.cost, hasX: false };
  return `${'{X}'.repeat(profile.xSymbols)}${formatManaCost(withoutX)}`;
}

/**
 * The one selector for a spell's executable effect list. Enumeration,
 * submission validation, staged plural choices, and resolution all call this
 * function, so an overloaded spell cannot target using one list and resolve
 * using another.
 */
export function spellEffectsFor(card: Card, mode: number | null, profile: 'ordinary'): readonly Effect[];
export function spellEffectsFor(
  card: Card,
  mode: number | null,
  profile: 'overload',
): readonly OverloadEffect[];
export function spellEffectsFor(
  card: Card,
  mode: number | null,
  profile: SpellEffectProfile,
): readonly ExecutableSpellEffect[] {
  if (profile === 'ordinary') {
    const ordinary = effectsFor(card, mode);
    if ((card.kind !== 'instant' && card.kind !== 'sorcery') || card.overload === undefined) return ordinary;
    return ordinary.map((effect, index) =>
      effect.kind === 'counterSpell' && isOpposingCounterSweep(card.overload?.effects[index])
        ? { ...effect, spellSelection: 'targetSpellYouDontControl' as const }
        : effect,
    );
  }
  if ((card.kind !== 'instant' && card.kind !== 'sorcery') || card.overload === undefined) {
    throw new Error('spellEffectsFor: this card has no overload profile');
  }
  if (mode !== null) throw new Error('spellEffectsFor: overload cannot be combined with a modal choice');
  return card.overload.effects;
}

/**
 * The log schema's trigger-context kinds against the DSL's one list.
 *
 * These kinds were written out three times and two of the copies drifted:
 * `selfBlocksOrIsBlockedByGreaterPower` joined the kernel's
 * `TriggerContextKind` and the schema still named two, so the first recorded
 * game in which a flurry-rush trigger reached the stack was refused by its own
 * recorder. The launcher stopped with a zod error that named the two accepted
 * kinds and neither the card nor the condition, which is a long way from the
 * change that caused it.
 *
 * `TRIGGERING_CREATURE_CONDITIONS` in `@mtg/dsl` is now the only list, read by
 * the schema, by the kernel's `TriggerContext` and by the DSL's own validator.
 * The route may not import `@mtg/kernel` (`record.test.ts` fails the build if
 * it does), so the DSL is the one package all three readers can share. This
 * test guards what the import cannot: that the schema is wired to the list at
 * all, and that it still refuses a condition the list does not carry.
 */
import { describe, expect, it } from 'vitest';
import { TRIGGERING_CREATURE_CONDITIONS, TRIGGERING_PLAYER_CONDITIONS } from '@mtg/dsl';
import type { TriggerContext } from '@mtg/kernel';
import { EventSchema, StackEntrySchema } from '../../src/routes/replay/log-schema';

/**
 * The kernel's stack-side name for the same union, asserted in both directions
 * at compile time. A condition added to the DSL's list that the kernel cannot
 * retain a referent under, or a kernel kind the list has no word for, is a type
 * error here rather than a recorded game nobody can load back.
 */
type ListMember = (typeof TRIGGERING_CREATURE_CONDITIONS)[number];
type CreatureTriggerContext = Extract<TriggerContext, { readonly triggeringCreature: string }>;
const everyListMemberIsAKernelKind: readonly CreatureTriggerContext['kind'][] =
  TRIGGERING_CREATURE_CONDITIONS;
const everyKernelKindIsInTheList = (kind: CreatureTriggerContext['kind']): ListMember => kind;
type PlayerListMember = (typeof TRIGGERING_PLAYER_CONDITIONS)[number];
type PlayerTriggerContext = Extract<TriggerContext, { readonly triggeringPlayer: number }>;
const everyPlayerListMemberIsAKernelKind: readonly PlayerTriggerContext['kind'][] =
  TRIGGERING_PLAYER_CONDITIONS;
const everyKernelPlayerKindIsInTheList = (kind: PlayerTriggerContext['kind']): PlayerListMember => kind;

function entryWith(kind: string): unknown {
  return {
    oid: 'ab1',
    controller: 0,
    card: 'o1',
    source: 'o1',
    copiedFrom: null,
    chosenX: null,
    mode: null,
    triggerContext: { kind, triggeringCreature: 'o2', triggeringCreatureIncarnation: 0 },
    sourceCharacteristics: null,
    targets: [],
  };
}

describe('the replay log’s trigger-context kinds', () => {
  it('names the same union the kernel retains a referent under', () => {
    expect(everyListMemberIsAKernelKind).toStrictEqual([...TRIGGERING_CREATURE_CONDITIONS]);
    expect(everyKernelKindIsInTheList('selfDealsCombatDamageToCreature')).toBe(
      'selfDealsCombatDamageToCreature',
    );
    expect(everyPlayerListMemberIsAKernelKind).toStrictEqual([...TRIGGERING_PLAYER_CONDITIONS]);
    expect(everyKernelPlayerKindIsInTheList('opponentDiscardsCard')).toBe('opponentDiscardsCard');
  });

  it('parses every condition that retains a creature', () => {
    for (const kind of TRIGGERING_CREATURE_CONDITIONS) {
      expect(StackEntrySchema.safeParse(entryWith(kind)).success, kind).toBe(true);
    }
  });

  it('retains creature power and toughness on both the stack context and departure event', () => {
    const entry = entryWith('anotherCreatureEnters') as Record<string, unknown>;
    entry.triggerContext = {
      kind: 'anotherCreatureEnters',
      triggeringCreature: 'o2',
      triggeringCreatureIncarnation: 3,
      triggeringCreaturePower: 7,
      triggeringCreatureToughness: 8,
    };
    expect(StackEntrySchema.parse(entry).triggerContext).toEqual(entry.triggerContext);

    expect(
      EventSchema.parse({
        type: 'zoneChanged',
        oid: 'o2',
        from: 'battlefield',
        to: 'graveyard',
        owner: 0,
        departingCreaturePower: 7,
        departingCreatureToughness: 8,
        departingBattlefieldIncarnation: 3,
      }),
    ).toEqual(
      expect.objectContaining({
        departingCreaturePower: 7,
        departingCreatureToughness: 8,
        departingBattlefieldIncarnation: 3,
      }),
    );
  });

  it('parses the distinct stack-object referent without treating it as a card', () => {
    const entry = entryWith('selfEnters') as Record<string, unknown>;
    entry.triggerContext = {
      kind: 'selfBecomesTargetByOpponent',
      triggeringStackObject: 'ab2',
    };
    expect(StackEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('parses every condition that retains a player without inventing a target', () => {
    for (const kind of TRIGGERING_PLAYER_CONDITIONS) {
      const entry = entryWith('selfEnters') as Record<string, unknown>;
      entry.triggerContext = { kind, triggeringPlayer: 1 };
      const parsed = StackEntrySchema.safeParse(entry);
      expect(parsed.success, kind).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toEqual(
          expect.objectContaining({
            targets: [],
            triggerContext: { kind, triggeringPlayer: 1 },
          }),
        );
      }
    }
  });

  it('retains the final amount beside the damaged player for combat-damage triggers', () => {
    const entry = entryWith('selfEnters') as Record<string, unknown>;
    entry.triggerContext = {
      kind: 'selfDealsCombatDamageToPlayer',
      triggeringPlayer: 1,
      triggeringDamageAmount: 2,
    };

    expect(StackEntrySchema.parse(entry).triggerContext).toEqual(entry.triggerContext);
  });

  it('still refuses a condition the list has no word for', () => {
    expect(StackEntrySchema.safeParse(entryWith('selfEnters')).success).toBe(false);
  });
});

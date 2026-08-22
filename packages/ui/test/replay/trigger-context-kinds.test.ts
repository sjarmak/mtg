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
import { TRIGGERING_CREATURE_CONDITIONS } from '@mtg/dsl';
import type { TriggerContext } from '@mtg/kernel';
import { StackEntrySchema } from '../../src/routes/replay/log-schema';

/**
 * The kernel's stack-side name for the same union, asserted in both directions
 * at compile time. A condition added to the DSL's list that the kernel cannot
 * retain a referent under, or a kernel kind the list has no word for, is a type
 * error here rather than a recorded game nobody can load back.
 */
type ListMember = (typeof TRIGGERING_CREATURE_CONDITIONS)[number];
const everyListMemberIsAKernelKind: readonly TriggerContext['kind'][] = TRIGGERING_CREATURE_CONDITIONS;
const everyKernelKindIsInTheList = (kind: TriggerContext['kind']): ListMember => kind;

function entryWith(kind: string): unknown {
  return {
    oid: 'ab1',
    controller: 0,
    card: 'o1',
    source: 'o1',
    copiedFrom: null,
    chosenX: null,
    triggerContext: { kind, triggeringCreature: 'o2' },
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
  });

  it('parses every condition that retains a creature', () => {
    for (const kind of TRIGGERING_CREATURE_CONDITIONS) {
      expect(StackEntrySchema.safeParse(entryWith(kind)).success, kind).toBe(true);
    }
  });

  it('still refuses a condition the list has no word for', () => {
    expect(StackEntrySchema.safeParse(entryWith('selfEnters')).success).toBe(false);
  });
});

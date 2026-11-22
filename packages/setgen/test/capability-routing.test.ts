/** Allocation routes only reviewed role/mechanic intent into fill capability flags. */
import { describe, expect, it } from 'vitest';
import { allocateSlots, buildFillPrompt, fillCapabilitiesFor, parseBrief, roleProfile } from '@mtg/setgen';
import type { FillCapability, SetBriefInput, Slot } from '@mtg/setgen';
import { TEST_BRIEF } from './helpers';

const LARGE = 250;

const ROLE_CASES = [
  ['grantControlledCreatureKeyword', 'W', 'controlledCreatureKeywordGrant'],
  ['untapControlledCreature', 'G', 'untapControlledCreature'],
  ['bounceArtifactOrEnchantment', 'U', 'artifactOrEnchantmentBounce'],
  ['returnOwnCreatureCard', 'B', 'ownGraveyardToHand'],
  ['returnOwnInstantOrSorceryCard', 'R', 'ownGraveyardToHand'],
] as const satisfies readonly (readonly [string, string, FillCapability])[];

function briefWithRole(role: string, pool: string) {
  return parseBrief({
    ...TEST_BRIEF,
    targetSize: LARGE,
    spellRoles: [{ rarity: 'common', pool, roles: [role], why: `exercise the reviewed ${role} capability.` }],
  } as SetBriefInput);
}

function oneRoleSlot(role: string, pool: string): { slot: Slot; prompt: string } {
  const brief = briefWithRole(role, pool);
  const allocation = allocateSlots(brief);
  const slot = allocation.slots.find((candidate) => candidate.role === role);
  if (slot === undefined) throw new Error(`no ${role} slot allocated`);
  return {
    slot,
    prompt: buildFillPrompt({
      brief,
      slots: [slot],
      rarityRules: allocation.profile.rarityRules,
      archetypes: allocation.archetypes,
      priorNames: [],
      sameColorCards: [],
      tierCards: [],
      corrections: new Map(),
      revisions: new Map(),
    }),
  };
}

describe('reviewed spell-role capability routing', () => {
  for (const [role, pool, capability] of ROLE_CASES) {
    it(`routes ${role} through ${capability}`, () => {
      expect(roleProfile(role).capabilities).toStrictEqual([capability]);
      const { slot, prompt } = oneRoleSlot(role, pool);
      expect(slot.capabilities).toStrictEqual([capability]);
      expect(fillCapabilitiesFor([slot])).toContain(capability);
      expect(prompt).toContain(`- ${capability}:`);
    });
  }

  it('does not retrofit a capability onto the old substitution roles', () => {
    for (const role of ['combatTrick', 'fight', 'removalArtifactEnchantment']) {
      expect(roleProfile(role).capabilities).toBeUndefined();
    }
  });
});

describe('reviewed permanent-ability capability routing', () => {
  function mechanicSlots(input: Record<string, unknown>): readonly Slot[] {
    const brief = parseBrief({
      ...TEST_BRIEF,
      targetSize: 90,
      mechanics: [input],
    } as SetBriefInput);
    return allocateSlots(brief).slots.filter((slot) => slot.mechanics.includes(String(input['name'])));
  }

  it('routes a self-entry fight without making fight a spell primitive', () => {
    const slots = mechanicSlots({
      name: 'Ambush',
      description: 'A creature fights an opposing creature as it arrives.',
      abilityKinds: ['triggered'],
      triggerConditions: ['selfEnters'],
      effectKinds: ['fight'],
      colors: ['G'],
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) expect(slot.capabilities).toContain('fightOpposingCreature');
  });

  it('routes the entry-counter contract only as the full trigger/effect bundle', () => {
    const slots = mechanicSlots({
      name: 'Rally',
      description: 'Another creature arriving grows a creature you control.',
      abilityKinds: ['triggered'],
      triggerConditions: ['anotherControlledCreatureEnters'],
      effectKinds: ['putCounters'],
      colors: ['W'],
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.triggerConditions).toStrictEqual(['anotherControlledCreatureEnters']);
      expect(slot.capabilities).toContain('controlledCreatureCounterOnEntry');
    }
  });

  it('refuses the promoted trigger when the rest of its bundle is absent', () => {
    expect(() =>
      parseBrief({
        ...TEST_BRIEF,
        mechanics: [
          {
            name: 'Loose trigger',
            description: 'Names the trigger but not its reviewed counter contract.',
            abilityKinds: ['triggered'],
            triggerConditions: ['anotherControlledCreatureEnters'],
            effectKinds: ['drawCards'],
            colors: ['U'],
          },
        ],
      } as SetBriefInput),
    ).toThrow(/anotherControlledCreatureEnters.*putCounters/);
  });
});

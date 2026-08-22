/**
 * The slots a brief commissions when it asks for an enchantment or a walker.
 *
 * `mtg-fv5s`. Seven roles were added to `ROLE_PROFILES` and none of them appears
 * in the published skeleton, so the only way to reach one is a brief that states
 * it in `spellRoles`. That makes this file the whole of the feature's front
 * door: what the roles say, which of them a brief may state and where, what the
 * allocator seats, which answer schema that batch is then shown, and which
 * sections of the prompt it is shown beside it.
 *
 * The fixture-key property is the reason the last two are checked together. A
 * fixture key hashes (system, prompt, schema), so a batch holding none of these
 * slots has to be shown the bytes it was always shown; a section that leaked
 * into every prompt, or a tier that widened for every batch, would strand every
 * recorded run behind a live re-record. `enchantment-containment.test.ts` checks
 * the schema half from the union's side; this checks it from the batch's.
 */
import { describe, expect, it } from 'vitest';
import {
  allocateSlots,
  ARTIFACT_ROLES,
  buildFillPrompt,
  FillBatchSchema,
  FillBatchWithAbilitiesAndSpellPermanentsSchema,
  FillBatchWithEquipSchema,
  FillBatchWithMechanicsAndSpellPermanentsSchema,
  FillBatchWithSpellPermanentsSchema,
  fillSchemaFor,
  isPlaneswalkerRole,
  isSpellPermanentRole,
  isSpellRole,
  parseBrief,
  printsNoText,
  roleAbilityKinds,
  roleAuraModifications,
} from '@mtg/setgen';
import type { SetBrief, SetBriefInput, Slot } from '@mtg/setgen';
import { briefFromFile, TEST_BRIEF } from './helpers';

/** Large enough that the derivation prints a rare tier; the default 20 does not. */
const LARGE = 250;

/** The six Aura roles, which differ from each other only in what the clause says. */
const AURA_ROLES = [
  'auraPacify',
  'auraEvasion',
  'auraWeaken',
  'auraFury',
  'auraGrowth',
  'auraDominate',
] as const;

function briefWith(overrides: Partial<SetBriefInput>): SetBrief {
  return parseBrief({ ...TEST_BRIEF, targetSize: LARGE, ...overrides });
}

/** A brief that states one role for one tier, which is how every one of these is reached. */
function briefStating(rarity: string, pool: string, role: string): SetBrief {
  return briefWith({
    spellRoles: [{ rarity, pool, roles: [role], why: `the test asks ${pool} for a ${role}.` }],
  } as Partial<SetBriefInput>);
}

function slotsOfRole(brief: SetBrief, role: string): Slot[] {
  return allocateSlots(brief).slots.filter((slot) => slot.role === role);
}

function oneSlotOfRole(brief: SetBrief, role: string): Slot {
  const [slot] = slotsOfRole(brief, role);
  if (slot === undefined) throw new Error(`no slot was allocated for role "${role}"`);
  return slot;
}

describe('what the eight roles say', () => {
  it('names each of them a spell role a brief may state', () => {
    for (const role of [...AURA_ROLES, 'anthem', 'planeswalker']) {
      expect(isSpellRole(role), role).toBe(true);
      expect(isSpellPermanentRole(role), role).toBe(true);
    }
  });

  it('leaves every role that prints a spell or a gear slot outside the permanent set', () => {
    for (const role of ['removalOvercosted', 'burnSmall', 'manaAcceleration', ...ARTIFACT_ROLES]) {
      expect(isSpellPermanentRole(role), role).toBe(false);
      expect(isPlaneswalkerRole(role), role).toBe(false);
    }
  });

  it('gives each Aura role a clause of its own and no ability', () => {
    for (const role of AURA_ROLES) {
      expect(roleAuraModifications(role).length, role).toBeGreaterThan(0);
      expect(roleAbilityKinds(role), role).toStrictEqual([]);
    }
    // Six roles rather than one, and this is what the six buy: a set that
    // states them all prints six Auras that differ by what they do rather than
    // by their numbers.
    const clauses = AURA_ROLES.map((role) => [...roleAuraModifications(role)].sort().join('|'));
    expect(new Set(clauses).size).toBe(AURA_ROLES.length);
  });

  it('gives the anthem an ability and no clause, which is the whole difference', () => {
    expect(roleAbilityKinds('anthem')).toStrictEqual(['static']);
    expect(roleAuraModifications('anthem')).toStrictEqual([]);
  });

  it('gives the walker its activated ability and marks it the one walker role', () => {
    expect(isPlaneswalkerRole('planeswalker')).toBe(true);
    expect(roleAbilityKinds('planeswalker')).toStrictEqual(['activated']);
    expect(roleAuraModifications('planeswalker')).toStrictEqual([]);
    for (const role of AURA_ROLES) expect(isPlaneswalkerRole(role), role).toBe(false);
    expect(isPlaneswalkerRole('anthem')).toBe(false);
  });
});

describe('where a brief may state one', () => {
  it('takes any of the eight in a color', () => {
    for (const role of AURA_ROLES) expect(() => briefStating('common', 'W', role)).not.toThrow();
    expect(() => briefStating('uncommon', 'G', 'anthem')).not.toThrow();
    expect(() => briefStating('rare', 'R', 'planeswalker')).not.toThrow();
  });

  it('refuses one in the colorless pool, where it would silently come back an artifact', () => {
    expect(() => briefStating('common', 'colorless', 'auraPacify')).toThrow(
      /auraPacify role prints an enchantment or a planeswalker, which the colorless pool does not build/,
    );
    expect(() => briefStating('uncommon', 'colorless', 'anthem')).toThrow(/state it for a color/);
    expect(() => briefStating('rare', 'colorless', 'planeswalker')).toThrow(/state it for a color/);
  });

  it('refuses a walker below the rare tier and says which tier stated it', () => {
    expect(() => briefStating('common', 'U', 'planeswalker')).toThrow(
      /planeswalker role is a rare: common U cannot state it/,
    );
    expect(() => briefStating('uncommon', 'B', 'planeswalker')).toThrow(/is a rare: uncommon B/);
  });

  it('holds the rare rule to the walker alone: an Aura is a common in every set that prints one', () => {
    expect(() => briefStating('common', 'W', 'auraPacify')).not.toThrow();
    expect(() => briefStating('common', 'G', 'auraGrowth')).not.toThrow();
  });
});

describe('the slots a stated role allocates', () => {
  it('seats an Aura slot that prints its clause and nothing else', () => {
    const slot = oneSlotOfRole(briefStating('common', 'W', 'auraPacify'), 'auraPacify');
    expect(slot.cardKind).toBe('enchantment');
    expect(slot.color).toBe('W');
    expect(slot.auraModifications).toStrictEqual(['cantAttack', 'cantBlock']);
    expect(slot.effectKinds).toStrictEqual([]);
    expect(slot.abilityKinds).toStrictEqual([]);
    expect(slot.keywords).toStrictEqual([]);
  });

  it('leaves that slot fillable, which it was not before the clause was a term', () => {
    // `printsNoText` reads all four terms. Without `auraModifications` among
    // them an Aura slot reads as a mana cost with nothing under it, and
    // `checkSlotFillability` refuses the one card the slot exists to print.
    const aura = oneSlotOfRole(briefStating('common', 'W', 'auraPacify'), 'auraPacify');
    expect(printsNoText(aura)).toBe(false);
    const anthem = oneSlotOfRole(briefStating('uncommon', 'G', 'anthem'), 'anthem');
    expect(printsNoText(anthem)).toBe(false);
  });

  it('seats an anthem slot that prints a static ability and no clause', () => {
    const slot = oneSlotOfRole(briefStating('uncommon', 'G', 'anthem'), 'anthem');
    expect(slot.cardKind).toBe('enchantment');
    expect(slot.abilityKinds).toStrictEqual(['static']);
    expect(slot.auraModifications).toStrictEqual([]);
    expect(slot.effectKinds).toStrictEqual([]);
  });

  it('seats a walker slot carrying its whole pie-legal menu, un-narrowed by a mechanic', () => {
    // Red is where the test brief prints "Glasscut", whose `dealDamage` is on
    // the walker's menu, so this is the slot a narrowing pass would have cut to
    // one primitive. The bomb-tier exemption narrows nothing either, but it says
    // so in a note; the walker's exemption is taken before that pass runs, so
    // the menu survives and no note names the slot.
    const brief = briefStating('rare', 'R', 'planeswalker');
    const allocation = allocateSlots(brief);
    const slot = allocation.slots.find((candidate) => candidate.role === 'planeswalker');
    if (slot === undefined) throw new Error('no walker slot was allocated');
    expect(slot.cardKind).toBe('planeswalker');
    expect(slot.abilityKinds).toStrictEqual(['activated']);
    expect(slot.auraModifications).toStrictEqual([]);
    expect(slot.effectKinds).toContain('dealDamage');
    expect(slot.effectKinds.length).toBeGreaterThan(1);
    expect(slot.mechanics).toStrictEqual([]);
    expect(allocation.notes.filter((note) => note.startsWith(`${slot.id}:`))).toStrictEqual([]);
  });

  it('costs a walker in the window a Limited deck can answer', () => {
    const slot = oneSlotOfRole(briefStating('rare', 'G', 'planeswalker'), 'planeswalker');
    expect(slot.manaValueMin).toBe(3);
    expect(slot.manaValueMax).toBe(5);
  });

  it('counts an Aura as a card that changes the board rather than an inert one', () => {
    // `isInertRole` reads a role's effect menu, and an Aura names none. Answering
    // that question off the empty list would report the liveliest card in the
    // table as the inert one, and the archetype reservation would convert the
    // slot to a body: a brief that asked for five Auras would print none.
    const slots = slotsOfRole(briefStating('common', 'W', 'auraPacify'), 'auraPacify');
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) expect(slot.cardKind, slot.id).toBe('enchantment');
  });
});

describe('the answer schema the batch is shown', () => {
  const auraSlot = oneSlotOfRole(briefStating('common', 'W', 'auraPacify'), 'auraPacify');
  const anthemSlot = oneSlotOfRole(briefStating('uncommon', 'G', 'anthem'), 'anthem');
  const walkerSlot = oneSlotOfRole(briefStating('rare', 'R', 'planeswalker'), 'planeswalker');

  it('shows an Aura batch the tier whose enchantment member is an Aura', () => {
    expect(fillSchemaFor([auraSlot])).toBe(FillBatchWithSpellPermanentsSchema);
  });

  it('shows a batch holding an ability slot the tier whose enchantment carries one', () => {
    // The anthem is that slot by itself: its `abilityKinds` is what makes the
    // batch want abilities, so the Aura beside it is shown the optional clause.
    expect(fillSchemaFor([anthemSlot])).toBe(FillBatchWithAbilitiesAndSpellPermanentsSchema);
    expect(fillSchemaFor([auraSlot, anthemSlot])).toBe(FillBatchWithAbilitiesAndSpellPermanentsSchema);
  });

  it('shows a walker batch the ability tier, which its own slot line asks for', () => {
    // A walker states `activated` in `abilityKinds` so that `checkAbilityKinds`
    // reads its loyalty abilities back as legal, and `batchWantsAbilities` reads
    // the same field. The widening it buys is a superset the walker itself never
    // fills — its abilities are answered in `loyaltyAbilities` — and it lands on
    // the creature and artifact members beside it, which is where a batch this
    // brief built has always been able to want one.
    expect(fillSchemaFor([walkerSlot])).toBe(FillBatchWithAbilitiesAndSpellPermanentsSchema);
  });

  it('folds the set mechanics in when the brief reserved a slot in the batch', () => {
    const mechanicSlot: Slot = {
      ...auraSlot,
      requiredCard: { name: 'Fused Husk', equipment: false, legendary: false, partCounter: 'horn' },
    };
    expect(fillSchemaFor([auraSlot, mechanicSlot])).toBe(FillBatchWithMechanicsAndSpellPermanentsSchema);
  });

  it('leaves a batch holding none of them exactly where it was', () => {
    // Read off a shipped brief rather than a hand-built slot, because the claim
    // is about the tier a real allocation lands in. Which brief has to be one
    // this file may name: the public-boundary gate rewrites a private brief's
    // filename into a neutral one and then finds the neutral path leads
    // nowhere, so a test kept by the export cannot read a brief the export
    // drops. Tideglass allocates 62 plain creature slots, which is more of the
    // shape this asks about than the flagship has.
    const neutral = briefFromFile('tideglass-reach.json');
    const plain = allocateSlots(neutral).slots.filter(
      (slot) =>
        slot.cardKind === 'creature' && slot.abilityKinds.length === 0 && slot.requiredCard === undefined,
    );
    expect(plain.length).toBeGreaterThan(0);
    expect(fillSchemaFor(plain)).toBe(FillBatchSchema);
  });

  it('refuses a batch holding both a weapon and a permanent rather than picking one', () => {
    const weapon: Slot = {
      ...auraSlot,
      id: 'CA01',
      color: null,
      cardKind: 'artifact',
      role: 'gearCommon',
      auraModifications: [],
      requiredCard: { name: 'Moonblade', equipment: true, legendary: false },
    };
    expect(fillSchemaFor([weapon])).toBe(FillBatchWithEquipSchema);
    expect(() => fillSchemaFor([weapon, auraSlot])).toThrow(
      /holds both a weapon and an enchantment or planeswalker slot/,
    );
  });
});

describe('the sections of the prompt that explain them', () => {
  const brief = briefStating('common', 'W', 'auraPacify');
  const allocation = allocateSlots(brief);

  function promptFor(slots: readonly Slot[]): string {
    return buildFillPrompt({
      brief,
      slots,
      rarityRules: allocation.profile.rarityRules,
      archetypes: allocation.archetypes,
      priorNames: [],
      sameColorCards: [],
      tierCards: [],
      corrections: new Map(),
      revisions: new Map(),
    });
  }

  const auraSlot = oneSlotOfRole(brief, 'auraPacify');
  const anthemSlot = oneSlotOfRole(briefStating('uncommon', 'G', 'anthem'), 'anthem');
  const walkerSlot = oneSlotOfRole(briefStating('rare', 'R', 'planeswalker'), 'planeswalker');

  it('explains the Aura, and only the modifications the slot names', () => {
    const prompt = promptFor([auraSlot]);
    expect(prompt).toContain('<enchantment>');
    expect(prompt).toContain('aura modifies: cantAttack|cantBlock');
    expect(prompt).toContain('the enchanted creature cannot attack');
    expect(prompt).toContain('the enchanted creature cannot block');
    expect(prompt).not.toContain('cannot be blocked');
    expect(prompt).not.toContain('"kind":"statBonus"');
    expect(prompt).not.toContain('<planeswalker>');
  });

  it('explains the blanket enchantment without offering the clause', () => {
    const prompt = promptFor([anthemSlot]);
    expect(prompt).toContain('<enchantment>');
    expect(prompt).toContain('no aura: this enchantment is not attached to anything');
    expect(prompt).not.toContain('A slot whose line says "aura modifies" prints an Aura');
    expect(prompt).not.toContain('<planeswalker>');
  });

  it('explains the walker, its loyalty window and the cost it does not state', () => {
    const prompt = promptFor([walkerSlot]);
    expect(prompt).toContain('<planeswalker>');
    expect(prompt).toContain('loyaltyAbilities');
    expect(prompt).toContain('CR 606.2');
    expect(prompt).toContain('startingLoyalty is what it arrives with, between 2 and 5');
    expect(prompt).not.toContain('<enchantment>');
  });

  it('shows an ordinary batch neither section', () => {
    const plain = allocation.slots.filter(
      (slot) => slot.cardKind === 'creature' && slot.color === 'W' && slot.requiredCard === undefined,
    );
    expect(plain.length).toBeGreaterThan(0);
    const prompt = promptFor(plain.slice(0, 3));
    expect(prompt).not.toContain('<enchantment>');
    expect(prompt).not.toContain('<planeswalker>');
  });
});

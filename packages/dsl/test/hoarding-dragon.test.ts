/** Hoarding Dragon's source-linked exile vocabulary and authoring bounds. */
import { describe, expect, it } from 'vitest';
import {
  CardEffectSchema,
  ModelEffectSchema,
  SOURCE_LINKED_EXILE_DESTINATION,
  SourceLinkedExileDestinationSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  type CardInput,
  type SourceLinkedExileDestination,
} from '@mtg/dsl';

const LINKED_SEARCH = {
  kind: 'searchLibrary' as const,
  filter: { cardTypes: ['artifact' as const] },
  destination: 'sourceLinkedExile' as const,
};

const LINKED_RETURN = {
  kind: 'moveSourceLinkedExile' as const,
  destination: 'hand' as const,
};

function hoardingDragon(): CardInput {
  return {
    kind: 'creature',
    id: 'm11-144-hoarding-dragon',
    name: 'Hoarding Dragon',
    rarity: 'rare',
    set: { code: 'M11', collectorNumber: 144 },
    manaCost: { generic: 3, R: 2 },
    colors: ['R'],
    subtypes: ['Dragon'],
    keywords: ['flying'],
    power: 4,
    toughness: 4,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [LINKED_SEARCH],
        optional: true,
      },
      {
        kind: 'triggered',
        condition: 'selfDies',
        effects: [LINKED_RETURN],
        optional: true,
      },
    ],
  } as CardInput;
}

describe('Hoarding Dragon authoring', () => {
  it('publishes the source-linked destination through the package boundary', () => {
    const destination: SourceLinkedExileDestination = SOURCE_LINKED_EXILE_DESTINATION;
    expect(SourceLinkedExileDestinationSchema.parse(destination)).toBe('sourceLinkedExile');
  });

  it('parses, validates, and renders both linked clauses exactly', () => {
    expect(CardEffectSchema.safeParse(LINKED_SEARCH).success).toBe(true);
    expect(CardEffectSchema.safeParse(LINKED_RETURN).success).toBe(true);
    expect(renderOracleText(parseCard(hoardingDragon()))).toBe(
      [
        'Flying',
        'When Hoarding Dragon enters the battlefield, you may search your library for an artifact card, exile it, then shuffle.',
        "When Hoarding Dragon dies, you may put the exiled card into its owner's hand.",
      ].join('\n'),
    );
  });

  it('keeps both source-linked operations outside generator output', () => {
    expect(ModelEffectSchema.safeParse(LINKED_SEARCH).success).toBe(false);
    expect(ModelEffectSchema.safeParse(LINKED_RETURN).success).toBe(false);
  });

  it('refuses a linked return without a source-linked exile writer', () => {
    const input = hoardingDragon();
    const abilities = input.abilities;
    if (abilities === undefined) throw new Error('the Hoarding Dragon abilities disappeared');
    const parsed = safeParseCard({ ...input, abilities: [abilities[1]] });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((entry) => [entry.code, entry.path])).toContainEqual([
      'SOURCE_LINKED_EXILE_INVALID',
      'abilities[0].effects[0]',
    ]);
  });

  it('refuses a source-linked writer without a reader on the same permanent', () => {
    const input = hoardingDragon();
    const abilities = input.abilities;
    if (abilities === undefined) throw new Error('the Hoarding Dragon abilities disappeared');
    const parsed = safeParseCard({ ...input, abilities: [abilities[0]] });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((entry) => [entry.code, entry.path])).toContainEqual([
      'SOURCE_LINKED_EXILE_INVALID',
      'abilities[0].effects[0]',
    ]);
  });

  it('refuses a plural search until its linked return has plural Oracle wording', () => {
    const input = hoardingDragon();
    const abilities = input.abilities;
    if (abilities === undefined) throw new Error('the Hoarding Dragon abilities disappeared');
    const enters = abilities[0];
    if (enters?.kind !== 'triggered') throw new Error('the Hoarding Dragon enters ability disappeared');
    const parsed = safeParseCard({
      ...input,
      abilities: [{ ...enters, effects: [{ ...LINKED_SEARCH, count: 2 }] }, abilities[1]],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((entry) => [entry.code, entry.path])).toContainEqual([
      'SOURCE_LINKED_EXILE_INVALID',
      'abilities[0].effects[0].count',
    ]);
  });

  it('refuses multiple writers until linked-exile vocabulary can distinguish them', () => {
    const input = hoardingDragon();
    const abilities = input.abilities;
    if (abilities === undefined) throw new Error('the Hoarding Dragon abilities disappeared');
    const enters = abilities[0];
    if (enters?.kind !== 'triggered') throw new Error('the Hoarding Dragon enters ability disappeared');
    const parsed = safeParseCard({
      ...input,
      abilities: [{ ...enters, effects: [LINKED_SEARCH, LINKED_SEARCH] }, abilities[1]],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((entry) => [entry.code, entry.path])).toContainEqual([
      'SOURCE_LINKED_EXILE_INVALID',
      'abilities[0].effects[1]',
    ]);
  });

  it('refuses multiple readers until linked-exile vocabulary can distinguish them', () => {
    const input = hoardingDragon();
    const abilities = input.abilities;
    if (abilities === undefined) throw new Error('the Hoarding Dragon abilities disappeared');
    const death = abilities[1];
    if (death?.kind !== 'triggered') throw new Error('the Hoarding Dragon death ability disappeared');
    const parsed = safeParseCard({
      ...input,
      abilities: [abilities[0], { ...death, effects: [LINKED_RETURN, LINKED_RETURN] }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((entry) => [entry.code, entry.path])).toContainEqual([
      'SOURCE_LINKED_EXILE_INVALID',
      'abilities[1].effects[1]',
    ]);
  });

  it('refuses other source-attributed exile operations beside the linked pair', () => {
    const competingExileEffects = [
      { kind: 'exileTarget', target: { kind: 'targetCreature' } },
      { kind: 'exileGraveyard', whose: 'opponent' },
      {
        kind: 'chooseFromGraveyard',
        whose: 'opponent',
        filter: { cardTypes: ['creature'] },
        destination: 'exile',
      },
    ] as const;
    for (const competing of competingExileEffects) {
      const input = hoardingDragon();
      const abilities = input.abilities;
      if (abilities === undefined) throw new Error('the Hoarding Dragon abilities disappeared');
      const enters = abilities[0];
      if (enters?.kind !== 'triggered') throw new Error('the Hoarding Dragon enters ability disappeared');
      const parsed = safeParseCard({
        ...input,
        abilities: [{ ...enters, effects: [LINKED_SEARCH, competing], optional: undefined }, abilities[1]],
      });
      expect(parsed.ok).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.violations.map((entry) => [entry.code, entry.path])).toContainEqual([
        'SOURCE_LINKED_EXILE_INVALID',
        'abilities[0].effects[1]',
      ]);
    }
  });

  it('refuses source-linked exile on a spell with no permanent source', () => {
    const parsed = safeParseCard({
      kind: 'sorcery',
      id: 'linked-exile-spell-invalid',
      name: 'Linked Exile Spell Invalid',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 1 },
      effects: [LINKED_SEARCH],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((entry) => [entry.code, entry.path])).toContainEqual([
      'SOURCE_LINKED_EXILE_INVALID',
      'effects[0]',
    ]);
  });

  it('refuses reading a source link on a spell that has no permanent source', () => {
    const parsed = safeParseCard({
      kind: 'sorcery',
      id: 'linked-exile-reader-spell-invalid',
      name: 'Linked Exile Reader Spell Invalid',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { generic: 1 },
      effects: [LINKED_RETURN],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((entry) => [entry.code, entry.path])).toContainEqual([
      'SOURCE_LINKED_EXILE_INVALID',
      'effects[0]',
    ]);
  });

  it('refuses reading the link from a trigger other than the source death', () => {
    const input = hoardingDragon();
    const abilities = input.abilities;
    if (abilities === undefined) throw new Error('the Hoarding Dragon abilities disappeared');
    const death = abilities[1];
    if (death?.kind !== 'triggered') throw new Error('the Hoarding Dragon death ability disappeared');
    const parsed = safeParseCard({
      ...input,
      abilities: [abilities[0], { ...death, condition: 'beginningOfYourUpkeep' }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((entry) => [entry.code, entry.path])).toContainEqual([
      'SOURCE_LINKED_EXILE_INVALID',
      'abilities[1].effects[0]',
    ]);
  });

  it('refuses writing a link after the source has already died', () => {
    const input = hoardingDragon();
    const abilities = input.abilities;
    if (abilities === undefined) throw new Error('the Hoarding Dragon abilities disappeared');
    const enters = abilities[0];
    if (enters?.kind !== 'triggered') throw new Error('the Hoarding Dragon enters ability disappeared');
    const parsed = safeParseCard({
      ...input,
      abilities: [{ ...enters, condition: 'selfDies' }, abilities[1]],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((entry) => [entry.code, entry.path])).toContainEqual([
      'SOURCE_LINKED_EXILE_INVALID',
      'abilities[0].effects[0]',
    ]);
  });

  it('refuses linked operations in activated abilities until that path retains the relation', () => {
    const input = hoardingDragon();
    const abilities = input.abilities;
    if (abilities === undefined) throw new Error('the Hoarding Dragon abilities disappeared');
    const parsed = safeParseCard({
      ...input,
      abilities: [
        abilities[0],
        {
          kind: 'activated',
          cost: { mana: { generic: 1 } },
          effects: [LINKED_RETURN],
        },
      ],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((entry) => [entry.code, entry.path])).toContainEqual([
      'SOURCE_LINKED_EXILE_INVALID',
      'abilities[1].effects[0]',
    ]);
  });
});

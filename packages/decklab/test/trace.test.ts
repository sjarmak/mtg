import { describe, expect, it } from 'vitest';
import type { Color } from '@mtg/dsl';
import { assembleDeck } from '../src/assemble';
import type { CandidateCard } from '../src/candidates';
import { DeckCriteriaSchema, type DeckCriteriaInput } from '../src/criteria';
import { resolveCriteria } from '../src/land-plan';
import { parseManaCost } from '../src/mana-cost';
import { traceCriteria, type CriterionTrace } from '../src/trace';
import type { Inclusion } from '../src/verify';

function card(name: string, typeLine: string, producedMana: readonly Color[]): CandidateCard {
  const manaCost = typeLine.includes('Land') ? null : '{R}';
  return {
    oracleId: name,
    name,
    manaCost,
    manaValue: manaCost === null ? 0 : 1,
    typeLine,
    oracleText: null,
    power: null,
    toughness: null,
    colorIdentity: 'R',
    keywords: [],
    priceUsd: 1,
    parsedCost: parseManaCost(manaCost),
    producedMana,
  };
}

function spell(name: string, criteria: readonly string[], count = 4): Inclusion {
  return { card: card(name, 'Instant', []), count, criteria, reason: 'it burns' };
}

function land(name: string, criteria: readonly string[], count = 2): Inclusion {
  return { card: card(name, 'Land', ['R']), count, criteria, reason: 'it taps for red' };
}

/**
 * Traces a deck built from these inclusions. The land count is stated so the
 * basics are real: the whole question about a basic is what happens to a card
 * that arrived by arithmetic rather than by choice.
 */
function trace(inclusions: readonly Inclusion[], overrides: Partial<DeckCriteriaInput> = {}): CriterionTrace {
  const stated = DeckCriteriaSchema.parse({
    prompt: 'aggressive mono-red burn that wins by turn five',
    format: 'modern',
    colors: ['R'],
    archetype: 'aggro',
    themes: ['burn'],
    size: 60,
    landCount: 24,
    ...overrides,
  });
  const criteria = resolveCriteria(stated, {
    count: 24,
    source: 'stated',
    reason: 'as the player stated',
  });
  return traceCriteria(assembleDeck(inclusions, criteria), stated);
}

describe('traceCriteria', () => {
  it('passes a deck whose every choice cites a stated criterion', () => {
    const result = trace([
      spell('Lava Spike', ['archetype']),
      spell('Rift Bolt', ['theme:burn', 'archetype']),
      land('Ramunap Ruins', ['format']),
    ]);

    expect(result.findings).toEqual([]);
    expect(result.clean).toBe(true);
    expect(result.chosenEntries).toBe(3);
    expect(result.citedEntries).toBe(3);
  });

  it('counts the basics as derived rather than calling them untraced', () => {
    const result = trace([spell('Lava Spike', ['archetype'])]);

    // 24 land slots, nothing nonbasic in the list: every one is a Mountain that
    // no card cites and none of them is a finding.
    expect(result.derivedBasics).toBe(24);
    expect(result.findings).toEqual([]);
    expect(result.chosenEntries).toBe(1);
  });

  it('flags a choice that cites nothing', () => {
    const result = trace([spell('Lava Spike', [])]);

    expect(result.findings).toEqual([
      { name: 'Lava Spike', kind: 'no-criterion', detail: 'Lava Spike cites no criterion at all' },
    ]);
    expect(result.citedEntries).toBe(0);
    expect(result.clean).toBe(false);
  });

  it('flags a choice citing an id the criteria never stated, and names both', () => {
    const result = trace([spell('Lava Spike', ['powerBand'])]);

    const finding = result.findings[0];
    expect(finding?.kind).toBe('unstated-criterion');
    expect(finding?.detail).toContain('cites powerBand');
    expect(finding?.detail).toContain('format, colors, archetype, theme:burn');
  });

  it('flags a choice that cites an unstated id alongside a stated one', () => {
    const result = trace([spell('Lava Spike', ['archetype', 'budget'])]);

    expect(result.findings[0]?.kind).toBe('unstated-criterion');
    expect(result.citedEntries).toBe(0);
  });

  it('traces the nonbasic lands, which are choices too', () => {
    const result = trace([spell('Lava Spike', ['archetype']), land('Ramunap Ruins', [])]);

    expect(result.findings).toEqual([
      { name: 'Ramunap Ruins', kind: 'no-criterion', detail: 'Ramunap Ruins cites no criterion at all' },
    ]);
    expect(result.chosenEntries).toBe(2);
  });

  it('takes the ids from the criteria in hand, so a theme nobody stated cannot be cited', () => {
    const result = trace([spell('Lava Spike', ['theme:burn'])], { themes: [] });

    expect(result.findings[0]?.kind).toBe('unstated-criterion');
  });
});

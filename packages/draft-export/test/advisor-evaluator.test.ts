import { describe, expect, it } from 'vitest';
import { evaluateDraft } from '../src/advisor/evaluate';
import type { AdvisorModel } from '../src/advisor/evidence';
import type { AdvisorCard, ObservedDraft } from '../src/advisor/state';
import { readDraftMemory } from '../src/advisor/state';
import { inferOpenness } from '../src/advisor/signals';

const card = (name: string, colors = ['B'], manaValue = 2): AdvisorCard => ({
  physicalId: name,
  correctedName: name,
  name,
  colors,
  manaValue,
  manaCost: colors.map((c) => `{${c}}`).join(''),
  typeLine: 'Sorcery',
});
const need = (tag: string, min: number) => ({ tag, label: tag, min, critical: true });
const lane = (id: string, colors: string[], needs: ReturnType<typeof need>[]) => ({
  id,
  name: id,
  colors,
  description: id,
  needs,
  packages: [id],
  fixingRequired: colors.length > 2 ? 3 : 0,
  roles: [],
  finishers: [],
  pitfalls: [],
});
const model: AdvisorModel = {
  archetypes: [
    lane('grave', ['B'], [need('enabler', 2), need('payoff', 2)]),
    lane('tempo', ['U'], [need('threat', 3)]),
    lane('gold', ['U', 'B', 'R'], [need('threat', 2)]),
  ],
  packages: [
    {
      id: 'grave',
      name: 'Grave package',
      archetypes: ['grave'],
      needs: [need('enabler', 1), need('payoff', 1)],
      description: 'Test package',
      examples: [],
    },
  ],
  profiles: [
    ...['enabler', 'payoff'].map((name) => ({
      name,
      quality: 2,
      flexibility: 0.1,
      neutral: false,
      roles: [name],
      tags: [name],
      fixing: [],
      archetypes: [{ archetype: 'grave', strength: 3 as const, signal: 1, roles: [name] }],
    })),
    {
      name: 'blue',
      quality: 4,
      flexibility: 0.7,
      neutral: false,
      roles: ['threat'],
      tags: ['threat'],
      fixing: [],
      archetypes: [{ archetype: 'tempo', strength: 3, signal: 0.8, roles: ['threat'] }],
    },
    {
      name: 'gold',
      quality: 5,
      flexibility: 0.1,
      neutral: false,
      roles: ['threat'],
      tags: ['threat'],
      fixing: [],
      archetypes: [{ archetype: 'gold', strength: 3, signal: 0.5, roles: ['threat'] }],
    },
    {
      name: 'flex',
      quality: 4,
      flexibility: 1,
      neutral: true,
      roles: ['interaction'],
      tags: ['interaction'],
      fixing: [],
      archetypes: [],
    },
    {
      name: 'land',
      quality: 3,
      flexibility: 1,
      neutral: true,
      roles: ['fixing'],
      tags: ['fixing'],
      fixing: ['U', 'B', 'R'],
      archetypes: [],
    },
    {
      name: 'filler',
      quality: 1,
      flexibility: 0,
      neutral: true,
      roles: [],
      tags: [],
      fixing: [],
      archetypes: [],
    },
  ],
};
function copy(name: string, id: string): AdvisorCard {
  return {
    ...card(
      name,
      name === 'blue'
        ? ['U']
        : name === 'gold'
          ? ['U', 'B', 'R']
          : name === 'flex' || name === 'land' || name === 'filler'
            ? []
            : ['B'],
    ),
    physicalId: id,
  };
}
/** Make actual legal singleton pack traces, including surviving cards on wheels. */
function draft(
  poolNames: string[],
  pack: string[],
  late: Readonly<Record<number, string[]>> = {},
): ObservedDraft {
  const observations: ObservedDraft['observations'][number][] = [];
  const picks: string[] = [];
  for (let i = 0; i <= poolNames.length; i += 1) {
    const p = i % 15;
    const old = p >= 8 ? observations[i - 8]!.cards.filter((c) => !picks.includes(c.physicalId)) : [];
    const names = i === poolNames.length ? pack : [poolNames[i]!, ...(late[i] ?? [])];
    const fresh = names.map((name, j) => copy(name, `${String(i)}-${String(j)}`));
    const cards =
      p >= 8
        ? old.slice(0, 15 - p)
        : [
            ...fresh,
            ...Array.from({ length: 15 - p - fresh.length }, (_, j) =>
              copy('filler', `${String(i)}-f${String(j)}`),
            ),
          ];
    observations.push({ round: Math.floor(i / 15) + 1, pickNumber: p + 1, cards });
    if (i < poolNames.length) picks.push(cards[0]!.physicalId);
  }
  return { seats: 8, rounds: 3, packSize: 15, observations, picks };
}
const path = (state: ObservedDraft, id = 'grave') =>
  evaluateDraft(state, model).archetypes.find((a) => a.id === id)!;

describe('explainable strategic choices', () => {
  it('treats late fixing as weak color evidence, not a narrow archetype signal', () => {
    const state = draft(
      Array.from({ length: 6 }, () => 'filler'),
      ['land'],
    );
    const result = inferOpenness(state, model, 'gold');
    expect(result.observations.some((r) => r.code === 'color-fixing')).toBe(true);
    expect(result.confidence).toBe('Low');
    expect(result.label).not.toBe('Strong evidence');
  });
  it('reports cooling evidence separately when the new passing direction stops supplying support', () => {
    const earlier = draft(
      Array.from({ length: 6 }, () => 'filler'),
      ['enabler', 'payoff'],
    );
    const later = {
      ...earlier,
      observations: [
        ...earlier.observations,
        ...[5, 6, 7, 8].map((pickNumber) => ({
          round: 2,
          pickNumber,
          cards: [copy('filler', `cold-${String(pickNumber)}`)],
        })),
      ],
    };
    const signal = inferOpenness(later, model, 'grave');
    expect(signal.label).toBe('Cooling');
    expect(signal.observations).toContainEqual(
      expect.objectContaining({ code: 'lane-cooling', polarity: 'negative' }),
    );
  });
  it('evaluates a double-faced card by its front cost and colors, without mutating the printing', () => {
    const initial = draft([], ['flex']);
    const double = {
      ...initial.observations[0]!.cards[0]!,
      typeLine: 'Creature // Land',
      colors: ['W', 'R'],
      manaCost: null,
      faces: [{ typeLine: 'Creature', colors: ['W'], manaCost: '{1}{W}' }],
    };
    const state = {
      ...initial,
      observations: [
        { ...initial.observations[0]!, cards: [double, ...initial.observations[0]!.cards.slice(1)] },
      ],
    };
    const seen = readDraftMemory(state).current!.cards[0]!;
    expect(seen.colors).toEqual(['W']);
    expect(seen.manaCost).toBe('{1}{W}');
    expect(seen.typeLine).toBe('Creature');
    const nullable = {
      ...state,
      observations: [
        {
          ...state.observations[0]!,
          cards: [
            { ...double, faces: [{ typeLine: 'Creature', colors: null, manaCost: null }] },
            ...initial.observations[0]!.cards.slice(1),
          ],
        },
      ],
    };
    expect(readDraftMemory(nullable).current!.cards[0]!.colors).toEqual(['W', 'R']);
    expect(() => evaluateDraft(nullable, model)).not.toThrow();
    expect(double.colors).toEqual(['W', 'R']);
  });
  it('treats a second-pick specialist as weak evidence, never an open-lane verdict', () => {
    const result = path(draft(['filler'], ['enabler']));
    expect(result.openness.score).toBeGreaterThan(0);
    expect(result.openness.label).toBe('Little evidence');
    expect(result.openness.confidence).toBe('Low');
  });
  it('rejects a physical singleton appearing in unrelated packs', () => {
    const state = draft(['filler'], ['flex']);
    const first = state.observations[0]!;
    const second = state.observations[1]!;
    expect(() =>
      readDraftMemory({
        ...state,
        observations: [first, { ...second, cards: [first.cards[1]!, ...second.cards.slice(1)] }],
      }),
    ).toThrow(/unrelated/);
  });
  it('does not fill a path with off-color cards having unrelated generic tags', () => {
    const modified = {
      ...model,
      profiles: model.profiles.map((p) => (p.name === 'payoff' ? { ...p, tags: [...p.tags, 'threat'] } : p)),
    };
    const advice = evaluateDraft(draft(['payoff', 'payoff'], ['flex']), modified);
    expect(advice.archetypes.find((a) => a.id === 'tempo')!.pieces[0]!.count).toBe(0);
  });
  it('does not invent a current archetype on the first pick', () => {
    const advice = evaluateDraft(draft([], ['flex']), model);
    expect(advice.cards[0]!.currentPath).toBeNull();
    expect(advice.cards[0]!.overallAssessment).toBe('Strong');
  });
  it('penalizes another expensive spell when the pool is already top-heavy', () => {
    const base = draft(['payoff', 'payoff', 'payoff', 'payoff'], ['flex']);
    const expensive = {
      ...base,
      observations: base.observations.map((o) => ({
        ...o,
        cards: o.cards.map((c) => ({ ...c, manaValue: 6 })),
      })),
    };
    const normal = evaluateDraft(base, model).cards[0]!;
    const heavy = evaluateDraft(expensive, model).cards[0]!;
    expect(heavy.flexibleScore).toBeLessThan(normal.flexibleScore);
    expect(heavy.liabilities.some((r) => r.code === 'top-heavy')).toBe(true);
  });
  it('deducts dependency risk from a narrow payoff rather than only describing it', () => {
    const empty = evaluateDraft(draft(['payoff', 'payoff', 'payoff'], ['payoff']), model).cards[0]!;
    const supported = evaluateDraft(draft(['payoff', 'payoff', 'payoff'], ['payoff']), {
      ...model,
      packages: [],
    }).cards[0]!;
    expect(empty.archetypeAssessments.find((a) => a.archetype === 'grave')!.score).toBeLessThan(
      supported.archetypeAssessments.find((a) => a.archetype === 'grave')!.score,
    );
    expect(empty.liabilities.some((r) => r.code === 'missing-package')).toBe(true);
  });
  it('prefers flexible quality over an unsupported narrow card early', () => {
    const advice = evaluateDraft(draft([], ['enabler', 'flex']), model);
    expect(advice.recommendations.find((r) => r.mode === 'flexible')?.card.correctedName).toBe('flex');
    expect(advice.cards[0]!.liabilities.some((r) => r.code === 'missing-package')).toBe(true);
  });
  it('values a missing enabler above generic power once payoffs are established', () => {
    const advice = evaluateDraft(
      draft(['payoff', 'payoff', 'enabler', 'payoff'], ['enabler', 'flex']),
      model,
    );
    expect(advice.recommendations.find((r) => r.mode === 'current')?.card.correctedName).toBe('enabler');
    expect(advice.cards[0]!.synergies[0]?.cards.length).toBeGreaterThan(1);
    expect(advice.cards[0]!.reasons.some((r) => r.code === 'fills-need')).toBe(true);
  });
  it.each([
    ['payoff', 'enabler'],
    ['enabler', 'payoff'],
  ])('reports %s without enough %s', (owned, missing) => {
    const result = path(draft([owned, owned], ['flex']));
    expect(result.missing.some((n) => n.tag === missing)).toBe(true);
    expect(result.status).not.toBe('Established');
  });
  it('keeps confidence low for one anomalous late pack', () => {
    const result = path(draft(Array(6).fill('filler'), ['enabler']));
    expect(result.openness.confidence).toBe('Low');
    expect(result.openness.label).not.toBe('Strong evidence');
    expect(result.openness.observations[0]?.pickNumber).toBe(7);
  });
  it('accumulates independent late packs and proposes a supported pivot', () => {
    const state = draft(
      ['blue', 'filler', 'filler', 'filler', 'filler', 'filler', 'filler'],
      ['enabler', 'flex'],
      { 4: ['payoff'], 5: ['enabler'], 6: ['payoff'] },
    );
    const advice = evaluateDraft(state, model);
    expect(path(state).openness.label).toBe('Strong evidence');
    expect(path(state).openness.confidence).not.toBe('Low');
    expect(advice.recommendations.find((r) => r.mode === 'pivot')?.archetype).toBe('grave');
  });
  it('recognizes a physical wheel without counting its earlier sighting twice', () => {
    const state = draft(Array(8).fill('filler'), [], { 0: ['enabler'] });
    const evidence = path(state).openness.observations.filter((r) => r.cards.includes('0-1'));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.code).toBe('wheel');
    expect(evidence[0]?.pickNumber).toBe(9);
  });
  it('uses fixing to change a gold card assessment with explicit mana reasons', () => {
    const poor = evaluateDraft(draft(['blue', 'blue', 'blue', 'blue'], ['gold']), model).cards[0]!;
    const fixed = evaluateDraft(draft(['blue', 'land', 'land', 'land'], ['gold']), model).cards[0]!;
    expect(poor.liabilities.some((r) => r.code === 'mana-risk')).toBe(true);
    expect(fixed.archetypeAssessments.find((a) => a.archetype === 'gold')!.score).toBeGreaterThan(
      poor.archetypeAssessments.find((a) => a.archetype === 'gold')!.score,
    );
  });
  it('pinning explores a path while retaining its missing pieces and liabilities', () => {
    const advice = evaluateDraft(draft(['blue'], ['payoff', 'flex']), model, 'grave');
    expect(advice.recommendations.some((r) => r.mode === 'explore' && r.archetype === 'grave')).toBe(true);
    expect(advice.cards[0]!.liabilities.some((r) => r.code === 'missing-package')).toBe(true);
  });
  it('ignores hidden engine fields, is deterministic, and never mutates input', () => {
    const state = draft(['blue'], ['flex', 'payoff']);
    const before = JSON.stringify(state);
    const a = evaluateDraft(
      { ...state, ...{ seed: 'one', undealt: ['enabler'], seatsHidden: ['payoff'] } },
      model,
    );
    const b = evaluateDraft({ ...state, ...{ seed: 'two', undealt: [], seatsHidden: ['blue'] } }, model);
    expect(a).toEqual(b);
    expect(JSON.stringify(state)).toBe(before);
    expect(a.cards.every((c) => c.reasons.length && c.opportunityCosts.length)).toBe(true);
  });
  it('rejects future observations, impossible picks and replaced wheel cards', () => {
    const state = draft([], ['flex']);
    expect(() =>
      readDraftMemory({ ...state, observations: [...state.observations, state.observations[0]!] }),
    ).toThrow(/future/);
    expect(() => readDraftMemory({ ...draft(['blue'], ['flex']), picks: ['hidden'] })).toThrow(
      /not observed/,
    );
  });
});

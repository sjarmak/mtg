// @vitest-environment jsdom
/** Interaction contracts; layout is exercised separately in Chrome. */
import { createElement as h } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AdvisorCardDetail, AdvisorPaths, AdvisorSummary } from '../../src/routes/legacy-cube/Advisor';
import type { AdvisorModel, DraftAdvice } from '@mtg/draft-export';
import { DEFAULT_ADVISOR_WEIGHTS } from '@mtg/draft-export';

afterEach(cleanup);
const card = {
  physicalId: 'seen',
  correctedName: 'Known card',
  name: 'Known card',
  colors: [],
  manaCost: null,
  manaValue: 2,
  typeLine: 'Artifact',
};
const reason = {
  code: 'fixture-evidence',
  text: 'This fills the missing role.',
  cards: ['seen'],
  polarity: 'positive' as const,
};
const assessment = {
  card,
  overallAssessment: 'Strong' as const,
  archetypeAssessments: [
    { archetype: 'test', assessment: 'Strong' as const, score: 5, effect: '↑' as const, reasons: [reason] },
  ],
  reasons: [reason],
  synergies: [],
  liabilities: [],
  opportunityCosts: [],
  effectOnArchetypes: [],
  flexibleScore: 5,
};
const model: AdvisorModel = {
  archetypes: [
    {
      id: 'test',
      name: 'Test path',
      colors: ['U'],
      description: 'Build the engine.',
      needs: [],
      packages: [],
      fixingRequired: 0,
      roles: [],
      finishers: [],
      pitfalls: [],
    },
  ],
  packages: [],
  profiles: [],
};
const advice: DraftAdvice = {
  weights: DEFAULT_ADVISOR_WEIGHTS,
  memory: { pool: [], current: null, passed: [] },
  cards: [{ ...assessment, currentPath: 'test' }],
  pinned: null,
  recommendations: [
    { mode: 'flexible', card, archetype: null, reasons: [reason] },
    { mode: 'current', card, archetype: 'test', reasons: [reason] },
  ],
  archetypes: [
    {
      id: 'test',
      name: 'Test path',
      status: 'Speculative',
      poolFit: 0,
      quality: 0,
      completeness: 0,
      synergyDensity: 0,
      manaFeasibility: 'Needs fixing',
      pivotCost: 'Low',
      stranded: [],
      confidence: 'Low',
      contributors: [],
      pieces: [],
      missing: [],
      surplus: [],
      reasons: [],
      openness: {
        score: 1,
        label: 'Some evidence',
        confidence: 'Low',
        observations: [
          {
            ...reason,
            text: 'Known card wheeled at pack 1, pick 9.',
            code: 'wheel',
            round: 1,
            pickNumber: 9,
          },
        ],
      },
    },
  ],
};

it('groups one card across multiple objectives and keeps explanations inspectable', () => {
  render(h(AdvisorSummary, { advice }));
  expect(screen.getByText('Stay flexible / Current plan: Known card')).toBeTruthy();
  expect(screen.getAllByText('This fills the missing role.')).toHaveLength(1);
  expect(screen.queryByText(/5\.0/)).toBeNull();
});

it('names the applied revision and keeps provisional reviews separate from validation', () => {
  render(
    h(AdvisorSummary, {
      advice: { ...advice, weights: { ...DEFAULT_ADVISOR_WEIGHTS, revision: 'trial/v1' } },
      calibrationNote: 'Provisional local calibration; model-reviewed, not independent human validation.',
    }),
  );
  expect(screen.getByText(/trial\/v1/)).toBeTruthy();
  expect(screen.getByText(/Provisional local calibration/)).toBeTruthy();
  expect(screen.getByText(/Not yet bot-validated/)).toBeTruthy();
});

it('labels unvalidated advice without removing recommendations or exploration controls', () => {
  const view = render(h(AdvisorSummary, { advice }));
  expect(screen.getByText(/Not yet bot-validated/)).toBeTruthy();
  expect(screen.getByText('Stay flexible / Current plan: Known card')).toBeTruthy();
  view.rerender(h(AdvisorPaths, { advice, model, onPin: vi.fn() }));
  expect(screen.getByText('Not yet bot-validated')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Explore Test path' })).toBeTruthy();
  expect(screen.getByText(/does not mean the archetype is weak/)).toBeTruthy();
});

it('supports selecting and unpinning a path without drafting a card', () => {
  const onPin = vi.fn();
  const view = render(h(AdvisorPaths, { advice, model, onPin }));
  fireEvent.change(screen.getByLabelText('Explore an archetype'), { target: { value: 'test' } });
  expect(onPin).toHaveBeenCalledWith('test');
  view.rerender(h(AdvisorPaths, { advice: { ...advice, pinned: 'test' }, model, onPin }));
  fireEvent.click(screen.getByRole('button', { name: 'Unpin path' }));
  expect(onPin).toHaveBeenLastCalledWith(null);
  expect(screen.getByText('Known card wheeled at pack 1, pick 9.')).toBeTruthy();
});

it('shows contextual qualitative advice without numeric scores', () => {
  render(h(AdvisorCardDetail, { assessment: { ...assessment, currentPath: 'test' }, model, pinned: 'test' }));
  expect(screen.getByRole('heading', { name: 'Strong · Test path' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Pros' })).toBeTruthy();
});

it('puts the exploration target first even when its pool fit is low', () => {
  const other = { ...model.archetypes[0]!, id: 'other', name: 'Other path' };
  render(
    h(AdvisorPaths, {
      model: { ...model, archetypes: [other, ...model.archetypes] },
      advice: {
        ...advice,
        pinned: 'test',
        archetypes: [{ ...advice.archetypes[0]!, id: 'other', name: 'Other path' }, ...advice.archetypes],
      },
      onPin: vi.fn(),
    }),
  );
  expect(screen.getAllByText(/path ·/, { selector: 'summary' })[0]).toBe(
    screen.getByText(/Test path ·/, { selector: 'summary' }),
  );
});

it('explains populated paths, shortages, surplus and the cost of moving', () => {
  const piece = { tag: 'engine', label: 'engine pieces', count: 1, min: 2, critical: true, cards: ['seen'] };
  const populatedModel: AdvisorModel = {
    ...model,
    archetypes: Array.from({ length: 4 }, (_, i) => ({
      ...model.archetypes[0]!,
      id: `path-${String(i)}`,
      name: `Path ${String(i)}`,
      packages: ['engine'],
    })),
    packages: [
      {
        id: 'engine',
        name: 'Engine package',
        archetypes: ['path-0'],
        needs: [piece],
        description: 'Engine.',
        examples: ['Known card'],
      },
    ],
    profiles: [
      {
        name: 'Known card',
        quality: 4,
        flexibility: 0.8,
        neutral: false,
        roles: ['enabler'],
        tags: ['engine'],
        fixing: [],
        archetypes: [{ archetype: 'path-0', strength: 3, roles: ['enabler'], signal: 0.8 }],
      },
    ],
  };
  const populated: DraftAdvice = {
    ...advice,
    pinned: 'path-0',
    memory: { ...advice.memory, pool: [card] },
    archetypes: populatedModel.archetypes.map((meta, i) => ({
      ...advice.archetypes[0]!,
      id: meta.id,
      name: meta.name,
      poolFit: [18, 8, 1, 0][i]!,
      quality: [4, 3, 2, 0][i]!,
      synergyDensity: [1, 0.4, 0.1, 0][i]!,
      completeness: [1, 0.6, 0.1, 0][i]!,
      contributors: i < 3 ? ['seen'] : [],
      pieces: [piece, { ...piece, tag: 'support', critical: false }],
      missing: [piece],
      surplus: [piece],
      stranded: ['seen'],
      openness: { ...advice.archetypes[0]!.openness, score: 0.5, label: 'Cooling' },
    })),
  };
  const onPin = vi.fn();
  render(h(AdvisorPaths, { advice: populated, model: populatedModel, onPin }));
  expect(screen.getAllByText(/Contributing cards: Known card/)).toHaveLength(3);
  expect(screen.getAllByText('Need: 1 engine pieces')).toHaveLength(4);
  expect(screen.getAllByText(/Moving here may leave behind: Known card/)).toHaveLength(4);
  expect(screen.getAllByText(/Surplus: engine pieces/)).toHaveLength(4);
  expect(screen.getByText(/This is an exploration target/)).toBeTruthy();
  expect(screen.getAllByText('Engine package: engine pieces')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Explore Path 1' }));
  expect(onPin).toHaveBeenLastCalledWith('path-1');
  fireEvent.change(screen.getByLabelText('Explore an archetype'), { target: { value: '' } });
  expect(onPin).toHaveBeenLastCalledWith(null);
});

it('shows liabilities, path effects and opportunity costs without mixing unrelated packages', () => {
  const negative = {
    ...reason,
    code: 'mana-risk',
    text: 'This cost is unsupported.',
    polarity: 'negative' as const,
  };
  const enriched = {
    ...assessment,
    currentPath: 'test',
    archetypeAssessments: [{ ...assessment.archetypeAssessments[0]!, reasons: [reason, negative] }],
    synergies: [{ ...reason, package: 'unrelated', text: 'Wrong package.' }],
    liabilities: [negative],
    opportunityCosts: [{ ...reason, text: 'Another card is more flexible.' }],
    effectOnArchetypes: assessment.archetypeAssessments,
  };
  const view = render(h(AdvisorCardDetail, { assessment: enriched, model, pinned: 'test' }));
  expect(screen.getByRole('heading', { name: 'Cons' })).toBeTruthy();
  expect(screen.getByText('Test path ↑ · Strong')).toBeTruthy();
  expect(screen.getByText('Another card is more flexible.')).toBeTruthy();
  expect(screen.queryByText('Wrong package.')).toBeNull();
  view.rerender(
    h(AdvisorCardDetail, { assessment: { ...enriched, currentPath: null }, model, pinned: null }),
  );
  expect(screen.getByRole('heading', { name: 'Strong · Flexible pick' })).toBeTruthy();
});

it('keeps a distinct speculative choice separate from the flexible pick', () => {
  render(
    h(AdvisorSummary, {
      advice: {
        ...advice,
        recommendations: [
          advice.recommendations[0]!,
          {
            mode: 'pivot',
            card: { ...card, physicalId: 'other', name: 'Speculation' },
            archetype: 'test',
            reasons: [reason],
          },
        ],
      },
    }),
  );
  expect(screen.getByText('Explore an open lane: Speculation')).toBeTruthy();
  expect(screen.getByText(/No established direction yet/)).toBeTruthy();
  expect(screen.queryByText(/No distinct pivot pick/)).toBeNull();
});

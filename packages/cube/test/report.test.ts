/**
 * The report, which is the only consumer of a measurement that measures more
 * than it fails on.
 *
 * Land and colorless counts are the two numbers a cube designer reaches for
 * that no criterion constrains, so nothing downstream of `validateCube` would
 * notice if they were wrong — which is exactly why they are asserted here
 * against a list whose lands and colorless cards were counted by hand.
 */
import { describe, expect, it } from 'vitest';
import {
  CARDS_PER_FULL_COLOR,
  DRAFTABLE_CRITERIA_INPUT,
  DRAFTABLE_SET,
  draftableCriteria,
  draftablePool,
  draftableSet,
} from './support/draftable-cube';
import { fixtureCard, fixturePool } from './support/fixture-cube';
import { scriptedProvider } from './support/scripted-provider';
import type { AssembleCubeInput } from '../src/construct';
import { assembleCube } from '../src/construct';
import type { CubeCriteriaInput } from '../src/criteria';
import type { CubeProposal } from '../src/propose';
import { formatCubeReport } from '../src/report';

/** Forty colored spells, three colorless artifacts and two colorless lands. */
const SPELLS = ['W', 'U', 'B', 'R', 'G'].flatMap((color) =>
  Array.from({ length: 8 }, (_unused, index) =>
    fixtureCard({
      name: `${color} spell ${String(index + 1)}`,
      manaCost: `{${color}}`,
      manaValue: 2,
      colorIdentity: color,
    }),
  ),
);

const ARTIFACTS = Array.from({ length: 3 }, (_unused, index) =>
  fixtureCard({
    name: `Plain Gear ${String(index + 1)}`,
    manaCost: '{2}',
    manaValue: 2,
    typeLine: 'Artifact',
    colorIdentity: '',
  }),
);

const LANDS = Array.from({ length: 2 }, (_unused, index) =>
  fixtureCard({
    name: `Waste ${String(index + 1)}`,
    manaCost: '',
    manaValue: 0,
    typeLine: 'Land',
    colorIdentity: '',
  }),
);

const CARDS = [...SPELLS, ...ARTIFACTS, ...LANDS];
const POOL = fixturePool(CARDS, ['Banished Staple']);

const CRITERIA: CubeCriteriaInput = {
  prompt: 'a forty-five card cube with a couple of lands',
  format: 'modern',
  size: 45,
  seats: 3,
  cardsPerSeat: 15,
  archetypes: [{ name: 'five-color pile', colors: ['W', 'U', 'B', 'R', 'G'], minPlayable: 45 }],
};

const FULL: CubeProposal = {
  plan: 'a plain five-color cube with two lands in it',
  cards: CARDS.map((card) => ({
    name: card.name,
    count: 1,
    archetypes: ['five-color pile'],
    reason: 'it is in the pool',
  })),
};

async function reportFor(
  proposals: readonly CubeProposal[],
  bounds: Pick<AssembleCubeInput, 'maxSpendUsd'> & { readonly costUsd?: number } = {},
): Promise<string> {
  const provider = scriptedProvider(
    proposals,
    bounds.costUsd === undefined ? {} : { costUsd: bounds.costUsd },
  );
  const cube = await assembleCube({
    pool: POOL,
    provider,
    criteria: CRITERIA,
    ...(bounds.maxSpendUsd === undefined ? {} : { maxSpendUsd: bounds.maxSpendUsd }),
  });
  return formatCubeReport(cube);
}

describe('a cube that met its criteria', () => {
  it('prints the shape, including the two counts nothing fails on', async () => {
    const report = await reportFor([FULL]);

    expect(report).toContain('# Cube: a forty-five card cube with a couple of lands');
    expect(report).toContain('Format modern · 45 of 45 cards · singleton');
    expect(report).toContain('Chosen from 45 cards the criteria allow, in 1 round.');
    expect(report).toContain('A 3-seat pod at 15 cards each consumes 45.');
    expect(report).toContain('Filled to its stated size.');
    // Five cards carry no color identity — three artifacts and both lands —
    // and two of those five are the lands.
    expect(report).toContain('- lands 2 · colorless 5');
    // Lands are out of the curve, so the forty-three spells are all of it.
    expect(report).toContain('Curve: MV 2: 43');
    expect(report).toContain('- W — 8 of 40 colored slots (20.0%)');
    expect(report).toContain('- five-color pile — 45 playable of 45 required');
    expect(report).toContain('None: the cube meets every criterion it was given.');
    expect(report).toContain('- **1x Waste 1** (five-color pile) — it is in the pool');
  });

  it('says why a cube built over the store carries no availability, rather than leaving a gap', async () => {
    const report = await reportFor([FULL]);

    expect(report).toContain('## Availability');
    expect(report).toContain('Not drafted: this cube is cut from the card store');
  });
});

/**
 * The one report section that comes from running something rather than counting
 * it. Its whole job is to be believable, which means printing the seed and the
 * sample beside every share.
 */
describe('a cube the report drafted', () => {
  it('prints the sample, the seed, and a line per archetype', async () => {
    const criteria = draftableCriteria();
    const proposal: CubeProposal = {
      plan: 'every card in the set',
      cards: DRAFTABLE_SET.cards.map((card) => ({
        name: card.name,
        count: 1,
        archetypes: [],
        reason: 'it is in the set',
      })),
    };
    const cube = await assembleCube({
      pool: draftablePool(),
      provider: scriptedProvider([proposal]),
      criteria: DRAFTABLE_CRITERIA_INPUT,
      availability: { drafts: 2, seed: 'cube/availability/report' },
    });
    const report = formatCubeReport(cube);

    expect(report).toContain(
      '2 seeded drafts of 4 seats at 45 cards each — 8 seat-drafts, seed `cube/availability/report`.',
    );
    expect(report).toContain('seat-drafts could assemble it (');
    expect(report).toContain('no minimum stated');
    for (const archetype of criteria.archetypes) {
      expect(report).toContain(`- ${archetype.name} — `);
    }
  });

  /**
   * A share printed alone is ambiguous: it falls with the cube's color count
   * whatever the list holds. The deal is what tells a designer which of those
   * they are reading, so it is printed beside every share — and asserted here
   * against the measurement rather than against a literal, because a report that
   * agrees with a number nobody measured is the failure being prevented.
   */
  it('prints the deal each share is read against, from the measurement it was made with', async () => {
    const cube = await assembleCube({
      pool: draftablePool(),
      provider: scriptedProvider([
        {
          plan: 'every card in the set',
          cards: DRAFTABLE_SET.cards.map((card) => ({
            name: card.name,
            count: 1,
            archetypes: [],
            reason: 'it is in the set',
          })),
        },
      ]),
      criteria: DRAFTABLE_CRITERIA_INPUT,
      availability: { drafts: 2, seed: 'cube/availability/report' },
    });
    const { availability } = cube.validation;
    if (availability === null || availability.kind === 'unmeasured') {
      throw new Error('the fixture cube was not drafted');
    }
    const report = formatCubeReport(cube);

    expect(report).toContain(`A deck needs ${String(availability.spellsRequired)} spells;`);
    for (const archetype of availability.archetypes) {
      expect(report).toContain(
        `${String(archetype.castable)} castable spells in the cube, ` +
          `${archetype.dealtCastable.toFixed(1)} dealt per seat`,
      );
    }
    // The green archetype is the one a reader would otherwise mistake for a
    // measurement failure: it assembles at no seat, and the deal says why.
    const green = availability.archetypes.find((archetype) => archetype.name === 'mono-green stompy');
    expect(green?.assembled).toBe(0);
    expect(green?.dealtCastable).toBeLessThan(availability.spellsRequired);
  });

  /**
   * Five colors at the default pod deals a seat fewer castable spells than a
   * deck needs (`availability.ts`'s header measures this exact shape), so a
   * stated minimum on a two-color archetype there is unreachable by the pod
   * rather than by the list. The printed report is where a cube author reads
   * that distinction, so this checks the sentence rather than the structure
   * `validate.test.ts` already covers.
   */
  it('abstains a stated minimum the pod itself deals too little to reach', async () => {
    const set = draftableSet({
      W: CARDS_PER_FULL_COLOR,
      U: CARDS_PER_FULL_COLOR,
      B: CARDS_PER_FULL_COLOR,
      R: CARDS_PER_FULL_COLOR,
      G: CARDS_PER_FULL_COLOR,
    });
    const criteria: CubeCriteriaInput = {
      prompt: 'a five-color cube dealt too shallow for its own stated minimum',
      format: 'modern',
      size: set.cards.length,
      seats: 4,
      cardsPerSeat: 45,
      archetypes: [{ name: 'azorius control', colors: ['W', 'U'], minPlayable: 20, minAvailability: 0.9 }],
    };
    const proposal: CubeProposal = {
      plan: 'every card in the five-color set',
      cards: set.cards.map((card) => ({
        name: card.name,
        count: 1,
        archetypes: [],
        reason: 'it is in the set',
      })),
    };
    const cube = await assembleCube({
      pool: draftablePool(set, draftableCriteria(criteria)),
      provider: scriptedProvider([proposal]),
      criteria,
      availability: { drafts: 2, seed: 'cube/availability/abstain-report' },
    });
    const [finding] = cube.validation.findings.filter((entry) =>
      entry.code.startsWith('archetype-availability'),
    );
    const report = formatCubeReport(cube);

    expect(finding?.code).toBe('archetype-availability-abstained');
    expect(report).toContain('`archetype-availability-abstained`');
    expect(report).toContain('but not failed on it');
    expect(report).toContain(`a deck needs ${String(finding?.required)}`);
    expect(report).not.toContain('`archetype-availability`');
  });
});

describe('a cube that came back short', () => {
  it('names the bound that stopped it and what is still unresolved', async () => {
    const invented: CubeProposal = {
      plan: 'a cube of cards that do not exist',
      cards: [{ name: 'Nonesuch Colossus', count: 1, archetypes: ['five-color pile'], reason: 'no' }],
    };
    const report = await reportFor([invented]);

    expect(report).toContain('45 cards short: a whole round was rejected');
    expect(report).toContain('`unknown-card` no card named Nonesuch Colossus exists');
    expect(report).toContain('`size` the cube holds 0 cards against a stated size of 45');
    expect(report).toContain('- lands 0 · colorless 0');
    expect(report).toContain('Curve: no non-land cards');
  });

  it('names the money when the money is what stopped it, and both figures', async () => {
    // "The model ran out of ideas" and "you gave it two dollars" send a reader
    // to different places, so the report must not print the first for the
    // second. One card a round against a 45-card cube keeps every other bound
    // out of the way.
    const drip = CARDS.map((card) => ({
      plan: 'one card at a time',
      cards: [{ name: card.name, count: 1, archetypes: ['five-color pile'], reason: 'it is in the pool' }],
    }));
    const report = await reportFor(drip, { maxSpendUsd: 2, costUsd: 0.75 });

    expect(report).toContain('42 cards short: the construction reached the $2.00 it was allowed');
    expect(report).toContain('to spend on model calls, at $2.25. Raise --max-spend-usd to keep going.');
  });
});

import { describe, expect, it } from 'vitest';
import { ForgeScenarioStateSchema } from '../src/observed/scenario-state';
import { installedForgeBackend } from '../src/observed/installed';

const seat = { life: 20, hand: [], library: ['Island'], battlefield: [], graveyard: [] };
const state = { schemaVersion: 1, active: 0, phase: 'MAIN1', seats: [seat, seat] };

describe('verification-only Forge state', () => {
  it('refuses scenario injection through normal backend construction', () => {
    const options = { scenarioForTest: state, timeoutMs: 1000 };
    expect(() => installedForgeBackend(options)).toThrow('verification-only constructor');
  });
  it('accepts explicit complete two-seat states', () => {
    expect(ForgeScenarioStateSchema.parse(state)).toEqual(state);
  });

  it('accepts the OPENING_HAND phase', () => {
    const opening = { ...state, phase: 'OPENING_HAND' };
    expect(ForgeScenarioStateSchema.parse(opening)).toEqual(opening);
  });

  it.each([
    ['active 1', { active: 1 }, 'OPENING_HAND active seat is fixed to 0 by Puzzle mode'],
    [
      'a battlefield entry',
      { seats: [{ ...seat, battlefield: ['Island'] }, seat] },
      'OPENING_HAND seat may not declare battlefield',
    ],
    [
      'a graveyard entry',
      { seats: [seat, { ...seat, graveyard: ['Island'] }] },
      'OPENING_HAND seat may not declare graveyard',
    ],
    [
      'a commander',
      { seats: [{ ...seat, command: ['Isperia, Supreme Judge'] }, seat] },
      'OPENING_HAND seat may not declare command',
    ],
  ])('refuses OPENING_HAND with %s, for the reason the bridge gives', (_label, change, reason) => {
    const result = ForgeScenarioStateSchema.safeParse({ ...state, phase: 'OPENING_HAND', ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([reason]);
  });

  it('still parses MAIN1 with active 1 and a battlefield entry', () => {
    const main = { ...state, active: 1, seats: [{ ...seat, battlefield: ['Island'] }, seat] };
    expect(ForgeScenarioStateSchema.parse(main)).toEqual(main);
  });

  it('parses a commander per seat in MAIN1', () => {
    const commander = { ...state, seats: [{ ...seat, command: ['Isperia, Supreme Judge'] }, seat] };
    expect(ForgeScenarioStateSchema.parse(commander)).toEqual(commander);
  });

  it.each(['Island;Mountain', 'Island\nailife=0', 'Island|Tapped', 'Island=1', ''])(
    'rejects Forge state syntax in a card name: %j',
    (name) => {
      for (const zone of ['hand', 'command'] as const) {
        expect(() =>
          ForgeScenarioStateSchema.parse({
            ...state,
            seats: [{ ...seat, [zone]: [name] }, seat],
          }),
        ).toThrow();
      }
    },
  );

  it.each([
    { active: 2 },
    { phase: 'UNKNOWN' },
    { seats: [seat] },
    { qualification: 'supported' },
    { seats: [{ ...seat, life: 0 }, seat] },
    { seats: [{ ...seat, command: [] }, seat] },
  ])('rejects invalid or undeclared scenario fields: %j', (change) => {
    expect(() => ForgeScenarioStateSchema.parse({ ...state, ...change })).toThrow();
  });
});

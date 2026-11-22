import { describe, expect, it } from 'vitest';
import { pass, required, run, useInstalledBridge, type ObservedDecision } from './support/kld-scenario-run';

useInstalledBridge();

const named = (decision: ObservedDecision, name: string): string | undefined =>
  decision.options.find((option) => option.text.includes(name))?.id;

describe.skipIf(!required)('Ravnica interaction witnesses', () => {
  it('sacrifices three distinct lands to activate Torpid Moloch', async () => {
    const selected = new Set<string>();
    let activated = false;
    const { view, trace } = await run(
      'torpid-moloch',
      {
        hand: [],
        battlefield: ['Torpid Moloch', 'Mountain', 'Forest', 'Swamp'],
      },
      (decision, state) => {
        if (decision.kind === 'priority') {
          if (!activated) {
            activated = true;
            return named(decision, 'Torpid Moloch:');
          }
          return state.stack.length === 0 ? null : pass(decision);
        }
        if (decision.kind === 'cost-sacrifice-selection') {
          const choice = decision.options.find(
            (option) => option.targets.length === 1 && !selected.has(option.targets[0]!.oid),
          );
          if (choice?.targets[0] !== undefined) selected.add(choice.targets[0].oid);
          return choice?.id;
        }
        return decision.options[0]?.id;
      },
      'rav',
    );
    const evidence = trace.slice(-16).join('\n');
    expect(selected.size, evidence).toBe(3);
    expect(
      view.seats[0].battlefield.map((card) => card.name),
      evidence,
    ).toEqual(['Torpid Moloch']);
    expect(view.seats[0].graveyard.map((card) => card.name).sort(), evidence).toEqual([
      'Forest',
      'Mountain',
      'Swamp',
    ]);
  }, 180_000);

  it('returns exactly one controlled land when Boros Garrison enters', async () => {
    let played = false;
    let returned = false;
    const { view, trace } = await run(
      'boros-garrison',
      {
        hand: ['Boros Garrison'],
        battlefield: ['Plains'],
      },
      (decision, state) => {
        if (decision.kind === 'priority') {
          if (!played) {
            played = true;
            return named(decision, 'Play Boros Garrison');
          }
          return returned && state.stack.length === 0 ? null : pass(decision);
        }
        if (decision.prompt === 'Select a card from your battlefield') {
          returned = true;
          return named(decision, 'Choose Plains [');
        }
        return decision.options[0]?.id;
      },
      'rav',
    );
    const evidence = trace.slice(-16).join('\n');
    expect(returned, evidence).toBe(true);
    expect(
      view.seats[0].hand?.map((card) => card.name),
      evidence,
    ).toEqual(['Plains']);
    expect(
      view.seats[0].battlefield.map((card) => card.name),
      evidence,
    ).toEqual(['Boros Garrison']);
  }, 180_000);
});

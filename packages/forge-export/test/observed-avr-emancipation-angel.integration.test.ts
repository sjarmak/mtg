/** Installed-Forge witness that Emancipation Angel's mandatory enters-the-battlefield return finishes instead of ending the match (mtg-6qgu5). */
import { describe, expect, it } from 'vitest';
import {
  pass,
  paySource,
  required,
  run,
  useInstalledBridge,
  type ObservedDecision,
} from './support/kld-scenario-run';

useInstalledBridge();

const chosen = (decision: ObservedDecision, name: string): string | undefined =>
  decision.options.find((option) => option.text.startsWith(`Choose ${name} [`))?.id;
const offered = (decision: ObservedDecision): string[] =>
  decision.options.flatMap((option) => /^Choose (.+) \[/u.exec(option.text)?.[1] ?? []).sort();

describe.skipIf(!required)('Emancipation Angel witness', () => {
  it.each([
    {
      returns: 'Thraben Valiant',
      hand: ['Thraben Valiant'],
      stays: ['Emancipation Angel', 'Plains', 'Plains', 'Plains'],
    },
    {
      returns: 'Emancipation Angel',
      hand: ['Emancipation Angel'],
      stays: ['Plains', 'Plains', 'Plains', 'Thraben Valiant'],
    },
  ])(
    'returns $returns to its owner’s hand when the Angel enters, from every permanent the controller has',
    async ({ returns, hand, stays }) => {
      let cast = false;
      let asked: ObservedDecision | undefined;
      const { view, trace } = await run(
        'emancipation-angel',
        {
          hand: ['Emancipation Angel'],
          battlefield: ['Plains', 'Plains', 'Plains', 'Thraben Valiant'],
        },
        (decision, state) => {
          if (decision.kind === 'mana-payment') return paySource(decision, 'Plains');
          if (decision.kind === 'priority') {
            if (!cast) {
              cast = true;
              return decision.options.find((option) => option.text.startsWith('Emancipation Angel:'))?.id;
            }
            return asked !== undefined && state.stack.length === 0 ? null : pass(decision);
          }
          asked = decision;
          return chosen(decision, returns);
        },
        'avr',
      );
      const evidence = trace.slice(-8).join('\n');
      expect(asked, evidence).toBeDefined();
      expect(asked?.prompt, evidence).toBe('Select a card from your battlefield');
      expect(offered(asked as ObservedDecision), evidence).toEqual([
        'Emancipation Angel',
        'Plains',
        'Plains',
        'Plains',
        'Thraben Valiant',
      ]);
      expect(
        asked?.options.map((option) => option.id),
        'the return is mandatory, so no decline is offered',
      ).not.toContain('zone-decline');
      expect(view.seats[0].hand?.map((card) => card.name) ?? [], evidence).toEqual(hand);
      expect(view.seats[0].battlefield.map((card) => card.name).sort(), evidence).toEqual(stays);
    },
    180_000,
  );
});

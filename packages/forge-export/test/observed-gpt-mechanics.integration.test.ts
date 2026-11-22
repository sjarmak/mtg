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

const named = (decision: ObservedDecision, text: string): string | undefined =>
  decision.options.find((option) => option.text.includes(text))?.id;

const targetNamed = (decision: ObservedDecision, name: string): string | undefined =>
  decision.options.find((option) => option.targets.some((target) => target.name === name))?.id;

describe.skipIf(!required)('GPT mechanic witnesses', () => {
  it('pays Replicate once and taps two distinct permanents with Gigadrowse', async () => {
    let cast = false;
    let replicated = false;
    const targets = new Set<string>();
    const { view, trace } = await run(
      'replicate',
      {
        hand: ['Gigadrowse'],
        battlefield: ['Island', 'Island'],
        opponent: ['Plains', 'Forest'],
      },
      (decision, state) => {
        if (decision.kind === 'priority') {
          if (!cast) {
            const move = named(decision, 'Gigadrowse');
            cast = move !== undefined;
            return move;
          }
          return state.stack.length === 0 ? null : pass(decision);
        }
        if (decision.kind === 'number') {
          replicated = true;
          return decision.options.find((option) => option.id === 'number-1')?.id;
        }
        if (decision.kind.endsWith('target-selection')) {
          const choice = decision.options.find((option) =>
            option.targets.some(
              (target) => (target.name === 'Plains' || target.name === 'Forest') && !targets.has(target.oid),
            ),
          );
          if (choice?.targets[0] !== undefined) targets.add(choice.targets[0].oid);
          return choice?.id;
        }
        if (decision.kind === 'mana-payment') return paySource(decision, 'Island');
        return decision.options[0]?.id;
      },
      'gpt',
    );
    const evidence = trace.slice(-24).join('\n');
    expect({ cast, replicated, targets: targets.size }, evidence).toEqual({
      cast: true,
      replicated: true,
      targets: 2,
    });
    expect(
      view.seats[1].battlefield.every((card) => card.tapped),
      evidence,
    ).toBe(true);
  }, 240_000);

  it('stacks an untargeted Replicate copy of Train of Thought', async () => {
    let cast = false;
    let replicated = false;
    const { view, trace } = await run(
      'replicate-untargeted',
      {
        hand: ['Train of Thought'],
        battlefield: ['Island', 'Island', 'Island', 'Island'],
        library: ['Forest', 'Swamp'],
      },
      (decision, state) => {
        if (decision.kind === 'priority') {
          if (!cast) {
            const move = named(decision, 'Train of Thought');
            cast = move !== undefined;
            return move;
          }
          return state.stack.length === 0 && state.seats[0].hand?.length === 2 ? null : pass(decision);
        }
        if (decision.kind === 'number') {
          replicated = true;
          return decision.options.find((option) => option.id === 'number-1')?.id;
        }
        if (decision.kind === 'mana-payment') return paySource(decision, 'Island');
        return decision.options[0]?.id;
      },
      'gpt',
    );
    const evidence = trace.slice(-24).join('\n');
    expect({ cast, replicated, hand: view.seats[0].hand?.map((card) => card.name) }, evidence).toEqual({
      cast: true,
      replicated: true,
      hand: ['Forest', 'Swamp'],
    });
  }, 240_000);

  it('puts a counter on Skarrgan Pit-Skulk after Scorched Rusalka deals damage', async () => {
    let activated = false;
    let cast = false;
    const { view, trace } = await run(
      'bloodthirst',
      {
        hand: ['Skarrgan Pit-Skulk'],
        battlefield: ['Scorched Rusalka', 'Mountain', 'Forest'],
      },
      (decision, state) => {
        if (decision.kind === 'priority') {
          if (!activated) {
            const move = named(decision, 'Scorched Rusalka:');
            activated = move !== undefined;
            return move;
          }
          if (state.seats[1].life === 19 && !cast) {
            const move = named(decision, 'Skarrgan Pit-Skulk');
            cast = move !== undefined;
            return move;
          }
          return cast && state.stack.length === 0 ? null : pass(decision);
        }
        if (decision.kind === 'target-selection') return named(decision, 'Scenario observer');
        if (decision.kind === 'cost-sacrifice-selection') return targetNamed(decision, 'Scorched Rusalka');
        if (decision.kind === 'mana-payment') return paySource(decision, activated ? 'Mountain' : 'Forest');
        return decision.options[0]?.id;
      },
      'gpt',
    );
    const evidence = trace.slice(-24).join('\n');
    expect({ activated, cast, opponentLife: view.seats[1].life }, evidence).toEqual({
      activated: true,
      cast: true,
      opponentLife: 19,
    });
    expect(
      view.seats[0].battlefield.find((card) => card.name === 'Skarrgan Pit-Skulk'),
      evidence,
    ).toMatchObject({ power: 2, toughness: 2, counters: { P1P1: 1 } });
  }, 240_000);

  it('exiles Benediction of Moons haunting a creature and triggers when it dies', async () => {
    let cast = false;
    let activated = false;
    const { view, trace } = await run(
      'haunt',
      {
        hand: ['Benediction of Moons'],
        battlefield: ['Scorched Rusalka', 'Plains', 'Mountain'],
      },
      (decision, state) => {
        if (decision.kind === 'priority') {
          if (!cast) {
            const move = named(decision, 'Benediction of Moons');
            cast = move !== undefined;
            return move;
          }
          if (state.seats[0].exile.some((card) => card.name === 'Benediction of Moons') && !activated) {
            const move = named(decision, 'Scorched Rusalka:');
            activated = move !== undefined;
            return move;
          }
          return activated && state.stack.length === 0 && state.seats[0].life === 24 ? null : pass(decision);
        }
        if (decision.kind === 'target-selection') {
          return targetNamed(decision, 'Scorched Rusalka') ?? named(decision, 'Scenario observer');
        }
        if (decision.kind === 'cost-sacrifice-selection') return targetNamed(decision, 'Scorched Rusalka');
        if (decision.kind === 'mana-payment') return paySource(decision, activated ? 'Mountain' : 'Plains');
        return decision.options[0]?.id;
      },
      'gpt',
    );
    const evidence = trace.slice(-32).join('\n');
    expect(
      {
        cast,
        activated,
        life: view.seats[0].life,
        graveyard: view.seats[0].graveyard.map((card) => card.name),
        exile: view.seats[0].exile.map((card) => card.name),
      },
      evidence,
    ).toEqual({
      cast: true,
      activated: true,
      life: 24,
      graveyard: ['Scorched Rusalka'],
      exile: ['Benediction of Moons'],
    });
  }, 240_000);
});

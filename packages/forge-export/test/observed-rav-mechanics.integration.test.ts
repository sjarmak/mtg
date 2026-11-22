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

describe.skipIf(!required)('RAV mechanic witnesses', () => {
  it('pays Gather Courage through Convoke and resolves its pump', async () => {
    let cast = false;
    let convoked = false;
    const { view, trace } = await run(
      'convoke',
      {
        hand: ['Gather Courage'],
        battlefield: ['Elves of Deep Shadow'],
        library: ['Forest'],
      },
      (decision, state) => {
        if (decision.kind === 'priority') {
          if (!cast) {
            const move = named(decision, 'Gather Courage');
            cast = move !== undefined;
            return move;
          }
          return state.stack.length === 0 ? null : pass(decision);
        }
        if (decision.kind === 'convoke-payment') {
          if (convoked) return named(decision, 'Done');
          const move = targetNamed(decision, 'Elves of Deep Shadow');
          convoked = move !== undefined;
          return move;
        }
        if (decision.kind === 'target-selection') return targetNamed(decision, 'Elves of Deep Shadow');
        return decision.options[0]?.id;
      },
      'rav',
    );
    const evidence = trace.slice(-16).join('\n');
    expect({ cast, convoked }, evidence).toEqual({ cast: true, convoked: true });
    expect(
      view.seats[0].battlefield.find((card) => card.name === 'Elves of Deep Shadow'),
      evidence,
    ).toMatchObject({ tapped: true, power: 3, toughness: 3 });
  }, 240_000);

  it('applies Cleansing Beam Radiance to each creature sharing the target color', async () => {
    let cast = false;
    const { view, trace } = await run(
      'radiance',
      {
        hand: ['Cleansing Beam'],
        battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Mountain', 'Elves of Deep Shadow'],
        opponent: ['Birds of Paradise', 'Boros Recruit'],
        library: ['Mountain'],
      },
      (decision, state) => {
        if (decision.kind === 'priority') {
          if (!cast) {
            const move = named(decision, 'Cleansing Beam');
            cast = move !== undefined;
            return move;
          }
          return state.stack.length === 0 ? null : pass(decision);
        }
        if (decision.kind === 'target-selection') return targetNamed(decision, 'Elves of Deep Shadow');
        if (decision.kind === 'mana-payment') return paySource(decision, 'Mountain');
        return decision.options[0]?.id;
      },
      'rav',
    );
    const evidence = trace.slice(-16).join('\n');
    expect(cast, evidence).toBe(true);
    expect(
      view.seats[0].graveyard.map((card) => card.name),
      evidence,
    ).toContain('Elves of Deep Shadow');
    expect(
      view.seats[1].graveyard.map((card) => card.name),
      evidence,
    ).toContain('Birds of Paradise');
    expect(
      view.seats[1].battlefield.map((card) => card.name),
      evidence,
    ).toContain('Boros Recruit');
  }, 240_000);

  it('pays Brainspoil Transmute and finds a card with mana value five', async () => {
    let activated = false;
    let selected = false;
    const { view, trace } = await run(
      'transmute',
      {
        hand: ['Brainspoil'],
        battlefield: ['Swamp', 'Swamp', 'Swamp'],
        library: ['Belltower Sphinx', 'Swamp'],
      },
      (decision) => {
        if (selected) return null;
        if (decision.kind === 'priority' && !activated) {
          const move = named(decision, 'Transmute');
          activated = move !== undefined;
          return move;
        }
        if (decision.kind === 'zone-card-selection') {
          const move = targetNamed(decision, 'Belltower Sphinx');
          selected = move !== undefined;
          return move;
        }
        if (decision.kind === 'mana-payment') return paySource(decision, 'Swamp');
        if (decision.kind === 'priority') return pass(decision);
        return decision.options[0]?.id;
      },
      'rav',
    );
    const evidence = trace.slice(-16).join('\n');
    expect({ activated, selected }, evidence).toEqual({ activated: true, selected: true });
    expect(
      view.seats[0].hand?.map((card) => card.name),
      evidence,
    ).toContain('Belltower Sphinx');
    expect(
      view.seats[0].graveyard.map((card) => card.name),
      evidence,
    ).toContain('Brainspoil');
  }, 240_000);

  it('replaces a Compulsive Research draw with Stinkweed Imp Dredge', async () => {
    let cast = false;
    const { view, trace } = await run(
      'dredge',
      {
        hand: ['Compulsive Research'],
        battlefield: ['Island', 'Island', 'Island'],
        library: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'],
        graveyard: ['Stinkweed Imp'],
      },
      (decision, state) => {
        if (state.seats[0].hand?.some((card) => card.name === 'Stinkweed Imp')) return null;
        if (decision.kind === 'priority' && !cast) {
          const move = named(decision, 'Compulsive Research');
          cast = move !== undefined;
          return move;
        }
        if (decision.kind === 'target-selection') return named(decision, 'Scenario captain');
        if (decision.kind === 'confirm-replacement') return named(decision, 'Apply the replacement');
        if (decision.kind === 'mana-payment') return paySource(decision, 'Island');
        if (decision.kind === 'priority') return pass(decision);
        return decision.options[0]?.id;
      },
      'rav',
    );
    const evidence = trace.slice(-16).join('\n');
    expect(cast, evidence).toBe(true);
    expect(
      view.seats[0].hand?.map((card) => card.name),
      evidence,
    ).toContain('Stinkweed Imp');
    expect(view.seats[0].graveyard, evidence).toHaveLength(5);
  }, 240_000);

  it('pays both Boros Guildmage hybrid pips with red mana', async () => {
    let cast = false;
    let payments = 0;
    const { view, trace } = await run(
      'hybrid',
      {
        hand: ['Boros Guildmage'],
        battlefield: ['Mountain', 'Mountain'],
        library: ['Mountain'],
      },
      (decision, state) => {
        if (decision.kind === 'priority') {
          if (!cast) {
            const move = named(decision, 'Boros Guildmage');
            cast = move !== undefined;
            return move;
          }
          return state.stack.length === 0 ? null : pass(decision);
        }
        if (decision.kind === 'mana-payment') {
          payments += 1;
          return paySource(decision, 'Mountain');
        }
        return decision.options[0]?.id;
      },
      'rav',
    );
    const evidence = trace.slice(-16).join('\n');
    expect({ cast, payments }, evidence).toEqual({ cast: true, payments: 2 });
    expect(
      view.seats[0].battlefield.map((card) => card.name),
      evidence,
    ).toContain('Boros Guildmage');
  }, 240_000);
});

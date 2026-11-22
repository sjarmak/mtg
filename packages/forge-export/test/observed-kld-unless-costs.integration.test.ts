/** Installed-Forge witnesses for the unless-costs Kaladesh reaches outside Energy: Fabricate's counters and a spell countered unless its controller pays. */
import { describe, expect, it } from 'vitest';
import { pass, paySource, required, run, useInstalledBridge } from './support/kld-scenario-run';

useInstalledBridge();

describe.skipIf(!required)('KLD unless-cost witnesses', () => {
  it.each([
    { choice: 'counters', answer: 'Pay it', power: 2, servos: 0 },
    { choice: 'tokens', answer: 'Do not pay it', power: 0, servos: 2 },
  ])(
    'resolves Fabricate 2 as $choice',
    async ({ answer, power, servos }) => {
      let cast = false;
      let asked = false;
      const { view, trace } = await run(
        'fabricate',
        { hand: ['Weaponcraft Enthusiast'], battlefield: ['Swamp', 'Swamp', 'Swamp'] },
        (decision, table) => {
          if (decision.kind === 'mana-payment') return paySource(decision, 'Swamp');
          if (decision.kind === 'priority') {
            if (!cast) {
              cast = true;
              return decision.options.find((option) => option.text.startsWith('Weaponcraft Enthusiast:'))?.id;
            }
            return asked && table.stack.length === 0 ? null : pass(decision);
          }
          const choice = decision.options.find((option) => option.text === answer);
          if (choice !== undefined) asked = true;
          return choice?.id ?? decision.options.find((option) => !option.id.includes('cancel'))?.id;
        },
      );
      const mine = view.seats[0].battlefield;
      const evidence = `${mine.map((card) => `${card.name} ${card.power}/${card.toughness}`).join(', ')}\n${trace.slice(-6).join('\n')}`;
      const creature = mine.find((card) => card.name === 'Weaponcraft Enthusiast');
      expect(asked, evidence).toBe(true);
      expect(creature?.power, evidence).toBe(power);
      expect(
        mine.filter((card) => card.name === 'Servo Token'),
        evidence,
      ).toHaveLength(servos);
    },
    180_000,
  );

  it('asks the local player about the {2} of an opposing Revolutionary Rebuff and counters the spell when they decline', async () => {
    let cast = false;
    let asked = false;
    const { view, trace } = await run(
      'rebuff',
      {
        hand: ['Prakhata Club Security'],
        battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp'],
        opponentHand: ['Revolutionary Rebuff'],
        opponent: ['Island', 'Island'],
      },
      (decision, table) => {
        if (decision.kind === 'mana-payment') return paySource(decision, 'Swamp');
        if (decision.kind === 'priority') {
          if (!cast) {
            cast = true;
            return decision.options.find((option) => option.text.startsWith('Prakhata Club Security:'))?.id;
          }
          return asked && table.stack.length === 0 ? null : pass(decision);
        }
        const decline = decision.options.find((option) => option.text === 'Do not pay it');
        if (decline !== undefined) asked = true;
        return decline?.id;
      },
    );
    const evidence = trace.slice(-8).join('\n');
    expect(asked, evidence).toBe(true);
    expect(
      view.seats[0].battlefield.map((card) => card.name),
      evidence,
    ).not.toContain('Prakhata Club Security');
    expect(
      view.seats[0].graveyard.map((card) => card.name),
      evidence,
    ).toContain('Prakhata Club Security');
  }, 180_000);
});

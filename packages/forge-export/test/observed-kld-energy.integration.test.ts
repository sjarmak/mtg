/** Installed-Forge witnesses that Kaladesh's Energy costs reach the bridge and are paid: an ability cost, a mana ability's cost, an unless-cost, an attack trigger and a chosen amount. */
import { describe, expect, it } from 'vitest';
import { pass, paySource, required, run, useInstalledBridge } from './support/kld-scenario-run';

useInstalledBridge();

describe.skipIf(!required)('KLD Energy witnesses', () => {
  it('pays {E} as the whole cost of an activated ability, and the ability is gone once the energy is', async () => {
    let cast = false;
    let activated = false;
    let offeredAfter = false;
    const { view, trace } = await run(
      'ability-cost',
      { hand: ['Spontaneous Artist'], battlefield: ['Mountain', 'Swamp', 'Swamp', 'Swamp'] },
      (decision, table) => {
        if (decision.kind === 'mana-payment') return paySource(decision, 'Mountain');
        if (decision.kind === 'priority') {
          const artist = decision.options.find((option) => option.text.startsWith('Spontaneous Artist:'));
          if (!cast) {
            cast = true;
            return artist?.id;
          }
          const onBattlefield = table.seats[0].battlefield.some((card) => card.name === 'Spontaneous Artist');
          if (onBattlefield && table.stack.length === 0) {
            if (!activated) {
              activated = true;
              return artist?.id;
            }
            offeredAfter = artist !== undefined;
            return null;
          }
          return pass(decision);
        }
        return decision.options.find((option) => !option.id.includes('cancel'))?.id;
      },
    );
    const evidence = trace.slice(-8).join('\n');
    expect(activated, evidence).toBe(true);
    expect(offeredAfter, `the Energy was not spent\n${evidence}`).toBe(false);
    expect(view.stack, evidence).toEqual([]);
  }, 180_000);

  it("pays {E} for the mana ability of Aether Hub, offered only while the Hub's Energy is there", async () => {
    let played = false;
    let paidFromHub = false;
    const { view, trace } = await run(
      'mana-ability',
      { hand: ['Aether Hub', 'Tasseled Dromedary'], battlefield: [] },
      (decision, table) => {
        if (decision.kind === 'mana-payment') {
          const hub = decision.options.find(
            (option) =>
              option.id.startsWith('mana-source-') &&
              option.text.includes('Aether Hub') &&
              option.text.endsWith('{W}'),
          );
          if (hub === undefined) return undefined;
          paidFromHub = true;
          return hub.id;
        }
        if (decision.kind === 'priority') {
          if (table.seats[0].battlefield.some((card) => card.name === 'Tasseled Dromedary')) return null;
          const play = decision.options.find((option) => option.text === 'Play Aether Hub');
          const cast = decision.options.find((option) => option.text.startsWith('Tasseled Dromedary:'));
          if (!played && play !== undefined) {
            played = true;
            return play.id;
          }
          return table.stack.length === 0 && played ? cast?.id : pass(decision);
        }
        return decision.options.find((option) => !option.id.includes('cancel'))?.id;
      },
    );
    const evidence = trace.slice(-8).join('\n');
    expect(paidFromHub, evidence).toBe(true);
    expect(view.seats[0].battlefield.map((card) => card.name).sort(), evidence).toEqual([
      'Aether Hub',
      'Tasseled Dromedary',
    ]);
  }, 180_000);

  it('offers the unless-cost {E}{E} of Lathnu Hellion at the end step and keeps it when paid', async () => {
    let cast = false;
    let asked = false;
    const { view, trace } = await run(
      'unless-cost',
      { hand: ['Lathnu Hellion'], battlefield: ['Mountain', 'Swamp', 'Swamp'] },
      (decision, table) => {
        if (table.turn.number >= 2) return null;
        if (decision.kind === 'mana-payment') return paySource(decision, 'Mountain');
        if (decision.kind === 'priority') {
          if (!cast) {
            cast = true;
            return decision.options.find((option) => option.text.startsWith('Lathnu Hellion:'))?.id;
          }
          return pass(decision);
        }
        asked = true;
        return (
          decision.options.find((option) => /^(pay|yes)/i.test(option.text))?.id ??
          decision.options.find((option) => !option.id.includes('cancel'))?.id
        );
      },
    );
    const evidence = trace.slice(-10).join('\n');
    expect(asked, evidence).toBe(true);
    expect(
      view.seats[0].battlefield.map((card) => card.name),
      evidence,
    ).toContain('Lathnu Hellion');
    expect(view.seats[0].graveyard, evidence).toEqual([]);
  }, 180_000);

  it('offers the optional {E} of an attack trigger and applies its pump once it is paid', async () => {
    let played = false;
    let attacked = false;
    let accepted = false;
    let strongest = 0;
    let mostEnergy = 0;
    const { view, trace } = await run(
      'attack-trigger',
      { hand: ['Aether Hub'], battlefield: ['Voltaic Brawler'] },
      (decision, table) => {
        const brawler = table.seats[0].battlefield.find((card) => card.name === 'Voltaic Brawler');
        strongest = Math.max(strongest, brawler?.power ?? 0);
        mostEnergy = Math.max(mostEnergy, table.seats[0].playerCounters?.['ENERGY'] ?? 0);
        if (decision.kind === 'priority') {
          if (table.turn.step === 'END_OF_TURN' && attacked) return null;
          const play = decision.options.find((option) => option.text === 'Play Aether Hub');
          if (!played && play !== undefined) {
            played = true;
            return play.id;
          }
          return pass(decision);
        }
        if (decision.kind === 'combat-attackers') {
          const attack = decision.options.find((option) => option.id.startsWith('combat-attack-add-'));
          if (!attacked && attack !== undefined) {
            attacked = true;
            return attack.id;
          }
          return decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        }
        const use = decision.options.find((option) => option.id === 'confirm-trigger-yes');
        if (use !== undefined) accepted = true;
        return use?.id ?? decision.options.find((option) => !option.id.includes('cancel'))?.id;
      },
    );
    const evidence = `power ${strongest}\n${trace.slice(-10).join('\n')}`;
    expect(attacked, evidence).toBe(true);
    expect(accepted, evidence).toBe(true);
    expect(strongest, `the pump was not applied\n${evidence}`).toBe(4);
    // `mtg-vzxqq`: the Energy the Hub made is on the seat's projected view while it is
    // held, and the key is gone once it is spent; poison is reported at zero, not omitted.
    expect(mostEnergy, `the Hub's Energy was never projected\n${evidence}`).toBe(1);
    expect(view.seats[0].playerCounters, `the spent Energy is still projected\n${evidence}`).toBeUndefined();
    expect(view.seats[0].poison, evidence).toBe(0);
    expect(view.seats[1].poison, evidence).toBe(0);
  }, 180_000);

  it('pays a chosen amount of {E} as the unless-cost of Harnessed Lightning', async () => {
    let cast = false;
    let chose = false;
    const { view, trace } = await run(
      'chosen-amount',
      {
        hand: ['Harnessed Lightning'],
        battlefield: ['Mountain', 'Mountain'],
        opponent: ['Tasseled Dromedary'],
      },
      (decision, table) => {
        if (decision.kind === 'mana-payment') return paySource(decision, 'Mountain');
        if (decision.kind === 'priority') {
          const spell = decision.options.find((option) => option.text.startsWith('Harnessed Lightning:'));
          if (!cast) {
            cast = true;
            return spell?.id;
          }
          const hit = table.seats[1].battlefield.find((card) => card.name === 'Tasseled Dromedary');
          return (hit?.damage ?? 0) > 0 && table.stack.length === 0 ? null : pass(decision);
        }
        const pay = decision.options.find((option) => option.text === 'Pay it');
        if (pay !== undefined) return pay.id;
        chose ||= /energy|amount/i.test(decision.prompt);
        const numbers = decision.options.filter((option) => !option.id.includes('cancel'));
        return numbers[numbers.length - 1]?.id;
      },
    );
    const evidence = trace.slice(-8).join('\n');
    expect(chose, evidence).toBe(true);
    expect(
      view.seats[1].battlefield.find((card) => card.name === 'Tasseled Dromedary')?.damage,
      evidence,
    ).toBe(3);
  }, 180_000);
});

/** Installed-Forge witnesses for three Kaladesh-era cards a catalog-coverage sweep aborted on although qualification counted them covered: Cathartic Reunion's discard cost, Verdant Crescendo's second search and Cloudstone Curio's return. */
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

const NISSA = "Nissa, Nature's Artisan";
const chosen = (decision: ObservedDecision, name: string): string | undefined =>
  decision.options.find((option) => option.text.startsWith(`Choose ${name} [`))?.id;

describe.skipIf(!required)('KLD search and discard witnesses', () => {
  it('discards two chosen cards as the additional cost of Cathartic Reunion, then draws three', async () => {
    let cast = false;
    let discards = 0;
    const { view, trace } = await run(
      'cathartic-reunion',
      {
        hand: ['Cathartic Reunion', 'Forest', 'Mountain'],
        battlefield: ['Mountain', 'Mountain'],
        library: ['Swamp', 'Swamp', 'Swamp', 'Swamp'],
      },
      (decision, table) => {
        if (decision.kind === 'mana-payment') return paySource(decision, 'Mountain');
        if (decision.kind === 'priority') {
          if (!cast) {
            cast = true;
            return decision.options.find((option) => option.text.startsWith('Cathartic Reunion:'))?.id;
          }
          return discards === 2 && table.stack.length === 0 ? null : pass(decision);
        }
        const discard = decision.options.find(
          (option) => option.id.startsWith('cost-discard-') && !option.id.includes('cancel'),
        );
        if (discard !== undefined) discards += 1;
        return discard?.id ?? decision.options.find((option) => !option.id.includes('cancel'))?.id;
      },
    );
    const evidence = trace.slice(-8).join('\n');
    expect(discards, evidence).toBe(2);
    expect(
      view.seats[0].hand?.map((card) => card.name),
      evidence,
    ).toEqual(['Swamp', 'Swamp', 'Swamp']);
    expect(view.seats[0].graveyard.map((card) => card.name).sort(), evidence).toEqual([
      'Cathartic Reunion',
      'Forest',
      'Mountain',
    ]);
  }, 180_000);

  it.each([
    {
      where: 'library',
      table: { library: ['Swamp', 'Forest', NISSA, 'Swamp'], graveyard: [] },
      hand: [NISSA],
    },
    {
      where: 'graveyard',
      table: { library: ['Swamp', 'Forest', 'Swamp'], graveyard: [NISSA] },
      hand: [NISSA],
    },
    { where: 'nowhere', table: { library: ['Swamp', 'Forest', 'Swamp'], graveyard: [] }, hand: [] },
  ])(
    "puts a basic land onto the battlefield and finds Nissa, Nature's Artisan in the $where with Verdant Crescendo",
    async ({ table, hand }) => {
      let cast = false;
      let landed = false;
      let searched = false;
      const { view, trace } = await run(
        'verdant-crescendo',
        {
          hand: ['Verdant Crescendo'],
          battlefield: ['Forest', 'Forest', 'Forest', 'Forest'],
          ...table,
        },
        (decision, state) => {
          if (decision.kind === 'mana-payment') return paySource(decision, 'Forest');
          if (decision.kind === 'priority') {
            if (!cast) {
              cast = true;
              return decision.options.find((option) => option.text.startsWith('Verdant Crescendo:'))?.id;
            }
            return landed && state.stack.length === 0 ? null : pass(decision);
          }
          if (/graveyard/.test(decision.prompt)) {
            searched = true;
            return (
              chosen(decision, NISSA) ?? decision.options.find((option) => option.id === 'zone-decline')?.id
            );
          }
          landed = true;
          return (
            chosen(decision, 'Forest') ?? decision.options.find((option) => option.id === 'zone-decline')?.id
          );
        },
      );
      const evidence = trace.slice(-8).join('\n');
      expect(landed, evidence).toBe(true);
      expect(
        view.seats[0].battlefield.filter((card) => card.name === 'Forest'),
        evidence,
      ).toHaveLength(5);
      expect(
        view.seats[0].hand?.map((card) => card.name),
        evidence,
      ).toEqual(hand);
      expect(searched || hand.length === 0, evidence).toBe(true);
    },
    180_000,
  );

  it.each([
    { answer: 'return', returned: ['Mountain'], stays: ['Cloudstone Curio', 'Forest'] },
    { answer: 'decline', returned: [], stays: ['Cloudstone Curio', 'Forest', 'Mountain'] },
  ])(
    'lets Cloudstone Curio return another land you control to your hand, or not ($answer)',
    async ({ answer, returned, stays }) => {
      let played = false;
      let asked = false;
      const { view, trace } = await run(
        'cloudstone-curio',
        { hand: ['Forest'], battlefield: ['Cloudstone Curio', 'Mountain'] },
        (decision, state) => {
          if (decision.kind === 'priority') {
            const play = decision.options.find((option) => option.text === 'Play Forest');
            if (!played && play !== undefined) {
              played = true;
              return play.id;
            }
            return asked && state.stack.length === 0 ? null : pass(decision);
          }
          const yes = decision.options.find(
            (option) => option.id === 'confirm-trigger-yes' || option.id === 'confirm-action-yes',
          );
          if (yes !== undefined) return yes.id;
          asked = true;
          return answer === 'return'
            ? chosen(decision, 'Mountain')
            : decision.options.find((option) => option.id === 'zone-decline')?.id;
        },
      );
      const evidence = trace.slice(-8).join('\n');
      expect(asked, evidence).toBe(true);
      expect(view.seats[0].hand?.map((card) => card.name) ?? [], evidence).toEqual(returned);
      expect(view.seats[0].battlefield.map((card) => card.name).sort(), evidence).toEqual(stays);
    },
    180_000,
  );
});

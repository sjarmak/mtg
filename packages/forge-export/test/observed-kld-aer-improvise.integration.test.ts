/** Installed-Forge witness for Aether Revolt's Improvise: artifacts pay the generic cost, never a color. */
import { describe, expect, it } from 'vitest';
import { pass, paySource, required, run, useInstalledBridge } from './support/kld-scenario-run';

useInstalledBridge();

describe.skipIf(!required)('AER Improvise witness', () => {
  it('taps three Ornithopters to pay all of {3} and leaves only {U}{U} for real mana', async () => {
    let cast = false;
    const improvisePrompts: string[] = [];
    const tappedForImprovise = new Set<string>();
    const { view, trace } = await run(
      'improvise',
      {
        hand: ['Reverse Engineer'],
        battlefield: ['Ornithopter', 'Ornithopter', 'Ornithopter', 'Island', 'Island'],
        library: ['Swamp', 'Swamp', 'Swamp'],
      },
      (decision, table) => {
        if (decision.kind === 'improvise-payment') {
          expect(cast).toBe(true);
          improvisePrompts.push(decision.prompt);
          const candidate = decision.options.find((option) => option.id !== 'improvise-payment-done');
          if (candidate !== undefined) {
            const oid = candidate.targets[0]?.oid;
            if (oid !== undefined) tappedForImprovise.add(oid);
            return candidate.id;
          }
          return 'improvise-payment-done';
        }
        if (decision.kind === 'mana-payment') return paySource(decision, 'Island');
        if (decision.kind === 'priority') {
          if (!cast) {
            cast = true;
            return decision.options.find((option) => option.text.startsWith('Reverse Engineer:'))?.id;
          }
          return table.stack.length === 0 ? null : pass(decision);
        }
        return undefined;
      },
    );
    const evidence = `${trace.slice(-12).join('\n')}\nview=${JSON.stringify(view)}`;
    const caster = view.seats[0];
    expect(cast, evidence).toBe(true);
    expect(tappedForImprovise.size, evidence).toBe(3);
    expect(
      caster.battlefield.filter((card) => card.name === 'Ornithopter' && card.tapped),
      evidence,
    ).toHaveLength(3);
    expect(
      caster.battlefield.filter((card) => card.name === 'Island' && card.tapped),
      evidence,
    ).toHaveLength(2);
    expect(
      improvisePrompts.some((prompt) => prompt.includes('{3}{U}{U}')),
      evidence,
    ).toBe(true);
    expect(
      improvisePrompts.some((prompt) => prompt.includes('{U}{U}') && !prompt.includes('{3}')),
      evidence,
    ).toBe(true);
    expect(caster.hand?.length, evidence).toBe(3);
  }, 180_000);
});

/**
 * The training CLI's refusals.
 *
 * One of them carries the whole of mtg-bw8z.1 and is the reason this file
 * exists: an outcome objective fitted over a run that never deviated from the
 * reference policy has no coverage of the alternatives its argmax ranges over,
 * so it scores them by extrapolation. That combination produced a model which
 * agreed with greedy on 95.9% of held-out decisions and lost two campaigns to
 * it, and nothing said so until the campaigns had been paid for. It is refused
 * at the flag now, so the next person cannot spend a campaign rediscovering it.
 */
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../tools/train-learned-evaluator';

const base = ['--games', '10', '--out', 'out/tmp/model.json'];

describe('train-learned-evaluator arguments', () => {
  it('defaults to the imitation objective with no exploration', () => {
    const options = parseArgs(base);
    expect(options.objective).toBe('imitation');
    expect(options.epsilon).toBe(0);
  });

  it('refuses an outcome objective over a run that never deviated', () => {
    expect(() => parseArgs([...base, '--objective', 'outcome'])).toThrow('extrapolation');
    expect(() => parseArgs([...base, '--objective', 'outcome', '--explore', '0'])).toThrow('coverage');
  });

  it('refuses exploration under an imitation objective, which would move the teacher', () => {
    expect(() => parseArgs([...base, '--explore', '0.25'])).toThrow('teacher');
  });

  it('accepts an outcome objective with exploration', () => {
    const options = parseArgs([...base, '--objective', 'outcome', '--explore', '0.25']);
    expect(options.objective).toBe('outcome');
    expect(options.epsilon).toBe(0.25);
  });

  it('accepts counterfactual sampling and anchored fine-tuning controls', () => {
    const options = parseArgs([
      ...base,
      '--objective',
      'counterfactual',
      '--sample-every',
      '7',
      '--branches-per-game',
      '3',
      '--anchor',
      '0.25',
    ]);
    expect(options.objective).toBe('counterfactual');
    expect(options.sampleEvery).toBe(7);
    expect(options.maximumBranches).toBe(3);
    expect(options.anchor).toBe(0.25);
  });

  it('refuses exploration for counterfactual branches and invalid branch budgets', () => {
    expect(() => parseArgs([...base, '--objective', 'counterfactual', '--explore', '0.1'])).toThrow(
      'reference continuation',
    );
    expect(() => parseArgs([...base, '--objective', 'counterfactual', '--sample-every', '0'])).toThrow(
      '--sample-every',
    );
  });

  it('refuses an unknown objective and a rate outside zero to one', () => {
    expect(() => parseArgs([...base, '--objective', 'q-learning'])).toThrow(
      'imitation, outcome, or counterfactual',
    );
    expect(() => parseArgs([...base, '--objective', 'outcome', '--explore', '1.5'])).toThrow('--explore');
  });
});

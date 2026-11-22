/** Protocol contract for reviewed modal effects that repeat one target callback. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

it('labels only the reviewed repeatable target route for bounded progress recovery', () => {
  expect(bridge).toContain('boolean reviewedRepeatableModeTarget');
  expect(bridge).toContain(
    'reviewedRepeatableModeTarget ? "repeatable-target-selection" : "target-selection"',
  );
});

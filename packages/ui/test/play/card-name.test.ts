// @vitest-environment jsdom
/** The native free-text answer for a card-name decision. */
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Decision, GameState } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
import { buildPrompt } from '../../src/routes/play/prompt';
import { promptPanel } from '../../src/routes/play/rail';

afterEach(cleanup);

const STATE: GameState = scenario({ seed: 'ui/card-name' }).state;
const DECISION: Decision = {
  kind: 'cardName',
  player: 1,
  chosen: [{ player: 0, name: 'Lightning Bolt' }],
  input: { kind: 'text', label: 'Card name', minLength: 1, maxLength: 256 },
  options: [],
  complete: true,
};

describe('the card-name prompt', () => {
  it('shows earlier APNAP choices without inventing an enumeration', () => {
    const prompt = buildPrompt(STATE, DECISION, ['Alice', 'Bob']);
    expect(prompt.headline).toBe('Name a card');
    expect(prompt.explain).toContain('Alice named Lightning Bolt');
    expect(prompt.choices).toEqual([]);
  });

  it('submits one trimmed constructed action and refuses an empty name', () => {
    const choose = vi.fn();
    render(createElement(() => promptPanel(buildPrompt(STATE, DECISION, ['Alice', 'Bob']), choose, 4)));

    const input = screen.getByRole('textbox', { name: 'Card name' });
    const submit = screen.getByRole('button', { name: 'Choose name' });
    fireEvent.click(submit);
    expect(choose).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '  Black Lotus  ' } });
    fireEvent.click(submit);

    expect(choose).toHaveBeenCalledWith({ type: 'chooseCardName', player: 1, name: 'Black Lotus' });
  });
});

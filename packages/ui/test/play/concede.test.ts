// @vitest-environment jsdom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { PlayPrompt } from '../../src/routes/play/prompt';
import { LEGAL_MOVES_LABEL, promptPanel } from '../../src/routes/play/rail';

afterEach(cleanup);

const PROMPT: PlayPrompt = {
  headline: 'Name a card',
  explain: 'Choose a card name or concede.',
  choices: [{ index: 0, label: 'Concede', detail: null, kind: 'concede', oids: [] }],
  textInput: { kind: 'cardName', player: 0, label: 'Card name', minLength: 1, maxLength: 64 },
  truncated: false,
};

describe('concession beside a special prompt', () => {
  it('remains reachable while the rail draws a bounded text answer', () => {
    render(h(() => promptPanel(PROMPT, () => undefined, 0)));
    expect(screen.getByRole('textbox', { name: 'Card name' })).toBeTruthy();
    expect(screen.getByRole('group', { name: LEGAL_MOVES_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Concede' })).toBeTruthy();
  });
});

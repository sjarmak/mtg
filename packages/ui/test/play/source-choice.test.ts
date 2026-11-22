// @vitest-environment jsdom
import { createElement as h } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LEGACY_CUBE_FORMAT } from '../../src/routes/legacy-cube/model';
import { SOURCE_CHOICE_LABEL, SourceChoice } from '../../src/routes/play/SourceChoice';
import type { PlaySource } from '../../src/routes/play/sources';

const sources: readonly PlaySource[] = [
  { kind: 'kernel', stem: 'xmp', name: 'the flagship set', origin: 'custom' },
  { kind: 'printed', stem: 'printed:akh-hou', name: 'Amonkhet / Hour of Devastation' },
  { kind: 'cube', stem: LEGACY_CUBE_FORMAT, name: 'MTGO Legacy Cube' },
];

function printedSources(count: number): readonly PlaySource[] {
  return Array.from({ length: count }, (_, index): PlaySource => ({
    kind: 'printed',
    stem: `printed:set-${String(index + 1)}`,
    name: `Printed format ${String(index + 1)}`,
  }));
}

/** The attribute a node carries, without the DOM lib (`./opponent-choice.test.ts`). */
function attr(node: unknown, name: string): string | null {
  return (node as { readonly getAttribute: (name: string) => string | null }).getAttribute(name);
}

/** The text under a node, on the same terms. */
function text(node: unknown): string {
  return (node as { readonly textContent: string | null }).textContent ?? '';
}

afterEach(cleanup);

it('names every source and marks the one this section is showing', () => {
  render(h(SourceChoice, { sources, selected: 'printed:akh-hou', onSource: () => undefined }));
  expect(screen.getByRole('heading', { level: 2, name: 'Playing with' })).toBeTruthy();
  const group = screen.getByRole('group', { name: SOURCE_CHOICE_LABEL });
  expect(screen.getByRole('heading', { level: 3, name: 'Generated sets' })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 3, name: 'Magic printed formats' })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 3, name: 'Cube' })).toBeTruthy();
  expect(text(group)).toContain('MTGO Legacy Cube');
  expect(attr(screen.getByRole('button', { name: 'the flagship set' }), 'aria-pressed')).toBe('false');
  const chosen = screen.getByRole('button', { name: 'Amonkhet / Hour of Devastation' });
  expect(attr(chosen, 'aria-pressed')).toBe('true');
  expect(attr(chosen, 'data-selected')).toBe('true');
});

it('draws nothing when there is one source or none, because that is not a choice', () => {
  const { container } = render(
    h(SourceChoice, { sources: sources.slice(0, 1), selected: 'xmp', onSource: () => undefined }),
  );
  expect(text(container)).toBe('');
  cleanup();
  const empty = render(h(SourceChoice, { sources: [], selected: null, onSource: () => undefined }));
  expect(text(empty.container)).toBe('');
});

it('hands the pressed chip’s stem back', () => {
  const onSource = vi.fn();
  render(h(SourceChoice, { sources, selected: 'xmp', onSource }));
  fireEvent.click(screen.getByRole('button', { name: 'MTGO Legacy Cube' }));
  expect(onSource).toHaveBeenCalledWith(LEGACY_CUBE_FORMAT);
});

it('keeps an unavailable source visible, disabled, and explained', () => {
  const onSource = vi.fn();
  const unavailable: readonly PlaySource[] = [
    {
      kind: 'printed',
      stem: 'printed:no-draft',
      name: 'Unavailable format',
      unavailableReason: 'Draft is not available for this printed format.',
    },
  ];
  render(h(SourceChoice, { sources: unavailable, selected: null, onSource }));
  const row = screen.getByRole('button', { name: /Unavailable format/u });
  expect(attr(row, 'aria-disabled')).toBe('true');
  expect(text(row)).toContain('Draft is not available for this printed format.');
  fireEvent.click(row);
  expect(onSource).not.toHaveBeenCalled();
});

it('separates duplicate generated and printed names by their named groups', () => {
  const duplicateSources: readonly PlaySource[] = [
    { kind: 'kernel', stem: 'm11', name: 'Magic 2011', origin: 'official' },
    { kind: 'printed', stem: 'printed:m11', name: 'Magic 2011' },
  ];
  render(h(SourceChoice, { sources: duplicateSources, selected: 'm11', onSource: () => undefined }));
  const generated = screen.getByRole('group', { name: 'Generated sets' });
  const printed = screen.getByRole('group', { name: 'Magic printed formats' });
  expect(within(generated).getByRole('button', { name: 'Magic 2011' })).toBeTruthy();
  expect(within(printed).getByRole('button', { name: 'Magic 2011' })).toBeTruthy();
});

it('keeps eight printed formats as chips', () => {
  const printed = printedSources(8);
  render(
    h(SourceChoice, {
      sources: [...printed, { kind: 'cube', stem: LEGACY_CUBE_FORMAT, name: 'MTGO Legacy Cube' }],
      selected: 'printed:set-1',
      onSource: () => undefined,
    }),
  );
  expect(screen.queryByRole('combobox', { name: 'Magic printed formats' })).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(9);
});

it('puts more than eight printed formats in a native select and returns its choice', () => {
  const onSource = vi.fn();
  const printed = printedSources(9);
  render(
    h(SourceChoice, {
      sources: [sources[0]!, ...printed],
      selected: 'xmp',
      onSource,
    }),
  );
  const picker = screen.getByRole('combobox', { name: 'Magic printed formats' });
  expect((picker as unknown as { readonly value: string }).value).toBe('');
  expect(screen.getAllByRole('option')).toHaveLength(10);
  expect(screen.getByRole('button', { name: 'the flagship set' })).toBeTruthy();
  fireEvent.change(picker, { target: { value: 'printed:set-9' } });
  expect(onSource).toHaveBeenCalledWith('printed:set-9');
});

it('shows the selected printed format in the native select', () => {
  const printed = printedSources(9);
  render(h(SourceChoice, { sources: printed, selected: 'printed:set-9', onSource: () => undefined }));
  const picker = screen.getByRole('combobox', { name: 'Magic printed formats' });
  expect((picker as unknown as { readonly value: string }).value).toBe('printed:set-9');
});

it('disables and explains an unavailable printed format in the native select', () => {
  const printed = [
    ...printedSources(8),
    {
      kind: 'printed' as const,
      stem: 'printed:no-draft' as const,
      name: 'Unavailable format',
      unavailableReason: 'Draft is not available for this printed format.',
    },
  ];
  render(h(SourceChoice, { sources: printed, selected: 'printed:set-1', onSource: () => undefined }));
  const option = screen.getByRole('option', { name: /Unavailable format/u });
  expect(attr(option, 'aria-disabled')).toBe('true');
  expect(attr(option, 'disabled')).not.toBeNull();
  expect(text(option)).toContain('Draft is not available for this printed format.');
});

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { PlaySource } from './sources';

export const SOURCE_CHOICE_LABEL = 'Playing with';
const GENERATED_SOURCE_LABEL = 'Generated sets';
const MAGIC_SOURCE_LABEL = 'Magic printed formats';
const CUBE_SOURCE_LABEL = 'Cube';
const MAGIC_SOURCE_PLACEHOLDER = 'Choose a Magic printed format';
const MAGIC_SOURCE_SELECT_THRESHOLD = 8;

export interface SourceChoiceProps {
  readonly sources: readonly PlaySource[];
  readonly selected: string | null;
  readonly onSource: (stem: string) => void;
}

function chip(source: PlaySource, props: SourceChoiceProps): ReactElement {
  const unavailableReason = source.kind === 'printed' ? source.unavailableReason : undefined;
  return createElement(
    'button',
    {
      key: source.stem,
      type: 'button',
      className: 'mtg-chip',
      'aria-pressed': source.stem === props.selected,
      'aria-disabled': unavailableReason === undefined ? undefined : true,
      'data-selected': source.stem === props.selected ? 'true' : undefined,
      disabled: unavailableReason !== undefined,
      onClick: (): void => {
        props.onSource(source.stem);
      },
    },
    source.name,
    unavailableReason === undefined
      ? null
      : createElement('span', { className: 'mtg-chip__note' }, unavailableReason),
  );
}

function chips(sources: readonly PlaySource[], props: SourceChoiceProps): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-chips' },
    sources.map((source) => chip(source, props)),
  );
}

function magicPicker(sources: readonly PlaySource[], props: SourceChoiceProps): ReactElement {
  const selected = sources.some((source) => source.stem === props.selected) ? props.selected : '';
  return createElement(
    'select',
    {
      className: 'mtg-select mtg-source-choice__select',
      'aria-label': MAGIC_SOURCE_LABEL,
      value: selected,
      onChange: (event: { target: { value: string } }): void => {
        props.onSource(event.target.value);
      },
    },
    createElement('option', { value: '', disabled: true }, MAGIC_SOURCE_PLACEHOLDER),
    ...sources.map((source) => {
      const unavailableReason = source.kind === 'printed' ? source.unavailableReason : undefined;
      return createElement(
        'option',
        {
          key: source.stem,
          value: source.stem,
          disabled: unavailableReason !== undefined,
          'aria-disabled': unavailableReason === undefined ? undefined : true,
        },
        unavailableReason === undefined ? source.name : `${source.name} — ${unavailableReason}`,
      );
    }),
  );
}

function sourceGroup(label: string, control: ReactElement): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-source-choice__group', role: 'group', 'aria-label': label },
    createElement('h3', { className: 'mtg-source-choice__title' }, label),
    control,
  );
}

export function SourceChoice(props: SourceChoiceProps): ReactElement | null {
  if (
    props.sources.length < 2 &&
    !props.sources.some((source) => source.kind === 'printed' && source.unavailableReason !== undefined)
  )
    return null;
  const generated = props.sources.filter((source) => source.kind === 'kernel');
  const magic = props.sources.filter((source) => source.kind === 'printed');
  const cube = props.sources.filter((source) => source.kind === 'cube');
  const magicControl =
    magic.length > MAGIC_SOURCE_SELECT_THRESHOLD ? magicPicker(magic, props) : chips(magic, props);
  return createElement(
    'div',
    { className: 'mtg-group' },
    createElement('h2', { className: 'mtg-group__title' }, SOURCE_CHOICE_LABEL),
    createElement(
      'div',
      { className: 'mtg-source-choice', role: 'group', 'aria-label': SOURCE_CHOICE_LABEL },
      generated.length === 0 ? null : sourceGroup(GENERATED_SOURCE_LABEL, chips(generated, props)),
      magic.length === 0 ? null : sourceGroup(MAGIC_SOURCE_LABEL, magicControl),
      cube.length === 0 ? null : sourceGroup(CUBE_SOURCE_LABEL, chips(cube, props)),
    ),
  );
}

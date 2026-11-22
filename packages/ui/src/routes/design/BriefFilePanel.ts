/**
 * The brief as a file: on screen at all times, saved as a convenience, and
 * opened back into the editor.
 *
 * `mtg-yddw.2`. `../deck/DeckFilePanel.ts` made this argument first and it is
 * the same one: a page-initiated download reports nothing. The built app is
 * opened from `file://` as often as from a server, and a browser is entitled to
 * drop a download from that origin without a word. So the box holding the whole
 * brief is the route out of this page, *Save this to a file* is laid over it,
 * and the sentence after a press says the browser was asked rather than saying
 * the file was written.
 *
 * The box is read-only, which is where this parts company with the deck panel.
 * A deck file is a list a person edits by hand; this JSON is *derived from the
 * form above it* on every keystroke, so an edit made here would be overwritten
 * by the next one made there. Opening a file is the way text comes back in, and
 * it goes through the same reader the stored draft goes through.
 */
import { createElement, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { pickedFile, saveTextFile } from '../deck/browser-file';
import { panel } from './fields';

export const FILE_TITLE = 'The brief as a file';

const FILE_EXPLAIN =
  'This is the whole brief, exactly as the generator reads it. Save it and pass it to the command line with --brief, or open one here and edit it in the form above.';

export const BRIEF_TEXT_LABEL = 'Brief JSON';

export const SAVE_BRIEF_LABEL = 'Save this to a file';

export const OPEN_BRIEF_LABEL = 'Open a brief file';

export const DOWNLOAD_ASKED_NOTE =
  'Asked the browser for a file. A browser can refuse a download from a page opened off the disk and say nothing about it, so if no file appeared, the box above is the whole brief: select it and copy it.';

export const DOWNLOAD_REFUSED_NOTE =
  'This browser offers no file downloads at all. The box above is the whole brief: select it and copy it.';

export interface BriefFilePanelProps {
  /** The brief JSON, derived from the draft by the route rather than from here. */
  readonly json: string;
  readonly fileName: string;
  /** Hands opened text up; the route decides whether it reads as a brief. */
  readonly onOpen: (text: string, name: string) => void;
}

export function BriefFilePanel(props: BriefFilePanelProps): ReactElement {
  const { json, fileName, onOpen } = props;
  const [message, setMessage] = useState<string | null>(null);

  const save = useCallback((): void => {
    setMessage(saveTextFile(fileName, json) ? DOWNLOAD_ASKED_NOTE : DOWNLOAD_REFUSED_NOTE);
  }, [fileName, json]);

  const open = useCallback(
    (files: unknown): void => {
      const file = pickedFile(files);
      if (file === null) return;
      file.text().then(
        (text: string): void => {
          setMessage(null);
          onOpen(text, file.name);
        },
        (): void => {
          setMessage(`This browser could not read “${file.name}”. Open it in a text editor and paste it in.`);
        },
      );
    },
    [onOpen],
  );

  return panel(
    FILE_TITLE,
    FILE_EXPLAIN,
    createElement('label', { className: 'mtg-fact__label', htmlFor: 'mtg-design-json' }, BRIEF_TEXT_LABEL),
    createElement('textarea', {
      id: 'mtg-design-json',
      className: 'mtg-decklist',
      rows: 14,
      readOnly: true,
      spellCheck: false,
      value: json,
      // Focusing selects all of it, because the reason somebody puts a cursor in
      // a box they cannot type into is to copy what is in it.
      onFocus: (event: { readonly target: { readonly select?: () => void } }): void => {
        event.target.select?.();
      },
    }),
    createElement(
      'div',
      { className: 'mtg-toolbar', role: 'group', 'aria-label': FILE_TITLE },
      createElement('button', { type: 'button', className: 'mtg-btn', onClick: save }, SAVE_BRIEF_LABEL),
      createElement('label', { className: 'mtg-fact__label', htmlFor: 'mtg-design-file' }, OPEN_BRIEF_LABEL),
      createElement('input', {
        id: 'mtg-design-file',
        type: 'file',
        accept: '.json,application/json',
        className: 'mtg-input',
        onChange: (event: { readonly target: { readonly files?: unknown } }): void => {
          open(event.target.files);
        },
      }),
    ),
    message === null ? null : createElement('p', { className: 'mtg-design__hint' }, message),
  );
}

/**
 * The floating Report button and the panel it opens.
 *
 * `mtg-fvuyq.2`. Mounted by `App` above every route while the helper is on
 * (`toggle.ts`), so a report can be written over the exact screen it is about:
 * the panel never navigates. What it collects is the reporter's sentences (what
 * is wrong, what should happen, how urgent, whether it is a design question),
 * a screenshot by paste (`paste.ts` says why paste), the element they pointed
 * at (`point.ts`), and what the page states about itself (`gather.ts`), and
 * it hands the whole to `/feedback-api` (`client.ts`), which writes the report
 * and files the GitHub issue. The answer is drawn in the panel: the issue URL and the
 * directory, or the server's reason.
 *
 * # Pointing
 *
 * "Point at it" arms one capture-phase click on the document. The click is
 * swallowed — it must not also play the card it landed on — and described, and
 * the panel reopens with the description. Escape disarms. The document is
 * reached the way `../routes/play/dismiss.ts` reaches it.
 */
import { createElement, Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { httpFeedbackClient } from './client';
import type { FeedbackClient, FeedbackDrafted, FeedbackFiled, FeedbackStatusRead } from './client';
import { browserHost, gatherFeedbackContext } from './gather';
import type { FeedbackHost } from './gather';
import { pastedImageFile, readPastedImage } from './paste';
import type { PasteEventLike } from './paste';
import { describeElement, isElementLike } from './point';
import type { BeadDraft, FeedbackPriority, FeedbackReport, PastedImage, PointedElement } from './wire';
import { FEEDBACK_PRIORITIES } from './wire';

export const REPORT_BUTTON_LABEL = 'Report a UI/UX issue';
export const POINTING_HINT = 'Click the thing you mean. Esc cancels.';
export const PASTE_HINT = 'Paste a screenshot here (Cmd+V). CleanShot, then paste.';

interface PointingEvent {
  readonly target?: unknown;
  readonly key?: string;
  preventDefault(): void;
  stopPropagation(): void;
}

interface PointingHost {
  addEventListener(
    type: 'click' | 'keydown',
    handler: (event: PointingEvent) => void,
    capture: boolean,
  ): void;
  removeEventListener(
    type: 'click' | 'keydown',
    handler: (event: PointingEvent) => void,
    capture: boolean,
  ): void;
}

function pointingHost(): PointingHost | null {
  const host = globalThis as { readonly document?: unknown };
  const document = host.document;
  if (typeof document !== 'object' || document === null) return null;
  const partial = document as Partial<PointingHost>;
  if (typeof partial.addEventListener !== 'function' || typeof partial.removeEventListener !== 'function') {
    return null;
  }
  return document as PointingHost;
}

/** Arms one click while `active`; the description arrives through `onPoint`. */
function usePointing(active: boolean, onPoint: (element: PointedElement | null) => void): void {
  const latest = useRef(onPoint);
  latest.current = onPoint;
  useEffect(() => {
    if (!active) return undefined;
    const host = pointingHost();
    if (host === null) {
      latest.current(null);
      return undefined;
    }
    const onClick = (event: PointingEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      latest.current(isElementLike(event.target) ? describeElement(event.target) : null);
    };
    const onKey = (event: PointingEvent): void => {
      if (event.key === 'Escape') latest.current(null);
    };
    host.addEventListener('click', onClick, true);
    host.addEventListener('keydown', onKey, true);
    return (): void => {
      host.removeEventListener('click', onClick, true);
      host.removeEventListener('keydown', onKey, true);
    };
  }, [active]);
}

export interface FeedbackOverlayProps {
  /** Injectable for tests; the page uses the `/feedback-api` client. */
  readonly client?: FeedbackClient;
  readonly host?: () => FeedbackHost | null;
  readonly now?: () => Date;
}

interface Draft {
  readonly title: string;
  readonly description: string;
  readonly desired: string;
  readonly priority: FeedbackPriority;
  readonly designQuestion: boolean;
}

const EMPTY_DRAFT: Draft = { title: '', description: '', desired: '', priority: 'P2', designQuestion: false };

function field(
  label: string,
  name: string,
  value: string,
  onChange: (value: string) => void,
  multiline: boolean,
): ReactElement {
  const id = `mtg-feedback-${name}`;
  return createElement(
    'label',
    { className: 'mtg-feedback__field', htmlFor: id },
    createElement('span', { className: 'mtg-feedback__label' }, label),
    createElement(multiline ? 'textarea' : 'input', {
      id,
      name,
      className: 'mtg-input mtg-feedback__input',
      value,
      rows: multiline ? 3 : undefined,
      onChange: (event: { target: { value: string } }): void => {
        onChange(event.target.value);
      },
    }),
  );
}

function describeOutcome(outcome: FeedbackFiled): string {
  if (outcome.status === 'refused') return `Not filed: ${outcome.reason}`;
  const where = `Written to ${outcome.directory}.`;
  return outcome.issue === null
    ? `${where} ${outcome.note}`
    : `Filed as ${outcome.issue}. ${where} ${outcome.note}`;
}

function draftView(
  drafted: FeedbackDrafted,
  answer: string,
  onAnswer: (value: string) => void,
): ReactElement {
  if (drafted.status === 'refused') {
    return createElement(
      'p',
      { className: 'mtg-feedback__draft', role: 'status' },
      `No draft: ${drafted.reason}`,
    );
  }
  const { draft } = drafted;
  return createElement(
    'div',
    { className: 'mtg-feedback__draft', role: 'status' },
    createElement('h3', { className: 'mtg-feedback__label' }, `Drafted issue: ${draft.title}`),
    createElement('p', null, draft.description),
    createElement('ul', null, ...draft.acceptance.map((line) => createElement('li', { key: line }, line))),
    draft.question === null ? null : field(draft.question, 'answer', answer, onAnswer, true),
  );
}

function describeStatus(status: FeedbackStatusRead | null): string {
  if (status === null) return 'Asking the lab what it files…';
  if (!status.ok) return status.reason;
  const filing = status.status.issues
    ? 'files a GitHub issue'
    : 'writes a report (gh cannot file from here, so no issue)';
  const model = status.status.model ? ', with a model drafting the fix' : '';
  return `This lab ${filing}${model}. Showing ${status.status.staged}.`;
}

export function FeedbackOverlay(props: FeedbackOverlayProps): ReactElement {
  const clientRef = useRef<FeedbackClient | null>(null);
  clientRef.current ??= props.client ?? httpFeedbackClient();
  const [open, setOpen] = useState(false);
  const [pointing, setPointing] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [element, setElement] = useState<PointedElement | null>(null);
  const [image, setImage] = useState<PastedImage | null>(null);
  const [status, setStatus] = useState<FeedbackStatusRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<FeedbackFiled | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [drafted, setDrafted] = useState<FeedbackDrafted | null>(null);
  const [answer, setAnswer] = useState('');

  useEffect(() => {
    if (!open || status !== null) return undefined;
    let live = true;
    void clientRef.current?.status().then((read) => {
      if (live) setStatus(read);
    });
    return (): void => {
      live = false;
    };
  }, [open, status]);

  usePointing(pointing, (pointed) => {
    setPointing(false);
    setOpen(true);
    if (pointed !== null) setElement(pointed);
  });

  const onPaste = useCallback((event: PasteEventLike): void => {
    const file = pastedImageFile(event);
    if (file === null) return;
    event.preventDefault();
    void readPastedImage(file).then(setImage);
  }, []);

  const compose = useCallback(
    (kept: BeadDraft | null): FeedbackReport => {
      const host = (props.host ?? browserHost)();
      const now = (props.now ?? ((): Date => new Date()))();
      return {
        ...draft,
        title: draft.title.trim() === '' ? draft.description.trim().slice(0, 80) : draft.title.trim(),
        element,
        image,
        context: gatherFeedbackContext({ host, now }),
        ...(kept === null ? {} : { draft: { ...kept, answer: answer.trim() } }),
      };
    },
    [answer, draft, element, image, props.host, props.now],
  );

  const runDraft = useCallback((): void => {
    const client = clientRef.current;
    if (client === null || drafting) return;
    setDrafting(true);
    setAnswer('');
    void client.draft(compose(null)).then((result) => {
      setDrafting(false);
      setDrafted(result);
    });
  }, [compose, drafting]);

  const submit = useCallback((): void => {
    const client = clientRef.current;
    if (client === null || busy) return;
    const report = compose(drafted?.status === 'drafted' ? drafted.draft : null);
    setBusy(true);
    void client.file(report).then((filed) => {
      setBusy(false);
      setOutcome(filed);
      if (filed.status === 'filed') {
        setDraft(EMPTY_DRAFT);
        setElement(null);
        setImage(null);
        setDrafted(null);
        setAnswer('');
      }
    });
  }, [busy, compose, drafted]);

  const update = (patch: Partial<Draft>): void => {
    setDraft((previous) => ({ ...previous, ...patch }));
    // A model draft describes the report it read; an edited report is a different one.
    setDrafted(null);
    setAnswer('');
  };

  if (pointing) {
    return createElement(
      'div',
      { className: 'mtg-feedback mtg-feedback--pointing', role: 'status' },
      POINTING_HINT,
    );
  }

  const button = createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn mtg-feedback__open',
      'data-variant': open ? undefined : 'primary',
      'aria-expanded': open ? 'true' : 'false',
      'aria-label': REPORT_BUTTON_LABEL,
      onClick: (): void => {
        setOpen((was) => !was);
      },
    },
    open ? 'Close' : 'Report',
  );

  if (!open) return createElement('div', { className: 'mtg-feedback' }, button);

  const modelArmed = status !== null && status.ok && status.status.model;
  const canSubmit = draft.description.trim() !== '' && !busy;
  const panel = createElement(
    'section',
    { className: 'mtg-feedback__panel', 'aria-label': REPORT_BUTTON_LABEL, onPaste },
    createElement('h2', { className: 'mtg-feedback__heading' }, 'Report a UI/UX issue'),
    createElement('p', { className: 'mtg-feedback__status' }, describeStatus(status)),
    createElement(
      'div',
      { className: 'mtg-feedback__paste', tabIndex: 0 },
      image === null
        ? PASTE_HINT
        : createElement('img', {
            className: 'mtg-feedback__shot',
            alt: 'The pasted screenshot',
            src: `data:${image.mime};base64,${image.base64}`,
          }),
    ),
    createElement(
      'div',
      { className: 'mtg-feedback__row' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          onClick: (): void => {
            setOpen(false);
            setPointing(true);
          },
        },
        'Point at it',
      ),
      createElement(
        'span',
        { className: 'mtg-feedback__pointed' },
        element === null ? 'Nothing pointed at yet.' : `Pointing at ${element.path}`,
      ),
    ),
    field('Title', 'title', draft.title, (title) => update({ title }), false),
    field('What is wrong', 'description', draft.description, (description) => update({ description }), true),
    field('What should happen', 'desired', draft.desired, (desired) => update({ desired }), true),
    createElement(
      'div',
      { className: 'mtg-feedback__row' },
      createElement(
        'label',
        { className: 'mtg-feedback__inline', htmlFor: 'mtg-feedback-priority' },
        'Priority',
        createElement(
          'select',
          {
            id: 'mtg-feedback-priority',
            className: 'mtg-input',
            value: draft.priority,
            onChange: (event: { target: { value: string } }): void => {
              const chosen = FEEDBACK_PRIORITIES.find((one) => one === event.target.value);
              if (chosen !== undefined) update({ priority: chosen });
            },
          },
          ...FEEDBACK_PRIORITIES.map((one) => createElement('option', { key: one, value: one }, one)),
        ),
      ),
      createElement(
        'label',
        { className: 'mtg-feedback__inline' },
        createElement('input', {
          type: 'checkbox',
          checked: draft.designQuestion,
          onChange: (event: { target: { checked: boolean } }): void => {
            update({ designQuestion: event.target.checked });
          },
        }),
        'Design question (needs the playtester)',
      ),
    ),
    modelArmed
      ? createElement(
          'div',
          { className: 'mtg-feedback__row' },
          createElement(
            'button',
            {
              type: 'button',
              className: 'mtg-btn',
              disabled: draft.description.trim() === '' || drafting,
              onClick: runDraft,
            },
            drafting ? 'Drafting…' : drafted === null ? 'Draft the issue' : 'Draft again',
          ),
        )
      : null,
    drafted === null ? null : draftView(drafted, answer, setAnswer),
    createElement(
      'div',
      { className: 'mtg-feedback__row' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          'data-variant': 'primary',
          disabled: !canSubmit,
          onClick: submit,
        },
        busy ? 'Filing…' : 'File it',
      ),
    ),
    outcome === null
      ? null
      : createElement('p', { className: 'mtg-feedback__outcome', role: 'status' }, describeOutcome(outcome)),
  );

  return createElement(
    'div',
    { className: 'mtg-feedback mtg-feedback--open' },
    createElement(Fragment, null, button, panel),
  );
}

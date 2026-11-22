// @vitest-environment jsdom
/**
 * The helper in the shell: off draws nothing but the switch, on draws the
 * Report button over the route, and the panel files what was typed, pasted
 * and pointed at through the client it was given.
 */
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/app/App';
import type { UiViews } from '../../src/app/App';
import { hashSource } from '../../src/app/router';
import {
  FeedbackOverlay,
  PASTE_HINT,
  POINTING_HINT,
  REPORT_BUTTON_LABEL,
} from '../../src/feedback/FeedbackOverlay';
import { FEEDBACK_TOGGLE_LABEL } from '../../src/feedback/FeedbackToggle';
import type { FeedbackClient } from '../../src/feedback/client';
import { FEEDBACK_ENABLED_KEY } from '../../src/feedback/toggle';
import type { BeadDraft, FeedbackReport } from '../../src/feedback/wire';

interface StoreLike {
  clear(): void;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** jsdom's globals, structurally: the workspace tsconfig has no `lib: dom`. */
function store(): StoreLike {
  const found = (globalThis as { readonly localStorage?: StoreLike }).localStorage;
  if (found === undefined) throw new Error('this test needs a jsdom localStorage');
  return found;
}

/** An element's attributes, structurally, for the same reason. */
function attribute(node: unknown, name: string): string | null {
  return (node as { getAttribute(name: string): string | null }).getAttribute(name);
}

function doc(): object {
  const found = (globalThis as { readonly document?: object }).document;
  if (found === undefined) throw new Error('this test needs a jsdom document');
  return found;
}

const VIEWS: UiViews = {
  play: () => h('button', { className: 'mtg-btn', id: 'pass' }, 'Pass'),
  customize: () => h('p', null, 'customize'),
  cards: () => h('p', null, 'cards'),
  analysis: () => h('p', null, 'analysis'),
};

const DRAFT: BeadDraft = {
  title: 'Keep End turn above the log at every width',
  description: 'Pin the End turn button above the log.',
  acceptance: ['End turn is visible at 390x844'],
  question: 'Does this apply to the phone layout only?',
};

function fakeClient(filed: FeedbackReport[], model = false): FeedbackClient {
  return {
    status: () => Promise.resolve({ ok: true, status: { staged: 'the flagship set', issues: true, model } }),
    draft: () => Promise.resolve({ status: 'drafted', draft: DRAFT }),
    file: (report) => {
      filed.push(report);
      return Promise.resolve({
        status: 'filed',
        issue: 'https://github.com/o/r/issues/9',
        directory: 'data/feedback/20260916-101530-abcd',
        note: 'untriaged',
      });
    },
  };
}

beforeEach(() => {
  const source = hashSource();
  if (source === null) throw new Error('this test needs a browser location');
  source.location.hash = '#/play';
});

afterEach(() => {
  cleanup();
  store().clear();
});

describe('the feedback switch in the shell', () => {
  it('draws only the switch while off, and the Report button once on', () => {
    render(h(App, { views: VIEWS, withStyles: false }));
    expect(screen.queryByLabelText(REPORT_BUTTON_LABEL)).toBeNull();
    const toggle = screen.getByLabelText(FEEDBACK_TOGGLE_LABEL);
    expect(attribute(toggle, 'aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(attribute(toggle, 'aria-pressed')).toBe('true');
    expect(store().getItem(FEEDBACK_ENABLED_KEY)).toBe('on');
    expect(screen.getByLabelText(REPORT_BUTTON_LABEL)).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByLabelText(REPORT_BUTTON_LABEL)).toBeNull();
  });

  it('starts on when the store says so, and draws nothing when the host turned it off', () => {
    store().setItem(FEEDBACK_ENABLED_KEY, 'on');
    const { unmount } = render(h(App, { views: VIEWS, withStyles: false }));
    expect(screen.getByLabelText(REPORT_BUTTON_LABEL)).toBeTruthy();
    unmount();
    render(h(App, { views: VIEWS, withStyles: false, withFeedback: false }));
    expect(screen.queryByLabelText(FEEDBACK_TOGGLE_LABEL)).toBeNull();
    expect(screen.queryByLabelText(REPORT_BUTTON_LABEL)).toBeNull();
  });
});

describe('the report panel', () => {
  const host = () => ({
    location: { hash: '#/play', href: 'http://127.0.0.1:5273/#/play' },
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 2,
    navigator: { userAgent: 'jsdom' },
    document: { title: 'MTG Lab' },
  });
  const now = () => new Date('2026-09-16T10:15:30.000Z');

  it('draws no draft button unless the lab armed a model round', async () => {
    render(h(FeedbackOverlay, { client: fakeClient([]), host, now }));
    fireEvent.click(screen.getByLabelText(REPORT_BUTTON_LABEL));
    await waitFor(() => {
      expect(screen.getByText(/This lab files a GitHub issue/)).toBeTruthy();
    });
    expect(screen.queryByText('Draft the issue')).toBeNull();
  });

  it('shows the drafted issue and its one question, and files the answer with it', async () => {
    const filed: FeedbackReport[] = [];
    render(h(FeedbackOverlay, { client: fakeClient(filed, true), host, now }));
    fireEvent.click(screen.getByLabelText(REPORT_BUTTON_LABEL));
    await waitFor(() => {
      expect(screen.getByText(/with a model drafting the fix/)).toBeTruthy();
    });
    expect(attribute(screen.getByText('Draft the issue'), 'disabled')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('What is wrong'), { target: { value: 'End turn hides' } });
    fireEvent.click(screen.getByText('Draft the issue'));
    await waitFor(() => {
      expect(screen.getByText(`Drafted issue: ${DRAFT.title}`)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText(DRAFT.question ?? ''), { target: { value: 'Phone only.' } });
    fireEvent.click(screen.getByText('File it'));
    await waitFor(() => {
      expect(filed).toHaveLength(1);
    });
    expect(filed[0]?.draft).toEqual({ ...DRAFT, answer: 'Phone only.' });
  });

  it('drops a drafted issue when the report is edited after it', async () => {
    const filed: FeedbackReport[] = [];
    render(h(FeedbackOverlay, { client: fakeClient(filed, true), host, now }));
    fireEvent.click(screen.getByLabelText(REPORT_BUTTON_LABEL));
    await waitFor(() => {
      expect(screen.getByText(/with a model drafting the fix/)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText('What is wrong'), { target: { value: 'End turn hides' } });
    fireEvent.click(screen.getByText('Draft the issue'));
    await waitFor(() => {
      expect(screen.getByText(`Drafted issue: ${DRAFT.title}`)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText('What is wrong'), {
      target: { value: 'End turn hides on phone' },
    });
    expect(screen.queryByText(`Drafted issue: ${DRAFT.title}`)).toBeNull();
    fireEvent.click(screen.getByText('File it'));
    await waitFor(() => {
      expect(filed).toHaveLength(1);
    });
    expect(filed[0]?.draft).toBeUndefined();
  });

  it('files the typed report with the gathered context and says where it went', async () => {
    const filed: FeedbackReport[] = [];
    render(h(FeedbackOverlay, { client: fakeClient(filed), host, now }));
    fireEvent.click(screen.getByLabelText(REPORT_BUTTON_LABEL));
    await waitFor(() => {
      expect(screen.getByText(/This lab files a GitHub issue/)).toBeTruthy();
    });
    expect(screen.getByText(PASTE_HINT)).toBeTruthy();
    const file = screen.getByText('File it');
    expect(attribute(file, 'disabled')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('What is wrong'), {
      target: { value: 'The pass button hides behind the log' },
    });
    fireEvent.change(screen.getByLabelText('What should happen'), { target: { value: 'It stays visible' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'P1' } });
    fireEvent.click(screen.getByLabelText('Design question (needs the playtester)'));
    expect(attribute(file, 'disabled')).toBeNull();
    fireEvent.click(file);
    await waitFor(() => {
      expect(screen.getByText(/Filed as https:\/\/github.com\/o\/r\/issues\/9/)).toBeTruthy();
    });
    expect(filed).toHaveLength(1);
    const report = filed[0];
    if (report === undefined) throw new Error('nothing filed');
    expect(report.title).toBe('The pass button hides behind the log');
    expect(report.priority).toBe('P1');
    expect(report.designQuestion).toBe(true);
    expect(report.desired).toBe('It stays visible');
    expect(report.context.hash).toBe('#/play');
    expect(report.context.viewport).toEqual({ width: 1280, height: 800, devicePixelRatio: 2 });
    expect(report.context.capturedAt).toBe('2026-09-16T10:15:30.000Z');
    expect(report.element).toBeNull();
    expect(report.image).toBeNull();
  });

  it('takes a pasted image and sends it', async () => {
    const filed: FeedbackReport[] = [];
    render(h(FeedbackOverlay, { client: fakeClient(filed), host, now }));
    fireEvent.click(screen.getByLabelText(REPORT_BUTTON_LABEL));
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const file = { type: 'image/png', arrayBuffer: () => Promise.resolve(bytes.buffer) };
    const paste = screen.getByText(PASTE_HINT);
    fireEvent.paste(paste, {
      clipboardData: {
        items: [
          { kind: 'string', type: 'text/plain', getAsFile: () => null },
          { kind: 'file', type: 'image/png', getAsFile: () => file },
        ],
      },
    });
    await waitFor(() => {
      expect(screen.getByAltText('The pasted screenshot')).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText('What is wrong'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('File it'));
    await waitFor(() => {
      expect(filed).toHaveLength(1);
    });
    expect(filed[0]?.image).toEqual({ mime: 'image/png', base64: 'iVBORw==' });
  });

  it('points at the next clicked element without letting the click through', async () => {
    const filed: FeedbackReport[] = [];
    let passed = 0;
    render(
      h(
        'div',
        null,
        h(
          'button',
          {
            id: 'pass',
            className: 'mtg-btn',
            onClick: () => {
              passed += 1;
            },
          },
          'Pass',
        ),
        h(FeedbackOverlay, { client: fakeClient(filed), host, now }),
      ),
    );
    fireEvent.click(screen.getByLabelText(REPORT_BUTTON_LABEL));
    fireEvent.click(screen.getByText('Point at it'));
    expect(screen.getByText(POINTING_HINT)).toBeTruthy();
    fireEvent.click(screen.getByText('Pass'));
    expect(passed).toBe(0);
    await waitFor(() => {
      expect(screen.getByText(/Pointing at .*button#pass/)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText('What is wrong'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('File it'));
    await waitFor(() => {
      expect(filed).toHaveLength(1);
    });
    expect(filed[0]?.element?.text).toBe('Pass');
    expect(filed[0]?.element?.surface).toBe('mtg-btn');
  });

  it('cancels pointing on Escape', () => {
    render(h(FeedbackOverlay, { client: fakeClient([]), host, now }));
    fireEvent.click(screen.getByLabelText(REPORT_BUTTON_LABEL));
    fireEvent.click(screen.getByText('Point at it'));
    fireEvent.keyDown(doc() as Parameters<typeof fireEvent.keyDown>[0], { key: 'Escape' });
    expect(screen.queryByText(POINTING_HINT)).toBeNull();
    expect(screen.getByText('Nothing pointed at yet.')).toBeTruthy();
  });

  it('repeats a refusal in the panel', async () => {
    const client: FeedbackClient = {
      status: () =>
        Promise.resolve({
          ok: false,
          reason: 'this lab files no feedback: start it with npm run play or npm run lab',
        }),
      draft: () => Promise.resolve({ status: 'refused', reason: 'unused' }),
      file: () =>
        Promise.resolve({ status: 'refused', reason: 'the lab could not be reached (ECONNREFUSED)' }),
    };
    render(h(FeedbackOverlay, { client, host, now }));
    fireEvent.click(screen.getByLabelText(REPORT_BUTTON_LABEL));
    await waitFor(() => {
      expect(screen.getByText(/files no feedback/)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText('What is wrong'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('File it'));
    await waitFor(() => {
      expect(screen.getByText(/Not filed: the lab could not be reached/)).toBeTruthy();
    });
  });
});

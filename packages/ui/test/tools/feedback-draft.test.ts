/**
 * The optional model round (`mtg-fvuyq.6`): a fixture provider drafts the bead,
 * the server serves it only when armed, and the kept draft becomes the bead.
 *
 * The fixture is recorded here, through `@mtg/llm`'s own record path with a
 * stub live transport, so the key the replay looks up is the one the drafter's
 * request really hashes to and nothing is hand-copied.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixtureProvider, FixtureMissingError } from '@mtg/llm';
import type { LlmTransport } from '@mtg/llm';
import type { BeadDraft, FeedbackReport } from '../../src/feedback/wire';
import { draftPrompt, modelDrafter } from '../../tools/feedback/draft';
import { acceptanceOf, issueArgs, issueTitle, renderReportMarkdown } from '../../tools/feedback/report';
import { startFeedbackServer } from '../../tools/feedback/server';
import type { FeedbackServer } from '../../tools/feedback/server';

const REPORT: FeedbackReport = {
  title: 'End turn hides',
  description: 'On a phone the End turn button is under the log.',
  desired: 'The button stays above the log.',
  priority: 'P2',
  designQuestion: false,
  element: null,
  image: null,
  context: {
    capturedAt: '2026-09-16T10:15:30.000Z',
    hash: '#/play/sealed',
    href: 'http://127.0.0.1:5273/#/play/sealed',
    title: 'MTG Lab',
    viewport: { width: 390, height: 844, devicePixelRatio: 3 },
    userAgent: 'Safari/17',
    preferences: {},
    subject: null,
  },
};

const DRAFT: BeadDraft = {
  title: 'Keep End turn above the log at every width',
  description: 'Position the End turn button above the log so it is never covered.',
  acceptance: ['End turn is fully visible at 390x844', 'The log still scrolls'],
  question: 'Should the log shrink or scroll?',
};

const LIVE: LlmTransport = {
  name: 'claude-cli',
  model: 'stub',
  send: () =>
    Promise.resolve({
      text: JSON.stringify(DRAFT),
      structured: DRAFT,
      usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      costUsd: 0,
      costSource: 'reported',
      costCheck: {
        reportedUsd: 0,
        pricedUsd: null,
        usageMeasured: true,
        agreement: 'unchecked',
        detail: 'stub',
      },
      model: 'stub',
    }),
};

describe('the model round', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mtg-feedback-draft-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('replays a recorded draft for the same report and refuses one it never recorded', async () => {
    const recording = createFixtureProvider({ dir, env: {}, record: true, delegate: LIVE });
    expect(await modelDrafter(recording)(REPORT)).toEqual(DRAFT);

    const replay = createFixtureProvider({ dir, env: {}, record: false });
    expect(await modelDrafter(replay)(REPORT)).toEqual(DRAFT);
    await expect(modelDrafter(replay)({ ...REPORT, description: 'something else' })).rejects.toBeInstanceOf(
      FixtureMissingError,
    );
  });

  it('frames the report for the model without the screenshot', () => {
    const prompt = draftPrompt({ ...REPORT, image: { mime: 'image/png', base64: 'AAAA' } });
    expect(prompt).toContain('On a phone the End turn button is under the log.');
    expect(prompt).toContain('#/play/sealed');
    expect(prompt).not.toContain('AAAA');
  });

  describe('over the server', () => {
    let server: FeedbackServer | null = null;
    afterEach(async () => {
      await server?.close();
      server = null;
    });

    const start = (drafter?: (report: FeedbackReport) => Promise<BeadDraft>): Promise<FeedbackServer> =>
      startFeedbackServer({
        port: 0,
        root: join(dir, 'feedback'),
        repoRoot: dir,
        staged: 'a set',
        repo: null,
        commit: 'abc',
        ...(drafter === undefined ? {} : { drafter }),
      });
    const post = (port: number): Promise<Response> =>
      fetch(`http://127.0.0.1:${String(port)}/feedback-api/draft`, {
        method: 'POST',
        body: JSON.stringify(REPORT),
      });

    it('is a 404 and a status of model:false when no round is armed', async () => {
      server = await start();
      expect((await post(server.port)).status).toBe(404);
      const status = await fetch(`http://127.0.0.1:${String(server.port)}/feedback-api/status`);
      expect(await status.json()).toMatchObject({ model: false });
    });

    it('serves the draft and reports model:true when armed', async () => {
      server = await start(() => Promise.resolve(DRAFT));
      const response = await post(server.port);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ draft: DRAFT });
      const status = await fetch(`http://127.0.0.1:${String(server.port)}/feedback-api/status`);
      expect(await status.json()).toMatchObject({ model: true });
    });

    it('answers a failed round with its reason and leaves filing available', async () => {
      server = await start(() => Promise.reject(new Error('budget spent')));
      const response = await post(server.port);
      expect(response.status).toBe(502);
      expect(((await response.json()) as { message: string }).message).toContain('budget spent');
    });

    it('refuses a body that is not a report', async () => {
      server = await start(() => Promise.resolve(DRAFT));
      const response = await fetch(`http://127.0.0.1:${String(server.port)}/feedback-api/draft`, {
        method: 'POST',
        body: '{"title":""}',
      });
      expect(response.status).toBe(400);
    });
  });

  it("files the kept draft: its title, its acceptance, and the reporter's answer in the body", () => {
    const kept: FeedbackReport = { ...REPORT, draft: { ...DRAFT, answer: 'Scroll.' } };
    expect(issueTitle(kept)).toBe(DRAFT.title);
    expect(issueTitle(REPORT)).toBe(REPORT.title);
    expect(acceptanceOf(kept)).toBe(DRAFT.acceptance.join('\n'));
    const markdown = renderReportMarkdown(kept, { staged: 'a set', commit: 'abc' }, 'data/feedback/x', null);
    expect(markdown).toContain('## Drafted fix (model)');
    expect(markdown).toContain('Question the model asked: Should the log shrink or scroll?');
    expect(markdown).toContain('Answer: Scroll.');
    expect(markdown).toContain('- The log still scrolls');
    const args = issueArgs(
      kept,
      {
        directory: '/x',
        relative: 'x',
        markdownPath: '/x/report.md',
        imageFile: null,
      },
      'o/r',
    );
    expect(args[args.indexOf('--title') + 1]).toBe(DRAFT.title);
    expect(renderReportMarkdown(REPORT, { staged: 'a set', commit: 'abc' }, 'x', null)).not.toContain(
      'Drafted fix',
    );
  });
});

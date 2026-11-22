/**
 * The page's `/feedback-api` client: never throws, names a lab that files
 * nothing, and repeats the server's own sentence on refusal.
 */
import { describe, expect, it } from 'vitest';
import { NOT_FILING, httpFeedbackClient } from '../../src/feedback/client';
import type { FeedbackReport } from '../../src/feedback/wire';

const REPORT: FeedbackReport = {
  title: 'The pass button hides',
  description: 'It hides behind the log',
  desired: 'It stays visible',
  priority: 'P2',
  designQuestion: false,
  element: null,
  image: null,
  context: {
    capturedAt: '2026-09-16T10:15:30.000Z',
    hash: '#/play',
    href: 'http://127.0.0.1:5273/#/play',
    title: 'MTG Lab',
    viewport: { width: 1, height: 1, devicePixelRatio: 1 },
    userAgent: '',
    preferences: {},
    subject: null,
  },
};

function answering(status: number, body: unknown): typeof globalThis.fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    );
}

describe('httpFeedbackClient', () => {
  it('reads the status', async () => {
    const client = httpFeedbackClient(
      '/feedback-api',
      answering(200, { staged: 'XMP', issues: true, model: false }),
    );
    expect(await client.status()).toEqual({
      ok: true,
      status: { staged: 'XMP', issues: true, model: false },
    });
  });

  it('names a lab that files nothing on 404', async () => {
    const client = httpFeedbackClient('/feedback-api', answering(404, {}));
    expect(await client.status()).toEqual({ ok: false, reason: NOT_FILING });
    expect(await client.file(REPORT)).toEqual({ status: 'refused', reason: NOT_FILING });
  });

  it('names a lab that files nothing when the page is answered in place of the route', async () => {
    const client = httpFeedbackClient('/feedback-api', () =>
      Promise.resolve(
        new Response('<!doctype html><title>frozen ui</title>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      ),
    );
    expect(await client.status()).toEqual({ ok: false, reason: NOT_FILING });
    expect(await client.file(REPORT)).toEqual({ status: 'refused', reason: NOT_FILING });
  });

  it('keeps its own sentence for a server that answered JSON without a status', async () => {
    const client = httpFeedbackClient('/feedback-api', answering(200, { staged: 'XMP' }));
    expect(await client.status()).toEqual({ ok: false, reason: 'the lab answered without a status' });
  });

  it('posts the report and reads back the issue and the directory', async () => {
    const calls: { url: string; body: string }[] = [];
    const client = httpFeedbackClient('/feedback-api', (input, init) => {
      calls.push({ url: String(input), body: String(init?.body) });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            issue: 'https://github.com/o/r/issues/7',
            directory: 'data/feedback/x',
            note: 'n',
          }),
          {
            status: 200,
          },
        ),
      );
    });
    expect(await client.file(REPORT)).toEqual({
      status: 'filed',
      issue: 'https://github.com/o/r/issues/7',
      directory: 'data/feedback/x',
      note: 'n',
    });
    expect(calls[0]?.url).toBe('/feedback-api/reports');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual(REPORT);
  });

  it('repeats the server sentence on refusal, and never throws', async () => {
    const refused = httpFeedbackClient(
      '/feedback-api',
      answering(400, { message: 'not a report: title: too short' }),
    );
    expect(await refused.file(REPORT)).toEqual({
      status: 'refused',
      reason: 'not a report: title: too short',
    });
    const down = httpFeedbackClient('/feedback-api', () => Promise.reject(new Error('ECONNREFUSED')));
    const outcome = await down.file(REPORT);
    expect(outcome.status).toBe('refused');
    if (outcome.status === 'refused') expect(outcome.reason).toContain('ECONNREFUSED');
  });
});

describe('httpFeedbackClient.draft', () => {
  const DRAFT = {
    title: 'Keep End turn visible',
    description: 'Pin it above the log.',
    acceptance: ['Visible at 390x844'],
    question: null,
  };

  it('posts the report without its screenshot and reads the draft back', async () => {
    const bodies: string[] = [];
    const client = httpFeedbackClient('/feedback-api', (input, init) => {
      expect(String(input)).toBe('/feedback-api/draft');
      bodies.push(String(init?.body));
      return Promise.resolve(new Response(JSON.stringify({ draft: DRAFT }), { status: 200 }));
    });
    const withImage: FeedbackReport = { ...REPORT, image: { mime: 'image/png', base64: 'AAAA' } };
    expect(await client.draft(withImage)).toEqual({ status: 'drafted', draft: DRAFT });
    expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({ image: null });
  });

  it('says so on a 404, repeats a refusal, and refuses an unusable draft', async () => {
    expect(await httpFeedbackClient('/feedback-api', answering(404, {})).draft(REPORT)).toEqual({
      status: 'refused',
      reason: 'this lab has no model round armed',
    });
    expect(
      await httpFeedbackClient('/feedback-api', answering(502, { message: 'the model round failed' })).draft(
        REPORT,
      ),
    ).toEqual({ status: 'refused', reason: 'the model round failed' });
    expect(
      await httpFeedbackClient('/feedback-api', answering(200, { draft: { title: '' } })).draft(REPORT),
    ).toMatchObject({ status: 'refused' });
  });
});

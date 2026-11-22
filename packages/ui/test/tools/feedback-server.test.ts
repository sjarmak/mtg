/**
 * `/feedback-api`: the plan, the port pin, what a report becomes on disk, the
 * issue it files, and the two routes over a real socket with a fake `gh`.
 *
 * Every report is written into a temporary root, never `data/feedback/`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FeedbackReport } from '../../src/feedback/wire';
import { repoOf, retryCommand } from '../../tools/feedback/issue';
import type { IssueFiler } from '../../tools/feedback/issue';
import { DEFAULT_FEEDBACK_PORT, planFeedbackServer } from '../../tools/feedback/plan';
import {
  acceptanceOf,
  issueArgs,
  readReport,
  renderReportMarkdown,
  reportStamp,
  writeFeedbackReport,
} from '../../tools/feedback/report';
import { startFeedbackServer } from '../../tools/feedback/server';
import type { FeedbackServer } from '../../tools/feedback/server';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AT = new Date('2026-09-16T10:15:30.000Z');

const REPORT: FeedbackReport = {
  title: "The pass button hides behind the log's fold",
  description: 'On a phone the End turn button is under the log.',
  desired: 'The button stays above the log at every width.',
  priority: 'P2',
  designQuestion: false,
  element: {
    path: 'html > body > div.mtg-shell > main.mtg-shell__main > button#end-turn',
    surface: 'mtg-live',
    text: 'End turn',
    box: { x: 10.4, y: 20.6, width: 80, height: 32 },
  },
  image: { mime: 'image/png', base64: Buffer.from([137, 80, 78, 71]).toString('base64') },
  context: {
    capturedAt: '2026-09-16T10:15:30.000Z',
    hash: '#/play/sealed',
    href: 'http://192.168.1.20:5320/#/play/sealed',
    title: 'MTG Lab',
    viewport: { width: 390, height: 844, devicePixelRatio: 3 },
    userAgent: 'Safari/17',
    preferences: { 'mtg.play.foil': 'off' },
    subject: {
      kind: 'kernel-game',
      config: { setup: { seed: 'lab-7f3k' } },
      choices: [0, 1, 2],
      beat: null,
      finished: false,
    },
  },
};

const EXTRAS = { staged: 'the flagship set (out/XMP/set.json)', commit: 'c791853f' };

describe('planFeedbackServer', () => {
  it('starts one on the default port when nothing is there', () => {
    const plan = planFeedbackServer({ envPort: undefined, busy: false });
    expect(plan.kind).toBe('start');
    expect(plan.port).toBe(DEFAULT_FEEDBACK_PORT);
  });
  it("attaches to one already serving, and inherits a parent launcher's", () => {
    expect(planFeedbackServer({ envPort: undefined, busy: true })).toMatchObject({
      kind: 'attach',
      port: DEFAULT_FEEDBACK_PORT,
    });
    expect(planFeedbackServer({ envPort: '5301', busy: true })).toMatchObject({
      kind: 'inherited',
      port: 5301,
    });
  });
  it('is the port the Vite proxy defaults to', () => {
    const viteConfig = readFileSync(join(UI_ROOT, 'vite.config.ts'), 'utf8');
    expect(viteConfig).toContain(`process.env['MTG_FEEDBACK_PORT'] ?? '${String(DEFAULT_FEEDBACK_PORT)}'`);
    expect(viteConfig).toContain("'/feedback-api': {");
  });
  it('is ignored by git, both spellings', () => {
    const ignore = readFileSync(join(UI_ROOT, '..', '..', '.gitignore'), 'utf8').split('\n');
    expect(ignore).toContain('data/feedback');
    expect(ignore).toContain('data/feedback/');
  });
});

describe('readReport', () => {
  it('names the first wrong field', () => {
    expect(readReport({ ...REPORT, title: '' })).toEqual({
      ok: false,
      reason: expect.stringMatching(/^title: /) as string,
    });
    expect(readReport({ ...REPORT, priority: 'P0' })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^priority: /) as string,
    });
    expect(readReport(null)).toMatchObject({ ok: false });
    expect(readReport(REPORT)).toEqual({ ok: true, report: REPORT });
  });
});

describe('the report on disk', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mtg-feedback-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stamps by time with a suffix', () => {
    expect(reportStamp(AT, 'ab12')).toBe('20260916-101530-ab12');
    expect(reportStamp(AT)).toMatch(/^20260916-101530-[0-9a-f]{4}$/);
  });

  it('writes the directory: image, json, markdown', () => {
    const written = writeFeedbackReport({
      root,
      repoRoot: root,
      report: REPORT,
      extras: EXTRAS,
      at: AT,
      stamp: '20260916-101530-ab12',
    });
    expect(written.relative).toBe('20260916-101530-ab12');
    expect(readdirSync(written.directory).sort()).toEqual(['pasted.png', 'report.json', 'report.md']);
    expect([...readFileSync(join(written.directory, 'pasted.png'))]).toEqual([137, 80, 78, 71]);
    expect(JSON.parse(readFileSync(join(written.directory, 'report.json'), 'utf8'))).toEqual(REPORT);
    const markdown = readFileSync(written.markdownPath, 'utf8');
    expect(markdown).toBe(renderReportMarkdown(REPORT, EXTRAS, written.relative, 'pasted.png'));
    expect(() =>
      writeFeedbackReport({
        root,
        repoRoot: root,
        report: REPORT,
        extras: EXTRAS,
        at: AT,
        stamp: '20260916-101530-ab12',
      }),
    ).toThrow(/EEXIST/);
  });

  it('renders the bead body in the house shape', () => {
    const markdown = renderReportMarkdown(REPORT, EXTRAS, 'data/feedback/20260916-101530-ab12', 'pasted.png');
    expect(markdown).toContain("# The pass button hides behind the log's fold");
    expect(markdown).toContain('## What is wrong\n\nOn a phone the End turn button is under the log.');
    expect(markdown).toContain('## What should happen\n\nThe button stays above the log at every width.');
    expect(markdown).toContain('- Route: `#/play/sealed`');
    expect(markdown).toContain(
      '- Pointed at: `html > body > div.mtg-shell > main.mtg-shell__main > button#end-turn` reading "End turn" (surface mtg-live), 80x32 at 10,21',
    );
    expect(markdown).toContain('- Screenshot: `data/feedback/20260916-101530-ab12/pasted.png`');
    expect(markdown).toContain(
      '- Position: kernel game, in progress, 3 choices made, seed `lab-7f3k`; the config and choice list in report.json reopen this exact position',
    );
    expect(markdown).toContain('- Showing: the flagship set (out/XMP/set.json)');
    expect(markdown).toContain('- Viewport: 390x844 at 3x');
    expect(markdown).toContain('- Preferences: mtg.play.foil=off');
    expect(markdown).toContain('- Launcher commit: c791853f');
    expect(markdown).toContain(
      '## Acceptance\n\n- The button stays above the log at every width.\n- Verified at `#/play/sealed` in a browser, at the reported viewport.',
    );
    expect(markdown).not.toContain('design question');
  });

  it('says what it does not have', () => {
    const bare: FeedbackReport = {
      ...REPORT,
      desired: '',
      designQuestion: true,
      element: null,
      image: null,
      context: {
        ...REPORT.context,
        preferences: {},
        subject: { kind: 'observed-table', token: 'tok', revision: 12, view: {} },
      },
    };
    const markdown = renderReportMarkdown(bare, EXTRAS, 'd', null);
    expect(markdown).toContain('marked as a design question for the playtester.');
    expect(markdown).toContain('## What should happen\n\n(not stated)');
    expect(markdown).toContain('- Pointed at: nothing pointed at');
    expect(markdown).toContain('- Screenshot: none pasted');
    expect(markdown).toContain(
      '- Position: observed table `tok` at revision 12; the projection is in report.json',
    );
    expect(markdown).toContain('- Preferences: defaults');
    expect(acceptanceOf(bare)).toBe(
      'The issue described no longer reproduces at `#/play/sealed`, checked in a browser.',
    );
  });

  it('files the issue with the ui, priority and Play surface labels, and the markdown as body', () => {
    const written = writeFeedbackReport({ root, repoRoot: root, report: REPORT, extras: EXTRAS, at: AT });
    const args = issueArgs(REPORT, written, 'o/r');
    expect(args).toEqual([
      'issue',
      'create',
      '--repo',
      'o/r',
      '--title',
      "The pass button hides behind the log's fold",
      '--body-file',
      written.markdownPath,
      '--label',
      'ui',
      '--label',
      'type:bug',
      '--label',
      'p2',
      '--label',
      'space:mtg-play-surface',
    ]);
    const body = readFileSync(written.markdownPath, 'utf8');
    expect(body).toContain('## Acceptance');
    expect(body).toContain(`- ${acceptanceOf(REPORT).split('\n')[0] ?? ''}`);
    expect(args.join(' ')).not.toMatch(/ready\/agent|needs\/the playtester|blocked\//);
    const command = retryCommand([
      'issue',
      'create',
      '--title',
      "it's odd",
      '--body-file',
      '/tmp/a b/report.md',
    ]);
    expect(command).toBe("gh issue create --title 'it'\\''s odd' --body-file '/tmp/a b/report.md'");
  });

  it('reads owner/repo off a GitHub origin, and nothing off another host', () => {
    expect(repoOf('https://github.com/o/r.git\n')).toBe('o/r');
    expect(repoOf('git@github.com:o/r.git')).toBe('o/r');
    expect(repoOf('https://github.com/o/r')).toBe('o/r');
    expect(repoOf('https://gitlab.com/o/r.git')).toBeNull();
  });
});

describe('the server', () => {
  let root: string;
  let server: FeedbackServer;
  const filed: string[][] = [];
  let answer: IssueFiler = (args) => {
    filed.push([...args]);
    return Promise.resolve({ ok: true, id: 'https://github.com/o/r/issues/1' });
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mtg-feedback-'));
    filed.length = 0;
    server = await startFeedbackServer({
      port: 0,
      root: join(root, 'feedback'),
      repoRoot: root,
      staged: 'a staged set',
      filer: (args) => answer(args),
      repo: 'o/r',
      commit: 'abc1234',
      now: () => AT,
    });
  });
  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  const url = (path: string): string => `http://127.0.0.1:${String(server.port)}${path}`;

  it('answers the status', async () => {
    const response = await fetch(url('/feedback-api/status'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ staged: 'a staged set', issues: true, model: false });
  });

  it('writes the report, files the issue, and answers with both', async () => {
    const response = await fetch(url('/feedback-api/reports'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(REPORT),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { issue: string; directory: string; note: string };
    expect(body.issue).toBe('https://github.com/o/r/issues/1');
    expect(body.directory).toMatch(/^feedback\/20260916-101530-[0-9a-f]{4}$/);
    expect(body.note).toContain('untriaged');
    expect(existsSync(join(root, body.directory, 'report.md'))).toBe(true);
    expect(filed[0]?.slice(0, 4)).toEqual(['issue', 'create', '--repo', 'o/r']);
    expect(filed[0]).toContain(join(root, body.directory, 'report.md'));
  });

  it('keeps the report when gh fails, and says how to file it by hand', async () => {
    answer = () => Promise.resolve({ ok: false, reason: 'could not add label' });
    const response = await fetch(url('/feedback-api/reports'), {
      method: 'POST',
      body: JSON.stringify(REPORT),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { issue: null; directory: string; note: string };
    expect(body.issue).toBeNull();
    expect(body.note).toContain('could not add label');
    expect(body.note).toContain('gh issue create --repo o/r');
    expect(existsSync(join(root, body.directory, 'report.json'))).toBe(true);
  });

  it('refuses what is not a report, and names the field', async () => {
    const response = await fetch(url('/feedback-api/reports'), {
      method: 'POST',
      body: JSON.stringify({ ...REPORT, description: '' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: expect.stringMatching(/^not a report: description: /) as string,
    });
    expect(readdirSync(join(root, 'feedback'))).toEqual([]);
    const junk = await fetch(url('/feedback-api/reports'), { method: 'POST', body: '{' });
    expect(junk.status).toBe(400);
  });

  it('answers 404 elsewhere', async () => {
    const response = await fetch(url('/feedback-api/nothing'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: 'nothing at GET /feedback-api/nothing' });
  });
});

/**
 * A report on disk: one directory, the JSON, the markdown, the screenshot.
 *
 * `mtg-fvuyq.4`. The directory is the report's identity — the issue names it,
 * the markdown inside it is the issue's body, and `report.json` is the whole
 * wire body so an agent can reopen the position (`../../src/feedback/wire.ts`
 * says what is in it). Written before the issue is filed and never after: the
 * issue is a pointer, and a pointer to nothing is the failure the order rules
 * out. Under `data/feedback/`, beside recorded games, and through the same
 * guard (`../data-path.ts`), so a root that is not `<repo>/data/<family>` or a
 * temporary directory is refused by name.
 *
 * The markdown is the house issue shape: what is wrong, what should happen,
 * where it was seen, and acceptance criteria. It carries no admission label,
 * so it arrives untriaged in the Play surface intake.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FeedbackReportSchema, imageExtension } from '../../src/feedback/wire';
import type { FeedbackReport, FeedbackSubject } from '../../src/feedback/wire';
import { fsyncDirectory, writeDurably } from '../durable-write';

export const FEEDBACK_FAMILY = 'feedback';

/** `<repo>/data/feedback`, the root every launcher files under. */
export function feedbackDir(repoRoot: string): string {
  return join(repoRoot, 'data', FEEDBACK_FAMILY);
}

export const REPORT_JSON = 'report.json';
export const REPORT_MARKDOWN = 'report.md';

/** What the launcher knows and the page does not. */
export interface ReportExtras {
  /** What this lab staged, in the launcher's words. */
  readonly staged: string;
  /** The checkout the lab was started from, short SHA or `unknown`. */
  readonly commit: string;
}

export type ReadReport =
  { readonly ok: true; readonly report: FeedbackReport } | { readonly ok: false; readonly reason: string };

/** The wire body, checked; a refusal names the first field that is wrong. */
export function readReport(body: unknown): ReadReport {
  const parsed = FeedbackReportSchema.safeParse(body);
  if (parsed.success) return { ok: true, report: parsed.data };
  const first = parsed.error.issues[0];
  const where = first === undefined ? 'report' : first.path.map(String).join('.') || 'report';
  return { ok: false, reason: `${where}: ${first?.message ?? 'not a report'}` };
}

/** `yyyymmdd-hhmmss-xxxx`: sorts by time, and two reports in one second do not collide. */
export function reportStamp(at: Date, suffix: string = randomBytes(2).toString('hex')): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}-${suffix}`;
}

export function describeSubject(subject: FeedbackSubject | null): string {
  if (subject === null) return 'no game on the table';
  if (subject.kind === 'kernel-game') {
    const seed = seedOf(subject.config);
    const state = subject.finished ? 'finished' : 'in progress';
    return (
      `kernel game, ${state}, ${String(subject.choices.length)} choices made` +
      (seed === null ? '' : `, seed \`${seed}\``) +
      `; the config and choice list in ${REPORT_JSON} reopen this exact position`
    );
  }
  return `observed table \`${subject.token}\` at revision ${String(subject.revision)}; the projection is in ${REPORT_JSON}`;
}

function seedOf(config: unknown): string | null {
  if (typeof config !== 'object' || config === null) return null;
  const setup = (config as { readonly setup?: unknown }).setup;
  if (typeof setup !== 'object' || setup === null) return null;
  const seed = (setup as { readonly seed?: unknown }).seed;
  return typeof seed === 'string' ? seed : null;
}

function describeElement(report: FeedbackReport): string {
  const element = report.element;
  if (element === null) return 'nothing pointed at';
  const text = element.text === '' ? '' : ` reading "${element.text}"`;
  const surface = element.surface === null ? '' : ` (surface ${element.surface})`;
  const box = `${String(Math.round(element.box.width))}x${String(Math.round(element.box.height))} at ${String(Math.round(element.box.x))},${String(Math.round(element.box.y))}`;
  return `\`${element.path}\`${text}${surface}, ${box}`;
}

function preferenceLines(report: FeedbackReport): string {
  const entries = Object.entries(report.context.preferences);
  if (entries.length === 0) return 'defaults';
  return entries.map(([key, value]) => `${key}=${value}`).join(', ');
}

/** The acceptance criteria: the desired state as the reporter wrote it, or the fix made visible. */
export function acceptanceOf(report: FeedbackReport): string {
  if (report.draft !== null && report.draft !== undefined) return report.draft.acceptance.join('\n');
  const desired = report.desired.trim();
  const route = report.context.hash === '' ? 'the reported route' : `\`${report.context.hash}\``;
  if (desired === '') return `The issue described no longer reproduces at ${route}, checked in a browser.`;
  return `${desired}\nVerified at ${route} in a browser, at the reported viewport.`;
}

/** The model's drafted fix and the reporter's answer to its question, when the round ran. */
function draftLines(report: FeedbackReport): readonly string[] {
  const draft = report.draft;
  if (draft === null || draft === undefined) return [];
  const answer = draft.answer.trim();
  return [
    '## Drafted fix (model)',
    '',
    draft.description.trim(),
    ...(draft.question === null
      ? []
      : [
          '',
          `Question the model asked: ${draft.question}`,
          `Answer: ${answer === '' ? '(none given)' : answer}`,
        ]),
    '',
  ];
}

/** The issue's title: the model's when its draft was kept, the reporter's otherwise. */
export function issueTitle(report: FeedbackReport): string {
  return report.draft?.title ?? report.title;
}

/** The issue body, as markdown. `imageFile` is the screenshot's name inside the directory, if any. */
export function renderReportMarkdown(
  report: FeedbackReport,
  extras: ReportExtras,
  directory: string,
  imageFile: string | null,
): string {
  const context = report.context;
  const viewport = `${String(context.viewport.width)}x${String(context.viewport.height)} at ${String(context.viewport.devicePixelRatio)}x`;
  const lines = [
    `# ${report.title}`,
    '',
    `Filed from the lab's Feedback helper on ${context.capturedAt}, priority ${report.priority}` +
      (report.designQuestion ? ', marked as a design question for the playtester.' : '.'),
    '',
    '## What is wrong',
    '',
    report.description.trim(),
    '',
    '## What should happen',
    '',
    report.desired.trim() === '' ? '(not stated)' : report.desired.trim(),
    '',
    ...draftLines(report),
    '## Where it was seen',
    '',
    `- Route: \`${context.hash === '' ? '(none)' : context.hash}\``,
    `- Pointed at: ${describeElement(report)}`,
    `- Screenshot: ${imageFile === null ? 'none pasted' : `\`${directory}/${imageFile}\``}`,
    `- Position: ${describeSubject(context.subject)}`,
    `- Showing: ${extras.staged}`,
    `- Viewport: ${viewport}`,
    `- Preferences: ${preferenceLines(report)}`,
    `- Launcher commit: ${extras.commit}`,
    `- Browser: ${context.userAgent === '' ? 'unknown' : context.userAgent}`,
    `- Report: \`${directory}/${REPORT_JSON}\``,
    '',
    '## Acceptance',
    '',
    ...acceptanceOf(report)
      .split('\n')
      .map((line) => `- ${line}`),
    '',
  ];
  return lines.join('\n');
}

export interface WrittenReport {
  /** Absolute path of the report's directory. */
  readonly directory: string;
  /** The same, relative to the repository, which is how the issue names it. */
  readonly relative: string;
  readonly markdownPath: string;
  readonly imageFile: string | null;
}

/**
 * Writes the directory. Every file is created exclusively and fsynced, and
 * the directory itself is fsynced after, so a report that was acknowledged
 * is on disk.
 */
export function writeFeedbackReport(options: {
  readonly root: string;
  readonly repoRoot: string;
  readonly report: FeedbackReport;
  readonly extras: ReportExtras;
  readonly at: Date;
  readonly stamp?: string;
}): WrittenReport {
  const stamp = options.stamp ?? reportStamp(options.at);
  const directory = join(options.root, stamp);
  mkdirSync(directory, { recursive: false });
  const rel = relative(options.repoRoot, directory);
  const image = options.report.image;
  const imageFile = image === null ? null : `pasted.${imageExtension(image.mime)}`;
  if (image !== null && imageFile !== null) {
    writeFileSync(join(directory, imageFile), Buffer.from(image.base64, 'base64'), { flag: 'wx' });
  }
  writeDurably(join(directory, REPORT_JSON), `${JSON.stringify(options.report, null, 2)}\n`);
  const markdownPath = join(directory, REPORT_MARKDOWN);
  writeDurably(markdownPath, renderReportMarkdown(options.report, options.extras, rel, imageFile));
  fsyncDirectory(directory);
  return { directory, relative: rel, markdownPath, imageFile };
}

/**
 * `gh issue create`'s arguments for a written report; the body is the markdown
 * file, which already carries the acceptance criteria. `ui` and the Play
 * surface space put it in that Space's intake; it carries no admission label.
 */
export function issueArgs(report: FeedbackReport, written: WrittenReport, repo: string): readonly string[] {
  return [
    'issue',
    'create',
    '--repo',
    repo,
    '--title',
    issueTitle(report),
    '--body-file',
    written.markdownPath,
    '--label',
    'ui',
    '--label',
    'type:bug',
    '--label',
    report.priority.toLowerCase(),
    '--label',
    'space:mtg-play-surface',
  ];
}

/**
 * The optional model round: a report in, a drafted bead out.
 *
 * `mtg-fvuyq.6`. Armed only by `--feedback-model` on a launcher (`launch.ts`),
 * because a model call spends and the rule here is that nothing spends by
 * forgetting a flag. One round: the model writes the title, the fix where the
 * report states one, acceptance criteria and, if the report cannot be filed
 * without it, a single question. The panel shows the question and appends the
 * reporter's answer to the draft at filing; there is no second call.
 *
 * The screenshot is never sent: the round reads the reporter's sentences and
 * what the page said about itself, which is what the model can reason over.
 * What is a good bead is the model's judgment; this file only frames the ask and
 * the schema checks the shape (`@mtg/llm` validates and retries).
 */
import type { ZodType } from 'zod';
import { BeadDraftSchema } from '../../src/feedback/wire';
import type { BeadDraft, FeedbackReport } from '../../src/feedback/wire';
import { describeSubject } from './report';

export type BeadDrafter = (report: FeedbackReport) => Promise<BeadDraft>;

/** The slice of `@mtg/llm`'s provider this file needs, so tests need not build one. */
export interface DraftProvider {
  complete<T>(request: {
    readonly system: string;
    readonly prompt: string;
    readonly schema: ZodType<T>;
  }): Promise<{ readonly value: T }>;
}

export const DRAFT_SYSTEM =
  "You turn a reporter's UI/UX complaint about a Magic: The Gathering play lab into an issue an engineer " +
  'can act on. Write in plain declarative sentences. State the fix only where the reporter states or ' +
  'clearly implies one; where they do not, restate the problem and say the fix is not stated. Acceptance ' +
  'criteria are observable checks made in a browser. Ask a question only when the report cannot be ' +
  'acted on without the answer, and ask at most one; otherwise the question is null.';

export function draftPrompt(report: FeedbackReport): string {
  const element = report.element;
  return [
    `Reporter's title: ${report.title}`,
    `What is wrong: ${report.description.trim()}`,
    `What should happen: ${report.desired.trim() === '' ? '(not stated)' : report.desired.trim()}`,
    `Priority: ${report.priority}${report.designQuestion ? ' (marked as a design question)' : ''}`,
    `Route: ${report.context.hash === '' ? '(none)' : report.context.hash}`,
    `Pointed at: ${element === null ? 'nothing' : `${element.path}${element.text === '' ? '' : ` reading "${element.text}"`}`}`,
    `Position: ${describeSubject(report.context.subject)}`,
    `Viewport: ${String(report.context.viewport.width)}x${String(report.context.viewport.height)} at ${String(report.context.viewport.devicePixelRatio)}x`,
  ].join('\n');
}

export function modelDrafter(provider: DraftProvider): BeadDrafter {
  return async (report) => {
    const { value } = await provider.complete({
      system: DRAFT_SYSTEM,
      prompt: draftPrompt(report),
      schema: BeadDraftSchema,
    });
    return value;
  };
}

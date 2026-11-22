/**
 * What is on the table right now, for a report written over it.
 *
 * `mtg-fvuyq.3`. The helper is mounted by `App`, above every route, and the
 * game it would describe is held three components down in `LiveGame`'s session
 * or `RemoteGame`'s snapshot. No context or store crosses that gap and this
 * lane adds none: a surface with something to say registers a *reader* here
 * while it is mounted, and the gatherer asks every reader at the moment a
 * report is filed. A reader rather than a value, so the surface registers once
 * and the report still sees the choice list as it stands at filing time.
 *
 * Module state, on purpose. There is one page and at most one table on it, and
 * a subscription would only exist to re-render a panel that reads the subject
 * once, on submit.
 */
import { useEffect } from 'react';
import type { FeedbackSubject } from './wire';

/** Null is a surface with nothing on the table yet: a remote seat still connecting. */
export type SubjectReader = () => FeedbackSubject | null;

const readers = new Set<SubjectReader>();

/** Registers a reader; the returned function withdraws it. */
export function registerFeedbackSubject(reader: SubjectReader): () => void {
  readers.add(reader);
  return (): void => {
    readers.delete(reader);
  };
}

/** Every subject currently on screen. Two is a surface hosting a table twice; the first wins. */
export function readFeedbackSubjects(): readonly FeedbackSubject[] {
  return [...readers].map((reader) => reader()).filter((subject) => subject !== null);
}

/** Registers `read` for the life of the component. `read` is read through a ref, never a dependency. */
export function useFeedbackSubject(read: SubjectReader): void {
  useEffect(() => registerFeedbackSubject(read), [read]);
}

/** Test seam: forgets every reader. */
export function resetFeedbackSubjects(): void {
  readers.clear();
}

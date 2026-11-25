/** `npm run unreviewed-choices`: the review queue the lab's logged unreviewed choices make (#66). */
import { resolve } from 'node:path';
import {
  formatReviewQueue,
  readUnreviewedChoices,
  reviewQueue,
  unreviewedChoiceLogPath,
} from './unreviewed-choices';

const logPath = unreviewedChoiceLogPath(resolve(import.meta.dirname, '..', '..', '..'));
process.stdout.write(formatReviewQueue(reviewQueue(readUnreviewedChoices(logPath)), logPath));

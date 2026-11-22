/**
 * Does the format do what it claims.
 *
 * The third of the three questions this surface answers, and the one whose
 * failure mode is not a wrong number but a confident one. A capability nobody
 * measured must never look like a capability that passed, so the layout is
 * built around keeping those two apart:
 *
 *  1. **Unmeasured is its own answer, and it carries the reason.** Never a
 *     share, never a zero, never a gray pass. The reason names the flag or the
 *     limit that would change it, in the producer's words.
 *  2. **A miss is a number in the unit the capability was stated in.** Card
 *     counts read as cards and seat shares read as percentages, because the
 *     distance is what tells a designer how far to move.
 *  3. **What the measurement cannot say is printed beside it, not buried.**
 *     The drafted half is an optimistic deal collated by rarity picked by one
 *     arithmetic bot, and a share shown without those three sentences is a
 *     stronger claim than the run made.
 *
 * A fourth status, `abstained`, is the producer saying a stated minimum could
 * not be judged because the pod cannot deal the archetype at all. It is neither
 * a pass nor a miss and it is not painted as either.
 *
 * Nothing here computes: every number, reason and limit is `@mtg/cube`'s work,
 * carried in the document. The types are restated in `model.ts` rather than
 * imported for the reason every other type on this route is.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { integer } from './evidence';
import type { ClaimStatus, RunClaim, RunClaimFinding, RunClaims } from './model';

export const CLAIM_STATUS_LABELS: Readonly<Record<ClaimStatus, string>> = {
  met: 'met',
  missed: 'missed',
  abstained: 'not judged',
  unmeasured: 'not measured',
};

/**
 * `abstained` and `unmeasured` are `pending`, never `positive`.
 *
 * Both mean the question was not answered, and a green badge over "not
 * measured" would be the panel contradicting the words inside it — the same
 * rule `verdictTone` holds one file over.
 */
export function claimTone(status: ClaimStatus): 'positive' | 'negative' | 'pending' {
  switch (status) {
    case 'met':
      return 'positive';
    case 'missed':
      return 'negative';
    case 'abstained':
    case 'unmeasured':
      return 'pending';
  }
}

/** A share as a percentage, a count as a count. The unit is on the claim. */
export function claimAmount(value: number, unit: RunClaim['unit']): string {
  if (unit === 'share') return `${(value * 100).toFixed(1)}%`;
  if (Number.isInteger(value)) return integer(value);
  return value.toFixed(1);
}

/**
 * The claim as one sentence.
 *
 * An unmeasured claim gets no comparison at all, not a comparison against a
 * blank: the sentence a reader takes away has to be "nobody checked", and any
 * arithmetic in it undoes that.
 */
export function claimText(claim: RunClaim): string {
  if (claim.measured === null || claim.distance === null) {
    return `Wanted ${claimAmount(claim.required, claim.unit)}. Nothing measured it.`;
  }
  const comparison = `Measured ${claimAmount(claim.measured, claim.unit)} against ${claimAmount(claim.required, claim.unit)}`;
  if (claim.status === 'met') return `${comparison}.`;
  const direction = claim.distance < 0 ? 'short by' : 'over by';
  return `${comparison}, ${direction} ${claimAmount(Math.abs(claim.distance), claim.unit)}.`;
}

function claimRow(claim: RunClaim): ReactElement {
  const tone = claimTone(claim.status);
  return createElement(
    'li',
    { key: `${claim.capability}:${claim.subject}`, className: 'mtg-finding', 'data-tone': tone },
    createElement(
      'span',
      { className: 'mtg-finding__head' },
      createElement('span', { className: 'mtg-badge', 'data-tone': tone }, CLAIM_STATUS_LABELS[claim.status]),
      createElement('span', { className: 'mtg-finding__name' }, claim.statement),
    ),
    createElement('span', { className: 'mtg-finding__body' }, claimText(claim)),
    createElement('span', { className: 'mtg-finding__note' }, claim.detail),
  );
}

function findingRow(finding: RunClaimFinding, tone: 'negative' | 'pending', badge: string): ReactElement {
  return createElement(
    'li',
    { key: `${finding.code}:${finding.subject}`, className: 'mtg-finding', 'data-tone': tone },
    createElement(
      'span',
      { className: 'mtg-finding__head' },
      createElement('span', { className: 'mtg-badge', 'data-tone': tone }, badge),
      createElement('span', { className: 'mtg-finding__name' }, finding.code),
    ),
    createElement('span', { className: 'mtg-finding__body' }, finding.detail),
  );
}

/** What the drafted half is subject to, in one sentence before the list. */
export function limitsLead(claims: RunClaims): string {
  switch (claims.limitsKind) {
    case 'shares-measured':
      return 'Every share above was drafted, and three things about that draft bound what it can say:';
    case 'not-drafted':
      return 'Nothing was drafted. These are the grounds the runtime refuses on:';
    case 'not-attempted':
      return 'This run measured the list without drafting it, so no share was produced.';
    default:
      return 'The producer described the drafted half in terms this page does not recognize:';
  }
}

function panel(label: string, lead: ReactNode, rows: readonly ReactNode[]): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-panel', 'aria-label': label },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, label),
    ),
    createElement(
      'div',
      { className: 'mtg-panel__body' },
      lead,
      rows.length === 0 ? null : createElement('ul', { className: 'mtg-finding-list' }, ...rows),
    ),
  );
}

export interface ClaimsPanelProps {
  readonly claims: RunClaims;
}

/**
 * The stated capabilities, then the things the measurement cannot say.
 *
 * The headline counts the three answers separately rather than summing them
 * into a pass rate: "eleven of twelve" over a run where four were never
 * measured is a number that is true and reads as reassurance.
 */
export function ClaimsPanel(props: ClaimsPanelProps): ReactElement {
  const { claims } = props;
  const met = claims.claims.filter((claim) => claim.status === 'met').length;
  const unmeasured = claims.claims.filter(
    (claim) => claim.status === 'unmeasured' || claim.status === 'abstained',
  ).length;
  const missed = claims.claims.filter((claim) => claim.status === 'missed').length;
  const provenance = claims.draftProvenance;

  return createElement(
    'div',
    { className: 'mtg-fairness', 'aria-label': 'Does it do what it claims' },
    createElement(
      'section',
      {
        className: 'mtg-verdict',
        'data-tone': claims.ok ? 'positive' : 'negative',
        'aria-label': 'Verdict',
      },
      createElement('span', { className: 'mtg-verdict__ask' }, 'Does the format do what it claims?'),
      createElement(
        'span',
        { className: 'mtg-verdict__answer' },
        claims.ok ? 'nothing stated was missed' : 'something stated was missed',
      ),
      createElement(
        'span',
        { className: 'mtg-verdict__note' },
        `${integer(claims.claims.length)} stated capabilities: ${integer(met)} met, ${integer(missed)} missed, ${integer(unmeasured)} not measured.`,
      ),
      provenance === null
        ? null
        : createElement(
            'span',
            { className: 'mtg-verdict__note' },
            `Shares are out of ${integer(provenance.seatDrafts)} seat-drafts over ${integer(provenance.drafts)} drafts, seeded ${provenance.seed}.`,
          ),
    ),
    claims.claims.length === 0
      ? panel(
          'Stated capabilities',
          'This format stated no capabilities, so there is nothing here to measure it against.',
          [],
        )
      : panel('Stated capabilities', null, claims.claims.map(claimRow)),
    panel(
      'What this cannot say',
      limitsLead(claims),
      claims.limits.map((limit) =>
        createElement(
          'li',
          { key: limit.id, className: 'mtg-finding', 'data-tone': 'pending' },
          createElement(
            'span',
            { className: 'mtg-finding__head' },
            createElement('span', { className: 'mtg-badge', 'data-tone': 'pending' }, limit.id),
          ),
          createElement('span', { className: 'mtg-finding__body' }, limit.what),
        ),
      ),
    ),
    claims.unclaimed.length === 0
      ? null
      : panel(
          'Faults no stated capability covers',
          'The list differs from itself, not from something the designer asked for. These fail the format:',
          claims.unclaimed.map((finding) => findingRow(finding, 'negative', 'fault')),
        ),
    claims.reported.length === 0
      ? null
      : panel(
          'Measured against numbers nobody chose',
          'The schema supplied these dials, so a difference is reported and never failed on:',
          claims.reported.map((finding) => findingRow(finding, 'pending', 'not stated')),
        ),
  );
}

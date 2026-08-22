/** Reference calibration, card warnings, and optional before/after evidence. */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderCopy } from '../../copy';
import type {
  CalibrationArtifact,
  CalibrationState,
  CalibrationUnit,
  ReferenceCode,
  RetuneArtifact,
  RetuneState,
} from './calibration-model';

function integer(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function metricValue(value: number, unit: CalibrationUnit): string {
  return unit === 'share' ? `${(value * 100).toFixed(1)}%` : value.toFixed(2);
}

function metricName(id: string): string {
  return id.replaceAll('-', ' ');
}

function panel(title: string, note: string, body: ReactNode): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-panel' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('h2', { className: 'mtg-panel__title' }, title),
      createElement('span', { className: 'mtg-panel__note' }, note),
    ),
    createElement('div', { className: 'mtg-panel__body' }, body),
  );
}

function note(text: string): ReactElement {
  return createElement('p', { className: 'mtg-chart__note' }, renderCopy(text));
}

function empty(title: string, body: string, state: string): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-empty', 'aria-label': 'Reference calibration', 'data-state': state },
    createElement('span', { className: 'mtg-empty__title' }, title),
    createElement('span', { className: 'mtg-empty__body' }, renderCopy(body)),
  );
}

function primaryCore(artifact: CalibrationArtifact): ReactElement {
  return panel(
    'Primary core envelope',
    `${artifact.profileVersion} · ${artifact.primaryCore.precedence} precedence on conflicts`,
    createElement(
      'div',
      null,
      note(artifact.primaryCore.caveat),
      createElement(
        'div',
        { className: 'mtg-scroll' },
        createElement(
          'table',
          { className: 'mtg-table' },
          createElement(
            'thead',
            null,
            createElement(
              'tr',
              null,
              createElement('th', { scope: 'col' }, 'Metric'),
              createElement('th', { scope: 'col' }, 'Evidence use'),
              createElement('th', { scope: 'col', 'data-align': 'right' }, artifact.subject.code),
              createElement('th', { scope: 'col', 'data-align': 'right' }, 'M11'),
              createElement('th', { scope: 'col', 'data-align': 'right' }, 'M13'),
              createElement('th', { scope: 'col', 'data-align': 'right' }, 'Target'),
              createElement('th', { scope: 'col' }, 'Status'),
            ),
          ),
          createElement(
            'tbody',
            null,
            ...artifact.primaryCore.metrics.map((metric) => {
              const m11 = metric.anchors[0];
              const m13 = metric.anchors[1];
              return createElement(
                'tr',
                { key: metric.id, title: metric.rationale },
                createElement('th', { scope: 'row' }, metricName(metric.id)),
                createElement(
                  'td',
                  null,
                  metric.scope === 'canonical-target' ? 'Actionable target' : 'Reference context',
                ),
                createElement(
                  'td',
                  { className: 'mtg-num', 'data-align': 'right' },
                  `${metricValue(metric.subject.value, metric.unit)} · n=${integer(metric.subject.population.count)}`,
                ),
                createElement(
                  'td',
                  { className: 'mtg-num', 'data-align': 'right' },
                  m11 === undefined
                    ? 'missing'
                    : `${metricValue(m11.exactValue, metric.unit)} · n=${integer(m11.population.count)}`,
                ),
                createElement(
                  'td',
                  { className: 'mtg-num', 'data-align': 'right' },
                  m13 === undefined
                    ? 'missing'
                    : `${metricValue(m13.exactValue, metric.unit)} · n=${integer(m13.population.count)}`,
                ),
                createElement(
                  'td',
                  { className: 'mtg-num', 'data-align': 'right' },
                  `${metricValue(metric.target.lower, metric.unit)}-${metricValue(metric.target.upper, metric.unit)}`,
                ),
                createElement(
                  'td',
                  null,
                  createElement(
                    'span',
                    {
                      className: 'mtg-badge',
                      'data-tone': metric.status === 'inside' ? 'positive' : 'negative',
                    },
                    metric.status,
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    ),
  );
}

function referenceComparison(artifact: CalibrationArtifact, code: ReferenceCode): ReactElement {
  const selected = artifact.references.find((reference) => reference.code === code) ?? artifact.references[0];
  if (selected === undefined)
    return empty('No reference profiles', 'The checked document has no profiles.', 'invalid');
  return panel(
    `Comparison with ${selected.code}`,
    `${selected.name} · ${selected.role} · ${integer(selected.mainSetSize)} collector positions`,
    createElement(
      'div',
      null,
      note(selected.evidence.caveat),
      createElement(
        'div',
        { className: 'mtg-scroll' },
        createElement(
          'table',
          { className: 'mtg-table' },
          createElement(
            'thead',
            null,
            createElement(
              'tr',
              null,
              createElement('th', { scope: 'col' }, 'Metric'),
              createElement('th', { scope: 'col', 'data-align': 'right' }, artifact.subject.code),
              createElement('th', { scope: 'col', 'data-align': 'right' }, selected.code),
              createElement('th', { scope: 'col', 'data-align': 'right' }, 'Delta'),
              createElement('th', { scope: 'col', 'data-align': 'right' }, 'Reference n'),
            ),
          ),
          createElement(
            'tbody',
            null,
            ...selected.metrics.map((metric) =>
              createElement(
                'tr',
                { key: metric.id },
                createElement('th', { scope: 'row' }, metricName(metric.id)),
                createElement(
                  'td',
                  { className: 'mtg-num', 'data-align': 'right' },
                  metricValue(metric.subject, metric.unit),
                ),
                createElement(
                  'td',
                  { className: 'mtg-num', 'data-align': 'right' },
                  metricValue(metric.reference, metric.unit),
                ),
                createElement(
                  'td',
                  { className: 'mtg-num', 'data-align': 'right' },
                  metricValue(metric.delta, metric.unit),
                ),
                createElement(
                  'td',
                  { className: 'mtg-num', 'data-align': 'right' },
                  integer(metric.population.count),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function cardFindings(artifact: CalibrationArtifact): ReactElement {
  return panel(
    'Card-level static findings',
    `${integer(artifact.findings.population.count)} executable cards · weak, healthy, and bomb-risk are proxy labels`,
    createElement(
      'div',
      null,
      note(`${artifact.findings.evidence.uncertainty} ${artifact.findings.evidence.caveat}`),
      createElement(
        'div',
        { className: 'mtg-scroll' },
        createElement(
          'table',
          { className: 'mtg-table' },
          createElement(
            'thead',
            null,
            createElement(
              'tr',
              null,
              createElement('th', { scope: 'col' }, 'Card'),
              createElement('th', { scope: 'col' }, 'Finding'),
              createElement('th', { scope: 'col', 'data-align': 'right' }, 'Card n'),
              createElement('th', { scope: 'col' }, 'Anchor proxy populations'),
            ),
          ),
          createElement(
            'tbody',
            null,
            ...artifact.findings.cards.map((finding) =>
              createElement(
                'tr',
                { key: finding.id, title: finding.basis },
                createElement('th', { scope: 'row' }, finding.name),
                createElement(
                  'td',
                  null,
                  createElement(
                    'span',
                    {
                      className: 'mtg-badge',
                      'data-tone': finding.status === 'healthy' ? 'positive' : 'pending',
                    },
                    finding.status,
                  ),
                ),
                createElement('td', { className: 'mtg-num', 'data-align': 'right' }, 'n=1 card'),
                createElement(
                  'td',
                  { className: 'mtg-num' },
                  finding.anchors
                    .map(
                      (anchor) =>
                        `${anchor.setCode} ${integer(anchor.flagged)}/${integer(anchor.population)}`,
                    )
                    .join(' · '),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function formatEvidence(artifact: CalibrationArtifact): readonly ReactElement[] {
  const { draft, sealed, native, human } = artifact.formats;
  return [
    panel(
      'Draft evidence',
      draft.status,
      createElement(
        'div',
        null,
        note(draft.evidence),
        note(draft.caveat),
        note(
          draft.collation.status === 'checked'
            ? `${draft.collation.evidence} n=${integer(draft.collation.population.count)}.`
            : `${draft.collation.reason} n=${integer(draft.collation.population.count)} source cards.`,
        ),
        note(
          draft.mechanicAsFan.status === 'checked'
            ? `${draft.mechanicAsFan.evidence} n=${integer(draft.mechanicAsFan.population.count)}.`
            : `${draft.mechanicAsFan.reason} n=${integer(draft.mechanicAsFan.population.count)} source cards.`,
        ),
        note(`${draft.archetypeSupport.evidence} n=${integer(draft.archetypeSupport.population.count)}.`),
        createElement(
          'ul',
          { className: 'mtg-findings' },
          ...draft.archetypeSupport.pairs.map((pair) =>
            createElement(
              'li',
              { key: pair.pair },
              `${pair.pair} · ${integer(pair.exactMulticolorCards)} multicolor · ${integer(pair.fixingCards)} fixing · n=${integer(draft.archetypeSupport.population.count)}`,
            ),
          ),
        ),
      ),
    ),
    panel(
      'Sealed evidence',
      sealed.status,
      createElement('div', null, note(sealed.evidence), note(sealed.caveat)),
    ),
    panel(
      'Native execution evidence',
      `${integer(native.subjectCards)} subject cards · M11 ${integer(native.anchorCards.M11)} · M13 ${integer(native.anchorCards.M13)}`,
      createElement('div', null, note(native.evidence), note(native.caveat)),
    ),
    panel(
      'Human evidence',
      `${integer(human.observations)} observations`,
      createElement('div', null, note(human.evidence), note(human.caveat)),
    ),
  ];
}

export interface CalibrationPanelProps {
  readonly artifact: CalibrationArtifact;
  readonly referenceCode: ReferenceCode;
  readonly onSelectReference: (code: ReferenceCode) => void;
}

export function CalibrationPanel(props: CalibrationPanelProps): ReactElement {
  const artifact = props.artifact;
  return createElement(
    'div',
    { className: 'mtg-analysis', 'aria-label': 'Reference calibration' },
    createElement(
      'div',
      { className: 'mtg-toolbar' },
      createElement(
        'label',
        { className: 'mtg-field' },
        createElement('span', { className: 'mtg-field__label' }, 'Reference set'),
        createElement(
          'select',
          {
            className: 'mtg-select',
            value: props.referenceCode,
            onChange: (event: { target: { value: string } }) => {
              const found = artifact.references.find((reference) => reference.code === event.target.value);
              if (found !== undefined) props.onSelectReference(found.code);
            },
          },
          ...artifact.references.map((reference) =>
            createElement(
              'option',
              { key: reference.code, value: reference.code },
              `${reference.code} · ${reference.name} · ${reference.role}`,
            ),
          ),
        ),
      ),
      createElement('span', { className: 'mtg-toolbar__spacer' }),
      createElement(
        'span',
        { className: 'mtg-page-note' },
        `${artifact.sourceCorpus.provider} ${artifact.sourceCorpus.version} · ${artifact.profileVersion}`,
      ),
    ),
    primaryCore(artifact),
    referenceComparison(artifact, props.referenceCode),
    cardFindings(artifact),
    ...formatEvidence(artifact),
  );
}

export interface CalibrationEvidencePanelProps {
  readonly state: CalibrationState;
  readonly referenceCode: ReferenceCode;
  readonly onSelectReference: (code: ReferenceCode) => void;
}

export function CalibrationEvidencePanel(props: CalibrationEvidencePanelProps): ReactElement {
  switch (props.state.status) {
    case 'loading':
      return empty('Reading reference calibration…', 'One moment.', 'loading');
    case 'absent':
      return empty(
        'No reference calibration staged',
        'Run `npm run play` to stage the checked reference profiles beside the playable set.',
        'absent',
      );
    case 'stale':
      return empty('Reference calibration is stale', props.state.message, 'stale');
    case 'invalid':
      return empty('Reference calibration could not be read', props.state.message, 'invalid');
    case 'ready':
      return createElement(CalibrationPanel, {
        artifact: props.state.artifact,
        referenceCode: props.referenceCode,
        onSelectReference: props.onSelectReference,
      });
  }
}

function changeValue(value: string | number): string {
  return typeof value === 'number' ? new Intl.NumberFormat('en-US').format(value) : value;
}

function proposal(artifact: RetuneArtifact): ReactElement {
  const evidence = artifact.evidence;
  return createElement(
    'div',
    null,
    evidence.kind === 'simulation'
      ? note(
          `${integer(evidence.beforeSamples)} before · ${integer(evidence.afterSamples)} after. Measurement ${evidence.measurementStatus}; gate ${evidence.gateStatus}; uncertainty ${evidence.uncertaintyStatus}. ${evidence.uncertainty} ${evidence.caveat}`,
        )
      : note(evidence.caveat),
    createElement(
      'div',
      { className: 'mtg-scroll' },
      createElement(
        'table',
        { className: 'mtg-table' },
        createElement(
          'thead',
          null,
          createElement(
            'tr',
            null,
            createElement('th', { scope: 'col' }, 'Card or deck'),
            createElement('th', { scope: 'col' }, 'Field'),
            createElement('th', { scope: 'col' }, 'Before'),
            createElement('th', { scope: 'col' }, 'After'),
          ),
        ),
        createElement(
          'tbody',
          null,
          ...artifact.changes.map((change) =>
            createElement(
              'tr',
              { key: `${change.kind}-${change.id}-${change.field}` },
              createElement('th', { scope: 'row' }, change.label),
              createElement('td', null, change.field),
              createElement('td', { className: 'mtg-num' }, changeValue(change.before)),
              createElement('td', { className: 'mtg-num' }, changeValue(change.after)),
            ),
          ),
        ),
      ),
    ),
  );
}

export interface RetuneEvidencePanelProps {
  readonly state: RetuneState;
}

export function RetuneEvidencePanel(props: RetuneEvidencePanelProps): ReactElement {
  let body: ReactNode;
  let noteText: string;
  switch (props.state.status) {
    case 'loading':
      noteText = 'reading';
      body = note('Reading the optional proposal…');
      break;
    case 'absent':
      noteText = 'not staged';
      body = note(
        'No retune proposal is staged. The current set remains the baseline, and no before/after claim is made.',
      );
      break;
    case 'blocked':
      noteText = 'blocked';
      body = note(props.state.message);
      break;
    case 'stale':
    case 'invalid':
      noteText = props.state.status;
      body = note(props.state.message);
      break;
    case 'underSampled':
      noteText = 'not measured';
      body = proposal(props.state.artifact);
      break;
    case 'ready':
      noteText = props.state.artifact.proposalId;
      body = proposal(props.state.artifact);
      break;
  }
  return createElement(
    'section',
    {
      className: 'mtg-panel',
      'aria-label': 'Proposed retune evidence',
      'data-state': props.state.status,
    },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('h2', { className: 'mtg-panel__title' }, 'Proposed retune evidence'),
      createElement('span', { className: 'mtg-panel__note' }, noteText),
    ),
    createElement('div', { className: 'mtg-panel__body' }, body),
  );
}

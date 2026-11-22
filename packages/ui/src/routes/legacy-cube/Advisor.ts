/** Evidence-first views over the local evaluator; no card rules are interpreted here. */
import { createElement as h } from 'react';
import type { ReactElement } from 'react';
import type { AdvisorModel, CardAssessment, DraftAdvice, Reason, Recommendation } from '@mtg/draft-export';
import { reasonsForPath } from '@mtg/draft-export';

const MODE: Readonly<Record<Recommendation['mode'], string>> = {
  current: 'Current plan',
  flexible: 'Stay flexible',
  pivot: 'Explore an open lane',
  explore: 'Pinned path',
};

function reasons(title: string, entries: readonly Reason[]): ReactElement | null {
  return entries.length === 0
    ? null
    : h(
        'section',
        null,
        h('h3', null, title),
        h('ul', null, ...entries.map((r, i) => h('li', { key: `${r.code}/${String(i)}` }, r.text))),
      );
}

export function AdvisorSummary({
  advice,
  calibrationNote,
}: {
  readonly advice: DraftAdvice;
  readonly calibrationNote?: string;
}): ReactElement {
  const groups = [...new Set(advice.recommendations.map((r) => r.card.physicalId))].map((id) =>
    advice.recommendations.filter((r) => r.card.physicalId === id),
  );
  return h(
    'section',
    { className: 'mtg-advisor', 'aria-label': 'Draft recommendations' },
    h('h2', null, 'Pick directions'),
    h(
      'p',
      { className: 'mtg-advisor__note', 'data-weight-revision': advice.weights.revision },
      `Weights: ${advice.weights.revision}. ${calibrationNote ?? 'Authored baseline.'}`,
    ),
    h(
      'p',
      { className: 'mtg-advisor__note' },
      'Not yet bot-validated. These recommendations use authored card and package evidence, not calibrated match results.',
    ),
    ...groups.map((group) =>
      h(
        'details',
        { key: group[0]!.card.physicalId },
        h('summary', null, `${group.map((r) => MODE[r.mode]).join(' / ')}: ${group[0]!.card.name}`),
        h(
          'p',
          null,
          group.length > 1
            ? 'The same card leads these approaches in this pack.'
            : 'One approach to this pack, with its tradeoffs.',
        ),
        reasons('Why', [...new Map(group.flatMap((r) => r.reasons).map((r) => [r.text, r])).values()]),
      ),
    ),
    advice.recommendations.some((r) => r.mode === 'current')
      ? null
      : h('p', null, 'No established direction yet. Start with quality and flexibility.'),
    advice.recommendations.some((r) => r.mode === 'pivot')
      ? null
      : h('p', null, 'No distinct pivot pick has enough observable support yet.'),
    h(
      'p',
      { className: 'mtg-advisor__note' },
      'Estimates from your picks and seen packs only. Bot preferences are simple, so signals describe this table.',
    ),
  );
}

export function AdvisorCardDetail({
  assessment,
  model,
  pinned,
}: {
  readonly assessment: CardAssessment;
  readonly model: AdvisorModel;
  readonly pinned: string | null;
}): ReactElement {
  const selected = assessment.archetypeAssessments.find(
    (a) => a.archetype === (pinned ?? assessment.currentPath),
  );
  const paths = [...assessment.effectOnArchetypes].filter((a, index) => index < 4 || a.archetype === pinned);
  return h(
    'section',
    { className: 'mtg-advisor', 'aria-label': `Advice for ${assessment.card.name}` },
    h(
      'h2',
      null,
      `${selected?.assessment ?? assessment.overallAssessment} · ${model.archetypes.find((a) => a.id === selected?.archetype)?.name ?? 'Flexible pick'}`,
    ),
    reasons(
      'Pros',
      [
        ...assessment.reasons.filter((r) => r.code !== 'fills-need'),
        ...(selected?.reasons.filter((r) => r.polarity !== 'negative') ?? []),
        ...reasonsForPath(assessment.synergies, selected?.archetype ?? null, model),
      ].slice(0, 7),
    ),
    reasons('Cons', [
      ...reasonsForPath(assessment.liabilities, selected?.archetype ?? null, model),
      ...(selected?.reasons.filter((r) => r.polarity === 'negative') ?? []),
    ]),
    h('h3', null, 'Effect on paths'),
    h(
      'ul',
      null,
      ...paths.map((a) =>
        h(
          'li',
          { key: a.archetype },
          `${model.archetypes.find((m) => m.id === a.archetype)!.name} ${a.effect} · ${a.assessment}`,
        ),
      ),
    ),
    h(
      'p',
      { className: 'mtg-advisor__note' },
      'Arrows describe added support and commitment, not a forecast of future packs.',
    ),
    reasons('Opportunity cost', assessment.opportunityCosts),
  );
}

export function AdvisorPaths({
  advice,
  model,
  onPin,
}: {
  readonly advice: DraftAdvice;
  readonly model: AdvisorModel;
  readonly onPin: (id: string | null) => void;
}): ReactElement {
  const names = new Map(advice.memory.pool.map((c) => [c.physicalId, c.name]));
  return h(
    'section',
    { className: 'mtg-advisor', 'aria-label': 'Archetype paths' },
    h('h2', null, 'What your pool can become'),
    h(
      'p',
      { className: 'mtg-advisor__note' },
      'Bot validation is separate from pool fit and openness. Missing validation does not mean the archetype is weak or unavailable to explore.',
    ),
    h(
      'label',
      null,
      'Explore an archetype',
      h(
        'select',
        {
          value: advice.pinned ?? '',
          onChange: (event: { readonly currentTarget: { readonly value: string } }): void =>
            onPin(event.currentTarget.value || null),
        },
        h('option', { value: '' }, 'Follow my pool'),
        ...model.archetypes.map((a) => h('option', { key: a.id, value: a.id }, a.name)),
      ),
    ),
    ...[...advice.archetypes]
      .sort((a, b) => Number(b.id === advice.pinned) - Number(a.id === advice.pinned))
      .map((path, index) => {
        const meta = model.archetypes.find((a) => a.id === path.id)!;
        return h(
          'details',
          { key: path.id, ...(path.id === advice.pinned ? { open: true } : {}) },
          h(
            'summary',
            null,
            `${path.name} · ${path.status}${path.id === advice.pinned ? ' · Pinned' : ''}`,
            h('small', { className: 'mtg-advisor__preview' }, 'Not yet bot-validated'),
            index < 3 || path.id === advice.pinned
              ? h(
                  'small',
                  { className: 'mtg-advisor__preview' },
                  `Signal: ${path.openness.label} (${path.openness.confidence} confidence). Pivot: ${path.pivotCost}.`,
                )
              : null,
          ),
          h('p', null, meta.description),
          h(
            'p',
            null,
            `Usual colors: ${meta.colors.join('/')} · Pool fit: ${path.poolFit >= 15 ? 'Strong' : path.poolFit >= 6 ? 'Developing' : path.poolFit > 0 ? 'Light' : 'None'} · Pool confidence: ${path.confidence}`,
          ),
          h('p', null, `Signal: ${path.openness.label} · Signal confidence: ${path.openness.confidence}`),
          h('p', null, `Mana: ${path.manaFeasibility} · Pivot cost: ${path.pivotCost}`),
          h(
            'p',
            null,
            `Card quality: ${path.quality >= 4 ? 'Strong' : path.quality >= 3 ? 'Reasonable' : path.contributors.length ? 'Speculative' : 'Unknown'} · Synergy density: ${path.synergyDensity >= 0.6 ? 'Concentrated' : path.synergyDensity >= 0.3 ? 'Developing' : 'Scattered'} · Structure: ${path.completeness >= 1 ? 'Role targets met' : path.completeness >= 0.5 ? 'Taking shape' : 'Incomplete'}`,
          ),
          h(
            'p',
            null,
            `Contributing cards: ${path.contributors.map((id) => names.get(id) ?? id).join(', ') || 'None yet'}`,
          ),
          h(
            'ul',
            null,
            ...path.pieces.map((p) =>
              h(
                'li',
                { key: p.tag },
                `${p.label}: ${String(p.count)} / ${String(p.min)}${p.critical ? ' (key component)' : ''}`,
              ),
            ),
          ),
          h(
            'p',
            null,
            `Need: ${path.missing.map((n) => `${String(n.min - n.count)} ${n.label}`).join(', ') || 'All modeled role targets met; check the final curve and mana base.'}`,
          ),
          path.surplus.length
            ? h(
                'p',
                null,
                `Surplus: ${path.surplus.map((n) => n.label).join(', ')}. More copies compete for deck slots while other needs remain.`,
              )
            : null,
          path.stranded.length
            ? h(
                'p',
                null,
                `Moving here may leave behind: ${path.stranded.map((id) => names.get(id) ?? id).join(', ')}`,
              )
            : null,
          reasons('Observed evidence', path.openness.observations),
          advice.pinned === path.id && path.openness.score < 1
            ? h(
                'p',
                null,
                'This is an exploration target, not evidence that the lane is open. Watch for its missing pieces before committing further.',
              )
            : null,
          h(
            'details',
            null,
            h('summary', null, 'Packages and cards to look for'),
            ...model.packages
              .filter((p) => meta.packages.includes(p.id))
              .map((p) => h('p', { key: p.id }, `${p.name}: ${p.needs.map((n) => n.label).join(' + ')}`)),
            h(
              'p',
              null,
              model.profiles
                .filter((p) => p.archetypes.some((a) => a.archetype === path.id && a.strength >= 2))
                .map((p) => p.name)
                .join(', '),
            ),
            h('p', null, `Finishers: ${meta.finishers.join(', ')}.`),
            h('p', null, `Watch for: ${meta.pitfalls.join('; ')}.`),
            h(
              'p',
              { className: 'mtg-advisor__note' },
              'Examples from the public cube list. These cards may be drafted, undealt, or still unseen; their locations are not known.',
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'mtg-btn',
              'aria-pressed': advice.pinned === path.id,
              onClick: (): void => onPin(advice.pinned === path.id ? null : path.id),
            },
            advice.pinned === path.id ? 'Unpin path' : `Explore ${path.name}`,
          ),
        );
      }),
  );
}

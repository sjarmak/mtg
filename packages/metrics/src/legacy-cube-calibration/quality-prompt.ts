/** Lossless presentation compaction; tasks, judgment schemas and receipt IDs stay canonical. */
import type { buildQualityReviewPair } from './quality-pair';

type Arm = ReturnType<typeof buildQualityReviewPair>['baseline'];
type AdvicePayload = Arm['advice'][number]['payload'];
type Task = Arm['deck'] | Arm['advice'][number];

function mapStrings<T>(value: T, replace: (value: string) => string): T {
  if (typeof value === 'string') return replace(value) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => mapStrings(item, replace)) as T;
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapStrings(item, replace)]),
    ) as T;
  return value;
}

export function compactAdvicePayload(payload: AdvicePayload) {
  const cardReferences = payload.context.observedCards.map(
    (card, index) => [`@c${index}`, card.physicalId] as const,
  );
  const encode = new Map(cardReferences.map(([alias, original]) => [original, alias]));
  const aliases = new Set<string>(cardReferences.map(([alias]) => alias));
  // Reject ambiguity instead of silently replacing an existing literal with a card reference.
  mapStrings(payload, (value) => {
    if (aliases.has(value)) throw new Error('Card alias collides with original payload text');
    return value;
  });
  const { claims, ...advice } = payload.advice;
  const claimTexts = [...new Set(claims.map((claim) => claim.reason.text))];
  const claimRows = claims.map(({ id, reason }) => {
    const { code, text, cards, polarity, ...details } = reason;
    return [id, code, claimTexts.indexOf(text), cards, polarity, details] as const;
  });
  return {
    encoding: 'legacy-cube-review-table/v1' as const,
    cardReferences,
    claimColumns: ['id', 'code', 'textIndex', 'cards', 'polarity', 'details'] as const,
    payload: mapStrings(
      { ...payload, advice: { ...advice, claimTexts, claimRows } },
      (value) => encode.get(value) ?? value,
    ),
  };
}

/** Internal inverse for the canonical renderer's round-trip invariant, not an artifact admission API. */
export function expandAdvicePayload(compact: ReturnType<typeof compactAdvicePayload>) {
  const decode = new Map<string, string>(compact.cardReferences);
  const payload = mapStrings(compact.payload, (value) => decode.get(value) ?? value);
  const { claimRows, claimTexts, ...advice } = payload.advice;
  const claims = claimRows.map(([id, code, textIndex, cards, polarity, details]) => ({
    id,
    reason: {
      code,
      text: claimTexts[textIndex]!,
      cards,
      polarity,
      ...details,
    },
  }));
  return { ...payload, advice: { ...advice, claims } };
}

const TABLE_INSTRUCTIONS = `The payload is losslessly table-encoded. cardReferences pairs map short aliases to canonical physical card IDs; aliases replace only complete string values, not substrings. Return canonical card IDs, not aliases, in your response. Claim IDs remain unchanged.
Each claimRows row follows claimColumns. textIndex selects the exact wording in claimTexts. The details object retains all other reason fields, including archetype and pack/pick when present. Review every row; repeated wording can occur in distinct archetype contexts and must not be treated as one claim. No claims or observations were sampled or removed.`;

export function qualityReviewPrompt(task: Task) {
  const payload = task.payload;
  const advice = 'advice' in payload;
  return `${task.instructions}\n${advice ? `${TABLE_INSTRUCTIONS}\n` : ''}Task SHA-256: ${task.sha256}\n${JSON.stringify(advice ? compactAdvicePayload(payload) : payload)}\n`;
}

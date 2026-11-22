export type ForgeManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

export interface ForgeManaPaymentOption {
  readonly id: string;
  readonly payment:
    | {
        readonly kind: 'mana';
        readonly resource: string;
        readonly color: ForgeManaColor;
      }
    | { readonly kind: 'phyrexian-life' | 'cancel' | 'activation' };
}

export interface ForgeManaPaymentDecision {
  readonly unpaid: readonly string[];
  readonly options: readonly ForgeManaPaymentOption[];
}

export interface ForgeManaPaymentPlan {
  readonly move: string;
  readonly kind: 'payment' | 'cancel';
}

interface PaymentResource {
  readonly id: string;
  readonly options: readonly ForgeManaPaymentOption[];
}

const COLOR = /^[WUBRGC]$/u;
const HYBRID = /^([WUBRG])\/([WUBRG])$/u;
const PHYREXIAN = /^([WUBRG])\/P$/u;
const TWO_HYBRID = /^2\/([WUBRG])$/u;
const GENERIC = /^[1-9][0-9]*$/u;

function genericValue(shard: string): number | null {
  if (!GENERIC.test(shard)) return null;
  const value = Number(shard);
  return Number.isSafeInteger(value) ? value : null;
}

function normalizeShard(shard: string): string {
  return shard.startsWith('{') && shard.endsWith('}') ? shard.slice(1, -1) : shard;
}

function supportedShard(shard: string): boolean {
  return (
    genericValue(shard) !== null ||
    COLOR.test(shard) ||
    HYBRID.test(shard) ||
    PHYREXIAN.test(shard) ||
    TWO_HYBRID.test(shard)
  );
}

function paymentPriority(shard: string, color: ForgeManaColor): number | null {
  if (shard === color) return 10;
  const twoHybrid = TWO_HYBRID.exec(shard);
  if (twoHybrid !== null) return twoHybrid[1] === color ? 9 : 1;
  const phyrexian = PHYREXIAN.exec(shard);
  if (phyrexian !== null) return phyrexian[1] === color ? 8 : null;
  const hybrid = HYBRID.exec(shard);
  if (hybrid !== null) return hybrid[1] === color || hybrid[2] === color ? 5 : null;
  if (genericValue(shard) !== null) return 2;
  return null;
}

function payWithMana(unpaid: readonly string[], color: ForgeManaColor): readonly string[] | null {
  let selected = -1;
  let priority = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < unpaid.length; index++) {
    const candidatePriority = paymentPriority(unpaid[index] ?? '', color);
    if (candidatePriority !== null && candidatePriority > priority) {
      selected = index;
      priority = candidatePriority;
    }
  }
  if (selected < 0) return null;
  const paid = unpaid[selected] ?? '';
  const remaining = unpaid.filter((_, index) => index !== selected);
  const twoHybrid = TWO_HYBRID.exec(paid);
  if (twoHybrid !== null && twoHybrid[1] !== color) return [...remaining, '1'];
  const generic = genericValue(paid);
  if (generic !== null && generic > 1) return [...remaining, String(generic - 1)];
  return remaining;
}

function payWithLife(unpaid: readonly string[]): readonly string[] | null {
  const selected = unpaid.findIndex((shard) => PHYREXIAN.test(shard));
  return selected < 0 ? null : unpaid.filter((_, index) => index !== selected);
}

function applyPayment(unpaid: readonly string[], option: ForgeManaPaymentOption): readonly string[] | null {
  if (option.payment.kind === 'mana') return payWithMana(unpaid, option.payment.color);
  if (option.payment.kind === 'phyrexian-life') return payWithLife(unpaid);
  return null;
}

function resourcesOf(options: readonly ForgeManaPaymentOption[]): readonly PaymentResource[] {
  const grouped = new Map<string, ForgeManaPaymentOption[]>();
  for (const option of options) {
    const resource =
      option.payment.kind === 'mana'
        ? option.payment.resource
        : option.payment.kind === 'phyrexian-life'
          ? option.id
          : null;
    if (resource === null) continue;
    grouped.set(resource, [...(grouped.get(resource) ?? []), option]);
  }
  return [...grouped].map(([id, resourceOptions]) => ({ id, options: resourceOptions }));
}

function canFinish(
  unpaid: readonly string[],
  resources: readonly PaymentResource[],
  memo: Map<string, boolean>,
): boolean {
  if (unpaid.length === 0) return true;
  if (resources.length === 0) return false;
  const key = `${[...unpaid].sort().join(',')}|${resources
    .map((resource) => resource.id)
    .sort()
    .join(',')}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  for (let resourceIndex = 0; resourceIndex < resources.length; resourceIndex++) {
    const resource = resources[resourceIndex];
    if (resource === undefined) continue;
    const remainingResources = resources.filter((_, index) => index !== resourceIndex);
    for (const option of resource.options) {
      const remaining = applyPayment(unpaid, option);
      if (remaining !== null && canFinish(remaining, remainingResources, memo)) {
        memo.set(key, true);
        return true;
      }
    }
  }
  memo.set(key, false);
  return false;
}

function genericCount(unpaid: readonly string[]): number {
  return unpaid.reduce((total, shard) => total + (genericValue(shard) ?? 0), 0);
}

/**
 * Chooses one Forge payment move only when the remaining structural cost stays payable.
 *
 * Forge presents every color a permanent can produce as a separate move. Those
 * moves still consume one physical permanent, so feasibility groups them by the
 * bridge-issued resource id before looking ahead.
 */
export function planForgeManaPayment(decision: ForgeManaPaymentDecision): ForgeManaPaymentPlan | null {
  const unpaid = decision.unpaid.map(normalizeShard);
  if (unpaid.length === 0 || unpaid.some((shard) => !supportedShard(shard))) {
    return null;
  }
  const resources = resourcesOf(decision.options);
  const candidates = decision.options.flatMap((option, optionIndex) => {
    if (option.payment.kind === 'cancel' || option.payment.kind === 'activation') return [];
    const remaining = applyPayment(unpaid, option);
    if (remaining === null) return [];
    const resourceId = option.payment.kind === 'mana' ? option.payment.resource : option.id;
    const remainingResources = resources.filter((resource) => resource.id !== resourceId);
    if (!canFinish(remaining, remainingResources, new Map())) return [];
    const resource = resources.find((candidate) => candidate.id === resourceId);
    return [
      {
        option,
        optionIndex,
        paidGeneric: genericCount(remaining) < genericCount(unpaid),
        flexibility: resource?.options.length ?? 1,
        paidLife: option.payment.kind === 'phyrexian-life',
      },
    ];
  });
  candidates.sort(
    (left, right) =>
      Number(right.paidGeneric) - Number(left.paidGeneric) ||
      Number(left.paidLife) - Number(right.paidLife) ||
      left.flexibility - right.flexibility ||
      left.optionIndex - right.optionIndex,
  );
  const selected = candidates[0];
  if (selected !== undefined) return { move: selected.option.id, kind: 'payment' };
  if (
    decision.options.some(
      (option) => option.payment.kind === 'activation' || option.payment.kind === 'phyrexian-life',
    )
  ) {
    return null;
  }
  const cancellation = decision.options.find((option) => option.payment.kind === 'cancel');
  return cancellation === undefined ? null : { move: cancellation.id, kind: 'cancel' };
}

import {
  ABILITY_KINDS,
  ALL_EFFECT_KINDS,
  CARD_KINDS,
  KEYWORDS,
  MANA_COLORS,
  canonicalJson,
  cardManaValue,
  type Card,
} from '@mtg/dsl';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import {
  STEPS,
  canonicalAction,
  controllerOf,
  powerOf,
  toughnessOf,
  type Action,
  type ActionType,
  type AgentObservation,
  type AgentView,
  type Decision,
  type GameObject,
  type PlayerAgent,
  type PlayerId,
  type ZoneId,
} from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG } from './config';
import { decideGreedy } from './greedy-bot';
import {
  dotLearnedFeatures,
  sparsifyLearnedFeatures,
  validateLearnedFeatures,
  type LearnedFeatures,
} from './learned-features';

export { sparsifyLearnedFeatures } from './learned-features';
export type { LearnedFeatures, SparseLearnedFeatures } from './learned-features';

const GLOBAL_SCALAR_FEATURES = 28;
const GLOBAL_FEATURES = GLOBAL_SCALAR_FEATURES + STEPS.length;
const ZONE_SET = {
  battlefield: true,
  exile: true,
  graveyard: true,
  hand: true,
  library: true,
  stack: true,
} as const satisfies Readonly<Record<ZoneId, true>>;
const ZONE_IDS = Object.freeze(Object.keys(ZONE_SET) as ZoneId[]);
const CARD_BASE_FEATURES = 12;
const EFFECT_BUCKETS = 12;
const CARD_FINGERPRINT_BUCKETS = 64;
const CARD_FEATURES =
  CARD_BASE_FEATURES +
  CARD_KINDS.length +
  ABILITY_KINDS.length +
  KEYWORDS.length +
  MANA_COLORS.length +
  EFFECT_BUCKETS +
  CARD_FINGERPRINT_BUCKETS +
  3 +
  ZONE_IDS.length;
const BATTLEFIELD_SLOTS_PER_SEAT = 20;
const HAND_SLOTS = 10;
const HASH_BUCKETS = 8;

const ACTION_TYPE_SET = {
  activateAbility: true,
  activateManaAbility: true,
  allocateDamagePrevention: true,
  allocateDividedDamage: true,
  answerMay: true,
  answerOptionalTrigger: true,
  answerUnless: true,
  beginCastSpell: true,
  castSpell: true,
  chooseCardName: true,
  chooseDiscards: true,
  chooseEntryAuraHost: true,
  chooseEntryCharacteristics: true,
  chooseEntryColors: true,
  chooseEntryCopy: true,
  chooseEntryCounterPermanent: true,
  chooseEntryOptionalCounter: true,
  chooseEntryPayLife: true,
  chooseEntryPlayer: true,
  chooseEntryTimestampNext: true,
  chooseFromBattlefield: true,
  chooseFromGraveyard: true,
  chooseFromRevealedHand: true,
  chooseManaColor: true,
  chooseNamedZoneExile: true,
  chooseOpeningHandAction: true,
  choosePermanentToUntap: true,
  choosePluralTarget: true,
  choosePopulateToken: true,
  chooseSearchDestination: true,
  chooseSpellTargets: true,
  chooseTopLibraryPile: true,
  chooseTriggerTargets: true,
  concede: true,
  declareAttackers: true,
  declareBlockers: true,
  declineFreeCast: true,
  discard: true,
  keepHand: true,
  keepLegend: true,
  mulligan: true,
  orderAttackers: true,
  orderBlockers: true,
  orderTopLibrary: true,
  passPriority: true,
  playLand: true,
  sacrificePermanent: true,
  scry: true,
  searchLibrary: true,
  selectFromTopLibrary: true,
  separateTopLibraryPiles: true,
} as const satisfies Readonly<Record<ActionType, true>>;
const ACTION_TYPES = Object.freeze(Object.keys(ACTION_TYPE_SET) as ActionType[]);
export const LEARNED_ACTION_TYPES: readonly ActionType[] = ACTION_TYPES;
type DecisionKind = Decision['kind'];
const DECISION_KIND_SET = {
  battlefieldChoice: true,
  cardName: true,
  damagePrevention: true,
  damageAllocation: true,
  declareAttackers: true,
  declareBlockers: true,
  discard: true,
  entryAura: true,
  entryCharacteristics: true,
  entryColors: true,
  entryCopy: true,
  entryCounter: true,
  entryOptionalCounter: true,
  entryPayLife: true,
  entryPlayer: true,
  entryTimestampOrder: true,
  freeCast: true,
  graveyardChoice: true,
  handDiscard: true,
  legendRule: true,
  manaColor: true,
  may: true,
  mulligan: true,
  namedZoneExile: true,
  openingHandAction: true,
  optionalTrigger: true,
  orderAttackers: true,
  orderBlockers: true,
  permanentSacrifice: true,
  permanentUntap: true,
  populate: true,
  pluralTargets: true,
  priority: true,
  revealedHandChoice: true,
  scry: true,
  searchDestination: true,
  searchLibrary: true,
  spellTargets: true,
  topLibraryOrder: true,
  topLibraryPartition: true,
  topLibraryPile: true,
  topLibrarySelect: true,
  triggerTargets: true,
  unless: true,
} as const satisfies Readonly<Record<DecisionKind, true>>;
const DECISION_KINDS = Object.freeze(Object.keys(DECISION_KIND_SET) as DecisionKind[]);
const ACTION_SOURCE_OFFSET = DECISION_KINDS.length + ACTION_TYPES.length;
const ACTION_ARRAY_OFFSET = ACTION_SOURCE_OFFSET + CARD_FEATURES;
const ACTION_SCALAR_OFFSET = ACTION_ARRAY_OFFSET + 8;
const ACTION_FRIENDLY_OFFSET = ACTION_SCALAR_OFFSET + 4;
const ACTION_OPPOSING_OFFSET = ACTION_FRIENDLY_OFFSET + CARD_FEATURES;
const ACTION_SELECTION_COUNT_OFFSET = ACTION_OPPOSING_OFFSET + CARD_FEATURES;
const ACTION_CATEGORY_OFFSET = ACTION_SELECTION_COUNT_OFFSET + 4;
const SELECTION_SLOTS = 40;
const SELECTION_SLOT_FEATURES = 2 + CARD_FEATURES + HASH_BUCKETS;
const SCALAR_SLOTS = 32;
const SCALAR_SLOT_FEATURES = 3 + HASH_BUCKETS;
const ACTION_SELECTION_SLOTS_OFFSET = ACTION_CATEGORY_OFFSET + HASH_BUCKETS;
const ACTION_SCALAR_SLOTS_OFFSET = ACTION_SELECTION_SLOTS_OFFSET + SELECTION_SLOTS * SELECTION_SLOT_FEATURES;
const ACTION_CONTEXT_OFFSET = ACTION_SCALAR_SLOTS_OFFSET + SCALAR_SLOTS * SCALAR_SLOT_FEATURES;
const ACTION_CONTEXT_FEATURES = ACTION_TYPES.length * GLOBAL_FEATURES;
const ACTION_FEATURES = ACTION_CONTEXT_OFFSET + ACTION_CONTEXT_FEATURES;

const FEATURE_DESCRIPTOR = {
  id: 'native-action-q/v1',
  layout: {
    global: GLOBAL_FEATURES,
    card: CARD_FEATURES,
    battlefieldSlotsPerSeat: BATTLEFIELD_SLOTS_PER_SEAT,
    handSlots: HAND_SLOTS,
    action: ACTION_FEATURES,
    actionLayout: {
      decisionKinds: DECISION_KINDS.length,
      actionTypes: ACTION_TYPES.length,
      sourceCardPrefix: CARD_FEATURES,
      arrayCounts: 8,
      scalars: 4,
      friendlySelection: CARD_FEATURES,
      opposingSelection: CARD_FEATURES,
      selectionCounts: 4,
      categoricalBuckets: HASH_BUCKETS,
      orderedSelectionSlots: SELECTION_SLOTS,
      orderedSelectionWidth: SELECTION_SLOT_FEATURES,
      orderedScalarSlots: SCALAR_SLOTS,
      orderedScalarWidth: SCALAR_SLOT_FEATURES,
      actionContextWidth: GLOBAL_FEATURES,
    },
    hashBuckets: HASH_BUCKETS,
  },
  vocabulary: {
    abilityKinds: ABILITY_KINDS,
    cardKinds: CARD_KINDS,
    effectKinds: ALL_EFFECT_KINDS,
    keywords: KEYWORDS,
    manaColors: MANA_COLORS,
    actionTypes: ACTION_TYPES,
    decisionKinds: DECISION_KINDS,
    steps: STEPS,
    zones: ZONE_IDS,
  },
} as const;

export const LEARNED_FEATURE_SCHEMA = Object.freeze({
  id: FEATURE_DESCRIPTOR.id,
  size:
    GLOBAL_FEATURES +
    CARD_FEATURES * HAND_SLOTS +
    CARD_FEATURES * BATTLEFIELD_SLOTS_PER_SEAT * 2 +
    ACTION_FEATURES,
  sha256: botEvidenceSha256(FEATURE_DESCRIPTOR),
});

function bucket(text: string, width = HASH_BUCKETS): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % width;
}

function finiteRatio(value: number, scale: number): number {
  return Number.isFinite(value) ? Math.max(-4, Math.min(4, value / scale)) : 0;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function countEffectKinds(value: unknown, counts: Float64Array, visited: Set<object>): void {
  if (typeof value !== 'object' || value === null || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const member of value) countEffectKinds(member, counts, visited);
    return;
  }
  const item = value as Readonly<Record<string, unknown>>;
  const kind = item['kind'];
  if (typeof kind === 'string' && (ALL_EFFECT_KINDS as readonly string[]).includes(kind)) {
    const index = bucket(kind, counts.length);
    counts[index] = (counts[index] ?? 0) + 1;
  }
  for (const member of Object.values(item)) countEffectKinds(member, counts, visited);
}

function printedNumber(card: Card, field: 'power' | 'toughness'): number {
  const value = (card as Readonly<Record<string, unknown>>)[field];
  return typeof value === 'number' ? value : 0;
}

function counterTotal(object: GameObject): number {
  return Object.values(object.counters).reduce((total, value) => total + value, 0);
}

function cardFeatures(
  state: AgentObservation,
  object: GameObject | undefined,
  viewer: PlayerId,
): Float64Array {
  const features = new Float64Array(CARD_FEATURES);
  if (object === undefined) return features;
  const card = object.faceCard ?? object.card;
  const battlefield = object.zone === 'battlefield';
  features[0] = 1;
  features[1] = finiteRatio(cardManaValue(card), 10);
  features[2] = finiteRatio(battlefield ? powerOf(state, object.oid) : printedNumber(card, 'power'), 20);
  features[3] = finiteRatio(
    battlefield ? toughnessOf(state, object.oid) : printedNumber(card, 'toughness'),
    20,
  );
  features[4] = object.tapped ? 1 : 0;
  features[5] = object.summoningSick ? 1 : 0;
  features[6] = finiteRatio(object.damage, 20);
  features[7] = object.token ? 1 : 0;
  features[8] = finiteRatio(counterTotal(object), 10);
  const cardRecord = card as Readonly<Record<string, unknown>>;
  const abilities = Array.isArray(cardRecord['abilities']) ? cardRecord['abilities'] : [];
  const keywords = Array.isArray(cardRecord['keywords']) ? cardRecord['keywords'] : [];
  const colors = Array.isArray(cardRecord['colors']) ? cardRecord['colors'] : [];
  features[9] = finiteRatio(abilities.length, 10);
  features[10] = finiteRatio(keywords.length, 10);
  features[11] = finiteRatio(colors.length, 5);
  let offset = CARD_BASE_FEATURES;
  features[offset + CARD_KINDS.indexOf(card.kind)] = 1;
  offset += CARD_KINDS.length;
  for (const ability of abilities) {
    const kind = record(ability)?.['kind'];
    if (typeof kind === 'string') {
      const index = (ABILITY_KINDS as readonly string[]).indexOf(kind);
      if (index >= 0) features[offset + index] = (features[offset + index] ?? 0) + 1;
    }
  }
  offset += ABILITY_KINDS.length;
  for (const keyword of keywords) {
    const index = (KEYWORDS as readonly unknown[]).indexOf(keyword);
    if (index >= 0) features[offset + index] = 1;
  }
  offset += KEYWORDS.length;
  for (const color of colors) {
    const index = (MANA_COLORS as readonly unknown[]).indexOf(color);
    if (index >= 0) features[offset + index] = 1;
  }
  offset += MANA_COLORS.length;
  const effectCounts = new Float64Array(EFFECT_BUCKETS);
  countEffectKinds(card, effectCounts, new Set<object>());
  for (let index = 0; index < EFFECT_BUCKETS; index += 1) {
    features[offset + index] = finiteRatio(effectCounts[index] ?? 0, 4);
  }
  offset += EFFECT_BUCKETS;
  const { id: _id, name: _name, ...rules } = card as Card & Readonly<Record<string, unknown>>;
  features[offset + bucket(canonicalJson(rules), CARD_FINGERPRINT_BUCKETS)] = 1;
  offset += CARD_FINGERPRINT_BUCKETS;
  features[offset] = object.attachedTo === undefined ? 0 : 1;
  features[offset + 1] = object.owner === viewer ? 1 : -1;
  features[offset + 2] = controllerOf(state, object.oid) === viewer ? 1 : -1;
  features[offset + 3 + ZONE_IDS.indexOf(object.zone)] = 1;
  return features;
}

function write(target: Float64Array, offset: number, values: ArrayLike<number>, limit = values.length): void {
  const count = Math.min(limit, values.length);
  for (let index = 0; index < count; index += 1) target[offset + index] = values[index] ?? 0;
}

function globalFeatures(state: AgentObservation, viewer: PlayerId): Float64Array {
  const opponent = viewer === 0 ? 1 : 0;
  const me = state.players[viewer];
  const them = state.players[opponent];
  const result = new Float64Array(GLOBAL_FEATURES);
  const numbers = [
    me.life,
    them.life,
    me.hand.length,
    them.hand.length,
    me.library.length,
    them.library.length,
    me.graveyard.length,
    them.graveyard.length,
    state.battlefield.filter((oid) => state.objects[oid]?.controller === viewer).length,
    state.battlefield.filter((oid) => state.objects[oid]?.controller === opponent).length,
    state.stack.length,
    state.turn.number,
    me.mulligans,
    them.mulligans,
    ...MANA_COLORS.map((color) => me.pool[color]),
    ...MANA_COLORS.map((color) => them.pool[color]),
  ];
  numbers.forEach((value, index) => {
    result[index] = finiteRatio(value, index < 2 ? 20 : index === 11 ? 20 : 10);
  });
  result[26] = state.turn.active === viewer ? 1 : -1;
  result[27] = state.turn.priority === null ? 0 : state.turn.priority === viewer ? 1 : -1;
  result[GLOBAL_SCALAR_FEATURES + STEPS.indexOf(state.turn.step)] = 1;
  return result;
}

function actionSource(action: Action): string | null {
  const value = record(action);
  const oid = value?.['oid'];
  return typeof oid === 'string' ? oid : null;
}

interface ActionSelections {
  readonly objects: ReadonlySet<string>;
  readonly playerCounts: readonly [number, number];
  readonly categorical: Float64Array;
  readonly ordered: readonly OrderedSelection[];
  readonly scalars: readonly OrderedScalar[];
}

type OrderedSelection =
  | { readonly kind: 'object'; readonly oid: string; readonly path: string }
  | { readonly kind: 'player'; readonly player: PlayerId; readonly path: string };

type OrderedScalar =
  | { readonly kind: 'number'; readonly value: number; readonly path: string }
  | { readonly kind: 'boolean'; readonly value: boolean; readonly path: string };

const PLAYER_FIELDS = new Set(['chosen', 'defender', 'player']);

function actionSelections(state: AgentObservation, action: Action, source: string | null): ActionSelections {
  const objects = new Set<string>();
  const playerCounts: [number, number] = [0, 0];
  const categorical = new Float64Array(HASH_BUCKETS);
  const ordered: OrderedSelection[] = [];
  const scalars: OrderedScalar[] = [];
  const visit = (value: unknown, key: string, root: boolean, path: string): void => {
    if (typeof value === 'string') {
      if (state.objects[value] !== undefined) {
        if (value !== source) {
          objects.add(value);
          ordered.push({ kind: 'object', oid: value, path });
        }
      } else if (key !== 'type' && key !== 'name') {
        const index = bucket(`${key}:${value}`);
        categorical[index] = (categorical[index] ?? 0) + 1;
      }
      return;
    }
    if (typeof value === 'number' && !root && PLAYER_FIELDS.has(key) && (value === 0 || value === 1)) {
      playerCounts[value] += 1;
      ordered.push({ kind: 'player', player: value, path });
      return;
    }
    if (typeof value === 'number' && !root) {
      scalars.push({ kind: 'number', value, path });
      return;
    }
    if (typeof value === 'boolean') {
      scalars.push({ kind: 'boolean', value, path });
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((member, index) => visit(member, key, false, `${path}[${String(index)}]`));
      return;
    }
    for (const [childKey, member] of Object.entries(value)) {
      if (root && childKey === 'player') continue;
      visit(member, childKey, false, path === '' ? childKey : `${path}.${childKey}`);
    }
  };
  visit(canonicalAction(action), '', true, '');
  return { objects, playerCounts, categorical, ordered, scalars };
}

function selectedObjectFeatures(
  state: AgentObservation,
  viewer: PlayerId,
  objectIds: ReadonlySet<string>,
  friendly: boolean,
): { readonly count: number; readonly features: Float64Array } {
  const features = new Float64Array(CARD_FEATURES);
  let count = 0;
  for (const oid of objectIds) {
    const object = state.objects[oid];
    if (object === undefined || (controllerOf(state, oid) === viewer) !== friendly) continue;
    count += 1;
    const selected = cardFeatures(state, object, viewer);
    for (let index = 0; index < CARD_FEATURES; index += 1) {
      features[index] = (features[index] ?? 0) + (selected[index] ?? 0);
    }
  }
  if (count > 1) {
    for (let index = 0; index < CARD_FEATURES; index += 1) features[index] = (features[index] ?? 0) / count;
  }
  return { count, features };
}

function actionFeatures(
  state: AgentObservation,
  viewer: PlayerId,
  decisionKind: DecisionKind,
  action: Action,
): Float64Array {
  const features = new Float64Array(ACTION_FEATURES);
  features[DECISION_KINDS.indexOf(decisionKind)] = 1;
  features[DECISION_KINDS.length + ACTION_TYPES.indexOf(action.type)] = 1;
  const source = actionSource(action);
  const sourceFeatures =
    source === null ? new Float64Array(CARD_FEATURES) : cardFeatures(state, state.objects[source], viewer);
  write(features, ACTION_SOURCE_OFFSET, sourceFeatures);
  const value = action as unknown as Readonly<Record<string, unknown>>;
  const arrays = ['attackers', 'blocks', 'orders', 'oids', 'targets', 'sacrifices', 'discards', 'taps'];
  arrays.forEach((field, index) => {
    const member = value[field];
    features[ACTION_ARRAY_OFFSET + index] = Array.isArray(member) ? finiteRatio(member.length, 10) : 0;
  });
  features[ACTION_SCALAR_OFFSET] = typeof value['x'] === 'number' ? finiteRatio(value['x'], 10) : 0;
  features[ACTION_SCALAR_OFFSET + 1] =
    typeof value['mode'] === 'number' ? finiteRatio(value['mode'] + 1, 10) : 0;
  features[ACTION_SCALAR_OFFSET + 2] = value['accept'] === true || value['keep'] === true ? 1 : 0;
  features[ACTION_SCALAR_OFFSET + 3] = value['target'] === null || value['oid'] === null ? -1 : 0;
  const selections = actionSelections(state, action, source);
  const friendly = selectedObjectFeatures(state, viewer, selections.objects, true);
  const opposing = selectedObjectFeatures(state, viewer, selections.objects, false);
  write(features, ACTION_FRIENDLY_OFFSET, friendly.features);
  write(features, ACTION_OPPOSING_OFFSET, opposing.features);
  features[ACTION_SELECTION_COUNT_OFFSET] = finiteRatio(friendly.count, 10);
  features[ACTION_SELECTION_COUNT_OFFSET + 1] = finiteRatio(opposing.count, 10);
  features[ACTION_SELECTION_COUNT_OFFSET + 2] = finiteRatio(selections.playerCounts[viewer], 4);
  features[ACTION_SELECTION_COUNT_OFFSET + 3] = finiteRatio(selections.playerCounts[viewer === 0 ? 1 : 0], 4);
  write(features, ACTION_CATEGORY_OFFSET, selections.categorical);
  selections.ordered.slice(0, SELECTION_SLOTS).forEach((selection, index) => {
    const offset = ACTION_SELECTION_SLOTS_OFFSET + index * SELECTION_SLOT_FEATURES;
    if (selection.kind === 'object') {
      features[offset] = 1;
      write(features, offset + 2, cardFeatures(state, state.objects[selection.oid], viewer));
    } else {
      features[offset + 1] = selection.player === viewer ? 1 : -1;
    }
    features[offset + 2 + CARD_FEATURES + bucket(selection.path)] = 1;
  });
  selections.scalars.slice(0, SCALAR_SLOTS).forEach((scalar, index) => {
    const offset = ACTION_SCALAR_SLOTS_OFFSET + index * SCALAR_SLOT_FEATURES;
    features[offset] = scalar.kind === 'number' ? 1 : 0;
    features[offset + 1] = scalar.kind === 'boolean' ? 1 : 0;
    features[offset + 2] = scalar.kind === 'number' ? finiteRatio(scalar.value, 20) : scalar.value ? 1 : -1;
    features[offset + 3 + bucket(scalar.path)] = 1;
  });
  const actionTypeIndex = ACTION_TYPES.indexOf(action.type);
  write(features, ACTION_CONTEXT_OFFSET + actionTypeIndex * GLOBAL_FEATURES, globalFeatures(state, viewer));
  return features;
}

/** Fixed observation/action encoding. It never reads privileged kernel state. */
export function encodeLearnedCandidate(view: AgentView, action: Action): Float64Array {
  const result = new Float64Array(LEARNED_FEATURE_SCHEMA.size);
  write(result, 0, globalFeatures(view.state, view.player));
  let offset = GLOBAL_FEATURES;
  const hand = view.state.players[view.player].hand
    .map((oid) => view.state.objects[oid])
    .filter((object): object is GameObject => object !== undefined)
    .map((object) => cardFeatures(view.state, object, view.player))
    .toSorted((left, right) => {
      for (let index = 0; index < CARD_FEATURES; index += 1) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference !== 0) return difference;
      }
      return 0;
    });
  for (const features of hand.slice(0, HAND_SLOTS)) {
    write(result, offset, features);
    offset += CARD_FEATURES;
  }
  offset += CARD_FEATURES * (HAND_SLOTS - Math.min(hand.length, HAND_SLOTS));
  for (const seat of [view.player, view.player === 0 ? 1 : 0] as const) {
    const objects = view.state.battlefield
      .map((oid) => view.state.objects[oid])
      .filter(
        (object): object is GameObject =>
          object !== undefined && controllerOf(view.state, object.oid) === seat,
      )
      .map((object) => ({ object, features: cardFeatures(view.state, object, view.player) }))
      .toSorted((left, right) => {
        for (let index = 0; index < CARD_FEATURES; index += 1) {
          const difference = (left.features[index] ?? 0) - (right.features[index] ?? 0);
          if (difference !== 0) return difference;
        }
        return 0;
      });
    for (const entry of objects.slice(0, BATTLEFIELD_SLOTS_PER_SEAT)) {
      write(result, offset, entry.features);
      offset += CARD_FEATURES;
    }
    offset +=
      CARD_FEATURES * (BATTLEFIELD_SLOTS_PER_SEAT - Math.min(objects.length, BATTLEFIELD_SLOTS_PER_SEAT));
  }
  write(result, offset, actionFeatures(view.state, view.player, view.decision.kind, action));
  return result;
}

export interface LearnedModelPayload {
  readonly schemaVersion: 2;
  readonly featureSchemaSha256: string;
  readonly inputSize: number;
  readonly hiddenSize: number;
  readonly directWeights: readonly number[];
  readonly inputWeights: readonly number[];
  readonly hiddenBias: readonly number[];
  readonly outputWeights: readonly number[];
  readonly outputBias: number;
}

export interface LearnedModelArtifact extends LearnedModelPayload {
  readonly sha256: string;
}

export function learnedModelSha256(payload: LearnedModelPayload): string {
  return botEvidenceSha256(payload);
}

function finiteArray(name: string, values: readonly number[], length: number): void {
  if (values.length !== length)
    throw new Error(`${name} length ${String(values.length)} does not match ${String(length)}`);
  if (!values.every(Number.isFinite)) throw new Error(`${name} contains a non-finite value`);
}

export interface LearnedModel {
  readonly sha256: string;
  score(features: LearnedFeatures): number;
}

/** Validate and load a deterministic one-hidden-layer ReLU scorer. */
export function createLearnedModel(artifact: LearnedModelArtifact): LearnedModel {
  if (artifact.schemaVersion !== 2)
    throw new Error(`unsupported learned model schema ${String(artifact.schemaVersion)}`);
  if (artifact.featureSchemaSha256 !== LEARNED_FEATURE_SCHEMA.sha256) {
    throw new Error('learned model feature schema does not match the current DSL vocabulary');
  }
  if (
    artifact.inputSize !== LEARNED_FEATURE_SCHEMA.size ||
    !Number.isInteger(artifact.hiddenSize) ||
    artifact.hiddenSize < 1
  ) {
    throw new Error('learned model dimensions do not match the feature schema');
  }
  finiteArray('inputWeights', artifact.inputWeights, artifact.inputSize * artifact.hiddenSize);
  finiteArray('directWeights', artifact.directWeights, artifact.inputSize);
  finiteArray('hiddenBias', artifact.hiddenBias, artifact.hiddenSize);
  finiteArray('outputWeights', artifact.outputWeights, artifact.hiddenSize);
  if (!Number.isFinite(artifact.outputBias)) throw new Error('outputBias contains a non-finite value');
  const { sha256: _sha256, ...payload } = artifact;
  if (learnedModelSha256(payload) !== artifact.sha256)
    throw new Error('learned model digest does not match its payload');
  const inputWeights = Float64Array.from(artifact.inputWeights);
  const directWeights = Float64Array.from(artifact.directWeights);
  const hiddenBias = Float64Array.from(artifact.hiddenBias);
  const outputWeights = Float64Array.from(artifact.outputWeights);
  const inputSize = artifact.inputSize;
  const hiddenSize = artifact.hiddenSize;
  const outputBias = artifact.outputBias;
  return Object.freeze({
    sha256: artifact.sha256,
    score(features: LearnedFeatures): number {
      validateLearnedFeatures(features, inputSize);
      let output = outputBias + dotLearnedFeatures(directWeights, features);
      for (let hidden = 0; hidden < hiddenSize; hidden += 1) {
        const row = hidden * inputSize;
        const activation = (hiddenBias[hidden] ?? 0) + dotLearnedFeatures(inputWeights, features, row);
        if (!Number.isFinite(activation)) throw new Error('learned model produced a non-finite activation');
        output += Math.max(0, activation) * (outputWeights[hidden] ?? 0);
        if (!Number.isFinite(output)) throw new Error('learned model produced a non-finite output');
      }
      return output;
    },
  });
}

/** Action-conditioned native policy with the frozen greedy policy as its incomplete-enumeration fallback. */
export function learnedBot(
  name: string,
  artifact: LearnedModelArtifact,
  fallbackConfig = DEFAULT_GREEDY_CONFIG,
): PlayerAgent {
  const model = createLearnedModel(artifact);
  return {
    name,
    decide(view: AgentView): Action {
      if (!view.decision.complete || view.decision.options.length < 2 || view.decision.kind === 'cardName') {
        return decideGreedy(view, fallbackConfig);
      }
      const first = view.decision.options[0];
      if (first === undefined) throw new Error('learned bot received a complete decision with no options');
      let best = first;
      let bestScore = model.score(sparsifyLearnedFeatures(encodeLearnedCandidate(view, first)));
      for (const option of view.decision.options.slice(1)) {
        const score = model.score(sparsifyLearnedFeatures(encodeLearnedCandidate(view, option)));
        if (score > bestScore) {
          best = option;
          bestScore = score;
        }
      }
      return best;
    },
  };
}

/**
 * Test support: a scripted transport and a deterministic card synthesizer.
 *
 * Tests never call a model. They run the real pipeline against the real fixture
 * provider in record mode, with this transport standing in for the backend, and
 * then replay the recorded files with no transport at all. That exercises the
 * fixture path end to end (key derivation, recording, replay) while staying
 * hermetic and free.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Color, ModelAbility, ModelEffect, ModelEffectKind } from '@mtg/dsl';
import { COLORS, isModelEffectKind } from '@mtg/dsl';
import type { SliceRarityRules } from '@mtg/design-data';
import { SLICE_RARITIES } from '@mtg/design-data';
import type { LlmTransport, RawRequest, RawResponse } from '@mtg/llm';
import type { Critique, CritiqueRevision, FilledCard, SetBrief, SetBriefInput, Slot } from '@mtg/setgen';
import { CRITIQUE_SYSTEM, derivePins, parseBrief, poolLetter, rarityPolicy, slotId } from '@mtg/setgen';

/**
 * The slot-code prefix, built out of the allocator's own `slotId` rather than
 * typed out.
 *
 * It was typed out, as `[CU][WUBRGA]`, and when `mtg-bc2.26.4` added a rare tier
 * that was the one place in the package that did not follow `SLICE_RARITIES`.
 * Rare codes read `RA01`, the class did not match them, and the transport below
 * silently stopped reading required-card names off rare slots — which surfaced
 * as `REQUIRED_CARD_MISSING` on a finished set, three layers from the regex.
 * Derived, a fourth tier costs nothing here.
 */
const SLOT_CODE_SOURCE = `^([${SLICE_RARITIES.map((rarity) => slotId(rarity, null, 1).charAt(0)).join('')}][${[
  ...COLORS,
  null,
]
  .map(poolLetter)
  .join('')}]\\d{2}):`;

const BRIEFS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'briefs');

/**
 * A shipped brief, loaded the way a run loads it.
 *
 * The rarity a brief states is a ceiling rather than a coordinate, because the
 * skeleton derives its rare tier per set size: the flagship's marquee cards are
 * pinned `rare` and a 75-card build has no rare tier to seat them in. So every
 * reader of a brief file goes through `derivePins` — the CLI, `generateSet` and
 * these tests alike — or the same file reads as placeable to one of them and
 * unplaceable to the next, which is `mtg-mj5m` with the blame moved.
 */
export function briefFromFile(name: string, targetSize?: number): SetBrief {
  const raw = JSON.parse(readFileSync(join(BRIEFS_DIR, name), 'utf8')) as Record<string, unknown>;
  return derivePins(parseBrief(targetSize === undefined ? raw : { ...raw, targetSize })).brief;
}

/**
 * Every brief committed under `briefs/`, sorted.
 *
 * A sweep that names its members stops covering the corpus the first time
 * somebody adds a brief, and a public test file that names one of them exports a
 * citation of a file the export renames (`slice`'s public-boundary gate). Both
 * problems go away when the directory is the list.
 */
export function shippedBriefNames(): readonly string[] {
  return readdirSync(BRIEFS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

/** The slots at every tier the profile's rules do not call a bomb tier. */
export function belowBombLine(slots: readonly Slot[], rules: SliceRarityRules): readonly Slot[] {
  return slots.filter((slot) => !rarityPolicy(slot.rarity, rules).bomb);
}

/**
 * A stable digest of a slot list, for pinning an allocation that must not move.
 *
 * Written for `mtg-tqkc`, whose acceptance criterion is a sentence about a whole
 * allocation — "every tier below the bomb line is byte-identical" — and a spot
 * check of four fields on four slots is not that sentence. A keyword that moved
 * three tiers away, an effect budget that shifted, a role that changed card kind:
 * every one of those passes a spot check and none of them passes this. Keys are
 * sorted rather than trusted to construction order, so a refactor that reorders
 * an object literal reads as what it is rather than as an allocation change.
 */
export function slotDigest(slots: readonly Slot[]): string {
  return createHash('sha256').update(canonicalJson(slots), 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A shipped brief exactly as its file states it, before any derivation. */
export function briefInputFromFile(name: string): SetBriefInput {
  return JSON.parse(readFileSync(join(BRIEFS_DIR, name), 'utf8')) as SetBriefInput;
}

export const TEST_BRIEF: SetBriefInput = {
  setCode: 'TST',
  setName: 'Testing Shoals',
  theme: 'A small proving ground of tide pools and glass reefs, used to exercise the generator.',
  seed: 'fixture-seed-1',
  targetSize: 20,
  mechanics: [
    {
      name: 'Skywake',
      description: 'Evasive fliers hold the air while the ground stalls.',
      keywords: ['flying'],
      colors: ['W', 'U'],
    },
    {
      name: 'Glasscut',
      description: 'Efficient trades: small bodies that kill bigger ones, plus reach damage.',
      keywords: ['deathtouch'],
      effectKinds: ['dealDamage'],
      colors: ['B', 'R'],
    },
    {
      name: 'Rootbound',
      description: 'Large bodies that grow past blockers.',
      keywords: ['trample'],
      effectKinds: ['pumpUntilEndOfTurn'],
      colors: ['G'],
    },
  ],
  archetypeNotes: ['WU flies over a stalled board.', 'BR trades efficiently and burns the last points.'],
};

/**
 * A mechanic that reaches the colorless pool, for the tests that build a set big
 * enough to have one.
 *
 * `TEST_BRIEF`'s three mechanics all name colors, and a mechanic that names
 * colors lives only in them (`appliesToPool`). Below about a hundred cards that
 * costs nothing, because the profile allocates no colorless noncreature slot;
 * above it the pool's roles are `manaArtifact` and `landFixing`, which
 * `colorlessEffectKinds` gives no effect and which no brief mechanic then gives
 * an ability, so every one of them is a mana cost with nothing under it and
 * `checkSlotFillability` refuses the allocation before a call is made.
 *
 * Stated as `static` on purpose: `redFlagsFor` charges no New World Order flag
 * for one, so a test brief that needs the colorless pool to be fillable does not
 * also have to re-budget its commons. `TEST_BRIEF` itself is left alone, because
 * a mechanic naming no colors reaches all six pools and every test that measures
 * what the twenty-card set tells the model would move with it.
 */
export const COLORLESS_MECHANIC: SetBriefInput['mechanics'][number] = {
  name: 'Glasswork',
  description: 'Artifacts of fused reef glass that quietly change what the board is worth.',
  abilityKinds: ['static'],
  colors: [],
};

/** The `<slots>` block is the authoritative list of what a fill call must answer. */
export function slotIdsInPrompt(prompt: string): string[] {
  const section = /<slots>\n([\s\S]*?)\n<\/slots>/.exec(prompt);
  if (section?.[1] === undefined) return [];
  return [...section[1].matchAll(new RegExp(SLOT_CODE_SOURCE, 'gm'))].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/**
 * The names the prompt says specific slots must print.
 *
 * Read out of the prompt rather than off the slot objects on purpose: a
 * required card only reaches a live model through the prompt, so a test whose
 * transport answered from the allocation would pass with the prompt saying
 * nothing at all.
 */
export function requiredNamesInPrompt(prompt: string): Map<string, string> {
  const names = new Map<string, string>();
  let current: string | undefined;
  for (const line of prompt.split('\n')) {
    const slot = new RegExp(SLOT_CODE_SOURCE).exec(line);
    if (slot?.[1] !== undefined) {
      current = slot[1];
      continue;
    }
    const required = /^ {2}name: exactly "(.+?)"/.exec(line);
    if (required?.[1] !== undefined && current !== undefined) names.set(current, required[1]);
  }
  return names;
}

/**
 * Subtypes have to be unique per slot, or two slots with the same cost and body
 * become functional reprints and the DSL's own uniqueness pass rejects the set.
 * Digits are illegal in a subtype, so the slot code is letter-encoded.
 */
function subtypeFor(slot: Slot): string {
  const encoded = [...slot.id.toLowerCase()]
    .map((character) => (character >= '0' && character <= '9' ? 'abcdefghij'[Number(character)] : character))
    .join('');
  return `Warden${encoded.charAt(0).toUpperCase()}${encoded.slice(1)}`;
}

/** Numeric parameters vary per slot so no two spells collapse into one card. */
function effectFor(kind: ModelEffectKind, colors: readonly Color[], nonce: number): ModelEffect {
  switch (kind) {
    case 'dealDamage':
      return { kind, amount: 1 + (nonce % 4), target: { kind: 'anyTarget' } };
    case 'destroyPermanent':
      return { kind, target: { kind: 'targetCreature' } };
    case 'pumpUntilEndOfTurn':
      return { kind, power: 1 + (nonce % 3), toughness: 1 + (nonce % 2), target: { kind: 'targetCreature' } };
    case 'drawCards':
      return { kind, count: 1 + (nonce % 3), target: { kind: 'noTarget' } };
    case 'gainLife':
      return { kind, amount: 2 + (nonce % 5), target: { kind: 'noTarget' } };
    case 'counterSpell':
      return { kind };
    case 'createToken':
      return {
        kind,
        count: 1,
        token: {
          name: 'Glass Shard',
          power: 1 + (nonce % 3),
          toughness: 2,
          colors: [...colors],
          subtypes: ['Elemental'],
          keywords: [],
        },
      };
    case 'tapPermanent':
      return { kind, target: { kind: 'targetCreature' } };
    case 'returnToHand':
      return { kind, target: { kind: 'targetCreature' } };
    case 'millCards':
      return { kind, count: 2 + (nonce % 4), target: { kind: 'targetPlayer' } };
  }
}

/**
 * The printed ability a slot the allocator reserved one on comes back with.
 *
 * A permanent slot carrying `abilityKinds` and a card carrying none is
 * `SLOT_ABILITY_NOT_ALLOWED`, so before this the scripted transport could not
 * answer a brief that stated a mechanic as an ability at all. It answers with
 * the plainest thing that satisfies the slot: one trigger, one effect that
 * chooses nothing and sits on every color's pie.
 *
 * The condition is the slot's first stated one, and `selfDies` when the slot
 * states none. That second half is not a coin flip dressed up as a default - it
 * is this harness standing in for what the live runs did, where every trigger
 * the flagship printed watched for a permanent dying. It is what makes
 * `triggerConditions` provable here: the same brief with and without the field
 * prints a different condition, and the difference is the field.
 *
 * `static` is answered too, and it has to be: `fillTextlessPermanents` and
 * `rescueUnfillablePermanents` both reserve that kind rather than a triggered
 * one, because a static costs no New World Order budget. Before `mtg-dkgd` the
 * colorless pool was small enough that no test brief reached a rescued gear
 * slot; paying the pool its share does, and a harness that answered a static
 * slot with nothing was failing those slots on `SLOT_ABILITY_NOT_ALLOWED` -
 * the harness's gap, reported as the allocator's.
 *
 * The answer is an anthem, for the same reason the triggered answer is a
 * two-life gain: it is the plainest modification in the vocabulary, it targets
 * nothing, and it sits on every color's pie, so it says nothing about the slot
 * beyond satisfying it.
 */
function abilityFor(slot: Slot): ModelAbility[] {
  if (slot.abilityKinds.includes('triggered')) {
    const condition = slot.triggerConditions[0] ?? 'selfDies';
    return [
      {
        kind: 'triggered',
        condition,
        effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
      },
    ];
  }
  if (slot.abilityKinds.includes('static')) {
    return [
      {
        kind: 'static',
        scope: 'creaturesYouControl',
        subtype: null,
        modification: { kind: 'statBonus', power: 1, toughness: 1 },
      },
    ];
  }
  return [];
}

export interface SynthesisOptions {
  /** Shift the mana value out of the slot's window, to force a validation retry. */
  readonly breakManaValue?: boolean;
  readonly namePrefix?: string;
  /** Print this exact name, as a slot reserved for a required card demands. */
  readonly name?: string;
}

/** A card that satisfies every slot constraint, unless told to break one. */
export function synthesizeCard(slot: Slot, options: SynthesisOptions = {}): FilledCard {
  const manaValue = options.breakManaValue === true ? slot.manaValueMax + 3 : slot.manaValueMin;
  const colored = slot.color === null ? 0 : 1;
  const manaCost = {
    generic: Math.max(0, manaValue - colored),
    W: slot.color === 'W' ? 1 : 0,
    U: slot.color === 'U' ? 1 : 0,
    B: slot.color === 'B' ? 1 : 0,
    R: slot.color === 'R' ? 1 : 0,
    G: slot.color === 'G' ? 1 : 0,
  };
  const name = options.name ?? `${options.namePrefix ?? 'Glass'} Warden ${slot.id}`;
  const designNote = `Synthesized for ${slot.id} (${slot.role}).`;

  const abilities = abilityFor(slot);
  if (slot.cardKind === 'creature') {
    return {
      slotId: slot.id,
      kind: 'creature',
      name,
      subtypes: [subtypeFor(slot)],
      manaCost,
      power: Math.max(1, manaValue - 1),
      toughness: Math.max(1, manaValue),
      designNote,
      ...(abilities.length === 0 ? {} : { abilities }),
    };
  }
  if (slot.cardKind === 'artifact') {
    return {
      slotId: slot.id,
      kind: 'artifact',
      name,
      subtypes: [subtypeFor(slot)],
      manaCost,
      designNote,
      ...(abilities.length === 0 ? {} : { abilities }),
    };
  }
  // A slot's allowed kinds come from a brief, which may name any pinned effect
  // kind; the generator may only answer with the ones in the model's schema, so
  // the fixture card is built from the first kind that is in both.
  const kind = slot.effectKinds.find(isModelEffectKind);
  if (kind === undefined) {
    throw new Error(`synthesizeCard: spell slot ${slot.id} has no allowed effect kind the model can print`);
  }
  return {
    slotId: slot.id,
    kind: slot.cardKind === 'instant' ? 'instant' : 'sorcery',
    name,
    manaCost,
    effects: [effectFor(kind, slot.color === null ? [] : [slot.color], slot.collectorNumber)],
    designNote,
  };
}

export interface ScriptOptions {
  readonly slots: readonly Slot[];
  /** Slots whose first fill returns an off-curve card, forcing a retry round. */
  readonly failFirstFor?: readonly string[];
  /** Slots whose critique revision returns an off-curve card, forcing a revert. */
  readonly breakRevisionFor?: readonly string[];
  readonly revisions?: readonly CritiqueRevision[];
  /** Answer with invented names even where the prompt required one, as a bad model would. */
  readonly ignoreRequiredNames?: boolean;
  /** Slots whose FIRST fill invents a name the prompt required, forcing a retry round. */
  readonly renameFirstFor?: readonly string[];
  /** Slots whose critique revision renames the required card it was reserved for. */
  readonly renameRevisionFor?: readonly string[];
}

export interface ScriptedTransport extends LlmTransport {
  readonly callCounts: ReadonlyMap<string, number>;
  /** Every prompt the transport was sent, in order, for tests about what the model was told. */
  readonly prompts: readonly string[];
}

/** A backend stand-in that answers fill and critique calls from the allocation. */
export function scriptedTransport(options: ScriptOptions): ScriptedTransport {
  const bySlot = new Map(options.slots.map((slot) => [slot.id, slot]));
  const failFirst = new Set(options.failFirstFor ?? []);
  const breakRevision = new Set(options.breakRevisionFor ?? []);
  const renameFirst = new Set(options.renameFirstFor ?? []);
  const renameRevision = new Set(options.renameRevisionFor ?? []);
  const callCounts = new Map<string, number>();
  const prompts: string[] = [];

  const critique: Critique = {
    cohesion: 'The set reads as one place: glass, tide and pressure recur across every color.',
    archetypeSupport: 'WU and BR are supported; GW has bodies but few ways to break a stall.',
    flavorConsistency: 'Names and creature types stay inside the stated world.',
    powerOutliers: 'Nothing is outside the Limited power band for its mana value.',
    revisions: [...(options.revisions ?? [])],
  };

  return {
    name: 'fixture',
    model: 'scripted-test-transport',
    callCounts,
    prompts,
    async send(request: RawRequest): Promise<RawResponse> {
      prompts.push(request.prompt);
      const body = request.system === CRITIQUE_SYSTEM ? critique : { cards: fillFor(request.prompt) };
      return Promise.resolve({
        text: JSON.stringify(body),
        usage: { inputTokens: 400, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        costUsd: 0.001,
        costSource: 'estimated',
        model: 'scripted-test-transport',
      });
    },
  };

  function fillFor(prompt: string): FilledCard[] {
    const revising = prompt.includes('<design_review>');
    const required =
      options.ignoreRequiredNames === true ? new Map<string, string>() : requiredNamesInPrompt(prompt);
    return slotIdsInPrompt(prompt).flatMap((slotId) => {
      const slot = bySlot.get(slotId);
      if (slot === undefined) return [];
      const seen = (callCounts.get(slotId) ?? 0) + 1;
      callCounts.set(slotId, seen);
      const name = required.get(slotId);
      // A model that ignores the required name is the failure the repair paths
      // exist for, so it is scriptable per slot and per round.
      const forgetting = revising ? renameRevision.has(slotId) : renameFirst.has(slotId) && seen === 1;
      const named = name === undefined || forgetting ? {} : { name };
      if (revising) {
        return [
          synthesizeCard(slot, {
            namePrefix: 'Revised',
            ...named,
            ...(breakRevision.has(slotId) ? { breakManaValue: true } : {}),
          }),
        ];
      }
      const breaking = failFirst.has(slotId) && seen === 1;
      return [
        synthesizeCard(slot, {
          ...named,
          ...(breaking ? { breakManaValue: true } : {}),
        }),
      ];
    });
  }
}

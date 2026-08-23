// @vitest-environment jsdom
/**
 * A recorded game with an equip in it, written and read back.
 *
 * The committed fixture is two bot games over decks with no Equipment in them,
 * so nothing had ever put CR 701.3a attachment through this log. It did not
 * survive the trip: `BoardPermanentSchema` carried a permanent's derived size
 * and its combat flags and no attachment at all, so the viewer drew a weapon
 * and the creature carrying it as two unrelated permanents while the same
 * position on the live table showed the attachment. Growing the snapshot is
 * what `EVENT_LOG_SCHEMA_VERSION` moved to `/3` for.
 *
 * The game is played by a scripted agent rather than a bot, because the point
 * is a log that certainly contains an equip: a greedy bot equipping is a
 * property of the bot, and this file is about the log.
 */
import { createElement as h } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Action, AgentView, DeckList, PlayerAgent } from '@mtg/kernel';
import { functionAgent } from '@mtg/kernel';
import { Battlefield } from '../../src/board/Battlefield';
import { boardFrame } from '../../src/routes/replay/frame';
import { EVENT_LOG_SCHEMA_VERSION } from '../../src/routes/replay/log-schema';
import { describeEvent, namesFor } from '../../src/routes/replay/narrate';
import { readEventLog } from '../../src/routes/replay/read-log';
import type { ReplayGameLog, ReplayStep } from '../../src/routes/replay/read-log';
import { recordGame, writeEventLog } from '../../tools/record-replay';

const MOONBLADE: Card = parseCard({
  kind: 'artifact',
  id: 'xmp-moonblade',
  name: 'Moonblade',
  rarity: 'rare',
  set: { code: 'XMP', collectorNumber: 1 },
  manaCost: { generic: 2 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2 } },
      attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
      effects: [],
    },
  ],
});

const MERFOLK_SENTRY: Card = parseCard({
  kind: 'creature',
  id: 'xmp-merfolk-sentry',
  name: 'Merfolk Sentry',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 8 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  power: 1,
  toughness: 3,
});

const PACIFISM: Card = parseCard({
  kind: 'enchantment',
  id: 'm11-pacifism',
  name: 'Pacifism',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 24 },
  manaCost: { generic: 1, W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [{ kind: 'cantAttack' }, { kind: 'cantBlock' }],
  },
});

const ISLAND = basicLand('Island', 'XMP', 251);

function repeat(card: Card, count: number): readonly Card[] {
  return Array.from({ length: count }, () => card);
}

const ARMORY: DeckList = {
  name: 'Merfolk Armory',
  cards: [...repeat(ISLAND, 12), ...repeat(MERFOLK_SENTRY, 6), ...repeat(MOONBLADE, 6), ...repeat(ISLAND, 6)],
};

/**
 * The land, then the equip, then whatever is castable, then pass.
 *
 * Deterministic and dull on purpose: the recorder is seeded, so one order of
 * preferences over the enumerated options is one reproducible game. The equip
 * outranks casting because it has to — with casting first, the same eight turns
 * spent every point of mana on the next creature, and the four steps that
 * offered an activation all passed it over.
 */
function scripted(name: string): PlayerAgent {
  const order: readonly Action['type'][] = ['playLand', 'activateAbility', 'castSpell'];
  return functionAgent(name, (view: AgentView): Action => {
    for (const kind of order) {
      const found = view.decision.options.find((option) => option.type === kind);
      if (found !== undefined) return found;
    }
    const first = view.decision.options[0];
    if (first === undefined) throw new Error('a decision with no options');
    return first;
  });
}

function recordedLog(): string {
  const recorded = recordGame({
    index: 0,
    seed: 'replay/equip/1',
    decks: [ARMORY, ARMORY],
    agents: [scripted('scripted-a'), scripted('scripted-b')],
    startingPlayer: 0,
    maximumTurns: 8,
  });
  return writeEventLog('packages/ui/test/replay/equip.test.ts', [recorded]);
}

/** The first step whose action equips something, and the board it produced. */
function firstEquip(game: ReplayGameLog): ReplayStep {
  const found = game.steps.find((step) =>
    step.state.battlefield.some((permanent) => permanent.attachedTo !== null),
  );
  if (found === undefined) throw new Error('the recorded game never equipped anything');
  return found;
}

function gameOf(text: string): ReplayGameLog {
  const [game] = readEventLog(text).games;
  if (game === undefined) throw new Error('the log carries no game');
  return game;
}

/** The same retained replay position, with its attachment represented by an Aura. */
function auraGame(game: ReplayGameLog): ReplayGameLog {
  return {
    ...game,
    objects: new Map(
      [...game.objects].map(([oid, object]) => [
        oid,
        object.card.id === MOONBLADE.id ? { ...object, card: PACIFISM } : object,
      ]),
    ),
  };
}

afterEach(cleanup);

describe('a replay log carrying an equip', () => {
  it('states the schema version the snapshot shape belongs to', () => {
    expect(EVENT_LOG_SCHEMA_VERSION).toBe('mtg-ui/event-log/8');
    expect(recordedLog().startsWith(`{"record":"header","schema":"${EVENT_LOG_SCHEMA_VERSION}"`)).toBe(true);
  });

  it('round-trips the attachment through the file', () => {
    const game = gameOf(recordedLog());
    const step = firstEquip(game);
    const weapon = step.state.battlefield.find((permanent) => permanent.attachedTo !== null);
    if (weapon === undefined) throw new Error('no attached permanent in the frame');
    expect(game.objects.get(weapon.oid)?.card.name).toBe('Moonblade');
    const host = weapon.attachedTo;
    if (host === null) throw new Error('an attachment naming nothing');
    expect(game.objects.get(host)?.card.name).toBe('Merfolk Sentry');
  });

  it('draws the weapon and its host as one attachment on the replay board', () => {
    const game = gameOf(recordedLog());
    const step = firstEquip(game);
    const names = namesFor(game, step.seq);
    const frame = boardFrame(game, step.state, step.active, null, names);
    const permanents = [...frame.you.battlefield.permanents, ...frame.opponent.battlefield.permanents];
    const sword = permanents.find((permanent) => permanent.attachedTo !== undefined);
    if (sword === undefined) throw new Error('the frame drew no attached permanent');
    expect(sword.card.name).toBe('Moonblade');
    // The name of the host rather than its id: the board draws names, and the
    // id is the frame's own key.
    expect(sword.attachedTo).toBe('Merfolk Sentry');
    const host = permanents.find((permanent) => (permanent.attachments ?? []).length > 0);
    expect(host?.card.name).toBe('Merfolk Sentry');
    expect(host?.attachments).toEqual(['Moonblade']);
    const side = [frame.you, frame.opponent].find((candidate) =>
      candidate.battlefield.permanents.some((permanent) => permanent.card.id === MOONBLADE.id),
    );
    if (side === undefined) throw new Error('the replay frame drew no Equipment attachment');
    render(h(Battlefield, side.battlefield));
    expect(screen.getByRole('group', { name: 'Merfolk Sentry, equipped with Moonblade' })).toBeTruthy();
    expect(screen.getAllByText('Equipping Merfolk Sentry').length).toBeGreaterThan(0);
  });

  it('draws the equipped creature at the size the recorded snapshot derived', () => {
    const game = gameOf(recordedLog());
    const step = firstEquip(game);
    const frame = boardFrame(game, step.state, step.active, null, namesFor(game, step.seq));
    const permanents = [...frame.you.battlefield.permanents, ...frame.opponent.battlefield.permanents];
    const host = permanents.find((permanent) => (permanent.attachments ?? []).length > 0);
    // Printed 1/3, and the sword's own clause is what makes it 3/3. The
    // snapshot recorded the derived pair all along; the frame had been dropping
    // it and printing the card.
    expect(host?.stats).toEqual({ power: 3, toughness: 3 });
    expect(host?.card.power).toBe(1);
  });

  it('labels an Aura attachment as enchanting on a replay board', () => {
    const game = auraGame(gameOf(recordedLog()));
    const step = firstEquip(game);
    const frame = boardFrame(game, step.state, step.active, null, namesFor(game, step.seq));
    const side = [frame.you, frame.opponent].find((candidate) =>
      candidate.battlefield.permanents.some((permanent) => permanent.card.id === PACIFISM.id),
    );
    if (side === undefined) throw new Error('the replay frame drew no Aura attachment');
    render(h(Battlefield, side.battlefield));
    expect(screen.getByRole('group', { name: 'Merfolk Sentry, enchanted by Pacifism' })).toBeTruthy();
    expect(screen.getAllByText('Enchanting Merfolk Sentry').length).toBeGreaterThan(0);
    expect(screen.queryByText('Equipping Merfolk Sentry')).toBeNull();
  });

  it('keeps a cross-controlled Aura beside its recorded host', () => {
    const game = auraGame(gameOf(recordedLog()));
    const step = firstEquip(game);
    const attached = step.state.battlefield.find((permanent) => permanent.attachedTo !== null);
    if (attached === undefined || attached.attachedTo === null) throw new Error('no recorded attachment');
    const host = step.state.battlefield.find((permanent) => permanent.oid === attached.attachedTo);
    if (host === undefined) throw new Error('the recorded attachment has no host');
    const controller: 0 | 1 = host.controller === 0 ? 1 : 0;
    const snapshot = {
      ...step.state,
      battlefield: step.state.battlefield.map((permanent) =>
        permanent.oid === attached.oid ? { ...permanent, controller } : permanent,
      ),
    };
    const names = namesFor(game, step.seq);
    const frame = boardFrame(game, snapshot, step.active, null, names);
    const hostSide = host.controller === 0 ? frame.you : frame.opponent;
    const otherSide = host.controller === 0 ? frame.opponent : frame.you;

    expect(hostSide.battlefield.permanents.map((permanent) => permanent.card.name)).toEqual(
      expect.arrayContaining(['Merfolk Sentry', 'Pacifism']),
    );
    expect(otherSide.battlefield.permanents.map((permanent) => permanent.key)).not.toContain(attached.oid);
    render(h(Battlefield, hostSide.battlefield));
    expect(
      screen.getByRole('group', {
        name: `Merfolk Sentry, enchanted by Pacifism, controlled by ${names.player(controller)}`,
      }),
    ).toBeTruthy();
  });

  it('narrates the ability by the weapon it came off, not by its raw id', () => {
    const game = gameOf(recordedLog());
    const sentences = game.steps.flatMap((step) =>
      step.events
        .filter((event) => event.type === 'resolutionBegan')
        // A book per step, because a target is said as its controller's and
        // control is a fact about a moment (`routes/replay/narrate.ts`).
        .map((event) => describeEvent(event, namesFor(game, step.seq))),
    );
    // An ability on the stack has no card, so the object table has nothing
    // under its `ab<n>` id and every sentence naming it read `ab60 resolves.`
    expect(sentences).toContain("Moonblade's ability resolves.");
    for (const sentence of sentences) expect(sentence).not.toMatch(/\bab\d+\b/);
  });

  it('is reproducible from the seed alone', () => {
    expect(recordedLog()).toBe(recordedLog());
  });
});
